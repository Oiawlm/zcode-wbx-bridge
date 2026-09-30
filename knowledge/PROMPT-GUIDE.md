# PROMPT-GUIDE — 主模型侧提示词书写指南（v1）

> 定位：主模型侧（GLM-5.3 / GLM-5.3-Flash，2026-09-29 起两窗口统一 Flash）提示词书写规范与检查清单，覆盖窗口交接、ZCode 子代理、wbx worker 派单三类场景；目标是让从未参与本项目的新窗口只读本文件即可写出可执行提示词。
> 受众：GLM-5.3 / GLM-5.3-Flash 主模型侧。worker 侧（DeepSeek）见 `.zcode/skills/wb-bridge/PROMPTS.md` v3——两库并列、按受众分治，不重复维护。
> 来源：内部 `internal/RESEARCH-V11.md` §二/§三；外部官方文档逐条见 §五（每条含来源定位与访问日期；无法给出线上 URL 者已如实标注来源形态）。
> 日期：2026-09-29　行数预算：≤220 行

本指南防的四类错：交接丢上下文、提示词含糊无边界、把长期规则写进一次性 prompt、全量灌上下文推高幻觉率。最小充分结构：受众矩阵定规范 → 四段式定单条 prompt → 交接契约定文件结构 → 子代理要点定委派 → 来源沉淀定依据 → 反模式清单守底线。

---

## 一、三类受众矩阵

| 受众 | 载体 | 用什么规范 |
|---|---|---|
| 一号→二号窗口交接 | `internal/GOAL-V<n>-PROMPT.md` | 本文件 §二 + §三 |
| ZCode 内部子代理 | Agent 工具 prompt | 本文件 §四 |
| wbx 外部 worker | wbx `ask` / `fanout` | `.zcode/skills/wb-bridge/PROMPTS.md` v3（不重复维护） |

三条使用规则：

- 三类提示词受众不同、规范不同，**不得互相套用**（例：不要把 §三 的窗口契约塞进子代理 prompt）。
- 提示词是分层资产：统一沉淀、按编号取用；动笔前先归位到上表某一行，再选对应规范。
- 一号窗口的最终输出物 = 供二号窗口执行的提示词（GOAL-Vn-PROMPT.md），不是口头交代。

---

## 二、四段式契约（智谱官方四要素的落地形态）

来源：智谱官方「Coding Agent 最佳实践」——任务描述四要素：目标 → 上下文 → 约束 → 完成标准。结构化输入的作用是**减少 Agent 的猜测空间**；四段残缺时模型只能自行补全，猜测空间随之增大。

### 2.1 目标（Goal）——要实现什么

- 写什么：一句话说清「要实现什么」，结果导向、可验收，不写实现步骤。
- ✅ 正例：「新建 knowledge/PROMPT-GUIDE.md，覆盖三类受众规范，总长 ≤220 行。」
- ❌ 反例：「优化一下提示词相关的东西。」——无对象、无边界、无法验收。
- ☐ 检查点：目标里能直接看出交付物文件名或明确产物形态吗？

### 2.2 上下文（Context）——涉及哪些文件/模块

- 写什么：涉及哪些文件/模块；引用文件路径或贴关键片段，含「禁读/别动」清单，让执行者不必猜。
- ✅ 正例：「事实来源为 `internal/RESEARCH-V11.md` §3.3 骨架，逐条落实，不新增事实。」
- ❌ 反例：「参考之前那个调研。」——依赖会话记忆，新窗口无法复原。
- ☐ 检查点：上下文里每个引用都是可打开的文件路径或可定位的片段吗？

### 2.3 约束（Constraints）——不许做什么

- 写什么：代码风格/架构规则/安全/依赖限制/不动清单（如 FROZEN 冻结项、桥代码零改动）。
- ✅ 正例：「不动清单：PROMPTS.md v3 本轮只增一节；本轮不进桥 CHANGELOG 与版本号。」
- ❌ 反例：「注意别改坏东西。」——把约束写成态度，不构成可执行限制。
- ☐ 检查点：约束是否明确列出「不许做什么」，而不只是鼓励做什么？

### 2.4 完成标准（Done when）——何时算完成

- 写什么：可判定的完成口径，如测试通过、行为变化、bug 不再复现、行数与格式达标。
- ✅ 正例：「Done when：六节齐全；总长 ≤220 行；每条事实可回溯到材料。」
- ❌ 反例：「做完给我看看。」——没有判定条件，验收必然扯皮。
- ☐ 检查点：第三方不问作者，能否独立判定通过/不通过？

补充铁则：**临时指令写在 prompt 中，长期规则写入项目级配置文件（AGENTS.md）**——反复说明的信息应变成稳定项目上下文，不要每轮重述。

---

## 三、双窗口交接提示词契约（GOAL-Vn-PROMPT.md 标准结构）

| 段 | 作用 | 写作要点 |
|---|---|---|
| 身份与目标模式 | 声明二号窗口是谁、以什么模式工作 | 执行落地模式：产出文件而非对话 |
| 上下文承接指令 | 规定读什么、禁读什么 | 冷启动固定顺序：AGENTS.md → ROUTE.md → MEMORY.md → 按角色选读；禁止无目的通读 `internal/` 或 `WBX.md` |
| 背景 | 说明为什么做本轮工作 | 取自 RESEARCH-Vn，使执行者能判断边界外情况 |
| Phase 任务 | 把复杂需求拆成可逐步完成的阶段 | 逐 Phase 写清产出物与前置依赖（Plan 先于实现） |
| 铁律 | 不可协商的行为底线 | 第一性原理 / WBX 分派 / 校验后使用 / 单一写者 / FROZEN |
| 验收清单 | 汇总可勾选的 Done when | 对齐 §二 四段式，逐条可判定 |
| 收尾动作 | 交代落地后的文件维护 | 更新 MEMORY/ROUTE/PLAN、去重压缩、留档指针 |

**自包含原则**：每份 GOAL 提示词必须自包含——二号窗口不依赖一号会话记忆，上下文只经文件传递。冷启动无法复原的信息，等于没写。

**活样例**：`internal/GOAL-V11-PROMPT.md`（真实使用中的二号窗口执行提示词），其结构为「身份与工作方式铁律 → 上下文承接 → 背景 → Phase 0~5 → 验收总口径」，可直接对照仿写。

### 3.1 命名与结构规范

- 目录语义：`internal/` = 策划面私有（gitignored）；`knowledge/` = 项目级共享知识；`.zcode/skills/` = 桥技能面；根目录 = 发布面。
- 窗口轮次资产命名沿用既有惯例：`GOAL-V<n>-PROMPT.md`、`RESEARCH-V<n>.md`、`v<n>-research-tasks.json`、`v<n>-worker-*.md`。
- 新 MD 一律三要素：文件头一句话定位 + 来源链接 + 日期；UTF-8 编码；行数预算写进文件头（如 ROUTE.md ≤90 行、本文件 ≤220 行）。
- 提示词文件自身也要瘦身：超出行数预算先删冗余，再补新内容。

---

## 四、ZCode 内部子代理提示词要点

- 四要点必写：**自包含**（子代理看不到主上下文）+ **第一性原理要求** + **期望产出形态** + **只回传结论**（探索过程留在子代理窗口）。
- 大批量委派时层级 ≤2（主 Agent → 子代理；子代理不再开子代理），避免上下文碎裂与协调成本。
- 命名冲突：本机 ZCode 规范的事实是——Skill/Command 发现顺序为 显式配置根 → 用户 `.zcode` → 用户 `.agents` → 工作区 `.zcode`（逐级向上）→ 工作区 `.agents` → 插件；同级 `.zcode` 先于 `.agents`；**同名 skill 第一个赢**（用户级遮蔽工作区同名）。批量子代理建议用唯一前缀区分命名（实践推论，非官方条文）。
- 规则不重复抄：AGENTS.md 用户级先注入、工作区后注入（可收窄/覆盖），子代理 prompt 无需复述 AGENTS.md 已有规则。
- ✅ 正例：「探索 `internal/` 下所有 MD 的引用关系，只回传：文件清单 + 每个文件的被引用次数 + 死链列表。」
- ❌ 反例：「帮我看看 internal 目录。」——无交付物形态、无边界，回传内容会灌满主上下文。
- ☐ 检查点：子代理 prompt 是否声明了第一性原理要求、产出形态、回传边界三件事？

---

## 五、官方来源沉淀

### 5.1 智谱官方「Coding Agent 最佳实践」（一手）

URL：https://docs.bigmodel.cn/cn/coding-plan/learning-resources/best-practice.md　访问日期：2026-09-29

- 「上下文比提示技巧更重要」：一次性问答式使用无法发挥 Agent 能力。
- 任务描述四要素：目标 / 上下文 / 约束 / 完成标准（Done when）。
- 临时指令写在 prompt 中，长期规则写入项目级配置文件（目录结构、构建命令、测试流程、代码规范、PR 流程）。
- Plan 先于实现：复杂需求直接写代码易反复，应转为按计划逐步完成。
- Skill = 结构化任务模板：某段提示词被反复使用即应沉淀为 Skill；Automation 是 Skill 的下一层。
- 会话管理 = 上下文治理：每任务独立线程、定期压缩/摘要历史、多 Agent 协作（子代理探索/测试/排查，主代理协调）。
- Z.ai devpack 版同页核对（https://docs.z.ai/devpack/resources/best-practice.md，2026-09-29 访问）：
  与上五点逐字同源，增量四节——执行环境决定 Agent 能力边界、参与全开发环（实现/测试/lint/评审）、
  MCP 扩展外部上下文、稳定流程升级为 Automation。

### 5.2 智谱官方「记忆机制」（一手）

URL：https://docs.bigmodel.cn/cn/coding-plan/learning-resources/memory-mechanism.md　访问日期：2026-09-29

- 五类记忆：Session / Project / Semantic / Episodic / Procedural；使用范式固定：检索 → 构建上下文 → 任务后更新。
- 指令型与学习型记忆必须分开，否则「经验性信息不断污染系统规则」。本项目落地：规则本体在 `AGENTS.md`（指令型），`MEMORY.md` 只记用户说过什么/为什么（学习型）。
- 长期指令必须写 .md：上下文压缩后记忆文件重新从磁盘加载，只存在于对话中的指令会丢。
- 分层作用域：组织级 → 项目级（版本控制共享）→ 用户级（低于项目规则）→ 本地级（不进 Git）→ 角色/subagent 级（各代理独立记忆目录，MEMORY.md 前 200 行）。
- 防膨胀四法：能按路径/条件加载的规则不全量加载；主记忆文件 ≤200 行、专项规则按主题拆分；规则具体可验证；过大即拆分或移入 rules/ 目录。

### 5.3 GLM 官方模型文档（一手：zai-org GitHub README + docs.z.ai）

- README：https://github.com/zai-org/GLM-4.5（v11.1 补录完整 URL）
- docs.z.ai：v11.1（2026-09-29）补抓成功，目标页全部一手到手；官方 llms.txt 索引无独立
  prompt-engineering 指南页（`/guides/prompt-engineering/overview` 实测 404，勿再尝试）。
- Interleaved Thinking：每次响应与工具调用前思考，提升指令遵循；默认开启（vLLM/SGLang 部署时），关闭用 `chat_template_kwargs.enable_thinking=false`。
- Preserved Thinking（GLM-4.7+，agentic 场景推荐）：多轮自动保留全部思考块、复用已有推理而非从头推导——与本项目 RESEARCH/worker 留档同构。
- Turn-level Thinking：按轮次开关思考，轻量轮次关、复杂轮次开（与本项目 effort 分档思路一致）；工具描述用 OpenAI-style format。

GLM-5.3 / GLM-5.3-Flash 专属（docs.z.ai 一手，访问日期均 2026-09-29）：

- **强制思考**：GLM-5.3 与 Flash 思考不可关闭——`thinking.type` 仅支持 `enabled`，设
  `disabled` 直接报错；轻量任务用 `reasoning_effort: "low"` 替代关思考（模型页迁移指引）。
  官方通用建议「简单任务可关思考」对这两型不适用。
- **reasoning_effort**：仅 `low`/`high`/`max` 三档，默认 max，取其余值报错（多档与可关是
  GLM-5.2 才有）；官方明言「For complex tasks such as coding, we recommend using `max`」。
- **思考块回传铁则**：多轮+工具调用场景必须把 `reasoning_content` 完整、原样、按原序回传
  （连续块须与原序列完全一致），否则性能与缓存命中双降。与 §四「子代理只回传结论」不冲突：
  后者是子代理→主代理的汇报边界，前者是消息历史对模型的上下文管理。
- **Preserved Thinking 分端点**：Coding Plan 端点默认开启；标准 API 默认关闭，需
  `clear_thinking: false` 显式开启，并同样遵守回传铁则。
- **预算与采样参数**：两型均 1M 上下文 / 128K 最大输出；官方样例 temperature 1.0；
  max_tokens 建议 ≥1024（5.3 系默认 65536、上限 131072）；temperature 与 top_p 只调一个，
  确定性输出用 `do_sample=false`（贪心），top_p 推荐 0.8–0.95。
- **Agent/编码提示词**（5.3 模型页）：任务按「真实专家工作单元」写——多步依赖、隐藏状态、
  端到端 ownership，不做步进式监督；系统提示词给角色专长 + 边界清晰的具体用户任务。
- **Flash 页增量**（归入 VLM 分类）：推荐 temperature 1 / top_p 0.95 / effort max；提示模型
  自渲染、自观察产物并迭代（agentic self-verification）；明确交付物规格、按里程碑测试、
  要求标注未验证项与遗留风险。
- **Flash 形态差异（如实记录）**：docs.z.ai 把 Flash 归入 VLM——原生多模态（输入
  Video/Image/Text/File、输出纯文本），320B 总参/18B 激活、稀疏+线性注意力提效。ZCode
  会话所用 GLM-5.3-Flash 是否同一多模态形态未在会话侧核实，不强行归因；其强制思考、
  effort 三档、1M/128K 与 5.3 主页口径一致。

来源页：https://docs.z.ai/guides/llm/glm-5.3.md、https://docs.z.ai/guides/vlm/glm-5.3-flash.md、
https://docs.z.ai/guides/capabilities/thinking-mode.md、https://docs.z.ai/guides/capabilities/thinking.md、
https://docs.z.ai/guides/overview/concept-param.md、https://docs.z.ai/devpack/resources/best-practice.md

### 5.4 ZCode 官方配置规范（一手，本机官方插件镜像）

来源：zcode-guide 插件 `zcode-configuration-guide` skill（本机官方插件缓存镜像，权威等同线上；无独立线上 URL）　访问日期：2026-09-29

- AGENTS.md 分层与合并：用户级 `~/.zcode/AGENTS.md` 先注入，工作区 `<repo>/AGENTS.md` 后注入（可收窄/覆盖）；工作区文件自 cwd 向上搜索到项目根。
- 发现顺序：显式配置根 → 用户 `.zcode` → 用户 `.agents` → 工作区 `.zcode`（逐级向上）→ 工作区 `.agents` → 插件；同级 `.zcode` 先于 `.agents`；同名「第一个赢」。
- AGENTS.md 是「注入模型上下文的宽行为规则」，不是 skill/command；`/init` 面向工作区 AGENTS.md。
- Hooks 七事件（SessionStart 含 startup/resume/clear/compact），v5.2 自启钩子已按此实现。

### 5.5 DeepSeek / Cline 增量（二手，wbx L1 worker 搜索摘要产出）

来源：wbx job `20260929-163005-4lq`（worker deepseek-v4.1-flash，L1 档，83.2s，WebSearch×22 / WebFetch×4，WebFetch 被 default 权限拒，要点基于搜索摘要——与 E-012 一致）；域名 api-docs.deepseek.com 与 docs.cline.bot　访问日期：2026-09-29。参数细节另见 `.zcode/skills/wb-bridge/PROMPTS.md`「DeepSeek 参数增量（2026-09-29 增补）」小节。

- DeepSeek `reasoning_effort` 实际三档 low/high/max（none 关闭；minimal→low、medium/xhigh→high、ultra→max 兼容映射）；思考模式下 temperature 与 presence/frequency penalty 全部失效，top_p 仅思考模式生效（区间 0.95–1.0）。
- `reasoning_content` 回传规则：带 tools 时历史全部回传并拼入上下文；不带 tools 不回传。
- max_tokens 1–384K；默认 非思考 8K / 思考 64K / effort=max 128K。
- temperature 场景表：代码生成 0.0、数据抽取 1.0、通用对话 1.3、翻译 1.3、创意 1.5。
- Responses API `instructions` 字段 = 首条 system 消息置顶；`text.format` schema 结构化输出；JSON 输出硬约束：`response_format` + prompt 含 "json" 字样 + 样例。
- Cline 条件规则：`.clinerules` 可用 YAML front matter `paths` 限定生效范围，仅在处理匹配文件时注入——机制级减少无关规则占上下文。
- Cline 规则合并：`.clinerules/` 目录全量合并、数字前缀控序；工作区与全局冲突取工作区。
- Cline Subagents：每个子代理独立提示词 + 独立上下文窗口，探索后只回传结果——「窄任务 + 明确交付物」写法；Memory Bank 是文档方法论（一组跨会话 Markdown），非可开关功能。

> 冲突处理：`reasoning_effort` 三档与 PROMPTS.md v3 的 P7 档位表存在表述差异，以官方最新映射为准——P7 已与本指南同轮修订单行（2026-09-29，见 PROMPTS.md 头部 v3.1 增补说明）。

---

## 六、反模式清单

1. **无 Done when 的模糊任务**：执行者只能靠猜，验收无口径、必然返工。正解：按 §二 四段式写全，完成标准可第三方判定。
2. **把长期规则写进一次性 prompt**：规则随会话关闭而丢失或被反复重述、逐步漂移。正解：改写入项目级配置（AGENTS.md）。
3. **指令与经验混写一个文件**：经验性信息持续污染系统规则。正解：指令型进 AGENTS.md，学习型进 MEMORY.md。
4. **交接提示词不自包含**：二号窗口依赖一号会话记忆，冷启动即断链。正解：每份 GOAL 提示词自包含，上下文只经文件传递。
5. **子代理提示词不声明第一性原理与产出形态**：回传内容不可用，主上下文被过程灌满。正解：§四 四要点写全，只回传结论。
6. **全量灌上下文代替路由**：上下文膨胀直接推高幻觉率。正解：AGENTS.md → ROUTE.md → 按角色选读，素材 grep 定位。
7. **素材目录无目的通读**：同样是上下文膨胀来源。正解：用 ROUTE 文档地图的「何时读/何时别读」列，并守硬预算（冷启动前三跳 ≤400 行）。
8. **同一文件多写者并发**：互相覆盖、内容静默丢失。正解：遵守单一写者铁律，交接以文件为唯一介质。
9. **规范文件自身无行数预算**：规范层膨胀，反成新的上下文负担。正解：行数预算写进文件头（如本文件 ≤220 行），超了先瘦身。

---

> 维护：本文件事实来源限于 `internal/RESEARCH-V11.md` 与上列官方来源；docs.z.ai 已于 v11.1（2026-09-29）补抓完成，§5.3 待核实标记全部消除。
