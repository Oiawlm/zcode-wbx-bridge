# Changelog

本文件只记**用户可感知**的变更，每版 ≤15 行；格式参考 Keep a Changelog（新增/变更/修复）。
历史版本（6.10.0 及更早）的完整条目已原文迁入 [HISTORY.md](HISTORY.md)（v22 历史外置定案），不在本文件重复维护。

## [Unreleased]

（无——下一轮立项后在此登记）

## [6.11.0] - 2026-10-17

全项目根因化清欠轮（v22，授权=用户 2026-10-16 立项原话）。

- **新增** `wbx doctor --quick`：快检 <10s 零额度（跳过一切探测与端点调用；实测 <0.5s）——常规会话自检用它，全量 doctor 排障用。
- **变更** 质量门禁重组为六域常青套件（core-matrix / cli-blackbox / ui-contract / ui-redtest / daemon-lifecycle / docs-governance + test-helpers），替代按版本累积的 11 套旧套件；全量耗时 ~4.5 分钟 → ~70 秒，断言迁移零丢失（台账 internal/archive/v22/suite-migration-map.md）。
- **变更** 文档重构：WBX.md 重写为纯当前态 ~11KB（22 个版本叙事章原文外置到新建 HISTORY.md）；AGENTS.md 收敛 75→39 行（细节下沉 SKILL.md）；README/UI-SPEC/UNINSTALL/SECURITY/CONTRIBUTING/PROMPTS 全量精简。
- **修复** `wbx fanout` 省略 --timeout 时误记「显式 300s」的观测说谎（签名默认改 null，超时单点决策）；ask 汇总「总耗时」恒 0.0s 改为真实值；`--help` 的 models 枚举漏 codex/doubao；doctor 遇损坏的 cline 二进制可能崩溃。
- **修复** 豆包桥：new-task 锚点失配不再被 Ctrl+N 兜底掩盖（显式失败）；launch.ps1 pid 归因链容错（健康启动曾被误判失败）。
- 退出协议统一（die 等待子进程清理后再退出）；HELP 改由命令/旗标表生成（命令一览/旗标总表/退出码语义入 HELP）；self-install 必选文件补全 wbx-ui.mjs。
