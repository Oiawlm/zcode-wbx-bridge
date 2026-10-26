# Changelog

本文件只记**用户可感知**的变更，每版 ≤15 行；格式参考 Keep a Changelog（新增/变更/修复）。
历史版本（6.10.0 及更早）的完整条目已原文迁入 [HISTORY.md](HISTORY.md)（v22 历史外置定案），不在本文件重复维护。

## [6.14.0] - 2026-10-19

v27 轮：泄露审计整改（定案=internal/RESEARCH-V27.md；HISTORY 脱敏随版推送、不改写公开 git 历史，用户 2026-10-19 裁决）。

- **修复** HISTORY.md 历史章节 v5.x 敏感模式清单自引用（人名/账号/本机路径/机标识明值）全部泛化为泛称+掩码形态，公开跟踪面不再含个人信息明值；版本史语义零损失。
- **新增** 敏感面门禁单点：维护者本地 docs-governance 门禁新增「仓库敏感面审计」段——敏感模式清单全仓唯一明值定义处（未跟踪 internal/ 层），扫全跟踪文件工作树内容与暂存面双模式、命中即非零退出；CONTRIBUTING 发布流程 push 前步骤改指该门禁，FROZEN 内联清单指针化（授权留痕）。
- **变更** SECURITY.md 凭证自查建议增补：季度 gitleaks 全史手动复扫建议与「先吊销/轮换后清史」官方口径。
- **修复** 本地隐私清理：删除 34 个 cline checkpoint refs（含未公开的本机用户数据快照）；远端本无 checkpoint 引用，origin/main 历史零改动。

## [6.13.1] - 2026-10-19

v26 轮：仓库公开面同步与「每版必推」显式化（纯公开面轮，桥行为零变化；定案=internal/RESEARCH-V26.md）。

- **新增** Community Standards 三件套：CODE_OF_CONDUCT.md、问题报告模板（含凭证脱敏提醒）与 PR 模板（CONTRIBUTING 要求表面化为 checkbox）；CONTRIBUTING 白名单同步登记。
- **新增** README 快速开始补 `git clone` 获取步骤；AGENTS.md 新增「版本交付纪律」小节（每版交付完成即走发布白名单流程推送 GitHub，AGENTS 预算 40→43 行）。
- **变更** 仓库远端 description/topics 更新为五 lane 口径（topics 12→18）。
- **修复** v2 时代残留措辞三处：fanout 文档注释「双 lane 动态均衡」、HELP doctor 行「两 lane 凭证」（并补 doubao 可选段）、wbx-setup 头注释同源残留。

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

## Unreleased 草稿（6.15.0 待 D 集成定稿；本节 v28B 执行窗口起草，标题不带版本号以保 docs-governance ②a 首版本==WBX_VERSION 门禁绿）

v28B 轮：产物生命周期（定案=internal/RESEARCH-V28.md §4.3/§4.4；拓扑零变化零迁移，只加寿命）。

- **新增** `wbx clean` 产物回收命令：缺省只读干跑报告（候选表 `KIND|PATH|AGE|SIZE|ACTION` + `Total reclaimed` 预估，零删除）；`--apply` 实删（`--force` 仅免确认）；`--jobs <days>` / `--scratch <hours>` / `--lane-cache` 分域；安全五条（候选仅扫描枚举、realpath 白名单前缀、绝不删白名单根本身、symlink/junction 一律跳过、mtime 安全窗=域 TTL+24h 防删在写）；删除失败记 skipped 不影响退出码。
- **新增** scratch 惰性 GC：ask/fanout 收尾路径（成功失败均达）按 `scratch-ttl-hours`（默认 168h）回收超龄条目，每日至多一次（stamp 判窗，Cargo 语义）；`--ephemeral` 的 `eph-*` scratch 任务完成即删。
- **新增** 单件输出护栏 `output-max-bytes`（默认 5MB）：失败 attempt 全量输出 / `*-stream.jsonl` / transcript 三条落盘通道统一截断+尾行标记，杜绝单件 450M 输出再现。
- **新增** config 三键 `scratch-ttl-hours` / `jobs-retention-days` / `output-max-bytes`（均 0=关）；doctor 增产物三键生效值与 scratch/jobs/lane-cache 体积概览。
- **变更** 门禁沙箱自清（test-helpers 单点）：mkSandbox 登记+进程退出兜底删除+套件启动清扫 os.tmpdir() 内 >24h 孤儿（`wbx-gate-`/`wbx-ui-gate-` 前缀）。
