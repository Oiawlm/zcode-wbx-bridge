---
name: wb-bridge
description: >-
  通过 wbx 桥把自包含子任务并行分派给外部免费算力（三 lane：WorkBuddy 双 lane 的 DeepSeek V4.1 Flash
  ——国际版免费、国内版近免费；可选 Cline CLI lane——免费额度轮换模型组）执行，三个外部 Agent 当作
  ZCode 的子代理高频、放量调用（几乎免费，默认分派不必省着用）。
  当出现以下任一情形时主动使用：需要调研或对比对象（竞品、软件、开源库、技术选型，单个或多个均可）、
  收集参考素材或做法、批量生成/处理文本（翻译、摘要、改写、变体、结构化抽取、分类打标）、
  编写或并行编写代码模块/纯函数/组件/测试用例（接口清晰、材料可贴进提示词、输出可校验的自包含编码任务）、
  对产物做评审批判或双份择优（best-of-N）、对失败产物做定向修复迭代，
  或用户明确提到「并行处理、批量任务、外包出去、用免费额度、用 DeepSeek、WorkBuddy、Cline 跑」，或使用 /wbx 命令。
  前提：子任务自包含（输入可由编排器打包进提示词、输出可独立校验）。v5 基线：单个自包含任务也默认分派。
---

# wb-bridge：把子任务并行分派给外部算力（三 lane 子代理 · 默认分派）

通过驱动 WorkBuddy 桌面版自带的 CodeBuddy CLI（headless 无工具模式）与 Cline CLI（`--json`
纯文本端点），把适合的子任务（含**代码模块编写**这类自包含编码任务）并行分派给免费算力。
三个外部 Agent = ZCode 的**子代理**，几乎免费 → **默认分派、放开用**：

| lane | 身份 | 成本 | 说明 |
|---|---|---|---|
| `ai` | WorkBuddy AI 国际版 | **x0.00 免费** | 默认优先（成本理由，见 WBX.md） |
| `cn` | WorkBuddy 国内版 | x0.03 近免费 | 兜底（微信扫码登录路径稳定） |
| `cline` | Cline CLI（可选） | DeepSeek V4.1 Flash 按量微付费（实测单次 $0.0003-0.004） | thinking=xhigh/compaction=off；未装/未登录自动跳过，不影响其余功能 |

路由：由 `wbx config` 的 default-lane 决定（`auto`=ai 已登录则 ai，否则 cn；cline 在 auto 下
永远排最后）；回退链 **ai → cn → cline → 自己做**（各一次，不无限重试）；`disabled-lanes`
可硬禁用任一 lane。所有调用走 `.wbx/`（装过 `wbx self-install` 后统一走 `~/.wbx/`）隔离运行时，
不影响桌面版 WorkBuddy，**绝不读写用户 `~/.cline`**（cline lane 以 HOME/USERPROFILE 覆盖把
状态隔离在 `<运行时根>/cline-home/`）。

## 第一步：永远先自检

```bash
node .zcode/skills/wb-bridge/scripts/wbx.mjs doctor
```

- 有任一 lane 全绿 → 继续（未登录的 lane 显示 [SKIP]；cline 未装/未登录只 WARN，均不影响）。
- ai/cn 都红 → **停止分派**，告诉用户：「请运行 `node .zcode/skills/wb-bridge/scripts/wbx.mjs login`（国内版微信扫码）或 `login --identity ai`（国际版，输出里有 state 修补锦囊），凭证约 55 天有效」，期间这些任务由你自己完成。
- 「cli」红（App 升级挪了路径）→ 告知用户，改由你自行完成任务（重跑 doctor 自动扫描，也可 `wbx config set cli-path "<路径>"`）。
- 想用 cline lane 而未登录 → 提示用户 `wbx login --identity cline`（浏览器 OAuth 设备授权）。

## 任务分派准则（v5 基线反转：先判断，再动手）

**✅ 适合分派**（判定公理 = **自包含任务**；v5 起不设数量门槛，**单个也默认派**）：
- 输入可由你打包进提示词（材料先行：你先读文件贴进材料区，或用 fanout 任务级
  `"files": ["路径"]` 让桥代拼）；输出可独立校验（文本/JSON 可核对，代码可编译/运行/审查）
- 典型：**代码模块编写**（ZCode 定接口契约 → 材料先行分派 → 审查/运行后集成）、
  单对象或多对象调研（每对象一个 worker，要求带来源清单）、中英互译、长文摘要、改写润色、
  文案变体批量生成、资料整理草稿、结构化抽取（日志→JSON）、分类打标、
  **评审批判（T7）**、**best-of-N 双份择优（T8）**、**失败产物定向修复（T9）**

**行为规则**：
1. **默认分派**：自包含即候选，不因「只有一个」而留在本地。
2. **消耗豁免**：不为省 token 压低 effort 档或裁剪材料；材料裁剪只为信噪比（质量）；
   effort 默认档上调（简单 low→medium、代码 medium→high；实测延迟明显变长再回调）。
3. **best-of-N（T8）**：免费 lane 上关键产物（关键代码模块/文案）并行 2 份，你评审择优集成
   （两份除附加侧重句外逐字相同；择优必留评审记录；择优后必走 T7）。
4. **评审常规化（T7）**：代码模块集成前默认过一道评审批判——多一次免费调用换质量下限。

**❌ 不要分派**（任一命中即由 ZCode 自己做）：
- 需要工具链：读写文件、搜索代码库、执行命令、联网查资料
- 需要探索式多轮交互的任务（开放式架构探索、边跑边看的多轮调试）——
  注意区分：**接口先定清楚、材料可贴的编码任务适合外包**，只有探索式的才留给自己
- 涉密内容：凭证、内部代码、未公开数据、个人隐私
- 关键路径上需要高确定性的产出（外包结果要经你校验后再用）

**编排侧子代理消费**（大批量时的管理层效率）：fanout 任务 ≥6 个或结果很长时，用 ZCode 自己的
子代理管理整批（构造 tasks.json → 跑 fanout → 逐份校验 → 只回传摘要 + 关键引用），主会话
不吞全部结果文本；层级 ≤2（子代理不得再开子代理派发）。

## 提示词知识库（PROMPTS.md v2）——派发前按编号取用

- 通用原则（12 条）→ PROMPTS.md §1；模板正文与填好示例 → §2（T1 代码 / T2 翻译 / T3 摘要 /
  T4 调研 / T5 结构化抽取 / T6 文案变体 / T7 评审批判 / T8 best-of-N / T9 修复迭代）
- 经验条目（E-001…E-010，带来源与反例）→ §3，按适用场景命中
- 沉淀闭环（history → 复盘 → 四标准入库）→ §4 末「沉淀闭环」
- **决策速查表 + 派发前 3 项 checklist** → §5（每次派发前扫一眼）

## 使用方法

### 单任务（≤3 条时用 ask）

```bash
node .zcode/skills/wb-bridge/scripts/wbx.mjs ask --file <prompt.txt> [--as ai|cn|cline] [--effort medium]
# stdout = 模型输出（可直接管道），stderr = lane/用量/耗时；失败自动回退下一 lane；失败非零退出码
# 每次 ask 都落盘为 job（含完整双向对话），可用 wbx history <jobId> 回放
```

### 批量并行（≥3 条用 fanout）

先写 tasks.json（格式见 `examples/tasks.example.json`；任务可用 `"as":"ai"|"cn"|"cline"` 绑定
lane，缺省动态均衡；可用 `"files": ["路径"]` 让桥读取材料文件按段落拼进提示词）：

```json
[
  { "id": "survey-linear",  "prompt": "……完整 worker 提示词……", "as": "ai" },
  { "id": "translate-1",    "file": "prompts/p1.txt", "effort": "medium" },
  { "id": "code-module",    "prompt": "……T1 代码模板提示词……", "files": ["src/types.ts", "src/util.js"], "effort": "high" }
]
```

```bash
node .zcode/skills/wb-bridge/scripts/wbx.mjs fanout --file tasks.json [--lanes ai,cn,cline] [--parallel 2] [--timeout 300] [--retry 1]
```

- `--lanes`：默认全部已登录且未禁用的 lane；`--parallel` = **每 lane** 并发上限（默认 2；
  cline 另受 `cline-parallel`（默认 1）单独约束）。
- 结果写入 `<运行时根>/jobs/<jobId>/`：每任务一个 `<id>.json`（含 result 全文；cline 任务另有
  `<id>.cline-stream.jsonl` 原始事件流）+ `summary.md`（成功/失败/耗时/token/lane 汇总表，
  跨 lane 回退标注 `ai→cn`）+ `manifest.json`。
  **读 summary.md 掌握全局，再读各 `<id>.json` 取内容，校验后汇总给用户。**
- 回放历史：`wbx history [--last 10]` 列表；`wbx history <jobId> [--task <id>]` 打印完整双向对话。

## worker 提示词模板（务必遵守）

完整模板库见 [PROMPTS.md](PROMPTS.md)（v2：九类模板 + 12 条原则 + 经验条目库 + 决策速查表）。
骨架：

```
你是一名{角色}。任务：{一句话任务}。
你没有任何工具，不能联网、不能读写文件，仅凭下面给定的材料作答。

【输入材料】
{完整材料文本；调研类任务改为"你已掌握的公开知识"，并要求标注信息可能过时}

【输出要求】
- 只输出{明确的输出物}，不要输出任何解释、前后缀、客套话或 Markdown 代码围栏
- 语言：{中文/英文}
- 不确定的内容用 "UNKNOWN" 占位（代码任务用 // TODO(原因)），不要编造
```

要点（详见 PROMPTS.md §1）：
- **材料先行**：worker 看不到你的上下文，材料一次性贴全；超 20k 字符按信噪比裁剪
  （贴接口定义 + 关键段并注明已裁剪——v5：裁剪只为信噪比，不为省钱）。
- **长度**：提示词 >12k 字符自动走 stdin 通道（实测 60k+ 可用），无命令行长度限制。
- **代码任务铁律**：派发结果不派发步骤；每文件单一写者（产物落盘后该文件归 ZCode 管）；
  代码必须经你审查/运行后才进交付物（v5：集成前默认过一道 T7 评审批判）。
- 注意：worker 无联网能力，"调研"类任务产出的是模型已有知识 + 你事后核对来源，不是实时检索——
  涉及时效性事实时必须校验或改用带搜索的工具自己做。

## 命令速查

| 命令 | 用途 |
|---|---|
| `wbx doctor` | 自检向导（node/CLI 探测/模板/lane 凭证/模型探测 + cline 可选段） |
| `wbx login [--identity cn\|ai\|cline]` | 登录（cn 微信扫码；ai 邮箱/OneID+锦囊；cline 浏览器 OAuth 设备授权） |
| `wbx ask --file p.txt [--as ai\|cn\|cline]` | 单次调用，stdout 出结果，失败自动跨 lane 回退，落盘 job |
| `wbx fanout --file t.json [--lanes ai,cn,cline]` | 多 lane 并发池批量，结果落 `.wbx/jobs/<jobId>/` |
| `wbx history [--last 10]` / `wbx history <jobId>` | 历史列表 / 完整回放双向对话（含旧 tasks/ 兼容） |
| `wbx config list\|get\|set` | 配置：default-lane（auto/ai/cn/cline）、disabled-lanes、parallel-per-lane、model、cli-path、cline-*（path/data-dir/provider/model/thinking/compaction/parallel） |
| `wbx models [--as cn\|ai\|cline]` | 探测模型可用性 + 列出产品配置模型 |
| `wbx ui [--port 7788]` | 本地 Web UI（127.0.0.1）：三 lane 状态/路由开关/ask/fanout/历史/登录引导 |
| `wbx self-install / self-uninstall` | 用户级全局安装（/wbx 命令 + 用户级 skill + ~/.wbx）/ 一键还原 |
| `wbx install-user / uninstall-user` | 仅向 `~/.zcode/AGENTS.md` 注入/移除全局主动分派块 |

（`wbx` = `node .zcode/skills/wb-bridge/scripts/wbx.mjs`；WorkBuddy lane 默认模型 deepseek-v4.1-flash）

## /wbx 斜杠命令（装过 self-install 后可用）

任何项目里 `/wbx <任务描述>` = 一键触发分派流程：doctor → 判断适合性 → 构造 worker 提示词 →
ask/fanout 分派 → 校验 → 汇总。命令文件在 `~/.zcode/commands/wbx.md`（正文即上述流程的引导提示词）。

## 失败降级规则（重要）

1. 单任务失败：`--retry 1` 默认已含一次重试 + 一次跨 lane 回退，无需干预。
2. **连续 ≥2 个任务失败，或错误里出现 quota / rate / 429 / 限流** → 立即停止外包，
   如实告知用户（免费额度可能耗尽或被限流），**剩余任务由你自己完成**，不要无限重试。
   特别地：模型输出复述了材料里的错误关键字（Unauthorized/429 等）会被误判为失败——
   重派前先把材料里的错误样例文本换成中性占位符（见 PROMPTS.md E-005）。
3. doctor 显示凭证过期（401/Authentication required）→ 提示用户重新 `wbx login`
   （WorkBuddy 约 55 天一次；cline 重新 `login --identity cline`）。
4. 任何情况下都不要把 `sessions/*.json`、`product/*.json`、`cline/data/settings/providers.json`
   的内容展示给用户或写入文档（含凭证）。
5. 并发保守起步：每 lane 默认 2（cline 默认 1），遇限流降到 1（`--parallel 1`）；不要主动调大。

## 边界与安全

- 不写 `~/.workbuddy`、`~/.workbuddy-ai`、**不读写用户 `~/.cline`**，不动桌面版进程；
  `.wbx/`、`~/.wbx/` 已 gitignore，绝不提交。
- cline lane 一律 `--auto-approve false`（非 TTY 下工具调用全拒 = 纯文本端点）；不使用
  `--yolo`/`--zen`（开启其 agentic 形态是 v5 范围外的另一回事）。
- 桌面版与桥共用账号额度，高峰期注意节流（cline 为按量微付费，成本见 lane 表）。
- 本桥为临时工具：免费期/低价期结束即废弃（见项目根 WBX.md）。
