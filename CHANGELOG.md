# Changelog

本文件记录 zcode-wbx-bridge 的版本变更，格式参考 Keep a Changelog。

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