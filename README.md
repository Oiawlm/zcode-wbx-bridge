# wbx 桥 — 让 AI 编程助手把文本杂活外包给免费的 DeepSeek

**一句话定位**：它教你的 AI 编程助手（ZCode）学会一件事——把翻译、摘要、调研初稿这类「不值得烧主力模型额度」的文本杂活，自动并行外包给免费（或近免费）的 DeepSeek 算力去做。

为什么需要它：你订阅的 AI 编程助手额度宝贵，但日常工作中大量任务是简单文本活——把十段文案翻成英文、给三款竞品各写一份调研初稿、从日志里抽取结构化数据。这些活交给主力模型既慢又浪费额度。wbx 桥把它们转发给 WorkBuddy 账号下的 DeepSeek V4.1 Flash（国际版当前完全免费、国内版近免费），并行执行、结果落盘、随时回放。

> 三个诚实声明，先说在前面：① 这是**个人非官方工具**，与 WorkBuddy、腾讯、智谱均无关联；② 目前仅支持 **Windows**；③ 这是**临时工具**——它依附的免费策略随时可能变化，不再划算就卸载（见 [UNINSTALL.md](UNINSTALL.md)），不要恋战。

## 工作原理

```
 ZCode（AI 编程助手）
    │  「帮我调研 A、B、C 三款软件」
    ▼
 wbx 桥（Node CLI，本仓库）
    │  自动拆成 3 个独立 worker 任务，并行分派
    ├──────────────────────┬──────────────────────┐
    ▼                      ▼                      │
 ai lane（国际版）      cn lane（国内版）          │
 DeepSeek V4.1 Flash    DeepSeek V4.1 Flash      │
 x0.00 免费             x0.03 近免费              │
    └──────────────────────┴──────────┬───────────┘
                                       ▼
                     结果落盘 .wbx/jobs/<jobId>/（可回放、可审计）
```

- 「lane（车道）」就是一条到某个模型服务的通路。本桥有两条 lane，对应 WorkBuddy 的两个版本：
  你登录哪个账号，就用哪个账号下的 DeepSeek V4.1 Flash。

| lane | 对应产品 | 服务地址 | DeepSeek V4.1 Flash 成本 |
|---|---|---|---|
| `ai` | WorkBuddy AI 国际版 | www.workbuddy.ai | **x0.00（当前免费）** |
| `cn` | WorkBuddy 国内版 | copilot.tencent.com | x0.03（近免费） |

- **回退链**：`ai`（免费）→ `cn`（近免费）→ 你的主力模型自己做。任一 lane 失败或限流时自动改投另一条 lane（各一次，不无限重试），两条都不可用就退回本地完成，任务不会丢。
- 技术上：桥以无界面（headless）方式驱动 WorkBuddy 桌面版自带的 CodeBuddy CLI，关闭其全部工具、只当纯文本模型端点用，因此不会碰你的文件系统和网络。

## 适合 / 不适合

**✅ 适合外包的任务**（相互独立、纯文本进出、一轮能答完）：

- 多对象调研初稿：每个调研对象一个 worker，并行出稿（产出是模型已有知识，时效性需自行核对）
- 批量翻译（中英互译等）、长文摘要、改写润色
- 结构化抽取：日志/表格文本 → JSON
- 标题、文案、变体批量生成；分类打标

**❌ 不适合的任务**（留给主力模型自己做）：

- 需要联网、查资料、读写文件、执行命令的任务（worker 没有任何工具）
- 多轮依赖上下文的推理或编码任务
- 涉密内容：凭证、内部代码、未公开数据、个人隐私——绝不外包
- 需要高确定性的关键产出（外包结果务必先校验再使用）

## 部署指南

整个过程约 10 分钟（不算下载安装）。以下命令均在**普通终端（PowerShell 或 CMD）**中运行，全部可直接复制。

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

预期输出：逐项检查 node 版本 → CLI 路径（自动扫描常见安装位置）→ 模板缓存 → 两个 lane 的凭证。末尾 `exit 0` 且至少一个 lane 可用即为健康；**全新机器上「凭证」一项红/跳过是正常的**（还没登录），进入第 4 步。

常见红灯处置：

| doctor 红灯项 | 原因 | 处置 |
|---|---|---|
| `cli` 红 | 找不到 WorkBuddy 的 CLI | 确认 WorkBuddy 已安装；重跑 doctor 让它自动扫描；仍不行则 `node .zcode\skills\wb-bridge\scripts\wbx.mjs config set cli-path "<CLI 完整路径>"` 手动指定 |
| 模板缓存缺失 | WorkBuddy 从未启动过 | 打开 WorkBuddy 桌面版登录一次，再重跑 doctor |
| 某个 lane 凭证红/[SKIP] | 该 lane 未登录或 token 过期 | 执行第 4 步对应登录命令；两条 lane 不需要都登录，有一条即可用 |

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

预期输出：stdout 直接打印模型回答（如「幂等性是指同一操作执行一次与执行多次的效果相同……」），stderr 显示所用 lane 与 token 用量。这一条通了，部署就完成了。

### 第 6 步（可选）：升级为全局安装

想在**任何项目**里都能用（而不只是这个文件夹），并获得 `/wbx` 斜杠命令：

```powershell
node .zcode\skills\wb-bridge\scripts\wbx.mjs self-install --adopt
```

`--adopt` 会把本项目 `.wbx\` 里的凭证迁移到用户级 `~\.wbx\`，之后所有项目共享登录态。新项目里直接 `/wbx <任务描述>` 一键分派。撤销随时可用 `self-uninstall`。

### 给 AI Agent 的部署指引

如果你是收到本仓库链接、替用户部署的 AI Agent，请这样做：

1. **按上面第 0→5 步顺序执行**，不要跳步；每步命令的预期输出就是你的验收标准。
2. **doctor 的每种红灯按第 3 步的处置表处理**；处理完重跑 doctor，直到至少一个 lane 可用。
3. **涉及真人操作的步骤必须停下来叫用户**：第 4 步浏览器扫码、输密码、手机确认等，你不代替用户输入任何账号凭证。把命令跑起来后，明确告诉用户「请在弹出的浏览器里完成登录」，等凭证就绪再继续。
4. **最后用 doctor + 一条 ask 验证**，并向用户汇报：装了哪条 lane、ask 返回了什么、凭证有效期提醒（约 55 天后需重新登录）。
5. 用户没有明确要求时，不要执行 `self-install`（改动用户级配置的事让用户决定）。

## 日常使用速查

以下 `wbx` 均指 `node .zcode\skills\wb-bridge\scripts\wbx.mjs`（全局安装后可直接在任何项目里用）。

| 命令 | 用途 |
|---|---|
| `wbx doctor` | 自检：node/CLI 路径/模板/两 lane 凭证与模型探测 |
| `wbx login [--identity cn\|ai]` | 浏览器登录（默认国内版微信扫码） |
| `wbx ask --file p.txt` 或 `--text "…"` | 单条任务；stdout 出结果，失败自动换 lane |
| `wbx fanout --file tasks.json` | 批量并行（任务文件格式见 [examples](.zcode/skills/wb-bridge/examples/tasks.example.json)） |
| `wbx history --last 10` / `wbx history <jobId>` | 历史列表 / 回放某次任务的完整双向对话 |
| `wbx config list` / `set <key> <value>` | 路由与并发配置（default-lane、disabled-lanes、parallel-per-lane 等） |
| `wbx models` | 探测模型可用性、列出账号下全部模型 |
| `wbx ui` | 本地可视化控制台（浏览器打开 127.0.0.1:7788，Ctrl+C 即退） |
| `wbx self-install --adopt` | 全局安装：任何项目可用 + `/wbx` 斜杠命令 |
| `wbx self-uninstall [--purge]` | 全局卸载一键还原（`--purge` 连凭证一起删） |
| `wbx export-bundle` | 生成零凭证分发包 zip，可发给同事在其他机器安装 |

另外两个入口：ZCode 会话里输入 `/wbx <任务描述>`（全局安装后可用）= 一键分派流程；`wbx ui` = 网页控制台，可视化看两 lane 状态、发起任务、翻历史记录。

**质量与安全提示**：免费算力输出质量有方差，外包结果先校验再使用；worker 无联网能力，「调研」产出是模型已有知识、可能过时；涉密内容绝不外包。完整分派准则与 worker 提示词模板见 [SKILL.md](.zcode/skills/wb-bridge/SKILL.md)，技术细节见 [WBX.md](WBX.md)。

## 常见问题

**真的免费吗？**
`ai` lane（国际版）当前 x0.00，`cn` lane（国内版）x0.03 近免费。这是 WorkBuddy 的产品策略，随时可能调整；桥每次调用都会显示实际用量，发现不再划算就停用。

**多久要重新登录一次？**
国内版 accessToken 约 55 天有效，到期后 doctor 会显示凭证红，重新 `wbx login` 一次即可；国际版有效期更长（数百天级）。

**凭证安全吗？会自动上传吗？**
凭证（accessToken）只存在你本机的 `.wbx\` 或 `~\.wbx\` 文件夹，`.gitignore` 已覆盖，绝不会被提交或上传。桥的所有网络请求只发往 WorkBuddy 官方服务地址。

**支持 macOS / Linux 吗？**
暂不支持，当前为 Windows-only（CLI 路径扫描、进程管理等按 Windows 实现）。

**和 WorkBuddy、智谱是什么关系？**
无关联。这是个人开发的非官方工具：借 WorkBuddy 桌面版自带的 CLI 与其免费模型策略工作，ZCode 只是它服务的 AI 编程助手之一。WorkBuddy 是腾讯系产品，智谱是 ZCode 的开发方，两者均未参与、不知晓本项目。

**会动我电脑上的 WorkBuddy 或其他软件吗？**
不会。桥对 WorkBuddy 桌面版只读（借用 CLI 与配置模板），不写其任何文件、不改系统环境变量、无常驻后台进程（`wbx ui` 是前台进程，关终端即退）。

## 卸载

项目形态删目录即净；全局形态一条命令还原。见 [UNINSTALL.md](UNINSTALL.md)。

## 许可证与声明

[MIT License](LICENSE)。

再次强调：本工具**非官方**，**依赖第三方服务**（WorkBuddy / DeepSeek），其免费与定价策略随时可能变化；它是依附于当前免费窗口的**临时工具**，不再划算时请直接卸载（[UNINSTALL.md](UNINSTALL.md)）。使用本工具产生的任何费用、账号风险由使用者自行承担。
