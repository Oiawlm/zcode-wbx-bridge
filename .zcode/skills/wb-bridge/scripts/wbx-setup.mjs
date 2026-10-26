/**
 * wbx-setup — wbx 桥的安装 / 卸载 / 分发打包
 *
 * - selfInstall（v28-A 布局）：整目录安装到唯一技能目录 ~/.zcode/skills/wb-bridge/
 *   （scripts + SKILL.md/PROMPTS.md + examples + docs + doubao/ + .wbx-install.json 安装自证
 *   manifest），临时目录就绪后 rename 原子替换、幂等可重装；探测到 v28 前旧布局
 *   （~/.zcode/wbx-bridge/、无脚本旧 skill 副本、~/.zcode/commands/wbx.md）时自动一次性迁移：
 *   装新 → 冒烟（新副本 doctor --quick 输出 manifest 自证）→ 旧目录改名 <name>.backup-<时间戳>
 *   （确认新安装正常后可删）；迁移中断后重跑自愈。--adopt 把项目 .wbx/ 的五 lane 凭证迁到
 *   ~/.wbx/（--no-keep-project 迁移后删除项目侧凭证，默认保留；tasks/ 历史始终保留）。
 * - selfUninstall：按 manifest 反向移除技能目录与 AGENTS 块，并清理迁移备份/staging 残留与
 *   v28 前旧布局；--purge 连 ~/.wbx/（含凭证）一起删，默认保留。
 * - exportBundle：生成零凭证分发 zip（scripts/ + SKILL.md + examples/ + docs/ + INSTALL-README.md，
 *   布局同技能目录；manifest 由接收方 self-install 时生成），纯 Node 实现 zip（store），
 *   导出后自检断言不含任何凭证值。
 *
 * 写用户目录仅限三处 + 运行时：~/.zcode/skills/wb-bridge/（含安装 manifest）、~/.zcode/AGENTS.md
 * 标记块、~/.zcode/ 下本桥迁移备份/旧布局清理、~/.wbx/。/wbx 斜杠命令（~/.zcode/commands/wbx.md）
 * v28-A 起退役：确定性入口=AGENTS 块 + 显式 /wb-bridge 技能调用。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  HOME, PROJECT_ROOT, SCRIPT_DIR, GLOBAL_SKILL_DIR, GLOBAL_BRIDGE_DIR, GLOBAL_RUNTIME_DIR,
  INSTALL_MANIFEST_NAME, MANIFEST_SCHEMA_VERSION, readInstallManifest,
} from './wbx-paths.mjs';
import {
  LANE_ORDER, installUserBlock, uninstallUserBlock, WBX_VERSION, crc32,
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
//   ② 相对入口路径改写为新布局安装期绝对路径（禁 `~`——PowerShell 对原生程序不展开）；
//     项目运行时路径改写为全局数据根。
export function globalSkillText(sourceSkill) {
  const gscript = skillEntryScript();
  return sourceSkill
    .replace(/<!-- wbx:project-only -->[\s\S]*?<!-- \/wbx:project-only -->\n?/g, '')
    .replace(/node "?\.zcode[\\/]skills[\\/]wb-bridge[\\/]scripts[\\/]wbx\.mjs"?/g, `node "${gscript}"`)
    .replace(/\.zcode[\\/]skills[\\/]wb-bridge[\\/]scripts[\\/]wbx\.mjs/g, gscript)
    .replace(/<项目>\/\.wbx\/jobs\//g, '~/.wbx/jobs/')
    + '\n> 注：本文件是用户级安装副本（唯一技能目录 ~/.zcode/skills/wb-bridge/，命令入口为安装期绝对路径；同目录 .wbx-install.json 为安装自证 manifest）。本副本遮蔽同名项目级 skill。\n';
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
    ':: 2. 全局安装（唯一技能目录 ~/.zcode/skills/wb-bridge/ + AGENTS 块 + ~/.wbx/，见下方"会写哪些位置"）',
    'node scripts\\wbx.mjs self-install',
    '',
    ':: 3. 登录两个 lane（各一次，凭证约 55 天有效）',
    'node scripts\\wbx.mjs login --identity cn   :: 国内版：微信扫码',
    'node scripts\\wbx.mjs login --identity ai   :: 国际版：邮箱/OneID（输出里有 state 修补锦囊）',
    F,
    '',
    '装完自检：' + B + 'node "' + E + '" doctor --quick' + B + '，两个 lane 全绿即就绪。',
    '装过 v28 前旧布局（~/.zcode/wbx-bridge/）的机器：self-install 自动一次性迁移到新技能目录，',
    '旧目录改名 <名称>.backup-<时间戳> 保留，确认新安装正常后可整目录删除。',
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
    '- **任何项目的 ZCode 会话**直接说「帮我调研 A、B、C…」即可触发主动分派（安装已写入用户级 skill + ~/.zcode/AGENTS.md 标记块）；',
    '- 显式确定性入口：会话内输入 ' + B + '/wb-bridge' + B + ' 或按技能说明调用（斜杠命令 /wbx 已于 v28 退役）；',
    '- 手动调用（装好后任何位置可用的全局入口，路径含空格要加引号）：',
    '  ' + B + 'node "' + E + '" ask --text "…"' + B + '、',
    '  ' + B + 'fanout --file tasks.json' + B + '；',
    '- 可视化：' + B + 'node "' + E + '" ui' + B +
    ' → 浏览器自动打开 http://127.0.0.1:7788（状态/路由开关/ask/fanout/历史/登录）；',
    '- 历史回放：' + B + 'node "' + E + '" history' + B + '（列出）与 ' + B + 'history <jobId>' + B + '（完整双向对话）。',
    '',
    '## 会写哪些位置（卸载可完全还原）',
    '',
    '| 位置 | 内容 |',
    '|---|---|',
    '| ' + B + '~/.zcode/skills/wb-bridge/' + B + ' | **唯一技能目录**（v28-A 收拢）：scripts 桥本体 + SKILL.md/PROMPTS.md + examples + docs 副本 + doubao/ 豆包桥副本（可选）+ .wbx-install.json 安装自证 manifest |',
    '| ' + B + '~/.zcode/AGENTS.md' + B + ' | ' + B + '<!-- wbx:begin/end -->' + B + ' 标记块（唯一例外：每会话自动注入不可替代） |',
    '| ' + B + '~/.wbx/' + B + ' | 运行时：sessions/product 凭证、config.json、jobs/ 历史、cline-home/（可选 lane 隔离主目录）、codex-home/（可选第五 lane 隔离：auth.json 副本+work/） |',
    '',
    '绝不写 ' + B + '~/.workbuddy' + B + '、' + B + '~/.workbuddy-ai' + B + '、' + B + '~/.cline' + B + '（用户自己的 Cline 状态）、桌面版安装目录、系统环境变量。',
    '',
    '## 卸载',
    '',
    F + 'bat',
    `node "${E}" self-uninstall          :: 移除技能目录+AGENTS 块（保留 ~/.wbx/ 凭证）`,
    `node "${E}" self-uninstall --purge  :: 连 ~/.wbx/（含凭证、cline-home/）一起删`,
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
    '- 登录国际版遇到「登录失败」页：复制 login 命令输出里的锦囊 A URL 到地址栏回车。',
    '- cline lane 报 Unauthorized：OAuth 凭证过期 → 重新 ' + B + 'login --identity cline' + B + '。',
    '- 报「manifest schema_version … 拒绝降级」：本副本版本低于已装版本——升级本目录副本后重跑 self-install。',
  ];
  return L.join('\n') + '\n';
}

// ---------- 安装 manifest（写入/原子写） ----------
function buildInstallManifest(installRoot, createdRel) {
  return { schema_version: MANIFEST_SCHEMA_VERSION, version: WBX_VERSION, installRoot, created: createdRel, state: 'active' };
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

// 冒烟：新安装副本跑 doctor --quick，输出必须含 manifest 自证（form=global + installRoot=本技能目录）。
// 不要求 doctor 退出码 0——lane 未登录/CLI 未装是环境态不是安装缺陷（先装后登是支持流程）。
function runInstallSmoke() {
  const r = spawnSync(process.execPath, [skillEntryScript(), 'doctor', '--quick'], {
    encoding: 'utf8', timeout: 60000, env: { ...process.env },
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const ok = typeof r.status === 'number' && out.includes('form=global') && out.includes(`installRoot=${GLOBAL_SKILL_DIR}`);
  return { ok, out: out.split(/\r?\n/).filter((l) => /runtime|根解析|form=|installRoot|FAIL/.test(l)).slice(0, 6).join(' | ') };
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

export async function selfInstall({ adopt = false, keepProject = true } = {}) {
  const report = [];
  const ts = tsStamp();
  const srcScripts = SCRIPT_DIR;
  const srcSkillDir = path.dirname(srcScripts);

  // 0. 源完整性
  for (const f of CORE_SCRIPTS) {
    if (!fs.existsSync(path.join(srcScripts, f))) throw new Error(`桥源不完整：缺 ${path.join(srcScripts, f)}`);
  }

  // 0b. 降级护栏：已装副本 manifest schema 高于本桥 → 拒绝覆盖（防旧版装新版安装之上）
  const prevManifestRead = readInstallManifest(path.join(GLOBAL_SKILL_DIR, 'scripts'));
  if (prevManifestRead.status === 'incompatible') throw new Error(prevManifestRead.message);

  // 0c. 旧布局探测（v28 前三处：wbx-bridge 目录 / 无脚本旧 skill 副本 / commands/wbx.md）
  const legacy = {
    bridgeDir: fs.existsSync(GLOBAL_BRIDGE_DIR),
    legacySkill: fs.existsSync(GLOBAL_SKILL_DIR) && !fs.existsSync(path.join(GLOBAL_SKILL_DIR, 'scripts', 'wbx.mjs')),
    cmdFile: fs.existsSync(path.join(HOME, '.zcode', 'commands', 'wbx.md')),
  };
  if (legacy.bridgeDir || legacy.legacySkill || legacy.cmdFile) {
    report.push(`探测到 v28 前旧布局（${[legacy.bridgeDir && '~/.zcode/wbx-bridge/', legacy.legacySkill && '无脚本旧 skill 副本', legacy.cmdFile && '~/.zcode/commands/wbx.md'].filter(Boolean).join('、')}）：本次安装将一次性迁移`);
  }

  // 1. 临时目录就绪（与目标同父目录=同卷，rename 原子替换；中断残留由下次运行/uninstall 清理）
  const skillsParent = path.dirname(GLOBAL_SKILL_DIR);
  const staging = path.join(skillsParent, `.wb-bridge.staging-${ts}`);
  await fsp.rm(staging, RM_OPTS);
  await fsp.mkdir(path.join(staging, 'scripts'), { recursive: true });
  for (const f of CORE_SCRIPTS) await fsp.copyFile(path.join(srcScripts, f), path.join(staging, 'scripts', f));
  const srcSkill = path.join(srcSkillDir, 'SKILL.md');
  if (!fs.existsSync(srcSkill)) throw new Error(`桥源不完整：缺 ${srcSkill}`);
  await fsp.writeFile(path.join(staging, 'SKILL.md'), globalSkillText(await fsp.readFile(srcSkill, 'utf8')), 'utf8');
  await copyIfExists(path.join(srcSkillDir, 'PROMPTS.md'), path.join(staging, 'PROMPTS.md'));
  try { await copyDir(path.join(srcSkillDir, 'examples'), path.join(staging, 'examples')); } catch { /* 无 examples */ }
  await fsp.mkdir(path.join(staging, 'docs'), { recursive: true });
  for (const d of DOC_FILES) {
    await copyIfExists(path.join(PROJECT_ROOT, d), path.join(staging, 'docs', d));
  }
  report.push(`技能目录内容就绪 -> ${staging}{scripts×${CORE_SCRIPTS.length}, SKILL.md${fs.existsSync(path.join(staging, 'PROMPTS.md')) ? ', PROMPTS.md' : ''}${fs.existsSync(path.join(staging, 'examples')) ? ', examples' : ''}${fs.existsSync(path.join(staging, 'docs')) ? ', docs' : ''}}`);

  // 1b. 豆包桥（第四 lane 的运行时 + 手工直通旁路）：tools/doubao-bridge/ 剔冗余后 -> <技能目录>/doubao/。
  //     缺失/失败只 WARN 不阻断；export-bundle 分发包不含它（可选工具，接收方自行从源码仓取）。
  let doubaoCopied = false;
  const srcDoubao = path.join(PROJECT_ROOT, 'tools', 'doubao-bridge');
  if (fs.existsSync(path.join(srcDoubao, 'doubao.mjs'))) {
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
    report.push(`[WARN] 未找到 ${srcDoubao}（豆包桥为可选工具，跳过；不影响其余 lane）`);
  }

  // 2. manifest（最后写入临时目录；installRoot=最终技能目录——rename 后即自证）
  await writeManifestAtomic(path.join(staging, INSTALL_MANIFEST_NAME), buildInstallManifest(GLOBAL_SKILL_DIR, await listCreatedRel(staging)));

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

  // 4. 冒烟：新副本 doctor --quick 必须 manifest 自证通过；失败则旧布局不退役（迁移可续跑）
  const smoke = runInstallSmoke();
  if (!smoke.ok) {
    throw new Error(`安装冒烟失败：新副本 doctor --quick 未输出 manifest 自证（${smoke.out || '无输出'}）。新布局已就位、旧布局未退役；重跑 self-install 自愈`);
  }
  report.push(`冒烟通过：新副本 doctor --quick 输出 form=global + installRoot=${GLOBAL_SKILL_DIR}`);

  // 5. 旧布局退役（仅在冒烟通过后；一次性迁移。无脚本旧 skill 副本已随第 3 步时间戳备份）
  if (legacy.bridgeDir) await retireToBackup(GLOBAL_BRIDGE_DIR, '旧布局 ~/.zcode/wbx-bridge/', ts, report);
  if (legacy.cmdFile) {
    await fsp.rm(path.join(HOME, '.zcode', 'commands', 'wbx.md'), { force: true });
    report.push('旧斜杠命令 ~/.zcode/commands/wbx.md 已删除（/wbx v28 退役，文件无保留价值不备份）');
  }

  // 6. ~/.zcode/AGENTS.md 标记块（指向新技能目录入口）
  const agPath = await installUserBlock(skillEntryScript());
  report.push(`全局指令块 -> ${agPath}（指向 ${skillEntryScript()}）`);

  // 7. 全局运行时 ~/.wbx/
  for (const sub of ['sessions', 'product', 'config', 'jobs']) {
    await fsp.mkdir(path.join(GLOBAL_RUNTIME_DIR, sub), { recursive: true });
  }
  report.push(`全局运行时 -> ${GLOBAL_RUNTIME_DIR}{/sessions,/product,/config,/jobs}`);

  // 8. --adopt：项目 .wbx/ 凭证迁移到 ~/.wbx/
  const srcWbx = path.join(PROJECT_ROOT, '.wbx');
  const hasProjectCreds = LANE_ORDER.some((l) => fs.existsSync(path.join(srcWbx, 'sessions', `${l}.json`)));
  if (adopt) {
    let moved = [];
    for (const l of LANE_ORDER) {
      const sSess = path.join(srcWbx, 'sessions', `${l}.json`);
      const sProd = path.join(srcWbx, 'product', `${l}.json`);
      const dSess = path.join(GLOBAL_RUNTIME_DIR, 'sessions', `${l}.json`);
      const dProd = path.join(GLOBAL_RUNTIME_DIR, 'product', `${l}.json`);
      const hasSrc = fs.existsSync(sSess) && fs.existsSync(sProd);
      if (!hasSrc) continue;
      if (fs.existsSync(dSess)) { moved.push(`${l}(目标已存在，跳过)`); continue; }
      await fsp.mkdir(path.dirname(dSess), { recursive: true });
      await fsp.copyFile(sSess, dSess);
      await fsp.copyFile(sProd, dProd);
      moved.push(l);
    }
    // CLI 隔离配置目录一并迁移（缓存，非必需）
    for (const l of LANE_ORDER) {
      const sCfg = path.join(srcWbx, 'config', l);
      if (fs.existsSync(sCfg)) { try { await copyDir(sCfg, path.join(GLOBAL_RUNTIME_DIR, 'config', l)); } catch { /* 非必需 */ } }
    }
    if (!keepProject) {
      await fsp.rm(path.join(srcWbx, 'sessions'), RM_OPTS);
      await fsp.rm(path.join(srcWbx, 'product'), RM_OPTS);
      await fsp.rm(path.join(srcWbx, 'config'), RM_OPTS);
      report.push(`--adopt 完成：凭证迁移 ${moved.join(', ') || '（无）'}；--no-keep-project：项目 .wbx/ 的 sessions/product/config 已删除（tasks/ 历史保留）`);
    } else {
      report.push(`--adopt 完成：凭证迁移 ${moved.join(', ') || '（无）'}；项目 .wbx/ 原凭证保留（默认）`);
    }
  } else if (hasProjectCreds) {
    const destHasAll = LANE_ORDER.every((l) => fs.existsSync(path.join(GLOBAL_RUNTIME_DIR, 'sessions', `${l}.json`)) === fs.existsSync(path.join(srcWbx, 'sessions', `${l}.json`)));
    if (!destHasAll) {
      report.push(`[WARN] 项目 ${srcWbx} 检测到凭证但未加 --adopt：安装后本机桥统一使用 ~/.wbx/ 全局运行时，项目侧凭证不会被读取。建议：wbx self-install --adopt（或手动把 .wbx/sessions、.wbx/product 复制到 ~/.wbx/）`);
    }
  }

  return {
    ok: true, skillDir: GLOBAL_SKILL_DIR, script: skillEntryScript(),
    runtimeDir: GLOBAL_RUNTIME_DIR, report, doubaoCopied,
    migration: { detected: legacy.bridgeDir || legacy.legacySkill || legacy.cmdFile, retired: legacy.bridgeDir || legacy.cmdFile },
  };
}

export async function selfUninstall({ purge = false } = {}) {
  const report = [];
  const rm = async (p, label) => {
    try { await fsp.rm(p, RM_OPTS); report.push(`已删除 ${label}（${p}）`); }
    catch { report.push(`跳过 ${label}（${p} 不存在或不可删）`); }
  };
  // 先停守护进程、摘自启钩子（都在删技能目录之前，保证可执行文件还在时完成清理）
  try {
    const { stopUi } = await import('./wbx-daemon.mjs');
    const r = await stopUi();
    report.push(`${r.ok ? '已停止控制台守护进程' : '控制台守护进程清理'}：${r.message}`);
  } catch (e) { report.push(`跳过守护进程停止（${e && e.message}）`); }
  try {
    const { removeAutostart } = await import('./wbx-daemon.mjs');
    const r = await removeAutostart();
    report.push(`${r.removed ? '已摘除' : '无需摘除'}自启钩子：${r.message}`);
  } catch (e) { report.push(`跳过自启钩子摘除（${e && e.message}；如曾 --install-autostart 请手动检查 ~/.zcode/cli/config.json 的 hooks`); }
  // 技能目录（manifest 反向：整目录即 manifest.created 的安装面）
  const manifestRead = readInstallManifest(path.join(GLOBAL_SKILL_DIR, 'scripts'));
  const verNote = manifestRead.status === 'ok' ? `（v${manifestRead.manifest.version} 安装；.wbx-install.json 随目录移除）` : '';
  await rm(GLOBAL_SKILL_DIR, `技能目录 ~/.zcode/skills/wb-bridge/${verNote}`);
  // 迁移/安装过程残留与 v28 前旧布局（含备份）：一键还原承诺=本桥名下零残留
  const skillsParent = path.dirname(GLOBAL_SKILL_DIR);
  for (const name of (fs.existsSync(skillsParent) ? await fsp.readdir(skillsParent) : [])) {
    if (name.startsWith('.wb-bridge.staging-') || /^wb-bridge\.(replaced|backup)-/.test(name)) {
      await rm(path.join(skillsParent, name), `技能目录旁残留 ${name}`);
    }
  }
  const zcodeDir = path.join(HOME, '.zcode');
  for (const name of (fs.existsSync(zcodeDir) ? await fsp.readdir(zcodeDir) : [])) {
    if (name === 'wbx-bridge') await rm(path.join(zcodeDir, name), 'v28 前旧布局 ~/.zcode/wbx-bridge/');
    else if (/^wbx-bridge\.backup-/.test(name)) await rm(path.join(zcodeDir, name), `旧布局备份 ${name}`);
  }
  try {
    await fsp.rm(path.join(HOME, '.zcode', 'commands', 'wbx.md'), { force: true });
    report.push('已删除斜杠命令 ~/.zcode/commands/wbx.md（v28 已退役；旧机器残留一并清理）');
  } catch { report.push('跳过斜杠命令（不存在）'); }
  const ub = await uninstallUserBlock();
  report.push(ub.removed
    ? (ub.fileDeleted ? '已移除 ~/.zcode/AGENTS.md 标记块（文件已空，连同文件删除）' : '已移除 ~/.zcode/AGENTS.md 标记块（其余内容保留）')
    : `无需移除 ~/.zcode/AGENTS.md（${ub.reason === 'file-missing' ? '文件不存在' : '无标记块'}）`);
  if (purge) {
    await rm(GLOBAL_RUNTIME_DIR, '全局运行时 ~/.wbx/（含凭证，--purge）');
  } else {
    report.push(`保留全局运行时 ${GLOBAL_RUNTIME_DIR}（含凭证；如需连凭证一起删：wbx self-uninstall --purge）`);
  }
  return { ok: true, report, purged: purge };
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
  const roots = [path.join(PROJECT_ROOT, '.wbx'), GLOBAL_RUNTIME_DIR];
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
    const desktop = path.join(HOME, 'Desktop');
    const baseDir = fs.existsSync(desktop) ? desktop : HOME;
    outFile = path.join(baseDir, zipName);
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
