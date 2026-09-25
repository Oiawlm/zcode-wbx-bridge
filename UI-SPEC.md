# UI-SPEC — wbx 桥控制台 UI 风格契约（contract v1.0.0）

> 授权来源：用户 2026-09-25「风格和方向可以基本锁定」「该固定的部分先固定下来，之后基本就是
> 新增或者删减一些内容」。冻结登记见 `internal/FROZEN.md`「UI 契约冻结」项；变更须用户显式授权
> 并走 §5 变更程序。

## 0. 如何使用本文档

- **权威源声明**：代码是唯一真源。`wbx-ui.mjs` 的 `:root` 哨兵块（`/* @tokens:begin */` …
  `/* @tokens:end */`）是 token 键集与语义值的权威；本文档 §1 的 token 表是**派生快照**，不一致
  时以代码为准（并意味着本文档过期，须同步）。
- **tokens-sha**：`efeee49b0e`（58 个 token）。算法：取哨兵块内全部 `--name: value;` 声明 →
  每条规范化为 `name=value`（value 转小写、删全部空白）→ 按 name 排序 → `\n` 连接 → sha256 前
  10 位。重算脚本：`node internal/v9-tokens-sha.mjs`。
- **机器验证**：`node internal/ui-contract.mjs`（19 条断言，编号枚举 T1-T5 / C1-C6 / S1-S4 / D1-D4——
  worker B 报告标题称 18 条但其枚举即 19，以枚举为准；T2 为全 58 token 值逐值快照）；与 v6/v7/v8
  回归串行构成发布门禁。断言脚本位于 `internal/`（本仓库 gitignore 的工程内部件，不入发布 bundle）；
  远端仓库以本文档为人读契约。
- **怎么读**：只有 §5（不变量与扩展点）需要反复读——它是契约主体；§1-§4 是可跳读的参照手册；
  §2 组件的实例清单以浏览器实机核对为准（http://127.0.0.1:7788/）。

## 1. Foundations

### 1.1 Token 全表

（派生自 `:root` 哨兵块；表内顺序=源码顺序。「用途」列才是契约主体，值只是快照。）

| 变量 | 值 | 用途 |
|---|---|---|
| --bg | #0f1117 | 画布底 |
| --panel | #171a23 | 卡片/面板 |
| --panel-inset | #1e2230 | 嵌在面板内的次级面（chip/表头/行 hover/禁用控件/option/分段器/折叠容器/任务卡/行内代码） |
| --hover | #232838 | 悬浮/抬升层 |
| --line | #2a2f40 | 装饰性分隔线（1.31:1，只作分隔不作控件边界） |
| --line-strong | #3a4160 | 弱控件边界/强调分隔（ghost 按钮边框、表头下边） |
| --line-ctrl | #5c6684 | 控件边界 WCAG 版（3.05:1，输入框/开关/复制钮边框） |
| --fg | #e6e9f2 | 主文本 |
| --fg-hi | #ffffff | 标题/强调 |
| --dim | #9aa3b8 | 次级文本（≥13px 场景） |
| --dim-hi | #aab2c6 | 12px 微文本/键值行标签（8.19:1） |
| --acc | #5b8cff | 主色（按钮底/下划线/聚焦环/进行中环） |
| --acc-text | #7fa5ff | 主色文字版：淡底/soft 底上的主色文字（链接、badge.acc、cost.acc、mini） |
| --acc-hover | #4a7aeb | 主色 hover（btn-primary:hover 底色） |
| --ok | #3ecf8e | 成功态 |
| --warn | #f0b429 | 警告态（将到期 8-30 天/近免费） |
| --warn2 | #ffa94d | 高警告态（将过期 1-7 天） |
| --err | #ff6b6b | 失败态 |
| --neutral | #9aa3b8 | 中性态（=--dim 值，语义独立） |
| --acc-soft | rgba(91,140,255,.14) | 主色淡底 |
| --ok-soft | rgba(62,207,142,.14) | 成功淡底 |
| --warn-soft | rgba(240,180,41,.14) | 警告淡底 |
| --warn2-soft | rgba(255,169,77,.14) | 高警告淡底 |
| --err-soft | rgba(255,107,107,.14) | 失败淡底 |
| --neutral-soft | rgba(154,163,184,.12) | 中性淡底 |
| --acc-line | rgba(91,140,255,.35) | 主色徽标描边 |
| --ok-line | rgba(62,207,142,.35) | 成功描边 |
| --warn-line | rgba(240,180,41,.35) | 警告描边 |
| --warn2-line | rgba(255,169,77,.35) | 高警告描边 |
| --err-line | rgba(255,107,107,.35) | 失败描边 |
| --neutral-line | rgba(154,163,184,.35) | 中性描边 |
| --s1 | 4px | 间距 1：徽标内距、图标与文字 |
| --s2 | 8px | 间距 2：键值行上下、按钮内距 |
| --s3 | 12px | 间距 3：卡头内距、行间距 |
| --s4 | 16px | 间距 4：卡片 padding、组间距 |
| --s5 | 24px | 间距 5：分区段之间 |
| --s6 | 32px | 间距 6：页面级留白 |
| --r-sm | 4px | 圆角小：徽标、小控件 |
| --r-md | 8px | 圆角中：卡片、按钮、输入框 |
| --r-lg | 12px | 圆角大：弹层、大容器 |
| --r-pill | 999px | 胶囊：状态点、chip、开关 |
| --fs-xs | 12px | 微标签、表头、键值标签 |
| --fs-sm | 13px | 次级信息、表格、按钮 |
| --fs-md | 14px | 正文（默认） |
| --fs-lg | 17px | 面板标题 |
| --fs-xl | 20px | 页面标题 |
| --lh-tight | 1.3 | 标题行高 |
| --lh-base | 1.65 | 中文正文行高 |
| --lh-loose | 1.75 | 长段落行高 |
| --shadow-1 | 0 1px 2px rgba(0,0,0,.35) | 静置卡片 |
| --shadow-2 | 0 4px 16px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04) | 悬浮卡片/toast |
| --shadow-focus | 0 0 0 3px rgba(91,140,255,.28) | 聚焦环（唯一焦点指示） |
| --t-fast | 120ms | 颜色/边框过渡 |
| --t-base | 180ms | 抬升/下划线过渡 |
| --t-slow | 280ms | 弹层（toast）过渡 |
| --ease | cubic-bezier(.2,.8,.2,1) | 统一缓动 |
| --font | system-ui,"Segoe UI","Microsoft YaHei UI","PingFang SC",sans-serif | 字体栈（全本地） |
| --mono | ui-monospace,"Cascadia Mono",Consolas,"Courier New",monospace | 等宽栈（命令/ID/代码） |

### 1.2 对比度清单（视为不变量）

正文级（≥4.5:1）：

| 组合 | 实测值 | 结论 |
|---|---|---|
| --fg / --panel | 14.3 | ✅ |
| --fg / --bg | 15.6 | ✅ |
| --dim / --panel | 6.87 | ✅ |
| --dim / --panel-inset | 6.26 | ✅ |
| --dim / --bg | 7.46 | ✅ |
| --acc / --panel | 5.49 | ✅ |
| --ok / --panel | 8.71 | ✅ |
| --warn / --panel | 9.32 | ✅ |
| --err / --panel | 6.26 | ✅ |
| --acc-text / --acc-soft | 5.92 | ✅ |
| --dim-hi（12px 微文本） | 8.19 | ✅ |

非文本（≥3:1）：

| 组合 | 实测值 | 结论 |
|---|---|---|
| 聚焦环 --acc / --panel | 5.49 | ✅ |
| 控件边界 --line-ctrl | 3.05 | ✅ 唯一合规的控件边界 |
| 控件边界 --line | 1.31 | ❌ 只作装饰分隔 |
| 控件边界 --line-strong | 1.74 | ❌ 只作弱边界/ghost 边框 |
| 状态点/soft 底 ok | 6.71 | ✅ |
| 状态点/soft 底 warn | 7.04 | ✅ |
| 状态点/soft 底 err | 5.17 | ✅ |
| 状态点/soft 底 acc（--acc-text） | 5.92 | ✅ |

**规则一：主色淡底文字必须用 `--acc-text`，不得用 `--acc`（`--acc`/`--acc-soft` 仅 4.50 临界）。**
**规则二：控件边界必须用 `--line-ctrl`（3.05:1）；`--line`/`--line-strong` 不得作为可交互边界。**
禁用态文字豁免至 3:1，但必须同时降不透明度 + 保留 `cursor:not-allowed`，不能只靠颜色变淡。

### 1.3 动效与 reduced-motion

| Token | 时长 | 用途 |
|---|---|---|
| --t-fast | 120ms | 颜色/边框过渡 |
| --t-base | 180ms | 抬升/下划线过渡、toast 退场 |
| --t-slow | 280ms | toast 入场 |

| keyframes | 行为 | 时长 |
|---|---|---|
| wbx-pulse | 进行中呼吸：box-shadow 0→4px 扩散 + opacity 1→.75 | 2s infinite |
| toast-in | 右下角入场 translateY(8px) scale(.98) | --t-slow 280ms |
| toast-out | 退场同向反向（leaving 后 320ms remove） | --t-base 180ms |
| sp | spinner 旋转 | 1s linear |

`@media (prefers-reduced-motion:reduce)` 降级：呼吸（badge.run::before/.dot--running）与 spinner
动画置 none 且 opacity 恢复 1；toast 动画时长压到 1ms；卡片 hover 抬升取消。

产品感手法（冻结）：①卡片悬浮微抬升（包 `@media(hover:hover)` 防触屏粘滞，1px 位移不做放大）；
②tab 下划线 scaleX 动效（transform 走合成层，不触发重排）；③等宽数字；④只给「进行中」态加呼吸
（不全量加）；⑤滚动条着色（`scrollbar-gutter:stable` 防出现滚动条时布局横跳）。

### 1.4 中文排版规则

1. 字重分层：标题 600/--fg、正文 400/--fg、次级 400/--dim——同级字号靠字重+颜色分层，不只靠字号。
2. 字距：段标题 .08em、表头 .06em、卡题 .01em、kv 标签 .02em——以字距建立层级。
3. 中文不做 uppercase——层级靠字距+左侧色条，成本最低。
4. 行高：中文正文用 --lh-base 1.65。
5. Windows 上不加 `-webkit-font-smoothing: antialiased`——中文会变细发虚，默认 subpixel。
6. 数值/耗时/计数统一 `.num`（tabular-nums）——刷新时数字宽度不跳动。
7. 命令/路径/ID 用 --mono——全本地等宽栈，零外链。

## 2. Components

组件层契约。结构/API 取自实机 DOM 与源码核对（http://127.0.0.1:7788/ 四页签逐页走查），
类名与 token 名逐字一致。`[frozen]`＝不变量（类名契约+结构冻结，文案与实例可增）；
`[extension]`＝结构可增、内容可扩。「机器断言」标注=internal/ui-contract.mjs 的对应断言族。

### 反馈类

#### badge `.badge` [frozen]
- **结构**：inline-flex、--fs-xs、line-height 18px、padding 2px 8px、--r-sm；`::before` 6px 形状点；字/底/边三件套=各自 `X`/`X-soft`/`X-line` token 组。
- **API**：变体 `.ok/.warn/.warn2/.err/.neutral/.acc/.absent/.run`；形状：ok=实心圆●、warn/warn2=菱形◆(rotate45)、err=方块■、neutral=空心环○、acc=实心圆、absent=虚线环（无底虚线边框+--dim-hi 字）、run=空心环+wbx-pulse 呼吸；无尺寸档、无槽位。
- **用法**：通道卡头状态徽标（已登录/未登录/已过期/将到期/将过期/未安装/已停用）、体检通过/未通过、任务成功/失败、job 已完成/进行中(run)、登录成功/超时/出错、模板有无。
- **Do**：只承载「一眼一态」，用各自语义色 token 组；进行中用 `.run` 让呼吸只在必要处出现。
- **Don't**：不要用 `--line` 当徽标描边（1.31:1 不可见）；淡底上主色文字不要写 `--acc`（必须 `--acc-text`）；不要自造第五种形状。
- **何时不用**：状态需要一句解释或可操作入口时，用 empty-state 的 CTA 或 toast——badge 读不出「为什么/怎么办」。
- **A11y 与不变量**：状态色永不单独承载语义，形状双编码兜底（机器断言 S1/S3）；`.run` 呼吸受 reduced-motion 降级（人工走查项）。
- **相关组件**：chip、status-dot、kv。

#### toast `.toast` [frozen]
- **结构**：`.toasts` fixed 右下 z-9999 竖列 + `.toast`（--panel 底+--line-strong 边+左 3px 色条+--shadow-2）。
- **API**：变体 `.info`(--acc)/`.success`(--ok)/`.error`(--err)；error 常驻+`.toast__close`×钮；info/success 4s 自动退场（leaving→320ms 后 remove）；入场 toast-in 280ms、退场 toast-out 180ms。
- **用法**：已停用/已启用/写入失败/已复制/复制失败/历史加载失败；替代全部 `alert()`。
- **Do**：即时可逆操作的结果反馈统一走 toast；error 必须带关闭钮。
- **Don't**：不要用 `alert()`/`confirm()`（机器断言 D4）；info/success 不要设常驻——4s 退场是冻结节奏。
- **何时不用**：需要用户先选择再继续的阻塞式交互（本控制台没有也不新增确认流）；表单/结果内的错误原文用 err-box（可复制、可留档）。
- **A11y 与不变量**：左色条+文案双编码；reduced-motion 下动画压到 1ms（人工走查项）。
- **相关组件**：copy-button、button、empty-state。

#### 成本徽标 `.cost` [frozen]
- **结构**：inline-flex padding 2px 10px、--r-pill、--fs-xs 500 nowrap、cursor:help；纯胶囊无形状，细则进 title。
- **API**：三档 `.acc`（免费，--acc-text 字+--acc-soft 底）/`.neutral`（近免费，--dim-hi 字+--neutral-soft 底）/`.warn`（免费·限时配额，--warn 字+--warn-soft 底）；title=原始口径全文。
- **用法**：通道卡扫读层成本行（ai=免费/cn=近免费/cline=免费·限时配额）。
- **Do**：成本一律三档枚举，原始口径（x0.00/x0.03/限时轮换说明）进 title。
- **Don't**：不要新造成本档位措辞（三档是编码层冻结）；不要加形状点（与 badge 刻意区分）。
- **何时不用**：非成本语义的强调用 badge；成本徽标只承载「这条通道花不花钱」。
- **A11y 与不变量**：三档映射为编码层冻结（机器断言 S3 守护标签映射的存在性机制）；title 兜底完整口径。
- **相关组件**：badge、kv。

#### status-dot `.dot--running` [extension]
- **结构**：8px 空心环（1.5px --acc 边）+ wbx-pulse 2s 呼吸；与 `.badge.run::before` 同源。
- **API**：仅此一态；无变体/尺寸/槽位。
- **用法**：执行中 runline、登录轮询中、体检中。
- **Do**：与文字标签同行出现，让「呼吸=进行中」语义可学。
- **Don't**：不要给成功/失败/空闲态加呼吸（稀释异常信号）；不改尺寸与色（与 badge.run 同源）。
- **何时不用**：终态用 badge；呼吸只表示「此刻还在动」。
- **A11y 与不变量**：reduced-motion 置 none+opacity 1（人工走查项）；--acc/--panel=5.49 达非文本 3:1。
- **相关组件**：badge、spinner。

#### empty-state `.empty` [extension]
- **结构**：居中 padding --s5/--s4；`.e1` --fs-md 500 --fg 主文案（可带 .hint 时间戳）；`.e2` --dim 说明；CTA 按钮。
- **API**：主文案槽（可选 .hint）、说明槽、CTA 槽；无变体。
- **用法**：体检空态（尚未体检+上次 N 分钟前[localStorage]+一键体检）。
- **Do**：说明「为什么空」+给唯一下一步动作；动态时间戳放 .hint 次级位。
- **Don't**：CTA 必须是真实按钮，说明文字不可点。
- **何时不用**：加载中用 spinner/呼吸点；表格空数据用表内「（空）」hint 单元格。
- **A11y 与不变量**：对比 --fg/--panel=14.3、--dim/--panel=6.87；CTA 走 button 焦点环。
- **相关组件**：button、card、spinner。

#### spinner `.spin` [extension]
- **结构**：13px 圆环、2px --dim 边+--acc 顶边、sp 1s linear 旋转、vertical-align -2px。
- **API**：无变体；靠 `hidden` 属性切换显隐。
- **用法**：登录按钮内联忙碌指示。
- **Do**：只作按钮内联忙碌指示，基线对齐已调好。
- **Don't**：不要自建第二套旋转动画；不要用于页面级加载（行内 runline 用呼吸点）。
- **何时不用**：行内状态位（runline、卡头）用 .dot--running。
- **A11y 与不变量**：reduced-motion 降级后靠按钮 disabled+文案表达进行中（人工走查项）。
- **相关组件**：button、status-dot。

### 结构类

#### card `.card` [extension]
- **结构**：--panel 底+--line 边+--r-md+--shadow-1+margin-bottom --s4+scroll-margin-top --s4；hover(`@media(hover:hover)`) translateY(-1px)+--shadow-2+边框亮化；`.off` 变体（bd/title/sub opacity .62）；grid3 内 margin-bottom:0。
- **API**：变体 `.off`；槽位=卡头/卡体/任意内容。
- **用法**：通道卡×3（grid3）、路由卡、体检卡、调用卡、历史表卡、job 详情卡、登录卡×2。
- **Do**：抬升只 1px 且包 hover:hover；停用卡用 `.off` 降亮而非改文字色。
- **Don't**：不要用 --line 表达可交互边界（只作装饰分隔 1.31:1）。
- **何时不用**：多个同级条目天然成表时用 table，不堆卡片。
- **A11y 与不变量**：reduced-motion 下 hover 抬升取消（人工走查项）；scroll-margin-top 保证锚点跳转不吸顶（机器断言 C1 查 .card 存在）。
- **相关组件**：card__hd、sect、table、chip。

#### card__hd `.card__hd` [extension]
- **结构**：flex align-center gap --s3、min-height 44px、padding 0 --s4、下边框 --line、可换行；`.card__title` --fs-md 600 --fg 字距 .01em；`.card__sub` --fs-xs --dim ellipsis nowrap min-width 0（title 兜底）；`.card__bd` padding --s4。
- **API**：标题槽、副标题槽、右侧随行槽（徽标/分段器/开关；`.right`=margin-left auto）。
- **用法**：所有卡的卡头；通道卡头=品牌全称+状态徽标+账号 sub+电源开关。
- **Do**：右侧随行件用 `.right`；长 sub 加 title 兜底截断。
- **Don't**：不要让长 sub 撑破卡头（min-width 0+nowrap 已定）。
- **何时不用**：无标题纯内容块不建卡头。
- **A11y 与不变量**：标题 600/--fg 与正文 400 靠字重分层。
- **相关组件**：card、sect、kv。

#### sect `.sect` [extension]
- **结构**：--fs-xs 600 --dim 字距 .08em + `::before` 2×12px r1 --acc 色条；margin --s4 0 --s2。
- **API**：一行文本；无变体/槽位。
- **用法**：job 详情「概览/任务/产物」。
- **Do**：用字距+左色条建层级。
- **Don't**：中文不做 uppercase。
- **何时不用**：卡级标题用 .card__title；sect 只在卡体内部再分节。
- **A11y 与不变量**：.08em/--dim 为冻结排版值。
- **相关组件**：card__hd、kv。

#### kv `.kv` [frozen]
- **结构**：grid 96px+minmax(0,1fr)、gap 3px --s3、baseline；`.k` --fs-xs --dim-hi 字距 .02em nowrap；`.v` --fs-sm --fg flex+gap 6px+tabular-nums；`.vtxt` ellipsis+nowrap+min-width 0+title 兜底；徽标/成本胶囊 flex:none；分隔线只画组间。
- **API**：标签槽 .k、值槽 .v、文本值 .vtxt；无变体。
- **用法**：通道卡扫读层（成本/模型/凭证到期）、详情层（endpoint/登录模板/免费模型/思考压缩/二进制/登录方式）、job 概览（状态/成功率/通道分布/目录）。
- **Do**：值内徽标给 flex:none；.vtxt 加 title。
- **Don't**：不要逐行画分隔线（只画组间）；可复制值不要写成纯文本（走 copyline/copybtn）。
- **何时不用**：多行等宽文本（提示词/错误原文）用 .dbd/err-box，不塞 kv。
- **A11y 与不变量**：.k 用 --dim-hi（12px 微文本 8.19:1）；96px+minmax(0,1fr) 防溢出结构为冻结不变量（机器断言 C1 + v8 ①a）。
- **相关组件**：badge、chip、copy-button、card__hd。

#### chip `.chip` [frozen]
- **结构**：inline-flex pill、--panel-inset 底+--line 边、gap 6px、padding 4px 10px、--fs-xs nowrap；hover --hover 底+--line-ctrl 边（--t-fast）；内含 `.shp` 7px 形状+`.c-*` 状态色（currentColor）+通道名+`.sig` --dim-hi 信号；锚点 href="#lane-card-*"。
- **API**：形状 .s-dot/.s-dia/.s-sq/.s-ring、色 .c-ok/.c-warn/.c-warn2/.c-err/.c-neutral/.c-acc、.sig 信号词、锚点 href。
- **用法**：健康总览条三枚通道 chip（P1）。
- **Do**：形状+色+信号词成对出现（三重编码）；hover 边界切 --line-ctrl（3.05:1）。
- **Don't**：不要让信号词单独承载状态；不要用 --line 作可交互边界。
- **何时不用**：卡内单字段用 kv/badge；chip 专服务总览条的跨通道聚合扫读。
- **A11y 与不变量**：四形状类冻结（机器断言 S1/C1）；.sig --dim-hi 8.19:1。
- **相关组件**：badge、status-dot、card。

### 数据类

#### table `.tbl` [frozen]
- **结构**：`.tbl-wrap` overflow auto+--line 边+--r-sm（滚动被容器吸收）；`.tbl` 100% separate border-spacing 0 --fs-sm；`th` sticky top 0 z2、--panel-inset 底+--line-strong 下边、34px、--fs-xs --dim 字距 .06em nowrap；`td` 38px --line 下边（末行无）；行 hover --panel-inset（--t-fast）；`.num` 列右对齐 width 1% nowrap；`td.mono` --dim-hi cursor copy；无斑马纹。
- **API**：th/td/.num 列/td.mono 可复制列；无变体。
- **用法**：历史表（时间/类型徽标/任务数/成功率/任务 ID）。
- **Do**：滚动交给 .tbl-wrap；表头 sticky 吸顶；可复制列加 td.mono。
- **Don't**：不要加斑马纹（hover 已足够区分）；表头下边不要用 --line（层级读不出）。
- **何时不用**：行内需展开详情时在表下挂 details/手风琴（job-detail 模式），不嵌套网格。
- **A11y 与不变量**：容器包裹防横向滚动为机器断言（C2+C3）；1100px 正文容器（C4）。
- **相关组件**：num、badge、details、copy-button。

#### num `.num` [extension]
- **结构**：font-variant-numeric tabular-nums + `font-feature-settings:"tnum" 1`。
- **API**：纯工具类，无变体/槽位。
- **用法**：所有数值/耗时/计数/ID。
- **Do**：数值一律带 .num（.kv .v 已内建）。
- **Don't**：不要只在部分数值上加（漏加的列刷新时跳宽）。
- **何时不用**：命令/路径用 --mono，中文文本不用。
- **A11y 与不变量**：等宽数字为冻结产品手法。
- **相关组件**：kv、table、copyline。

### 输入类

#### button `.btn-primary/.btn-ghost/.btn-danger` [frozen]
- **结构**：统一 inline-flex 32px、padding 0 14px、--r-sm、--fs-sm 500 nowrap+三属性 --t-fast 过渡；`.btn-block` 全宽 38px 左对齐 margin-bottom --s2。
- **API**：`.btn-primary`（--acc 底+#0b1020 字 5.99:1/hover --acc-hover）、`.btn-ghost`（透明底 --fg 字 --line-strong 边/hover 白 .05 底 --dim 边）、`.btn-danger`（透明底 --err 字红边/hover --err-soft 底；本控制台无破坏性主操作，实心 danger 预留不用）；态 focus-visible→shadow-focus、disabled opacity .5+not-allowed。
- **用法**：执行单条调用/执行批量并行/一键体检/刷新/+添加任务行/登录两钮（block）。
- **Do**：每屏一个 primary 其余 ghost；登录等主操作用 .btn-block。
- **Don't**：不要用实心 danger（无破坏性主操作）；不要拿 --line-strong 当输入边界语义。
- **何时不用**：即时可逆开关（停用通道）用 .power 胶囊，不用按钮+确认（P3）。
- **A11y 与不变量**：focus-visible+shadow-focus 为唯一焦点指示（人工走查项）；disabled 降亮+not-allowed 双信号。
- **相关组件**：spinner、toast、empty-state。

#### 分段器 `.seg` [frozen]
- **结构**：inline-flex gap 2px padding 2px、--panel-inset 底+--line 边+--r-pill、flex-wrap；按钮 26px padding 0 12px --fs-xs 500 --dim，hover --fg+--hover 底；active --acc 底+#0b1020 字。
- **API**：`button[data-v]`+`.active`；focus-visible→shadow-focus。
- **用法**：路由四选（自动/固定三通道）、调用页模式（单条调用/批量并行）、单条调用通道选择。
- **Do**：互斥小选项组用 seg（2-4 个选项）；当前值用 active 态表达。
- **Don't**：不要用于页面级切换（那是 tabs 的职责）；不要多于 4 项（放 select）。
- **何时不用**：两项以上有层级或带说明的选择用 select+label。
- **A11y 与不变量**：active 仅 class 表达（与 tabs 同为已知 aria 缺口，走键盘焦点环）；--acc 底对比 5.99:1。
- **相关组件**：tabs、button、form-control。

#### form-control `input/select/textarea` [frozen]
- **结构**：input[text]/select 高 32px、textarea min 110px 竖向 resize+--mono --fs-xs；--bg 底（比 panel 深成内凹）+--line-ctrl 边+--r-sm；`.row` flex gap --s3 wrap，label inline-flex gap 6px。
- **API**：focus-visible→--acc 边+shadow-focus；placeholder --dim；disabled opacity .55+not-allowed+--panel-inset 底；select appearance none+双 linear-gradient 纯 CSS 箭头。
- **用法**：提示词 textarea、任务 ID/模型/超时/并发、免费模型 select、通道下拉。
- **Do**：用 .row 承载同行多控件；每个控件配真实 label。
- **Don't**：placeholder 不作唯一标签；select 箭头不自绘外链方案；控件边框必须 --line-ctrl。
- **何时不用**：布尔开关用 .power；只读展示用 kv/copyline，不用禁用输入框。
- **A11y 与不变量**：控件边界 --line-ctrl=3.05（规则二）；focus --acc 边+shadow-focus。
- **相关组件**：button、details、toast。

#### 电源开关 `.power` [frozen]
- **结构**：appearance none 36×20 纯 CSS 胶囊（--panel-inset 底+--line-ctrl 边+--r-pill）；`::after` 14px 圆点 translateY(-50%) 滑动；勾选=--acc 底+#0b1020 点 translate 16px。
- **API**：checked=启用/unchecked=停用；disabled opacity .5；focus-visible→shadow-focus；aria-label「启用或停用 <通道>」+title。
- **用法**：通道卡头停用开关（P3 即时写 config）。
- **Do**：label.pwr 包裹（点击热区=整个胶囊）；aria-label 说明作用。
- **Don't**：不要加确认弹窗（即时可逆，P3 冻结）。
- **何时不用**：多项一次性提交的场景（本控制台无表单提交语义）。
- **A11y 与不变量**：focus-visible+shadow-focus；边界 --line-ctrl。
- **相关组件**：button、card__hd、toast。

### 导航类

#### tabs `nav button` [frozen]
- **结构**：透明底 relative、padding 0 --s3、--fs-sm --dim；hover --fg；active --fg+`::after` 2px --acc 下划线 scaleX(0→1) origin left --t-base。
- **API**：data-tab 切换 main section.on；focus-visible→shadow-focus+--r-sm。
- **用法**：顶部四页签（状态/调用/历史/登录）——IA 冻结。
- **Do**：下划线动效走 transform 合成层。
- **Don't**：不要给 active 加背景填充（--fg+下划线已表达）；不要新增第五页签而不走契约变更（IA 四页签冻结）。
- **何时不用**：卡内二级切换用卡头分段器 `.seg`，不用页签。
- **A11y 与不变量**：active 仅 class 表达（无 aria-current——已知缺口，键盘用户靠焦点环，列入走查清单）；四页签标签（状态/调用/历史/登录）为 IA 冻结，由机器断言 D1 守护。
- **相关组件**：card、details、seg。

#### details `details` [frozen]
- **结构**：--panel-inset 底+--line 边+--r-sm、margin-top --s3；summary --fs-xs --dim-hi 无 marker+`::before` 4px --dim 三角 --t-fast（open 时 rotate90）；`.adv-sum` 右侧摘要；`.dbd` padding --s2 --s3 --s3。
- **API**：summary/.adv-sum/.dbd；aria-expanded 由捕获 toggle 监听+initAria() 同步。
- **用法**：高级（思考档/模型/超时/并发摘要）、详情与排障、体检三分组、任务提示词、summary.md、cline 引导。
- **Do**：折叠态用 .adv-sum 暴露当前值；aria-expanded 同步保证键盘一致。
- **Don't**：不要隐藏 marker 后不给三角；高频操作不藏进 details（三层尺子：高频在扫读层）。
- **何时不用**：整页/整卡切换用 tabs。
- **A11y 与不变量**：aria-expanded 初始化+document 级捕获监听为机器断言（S4）。
- **相关组件**：card、sect、kv、copy-button。

#### copy-button `.copybtn` [frozen]
- **结构**：`.copybtn` 20px 高、字面 11px、--line-ctrl 边透明底 --dim-hi 字「复制」/hover --fg+--dim 边；`.copyline` --mono --fs-xs 全可换行 --bg 底+--line 边行。
- **API**：copybtn 触发钮+copyline 承载行；点击→clipboard API（降级 execCommand）→toast「已复制」/「复制失败」。
- **用法**：endpoint、cline 登录命令、job 目录/ID、体检失败步骤、authUrl tips。
- **Do**：命令/路径/ID 放 .copyline；复制回执走 toast。
- **Don't**：不自建反馈通道；hover 边框按冻结值（--dim）。
- **何时不用**：纯展示值用 kv .v。
- **A11y 与不变量**：边界 --line-ctrl=3.05；--mono 全本地栈（C5 零外链守护）。
- **相关组件**：toast、kv、details、table。

## 3. Patterns

### P1 健康总览条聚合着色

每通道经 laneTier() 定级：rank 0=err（未登录/已过期）< 1=warn2（将过期 ≤7 天）< 2=warn（将到期
8-30 天/cline 未登录）< 3=neutral（已停用/未安装 absent）< 4=ok（已登录）。总览条取 worst rank
决定左边条色（t-ok/t-warn/t-warn2/t-err/t-neutral）与结论文案：全 ok 时前缀「一切正常 ·」+「N/3
通道可用」+降级计数+停用计数+当前路由。chips 逐通道=形状+色+信号词三重编码，锚点跳转通道卡。
通道卡排序=rank 升序（异常置顶）再按 ai/cn/cline。**冻结点**：四态编码映射、rank 次序、聚合规则、
「异常置顶」排序（机器断言 S2/S3 守护映射与阈值）。

### P2 结果卡渲染

task-card=hd（成功/失败徽标+通道（含回退链 from→to）+耗时+token in/out+尝试次数+模型）+
mdwrap clamp（markdown 渲染默认 12.5em 截断+底部渐变遮罩；enhanceClamps 按实际高度决定是否出现
「展开全文/收起」）+err-box（错误原文+errorHint 友好提示——免费额度/促销轮换/模型下线三类分类）
+jobFoot（job id mono+目录+`wbx history <id>` 回放命令复制）。**冻结点**：截断+展开模式、错误两层
结构（原文不被覆盖）、回放入口常在。

### P3 即时可逆操作（停用开关）

`.power` 胶囊 change→POST /api/config（disabled-lanes）→toast 回执→loadStatus 即时重排。**无确认
弹窗**——即时可逆操作不做确认流（本控制台唯一「危险感」操作即停用通道，可逆且即时生效）。固定路由
指向已停用通道时，路由卡内 route-warn 行内黄条提示（不弹窗）。**冻结点**：无 alert/confirm、toast
回执、即时重排（机器断言 D4 守护 alert 零命中）。

## 4. Guidelines

### 4.1 文案与术语

术语以「v5.2 冻结术语表（WBX.md v5.2 章）」为准，本节不重复清单，只立规则：

1. **文案是扩展点，可改**：措辞、说明、CTA 文字可按语境重写。
2. **数据层英文枚举不动**：`type=ask|fanout|unknown`、`status=done|running|pending`、任务
   `success|failed` 原值直出，展示层不翻译不改写（机器断言 D2）。
3. **状态词用冻结术语**：成功/失败/进行中/等待中/已完成/未知（机器断言 D1/S3 守护）。
4. **数值排版**：数值/耗时/计数用 .num，命令/路径/ID 用 --mono。
5. **错误消息两层**：err-box 保留错误原文，errorHint 另起友好提示，不覆盖原文。

### 4.2 Do / Don't 总表

| 主题 | Do | Don't |
|---|---|---|
| Token 使用 | 颜色/间距/圆角/字号/时长一律取 58 token，`:root` 哨兵块为唯一真源 | 硬编码 #hex 或裸 px 绕过 token（机器断言 T4） |
| 控件边界色 | 用 `--line-ctrl`（3.05:1） | 用 `--line`/`--line-strong` 当控件边界 |
| 淡底主色文字 | 用 `--acc-text`（5.92:1） | 在 `--acc-soft` 上用 `--acc`（4.50 临界） |
| 状态编码 | 形状+颜色双编码 | 仅靠颜色区分状态 |
| 间距 | 用 `--s1`…`--s6` 阶梯 | 随手写 margin/padding 魔法数 |
| 动效 | 只给「进行中」态加呼吸 | 全量加动画；hover 放大（抬升仅 1px） |
| reduced-motion | 遵守三档降级 | 忽略 reduce 强行动画 |
| 术语 | 用冻结术语 | 自造「运行中」「报错」等同义词 |
| 无障碍 | 焦点用 `--shadow-focus` 唯一指示；控件配真实 label | 移除 focus-visible；placeholder 当唯一标签 |
| 中文排版 | 不做 uppercase，字距+色条建层级 | 中文 uppercase；加 antialiased |
| 数值 | .num 等宽 | 比例字体数字（刷新跳宽） |
| 停用态 | `.off` opacity .62 降亮 | 停用只改文字不降亮 |
| 反馈 | toast 替代全部 alert() | 使用 alert()/confirm()（机器断言 D4） |
| 零依赖 | 全本地字体栈、纯 CSS 图形、仅 127.0.0.1 | 引入框架/CDN/字体外链（机器断言 C5） |
| 三层分层 | 高频在扫读层，次级进 details | 把高频操作藏进折叠层 |

### 4.3 人工视觉走查清单（发布前逐项）

1. 900px 窄窗无横向滚动、内容不裁切。
2. 四页签逐页打开，无布局错位、无未加载占位。
3. 停用通道：power 关闭→卡片 .off+即时重排+toast，无确认弹窗。
4. 体检结果三分组展开/收起，aria-expanded 同步。
5. 悬浮态：chip/按钮 hover 底色边界按 token 变化。
6. 卡片 hover 抬升 1px+shadow-2，触屏不粘滞。
7. Tab 遍历全部可交互件，focus-visible 均有 shadow-focus。
8. 模拟 prefers-reduced-motion：呼吸/spinner 停、toast 近瞬时、卡片抬升取消。
9. 对比度抽查：淡底主色文字为 --acc-text、控件边界为 --line-ctrl。
10. toast 三类型：info/success 4s 退场，error 常驻带关闭钮。

### 4.4 程序断言的天花板（诚实声明）

程序断言（curl 页面+源码切片正则）能防：token 键集与**全部 58 值**漂移（T1/T2）、刻度单调（T3）、
绕过 token 直写 **hex** 颜色（T4；rgb()/hsl()/具名色直写为已声明盲区，靠走查清单兜底）、关键类失联
（C1，选择器匹配空白容差）、横向滚动结构（C2/C3/C4）、外链破坏离线（C5）、切片失效静默全绿（C6 +
T4/C3/C5/D4 的保活前置）、形状双编码（S1）、阈值乱序（S2）、状态无标签（S3）、aria 回归（S4）、
术语/数据层脱钩（D1/D2/D3）、弹窗绕过 toast（D4）。

防不了：动态渲染结果、真实层叠与计算样式、动画实际表现、视口/窄窗行为——这些只能在浏览器里看。
因此护栏=程序断言+人工视觉走查清单两层，缺一不可。视觉回归截图 diff 明确不引入：违背零依赖离线
红线、跨 OS 字体渲染假阳性、单人低频改版性价比为负；退出条件=未来多人协作或高频改版时重估。

## 5. 不变量与扩展点（契约主体）

### 5.1 冻结范围（改动=契约变更，须用户显式授权）

- **Token 层**：58 个 token 的键集与语义值（改名/改值/删除均属变更）；`:root` 哨兵块为唯一真源。
- **组件层**：§2 各 [frozen] 组件的类名契约与结构（badge 八变体、toast 三型、table 容器、button
  三档、form-control、tabs 四页签、details aria 机制、kv 网格、chip 三重编码、power、copybtn）。
- **IA 层**：四页签（状态/调用/历史/登录）与三层信息分层尺子（扫读→详情→排障）。
- **编码层**：四态→形状→颜色映射；到期色阶阈值（≤0 红 / ≤7 橙 / ≤30 黄 / >30 绿）；成本三档
  （免费/近免费/免费·限时配额）。
- **术语层**：v5.2 冻结术语表全文继承。
- **安全层**：零依赖零外部资源；toast 全面替代 alert()。

### 5.2 五条判定规则（新增 vs 修改）

1. **新增 vs 修改**：只增加新 token/新组件/新变体，且不改动任何已有 token 的值、不修改已有共享
   选择器的属性 → 扩展点。一旦修改已有 token 的值或已有共享选择器的属性 → 契约变更。
2. **按名引用检查（重命名即破坏）**：任何 token 或 class 只要被 ≥1 处消费，改名=删除+新增，属
   契约变更（即使值不变）。删 token 前必须证明零引用。
3. **可测量不变量（无条件触发）**：触碰以下任一项即契约变更——对比度对（§1.2 全表）、焦点环
   `--shadow-focus` 与 `:focus-visible` 行为、徽标形状+颜色双编码、`tabular-nums`、
   `prefers-reduced-motion` 兜底、控件边界 `--line-ctrl`、无 alert()/无横向滚动。
4. **爆炸半径**：改动只落在单个组件自己的选择器内且该 class 不被复用 → 扩展点；落在 `:root`
   token、容器宽度（1100px）、间距节奏、字号阶 → 契约。
5. **语义 vs 值（安全迁移路径）**：改某 token 的值是契约变更（消费方依赖其语义）。安全做法：新增
   语义 token→逐步迁移消费方→旧 token 标 deprecated→下个 contract version 再删。**永远不要原地
   改值「试试看」。**

### 5.3 一句话判据

**「这次改动会不会让一个与它无关的页面的截图 diff 变化？」** 会 → 契约变更（须授权）；
不会 → 内容级增删（放行）。

### 5.4 contract version 语义

- 破坏契约（改值/改名/删键/动共享结构）→ 主版本 +1（tokens-sha 必变，UI-SPEC 与 ui-contract
  同步改，红测重跑）。
- 纯新增扩展点（加 token/加组件/加变体）→ 次版本 +1（断言集只追加，tokens-sha 变）。
- 纯内容增删（文案/数据行/已有组件新实例）→ 不动版本。

### 5.5 变更程序

1. 用户在新窗口提示词中显式授权（引用 FROZEN.md「UI 契约冻结」项）。
2. 同步改三处：UI-SPEC（§1 表+§6 记录）→ ui-contract 断言/快照 → 代码。
3. 红测重跑（正向变异红+负向对照绿+恢复自证），v6/v7/v8/contract 四门禁全绿。
4. 证据回填 WBX.md 对应版本章。

## 6. 变更记录

| contract version | 日期 | tokens-sha | 变更 |
|---|---|---|---|
| v1.0.0 | 2026-09-25 | efeee49b0e | 契约起步：v5.3 已收敛风格显式化（58 token+20 组件+3 Pattern+IA/编码/术语冻结）；随桥 v5.4.0 发布（token 语义化改名 --acc-text/--acc-hover/--panel-inset 已并入基线） |
