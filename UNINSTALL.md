# UNINSTALL — wbx 联动桥卸载手册（五 lane；兼容全部历史形态）

> **一键还原承诺**：全局形态 `wbx self-uninstall` 一键移除全部安装物（`--purge` 连 `~/.wbx/` 凭证一起删，默认保留）；项目形态删项目目录即净。桥有两种形态——**项目形态**（一切都在项目文件夹内）与**全局形态**（`wbx self-install` 之后：`~/.zcode/` 四处 + `~/.wbx/` 运行时）。两个桌面版 App（WorkBuddy 国内版/国际版）与用户自己的 Cline 状态（`~/.cline`）**从头到尾没有被写入过任何文件**，不受影响。`fanout` 的 `files` 字段/长提示词 stdin/余额查询/双主题/PWA 均为运行时行为，零新增磁盘安装物。各版本新增物的**完整登记见下方各表**（逐版本说明的历史原文见 HISTORY.md）。

## 〇、全局形态卸载（装过 self-install 才需要）

```bash
# 装过控制台守护/自启钩子的先收尾（self-uninstall 也会自动做，手动做一遍更直观）：
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" ui --stop                # 停后台守护
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" ui --remove-autostart    # 摘自启钩子（逐键还原）
# 用全局桥自己卸载（或用项目桥，等价）：
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" self-uninstall          # 移除 ~/.zcode/ 四处，保留 ~/.wbx/ 凭证
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" self-uninstall --purge  # 连 ~/.wbx/（含全部凭证与隔离数据）一起删
```

### 安装物登记表（self-uninstall 自动处理并逐项报告）

| 位置 | 内容 |
|---|---|
| `~/.zcode/wbx-bridge/` | 桥本体（scripts 六件（wbx/wbx-core/wbx-ui/wbx-setup/wbx-daemon + **ui.html** 前端模板资产，v23 起）+ PROMPTS.md + examples + docs 副本 + doubao/ 豆包桥副本（v6.3 起，含 node_modules/playwright-core，可选） |
| `~/.zcode/skills/wb-bridge/` | 用户级 skill（SKILL.md + PROMPTS.md，遮蔽同名项目级 skill） |
| `~/.zcode/commands/wbx.md` | `/wbx` 斜杠命令 |
| `~/.zcode/AGENTS.md` | `<!-- wbx:begin/end -->` 标记块（文件只剩它时连文件删除，其余内容保留） |
| `~/.zcode/cli/config.json` | **仅当装过 `ui --install-autostart`**：`hooks` 键里我们追加的 SessionStart 钩子（摘除后与安装前逐字节一致；其余键从未被改写） |
| `~/.zcode/skills/glm-prompt-crafter/` | v17 起的用户级提示词工艺库部署副本（见 §四；不随 self-uninstall 删，单独删目录即净） |
| `~/.wbx/`（仅 `--purge` 删） | 运行时：sessions/product **凭证**、config.json（键集以 `wbx config list` 为准）、jobs/ 历史、scratch/（能力任务工作目录）、**cline-home/**（可选 lane 隔离数据与 OAuth 凭证）、**codex-home/**（可选第五 lane：auth.json 凭证副本+work/）、codex-quota.json（冷却态，无凭证）、cline-free-models.json（免费清单缓存，无凭证）、run/（ui.json 守护状态，含随机 token）、logs/（ui.log）。不 purge 时 run/logs 留着无害 |

卸载后项目桥自动回到项目形态（运行时根变回 `<项目>/.wbx/`）。全局桥已被手动删除时，用项目桥路径运行等价：`node "<项目>\.zcode\skills\wb-bridge\scripts\wbx.mjs" self-uninstall`。

## 一、完整卸载（项目形态）

```powershell
cd "<本仓库所在目录>"
Remove-Item -Recurse -Force ".zcode\skills\wb-bridge"      # 桥本体（脚本 + Skill）
Remove-Item -Recurse -Force ".wbx"                          # 项目运行时（凭证/历史/scratch/cline-home）
Remove-Item -Force "AGENTS.md"                              # 项目级常驻指令（有非 wbx 内容则只删 wbx 段）
Remove-Item -Force "README.md","WBX.md","HISTORY.md","UI-SPEC.md","UNINSTALL.md","LICENSE","SECURITY.md","CONTRIBUTING.md","CHANGELOG.md"
Remove-Item -Recurse -Force "tools\doubao-bridge"           # 豆包桥工具（含其 node_modules）
Remove-Item -Recurse -Force ".zcode\skills\glm-prompt-crafter"  # 提示词工艺库项目部署（v17）
Remove-Item -Force "tools\install-glm-prompt-crafter.mjs"       # 工艺库部署脚本（v17）
# 文档与工具全清单以 CONTRIBUTING.md 白名单为准（tools/doubao-bridge 与 docs 副本随上述命令覆盖）；根 .gitignore 的 `.wbx/` 行按需清理
```

## 二、用户级全局指令（install-user 与 self-install 都会写；本节=手动清理指引）

`wbx install-user`（v2 遗留方式）与 `wbx self-install` 都会写 `~/.zcode/AGENTS.md` 的 wbx 标记块：`self-uninstall` 一并摘除；legacy 路径 `wbx uninstall-user` 只摘块（文件只剩块时连文件删）。手动清理=删除 `<!-- wbx:begin -->` 到 `<!-- wbx:end -->` 整块。

## 三、可选 lane 的安装物与数据（全部可选、相互独立）

| 位置 | 内容 | 清理 |
|---|---|---|
| npm 全局包 `cline` | Cline CLI 本体（平台二进制，约 140MB） | `npm uninstall -g cline`（未装=WARN 不影响 ai/cn） |
| `~/.wbx/cline-home/` | 桥的 cline 隔离主目录：`.cline/data/settings/providers.json`（OAuth 凭证）、db、日志 + `work/`。桥以 HOME 覆盖把 cline 状态全部约束在此（实测 3.0.65 的 `--data-dir` 不可用） | 随 `--purge` 删；或 `Remove-Item -Recurse -Force "$env:USERPROFILE\.wbx\cline-home"` |
| `~/.wbx/codex-home/` + `codex-quota.json` | codex 隔离数据（auth.json **副本**+work/）与冷却态。**不触碰用户 `~/.codex`**——收割是单向只读复制；codex.exe 属 Codex 桌面版自带非本桥安装 | 随 `--purge` 删；或手动删 |
| config 的 lane 键 | `cline-*` 七键、`codex-*` 五键、`doubao-*` 两键、桥自治双键（cline-auto-heal/doubao-autostart） | 随 `--purge` 连 config.json 删；或 `wbx config set <key> ""` 逐键清空 / `false` 关闭 |
| 只停用不删除 | 任一 lane | `wbx config set disabled-lanes '["cline"]'`（路由/回退/fanout 全链路跳过，doctor 标注已禁用） |

**用户自己的 `~/.cline` 不该被桥读写**（隔离在 cline-home 实现）；无需也请不要因本桥清理它。

## 四、UI 进程 / 分发产物 / glm-prompt-crafter

- `wbx ui` 前台进程：关终端/Ctrl+C 即退。`wbx ui --detach` 后台守护：`wbx ui --stop` 停（进程退出、端口释放、状态文件删）。桥已删而进程还在（罕见）：`netstat -ano | findstr :7788` 找 pid 后 `taskkill /PID <pid> /F`，再删 `~/.wbx/run/`、`~/.wbx/logs/` 即净。
- 自启钩子残留（桥已删）：手动编辑 `~/.zcode/cli/config.json`，删 `hooks.events.SessionStart` 里 args 含 `wbx-bridge\scripts\wbx.mjs` 的那条；`hooks` 再无内容可整体删键。
- `wbx export-bundle` 生成的 zip（默认 `~/Desktop/wbx-bridge-v<版本>-<日期>.zip`）是**零凭证**分发包（导出时逐成员比对本地 accessToken 断言过），可随手删或外发；在别处用分包装过的机器：在那台机器跑 `node scripts\wbx.mjs self-uninstall [--purge]`。
- glm-prompt-crafter 用户级部署副本 `~/.zcode/skills/glm-prompt-crafter/`：`Remove-Item -Recurse -Force "$HOME\.zcode\skills\glm-prompt-crafter"` 即完全卸载（纯 Markdown，无进程/网络/系统项）；重跑 `node tools/install-glm-prompt-crafter.mjs` 可重建（SHA-256 校验幂等）。

## 五、凭证与服务端会话

- 本地凭证：WorkBuddy 双 lane（`~/.wbx/sessions|product\{cn,ai}.json` 与项目 `.wbx/` 同名文件，含 accessToken）；cline（cline-home 内 providers.json）；codex（codex-home 内 auth.json 副本）。
- 服务端会话不主动撤销：cn/ai 的 accessToken **约 55 天自然过期**（实测口径）；cline OAuth 以官方为准（失效 doctor 报 Unauthorized，重新 login）；codex 副本失效重收割即可。
- 想立即失效：WorkBuddy 网页版（copilot.tencent.com / www.workbuddy.ai）→ 账号设置 → 退出全部设备；cline/codex 在各自官方账号设置撤销/退出。

## 六、确认不受影响的部分（卸载后自检）

| 位置 | 状态 |
|---|---|
| 桌面版 WorkBuddy 国内版/国际版（`~/.workbuddy`、`~/.workbuddy-ai`） | 只读过 cache，未写入任何文件 ✅ |
| 用户自己的 Cline 状态（`~/.cline`） | **从未读写**（桥的 cline 状态只在 `~/.wbx/cline-home/`）✅ |
| 用户 `~/.codex` | 除 auth.json 单文件只读复制外零读取，绝不回写 ✅ |
| WorkBuddy 安装目录 / `%LOCALAPPDATA%\CodeBuddyExtension` | 未修改 ✅ |
| 系统环境变量 / PATH / 注册表 / Windows 服务 | 从未改动（env 只在 spawn 时注入）✅ |
| ZCode 全局配置 `~/.zcode/cli/config.json` | 未装自启钩子时从未改动；装过则摘除后逐字节还原 ✅ |
| 豆包桌面端（`D:\App\Doubao\` 等） | 只读探测 + 带参启动复用官方调试开关，未修改任何应用文件与用户数据 ✅ |

## 七、只停用、不删除（临时停用）

会话级：正常使用不触发任务即可（分派是行为规则，无后台进程）。项目级：删/注释项目 AGENTS.md 分派段。全局停用：`wbx self-uninstall`（凭证保留）。只停一条 lane：`disabled-lanes` 或删该 lane 凭证文件（doctor 显示 [SKIP]）。默认无常驻进程；装过 `ui --install-autostart`（SessionStart 钩子）先 `wbx ui --remove-autostart`，起过守护先 `wbx ui --stop`。彻底移除安装物=`wbx self-uninstall`（见第〇节）。
