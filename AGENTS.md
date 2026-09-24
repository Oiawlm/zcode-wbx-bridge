# AGENTS — wbx 双 lane 桥常驻指令

> 本仓库是 wbx 联动桥（ZCode 技能 + Node CLI）。ZCode 会话在本项目内工作时，除用户明确要求外，
> 应遵守以下常驻规则。桥的技术细节见 [WBX.md](WBX.md)，卸载见 [UNINSTALL.md](UNINSTALL.md)。

## 可用外部算力（wbx 桥）

把「相互独立、纯文本进出、单轮可完成」的子任务并行分派给外部廉价/免费算力，是本仓库的常规能力：

| lane | 身份 | deepseek-v4.1-flash 成本 | 状态（以 `wbx doctor` 实测为准） |
|---|---|---|---|
| `ai` | WorkBuddy AI 国际版 | **x0.00（免费）** | 登录后即可用 |
| `cn` | WorkBuddy 国内版 | x0.03（近免费） | 登录后即可用 |

- 默认路由：`ai` 已登录则优先（免费），否则 `cn`；任一 lane 失败/限流自动改投另一 lane。
- 成本理由：同等任务 ai 免费、cn 近免费、ZCode 自身消耗订阅额度——所以**ai → cn → 自己做**。
- 调用入口：`node .zcode/skills/wb-bridge/scripts/wbx.mjs {doctor|login|ask|fanout|models|config|history|ui|self-install|export-bundle}`。
- v3 新增：`config set default-lane ai|cn`（切路由）/ `disabled-lanes`（硬禁用）、`history <jobId>`
  （回放完整双向对话）、`ui`（本地可视化 127.0.0.1:7788）、`self-install`（任何项目可用 + `/wbx` 命令）、
  `export-bundle`（零凭证分发包）。ask/fanout 全部落盘为可回放的 job。
- 使用前先 `doctor`；用法、worker 提示词模板、任务分派准则见
  `.zcode/skills/wb-bridge/SKILL.md`（ZCode 会话会自动命中该 Skill）。

## 主动分派时机（无需用户明说「外包/并行」）

遇到以下情形应**主动**考虑 wbx 分派，并先告知用户一句「这部分我会并行分派给外部免费算力」：

- **调研环节**：需要并行考察 ≥2 个对象（竞品动效、开源库、技术选型对比，如「调研 Linear、
  Raycast、Arc 三款软件的加载动效」）→ 每对象一个 worker 任务，要求带来源清单。
- **执行环节**：一段工作可拆成 ≥3 个接口清晰、可独立验证的模块（UI 组件、纯函数、配置生成、
  文案批量产出）→ 其中无上下文依赖的部分分派出去，ZCode 负责接口定义、集成与审查。
- **批量文本**：翻译、摘要、改写、变体生成、结构化抽取、分类打标。

不满足「纯函数、可校验、有回退」三条件的任务一律留在 ZCode 自己做。

## 回退规则

1. 先 `wbx doctor`：两个 lane 凭证都红 → 提示用户 login，任务自己做；有任一 lane 可用 → 继续。
2. 连续 ≥2 个任务失败，或出现 quota / 429 / 限流 → 停止外包，如实告知用户，剩余任务自己做。
3. 外包结果**必须校验后使用**（免费算力质量方差大；调研类产出需核对时效性与来源）。
4. worker 无联网能力：调研类任务产出的是模型已有知识，涉及时效性事实时以 ZCode 自行检索为准。

## 安全红线

- 涉密、隐私、凭证、内部代码、未公开数据**绝不外包**给外部模型。
- 凭证（`.wbx/sessions/`、`.wbx/product/`）绝不展示给用户或写进日志、文档、对话输出。
- `.wbx/` 保持 gitignore，绝不提交。
- 不写 `~/.workbuddy`、`~/.workbuddy-ai`，不改桌面版任何文件，不动系统环境变量。
- 所有产物限于本项目文件夹内（用户级 `~/.zcode/AGENTS.md` 的 wbx 标记块是唯一例外，
  且只能通过 `wbx install-user` / `uninstall-user` 管理）。
