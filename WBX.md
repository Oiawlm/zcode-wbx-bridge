# WBX — ZCode ↔ 外部算力联动桥（v5.2：三 lane 子代理化高频调度 · cline 免费孪生 · 控制台常开可用）

> **v5.1**：cline lane 默认免费调用 DeepSeek V4.1 Flash（`cline-free/` 免费孪生，计价 $0 实测；
> 限时轮换+每日配额）——v5「CLI 侧无免费模型」结论勘误；免费清单可观测可选
>（`models --as cline --free` / doctor 存在性校验 / UI 下拉）；超额与轮换错误状态机；存量迁移。
> **v5**：三条 lane（WorkBuddy 双 lane + 可选 Cline CLI）、把三个外部 Agent 当作 ZCode 的
> **子代理**高频调用（默认分派/消耗豁免/best-of-N/评审常规化）、提示词知识库
> [PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md) v2（原则 12 条 + 模板 T1–T9 + 经验条目库 + 沉淀闭环）。
> **v4**：定位重写——外包对象从「文本杂活」扩展为**自包含任务**（含代码模块编写），fanout
> `files` 材料拼接、长提示词 stdin 通道。**v3**：job 可观测（ask 也落盘 + `history` 回放）、
> 用户级全局安装、本地 Web UI、分发打包。**v2**：双 lane + 主动分派。卸载见 [UNINSTALL.md](UNINSTALL.md)。
>
> **临时工具声明**：本桥的存在意义是「把合适的子任务并行外包给几乎免费的算力」。当该
> 免费/低价期结束、或账号策略变化导致不再划算时，直接卸载（见 UNINSTALL.md），不要恋战。

## 这是什么

在 ZCode 会话里，把**相互独立、自包含、单轮可完成**的子任务并行分派给外部算力执行。
**自包含**（v4 公理）：任务的全部输入（含代码上下文）可由编排器（ZCode）打包进提示词、
输出可独立校验，即可外包——包括**代码模块编写**（ZCode 负责接口定义、集成与审查）。
v5 把三个外部 Agent（WorkBuddy 国内版 / WorkBuddy AI / Cline）定位为 **ZCode 的子代理**：
几乎免费 → **默认分派**（单个自包含任务也直接派）、材料给足（裁剪只为信噪比）、
关键产物 best-of-N 双份择优、集成前默认过评审批判（T7）。

```
ZCode ──> node wbx.mjs fanout [--lanes ai,cn,cline] ──> 并行 worker 进程
   ai lane  = WorkBuddy AI 国际版（deepseek-v4.1-flash x0.00 免费）
   cn lane  = WorkBuddy 国内版（x0.03 近免费）
   cline    = Cline CLI（可选：cline-free/deepseek-v4.1-flash 免费孪生，thinking=xhigh）
   └─ 结果写 <运行时根>/jobs/<jobId>/（cline 任务另有原始事件流 .cline-stream.jsonl）
```

### 三 lane 与默认路由

| lane | 身份 | endpoint | 默认模型 | 成本 | 凭证 |
|---|---|---|---|---|---|
| `ai` | 国际版 WorkBuddy AI | www.workbuddy.ai | deepseek-v4.1-flash | **x0.00 完全免费** | `.wbx/sessions/ai.json` + `.wbx/product/ai.json` |
| `cn` | 国内版 | copilot.tencent.com | deepseek-v4.1-flash | x0.03 近免费 | `.wbx/sessions/cn.json` + `.wbx/product/cn.json` |
| `cline` | Cline CLI（**可选**） | Cline provider（OAuth） | cline-free/deepseek-v4.1-flash | **免费（cline-free 孪生，限时轮换+每日配额）** | `~/.wbx/cline-home/.cline/data/settings/providers.json`（OAuth，settings.auth.accessToken） |

**默认路由：ai 已登录 → ai（免费），否则 cn；回退链 ai → cn → cline → ZCode 自己做**
（各一次；cline 未装/无凭证直接跳过不耗重试额度；`auto` 下 cline 永远排最后）。

## 运行时布局（v3：两种形态，均 gitignore）

**运行时根解析顺序**：`WBX_HOME` env → `~/.wbx/`（检测到 `~/.zcode/wbx-bridge` 存在即全局形态）→
项目 `.wbx/`（项目形态，v2 现状）。

```
<运行时根>/                       项目形态 = <项目>/.wbx/；全局形态 = ~/.wbx/
  sessions/{ai,cn}.json           # 凭证（含 refreshToken，0600；--adopt 后全局共享）
  product/{ai,cn}.json            # custom-token 产品配置
  config/{ai,cn}/                 # CLI 隔离配置（CODEBUDDY_CONFIG_DIR）
  config.json                     # v3 运行时配置（default-lane / disabled-lanes / parallel-per-lane / model / cli-path）
  jobs/<jobId>/                   # v3 统一 job 模型：manifest.json + tasks-input.json + <id>.json + summary.md
  tasks/<时间戳>/                  # v2 旧 fanout 结果（history 只读兼容展示）
```

job 结构：`manifest.json`（类型/参数/lanes/config 快照/状态）、`tasks-input.json`（发出的完整提示词）、
`<taskId>.json`（回复全文 + lane + 回退路径 + tokens + 尝试次数）、`summary.md`（汇总表）。
v1 的 `.wbx/session.json` + `product-config.json` 会在任意命令运行时自动迁移（v2 行为保留）。

## v3 新能力

### `wbx config`（路由控制权归还用户）

```bash
wbx config list                          # 查看全部（含说明）
wbx config set default-lane cn           # auto（默认，ai 免费优先）| ai | cn —— ask 默认路由、doctor 显示
wbx config set disabled-lanes '["ai"]'   # 硬禁用：doctor 标注「已禁用」、fanout 默认 lanes、回退链跳过；ask --as 拒绝
wbx config set parallel-per-lane 2       # fanout 每 lane 并发
wbx config set cli-path "<CLI 完整路径>\codebuddy"  # CLI 入口（优先级低于 WBX_CLI env；传空串清空）
```

### `wbx history`（可观测 / 审计）

```bash
wbx history [--last 10]          # 表格：时间/类型/任务数/成功率/lane 分布/目录
wbx history <jobId> [--task <id>]  # 完整回放双向对话（PROMPT 全文 + REPLY 全文）
```

兼容只读展示旧 `.wbx/tasks/`（标「旧」）。ask 从 v3 起也落盘为 job。

### `wbx self-install`（任何项目可用）

```bash
wbx self-install --adopt          # 全局安装 + 把项目 .wbx/ 凭证迁移到 ~/.wbx/
wbx self-uninstall [--purge]      # 一键还原（--purge 连 ~/.wbx/ 凭证一起删，默认保留）
```

安装物（仅四处 + 运行时）：`~/.zcode/wbx-bridge/`（桥本体）、`~/.zcode/skills/wb-bridge/SKILL.md`
（用户级 skill，**同名遮蔽项目级**——内容一致，无行为差异）、`~/.zcode/commands/wbx.md`
（`/wbx <任务描述>` 斜杠命令，`skills:` frontmatter 自动挂载 wb-bridge）、`~/.zcode/AGENTS.md`
标记块（指向全局桥绝对路径）、`~/.wbx/` 运行时。装完后本项目桥也统一走 `~/.wbx/`（凭证共享）。
`--adopt` 默认保留项目侧凭证（`--no-keep-project` 迁移后删除，tasks/ 历史始终保留）。

### `wbx ui`（可视化）

```bash
wbx ui [--port 7788]              # 仅监听 127.0.0.1，自动开浏览器，Ctrl+C 即退（无常驻）
```

单页应用（内嵌 HTML/CSS/vanilla JS，零第三方依赖、零外部 CDN，离线可用）：
状态（两 lane 卡片：登录态/账号/成本系数/到期倒计时 + doctor 一键体检 + 路由三态开关 + 禁用开关）、
调用（ask 表单 + fanout 构建器，job 轮询实时进度）、历史（列表 → 完整对话，Markdown 渲染）、
登录（authUrl 可点击 + 锦囊 URL + 轮询状态，登录流在 server 侧跑）。
API 全 JSON：`GET /api/status|/api/doctor?probe=1|/api/history|/api/job/:id`、
`POST /api/ask|/api/fanout|/api/config|/api/login/start`、`GET /api/login/poll`。
**任何响应不含凭证**（只显示昵称/脱敏 uin/到期时间）。

### `wbx doctor` 新机向导 + `wbx export-bundle`（分发）

- doctor 逐步检查：node 版本 → CLI 路径（WBX_CLI → config.cli-path → 扫描
  `%LOCALAPPDATA%\Programs\WorkBuddy*`、`C:\Program Files\*`、`C:\Program Files (x86)\*`、`D:\App\*`；
  单命中自动写入 config，多命中列出并给固定命令）→ 模板缓存（缺失提示「启动一次桌面版」）→
  凭证（缺哪个 lane 给哪条 login 命令）。每步失败一行修复指引。
- `wbx export-bundle [--out <目录|文件.zip>]`（默认桌面）：生成分发 zip（scripts/ + SKILL.md +
  examples/ + docs/ + INSTALL-README.md），**纯 Node 实现 zip（store）**，导出后自检断言零凭证
  （逐成员比对本地所有 accessToken 值）。Windows-only（taskkill/路径扫描特化）。

## 架构（v3 代码布局）

```
.zcode/skills/wb-bridge/
  SKILL.md                    # 触发描述 + 分派准则 + worker 模板（v3 增补命令速查）
  examples/tasks.example.json
  scripts/wbx.mjs             # 薄 CLI 壳：参数解析 + 输出格式化（对外命令行为入口）
  scripts/wbx-core.mjs        # 核心库：路径/lane/config/job/login/doctor（CLI 与 UI 共用）
  scripts/wbx-setup.mjs       # self-install / self-uninstall / export-bundle（含纯 Node zip writer）
  scripts/wbx-ui.mjs          # Web UI：原生 node:http + 内嵌单页前端
```

## 快速开始（v3）

```bash
WBX="node .zcode/skills/wb-bridge/scripts/wbx.mjs"

$WBX doctor                      # 1. 自检；两个 lane 凭证都红才需要登录
$WBX login                       # 2a. 国内版：浏览器微信扫码（默认，最稳）
$WBX login --identity ai         # 2b. 国际版：邮箱/OneID（输出里有 state 修补锦囊 URL）

$WBX ask --file 我的问题.txt               # 单条（默认 ai 优先，失败自动回退 cn；落盘 job）
$WBX fanout --file tasks.json --parallel 2 # 批量并行（结果落 <运行时根>/jobs/<jobId>/）
$WBX history --last 10                    # 看历史
$WBX ui                                   # 可视化控制台（http://127.0.0.1:7788）
$WBX self-install --adopt                 # 全局化：任何项目可用 + /wbx 命令（装过即全局形态）
$WBX export-bundle                        # 生成分发 zip 到桌面（零凭证自检）
```

tasks.json 格式与示例：`.zcode/skills/wb-bridge/examples/tasks.example.json`；任务级 `"as":"ai"|"cn"`
可绑定 lane（缺省进公共队列动态均衡）。worker 提示词模板与任务分派准则：
`.zcode/skills/wb-bridge/SKILL.md`（ZCode 会话自动命中）。

## 认证机制（与规划不同的实测结论）

规划阶段设想的「serve → `/api/v1/auth/login` 拿 SSO URL」在当前版本（5.6.2 / CLI 随包）
**不成立**：该端点实为 serve 网关密码登录，serve REST 里没有账号 SSO 入口。实际采用的方案：

1. **SSO 协议直连**（逆向自桌面版 `external-link-authentication-provider`，已实测）：
   - `POST {endpoint}/v2/plugin/auth/state?platform={platform}`（头 `X-No-Authorization:true` 等 4 个）
     → `{data:{state, authUrl}}`
   - 用户浏览器完成登录（国内版 = 微信扫码，最稳）
   - 轮询 `GET /v2/plugin/auth/token?state=`（pending code 11217）→ `{accessToken, refreshToken, …}`
   - `GET /v2/plugin/login/account?state=`（pending code 12151）→ 账号信息
2. **custom-token 产品配置注入**：把 accessToken 写进 `.wbx/product/<lane>.json` 的
   `authentication = {type:"custom-token", attributes:{…原字段, token}}`，调用时用
   `ACC_PRODUCT_CONFIG_PATH` 指向它。这是 CodeBuddy CLI 官方支持的企业部署认证形态，
   headless 进程因此拿到会话。
3. **token 有效期**：accessToken ≈ **55 天**，refreshToken ≈ 60 天（2026-09-24 实测值）。
   过期后 `doctor` 探测变红，重新 `wbx login` 一次即可。
4. **登录身份选择**：`wbx login --identity cn|ai`，默认 **cn**（微信扫码路径实测可靠）。

### 国际版登录的已知 bug 与锦囊（决策点 1）

- **bug**：国际版网页邮箱/密码登录走 Keycloak iframe + 账号选择页，服务端跳转后 `state` 丢失
  （页面落到 `/login/started?platform=workbuddy-ai&state=` 空 state，显示"登录失败"），token 轮询
  永远 pending。已两次复现。国内版微信扫码流程 state 全程保留，无此问题。
- `wbx login --identity ai` 会在等待轮询的**同时打印可直接复制的修补 URL**（state 已拼好）：
  - **锦囊 A（最优先）**：浏览器登录"失败"后，登录 cookie 其实已建立——把地址栏整体替换为命令
    输出的 `/login/started?platform=workbuddy-ai&state=<本轮uuid>` 再回车，LoginSuccess 组件会
    重跑通知逻辑，很可能直接打通。
  - **锦囊 B**：访问命令输出的 `/login/select?platform=workbuddy-ai&state=<本轮uuid>`
    （SelectAccount 页从 URL query 读 state）重选账号完成通知。
  - **锦囊 C**：用 ZCode 内置浏览器（browser-use 技能，IAB 面板）开登录页，用户自己在面板里
    输邮箱密码（凭证不经过 agent），单一受控标签页内出现失败页时改用锦囊 A 的 URL。
  - A/B/C 均失败 → 如实记录 blocker，双 lane 以「cn 可用 + ai 待打通」状态运行，不阻塞其他功能。

### 产品身份决策（为什么用运行时缓存作模板）

| 配置源 | endpoint | 模型数 | deepseek-v4.1-flash | 结论 |
|---|---|---|---|---|
| CLI 包内静态 product.json（国际版旧快照） | www.workbuddy.ai | 37 | **无** | 不作模板（过时） |
| `~/.workbuddy-ai/cache/`（国际版运行时缓存） | www.workbuddy.ai | 25 | **有**（含 -sg 变体） | ai lane 模板 |
| `~/.workbuddy/cache/`（国内版缓存） | copilot.tencent.com | 51 | **有** | cn lane 模板（当前凭证） |

- **教训**：CLI 包里的 product.json 是发版时的静态快照，桌面版实际用的是服务端下发的运行时配置
  （缓存在各数据目录 `cache/acc-product-config-v3.json`）——判断模型有无必须看运行时缓存。
- `.wbx/product/<lane>.json` = 运行时配置只读复制 + authentication 段替换为 custom-token，
  每次 `wbx login --identity <lane>` 重新生成。
- 桌面版的共享会话文件（`%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\*.info`）
  由 Electron safeStorage 加密，纯 Node 的 CLI 进程解不开（at-rest-failures 记录 missing-key），
  因此**无法直接借用桌面版登录态**，必须自己走一遍 SSO。

## 主动分派体系（v2 新增）

双层触发（均为 ZCode 官方机制，无 hack）：

1. **项目级 `AGENTS.md`**（repo 根，常驻注入）：可用外部算力清单（含成本表）、主动分派时机
   （≥2 独立调研子任务 / 批量文本 / 接口清晰可拆分的代码模块）、回退规则、安全红线。
2. **Skill**（`.zcode/skills/wb-bridge/SKILL.md`）：触发描述覆盖自然意图（调研多对象、收集参考、
   批量生成、任务可拆分并行），不要求用户明说「外包/并行」；保留分派准则与 worker 提示词模板。
3. **用户级全局块（可选，默认不装——决策点 3）**：
   `wbx install-user` 向 `~/.zcode/AGENTS.md` 注入 `<!-- wbx:begin -->…<!-- wbx:end -->` 标记块，
   让**所有项目**的会话都能主动分派（绝对路径调用本桥）；`wbx uninstall-user` 一键移除。
   - 利：任何项目里说「帮我调研 A、B、C」即可自动并行分派；
   - 弊：所有会话常驻多一段指令（上下文开销），且其他项目的任务会被送到本机这个固定桥上；
   - 默认不安装，由用户权衡后自行运行 `wbx install-user`。

## 已验证事实摘要（2026-09-24 实测）

- CLI 入口：`<WorkBuddy 安装目录>\resources\app.asar.unpacked\cli\bin\codebuddy`（Node 脚本，node ≥18.20.8）
- headless 必需环境变量：`CODEBUDDY_CONFIG_DIR`（隔离目录）+ `CODEBUDDY_FORCE_HEADLESS_BUNDLE=1`（缺它报 `Cannot find module '../dist/codebuddy'`）
- 纯 LLM 模式：`--tools ""`；结构化输出：`--output-format json`；一次性：`--no-session-persistence --max-turns 1`
- `--output-format json` 实际输出 JSON 数组 [userMsg, assistantMsg, resultObj]，解析取 `type==="result"` 元素
- `deepseek-v4.1-flash`：1M 上下文 / 128k 输出，支持 reasoning（`--effort minimal…max`）
- serve REST（`--serve`）可用 `/api/openapi.json` 拉全量路由表（本桥未用，备查）
- Windows 注意：spawn 一律数组传参；taskkill 需等待完成再退出，否则 libuv 断言崩溃

## 命令参考（v3）

| 命令 | 说明 |
|---|---|
| `wbx doctor [--no-probe]` | 自检向导：node / CLI（自动扫描+写回）/ 模板缓存 / 两 lane 凭证+模型探测；exit 0 = 至少一个 lane 可用 |
| `wbx login [--identity cn\|ai] [--wait 300] [--no-open] [--force]` | SSO 登录（默认 cn 微信扫码；ai 输出 state 修补锦囊 URL） |
| `wbx ask --file p.txt \| --text "…" [--as ai\|cn] [--model M] [--effort low] [--timeout 300] [--json]` | 单次调用（落盘 job）；默认路由按 config；失败自动回退另一 lane；stdout=结果、stderr=lane/用量 |
| `wbx fanout --file t.json [--lanes ai,cn] [--parallel 2] [--timeout 300] [--retry 1]` | 双 lane 并发池（落盘 job）；`--parallel`=每 lane 并发（默认取 config）；任务级 `as` 可绑定 lane、`files:[路径]` 拼材料（v4）；summary.md 标注 lane 与 `ai→cn` 回退 |
| `wbx models [--as cn\|ai] [--probe "id1,id2"]` | 探测模型 + 列产品配置全部模型 |
| `wbx config list\|get <key>\|set <key> <value>` | 运行时配置：default-lane / disabled-lanes / parallel-per-lane / model / cli-path |
| `wbx history [--last N]` / `wbx history <jobId> [--task <id>]` | 历史列表 / 完整回放双向对话（含旧 tasks/ 与项目形态时期 jobs/ 只读兼容） |
| `wbx ui [--port 7788] [--no-open]` | 本地 Web UI（仅 127.0.0.1；状态/路由/ask/fanout/历史/登录） |
| `wbx self-install [--adopt] [--no-keep-project]` | 用户级全局安装（四处 + ~/.wbx/ 运行时；--adopt 迁移项目凭证） |
| `wbx self-uninstall [--purge]` | 全局卸载一键还原（--purge 连凭证删，默认保留） |
| `wbx export-bundle [--out <目录\|.zip>]` | 分发 zip（默认桌面；零凭证自检断言；含 INSTALL-README.md） |
| `wbx install-user` / `wbx uninstall-user` | v2 兼容：仅注入/移除 `~/.zcode/AGENTS.md` 标记块 |

环境变量（可选覆盖）：`WBX_HOME`（运行时根）、`WBX_CLI`（CLI 路径，优先于 config）、`WBX_MODEL`、`WBX_PROJECT_ROOT`、`WBX_PRODUCT_CONFIG`（login 模板）。

## 故障排查

| 症状 | 处置 |
|---|---|
| doctor「cli」红 | App 升级挪了 CLI → 找到新路径，调用时设 `WBX_CLI=<新路径>` |
| doctor 某 lane「凭证」[SKIP] | 未登录 → `wbx login --identity <lane>`；凭证红 = token 过期（约 55 天）→ 重新 login |
| ask/fanout 报 429/quota/限流 | 免费额度或限流 → 降并发（`--parallel 1`）、稍后再试；仍不行则放弃外包 |
| fanout 大量 timeout | 网络/服务波动 → 提高 `--timeout` 或减小并发 |
| 单任务提示词超长 | v4 起 >12k 字符自动走 stdin 通道（实测 60k+ 字符可用），无命令行长度限制；材料仍建议按 20k 裁剪准则控制成本 |
| 模型输出质量差 | 检查 worker 提示词是否给了硬输出约束；必要时 `--effort medium` |
| 国际版 login 永远 pending | state 丢失 bug → 用命令输出里的锦囊 A/B URL；详见上文「国际版登录的已知 bug 与锦囊」 |
| `Cannot find module ...wbx.mjs` | 命令用了相对路径但当前目录不在项目根 → 先 `cd /d "<项目根目录>"` 再运行，或用绝对路径：`node "<项目根目录>\.zcode\skills\wb-bridge\scripts\wbx.mjs" <子命令>`（路径含空格必须加引号） |
| 项目路径含非 ASCII（如中文）时 Git Bash 报模块加载/编码错误 | 改用全局桥入口（ASCII 路径）：`node "C:\Users\<用户名>\.zcode\wbx-bridge\scripts\wbx.mjs" <子命令>`（装过 self-install 即有；v4 实测记录） |

## 风险与边界

- **额度共用**：桥与桌面版 WorkBuddy 同账号，保守并发（每 lane 默认 2，限流降 1）。
- **凭证安全**：`.wbx/sessions/*.json` / `.wbx/product/*.json` 含 accessToken，已被根目录
  `.gitignore` 覆盖；不要把内容贴进任何文档或日志。
- **token 生命周期**：accessToken 有 expiresIn；过期后 doctor 探测会红，重新 login 即可
  （refreshToken 已留存，自动刷新列为后续待办）。
- **升级脆弱性**：CLI 路径与 SSO 协议随 App 版本变化，doctor 是第一道防线。

## 卸载（一键）

见 [UNINSTALL.md](UNINSTALL.md)（v2：覆盖 sessions/product 新路径、项目 AGENTS.md、
用户级标记块等全部新增物）。

## 附录：实测记录

### v1 记录（2026-09-24，单 lane 时期）

- 登录：国内版微信扫码，登录你的 WorkBuddy 账号即可；accessToken ≈ 55 天、refreshToken ≈ 60 天。
- doctor 全绿；`ask`（「解释幂等性」）成功；fanout 3 并发 3/3 成功。
- fanout 3 并发 × 6 任务两轮：**6/6 成功、13.9s、零限流**，tokens in/out = 40014/701。
- 单次调用成本：credit 0.01（系数 x0.03），prompt 约 6.5k tokens（CLI 自带 memory 系统提示，~6.4k 命中缓存）。

### v2 记录（2026-09-24，双 lane 改造）

- **迁移**：首次运行任意命令自动迁移 v1 凭证 → `sessions/cn.json` + `product/cn.json`，旧文件删除，打印 `[MIGRATE]` 提示。
- **doctor 双 lane**：ai lane 未登录显示 `[SKIP] 凭证`（带 login 指引，不崩溃、不影响 exit 0）；
  cn lane 全绿（模型探测 19.6s，tokens 6527/2）。
- **ask --as cn**（中文单条）：成功，4.8s，tokens 6527/36。
- **fanout 4 任务（cn lane，每 lane 并发 2）**：3 个软件动效调研 + 1 个日志结构化抽取，
  **4/4 成功、17.6s、零重试**；summary.md lane 列正确；JSON 抽取零误差
  （`[{"path":"/api/items","ms":34},…]` 与材料完全一致）。
- **install-user / uninstall-user round-trip**：注入标记块（21 行）→ 卸载后文件为空自动删除，还原干净。
- **国际版 lane**：见下节。

### 国际版（ai）lane 实测

- **打通 ✅（2026-09-24 20:33）**：`wbx login --identity ai` 第二轮成功——浏览器打开 authUrl、
  用户完成邮箱/OneID 登录后 token 轮询即拿到凭证，
  凭证落 `.wbx/sessions/ai.json` + `.wbx/product/ai.json`。
- **过程记录（决策点 1 补充）**：第一轮（20:10 启动）900s 窗口内无浏览器侧操作而超时（用户不在场，
  非机制失败）。第二轮用户在场后登录一次成功；**未再复现**此前两次记录的「state 丢失→登录失败」
  页面，故本轮无法确认是原生流程直接成功、还是用户按指引用了锦囊 A 修补 URL——两种路径命令输出
  均已支持（login 会实时打印当轮 state 拼好的锦囊 A/B URL）。下次若再遇「登录失败」页，直接复制
  命令输出里的锦囊 A URL 到地址栏回车即可。
- **登录后验证（全部通过）**：
  - `doctor` **双 lane 全绿**：ai 模型探测 11.2s（tokens 7565/2）、cn 探测 5.3s。
  - `ask --as ai`（中文单条）：成功，10.5s，tokens 7565/70——**国际版 deepseek-v4.1-flash
    x0.00 免费**（成本为 0，验收标准 3 达成）。
  - `fanout --lanes ai,cn`（4 任务，每 lane 并发 2 = 总并发 4）：**4/4 成功、14.6s、零重试**；
    公共队列动态均衡分派（2 任务落 ai、2 任务落 cn），summary.md lane 列正确
    （结果：`.wbx/tasks/20260924-203312/`）。

### 主动分派端到端测试（新会话）

验证话术（不出现「外包/并行/wbx」字样）：

> 帮我调研 Linear、Raycast、Arc 三款软件的加载动效，给我对比

预期行为：新会话读到项目 AGENTS.md + 命中 wb-bridge Skill → `doctor` 自检 → 生成 3 个
调研 worker 任务（带来源要求、无工具声明）→ `fanout` 分派 → 读 summary.md 与各结果 JSON →
**校验后**汇总对比给用户（标注信息来自模型已有知识、可能过时）。
若要在**其他项目**也生效，需先 `wbx install-user`（用户级 AGENTS.md 标记块）。

### v3 记录（2026-09-24 晚，可观测 + 全局化 + 可视化 + 可分发）

全部实测通过，逐项对应 v3 验收标准：

- **Phase 1（核心重构）**：`wbx.mjs` 拆为薄壳 + `wbx-core.mjs`（CLI/UI 共用 lib）+
  `wbx-setup.mjs`（安装/打包）+ `wbx-ui.mjs`（UI）；v2 全部命令与参数无回退（doctor/login/
  ask/fanout/models/install-user/uninstall-user 实测一致，models 探测 5.1s 通过、install-user
  round-trip 还原干净）。
- **config 全链路实效**：`config set default-lane cn` 后无 `--as` 的 ask 实际走 cn（8.8s，
  7562/2 tokens）；`disabled-lanes ["ai"]` 后 doctor 标注「已禁用、路由/回退链跳过」、
  `ask --as ai` 被硬禁用拒绝（exit 1 + 修复指引）、fanout 默认 lanes 只剩 cn（2/2 成功）；
  恢复 `[]` 后双 lane 恢复。config 值快照写入每次 job 的 manifest.json。
- **ask 落盘 + history 回放**：ask 生成 `jobs/<时间戳>-<rand>/`（manifest + tasks-input +
  记录 + summary）；`history --last 10` 列出新 job、项目形态时期的 jobs、v2 旧 tasks（共 8 条，
  旧条目标「旧」，v1 无 lane 字段的显示 `?`）；`history <jobId> --task <id>` 完整回放
  prompt 全文 + 回复全文（含旧 job 20260924-203312 的 survey-arc 双向对话）。
- **Phase 2（全局化）**：`self-install --adopt` 一次完成五处安装物 + 凭证迁移（ai、cn 均迁入
  `~/.wbx/`，项目侧默认保留；重复运行幂等——「目标已存在，跳过」）。
  **在无关目录**（`%TEMP%\wbx-unrelated-test`）运行全局桥：doctor 全局形态通过、ask 走 ai
  成功（10.0s），凭证来自 `~/.wbx/`。`self-uninstall` 后四处全局位置零残留
  （wbx-bridge/、skills/wb-bridge/、commands/wbx.md、AGENTS.md 连空文件删除），
  `~/.wbx/` 凭证保留（--purge 才删）；卸载后项目桥自动回退项目形态（运行时根变回项目 .wbx）。
  装回后项目桥 history 同时显示全局 jobs + 项目 jobs + 项目 tasks。
- **/wbx 斜杠命令**：`~/.zcode/commands/wbx.md` 就位（frontmatter 单行平铺键：description /
  argument-hint / skills: wb-bridge；正文 $ARGUMENTS 注入 + 引导 doctor → 分派 → 校验 → 汇总），
  命令正文引用的全局桥调用链（doctor/ask）已在无关目录实测走通。交互式新会话里输入
  `/wbx <任务>` 的最终确认留给用户（本执行窗口无法开第二个 ZCode 会话）。
- **Phase 3（UI）**：`wbx ui` 启动 → 自动开浏览器 → 四 tab 全部实测：
  - 状态：两 lane 卡片（昵称/成本/到期倒计时/endpoint/模板）、路由三态
    开关（POST /api/config 写入后 status 立即反映）、禁用开关、doctor 一键体检；
  - 调用：UI 发起 ask（ai 成功返回 "OK"）与 fanout（2 任务：auto→ai、绑定 cn，2/2 成功），
    1s 轮询进度（brief 模式）→ 完成后展示全文结果；
  - 历史：11 条 job 列表 → 点开完整对话（PROMPT 折叠 + REPLY Markdown 渲染）；
  - 登录：POST /api/login/start 返回 authUrl（可点击）+ 轮询 pending 状态正常；
  - **零凭证**：对 `/`、`/api/status`、`/api/history`、`/api/login/poll`、`/api/job/:id`
    五类响应逐字节比对本地 8 个 accessToken 值——零命中；响应中无 accessToken/refreshToken 字样；
  - 浏览器实际渲染验证（ZCode 内置浏览器）：状态页布局/卡片信息/路由控件无视觉缺陷，
    前端 JS 语法与运行时均正常；Ctrl+C（进程终止）即退出，无常驻。
- **Phase 4（分发）**：doctor 向导——config 指向不存在路径时触发扫描，一台装有两个 WorkBuddy
  的机器可扫出两个 CLI 入口（国际版与国内版安装目录）→ 列出并提示固定命令（单命中路径自动写入 config）；
  新机模拟（`WBX_HOME` 指向空目录 + 解包的 bundle）：无凭证 → 每 lane 给出 login 命令指引、
  exit 1、运行时目录自动创建。`export-bundle` 生成 176KB zip（11 文件，含 INSTALL-README.md），
  PowerShell Expand-Archive 解包结构完整；**零凭证断言通过**（逐成员比对 8 个 accessToken 值）；
  按 INSTALL-README 在干净目录模拟安装：根入口 `node wbx.mjs self-install` 成功 → doctor 双 lane 绿
  （真实异机由用户自测）。
- **遗留小项**：v2 `.wbx/tasks/` 与项目形态 `.wbx/jobs/` 为只读历史保留（不迁移不删除）；
  UI 的 fanout 构建、历史翻页为当前单页实现，超大量 job 时性能未做优化（本地场景够用）。

## v4 章：能力外包（定位重写 + 提示词工程 + 代码任务分派）

### v4 定位变更说明

v1–v3 的对外口径把外包范围限定为「翻译/摘要/调研这类文本杂活」，这低估了 deepseek-v4.1-flash
的实际能力。v4 定案（用户决策）：**该模型本身能力很强，可以承担包括编写代码模块在内的一切
适合外包的工作**。v4 不换模型、不加模型分档、不动成本结构，改的是三件事：

1. **公理升级**：外包判定从「轻量文本活」改为「**自包含任务**」——全部输入（含代码上下文）
   可由编排器打包进提示词、输出可独立校验，即可外包。worker 无工具的安全边界不变，
   「让它读文件」的正确实现 = ZCode 先读文件、把内容贴进提示词材料区（材料先行）。
2. **提示词工程体系**：新增 [PROMPTS.md](.zcode/skills/wb-bridge/PROMPTS.md)（入库发布物，
   由 SKILL.md 引用），核心是代码模块编写模板（接口契约 + 材料区 + 硬输出约束），
   并升级翻译/摘要/调研/结构化抽取/文案变体五个既有模板。
3. **分派准则重写**：AGENTS.md/SKILL.md 的「适合分派」加入**代码实现环节**（一段工作拆成
   接口清晰的模块，其中无上下文依赖的部分外包，ZCode 负责接口定义、集成与审查）；
   「不适合」从「多轮依赖上下文的编码任务」改为「需要探索式多轮交互的任务」。
   铁律全部保留：派发结果不派发步骤、每文件单一写者、材料先行、结果必校验、
   连续 ≥2 失败或限流即停止外包。

### 调研记录（2026-09-24，Phase 0 实测）

**lane 健康度**：`wbx models` 双 lane `deepseek-v4.1-flash` 探测均可用——ai 13.2s（tokens 6503/2）、
cn 5.4s。不换模型，仅确认健康。

**调研 A：DeepSeek 官方提示词指南/提示库**（真实 URL 已核实）：

| 资源 | URL | 要点 |
|---|---|---|
| 官方提示库（中文） | https://api-docs.deepseek.com/zh-cn/prompt-library | 13 个条目：代码生成、代码解释、代码改写、内容分类、结构化输出、中英翻译专家、角色扮演×2、散文/诗歌、文案大纲、宣传标语、模型提示词生成 |
| 思考模式指南 | https://api-docs.deepseek.com/zh-cn/guides/thinking_mode | 思考默认开、effort 默认 high；档位 minimal…max；思维链经 `reasoning_content` 返回，不进上下文；复杂推理开思考、简单任务关（省时） |
| JSON 输出指南 | https://api-docs.deepseek.com/zh-cn/guides/json_mode | prompt 里必须含 "json" 字样并给出目标 JSON 格式样例；防截断需合理 max_tokens |
| WorkBuddy/CodeBuddy 集成页 | https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/workbuddy | 官方将 WorkBuddy/CodeBuddy 列为第三方 Agent 工具（经 API 接入），与本项目认知一致 |
| 文档站全量页清单 | https://api-docs.deepseek.com/sitemap.xml | 当前官方文档已无独立「提示工程」指南页，提示库为主要官方样例来源 |

官方样例对本桥模板的直接启发（PROMPTS.md 已吸收）：

- **代码生成**条目：官方 USER 提示词就是一句直接的任务指令（「请帮我用 HTML 生成一个五子棋游戏，
  所有代码都保存在一个 HTML 中」）——直接说清产物形态与边界，不绕弯；
  样例输出为带语言围栏的完整代码 + 代码说明。
- **结构化输出**条目：SYSTEM 里给完整 JSON 骨架 + 每字段一行语义说明（「没有请填 null」）——
  与本桥「输出 JSON 对象、不确定用 UNKNOWN/null 占位」的硬约束写法一致，v4 模板保留字段级说明。
- **中英翻译专家**条目：角色定义 + 信达雅标准 + 「调整语气和风格、考虑文化内涵」——
  v4 翻译模板吸收信达雅表述。
- **json_mode 指南**：提示词里必须出现 "json" 字样并给格式样例——本桥 JSON 抽取模板
  的样例骨架写法有官方依据。

**调研 B：CodeBuddy CLI 能力边界**（本机 CLI `--help` 原文 + 实测；codebuddy.ai 文档站
在本网络下 WebFetch/IAB 均超时或空白，未能引用其页面，以下以本地 CLI 的自述帮助为准）：

| 问题 | 结论 | 证据 |
|---|---|---|
| `-p` 支持文件/stdin 提示词？ | **支持 stdin**：`-p` 不带位置参数时从 stdin 读提示词。实测 60,159 字符提示词（≈40.9k input tokens）经 stdin 成功返回（13.1s，ai lane，答案正确）；无 `--prompt-file` 类选项（只有 system prompt 有 `--system-prompt-file`） | `--input-format`（text/stream-json，仅 --print 模式）+ 两组实测 |
| `--tools` 只读子集？ | 存在：`""` 全关 / `"default"` 全开 / 逗号分隔白名单（如 `"Read"`）。**仅评估不启用**——本桥安全边界 = worker 零工具（`--tools ""`）不变；开放只读工具会让 worker 触到用户文件系统，收益（省贴材料）不抵边界后撤 | CLI `--help` 原文：`Restrict which built-in tools ... Use "" to disable all, "default" for all, or comma-separated tool names like "Bash,Edit,Read"` |
| `--effort` 档位语义 | `minimal / low / medium / high / xhigh / max` 六档；官方 thinking 指南说明 effort 默认 high、思考模式适合复杂推理、简单任务可调低省时 | CLI `--help` 原文 + DeepSeek thinking_mode 指南 |

### 桥改动决策（Phase 2 白名单，实施前记录理由）

v4 原则：`scripts/*.mjs` 零改动，仅允许以下两处小改（均为「明确收益且小改动」才做）：

1. **fanout 任务级 `files` 字段**（改 `wbx.mjs` cmdFanout，≈14 行）——理由：代码外包的
   材料先行场景里，ZCode 已把相关文件路径写进 tasks.json 更自然（`"files": ["src/api.ts"]`），
   桥读文件按「文件开始/结束」段落拼进提示词材料区，省去 ZCode 手工拼串；
   相对路径基于 tasks.json 所在目录（与既有 `file` 字段一致）。
2. **长提示词 stdin 通道**（改 `wbx-core.mjs` spawnNode/askOnce，≈14 行）——理由：调研 B
   实测 stdin 可传 60k+ 字符；v3 的 ~25k 命令行长度上限使「贴完整代码上下文」经常被迫裁剪。
   实现：提示词 > 12000 字符时改走 stdin（`-p` 无位置参数 + stdin 写入），≤ 12000 保持
   v3 位置参数路径**逐字节不变**——既有行为零回退，仅解锁原先会失败的超长任务。

未做（不满足「明确收益且小改动」）：`--tools` 只读子集接入（安全边界不变原则）、
UI 侧 `files` 支持（UI 会话无 tasks.json 目录语境，先 CLI-only）。

**配套机械改动**（非行为变更，随上述两项一并实施并记录）：`wbx-setup.mjs` 的
self-install / export-bundle / `/wbx` 命令模板纳入 PROMPTS.md（否则全局形态与分发包缺新发布物，
v4 验收标准 5 无法达成）与 /wbx 适用判定的 v4 措辞；`WBX_VERSION` 3.0.0 → 4.0.0；
ask 的「接近命令行上限」警告改为「超 12k 自动走 stdin」提示（原警告针对已解除的限制，属过时文案）。

### v4 回归测试（2026-09-25，改桥后全命令）

| 项 | 结果 |
|---|---|
| 4 个脚本 `node --check` | 通过 |
| `doctor --no-probe` / `doctor` | 双 lane 凭证绿，版本 v4.0.0 |
| `models`（ai/cn 探测） | 均可用（Phase 0 实测 13.2s / 5.4s） |
| `ask` 短提示词（v3 位置参数路径） | OK 11.1s（tokens 6504/2） |
| `ask` 30,476 字符（新 stdin 路径） | OK 33.2s（tokens 25012/15），答案正确 |
| `fanout` 2 任务（含 `files` 字段拼接） | 2/2 成功；材料按「文件开始/结束」段落拼入 tasks-input.json，模型据材料答对 |
| `config set/get` 回环（default-lane cn→auto） | 通过 |
| `history --last` / `history <jobId> --task` | 列表与双向回放正常（含 files 拼接后的完整 prompt） |
| `export-bundle` | 11 文件（新增 PROMPTS.md），零凭证断言通过 |
| `ui` 冒烟（/api/status、/api/history） | 正常（版本 4.0.0，全局形态识别正确） |

### v4 记录（实测附录）

**Phase 5.1 demo 端到端（2026-09-25，真实代码外包）**

demo 项目 `%TEMP%\wbx-v4-demo\`（不入库）：日志统计小工具 logsum 拆 5 模块——
ZCode 写接口契约（CONTRACT.md）+ 风格样例（lib/slugify.js）+ 编排层
（lib/summarize.js 聚合、cli.js IO）；3 个纯函数模块用 PROMPTS.md T1 模板外包：

| 任务 | lane | 材料方式 | 耗时 | tokens in/out | 尝试 |
|---|---|---|---|---|---|
| mod-parse-duration | ai | 提示词内联材料 | 16.1s | 6947/1442 | 1 |
| mod-format-bytes | cn | **`files` 字段**（桥拼 slugify.js + CONTRACT.md） | 12.5s | 7461/1817 | 1 |
| mod-parse-log-line | ai | **`files` 字段** | 15.7s | 7461/1239 | 1 |

fanout 3/3 成功（并行墙钟 ≈16s），tokens 合计 21869/4498，零重试零回退。

**质量评估（审查发现与修复）**：三份产物**零返工**——风格与样例一致（use strict/JSDoc/双引号/
2 空格）、契约验收标准逐条通过、无编造 API。亮点：worker 对契约未覆盖的行为不猜不编，
全部用 `// TODO(原因)` 显式标注（空白字符处理、Infinity、TB 封顶、日期取值合法性、空 message），
正是 T1 模板「不确定处 TODO 占位、绝不编造」的预期行为。集成即通过：test.js 断言
（外包 3 模块契约验收 19 条 + ZCode 模块 2 条 + CLI 端到端 3 条）全过，`node cli.js sample.log`
输出正确（有效行 7/8、ERROR=2、错误样例）。**结论：接口契约 + 材料先行 + 硬输出约束的
组合下，flash 的代码模块一次成活率高，v4 定位（能力外包）成立。**

**Phase 5.2 主动分派验证（2026-09-25 实测通过）**

触发面五处静态核验含 v4 代码意图（`编写或并行编写代码模块/纯函数/组件/测试用例`、`代码实现环节`）：
项目 AGENTS.md「代码实现环节」条目、项目级 SKILL.md frontmatter、用户级 skill（实际生效、
遮蔽项目级）frontmatter、用户级 skill 目录 PROMPTS.md、`/wbx` 命令模板 v4 判定。

**行为实测**（验收标准 2）：本机 ZCode 桌面版无 headless CLI 可开字面意义的第二个窗口，故用
**全新上下文的 fresh 子代理实例**模拟新会话——输入只有用户话术（不含 wbx/外包/模板字样）：
「帮我写一个密码强度检查的命令行小工具，能并行的部分就并行」，行为完全由 harness 注入的
AGENTS.md 常驻规则与 wb-bridge skill 触发面驱动。结果：**自动触发全流程**——`doctor` 双 lane
全绿 → 子代理自行定义 5 个规则模块的统一契约 → 按 PROMPTS.md T1 模板构造提示词 → `fanout`
分派（job `20260925-002224-ft7`：5 任务、effort medium、**5/5 成功、ai×3+cn×2 真双 lane 并行、
65.4s、tokens 37801/29687**）→ 集成校验。执行窗口独立复核：5 份 tasks-input.json 全部具备
T1 结构特征（接口契约/无工具声明/输出要求）；交付物 `pwcheck`（CLI + 评分聚合为子代理自写、
5 个规则模块外包）33/33 测试复跑通过、CLI 退出码行为正确。产物在
`%TEMP%\wbx-v4-verify\`（不入库）。

**佐证**（同日 00:15，独立于本验收）：另一会话经全局桥发起 job `20260925-001458-1um`
（C# MSTest 测试起草 + 文案任务，T1 形态提示词，2/2 成功）——v4 代码外包模式已被本验收之外的
真实使用自然触发。

**实测发现的使用注意**：项目文件夹路径含非 ASCII 字符（如本项目「agent联动」）时，Git Bash
里以相对/绝对路径传参给项目内 `wbx.mjs` 偶发 Node 模块加载编码错误——改用全局桥入口
`~/.zcode/wbx-bridge/scripts/wbx.mjs`（ASCII 路径）即可绕开，功能一致（WBX.md 故障排查表
「Cannot find module」条目同源，此处补记现象与绕法）。

字面意义的「新开桌面窗口」人工确认仍可由用户随时复测（话术同上），机制面已经上述行为实测覆盖。

**全局形态同步（Phase 3.3）**

`self-install` 幂等重跑两次（中途更新用户块模板后再跑一次）：`~/.zcode/wbx-bridge/`
v4.0.0（scripts + examples + PROMPTS.md + docs）、用户级 skill SKILL.md + PROMPTS.md、
`/wbx` 命令 v4 文案、`~/.zcode/AGENTS.md` 标记块刷新为 v4 公理（自包含、含代码实现时机）、
`~/.wbx/` 凭证原样未动（ai/cn 双绿）。清理了一个 v3 时期遗留的过时 PLAN.md 全局副本
（现项目内 PLAN.md 已移入 internal/，不再随装）。

## v5 章：三 lane（+Cline CLI）· 子代理化高频调度 · 提示词知识库

### v5 定位变更说明

v4 已解决「能不能外包、怎么外包」。v5 定案（用户决策）解决三件事：

1. **第三条 lane（Cline CLI）**：独立于 WorkBuddy 的上游，同源限流/停服时多一份真实冗余；
   调用参数定案 `--thinking xhigh --compaction off`（上下文与思考强度默认拉满，任务级 effort 不下调）。
2. **提示词知识库（PROMPTS.md v2）**：把「每次派发现场手写提示词」的经验沉淀为可复用知识
   （原则 12 条 + 模板 T1–T9 + 经验条目库 E-xxx 带来源 + 沉淀闭环 + 决策速查表）。
3. **子代理化高频调度**：三个外部 Agent = ZCode 的子代理——「放开用」而非「省着用」：
   默认分派（单个自包含任务也直接派）、消耗豁免（裁剪只为信噪比）、关键产物 best-of-N
   双份择优（T8）、集成前默认评审批判（T7）。**不是**开启外部 Agent 自身的 agentic 模式
   （用户定案：那「是另一回事」，v5 明确不做——不使用 `--yolo`/`--zen`，桥不加 agentic 配置键）。

### 调研记录（Phase 0 实测，2026-09-25，cline 3.0.65 / Node v24.19.0 / Windows 11）

策划期核实材料与来源 URL 见 `internal/RESEARCH-V5.md`（本节只记执行窗口实测结论）。
关键来源：Cline CLI 官方 README（github.com/cline/cline 的 apps/cli）、先例项目
tm-henningnt/cline-plugin-cc（验证 3.0.37/3.0.40）、r/CLine 免费模型帖
（reddit.com/r/CLine/comments/1vdczm5）、DeepSeek 官方文档（api-docs.deepseek.com）。

| # | 事项 | 实测结论 |
|---|---|---|
| 1 | 安装 | `npm install -g cline` → 3.0.65；postinstall 被 npm allow-scripts 拦截但平台包 `@cline/cli-windows-x64/bin/cline.exe`（Bun 编译，144MB）随依赖就位，桥直接 spawn 该 exe（launcher `bin/cline` 亦可用） |
| 2 | 无凭证行为 | 非交互运行约 1s 快速失败（exit 1），事件流含 `type:"error"` + `finishReason:"error"` 的 `run_result`，stderr 另有一行 JSON error——回退链直接跳过，不耗重试 |
| 3 | OAuth 登录 | `cline auth cline` 设备码流（打印 code + authkit.cline.bot URL，轮询等确认）。**浏览器有活跃 WorkOS 会话时新码自动批准（零点击复登实测两次）**。凭证形态：`providers.<id>.settings.auth.{accessToken,refreshToken,expiresAt}`（tokenSource=oauth；**不是** apiKey 字段） |
| 4 | `--data-dir` 之坑 | **3.0.65 上不可用于本场景**：①放在 `auth` 子命令前被忽略——凭证误落默认 `~/.cline`（先例 3.0.37/3.0.40 可用的写法已变，升级脆弱性实锤）；②运行时带 `--data-dir` 认证加载被破坏——同一凭证同一路径，不带 flag 可用、带 flag 即 401（疑其自动启用的沙箱；CLINE_SANDBOX=0/CLINE_DISABLE_SANDBOX=1/CLINE_NO_SANDBOX=1 均无效） |
| 5 | `--config` 之坑 | `cline auth cline --config <隔离根>` 非交互直接 exit 1 不等待，不可用 |
| 6 | 隔离正解 | **HOME/USERPROFILE 覆盖**：spawn 时注入 `USERPROFILE=HOME=<运行时根>/cline-home`（并删 HOMEDRIVE/HOMEPATH 防拼接干扰），cline 解析的 `~/.cline` 整体落在桥目录——凭证、db、日志、会话全部隔离，比官方 flag 更彻底；登录后端到端实测通过 |
| 7 | stdin 之坑 | cline 总会检查 stdin（支持 `cat file \| cline`）：异步 spawn 若不 `stdin.end()`，进程等 EOF 永久悬挂（spawnSync 因立即关管道而正常）——桥已在 spawnBin 统一「无数据也立即 EOF」 |
| 8 | stdin 通道 | 长提示词 pipe 全文 + 短位置参数指令（"Complete the task described in the piped stdin content…"）实测可用：桥内 `ask --as cline` 21,979 字符（20,370 input tokens）7.4s 正确作答——沿用 v4 的 >12k 走 stdin 规则 |
| 9 | 参数怪癖 | 位置参数提示词**至少含一个 ASCII 空格**：无空格短中文（如「回复OK」）被当未知子命令拒绝（"Unknown command or unquoted prompt"）；含空格即正常。真实 worker 提示词天然满足 |
| 10 | NDJSON 事件全集 | `hook_event`(agent_start/agent_error)、`agent_event`(iteration_start/end、content_start/end——正文与 **reasoning 思考块**（`contentType:"reasoning"`）、error)、`run_result`(finishReason completed/error、**text=最终答案**、usage{inputTokens,outputTokens,cacheRead,cacheWrite,totalCost}、model.id、durationMs)、usage/effort/done/toggle。**解析取 run_result 即可，增量 event.text 仅回退**；无先例所述 `cline-run:` 尾行 |
| 11 | 纯文本端点 | `--auto-approve false` 下全流无任何工具执行事件（流中 "tool" 字样仅为 reasoning 文本提到"我无工具"） |
| 12 | thinking/compaction | `--thinking xhigh --compaction off` 被接受且生效（run_start 事件可见 thinking:on；compaction off） |
| 13 | 模型 id 与费用 | 格式 `vendor/model`；模型目录 API 实测可得（`GET api.cline.bot/api/v1/models`，Bearer OAuth token，全量 460 个模型）。**「免费」终版结论（2026-09-25 追加实测）**：Cline App 内标 "(free)" 的模型（如 DeepSeek V4.1 Flash / MiMo-V2.6-Flash / Space Bunny Alpha）经 CLI 调用时**并非全部零成本**——`stealth/space-bunny-alpha` 实测 totalCost=0（目录级真免费，1M 上下文）；`deepseek/deepseek-v4.1-flash`（已设默认，$0.0008-0.001/次）与 `xiaomi/mimo-v2.6-flash`（$0.001/次）均按量计费；`~deepseek/deepseek-flash-latest` 等自托管变体亦计费（$0.0008/次）。CLI 二进制内含 `FreeModelLimitResetTime`/`CreditsRequired` 字样（免费组+每日额度机制存在），但 App 的 free 标签与 CLI 计价不同源。**找免费模型的办法**：`wbx models --as cline --probe "vendor/model,..."`（v5 起显示每次探测的计价，$0 即免费）；想全免费可 `config set cline-model "stealth/space-bunny-alpha"`。**【勘误（v5.1，2026-09-25）】：本条「CLI 侧 DeepSeek 全部计费」的结论后被 v5.1 推翻——错在探测用了计费孪生 id：同一模型有付费 id 与 `cline-free/` 前缀免费孪生两个 id（`cline-free/deepseek-v4.1-flash` 实测 totalCost=0）。历史结论保留以记录认知演进，最新口径见 v5.1 章】** |
| 14 | `-t` 超时 | `-t <秒>` 传整轮上限，桥侧 spawn 超时（timeoutMs+20s）独立兜底 |

**隔离性验证**：以 HOME 覆盖运行多个真实任务后，用户 `~/.cline` 除其自身 hub 守护进程日志外
零写入（静置观察复核）。**事故披露（如实记录）**：排查期间两处误触用户 `~/.cline`——①轮换
登录循环用 `--data-dir` 前置写法，其中 12:19 的一次成功授权把 OAuth 凭证写进
`~/.cline/data/settings/providers.json`（覆盖了用户 cline-app 11:47 写的同账号版本，其桌面程序
仍可用，未删除该文件）；②12:33–12:35 的 2×2 对照矩阵两次以默认环境目录运行（定位根因所必需），
刷新了该文件。此后（12:36 起）全部调用均隔离。教训已固化为 E-006 与红线复述。

### 设计决策（Phase 1）

1. **回退链位置**：ai → cn → cline，各一次；cline 排最后（稳定性待长期观察、微付费）；
   `auto` 下 cline 永远在 ai/cn 之后；未装/无凭证 `laneReady=false` 直接跳过（不耗重试额度）。
   `default-lane` 枚举扩 `cline`（用户可固定），`disabled-lanes` 支持三 lane。
2. **cline 并发默认 1**（`cline-parallel` 键，1–8）：按量微付费 + 上游稳定性未知的保守起步；
   `--parallel` 不抬升 cline（ai/cn 才受它控制）。实测稳定后可调。
3. **任务级 effort 不下调 cline 思考档**（用户定案）：lane 一律 `--thinking <config>`（默认
   xhigh）；fanout 任务的 `effort` 字段对 cline lane 忽略；全局调整只走 `cline-thinking` config。
4. **不做 CI**（Phase 4 定案）：敏感审计模式含个人信息（账号名/邮箱/路径），写进公开
   workflow 文件即泄漏；冻结的人工发布流程（白名单逐文件 add → ls-files 对照 →
   `git grep --cached` 零命中 → push 后 `gh api` 复扫）已覆盖同等检查。
5. **配置键全部可选、缺省=v4 零回退**：`cline-path/data-dir/provider/model/thinking/compaction/
   parallel` 七键 + default-lane/disabled-lanes 扩展；未装 cline 时 doctor/ask/fanout/config
   行为与 v4 一致（实测回归）。
6. **SECURITY.md 上报渠道**：GitHub Security Advisories「Report a vulnerability」，不放个人邮箱。
7. **对外口径如实**：cline lane 成本统一写「按量微付费（实测单次 $0.0003-0.004）」，
   不写「免费」（Phase 0 #13 实测结论优先于策划期假设）。

### 桥改动清单（Phase 1，融入现有四模块架构，不新建目录）

- `wbx-core.mjs`：`WBX_VERSION` 5.0.0；`LANE_ORDER=['ai','cn','cline']`、`FALLBACK_ORDER=['cn','ai','cline']`；
  cline 常量与 `clineSpawnEnv()`（HOME 覆盖）/`scanClineCandidates()`/`resolveClinePath()`/
  `clineHomeDir()`/`clineHasCredential()`（查 `settings.auth.accessToken` 或 `apiKey`）；
  `spawnBin()` 通用化（spawnNode 复用之）+ stdin 无数据也立即 EOF；`parseClineNdjson()` 纯函数
  （**外包产出**：wbx fanout job `20260925-120106-jh7`，ZCode 审查修订后集成——run_result 优先、
  增量文本回退、错误优先级、BOM/CRLF/非 JSON 行容错）；`askOnceCline()`（`--json -P <provider>
  [-m <model>] --auto-approve false --thinking <cfg> --compaction <cfg> -t <秒> -c <空workdir> "<提示词>"`，
  禁 `--zen`/`--yolo`，>12k 走 stdin 通道，原始 NDJSON 全文随 job 落盘 `<id>.cline-stream.jsonl`）；
  `runClineAuth()`（spawn `cline auth <provider>` + 隔离 env，stdio inherit）；doctor 第 7 段
  （未装=WARN+指引 / 已登录+可选探测，全部不影响 exit 0；输出只报凭证存在性）；
  `laneStatusInfo('cline')` / `laneReady('cline')` / `parseLane` 扩展；config 七个 cline-* 键与容错；
  fanout `laneParallelOf()`（cline 单独受 `cline-parallel`）；用户级 AGENTS.md 标记块 v5 措辞。
- `wbx.mjs`：login `--identity cline` 分支；models `--as cline`（探测+指引）；`--lanes ai,cn,cline`；
  HELP 三 lane。
- `wbx-ui.mjs`：三 lane 卡（cline 含 未安装（可选）/未登录（OAuth）/已登录 三态 + 模型/思考档/
  二进制路径）、路由 pill + 禁用 cline 开关、ask/fanout 的 lane 选项、登录页 cline 指引卡。
- `wbx-setup.mjs`：/wbx 命令 v5 文案；INSTALL-README 可选 cline 段；bundle 根目录与 zip 名 v5。
- 发布物：README 三 lane/故障排查速查表/FAQ 增补；UNINSTALL 登记全部新增物；
  新增 SECURITY.md / CONTRIBUTING.md / CHANGELOG.md。

### v5 实测附录（Phase 5 验收记录，2026-09-25）

**1. Phase 0 清单逐项结论**：见上「调研记录」14 项表格，全部有实测结论；无止损触发
（OAuth 打通、V4.1 Flash 可用——但「免费」未证实，见 #13 如实口径）。附带事故与教训
（`--data-dir` 前置误写用户 `~/.cline`、对照矩阵刷新其 providers.json）已在调研记录披露。

**2. 三 lane doctor 全绿 + 卸载演练**：
- `doctor`（含探测）：ai 8.9s / cn 4.8s / cline 4.6s（deepseek/deepseek-v4.1-flash）全绿，exit 0。
- 卸载演练：`npm uninstall -g cline` → doctor 显示 `[WARN] 可选lane cline 未安装（可选能力，
  不影响 ai/cn）` 且 exit 0；期间 ask 照常走 ai 成功（9.4s）；`npm install -g cline` 重装后
  cline 立即恢复「已登录」（凭证在 `~/.wbx/cline-home/` 未随卸载删除）。
- `config set disabled-lanes ["cline"]` 写入/读回/恢复 round-trip 通过（早前实测）。

**3. 三 lane fanout 分布**（编排侧子代理消费同步验收）：fresh 子代理实例管理 6 任务批次
（构造 tasks.json → fanout → 逐份校验 → 仅回传摘要），job `20260925-130324-82m`：
**6/6 成功、13.2s、ai×2 + cn×2 + cline×2 三 lane 均匀分布、零回退零重试**；cline 任务
6.5–6.6s/5.5k tokens 级。子代理还独立发现并上报了 summary 超时显示 bug（已修）与
「全局形态当时仍为 v4、应改用项目 v5 入口」的执行偏差——管理层效率模式（主会话只收
25 行摘要）实效成立。

**4. cline 命令行落地证据**（thinking=xhigh/compaction=off）：job `20260925-125152-d3z`
的 `ask.cline-stream.jsonl`（21,979 字符 stdin 通道）与 job `20260925-130529-fgy`（T7 评审
×2）均由桥以 `--json -P cline -m deepseek/deepseek-v4.1-flash --auto-approve false
--thinking xhigh --compaction off -t N -c <workdir>` 发出；原始事件流随 job 落盘可回放。

**5. PROMPTS.md v2 + 自举记录**：原则 12 条（P1–P8 原文未动 + P9–P12）、模板 T1–T9（含填好
示例）、经验条目 E-001–E-010（全部带真实来源，含本窗口新踩的 E-005 错误样例误判、E-006
cline 四坑）、沉淀闭环、决策速查表 + 3 项 checklist。实施期自举外包任务（≥3 要求，实际 5 批）：
| job | 任务 | 用途 |
|---|---|---|
| `20260925-115826-idp` | p2-t7t9-templates（✅）、p2-t8-template（✅）、p1-ndjson-parser（❌ 见 E-005） | PROMPTS v2 的 T7/T9/T8 初稿 + NDJSON 解析器初稿 |
| `20260925-120106-jh7` | p1-ndjson-parser（✅） | NDJSON 解析纯函数（审查修订后集成进 wbx-core） |
| `20260925-121458-hyq` | p4-security/contributing/changelog（✅✅✅）、p4-readme-additions（❌ E-005） | SECURITY/CONTRIBUTING/CHANGELOG 初稿 |
| `20260925-125953-mij` | luhn-a/luhn-b（✅✅） | T8 best-of-N 双份生成 |
| `20260925-130529-fgy` | t7-luhn-a/t7-luhn-b（✅✅） | T7 评审批判 ×2（走 cline lane） |

**6. best-of-N 与评审常规化实效**（评审记录全文：实施期临时产物
`%TEMP%\wbx-v5\reviews\luhn-best-of-n.md`）：lib/luhn.js 同契约双份（A 可读性侧重@ai、
B 边界完备侧重@cn），**两份均 12/12 契约断言独立运行通过**；T7 评审（cline lane）A 份
1 建议 0 阻断、B 份 3 建议+1 UNKNOWN 0 阻断；按「契约通过率→边界覆盖→可读性」**选 B**
（边界显式枚举完胜、可读性微弱劣势不抵），落选份归档不删，三条建议逐条处置。
T7/T8/T9 模板与防护（择优必走 T7、单一写者接管）全部按 PROMPTS.md 执行。

**7. 全命令回归（改桥后）**：4 脚本 `node --check` 通过；doctor（含/不含探测）、config 七个
cline-* 键 round-trip、`default-lane cline` 写读恢复、ask 短提示词（ai 9.0s）、models 探测、
history 列表+双向回放（含 cline 任务）、fanout `files` 字段回归（材料读档正确、答案核对通过）、
UI 冒烟（/api/status 三 lane ready、/api/history 37 条）、export-bundle（11 文件、零凭证断言
**比对 9 个 token**——v5 起含 cline OAuth token）、发现并修复 v4 遗留 summary「单任务超时」
二次除法显示 bug（600s 显示 0.6s）。

**8. 全局形态幂等同步**：项目 v5 `self-install` → `~/.zcode/wbx-bridge/` v5.0.0（scripts +
examples + PROMPTS.md + docs）、用户级 skill SKILL.md + PROMPTS.md v2、`/wbx` 命令 v5 文案、
`~/.zcode/AGENTS.md` 标记块 v5（三 lane 子代理 + 默认分派措辞，核验 2 处命中）、`~/.wbx/`
凭证原样（ai/cn/cline 三绿）；全局入口 doctor 通过；重跑覆写幂等。

**9. 触发面静态核验**：项目 AGENTS.md（4 处）、项目 SKILL.md（6 处）、用户级标记块模板（2 处）、
/wbx 命令模板（1 处）均含「默认分派/单个也直接派」意图；止损与涉密防护措辞逐处保留。

**10. GitHub 发布与审计**：白名单逐文件 `git add`（16 文件：根 9 + 技能目录 7，`git ls-files`
逐项对照一致）→ 五套敏感审计 `git grep --cached` 零命中（人名/账号/机器路径/邮箱/uin 脱敏形态；
`~/.wbx/cline-home` 命中均为文档路径说明，凭证值级检查（token 字段带值、账号 id、40+ 随机串）
另跑一轮零命中）→ commit `cda9e53` → push → `gh api` 线上校验 sha 一致 + 本地远端零差异 +
**对 origin/main 重跑审计三套零命中** → tag `v5.0.0` → release（notes 引 CHANGELOG 摘要，
附件 `wbx-bridge-v5-20260925.zip` 279KB/11 文件/零凭证断言比对 9 token）→ description 更新
三 lane 口径、topics 增 `cline`（`ai-agent`/`windows` 已在列，不重复）。

**11. 「新人 10 分钟」走查**：按发布后 README 逐步实测——`git clone`（3s，16 文件齐全）→
全新运行时（WBX_HOME 指向空目录模拟新机）`doctor`（0s，各 lane 正确给出对应 login 指引、
cline 段按装/未装显示正确状态、exit 1 符合「无可用 lane」语义）→ 已登录机器形态 `ask` 首条
（10s，ai lane 正确作答）。**机械步骤合计 ~13 秒**，10 分钟预算内余量充足；仅登录步骤需
真人操作（README 已逐条写明），无超时步骤，无需回写。

---

## v5.1 章：cline lane 免费孪生（cline-free）· 免费模型可观测与可选

> 策划材料：`internal/RESEARCH-V6.md`（孪生机制/清单端点/先例仓库/已排除路线，均经策划窗口
> 2026-09-25 实机核实）。版本号 **5.1.0**（「V6」仅为策划编号，不进产品版本）。

### v5.1 定位说明

v5 遗留错误：模型探测用了**计费孪生** `deepseek/deepseek-v4.1-flash`，得出「CLI 侧无免费
模型」的错误结论——错的是 id，不是路线。Cline 按**模型 id** 计费：同一模型有两个 id
（付费 id 与 `cline-free/` 前缀免费孪生），免费孪生 `cline-free/deepseek-v4.1-flash`
实测 totalCost=0。v5.1 做四件事（用户定案，不扩大范围）：

1. **默认免费**：`cline-model` 缺省默认切为免费孪生；存量 config 一次性迁移（仅旧值恰为
   v5 计费孪生时改写，显式其他值不动）。
2. **可观测**：`wbx models --as cline --free` 实时列免费组（recommended-models 端点，token
   只用不打印；失败降级缓存）；doctor 校验默认孪生是否仍在免费组（免费组限时轮换的防护）。
3. **可选**：Web UI 状态页 cline 卡免费模型下拉（选中即写 `cline-model`；非 DeepSeek 项标注）。
4. **状态机**：免费档超额/轮换错误分类（`free-limit`/`free-promotion-ended`/`model-not-found`）
   与用户提示；红线断言——cline lane 内部任何失败路径不得用非 DeepSeek 模型顶替
  （跨 lane 回退 ai/cn 保留，仍是 DeepSeek）。

### 调研补充（策划窗口核实，来源见 RESEARCH-V6 第一部分）

- **孪生机制**：先例仓库 ErfanBagheri404/ClineDesktop2API README 原文——"Cline bills by
  model ID: deepseek/deepseek-v4.1-flash is metered, cline-free/deepseek-v4.1-flash is not."
- **清单端点**：`GET https://api.cline.bot/api/v1/ai/cline/recommended-models`（Bearer OAuth
  accessToken，即隔离 providers.json 的 `settings.auth.accessToken`），返回
  `{recommended,free,clinePass,clineCloud}` 四数组，元素 `{id,name,description,tags}`。
- **官方文档**（docs.cline.bot/getting-started/free-models.md）：免费模型面向任何账户，限时
  促销轮换+用量配额；官方明确支持 CLI（/settings 选择）、明确「Free model usage is not
  supported through the Cline API」；**免费用量可能被用于改进模型**（隐私披露，已写入
  README/UI/安装说明）。
- **已排除路线**（理由见 RESEARCH-V6 附录 A.1）：SDK 直调 / 直连公开 API 走免费档 /
  本地反代 / 桌面 App 逆向——CLI 原生支持免费孪生，一步到位。

### Phase 0 实测记录（2026-09-25，执行窗口，cline 3.0.65 / Node v24.19.0 / Windows 11）

| # | 事项 | 实测结论 |
|---|---|---|
| P0-1 | 基线复测 | doctor 三 lane 全绿（ai 9.4s / cn 5.4s / cline 5.0s）；`ask --as cline`（免费 id）×2 成功，model=cline-free/deepseek-v4.1-flash、**totalCost=0**、4.7-4.8s、中文正确（job 20260925-141952-723 / 20260925-141956-2zc） |
| P0-2 | 孪生存在性 | recommended-models 端点 HTTP 200；免费组 5 个：`stealth/space-bunny-alpha`、`cline-free/mimo-v2.6-flash`、`cline-free/deepseek-v4.1-flash`（目标在列）、`cline-free/gemini-3.8-flash`、`cline-free/muse-spark-1.3-contributor`（与策划窗口数据一致） |
| P0-3 | 轮换下线演练 | 以不存在 id `cline-free/deepseek-v4.1-flash-rotated-away` 探测：exit 1、桥分类 cli-error、错误消息 `model not found`；NDJSON 形态 = `agent_event.error.message:"model not found"` + `run_result.finishReason:"error"`（512ms 即失败，不耗额度）——P0-1 存在性校验的降级设计取证完成 |
| P0-4 | 额度边界探测 | **节约模式分档递进，20 次成功免费调用全部 totalCost=0、无任何警告事件**（4.1-6.1s/次，16 连发批次 77s）——记录「20 次内未见限制」即停（红线：不打爆用户当日额度） |
| P0-5 | 超额错误形态 | **未实测到边界**（额度 ≥20 次/日）。形态改为二进制内证（cline.exe 符号与消息模板）：`ClineFreeModelLimitError` 类 + 确切消息「`Daily free model limit reached` / `You've reached today's free usage limit for this model.` / `Try again in <时长> or select another model.`」；轮换下线消息「`Free model promotion ended` / `The free promotion for this model has ended and it is no longer available.`」——状态机按真实消息字符串设计，并如实标注「边界未实测到」 |
| P0-6 | 无空格怪癖防护 | v5 调研 #9 的「无空格短中文被当未知子命令」复现（ask 提示词无 ASCII 空格 → cli-error 回退 cn）；**前缀一个空格实测可用**（completed、$0、2.5s）——v5.1 已在 askOnceCline 加防护 |
| P0-7 | 附带发现 | undici fetch（全局连接池）+ 随后 `process.exit` 在 win32 触发 libuv 断言（`async.c` `!(handle->flags & UV_HANDLE_CLOSING)`、exit 127）——最小复现在案；解法：目录拉取走 `node:https` 单次连接（不走 fetch/httpJson），登录流 httpJson 不受影响 |

### 设计决策（Phase 1）

1. **默认值与迁移（P0-2）**：`CONFIG_DEFS['cline-model'].default` = `cline-free/deepseek-v4.1-flash`；
   loadConfig 容错处一次性迁移——**仅当** config 现值恰为 `deepseek/deepseek-v4.1-flash`（v5
   写入的计费孪生）时改写为新默认、写回 config.json 并打印 `[MIGRATE]` 一行（写回保证只发生
   一次）；显式设置的其他值一律不动。空值/缺省回落新默认（P1-6 默认值切换的语义）。
2. **清单不硬编码（P0-5）**：免费组轮换 → 每次实时调端点；成功写缓存
   `<运行时根>/cline-free-models.json`（无凭证），端点失败读缓存降级（注明时间戳），再失败
   明确报错（不崩溃）。token 只用不打印（沿用凭证红线）。
3. **超额状态机（P0-3）**：错误分类优先级 auth → free-limit（含
   `extractFreeLimitResetIn` 从「Try again in X」提取重置倒计时透出）→ free-promotion-ended
   → model-not-found → ratelimit；ask/fanout 命中时给用户可操作提示（等待重置/换免费模型/
   查清单）。**跨 lane 回退语义不变**：free-limit 照常回退 ai/cn（仍是 DeepSeek 且 ai 免费，
   符合用户定案）——文档写明。
4. **非 DeepSeek 禁回退（P0-4，用户定案红线）**：cline lane 失败路径绝不换模型 id
   （`askOnceCline` 的 `-m` 恒为 config/任务指定值）；`fallbackLane` 只换 lane（ai/cn）。
   代码注释 + 回归断言（见验收记录）双保险。**UI 下拉与 `--free` 清单里的非 DeepSeek 项
   仅限用户手动选择**——断言约束的是桥的自动行为，不限制用户手选。
5. **doctor 存在性校验（P0-1）**：cline 段已登录时新增一行——当前 `cline-model` 在免费组
   `[OK]`（注明来源 端点/缓存）；不在组 `[WARN]` + 列出当前免费 id + 换用命令；端点失败
   `[WARN]` 降级。均不影响 exit 0（cline 仍是可选 lane 语义）。cline 探测行新增本次计价
   （$0 标「免费」）。
6. **zip/bundle 命名带全版本**：`wbx-bridge-v5.1.0-<日期>.zip`（此前 v5 系列名不含补丁号）。

### 桥改动清单（Phase 1，四模块内，不新建文件）

- `wbx-core.mjs`：`WBX_VERSION` 5.1.0；`CLINE_FREE_DEFAULT_MODEL`/`CLINE_METERED_TWIN_MODEL`
  常量与注释；config 默认值 + 迁移 + 写回；`httpsGetJson_()`（node:https 单次连接，绕开
  undici/libuv 断言）；`fetchClineFreeModels()`（端点+缓存降级，token 只用不打印）；
  `isFreeLimitError/isFreePromotionEndedError/isModelNotFoundError/extractFreeLimitResetIn`；
  `askOnceCline` 失败分类扩展（hint/resetIn）+ 无空格提示词前缀空格防护；runAskJob 传播
  resetIn；doctor cline 段存在性校验 + 探测计价；`fallbackLane` 红线注释；
  `laneStatusInfo('cline')` 成本口径；用户级标记块措辞。
- `wbx.mjs`：`models --as cline --free`（清单+当前值标注+非 DeepSeek 标注）；ask 失败
  `hintText()`（含 free-limit 带重置时间、promotion-ended、model-not-found 文案）；HELP
  三处口径；login cline 提示；`--free` 参数解析。
- `wbx-ui.mjs`：`/api/status` 新增 `clineFreeModels`/`clineFreeModelsNote`（server 侧端点
  调用，失败空数组+提示）；cline 卡成本行改免费口径 + 免费模型下拉（选中即 POST
  /api/config 写 cline-model，非 DeepSeek 标注「（非 DeepSeek）」）；登录页 cline 指引更新。
- `wbx-setup.mjs`：INSTALL-README cline 段免费口径 + 隐私披露；zip/bundle 名带 WBX_VERSION。

### v5.1 验收记录（Phase 3 回填，2026-09-25）

**1. 四类断言回归（internal/v6-regression.mjs，24 PASS / 0 FAIL）**：

- **① 存量迁移（沙箱 WBX_HOME）**：旧值恰为计费孪生 → 打印 `[MIGRATE] cline-model：检测到
  v5 计费孪生 deepseek/deepseek-v4.1-flash，已改写为免费孪生 cline-free/deepseek-v4.1-flash
  （仅此值迁移，显式设置的其他模型 id 不动）`、stdout/落盘均为免费孪生；**二次运行不再迁移**
  （幂等）；显式 `cline-free/mimo-v2.6-flash` 不被迁移；缺省/空串回落新默认。
- **② 免费 id 缺失降级（真实运行时根，改后即恢复）**：config 临时设为不存在 id → doctor
  `--no-probe` exit 0 且输出 `[WARN] 免费模型 cline-model=…-rotated-away 不在当前免费组
  （可能已被轮换下线，或为计费 id）。当前免费：stealth/space-bunny-alpha、…（全清单）+
  换用指引`；ask `--as cline` 命中 `model not found` 后自动跨 lane 回退 ai/cn 成功
  （`[FALLBACK] 主 lane cline 失败`）；恢复后 config 原样。
- **③ 超额状态机（真实二进制消息模板模拟）**：`isFreeLimitError` 命中
  「Daily free model limit reached…Try again in 2h 30m…」；`extractFreeLimitResetIn`
  提取 `2h 30m`；`isFreePromotionEndedError` 命中「Free model promotion ended…」；
  `isModelNotFoundError` 命中实测形态「model not found」；正常文本零误判；通用 429 仍走
  ratelimit；NDJSON 模拟事件（agent_event.error + run_result error）解析出消息文本。
- **④ 非 DeepSeek 禁回退**：`fallbackLane('cline')` = `cn`（只回 ai/cn）；`askOnceCline`
  内 `mdl` 只赋值一次、`'-m'` 只出现一次（失败路径无模型替换逻辑）；`fetchClineFreeModels`
  返回结构无 token 字段。

**2. v5 全命令回归（零回退）**：4 脚本 `node --check` 通过；doctor（含探测：ai/cn/cline 三绿
+ 免费模型存在性行 + cline 探测计价 `$0.000000（免费）`，exit 0）；ask 默认路径（ai 10.4s）、
`--as cline`（免费孪生 4.7s、$0）、无空格中文提示词直达 cline 成功（v5.1 新防护）、
`config set default-lane cline` 后 ask 走 cline（4.7s）再恢复 auto；fanout 3 任务三 lane
混合 + `files` 材料拼接（3/3 成功、9.8s、材料标题读取正确，job 20260925-144030-2mt）；
models `--as cline --free`（5 个、非 DeepSeek 标注、当前值 *）/ `--probe`（计价显示）/
默认 ai；config 七键 round-trip（default-lane、disabled-lanes、cline-model）+ UI API 写
cline-model 生效；history 列表 + `--task` 定向回放；UI（/api/status 含 clineFreeModels 5 项
+ note、cline 卡下拉存在、POST /api/config 写回成功）；export-bundle
（wbx-bridge-v5.1.0-20260925.zip、11 文件、零凭证断言比对 9 token）。

**3. UI 免费模型选择器验收**：/api/status 新增 `clineFreeModels`（5 项，非 DeepSeek 4 项带
标记）与 `clineFreeModelsNote`（空=端点正常）；页面 cline 卡渲染 `<select id="cline-free-select">`
（当前值 selected）；选中 → POST /api/config `{key:'cline-model'}` → config.json 写入生效
（实测回读一致）；清单不可用时降级为提示文字（含命令行替代方案）。

**4. GitHub 发布与审计**：白名单逐文件 `git add`（11 个修改文件；无新增文件，白名单 16
文件不变，`git ls-files` 逐项对照一致）→ staged 敏感审计零命中（六套：人名/账号
`jaferpentz|FireChou|周燎原|Lenovo|Agent Vault|Yglstr`、邮箱正则、`D:\Download`、
`C:\Users\Lenovo`、uin 脱敏 `33**54|45**32`、`usr-01M2X`）+ 凭证值级
（`accessToken"…"20+ 字符`形态）零命中 → commit `86356e6` → push → `gh api` 分支 sha
与本地一致（86356e6c2ae…）→ **origin/main 远端复扫六套零命中** → tag `v5.1.0` → release
（notes 引 CHANGELOG + WBX 链接，附件 `wbx-bridge-v5.1.0-20260925.zip` 320KB/11 文件/
零凭证断言比对 9 token）→ description 更新（「可选 Cline CLI 免费孪生」口径；topics 已含
cline/deepseek/cost-saving 无需新增）。

**5. 全局形态幂等同步**：项目 v5.1 `self-install` → `~/.zcode/wbx-bridge/` v5.1.0（scripts +
examples + PROMPTS.md + docs）、用户级 skill、`/wbx` 命令、`~/.zcode/AGENTS.md` 标记块
（免费孪生措辞，核验命中）；全局入口 doctor 通过（含免费模型存在性 `[OK]`）；`~/.wbx/`
凭证原样三绿。

**6. 自举记录（wbx 外包，材料先行，逐份校验后采用）**：

| job | 任务 | 用途 |
|---|---|---|
| `20260925-143219-fuo` | e011-revise（✅）、faq-free-rewrite（✅） | E-011 修订草稿 + README「真的免费吗」改写草稿（ai lane，各 35-44s；ZCode 审校微调后集成） |

**7. 如实声明**：免费额度边界未实测到（当日 20 次成功调用全部 $0，节约模式即停）；超额
错误形态（消息模板与类名）取自 cline 3.0.65 二进制内证，状态机按真实消息字符串设计——
若线上实际报文与此不符，`hint` 兜底为通用 `ratelimit` 分类（仍能触发跨 lane 回退），不崩溃。

## v5.2 章：控制台常开可用（守护化 + 随 ZCode 自启）· 全面中文化与命名统一

> 版本 v5.2.0（2026-09-25，GOAL-V7）。策划材料：`internal/RESEARCH-V7.md`（含四份外部算力调研原文
> `internal/v7-research-*.md`，fanout job `20260925-150220-x87`）。一句话：本地控制台从「输命令才可用」
> 变为「浏览器直接开 127.0.0.1:7788 就在、打开 ZCode 自动拉起」，界面全面中文化、通道命名统一为品牌名。

### 1. 第一性原理与方案选型

- 「打开网址就能用」的本质是**服务已在你需要之前存在**。三条路径（系统常驻 / 宿主拉起 / 按需手动）中
  选**宿主拉起**：ZCode 已有 SessionStart 钩子机制，把启动做成宿主的幂等副作用是最小充分解——
  不装服务、不写注册表、不动环境变量（被否决备选见 RESEARCH-V7 附录 A.1）。
- 钩子是内联执行的（官方文档明示 `async` 无运行时效果），钩子命令必须秒回——后台化由 `ui --detach`
  在 Node 内部完成（detached spawn + unref）。这决定了「**永远复用绝不新起**」的幂等性是全方案
  最关键性质：没有它，每次会话启动都会泄漏一个进程。
- Jupyter 式端口顺延明确不做：固定 7788 是「浏览器直接开网址」的前提（A.2）。端口被外程序占用时
  fail fast 明确报错，不静默换端口。
- 中文化只动**展示层**：数据层（manifest.type='ask'、API 字段、config 键）一律不动——历史回放、
  文档、脚本兼容全靠它；翻译集中在 wbx-ui.mjs 前端一处映射表。
- 命名公式：**品牌（版本）全称**用于卡片标题（WorkBuddy AI（国际版）/ WorkBuddy（国内版）/
  Cline CLI（可选通道）），**品牌短称**用于窄栏位（WorkBuddy AI / WorkBuddy / Cline）；同一概念
  全站唯一译法；中文界面不出现裸 lane/ai/cn/cline（必要处用「通道」）。
- 项目形态定性（写进 README）：Skill（带脚本）+ Node CLI + AGENTS.md 常驻块 +（v5.2 起可选）
  SessionStart 自启钩子，四层职责分离；非 MCP/plugin/command（论证见 RESEARCH-V7 1.1 与
  v7-research-skill-vs-plugin.md §2）。

### 2. Phase 0 待实测点结论（全部实测通过，探测脚本 internal/v7-phase0-probe.mjs）

| 待实测点 | 实测结论 |
|---|---|
| `process.kill(pid,0)` 语义 | 自身 pid 探测成功；死 pid/已退出子进程均报 **ESRCH**（EPERM=存在但无权限，判活按「非 ESRCH 即活」） |
| NTFS `wx` 互斥竞态 | 对已存在文件 3 次并发打开全部 EEXIST；**3 进程竞态恰好 1 个赢家**（CreateDisposition CREATE_NEW 语义，跨进程互斥成立） |
| `listen exclusive:true` 跨进程 | 子进程监听后父进程再绑同端口报 **EADDRINUSE**（fail fast 可行；也再次实证了端口被占的明确报错路径） |
| windowsHide+detached | 子进程存活、unref 后父进程可独立退出；窗口可见性属人眼项，以 windowsHide 语义为准 |
| 绑 127.0.0.1 防火墙弹窗 | 回环绑定不注册防火墙关注面（设计层结论；本机全程未见弹窗） |
| 睡眠唤醒后套接字存活 | 无法程序化复现；设计上由三条件判活 + startedAt 跨重启判废自愈兜底（接受重启机器为最终回收） |
| 基线 | doctor 三 lane 全绿；ui 前台模式（GET / 200、/api/status 正常）；清理了 7788 端口上一个 **v4.0.0 时代的 ui 孤儿进程**（守护化要解决的孤儿问题的活案例）；`~/.zcode/cli/config.json` 仅 `plugins` 键无 hooks |

### 3. 设计与实现

新增脚本 `scripts/wbx-daemon.mjs`（纯函数集 + 生命周期 + 钩子安装器）；`wbx-ui.mjs` 加安全校验与
health/shutdown；`wbx.mjs` 加 CLI 分派；`wbx-setup.mjs` 文件清单 + 卸载顺序。

- **状态文件** `~/.wbx/run/ui.json`：`{pid, port, startedAt, token, version}`。三条件判活（状态文件
  parseUiState 通过 + `kill(pid,0)` 存活 + `GET /__health` 返回 `{app:'wbx-ui'}` 且 pid 匹配）+
  `startedAt < now - os.uptime()` 判跨重启残留。决策真值表 `decideExisting` →
  none（直接起）/ reuse（永远复用）/ replace（清残留重起）/ conflict（绝不杀未知 pid，交给 --stop/人工）。
- **`ui --detach`**：探测 → reuse 即复用返回；replace 清状态；spawn
  `node wbx.mjs ui --daemon --port N`（detached+unref+windowsHide，stdio 全落
  `~/.wbx/logs/ui.log`，绝不 shell）；等就绪预算 3.5s（钩子 timeoutMs 5000 内必须返回）；子进程
  EADDRINUSE 退出（码 78）时复探——命中则「复用」（并发 --detach 竞态自洽），否则明确报错。
  **永远 exit 0**（它是 SessionStart 钩子路径，异常只落日志/stderr）。
- **`--daemon`**（内部）：uncaughtException 落盘+清状态+exit 1；unhandledRejection 只落盘；
  bind 成功后才写状态文件（bind 即单实例互斥赢家）；每小时检查日志 >10MB 截断。
- **`--stop`**：HTTP `/__shutdown {token}` 优雅关闭优先；kill 兜底**仅当能正向证明 pid 归属**
  （health OK 且 pid 匹配——Windows pid 复用下绝不误杀无辜进程，证明不了就清状态+人工指引）。
- **安全校验**（前台/守护一律生效）：Host 头白名单恰为 `127.0.0.1(:port)/localhost(:port)`
  （大小写不敏感，拒 IPv6/尾点/userinfo/其他端口——防 DNS rebinding）；POST 一律 Origin 校验
  （同源或空）；`/__shutdown` token 用 Buffer 字节长度对齐 + timingSafeEqual；只绑 127.0.0.1 +
  `listen exclusive:true`。
- **自启钩子**：`--install-autostart` 对 `~/.zcode/cli/config.json` 读-改-写合并，追加
  `hooks.events.SessionStart` `{matcher:'^startup$', hooks:[{type:'process', command:<node.exe>,
  args:[<全局形态 wbx.mjs>,'ui','--detach','--no-open'], timeoutMs:5000, statusMessage:'wbx 控制台保活'}]}`。
  合并铁律：既有键绝不删除/改写；按 command 路径幂等去重（我们自己的旧条目允许更新对齐）；
  既有结构类型异常（SessionStart 非数组等）中止且不写文件；`hooks.enabled` 仅当键**缺失**且无其他
  钩子时置 true（用户显式 false 一律不翻转，如实告警），并以 marker 文件
  `~/.wbx/run/autostart-enabled-by-wbx` 记录 `enabledBefore`，`--remove-autostart` 按记录逐键还原。
  钩子命令输出走 stderr、stdout 保持空（宿主对钩子 stdout 按 JSON 严格 schema 解析）。
- **中文化映射**（前端一处）：`LANE_LABEL/LANE_TITLE/TYPE_LABEL/TASK_STATUS_LABEL/JOB_STATUS_LABEL`
  五表 + `errorHint`（v5.1 超额三类错误的 UI 侧友好提示，与 CLI hintText 同源语义）；
  effort 选项译低/中/高（补显式 value 属性防提交值漂移——worker 映射清单抓到的关键坑）；
  D3：doctor 人读输出通道段统一品牌全称（`--- 通道 WorkBuddy AI（国际版） · x0.00（免费） ---`），
  机器可读输出（steps/laneRows JSON）不动。
- **纯函数质量流程**：parseUiState/isStaleState/hostHeaderAllowed/originAllowed/decideExisting
  契约 72 断言测试台（internal/v7-pure-tests.mjs）跑三份实现——T8 双份 worker（各 69/72：多余字段
  丢弃、host 空格不容忍、origin 大小写不归一）vs 编排器参考实现（72/72，含多余字段保留的向前兼容），
  择优采纳后者；T7 评审批判报 2 阻断 + 6 建议**全部修复**（stopUi 误杀风险、marker 原值记录与
  显式 false 不翻转、token 字节对齐、login TOCTOU、config 键原型链、钩子超时预算、daemon import
  归 try、日志增长防护）。

### 4. 实测门禁记录（真机）

- 守护链路：status 未运行 → detach 冷启动 → 二次 detach 复用同 pid（幂等）→ status 运行中
  （pid/port/version/startedAt）→ 恶意 Host 403 / 恶意 Origin POST 403 / 错 token shutdown 403 /
  同源 POST 200 → 裸 `ui` 打印 URL 退出 → `--stop` 优雅关闭端口释放 → status 未运行。
- 陈旧自愈两型：伪造死 pid 状态 → status「残留（可自愈）」→ --detach 清理重起；taskkill 硬杀
  daemon 后 --detach 复起成功。
- 钩子合并/还原：临时副本五场景 24 断言全过（internal/v7-merge-tests.mjs）——全新 config（装→幂等→
  摘除**逐字节还原**）；存量他人钩子 + enabled:true（他人条目原样、enabled 不动、逐字节还原）；
  enabled:false（不擅自翻转）；畸形结构（中止不写）；未装时摘除（无操作不写）。
- 真机钩子：安装后 config.json 与官方 schema 逐字段一致（zcode-guide:diagnosing-hooks 核对）；
  以宿主执行方式（直接 spawn node.exe + 参数向量）实测钩子命令：冷启动 **477ms**、二次 **146ms**
  （均 < 2s 门禁），exit 0、stdout 为空；URL http://127.0.0.1:7788 可达；
  `--remove-autostart` 后与安装前 **diff 逐字节一致**，重装即交付态。
- 如实声明：「随 ZCode 自启」的完整链路（宿主真实触发 SessionStart → 钩子拉起）中，宿主侧触发
  无法在本会话内自证（需要新开一个 ZCode 窗口观察）——配置格式按本地官方指南逐字段核对、命令
  执行/时序/幂等均已按宿主执行方式实测；降级路径：即使钩子不触发，手动 `wbx ui --detach` 一次
  即等效（幂等常驻）。

### 5. 红线遵守

daemon 只绑 127.0.0.1；不装服务/不写注册表/不加计划任务/不动系统环境变量；config.json 只做
读-改-写合并且卸载可逐键还原（diff 实证）；token 只存 ui.json（gitignore 运行时目录），绝不打印
/不入库；中文化仅展示层（数据层/API 字段/config 键零改动，旧 job 回放验证见验收附录）；
v5.1 对外行为零回退（免费孪生默认、迁移、超额 hint、非 DeepSeek 禁回退均未触碰）。

### 6. 验收附录（证据回填）

**1. 四类新断言回归（internal/v7-regression.mjs，27/27 全过）**：
- ①幂等/复用：清场后连续 `--detach` 两次——首次「已后台启动 pid X」、二次「复用 pid X」（同 pid）；
  状态文件 pid 稳定；`netstat` 7788 单监听；`/__health` 返回 `{app:'wbx-ui',pid,port,version:'5.2.0'}`
  且 pid 匹配。
- ②陈旧自愈两型：伪造死 pid（4194303）状态 → `--status` 报「残留（可自愈）」→ `--detach` 清理重起
  （新 pid）；伪造「存活但无关」pid（回归进程自身 pid）→ `--detach` 走 conflict 报告、绝不杀该进程
  （进程存活自证）→ 清状态后正常起。
- ③安全攻击面：恶意 Host（evil.com）403、正常 Host 200；伪造 Origin（http://evil.com）POST 403、
  同源 localhost 形态 POST 200；错 token / 无 token `POST /__shutdown` 均 403 且守护存活；
  IPv6 Host 形态（[::1]:7788）403。
- ④钩子合并/还原：临时副本五场景 24 断言全过（internal/v7-merge-tests.mjs，独立脚本被回归
  以子进程调用）——全新 config 装→幂等→摘除**逐字节还原**；存量他人钩子+enabled:true 他人条目
  原样、enabled 不动、逐字节还原；显式 enabled:false 不擅自翻转；畸形结构中止不写；未装时摘除
  无操作不写。

**2. 纯函数契约与择优记录**：契约测试台 72 断言（internal/v7-pure-tests.mjs）跑三份实现——
worker A 69/72、worker B 69/72（共性失分：多余字段丢弃、host 空格不容忍、origin 大小写不归一）、
编排器参考实现 72/72（含多余字段保留向前兼容）→ 择优采纳后者，worker 版本留档
internal/worker-daemon-pure-*.mjs。T7 评审批判报 2 阻断（stopUi 误杀风险、marker 原值）+
6 建议（token 字节对齐、login TOCTOU、config 键原型链、钩子超时预算、daemon import 归 try、
日志增长防护）**全部修复后**复测全绿。

**3. v5.1 全命令回归零回退**：internal/v6-regression.mjs 复跑 **24/24 全过**（存量迁移、免费 id
缺失降级、超额状态机八断言、非 DeepSeek 禁回退四断言、token 不泄漏）；命令批实调——doctor 全探测
通过（三通道段品牌名 + v5.2.0）、`ask --text` 实调成功（lane=ai 9.1s）、`fanout` 2 任务 2/2、
`models --as cline --free` 实时清单 5 项（当前值标 *）、`config set/get` 回环一致、`history` 列表
与 `history <jobId>` 回放正常（**旧 job 20260924-210540-k5e（legacy）回放可读——展示映射兼容
数据层**）、`export-bundle` 12 文件（含 wbx-daemon.mjs）零凭证断言通过、`self-install` 幂等
（用户级 AGENTS 块刷新含 ui --detach 行）。UI 展示/数据层分离断言：页面含品牌全称与中文术语，
`/api/history` 59 个 job 的 `type` 字段仍为英文原始值、job 详情字段原样。

**4. 钩子真机门禁**：安装后 config.json 与官方指南（zcode-guide:diagnosing-hooks）逐字段核对一致
（type:process + args 参数向量 + timeoutMs + statusMessage + matcher '^startup\$'）；按宿主执行
方式直接 spawn node.exe 实测：冷启动 477ms / 二次 146ms（<2s），exit 0，stdout 空、输出走 stderr；
URL 可达；`--remove-autostart` 后与安装前 diff 逐字节一致；重装为交付态。
如实声明：宿主侧 SessionStart 真实触发需新开 ZCode 窗口观察，本会话无法自证——配置格式已按官方
文档核对、命令行为已按宿主执行方式实测；降级路径：钩子即使不触发，手动 `wbx ui --detach` 一次
即等效（幂等常驻）。

**5. Phase 0 待实测点**：全部实测通过（结论见本管第 2 节表格）；7788 端口发现并清理了一个
v4.0.0 时代的 ui 孤儿进程（守护化要解决的问题的活案例）。

**6. 发布证据**：白名单逐文件 `git add`（11 个文件：10 改 1 增——新增
`.zcode/skills/wb-bridge/scripts/wbx-daemon.mjs`；`git ls-files` 17 项逐一对照一致；
`.zcode/plans/` 非本项目产物未纳入）→ staged 敏感审计（人名/账号、邮箱正则、`D:\Download`、
`C:\Users\Lenovo`、uin 脱敏、`usr-01M2X`、cline 凭证实值形态、accessToken 值形态、本机
ui.json token 实值）**零实际命中**（①③④⑤⑥ 仅命中 WBX.md v5.1 附录对审计模式本身的文档引用，
先例一致）→ commit `1acce03` → push → `gh api` 分支 sha 与本地一致（1acce036b705…）→
**origin/main 拉回复扫零命中** → tag `v5.2.0` → release
（notes 引 CHANGELOG + 回归摘要 + 安装指引；附件 `wbx-bridge-v5.2.0-20260925.zip` 372.6KB/
12 文件/零凭证断言比对 9 token）→ `self-install` 终态同步（全局形态 v5.2.0，用户级 AGENTS 块
含 ui --detach 行）→ **全局入口复测**：stop 清场 → --detach 冷启动（pid 49480）→ 二次 --detach
复用同 pid → 页面 200、/api/status v5.2.0 → --status 运行中 → 钩子交付态（enabled=true、
SessionStart 1 组）。

**7. 自举记录（wbx 外包，材料先行，逐份校验后采用）**：

| job | 任务 | 用途 |
|---|---|---|
| `20260925-152646-m4c` | daemon-pure-a（✅ 69/72）、daemon-pure-b（✅ 69/72）、ui-l10n-map（✅） | 纯函数双份（T8）+ UI 全量文案映射清单（映射已逐条终审集成；effort 选项补 value 属性的关键坑即来自该清单） |
| `20260925-153554-8wl` | t7-daemon-review（✅） | wbx-daemon/wbx-ui 评审批判（T7）：2 阻断 + 6 建议全部修复 |
| `20260925-154530-3uf` | readme-form-section（✅）、changelog-52-draft（✅） | README 形态/控制台两节 + CHANGELOG 5.2.0 初稿（ZCode 终审微调后集成） |

