/**
 * wbx-ui — wbx 桥本地 Web UI（v3 Phase 3；v5.2 守护化 + 安全校验）
 *
 * 零第三方依赖（原生 node:http），只监听 127.0.0.1，内嵌单页前端（HTML/CSS/vanilla JS，
 * 不引任何外部 CDN，离线可用）。`wbx ui` 前台启动（自动开浏览器，Ctrl+C 即退）；
 * `wbx ui --detach` 幂等拉起守护进程（生命周期见 wbx-daemon.mjs）。
 *
 * API（全 JSON）：
 *   GET  /api/status                 概览（lane 状态/到期倒计时/配置/形态）——不含任何凭证
 *   GET  /api/doctor?probe=1         体检（probe=1 含模型探测，较慢）
 *   GET  /api/history                job 列表（含旧 .wbx/tasks/ 兼容条目）
 *   GET  /api/job/:id[?brief=1]      job 详情（brief 不含 prompt/回复正文，用于轮询）
 *   POST /api/ask                    {prompt, lane, model, effort, timeout} -> {jobId}
 *   POST /api/fanout                 {tasks:[{id,prompt,as}], lanes, parallel, timeout, retry} -> {jobId}
 *   POST /api/config                 {key, value} -> 写 <运行时根>/config.json
 *   POST /api/login/start            {lane} -> {authUrl, tips}（登录流在 server 侧跑）
 *   GET  /api/login/poll             登录轮询状态
 *   GET  /__health                   健康检查 -> {app:'wbx-ui', pid, port, version}（前台/守护都有）
 *   POST /__shutdown                 {token} 优雅关闭（仅守护模式；token 存 run/ui.json，绝不外泄）
 *
 * 安全校验（v5.2，前台/守护一律生效）：
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
import {
  WBX_VERSION, RUNTIME_ROOT, JOBS_DIR,
  LANE_ORDER, CONFIG_DEFS, bridgeForm,
  redact, loadConfig, setConfig, parseLane,
  laneStatusInfo, resolveDefaultLane, newJobId, getJob, listJobs,
  runAskJob, runFanoutJob, doctorStatus, fetchClineFreeModels,
  startLogin, pollLoginToken, fetchAccountInfo, persistLogin,
  openBrowser, ensureDirs,
} from './wbx-core.mjs';
import { hostHeaderAllowed, originAllowed } from './wbx-daemon.mjs';

// 守护上下文与监听端口（startUiServer 时设置；handler 里做安全校验与 shutdown 用）
let LISTEN_PORT = 7788;
let DAEMON_CTX = null;   // { token, persist(state), clear(), onShutdown() }
let SERVER = null;

// ---------- 内嵌前端（单文件，无外部资源） ----------
const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wbx 桥控制台</title>
<style>
/* ===== 设计 token（v5.3：间距/圆角/字阶/状态色全变量化；基线 internal/worker-dark-theme-tokens.md） ===== */
:root{
  --bg:#0f1117;--panel:#171a23;--panel2:#1e2230;--hover:#232838;
  --line:#2a2f40;--line-strong:#3a4160;--line-ctrl:#5c6684;
  --fg:#e6e9f2;--fg-hi:#ffffff;--dim:#9aa3b8;--dim-hi:#aab2c6;
  --acc:#5b8cff;--acc-300:#7fa5ff;--acc-600:#4a7aeb;
  --ok:#3ecf8e;--warn:#f0b429;--warn2:#ffa94d;--err:#ff6b6b;--neutral:#9aa3b8;
  --acc-soft:rgba(91,140,255,.14);--ok-soft:rgba(62,207,142,.14);--warn-soft:rgba(240,180,41,.14);
  --warn2-soft:rgba(255,169,77,.14);--err-soft:rgba(255,107,107,.14);--neutral-soft:rgba(154,163,184,.12);
  --acc-line:rgba(91,140,255,.35);--ok-line:rgba(62,207,142,.35);--warn-line:rgba(240,180,41,.35);
  --warn2-line:rgba(255,169,77,.35);--err-line:rgba(255,107,107,.35);--neutral-line:rgba(154,163,184,.35);
  --s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:24px;--s6:32px;
  --r-sm:4px;--r-md:8px;--r-lg:12px;--r-pill:999px;
  --fs-xs:12px;--fs-sm:13px;--fs-md:14px;--fs-lg:17px;--fs-xl:20px;
  --lh-tight:1.3;--lh-base:1.65;--lh-loose:1.75;
  --shadow-1:0 1px 2px rgba(0,0,0,.35);
  --shadow-2:0 4px 16px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04);
  --shadow-focus:0 0 0 3px rgba(91,140,255,.28);
  --t-fast:120ms;--t-base:180ms;--t-slow:280ms;--ease:cubic-bezier(.2,.8,.2,1);
  --font:system-ui,"Segoe UI","Microsoft YaHei UI","PingFang SC",sans-serif;
  --mono:ui-monospace,"Cascadia Mono",Consolas,"Courier New",monospace;
}
*{box-sizing:border-box}
html{scrollbar-gutter:stable}
*{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:999px;border:3px solid transparent;background-clip:padding-box}
::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.26);background-clip:padding-box}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-corner{background:transparent}
body{margin:0;background:var(--bg);color:var(--fg);font:var(--fs-md)/var(--lh-base) var(--font)}
a{color:var(--acc-300)}
.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.mono{font-family:var(--mono);font-size:var(--fs-xs)}
.right{margin-left:auto}

/* ===== header / nav（tab 下划线动效） ===== */
header{padding:0 var(--s5);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap;min-height:52px}
header h1{font-size:var(--fs-md);font-weight:600;margin:0;color:var(--fg-hi);letter-spacing:.01em}
header .meta{color:var(--dim-hi);font-size:var(--fs-xs);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46vw}
nav{margin-left:auto;display:flex;gap:var(--s1);align-self:stretch}
nav button{position:relative;background:transparent;border:0;cursor:pointer;font-family:inherit;font-size:var(--fs-sm);color:var(--dim);padding:0 var(--s3);transition:color var(--t-base) var(--ease)}
nav button::after{content:"";position:absolute;left:10px;right:10px;bottom:0;height:2px;background:var(--acc);border-radius:1px;transform:scaleX(0);transform-origin:left;transition:transform var(--t-base) var(--ease)}
nav button:hover{color:var(--fg)}
nav button.active{color:var(--fg)}
nav button.active::after{transform:scaleX(1)}
nav button:focus-visible{outline:none;box-shadow:var(--shadow-focus);border-radius:var(--r-sm)}

main{padding:var(--s5) var(--s5) var(--s6);max-width:1100px;margin:0 auto}
section{display:none}
section.on{display:block}

/* ===== 卡片（悬浮微抬升，包 hover:hover 防触屏粘滞） ===== */
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-md);box-shadow:var(--shadow-1);margin-bottom:var(--s4);scroll-margin-top:var(--s4)}
@media (hover:hover){
  .card{transition:transform var(--t-base) var(--ease),box-shadow var(--t-base) var(--ease),border-color var(--t-base) var(--ease)}
  .card:hover{transform:translateY(-1px);box-shadow:var(--shadow-2);border-color:rgba(255,255,255,.08)}
}
.card__hd{display:flex;align-items:center;gap:var(--s3);min-height:44px;padding:0 var(--s4);border-bottom:1px solid var(--line);flex-wrap:wrap}
.card__title{font-size:var(--fs-md);font-weight:600;color:var(--fg);letter-spacing:.01em}
.card__sub{font-size:var(--fs-xs);color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.card__bd{padding:var(--s4)}
.card.off .card__bd,.card.off .card__title,.card.off .card__sub{opacity:.62}

/* ===== 健康总览条 ===== */
.ovw{display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap;padding:var(--s3) var(--s4);border-left:3px solid var(--neutral)}
.ovw.t-ok{border-left-color:var(--ok)}
.ovw.t-warn{border-left-color:var(--warn)}
.ovw.t-warn2{border-left-color:var(--warn2)}
.ovw.t-err{border-left-color:var(--err)}
.ovw .concl{font-size:var(--fs-md);font-weight:600}
.ovw.t-err .concl{color:var(--err)}
.ovw.t-warn2 .concl,.ovw.t-warn .concl{color:var(--warn)}
.ovw .chips{margin-left:auto;display:flex;gap:var(--s2);flex-wrap:wrap}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:var(--r-pill);background:var(--panel2);border:1px solid var(--line);color:var(--fg);font-size:var(--fs-xs);text-decoration:none;white-space:nowrap;transition:border-color var(--t-fast),background var(--t-fast)}
.chip:hover{background:var(--hover);border-color:var(--line-ctrl)}
.chip .sig{color:var(--dim-hi)}
.shp{display:inline-block;width:7px;height:7px;flex:none;box-sizing:border-box;font-style:normal}
.s-dot{border-radius:50%;background:currentColor}
.s-dia{border-radius:1px;transform:rotate(45deg);background:currentColor}
.s-sq{border-radius:1px;background:currentColor}
.s-ring{border-radius:50%;border:1.5px solid currentColor;background:transparent}
.c-ok{color:var(--ok)}
.c-warn{color:var(--warn)}
.c-warn2{color:var(--warn2)}
.c-err{color:var(--err)}
.c-neutral{color:var(--neutral)}
.c-acc{color:var(--acc-300)}

/* ===== 状态徽标（形状+颜色双编码；进行中=空心环呼吸，与●可用静默区分） ===== */
.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border-radius:var(--r-sm);font-size:var(--fs-xs);line-height:18px;font-weight:500;border:1px solid transparent;white-space:nowrap;vertical-align:middle}
.badge::before{content:"";flex:0 0 auto;box-sizing:border-box;width:6px;height:6px;background:currentColor}
.badge.ok{color:var(--ok);background:var(--ok-soft);border-color:var(--ok-line)}
.badge.ok::before{border-radius:50%}
.badge.warn{color:var(--warn);background:var(--warn-soft);border-color:var(--warn-line)}
.badge.warn::before{border-radius:1px;transform:rotate(45deg)}
.badge.warn2{color:var(--warn2);background:var(--warn2-soft);border-color:var(--warn2-line)}
.badge.warn2::before{border-radius:1px;transform:rotate(45deg)}
.badge.err{color:var(--err);background:var(--err-soft);border-color:var(--err-line)}
.badge.err::before{border-radius:1px}
.badge.neutral{color:var(--neutral);background:var(--neutral-soft);border-color:var(--neutral-line)}
.badge.neutral::before{background:transparent;border:1.5px solid currentColor;border-radius:50%}
.badge.acc{color:var(--acc-300);background:var(--acc-soft);border-color:var(--acc-line)}
.badge.acc::before{border-radius:50%}
.badge.absent{color:var(--dim-hi);background:transparent;border-style:dashed;border-color:var(--neutral-line)}
.badge.absent::before{background:transparent;border:1.5px dashed currentColor;border-radius:50%}
.badge.run::before{background:transparent;border:1.5px solid currentColor;border-radius:50%;animation:wbx-pulse 2s var(--ease) infinite}
@keyframes wbx-pulse{0%,100%{box-shadow:0 0 0 0 currentColor;opacity:1}50%{box-shadow:0 0 0 4px transparent;opacity:.75}}
.dot--running{display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--acc);animation:wbx-pulse 2s var(--ease) infinite}
@media (prefers-reduced-motion:reduce){.badge.run::before,.dot--running{animation:none;opacity:1}}

/* ===== 成本徽标三档（纯胶囊无形状，细则进 title） ===== */
.cost{display:inline-flex;align-items:center;padding:2px 10px;border-radius:var(--r-pill);font-size:var(--fs-xs);line-height:18px;font-weight:500;white-space:nowrap;cursor:help}
.cost.acc{color:var(--acc-300);background:var(--acc-soft)}
.cost.neutral{color:var(--dim-hi);background:var(--neutral-soft)}
.cost.warn{color:var(--warn);background:var(--warn-soft)}

/* ===== 键值行（96px 标签 + 可截断值；分隔线只画组间） ===== */
.kv{display:grid;grid-template-columns:96px minmax(0,1fr);gap:3px var(--s3);align-items:baseline}
.kv .k{color:var(--dim-hi);font-size:var(--fs-xs);letter-spacing:.02em;white-space:nowrap}
.kv .v{color:var(--fg);font-size:var(--fs-sm);min-width:0;display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.kv .v .vtxt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.kv .v .badge,.kv .v .cost{flex:none}

/* ===== 段标题（左色条+字距） ===== */
.sect{display:flex;align-items:center;gap:var(--s2);margin:var(--s4) 0 var(--s2);font-size:var(--fs-xs);font-weight:600;color:var(--dim);letter-spacing:.08em}
.sect::before{content:"";width:2px;height:12px;border-radius:1px;background:var(--acc);flex:none}

/* ===== 通道卡网格 ===== */
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:var(--s3);margin-bottom:var(--s4)}
.grid3 .card{margin-bottom:0}
.pwr{margin-left:auto;display:inline-flex;align-items:center;flex:none}

/* ===== 表格（sticky 表头/行 hover/数字右对齐/无斑马纹） ===== */
.tbl-wrap{overflow:auto;border:1px solid var(--line);border-radius:var(--r-sm)}
.tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:var(--fs-sm)}
.tbl th{position:sticky;top:0;z-index:2;background:var(--panel2);border-bottom:1px solid var(--line-strong);height:34px;padding:0 var(--s3);text-align:left;font-size:var(--fs-xs);font-weight:600;color:var(--dim);letter-spacing:.06em;white-space:nowrap}
.tbl td{height:38px;padding:0 var(--s3);border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tbody tr:last-child td{border-bottom:none}
.tbl tbody tr{cursor:pointer;transition:background var(--t-fast)}
.tbl tbody tr:hover{background:var(--panel2)}
.tbl .num{text-align:right;width:1%;white-space:nowrap}
.tbl td.mono{color:var(--dim-hi);cursor:copy}

/* ===== 表单控件（内凹底/聚焦环/纯 CSS select 箭头） ===== */
input[type=text],select,textarea{height:32px;padding:0 10px;font-family:inherit;font-size:var(--fs-sm);color:var(--fg);background:var(--bg);border:1px solid var(--line-ctrl);border-radius:var(--r-sm);transition:border-color var(--t-fast),box-shadow var(--t-fast)}
textarea{height:auto;min-height:110px;padding:8px 10px;line-height:var(--lh-base);resize:vertical;font-family:var(--mono);font-size:var(--fs-xs);width:100%}
input[type=text]:focus-visible,select:focus-visible,textarea:focus-visible{outline:none;border-color:var(--acc);box-shadow:var(--shadow-focus)}
input::placeholder,textarea::placeholder{color:var(--dim)}
input:disabled,select:disabled,textarea:disabled{opacity:.55;cursor:not-allowed;color:var(--dim-hi);background:var(--panel2)}
select{appearance:none;-webkit-appearance:none;padding-right:26px;cursor:pointer;background-image:linear-gradient(45deg,transparent 50%,var(--dim) 50%),linear-gradient(135deg,var(--dim) 50%,transparent 50%);background-position:calc(100% - 14px) 14px,calc(100% - 9px) 14px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
select option{background:var(--panel2);color:var(--fg)}
label{color:var(--dim);font-size:var(--fs-sm)}
.row{display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap;margin:var(--s3) 0 0}
.card__bd>.row:first-child,.dbd>.row:first-child{margin-top:0}
.row label{display:inline-flex;gap:6px;align-items:center}

/* ===== 按钮三档 ===== */
.btn-primary,.btn-ghost,.btn-danger{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border-radius:var(--r-sm);font-family:inherit;font-size:var(--fs-sm);font-weight:500;border:1px solid transparent;cursor:pointer;white-space:nowrap;transition:background var(--t-fast) var(--ease),border-color var(--t-fast) var(--ease),color var(--t-fast) var(--ease)}
.btn-primary{background:var(--acc);color:#0b1020}
.btn-primary:hover{background:var(--acc-600)}
.btn-ghost{background:transparent;color:var(--fg);border-color:var(--line-strong)}
.btn-ghost:hover{background:rgba(255,255,255,.05);border-color:var(--dim)}
.btn-danger{background:transparent;color:var(--err);border-color:rgba(255,107,107,.45)}
.btn-danger:hover{background:var(--err-soft)}
.btn-primary:focus-visible,.btn-ghost:focus-visible,.btn-danger:focus-visible{outline:none;box-shadow:var(--shadow-focus)}
.btn-primary:disabled,.btn-ghost:disabled,.btn-danger:disabled{opacity:.5;cursor:not-allowed}
.btn-block{width:100%;justify-content:flex-start;height:38px;margin-bottom:var(--s2)}

/* ===== 电源开关（纯 CSS 36x20 胶囊；勾选=启用） ===== */
.power{appearance:none;-webkit-appearance:none;position:relative;width:36px;height:20px;flex:0 0 auto;margin:0;background:var(--panel2);border:1px solid var(--line-ctrl);border-radius:var(--r-pill);cursor:pointer;transition:background var(--t-base) var(--ease),border-color var(--t-base) var(--ease)}
.power::after{content:"";position:absolute;top:50%;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dim);transform:translateY(-50%);transition:transform var(--t-base) var(--ease),background var(--t-fast)}
.power:checked{background:var(--acc);border-color:var(--acc)}
.power:checked::after{transform:translate(16px,-50%);background:#0b1020}
.power:focus-visible{outline:none;box-shadow:var(--shadow-focus)}
.power:disabled{opacity:.5;cursor:not-allowed}

/* ===== 分段器 ===== */
.seg{display:inline-flex;align-items:center;gap:2px;padding:2px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--r-pill);flex-wrap:wrap}
.seg button{appearance:none;height:26px;padding:0 12px;border:1px solid transparent;border-radius:var(--r-pill);background:transparent;font-family:inherit;font-size:var(--fs-xs);font-weight:500;color:var(--dim);cursor:pointer;white-space:nowrap;transition:background var(--t-base) var(--ease),color var(--t-base) var(--ease)}
.seg button:hover{color:var(--fg);background:var(--hover)}
.seg button.active{background:var(--acc);color:#0b1020}
.seg button:focus-visible{outline:none;box-shadow:var(--shadow-focus)}

/* ===== details / 折叠 ===== */
details{margin:var(--s3) 0 0;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--panel2)}
summary{cursor:pointer;color:var(--dim-hi);font-size:var(--fs-xs);padding:8px var(--s3);list-style:none;display:flex;align-items:center;gap:6px;user-select:none}
summary::-webkit-details-marker{display:none}
summary::before{content:"";width:0;height:0;border-left:4px solid var(--dim);border-top:3.5px solid transparent;border-bottom:3.5px solid transparent;transition:transform var(--t-fast)}
details[open]>summary::before{transform:rotate(90deg)}
summary:focus-visible{outline:none;box-shadow:var(--shadow-focus);border-radius:var(--r-sm)}
summary .adv-sum{margin-left:auto;color:var(--dim-hi);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dbd{padding:var(--s2) var(--s3) var(--s3)}

/* ===== 提示/错误/警示框 ===== */
.hint{color:var(--dim);font-size:var(--fs-xs)}
.mini{color:var(--acc-300);font-size:var(--fs-xs);cursor:pointer;background:none;border:none;padding:0;font-family:inherit;text-decoration:underline dotted;white-space:nowrap;flex:none}
.err-box{background:var(--err-soft);border:1px solid var(--err-line);border-radius:var(--r-sm);padding:10px var(--s3);color:#ffb3b3;font-size:var(--fs-sm);white-space:pre-wrap;display:flex;gap:var(--s2);align-items:flex-start;margin:var(--s2) 0}
.err-box .etx{flex:1;min-width:0;word-break:break-word}
.warn-box{background:var(--warn-soft);border:1px solid var(--warn-line);border-radius:var(--r-sm);padding:8px var(--s3);color:var(--warn);font-size:var(--fs-sm);margin-top:var(--s2)}
.copyline{font-family:var(--mono);font-size:var(--fs-xs);word-break:break-all;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 10px;margin:var(--s2) 0;display:flex;align-items:center;gap:var(--s2)}
.copyline .t{flex:1;min-width:0;color:var(--fg)}
.copybtn{flex:none;height:20px;padding:0 8px;font-size:11px;line-height:1;border-radius:var(--r-sm);border:1px solid var(--line-ctrl);background:transparent;color:var(--dim-hi);cursor:pointer;font-family:inherit;transition:color var(--t-fast),border-color var(--t-fast)}
.copybtn:hover{color:var(--fg);border-color:var(--dim)}

/* ===== 任务卡 / 结果 ===== */
.task-card{border:1px solid var(--line);border-radius:var(--r-sm);padding:var(--s3);margin:var(--s3) 0;background:var(--panel2)}
.task-card .hd{display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap;font-size:var(--fs-xs);color:var(--dim)}
.task-card .hd b{color:var(--fg)}
.runline{display:flex;align-items:center;gap:var(--s2);color:var(--dim);font-size:var(--fs-sm);margin:var(--s2) 0}
.md{font-size:var(--fs-sm);line-height:var(--lh-base)}
.md h1,.md h2,.md h3{margin:.7em 0 .35em;font-size:1.05em}
.md pre{margin:.5em 0}
.md code{background:var(--panel2);padding:1px 5px;border-radius:var(--r-sm);font-family:var(--mono);font-size:.92em}
.md pre code{background:none;padding:0}
.md ul{margin:.4em 0;padding-left:1.4em}
.md a{color:var(--acc-300)}
pre{background:var(--bg);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px 12px;overflow:auto;font-size:var(--fs-xs);font-family:var(--mono);margin:var(--s2) 0}
.mdwrap{position:relative;margin-top:var(--s2)}
.mdwrap.clamp{max-height:12.5em;overflow:hidden}
.mdwrap.clamp::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3em;background:linear-gradient(rgba(23,26,35,0),var(--panel))}
.expand{margin-top:4px}

/* ===== 批量任务行 ===== */
.fan-row{display:grid;grid-template-columns:140px 110px minmax(0,1fr) 34px;gap:var(--s2);margin-bottom:var(--s2)}
.fan-row textarea{min-height:44px}
.fan-row .fan-del{height:32px;padding:0;border:1px solid var(--line-strong);background:transparent;color:var(--dim);border-radius:var(--r-sm);cursor:pointer;font-size:var(--fs-sm)}
.fan-row .fan-del:hover{color:var(--err);border-color:rgba(255,107,107,.45)}

/* ===== 空态 / 体检分组 ===== */
.empty{padding:var(--s5) var(--s4);text-align:center}
.empty .e1{font-size:var(--fs-md);color:var(--fg);font-weight:500}
.empty .e2{color:var(--dim);font-size:var(--fs-sm);margin:6px 0 var(--s4)}
.cnt{display:inline-flex;min-width:18px;height:18px;align-items:center;justify-content:center;padding:0 5px;border-radius:var(--r-pill);font-size:11px;background:var(--neutral-soft);color:var(--dim-hi)}
.cnt-err{background:var(--err-soft);color:var(--err)}
.cnt-ok{background:var(--ok-soft);color:var(--ok)}
.dg-err{border-color:var(--err-line)}
.dg-err>summary{color:var(--err)}
.dstep{display:grid;grid-template-columns:minmax(0,190px) minmax(0,1fr) auto;gap:var(--s2);padding:4px 0;font-size:var(--fs-xs);align-items:baseline}
.dstep .dn{color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dstep .dd{color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}

/* ===== toast ===== */
.toasts{position:fixed;right:var(--s5);bottom:var(--s5);z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:var(--s2);pointer-events:none;max-width:min(420px,calc(100vw - var(--s5)*2))}
.toast{pointer-events:auto;display:flex;align-items:flex-start;gap:var(--s2);min-width:220px;padding:10px var(--s3);background:var(--panel);color:var(--fg);border:1px solid var(--line-strong);border-left:3px solid var(--dim);border-radius:var(--r-md);box-shadow:var(--shadow-2);font-size:var(--fs-sm);line-height:var(--lh-base);animation:toast-in var(--t-slow) var(--ease) both}
.toast.info{border-left-color:var(--acc)}
.toast.success{border-left-color:var(--ok)}
.toast.error{border-left-color:var(--err)}
.toast__close{margin-left:auto;padding:0 4px;background:transparent;border:0;color:var(--dim);font-family:inherit;font-size:var(--fs-md);line-height:1;cursor:pointer;border-radius:var(--r-sm)}
.toast__close:hover{color:var(--fg);background:rgba(255,255,255,.06)}
.toast.leaving{animation:toast-out var(--t-base) var(--ease) both}
@keyframes toast-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
@keyframes toast-out{from{opacity:1;transform:none}to{opacity:0;transform:translateY(6px) scale(.98)}}
@media (prefers-reduced-motion:reduce){.toast,.toast.leaving{animation-duration:1ms}.card:hover{transform:none}}

.spin{display:inline-block;width:13px;height:13px;border:2px solid var(--dim);border-top-color:var(--acc);border-radius:50%;animation:sp 1s linear infinite;vertical-align:-2px;flex:none}
@keyframes sp{to{transform:rotate(360deg)}}

@media (max-width:960px){
  header{padding:var(--s2) var(--s4)}
  header .meta{max-width:100%}
  main{padding:var(--s4) var(--s3) var(--s5)}
}
</style>
</head>
<body>
<header>
  <h1>wbx 桥控制台</h1>
  <span class="meta" id="hdr-meta">加载中…</span>
  <nav>
    <button data-tab="status" class="active">状态</button>
    <button data-tab="run">调用</button>
    <button data-tab="history">历史</button>
    <button data-tab="login">登录</button>
  </nav>
</header>
<main>

<section id="tab-status" class="on">
  <div class="card ovw" id="ovw" style="display:none"></div>
  <div class="card" id="status-error" style="display:none"><div class="card__bd" id="status-error-bd"></div></div>
  <div class="grid3" id="lane-cards"></div>
  <div class="card">
    <div class="card__hd"><span class="card__title">路由</span></div>
    <div class="card__bd">
      <div class="row">
        <span class="seg" id="route-pill">
          <button data-v="auto">自动（WorkBuddy AI 免费优先）</button>
          <button data-v="ai">固定 WorkBuddy AI</button>
          <button data-v="cn">固定 WorkBuddy</button>
          <button data-v="cline">固定 Cline</button>
        </span>
      </div>
      <div class="hint" id="route-hint" style="margin-top:8px"></div>
      <div class="warn-box" id="route-warn" style="display:none"></div>
      <div class="hint" style="margin-top:8px">写 <b>config.json</b>（default-lane / disabled-lanes），体检、单条调用、批量并行、回退链即时生效；通道停用开关在各通道卡右上角。</div>
    </div>
  </div>
  <div class="card">
    <div class="card__hd"><span class="card__title">体检</span><span class="card__sub">doctor</span></div>
    <div class="card__bd" id="doctor-zone"></div>
  </div>
</section>

<section id="tab-run">
  <div class="card">
    <div class="card__hd">
      <span class="card__title">调用</span>
      <div class="seg right" id="run-mode">
        <button data-v="ask" class="active">单条调用（ask）</button>
        <button data-v="fanout">批量并行（fanout）</button>
      </div>
    </div>
    <div class="card__bd">
      <div id="ask-pane">
        <textarea id="ask-prompt" placeholder="提示词（完整 worker 提示词：角色+任务+材料+输出硬约束+无工具声明）"></textarea>
        <div class="row">
          <span class="seg" id="ask-lane-seg">
            <button data-v="" class="active">自动</button>
            <button data-v="ai">WorkBuddy AI</button>
            <button data-v="cn">WorkBuddy</button>
            <button data-v="cline">Cline</button>
          </span>
          <button class="btn-primary" id="ask-btn">执行单条调用</button>
        </div>
        <details id="ask-adv">
          <summary>高级<span class="adv-sum" id="ask-adv-sum"></span></summary>
          <div class="dbd">
            <div class="row">
              <label>思考档
                <select id="ask-effort">
                  <option value="">默认</option><option value="low">低</option><option value="medium">中</option><option value="high">高</option>
                </select></label>
              <label>模型 <input type="text" id="ask-model" placeholder="默认取 config.model" style="width:170px"></label>
              <label>超时(s) <input type="text" id="ask-timeout" value="300" style="width:70px"></label>
            </div>
          </div>
        </details>
      </div>
      <div id="fan-pane" style="display:none">
        <div id="fan-rows"></div>
        <div class="row">
          <button class="btn-ghost" id="fan-add">+ 添加任务行</button>
          <button class="btn-primary right" id="fan-btn">执行批量并行</button>
        </div>
        <details id="fan-adv">
          <summary>高级<span class="adv-sum" id="fan-adv-sum"></span></summary>
          <div class="dbd">
            <div class="row">
              <label>每通道并发 <input type="text" id="fan-parallel" value="2" style="width:60px"></label>
              <label>超时(s) <input type="text" id="fan-timeout" value="300" style="width:70px"></label>
            </div>
          </div>
        </details>
      </div>
      <div id="run-out"></div>
    </div>
  </div>
</section>

<section id="tab-history">
  <div class="card">
    <div class="card__hd">
      <span class="card__title">任务历史</span>
      <span class="card__sub">新 jobs/ + 旧 tasks/ 兼容</span>
      <span class="right" style="display:inline-flex;gap:10px;align-items:center">
        <span class="hint" id="hist-count"></span>
        <button class="btn-ghost" id="hist-refresh">刷新</button>
      </span>
    </div>
    <div class="card__bd">
      <div class="tbl-wrap"><table class="tbl" id="hist-table">
        <thead><tr><th>时间</th><th>类型</th><th class="num">任务数</th><th class="num">成功率</th><th>任务 ID</th></tr></thead>
        <tbody></tbody>
      </table></div>
    </div>
  </div>
  <div class="card" id="job-detail" style="display:none"></div>
</section>

<section id="tab-login">
  <div class="card">
    <div class="card__hd"><span class="card__title">登录引导</span><span class="card__sub">WorkBuddy SSO 凭证约 55 天有效</span></div>
    <div class="card__bd">
      <button class="btn-primary btn-block" id="login-ai"><span class="spin" hidden></span><span>登录 WorkBuddy AI（国际版 · 邮箱 / OneID）</span></button>
      <button class="btn-primary btn-block" id="login-cn"><span class="spin" hidden></span><span>登录 WorkBuddy（国内版 · 微信扫码）</span></button>
      <div id="login-out"></div>
    </div>
  </div>
  <div class="card">
    <div class="card__bd" style="padding:0">
      <details id="cline-guide">
        <summary>命令行登录（备用）· Cline CLI（可选通道）</summary>
        <div class="dbd">
          <p class="hint">Cline 登录是设备码流程，需在终端里跑（浏览器完成授权，凭证落隔离目录 <b>&lt;运行时根&gt;/cline-home/</b>，与用户 ~/.cline 无关）：</p>
          <div class="copyline"><span class="t">node "%USERPROFILE%\\.zcode\\wbx-bridge\\scripts\\wbx.mjs" login --identity cline</span><button class="copybtn" data-copy='node "%USERPROFILE%\\.zcode\\wbx-bridge\\scripts\\wbx.mjs" login --identity cline'>复制</button></div>
          <p class="hint">登录后默认免费调 DeepSeek（cline-free/deepseek-v4.1-flash 孪生，限时轮换+每日配额）；
          免费模型可在「状态」页 Cline 卡下拉选择，或 <b>wbx models --as cline --free</b> 查清单后 config set。
          思考档默认 xhigh / 上下文压缩默认 off / 并发默认 1。
          隐私注：免费用量可能被 Cline 用于改进模型（官方披露）。</p>
        </div>
      </details>
    </div>
  </div>
</section>

</main>
<div class="toasts" id="toasts"></div>
<script>
'use strict';
// ---------- 渲染层中文化映射表（v5.2 冻结术语，v5.3 只改排布/密度/编码，不改译法；数据值/config 键/API 字段一律不动） ----------
const LANE_LABEL={ai:'WorkBuddy AI',cn:'WorkBuddy',cline:'Cline',auto:'自动'};            // 短称：下拉/表格列/回退
const LANE_TITLE={ai:'WorkBuddy AI（国际版）',cn:'WorkBuddy（国内版）',cline:'Cline CLI（可选通道）'}; // 全称：卡片标题
const TYPE_LABEL={ask:'单条调用',fanout:'批量并行',unknown:'未知'};                        // 历史「类型」列
const TASK_STATUS_LABEL={success:'成功',failed:'失败'};
const JOB_STATUS_LABEL={done:'已完成',running:'进行中',pending:'等待中'};
const LANE_ORDER_UI=['ai','cn','cline'];
const BS=String.fromCharCode(92); // 反斜杠常量（模板字符串安全，不写反斜杠字面量）
function laneLabel(k){return LANE_LABEL[k]||k||''}
function laneTitle(k){return LANE_TITLE[k]||LANE_LABEL[k]||k||''}
function typeLabel(t,legacy){return (legacy?'旧版·':'')+(TYPE_LABEL[t]||t||'')}
function taskStatusLabel(s){return TASK_STATUS_LABEL[s]||s||''}
function jobStatusLabel(s){return JOB_STATUS_LABEL[s]||s||''}
function fallbackText(from,to){return from?(laneLabel(from)+' → '+laneLabel(to)):laneLabel(to)}
// v5.1 超额状态机的 UI 侧提示（与 CLI hintText 同源语义；原始错误原文保留，只追加友好提示）
function errorHint(text){
  var t=String(text||'');
  if(/Daily free model limit reached/i.test(t))return '（Cline 免费额度今日已达上限 → 稍后再试，或到「状态」页 Cline 卡换免费模型）';
  if(/Free model promotion ended/i.test(t))return '（该免费模型促销已结束/被轮换下线 → 到「状态」页 Cline 卡换当前免费模型）';
  if(/model not found|not a valid model/i.test(t))return '（模型 id 不存在或已被轮换下线 → 到「状态」页 Cline 卡换当前免费模型）';
  return '';
}
// ---------- 基础工具 ----------
const $=(id)=>document.getElementById(id);
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtMs(ms){return ms==null?'?':(ms/1000).toFixed(1)+'s'}
function baseName(p){const segs=String(p||'').split(BS).join('/').split('/');return segs[segs.length-1]||String(p||'')}
function shortRoot(p){const segs=String(p||'').split(BS);return segs.length>1?'…'+BS+segs[segs.length-1]:String(p||'')}
function copyBtn(t){return '<button class="copybtn" data-copy="'+esc(t)+'">复制</button>'}
function errBox(t){return '<div class="err-box"><span class="etx">'+esc(t)+'</span>'+copyBtn(t)+'</div>'}
async function api(method,url,body){
  const opt={method,headers:{}};
  if(body!==undefined){opt.headers['content-type']='application/json';opt.body=JSON.stringify(body)}
  const r=await fetch(url,opt);
  let j=null;try{j=await r.json()}catch(e){}
  if(!r.ok)throw new Error((j&&j.error)||('HTTP '+r.status));
  return j;
}
// ---------- toast（替代全部 alert；error 常驻+关闭钮） ----------
function toast(msg,type){
  const t=document.createElement('div');
  t.className='toast '+(type||'info');
  t.innerHTML='<span>'+esc(msg)+'</span>'+((type==='error')?'<button class="toast__close" aria-label="关闭">×</button>':'');
  $('toasts').appendChild(t);
  const kill=()=>{t.classList.add('leaving');setTimeout(()=>t.remove(),320)};
  if(type!=='error')setTimeout(kill,4000);
  const c=t.querySelector('.toast__close');if(c)c.onclick=kill;
}
async function copyText(t){
  t=String(t==null?'':t);
  try{await navigator.clipboard.writeText(t);toast('已复制','success')}
  catch(e){
    try{const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('已复制','success')}
    catch(e2){toast('复制失败','error')}
  }
}
// ---------- 极简 markdown 渲染（标题/粗斜体/行内代码/围栏代码/链接/列表/引用；与 v5.2 同源） ----------
function md(src){
  var t=String(src==null?'':src);
  t=esc(t);
  var parts=t.split(/\\x60\\x60\\x60/); // 占位：围栏代码
  var out=[];
  for(var i=0;i<parts.length;i++){
    if(i%2===1){out.push('<pre><code>'+parts[i].replace(/^\\w*\\n/,'')+'</code></pre>');continue}
    var s=parts[i];
    s=s.replace(/^(#{1,4})\\s+(.+)$/gm,function(m,h,txt){return '<h'+h.length+'>'+txt+'</h'+h.length+'>'});
    s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>');
    s=s.replace(/(^|\\W)\\*([^*\\n]+)\\*(?=\\W|$)/g,'$1<i>$2</i>');
    s=s.replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
    s=s.replace(/(^|\\s)\\x60([^\\x60]+)\\x60/g,'$1<code>$2</code>');
    s=s.replace(/^&gt;\\s?(.*)$/gm,'<span class="hint">$1</span>');
    var lines=s.split(/\\n/),buf=[],inUl=false;
    for(var k=0;k<lines.length;k++){
      var L=lines[k];
      var ul=/^\\s*[-*]\\s+/.exec(L);
      var ol=/^\\s*\\d+\\.\\s+/.exec(L);
      if(ul||ol){
        if(!inUl){buf.push('<ul>');inUl=true}
        buf.push('<li>'+L.replace(/^\\s*(?:[-*]|\\d+\\.)\\s+/,'')+'</li>');
      }else{
        if(inUl){buf.push('</ul>');inUl=false}
        if(L.trim()==='')buf.push('');
        else if(/^<h\\d>/.test(L)||/^<(pre|ul|div|span class="hint")/.test(L))buf.push(L);
        else buf.push('<p>'+L+'</p>');
      }
    }
    if(inUl)buf.push('</ul>');
    out.push(buf.join('\\n'));
  }
  return '<div class="md">'+out.join('\\n')+'</div>';
}
// ---------- 全局交互 ----------
document.addEventListener('click',function(e){
  const cb=e.target.closest('.copybtn');
  if(cb){copyText(cb.getAttribute('data-copy'));return}
  const g=e.target.closest('[data-goto-login]');
  if(g){activateTab('login');return}
});
// details 折叠态同步 aria-expanded（toggle 不冒泡，用捕获阶段）
document.addEventListener('toggle',function(e){
  if(e.target&&e.target.tagName==='DETAILS')e.target.setAttribute('aria-expanded',e.target.open?'true':'false');
},true);
function initAria(){
  document.querySelectorAll('details').forEach(function(d){d.setAttribute('aria-expanded',d.open?'true':'false')});
}
function activateTab(name){
  document.querySelectorAll('nav button').forEach(function(b){b.classList.toggle('active',b.dataset.tab===name)});
  document.querySelectorAll('main section').forEach(function(s){s.classList.toggle('on',s.id==='tab-'+name)});
  if(name==='history')loadHistory();
  if(name==='status')loadStatus();
}
document.querySelector('nav').addEventListener('click',function(e){
  const b=e.target.closest('button');if(b&&b.dataset.tab)activateTab(b.dataset.tab);
});
// ---------- 结果 markdown 截断/展开 ----------
function enhanceClamps(root){
  root.querySelectorAll('.mdwrap.clamp').forEach(function(w){
    if(w.dataset.enhanced)return;
    if(w.scrollHeight<=w.clientHeight+4){w.classList.remove('clamp');return}
    w.dataset.enhanced='1';
    const btn=document.createElement('button');
    btn.className='mini expand';btn.textContent='展开全文';
    btn.onclick=function(){
      const clamped=w.classList.toggle('clamp');
      btn.textContent=clamped?'展开全文':'收起';
    };
    w.parentNode.insertBefore(btn,w.nextSibling);
  });
}
// ---------- 通道分级模型（四态形状双编码 + 到期色阶 30/7/0；rank 越小越靠前=异常置顶） ----------
function expiryTier(l){
  const d=l.expiresInDays;
  if(d==null)return null;
  if(d<=0)return{t:'err'};
  if(d<=7)return{t:'warn2',days:d};
  if(d<=30)return{t:'warn',days:d};
  return{t:'ok',days:d};
}
function laneTier(l){
  if(l.disabled)return{rank:3,cls:'neutral',shape:'s-ring',label:'已停用',signal:'已停用'};
  if(l.key==='cline'){
    if(!l.installed)return{rank:3,cls:'absent',shape:'s-ring',label:'未安装（可选）',signal:'未安装'};
    if(!l.credential)return{rank:2,cls:'warn',shape:'s-dia',label:'未登录（OAuth）',signal:'未登录'};
    return{rank:4,cls:'ok',shape:'s-dot',label:'已登录',signal:'已登录'};
  }
  if(!l.ready)return{rank:0,cls:'err',shape:'s-sq',label:'未登录',signal:'未登录'};
  const e=expiryTier(l);
  if(e&&e.t==='err')return{rank:0,cls:'err',shape:'s-sq',label:'已过期',signal:'已过期'};
  if(e&&e.t==='warn2')return{rank:1,cls:'warn2',shape:'s-dia',label:'将过期',signal:e.days+' 天'};
  if(e&&e.t==='warn')return{rank:2,cls:'warn',shape:'s-dia',label:'将到期',signal:e.days+' 天'};
  return{rank:4,cls:'ok',shape:'s-dot',label:'已登录',signal:e?e.days+' 天':'已登录'};
}
const EXP_COLOR={ok:'c-ok',warn:'c-warn',warn2:'c-warn2',err:'c-err'};
// ---------- 状态页 ----------
let CUR=null; // 最近一次 /api/status（停用开关即时写 config 用）
async function loadStatus(){
  try{
    const s=await api('GET','/api/status');
    CUR=s;
    $('hdr-meta').textContent='v'+s.version+' · '+(s.form==='global'?'全局形态':'项目形态')+' · '+shortRoot(s.runtimeRoot);
    $('hdr-meta').title=String(s.runtimeRoot||'');
    $('status-error').style.display='none';
    renderOvw(s);
    $('lane-cards').innerHTML=laneCardsHtml(s);
    renderRoute(s);
  }catch(e){
    $('ovw').style.display='none';
    $('lane-cards').innerHTML='';
    $('status-error-bd').innerHTML=errBox('状态加载失败：'+e.message)+'<div class="row"><button class="btn-ghost" id="status-retry">重试</button></div>';
    $('status-error').style.display='block';
    $('status-retry').onclick=loadStatus;
    $('hdr-meta').textContent='加载失败';
  }
}
function renderOvw(s){
  const tiers=s.lanes.map(laneTier);
  const worst=tiers.reduce(function(m,t){return t.rank<m.rank?t:m},tiers[0]);
  const allOk=worst.rank===4;
  const deg=tiers.filter(function(t){return t.rank===1||t.rank===2}).length;
  const dis=s.lanes.filter(function(l){return l.disabled}).length;
  let txt=(allOk?'一切正常 · ':'')+s.readyCount+' / 3 通道可用';
  if(deg>0)txt+=' · '+deg+' 个降级';
  if(dis>0)txt+=' · '+dis+' 个已停用';
  txt+=' · '+(s.defaultLane==='auto'?'自动路由 → '+laneLabel(s.effectiveLane):'固定路由 '+laneLabel(s.defaultLane));
  const chips=LANE_ORDER_UI.map(function(k){
    const l=s.lanes.find(function(x){return x.key===k});
    const t=laneTier(l);
    const col=t.cls==='absent'?'c-neutral':'c-'+t.cls;
    return '<a class="chip" href="#lane-card-'+k+'" title="跳到 '+esc(laneTitle(k))+' 卡片"><i class="shp '+t.shape+' '+col+'"></i>'+esc(laneLabel(k))+'<span class="sig">'+esc(t.signal)+'</span></a>';
  }).join('');
  const ovw=$('ovw');
  ovw.className='card ovw t-'+(worst.cls==='absent'?'neutral':worst.cls);
  ovw.innerHTML='<span class="concl">'+esc(txt)+'</span><span class="chips">'+chips+'</span>';
  ovw.style.display='flex';
}
function laneCardsHtml(s){
  const lanes=s.lanes.slice().sort(function(a,b){
    const ra=laneTier(a).rank,rb=laneTier(b).rank;
    return (ra-rb)||(LANE_ORDER_UI.indexOf(a.key)-LANE_ORDER_UI.indexOf(b.key));
  });
  return lanes.map(function(l){return l.key==='cline'?clineCardHtml(l,s):wbCardHtml(l)}).join('');
}
function wbCardHtml(l){
  const t=laneTier(l);
  const badge='<span class="badge '+t.cls+'">'+esc(t.label)+'</span>';
  const costCls=l.key==='ai'?'acc':'neutral', costTxt=l.key==='ai'?'免费':'近免费';
  let exp;
  if(!l.expiresAt){exp='<span class="hint">—</span>'}
  else{
    const e=expiryTier(l), d=l.expiresInDays, date=l.expiresAt.slice(0,10);
    let act='';if(d<=0)act=' <button class="mini" data-goto-login="1">重新登录</button>';
    exp='<span class="'+(EXP_COLOR[e.t]||'c-ok')+'">'+(d<=0?'已过期':'约 '+d+' 天后过期')+'（'+date+'）</span>'+act;
  }
  const acct=(l.nickname||'')+(l.uinMasked?(' · uin '+l.uinMasked):'');
  return '<div class="card'+(l.disabled?' off':'')+'" id="lane-card-'+l.key+'">'
    +'<div class="card__hd"><span class="card__title">'+esc(laneTitle(l.key))+'</span>'+badge
    +'<span class="card__sub" title="'+esc(acct)+'">'+esc(acct||'—')+'</span>'
    +'<label class="pwr"><input type="checkbox" class="power" data-lane="'+l.key+'"'+(l.disabled?'':' checked')+' aria-label="启用或停用 '+esc(laneLabel(l.key))+'" title="停用 / 启用此通道（即时写 config）"></label></div>'
    +'<div class="card__bd"><div class="kv">'
    +'<span class="k">成本</span><span class="v"><span class="cost '+costCls+'" title="'+esc(l.cost)+'">'+costTxt+'</span></span>'
    +'<span class="k">模型</span><span class="v"><span class="vtxt">DeepSeek V4.1 Flash</span></span>'
    +'<span class="k">凭证到期</span><span class="v">'+exp+'</span>'
    +'</div>'
    +'<details aria-expanded="false"><summary>详情与排障</summary><div class="dbd"><div class="kv">'
    +'<span class="k">endpoint</span><span class="v"><span class="vtxt" title="'+esc(l.endpoint)+'">'+esc(l.endpoint)+'</span>'+copyBtn(l.endpoint)+'</span>'
    +'<span class="k">登录模板</span><span class="v">'+(l.templateExists?'<span class="badge ok">有</span>':'<span class="badge warn">缺（启动一次桌面版）</span>')+'</span>'
    +'</div></div></details></div></div>';
}
function clineCardHtml(l,s){
  const t=laneTier(l);
  const badge='<span class="badge '+t.cls+'">'+esc(t.label)+'</span>';
  const costTitle='cline-free 孪生，限时轮换+每日配额；计费 id 才按量扣费；免费用量可能被 Cline 用于改进模型（官方披露）';
  const fmList=s.clineFreeModels||[];
  let modelRow, freeRow;
  if(!l.installed){
    modelRow='<span class="vtxt c-warn">未安装（npm install -g cline）</span>';
    freeRow='<span class="hint">—</span>';
  }else{
    modelRow='<span class="vtxt" title="'+esc(l.model||'')+'">'+esc(l.model||'provider 默认')+'</span> <button class="mini mini-open-free" title="在下方详情中选择免费模型">切换</button>';
    freeRow=fmList.length?('<span class="num">'+fmList.length+' 个在档</span>'):('<span class="c-warn">清单不可用</span>');
  }
  let freeSel;
  if(fmList.length){
    const opts=fmList.map(function(fm){
      const cur=(l.model||'')===fm.id;
      return '<option value="'+esc(fm.id)+'"'+(cur?' selected':'')+'>'+esc(fm.id)+(fm.name?(' · '+esc(fm.name)):'')+(fm.deepseek?'':'（非 DeepSeek）')+'</option>';
    }).join('');
    freeSel='<span class="k">免费模型</span><span class="v"><select id="cline-free-select" style="max-width:100%;min-width:220px">'+opts+'</select></span>'
      +'<span class="k">说明</span><span class="v"><span class="hint vtxt">'+esc(s.clineFreeModelsNote||'切换即写 config cline-model')+'</span></span>';
  }else{
    freeSel='<span class="k">免费模型</span><span class="v"><span class="hint vtxt">清单不可用：'+esc(s.clineFreeModelsNote||'未知原因')+'；命令行：wbx models --as cline --free</span></span>';
  }
  const binRow=l.binaryPath
    ?'<span class="vtxt" title="'+esc(l.binaryPath)+'">'+esc(baseName(l.binaryPath))+'</span>'+copyBtn(l.binaryPath)
    :'<span class="hint">未找到（npm install -g cline）</span>';
  const loginCmd='node "%USERPROFILE%'+BS+'.zcode'+BS+'wbx-bridge'+BS+'scripts'+BS+'wbx.mjs" login --identity cline';
  return '<div class="card'+(l.disabled?' off':'')+'" id="lane-card-cline">'
    +'<div class="card__hd"><span class="card__title">'+esc(laneTitle('cline'))+'</span>'+badge
    +'<span class="card__sub">OAuth 设备授权</span>'
    +'<label class="pwr"><input type="checkbox" class="power" data-lane="cline"'+(l.disabled?'':' checked')+' aria-label="启用或停用 Cline" title="停用 / 启用此通道（即时写 config）"></label></div>'
    +'<div class="card__bd"><div class="kv">'
    +'<span class="k">成本</span><span class="v"><span class="cost warn" title="'+esc(costTitle)+'">免费 · 限时配额</span></span>'
    +'<span class="k">模型</span><span class="v">'+modelRow+'</span>'
    +'<span class="k">免费组</span><span class="v">'+freeRow+'</span>'
    +'</div>'
    +'<details aria-expanded="false"><summary>详情与排障</summary><div class="dbd"><div class="kv">'
    +freeSel
    +'<span class="k">思考/压缩</span><span class="v">'+esc(l.thinking)+' / '+esc(l.compaction)+'</span>'
    +'<span class="k">二进制</span><span class="v">'+binRow+'</span>'
    +'<span class="k">登录方式</span><span class="v"><span class="vtxt" title="'+esc(loginCmd)+'">命令行 wbx login --identity cline</span>'+copyBtn(loginCmd)+'</span>'
    +'</div></div></details></div></div>';
}
function renderRoute(s){
  const pill=$('route-pill');
  pill.querySelectorAll('button').forEach(function(b){b.classList.toggle('active',b.dataset.v===s.config['default-lane'])});
  $('route-hint').textContent='当前生效默认路由：'+(s.defaultLane==='auto'?'自动 → '+laneLabel(s.effectiveLane):laneLabel(s.defaultLane))+'；可用通道：'+(s.readyCount>0?s.readyCount+' 个':'0 个');
  const fix=s.config['default-lane'];
  const fixedDisabled=(fix==='ai'||fix==='cn'||fix==='cline')&&(s.lanes.find(function(l){return l.key===fix})||{}).disabled;
  const w=$('route-warn');
  if(fixedDisabled){
    w.style.display='block';
    w.innerHTML='固定路由指向已停用通道「'+esc(laneLabel(fix))+'」——回退链与体检会跳过它；建议改用自动路由，或到通道卡右上角重新启用。';
  }else w.style.display='none';
}
// 通道卡事件（委托：电源开关/免费模型下拉/切换 mini）
$('lane-cards').addEventListener('change',function(e){
  const p=e.target.closest('.power');
  if(p){
    const key=p.dataset.lane;
    const dis=(CUR&&CUR.config&&CUR.config['disabled-lanes']||[]).slice();
    const i=dis.indexOf(key);
    const wantOff=!p.checked;
    if(wantOff&&i<0)dis.push(key);
    if(!wantOff&&i>=0)dis.splice(i,1);
    api('POST','/api/config',{key:'disabled-lanes',value:JSON.stringify(dis)}).then(function(){
      toast(wantOff?('已停用 '+laneLabel(key)+'（即时生效）'):('已启用 '+laneLabel(key)), 'success');
      loadStatus();
    }).catch(function(err){toast('写入失败：'+err.message,'error');loadStatus()});
    return;
  }
  if(e.target.id==='cline-free-select'){
    const sel=e.target;
    api('POST','/api/config',{key:'cline-model',value:sel.value}).then(function(){
      toast('已切换至 '+sel.value+'（config cline-model）','success');
      loadStatus();
    }).catch(function(err){toast('切换失败：'+err.message,'error')});
  }
});
$('lane-cards').addEventListener('click',function(e){
  const m=e.target.closest('.mini-open-free');
  if(m){
    const card=m.closest('.card');
    const det=card&&card.querySelector('details');
    if(det){det.open=true;const sel=det.querySelector('#cline-free-select');if(sel)setTimeout(function(){sel.focus()},60)}
  }
});
$('route-pill').addEventListener('click',function(ev){
  const b=ev.target.closest('button[data-v]');if(!b)return;
  api('POST','/api/config',{key:'default-lane',value:b.dataset.v}).then(loadStatus).catch(function(e){toast('切换失败：'+e.message,'error')});
});
// ---------- 体检卡（空态三要素 + 结果三分组） ----------
function renderDoctorEmpty(){
  let lastTxt='';
  const last=localStorage.getItem('wbx-doctor-last');
  if(last){
    const mins=Math.max(0,Math.round((Date.now()-new Date(last).getTime())/60000));
    lastTxt=mins<1?'刚刚':(mins<60?mins+' 分钟前':(mins<1440?Math.round(mins/60)+' 小时前':Math.round(mins/1440)+' 天前'));
  }
  $('doctor-zone').innerHTML='<div class="empty">'
    +'<div class="e1">尚未体检'+(lastTxt?'<span class="hint"> · 上次 '+lastTxt+'</span>':'')+'</div>'
    +'<div class="e2">对每条通道发起一次真实调用（含模型探测），约 10–30 秒。</div>'
    +'<button class="btn-primary" id="doctor-btn">一键体检</button></div>';
}
async function runDoctor(){
  const z=$('doctor-zone');
  z.innerHTML='<p class="runline"><span class="dot--running"></span>体检中（每通道一次 tiny ask，约 10–30s）…</p>';
  try{
    const d=await api('GET','/api/doctor?probe=1');
    localStorage.setItem('wbx-doctor-last',new Date().toISOString());
    renderDoctor(d);
  }catch(e){z.innerHTML=errBox('体检失败：'+e.message)}
}
function renderDoctor(d){
  const failed=d.steps.filter(function(st){return st.good===false});
  const skipped=d.steps.filter(function(st){return st.good===null});
  const passed=d.steps.filter(function(st){return st.good===true});
  function group(cls,name,arr,open,copyable){
    if(!arr.length)return'';
    const rows=arr.map(function(st){
      return '<div class="dstep"><span class="dn" title="'+esc(st.name)+'">'+esc(st.name)+'</span><span class="dd" title="'+esc(st.detail||'')+'">'+esc(st.detail||'')+'</span>'
        +(copyable?copyBtn(st.name+'：'+(st.detail||'')):'')+'</div>';
    }).join('');
    const cntCls=cls==='dg-err'?'cnt-err':(cls==='dg-ok'?'cnt-ok':'');
    return '<details class="dg '+cls+'"'+(open?' open':'')+'><summary>'+name+' <span class="cnt '+cntCls+'">'+arr.length+'</span></summary><div class="dbd">'+rows+'</div></details>';
  }
  $('doctor-zone').innerHTML='<div class="row" style="margin:0 0 8px"><span class="badge '+(d.ok?'ok':'err')+'">'+(d.ok?'通过':'未通过')+'</span><span class="hint">'+esc(shortRoot(d.runtimeRoot||''))+'</span></div>'
    +group('dg-err','失败',failed,true,true)
    +group('','跳过',skipped,false,false)
    +group('dg-ok','通过',passed,false,false);
}
$('doctor-zone').addEventListener('click',function(e){
  if(e.target.closest('#doctor-btn'))runDoctor();
});
// ---------- job 轮询 ----------
function pollJob(jobId,onDone,onTick){
  const timer=setInterval(function(){
    api('GET','/api/job/'+jobId+'?brief=1').then(function(j){
      if(onTick)onTick(j);
      if(j.status==='done'){clearInterval(timer);api('GET','/api/job/'+jobId).then(onDone)}
    }).catch(function(e){clearInterval(timer);onDone({error:e.message})});
  },1000);
}
function taskHead(r){
  if(!r)return '<span class="badge neutral">无记录</span>';
  return '<span class="badge '+(r.status==='success'?'ok':'err')+'">'+esc(taskStatusLabel(r.status))+'</span>'
    +'<span>通道 <b>'+esc(fallbackText(r.fallbackFrom,r.lane))+'</b></span><span class="num">'+fmtMs(r.durationMs)+'</span>'
    +'<span>Token 数 <span class="num">'+(r.usage&&r.usage.in!=null?r.usage.in:'?')+' / '+(r.usage&&r.usage.out!=null?r.usage.out:'?')+'</span></span>'
    +'<span>尝试 '+r.attempts+'</span><span class="num">'+esc(r.model||'')+'</span>';
}
function taskBody(rec){
  let h='';
  if(rec&&rec.result!=null)h+='<div class="mdwrap clamp">'+md(rec.result)+'</div>';
  if(rec&&rec.error)h+=errBox(rec.error+(errorHint(rec.error)?' '+errorHint(rec.error):''));
  return h;
}
function jobFoot(j){
  return '<div class="hint" style="margin-top:8px">任务 <span class="mono">'+esc(j.id)+'</span> · '+esc(j.dir)+' '+copyBtn('wbx history '+j.id)+'</div>';
}
// ---------- 调用页（模式分段器 + 高级折叠带摘要） ----------
$('run-mode').addEventListener('click',function(e){
  const b=e.target.closest('button[data-v]');if(!b)return;
  $('run-mode').querySelectorAll('button').forEach(function(x){x.classList.toggle('active',x===b)});
  $('ask-pane').style.display=b.dataset.v==='ask'?'block':'none';
  $('fan-pane').style.display=b.dataset.v==='fanout'?'block':'none';
});
$('ask-lane-seg').addEventListener('click',function(e){
  const b=e.target.closest('button[data-v]');if(!b)return;
  $('ask-lane-seg').dataset.v=b.dataset.v;
  $('ask-lane-seg').querySelectorAll('button').forEach(function(x){x.classList.toggle('active',x===b)});
});
function updAskSum(){
  const e=$('ask-effort').value||'默认档';
  const m=$('ask-model').value.trim()||'自动模型';
  const t=parseInt($('ask-timeout').value,10)||300;
  $('ask-adv-sum').textContent=e+' · '+m+' · '+t+'s';
}
['ask-effort','ask-model','ask-timeout'].forEach(function(id){$(id).addEventListener('input',updAskSum);$(id).addEventListener('change',updAskSum)});
function updFanSum(){
  const p=parseInt($('fan-parallel').value,10)||2;
  const t=parseInt($('fan-timeout').value,10)||300;
  $('fan-adv-sum').textContent='并发 '+p+' · '+t+'s';
}
['fan-parallel','fan-timeout'].forEach(function(id){$(id).addEventListener('input',updFanSum);$(id).addEventListener('change',updFanSum)});
$('ask-btn').onclick=function(){
  const btn=this,prompt=$('ask-prompt').value.trim();
  if(!prompt){toast('请输入提示词','error');return}
  btn.disabled=true;
  $('run-out').innerHTML='<p class="runline"><span class="dot--running"></span>执行中…</p>';
  api('POST','/api/ask',{prompt:prompt,lane:$('ask-lane-seg').dataset.v||undefined,effort:$('ask-effort').value||undefined,
    model:$('ask-model').value.trim()||undefined,
    timeout:parseInt($('ask-timeout').value,10)||300}).then(function(r){
    pollJob(r.jobId,function(j){
      btn.disabled=false;
      const rec=j.tasks&&j.tasks[0]&&j.tasks[0].record;
      let h='<div class="task-card"><div class="hd">'+taskHead(rec)+'</div>';
      if(j.error)h+=errBox(j.error);
      h+=taskBody(rec)+jobFoot(j)+'</div>';
      $('run-out').innerHTML=h;
      enhanceClamps($('run-out'));
    },function(j){
      $('run-out').innerHTML='<p class="runline"><span class="dot--running"></span>执行中… '+(j.done||0)+'/'+(j.total||'?')+'</p>';
    });
  }).catch(function(e){btn.disabled=false;$('run-out').innerHTML=errBox(e.message)});
};
// ---------- 批量并行 ----------
let fanRows=[];
function addFanRow(id,prompt,lane){
  fanRows.push({id:id||('task-'+(fanRows.length+1)),prompt:prompt||'',lane:lane||''});
  renderFanRows();
}
function renderFanRows(){
  let h='';
  for(let i=0;i<fanRows.length;i++){
    const r=fanRows[i];
    h+='<div class="fan-row">'
      +'<input type="text" data-i="'+i+'" data-f="id" value="'+esc(r.id)+'" placeholder="任务 ID">'
      +'<select data-i="'+i+'" data-f="lane"><option value="">自动</option><option value="ai"'+(r.lane==='ai'?' selected':'')+'>WorkBuddy AI</option><option value="cn"'+(r.lane==='cn'?' selected':'')+'>WorkBuddy</option><option value="cline"'+(r.lane==='cline'?' selected':'')+'>Cline</option></select>'
      +'<textarea data-i="'+i+'" data-f="prompt" style="min-height:44px" placeholder="worker 提示词">'+esc(r.prompt)+'</textarea>'
      +'<button class="fan-del" data-del="'+i+'" title="删除此任务行">×</button></div>';
  }
  $('fan-rows').innerHTML=h||'<p class="hint">（还没有任务行，点「+ 添加任务行」）</p>';
  $('fan-rows').querySelectorAll('[data-f]').forEach(function(el){
    el.oninput=function(){fanRows[+el.dataset.i][el.dataset.f]=el.value};
  });
  $('fan-rows').querySelectorAll('[data-del]').forEach(function(el){
    el.onclick=function(){fanRows.splice(+el.dataset.del,1);renderFanRows()};
  });
}
$('fan-add').onclick=function(){addFanRow()};
$('fan-btn').onclick=function(){
  const btn=this;
  const tasks=[];
  for(let i=0;i<fanRows.length;i++){
    const p=(fanRows[i].prompt||'').trim();
    if(!p)continue;
    tasks.push({id:fanRows[i].id||('task-'+(i+1)),prompt:p,as:fanRows[i].lane||undefined});
  }
  if(!tasks.length){toast('至少要有一行带提示词的任务','error');return}
  btn.disabled=true;
  $('run-out').innerHTML='<p class="runline"><span class="dot--running"></span>执行中…</p>';
  api('POST','/api/fanout',{tasks:tasks,parallel:parseInt($('fan-parallel').value,10)||undefined,
    timeout:parseInt($('fan-timeout').value,10)||undefined}).then(function(r){
    pollJob(r.jobId,function(j){
      btn.disabled=false;
      let h='<p class="runline">完成：成功 <b class="num">'+(j.ok==null?'?':j.ok)+'</b> / '+(j.total==null?'?':j.total)+'</p>';
      (j.tasks||[]).forEach(function(task){
        h+='<div class="task-card"><details><summary>任务 '+esc(task.id)+' · 提示词</summary><div class="dbd"><pre>'+esc(task.prompt||'')+'</pre></div></details>'
          +'<div class="hd">'+taskHead(task.record)+'</div>'+taskBody(task.record)+'</div>';
      });
      if(j.error)h+=errBox(j.error);
      h+=jobFoot(j);
      $('run-out').innerHTML=h;
      enhanceClamps($('run-out'));
    },function(j){
      $('run-out').innerHTML='<p class="runline"><span class="dot--running"></span>执行中… 完成 '+(j.done||0)+'/'+(j.total||'?')+'</p>';
    });
  }).catch(function(e){btn.disabled=false;$('run-out').innerHTML=errBox(e.message)});
};
// ---------- 历史（徽标化 + ID 可复制 + 手风琴单开） ----------
async function loadHistory(){
  try{
    const h=await api('GET','/api/history');
    $('hist-count').textContent='共 '+h.jobs.length+' 条';
    const tb=$('hist-table').querySelector('tbody');
    tb.innerHTML='';
    h.jobs.forEach(function(j){
      const tr=document.createElement('tr');
      tr.dataset.id=j.id;
      const when=j.createdAt?new Date(j.createdAt).toLocaleString('zh-CN',{hour12:false}):j.id;
      const tcls=j.type==='ask'?'acc':'neutral';
      tr.innerHTML='<td>'+esc(when)+'</td><td><span class="badge '+tcls+'">'+esc(typeLabel(j.type,j.legacy))+'</span></td>'
        +'<td class="num">'+(j.total==null?'?':j.total)+'</td><td class="num">'+(j.successRate==null?'?':j.successRate+'%')+'</td>'
        +'<td class="mono" title="点击复制 · wbx history 可回放">'+esc(j.id)+'</td>';
      tb.appendChild(tr);
    });
    if(!h.jobs.length)tb.innerHTML='<tr><td colspan="5" class="hint" style="padding:16px">（空）</td></tr>';
  }catch(e){toast('历史加载失败：'+e.message,'error')}
}
$('hist-refresh').onclick=loadHistory;
$('hist-table').addEventListener('click',function(e){
  const tr=e.target.closest('tr[data-id]');if(!tr)return;
  if(e.target.closest('td.mono')){copyText(tr.dataset.id);return}
  toggleJob(tr.dataset.id);
});
let openJobId=null;
async function toggleJob(id){
  const box=$('job-detail');
  if(openJobId===id){box.style.display='none';openJobId=null;return}
  try{
    const j=await api('GET','/api/job/'+id);
    openJobId=id;
    const dist=Object.keys(j.laneDist||{}).map(function(k){return esc(laneLabel(k))+'×'+j.laneDist[k]}).join('、')||'—';
    let h='<div class="card__hd"><span class="card__title">任务 '+esc(j.id)+'</span>'
      +'<span class="badge '+(j.status==='done'?'ok':'acc run')+'">'+esc(jobStatusLabel(j.status))+'</span>'
      +'<span class="card__sub">'+esc(typeLabel(j.type,j.legacy))+(j.legacy?'（旧 tasks/ 兼容）':'')+'</span>'
      +'<span class="right hint">再点表行可收起</span></div>'
      +'<div class="card__bd">'
      +'<div class="sect">概览</div>'
      +'<div class="kv">'
      +'<span class="k">状态</span><span class="v">'+esc(jobStatusLabel(j.status))+'</span>'
      +'<span class="k">成功率</span><span class="v">'+(j.successRate==null?'?':j.successRate+'%')+'</span>'
      +'<span class="k">通道分布</span><span class="v"><span class="vtxt">'+dist+'</span></span>'
      +'<span class="k">目录</span><span class="v"><span class="vtxt" title="'+esc(j.dir)+'">'+esc(j.dir)+'</span>'+copyBtn(j.dir)+'</span>'
      +'</div>'
      +'<div class="sect">任务</div>';
    (j.tasks||[]).forEach(function(task){
      h+='<div class="task-card"><details><summary>任务 '+esc(task.id)+' · 提示词</summary><div class="dbd"><pre>'+esc(task.prompt||'（无 tasks-input，旧格式）')+'</pre></div></details>'
        +'<div class="hd">'+taskHead(task.record)+'</div>'+taskBody(task.record)+'</div>';
    });
    h+='<div class="sect">产物</div>';
    if(j.summaryMd)h+='<details aria-expanded="false"><summary>summary.md</summary><div class="dbd"><pre>'+esc(j.summaryMd)+'</pre></div></details>';
    h+='<div class="copyline"><span class="t">wbx history '+esc(j.id)+'（CLI 回放）</span>'+copyBtn('wbx history '+j.id)+'</div>';
    h+='</div>';
    box.innerHTML=h;
    box.style.display='block';
    enhanceClamps(box);
  }catch(e){toast(e.message,'error')}
}
// ---------- 登录（状态内联：按钮 disabled + spinner + 文案） ----------
let loginTimer=null;
function setLoginBusy(busy){
  ['login-ai','login-cn'].forEach(function(id){
    const b=$(id);b.disabled=busy;
    const sp=b.querySelector('.spin');if(sp)sp.hidden=!busy;
  });
}
function startLoginUi(lane){
  if(loginTimer){clearInterval(loginTimer);loginTimer=null}
  setLoginBusy(true);
  $('login-out').innerHTML='<p class="runline"><span class="dot--running"></span>正在申请登录…</p>';
  api('POST','/api/login/start',{lane:lane}).then(function(r){
    let h='<p>在浏览器完成登录（点击打开）：</p><p><a href="'+esc(r.authUrl)+'" target="_blank" rel="noopener">'+esc(r.authUrl)+'</a></p>';
    if(r.tips&&r.tips.length){
      h+='<p class="hint">遇到「登录失败」页时，把下面整行 URL 复制到地址栏回车：</p>';
      r.tips.forEach(function(tp){h+='<div class="copyline"><span class="t">'+esc(tp)+'</span>'+copyBtn(tp)+'</div>'});
    }
    h+='<p id="login-status" class="runline"><span class="dot--running"></span>等待登录完成（每 2s 轮询，最长 5 分钟）…</p>';
    $('login-out').innerHTML=h;
    loginTimer=setInterval(function(){
      api('GET','/api/login/poll').then(function(p){
        const el=$('login-status');
        if(!el){clearInterval(loginTimer);loginTimer=null;setLoginBusy(false);return}
        if(p.status==='pending'){el.innerHTML='<span class="dot--running"></span>等待登录完成…（'+Math.round((Date.now()-p.startedAt)/1000)+'s）';return}
        clearInterval(loginTimer);loginTimer=null;setLoginBusy(false);
        if(p.status==='done'){
          el.innerHTML='<span class="badge ok">登录成功</span> 通道 '+esc(laneLabel(p.lane))+'（'+esc(p.nickname||'')+'）· <a href="#" id="login-reload">刷新状态</a>';
          const rl=$('login-reload');if(rl)rl.onclick=function(e){e.preventDefault();loadStatus();activateTab('status')};
        }else if(p.status==='timeout'){
          el.innerHTML='<span class="badge err">超时未完成</span> 请重新发起登录';
        }else{
          el.innerHTML='<span class="badge err">出错</span> '+esc(p.error||'');
        }
      }).catch(function(){});
    },2000);
  }).catch(function(e){setLoginBusy(false);$('login-out').innerHTML=errBox(e.message)});
}
$('login-ai').onclick=function(){startLoginUi('ai')};
$('login-cn').onclick=function(){startLoginUi('cn')};
// ---------- 启动 ----------
initAria();
loadStatus();
renderDoctorEmpty();
addFanRow('task-1','');
addFanRow('task-2','');
updAskSum();
updFanSum();
</script>
</body>
</html>
`;

// ---------- 登录服务端状态（内存，单登录流） ----------
const loginState = { status: 'idle', lane: null, startedAt: null, error: null, nickname: null };

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

async function handler(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  try {
    // 安全校验（v5.2）：Host 白名单防 DNS rebinding；POST 一律校验 Origin（同源或空）
    if (!hostHeaderAllowed(req.headers.host, LISTEN_PORT)) {
      return sendJson(res, 403, { error: 'Host 头不允许（本控制台仅限 127.0.0.1 / localhost 访问）' });
    }
    if (req.method === 'POST' && !originAllowed(req.headers.origin, LISTEN_PORT)) {
      return sendJson(res, 403, { error: 'Origin 不允许（本控制台仅限同源访问）' });
    }
    if (req.method === 'GET' && p === '/__health') {
      sendJson(res, 200, { app: 'wbx-ui', pid: process.pid, port: LISTEN_PORT, version: WBX_VERSION });
      return;
    }
    if (req.method === 'POST' && p === '/__shutdown') {
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
      return;
    }
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(HTML);
      return;
    }
    if (req.method === 'GET' && p === '/api/status') {
      ensureDirs();
      const cfg = loadConfig();
      const lanes = LANE_ORDER.map((k) => laneStatusInfo(k));
      // v5.1：cline 免费模型组（server 侧调 recommended-models，失败降级缓存/空数组+提示）
      let clineFreeModels = [];
      let clineFreeModelsNote = '';
      {
        const fm = await fetchClineFreeModels();
        if (fm.ok && fm.models.length) {
          clineFreeModels = fm.models.map((m) => ({ id: m.id, name: m.name, description: m.description, deepseek: /deepseek/i.test(m.id) }));
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
      return;
    }
    if (req.method === 'GET' && p === '/api/doctor') {
      const probe = u.searchParams.get('probe') === '1';
      const d = await doctorStatus({ probe, onLine: null });
      sendJson(res, 200, d);
      return;
    }
    if (req.method === 'GET' && p === '/api/history') {
      sendJson(res, 200, { jobs: listJobs() });
      return;
    }
    let m;
    if (req.method === 'GET' && (m = /^\/api\/job\/([A-Za-z0-9_-]+)$/.exec(p))) {
      const j = await getJob(m[1]);
      if (!j) return sendJson(res, 404, { error: `任务 ${m[1]} 不存在` });
      if (u.searchParams.get('brief') === '1') return sendJson(res, 200, briefJob(j));
      sendJson(res, 200, j);
      return;
    }
    if (req.method === 'POST' && p === '/api/ask') {
      const b = await readBody(req);
      const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
      if (!prompt) return sendJson(res, 400, { error: '缺少提示词（prompt）' });
      let as = null;
      if (b.lane && b.lane !== 'auto') {
        as = parseLane(b.lane);
        if (!as) return sendJson(res, 400, { error: `lane 取值只支持 auto|ai|cn|cline（ai=WorkBuddy AI，cn=WorkBuddy，cline=Cline；收到 ${b.lane}）` });
      }
      const jobId = newJobId();
      runAskJob({
        prompt, as,
        model: typeof b.model === 'string' && b.model ? b.model : null,
        effort: typeof b.effort === 'string' && b.effort ? b.effort : null,
        timeoutS: Number(b.timeout) > 0 ? Number(b.timeout) : 300,
        jobId,
      }).catch((e) => writeFailedJob(jobId, e.message));
      sendJson(res, 200, { jobId });
      return;
    }
    if (req.method === 'POST' && p === '/api/fanout') {
      const b = await readBody(req);
      if (!Array.isArray(b.tasks) || !b.tasks.length) return sendJson(res, 400, { error: 'tasks 需为非空数组' });
      const tasksIn = b.tasks.map((t, i) => ({
        id: t.id || `task-${i + 1}`,
        prompt: String(t.prompt || ''),
        as: t.as || null,
        effort: t.effort || null,
        model: t.model || null,
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
        timeoutS: Number(b.timeout) > 0 ? Number(b.timeout) : 300,
        retry: Number.isInteger(b.retry) && b.retry >= 0 ? b.retry : null,
        jobId,
      }).catch((e) => writeFailedJob(jobId, e.message));
      sendJson(res, 200, { jobId });
      return;
    }
    if (req.method === 'POST' && p === '/api/config') {
      const b = await readBody(req);
      if (!b.key || !Object.prototype.hasOwnProperty.call(CONFIG_DEFS, b.key)) return sendJson(res, 400, { error: `未知配置键 ${b.key}` });
      try {
        const r = await setConfig(b.key, b.value === undefined ? '' : String(b.value));
        sendJson(res, 200, { ok: true, key: r.key, value: r.value });
      } catch (e) {
        sendJson(res, 400, { error: e.message });
      }
      return;
    }
    if (req.method === 'POST' && p === '/api/login/start') {
      const b = await readBody(req);
      const lane = parseLane(b.lane);
      if (!lane) return sendJson(res, 400, { error: 'lane 只支持 ai|cn' });
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
      return;
    }
    if (req.method === 'GET' && p === '/api/login/poll') {
      const out = { status: loginState.status, lane: loginState.lane, startedAt: loginState.startedAt, error: loginState.error, nickname: loginState.nickname };
      sendJson(res, 200, out);
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
