#!/usr/bin/env node
/**
 * wbx — ZCode ↔ WorkBuddy AI 联动桥 CLI（v3：可观测 + 全局化 + 可视化 + 可分发）
 *
 * 可复用逻辑在 ./wbx-core.mjs，安装/打包在 ./wbx-setup.mjs，Web UI 在 ./wbx-ui.mjs。
 * 本文件是薄 CLI 壳：参数解析 + 输出格式化。
 *
 * 双 lane：ai = 国际版（deepseek-v4.1-flash x0.00 免费）；cn = 国内版（x0.03 近免费）。
 * 默认路由由 config.default-lane 决定（auto = ai 免费优先）；失败/限流自动回退另一 lane（各一次）。
 *
 * 用法（node wbx.mjs <子命令>，详见 --help）：
 *   doctor / login / ask / fanout / models          v2 全量保留
 *   config get|set|list                             v3 运行时配置（存 <运行时根>/config.json）
 *   history [--last N] / history <jobId>            v3 job 历史与完整回放（含旧 .wbx/tasks/）
 *   install-user / uninstall-user                   v2 用户级 AGENTS.md 标记块
 *   self-install / self-uninstall                   v3 用户级全局安装（~/.zcode + ~/.wbx）
 *   ui [--port 7788]                                v3 本地 Web UI（127.0.0.1，无常驻）
 *   export-bundle [--out <dir>]                     v3 分发打包（零凭证，含自检断言）
 *
 * 约束：绝不写 ~/.workbuddy、~/.workbuddy-ai；凭证只存 .wbx/ 或 ~/.wbx/（均 gitignore），
 * 绝不打印其内容。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  WBX_VERSION, SCRIPT_DIR, PROJECT_ROOT, RUNTIME_ROOT, JOBS_DIR, LEGACY_TASKS_DIR,
  IDENTITIES, LANE_ORDER, CONFIG_DEFS,
  clineReady, clineProvidersFile, clineHomeDir, runClineAuth,
  sleep, die, redact, brief, fmtMs, ansiStrip,
  ensureDirs, readStdin, migrateIfNeeded,
  loadConfig, setConfig, parseConfigValue,
  resolveDefaultLane, laneStatusInfo, parseLane, laneReady,
  askOnce, resolveModel,
  runAskJob, runFanoutJob,
  listJobs, getJob,
  startLogin, pollLoginToken, fetchAccountInfo, persistLogin,
  doctorStatus,
  USER_AGENTS_PATH, installUserBlock, uninstallUserBlock,
  openBrowser, httpJson, exitWith,
} from './wbx-core.mjs';
import { selfInstall, selfUninstall, exportBundle } from './wbx-setup.mjs';

// ---------- 子命令：doctor ----------
async function cmdDoctor(opts) {
  const r = await doctorStatus({ probe: !opts.noProbe, onLine: (m) => console.error(m) });
  const ready = r.readyLanes;
  if (ready.length && r.lanes.some((l) => l.probe && !l.probe.good && r.lanes.some((x) => x.probe?.good))) {
    console.error(`[WARN] ${r.lanes.filter((l) => l.probe && !l.probe.good).length} 个 lane 探测失败，但仍有可用 lane（${ready.join(',')}）`);
  }
  console.error('');
  console.error(r.ok ? `[OK] doctor 通过（运行时 ${r.runtimeRoot}，版本 v${r.version}）`
    : `[FAIL] doctor 未通过（exit 1；按上面每行的修复指引处理）`);
  await exitWith(r.ok ? 0 : 1);
}

// ---------- 子命令：login ----------
async function cmdLogin(opts) {
  ensureDirs();
  const identity = opts.identity ? (() => { const k = parseLane(opts.identity); if (!k) die(`--identity 只支持 ai | cn | cline（收到 ${opts.identity}）`); return k; })() : 'cn';

  // cline lane：OAuth 设备授权流（spawn cline auth，stdio 直通，用户在浏览器完成）
  if (identity === 'cline') {
    if (clineReady() && !opts.force) {
      console.log(`[OK] lane cline 已登录（${clineProvidersFile()} 存在有效凭证）。加 --force 重新登录`);
      return;
    }
    console.error('[1/2] 启动 cline OAuth 设备授权（浏览器完成，桥不代输任何凭证）…');
    try {
      const r = await runClineAuth();
      if (r.ok) {
        console.error(`[2/2] 完成：cline 凭证已落隔离目录 ${clineHomeDir()}（.cline/data/settings/providers.json，绝不在用户 ~/.cline）`);
        console.error('验证：node wbx.mjs doctor（lane cline 段应全绿）。模型建议：wbx models --as cline --probe "<vendor/model 候选id>" 探测后 config set cline-model "<模型 id>"');
      } else {
        die(`cline 登录未完成（auth 退出码 ${r.exitCode}，凭证未落盘）。常见原因：浏览器未在有效期内确认设备码。重新运行本命令即可`);
      }
    } catch (e) {
      die(e.message);
    }
    return;
  }

  const id = IDENTITIES[identity];
  if (laneReady(identity) && !opts.force) {
    console.log(`[OK] lane ${identity}（${id.label}）已登录（sessions/${identity}.json 存在）。加 --force 重新登录`);
    return;
  }

  // 1. 产品配置模板 + state
  let ctx;
  try {
    ctx = await startLogin(identity);
  } catch (e) {
    die(e.message);
  }
  console.error(`[1/5] 产品身份：${ctx.source.productName} @ ${ctx.endpoint}（platform=${ctx.platform}，identity=${identity}，${ctx.source.models?.length ?? '?'} 模型，deepseek-v4.1-flash：${ctx.hasDeepseek ? '有' : '无'}）`);
  if (!ctx.hasDeepseek) console.error(`[WARN] 模板不含 deepseek-v4.1-flash，登录后模型探测可能失败`);

  // 2. 打印登录链接 + 锦囊
  fs.writeFileSync(path.join(RUNTIME_ROOT, `login-url-${identity}.txt`), ctx.authUrl + '\n', 'utf8');
  console.error(`[2/5] 请在浏览器完成登录（链接已写入运行时根 login-url-${identity}.txt）：\n`);
  console.log(ctx.authUrl + '\n');
  if (identity === 'cn') {
    console.error('国内版：页面选「微信登录」扫码即可（协议弹窗点「同意」）。');
    console.error('注意：尽量在自动打开的那个标签页里完成，中途别切到旧的登录页；扫码流程 state 稳定。');
  } else {
    console.error('国际版：邮箱/OneID 登录。已知 bug：登录跳转后 state 丢失，页面显示「登录失败」。');
    console.error('若遇到，按顺序尝试（state 只在本轮有效，直接复制下面整行 URL 到地址栏回车）：');
    for (const tip of ctx.tips) console.error(`    ${tip}`);
  }
  if (!opts.noOpen) {
    openBrowser(ctx.authUrl);
    console.error('已尝试自动打开默认浏览器；若未弹出，请手动复制上面的链接到浏览器。');
  }

  // 3. 轮询 token
  const waitMs = (opts.wait ?? 300) * 1000;
  console.error(`[3/5] 等待登录完成（最长 ${Math.round(waitMs / 1000)} 秒，每 2 秒轮询一次）…`);
  const { authToken, pending } = await pollLoginToken(ctx, waitMs);
  if (pending || !authToken) die(`等待登录超时（${Math.round(waitMs / 1000)}s，未拿到 token）。请重新运行 login`);

  // 4. 账号信息（仅显示用，失败不阻塞）
  console.error('[4/5] 登录成功，获取账号信息 …');
  const account = await fetchAccountInfo(ctx, authToken);

  // 5. 落盘
  await persistLogin(ctx, authToken, account);
  const who = account ? `${account.nickname || ''}（uin ${String(account.uin || '').slice(0, 2)}***${String(account.uin || '').slice(-2)}）`.trim() : '（账号信息未获取，不影响使用）';
  console.error(`[5/5] 完成：lane ${identity}（${id.label}），${who}`);
  console.error(`凭证仅存于运行时根（${RUNTIME_ROOT}，已 gitignore，请勿外传）。验证：node wbx.mjs doctor`);
}

// ---------- 子命令：ask ----------
async function cmdAsk(opts) {
  let prompt = null;
  if (opts.file) prompt = await fsp.readFile(path.resolve(opts.file), 'utf8');
  else if (opts.prompt != null) prompt = opts.prompt;
  else if (opts.stdin) prompt = await readStdin();
  if (!prompt || !prompt.trim()) die('缺少提示词：用 --file <path>、--text "<prompt>" 或 --stdin 提供');

  if (prompt.length > 12000) {
    console.error(`[INFO] 提示词 ${prompt.length} 字符：超 12k 自动改走 stdin 通道（v4，无命令行长度限制）；材料过长会增加耗时与费用，建议按需裁剪`);
  }

  try {
    const r = await runAskJob({
      prompt,
      as: opts.as || null,
      model: opts.model || null,
      effort: opts.effort || null,
      timeoutS: opts.timeout ?? 300,
    });
    if (r.ok) {
      console.error(`[OK] lane=${r.lane} model=${r.model} 耗时=${fmtMs(r.durationMs)} tokens(in/out)=${r.usage.in ?? '?'}/${r.usage.out ?? '?'}`);
      if (r.fallbackFrom) console.error(`[FALLBACK] 主 lane ${r.fallbackFrom} 失败，已改投 lane ${r.lane}`);
      console.error(`[job] 记录 -> ${r.jobDir}`);
      if (opts.json) console.log(JSON.stringify({ jobId: r.jobId, lane: r.lane, model: r.model, usage: r.usage, durationMs: r.durationMs, result: r.text }, null, 2));
      else console.log(r.text);
      await exitWith(0);
    }
    console.error(`[FAIL] 两个 lane 均失败；最后错误 kind=${r.kind}${r.hint === 'login' ? '（未登录/凭证过期 -> wbx login）' : r.hint === 'ratelimit' ? '（疑似限流/配额 -> 降低并发或稍后再试）' : ''}`);
    console.error(r.error || '(无错误详情)');
    console.error(`[job] 记录 -> ${r.jobDir}`);
    await exitWith(1);
  } catch (e) {
    die(e.message);
  }
}

// ---------- 子命令：fanout ----------
async function cmdFanout(opts) {
  const tasksPath = path.resolve(opts.file);
  let raw;
  try { raw = JSON.parse(await fsp.readFile(tasksPath, 'utf8')); } catch (e) { die(`读取/解析 tasks.json 失败：${e.message}`); }
  if (!Array.isArray(raw) || !raw.length) die('tasks.json 必须是非空数组：[{id, prompt|file, as?, model?, effort?, files?}]');

  // file 字段支持（相对 tasks.json 所在目录）；v4 files 字段：材料文件拼接进提示词
  const tasksIn = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i] || {};
    let prompt = typeof t.prompt === 'string' ? t.prompt : null;
    if (!prompt && typeof t.file === 'string') {
      try { prompt = await fsp.readFile(path.resolve(path.dirname(tasksPath), t.file), 'utf8'); }
      catch (e) { die(`任务 ${i}（${t.id ?? '?'}）读取 file 失败：${e.message}`); }
    }
    if (Array.isArray(t.files) && t.files.length) {
      if (!prompt) die(`任务 ${i}（${t.id ?? '?'}）的 files 必须与 prompt 或 file 搭配（files 只追加材料）`);
      const parts = [];
      for (const f of t.files) {
        if (typeof f !== 'string') die(`任务 ${i}（${t.id ?? '?'}）的 files 数组元素必须是字符串`);
        try {
          const c = await fsp.readFile(path.resolve(path.dirname(tasksPath), f), 'utf8');
          parts.push(`----- 文件 ${f} 开始 -----\n${c}\n----- 文件 ${f} 结束 -----`);
        } catch (e) { die(`任务 ${i}（${t.id ?? '?'}）读取 files[${f}] 失败：${e.message}`); }
      }
      prompt = `${prompt}\n\n【输入材料·文件】\n${parts.join('\n\n')}`;
    }
    tasksIn.push({ id: t.id, prompt, as: t.as ?? null, model: t.model ?? null, effort: t.effort ?? null });
  }

  let lanes = null;
  if (opts.lanes) {
    lanes = opts.lanes.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const k of lanes) if (!(IDENTITIES[k] || k === 'cline')) die(`--lanes 只支持 ai,cn,cline 的组合（收到 "${k}"）`);
    if (!lanes.length) die('--lanes 不能为空');
  }

  try {
    const r = await runFanoutJob({
      tasksIn,
      lanes,
      parallel: opts.parallel ?? null,
      timeoutS: opts.timeout ?? 300,
      retry: opts.retry ?? null,
      log: (m) => console.error(`[fanout] ${m}`),
    });
    const rlCount = r.results.filter((x) => /rate.?limit|429|quota|限流/i.test(String(x.error || ''))).length;
    console.error(`\n[fanout] 完成：成功 ${r.okCount}/${r.total}，总耗时见 summary，job=${r.jobId}`);
    if (rlCount) console.error(`[fanout] ⚠️ ${rlCount} 个疑似限流失败 -> 建议降并发重跑`);
    console.log(r.jobDir); // stdout 输出结果目录，便于脚本衔接
    await exitWith(r.okCount === r.total ? 0 : 1);
  } catch (e) {
    die(e.message);
  }
}

// ---------- 子命令：models ----------
async function readProductConfigModels(laneKey) {
  const id = IDENTITIES[laneKey] || IDENTITIES[resolveDefaultLane()];
  const other = IDENTITIES[id.key === 'ai' ? 'cn' : 'ai'];
  const candidates = [
    { p: id.productPath, label: `product/${id.key}.json（custom-token 注入，lane ${id.key}）` },
    { p: id.templatePath, label: `${id.key === 'ai' ? '~/.workbuddy-ai' : '~/.workbuddy'}/cache/（${id.label}运行时缓存，只读）` },
    { p: other.templatePath, label: `${other.key === 'ai' ? '~/.workbuddy-ai' : '~/.workbuddy'}/cache/（${other.label}缓存，只读）` },
  ];
  for (const c of candidates) {
    try {
      const j = JSON.parse(await fsp.readFile(c.p, 'utf8'));
      if (Array.isArray(j.models) && j.models.length) {
        return {
          source: c.label,
          models: j.models.map((m) => ({ id: m.id, desc: m.descriptionZh || m.descriptionEn || '' })),
        };
      }
    } catch { /* 尝试下一个 */ }
  }
  return null;
}

async function cmdModels(opts) {
  ensureDirs();
  const lane = opts.as ? (() => { const k = parseLane(opts.as); if (!k) die(`--as 只支持 ai | cn | cline（收到 ${opts.as}）`); return k; })() : resolveDefaultLane();
  if (lane === 'cline') {
    const cfg = loadConfig();
    console.error(`lane = cline（provider=${cfg['cline-provider']}，thinking=${cfg['cline-thinking']}，compaction=${cfg['cline-compaction']}）`);
    const list = (opts.probe ? opts.probe.split(',').map((s) => s.trim()).filter(Boolean) : [cfg['cline-model'] || '']).filter(Boolean);
    if (!list.length) console.log('（cline-model 为空=provider 默认模型；要探测候选 id 用 --probe "id1,id2"，免费 DeepSeek id 以实测为准）');
    let allOk = true;
    for (const m of list) {
      process.stdout.write(`探测 ${m} … `);
      const r = await askOnce({ lane: 'cline', model: m, prompt: '请只回复 OK', timeoutMs: 180000 });
      if (r.ok) console.log(`可用（${fmtMs(r.durationMs)}，tokens ${r.usage.in ?? '?'}/${r.usage.out ?? '?'}）`);
      else { allOk = false; console.log(`不可用（${r.kind}: ${brief(r.error, 160)}）`); }
    }
    await exitWith(allOk ? 0 : 1);
    return;
  }
  console.error(`lane = ${lane}（${IDENTITIES[lane].label}）`);
  const list = (opts.probe ? opts.probe.split(',').map((s) => s.trim()).filter(Boolean) : [resolveModel()]);
  let allOk = true;
  for (const m of list) {
    process.stdout.write(`探测 ${m} … `);
    const r = await askOnce({ lane, prompt: '请只回复：OK', model: m, effort: 'low', timeoutMs: 120000 });
    if (r.ok) console.log(`可用（${fmtMs(r.durationMs)}，tokens ${r.usage.in ?? '?'}/${r.usage.out ?? '?'}）`);
    else { allOk = false; console.log(`不可用（${r.kind}: ${brief(r.error, 160)}）`); }
  }

  const pc = await readProductConfigModels(lane);
  if (pc) {
    console.log(`\n产品配置模型列表（${pc.source}，共 ${pc.models.length} 个）：`);
    for (const m of pc.models) console.log(`  - ${m.id}${m.desc ? '  # ' + m.desc : ''}`);
  } else {
    console.log('\n（未找到产品配置文件；跑通一次 ask 后 CLI 可能会生成缓存）');
  }
  await exitWith(allOk ? 0 : 1);
}

// ---------- 子命令：config ----------
async function cmdConfig(opts) {
  const sub = opts._[1];
  const key = opts._[2];
  const cfg = loadConfig();
  if (!sub || sub === 'list') {
    console.log(`运行时根：${RUNTIME_ROOT}（config.json）`);
    for (const [k, def] of Object.entries(CONFIG_DEFS)) {
      console.log(`  ${k.padEnd(20)} = ${JSON.stringify(cfg[k])}${cfg[k] === def.default ? '（默认）' : ''}`);
      console.log(`  ${' '.repeat(20)}   ${def.desc}`);
    }
    await exitWith(0);
  }
  if (sub === 'get') {
    if (!key) die('用法：wbx config get <key>');
    if (!CONFIG_DEFS[key]) die(`未知配置键 ${key}（可用：${Object.keys(CONFIG_DEFS).join(', ')}）`);
    console.log(JSON.stringify(cfg[key]));
    await exitWith(0);
  }
  if (sub === 'set') {
    if (!key) die('用法：wbx config set <key> <value>');
    if (opts._.length <= 3) {
      const eg = key === 'disabled-lanes' ? '["cn"]' : key === 'default-lane' ? 'cn' : '<值>（cli-path 传空串可清空）';
      die(`缺少取值：wbx config set ${key} ${eg}`);
    }
    const valStr = opts._.slice(3).join(' ');
    try {
      const r = await setConfig(key, valStr);
      console.log(`[OK] ${r.key} = ${JSON.stringify(r.value)}（已写入 ${RUNTIME_ROOT}${path.sep}config.json）`);
      await exitWith(0);
    } catch (e) {
      die(e.message);
    }
  }
  die(`未知的 config 子命令 ${sub}（可用：list | get <key> | set <key> <value>）`);
}

// ---------- 子命令：history ----------
function fmtLaneDist(d) {
  return Object.entries(d).map(([k, v]) => `${k}x${v}`).join(' ') || '-';
}

async function cmdHistory(opts) {
  const arg = opts._[1];
  if (!arg || arg.startsWith('-')) {
    const last = opts.last ?? 10;
    const jobs = listJobs().slice(0, last);
    if (!jobs.length) {
      console.log(`（没有历史 job：${JOBS_DIR} 与旧 ${LEGACY_TASKS_DIR} 均为空）`);
      await exitWith(0);
    }
    const w = { time: 20, type: 8, total: 6, rate: 8, lanes: 16, dir: 0 };
    console.log(['时间'.padEnd(w.time), '类型'.padEnd(w.type), '任务数'.padEnd(w.total), '成功率'.padEnd(w.rate), 'lane 分布'.padEnd(w.lanes), '目录'].join(''));
    for (const j of jobs) {
      const t = j.createdAt ? new Date(j.createdAt).toLocaleString('zh-CN', { hour12: false }) : j.id;
      console.log([
        String(t).padEnd(w.time),
        (j.type + (j.legacy ? '(旧)' : '')).padEnd(w.type),
        String(j.total ?? '?').padEnd(w.total),
        (j.successRate == null ? '?' : j.successRate + '%').padEnd(w.rate),
        fmtLaneDist(j.laneDist).padEnd(w.lanes),
        j.dir,
      ].join(''));
    }
    console.error(`\n共 ${jobs.length} 条（--last N 调整）；回放完整对话：wbx history <jobId> [--task <id>]`);
    await exitWith(0);
  }
  const job = await getJob(arg);
  if (!job) die(`找不到 job ${arg}（在 ${JOBS_DIR} 与旧 ${LEGACY_TASKS_DIR} 中均无）`);
  const tasks = opts.task ? job.tasks.filter((t) => t.id === opts.task) : job.tasks;
  if (opts.task && !tasks.length) die(`job ${arg} 中没有任务 ${opts.task}（可用：${job.tasks.map((t) => t.id).join(', ')}）`);
  console.error(`job ${job.id}  类型=${job.type}${job.legacy ? '（旧 tasks/ 兼容）' : ''}  状态=${job.status}  目录=${job.dir}`);
  console.error(`任务数=${job.total ?? '?'}  成功率=${job.successRate == null ? '?' : job.successRate + '%'}  lane 分布=${fmtLaneDist(job.laneDist)}${job.durationMs != null ? `  总耗时=${fmtMs(job.durationMs)}` : ''}\n`);
  for (const t of tasks) {
    const r = t.record;
    const lane = r ? (r.fallbackFrom ? `${r.fallbackFrom}→${r.lane}` : r.lane) : '（无记录）';
    const head = r
      ? `${r.status === 'success' ? '✅' : '❌'} ${r.status} · lane=${lane} · ${fmtMs(r.durationMs ?? 0)} · tokens ${r.usage?.in ?? '?'}/${r.usage?.out ?? '?'} · 尝试 ${r.attempts}`
      : '（该任务无结果记录——job 可能仍在运行或异常中断）';
    console.log(`${'='.repeat(72)}`);
    console.log(`task ${t.id}   ${head}`);
    console.log(`${'='.repeat(72)}`);
    console.log('--- PROMPT（发出的完整提示词）---');
    console.log(t.prompt ?? '（无 tasks-input.json，旧格式 job）');
    console.log('');
    console.log(`--- REPLY（模型回复全文）---`);
    if (r?.result != null) console.log(r.result);
    else if (r?.error) console.log(`[错误] ${r.error}`);
    else console.log('（无）');
    console.log('');
  }
  await exitWith(0);
}

// ---------- 子命令：install-user / uninstall-user（v2 兼容，保留原语义） ----------
async function cmdInstallUser() {
  const p = await installUserBlock(path.join(SCRIPT_DIR, 'wbx.mjs'));
  console.log(`[OK] 已注入/更新全局分派块 -> ${p}`);
  console.error('生效范围：所有项目的 ZCode 会话（用户级 AGENTS.md）。移除：node wbx.mjs uninstall-user');
  console.error('提示：要完整全局形态（用户级 skill + /wbx 命令 + ~/.wbx 运行时），用 wbx self-install');
  await exitWith(0);
}

async function cmdUninstallUser() {
  const r = await uninstallUserBlock();
  console.log(r.removed
    ? (r.fileDeleted ? `[OK] 已移除全局分派块；文件已空，连同 ${USER_AGENTS_PATH} 一起删除` : `[OK] 已移除全局分派块（保留 ${USER_AGENTS_PATH} 其余内容）`)
    : `[OK] 无需移除（${r.reason === 'file-missing' ? `${USER_AGENTS_PATH} 不存在` : '没有 wbx 标记块'}）`);
  await exitWith(0);
}

// ---------- 子命令：self-install / self-uninstall ----------
async function cmdSelfInstall(opts) {
  try {
    const r = await selfInstall({ adopt: !!opts.adopt, keepProject: !opts.noKeepProject });
    console.log(`[OK] 全局安装完成（v${WBX_VERSION}）：`);
    for (const line of r.report) console.log(`  - ${line}`);
    console.error(`\n入口：node "${r.script}"`);
    console.error('任何项目的 ZCode 会话现在都能主动分派；/wbx <任务描述> 一键触发。');
    console.error('本项目桥后续也使用 ~/.wbx/ 全局运行时（凭证共享）。卸载：node wbx.mjs self-uninstall [--purge]');
    await exitWith(0);
  } catch (e) {
    die(e.message);
  }
}

async function cmdSelfUninstall(opts) {
  const r = await selfUninstall({ purge: !!opts.purge });
  console.log('[OK] 全局卸载完成：');
  for (const line of r.report) console.log(`  - ${line}`);
  await exitWith(0);
}

// ---------- 子命令：export-bundle ----------
async function cmdExportBundle(opts) {
  try {
    const r = await exportBundle({ out: opts.out || null });
    console.log(`[OK] 分发包已生成：${r.outFile}（${(r.size / 1024).toFixed(1)} KB，${r.count} 个文件）`);
    console.error(`自检：${r.selfCheck}`);
    console.error('包含：' + r.entries.join('、'));
    console.error('接收方按包内 INSTALL-README.md 三步安装（解压 -> node wbx.mjs self-install -> login 各一次）。');
    await exitWith(0);
  } catch (e) {
    die(e.message);
  }
}

// ---------- 子命令：ui ----------
async function cmdUi(opts) {
  const { startUiServer } = await import('./wbx-ui.mjs');
  await startUiServer({ port: opts.port ?? 7788, open: !opts.noOpen });
  // startUiServer 自己 keep-alive；此处不 exit
}

// ---------- 参数解析与入口 ----------
function parseArgs(argv) {
  const opts = { _: [] };
  const next = (i) => {
    if (i + 1 >= argv.length) die(`参数 ${argv[i]} 缺少取值`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--file': opts.file = next(i); i++; break;
      case '--text': case '-p': opts.prompt = next(i); i++; break;
      case '--model': case '-m': opts.model = next(i); i++; break;
      case '--effort': opts.effort = next(i); i++; break;
      case '--as': opts.as = next(i); i++; break;
      case '--lanes': opts.lanes = next(i); i++; break;
      case '--parallel': case '--lane-parallel': opts.parallel = parseInt(next(i), 10); i++; break;
      case '--timeout': opts.timeout = parseInt(next(i), 10); i++; break;
      case '--retry': opts.retry = parseInt(next(i), 10); i++; break;
      case '--wait': opts.wait = parseInt(next(i), 10); i++; break;
      case '--probe': opts.probe = next(i); i++; break;
      case '--identity': opts.identity = next(i); i++; break;
      case '--last': opts.last = parseInt(next(i), 10); i++; break;
      case '--task': opts.task = next(i); i++; break;
      case '--port': opts.port = parseInt(next(i), 10); i++; break;
      case '--out': opts.out = next(i); i++; break;
      case '--json': opts.json = true; break;
      case '--stdin': opts.stdin = true; break;
      case '--no-open': opts.noOpen = true; break;
      case '--no-probe': opts.noProbe = true; break;
      case '--force': opts.force = true; break;
      case '--adopt': opts.adopt = true; break;
      case '--no-keep-project': opts.noKeepProject = true; break;
      case '--purge': opts.purge = true; break;
      case '--version': case '-v': opts.version = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (a.startsWith('--')) die(`未知参数 ${a}（--help 查看用法）`);
        opts._.push(a);
    }
  }
  return opts;
}

const HELP = `wbx — ZCode <-> 外部算力联动桥（v${WBX_VERSION} 三 lane：WorkBuddy 双 lane + 可选 Cline CLI）

lane：ai = 国际版 WorkBuddy AI（deepseek-v4.1-flash x0.00 免费）
      cn = 国内版 WorkBuddy（x0.03 近免费）
      cline = Cline CLI（可选第三 lane：免费额度轮换模型组，--thinking xhigh --compaction off）
默认路由：config default-lane（auto=ai 免费优先，cline 永远排最后）；失败/限流自动跨 lane 回退
（ai→cn→cline 各一次）；cline 未装/未登录直接跳过，不影响其余功能。
运行时根：WBX_HOME env -> ~/.wbx/（装过 self-install 即全局形态） -> 项目 .wbx/
cline 隔离：桥的 cline 状态只在 <运行时根>/cline/（--data-dir），绝不读写用户 ~/.cline。

用法：
  node wbx.mjs doctor  [--no-probe]                 自检向导：node/CLI 探测/模板/两 lane 凭证+模型探测 + cline 可选段
  node wbx.mjs login   [--identity cn|ai|cline] [...] 登录引导（默认 cn 微信扫码；ai 有 state 修补锦囊；
                     cline 为 OAuth 设备授权，浏览器完成）
                     [--wait 300] [--no-open] [--force]
  node wbx.mjs ask     --file t.txt | --text "..."  单次调用（落盘为 job）；stdout=结果，stderr=用量/lane
                     [--as ai|cn|cline] [--model M] [--effort low] [--timeout 300] [--json] [--stdin]
  node wbx.mjs fanout  --file tasks.json            并发池批量执行；任务可用 files:[路径] 拼材料；结果写 <运行时根>/jobs/<jobId>/
                     [--lanes ai,cn,cline] [--parallel 2] [--timeout 300] [--retry 1]
  node wbx.mjs models  [--as cn|ai|cline] [--probe "m1,m2"]   探测模型可用性并列出产品配置中的模型
  node wbx.mjs config  list | get <key> | set <key> <value>
                                                   配置：default-lane=auto|ai|cn|cline、disabled-lanes=["cn"]、
                                                   parallel-per-lane、model、cli-path、cline-path/data-dir/provider/
                                                   model/thinking/compaction、cline-parallel（存 <运行时根>/config.json）
  node wbx.mjs history [--last 10]                 历史列表（时间/类型/任务数/成功率/lane 分布/目录）
  node wbx.mjs history <jobId> [--task <id>]       完整回放一次 job 的双向对话（prompt+回复全文）
  node wbx.mjs ui      [--port 7788] [--no-open]   本地 Web UI（仅 127.0.0.1；状态/路由/ask/fanout/历史/登录）
  node wbx.mjs self-install [--adopt] [--no-keep-project]
                                                   全局安装：~/.zcode/wbx-bridge + 用户级 skill + /wbx 命令
                                                   + AGENTS.md 标记块 + ~/.wbx 运行时（--adopt 迁移项目凭证）
  node wbx.mjs self-uninstall [--purge]            全局卸载（--purge 连 ~/.wbx/ 凭证一起删，默认保留）
  node wbx.mjs export-bundle [--out <dir|.zip>]    生成分发 zip（零凭证自检；含 INSTALL-README.md）
  node wbx.mjs install-user | uninstall-user       向 ~/.zcode/AGENTS.md 注入/移除全局分派标记块（v2 兼容）

tasks.json 格式：[{"id":"t1","prompt":"...","as?":"ai|cn|cline","model?":"...","effort?":"low","file?":"p.txt","files?":["a.js"]}]

环境变量（均可选）：WBX_HOME（运行时根）、WBX_CLI、WBX_CLINE（cline 二进制）、WBX_MODEL、
WBX_PROJECT_ROOT、WBX_PRODUCT_CONFIG（login 模板）`;

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.version) { console.log(`wbx v${WBX_VERSION}`); await exitWith(0); }
  const cmd = opts._[0];
  if (opts.help || !cmd) { console.error(HELP); await exitWith(cmd ? 0 : 1); }
  migrateIfNeeded();
  switch (cmd) {
    case 'doctor': return cmdDoctor(opts);
    case 'login': return cmdLogin(opts);
    case 'ask': return cmdAsk(opts);
    case 'fanout': return cmdFanout(opts);
    case 'models': return cmdModels(opts);
    case 'config': return cmdConfig(opts);
    case 'history': return cmdHistory(opts);
    case 'install-user': return cmdInstallUser();
    case 'uninstall-user': return cmdUninstallUser();
    case 'self-install': return cmdSelfInstall(opts);
    case 'self-uninstall': return cmdSelfUninstall(opts);
    case 'export-bundle': return cmdExportBundle(opts);
    case 'ui': return cmdUi(opts);
    default: die(`未知子命令 ${cmd}（--help 查看用法）`);
  }
}

main().catch(async (e) => { console.error('[FAIL] ' + redact(e && e.stack || e)); const { waitKills } = await import('./wbx-core.mjs'); await waitKills(); process.exit(1); });
