# WBX — ZCode ↔ WorkBuddy AI 联动桥（v3：可观测 + 全局化 + 可视化 + 可分发）

> **v3**：job 可观测（ask 也落盘 + `history` 回放）、用户级全局安装（任何项目 + `/wbx` 命令 +
> `~/.wbx/` 全局运行时）、本地 Web UI（`wbx ui`）、分发打包（`export-bundle`）。
> v2：双 lane + 主动分派。卸载见 [UNINSTALL.md](UNINSTALL.md)。
>
> **临时工具声明**：本桥的存在意义是「把合适的子任务并行外包给 WorkBuddy 账号下的
> DeepSeek V4.1 Flash（免费/极低成本）」。当该免费/低价期结束、或账号策略变化导致
> 不再划算时，直接卸载（见 UNINSTALL.md），不要恋战。

## 这是什么

在 ZCode 会话里，把**相互独立、纯文本进出、单轮可完成**的子任务（多对象调研/翻译/摘要/改写/
批量生成/结构化抽取）并行分派给 WorkBuddy 账号下的 `deepseek-v4.1-flash` 执行。
v2 起为**双 lane**，并配主动分派层（SKILL.md + AGENTS.md），ZCode 会话无需用户提示即可分派。

```
ZCode ──> node wbx.mjs fanout --lanes ai,cn ──> 并行 CodeBuddy CLI 进程（deepseek-v4.1-flash）
   ai lane = 国际版（x0.00 免费）      cn lane = 国内版（x0.03 近免费）        └─ 结果写 .wbx/tasks/<时间戳>/
```

### 双 lane 与默认路由（决策点 2 结论）

| lane | 身份 | endpoint | deepseek-v4.1-flash | 凭证文件 |
|---|---|---|---|---|
| `ai` | 国际版 WorkBuddy AI | www.workbuddy.ai | **x0.00 完全免费** | `.wbx/sessions/ai.json` + `.wbx/product/ai.json` |
| `cn` | 国内版 | copilot.tencent.com | x0.03 近免费 | `.wbx/sessions/cn.json` + `.wbx/product/cn.json` |

**默认路由：ai 已登录 → ai（免费），否则 cn；任一 lane 失败/限流自动改投另一 lane（各一次）。**
理由（成本表）：同等任务 ai 成本 0、cn 近免费、ZCode 自身消耗订阅额度，故回退链
**ai → cn → ZCode 自己做**。cn 同时是兜底首选（微信扫码登录路径实测稳定）。

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
| `wbx fanout --file t.json [--lanes ai,cn] [--parallel 2] [--timeout 300] [--retry 1]` | 双 lane 并发池（落盘 job）；`--parallel`=每 lane 并发（默认取 config）；任务级 `as` 可绑定 lane；summary.md 标注 lane 与 `ai→cn` 回退 |
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
| 单任务提示词超长（>25k 字符） | 命令行上限约 32k → 拆分任务，或材料先行精简 |
| 模型输出质量差 | 检查 worker 提示词是否给了硬输出约束；必要时 `--effort medium` |
| 国际版 login 永远 pending | state 丢失 bug → 用命令输出里的锦囊 A/B URL；详见上文「国际版登录的已知 bug 与锦囊」 |
| `Cannot find module ...wbx.mjs` | 命令用了相对路径但当前目录不在项目根 → 先 `cd /d "<项目根目录>"` 再运行，或用绝对路径：`node "<项目根目录>\.zcode\skills\wb-bridge\scripts\wbx.mjs" <子命令>`（路径含空格必须加引号） |

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
