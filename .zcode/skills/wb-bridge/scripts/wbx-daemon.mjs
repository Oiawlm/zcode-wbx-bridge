/**
 * wbx-daemon — wbx 控制台守护化生命周期 + ZCode 自启钩子（v5.2 P0/P1）
 *
 * 职责：
 *   - 纯函数集（状态解析/判陈旧/Host·Origin 白名单/判活决策）：零依赖零副作用，可独立测试
 *   - 状态文件 <运行时根>/run/ui.json：{pid, port, startedAt, token, version}
 *     三条件判活（状态文件 + kill(pid,0) + GET /__health pid 匹配）+ startedAt 跨重启判废；
 *     二次启动永远复用绝不新起（幂等是自启钩子的关键性质）。
 *   - ui --detach / --stop / --status / 内部 --daemon（真服务由 wbx-ui.mjs 提供）
 *   - ui --install-autostart / --remove-autostart：对 ~/.zcode/cli/config.json 只做
 *     读-改-写合并（绝不删除/改写既有键；按 command 路径幂等去重；enabled 仅在我们
 *     引入首个配置钩子时置 true，并用 marker 文件记住，卸载时可精确还原）。
 *
 * 安全红线：daemon 只绑 127.0.0.1；绝不 spawn shell（直接 node.exe + 参数向量）；
 * 绝不 kill 状态文件之外的未知 pid；token 只存 ui.json（gitignore），绝不打印。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { WBX_VERSION, RUNTIME_ROOT, SCRIPT_DIR, GLOBAL_BRIDGE_DIR, HOME, ensureDirs } from './wbx-core.mjs';

// ---------- 纯函数集（守护判活 + 请求安全；契约见 internal 测试） ----------

/**
 * 安全解析 ui.json 文本。字段校验失败/非法 JSON 一律 {ok:false, state:null}，绝不抛异常。
 * @param {string} text
 * @returns {{ ok: boolean, state: {pid:number, port:number, startedAt:number, token:string, version:string} | null }}
 */
export function parseUiState(text) {
  try {
    if (typeof text !== 'string') return { ok: false, state: null };
    const j = JSON.parse(text);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, state: null };
    const isPosInt = (v) => Number.isInteger(v) && v > 0;
    if (!isPosInt(j.pid)) return { ok: false, state: null };
    if (!Number.isInteger(j.port) || j.port < 1 || j.port > 65535) return { ok: false, state: null };
    if (typeof j.startedAt !== 'number' || !(j.startedAt > 0)) return { ok: false, state: null };
    if (typeof j.token !== 'string' || !j.token) return { ok: false, state: null };
    if (typeof j.version !== 'string' || !j.version) return { ok: false, state: null };
    return { ok: true, state: j }; // 原样返回：多余字段保留（向前兼容，旧二进制读新状态不炸）
  } catch {
    return { ok: false, state: null };
  }
}

/**
 * 跨重启判废：startedAt 早于系统启动时刻 ⇒ 进程不可能存活于本启动周期，状态必为残留。
 * 输入缺失/非法一律 true（fail-safe：读不懂就当陈旧，宁可重起不可误复用）。
 */
export function isStaleState(state, nowMs, uptimeMs) {
  try {
    if (!state || typeof state.startedAt !== 'number' || !(nowMs > 0) || !(uptimeMs >= 0)) return true;
    return state.startedAt < nowMs - uptimeMs;
  } catch {
    return true;
  }
}

/**
 * Host 头白名单（防 DNS rebinding）：仅允许 127.0.0.1 / localhost（可带 :port，host 部分大小写不敏感）。
 * 其余（IPv6、其他主机名、其他端口、畸形形态）一律 false。
 */
export function hostHeaderAllowed(hostValue, port) {
  if (typeof hostValue !== 'string' || !hostValue) return false;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  let h = hostValue.trim().toLowerCase();
  if (!h || h.includes('/') || h.includes('@')) return false; // userinfo 前缀/路径形态直接拒
  // 摘出 host 与可选 port（只允许 IPv4 字面量或 localhost 单标签，无 IPv6 合法形态）
  let host = h, portPart = '';
  const i = h.lastIndexOf(':');
  if (i >= 0) { host = h.slice(0, i); portPart = h.slice(i + 1); }
  if (host !== '127.0.0.1' && host !== 'localhost') return false;
  if (portPart === '') return true;
  if (!/^\d{1,5}$/.test(portPart)) return false;
  const n = Number(portPart);
  return n >= 1 && n <= 65535 && n === port;
}

/**
 * POST Origin 校验：无 Origin（非浏览器客户端）或严格同源（http://127.0.0.1:port / http://localhost:port）。
 */
export function originAllowed(originValue, port) {
  if (originValue == null || originValue === '') return true;
  if (typeof originValue !== 'string') return false;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const o = originValue.trim().toLowerCase();
  return o === `http://127.0.0.1:${port}` || o === `http://localhost:${port}`;
}

/**
 * 判活决策（真值表）：
 *   none     无状态文件 → 直接起
 *   reuse    有状态且未陈旧且 pid 活且 health OK 且 pid 匹配 → 永远复用绝不新起
 *   replace  有状态且（陈旧 或 pid 已死）→ 清残留重起
 *   conflict 有状态且 pid 活但 health 不匹配 → 端口被非本服务占用/pid 被复用，绝不杀未知 pid
 */
export function decideExisting(probe) {
  const b = (v) => v === true;
  if (!probe || typeof probe !== 'object' || !b(probe.hasState)) return 'none';
  const { stale, pidAlive, healthOk, pidMatch } = probe;
  if (typeof stale !== 'boolean' || typeof pidAlive !== 'boolean'
    || typeof healthOk !== 'boolean' || typeof pidMatch !== 'boolean') return 'none';
  if (stale || !pidAlive) return 'replace';
  if (healthOk && pidMatch) return 'reuse';
  return 'conflict';
}

// ---------- 路径与状态文件 ----------

export const UI_RUN_DIR = path.join(RUNTIME_ROOT, 'run');
export const UI_LOG_DIR = path.join(RUNTIME_ROOT, 'logs');
export const UI_STATE_FILE = path.join(UI_RUN_DIR, 'ui.json');
export const UI_LOG_FILE = path.join(UI_LOG_DIR, 'ui.log');
export const UI_DEFAULT_PORT = 7788;

export function readUiState() {
  try {
    return parseUiState(fs.readFileSync(UI_STATE_FILE, 'utf8'));
  } catch {
    return { ok: false, state: null };
  }
}

export function writeUiState(state) {
  fs.mkdirSync(UI_RUN_DIR, { recursive: true });
  fs.writeFileSync(UI_STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/** 仅当状态文件记录的 pid 与期望一致时删除（防止误删他人的新状态）。 */
export function removeUiStateIf(expectPid) {
  try {
    const { ok, state } = readUiState();
    if (!ok) return;
    if (expectPid != null && state.pid !== expectPid) return;
    fs.rmSync(UI_STATE_FILE, { force: true });
  } catch { /* 尽力而为 */ }
}

export function appendUiLog(line) {
  try {
    fs.mkdirSync(UI_LOG_DIR, { recursive: true });
    fs.appendFileSync(UI_LOG_FILE, `${line}\n`, 'utf8');
  } catch { /* 日志失败不致命 */ }
}

// ---------- 探测 ----------

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM'; // EPERM=进程存在但无权限（Windows 系统进程）；ESRCH=已退出
  }
}

export async function fetchHealth(port, timeoutMs = 1500) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__health`, { signal: ctl.signal });
      if (!res.ok) return { ok: false };
      const j = await res.json();
      if (j && j.app === 'wbx-ui' && Number.isInteger(j.pid)) {
        return { ok: true, pid: j.pid, port: j.port ?? port, version: j.version ?? null };
      }
      return { ok: false };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return { ok: false };
  }
}

/** 组装三条件实测并给决策；返回 {decision, state}。 */
export async function probeExisting() {
  const { ok, state } = readUiState();
  if (!ok) return { decision: 'none', state: null };
  const health = await fetchHealth(state.port);
  const decision = decideExisting({
    hasState: true,
    stale: isStaleState(state, Date.now(), os.uptime() * 1000),
    pidAlive: pidAlive(state.pid),
    healthOk: health.ok,
    pidMatch: health.ok && health.pid === state.pid,
  });
  return { decision, state, health };
}

// ---------- 日志轮转 ----------

/** 启动前调用：>2MB 则轮转（ui.log -> ui.log.1，保留一代），返回追加模式 fd 供子进程 stdio。 */
export function prepareUiLog() {
  fs.mkdirSync(UI_LOG_DIR, { recursive: true });
  try {
    const st = fs.statSync(UI_LOG_FILE);
    if (st.size > 2 * 1024 * 1024) {
      try { fs.rmSync(`${UI_LOG_FILE}.1`, { force: true }); } catch { /* 无旧档 */ }
      fs.renameSync(UI_LOG_FILE, `${UI_LOG_FILE}.1`);
    }
  } catch { /* 无现日志 */ }
  return fs.openSync(UI_LOG_FILE, 'a');
}

// ---------- --detach：幂等拉起后台 ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 幂等拉起守护进程。任何失败都以 {ok:false, message} 返回（调用方负责打印），
 * 绝不抛异常——该路径同时是 ZCode SessionStart 钩子路径，必须永远快速且安全返回。
 * @returns {{ok:boolean, action?:'reused'|'started', message:string, pid?:number, port?:number, url?:string}}
 */
export async function detachUi({ port = UI_DEFAULT_PORT } = {}) {
  const url = (p) => `http://127.0.0.1:${p}`;
  try {
    ensureDirs();
    const probe = await probeExisting();
    if (probe.decision === 'reuse') {
      return { ok: true, action: 'reused', pid: probe.state.pid, port: probe.state.port, url: url(probe.state.port),
        message: `控制台已在运行（复用，pid ${probe.state.pid}）：${url(probe.state.port)}` };
    }
    if (probe.decision === 'replace') removeUiStateIf(probe.state.pid);
    if (probe.decision === 'conflict') {
      // 可能是另一路 --detach 正在启动（竞态窗口）：短暂复探一次
      await sleep(800);
      const again = await fetchHealth(probe.state.port, 1000);
      if (again.ok && again.pid === probe.state.pid) {
        return { ok: true, action: 'reused', pid: probe.state.pid, port: probe.state.port, url: url(probe.state.port),
          message: `控制台已在运行（复用，pid ${probe.state.pid}）：${url(probe.state.port)}` };
      }
      const msg = `状态不一致：pid ${probe.state.pid} 存活但健康检查不匹配（疑似端口被占或 pid 被复用）。` +
        `处理：wbx ui --stop 清理后再 --detach；仍失败则检查端口（netstat -ano | findstr :${probe.state.port}）`;
      appendUiLog(`[detach] ${new Date().toISOString()} conflict: ${msg}`);
      return { ok: false, message: msg };
    }

    // spawn 守护进程：直接 node.exe + 参数向量，绝不 shell；stdio 全部落 ui.log
    const logFd = prepareUiLog();
    const entry = path.join(SCRIPT_DIR, 'wbx.mjs');
    const child = spawn(process.execPath, [entry, 'ui', '--daemon', '--port', String(port), '--no-open'], {
      detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true, cwd: SCRIPT_DIR,
    });
    const childPid = child.pid;
    child.unref();
    fs.closeSync(logFd);

    // 等就绪：health OK / 子进程退出 / 超时（3.5s——本函数是 SessionStart 钩子路径，
    // 钩子超时 5s，总预算必须留余量；正常冷启动约 1-2s）
    const outcome = await new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; clearInterval(iv); clearTimeout(guard); resolve(v); } };
      child.once('exit', (code) => fin({ exited: true, code }));
      child.once('error', (e) => fin({ exited: true, code: -1, error: String(e) }));
      const t0 = Date.now();
      const iv = setInterval(() => {
        fetchHealth(port, 900).then((h) => { if (h.ok) fin({ health: h }); });
        if (Date.now() - t0 > 3500) fin({ timeout: true });
      }, 300);
      const guard = setTimeout(() => fin({ timeout: true }), 4300); // 兜底：interval 异常时不悬挂
    });

    if (outcome.health) {
      return { ok: true, action: 'started', pid: outcome.health.pid, port, url: url(port),
        message: `控制台已后台启动（pid ${outcome.health.pid}）：${url(port)}（日志：${UI_LOG_FILE}）` };
    }
    if (outcome.exited) {
      // 子进程没起来：可能是竞态输了（另一实例刚好绑定成功）→ 复探复用；否则报错（端口被外程序占用等）
      const again = await fetchHealth(port, 1000);
      if (again.ok) {
        return { ok: true, action: 'reused', pid: again.pid, port, url: url(port),
          message: `控制台已在运行（复用，pid ${again.pid}）：${url(port)}` };
      }
      let tail = '';
      try { tail = fs.readFileSync(UI_LOG_FILE, 'utf8').split('\n').slice(-6).join('\n').trim(); } catch { /* 无日志 */ }
      const msg = outcome.code === 78
        ? `端口 ${port} 已被其他程序占用（fail fast，不换端口）。检查：netstat -ano | findstr :${port}；或用 wbx ui --port <N> 另起`
        : `守护进程启动失败（退出码 ${outcome.code}）。日志尾部：\n${tail || '（见 ' + UI_LOG_FILE + '）'}`;
      appendUiLog(`[detach] ${new Date().toISOString()} spawn-exit code=${outcome.code}`);
      return { ok: false, message: msg };
    }
    // 超时：不杀子进程（可能仍在启动中，杀了反而反复拉起失败）；如实报告，状态文件只在
    // bind 成功后由子进程写入，因此不会留下指向死 pid 的状态。
    const msg = `守护进程启动中（pid ${childPid}，3.5s 内未就绪）。稍后 wbx ui --status 确认；日志：${UI_LOG_FILE}`;
    appendUiLog(`[detach] ${new Date().toISOString()} timeout pid=${childPid}（不回收，等自愈）`);
    return { ok: false, message: msg };
    appendUiLog(`[detach] ${new Date().toISOString()} timeout pid=${childPid}`);
    return { ok: false, message: msg };
  } catch (e) {
    const msg = `--detach 内部错误：${e && e.message}`;
    appendUiLog(`[detach] ${new Date().toISOString()} error: ${msg}`);
    return { ok: false, message: msg };
  }
}

// ---------- --stop：HTTP 优雅优先，kill 兜底 ----------

async function httpPostShutdown(port, token, timeoutMs = 3000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/__shutdown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: ctl.signal,
      });
      return { ok: res.ok, status: res.status };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function stopUi() {
  const { ok, state } = readUiState();
  if (!ok) {
    const h = await fetchHealth(UI_DEFAULT_PORT);
    if (h.ok) return { ok: false, message: `守护状态文件不存在，但 ${UI_DEFAULT_PORT} 端口有本控制台实例（pid ${h.pid}，可能是前台模式）——请在对应终端 Ctrl+C 退出` };
    return { ok: true, message: '控制台未在运行（无状态文件）' };
  }
  // 1) HTTP 优雅关闭（带 token）
  const shut = await httpPostShutdown(state.port, state.token);
  if (shut.ok) {
    for (let i = 0; i < 25 && pidAlive(state.pid); i++) await sleep(200); // 最长 5s 等优雅退出
    removeUiStateIf(state.pid);
    return { ok: true, message: pidAlive(state.pid)
      ? `已请求关闭（pid ${state.pid} 仍在退出中，稍后自行结束）`
      : `已优雅关闭（pid ${state.pid}，端口 ${state.port} 已释放）` };
  }
  // 2) kill 兜底：Windows 上 kill=TerminateProcess 硬终止。只杀能「正向证明是我们服务」的 pid
  //（health OK 且 pid 匹配）；health 不达且 pid 存活时无法排除 pid 复用，绝不误杀，交人工处理。
  const h = await fetchHealth(state.port, 1500);
  const provablyOurs = h.ok && h.pid === state.pid;
  if (provablyOurs && pidAlive(state.pid)) {
    try { process.kill(state.pid); } catch { /* 已退出 */ }
    for (let i = 0; i < 15 && pidAlive(state.pid); i++) await sleep(200);
  }
  removeUiStateIf(state.pid);
  const gone = !pidAlive(state.pid);
  if (gone) return { ok: true, message: `已停止（pid ${state.pid}，端口 ${state.port} 已释放；HTTP ${shut.status}${provablyOurs ? ' 后强杀' : ''}）` };
  return { ok: false, message: provablyOurs
    ? `停止失败：pid ${state.pid} 仍存活（HTTP ${shut.status}）。手动处理：taskkill /PID ${state.pid} /F`
    : `无法证明 pid ${state.pid} 是本控制台（健康检查不匹配，可能 pid 已被复用）——已清理状态文件，不动该进程。如确认需要：taskkill /PID ${state.pid} /F` };
}

// ---------- --status：三态 ----------

export async function statusUi() {
  const base = { log: UI_LOG_FILE, stateFile: UI_STATE_FILE };
  const { ok, state } = readUiState();
  if (!ok) return { ...base, state: 'stopped', message: '控制台未在运行（无状态文件）' };
  const health = await fetchHealth(state.port);
  const decision = decideExisting({
    hasState: true,
    stale: isStaleState(state, Date.now(), os.uptime() * 1000),
    pidAlive: pidAlive(state.pid),
    healthOk: health.ok,
    pidMatch: health.ok && health.pid === state.pid,
  });
  if (decision === 'reuse') {
    return { ...base, state: 'running', pid: state.pid, port: state.port,
      startedAt: new Date(state.startedAt).toISOString(), version: state.version,
      url: `http://127.0.0.1:${state.port}`,
      message: `运行中（pid ${state.pid}，端口 ${state.port}，v${state.version}，启动于 ${new Date(state.startedAt).toLocaleString('zh-CN', { hour12: false })}）` };
  }
  if (decision === 'replace') {
    return { ...base, state: 'stale', pid: state.pid, port: state.port,
      message: `残留状态（pid ${state.pid} 已退出或跨重启）——下次 wbx ui --detach 自动清理自愈` };
  }
  return { ...base, state: 'stale', pid: state.pid, port: state.port,
    message: `状态不一致（pid ${state.pid} 存活但健康检查不匹配）——wbx ui --stop 清理后再 --detach` };
}

// ---------- 内部 --daemon：守护进程主体（由 detachUi spawn，真服务在 wbx-ui.mjs） ----------

export async function daemonMain({ port = UI_DEFAULT_PORT } = {}) {
  // stdin 已由父进程设为 ignore；stdout/stderr 已重定向 ui.log
  process.on('uncaughtException', (e) => {
    console.error(`[daemon] uncaughtException ${new Date().toISOString()}: ${e && e.stack || e}`);
    try { removeUiStateIf(process.pid); } catch { /* 尽力而为 */ }
    process.exit(1);
  });
  process.on('unhandledRejection', (e) => {
    console.error(`[daemon] unhandledRejection ${new Date().toISOString()}: ${e}`);
  });
  console.error(`[daemon] 启动中 pid=${process.pid} port=${port} version=${WBX_VERSION} ${new Date().toISOString()}`);
  // 守护内日志增长防护：每小时检查，>10MB 截断（stdio fd 为追加模式，截断后继续写在文件尾）
  setInterval(() => {
    try {
      const st = fs.statSync(UI_LOG_FILE);
      if (st.size > 10 * 1024 * 1024) {
        fs.truncateSync(UI_LOG_FILE, 0);
        fs.appendFileSync(UI_LOG_FILE, `[daemon] ${new Date().toISOString()} 日志超 10MB，已截断（启动前轮转档见 ui.log.1）\n`, 'utf8');
      }
    } catch { /* 无日志文件则忽略 */ }
  }, 3600_000).unref();
  const token = crypto.randomBytes(16).toString('hex');
  try {
    const { startUiServer } = await import('./wbx-ui.mjs');
    await startUiServer({
      port, open: false,
      daemon: {
        token,
        persist: (st) => writeUiState(st),
        clear: () => removeUiStateIf(process.pid),
        onShutdown: () => { console.error(`[daemon] 已优雅关闭（pid ${process.pid}）`); process.exit(0); },
      },
    });
  } catch (e) {
    console.error(`[daemon] 启动失败：${e && e.message}`);
    process.exit(e && e.code === 'EADDRINUSE' ? 78 : 1);
  }
  console.error(`[daemon] 已监听 127.0.0.1:${port}（守护模式；停止：wbx ui --stop；日志：${UI_LOG_FILE}）`);
  // 服务自身 keep-alive；此处不返回
}

// ---------- ZCode SessionStart 自启钩子（P1） ----------

export const ZCODE_CLI_CONFIG = path.join(HOME, '.zcode', 'cli', 'config.json');
export const AUTOSTART_MARKER = path.join(UI_RUN_DIR, 'autostart-enabled-by-wbx');
const AUTOSTART_STATUS = 'wbx 控制台保活';

export function globalWbxScript() { return path.join(GLOBAL_BRIDGE_DIR, 'scripts', 'wbx.mjs'); }

/** 我们的钩子条目（type:'process' 参数向量，无 shell；全局形态脚本绝对路径）。 */
function buildHookEntry() {
  return {
    type: 'process',
    command: process.execPath,
    args: [globalWbxScript(), 'ui', '--detach', '--no-open'],
    timeoutMs: 5000,
    statusMessage: AUTOSTART_STATUS,
  };
}

function isOurHookEntry(e) {
  return !!(e && typeof e === 'object' && Array.isArray(e.args)
    && e.args[0] === globalWbxScript() && e.args[1] === 'ui' && e.args[2] === '--detach');
}

function entryEq(a, b) {
  return JSON.stringify([a.type, a.command, a.args, a.timeoutMs, a.statusMessage])
    === JSON.stringify([b.type, b.command, b.args, b.timeoutMs, b.statusMessage]);
}

/**
 * 安装自启钩子：读-改-写合并 ~/.zcode/cli/config.json。
 * 合并铁律：绝不删除/改写既有键；既有结构类型异常则中止不动文件；按 command 路径幂等去重；
 * hooks.enabled 仅在「我们引入首个配置钩子」且原值非 true 时置 true（marker 记录，卸载可精确还原）。
 * @returns {{installed:boolean, message:string}}
 */
export async function installAutostart({ configPath = ZCODE_CLI_CONFIG } = {}) {
  const scriptPath = globalWbxScript();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`全局形态未安装（缺 ${scriptPath}）：自启钩子必须指向全局形态脚本。先运行：wbx self-install`);
  }
  let cfg = {};
  if (fs.existsSync(configPath)) {
    try { cfg = JSON.parse(await fsp.readFile(configPath, 'utf8')); } catch (e) {
      throw new Error(`读取 ${configPath} 失败（${e.message}）——为避免破坏既有配置，已中止，未做任何写入`);
    }
  }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${configPath} 根结构不是 JSON 对象，已中止`);

  const hooks = (cfg.hooks && typeof cfg.hooks === 'object' && !Array.isArray(cfg.hooks)) ? cfg.hooks : undefined;
  const events = hooks && (hooks.events && typeof hooks.events === 'object' && !Array.isArray(hooks.events)) ? hooks.events : undefined;
  const sessionStart = events && Array.isArray(events.SessionStart) ? events.SessionStart : undefined;
  // 既有键类型异常（非预期结构）→ 中止，绝不猜测重排
  if (cfg.hooks !== undefined && !hooks) throw new Error('config.json 的 hooks 键存在但不是对象——已中止（不破坏未知结构）');
  if (hooks && hooks.events !== undefined && !events) throw new Error('config.json 的 hooks.events 键存在但不是对象——已中止（不破坏未知结构）');
  if (events && events.SessionStart !== undefined && !sessionStart) throw new Error('config.json 的 hooks.events.SessionStart 键存在但不是数组——已中止（不破坏未知结构）');

  const existing = (sessionStart || []).flatMap((g) => (g && Array.isArray(g.hooks)) ? g.hooks : []);
  const ours = existing.find(isOurHookEntry);
  const entry = buildHookEntry();

  const target = hooks ?? (cfg.hooks = {});
  const ev = events ?? (target.events = {});
  const list = sessionStart ?? (ev.SessionStart = []);
  if (ours) {
    if (entryEq(ours, entry)) return { installed: false, message: `自启钩子已存在且一致（${configPath}），无需重复安装` };
    // 更新我们自己的旧条目（仅此情形允许改写）
    const idx = list.findIndex((g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => h === ours));
    const ourGroup = list[idx];
    const hIdx = ourGroup.hooks.indexOf(ours);
    ourGroup.hooks[hIdx] = entry;
    await fsp.writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    return { installed: true, message: `自启钩子已更新（路径/参数与当前全局形态对齐）：${configPath}` };
  }
  list.push({ matcher: '^startup$', hooks: [entry] });

  // enabled 逻辑：仅当 enabled 键「缺失」且此刻无其他钩子（我们引入首个配置钩子）才置 true；
  // 用户显式 enabled:false（无论有无其他钩子）一律不翻转，如实告警。
  const hadEnabled = Object.prototype.hasOwnProperty.call(target, 'enabled');
  const otherHooksExist = Object.values(ev).some((v) => Array.isArray(v) && v.some((g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => !isOurHookEntry(h))));
  if (!hadEnabled) {
    if (otherHooksExist) {
      await fsp.writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
      return { installed: true, message: `钩子已写入 ${configPath}，但存在其他钩子而 hooks.enabled 未设置——未擅自开启。要启用请手动置 hooks.enabled=true` };
    }
    target.enabled = true;
    fs.mkdirSync(UI_RUN_DIR, { recursive: true });
    fs.writeFileSync(AUTOSTART_MARKER, JSON.stringify({ enabledBefore: 'absent', at: new Date().toISOString() }) + '\n', 'utf8');
  } else if (target.enabled !== true) {
    await fsp.writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    return { installed: true, message: `钩子已写入 ${configPath}，但 hooks.enabled 当前显式为 ${String(target.enabled)}（用户意图，未擅自翻转）。要启用请手动置 hooks.enabled=true` };
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  const enNote = hadEnabled ? '' : '（hooks.enabled 由本命令首次开启，已记录 marker，--remove-autostart 时可还原）';
  return { installed: true, message: `自启钩子已安装：新开 ZCode 会话即自动拉起控制台（浏览器开 http://127.0.0.1:${UI_DEFAULT_PORT}）${enNote}` };
}

/**
 * 摘除我们的钩子：精确移除我们写入的条目；enabled 若是我们加的（marker 在且 events 已空）则还原；
 * 结构清空到什么都没有时连 hooks 键一起移除，恢复到安装前的形状。
 * @returns {{removed:boolean, message:string}}
 */
export async function removeAutostart({ configPath = ZCODE_CLI_CONFIG } = {}) {
  if (!fs.existsSync(configPath)) return { removed: false, message: `未安装（${configPath} 不存在）` };
  let cfg;
  try { cfg = JSON.parse(await fsp.readFile(configPath, 'utf8')); } catch (e) {
    throw new Error(`读取 ${configPath} 失败（${e.message}）——已中止，未做任何写入`);
  }
  const hooks = cfg && typeof cfg === 'object' && cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : null;
  const events = hooks && hooks.events && typeof hooks.events === 'object' ? hooks.events : null;
  const list = events && Array.isArray(events.SessionStart) ? events.SessionStart : null;
  if (!list || !list.some((g) => g && Array.isArray(g.hooks) && g.hooks.some(isOurHookEntry))) {
    return { removed: false, message: `未安装（${configPath} 的 SessionStart 里没有 wbx 钩子）` };
  }
  for (const g of list) {
    if (g && Array.isArray(g.hooks)) g.hooks = g.hooks.filter((h) => !isOurHookEntry(h));
  }
  const cleaned = list.filter((g) => g && Array.isArray(g.hooks) && g.hooks.length > 0);
  if (cleaned.length) events.SessionStart = cleaned;
  else delete events.SessionStart;

  const eventsEmpty = !events || Object.keys(events).length === 0;
  if (eventsEmpty) {
    delete hooks.events;
    // enabled 若是我们加的（marker 记录 enabledBefore），按记录还原：原本缺失→删键
    if (fs.existsSync(AUTOSTART_MARKER)) {
      let enabledBefore = 'absent';
      try { enabledBefore = JSON.parse(fs.readFileSync(AUTOSTART_MARKER, 'utf8')).enabledBefore ?? 'absent'; } catch { /* 按缺失处理 */ }
      if (enabledBefore === 'absent') delete hooks.enabled;
      else if (typeof enabledBefore === 'boolean') hooks.enabled = enabledBefore;
      fs.rmSync(AUTOSTART_MARKER, { force: true });
    }
    if (!Object.keys(hooks).length) delete cfg.hooks; // hooks 清空则整个移除，恢复原状
  }
  await fsp.writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return { removed: true, message: `自启钩子已摘除${eventsEmpty ? '（钩子结构已清空的键一并还原）' : '（其他既有钩子原样保留）'}：${configPath}` };
}
