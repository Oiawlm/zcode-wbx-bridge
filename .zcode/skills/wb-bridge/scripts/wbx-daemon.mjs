/**
 * wbx-daemon — wbx 控制台守护化生命周期
 *
 * 职责：
 *   - 纯函数集（状态解析/判陈旧/Host·Origin 白名单/判活决策）：零依赖零副作用，可独立测试
 *   - 状态文件 <运行时根>/run/ui.json：{pid, port, startedAt, token, version}——守护每项目化（v29）：
 *     UI 守护绑定「启动时解析的运行时根」，起于哪个项目服务哪个 .wbx/（状态与日志均在 RT/run|logs）。
 *     三条件判活（状态文件 + kill(pid,0) + GET /__health pid 匹配）+ startedAt 跨重启判废；
 *     二次启动永远复用绝不新起（幂等）。
 *   - ui --detach / --stop / --status / 内部 --daemon（真服务由 wbx-ui.mjs 提供）
 *   - 端口策略：默认 7788；同 RT 重复 --detach=幂等复用；被他人/他项目守护占用=明确报错退出
 *     +提示 `--port` 旗标换端口（绝不误占、绝不杀未知 pid）。
 *
 * 安全红线：daemon 只绑 127.0.0.1；绝不 spawn shell（直接 node.exe + 参数向量）；
 * 绝不 kill 状态文件之外的未知 pid；token 只存 ui.json（gitignore），绝不打印。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { SCRIPT_DIR, UI_RUN_DIR, UI_LOG_DIR, UI_STATE_FILE, UI_LOG_FILE } from './wbx-paths.mjs';
import { WBX_VERSION, UI_DEFAULT_PORT, ensureDirs } from './wbx-core.mjs';

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
// UI_RUN_DIR/UI_LOG_DIR/UI_STATE_FILE/UI_LOG_FILE 定义在 ./wbx-paths.mjs（v28-S 路径单点）；
// UI_DEFAULT_PORT 自 wbx-core 导入（v22 单源：wbx/daemon/ui 三处引用同值；此处不再重复定义）

export function readUiState() {
  try {
    return parseUiState(fs.readFileSync(UI_STATE_FILE, 'utf8'));
  } catch {
    return { ok: false, state: null };
  }
}

// 原子写原语（tmp+rename）：状态/宿主配置文件中途截断 = 守护失联或宿主 config 损坏（v23 评审 P1）
function writeJsonAtomicSync(file, data) {
  const tmp = file + '.wbx-tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function writeUiState(state) {
  fs.mkdirSync(UI_RUN_DIR, { recursive: true });
  writeJsonAtomicSync(UI_STATE_FILE, JSON.stringify(state, null, 2) + '\n');
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

/** 组装三条件实测并给决策（probeExisting 与 statusUi 共用装配）；返回 {decision, health}。 */
async function probeDecision_(state) {
  const health = await fetchHealth(state.port);
  const decision = decideExisting({
    hasState: true,
    stale: isStaleState(state, Date.now(), os.uptime() * 1000),
    pidAlive: pidAlive(state.pid),
    healthOk: health.ok,
    pidMatch: health.ok && health.pid === state.pid,
  });
  return { decision, health };
}

/** 组装三条件实测并给决策；返回 {decision, state, health}。 */
export async function probeExisting() {
  const { ok, state } = readUiState();
  if (!ok) return { decision: 'none', state: null };
  const { decision, health } = await probeDecision_(state);
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
 * 绝不抛异常——脚本化拉起路径必须永远快速且安全返回。
 * @returns {{ok:boolean, action?:'reused'|'started', message:string, pid?:number, port?:number, url?:string}}
 */
export async function detachUi({ port = UI_DEFAULT_PORT } = {}) {
  const url = (p) => `http://127.0.0.1:${p}`;
  const reuse = (pid, p) => ({ ok: true, action: 'reused', pid, port: p, url: url(p), message: `控制台已在运行（复用，pid ${pid}）：${url(p)}` });
  try {
    ensureDirs();
    const probe = await probeExisting();
    if (probe.decision === 'reuse') {
      return reuse(probe.state.pid, probe.state.port);
    }
    if (probe.decision === 'replace') removeUiStateIf(probe.state.pid);
    if (probe.decision === 'conflict') {
      // 可能是另一路 --detach 正在启动（竞态窗口）：短暂复探一次
      await sleep(800);
      const again = await fetchHealth(probe.state.port, 1000);
      if (again.ok && again.pid === probe.state.pid) {
        return reuse(probe.state.pid, probe.state.port);
      }
      const msg = `状态不一致：pid ${probe.state.pid} 存活但健康检查不匹配（疑似端口被占或 pid 被复用）。` +
        `处理：wbx ui --stop 清理后再 --detach；仍失败则检查端口（netstat -ano | findstr :${probe.state.port}）`;
      appendUiLog(`[detach] ${new Date().toISOString()} conflict: ${msg}`);
      return { ok: false, message: msg };
    }

    // spawn 守护进程：直接 node.exe + 参数向量，绝不 shell；stdio 全部落 ui.log。
    // cwd=父进程 cwd：守护每项目化——子进程按同一 cwd 解析 <git 根>/.wbx，绑定启动时所在项目
    //（WBX_HOME 注入时子进程继承 env，同根；绝不以 SCRIPT_DIR 为 cwd——技能目录不是项目根）。
    const logFd = prepareUiLog();
    const entry = path.join(SCRIPT_DIR, 'wbx.mjs');
    const child = spawn(process.execPath, [entry, 'ui', '--daemon', '--port', String(port), '--no-open'], {
      detached: true, stdio: ['ignore', logFd, logFd], windowsHide: true, cwd: process.cwd(),
    });
    const childPid = child.pid;
    child.unref();
    fs.closeSync(logFd);

    // 等就绪：health OK / 子进程退出 / 超时（3.5s——脚本化拉起路径预算须留余量；正常冷启动约 1-2s）
    const outcome = await new Promise((resolve) => {
      let done = false;
      const fin = (v) => { if (!done) { done = true; clearInterval(iv); clearTimeout(guard); resolve(v); } };
      child.once('exit', (code) => fin({ exited: true, code }));
      child.once('error', () => fin({ exited: true, code: -1 }));
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
      // 子进程没起来。端口上有活 wbx 实例时区分归属（每项目化）：本 RT 状态文件记录同 pid
      // =同项目竞态赢家 → 复用；否则=他人/他项目守护占用 → 明确报错+--port 换端口提示。
      const again = await fetchHealth(port, 1000);
      if (again.ok) {
        const cur = readUiState();
        if (cur.ok && cur.state.pid === again.pid) {
          return reuse(again.pid, port);
        }
        const msg = `端口 ${port} 已被其他 wbx 控制台占用（pid ${again.pid}，可能是其他项目的守护进程${cur.ok ? '' : '；本项目状态文件无此实例'}）。处理：wbx ui --detach --port <其他端口> 另起本项目控制台（占用详情：netstat -ano | findstr :${port}）`;
        appendUiLog(`[detach] ${new Date().toISOString()} occupied-by-other pid=${again.pid}`);
        return { ok: false, message: msg };
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

export async function stopUi({ port = UI_DEFAULT_PORT } = {}) {
  const { ok, state } = readUiState();
  if (!ok) {
    const h = await fetchHealth(port);
    if (h.ok) return { ok: false, message: `守护状态文件不存在，但 ${port} 端口有本控制台实例（pid ${h.pid}，可能是前台模式或其他项目的守护——每项目守护各自管理）。处理：前台实例在对应终端 Ctrl+C 退出；其他项目实例请到该项目内运行 wbx ui --stop` };
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
  const { decision } = await probeDecision_(state);
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

