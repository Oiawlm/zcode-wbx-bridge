#!/usr/bin/env node
// tools/doubao-bridge/doubao.mjs
// 豆包桌面端「工作模式」CDP 驱动 CLI。
// 依赖：playwright-core + Node 内置模块。选择器一律来自同目录 anchors.json。
// 本文件不出现、不读取、不传递任何凭证，也不触碰应用 userData 目录。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANCHORS_FILE = path.join(HERE, 'anchors.json');

const EXIT = { OK: 0, GENERIC: 1, ANCHOR: 2, CDP: 3, CONFIG: 4, READ_TIMEOUT: 5 };

const DEFAULT_MODEL = '豆包 2.1 Pro';
const DEFAULT_REASONING = '高';
const REASONING_VALUES = ['低', '中', '高'];

const USAGE = [
  'doubao.mjs status',
  'doubao.mjs new-task',
  `doubao.mjs configure [--model <name>] [--reasoning <${REASONING_VALUES.join('|')}>]`,
  'doubao.mjs send <text...> | --file <path>',
  'doubao.mjs read [--wait-ms 180000] [--poll-ms 3000] [--index -1]',
  'doubao.mjs ask <text...> | --file <path>',
  'global: --cdp-url <url> --timeout-ms <n>',
].join('\n');

class CliError extends Error {
  constructor(message, code = EXIT.GENERIC, extra = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.extra = extra;
  }
}

function emit(payload) {
  let line;
  try {
    line = JSON.stringify(payload);
  } catch {
    line = JSON.stringify({ ok: false, reason: 'JSON 序列化失败' });
  }
  process.stdout.write(`${line}\n`);
}

const anchors = initAnchors();

// anchors.json 与脚本同目录，按 import.meta.url 解析，保证任意 CWD 运行都正确。
// 注意：不能在模块求值阶段让异常逃逸——那会绕过 main() 的统一错误出口，导致 stdout 无 JSON。
// 这里捕获后存入哨兵，main() 开头统一转成 CliError 走正常 JSON 出口。
function initAnchors() {
  try {
    return loadAnchors();
  } catch (err) {
    return err;
  }
}

function loadAnchors() {
  const text = readFileSync(ANCHORS_FILE, 'utf8');
  return JSON.parse(text);
}

// ---------------------------------------------------------------- 参数

function toPositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError(`${name} 必须是正整数: ${value}`, EXIT.GENERIC, { usage: USAGE });
  }
  return Math.floor(n);
}

function parseArgv(argv) {
  const opts = {
    cdpUrl: 'http://127.0.0.1:9225',
    timeoutMs: 8000,
    file: null,
    waitMs: 180000,
    pollMs: 3000,
    index: -1,
    model: DEFAULT_MODEL,
    reasoning: DEFAULT_REASONING,
  };
  const positional = [];

  const takeValue = (arg, i) => {
    const eq = arg.indexOf('=');
    if (eq !== -1) return [arg.slice(eq + 1), i];
    if (i + 1 >= argv.length) {
      throw new CliError(`参数缺少取值: ${arg}`, EXIT.GENERIC, { usage: USAGE });
    }
    return [argv[i + 1], i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2).split('=')[0];
    switch (key) {
      case 'cdp-url': { const [v, ni] = takeValue(arg, i); opts.cdpUrl = v; i = ni; break; }
      case 'timeout-ms': { const [v, ni] = takeValue(arg, i); opts.timeoutMs = toPositiveInt(v, '--timeout-ms'); i = ni; break; }
      case 'wait-ms': { const [v, ni] = takeValue(arg, i); opts.waitMs = toPositiveInt(v, '--wait-ms'); i = ni; break; }
      case 'poll-ms': { const [v, ni] = takeValue(arg, i); opts.pollMs = toPositiveInt(v, '--poll-ms'); i = ni; break; }
      case 'index': {
        const [v, ni] = takeValue(arg, i);
        const n = Number(v);
        if (!Number.isInteger(n)) throw new CliError(`--index 必须是整数: ${v}`, EXIT.GENERIC);
        opts.index = n;
        i = ni;
        break;
      }
      case 'model': { const [v, ni] = takeValue(arg, i); opts.model = v; i = ni; break; }
      case 'reasoning': { const [v, ni] = takeValue(arg, i); opts.reasoning = v; i = ni; break; }
      case 'file': { const [v, ni] = takeValue(arg, i); opts.file = v; i = ni; break; }
      default: throw new CliError(`未知参数: ${arg}`, EXIT.GENERIC, { usage: USAGE });
    }
  }
  return { opts, positional };
}

function modelLabel(opts) {
  return anchors.modelItems?.[opts.model] ?? opts.model;
}

function reasoningLabel(opts) {
  const v = opts.reasoning;
  const known = Object.hasOwn(anchors.reasoningLevels ?? {}, v);
  if (!known && !REASONING_VALUES.includes(v)) {
    throw new CliError(`非法推理档位: ${v}`, EXIT.GENERIC, { allowed: REASONING_VALUES });
  }
  return anchors.reasoningLevels?.[v] ?? v;
}

function resolveTaskText(rest, opts) {
  if (opts.file) {
    try {
      return readFileSync(path.resolve(process.cwd(), opts.file), 'utf8');
    } catch (err) {
      throw new CliError(`无法读取 --file: ${err.message}`, EXIT.GENERIC, { file: opts.file });
    }
  }
  return rest.join(' ').trim();
}

// ---------------------------------------------------------------- 连接与定位

async function connectBrowser(cdpUrl, timeoutMs) {
  try {
    return await chromium.connectOverCDP(cdpUrl, { timeout: timeoutMs });
  } catch (err) {
    throw new CliError(`CDP 不可达: ${cdpUrl}`, EXIT.CDP, { cdp: cdpUrl, reason: err.message });
  }
}

function candidatesFor(key) {
  const value = anchors[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new CliError(`anchors.json 缺少锚点: ${key}`, EXIT.ANCHOR, { anchor: key });
  }
  return value;
}

// 只认主应用页，launcher / background 页一律不碰
async function getAppPage(browser, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 3000);
  for (;;) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().includes('doubao-chat/chat')) return page;
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new CliError('未找到主应用页(doubao-chat/chat)', EXIT.ANCHOR, { anchor: 'appPage' });
}

// 在候选数组内按优先级找第一个可用选择器；用 .first() 规避 strict mode 误判
async function tryResolve(page, key, { timeoutMs, state = 'visible' } = {}) {
  const candidates = candidatesFor(key);
  const budget = Math.max(1, timeoutMs ?? 8000);
  const deadline = Date.now() + budget;
  for (const sel of candidates) {
    const remain = deadline - Date.now();
    if (remain <= 0) break;
    try {
      await page.locator(sel).first().waitFor({ state, timeout: remain });
      return sel;
    } catch {
      // 该候选不可用，继续下一个（顺序即优先级，不额外发明选择器）
    }
  }
  return null;
}

// 任何锚点全候选失配 → exit 2，绝不硬重试、绝不换 locator 猜
async function resolveAnchor(page, key, opts) {
  const sel = await tryResolve(page, key, opts);
  if (!sel) {
    throw new CliError(`锚点失配: ${key}`, EXIT.ANCHOR, {
      anchor: key,
      candidates: anchors[key],
    });
  }
  return page.locator(sel).first();
}

async function resolveOne(page, key, opts) {
  return resolveAnchor(page, key, opts);
}

// ---------------------------------------------------------------- 状态栏

function normalizeText(raw) {
  return (raw ?? '').replace(/\s+/g, ' ').trim();
}

// 状态栏文本 = 模型名 + 推理档连写，如「豆包 2.1 Pro高」「自动」。
// 只认已知模型名 + 可选档位后缀：宽松正则会把以「高/中/低」结尾的模型名误截成档位
function buildStatusRegex() {
  const names = new Set(['自动']);
  for (const label of Object.values(anchors?.modelItems ?? {})) names.add(label);
  const alts = [...names].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^(${alts})\\s*([${REASONING_VALUES.join('')}])?$`);
}

function parseStatus(text) {
  const raw = normalizeText(text);
  const match = buildStatusRegex().exec(raw);
  // 未知形态整体当模型名：后续配置校验必然不满足，从而触发重配而非误判「已配置好」
  if (!match) return { raw, model: raw, reasoning: null };
  return { raw, model: match[1], reasoning: match[2] ?? null };
}

function statusSatisfies(statusText, model, reasoning) {
  const parsed = parseStatus(statusText);
  if (model && parsed.model !== model) return false;
  if (reasoning && parsed.reasoning !== reasoning) return false;
  return true;
}

async function readStatusText(page, timeoutMs) {
  const locator = await resolveOne(page, 'modelButton', { timeoutMs, state: 'visible' });
  const text = await locator.textContent({ timeout: timeoutMs });
  return normalizeText(text);
}

async function readStatusTextSafe(page, timeoutMs) {
  try {
    return await readStatusText(page, timeoutMs);
  } catch {
    return null;
  }
}

async function readModeTextSafe(page, timeoutMs) {
  try {
    const locator = await resolveOne(page, 'modeButton', { timeoutMs, state: 'visible' });
    const text = await locator.textContent({ timeout: timeoutMs });
    return normalizeText(text) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- 菜单

async function isMenuOpen(page) {
  const candidates = Array.isArray(anchors.modelMenuContainer) ? anchors.modelMenuContainer : [];
  for (const sel of candidates) {
    const locator = page.locator(sel);
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      if (await locator.nth(i).isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

// Radix 菜单未关时 body 被置为 pointer-events:none，后续所有真实点击都会超时
async function closeMenus(page) {
  for (let i = 0; i < 2; i++) {
    if (!(await isMenuOpen(page))) return true;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  return !(await isMenuOpen(page));
}

// 按精确文本找菜单项；exact 匹配优先，prefix 仅用于「带状态后缀」的父项（如「推理强度中」）
async function findMenuItem(page, { label, prefix = false, timeoutMs, what }) {
  // 菜单项角色选择器统一来自 anchors.json（menuItemSelector），不在代码里硬编码
  const sel = candidatesFor('menuItemSelector')[0];
  const items = page.locator(sel);
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const name = what ?? label;
  for (;;) {
    const total = await items.count().catch(() => 0);
    let prefixHit = null;
    for (let i = 0; i < total; i++) {
      const el = items.nth(i);
      const perEl = Math.min(1000, Math.max(200, deadline - Date.now()));
      const raw = await el.textContent({ timeout: perEl }).catch(() => null);
      if (raw == null) continue;
      const text = normalizeText(raw);
      if (text === label) return el; // 必须精确匹配，has-text 会命中共前缀项
      if (prefix && !prefixHit && text.startsWith(label)) prefixHit = el;
    }
    if (prefixHit) return prefixHit;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(120);
  }
  // 菜单项缺失是配置路径失败（如所选模型不支持推理档），不是锚点候选耗尽 → 用 CONFIG 而非 ANCHOR
  throw new CliError(`菜单项未找到: ${name}`, EXIT.CONFIG, { menuPath: name, expected: label });
}

async function ensureMenuOpen(page, opts) {
  if (await isMenuOpen(page)) return;
  const button = await resolveOne(page, 'modelButton', { timeoutMs: opts.timeoutMs, state: 'visible' });
  await button.click(); // 真实 CDP 点击
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (await isMenuOpen(page)) return;
    await page.waitForTimeout(100);
  }
  throw new CliError('模型菜单未能打开', EXIT.ANCHOR, { anchor: 'modelMenuContainer' });
}

// ---------------------------------------------------------------- 命令实现

async function doStatus(page, opts) {
  const appPageUrl = page.url();
  const model = await readStatusTextSafe(page, opts.timeoutMs);
  const mode = await readModeTextSafe(page, opts.timeoutMs);
  const browserTitle = await page.title().catch(() => null);
  return { cdp: opts.cdpUrl, appPageUrl, model, mode, browserTitle };
}

async function doNewTask(page, opts) {
  const modelBefore = await readStatusText(page, opts.timeoutMs);
  // 侧栏被收起时 create_office_task_button 在视口外、真实点击必然超时——这不是锚点失配，
  // 而是按钮不可达。回退到应用内置快捷键 Ctrl+N（侧栏「新工作任务 Ctrl+N」标注），
  // 并用 workHomePage 锚点验证确实切到了工作模式首页（防止快捷键被吞的假成功）。
  let clicked = false;
  try {
    const button = await resolveOne(page, 'newWorkTaskButton', { timeoutMs: opts.timeoutMs, state: 'visible' });
    await button.click({ timeout: 5000 });
    clicked = true;
  } catch {}
  if (!clicked) {
    await page.keyboard.press('Control+N');
  }
  // 新会话可能把推理档从「高」重置为「中」（实测还会不稳定复现/不复现），这里只等切换稳定
  await page.waitForTimeout(1500);
  const home = await tryResolve(page, 'workHomePage', { timeoutMs: 5000, state: 'visible' });
  if (!home) {
    throw new CliError('新工作任务未生效（未检测到工作模式首页）', EXIT.CONFIG, { workHomePage: anchors.workHomePage });
  }
  return { modelBefore };
}

async function doConfigure(page, opts) {
  const wantModel = modelLabel(opts);
  const wantReasoning = reasoningLabel(opts);

  // 起始状态必须是干净的，否则后面的真实点击会因模态层全部超时
  if (!(await closeMenus(page))) {
    throw new CliError('检测到遗留菜单且无法关闭', EXIT.CONFIG, { reason: 'menu-not-closed' });
  }

  const statusBefore = await readStatusText(page, opts.timeoutMs);
  const parsedBefore = parseStatus(statusBefore);
  const needModel = parsedBefore.model !== wantModel;
  const needReasoning = parsedBefore.reasoning !== wantReasoning;

  if (!needModel && !needReasoning) {
    return { already: true, status: statusBefore };
  }

  await ensureMenuOpen(page, opts);

  if (needModel) {
    const item = await findMenuItem(page, {
      label: wantModel,
      prefix: true, // 菜单项可能带副标题/角标，精确优先、前缀兜底
      timeoutMs: opts.timeoutMs,
      what: `模型 ${wantModel}`,
    });
    await item.click(); // 合成点击不会关闭 Radix 菜单，必须真实点击
  }

  if (needReasoning) {
    // 选中模型后菜单可能已被 Radix 关闭，按当前可见状态决定是否重开（不是盲重试）
    await ensureMenuOpen(page, opts);
    const entry = await findMenuItem(page, {
      label: '推理强度',
      prefix: true, // 父项文本是「推理强度中」这类连写
      timeoutMs: opts.timeoutMs,
      what: '推理强度',
    });
    await entry.click(); // 展开子菜单
    const level = await findMenuItem(page, {
      label: wantReasoning,
      prefix: false, // 档位必须精确匹配，否则会被「推理强度高」等父项误命中
      timeoutMs: opts.timeoutMs,
      what: `推理强度 ${wantReasoning}`,
    });
    await level.click();
  }

  if (!(await closeMenus(page))) {
    throw new CliError('菜单无法关闭', EXIT.CONFIG, { reason: 'menu-not-closed' });
  }

  // 状态栏是真源：配置完必须读回文本验证，而不是相信点击成功
  const statusAfter = await readStatusText(page, opts.timeoutMs);
  if (!statusSatisfies(statusAfter, wantModel, wantReasoning)) {
    throw new CliError('配置校验失败', EXIT.CONFIG, {
      expectedModel: wantModel,
      expectedReasoning: wantReasoning,
      statusBefore,
      statusAfter,
    });
  }
  return { already: false, statusBefore, statusAfter };
}

// 短文本走逐键键入（真实键盘事件，绕过系统 IME）；长文本走 insertText 免逐键延迟
async function typeIntoEditor(page, text) {
  if (text.length > 200) {
    await page.keyboard.insertText(text);
  } else {
    await page.keyboard.type(text);
  }
}

async function doSend(page, opts, text) {
  const payload = text.trim();
  if (!payload) throw new CliError('发送内容为空', EXIT.GENERIC, { usage: USAGE });

  const wantModel = modelLabel(opts);
  const wantReasoning = reasoningLabel(opts);

  // 会话可能刚被新建/切换而把推理档重置，发送前强制重读状态栏并按需重配
  let statusAtSend = await readStatusText(page, opts.timeoutMs);
  if (!statusSatisfies(statusAtSend, wantModel, wantReasoning)) {
    await doConfigure(page, opts); // 内部已校验，失败即 exit 4
    statusAtSend = await readStatusText(page, opts.timeoutMs);
    if (!statusSatisfies(statusAtSend, wantModel, wantReasoning)) {
      throw new CliError('发送前状态校验失败', EXIT.CONFIG, {
        expectedModel: wantModel,
        expectedReasoning: wantReasoning,
        statusAtSend,
      });
    }
  }

  const editor = await resolveOne(page, 'editor', { timeoutMs: opts.timeoutMs, state: 'visible' });
  await editor.click(); // 真实点击聚焦
  // 分步使用 send 时编辑器可能残留草稿：先清空再输入，避免拼接成意外任务
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await typeIntoEditor(page, payload);

  // chat_input_send_button 仅在编辑器有内容后才渲染，必须在输入之后定位
  const sendButton = await resolveOne(page, 'sendButton', { timeoutMs: opts.timeoutMs, state: 'visible' });
  await sendButton.click();

  return { sent: true, modelAtSend: statusAtSend };
}

async function countMessages(page, key) {
  for (const sel of candidatesFor(key)) {
    const count = await page.locator(sel).count().catch(() => 0);
    if (count > 0) return { sel, count };
  }
  return { sel: null, count: 0 };
}

async function extractMessageText(messageLocator, timeoutMs) {
  const parts = [];
  for (const sel of candidatesFor('messageTextContent')) {
    const inner = messageLocator.locator(sel);
    const count = await inner.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const text = await inner.nth(i).innerText({ timeout: timeoutMs }).catch(() => '');
      const trimmed = (text ?? '').trim();
      if (trimmed) parts.push(trimmed);
    }
    if (parts.length) return parts.join('\n');
  }
  const fallback = await messageLocator.innerText({ timeout: timeoutMs }).catch(() => '');
  return fallback.trim();
}

async function doRead(page, opts) {
  const startedAt = Date.now();
  await resolveAnchor(page, 'messageList', { timeoutMs: opts.timeoutMs, state: 'attached' });

  let lastText = null;
  let stablePolls = 0;
  let lastCount = 0;
  let sawReply = false;
  const deadline = startedAt + opts.waitMs;

  for (;;) {
    const { sel, count } = await countMessages(page, 'receivedMessage');
    if (sel && count > 0) {
      sawReply = true;
      lastCount = count;
      const index = opts.index < 0 ? count + opts.index : opts.index;
      if (index >= 0 && index < count) {
        const messageLocator = page.locator(sel).nth(index);
        const text = await extractMessageText(messageLocator, opts.timeoutMs);

        // 完成判定 a：目标消息存在且文本非空
        if (text.length > 0) {
          // 完成判定 b：全文等值连续 3 次观测（stablePolls 到 2 即第 3 次）——比「长度不变」更严，
          // 长度不变但内容仍在换字的假完成被排除；不用 class / 流式光标判完成
          if (text === lastText) stablePolls += 1;
          else {
            stablePolls = 0;
            lastText = text;
          }
          if (stablePolls >= 2) {
            return { text, elapsedMs: Date.now() - startedAt, messageCount: count };
          }
        }
      }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(opts.pollMs);
  }

  const extra = {
    elapsedMs: Date.now() - startedAt,
    messageCount: lastCount,
    waitMs: opts.waitMs,
  };
  if (!sawReply) extra.anchor = 'receivedMessage';
  throw new CliError('等待回复超时', EXIT.READ_TIMEOUT, extra);
}

// ask 全链路中给每一步打上归因标签，失败时能定位到具体步骤
async function step(name, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CliError) err.extra = { ...err.extra, step: name };
    throw err;
  }
}

async function doAsk(page, opts) {
  const text = resolveTaskText(opts.rest, opts);
  await step('new-task', () => doNewTask(page, opts));
  await step('configure', () => doConfigure(page, opts));
  const { modelAtSend } = await step('send', () => doSend(page, opts, text));
  const { text: reply, elapsedMs } = await step('read', () => doRead(page, opts));
  return { modelAtSend, text: reply, elapsedMs, conversationUrl: page.url() };
}

// ---------------------------------------------------------------- 调度

async function runCommand(cmd, rest, opts, page) {
  switch (cmd) {
    case 'status':
      return doStatus(page, opts);
    case 'new-task':
      return doNewTask(page, opts);
    case 'configure':
      return doConfigure(page, opts);
    case 'send':
      return doSend(page, opts, resolveTaskText(rest, opts));
    case 'read':
      return doRead(page, opts);
    case 'ask':
      return doAsk(page, opts);
    default:
      throw new CliError(`未知命令: ${cmd}`, EXIT.GENERIC, { usage: USAGE });
  }
}

async function main() {
  const { opts, positional } = parseArgv(process.argv.slice(2));
  const cmd = positional[0];
  if (!cmd) throw new CliError('缺少命令', EXIT.GENERIC, { usage: USAGE });
  opts.rest = positional.slice(1);
  if (cmd === 'help') return { usage: USAGE };
  // 顶层加载失败的哨兵在这里统一转成 JSON 出口（help 不依赖 anchors，放行）
  if (anchors instanceof Error) {
    throw new CliError(`anchors.json 不可用: ${anchors.message}`, EXIT.GENERIC, { file: ANCHORS_FILE });
  }

  let browser = null;
  try {
    browser = await connectBrowser(opts.cdpUrl, opts.timeoutMs);
    const page = await getAppPage(browser, opts.timeoutMs);
    return await runCommand(cmd, opts.rest, opts, page);
  } finally {
    // connectOverCDP 的 close 只是断开 attach，不会关掉豆包应用（不 kill）
    if (browser) {
      try {
        await browser.close();
      } catch {
        // 断开失败不影响命令结果
      }
    }
  }
}

main().then(
  (result) => {
    emit({ ok: true, ...(result ?? {}) });
    process.exitCode = EXIT.OK;
  },
  (err) => {
    const code = err instanceof CliError ? err.code : EXIT.GENERIC;
    if (code === EXIT.GENERIC) {
      process.stderr.write(`doubao.mjs: ${err?.stack ?? String(err)}\n`);
    }
    emit({
      ok: false,
      reason: err?.message ?? String(err),
      ...(err instanceof CliError ? err.extra : {}),
    });
    process.exitCode = code;
  },
);
