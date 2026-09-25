# AGENTS — wbx 三 lane 桥常驻指令（v5：子代理化高频调度）

> 本仓库是 wbx 联动桥（ZCode 技能 + Node CLI）。ZCode 会话在本项目内工作时，除用户明确要求外，
> 应遵守以下常驻规则。桥的技术细节见 [WBX.md](WBX.md)，卸载见 [UNINSTALL.md](UNINSTALL.md)。

## 可用外部算力（wbx 桥：三个外部 Agent = 你的子代理）

三个外部 Agent 当作 ZCode 的**子代理**来用——几乎免费，**默认分派、放开调用**，不必为省
token 收着用。**自包含**（v4 公理）：任务的全部输入（含代码上下文）可由 ZCode 打包进提示词
（材料先行：ZCode 先读文件、把内容贴进提示词，或用 fanout 的 `files` 字段让桥代拼）、
输出可独立校验，即可外包——**包括代码模块编写**，不限于文本杂活：

| lane | 身份 | 模型成本 | 状态（以 `wbx doctor` 实测为准） |
|---|---|---|---|
| `ai` | WorkBuddy AI 国际版 | DeepSeek V4.1 Flash **x0.00（免费）** | 登录后即可用 |
| `cn` | WorkBuddy 国内版 | DeepSeek V4.1 Flash x0.03（近免费） | 登录后即可用 |
| `cline` | Cline CLI（**可选**） | DeepSeek V4.1 Flash **免费（`cline-free/` 免费孪生，限时轮换+每日配额，thinking=xhigh）** | 未装/未登录时桥照常工作 |

- 默认路由：`ai` 已登录则优先（免费），否则 `cn`；回退链 **ai → cn → cline → 自己做**
  （各一次；cline 未装/无凭证直接跳过；任一 lane 失败/限流自动改投下一 lane）。
  cline 内部任何失败路径**绝不换用非 DeepSeek 模型顶替**（用户定案）——回退只投 ai/cn。
- 成本理由：同等任务 ai 免费、cn 近免费、cline 免费孪生、ZCode 自身消耗订阅额度——所以放开用。
  注意：cline 免费组**限时轮换**——doctor 会校验默认孪生是否仍在组内；清单实时查
  `wbx models --as cline --free`；超额报 `Daily free model limit reached`（带重置时间提示）。
- 调用入口：`node .zcode/skills/wb-bridge/scripts/wbx.mjs {doctor|login|ask|fanout|models|config|history|ui|self-install|export-bundle}`。
- v4 能力保留：fanout 任务级 `"files": ["路径"]` 材料拼接；>12k 字符提示词自动走 stdin 通道；
  ask/fanout 全部落盘为可回放的 job（`history` 回放）。
- v5 新增：cline lane（`login --identity cline` 浏览器 OAuth 设备授权；状态只在 `~/.wbx/cline-home/`
  隔离目录——桥以 HOME/USERPROFILE 覆盖实现隔离，绝不读写用户 `~/.cline`）；`cline-*` 配置键
  （model/thinking=xhigh/compaction=off/parallel=1）。
- v5.1 新增：cline 默认模型切为免费孪生 `cline-free/deepseek-v4.1-flash`（计价 $0 实测）；
  `models --as cline --free` 免费清单（recommended-models 端点实时，失败降级缓存）；doctor 免费孪生
  存在性校验；`free-limit`/`free-promotion-ended`/`model-not-found` 错误分类与提示；UI 免费模型
  下拉选择器；存量 config 一次性迁移（仅旧值恰为计费孪生时改写）。隐私：免费用量可能被 Cline
  用于改进模型（官方披露）。
- v5.2 新增：控制台常开可用——`ui --detach` 幂等后台守护（浏览器开 http://127.0.0.1:7788 即用）、
  `--stop`/`--status`、`--install-autostart`/`--remove-autostart` ZCode 会话自启钩子（对
  `~/.zcode/cli/config.json` 只做读-改-写合并）；UI 全面中文化 + 通道品牌命名（WorkBuddy AI（国际版）/
  WorkBuddy（国内版）/Cline CLI；展示层映射，数据层零改动）。
- v5.3 新增：控制台界面产品化（只动展示层，行为零变化）——状态页首屏健康总览条（3 秒判总体
  状态）+ 通道卡扫读/详情/排障三层 + 停用开关在通道卡 + 体检空态与分组结果；视觉 token 化；
  全站 toast 替代弹窗。守护/安全面/API/config 键/术语表全部不动。
- v6.0.0 新增：**worker 能力分级 caps（L0/L1/L2）**——L0 纯文本默认零回退（出厂
  `default-caps=L0`）；L1 只读+联网 opt-in（`--caps L1` / 任务 `"caps":"L1"`，仅 ai/cn：
  WebSearch/WebFetch/Read/Glob/Grep 白名单 + 空 scratch 读边界 + 工具轨迹落盘 + transcript
  留档，缺省超时上浮 600s，模板 T4-L1）；L2 受控全能**本版未交付**（cline 3.0.65 无命令级
  deny，Phase 0 实测 deny 三组全失效——`--caps L2` 声明即报错；总闸 `caps-l2-enabled`
  默认 false）。历史页详情行内化（点击行下方展开）+ 调用页 caps 选择器 + caps 徽标。
  PROMPTS.md 升 v3（原则 2「能力边界声明按档位」+ P13 注入防御 + P14 来源清单 + T4-L1 +
  T10（L2 模板先行入库）+ 决策速查表 caps 列）。
- 使用前先 `doctor`；用法与 worker 提示词模板见 `.zcode/skills/wb-bridge/SKILL.md` 与
  `.zcode/skills/wb-bridge/PROMPTS.md`（v3 知识库：原则 14 条 + 模板 T1–T10 + 经验条目
  E-001…E-012 + 决策速查表含 caps 列；ZCode 会话会自动命中该 Skill）。

## 调用准则（v5 基线反转：默认分派）

三个外部 Agent 几乎免费 → **默认分派**：凡自包含（输入可打包、输出可校验）即为候选，
**不再要求「≥2 个对象 / ≥3 个模块」才值得并行**——单个调研、翻译、抽取、模块实现也直接派。
分派前告知用户一句「这部分我会并行分派给外部免费算力」。

- **调研**：单个或多个对象均可，每对象一个 worker 任务，要求带来源清单。
- **代码实现**：接口清晰、可独立验证的模块，ZCode 定义接口契约、材料先行分派；
  关键模块在免费 lane 上并行 2 份（T8 best-of-N），ZCode 评审择优集成。
- **执行**：可拆成接口清晰、可独立验证的部分，无上下文依赖的即分派。
- **批量文本**：翻译、摘要、改写、变体生成、结构化抽取、分类打标，单个也派。
- **评审常规化**：关键代码模块/文案集成前默认过一道评审批判（T7）——多一次免费调用换质量下限。
- **消耗豁免**：不为省 token 压低 effort 档或裁剪材料；材料裁剪**只为信噪比**（质量）；
  effort 默认档上调（简单 low→medium、代码 medium→high；实测延迟明显变长再回调）。

不满足「自包含、可校验、有回退」三条件的任务，以及需要探索式多轮交互的任务（开放式
架构探索、边跑边看的多轮调试），一律留在 ZCode 自己做。「放开」只放开频率与消耗，
**不放开任务类型边界**。

**编排侧子代理消费**：fanout 任务 ≥6 个或结果很长时，ZCode 用自己的子代理管理整批
（构造 tasks.json → 跑 fanout → 逐份校验 → 只回传摘要 + 关键引用），主会话不吞全部结果文本；
层级 ≤2（子代理不得再开子代理派发）。这是管理层效率，不改变「三个外部 Agent 是子代理」的定位。

## 回退规则

1. 先 `wbx doctor`：可用 lane 全红 → 提示用户 login，任务自己做；有任一 lane 可用 → 继续
   （cline 是可选 lane，未装/未登录只 WARN，不影响 exit 0）。
2. 连续 ≥2 个任务失败，或出现 quota / 429 / 限流 → 停止外包，如实告知用户，剩余任务自己做。
3. 外包结果**必须校验后使用**（免费算力质量方差大；调研类产出需核对时效性与来源；
   代码产物必须审查/运行后才进交付物）。
4. worker 无联网能力：调研类任务产出的是模型已有知识，涉及时效性事实时以 ZCode 自行检索为准。

## 安全红线

- 涉密、隐私、凭证、内部代码、未公开数据**绝不外包**给外部模型（三 lane 同标准）。
- 凭证（`.wbx/sessions/`、`.wbx/product/`、`~/.wbx/cline-home/`）绝不展示给用户或写进日志、文档、对话输出。
- `.wbx/` 保持 gitignore，绝不提交。
- 不写 `~/.workbuddy`、`~/.workbuddy-ai`、**不读写用户 `~/.cline`**，不改桌面版任何文件，不动系统环境变量。
- **caps 分级授权（v6，授权来源=用户 2026-09-25 原话「我们要尽可能最大限度地发挥它们的性能，
  只要有需要，就可以让它们使用工具、联网」与拍板「三级分级」；L2 缓期为当日实测后用户裁决）**：
  L0 纯文本默认零回退；L1 只读+联网 opt-in（仅 ai/cn，白名单+scratch 读边界+轨迹落盘）；
  L2 本版未交付（仅 cline 且上游无命令级 deny，`--caps L2` 声明即报错；总闸 `caps-l2-enabled`
  默认 false，日常开闸须用户显式授权）。caps 是任务契约：L1/L2 失败**绝不静默降档**，
  caps×lane 不匹配明确报错；`--yolo`/`--zen` 继续禁用（既有定案）。模型输出不可信——
  best-of-N 择优与集成必须经 ZCode 评审/运行验证；L1 联网产出另抽查来源清单（URL+访问时间）。
- 所有产物限于本项目文件夹内（用户级 `~/.zcode/AGENTS.md` 的 wbx 标记块是唯一例外，
  且只能通过 `wbx install-user` / `uninstall-user` 管理）。
