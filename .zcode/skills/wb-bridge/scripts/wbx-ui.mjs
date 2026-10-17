/**
 * wbx-ui — wbx 桥本地 Web UI（守护化 + 安全校验）
 *
 * 零第三方依赖（原生 node:http），只监听 127.0.0.1，内嵌单页前端（HTML/CSS/vanilla JS，
 * 不引任何外部 CDN，离线可用）。`wbx ui` 前台启动（自动开浏览器，Ctrl+C 即退）；
 * `wbx ui --detach` 幂等拉起守护进程（生命周期见 wbx-daemon.mjs）。
 *
 * API（全 JSON）：
 *   GET  /api/status                 概览（lane 状态/到期倒计时/配置/形态 + 累计 token 用量）——不含任何凭证
 *   GET  /api/doctor?probe=1         体检（probe=1 含模型探测，较慢）
 *   GET  /api/doubao                 豆包桥工具状态（Doubao.exe 进程态 + 9225 CDP 探测；v12.1）
 *   GET  /api/balance                各 lane 余额（v6.8：WorkBuddy 双 lane 社区 billing 端点，显式标非官方；
 *                                    cline/doubao 返回 na；失败优雅降级，绝不包含凭证）
 *   POST /api/doubao/ensure          幂等确保豆包以调试口运行（v6.8 桥自治：CDP 在线零触碰；不可达经
 *                                    launch.ps1 拉起/-Force 重启）-> {ok, action: online|launched|restarted|failed|unavailable}
 *   GET  /api/history                job 列表（含旧 .wbx/tasks/ 兼容条目 + 全量 token 用量汇总）
 *   GET  /api/job/:id[?brief=1]      job 详情（brief 不含 prompt/回复正文，用于轮询）
 *   POST /api/ask                    {prompt, lane, model, effort, timeout, caps} -> {jobId}（caps=L0|L1|L2，v6）
 *   POST /api/fanout                 {tasks:[{id,prompt,as,caps}], lanes, parallel, timeout, retry} -> {jobId}
 *   POST /api/config                 {key, value} -> 写 <运行时根>/config.json
 *   POST /api/login/start            {lane} -> {authUrl, tips}（登录流在 server 侧跑）
 *   GET  /api/login/poll             登录轮询状态
 *   GET  /__health                   健康检查 -> {app:'wbx-ui', pid, port, version}（前台/守护都有）
 *   GET  /manifest.webmanifest       PWA manifest（v6.8；零外链——图标由本文件纯函数自产）
 *   GET  /icons/icon-{192,512}.png   PWA 图标（手写最小 PNG：zlib + CRC32，确定性输出零落盘）
 *   POST /__shutdown                 {token} 优雅关闭（仅守护模式；token 存 run/ui.json，绝不外泄）
 *
 * 安全校验（前台/守护一律生效）：
 *   - Host 头白名单：仅 127.0.0.1(:port) / localhost(:port)，其余 403（防 DNS rebinding）
 *   - POST 一律校验 Origin：同源或无 Origin（非浏览器客户端），其余 403
 *
 * 红线：任何响应绝不包含 accessToken/refreshToken（laneStatusInfo 只产昵称/脱敏 uin/到期）。
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  WBX_VERSION, RUNTIME_ROOT, JOBS_DIR,
  LANE_ORDER, CONFIG_DEFS, UI_DEFAULT_PORT, crc32,
  bridgeForm, doubaoCdpProbe, doubaoProcessRunning,
  redact, loadConfig, setConfig, parseLane, parseCapsSet,
  laneStatusInfo, resolveDefaultLane, newJobId, getJob, listJobs,
  runAskJob, runFanoutJob, doctorStatus, fetchClineFreeModels,
  laneBalance, ensureDoubao,
  startLogin, pollLoginToken, fetchAccountInfo, persistLogin,
  openBrowser, ensureDirs,
} from './wbx-core.mjs';
import { hostHeaderAllowed, originAllowed } from './wbx-daemon.mjs';

// 守护上下文与监听端口（startUiServer 时设置；handler 里做安全校验与 shutdown 用）
let LISTEN_PORT = UI_DEFAULT_PORT;
let DAEMON_CTX = null;   // { token, persist(state), clear(), onShutdown() }
let SERVER = null;

// ---------- 模板插值常量（路径/lane 选项单源；新增第六 lane 只改这里与 core LANE_ORDER） ----------
const WBX_ENTRY_CMD = 'node "%USERPROFILE%\\.zcode\\wbx-bridge\\scripts\\wbx.mjs"';   // 全局入口命令（cmd 写法，复制即用）
const DOUBAO_LAUNCH_CMD = 'powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\\.zcode\\wbx-bridge\\doubao\\launch.ps1"';
const LANE_ROUTE_LABELS = { codex: '固定 Codex', ai: '固定 WorkBuddy AI', cn: '固定 WorkBuddy', cline: '固定 Cline', doubao: '固定 豆包' };
const LANE_SHORT_LABELS = { codex: 'Codex', ai: 'WorkBuddy AI', cn: 'WorkBuddy', cline: 'Cline', doubao: '豆包' };
const laneRouteButtons = LANE_ORDER.map((k) => `<button data-v="${k}">${LANE_ROUTE_LABELS[k]}</button>`).join('\n          ');
const laneShortButtons = LANE_ORDER.map((k) => `<button data-v="${k}">${LANE_SHORT_LABELS[k]}</button>`).join('\n            ');

// ---------- 前端模板（ui.html 资产：唯一事实源；运行时读取+单点插值，v23 资产化） ----------
// 模板外置=零依赖运行时读取（node:fs 内置；对外仍单 HTML 响应），免反引号与插值转义、免双副本构建同步。
// 插值=占位符纯字符串替换（本函数单点）；任何 __WBX_ 残留=模板与映射脱钩，启动即抛错（fail-fast，绝不带残服务）。
const UI_HTML_PATH = new URL('./ui.html', import.meta.url);   // 字面量文件名+模块 URL 锚（发布清单/打包器可静态感知）
function renderHtml(tpl) {
  const vars = {
    __WBX_ENTRY_CMD__: WBX_ENTRY_CMD,
    __WBX_DOUBAO_LAUNCH_CMD__: DOUBAO_LAUNCH_CMD,
    __WBX_LANE_ROUTE_BUTTONS__: laneRouteButtons,
    __WBX_LANE_SHORT_BUTTONS__: laneShortButtons,
    __WBX_LANE_ORDER_UI__: LANE_ORDER.join("','"),
  };
  let out = tpl;
  for (const [name, val] of Object.entries(vars)) out = out.split(name).join(val);
  if (out.includes('__WBX_')) throw new Error('ui.html 存在未替换的 __WBX_*__ 占位符残留（模板与插值映射脱钩）');
  return out;
}
const HTML = renderHtml(fs.readFileSync(UI_HTML_PATH, 'utf8'));   // 启动期一次读取（进程内常量，此后与旧内联模板同用法）

// ---------- 登录服务端状态（内存，单登录流；定义见路由区） ----------

// ---------- PWA（manifest + 自产图标；零外链红线——图标纯函数生成，零落盘，确定性输出） ----------
const PWA_MANIFEST = JSON.stringify({
  name: 'wbx 桥控制台',
  short_name: 'wbx',
  start_url: '/',
  display: 'standalone',
  background_color: '#f4f6fb',   // 浅色 --bg（默认主题）
  theme_color: '#f4f6fb',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
});
const ICON_CACHE = new Map();   // 确定性输出：同 size 首次生成后复用同 Buffer
function iconPng(size) {
  let buf = ICON_CACHE.get(size);
  if (!buf) { buf = renderIconPng(size); ICON_CACHE.set(size, buf); }
  return buf;
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EMPTY = Buffer.alloc(0);

// crc32/CRC_TABLE 自 wbx-core 导入（v22 单源：与 wbx-setup zip 共用）

// PNG chunk 不变量：length(4 BE, 仅 data) + type(4) + data + crc(4 BE, 覆盖 type+data)
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// 点到线段距离平方（round cap/join 由 sw/2 半径统一表达）
function dist2Seg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? (wx * vx + wy * vy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = wx - t * vx, dy = wy - t * vy;
  return dx * dx + dy * dy;
}

// 圆角方形覆盖判定：到内缩矩形 [r,size-r]^2 的欧氏距离 <= r
function inRoundRect(x, y, size, r) {
  const dx = x < r ? r - x : x > size - r ? x - (size - r) : 0;
  const dy = y < r ? r - y : y > size - r ? y - (size - r) : 0;
  return dx * dx + dy * dy <= r * r;
}

const SS = 4;                        // 4x4 超采样：每像素固定 16 个样本，样本坐标 (i+0.5)/SS
const BG = [0x25, 0x63, 0xeb];       // 底色 #2563eb（浅色主题 --acc 同族，品牌连续）
const FG = [0xff, 0xff, 0xff];       // 白字

function renderIconPng(size) {
  if (size !== 192 && size !== 512) throw new Error('size must be 192 or 512');

  const r = size * 0.18;
  const sw = size * 0.11, half2 = (sw / 2) * (sw / 2);
  const cx = size / 2, cy = size / 2;
  const gw = size * 0.64, gh = size * 0.30;
  const left = cx - gw / 2, right = cx + gw / 2;
  const top = cy - gh / 2, bot = cy + gh / 2;
  const m1 = left + gw * 0.25, m2 = left + gw * 0.75;
  // w 形态：四条线段构成两个 V，下-上-下-上
  const seg = [
    [left, top, m1, bot],
    [m1, bot, cx, top],
    [cx, top, m2, bot],
    [m2, bot, right, top],
  ];
  const inW = (x, y) => {
    for (let i = 0; i < seg.length; i++) {
      const s = seg[i];
      if (dist2Seg(x, y, s[0], s[1], s[2], s[3]) <= half2) return true;
    }
    return false;
  };

  // 原始像素流不变量：每 scanline = 1 字节 filter(0) + size*4 字节 RGBA
  const stride = 1 + size * 4;
  const raw = Buffer.alloc(size * stride);
  const inv = 1 / (SS * SS);

  for (let py = 0; py < size; py++) {
    let p = py * stride;
    raw[p++] = 0;
    for (let px = 0; px < size; px++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;   // 覆盖度混合：样本内为不透明，按覆盖样本数取均值
      for (let sy = 0; sy < SS; sy++) {
        const y = py + (sy + 0.5) / SS;
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          if (!inRoundRect(x, y, size, r)) continue;
          const w = inW(x, y);
          ar += w ? FG[0] : BG[0];
          ag += w ? FG[1] : BG[1];
          ab += w ? FG[2] : BG[2];
          aa++;
        }
      }
      if (aa === 0) { p += 4; continue; }   // 全覆盖外样本：RGBA 保持 0
      raw[p++] = Math.round(ar / aa);
      raw[p++] = Math.round(ag / aa);
      raw[p++] = Math.round(ab / aa);
      raw[p++] = Math.round(aa * inv * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type 6 = RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', EMPTY),
  ]);
}

// ---------- HTTP 服务 ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (b) => {
      size += b.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(b);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

// job 启动失败兜底：确保轮询能拿到失败态而不是 404
async function writeFailedJob(jobId, message) {
  try {
    fs.mkdirSync(path.join(JOBS_DIR, jobId), { recursive: true });
    const manifest = {
      id: jobId, type: 'unknown', createdAt: new Date().toISOString(), status: 'done',
      params: { source: 'ui' }, lanes: [], config: loadConfig(), runtimeRoot: RUNTIME_ROOT,
      stats: { total: 0, ok: 0, failed: 0, durationMs: 0 }, error: redact(message),
    };
    await fsp.writeFile(path.join(JOBS_DIR, jobId, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  } catch { /* 尽力而为 */ }
}

function briefJob(j) {
  if (!j) return null;
  return {
    id: j.id, type: j.type, legacy: !!j.legacy, status: j.status,
    total: j.tasks ? j.tasks.length : j.total,
    done: j.tasks ? j.tasks.filter((t) => t.record).length : undefined,
    ok: j.ok, successRate: j.successRate, dir: j.dir,
    error: j.manifest?.error || null,
  };
}

// ---------- 豆包桥工具状态（只读探测，不碰豆包进程与凭证，任何失败降级不抛错） ----------
// 探测实现自 wbx-core 导入（doubaoCdpProbe/doubaoProcessRunning，v22 单源——与 askOnceDoubao
// 的 CDP 探测/进程判定同款，消除原整段重写）
async function doubaoStatus() {
  const platform = process.platform;
  // 非 Windows：不做任何探测（README 诚实声明②：Windows-only，未在其他平台验证）
  if (platform !== 'win32') {
    return { platform, process: false, cdp: false };
  }
  const running = doubaoProcessRunning();
  const p = await doubaoCdpProbe();
  return p.online ? { platform, process: running, cdp: true, browser: p.browser } : { platform, process: running, cdp: false };
}

// ---------- HTTP 服务（路由表驱动：method+pattern 单点登记；安全校验在表分发前统一执行） ----------
// 登录服务端状态（内存，单登录流）
const loginState = { status: 'idle', lane: null, startedAt: null, error: null, nickname: null };

async function hHealth(req, res) {
  sendJson(res, 200, { app: 'wbx-ui', pid: process.pid, port: LISTEN_PORT, version: WBX_VERSION });
}
async function hShutdown(req, res) {
  if (!DAEMON_CTX) return sendJson(res, 404, { error: '前台模式不支持 /__shutdown（Ctrl+C 退出）' });
  const b = await readBody(req);
  const tok = Buffer.from(typeof b.token === 'string' ? b.token : '', 'utf8');
  const expect = Buffer.from(DAEMON_CTX.token, 'utf8');
  const good = tok.length === expect.length && crypto.timingSafeEqual(tok, expect);
  if (!good) return sendJson(res, 403, { error: 'token 不正确' });
  sendJson(res, 200, { ok: true, message: '正在优雅关闭' });
  setTimeout(() => {
    try {
      SERVER && SERVER.close(() => DAEMON_CTX && DAEMON_CTX.onShutdown());
      setTimeout(() => DAEMON_CTX && DAEMON_CTX.onShutdown(), 3000); // close 被长连接卡住时兜底退出
    } catch { DAEMON_CTX && DAEMON_CTX.onShutdown(); }
  }, 150);
}
async function hIndex(req, res) {
  // 防点击劫持（v23 评审 P0）：仅回环服务的面板被公网页 iframe 嵌入后，框内请求即同源、Origin 校验失效
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'",
  });
  res.end(HTML);
}
async function hManifest(req, res) {
  res.writeHead(200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(PWA_MANIFEST);
}
async function hIcon(req, res, m) {
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
  res.end(iconPng(Number(m[1])));
}
async function hStatus(req, res, m, u) {
  ensureDirs();
  const cfg = loadConfig();
  const lanes = LANE_ORDER.map((k) => laneStatusInfo(k));
  // cline 免费模型组（server 侧调 recommended-models，失败降级缓存/空数组+提示）
  let clineFreeModels = [];
  let clineFreeModelsNote = '';
  {
    const fm = await fetchClineFreeModels();
    if (fm.ok && fm.models.length) {
      clineFreeModels = fm.models.map((x) => ({ id: x.id, name: x.name, description: x.description, deepseek: /deepseek/i.test(x.id) }));
      if (fm.source === 'cache') clineFreeModelsNote = `清单为 ${String(fm.fetchedAt).slice(0, 16)} 缓存（端点暂不可用）`;
    } else {
      clineFreeModelsNote = fm.error || '免费清单不可用';
    }
  }
  sendJson(res, 200, {
    version: WBX_VERSION, runtimeRoot: RUNTIME_ROOT,
    form: bridgeForm(),
    config: cfg, defaultLane: cfg['default-lane'], effectiveLane: resolveDefaultLane(),
    readyCount: lanes.filter((l) => l.ready && !l.disabled).length,
    lanes, clineFreeModels, clineFreeModelsNote,

  });
}
async function hDoctor(req, res, m, u) {
  const probe = u.searchParams.get('probe') === '1';
  const d = await doctorStatus({ probe, onLine: null });
  sendJson(res, 200, d);
}
async function hDoubao(req, res) {
  sendJson(res, 200, await doubaoStatus());
}
async function hBalance(req, res) {
  // 余额可见：per-lane 探测（core TTL 缓存共享；失败优雅降级为 unavailable/na，绝不阻塞）
  const lanes = {};
  for (const k of LANE_ORDER) lanes[k] = await laneBalance(k);
  sendJson(res, 200, { lanes, fetchedAt: new Date().toISOString() });
}
async function hDoubaoEnsure(req, res) {
  // 桥自治手动入口：幂等（core 单飞锁），CDP 在线零触碰豆包；按钮回执 toast + 刷新探测
  sendJson(res, 200, await ensureDoubao());
}
async function hHistory(req, res) {
  sendJson(res, 200, { jobs: listJobs() });
}
async function hJob(req, res, m, u) {
  const j = await getJob(m[1]);
  if (!j) return sendJson(res, 404, { error: `任务 ${m[1]} 不存在` });
  if (u.searchParams.get('brief') === '1') return sendJson(res, 200, briefJob(j));
  sendJson(res, 200, j);
}
async function hAsk(req, res) {
  const b = await readBody(req);
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return sendJson(res, 400, { error: '缺少提示词（prompt）' });
  let as = null;
  if (b.lane && b.lane !== 'auto') {
    as = parseLane(b.lane);
    if (!as) return sendJson(res, 400, { error: `lane 取值只支持 auto|codex|ai|cn|cline|doubao（codex=Codex CLI（ChatGPT Plus），ai=WorkBuddy AI，cn=WorkBuddy，cline=Cline，doubao=豆包桌面端；收到 ${b.lane}）` });
  }
  // caps 任务契约（v19 能力矩阵）——不合法值/含 write 未交付/lane 不匹配均 400（绝不静默降档或改路）
  let caps = null; let capsNorm = null;
  if (b.caps != null && b.caps !== '') {
    const cp = parseCapsSet(b.caps);
    if (!cp.ok) return sendJson(res, 400, { error: cp.kind === 'caps-l2-not-delivered' ? 'L2 本版未交付（声明即报错）' : `caps 只支持能力集（net/read/write 逗号组合）或别名 L0 | L1（收到 ${b.caps}）` });
    if (cp.set.includes('write')) return sendJson(res, 400, { error: 'caps：write 能力本轮未交付（探针 P3 沙箱前提破裂，声明即报错）' });
    caps = cp.normalized || 'L0';
    capsNorm = cp.normalized;
  }
  if (capsNorm && (as === 'cline' || as === 'doubao' || as === 'codex')) {
    return sendJson(res, 400, { error: `caps ${capsNorm} 与通道 ${as} 不匹配：能力任务仅支持 WorkBuddy AI / 国内版（ai/cn）` });
  }
  const jobId = newJobId();
  // 异步启动约定：启动类端点即回 200+jobId，执行失败由 job 记录承接（轮询可见失败态），与
  // 同步校验错误（400）分层——本端点不因执行失败改 5xx
  runAskJob({
    prompt, as,
    model: typeof b.model === 'string' && b.model ? b.model : null,
    effort: typeof b.effort === 'string' && b.effort ? b.effort : null,
    timeoutS: Number(b.timeout) > 0 ? Number(b.timeout) : null,   // 缺省交由 core 超时单点决策
    caps,
    maxTurns: b.maxTurns ?? null,   // 任务级回合上限（core 校验 1-64/任何非 ∅ 能力集）
    jobId,
  }).catch((e) => writeFailedJob(jobId, e.message));
  sendJson(res, 200, { jobId });
}
async function hFanout(req, res) {
  const b = await readBody(req);
  if (!Array.isArray(b.tasks) || !b.tasks.length) return sendJson(res, 400, { error: 'tasks 需为非空数组' });
  const tasksIn = b.tasks.map((t, i) => ({
    id: t.id || `task-${i + 1}`,
    prompt: String(t.prompt || ''),
    as: t.as || null,
    effort: t.effort || null,
    model: t.model || null,
    caps: t.caps != null && t.caps !== '' ? t.caps : null,   // 任务级能力档（透传 core 校验）
    maxTurns: t.maxTurns ?? null,   // 任务级 L1 回合上限（透传 core 校验）
  }));
  const bad = tasksIn.find((t) => !t.prompt.trim());
  if (bad) return sendJson(res, 400, { error: `任务 ${bad.id} 缺少提示词（prompt）` });
  let lanes = null;
  if (Array.isArray(b.lanes) && b.lanes.length) lanes = b.lanes;
  else if (typeof b.lanes === 'string' && b.lanes.trim()) lanes = b.lanes.split(',').map((s) => s.trim()).filter(Boolean);
  const jobId = newJobId();
  runFanoutJob({
    tasksIn, lanes,
    parallel: Number(b.parallel) > 0 ? Number(b.parallel) : null,
    timeoutS: Number(b.timeout) > 0 ? Number(b.timeout) : null,   // 缺省交由 core 超时单点决策
    retry: Number.isInteger(b.retry) && b.retry >= 0 ? b.retry : null,
    jobId,
  }).catch((e) => writeFailedJob(jobId, e.message));
  sendJson(res, 200, { jobId });
}
async function hConfig(req, res) {
  const b = await readBody(req);
  if (!b.key || !Object.prototype.hasOwnProperty.call(CONFIG_DEFS, b.key)) return sendJson(res, 400, { error: `未知配置键 ${b.key}` });
  try {
    const r = await setConfig(b.key, b.value === undefined ? '' : String(b.value));
    sendJson(res, 200, { ok: true, key: r.key, value: r.value });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}
async function hLoginStart(req, res) {
  const b = await readBody(req);
  const lane = parseLane(b.lane);
  // 仅 ai/cn 有 SSO 登录流（cline=CLI OAuth；doubao=客户端 GUI 自理；codex=一次性只读复制 auth.json，均不走此端点）
  if (!lane || lane === 'cline' || lane === 'doubao' || lane === 'codex') return sendJson(res, 400, { error: 'lane 只支持 ai|cn（cline 走 CLI OAuth、doubao 在客户端自理、codex 跑 wbx login --identity codex 收割凭证——本端点仅承载 SSO 流）' });
  if (loginState.status === 'pending') return sendJson(res, 409, { error: `已有登录流程进行中（lane ${loginState.lane}）` });
  loginState.status = 'pending'; // 先占位防并发登录流（TOCTOU），失败回滚
  loginState.lane = lane;
  loginState.startedAt = Date.now();
  loginState.error = null;
  loginState.nickname = null;
  let ctx;
  try { ctx = await startLogin(lane); }
  catch (e) {
    loginState.status = 'error';
    loginState.error = redact(e.message);
    return sendJson(res, 500, { error: redact(e.message) });
  }
  (async () => {
    const { authToken, pending } = await pollLoginToken(ctx, 300000);
    if (!authToken) { loginState.status = 'timeout'; return; }
    const account = await fetchAccountInfo(ctx, authToken);
    await persistLogin(ctx, authToken, account);
    loginState.status = 'done';
    loginState.nickname = account?.nickname || null;
  })().catch((e) => {
    loginState.status = 'error';
    loginState.error = redact(e.message);
  });
  sendJson(res, 200, { lane, authUrl: ctx.authUrl, tips: ctx.tips });
}
async function hLoginPoll(req, res) {
  sendJson(res, 200, { status: loginState.status, lane: loginState.lane, startedAt: loginState.startedAt, error: loginState.error, nickname: loginState.nickname });
}

// 路由表（method+pattern 单点登记；新增端点只加一行，不再长 if 链）
const ROUTES = [
  { method: 'GET', re: /^\/__health$/, fn: hHealth },
  { method: 'POST', re: /^\/__shutdown$/, fn: hShutdown },
  { method: 'GET', re: /^\/(|index\.html)$/, fn: hIndex },
  { method: 'GET', re: /^\/manifest\.webmanifest$/, fn: hManifest },
  { method: 'GET', re: /^\/icons\/icon-(192|512)\.png$/, fn: hIcon },
  { method: 'GET', re: /^\/api\/status$/, fn: hStatus },
  { method: 'GET', re: /^\/api\/doctor$/, fn: hDoctor },
  { method: 'GET', re: /^\/api\/doubao$/, fn: hDoubao },
  { method: 'GET', re: /^\/api\/balance$/, fn: hBalance },
  { method: 'POST', re: /^\/api\/doubao\/ensure$/, fn: hDoubaoEnsure },
  { method: 'GET', re: /^\/api\/history$/, fn: hHistory },
  { method: 'GET', re: /^\/api\/job\/([A-Za-z0-9_-]+)$/, fn: hJob },
  { method: 'POST', re: /^\/api\/ask$/, fn: hAsk },
  { method: 'POST', re: /^\/api\/fanout$/, fn: hFanout },
  { method: 'POST', re: /^\/api\/config$/, fn: hConfig },
  { method: 'POST', re: /^\/api\/login\/start$/, fn: hLoginStart },
  { method: 'GET', re: /^\/api\/login\/poll$/, fn: hLoginPoll },
];

async function handler(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  try {
    // 安全校验：Host 白名单防 DNS rebinding；POST 一律校验 Origin（同源或空）
    if (!hostHeaderAllowed(req.headers.host, LISTEN_PORT)) {
      return sendJson(res, 403, { error: 'Host 头不允许（本控制台仅限 127.0.0.1 / localhost 访问）' });
    }
    if (req.method === 'POST' && !originAllowed(req.headers.origin, LISTEN_PORT)) {
      return sendJson(res, 403, { error: 'Origin 不允许（本控制台仅限同源访问）' });
    }
    for (const r of ROUTES) {
      if (req.method !== r.method) continue;
      const m = r.re.exec(p);
      if (!m) continue;
      await r.fn(req, res, m, u);
      return;
    }
    sendJson(res, 404, { error: '未找到' });
  } catch (e) {
    sendJson(res, 500, { error: redact(e.message) });
  }
}

export async function startUiServer({ port = 7788, open = true, daemon = null } = {}) {
  ensureDirs();
  LISTEN_PORT = port;
  const server = http.createServer(handler);
  SERVER = server;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
  });
  const url = `http://127.0.0.1:${port}`;
  if (daemon) {
    // 守护模式：写状态文件（bind 成功 = 单实例赢家），关闭时清理
    DAEMON_CTX = daemon;
    daemon.persist({ pid: process.pid, port, startedAt: Date.now(), token: daemon.token, version: WBX_VERSION });
    server.on('close', () => { try { daemon.clear(); } catch { /* 尽力而为 */ } });
    console.log(`[OK] wbx ui 守护进程已就绪：${url}（pid ${process.pid}，仅监听本机回环）`);
    console.error(`运行时根：${RUNTIME_ROOT}；停止：wbx ui --stop`);
  } else {
    console.log(`[OK] wbx ui 已启动：${url}（仅监听本机回环；Ctrl+C 退出，无常驻服务）`);
    console.error(`运行时根：${RUNTIME_ROOT}`);
    if (open) openBrowser(url);
  }
  return server;
}
