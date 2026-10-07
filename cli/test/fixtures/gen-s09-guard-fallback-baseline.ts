/**
 * 生成 s09-guard-fallback-baseline.json：以**修改前**分发源 guard-check 对回落输入集实测退出码，
 * 作为 UT-S09-389 / UT-S09-412 / ST-S09-173「与修改前实测基准逐条相同」的入库夹具（不在测试内复述期望）。
 *
 * 用法（仓库根执行）：
 *   git show <修改前提交>:plugin/bin/guard-check > /path/old-guard
 *   cd cli && npx vite-node test/fixtures/gen-s09-guard-fallback-baseline.ts -- /path/old-guard <修改前提交>
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASELINE_FILE, BASELINE_INPUTS, buildProject, materialize, noGitPath, runGuard, type FixtureKind } from '../s09-guard-vcs-fixtures.js';

const args = process.argv.slice(2).filter(a => a !== '--');
const [oldGuard, commit] = args;
if (!oldGuard || !commit) throw new Error('用法：gen-s09-guard-fallback-baseline.ts <修改前 guard-check 路径> <修改前提交>');

const cases: Array<{ fixture: FixtureKind; key: string; exit: number }> = [];
for (const fixture of ['N-repo', 'N-nogit'] as FixtureKind[]) {
  for (const item of BASELINE_INPUTS) {
    // 每条输入用全新夹具，避免前一条的真实副作用（本生成器不执行命令，仅判定）
    const root = mkdtempSync(join(tmpdir(), 'openlogos-s09f-baseline-'));
    const scratch = mkdtempSync(join(tmpdir(), 'openlogos-s09f-path-'));
    try {
      buildProject(root, fixture);
      const pathEnv = fixture === 'N-nogit' ? noGitPath(scratch) : undefined;
      const r = runGuard(oldGuard, root, item.tool, materialize(item.input, root), { pathEnv });
      cases.push({ fixture, key: item.key, exit: r.exitCode });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  }
}
writeFileSync(BASELINE_FILE, `${JSON.stringify({
  description: '修改前分发源 plugin/bin/guard-check 对非 git 回落输入集的实测退出码（guard-versioned-content-scope 回落回归锚）',
  generated_from: `plugin/bin/guard-check@${commit}`,
  cases,
}, null, 2)}\n`);
console.log(`baseline: ${cases.length} cases → ${BASELINE_FILE}`);
