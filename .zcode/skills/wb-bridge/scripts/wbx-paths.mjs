/**
 * wbx-paths — wbx 桥路径派生单点（全桥唯一路径定义面：core/ui/daemon/setup/CLI 一律 import，
 * 不得在任何脚本平行派生同值路径）。
 *
 * 运行时根（v29 纯 Skill 形态）：WBX_HOME env（测试/沙箱注入，六门基建）→ <git 根>/.wbx。
 * git 根 = 从 process.cwd() 向上最近含 .git 的目录（一律 realpath 归一；worktree 的 .git 文件亦命中）；
 * 无 .git 则 fallback=cwd。PROJECT_ROOT=该 git 根（与 RT 同源）；WBX_PROJECT_ROOT env 仅测试注入。
 * 家目录派生只剩安装面常量（GLOBAL_SKILL_DIR）与 HOME 转出口：HOME 消费面=workbuddy 登录模板只读
 *（wbx-core）、~/.codex/auth.json 一次性只读复制（wbx.mjs login codex）、self-install 安装复制；
 * 运行时状态零家目录读写。安装 manifest（v3）仅版本自证：记录「哪个版本装了这份副本」，
 * 不参与任何运行时路径判定（双形态判定/manifest 自证已随 v29 删除）。
 * resolveProjectRoot/resolveRuntimeRoot 可注入 {env, cwd}——仅为测试矩阵可注入性，
 * 缺省 process.env/process.cwd()。
 *
 * 红线：本模块只做路径派生与存在性探测，绝不读写凭证内容、绝不打日志。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 脚本定位 ----------
export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const realpathSafe = (p) => { try { return fs.realpathSync(p); } catch { return null; } };

// git 根：从 start 向上最近含 .git 的目录（realpath 归一；.git 文件=worktree/submodule 亦命中）；无则 null
export function findGitRoot(start = process.cwd()) {
  let d = realpathSafe(start) || path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

// 项目根 = git 根（与运行时根同源）；WBX_PROJECT_ROOT env 仅测试注入
export function resolveProjectRoot({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.WBX_PROJECT_ROOT) return path.resolve(env.WBX_PROJECT_ROOT);
  return findGitRoot(cwd) || path.resolve(cwd);
}
export const PROJECT_ROOT = resolveProjectRoot();

// ---------- 家目录（全桥唯一 os.homedir 调用点；消费面见文件头注释） ----------
export const HOME = os.homedir();
export const GLOBAL_SKILL_DIR = path.join(HOME, '.zcode', 'skills', 'wb-bridge');  // self-install 唯一安装目标（技能目录）

// ---------- 安装 manifest（仅版本自证：安装期写入技能目录，检测期只读） ----------
export const INSTALL_MANIFEST_NAME = '.wbx-install.json';
export const MANIFEST_SCHEMA_VERSION = 3;

export function installManifestPath(scriptDir = SCRIPT_DIR) {
  return path.join(path.dirname(scriptDir), INSTALL_MANIFEST_NAME);
}

// 读 <scriptDir 上级>/.wbx-install.json。status：none=无 manifest；ok=可判读；bad=损坏。
// v29 起 manifest 仅记录版本自证，任何 schema 版本都不拦截运行（「拒绝降级」护栏已随双形态删除）；
// 非 v3 schema 附 note 提示（旧自证形态 → self-install 幂等重装收口）。
export function readInstallManifest(scriptDir = SCRIPT_DIR) {
  let raw;
  try { raw = fs.readFileSync(installManifestPath(scriptDir), 'utf8'); }
  catch { return { status: 'none' }; }
  let j;
  try { j = JSON.parse(raw); }
  catch { return { status: 'bad', message: '安装 manifest 不可解析（JSON 损坏）' }; }
  const v = j && j.schema_version;
  if (!Number.isInteger(v)) return { status: 'bad', message: `安装 manifest 缺合法 schema_version（得到 ${JSON.stringify(v)}）` };
  if (v === MANIFEST_SCHEMA_VERSION) return { status: 'ok', manifest: j };
  return {
    status: 'ok', manifest: j,
    legacy: v < MANIFEST_SCHEMA_VERSION,
    note: v < MANIFEST_SCHEMA_VERSION
      ? `已装副本 manifest 为 schema v${v}（v29 前自证形态）：重跑 self-install 幂等重装可收口为 v${MANIFEST_SCHEMA_VERSION}（仅版本自证）`
      : `已装副本 manifest schema_version=${v} 高于本桥认知的 v${MANIFEST_SCHEMA_VERSION}（更新版本安装的副本？）：运行不受影响（v29 起 manifest 仅版本自证）`,
  };
}

// 运行时根：WBX_HOME env → <git 根>/.wbx（git 根缺失 fallback cwd）
export function resolveRuntimeRoot({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.WBX_HOME) return path.resolve(env.WBX_HOME);
  return path.join(resolveProjectRoot({ env, cwd }), '.wbx');
}

export const RUNTIME_ROOT = resolveRuntimeRoot();
export const JOBS_DIR = path.join(RUNTIME_ROOT, 'jobs');
export const SESSIONS_DIR = path.join(RUNTIME_ROOT, 'sessions');
export const PRODUCT_DIR = path.join(RUNTIME_ROOT, 'product');
export const CONFIG_FILE = path.join(RUNTIME_ROOT, 'config.json');

// ---------- lane 隔离目录（均在 <运行时根> 下，绝不落用户家目录同名处） ----------
export const CLINE_HOME = path.join(RUNTIME_ROOT, 'cline-home');
export const CLINE_WORK_DIR = path.join(CLINE_HOME, 'work');
export const CODEX_HOME = path.join(RUNTIME_ROOT, 'codex-home');
export const CODEX_WORK_DIR = path.join(CODEX_HOME, 'work');

// L1 的空 scratch 工作目录（读边界：白名单无写工具 + cwd 外绝对路径读取被进程级拒绝）
export const SCRATCH_ROOT = path.join(RUNTIME_ROOT, 'scratch');
export const L0_CWD_DIR = path.join(RUNTIME_ROOT, 'l0-cwd');   // L0 专用空 cwd（常驻共享：worker 零写入，并发安全）

// ---------- 守护路径（run/ui.json 状态、logs/ui.log 日志；随运行时根每项目化） ----------
export const UI_RUN_DIR = path.join(RUNTIME_ROOT, 'run');
export const UI_LOG_DIR = path.join(RUNTIME_ROOT, 'logs');
export const UI_STATE_FILE = path.join(UI_RUN_DIR, 'ui.json');
export const UI_LOG_FILE = path.join(UI_LOG_DIR, 'ui.log');

// ---------- 导出面（v29 新增：export-bundle 默认落点；临时/导出产物一律入 scratch/ 或 export/） ----------
export const EXPORT_DIR = path.join(RUNTIME_ROOT, 'export');
