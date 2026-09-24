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
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WBX_VERSION = '3.0.0';

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
export const LANE_ORDER = ['ai', 'cn'];     // 默认路由顺序：免费优先
const FALLBACK_ORDER = ['cn', 'ai'];        // 回退顺序：国内版（微信扫码路径稳定）兜底

const DEFAULT_CLI_PATH = 'D:\\App\\WorkBuddyAI\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy';
const FALLBACK_MODEL = 'deepseek-v4.1-flash';

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
    type: 'enum', values: ['auto', 'ai', 'cn'], default: 'auto',
    desc: 'ask 默认路由：auto=ai 优先（免费），或固定 ai / cn',
  },
  'disabled-lanes': {
    type: 'lanes', default: [],
    desc: '硬禁用的 lane 列表（doctor 标注、fanout 默认 lanes 与回退链跳过），如 ["cn"]',
  },
  'parallel-per-lane': {
    type: 'int', min: 1, max: 8, default: 2,
    desc: 'fanout 每 lane 并发上限（默认 2）',
  },
  'model': {
    type: 'string', default: FALLBACK_MODEL,
    desc: '默认模型 id',
  },
  'cli-path': {
    type: 'string', default: '',
    desc: 'CodeBuddy CLI 入口路径（优先级低于 WBX_CLI env；doctor 可自动探测写入）',
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
  out['disabled-lanes'] = out['disabled-lanes'].filter((x) => x === 'ai' || x === 'cn');
  if (!Number.isInteger(out['parallel-per-lane']) || out['parallel-per-lane'] < 1 || out['parallel-per-lane'] > 8) {
    out['parallel-per-lane'] = 2;
  }
  if (typeof out.model !== 'string' || !out.model) out.model = FALLBACK_MODEL;
  if (typeof out['cli-path'] !== 'string') out['cli-path'] = '';
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
      const bad = v.filter((x) => x !== 'ai' && x !== 'cn');
      if (bad.length) throw new Error(`${key} 只支持 ai/cn（收到 ${JSON.stringify(bad)}）`);
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
  const id = IDENTITIES[laneKey];
  return !!id && fs.existsSync(id.sessionPath) && fs.existsSync(id.productPath);
}

export function isLaneDisabled(laneKey) { return loadConfig()['disabled-lanes'].includes(laneKey); }

export function enabledLanes() { return LANE_ORDER.filter((k) => !isLaneDisabled(k)); }

export function loggedLanes() { return LANE_ORDER.filter(laneReady); }

// 非_secret_ 的 lane 状态摘要（UI/doctor 安全展示用：只含昵称/脱敏 uin/到期，绝无 token）
export function laneStatusInfo(laneKey) {
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

// 默认路由：config.default-lane 固定 ai/cn（未禁用），否则 auto（enabled+已登录 里 ai 优先）
export function resolveDefaultLane() {
  const pick = loadConfig()['default-lane'];
  if ((pick === 'ai' || pick === 'cn') && !isLaneDisabled(pick)) return pick;
  for (const k of LANE_ORDER) {
    if (!isLaneDisabled(k) && laneReady(k)) return k;
  }
  const enabled = enabledLanes();
  return enabled[0] || 'cn';
}

// 回退 lane：另一侧已登录且未禁用的 lane；没有则 null
export function fallbackLane(fromKey) {
  for (const k of FALLBACK_ORDER) {
    if (k !== fromKey && laneReady(k) && !isLaneDisabled(k)) return k;
  }
  return null;
}

export function parseLane(v) {
  const k = String(v || '').toLowerCase();
  return IDENTITIES[k] ? k : null;
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

export function spawnNode(args, { env, timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: env || process.env, windowsHide: true, cwd: RUNTIME_ROOT });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs) : null;
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
 */
export async function askOnce({ lane, prompt, model, effort, timeoutMs = 300000 }) {
  const laneKey = IDENTITIES[lane] ? lane : 'cn';
  const mdl = resolveModel(model);
  const args = [
    resolveCliPath(), '-p', prompt,
    '--model', mdl,
    '--tools', '',                       // 纯 LLM 无工具模式（对标桌面版 Quick 模式）
    '--output-format', 'json',
    '--no-session-persistence',
    '--max-turns', '1',
  ];
  if (effort) args.push('--effort', effort);

  const t0 = Date.now();
  const r = await spawnNode(args, { env: baseEnv(laneKey), timeoutMs });
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
  if (as && !primary) throw new Error(`--as 只支持 ai | cn（收到 ${as}）`);
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
  if (res?.ok) rec.result = res.text; else { rec.error = `${res?.kind}: ${res?.error || (last?.kind + ': ' + (last?.error || ''))}`; if (res?.hint) rec.hint = res.hint; }
  await writeTaskRecord(job.dir, rec);
  await finalizeJob(job.dir, { total: 1, ok: res?.ok ? 1 : 0, durationMs: res?.durationMs ?? 0 });
  const md = buildSummaryMd({ type: 'ask', tasks: [{ id: 'ask' }], results: [rec], totalMs: 0, jobId: job.id });
  await fsp.writeFile(path.join(job.dir, 'summary.md'), md, 'utf8');

  if (res?.ok) {
    return { ok: true, jobId: job.id, jobDir: job.dir, lane: usedLane, fallbackFrom: usedLane !== primary ? primary : null, model: res.model, usage: res.usage, durationMs: res.durationMs, text: res.text };
  }
  return { ok: false, jobId: job.id, jobDir: job.dir, lane: primary, kind: res?.kind || last?.kind, error: res?.error || last?.error, hint: res?.hint || last?.hint };
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
      if (!lane) throw new Error(`任务 ${t.id} 的 as 只支持 ai|cn`);
    }
    tasks.push({ id, prompt: String(t.prompt), lane, model: t.model || null, effort: t.effort || null });
  }

  const laneParallel = Math.max(1, parallel ?? cfg['parallel-per-lane'] ?? 2);
  const timeoutMs = timeoutS * 1000;
  const retryN = Math.max(0, retry ?? 1);

  const job = await createJob('fanout',
    { lanes: laneKeys, parallel: laneParallel, timeoutS, retry: retryN, count: tasks.length },
    { lanes: laneKeys, tasksInput: tasks, jobId });

  say(`开始：${tasks.length} 个任务，lanes ${laneKeys.join(',')}，每 lane 并发 ${laneParallel}（总 ${laneParallel * laneKeys.length}），超时 ${timeoutS}s，重试 ${retryN}`);

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
    const n = Math.min(laneParallel, tasks.length);
    for (let i = 0; i < n; i++) workers.push(runWorker(lane));
  }
  await Promise.all(workers);

  const totalMs = Date.now() - t0;
  const okCount = results.filter((r) => r.status === 'success').length;
  await finalizeJob(job.dir, { total: tasks.length, ok: okCount, durationMs: totalMs });
  const md = buildSummaryMd({ type: 'fanout', tasks, results, totalMs, laneKeys, laneParallel, timeoutS: timeoutS / 1000, retry: retryN, jobId: job.id });
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

  // 5) 模板缓存（登录前置条件）
  for (const key of LANE_ORDER) {
    const id = IDENTITIES[key];
    const has = fs.existsSync(id.templatePath);
    if (!has) say(`[SKIP] 模板    lane ${key} 缺 ${id.templatePath}（修复：启动一次${id.label}桌面版）`);
  }

  // 6) 每 lane 凭证 + 探测
  for (const key of LANE_ORDER) {
    const info = laneStatusInfo(key);
    const id = IDENTITIES[key];
    say('');
    say(`--- lane ${key}（${id.label} · ${id.cost}${info.disabled ? ' · 已禁用' : ''}）---`);
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
    say(`lane ${key} 模型探测中（tiny ask）…`);
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
    '## wbx 外部算力桥（全局主动分派）',
    '',
    `本机装有 wbx 桥（入口 "${bridgeScriptPath}"）：把「相互独立、纯文本进出、单轮可完成」的子任务`,
    '并行分派给 WorkBuddy 账号下的 DeepSeek V4.1 Flash（国际版免费 / 国内版近免费）。任何项目可用：',
    '',
    '```bash',
    `${wbx} doctor                     # 先自检；凭证红 -> 提示用户 login，任务自己做`,
    `${wbx} ask --file <p.txt>           # 单条（--as ai|cn 指定 lane，默认路由见 config，失败自动回退）`,
    `${wbx} fanout --file <tasks.json>   # 并行批量（结果落 ~/.wbx/jobs/<jobId>/）`,
    '```',
    '',
    '主动分派时机（无需用户明说「外包/并行」）：',
    '- 需要并行调研/对比 >= 2 个对象（竞品、库、工具、软件）→ 每对象一个 worker 任务，要求带来源清单',
    '- 批量文本：翻译、摘要、改写、变体生成、结构化抽取、分类打标',
    '- 接口清晰、可独立验证的代码模块，其中无上下文依赖的部分（主会话负责接口定义、集成、审查）',
    '',
    '规则：worker 提示词用「角色+任务+材料+输出硬约束+无工具声明」模板（详见桥 SKILL.md）；',
    '结果必须校验后使用；涉密/隐私/凭证绝不外包；doctor FAIL、连续 >= 2 失败或限流 -> 停止外包，',
    '改由自己完成并如实告知用户。完整文档/卸载：桥项目文件夹内 WBX.md、PLAN.md、UNINSTALL.md。',
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
