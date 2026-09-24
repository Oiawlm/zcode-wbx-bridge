# UNINSTALL — wbx 联动桥卸载手册（v4：能力外包；兼容 v2/v3 全部形态）

> 原则：v3 起桥有两种形态——**项目形态**（一切都在项目文件夹内，删目录即净）与
> **全局形态**（`wbx self-install` 之后：`~/.zcode/` 四处 + `~/.wbx/` 运行时）。
> 全局形态用 `wbx self-uninstall` 一键还原。两个桌面版 App（WorkBuddy 国内版 /
> WorkBuddy AI 国际版）**从头到尾没有被写入过任何文件**，不受影响。
> v4 说明：新增物只有仓库内 `.zcode/skills/wb-bridge/PROMPTS.md`（worker 提示词模板库）
> 与全局形态同名副本（self-install 自动带上/覆盖，self-uninstall 随目录整体删除）；
> v4 的 fanout `files` 字段与长提示词 stdin 通道不产生任何新的磁盘产物，无需额外清理。

## 〇、全局形态卸载（装过 self-install 才需要）

```bash
# 用全局桥自己卸载（或用项目桥，等价）：
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" self-uninstall          # 移除 ~/.zcode/ 四处，保留 ~/.wbx/ 凭证
node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" self-uninstall --purge  # 连 ~/.wbx/（含两 lane 凭证）一起删
```

移除清单（self-uninstall 自动处理并逐项报告）：

| 位置 | 内容 |
|---|---|
| `~/.zcode/wbx-bridge/` | 桥本体（scripts 四模块 + SKILL.md + PROMPTS.md + examples + docs 副本） |
| `~/.zcode/skills/wb-bridge/` | 用户级 skill（SKILL.md + PROMPTS.md，遮蔽同名项目级 skill） |
| `~/.zcode/commands/wbx.md` | `/wbx` 斜杠命令 |
| `~/.zcode/AGENTS.md` | `<!-- wbx:begin/end -->` 标记块（文件只剩它时连文件删除，其余内容保留） |
| `~/.wbx/` | 运行时：sessions/product **凭证**、config.json、jobs/ 历史（仅 `--purge` 删） |

卸载后项目桥自动回到项目形态（运行时根变回 `<项目>/.wbx/`）。
若全局桥已被手动删除，用下面项目桥路径运行亦可：`node "<项目>\.zcode\skills\wb-bridge\scripts\wbx.mjs" self-uninstall`。

## 一、完整卸载（项目形态：桥 + 双 lane + 分派体系全删）

```powershell
# PowerShell（或资源管理器手动删）
cd "<本仓库所在目录>"   # 即 clone 或解压 wbx 桥的文件夹

# 1. 桥本体（脚本 + Skill）
Remove-Item -Recurse -Force ".zcode\skills\wb-bridge"

# 2. 运行时（含两个 lane 的凭证、config.json、jobs/ 历史、任务缓存）
#    结构：sessions\{cn,ai}.json + product\{cn,ai}.json + config\{cn,ai}\ + config.json
#          + jobs\<jobId>\ + tasks\<时间戳>\ + tmp\
Remove-Item -Recurse -Force ".wbx"

# 3. 项目级常驻指令（若文件里还有非 wbx 内容，只删 wbx 段落）
Remove-Item -Force "AGENTS.md"

# 4. 文档（可选：留着当参考也行）
Remove-Item -Force "README.md","WBX.md","UNINSTALL.md","AGENTS.md","LICENSE"

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

## 三、UI 进程与分发产物

- `wbx ui` 启动的是一个**前台 node 进程**（仅监听 127.0.0.1:7788）：关掉终端 / Ctrl+C 即退，
  **无常驻服务、无开机自启、无后台进程**；卸载不需要任何额外操作。
- `wbx export-bundle` 生成的 zip（默认在 `~/Desktop/wbx-bridge-v4-*.zip`）是**零凭证**分发包
  （导出时逐成员比对本地 accessToken 做过断言），可随手删除或外发。
- 在别处用分包装过的机器：在那台机器上运行 `node scripts\wbx.mjs self-uninstall [--purge]`。

## 四、凭证与服务端会话

- 本地凭证共两处（同一套的两份拷贝，删全局形态默认不动项目侧，反之亦然）：
  `~/.wbx/sessions\{cn,ai}.json` + `~/.wbx/product\{cn,ai}.json`，以及
  `<项目>\.wbx\` 下同名文件——均含 accessToken。
- 服务端会话不主动撤销，cn 的 accessToken **约 55 天自然过期**；ai 的 accessToken 实测
  有效期更长（数百天级）。
- 如想立即失效：登录 WorkBuddy 网页版（copilot.tencent.com / www.workbuddy.ai）→
  账号设置 → 退出全部设备/管理登录会话（可选，两个账号各操作一次）。

## 五、确认不受影响的部分（卸载后自检）

| 位置 | 状态 |
|---|---|
| 桌面版 WorkBuddy 国内版（`~/.workbuddy`） | 只读过 cache，未写入任何文件 ✅ |
| 桌面版 WorkBuddy AI 国际版（`~/.workbuddy-ai`） | 只读过 cache，未写入任何文件 ✅ |
| WorkBuddy 安装目录（如 `%LOCALAPPDATA%\Programs\WorkBuddy*`） | 未修改 ✅ |
| `%LOCALAPPDATA%\CodeBuddyExtension` | 未修改 ✅ |
| 系统环境变量 / PATH | 从未改动（所有 env 只在 spawn 时注入）✅ |
| ZCode 全局配置 `~/.zcode/cli/config.json` | 未改动 ✅ |
| `~/.zcode/` 其他内容 | self-uninstall 后四目标位置零残留（实测），其余未触碰 ✅ |

## 六、只停用、不删除（临时停用）

- 会话级：正常使用，不触发相关任务即可（分派是行为规则，无后台进程）。
- 项目级停用：把项目 `AGENTS.md` 里的分派段落注释掉或删除。
- 全局停用：`wbx self-uninstall`（凭证保留）或只删用户级 skill 目录。
- 只停一条 lane：`wbx config set disabled-lanes '["ai"]'`（路由/回退/fanout 全链路跳过，
  doctor 标注「已禁用」）；或删除对应 lane 的凭证文件（doctor 显示 [SKIP]）。
- wbx 无任何常驻进程/服务/定时任务（`wbx ui` 是前台进程，关终端即退），不删也不耗资源。
