# wbx 桥 — 让 AI 编程助手把调研、翻译乃至代码模块编写并行外包给免费的 DeepSeek

**一句话定位**：它教你的 AI 编程助手（ZCode）学会一件事——把调研初稿、翻译、批量文本，乃至**代码模块的编写**，自动并行外包给免费（或近免费）的外部算力去做；这些外部 Agent 就是它的子代理，默认分派、放开用。

为什么需要它：你订阅的 AI 编程助手额度宝贵，但日常开发里大量子任务是「自包含」的——给三款竞品各写一份调研初稿、把十段文案翻成英文、从日志抽取结构化数据，甚至是一个接口已经定义清楚、上下文可以贴进提示词的工具函数模块。这些活交给主力模型既慢又浪费额度。wbx 桥把它们转发给免费（或近免费）的 DeepSeek 算力，并行执行、结果落盘、随时回放；主力模型退回它最该做的事——定义接口、集成、审查与兜底。

> 三个诚实声明，先说在前面：① 这是**个人非官方工具**，与 WorkBuddy、腾讯、智谱、Cline 均无关联；② 目前仅支持 **Windows**；③ 这是**临时工具**——它依附的免费策略随时可能变化，不再划算就卸载（见 [UNINSTALL.md](UNINSTALL.md)），不要恋战。

## 工作原理

```
 ZCode（AI 编程助手）
    │  「帮我调研 A、B、C 三款软件」/「这个功能拆 5 个模块，能并行的就并行」
    ▼
 wbx 桥（Node CLI，本仓库）
    │  自动拆成独立 worker 任务（调研/翻译/…/代码模块），并行分派
    ├──────────────────┬──────────────────┬───────────────┐
    ▼                  ▼                  ▼               │
 ai lane（国际版）   cn lane（国内版）    cline lane（可选）  │
 WorkBuddy AI        WorkBuddy           Cline CLI        │
 DeepSeek V4.1 Flash DeepSeek V4.1 Flash DeepSeek V4.1 Flash│
 x0.00 免费          x0.03 近免费         微付费·xhigh     │
    └──────────────────┴──────────────────┴───────┬───────┘
                                                   ▼
                     结果落盘 .wbx/jobs/<jobId>/（可回放、可审计）
```

- 「lane（车道）」就是一条到某个模型服务的通路。前两条 lane 对应 WorkBuddy 的两个版本（你登录哪个账号，就用哪个账号下的 DeepSeek V4.1 Flash）；第三条是可选的独立上游 Cline CLI——同源限流时多一份真实冗余。

| lane | 对应产品 | 服务地址 | 模型成本 |
|---|---|---|---|
| `ai` | WorkBuddy AI 国际版 | www.workbuddy.ai | DeepSeek V4.1 Flash **x0.00（当前免费）** |
| `cn` | WorkBuddy 国内版 | copilot.tencent.com | DeepSeek V4.1 Flash x0.03（近免费） |
| `cline` | Cline CLI（可选，需 npm 单独安装） | Cline provider（OAuth 账号） | DeepSeek V4.1 Flash 按量微付费（实测单次约 $0.0003-0.004） |

- **回退链**：`ai`（免费）→ `cn`（近免费）→ `cline`（微付费）→ 你的主力模型自己做。任一 lane 失败或限流时自动改投下一条 lane（各一次，不无限重试），全部不可用就退回本地完成，任务不会丢。cline 未安装/未登录时自动跳过，**不影响其余任何功能**（doctor 对它只显示一行 WARN）。
- **高频子代理调度（v5）**：三条 lane 几乎免费，所以调用策略是「默认分派」——凡自包含的子任务（输入可打包进提示词、输出可独立校验），单个也直接派，不必凑够批量；关键产物（关键代码模块/文案）同一契约并行派两份、AI 助手评审择优（best-of-N）；代码模块集成前默认过一道评审批判。防护不变：结果必校验、连续失败或限流即止损、涉密绝不外包。
- 技术上：桥以无界面（headless）方式驱动 WorkBuddy 桌面版自带的 CodeBuddy CLI 与 Cline CLI，关闭其全部工具执行（cline 用 `--auto-approve false`，非终端环境下全部工具调用自动拒绝），只当纯文本模型端点用，因此不会碰你的文件系统和网络。worker 需要的代码上下文由编排器（你的 AI 助手）先读好、完整贴进提示词（「材料先行」）；超长材料走 stdin 通道自动传输，不受命令行长度限制。
- **隔离边界**：桥的所有状态（凭证、配置、历史）只存在 `.wbx/`（全局形态为 `~/.wbx/`）；cline lane 的状态只存在 `~/.wbx/cline/` 隔离目录——**绝不读写你自己的 `~/.cline`**，也不写 `~/.workbuddy*`、不改系统环境变量。

## 适合 / 不适合

**✅ 适合外包的任务**（相互独立、自包含、一轮能答完——全部输入可打包进提示词、输出可独立校验；v5 起单个也默认派）：

- **代码模块编写**：接口由你的 AI 助手定义清楚、相关上下文可以贴进提示词的单文件模块/组件/纯函数/测试用例——助手负责接口定义、集成与审查，worker 负责实现（配套提示词模板见 [SKILL.md](.zcode/skills/wb-bridge/SKILL.md) 与 [PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md)）
- 关键模块双份并行（best-of-N）：同一契约派两份、侧重不同，AI 助手评审择优集成
- 单对象或多对象调研初稿：每个调研对象一个 worker，并行出稿（产出是模型已有知识，时效性需自行核对）
- 批量翻译（中英互译等）、长文摘要、改写润色
- 结构化抽取：日志/表格文本 → JSON
- 标题、文案、变体批量生成；分类打标

**❌ 不适合的任务**（留给主力模型自己做）：

- 需要联网、查资料、读写文件、执行命令的任务（worker 没有任何工具）
- 需要探索式多轮交互的任务（开放式架构探索、边跑边看的多轮调试）——注意：接口先定清楚、材料可贴的编码任务**适合**外包，探索式的才留下
- 涉密内容：凭证、内部代码、未公开数据、个人隐私——绝不外包
- 需要高确定性的关键产出（外包结果务必先校验再使用）

## 部署指南（基础路径约 10 分钟，不算下载安装）

以下命令均在**普通终端（PowerShell 或 CMD）**中运行，全部可直接复制。

### 第 0 步：确认前提（逐条可检测）

| 前提 | 检测方法 | 不满足时 |
|---|---|---|
| Windows 10/11 | 本工具仅支持 Windows | macOS/Linux 暂不支持 |
| Node ≥ 18.20.8 | `node --version` | 去 nodejs.org 安装 LTS 版 |
| 已安装 ZCode（AI 编程助手） | 能打开 ZCode 即可 | 不装也能用命令行，但失去「AI 自动分派」体验 |
| WorkBuddy 桌面版（任一版本） | 已安装**且成功启动过至少一次** | 去 workbuddy.ai（国际版）或官网（国内版）下载安装，登录并打开一次 |

> WorkBuddy 桌面版只需「安装并启动过一次」——桥要借用它自带的 CLI 和运行时配置模板，平时不需要让它后台常驻。

### 第 1 步：获取代码

```powershell
# 方式一：git clone（推荐）
git clone https://github.com/Oiawlm/zcode-wbx-bridge.git
cd zcode-wbx-bridge

# 方式二：本页绿色 Code 按钮 → Download ZIP → 解压到任意文件夹 → 终端 cd 进去
```

预期结果：终端当前目录下能看到 `README.md`、`WBX.md`、`.zcode\skills\wb-bridge\` 等。

### 第 2 步（可选）：让 ZCode 识别这个项目

用 ZCode 打开（或新建项目指向）刚下载的文件夹。项目根的 `AGENTS.md` 与 `.zcode/skills/wb-bridge/SKILL.md` 会被自动加载——之后你在会话里说「帮我调研 A、B、C」，ZCode 就会自动并行分派，无需你提「外包」二字。只想用命令行的话，跳过这步。

### 第 3 步：自检（doctor）

```powershell
node .zcode\skills\wb-bridge\scripts\wbx.mjs doctor
```

预期输出：逐项检查 node 版本 → CLI 路径（自动扫描常见安装位置）→ 模板缓存 → 各 lane 的凭证（cline 段显示「未安装（可选）」或「未登录」属正常，不影响结论）。末尾 `exit 0` 且至少一个 lane 可用即为健康；**全新机器上「凭证」一项红/跳过是正常的**（还没登录），进入第 4 步。

常见红灯处置：

| doctor 红灯项 | 原因 | 处置 |
|---|---|---|
| `cli` 红 | 找不到 WorkBuddy 的 CLI | 确认 WorkBuddy 已安装；重跑 doctor 让它自动扫描；仍不行则 `node .zcode\skills\wb-bridge\scripts\wbx.mjs config set cli-path "<CLI 完整路径>"` 手动指定 |
| 模板缓存缺失 | WorkBuddy 从未启动过 | 打开 WorkBuddy 桌面版登录一次，再重跑 doctor |
| 某个 lane 凭证红/[SKIP] | 该 lane 未登录或 token 过期 | 执行第 4 步对应登录命令；不需要全部登录，有一条即可用 |
| cline 段 WARN | 未装/未登录（可选 lane） | 想用就见第 5.5 步；不用可无视 |

### 第 4 步：登录（二选一或都登）

```powershell
# 国内版（推荐，微信扫码最稳）
node .zcode\skills\wb-bridge\scripts\wbx.mjs login

# 国际版（免费额度，邮箱/OneID 登录）
node .zcode\skills\wb-bridge\scripts\wbx.mjs login --identity ai
```

预期行为：自动打开浏览器到登录页。国内版用微信扫码，几秒后终端显示拿到凭证即成功。凭证只落在本地 `.wbx\` 文件夹（已被 gitignore，绝不上传）。

**国际版已知问题（state 丢失锦囊）**：国际版网页登录偶尔在跳转后显示「登录失败」——此时登录 cookie 其实已建立。**把终端里命令输出的「锦囊 A」URL 整段复制到浏览器地址栏回车**，大概率直接打通。终端输出里同时备有锦囊 B（重选账号页）URL。

### 第 5 步：跑通第一条任务

```powershell
node .zcode\skills\wb-bridge\scripts\wbx.mjs ask --text "用一句话解释什么是幂等性"
```

预期输出：stdout 直接打印模型回答（如「幂等性是指同一操作执行一次与多次的效果相同……」），stderr 显示所用 lane 与 token 用量。这一条通了，部署就完成了。

### 第 6 步（可选）：升级为全局安装

想在**任何项目**里都能用（而不只是这个文件夹），并获得 `/wbx` 斜杠命令：

```powershell
node .zcode\skills\wb-bridge\scripts\wbx.mjs self-install --adopt
```

`--adopt` 会把本项目 `.wbx\` 里的凭证迁移到用户级 `~\.wbx\`，之后所有项目共享登录态。新项目里直接 `/wbx <任务描述>` 一键分派。撤销随时可用 `self-uninstall`。

### 第 5.5 步（可选扩展）：启用 cline lane（第三条免费算力）

不装不影响上面任何步骤（主路径不变）。想要独立的第三上游时：

```powershell
npm install -g cline                                       # Cline CLI（npm 全局包）
node .zcode\skills\wb-bridge\scripts\wbx.mjs login --identity cline   # 浏览器完成 OAuth 设备授权
node .zcode\skills\wb-bridge\scripts\wbx.mjs doctor        # cline 段应全绿
# 可选：固定模型（免费 DeepSeek 模型 id 以 doctor/models 探测为准）
node .zcode\skills\wb-bridge\scripts\wbx.mjs config set cline-model "<模型id>"
```

要点：cline lane 默认 `--thinking xhigh --compaction off`（上下文与思考强度拉满），并发默认 1（额度保护）；状态只存 `~\.wbx\cline-home\`（桥以 HOME 覆盖实现隔离——实测 3.0.65 的 `--data-dir` 会破坏认证加载，故不用），与你自己的 Cline（`~\.cline`）互不影响。禁用：`config set disabled-lanes '["cline"]'`；彻底移除：`npm uninstall -g cline` + 删 `~\.wbx\cline-home\`（见 [UNINSTALL.md](UNINSTALL.md)）。

### 给 AI Agent 的部署指引

如果你是收到本仓库链接、替用户部署的 AI Agent，请这样做：

1. **按上面第 0→5 步顺序执行**，不要跳步；每步命令的预期输出就是你的验收标准。
2. **doctor 的每种红灯按第 3 步的处置表处理**；处理完重跑 doctor，直到至少一个 lane 可用。
3. **涉及真人操作的步骤必须停下来叫用户**：第 4 步浏览器扫码、输密码、手机确认，cline lane 的 OAuth 设备码确认等，你不代替用户输入任何账号凭证。把命令跑起来后，明确告诉用户「请在弹出的浏览器里完成登录」，等凭证就绪再继续。
4. **最后用 doctor + 一条 ask 验证**，并向用户汇报：装了哪条 lane、ask 返回了什么、凭证有效期提醒（约 55 天后需重新登录）。
5. 用户没有明确要求时，不要执行 `self-install` 与 `npm install -g cline`（改动用户级配置的事让用户决定）。

## 日常使用速查

以下 `wbx` 均指 `node .zcode\skills\wb-bridge\scripts\wbx.mjs`（全局安装后可直接在任何项目里用）。

| 命令 | 用途 |
|---|---|
| `wbx doctor` | 自检：node/CLI 路径/模板/各 lane 凭证与模型探测（含 cline 可选段） |
| `wbx login [--identity cn\|ai\|cline]` | 登录（cn 微信扫码；ai 邮箱/OneID；cline 浏览器 OAuth） |
| `wbx ask --file p.txt` 或 `--text "…"` | 单条任务；stdout 出结果，失败自动换 lane |
| `wbx fanout --file tasks.json` | 批量并行（任务文件格式见 [examples](.zcode/skills/wb-bridge/examples/tasks.example.json)；任务可绑 lane、可挂材料文件） |
| `wbx history --last 10` / `wbx history <jobId>` | 历史列表 / 回放某次任务的完整双向对话 |
| `wbx config list` / `set <key> <value>` | 路由与并发配置（default-lane、disabled-lanes、parallel-per-lane、cline-* 等） |
| `wbx models` | 探测模型可用性、列出账号下全部模型 |
| `wbx ui` | 本地可视化控制台（浏览器打开 127.0.0.1:7788，Ctrl+C 即退） |
| `wbx self-install --adopt` | 全局安装：任何项目可用 + `/wbx` 斜杠命令 |
| `wbx self-uninstall [--purge]` | 全局卸载一键还原（`--purge` 连凭证一起删） |
| `wbx export-bundle` | 生成零凭证分发包 zip，可发给同事在其他机器安装 |

另外两个入口：ZCode 会话里输入 `/wbx <任务描述>`（全局安装后可用）= 一键分派流程；`wbx ui` = 网页控制台，可视化看三 lane 状态、发起任务、翻历史记录。

**质量与安全提示**：免费算力输出质量有方差，外包结果先校验再使用（代码产物必须审查/运行后才进交付物，v5 起集成前默认过一道评审批判）；worker 无联网能力，「调研」产出是模型已有知识、可能过时；涉密内容绝不外包。完整分派准则与 worker 提示词模板见 [SKILL.md](.zcode/skills/wb-bridge/SKILL.md) 与 [PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md)（v2 知识库：12 条原则、9 类模板、经验条目库与决策速查表），技术细节见 [WBX.md](WBX.md)。

## 常见问题

**能帮 AI 写代码吗？**
能，而且这是 v4 起的核心场景。判定标准是「自包含」：模块的接口（函数签名、类型、错误约定、验收标准）由你的 AI 助手定义清楚，所需上下文可以贴进提示词，输出是一份可审查、可运行的完整文件——就适合外包。典型用法：一个功能拆五个模块，其中两三个并行外包给 DeepSeek，AI 助手负责接口定义、集成与审查。不适合的是探索式多轮编码（边跑边看、需要反复交互的任务）。代码产物一律经 AI 助手（或你）审查、编译、运行后才进入交付物；配套的代码任务提示词模板见 [PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md)。

**真的免费吗？**
`ai` lane（国际版）当前 x0.00，`cn` lane（国内版）x0.03 近免费，`cline` lane 按量微付费（实测单次约 $0.0003-0.004；v5 发布当日 CLI 侧未探测到零成本模型，若你的 Cline 账号 App 内有标 Free 的模型，`wbx config set cline-model "<id>"` 即可切换）。这些都是 WorkBuddy / Cline 的产品策略，随时可能调整；桥每次调用都会显示实际用量，发现不再划算就停用。

**多久要重新登录一次？**
国内版 accessToken 约 55 天有效，到期后 doctor 会显示凭证红，重新 `wbx login` 一次即可；国际版有效期更长（数百天级）；cline 的 OAuth 凭证失效后（ask 报 Unauthorized）重新 `wbx login --identity cline` 即可。

**凭证安全吗？会自动上传吗？**
凭证（WorkBuddy accessToken、cline OAuth 凭证）只存在你本机的 `.wbx\` 或 `~\.wbx\` 文件夹，`.gitignore` 已覆盖，绝不会被提交或上传。桥的所有网络请求只发往对应官方服务地址（workbuddy.ai / copilot.tencent.com / Cline 官方端点）。

**支持 macOS / Linux 吗？**
暂不支持，当前为 Windows-only（CLI 路径扫描、进程管理等按 Windows 实现）。

**和 WorkBuddy、智谱、Cline 是什么关系？**
无关联。这是个人开发的非官方工具：借 WorkBuddy 桌面版自带的 CLI、Cline CLI 与它们的免费模型策略工作，ZCode 只是它服务的 AI 编程助手之一。WorkBuddy 是腾讯系产品，智谱是 ZCode 的开发方，Cline 是独立产品，均未参与、不知晓本项目。

**会动我电脑上的 WorkBuddy、Cline 或其他软件吗？**
不会。桥对 WorkBuddy 桌面版只读（借用 CLI 与配置模板）；对你的 Cline（`~\.cline`）**从不读写**（桥自己的 cline 状态在 `~\.wbx\cline\` 隔离目录）；不写任何桌面版文件、不改系统环境变量、无常驻后台进程（`wbx ui` 是前台进程，关终端即退）。

**免费额度用尽怎么办？**
表现：任务失败、错误里出现 quota / 429 / 限流字样。处置顺序：降并发（`fanout --parallel 1`）稍后再试 → 换 lane（`ask --as <lane>` 或 `config set default-lane`，比如 ai 限流就改走 cn）→ 启用 cline lane 作第三算力 → 都不行就先停用外包，由主力模型自己做。免费策略随时可能变化，不再划算就卸载（[UNINSTALL.md](UNINSTALL.md)）。

**cline lane 的 OAuth 登录失败怎么办？**
`wbx login --identity cline` 是设备码流程：终端会显示一个 code 和授权 URL，浏览器打开后确认即可。code 有效期有限——超时会报 `WorkOS device authorization timed out`，重新运行登录命令拿新 code 就行。凭证落 `~\.wbx\cline\`（与你自己 `~\.cline` 无关）；成功后 doctor 的 cline 段应全绿。

**best-of-N 是什么？为什么同一任务派两份？**
v5 的调度模式：关键产物（关键代码模块/对外文案）用**同一契约**并行派 2 份，两份只有一句「附加侧重」不同（比如一份侧重可读性、一份侧重边界完备），你的 AI 助手评审后择优集成并留档。外部算力几乎免费，多派一份换的是质量下限——两份侧重点刻意不同，不是重复劳动。

## 故障排查速查表

| 错误 / 症状 | 原因 | 修复 |
|---|---|---|
| doctor「cli」红 | WorkBuddy App 升级挪了 CLI 路径 | 重跑 doctor 自动扫描；或 `wbx config set cli-path "<新路径>"` |
| doctor 模板缓存缺失 | WorkBuddy 从未启动过 | 打开 WorkBuddy 桌面版登录一次，再重跑 doctor |
| 某 lane 凭证红 / [SKIP] | 未登录或 accessToken 过期（约 55 天） | `wbx login --identity <lane>` 重新登录 |
| ask/fanout 报 429 / quota / 限流 | 免费额度或限流 | 降并发（`--parallel 1`）、稍后再试、换 lane；持续则停用外包 |
| fanout 大量 timeout | 网络/服务波动 | 提高 `--timeout` 或减小并发 |
| 提示词很长，担心命令行放不下 | v4 起 >12k 字符自动走 stdin | 无需处理；材料过长会推高延迟，按需裁剪 |
| 模型输出质量差 | 提示词缺硬输出约束 / effort 档位低 | 按 PROMPTS.md 模板补齐输出硬约束；`--effort` 调高一档 |
| 国际版 login 永远 pending | 网页跳转后 state 丢失（已知 bug） | 复制命令输出里的「锦囊 A」URL 到地址栏回车 |
| `Cannot find module ...wbx.mjs` | 命令用了相对路径但当前目录不在项目根 | `cd` 到项目根，或用绝对路径调用（路径含空格加引号） |
| Git Bash 下中文路径报模块加载/编码错误 | 项目路径含非 ASCII 字符 | 改用全局桥 ASCII 入口：`node "C:\Users\<用户名>\.zcode\wbx-bridge\scripts\wbx.mjs" ...` |
| cline lane 报 Unauthorized | cline OAuth 凭证无效/过期 | 重新 `wbx login --identity cline`（浏览器确认新设备码） |
| cline 段显示「未安装（可选）」 | 没装 Cline CLI | 想用就 `npm install -g cline`；不用可无视（不影响 ai/cn） |
| 任务失败报凭证错误，但 doctor 正常，且重试无效 | 材料里贴了错误样例原文，模型输出复述后被桥误判 | 把材料里的错误关键字换成中性占位符（如 `AUTH_SESSION_INVALID`）再派（详见 PROMPTS.md 经验条目） |

## 卸载

项目形态删目录即净；全局形态一条命令还原；装过 cline lane 的再 `npm uninstall -g cline`。全部路径见 [UNINSTALL.md](UNINSTALL.md)。

## 许可证与声明

[MIT License](LICENSE)。

再次强调：本工具**非官方**，**依赖第三方服务与 CLI**（WorkBuddy / DeepSeek / Cline），其服务条款、免费与定价策略、数据流向以各自官方约定为准——你通过本桥发送的内容会经过这些第三方服务；免费窗口随时可能变化。它是依附于当前免费窗口的**临时工具**，不再划算时请直接卸载（[UNINSTALL.md](UNINSTALL.md)）。使用本工具产生的任何费用、账号风险由使用者自行承担。
