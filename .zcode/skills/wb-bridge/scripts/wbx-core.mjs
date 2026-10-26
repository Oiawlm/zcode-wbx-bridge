/**
 * wbx-core — wbx 桥核心库（CLI 壳 wbx.mjs 与 Web UI wbx-ui.mjs 共用的可复用逻辑）
 *
 * 关键概念：
 *   - 运行时根（runtime root）解析：WBX_HOME env → ~/.wbx/（~/.zcode/wbx-bridge 存在
 *     即全局形态）→ 项目 .wbx/（项目形态，v2 现状）。
 *   - config.json（存运行时根）：default-lane / disabled-lanes / parallel-per-lane /
 *     model / cli-path。
 *   - 统一 job 模型：每次 ask/fanout 落 <运行时根>/jobs/<id>/（manifest.json +
 *     tasks-input.json + <taskId>.json + summary.md）；旧 .wbx/tasks/ 只读兼容。
 *
 * 红线：凭证（accessToken/refreshToken）绝不进入日志、文档、HTTP 响应、导出产物。
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import {
  PROJECT_ROOT, HOME, GLOBAL_BRIDGE_DIR, RUNTIME_ROOT, JOBS_DIR, SESSIONS_DIR, PRODUCT_DIR,
  CONFIG_FILE, LEGACY_TASKS_DIR, LEGACY_JOBS_DIR, bridgeForm,
  CLINE_HOME, CLINE_WORK_DIR, CODEX_HOME, CODEX_WORK_DIR, SCRATCH_ROOT, L0_CWD_DIR,
} from './wbx-paths.mjs';

export const WBX_VERSION = '6.14.0';

// ---------- v1 迁移源（项目 .wbx/ 旧凭证/旧产品配置；路径派生单点见 ./wbx-paths.mjs） ----------
const OLD_SESSION_PATH = path.join(PROJECT_ROOT, '.wbx', 'session.json');        // v1 凭证（迁移源）
const OLD_PRODUCT_PATH = path.join(PROJECT_ROOT, '.wbx', 'product-config.json'); // v1 产品配置（迁移源）

// 双 lane 身份表（endpoint/platform 是兜底值，实际以模板为准）
export const IDENTITIES = {
  ai: {
    key: 'ai', label: '国际版', cost: 'x0.00（免费）',
    endpoint: 'https://www.workbuddy.ai', platform: 'workbuddy-ai',
    templatePath: path.join(HOME, '.workbuddy-ai', 'cache', 'acc-product-config-v3.json'),
    sessionPath: path.join(SESSIONS_DIR, 'ai.json'),
    productPath: path.join(PRODUCT_DIR, 'ai.json'),
    configDir: path.join(RUNTIME_ROOT, 'config', 'ai'),
  },
  cn: {
    key: 'cn', label: '国内版', cost: 'x0.03（近免费）',
    endpoint: 'https://copilot.tencent.com', platform: 'workbuddy',
    templatePath: path.join(HOME, '.workbuddy', 'cache', 'acc-product-config-v3.json'),
    sessionPath: path.join(SESSIONS_DIR, 'cn.json'),
    productPath: path.join(PRODUCT_DIR, 'cn.json'),
    configDir: path.join(RUNTIME_ROOT, 'config', 'cn'),
  },
};
// lane→身份解析（仅 ai/cn 凭证型）。非法 lane 直接抛错：上游已 parseLane 校验，
// 静默兜底 cn 只会掩盖坏输入（v22 收敛五处 `IDENTITIES[x] || IDENTITIES.cn` 兜底）
function identityOf(laneKey) {
  const id = IDENTITIES[laneKey];
  if (!id) throw new Error(`未知 lane ${JSON.stringify(laneKey)}（凭证型 lane 仅 ai | cn）`);
  return id;
}
// lane 合法集合的唯一定义点（--lanes/parseLane/config 校验/UI 派生全部 import 本常量，不得平行硬编码）
// 路由三分（v21 D-036）：canonical 序 codex 首位=单发 ask 质量优先档（auto 语义即「codex ready 即默认」）；
// fanout 批量缺省走 FANOUT_DEFAULT_POOL（免费+会员档，不含 codex）；回退链 codex 在 cline 后 doubao 前。
export const LANE_ORDER = ['codex', 'ai', 'cn', 'cline', 'doubao'];
// 命名公式：品牌（版本）全称——doctor/CLI 人读输出用；数据层 label 字段不变
export const LANE_BRAND = { codex: 'Codex CLI（ChatGPT Plus·可选通道）', ai: 'WorkBuddy AI（国际版）', cn: 'WorkBuddy（国内版）', cline: 'Cline CLI', doubao: '豆包（桌面端）' };
const FALLBACK_ORDER = ['cn', 'ai', 'cline', 'codex', 'doubao'];  // 回退顺序：国内版兜底，cline 次之；codex（Plus 额度，付费档）只被免费三 lane 全不可用时到达且先于 doubao
export const FANOUT_DEFAULT_POOL = ['ai', 'cn', 'cline', 'doubao']; // fanout 批量缺省调度池（不含 codex——Plus 额度保护，任务级 as:"codex" / --lanes codex 点名才并入）

const DEFAULT_CLI_PATH = 'D:\\App\\WorkBuddyAI\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy';
const FALLBACK_MODEL = 'deepseek-v4.1-flash';
// 超长提示词阈值：>此值 ai/cn/cline 改走 stdin、doubao 改走 --file 临时文件（绕过 Windows 命令行长度上限）
export const STDIN_THRESHOLD = 12000;
// 外部进程超时的桥侧收尾余量（CLI 自身 flush/kill 传播；cline/doubao/codex 三处统一单点）
const SPAWN_GRACE_MS = 20000;
// UI 控制台默认端口（wbx / wbx-daemon / wbx-ui 三处引用单源）
export const UI_DEFAULT_PORT = 7788;

// ---------- cline 免费孪生（cline lane 默认免费调 DeepSeek V4.1 Flash） ----------
// Cline 按模型 id 计费：deepseek/deepseek-v4.1-flash 计费，cline-free/ 前缀的同名孪生免费
//（限时促销轮换 + 每日用量配额，官方文档口径）。免费组会轮换，故清单一律走
// recommended-models 端点（见 fetchClineFreeModels），本常量只是默认模型 id，不是清单。
export const CLINE_FREE_DEFAULT_MODEL = 'cline-free/deepseek-v4.1-flash';

// ---------- cline lane（可选第三 lane，独立上游） ----------
// 红线：桥的 cline 状态只在 <运行时根>/cline-home/ 下，绝不读写用户 ~/.cline。
// 隔离方式（Phase 0 实测定案）：通过 USERPROFILE/HOME 环境变量覆盖，让 cline 解析的
// ~/.cline 落在桥目录内。不用 --data-dir——实测 3.0.65 该 flag 会破坏运行时认证加载
//（同凭证同目录，带 flag 即 401；auth 子命令放在其前的 --data-dir 还会被忽略导致误写 ~/.cline）。
// CLINE_HOME/CLINE_WORK_DIR 定义在 ./wbx-paths.mjs（v28-S 路径单点）。
const CLINE_PROVIDER_IDS = ['cline', 'cline-pass'];   // 两个独立 provider，不得混用凭证

// cline 调用/登录专用的隔离 env（USERPROFILE+HOME 指向桥目录；unset HOMEDRIVE/HOMEPATH 防拼接干扰）
export function clineSpawnEnv() {
  const env = { ...process.env, USERPROFILE: CLINE_HOME, HOME: CLINE_HOME };
  delete env.HOMEDRIVE;
  delete env.HOMEPATH;
  return env;
}

// cline 二进制解析：WBX_CLINE env → config cline-path → npm 全局平台二进制扫描
export function scanClineCandidates() {
  const found = [];
  const push = (p) => { if (p && fs.existsSync(p) && !found.includes(p)) found.push(p); };
  if (process.env.APPDATA) {
    const nm = path.join(process.env.APPDATA, 'npm', 'node_modules');
    // npm i -g cline 的平台二进制（Bun 编译 exe，可直接 spawn）
    push(path.join(nm, 'cline', 'node_modules', '@cline', 'cli-windows-x64', 'bin', 'cline.exe'));
    // postinstall 跑过时的缓存二进制
    push(path.join(nm, 'cline', 'bin', '.cline'));
  }
  return found;
}

export function resolveClinePath() {
  if (process.env.WBX_CLINE) return process.env.WBX_CLINE;
  const cfg = loadConfig();
  if (cfg['cline-path']) return cfg['cline-path'];
  const cands = scanClineCandidates();
  return cands[0] || null;
}

// 兼容：cline-data-dir 现在语义为「隔离主目录」（HOME 覆盖目标），缺省 <运行时根>/cline-home
export function clineHomeDir() {
  const cfg = loadConfig();
  const p = cfg['cline-data-dir'] || CLINE_HOME;
  return path.resolve(p);
}

export function clineProvidersFile() {
  return path.join(clineHomeDir(), '.cline', 'data', 'settings', 'providers.json');
}

/** 凭证存在性判断（只读 providers.json 的结构，绝不返回/打印 token 值）。
 * OAuth 形态：providers.<id>.settings.auth.accessToken（实测 3.0.65）；API-key 形态：providers.<id>.apiKey */
export function clineHasCredential() {
  try {
    const j = JSON.parse(fs.readFileSync(clineProvidersFile(), 'utf8'));
    const p = j?.providers?.[loadConfig()['cline-provider'] || 'cline'];
    if (!p) return false;
    const oauth = p.settings?.auth?.accessToken;
    return (typeof oauth === 'string' && oauth.length > 0) ||
      (typeof p.apiKey === 'string' && p.apiKey.length > 0);
  } catch { return false; }
}

export function clineReady() {
  return !!resolveClinePath() && clineHasCredential();
}

// ---------- doubao lane（第四 lane，豆包桌面端「工作模式」CDP 驱动；可选） ----------
// 桥侧零凭证（铁律）：登录态由用户在豆包客户端 GUI 内自理，本 lane 只经 doubao.mjs
// 以调试口 9225 驱动桌面端，不读写任何豆包账号信息。目录双候选解析与 wbx.mjs cmdDoubao 同款。
export function resolveDoubaoDir() {
  const candidates = [
    path.join(GLOBAL_BRIDGE_DIR, 'doubao'),            // 全局形态：~/.zcode/wbx-bridge/doubao/（self-install 复制）
    path.join(PROJECT_ROOT, 'tools', 'doubao-bridge'), // 仓库形态：桥源码仓的 v12 交付物
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, 'doubao.mjs'))) || null;
}

// 读性判定（静态，对齐 clineReady 先例）：win32 + doubao.mjs 可解析。
// CDP 在线性（客户端是否带调试口运行）不进 laneReady——同步探测太贵，由 askOnceDoubao
// 快速失败（客户端未开调试口时 doubao.mjs 秒退非零）触发回退链自然跳过。
export function doubaoReady() {
  return process.platform === 'win32' && !!resolveDoubaoDir();
}

// ---------- 豆包自动拉起（桥自治；config doubao-autostart 默认 true） ----------
// 第一性：launch.ps1 是唯一启动器——拉起/重启/就绪轮询（≤30s /json/version）语义全部复用它，
// 桥只做「何时调它」的决策：派发链真正到达 doubao lane 且 CDP 不可达时，无进程→直接拉起；
// 有进程无调试口→-Force 重启（等价 launch.ps1 -Force 语义：taskkill 后等归零再拉起）。
// 成功路径（CDP 在线）零触碰豆包：askOnceDoubao 只在收到 CDP 不可达失败后才进来。
export const DOUBAO_CDP_PORT = 9225;

// CDP 在线探测（GET /json/version；200+合法 JSON+非空 Browser 才算在线——9225 被其他进程
// 占用时因 Browser 校验不过判不在线）。任何异常降级不在线，绝不 throw。
// 返回 { online, browser }——askOnceDoubao 快速失败与 UI /api/doubao 状态展示共用（v22 单源）。
export function doubaoCdpProbe(timeoutMs = 900) {
  return new Promise((resolve) => {
    const down = () => resolve({ online: false, browser: null });
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
    let req = null;
    try {
      req = http.get(`http://127.0.0.1:${DOUBAO_CDP_PORT}/json/version`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; if (body.length > 65536) { try { req.destroy(); } catch { /* 尽力而为 */ } finish({ online: false, browser: null }); } });
        res.on('end', () => {
          if (res.statusCode !== 200) return down();
          let j = null;
          try { j = JSON.parse(body); } catch { j = null; }
          finish(j && typeof j.Browser === 'string' && j.Browser.trim() !== ''
            ? { online: true, browser: j.Browser }
            : { online: false, browser: null });
        });
        res.on('error', down);
      });
    } catch { down(); return; }
    req.on('error', () => finish({ online: false, browser: null }));
    req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch { /* 尽力而为 */ } finish({ online: false, browser: null }); });
  });
}

// 豆包进程探测（tasklist 过滤 Doubao.exe，3s 封顶；异常降级 false）——决定 launch.ps1 是否带 -Force；
// UI /api/doubao 状态展示共用（v22 导出）
export function doubaoProcessRunning() {
  if (process.platform !== 'win32') return false;
  try {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Doubao.exe', '/NH'], { timeout: 3000, encoding: 'utf8', windowsHide: true });
    return !!(r && !r.error && r.stdout && /doubao\.exe/i.test(String(r.stdout)));
  } catch { return false; }
}

let doubaoEnsureFlight_ = null;   // 单飞锁：并发派发共享同一次拉起，绝不双拉
/**
 * 确保豆包以调试口运行（幂等）：CDP 在线→零触碰原样返回；不可达→经 launch.ps1 拉起/重启。
 * 返回 { ok, action: 'online'|'launched'|'restarted'|'failed'|'unavailable', detail?, exitCode? }。
 * action=unavailable：非 Windows 或找不到 doubao.mjs（可选 lane 缺席，如实报告不重试）。
 */
export async function ensureDoubao() {
  const cfg = loadConfig();
  if (cfg['doubao-autostart'] === false) return { ok: false, action: 'failed', detail: 'doubao-autostart=off（自动拉起已关闭）' };
  if (doubaoEnsureFlight_) return doubaoEnsureFlight_;
  doubaoEnsureFlight_ = (async () => {
    if ((await doubaoCdpProbe()).online) return { ok: true, action: 'online' };
    const dir = resolveDoubaoDir();
    if (!dir || process.platform !== 'win32') {
      return { ok: false, action: 'unavailable', detail: '豆包桥不可用（非 Windows 或未找到 doubao.mjs；在桥源码仓跑 wbx self-install）' };
    }
    const running = doubaoProcessRunning();
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, 'launch.ps1'), ...(running ? ['-Force'] : [])];
    // launch.ps1 内部含 15s kill 等待 + 30s 就绪轮询，90s 封顶防挂
    const r = await spawnBin('powershell', args, { timeoutMs: 90000 });
    if (r.code === 0) {
      return { ok: true, action: running ? 'restarted' : 'launched' };
    }
    const out = ansiStrip(String(r.stdout || '') + '\n' + String(r.stderr || '')).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' / ');
    const reason = r.timedOut ? 'launch.ps1 超时（>90s）' : (brief(out) || `launch.ps1 exit=${r.code}`);
    return { ok: false, action: 'failed', detail: `自动拉起失败（${reason}）`, exitCode: r.code };
  })().finally(() => { doubaoEnsureFlight_ = null; });
  return doubaoEnsureFlight_;
}

// ---------- codex lane（第五 lane：OpenAI Codex CLI / ChatGPT Plus 质量优先档；可选） ----------
// 调用形态：spawn `codex exec` 非交互子进程，一次一问（无多轮、无 resume）。
// 关键不变量：仅 validateCodexModel 会 throw；凭证内容绝不进日志/返回值/错误文案；
// 进程退出码绝不参与 codex 的成功/失败判定（实测失败路径退出码不可信，探针 v21p1-p2）。
// 本区段初稿由 wbx fanout T8 双份草稿产出（job 20261014-115825-xco），ZCode 评审择优集成。
// CODEX_HOME/CODEX_WORK_DIR 定义在 ./wbx-paths.mjs（v28-S 路径单点）。
const CODEX_QUOTA_FILE = path.join(RUNTIME_ROOT, 'codex-quota.json');

// 额度耗尽特征（不区分大小写）；命中即进入冷却并驱动路由跳过（D-039）
const CODEX_QUOTA_RE = /you('|’)ve hit your usage limit|usage limit (has been )?reached|rate limit|429/i;   // 结构化通道（stderr/JSONL error）
export const CODEX_QUOTA_STRONG_RE = /you('|’)ve hit your usage limit|usage limit (has been )?reached/i;   // stdout 面：只扫官方强特征——弱信号会命中「模型正文引用 429」的正常成功输出（v23 评审实证）

// 从失败/错误事件取可读文案：error?.message ?? message ?? error 字符串 ?? JSON 截断 200
function codexErrorText_(obj) {
  if (!obj || typeof obj !== 'object') return '';
  const e = obj.error;
  const picked = (e && typeof e === 'object' && typeof e.message === 'string' && e.message) ||
    (typeof obj.message === 'string' && obj.message) ||
    (typeof e === 'string' && e) || null;
  if (picked) return picked;
  let s = '';
  try { s = JSON.stringify(obj); } catch { s = ''; }
  return (s || String(obj)).slice(0, 200);
}

// 二进制解析链：WBX_CODEX env → config codex-path → %LOCALAPPDATA% 桌面版捆绑 CLI（exe mtime 最新）。
// 实测存在「hash 目录在但目录内只有 rg.exe」的情形（v21p1-p0）：必须以 codex.exe 文件存在为准，
// 绝不按目录 mtime 解析——桌面版更新换 hash 目录时只有含 exe 者才可当选。
export function resolveCodexPath() {
  if (process.env.WBX_CODEX) return process.env.WBX_CODEX;
  const cfg = loadConfig();
  if (cfg['codex-path']) return cfg['codex-path'];
  const lad = process.env.LOCALAPPDATA;
  if (!lad) return null;
  const binRoot = path.join(lad, 'OpenAI', 'Codex', 'bin');
  let names = [];
  try { names = fs.readdirSync(binRoot); } catch { return null; }
  let best = null, bestMtime = -Infinity;
  for (const name of names) {
    const exe = path.join(binRoot, name, 'codex.exe');
    if (!fs.existsSync(exe)) continue;
    let mtime = 0;
    try { mtime = fs.statSync(exe).mtimeMs; } catch { continue; }
    if (mtime > bestMtime) { bestMtime = mtime; best = exe; }
  }
  return best;
}

// codex 调用专用隔离 env：CODEX_HOME 指向桥目录，绝不指向用户 ~/.codex（auth.json 经
// `wbx login --identity codex` 一次性只读复制进来——「不动桌面版文件」红线的唯一显式授权例外）
export function codexSpawnEnv() {
  return { ...process.env, CODEX_HOME };
}

// 模型底线护栏（单点；config set 与 askOnceCodex 读取同源）：
// 用户 2026-10-14 裁决「不用 GPT-5.6 及以下」——须匹配 ^gpt-(\d+) 且主版本 ≥6，
// 否则抛 err.code='codex-model-floor'（拒 gpt-5.5 / gpt-5.6-* / codex-auto-review / gpt-reserve / 非 gpt slug）。
export function validateCodexModel(id) {
  const raw = typeof id === 'string' ? id.trim() : '';
  const m = /^gpt-(\d+)/.exec(raw);
  const major = m ? Number(m[1]) : NaN;
  if (!m || !(major >= 6)) {
    const err = new Error(
      `codex-model 底线护栏：不用 GPT-5.6 及以下模型（用户 2026-10-14 裁决）——须为 gpt-6 及以上主版本（如 gpt-6.1-sol）；实际收到 ${JSON.stringify(id)}`
    );
    err.code = 'codex-model-floor';
    throw err;
  }
  return raw;
}

// parseCodexJsonl —— 解析 codex exec --json 的 stdout JSONL 全文（纯函数，任何输入不抛异常）。
// 实测 schema（v21p1-p2 权威，二手来源仅参考）：成功流 thread.started → turn.started →
// item.completed(item.type=agent_message, item.text=正文) → turn.completed（完整性判定信号）。
// 正文裁决：-o 文件为最终权威（askOnceCodex 内），parsed.text 仅回退来源。
export function parseCodexJsonl(text) {
  const out = { events: 0, text: null, error: null, hasTurnCompleted: false };
  if (typeof text !== 'string' || !text.length) return out;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;   // BOM 容忍
  const chunks = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }   // 非 JSON 行（横幅/日志）忽略
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    out.events += 1;
    if (obj.type === 'item.completed' && obj.item && obj.item.type === 'agent_message') {
      if (typeof obj.item.text === 'string') chunks.push(obj.item.text);
    } else if (obj.type === 'turn.completed') {
      out.hasTurnCompleted = true;
    } else if (out.error === null && (obj.type === 'turn.failed' || obj.type === 'error')) {
      out.error = codexErrorText_(obj);   // 首个命中为准
    }
  }
  if (chunks.length) out.text = chunks.join('');
  return out;
}

// 额度冷却状态机（D-039）：状态文件 <runtime>/codex-quota.json { limitedAt, cooldownUntil, reason }。
// 读取侧只认 cooldownUntil；缺失/损坏/过期一律 inactive（过期文件 best-effort 清理）。
export function codexQuotaState() {
  const idle = { active: false, until: null, reason: null, remainingMin: null };
  let obj = null;
  try { obj = JSON.parse(fs.readFileSync(CODEX_QUOTA_FILE, 'utf8')); } catch { return idle; }
  if (!obj || typeof obj !== 'object') return idle;
  const until = Number(obj.cooldownUntil);
  if (!Number.isFinite(until)) return idle;
  const now = Date.now();
  if (until <= now) {
    try { fs.rmSync(CODEX_QUOTA_FILE, { force: true }); } catch { /* best-effort */ }
    return idle;
  }
  return {
    active: true, until,
    reason: typeof obj.reason === 'string' ? obj.reason : null,
    remainingMin: Math.ceil((until - now) / 60000),
  };
}

// 扫描文本，命中额度耗尽即落盘冷却状态；未命中返回 null。返回与 codexQuotaState() 同构
//（按刚写入值计算，不重读文件）。检测窗口=stdout+stderr+JSONL error 三处（askOnceCodex 调用侧）。
export function markCodexQuota(text, { now = Date.now(), re = CODEX_QUOTA_RE } = {}) {
  if (typeof text !== 'string' || !text.length) return null;
  const m = re.exec(text);
  if (!m) return null;
  // 冷却截止：优先解析 "try again at <时间>"（截到 " or " 或行尾；解析失败/过去 → config 兜底分钟数）
  let until = null;
  const tm = /try again at\s+([^\n]+)/i.exec(text);
  if (tm) {
    const frag = tm[1].split(/\s+or\s+/i)[0].trim();
    const parsed = Date.parse(frag);
    if (Number.isFinite(parsed) && parsed > now) until = parsed;
  }
  if (until === null) until = now + Number(loadConfig()['codex-quota-cooldown-min'] || 30) * 60000;
  // reason=命中所在整行（截 160 字符），无凭证无 token
  const lineStart = text.lastIndexOf('\n', m.index) + 1;
  let lineEnd = text.indexOf('\n', m.index);
  if (lineEnd < 0) lineEnd = text.length;
  const reason = text.slice(lineStart, lineEnd).trim().slice(0, 160);
  try {
    fs.mkdirSync(path.dirname(CODEX_QUOTA_FILE), { recursive: true });
    fs.writeFileSync(CODEX_QUOTA_FILE, JSON.stringify({ limitedAt: now, cooldownUntil: until, reason }, null, 2), 'utf8');
  } catch { /* best-effort：写盘失败不阻断，本次仍按内存值返回 */ }
  return { active: true, until, reason, remainingMin: Math.ceil((until - now) / 60000) };
}

// codex 读性（静态，对齐 clineReady/doubaoReady 先例）：二进制可解析 + 隔离 home 有 auth.json
// + 额度未冷却。冷却期 laneReady=false → auto 路由/回退链/fanout 缺省池自动跳过；
// 显式 --as codex / 任务级 as:"codex" 照放行（调用侧打 WARN）。
export function codexReady() {
  return !!resolveCodexPath() && fs.existsSync(path.join(CODEX_HOME, 'auth.json')) && !codexQuotaState().active;
}

// ---------- cn lane 夜间免费档（v24）：纯时钟函数非状态机 ----------
// 上游口径（官方公告转述，以官方为准）：腾讯混元 Hy4 preview 每日 23:00–次日 08:00 免费（北京时间），
// 现行活动截止 2026-10-31。设计定案（RESEARCH-V24 §三 D-2）：时钟函数非状态机——判定单点、每次投递
// 现算（不缓存窗口判定，防「07:59 判定 08:05 才发」）、展示层（doctor/stderr/UI）只消费单对象不自算；
// 与 codex 事件驱动冷却（codexQuotaState）互补：无扫描、无状态落盘。
const NIGHT_TZ = 'Asia/Shanghai';   // 窗口=北京时间为上游口径（中国无 DST；ECMA-402 内置时区，判定不随宿主漂移）
const NIGHT_TZ_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: NIGHT_TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const NIGHT_WINDOW_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;
const NIGHT_EXPIRES_RE = /^\d{4}-\d{2}-\d{2}$/;
const NIGHT_EFFORT_VALUES = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];   // CodeBuddy --effort 全档（2.156.0 --help 实测）
const NIGHT_CONTEXT_RE = /^(auto|\d+[km]?)$/i;   // --autocompact 取值：auto|<数字>[km]（CLI 侧钳制 100k-1M）

// 夜间窗 'HH:MM-HH:MM' 解析单点（loadConfig 容错与 nightWindowState 同源；支持跨午夜；start==end 视为非法）
function parseNightWindow(s) {
  const m = NIGHT_WINDOW_RE.exec(String(s || '').trim());
  if (!m) return null;
  const hh = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null; };
  const mm = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 59 ? n : null; };
  const h1 = hh(m[1]), m1 = mm(m[2]), h2 = hh(m[3]), m2 = mm(m[4]);
  if (h1 == null || m1 == null || h2 == null || m2 == null) return null;
  const startMin = h1 * 60 + m1, endMin = h2 * 60 + m2;
  return startMin === endMin ? null : { startMin, endMin };
}

// 北京时间墙上分解（formatToParts：与宿主时区无关——RD2 假时钟断言承重点）
function bjParts_(d) {
  const parts = {};
  for (const p of NIGHT_TZ_FMT.formatToParts(d)) parts[p.type] = p.value;
  return { y: +parts.year, mo: +parts.month, d: +parts.day, hh: (+parts.hour) % 24, mm: +parts.minute };
}
// 北京墙上时刻 -> UTC ms（北京=UTC+8 恒定无 DST；越界边界由「不早于 now 顺延一天」规则兜住）
function bjWallMs_(y, mo, d, totalMin) { return Date.UTC(y, mo - 1, d, Math.floor(totalMin / 60), totalMin % 60) - 8 * 3600000; }

/**
 * 夜间免费窗判定单点（纯函数；now 缺省=当前时刻，单测注入假时钟）。返回单对象：
 *   { inWindow, active, expired, window, expires, model, nextSwitchAt, remainingMin }
 * inWindow=北京时刻落在 [start,end) 半开区间（跨午夜翻转）；expired=北京日期已过 night-expires
 * （截止日全天仍有效；空串=无截止）；active=inWindow && !expired；nextSwitchAt=下次边界 ISO；
 * remainingMin=距下次边界分钟数。配置解析失败（loadConfig 已容错，理论不可达）一律 inactive 诚实降级。
 */
export function nightWindowState(now = new Date()) {
  const cfg = loadConfig();
  const expiresRaw = String(cfg['night-expires'] ?? '').trim();
  const expires = NIGHT_EXPIRES_RE.test(expiresRaw) ? expiresRaw : null;
  const win = parseNightWindow(cfg['night-window']);
  if (!win) {
    return { inWindow: false, active: false, expired: false, window: String(cfg['night-window'] || ''), expires, model: cfg['night-model'], nextSwitchAt: null, remainingMin: null };
  }
  const bj = bjParts_(now);
  const curMin = bj.hh * 60 + bj.mm;
  const cross = win.startMin > win.endMin;
  const inWindow = cross ? (curMin >= win.startMin || curMin < win.endMin) : (curMin >= win.startMin && curMin < win.endMin);
  const expired = !!expires && (bj.y * 10000 + bj.mo * 100 + bj.d) > Number(expires.replace(/-/g, ''));
  // 下次边界：窗内→end、窗外→start（跨午夜窗内取「今晨已过则明晨」、窗外取「今晚已过则明晚」，统一顺延一天）
  const edgeMin = inWindow ? win.endMin : win.startMin;
  let edgeMs = bjWallMs_(bj.y, bj.mo, bj.d, edgeMin);
  if (edgeMs <= now.getTime()) edgeMs += 86400000;
  return {
    inWindow, active: inWindow && !expired, expired,
    window: cfg['night-window'], expires, model: cfg['night-model'],
    nextSwitchAt: new Date(edgeMs).toISOString(),
    remainingMin: Math.max(0, Math.ceil((edgeMs - now.getTime()) / 60000)),
  };
}

/**
 * ai/cn 唯一模型策略出口（D-2/D-3）：白天/夜间「模型+思考+上下文预算」收敛为纯函数单点，
 * resolveModel 的取值链并入（白天链=任务级>WBX_MODEL env>config model>常量）。
 * 优先级按维度独立（D-2/D-8 兼容锁）：model/effort=任务级显式 > env > 窗口内夜间档 > 白天档；
 * context 无任务级/env 键，只随窗（夜=night-context、昼=config context）。
 * 下发矩阵（D-3，lane 能力，约束「不显式时」的缺省）：effort=cn 夜间 night-effort/白天 config effort、
 * ai 恒 null（国际版思考不可调——用户口径 UNKNOWN 不猜测）；context=cn 双档、ai config context。
 * 任务级显式 effort 在 ai 仍原样直通（v6.12 兼容行为，FROZEN 二.6）。
 * cline/doubao/codex 不经此（各走既有单点），返回 null。
 */
export function resolveModelPolicy(lane, { model = null, effort = null } = {}, now = new Date()) {
  if (lane !== 'ai' && lane !== 'cn') return null;
  const cfg = loadConfig();
  const win = nightWindowState(now);
  const night = lane === 'cn' && win.active;   // 夜间档仅 cn（用户裁决：ai lane 不做夜间档——国际版无「夜间窗」活动口径，RESEARCH-V24 §2.4 t4）
  return {
    model: model || process.env.WBX_MODEL || (night ? cfg['night-model'] : null) || cfg.model || FALLBACK_MODEL,
    effort: effort || (night ? cfg['night-effort'] : (lane === 'cn' ? cfg.effort : null)),
    context: night ? cfg['night-context'] : cfg.context,
    window: win,
  };
}

// 夜间档 stderr 一行（D-5 ②）：消费 nightWindowState 单对象格式化，绝不自行重算时间逻辑
export function nightWindowLine(w = nightWindowState()) {
  const base = `cn 夜间免费档（官方活动口径${w.expires ? `至 ${w.expires}` : '、无截止日期'}，以官方为准）`;
  if (w.expired) return `[NIGHT] ${base}：已过期（${w.expires} 已过，恒白天档；如官方延期：wbx config set night-expires <日期>）`;
  if (w.active) return `[NIGHT] ${base}：生效中（${w.window} · ${w.model} · 距窗尾约 ${w.remainingMin}m）`;
  return `[NIGHT] ${base}：窗外（白天档；免费窗 ${w.window}，约 ${w.remainingMin}m 后开窗）`;
}

// ---------- cline 免费模型清单（recommended-models 端点） ----------
// 官方端点（Bearer OAuth accessToken；token 只用不打印，绝不进日志/响应/导出）。
// 返回 {recommended,free,clinePass,clineCloud} 四数组，元素 {id,name,description,tags}。
// 免费组限时轮换 -> 清单永不硬编码，每次实时取；端点失败时降级读最近一次成功缓存。
const CLINE_RECOMMENDED_MODELS_URL = 'https://api.cline.bot/api/v1/ai/cline/recommended-models';
const CLINE_FREE_CACHE_FILE = path.join(RUNTIME_ROOT, 'cline-free-models.json');

// 只读 providers.json 取 OAuth accessToken（内部使用，绝不返回给调用方打印）
function clineAccessTokenForCatalog_() {
  try {
    const j = JSON.parse(fs.readFileSync(clineProvidersFile(), 'utf8'));
    const p = j?.providers?.[loadConfig()['cline-provider'] || 'cline'];
    const t = p?.settings?.auth?.accessToken || p?.apiKey;
    return typeof t === 'string' && t ? t : null;
  } catch { return null; }
}

function readClineFreeCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CLINE_FREE_CACHE_FILE, 'utf8'));
    if (Array.isArray(j.models) && j.fetchedAt) return j;
  } catch { /* 无缓存 */ }
  return null;
}

/** 当前免费模型组。成功：{ok:true, source:'endpoint'|'cache', fetchedAt, models:[{id,name,description}]}；
 *  失败：{ok:false, source:'none', models:[], error}（明确报错，绝不崩溃、绝不打印 token）。 */
export async function fetchClineFreeModels({ timeoutMs = 10000 } = {}) {
  const token = clineAccessTokenForCatalog_();
  if (!token) {
    return { ok: false, source: 'none', models: [], error: 'cline 未登录（隔离 providers.json 无凭证）——node wbx.mjs login --identity cline' };
  }
  const r = await httpJson('GET', CLINE_RECOMMENDED_MODELS_URL, { headers: { Authorization: `Bearer ${token}` }, timeoutMs });
  if (r.status !== 200 || !r.json) {
    const cached = readClineFreeCache();
    if (cached) {
      return { ok: true, source: 'cache', fetchedAt: cached.fetchedAt, models: cached.models,
        note: `recommended-models 端点失败（HTTP ${r.status || '网络错误'}），降级使用 ${cached.fetchedAt} 的缓存清单` };
    }
    return { ok: false, source: 'none', models: [], error: `recommended-models 端点失败（HTTP ${r.status || '网络错误'}：${brief(r.text, 120)}）且无缓存` };
  }
  const d = r.json.data || r.json;
  const arr = Array.isArray(d?.free) ? d.free : [];
  const models = arr
    .filter((m) => m && typeof m.id === 'string' && m.id)
    .map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : '', description: typeof m.description === 'string' ? m.description : '' }));
  const rec = { fetchedAt: new Date().toISOString(), models };
  try {
    fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
    fs.writeFileSync(CLINE_FREE_CACHE_FILE, JSON.stringify(rec, null, 2), 'utf8');
  } catch { /* 缓存写失败不影响返回 */ }
  return { ok: true, source: 'endpoint', fetchedAt: rec.fetchedAt, models };
}

// ---------- 免费档错误形态（超额状态机） ----------
// 错误形态模板取自 cline 3.0.65 二进制：
//   每日配额：『Daily free model limit reached / You've reached today's free usage limit for this
//             model. / Try again in <时长> or select another model.』（ClineFreeModelLimitError）
//   促销轮换：『Free model promotion ended / The free promotion for this model has ended and it is
//             no longer available.』
//   不存在 id：『model not found』（实测：agent_event.error.message 与 run_result.text 均为该串）
export function isFreeLimitError(text) {
  return /daily free model limit|today'?s free usage limit|free model limit reached/i.test(String(text || ''));
}

export function isFreePromotionEndedError(text) {
  return /free model promotion ended|free promotion for this model has ended/i.test(String(text || ''));
}

export function isModelNotFoundError(text) {
  return /model not found/i.test(String(text || ''));
}

/** 从超额错误文本提取重置倒计时（如 "5m"、"2h 30m"）；无则 null。 */
export function extractFreeLimitResetIn(text) {
  const m = /Try again in ([^.]+?) or select another model/i.exec(String(text || ''));
  return m ? m[1].trim() : null;
}

// ---------- worker 能力矩阵 caps（v19：能力原语 net/read/write，L0/L1 预设降格为别名） ----------
// 第一性：caps 是任务契约不是偏好——绝不静默降档、绝不自动改路；∅ 出厂零回退。
// 历史（探针定案，证据 internal/archive/v10/ + v19/ + WBX.md 各版本章）：
//   ∅（L0 别名）= 纯文本零回退（v21 起五 lane 全部）；
//   net,read（L1 别名）= 仅 ai/cn（codebuddy --tools 白名单，最小权限 default 档；cwd 外绝对路径
//         读取被审批拒绝（v10 P2c+v19 P4），空 scratch 为 cwd 获得读边界）；
//   含 write = 本轮未交付（v19 探针 P3：acceptEdits 档越界写逃逸，沙箱前提破裂——声明即
//         caps-write-disabled，不设总闸）；readDirs 本轮缓期（P4：add-dir 边界不可证，字段声明即报错）；
//   L2 = 保留未交付（cline 3.0.65 无命令级 deny，六层防护栈第②层缺层，v10 探针）。
// 契约 A：回合上限缺省 24（8 回合不够典型联网调研，v11.2 P3 实证——叙事见 CHANGELOG 6.2.0）；
// 三层取值：任务级 maxTurns > config caps-l1-max-turns > 此缺省（v19 起语义=任何非 ∅ 能力集）。
export const L1_MAX_TURNS_DEFAULT = 24;
export const L2_NOT_DELIVERED_MSG = 'L2 本版未交付：cline 3.0.65 无命令级权限管控（CLINE_COMMAND_PERMISSIONS 特性不存在，Phase 0 实测 deny 三组全失效、del 实删文件），六层防护栈缺层不交付（用户 2026-09-25 裁决「L2 缓期，本版留位」）。上游发布该特性后将按完整六层防护栈交付，详见 WBX.md v6.0.0';

// 契约 A：任务级 maxTurns 字段校验（整数 1-64；仅 caps L1 生效——L0 无回合概念）
export function parseMaxTurns(v, ctx = '任务') {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 64) {
    throw new Error(`${ctx} 的 maxTurns 需为 1-64 的整数（收到 ${JSON.stringify(v)}）`);
  }
  return n;
}

// 能力任务实际回合上限（任务级 maxTurns 优先，缺省 config caps-l1-max-turns，再缺省 24）。
// v22 更名 resolveL1MaxTurns→resolveCapsMaxTurns 并去 String 化（v19 起语义=任何非 ∅ 能力集，名实相符；
// 公开 config 键 caps-l1-max-turns 不动——公开契约）
export function resolveCapsMaxTurns(maxTurns) {
  const mt = parseMaxTurns(maxTurns);
  if (mt != null) return mt;
  return Number(loadConfig()['caps-l1-max-turns'] || L1_MAX_TURNS_DEFAULT);
}

// caps 拒绝对象（capsReject_ 分流消费，文案能力集口径）
const capsInvalid_ = (caps) => ({ ok: false, kind: 'caps-invalid', error: `caps 只支持能力集（net/read/write 逗号组合）或别名 L0 | L1（收到 ${caps}）`, durationMs: 0, hint: 'caps-invalid' });
const capsL2NotDelivered_ = () => ({ ok: false, kind: 'caps-l2-not-delivered', error: L2_NOT_DELIVERED_MSG, durationMs: 0, hint: 'caps-l2-not-delivered' });

// ---------- caps v2 能力矩阵（v19）：能力原语为本体，L0/L1 预设降格为别名 ----------
// 第一性：caps 的本源是能力集合（net/read/write），三档枚举只是历史预设包。契约：
//   token ∈ {net,read,write}（逗号分隔、序无关、去重、大小写不敏感）；L0≡∅（缺省）、L1≡net,read；
//   L2 保留 → caps-l2-not-delivered（行为不变）；非法 → caps-invalid。write 本轮未交付（探针 P3：
//   acceptEdits 档越界写逃逸，沙箱前提破裂——RESEARCH-V19 §六勘误），声明即 caps-write-disabled。
export const CAPS_TOKENS = ['net', 'read', 'write'];            // 固定序 = 规范化输出序
export const CAPS_ALIASES = { L0: [], L1: ['net', 'read'] };    // 预设别名（行为与兼容不变）
export const CAPS_TOOL_WHITELIST = { net: 'WebSearch,WebFetch', read: 'Read,Glob,Grep', write: 'Write,Edit' };
export const CAPS_WRITE_MODE = 'acceptEdits';   // P2 裁决写档位（write 交付轮使用；本轮经 write 门不可达）
export const CAPS_TIMEOUT_DEFAULT_S = 600;      // 非 ∅ 能力集缺省超时（超时政策单点，见 resolveCapsTimeoutS）
export const CAPS_WRITE_DISABLED_MSG = 'write 能力本轮未交付：探针 P3 实证 acceptEdits 档越界写逃逸（scratch 外绝对路径写成功，沙箱前提破裂，RESEARCH-V19 §六勘误）。交付将随后续轮次（进程级边界修复+重探针）评估，本轮不设总闸、不置闸';

/**
 * 解析 caps 声明为规范化能力集合（v19 唯一入口；替代三档枚举 parseCaps）。
 * 返回 { ok:true, set:['net','read'…固定序], normalized:'net,read' }
 *     | { ok:false, kind:'caps-invalid' | 'caps-l2-not-delivered' }。
 * 别名必须独立成值（'L1,net' → caps-invalid）；∅ 的 normalized 为 ''。
 */
export function parseCapsSet(v) {
  const raw = String(v ?? '').trim();
  if (!raw) return { ok: false, kind: 'caps-invalid' };
  const up = raw.toUpperCase();
  if (up === 'L2') return { ok: false, kind: 'caps-l2-not-delivered' };
  if (Object.hasOwn(CAPS_ALIASES, up)) return { ok: true, set: [...CAPS_ALIASES[up]], normalized: CAPS_ALIASES[up].join(',') };
  const seen = new Set();
  for (const part of raw.split(',')) {
    const tok = part.trim().toLowerCase();
    if (!tok) continue;
    if (!CAPS_TOKENS.includes(tok)) return { ok: false, kind: 'caps-invalid' };
    seen.add(tok);
  }
  if (!seen.size) return { ok: false, kind: 'caps-invalid' };
  const set = CAPS_TOKENS.filter((t) => seen.has(t));
  return { ok: true, set, normalized: set.join(',') };
}

/** caps 解析失败 → askOnce 系返回对象（kind 二选一分流）。 */
export function capsReject_(parsed, caps) {
  return parsed.kind === 'caps-l2-not-delivered' ? capsL2NotDelivered_() : capsInvalid_(caps);
}
const capsWriteDisabled_ = () => ({ ok: false, kind: 'caps-write-disabled', error: CAPS_WRITE_DISABLED_MSG, durationMs: 0, hint: 'caps-write-disabled' });
/** write 门（本轮 STOP：含 write 的能力集一律显式报错，绝不静默剥能力；交付轮在此接入总闸）。 */
export function capsRejectWrite_(parsed) {
  return parsed.set.includes('write') ? capsWriteDisabled_() : null;
}

// caps×lane 拒绝单点（v22 收敛三处 askOnce 分流的复制链）：cline/doubao/codex 不承载任何
// 非 ∅ 能力集——解析失败与 lane 不匹配的返回对象在此一次定义；返回 null=放行
const CAPS_LANE_MISMATCH_WHY = {
  cline: '--auto-approve 仅布尔两档',
  doubao: '豆包桌面 agent 不受桥控',
  codex: 'exec 沙箱与工具面不受桥控',
};
export function capsGate(lane, caps) {
  const parsed = parseCapsSet(caps);
  if (!parsed.ok) return capsReject_(parsed, caps);
  if (parsed.set.length) {
    return {
      ok: false, kind: 'caps-lane-mismatch',
      error: `能力集 ${parsed.normalized} 仅支持 ai | cn lane（codebuddy --tools 白名单承载，--as ai / --as cn）；${lane} 不承载能力任务：${CAPS_LANE_MISMATCH_WHY[lane]}，无法承诺只读语义`,
      durationMs: 0, hint: 'caps-lane-mismatch',
    };
  }
  return null;
}

/**
 * capsToArgs(capsSet, { maxTurns })：能力集合 → codebuddy 旗标数组的唯一组合函数
 *（v19 起替换 askOnce 内的三元；旗标组合点唯一=三原则自证锚点。同集合+同 config 下输出确定：
 * 回合上限经 resolveCapsMaxTurns 读 config，属环境注入而非纯函数）。
 * ∅ → 逐字 v5 L0 序列；非 ∅ → 白名单（固定序拼接）+ permission-mode + max-turns + json 序列。
 * {net,read} 输出与现行 L1 序列逐字一致（特征断言 internal/v19-regression.mjs 锁定）。
 */
export function capsToArgs(capsSet, { maxTurns = null } = {}) {
  const set = Array.isArray(capsSet) ? capsSet : [...(capsSet || [])];
  if (!set.length) {
    // L0：纯 LLM 无工具模式（对标桌面版 Quick 模式）——逐字不变
    return ['--tools', '', '--output-format', 'json', '--no-session-persistence', '--max-turns', '1'];
  }
  const whitelist = set.map((t) => CAPS_TOOL_WHITELIST[t]).filter(Boolean).join(',');
  const mode = set.includes('write') ? CAPS_WRITE_MODE : 'default';
  // 回合上限契约 A 三层取值：任务级 maxTurns > config caps-l1-max-turns > 缺省 24（键名不动，语义=任何非∅集合）
  return ['--tools', whitelist, '--permission-mode', mode, '--max-turns', String(resolveCapsMaxTurns(maxTurns)), '--output-format', 'json', '--no-session-persistence'];
}

/**
 * resolveCapsTimeoutS(explicitTimeoutS, capsSet)：超时政策唯一决策点（ask 与 fanout 同源）。
 * 显式值最高优先（原值返回）；缺省时非 ∅ 能力集 600s（多轮+搜索延迟），∅ 300s（现行通用缺省）。
 * 修掉 v6.8 现状：两处独立 Math.max 决策 + fanout 记录/汇总展示未上浮值（观测说谎）+
 * 显式小值被 Math.max 静默覆盖（违背显式最高优先）。
 */
export function resolveCapsTimeoutS(explicitTimeoutS, capsSet) {
  const set = Array.isArray(capsSet) ? capsSet : [...(capsSet || [])];
  const n = Number(explicitTimeoutS);
  if (explicitTimeoutS != null && Number.isFinite(n) && n > 0) return n;
  return set.length ? CAPS_TIMEOUT_DEFAULT_S : 300;
}

// L1 的空 scratch 工作目录（读边界：白名单无写工具 + cwd 外绝对路径读取被进程级拒绝）；
// SCRATCH_ROOT/L0_CWD_DIR 定义在 ./wbx-paths.mjs（v28-S 路径单点）
function ensureL0Cwd() { try { fs.mkdirSync(L0_CWD_DIR, { recursive: true }); } catch { /* 竞态容错 */ } return L0_CWD_DIR; }
export function ensureScratch(name) {
  const d = path.join(SCRATCH_ROOT, sanitizeId(name));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// L1 工具轨迹摘要：从 codebuddy transcript 数组提取 function_call 事件（P2 实测事件形态）
// 返回 { counts: {工具名: 次数}, samples: ['工具名|参数前80字符', ...]（≤20 条） }
export function extractToolTrace(arr) {
  const counts = {};
  const samples = [];
  if (!Array.isArray(arr)) return { counts, samples };
  for (const ev of arr) {
    if (ev && typeof ev === 'object' && ev.type === 'function_call') {
      const name = typeof ev.name === 'string' ? ev.name : (ev.function?.name ?? 'unknown');
      counts[name] = (counts[name] || 0) + 1;
      if (samples.length < 20) {
        const argsRaw = typeof ev.arguments === 'string' ? ev.arguments : JSON.stringify(ev.function?.arguments ?? ev.arguments ?? {});
        samples.push(`${name}|${String(argsRaw).replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
  }
  return { counts, samples };
}

// ---------- 小工具 ----------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// die：校验/致命错误统一出口——抛 DieSignal 交 CLI 顶层 main 捕获后 exitWith(1)（等 pendingKills
// 再退，消 win32 libuv 断言风险，v22 退出协议统一）。调用处控制流随 throw 终止，等价原 exit(1)
export class DieSignal extends Error {
  constructor(msg) { super(msg); this.name = 'DieSignal'; }
}
export function die(msg) { console.error('[FAIL] ' + msg); throw new DieSignal(msg); }

export function nodeOk() {
  const v = process.versions.node.split('.').map(Number);
  return !(v[0] < 18 || (v[0] === 18 && (v[1] < 20 || (v[1] === 20 && v[2] < 8))));
}

export function ansiStrip(s) { return String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); }

export function redact(s) {
  return String(s || '')
    .replace(/((?:token|password|passwd|secret|api[-_]?key|authorization)["';:=\s]+(?:(?:bearer|basic|token)\s+)?)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/(x-access-token["';:=\s]+)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');   // 裸 JWT 兜底（错误文案/URL 内）
}

export function fmtMs(ms) { return (ms / 1000).toFixed(1) + 's'; }

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function sanitizeId(s) {
  return String(s).replace(/[\\/:*?"<>|\r\n\t ]+/g, '_').slice(0, 80) || 'task';
}

export function brief(s, n = 320) {
  const t = redact(ansiStrip(String(s || '')).trim());
  return t.length > n ? t.slice(0, n) + ' …(截断)' : t;
}

// 失败诊断 brief 变体——超长时改「首 n/2 + 尾 n/2」各半，中段以省略标记连接。
// 背景：unparseable/cli-error 的 combined 常以环境横幅开头，头部截断会吞掉
// 尾部的真实错误信息。仅用于错误文本展示；完整输出由失败 attempt 落盘承接（见 dumpFailedAttempt）。
export function errorBrief(s, n = 320) {
  const t = redact(ansiStrip(String(s || '')).trim());
  if (t.length <= n) return t;
  const half = Math.floor(n / 2);
  const omitted = t.length - half * 2;
  return t.slice(0, half) + `…(省略 ${omitted} 字符)…` + t.slice(t.length - half);
}

export function isAuthError(text) {
  return /Authentication required|not logged|please.*sign.?in|unauthorized|\b401\b/i.test(String(text || ''));
}

export function isRateLimit(text) {
  return /rate.?limit|too many requests|\b429\b|quota|限流|频繁/i.test(String(text || ''));
}

export function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// CRC32（多项式 0xEDB88320，查表确定性生成）——wbx-ui PWA 图标 PNG chunk 与 wbx-setup zip 共用（v22 单源）
export const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function maskUin(uin) {
  const s = String(uin || '');
  return s.length > 4 ? s.slice(0, 2) + '***' + s.slice(-2) : s || '?';
}

export function ensureDirs() {
  for (const id of Object.values(IDENTITIES)) fs.mkdirSync(id.configDir, { recursive: true });
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.mkdirSync(PRODUCT_DIR, { recursive: true });
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(CLINE_HOME, { recursive: true });             // cline 隔离主目录（HOME 覆盖目标）
  fs.mkdirSync(CLINE_WORK_DIR, { recursive: true });         // cline 调用的空工作目录（-c）
  fs.mkdirSync(CODEX_HOME, { recursive: true });             // codex 隔离 CODEX_HOME（auth.json 复制目标）
  fs.mkdirSync(CODEX_WORK_DIR, { recursive: true });         // codex exec 的空工作目录（cwd，read-only 沙箱）
}

export function readStdin() {
  return new Promise((res) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { s += d; });
    process.stdin.on('end', () => res(s));
    if (process.stdin.isTTY) { console.error('（stdin 为 TTY，请改用 --file/--text）'); res(''); }
  });
}

// ---------- 配置（config.json，存运行时根） ----------
export const CONFIG_DEFS = {
  'default-lane': {
    type: 'enum', values: ['auto', ...LANE_ORDER], default: 'auto',
    desc: 'ask 默认路由：auto=codex 就绪即质量档优先，否则 ai 免费优先；或固定 codex / ai / cn / cline / doubao',
  },
  'disabled-lanes': {
    type: 'lanes', default: [],
    desc: '硬禁用的 lane 列表（doctor 标注、fanout 默认 lanes 与回退链跳过），如 ["cn"]',
  },
  'parallel-per-lane': {
    type: 'int', min: 1, max: 8, default: 2,
    desc: 'fanout 每 lane 并发上限（默认 2；cline 另受 cline-parallel 约束）',
  },
  'model': {
    type: 'string', default: FALLBACK_MODEL,
    desc: '默认模型 id（ai/cn lane 的 CodeBuddy 模型）',
  },
  'cli-path': {
    type: 'string', default: '',
    desc: 'CodeBuddy CLI 入口路径（优先级低于 WBX_CLI env；doctor 可自动探测写入）',
  },
  'cline-path': {
    type: 'string', default: '',
    desc: 'cline 二进制路径（可选 lane；空=自动扫描 npm 全局；传空串清空）',
  },
  'cline-data-dir': {
    type: 'string', default: '',
    desc: 'cline 隔离主目录（默认 <运行时根>/cline-home；禁止指向 ~/.cline）',
  },
  'cline-provider': {
    type: 'string', default: 'cline',
    desc: 'cline provider id：cline（免费额度+按量）| cline-pass（订阅）',
  },
  'cline-model': {
    type: 'string', default: CLINE_FREE_DEFAULT_MODEL,
    desc: `cline lane 模型 id（默认免费孪生 ${CLINE_FREE_DEFAULT_MODEL}；免费组轮换后用 wbx models --as cline --free 查当前清单）`,
  },
  'cline-thinking': {
    type: 'string', default: 'xhigh',
    desc: 'cline 思考档位（none|low|medium|high|xhigh；用户定案默认 xhigh，任务级 effort 不下调）',
  },
  'cline-compaction': {
    type: 'string', default: 'off',
    desc: 'cline 上下文压缩模式（agentic|basic|off；默认 off=上下文最大化）',
  },
  'cline-parallel': {
    type: 'int', min: 1, max: 8, default: 1,
    desc: 'cline lane 并发上限（默认 1，免费额度保护；实测稳定后可调）',
  },
  'doubao-parallel': {
    type: 'int', min: 1, max: 2, default: 1,
    desc: 'doubao lane 并发上限（默认 1，上限 2——单客户端 UI 串行保护：豆包桌面端一次只呈现一个工作任务，多并发会互相打断）',
  },
  'doubao-autostart': {
    type: 'boolean', default: true,
    desc: '豆包客户端自动拉起（v6.8 桥自治，默认开）：派发链真正到达 doubao lane 且调试口 9225 不可达时，自动经 launch.ps1 拉起（已运行实例带 -Force 重启）；off=保持现状（快速失败回退，绝不碰豆包进程）',
  },
  'cline-auto-heal': {
    type: 'boolean', default: true,
    desc: 'cline 模型自愈（v6.8 桥自治，默认开）：配置 id 被免费组轮换下线（model-not-found 且实时清单确认不在组内）时，自动切换免费组首个可用 id、写回 config 并在派发链内重投一次；Daily limit（配额耗尽）不触发换模型，失败回退 ai/cn 语义不变',
  },
  'default-caps': {
    type: 'caps', default: 'L0',
    desc: 'ask/fanout 缺省能力集（v19 能力矩阵）：∅（L0，纯文本零回退）| net,read（L1 别名，仅 ai/cn）| net/read/write 逗号集合串（含 write 本轮未交付，声明即报 caps-write-disabled）| L2（保留未交付，声明即报错）',
  },
  'caps-l1-max-turns': {
    type: 'int', min: 1, max: 64, default: L1_MAX_TURNS_DEFAULT,
    desc: '能力任务缺省回合上限（v6.2 起 8→24；键名沿用 caps-l1-max-turns，v19 起语义=任何非 ∅ 能力集；任务级 maxTurns 字段（1-64）可覆盖，∅ 无回合概念）',
  },
  'caps-l2-enabled': {
    type: 'boolean', default: false,
    desc: 'L2 总闸（默认 false；本版 L2 未交付——开闸也报「未交付」。留作上游支持命令级 deny 后的前置闸，日常开闸须用户显式授权）',
  },
  'codex-path': {
    type: 'string', default: '',
    desc: 'codex.exe 路径（可选第五 lane；空=自动扫描 %LOCALAPPDATA%\\OpenAI\\Codex\\bin\\<hash>\\codex.exe 取 mtime 最新；传空串清空）',
  },
  'codex-model': {
    type: 'string', default: 'gpt-6.1-sol',
    desc: 'codex lane 模型（默认 gpt-6.1-sol；底线护栏：仅放行 gpt-6 及以上主版本——用户 2026-10-14 裁决「不用 GPT-5.6 及以下」，拒 gpt-5.5/gpt-5.6-*/codex-auto-review/gpt-reserve）',
  },
  'codex-reasoning': {
    type: 'enum', values: ['low', 'medium', 'high', 'xhigh'], default: 'medium',
    desc: 'codex 推理档（默认 medium；任务级 effort low/medium/high 直通映射，xhigh 仅 config 可设、任务级不暴露）',
  },
  'codex-parallel': {
    type: 'int', min: 1, max: 8, default: 1,
    desc: 'codex lane 并发上限（默认 1，Plus 单账号 5h 滚动窗口额度保护）',
  },
  'codex-quota-cooldown-min': {
    type: 'int', min: 1, max: 720, default: 30,
    desc: 'Plus 额度耗尽后的冷却分钟数（检测到 usage limit 即写 codex-quota.json 冷却让位；冷却期 auto 路由跳过 codex，显式点名放行）',
  },
  // v24 夜间免费档七键（ai/cn 模型策略 D-1；下发矩阵见 resolveModelPolicy——ai 恒不下发 effort）
  'effort': {
    type: 'enum', values: NIGHT_EFFORT_VALUES, default: 'max',
    desc: 'cn lane 白天思考档（CodeBuddy --effort 直通；DeepSeek 极致=max。ai lane 恒不下发 effort——国际版思考不可调，用户口径；任务级显式 --effort 仍最高优先）',
  },
  'context': {
    type: 'string', default: '1m',
    desc: 'ai/cn 白天上下文预算（CodeBuddy --autocompact：auto|<数字>[km]，CLI 钳制 100k-1M；DeepSeek V4.1 Flash 上下文 1M）',
  },
  'night-model': {
    type: 'string', default: 'hy4-preview',
    desc: 'cn 夜间免费档模型 id（官方 models.json 片段一手+P0 探针实证 2026-10-18；仅夜间窗内替代 config model，任务级显式 --model 恒最高优先）',
  },
  'night-effort': {
    type: 'enum', values: NIGHT_EFFORT_VALUES, default: 'high',
    desc: 'cn 夜间档思考档（Hy4 API 仅 high/none、默认 high；任务级显式 --effort 恒最高优先）',
  },
  'night-context': {
    type: 'string', default: '960k',
    desc: 'cn 夜间档上下文预算（Hy4 1M 上下文=最大输入 960K+最大输出 64K；格式同 --autocompact）',
  },
  'night-window': {
    type: 'string', default: '23:00-08:00',
    desc: 'cn 夜间免费窗 HH:MM-HH:MM（北京时间，半开区间 [start,end)，支持跨午夜；解析失败容错回默认。纯时钟判定：每次投递现算，不缓存）',
  },
  'night-expires': {
    type: 'string', default: '2026-10-31',
    desc: '夜间免费活动截止 YYYY-MM-DD（北京日期，截止日全天仍有效；空串=无截止；过期恒白天档，doctor/WARN 提示。官方公告转述，以官方为准）',
  },
};

// loadConfig 不缓存（D-048）：每次直读（~1KB JSON，成本可忽略）——mtime 失效键在 OS 时钟粒度下无法
// 区分同一 tick 的连续写（v23 实测：进程内 setConfig 后同 tick 读会命中陈旧缓存，门禁亦非确定红）——
// 缓存本身就是缺陷，移除即根因
export function loadConfig() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* 无配置文件 */ }
  const out = {};
  for (const [k, def] of Object.entries(CONFIG_DEFS)) out[k] = def.default;
  for (const k of Object.keys(CONFIG_DEFS)) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  // 容错矫正
  if (!CONFIG_DEFS['default-lane'].values.includes(out['default-lane'])) out['default-lane'] = 'auto';
  if (!Array.isArray(out['disabled-lanes'])) out['disabled-lanes'] = [];
  out['disabled-lanes'] = out['disabled-lanes'].filter((x) => LANE_ORDER.includes(x));
  if (!Number.isInteger(out['parallel-per-lane']) || out['parallel-per-lane'] < 1 || out['parallel-per-lane'] > 8) {
    out['parallel-per-lane'] = 2;
  }
  if (typeof out.model !== 'string' || !out.model) out.model = FALLBACK_MODEL;
  if (typeof out['cli-path'] !== 'string') out['cli-path'] = '';
  // cline-* 键（v5 起全部可选）
  for (const k of ['cline-path', 'cline-data-dir']) {
    if (typeof out[k] !== 'string') out[k] = '';
  }
  if (typeof out['cline-model'] !== 'string' || !out['cline-model']) out['cline-model'] = CLINE_FREE_DEFAULT_MODEL;
  if (!CLINE_PROVIDER_IDS.includes(out['cline-provider'])) out['cline-provider'] = 'cline';
  if (!['none', 'low', 'medium', 'high', 'xhigh'].includes(out['cline-thinking'])) out['cline-thinking'] = 'xhigh';
  if (!['agentic', 'basic', 'off'].includes(out['cline-compaction'])) out['cline-compaction'] = 'off';
  if (!Number.isInteger(out['cline-parallel']) || out['cline-parallel'] < 1 || out['cline-parallel'] > 8) {
    out['cline-parallel'] = 1;
  }
  // doubao-parallel：非法/越界一律回缺省 1（min 1 max 2，单客户端 UI 串行保护）
  if (!Number.isInteger(out['doubao-parallel']) || out['doubao-parallel'] < 1 || out['doubao-parallel'] > 2) {
    out['doubao-parallel'] = 1;
  }
  // 桥自治双键：非布尔回缺省 true（出厂开启；off 才是用户显式退出）
  if (typeof out['doubao-autostart'] !== 'boolean') out['doubao-autostart'] = true;
  if (typeof out['cline-auto-heal'] !== 'boolean') out['cline-auto-heal'] = true;
  // caps 键：default-caps 非法（非别名/集合串/L2）回退 L0；caps-l2-enabled 非布尔回退 false（出厂缺省）
  {
    const dcParsed = parseCapsSet(out['default-caps']);
    const dcIsL2 = !dcParsed.ok && dcParsed.kind === 'caps-l2-not-delivered';
    if (!dcParsed.ok && !dcIsL2) out['default-caps'] = 'L0';
  }
  if (typeof out['caps-l2-enabled'] !== 'boolean') out['caps-l2-enabled'] = false;
  // caps-l1-max-turns 非法回退缺省 24（与 schema/resolve 同源常量 L1_MAX_TURNS_DEFAULT）
  if (!Number.isInteger(out['caps-l1-max-turns']) || out['caps-l1-max-turns'] < 1 || out['caps-l1-max-turns'] > 64) {
    out['caps-l1-max-turns'] = L1_MAX_TURNS_DEFAULT;
  }
  // codex-* 五键：类型/枚举/边界容错一律回缺省；codex-model 护栏同源校验
  //（护栏失败回 CONFIG_DEFS 默认——存量坏值不阻断加载，config set 与 askOnceCodex 的显式路径仍报 floor）
  const CODEX_MODEL_DEFAULT = CONFIG_DEFS['codex-model'].default;
  if (typeof out['codex-path'] !== 'string') out['codex-path'] = '';
  if (typeof out['codex-model'] !== 'string' || !out['codex-model'].trim()) out['codex-model'] = CODEX_MODEL_DEFAULT;
  else { try { out['codex-model'] = validateCodexModel(out['codex-model']); } catch { out['codex-model'] = CODEX_MODEL_DEFAULT; } }
  if (!['low', 'medium', 'high', 'xhigh'].includes(out['codex-reasoning'])) out['codex-reasoning'] = 'medium';
  if (!Number.isInteger(out['codex-parallel']) || out['codex-parallel'] < 1 || out['codex-parallel'] > 8) out['codex-parallel'] = 1;
  if (!Number.isInteger(out['codex-quota-cooldown-min']) || out['codex-quota-cooldown-min'] < 1 || out['codex-quota-cooldown-min'] > 720) {
    out['codex-quota-cooldown-min'] = 30;
  }
  // v24 夜间档七键：类型/格式容错一律回缺省（config set 时已校验，这里兜住存量坏值——既有行为不回归）
  if (!NIGHT_EFFORT_VALUES.includes(out.effort)) out.effort = 'max';
  if (typeof out.context !== 'string' || !NIGHT_CONTEXT_RE.test(out.context)) out.context = '1m';
  if (typeof out['night-model'] !== 'string' || !out['night-model'].trim()) out['night-model'] = CONFIG_DEFS['night-model'].default;
  if (!NIGHT_EFFORT_VALUES.includes(out['night-effort'])) out['night-effort'] = 'high';
  if (typeof out['night-context'] !== 'string' || !NIGHT_CONTEXT_RE.test(out['night-context'])) out['night-context'] = '960k';
  if (!parseNightWindow(out['night-window'])) out['night-window'] = '23:00-08:00';
  {
    const ne = String(out['night-expires'] ?? '').trim();
    if (ne !== '' && !NIGHT_EXPIRES_RE.test(ne)) out['night-expires'] = '2026-10-31';
  }
  return { ...out };
}

export function parseConfigValue(key, valueStr) {
  const def = CONFIG_DEFS[key];
  if (!def) throw new Error(`未知配置键 ${key}（可用：${Object.keys(CONFIG_DEFS).join(', ')}）`);
  let v;
  try { v = JSON.parse(valueStr); } catch { v = valueStr; }
  // codex-model 走 validateCodexModel 单点（与 askOnceCodex 读取同源；报错含 codex-model-floor 语义文案）
  if (key === 'codex-model') return validateCodexModel(typeof v === 'string' ? v : String(v));
  switch (def.type) {
    case 'enum':
      if (!def.values.includes(v)) throw new Error(`${key} 只支持 ${def.values.join(' | ')}（收到 ${JSON.stringify(v)}）`);
      return v;
    case 'caps': {
      // v19 能力矩阵：别名 L0/L1 原样存（显示友好），集合串存规范化形式，L2 保留（声明任务时才报未交付）
      const s = typeof v === 'string' ? v.trim() : String(v ?? '');
      const up = s.toUpperCase();
      if (up === 'L0' || up === 'L1' || up === 'L2') return up;
      const parsed = parseCapsSet(s);
      if (!parsed.ok) throw new Error(`${key} 需为能力集（net/read/write 逗号组合）或别名 L0 | L1 | L2（收到 ${JSON.stringify(v)}）`);
      return parsed.normalized;
    }
    case 'lanes': {
      if (typeof v === 'string') v = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (!Array.isArray(v)) throw new Error(`${key} 需为 lane 数组，如 ["cn"] 或 "cn"`);
      const bad = v.filter((x) => !LANE_ORDER.includes(x));
      if (bad.length) throw new Error(`${key} 只支持 ${LANE_ORDER.join('/')}（收到 ${JSON.stringify(bad)}）`);
      return [...new Set(v)];
    }
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < def.min || n > def.max) throw new Error(`${key} 需为 ${def.min}-${def.max} 的整数`);
      return n;
    }
    case 'boolean': {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      throw new Error(`${key} 只支持 true | false（收到 ${JSON.stringify(v)}）`);
    }
    default:
      return String(v);
  }
}

export async function setConfig(key, valueStr) {
  const v = parseConfigValue(key, valueStr);
  // 只补丁目标键：归一化视图回写会把 ~25 个缺省键实体化进 config.json、丢弃未知键并固化其它键的
  // 静默「改正」值——归一化只属于内存视图（v23 评审 P2）
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* 无/坏配置：从空起写 */ }
  raw[key] = v;
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(raw, null, 2), 'utf8');
  return { key, value: v, config: loadConfig() };
}

// ---------- CLI 路径与模型解析 ----------
export function resolveCliPath() {
  if (process.env.WBX_CLI) return process.env.WBX_CLI;
  const cfg = loadConfig();
  // config 有值就用（即使失效也如实返回；doctor 会发现失效并触发扫描/重写）
  if (cfg['cli-path']) return cfg['cli-path'];
  return DEFAULT_CLI_PATH;
}

export function resolveModel(explicit) {
  if (explicit) return explicit;
  if (process.env.WBX_MODEL) return process.env.WBX_MODEL;
  return loadConfig().model || FALLBACK_MODEL;
}

// doctor 用：扫描常见安装位置找 CodeBuddy CLI（App 升级会挪路径）
export function scanCliCandidates() {
  const suffix = ['resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy'];
  const roots = [];
  if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'Programs'));
  roots.push('C:\\Program Files', 'C:\\Program Files (x86)', 'D:\\App');
  const found = new Set();
  const probe = (dir) => {
    const p = path.join(dir, ...suffix);
    if (fs.existsSync(p)) found.add(p);
  };
  if (fs.existsSync(DEFAULT_CLI_PATH)) found.add(DEFAULT_CLI_PATH);
  for (const root of roots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries) {
      if (!/workbuddy/i.test(e)) continue;
      probe(path.join(root, e));
    }
  }
  return [...found].sort();
}

// ---------- lane 与凭证 ----------
export function readSession(laneKey) {
  const id = identityOf(laneKey);
  try { return JSON.parse(fs.readFileSync(id.sessionPath, 'utf8')); } catch { return null; }
}

export function laneReady(laneKey) {
  if (laneKey === 'cline') return clineReady();
  if (laneKey === 'doubao') return doubaoReady();
  if (laneKey === 'codex') return codexReady();
  const id = IDENTITIES[laneKey];
  return !!id && fs.existsSync(id.sessionPath) && fs.existsSync(id.productPath);
}

export function isLaneDisabled(laneKey) { return loadConfig()['disabled-lanes'].includes(laneKey); }

export function enabledLanes() { return LANE_ORDER.filter((k) => !isLaneDisabled(k)); }

export function loggedLanes() { return LANE_ORDER.filter(laneReady); }

// 非_secret_ 的 lane 状态摘要（UI/doctor 安全展示用：只含昵称/脱敏 uin/到期，绝无 token）
export function laneStatusInfo(laneKey) {
  if (laneKey === 'cline') {
    const bin = resolveClinePath();
    const installed = !!bin;
    const ready = clineHasCredential();
    const cfg = loadConfig();
    return {
      key: 'cline', label: 'Cline CLI', cost: '免费（cline-free 孪生，限时轮换+每日配额）',
      endpoint: 'cline provider（OAuth 账号）',
      ready: ready && installed, installed, credential: ready,
      disabled: isLaneDisabled('cline'),
      model: cfg['cline-model'] || null,
      thinking: cfg['cline-thinking'], compaction: cfg['cline-compaction'],
      nickname: null, uinMasked: null, expiresAt: null, expiresInDays: null,
      templateExists: installed,
      binaryPath: bin,
    };
  }
  // codex 专用分支（对齐 cline/doubao 分支形态）——绝不落进下方 IDENTITIES[laneKey] || IDENTITIES.cn 兜底。
  // 四态：未装（无二进制）/ 未登录（无 auth.json）/ 冷却中（额度）/ 已登录。
  if (laneKey === 'codex') {
    const bin = resolveCodexPath();
    const installed = !!bin;
    const credential = installed && fs.existsSync(path.join(CODEX_HOME, 'auth.json'));
    const quota = codexQuotaState();
    const cfg = loadConfig();
    return {
      key: 'codex', label: 'Codex CLI', cost: 'ChatGPT Plus 额度',
      endpoint: 'Codex CLI（ChatGPT 账号，ChatGPT Plus）',
      ready: credential && !quota.active, installed, credential,
      disabled: isLaneDisabled('codex'),
      model: cfg['codex-model'] || null,
      reasoning: cfg['codex-reasoning'],
      cooldown: quota.active ? { until: new Date(quota.until).toISOString(), remainingMin: quota.remainingMin, reason: quota.reason } : null,
      nickname: null, uinMasked: null, expiresAt: null, expiresInDays: null,
      templateExists: installed,
      binaryPath: bin,
    };
  }
  // doubao 专用分支（对齐 cline 分支形态）——绝不落进下方 IDENTITIES[laneKey] || IDENTITIES.cn 兜底
  if (laneKey === 'doubao') {
    const dir = resolveDoubaoDir();
    const ready = !!dir && process.platform === 'win32';
    return {
      key: 'doubao', label: '豆包（桌面端）', cost: '会员额度',
      endpoint: '豆包桌面端（CDP 调试口 127.0.0.1:9225）',
      ready, installed: !!dir, credential: null,
      disabled: isLaneDisabled('doubao'),
      model: null,   // 工具自管理（豆包 2.1 Pro · 推理高，ask 每次自动重验），桥不设模型 id
      nickname: null, uinMasked: null, expiresAt: null, expiresInDays: null,
      templateExists: ready,
      bridgeDir: dir,
    };
  }
  const id = identityOf(laneKey);
  const s = readSession(laneKey);
  let expiresAt = null, expiresInDays = null;
  if (s?.auth?.lastRefreshTime && s?.auth?.expiresIn) {
    expiresAt = new Date(s.auth.lastRefreshTime + s.auth.expiresIn * 1000);
    expiresInDays = Math.round((expiresAt.getTime() - Date.now()) / 86400000);
  }
  return {
    key: laneKey, label: id.label, cost: id.cost, endpoint: s?.endpoint || id.endpoint,
    ready: laneReady(laneKey), disabled: isLaneDisabled(laneKey),
    nickname: s?.account?.nickname || null,
    uinMasked: s?.account?.uin ? maskUin(s.account.uin) : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expiresInDays,
    templateExists: fs.existsSync(id.templatePath),
  };
}

// ---------- lane 余额探测（wbx usage 与 UI /api/balance 共用） ----------
const LANE_BAL_CACHE = new Map();
const balNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const BAL_NA_HINT = {
  codex: 'Plus 额度以 ChatGPT 网页端 Settings→Usage 为准（无本地端点，诚实降级）',
  cline: '免费孪生无余额端点（官方未提供）',
  doubao: '会员额度无 API——余额在豆包客户端内查看',
};

/**
 * 探测 lane 余额（数据源：非官方社区 billing 端点 POST {endpoint}/billing/meter/get-user-resource，
 * 官方未公开、实测可用（internal/archive/v16/v16-balance-recon.md），可能随上游改版失效，
 * 失败一律优雅降级、绝不阻塞调用方）。模块级 TTL 缓存（默认 300000ms）仅缓存成功结果，
 * ttl 内命中直接返回且 asOf 不刷新；失败结果绝不缓存、下次调用重试；force=true 跳过读缓存
 * 但成功后照常写缓存，缓存对象绝不含 accessToken。凭证零进入：返回值绝不含 accessToken 及
 * Uin/AppId/AccountId/DealName/PackageName 等账号侧字段。remain/total 保留原始精度不做四舍五入
 * （展示层负责格式化）。绝不 throw、绝不 console 打印、绝不重试。
 */
export async function laneBalance(laneKey, { ttlMs = 300000, force = false } = {}) {
  try {
    return await laneBalanceProbe_(laneKey, { ttlMs, force });
  } catch {
    return { state: 'unavailable', hint: '探测异常', stability: 'community' };   // 兜底：任何未预期异常优雅降级
  }
}

async function laneBalanceProbe_(laneKey, { ttlMs = 300000, force = false } = {}) {
  if (laneKey !== 'ai' && laneKey !== 'cn') {
    return { state: 'na', hint: BAL_NA_HINT[laneKey] || '未知 lane，无余额端点' };
  }

  const hit = !force && LANE_BAL_CACHE.get(laneKey);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const session = readSession(laneKey);
  if (!session || !session.auth || !session.auth.accessToken) {
    return { state: 'unavailable', hint: '未登录（wbx login 后可查）', stability: 'community' };
  }

  const res = await httpJson('POST', `${session.endpoint}/billing/meter/get-user-resource`, {
    headers: { Authorization: 'Bearer ' + session.auth.accessToken, 'X-Client-Platform': 'web' },
    body: { PageNumber: 1, PageSize: 200, Status: [0, 3], OnlyValidPeriod: true },
    timeoutMs: 15000,   // 侦察实证：国际版宿主常态 8-12s（internal/archive/v16/v16-balance-recon.md），10s 边缘超时
  });

  const status = res && typeof res.status === 'number' ? res.status : 0;
  if (status !== 200) {
    return { state: 'unavailable', hint: `端点不可用（HTTP ${status}）`, stability: 'community' };
  }
  const accounts = res.json && res.json.code === 0
    ? res.json.data && res.json.data.Response && res.json.data.Response.Data && res.json.data.Response.Data.Accounts
    : null;
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { state: 'unavailable', hint: '端点返回异常', stability: 'community' };
  }

  let total = 0;
  let remain = 0;
  let unit;
  for (const a of accounts) {
    const cap = balNum(a && a.CapacitySize);
    if (!Number.isNaN(cap)) total += cap;
    let r = balNum(a && a.CycleCapacityRemain);
    if (Number.isNaN(r)) r = balNum(a && a.CapacityRemain);
    if (!Number.isNaN(r)) remain += r;
    if (unit == null && a && a.CapacityUnit) unit = a.CapacityUnit;
  }

  const value = {
    state: 'ok',
    remain,
    total,
    unit,
    asOf: new Date().toISOString(),
    stability: 'community',
    packages: accounts.length,
  };
  LANE_BAL_CACHE.set(laneKey, { at: Date.now(), value });
  return value;
}

// 默认路由（单发 ask）：config.default-lane 固定任一 lane（未禁用），否则 auto——LANE_ORDER 序
// codex 首位=质量优先档（codex ready 即默认，用户 2026-10-14 裁决「先优先调用 Codex」）；未就绪
// 顺序回落 ai→cn→cline→doubao。批量路由独立走 FANOUT_DEFAULT_POOL（见 runFanoutJob）。
export function resolveDefaultLane() {
  const pick = loadConfig()['default-lane'];
  if (parseLane(pick) && !isLaneDisabled(pick)) return pick;   // parseLane 含 doubao，固定值校验随之覆盖
  for (const k of LANE_ORDER) {
    if (!isLaneDisabled(k) && laneReady(k)) return k;
  }
  const enabled = enabledLanes();
  return enabled[0] || 'cn';
}

// 回退 lane：其余已登录且未禁用的 lane（顺序 cn→ai→cline→codex→doubao，各一次）；没有则 null。
// cline 未装/无凭证时 laneReady 为 false，天然跳过（不耗重试额度）；
// codex（Plus 额度付费档）在 cline 之后 doubao 之前——仅当免费三 lane 全不可用才被回退到达，
// 且先于会员档（免费 lane 失败不自动烧 Plus 额度，v21 D-036 公理 2）；doubao 仍排最末。
// codex 额度冷却期 laneReady=false，同样天然跳过。
//
// 【红线断言·非 DeepSeek 禁回退（用户定案）】cline lane 失败的一切路径都不得改用
// 非 DeepSeek 模型顶替：本函数只换 lane（ai/cn 的 WorkBuddy DeepSeek V4.1 Flash 仍是 DeepSeek），
// 绝不换模型 id——askOnceCline 的 -m 恒为 config cline-model 或任务显式指定的值，失败重试
// 原样保留。回归（internal/v6-regression）断言：fallbackLane('cline') ∈ {ai,cn}，
// 且 askOnceCline 失败路径无任何对 -m 的改写。跨 lane 回退（cline→ai/cn）保留。
export function fallbackLane(fromKey) {
  for (const k of FALLBACK_ORDER) {
    if (k !== fromKey && laneReady(k) && !isLaneDisabled(k)) return k;
  }
  return null;
}

export function parseLane(v) {
  const k = String(v || '').toLowerCase();
  return LANE_ORDER.includes(k) ? k : null;
}

// v1 -> v2 一次性迁移：session.json / product-config.json -> sessions/<id>.json / product/<id>.json
function migrateLegacy() {
  const oldS = fs.existsSync(OLD_SESSION_PATH);
  const oldP = fs.existsSync(OLD_PRODUCT_PATH);
  if (!oldS && !oldP) return null;
  let id = 'cn';
  try {
    if (oldS) {
      const j = JSON.parse(fs.readFileSync(OLD_SESSION_PATH, 'utf8'));
      if (String(j?.platform || '').includes('workbuddy-ai')) id = 'ai';
    } else {
      const j = JSON.parse(fs.readFileSync(OLD_PRODUCT_PATH, 'utf8'));
      const plat = String(j?.authentication?.attributes?.platform || j?.platform || '');
      if (plat.includes('workbuddy-ai')) id = 'ai';
    }
  } catch { /* 解析失败按 cn 处理，内容原样搬运 */ }
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.mkdirSync(PRODUCT_DIR, { recursive: true });
  if (oldS && !fs.existsSync(IDENTITIES[id].sessionPath)) fs.copyFileSync(OLD_SESSION_PATH, IDENTITIES[id].sessionPath);
  if (oldP && !fs.existsSync(IDENTITIES[id].productPath)) fs.copyFileSync(OLD_PRODUCT_PATH, IDENTITIES[id].productPath);
  if (oldS) fs.rmSync(OLD_SESSION_PATH, { force: true });
  if (oldP) fs.rmSync(OLD_PRODUCT_PATH, { force: true });
  return id;
}

export function migrateIfNeeded() {
  const mig = migrateLegacy();
  if (mig) console.error(`[MIGRATE] 检测到 v1 单 lane 凭证，已迁移 -> sessions/${mig}.json + product/${mig}.json（旧文件已删除）`);
  return mig;
}

// ---------- 进程与 HTTP ----------
// taskkill 若不在进程退出前等待完成，会触发 libuv 断言（win32 async.c），
// 因此所有 kill 都登记到 pendingKills，在 exit 前统一等待。
const pendingKills = new Set();
export function killTree(child) {
  if (!child) return Promise.resolve();
  const p = (async () => {
    if (process.platform === 'win32' && child.pid) {
      await new Promise((res) => {
        let done = false;
        const fin = () => { if (!done) { done = true; res(); } };
        try {
          const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          tk.on('close', fin);
          tk.on('error', fin);
          setTimeout(fin, 4000);
        } catch { fin(); }
      });
    }
    try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
  })();
  pendingKills.add(p);
  p.then(() => pendingKills.delete(p), () => pendingKills.delete(p));
  return p;
}
export async function waitKills() { await Promise.allSettled([...pendingKills]); }
export async function exitWith(code) { await waitKills(); process.exit(code); }

export function spawnNode(args, { env, timeoutMs, stdin, cwd } = {}) {
  return spawnBin(process.execPath, args, { env, timeoutMs, stdin, cwd: cwd || RUNTIME_ROOT });
}

// 通用子进程执行（cline exe 与 node 均走这里），超时用 killTree 兜底。
// spawn 可能同步抛（win32 畸形可执行 EFTYPE、Defender 干扰等）——与异步 error 事件同构降级
// code:-1，绝不向上抛（v22 修复：doctor 曾因空壳 cline exe 同步抛而崩）
export function spawnBin(bin, args, { env, timeoutMs, stdin, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { env: env || process.env, windowsHide: true, cwd: cwd || RUNTIME_ROOT });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: String(err), timedOut: false });
      return;
    }
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const KILL_GRACE_MS = 3000;   // killTree 后 close 的兜底回迁窗口（win32 孙进程继承管道时 close 永不触发）
    const timer = timeoutMs ? setTimeout(() => {
      timedOut = true; killTree(child);
      setTimeout(() => { if (!settled) { settled = true; resolve({ code: -1, stdout, stderr, timedOut }); } }, KILL_GRACE_MS);
    }, timeoutMs) : null;
    if (stdin != null) {
      // stdin 通道：超长提示词经 stdin 传入，绕过命令行长度上限（CLI -p 无位置参数时读 stdin）
      child.stdin.on('error', () => { /* EPIPE 等忽略，主进程退出码会反映失败 */ });
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      // 无 stdin 数据也必须立即 EOF——cline CLI 总会检查 stdin（支持 cat file | cline），
      // 管道不关会一直等 EOF 导致进程悬挂（Phase 0 实测：异步 spawn 不 end stdin 必挂）
      child.stdin.on('error', () => { /* EPIPE 忽略 */ });
      child.stdin.end();
    }
    // setEncoding('utf8')：多字节字符跨 chunk 边界由 Node 内部缓冲补齐（逐 chunk toString 会产出
    // U+FFFD——中文答案（本工具主场景）静默损坏，v23 评审 P1 实证）
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', (err) => {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + '\n' + String(err), timedOut });
    });
    child.on('close', (code) => {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

// 统一 HTTP 客户端（node:http/https 单实现，v22 收敛与原 httpsGetJson_ 的双实现）：undici/fetch
// 的全局连接池在 win32 上与随后的 process.exit 冲突（libuv async.c 断言、exit 127，实测最小
// 复现已固化），故桥内一切出站 JSON 请求（cline 目录 GET / 登录流 POST / 余额探测 POST）都走
// 本函数。任何失败降级 {status:0}，绝不 throw。
export async function httpJson(method, url, { headers = {}, body, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const fin = (r) => { if (!settled) { settled = true; resolve(r); } };
    let u;
    try { u = new URL(url); } catch { fin({ status: 0, json: null, text: `非法 URL：${url}` }); return; }
    let req;
    try {
      const mod = u.protocol === 'https:' ? https : http;
      req = mod.request(u, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
        agent: false,
        timeout: timeoutMs,
      }, (res) => {
        const chunks = [];
        res.on('data', (b) => chunks.push(b));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
          fin({ status: res.statusCode, json, text });
          res.destroy();
        });
        res.on('error', () => fin({ status: 0, json: null, text: '响应流错误' }));
      });
      req.on('timeout', () => { req.destroy(); fin({ status: 0, json: null, text: `timeout（> ${timeoutMs}ms）` }); });
      req.on('error', (e) => fin({ status: 0, json: null, text: String((e && e.message) || e) }));
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    } catch (e) { fin({ status: 0, json: null, text: String((e && e.message) || e) }); }
  });
}

export function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch { /* 手动打开登录 URL 即可 */ }
}

// ---------- CodeBuddy CLI 调用 ----------
function baseEnv(laneKey, extra = {}) {
  const id = identityOf(laneKey);
  const env = {
    ...process.env,
    CODEBUDDY_CONFIG_DIR: id.configDir,     // 隔离配置目录，绝不指向 ~/.workbuddy*
    CODEBUDDY_FORCE_HEADLESS_BUNDLE: '1',   // 必需：磁盘上只有 headless / lite-wb bundle
  };
  const s = readSession(id.key);
  if (s) {
    if (fs.existsSync(id.productPath)) env.ACC_PRODUCT_CONFIG_PATH = id.productPath;
    env.CODEBUDDY_AUTH_TOKEN = s.auth?.accessToken || '';
    if (s.account?.uin) env.ACC_USER_ID = String(s.account.uin);
    if (s.account?.nickname) env.ACC_USER_NICKNAME = String(s.account.nickname);
  } else if (fs.existsSync(id.productPath)) {
    env.ACC_PRODUCT_CONFIG_PATH = id.productPath;
  }
  return Object.assign(env, extra);
}

function extractJson(text) {
  const t = ansiStrip(String(text || '')).trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* 继续尝试 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 继续尝试 */ } }
  for (const line of t.split(/\r?\n/)) {
    const l = line.trim();
    if (l.startsWith('{')) { try { return JSON.parse(l); } catch { /* 下一行 */ } }
  }
  return null;
}

function normalizeResult(j) {
  if (Array.isArray(j)) {
    const r = j.filter((x) => x && typeof x === 'object' && x.type === 'result').pop();
    if (r) return r;
  }
  return j;
}

/**
 * 单次无头调用，跑在指定 lane 上。caps（任务契约字段，v19 能力矩阵，默认 ∅=别名 L0）：
 *   ∅（L0） = 纯 LLM 无工具（capsToArgs 逐字 v5：--tools '' --max-turns 1，零回退）；
 *   net,read（L1） = 联网+只读（仅 ai/cn；白名单 + default 档 + 回合上限（契约 A 三层取值），
 *         cwd=空 scratch 读边界；v10/v19 探针定案）；返回值附规范化集合串、toolTrace 与原始 transcript；
 *   含 write = 本轮未交付（探针 P3 沙箱前提破裂，spawn 前报 caps-write-disabled）。
 * maxTurns（契约 A）：任务级回合上限（整数 1-64，任何非 ∅ 能力集生效；∅ 无回合概念零影响）。
 * 返回：
 *   成功 { ok:true, text, durationMs, model, raw, caps?, toolTrace?, rawTranscript?, scratchDir? }
 *   失败 { ok:false, kind, error, durationMs, hint? }
 * kind: timeout | cli-error | unparseable | l1-turns-exhausted | result-error | auth |
 *       caps-l2-not-delivered | caps-invalid | caps-lane-mismatch | caps-write-disabled
 * v5：lane=cline 走 cline CLI（--json NDJSON）；任务级 effort 对 cline 不生效
 *（用户定案：cline 思考档一律取 config cline-thinking，不下调）。
 * v13：lane=doubao 走 askOnceDoubao（豆包桌面端工作任务模式）；任务级 effort/model 对 doubao
 * 不生效（工具自管理豆包 2.1 Pro + 推理高）。
 * v21：lane=codex 走 askOnceCodex（Codex CLI exec 非交互）；任务级 model 不生效（恒取 config
 * codex-model——Plus 额度保护），任务级 effort low/medium/high 直通映射推理档。
 * v24：context（上下文预算）由调度层经 resolveModelPolicy 解析后传入（--autocompact 条件拼装；
 * 任务级无此键，config effort/context/night-* 缺省全在策略单点，本函数只忠实下发）。
 */
export async function askOnce({ lane, prompt, model, effort, context = null, timeoutMs = 300000, caps = 'L0', scratchDir = null, maxTurns = null }) {
  if (lane === 'cline') return askOnceCline({ prompt, model, timeoutMs, caps });
  if (lane === 'doubao') return askOnceDoubao({ prompt, model, timeoutMs, caps });   // 分流在 caps 校验之前（对齐 cline 先例），caps 契约由 askOnceDoubao 内部执行
  if (lane === 'codex') return askOnceCodex({ prompt, effort, timeoutMs, caps });    // 分流在 caps 校验之前（对齐 cline/doubao 先例），caps 契约由 askOnceCodex 内部执行
  const parsed = parseCapsSet(caps);
  if (!parsed.ok) {
    return capsReject_(parsed, caps);
  }
  const writeBlocked = capsRejectWrite_(parsed);
  if (writeBlocked) return writeBlocked;   // write 门（本轮 STOP）：含 write 集合 spawn 前显式报错
  const capsSet = parsed.set;
  const hasCaps = capsSet.length > 0;
  if (!IDENTITIES[lane]) return { ok: false, kind: 'unknown-lane', error: `未知 lane ${lane}（上游 parseLane 校验漏网；支持 ${LANE_ORDER.join('/')}）`, combined: '' };
  const laneKey = lane;
  // 超长提示词（>STDIN_THRESHOLD）改走 stdin 通道（-p 不带位置参数），短提示词保持位置参数路径
  const useStdin = prompt.length > STDIN_THRESHOLD;
  const mdl = resolveModel(model);
  // caps 旗标唯一组合点（capsToArgs）：∅ 逐字 v5 L0 序列；非 ∅ 白名单+档位+回合上限
  const capsArgs = capsToArgs(capsSet, { maxTurns });
  const args = [
    resolveCliPath(), '-p',
    ...(useStdin ? [] : [prompt]),
    '--model', mdl,
    ...capsArgs,
  ];
  if (effort) args.push('--effort', effort);
  if (context) args.push('--autocompact', context);   // v24：上下文预算（策略单点解析；stdin 路径同参共用本数组）

  // 非 ∅ 能力集工作目录 = 空 scratch（读边界：cwd 外绝对路径读取被审批拒绝（v10 P2c+P4））；
  // ∅（L0）同样用专用空目录——spawnBin 缺省 cwd=RUNTIME_ROOT（sessions/product 凭证所在），
  // --tools 白名单一旦上游回归即凭证暴露（v23 评审 P1）
  const scratch = hasCaps ? (scratchDir || ensureScratch('l1-' + stamp())) : ensureL0Cwd();

  const t0 = Date.now();
  const r = await spawnNode(args, { env: baseEnv(laneKey), timeoutMs, stdin: useStdin ? prompt : null, cwd: scratch || undefined });
  const durationMs = Date.now() - t0;
  const stdout = ansiStrip(r.stdout || '');
  const stderr = ansiStrip(r.stderr || '');
  const combined = stdout + '\n' + stderr;

  if (r.timedOut) {
    return { ok: false, kind: 'timeout', error: `执行超时（> ${Math.round(timeoutMs / 1000)}s）`, durationMs, combined };
  }
  // 契约 B：auth 判定只认结构化信号（CLI 进程退出码非零 + stderr 中 CLI 自身错误行）——
  // worker 输出/材料回显的凭证类字样（stdout 或 transcript 中的 "Authentication required"/
  // "Unauthorized" 等）一律免疫（E-005 桥侧同源修复：job 20260925-115826-idp 成功输出复述样例
  // 原文被误判凭证过期，ai/cn 双 lane 均误杀）。
  if (r.code !== 0 && isAuthError(stderr)) {
    return { ok: false, kind: 'auth', error: '未登录或凭证已过期（Authentication required）', durationMs, hint: 'login', combined };
  }

  const parsedFull = extractJson(stdout);
  const j = normalizeResult(parsedFull);
  if (!j) {
    // 非 ∅ 能力集回合上限耗尽的 CLI 形态（exit 0、stdout 无 JSON、stderr 尾部 "Max turns (N) exceeded"）
    // 专类可读错误，不落入 unparseable 静默形态。仅非 ∅ 分类（∅ 无回合概念，不贴能力标签）。
    const mtExhausted = hasCaps ? /Max turns \((\d+)\) exceeded/i.exec(stderr || '') : null;
    if (mtExhausted) {
      return {
        ok: false, kind: 'l1-turns-exhausted',
        error: `能力任务回合上限耗尽（Max turns (${mtExhausted[1]}) exceeded）：任务需要更多工具轮次。可在任务加 "maxTurns"（1-64）或调 config caps-l1-max-turns；${Math.round(timeoutMs / 1000)}s 超时仍为硬兜底（先到为准）`,
        durationMs, hint: 'l1-turns-exhausted', combined,
      };
    }
    // unparseable/cli-error 的诊断 brief 改首尾各半（横幅常驻头部、真实错误多在尾部），
    // 完整 combined 随失败结果返回，由编排器落盘（成功路径零变化）
    return {
      ok: false,
      kind: r.code === 0 ? 'unparseable' : 'cli-error',
      error: errorBrief(combined) || `exit=${r.code}，无输出`,
      durationMs,
      hint: isRateLimit(combined) ? 'ratelimit' : undefined,
      combined,
    };
  }

  const isErr = j.is_error === true || j.type === 'error' ||
    (typeof j.subtype === 'string' && j.subtype.startsWith('error'));
  if (isErr) {
    const msg = String(j.result ?? j.error ?? j.message ?? JSON.stringify(j).slice(0, 300));
    return { ok: false, kind: 'result-error', error: brief(msg), durationMs, hint: isRateLimit(msg) ? 'ratelimit' : undefined, combined };
  }

  let text = j.result ?? j.text ?? j.content ?? j.message;
  if (typeof text !== 'string') text = JSON.stringify(text, null, 2);
  if (text === undefined || text === null) text = JSON.stringify(j, null, 2);
  // 非 ∅ 能力集附加：规范化集合串 + 工具轨迹摘要（function_call 事件计数+参数截断）+ 原始 transcript（落盘回放）
  if (hasCaps) {
    return {
      ok: true, text, durationMs, model: j.model || mdl, raw: j,
      caps: parsed.normalized, toolTrace: extractToolTrace(parsedFull), rawTranscript: stdout, scratchDir: scratch,
    };
  }
  return { ok: true, text, durationMs, model: j.model || mdl, raw: j };
}

// ---------- cline lane：NDJSON 解析 + 一次性调用 ----------
// parseClineNdjson —— 解析 cline --json 的 stdout 全文（纯函数，零依赖，任何输入不抛异常）。
// 初稿由 wbx fanout 外包产出（job 20260925-120106-jh7），ZCode 审查修订后集成。
// 正文不变量：text = 流内全部 text 内容块按序拼接，且与 run_result.text 至少同尾——上游
// 输出上限压缩续写后 run_result.text 只含末次 iteration 正文（实测 job 20261003-171054-6tl：
// 4074 恰为末块，全块拼接 5789 为完整答案）。落盘完整性的唯一出口在解析层，ask 返回值/
// fanout 任务记录/UI 历史共用此结果。
function makeEmptyClineResult() {
  return { events: 0, text: null, finishReason: null, model: null, durationMs: null, error: null, hasRunResult: false };
}
function isPlainObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function asNonEmptyString_(value) { return typeof value === 'string' && value.trim() !== '' ? value : null; }
function asFiniteNumber_(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

export function parseClineNdjson(text) {
  const out = makeEmptyClineResult();
  if (typeof text !== 'string' || text.length === 0) return out;
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;  // 去 BOM
  const blocks = [];   // contentType==="text" 内容块（跨 iteration 按流序；压缩续写时答案分属多块）
  let open = null;     // 未闭合块：流中断无 content_end 时靠该块增量兜底
  let doneText = null;
  let lastRunResult = null;
  let firstErrorMessage = null;
  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = typeof rawLine === 'string' ? rawLine.trim() : '';
    if (line === '') continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }   // 非 JSON 行（横幅/日志）忽略
    if (!isPlainObject_(parsed)) continue;
    out.events += 1;
    if (parsed.type === 'run_result') { lastRunResult = parsed; out.hasRunResult = true; continue; }
    if (parsed.type === 'agent_event' && isPlainObject_(parsed.event)) {
      if (parsed.event.type === 'error') {
        const msg = asNonEmptyString_(parsed.event.error?.message);
        if (msg !== null && firstErrorMessage === null) firstErrorMessage = msg;   // 多处错误取首个
      }
      // 正文只认 contentType==="text" 内容块：content_end 携带该块全文（单一权威事件）；
      // content_start 为流式增量，仅在流中断缺 content_end 时兜底（全量收集，纯空白增量也保）。
      // done.text 与末块全文重复，不并入拼接（仅作无块无 run_result 时的末位兜底）。
      if (parsed.event.type === 'content_start' && parsed.event.contentType === 'text') {
        if (open === null) { open = { deltas: [], endText: null }; blocks.push(open); }
        if (typeof parsed.event.text === 'string') open.deltas.push(parsed.event.text);
      } else if (parsed.event.type === 'content_end' && parsed.event.contentType === 'text') {
        if (open === null) { open = { deltas: [], endText: null }; blocks.push(open); }
        open.endText = typeof parsed.event.text === 'string' ? parsed.event.text : null;
        open = null;
      } else if (parsed.event.type === 'done' && typeof parsed.event.text === 'string' && parsed.event.text !== '') {
        doneText = parsed.event.text;
      }
      continue;
    }
    // 兼容顶层 type:"error" 形态（实测出现在 stderr，stdout 理论上不出现）
    if (parsed.type === 'error') {
      const msg = asNonEmptyString_(parsed.message) || asNonEmptyString_(parsed.event?.error?.message);
      if (msg !== null && firstErrorMessage === null) firstErrorMessage = msg;
    }
  }
  if (lastRunResult !== null) {
    out.text = asNonEmptyString_(lastRunResult.text);
    out.finishReason = asNonEmptyString_(lastRunResult.finishReason);
    out.model = isPlainObject_(lastRunResult.model) ? asNonEmptyString_(lastRunResult.model.id) : null;
    out.durationMs = asFiniteNumber_(lastRunResult.durationMs);
  }
  // 正文裁决（第一性：事件流是单次完整的事实源，run_result.text 是上游摘要字段）：后缀关系
  // 成立取更全者——正常单块流两者相等 → 零变化；压缩续写流全块拼接以 run_result.text 结尾 →
  // 取全块。无后缀关系（上游形态变化、流与摘要分歧）以 run_result.text 为权威，不臆造。
  // run_result 缺席/无正文时按 流拼接 → done.text 兜底。
  const streamText = blocks.map((b) => (b.endText !== null ? b.endText : b.deltas.join(''))).join('');
  if (out.text !== null && streamText !== '') {
    if (streamText.length >= out.text.length && streamText.endsWith(out.text)) out.text = streamText;
  } else if (out.text === null) {
    if (streamText !== '') out.text = streamText;
    else if (doneText !== null) out.text = doneText;
  }
  if (firstErrorMessage !== null) out.error = firstErrorMessage;
  else if (lastRunResult !== null && out.finishReason === 'error') out.error = asNonEmptyString_(lastRunResult.text);
  return out;
}

/**
 * cline lane 一次性纯文本调用。
 * 命令行：cline --json -P <provider> [-m <model>] --auto-approve false
 *         --thinking <config> --compaction <config> -t <秒> -c <空 workdir> "<提示词>"
 * 隔离：USERPROFILE/HOME 覆盖（见 clineSpawnEnv），不用 --data-dir（实测 3.0.65 会破坏认证加载）。
 * 禁用 --zen 与 --yolo（后者开启其 agentic 形态，v5 范围外）。
 * 提示词 >12000 字符走 stdin 通道（pipe 提示词全文 + 短位置参数指令，Phase 0 实测可用）。
 * 注意：cline 参数解析要求提示词至少含一个 ASCII 空格（实测无空格的短中文会被当未知子命令拒绝）。
 */
export async function askOnceCline({ prompt, model = null, timeoutMs = 300000, caps = 'L0' }) {
  // caps 契约（v19 能力矩阵，capsGate 单点）：cline 不承载任何非 ∅ 能力集，明确报错绝不静默降档
  const gated = capsGate('cline', caps);
  if (gated) return gated;
  const bin = resolveClinePath();
  if (!bin) {
    return { ok: false, kind: 'cli-error', error: 'cline 未安装（可选 lane）。安装：npm install -g cline，然后 wbx login --identity cline', durationMs: 0, hint: 'not-installed' };
  }
  const cfg = loadConfig();
  const provider = cfg['cline-provider'] || 'cline';
  const mdl = model || cfg['cline-model'] || '';
  const useStdin = prompt.length > STDIN_THRESHOLD;
  // cline 参数解析要求提示词至少含一个 ASCII 空格（实测无空格的短中文会被当未知子命令拒绝）；
  // 无空格时前缀一个空格规避（实测可行，不影响模型收到的内容）
  const positional = useStdin
    ? 'Complete the task described in the piped stdin content. Treat it as your full instructions, including all output constraints.'
    : (/\s/.test(prompt) ? prompt : ` ${prompt}`);
  const args = [
    '--json',
    '-P', provider,
    ...(mdl ? ['-m', mdl] : []),
    '--auto-approve', 'false',        // 非 TTY 下工具调用全拒 -> 纯文本端点
    '--thinking', cfg['cline-thinking'],
    '--compaction', cfg['cline-compaction'],
    '-t', String(Math.max(30, Math.ceil(timeoutMs / 1000))),   // CLI 侧超时（桥侧 timeoutMs 仍兜底）
    '-c', CLINE_WORK_DIR,             // 空工作目录（无工具执行，仅满足 -c 语义）
    positional,
  ];

  const t0 = Date.now();
  const r = await spawnBin(bin, args, { env: clineSpawnEnv(), timeoutMs: timeoutMs + SPAWN_GRACE_MS, stdin: useStdin ? prompt : null, cwd: CLINE_WORK_DIR });
  const durationMs = Date.now() - t0;
  const stdout = ansiStrip(r.stdout || '');
  const stderr = ansiStrip(r.stderr || '');
  const parsed = parseClineNdjson(stdout);
  const rawStream = stdout;   // 原始 NDJSON 全文，供 job 目录落盘回放
  const combined = stdout + '\n' + stderr;   // 失败 attempt 全量输出（随失败结果返回，编排器落盘）

  if (r.timedOut) {
    return { ok: false, kind: 'timeout', error: `执行超时（> ${Math.round(timeoutMs / 1000)}s，桥侧兜底 kill）`, durationMs, rawStream, combined };
  }
  if (r.code === -1 && !parsed.events) {
    return { ok: false, kind: 'cli-error', error: `cline 进程启动/执行失败：${brief(stderr || '无输出')}`, durationMs, rawStream, hint: 'not-installed', combined };
  }
  // 契约 B：parsed.error 是 cline NDJSON 结构化错误事件（CLI 自身信号，保留）；
  // combined 回显检查改为「退出码非零 + stderr」结构化判定，对 stdout 事件流中的材料回显免疫
  if (isAuthError(parsed.error || '') || (r.code !== 0 && isAuthError(stderr))) {
    return { ok: false, kind: 'auth', error: 'cline 凭证无效或未登录（Unauthorized）', durationMs, rawStream, hint: 'login', combined };
  }
  const failed = r.code !== 0 || parsed.error !== null || parsed.finishReason === 'error' || parsed.text === null;
  if (failed) {
    const msg = parsed.error || parsed.text || brief(stderr || combined) || `exit=${r.code}，无输出`;
    // 超额状态机：免费档错误优先于通用限流识别；跨 lane 回退语义不变
    //（runAskJob/runFanoutJob 照旧可回退 ai/cn——同为 DeepSeek，符合用户定案）。
    let hint;
    let resetIn = null;
    if (isFreeLimitError(msg)) { hint = 'free-limit'; resetIn = extractFreeLimitResetIn(msg); }
    else if (isFreePromotionEndedError(msg)) hint = 'free-promotion-ended';
    else if (isModelNotFoundError(msg)) hint = 'model-not-found';
    else if (isRateLimit(msg)) hint = 'ratelimit';
    return {
      ok: false,
      kind: r.code === 0 && parsed.hasRunResult ? 'result-error' : 'cli-error',
      error: brief(msg),
      durationMs, rawStream, combined,
      hint, ...(resetIn ? { resetIn } : {}),
    };
  }
  return {
    ok: true, text: parsed.text,
    durationMs: durationMs,
    model: parsed.model || mdl || `${provider}(默认)`,
    raw: { finishReason: parsed.finishReason, events: parsed.events },
    rawStream,
  };
}

/**
 * cline lane OAuth 登录：spawn `cline auth <provider>`（隔离 env 生效，凭证落桥目录）。
 * stdio=inherit：设备码与授权 URL 直接显示给用户，用户在浏览器完成 OAuth（桥不代输任何凭证）。
 * 注意：不用 --data-dir（实测 3.0.65 auth 子命令对其处理不一致）。
 * 返回 { exitCode, ok }；ok = 凭证已落盘（只查存在性）。
 */
export async function runClineAuth() {
  const bin = resolveClinePath();
  if (!bin) throw new Error('cline 未安装。安装：npm install -g cline（平台二进制），再运行 wbx login --identity cline');
  fs.mkdirSync(clineHomeDir(), { recursive: true });
  const provider = loadConfig()['cline-provider'] || 'cline';
  const child = spawn(bin, ['auth', provider], {
    stdio: 'inherit', windowsHide: false, env: clineSpawnEnv(),
  });
  const exitCode = await new Promise((res) => {
    child.on('close', (c) => res(c ?? -1));
    child.on('error', () => res(-1));
  });
  return { exitCode, ok: clineHasCredential() };
}

// ---------- cline 模型自愈（桥自治；config cline-auto-heal 默认 true） ----------
// 边界（用户 2026-10-08 定案）：本函数只做「配置修复」——配置 id 被免费组轮换下线
//（失败分类 hint=model-not-found 且经 recommended-models 实时清单确认确实不在免费组）时，
// 自动切换免费组首个可用 id 并写回 config，由调用方在派发链内重投一次；再失败照旧回退 ai/cn。
// 「失败回退只投 ai/cn、绝不换非 DeepSeek 顶替」定案继续有效——它约束失败回退语义，
// 不约束配置修复（免费组当前可含非 DeepSeek 孪生，修复结果如实标注 cline-model-healed）。
// Daily limit（配额耗尽）绝不触发换模型。任何前置不满足返回 null（不写 config、不抛异常）。
// usedModel：本次实际使用的模型 id（任务级显式 model 优先）。仅当显式 model 为空或恰为 config 值
// 才自愈——失败来自任务级指定模型时不属配置失配，绝不改写 config。
// 单飞锁：并发 cline 任务共享同一次修复（清单只取一次、config 只写一次、日志只说一次）。
let clineHealFlight_ = null;
export async function healClineModelIfNeeded(failRes, { log = () => {}, usedModel = null } = {}) {
  if (loadConfig()['cline-auto-heal'] === false) return null;
  if (!failRes || failRes.hint !== 'model-not-found') return null;
  const cur = loadConfig()['cline-model'] || CLINE_FREE_DEFAULT_MODEL;
  if (usedModel != null && usedModel !== cur) return null;   // 失败来自任务级显式模型：非配置失配，不改写 config
  if (clineHealFlight_) return clineHealFlight_;
  clineHealFlight_ = (async () => {
    const fm = await fetchClineFreeModels();
    if (!fm.ok || !Array.isArray(fm.models) || !fm.models.length) return null;   // 清单不可用：无从修复，交回退链
    const curNow = loadConfig()['cline-model'] || CLINE_FREE_DEFAULT_MODEL;
    if (fm.models.some((m) => m.id === curNow)) return null;   // 配置 id 仍在免费组：失败另有原因，不属本函数职责
    const next = fm.models[0].id;
    await setConfig('cline-model', next);
    log(`cline auto-heal：配置模型 ${curNow} 已被免费组轮换下线，自动切换 -> ${next}（已写回 config，链内重投一次）`);
    return { from: curNow, to: next };
  })().finally(() => { clineHealFlight_ = null; });
  return clineHealFlight_;
}

// ---------- doubao lane：末行 JSON 解析 + 一次性调用 ----------
/**
 * parseDoubaoPayload —— 纯函数：doubao.mjs 所有命令都以 stdout 末行单行 JSON 收口（emit()）。
 * 从全部 stdout 中取最后一个可解析为 JSON 对象的非空行（正常情况就是末行；失败/混杂场景
 * 向前兜底扫描），找不到或全非对象则返回 null。任何输入不抛异常，便于门禁直测。
 */
export function parseDoubaoPayload(stdoutText) {
  if (typeof stdoutText !== 'string' || !stdoutText.trim()) return null;
  const lines = stdoutText.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const j = JSON.parse(line);
      if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    } catch { /* 非 JSON 行（横幅/日志/半截输出），继续向前找 */ }
  }
  return null;
}

/**
 * doubao lane 一次性纯文本调用（第四 lane；会员额度，免费优先序最末；授权与额度口径见 CHANGELOG 6.6.0）。
 * 命令行：node <doubao.mjs> ask "<提示词>" | --file <临时文件> --timeout-ms <桥侧超时>
 * 桥侧零凭证：登录态在豆包客户端 GUI 内自理；客户端未以调试口 9225 运行时 doubao.mjs
 * exit 3 快速失败（秒退）——v6.8 起 cdpDown 失败按 config doubao-autostart（默认开）经
 * ensureDoubao 自动拉起/重启一次并重投（结果带 autostart 标注）；off 时保持现状秒退回退。
 * >STDIN_THRESHOLD 字符走 --file 临时文件（同
 * ai/cn/cline 的 stdin 阈值语义，绕过 Windows 命令行长度上限），用完即删。任务级 model/effort
 * 对 doubao 不生效（工具自管理豆包 2.1 Pro + 推理高，ask 每次发送前自动重验配置），model 参数仅保持签名兼容。
 * caps：仅 L0；L1/L2 明确报错（caps-lane-mismatch——豆包桌面 agent 不受桥控、无法承诺
 * L1 只读语义，对齐 cline 先例），绝不静默降档。
 * 成功 → { ok:true, text, model:modelAtSend, durationMs, raw }；
 * 失败 → kind=timeout|cli-error + fix-hint（hint=doubao-launch 指向 launch.ps1 与 doctor）。
 */
export async function askOnceDoubao({ prompt, model = null, timeoutMs = 300000, caps = 'L0' }) {
  void model; // 任务级 --model 对 doubao 不生效（工具自管理 2.1 Pro + 推理高；help/文档如实注明）
  const gated = capsGate('doubao', caps);
  if (gated) return gated;
  const dir = resolveDoubaoDir();
  if (!dir) {
    return { ok: false, kind: 'cli-error', error: '豆包桥 doubao.mjs 未找到（可选 lane）。修复：在桥源码仓跑 wbx self-install（把 tools/doubao-bridge/ 复制到全局副本）', durationMs: 0, hint: 'not-installed' };
  }
  const useFile = prompt.length > STDIN_THRESHOLD;
  let tmpFile = null;
  const args = [path.join(dir, 'doubao.mjs'), 'ask', '--timeout-ms', String(timeoutMs)];
  if (useFile) {
    tmpFile = path.join(RUNTIME_ROOT, `doubao-ask-${stamp()}-${Math.random().toString(36).slice(2, 6)}.txt`);
    try {
      fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
      fs.writeFileSync(tmpFile, prompt, 'utf8');
    } catch (e) {
      return { ok: false, kind: 'cli-error', error: `超长提示词临时文件写入失败：${e?.message || e}`, durationMs: 0 };
    }
    args.push('--file', tmpFile);
  } else {
    args.push(prompt);
  }

  // 单次派发（成功路径仅此一次执行；自动拉起后的重投只发生在 CDP 不可达失败之后）
  const runOnce = async () => {
    const t0 = Date.now();
    const r = await spawnBin(process.execPath, args, { timeoutMs: timeoutMs + SPAWN_GRACE_MS });
    const stdout = ansiStrip(r.stdout || '');
    const stderr = ansiStrip(r.stderr || '');
    return {
      r, stdout, stderr,
      payload: parseDoubaoPayload(stdout),
      durationMs: Date.now() - t0,
      combined: stdout + '\n' + stderr,   // 失败 attempt 全量输出（随失败结果返回，编排器落盘）
    };
  };
  const classify = (a) => {
    if (a.r.timedOut) {
      return { ok: false, kind: 'timeout', error: `执行超时（> ${Math.round(timeoutMs / 1000)}s，桥侧兜底 kill）`, durationMs: a.durationMs, combined: a.combined };
    }
    if (a.r.code !== 0 || !a.payload || a.payload.ok !== true || typeof a.payload.text !== 'string') {
      const reason = a.payload && a.payload.reason ? String(a.payload.reason) : (brief(a.stderr || a.combined) || `exit=${a.r.code}，无输出`);
      // 调试口不可达（客户端未以调试口 9225 运行，doubao.mjs exit 3）：fix-hint 指向 launch.ps1 与 doctor
      const cdpDown = a.r.code === 3 || /CDP 不可达/i.test(reason);
      return {
        ok: false,
        kind: 'cli-error',
        error: cdpDown ? `豆包客户端调试口不可达（${reason}）` : reason,
        durationMs: a.durationMs, combined: a.combined,
        hint: cdpDown ? 'doubao-launch' : undefined,
        cdpDown,
      };
    }
    return {
      ok: true, text: a.payload.text, durationMs: a.durationMs,
      model: typeof a.payload.modelAtSend === 'string' && a.payload.modelAtSend ? a.payload.modelAtSend : '豆包 2.1 Pro',
      raw: a.payload,
    };
  };

  let res = classify(await runOnce());
  // 桥自治：CDP 不可达时按 doubao-autostart（默认开）自动拉起/重启一次并重投。
  // 成功路径零触碰豆包（ensure 只在本失败分支进入）；off 时与现状完全一致（快速失败回退）。
  if (!res.ok && res.cdpDown && loadConfig()['doubao-autostart'] !== false) {
    const firstCombined = res.combined;   // 首次 CDP 不可达 attempt 全量输出（重投失败时随结果落盘，排查不失真）
    const ens = await ensureDoubao();
    if (ens.ok) {
      res = classify(await runOnce());
      res.autostart = ens.action;        // launched|restarted|online（任务成功与仍失败都如实标注）
      if (!res.ok && res.combined) res.combined = `${res.combined}\n[首次 attempt·CDP 不可达]\n${firstCombined}`;
    } else {
      res.autostart = ens.action;        // failed | unavailable（原样保留，不压扁语义）
      if (ens.detail) res.error = `${res.error}；${ens.detail}`;
    }
  }
  delete res.cdpDown;
  if (tmpFile) { try { fs.rmSync(tmpFile, { force: true }); } catch { /* 清理失败不影响主流程 */ } }
  return res;
}

/**
 * codex lane 一次性纯文本调用（第五 lane；ChatGPT Plus 质量优先档，额度有限须保护）。
 * 命令行：codex exec --ephemeral --ignore-user-config --skip-git-repo-check --color never
 *         -s read-only -m <config codex-model> -c model_reasoning_effort=<档> --json -o <tmp> [- | prompt]
 * 隔离：CODEX_HOME=<运行时根>/codex-home（auth.json 经 login 复制收割；除该单文件外 ~/.codex 零读取）。
 * 模型恒取 config codex-model（任务级 model 不生效——Plus 额度保护+护栏单点）；任务级 effort
 * low/medium/high 直通映射推理档，其余（含 null）用 config codex-reasoning。
 * 提示词 >STDIN_THRESHOLD 字符走 stdin（`-` 位置参数），与 cline 先例同阈值语义。
 * 收割（关键不变量）：**进程退出码绝不参与成功/失败判定**（实测失败路径退出码不可信）——
 * -o 文件全文为最终权威正文；JSONL 只供 error/完整性判定（turn.failed/error 事件=
 * 失败；无 turn.completed 且无 -o 正文=失败）。JSONL 全文随 rawStream 返回供 job 落盘回放。
 * caps：仅 ∅；非空能力集明确报 caps-lane-mismatch（codex exec 沙箱与工具面不受桥控，
 * 无法承诺只读语义，对齐 cline/doubao 先例），绝不静默降档。
 * 额度：stdout+stderr+JSONL error 三处扫描（markCodexQuota）——命中写冷却状态并按
 * hint=codex-quota 失败返回（auto 路由/回退链随即跳过 codex；显式点名放行语义由调用侧承接）。
 */
export async function askOnceCodex({ prompt, effort = null, timeoutMs = 300000, caps = 'L0' }) {
  const gated = capsGate('codex', caps);
  if (gated) return gated;
  const bin = resolveCodexPath();
  if (!bin) {
    return { ok: false, kind: 'cli-error', error: 'codex 未安装（可选 lane）。修复：安装/更新 Codex 桌面版（捆绑 CLI），或 wbx config set codex-path "<codex.exe 完整路径>"', durationMs: 0, hint: 'not-installed' };
  }
  const cfg = loadConfig();
  let mdl;
  try {
    mdl = validateCodexModel(cfg['codex-model']);
  } catch (err) {
    return { ok: false, kind: 'cli-error', error: err.message, durationMs: 0, hint: 'codex-model-floor' };
  }
  const eff = effort === 'low' || effort === 'medium' || effort === 'high' ? effort : (cfg['codex-reasoning'] || 'medium');
  const useStdin = prompt.length > STDIN_THRESHOLD;
  const outFile = path.join(RUNTIME_ROOT, `codex-last-${stamp()}-${Math.random().toString(36).slice(2, 6)}.txt`);
  try { fs.mkdirSync(CODEX_WORK_DIR, { recursive: true }); } catch { /* 已存在/竞态 */ }
  const args = ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--color', 'never', '-s', 'read-only', '-m', mdl, '-c', `model_reasoning_effort=${eff}`, '--json', '-o', outFile];
  if (useStdin) args.push('-'); else args.push(prompt);

  const t0 = Date.now();
  let r;
  try {
    r = await spawnBin(bin, args, { env: codexSpawnEnv(), timeoutMs: timeoutMs + SPAWN_GRACE_MS, stdin: useStdin ? prompt : null, cwd: CODEX_WORK_DIR });
  } catch (err) {
    try { fs.rmSync(outFile, { force: true }); } catch { /* 容错 */ }
    return { ok: false, kind: 'cli-error', error: `codex 进程启动失败：${brief(String((err && err.message) || err))}`, durationMs: Date.now() - t0, hint: 'spawn-failed' };
  }
  const durationMs = Date.now() - t0;
  const stdout = ansiStrip(r.stdout || '');
  const stderr = ansiStrip(r.stderr || '');
  const parsed = parseCodexJsonl(stdout);
  // -o 文件：读成功即权威（全文为最终正文；读失败 → null 走 parsed.text 回退）。用完即删。
  let outText = null;
  try {
    outText = fs.readFileSync(outFile, 'utf8');
  } catch { outText = null; }
  finally {
    try { fs.rmSync(outFile, { force: true }); } catch { /* best-effort */ }
  }
  const combined = stdout + '\n' + stderr;   // 失败 attempt 全量输出（随失败结果返回，编排器落盘）

  // 额度检测先于超时判定（T8-B 理由：配额耗尽的调用不该被误判为「只是慢」而继续消耗额度）
  // 额度检测先于超时判定（T8-B：配额耗尽不该被误判为「只是慢」）。面分域（v23 评审 P0）：
  // stdout 只扫强特征——stdout 含模型正文，弱信号（rate limit|429）会把「正文引用 429」的成功输出误判冷却。
  const quota = markCodexQuota(stderr) || markCodexQuota(parsed.error || '') || markCodexQuota(stdout, { re: CODEX_QUOTA_STRONG_RE });
  if (quota) {
    return {
      ok: false, kind: 'cli-error',
      error: `ChatGPT Plus 额度耗尽（冷却至 ${new Date(quota.until).toISOString()}，约 ${quota.remainingMin} 分钟）——auto 路由/回退/批量池将跳过 codex；显式点名仍会放行`,
      durationMs, hint: 'codex-quota', rawStream: stdout, combined,
    };
  }
  if (r.timedOut) {
    return { ok: false, kind: 'timeout', error: `执行超时（> ${Math.round(timeoutMs / 1000)}s，桥侧兜底 kill）`, durationMs, rawStream: stdout, combined };
  }
  if (isAuthError(stderr) || (parsed.error && /未登录|401/i.test(parsed.error))) {
    return { ok: false, kind: 'auth', error: 'codex 凭证无效或未登录（隔离 CODEX_HOME 无有效 auth.json）——重新收割：wbx login --identity codex（一次性只读复制 ~/.codex/auth.json）', durationMs, rawStream: stdout, hint: 'login', combined };
  }
  // 收割不变量：退出码绝不进判定。半截流（有 item.completed 无 turn.completed）仅在 -o 有正文时判成功。
  // -o 读成功但为空串（T7#1）：不构成权威正文，回退 parsed.text（两者皆空才判失败）。
  const outHasBody = typeof outText === 'string' && outText.trim() !== '';
  const text = outHasBody ? outText : (parsed.text || '');
  const failed = parsed.error !== null || (!parsed.hasTurnCompleted && !outHasBody) || !text.trim();
  if (failed) {
    let msg;
    if (parsed.error !== null) msg = parsed.error;
    else if (!parsed.hasTurnCompleted && !outHasBody) msg = `codex 事件流不完整（无 turn.completed 且 -o 无正文，events=${parsed.events}）`;
    else msg = `codex 无有效正文（events=${parsed.events}）`;
    const detail = brief(stderr || '') || brief(stdout || '');
    if (detail) msg = `${msg}：${detail}`;
    return { ok: false, kind: 'cli-error', error: brief(msg), durationMs, hint: parsed.error !== null ? 'codex-error' : 'incomplete-stream', rawStream: stdout, combined };
  }
  return {
    ok: true, text, durationMs, model: mdl,
    raw: { hasTurnCompleted: parsed.hasTurnCompleted, events: parsed.events },
    rawStream: stdout,
  };
}

// ---------- 统一 job 模型（ask/fanout 都落盘，可回放） ----------
export function newJobId() {
  return stamp() + '-' + Math.random().toString(36).slice(2, 5);
}

export async function createJob(type, params, { lanes = [], tasksInput = null, jobId = null } = {}) {
  ensureDirs();
  const id = jobId || newJobId();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`非法 jobId：${id}`);
  const dir = path.join(JOBS_DIR, id);
  if (fs.existsSync(dir)) throw new Error(`jobId 已存在：${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id, type, createdAt: new Date().toISOString(),
    status: 'running',
    params, lanes,
    config: loadConfig(),
    runtimeRoot: RUNTIME_ROOT,
    stats: { total: 0, ok: 0, failed: 0, durationMs: null },
  };
  await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (tasksInput) await fsp.writeFile(path.join(dir, 'tasks-input.json'), JSON.stringify(tasksInput, null, 2), 'utf8');
  return { id, dir, manifest };
}

export async function writeTaskRecord(jobDir, rec) {
  await fsp.writeFile(path.join(jobDir, `${sanitizeId(rec.id)}.json`), JSON.stringify(rec, null, 2), 'utf8');
}

// 失败 attempt 完整输出落盘 + 错误消息尾部文件指针（观测盲区修复——brief 头部
// 截断之外的全量留档，history 回放可定位；成功路径零新增落盘）。无进程输出（caps 拒绝、
// 未安装等）不落盘、不加指针。
async function dumpFailedAttempt(jobDir, taskId, attemptN, res) {
  const combined = res?.combined;
  if (typeof combined !== 'string') return;
  const file = path.join(jobDir, `${sanitizeId(taskId)}.attempt${attemptN}.output.txt`);
  try {
    await fsp.writeFile(file, combined, 'utf8');
  } catch (e) {
    // 诊断落盘绝不影响主流程（T7 建议#2）：写失败仅告警，不追加指针、不抛出
    console.error(`[WARN] 失败输出落盘失败（${e?.message || e}）：${file}`);
    return;
  }
  res.error = `${res.error || ''}（完整输出已存 ${file}）`;
}

export async function finalizeJob(jobDir, { total, ok, durationMs }) {
  const mp = path.join(jobDir, 'manifest.json');
  let manifest = {};
  try { manifest = JSON.parse(await fsp.readFile(mp, 'utf8')); } catch { /* 补写 */ }
  manifest.status = 'done';
  manifest.finishedAt = new Date().toISOString();
  manifest.stats = { total, ok, failed: total - ok, durationMs };
  await fsp.writeFile(mp, JSON.stringify(manifest, null, 2), 'utf8');
}

const RECORD_FILES = new Set(['manifest.json', 'tasks-input.json', 'summary.md']);
// L1 附件（原始 transcript）不是任务记录，统计/读取时排除
const isTaskRecordFile = (name) => name.endsWith('.json') && !RECORD_FILES.has(name) && !name.endsWith('.transcript.json');

export async function readJobRecords(jobDir) {
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(jobDir); } catch { return out; }
  for (const e of entries) {
    if (!isTaskRecordFile(e)) continue;
    try { out.push({ file: e, rec: JSON.parse(await fsp.readFile(path.join(jobDir, e), 'utf8')) }); }
    catch { /* 跳过坏文件 */ }
  }
  return out;
}

function jobIdToDate(id) {
  const m = /^(\d{8})-(\d{2})(\d{2})(\d{2})/.exec(id);
  if (!m) return null;
  return new Date(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6, 8), +m[2], +m[3], +m[4]);
}

export function summarizeJob(id, dir, { legacy = false } = {}) {
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* 旧格式无 manifest */ }
  const type = manifest?.type || 'fanout';
  const hasInput = fs.existsSync(path.join(dir, 'tasks-input.json'));
  const recs = [];
  try {
    for (const e of fs.readdirSync(dir)) {
      if (!isTaskRecordFile(e)) continue;
      try { recs.push(JSON.parse(fs.readFileSync(path.join(dir, e), 'utf8'))); } catch { /* 坏文件跳过 */ }
    }
  } catch { /* 目录不可读 */ }
  const ok = recs.filter((r) => r.status === 'success').length;
  const laneDist = {};
  for (const r of recs) {
    const lane = r.fallbackFrom ? `${r.fallbackFrom}->${r.lane}` : r.lane;
    laneDist[lane || '?'] = (laneDist[lane || '?'] || 0) + 1;
  }
  const when = jobIdToDate(id) || (manifest?.createdAt ? new Date(manifest.createdAt) : null);
  return {
    id, dir, legacy, type,
    createdAt: when ? when.toISOString() : null,
    status: manifest?.status || (recs.length ? 'done' : '?'),
    total: recs.length || (hasInput ? null : 0),
    ok, successRate: recs.length ? Math.round((ok / recs.length) * 100) : null,
    laneDist,
    durationMs: manifest?.stats?.durationMs ?? null,
  };
}

// job 目录三根枚举（新 jobs + 两个 legacy 只读根）单源：listJobs 共用，seen 去重防双计
function* jobRoots() {
  const seen = new Set();
  for (const root of [JOBS_DIR, LEGACY_TASKS_DIR, LEGACY_JOBS_DIR]) {
    if (!root || seen.has(root) || !fs.existsSync(root)) continue;
    seen.add(root);
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    for (const e of entries) {
      const dir = path.join(root, e);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
      yield { key: e, dir, legacy: root !== JOBS_DIR };
    }
  }
}

// job 列表：jobs/*（新）+ 项目 .wbx/tasks/*（v2 旧）+ 项目 .wbx/jobs/*（项目形态时期，只读兼容）
export function listJobs() {
  const rows = [];
  for (const { key, dir, legacy } of jobRoots()) {
    rows.push(summarizeJob(key, dir, { legacy }));
  }
  rows.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  return rows;
}

export async function getJob(jobId) {
  // 安全：jobId 只允许 [A-Za-z0-9-_]，防路径穿越
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return null;
  const candidates = [path.join(JOBS_DIR, jobId), path.join(LEGACY_TASKS_DIR, jobId), path.join(LEGACY_JOBS_DIR, jobId)];
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const summary = summarizeJob(jobId, dir, { legacy: !dir.startsWith(JOBS_DIR) });
    let manifest = null, tasksInput = null, summaryMd = null;
    try { manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8')); } catch { /* 旧格式 */ }
    try { tasksInput = JSON.parse(await fsp.readFile(path.join(dir, 'tasks-input.json'), 'utf8')); } catch { /* 无输入文件 */ }
    try { summaryMd = await fsp.readFile(path.join(dir, 'summary.md'), 'utf8'); } catch { /* 无汇总 */ }
    const recs = await readJobRecords(dir);
    const recById = new Map(recs.map((r) => [r.rec.id, r.rec]));
    const tasks = (Array.isArray(tasksInput) ? tasksInput : []).map((t) => ({
      id: t.id ?? 'task',
      prompt: t.prompt ?? '',
      record: recById.get(t.id) || null,
    }));
    // 孤儿记录（输入里没有但落了盘的任务）
    for (const { rec } of recs) {
      if (!tasks.some((t) => t.id === rec.id)) tasks.push({ id: rec.id, prompt: null, record: rec });
    }
    return { ...summary, manifest, summaryMd, tasks };
  }
  return null;
}

// ---------- 汇总 markdown ----------
export function buildSummaryMd({ type, tasks, results, totalMs, laneKeys, laneParallel, timeoutS, retry, jobId }) {
  const okCount = results.filter((r) => r.status === 'success').length;
  const rl = results.filter((r) => isRateLimit(r.error)).length;
  const lines = [];
  lines.push(`# WBX ${type} 汇总`, '');
  lines.push(`- job：${jobId}`);
  lines.push(`- 时间：${new Date().toLocaleString('zh-CN')}`);
  if (type === 'fanout') {
    lines.push(`- 任务数：${tasks.length}；lanes：${laneKeys.join(',')}；每 lane 并发：${laneParallel}（总并发 ${laneParallel * laneKeys.length}）；单任务超时：${timeoutS != null ? `${timeoutS}s（显式）` : 'auto（∅=300s / 能力任务=600s）'}；重试：${retry}（+跨 lane 回退 1 次）`);
  }
  lines.push(`- 结果：成功 ${okCount} / 失败 ${tasks.length - okCount}（成功率 ${(okCount / tasks.length * 100).toFixed(0)}%）`);
  lines.push(`- 总耗时：${fmtMs(totalMs)}`, '');
  lines.push('| id | lane | caps | 状态 | 耗时 | 尝试 | 模型 | 思考 | 上下文 |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const lane = r.fallbackFrom ? `${r.fallbackFrom}→${r.lane}` : r.lane;
    lines.push(`| ${r.id} | ${lane} | ${r.caps || 'L0'} | ${r.status === 'success' ? '✅' : '❌'} ${r.status} | ${fmtMs(r.durationMs)} | ${r.attempts} | ${r.model} | ${r.effort || '—'} | ${r.context || '—'} |`);
  }
  const failed = results.filter((r) => r.status !== 'success');
  if (failed.length) {
    lines.push('', '## 失败详情', '');
    for (const f of failed) lines.push(`### ${f.id}`, '```', brief(f.error, 500), '```', '');
  }
  if (rl) lines.push(`> ⚠️ 检测到 ${rl} 个疑似限流/配额失败 → 建议降并发（--parallel 2）稍后重跑失败任务。`);
  return lines.join('\n');
}

// ---------- 高层执行器：ask / fanout（job 落盘 + 回退链，CLI 与 UI 共用） ----------
/**
 * 单 lane 派发核（runAskJob 链与 fanout runTask 共用，v22 收敛两份重复的 attempt/heal 编排）：
 * retryN 次重试（限流 5s/其余 2s 间隔，失败逐次落盘 dump）→ cline 自愈（heal 命中后以 config 模型
 * 重投一次）。call(model) 由调用方构造（model=null → 桥按 config 解析）；healNote 用于重投前的
 * 人读日志；dump(res) 的落盘编号由调用方注入（跨 lane 连续，不在此计数）。
 * 返回 { res, attempts, healed }——跨 lane 回退决策留给调用方（两流程回退语义不同）。
 */
async function runAttempts({ lane, call, dump, say, retryN = 0, usedModel = null, tag = '', healNote = null }) {
  let res = null, attempts = 0, healed = null;
  for (let a = 0; a <= retryN; a++) {
    attempts = a + 1;
    res = await call(usedModel);
    if (res.ok) return { res, attempts, healed };
    const rl = res.hint === 'ratelimit' || isRateLimit(res.error);   // 限流判定先于落盘（注释与实现一致化，v23 评审 P3）
    await dump(res);
    if (a < retryN) {
      say(`${tag}失败（${res.kind}），${rl ? '5s' : '2s'} 后重试 ${a + 1}/${retryN}`);
      await sleep(rl ? 5000 : 2000);
    }
  }
  if (lane === 'cline') {
    healed = await healClineModelIfNeeded(res, { log: say, usedModel });
    if (healed) {
      attempts++;
      if (healNote) say(healNote(healed.to));
      res = await call(null);   // model:null -> 用已 heal 的 config 值
      if (!res.ok) await dump(res);
    }
  }
  return { res, attempts, healed };
}
/**
 * runAskJob：单条 ask，含回退链与 job 落盘。返回：
 *   { ok, jobId, jobDir, lane, fallbackFrom, model, durationMs, text|error, kind }
 */
export async function runAskJob({ prompt, as = null, model = null, effort = null, timeoutS = null, jobId = null, caps = null, maxTurns = null, ephemeral = false }) {
  ensureDirs();
  const cfg = loadConfig();
  // caps 契约（v19 能力矩阵）：不合法 / L2 未交付 / 含 write 未交付 / 能力×lane 不匹配 -> 明确报错，
  // 绝不静默降档或改路。∅（别名 L0）= 纯文本零回退；L1≡net,read 预设别名。
  const parsed = parseCapsSet(caps || cfg['default-caps'] || 'L0');
  if (!parsed.ok) {
    throw new Error(parsed.kind === 'caps-l2-not-delivered' ? L2_NOT_DELIVERED_MSG : `caps 只支持能力集（net/read/write 逗号组合）或别名 L0 | L1（收到 ${caps}）`);
  }
  const capsSet = parsed.set;
  const capsNorm = parsed.normalized;
  if (capsSet.includes('write')) throw new Error(`caps：${CAPS_WRITE_DISABLED_MSG}`);
  // 契约 A：任务级 maxTurns（整数 1-64；任何非 ∅ 能力集生效——∅ 无回合概念，同 caps 契约风格明确报错）
  const mt = parseMaxTurns(maxTurns, 'ask');
  if (mt != null && !capsSet.length) {
    throw new Error(`maxTurns 仅在含能力的 caps 生效（当前 caps=∅；L0 无回合概念）`);
  }
  let primary = as ? parseLane(as) : null;
  if (as && !primary) throw new Error(`--as 只支持 ${LANE_ORDER.join(' | ')}（收到 ${as}）`);
  if (!as) primary = resolveDefaultLane();
  if (isLaneDisabled(primary)) {
    throw new Error(`lane ${primary} 已被 disabled-lanes 硬禁用。启用：wbx config set disabled-lanes []`);
  }
  if (capsSet.length && (primary === 'cline' || primary === 'doubao' || primary === 'codex')) {
    throw new Error(`caps ${capsNorm} 与 lane ${primary} 不匹配：能力任务仅支持 ai | cn（codebuddy --tools 白名单承载）。请显式 --as ai 或 --as cn`);
  }
  const fb = fallbackLane(primary);
  let chain = fb && fb !== primary ? [primary, fb] : [primary];
  if (capsSet.length) {
    // 能力任务回退链只在 ai/cn 之间（同能力跨 lane 回退语义不变；cline/doubao 不承载能力）
    chain = chain.filter((k) => k === 'ai' || k === 'cn');
    if (!chain.length) throw new Error(`caps ${capsNorm} 无可用 lane：需要 ai/cn 至少一个可用且未禁用`);
  }
  // 超时单点决策：显式 --timeout 最高优先；缺省非 ∅ 600s / ∅ 300s（ask 与 fanout 同源 resolveCapsTimeoutS）
  const effTimeoutS = resolveCapsTimeoutS(timeoutS, capsSet);

  // 持久化边界单点（v23 包 A）：ephemeral=真实执行零调度留痕——job=null 让下游全部落盘点自然跳过
  //（不建 job 目录/manifest/任务记录/summary/attempt dump；回退/重试/超时/caps 逻辑原样复用，
  // 绝不另起平行执行路径）。L1 任务仍需 scratch 工作目录（读边界机制前提），以 eph- 前缀命名。
  const job = ephemeral ? null : await createJob('ask', { promptPreview: brief(prompt, 120), as: as || 'auto', model: resolveModel(model), effort, timeoutS: effTimeoutS, ...(capsSet.length ? { caps: capsNorm } : {}), ...(['ai', 'cn'].includes(primary) ? { policy: ((p) => ({ model: p.model, effort: p.effort || null, context: p.context || null, windowActive: !!p.window.active }))(resolveModelPolicy(primary, { model, effort })) } : {}) }, { lanes: chain, tasksInput: [{ id: 'ask', prompt, ...(capsSet.length ? { caps: capsNorm } : {}), ...(mt != null ? { maxTurns: mt } : {}) }], jobId });
  const capsScratch = capsSet.length ? ensureScratch(job ? 'job-' + job.id : 'eph-ask-' + stamp()) : null;

  // 显式点名 codex 且额度冷却中：放行但打 WARN（auto 路由不会解析到冷却中的 codex——laneReady=false）
  if (chain.includes('codex')) {
    const qs = codexQuotaState();
    if (qs.active) console.error(`[WARN] codex 额度冷却中（剩余约 ${qs.remainingMin}m，${qs.reason || 'usage limit'}）——显式点名放行，失败将按回退链改投`);
  }
  // 夜间免费档 stderr 一行（D-5 ②）：链含 cn 才相关；消费 nightWindowState 单对象，每次投递现算
  if (chain.includes('cn')) console.error(nightWindowLine());

  const jobT0 = Date.now();
  let usedLane = null, res = null, resLane = null, attempts = 0, clineHeal = null;
  let attemptSeq = 0;   // 全局尝试序号：跨回退 lane 连续（attempt 落盘编号与 rec.attempts 同源）
  let lastPolicy = null;   // 最近一次投递的策略解析（ai/cn 才有值；成功 attempt 即实际下发面）
  for (const lane of chain) {
    const run = await runAttempts({
      lane,
      call: (m) => {
        // 回退链换 lane 按新 lane 重解析（D-4）；每次投递现算，不缓存窗口判定（W2 反模式）。
        // 非 ai/cn（cline/doubao/codex）策略返回 null——走既有单点原样透传，绝不改道。
        const pol = resolveModelPolicy(lane, { model: m, effort }, new Date());
        if (!pol) return askOnce({ lane, prompt, model: m, effort, timeoutMs: effTimeoutS * 1000, caps: capsNorm || 'L0', scratchDir: capsScratch, maxTurns: mt });
        lastPolicy = pol;
        return askOnce({ lane, prompt, model: pol.model, effort: pol.effort, context: pol.context, timeoutMs: effTimeoutS * 1000, caps: capsNorm || 'L0', scratchDir: capsScratch, maxTurns: mt });
      },
      dump: job ? (r) => dumpFailedAttempt(job.dir, 'ask', ++attemptSeq, r) : async () => {},
      say: (msg) => console.error(msg),
      usedModel: model,
      healNote: (to) => `cline auto-heal -> ${to}，重投一次`,
    });
    attempts += run.attempts;
    if (run.healed) clineHeal = run.healed;
    res = run.res;
    resLane = lane;
    if (res.ok) { usedLane = lane; break; }
    if (lane !== primary) break;
    if (fb) console.error(`[WARN] lane ${lane} 失败（kind=${res.kind}），自动改投 lane ${fb}…`);
  }
  // 策略快照（D-5 ④）：实际下发面 model/effort/context + 窗口态（ai/cn 专属；其余 lane 走既有单点）
  const recPolicy = lastPolicy ? { model: lastPolicy.model, effort: lastPolicy.effort || null, context: lastPolicy.context || null, windowActive: !!lastPolicy.window.active } : null;
  const rec = {
    id: 'ask',
    lane: res?.ok ? usedLane : primary,
    status: res?.ok ? 'success' : 'failed',
    attempts,
    durationMs: res?.durationMs ?? 0,
    model: res?.ok ? res.model : (lastPolicy?.model ?? resolveModel(model)),
    effort: lastPolicy ? (lastPolicy.effort || null) : (effort || null),   // 实际下发面（策略 lane）；其余 lane 保持任务级语义
    caps: capsNorm || 'L0',
  };
  if (recPolicy) {
    rec.policy = recPolicy;
    if (recPolicy.context) rec.context = recPolicy.context;
  }
  if (clineHeal && usedLane === 'cline') rec['cline-model-healed'] = `${clineHeal.from}→${clineHeal.to}`;   // 结果 meta：旧→新（仅 heal 重投真正产出结果时标注）
  if (res?.autostart) rec['doubao-autostart'] = res.autostart;                     // 结果 meta：launched|restarted|online|failed
  if (res?.ok) rec.result = res.text; else { rec.error = `${res?.kind}: ${res?.error || ''}`; if (res?.hint) rec.hint = res.hint; if (res?.resetIn) rec.resetIn = res.resetIn; }
  if (res?.ok && res.toolTrace) rec.toolTrace = res.toolTrace;   // L1 工具轨迹摘要（工具名+次数+参数截断）
  if (job && res?.rawStream) {
    // 流式 lane（cline/codex）原始事件流全文落盘，供回放与解析器迭代；文件名按产出 lane 泛化（cline 字节兼容）
    await fsp.writeFile(path.join(job.dir, `ask.${resLane || usedLane || primary}-stream.jsonl`), res.rawStream, 'utf8');
  }
  if (job && res?.rawTranscript) {
    // L1 原始 transcript 落盘（联网内容不可冻结复现，轨迹全文留档供回放核对）
    await fsp.writeFile(path.join(job.dir, 'ask.transcript.json'), res.rawTranscript, 'utf8');
  }
  if (job) {
    await writeTaskRecord(job.dir, rec);
    await finalizeJob(job.dir, { total: 1, ok: res?.ok ? 1 : 0, durationMs: Date.now() - jobT0 });
    const md = buildSummaryMd({ type: 'ask', tasks: [{ id: 'ask' }], results: [rec], totalMs: Date.now() - jobT0, jobId: job.id });
    await fsp.writeFile(path.join(job.dir, 'summary.md'), md, 'utf8');
  }

  if (res?.ok) {
    return { ok: true, jobId: job ? job.id : null, jobDir: job ? job.dir : null, lane: usedLane, fallbackFrom: usedLane !== primary ? primary : null, model: res.model, durationMs: res.durationMs, text: res.text, caps: capsNorm || 'L0', ...(res.toolTrace ? { toolTrace: res.toolTrace } : {}), ...((clineHeal && usedLane === 'cline') ? { clineModelHealed: clineHeal } : {}) };
  }
  return { ok: false, jobId: job ? job.id : null, jobDir: job ? job.dir : null, lane: primary, kind: res?.kind, error: res?.error, hint: res?.hint, caps: capsNorm || 'L0', ...(res?.resetIn ? { resetIn: res.resetIn } : {}) };
}

/**
 * runFanoutJob：批量并发（缺省池 ai/cn/cline/doubao，codex 点名才投 + 重试 + 跨 lane 回退 + job 落盘）。
 * tasksIn: [{id, prompt, as?, model?, effort?}]；返回 { jobId, jobDir, okCount, total, results }。
 */
export async function runFanoutJob({ tasksIn, lanes = null, parallel = null, timeoutS = null, retry = null, log = null, jobId = null, ephemeral = false }) {
  ensureDirs();
  const cfg = loadConfig();
  const say = log || (() => {});

  let laneKeys;
  if (lanes && lanes.length) {
    laneKeys = [...new Set(lanes)];   // 去重：重复 lane 会起双倍 worker 击穿并发上限（v23 评审 P2）
    for (const k of laneKeys) {
      const parsedLane = parseLane(k);
      if (!parsedLane) throw new Error(`lanes 只支持 ${LANE_ORDER.join(',')}（收到 ${k}）`);
    }
    laneKeys = laneKeys.map((k) => parseLane(k));
  } else {
    // 路由三分（v21 D-036）：批量缺省池=FANOUT_DEFAULT_POOL（免费+会员档，不含 codex——Plus 额度
    // 保护，付费档不是批量回退目标）；任务级 as 点名的 lane 并入调度池（调度池=缺省池∪点名 lane，
    // 含显式 as:"codex"——冷却中照样并入，runTask 派发时打 WARN 放行）。
    laneKeys = FANOUT_DEFAULT_POOL.filter((k) => laneReady(k) && !isLaneDisabled(k));
    const named = [...new Set(tasksIn.map((t) => (t && t.as ? parseLane(t.as) : null)).filter(Boolean))];
    for (const k of named) if (!laneKeys.includes(k)) laneKeys.push(k);
    if (!laneKeys.length) {
      laneKeys = enabledLanes();
      say(`[WARN] 没有任何已登录且未禁用的 lane，退回 ${laneKeys.join(',')}（任务会认证失败；请先 wbx login）`);
    }
  }
  const disabledHit = laneKeys.filter((k) => isLaneDisabled(k));
  if (disabledHit.length) throw new Error(`lane ${disabledHit.join(',')} 已被 disabled-lanes 硬禁用。启用：wbx config set disabled-lanes []`);

  // 夜间免费档 stderr 一行（D-5 ②）：批含 cn 才相关；批次级窗口快照入 manifest（逐任务策略在任务记录）
  if (laneKeys.includes('cn')) say(nightWindowLine());
  const nwSnap = nightWindowState();

  const seen = new Set();
  // 缺省能力集：config default-caps（别名/集合串均合法；'L2' 值合法但语义=每任务声明即报未交付）
  const defaultCapsRaw = String(cfg['default-caps'] || 'L0');
  const defaultParsed = parseCapsSet(defaultCapsRaw);
  const defaultCapsNorm = defaultParsed.ok ? (defaultParsed.normalized || 'L0') : (defaultParsed.kind === 'caps-l2-not-delivered' ? 'L2' : 'L0');
  const defaultCapsSet = defaultParsed.ok ? defaultParsed.set : [];
  const tasks = [];
  for (let i = 0; i < tasksIn.length; i++) {
    const t = tasksIn[i] || {};
    if (!t.prompt || !String(t.prompt).trim()) throw new Error(`任务 ${i}（${t.id ?? '?'}）缺少 prompt`);
    // readDirs 本轮未交付（STOP，探针 P4：--add-dir 在 headless 不授权读——信任边界不可证）：
    // 任务字段声明即显式报错，绝不静默忽略
    if (t.readDirs != null) {
      throw new Error(`任务 ${i}（${t.id ?? '?'}）：readDirs 本轮未交付（探针 P4 证据与勘误见 RESEARCH-V19 §六/§4.5）。声明即报错、绝不静默忽略；受控目录读取随交付轮评估`);
    }
    let id = sanitizeId(t.id ?? `task-${i + 1}`);
    while (seen.has(id)) id = id + '-2';
    seen.add(id);
    let lane = null;
    if (t.as != null) {
      lane = parseLane(t.as);
      if (!lane) throw new Error(`任务 ${t.id} 的 as 只支持 ${LANE_ORDER.join('|')}`);
    }
    // caps 契约（v19 能力矩阵）：任务级 "caps" 字段（能力集或别名）；缺省继承 config default-caps；
    // 不合法 / L2 未交付 / 含 write 未交付 / 能力×cline/doubao 不匹配 -> 明确报错（绝不静默降档、绝不自动改路）
    let taskParsed = null;
    if (t.caps != null) {
      taskParsed = parseCapsSet(t.caps);
      if (!taskParsed.ok) {
        throw new Error(taskParsed.kind === 'caps-l2-not-delivered'
          ? `任务 ${t.id ?? id}：${L2_NOT_DELIVERED_MSG}`
          : `任务 ${t.id ?? id} 的 caps 只支持能力集（net/read/write 逗号组合）或别名 L0 | L1（收到 ${JSON.stringify(t.caps)}）`);
      }
    }
    const effSet = taskParsed ? taskParsed.set : defaultCapsSet;
    const effNorm = taskParsed ? (taskParsed.normalized || 'L0') : defaultCapsNorm;
    // 缺省继承路径同门（T7 B2）：config default-caps='L2' 或含 write 时，继承任务在校验层显式报错
    //（不退化到执行层兜底；报错层级与 v6.8 的 effCaps==='L2' job 级快速失败对齐）
    if (effNorm === 'L2') throw new Error(`任务 ${t.id ?? id}：${L2_NOT_DELIVERED_MSG}`);
    if (effSet.includes('write')) throw new Error(`任务 ${t.id ?? id} 的 caps：${CAPS_WRITE_DISABLED_MSG}`);
    // 契约 A：任务级 maxTurns（整数 1-64；任何非 ∅ 能力集生效——∅ 无回合概念，明确报错）
    const taskMaxTurns = parseMaxTurns(t.maxTurns, `任务 ${t.id ?? id}`);
    if (taskMaxTurns != null && !effSet.length) {
      throw new Error(`任务 ${t.id ?? id} 的 maxTurns 仅在含能力的 caps 生效（当前 caps=∅；L0 无回合概念）`);
    }
    if (effSet.length) {
      if (lane === 'cline' || lane === 'doubao' || lane === 'codex') throw new Error(`任务 ${t.id ?? id}：caps ${effNorm} 与 lane ${lane} 不匹配——能力任务仅支持 ai | cn（--as ai / --as cn）`);
      if (!lane) {
        // 能力任务不进公共队列（可能落到 cline/doubao worker）：显式钉到可用的 ai/cn
        const dl = resolveDefaultLane();
        lane = (dl === 'ai' || dl === 'cn') ? dl : 'ai';
      }
      // 钉 lane 不在执行池：createJob 之前报错（校验后置会留下永久 running 的幽灵 job，v23 评审 P2）
      if (!laneKeys.includes(lane)) throw new Error(`任务 ${t.id ?? id}：caps ${effNorm} 需要可用且未禁用的 ai/cn lane（lane ${lane} 不在本次执行 lanes [${laneKeys.join(',')}] 内）。修复：--lanes 纳入 ${lane}，或任务改 --as`);
    }
    // filesMode 任务契约：reference=材料播种（含 read 的 worker 自读），缺省 inline=既有拼装（字节兼容）。
    // reference 强制任务级 caps 显式声明且含 read（D-009 演进：L1 别名天然含 read；∅ 无工具无法自读——
    // 缺省/继承/不含 read 均显式报错，绝不静默降档）。
    let filesMode = null;
    if (t.filesMode != null && t.filesMode !== 'inline') {
      if (t.filesMode !== 'reference') throw new Error(`任务 ${t.id ?? id} 的 filesMode 只支持 "inline" | "reference"（收到 ${JSON.stringify(t.filesMode)}）`);
      if (!taskParsed || !taskParsed.set.includes('read')) throw new Error(`任务 ${t.id ?? id}：filesMode:"reference" 需要任务级显式声明含 read 的能力集（如 "caps":"net,read" 或 "L1"；∅ 无工具无法自读，绝不静默降档；缺省或继承 config 均不接受）`);
      if (!Array.isArray(t.files) || !t.files.length) throw new Error(`任务 ${t.id ?? id}：filesMode:"reference" 需要非空 files 数组`);
      for (const f of t.files) {
        if (!f || typeof f.rel !== 'string' || typeof f.abs !== 'string') throw new Error(`任务 ${t.id ?? id}：reference files 元素需为 {rel, abs}（CLI 侧已解析；收到 ${JSON.stringify(f).slice(0, 80)}）`);
        if (path.isAbsolute(f.rel) || String(f.rel).split(/[\\/]+/).includes('..')) throw new Error(`任务 ${t.id ?? id}：reference rel 路径必须相对且不得越界（收到 ${f.rel}）`);
      }
      filesMode = 'reference';
    }
    tasks.push({ id, prompt: String(t.prompt), lane, model: t.model || null, effort: t.effort || null, caps: taskParsed ? (taskParsed.normalized || 'L0') : null, effCaps: effNorm, effSet, ...(filesMode ? { filesMode, files: t.files } : {}), ...(taskMaxTurns != null ? { maxTurns: taskMaxTurns } : {}) });
  }

  const laneParallel = Math.max(1, parallel ?? cfg['parallel-per-lane'] ?? 2);
  // cline 并发单独受 cline-parallel 约束（默认 1，免费额度保护；--parallel 不抬升它）；
  // doubao 并发单独受 doubao-parallel 约束（默认 1 上限 2，单客户端 UI 串行保护）；
  // codex 并发单独受 codex-parallel 约束（默认 1，Plus 单账号 5h 滚动窗口额度保护）
  const laneParallelOf = (lane) => (lane === 'cline'
    ? Math.max(1, cfg['cline-parallel'] || 1)
    : lane === 'doubao' ? Math.max(1, Math.min(2, cfg['doubao-parallel'] || 1))
    : lane === 'codex' ? Math.max(1, cfg['codex-parallel'] || 1) : laneParallel);
  // 超时单点：显式 --timeout 最高优先；缺省由 runTask 按每任务能力集解析（∅=300s / 非 ∅=600s）。
  // manifest/汇总如实展示两态（修掉 v6.8「展示 300 实跑 600」的观测说谎——一号调研 job 实证）。
  const timeoutDisplay = timeoutS != null ? `${timeoutS}s（显式）` : 'auto（∅=300s / 能力任务=600s）';
  const retryN = Math.max(0, retry ?? 1);

  // 持久化边界单点（v23 包 A）：ephemeral=真实执行零调度留痕——job=null 让下游全部落盘点自然跳过
  //（调度/回退/重试/播种逻辑原样复用，绝不另起平行执行路径）。L1 scratch 以 eph-<run>-<task> 命名防并发碰撞。
  const ephTag = stamp();
  const job = ephemeral ? null : await createJob('fanout',
    { lanes: laneKeys, parallel: laneParallel, timeoutS: timeoutS ?? null, timeoutPolicy: timeoutS != null ? 'explicit' : 'auto', retry: retryN, count: tasks.length, nightWindow: { inWindow: nwSnap.inWindow, active: nwSnap.active, expired: nwSnap.expired, remainingMin: nwSnap.remainingMin } },
    { lanes: laneKeys, tasksInput: tasks, jobId });

  say(`开始：${tasks.length} 个任务，lanes ${laneKeys.join(',')}，每 lane 并发 ${laneKeys.map((k) => `${k}=${laneParallelOf(k)}`).join(' ')}，超时 ${timeoutDisplay}，重试 ${retryN}`);

  const sharedQueue = [];
  const laneBuckets = new Map(laneKeys.map((k) => [k, []]));
  tasks.forEach((task, i) => {
    task.index = i;
    if (task.lane && laneKeys.includes(task.lane)) laneBuckets.get(task.lane).push(task);
    else {
      // 能力任务钉 lane 不在执行池已在任务校验层报错；此处只余非能力绑定 lane 未启用的回退
      if (task.lane) say(`${task.id} 绑定 lane ${task.lane} 未启用，改投公共队列`);
      sharedQueue.push(task);
    }
  });

  const results = new Array(tasks.length);
  const t0 = Date.now();

  async function runTask(task, lane) {
    const started = Date.now();
    // 到达 codex worker 的任务必为点名（缺省池不含 codex）；冷却中放行但打 WARN
    if (lane === 'codex') {
      const qs = codexQuotaState();
      if (qs.active) say(`${task.id}@codex 额度冷却中（剩余约 ${qs.remainingMin}m）——显式点名放行`);
    }
    const mdl = task.model; // 传给 askOnce 的显式模型（null -> core 按配置解析）
    // 超时单点决策（resolveCapsTimeoutS）：显式 --timeout 最高优先；缺省按任务能力集 ∅=300s / 非 ∅=600s
    const taskTimeoutMs = resolveCapsTimeoutS(timeoutS, task.effSet) * 1000;
    // 非 ∅ 能力集任务级独立 scratch（读边界）；ephemeral 时以 eph-<run>-<task> 命名（不挂 job id）
    const capsScratch = task.effSet.length ? ensureScratch(job ? `job-${job.id}-${task.id}` : `eph-${ephTag}-${task.id}`) : null;
    // 材料播种：reference 任务把 files 复制进 scratch（保持相对路径结构，rel 已在任务校验防越界），
    // 提示词材料区只有清单+路径——worker 用 Read 工具自行读取（重试复用同一 scratch，不重复播种判断）
    let seededFiles = null;
    let seedError = null;
    if (task.filesMode === 'reference' && capsScratch && !task._seeded) {
      seededFiles = [];
      try {
        for (const f of task.files) {
          const dest = path.join(capsScratch, f.rel);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(f.abs, dest);
          seededFiles.push(f.rel);
        }
      } catch (e) {
        seedError = `材料播种失败：${e?.message || e}`;
        seededFiles = null;
      }
      if (!seedError) {
        task._seeded = true;   // 全部成功才置位（半份材料绝不静默复用）
        say(`${task.id} 材料播种 -> scratch（${seededFiles.length} 个文件）`);
      }
    }
    if (seedError) {
      // 播种失败=任务级失败：无材料投递无意义，不重试不回退，如实落盘
      const rec = {
        id: task.id, lane, status: 'failed', attempts: 0,
        durationMs: Date.now() - started,
        model: resolveModel(task.model), effort: task.effort || null,
        caps: task.effCaps, error: seedError,
        ...(task.filesMode === 'reference' ? { filesMode: 'reference' } : {}),
      };
      results[task.index] = rec;
      if (job) await writeTaskRecord(job.dir, rec);
      say(`${task.id}@${lane} -> failed（${seedError}）`);
      return;
    }
    let attemptSeq = 0;   // 全局尝试序号：跨重试/自愈/回退连续（attempt 落盘编号与 rec.attempts 同源）
    let recPol = null;   // 最终投递 lane 的策略解析（ai/cn 才有值；每次投递现算，不缓存）
    const run = await runAttempts({
      lane,
      call: (m) => {
        const pol = resolveModelPolicy(lane, { model: m, effort: task.effort }, new Date());
        if (!pol) return askOnce({ lane, prompt: task.prompt, model: m, effort: task.effort, timeoutMs: taskTimeoutMs, caps: task.effCaps, scratchDir: capsScratch, maxTurns: task.maxTurns ?? null });
        recPol = pol;
        return askOnce({ lane, prompt: task.prompt, model: pol.model, effort: pol.effort, context: pol.context, timeoutMs: taskTimeoutMs, caps: task.effCaps, scratchDir: capsScratch, maxTurns: task.maxTurns ?? null });
      },
      dump: job ? (r) => dumpFailedAttempt(job.dir, task.id, ++attemptSeq, r) : async () => {},
      say,
      retryN,
      usedModel: mdl,
      tag: `${task.id}@${lane} `,
      healNote: (to) => `${task.id}@cline auto-heal -> ${to}，重投一次`,
    });
    let res = run.res, attempts = run.attempts, clineHeal = run.healed;   // attempts=真实尝试次数（dump 计数只作落盘编号——末次成功时旧算法少计 1，v23 评审 P1）
    let usedLane = lane, fallbackFrom = null;
    if (!res.ok) {
      // L1 跨 lane 回退只在 ai/cn 之间（cline/doubao 不承载 L1，不得进入回退目标）
      let fb = fallbackLane(lane);
      if (task.effSet.length && fb !== 'ai' && fb !== 'cn') fb = null;
      if (fb) {
        attempts = run.attempts + 1;
        say(`${task.id}@${lane} 用尽重试（${res.kind}），跨 lane 回退 -> ${fb}`);
        const polFb = resolveModelPolicy(fb, { model: mdl, effort: task.effort }, new Date());   // 回退链换 lane 按新 lane 重解析（D-4；非 ai/cn 返回 null 走既有单点）
        recPol = polFb;
        res = await askOnce({ lane: fb, prompt: task.prompt, model: polFb ? polFb.model : mdl, effort: polFb ? polFb.effort : task.effort, context: polFb ? polFb.context : null, timeoutMs: taskTimeoutMs, caps: task.effCaps, scratchDir: capsScratch, maxTurns: task.maxTurns ?? null });
        if (!res.ok && job) await dumpFailedAttempt(job.dir, task.id, attempts, res);   // 回退 attempt 同样落盘
        if (res.ok) { usedLane = fb; fallbackFrom = lane; }
      }
    }
    const rec = {
      id: task.id,
      lane: usedLane,
      ...(fallbackFrom ? { fallbackFrom } : {}),
      status: res.ok ? 'success' : 'failed',
      attempts,
      durationMs: Date.now() - started,
      model: res.ok ? res.model : (recPol?.model ?? resolveModel(mdl)),
      effort: recPol ? (recPol.effort || null) : (task.effort || null),   // 实际下发面（策略 lane）；其余 lane 保持任务级语义
      caps: task.effCaps,
    };
    if (recPol) {
      rec.policy = { model: recPol.model, effort: recPol.effort || null, context: recPol.context || null, windowActive: !!recPol.window.active };   // 策略快照（D-5 ④）
      if (recPol.context) rec.context = recPol.context;
    }
    if (clineHeal && usedLane === 'cline') rec['cline-model-healed'] = `${clineHeal.from}→${clineHeal.to}`;   // 结果 meta：旧→新（仅 heal 重投真正产出结果时标注）
    if (res.autostart) rec['doubao-autostart'] = res.autostart;                      // 结果 meta：launched|restarted|online|failed
    if (task.filesMode === 'reference') { rec.filesMode = 'reference'; rec.seededFiles = seededFiles; }   // scratch 播种快照记入 job
    if (res.ok) rec.result = res.text;
    else rec.error = `${res.kind}: ${res.error || ''}`;
    if (res.ok && res.toolTrace) rec.toolTrace = res.toolTrace;   // L1 工具轨迹摘要
    if (job && res.rawStream) {
      // 流式 lane（cline/codex）：原始事件流全文落盘，供回放与解析器迭代；文件名按产出 lane 泛化（cline 字节兼容）
      await fsp.writeFile(path.join(job.dir, `${sanitizeId(task.id)}.${usedLane}-stream.jsonl`), res.rawStream, 'utf8');
    }
    if (job && res.rawTranscript) {
      // L1：codebuddy transcript 全文落盘（联网内容不可冻结复现，轨迹留档供回放核对）
      await fsp.writeFile(path.join(job.dir, `${sanitizeId(task.id)}.transcript.json`), res.rawTranscript, 'utf8');
    }
    results[task.index] = rec;
    if (job) await writeTaskRecord(job.dir, rec);
    say(`${task.id}${fallbackFrom ? `（${fallbackFrom}→${usedLane} 回退）` : `@${usedLane}`} -> ${rec.status}（${fmtMs(rec.durationMs)}，尝试 ${attempts}${task.effSet.length ? `，caps ${task.effCaps}` : ''}）`);
  }

  async function runWorker(lane) {
    for (;;) {
      const task = sharedQueue.shift() ?? laneBuckets.get(lane).shift();
      if (!task) return;
      try { await runTask(task, lane); }
      catch (e) {
        // 单任务内部异常（播种/落盘 IO 等）降级为该任务失败记录，绝不终止整批（finalizeJob 必达，v23 评审 P1）
        results[task.index] = { id: task.id, lane, status: 'failed', attempts: 0, durationMs: 0, model: resolveModel(task.model), effort: task.effort || null, caps: task.effCaps, error: `internal: ${brief(String((e && e.message) || e), 300)}` };
        say(`${task.id}@${lane} -> failed（internal error 已落失败记录）`);
      }
    }
  }

  const workers = [];
  for (const lane of laneKeys) {
    const n = Math.min(laneParallelOf(lane), tasks.length);
    for (let i = 0; i < n; i++) workers.push(runWorker(lane));
  }
  await Promise.all(workers);

  const totalMs = Date.now() - t0;
  const okCount = results.filter((r) => r && r.status === 'success').length;
  if (job) {
    await finalizeJob(job.dir, { total: tasks.length, ok: okCount, durationMs: totalMs });
    const md = buildSummaryMd({ type: 'fanout', tasks, results, totalMs, laneKeys, laneParallel, timeoutS, retry: retryN, jobId: job.id });
    await fsp.writeFile(path.join(job.dir, 'summary.md'), md, 'utf8');
  }
  return { jobId: job ? job.id : null, jobDir: job ? job.dir : null, okCount, total: tasks.length, results };
}

// ---------- 登录（SSO 协议，分步可被 UI 复用） ----------
const NO_AUTH_HEADERS = {
  'X-No-Authorization': 'true',
  'X-No-User-Id': 'true',
  'X-No-Enterprise-Id': 'true',
  'X-No-Department-Info': 'true',
};

/**
 * 第一步：读模板 + 申请 auth state。返回登录上下文（含 authUrl 与锦囊提示），
 * 供 CLI 直接打印 / UI 展示。失败 throw（含修复指引）。
 */
export async function startLogin(laneKey) {
  const identity = identityOf(laneKey);
  const templatePath = process.env.WBX_PRODUCT_CONFIG || identity.templatePath;
  let source;
  try {
    source = JSON.parse(await fsp.readFile(templatePath, 'utf8'));
  } catch (e) {
    throw new Error(`无法读取产品配置模板 ${templatePath}：${e.message}\n（请确认对应桌面版 WorkBuddy 至少成功启动过一次以生成缓存，或用 WBX_PRODUCT_CONFIG 指定模板）`);
  }
  const attrs = source.authentication?.attributes || {};
  const platform = attrs.platform || source.platform || identity.platform;
  const prefix = attrs.prefixPath || '';
  const endpoint = String(source.endpoint || identity.endpoint).replace(/\/+$/, '');
  const hasDeepseek = Array.isArray(source.models) && source.models.some((m) => m.id === FALLBACK_MODEL);

  const st = await httpJson('POST', `${endpoint}/v2${prefix}/auth/state?platform=${encodeURIComponent(platform)}`, {
    headers: NO_AUTH_HEADERS, body: {}, timeoutMs: 20000,
  });
  const authState = st.json?.data;
  if (!authState?.state || !authState?.authUrl) {
    throw new Error(`获取 auth state 失败（HTTP ${st.status}）：${brief(st.text, 240)}`);
  }

  const ctx = {
    lane: identity.key, label: identity.label, source, endpoint, platform, prefix, hasDeepseek,
    state: authState.state, authUrl: authState.authUrl,
    tips: [],
  };
  if (identity.key === 'ai') {
    ctx.tips.push(`锦囊A（优先）：${endpoint}/login/started?platform=${platform}&state=${authState.state}`);
    ctx.tips.push(`锦囊B：${endpoint}/login/select?platform=${platform}&state=${authState.state}`);
  }
  return ctx;
}

/** 轮询 token 直到拿到或超时。返回 { authToken } 或 { pending: true } / { error } */
export async function pollLoginToken(ctx, waitMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await sleep(2000);
    const r = await httpJson('GET', `${ctx.endpoint}/v2${ctx.prefix}/auth/token?state=${ctx.state}`, {
      headers: NO_AUTH_HEADERS, timeoutMs: 15000,
    });
    const envelope = r.json || {};
    if (envelope.data && typeof envelope.data.accessToken === 'string' && envelope.data.accessToken) {
      return { authToken: envelope.data };
    }
    const code = envelope.code ?? envelope.response?.data?.code;
    if (code === 11217 || r.status === 0 || code === undefined) continue; // pending / 网络抖动
  }
  return { pending: true };
}

export async function fetchAccountInfo(ctx, authToken) {
  for (let i = 0; i < 15; i++) {
    const r = await httpJson('GET', `${ctx.endpoint}/v2${ctx.prefix}/login/account?state=${ctx.state}`, {
      headers: { ...NO_AUTH_HEADERS, Authorization: `Bearer ${authToken.accessToken}` },
      timeoutMs: 15000,
    });
    const envelope = r.json || {};
    if (envelope.data) return envelope.data;
    if ((envelope.code ?? 12151) === 12151 || r.status === 0) { await sleep(1500); continue; }
    break;
  }
  return null;
}

/** 落盘凭证（sessions/<lane>.json 0600 + product/<lane>.json custom-token 注入） */
export async function persistLogin(ctx, authToken, account) {
  ensureDirs();
  const id = IDENTITIES[ctx.lane];
  authToken.lastRefreshTime = Date.now();
  await fsp.writeFile(id.sessionPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    endpoint: ctx.endpoint, platform: ctx.platform, prefix: ctx.prefix,
    auth: authToken,
    account: account || null,
  }, null, 2), { encoding: 'utf8', mode: 0o600 });

  const cfg = JSON.parse(JSON.stringify(ctx.source));
  const attrs = ctx.source.authentication?.attributes || {};
  cfg.authentication = {
    ...(ctx.source.authentication || {}),
    type: 'custom-token',
    attributes: { ...attrs, token: authToken.accessToken },
  };
  await fsp.writeFile(id.productPath, JSON.stringify(cfg), { encoding: 'utf8', mode: 0o600 });   // 含 accessToken，与 sessions/<lane>.json 同权（v23 评审 P1）
}

// ---------- doctor（结构化，CLI 与 UI 共用） ----------
// probe=true 含模型探测（tiny ask）；quick=true 快检（v22 新增）：跳过一切探测与子进程/端点调用，
// 只做 node/CLI 路径/凭证存在性/config 静态检查——常规会话自检用它（<10s 零额度），排障才全量。
export async function doctorStatus({ probe = true, onLine = null, quick = false } = {}) {
  if (quick) probe = false;
  ensureDirs();
  migrateIfNeeded();
  const say = (m) => { if (onLine) onLine(m); };
  const steps = [];
  const laneRows = [];
  let fail = 0;
  const cfg = loadConfig();
  const form = bridgeForm();

  const step = (name, good, detail) => {
    steps.push({ name, good, detail });
    if (good === false) fail++;
    say(`${good === null ? '[SKIP] ' : good ? '[OK]   ' : '[FAIL] '}${name.padEnd(8)} ${detail}`);
  };

  // 1) node
  step('node', nodeOk(), `${process.version}${nodeOk() ? '' : '（需要 >= 18.20.8）'}`);

  // 2) CLI 路径（向导化：env → config → 扫描 → 写回 config）
  const cliPath = resolveCliPath();
  const cliExists = fs.existsSync(cliPath);
  if (!cliExists && !process.env.WBX_CLI) {
    const cands = scanCliCandidates();
    if (cands.length === 1) {
      await setConfig('cli-path', JSON.stringify(cands[0]));
      step('cli', true, `自动探测并写入 config：${cands[0]}`);
    } else if (cands.length > 1) {
      step('cli', null, `探测到多个 CLI 入口，已按第一个运行；请固定其一：\n${cands.map((c, i) => `    ${i + 1}. ${c}`).join('\n')}\n    固定命令：wbx config set cli-path "<上面的路径>"`);
    } else {
      step('cli', false, '未找到 CodeBuddy CLI。修复：安装/重装 WorkBuddy 桌面版（任一版本），或 wbx config set cli-path "<codebuddy 完整路径>"，或设环境变量 WBX_CLI');
    }
  } else {
    step('cli', cliExists, cliExists ? cliPath : `入口不存在（${cliPath}）；App 升级后路径可能变化 -> 修复：wbx config set cli-path "<新路径>"`);
  }

  // 3) 运行时布局
  const formNote = process.env.WBX_HOME ? 'WBX_HOME 指定' : (form === 'global' ? '全局形态' : '项目形态');
  step('runtime', true, `${formNote}：${RUNTIME_ROOT}{/sessions,/product,/config/<lane>,/jobs}${form === 'global' && !process.env.WBX_HOME ? '' : '（不入 git）'}`);

  // 4) 路由配置
  const dl = cfg['default-lane'];
  const disabled = cfg['disabled-lanes'];
  const routeNote = dl === 'auto' ? 'auto（单发：codex 就绪即质量档优先，否则 ai 免费优先）' : dl;
  step('route', null, `default-lane=${routeNote}${disabled.length ? `；disabled-lanes=[${disabled.join(',')}]` : ''}${dl !== 'auto' && disabled.includes(dl) ? '（⚠ default-lane 指向的 lane 已禁用，实际按 auto 处理）' : ''}`);

  // 4b) caps 能力矩阵（v19）：键合法性 + 交付面
  const dcParsed = parseCapsSet(cfg['default-caps']);
  const dcIsL2 = !dcParsed.ok && dcParsed.kind === 'caps-l2-not-delivered';
  const capsValid = dcParsed.ok || dcIsL2;   // caps-l2-enabled 类型已由 loadConfig 归一（typeof 恒真死条件删除，v23 评审 P3）
  step('caps', capsValid ? null : false,
    `default-caps=${dcIsL2 ? 'L2（保留未交付，任务声明即报错）' : (dcParsed.ok ? (dcParsed.normalized || '∅(L0)') : `非法（${JSON.stringify(cfg['default-caps'])}，已按 L0 处理）`)}；能力矩阵：∅(L0)=五 lane 纯文本零回退 | net,read(L1)=仅 ai/cn 联网+只读（--caps "net,read" 或 L1；cline/doubao/codex 不承载） | 含 write=本轮未交付（探针 P3 沙箱前提破裂，声明即报 caps-write-disabled） | readDirs=本轮缓期（探针 P4 add-dir 边界不可证，任务字段声明即报错） | L2=保留未交付（cline 无命令级 deny；声明即报错）`);

  // 5) 模板缓存（登录前置条件；cline/doubao/codex 走各自独立认证，无模板概念）
  for (const key of LANE_ORDER) {
    if (key === 'cline' || key === 'doubao' || key === 'codex') continue;
    const id = IDENTITIES[key];
    const has = fs.existsSync(id.templatePath);
    if (!has) say(`[SKIP] 模板    lane ${key} 缺 ${id.templatePath}（修复：启动一次${LANE_BRAND[key]}桌面版）`);
  }

  // 6) 每 lane 凭证 + 探测（ai/cn；cline 第 7 段、doubao 第 8 段、codex 第 9 段单独体检）
  for (const key of LANE_ORDER) {
    if (key === 'cline' || key === 'doubao' || key === 'codex') continue;
    const info = laneStatusInfo(key);
    const id = IDENTITIES[key];
    say('');
    say(`--- 通道 ${LANE_BRAND[key]} · ${id.cost}${info.disabled ? ' · 已禁用' : ''} ---`);
    if (info.disabled) {
      steps.push({ name: `lane-${key}`, good: null, detail: '已禁用（disabled-lanes）' });
      say('[SKIP] 凭证     已禁用（disabled-lanes），路由/回退链跳过该 lane');
      laneRows.push({ ...info, probe: null });
      continue;
    }
    if (!info.ready) {
      steps.push({ name: `lane-${key}`, good: null, detail: '未登录' });
      say(`[SKIP] 凭证     未登录 -> node wbx.mjs login --identity ${key}${key === 'ai' ? '（邮箱密码登录遇「登录失败」时，按命令输出的锦囊修补 state）' : '（微信扫码）'}`);
      laneRows.push({ ...info, probe: null });
      continue;
    }
    say(`[OK]   凭证     已登录（${info.nickname || '昵称未知'}${info.uinMasked ? ` · uin ${info.uinMasked}` : ''}，凭证约 ${info.expiresInDays ?? '?'} 天后过期）`);
    steps.push({ name: `lane-${key}`, good: true, detail: `已登录（${info.nickname || '?'}，${info.expiresInDays ?? '?'} 天后过期）` });
    // 夜间免费档（v24 D-5 ①）：cn 专属行，--quick 亦显示（纯时钟零额度，D-043 合规）；
    // 三态=在窗内/窗外/过期 WARN；消费 nightWindowState 单对象，绝不自行重算
    if (key === 'cn') {
      const nw = nightWindowState();
      const srcNote = `官方活动口径${nw.expires ? `至 ${nw.expires}` : '、无截止日期'}，以官方为准`;
      if (nw.expired) {
        const detail = `已过期（${nw.expires} 已过，恒白天档；如官方延期：wbx config set night-expires <日期>；${srcNote}）`;
        steps.push({ name: 'night-window', good: null, detail });
        say(`[WARN] 夜间免费档 ${detail}`);
      } else if (nw.active) {
        const detail = `生效中（${nw.window} · ${nw.model} · 距窗尾约 ${nw.remainingMin}m；${srcNote}）`;
        steps.push({ name: 'night-window', good: true, detail });
        say(`[OK]   夜间免费档 ${detail}`);
      } else {
        const detail = `窗外（白天档；免费窗 ${nw.window}，约 ${nw.remainingMin}m 后开窗；${srcNote}）`;
        steps.push({ name: 'night-window', good: true, detail });
        say(`[OK]   夜间免费档 ${detail}`);
      }
    }
    if (!probe) { laneRows.push({ ...info, probe: null }); continue; }
    say(`${LANE_BRAND[key]} 模型探测中（tiny ask）…`);
    const pol = resolveModelPolicy(key, {}, new Date());   // 探「真实将跑」的模型/思考/上下文（D-4：ai/cn 探针同走策略）
    const p = await askOnce({ lane: key, prompt: '请只回复两个字符：OK', model: pol.model, effort: pol.effort, context: pol.context, timeoutMs: 120000 });
    if (p.ok) {
      const detail = `${p.model} 可用，${fmtMs(p.durationMs)}`;
      steps.push({ name: `lane-${key}-probe`, good: true, detail });
      say(`[OK]   模型探测 ${detail}`);
      laneRows.push({ ...info, probe: { good: true, detail } });
    } else {
      const detail = `${p.kind}: ${p.error}${p.hint === 'login' ? '（凭证疑似过期 -> 重新 login）' : ''}`;
      steps.push({ name: `lane-${key}-probe`, good: false, detail });
      say(`[FAIL] 模型探测 ${detail}`);
      fail++;
      laneRows.push({ ...info, probe: { good: false, detail } });
    }
  }

  // 7) cline lane（可选：未安装=WARN+安装指引，不影响 exit 0 —— 「至少一个 lane 可用」逻辑不变）
  {
    const cinfo = laneStatusInfo('cline');
    say('');
    say(`--- 通道 Cline CLI · 免费孪生${cinfo.disabled ? ' · 已禁用' : ' · 可选通道'} ---`);
    if (cinfo.disabled) {
      steps.push({ name: 'lane-cline', good: null, detail: '已禁用（disabled-lanes）' });
      say('[SKIP] 可选lane  已禁用（disabled-lanes），路由/回退链跳过该 lane');
      laneRows.push(cinfo);
    } else if (!cinfo.installed) {
      steps.push({ name: 'lane-cline', good: null, detail: '未安装（可选，不影响本桥）' });
      say('[WARN] 可选lane  cline 未安装（可选能力，不影响 ai/cn）。安装：npm install -g cline，然后 wbx login --identity cline');
      laneRows.push(cinfo);
    } else if (!cinfo.credential) {
      steps.push({ name: 'lane-cline', good: null, detail: '未登录（OAuth）' });
      say('[SKIP] 凭证     未登录 -> node wbx.mjs login --identity cline（浏览器完成 OAuth 设备授权）');
      laneRows.push(cinfo);
    } else {
      if (quick) {
        // 快检：不做版本 spawn 与免费清单端点调用（凭证存在性已在上方判定）
        steps.push({ name: 'lane-cline', good: true, detail: `已登录（快检：跳过版本探测与免费清单校验）` });
        say('[OK]   凭证     已登录（快检：跳过版本探测与免费清单校验，全量见 wbx doctor）');
        laneRows.push({ ...cinfo, probe: null });
      } else {
      const cfgC = loadConfig();
      const ver = await spawnBin(resolveClinePath(), ['--version'], { env: clineSpawnEnv(), timeoutMs: 30000 });
      const verStr = ansiStrip(ver.stdout || '').trim().split(/\r?\n/)[0] || '?';
      say(`[OK]   凭证     已登录（OAuth，provider=${cfgC['cline-provider']}，model=${cfgC['cline-model'] || 'provider 默认'}，thinking=${cfgC['cline-thinking']}，compaction=${cfgC['cline-compaction']}，cline v${verStr}，隔离目录 ${clineHomeDir()}）`);
      steps.push({ name: 'lane-cline', good: true, detail: `已登录（cline v${verStr}，model=${cfgC['cline-model'] || '默认'}）` });

      // 免费孪生存在性校验：免费组会轮换，端点确认 cline-model 是否仍在组内。
      // 端点失败降级 WARN（读缓存或明确报错），绝不影响 exit 0。
      const fm = await fetchClineFreeModels();
      const curModel = cfgC['cline-model'] || CLINE_FREE_DEFAULT_MODEL;
      if (fm.ok && fm.models.length) {
        const inFree = fm.models.some((m) => m.id === curModel);
        const srcNote = fm.source === 'cache' ? `（${fm.fetchedAt.slice(0, 10)} 缓存，端点暂不可用）` : '';
        if (inFree) {
          const fd = `cline-model=${curModel} 在当前免费组（共 ${fm.models.length} 个）${srcNote}`;
          steps.push({ name: 'cline-free', good: true, detail: fd });
          say(`[OK]   免费模型 ${fd}`);
        } else {
          const healNote = cfgC['cline-auto-heal'] === false
            ? '换用：wbx config set cline-model "<免费 id>"（清单：wbx models --as cline --free）'
            : 'cline-auto-heal 已开启：下次派发到达 cline lane 失败时将自动切换免费组可用 id 并写回 config（也可手动：wbx config set cline-model "<免费 id>"，清单：wbx models --as cline --free）';
          const fd = `cline-model=${curModel} 不在当前免费组（可能已被轮换下线，或为计费 id）。当前免费：${fm.models.map((m) => m.id).join('、')}${srcNote}。${healNote}`;
          steps.push({ name: 'cline-free', good: null, detail: fd });
          say(`[WARN] 免费模型 ${fd}`);
        }
      } else {
        const fd = `免费清单不可用（${fm.error}）——存在性校验降级跳过（不影响 exit 0）`;
        steps.push({ name: 'cline-free', good: null, detail: fd });
        say(`[WARN] 免费模型 ${fd}`);
      }

      if (!probe) { laneRows.push({ ...cinfo, probe: null }); }
      else {
        say('Cline CLI 模型探测中（tiny ask）…');
        const p = await askOnce({ lane: 'cline', prompt: '请只回复两个字符 OK', timeoutMs: 180000 });
        if (p.ok) {
          const detail = `${p.model} 可用，${fmtMs(p.durationMs)}`;
          steps.push({ name: 'lane-cline-probe', good: true, detail });
          say(`[OK]   模型探测 ${detail}`);
          laneRows.push({ ...cinfo, probe: { good: true, detail } });
        } else {
          const extra = p.hint === 'login' ? '（凭证疑似过期 -> 重新 wbx login --identity cline）'
            : p.hint === 'free-limit' ? `（免费额度今日已达上限${p.resetIn ? `，约 ${p.resetIn} 后重置` : ''} -> 可稍后再试或 wbx models --as cline --free 换免费模型）`
            : p.hint === 'free-promotion-ended' || p.hint === 'model-not-found' ? '（模型可能已被轮换下线 -> wbx models --as cline --free 查当前免费清单）'
            : '';
          const detail = `${p.kind}: ${p.error}${extra}`;
          steps.push({ name: 'lane-cline-probe', good: null, detail });
          say(`[WARN] 模型探测 ${detail}（可选通道，不影响 exit 0）`);
          laneRows.push({ ...cinfo, probe: { good: false, detail } });
        }
      }
      }
    }
  }

  // 8) doubao lane（v13：可选第四 lane；未运行/未装=WARN 不影响 exit 0——「至少一个 lane 可用」
  //    逻辑不变）。只做 status 探测（进程+CDP，免费不耗会员额度）；绝不做 tiny-ask 探测——
  //    豆包走用户会员额度，探测性提问也会真实消耗一次工作任务，与 ai/cn 段的免费探测刻意差异化
  //    （2026-10-03 v13 定案：doctor 探测不做 tiny-ask）。
  {
    const dinfo = laneStatusInfo('doubao');
    say('');
    say(`--- 通道 豆包（桌面端）· 会员额度${dinfo.disabled ? ' · 已禁用' : ' · 可选通道'} ---`);
    if (dinfo.disabled) {
      steps.push({ name: 'lane-doubao', good: null, detail: '已禁用（disabled-lanes）' });
      say('[SKIP] 可选lane  已禁用（disabled-lanes），路由/回退链跳过该 lane');
      laneRows.push(dinfo);
    } else if (!dinfo.installed) {
      steps.push({ name: 'lane-doubao', good: null, detail: '未安装（可选，不影响本桥）' });
      say('[WARN] 可选lane  豆包桥未找到 doubao.mjs（可选能力，不影响 ai/cn/cline）。修复：在桥源码仓跑 wbx self-install（装全局副本）');
      laneRows.push(dinfo);
    } else {
      if (quick) {
        // 快检：不做 doubao.mjs status 探测 spawn（安装态已判定）
        steps.push({ name: 'lane-doubao', good: null, detail: '已安装（快检：跳过桌面端状态探测）' });
        say('[SKIP] 桌面端   快检跳过桌面端状态探测（全量见 wbx doctor）');
        laneRows.push({ ...dinfo, probe: null });
      } else {
      say('豆包桌面端状态探测中（doubao.mjs status，免费不耗额度）…');
      const st = await spawnBin(process.execPath, [path.join(dinfo.bridgeDir, 'doubao.mjs'), 'status', '--timeout-ms', '8000'], { timeoutMs: 30000 });
      const payload = parseDoubaoPayload(ansiStrip(st.stdout || ''));
      const online = st.code === 0 && !!payload && payload.ok === true;
      const probeDetail = online
        ? `调试口在线（model=${payload.model || '?'}，推理档=${payload.mode || '?'}）`
        : `桌面端未以调试口 9225 运行或未登录（${brief(String(payload?.reason || `exit=${st.code}`), 100)}）`;
      if (online) {
        steps.push({ name: 'lane-doubao', good: true, detail: probeDetail });
        say(`[OK]   桌面端   ${probeDetail}`);
      } else {
        // WARN 而非 FAIL：拉起属用户侧动作，不影响 ai/cn/cline 主通道（doctor 保持只读、绝不带 ensure 副作用）
        steps.push({ name: 'lane-doubao', good: null, detail: probeDetail });
        const autoNote = loadConfig()['doubao-autostart'] === false
          ? `拉起：powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\\.zcode\\wbx-bridge\\doubao\\launch.ps1"（详情：wbx doubao status）`
          : `派发到达豆包 lane 时将自动拉起/重启（doubao-autostart=true；现在手动拉起：powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\\.zcode\\wbx-bridge\\doubao\\launch.ps1"，详情：wbx doubao status）`;
        say(`[WARN] 桌面端   ${probeDetail}。${autoNote}`);
      }
      laneRows.push({ ...dinfo, probe: { good: online, detail: probeDetail } });
      }
    }
  }

  // 9) codex lane（v21：可选第五 lane；ChatGPT Plus 质量优先档）。只做免额度探测（二进制+版本、
  //    隔离 CODEX_HOME login status、模型与冷却状态）——绝不做 tiny-ask（D-002 同类：探测性提问
  //    也真实消耗 Plus 5h 滚动窗口额度）。未装/未登录=WARN/SKIP 不影响 exit 0（可选 lane 先例）。
  {
    const xinfo = laneStatusInfo('codex');
    say('');
    say(`--- 通道 Codex CLI（ChatGPT Plus·可选通道）· 质量优先档${xinfo.disabled ? ' · 已禁用' : ''} ---`);
    if (xinfo.disabled) {
      steps.push({ name: 'lane-codex', good: null, detail: '已禁用（disabled-lanes）' });
      say('[SKIP] 可选lane  已禁用（disabled-lanes），路由/回退链跳过该 lane');
      laneRows.push(xinfo);
    } else if (!xinfo.installed) {
      steps.push({ name: 'lane-codex', good: null, detail: '未安装（可选，不影响本桥）' });
      say('[WARN] 可选lane  codex 未安装（可选能力，不影响 ai/cn/cline/doubao）。安装：Codex 桌面版（捆绑 CLI）或 codex CLI，或 wbx config set codex-path "<codex.exe 路径>"');
      laneRows.push(xinfo);
    } else {
      if (quick) {
        // 快检：不做 --version/login status spawn（二进制与 auth.json 存在性已判定）
        const credQuick = fs.existsSync(path.join(CODEX_HOME, 'auth.json'));
        steps.push({ name: 'lane-codex', good: credQuick ? true : null, detail: credQuick ? '已装且凭证在位（快检：跳过登录态探测）' : '已装但未收割凭证（快检）' });
        say(`${credQuick ? '[OK]   凭证     已装且凭证在位（快检：跳过登录态探测，全量见 wbx doctor）' : '[SKIP] 凭证     已装但未收割凭证（快检）-> node wbx.mjs login --identity codex'}`);
        laneRows.push({ ...xinfo, probe: null });
      } else {
      const ver = await spawnBin(xinfo.binaryPath, ['--version'], { env: codexSpawnEnv(), timeoutMs: 30000 });
      const verStr = ansiStrip(ver.stdout || '').trim().split(/\r?\n/)[0] || '?';
      say('Codex 登录态探测中（隔离 CODEX_HOME login status，免额度）…');
      const st = await spawnBin(xinfo.binaryPath, ['login', 'status'], { env: codexSpawnEnv(), timeoutMs: 30000 });
      // 实测（v21 执行窗口复测）：login status 的 "Logged in using ChatGPT" 写在 stderr、stdout 为空——判定扫双流
      const logged = st.code === 0 && /Logged in/i.test(ansiStrip(st.stdout || '') + ansiStrip(st.stderr || ''));
      if (!logged) {
        steps.push({ name: 'lane-codex', good: null, detail: '未登录（ChatGPT 账号）' });
        say('[SKIP] 凭证     未登录（隔离 codex-home 无有效 auth.json）-> node wbx.mjs login --identity codex（一次性只读复制 ~/.codex/auth.json；需先在 Codex 桌面版/CLI 登录 ChatGPT 账号）');
        laneRows.push({ ...xinfo, probe: null });
      } else {
        const qs = codexQuotaState();
        const qNote = qs.active
          ? `额度冷却中（剩余约 ${qs.remainingMin}m——auto 路由/回退链跳过，显式点名放行）`
          : '额度窗口正常（余额以 ChatGPT 网页端 Settings→Usage 为准）';
        say(`[OK]   凭证     已登录（ChatGPT，model=${xinfo.model}，reasoning=${xinfo.reasoning}，${verStr}，隔离目录 ${CODEX_HOME}）`);
        steps.push({ name: 'lane-codex', good: true, detail: `已登录（${verStr}，model=${xinfo.model}${qs.active ? '，冷却中' : ''}）` });
        say(`${qs.active ? '[WARN]' : '[OK]'}   额度     ${qNote}`);
        steps.push({ name: 'codex-quota', good: qs.active ? null : true, detail: qNote });
        laneRows.push({ ...xinfo, probe: { good: true, detail: `login status OK（${qNote}）` } });
      }
      }
    }
  }

  const ready = loggedLanes().filter((k) => !isLaneDisabled(k));
  if (!ready.length) fail++;   // 探测失败计数只在步骤级（聚合补加会使 ai/cn 失败双计，v23 评审 P3）

  return {
    ok: fail === 0, fail, form, runtimeRoot: RUNTIME_ROOT, version: WBX_VERSION,
    cliPath, steps, lanes: laneRows, config: cfg, readyLanes: ready,
    nightWindow: nightWindowState(),   // v24：结构化窗口字段（UI /api/doctor 消费，与 cn 段行同源）
  };
}

// ---------- 用户级 AGENTS.md 标记块（install-user / self-install 共用） ----------
export const USER_AGENTS_PATH = path.join(HOME, '.zcode', 'AGENTS.md');
export const USER_BLOCK_BEGIN = '<!-- wbx:begin -->';
export const USER_BLOCK_END = '<!-- wbx:end -->';

// 用户级块=跨项目最小指针版（v22 三层注入分工：全局只留指针，lane 细节归各仓库 AGENTS/SKILL——
// 消除用户级块与仓库规则面约 90% 的双注入重复）
export function userBlockText(bridgeScriptPath) {
  const wbx = `node "${bridgeScriptPath}"`;
  return [
    USER_BLOCK_BEGIN,
    '## wbx 外部算力桥（本项目装有 wbx 桥：五 lane 外部 Agent 当作子代理，默认分派）',
    '',
    `- 自检：\`${wbx} doctor --quick\`（<10s 静态检查；排障用全量 doctor）`,
    `- 单条：\`${wbx} ask --file <p.txt>\`（--as codex|ai|cn|cline|doubao 指定 lane，缺省 codex 优先，失败自动回退）`,
    `- 批量：\`${wbx} fanout --file <tasks.json>\`（任务可用 files:[路径] 拼材料、as:"codex" 点名）`,
    `- 控制台：\`${wbx} ui --detach\`（http://127.0.0.1:7788；--stop 停止）`,
    '',
    '调用准则与安全红线以各仓库 AGENTS.md / .zcode/skills/wb-bridge/SKILL.md 为准（自包含任务默认分派；',
    '涉密/隐私/凭证绝不外包；结果必校验；连续 ≥2 失败或限流停止外包自己做）。',
    USER_BLOCK_END,
  ].join('\n');
}

const USER_BLOCK_RE = () => new RegExp(escapeRegExp(USER_BLOCK_BEGIN) + '[\\s\\S]*?' + escapeRegExp(USER_BLOCK_END), 'g');

export async function installUserBlock(bridgeScriptPath) {
  await fsp.mkdir(path.dirname(USER_AGENTS_PATH), { recursive: true });
  const block = userBlockText(bridgeScriptPath);
  let cur = '';
  try { cur = await fsp.readFile(USER_AGENTS_PATH, 'utf8'); } catch { /* 新建 */ }
  let next;
  if (cur.includes(USER_BLOCK_BEGIN)) {
    next = cur.replace(USER_BLOCK_RE(), '').replace(/\s+$/, '') + '\n\n' + block + '\n';
  } else {
    next = (cur ? cur.replace(/\s+$/, '') + '\n\n' : '') + block + '\n';
  }
  await fsp.writeFile(USER_AGENTS_PATH, next, 'utf8');
  return USER_AGENTS_PATH;
}

export async function uninstallUserBlock() {
  let cur = '';
  try { cur = await fsp.readFile(USER_AGENTS_PATH, 'utf8'); }
  catch { return { removed: false, reason: 'file-missing' }; }
  if (!cur.includes(USER_BLOCK_BEGIN)) return { removed: false, reason: 'no-block' };
  const next = cur.replace(USER_BLOCK_RE(), '').replace(/\n{3,}/g, '\n\n').trim();
  if (!next) {
    await fsp.rm(USER_AGENTS_PATH, { force: true });
    return { removed: true, fileDeleted: true };
  }
  await fsp.writeFile(USER_AGENTS_PATH, next + '\n', 'utf8');
  return { removed: true };
}
