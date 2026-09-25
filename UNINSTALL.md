# UNINSTALL — wbx 联动桥卸载手册（v5：三 lane；兼容 v2/v3/v4/v5.1/v5.2 全部形态）

> 原则：桥有两种形态——**项目形态**（一切都在项目文件夹内，删目录即净）与
> **全局形态**（`wbx self-install` 之后：`~/.zcode/` 四处 + `~/.wbx/` 运行时）。
> 全局形态用 `wbx self-uninstall` 一键还原。两个桌面版 App（WorkBuddy 国内版 /
> WorkBuddy AI 国际版）与用户自己的 Cline 状态（`~/.cline`）**从头到尾没有被写入过任何
> 文件**，不受影响。
> v4 说明：fanout `files` 字段与长提示词 stdin 通道不产生任何新的磁盘产物。
> v5 说明：新增物有四类——① 可选 cline lane 的隔离主目录 `~/.wbx/cline-home/`（含 `.cline/` 状态与
> `work/`，随 `--purge` 删除，或手动删）；② npm 全局包 `cline`（可选安装物，见第三节）；
> ③ config 里的 `cline-*` 键（随 config.json 删除，或逐键清空）；④ 仓库内新增文档 SECURITY.md /
> CONTRIBUTING.md / CHANGELOG.md（删项目目录即净）。
> v5.1 说明：新增运行时缓存 `~/.wbx/cline-free-models.json`（免费模型清单最近一次成功拉取的
> 缓存，无凭证；随 `~/.wbx/` 一起删或随手删）。**无新的用户级安装物**——`self-install` 写入位置
> 与 v5 完全一致，本节其余内容不变。
> v5.2 说明：新增两件可选运行物（都不是系统级安装物，不装服务/不写注册表/不动环境变量）——
> ① 控制台守护进程（`wbx ui --detach` 拉起的后台 node 进程 + 状态文件 `~/.wbx/run/ui.json`
> + 日志 `~/.wbx/logs/`）：`wbx ui --stop` 即停并清理；② ZCode 会话自启钩子
> （`wbx ui --install-autostart` 写入 `~/.zcode/cli/config.json` 的 `hooks` 键）：
> `wbx ui --remove-autostart` 摘除并逐键还原（实测与安装前逐字节一致）。
> `self-uninstall` 已自动先做这两步再删文件。

## 〇、全局形态卸载（装过 self-install 才需要）

```bash
# v5.2 装过控制台守护/自启钩子的先手动收尾（self-uninstall 也会自动做，手动做一遍更直观）：
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" ui --stop                # 停掉后台守护进程（未在跑则提示无状态文件）
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" ui --remove-autostart    # 摘除 ZCode 会话自启钩子（config.json 逐键还原）
# 用全局桥自己卸载（或用项目桥，等价）：
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" self-uninstall          # 移除 ~/.zcode/ 四处（含自动停守护+摘钩子），保留 ~/.wbx/ 凭证
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" self-uninstall --purge  # 连 ~/.wbx/（含两 lane 凭证 + cline/ 隔离数据 + run/logs）一起删
```

移除清单（self-uninstall 自动处理并逐项报告）：

| 位置 | 内容 |
|---|---|
| `~/.zcode/wbx-bridge/` | 桥本体（scripts 五模块（v5.2 起 +wbx-daemon.mjs） + SKILL.md + PROMPTS.md + examples + docs 副本） |
| `~/.zcode/skills/wb-bridge/` | 用户级 skill（SKILL.md + PROMPTS.md，遮蔽同名项目级 skill） |
| `~/.zcode/commands/wbx.md` | `/wbx` 斜杠命令 |
| `~/.zcode/AGENTS.md` | `<!-- wbx:begin/end -->` 标记块（文件只剩它时连文件删除，其余内容保留） |
| `~/.zcode/cli/config.json` | **仅当装过 `ui --install-autostart`**：`hooks` 键里我们追加的 SessionStart 钩子（`--remove-autostart` / `self-uninstall` 摘除；其余键从未被改写） |
| `~/.wbx/` | 运行时：sessions/product **凭证**、config.json、jobs/ 历史、**cline-home/（可选 lane 隔离数据与 OAuth 凭证）**、cline-free-models.json（免费清单缓存，无凭证）、run/（ui.json 守护状态，含随机 token，无账号凭证）、logs/（ui.log 控制台日志）（仅 `--purge` 删；不 purge 时 run/logs 留着无害） |

卸载后项目桥自动回到项目形态（运行时根变回 `<项目>/.wbx/`）。
若全局桥已被手动删除，用下面项目桥路径运行亦可：`node "<项目>\.zcode\skills\wb-bridge\scripts\wbx.mjs" self-uninstall`。

## 一、完整卸载（项目形态：桥 + 三 lane + 分派体系全删）

```powershell
# PowerShell（或资源管理器手动删）
cd "<本仓库所在目录>"   # 即 clone 或解压 wbx 桥的文件夹

# 1. 桥本体（脚本 + Skill）
Remove-Item -Recurse -Force ".zcode\skills\wb-bridge"

# 2. 运行时（含 ai/cn 两 lane 的凭证、config.json、jobs/ 历史、任务缓存；
#    全局形态还有 ~/.wbx/ 下的同类内容与 cline-home/ 隔离主目录）
#    结构：sessions\{cn,ai}.json + product\{cn,ai}.json + config\{cn,ai}\ + config.json
#          + jobs\<jobId>\ + tasks\<时间戳>\ + tmp\ + cline-home\.cline\{data,...} + cline-home\work\
Remove-Item -Recurse -Force ".wbx"

# 3. 项目级常驻指令（若文件里还有非 wbx 内容，只删 wbx 段落）
Remove-Item -Force "AGENTS.md"

# 4. 文档（可选：留着当参考也行）
Remove-Item -Force "README.md","WBX.md","UNINSTALL.md","AGENTS.md","LICENSE","SECURITY.md","CONTRIBUTING.md","CHANGELOG.md"

# 5. 根 .gitignore 里的 `.wbx/` 行（若不再用本目录做编排）
notepad ".gitignore"
```

## 二、用户级全局指令（仅 install-user 装过；self-install 用户走第〇节）

仅当你运行过 `wbx install-user`（v2 遗留方式），`~/.zcode/AGENTS.md` 里才有 wbx 标记块：

```bash
node "<本仓库所在目录>\.zcode\skills\wb-bridge\scripts\wbx.mjs" uninstall-user
```

```powershell
# 或手动：打开后删除 <!-- wbx:begin --> 到 <!-- wbx:end --> 之间（含标记）的整块
notepad "$env:USERPROFILE\.zcode\AGENTS.md"
```

注意：`uninstall-user` 在文件移除块后变空时会连同删除该文件；其余内容原样保留。
v3 的 `self-uninstall` 会顺带做同一件事，无需重复执行。

## 三、可选 cline lane 的安装物与数据

装过 cline lane 的机器，额外有以下三处（全部可选、相互独立，按需清理）：

| 位置 | 内容 | 清理命令 |
|---|---|---|
| npm 全局包 `cline` | Cline CLI 本体（平台二进制，约 140MB） | `npm uninstall -g cline` |
| `~/.wbx/cline-home/` | 桥的 cline 隔离主目录：`.cline/data/settings/providers.json`（OAuth 凭证）、db、日志、会话 + `work/`（空工作目录）。桥通过 HOME/USERPROFILE 覆盖把 cline 状态全部约束在此（实测 3.0.65 的 `--data-dir` 不可用，详见 WBX.md v5 章） | `Remove-Item -Recurse -Force "$env:USERPROFILE\.wbx\cline-home"` |
| config 的 `cline-*` 键 | cline-path / cline-data-dir / cline-provider / cline-model / cline-thinking / cline-compaction / cline-parallel | 随 `--purge` 连 config.json 一起删；或逐键 `wbx config set <key> ""` 清空 |

- 只停用不删除：`wbx config set disabled-lanes '["cline"]'`（路由/回退/fanout 全链路跳过，
  doctor 标注「已禁用」），或 `npm uninstall -g cline`（doctor 显示「未安装（可选）」，不影响
  ai/cn 任何功能）。
- **用户自己的 `~/.cline`（桌面 Cline 状态）不该被桥读写**（桥以 HOME 覆盖实现隔离）；无需也请不要因本桥清理它。

## 四、UI 进程与分发产物

- `wbx ui`（不带参数）启动的是一个**前台 node 进程**（仅监听 127.0.0.1:7788）：关掉终端 /
  Ctrl+C 即退，无需清理。
- v5.2 起 `wbx ui --detach` 可拉起**后台守护进程**（常驻到你 `--stop` 或关机）：卸载前先跑
  `wbx ui --stop`（HTTP 优雅关闭，进程退出、端口释放、状态文件 `~/.wbx/run/ui.json` 删除）；
  若桥已删干净而进程还在（罕见），`netstat -ano | findstr :7788` 找 pid 后
  `taskkill /PID <pid> /F`，再删 `~/.wbx/run/` 与 `~/.wbx/logs/` 即净。
- v5.2 起 `wbx ui --install-autostart` 会在 `~/.zcode/cli/config.json` 追加 SessionStart 钩子：
  卸载用 `wbx ui --remove-autostart`（只摘我们那条，其余键原样保留；实测与安装前逐字节一致）。
  若桥已删而钩子还在，手动编辑该文件删掉 `hooks.events.SessionStart` 里 `args` 含
  `wbx-bridge\scripts\wbx.mjs` 的那条；`hooks` 里再无别的内容时可整体删去 `hooks` 键。
- `wbx export-bundle` 生成的 zip（默认在 `~/Desktop/wbx-bridge-v5-*.zip`）是**零凭证**分发包
  （导出时逐成员比对本地 accessToken 做过断言），可随手删除或外发。
- 在别处用分包装过的机器：在那台机器上运行 `node scripts\wbx.mjs self-uninstall [--purge]`
  （装过 cline lane 的机器再 `npm uninstall -g cline`）。

## 五、凭证与服务端会话

- 本地凭证共三处：
  - WorkBuddy 双 lane（同一套的两份拷贝，删全局形态默认不动项目侧，反之亦然）：
    `~/.wbx/sessions\{cn,ai}.json` + `~/.wbx/product\{cn,ai}.json`，以及
    `<项目>\.wbx\` 下同名文件——均含 accessToken。
  - cline lane：`~/.wbx/cline-home\.cline\data\settings\providers.json`（OAuth 凭证， settings.auth.accessToken 字段）。
- 服务端会话不主动撤销，cn 的 accessToken **约 55 天自然过期**；ai 的 accessToken 实测
  有效期更长（数百天级）；cline 的 OAuth 凭证以官方有效期为准（失效后 doctor 报
  Unauthorized，重新 login 即可）。
- 如想立即失效：登录 WorkBuddy 网页版（copilot.tencent.com / www.workbuddy.ai）→
  账号设置 → 退出全部设备/管理登录会话（可选，两个账号各操作一次）；cline 凭证在
  cline 官方账号设置中撤销。

## 六、确认不受影响的部分（卸载后自检）

| 位置 | 状态 |
|---|---|
| 桌面版 WorkBuddy 国内版（`~/.workbuddy`） | 只读过 cache，未写入任何文件 ✅ |
| 桌面版 WorkBuddy AI 国际版（`~/.workbuddy-ai`） | 只读过 cache，未写入任何文件 ✅ |
| 用户自己的 Cline 状态（`~/.cline`） | **从未读写**（桥的 cline 状态只在 `~/.wbx/cline/`）✅ |
| WorkBuddy 安装目录（如 `%LOCALAPPDATA%\Programs\WorkBuddy*`） | 未修改 ✅ |
| `%LOCALAPPDATA%\CodeBuddyExtension` | 未修改 ✅ |
| 系统环境变量 / PATH | 从未改动（所有 env 只在 spawn 时注入）✅ |
| ZCode 全局配置 `~/.zcode/cli/config.json` | 未装过自启钩子时从未改动；装过则 `--remove-autostart`/`self-uninstall` 摘除后逐键还原（实测 diff 逐字节一致）✅ |
| `~/.zcode/` 其他内容 | self-uninstall 后四目标位置零残留（实测），其余未触碰 ✅ |

## 七、只停用、不删除（临时停用）

- 会话级：正常使用，不触发相关任务即可（分派是行为规则，无后台进程）。
- 项目级停用：把项目 `AGENTS.md` 里的分派段落注释掉或删除。
- 全局停用：`wbx self-uninstall`（凭证保留）或只删用户级 skill 目录。
- 只停一条 lane：`wbx config set disabled-lanes '["ai"]'`（路由/回退/fanout 全链路跳过，
  doctor 标注「已禁用」）；或删除对应 lane 的凭证文件（doctor 显示 [SKIP]）；
  cline lane 也可直接 `npm uninstall -g cline`（未装=WARN，不影响 exit 0）。
- wbx 无任何常驻进程/服务/定时任务（`wbx ui` 是前台进程，关终端即退），不删也不耗资源。
