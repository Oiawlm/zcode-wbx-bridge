# AGENTS — wbx 三 lane 桥常驻指令（v6.5：子代理化高频调度 + doubao 无痕直通）

> 本仓库是 wbx 联动桥（ZCode 技能 + Node CLI）。ZCode 会话在本项目内工作时，除用户明确要求外，应遵守以下常驻规则。桥的技术细节见 [WBX.md](WBX.md)，卸载见 [UNINSTALL.md](UNINSTALL.md)。

## 可用外部算力（wbx 桥：三个外部 Agent = 你的子代理）

三个外部 Agent 当作 ZCode 的**子代理**来用——几乎免费，**默认分派、放开调用**，不必为省 token 收着用。**自包含**（v4 公理）：全部输入（含代码上下文）可打包进提示词（材料先行：先读文件贴内容，或用 fanout `files` 字段代拼）、输出可独立校验，即可外包——**包括代码模块编写**，不限于文本杂活：

| lane | 身份 | 模型成本 | 状态（以 `wbx doctor` 实测为准） |
|---|---|---|---|
| `ai` | WorkBuddy AI 国际版 | DeepSeek V4.1 Flash **x0.00（免费）** | 登录后即可用 |
| `cn` | WorkBuddy 国内版 | DeepSeek V4.1 Flash x0.03（近免费） | 登录后即可用 |
| `cline` | Cline CLI（**可选**） | DeepSeek V4.1 Flash **免费（`cline-free/` 免费孪生，限时轮换+每日配额，thinking=xhigh）** | 未装/未登录时桥照常工作 |

- 默认路由：`ai` 已登录则优先（免费），否则 `cn`；回退链 **ai → cn → cline → 自己做**（各一次；
  cline 未装/无凭证直接跳过；任一 lane 失败/限流自动改投下一 lane）；cline 内部任何失败路径**绝不换用非 DeepSeek 模型顶替**（用户定案）——回退只投 ai/cn。
- 成本理由：ai 免费、cn 近免费、cline 免费孪生、ZCode 自身耗订阅额度——所以放开用。cline 免费组
  **限时轮换**：清单实时查 `wbx models --as cline --free`，doctor 校验默认孪生在组内；超额报
  `Daily free model limit reached`（带重置时间提示）。
- 调用入口：`node .zcode/skills/wb-bridge/scripts/wbx.mjs {doctor|login|ask|fanout|models|config|history|ui|self-install|self-uninstall|export-bundle|doubao}`（使用前先 `doctor`；doubao=豆包桌面桥直通，可选工具非 lane）。
- 版本演进史见 [WBX.md](WBX.md) 各版本章与 CHANGELOG.md。
- 用法与 worker 提示词模板见 `.zcode/skills/wb-bridge/SKILL.md` 与
  `.zcode/skills/wb-bridge/PROMPTS.md`（v3 知识库：原则 14 条 + 模板 T1–T10 + 经验条目
  E-001…E-013 + 决策速查表含 caps 列；ZCode 会话会自动命中该 Skill）。

## 调用准则（v5 基线反转：默认分派）

三个外部 Agent 几乎免费 → **默认分派**：凡自包含（输入可打包、输出可校验）即为候选，不再要求「≥2 个对象 / ≥3 个模块」才值得并行——单个调研、翻译、抽取、模块实现也直接派；分派前告知用户一句「这部分我会并行分派给外部免费算力」。

- **调研**：单个或多个对象均可，每对象一个 worker 任务，要求带来源清单。
- **代码实现**：接口清晰、可独立验证的模块，ZCode 定义接口契约、材料先行分派；关键模块在免费
  lane 上并行 2 份（T8 best-of-N），ZCode 评审择优集成。
- **执行**：可拆成接口清晰、可独立验证的部分，无上下文依赖的即分派。
- **批量文本**：翻译、摘要、改写、变体生成、结构化抽取、分类打标，单个也派。
- **评审常规化**：关键代码模块/文案集成前默认过一道评审批判（T7）——多一次免费调用换质量下限。
- **消耗豁免**：不为省 token 压低 effort 档或裁剪材料；材料裁剪**只为信噪比**（质量）；effort
  默认档上调（简单 low→medium、代码 medium→high；实测延迟明显变长再回调）。

不满足「自包含、可校验、有回退」三条件、需探索式多轮交互（开放式架构探索、边跑边看的多轮调试）的任务一律留在 ZCode 自己做；「放开」只放开频率与消耗，**不放开任务类型边界**。

**编排侧子代理消费**：fanout ≥6 个任务或结果很长时，由 ZCode 自己的子代理管理整批（构造
tasks.json → 跑 fanout → 逐份校验 → 只回传摘要 + 关键引用），主会话不吞全部结果文本；层级 ≤2
（子代理不得再开子代理派发）。这是管理层效率，不改变「三个外部 Agent 是子代理」的定位。

## 窗口工作流与上下文承接（v11 起）

- 双窗口闭环：一号规划（产出 RESEARCH-Vn + GOAL-Vn-PROMPT），二号执行落地；一号最终输出 = 供二号执行的提示词；交接以文件为唯一介质，不依赖会话记忆。
- 新窗口冷启动固定顺序：本文件（自动注入）→ `internal/ROUTE.md` → `internal/MEMORY.md` → 按角色再选读；**禁止无目的通读 `internal/` 或 `WBX.md`**（防上下文膨胀推高幻觉率）。
- 模型约定：一号/二号窗口统一 GLM-5.3-Flash（2026-09-29 用户定案）；外部子代理默认 DeepSeek V4.1 Flash（wbx 桥三 lane）。
- 用户重要需求/原则/裁决出现时，当轮窗口直接追加进 `internal/MEMORY.md`（带日期，≤3 行/条）。
- 一号/二号窗口及一切子代理的提示词中都要求以第一性原理分析问题。

## 回退规则

1. 先 `wbx doctor`：可用 lane 全红 → 提示用户 login，任务自己做；有任一 lane 可用 → 继续（cline 是可选 lane，未装/未登录只 WARN，不影响 exit 0）。
2. 连续 ≥2 个任务失败，或出现 quota / 429 / 限流 → 停止外包，如实告知用户，剩余任务自己做。
3. 外包结果**必须校验后使用**（调研类产出核对时效性与来源；代码产物审查/运行后才进交付物）。
4. worker 无联网能力：调研类任务产出的是模型已有知识，涉及时效性事实时以 ZCode 自行检索为准。

## 安全红线

- 涉密、隐私、凭证、内部代码、未公开数据**绝不外包**给外部模型（三 lane 同标准）。
- 凭证（`.wbx/sessions/`、`.wbx/product/`、`~/.wbx/cline-home/`）绝不展示给用户或写进日志、文档、对话输出。
- `.wbx/` 保持 gitignore，绝不提交。
- 不写 `~/.workbuddy`、`~/.workbuddy-ai`、**不读写用户 `~/.cline`**，不改桌面版任何文件，不动系统环境变量。
- **caps 分级授权（v6，授权来源=用户 2026-09-25 原话「我们要尽可能最大限度地发挥它们的性能，
  只要有需要，就可以让它们使用工具、联网」与拍板「三级分级」；L2 缓期为当日实测后用户裁决）**：
  L0 纯文本默认零回退；L1 只读+联网 opt-in（仅 ai/cn，白名单+scratch 读边界+轨迹落盘）；
  L2 本版未交付（`--caps L2` 声明即报错；总闸 `caps-l2-enabled` 默认 false，日常开闸须用户显式授权）。
  caps 是任务契约：L1/L2 失败**绝不静默降档**，caps×lane 不匹配明确报错；`--yolo`/`--zen` 继续禁用
  （既有定案）。模型输出不可信——best-of-N 择优与集成必须经 ZCode 评审/运行验证；L1 联网产出
  另抽查来源清单（URL+访问时间）。
- 所有产物限于本项目文件夹内（用户级 `~/.zcode/AGENTS.md` 的 wbx 标记块是唯一例外，
  且只能通过 `wbx install-user` / `uninstall-user` 管理）。
