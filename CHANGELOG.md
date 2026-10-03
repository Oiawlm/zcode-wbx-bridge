# Changelog

本文件记录 zcode-wbx-bridge 的版本变更，格式参考 Keep a Changelog。

## 6.6.0 - 2026-10-03

新增（v13 完全 lane 化：豆包桥升格第四 lane，路由/回退/fanout 全进调度体系；授权=用户 2026-10-03 原话「完全lan化，你是规划窗口，给我产出一个给执行窗口的提示词」——三选项（维持现状/半 lane 化/完全 lane 化）中选完全，会员额度由桥自动决定消耗（额度不设上限=2026-09-30 既有裁决）。UI-SPEC contract v1.3.0 → v1.4.0；新增第七套门禁 internal/v13-regression.mjs（52 断言）。改动面：`wbx-core.mjs`（lane 注册/doubaoReady/askOnceDoubao+parseDoubaoPayload/caps/config/doctor 第 8 段/内嵌 AGENTS 块四 lane 化）、`wbx.mjs`（help/login/models 守卫+usage 空计量显示）、`wbx-ui.mjs`（豆包 lane 卡升格/映射表/路由按钮/文案联动）、`wbx-setup.mjs`（描述文案）、AGENTS/README/SKILL/UNINSTALL 文档同步；`wbx doubao` 手工直通零改动（零落盘旁路语义不变，v12.3 定案延续））

### Added
- **doubao 第四 lane**：`LANE_ORDER`/`FALLBACK_ORDER` +doubao（**排最末**——免费优先序不变，v6 ④a/④b 断言天然保持绿）；`LANE_BRAND.doubao='豆包（桌面端）'`；`parseLane` +doubao；`doubaoReady()`（win32 + doubao.mjs 双候选可解析，静态判定对齐 clineReady，CDP 在线性不进 laneReady）；`laneStatusInfo('doubao')` 专用分支（cost=会员额度，model=null，绝不落 IDENTITIES 兜底）。
- **askOnceDoubao worker + parseDoubaoPayload**：spawn `node doubao.mjs ask`（>12k 字符走 `--file` 临时文件 + `--timeout-ms` 透传）；末行 JSON 独立纯函数解析（门禁直测四态）；成功 `{ok:true,text,model:modelAtSend,usage:null,durationMs}`（桌面端无 API 计量，落「无用量记录」诚实口径）；失败 kind=timeout/cli-error + fix-hint（hint=doubao-launch 指向 launch.ps1 与 doctor）。任务级 `--model`/`--effort` 对 doubao 不生效（工具自管理 2.1 Pro·推理高），help/文档如实注明。
- **config `doubao-parallel`**（int 默认 1、min 1 max 2，desc 注明单客户端 UI 串行保护）+ `laneParallelOf` doubao 分支；`default-lane` enum +doubao；`disabled-lanes` 接受 doubao。
- **doctor 第 8 段「通道 豆包（桌面端）· 会员额度 · 可选通道」**：doubao.mjs status 4 态探测（进程+CDP，免费不耗额度；**不做 tiny-ask**——豆包走会员额度，探测性提问也真实消耗，与 ai/cn 段刻意差异化）；未运行/未装=WARN（good:null）不影响 exit 0；laneRows 通路打通（UI 体检卡自动显示）。
- **控制台豆包 lane 卡**：静态 `#doubao-card` 退役，新写 `doubaoCardHtml()` 进 `#lane-cards` grid——4 态探针徽标（复用 /api/doubao 与 loadDoubao 通路）+ 电源开关（data-lane="doubao" 写 disabled-lanes）+ 成本行「会员额度」+ 模型行「豆包 2.1 Pro · 推理高（工具自管理）」+ 调试口 9225 行 + 详情保留 launch.ps1 复制行/分步速查/三处诚实声明全文；路由卡 +「固定 豆包」；调用页 ask 分段器与 fanout 行下拉 +豆包；总览豆包 chip 锚点 `#doubao-card`→`#lane-card-doubao`、title 去「非三 lane」。
- **第七套门禁 internal/v13-regression.mjs**（52 断言）：lane 注册/回退链语义（cline 绝不回 doubao=免费优先、doubao 最末可达）/caps L1×doubao 报错/config enum+doubao-parallel 矫正/parseDoubaoPayload 四态/help 与内嵌 AGENTS 块四 lane/doctor 豆包段两态绿+无 tiny-ask/UI lane 化在案/直通零落盘；不硬依赖豆包在线（WARN 路径绿）。

### Changed
- **caps×doubao 明确报错**：L1/L2 → `caps-lane-mismatch`（豆包桌面 agent 不受桥控、无法承诺只读语义，对齐 cline 先例），绝不静默降档；askOnce 分流在 caps 校验之前（对齐 cline 先例）。
- **双入口语义**（历史语义与 v12.3 翻案自洽）：豆包**调度**任务（`ask --as doubao`/fanout 绑定）走标准 ask/fanout 记录路径进历史（type=ask/fanout、lane=doubao）；`wbx doubao` 手工直通**保持零落盘**（help/AGENTS 块/README/SKILL 全部改写为「手工直通零落盘旁路」双入口表述）。
- **UI 文案联动**：登录页豆包说明卡「豆包不是三 lane 之一」→「豆包已是第四 lane，但登录仍在豆包客户端内自理、桥侧零凭证」（消除失实）；tokens chip 与 hist-count 的 unknownUsage 提示扩「含豆包 lane——桌面端不走 API 计量」；`.cost` 成本徽标第四档「会员额度」（复用 neutral 视觉，UI-SPEC §2/§5.1 三改四随 v1.4.0 登记）。
- **内嵌用户 AGENTS 标记块四 lane 化**（userBlockText）：标题/导语/lane 清单/ask 枚举 +doubao，doubao 行改双入口表述；`wbx --help` 同步（四 lane/回退链 ai→cn→cline→doubao/config 键/doubao 直通行）；wbx-setup /wbx 命令描述与 INSTALL-README 同步。
- **login/models 守卫**：`wbx login --identity doubao`、`wbx models --as doubao` 明确报错指路（豆包无登录流程/无模型清单概念），防 parseLane 放行后误落 cn 分支。

## 6.5.0 - 2026-10-03

回退 + 修复（授权=用户 2026-10-03 第二次反馈原话：①翻案「怎么把我和豆包的聊天记录放进去了？上面还写着"豆包桥接"，这是错误的」；②「没看到豆包的连接或者登录选项……你自己判断一下」（委托判断）；③「免费模型那一行右侧的按钮超出了方框的边界」。改动面：`wbx.mjs`（doubao 直通恢复 v6.3 无痕）、`wbx-core.mjs`（版本号 + tokenTotals 去 doubaoTasks）、`wbx-ui.mjs`（映射表回退/文案清理/登录页说明卡/下拉溢出修复）、internal 契约与门禁同步、运行时 type=doubao 数据清理（2 个 job 目录，隐私清理只报 jobId）；三 lane 行为零变化）

### Changed
- **豆包直通恢复 v6.3 无痕行为（翻案 6.4.0「豆包桥接进历史」）**：删除 `wbx doubao ask|send|read` 的 job 记录落盘（`DOUBAO_RECORDED_SUBS`/`writeDoubaoJob`/stdout 捕获-回放分支全移除），恢复纯 `stdio:'inherit'` 直通——任何子命令输出与退出码不变、零落盘副作用；子命令解析、目录双候选解析、fix-hint 报错不动。历史页语义定案=外部算力（三 lane）调度记录。
- **UI 契约 D2 回退**（UI-SPEC §6 v1.3.0，token 键集零改动）：TYPE_LABEL/LANE_LABEL/LANE_TITLE 回 v6.3 形态（枚举收回 `doubao`）；ui-contract FROZEN_TYPE_KEYS 与 v7 ⑤c/v8 ④a 断言同步；`tokenTotals()` 去 `doubaoTasks`（in/out 与 unknownUsage 口径不变）；历史页底部提示/tokens chip title/hist-count 合计行与 title 去豆包表述（保留累计 tokens in/out 与 unknownUsage 提示）。
- **运行时数据清理**：删除现存 type=doubao 的 job 目录 2 个（隐私清理，只报 jobId 不读取内容）。

### Added
- **登录页豆包说明卡**：登录页 Cline 折叠卡之后新增「豆包（桌面端）」说明卡——无需在此登录（登录态在豆包客户端内自理，桥侧零凭证），桥只需要豆包以调试口 9225 运行 + launch.ps1 复制行 + 指路「状态」页豆包桥工具卡看连接探针；内容级增删（UI-SPEC §5.2/§5.4），零新端点、零服务端进程拉起、不造假登录按钮。

### Fixed
- **Cline 免费模型下拉溢出**：`#cline-free-select` 内联 `min-width:220px`（CSS 规范 min-width 优先于 max-width，宽屏三列布局下撑破通道卡）改 `min-width:0;width:100%`——随列收缩、占满所在列；1280/~800 两档视口展开详情均无溢出，切换写 config cline-model 功能回归正常。

## 6.4.0 - 2026-10-03

新增（全盘联动同步 + 控制台四项体验修复；授权=用户 2026-10-03 全盘扫描指令与四项前端反馈原话「历史记录里边……点一下……左右两边可能会胀开」「豆包的桥接怎么放在最下面了」「历史记录里面怎么没有豆包的桥接」「可以加入总 token 数」。改动面：`wbx-core.mjs`（版本号 + tokenTotals）、`wbx.mjs`（doubao 结果型子命令落历史）、`wbx-ui.mjs`（历史表 fixed 布局/豆包卡上移/总览与历史 token 合计/doubao 类型渲染）；三 lane 行为零变化）

### Added
- **累计 token 用量统计**：core 新增 `tokenTotals()`（与 job 列表同源遍历，含旧版兼容目录；usage 字段按 usageOf 同款回退兼容旧格式），`/api/status` 与 `/api/history` 附带返回；控制台总览条新增「累计 tokens in/out」chip（点击跳历史页），历史页右上角显示合计 + 豆包桥接次数（桌面端不走 API 计量，单列不计入 in/out）+ 旧格式无用量记录数。
- **豆包桥接进历史**（UI 契约 D2 变更，UI-SPEC §6 v1.2.0）：`wbx doubao ask|send|read` 执行后落 job 记录（type=doubao，manifest/tasks-input/record 三件套与回放兼容），stdout 捕获后原样回放、退出码透传不变；status/new-task/configure/help 不落记录；历史类型列显示「豆包桥接」，详情 Token 数显示 `—`（无 API 计量）。ui-contract FROZEN_TYPE_KEYS 与 v7 ⑤c/v8 ④a 断言同步扩展。

### Fixed
- **历史页「点开胀开」**：行内详情行（colspan=5）在 auto 表格布局下参与列宽计算，点击含长内容的记录后整表横向溢出（实测 1017→1605px）。修复：历史表改 `table-layout:fixed` + colgroup 定宽 + 详情行 overflow 收口 + `.md` overflow-wrap。实测最长记录溢出 0px。
- **豆包桥工具卡位置**：从状态页最底部上移至通道卡之后、路由卡之前（用户反馈「怎么放在最下面」）；总览条新增豆包状态 chip。
- **跨文档联动同步**（全盘扫描发现）：README 命令表/caps 节补 v6.2/v6.3 内容（doubao、--caps/--max-turns、caps-l1-max-turns）+ FAQ cline 凭证路径修为 cline-home；UNINSTALL 标题口径/桥本体系目（去 SKILL.md 补 doubao/）/zip 命名/cline 路径两处；SECURITY cline 凭证路径；CONTRIBUTING 白名单补登 UI-SPEC/wbx-daemon.mjs/knowledge/豆包桥四组 + 零依赖表述加豆包例外 + cline 计价示例换免费孪生口径；SKILL 速查补 --max-turns/maxTurns/caps-l1-max-turns/export-bundle；AGENTS 调用入口补 self-uninstall/doubao；wbx-setup 安装清单去 PLAN.md 死引用 + INSTALL-README 桥本体系目修正；launch.ps1 内部文档引用改可达路径。

### Chore
- 仓库卫生：internal/ 124 个一次性产物按版本轮归档 internal/archive/{v6..v12,docs}/（治理与门禁工具留顶层）；删除运行时残留（ui-baseline.pid/log、临时回归输出、发布 zip、v10-before-ui/、v12-staging/、对照截图、config 快照）；删除项目内 .wbx/（项目形态时期运行时残留，含 2.3 万文件 CLI config 与旧凭证；现行运行时在 ~/.wbx 不受影响）；.gitignore 追加 .zcode/plans/。

### 实证与回归
- 六套门禁全绿：v6 24/24 + v7 27/27（⑤c 枚举 +doubao）+ v8 22/22（④a 枚举 +doubao）+ v11.3 38/38（含 cline 真机）+ ui-contract 23/23 + v9 红测全绿（含恢复自证）。
- 真机验证：`wbx doubao read`/`status` 直通输出与退出码不变（read 落 job、status 不落）；控制台四项修复逐一实测（历史点击溢出 0px、豆包卡就位、豆包记录渲染、token 合计展示；全历史实测 tokens in 15,432,702 / out 1,812,749）。

## 6.3.0 - 2026-10-01

新增（豆包桥并入 wbx 全局形态·全项目通用；授权=用户 2026-10-01 原话「你现在立马给我把豆包桥也做成一个全项目通用的……你把它给我放进去啊（WBX 桥里）……所有的项目都能够更高效率的去运作」。改动面：`wbx.mjs`（doubao 直通子命令）、`wbx-setup.mjs`（self-install/uninstall 携带 doubao/）、`wbx-ui.mjs`（豆包卡文案全局化）、`wbx-core.mjs`（版本号 + AGENTS 标记块速查行）；三 lane 行为零变化，L0 参数序列逐字不变）

### Added
- **`wbx doubao <doubao.mjs 子命令与参数…>` 直通子命令**：在 parseArgs 之前拦截、参数原样转发（豆包旗标集 `--cdp-url/--wait-ms` 等与 wbx 解析器不兼容，混用会误报未知参数）；usage/退出码/单行 JSON 输出均由 doubao.mjs 自理（无参=usage+exit 1，不挂起）。目录解析：全局 `~/.zcode/wbx-bridge/doubao/` → 仓库 `tools/doubao-bridge/`，双 miss 明确报错并给 self-install 修复指引（可选工具，绝不影响三 lane）。
- **self-install 携带豆包桥**：`tools/doubao-bridge/` 整目录复制到 `~/.zcode/wbx-bridge/doubao/`——先 rm 旧副本再复制（防 node_modules 陈旧残留），装完即验 `doubao.mjs`/`anchors.json`/`launch.ps1`/`node_modules/playwright-core` 四要素，缺一即 WARN 并提示手动整拷；源缺失/复制失败只 WARN 不阻断安装。`self-uninstall` 随桥本体一并删除（报告标签明示含 doubao/ 副本，无新增独立清理项）；export-bundle 分发包仍不含豆包（Windows 本机可选工具，有意排除）。
- **用户 AGENTS.md 标记块与控制台豆包卡速查全局化**：速查命令改为全局入口形态（`wbx doubao status|ask …` + launch.ps1 的 `%USERPROFILE%` 路径，注明 PowerShell/Git Bash 变量替换）——装过 self-install 的任何项目会话可直接发现与调用；UI 卡为内容级文案改动（UI-SPEC §5.2/§5.4 放行，不触发 FROZEN 2.7，contract v1.1.0 不变）。

### 补记
- v12（豆包桌面桥工具 tools/doubao-bridge/ 四件套，commit 9536d59）与 v12.1（控制台豆包工具卡，commit 9fe18e9）两个交付当时未在 CHANGELOG 立条目，随 6.3.0（v12.2 并入全局形态）一并官宣补记；技术细节见 WBX.md v6.3 章与 UNINSTALL §八。

### 实证与回归
- 既有六套门禁零回退：v6 24/24 + v7 27/27 + v8 22/22 + v11.3 38/38 + ui-contract 23/23 + v9 红测全绿（含恢复自证：源文件哈希=基线）。
- 全命令回归（v6.3.0 真机）：--version/--help/doctor（--no-probe）/models --as cline --free/config list/history/ask（cn 真机）/fanout 2 任务 2\2/ui --status/export-bundle（v6.3.0 zip，零凭证断言通过）/doubao 直通（仓库形态 status 实连 CDP 9225 成功）。
- T7 评审（wbx ask 外包，ai 超时自动回退 cn 交付，87.1s）：**0 阻断 / 5 建议**——采纳 3 已修（① doubao 子进程 close 只透传退出码、不重抛同名信号，防非 POSIX 信号名 ERR_UNKNOWN_SIGNAL；② self-install 豆包复制加四要素装完即验；③ HELP/标记块启动路径统一 %USERPROFILE% 粘贴即用形态——顺带修复 wbx-ui.mjs 模板字符串里单反斜杠被转义吞掉的断路径隐患，已按文件既有约定双写），验证 2（全仓无 6.2.0 残留硬编码；doubao.mjs 无参=usage+exit 1 不挂起）。记录 `internal/v12.2-t7-review.txt`（gitignored）。

## 6.2.0 - 2026-09-30

新增（两项缺陷修复：授权=用户 2026-09-29「三点偏离有什么需要修复的你帮忙看看」委托一号纳入 v11.3；契约 A/B 逐条对照见 `internal/v11.3-t7-review.txt` 与 [WBX.md](WBX.md) v6.2 章。改动面：`wbx-core.mjs`（主）、`wbx.mjs`（--max-turns 旗标+help）、`wbx-ui.mjs`（两端点透传）；L0 参数序列逐字不变）

### Changed
- **L1 缺省回合上限 8→24**（契约 A）：v11.1 失败潮 + v11.2 P3 复现（job 20260929-224047-4hz）实证 8 回合不够典型联网调研——探针恰 8 次推理贴线通过、多轮任务耗尽后 CLI exit 0 无 JSON 静默失败（v11.1 unparseable 主因）。L0 无回合概念零影响（`--max-turns 1` 序列逐字不变，回归 ②e 断言）。

### Added
- **任务级 maxTurns 字段**（契约 A）：ask `--max-turns N` / fanout 任务 `"maxTurns":N` / UI 调用页端点透传三入口；整数 1-64，仅 caps L1 生效（×L0 明确报错不静默——对齐 caps 契约风格）；三层取值：任务级 > config 新键 `caps-l1-max-turns`（int 1-64，缺省 24，非法值容错回退）> 硬缺省 24；随 tasksInput 落盘可追溯。
- **l1-turns-exhausted 失败分类**（契约 A）：识别 stderr 的 `Max turns (N) exceeded`（仅 L1 分类），可读错误含指引（加任务级 maxTurns 或调 config caps-l1-max-turns；实际超时秒数插值显示，600s 仍为硬兜底先到为准）——不再落入 unparseable 静默形态；v6.1 P1 的 attempt 全量落盘行为不变。

### Fixed
- **isAuthError 回显假阳性**（契约 B，E-005 桥侧同源修复）：auth 判定从「combined 全文正则」收紧为「CLI 退出码非零 + stderr 中 CLI 自身错误行」结构化信号——worker 输出/材料回显的凭证类字样（stdout/transcript 中的 "Authentication required"、"Unauthorized" 等）一律免疫（原 bug：job 20260925-115826-idp 成功输出复述样例原文被误判凭证过期，ai/cn 双 lane 误杀）。真实凭证错误（退出码非零 + stderr）仍判 auth（kind/hint=login 保留）；cline lane 保留 NDJSON 结构化错误事件判定（parsed.error 为 CLI 自身信号，真实 auth 快速失败可能 exit 0 仅带 error 事件，不门控）。

### 实证与回归
- 新增 `internal/v11.3-regression.mjs` 38/38 全绿（离线 37 项：parseMaxTurns/resolveL1MaxTurns 单元断言、假 CLI argv 落盘验证三层取值与 L0 零回退、maxTurns 校验/caps 匹配错误契约、回合耗尽分类、回显免疫成功/失败双路径、真实 auth 保留；真机 1 项：cline lane 材料回显凭证字样任务正常完成不误判，5.4s）。
- 既有回归零回退：v6 24/24（v11.3 起 cline 已上线，原两项环境依赖 FAIL 转绿）+ v11.2 25/25 + v7 27/27 + v8 22/22，五套共 136 断言全绿。
- T7 评审（wbx 外包，材料=契约+diff+实现者自述，经 ai 超时回退 cn 交付）：**0 阻断 / 7 建议**——接受 3（l1-turns-exhausted 加 L1 门控；错误文案超时插值；24 常量三处统一引用）已修并复验全绿，驳回 3 有据（cline parsed.error 不门控：防漏检 exit 0 的真实 auth；maxTurns×L0 报错维持设计定案；重试短路超契约授权记下轮提案候选），1 项验证无影响（旧导出符号全仓零引用）。评审材料本身含 "Authentication required" 字样且未误判——契约 B 获实战验证。记录 `internal/v11.3-t7-review.txt`（gitignored）。
- 环境注记：本机 npm 全局 prefix 为 `~/.npm-global`（不在 PATH），cline 平台 exe 经桥 config `cline-path` 显式解析（不改系统环境变量）。

## 6.1.0 - 2026-09-29

新增（桥报错观测修复 P1+P3：授权=用户 2026-09-29 裁决「授权 P1+P3，P2 不做」；改动仅 `wbx-core.mjs` 单文件 +44/−10，成功路径解析/落盘/exit 语义/既有字段零改动，cline lane 解析路径零触碰）

### Added
- **失败 attempt 完整输出落盘**：任一 attempt 失败（含同 lane 重试与跨 lane 回退的每次失败）时，该次完整 combined（stdout+stderr）写入 job 目录 `<taskId>.attempt<N>.output.txt`；成功路径零新增落盘。失败返回值新增 `combined` 字段（只增不改名），落盘与指针由 runAskJob/runFanoutJob 统一经 `dumpFailedAttempt` 执行——落盘写失败仅告警不中断（诊断绝不影响主流程）；无进程输出的失败（caps 拒绝、未安装等）不落盘。
- **错误消息尾部文件指针**：`（完整输出已存 <jobDir>/<taskId>.attempt<N>.output.txt）`，`wbx history` 回放者可直接定位（history 全文打印错误，指针可见）。

### Changed
- **unparseable/cli-error 的诊断 brief 改首尾各半**：combined 超 320 字符时由「头部 320 截断」改为「首 160 + 尾 160 + `…(省略 N 字符)…`」（新增 `errorBrief()`，仅用于该两类失败错误文本；既有 `brief()` 行为与其余展示路径零回退）。背景：combined 常以约 300 字符环境横幅开头，真实错误在尾部——旧截断在实测失败形态（combined 412 字符）下恰好把真因 `Max turns (8) exceeded` 整个吞掉。

### 实证与回归
- **P3 复现直接翻案**：glm-prompting 原词 L1 单发 ai/cn 双 lane 同因失败，P1 全量落盘实证 stdout 空、stderr=横幅+`Max turns (8) exceeded`——v11.1 假设⑤（L1 `--max-turns 8` 耗尽静默失败）由「部分证伪」翻转为**证实主因**；9/28-9/29 失败潮形态一致。归档 `internal/v11.2-repro-output.txt`（gitignored）。
- 回归：新增 `internal/v11.2-regression.mjs` 25/25 全绿（errorBrief 首尾各半/空输出判别/attempt 落盘与指针/history 回放/成功路径零变化——WBX_HOME 沙箱 + WBX_CLI 假 CLI 全离线）；既有 v6-regression 与改动前基线结果完全一致（22 PASS/2 FAIL，两项失败为 cline 未装时 doctor 跳过免费模型校验的既有环境依赖项，非本版引入）。
- T7 评审（wbx 外包，材料=契约+diff）：0 阻断 5 建议——接受 2（限流判定先于落盘防指针文本污染；落盘 try/catch 防诊断失败中断主流程）已修并复验全绿；驳回 3 有据。记录 `internal/v11.2-t7-review.txt`（gitignored）。

## 6.0.0 - 2026-09-25

新增（两大特性：**caps 能力分级**（L0/L1/L2 显式契约）+ **历史页行内详情**；授权=用户 GOAL-V10 原话「我们要尽可能最大限度地发挥它们的性能，只要有需要，就可以让它们使用工具、联网」+「我点击一个条目，希望它的详细内容直接出现在条目下方，而不是要翻到界面最底下」。改动面：`wbx-core.mjs`（caps 管道+config 键+doctor 步）、`wbx.mjs`（--caps 参数+轨迹打印）、`wbx-ui.mjs`（行内详情+caps 三件）、[PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md) v3、[SKILL.md](.zcode/skills/wb-bridge/SKILL.md)、[AGENTS.md](AGENTS.md)、[UI-SPEC.md](UI-SPEC.md) v1.1.0、[WBX.md](WBX.md) v6.0 章、[README.md](README.md)、[UNINSTALL.md](UNINSTALL.md)。L0 路径参数序列字节级不变）

- **caps 能力分级（worker 契约升级）**：三 lane worker 从「永远纯文本端点」升级为显式能力契约——
  - **L0（默认）**：纯文本无工具，与 v5 参数序列字节级一致（`--tools '' --max-turns 1`），v6 门禁 24 条含字节级不变断言 + L0 冒烟 job 复证，零回归。
  - **L1（联网+只读，仅 WorkBuddy AI/国内版）**：白名单工具 `WebSearch,WebFetch,Read,Glob,Grep` + `--permission-mode default`（四模式实测最小特权面）+ `--max-turns 8`；每任务 scratch 工作目录（`~/.wbx/scratch/<任务id>/`，越 cwd 绝对路径读取进程级 DENIED——探针 p2c 实测）；缺省超时上浮 `max(600s, timeout)`；工具轨迹（counts+samples）落任务记录、完整转录存 `<任务id>.transcript.json`（不计入 history 任务数）；L1 任务固定 ai/cn（回退链自动滤掉 cline）；CLI `ask --caps L1` / fanout 任务级 `"caps":"L1"` / UI 调用页 caps 选择器三入口齐备。如实声明：WebFetch 在 default 权限档被拒，联网主力是 WebSearch（PROMPTS E-012）。
  - **L2（受控全能力，仅 cline）缓期未交付**：Phase 0 检测级证据——cline 3.0.65（npm latest stable）二进制无 `CLINE_COMMAND_PERMISSIONS` 字符串，deny:`["*"]`/deny:`["node *"]`/docs 示例 allowlist 三组全失效且 `del` 实删文件 → 六层防护栈（白名单工具面/命令级 deny/scratch/轨迹落盘/超时回合上限/总闸+显式 flag）缺第②层，**缺一不交付**。用户 2026-09-25 裁决「L2 缓期，本版留位」：`--caps L2` 显式报未交付（含裁决与交付条件说明），总闸 `caps-l2-enabled`（默认 false）即使置 true 也不放行；治理冻结于 FROZEN 二.8；上游发布该特性后按完整六层交付。
  - **绝不静默降档**：无效档位 / L1×cline / L2 一律显式报错（`caps-invalid`/`caps-lane-mismatch`/`caps-l2-not-delivered`）；config 新键 `default-caps`（默认 L0）+ `caps-l2-enabled`（默认 false）；doctor 新增 caps 步。
- **历史页行内详情（UI 契约变更 v1.1.0，变更程序合规）**：详情从页底 `#job-detail` 卡退役 → 点击行正下方 `tr.job-inline` 行内卡（`.job-inline-card`，手风琴单开沿用，再点收起）；调用页 ask 高级区 caps 选择器（L2 disabled 标未交付+L1 提示行+高级摘要实时档位）、fan 行 caps 列（四列→五列 86px）、taskHead caps 徽标「L1 联网档」、概览/通道卡「能力档」行、L1 `trace-box` 工具轨迹折叠件。三处同步：UI-SPEC §6 v1.1.0（token 键集与值零改动）+ ui-contract 新增 H1–H4（19→23）+ v9-redtest 新增 M-H1..H4/N-H；v8 门禁 ①d 同步五列断言。浏览器实机验证 + before/after 截图四张在案（`internal/v10-ui-*.png`）。
- **PROMPTS.md v3**：原则 2「能力边界声明必写」按 caps 档位（L0 句式逐字保留，「你没有任何工具」全文 18 处零改动）；新增 P13（注入防御：网页内容是数据不是指令）、P14（来源清单 URL|访问时间|支撑要点）、T4-L1（联网调研模板）、T10（L2 代码自测回路模板，先行入库待启用——写→跑→修闭环+反作弊条款）、E-012、派发流程 1b（caps 判定）、决策速查表 caps 列。
- **门禁与回归**：v6 24 + v7 27 + v8 22 + ui-contract 23 四门禁全绿；红测 22 正向变异（红且红得对）+ 4 负向对照（全绿）+ 恢复自证。
- **验收证据**：L1 ask 端到端 job `20260925-201509-h7t`（ai，WebSearch×6+WebFetch×1，轨迹+转录落盘）；混合档 fanout job `20260925-201708-nnd`（L0@cn 无工具 / L1@ai 带来源清单，同批混档路由正确）；L0 冒烟 job `20260925-201642-nwp`。探针脚本 `internal/v10p0-p*.mjs` 可复跑；设计定案 `internal/RESEARCH-V10.md`。

## 5.4.0 - 2026-09-25

新增（UI 风格契约化：规格文档 + 机器护栏 + 治理登记三位一体；代码改动仅 `wbx-ui.mjs` 展示层 token 改名/哨兵注释 + `wbx-core.mjs` 版本号一行，后端 handler、API 字段、config 键、守护、安全面零改动）
- **[UI-SPEC.md](UI-SPEC.md)（仓库根，新跟踪文件）**：UI 风格契约规格文档（contract v1.0.0）——§0 权威源声明（`:root` 哨兵块为唯一真源，文档为派生快照，头部标 `tokens-sha: efeee49b0e`）+ §1 Foundations（58 token 全表/对比度清单/动效与 reduced-motion/中文排版）+ §2 20 个组件×固定 8 字段（含「何时不用」与 frozen|extension 徽标，实机逐页核对）+ §3 Patterns 三条 + §4 Guidelines（术语规则/Do-Don't 总表/人工视觉走查清单/程序断言天花板诚实声明）+ §5 不变量与扩展点（5 条判定规则+一句话判据「会不会让无关页面的截图 diff 变化」+contract version 语义+变更程序，**契约主体**）+ §6 变更记录。
- **token 语义化改名**（趁零消费方窗口，冻结前一次性改诚实；值不变、视觉零变化）：`--acc-300`→`--acc-text`（淡底上主色文字）、`--acc-600`→`--acc-hover`（主色 hover）、`--panel2`→`--panel-inset`（嵌在面板内的次级面）；全站 17 处消费方同步；`:root` 加 `/* @tokens:begin */`/`/* @tokens:end */` 哨兵注释对（宣告唯一真源，改动须同步 UI-SPEC 并过 ui-contract）。改名映射在本条目记录；CHANGELOG 5.3.0/WBX.md v5.3 章中的旧名是历史记录，保留不改写。
- **机器护栏 `internal/ui-contract.mjs`**（工程内部件，gitignored）：19 条断言（编号枚举 T1-T5/C1-C6/S1-S4/D1-D4；worker B 报告标题称 18 条但其枚举即 19）——token 键集双向差集快照（T1）、全 58 token 值逐值归一化快照（T2，T7 二审后从状态色 17 值扩展）、刻度单调（T3）、哨兵块外零新增 hex（T4，既有 4 处入白名单冻结）、四态色两两不等（T5）、关键类存在（C1，选择器空白容差）、表格容器包裹（C2）、无超宽像素（C3）、1100px 正文容器（C4）、零外链（C5）、切片保活（C6，且 T4/C3/C5/D4 加保活前置防空转绿——T7 二审采纳）、形状双编码四类各异（S1，比规则体防恒不同空转）、到期色阶阈值 0/7/30 冻结且有序（S2）、状态标签映射冻结且全覆盖（S3）、aria-expanded 双件（S4）、品牌/术语/四页签标签冻结（D1）、type 英文枚举（D2）、job 字段超集（D3）、alert 零命中+toast 常驻（D4）。与 v6/v7/v8 回归并存不合并（v8 守行为零回退，contract 守设计系统契约），发布门禁串行全跑。
- **红测协议**（`internal/v9-redtest.mjs`，验收硬门）：18 个正向变异（每族抽样，含 `d<=7` 改 `d<=8`、token 值改一位、删关键类、翻状态映射、切片正则失效）全部红且红在预期断言；3 个负向对照（改文案/加空行/调 CSS 属性顺序）全部仍绿（防脆断）；恢复由脚本自证（源文件哈希=基线+重跑全绿）。矩阵落 `internal/v9-redtest-matrix.md`。
- **治理登记**：`internal/FROZEN.md` 追加「UI 契约冻结」项（冻结范围=UI-SPEC §5.1 不变量清单；变更程序=用户显式授权+同步三处+红测重跑+四门禁全绿；注明 2026-09-25 用户授权原话）。README 增一句指向 UI-SPEC.md。
- **视觉零变化验证**：改名前后浏览器实机 9 组对照截图（状态/调用/历史/登录/toast/运行中/停用态/体检中/体检结果，1280×900 同视口）；「调用」页逐像素一致；其余差异经三重负向对照（同代码连拍 0 像素差、同代码双 reload 0 像素差、**旧代码 vs 旧代码跨渲染会话 0.619%>改名对 0.293%**）证明全部为环境级光栅化噪声或已知动态内容（体检「上次 N 分钟前」时间戳/体检时长数字/历史表新增行/呼吸动画相位），与改名无关。

说明
- 零依赖零外部资源红线保持；术语表 v5.2 冻结不动；v5.2/v5.3 行为零回退：v6 24 + v7 27 + v8 22 + contract 19 四门禁全绿 + 全命令冒烟通过。
- 自举（wbx 外包，材料先行，逐份校验后采用）：规格 §1/§2/§4 初稿三路并行（job `20260925-180829-lxf` 3/3）+ 改名 diff 评审批判（`20260925-180410-ax5`，无阻塞意见；panel-inset 语义争议记录不采纳）+ 护栏断言清单二审（`20260925-182119-pag`，采纳 4 条：T2 扩全量值+归一化/C1C2 空白容差/sliceAlive 前置/红测补 M-C3；不采纳 3 条记录在案）。
- 设计依据与裁决见 `internal/RESEARCH-V9.md`（P0-P4 定案）；三份外部调研沉淀 `internal/v9-worker-*.md`。

## 5.3.0 - 2026-09-25

新增（只动展示层：后端 handler、API 字段、config 键、守护、安全面、术语表全部零改动）
- 控制台「产品化」改造：从「字段平铺的调试页」重排为「3 秒回答三个问题（一切正常吗？哪里不对？我现在能干什么？）」的产品级界面。信息架构重排 + 视觉系统升级，全部改动限于 `wbx-ui.mjs` 的 HTML/CSS/前端 JS。
- 状态页：新增**健康总览条**（结论句「N/3 通道可用 · 路由」+ 三枚通道 chip，chip 带四态形状色并锚点跳转通道卡，全绿时显示「一切正常」）；通道卡瘦身同构（卡头=品牌全称+状态徽标+账号+电源式停用开关；扫读层 3-4 行=成本三档徽标/模型/凭证到期色阶/cline 免费组信号；endpoint、二进制路径、模板、思考压缩、登录方式全部收进「详情与排障」折叠层）；**异常通道置顶**（四态×到期复合严重度排序）；路由卡只剩 4 选段器+生效说明（停用开关移入通道卡，矛盾组合行内黄条提示）；体检卡空态三要素（尚未体检+上次时间戳[localStorage]+CTA）与结果三分组（失败红默认展开+复制/跳过灰/通过绿，组头计数徽标，删大段 pre）。
- 状态编码系统（全站统一）：凭证到期色阶四档（>30 天绿弱化 / 8-30 天 ▲黄 / 1-7 天 ▲橙 `--warn2` / ≤0 ■红+「重新登录」内联动作）；可用四态形状+颜色双编码（●可用/▲降级/■不可用/○已停用；未安装=虚线环；进行中=空心环呼吸动画，`prefers-reduced-motion` 静态降级）；成本三档统一徽标（免费/近免费/免费·限时配额，原始口径进 title）。
- 视觉系统 token 化：间距 s1-s6/圆角三档+pill/字阶+行高/阴影三档/过渡+缓动全部 CSS 变量化（基线 `internal/worker-dark-theme-tokens.md`，含三处对比度修正落地：acc 淡底文字 `--acc-300`、12px 微文本 `--dim-hi`、控件边界 `--line-ctrl`）；组件规范落地（键值行 96px+minmax(0,1fr)+ellipsis+title+tabular-nums、卡头、段标题左色条、表格 sticky 表头+行 hover+数字右对齐无斑马纹、深色表单聚焦环+纯 CSS select 箭头、按钮三档 primary/ghost/danger、电源开关、分段器）；5 个产品感手法（卡片悬浮微抬升[包 hover:hover]、tab 下划线动效、等宽数字、进行中呼吸、滚动条着色）。
- 调用页：单卡+模式分段器（单条调用（ask）/批量并行（fanout））；思考档/模型/超时与并发/超时收进「高级」折叠（标题右侧显示当前值摘要）；结果卡徽标行+markdown 默认 6 行截断可展开+错误框带复制。
- 历史页：类型列徽标化、数字列右对齐 tabular-nums、通道分布移入详情、任务 ID 列窄化+点击复制（CLI 回放入口保留）；详情手风琴单开（点新收旧），内分概览→任务→产物三段。
- 登录页：WorkBuddy 两按钮上下分组（轮询时按钮 disabled+内联 spinner+文案，删独立状态大块）；cline 命令行引导卡下沉折叠（默认收起）+一键复制。
- 全局交互：右下角 toast 组件（info/success 4s 消失、error 常驻+关闭钮）替代全部 `alert()`；折叠元素带 `aria-expanded`（动态渲染同步初始化）；数据加载失败兜态（总览条区域显式报错+重试）。

修复
- 登录页 cline 命令展示丢反斜杠（v5.2 存量展示 bug）：模板字符串内未知转义序列吞掉 `\`，命令显示为 `%USERPROFILE%.zcodewbx-bridgescriptswbx.mjs`，复制即坏命令；v5.3 以 `\\` 源级转义修正，现显示完整路径。

说明
- 零依赖零外部资源红线保持：无框架/CDN/字体/图标库/构建步骤，图标用纯 CSS 形状，单文件 HTML 内嵌，离线可用。
- 回归门禁：新增 `internal/v8-regression.mjs`（22 断言全过：横向滚动结构保障/alert 零命中/术语冻结/数据层零改动/v5.3 专断言）；v7 回归 27/27（⑤ 展示层断言一字未改即过）、v6 回归 24/24、全命令冒烟通过（doctor/ask/fanout/models/config/history/ui 四参数/export-bundle）。
- 设计依据与被否决备选见 `internal/RESEARCH-V8.md`；施工图 `internal/v8-blueprint.md`；T7 评审采纳 9 条（chip 复用四态形状、排序键闭合、`--warn2` 橙 token、进行中改空心环、未安装虚线、toggle 捕获监听、异常内联 CTA、加载失败兜态、结论句拆降级计数），否决 1 条（免费模型下拉位置维持 RESEARCH-V8 定案：留在详情层+「切换」快捷链接）。

## 5.2.0 - 2026-09-25

新增
- 控制台守护化：`wbx ui --detach` 幂等拉起后台守护进程（已有健康实例永远复用、绝不新起）；`--stop` HTTP 优雅关闭优先、kill 兜底（绝不误杀无法证明归属的 pid）；`--status` 三态（运行中/残留可自愈/未运行）。状态文件 `~/.wbx/run/ui.json`（pid/port/startedAt/token/version），三条件判活（状态文件 + `kill(pid,0)` + `/__health` pid 匹配）加 `startedAt` 跨重启判废，陈旧状态自动清理自愈；日志 `~/.wbx/logs/ui.log`（启动前 >2MB 轮转保留一代，守护内每小时检查 >10MB 截断）。
- 随 ZCode 会话自启：`wbx ui --install-autostart` 对 `~/.zcode/cli/config.json` 读-改-写合并写入 SessionStart 钩子（`type:process` 参数向量，指向全局形态脚本，`timeoutMs 5000`）；绝不删除/改写既有键，按 command 路径幂等去重；`hooks.enabled` 仅在我们引入首个配置钩子时置 true（marker 记录），`--remove-autostart` 摘除后逐键还原（实测 diff 逐字节一致）。钩子命令实测冷启动 ~0.5s、复用 ~0.15s。注意：是「新开 ZCode 会话时拉起」，非系统级开机自启（不装服务/不写注册表/不动环境变量）。
- 安全校验（前台/守护一律生效）：Host 头白名单（仅 `127.0.0.1`/`localhost`，防 DNS rebinding）、POST 端点 Origin 校验、`POST /__shutdown` 随机 token 时序安全校验；新增 `GET /__health`。
- UI 全面中文化与命名统一（仅展示层，数据层/API 字段/config 键零改动）：历史类型 ask→单条调用、fanout→批量并行、legacy→「旧版·」前缀；状态词 success→成功、failed→失败、done→已完成；PROMPT→提示词、effort→思考档、tokens→Token 数；通道命名统一为品牌公式 WorkBuddy AI（国际版）/WorkBuddy（国内版）/Cline CLI（卡片全称），窄栏位用短称，界面不再出现裸 lane/ai/cn/cline。doctor 人读输出通道段同步品牌全称（机器可读输出不动）。
- UI 补齐 v5.1 超额错误的友好提示（免费额度用尽/促销结束/模型被轮换三类，与 CLI `hintText` 同源语义）。

修复
- UI 登录并发竞态：`/api/login/start` 改为先占位 pending 再执行（防双登录流 TOCTOU）。
- `/api/config` 配置键白名单改自有键判定（防原型链键名绕过）；`/__shutdown` token 比较改字节长度对齐（防多字节输入 500）。

变更
- 裸 `wbx ui` 行为：守护进程已在跑时打印 URL + 开浏览器 + 退出，否则维持前台模式（v5.1 行为不变）。
- 端口被外程序占用时明确报错、不换端口（固定 7788 是可记网址的锚点）。
- self-uninstall 卸载顺序新增：先停守护进程、摘自启钩子，再删文件（一键还原承诺不变）。

说明
- 纯函数模块（状态解析/判活决策/Host·Origin 校验）经 best-of-N 双份并行 + 评审批判择优集成，契约测试 72 断言全过；钩子合并/还原 24 断言全过（含模拟存量 hooks 场景）。
- Windows 行为实测：`kill(pid,0)` 死 pid 报 ESRCH、`wx` 跨进程互斥恰一赢家、listen exclusive 跨进程 EADDRINUSE、detached+windowsHide 后台存活。

## 5.1.0 - 2026-09-25

新增
- cline lane 默认免费调用 DeepSeek V4.1 Flash：默认模型切为免费孪生 `cline-free/deepseek-v4.1-flash`（totalCost=0，实测 20+ 次）。机制：Cline 按模型 id 计费，同一模型有计费 id 与 `cline-free/` 免费孪生两个 id；免费=限时促销轮换+每日用量配额（官方口径）。v5「CLI 侧无免费模型」结论勘误（详见 WBX.md v5 章勘误与 v5.1 章）。
- 存量一次性迁移：仅当 config `cline-model` 恰为 v5 计费孪生 `deepseek/deepseek-v4.1-flash` 时自动改写为免费孪生并打印 `[MIGRATE]`；显式设置的其他值不动。
- `wbx models --as cline --free`：列当前免费模型组（`GET api.cline.bot/api/v1/ai/cline/recommended-models` 端点实时；token 只用不打印；端点失败降级读最近成功缓存；非 DeepSeek 项显式标注）。
- doctor 新增免费孪生存在性校验（免费组轮换防护）：cline 段显示 `cline-model` 是否仍在当前免费组，缺失时 WARN 并列出当前免费 id；端点失败 WARN 降级，不影响 exit 0。cline 模型探测行新增本次计价显示（$0 标「免费」）。
- 超额状态机：错误分类新增 `free-limit`（`Daily free model limit reached`，含重置倒计时透出）、`free-promotion-ended`（`Free model promotion ended`）、`model-not-found`（轮换后残留 id）三类 hint 与用户提示；跨 lane 回退语义不变（ai/cn 仍是 DeepSeek）。
- Web UI 免费模型选择器：状态页 cline 卡新增下拉（数据来自 `/api/status` 新增 `clineFreeModels` 字段），选中即写 `cline-model`；非 DeepSeek 项标注「非 DeepSeek」。
- cline 提示词无 ASCII 空格时自动前缀空格（规避 cline CLI 把无空格短中文当未知子命令的解析怪癖，实测有效）。

修复
- 目录拉取不走 undici fetch（其全局连接池在 Windows 上与随后的 `process.exit` 冲突触发 libuv 断言、exit 127），改用 `node:https` 单次连接。

变更
- `cline-model` 缺省默认值从空（provider 默认）改为免费孪生；版本号 5.1.0；help/文档/用户级 AGENTS 标记块口径统一为「免费（cline-free 孪生，限时轮换）」。
- 红线固化：cline lane 内部任何失败路径不得改用非 DeepSeek 模型顶替（回退只投 ai/cn）；回归断言在案（WBX.md v5.1 章）。

说明
- 隐私披露：免费用量可能被 Cline 用于改进模型（官方原文，已写入 README/UI/安装说明）。
- 免费额度边界未实测到（20 次内未见限制）；超额错误消息模板取自 cline 3.0.65 二进制内证（`ClineFreeModelLimitError` 等），状态机按真实消息字符串设计。

## 5.0.0 - 2026-09-25

新增
- 第三 lane `cline`：Cline CLI（npm 全局包，可选 lane）；`--json` NDJSON 纯文本端点（`--auto-approve false`）；默认 `thinking=xhigh`、`compaction=off`；模型默认 `deepseek/deepseek-v4.1-flash`（按量微付费，实测单次约 $0.0003-0.004）；隔离方式为 HOME/USERPROFILE 覆盖（状态只在 `~/.wbx/cline-home/`，不读写用户 `~/.cline`——实测 3.0.65 的 `--data-dir` 会破坏认证加载，详见 WBX.md v5 章）。
- lane 回退链扩展为 `ai → cn → cline`。
- PROMPTS.md v2 知识库：原则 12 条；模板 T1–T9（新增评审批判 T7、best-of-N T8、修复迭代 T9）；经验条目库 E-xxx（带来源）；沉淀闭环；决策速查表。
- Web UI 三 lane 卡片（cline 未装显示「未安装（可选）」）。
- 新增 SECURITY.md、CONTRIBUTING.md、CHANGELOG.md。
- 打 tag v5.0.0 并发布 GitHub release。

修复
- 子进程 stdin 管道不关闭导致 cline 调用悬挂——spawn 侧统一在无数据时也立即发 EOF。

变更
- 调用准则基线反转：默认分派、消耗豁免、best-of-N 常规化、评审常规化。

说明
- 不做 CI，决策记录在 WBX.md。

## 4.0.0 - 2026-09-25

变更
- 定位重写为「能力外包」：外包判定从文本杂活升级为自包含任务（含代码模块编写）。
- AGENTS/SKILL 分派准则加入代码实现环节。

新增
- PROMPTS.md worker 提示词模板库（含代码模块 T1 等六类）。
- fanout 任务级 `files` 字段材料拼接。
- 提示词超过 12k 字符时自动走 stdin 通道。

实测
- stdin 通道 60k+ 字符可用。
- 3 模块外包 3/3 一次成活、零返工。

## 3.0.0 - 2026-09-24

新增
- 核心库拆分为 wbx-core / wbx-setup / wbx-ui。
- `wbx config` 运行时配置（default-lane、disabled-lanes、parallel-per-lane 等）。
- ask 落盘 job，`wbx history` 完整回放双向对话。
- self-install 用户级全局安装（`~/.zcode` 四处 + `~/.wbx` 运行时 + `/wbx` 斜杠命令）。
- 本地 Web UI（127.0.0.1:7788，零依赖单页，含状态/路由/ask/fanout/历史/登录）。
- export-bundle 零凭证分发包（纯 Node zip）。

## 2.0.0 - 2026-09-24

新增
- 双 lane：`ai`（国际版 WorkBuddy AI，deepseek-v4.1-flash，x0.00 免费）与 `cn`（国内版，x0.03 近免费）。
- 失败自动跨 lane 回退。
- `wbx install-user` 用户级 AGENTS.md 标记块（任何项目可用）。

变更
- 凭证结构升级为 sessions/product。

修复
- 国际版登录 state 丢失 bug 的锦囊修补 URL。

## 1.0.0 - 2026-09-24

新增
- 首个可用版。
- 单 lane（WorkBuddy 国内版）。
- 逆向 SSO 协议登录（微信扫码）。
- doctor 自检。
- ask 单条调用。
- fanout 并发批量。
- 结果落盘 `.wbx/tasks/`。

实测
- fanout 6 任务 6/6、零限流。