# 官方来源台账（official-sources）

> **一句话定位**：本 skill 全部事实的来源台账——三路调研（R1 模型 / R2 ZCode 机制 / R3 社区先例，2026-10-10）与早期官方工艺沉淀（2026-09-29）。核对某条口径的出处、或更新本库时读本文。
> **标注约定**：一手 = 官方域名原文；二手 = 社区 / 聚合 / 转述。URL 均为访问当日可达版本；「访问日期」随条目标注。
> **日期**：2026-10-10（v1）

## 一、模型事实来源（R1，一手，2026-10-10）→ 事实正文见 [glm-model-profiles.md](glm-model-profiles.md)

| 来源 | 支撑内容 |
|---|---|
| docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md | Flash 模态与 VLM 分类、官方 8 模板与共性结构、自观察迭代 |
| docs.bigmodel.cn/cn/coding-plan/latest-model.md | Coding Plan 配额、「关 thinking」→low 映射、effort 量化数据、旧 7 档映射、1M 上下文开启 |
| docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md | effort 三档默认与编码建议、Agent/编码提示词建议 |
| github.com/zai-org/GLM-5 | 双型体量/激活参数、chat template 层 thinking 默认 |
| docs.z.ai/guides/vlm/glm-5.3-flash.md | Flash 体量/参数推荐 |
| docs.z.ai/guides/capabilities/thinking-mode.md | reasoning_content 回传铁则、Preserved Thinking API 层默认 |
| docs.z.ai/guides/overview/migrate-to-glm-new.md | temperature/top_p 默认与「只调一个」 |

早期批补充（一手，2026-09-29，支撑 profiles §四/§五/§六/§七）：docs.z.ai/guides/llm/glm-5.3.md（强制思考、预算参数、Agent 提示词建议）、docs.z.ai/guides/vlm/glm-5.3-flash.md（Flash 页增量：里程碑测试、自观察迭代）、docs.z.ai/guides/capabilities/thinking.md（部署层思考机制家族，评审裁决未入正文、留档备查）、docs.z.ai/guides/overview/concept-param.md（max_tokens 默认与上限）。本批事实的登记见 RESEARCH-V17 §五（迁移批次补遗）。

**勘误注记**：2026-09-29 版沉淀中的旧口径（top_p 0.8–0.95 / 关 thinking=零思考 / clear_thinking 单层 / effort 档位存疑）已按 2026-10-10 一手复核勘误，对照表见 glm-model-profiles.md §八。

## 二、ZCode 目标模式与 skill 机制来源（R2，一手，2026-10-10）→ 事实正文见 [goal-mode-writing.md](goal-mode-writing.md) 与 SKILL.md

- `zcode.z.ai/cn/docs/goal` —— /goal 命令族、单会话单目标、会话持久化、校验器实据清单、官方写作建议（goal-mode-writing.md 全部机制事实的唯一权威来源）。
- `zcode.z.ai/cn/docs/skill` —— 包结构（SKILL.md + references/）、三层渐进披露（元数据常驻 / 正文触发加载 <500 行 / references 按需）、frontmatter 键全集与限制（name=目录名、description ≤1024 超限弃用、每轮摘要截断 ~250 字符）、触发可靠性（无关键词匹配器、措辞前载、`$技能名` 强制兜底）、用户级 `~/.zcode/skills/` 全项目可见、发现顺序与同名遮蔽、Skill vs Command 边界。
- 本地官方插件镜像（权威等同线上，无独立线上 URL）：skill-creator 0.1.0、zcode-guide 0.3.0 diagnosing-skills——skill 规范交叉印证。

## 三、开源先例（R3，二手社区，2026-10-10）→ 支撑 SKILL.md 形态选型与反模式

- anthropics/skills（含 skill-creator 元技能）、「教 agent 写知识」做成 skill 的官方先例。
- obra/superpowers（方法论技能包，writing-skills 元技能）。
- NeoLabHQ/context-engineering-kit 的 prompt-engineering skill（把提示词工程知识打包成按需加载 skill，与本库同型）。
- VoltAgent/awesome-agent-skills（description 成文质量标准：第三人称、what+when、含用户自然会说出的关键词、不硬编码绝对路径）。
- OpenAI GPT-5 prompting guide（骨架=按工作流分节 + 完整示例 + 反例对照）。
- Reddit 多帖共识（失败模式实证）：常驻注入约百行后规则降格为建议、约四成死重、深层约束被安静忽略；description 泛化导致永不触发（有改写后激活率 ×20 实测帖）；skill 会腐烂需定期清理。

## 四、提示词工艺官方沉淀（早期批，2026-09-29）

### 4.1 智谱「Coding Agent 最佳实践」（一手）

URL：https://docs.bigmodel.cn/cn/coding-plan/learning-resources/best-practice.md　访问日期：2026-09-29

- 「上下文比提示技巧更重要」：一次性问答式使用无法发挥 Agent 能力。
- 任务描述四要素：目标 / 上下文 / 约束 / 完成标准（Done when）——SKILL.md §三 的官方出处。
- 临时指令写在 prompt 中，长期规则写入项目级配置文件（目录结构、构建命令、测试流程、代码规范、PR 流程）。
- Plan 先于实现：复杂需求直接写代码易反复，应转为按计划逐步完成。
- Skill = 结构化任务模板：某段提示词被反复使用即应沉淀为 Skill；Automation 是 Skill 的下一层。
- 会话管理 = 上下文治理：每任务独立线程、定期压缩/摘要历史、多 Agent 协作（子代理探索/测试/排查，主代理协调）。
- Z.ai devpack 版同页核对（https://docs.z.ai/devpack/resources/best-practice.md，2026-09-29 访问）：与上五点逐字同源，增量四节——执行环境决定 Agent 能力边界、参与全开发环（实现/测试/lint/评审）、MCP 扩展外部上下文、稳定流程升级为 Automation。

### 4.2 智谱「记忆机制」（一手）

URL：https://docs.bigmodel.cn/cn/coding-plan/learning-resources/memory-mechanism.md　访问日期：2026-09-29

- 五类记忆：Session / Project / Semantic / Episodic / Procedural；使用范式固定：检索 → 构建上下文 → 任务后更新。
- 指令型与学习型记忆必须分开，否则「经验性信息不断污染系统规则」。落地口径：规则本体在项目级 AGENTS.md（指令型），MEMORY 类文件只记「用户说过什么/为什么」（学习型）。
- 长期指令必须写 .md：上下文压缩后记忆文件重新从磁盘加载，只存在于对话中的指令会丢。
- 分层作用域：组织级 → 项目级（版本控制共享）→ 用户级（低于项目规则）→ 本地级（不进 Git）→ 角色/subagent 级（各代理独立记忆目录，主记忆文件前 200 行）。
- 防膨胀四法：能按路径/条件加载的规则不全量加载；主记忆文件 ≤200 行、专项规则按主题拆分；规则具体可验证；过大即拆分或移入 rules/ 目录。

### 4.3 ZCode 配置规范（一手，本机官方插件镜像）

来源：zcode-guide 插件 `zcode-configuration-guide` skill（本机官方插件缓存镜像，权威等同线上；无独立线上 URL）　访问日期：2026-09-29

- AGENTS.md 分层与合并：用户级 `~/.zcode/AGENTS.md` 先注入，工作区 `<repo>/AGENTS.md` 后注入（可收窄/覆盖）；工作区文件自 cwd 向上搜索到项目根。
- Skill/Command 发现顺序：显式配置根 → 用户 `.zcode` → 用户 `.agents` → 工作区 `.zcode`（逐级向上）→ 工作区 `.agents` → 插件；同级 `.zcode` 先于 `.agents`；**同名第一个赢**（用户级遮蔽工作区同名）。
- AGENTS.md 是「注入模型上下文的宽行为规则」，不是 skill/command。
- Hooks 七事件（SessionStart 含 startup/resume/clear/compact）。

### 4.4 DeepSeek / Cline 增量（二手，外部 worker 侧事实留档）

来源：2026-09-29 对 api-docs.deepseek.com 与 docs.cline.bot 的联网检索汇总（外部 worker 侧二手转述，检索摘要级、未经原文逐条复核）

- DeepSeek `reasoning_effort` 实际三档 low/high/max（none 关闭；minimal→low、medium/xhigh→high、ultra→max 兼容映射）；思考模式下 temperature 与 presence/frequency penalty 全部失效，top_p 仅思考模式生效（区间 0.95–1.0）。
- `reasoning_content` 回传规则：带 tools 时历史全部回传并拼入上下文；不带 tools 不回传。
- max_tokens 1–384K；默认：非思考 8K / 思考 64K / effort=max 128K。
- temperature 场景表：代码生成 0.0、数据抽取 1.0、通用对话 1.3、翻译 1.3、创意 1.5。
- Responses API `instructions` 字段 = 首条 system 消息置顶；`text.format` schema 结构化输出；JSON 输出硬约束：`response_format` + prompt 含 "json" 字样 + 样例。
- Cline 条件规则：`.clinerules` 可用 YAML front matter `paths` 限定生效范围，仅在处理匹配文件时注入。
- Cline 规则合并：`.clinerules/` 目录全量合并、数字前缀控序；工作区与全局冲突取工作区。
- Cline Subagents：每个子代理独立提示词 + 独立上下文窗口，探索后只回传结果（「窄任务 + 明确交付物」写法）；Memory Bank 是文档方法论（一组跨会话 Markdown），非可开关功能。

> 本节为外部 worker（DeepSeek/Cline）的参数与规则事实留档；写 worker 派发提示词的模板与模型画像不在本库范围（见 SKILL.md §一受众矩阵第三行）。

## 五、维护

- 更新本库：先改本台账（新来源 + 访问日期 + 支撑内容），再改正文；与旧口径冲突时走「旧口径 → 官方口径」勘误表（glm-model-profiles.md §八），不静默改写。
- 已探明不可达：docs.z.ai 的 `/guides/prompt-engineering/overview` 实测 404（2026-09-29），勿再尝试；两家文档站 llms.txt 全索引均无 GLM 专属 prompt-engineering 指南页（2026-10-10）。
