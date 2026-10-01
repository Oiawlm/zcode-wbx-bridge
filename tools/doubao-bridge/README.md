# doubao-bridge — 豆包桌面端「工作模式」CDP 驱动（v12 交付物）

> **诚实声明（三处必读）**：
> 1. **这是临时工具**——依托豆包客户端当前 UI 结构（data-testid 锚点）工作，客户端升级随时可能失效；
> 2. **Windows-only**——依赖 Windows 进程模型、netstat 与 PowerShell，未在其他平台验证；
> 3. **非官方**——豆包官方未公开桌面端编程接口，本工具走 Chromium 官方调试开关（CDP）驱动
>    已登录客户端，与字节跳动无关，不属于任何受支持的集成方式。

## 它做什么

一条命令驱动豆包电脑版「工作模式」：新建工作任务 → 显式选「豆包 2.1 Pro」+ 推理强度「高」→
发送任务 → 取回结果文本。模型与推理强度的配置状态以输入框上方状态栏文字为准（如「豆包 2.1 Pro高」），
每步操作后都会读回校验。

## 全局形态（v6.3 起，装过 `wbx self-install` 后全项目通用）

- 任何项目、任何目录直接走 wbx 直通入口（cmd 写法；PowerShell 换 `$env:USERPROFILE`）：
  `node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" doubao ask "任务文本"`——子命令与参数
  原样转发给本工具（status/new-task/configure/send/read/ask 及全部旗标）。
- 全局副本在 `~\.zcode\wbx-bridge\doubao\`（self-install 从本目录整目录复制，含 node_modules）；
  本目录（`tools/doubao-bridge/`）是源与开发形态，改动后重跑 `wbx self-install` 即同步。
- 启动调试口同样用全局副本：`powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\.zcode\wbx-bridge\doubao\launch.ps1"`。

## 前置条件

- Windows 10/11，Node.js ≥ 18，`playwright-core`（已在本目录 `npm install`，无需下载浏览器）。
- **豆包桌面端已登录**（登录态由用户在 GUI 内自理，本工具不做任何凭证自动化，脚本与文档零凭证）。
- 豆包正以调试端口运行。两种启动方式：
  - `powershell -ExecutionPolicy Bypass -File launch.ps1 -Force`（检测到已运行实例时需 `-Force` 才会
    结束它们；先保存豆包里未发送的草稿）。未指定 `-DoubaoPath` 且默认路径不存在时，会自动探测
    常见安装位置（`%LOCALAPPDATA%\Doubao`、`%LOCALAPPDATA%\Programs\Doubao`、`Program Files`）；
    也可随时 `-DoubaoPath` 显式指定；
  - 或手动：完全退出豆包（含托盘）后
    `& "D:\App\Doubao\app\Doubao.exe" --remote-debugging-port=9225`。
- 调试端口是**本地攻击面**：开放期间本机任意进程可经 9225 接管已登录客户端。launch.ps1 已校验
  只绑 127.0.0.1；**用完请正常重启豆包恢复无调试态**（正常退出后再普通启动）。

## 用法

```powershell
cd tools/doubao-bridge

# 状态：CDP 是否可达、当前模型/推理档/环境
node doubao.mjs status

# 一条命令全链路（新工作任务 → 显式配置 Pro+高 → 发送 → 取回结果）
node doubao.mjs ask "请用一句话概括：Redis 是一个开源的内存键值数据库。"

# 分步
node doubao.mjs new-task          # 新建工作任务（注意：新会话会把推理档重置回「中」）
node doubao.mjs configure         # 显式选「豆包 2.1 Pro」+「高」（可 --model/--reasoning 覆盖）
node doubao.mjs send "任务文本"   # 发送（发送前自动重验配置，不符则先重配）
node doubao.mjs read              # 轮询取回最新回复（--wait-ms/--poll-ms 可调）
```

所有命令输出单行 JSON；退出码：`0` 成功 / `2` 锚点失配（立即停止，不硬重试）/ `3` CDP 不可达 /
`4` 配置校验失败 / `5` 读结果超时 / `1` 其他。launch.ps1 退出码见其文件头注释。

## 已知限制与坑（实测）

- **新会话可能重置推理档**：点「新工作任务」后推理档可能从「高」跳回「中」（实测不稳定复现，
  模型档 Pro 一般保留）——所以 `send`/`ask` 在发送前都会重读状态栏并按需重配；直接手工操作时
  也请发送前瞄一眼状态栏。
- **侧栏收起时**：侧栏里的「新工作任务」按钮在视口外不可点，`doubao.mjs` 会自动回退到应用
  内置快捷键 Ctrl+N 并校验落入工作模式首页。
- **选择器脆弱**：选择器型锚点均集中在 `anchors.json`（每锚点 ≥2 候选；`modelItems`/
  `reasoningLevels` 为名称映射，`workTabButton`/`sentMessage`/`settingsEntry` 为保留键），
  豆包升级改 UI 即可能失配；全候选失配时 CLI 立即以退出码 2 停止，绝不盲目重试。
- **额度**：工作模式耗额度明显快于普通对话（官方口径），请自行控制任务量与频率。
- **单行道**：工作模式与普通对话在会话中途不可互切（切了上下文作废）——工具只用「新工作任务」
  开新会话，不动你既有会话。
- **完成判定**：结果轮询以「文本连续 3 轮不变」判完成（流式光标类元素不可靠）；极慢的长任务请
  调大 `--wait-ms`。
- **非破坏性边界**：本工具只做文本任务收发，不驱动豆包执行本地文件清理/删除/升级等操作。

## 客户端升级后怎么修（锚点修复流程）

1. 现象：命令报 `锚点失配`（exit 2），JSON 里带失配锚点名与候选清单。
2. 用 `launch.ps1` 带调试端口启动豆包，浏览器开
   `http://127.0.0.1:9225/inspection.html` 不可用时，直接用 `curl http://127.0.0.1:9225/json/list`
   找到主应用页（URL 含 `doubao-chat/chat`）。
3. 重新勘探：对主应用页 dump 全部 `[data-testid]` 与可见按钮/菜单文本（照本目录 anchors.json 的
   键逐一比对），更新 `anchors.json` 对应键的候选数组（保持每锚点 ≥2 候选）。
4. 重跑 `node doubao.mjs status` 与一次无害小任务验证。

## 文件清单

| 文件 | 职责 |
|---|---|
| `launch.ps1` | 带调试端口启动/守护（进程归零校验 → 带参拉起 → 就绪轮询 → 回环绑定校验） |
| `doubao.mjs` | CDP 驱动 CLI（status/new-task/configure/send/read/ask） |
| `anchors.json` | 全部 UI 锚点选择器配置（升级后只需更新此文件） |
