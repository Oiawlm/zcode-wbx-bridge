# AGENTS — wbx 五 lane 桥常驻指令（最小规则面；细节一律见 .zcode/skills/wb-bridge/SKILL.md，勿在此扩写）

本仓库是 wbx 联动桥（ZCode 技能 + Node CLI）。会话在本项目内工作时，除用户明确要求外遵守以下规则；技术细节见 [WBX.md](WBX.md)，卸载见 [UNINSTALL.md](UNINSTALL.md)。

## lane 与成本（一行清单；完整表与登录方式见 SKILL/WBX）

codex=Codex CLI（ChatGPT Plus 质量优先档，gpt-6.1-sol+≥GPT-6 护栏，额度耗尽自动冷却让位）；ai=WorkBuddy 国际版（免费）；cn=国内版（近免费）；cline=Cline CLI（免费孪生）；doubao=豆包桌面端（会员额度）。枚举：codex|ai|cn|cline|doubao。

## 默认分派公理

自包含任务（输入可打包、输出可校验）即候选——单个调研/翻译/抽取/代码模块也直接派，免费 lane 放开用；关键产物 T8 双稿择优、集成前 T7 评审（模板见 PROMPTS.md）；fanout ≥6 任务用 ZCode 子代理管理整批（层级 ≤2）。

## 路由三分与回退

单发 ask 默认 codex 优先（就绪即投，否则 ai→cn→cline→doubao）；fanout 批量缺省池=ai/cn/cline/doubao 中已登录且未禁用者（不含 codex，任务级 `"as":"codex"` 点名才投）；回退链 cn→ai→cline→codex→doubao 各一次；disabled-lanes 硬禁用。

## 停止外包触发

连续 ≥2 任务失败、或 quota/429/限流、或 doctor 全红 → 停止外包如实告知用户，剩余自己做；外包结果必校验后才进交付物（联网产出另抽查来源清单）。

## 红线五条

1. 涉密、隐私、凭证、内部代码、未公开数据绝不外包（五 lane 同标准）。
2. 凭证（.wbx/、~/.wbx/ 的 sessions/product/cline-home/codex-home）绝不展示、不写日志文档；.wbx/ 绝不提交。
3. 不写 ~/.workbuddy*、不读写用户 ~/.cline；~/.codex 仅 `wbx login --identity codex` 一次性只读复制 auth.json 入隔离目录、绝不回写的单文件例外。
4. 所有产物限本项目文件夹（例外仅二：用户级 ~/.zcode/AGENTS.md wbx 块经 install-user/self-install 管理；glm-prompt-crafter 部署物经 tools/install-glm-prompt-crafter.mjs 管理）。
5. caps 能力矩阵（v19）：∅=L0 零回退；net,read=L1 仅 ai/cn 联网只读；write/readDirs 未交付声明即报错、L2 总闸默认 false——caps 失败绝不静默降档。

## 冷启动顺序

AGENTS.md（自动注入）→ internal/ROUTE.md → internal/MEMORY.md → 按角色选读（禁无目的通读 internal/ 与 WBX.md 全文）。

## 桥入口与自检

`node .zcode/skills/wb-bridge/scripts/wbx.mjs <子命令>`；常规自检先跑 `doctor --quick`（<10s 静态检查零额度），排障才全量 doctor；命令与旗标以 `--help` 为准。

## 窗口模型约定

窗口模型由用户按任务指定，未指明时默认 GLM-5.3；外部子代理默认 DeepSeek V4.1 Flash（wbx 免费 lane）。

## 版本交付纪律

每轮版本交付完成即按 CONTRIBUTING「发布白名单流程」推送 GitHub（push 后 gh api 线上校验）；发布以 CHANGELOG 版本节为准，不打 git tag（SECURITY.md 定案）。
