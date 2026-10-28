# UNINSTALL — wbx 联动桥卸载手册

> **一键还原承诺**：v29 安装物=一个技能目录，运行时=各项目 `.wbx/`，两处删净即还原（行数预算 ≤60 行）。
> 两个 WorkBuddy 桌面版与用户自己的 `~/.cline` 从头到尾零写入，不受影响；桥为纯 Node 脚本，无常驻进程/系统服务。

## 一、用户级安装卸载（装过 `wbx self-install` 才需要）

```bash
node "%USERPROFILE%\.zcode\skills\wb-bridge\scripts\wbx.mjs" ui --stop        # 停后台守护（起过控制台才需要）
node "%USERPROFILE%\.zcode\skills\wb-bridge\scripts\wbx.mjs" self-uninstall  # 删技能目录 + 旧形态痕迹清扫
```

安装物登记表（self-uninstall 自动处理并逐项报告）：

| 位置 | 内容 |
|---|---|
| `~/.zcode/skills/wb-bridge/` | **唯一技能目录**：scripts（含 ui.html 前端模板）+ SKILL.md/PROMPTS.md + examples + docs 副本 + doubao/ 豆包桥副本（可选，含 node_modules）+ `.wbx-install.json` manifest v3 |

家目录再无其他安装物：不写 `~/.zcode/AGENTS.md`、不装 `~/.zcode/cli/config.json` 自启钩子、无 `~/.wbx/` 全局运行时（v29 起；旧形态机器见第四节）。控制台守护属运行时（状态文件在各项目 `.wbx/run|logs/`），桥已删而进程还在时：`netstat -ano | findstr :7788` 找 pid 后 `taskkill /PID <pid> /F` 即净。

## 二、项目运行时清理（各项目自删）

每个用过桥的项目按需执行：`Remove-Item -Recurse -Force ".wbx"`——内含凭证（sessions/product/cline-home/codex-home）、config.json、jobs/ 历史、scratch/、run/、logs/、export/。想保留历史或凭证的先自行备份；只清历史不动凭证可改用 `wbx clean --apply`。

## 三、仓库形态删除（从源码仓库使用时）

```powershell
cd "<本仓库所在目录>"
Remove-Item -Recurse -Force ".zcode\skills\wb-bridge", ".wbx", "tools\doubao-bridge"
Remove-Item -Force "README.md","WBX.md","HISTORY.md","UI-SPEC.md","UNINSTALL.md","AGENTS.md","LICENSE","SECURITY.md","CONTRIBUTING.md","CHANGELOG.md","CODE_OF_CONDUCT.md"
# 文档与工具全清单以 CONTRIBUTING.md 白名单为准（tools/doubao-bridge 豆包桥源目录随上述命令删除）；根 .gitignore 的 `.wbx/` 行按需清理
```

（npm 全局包 `cline` 与豆包桌面客户端是独立软件，不随本桥删除。）

## 四、旧全局形态迁移指引（仅装过 v28 前版本的机器）

- `self-install` 升级时已一次性清扫（幂等，重跑结果一致）：AGENTS 标记块、自启钩子条目、`~/.zcode/commands/wbx.md`、旧 `~/.zcode/wbx-bridge/`（退役为 `.backup-<时间戳>` 备份，确认新安装正常后手动删）。
- 旧 `~/.wbx/` 下凭证**绝不自动迁移/复制/删除**：需要时重新 `wbx login`，或自行把 `sessions/ product/ cline-home/ codex-home/` 复制进目标项目 `.wbx/`；确认无用后手动删除整目录即可。
- glm-prompt-crafter 提示词工艺库**已分家独立仓库**：旧用户级副本 `~/.zcode/skills/glm-prompt-crafter/` 删目录即净（纯 Markdown，无进程/网络/系统项）。

## 五、凭证与服务端会话

本地凭证全在各项目 `.wbx/`（第二节删除即净）；服务端会话不主动撤销（WorkBuddy accessToken 约 55 天自然过期，实测口径）。想立即失效：WorkBuddy 网页版（copilot.tencent.com / www.workbuddy.ai）→ 账号设置 → 退出全部设备；cline/codex 在各自官方账号设置撤销。

## 六、确认不受影响的部分（卸载后自检）

| 位置 | 状态 |
|---|---|
| 桌面版 WorkBuddy 国内版/国际版（`~/.workbuddy`、`~/.workbuddy-ai`） | 只读过 cache，未写入任何文件 ✅ |
| 用户自己的 Cline 状态（`~/.cline`） | **从未读写**（桥的 cline 状态只在各项目 `.wbx/cline-home/`）✅ |
| 用户 `~/.codex` | 除 auth.json 单文件一次性只读复制外零读取，绝不回写 ✅ |
| `~/.zcode/cli/config.json`、系统环境变量 / PATH / 注册表 / Windows 服务 | 从未改动（env 只在 spawn 时注入）✅ |
| 豆包桌面端 | 只读探测+带参启动复用官方调试开关，未修改任何应用文件与用户数据 ✅ |

## 七、只停用、不删除（临时停用）

会话级：不派发任务即可（分派是行为规则，无后台进程）。项目级：删/注释项目 AGENTS.md 分派段。只停一条 lane：`wbx config set disabled-lanes '["cline"]'`（路由/回退/fanout 全链路跳过，doctor 标注已禁用）。彻底移除=第一、二节。
