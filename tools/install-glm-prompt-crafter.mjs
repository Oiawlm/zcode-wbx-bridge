// glm-prompt-crafter 用户级部署脚本：仓库包 → ~/.zcode/skills/glm-prompt-crafter/
// 逐文件 SHA-256 对比打印；不一致/缺失/多余 exit 1；幂等可重跑（重跑即重装+复验，亦是部署副本损坏时的自修复入口）。
// Node ≥18，零依赖。登记于 UNINSTALL.md §九。
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.zcode', 'skills', 'glm-prompt-crafter');
const DST = join(homedir(), '.zcode', 'skills', 'glm-prompt-crafter');

if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
  console.error(`[FAIL] 仓库源不存在：${SRC}`);
  process.exit(1);
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

cpSync(SRC, DST, { recursive: true });

let bad = 0;
const srcFiles = walk(SRC);
for (const s of srcFiles) {
  const rel = relative(SRC, s);
  const d = join(DST, rel);
  const a = sha256(readFileSync(s));
  const b = existsSync(d) ? sha256(readFileSync(d)) : '(缺失)';
  const ok = a === b;
  if (!ok) bad++;
  console.log(`[${ok ? 'OK' : 'DIFF'}] ${rel}  ${a.slice(0, 16)}…${ok ? '' : ` != ${b}`}`);
}
for (const f of walk(DST).filter((x) => !existsSync(join(SRC, relative(DST, x))))) {
  bad++;
  console.log(`[EXTRA] ${relative(DST, f)}（仓库源无此文件，属部署副本多余物，请人工核查）`);
}

console.log(bad === 0 ? `[OK] 部署一致：${srcFiles.length} 个文件逐字节相同 → ${DST}` : `[FAIL] ${bad} 处不一致`);
process.exit(bad === 0 ? 0 : 1);
