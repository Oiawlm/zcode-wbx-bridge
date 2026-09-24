---
name: wb-bridge
description: >-
  通过 wbx 桥把合适的子任务并行分派给外部算力（WorkBuddy 双 lane 下的 DeepSeek V4.1 Flash：国际版免费、国内版近免费）执行。
  当出现以下任一情形时主动使用：需要调研或对比多个对象（竞品、软件、开源库、技术选型）、收集参考素材或做法、
  批量生成/处理文本（翻译、摘要、改写、变体、结构化抽取、分类打标）、编写或并行编写代码模块/纯函数/组件/测试用例
  （接口清晰、材料可贴进提示词、输出可校验的自包含编码任务）、一段工作可拆成多个相互独立并行的子任务，
  或用户明确提到「并行处理、批量任务、外包出去、用免费额度、用 DeepSeek、WorkBuddy、CodeBuddy 跑」，或使用 /wbx 命令。
  前提：子任务自包含（输入可由编排器打包进提示词、输出可独立校验）、相互独立、单轮可完成。
---

# wb-bridge：把子任务并行分派给外部算力（WorkBuddy 双 lane · DeepSeek V4.1 Flash）

通过驱动 WorkBuddy 桌面版自带的 CodeBuddy CLI（headless 无工具模式），把适合的子任务
（v4 起**含代码模块编写**这类自包含编码任务）并行分派给账号下的 `deepseek-v4.1-flash`。双 lane：

| lane | 身份 | 成本 | 说明 |
|---|---|---|---|
| `ai` | WorkBuddy AI 国际版 | **x0.00 免费** | 默认优先（成本理由，见 WBX.md） |
| `cn` | WorkBuddy 国内版 | x0.03 近免费 | 兜底（微信扫码登录路径稳定） |

路由：由 `wbx config` 的 default-lane 决定（`auto`=ai 已登录则 ai，否则 cn）；任一 lane 失败/限流
自动改投另一 lane（各一次，不无限重试）；`disabled-lanes` 可硬禁用某 lane。
所有调用走项目内 `.wbx/` 隔离运行时，不影响桌面版 WorkBuddy（装过 `wbx self-install` 后统一走 `~/.wbx/`，凭证全局共享）。

## 第一步：永远先自检

```bash
node .zcode/skills/wb-bridge/scripts/wbx.mjs doctor
```

- 有任一 lane 全绿 → 继续（未登录的 lane 显示 [SKIP]，不影响）。
- 两个 lane「凭证」都红 → **停止分派**，告诉用户：「请运行 `node .zcode/skills/wb-bridge/scripts/wbx.mjs login`（国内版微信扫码）或 `login --identity ai`（国际版，输出里有 state 修补锦囊），凭证约 55 天有效」，期间这些任务由你自己完成。
- 「cli」红（App 升级挪了路径）→ 告知用户，改由你自行完成任务（新机会自动扫描常见位置，也可 `wbx config set cli-path "<路径>"`）。

## 任务分派准则（先判断，再动手）

**✅ 适合分派**（必须全部满足；v4 判定公理 = **自包含任务**）：
- 相互独立，无顺序依赖，可并行
- 自包含：任务的全部输入（含代码上下文）能由你打包进提示词——「要让它先读文件」= 你先读文件，
  把内容贴进提示词材料区（材料先行），或用 fanout 任务级 `"files": ["路径"]` 让桥代拼
- 输出可独立校验：文本/JSON 可核对，代码可编译/运行/审查
- 单轮可完成，不需要工具、文件系统、联网
- 典型：**代码模块编写**（单文件模块/组件/纯函数：ZCode 定接口契约 → 材料先行分派 →
  审查/运行后集成）、多对象调研（每对象一个 worker，要求带来源清单）、中英互译、长文摘要、
  改写润色、标题/文案变体批量生成、资料整理草稿、结构化抽取（日志→JSON）、分类打标

**❌ 不要分派**（任一命中即由 ZCode 自己做）：
- 需要工具链：读写文件、搜索代码库、执行命令、联网查资料
- 需要探索式多轮交互的任务（开放式架构探索、边跑边看的多轮调试）——
  注意区分：**接口先定清楚、材料可贴的编码任务适合外包**，只有探索式的才留给自己
- 涉密内容：凭证、内部代码、未公开数据、个人隐私
- 关键路径上需要高确定性的产出（外包结果要经你校验后再用）

worker 提示词模板（v4 六类：代码模块编写/翻译/摘要/调研/结构化抽取/文案变体）见
[PROMPTS.md](PROMPTS.md)——代码任务用 T1 模板（接口契约+材料区+硬输出约束，
不确定处 `// TODO(原因)` 不许编造）。

## 使用方法

### 单任务（≤3 条时用 ask）

```bash
node .zcode/skills/wb-bridge/scripts/wbx.mjs ask --file <prompt.txt> [--as ai|cn] [--effort low]
# stdout = 模型输出（可直接管道），stderr = lane/用量/耗时；失败自动回退另一 lane；失败非零退出码
# 每次 ask 都落盘为 job（含完整双向对话），可用 wbx history <jobId> 回放
```

### 批量并行（≥3 条用 fanout）

先写 tasks.json（格式见 `examples/tasks.example.json`；任务可用 `"as":"ai"|"cn"` 绑定 lane，缺省动态均衡；
v4 起可用 `"files": ["路径"]` 让桥读取材料文件按段落拼进提示词，相对路径基于 tasks.json 所在目录）：

```json
[
  { "id": "survey-linear",  "prompt": "……完整 worker 提示词……", "as": "ai" },
  { "id": "translate-1",    "file": "prompts/p1.txt", "effort": "low" },
  { "id": "code-module",    "prompt": "……T1 代码模板提示词……", "files": ["src/types.ts", "src/util.js"], "effort": "medium" }
]
```

```bash
node .zcode/skills/wb-bridge/scripts/wbx.mjs fanout --file tasks.json [--lanes ai,cn] [--parallel 2] [--timeout 300] [--retry 1]
```

- `--lanes`：默认全部已登录且未禁用的 lane；`--parallel` = **每 lane** 并发上限（默认 2，总并发 = lane 数 × 2）。
- 结果写入 `<项目>/.wbx/jobs/<jobId>/`（装过 self-install 则为 `~/.wbx/jobs/`）：每任务一个 `<id>.json`
  （含 result 全文）+ `summary.md`（成功/失败/耗时/token/lane 汇总表，跨 lane 回退标注 `ai→cn`）
  + `manifest.json`（参数与 config 快照）。
  **读 summary.md 掌握全局，再读各 `<id>.json` 取内容，校验后汇总给用户。**
- 回放历史：`wbx history [--last 10]` 列表；`wbx history <jobId> [--task <id>]` 打印完整双向对话。

## worker 提示词模板（务必遵守）

完整模板库见 [PROMPTS.md](PROMPTS.md)（v4 六类：**代码模块编写**（T1，核心新增）、翻译、
摘要、调研、结构化抽取、文案变体；每个模板带填好的示例与官方出处）。骨架：

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

要点（详见 PROMPTS.md「通用原则」）：
- **材料先行**：模型看不到你的上下文，材料一次性贴全；超 20k 字符按裁剪准则贴接口定义+关键段并注明已裁剪。
- **长度**：v4 起提示词 >12k 字符自动走 stdin 通道（无命令行长度限制，实测 60k+ 可用）；
  但材料越长费用/延迟越高，仍按需裁剪。
- **代码任务铁律**：派发结果不派发步骤（worker 只交整文件实现，不指挥它做多步操作）；
  每文件单一写者（产物落盘后该文件归 ZCode 管）；代码必须经你审查/运行后才进交付物。
- 注意：worker 无联网能力，"调研"类任务产出的是模型已有知识 + 你事后核对来源，不是实时检索——
  涉及时效性事实时必须校验或改用带搜索的工具自己做。

## 命令速查

| 命令 | 用途 |
|---|---|
| `wbx doctor` | 自检向导（node/CLI 探测/模板/两 lane 凭证/模型探测），有可用 lane 即可继续 |
| `wbx login [--identity cn\|ai]` | 浏览器 SSO 登录（默认国内版微信扫码；ai 版输出 state 修补锦囊） |
| `wbx ask --file p.txt [--as ai\|cn] [--effort low]` | 单次调用，stdout 出结果，失败自动跨 lane 回退，落盘 job |
| `wbx fanout --file t.json [--lanes ai,cn] [--parallel 2]` | 双 lane 并发池批量，结果落 `.wbx/jobs/<jobId>/` |
| `wbx history [--last 10]` / `wbx history <jobId>` | 历史列表 / 完整回放双向对话（含旧 tasks/ 兼容） |
| `wbx config list\|get\|set` | 配置：default-lane（auto/ai/cn）、disabled-lanes、parallel-per-lane、model、cli-path |
| `wbx models [--as cn\|ai]` | 探测模型可用性 + 列出产品配置模型 |
| `wbx ui [--port 7788]` | 本地 Web UI（127.0.0.1）：状态/路由开关/ask/fanout/历史/登录引导 |
| `wbx self-install / self-uninstall` | 用户级全局安装（/wbx 命令 + 用户级 skill + ~/.wbx）/ 一键还原 |
| `wbx install-user / uninstall-user` | 仅向 `~/.zcode/AGENTS.md` 注入/移除全局主动分派块 |

（`wbx` = `node .zcode/skills/wb-bridge/scripts/wbx.mjs`；默认模型 deepseek-v4.1-flash）

## /wbx 斜杠命令（装过 self-install 后可用）

任何项目里 `/wbx <任务描述>` = 一键触发分派流程：doctor → 判断适合性 → 构造 worker 提示词 →
ask/fanout 分派 → 校验 → 汇总。命令文件在 `~/.zcode/commands/wbx.md`（正文即上述流程的引导提示词）。

## 失败降级规则（重要）

1. 单任务失败：`--retry 1` 默认已含一次重试 + 一次跨 lane 回退，无需干预。
2. **两个 lane 连续 ≥2 个任务失败，或错误里出现 quota / rate / 429 / 限流** → 立即停止外包，
   如实告知用户（免费额度可能耗尽或被限流），**剩余任务由你自己完成**，不要无限重试。
3. doctor 显示凭证过期（401/Authentication required）→ 提示用户重新 `wbx login`（约 55 天一次）。
4. 任何情况下都不要把 `sessions/*.json`、`product/*.json` 的内容展示给用户或写入文档（含凭证）。
5. 并发保守起步：每 lane 默认 2，遇限流降到 1（`--parallel 1`）；不要主动调大。

## 边界与安全

- 不写 `~/.workbuddy`、`~/.workbuddy-ai`，不动桌面版进程；`.wbx/`、`~/.wbx/` 已 gitignore，绝不提交。
- 桌面版与桥共用账号额度，高峰期注意节流。
- 本桥为临时工具：DeepSeek 免费期/低价期结束即废弃（见项目根 WBX.md）。
