/**
 * 生成 s19-module-env-baseline.json：以**修改前**（0.16.9）CLI 在 S1、M0 夹具上依次执行 deploy-done --env test、next（ready-to-smoke，不带 / 带 --auto）、
 * smoke --env test（含 smoke 报告）、next --auto、env list / show test / check 的规范化输出，作为 module-scoped-env-smoke「未启用项目零回归」的入库基准（ST-S19-31 等）。
 *
 * 用法：以修改前提交单独构建的 CLI 入口生成（例如 git worktree add --detach <dir> 24b66df 后在 <dir>/cli 内 npx tsc）：
 *   cd cli && npx vite-node test/fixtures/gen-s19-module-env-baseline.ts -- <修改前提交> <修改前 CLI 的 dist/index.js>
 * 省略第二个参数时使用本仓 cli/dist（仅限 cli/src 尚未改动时）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MES_BASELINE_FILE, buildEnvProject, callsLogPath, zeroRegressionRun, type CliRun } from '../s19-module-env-fixtures.js';

const [commit, entry] = process.argv.slice(2).filter(a => a !== '--');
if (!commit) throw new Error('用法：gen-s19-module-env-baseline.ts <修改前提交> [修改前 CLI 的 dist/index.js]');
const runs: Record<string, Record<string, CliRun>> = {};
for (const kind of ['S1', 'M0'] as const) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mes-base-'));
  try {
    runs[kind] = zeroRegressionRun(buildEnvProject(root, kind), entry);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(callsLogPath(root), { force: true });
  }
}
writeFileSync(MES_BASELINE_FILE, `${JSON.stringify({
  description: '修改前（0.16.9）CLI 在 S1、M0 夹具上 deploy-done --env test → next（不带 / 带 --auto）→ smoke --env test（含 smoke 报告）→ next --auto → env list / show test / check 的规范化输出（module-scoped-env-smoke 未启用项目零回归锚）',
  generated_from: commit,
  runs,
}, null, 2)}\n`);
console.log(`baseline → ${MES_BASELINE_FILE}`);
