# UI-SPEC — wbx 桥控制台 UI 风格契约（contract **v2.0.0**，当前定版）

## 0. 如何使用本文档

- 本文是控制台（`wbx ui`，http://127.0.0.1:7788）**设计契约**的权威载体：冻结什么、怎么判断新增 vs 变更、走什么程序。
- **token 值不在本文手抄**（避免两份真相）：唯一真源=wbx-ui.mjs 哨兵块 `/* @tokens:begin … end */`（双主题：`:root`=浅色默认、`[data-theme="dark"]`=深色）。指纹复算：`node internal/ui-contract.mjs --print-sha`（现行 **tokens-sha=6e0415da13**，108 条规范化声明）。断言编号/逐值比对/对比度与刻度校验均由 `internal/ui-contract.mjs`（T/C/S/D/H/L/A 族断言）+ `internal/ui-redtest.mjs`（红测）机器执行——「跑脚本」即验收，本文不复制脚本产物。
- 改动判定：先查 §5 判定规则；任何契约变更走 §5.5 程序（三处同步：UI-SPEC → ui-contract 断言/快照 → 代码，红测重跑）。

## 1. Foundations（token 语义分组；键集 66，改名/删除均属契约变更）

| 组 | token（名称即契约） | 语义 |
|---|---|---|
| 表面 | `--bg --panel --panel-inset --hover` | 画布底 / 卡片面 / 面板内次级面 / 悬浮抬升层 |
| 线 | `--line --line-strong --line-ctrl` | 装饰分隔 / 弱控件边界 / 控件边界（对比度达标档） |
| 文本 | `--fg --fg-hi --dim --dim-hi --acc-ink --err-ink` | 主文本 / 强调 / 次级 / 微文本 / 按钮反白文字 / 错误反白 |
| 状态五色 | `--ok --warn --warn2 --err --neutral` | 成功 / 警告 / 高警告 / 失败 / 中性（两两不等由 T5 守护） |
| 淡底/描边 | `--*-soft --*-line`（五色各一对） | 状态淡底 / 徽标描边 |
| 收编色 | `--err-ctrl --hover-ring --hover-soft --scrollbar --scrollbar-hover --panel-fade` | v2.0.0 从硬编码收编（错误控件边/hover 环/hover 底/滚动条×2/面板渐隐） |
| 刻度 | `--s1..--s6`（间距递增）`--r-sm/md/lg/pill` `--fs-xs..xl` `--lh-*` | 单调性由 T3 机器校验 |
| 阴影/动效/字体 | `--shadow-1/2/focus` `--t-fast/base/slow --ease` `--font --mono` | 焦点环与 `:focus-visible` 行为是可测量不变量（§5.2-3） |

深色档覆盖随主题变化的 42 键，其余结构键继承 `:root`。已知迁移债：深色 `--err-ctrl` 对比度偏低（原硬编码态即如此，按「视觉零回归」原样迁移，待后续契约小版本校正）。

## 2. Components（[frozen] 类名契约）

| 组件 | 类名 | 契约要点 |
|---|---|---|
| 徽标 badge | `.badge`（八变体） | 状态/成本/能力语义；形状+颜色双编码（色盲冗余） |
| 成本档 | `.cost` | 五档：免费/近免费/免费·限时配额/会员额度/ChatGPT Plus 额度（随通道枚举） |
| 提示 toast | `toast()`（三型） | 全面替代 alert()（安全层不变量） |
| 表格 | `.tbl-wrap>.tbl`（fixed 布局） | 容器吸收滚动，防整表横向胀开 |
| 按钮 | `.btn-primary/.btn-ghost/.btn-mini`（三档） | 主/次/行内 |
| 表单 | `.form-control` | 边界=--line-ctrl 档 |
| 页签 | `data-tab="status/run/history/login"` | 四页签 IA 冻结 |
| 折叠 | `<details>` + `initAria()` 捕获监听 | aria-expanded 双件（S4） |
| 键值 | `.kv`（96px minmax(0,1fr) 网格）+ `.vtxt` ellipsis | 防溢出三件套（C7） |
| chip | `.chip`（三重编码）+ 通道卡 `.lane-card` | 形状/颜色/文字 |
| 电源开关 | `.power` | 即时写 `disabled-lanes`；路由卡无禁用框（分家） |
| 复制钮 | `.copybtn` | 命令行原样可复制 |
| 通道卡 | `codexCardHtml()/doubaoCardHtml()` 等 | 五 lane 进 `#lane-cards` grid；codex 四态徽标+冷却倒计时；doubao 调试口/拉起详情 |
| 行内详情 | `tr.job-inline + .job-inline-card` | 点击行正下方展开、手风琴单开（页底卡已退役） |
| 主题切换 | `#theme-toggle + initTheme()` + FOUC 首帧脚本 | localStorage `wbx-theme` 缺省 light；PWA 派生色=浅色 --bg 等值（T6） |

「可加/不可加」逐组件口径：新变体/新实例/新文案行=扩展点（§5.2-1 放行）；改已有类名、改共享选择器属性、动 token 值=契约变更（§5.5 程序）。

## 3. Patterns（三条）

1. **三层信息分层**：扫读（表格/chip）→ 详情（行内展开/卡片）→ 排障（折叠详情/复制命令）。
2. **行内展开**：列表点击→紧邻详情，不跳页、不弹层。
3. **状态双编码**：颜色永远伴随形状/文字冗余（四态点/菱/方/环 + 中文标签全映射，S1/S3）。

## 4. Guidelines（收敛版）

- 零依赖零外部资源（无 CDN/字体外链，PWA 图标纯函数自产）；`prefers-reduced-motion` 兜底；`tabular-nums` 用于数字列。
- 正文容器 max-width 1100px；无横向滚动（容器吸收）；到期色阶阈值 ≤0 红 / ≤7 橙 / ≤30 黄 / >30 绿（S2 冻结）。
- 安全面：仅监听 127.0.0.1；Host 白名单 + POST Origin 校验 + shutdown token（daemon-lifecycle 门禁锁定）。

## 5. 不变量与扩展点（契约主体）

### 5.1 冻结范围（改动=契约变更，须用户显式授权）

- **Token 层**：66 键的键集与语义（改名/删除均属变更；值随 v2.0.0 起双主题分层，改任一档取值均属变更）；哨兵块为双主题唯一真源。
- **组件层**：§2 各 [frozen] 组件的类名契约与结构。
- **IA 层**：四页签（状态/调用/历史/登录）与三层信息分层尺子。
- **编码层**：四态→形状→颜色映射；到期色阶阈值（≤0 红 / ≤7 橙 / ≤30 黄 / >30 绿）；成本五档（免费/近免费/免费·限时配额/会员额度/ChatGPT Plus 额度，随通道枚举）。
- **术语层**：通道品牌全称五件套（WorkBuddy AI（国际版）/WorkBuddy（国内版）/Cline CLI（可选通道）/豆包（桌面端）/Codex CLI（ChatGPT Plus·可选通道））+ 冻结中文术语（单条调用（ask）/批量并行（fanout）/思考档/提示词）+ 「诚实声明（三处必读）」全文。
- **安全层**：零依赖零外部资源；toast 全面替代 alert()。

### 5.2 五条判定规则（新增 vs 修改）

1. **新增 vs 修改**：只增加新 token/新组件/新变体，且不改动任何已有 token 的值、不修改已有共享选择器的属性 → 扩展点。一旦修改已有 token 的值或已有共享选择器的属性 → 契约变更。
2. **按名引用检查（重命名即破坏）**：任何 token 或 class 只要被 ≥1 处消费，改名=删除+新增，属契约变更（即使值不变）。删 token 前必须证明零引用。
3. **可测量不变量（无条件触发）**：触碰以下任一项即契约变更——对比度对（ Foundations 全表，由 ui-contract T2/T4/T5 机器校验）、焦点环 `--shadow-focus` 与 `:focus-visible` 行为、徽标形状+颜色双编码、`tabular-nums`、`prefers-reduced-motion` 兜底、控件边界 `--line-ctrl`、无 alert()/无横向滚动。
4. **爆炸半径**：改动只落在单个组件自己的选择器内且该 class 不被复用 → 扩展点；落在 `:root` token、容器宽度（1100px）、间距节奏、字号阶 → 契约。
5. **语义 vs 值（安全迁移路径）**：改某 token 的值是契约变更（消费方依赖其语义）。安全做法：新增语义 token→逐步迁移消费方→旧 token 标 deprecated→下个 contract version 再删。**永远不要原地改值「试试看」。**

### 5.3 一句话判据

**「这次改动会不会让一个与它无关的页面的截图 diff 变化？」** 会 → 契约变更（须授权）；不会 → 内容级增删（放行）。

### 5.4 contract version 语义

- 破坏契约（改值/改名/删键/动共享结构）→ 主版本 +1（tokens-sha 必变，UI-SPEC 与 ui-contract 同步改，红测重跑）。
- 纯新增扩展点（加 token/加组件/加变体）→ 次版本 +1（断言集只追加，tokens-sha 变）。
- 纯内容增删（文案/数据行/已有组件新实例）→ 不动版本。**v22 说明：本轮桥 6.11.0 未动任何 UI 行为，contract 维持 v2.0.0、tokens-sha 不变。**

### 5.5 变更程序

1. 用户（=项目维护者）在新窗口提示词中显式授权（引用 FROZEN.md「UI 契约冻结」项；FROZEN.md 在 internal/，仅维护者本地可见——外部贡献者按本节程序执行）。
2. 同步改三处：UI-SPEC（§1 表 + §6 记录）→ ui-contract 断言/快照 → 代码。
3. 红测重跑（正向变异红 + 负向对照绿 + 恢复自证），ui-contract/ui-redtest/daemon-lifecycle 门禁全绿。
4. 证据回填：HISTORY.md 对应条目（v22 起历史外置）。

## 6. 变更记录（按 contract version 单调排序；全文叙事见 HISTORY.md 各桥版本条）

> 注：本表及全文的「用户」=项目维护者本人（个人项目，无终端用户面）；「用户原话」=维护者立项/裁决原话（沉淀于 internal/MEMORY.md）。

| contract version | 日期 | tokens-sha | 变更摘要 |
|---|---|---|---|
| v1.0.0 | 2026-09-25 | efeee49b0e | 契约起步：v5.3 已收敛风格显式化（58 token + 20 组件 + 3 Pattern + IA/编码/术语冻结）；随桥 v5.4.0 |
| v1.1.0 | 2026-09-25 | efeee49b0e | 历史页详情行内化（授权=用户原话「详细内容直接出现在条目下方」）；caps 选择器/徽标/能力档行/trace-box 新增；H1-H4 断言（19→23） |
| v1.2.0 | 2026-10-03 | efeee49b0e | D2 扩展 doubao（豆包直通落历史）；豆包卡上移/总览 chip/历史表 fixed（内容级） |
| v1.3.0 | 2026-10-03 | efeee49b0e | D2 回退 doubao（授权=用户翻案原话「怎么把我和豆包的聊天记录放进去了……这是错误的」）：TYPE_LABEL 收回，历史页恢复=调度记录语义；登录页豆包说明卡新增 |
| v1.4.0 | 2026-10-03 | efeee49b0e | 内容级 lane 化（授权=「完全lan化」）：doubaoCardHtml 进 grid、成本第四档「会员额度」、路由/下拉 +豆包、锚点 #lane-card-doubao |
| v1.5.0 | 2026-10-14 | 6e0415da13（值零改动） | 内容级 lane 化（授权=「前端 UI 也记得要改」）：codexCardHtml 进 grid、成本第五档「ChatGPT Plus 额度」、四态徽标+冷却倒计时、/api 守卫、FROZEN_TERMS +Codex |
| **v2.0.0** | 2026-10-08 | **6e0415da13**（双主题口径：浅 66+深 42） | **当前定版**。双主题契约变更（授权=用户原话「浅色模式……可相互切换，我个人更喜欢浅色模式」）：token 双调色板分层、收编 8 硬编码色、主题切换管道（FOUC/initTheme/PWA 等值）、T1/T2/T5 重构 + T6 新增（23→24 断言）。注：v1.5.0 晚于 v2.0.0 发布（按桥发布时序），contract 定版以 v2.0.0 为准——v22 修正版本表单调性时保留该注记 |
