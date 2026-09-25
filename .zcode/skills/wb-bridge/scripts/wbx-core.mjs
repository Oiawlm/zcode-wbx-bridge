/**
 * wbx-core — wbx 桥核心库（v3：lib 化 + 配置化 + job 可观测 + 全局化 + 分发）
 *
 * 从 v2 的单文件 wbx.mjs 抽出的可复用逻辑，CLI 壳（wbx.mjs）与 Web UI（wbx-ui.mjs）
 * 共同 import 本模块。对外命令行为以 wbx.mjs 为准，本文件不含 process 参数解析。
 *
 * v3 关键概念：
 *   - 运行时根（runtime root）解析：WBX_HOME env → ~/.wbx/（~/.zcode/wbx-bridge 存在
 *     即全局形态）→ 项目 .wbx/（项目形态，v2 现状）。
 *   - config.json（存运行时根）：default-lane / disabled-lanes / parallel-per-lane /
 *     model / cli-path。
 *   - 统一 job 模型：每次 ask/fanout 落 <运行时根>/jobs/<id>/（manifest.json +
 *     tasks-input.json + <taskId>.json + summary.md）；旧 .wbx/tasks/ 只读兼容。
 *
 * 红线：凭证（accessToken/refreshToken）绝不进入日志、文档、HTTP 响应、导出产物。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WBX_VERSION = '5.2.0';

// ---------- 路径与常量 ----------
export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export function findProjectRoot() {
  if (process.env.WBX_PROJECT_ROOT) return path.resolve(process.env.WBX_PROJECT_ROOT);
  let d = SCRIPT_DIR;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, '.zcode', 'skills', 'wb-bridge'))) return d;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();
export const HOME = os.homedir();
export const GLOBAL_BRIDGE_DIR = path.join(HOME, '.zcode', 'wbx-bridge');
export const GLOBAL_RUNTIME_DIR = path.join(HOME, '.wbx');

// 运行时根：WBX_HOME env → ~/.wbx（全局形态，以 ~/.zcode/wbx-bridge 存在为准）→ 项目 .wbx
export function resolveRuntimeRoot() {
  if (process.env.WBX_HOME) return path.resolve(process.env.WBX_HOME);
  if (fs.existsSync(GLOBAL_BRIDGE_DIR)) return GLOBAL_RUNTIME_DIR;
  return path.join(PROJECT_ROOT, '.wbx');
}

export const RUNTIME_ROOT = resolveRuntimeRoot();
export const WBX_DIR = RUNTIME_ROOT;                    // v2 语义别名
export const JOBS_DIR = path.join(RUNTIME_ROOT, 'jobs');
export const SESSIONS_DIR = path.join(RUNTIME_ROOT, 'sessions');
export const PRODUCT_DIR = path.join(RUNTIME_ROOT, 'product');
export const CONFIG_FILE = path.join(RUNTIME_ROOT, 'config.json');
export const LEGACY_TASKS_DIR = path.join(PROJECT_ROOT, '.wbx', 'tasks'); // v2 fanout 结果（只读）
export const LEGACY_JOBS_DIR = path.join(PROJECT_ROOT, '.wbx', 'jobs');   // 项目形态时期的 jobs（只读）
const OLD_SESSION_PATH = path.join(PROJECT_ROOT, '.wbx', 'session.json');        // v1 凭证（迁移源）
const OLD_PRODUCT_PATH = path.join(PROJECT_ROOT, '.wbx', 'product-config.json'); // v1 产品配置（迁移源）

export const bridgeForm = () => (fs.existsSync(GLOBAL_BRIDGE_DIR) ? 'global' : 'project');

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
export const LANE_ORDER = ['ai', 'cn', 'cline']; // 默认路由顺序：免费优先，cline（可选）排最后
// v5.2 命名公式：品牌（版本）全称——doctor/CLI 人读输出用；数据层 label 字段不变
export const LANE_BRAND = { ai: 'WorkBuddy AI（国际版）', cn: 'WorkBuddy（国内版）', cline: 'Cline CLI' };
const FALLBACK_ORDER = ['cn', 'ai', 'cline'];     // 回退顺序：国内版兜底，cline 最末（稳定性待实测）

const DEFAULT_CLI_PATH = 'D:\\App\\WorkBuddyAI\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy';
const FALLBACK_MODEL = 'deepseek-v4.1-flash';

// ---------- cline 免费孪生（v5.1：cline lane 默认免费调 DeepSeek V4.1 Flash） ----------
// Cline 按模型 id 计费：deepseek/deepseek-v4.1-flash 计费，cline-free/ 前缀的同名孪生免费
//（限时促销轮换 + 每日用量配额，官方文档口径）。免费组会轮换，故清单一律走
// recommended-models 端点（见 fetchClineFreeModels），本常量只是默认模型 id，不是清单。
export const CLINE_FREE_DEFAULT_MODEL = 'cline-free/deepseek-v4.1-flash';
// v5 时期探测后写入 config 的计费孪生（loadConfig 一次性迁移的唯一源值；其他显式值不动）
const CLINE_METERED_TWIN_MODEL = 'deepseek/deepseek-v4.1-flash';

// ---------- cline lane（v5：可选第三 lane，独立上游） ----------
// 红线：桥的 cline 状态只在 <运行时根>/cline-home/ 下，绝不读写用户 ~/.cline。
// 隔离方式（Phase 0 实测定案）：通过 USERPROFILE/HOME 环境变量覆盖，让 cline 解析的
// ~/.cline 落在桥目录内。不用 --data-dir——实测 3.0.65 该 flag 会破坏运行时认证加载
//（同凭证同目录，带 flag 即 401；auth 子命令放在其前的 --data-dir 还会被忽略导致误写 ~/.cline）。
export const CLINE_HOME = path.join(RUNTIME_ROOT, 'cline-home');
export const CLINE_WORK_DIR = path.join(CLINE_HOME, 'work');
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

// ---------- cline 免费模型清单（v5.1：recommended-models 端点） ----------
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

// 专用 HTTPS GET（node:https 单次连接，不走 fetch/undici）：undici 全局连接池在 win32 上
// 与随后的 process.exit 冲突（libuv async.c 断言、exit 127，2026-09-25 实测最小复现），
// 故目录拉取必须走本实现；返回形状与 httpJson 一致 {status,json,text}。
function httpsGetJson_(url, { headers = {}, timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const fin = (r) => { if (!settled) { settled = true; resolve(r); } };
    try {
      const req = https.request(url, { method: 'GET', headers, agent: false, timeout: timeoutMs }, (res) => {
        const chunks = [];
        res.on('data', (b) => chunks.push(b));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
          fin({ status: res.statusCode, json, text });
          res.destroy();
        });
      });
      req.on('timeout', () => { req.destroy(); fin({ status: 0, json: null, text: `timeout（> ${timeoutMs}ms）` }); });
      req.on('error', (e) => fin({ status: 0, json: null, text: String((e && e.message) || e) }));
      req.end();
    } catch (e) { fin({ status: 0, json: null, text: String((e && e.message) || e) }); }
  });
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
  const r = await httpsGetJson_(CLINE_RECOMMENDED_MODELS_URL, { headers: { Authorization: `Bearer ${token}` }, timeoutMs });
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

// ---------- v5.1 免费档错误形态（超额状态机，P0-3） ----------
// 形态取证（2026-09-25）：超额未实测到（20 次内未见限制），消息模板取自 cline 3.0.65 二进制：
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

// ---------- 小工具 ----------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function die(msg) { console.error('[FAIL] ' + msg); process.exit(1); }

export function nodeOk() {
  const v = process.versions.node.split('.').map(Number);
  return !(v[0] < 18 || (v[0] === 18 && (v[1] < 20 || (v[1] === 20 && v[2] < 8))));
}

export function ansiStrip(s) { return String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); }

export function redact(s) {
  return String(s || '')
    .replace(/((?:token|password|passwd|secret|api[-_]?key|authorization)["';:=\s]+)[^\s"',}]+/gi, '$1[REDACTED]')
    .replace(/(x-access-token["';:=\s]+)[^\s"',}]+/gi, '$1[REDACTED]');
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

export function isAuthError(text) {
  return /Authentication required|not logged|please.*sign.?in|unauthorized|\b401\b/i.test(String(text || ''));
}

export function isRateLimit(text) {
  return /rate.?limit|too many requests|\b429\b|quota|限流|频繁/i.test(String(text || ''));
}

export function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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
    type: 'enum', values: ['auto', 'ai', 'cn', 'cline'], default: 'auto',
    desc: 'ask 默认路由：auto=ai 优先（免费），或固定 ai / cn / cline',
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
};

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
  out['disabled-lanes'] = out['disabled-lanes'].filter((x) => x === 'ai' || x === 'cn' || x === 'cline');
  if (!Number.isInteger(out['parallel-per-lane']) || out['parallel-per-lane'] < 1 || out['parallel-per-lane'] > 8) {
    out['parallel-per-lane'] = 2;
  }
  if (typeof out.model !== 'string' || !out.model) out.model = FALLBACK_MODEL;
  if (typeof out['cli-path'] !== 'string') out['cli-path'] = '';
  // cline-* 键（v5 起全部可选）
  for (const k of ['cline-path', 'cline-data-dir']) {
    if (typeof out[k] !== 'string') out[k] = '';
  }
  // v5.1 存量迁移（P0-2，一次性）：仅当旧值恰为 v5 计费孪生 deepseek/deepseek-v4.1-flash 时
  // 改写为免费孪生默认；用户显式设置的其他模型 id 一律不动。写回 config.json 使迁移只发生一次。
  let migratedClineModel = false;
  if (raw['cline-model'] === CLINE_METERED_TWIN_MODEL) {
    out['cline-model'] = CLINE_FREE_DEFAULT_MODEL;
    migratedClineModel = true;
  }
  if (typeof out['cline-model'] !== 'string' || !out['cline-model']) out['cline-model'] = CLINE_FREE_DEFAULT_MODEL;
  if (!CLINE_PROVIDER_IDS.includes(out['cline-provider'])) out['cline-provider'] = 'cline';
  if (!['none', 'low', 'medium', 'high', 'xhigh'].includes(out['cline-thinking'])) out['cline-thinking'] = 'xhigh';
  if (!['agentic', 'basic', 'off'].includes(out['cline-compaction'])) out['cline-compaction'] = 'off';
  if (!Number.isInteger(out['cline-parallel']) || out['cline-parallel'] < 1 || out['cline-parallel'] > 8) {
    out['cline-parallel'] = 1;
  }
  if (migratedClineModel) {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2) + '\n', 'utf8');
      console.error(`[MIGRATE] cline-model：检测到 v5 计费孪生 ${CLINE_METERED_TWIN_MODEL}，已改写为免费孪生 ${CLINE_FREE_DEFAULT_MODEL}（仅此值迁移，显式设置的其他模型 id 不动）`);
    } catch { /* 写回失败不影响本次内存中生效 */ }
  }
  return out;
}

export function parseConfigValue(key, valueStr) {
  const def = CONFIG_DEFS[key];
  if (!def) throw new Error(`未知配置键 ${key}（可用：${Object.keys(CONFIG_DEFS).join(', ')}）`);
  let v;
  try { v = JSON.parse(valueStr); } catch { v = valueStr; }
  switch (def.type) {
    case 'enum':
      if (!def.values.includes(v)) throw new Error(`${key} 只支持 ${def.values.join(' | ')}（收到 ${JSON.stringify(v)}）`);
      return v;
    case 'lanes': {
      if (typeof v === 'string') v = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (!Array.isArray(v)) throw new Error(`${key} 需为 lane 数组，如 ["cn"] 或 "cn"`);
      const bad = v.filter((x) => x !== 'ai' && x !== 'cn' && x !== 'cline');
      if (bad.length) throw new Error(`${key} 只支持 ai/cn/cline（收到 ${JSON.stringify(bad)}）`);
      return [...new Set(v)];
    }
    case 'int': {
      const n = Number(v);
      if (!Number.isInteger(n) || n < def.min || n > def.max) throw new Error(`${key} 需为 ${def.min}-${def.max} 的整数`);
      return n;
    }
    default:
      return String(v);
  }
}

export async function setConfig(key, valueStr) {
  const v = parseConfigValue(key, valueStr);
  const cfg = loadConfig();
  cfg[key] = v;
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  await fsp.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  return { key, value: v, config: cfg };
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
  const id = IDENTITIES[laneKey] || IDENTITIES.cn;
  try { return JSON.parse(fs.readFileSync(id.sessionPath, 'utf8')); } catch { return null; }
}

export function laneReady(laneKey) {
  if (laneKey === 'cline') return clineReady();
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
  const id = IDENTITIES[laneKey] || IDENTITIES.cn;
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

// 默认路由：config.default-lane 固定 ai/cn/cline（未禁用），否则 auto（enabled+已登录 里 ai 优先，cline 最末）
export function resolveDefaultLane() {
  const pick = loadConfig()['default-lane'];
  if ((pick === 'ai' || pick === 'cn' || pick === 'cline') && !isLaneDisabled(pick)) return pick;
  for (const k of LANE_ORDER) {
    if (!isLaneDisabled(k) && laneReady(k)) return k;
  }
  const enabled = enabledLanes();
  return enabled[0] || 'cn';
}

// 回退 lane：其余已登录且未禁用的 lane（顺序 cn→ai→cline，各一次）；没有则 null。
// cline 未装/无凭证时 laneReady 为 false，天然跳过（不耗重试额度）。
//
// 【v5.1 红线断言·非 DeepSeek 禁回退（用户定案）】cline lane 失败的一切路径都不得改用
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
  return (IDENTITIES[k] || k === 'cline') ? k : null;
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

export function spawnNode(args, { env, timeoutMs, stdin } = {}) {
  return spawnBin(process.execPath, args, { env, timeoutMs, stdin, cwd: RUNTIME_ROOT });
}

// 通用子进程执行（v5：cline exe 与 node 均走这里），超时用 killTree 兜底
export function spawnBin(bin, args, { env, timeoutMs, stdin, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: env || process.env, windowsHide: true, cwd: cwd || RUNTIME_ROOT });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
    if (stdin != null) {
      // v4 stdin 通道：超长提示词经 stdin 传入，绕过命令行长度上限（CLI -p 无位置参数时读 stdin）
      child.stdin.on('error', () => { /* EPIPE 等忽略，主进程退出码会反映失败 */ });
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      // v5：无 stdin 数据也必须立即 EOF——cline CLI 总会检查 stdin（支持 cat file | cline），
      // 管道不关会一直等 EOF 导致进程悬挂（Phase 0 实测：异步 spawn 不 end stdin 必挂）
      child.stdin.on('error', () => { /* EPIPE 忽略 */ });
      child.stdin.end();
    }
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
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

export async function httpJson(method, url, { headers = {}, body, timeoutMs = 10000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
    return { status: res.status, json, text };
  } catch (e) {
    return { status: 0, json: null, text: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
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
  const id = IDENTITIES[laneKey] || IDENTITIES.cn;
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

function usageOf(j) {
  const u = (j && j.usage) || {};
  const inp = u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? null;
  const out = u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? null;
  return { in: inp, out: out };
}

function normalizeResult(j) {
  if (Array.isArray(j)) {
    const r = j.filter((x) => x && typeof x === 'object' && x.type === 'result').pop();
    if (r) return r;
  }
  return j;
}

/**
 * 单次无头调用（纯 LLM，无工具），跑在指定 lane 上。返回：
 *   成功 { ok:true, text, usage, durationMs, model, raw }
 *   失败 { ok:false, kind, error, durationMs, hint? }
 * kind: timeout | cli-error | unparseable | result-error | auth
 * v5：lane=cline 走 cline CLI（--json NDJSON）；任务级 effort 对 cline 不生效
 *（用户定案：cline 思考档一律取 config cline-thinking，不下调）。
 */
export async function askOnce({ lane, prompt, model, effort, timeoutMs = 300000 }) {
  if (lane === 'cline') return askOnceCline({ prompt, model, timeoutMs });
  const laneKey = IDENTITIES[lane] ? lane : 'cn';
  const mdl = resolveModel(model);
  // v4：超长提示词（>12k 字符）改走 stdin 通道（-p 不带位置参数），绕过命令行长度上限；
  // 短提示词保持 v3 位置参数路径不变（对外行为零回退）
  const useStdin = prompt.length > 12000;
  const args = [
    resolveCliPath(), '-p',
    ...(useStdin ? [] : [prompt]),
    '--model', mdl,
    '--tools', '',                       // 纯 LLM 无工具模式（对标桌面版 Quick 模式）
    '--output-format', 'json',
    '--no-session-persistence',
    '--max-turns', '1',
  ];
  if (effort) args.push('--effort', effort);

  const t0 = Date.now();
  const r = await spawnNode(args, { env: baseEnv(laneKey), timeoutMs, stdin: useStdin ? prompt : null });
  const durationMs = Date.now() - t0;
  const stdout = ansiStrip(r.stdout || '');
  const stderr = ansiStrip(r.stderr || '');
  const combined = stdout + '\n' + stderr;

  if (r.timedOut) {
    return { ok: false, kind: 'timeout', error: `执行超时（> ${Math.round(timeoutMs / 1000)}s）`, durationMs };
  }
  if (isAuthError(combined)) {
    return { ok: false, kind: 'auth', error: '未登录或凭证已过期（Authentication required）', durationMs, hint: 'login' };
  }

  const j = normalizeResult(extractJson(stdout));
  if (!j) {
    return {
      ok: false,
      kind: r.code === 0 ? 'unparseable' : 'cli-error',
      error: brief(combined) || `exit=${r.code}，无输出`,
      durationMs,
      hint: isRateLimit(combined) ? 'ratelimit' : undefined,
    };
  }

  const isErr = j.is_error === true || j.type === 'error' ||
    (typeof j.subtype === 'string' && j.subtype.startsWith('error'));
  if (isErr) {
    const msg = String(j.result ?? j.error ?? j.message ?? JSON.stringify(j).slice(0, 300));
    return { ok: false, kind: 'result-error', error: brief(msg), durationMs, hint: isRateLimit(msg) ? 'ratelimit' : undefined };
  }

  let text = j.result ?? j.text ?? j.content ?? j.message;
  if (typeof text !== 'string') text = JSON.stringify(text, null, 2);
  if (text === undefined || text === null) text = JSON.stringify(j, null, 2);
  return { ok: true, text, usage: usageOf(j), durationMs, model: j.model || mdl, raw: j };
}

// ---------- cline lane：NDJSON 解析 + 一次性调用（v5） ----------
// parseClineNdjson —— 解析 cline --json 的 stdout 全文（纯函数，零依赖，任何输入不抛异常）。
// 初稿由 wbx fanout 外包产出（job 20260925-120106-jh7），ZCode 审查修订后集成。
function makeEmptyClineResult() {
  return { events: 0, text: null, finishReason: null, usage: { in: null, out: null }, model: null, durationMs: null, error: null, hasRunResult: false };
}
function isPlainObject_(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function asNonEmptyString_(value) { return typeof value === 'string' && value.trim() !== '' ? value : null; }
function asFiniteNumber_(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

export function parseClineNdjson(text) {
  const out = makeEmptyClineResult();
  if (typeof text !== 'string' || text.length === 0) return out;
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;  // 去 BOM
  const agentTexts = [];
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
      const chunk = asNonEmptyString_(parsed.event.text);
      if (chunk !== null) agentTexts.push(chunk);   // 正文增量（成功场景待实测，容错跳过缺字段行）
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
    const u = isPlainObject_(lastRunResult.usage) ? lastRunResult.usage : null;
    out.usage = {
      in: u === null ? null : asFiniteNumber_(u.inputTokens),
      out: u === null ? null : asFiniteNumber_(u.outputTokens),
      cost: u === null ? null : asFiniteNumber_(u.totalCost),   // 名义计价（免费模型实测为 0）
    };
    out.model = isPlainObject_(lastRunResult.model) ? asNonEmptyString_(lastRunResult.model.id) : null;
    out.durationMs = asFiniteNumber_(lastRunResult.durationMs);
  }
  if (out.text === null && agentTexts.length > 0) out.text = agentTexts.join('');
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
export async function askOnceCline({ prompt, model = null, timeoutMs = 300000 }) {
  const bin = resolveClinePath();
  if (!bin) {
    return { ok: false, kind: 'cli-error', error: 'cline 未安装（可选 lane）。安装：npm install -g cline，然后 wbx login --identity cline', durationMs: 0, hint: 'not-installed' };
  }
  const cfg = loadConfig();
  const provider = cfg['cline-provider'] || 'cline';
  const mdl = model || cfg['cline-model'] || '';
  const useStdin = prompt.length > 12000;
  // cline 参数解析要求提示词至少含一个 ASCII 空格（实测无空格的短中文会被当未知子命令拒绝）；
  // 无空格时前缀一个空格规避（v5.1 实测可行，不影响模型收到的内容）
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
  const r = await spawnBin(bin, args, { env: clineSpawnEnv(), timeoutMs: timeoutMs + 20000, stdin: useStdin ? prompt : null, cwd: CLINE_WORK_DIR });
  const durationMs = Date.now() - t0;
  const stdout = ansiStrip(r.stdout || '');
  const stderr = ansiStrip(r.stderr || '');
  const parsed = parseClineNdjson(stdout);
  const rawStream = stdout;   // 原始 NDJSON 全文，供 job 目录落盘回放

  if (r.timedOut) {
    return { ok: false, kind: 'timeout', error: `执行超时（> ${Math.round(timeoutMs / 1000)}s，桥侧兜底 kill）`, durationMs, rawStream };
  }
  if (r.code === -1 && !parsed.events) {
    return { ok: false, kind: 'cli-error', error: `cline 进程启动/执行失败：${brief(stderr || '无输出')}`, durationMs, rawStream, hint: 'not-installed' };
  }
  const combined = stdout + '\n' + stderr;
  if (isAuthError(parsed.error || '') || isAuthError(combined)) {
    return { ok: false, kind: 'auth', error: 'cline 凭证无效或未登录（Unauthorized）', durationMs, rawStream, hint: 'login' };
  }
  const failed = r.code !== 0 || parsed.error !== null || parsed.finishReason === 'error' || parsed.text === null;
  if (failed) {
    const msg = parsed.error || parsed.text || brief(stderr || combined) || `exit=${r.code}，无输出`;
    // v5.1 超额状态机（P0-3）：免费档错误优先于通用限流识别；跨 lane 回退语义不变
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
      durationMs, rawStream,
      hint, ...(resetIn ? { resetIn } : {}),
    };
  }
  return {
    ok: true, text: parsed.text,
    usage: parsed.usage, durationMs: durationMs,
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

export async function readJobRecords(jobDir) {
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(jobDir); } catch { return out; }
  for (const e of entries) {
    if (!e.endsWith('.json') || RECORD_FILES.has(e)) continue;
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
  const type = manifest?.type || (legacy ? 'fanout' : 'fanout');
  const hasInput = fs.existsSync(path.join(dir, 'tasks-input.json'));
  const recs = [];
  try {
    for (const e of fs.readdirSync(dir)) {
      if (!e.endsWith('.json') || RECORD_FILES.has(e)) continue;
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

// job 列表：jobs/*（新）+ 项目 .wbx/tasks/*（v2 旧）+ 项目 .wbx/jobs/*（项目形态时期，只读兼容）
export function listJobs() {
  const rows = [];
  const seen = new Set();
  try {
    for (const e of fs.readdirSync(JOBS_DIR)) {
      const dir = path.join(JOBS_DIR, e);
      if (!fs.statSync(dir).isDirectory()) continue;
      rows.push(summarizeJob(e, dir));
      seen.add(e);
    }
  } catch { /* jobs 目录不存在 */ }
  const legacyRoots = [LEGACY_TASKS_DIR, LEGACY_JOBS_DIR];
  for (const legacyRoot of legacyRoots) {
    if (!legacyRoot || legacyRoot === JOBS_DIR || !fs.existsSync(legacyRoot)) continue;
    try {
      for (const e of fs.readdirSync(legacyRoot)) {
        if (seen.has(e)) continue;
        const dir = path.join(legacyRoot, e);
        if (!fs.statSync(dir).isDirectory()) continue;
        rows.push(summarizeJob(e, dir, { legacy: true }));
      }
    } catch { /* 忽略 */ }
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
      if (!recById.has(rec.id) || !tasks.some((t) => t.id === rec.id)) {
        if (!tasks.some((t) => t.id === rec.id)) tasks.push({ id: rec.id, prompt: null, record: rec });
      }
    }
    return { ...summary, manifest, summaryMd, tasks };
  }
  return null;
}

// ---------- 汇总 markdown ----------
export function buildSummaryMd({ type, tasks, results, totalMs, laneKeys, laneParallel, timeoutS, retry, jobId }) {
  const okCount = results.filter((r) => r.status === 'success').length;
  const tin = results.reduce((s, r) => s + (r.usage?.in || 0), 0);
  const tout = results.reduce((s, r) => s + (r.usage?.out || 0), 0);
  const rl = results.filter((r) => isRateLimit(r.error)).length;
  const lines = [];
  lines.push(`# WBX ${type} 汇总`, '');
  lines.push(`- job：${jobId}`);
  lines.push(`- 时间：${new Date().toLocaleString('zh-CN')}`);
  if (type === 'fanout') {
    lines.push(`- 任务数：${tasks.length}；lanes：${laneKeys.join(',')}；每 lane 并发：${laneParallel}（总并发 ${laneParallel * laneKeys.length}）；单任务超时：${timeoutS}s；重试：${retry}（+跨 lane 回退 1 次）`);
  }
  lines.push(`- 结果：成功 ${okCount} / 失败 ${tasks.length - okCount}（成功率 ${(okCount / tasks.length * 100).toFixed(0)}%）`);
  lines.push(`- 总耗时：${fmtMs(totalMs)}；tokens：in ${tin} / out ${tout}`, '');
  lines.push('| id | lane | 状态 | 耗时 | tokens(in/out) | 尝试 | 模型 |', '|---|---|---|---|---|---|---|');
  for (const r of results) {
    const lane = r.fallbackFrom ? `${r.fallbackFrom}→${r.lane}` : r.lane;
    lines.push(`| ${r.id} | ${lane} | ${r.status === 'success' ? '✅' : '❌'} ${r.status} | ${fmtMs(r.durationMs)} | ${r.usage?.in ?? '-'}/${r.usage?.out ?? '-'} | ${r.attempts} | ${r.model} |`);
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
 * runAskJob：单条 ask，含回退链与 job 落盘。返回：
 *   { ok, jobId, jobDir, lane, fallbackFrom, model, usage, durationMs, text|error, kind }
 */
export async function runAskJob({ prompt, as = null, model = null, effort = null, timeoutS = 300, jobId = null }) {
  ensureDirs();
  const cfg = loadConfig();
  let primary = as ? parseLane(as) : null;
  if (as && !primary) throw new Error(`--as 只支持 ai | cn | cline（收到 ${as}）`);
  if (!as) primary = resolveDefaultLane();
  if (isLaneDisabled(primary)) {
    throw new Error(`lane ${primary} 已被 disabled-lanes 硬禁用。启用：wbx config set disabled-lanes []`);
  }
  const fb = fallbackLane(primary);
  const chain = fb && fb !== primary ? [primary, fb] : [primary];

  const job = await createJob('ask', { promptPreview: brief(prompt, 120), as: as || 'auto', model: resolveModel(model), effort, timeoutS }, { lanes: chain, tasksInput: [{ id: 'ask', prompt }], jobId });

  let last = null, usedLane = null, fallbackFrom = null, res = null, attempts = 0;
  for (const lane of chain) {
    attempts++;
    res = await askOnce({ lane, prompt, model, effort, timeoutMs: timeoutS * 1000 });
    if (res.ok) { usedLane = lane; break; }
    last = res;
    if (lane !== primary) break;
    if (fb) console.error(`[WARN] lane ${lane} 失败（kind=${res.kind}），自动改投 lane ${fb}…`);
  }
  const rec = {
    id: 'ask',
    lane: res?.ok ? usedLane : primary,
    status: res?.ok ? 'success' : 'failed',
    attempts,
    durationMs: res?.durationMs ?? 0,
    model: res?.ok ? res.model : resolveModel(model),
    effort: effort || null,
    usage: res?.usage || null,
  };
  if (res?.ok) rec.result = res.text; else { rec.error = `${res?.kind}: ${res?.error || (last?.kind + ': ' + (last?.error || ''))}`; if (res?.hint) rec.hint = res.hint; if (res?.resetIn) rec.resetIn = res.resetIn; }
  if (res?.rawStream) {
    await fsp.writeFile(path.join(job.dir, 'ask.cline-stream.jsonl'), res.rawStream, 'utf8');
  }
  await writeTaskRecord(job.dir, rec);
  await finalizeJob(job.dir, { total: 1, ok: res?.ok ? 1 : 0, durationMs: res?.durationMs ?? 0 });
  const md = buildSummaryMd({ type: 'ask', tasks: [{ id: 'ask' }], results: [rec], totalMs: 0, jobId: job.id });
  await fsp.writeFile(path.join(job.dir, 'summary.md'), md, 'utf8');

  if (res?.ok) {
    return { ok: true, jobId: job.id, jobDir: job.dir, lane: usedLane, fallbackFrom: usedLane !== primary ? primary : null, model: res.model, usage: res.usage, durationMs: res.durationMs, text: res.text };
  }
  return { ok: false, jobId: job.id, jobDir: job.dir, lane: primary, kind: res?.kind || last?.kind, error: res?.error || last?.error, hint: res?.hint || last?.hint, ...(res?.resetIn || last?.resetIn ? { resetIn: res?.resetIn || last?.resetIn } : {}) };
}

/**
 * runFanoutJob：批量并发（双 lane 动态均衡 + 重试 + 跨 lane 回退 + job 落盘）。
 * tasksIn: [{id, prompt, as?, model?, effort?}]；返回 { jobId, jobDir, okCount, total, results }。
 */
export async function runFanoutJob({ tasksIn, lanes = null, parallel = null, timeoutS = 300, retry = null, log = null, jobId = null }) {
  ensureDirs();
  const cfg = loadConfig();
  const say = log || (() => {});

  let laneKeys;
  if (lanes && lanes.length) {
    laneKeys = lanes;
  } else {
    laneKeys = LANE_ORDER.filter((k) => laneReady(k) && !isLaneDisabled(k));
    if (!laneKeys.length) {
      laneKeys = enabledLanes();
      say(`[WARN] 没有任何已登录且未禁用的 lane，退回 ${laneKeys.join(',')}（任务会认证失败；请先 wbx login）`);
    }
  }
  const disabledHit = laneKeys.filter((k) => isLaneDisabled(k));
  if (disabledHit.length) throw new Error(`lane ${disabledHit.join(',')} 已被 disabled-lanes 硬禁用。启用：wbx config set disabled-lanes []`);

  const seen = new Set();
  const tasks = [];
  for (let i = 0; i < tasksIn.length; i++) {
    const t = tasksIn[i] || {};
    if (!t.prompt || !String(t.prompt).trim()) throw new Error(`任务 ${i}（${t.id ?? '?'}）缺少 prompt`);
    let id = sanitizeId(t.id ?? `task-${i + 1}`);
    while (seen.has(id)) id = id + '-2';
    seen.add(id);
    let lane = null;
    if (t.as != null) {
      lane = parseLane(t.as);
      if (!lane) throw new Error(`任务 ${t.id} 的 as 只支持 ai|cn|cline`);
    }
    tasks.push({ id, prompt: String(t.prompt), lane, model: t.model || null, effort: t.effort || null });
  }

  const laneParallel = Math.max(1, parallel ?? cfg['parallel-per-lane'] ?? 2);
  // cline lane 并发单独受 cline-parallel 约束（默认 1，免费额度保护；--parallel 不抬升它）
  const laneParallelOf = (lane) => (lane === 'cline' ? Math.max(1, cfg['cline-parallel'] || 1) : laneParallel);
  const timeoutMs = timeoutS * 1000;
  const retryN = Math.max(0, retry ?? 1);

  const job = await createJob('fanout',
    { lanes: laneKeys, parallel: laneParallel, timeoutS, retry: retryN, count: tasks.length },
    { lanes: laneKeys, tasksInput: tasks, jobId });

  say(`开始：${tasks.length} 个任务，lanes ${laneKeys.join(',')}，每 lane 并发 ${laneKeys.map((k) => `${k}=${laneParallelOf(k)}`).join(' ')}，超时 ${timeoutS}s，重试 ${retryN}`);

  const sharedQueue = [];
  const laneBuckets = new Map(laneKeys.map((k) => [k, []]));
  tasks.forEach((task, i) => {
    task.index = i;
    if (task.lane && laneKeys.includes(task.lane)) laneBuckets.get(task.lane).push(task);
    else {
      if (task.lane) say(`${task.id} 绑定 lane ${task.lane} 未启用，改投公共队列`);
      sharedQueue.push(task);
    }
  });

  const results = new Array(tasks.length);
  const t0 = Date.now();

  async function runTask(task, lane) {
    const started = Date.now();
    const mdl = task.model; // 传给 askOnce 的显式模型（null -> core 按配置解析）
    let res = null, attempts = 0;
    for (let a = 0; a <= retryN; a++) {
      attempts = a + 1;
      res = await askOnce({ lane, prompt: task.prompt, model: mdl, effort: task.effort, timeoutMs });
      if (res.ok) break;
      if (a < retryN) {
        const rl = res.hint === 'ratelimit' || isRateLimit(res.error);
        say(`${task.id}@${lane} 失败（${res.kind}），${rl ? '5s' : '2s'} 后重试 ${a + 1}/${retryN}`);
        await sleep(rl ? 5000 : 2000);
      }
    }
    let usedLane = lane, fallbackFrom = null;
    if (!res.ok) {
      const fb = fallbackLane(lane);   // 跨 lane 回退（仅一次；禁用 lane 自动跳过）
      if (fb) {
        attempts++;
        say(`${task.id}@${lane} 用尽重试（${res.kind}），跨 lane 回退 -> ${fb}`);
        res = await askOnce({ lane: fb, prompt: task.prompt, model: mdl, effort: task.effort, timeoutMs });
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
      model: res.ok ? res.model : resolveModel(mdl),
      effort: task.effort || null,
      usage: res.usage || null,
    };
    if (res.ok) rec.result = res.text;
    else rec.error = `${res.kind}: ${res.error || ''}`;
    if (res.rawStream) {
      // cline lane：原始 NDJSON 事件流全文落盘，供回放与解析器迭代（RESEARCH 设计 §3.2-5）
      await fsp.writeFile(path.join(job.dir, `${sanitizeId(task.id)}.cline-stream.jsonl`), res.rawStream, 'utf8');
    }
    results[task.index] = rec;
    await writeTaskRecord(job.dir, rec);
    say(`${task.id}${fallbackFrom ? `（${fallbackFrom}→${usedLane} 回退）` : `@${usedLane}`} -> ${rec.status}（${fmtMs(rec.durationMs)}，尝试 ${attempts}）`);
  }

  async function runWorker(lane) {
    for (;;) {
      const task = sharedQueue.shift() ?? laneBuckets.get(lane).shift();
      if (!task) return;
      await runTask(task, lane);
    }
  }

  const workers = [];
  for (const lane of laneKeys) {
    const n = Math.min(laneParallelOf(lane), tasks.length);
    for (let i = 0; i < n; i++) workers.push(runWorker(lane));
  }
  await Promise.all(workers);

  const totalMs = Date.now() - t0;
  const okCount = results.filter((r) => r.status === 'success').length;
  await finalizeJob(job.dir, { total: tasks.length, ok: okCount, durationMs: totalMs });
  const md = buildSummaryMd({ type: 'fanout', tasks, results, totalMs, laneKeys, laneParallel, timeoutS, retry: retryN, jobId: job.id });
  await fsp.writeFile(path.join(job.dir, 'summary.md'), md, 'utf8');
  return { jobId: job.id, jobDir: job.dir, okCount, total: tasks.length, results };
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
  const identity = IDENTITIES[laneKey] || IDENTITIES.cn;
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
  await fsp.writeFile(id.productPath, JSON.stringify(cfg), 'utf8');
}

// ---------- doctor（结构化，CLI 与 UI 共用） ----------
export async function doctorStatus({ probe = true, onLine = null } = {}) {
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
  const routeNote = dl === 'auto' ? 'auto（ai 免费优先）' : dl;
  step('route', null, `default-lane=${routeNote}${disabled.length ? `；disabled-lanes=[${disabled.join(',')}]` : ''}${dl !== 'auto' && disabled.includes(dl) ? '（⚠ default-lane 指向的 lane 已禁用，实际按 auto 处理）' : ''}`);

  // 5) 模板缓存（登录前置条件；cline 走独立认证，无模板概念）
  for (const key of LANE_ORDER) {
    if (key === 'cline') continue;
    const id = IDENTITIES[key];
    const has = fs.existsSync(id.templatePath);
    if (!has) say(`[SKIP] 模板    lane ${key} 缺 ${id.templatePath}（修复：启动一次${LANE_BRAND[key]}桌面版）`);
  }

  // 6) 每 lane 凭证 + 探测（ai/cn；cline 在第 7 段单独体检）
  for (const key of LANE_ORDER) {
    if (key === 'cline') continue;
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
    if (!probe) { laneRows.push({ ...info, probe: null }); continue; }
    say(`${LANE_BRAND[key]} 模型探测中（tiny ask）…`);
    const p = await askOnce({ lane: key, prompt: '请只回复两个字符：OK', effort: 'low', timeoutMs: 120000 });
    if (p.ok) {
      const detail = `${p.model} 可用，${fmtMs(p.durationMs)}，tokens in/out = ${p.usage.in ?? '?'}/${p.usage.out ?? '?'}`;
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
      const cfgC = loadConfig();
      const ver = await spawnBin(resolveClinePath(), ['--version'], { env: clineSpawnEnv(), timeoutMs: 30000 });
      const verStr = ansiStrip(ver.stdout || '').trim().split(/\r?\n/)[0] || '?';
      say(`[OK]   凭证     已登录（OAuth，provider=${cfgC['cline-provider']}，model=${cfgC['cline-model'] || 'provider 默认'}，thinking=${cfgC['cline-thinking']}，compaction=${cfgC['cline-compaction']}，cline v${verStr}，隔离目录 ${clineHomeDir()}）`);
      steps.push({ name: 'lane-cline', good: true, detail: `已登录（cline v${verStr}，model=${cfgC['cline-model'] || '默认'}）` });

      // v5.1 免费孪生存在性校验（P0-1）：免费组会轮换，端点确认 cline-model 是否仍在组内。
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
          const fd = `cline-model=${curModel} 不在当前免费组（可能已被轮换下线，或为计费 id）。当前免费：${fm.models.map((m) => m.id).join('、')}${srcNote}。换用：wbx config set cline-model "<免费 id>"（清单：wbx models --as cline --free）`;
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
          const cost = p.usage && typeof p.usage.cost === 'number' ? p.usage.cost : null;
          const detail = `${p.model} 可用，${fmtMs(p.durationMs)}，tokens in/out = ${p.usage.in ?? '?'}/${p.usage.out ?? '?'}${cost != null ? `，本次计价 $${cost.toFixed(6)}${cost === 0 ? '（免费）' : ''}` : ''}`;
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

  const ready = loggedLanes().filter((k) => !isLaneDisabled(k));
  if (!ready.length) fail++;
  const probeable = laneRows.filter((r) => r.probe);
  if (ready.length && probe && probeable.length && probeable.every((r) => !r.probe.good)) fail++;

  return {
    ok: fail === 0, fail, form, runtimeRoot: RUNTIME_ROOT, version: WBX_VERSION,
    cliPath, steps, lanes: laneRows, config: cfg, readyLanes: ready,
  };
}

// ---------- 用户级 AGENTS.md 标记块（install-user / self-install 共用） ----------
export const USER_AGENTS_PATH = path.join(HOME, '.zcode', 'AGENTS.md');
export const USER_BLOCK_BEGIN = '<!-- wbx:begin -->';
export const USER_BLOCK_END = '<!-- wbx:end -->';

export function userBlockText(bridgeScriptPath) {
  const wbx = `node "${bridgeScriptPath}"`;
  return [
    USER_BLOCK_BEGIN,
    '## wbx 外部算力桥（三 lane 子代理：默认分派，放开用）',
    '',
    `本机装有 wbx 桥（入口 "${bridgeScriptPath}"）：三个外部 Agent 当作你的子代理，高频、放量调用`,
    '（几乎免费，不必为省 token 收着用）。lane：ai/cn = WorkBuddy 双 lane 的 DeepSeek V4.1 Flash',
    '（国际版免费/国内版近免费）；cline = Cline CLI（可选第三 lane，默认免费调 DeepSeek——',
    'cline-free/deepseek-v4.1-flash 孪生，限时轮换+每日配额，thinking=xhigh；免费清单：wbx models --as cline --free）。',
    '自包含（v4 公理）：全部输入可由你打包进提示词（材料先行）、输出可独立校验即可外包——含代码模块编写：',
    '',
    '```bash',
    `${wbx} doctor                     # 先自检；可用 lane 全红 -> 提示用户 login，任务自己做`,
    `${wbx} ask --file <p.txt>           # 单条（--as ai|cn|cline 指定 lane，默认路由见 config，失败自动回退）`,
    `${wbx} fanout --file <tasks.json>   # 并行批量（任务可用 files:[路径] 拼材料；结果落 ~/.wbx/jobs/<jobId>/）`,
    `${wbx} ui --detach                 # 常开网页控制台 http://127.0.0.1:7788（幂等后台守护；--stop 停止；`,
    '                                   #  --install-autostart 随 ZCode 新会话自动拉起，--remove-autostart 摘除）',
    '```',
    '',
    '默认分派（v5 基线反转）：凡自包含任务（输入可打包、输出可校验）即为候选——单个调研、翻译、',
    '抽取、模块实现也直接派，不必凑「≥2 对象/≥3 模块」。消耗豁免：不为省 token 压低 effort 或裁剪材料',
    '（裁剪只为信噪比）。关键产物（关键代码模块/文案）并行 2 份择优（T8 best-of-N）；代码模块集成前',
    '默认过一道评审批判（T7）——多一次免费调用换质量下限。fanout ≥6 任务或结果很长时，用自己的子代理',
    '管理整批、主上下文只收摘要（层级 ≤2）。',
    '',
    '防护不变：结果必校验后才用；涉密/隐私/凭证绝不外包；worker 无工具（提示词用「角色+任务+材料+',
    '输出硬约束+无工具声明」模板，详见桥 PROMPTS.md v2，模板 T1–T9）；doctor FAIL、连续 >= 2 失败或',
    '限流 -> 停止外包，改由自己完成并如实告知用户。完整文档/卸载：桥项目文件夹内 WBX.md、UNINSTALL.md。',
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
