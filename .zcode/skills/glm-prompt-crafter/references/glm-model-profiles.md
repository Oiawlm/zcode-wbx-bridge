# GLM 双模型画像（GLM-5.3 / GLM-5.3-Flash，附 FlashX）

> **一句话定位**：写 GLM 提示词前的事实底座——双模型的模态分工、体量与价格定位、强制思考与 effort 语义、官方 8 个完整提示词模板的共性结构、参数语义速查与旧口径勘误。全部事实为官方文档口径，逐条带来源、可证伪；官方没有的一律标 UNKNOWN，不编造。
> **来源**：智谱 bigmodel 官方文档站、Z.ai 官方文档站、zai-org 官方仓库（均一手）；完整台账与访问日期见 [official-sources.md](official-sources.md)。
> **日期**：2026-10-10（v1；含 2026-09-29 与 2026-10-10 两批一手抓取）

每节末尾「→ 写法含义」一行给出对写提示词的直接推论；完整工艺规则见 SKILL.md。

## 一、双模型画像速览

| 维度 | GLM-5.3 | GLM-5.3-Flash |
|---|---|---|
| 模态 | 纯文本深推理 | 原生多模态（视频/图像/文本/文件输入，输出纯文本） |
| 体量（总参/激活） | 744B / 40B | 320B / 18B（线性+稀疏注意力） |
| 价格定位 | 基准 | 约为 GLM-5.2 的十分之一 |
| Coding Plan 配额 | 基准 | 为 GLM-5.3 的 3 倍 |
| 官方提示词模板 | 0 个 | 8 个（模型页「最佳实践」章） |
| 思考 | 强制，不可关闭 | 强制，不可关闭 |

（来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md、docs.bigmodel.cn/cn/coding-plan/latest-model.md、github.com/zai-org/GLM-5、docs.z.ai/guides/vlm/glm-5.3-flash.md；2026-10-10 访问）

## 二、模态分工

- 官方口径：GLM-5.3-Flash 是 GLM-5 系首个原生多模态模型，输入 Video / Image / Text / File、输出纯文本（Z.ai 文档站将其归入 VLM 分类）；官方 Cline 指引明确 Flash 支持 Support Images，GLM-5.3 不支持。
- 官方口径：GLM-5.3 定位纯文本深推理。
（来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md、docs.bigmodel.cn/cn/coding-plan/latest-model.md；2026-10-10 访问）

→ 写法含义：给 Flash 的提示词可直接引用图片/文件类材料；给 5.3 的必须把视觉信息转成文字描述或改投 Flash。

## 三、体量、价格与配额

- 官方口径：GLM-5.3 = 744B 总参 / 40B 激活；GLM-5.3-Flash = 320B 总参 / 18B 激活，采用线性 + 稀疏注意力提效。
- 官方口径：Flash 价格约为 GLM-5.2 的十分之一，Coding Plan 配额为 GLM-5.3 的 3 倍（放量调用优先考虑 Flash 的直接依据）。
- 附注（FlashX）：另有 `glm-5.3-flashx`，速率约 200 tok/s，Coding Plan 暂不可用。
- UNKNOWN：两型的绝对单价表与速率上限数值，来源未覆盖。
（来源：github.com/zai-org/GLM-5、docs.z.ai/guides/vlm/glm-5.3-flash.md、docs.bigmodel.cn/cn/coding-plan/latest-model.md；2026-10-10 访问）

## 四、强制思考与 effort 语义

- **思考不可关闭**：官方口径两型一致——`thinking.type` 仅支持 `enabled`，设 `disabled` 直接报错；Coding Plan 里「关 thinking」实际映射到 low 档、仍轻量思考。官方通用建议「简单任务可关思考」对这两型**不适用**，轻量任务用 `reasoning_effort: "low"` 替代关思考。
- **effort 三档**：仅 `low` / `high` / `max`，默认 max；官方明言编码等复杂任务建议用 max。API 收到无效值直接报错、不静默回退；Coding Plan 旧 7 档自动映射到 3 档。
- **官方量化**：Max 档 34.5% 准确率 ≈ 7.5 万 token/任务，对比 High 档 31.4%（官方内部 Code Bench）。
（来源：docs.bigmodel.cn/cn/coding-plan/latest-model.md、docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md；2026-10-10 访问）

→ 写法含义：想更快更省就调 effort 档位，不要在提示词里写「不要思考」——这两型关不掉；请求级与部署级的思考控制是两套开关，别混用。

## 五、官方 8 个完整提示词模板的共性

官方 8 个完整提示词模板全部位于 GLM-5.3-Flash 文档页「最佳实践」章，GLM-5.3 页零模板（来源：docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md；2026-10-10 访问）。

**四步共性结构**：

1. 交付物规格前置：开头交代受众 / 页数 / 结构 / 风格；
2. 要求模型自渲染、自观察产物；
3. 与参考对比后迭代；
4. 标注未验证项与残留差异。

**三条可通用化硬约束**（模板原文）：

- 「不得捏造任何业务数据，所有引用信息标明来源」；
- 「区分公司披露 / 分析假设 / 自己结论三类信息」；
- 「输出关键风险与未验证信息清单」。

**迭代与形态**：Blender 模板规定 build → render → inspect → refine **至少 4 轮**；Computer Use 模板即以 `/goal` 开头的完整提示词。Flash 页另明确：交付物规格、按里程碑测试、agentic self-verification（自渲染自观察迭代）、标注未验证项与遗留风险（来源：docs.z.ai/guides/vlm/glm-5.3-flash.md，2026-09-29 访问）。其余模板各自的轮数规定来源未覆盖 → UNKNOWN。

→ 写法含义：产出型任务（文档/代码/视觉）直接套四步共性；「自观察产物再迭代」对各类交付物通用；产出物要求列「未验证项与风险清单」。

## 六、参数语义速查

- **reasoning_content 回传铁则**：多轮 + 工具调用场景，必须把思考块完整、原样、按原序回传（连续块与原序列完全一致），乱序或编辑会导致性能与缓存命中双降。与「子代理只回传结论」不冲突：后者是子代理对主代理的汇报边界，前者是消息历史对模型的上下文管理。
（来源：docs.z.ai/guides/capabilities/thinking-mode.md、github.com/zai-org/GLM-5；2026-10-10 访问）
- **Preserved Thinking 两层默认相反**：API 层——Coding Plan 默认开启，标准 API 需 `clear_thinking: false` 显式保留；chat template 层（本地部署）——不传默认保留，聊天场景官方反而建议显式传 true。两层须分开写，不可混为一谈。
（来源：docs.z.ai/guides/capabilities/thinking-mode.md、github.com/zai-org/GLM-5；2026-10-10 访问）
- **采样**：默认 temperature 1.0 / top_p 0.95，官方明示二者只调一个；确定性输出用 `do_sample=false`（贪心）。
（来源：docs.z.ai/guides/overview/migrate-to-glm-new.md、docs.bigmodel.cn/cn/coding-plan/latest-model.md；2026-10-10 访问）
- **输出与上下文**：两型均 1M 上下文 / 128K 最大输出；max_tokens 建议 ≥1024（5.3 系默认 65536、上限 131072）；1M 上下文在 Claude Code 需模型名后缀 `[1m]` + 环境变量 `CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000`。
（来源：docs.z.ai/guides/llm/glm-5.3.md、docs.z.ai/guides/overview/concept-param.md（2026-09-29 访问）；docs.bigmodel.cn/cn/coding-plan/latest-model.md（2026-10-10 访问））

## 七、官方 Agent / 编码提示词建议（5.3 模型页）

- 任务按「真实专家工作单元」写：多步依赖、隐藏状态、端到端 ownership；**不做步进式监督**（不要把任务拆成一步步等待确认的微指令）。
- 系统提示词给角色专长 + 边界清晰的具体用户任务。
（来源：docs.z.ai/guides/llm/glm-5.3.md、docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md；2026-09-29 / 2026-10-10 访问）

→ 写法含义：给执行窗口的任务提示词写「目标+边界+完成标准」，不写逐操作剧本——与目标模式（/goal）的校验器机制天然契合（见 [goal-mode-writing.md](goal-mode-writing.md)）。

## 八、旧口径勘误表

早期沉淀口径（2026-09-29 版）与官方文档冲突处，以下表为准，防止回退到旧错误表述：

| 旧口径 | 官方口径（依据） |
|---|---|
| top_p 建议「0.8–0.95」 | 默认 0.95，与 temperature 二选一调；旧口径无出处，疑为 4.x 旧建议（docs.z.ai/guides/overview/migrate-to-glm-new.md 等；2026-10-10） |
| 「关 thinking」= 零思考 | Coding Plan 映射 low 档，非零思考；`thinking.type: disabled` 直接报错（docs.bigmodel.cn/cn/coding-plan/latest-model.md 等；2026-10-10） |
| clear_thinking 单一默认 | 两层默认相反：API 层 vs chat template 层须分开写（docs.z.ai/guides/capabilities/thinking-mode.md、github.com/zai-org/GLM-5；2026-10-10） |
| effort 档位表述存疑 | low/high/max 三档确认无误；无效值报错不静默回退；旧 7 档自动映射 3 档（docs.bigmodel.cn/cn/coding-plan/latest-model.md；2026-10-10） |

## 九、官方未提供事项（截至 2026-10-10 未找到，如实记录）

- GLM-5.3 专属的通用 prompt-engineering 指南页：两家文档站 llms.txt 全索引均无（docs.z.ai 的 `/guides/prompt-engineering/overview` 实测 404，勿再尝试）。
- 官方「Flash vs 满血（GLM-5.3）差异化写法」的直接论述：未找到，只能从两页内容间接推出。
- GLM-5.3 提示词反模式专条：未找到。
- zai-org/GLM-skills 官方技能库（21 技能）中的 GLM-5.3 提示词内容：未找到。

> 后续如官方补齐，按 official-sources.md §五维护流程更新本节并标注新访问日期。
