# HISTORY — wbx 桥版本历史归档（原文迁自 WBX.md 版本章与 CHANGELOG.md 旧条目）

> 定位：历史外置归档页（v22 定案）。当前态文档见 WBX.md / README.md；本文件只收历史，不再更新格式。以下内容为迁移时点原文。

## WBX 版本章

## v3 新能力

### `wbx config`（路由控制权归还用户）

```bash
wbx config list                          # 查看全部（含说明）
wbx config set default-lane cn           # auto（默认，ai 免费优先）| ai | cn —— ask 默认路由、doctor 显示
wbx config set disabled-lanes '["ai"]'   # 硬禁用：doctor 标注「已禁用」、fanout 默认 lanes、回退链跳过；ask --as 拒绝
wbx config set parallel-per-lane 2       # fanout 每 lane 并发
wbx config set cli-path "<CLI 完整路径>\codebuddy"  # CLI 入口（优先级低于 WBX_CLI env；传空串清空）
```

### `wbx history`（可观测 / 审计）

```bash
wbx history [--last 10]          # 表格：时间/类型/任务数/成功率/lane 分布/目录
wbx history <jobId> [--task <id>]  # 完整回放双向对话（PROMPT 全文 + REPLY 全文）
```

兼容只读展示旧 `.wbx/tasks/`（标「旧」）。ask 从 v3 起也落盘为 job。

### `wbx self-install`（任何项目可用）

```bash
wbx self-install --adopt          # 全局安装 + 把项目 .wbx/ 凭证迁移到 ~/.wbx/
wbx self-uninstall [--purge]      # 一键还原（--purge 连 ~/.wbx/ 凭证一起删，默认保留）
```

安装物（仅四处 + 运行时）：`~/.zcode/wbx-bridge/`（桥本体）、`~/.zcode/skills/wb-bridge/SKILL.md`
（用户级 skill，**同名遮蔽项目级**——内容一致，无行为差异）、`~/.zcode/commands/wbx.md`
（`/wbx <任务描述>` 斜杠命令，`skills:` frontmatter 自动挂载 wb-bridge）、`~/.zcode/AGENTS.md`
标记块（指向全局桥绝对路径）、`~/.wbx/` 运行时。装完后本项目桥也统一走 `~/.wbx/`（凭证共享）。
`--adopt` 默认保留项目侧凭证（`--no-keep-project` 迁移后删除，tasks/ 历史始终保留）。

### `wbx ui`（可视化）

```bash
wbx ui [--port 7788]              # 仅监听 127.0.0.1，自动开浏览器，Ctrl+C 即退（无常驻）
```

单页应用（内嵌 HTML/CSS/vanilla JS，零第三方依赖、零外部 CDN，离线可用）：
状态（两 lane 卡片：登录态/账号/成本系数/到期倒计时 + doctor 一键体检 + 路由三态开关 + 禁用开关）、
调用（ask 表单 + fanout 构建器，job 轮询实时进度）、历史（列表 → 完整对话，Markdown 渲染）、
登录（authUrl 可点击 + 锦囊 URL + 轮询状态，登录流在 server 侧跑）。
API 全 JSON：`GET /api/status|/api/doctor?probe=1|/api/history|/api/job/:id`、
`POST /api/ask|/api/fanout|/api/config|/api/login/start`、`GET /api/login/poll`。
**任何响应不含凭证**（只显示昵称/脱敏 uin/到期时间）。

### `wbx doctor` 新机向导 + `wbx export-bundle`（分发）

- doctor 逐步检查：node 版本 → CLI 路径（WBX_CLI → config.cli-path → 扫描
  `%LOCALAPPDATA%\Programs\WorkBuddy*`、`C:\Program Files\*`、`C:\Program Files (x86)\*`、`D:\App\*`；
  单命中自动写入 config，多命中列出并给固定命令）→ 模板缓存（缺失提示「启动一次桌面版」）→
  凭证（缺哪个 lane 给哪条 login 命令）。每步失败一行修复指引。
- `wbx export-bundle [--out <目录|文件.zip>]`（默认桌面）：生成分发 zip（scripts/ + SKILL.md +
  examples/ + docs/ + INSTALL-README.md），**纯 Node 实现 zip（store）**，导出后自检断言零凭证
  （逐成员比对本地所有 accessToken 值）。Windows-only（taskkill/路径扫描特化）。

## 附录：实测记录

### v1 记录（2026-09-24，单 lane 时期）

- 登录：国内版微信扫码，登录你的 WorkBuddy 账号即可；accessToken ≈ 55 天、refreshToken ≈ 60 天。
- doctor 全绿；`ask`（「解释幂等性」）成功；fanout 3 并发 3/3 成功。
- fanout 3 并发 × 6 任务两轮：**6/6 成功、13.9s、零限流**，tokens in/out = 40014/701。
- 单次调用成本：credit 0.01（系数 x0.03），prompt 约 6.5k tokens（CLI 自带 memory 系统提示，~6.4k 命中缓存）。

### v2 记录（2026-09-24，双 lane 改造）

- **迁移**：首次运行任意命令自动迁移 v1 凭证 → `sessions/cn.json` + `product/cn.json`，旧文件删除，打印 `[MIGRATE]` 提示。
- **doctor 双 lane**：ai lane 未登录显示 `[SKIP] 凭证`（带 login 指引，不崩溃、不影响 exit 0）；
  cn lane 全绿（模型探测 19.6s，tokens 6527/2）。
- **ask --as cn**（中文单条）：成功，4.8s，tokens 6527/36。
- **fanout 4 任务（cn lane，每 lane 并发 2）**：3 个软件动效调研 + 1 个日志结构化抽取，
  **4/4 成功、17.6s、零重试**；summary.md lane 列正确；JSON 抽取零误差
  （`[{"path":"/api/items","ms":34},…]` 与材料完全一致）。
- **install-user / uninstall-user round-trip**：注入标记块（21 行）→ 卸载后文件为空自动删除，还原干净。
- **国际版 lane**：见下节。

### 国际版（ai）lane 实测

- **打通 ✅（2026-09-24 20:33）**：`wbx login --identity ai` 第二轮成功——浏览器打开 authUrl、
  用户完成邮箱/OneID 登录后 token 轮询即拿到凭证，
  凭证落 `.wbx/sessions/ai.json` + `.wbx/product/ai.json`。
- **过程记录（决策点 1 补充）**：第一轮（20:10 启动）900s 窗口内无浏览器侧操作而超时（用户不在场，
  非机制失败）。第二轮用户在场后登录一次成功；**未再复现**此前两次记录的「state 丢失→登录失败」
  页面，故本轮无法确认是原生流程直接成功、还是用户按指引用了锦囊 A 修补 URL——两种路径命令输出
  均已支持（login 会实时打印当轮 state 拼好的锦囊 A/B URL）。下次若再遇「登录失败」页，直接复制
  命令输出里的锦囊 A URL 到地址栏回车即可。
- **登录后验证（全部通过）**：
  - `doctor` **双 lane 全绿**：ai 模型探测 11.2s（tokens 7565/2）、cn 探测 5.3s。
  - `ask --as ai`（中文单条）：成功，10.5s，tokens 7565/70——**国际版 deepseek-v4.1-flash
    x0.00 免费**（成本为 0，验收标准 3 达成）。
  - `fanout --lanes ai,cn`（4 任务，每 lane 并发 2 = 总并发 4）：**4/4 成功、14.6s、零重试**；
    公共队列动态均衡分派（2 任务落 ai、2 任务落 cn），summary.md lane 列正确
    （结果：`.wbx/tasks/20260924-203312/`）。

### 主动分派端到端测试（新会话）

验证话术（不出现「外包/并行/wbx」字样）：

> 帮我调研 Linear、Raycast、Arc 三款软件的加载动效，给我对比

预期行为：新会话读到项目 AGENTS.md + 命中 wb-bridge Skill → `doctor` 自检 → 生成 3 个
调研 worker 任务（带来源要求、无工具声明）→ `fanout` 分派 → 读 summary.md 与各结果 JSON →
**校验后**汇总对比给用户（标注信息来自模型已有知识、可能过时）。
若要在**其他项目**也生效，需先 `wbx install-user`（用户级 AGENTS.md 标记块）。

### v3 记录（2026-09-24 晚，可观测 + 全局化 + 可视化 + 可分发）

全部实测通过，逐项对应 v3 验收标准：

- **Phase 1（核心重构）**：`wbx.mjs` 拆为薄壳 + `wbx-core.mjs`（CLI/UI 共用 lib）+
  `wbx-setup.mjs`（安装/打包）+ `wbx-ui.mjs`（UI）；v2 全部命令与参数无回退（doctor/login/
  ask/fanout/models/install-user/uninstall-user 实测一致，models 探测 5.1s 通过、install-user
  round-trip 还原干净）。
- **config 全链路实效**：`config set default-lane cn` 后无 `--as` 的 ask 实际走 cn（8.8s，
  7562/2 tokens）；`disabled-lanes ["ai"]` 后 doctor 标注「已禁用、路由/回退链跳过」、
  `ask --as ai` 被硬禁用拒绝（exit 1 + 修复指引）、fanout 默认 lanes 只剩 cn（2/2 成功）；
  恢复 `[]` 后双 lane 恢复。config 值快照写入每次 job 的 manifest.json。
- **ask 落盘 + history 回放**：ask 生成 `jobs/<时间戳>-<rand>/`（manifest + tasks-input +
  记录 + summary）；`history --last 10` 列出新 job、项目形态时期的 jobs、v2 旧 tasks（共 8 条，
  旧条目标「旧」，v1 无 lane 字段的显示 `?`）；`history <jobId> --task <id>` 完整回放
  prompt 全文 + 回复全文（含旧 job 20260924-203312 的 survey-arc 双向对话）。
- **Phase 2（全局化）**：`self-install --adopt` 一次完成五处安装物 + 凭证迁移（ai、cn 均迁入
  `~/.wbx/`，项目侧默认保留；重复运行幂等——「目标已存在，跳过」）。
  **在无关目录**（`%TEMP%\wbx-unrelated-test`）运行全局桥：doctor 全局形态通过、ask 走 ai
  成功（10.0s），凭证来自 `~/.wbx/`。`self-uninstall` 后四处全局位置零残留
  （wbx-bridge/、skills/wb-bridge/、commands/wbx.md、AGENTS.md 连空文件删除），
  `~/.wbx/` 凭证保留（--purge 才删）；卸载后项目桥自动回退项目形态（运行时根变回项目 .wbx）。
  装回后项目桥 history 同时显示全局 jobs + 项目 jobs + 项目 tasks。
- **/wbx 斜杠命令**：`~/.zcode/commands/wbx.md` 就位（frontmatter 单行平铺键：description /
  argument-hint / skills: wb-bridge；正文 $ARGUMENTS 注入 + 引导 doctor → 分派 → 校验 → 汇总），
  命令正文引用的全局桥调用链（doctor/ask）已在无关目录实测走通。交互式新会话里输入
  `/wbx <任务>` 的最终确认留给用户（本执行窗口无法开第二个 ZCode 会话）。
- **Phase 3（UI）**：`wbx ui` 启动 → 自动开浏览器 → 四 tab 全部实测：
  - 状态：两 lane 卡片（昵称/成本/到期倒计时/endpoint/模板）、路由三态
    开关（POST /api/config 写入后 status 立即反映）、禁用开关、doctor 一键体检；
  - 调用：UI 发起 ask（ai 成功返回 "OK"）与 fanout（2 任务：auto→ai、绑定 cn，2/2 成功），
    1s 轮询进度（brief 模式）→ 完成后展示全文结果；
  - 历史：11 条 job 列表 → 点开完整对话（PROMPT 折叠 + REPLY Markdown 渲染）；
  - 登录：POST /api/login/start 返回 authUrl（可点击）+ 轮询 pending 状态正常；
  - **零凭证**：对 `/`、`/api/status`、`/api/history`、`/api/login/poll`、`/api/job/:id`
    五类响应逐字节比对本地 8 个 accessToken 值——零命中；响应中无 accessToken/refreshToken 字样；
  - 浏览器实际渲染验证（ZCode 内置浏览器）：状态页布局/卡片信息/路由控件无视觉缺陷，
    前端 JS 语法与运行时均正常；Ctrl+C（进程终止）即退出，无常驻。
- **Phase 4（分发）**：doctor 向导——config 指向不存在路径时触发扫描，一台装有两个 WorkBuddy
  的机器可扫出两个 CLI 入口（国际版与国内版安装目录）→ 列出并提示固定命令（单命中路径自动写入 config）；
  新机模拟（`WBX_HOME` 指向空目录 + 解包的 bundle）：无凭证 → 每 lane 给出 login 命令指引、
  exit 1、运行时目录自动创建。`export-bundle` 生成 176KB zip（11 文件，含 INSTALL-README.md），
  PowerShell Expand-Archive 解包结构完整；**零凭证断言通过**（逐成员比对 8 个 accessToken 值）；
  按 INSTALL-README 在干净目录模拟安装：根入口 `node wbx.mjs self-install` 成功 → doctor 双 lane 绿
  （真实异机由用户自测）。
- **遗留小项**：v2 `.wbx/tasks/` 与项目形态 `.wbx/jobs/` 为只读历史保留（不迁移不删除）；
  UI 的 fanout 构建、历史翻页为当前单页实现，超大量 job 时性能未做优化（本地场景够用）。

## v4 章：能力外包（定位重写 + 提示词工程 + 代码任务分派）

### v4 定位变更说明

v1–v3 的对外口径把外包范围限定为「翻译/摘要/调研这类文本杂活」，这低估了 deepseek-v4.1-flash
的实际能力。v4 定案（用户决策）：**该模型本身能力很强，可以承担包括编写代码模块在内的一切
适合外包的工作**。v4 不换模型、不加模型分档、不动成本结构，改的是三件事：

1. **公理升级**：外包判定从「轻量文本活」改为「**自包含任务**」——全部输入（含代码上下文）
   可由编排器打包进提示词、输出可独立校验，即可外包。worker 无工具的安全边界不变
   （2026-09-25 v6.0.0 起演进为 caps 能力分级：L0 档保持无工具不变，L1 档白名单联网+只读、
   L2 缓期未交付，见文末 v6.0.0 章），
   「让它读文件」的正确实现 = ZCode 先读文件、把内容贴进提示词材料区（材料先行）。
2. **提示词工程体系**：新增 [PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md)（入库发布物，
   由 SKILL.md 引用），核心是代码模块编写模板（接口契约 + 材料区 + 硬输出约束），
   并升级翻译/摘要/调研/结构化抽取/文案变体五个既有模板。
3. **分派准则重写**：AGENTS.md/SKILL.md 的「适合分派」加入**代码实现环节**（一段工作拆成
   接口清晰的模块，其中无上下文依赖的部分外包，ZCode 负责接口定义、集成与审查）；
   「不适合」从「多轮依赖上下文的编码任务」改为「需要探索式多轮交互的任务」。
   铁律全部保留：派发结果不派发步骤、每文件单一写者、材料先行、结果必校验、
   连续 ≥2 失败或限流即停止外包。

### 调研记录（2026-09-24，Phase 0 实测）

**lane 健康度**：`wbx models` 双 lane `deepseek-v4.1-flash` 探测均可用——ai 13.2s（tokens 6503/2）、
cn 5.4s。不换模型，仅确认健康。

**调研 A：DeepSeek 官方提示词指南/提示库**（真实 URL 已核实）：

| 资源 | URL | 要点 |
|---|---|---|
| 官方提示库（中文） | https://api-docs.deepseek.com/zh-cn/prompt-library | 13 个条目：代码生成、代码解释、代码改写、内容分类、结构化输出、中英翻译专家、角色扮演×2、散文/诗歌、文案大纲、宣传标语、模型提示词生成 |
| 思考模式指南 | https://api-docs.deepseek.com/zh-cn/guides/thinking_mode | 思考默认开、effort 默认 high；档位 minimal…max；思维链经 `reasoning_content` 返回，不进上下文；复杂推理开思考、简单任务关（省时） |
| JSON 输出指南 | https://api-docs.deepseek.com/zh-cn/guides/json_mode | prompt 里必须含 "json" 字样并给出目标 JSON 格式样例；防截断需合理 max_tokens |
| WorkBuddy/CodeBuddy 集成页 | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy | 官方将 WorkBuddy/CodeBuddy 列为第三方 Agent 工具（经 API 接入），与本项目认知一致 |
| 文档站全量页清单 | https://api-docs.deepseek.com/sitemap.xml | 当前官方文档已无独立「提示工程」指南页，提示库为主要官方样例来源 |

官方样例对本桥模板的直接启发（PROMPTS.md 已吸收）：

- **代码生成**条目：官方 USER 提示词就是一句直接的任务指令（「请帮我用 HTML 生成一个五子棋游戏，
  所有代码都保存在一个 HTML 中」）——直接说清产物形态与边界，不绕弯；
  样例输出为带语言围栏的完整代码 + 代码说明。
- **结构化输出**条目：SYSTEM 里给完整 JSON 骨架 + 每字段一行语义说明（「没有请填 null」）——
  与本桥「输出 JSON 对象、不确定用 UNKNOWN/null 占位」的硬约束写法一致，v4 模板保留字段级说明。
- **中英翻译专家**条目：角色定义 + 信达雅标准 + 「调整语气和风格、考虑文化内涵」——
  v4 翻译模板吸收信达雅表述。
- **json_mode 指南**：提示词里必须出现 "json" 字样并给格式样例——本桥 JSON 抽取模板
  的样例骨架写法有官方依据。

**调研 B：CodeBuddy CLI 能力边界**（本机 CLI `--help` 原文 + 实测；codebuddy.ai 文档站
在本网络下 WebFetch/IAB 均超时或空白，未能引用其页面，以下以本地 CLI 的自述帮助为准）：

| 问题 | 结论 | 证据 |
|---|---|---|
| `-p` 支持文件/stdin 提示词？ | **支持 stdin**：`-p` 不带位置参数时从 stdin 读提示词。实测 60,159 字符提示词（≈40.9k input tokens）经 stdin 成功返回（13.1s，ai lane，答案正确）；无 `--prompt-file` 类选项（只有 system prompt 有 `--system-prompt-file`） | `--input-format`（text/stream-json，仅 --print 模式）+ 两组实测 |
| `--tools` 只读子集？ | 存在：`""` 全关 / `"default"` 全开 / 逗号分隔白名单（如 `"Read"`）。**仅评估不启用**——本桥安全边界 = worker 零工具（`--tools ""`）不变；开放只读工具会让 worker 触到用户文件系统，收益（省贴材料）不抵边界后撤 | CLI `--help` 原文：`Restrict which built-in tools ... Use "" to disable all, "default" for all, or comma-separated tool names like "Bash,Edit,Read"` |
| `--effort` 档位语义 | `minimal / low / medium / high / xhigh / max` 六档；官方 thinking 指南说明 effort 默认 high、思考模式适合复杂推理、简单任务可调低省时 | CLI `--help` 原文 + DeepSeek thinking_mode 指南 |

### 桥改动决策（Phase 2 白名单，实施前记录理由）

v4 原则：`scripts/*.mjs` 零改动，仅允许以下两处小改（均为「明确收益且小改动」才做）：

1. **fanout 任务级 `files` 字段**（改 `wbx.mjs` cmdFanout，≈14 行）——理由：代码外包的
   材料先行场景里，ZCode 已把相关文件路径写进 tasks.json 更自然（`"files": ["src/api.ts"]`），
   桥读文件按「文件开始/结束」段落拼进提示词材料区，省去 ZCode 手工拼串；
   相对路径基于 tasks.json 所在目录（与既有 `file` 字段一致）。
2. **长提示词 stdin 通道**（改 `wbx-core.mjs` spawnNode/askOnce，≈14 行）——理由：调研 B
   实测 stdin 可传 60k+ 字符；v3 的 ~25k 命令行长度上限使「贴完整代码上下文」经常被迫裁剪。
   实现：提示词 > 12000 字符时改走 stdin（`-p` 无位置参数 + stdin 写入），≤ 12000 保持
   v3 位置参数路径**逐字节不变**——既有行为零回退，仅解锁原先会失败的超长任务。

未做（不满足「明确收益且小改动」）：`--tools` 只读子集接入（安全边界不变原则）、
UI 侧 `files` 支持（UI 会话无 tasks.json 目录语境，先 CLI-only）。

**配套机械改动**（非行为变更，随上述两项一并实施并记录）：`wbx-setup.mjs` 的
self-install / export-bundle / `/wbx` 命令模板纳入 PROMPTS.md（否则全局形态与分发包缺新发布物，
v4 验收标准 5 无法达成）与 /wbx 适用判定的 v4 措辞；`WBX_VERSION` 3.0.0 → 4.0.0；
ask 的「接近命令行上限」警告改为「超 12k 自动走 stdin」提示（原警告针对已解除的限制，属过时文案）。

### v4 回归测试（2026-09-25，改桥后全命令）

| 项 | 结果 |
|---|---|
| 4 个脚本 `node --check` | 通过 |
| `doctor --no-probe` / `doctor` | 双 lane 凭证绿，版本 v4.0.0 |
| `models`（ai/cn 探测） | 均可用（Phase 0 实测 13.2s / 5.4s） |
| `ask` 短提示词（v3 位置参数路径） | OK 11.1s（tokens 6504/2） |
| `ask` 30,476 字符（新 stdin 路径） | OK 33.2s（tokens 25012/15），答案正确 |
| `fanout` 2 任务（含 `files` 字段拼接） | 2/2 成功；材料按「文件开始/结束」段落拼入 tasks-input.json，模型据材料答对 |
| `config set/get` 回环（default-lane cn→auto） | 通过 |
| `history --last` / `history <jobId> --task` | 列表与双向回放正常（含 files 拼接后的完整 prompt） |
| `export-bundle` | 11 文件（新增 PROMPTS.md），零凭证断言通过 |
| `ui` 冒烟（/api/status、/api/history） | 正常（版本 4.0.0，全局形态识别正确） |

### v4 记录（实测附录）

**Phase 5.1 demo 端到端（2026-09-25，真实代码外包）**

demo 项目 `%TEMP%\wbx-v4-demo\`（不入库）：日志统计小工具 logsum 拆 5 模块——
ZCode 写接口契约（CONTRACT.md）+ 风格样例（lib/slugify.js）+ 编排层
（lib/summarize.js 聚合、cli.js IO）；3 个纯函数模块用 PROMPTS.md T1 模板外包：

| 任务 | lane | 材料方式 | 耗时 | tokens in/out | 尝试 |
|---|---|---|---|---|---|
| mod-parse-duration | ai | 提示词内联材料 | 16.1s | 6947/1442 | 1 |
| mod-format-bytes | cn | **`files` 字段**（桥拼 slugify.js + CONTRACT.md） | 12.5s | 7461/1817 | 1 |
| mod-parse-log-line | ai | **`files` 字段** | 15.7s | 7461/1239 | 1 |

fanout 3/3 成功（并行墙钟 ≈16s），tokens 合计 21869/4498，零重试零回退。

**质量评估（审查发现与修复）**：三份产物**零返工**——风格与样例一致（use strict/JSDoc/双引号/
2 空格）、契约验收标准逐条通过、无编造 API。亮点：worker 对契约未覆盖的行为不猜不编，
全部用 `// TODO(原因)` 显式标注（空白字符处理、Infinity、TB 封顶、日期取值合法性、空 message），
正是 T1 模板「不确定处 TODO 占位、绝不编造」的预期行为。集成即通过：test.js 断言
（外包 3 模块契约验收 19 条 + ZCode 模块 2 条 + CLI 端到端 3 条）全过，`node cli.js sample.log`
输出正确（有效行 7/8、ERROR=2、错误样例）。**结论：接口契约 + 材料先行 + 硬输出约束的
组合下，flash 的代码模块一次成活率高，v4 定位（能力外包）成立。**

**Phase 5.2 主动分派验证（2026-09-25 实测通过）**

触发面五处静态核验含 v4 代码意图（`编写或并行编写代码模块/纯函数/组件/测试用例`、`代码实现环节`）：
项目 AGENTS.md「代码实现环节」条目、项目级 SKILL.md frontmatter、用户级 skill（实际生效、
遮蔽项目级）frontmatter、用户级 skill 目录 PROMPTS.md、`/wbx` 命令模板 v4 判定。

**行为实测**（验收标准 2）：本机 ZCode 桌面版无 headless CLI 可开字面意义的第二个窗口，故用
**全新上下文的 fresh 子代理实例**模拟新会话——输入只有用户话术（不含 wbx/外包/模板字样）：
「帮我写一个密码强度检查的命令行小工具，能并行的部分就并行」，行为完全由 harness 注入的
AGENTS.md 常驻规则与 wb-bridge skill 触发面驱动。结果：**自动触发全流程**——`doctor` 双 lane
全绿 → 子代理自行定义 5 个规则模块的统一契约 → 按 PROMPTS.md T1 模板构造提示词 → `fanout`
分派（job `20260925-002224-ft7`：5 任务、effort medium、**5/5 成功、ai×3+cn×2 真双 lane 并行、
65.4s、tokens 37801/29687**）→ 集成校验。执行窗口独立复核：5 份 tasks-input.json 全部具备
T1 结构特征（接口契约/无工具声明/输出要求）；交付物 `pwcheck`（CLI + 评分聚合为子代理自写、
5 个规则模块外包）33/33 测试复跑通过、CLI 退出码行为正确。产物在
`%TEMP%\wbx-v4-verify\`（不入库）。

**佐证**（同日 00:15，独立于本验收）：另一会话经全局桥发起 job `20260925-001458-1um`
（C# MSTest 测试起草 + 文案任务，T1 形态提示词，2/2 成功）——v4 代码外包模式已被本验收之外的
真实使用自然触发。

**实测发现的使用注意**：项目文件夹路径含非 ASCII 字符（如本项目「agent联动」）时，Git Bash
里以相对/绝对路径传参给项目内 `wbx.mjs` 偶发 Node 模块加载编码错误——改用全局桥入口
`~/.zcode/wbx-bridge/scripts/wbx.mjs`（ASCII 路径）即可绕开，功能一致（WBX.md 故障排查表
「Cannot find module」条目同源，此处补记现象与绕法）。

字面意义的「新开桌面窗口」人工确认仍可由用户随时复测（话术同上），机制面已经上述行为实测覆盖。

**全局形态同步（Phase 3.3）**

`self-install` 幂等重跑两次（中途更新用户块模板后再跑一次）：`~/.zcode/wbx-bridge/`
v4.0.0（scripts + examples + PROMPTS.md + docs）、用户级 skill SKILL.md + PROMPTS.md、
`/wbx` 命令 v4 文案、`~/.zcode/AGENTS.md` 标记块刷新为 v4 公理（自包含、含代码实现时机）、
`~/.wbx/` 凭证原样未动（ai/cn 双绿）。清理了一个 v3 时期遗留的过时 PLAN.md 全局副本
（现项目内 PLAN.md 已移入 internal/，不再随装）。

## v5 章：三 lane（+Cline CLI）· 子代理化高频调度 · 提示词知识库

### v5 定位变更说明

v4 已解决「能不能外包、怎么外包」。v5 定案（用户决策）解决三件事：

1. **第三条 lane（Cline CLI）**：独立于 WorkBuddy 的上游，同源限流/停服时多一份真实冗余；
   调用参数定案 `--thinking xhigh --compaction off`（上下文与思考强度默认拉满，任务级 effort 不下调）。
2. **提示词知识库（PROMPTS.md v2）**：把「每次派发现场手写提示词」的经验沉淀为可复用知识
   （原则 12 条 + 模板 T1–T9 + 经验条目库 E-xxx 带来源 + 沉淀闭环 + 决策速查表）。
3. **子代理化高频调度**：三个外部 Agent = ZCode 的子代理——「放开用」而非「省着用」：
   默认分派（单个自包含任务也直接派）、消耗豁免（裁剪只为信噪比）、关键产物 best-of-N
   双份择优（T8）、集成前默认评审批判（T7）。**不是**开启外部 Agent 自身的 agentic 模式
   （用户定案：那「是另一回事」，v5 明确不做——不使用 `--yolo`/`--zen`，桥不加 agentic 配置键）。

### 调研记录（Phase 0 实测，2026-09-25，cline 3.0.65 / Node v24.19.0 / Windows 11）

策划期核实材料与来源 URL 见 `internal/RESEARCH-V5.md`（本节只记执行窗口实测结论）。
关键来源：Cline CLI 官方 README（github.com/cline/cline 的 apps/cli）、先例项目
tm-henningnt/cline-plugin-cc（验证 3.0.37/3.0.40）、r/CLine 免费模型帖
（reddit.com/r/CLine/comments/1vdczm5）、DeepSeek 官方文档（api-docs.deepseek.com）。

| # | 事项 | 实测结论 |
|---|---|---|
| 1 | 安装 | `npm install -g cline` → 3.0.65；postinstall 被 npm allow-scripts 拦截但平台包 `@cline/cli-windows-x64/bin/cline.exe`（Bun 编译，144MB）随依赖就位，桥直接 spawn 该 exe（launcher `bin/cline` 亦可用） |
| 2 | 无凭证行为 | 非交互运行约 1s 快速失败（exit 1），事件流含 `type:"error"` + `finishReason:"error"` 的 `run_result`，stderr 另有一行 JSON error——回退链直接跳过，不耗重试 |
| 3 | OAuth 登录 | `cline auth cline` 设备码流（打印 code + authkit.cline.bot URL，轮询等确认）。**浏览器有活跃 WorkOS 会话时新码自动批准（零点击复登实测两次）**。凭证形态：`providers.<id>.settings.auth.{accessToken,refreshToken,expiresAt}`（tokenSource=oauth；**不是** apiKey 字段） |
| 4 | `--data-dir` 之坑 | **3.0.65 上不可用于本场景**：①放在 `auth` 子命令前被忽略——凭证误落默认 `~/.cline`（先例 3.0.37/3.0.40 可用的写法已变，升级脆弱性实锤）；②运行时带 `--data-dir` 认证加载被破坏——同一凭证同一路径，不带 flag 可用、带 flag 即 401（疑其自动启用的沙箱；CLINE_SANDBOX=0/CLINE_DISABLE_SANDBOX=1/CLINE_NO_SANDBOX=1 均无效） |
| 5 | `--config` 之坑 | `cline auth cline --config <隔离根>` 非交互直接 exit 1 不等待，不可用 |
| 6 | 隔离正解 | **HOME/USERPROFILE 覆盖**：spawn 时注入 `USERPROFILE=HOME=<运行时根>/cline-home`（并删 HOMEDRIVE/HOMEPATH 防拼接干扰），cline 解析的 `~/.cline` 整体落在桥目录——凭证、db、日志、会话全部隔离，比官方 flag 更彻底；登录后端到端实测通过 |
| 7 | stdin 之坑 | cline 总会检查 stdin（支持 `cat file \| cline`）：异步 spawn 若不 `stdin.end()`，进程等 EOF 永久悬挂（spawnSync 因立即关管道而正常）——桥已在 spawnBin 统一「无数据也立即 EOF」 |
| 8 | stdin 通道 | 长提示词 pipe 全文 + 短位置参数指令（"Complete the task described in the piped stdin content…"）实测可用：桥内 `ask --as cline` 21,979 字符（20,370 input tokens）7.4s 正确作答——沿用 v4 的 >12k 走 stdin 规则 |
| 9 | 参数怪癖 | 位置参数提示词**至少含一个 ASCII 空格**：无空格短中文（如「回复OK」）被当未知子命令拒绝（"Unknown command or unquoted prompt"）；含空格即正常。真实 worker 提示词天然满足 |
| 10 | NDJSON 事件全集 | `hook_event`(agent_start/agent_error)、`agent_event`(iteration_start/end、content_start/end——正文与 **reasoning 思考块**（`contentType:"reasoning"`）、error)、`run_result`(finishReason completed/error、**text=最终答案**、usage{inputTokens,outputTokens,cacheRead,cacheWrite,totalCost}、model.id、durationMs)、usage/effort/done/toggle。**解析取 run_result 即可，增量 event.text 仅回退**；无先例所述 `cline-run:` 尾行 |
| 11 | 纯文本端点 | `--auto-approve false` 下全流无任何工具执行事件（流中 "tool" 字样仅为 reasoning 文本提到"我无工具"） |
| 12 | thinking/compaction | `--thinking xhigh --compaction off` 被接受且生效（run_start 事件可见 thinking:on；compaction off） |
| 13 | 模型 id 与费用 | 格式 `vendor/model`；模型目录 API 实测可得（`GET api.cline.bot/api/v1/models`，Bearer OAuth token，全量 460 个模型）。**「免费」终版结论（2026-09-25 追加实测）**：Cline App 内标 "(free)" 的模型（如 DeepSeek V4.1 Flash / MiMo-V2.6-Flash / Space Bunny Alpha）经 CLI 调用时**并非全部零成本**——`stealth/space-bunny-alpha` 实测 totalCost=0（目录级真免费，1M 上下文）；`deepseek/deepseek-v4.1-flash`（已设默认，$0.0008-0.001/次）与 `xiaomi/mimo-v2.6-flash`（$0.001/次）均按量计费；`~deepseek/deepseek-flash-latest` 等自托管变体亦计费（$0.0008/次）。CLI 二进制内含 `FreeModelLimitResetTime`/`CreditsRequired` 字样（免费组+每日额度机制存在），但 App 的 free 标签与 CLI 计价不同源。**找免费模型的办法**：`wbx models --as cline --probe "vendor/model,..."`（v5 起显示每次探测的计价，$0 即免费）；想全免费可 `config set cline-model "stealth/space-bunny-alpha"`。**【勘误（v5.1，2026-09-25）】：本条「CLI 侧 DeepSeek 全部计费」的结论后被 v5.1 推翻——错在探测用了计费孪生 id：同一模型有付费 id 与 `cline-free/` 前缀免费孪生两个 id（`cline-free/deepseek-v4.1-flash` 实测 totalCost=0）。历史结论保留以记录认知演进，最新口径见 v5.1 章】** |
| 14 | `-t` 超时 | `-t <秒>` 传整轮上限，桥侧 spawn 超时（timeoutMs+20s）独立兜底 |

**隔离性验证**：以 HOME 覆盖运行多个真实任务后，用户 `~/.cline` 除其自身 hub 守护进程日志外
零写入（静置观察复核）。**事故披露（如实记录）**：排查期间两处误触用户 `~/.cline`——①轮换
登录循环用 `--data-dir` 前置写法，其中 12:19 的一次成功授权把 OAuth 凭证写进
`~/.cline/data/settings/providers.json`（覆盖了用户 cline-app 11:47 写的同账号版本，其桌面程序
仍可用，未删除该文件）；②12:33–12:35 的 2×2 对照矩阵两次以默认环境目录运行（定位根因所必需），
刷新了该文件。此后（12:36 起）全部调用均隔离。教训已固化为 E-006 与红线复述。

### 设计决策（Phase 1）

1. **回退链位置**：ai → cn → cline，各一次；cline 排最后（稳定性待长期观察、微付费）；
   `auto` 下 cline 永远在 ai/cn 之后；未装/无凭证 `laneReady=false` 直接跳过（不耗重试额度）。
   `default-lane` 枚举扩 `cline`（用户可固定），`disabled-lanes` 支持三 lane。
2. **cline 并发默认 1**（`cline-parallel` 键，1–8）：按量微付费 + 上游稳定性未知的保守起步；
   `--parallel` 不抬升 cline（ai/cn 才受它控制）。实测稳定后可调。
3. **任务级 effort 不下调 cline 思考档**（用户定案）：lane 一律 `--thinking <config>`（默认
   xhigh）；fanout 任务的 `effort` 字段对 cline lane 忽略；全局调整只走 `cline-thinking` config。
4. **不做 CI**（Phase 4 定案）：敏感审计模式含个人信息（账号名/邮箱/路径），写进公开
   workflow 文件即泄漏；冻结的人工发布流程（白名单逐文件 add → ls-files 对照 →
   `git grep --cached` 零命中 → push 后 `gh api` 复扫）已覆盖同等检查。
5. **配置键全部可选、缺省=v4 零回退**：`cline-path/data-dir/provider/model/thinking/compaction/
   parallel` 七键 + default-lane/disabled-lanes 扩展；未装 cline 时 doctor/ask/fanout/config
   行为与 v4 一致（实测回归）。
6. **SECURITY.md 上报渠道**：GitHub Security Advisories「Report a vulnerability」，不放个人邮箱。
7. **对外口径如实**：cline lane 成本统一写「按量微付费（实测单次 $0.0003-0.004）」，
   不写「免费」（Phase 0 #13 实测结论优先于策划期假设）。

### 桥改动清单（Phase 1，融入现有四模块架构，不新建目录）

- `wbx-core.mjs`：`WBX_VERSION` 5.0.0；`LANE_ORDER=['ai','cn','cline']`、`FALLBACK_ORDER=['cn','ai','cline']`；
  cline 常量与 `clineSpawnEnv()`（HOME 覆盖）/`scanClineCandidates()`/`resolveClinePath()`/
  `clineHomeDir()`/`clineHasCredential()`（查 `settings.auth.accessToken` 或 `apiKey`）；
  `spawnBin()` 通用化（spawnNode 复用之）+ stdin 无数据也立即 EOF；`parseClineNdjson()` 纯函数
  （**外包产出**：wbx fanout job `20260925-120106-jh7`，ZCode 审查修订后集成——run_result 优先、
  增量文本回退、错误优先级、BOM/CRLF/非 JSON 行容错）；`askOnceCline()`（`--json -P <provider>
  [-m <model>] --auto-approve false --thinking <cfg> --compaction <cfg> -t <秒> -c <空workdir> "<提示词>"`，
  禁 `--zen`/`--yolo`，>12k 走 stdin 通道，原始 NDJSON 全文随 job 落盘 `<id>.cline-stream.jsonl`）；
  `runClineAuth()`（spawn `cline auth <provider>` + 隔离 env，stdio inherit）；doctor 第 7 段
  （未装=WARN+指引 / 已登录+可选探测，全部不影响 exit 0；输出只报凭证存在性）；
  `laneStatusInfo('cline')` / `laneReady('cline')` / `parseLane` 扩展；config 七个 cline-* 键与容错；
  fanout `laneParallelOf()`（cline 单独受 `cline-parallel`）；用户级 AGENTS.md 标记块 v5 措辞。
- `wbx.mjs`：login `--identity cline` 分支；models `--as cline`（探测+指引）；`--lanes ai,cn,cline`；
  HELP 三 lane。
- `wbx-ui.mjs`：三 lane 卡（cline 含 未安装（可选）/未登录（OAuth）/已登录 三态 + 模型/思考档/
  二进制路径）、路由 pill + 禁用 cline 开关、ask/fanout 的 lane 选项、登录页 cline 指引卡。
- `wbx-setup.mjs`：/wbx 命令 v5 文案；INSTALL-README 可选 cline 段；bundle 根目录与 zip 名 v5。
- 发布物：README 三 lane/故障排查速查表/FAQ 增补；UNINSTALL 登记全部新增物；
  新增 SECURITY.md / CONTRIBUTING.md / CHANGELOG.md。

### v5 实测附录（Phase 5 验收记录，2026-09-25）

**1. Phase 0 清单逐项结论**：见上「调研记录」14 项表格，全部有实测结论；无止损触发
（OAuth 打通、V4.1 Flash 可用——但「免费」未证实，见 #13 如实口径）。附带事故与教训
（`--data-dir` 前置误写用户 `~/.cline`、对照矩阵刷新其 providers.json）已在调研记录披露。

**2. 三 lane doctor 全绿 + 卸载演练**：
- `doctor`（含探测）：ai 8.9s / cn 4.8s / cline 4.6s（deepseek/deepseek-v4.1-flash）全绿，exit 0。
- 卸载演练：`npm uninstall -g cline` → doctor 显示 `[WARN] 可选lane cline 未安装（可选能力，
  不影响 ai/cn）` 且 exit 0；期间 ask 照常走 ai 成功（9.4s）；`npm install -g cline` 重装后
  cline 立即恢复「已登录」（凭证在 `~/.wbx/cline-home/` 未随卸载删除）。
- `config set disabled-lanes ["cline"]` 写入/读回/恢复 round-trip 通过（早前实测）。

**3. 三 lane fanout 分布**（编排侧子代理消费同步验收）：fresh 子代理实例管理 6 任务批次
（构造 tasks.json → fanout → 逐份校验 → 仅回传摘要），job `20260925-130324-82m`：
**6/6 成功、13.2s、ai×2 + cn×2 + cline×2 三 lane 均匀分布、零回退零重试**；cline 任务
6.5–6.6s/5.5k tokens 级。子代理还独立发现并上报了 summary 超时显示 bug（已修）与
「全局形态当时仍为 v4、应改用项目 v5 入口」的执行偏差——管理层效率模式（主会话只收
25 行摘要）实效成立。

**4. cline 命令行落地证据**（thinking=xhigh/compaction=off）：job `20260925-125152-d3z`
的 `ask.cline-stream.jsonl`（21,979 字符 stdin 通道）与 job `20260925-130529-fgy`（T7 评审
×2）均由桥以 `--json -P cline -m deepseek/deepseek-v4.1-flash --auto-approve false
--thinking xhigh --compaction off -t N -c <workdir>` 发出；原始事件流随 job 落盘可回放。

**5. PROMPTS.md v2 + 自举记录**：原则 12 条（P1–P8 原文未动 + P9–P12）、模板 T1–T9（含填好
示例）、经验条目 E-001–E-010（全部带真实来源，含本窗口新踩的 E-005 错误样例误判、E-006
cline 四坑）、沉淀闭环、决策速查表 + 3 项 checklist。实施期自举外包任务（≥3 要求，实际 5 批）：
| job | 任务 | 用途 |
|---|---|---|
| `20260925-115826-idp` | p2-t7t9-templates（✅）、p2-t8-template（✅）、p1-ndjson-parser（❌ 见 E-005） | PROMPTS v2 的 T7/T9/T8 初稿 + NDJSON 解析器初稿 |
| `20260925-120106-jh7` | p1-ndjson-parser（✅） | NDJSON 解析纯函数（审查修订后集成进 wbx-core） |
| `20260925-121458-hyq` | p4-security/contributing/changelog（✅✅✅）、p4-readme-additions（❌ E-005） | SECURITY/CONTRIBUTING/CHANGELOG 初稿 |
| `20260925-125953-mij` | luhn-a/luhn-b（✅✅） | T8 best-of-N 双份生成 |
| `20260925-130529-fgy` | t7-luhn-a/t7-luhn-b（✅✅） | T7 评审批判 ×2（走 cline lane） |

**6. best-of-N 与评审常规化实效**（评审记录全文：实施期临时产物
`%TEMP%\wbx-v5\reviews\luhn-best-of-n.md`）：lib/luhn.js 同契约双份（A 可读性侧重@ai、
B 边界完备侧重@cn），**两份均 12/12 契约断言独立运行通过**；T7 评审（cline lane）A 份
1 建议 0 阻断、B 份 3 建议+1 UNKNOWN 0 阻断；按「契约通过率→边界覆盖→可读性」**选 B**
（边界显式枚举完胜、可读性微弱劣势不抵），落选份归档不删，三条建议逐条处置。
T7/T8/T9 模板与防护（择优必走 T7、单一写者接管）全部按 PROMPTS.md 执行。

**7. 全命令回归（改桥后）**：4 脚本 `node --check` 通过；doctor（含/不含探测）、config 七个
cline-* 键 round-trip、`default-lane cline` 写读恢复、ask 短提示词（ai 9.0s）、models 探测、
history 列表+双向回放（含 cline 任务）、fanout `files` 字段回归（材料读档正确、答案核对通过）、
UI 冒烟（/api/status 三 lane ready、/api/history 37 条）、export-bundle（11 文件、零凭证断言
**比对 9 个 token**——v5 起含 cline OAuth token）、发现并修复 v4 遗留 summary「单任务超时」
二次除法显示 bug（600s 显示 0.6s）。

**8. 全局形态幂等同步**：项目 v5 `self-install` → `~/.zcode/wbx-bridge/` v5.0.0（scripts +
examples + PROMPTS.md + docs）、用户级 skill SKILL.md + PROMPTS.md v2、`/wbx` 命令 v5 文案、
`~/.zcode/AGENTS.md` 标记块 v5（三 lane 子代理 + 默认分派措辞，核验 2 处命中）、`~/.wbx/`
凭证原样（ai/cn/cline 三绿）；全局入口 doctor 通过；重跑覆写幂等。

**9. 触发面静态核验**：项目 AGENTS.md（4 处）、项目 SKILL.md（6 处）、用户级标记块模板（2 处）、
/wbx 命令模板（1 处）均含「默认分派/单个也直接派」意图；止损与涉密防护措辞逐处保留。

**10. GitHub 发布与审计**：白名单逐文件 `git add`（16 文件：根 9 + 技能目录 7，`git ls-files`
逐项对照一致）→ 五套敏感审计 `git grep --cached` 零命中（人名/账号/机器路径/邮箱/uin 脱敏形态；
`~/.wbx/cline-home` 命中均为文档路径说明，凭证值级检查（token 字段带值、账号 id、40+ 随机串）
另跑一轮零命中）→ commit `cda9e53` → push → `gh api` 线上校验 sha 一致 + 本地远端零差异 +
**对 origin/main 重跑审计三套零命中** → tag `v5.0.0` → release（notes 引 CHANGELOG 摘要，
附件 `wbx-bridge-v5-20260925.zip` 279KB/11 文件/零凭证断言比对 9 token）→ description 更新
三 lane 口径、topics 增 `cline`（`ai-agent`/`windows` 已在列，不重复）。

**11. 「新人 10 分钟」走查**：按发布后 README 逐步实测——`git clone`（3s，16 文件齐全）→
全新运行时（WBX_HOME 指向空目录模拟新机）`doctor`（0s，各 lane 正确给出对应 login 指引、
cline 段按装/未装显示正确状态、exit 1 符合「无可用 lane」语义）→ 已登录机器形态 `ask` 首条
（10s，ai lane 正确作答）。**机械步骤合计 ~13 秒**，10 分钟预算内余量充足；仅登录步骤需
真人操作（README 已逐条写明），无超时步骤，无需回写。

---

## v5.1 章：cline lane 免费孪生（cline-free）· 免费模型可观测与可选

> 策划材料：`internal/RESEARCH-V6.md`（孪生机制/清单端点/先例仓库/已排除路线，均经策划窗口
> 2026-09-25 实机核实）。版本号 **5.1.0**（「V6」仅为策划编号，不进产品版本）。

### v5.1 定位说明

v5 遗留错误：模型探测用了**计费孪生** `deepseek/deepseek-v4.1-flash`，得出「CLI 侧无免费
模型」的错误结论——错的是 id，不是路线。Cline 按**模型 id** 计费：同一模型有两个 id
（付费 id 与 `cline-free/` 前缀免费孪生），免费孪生 `cline-free/deepseek-v4.1-flash`
实测 totalCost=0。v5.1 做四件事（用户定案，不扩大范围）：

1. **默认免费**：`cline-model` 缺省默认切为免费孪生；存量 config 一次性迁移（仅旧值恰为
   v5 计费孪生时改写，显式其他值不动）。
2. **可观测**：`wbx models --as cline --free` 实时列免费组（recommended-models 端点，token
   只用不打印；失败降级缓存）；doctor 校验默认孪生是否仍在免费组（免费组限时轮换的防护）。
3. **可选**：Web UI 状态页 cline 卡免费模型下拉（选中即写 `cline-model`；非 DeepSeek 项标注）。
4. **状态机**：免费档超额/轮换错误分类（`free-limit`/`free-promotion-ended`/`model-not-found`）
   与用户提示；红线断言——cline lane 内部任何失败路径不得用非 DeepSeek 模型顶替
  （跨 lane 回退 ai/cn 保留，仍是 DeepSeek）。

### 调研补充（策划窗口核实，来源见 RESEARCH-V6 第一部分）

- **孪生机制**：先例仓库 ErfanBagheri404/ClineDesktop2API README 原文——"Cline bills by
  model ID: deepseek/deepseek-v4.1-flash is metered, cline-free/deepseek-v4.1-flash is not."
- **清单端点**：`GET https://api.cline.bot/api/v1/ai/cline/recommended-models`（Bearer OAuth
  accessToken，即隔离 providers.json 的 `settings.auth.accessToken`），返回
  `{recommended,free,clinePass,clineCloud}` 四数组，元素 `{id,name,description,tags}`。
- **官方文档**（docs.cline.bot/getting-started/free-models.md）：免费模型面向任何账户，限时
  促销轮换+用量配额；官方明确支持 CLI（/settings 选择）、明确「Free model usage is not
  supported through the Cline API」；**免费用量可能被用于改进模型**（隐私披露，已写入
  README/UI/安装说明）。
- **已排除路线**（理由见 RESEARCH-V6 附录 A.1）：SDK 直调 / 直连公开 API 走免费档 /
  本地反代 / 桌面 App 逆向——CLI 原生支持免费孪生，一步到位。

### Phase 0 实测记录（2026-09-25，执行窗口，cline 3.0.65 / Node v24.19.0 / Windows 11）

| # | 事项 | 实测结论 |
|---|---|---|
| P0-1 | 基线复测 | doctor 三 lane 全绿（ai 9.4s / cn 5.4s / cline 5.0s）；`ask --as cline`（免费 id）×2 成功，model=cline-free/deepseek-v4.1-flash、**totalCost=0**、4.7-4.8s、中文正确（job 20260925-141952-723 / 20260925-141956-2zc） |
| P0-2 | 孪生存在性 | recommended-models 端点 HTTP 200；免费组 5 个：`stealth/space-bunny-alpha`、`cline-free/mimo-v2.6-flash`、`cline-free/deepseek-v4.1-flash`（目标在列）、`cline-free/gemini-3.8-flash`、`cline-free/muse-spark-1.3-contributor`（与策划窗口数据一致） |
| P0-3 | 轮换下线演练 | 以不存在 id `cline-free/deepseek-v4.1-flash-rotated-away` 探测：exit 1、桥分类 cli-error、错误消息 `model not found`；NDJSON 形态 = `agent_event.error.message:"model not found"` + `run_result.finishReason:"error"`（512ms 即失败，不耗额度）——P0-1 存在性校验的降级设计取证完成 |
| P0-4 | 额度边界探测 | **节约模式分档递进，20 次成功免费调用全部 totalCost=0、无任何警告事件**（4.1-6.1s/次，16 连发批次 77s）——记录「20 次内未见限制」即停（红线：不打爆用户当日额度） |
| P0-5 | 超额错误形态 | **未实测到边界**（额度 ≥20 次/日）。形态改为二进制内证（cline.exe 符号与消息模板）：`ClineFreeModelLimitError` 类 + 确切消息「`Daily free model limit reached` / `You've reached today's free usage limit for this model.` / `Try again in <时长> or select another model.`」；轮换下线消息「`Free model promotion ended` / `The free promotion for this model has ended and it is no longer available.`」——状态机按真实消息字符串设计，并如实标注「边界未实测到」 |
| P0-6 | 无空格怪癖防护 | v5 调研 #9 的「无空格短中文被当未知子命令」复现（ask 提示词无 ASCII 空格 → cli-error 回退 cn）；**前缀一个空格实测可用**（completed、$0、2.5s）——v5.1 已在 askOnceCline 加防护 |
| P0-7 | 附带发现 | undici fetch（全局连接池）+ 随后 `process.exit` 在 win32 触发 libuv 断言（`async.c` `!(handle->flags & UV_HANDLE_CLOSING)`、exit 127）——最小复现在案；解法：目录拉取走 `node:https` 单次连接（不走 fetch/httpJson），登录流 httpJson 不受影响 |

### 设计决策（Phase 1）

1. **默认值与迁移（P0-2）**：`CONFIG_DEFS['cline-model'].default` = `cline-free/deepseek-v4.1-flash`；
   loadConfig 容错处一次性迁移——**仅当** config 现值恰为 `deepseek/deepseek-v4.1-flash`（v5
   写入的计费孪生）时改写为新默认、写回 config.json 并打印 `[MIGRATE]` 一行（写回保证只发生
   一次）；显式设置的其他值一律不动。空值/缺省回落新默认（P1-6 默认值切换的语义）。
2. **清单不硬编码（P0-5）**：免费组轮换 → 每次实时调端点；成功写缓存
   `<运行时根>/cline-free-models.json`（无凭证），端点失败读缓存降级（注明时间戳），再失败
   明确报错（不崩溃）。token 只用不打印（沿用凭证红线）。
3. **超额状态机（P0-3）**：错误分类优先级 auth → free-limit（含
   `extractFreeLimitResetIn` 从「Try again in X」提取重置倒计时透出）→ free-promotion-ended
   → model-not-found → ratelimit；ask/fanout 命中时给用户可操作提示（等待重置/换免费模型/
   查清单）。**跨 lane 回退语义不变**：free-limit 照常回退 ai/cn（仍是 DeepSeek 且 ai 免费，
   符合用户定案）——文档写明。
4. **非 DeepSeek 禁回退（P0-4，用户定案红线）**：cline lane 失败路径绝不换模型 id
   （`askOnceCline` 的 `-m` 恒为 config/任务指定值）；`fallbackLane` 只换 lane（ai/cn）。
   代码注释 + 回归断言（见验收记录）双保险。**UI 下拉与 `--free` 清单里的非 DeepSeek 项
   仅限用户手动选择**——断言约束的是桥的自动行为，不限制用户手选。
5. **doctor 存在性校验（P0-1）**：cline 段已登录时新增一行——当前 `cline-model` 在免费组
   `[OK]`（注明来源 端点/缓存）；不在组 `[WARN]` + 列出当前免费 id + 换用命令；端点失败
   `[WARN]` 降级。均不影响 exit 0（cline 仍是可选 lane 语义）。cline 探测行新增本次计价
   （$0 标「免费」）。
6. **zip/bundle 命名带全版本**：`wbx-bridge-v5.1.0-<日期>.zip`（此前 v5 系列名不含补丁号）。

### 桥改动清单（Phase 1，四模块内，不新建文件）

- `wbx-core.mjs`：`WBX_VERSION` 5.1.0；`CLINE_FREE_DEFAULT_MODEL`/`CLINE_METERED_TWIN_MODEL`
  常量与注释；config 默认值 + 迁移 + 写回；`httpsGetJson_()`（node:https 单次连接，绕开
  undici/libuv 断言）；`fetchClineFreeModels()`（端点+缓存降级，token 只用不打印）；
  `isFreeLimitError/isFreePromotionEndedError/isModelNotFoundError/extractFreeLimitResetIn`；
  `askOnceCline` 失败分类扩展（hint/resetIn）+ 无空格提示词前缀空格防护；runAskJob 传播
  resetIn；doctor cline 段存在性校验 + 探测计价；`fallbackLane` 红线注释；
  `laneStatusInfo('cline')` 成本口径；用户级标记块措辞。
- `wbx.mjs`：`models --as cline --free`（清单+当前值标注+非 DeepSeek 标注）；ask 失败
  `hintText()`（含 free-limit 带重置时间、promotion-ended、model-not-found 文案）；HELP
  三处口径；login cline 提示；`--free` 参数解析。
- `wbx-ui.mjs`：`/api/status` 新增 `clineFreeModels`/`clineFreeModelsNote`（server 侧端点
  调用，失败空数组+提示）；cline 卡成本行改免费口径 + 免费模型下拉（选中即 POST
  /api/config 写 cline-model，非 DeepSeek 标注「（非 DeepSeek）」）；登录页 cline 指引更新。
- `wbx-setup.mjs`：INSTALL-README cline 段免费口径 + 隐私披露；zip/bundle 名带 WBX_VERSION。

### v5.1 验收记录（Phase 3 回填，2026-09-25）

**1. 四类断言回归（internal/v6-regression.mjs，24 PASS / 0 FAIL）**：

- **① 存量迁移（沙箱 WBX_HOME）**：旧值恰为计费孪生 → 打印 `[MIGRATE] cline-model：检测到
  v5 计费孪生 deepseek/deepseek-v4.1-flash，已改写为免费孪生 cline-free/deepseek-v4.1-flash
  （仅此值迁移，显式设置的其他模型 id 不动）`、stdout/落盘均为免费孪生；**二次运行不再迁移**
  （幂等）；显式 `cline-free/mimo-v2.6-flash` 不被迁移；缺省/空串回落新默认。
- **② 免费 id 缺失降级（真实运行时根，改后即恢复）**：config 临时设为不存在 id → doctor
  `--no-probe` exit 0 且输出 `[WARN] 免费模型 cline-model=…-rotated-away 不在当前免费组
  （可能已被轮换下线，或为计费 id）。当前免费：stealth/space-bunny-alpha、…（全清单）+
  换用指引`；ask `--as cline` 命中 `model not found` 后自动跨 lane 回退 ai/cn 成功
  （`[FALLBACK] 主 lane cline 失败`）；恢复后 config 原样。
- **③ 超额状态机（真实二进制消息模板模拟）**：`isFreeLimitError` 命中
  「Daily free model limit reached…Try again in 2h 30m…」；`extractFreeLimitResetIn`
  提取 `2h 30m`；`isFreePromotionEndedError` 命中「Free model promotion ended…」；
  `isModelNotFoundError` 命中实测形态「model not found」；正常文本零误判；通用 429 仍走
  ratelimit；NDJSON 模拟事件（agent_event.error + run_result error）解析出消息文本。
- **④ 非 DeepSeek 禁回退**：`fallbackLane('cline')` = `cn`（只回 ai/cn）；`askOnceCline`
  内 `mdl` 只赋值一次、`'-m'` 只出现一次（失败路径无模型替换逻辑）；`fetchClineFreeModels`
  返回结构无 token 字段。

**2. v5 全命令回归（零回退）**：4 脚本 `node --check` 通过；doctor（含探测：ai/cn/cline 三绿
+ 免费模型存在性行 + cline 探测计价 `$0.000000（免费）`，exit 0）；ask 默认路径（ai 10.4s）、
`--as cline`（免费孪生 4.7s、$0）、无空格中文提示词直达 cline 成功（v5.1 新防护）、
`config set default-lane cline` 后 ask 走 cline（4.7s）再恢复 auto；fanout 3 任务三 lane
混合 + `files` 材料拼接（3/3 成功、9.8s、材料标题读取正确，job 20260925-144030-2mt）；
models `--as cline --free`（5 个、非 DeepSeek 标注、当前值 *）/ `--probe`（计价显示）/
默认 ai；config 七键 round-trip（default-lane、disabled-lanes、cline-model）+ UI API 写
cline-model 生效；history 列表 + `--task` 定向回放；UI（/api/status 含 clineFreeModels 5 项
+ note、cline 卡下拉存在、POST /api/config 写回成功）；export-bundle
（wbx-bridge-v5.1.0-20260925.zip、11 文件、零凭证断言比对 9 token）。

**3. UI 免费模型选择器验收**：/api/status 新增 `clineFreeModels`（5 项，非 DeepSeek 4 项带
标记）与 `clineFreeModelsNote`（空=端点正常）；页面 cline 卡渲染 `<select id="cline-free-select">`
（当前值 selected）；选中 → POST /api/config `{key:'cline-model'}` → config.json 写入生效
（实测回读一致）；清单不可用时降级为提示文字（含命令行替代方案）。

**4. GitHub 发布与审计**：白名单逐文件 `git add`（11 个修改文件；无新增文件，白名单 16
文件不变，`git ls-files` 逐项对照一致）→ staged 敏感审计零命中（六套：人名/账号
`jaferpentz|FireChou|周燎原|Lenovo|Agent Vault|Yglstr`、邮箱正则、`D:\Download`、
`C:\Users\Lenovo`、uin 脱敏 `33**54|45**32`、`usr-01M2X`）+ 凭证值级
（`accessToken"…"20+ 字符`形态）零命中 → commit `86356e6` → push → `gh api` 分支 sha
与本地一致（86356e6c2ae…）→ **origin/main 远端复扫六套零命中** → tag `v5.1.0` → release
（notes 引 CHANGELOG + WBX 链接，附件 `wbx-bridge-v5.1.0-20260925.zip` 320KB/11 文件/
零凭证断言比对 9 token）→ description 更新（「可选 Cline CLI 免费孪生」口径；topics 已含
cline/deepseek/cost-saving 无需新增）。

**5. 全局形态幂等同步**：项目 v5.1 `self-install` → `~/.zcode/wbx-bridge/` v5.1.0（scripts +
examples + PROMPTS.md + docs）、用户级 skill、`/wbx` 命令、`~/.zcode/AGENTS.md` 标记块
（免费孪生措辞，核验命中）；全局入口 doctor 通过（含免费模型存在性 `[OK]`）；`~/.wbx/`
凭证原样三绿。

**6. 自举记录（wbx 外包，材料先行，逐份校验后采用）**：

| job | 任务 | 用途 |
|---|---|---|
| `20260925-143219-fuo` | e011-revise（✅）、faq-free-rewrite（✅） | E-011 修订草稿 + README「真的免费吗」改写草稿（ai lane，各 35-44s；ZCode 审校微调后集成） |

**7. 如实声明**：免费额度边界未实测到（当日 20 次成功调用全部 $0，节约模式即停）；超额
错误形态（消息模板与类名）取自 cline 3.0.65 二进制内证，状态机按真实消息字符串设计——
若线上实际报文与此不符，`hint` 兜底为通用 `ratelimit` 分类（仍能触发跨 lane 回退），不崩溃。

## v5.2 章：控制台常开可用（守护化 + 随 ZCode 自启）· 全面中文化与命名统一

> 版本 v5.2.0（2026-09-25，GOAL-V7）。策划材料：`internal/RESEARCH-V7.md`（含四份外部算力调研原文
> `internal/archive/v7/v7-research-*.md`，fanout job `20260925-150220-x87`）。一句话：本地控制台从「输命令才可用」
> 变为「浏览器直接开 127.0.0.1:7788 就在、打开 ZCode 自动拉起」，界面全面中文化、通道命名统一为品牌名。

### 1. 第一性原理与方案选型

- 「打开网址就能用」的本质是**服务已在你需要之前存在**。三条路径（系统常驻 / 宿主拉起 / 按需手动）中
  选**宿主拉起**：ZCode 已有 SessionStart 钩子机制，把启动做成宿主的幂等副作用是最小充分解——
  不装服务、不写注册表、不动环境变量（被否决备选见 RESEARCH-V7 附录 A.1）。
- 钩子是内联执行的（官方文档明示 `async` 无运行时效果），钩子命令必须秒回——后台化由 `ui --detach`
  在 Node 内部完成（detached spawn + unref）。这决定了「**永远复用绝不新起**」的幂等性是全方案
  最关键性质：没有它，每次会话启动都会泄漏一个进程。
- Jupyter 式端口顺延明确不做：固定 7788 是「浏览器直接开网址」的前提（A.2）。端口被外程序占用时
  fail fast 明确报错，不静默换端口。
- 中文化只动**展示层**：数据层（manifest.type='ask'、API 字段、config 键）一律不动——历史回放、
  文档、脚本兼容全靠它；翻译集中在 wbx-ui.mjs 前端一处映射表。
- 命名公式：**品牌（版本）全称**用于卡片标题（WorkBuddy AI（国际版）/ WorkBuddy（国内版）/
  Cline CLI（可选通道）），**品牌短称**用于窄栏位（WorkBuddy AI / WorkBuddy / Cline）；同一概念
  全站唯一译法；中文界面不出现裸 lane/ai/cn/cline（必要处用「通道」）。
- 项目形态定性（写进 README）：Skill（带脚本）+ Node CLI + AGENTS.md 常驻块 +（v5.2 起可选）
  SessionStart 自启钩子，四层职责分离；非 MCP/plugin/command（论证见 RESEARCH-V7 1.1 与
  v7-research-skill-vs-plugin.md §2）。

### 2. Phase 0 待实测点结论（全部实测通过，探测脚本 internal/archive/v7/v7-phase0-probe.mjs）

| 待实测点 | 实测结论 |
|---|---|
| `process.kill(pid,0)` 语义 | 自身 pid 探测成功；死 pid/已退出子进程均报 **ESRCH**（EPERM=存在但无权限，判活按「非 ESRCH 即活」） |
| NTFS `wx` 互斥竞态 | 对已存在文件 3 次并发打开全部 EEXIST；**3 进程竞态恰好 1 个赢家**（CreateDisposition CREATE_NEW 语义，跨进程互斥成立） |
| `listen exclusive:true` 跨进程 | 子进程监听后父进程再绑同端口报 **EADDRINUSE**（fail fast 可行；也再次实证了端口被占的明确报错路径） |
| windowsHide+detached | 子进程存活、unref 后父进程可独立退出；窗口可见性属人眼项，以 windowsHide 语义为准 |
| 绑 127.0.0.1 防火墙弹窗 | 回环绑定不注册防火墙关注面（设计层结论；本机全程未见弹窗） |
| 睡眠唤醒后套接字存活 | 无法程序化复现；设计上由三条件判活 + startedAt 跨重启判废自愈兜底（接受重启机器为最终回收） |
| 基线 | doctor 三 lane 全绿；ui 前台模式（GET / 200、/api/status 正常）；清理了 7788 端口上一个 **v4.0.0 时代的 ui 孤儿进程**（守护化要解决的孤儿问题的活案例）；`~/.zcode/cli/config.json` 仅 `plugins` 键无 hooks |

### 3. 设计与实现

新增脚本 `scripts/wbx-daemon.mjs`（纯函数集 + 生命周期 + 钩子安装器）；`wbx-ui.mjs` 加安全校验与
health/shutdown；`wbx.mjs` 加 CLI 分派；`wbx-setup.mjs` 文件清单 + 卸载顺序。

- **状态文件** `~/.wbx/run/ui.json`：`{pid, port, startedAt, token, version}`。三条件判活（状态文件
  parseUiState 通过 + `kill(pid,0)` 存活 + `GET /__health` 返回 `{app:'wbx-ui'}` 且 pid 匹配）+
  `startedAt < now - os.uptime()` 判跨重启残留。决策真值表 `decideExisting` →
  none（直接起）/ reuse（永远复用）/ replace（清残留重起）/ conflict（绝不杀未知 pid，交给 --stop/人工）。
- **`ui --detach`**：探测 → reuse 即复用返回；replace 清状态；spawn
  `node wbx.mjs ui --daemon --port N`（detached+unref+windowsHide，stdio 全落
  `~/.wbx/logs/ui.log`，绝不 shell）；等就绪预算 3.5s（钩子 timeoutMs 5000 内必须返回）；子进程
  EADDRINUSE 退出（码 78）时复探——命中则「复用」（并发 --detach 竞态自洽），否则明确报错。
  **永远 exit 0**（它是 SessionStart 钩子路径，异常只落日志/stderr）。
- **`--daemon`**（内部）：uncaughtException 落盘+清状态+exit 1；unhandledRejection 只落盘；
  bind 成功后才写状态文件（bind 即单实例互斥赢家）；每小时检查日志 >10MB 截断。
- **`--stop`**：HTTP `/__shutdown {token}` 优雅关闭优先；kill 兜底**仅当能正向证明 pid 归属**
  （health OK 且 pid 匹配——Windows pid 复用下绝不误杀无辜进程，证明不了就清状态+人工指引）。
- **安全校验**（前台/守护一律生效）：Host 头白名单恰为 `127.0.0.1(:port)/localhost(:port)`
  （大小写不敏感，拒 IPv6/尾点/userinfo/其他端口——防 DNS rebinding）；POST 一律 Origin 校验
  （同源或空）；`/__shutdown` token 用 Buffer 字节长度对齐 + timingSafeEqual；只绑 127.0.0.1 +
  `listen exclusive:true`。
- **自启钩子**：`--install-autostart` 对 `~/.zcode/cli/config.json` 读-改-写合并，追加
  `hooks.events.SessionStart` `{matcher:'^startup$', hooks:[{type:'process', command:<node.exe>,
  args:[<全局形态 wbx.mjs>,'ui','--detach','--no-open'], timeoutMs:5000, statusMessage:'wbx 控制台保活'}]}`。
  合并铁律：既有键绝不删除/改写；按 command 路径幂等去重（我们自己的旧条目允许更新对齐）；
  既有结构类型异常（SessionStart 非数组等）中止且不写文件；`hooks.enabled` 仅当键**缺失**且无其他
  钩子时置 true（用户显式 false 一律不翻转，如实告警），并以 marker 文件
  `~/.wbx/run/autostart-enabled-by-wbx` 记录 `enabledBefore`，`--remove-autostart` 按记录逐键还原。
  钩子命令输出走 stderr、stdout 保持空（宿主对钩子 stdout 按 JSON 严格 schema 解析）。
- **中文化映射**（前端一处）：`LANE_LABEL/LANE_TITLE/TYPE_LABEL/TASK_STATUS_LABEL/JOB_STATUS_LABEL`
  五表 + `errorHint`（v5.1 超额三类错误的 UI 侧友好提示，与 CLI hintText 同源语义）；
  effort 选项译低/中/高（补显式 value 属性防提交值漂移——worker 映射清单抓到的关键坑）；
  D3：doctor 人读输出通道段统一品牌全称（`--- 通道 WorkBuddy AI（国际版） · x0.00（免费） ---`），
  机器可读输出（steps/laneRows JSON）不动。
- **纯函数质量流程**：parseUiState/isStaleState/hostHeaderAllowed/originAllowed/decideExisting
  契约 72 断言测试台（internal/archive/v7/v7-pure-tests.mjs）跑三份实现——T8 双份 worker（各 69/72：多余字段
  丢弃、host 空格不容忍、origin 大小写不归一）vs 编排器参考实现（72/72，含多余字段保留的向前兼容），
  择优采纳后者；T7 评审批判报 2 阻断 + 6 建议**全部修复**（stopUi 误杀风险、marker 原值记录与
  显式 false 不翻转、token 字节对齐、login TOCTOU、config 键原型链、钩子超时预算、daemon import
  归 try、日志增长防护）。

### 4. 实测门禁记录（真机）

- 守护链路：status 未运行 → detach 冷启动 → 二次 detach 复用同 pid（幂等）→ status 运行中
  （pid/port/version/startedAt）→ 恶意 Host 403 / 恶意 Origin POST 403 / 错 token shutdown 403 /
  同源 POST 200 → 裸 `ui` 打印 URL 退出 → `--stop` 优雅关闭端口释放 → status 未运行。
- 陈旧自愈两型：伪造死 pid 状态 → status「残留（可自愈）」→ --detach 清理重起；taskkill 硬杀
  daemon 后 --detach 复起成功。
- 钩子合并/还原：临时副本五场景 24 断言全过（internal/archive/v7/v7-merge-tests.mjs）——全新 config（装→幂等→
  摘除**逐字节还原**）；存量他人钩子 + enabled:true（他人条目原样、enabled 不动、逐字节还原）；
  enabled:false（不擅自翻转）；畸形结构（中止不写）；未装时摘除（无操作不写）。
- 真机钩子：安装后 config.json 与官方 schema 逐字段一致（zcode-guide:diagnosing-hooks 核对）；
  以宿主执行方式（直接 spawn node.exe + 参数向量）实测钩子命令：冷启动 **477ms**、二次 **146ms**
  （均 < 2s 门禁），exit 0、stdout 为空；URL http://127.0.0.1:7788 可达；
  `--remove-autostart` 后与安装前 **diff 逐字节一致**，重装即交付态。
- 如实声明：「随 ZCode 自启」的完整链路（宿主真实触发 SessionStart → 钩子拉起）中，宿主侧触发
  无法在本会话内自证（需要新开一个 ZCode 窗口观察）——配置格式按本地官方指南逐字段核对、命令
  执行/时序/幂等均已按宿主执行方式实测；降级路径：即使钩子不触发，手动 `wbx ui --detach` 一次
  即等效（幂等常驻）。

### 5. 红线遵守

daemon 只绑 127.0.0.1；不装服务/不写注册表/不加计划任务/不动系统环境变量；config.json 只做
读-改-写合并且卸载可逐键还原（diff 实证）；token 只存 ui.json（gitignore 运行时目录），绝不打印
/不入库；中文化仅展示层（数据层/API 字段/config 键零改动，旧 job 回放验证见验收附录）；
v5.1 对外行为零回退（免费孪生默认、迁移、超额 hint、非 DeepSeek 禁回退均未触碰）。

### 6. 验收附录（证据回填）

**1. 四类新断言回归（internal/v7-regression.mjs，27/27 全过）**：
- ①幂等/复用：清场后连续 `--detach` 两次——首次「已后台启动 pid X」、二次「复用 pid X」（同 pid）；
  状态文件 pid 稳定；`netstat` 7788 单监听；`/__health` 返回 `{app:'wbx-ui',pid,port,version:'5.2.0'}`
  且 pid 匹配。
- ②陈旧自愈两型：伪造死 pid（4194303）状态 → `--status` 报「残留（可自愈）」→ `--detach` 清理重起
  （新 pid）；伪造「存活但无关」pid（回归进程自身 pid）→ `--detach` 走 conflict 报告、绝不杀该进程
  （进程存活自证）→ 清状态后正常起。
- ③安全攻击面：恶意 Host（evil.com）403、正常 Host 200；伪造 Origin（http://evil.com）POST 403、
  同源 localhost 形态 POST 200；错 token / 无 token `POST /__shutdown` 均 403 且守护存活；
  IPv6 Host 形态（[::1]:7788）403。
- ④钩子合并/还原：临时副本五场景 24 断言全过（internal/archive/v7/v7-merge-tests.mjs，独立脚本被回归
  以子进程调用）——全新 config 装→幂等→摘除**逐字节还原**；存量他人钩子+enabled:true 他人条目
  原样、enabled 不动、逐字节还原；显式 enabled:false 不擅自翻转；畸形结构中止不写；未装时摘除
  无操作不写。

**2. 纯函数契约与择优记录**：契约测试台 72 断言（internal/archive/v7/v7-pure-tests.mjs）跑三份实现——
worker A 69/72、worker B 69/72（共性失分：多余字段丢弃、host 空格不容忍、origin 大小写不归一）、
编排器参考实现 72/72（含多余字段保留向前兼容）→ 择优采纳后者，worker 版本留档
internal/archive/v8/worker-daemon-pure-*.mjs。T7 评审批判报 2 阻断（stopUi 误杀风险、marker 原值）+
6 建议（token 字节对齐、login TOCTOU、config 键原型链、钩子超时预算、daemon import 归 try、
日志增长防护）**全部修复后**复测全绿。

**3. v5.1 全命令回归零回退**：internal/v6-regression.mjs 复跑 **24/24 全过**（存量迁移、免费 id
缺失降级、超额状态机八断言、非 DeepSeek 禁回退四断言、token 不泄漏）；命令批实调——doctor 全探测
通过（三通道段品牌名 + v5.2.0）、`ask --text` 实调成功（lane=ai 9.1s）、`fanout` 2 任务 2/2、
`models --as cline --free` 实时清单 5 项（当前值标 *）、`config set/get` 回环一致、`history` 列表
与 `history <jobId>` 回放正常（**旧 job 20260924-210540-k5e（legacy）回放可读——展示映射兼容
数据层**）、`export-bundle` 12 文件（含 wbx-daemon.mjs）零凭证断言通过、`self-install` 幂等
（用户级 AGENTS 块刷新含 ui --detach 行）。UI 展示/数据层分离断言：页面含品牌全称与中文术语，
`/api/history` 59 个 job 的 `type` 字段仍为英文原始值、job 详情字段原样。

**4. 钩子真机门禁**：安装后 config.json 与官方指南（zcode-guide:diagnosing-hooks）逐字段核对一致
（type:process + args 参数向量 + timeoutMs + statusMessage + matcher '^startup\$'）；按宿主执行
方式直接 spawn node.exe 实测：冷启动 477ms / 二次 146ms（<2s），exit 0，stdout 空、输出走 stderr；
URL 可达；`--remove-autostart` 后与安装前 diff 逐字节一致；重装为交付态。
如实声明：宿主侧 SessionStart 真实触发需新开 ZCode 窗口观察，本会话无法自证——配置格式已按官方
文档核对、命令行为已按宿主执行方式实测；降级路径：钩子即使不触发，手动 `wbx ui --detach` 一次
即等效（幂等常驻）。

**5. Phase 0 待实测点**：全部实测通过（结论见本管第 2 节表格）；7788 端口发现并清理了一个
v4.0.0 时代的 ui 孤儿进程（守护化要解决的问题的活案例）。

**6. 发布证据**：白名单逐文件 `git add`（11 个文件：10 改 1 增——新增
`.zcode/skills/wb-bridge/scripts/wbx-daemon.mjs`；`git ls-files` 17 项逐一对照一致；
`.zcode/plans/` 非本项目产物未纳入）→ staged 敏感审计（人名/账号、邮箱正则、`D:\Download`、
`C:\Users\Lenovo`、uin 脱敏、`usr-01M2X`、cline 凭证实值形态、accessToken 值形态、本机
ui.json token 实值）**零实际命中**（①③④⑤⑥ 仅命中 WBX.md v5.1 附录对审计模式本身的文档引用，
先例一致）→ commit `1acce03` → push → `gh api` 分支 sha 与本地一致（1acce036b705…）→
**origin/main 拉回复扫零命中** → tag `v5.2.0` → release
（notes 引 CHANGELOG + 回归摘要 + 安装指引；附件 `wbx-bridge-v5.2.0-20260925.zip` 372.6KB/
12 文件/零凭证断言比对 9 token）→ `self-install` 终态同步（全局形态 v5.2.0，用户级 AGENTS 块
含 ui --detach 行）→ **全局入口复测**：stop 清场 → --detach 冷启动（pid 49480）→ 二次 --detach
复用同 pid → 页面 200、/api/status v5.2.0 → --status 运行中 → 钩子交付态（enabled=true、
SessionStart 1 组）。

**7. 自举记录（wbx 外包，材料先行，逐份校验后采用）**：

| job | 任务 | 用途 |
|---|---|---|
| `20260925-152646-m4c` | daemon-pure-a（✅ 69/72）、daemon-pure-b（✅ 69/72）、ui-l10n-map（✅） | 纯函数双份（T8）+ UI 全量文案映射清单（映射已逐条终审集成；effort 选项补 value 属性的关键坑即来自该清单） |
| `20260925-153554-8wl` | t7-daemon-review（✅） | wbx-daemon/wbx-ui 评审批判（T7）：2 阻断 + 6 建议全部修复 |
| `20260925-154530-3uf` | readme-form-section（✅）、changelog-52-draft（✅） | README 形态/控制台两节 + CHANGELOG 5.2.0 初稿（ZCode 终审微调后集成） |

## v5.3 章：控制台「产品化」改造（信息架构重排 + 视觉系统）· 只动展示层

> 版本 v5.3.0（2026-09-25，GOAL-V8）。策划材料：`internal/RESEARCH-V8.md`（第一性分析 + P0–P4
> 定案 + 三份 worker 调研采信表，fanout job `20260925-161140-0sp`）；视觉 token 基线
> `internal/v8-dark-theme-tokens.md`（RESEARCH-V8 P2 采信）；施工图 `internal/archive/v8/v8-blueprint.md`。
> 一句话：控制台从「字段平铺的调试页」变为「3 秒回答三个问题（一切正常吗？哪里不对？我现在能
> 干什么？）」的产品级界面——信息架构重排 + 视觉系统升级，**只动展示层**（v5.2 对外行为零回退）。

### 1. 第一性原理与方案定案

- 「这个UI什么鬼」的根因不是翻译（v5.2 已中文化），是**界面形状跟随了数据形状**——状态页是
  `laneStatusInfo()` 字段的直接投影；调试页给字段，产品给结论。改造的本质 = 在「数据 API 不动」
  约束下重排渲染层。
- 信息分层三把尺子（RESEARCH-V8 P0 采信调研 A）：影响「用不用/换不换」决策的进**扫读层**
  （徽标/颜色/单行，零点击可见）；需要确认细节才行动的进**详情层**（默认折叠）；只在排障时才看的
  进**排障层**（折叠+复制）。endpoint、二进制路径、模板有无都属第三层。
- 状态必须有编码梯度：四态形状双编码（●可用/▲降级/■不可用/○已停用，色盲可辨）+ 凭证到期色阶
  四档（>30 绿弱化/8-30 黄/1-7 橙[新增 `--warn2` token]/≤0 红+重新登录内联动作；对标 Let's
  Encrypt/Grafana 30/7/0 惯例）+ 成本三档徽标（免费/近免费/免费·限时配额，原始口径进 title）。
- 视觉系统 = 变量化的节奏：间距/圆角/字阶/状态色全部 CSS 变量（token 表基线含三处对比度修正：
  acc 淡底文字 `--acc-300`、12px 微文本 `--dim-hi`、控件边界 `--line-ctrl`）；分隔线只画组间；
  正常态安静（绿点即可），警告态才允许大声。
- 被否决备选（RESEARCH-V8 第二部分）：前端框架/CDN（违零依赖红线）、拆分 HTML 文件（增大分发面）、
  浅色主题、大改后端 API 喂新 UI（展示层不需要）、移动端响应式、处理截图里的「待分类」白框
  （浏览器插件层，非本项目元素，grep 零命中）。

### 2. 四页重排落地（施工图 internal/archive/v8/v8-blueprint.md）

- **状态页**：①健康总览条（结论句「N/3 通道可用 · 路由」全绿时「一切正常」；三枚 chip 带四态
  形状色+一词信号，锚点跳通道卡；总览按最差态着色）→ ②三通道卡同构瘦身（卡头=品牌全称+状态徽标+
  账号+电源式停用开关[即时写 config]；扫读 3-4 行=成本徽标/模型/凭证到期色阶/cline 免费组信号；
  其余全进 `<details>`「详情与排障」；**异常置顶**——四态×到期复合严重度排序，T7 评审后键闭合：
  ■未登录/已过期 > ▲1-7 天 > ▲8-30 天或 cline 未登录 > ○已停用/未安装[虚线] > ●正常）→ ③路由卡
  （4 选段器+生效说明；固定 X 且 X 已停用时行内黄条）→ ④体检卡（空态三要素+上次时间戳 localStorage；
  结果失败[红默认展开+复制]/跳过/通过三组计数徽标）。
- **调用页**：单卡+模式分段器（单条调用（ask）/批量并行（fanout）——保留括号原语，v7 ⑤b 断言
  零改动通过）；高级折叠带当前值摘要（「默认档 · 自动模型 · 300s」/「并发 2 · 300s」）；结果徽标行+
  markdown 默认 6 行截断可展开+错误框带复制。
- **历史页**：类型徽标化、数字右对齐 tabular-nums、通道分布入详情、任务 ID 窄列+点击复制（CLI
  回放入口保留——策划修正，不采纳 worker 移除建议）；详情手风琴单开（点新收旧），概览→任务→产物三段。
- **登录页**：WorkBuddy 两按钮上下分组（轮询时 disabled+内联 spinner+文案）；cline 命令行引导
  下沉折叠+一键复制。
- **全局**：toast（右下角，info/success 4s、error 常驻+关闭钮）替代全部 alert；details 带
  aria-expanded（动态渲染同步初始化，toggle 捕获阶段监听）；数据加载失败兜态+重试；900px 窄窗
  无横向滚动（.kv minmax(0,1fr)+ellipsis 三件套、表格容器吸收滚动）。

### 3. 执行过程要点

- WBX 全程开启：T7 评审批判施工图（12 条意见采纳 9/否决 1/已一致 2——采纳含 chip 复用四态形状、
  排序键闭合、`--warn2` 橙 token、进行中改空心环[与●可用静默区分]、未安装虚线环、toggle 捕获
  监听[toggle 事件不冒泡]、异常内联 CTA、加载失败兜态、结论句拆降级计数；否决：免费模型下拉
  提到扫读层——RESEARCH-V8 P0 明确定案留详情层，以「切换」快捷链接缓解可发现性）；组件 CSS
  并行 2 份（T8 择优，方案 A 为基线融入 B 的 scrollbar-gutter 细节）。
- 单写者铁律：外包产物逐份校验后由 ZCode 自己集成；`wbx-ui.mjs` 以拼接脚本只替换 `const HTML`
  模板段，后端段字节不动（diff 验证：删除行全部在旧 HTML 段内，`BACKEND TAIL IDENTICAL`）。
- 模板字符串纪律：新前端 JS 零反引号零 `${`（不用模板字面量，全部字符串拼接），反斜杠经
  `String.fromCharCode(92)` 常量构造；每改必跑 `node --check`。
- **v5.2 存量展示 bug 修复**：登录页 cline 命令在模板字符串里被未知转义吞掉反斜杠（线上显示
  `%USERPROFILE%.zcodewbx-bridgescriptswbx.mjs`，curl 实证），v5.3 以源级 `\\` 修正（v8 ⑤f 断言）。

### 4. 验收附录（证据回填）

**1. 回归门禁**：`internal/v8-regression.mjs` **22/22 全过**（①横向滚动结构保障 5 断言
[值列三件套/表格容器吸收/无超宽固定像素/任务行 minmax/main max-width；动态 900px 实测见下]；
②alert 零命中+toast 组件 2 断言；③术语冻结 3 断言[品牌全称三件套/中文术语含单条调用（ask）
批量并行（fanout）思考档提示词/状态术语]；④数据层零改动 2 断言[history type 英文原值 65 jobs/
job 详情 v5.2 平铺契约字段原样]；⑤v5.3 专断言 10 条[总览条/色阶四档/四态形状/aria/零外链/
反斜杠修复/空态文案/token 化/停用开关入卡/路由停用分家]）；`internal/v7-regression.mjs`
**27/27**（⑤a/⑤b 展示层字符串断言**一字未改**即通过——新 UI 保留全部冻结术语原文）；`internal/
v6-regression.mjs` **24/24**；全命令冒烟通过（doctor --no-probe/ask/fanout/models --as cline
--free/config get/history/ui --status·--detach·复用·--stop/export-bundle）。

**2. 浏览器实机走查**（IAB，1440×900；改版前后四页截图对照 `internal/archive/v8/v8-before-*.png` /
`internal/archive/v8/v8-after-*.png`）：RESEARCH-V8 1.2 十项缺陷**逐项消缺**：

| # | 缺陷（v5.2） | 消缺证据（v5.3 实测） |
|---|---|---|
| 1 | 无顶层健康结论 | 总览条「一切正常 · 3/3 通道可用 · 自动路由 → WorkBuddy AI」+3 chips（DOM 快照+截图） |
| 2 | 状态无编码梯度 | 四态形状双编码+到期四档（355 天绿弱化/54 天绿档但徽标安静/停用○灰实测「2/3 可用 · 1 个已停用」） |
| 3 | 成本三种口径 | 三档徽标统一（title 保留原始口径，如「x0.00（免费）」） |
| 4 | 排障信息占黄金位 | endpoint/二进制/模板/思考压缩/登录方式全进默认收起的「详情与排障」 |
| 5 | 长文本撑破布局 | 1440px：sw1430<cw1440；**900px 窄窗：sw890<cw900**（实测两次） |
| 6 | 路由与停用混排 | 路由卡只剩段器；停用=通道卡电源开关；矛盾组合黄条实测（固定 Cline+停用 Cline → 行内警告，恢复后消失） |
| 7 | 首屏 40% 空白 | 体检空态三要素实测（尚未体检+说明+CTA；上次时间戳 localStorage 生效） |
| 8 | 体检一段 pre | 三分组实测（整体徽标「通过」+跳过 1[收起]+通过 10[收起]；失败组空时省略、设计为默认展开+复制） |
| 9 | header 露原始路径 | meta 缩略为「…\.wbx」，title 悬停显全路径 |
| 10 | alert() 弹窗 | 源码零命中；toast info 4s/error 常驻实测 |

交互端到端实测：UI 发起单条调用（成功徽标行+结果+回放命令复制，9.1s）；历史 65 行表+手风琴单开
（点二收一）+三段详情；电源开关停用/启用 cline（chip/结论/卡片置灰联动+config 写入并恢复
`disabled-lanes=[]`）；免费模型下拉切换路径与「切换」快捷链接可用；aria-expanded 全覆盖+翻转
同步。视觉走查另经图像理解模型对四页截图逐页评审：状态页/调用页/历史页/登录页均判「有产品感」，
中等问题 1 项（Cline 卡「切换」竖排）当场修复（`.mini` 加 nowrap+flex:none）后复验通过。
如实声明：美感类结论无法程序化，以截图+评审记录为证；截图右上的白色「待分类」悬浮框经核实为
浏览器插件层元素（代码 grep 零命中），非本项目产物，不在消缺范围。

**3. 数据层与安全面零改动**：`wbx-ui.mjs` 后端 handler 段字节不动（拼接脚本+dff 验证）；
`wbx-core.mjs`/`wbx-daemon.mjs`/`wbx.mjs`/`wbx-setup.mjs` 仅 `WBX_VERSION` 一行改动；
API 断言（v8 ④+v7 ⑤cd）确认 /api/history type 英文原值、job 详情字段原样；v7 ③ 安全面
7 断言（Host/Origin/token 攻击）全过。

**4. 发布与全局形态**：白名单逐文件 `git add`（6 个文件：wbx-core.mjs[仅 WBX_VERSION 一行]/
wbx-ui.mjs/CHANGELOG.md/WBX.md/README.md/AGENTS.md；`git ls-files` 17 项逐一对照一致、无新增
跟踪文件，`.zcode/plans/` 非本项目产物未纳入）→ staged 敏感审计（人名/账号、邮箱正则、
`D:\Download`、`C:\Users\Lenovo`、uin 脱敏、accessToken 值形态、JWT 形态、本机 ui.json token
实值）**零实际命中**（仅 WBX.md 对审计模式本身的文档引用，v5.2 先例一致）→ commit `e7d6c6a`
→ push → `gh api` 分支 sha 与本地一致（e7d6c6a903c7…）→ 远端拉回 diff 为空（identical）+
远端敏感复扫零命中 → tag **v5.3.0** → release
（notes 引 CHANGELOG + 回归摘要 + 安装指引；附件 `wbx-bridge-v5.3.0-20260925.zip` 427.0KB/
12 文件/零凭证断言比对 9 token）→ `self-install` 幂等同步（全局入口 v5.3.0）→ **全局形态
复测**：stop 清场 → --detach 冷启动（pid 40504）→ 二次 --detach 复用同 pid → /__health
v5.3.0 → 页面 200 含 v5.3 标记（ovw/单条调用（ask）等 16 处命中）→ --status 运行中 → 自启
钩子交付态（hooks.enabled=true、SessionStart 含 wbx 命令）。

### 5. 自举记录（wbx 外包，材料先行，逐份校验后采用）

| job | 任务 | 用途 |
|---|---|---|
| `20260925-161140-0sp` | console-ia-principles、dark-theme-tokens、tabs-redesign-plan（3/3 ✅，ai lane） | RESEARCH-V8 P0–P3 的外部依据（策划窗口） |
| `20260925-162259-ob2` | t7-blueprint-review（✅）、css-frag-a（✅）、css-frag-b（✅） | 施工图 T7 评审批判（12 条裁决见本管 §3）；组件 CSS 双份 T8 择优（A 为基线） |

另：视觉走查用了图像理解模型（analyze_image）五次（状态页基线+四页改版后），其意见经实机复核
后采纳（仅「切换」竖排一项属实并修复）。

## v5.4 章：UI 风格契约化（规格文档 UI-SPEC + 机器护栏 ui-contract + 治理登记 FROZEN）

> 版本 v5.4.0（2026-09-25，GOAL-V9）。策划材料：`internal/RESEARCH-V9.md`（第一性分析 + P0–P4
> 定案 + 三份 worker 调研采信表，fanout job `20260925-174048-seu`）；外部调研沉淀
> `internal/archive/v9/v9-worker-design-token-contract.md`（A）/`internal/archive/v9/v9-worker-lightweight-ui-guardrails.md`
> （B）/`internal/archive/v9/v9-worker-agent-goal-prompt-anatomy.md`（C）。
> 一句话：把用户已批准锁定的 UI 风格从「隐式存在于代码里」变成「显式契约」——规格文档（人读唯一
> 真源）+ 机器护栏（断言门禁）+ 治理登记（FROZEN.md），让未来的一切改动只能以「新增/删减内容」的
> 形式发生。代码改动仅 `wbx-ui.mjs` 展示层（token 改名+哨兵注释）+ `wbx-core.mjs` 版本号一行。

### 1. 第一性原理与方案定案（RESEARCH-V9 采信）

- **契约三件套缺一不可**：只写文档不设断言→漂移静默失效；只设断言不写文档→断言成考古谜题；不进
  治理→只是换地方随手改。三者同版次交付。
- **冻「坐标系」不冻「内容」**：冻结 token 键集与语义值、组件类名契约、四页签 IA 与三层分层、四态/
  色阶/成本三档编码、v5.2 术语表；不冻结文案、行数、业务字段。一句话判据（UI-SPEC §5.3）：改动
  会不会让无关页面的截图 diff 变化——会即契约变更（须用户授权），不会即内容级增删（放行）。
- **护栏必须有牙且只咬该咬的**：每族断言红测证明（变异必红+恢复必绿+**负向对照**：改文案/加空行
  必须仍绿）；护栏脆断与护栏无牙同样是失败。
- **无浏览器的天花板如实声明**：程序断言防静默漂移，视觉靠人工清单（UI-SPEC §4.3），两者边界写明，
  不假装覆盖；视觉回归截图 diff 明确不引入（零依赖离线红线/跨 OS 假阳性/性价比，退出条件在案）。
- **代码是唯一真源，实机是感知基准**：`:root` 哨兵块为 token 权威，规格文档是派生快照（头部标
  tokens-sha）；组件核对以浏览器实机（127.0.0.1:7788）为第一参照；护栏与实机冲突走偏差出口
  （改 UI-SPEC+改 ui-contract+重跑红测），不得绕任何一方硬凑。

### 2. 执行过程要点

- **P0 前置清理**：token 语义化改名（`--acc-300`→`--acc-text`、`--acc-600`→`--acc-hover`、
  `--panel2`→`--panel-inset`，值编码名是反模式，趁零消费方窗口改诚实；全站 17 处消费方同步，
  脚本内旧名 grep 零命中）；`:root` 哨兵注释对（`/* @tokens:begin */`…`/* @tokens:end */`，
  注明唯一真源与同步义务）。历史记录（CHANGELOG 5.3.0 条目/WBX.md v5.3 章）中的旧名保留不改写，
  5.4.0 条目写明映射。
- **视觉零变化的方法论**：改名前后同视口（1280×900）9 组对照截图；自写零依赖像素 diff
  （`internal/archive/v9/v9-pixdiff.mjs`：PNG 解析→inflate→反滤波→逐像素比对+差异条带定位
  `internal/archive/v9/v9-bandloc.mjs`）。「调用」页 0 像素差；其余 0.001%–19% 差异逐组归因，关键是**三重
  负向对照**：同代码连拍 0 像素差、同代码双 reload 0 像素差、**旧代码 vs 旧代码跨渲染会话
  0.619% > 改名对 0.293%**——证明稀疏散点为环境级光栅化噪声而非改名效应；大差异组均为已知动态
  内容（体检「上次 N 分钟前」时间戳、体检时长/token 数字、历史表新增一行、呼吸动画相位、
  doctor 空态↔结果态）。最密条带经视觉模型复核（深色背景上的稀疏散点，无文字/形状差异）。
- **P1 规格文档**：材料底稿（`internal/archive/v9/v9-spec-material.md`：token 全表+17→20 组件骨架+术语）
  → fanout 三路初稿（§1/§2/§4）→ ZCode 终审集成（单写者；修正初稿 5 处与代码不符：toast-out
  实为 --t-base 180ms 非 280ms、copybtn 字面 11px、tabs 无 aria-current 不能虚标双编码、
  「机器断言」标记逐条对齐实际断言族、reduced-motion/焦点环不在机器断言内改标人工走查项）；
  实机盘点补入 worker A 清单外的两个真实组件（`.seg` 分段器×3 处使用、`.cost` 成本三档）→ 终稿
  20 组件。§1.1 表 58 行经程序化校验与代码 1:1（名称+值逐项）。
- **P2 机器护栏**：`internal/ui-contract.mjs` 19 条断言（编号枚举 T1-T5/C1-C6/S1-S4/D1-D4；
  worker B 报告标题「18 条」与其枚举差 1，以枚举为准并在此声明）。两处与定案的实机偏差按
  「以实机为准」处理并记录：① T4「:root 外零 hex」实机有 4 处既有 hex（#0b1020×3 主色底墨字/
  #ffb3b3 err-box 亮字，v5.3 已固化）→ 落为 allowlist 冻结（新增 hex 才红），rgb()/具名色直写
  声明为盲区；② S3 状态全覆盖初版误伤登录轮询流（p.status==='timeout' 自带内联文案）→ 收窄为
  任务/job 状态比较（r./j.）。自建过程中发现并修复两处护栏空转 bug：S1 比较含选择器名的整条规则
  （恒不同，检查空转）改为比规则体；C6 切片失效时 T4/C3/C5/D4 空转绿（不存在型断言在空切片上
  恒真）→ 加 sliceAlive 保活前置（M-C6 实测级联 14 条红）。红测协议
  `internal/v9-redtest.mjs`：18 正向变异（每族抽样）+3 负向对照+恢复自证（哈希=基线+重跑全绿）。
- **P2 T7 二审**（job `20260925-182119-pag`）：采纳 4 条——T2 从状态色 17 值扩为**全 58 值逐值**
  （归一化=小写/去空白；闭合「§5.1 声称冻 58 值但机器只冻 17 值」的盲区，仍逐值报差非哈希）、
  C1/C2 选择器匹配空白容差、T4/C3/C5/D4 加 sliceAlive 前置、红测补 M-C3；不采纳 3 条并记录
  理由：T3 单位变化即红（rem/calc 属契约变更，红是正确行为）、C5 拦 data:URI（零外链冻结=任何
  url() 须显式过契约变更流程，by design）、守护 sleep 竞态（v8 同款先例，D2/D3 不可达时明确红）。
- **P0 T7 一审**（job `20260925-180410-ax5`）：无阻塞意见（前提 grep 清零，已达成）；
  `--panel-inset` 语义争议（值比 --panel 亮，是否该叫 raised/surface-2）记录不采纳——全部 10 处
  消费方都是「嵌在父面内的次级面」，inset 表嵌套关系而非视觉凹凸，且层级名会退回刻度命名。

### 3. 验收附录（证据回填）

**1. 改名与哨兵**：脚本内旧名（--acc-300/--acc-600/--panel2）grep **零命中**（历史文档
CHANGELOG 5.3.0/WBX.md v5.3 章按「不改写历史」保留并已注明）；新名 19 行命中；哨兵对在
（页面 served HTML 含 `tokens:begin`）；`node --check` 过；改名 diff 经 T7 一审（见上）；
v8 回归 22/22（⑤h token 断言与改名正交，零改动通过）。

**2. 视觉零变化**：9 组对照截图 `internal/archive/v9/v9-before-*.png`/`v9-after-*.png`（状态/调用/toast/
运行中/历史详情/登录/停用态/体检中/体检结果，1280×900）。像素 diff 结果：调用页
**IDENTICAL**（1152000px 零差）；toast 0.001%/运行中 0.176%（呼吸动画相位，条带 y=401-405
恰为呼吸点位置）/登录 0.006%（文本亚像素）/状态 0.293% 与停用态 0.851%（其中含体检卡
「上次 N 分钟前」时间戳差异+环境噪声）——三重负向对照（连拍 0px、双 reload 0px、旧 vs 旧
0.619%>0.293%）证明散点为环境级光栅化噪声；历史 19.3%（新增一行+详情下移）/体检 6.9%（时长
与 token 计数数字）为已知动态内容。停用开关测试后 config 复原（disabled-lanes=[] 实测）。

**3. UI-SPEC.md**（仓库根，白名单第 18 项）：§0–§6 完整骨架；§0 tokens-sha=`efeee49b0e`
（`internal/v9-tokens-sha.mjs` 重算一致，算法=小写/去空白/按名排序/sha256 前 10 位）；§1.1
token 表 58 行程序化校验与代码 1:1；§2 20 组件×8 字段含「何时不用」+frozen|extension 徽标
（实机盘点核对，含 .seg/.cost 两个清单外真实组件）；§5 含 5 条判定规则+一句话判据+contract
version 语义（破坏→主版本+1/纯扩展→次版本+1/纯内容→不动）+变更程序四步。

**4. ui-contract 红测矩阵**（`internal/v9-redtest.mjs` 输出，`internal/archive/v9/v9-redtest-matrix.md`；
协议=变异→必须红且红得对→恢复→哈希自证→负向对照必须仍绿）：

| # | 变异 | 预期红 | 实际红 | 判定 |
|---|---|---|---|---|
| M-T1 | 新增未登记 token | T1 | T1 | ✅ |
| M-T2 | 状态色值改一位 | T2 | T2 | ✅ |
| M-T3 | --s3 12→40px 破坏递增 | T3 | T3 | ✅ |
| M-T4 | .mini 色直写 #ff0000 | T4 | T4 | ✅ |
| M-T5 | --warn2 值改成=--warn | T2,T5 | T2,T5 | ✅ |
| M-C1 | .ovw 选择器改名 | C1 | C1 | ✅ |
| M-C2 | .tbl-wrap overflow→visible | C2 | C2 | ✅ |
| M-C3 | 新增 width:1200px 字面量 | C3 | C3 | ✅ |
| M-C4 | main 1100px→1400px | C4 | C4 | ✅ |
| M-C5 | 引入 @import | C5 | C5 | ✅ |
| M-C6 | 切片正则失效（HTML 改名） | C6 | C6+级联 13 条（T4/C1-C5/S1-S4/D1/D2/D4） | ✅ |
| M-S1 | .s-sq 形状改同 .s-dot | S1 | S1 | ✅ |
| M-S2 | d<=7 改 d<=8 | S2 | S2 | ✅ |
| M-S3 | TASK_STATUS_LABEL 删 failed | S3 | S3 | ✅ |
| M-S4 | initAria 改名 | S4 | S4 | ✅ |
| M-D1 | 品牌全称改写 | D1 | D1 | ✅ |
| M-D2 | TYPE_LABEL 键 fanout→fan | D2 | D2 | ✅ |
| M-D4 | toast 函数体插 alert() | D4 | D4 | ✅ |
| N-文案 | 一键体检→立即体检 | 必须仍绿 | 全绿 | ✅ |
| N-空行 | 模板内加空行 | 必须仍绿 | 全绿 | ✅ |
| N-顺序 | CSS 属性顺序互换 | 必须仍绿 | 全绿 | ✅ |

恢复自证：每次变异后源文件哈希=基线；收尾重跑 19/19 全绿。D3 无 wbx-ui 域内变异（守护面在
wbx-core 的 API handler），由 D 族抽样（D1/D2/D4）+v8 ④b 同面断言覆盖，如实声明。

**5. 治理与文档**：FROZEN.md 追加「UI 契约冻结」项（2026-09-25，授权来源=用户原话「风格和方向
可以基本锁定」；冻结范围=UI-SPEC §5.1；变更程序四步）；CHANGELOG 5.4.0 条目（含改名映射与
自举记录）；README 控制台节一句指向 UI-SPEC.md；SKILL/AGENTS 无需改动（契约由 FROZEN+SPEC
治理，不进常驻指令）。

**6. 零回退与发布**（2026-09-25 执行）：四门禁终版全绿——v6 **24/24** + v7 **27/27** + v8 **22/22** +
contract **19/19**（含 tokens-sha 复算 `efeee49b0e` 一致）；全命令冒烟通过（doctor --no-probe/ask[stdin
通道「好」]/fanout 1 任务 100%/models --as cline --free[免费组 5 个实时]/config get default-lane=auto/
history/ui --status·--detach 幂等复用同 pid·--stop/export-bundle 430.7KB·12 文件·零凭证断言过[比对 9 个
本地 accessToken 值均未出现；UI-SPEC.md 不进 bundle，符合 P1 裁决]）。发布：白名单逐文件 `git add`
（6 个文件：wbx-ui.mjs[改名+哨兵]/wbx-core.mjs[仅 WBX_VERSION 一行]/UI-SPEC.md[**新增，白名单第 16
项，共 18 项逐一对照一致**]/CHANGELOG.md/README.md/WBX.md；`.zcode/plans/` 非本项目产物未纳入）→
staged 敏感审计（人名/账号、邮箱正则、`D:Download`、`C:UsersLenovo`、uin 脱敏、
accessToken/JWT 值形态、本机 ui.json token 实值比对 `internal/archive/v9/v9-audit-token.mjs`）**零实际命中**
（仅 WBX.md v5.2 章对审计模式本身的文档引用，v5.3 先例一致）→ commit `afa9084` → push → `gh api`
远端 sha 与本地一致（afa9084978ba…）→ 拉回 diff 空（identical）→ 远端敏感复扫非 WBX.md 零命中 →
tag **v5.4.0** → release
（notes 引 CHANGELOG + 验证摘要 + 安装指引；附件 `wbx-bridge-v5.4.0-20260925.zip` 441010B）→
`self-install` 幂等同步（全局入口 v5.4.0）→ **全局形态复测**：--stop 清场 → --detach 冷启动
（pid 26972）→ 二次 --detach 复用同 pid → /__health v5.4.0 → 页面 200 含 v5.4 标记 3 处
（tokens:begin/单条调用（ask）/批量并行（fanout））→ 自启钩子交付态（hooks.enabled=true；
SessionStart 含 wbx.mjs ui --detach --no-open，matcher ^startup$，timeoutMs 5000）。

### 4. 自举记录（wbx 外包，材料先行，逐份校验后采用）

| job | 任务 | 用途 |
|---|---|---|
| `20260925-174048-seu` | design-token-contract@ai、lightweight-ui-guardrails@cn、agent-goal-prompt-anatomy@ai（3/3 ✅） | RESEARCH-V9 P0–P4 外部依据（策划窗口） |
| `20260925-180829-lxf` | spec-sec1-foundations@ai、spec-sec2-components@cn、spec-sec4-guidelines@ai（3/3 ✅） | UI-SPEC §1/§2/§4 初稿（ZCode 终审集成，5 处代码级修正见 §2） |
| `20260925-180410-ax5` | 改名 diff T7 评审批判@ai（✅） | P0 门禁：无阻塞意见；panel-inset 语义争议记录不采纳 |
| `20260925-182119-pag` | 护栏断言清单 T7 二审@ai（✅） | 采纳 4 条（T2 扩全量/空白容差/sliceAlive/补 M-C3）；不采纳 3 条记录在案 |

另：视觉归因用了图像理解模型（analyze_image）一次（最密差异条带复核为稀疏散点无内容差异）。

## v6.0 章：caps 能力分级（L0/L1/L2 契约）· 历史页行内详情

> 版本 v6.0.0（2026-09-25，GOAL-V10）。策划材料：`internal/RESEARCH-V10.md`（Phase 0 探针定案）；
> 探针脚本 `internal/archive/v10/v10p0-p1-codebuddy-tools.mjs` … `v10p0-p4-cline-l2.mjs`（可复跑）；外部调研沉淀
> `internal/archive/v10/v10-worker-firstprinciples-a.md`、`v10-worker-firstprinciples-b.md`、`v10-worker-agentic-safety.md`、`v10-worker-codebuddy-cli.md`、
> `v10-worker-deepseek-toolcall.md`、`v10-worker-glm-prompting.md`。授权原话、caps 三档契约全文、L1 管道
> （CLI/scratch 隔离/轨迹落盘/config 键/doctor 步）、L2 六层防护栈与缓期裁决、PROMPTS v3、UI 契约
> v1.1.0 行内详情改动面见 **CHANGELOG 6.0.0**；本章只记独有内容。

### lane-caps 映射（Phase 0 探针定案，探针可复跑）

| lane | L0 | L1 | L2 | 探针证据 |
|---|---|---|---|---|
| ai/cn（codebuddy） | ✅ 不变 | ✅ 白名单联网+只读 | — 不适用 | p1：工具调用是顶层 `function_call`/`function_call_result` 转录事件（非 message.content tool_use）；p2：四种 permission-mode 实测取 default（最小特权面）；p2c：绝对路径越 cwd 读取进程级 DENIED |
| cline | ✅ 不变 | ❌ `caps-lane-mismatch` 显式报错 | ⏸ 缓期未交付 | p3：`CLINE_COMMAND_PERMISSIONS` 不存在（deny 全失效、del 实删文件）；`-s` 系统边界有效（模型拒读金丝雀）；每命令 30s 超时 + 会话级 `-t` |

L1 工具白名单：`WebSearch,WebFetch,Read,Glob,Grep`。如实声明：WebFetch 在 default 权限档被拒，
联网主力是 WebSearch（PROMPTS E-012）。caps 第一性：**契约不是偏好**——绝不静默降档，L0 确定性
不可协商（v5 基线参数序列字节级不变）；治理冻结于 `internal/FROZEN.md` 二.8。

### 验收附录（证据在案）

- **L0 零回归**：v6 门禁 24 条全绿（含 L0 参数序列字节级不变断言）；L0 冒烟 job
  `20260925-201642-nwp`（lane=ai，caps=L0，无工具轨迹，行为与 v5 一致）。
- **L1 端到端**：ask job `20260925-201509-h7t`（ai，WebSearch×6 + WebFetch×1，轨迹+转录落盘）；
  混合档 fanout job `20260925-201708-nnd`（`l0-baseline`@cn L0 无工具成功 / `l1-news`@ai L1
  WebSearch×2 + WebFetch×1 且结果带来源清单——同批混档路由正确）。
- **门禁矩阵**：v6 24 + v7 27 + v8 22 + ui-contract 23 四门禁全绿；红测 22 变异 + 4 对照全过。
- **发布记录**（2026-09-25）：commit `60c8e5e`（feat: v6.0.0 worker caps tiers + history inline
  details，12 文件 +625/−106）→ 白名单 18 项逐文件 add，staged 全在白名单内（未跟踪残留仅
  `.zcode/plans/`，未入库）→ staged 敏感审计：新增行零命中（WBX.md 5 处命中均为 HEAD 既有的
  审计模式清单引用，非新增）→ push 后 `gh api` 远端校验：远端 blob 清单=本地 18 文件一致，
  wbx-core/wbx-ui/AGENTS/README 远端内容复扫零命中 → tag `v6.0.0` + GitHub Release
  （标题「worker 能力分级 caps（L1 交付 · L2 缓期）+ 历史页行内详情」，notes 引 CHANGELOG，
  附 `wbx-bridge-v6.0.0-20260925.zip`——export-bundle 零凭证断言通过，比对 9 个本地
  accessToken 值均未出现）。全局形态：`self-install` 幂等同步（用户级 `~/.zcode/AGENTS.md` 块
  刷出 caps 段）；`ui --detach` 幂等复用运行中守护（pid 28660，v6.0.0），页面 200 且 v6 标记
  （tr.job-inline / ask-caps / L2（未交付））在服务；`doctor` 全绿（v6.0.0，caps 步：
  default-caps=L0、L2 总闸=off、能力面 L1=仅 ai/cn）；L2 总闸复位确认 `caps-l2-enabled=false`、
  `default-caps="L0"`（出厂态）。

## v6.1 章：桥报错观测修复（P1+P3）· 失败 attempt 全量落盘 + 错误 brief 首尾各半

授权裁决（「P1+P3，P2 不做」）与完整改动面（errorBrief 首尾各半/attempt 全量落盘+文件指针/
成功路径零变化/回归与 T7 记录）见 **CHANGELOG 6.1.0**；本章只记独有内容：

- 观测盲区定因（v11.1，RESEARCH-V11 §2.6）：unparseable/cli-error 的错误文本取 combined
  头部 320 字符，而 combined 常以约 300 字符 Git Bash 环境横幅（stderr 常驻噪声）开头——
  真实错误多在尾部被吞；且失败 attempt 完整输出不落盘，「stdout 空 vs 仅含横幅」无法判别。
- P3 复现实证细节（翻案 v11.1 假设⑤）：glm-prompting 原词 L1 单发（job `20260929-224047-4hz`）
  ai/cn 双 lane 同因失败——stdout 空、stderr=横幅+`Max turns (8) exceeded`（combined 恰 412
  字符，旧 brief 头部 320 恰好全是横幅，真因被截掉）。
- 附带实测发现（当轮提案候选，零改动）：isAuthError 对回显提示词假阳性——提示词含
  "Authentication required" 字样时（如评审材料的 diff 上下文）ai lane 被误分类 auth；评审正文
  经 P1 全量转录找回（job `20260929-222658-wk6`）。→ 由 v6.2 契约 B 修复。
- 发布注记：当轮 git 不可用，commit/tag/push 列待办——后由 v11.4 Git 补课轮补交。

## v6.2 章：L1 回合上限（契约 A）· isAuthError 回显假阳性修复（契约 B）

授权链（用户 2026-09-29「三点偏离有什么需要修复的你帮忙看看」委托一号纳入 v11.3）与完整改动面
（L1_MAX_TURNS_DEFAULT=24/parseMaxTurns 三层取值/config caps-l1-max-turns/l1-turns-exhausted
分类/契约 B 结构化 auth 判定/UI 两端点透传/回归与 T7 记录）见 **CHANGELOG 6.2.0**（diff 全文
`internal/archive/v11/v11.3-diff.txt`）；本章只记第一性定案：

- 契约 A 的本质：v6 的 L1 管道把 `--max-turns` 硬编码 8——上限本身是防护（回合越多工具面
  越大、耗时越长），但 8 实证不够典型联网调研（v11.2 P3 复现：耗尽后 CLI exit 0 无 JSON，
  静默落入 unparseable）。修复方向不是删上限，而是「缺省抬到够用 + 任务级可调 + 耗尽可读」
  三件套，600s 超时仍是硬兜底（先到为准）。
- 契约 B 的本质：auth 判定原是对 combined（stdout+stderr）全文正则——把「worker 说的话」
  当成了「CLI 的故障」。修复原则=只认结构化信号：**CLI 退出码非零 + stderr 中 CLI 自身
  错误行**；stdout（含成功结果 JSON 与 L1 transcript 里的回显）一律免疫。
- 环境注记（v11.3 Phase 1 cline 上线）：本机 npm 全局 prefix 为 `~/.npm-global`（不在用户
  PATH），cline 3.0.65 平台 exe 经桥 config `cline-path` 显式解析——不改系统环境变量；桥的
  桥内自动扫描（%APPDATA%
pm）不覆盖此形态，`cline-path` 是官方支持的第二优先级解析路径。

## v6.3 章：豆包桥并入全局形态（wbx doubao 直通）· 全项目通用

授权原话与完整改动面（parseArgs 前拦截直通/目录双候选/self-install 先 rm 后拷+四要素装完即验/
发现面全局化/T7 三修含 wbx-ui 模板反斜杠隐患/全命令回归）见 **CHANGELOG 6.3.0**（v12、v12.1
两交付的补记官宣亦在该条「补记」段）。本章只记独有定案：

- 边界定案：豆包当时定位「wbx 入口下的可选直通工具」，**不参与调度/回退链/caps 分级**——
  lane 化（进 ask/fanout 路由）留待用户裁决，后由 v6.6 完全 lane 化落地。
- 发布：UNINSTALL.md §八补登全局副本行（一键还原承诺保持）；FROZEN 零触碰（UI 卡为内容级，
  UI-SPEC §5.2/§5.4 放行）；commit/push 待用户指示。

## v6.4 章：全盘联动同步 + 控制台四项体验修复（历史胀开 / 豆包卡位置 / 豆包进历史 / 累计 token）

授权原话与完整改动面（历史表 table-layout:fixed 修复「点开胀开」实测 1017→1605px→0px/豆包卡
上移+总览 chip/累计 tokenTotals 双端点/全盘跨文档联动清单/internal 归档与仓库卫生含项目 .wbx/
删除）见 **CHANGELOG 6.4.0**。本章只记翻案注记与幸存项：

- ③「豆包进历史」（D2 契约变更，UI-SPEC §6 v1.2.0）上线后即被用户翻案，v6.5 整体回退
  （明细见 v6.5 章与 CHANGELOG 6.5.0）——现行 TYPE_LABEL 键集=`{ask,fanout,unknown}`。
- 幸存保留项：历史表 fixed 布局（①）与累计 tokens 口径（④，in/out+unknownUsage 诚实计数，
  全历史实测 in 15,432,702 / out 1,812,749）在后续版本持续有效。
- 门禁/真机证据见 CHANGELOG 6.4.0「实证与回归」（六套全绿）。

## v6.5 章：豆包历史回滚（翻案 v6.4 ③）· 登录页豆包说明卡 · 免费模型下拉溢出修复

授权原话（翻案「豆包进历史」等三条反馈）与回退改动面（直通恢复 v6.3 无痕、三张映射表回退、tokenTotals 去 doubaoTasks、契约 D2 回退 UI-SPEC v1.3.0、运行时 2 个 type=doubao 目录隐私清理）见 **CHANGELOG 6.5.0**；历史页语义定案=**外部算力（lane）调度记录**。本章只记 CHANGELOG 之外的独有内容：

- ②登录页豆包说明卡（一号判断定案，用户已委托）：豆包登录态在桌面客户端 GUI 内自理、桥侧
  零凭证（v12 定案「凭证只进 GUI 登录，不外派不入库」）→ 不存在也不应该有「登录豆包」按钮；
  用户困惑根源=登录页没有豆包的任何说明。修复=登录页 Cline 折叠卡之后新增「豆包（桌面端）·
  无需在此登录」说明卡：登录态自理 + 桥只需要豆包以调试口 9225 运行 + launch.ps1 复制行 +
  指路「状态」页豆包桥工具卡看连接探针。定性=内容级增删（UI-SPEC §5.2/§5.4），零新端点、
  零服务端拉起、不造假登录按钮。
- ③免费模型下拉溢出（真机复现：1280×720 展开详情后 `#cline-free-select` 右缘超出详情框
  31.3px/卡片 14.7px）：根因=select 内联 `min-width:220px`，CSS 规范 min-width 优先于
  max-width:100%，宽屏 grid3 三列下通道卡详情区可用宽约 194px，下拉撑破容器。修复=
  `min-width:0;width:100%`（随列收缩、占满所在列）。1280/~800 两档视口展开详情均无溢出；
  切换写 config cline-model 功能回归正常。
- 门禁（2026-10-03）：v6 24/24 + v7 27/27（⑤c 回退）+ v8 22/22（④a 回退）+ v11.3 38/38 +
  contract 23/23 + 红测全绿（含恢复自证）。真机验证：`wbx doubao status/ask` 直通输出与退出码
  不变且 jobs/ 零新增目录（无痕）；历史页零豆包行、登录页说明卡在、溢出修复量测在案、累计
  tokens chip 与历史合计仍在。
- 发布：self-install 同步全局副本 + `ui --stop` 后 `--detach` 重启生效（/__health 版本=6.5.0）；
  commit 本地完成，push 待用户指示。

## v6.6 章：v13 完全 lane 化——豆包桥升格第四 lane（路由/回退/fanout 全进调度体系）

授权原话、完整改动面（lane 注册/askOnceDoubao worker/caps×doubao/config doubao-parallel/doctor 第 8 段/控制台 v1.4.0 lane 化/双入口语义/login+models 守卫/内嵌 AGENTS 块四 lane 化）与逐项明细见 **CHANGELOG 6.6.0**、设计定案见 RESEARCH-V13；本章只保留 CHANGELOG 之外的独有内容（实测记录/契约细节）。

- **真机 e2e（2026-10-03，豆包客户端在线）**：①`wbx ask --as doubao --text "连接测试…"` 全链路
  成功（18.6s，model=豆包 2.1 Pro高，tokens=—（无用量计量）），job 20261003-131746-gpk 记录
  type=ask lane=doubao、CLI history 与 UI 历史页均可见；②fanout 任务 `"as":"doubao"` 成功
  （18.7s，job 20261003-131858-2wh，lanes ai,cn,cline,doubao 并发 ai=2 cn=2 cline=1 doubao=1）；
  ③`disabled-lanes ["doubao"]` 刹车：ask --as doubao 明确报错、doctor 显示 SKIP、fanout 绑定
  doubao 的任务改投公共队列由 ai 执行（任务不丢），验后恢复 `[]`；④控制台四页签目测：四张
  通道卡（3+1 换行）、总览五 chip（豆包=调试口在线）、路由五按钮（+固定 豆包）、体检豆包段、
  历史豆包行（183 条中 2 条无用量记录=两条豆包调度任务的诚实计数）；⑤1280/800 两档视口
  零横向溢出、豆包卡内部零溢出（详情展开态量测在案）。
- **修复（本轮发现）**：豆包徽标/探针行竞态——lane 化后 badge/proc/cdp 随卡动态渲染，
  loadDoubao 与 loadStatus 并发时探针先返回则元素未渲染、写入落空（徽标永久「检测中…」）。
  修复=paintDoubaoCard() 从 DOUBAO_LAST/DOUBAO_RAW 回填，renderDoubao 与 loadStatus 双向调用
  （新经验：动态卡内元素与并发加载存在竞态，渲染层改动须双向回填——数据到达时+容器渲染完时各画一次）。
- **直通零落盘复验**：`wbx doubao status/ask` 输出与退出码与直跑 doubao.mjs 一致（exit 0）、
  jobs/ 目录数 203→203 零新增（无痕直通未回退；与 lane 调度记录并存=v13 双入口语义实证）。
- 门禁（2026-10-03，竞态修复后重验）：v6 24 + v7 27 + v7-merge 24 + v8 22 + v11.3 38 +
  **v13 新套件 52** + contract 23 + 红测全绿（含恢复自证）——八套件全绿。
- 发布：self-install 同步全局副本（5 模块逐文件 diff 一致）+ `ui --stop` 后 `--detach` 重启
  （/__health 版本=6.6.0）；commit 本地完成，push 待用户指示。

## v6.7 章：v14 根因化最简重构——单一事实来源 + 叙事清零 + 联动机器化

用户三原则授权原话、逐项改动面与验证记录见 **CHANGELOG 6.7.0**；根因诊断三句话与收敛定案见
`internal/RESEARCH-V14.md`。本章只记本轮独有内容。

- **根因诊断（三句话）**：项目反复出现的病（版本号漂移、lane 表过期、归档死链、回滚注释误导、
  README 停更）不是 N 个独立 bug，而是同一根因的三种表现——①事实多处副本靠人工记忆同步；
  ②历史以叙事形式滞留现场；③联动校验靠人工流程。v14 三条对应解=单一事实来源化（副本改指针）+
  现场只表达当前语义（叙事注释迁 CHANGELOG/重写为不变量、死代码删除）+ 联动机器化（新门禁）。
- **单一事实来源落位表**：桥版本号=代码常 `WBX_VERSION`+CHANGELOG 首条（各文档标题去版本限定词）；
  lane 表=SKILL.md（人维护源，README/WBX 为速览+指针）；lane 合法集合=core `LANE_ORDER`（代码侧
  唯一定义点，校验/文案/UI 派生全收敛）；命令清单=`wbx --help`（代码内嵌，文档只留高频速查+指针）；
  行数/条数计数=不落盘（`wc -l` 自查/§速查表）；卸载物清单=CONTRIBUTING 白名单（UNINSTALL 指针化）；
  55 天/9225 等 口径事实=WBX 认证机制节/doubao README（其余处一次陈述+指针）；版本变更叙事=CHANGELOG
  （WBX 版本章瘦身为 CHANGELOG 之外的独有增量：实测记录/契约细节/门禁断言）。
- **`internal/v14-consistency.mjs`（20 断言）**：①md 死链=0（跟踪 md+治理五件套+反引号
  internal/ 路径，wildcard 前缀目录判定）②版本口径四条③lane 单源六条（含 `--lanes` 功能级
  实测：零派发子进程探测）④UNINSTALL 删除面 ⊇ CONTRIBUTING 白名单三条⑤TYPE_LABEL 键集==D2
  冻结集两条⑥叙事清零三条。纯文件/纯函数断言，不依赖任何 lane 在线。
- **抽样审计说明**：版本章瘦身以 v6.6/v6.5/v6.0 三章做逐句对照抽样（diff 在案），v6.1–v6.4 同规则
  轻瘦身；v4/v5.x 章抽查确认为实测/调研记录主体，按规则保留。
- 发布：commit `3868bde` 已推 origin/main（2026-10-03 晚网络阻断，v14.1 轮网络恢复后补推，clone 复扫校验一致）。

### v6.7.1 小节：v14.1 清欠——doubao `--json` 双侧同删 + cline `result.text` 截断根因修复

修复轮（无新特性；UI 契约 v1.4.0 不动）。证据、双侧同删清单与等价验证记录见 **CHANGELOG 6.7.1**；
本章只记本轮固化的不变量与上游语义备忘：

- **cline 正文裁决不变量**（`parseClineNdjson`，ask 返回值/fanout 记录/UI 历史共用出口）：
  text = 流内全部 `contentType:"text"` 内容块按流序拼接（`content_end` 块全文=单一权威事件；流中断
  缺块尾时用该块增量兜底，纯空白增量保留）；与 `run_result.text` 后缀关系成立取更全者，分歧以
  `run_result.text` 为权威不臆造；run_result 缺席按 流拼接 → `done.text` 兜底。
- **上游 compaction 语义备忘**（截断根因，2026-10-03 实测 job `20261003-171054-6tl`）：输出命中上限后
  CLI 自动恢复=notice `max_tokens_compaction`→nudging→`prompt_submit` 重提（流内多 iteration、正文分属
  多 text 块、模型续写）；`run_result.text`/`done.text` **只携带末次 iteration 正文**——上游摘要字段
  有损，事件流才是单次完整的事实源（原始流始终经 rawStream 全量落盘 `*.cline-stream.jsonl`）。
- **doubao 输出契约**：doubao.mjs 全命令无条件单行 JSON（无 `--json` 旗标；wbx-core 两处 spawn 不传）。
- 门禁增量：v6 ③i–③p 九断言（`internal/fixtures/` 真实流 fixture——长=6tl 缩样〔仅剔 reasoning 冗余〕、
  短=job 181835 原样拷贝；参考提取器独立复核），v6 套件 24→33。
- 发布：随 CHANGELOG 6.7.1 同轮 commit+push；操作终态（hash/远端校验）记录在
  `internal/archive/v14.1/v14.1-exec-log.md`。

## v6.8 章：v16 控制台体验与桥自治——余额可见 / 浅深双主题 / PWA / 全自动连接 / 文件自读

五诉求授权原话、逐项改动面与 T7 评审记录见 **CHANGELOG 6.8.0**；定案见 RESEARCH-V16。本章只记
CHANGELOG 之外的独有内容（实测/契约细节/不变量）。

- **余额数据源级联门（b 档实测）**：官方无个人积分端点（R2），第一方 product/session payload 无
  余额字段（a 档排除，键名排查在案）；b 档打通=社区 billing 端点在 lane 自有宿主直接可用——
  `POST {endpoint}/billing/meter/get-user-resource` + 存量会话 Bearer，**无需** prprDog/codebuddy-viewer
  的 web Cookie 通道与账号特定 ProductCode/PackageCodes（同一计费后端的行为级证实）。排错记录：
  /v2{prefix} 前缀拼法 404（不存在）；body 双重序列化 400（Go 网关报错反证端点在）。字段族与 viewer
  文档同源（Capacity/CycleCapacity*，本环境非 Precise 变体，取值做回退兼容）。响应含 Uin/AppId 等
  账号字段——聚合后只输出 remain/total/unit/packages，账号字段零回显（红线）。
- **usage 退出方式不变量**：cmdUsage 用自然排空（process.exitCode + return，不走 exitWith）——
  fetch abort 销毁中的 undici 请求撞上立即 process.exit 会触发 Windows libuv 断言崩溃
  （"Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"，实测复现；setImmediate tick 不解）。
  全桥唯一「fetch 可能 abort 后立即退出」的路径；后续新增 fetch 类命令须沿用自然排空。
- **双主题契约细节**：浅色=T8-b 提案（冷蓝灰系；A 纯中性灰系落选理由=warn/acc 色相漂移），
  集成层修正一处提案缺陷（浅色 --fg-hi #ffffff→#0d1420——按钮白字职责已由 --acc-ink 承担，
  fg-hi 唯一消费方是 header h1，白色在浅底不可见实渲染发现）；深色 --err-ctrl 2.21:1 迁移债
  如实注记（原硬编码即 T4 盲区）。tokens-sha 双主题口径=light:/dark: 前缀 108 声明。
- **PWA 图标不变量**：renderIconPng 纯函数（zlib+CRC32 查表+4x4 超采样），同 size 字节级确定性
  （实测两次生成 cmp 一致），ICON_CACHE 复用；192/512 结构经 CRC 全查+IHDR+像素抽样校验。
- **桥自治触发语义**：ensureDoubao 只在「派发链真正到达 doubao 且 CDP 不可达」时启动（成功路径
  零触碰豆包）；launch.ps1 保持唯一启动器（桥只决策带不带 -Force）；单飞锁防并发双拉。
  heal 只做「配置修复」（model-not-found 且实时清单确认不在免费组 + 失败模型为 config 值），
  Daily limit/清单不可用/任务级显式模型均不改写 config；单飞锁共享一次修复。
- **真机 e2e（2026-10-08）**：①wbx usage：ai 520/520、cn 2303/2319 credits（实时，非官方标注）；
  ②浅色默认+双向切换+localStorage 记忆+刷新无闪烁（1280 实渲染截图，深色零回归对比）；
  ③manifest/图标可达且字节级确定性；④filesMode 自读全链路（job 20261008-154639-z02：播种→
  Read×1→正确答案「芝麻关门」→seededFiles 快照→transcript 落盘）；⑤heal 演练 4 job（
  cline-model-healed meta 全在案；heal off 时回退 cn 语义不变）；⑥豆包 autostart（job
  20261008-155141-56v：9225 离线→autostart=restarted→入史；模型回复为会员额度耗尽通知——
  链路全通，额度事实如实记录）。T7 评审：2 阻断+9 建议，接受 10 驳回 1（v16-t7-record.md）。
- 门禁终态（T7 修复后全量复跑）：v6 35 + v7 50 + v8 22 + v11.3 38 + v13 52 + contract 24 +
  红测 25 变异+4 对照全绿 + tokens-sha 108=6e0415da13 + v14-consistency 20——九套件全绿。
- 发布：self-install 同步全局副本 + 控制台重启（/__health=6.8.0）；commit/push 按 FROZEN 二.2 全流程。

## v6.9 章：caps 能力矩阵（按调用自选联网/读/写契约）· write/readDirs 探针 STOP 缓期

立项原话与四项用户裁决（2026-10-12：沙箱写+主力集成 / 本轮不交付命令执行 / 播种制+按任务附加
只读目录 / 授权解冻 FROZEN 二.8 升级能力矩阵治理）、根因分析与契约设计见 **RESEARCH-V19**；
逐项改动面与 T7/T8 评审记录见 **CHANGELOG 6.9.0**。本章只记 CHANGELOG 之外的独有内容。

- **探针终局（五连，脚本+输出 internal/archive/v19/v19p0-p1~p5，可复跑）**：P1 写工具实名
  `Write`（function_call 事件 `{file_path, content}`）✔；P2 acceptEdits 档 headless 自动放行写
  （default 对照被拒）✔；**P3 越界写逃逸**——acceptEdits 档下 scratch 外绝对路径写成功（唯一
  function_call 即 Write、文件实存、无拒绝信号）→ 沙箱写安全前提破裂，**write 本轮 STOP 不交付**；
  **P4 add-dir 边界不可证**——`--add-dir` 在 headless `-p` 下对 Read/Grep 均不授权（正反斜杠两形态
  +复测一致，拒绝层级=审批层），`--disallowedTools` 路径围栏对 Write 两形态均写穿（正斜杠直接写穿；
  反斜杠首测 240s 挂起系偶发、复测写穿）→ **readDirs 整体缓期**。write 档位结论：acceptEdits 的
  放行范围是**全局 edit 类而非 cwd 限定**——cwd 读边界（审批层）与写无边界并存，是该 CLI 权限
  拓扑的实测事实。
- **能力矩阵契约（交付面）**：caps=能力集合（token ∈ net|read|write，逗号分隔、序无关、去重、
  大小写不敏感；别名 L0≡∅、L1≡net,read；`--caps "net,read"` 与 `--caps L1` 旗标逐字一致）；
  `capsToArgs` 为旗标唯一组合函数（∅ 序列逐字 v5、{net,read} 逐字 v6.8 L1，特征断言锁定）；cline/
  doubao 拒绝一切非 ∅ 能力集（现行 L1 拒绝泛化，文案能力集口径）；含 write 声明即
  caps-write-disabled（**无总闸键**——无行为效果的死配置不设，交付轮随进程级边界修复一并引入）；
  readDirs 任务字段声明即显式报错。结果对象/记录 caps 字段=规范化集合串（固定序 net,read,write）。
- **超时单点（根因修复）**：`resolveCapsTimeoutS(explicit|null, capsSet)` 唯一决策点（显式最高
  优先；缺省 ∅=300s / 非∅=600s），ask 与 fanout 同源。修掉 v6.8 三重缺陷：①两处独立 Math.max
  决策；②fanout manifest/summary 记录未上浮值（「展示 300 实跑 600」观测说谎——一号调研 job
  20261012-154306-3zo 误读实证，RESEARCH 勘误）；③显式小值被 Math.max 静默覆盖。
- **maxTurns 泛化**：三层取值（任务级 > config `caps-l1-max-turns` > 24）语义扩展到任何非∅集合
  （config 键名与导出名 `resolveL1MaxTurns` 不变——命名债注记于 config list/help，v11.3 门禁直呼）。
- **filesMode 泛化（D-009 演进）**：reference 前置从「任务级 caps:"L1"」泛化为「任务级显式声明且
  read∈集合」（L1 别名天然含 read，行为兼容）。
- **观测面**：doctor caps 步=能力矩阵+交付面一行；UI ask 表单 caps 下拉=能力集选项（write/L2 灰显
  未交付）、历史徽标/详情渲染集合串、状态页能力行（内容级，UI-SPEC §5.2，契约版本不动）；help/
  config list 能力集口径。
- **门禁**：新增第十套件 `internal/v19-regression.mjs` 67 断言（序列逐字锁/解析/P5 矩阵/write 三层
  门/readDirs/filesMode/config roundtrip/超时单点/黑盒观测面——首批特征断言在重构前先绿 32/44，
  目标态断言重构后转绿）。v13 ③b 与 v11.3 ③a/③b/③f 报错**文案正则同步**（仅 regex，行为断言
  不动——GOAL「文案泛化」与「消息子串钉死」互斥的最小干预解，偏差留痕 exec-log）。
- **T7 评审**：job `20261012-180400-r7z`（net,read）——3 阻断+10 建议：B1 UI 超时预填 300（行为
  回归）/B2 fanout 缺省继承路径无门/B3 doctor L2 假状态，全修；S3/S4/S5/S8/S10 修，S1/S2/S9
  驳回有因（字节兼容/L2 先例/既有分层）。T8 双份择优：job `20261012-172757-9sn`（两份草稿
  t8-drafts/，设计互证+超时如实展示与 readDirs kind 吸收；两份 write 文案均误引 v10 证据未采纳）。
- **门禁终态**：v19 67 + v6 35 + v7 50 + v8 22 + v11.3 38 + v13 52 + contract 24 + 红测全绿 +
  tokens-sha 108=6e0415da13 + v14-consistency 27——九套件+第十套件全绿。
- **STOP 分支留痕**：置闸与真机冒烟**未执行**（探针 P3/P4 依据）；沙箱写管道/artifacts/readDirs
  实现不存在于本版（最简：无死代码）；T1-W 模板先行入库（未启用）。桥版本 `WBX_VERSION` 6.9.0。
- 发布：self-install 同步全局副本+用户级 AGENTS 块能力矩阵口径；commit/push 按 FROZEN 二.2 全流程。

## v6.10 章：Codex 第五 lane（ChatGPT Plus 质量优先档）· 路由三分 · 额度冷却让位

> 授权=用户 2026-10-14 立项原话+三问对齐裁决（RESEARCH-V21 §〇）；探针 `internal/archive/v21/v21p1-p0~p3`。

**定位**：Codex CLI（ChatGPT Plus 已登录）接入为第五 lane——编码/规划综合能力强的**质量优先档**。
路由三分（第一性：路由=任务类别×lane 成本档×可用性，不是单一全序）：

- **单发 ask 默认 codex 优先**（用户「先优先调用 Codex」）：LANE_ORDER codex 首位，auto=就绪即默认；
- **fanout 批量默认免费池**（FANOUT_DEFAULT_POOL 不含 codex——Plus 额度保护）：任务级 `"as":"codex"`
  点名或 `--lanes codex` 才并入（调度池=缺省池∪点名）；
- **额度耗尽自动冷却让位**（用户「额度用完了，我们就不用它去做桥接了」）：markCodexQuota 三处扫描
  （stdout+stderr+JSONL error）→ `codex-quota.json` 冷却态 → laneReady=false（auto 路由/回退链/批量池
  自动跳过）；显式点名放行+WARN。回退链 codex 在 cline 后 doubao 前（免费 lane 失败不自动烧 Plus 额度）。

**隔离运行时与凭证（D-037）**：`CODEX_HOME=<运行时根>/codex-home`（--ephemeral --ignore-user-config
运行）；`wbx login --identity codex` 一次性只读复制 `~/.codex/auth.json`——「不动桌面版文件」红线的
唯一显式授权例外（单文件、只读、一次；除它外 ~/.codex 零读取；凭证内容绝不展示/入日志/入库）。
二进制解析：WBX_CODEX env → config codex-path → `%LOCALAPPDATA%/OpenAI/Codex/bin/*/codex.exe`
（按 exe 自身存在+mtime 最新——探针 P0 实证存在无 codex.exe 的 hash 目录）。

**调用与收割（D-037）**：`codex exec --ephemeral --ignore-user-config --skip-git-repo-check --color never
-s read-only -m <config codex-model> -c model_reasoning_effort=<档> --json -o <tmp>`，>12000 字符走
stdin；**收割绝不信任退出码**（探针 P2）——-o 文件为最终权威正文+JSONL 事件流判失败；usage 只取
input_tokens/output_tokens（**实测流无 total_tokens**，勘误二手来源）；JSONL 全文落盘
`ask.codex-stream.jsonl`/`<task>.codex-stream.jsonl`（流文件名按产出 lane 泛化，cline 字节兼容）。
模型恒取 config codex-model（任务级 model 不生效——额度保护）；任务级 effort low/medium/high 直通。

**模型契约（D-038）**：默认 `gpt-6.1-sol`；validateCodexModel 单点护栏——须匹配 `^gpt-(\d+)` 且主版本
≥6（用户裁决「不用 GPT-5.6 及以下」），config set 与运行时读取同源；拒 gpt-5.5/gpt-5.6-*/
codex-auto-review/gpt-reserve，放 gpt-6 系与未来 gpt-7+。config 五键：codex-path / codex-model /
codex-reasoning（low|medium|high|xhigh，默认 medium，xhigh 仅 config 可设）/ codex-parallel（默认 1，
Plus 单账号保护）/ codex-quota-cooldown-min（默认 30）。caps：codex 拒绝一切非 ∅ 能力集
（caps-lane-mismatch 五处枚举+UI 400；FROZEN 二.8「仅 ai/cn」语义不变）。

**doctor 第 9 段（D-039，免额度探测）**：二进制+版本、隔离 CODEX_HOME `codex login status`（实测
输出在 stderr——判定扫双流）、模型与冷却状态；绝不做 tiny-ask（D-002 同类：探测性提问也真实消耗
Plus 5h 滚动窗口额度）。余额 state='na'——Plus 额度以 ChatGPT 网页端 Settings→Usage 为准（无本地
端点，诚实降级）；`wbx models` codex 守卫（模型经 config 管理，不做逐个探测）。

**探针结论（v21p1，以实测为准）**：P0 旗标全确认+空 CODEX_HOME=Not logged in（exit 1）；P1 复制流
落位正确；P2 真实 tiny exec（授权消耗：JSONL 4 事件 schema 实测、-o=权威正文、--ephemeral 零 sessions
残留、read-only 零 scratch 写入、隔离 home 副作用全困桥目录、usage 无 total_tokens）；P3 护栏矩阵
15/15。T8 双份草稿择优（job 20261014-115825-xco，A 基底+B 三处并入）+ T7 评审（job
20261014-121904-qoq：1 阻断+2 采纳修复、2 驳回有因、1 UNKNOWN 解答）。

**门禁**：新增 `internal/v21-regression.mjs`（第十一套件 55 断言：路由三分常量逐字锁/fallbackLane
期望/fanout 调度池功能+运行时 spawn argv 证据（fake bin=node.exe 副本+work 目录无扩展名 `exec` 主
脚本——Node ≥18 禁无 shell spawn .cmd）/caps×codex 五处/护栏矩阵/额度状态机六态/askOnceCodex 源级
八锁/login 复制流黑盒六断言）。同步既有：v14 ③d（4→5）、v13 ①c/①g/②/⑥a-⑥f/⑧c+沙箱 codex 读性
伪造、v19 ③a/③b 矩阵+codex；v6 ④ 实测不撞（fb(cline)='cn' 保持）。门禁终态：v21 55 + v6 35 +
v7 50 + v8 22 + v11.3 38 + v13 52 + v19 76 + contract 24 + 红测 + tokens-sha 108=6e0415da13（不变）
+ v14-consistency 27——十套件+第十一套件全绿。

**UI（内容级，contract v1.5.0）**：codexCardHtml 通道卡（四态徽标+冷却倒计时+成本「ChatGPT Plus
额度」+路由说明）；LANE_LABEL/TITLE +codex（FROZEN_TERMS 三处同步纯新增）；路由卡「固定 Codex」；
ask/fanout 选择器；登录页 Codex 收割说明卡；/api 校验与 errorHint。token 键集与值零改动。

**发布**：self-install 同步全局副本+用户级 AGENTS 标记块五 lane 口径；PROMPTS.md v4.2（GPT-6.1-Sol
画像章+成本口径「免费三 lane+付费两 lane」）；commit/push 按 FROZEN 二.2 全流程（敏感模式另加
`codex-home|auth\.json` 零命中审计）。桥版本 `WBX_VERSION` 6.10.0。

## CHANGELOG 归档

## 6.10.0 - 2026-10-14

新增（v21 Codex 第五 lane 轮：Codex CLI 接入为**第五 lane（ChatGPT Plus 质量优先档）**，达成「单发默认优先、批量默认免费、额度耗尽自动冷却让位」路由三分。授权=用户 2026-10-14 立项原话（「Codex 的编码能力肯定要比你好……先优先调用 Codex」「额度用完了，我们就不用它去做桥接了」「不要用 GPT 5.6 及以下的模型」「前端 UI 也记得要改」）+ 三问对齐裁决（路由=单发优先+批量免费+任务级点名；凭证=一次性只读复制 `~/.codex/auth.json` 入桥隔离目录；默认模型=gpt-6.1-sol+≥GPT-6 底线护栏）。执行提示词 GOAL-V21-PROMPT，调研底稿 RESEARCH-V21，探针留档 `internal/archive/v21/v21p1-p0~p3` + T8/T7 评审记录）

### Added
- **codex lane 运行时（wbx-core）**：`resolveCodexPath()`（WBX_CODEX env → config codex-path → `%LOCALAPPDATA%/OpenAI/Codex/bin/*/codex.exe` 按 **exe 自身存在+mtime 最新**解析——探针 P0 实证存在无 codex.exe 的 hash 目录，不得按目录 mtime）；`codexSpawnEnv()`（CODEX_HOME=<运行时根>/codex-home 隔离，绝不指向 ~/.codex）；`validateCodexModel()` 单点护栏（^gpt-(\d+) 且主版本 ≥6，否则 `codex-model-floor`——config set 与 askOnceCodex 读取同源，loadConfig 容错把非法存量值归一回 gpt-6.1-sol）；`parseCodexJsonl()` 纯函数（正文=item.completed(item.type=agent_message).text、usage 只取 input_tokens/output_tokens——**实测流无 total_tokens**（探针 P2 勘误二手来源）、turn.failed/error 首个命中）；`askOnceCodex()`（spawn 形状 `exec --ephemeral --ignore-user-config --skip-git-repo-check --color never -s read-only -m <config codex-model> -c model_reasoning_effort=<档> --json -o <tmp>`，>STDIN_THRESHOLD 走 stdin `-`；**收割绝不信任退出码**——-o 文件为权威正文+事件流判失败（turn.failed/error/无 turn.completed 且无 -o 正文）；JSONL 全文随 rawStream 落盘 `ask.codex-stream.jsonl`/`<task>.codex-stream.jsonl`（流文件名按产出 lane 泛化，cline 字节兼容）；模型恒取 config（任务级 model 不生效——Plus 额度保护），任务级 effort low/medium/high 直通推理档；caps 仅 ∅（非空集报 caps-lane-mismatch，五处枚举：askOnce 分流/直调/runAskJob/runFanoutJob/UI 400）。
- **额度冷却状态机（D-039）**：`markCodexQuota()`（检测 `/you('|’)ve hit your usage limit|usage limit (has been )?reached|rate limit|429/i`，扫 stdout+stderr+JSONL error 三处；`try again at <时间>` 可解析且未来则用作截止，否则 now+codex-quota-cooldown-min 分钟）→ `<runtime>/codex-quota.json`；`codexQuotaState()`（缺失/损坏/过期=inactive，过期文件 best-effort 清理）；`codexReady()`（二进制+auth.json+!冷却）——冷却期 laneReady=false，auto 路由/回退链/fanout 缺省池**自动让位**；显式 `--as codex`/`"as":"codex"` 照放行（runAskJob/runTask 打 `[WARN] 额度冷却中（剩余约 Xm）`）。
- **路由三分（D-036）**：`LANE_ORDER=['codex','ai','cn','cline','doubao']`（codex 首位=单发 ask auto「codex ready 即默认」）；新常量 `FANOUT_DEFAULT_POOL=['ai','cn','cline','doubao']`（fanout 缺省池过滤此池，**调度池=缺省池∪任务级点名 lane**——`as:"codex"` 点名才并入，Plus 额度不进批量缺省池）；`FALLBACK_ORDER=['cn','ai','cline','codex','doubao']`（fb(codex)='cn' 免费优先；免费三 lane 失败不自动烧 Plus 额度，codex 只被前三全不可用时到达且先于 doubao）。config 五键：codex-path/codex-model（默认 gpt-6.1-sol）/codex-reasoning（默认 medium；xhigh 仅 config 可设）/codex-parallel（默认 1，Plus 单账号保护）/codex-quota-cooldown-min（默认 30）。
- **凭证收割（D-037）**：`wbx login --identity codex` 一次性只读复制 `~/.codex/auth.json` → codex-home（mkdir+copy+校验；源不存在→指引先登录桌面版/CLI；已收割幂等提示、--force 重收割）——「不动桌面版文件」红线的**唯一显式授权例外**（单文件、只读、一次；除它外 ~/.codex 零读取零写入；凭证内容绝不展示/入日志/入库）。
- **doctor 第 9 段（免额度探测，D-002 同类）**：二进制+版本、隔离 CODEX_HOME `codex login status`（**实测输出在 stderr**——判定扫双流）、模型与冷却状态；**绝不做 tiny-ask**（Plus 5h 滚动窗口额度保护）。余额 state='na'+hint「Plus 额度以 ChatGPT 网页端 Settings→Usage 为准」（无本地端点，诚实降级）。`wbx models` codex 守卫（模型经 config 管理，不做逐个探测——同样耗额度）。
- **v21-regression（新增第十一套件，55 断言）**：路由三分常量逐字锁（LANE_ORDER/FALLBACK_ORDER/FANOUT_DEFAULT_POOL+池⊂序）；fallbackLane 期望（fb(codex)='cn'/前三禁用 fb(ai)='codex' 先于 doubao/fb(doubao)=null/冷却让位）；fanout 调度池功能（沙箱 fake bin：无 as 批量不含 codex、as:codex 并入且独占 worker、--lanes codex 直投+**运行时 spawn argv 证据**——fake bin=node.exe 副本+work 目录无扩展名 `exec` 主脚本承接，Node ≥18 禁无 shell spawn .cmd）；caps×codex 五处；validateCodexModel 15 例拒/放矩阵+config set 同源+loadConfig 归一；额度状态机六态（写入/落位/让位/try-again-at/过期恢复/未命中不触发）+显式放行 WARN 源级；askOnceCodex 源级八锁（旗标/形状逐字/-m 恒 config/退出码零引用/stdin 分流/-o 即删）；login 复制流黑盒六断言（落位一致/源未改/非 auth.json 不读/幂等/缺源指引）。
- **PROMPTS.md v4.1 → v4.2**：速查表口径「三 lane 几乎免费」→「免费三 lane+付费两 lane（Plus 额度/会员额度）」；新增「GPT-6.1-Sol（codex lane）」模型画像章（定位/写法要点/反模式/effort 映射 low-med-high/lane 特殊性：仅 ∅ L0、单发默认优先+批量点名、额度冷却语义、长任务 --timeout 600 建议、模型经 config 管理任务级不生效）。
- **UI（内容级，UI-SPEC contract v1.5.0，§5.5 三处同步）**：`codexCardHtml()` 通道卡进 grid（四态徽标 未装/未登录/冷却中/已登录、冷却倒计时行、成本行「ChatGPT Plus 额度」（复用 .neutral 视觉档）、路由说明「单发默认优先·批量需点名」、凭证收割/隔离排障详情）；LANE_LABEL/LANE_TITLE +codex（FROZEN_TERMS 增补 'Codex CLI（ChatGPT Plus·可选通道）' 纯新增三处同步）；路由卡 +「固定 Codex」+自动文案+回退链五元；ask 分段器/fanout 下拉（标注「点名」）+Codex；登录页 Codex 收割说明卡（×4）；/api/ask 枚举与 caps 400、/api/login/start 硬拒、errorHint +额度冷却提示。**token 键集与值零改动（tokens-sha 不变 6e0415da13）**。

### Fixed
- **T7 评审批判（job 20261014-121904-qoq）1 阻断+3 建议+1 UNKNOWN**：阻断（-o 读成功但空串不回退 parsed.text——改「非空白才算权威正文，空串回退流正文」）与建议#5（spawn catch hint 语义 not-installed→spawn-failed）采纳修复；建议#2（timeout 补 hint）/#3（codexReady 加 floor 校验）驳回有因（兄弟 lane 同形返回无 hint；loadConfig 容错已单点归一非法模型值，冗余防线）；UNKNOWN（parseCapsSet 返回形态）解答为数组无问题。评审记录 internal/archive/v21/v21p1-t7-review.md。
- **T8 双份择优（job 20261014-115825-xco）**：A 份（可读性侧重）为基底，并入 B 份三处（额度检测先于超时判定+理由、失败 hint 区分 incomplete-stream、reason 整行提取）；两份 spawn 形状/收割不变量互证一致。评审记录 internal/archive/v21/v21p1-t8-review.md。

### Changed
- WBX_VERSION → 6.10.0；HELP/文件头五 lane 化（lane 行/默认路由三分/回退链/--as 枚举/config 清单/tasks.json 格式/WBX_CODEX env）；hintText +codex-quota/codex-model-floor；userBlockText 五 lane 版（~/.zcode/AGENTS.md 标记块随 install-user 刷新）；ensureDirs +codex-home/work；doctor route/caps 文案五 lane 口径；usage 说明 codex 无端点。
- 门禁同步：v14 ③d（4→5 lane）；v13 ①c/①g/②期望值/⑥a-⑥f 文案正则/⑧c 五元渲染+沙箱 codex 读性伪造；v19 ③a/③b 矩阵 +codex（caps-lane-mismatch 拒绝侧）；v6 ④ 实测不撞（fb(cline)='cn' 保持）。

### 验证
- 探针四连（internal/archive/v21/v21p1-*，可复跑）：P0 二进制/旗标/login status 三态（空 home=Not logged in exit 1）；P1 伪造 auth.json 复制流；P2 **真实 tiny exec**（授权消耗：exit=0、-o=OK、JSONL 4 事件实测 schema、--ephemeral 无 sessions 残留、read-only 零 scratch 写入、隔离 home 副作用全困桥目录；**usage 无 total_tokens 勘误**）；P3 护栏矩阵 15/15。
- 真实 smoke（授权消耗）：`--as codex` tiny ask 成功（lane=codex、usage in/out=16261/5、codex-stream.jsonl 落盘）；`config set codex-model gpt-5.6-sol` 报 codex-model-floor；`--caps L1 --as codex` 报 caps-lane-mismatch；resolveDefaultLane auto=codex；真实 2 任务 fanout（缺省池 ai,cn,cline,doubao+点名 codex 并入；named 任务独占 codex worker 13.9s 成功、free 任务走 ai）。
- 门禁终态：**v21 55 + v6 35 + v7 50 + v8 22 + v11.3 38 + v13 52 + v19 76 + ui-contract 24 + 红测通过 + tokens-sha 108=6e0415da13（不变）+ v14-consistency 27——十套件+第十一套件全绿**。
- 凭证红线：auth.json 复制为唯一显式授权例外（单文件/只读/一次/gitignore 运行时）；探针/门禁全走沙箱 fake（零真实额度消耗，仅

## 6.9.0 - 2026-10-12

重构+新增（v19 caps 能力矩阵轮：caps 从三档枚举还原为**能力集合**（L0/L1 降格为别名）+ write/readDirs 探针 STOP 缓期 + 超时根因修复。授权=用户 2026-10-12 立项原话（「每一个项目窗口在调用 WBX 桥的时候，能不能让这个窗口自行选择这些功能？……是否可以联网、是否可以读取本地文件、是否可以写入等等」）+ 四项对齐裁决（沙箱写+主力集成 / 本轮不交付命令执行 / 播种制+按任务附加只读目录 / 授权解冻 FROZEN 二.8 升级能力矩阵治理）+ 三原则重申。**探针终局（STOP 分支）**：P1 写工具实名 `Write` 确认；P2 acceptEdits 档 headless 可自动放行写；P3 越界写**逃逸**（acceptEdits 放行范围为全局 edit 类而非 cwd 限定——沙箱写安全前提破裂）；P4 `--add-dir` 在 headless 不授权读+disallowedTools 路径围栏对 Write 双形态写穿（信任边界不可证）→ **write 与 readDirs 本轮不交付**（总闸未设未置、冒烟未跑、沙箱写管道/artifacts 无死代码），能力集契约/超时根因修复/观测面按计划交付。执行提示词 GOAL-V19-PROMPT，调研底稿 RESEARCH-V19（探针裁决与勘误已回填），探针脚本与输出 `internal/archive/v19/v19p0-p1~p5` 可复跑）

### Added
- **caps 能力矩阵契约（wbx-core）**：`parseCapsSet()`——token ∈ {net,read,write}，逗号分隔、序无关、去重、大小写不敏感；别名 L0≡∅（缺省）、L1≡net,read；`L2` 保留 → caps-l2-not-delivered（行为不变）；非法 → caps-invalid（文案能力集口径）。`capsToArgs(capsSet)` 唯一旗标组合函数：∅ 逐字 v5 L0 序列；非∅ 白名单固定序拼接（net→WebSearch,WebFetch / read→Read,Glob,Grep / write→Write,Edit）+ permission-mode（write∉set=default；write∈set=acceptEdits，仅契约完整性本轮不可达）+ 回合上限三层取值。`--caps "net,read"` 与 `--caps L1` 旗标逐字一致（特征断言锁定）。lane 矩阵泛化：cline/doubao 拒绝一切非∅能力集（caps-lane-mismatch，文案延续现行风格）。**write 门（STOP 形态）**：含 write 能力集在 askOnce（spawn 前）/runAskJob/runFanoutJob 三层显式报 `caps-write-disabled`（文案含探针 P3 证据指针；本轮不设总闸键——无行为效果的死配置不设）。**readDirs 未交付**：fanout 任务字段声明即显式报错（探针 P4：add-dir 边界不可证；绝不静默忽略）。结果对象/记录 caps 字段=规范化集合串（固定序 net,read,write；∅ 沿 v6.8 字节兼容）。
- **超时单点 resolveCapsTimeoutS(explicit|null, capsSet)**（根因修复）：显式最高优先（原值返回）；缺省 ∅=300s / 非∅=600s；ask（runAskJob）与 fanout（runTask）同源一处决策。修掉 v6.8 三重缺陷：两处独立 Math.max 决策、fanout manifest/summary 记录未上浮值（「展示 300 实跑 600」观测说谎——一号调研 job 实证误读）、显式小值被静默覆盖。CLI/UI 缺省传 null；fanout manifest 增 timeoutPolicy（explicit|auto）、summary 如实展示两态。
- **maxTurns 泛化**：三层取值（任务级 > config caps-l1-max-turns > 24）语义扩展到任何非∅能力集（∅ 仍明确报错）；config 键名与 resolveL1MaxTurns 导出名不变（v11.3 门禁直呼；命名债注记于 help/config list）。
- **filesMode:"reference" 泛化（D-009 演进）**：前置从「任务级 caps:"L1"」改为「任务级显式声明且 read∈集合」（L1 别名天然含 read，行为兼容；缺省/继承/不含 read 显式报错文案同步）。
- **v19-regression（新增第十套件，67 断言）**：capsToArgs 序列逐字锁（∅≡v5、{net,read}≡现行 L1，JSON.stringify 比对）/能力集解析（别名/序无关/去重/大小写/非法/L2 保留）/P5 矩阵拒绝契约（cline/doubao × 一切非∅ + L2 + 非法 + L0 正常路径）/write 三层门+缺省继承路径/readDirs 报错/filesMode 泛化四态/config caps 类型 roundtrip+loadConfig 容错/超时单点（显式优先/∅300/非∅600/非法值兜底）/三层取值回归/黑盒 CLI（fanout manifest timeoutPolicy 如实、任务记录集合串、--caps net,read 端到端 argv、write/L2 退出码）。首批特征断言重构前先绿（32 锁+12 目标态重构后转绿）。
- **观测面**：doctor caps 步=能力矩阵+交付面一行（∅/net,read/write 未交付/readDirs 缓期/L2 保留）；wbx --help（--caps/--max-turns/fanout 任务字段/config list）能力集口径；UI ask 表单 caps 下拉=能力集选项（net/read/net,read 可选，net,read+write 与 L2 灰显未交付）+提示语、历史行内徽标渲染集合串、fanout 任务行内联能力集 select、job 详情「能力集」行、状态页能力行（内容级，UI-SPEC §5.2 放行，契约版本不动）；config `default-caps` 类型 enum→caps（别名原样存/集合串规范化存/L2 保留）。
- **PROMPTS.md v4 → v4.1**：原则 2 能力边界声明改「按能力集」句式（∅/net,read/含 write 留位/L2 四句式）；新增 T1-W 代码模块·写盘变体（**留位未启用**——探针 P3 依据，与 T10「模板先行」同例；含写边界句与编排侧配套）；T4-L1/豆包 lane 行/派发流程 1b/决策速查表/派发前 checklist 能力集口径；T10 注记同步（write 亦未交付）。SKILL.md caps 能力矩阵节/命令速查/fanout 段/骨架句式同步。

### Fixed
- **T7 评审批判（job `20261012-180400-r7z`）3 阻断全修**：B1 UI ask 超时输入预填 300（经 UI 的能力任务恒 300s、违背缺省 600s 契约——改留空+placeholder=「缺省」，显式值才最高优先；汇总行同步 auto 显示）；B2 runFanoutJob 缺省继承路径无 write/L2 门（config default-caps 含 write 或 =L2 时继承任务在校验层显式报错，对齐 v6.8 job 级快速失败语义）；B3 doctor caps 步对 default-caps='L2' 渲染「非法」假状态（loadConfig 已合法保留 L2——改专项渲染「保留未交付」）。建议 S3（capsToArgs「纯函数」措辞）/S4（豆包卡误标 cline）/S5（重复注释）/S8（summary 超时 null 显示）/S10（config 报错文案漏 L2）采纳修复；S1（记录层 caps:'L0' 省略）/S2（config 可存含 write 集合）/S9（UI 400 短文案）驳回有因（v6.8 字节兼容+UI 过滤兼容；L2 可设先例；既有校验分层）。
- **T8 双份择优（job `20261012-172757-9sn`）**：两份实现草稿设计互证（超时如实展示与 readDirs 带 kind 吸收）；两份 write 文案均误引 v10 cline/L2 证据（探针 P3 事实错置）未采纳——write 文案由主力按探针终局亲写。

### Changed
- **门禁同步（最小干预，留痕 exec-log）**：v13 ③b 与 v11.3 ③a/③b/③f 报错**文案正则**随「文案能力集口径泛化」同步（仅 regex 子串，行为断言一字未动）——GOAL「文案泛化」与「消息子串钉死」两授权条款互斥的裁决：文案诚实优先，偏差记录 internal/archive/v19/v19-exec-log.md。
- 旧三档枚举解析器（parseCaps/CAPS_LEVELS/L1_TOOLS_WHITELIST）随根因化移除（零调用后删除，非保留死代码）。

### 验证
- 探针五连（脚本+输出 internal/archive/v19/，可复跑）：P1 Write 实名+function_call 形态确认；P2 acceptEdits 档 headless 自动放行写（default 对照被拒 16.5s/23.9s）；P3 越界写逃逸（82.4s，文件实存界外、内容吻合、唯一 function_call 即 Write）；P4 add-dir 读不授权（双形态+复测）、写穿围栏（正斜杠直接写穿；反斜杠首测挂起偶发、复测写穿）；P5 以 v19-regression ③ 断言族承载。
- 门禁终态：**v19 67 + v6 35 + v7 50 + v8 22 + v11.3 38 + v13 52 + ui-contract 24 + 红测全部通过 + tokens-sha 108=6e0415da13 + v14-consistency 27——九套件+第十套件全绿**。
- 黑盒零回归：v6 35（L0 全链路）/v7 50（真机端口）/v11.3 38（L1 三层取值+L0 零影响 argv）/v13 52（doubao/cline caps 矩阵+NDJSON）全绿即行为等价实证。
- STOP 分支留痕：write 总闸未设未置（无 caps-write-enabled 键）；置闸与真机写冒烟未执行；沙箱写管道/artifacts/readDirs 实现不存在（无死代码）；T1-W 留位未启用。
- 发布：self-install 同步全局副本+用户级 AGENTS 块能力矩阵口径（grep 实证）；commit/push 按 FROZEN 二.2 全流程；tag v6.9.0。

## 6.8.0 - 2026-10-08

新增（v16 控制台体验与桥自治轮：余额可见 / 浅深双主题 / PWA 可安装 / 全自动连接 / worker 文件自读。授权=用户 2026-10-08 立项五诉求原话——①前端直接看余额 ②浅色模式（可切换、偏好浅色，FROZEN 7 UI 契约变更显式授权）③worker 按文件路径自读 ⑤四桥自动开启自动连接（「最好就是它们能够自动开启、自动连接，不需要我额外干预」）；自动化边界定案=豆包允许按需自动拉起/重启、cline 配置模型被免费组轮换下线时允许自动切换组内可用模型并显式报告（「失败回退只投 ai/cn 不换模型」定案继续有效——约束失败回退，不约束配置修复）。UI 契约 v1.4.0 → **v2.0.0**（token 值分层双调色板 + 8 个收编新 token + 主题切换管道；键集语义不动，浅色=T8 双提案机器实测择优，深色=原值原样迁移视觉零回归）。执行提示词 GOAL-V16-PROMPT，调研底稿 RESEARCH-V16）

### Added
- **余额可见（wbx usage + /api/balance + 通道卡「余额」行）**：共享函数 `laneBalance(laneKey,{ttlMs,force})`（wbx-core，与 tiny-ask 同级基础设施）——数据源级联门实测定案 b 档：`POST {endpoint}/billing/meter/get-user-resource`（lane 自有宿主 + 存量会话 Bearer 直用，无需社区 viewer 的 web Cookie 与账号特定参数；侦察记录 internal/archive/v16/v16-balance-recon.md），返回 `{state: ok|unavailable|na, remain, total, unit:'credits', asOf, stability:'community', packages}`；TTL 缓存只存成功、失败优雅降级绝不 throw（T7 后加外层兜底）、账号侧字段（Uin/AppId 等）与凭证零进入返回值。cline（免费孪生官方无端点）/doubao（会员额度无 API）如实显示 na；unavailable 诚实兜底+官方控制台指路，不造假数据。新命令 `wbx usage`（lane×余额表 + 「非官方端点」显式标注 + TTL/--force；--json 机读；自然排空退出——fetch abort 后立即 process.exit 在 Windows 触发 libuv 断言，实测复现后根因化规避）；GET /api/balance 端点；UI 通道卡（WorkBuddy 双 lane）增「余额」行（同源数据，豆包卡同款双向回填防竞态，失败回填「查询失败」不悬挂——T7）。
- **浅深双主题（contract v2.0.0，FROZEN 7 授权）**：哨兵块 token 分层——`:root`=浅色默认（T8 双提案：A 纯中性灰系 / B 冷蓝灰系，WCAG 全表机器实测两案全绿，择优 B=色相家族与深色版连续、切换不换品牌感；测量脚本 internal/archive/v16/v16-palette-measure.mjs，浅色 23 项+深色 23 项逐项实测值记入 UI-SPEC §1.2），`[data-theme="dark"]`=原深色值原样迁移（视觉零回归）；键集语义不动，新增 8 个收编 token（--acc-ink/--err-ink/--err-ctrl/--hover-ring/--hover-soft/--scrollbar/--scrollbar-hover/--panel-fade——哨兵块外硬编码色全数收编，T4 allowlist 清空）。切换管道：head 首个内联脚本读 localStorage（key wbx-theme，值 light|dark，缺省 light）先设 dataset.theme 防 FOUC + header 两态切换按钮（内联 SVG 月/日图标）+ theme-color meta 随主题同步（T7）+ 无 JS 兜底=浅色即正确渲染。ui-contract 重构：T1 双主题键集相等断言（:root 66 键 + dark 42 键）、T2 双值快照（浅 66+深 42 逐值）、T5 双调色板塌缩断言、新增 T6 主题切换管道（23→24 断言，含 PWA 派生色=浅色 --bg 等值）；红测 25 变异全红（新增浅色漂移/深色键改名/主题管道断裂三变异）+4 对照全绿+恢复自证；tokens-sha 换证 efeee49b0e→6e0415da13（双主题口径：light:/dark: 前缀 108 声明）。集成层修正一处 T8 提案缺陷：浅色 --fg-hi 由 #ffffff 改 #0d1420（其「按钮白字」职责已由新 token --acc-ink 承担，回归「标题/强调」语义——浅色 header 标题可见性实渲染验证）。已知迁移债如实记录：深色 --err-ctrl 2.21:1（原硬编码态即 T4 盲区，按「原样迁移零回归」保留，UI-SPEC §1.2 注记待后续小版本校正）。
- **PWA 可安装**：GET /manifest.webmanifest（name「wbx 桥控制台」/short_name「wbx」/start_url "/"/display standalone/theme_color+background_color=浅色 --bg，派生色等值由 T6 断言守护）+ GET /icons/icon-{192,512}.png——图标纯函数自产（renderIconPng：node:zlib deflate + 手写 CRC32 查表 + IHDR/IDAT/IEND 最小 PNG，4x4 超采样圆角底+「w」笔画，确定性输出零落盘零依赖，ICON_CACHE 复用；结构经 CRC/IHDR/像素抽样校验）；状态页安装指引一行（内容级）；页面与 manifest 零外部 URL（红线自检通过）。
- **桥自治——doubao-autostart**（config 默认 true）：`ensureDoubao()`（wbx-core 共享，单飞锁防并发双拉；launch.ps1 保持唯一启动器，15s 归零等待+30s 就绪轮询语义复用）：CDP 在线零触碰豆包；不可达时 tasklist 探进程——无进程直接拉起、有进程 -Force 重启（taskkill 等归零再拉起）；触发点=派发链真正到达 doubao（显式 --as/回退链走到/fanout 轮到），成功路径零触碰。askOnceDoubao 在 CDP 不可达失败后 ensure+重投一次，job meta 记 `doubao-autostart: launched|restarted|online|unavailable|failed`（T7 后 action 原样保留不压扁）；重投失败拼接首次 attempt 全量输出（排查不失真）；UI 通道卡「启动」按钮（POST /api/doubao/ensure 幂等）；doctor 保持只读，WARN 文案更新为「派发到达时将自动拉起」语义；off 时行为与现状完全一致。e2e：9225 离线状态 ask --as doubao → autostart=restarted → 任务入史（模型回复为会员额度耗尽通知——链路本身全通，如实记录）。
- **桥自治——cline-auto-heal**（config 默认 true）：`healClineModelIfNeeded()`（单飞锁，T7 后加）——失败分类 hint=model-not-found 且 recommended-models 实时清单确认配置 id 不在免费组时，自动切换清单首个可用 id、写回 config、派发链内重投一次（再失败照旧回退 ai/cn）；边界=仅当失败模型为 config 值（任务级显式 model 不改写 config，T7）、Daily limit（配额耗尽）不触发换模型、清单不可用不写 config；结果 meta 与 [HEAL] stderr 行标注 `cline-model-healed: 旧→新`（仅 heal 重投真正产出结果时，T7）；heal 关闭时回退链语义零变化（v6 ②c 三断言分治覆盖）。doctor WARN 文案同步 auto-heal 语义。
- **worker 文件自读（fanout filesMode:"reference"，L1 材料播种）**：任务级新字段（缺省 inline 字节兼容）——CLI 侧解析 files 为 {rel,abs} 并验存在 + 非法 filesMode 值/reference 缺 files 显式报错（T7）；core 校验 reference 强制任务级 caps:"L1"（缺省/继承/L0 均显式报错绝不静默降档）+ files 非空 + rel 相对且无 ..；runTask 把材料复制进该任务 L1 scratch（保持相对路径结构；try/catch 包裹、_seeded 全部成功才置位、播种失败=任务级失败如实落盘不重投不回退——T7），提示词材料区改为「清单+相对路径+Read 自读指引」；轨迹落盘复用 L1 既有机制，rec 记 filesMode/seededFiles 快照。lane 限 ai/cn（L1 既有边界自然继承）。e2e：播种→worker Read×1→正确答案→seededFiles 快照→transcript 落盘全链路实测通过。cline/doubao 不扩展（R1 定案：CLI 无安全细粒度审批）。
- **help 与文档联动**：wbx --help 收录 usage、双 config 键与 fanout filesMode；SKILL.md 命令速查/caps 节/fanout 段/失败降级节同步；PROMPTS.md 决策速查表 L1 行与 T4-L1 调用形态注记补 filesMode（顺带修正 T4-L1 max-turns 8→24 既有漂移）；ROADMAP 追加 L2 第②层候选路径（官方推荐 PreToolUse hook 自建 deny，待专门轮）。

### 验证
- T7 评审批判：job `20261008-154944-g84`（cn，effort high，材料=1154 行全桥 diff）——2 阻断+9 建议，接受 10 驳回 1（逐条留痕 internal/archive/v16/v16-t7-record.md），全部修复落地后九门禁全量复跑。
- 九门禁全绿：v6 35（含 heal 三断言分治）/ v7 50 / v8 22 / v11.3 38 / v13 52 / contract 24（T6 新增）/ 红测 25 变异+4 对照全绿（含恢复自证）/ tokens-sha 108=6e0415da13 / v14-consistency 20/20（CHANGELOG 6.8.0 落地后 ②a 转绿）。
- 真机/e2e：wbx usage（ai 520/520、cn 2303/2319 credits，实时）；浅色默认+双向切换+localStorage 记忆+刷新无闪烁（1280/800 实渲染截图，浅深两档目测）；manifest/图标可达合规且字节级确定性；filesMode 自读全链路（job 20261008-154639-z02：播种→Read×1→正确答案）；heal 演练 4 job（`cline-model-healed` meta 全在案）；豆包 autostart（job 20261008-155141-56v：离线→restarted→入史）；全命令回归零回退（doctor/ask/fanout/models/config/history/ui/usage/--help）。

## 6.7.1 - 2026-10-03

修复轮（v14.1 清欠：v14 两项登记缺陷根因化 + push 补课；授权=用户 2026-10-03「怎么执行好怎么来」「该push就push」裁量，三原则与 FROZEN 持续有效。UI 契约 v1.4.0 不动，零 UI 改动）

### Fixed
- **doubao `--json` 死旗标双侧同删**（v14「报告不做」的授权续办，ROADMAP §一·五销项）：doubao.mjs 把 `--json` 解析进 `opts.json` 但全文件零读取（emit 单行 JSON 无条件），而 wbx-core 两处 spawn（`askOnceDoubao`/`doctorStatus` 豆包段）在传它——断链旗标。根因化=双侧同删（只删一侧=留断链）：doubao.mjs 删 `case 'json'` 分支、opts 初始 `json` 字段、USAGE `global:` 行三处；wbx-core 两处 spawn args 去 `--json` + 文档注释同步。等价验证：`wbx doubao status --timeout-ms 8000` vs 直跑 `doubao.mjs status` stdout 字节一致 + stderr 一致 + 退出码一致（0/0）；grep `--json` 于 doubao.mjs/wbx-core 豆包路径零残留（cline 的 `--json` 为真实用途保留）。doubao.mjs 其余保持只读复用不动。
- **cline lane 长回复 `result.text` 落盘截断**（ROADMAP §一·五销项；实测证据 job `20261003-171054-6tl`，3MB 事件流在案）：根因=上游 CLI 输出命中上限后自动恢复（`max_tokens_compaction`→nudging→`prompt_submit` 重提，流内 3 个 iteration），`run_result.text`/`done.text` 只携带**末次 iteration 正文**（4074 字符恰为末块全文；完整答案=iter2 1715 + iter3 4074 = **5789** 字符，分属两个 text 内容块，模型续写「### 3.（续）」语义连贯）——桥原样落盘 `run_result.text` 即截断，桥解析本身无丢字。修复落在唯一正确位置：**`parseClineNdjson`**（ask 返回值/fanout 任务记录/UI 历史共用的正文出口，单点修复全链受益）改为逐块感知裁决：正文=全部 `contentType:"text"` 内容块按流序拼接（`content_end` 块全文为单一权威事件；流中断缺块尾时用该块增量兜底、纯空白增量保留）；与 `run_result.text` 后缀关系成立取更全者，无后缀关系（流与摘要分歧）以 run_result.text 为权威不臆造，run_result 缺席按流拼接→done.text 兜底。非补丁理由：数据源头单次正确（解析层一次裁决，非事后读流文件拼接、非下游记录修补），并顺带修复旧兜底 `agentTexts.join('')` 的既有缺陷（增量/块尾全文/done.text 合收双计、`asNonEmptyString_` 过滤丢纯空白增量、流-块混拼污染）。正常路径零变化：在案 5 个正常 job 流均 1 iteration/1 text 块，流拼接==run_result.text 逐字节相等（实测复核）；门禁 v6 ③i–③p 九断言含真实流 fixture（长=6tl 缩样：5789==参考提取器、与 rr 4074 同尾、首尾双锚；短=job 181835-5zu 原样拷贝：87==87 零变化；+分歧护栏+截断兜底两护栏）。
- 证据勘误（如实记录）：v14 落盘的 `internal/archive/v14/v14-codereview-t2-full-report.txt`（11579 字符）实为全文**两遍拼接**的重复件；真实完整答案 5789 字符。档案按「不改史」原则原样保留，真相以本条与 `internal/fixtures/` fixture 为准。

### Chore
- push 补课：v14 commit `3868bde` 已推 origin/main（网络恢复后补推成功）；远端校验走匿名 clone 复扫（gh 未登录，v11.4 先例）：远端 HEAD==3868bde、文件清单与本地 tracked 全等、敏感模式复扫仅 WBX.md 审计模式清单自引用（v6.0/v14 先例零新增）。

## 6.7.0 - 2026-10-03

重构（v14 根因化最简重构轮：单一事实来源 + 叙事清零 + 联动机器化；授权=用户 2026-10-03 三原则原话——「任何修改、修复或者新增的内容，都不能以打补丁的形式完成，必须遵循最佳实践，深度融合到代码逻辑内部，通过重构、调整或者结合现有逻辑的方式实现；不从根源解决只打表面补丁，严格禁止」+「保证最终代码最简——结果简洁且完整实现需求」+ 两窗口与一切子代理都用第一性原理、尽量用内置子代理与 WBX 桥。根因诊断与收敛定案见 `internal/RESEARCH-V14.md`。UI 契约 v1.4.0 不动（wbx-ui 改动为注释级+内部派生，渲染输出经四页签实渲染与 v13/v8/ui-contract 断言验证等价）。**本轮为行为等价重构**，唯二例外：`fanout --lanes doubao` bug 对齐 help 已述契约（原被校验拒绝）、死代码删除）

### Changed（代码最简化——19 项必修落地 18 项，六文件 6238→6232 行）
- **lane 合法集合唯一来源 = core `LANE_ORDER`**：wbx.mjs `--lanes` 校验改 `LANE_ORDER.includes` + 错误文案派生（修复现行真 bug：`--lanes doubao` 被 help 声明支持却被拒绝——真机验证接受 doubao、拒绝非法值、零派发零落盘）；core `CONFIG_DEFS['default-lane'].values` 展开、`loadConfig`/`parseConfigValue` filter、`parseLane` 全部收敛；wbx-ui `LANE_ORDER_UI` 改自 `LANE_ORDER` 模板派生（渲染字节等价）+ `fixedDisabled` 改 indexOf；`--identity`/`--as` 错误文案与 fanout 任务校验文案全部 `LANE_ORDER.join` 派生。
- **死代码删除**：wbx.mjs 六个零引用 import（sleep/ansiStrip/parseConfigValue/laneStatusInfo/newJobId/httpJson）与 `w.dir` 死字段；wbx-core `summarizeJob` 恒等三元、`getJob` 孤儿循环恒假外层、`runAskJob` 死变量 `last`/`fallbackFrom` 及全部 `|| last?…` 冗余兜底；wbx-daemon detach 超时分支不可达双行；wbx-setup assertBundleClean 正则分支被 includes 覆盖合并。
- **公共抽取**（消三份重复）：caps 拒绝对象 `capsInvalid_`/`capsL2NotDelivered_`（askOnce/Cline/Doubao 三处×2 文案逐字不变）、`STDIN_THRESHOLD=12000` 常量（core 三处+CLI INFO 一处）、daemon `probeDecision_`（statusUi 与 probeExisting 共用装配）/`reuse`（三处复用结果对象）/`persist_`（五处 config 写回）、setup `CORE_SCRIPTS`/`DOC_FILES` 模块级清单常量（3+2 处）、ui `WBX_PS` 全局入口前缀常量（8 处拼接）与 `errorHint` 单次调用；doubao.mjs `resolveAnchor` 返回 locator 直用、推理档字符集 `REASONING_VALUES` 单源（USAGE 文案与状态栏正则均派生，正则等价 eval 验证）。
- **叙事注释清零**：六文件版本史/回滚注记/取证过程/工单标签（P1–P10、T7-SN）压缩为当前不变量或删除；保留项均有「解释当前行为」理由（v6.4 fixed 布局注、v1/v2 迁移语义注、契约 A/B 标签、`|| IDENTITIES.cn` 防御兜底三处补注标注）；doctor 告警条件提 `failed` 单次计算（等价）；`[FAIL] 两个 lane 均失败`→`全部尝试 lane 均失败`（文案纠错，单 lane 链下原文案失实）。
- **doubao.mjs 仅等价修复**（C-t6-M2 + 零风险建议）；**C-t6-M1 报告不做**：`--json` 在 doubao.mjs 内确为死旗标（opts.json 零读取），但 wbx-core askOnceDoubao/doctor 两处 spawn 传该旗标、调用方在传——按 GOAL 前置核验规定走不做路径（根因化方案=双侧同删，超出 doubao.mjs「只读复用」边界，留待 v15 授权）。

### Changed（文档单一事实来源化——D-1…D-18 按收敛表执行）
- **WBX.md 1655→1427 行**：顶部权威节重写为当前事实（四 lane 表/回退链/命令参考「以 `--help` 为准」/「四个外部 Agent」，消 D-2 全部点位）；26 个死链目标改链 `internal/archive/`（S-H1）；版本章瘦身——v6.6/v6.5/v6.0 三章与 CHANGELOG 逐句对照后删重复叙事段（保留 e2e 实测/竞态修复/溢出根因量测/lane-caps 映射表/发布记录），v6.1–v6.4 指针化轻瘦身；v4/v5.x 章抽查后确认以实测/调研记录为主（规则保护对象）保留。
- **标题去版本限定词**：WBX/AGENTS/UNINSTALL 三处（版本活在代码常量+CHANGELOG+/__health）；README 顶部加「当前版本见 CHANGELOG」指针；UNINSTALL zip 示例去硬编码版本号（D-8）。
- **README**：架构图补第四 lane（D-3）；lane 表压速览+指针到 SKILL（D-9，lane 表唯一人维护源=SKILL.md）；PROMPTS 条数改「§速查表」指针（D-4）；诚实声明收敛为文首完整声明+两处语境短提（D-13，FROZEN 底线保持）；55 天有效期收敛为 FAQ 一处事实陈述+WBX 认证节指针（D-12）。
- **UNINSTALL 卸载面补全**（D-6，一键还原承诺缺口）：删除清单补 `UI-SPEC.md`、`knowledge/`、`tools/doubao-bridge` +「以 CONTRIBUTING 白名单为准」指针。
- **SKILL/AGENTS 命令口径统一**（D-10）：命令速查声明「以 `wbx --help` 为准」（命令清单唯一权威源=代码内嵌 help）；`install-user` 归 legacy 一行；内嵌用户 AGENTS 标记块（userBlockText）PROMPTS 行联动同步。
- **治理文件**：PLAN 四死链修复（D-5）；ROUTE 地图四补（internal/*.mjs 门禁行/SECURITY+CONTRIBUTING 并入发布面行/tools/doubao-bridge 行/GOAL-RESEARCH 留顶层例外成文）+ 元数据去数字（D-1/D-7/D-17）；CONTRIBUTING 补「门禁在维护者本地 internal/ 不入库，PR 只要求全命令回归」；UI-SPEC §0 加「contract 版本以 §6 末行为准」（D-18）；MEMORY v12.2 条目补「未产 GOAL/RESEARCH」留痕（S-N3）。

### Chore（结构卫生）
- `worker-dark-theme-tokens.md` → `v8-dark-theme-tokens.md`（CHANGELOG/WBX/wbx-ui 三引用同步，S-N1）；`v9-worker-lightweight-ui-guardrails.md` 对称归档 `internal/archive/v9/`；`v7-merge-tests.mjs` 五场景 24 断言内联进 v7-regression ④（a1–e2，原独立脚本归档 archive/v7/——v7 计数 27→50，总断言 51 不变，④a 包装断言换 24 条明细）。
- CHANGELOG 活引址修复：11 处 `internal/` 旧路径改链 archive/（非叙事改写）。

### Added（联动机器化）
- **第九套门禁 `internal/v14-consistency.mjs`（20 断言）**：md 死链=0（跟踪 md+治理五件套+反引号 internal/ 路径）、版本口径四条（WBX_VERSION==CHANGELOG 首条/标题零版本限定词/README 指针/zip 无硬编码版本）、lane 单源六条（含 `--lanes` 功能级实测）、UNINSTALL 删除面 ⊇ CONTRIBUTING 白名单三条、TYPE_LABEL 键集==D2 冻结集两条、叙事清零三条（回滚注记/里程碑前缀/PROMPTS 条数硬数字）；纯文件/纯函数+零派发子进程探测，不依赖任何 lane 在线——把 v12.3 起的人工联动扫描升级为机器断言。

### 验证
- 九套门禁+新套件全绿：v6 24 / v7 50 / v8 22 / v11.3 38（含 cline 真机）/ v13 52 / contract 23 / 红测全绿（含恢复自证）/ tokens-sha 58=efeee49b0e 不变 / v14-consistency 20/20；`wbx --help` 与基线 diff 仅版本行。
- 真机：doctor v6.7.0 通过；`ask --as cn` 8.1s / fanout 1/1 成功；`wbx doubao status/ask` 直通与直跑字节一致、jobs 零新增（双入口语义）；export-bundle v6.7.0 零凭证断言通过；self-install 五模块 diff identical + `ui --stop`/`--detach` + `/__health`=6.7.0；控制台四页签实渲染目测与改前一致（状态四通道卡+五 chip/调用分段器五钮/历史 208 条+累计 tokens/登录三卡）。
- 行数对比（before→after）：六文件 6238→**6232**（净 -6；预估 150-283 未达——叙事注释按授权要求「压成一行不变量」而非删除、防御兜底按指定保留+标注、公共抽取以单源化为目标而非减行，净删量小但同步面显著缩小）；WBX.md 1655→**1449**（含 v6.7 章）；README 313→311；UI-SPEC 513→514；SKILL 219→221；UNINSTALL 180→181；CONTRIBUTING 58→59。

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
- T7 评审（wbx ask 外包，ai 超时自动回退 cn 交付，87.1s）：**0 阻断 / 5 建议**——采纳 3 已修（① doubao 子进程 close 只透传退出码、不重抛同名信号，防非 POSIX 信号名 ERR_UNKNOWN_SIGNAL；② self-install 豆包复制加四要素装完即验；③ HELP/标记块启动路径统一 %USERPROFILE% 粘贴即用形态——顺带修复 wbx-ui.mjs 模板字符串里单反斜杠被转义吞掉的断路径隐患，已按文件既有约定双写），验证 2（全仓无 6.2.0 残留硬编码；doubao.mjs 无参=usage+exit 1 不挂起）。记录 `internal/archive/v12/v12.2-t7-review.txt`（gitignored）。

## 6.2.0 - 2026-09-30

新增（两项缺陷修复：授权=用户 2026-09-29「三点偏离有什么需要修复的你帮忙看看」委托一号纳入 v11.3；契约 A/B 逐条对照见 `internal/archive/v11/v11.3-t7-review.txt` 与 [WBX.md](WBX.md) v6.2 章。改动面：`wbx-core.mjs`（主）、`wbx.mjs`（--max-turns 旗标+help）、`wbx-ui.mjs`（两端点透传）；L0 参数序列逐字不变）

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
- T7 评审（wbx 外包，材料=契约+diff+实现者自述，经 ai 超时回退 cn 交付）：**0 阻断 / 7 建议**——接受 3（l1-turns-exhausted 加 L1 门控；错误文案超时插值；24 常量三处统一引用）已修并复验全绿，驳回 3 有据（cline parsed.error 不门控：防漏检 exit 0 的真实 auth；maxTurns×L0 报错维持设计定案；重试短路超契约授权记下轮提案候选），1 项验证无影响（旧导出符号全仓零引用）。评审材料本身含 "Authentication required" 字样且未误判——契约 B 获实战验证。记录 `internal/archive/v11/v11.3-t7-review.txt`（gitignored）。
- 环境注记：本机 npm 全局 prefix 为 `~/.npm-global`（不在 PATH），cline 平台 exe 经桥 config `cline-path` 显式解析（不改系统环境变量）。

## 6.1.0 - 2026-09-29

新增（桥报错观测修复 P1+P3：授权=用户 2026-09-29 裁决「授权 P1+P3，P2 不做」；改动仅 `wbx-core.mjs` 单文件 +44/−10，成功路径解析/落盘/exit 语义/既有字段零改动，cline lane 解析路径零触碰）

### Added
- **失败 attempt 完整输出落盘**：任一 attempt 失败（含同 lane 重试与跨 lane 回退的每次失败）时，该次完整 combined（stdout+stderr）写入 job 目录 `<taskId>.attempt<N>.output.txt`；成功路径零新增落盘。失败返回值新增 `combined` 字段（只增不改名），落盘与指针由 runAskJob/runFanoutJob 统一经 `dumpFailedAttempt` 执行——落盘写失败仅告警不中断（诊断绝不影响主流程）；无进程输出的失败（caps 拒绝、未安装等）不落盘。
- **错误消息尾部文件指针**：`（完整输出已存 <jobDir>/<taskId>.attempt<N>.output.txt）`，`wbx history` 回放者可直接定位（history 全文打印错误，指针可见）。

### Changed
- **unparseable/cli-error 的诊断 brief 改首尾各半**：combined 超 320 字符时由「头部 320 截断」改为「首 160 + 尾 160 + `…(省略 N 字符)…`」（新增 `errorBrief()`，仅用于该两类失败错误文本；既有 `brief()` 行为与其余展示路径零回退）。背景：combined 常以约 300 字符环境横幅开头，真实错误在尾部——旧截断在实测失败形态（combined 412 字符）下恰好把真因 `Max turns (8) exceeded` 整个吞掉。

### 实证与回归
- **P3 复现直接翻案**：glm-prompting 原词 L1 单发 ai/cn 双 lane 同因失败，P1 全量落盘实证 stdout 空、stderr=横幅+`Max turns (8) exceeded`——v11.1 假设⑤（L1 `--max-turns 8` 耗尽静默失败）由「部分证伪」翻转为**证实主因**；9/28-9/29 失败潮形态一致。归档 `internal/archive/v11/v11.2-repro-output.txt`（gitignored）。
- 回归：新增 `internal/archive/v11/v11.2-regression.mjs` 25/25 全绿（errorBrief 首尾各半/空输出判别/attempt 落盘与指针/history 回放/成功路径零变化——WBX_HOME 沙箱 + WBX_CLI 假 CLI 全离线）；既有 v6-regression 与改动前基线结果完全一致（22 PASS/2 FAIL，两项失败为 cline 未装时 doctor 跳过免费模型校验的既有环境依赖项，非本版引入）。
- T7 评审（wbx 外包，材料=契约+diff）：0 阻断 5 建议——接受 2（限流判定先于落盘防指针文本污染；落盘 try/catch 防诊断失败中断主流程）已修并复验全绿；驳回 3 有据。记录 `internal/archive/v11/v11.2-t7-review.txt`（gitignored）。

## 6.0.0 - 2026-09-25

新增（两大特性：**caps 能力分级**（L0/L1/L2 显式契约）+ **历史页行内详情**；授权=用户 GOAL-V10 原话「我们要尽可能最大限度地发挥它们的性能，只要有需要，就可以让它们使用工具、联网」+「我点击一个条目，希望它的详细内容直接出现在条目下方，而不是要翻到界面最底下」。改动面：`wbx-core.mjs`（caps 管道+config 键+doctor 步）、`wbx.mjs`（--caps 参数+轨迹打印）、`wbx-ui.mjs`（行内详情+caps 三件）、[PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md) v3、[SKILL.md](.zcode/skills/wb-bridge/SKILL.md)、[AGENTS.md](AGENTS.md)、[UI-SPEC.md](UI-SPEC.md) v1.1.0、[WBX.md](WBX.md) v6.0 章、[README.md](README.md)、[UNINSTALL.md](UNINSTALL.md)。L0 路径参数序列字节级不变）

- **caps 能力分级（worker 契约升级）**：三 lane worker 从「永远纯文本端点」升级为显式能力契约——
  - **L0（默认）**：纯文本无工具，与 v5 参数序列字节级一致（`--tools '' --max-turns 1`），v6 门禁 24 条含字节级不变断言 + L0 冒烟 job 复证，零回归。
  - **L1（联网+只读，仅 WorkBuddy AI/国内版）**：白名单工具 `WebSearch,WebFetch,Read,Glob,Grep` + `--permission-mode default`（四模式实测最小特权面）+ `--max-turns 8`；每任务 scratch 工作目录（`~/.wbx/scratch/<任务id>/`，越 cwd 绝对路径读取进程级 DENIED——探针 p2c 实测）；缺省超时上浮 `max(600s, timeout)`；工具轨迹（counts+samples）落任务记录、完整转录存 `<任务id>.transcript.json`（不计入 history 任务数）；L1 任务固定 ai/cn（回退链自动滤掉 cline）；CLI `ask --caps L1` / fanout 任务级 `"caps":"L1"` / UI 调用页 caps 选择器三入口齐备。如实声明：WebFetch 在 default 权限档被拒，联网主力是 WebSearch（PROMPTS E-012）。
  - **L2（受控全能力，仅 cline）缓期未交付**：Phase 0 检测级证据——cline 3.0.65（npm latest stable）二进制无 `CLINE_COMMAND_PERMISSIONS` 字符串，deny:`["*"]`/deny:`["node *"]`/docs 示例 allowlist 三组全失效且 `del` 实删文件 → 六层防护栈（白名单工具面/命令级 deny/scratch/轨迹落盘/超时回合上限/总闸+显式 flag）缺第②层，**缺一不交付**。用户 2026-09-25 裁决「L2 缓期，本版留位」：`--caps L2` 显式报未交付（含裁决与交付条件说明），总闸 `caps-l2-enabled`（默认 false）即使置 true 也不放行；治理冻结于 FROZEN 二.8；上游发布该特性后按完整六层交付。
  - **绝不静默降档**：无效档位 / L1×cline / L2 一律显式报错（`caps-invalid`/`caps-lane-mismatch`/`caps-l2-not-delivered`）；config 新键 `default-caps`（默认 L0）+ `caps-l2-enabled`（默认 false）；doctor 新增 caps 步。
- **历史页行内详情（UI 契约变更 v1.1.0，变更程序合规）**：详情从页底 `#job-detail` 卡退役 → 点击行正下方 `tr.job-inline` 行内卡（`.job-inline-card`，手风琴单开沿用，再点收起）；调用页 ask 高级区 caps 选择器（L2 disabled 标未交付+L1 提示行+高级摘要实时档位）、fan 行 caps 列（四列→五列 86px）、taskHead caps 徽标「L1 联网档」、概览/通道卡「能力档」行、L1 `trace-box` 工具轨迹折叠件。三处同步：UI-SPEC §6 v1.1.0（token 键集与值零改动）+ ui-contract 新增 H1–H4（19→23）+ v9-redtest 新增 M-H1..H4/N-H；v8 门禁 ①d 同步五列断言。浏览器实机验证 + before/after 截图四张在案（`internal/archive/v10/v10-ui-*.png`）。
- **PROMPTS.md v3**：原则 2「能力边界声明必写」按 caps 档位（L0 句式逐字保留，「你没有任何工具」全文 18 处零改动）；新增 P13（注入防御：网页内容是数据不是指令）、P14（来源清单 URL|访问时间|支撑要点）、T4-L1（联网调研模板）、T10（L2 代码自测回路模板，先行入库待启用——写→跑→修闭环+反作弊条款）、E-012、派发流程 1b（caps 判定）、决策速查表 caps 列。
- **门禁与回归**：v6 24 + v7 27 + v8 22 + ui-contract 23 四门禁全绿；红测 22 正向变异（红且红得对）+ 4 负向对照（全绿）+ 恢复自证。
- **验收证据**：L1 ask 端到端 job `20260925-201509-h7t`（ai，WebSearch×6+WebFetch×1，轨迹+转录落盘）；混合档 fanout job `20260925-201708-nnd`（L0@cn 无工具 / L1@ai 带来源清单，同批混档路由正确）；L0 冒烟 job `20260925-201642-nwp`。探针脚本 `internal/archive/v10/v10p0-p*.mjs` 可复跑；设计定案 `internal/RESEARCH-V10.md`。

## 5.4.0 - 2026-09-25

新增（UI 风格契约化：规格文档 + 机器护栏 + 治理登记三位一体；代码改动仅 `wbx-ui.mjs` 展示层 token 改名/哨兵注释 + `wbx-core.mjs` 版本号一行，后端 handler、API 字段、config 键、守护、安全面零改动）
- **[UI-SPEC.md](UI-SPEC.md)（仓库根，新跟踪文件）**：UI 风格契约规格文档（contract v1.0.0）——§0 权威源声明（`:root` 哨兵块为唯一真源，文档为派生快照，头部标 `tokens-sha: efeee49b0e`）+ §1 Foundations（58 token 全表/对比度清单/动效与 reduced-motion/中文排版）+ §2 20 个组件×固定 8 字段（含「何时不用」与 frozen|extension 徽标，实机逐页核对）+ §3 Patterns 三条 + §4 Guidelines（术语规则/Do-Don't 总表/人工视觉走查清单/程序断言天花板诚实声明）+ §5 不变量与扩展点（5 条判定规则+一句话判据「会不会让无关页面的截图 diff 变化」+contract version 语义+变更程序，**契约主体**）+ §6 变更记录。
- **token 语义化改名**（趁零消费方窗口，冻结前一次性改诚实；值不变、视觉零变化）：`--acc-300`→`--acc-text`（淡底上主色文字）、`--acc-600`→`--acc-hover`（主色 hover）、`--panel2`→`--panel-inset`（嵌在面板内的次级面）；全站 17 处消费方同步；`:root` 加 `/* @tokens:begin */`/`/* @tokens:end */` 哨兵注释对（宣告唯一真源，改动须同步 UI-SPEC 并过 ui-contract）。改名映射在本条目记录；CHANGELOG 5.3.0/WBX.md v5.3 章中的旧名是历史记录，保留不改写。
- **机器护栏 `internal/ui-contract.mjs`**（工程内部件，gitignored）：19 条断言（编号枚举 T1-T5/C1-C6/S1-S4/D1-D4；worker B 报告标题称 18 条但其枚举即 19）——token 键集双向差集快照（T1）、全 58 token 值逐值归一化快照（T2，T7 二审后从状态色 17 值扩展）、刻度单调（T3）、哨兵块外零新增 hex（T4，既有 4 处入白名单冻结）、四态色两两不等（T5）、关键类存在（C1，选择器空白容差）、表格容器包裹（C2）、无超宽像素（C3）、1100px 正文容器（C4）、零外链（C5）、切片保活（C6，且 T4/C3/C5/D4 加保活前置防空转绿——T7 二审采纳）、形状双编码四类各异（S1，比规则体防恒不同空转）、到期色阶阈值 0/7/30 冻结且有序（S2）、状态标签映射冻结且全覆盖（S3）、aria-expanded 双件（S4）、品牌/术语/四页签标签冻结（D1）、type 英文枚举（D2）、job 字段超集（D3）、alert 零命中+toast 常驻（D4）。与 v6/v7/v8 回归并存不合并（v8 守行为零回退，contract 守设计系统契约），发布门禁串行全跑。
- **红测协议**（`internal/v9-redtest.mjs`，验收硬门）：18 个正向变异（每族抽样，含 `d<=7` 改 `d<=8`、token 值改一位、删关键类、翻状态映射、切片正则失效）全部红且红在预期断言；3 个负向对照（改文案/加空行/调 CSS 属性顺序）全部仍绿（防脆断）；恢复由脚本自证（源文件哈希=基线+重跑全绿）。矩阵落 `internal/archive/v9/v9-redtest-matrix.md`。
- **治理登记**：`internal/FROZEN.md` 追加「UI 契约冻结」项（冻结范围=UI-SPEC §5.1 不变量清单；变更程序=用户显式授权+同步三处+红测重跑+四门禁全绿；注明 2026-09-25 用户授权原话）。README 增一句指向 UI-SPEC.md。
- **视觉零变化验证**：改名前后浏览器实机 9 组对照截图（状态/调用/历史/登录/toast/运行中/停用态/体检中/体检结果，1280×900 同视口）；「调用」页逐像素一致；其余差异经三重负向对照（同代码连拍 0 像素差、同代码双 reload 0 像素差、**旧代码 vs 旧代码跨渲染会话 0.619%>改名对 0.293%**）证明全部为环境级光栅化噪声或已知动态内容（体检「上次 N 分钟前」时间戳/体检时长数字/历史表新增行/呼吸动画相位），与改名无关。

说明
- 零依赖零外部资源红线保持；术语表 v5.2 冻结不动；v5.2/v5.3 行为零回退：v6 24 + v7 27 + v8 22 + contract 19 四门禁全绿 + 全命令冒烟通过。
- 自举（wbx 外包，材料先行，逐份校验后采用）：规格 §1/§2/§4 初稿三路并行（job `20260925-180829-lxf` 3/3）+ 改名 diff 评审批判（`20260925-180410-ax5`，无阻塞意见；panel-inset 语义争议记录不采纳）+ 护栏断言清单二审（`20260925-182119-pag`，采纳 4 条：T2 扩全量值+归一化/C1C2 空白容差/sliceAlive 前置/红测补 M-C3；不采纳 3 条记录在案）。
- 设计依据与裁决见 `internal/RESEARCH-V9.md`（P0-P4 定案）；三份外部调研沉淀 `internal/archive/v9/v9-worker-*.md`。

## 5.3.0 - 2026-09-25

新增（只动展示层：后端 handler、API 字段、config 键、守护、安全面、术语表全部零改动）
- 控制台「产品化」改造：从「字段平铺的调试页」重排为「3 秒回答三个问题（一切正常吗？哪里不对？我现在能干什么？）」的产品级界面。信息架构重排 + 视觉系统升级，全部改动限于 `wbx-ui.mjs` 的 HTML/CSS/前端 JS。
- 状态页：新增**健康总览条**（结论句「N/3 通道可用 · 路由」+ 三枚通道 chip，chip 带四态形状色并锚点跳转通道卡，全绿时显示「一切正常」）；通道卡瘦身同构（卡头=品牌全称+状态徽标+账号+电源式停用开关；扫读层 3-4 行=成本三档徽标/模型/凭证到期色阶/cline 免费组信号；endpoint、二进制路径、模板、思考压缩、登录方式全部收进「详情与排障」折叠层）；**异常通道置顶**（四态×到期复合严重度排序）；路由卡只剩 4 选段器+生效说明（停用开关移入通道卡，矛盾组合行内黄条提示）；体检卡空态三要素（尚未体检+上次时间戳[localStorage]+CTA）与结果三分组（失败红默认展开+复制/跳过灰/通过绿，组头计数徽标，删大段 pre）。
- 状态编码系统（全站统一）：凭证到期色阶四档（>30 天绿弱化 / 8-30 天 ▲黄 / 1-7 天 ▲橙 `--warn2` / ≤0 ■红+「重新登录」内联动作）；可用四态形状+颜色双编码（●可用/▲降级/■不可用/○已停用；未安装=虚线环；进行中=空心环呼吸动画，`prefers-reduced-motion` 静态降级）；成本三档统一徽标（免费/近免费/免费·限时配额，原始口径进 title）。
- 视觉系统 token 化：间距 s1-s6/圆角三档+pill/字阶+行高/阴影三档/过渡+缓动全部 CSS 变量化（基线 `internal/v8-dark-theme-tokens.md`，含三处对比度修正落地：acc 淡底文字 `--acc-300`、12px 微文本 `--dim-hi`、控件边界 `--line-ctrl`）；组件规范落地（键值行 96px+minmax(0,1fr)+ellipsis+title+tabular-nums、卡头、段标题左色条、表格 sticky 表头+行 hover+数字右对齐无斑马纹、深色表单聚焦环+纯 CSS select 箭头、按钮三档 primary/ghost/danger、电源开关、分段器）；5 个产品感手法（卡片悬浮微抬升[包 hover:hover]、tab 下划线动效、等宽数字、进行中呼吸、滚动条着色）。
- 调用页：单卡+模式分段器（单条调用（ask）/批量并行（fanout））；思考档/模型/超时与并发/超时收进「高级」折叠（标题右侧显示当前值摘要）；结果卡徽标行+markdown 默认 6 行截断可展开+错误框带复制。
- 历史页：类型列徽标化、数字列右对齐 tabular-nums、通道分布移入详情、任务 ID 列窄化+点击复制（CLI 回放入口保留）；详情手风琴单开（点新收旧），内分概览→任务→产物三段。
- 登录页：WorkBuddy 两按钮上下分组（轮询时按钮 disabled+内联 spinner+文案，删独立状态大块）；cline 命令行引导卡下沉折叠（默认收起）+一键复制。
- 全局交互：右下角 toast 组件（info/success 4s 消失、error 常驻+关闭钮）替代全部 `alert()`；折叠元素带 `aria-expanded`（动态渲染同步初始化）；数据加载失败兜态（总览条区域显式报错+重试）。

修复
- 登录页 cline 命令展示丢反斜杠（v5.2 存量展示 bug）：模板字符串内未知转义序列吞掉 `\`，命令显示为 `%USERPROFILE%.zcodewbx-bridgescriptswbx.mjs`，复制即坏命令；v5.3 以 `\\` 源级转义修正，现显示完整路径。

说明
- 零依赖零外部资源红线保持：无框架/CDN/字体/图标库/构建步骤，图标用纯 CSS 形状，单文件 HTML 内嵌，离线可用。
- 回归门禁：新增 `internal/v8-regression.mjs`（22 断言全过：横向滚动结构保障/alert 零命中/术语冻结/数据层零改动/v5.3 专断言）；v7 回归 27/27（⑤ 展示层断言一字未改即过）、v6 回归 24/24、全命令冒烟通过（doctor/ask/fanout/models/config/history/ui 四参数/export-bundle）。
- 设计依据与被否决备选见 `internal/RESEARCH-V8.md`；施工图 `internal/archive/v8/v8-blueprint.md`；T7 评审采纳 9 条（chip 复用四态形状、排序键闭合、`--warn2` 橙 token、进行中改空心环、未安装虚线、toggle 捕获监听、异常内联 CTA、加载失败兜态、结论句拆降级计数），否决 1 条（免费模型下拉位置维持 RESEARCH-V8 定案：留在详情层+「切换」快捷链接）。

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