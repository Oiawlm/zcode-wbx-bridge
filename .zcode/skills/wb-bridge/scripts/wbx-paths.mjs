/**
 * wbx-paths — wbx 桥路径派生单点（全桥唯一路径定义面：core/ui/daemon/setup/CLI 一律 import，
 * 不得在任何脚本平行派生同值路径）。
 *
 * 运行时根（runtime root）解析（v28-A 起由安装 manifest 自证，替代旧「目录存在」哨兵）：
 * WBX_HOME env → 全局形态 ~/.wbx/（本脚本 realpath 落在安装 manifest 声明的 installRoot
 * 内即自证为全局）→ 项目 .wbx/（项目形态）；WBX_FORM=global|project 仅作逃生门。
 * manifest schema_version 与本桥支持的 2 不一致 → 明确报错拒绝，绝不静默降级运行。
 * resolveRuntimeRoot/detectInstall 可注入 {env, homedir, scriptDir}——仅为测试矩阵可注入性，
 * 缺省 process.env/os.homedir/本模块 SCRIPT_DIR；所有 DIR 派值与 v28-S 前逐字一致。
 *
 * 红线：本模块只做路径派生与存在性探测，绝不读写凭证内容、绝不打日志。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 脚本定位与项目根 ----------
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
export const GLOBAL_SKILL_DIR = path.join(HOME, '.zcode', 'skills', 'wb-bridge');  // v28-A 起唯一安装根（代码+文档+manifest）
export const GLOBAL_BRIDGE_DIR = path.join(HOME, '.zcode', 'wbx-bridge');          // v28 前旧布局：仅迁移探测与卸载清理引用
export const GLOBAL_RUNTIME_DIR = path.join(HOME, '.wbx');

// ---------- 安装 manifest（自证：安装期写入技能目录，检测期只读） ----------
export const INSTALL_MANIFEST_NAME = '.wbx-install.json';
export const MANIFEST_SCHEMA_VERSION = 2;

export function installManifestPath(scriptDir = SCRIPT_DIR) {
  return path.join(path.dirname(scriptDir), INSTALL_MANIFEST_NAME);
}

// 读 <scriptDir 上级>/.wbx-install.json。status：none=无 manifest（项目形态）；ok=schema 兼容可判读；
// bad=损坏；incompatible=schema_version 与本桥支持的 2 不一致（拒绝降级运行/降级解读，明确报错）。
export function readInstallManifest(scriptDir = SCRIPT_DIR) {
  let raw;
  try { raw = fs.readFileSync(installManifestPath(scriptDir), 'utf8'); }
  catch { return { status: 'none' }; }
  let j;
  try { j = JSON.parse(raw); }
  catch { return { status: 'bad', message: '安装 manifest 不可解析（JSON 损坏）' }; }
  const v = j && j.schema_version;
  if (!Number.isInteger(v)) return { status: 'bad', message: `安装 manifest 缺合法 schema_version（得到 ${JSON.stringify(v)}）` };
  if (v > MANIFEST_SCHEMA_VERSION) {
    return { status: 'incompatible', message: `已装桥 manifest schema_version=${v} 高于本桥支持的 ${MANIFEST_SCHEMA_VERSION}：拒绝降级运行——请升级本桥（或从源码仓/分发包重跑 self-install）` };
  }
  if (v < MANIFEST_SCHEMA_VERSION) {
    return { status: 'incompatible', message: `已装桥 manifest schema_version=${v} 低于本桥支持的 ${MANIFEST_SCHEMA_VERSION}：拒绝降级解读——请从源码仓/分发包副本重跑 self-install 覆盖安装（新 manifest 会自动写入）` };
  }
  return { status: 'ok', manifest: j };
}

const realpathSafe = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const isWithin = (child, root) => {
  const c = realpathSafe(child), r = realpathSafe(root);
  return !!c && !!r && (c === r || c.startsWith(r + path.sep));
};

// 形态判定单点（v28-A）：WBX_FORM 逃生门 > 安装 manifest 自证（本副本 realpath ∈ installRoot）
// > 默认项目形态。schema 不兼容直接抛错（明确报错，绝不静默降级）。
export function detectInstall({ env = process.env, scriptDir = SCRIPT_DIR } = {}) {
  if (env.WBX_FORM === 'global') return { form: 'global', source: 'WBX_FORM=global（逃生门）', installRoot: null };
  if (env.WBX_FORM === 'project') return { form: 'project', source: 'WBX_FORM=project（逃生门）', installRoot: null };
  const m = readInstallManifest(scriptDir);
  if (m.status === 'none') return { form: 'project', source: '无安装 manifest', installRoot: null };
  if (m.status !== 'ok') throw new Error(m.message);
  const root = m.manifest.installRoot;
  if (typeof root === 'string' && root && isWithin(scriptDir, root)) {
    return { form: 'global', source: '安装 manifest 自证', installRoot: root, manifest: m.manifest };
  }
  return { form: 'project', source: 'manifest 未认证本副本（realpath 不在 installRoot 内）', installRoot: typeof root === 'string' ? root : null, manifest: m.manifest };
}

// 运行时根：WBX_HOME env → 全局形态 ~/.wbx → 项目 .wbx（数据根派值 v28-A 前后零变化）
export function resolveRuntimeRoot({ env = process.env, homedir = os.homedir(), scriptDir = SCRIPT_DIR } = {}) {
  if (env.WBX_HOME) return path.resolve(env.WBX_HOME);
  const d = detectInstall({ env, scriptDir });
  return d.form === 'global' ? path.join(homedir, '.wbx') : path.join(PROJECT_ROOT, '.wbx');
}

export const RUNTIME_ROOT = resolveRuntimeRoot();
export const JOBS_DIR = path.join(RUNTIME_ROOT, 'jobs');
export const SESSIONS_DIR = path.join(RUNTIME_ROOT, 'sessions');
export const PRODUCT_DIR = path.join(RUNTIME_ROOT, 'product');
export const CONFIG_FILE = path.join(RUNTIME_ROOT, 'config.json');
export const LEGACY_TASKS_DIR = path.join(PROJECT_ROOT, '.wbx', 'tasks'); // v2 fanout 结果（只读）
export const LEGACY_JOBS_DIR = path.join(PROJECT_ROOT, '.wbx', 'jobs');   // 项目形态时期的 jobs（只读）

export const bridgeForm = () => detectInstall().form;

// ---------- lane 隔离目录（均在 <运行时根> 下，绝不落用户家目录同名处） ----------
export const CLINE_HOME = path.join(RUNTIME_ROOT, 'cline-home');
export const CLINE_WORK_DIR = path.join(CLINE_HOME, 'work');
export const CODEX_HOME = path.join(RUNTIME_ROOT, 'codex-home');
export const CODEX_WORK_DIR = path.join(CODEX_HOME, 'work');

// L1 的空 scratch 工作目录（读边界：白名单无写工具 + cwd 外绝对路径读取被进程级拒绝）
export const SCRATCH_ROOT = path.join(RUNTIME_ROOT, 'scratch');
export const L0_CWD_DIR = path.join(RUNTIME_ROOT, 'l0-cwd');   // L0 专用空 cwd（常驻共享：worker 零写入，并发安全）

// ---------- 守护路径（run/ui.json 状态、logs/ui.log 日志） ----------
export const UI_RUN_DIR = path.join(RUNTIME_ROOT, 'run');
export const UI_LOG_DIR = path.join(RUNTIME_ROOT, 'logs');
export const UI_STATE_FILE = path.join(UI_RUN_DIR, 'ui.json');
export const UI_LOG_FILE = path.join(UI_LOG_DIR, 'ui.log');
