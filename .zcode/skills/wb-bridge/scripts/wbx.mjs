#!/usr/bin/env node
/**
 * wbx — ZCode ↔ 外部算力联动桥 CLI（薄壳：参数解析 + 输出格式化）
 *
 * 可复用逻辑在 ./wbx-core.mjs，安装/打包在 ./wbx-setup.mjs，Web UI 在 ./wbx-ui.mjs。
 * 子命令、旗标、退出码的权威清单=本文件 COMMANDS/FLAGS 表与 --help（由表生成，不另维护平行清单）。
 *
 * 五 lane：codex = Codex CLI（ChatGPT Plus 质量优先档：单发 ask 默认优先，额度耗尽自动冷却让位）；
 * ai = 国际版（deepseek-v4.1-flash x0.00 免费）；cn = 国内版（x0.03 近免费）；
 * cline = Cline CLI（默认免费孪生 cline-free/deepseek-v4.1-flash，限时轮换+每日配额）；
 * doubao = 豆包桌面端（会员额度；回退链最末）+ 手工直通双入口并存。
 * 默认路由三分：单发 auto=codex 就绪即优先、否则 ai 免费优先；fanout 批量缺省免费池（codex 点名才投）；
 * 失败/限流自动回退下一 lane（各一次，付费两档排后）。
 *
 * 约束：绝不写 ~/.workbuddy、~/.workbuddy-ai；凭证只存 <git 根>/.wbx/（已 gitignore），
 * 绝不打印其内容。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME_ROOT, JOBS_DIR, HOME, CODEX_HOME } from './wbx-paths.mjs';
import {
  WBX_VERSION,
  IDENTITIES, LANE_ORDER, STDIN_THRESHOLD, CONFIG_DEFS,
  UI_DEFAULT_PORT,
  clineReady, clineProvidersFile, clineHomeDir, runClineAuth,
  die, DieSignal, redact, brief, fmtMs,
  ensureDirs, readStdin,
  loadConfig, setConfig,
  resolveDefaultLane, parseLane, laneReady, resolveDoubaoDir,
  askOnce, resolveModel, fetchClineFreeModels, laneBalance,
  runAskJob, runFanoutJob, runClean,
  listJobs, getJob,
  startLogin, pollLoginToken, fetchAccountInfo, persistLogin,
  doctorStatus,
  openBrowser, exitWith,
} from './wbx-core.mjs';
import { selfInstall, selfUninstall, exportBundle } from './wbx-setup.mjs';

// ---------- 子命令：doctor ----------
async function cmdDoctor(opts) {
  const r = await doctorStatus({ probe: !opts.noProbe && !opts.quick, quick: !!opts.quick, onLine: (m) => console.error(m) });
  const ready = r.readyLanes;
  const failed = r.lanes.filter((l) => l.probe && !l.probe.good);
  if (ready.length && failed.length && r.lanes.some((x) => x.probe?.good)) {
    console.error(`[WARN] ${failed.length} 个 lane 探测失败，但仍有可用 lane（${ready.join(',')}）`);
  }
  console.error('');
  console.error(r.ok ? `[OK] doctor 通过（运行时 ${r.runtimeRoot}，版本 v${r.version}）`
    : `[FAIL] doctor 未通过（exit 1；按上面每行的修复指引处理）`);
  await exitWith(r.ok ? 0 : 1);
}

// ---------- 子命令：login ----------
// --identity/--as 共用的 lane 实参解析（非法值统一报错文案）
function parseLaneArg(v, flag) {
  const k = parseLane(v);
  if (!k) die(`--${flag} 只支持 ${LANE_ORDER.join(' | ')}（收到 ${v}）`);
  return k;
}

async function cmdLogin(opts) {
  ensureDirs();
  const identity = opts.identity ? (() => {
    const k = parseLaneArg(opts.identity, 'identity');
    // 豆包无登录流程——登录态在客户端 GUI 内自理，拦下防误落 cn
    if (k === 'doubao') die('豆包无「登录豆包」流程：登录态由你在豆包桌面客户端内自理，桥侧零凭证。检查就绪态：wbx doubao status（或先跑 doubao/launch.ps1 以调试口 9225 拉起）');
    return k;
  })() : 'cn';

  // codex lane：凭证收割（D-037）——一次性只读复制 ~/.codex/auth.json -> <运行时根>/codex-home/。
  // 授权边界（用户 2026-10-14 裁决 2）：auth.json 是「不动桌面版文件」红线的唯一显式授权例外
  //（单文件、只读、一次、复制进 gitignore 运行时）；绝不回写/展示/入库；除它外 ~/.codex 零读取。
  if (identity === 'codex') {
    const src = path.join(HOME, '.codex', 'auth.json');
    const dst = path.join(CODEX_HOME, 'auth.json');
    if (fs.existsSync(dst) && !opts.force) {
      console.log(`[OK] lane codex 已收割凭证（${dst} 存在）。加 --force 重新收割（Codex 侧令牌刷新失联时用）`);
      return;
    }
    if (!fs.existsSync(src)) {
      die(`未找到 ${src}——请先在 Codex 桌面版或 codex CLI 登录 ChatGPT 账号（codex login），再回来收割`);
    }
    try {
      fs.mkdirSync(CODEX_HOME, { recursive: true });
      fs.copyFileSync(src, dst);   // 一次性只读复制（源零改动，内容绝不展示）
    } catch (e) {
      die(`凭证复制失败：${e.message}`);
    }
    if (!fs.existsSync(dst)) die('凭证复制后校验失败（目标未落盘）');
    console.error(`[1/1] 完成：已一次性只读复制 ~/.codex/auth.json -> ${dst}（源未改动；隔离 CODEX_HOME，绝不回写）`);
    console.error('验证：node wbx.mjs doctor（lane codex 段应显示已登录）。额度耗尽自动冷却让位；Codex 侧令牌刷新导致失联时重跑本命令 --force');
    await exitWith(0);
    return;
  }

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
        console.error('验证：node wbx.mjs doctor（lane cline 段应全绿）。默认模型为免费孪生 cline-free/deepseek-v4.1-flash；查当前免费组：wbx models --as cline --free（免费组限时轮换，被轮换下线时 doctor 会提示）');
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
  const uin = account ? String(account.uin || '') : '';
  const who = account ? `${account.nickname || ''}（uin ${uin.slice(0, 2)}***${uin.slice(-2)}）`.trim() : '（账号信息未获取，不影响使用）';
  console.error(`[5/5] 完成：lane ${identity}（${id.label}），${who}`);
  console.error(`凭证仅存于运行时根（${RUNTIME_ROOT}，已 gitignore，请勿外传）。验证：node wbx.mjs doctor`);
}

// ---------- 子命令：ask ----------
// 失败 hint 的人类可读提示（含免费档超额/轮换状态机文案）
function hintText(r) {
  const h = r && r.hint;
  if (h === 'login') return '（未登录/凭证过期 -> wbx login）';
  if (h === 'ratelimit') return '（疑似限流/配额 -> 降低并发或稍后再试）';
  if (h === 'codex-quota') return '（ChatGPT Plus 额度耗尽 -> 已进入冷却让位，auto 路由/回退自动跳过 codex；稍后再试或显式改投免费 lane）';
  if (h === 'codex-model-floor') return '（codex-model 底线护栏：仅放行 gpt-6 及以上主版本 -> wbx config set codex-model gpt-6.1-sol）';
  if (h === 'free-limit') return `（cline 免费额度今日已达上限${r.resetIn ? `，约 ${r.resetIn} 后重置` : ''} -> 稍后再试 / wbx models --as cline --free 换免费模型；跨 lane 已自动回退 ai/cn 仍是 DeepSeek）`;
  if (h === 'free-promotion-ended') return '（该免费模型促销已结束/被轮换下线 -> wbx models --as cline --free 查当前免费清单后 config set cline-model）';
  if (h === 'model-not-found') return '（模型 id 不存在或已被轮换下线 -> wbx models --as cline --free 查当前免费清单后 config set cline-model）';
  return '';
}

async function cmdAsk(opts) {
  let prompt = null;
  if (opts.file) {
    try { prompt = await fsp.readFile(path.resolve(opts.file), 'utf8'); }
    catch (e) { die(`读取 --file 失败：${e.message}`); }
  }
  else if (opts.prompt != null) prompt = opts.prompt;
  else if (opts.stdin) prompt = await readStdin();
  if (!prompt || !prompt.trim()) die('缺少提示词：用 --file <path>、--text "<prompt>" 或 --stdin 提供');

  if (prompt.length > STDIN_THRESHOLD) {
    console.error(`[INFO] 提示词 ${prompt.length} 字符：超 12k 自动改走 stdin 通道（v4，无命令行长度限制）；材料过长会增加耗时与费用，建议按需裁剪`);
  }

  try {
    const r = await runAskJob({
      prompt,
      as: opts.as || null,
      model: opts.model || null,
      effort: opts.effort || null,
      timeoutS: opts.timeout ?? null,   // 缺省交由 core 超时单点决策（∅=300s / 能力任务=600s；显式值最高优先）
      caps: opts.caps || null,
      maxTurns: opts.maxTurns ?? null,
      ephemeral: !!opts.ephemeral,
    });
    const jobNote = r.jobDir ? `[job] 记录 -> ${r.jobDir}` : '[job] --ephemeral：真实执行零落盘（不入历史）';
    if (r.ok) {
      console.error(`[OK] lane=${r.lane} model=${r.model} 耗时=${fmtMs(r.durationMs)}${r.caps && r.caps !== 'L0' ? ` caps=${r.caps}` : ''}`);
      if (r.fallbackFrom) console.error(`[FALLBACK] 主 lane ${r.fallbackFrom} 失败，已改投 lane ${r.lane}`);
      if (r.clineModelHealed) console.error(`[HEAL] cline 模型自愈：${r.clineModelHealed.from} -> ${r.clineModelHealed.to}（已写回 config，链内重投成功）`);
      if (r.toolTrace && Object.keys(r.toolTrace.counts).length) console.error(`[TRACE] 工具轨迹：${Object.entries(r.toolTrace.counts).map(([k, v]) => `${k}×${v}`).join('、')}`);
      console.error(jobNote);
      if (opts.json) console.log(JSON.stringify({ jobId: r.jobId, lane: r.lane, model: r.model, caps: r.caps || 'L0', durationMs: r.durationMs, result: r.text }, null, 2));
      else console.log(r.text);
      await exitWith(0);
    }
    console.error(`[FAIL] 全部尝试 lane 均失败；最后错误 kind=${r.kind}${hintText(r)}`);
    console.error(r.error || '(无错误详情)');
    console.error(jobNote);
    await exitWith(1);
  } catch (e) {
    die(e.message);
  }
}

// ---------- 子命令：fanout ----------
async function cmdFanout(opts) {
  if (!opts.file) die('用法：wbx fanout --file tasks.json（--help 查看任务字段）');
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
    // files 字段（v4）：默认 inline 材料拼进提示词（字节兼容）；filesMode:"reference"（v6.8）时只
    // 验证存在并把 {rel,abs} 交 core 播种进 L1 scratch——提示词只给清单+相对路径，worker Read 自读
    if (t.filesMode != null && t.filesMode !== 'inline' && t.filesMode !== 'reference') {
      die(`任务 ${i}（${t.id ?? '?'}）的 filesMode 只支持 "inline" | "reference"（收到 ${JSON.stringify(t.filesMode)}）`);
    }
    let refFiles = null;
    if (t.filesMode === 'reference' && (!Array.isArray(t.files) || !t.files.length)) {
      die(`任务 ${i}（${t.id ?? '?'}）的 filesMode:"reference" 需要非空 files 数组（材料先行；无材料请去掉 filesMode）`);
    }
    if (Array.isArray(t.files) && t.files.length) {
      if (!prompt) die(`任务 ${i}（${t.id ?? '?'}）的 files 必须与 prompt 或 file 搭配（files 只追加材料）`);
      if (t.filesMode === 'reference') {
        refFiles = [];
        for (const f of t.files) {
          if (typeof f !== 'string') die(`任务 ${i}（${t.id ?? '?'}）的 files 数组元素必须是字符串`);
          const abs = path.resolve(path.dirname(tasksPath), f);
          if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) die(`任务 ${i}（${t.id ?? '?'}）的 files[${f}] 不存在或不是文件（reference 模式要求材料先行就位）`);
          refFiles.push({ rel: f, abs });
        }
      } else {
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
    }
    const taskOut = { id: t.id, prompt, as: t.as ?? null, model: t.model ?? null, effort: t.effort ?? null, caps: t.caps ?? null, maxTurns: t.maxTurns ?? null };
    if (refFiles) {
      // reference 材料区：只给清单+相对路径+读取指引（worker 在 L1 scratch 工作目录内自读）
      const listing = refFiles.map((f) => `- ${String(f.rel).replace(/\\/g, '/')}`).join('\n');
      taskOut.prompt = `${prompt}\n\n【输入材料·文件清单】\n以下材料文件已放置在你的工作目录中（相对路径，保持目录结构），请用 Read 工具按路径自行读取后再作答：\n${listing}\n`;
      taskOut.filesMode = 'reference';
      taskOut.files = refFiles;
    }
    tasksIn.push(taskOut);
  }

  let lanes = null;
  if (opts.lanes) {
    lanes = opts.lanes.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const k of lanes) if (!LANE_ORDER.includes(k)) die(`--lanes 只支持 ${LANE_ORDER.join(',')} 的组合（收到 "${k}"）`);
    if (!lanes.length) die('--lanes 不能为空');
  }

  try {
    const r = await runFanoutJob({
      tasksIn,
      lanes,
      parallel: opts.parallel ?? null,
      timeoutS: opts.timeout ?? null,   // 缺省交由 core 超时单点决策（∅=300s / 能力任务=600s；显式值最高优先）
      retry: opts.retry ?? null,
      ephemeral: !!opts.ephemeral,
      log: (m) => console.error(`[fanout] ${m}`),
    });
    const rlCount = r.results.filter((x) => /rate.?limit|429|quota|限流/i.test(String(x.error || ''))).length;
    if (r.jobDir) {
      console.error(`\n[fanout] 完成：成功 ${r.okCount}/${r.total}，总耗时见 summary，job=${r.jobId}`);
      console.log(r.jobDir); // stdout 输出结果目录，便于脚本衔接
    } else {
      // --ephemeral：零落盘 → 结果以 JSON 走 stdout（任务正文含在内），脚本衔接改读 stdout
      console.error(`\n[fanout] 完成：成功 ${r.okCount}/${r.total}（--ephemeral：真实执行零落盘，不入历史）`);
      console.log(JSON.stringify({ ephemeral: true, okCount: r.okCount, total: r.total, results: r.results.map(({ id, lane, fallbackFrom, status, durationMs, model, error, result }) => ({ id, lane, ...(fallbackFrom ? { fallbackFrom } : {}), status, durationMs, model, ...(error ? { error } : {}), ...(result != null ? { result } : {}) })) }, null, 2));
    }
    if (rlCount) console.error(`[fanout] ⚠️ ${rlCount} 个疑似限流失败 -> 建议降并发重跑`);
    await exitWith(r.okCount === r.total ? 0 : 1);
  } catch (e) {
    die(e.message);
  }
}

// ---------- 子命令：usage（余额可见：lane×余额表 + 数据源档位注记） ----------
// 数据源级联门（RESEARCH-V16 §二定案）：ai/cn 走社区 billing 端点（stability=community，非官方）；
// cline（免费孪生官方无端点）/doubao（会员额度无 API）如实显示 na；unavailable 诚实兜底+官方指路。
// 退出方式：自然排空（process.exitCode + return，不走 exitWith）——本命令是唯一的
// 「fetch 可能 abort 后立即 process.exit」路径，那会在 Windows 上触发 libuv 断言崩溃
// （aborted undici 请求销毁中撞上 exit；实测复现，internal/archive/v16/v16-exec-log.md）。
async function cmdUsage(opts) {
  ensureDirs();
  const rows = await Promise.all(LANE_ORDER.map(async (k) => ({ lane: k, bal: await laneBalance(k, { force: !!opts.force }) })));
  if (opts.json) {
    console.log(JSON.stringify(Object.fromEntries(rows.map((r) => [r.lane, r.bal])), null, 2));
    process.exitCode = 0;
    return;
  }
  const w = { lane: 10, bal: 40 };
  console.log('lane'.padEnd(w.lane) + '余额'.padEnd(w.bal) + '数据源');
  for (const { lane, bal } of rows) {
    let balTxt, srcTxt;
    if (bal.state === 'ok') {
      balTxt = `${bal.remain} / ${bal.total} ${bal.unit || 'credits'}（剩余/总量，${bal.packages ?? '?'} 个套餐）`;
      srcTxt = `非官方端点 · ${bal.asOf ? String(bal.asOf).replace('T', ' ').slice(0, 19) : '?'}`;
    } else if (bal.state === 'na') {
      balTxt = '—';
      srcTxt = bal.hint || '无余额端点';
    } else {
      balTxt = `—（${bal.hint || '不可用'}）`;
      srcTxt = '暂无稳定查询端点（官方未提供）；请到官方控制台查看';
    }
    console.log(lane.padEnd(w.lane) + balTxt.padEnd(w.bal) + srcTxt);
  }
  console.error('\n说明：WorkBuddy 双 lane 余额取自社区 billing 端点（非官方，可能随上游改版失效）；结果带 TTL 缓存（--force 跳过）。cline 免费额度与豆包会员额度均无查询 API。');
  process.exitCode = 0;
}

// ---------- 子命令：models ----------
async function readProductConfigModels(laneKey) {
  const id = IDENTITIES[laneKey] || IDENTITIES[resolveDefaultLane()];
  const other = IDENTITIES[id.key === 'ai' ? 'cn' : 'ai'];
  const homeOf = (k) => `~/.workbuddy${k === 'ai' ? '-ai' : ''}`;
  const candidates = [
    { p: id.productPath, label: `product/${id.key}.json（custom-token 注入，lane ${id.key}）` },
    { p: id.templatePath, label: `${homeOf(id.key)}/cache/（${id.label}运行时缓存，只读）` },
    { p: other.templatePath, label: `${homeOf(other.key)}/cache/（${other.label}缓存，只读）` },
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
  const lane = opts.as ? (() => {
    const k = parseLaneArg(opts.as, 'as');
    // doubao 无模型清单概念（工具自管理豆包 2.1 Pro + 推理高），模型探测不适用
    if (k === 'doubao') die('doubao lane 无模型探测：模型由豆包桌面端工具自管理（豆包 2.1 Pro · 推理高，ask 每次自动重验）。检查就绪态：wbx doubao status');
    return k;
  })() : resolveDefaultLane();
  if (lane === 'cline') {
    const cfg = loadConfig();
    console.error(`lane = cline（provider=${cfg['cline-provider']}，thinking=${cfg['cline-thinking']}，compaction=${cfg['cline-compaction']}）`);

    // --free：列当前免费模型组（recommended-models 端点实时；失败降级缓存，再失败明确报错）
    if (opts.free) {
      const fm = await fetchClineFreeModels();
      if (!fm.ok) die(`免费清单获取失败：${fm.error}`);
      const cur = cfg['cline-model'] || '';
      console.error(`cline 当前免费模型组（${fm.models.length} 个；来源：${fm.source === 'cache' ? `缓存 ${fm.fetchedAt}（端点失败降级）` : 'recommended-models 端点实时'}）：`);
      for (const m of fm.models) {
        const mark = m.id === cur ? '*' : ' ';
        const deepseek = /deepseek/i.test(m.id);
        console.log(`  ${mark} ${m.id}${m.name ? `（${m.name}）` : ''}${deepseek ? '' : '  [非 DeepSeek]'}${m.description ? '  # ' + m.description : ''}`);
      }
      console.error(`\n切换：wbx config set cline-model "<id>"（标 * 为当前值）。免费组为限时轮换+每日配额；`);
      console.error('约束：桥的自动回退绝不切换到非 DeepSeek 模型（用户手动选择不受限，UI/命令均可选）。');
      await exitWith(0);
      return;
    }

    const list = (opts.probe ? opts.probe.split(',').map((s) => s.trim()).filter(Boolean) : [opts.model || cfg['cline-model'] || '']).filter(Boolean);   // --model 显式优先（v23 评审 P2）
    if (!list.length) console.log('（cline-model 为空=provider 默认模型；要探测候选 id 用 --probe "id1,id2"；查当前免费组用 --free）');
    let allOk = true;
    for (const m of list) {
      process.stdout.write(`探测 ${m} … `);
      const r = await askOnce({ lane: 'cline', model: m, prompt: '请只回复 OK', timeoutMs: 180000 });
      if (r.ok) console.log(`可用（${fmtMs(r.durationMs)}）`);
      else { allOk = false; console.log(`不可用（${r.kind}: ${brief(r.error, 160)}）`); }
    }
    await exitWith(allOk ? 0 : 1);
    return;
  }
  // codex 无模型探测：模型经 config codex-model 管理（护栏单点）；逐个探测会真实消耗 Plus
  // 额度（每次 tiny ask 一发），与 doctor 同策略不做（D-002 同类）。可用值清单在 doctor/桌面版。
  if (lane === 'codex') {
    die('codex lane 无模型探测：模型经 config codex-model 管理（默认 gpt-6.1-sol，≥GPT-6 底线护栏——wbx config set codex-model <gpt-6+>；探测会真实消耗 Plus 额度故不做）。检查就绪态：wbx doctor');
  }
  console.error(`lane = ${lane}（${IDENTITIES[lane].label}）`);
  const list = (opts.probe ? opts.probe.split(',').map((s) => s.trim()).filter(Boolean) : [opts.model || resolveModel()]);   // --model 直通（此前分支忽略 --model，v23 评审 P2）
  let allOk = true;
  for (const m of list) {
    process.stdout.write(`探测 ${m} … `);
    const r = await askOnce({ lane, prompt: '请只回复：OK', model: m, effort: 'low', timeoutMs: 120000 });
    if (r.ok) console.log(`可用（${fmtMs(r.durationMs)}）`);
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
      console.log(`（没有历史 job：${JOBS_DIR} 为空）`);
      await exitWith(0);
    }
    const w = { time: 20, type: 8, total: 6, rate: 8, lanes: 16 };
    console.log(['时间'.padEnd(w.time), '类型'.padEnd(w.type), '任务数'.padEnd(w.total), '成功率'.padEnd(w.rate), 'lane 分布'.padEnd(w.lanes), '目录'].join(''));
    for (const j of jobs) {
      const t = j.createdAt ? new Date(j.createdAt).toLocaleString('zh-CN', { hour12: false }) : j.id;
      console.log([
        String(t).padEnd(w.time),
        j.type.padEnd(w.type),
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
  if (!job) die(`找不到 job ${arg}（在 ${JOBS_DIR} 中无）`);
  const tasks = opts.task ? job.tasks.filter((t) => t.id === opts.task) : job.tasks;
  if (opts.task && !tasks.length) die(`job ${arg} 中没有任务 ${opts.task}（可用：${job.tasks.map((t) => t.id).join(', ')}）`);
  console.error(`job ${job.id}  类型=${job.type}  状态=${job.status}  目录=${job.dir}`);
  console.error(`任务数=${job.total ?? '?'}  成功率=${job.successRate == null ? '?' : job.successRate + '%'}  lane 分布=${fmtLaneDist(job.laneDist)}${job.durationMs != null ? `  总耗时=${fmtMs(job.durationMs)}` : ''}\n`);
  for (const t of tasks) {
    const r = t.record;
    const lane = r ? (r.fallbackFrom ? `${r.fallbackFrom}→${r.lane}` : r.lane) : '（无记录）';
    const head = r
      ? `${r.status === 'success' ? '✅' : '❌'} ${r.status} · lane=${lane} · ${fmtMs(r.durationMs ?? 0)} · 尝试 ${r.attempts}`
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

// ---------- 子命令：clean（v28B 产物回收：缺省干跑报告零删，--apply 才实删） ----------
async function cmdClean(opts) {
  try {
    await runClean({
      apply: !!opts.apply,
      force: !!opts.force,   // 仅免确认（≠--apply）：TTY 下 --apply 未加 --force 会要求确认
      jobsDays: opts.jobs ?? null,
      scratchHours: opts.scratch ?? null,
      laneCache: !!opts.laneCache,
    });
    await exitWith(0);
  } catch (e) {
    die(e.message);
  }
}

// ---------- 子命令：self-install / self-uninstall ----------
async function cmdSelfInstall() {
  try {
    const r = await selfInstall();
    console.log(`[OK] 安装完成（v${WBX_VERSION}）：`);
    for (const line of r.report) console.log(`  - ${line}`);
    console.error(`\n入口：node "${r.script}"（唯一技能目录 ~/.zcode/skills/wb-bridge/，.wbx-install.json 版本自证）`);
    console.error('运行时随项目走：任何项目内 cwd 即得 <git 根>/.wbx（新项目零配置即用）。卸载：node wbx.mjs self-uninstall');
    await exitWith(0);
  } catch (e) {
    die(e.message);
  }
}

async function cmdSelfUninstall() {
  const r = await selfUninstall();
  console.log('[OK] 卸载完成：');
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

// ---------- 子命令：ui（守护化；每项目独立状态与日志） ----------
async function cmdUi(opts) {
  const daemon = await import('./wbx-daemon.mjs');
  if (opts.stop) {
    const r = await daemon.stopUi({ port: opts.port ?? UI_DEFAULT_PORT });   // 自定端口的无状态实例也能探测到
    console.log(`${r.ok ? '[OK] ' : '[FAIL] '}${r.message}`);
    await exitWith(r.ok ? 0 : 1);
  }
  if (opts.status) {
    const s = await daemon.statusUi();
    if (opts.json) console.log(JSON.stringify(s, null, 2));
    else {
      console.log(`状态：${s.state === 'running' ? '运行中' : s.state === 'stale' ? '残留（可自愈）' : '未运行'}`);
      console.log(`说明：${s.message}`);
      if (s.url) console.log(`地址：${s.url}`);
      console.log(`日志：${s.log}`);
    }
    await exitWith(0);
  }
  if (opts.detach) {
    // 必须秒回且永远 exit 0（脚本化拉起路径），失败只打印/落日志。
    // 输出走 stderr：宿主按 stdout JSON 严格解析的场景保持 stdout 为空最稳。
    const r = await daemon.detachUi({ port: opts.port ?? UI_DEFAULT_PORT });
    console.error(`${r.ok ? '[OK] ' : '[FAIL] '}${r.message}`);
    await exitWith(0);
  }
  if (opts.daemon) return daemon.daemonMain({ port: opts.port ?? UI_DEFAULT_PORT }); // 内部：由 --detach spawn
  // 裸 `wbx ui`：守护进程已在跑 -> 打印 URL + 开浏览器 + exit 0；否则维持前台模式
  const probe = await daemon.probeExisting();
  if (probe.decision === 'reuse') {
    const url = `http://127.0.0.1:${probe.state.port}`;
    console.log(`[OK] wbx 控制台守护进程已在运行：${url}（pid ${probe.state.pid}，wbx ui --stop 停止）`);
    if (!opts.noOpen) openBrowser(url);
    await exitWith(0);
  }
  if (probe.decision === 'conflict') {
    console.error('[FAIL] 端口状态不一致（疑似被非本桥进程占用或 pid 复用）——处理：wbx ui --stop 清理后再试；仍失败换端口 wbx ui --port <其他端口>（netstat -ano | findstr :' + (opts.port ?? UI_DEFAULT_PORT) + '）');
    await exitWith(1);
  }
  const { startUiServer } = await import('./wbx-ui.mjs');
  await startUiServer({ port: opts.port ?? UI_DEFAULT_PORT, open: !opts.noOpen });
  // startUiServer 自己 keep-alive；此处不 exit
}

// ---------- 子命令：doubao（豆包桌面桥手工直通；可选工具） ----------
// 参数不经 parseArgs 原样转发：豆包旗标集（--cdp-url/--timeout-ms/--wait-ms/--poll-ms/--index…）
// 与 wbx 自身不同，由 doubao.mjs 自己解析并负责 usage/退出码；本函数只做目录解析 + 子进程直通。
// 不变量：直通必须无痕——任何子命令零落盘副作用，勿给豆包直通加记录逻辑（历史页语义=lane 调度记录）。
async function cmdDoubao(restArgs) {
  // 目录解析走 core 单源 resolveDoubaoDir（wbx-core 的 askOnceDoubao 同款；v22 收敛双候选复述）
  const dir = resolveDoubaoDir();
  if (!dir) {
    die(
      '未找到豆包桥 doubao.mjs（已查：全局 ~/.zcode/skills/wb-bridge/doubao/ 与仓库 tools/doubao-bridge/）。\n' +
      '安装副本：在装有本桥的源码仓里跑 wbx self-install，会把 tools/doubao-bridge/ 一并复制到 ~/.zcode/skills/wb-bridge/doubao/。\n' +
      '豆包桥是可选工具（Windows-only），缺失不影响其余 lane（ai/cn/cline）。'
    );
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(dir, 'doubao.mjs'), ...restArgs], { stdio: 'inherit' });
  child.on('error', (e) => { console.error(`[FAIL] 启动豆包桥失败：${e.message}`); exitWith(1); });
  child.on('close', (code, signal) => {
    // 只透传退出码，不重抛同名信号——非 POSIX 语义下 signal 名可能不被识别（T7-S1）
    exitWith(code ?? (signal ? 1 : 0));
  });
}

// ---------- 参数解析与入口（表驱动：FLAGS/COMMANDS 是唯一事实源，HELP 索引段由表生成） ----------
// 旗标表：name/别名/是否带值/取值类型。新增旗标只改这里（parseArgs 与 --help 旗标总表自动跟进）
const FLAGS = [
  { name: '--file', val: 'str' },
  { name: '--text', alias: ['-p'], val: 'str', key: 'prompt' },
  { name: '--model', alias: ['-m'], val: 'str' },
  { name: '--effort', val: 'str' },
  { name: '--caps', val: 'str' },
  { name: '--max-turns', val: 'int' },
  { name: '--as', val: 'str' },
  { name: '--lanes', val: 'str' },
  { name: '--parallel', alias: ['--lane-parallel'], val: 'int' },
  { name: '--timeout', val: 'int' },
  { name: '--retry', val: 'int' },
  { name: '--apply', val: 'bool' },        // v28B clean：执行删除（缺省只读干跑）
  { name: '--jobs', val: 'int' },          // v28B clean：jobs 域保留天数覆盖（缺省取 config jobs-retention-days；0=关）
  { name: '--scratch', val: 'int' },       // v28B clean：scratch 域 TTL 小时覆盖（缺省取 config scratch-ttl-hours；0=关）
  { name: '--lane-cache', val: 'bool' },   // v28B clean：lane 缓存白名单剪枝（config/{ai,cn}/{traces,logs,shell-snapshots}）
  { name: '--ephemeral', val: 'bool' },   // v23 包 A：真实执行零落盘（不建 job 不入历史；冒烟/连通性验证专用，ask/fanout）
  { name: '--wait', val: 'int' },
  { name: '--probe', val: 'str' },
  { name: '--free', val: 'bool' },
  { name: '--identity', val: 'str' },
  { name: '--last', val: 'int' },
  { name: '--task', val: 'str' },
  { name: '--port', val: 'int' },
  { name: '--detach', val: 'bool' },
  { name: '--stop', val: 'bool' },
  { name: '--status', val: 'bool' },
  { name: '--daemon', val: 'bool' },
  { name: '--out', val: 'str' },
  { name: '--json', val: 'bool' },
  { name: '--stdin', val: 'bool' },
  { name: '--no-open', val: 'bool' },
  { name: '--no-probe', val: 'bool' },
  { name: '--quick', val: 'bool' },
  { name: '--force', val: 'bool' },
  { name: '--version', alias: ['-v'], val: 'bool' },
  { name: '--help', alias: ['-h'], val: 'bool' },
];
const FLAG_LOOKUP = new Map([
  ...FLAGS.map((f) => [f.name, f]),
  ...FLAGS.flatMap((f) => (f.alias || []).map((a) => [a, f])),
]);

function parseArgs(argv) {
  const opts = { _: [] };
  const next = (i) => {
    if (i + 1 >= argv.length) die(`参数 ${argv[i]} 缺少取值`);
    const v = argv[i + 1];
    if (FLAG_LOOKUP.has(v)) die(`参数 ${argv[i]} 缺少取值（下一个 token 是旗标 ${v}；含 -- 开头的值请用 --file/--stdin）`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const f = FLAG_LOOKUP.get(a);
    if (f) {
      const key = f.key || f.name.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (f.val === 'bool') opts[key] = true;
      else if (f.val === 'int') {
        const n = parseInt(next(i), 10);
        if (!Number.isFinite(n)) die(`参数 ${f.name} 需要整数（收到 ${argv[i + 1]}）`);
        opts[key] = n; i++;
      }
      else opts[key] = next(i), i++;
      continue;
    }
    if (a.startsWith('--')) die(`未知参数 ${a}（--help 查看用法）`);
    opts._.push(a);
  }
  return opts;
}

// 命令表：子命令分发与「命令一览」索引的唯一事实源（详细用法块在下文 HELP 手写维护——语义叙述
// 不适合表化，但清单与枚举绝不平行手抄）。已知例外：doubao 在 main 内参数原样转发直通
//（fn:null）——直通必须发生在 parseArgs/迁移之前，零落盘无痕是有意设计。
const COMMANDS = [
  { name: 'doctor', fn: (o) => cmdDoctor(o), desc: '自检向导（--quick <10s 静态快检；--no-probe 免模型探测）' },
  { name: 'login', fn: (o) => cmdLogin(o), desc: '登录引导（--identity cn|ai|cline|codex）' },
  { name: 'ask', fn: (o) => cmdAsk(o), desc: '单次调用（stdout=结果，失败自动跨 lane 回退；--ephemeral 真实执行零落盘）' },
  { name: 'fanout', fn: (o) => cmdFanout(o), desc: '并发池批量执行（结果落 <运行时根>/jobs/<jobId>/；--ephemeral 零落盘出 stdout）' },
  { name: 'models', fn: (o) => cmdModels(o), desc: '探测模型可用性 + 产品配置模型列表（--as cline --free 免费组）' },
  { name: 'usage', fn: (o) => cmdUsage(o), desc: '各 lane 余额（社区端点显式标非官方，诚实降级）' },
  { name: 'config', fn: (o) => cmdConfig(o), desc: 'list | get <key> | set <key> <value>（存 config.json）' },
  { name: 'history', fn: (o) => cmdHistory(o), desc: '历史列表 / 完整回放双向对话' },
  { name: 'clean', fn: (o) => cmdClean(o), desc: '产物回收（缺省干跑报告零删；--apply 实删；--jobs/--scratch/--lane-cache 分域；--force 免确认）' },
  { name: 'self-install', fn: () => cmdSelfInstall(), desc: '安装（复制技能目录到 ~/.zcode/skills/wb-bridge + 一次性清扫旧形态痕迹；不写 AGENTS/钩子/全局运行时）' },
  { name: 'self-uninstall', fn: () => cmdSelfUninstall(), desc: '卸载（删技能目录+停守护+清扫；各项目 .wbx/ 含凭证保留）' },
  { name: 'export-bundle', fn: (o) => cmdExportBundle(o), desc: '分发打包（零凭证 zip + 自检；默认落 <git 根>/.wbx/export/）' },
  { name: 'ui', fn: (o) => cmdUi(o), desc: '本地 Web UI（--detach 守护 / --stop / --status；每项目独立，被占可 --port 换端口）' },
  { name: 'doubao', fn: null, desc: '豆包桌面桥手工直通（参数原样转发 doubao.mjs，零落盘旁路）' },
];

const HELP = `wbx — ZCode <-> 外部算力联动桥（v${WBX_VERSION} 五 lane：Codex CLI + WorkBuddy 双 lane + 可选 Cline CLI + 可选豆包桌面端）

lane：codex = Codex CLI（可选第五 lane·ChatGPT Plus 质量优先档：单发 ask 默认优先——编码/规划综合
              能力强；模型 gpt-6.1-sol（≥GPT-6 底线护栏，config codex-model）；任务级 --model 不生效、
              --effort low|medium|high 直通推理档；Plus 额度 5h 滚动窗口+周上限，耗尽自动冷却让位）
      ai = 国际版 WorkBuddy AI（deepseek-v4.1-flash x0.00 免费）
      cn = 国内版 WorkBuddy（x0.03 近免费）
      cline = Cline CLI（可选第三 lane：默认免费调 DeepSeek——cline-free/deepseek-v4.1-flash 孪生，
              限时轮换+每日配额，--thinking xhigh --compaction off；清单：models --as cline --free）
      doubao = 豆包桌面端（可选第四 lane，耗会员额度；工作任务模式 CDP 驱动，模型由工具自管理
              豆包 2.1 Pro · 推理高；任务级 --model/--effort 对 doubao 不生效）
默认路由三分（v21）：单发 ask auto=codex 就绪即质量档优先，否则 ai 免费优先；fanout 批量缺省=免费
池 ai/cn/cline/doubao（codex 不进缺省池——Plus 额度保护，任务级 "as":"codex" 点名才投）；回退链
cn→ai→cline→codex→doubao 各一次（免费 lane 失败不自动烧 Plus/会员额度，付费两档排后）。
失败/限流自动跨 lane 回退（仍是 DeepSeek；cline 内部绝不换非 DeepSeek 模型顶替）；cline 未装/未登录
直接跳过；doubao 调试口不在线时 ask 秒退失败自然跳过；codex 额度冷却期 laneReady=false 自动跳过。
运行时根：WBX_HOME env（测试注入） -> <git 根>/.wbx（从 cwd 向上找 .git，无则 cwd 兜底）——每项目独立。
cline 隔离：桥的 cline 状态只在 <运行时根>/cline-home/（HOME 覆盖），绝不读写用户 ~/.cline。
codex 隔离：CODEX_HOME=<运行时根>/codex-home（--ignore-user-config 运行）；凭证=login --identity codex
一次性只读复制 ~/.codex/auth.json（唯一显式授权例外，绝不回写）。
doubao 零凭证：登录态由你在豆包客户端内自理；「wbx doubao …」手工直通为零落盘旁路（不经调度、不入历史）。

用法：
  node wbx.mjs doctor  [--quick] | [--no-probe]    自检向导：node/CLI 探测/模板/WorkBuddy 双 lane 凭证+模型探测
                                                   + cline 可选段（含免费孪生存在性校验）
                                                   + codex 可选段（免额度探测：login status+模型+冷却态）
                                                   + doubao 可选段（桌面端调试口探测；快检跳过）
                                                   --quick：快检（v22）——跳过一切探测与端点/子进程调用，
                                                   只做 node/CLI 路径/凭证存在性/config 静态检查，<10s 零额度；
                                                   常规会话自检用 --quick，排障才全量
  node wbx.mjs login   [--identity cn|ai|cline|codex] [...] 登录引导（默认 cn 微信扫码；ai 有 state 修补锦囊；
                     cline 为 OAuth 设备授权，浏览器完成；codex 为一次性只读复制 ~/.codex/auth.json）
                     [--wait 300] [--no-open] [--force]
  node wbx.mjs ask     --file t.txt | --text "..."  单次调用（落盘为 job）；stdout=结果，stderr=lane/耗时
                     [--as codex|ai|cn|cline|doubao] [--model M] [--effort low] [--timeout 300] [--json] [--stdin]
                     [--ephemeral]                    真实执行零落盘（v23：回退/重试/超时/caps 原样，不建 job
                                                      不入历史；冒烟/连通性验证一律用它，结果照常 stdout/stderr）
                     [--caps 能力集]                  能力集（v19 能力矩阵，缺省=config default-caps）：
                                                      token ∈ net|read|write 逗号组合（序无关、去重）；
                                                      别名 L0=∅ 纯文本零回退、L1=net,read（仅 ai/cn，缺省超时
                                                      600s，轨迹落盘）；含 write 本轮未交付（声明即报错）；
                                                      L2 保留未交付（声明即报错）
                     [--max-turns N]                  能力任务回合上限（v6.2，整数 1-64，任何非 ∅ 能力集生效；
                                                      缺省 config caps-l1-max-turns=24；耗尽报 l1-turns-exhausted）
  node wbx.mjs fanout  --file tasks.json            并发池批量执行；任务可用 files:[路径] 拼材料；结果写 <运行时根>/jobs/<jobId>/
                     [--lanes codex,ai,cn,cline,doubao] [--parallel 2] [--timeout 300] [--retry 1] [--ephemeral]
                                                      --ephemeral=真实执行零落盘（不建 job；结果 JSON 走 stdout）
                                                      任务对象支持 "caps":"net,read"（能力集，语义同 ask --caps；
                                                      L1 别名同值）、"maxTurns":N（任务级回合上限，语义同 ask）、
                                                      "filesMode":"reference"（材料播种：files 复制进 worker
                                                      scratch 按相对路径自读；需任务级 caps 显式含 read+ai/cn）
  node wbx.mjs models  [--as codex|ai|cn|cline|doubao] [--probe "m1,m2"]   探测模型可用性并列出产品配置中的模型
                     [--free]     （--as cline --free：列当前免费模型组，recommended-models 端点实时；
                                   codex/doubao 无模型清单概念：明确报错指路——codex 走 config
                                   codex-model+doctor（探测耗 Plus 额度不做），doubao 模型自管理）
  node wbx.mjs usage  [--json] [--force]             各 lane 余额（v6.8：WorkBuddy 双 lane 走社区 billing
                                                    端点并显式标注「非官方」；cline/doubao/codex 如实标注
                                                    无端点——Plus 额度以 ChatGPT 网页端 Settings→Usage 为准；
                                                    unavailable 诚实兜底+官方控制台指路；TTL 缓存）
  node wbx.mjs config  list | get <key> | set <key> <value>
                                                   配置：default-lane=auto|codex|ai|cn|cline|doubao、
                                                   disabled-lanes=["cn"]、parallel-per-lane、model、cli-path、
                                                   cline-path/data-dir/provider/model（默认 cline-free/
                                                   deepseek-v4.1-flash）/thinking/compaction、cline-parallel、
                                                   doubao-parallel（默认 1 上限 2，单客户端 UI 串行保护）、
                                                   codex-path（空=自动扫描桌面版捆绑 CLI）、codex-model
                                                   （默认 gpt-6.1-sol，≥GPT-6 底线护栏）、codex-reasoning
                                                   （low|medium|high|xhigh，默认 medium）、codex-parallel
                                                   （默认 1，Plus 额度保护）、codex-quota-cooldown-min
                                                   （默认 30，额度冷却分钟）、
                                                   default-caps=∅(L0)|net,read(L1)|能力集串（缺省能力集，默认 L0）、
                                                   caps-l1-max-turns=24（能力任务缺省回合上限，键名沿用，v19 起
                                                   语义=任何非 ∅ 能力集）、
                                                   caps-l2-enabled=true|false（L2 总闸，默认 false，未交付留位）、
                                                   effort/context（cn 白天思考档/ai+cn 上下文预算）与
                                                   night-model/night-effort/night-context/night-window/
                                                   night-expires（v24 cn 夜间免费档五键：夜间窗内自动切
                                                   hy4-preview+high+960k，窗外白天档；纯时钟判定每次投递现算）、
                                                   scratch-ttl-hours=168/jobs-retention-days=30/
                                                   output-max-bytes=5242880（v28B 产物生命周期三键：scratch
                                                   惰性 GC TTL / jobs 保留窗 / 单件输出护栏，0=关）
                                                   （存 <运行时根>/config.json）
  node wbx.mjs history [--last 10]                 历史列表（时间/类型/任务数/成功率/lane 分布/目录）
  node wbx.mjs history <jobId> [--task <id>]       完整回放一次 job 的双向对话（prompt+回复全文）
  node wbx.mjs clean    [--jobs N] [--scratch H] [--lane-cache] [--apply] [--force]
                                                   产物回收（v28B）：缺省=只读干跑（候选表
                                                   KIND|PATH|AGE|SIZE|ACTION + 尾行 Total reclaimed 预估，
                                                   零删除）；--apply 才执行（TTY 未加 --force 会要求确认，
                                                   非 TTY 自动放行）；--jobs <days>/--scratch <hours> 覆盖
                                                   域窗（缺省取 config：30 天/168 小时；0=关该域）；
                                                   --lane-cache 剪 config/{ai,cn}/{traces,logs,shell-snapshots}
                                                   白名单（30d+24h 安全窗；plugins/projects 等绝不入列）；
                                                   候选仅由扫描枚举、凭证四目录任何路径不可达；
                                                   symlink/junction 跳过；删除失败记 skipped 不影响退出码
  node wbx.mjs ui      [--port 7788] [--no-open]   本地 Web UI（仅 127.0.0.1；状态/路由/免费模型选择/ask/fanout/历史/登录）
                     [--detach]                    后台守护启动（幂等：同项目已在跑则复用；状态/日志随 <运行时根>/run|logs；
                                                   守护每项目化——7788 被他人/他项目占用时报错退出，--port 换端口另起）
                     [--stop] / [--status]         停止守护进程（HTTP 优雅优先）/ 查看三态（运行中/残留/未运行）
  node wbx.mjs self-install                         安装：复制技能目录到 ~/.zcode/skills/wb-bridge/（scripts+SKILL+
                                                    docs+doubao 可选+.wbx-install.json 版本自证 manifest）；
                                                    不写 AGENTS 块/自启钩子/全局运行时；检测到 v28 及更早旧形态
                                                    痕迹（AGENTS 块/钩子/旧目录/commands/wbx.md）时一次性清扫
                                                    （幂等；~/.wbx 凭证绝不自动迁移，仅提示）
  node wbx.mjs self-uninstall                       卸载（删技能目录+停守护+一次性清扫；各项目 .wbx/ 含凭证保留）
  node wbx.mjs export-bundle [--out <dir|.zip>]     生成分发 zip（零凭证自检；含 INSTALL-README.md；默认落 <git 根>/.wbx/export/）
  node wbx.mjs doubao  <doubao.mjs 子命令与参数…>   豆包桌面桥手工直通（v6.3 可选工具·v13 兼第四 lane 的零落盘旁路·
                                                   Windows-only：status | new-task | configure | send | read | ask；
                                                   参数原样转发，子命令说明见 doubao.mjs 自身 usage；不经调度、
                                                   零落盘副作用、不入历史——调度请用 ask --as doubao / fanout 任务绑定）
                                                   需豆包以调试口 9225 运行（cmd 写法；PowerShell 换 $env:USERPROFILE）：
                                                   powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\\.zcode\\skills\\wb-bridge\\doubao\\launch.ps1"
                                                   目录解析：全局 ~/.zcode/skills/wb-bridge/doubao/（self-install 复制）
                                                   -> 仓库 tools/doubao-bridge/（v12 源；未装则明确报错，不影响其余 lane）

tasks.json 格式：[{"id":"t1","prompt":"...","as?":"codex|ai|cn|cline|doubao","model?":"...","effort?":"low","file?":"p.txt","files?":["a.js"],"filesMode?":"reference（需任务级 caps 显式含 read）","caps?":"net,read（能力集或 L1 别名）","maxTurns?":24}]

命令一览（与分发表同源生成）：
${COMMANDS.map((c) => `  ${(c.name + ' ').padEnd(16)} ${c.desc}`).join('\n')}

旗标总表（与解析表同源生成；均为全局旗标，按子命令适用）：
${FLAGS.map((f) => `  ${f.name.padEnd(22)}${(f.alias || []).map((a) => `${a} `).join('').padEnd(8)}${f.val === 'bool' ? '开关' : f.val === 'int' ? '整数' : '取值'}`).join('\n')}

退出码：0 成功 / 1 失败（含校验错误 die）；usage 命令自然排空不强制退出（Windows libuv 兼容特例）；
ui --detach 恒 0（脚本化拉起路径须秒回，失败只落日志）；wbx-daemon 专用退出码 78（守护协议，不经本 CLI）。

环境变量（均可选）：WBX_HOME（运行时根）、WBX_CLI、WBX_CLINE（cline 二进制）、WBX_CODEX（codex 二进制）、
WBX_MODEL、WBX_PROJECT_ROOT、WBX_PRODUCT_CONFIG（login 模板）`;

async function main() {
  const argv = process.argv.slice(2);
  // doubao 直通：其余参数原样转发给 doubao.mjs，绕过 parseArgs（旗标集互不兼容）
  if (argv[0] === 'doubao') return cmdDoubao(argv.slice(1));
  const opts = parseArgs(argv);
  if (opts.version) { console.log(`wbx v${WBX_VERSION}`); await exitWith(0); }
  const cmd = opts._[0];
  if (opts.help || !cmd) {
    if (opts.help) { console.log(HELP); await exitWith(0); }   // 显式 --help=正常输出（stdout/0）；裸调用=用法提示（stderr/1）
    console.error(HELP); await exitWith(1);
  }
  const hit = COMMANDS.find((c) => c.name === cmd);
  if (!hit || !hit.fn) die(`未知子命令 ${cmd}（--help 查看用法）`);
  return hit.fn(opts);
}

// die() 抛 DieSignal 至此统一收口：等 pendingKills 后退（win32 libuv 断言防护，退出协议单点）；
// 非 DieSignal 的意外异常打印堆栈后同码退出
main().catch(async (e) => {
  if (!(e instanceof DieSignal)) console.error('[FAIL] ' + redact(e && e.stack || e));
  await exitWith(1);
});
