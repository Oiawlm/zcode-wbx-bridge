# WBX 桥技术总文档

> 纯当前态：只写现行行为与不变量。版本史与验收记录见 [HISTORY.md](HISTORY.md)；卸载见 [UNINSTALL.md](UNINSTALL.md)；UI 设计契约见 [UI-SPEC.md](UI-SPEC.md)。命令旗标一律以 `wbx --help` 为准（表驱动生成，随代码更新不漂移）。

## 1 定位与边界

**一句话定位**：wbx 是本地命令行桥，把一次提问或一批任务按既定策略分派到五条已登录的外部 AI 通道（lane），统一入口、统一落盘、统一回退，失败时自动让位——五个外部 Agent 当作 ZCode 的子代理。

### 1.1 五 lane

| lane | 通道 | 档位 | 模型与关键约束 |
|---|---|---|---|
| codex | Codex CLI（可选·质量优先档） | **ChatGPT Plus 质量优先档** | 默认 gpt-6.1-sol，≥GPT-6 底线护栏（拒 GPT-5.6 及以下）；任务级 `--model` 不生效、`--effort low/medium/high` 直通；5h 滚动窗口+周上限，耗尽自动冷却让位 |
| ai | WorkBuddy AI 国际版 | x0.00 免费 | DeepSeek V4.1 Flash；免费兜底次选（回退链 cn 之后首个免费档） |
| cn | WorkBuddy 国内版 | x0.03 近免费 | DeepSeek V4.1 Flash；微信扫码登录路径稳定 |
| cline | Cline CLI（可选） | 免费（cline-free/ 免费孪生） | DeepSeek V4.1 Flash；限时轮换+每日配额；thinking=xhigh、compaction=off |
| doubao | 豆包桌面端（可选，Windows-only） | 会员额度 | 模型自管理豆包 2.1 Pro·推理高；调试口 9225（launch.ps1）；任务级 `--model`/`--effort` 不生效 |

### 1.2 项目价值三件事（第一性）

- **分派正确性**：能力、额度、健康三态可判定，路由可解释、落盘可回放。
- **冷启动效率**：一条命令起用；`doctor --quick` 十秒内零额度完成常规自检。
- **安全红线**：凭证不出本机、不进日志、不入 git；桌面版零侵入。

### 1.3 三条诚实声明（不削弱）

1. **临时工具**：本桥仅在免费期/低价期成立，结束即废弃，不承诺长期维护与向后兼容。
2. **平台局限**：豆包 lane 为 Windows-only，未在其他平台验证；其余 lane 跨平台行为同样不作承诺。
3. **非官方工具**：豆包 lane 走 Chromium 官方调试开关（CDP）驱动已登录客户端，与字节跳动无关、不属于任何受支持的集成方式；`usage` 余额的社区 billing 端点同为非官方（随上游改版可能失效）。两者失败均优雅降级，不影响主链路。

## 2 路由与回退

### 2.1 路由三分

1. **单发 `ask`**：`default-lane=auto`（缺省）= **codex 就绪即优先**（质量档），否则 ai→cn→cline→doubao 取首个可用。
2. **批量 `fanout`**：缺省池=ai/cn/cline/doubao 中已登录且未禁用者，**不含 codex**（Plus 额度保护）；任务级 `"as":"codex"` 点名才并入（调度池=缺省池∪点名）。
3. **显式点名**：`--as codex|ai|cn|cline|doubao`（任务级 `as` 字段同义）直投该 lane，仍受 `disabled-lanes` 硬禁用；codex 冷却期显式点名放行并打 WARN（见 §2.3）。

### 2.2 回退链

- 固定顺序 **cn→ai→cline→codex→doubao**，每条各一次；免费 lane 失败不自动烧 Plus/会员额度（付费两档排后）。
- 回退是通道级让位，不是能力级降档：caps 不满足直接报错（见 §6.1）。
- cline 内部任何失败路径绝不换非 DeepSeek 模型顶替（用户定案）；跨 lane 回退（cline→ai/cn）仍是 DeepSeek。

### 2.3 codex 额度冷却

- 检测：stdout/stderr/JSONL error 三处扫描额度耗尽特征 → 写 `<运行时根>/codex-quota.json`（`limitedAt/cooldownUntil/reason`）。
- 冷却期 `laneReady(codex)=false`：auto 路由/回退链/批量缺省池自动跳过；显式点名照放行并打 WARN。
- 时长：优先解析报错里的 "try again at" 时间，否则 `codex-quota-cooldown-min`（默认 30 分钟）；期满自动恢复候选。

### 2.4 cn 夜间免费档（v24）

- 语义：每日 23:00–08:00（北京时间）免费窗内，凡 cn lane 被调度到（fanout 并行/回退链/显式 --as cn）自动切夜间模型 Hy4 preview（思考 night-effort=high、上下文 night-context=960k）；窗外/过期恒白天档 DeepSeek V4.1 Flash（effort=max、上下文 1m）。**只换模型不动路由**（用户裁决 A）：LANE_ORDER/FANOUT_DEFAULT_POOL/FALLBACK_ORDER 零变化。
- 判定：纯时钟函数单点 `nightWindowState(now)`（半开区间、跨午夜翻转、时区钉 Asia/Shanghai、活动截止 night-expires），**每次投递现算不缓存**，展示层（doctor/stderr/UI）只消费单对象不自算；与 §2.3 事件驱动冷却互补，无扫描无状态落盘。
- 下发矩阵：effort=cn 双档/ai 恒不下发（国际版思考不可调，用户口径）；context=cn 双档/ai config context；cline/doubao/codex 各走既有单点不经策略。
- 可视化四出口：doctor cn 段行（--quick 亦显示；三态=在窗内/窗外/过期 WARN）、ask/fanout stderr [NIGHT] 行、/api/status 与 /api/doctor nightWindow 字段、manifest/任务记录 policy 快照。
- 配置：config `effort`/`context`/`night-model`/`night-effort`/`night-context`/`night-window`/`night-expires`（七键，非法值容错回默认）；任务级显式 --model/--effort 恒最高优先；活动截止官方口径 2026-10-31（转述，以官方为准）。

## 3 运行时布局

根解析优先级：`WBX_HOME` env → `~/.wbx/`（全局形态，装过 `wbx self-install` 即全局）→ 项目内 `.wbx/`；命中即止。全局形态桥本体在 `~/.zcode/wbx-bridge/`。

| 目录 | 内容 |
|---|---|
| `sessions/` | ai/cn 登录凭证（accessToken；绝不展示/入库） |
| `product/` | ai/cn 产品配置注入文件（custom-token） |
| `config/<ai|cn>/` | CodeBuddy CLI 隔离配置目录（仅 ai/cn 使用；绝不指向 ~/.workbuddy*） |
| `jobs/` | ask/fanout job 落盘：manifest.json + tasks-input.json + `<taskId>.json` + summary.md + 失败 attempt 全量输出 + 流式 lane 的原始事件流 |
| `scratch/` | 非 ∅ 能力任务的独立工作目录（读边界：白名单无写工具、cwd 外绝对路径读取被拒） |
| `cline-home/` | cline 隔离 HOME（providers.json 凭证 + work/ 空工作目录） |
| `codex-home/` | 隔离 CODEX_HOME（auth.json 副本 + work/ read-only 沙箱 cwd） |
| `run/` | 守护状态 ui.json（pid/port/token/version） |
| `logs/` | ui.log（守护日志，不含凭证） |

其余根级文件（codex-quota.json / cline-free-models.json / l0-cwd/ 等）与完整登记见 UNINSTALL.md 第〇节登记表。

**产物寿命（v28B，拓扑零变化零迁移——只加寿命不改路径）**：`scratch/` 条目 TTL=`scratch-ttl-hours`（默认 168h；ask/fanout 收尾惰性 GC，每日至多一次；`eph-*` 随 `--ephemeral` 任务完成即删）；`jobs/` 保留=`jobs-retention-days`（默认 30 天，仅 `wbx clean` 执行回收）；单件输出（失败 attempt 全量输出 / `*-stream.jsonl` / transcript 三通道）受 `output-max-bytes`（默认 5MB）护栏，超限截断+尾行 `[truncated by wbx output-max-bytes=N]`；三键均 0=关。lane 缓存仅 `config/{ai,cn}/{traces,logs,shell-snapshots}` 白名单可被 `wbx clean --lane-cache` 剪枝（30d+24h 安全窗）；凭证四目录与非白名单子目录任何代码路径不可达删除。

**凭证边界**：sessions/product/providers.json/auth.json 内容绝不进日志、文档、HTTP 响应、导出包；`.wbx/` 与 `~/.wbx/` 均 gitignore。

## 4 命令指针

唯一权威源=`wbx --help`。一句话清单：`doctor [--quick]`（自检向导；含产物三键生效值与 scratch/jobs/lane-cache 体积概览）/ `login --identity cn|ai|cline|codex` / `ask [--ephemeral]` / `fanout [--ephemeral]` / `history` / `clean [--jobs N] [--scratch H] [--lane-cache] [--apply] [--force]`（产物回收：缺省只读干跑报告零删，`--apply` 实删；候选仅扫描枚举+realpath 白名单+symlink 跳过；skipped 不影响退出码）/ `config list|get|set` / `models` / `usage` / `ui`（守护与自启钩子）/ `doubao <子命令>`（豆包桥手工直通，零落盘旁路）/ `export-bundle`（零凭证分发 zip）/ `self-install` / `self-uninstall` / `install-user` / `uninstall-user`（legacy）。`--ephemeral`（v23）=真实执行零落盘：回退/重试/超时/caps 原样，不建 job 不入历史（冒烟/连通性验证专用；fanout 结果 JSON 走 stdout；UI 发起的调用永远是真实调度）。

**质量门禁（六域常青套件，internal/）**：core-matrix（lane/caps/回退/错误分类/冷却矩阵）、cli-blackbox（假 CLI 沙箱黑盒）、ui-contract（UI 设计契约 + `--print-sha`）、ui-redtest（护栏红测）、daemon-lifecycle（守护与安全面）、docs-governance（文档治理），共用 test-helpers.mjs；旧 11 套件断言迁移台账见 `internal/archive/v22/suite-migration-map.md`（门禁=维护者本地面：internal/ 不入库、无 CI，外部贡献验收走全命令回归——见 CONTRIBUTING）。

## 5 认证（口径单点：全文只此一处展开）

| lane | 方式 | 有效期 | 过期处理 |
|---|---|---|---|
| ai / cn | SSO 登录流（cn 微信扫码；ai 邮箱/OneID+锦囊） | **约 55 天（实测口径）** | doctor 标 auth → 重新 `wbx login` |
| cline | 浏览器 OAuth 设备授权 | 随账号 | 重新 `wbx login --identity cline` |
| codex | **一次性只读复制** `~/.codex/auth.json` 入隔离 CODEX_HOME（唯一显式授权例外；绝不回写，除该单文件外 ~/.codex 零读取） | 随 ChatGPT 会话 | 令牌刷新失联 → `login --identity codex --force` 重收割 |
| doubao | 豆包客户端 GUI 自理，桥侧零凭证 | 客户端管理 | 无桥侧动作 |

## 6 契约索引

### 6.1 caps 能力矩阵（v19）

| 声明 | 别名 | 状态 | 适用与口径 |
|---|---|---|---|
| ∅ | L0 | 交付 | 纯文本零回退，五 lane 全部；缺省超时 300s |
| net,read | L1 | 交付 | 联网+只读，**仅 ai/cn**：WebSearch/WebFetch/Read/Glob/Grep 白名单 + scratch 读边界 + 轨迹与 transcript 落盘；缺省超时 600s |
| 含 write | — | 未交付 | 探针 P3 实证 acceptEdits 越界写逃逸，声明即报 caps-write-disabled |
| readDirs | — | 未交付 | 字段声明即报错（探针 P4 边界不可证） |
| L2 | — | 未交付 | `--caps L2` 报错；总闸 `caps-l2-enabled` 默认 false |

超时单点：显式 `--timeout` 最高优先；缺省非 ∅ 600s / ∅ 300s。`maxTurns` 1-64 任务级（config `caps-l1-max-turns` 默认 24，耗尽报 l1-turns-exhausted）。caps 失败绝不静默降档。

### 6.2 UI 契约

控制台 `http://127.0.0.1:7788`（四页签：状态/调用/历史/登录；浅深双主题；Host/Origin/token 安全面；PWA 离线）。设计契约 contract **v2.0.0** 冻结：108 token 双主题，**tokens-sha=6e0415da13**；权威载体 UI-SPEC.md；复算 `node internal/ui-contract.mjs --print-sha`。

### 6.3 退出码

CLI：0 成功 / 1 失败（含参数校验错误）。特例：`usage` 自然排空不强制退出（Windows libuv 兼容）；`ui --detach` 恒 0（钩子路径须秒回，失败只落日志）。`wbx-daemon` 专用码 78（守护协议，不经 CLI）。`doubao.mjs`（0-5）与 `launch.ps1`（0-5）为互相独立的码空间，同码不同义，消费方按来源进程区分。

### 6.4 config 键集

键集与键数权威=`wbx config list` 与 CONFIG_DEFS（默认值速览：default-lane=auto、parallel-per-lane=2、model=deepseek-v4.1-flash、default-caps=L0、caps-l1-max-turns=24、caps-l2-enabled=false、cline-thinking=xhigh、cline-compaction=off、cline-parallel=1、cline-auto-heal=true、doubao-parallel=1、doubao-autostart=true、codex-model=gpt-6.1-sol、codex-reasoning=medium、codex-parallel=1、codex-quota-cooldown-min=30、cline-provider=cline、cline-model=cline-free/deepseek-v4.1-flash；其余为路径键 cli-path/cline-path/cline-data-dir/codex-path）。

### 6.5 lane 集合

唯一来源=`LANE_ORDER` 常量（codex|ai|cn|cline|doubao）——lane 集合的枚举顺序以此为准；路由/回退优先级另见 §2（FALLBACK_ORDER 与 FANOUT_DEFAULT_POOL 为各自单点，非 LANE_ORDER 顺序）。fanout 缺省池=FANOUT_DEFAULT_POOL。

## 7 故障排查

| 症状 | 原因 | 修复 |
|---|---|---|
| doctor 全红 | 凭证缺失/过期 | `wbx login`（对应 identity）；仍红看 doctor 逐行指引 |
| 「cli」红（App 升级后） | CodeBuddy CLI 路径变更 | 重跑 doctor 自动扫描写回；或 `wbx config set cli-path "<路径>"` |
| cline `Daily free model limit reached` | 当日免费额度用尽 | 等重置（报错带倒计时）或 `wbx models --as cline --free` 换免费模型；跨 lane 已自动回退 ai/cn |
| cline `model not found` | 配置模型被免费组轮换下线 | cline-auto-heal（默认开）自动切换写回并重投；手动用 models --free 查清单后 config set |
| codex 额度耗尽 | Plus 5h 窗口/周上限 | 自动冷却让位（等冷却或显式点名放行）；余额看 ChatGPT 网页端 Settings→Usage |
| 豆包 CDP 不可达 | 客户端未以调试口 9225 运行 | doubao-autostart（默认开）自动经 launch.ps1 拉起/-Force 重启；或手动跑 launch.ps1 |
| 凭证过期 401/Authentication required | 登录态失效 | 重新 `wbx login`（WorkBuddy 约 55 天；cline OAuth；codex --force 重收割） |
| 超长提示词 | 命令行长度上限 | >12k 自动走 stdin（doubao 走 --file 临时文件），无需干预 |

## 8 风险红线

- 凭证绝不展示、绝不外包：sessions/product/providers.json/auth.json 内容不出现在日志、文档、HTTP 响应、导出包。
- 涉密、隐私、内部代码、未公开数据绝不外包（五 lane 同标准）。
- `.wbx/` 与 `~/.wbx/` gitignore，绝不提交。
- 桌面版文件不动：不写 `~/.workbuddy*`，不读写用户 `~/.cline`；`~/.codex` 仅 auth.json 单文件只读复制例外。
- 结果必校验后才用（联网产出另抽查来源清单）；连续 ≥2 次失败或限流即停止外包。
- caps 失败绝不静默降档；`--yolo`/`--zen` 禁用。

## 9 卸载与维护

### 9.1 卸载

一键 `wbx self-uninstall`（--purge 连 `~/.wbx/` 凭证一起删，默认保留）；安装物登记表与还原细节见 UNINSTALL.md。

### 9.2 维护经验（迁自 MEMORY 欠账）

1. **新增页签级加载函数须两处挂钩**：`activateTab` 切页钩子 + 启动区直调 `loadStatus()`——只挂一处会出现首屏空态或切页不刷新。
2. **全局形态副本改动后须重启守护生效**：改 `~/.zcode/wbx-bridge/` 下文件后 `wbx ui --stop` 再 `--detach`（模板串在守护进程启动时载入内存）；且全局副本与源码仓有五路部署物，改动须同步（self-install 幂等重跑 + sha 校验）。
