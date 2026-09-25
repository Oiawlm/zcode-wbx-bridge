/**
 * wbx-setup — wbx 桥的安装 / 卸载 / 分发打包（v3 Phase 2 + Phase 4）
 *
 * - selfInstall：桥复制到 ~/.zcode/wbx-bridge/，生成用户级 skill（~/.zcode/skills/wb-bridge/）、
 *   用户级斜杠命令（~/.zcode/commands/wbx.md）、~/.zcode/AGENTS.md 标记块、全局运行时 ~/.wbx/。
 *   --adopt 把项目 .wbx/ 的两 lane 凭证迁到 ~/.wbx/（--no-keep-project 迁移后删除项目侧凭证，
 *   默认保留；tasks/ 历史始终保留）。
 * - selfUninstall：上述全部移除；--purge 连 ~/.wbx/（含凭证）一起删，默认保留。
 * - exportBundle：生成零凭证分发 zip（scripts/ + SKILL.md + examples/ + docs/ + INSTALL-README.md），
 *   纯 Node 实现 zip（store），导出后自检断言不含任何凭证值。
 *
 * 写用户目录仅限四处 + 运行时：~/.zcode/wbx-bridge/、~/.zcode/skills/wb-bridge/、
 * ~/.zcode/commands/wbx.md、~/.zcode/AGENTS.md 标记块、~/.wbx/。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  HOME, PROJECT_ROOT, SCRIPT_DIR, GLOBAL_BRIDGE_DIR, GLOBAL_RUNTIME_DIR,
  LANE_ORDER, installUserBlock, uninstallUserBlock, WBX_VERSION,
} from './wbx-core.mjs';

// ---------- 纯 Node zip（store，无压缩，零依赖） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

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
    lh.writeUInt16LE(nameBuf.toString('utf8') === e.name && /^[\x20-\x7e]+$/.test(e.name) ? 0 : 0x0800, 6); // UTF-8 标志
    lh.writeUInt16LE(0, 8);             // method: store
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    parts.push(lh, nameBuf, data);
    central.push({ nameBuf, crc, size: data.length, offset });
    offset += 30 + nameBuf.length + data.length;
  }
  let centralSize = 0;
  const centralBufs = [];
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0, 8);
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

// ---------- 文案模板 ----------
const globalBridgeScript = () => path.join(GLOBAL_BRIDGE_DIR, 'scripts', 'wbx.mjs');

export function globalSkillText(sourceSkill) {
  const gscript = globalBridgeScript();
  return sourceSkill
    .replace(/node \.zcode\/skills\/wb-bridge\/scripts\/wbx\.mjs/g, `node "${gscript}"`)
    .replace(/\.zcode\/skills\/wb-bridge\/scripts\/wbx\.mjs/g, gscript)
    .replace(/<项目>\/\.wbx\/jobs\//g, '~/.wbx/jobs/')
    .replace('（装过 self-install 则为 `~/.wbx/jobs/`）', '')
    .replace(/所有调用走项目内 `\.wbx\/` 隔离运行时，不影响桌面版 WorkBuddy（装过 `wbx self-install` 后统一走 `~\/\.wbx\/`，凭证全局共享）/,
      '所有调用走全局 `~/.wbx/` 隔离运行时（凭证全局共享，任何项目同一套），不影响桌面版 WorkBuddy')
    + '\n> 注：本文件是用户级 skill（~/.zcode/skills/wb-bridge/SKILL.md），会遮蔽同名项目级 skill（内容一致，无行为差异）。\n';
}

export function wbxCommandText() {
  const gscript = globalBridgeScript();
  return [
    '---',
    'description: 把任务描述经 wbx 桥分派给外部免费算力（三 lane：WorkBuddy 双 lane DeepSeek V4.1 Flash + 可选 Cline CLI）执行并汇总',
    'argument-hint: <任务描述>',
    'skills: wb-bridge',
    '---',
    '',
    '用户任务：$ARGUMENTS',
    '',
    '请按 wb-bridge 技能的流程处理上面的任务（这是用户要的一键分派触发器）：',
    '',
    '1. 先自检：运行 `' + `node "${gscript}" doctor` + '`；有任一 lane 可用即继续（cline 是可选 lane，未装/未登录只 WARN），全部不可用则由你自己完成任务并说明原因。',
    '2. 判断任务是否适合分派（自包含可单轮完成、不涉密——含代码模块编写：接口清晰、材料可贴、输出可校验；v5 基线=默认分派，单个自包含任务也直接派）。适合则按技能里引用的 PROMPTS.md 模板（角色+任务+材料+输出硬约束+无工具声明）构造任务；关键产物并行 2 份择优（T8）。',
    '3. 单条子任务用 ask，可拆分的多条用 fanout（任务写成 tasks.json）分派到外部算力；结果落 ~/.wbx/jobs/<jobId>/。',
    '4. 校验结果后汇总输出给用户（代码模块集成前默认过一道 T7 评审批判）；标注信息来自模型已有知识、可能过时。',
    '5. doctor FAIL、连续 >= 2 个任务失败或限流 → 停止外包，如实告知用户，剩余任务由你自己完成。',
    '',
    '安全：涉密、隐私、凭证、内部代码、未公开数据绝不外包给外部模型。',
    '',
  ].join('\n');
}

export function installReadmeText() {
  const B = '`';   // markdown 反引号
  const F = '```'; // markdown 代码围栏
  const L = [
    '# wbx 桥安装说明（v' + WBX_VERSION + '）',
    '',
    '把合适的子任务并行分派给外部免费算力（三 lane）：WorkBuddy 双 lane 的 DeepSeek V4.1 Flash',
    '（国际版 x0.00 免费 / 国内版 x0.03 近免费）+ 可选 Cline CLI lane（免费额度轮换模型组），',
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
    ':: 2. 全局安装（写入 ~/.zcode/ 与 ~/.wbx/，见下方"会写哪些位置"）',
    'node wbx.mjs self-install',
    '',
    ':: 3. 登录两个 lane（各一次，凭证约 55 天有效）',
    'node scripts\\wbx.mjs login --identity cn   :: 国内版：微信扫码',
    'node scripts\\wbx.mjs login --identity ai   :: 国际版：邮箱/OneID（输出里有 state 修补锦囊）',
    F,
    '',
    '装完自检：' + B + 'node scripts\\wbx.mjs doctor' + B + '，两个 lane 全绿即就绪。',
    '',
    '## 可选扩展：cline lane（第三条算力）',
    '',
    '不装也不影响 WorkBuddy 双 lane 的任何功能（doctor 对 cline 只显示 WARN）：',
    '',
    F + 'bat',
    'npm install -g cline',
    'node scripts\\wbx.mjs login --identity cline    :: 浏览器完成 OAuth 设备授权（有活跃会话时自动通过）',
    ':: 查当前免费模型组（免费组限时轮换；换默认：config set cline-model "<免费 id>"）',
    'node scripts\\wbx.mjs models --as cline --free',
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
    '- **任何项目的 ZCode 会话**直接说「帮我调研 A、B、C…」即可触发主动分派（用户级 skill + AGENTS.md 标记块）；',
    '- **斜杠命令**：' + B + '/wbx <任务描述>' + B + ' —— 一键把任务交给分派流程（doctor → 分派 → 校验 → 汇总）；',
    '- 手动调用（装好后任何位置可用的全局入口，路径含空格要加引号）：',
    '  ' + B + 'node "%USERPROFILE%\\.zcode\\wbx-bridge\\scripts\\wbx.mjs" ask --text "…"' + B + '、',
    '  ' + B + 'fanout --file tasks.json' + B + '；',
    '- 可视化：' + B + 'node "%USERPROFILE%\\.zcode\\wbx-bridge\\scripts\\wbx.mjs" ui' + B +
    ' → 浏览器自动打开 http://127.0.0.1:7788（状态/路由开关/ask/fanout/历史/登录）；',
    '- 历史回放：' + B + 'node scripts\\wbx.mjs history' + B + '（列出）与 ' + B + 'history <jobId>' + B + '（完整双向对话）。',
    '',
    '## 会写哪些位置（卸载可完全还原）',
    '',
    '| 位置 | 内容 |',
    '|---|---|',
    '| ' + B + '~/.zcode/wbx-bridge/' + B + ' | 桥本体（scripts + SKILL.md + PROMPTS.md + examples + docs） |',
    '| ' + B + '~/.zcode/skills/wb-bridge/' + B + ' | 用户级 skill（遮蔽同名项目级 skill，内容一致） |',
    '| ' + B + '~/.zcode/commands/wbx.md' + B + ' | /wbx 斜杠命令 |',
    '| ' + B + '~/.zcode/AGENTS.md' + B + ' | ' + B + '<!-- wbx:begin/end -->' + B + ' 标记块 |',
    '| ' + B + '~/.wbx/' + B + ' | 运行时：sessions/product 凭证、config.json、jobs/ 历史、cline-home/（可选 lane 隔离主目录） |',
    '',
    '绝不写 ' + B + '~/.workbuddy' + B + '、' + B + '~/.workbuddy-ai' + B + '、' + B + '~/.cline' + B + '（用户自己的 Cline 状态）、桌面版安装目录、系统环境变量。',
    '',
    '## 卸载',
    '',
    F + 'bat',
    'node scripts\\wbx.mjs self-uninstall          :: 移除上面前四处（保留 ~/.wbx/ 凭证）',
    'node scripts\\wbx.mjs self-uninstall --purge  :: 连 ~/.wbx/（含凭证、cline-home/）一起删',
    ':: 若装过可选 cline lane：npm uninstall -g cline',
    F,
    '',
    '解压出来的本目录可随手删（self-install 已复制到 ~/.zcode/wbx-bridge/）。',
    '',
    '## 常见问题',
    '',
    '- doctor「cli」红：WorkBuddy 桌面版没装或版本路径变了 → 重装/更新桌面版后重跑 doctor（会自动扫描写入 config），',
    '  或 ' + B + 'node scripts\\wbx.mjs config set cli-path "<codebuddy 完整路径>"' + B + '。',
    '- doctor 提示缺模板缓存：启动一次对应桌面版即可。',
    '- 登录国际版遇到「登录失败」页：复制 login 命令输出里的锦囊 A URL 到地址栏回车。',
    '- cline lane 报 Unauthorized：OAuth 凭证过期 → 重新 ' + B + 'login --identity cline' + B + '。',
  ];
  return L.join('\n') + '\n';
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

async function copyIfExists(src, dest) {
  try { await fsp.copyFile(src, dest); return true; } catch { return false; }
}

export async function selfInstall({ adopt = false, keepProject = true } = {}) {
  const report = [];
  const srcScripts = SCRIPT_DIR;
  const srcSkillDir = path.dirname(srcScripts);
  const dstScripts = path.join(GLOBAL_BRIDGE_DIR, 'scripts');

  // 0. 源完整性
  for (const f of ['wbx.mjs', 'wbx-core.mjs', 'wbx-setup.mjs']) {
    if (!fs.existsSync(path.join(srcScripts, f))) throw new Error(`桥源不完整：缺 ${path.join(srcScripts, f)}`);
  }

  // 1. 桥本体 → ~/.zcode/wbx-bridge/
  await fsp.mkdir(dstScripts, { recursive: true });
  const copiedScripts = [];
  for (const f of ['wbx.mjs', 'wbx-core.mjs', 'wbx-setup.mjs', ...(fs.existsSync(path.join(srcScripts, 'wbx-ui.mjs')) ? ['wbx-ui.mjs'] : [])]) {
    await fsp.copyFile(path.join(srcScripts, f), path.join(dstScripts, f));
    copiedScripts.push(f);
  }
  let skillCopied = false, examplesCopied = false, docsCopied = false;
  try { await copyDir(path.join(srcSkillDir, 'examples'), path.join(GLOBAL_BRIDGE_DIR, 'examples')); examplesCopied = true; } catch { /* 无 examples */ }
  const promptsCopied = await copyIfExists(path.join(srcSkillDir, 'PROMPTS.md'), path.join(GLOBAL_BRIDGE_DIR, 'PROMPTS.md'));
  const docFiles = ['WBX.md', 'PLAN.md', 'UNINSTALL.md'];
  const copiedDocs = [];
  for (const d of docFiles) {
    if (await copyIfExists(path.join(PROJECT_ROOT, d), path.join(GLOBAL_BRIDGE_DIR, d))) copiedDocs.push(d);
  }
  docsCopied = copiedDocs.length > 0;
  report.push(`桥本体 -> ${GLOBAL_BRIDGE_DIR}（scripts: ${copiedScripts.join(', ')}${examplesCopied ? ' + examples' : ''}${promptsCopied ? ' + PROMPTS.md' : ''}${docsCopied ? ' + docs: ' + copiedDocs.join(', ') : ''}）`);

  // 2. 用户级 skill（绝对路径版；PROMPTS.md 原样随附，供 SKILL.md 相对引用）
  const srcSkill = path.join(srcSkillDir, 'SKILL.md');
  if (!fs.existsSync(srcSkill)) throw new Error(`桥源不完整：缺 ${srcSkill}`);
  const userSkillDir = path.join(HOME, '.zcode', 'skills', 'wb-bridge');
  await fsp.mkdir(userSkillDir, { recursive: true });
  await fsp.writeFile(path.join(userSkillDir, 'SKILL.md'), globalSkillText(await fsp.readFile(srcSkill, 'utf8')), 'utf8');
  await copyIfExists(path.join(srcSkillDir, 'PROMPTS.md'), path.join(userSkillDir, 'PROMPTS.md'));
  skillCopied = true;
  report.push(`用户级 skill -> ${path.join(userSkillDir, 'SKILL.md')}${fs.existsSync(path.join(userSkillDir, 'PROMPTS.md')) ? ' + PROMPTS.md' : ''}（同名遮蔽项目级 skill，内容一致）`);

  // 3. 用户级斜杠命令 /wbx
  const cmdDir = path.join(HOME, '.zcode', 'commands');
  await fsp.mkdir(cmdDir, { recursive: true });
  await fsp.writeFile(path.join(cmdDir, 'wbx.md'), wbxCommandText(), 'utf8');
  report.push(`斜杠命令 -> ${path.join(cmdDir, 'wbx.md')}（/wbx <任务描述>，skills: wb-bridge 自动挂载）`);

  // 4. ~/.zcode/AGENTS.md 标记块
  const agPath = await installUserBlock(globalBridgeScript());
  report.push(`全局指令块 -> ${agPath}（指向 ${globalBridgeScript()}）`);

  // 5. 全局运行时 ~/.wbx/
  for (const sub of ['sessions', 'product', 'config', 'jobs']) {
    await fsp.mkdir(path.join(GLOBAL_RUNTIME_DIR, sub), { recursive: true });
  }
  report.push(`全局运行时 -> ${GLOBAL_RUNTIME_DIR}{/sessions,/product,/config,/jobs}`);

  // 6. --adopt：项目 .wbx/ 凭证迁移到 ~/.wbx/
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
      await fsp.rm(path.join(srcWbx, 'sessions'), { recursive: true, force: true });
      await fsp.rm(path.join(srcWbx, 'product'), { recursive: true, force: true });
      await fsp.rm(path.join(srcWbx, 'config'), { recursive: true, force: true });
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
    ok: true, bridgeDir: GLOBAL_BRIDGE_DIR, script: globalBridgeScript(),
    runtimeDir: GLOBAL_RUNTIME_DIR, report,
    skillCopied, examplesCopied, docsCopied,
  };
}

export async function selfUninstall({ purge = false } = {}) {
  const report = [];
  const rm = async (p, label) => {
    try { await fsp.rm(p, { recursive: true, force: true }); report.push(`已删除 ${label}（${p}）`); }
    catch { report.push(`跳过 ${label}（${p} 不存在或不可删）`); }
  };
  await rm(GLOBAL_BRIDGE_DIR, '桥本体 ~/.zcode/wbx-bridge/');
  await rm(path.join(HOME, '.zcode', 'skills', 'wb-bridge'), '用户级 skill ~/.zcode/skills/wb-bridge/');
  try {
    await fsp.rm(path.join(HOME, '.zcode', 'commands', 'wbx.md'), { force: true });
    report.push('已删除斜杠命令 ~/.zcode/commands/wbx.md');
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
  for (const f of ['wbx.mjs', 'wbx-core.mjs', 'wbx-setup.mjs', 'wbx-ui.mjs']) {
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
  for (const d of ['WBX.md', 'PLAN.md', 'UNINSTALL.md']) {
    const p = path.join(PROJECT_ROOT, d);
    if (fs.existsSync(p)) add(`${root}docs/${d}`, fs.readFileSync(p));
  }
  // INSTALL-README.md（随包生成）
  add(`${root}INSTALL-README.md`, installReadmeText());
  return entries;
}

// 零凭证自检：任何成员路径不含 .wbx；文本内容不含任何已知 accessToken 值
function assertBundleClean(entries) {
  for (const e of entries) {
    if (/(^|\/)\.wbx(\/|$)/i.test(e.name) || e.name.includes('.wbx')) {
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
    selfCheck: `零凭证断言通过（比对 ${knownTokens} 个本地 accessToken 值，均未出现）`,
  };
}
