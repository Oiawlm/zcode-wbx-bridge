# AGENTS — wbx 五 lane 桥常驻指令（子代理化高频调度 + codex 质量档 + doubao 完全 lane 化）

> 本仓库是 wbx 联动桥（ZCode 技能 + Node CLI）。ZCode 会话在本项目内工作时，除用户明确要求外，应遵守以下常驻规则。桥的技术细节见 [WBX.md](WBX.md)，卸载见 [UNINSTALL.md](UNINSTALL.md)。

## 可用外部算力（wbx 桥：五个外部 Agent = 你的子代理）

五个外部 Agent（Codex 质量档 + 三免费 lane + 两付费额度 lane）当作 ZCode 的**子代理**来用——免费 lane 放开调用不必为省 token 收着用，付费档按路由规则用。**自包含**（v4 公理）：全部输入（含代码上下文）可打包进提示词（材料先行：先读文件贴内容，或用 fanout `files` 字段代拼）、输出可独立校验，即可外包——**包括代码模块编写**，不限于文本杂活：

| lane | 身份 | 模型成本 | 状态（以 `wbx doctor` 实测为准） |
|---|---|---|---|
| `codex` | Codex CLI（**可选**，第五 lane·质量档） | **ChatGPT Plus 额度**（gpt-6.1-sol，≥GPT-6 护栏；耗尽自动冷却让位） | `wbx login --identity codex` 收割凭证后即可用 |
| `ai` | WorkBuddy AI 国际版 | DeepSeek V4.1 Flash **x0.00（免费）** | 登录后即可用 |
| `cn` | WorkBuddy 国内版 | DeepSeek V4.1 Flash x0.03（近免费） | 登录后即可用 |
| `cline` | Cline CLI（**可选**） | DeepSeek V4.1 Flash **免费（`cline-free/` 免费孪生，限时轮换+每日配额，thinking=xhigh）** | 未装/未登录时桥照常工作 |
| `doubao` | 豆包桌面端（**可选**，第四 lane） | **会员额度**（耗速快于普通对话；模型自管理 2.1 Pro·推理高） | 需豆包以调试口 9225 运行（launch.ps1） |

- 路由三分（v21 用户裁决）：**单发 ask 默认 codex 优先**（质量档，编码/规划类首选）；**fanout 批量默认免费
  lane**（codex 不进缺省池——Plus 额度保护，任务级 `"as":"codex"` 点名才投）；回退链 **ai → cn → cline →
  codex → doubao → 自己做**（各一次，付费两档排后；codex 冷却/未装、cline 未装、doubao 端口不在线均自动跳过）；cline 内部任何失败路径**绝不换用非 DeepSeek 模型顶替**（用户定案）。
- 成本理由：ai 免费、cn 近免费、cline 免费孪生——放开用；codex=Plus 5h 滚动窗口+周上限（耗尽冷却让位，
  余额看 ChatGPT 网页端）、doubao=会员额度，按路由规则消耗。cline 免费组**限时轮换**：清单实时查
  `wbx models --as cline --free`；超额报 `Daily free model limit reached`（带重置时间提示）。
- 调用入口：`node .zcode/skills/wb-bridge/scripts/wbx.mjs <子命令>`（使用前先 `doctor`；完整命令与旗标以 `wbx --help` 为准。doubao 调度用 `ask --as doubao`/任务绑定，`wbx doubao …` 为手工直通零落盘旁路）。
- 版本演进见 [WBX.md](WBX.md) 各版本章与 CHANGELOG.md；用法与 worker 提示词模板见
  `.zcode/skills/wb-bridge/SKILL.md` 与 `.zcode/skills/wb-bridge/PROMPTS.md`（条目数见其 §速查表；ZCode 会话自动命中该 Skill）。

## 调用准则（v5 基线反转：默认分派）

外部 Agent 成本极低（三免费 lane；codex 耗 Plus 额度、doubao 耗会员额度——用户 2026-10-03「完全lan化」与 2026-10-14「优先调用 Codex/额度耗尽让位」均明示接受）→ **默认分派**：凡自包含（输入可打包、输出可校验）即为候选，不再要求「≥2 个对象 / ≥3 个模块」才值得并行——单个调研、翻译、抽取、模块实现也直接派；分派前告知用户一句「这部分我会并行分派给外部算力」。

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
（子代理不得再开子代理派发）。这是管理层效率，不改变「五个外部 Agent 是子代理」的定位。

## 窗口工作流与上下文承接（v11 起）

- 双窗口闭环：一号规划（产出 RESEARCH-Vn + GOAL-Vn-PROMPT），二号执行落地；一号最终输出 = 供二号执行的提示词；交接以文件为唯一介质，不依赖会话记忆。
- 新窗口冷启动固定顺序：本文件（自动注入）→ `internal/ROUTE.md` → `internal/MEMORY.md` → 按角色再选读；**禁止无目的通读 `internal/` 或 `WBX.md`**（防上下文膨胀推高幻觉率）。
- 模型约定：窗口模型由用户按任务指定，未指明时默认 GLM-5.3（2026-10-13 用户定案，翻 2026-09-29「统一 GLM-5.3-Flash」裁决）；外部子代理默认 DeepSeek V4.1 Flash（wbx 桥免费 lane）。
- 用户重要需求/原则/裁决出现时，当轮窗口直接追加进 `internal/MEMORY.md`（带日期，≤3 行/条）。
- 一号/二号窗口及一切子代理的提示词中都要求以第一性原理分析问题。

## 回退规则

1. 先 `wbx doctor`：可用 lane 全红 → 提示用户 login，任务自己做；有任一 lane 可用 → 继续（cline 是可选 lane，未装/未登录只 WARN，不影响 exit 0）。
2. 连续 ≥2 个任务失败，或出现 quota / 429 / 限流 → 停止外包，如实告知用户，剩余任务自己做。
3. 外包结果**必须校验后使用**（调研类产出核对时效性与来源；代码产物审查/运行后才进交付物）。
4. worker 无联网能力：调研类任务产出的是模型已有知识，涉及时效性事实时以 ZCode 自行检索为准。

## 安全红线

- 涉密、隐私、凭证、内部代码、未公开数据**绝不外包**给外部模型（五 lane 同标准）。
- 凭证（`.wbx/sessions/`、`.wbx/product/`、`~/.wbx/cline-home/`、`~/.wbx/codex-home/`）绝不展示给用户或写进日志、文档、对话输出。
- `.wbx/` 保持 gitignore，绝不提交。
- 不写 `~/.workbuddy`、`~/.workbuddy-ai`、**不读写用户 `~/.cline`**，不改桌面版任何文件，不动系统环境变量（唯一显式授权例外：`wbx login --identity codex` 一次性只读复制 `~/.codex/auth.json` 入桥隔离目录，2026-10-14 用户裁决；除该单文件外 `~/.codex` 零读取）。
- **caps 能力矩阵授权（v19；授权=用户 2026-09-25 原话「我们要尽可能最大限度地发挥它们的性能，
  只要有需要，就可以让它们使用工具、联网」+ 2026-10-12 四项裁决：解冻 FROZEN 二.8 升级能力矩阵
  治理、沙箱写+主力集成、本轮不交付命令执行）**：caps=能力集合（net/read/write），L0≡∅（默认零回退）、
  L1≡net,read 为别名；net,read 联网+只读 opt-in（仅 ai/cn，白名单+scratch 读边界+轨迹落盘）；含 write
  本轮未交付（探针 P3 实证 headless 写无进程级边界，声明即报 caps-write-disabled，未设总闸）；L2
  未交付（`--caps L2` 报错；总闸默认 false）。caps 是任务契约：能力任务失败**绝不静默降档**，caps×lane
  不匹配明确报错；`--yolo`/`--zen` 继续禁用；模型输出不可信——集成前必经 ZCode 评审/验证，联网产出另抽查来源清单。
- 所有产物限于本项目文件夹内（例外仅二：用户级 `~/.zcode/AGENTS.md` 的 wbx 标记块，只能经
  `wbx install-user` / `uninstall-user` 管理；用户级 glm-prompt-crafter skill 部署物，只能经 `tools/install-glm-prompt-crafter.mjs` 安装/校验/移除）。
