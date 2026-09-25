/**
 * wbx-ui — wbx 桥本地 Web UI（v3 Phase 3）
 *
 * 零第三方依赖（原生 node:http），只监听 127.0.0.1，内嵌单页前端（HTML/CSS/vanilla JS，
 * 不引任何外部 CDN，离线可用）。`wbx ui` 启动后自动开浏览器，Ctrl+C 即退，无常驻服务。
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
 *
 * 红线：任何响应绝不包含 accessToken/refreshToken（laneStatusInfo 只产昵称/脱敏 uin/到期）。
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  WBX_VERSION, RUNTIME_ROOT, JOBS_DIR,
  LANE_ORDER, CONFIG_DEFS, bridgeForm,
  redact, loadConfig, setConfig, parseLane,
  laneStatusInfo, resolveDefaultLane, newJobId, getJob, listJobs,
  runAskJob, runFanoutJob, doctorStatus,
  startLogin, pollLoginToken, fetchAccountInfo, persistLogin,
  openBrowser, ensureDirs,
} from './wbx-core.mjs';

// ---------- 内嵌前端（单文件，无外部资源） ----------
const HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>wbx 桥控制台</title>
<style>
:root{
  --bg:#0f1117;--panel:#171a23;--panel2:#1e2230;--line:#2a2f40;
  --fg:#e6e9f2;--dim:#9aa3b8;--acc:#5b8cff;--ok:#3ecf8e;--warn:#f0b429;--err:#ff6b6b;
  --mono:Consolas,Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.65 "Segoe UI",system-ui,sans-serif}
header{padding:14px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;flex-wrap:wrap}
header h1{font-size:17px;margin:0}
header .meta{color:var(--dim);font-size:12px}
nav{margin-left:auto;display:flex;gap:6px}
nav button{background:var(--panel2);border:1px solid var(--line);color:var(--dim);padding:7px 14px;border-radius:8px;cursor:pointer;font-size:13px}
nav button.on{color:#fff;border-color:var(--acc);background:rgba(91,140,255,.15)}
main{padding:20px 22px;max-width:1100px;margin:0 auto}
section{display:none}
section.on{display:block}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:14px}
.card h3{margin:0 0 10px;font-size:14px;color:#c7cfe0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.badge{display:inline-block;padding:1px 9px;border-radius:10px;font-size:12px;margin-right:6px}
.badge.ok{background:rgba(62,207,142,.15);color:var(--ok)}
.badge.err{background:rgba(255,107,107,.15);color:var(--err)}
.badge.dim{background:rgba(154,163,184,.15);color:var(--dim)}
.badge.warn{background:rgba(240,180,41,.15);color:var(--warn)}
.kv{display:grid;grid-template-columns:130px 1fr;gap:3px 10px;font-size:13px}
.kv b{color:var(--dim);font-weight:500}
pre{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow:auto;font-size:12.5px;font-family:var(--mono)}
textarea,input[type=text],select{width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:8px 10px;font-size:13px;font-family:inherit}
textarea{min-height:110px;resize:vertical;font-family:var(--mono);font-size:12.5px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}
.row label{color:var(--dim);font-size:13px}
button.primary{background:var(--acc);border:none;color:#fff;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px}
button.primary:disabled{opacity:.5;cursor:wait}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--dim);padding:6px 14px;border-radius:8px;cursor:pointer;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500;cursor:pointer}
tr.clickable{cursor:pointer}
tr.clickable:hover{background:rgba(91,140,255,.07)}
.pill{display:inline-flex;gap:4px;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:3px}
.pill button{background:transparent;border:none;color:var(--dim);padding:3px 12px;border-radius:6px;cursor:pointer;font-size:12.5px}
.pill button.on{background:var(--acc);color:#fff}
.switch{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--dim);cursor:pointer}
.task-card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--panel2)}
.task-card .hd{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12.5px;color:var(--dim)}
.md{font-size:13.5px}
.md h1,.md h2,.md h3{margin:.7em 0 .35em;font-size:1.05em}
.md pre{margin:.5em 0}
.md code{background:var(--panel2);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:.92em}
.md pre code{background:none;padding:0}
.md ul{margin:.4em 0;padding-left:1.4em}
.md a{color:var(--acc)}
details{margin:6px 0}
summary{cursor:pointer;color:var(--dim);font-size:12.5px}
.spin{display:inline-block;width:13px;height:13px;border:2px solid var(--dim);border-top-color:var(--acc);border-radius:50%;animation:sp 1s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
.hint{color:var(--dim);font-size:12.5px}
.fan-row{display:grid;grid-template-columns:150px 90px 1fr 34px;gap:8px;margin-bottom:8px}
.fan-row input,.fan-row select{padding:6px 8px}
.err-box{background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.4);border-radius:8px;padding:10px 12px;color:#ffb3b3;font-size:13px;white-space:pre-wrap}
a{color:var(--acc)}
.copyline{font-family:var(--mono);font-size:12px;word-break:break-all;background:var(--panel2);border-radius:6px;padding:8px 10px;margin:4px 0}
</style>
</head>
<body>
<header>
  <h1>wbx 桥控制台</h1>
  <span class="meta" id="hdr-meta">加载中…</span>
  <nav>
    <button data-tab="status" class="on">状态</button>
    <button data-tab="run">调用</button>
    <button data-tab="history">历史</button>
    <button data-tab="login">登录</button>
  </nav>
</header>
<main>

<section id="tab-status" class="on">
  <div class="grid2" id="lane-cards"></div>
  <div class="card">
    <h3>路由</h3>
    <div class="row">
      <span class="pill" id="route-pill">
        <button data-v="auto">auto（ai 免费优先）</button>
        <button data-v="ai">固定 ai</button>
        <button data-v="cn">固定 cn</button>
        <button data-v="cline">固定 cline</button>
      </span>
      <label class="switch"><input type="checkbox" id="dis-ai"> 禁用 ai</label>
      <label class="switch"><input type="checkbox" id="dis-cn"> 禁用 cn</label>
      <label class="switch"><input type="checkbox" id="dis-cline"> 禁用 cline</label>
      <span class="hint" id="route-hint"></span>
    </div>
    <div class="hint">写 <b>config.json</b>（default-lane / disabled-lanes），doctor、ask、fanout、回退链即时生效。</div>
  </div>
  <div class="card">
    <h3>体检（doctor）</h3>
    <div class="row"><button class="primary" id="doctor-btn">一键体检（含模型探测，约 10-30s）</button></div>
    <div id="doctor-out"></div>
  </div>
</section>

<section id="tab-run">
  <div class="card">
    <h3>ask 单条调用</h3>
    <textarea id="ask-prompt" placeholder="提示词（完整 worker 提示词：角色+任务+材料+输出硬约束+无工具声明）"></textarea>
    <div class="row">
      <label>lane
        <select id="ask-lane" style="width:110px">
          <option value="">auto</option><option value="ai">ai</option><option value="cn">cn</option><option value="cline">cline</option>
        </select></label>
      <label>effort
        <select id="ask-effort" style="width:110px">
          <option value="">默认</option><option>low</option><option>medium</option><option>high</option>
        </select></label>
      <label>model <input type="text" id="ask-model" placeholder="默认取 config.model" style="width:170px"></label>
      <label>超时(s) <input type="text" id="ask-timeout" value="300" style="width:70px"></label>
      <button class="primary" id="ask-btn">执行 ask</button>
    </div>
    <div id="ask-out"></div>
  </div>
  <div class="card">
    <h3>fanout 批量并行</h3>
    <div id="fan-rows"></div>
    <div class="row">
      <button class="ghost" id="fan-add">+ 添加任务行</button>
      <label>每 lane 并发 <input type="text" id="fan-parallel" value="2" style="width:60px"></label>
      <label>超时(s) <input type="text" id="fan-timeout" value="300" style="width:70px"></label>
      <button class="primary" id="fan-btn">执行 fanout</button>
    </div>
    <div id="fan-out"></div>
  </div>
</section>

<section id="tab-history">
  <div class="card">
    <h3>job 历史（新 jobs/ + 旧 tasks/ 兼容）</h3>
    <div class="row"><button class="ghost" id="hist-refresh">刷新</button><span class="hint" id="hist-count"></span></div>
    <div style="overflow:auto"><table id="hist-table">
      <thead><tr><th>时间</th><th>类型</th><th>任务数</th><th>成功率</th><th>lane 分布</th><th>jobId</th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>
  <div class="card" id="job-detail" style="display:none"></div>
</section>

<section id="tab-login">
  <div class="card">
    <h3>登录引导（WorkBuddy SSO 凭证约 55 天有效）</h3>
    <div class="row">
      <button class="primary" id="login-cn">开始登录 cn（国内版·微信扫码）</button>
      <button class="primary" id="login-ai">开始登录 ai（国际版·邮箱/OneID）</button>
    </div>
    <div id="login-out"></div>
  </div>
  <div class="card">
    <h3>cline lane（可选·OAuth 设备授权）</h3>
    <p class="hint">cline 登录是设备码流程，需在终端里跑（浏览器完成授权，凭证落隔离目录 <b>&lt;运行时根&gt;/cline-home/</b>，与用户 ~/.cline 无关）：</p>
    <div class="copyline">node "%USERPROFILE%\.zcode\wbx-bridge\scripts\wbx.mjs" login --identity cline</div>
    <p class="hint">登录后可用 config 设置 cline-model / cline-thinking（默认 xhigh）/ cline-compaction（默认 off）/ cline-parallel（默认 1）。</p>
  </div>
</section>

</main>
<script>
'use strict';
// ---------- 基础工具 ----------
function $(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtMs(ms){return ms==null?'?':(ms/1000).toFixed(1)+'s'}
async function api(method,url,body){
  const opt={method,headers:{}};
  if(body!==undefined){opt.headers['content-type']='application/json';opt.body=JSON.stringify(body)}
  const r=await fetch(url,opt);
  let j=null;try{j=await r.json()}catch(e){}
  if(!r.ok)throw new Error((j&&j.error)||('HTTP '+r.status));
  return j;
}
// 极简 markdown 渲染（标题/粗斜体/行内代码/围栏代码/链接/列表/引用/表格透传为文本）
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
function taskHead(r){
  if(!r)return '<span class="badge dim">无记录</span>';
  var lane=r.fallbackFrom?(r.fallbackFrom+' → '+r.lane):r.lane;
  return '<span class="badge '+(r.status==='success'?'ok':'err')+'">'+esc(r.status)+'</span>'
    +'<span>lane <b>'+esc(lane)+'</b></span><span>'+fmtMs(r.durationMs)+'</span>'
    +'<span>tokens '+(r.usage&&r.usage.in!=null?r.usage.in:'?')+' / '+(r.usage&&r.usage.out!=null?r.usage.out:'?')+'</span>'
    +'<span>尝试 '+r.attempts+'</span><span>'+esc(r.model||'')+'</span>';
}
// ---------- tab 切换 ----------
var tabs=document.querySelectorAll('nav button');
for(var ti=0;ti<tabs.length;ti++)tabs[ti].onclick=function(){
  for(var j=0;j<tabs.length;j++)tabs[j].classList.remove('on');
  this.classList.add('on');
  var secs=document.querySelectorAll('main section');
  for(var k=0;k<secs.length;k++)secs[k].classList.remove('on');
  $('tab-'+this.dataset.tab).classList.add('on');
  if(this.dataset.tab==='history')loadHistory();
  if(this.dataset.tab==='status')loadStatus();
};
// ---------- 状态 ----------
async function loadStatus(){
  try{
    var s=await api('GET','/api/status');
    $('hdr-meta').textContent='v'+s.version+' · '+(s.form==='global'?'全局形态':'项目形态')+' · '+s.runtimeRoot;
    var lanesHtml='';
    for(var i=0;i<s.lanes.length;i++){
      var l=s.lanes[i];
      if(l.key==='cline'){
        var cState=l.disabled?'<span class="badge warn">已禁用</span>'
          :!l.installed?'<span class="badge dim">未安装（可选）</span>'
          :!l.credential?'<span class="badge warn">未登录（OAuth）</span>'
          :'<span class="badge ok">已登录</span>';
        lanesHtml+='<div class="card"><h3>lane cline · Cline CLI（可选） '+cState+'</h3>'
          +'<div class="kv">'
          +'<b>成本</b><span>按量微付费（实测单次 $0.0003-0.004）</span>'
          +'<b>模型</b><span>'+esc(l.model||'provider 默认')+'</span>'
          +'<b>思考/压缩</b><span>'+esc(l.thinking)+' / '+esc(l.compaction)+'</span>'
          +'<b>二进制</b><span>'+esc(l.binaryPath||'未找到（npm install -g cline）')+'</span>'
          +'<b>登录方式</b><span>命令行 wbx login --identity cline（浏览器 OAuth 设备授权）</span>'
          +'</div></div>';
        continue;
      }
      var stateBadge=l.disabled?'<span class="badge warn">已禁用</span>'
        :(l.ready?'<span class="badge ok">已登录</span>':'<span class="badge err">未登录</span>');
      var exp=l.expiresAt?('约 <b>'+l.expiresInDays+'</b> 天后过期（'+l.expiresAt.slice(0,10)+'）'):'—';
      lanesHtml+='<div class="card"><h3>lane '+esc(l.key)+' · '+esc(l.label)+' '+stateBadge+'</h3>'
        +'<div class="kv">'
        +'<b>成本</b><span>'+esc(l.cost)+'</span>'
        +'<b>账号</b><span>'+esc(l.nickname||'—')+(l.uinMasked?(' · uin '+esc(l.uinMasked)):'')+'</span>'
        +'<b>凭证到期</b><span>'+exp+'</span>'
        +'<b>endpoint</b><span>'+esc(l.endpoint)+'</span>'
        +'<b>登录模板</b><span>'+(l.templateExists?'<span class="badge ok">有</span>':'<span class="badge warn">缺（启动一次桌面版）</span>')+'</span>'
        +'</div></div>';
    }
    $('lane-cards').innerHTML=lanesHtml;
    var pill=$('route-pill'),btns=pill.querySelectorAll('button');
    for(var b=0;b<btns.length;b++)btns[b].classList.toggle('on',btns[b].dataset.v===s.config['default-lane']);
    $('dis-ai').checked=s.config['disabled-lanes'].indexOf('ai')>=0;
    $('dis-cn').checked=s.config['disabled-lanes'].indexOf('cn')>=0;
    $('route-hint').textContent='当前生效默认路由：'+(s.defaultLane==='auto'?'auto → '+s.effectiveLane:s.defaultLane)
      +'；可用 lane：'+(s.readyCount>0?s.readyCount+' 个':'0 个');
  }catch(e){$('hdr-meta').textContent='加载失败：'+e.message}
}
$('route-pill').onclick=function(ev){
  var v=ev.target.dataset&&ev.target.dataset.v;if(!v)return;
  api('POST','/api/config',{key:'default-lane',value:v}).then(loadStatus).catch(function(e){alert(e.message)});
};
function onDisChange(){
  var dis=[];
  if($('dis-ai').checked)dis.push('ai');
  if($('dis-cn').checked)dis.push('cn');
  if($('dis-cline').checked)dis.push('cline');
  api('POST','/api/config',{key:'disabled-lanes',value:JSON.stringify(dis)}).then(loadStatus).catch(function(e){alert(e.message)});
}
$('dis-ai').onchange=onDisChange;$('dis-cn').onchange=onDisChange;$('dis-cline').onchange=onDisChange;
$('doctor-btn').onclick=function(){
  var btn=this;btn.disabled=true;
  $('doctor-out').innerHTML='<p><span class="spin"></span>体检中（每 lane 一次 tiny ask，约 10-30s）…</p>';
  api('GET','/api/doctor?probe=1').then(function(d){
    btn.disabled=false;
    var h='<p>'+(d.ok?'<span class="badge ok">通过</span>':'<span class="badge err">未通过</span>')
      +' 运行时 '+esc(d.runtimeRoot)+'</p><pre>';
    for(var i=0;i<d.steps.length;i++){
      var st=d.steps[i];
      h+=(st.good===null?'[SKIP] ':st.good?'[OK]   ':'[FAIL] ')+st.name+'  '+st.detail+'\\n';
    }
    h+='</pre>';
    $('doctor-out').innerHTML=h;
  }).catch(function(e){btn.disabled=false;$('doctor-out').innerHTML='<div class="err-box">'+esc(e.message)+'</div>'});
};
// ---------- job 轮询 ----------
function pollJob(jobId,onDone,onTick){
  var timer=setInterval(function(){
    api('GET','/api/job/'+jobId+'?brief=1').then(function(j){
      if(onTick)onTick(j);
      if(j.status==='done'){clearInterval(timer);api('GET','/api/job/'+jobId).then(onDone)}
    }).catch(function(e){clearInterval(timer);onDone({error:e.message})});
  },1000);
}
// ---------- ask ----------
$('ask-btn').onclick=function(){
  var btn=this,prompt=$('ask-prompt').value.trim();
  if(!prompt){alert('请输入提示词');return}
  btn.disabled=true;
  $('ask-out').innerHTML='<p><span class="spin"></span>执行中…</p>';
  api('POST','/api/ask',{prompt:prompt,lane:$('ask-lane').value||undefined,effort:$('ask-effort').value||undefined,
    model:$('ask-model').value.trim()||undefined,
    timeout:parseInt($('ask-timeout').value,10)||300}).then(function(r){
    pollJob(r.jobId,function(j){
      btn.disabled=false;
      var rec=j.tasks&&j.tasks[0]&&j.tasks[0].record;
      var h='<div class="task-card"><div class="hd">'+taskHead(rec)+'</div>';
      if(j.error)h+='<div class="err-box">'+esc(j.error)+'</div>';
      if(rec&&rec.result!=null)h+=md(rec.result);
      if(rec&&rec.error)h+='<div class="err-box">'+esc(rec.error)+'</div>';
      h+='<div class="hint">job '+esc(j.id)+' · '+esc(j.dir)+'（wbx history '+esc(j.id)+' 可回放）</div></div>';
      $('ask-out').innerHTML=h;
    },function(j){
      $('ask-out').innerHTML='<p><span class="spin"></span>执行中… '+(j.done||0)+'/'+(j.total||'?')+'</p>';
    });
  }).catch(function(e){btn.disabled=false;$('ask-out').innerHTML='<div class="err-box">'+esc(e.message)+'</div>'});
};
// ---------- fanout ----------
var fanRows=[];
function addFanRow(id,prompt,lane){
  var idx=fanRows.length;
  fanRows.push({id:id||('task-'+(idx+1)),prompt:prompt||'',lane:lane||''});
  renderFanRows();
}
function renderFanRows(){
  var h='';
  for(var i=0;i<fanRows.length;i++){
    var r=fanRows[i];
    h+='<div class="fan-row">'
      +'<input type="text" data-i="'+i+'" data-f="id" value="'+esc(r.id)+'" placeholder="任务 id">'
      +'<select data-i="'+i+'" data-f="lane"><option value="">auto</option><option'+(r.lane==='ai'?' selected':'')+'>ai</option><option'+(r.lane==='cn'?' selected':'')+'>cn</option><option'+(r.lane==='cline'?' selected':'')+'>cline</option></select>'
      +'<textarea data-i="'+i+'" data-f="prompt" style="min-height:44px" placeholder="worker 提示词">'+esc(r.prompt)+'</textarea>'
      +'<button class="ghost" data-del="'+i+'">×</button></div>';
  }
  $('fan-rows').innerHTML=h||'<p class="hint">（还没有任务行，点「+ 添加任务行」）</p>';
  var tas=$('fan-rows').querySelectorAll('[data-f]');
  for(var k=0;k<tas.length;k++)tas[k].oninput=function(){
    var i=+this.dataset.i;fanRows[i][this.dataset.f]=this.value;
  };
  var dels=$('fan-rows').querySelectorAll('[data-del]');
  for(var d=0;d<dels.length;d++)dels[d].onclick=function(){fanRows.splice(+this.dataset.del,1);renderFanRows()};
}
$('fan-add').onclick=function(){addFanRow()};
$('fan-btn').onclick=function(){
  var btn=this;
  var tasks=[];
  for(var i=0;i<fanRows.length;i++){
    var p=(fanRows[i].prompt||'').trim();
    if(!p)continue;
    tasks.push({id:fanRows[i].id||('task-'+(i+1)),prompt:p,as:fanRows[i].lane||undefined});
  }
  if(!tasks.length){alert('至少要有一行带提示词的任务');return}
  btn.disabled=true;
  $('fan-out').innerHTML='<p><span class="spin"></span>执行中…</p>';
  api('POST','/api/fanout',{tasks:tasks,parallel:parseInt($('fan-parallel').value,10)||undefined,
    timeout:parseInt($('fan-timeout').value,10)||undefined}).then(function(r){
    pollJob(r.jobId,function(j){
      btn.disabled=false;
      var h='<p>完成：成功 '+(j.ok==null?'?':j.ok)+'/'+(j.total==null?'?':j.total)+'</p>';
      for(var t=0;t<(j.tasks||[]).length;t++){
        var task=j.tasks[t];
        h+='<div class="task-card"><details><summary>task '+esc(task.id)+' · PROMPT</summary><pre>'+esc(task.prompt||'')+'</pre></details>'
          +'<div class="hd">'+taskHead(task.record)+'</div>';
        if(task.record&&task.record.result!=null)h+=md(task.record.result);
        if(task.record&&task.record.error)h+='<div class="err-box">'+esc(task.record.error)+'</div>';
        h+='</div>';
      }
      if(j.error)h+='<div class="err-box">'+esc(j.error)+'</div>';
      h+='<div class="hint">job '+esc(j.id)+' · '+esc(j.dir)+'（wbx history '+esc(j.id)+' 可回放）</div>';
      $('fan-out').innerHTML=h;
    },function(j){
      $('fan-out').innerHTML='<p><span class="spin"></span>执行中… 完成 '+(j.done||0)+'/'+(j.total||'?')+'</p>';
    });
  }).catch(function(e){btn.disabled=false;$('fan-out').innerHTML='<div class="err-box">'+esc(e.message)+'</div>'});
};
// ---------- 历史 ----------
async function loadHistory(){
  try{
    var h=await api('GET','/api/history');
    $('hist-count').textContent='共 '+h.jobs.length+' 条';
    var tb=$('hist-table').querySelector('tbody');
    tb.innerHTML='';
    for(var i=0;i<h.jobs.length;i++){
      var j=h.jobs[i];
      var tr=document.createElement('tr');
      tr.className='clickable';
      var when=j.createdAt?new Date(j.createdAt).toLocaleString('zh-CN',{hour12:false}):j.id;
      var dist='';for(var k in j.laneDist)dist+=esc(k)+'×'+j.laneDist[k]+' ';
      tr.innerHTML='<td>'+esc(when)+'</td><td>'+esc(j.type)+(j.legacy?'（旧）':'')+'</td>'
        +'<td>'+(j.total==null?'?':j.total)+'</td><td>'+(j.successRate==null?'?':j.successRate+'%')+'</td>'
        +'<td>'+dist+'</td><td>'+esc(j.id)+'</td>';
      tr.onclick=(function(id){return function(){showJob(id)}})(j.id);
      tb.appendChild(tr);
    }
    if(!h.jobs.length)tb.innerHTML='<tr><td colspan="6" class="hint">（空）</td></tr>';
  }catch(e){alert('加载失败：'+e.message)}
}
$('hist-refresh').onclick=loadHistory;
async function showJob(id){
  try{
    var j=await api('GET','/api/job/'+id);
    var h='<h3>job '+esc(j.id)+'（'+esc(j.type)+(j.legacy?'，旧 tasks/ 兼容':'')+'）</h3>'
      +'<div class="kv"><b>状态</b><span>'+esc(j.status)+'</span><b>目录</b><span>'+esc(j.dir)+'</span>'
      +'<b>成功率</b><span>'+(j.successRate==null?'?':j.successRate+'%')+'</span></div>';
    for(var t=0;t<(j.tasks||[]).length;t++){
      var task=j.tasks[t];
      h+='<div class="task-card"><details open><summary>task '+esc(task.id)+' · PROMPT（点击折叠）</summary><pre>'+esc(task.prompt||'（无 tasks-input，旧格式）')+'</pre></details>'
        +'<div class="hd">'+taskHead(task.record)+'</div>';
      if(task.record&&task.record.result!=null)h+=md(task.record.result);
      if(task.record&&task.record.error)h+='<div class="err-box">'+esc(task.record.error)+'</div>';
      h+='</div>';
    }
    if(j.summaryMd)h+='<details><summary>summary.md</summary><pre>'+esc(j.summaryMd)+'</pre></details>';
    var el=$('job-detail');el.innerHTML=h;el.style.display='block';
  }catch(e){alert(e.message)}
}
// ---------- 登录 ----------
var loginTimer=null;
function startLoginUi(lane){
  if(loginTimer){clearInterval(loginTimer);loginTimer=null}
  $('login-out').innerHTML='<p><span class="spin"></span>申请登录 state…</p>';
  api('POST','/api/login/start',{lane:lane}).then(function(r){
    var h='<p>在浏览器完成登录（点击打开）：</p><p><a href="'+esc(r.authUrl)+'" target="_blank" rel="noopener">'+esc(r.authUrl)+'</a></p>';
    if(r.tips&&r.tips.length){
      h+='<p class="hint">遇到「登录失败」页时，把下面整行 URL 复制到地址栏回车：</p>';
      for(var i=0;i<r.tips.length;i++)h+='<div class="copyline">'+esc(r.tips[i])+'</div>';
    }
    h+='<p id="login-status"><span class="spin"></span>等待登录完成（每 2s 轮询，最长 5 分钟）…</p>';
    $('login-out').innerHTML=h;
    loginTimer=setInterval(function(){
      api('GET','/api/login/poll').then(function(p){
        var el=$('login-status');
        if(!el){clearInterval(loginTimer);loginTimer=null;return}
        if(p.status==='pending'){el.innerHTML='<span class="spin"></span>等待登录完成…（'+Math.round((Date.now()-p.startedAt)/1000)+'s）';return}
        clearInterval(loginTimer);loginTimer=null;
        if(p.status==='done'){
          el.innerHTML='<span class="badge ok">登录成功</span> lane '+esc(p.lane)+'（'+esc(p.nickname||'')+'）；<a href="#" onclick="location.reload();return false">刷新状态</a>';
        }else if(p.status==='timeout'){
          el.innerHTML='<span class="badge err">超时未完成</span> 请重新发起登录';
        }else{
          el.innerHTML='<span class="badge err">出错</span> '+esc(p.error||'');
        }
      }).catch(function(){});
    },2000);
  }).catch(function(e){$('login-out').innerHTML='<div class="err-box">'+esc(e.message)+'</div>'});
}
$('login-cn').onclick=function(){startLoginUi('cn')};
$('login-ai').onclick=function(){startLoginUi('ai')};
// ---------- 启动 ----------
loadStatus();
addFanRow('task-1','');
addFanRow('task-2','');
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
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(HTML);
      return;
    }
    if (req.method === 'GET' && p === '/api/status') {
      ensureDirs();
      const cfg = loadConfig();
      const lanes = LANE_ORDER.map((k) => laneStatusInfo(k));
      sendJson(res, 200, {
        version: WBX_VERSION, runtimeRoot: RUNTIME_ROOT,
        form: bridgeForm(),
        config: cfg, defaultLane: cfg['default-lane'], effectiveLane: resolveDefaultLane(),
        readyCount: lanes.filter((l) => l.ready && !l.disabled).length,
        lanes,
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
      if (!j) return sendJson(res, 404, { error: `job ${m[1]} 不存在` });
      if (u.searchParams.get('brief') === '1') return sendJson(res, 200, briefJob(j));
      sendJson(res, 200, j);
      return;
    }
    if (req.method === 'POST' && p === '/api/ask') {
      const b = await readBody(req);
      const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
      if (!prompt) return sendJson(res, 400, { error: '缺少 prompt' });
      let as = null;
      if (b.lane && b.lane !== 'auto') {
        as = parseLane(b.lane);
        if (!as) return sendJson(res, 400, { error: `lane 只支持 auto|ai|cn|cline（收到 ${b.lane}）` });
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
      if (bad) return sendJson(res, 400, { error: `任务 ${bad.id} 缺少 prompt` });
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
      if (!b.key || !(b.key in CONFIG_DEFS)) return sendJson(res, 400, { error: `未知配置键 ${b.key}` });
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
      const ctx = await startLogin(lane);
      loginState.status = 'pending';
      loginState.lane = lane;
      loginState.startedAt = Date.now();
      loginState.error = null;
      loginState.nickname = null;
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
    sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    sendJson(res, 500, { error: redact(e.message) });
  }
}

export async function startUiServer({ port = 7788, open = true } = {}) {
  ensureDirs();
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${port}`;
  console.log(`[OK] wbx ui 已启动：${url}（仅监听本机回环；Ctrl+C 退出，无常驻服务）`);
  console.error(`运行时根：${RUNTIME_ROOT}`);
  if (open) openBrowser(url);
  return server;
}
