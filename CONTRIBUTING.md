# CONTRIBUTING.md

欢迎贡献。zcode-wbx-bridge 是一个**个人维护的非官方临时工具**（MIT，Windows-only，单 main 分支），改动请保持轻量、可回退。

## 一、改动前必读

### 文件白名单
- 仓库只接受白名单内的文件；**新增文件必须先在白名单登记并说明理由**，未登记者一律拒收。
- 现有白名单：
  - 根目录：`LICENSE`、`.gitignore`、`README.md`、`WBX.md`、`UNINSTALL.md`、`AGENTS.md`、`SECURITY.md`、`CONTRIBUTING.md`、`CHANGELOG.md`
  - 技能目录：`.zcode/skills/wb-bridge/{SKILL.md, PROMPTS.md, examples/tasks.example.json, scripts/wbx.mjs, scripts/wbx-core.mjs, scripts/wbx-setup.mjs, scripts/wbx-ui.mjs}`
- `internal/` 已在 `.gitignore`（策划材料不入库）；`.wbx/`、`~/.wbx/` **绝不入库**。

### 发布白名单流程（冻结，不可简化）
维护者在每次发布时按下列顺序执行，贡献者提交前请确保自己的改动不会破坏该流程：
1. 逐文件显式 `git add <文件>`（**禁止** `git add .` / `-A` / `--all`）。
2. `git ls-files` 与白名单**逐项对照**。
3. push 前 `git grep --cached` 敏感审计，**必须零命中**（硬门槛）。
4. push 后 `gh api` 线上校验，并远端拉回复扫。
- 敏感模式清单因含个人信息不公开列出。提交前请自查并确保**不引入**：凭证、绝对路径中的用户名、真实姓名、uin、邮箱。
- **本仓不做 CI**（定案）：敏感审计模式含个人信息，不能进公开 workflow 文件；人工发布流程已覆盖。

### 卸载承诺
- 任何**新增安装物或运行时产物**，必须同步登记进 `UNINSTALL.md`（维持一键还原承诺），否则不予合并。

### 安全红线
- 不读写 `~/.workbuddy*`、`~/.cline`（用户自己的 Cline 状态）。
- 不修改系统环境变量。
- 桥的 cline 状态**只**允许落在 `~/.wbx/cline-home/`（以 HOME/USERPROFILE 覆盖实现隔离）。

### 代码风格
- 纯 Node ESM（`.mjs`），**零第三方依赖**，双引号 + 分号 + 2 空格缩进。

## 二、如何提交 PR
- 基于**单 main 分支**直接提交 PR，无需额外分支模型。
- 本地 `node --check` 对**全部脚本**逐个通过。
- 跑**全命令回归**：`doctor` / `ask` / `fanout` / `config` / `history` / `export-bundle`。
- PR 描述须包含：
  - 白名单符合性说明（是否新增文件、理由）；
  - `node --check` 结果；
  - 回归命令的**关键输出**（贴文本）；
  - 文档同步更新说明；
  - 若新增安装物/产物，对应 `UNINSTALL.md` 的改动。
- 门槛汇总：改动在白名单内 + 全部脚本 `node --check` 通过 + 全命令回归已跑并贴输出 + 文档同步 + 无敏感内容。

## 三、文档与措辞纪律
- `README.md` / `WBX.md` 不夸大：**禁止**「生产级 / 企业级 / 最强」等表述；成本表述以实测为准（如 cline lane 写「按量微付费（实测单次 $0.0003-0.004）」而非「免费」）。
- 三处诚实声明**不得删除**：临时工具、Windows-only、非官方。
- 文档改动与代码改动同 PR 提交，避免滞后。

## 四、设计决策的权威出处
- 一切设计取舍、流程与约束的**权威出处为 `WBX.md`**；本文档与其冲突时以 `WBX.md` 为准。
- 未在 `WBX.md` 记录的行为请勿擅自引入；需要新增决策时先提 PR 更新 `WBX.md`。

---
许可与署名细节见 LICENSE；安全问题请走 [SECURITY.md](SECURITY.md) 的私有上报渠道，不要开公开 Issue。
