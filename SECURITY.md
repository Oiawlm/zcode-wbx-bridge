# 安全策略 (Security Policy)

本仓库 `zcode-wbx-bridge`（以下简称"桥"）为个人维护的非官方开源工具，采用 MIT 许可证。
本文档说明如何上报安全问题、维护者的处理方式，以及安全边界与自查建议。

## 支持的版本 (Supported Versions)

仅对**最新发布 tag**（v5 及以后）提供安全修复。

| 版本 | 是否支持安全修复 |
| --- | --- |
| 最新发布 tag（v5 及以后） | ✅ |
| 早于 v5 的历史版本 | ❌ |

## 如何上报漏洞 (Reporting a Vulnerability)

**请通过 GitHub Security Advisories 私有上报，不要开公开 Issue 报漏洞。**

- 入口：本仓库 **Security** 标签页 → 「Report a vulnerability」
- 直达链接：https://github.com/Oiawlm/zcode-wbx-bridge/security/advisories/new

明确要求：

- **不得**在公开 Issue、Discussion、PR 或社交媒体中披露未修复的安全问题细节。
- 请勿通过个人邮箱上报（本项目不提供邮箱上报渠道）。
- 建议在报告中包含：受影响版本 / 平台、复现步骤或最小样例、影响描述、可能的缓解方式。
- 请对报告中涉及的任何凭证、token、内部路径做脱敏处理。

## 处理流程与预期 (Process & Expectations)

本项目为个人维护、非商业项目，**尽力而为，不承诺任何 SLA 或修复时限**；收到私有上报后会尽快确认接收。

典型流程：

1. 收到私有上报后确认接收（时间视维护者可用性而定）。
2. 初步评估是否属于本仓库范围，必要时与上报者沟通补充信息。
3. 在最新 tag 上准备修复或缓解措施。
4. 通过发布新版本修复，并在 Security Advisory 中同步说明。
5. 如上报者愿意，可在 Advisory 中致谢（默认匿名）。

## 范围内与范围外 (Scope)

**范围内（In scope）**

- 桥自身的代码、Node CLI、ZCode 技能及导出/分发逻辑中的安全缺陷。
- 凭证安全模型相关缺陷，例如：桥的输出（doctor / UI / 日志 / 导出包）意外打印凭证内容，而非仅报告存在性。
- 导出分发时"零凭证断言"（逐成员比对本地 accessToken 值）被绕过或失效。
- `.gitignore` 未覆盖 `.wbx/`、`~/.wbx/` 下凭证路径导致误提交的缺陷。

**范围外（Out of scope）**

- **第三方服务自身的漏洞**：WorkBuddy（腾讯）、Cline、DeepSeek 等平台或服务的安全问题，请上报给对应厂商，本仓库不处理。
- **用户本地文件权限问题**：因本机文件权限配置不当导致的凭证泄漏，属于用户环境问题（见下方自查建议）。
- 与本项目无直接关联的通用性问题、社会工程学、以及需要物理接触设备的攻击场景。

## 凭证自查建议 (Credential Self-Check)

桥在本地保存两类凭证，二者均被 `.gitignore` 覆盖：

- WorkBuddy `accessToken`：位于 `.wbx/` 或 `~/.wbx/` 下的 `sessions` / `product` 目录。
- Cline OAuth 凭证：`~/.wbx/cline/data/settings/providers.json`。

建议自查：

1. 确认仓库中 `.wbx/`、`~/.wbx/` 相关路径未被提交；用 `git status` / `git log` 检查历史中是否曾出现凭证。
2. 确认上述凭证文件的本地文件权限仅限当前用户可读（例如 Windows 上检查该文件的 ACL，避免其他本地账户可读）。
3. 运行 `doctor` 或查看日志 / 导出包，确认其只报告凭证"存在性"，不输出凭证内容。
4. 若怀疑凭证已泄漏：立即在对应平台吊销并重新签发 token / 重新授权，随后按上方流程私有上报桥侧缺陷。
5. 不要在 Issue、日志粘贴或截图中包含任何 token、授权链接或 `providers.json` 内容。

---

如有疑问，请通过上方 GitHub Security Advisories 渠道联系维护者。
