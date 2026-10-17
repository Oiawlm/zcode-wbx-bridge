# Changelog

本文件只记**用户可感知**的变更，每版 ≤15 行；格式参考 Keep a Changelog（新增/变更/修复）。
历史版本（6.10.0 及更早）的完整条目已原文迁入 [HISTORY.md](HISTORY.md)（v22 历史外置定案），不在本文件重复维护。

## [6.13.0] - 2026-10-18

v24 轮：cn lane 夜间免费档 + 模型策略单点 + 免费窗可视化 + 模型画像沉淀（定案=internal/RESEARCH-V24.md；夜间路由语义=A「只换模型不动路由」，AskUserQuestion 2026-10-18）。

- **新增** cn lane 夜间免费档：每日 23:00–08:00（北京时间）免费窗内自动切 Hy4 preview（思考=高、上下文 960k），窗外/过期恒白天档 DeepSeek V4.1 Flash（effort=max、上下文 1m）；纯时钟判定单点 nightWindowState，每次投递现算不缓存，展示层只消费不自算。ai lane 恒不下发 effort 且不参与夜间档（用户口径）。
- **新增** config 七键：effort / context / night-model / night-effort / night-context / night-window / night-expires（非法值容错回默认；活动截止 2026-10-31 可配，空串=无截止）。
- **新增** 四处免费窗可视化：doctor cn 段行（--quick 亦显示，三态=在窗内/窗外/过期 WARN）、ask/fanout stderr [NIGHT] 行、/api/status 与 /api/doctor nightWindow 字段、manifest/任务记录 policy 快照；控制台 cn 卡新增「夜间免费档」行（内容级，tokens-sha 不变）。
- **变更** 回退链换 lane 按新 lane 重解析模型策略；summary 表增「思考/上下文」列；PROMPTS.md 新增 Hy4 preview 画像章（T8 双稿+T7 评审）与 DeepSeek 章 v24 增补，预算 ≤760→≤880。

## [6.12.0] - 2026-10-18

v23 轮：历史净化 + 用量 token 整链删除 + 前端资产化（授权=用户 2026-10-18 立项原话；六域评审分派与 triage 见 internal/archive/v23/）。

- **新增** `wbx ask|fanout --ephemeral`：真实执行（回退/重试/超时/caps 原样）但零落盘——不建 job 不入历史；连通性验证/功能测试一律用它，测试流量不再出现在历史记录。fanout 零落盘时结果以 JSON 走 stdout。
- **变更** 用量 token 数整链删除（非隐藏）：前端 chip/「Token 数」行/历史合计、CLI stderr/--json `usage` 字段/history 回放、doctor 探测 detail、summary.md tokens 列全部移除，落盘记录不再保留用量（存量磁盘记录不受影响，读取侧自然兼容）。
- **变更** 控制台前端模板整体外置为 `ui.html`（单一事实源；运行时读取+占位符注入，渲染结果与改造前逐字节一致）；`GET /` 增 `X-Frame-Options: DENY` 与 CSP `frame-ancestors 'none'` 防点击劫持。
- **修复**（六域评审采纳，摘要）：凭证脱敏漏 Bearer/JWT（已全吞+加锁）；codex 额度检测不再被「模型正文引用 429」误触发冷却；spawn 中文输出跨 chunk 断裂与超时悬挂；config set 不再实体化改写整份 config.json；fanout 单任务内部异常不再卡死整批；`--help`/doctor/UNINSTALL 等十余处文档与提示失真校正。

## [6.11.0] - 2026-10-17

全项目根因化清欠轮（v22，授权=用户 2026-10-16 立项原话）。

- **新增** `wbx doctor --quick`：快检 <10s 零额度（跳过一切探测与端点调用；实测 <0.5s）——常规会话自检用它，全量 doctor 排障用。
- **变更** 质量门禁重组为六域常青套件（core-matrix / cli-blackbox / ui-contract / ui-redtest / daemon-lifecycle / docs-governance + test-helpers），替代按版本累积的 11 套旧套件；全量耗时 ~4.5 分钟 → ~70 秒，断言迁移零丢失（台账 internal/archive/v22/suite-migration-map.md）。
- **变更** 文档重构：WBX.md 重写为纯当前态 ~11KB（22 个版本叙事章原文外置到新建 HISTORY.md）；AGENTS.md 收敛 75→39 行（细节下沉 SKILL.md）；README/UI-SPEC/UNINSTALL/SECURITY/CONTRIBUTING/PROMPTS 全量精简。
- **修复** `wbx fanout` 省略 --timeout 时误记「显式 300s」的观测说谎（签名默认改 null，超时单点决策）；ask 汇总「总耗时」恒 0.0s 改为真实值；`--help` 的 models 枚举漏 codex/doubao；doctor 遇损坏的 cline 二进制可能崩溃。
- **修复** 豆包桥：new-task 锚点失配不再被 Ctrl+N 兜底掩盖（显式失败）；launch.ps1 pid 归因链容错（健康启动曾被误判失败）。
- 退出协议统一（die 等待子进程清理后再退出）；HELP 改由命令/旗标表生成（命令一览/旗标总表/退出码语义入 HELP）；self-install 必选文件补全 wbx-ui.mjs。
