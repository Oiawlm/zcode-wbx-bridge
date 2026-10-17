# 安全策略 (Security Policy)

本仓库为个人维护的非官方开源工具（MIT），Windows-only。

## 支持版本：仅最新 CHANGELOG 版本提供安全修复（更早历史版本不再支持；本项目发布以 CHANGELOG 版本节为准，不打 git tag）。

## 上报与处理

**请通过 GitHub Security Advisories 私有上报（仓库 Security 标签页 → Report a vulnerability），不要开公开 Issue 报漏洞，也不要在公开渠道披露未修复细节。** 收到后尽快确认接收、在最新版本上修复并随新版本发布（个人项目尽力而为，不承诺 SLA）。报告中请脱敏一切凭证/token/内部路径。

## 范围

- **范围内**：桥自身代码/CLI/技能/导出逻辑（含 `tools/doubao-bridge/`——CDP 驱动豆包桌面端的可选工具）的安全缺陷；输出（doctor/UI/日志/导出包）意外打印凭证**内容**；零凭证断言被绕过；`.gitignore` 未覆盖凭证路径的缺陷。
- **范围外**：第三方服务（WorkBuddy/腾讯、Cline、DeepSeek、OpenAI/Codex、豆包）自身漏洞请上报对应厂商；本机文件权限配置问题；社会工程学/物理接触场景。

## 凭证自查建议

凭证两类均在 gitignore 内：WorkBuddy accessToken（`.wbx/`、`~/.wbx/` 的 sessions/product）、cline OAuth（`~/.wbx/cline-home/.../providers.json`；codex 为 `~/.wbx/codex-home/auth.json` 副本）。自查：`git log` 历史无凭证；凭证文件权限仅当前用户可读；doctor/日志/导出包只报存在性不输出内容；疑似泄漏立即在对应平台吊销重签后按上方渠道私有上报。
