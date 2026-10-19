/**
 * 生成 s09-module-lifecycle-baseline.json：以**修改前**（0.16.8）的五宿主分发源对 UT-S09-469～477 输入矩阵
 * 实测退出码与 stdout，作为「launched 目标与全 initial / 全 launched 项目结论不变」的入库基准（不在测试内复述期望）。
 *
 * 用法（仓库根执行；<修改前提交> 之后 guard 分发源不应有任何改动）：
 *   cd cli && npx vite-node test/fixtures/gen-s09-module-lifecycle-baseline.ts -- <修改前提交>
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO_ROOT } from '../s09-guard-vcs-fixtures.js';
import {
  MLG_BASELINE_COMBOS, MLG_BASELINE_FILE, MLG_HOSTS, MLG_HOST_FILES, type MlgBaselineCase, runCombo,
} from '../s09-module-lifecycle-fixtures.js';

const args = process.argv.slice(2).filter(a => a !== '--');
const [commit] = args;
if (!commit) throw new Error('用法：gen-s09-module-lifecycle-baseline.ts <修改前提交>');

const base = mkdtempSync(join(tmpdir(), 'openlogos-mlg-old-'));
const cases: MlgBaselineCase[] = [];
try {
  const files = new Set(Object.values(MLG_HOST_FILES).flat());
  for (const rel of files) {
    const target = join(base, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync('git', ['show', `${commit}:${rel}`], { cwd: REPO_ROOT }));
    if (rel.endsWith('guard-check')) chmodSync(target, 0o755);
  }
  for (const host of MLG_HOSTS) {
    for (const { kind, state } of MLG_BASELINE_COMBOS) {
      for (const [key, r] of runCombo(base, host, kind, state)) cases.push({ host, kind, state, key, exit: r.exit, stdout: r.stdout });
    }
    console.log(`${host}: done`);
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
writeFileSync(MLG_BASELINE_FILE, `${JSON.stringify({
  description: '修改前（0.16.8）五宿主 guard 分发源对 module-lifecycle-guard 输入矩阵的实测退出码与 stdout（launched 目标与全 initial / 全 launched 项目结论不变的回归锚）',
  generated_from: commit,
  cases,
}, null, 2)}\n`);
console.log(`baseline: ${cases.length} cases → ${MLG_BASELINE_FILE}`);
