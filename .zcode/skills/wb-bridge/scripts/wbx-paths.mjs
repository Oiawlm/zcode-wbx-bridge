/**
 * wbx-paths — wbx 桥路径派生单点（全桥唯一路径定义面：core/ui/daemon/setup/CLI 一律 import，
 * 不得在任何脚本平行派生同值路径）。
 *
 * 运行时根（runtime root）解析：WBX_HOME env → ~/.wbx/（~/.zcode/wbx-bridge 存在
 * 即全局形态）→ 项目 .wbx/（项目形态）。resolveRuntimeRoot 可注入 {env, homedir}——
 * 仅为测试矩阵可注入性，缺省 process.env/os.homedir，默认调用行为与单点抽出前逐字一致。
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
export const GLOBAL_BRIDGE_DIR = path.join(HOME, '.zcode', 'wbx-bridge');
export const GLOBAL_RUNTIME_DIR = path.join(HOME, '.wbx');

// 运行时根：WBX_HOME env → ~/.wbx（全局形态，以 ~/.zcode/wbx-bridge 存在为准）→ 项目 .wbx
export function resolveRuntimeRoot({ env = process.env, homedir = os.homedir() } = {}) {
  if (env.WBX_HOME) return path.resolve(env.WBX_HOME);
  if (fs.existsSync(path.join(homedir, '.zcode', 'wbx-bridge'))) return path.join(homedir, '.wbx');
  return path.join(PROJECT_ROOT, '.wbx');
}

export const RUNTIME_ROOT = resolveRuntimeRoot();
export const JOBS_DIR = path.join(RUNTIME_ROOT, 'jobs');
export const SESSIONS_DIR = path.join(RUNTIME_ROOT, 'sessions');
export const PRODUCT_DIR = path.join(RUNTIME_ROOT, 'product');
export const CONFIG_FILE = path.join(RUNTIME_ROOT, 'config.json');
export const LEGACY_TASKS_DIR = path.join(PROJECT_ROOT, '.wbx', 'tasks'); // v2 fanout 结果（只读）
export const LEGACY_JOBS_DIR = path.join(PROJECT_ROOT, '.wbx', 'jobs');   // 项目形态时期的 jobs（只读）

export const bridgeForm = () => (fs.existsSync(GLOBAL_BRIDGE_DIR) ? 'global' : 'project');

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
