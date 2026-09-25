# Changelog

本文件记录 zcode-wbx-bridge 的版本变更，格式参考 Keep a Changelog。

## 5.2.0 - 2026-09-25

新增
- 控制台守护化：`wbx ui --detach` 幂等拉起后台守护进程（已有健康实例永远复用、绝不新起）；`--stop` HTTP 优雅关闭优先、kill 兜底（绝不误杀无法证明归属的 pid）；`--status` 三态（运行中/残留可自愈/未运行）。状态文件 `~/.wbx/run/ui.json`（pid/port/startedAt/token/version），三条件判活（状态文件 + `kill(pid,0)` + `/__health` pid 匹配）加 `startedAt` 跨重启判废，陈旧状态自动清理自愈；日志 `~/.wbx/logs/ui.log`（启动前 >2MB 轮转保留一代，守护内每小时检查 >10MB 截断）。
- 随 ZCode 会话自启：`wbx ui --install-autostart` 对 `~/.zcode/cli/config.json` 读-改-写合并写入 SessionStart 钩子（`type:process` 参数向量，指向全局形态脚本，`timeoutMs 5000`）；绝不删除/改写既有键，按 command 路径幂等去重；`hooks.enabled` 仅在我们引入首个配置钩子时置 true（marker 记录），`--remove-autostart` 摘除后逐键还原（实测 diff 逐字节一致）。钩子命令实测冷启动 ~0.5s、复用 ~0.15s。注意：是「新开 ZCode 会话时拉起」，非系统级开机自启（不装服务/不写注册表/不动环境变量）。
- 安全校验（前台/守护一律生效）：Host 头白名单（仅 `127.0.0.1`/`localhost`，防 DNS rebinding）、POST 端点 Origin 校验、`POST /__shutdown` 随机 token 时序安全校验；新增 `GET /__health`。
- UI 全面中文化与命名统一（仅展示层，数据层/API 字段/config 键零改动）：历史类型 ask→单条调用、fanout→批量并行、legacy→「旧版·」前缀；状态词 success→成功、failed→失败、done→已完成；PROMPT→提示词、effort→思考档、tokens→Token 数；通道命名统一为品牌公式 WorkBuddy AI（国际版）/WorkBuddy（国内版）/Cline CLI（卡片全称），窄栏位用短称，界面不再出现裸 lane/ai/cn/cline。doctor 人读输出通道段同步品牌全称（机器可读输出不动）。
- UI 补齐 v5.1 超额错误的友好提示（免费额度用尽/促销结束/模型被轮换三类，与 CLI `hintText` 同源语义）。

修复
- UI 登录并发竞态：`/api/login/start` 改为先占位 pending 再执行（防双登录流 TOCTOU）。
- `/api/config` 配置键白名单改自有键判定（防原型链键名绕过）；`/__shutdown` token 比较改字节长度对齐（防多字节输入 500）。

变更
- 裸 `wbx ui` 行为：守护进程已在跑时打印 URL + 开浏览器 + 退出，否则维持前台模式（v5.1 行为不变）。
- 端口被外程序占用时明确报错、不换端口（固定 7788 是可记网址的锚点）。
- self-uninstall 卸载顺序新增：先停守护进程、摘自启钩子，再删文件（一键还原承诺不变）。

说明
- 纯函数模块（状态解析/判活决策/Host·Origin 校验）经 best-of-N 双份并行 + 评审批判择优集成，契约测试 72 断言全过；钩子合并/还原 24 断言全过（含模拟存量 hooks 场景）。
- Windows 行为实测：`kill(pid,0)` 死 pid 报 ESRCH、`wx` 跨进程互斥恰一赢家、listen exclusive 跨进程 EADDRINUSE、detached+windowsHide 后台存活。

## 5.1.0 - 2026-09-25

新增
- cline lane 默认免费调用 DeepSeek V4.1 Flash：默认模型切为免费孪生 `cline-free/deepseek-v4.1-flash`（totalCost=0，实测 20+ 次）。机制：Cline 按模型 id 计费，同一模型有计费 id 与 `cline-free/` 免费孪生两个 id；免费=限时促销轮换+每日用量配额（官方口径）。v5「CLI 侧无免费模型」结论勘误（详见 WBX.md v5 章勘误与 v5.1 章）。
- 存量一次性迁移：仅当 config `cline-model` 恰为 v5 计费孪生 `deepseek/deepseek-v4.1-flash` 时自动改写为免费孪生并打印 `[MIGRATE]`；显式设置的其他值不动。
- `wbx models --as cline --free`：列当前免费模型组（`GET api.cline.bot/api/v1/ai/cline/recommended-models` 端点实时；token 只用不打印；端点失败降级读最近成功缓存；非 DeepSeek 项显式标注）。
- doctor 新增免费孪生存在性校验（免费组轮换防护）：cline 段显示 `cline-model` 是否仍在当前免费组，缺失时 WARN 并列出当前免费 id；端点失败 WARN 降级，不影响 exit 0。cline 模型探测行新增本次计价显示（$0 标「免费」）。
- 超额状态机：错误分类新增 `free-limit`（`Daily free model limit reached`，含重置倒计时透出）、`free-promotion-ended`（`Free model promotion ended`）、`model-not-found`（轮换后残留 id）三类 hint 与用户提示；跨 lane 回退语义不变（ai/cn 仍是 DeepSeek）。
- Web UI 免费模型选择器：状态页 cline 卡新增下拉（数据来自 `/api/status` 新增 `clineFreeModels` 字段），选中即写 `cline-model`；非 DeepSeek 项标注「非 DeepSeek」。
- cline 提示词无 ASCII 空格时自动前缀空格（规避 cline CLI 把无空格短中文当未知子命令的解析怪癖，实测有效）。

修复
- 目录拉取不走 undici fetch（其全局连接池在 Windows 上与随后的 `process.exit` 冲突触发 libuv 断言、exit 127），改用 `node:https` 单次连接。

变更
- `cline-model` 缺省默认值从空（provider 默认）改为免费孪生；版本号 5.1.0；help/文档/用户级 AGENTS 标记块口径统一为「免费（cline-free 孪生，限时轮换）」。
- 红线固化：cline lane 内部任何失败路径不得改用非 DeepSeek 模型顶替（回退只投 ai/cn）；回归断言在案（WBX.md v5.1 章）。

说明
- 隐私披露：免费用量可能被 Cline 用于改进模型（官方原文，已写入 README/UI/安装说明）。
- 免费额度边界未实测到（20 次内未见限制）；超额错误消息模板取自 cline 3.0.65 二进制内证（`ClineFreeModelLimitError` 等），状态机按真实消息字符串设计。

## 5.0.0 - 2026-09-25

新增
- 第三 lane `cline`：Cline CLI（npm 全局包，可选 lane）；`--json` NDJSON 纯文本端点（`--auto-approve false`）；默认 `thinking=xhigh`、`compaction=off`；模型默认 `deepseek/deepseek-v4.1-flash`（按量微付费，实测单次约 $0.0003-0.004）；隔离方式为 HOME/USERPROFILE 覆盖（状态只在 `~/.wbx/cline-home/`，不读写用户 `~/.cline`——实测 3.0.65 的 `--data-dir` 会破坏认证加载，详见 WBX.md v5 章）。
- lane 回退链扩展为 `ai → cn → cline`。
- PROMPTS.md v2 知识库：原则 12 条；模板 T1–T9（新增评审批判 T7、best-of-N T8、修复迭代 T9）；经验条目库 E-xxx（带来源）；沉淀闭环；决策速查表。
- Web UI 三 lane 卡片（cline 未装显示「未安装（可选）」）。
- 新增 SECURITY.md、CONTRIBUTING.md、CHANGELOG.md。
- 打 tag v5.0.0 并发布 GitHub release。

修复
- 子进程 stdin 管道不关闭导致 cline 调用悬挂——spawn 侧统一在无数据时也立即发 EOF。

变更
- 调用准则基线反转：默认分派、消耗豁免、best-of-N 常规化、评审常规化。

说明
- 不做 CI，决策记录在 WBX.md。

## 4.0.0 - 2026-09-25

变更
- 定位重写为「能力外包」：外包判定从文本杂活升级为自包含任务（含代码模块编写）。
- AGENTS/SKILL 分派准则加入代码实现环节。

新增
- PROMPTS.md worker 提示词模板库（含代码模块 T1 等六类）。
- fanout 任务级 `files` 字段材料拼接。
- 提示词超过 12k 字符时自动走 stdin 通道。

实测
- stdin 通道 60k+ 字符可用。
- 3 模块外包 3/3 一次成活、零返工。

## 3.0.0 - 2026-09-24

新增
- 核心库拆分为 wbx-core / wbx-setup / wbx-ui。
- `wbx config` 运行时配置（default-lane、disabled-lanes、parallel-per-lane 等）。
- ask 落盘 job，`wbx history` 完整回放双向对话。
- self-install 用户级全局安装（`~/.zcode` 四处 + `~/.wbx` 运行时 + `/wbx` 斜杠命令）。
- 本地 Web UI（127.0.0.1:7788，零依赖单页，含状态/路由/ask/fanout/历史/登录）。
- export-bundle 零凭证分发包（纯 Node zip）。

## 2.0.0 - 2026-09-24

新增
- 双 lane：`ai`（国际版 WorkBuddy AI，deepseek-v4.1-flash，x0.00 免费）与 `cn`（国内版，x0.03 近免费）。
- 失败自动跨 lane 回退。
- `wbx install-user` 用户级 AGENTS.md 标记块（任何项目可用）。

变更
- 凭证结构升级为 sessions/product。

修复
- 国际版登录 state 丢失 bug 的锦囊修补 URL。

## 1.0.0 - 2026-09-24

新增
- 首个可用版。
- 单 lane（WorkBuddy 国内版）。
- 逆向 SSO 协议登录（微信扫码）。
- doctor 自检。
- ask 单条调用。
- fanout 并发批量。
- 结果落盘 `.wbx/tasks/`。

实测
- fanout 6 任务 6/6、零限流。