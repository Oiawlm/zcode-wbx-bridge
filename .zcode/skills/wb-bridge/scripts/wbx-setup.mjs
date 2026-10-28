/**
 * wbx-setup — wbx 桥的安装 / 卸载 / 分发打包（v29 纯 Skill 形态）
 *
 * - selfInstall：原子复制技能目录到 ~/.zcode/skills/wb-bridge/（scripts + SKILL.md/PROMPTS.md +
 *   examples + docs + doubao/ 可选 + .wbx-install.json 仅版本自证 manifest），staging→rename
 *   幂等可重装。绝不写 ~/.zcode/AGENTS.md、绝不装 ~/.zcode/cli/config.json 钩子、不建任何
 *   全局运行时——新项目零配置即用（cwd 在项目内即得 <git 根>/.wbx 运行时）。
 * - 一次性迁移清扫（self-install/self-uninstall 共用，幂等）：探测 v28 及更早全局形态痕迹
 *   （AGENTS 标记块、自启钩子条目、~/.zcode/wbx-bridge/ 旧布局、commands/wbx.md）并逐项摘除；
 *   目标不存在=静默跳过，失败不阻断（逐项报告+手动命令）。凭证红线：绝不自动迁移/复制/删除
 *   ~/.wbx 下任何文件——检测到旧全局运行时仅输出提示，由用户自决。
 * - selfUninstall：删技能目录 + 停守护 + 一次性清扫 + 清理迁移备份/staging 残留；各项目 .wbx/
 *   （含凭证）不属安装物，一律保留（需清理请在各项目内手动删除）。
 * - exportBundle：生成零凭证分发 zip（scripts/ + SKILL.md + examples/ + docs/ + INSTALL-README.md），
 *   默认落 <git 根>/.wbx/export/（--out 可覆盖），纯 Node 实现 zip（store），导出后自检断言不含任何凭证值。
 *
 * 写用户目录仅限一处：~/.zcode/skills/wb-bridge/（安装副本本体）+ 一次性清扫段的数据面摘除；
 * 除此之外零家目录读写。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  HOME, PROJECT_ROOT, SCRIPT_DIR, GLOBAL_SKILL_DIR, RUNTIME_ROOT, EXPORT_DIR, UI_RUN_DIR,
  INSTALL_MANIFEST_NAME, MANIFEST_SCHEMA_VERSION, readInstallManifest,
} from './wbx-paths.mjs';
import {
  LANE_ORDER, WBX_VERSION, crc32, escapeRegExp,
} from './wbx-core.mjs';

// ---------- 纯 Node zip（store，无压缩，零依赖；crc32 自 wbx-core 导入——与 UI PWA 图标单源） ----------

export function zipStore(entries) {
  const now = new Date();
  const dosTime = ((now.getHours() & 0x1f) << 11) | ((now.getMinutes() & 0x3f) << 5) | ((now.getSeconds() / 2) & 0x1f);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | (((now.getMonth() + 1) & 0xf) << 5) | (now.getDate() & 0x1f);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    // UTF-8 旗标：本地/中央目录头必须同值（否则部分解压器按原 OS 编码解非 ASCII 文件名）
    const nameFlag = /^[\x20-\x7e]+$/.test(e.name) ? 0 : 0x0800;
    lh.writeUInt16LE(nameFlag, 6);
    lh.writeUInt16LE(0, 8);             // method: store
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, data);
    central.push({ nameBuf, crc, size: data.length, offset, flag: /^[\x20-\x7e]+$/.test(e.name) ? 0 : 0x0800 });
    offset += 30 + nameBuf.length + data.length;
  }
  let centralSize = 0;
  const centralBufs = [];
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(c.flag, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(dosTime, 12);
    h.writeUInt16LE(dosDate, 14);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.size, 20);
    h.writeUInt32LE(c.size, 24);
    h.writeUInt16LE(c.nameBuf.length, 28);
    h.writeUInt16LE(0, 30);
    h.writeUInt16LE(0, 32);
    h.writeUInt16LE(0, 34);
    h.writeUInt16LE(0, 36);
    h.writeUInt32LE(0, 38);
    h.writeUInt32LE(c.offset, 42);
    centralBufs.push(h, c.nameBuf);
    centralSize += 46 + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...centralBufs, eocd]);
}

// ---------- 模块级清单常量（self-install 完整性检查 / 复制 / export-bundle 共用同一来源） ----------
const CORE_SCRIPTS = ['wbx.mjs', 'wbx-core.mjs', 'wbx-paths.mjs', 'wbx-ui.mjs', 'wbx-setup.mjs', 'wbx-daemon.mjs', 'ui.html'];   // wbx-paths=路径派生单点（core 五脚本 import 依赖，v28-S）；ui.html=前端模板资产（wbx ui 启动期读取，v23）
const DOC_FILES = ['WBX.md', 'UNINSTALL.md'];
// 豆包桥复制时剔除的包内冗余（tests/docs 目录与 source map；playwright-core 体积主体保留 lib/）
const PRUNE_DIRS = new Set(['tests', 'test', '__tests__', 'docs']);
const RM_OPTS = { recursive: true, force: true, maxRetries: 4, retryDelay: 150 };   // win32 删除重试（EBUSY/句柄延迟）
const tsStamp = () => {
  const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
};

// ---------- 文案模板 ----------
const skillEntryScript = () => path.join(GLOBAL_SKILL_DIR, 'scripts', 'wbx.mjs');

// 项目级 skill → 用户级安装副本的文本适配。改写按结构而非整句字面量匹配：
//   ① `<!-- wbx:project-only -->…<!-- /wbx:project-only -->` 标记段=项目形态专属内容，全局版整段删除
//     （标记是 SKILL.md 作者与安装器之间的契约，段内文案怎么改都不影响安装）；
//   ② 相对入口路径改写为安装期绝对路径（禁 `~`——PowerShell 对原生程序不展开）。
//     运行时路径不改写：v29 起安装副本与项目副本同为 cwd 派生（<git 根>/.wbx），文案同源。
export function globalSkillText(sourceSkill) {
  const gscript = skillEntryScript();
  return sourceSkill
    .replace(/<!-- wbx:project-only -->[\s\S]*?<!-- \/wbx:project-only -->\n?/g, '')
    .replace(/node "?\.zcode[\\/]skills[\\/]wb-bridge[\\/]scripts[\\/]wbx\.mjs"?/g, `node "${gscript}"`)
    .replace(/\.zcode[\\/]skills[\\/]wb-bridge[\\/]scripts[\\/]wbx\.mjs/g, gscript)
    + '\n> 注：本文件是用户级安装副本（唯一技能目录 ~/.zcode/skills/wb-bridge/，命令入口为安装期绝对路径；同目录 .wbx-install.json 为版本自证 manifest；运行时根随 cwd 所在项目派生）。本副本遮蔽同名项目级 skill。\n';
}

export function installReadmeText() {
  const B = '`';   // markdown 反引号
  const F = '```'; // markdown 代码围栏
  const E = '%USERPROFILE%\\.zcode\\skills\\wb-bridge\\scripts\\wbx.mjs';   // 安装后绝对入口（cmd 写法）
  const L = [
    '# wbx 桥安装说明（v' + WBX_VERSION + '）',
    '',
    '把合适的子任务并行分派给外部算力（五 lane）：可选 Codex CLI lane（ChatGPT Plus 质量优先档，',
    '单发默认优先、额度耗尽自动冷却让位）+ WorkBuddy 双 lane 的 DeepSeek V4.1 Flash（国际版 x0.00',
    '免费 / 国内版 x0.03 近免费）+ 可选 Cline CLI lane（免费额度轮换模型组）+ 可选豆包桌面端 lane',
    '（耗会员额度；免费 lane 优先，回退链最末），',
    '由 ZCode 会话编排与校验。',
    '',
    '## 前提（缺一不可）',
    '',
    '- Windows（本桥为 win 特化：taskkill/路径扫描；mac/Linux 为后续计划）',
    '- Node.js >= 18.20.8（' + B + 'node --version' + B + ' 检查）',
    '- ZCode（任意近期版本）',
    '- 两个 WorkBuddy 桌面版各**至少成功启动过一次**（用于生成登录模板缓存',
    '  ' + B + '~/.workbuddy/cache/acc-product-config-v3.json' + B + ' 与 ' + B + '~/.workbuddy-ai/cache/...' + B + '；',
    '  平时使用**不需要**打开桌面版）',
    '',
    '## 安装三步',
    '',
    F + 'bat',
    ':: 1. 解压本 zip 到任意目录（例如 D:\\Tools\\wbx-bridge），在该目录打开终端',
    ':: 2. 安装（复制技能目录到 ~/.zcode/skills/wb-bridge/，见下方"会写哪些位置"）',
    'node scripts\\wbx.mjs self-install',
    '',
    ':: 3. 在你要用的项目目录里登录两个 lane（各一次，凭证约 55 天有效；运行时随项目走）',
    'node "' + E + '" login --identity cn   :: 国内版：微信扫码',
    'node "' + E + '" login --identity ai   :: 国际版：邮箱/OneID（输出里有 state 修补锦囊）',
    F,
    '',
    '装完自检：在任意项目目录跑 ' + B + 'node "' + E + '" doctor --quick' + B + '，两个 lane 全绿即就绪。',
    '新项目零配置即用：在任何项目内（cwd 即可）直接调用，运行时根=<该项目 git 根>/.wbx/。',
    '装过 v28 及更早版本的机器：self-install 自动一次性清扫旧形态痕迹（AGENTS 标记块、',
    '自启钩子条目、~/.zcode/wbx-bridge/ 旧布局、commands/wbx.md），旧目录改名 <名称>.backup-<时间戳>',
    '保留；旧全局运行时 ~/.wbx/（凭证）不自动迁移——需要的话自行复制到各项目 .wbx/ 后重新 login。',
    '',
    '## 可选扩展：cline lane（第三条算力）',
    '',
    '不装也不影响 WorkBuddy 双 lane 的任何功能（doctor 对 cline 只显示 WARN）：',
    '',
    F + 'bat',
    'npm install -g cline',
    'node "' + E + '" login --identity cline    :: 浏览器完成 OAuth 设备授权（有活跃会话时自动通过）',
    ':: 查当前免费模型组（免费组限时轮换；换默认：config set cline-model "<免费 id>"）',
    'node "' + E + '" models --as cline --free',
    F,
    '',
    'cline 状态只存 <运行时根>/cline-home/（桥以 HOME 覆盖实现隔离），与用户自己的 ~/.cline 互不影响；',
    '默认模型为免费孪生 cline-free/deepseek-v4.1-flash（totalCost=0，实测）、--thinking xhigh、',
    '--compaction off（上下文与思考强度最大），并发默认 1。免费=限时促销轮换+每日配额：被轮换下线或',
    '超额时 doctor 会提示并给出当前免费清单；桥的自动回退绝不切换到非 DeepSeek 模型（回退只投 ai/cn）。',
    '隐私披露：免费用量可能被 Cline 用于改进模型（官方原文）。',
    '',
    '## 使用',
    '',
    '- **任何项目的 ZCode 会话**：项目内自带本技能副本时直接说「帮我调研 A、B、C…」触发主动分派，',
    '  或显式输入 ' + B + '/wb-bridge' + B + '；用户级安装副本（~/.zcode/skills/wb-bridge/）对所有项目生效；',
    '- 手动调用（装好后任何位置可用，路径含空格要加引号）：',
    '  ' + B + 'node "' + E + '" ask --text "…"' + B + '、',
    '  ' + B + 'fanout --file tasks.json' + B + '；',
    '- 可视化：' + B + 'node "' + E + '" ui' + B +
    ' → 浏览器自动打开 http://127.0.0.1:7788（状态/路由开关/ask/fanout/历史/登录）；',
    '- 历史回放：' + B + 'node "' + E + '" history' + B + '（列出）与 ' + B + 'history <jobId>' + B + '（完整双向对话）。',
    '',
    '## 会写哪些位置（卸载可还原）',
    '',
    '| 位置 | 内容 |',
    '|---|---|',
    '| ' + B + '~/.zcode/skills/wb-bridge/' + B + ' | **唯一安装物**：scripts 桥本体 + SKILL.md/PROMPTS.md + examples + docs 副本 + doubao/ 豆包桥副本（可选）+ .wbx-install.json 版本自证 manifest |',
    '| ' + B + '<各项目>/.wbx/' + B + ' | 运行时（随项目 git 根派生，已 gitignore）：sessions/product 凭证、config.json、jobs/ 历史、scratch/、cline-home/（可选 lane 隔离）、codex-home/（可选第五 lane 隔离）、run/logs（守护）、export/（分发导出） |',
    '',
    '不写 ~/.zcode/AGENTS.md、不装 ~/.zcode/cli/config.json 钩子、不建全局运行时。',
    '绝不写 ' + B + '~/.workbuddy' + B + '、' + B + '~/.workbuddy-ai' + B + '、' + B + '~/.cline' + B + '（用户自己的 Cline 状态）、桌面版安装目录、系统环境变量。',
    '',
    '## 卸载',
    '',
    F + 'bat',
    `node "${E}" self-uninstall   :: 删技能目录 + 停守护 + 一次性清扫（各项目 .wbx/ 含凭证保留）`,
    ':: 各项目 .wbx/（含凭证）如需清理：到对应项目目录手动删除 .wbx 文件夹',
    ':: 若装过可选 cline lane：npm uninstall -g cline',
    F,
    '',
    '解压出来的本目录可随手删（self-install 已复制到 ~/.zcode/skills/wb-bridge/）。',
    '',
    '## 常见问题',
    '',
    '- doctor「cli」红：WorkBuddy 桌面版没装或版本路径变了 → 重装/更新桌面版后重跑 doctor（会自动扫描写入 config），',
    '  或 ' + B + 'node scripts\\wbx.mjs config set cli-path "<codebuddy 完整路径>"' + B + '。',
    '- doctor 提示缺模板缓存：启动一次对应桌面版即可。',
    '- doctor 提示旧全局运行时 ~/.wbx/ 有凭证：v29 起不再使用全局运行时——到各项目重新',
    '  ' + B + 'login --identity cn|ai' + B + '，或自行把 ~/.wbx/sessions、~/.wbx/product 复制到目标项目 .wbx/。',
    '- 登录国际版遇到「登录失败」页：复制 login 命令输出里的锦囊 A URL 到地址栏回车。',
    '- cline lane 报 Unauthorized：OAuth 凭证过期 → 重新 ' + B + 'login --identity cline' + B + '。',
    '- 装过旧版本（v28 前旧布局 ~/.zcode/wbx-bridge/）：重跑 self-install 自动一次性迁移并时间戳备份，可续跑自愈。',
  ];
  return L.join('\n') + '\n';
}

// ---------- 安装 manifest（v3 起仅版本自证：记录哪个版本装了这份副本，不含形态/路径字段） ----------
function buildInstallManifest(createdRel) {
  return { schema_version: MANIFEST_SCHEMA_VERSION, version: WBX_VERSION, created: createdRel };
}

async function writeManifestAtomic(file, manifest) {
  const tmp = `${file}.tmp-${tsStamp()}-${Math.random().toString(36).slice(2, 6)}`;
  await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, file);
}

async function listCreatedRel(root) {
  const out = [];
  const walk = async (dir, rel) => {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), r);
      else out.push(r);
    }
  };
  await walk(root, '');
  return out.sort();
}

// ---------- self-install / self-uninstall ----------
async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}

// doubao 副本复制：剔除包内 tests/docs 目录与 source map（体积与文件数优化，运行时零依赖它们）
async function copyDirPruned(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    if (e.isDirectory() && PRUNE_DIRS.has(e.name)) continue;
    if (e.isFile() && e.name.endsWith('.map')) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDirPruned(s, d);
    else await fsp.copyFile(s, d);
  }
}

async function copyIfExists(src, dest) {
  try { await fsp.copyFile(src, dest); return true; } catch { return false; }
}

// 冒烟：新安装副本跑 doctor --quick，输出必须含根解析表（v29：每项目运行时，runtime 步恒绿）。
// 不要求 doctor 退出码 0——lane 未登录/CLI 未装是环境态不是安装缺陷（先装后登是支持流程）。
function runInstallSmoke() {
  const r = spawnSync(process.execPath, [skillEntryScript(), 'doctor', '--quick'], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const ok = typeof r.status === 'number' && out.includes('根解析表') && /每项目运行时/.test(out);
  return { ok, out: out.split(/\r?\n/).filter((l) => /runtime|根解析|FAIL/.test(l)).slice(0, 6).join(' | ') };
}

// 旧布局退役：改名 <路径>.backup-<时间戳>（确认后可删）；备份已存在=上次迁移中断，直接删旧自愈
async function retireToBackup(p, label, ts, report) {
  if (!fs.existsSync(p)) return;
  const bak = `${p}.backup-${ts}`;
  if (fs.existsSync(bak)) {
    await fsp.rm(p, RM_OPTS);
    report.push(`已删除 ${label}（先前备份已存在=迁移续跑自愈）`);
    return;
  }
  await fsp.rename(p, bak);
  report.push(`旧布局退役：${label} -> ${bak}（确认新安装正常后可整目录删除）`);
}

// ---------- 一次性迁移清扫（self-install / self-uninstall 共用；幂等，失败不阻断） ----------
// 探测并摘除 v28 及更早全局形态痕迹：AGENTS 标记块、自启钩子条目、v28 前旧布局
//（~/.zcode/wbx-bridge/、commands/wbx.md）。目标不存在=静默跳过；重复执行结果一致。
// 凭证红线：绝不自动迁移/复制/删除 ~/.wbx 下任何文件——检测到旧全局运行时仅提示，用户自决。
// home/markerPath 可注入（测试矩阵可注入性）；deep=true 时旧目录直接删（卸载零残留），否则时间戳备份。
const AGENTS_BLOCK_BEGIN = '<!-- wbx:begin -->';
const AGENTS_BLOCK_END = '<!-- wbx:end -->';
const legacyAgentsPath = (home) => path.join(home, '.zcode', 'AGENTS.md');
const legacyCliConfig = (home) => path.join(home, '.zcode', 'cli', 'config.json');
const legacyBridgeDir = (home) => path.join(home, '.zcode', 'wbx-bridge');
const legacyCmdFile = (home) => path.join(home, '.zcode', 'commands', 'wbx.md');
const AUTOSTART_MARKER = path.join(UI_RUN_DIR, 'autostart-enabled-by-wbx');

// 本桥历史安装面写过的自启钩子入口（v28 技能目录 + v28 前 wbx-bridge 目录双候选，仅清扫识别用）
function isWbxHookEntry(e, home) {
  if (!e || typeof e !== 'object' || !Array.isArray(e.args)) return false;
  const scripts = [path.join(home, '.zcode', 'skills', 'wb-bridge', 'scripts', 'wbx.mjs'), path.join(home, '.zcode', 'wbx-bridge', 'scripts', 'wbx.mjs')];
  return scripts.includes(e.args[0]) && e.args[1] === 'ui' && e.args[2] === '--detach';
}

// 摘 ~/.zcode/AGENTS.md 标记块（v28 及更早安装面写入；摘空连同文件删除，其余内容保留）
async function cleanupAgentsBlock(home, report) {
  const p = legacyAgentsPath(home);
  let cur;
  try { cur = await fsp.readFile(p, 'utf8'); }
  catch { report.push('AGENTS 标记块：无需清扫（~/.zcode/AGENTS.md 不存在）'); return; }
  if (!cur.includes(AGENTS_BLOCK_BEGIN)) { report.push('AGENTS 标记块：无需清扫（无 wbx 标记块）'); return; }
  const re = new RegExp(escapeRegExp(AGENTS_BLOCK_BEGIN) + '[\\s\\S]*?' + escapeRegExp(AGENTS_BLOCK_END) + '\\s*', 'g');
  const next = cur.replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  try {
    if (!next) { await fsp.rm(p, { force: true }); report.push('AGENTS 标记块：已摘除（文件已空，连同 ~/.zcode/AGENTS.md 删除）'); }
    else { await fsp.writeFile(p, next + '\n', 'utf8'); report.push('AGENTS 标记块：已摘除（其余内容保留）'); }
  } catch (e) {
    report.push(`[FAIL] AGENTS 标记块摘除失败（${e && e.message}）——手动处理：编辑 ${p} 删除 <!-- wbx:begin -->…<!-- wbx:end --> 段`);
  }
}

// 摘 ~/.zcode/cli/config.json 自启钩子条目（读-改-写合并；绝不改写他人键；enabled 仅在 marker
// 证明由本桥置 true 时还原——marker 在装钩子那台机器的项目运行时内，不在当前项目=无法证明，
// 保持原状是安全默认）。结构异常=跳过不写，报手动命令。
async function cleanupAutostartHooks({ home = HOME, markerPath = AUTOSTART_MARKER, report }) {
  const p = legacyCliConfig(home);
  if (!fs.existsSync(p)) { report.push('自启钩子：无需清扫（~/.zcode/cli/config.json 不存在）'); return; }
  let cfg;
  try { cfg = JSON.parse(await fsp.readFile(p, 'utf8')); }
  catch (e) { report.push(`[FAIL] 自启钩子清扫中止（读取 ${p} 失败：${e && e.message}）——请手动检查 hooks.events.SessionStart`); return; }
  const hooks = cfg && typeof cfg === 'object' && cfg.hooks && typeof cfg.hooks === 'object' && !Array.isArray(cfg.hooks) ? cfg.hooks : null;
  const events = hooks && hooks.events && typeof hooks.events === 'object' && !Array.isArray(hooks.events) ? hooks.events : null;
  const list = events && Array.isArray(events.SessionStart) ? events.SessionStart : null;
  if (!list || !list.some((g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => isWbxHookEntry(h, home)))) {
    report.push('自启钩子：无需清扫（SessionStart 无 wbx 钩子条目）');
    return;
  }
  for (const g of list) {
    if (g && Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => !isWbxHookEntry(h, home));
  }
  const cleaned = list.filter((g) => g && Array.isArray(g.hooks) && g.hooks.length > 0);
  if (cleaned.length) events.SessionStart = cleaned;
  else delete events.SessionStart;
  const eventsEmpty = !events || Object.keys(events).length === 0;
  if (eventsEmpty) {
    delete hooks.events;
    if (fs.existsSync(markerPath)) {
      let enabledBefore = 'absent';
      try { enabledBefore = JSON.parse(fs.readFileSync(markerPath, 'utf8')).enabledBefore ?? 'absent'; } catch { /* 按缺失处理 */ }
      if (enabledBefore === 'absent') delete hooks.enabled;
      else if (typeof enabledBefore === 'boolean') hooks.enabled = enabledBefore;
      try { fs.rmSync(markerPath, { force: true }); } catch { /* 尽力而为 */ }
    }
    if (!Object.keys(hooks).length) delete cfg.hooks;
  }
  try {
    const tmp = p + '.wbx-tmp';
    await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    await fsp.rename(tmp, p);
    report.push(`自启钩子：已摘除 wbx 条目${eventsEmpty ? '（钩子结构已清空的键一并还原）' : '（其他既有钩子原样保留）'}：${p}`);
  } catch (e) {
    report.push(`[FAIL] 自启钩子摘除失败（${e && e.message}）——手动处理：编辑 ${p} 删除 hooks.events.SessionStart 中 command 指向 wbx.mjs 的条目`);
  }
}

// 清扫主入口：旧布局退役（deep=直接删/否则时间戳备份）+ 斜杠命令 + AGENTS 块 + 钩子 + ~/.wbx 提示
export async function runLegacyCleanup({ home = HOME, markerPath, report, deep = false } = {}) {
  if (fs.existsSync(legacyBridgeDir(home))) {
    if (deep) {
      try { await fsp.rm(legacyBridgeDir(home), RM_OPTS); report.push('已删除 v28 前旧布局 ~/.zcode/wbx-bridge/'); }
      catch (e) { report.push(`[FAIL] 旧布局删除失败（${e && e.message}）——手动删除 ${legacyBridgeDir(home)}`); }
    } else {
      await retireToBackup(legacyBridgeDir(home), 'v28 前旧布局 ~/.zcode/wbx-bridge/', tsStamp(), report);
    }
  } else {
    report.push('旧布局 ~/.zcode/wbx-bridge/：无需清扫（不存在）');
  }
  if (fs.existsSync(legacyCmdFile(home))) {
    await fsp.rm(legacyCmdFile(home), { force: true });
    report.push('旧斜杠命令 ~/.zcode/commands/wbx.md 已删除（/wbx v28 退役，无保留价值不备份）');
  } else {
    report.push('旧斜杠命令 commands/wbx.md：无需清扫（不存在）');
  }
  await cleanupAgentsBlock(home, report);
  await cleanupAutostartHooks({ home, ...(markerPath ? { markerPath } : {}), report });
  const oldGlobalRt = path.join(home, '.wbx');
  if (fs.existsSync(oldGlobalRt)) {
    const hasCred = LANE_ORDER.some((l) => fs.existsSync(path.join(oldGlobalRt, 'sessions', `${l}.json`))
      || fs.existsSync(path.join(oldGlobalRt, 'product', `${l}.json`)));
    report.push(`[INFO] 检测到旧全局运行时 ${oldGlobalRt}${hasCred ? '（含凭证）' : ''}：v29 起不再使用——凭证不自动迁移；需要请在各项目重新 wbx login，或自行复制 sessions/product 到该项目 .wbx/（确认无用后可手动删除整个目录）`);
  }
}

export async function selfInstall() {
  const report = [];
  const ts = tsStamp();
  const srcScripts = SCRIPT_DIR;
  const srcSkillDir = path.dirname(srcScripts);

  // 0. 源完整性
  for (const f of CORE_SCRIPTS) {
    if (!fs.existsSync(path.join(srcScripts, f))) throw new Error(`桥源不完整：缺 ${path.join(srcScripts, f)}`);
  }
  const srcSkill = path.join(srcSkillDir, 'SKILL.md');
  if (!fs.existsSync(srcSkill)) throw new Error(`桥源不完整：缺 ${srcSkill}`);

  // 1. 临时目录就绪（与目标同父目录=同卷，rename 原子替换；中断残留由下次运行/uninstall 清理）
  const skillsParent = path.dirname(GLOBAL_SKILL_DIR);
  const staging = path.join(skillsParent, `.wb-bridge.staging-${ts}`);
  await fsp.rm(staging, RM_OPTS);
  await fsp.mkdir(path.join(staging, 'scripts'), { recursive: true });
  for (const f of CORE_SCRIPTS) await fsp.copyFile(path.join(srcScripts, f), path.join(staging, 'scripts', f));
  await fsp.writeFile(path.join(staging, 'SKILL.md'), globalSkillText(await fsp.readFile(srcSkill, 'utf8')), 'utf8');
  await copyIfExists(path.join(srcSkillDir, 'PROMPTS.md'), path.join(staging, 'PROMPTS.md'));
  try { await copyDir(path.join(srcSkillDir, 'examples'), path.join(staging, 'examples')); } catch { /* 无 examples */ }
  await fsp.mkdir(path.join(staging, 'docs'), { recursive: true });
  for (const d of DOC_FILES) {
    await copyIfExists(path.join(PROJECT_ROOT, d), path.join(staging, 'docs', d));
  }
  report.push(`技能目录内容就绪 -> ${staging}{scripts×${CORE_SCRIPTS.length}, SKILL.md${fs.existsSync(path.join(staging, 'PROMPTS.md')) ? ', PROMPTS.md' : ''}${fs.existsSync(path.join(staging, 'examples')) ? ', examples' : ''}${fs.existsSync(path.join(staging, 'docs')) ? ', docs' : ''}}`);

  // 1b. 豆包桥（第四 lane 的运行时 + 手工直通旁路）：源候选=本技能目录内 doubao/（重装保副本）
  //     → 源码仓 tools/doubao-bridge/。缺失/失败只 WARN 不阻断；export-bundle 分发包不含它。
  let doubaoCopied = false;
  const srcDoubao = [path.join(srcSkillDir, 'doubao'), path.join(PROJECT_ROOT, 'tools', 'doubao-bridge')]
    .find((d) => fs.existsSync(path.join(d, 'doubao.mjs')));
  if (srcDoubao) {
    try {
      await copyDirPruned(srcDoubao, path.join(staging, 'doubao'));
      // 装完即验：入口/锚点/依赖缺一即视为复制不完整，走 WARN 路径提示手动整拷
      const essential = ['doubao.mjs', 'anchors.json', 'launch.ps1', path.join('node_modules', 'playwright-core')];
      const missing = essential.filter((f) => !fs.existsSync(path.join(staging, 'doubao', f)));
      if (missing.length) throw new Error(`复制不完整，缺 ${missing.join('、')}`);
      doubaoCopied = true;
      report.push(`豆包桥 -> ${path.join(GLOBAL_SKILL_DIR, 'doubao')}${path.sep}（可选工具；入口 wbx doubao <子命令>；已剔除 tests/docs/source map）`);
    } catch (e) {
      await fsp.rm(path.join(staging, 'doubao'), RM_OPTS);
      report.push(`[WARN] 豆包桥复制失败（${e && e.message}）——不影响其余 lane；可手动整目录复制 ${srcDoubao} -> ${path.join(GLOBAL_SKILL_DIR, 'doubao')}`);
    }
  } else {
    report.push('[WARN] 未找到 doubao.mjs（豆包桥为可选工具，跳过；源码仓内重跑 self-install 可带上）');
  }

  // 2. manifest（最后写入临时目录；v3 仅版本自证，rename 后随技能目录转正）
  await writeManifestAtomic(path.join(staging, INSTALL_MANIFEST_NAME), buildInstallManifest(await listCreatedRel(staging)));

  // 3. 原子替换：旧目标挪走 → staging 转正（失败即回滚保旧）→ 旧目标按来源处置
  const hadTarget = fs.existsSync(GLOBAL_SKILL_DIR);
  const replaced = `${GLOBAL_SKILL_DIR}.replaced-${ts}`;
  if (hadTarget) await fsp.rename(GLOBAL_SKILL_DIR, replaced);
  try {
    await fsp.rename(staging, GLOBAL_SKILL_DIR);
  } catch (e) {
    if (hadTarget) await fsp.rename(replaced, GLOBAL_SKILL_DIR);
    throw new Error(`技能目录替换失败（${e && e.message}）；已回滚保持原状`);
  }
  report.push(`技能目录已转正 -> ${GLOBAL_SKILL_DIR}（rename 原子替换）`);
  if (hadTarget) {
    const oldWasOurs = fs.existsSync(path.join(replaced, INSTALL_MANIFEST_NAME));
    if (oldWasOurs) {
      await fsp.rm(replaced, RM_OPTS);   // 本桥自身旧安装（幂等重装）：直接清理，不留备份
    } else {
      // v28 前无 manifest 的旧 skill 副本：时间戳备份（确认后可删）；备份已存在=迁移续跑自愈
      const skillBak = `${GLOBAL_SKILL_DIR}.backup-${ts}`;
      if (fs.existsSync(skillBak)) await fsp.rm(replaced, RM_OPTS);
      else await fsp.rename(replaced, skillBak);
      report.push(`旧布局退役：无脚本旧 skill 副本 -> ${skillBak}（确认新安装正常后可整目录删除）`);
    }
  }

  // 4. 冒烟：新副本 doctor --quick 必须输出根解析表（每项目运行时）；失败不退役旧布局（可续跑）
  const smoke = runInstallSmoke();
  if (!smoke.ok) {
    throw new Error(`安装冒烟失败：新副本 doctor --quick 未输出根解析表（${smoke.out || '无输出'}）。新布局已就位；重跑 self-install 自愈`);
  }
  report.push('冒烟通过：新副本 doctor --quick 输出根解析表（每项目运行时）');

  // 5. 一次性迁移清扫（幂等；失败不阻断安装，逐项报告+手动命令；绝不触碰 ~/.wbx 凭证）
  await runLegacyCleanup({ home: HOME, report });

  return {
    ok: true, skillDir: GLOBAL_SKILL_DIR, script: skillEntryScript(),
    report, doubaoCopied,
  };
}

export async function selfUninstall() {
  const report = [];
  const rm = async (p, label) => {
    try { await fsp.rm(p, RM_OPTS); report.push(`已删除 ${label}（${p}）`); }
    catch { report.push(`跳过 ${label}（${p} 不存在或不可删）`); }
  };
  // 1. 先停守护进程（在删技能目录之前，保证可执行文件还在时完成清理）
  try {
    const { stopUi } = await import('./wbx-daemon.mjs');
    const r = await stopUi();
    report.push(`${r.ok ? '已停止控制台守护进程' : '控制台守护进程清理'}：${r.message}`);
  } catch (e) { report.push(`跳过守护进程停止（${e && e.message}）`); }
  // 2. 一次性清扫（deep=旧目录直接删；AGENTS 块/钩子/斜杠命令摘除；~/.wbx 只提示）
  await runLegacyCleanup({ home: HOME, report, deep: true });
  // 3. 技能目录（整目录即 manifest.created 的安装面）
  const manifestRead = readInstallManifest(path.join(GLOBAL_SKILL_DIR, 'scripts'));
  const verNote = manifestRead.status === 'ok' ? `（v${manifestRead.manifest.version} 安装；.wbx-install.json 随目录移除）` : '';
  await rm(GLOBAL_SKILL_DIR, `技能目录 ~/.zcode/skills/wb-bridge/${verNote}`);
  // 4. 迁移/安装过程残留与备份（一键还原承诺=本桥名下零残留）
  const skillsParent = path.dirname(GLOBAL_SKILL_DIR);
  for (const name of (fs.existsSync(skillsParent) ? await fsp.readdir(skillsParent) : [])) {
    if (name.startsWith('.wb-bridge.staging-') || /^wb-bridge\.(replaced|backup)-/.test(name)) {
      await rm(path.join(skillsParent, name), `技能目录旁残留 ${name}`);
    }
  }
  const zcodeDir = path.join(HOME, '.zcode');
  for (const name of (fs.existsSync(zcodeDir) ? await fsp.readdir(zcodeDir) : [])) {
    if (/^wbx-bridge\.backup-/.test(name)) await rm(path.join(zcodeDir, name), `旧布局备份 ${name}`);
  }
  report.push('各项目运行时 .wbx/（含凭证）不属安装物，一律保留（如需清理请在各项目内手动删除）');
  return { ok: true, report };
}

// ---------- export-bundle ----------
function collectBundleEntries() {
  const entries = [];
  const add = (name, data) => entries.push({ name, data });
  const root = `wbx-bridge-v${WBX_VERSION}/`;
  // 根入口 stub（安装命令可写 node wbx.mjs self-install）
  add(`${root}wbx.mjs`, '#!/usr/bin/env node\n// 分发包根入口：转发到 scripts/wbx.mjs（真正入口在同目录 scripts/ 下）\nimport("./scripts/wbx.mjs");\n');
  // scripts/
  for (const f of CORE_SCRIPTS) {
    const p = path.join(SCRIPT_DIR, f);
    if (fs.existsSync(p)) add(`${root}scripts/${f}`, fs.readFileSync(p));
  }
  // SKILL.md + PROMPTS.md（v4 worker 提示词模板库）
  add(`${root}SKILL.md`, fs.readFileSync(path.join(path.dirname(SCRIPT_DIR), 'SKILL.md')));
  add(`${root}PROMPTS.md`, fs.readFileSync(path.join(path.dirname(SCRIPT_DIR), 'PROMPTS.md')));
  // examples/
  const exDir = path.join(path.dirname(SCRIPT_DIR), 'examples');
  if (fs.existsSync(exDir)) {
    for (const e of fs.readdirSync(exDir)) {
      add(`${root}examples/${e}`, fs.readFileSync(path.join(exDir, e)));
    }
  }
  // docs/
  for (const d of DOC_FILES) {
    const p = path.join(PROJECT_ROOT, d);
    if (fs.existsSync(p)) add(`${root}docs/${d}`, fs.readFileSync(p));
  }
  // INSTALL-README.md（随包生成；布局同技能目录，manifest 由接收方 self-install 时生成）
  add(`${root}INSTALL-README.md`, installReadmeText());
  return entries;
}

// 零凭证自检：任何成员路径不含 .wbx；文本内容不含任何已知 accessToken 值
function assertBundleClean(entries) {
  for (const e of entries) {
    if (e.name.includes('.wbx')) {
      throw new Error(`[SELF-CHECK FAIL] 分发包包含运行时路径成员：${e.name}`);
    }
  }
  const tokenVals = [];
  const roots = [RUNTIME_ROOT];
  for (const root of roots) {
    for (const l of LANE_ORDER) {
      for (const rel of [`sessions/${l}.json`, `product/${l}.json`]) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
          const t = j?.auth?.accessToken || j?.authentication?.attributes?.token;
          if (t) tokenVals.push(String(t));
        } catch { /* 不存在 */ }
      }
    }
    // cline lane 的 OAuth 凭证（v5：HOME 覆盖目录下 providers.json）
    for (const prov of ['cline-home/.cline/data/settings/providers.json', 'cline/data/settings/providers.json']) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(root, prov), 'utf8'));
        for (const p of Object.values(j?.providers || {})) {
          const t = p?.settings?.auth?.accessToken || p?.apiKey;
          if (t) tokenVals.push(String(t));
        }
      } catch { /* 不存在 */ }
    }
  }
  for (const e of entries) {
    const text = e.data.toString('utf8');
    for (const t of tokenVals) {
      if (t.length > 20 && text.includes(t)) throw new Error(`[SELF-CHECK FAIL] 成员 ${e.name} 含凭证值（accessToken）`);
    }
  }
  return tokenVals.length;
}

export async function exportBundle({ out = null } = {}) {
  const entries = collectBundleEntries();
  const knownTokens = assertBundleClean(entries);
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const zipName = `wbx-bridge-v${WBX_VERSION}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}.zip`;
  let outFile;
  if (out) {
    out = path.resolve(out);
    const st = fs.existsSync(out) ? fs.statSync(out) : null;
    outFile = st && st.isDirectory() ? path.join(out, zipName) : (out.endsWith('.zip') ? out : path.join(out, zipName));
  } else {
    // v29：默认落 <git 根>/.wbx/export/（临时/导出产物一律入运行时根，绝不落家目录/桌面）
    outFile = path.join(EXPORT_DIR, zipName);
  }
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await fsp.writeFile(outFile, zipStore(entries));
  const size = fs.statSync(outFile).size;
  return {
    ok: true, outFile, size, count: entries.length,
    entries: entries.map((e) => e.name),
    selfCheck: `未发现已知凭证值（比对 ${knownTokens} 个本地 accessToken 值；成员路径无 .wbx 运行时面）`,
  };
}
