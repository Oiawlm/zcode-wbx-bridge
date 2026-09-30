#requires -Version 5.1
<#
.SYNOPSIS
    带调试端口（CDP / --remote-debugging-port）启动豆包桌面端，供 tools/doubao-bridge/doubao.mjs
    通过 connectOverCDP 连接。

.DESCRIPTION
    行为严格对齐 v12-contract.md §3：
      1) 已有 Doubao 进程时：无 -Force 只提示并退出 1，绝不擅自结束用户可能带未保存会话的进程；
         有 -Force 才 taskkill /IM Doubao.exe /F，并循环等待进程归零（最多 15s），未归零退出 2
         —— 豆包是单实例应用，旧实例不归零时新实例只会把 --remote-debugging-port 转发给旧实例，
         调试端口不会真的开起来。
      2) Start-Process 带 --remote-debugging-port=<Port> 启动。
      3) 轮询 http://127.0.0.1:<Port>/json/version（最多 30s），解析 JSON 并校验 Browser 字段存在。
      4) netstat -ano 校验该端口只在回环地址 LISTENING；出现 0.0.0.0 / [::] 等非回环绑定立即退出 4
         （本地攻击面防线）。
      5) 结束时在 stdout 打印唯一一行 JSON：{ ok, port, browser, pid, reason, hint }；
         人类可读信息与失败原因走 stderr，因此 stdout 可直接被 ConvertFrom-Json / JSON.parse 解析。

    退出码：0 成功
            1 已有豆包进程且未指定 -Force
            2 -Force 后 15s 内进程未归零
            3 可执行文件缺失 / 启动失败 / 就绪轮询超时 / 端口被非豆包进程占用
            4 端口绑定校验失败（出现非回环绑定，或无法确认回环 LISTENING）
            5 未预期异常

.NOTES
    文件编码必须为 UTF-8 with BOM：PowerShell 5.1 只有看到 BOM 才会按 UTF-8 解析脚本，否则中文注释与
    中文提示都会乱码。
    关闭调试态：正常退出豆包后不带任何参数普通启动即可；本脚本刻意不实现自动收尾，保持行为可预期。
    本脚本不写、不读、不传递任何凭证，也不触碰应用 userData 目录。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File launch.ps1 -Port 9225 -DoubaoPath "D:\App\Doubao\app\Doubao.exe"

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File launch.ps1 -Force
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 9225,

    [ValidateNotNullOrEmpty()]
    [string]$DoubaoPath = 'D:\App\Doubao\app\Doubao.exe',

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# 未预期异常也要按契约收尾：给可读原因 + 非零退出码 + 一行 JSON，不让 .NET 堆栈裸奔到下游
trap {
    $reason = "未预期异常: $($_.Exception.Message)"
    try { [Console]::Error.WriteLine("[launch.ps1] $reason") } catch { }
    $payload = [ordered]@{
        ok      = $false
        port    = $Port
        browser = $null
        pid     = $null
        reason  = $reason
        hint    = $null
    }
    try { Write-Output ($payload | ConvertTo-Json -Compress) } catch { }
    exit 5
}

# stdout 固定 UTF-8：JSON 里的中文（reason/hint）被 doubao.mjs 或重定向文件按 UTF-8 解析时不会乱码
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

# ---- 契约 §3 固定阈值（不暴露为参数，避免行为漂移）----
$ProcessName      = 'Doubao'
$KillWaitSeconds  = 15
$ReadyWaitSeconds = 30
$PollIntervalMs   = 500
$ProbeTimeoutMs   = 2000
$LockReleaseMs    = 800
$ShutdownHint     = '用后请正常重启豆包以关闭调试端口（正常退出后再不带参数普通启动即可）'

function Write-Note {
    param([Parameter(Mandatory = $true)][string]$Message)
    # 为什么走 stderr：stdout 必须始终保持"只有一行 JSON"，日志混进去会污染下游解析
    [Console]::Error.WriteLine("[launch.ps1] $Message")
}

function Write-Result {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Result,
        [Parameter(Mandatory = $true)][int]$Code
    )
    # 为什么用 Write-Output 而不是 [Console]::Out：前者在"PowerShell 管道 |"与"进程级 stdout 重定向"
    # 两种消费方式下都能被下游拿到
    Write-Output ($Result | ConvertTo-Json -Compress)
    exit $Code
}

function Write-Failure {
    param(
        [Parameter(Mandatory = $true)][string]$Reason,
        [Parameter(Mandatory = $true)][int]$Code,
        [string]$Hint
    )
    Write-Note $Reason
    $payload = [ordered]@{
        ok      = $false
        port    = $Port
        browser = $null
        pid     = $null
        reason  = $Reason
        hint    = $Hint
    }
    Write-Result -Result $payload -Code $Code
}

function Get-DoubaoProcesses {
    return @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
}

function Test-ProcessAlive {
    param($Process)
    if ($null -eq $Process) { return $false }
    try { return (-not $Process.HasExited) } catch { return $false }
}

function Get-HttpText {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutMs = 2000
    )
    $response = $null
    try {
        # 为什么不用 Invoke-WebRequest：PS 5.1 没有 -NoProxy，系统代理可能把 127.0.0.1 也代理走，
        # 造成"端点其实已就绪却探测失败"；HttpWebRequest 还能设毫秒级超时，单次探测不会卡死轮询
        $request = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Url)
        $request.Proxy = $null
        $request.Method = 'GET'
        $request.Timeout = $TimeoutMs
        $request.ReadWriteTimeout = $TimeoutMs
        $response = $request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    }
    catch {
        return $null
    }
    finally {
        if ($null -ne $response) { $response.Close() }
    }
}

function Get-PortNetstat {
    param([Parameter(Mandatory = $true)][int]$Port)
    $result = [pscustomobject]@{
        Ran        = $false
        RawForPort = @()
        Entries    = @()
    }
    try {
        $raw = @(& netstat.exe -ano 2>$null)
        $result.Ran = $true
    }
    catch {
        return $result
    }

    $rawLines = @()
    $entries = @()
    foreach ($line in $raw) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $fields = @($line.Trim() -split '\s+')
        if ($fields.Count -lt 4) { continue }
        if ($fields[0] -inotmatch '^(TCP|TCPv6)$') { continue }
        $local = [string]$fields[1]
        if ($local -notmatch ':(\d+)$') { continue }
        if ([int]($Matches[1]) -ne $Port) { continue }

        $rawLines += $line.Trim()
        # 只认 LISTENING：ESTABLISHED/TIME_WAIT 行与外部对端地址不能当作绑定证据
        if ($fields[3] -inotmatch '^LISTENING$') { continue }
        if ($fields[-1] -notmatch '^\d+$') { continue }

        $entries += [pscustomobject]@{
            Address = $local.Substring(0, $local.LastIndexOf(':'))
            Pid     = [int]$fields[-1]
        }
    }
    $result.RawForPort = $rawLines
    $result.Entries = $entries
    return $result
}

function Test-LoopbackAddress {
    param([Parameter(Mandatory = $true)][string]$Address)
    $a = $Address.Trim().ToLowerInvariant()
    $a = $a -replace '^\[', '' -replace '\]$', ''
    # 整个 127.0.0.0/8、IPv6 回环 ::1、以及 IPv4 映射形式都算回环；其余（0.0.0.0、::、局域网 IP）一律不算
    if ($a -eq '::1') { return $true }
    if ($a.StartsWith('127.')) { return $true }
    if ($a.StartsWith('::ffff:127.')) { return $true }
    return $false
}

# ============================ 主流程 ============================

Write-Note "参数: Port=$Port, DoubaoPath=$DoubaoPath, Force=$([bool]$Force)"

# 步骤 0：先校验可执行文件。放在杀进程之前——否则"先杀后失败"会白毁掉用户正在编辑的会话
if (-not (Test-Path -LiteralPath $DoubaoPath -PathType Leaf)) {
    Write-Failure -Code 3 -Reason "找不到豆包可执行文件: $DoubaoPath" -Hint '用 -DoubaoPath 指定实际安装路径，例如 -DoubaoPath "D:\App\Doubao\app\Doubao.exe"'
}

# ---- 步骤 1：现有进程处理（无 -Force 一律不动用户进程）----
$existing = @(Get-DoubaoProcesses)
if ($existing.Count -gt 0) {
    $existingPids = $existing.Id -join ', '

    if (-not $Force) {
        $reason = "检测到 $($existing.Count) 个豆包进程正在运行 (PID: $existingPids)；未指定 -Force，拒绝结束它们"
        $hint = '先保存工作并手动退出豆包，或带 -Force 重跑：powershell -ExecutionPolicy Bypass -File launch.ps1 -Force'
        Write-Failure -Code 1 -Reason $reason -Hint $hint
    }

    Write-Note "-Force：结束现有豆包进程 (taskkill /IM $ProcessName.exe /F)"
    # 为什么临时放开 EA：PS 5.1 在 $ErrorActionPreference='Stop' 下会把原生命令的 stderr 当终止错误抛出
    $eapBackup = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & taskkill.exe /IM "$ProcessName.exe" /F 2>&1 | Out-Null } catch { Write-Note "taskkill 调用异常，仍继续等待进程归零: $($_.Exception.Message)" }
    finally { $ErrorActionPreference = $eapBackup }

    $deadline = (Get-Date).AddSeconds($KillWaitSeconds)
    while ($true) {
        $alive = @(Get-DoubaoProcesses)
        if ($alive.Count -eq 0) { break }
        if ((Get-Date) -ge $deadline) {
            $alivePids = $alive.Id -join ', '
            $reason = "等待 $KillWaitSeconds 秒后豆包进程仍未归零 (PID: $alivePids)；单实例锁会把调试参数转发给旧实例"
            Write-Failure -Code 2 -Reason $reason -Hint '在任务管理器里确认豆包（含托盘/后台进程）已完全退出后重跑'
        }
        Start-Sleep -Milliseconds 300
    }

    Write-Note '豆包进程已归零，等待单实例锁与端口释放'
    # 为什么还要等：进程对象消失 ≠ 锁/监听端口立即释放，抢跑会让新实例把参数转发给"幽灵"旧实例
    Start-Sleep -Milliseconds $LockReleaseMs
}

# ---- 步骤 2：带参启动 ----
Write-Note "启动: `"$DoubaoPath`" --remote-debugging-port=$Port"
$appProcess = $null
try {
    $appProcess = Start-Process -FilePath $DoubaoPath -ArgumentList "--remote-debugging-port=$Port" -PassThru
}
catch {
    Write-Failure -Code 3 -Reason "Start-Process 启动失败: $($_.Exception.Message)" -Hint '确认路径可执行、当前用户有权限，且没有杀软拦截'
}
$launcherPid = $null
if (Test-ProcessAlive -Process $appProcess) { $launcherPid = [int]$appProcess.Id }
Write-Note "已发起启动（启动器 PID=$launcherPid），开始轮询 CDP 端点"

# ---- 步骤 3：轮询 /json/version 直至就绪 ----
$versionUrl = "http://127.0.0.1:$Port/json/version"
$browser = $null
$deadline = (Get-Date).AddSeconds($ReadyWaitSeconds)
while ((Get-Date) -lt $deadline) {
    $text = Get-HttpText -Url $versionUrl -TimeoutMs $ProbeTimeoutMs
    if ($text) {
        $versionInfo = $null
        try { $versionInfo = $text | ConvertFrom-Json } catch { $versionInfo = $null }
        if ($null -ne $versionInfo -and $versionInfo.Browser) {
            $browser = [string]$versionInfo.Browser
            break
        }
    }
    Start-Sleep -Milliseconds $PollIntervalMs
}

if (-not $browser) {
    $extra = ''
    if (@(Get-DoubaoProcesses).Count -eq 0) { $extra = '；当前已无豆包进程，疑似启动后立即退出' }
    $reason = "$ReadyWaitSeconds 秒内 $versionUrl 未返回含 Browser 字段的 JSON$extra"
    Write-Failure -Code 3 -Reason $reason -Hint '确认端口未被占用、豆包能正常启动（可先手动普通启动一次看是否有报错弹窗）'
}

# ---- 步骤 4：netstat -ano 校验端口只 LISTENING 在回环地址 ----
$net = Get-PortNetstat -Port $Port
if (-not $net.Ran) {
    Write-Failure -Code 4 -Reason "无法执行 netstat -ano，未能验证端口 $Port 的绑定范围（安全校验失败即中止）" -Hint '确认 C:\Windows\System32\netstat.exe 可用且未被安全策略拦截'
}
if ($net.Entries.Count -eq 0) {
    $detail = "netstat 输出中没有端口 $Port 的 LISTENING 记录"
    if ($net.RawForPort.Count -gt 0) { $detail = "端口 $Port 的原始行: " + ($net.RawForPort -join ' | ') }
    Write-Failure -Code 4 -Reason "未能确认 $Port 处于 127.0.0.1 LISTENING 状态（$detail）"
}

$outside = @($net.Entries | Where-Object { -not (Test-LoopbackAddress -Address $_.Address) })
if ($outside.Count -gt 0) {
    $detail = ($outside | ForEach-Object { "$($_.Address):$Port (PID $($_.Pid))" }) -join ', '
    Write-Failure -Code 4 -Reason "调试端口 $Port 绑定了非回环地址: $detail；这会把本地调试面暴露到局域网，已中止" -Hint '检查启动参数里是否被追加了 --remote-debugging-address'
}

$loopback = @($net.Entries | Where-Object { Test-LoopbackAddress -Address $_.Address })
if ($loopback.Count -eq 0) {
    Write-Failure -Code 4 -Reason "netstat 中没有 $Port 的回环 LISTENING 记录，无法确认绑定范围"
}
$listenPids = @(@($loopback | ForEach-Object { [int]$_.Pid }) | Where-Object { $_ -gt 0 })

# 防"张冠李戴"：/json/version 可能来自碰巧占用同端口的其它 Chromium 程序，必须确认监听者就是豆包
foreach ($listenPid in $listenPids) {
    $owner = Get-Process -Id $listenPid -ErrorAction SilentlyContinue
    if ($null -ne $owner -and $owner.ProcessName -ne $ProcessName) {
        $reason = "端口 $Port 的监听进程是 $($owner.ProcessName) (PID $($owner.Id))，不是豆包；该 CDP 端点不属于豆包"
        Write-Failure -Code 3 -Reason $reason -Hint '换一个端口重试，例如 -Port 9333'
    }
}

$live = @(Get-DoubaoProcesses)
if ($live.Count -eq 0) {
    Write-Failure -Code 3 -Reason 'CDP 端点已响应，但系统中没有任何豆包进程，端口疑似被其它程序占用' -Hint '换一个端口重试，例如 -Port 9333'
}
$livePids = @($live | ForEach-Object { [int]$_.Id })

# ---- 步骤 5：解析 pid 并输出唯一一行 JSON ----
$cdpPid = $null
foreach ($listenPid in $listenPids) {
    if ($livePids -contains $listenPid) { $cdpPid = $listenPid; break }
}
if ($null -eq $cdpPid) {
    if (Test-ProcessAlive -Process $appProcess) {
        $cdpPid = [int]$appProcess.Id
    }
    else {
        $cdpPid = [int](@($live | Sort-Object StartTime | Select-Object -First 1)[0].Id)
    }
}

Write-Note "就绪: $browser，仅监听 127.0.0.1:$Port (PID $cdpPid)"
$payload = [ordered]@{
    ok      = $true
    port    = $Port
    browser = $browser
    pid     = $cdpPid
    reason  = $null
    hint    = $ShutdownHint
}
Write-Result -Result $payload -Code 0
