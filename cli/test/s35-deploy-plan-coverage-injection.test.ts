/**
 * deploy-plan-gate-release-0-15-19：UT-S35-224 判定单点、只读与操作错误（功能规格 §2.90.4，场景 S35 EX-L5D-3）。
 *
 * 注入式反证：把 `evaluateDeploymentPlanCoverage` 替换为恒返回 `covered_by_delta` 的实现后，
 * change-lint L5 与 Plan Package 两个消费方必须同时失去部署方案问题——证明两者都只经同一判定、不各自解析。
 * 注入经 vi.mock 生效于整个模块图，故单独成文件，不影响其它用例。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, registerCoreModule, withCompleteClarification } from './helpers.js';

const injection = vi.hoisted(() => ({ active: false }));

vi.mock('../src/lib/proposal-lifecycle.js', { spy: true });

const { runChangeLint } = await import('../src/lib/change-lint.js');
const { evaluatePlanPackage } = await import('../src/lib/plan-package.js');
const lifecycle = await import('../src/lib/proposal-lifecycle.js');
const actual = await vi.importActual<typeof import('../src/lib/proposal-lifecycle.js')>('../src/lib/proposal-lifecycle.js');
const realEvaluate = actual.evaluateDeploymentPlanCoverage;
vi.mocked(lifecycle.evaluateDeploymentPlanCoverage).mockImplementation((...args) => (injection.active
  ? { status: 'covered_by_delta', reference: null, reference_problem: null, hits: 0 }
  : realEvaluate(...args)));

const cleanups: Array<() => void> = [];
afterEach(() => { injection.active = false; while (cleanups.length) cleanups.pop()!(); });

const PLAN_DIR_REL = 'logos/resources/prd/3-technical-plan/3-deployment';
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const PLAN_COVERAGE_CODES = new Set([
  'deployment_plan_missing', 'deployment_plan_reference_unresolved',
  'tasks_deployment_plan_missing', 'proposal_deployment_plan_reference_unresolved',
]);

function project(reference?: string): { root: string; dir: string; slug: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: 'cli' }],
  }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: 'feat', module: 'core', createdAt: '2026-07-01T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', 'feat');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    '# 变更提案：feat', '', '> module: core', '',
    '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '', '## 变更范围', '- 影响的功能规格：core-01', '',
    '## 部署影响', '- 是否需要部署：是', '- 部署原因：说明', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否',
    ...(reference ? [`- 部署方案依据：${reference}`] : []), '',
    '## 变更概述', '纯文档更新，无需代码。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 任务', '', '## [delta] 规格变更', '- [ ] 产出 delta 到 `deltas/test/` — 新增用例', '',
    '## [code] 代码实现', '', '## [deploy] 发布', '- [ ] 按部署方案发布', '',
  ].join('\n'));
  mkdirSync(join(root, PLAN_DIR_REL), { recursive: true });
  writeFileSync(join(root, PLAN_DIR_REL, 'core-01-deployment-plan.md'), '# 部署方案\n\n## OpenLogos 9.9.1 发布方案（夹具）\n\n步骤。\n');
  return { root, dir, slug: 'feat' };
}

function planCoverageCodes(p: { root: string; dir: string; slug: string }): { lint: string[]; pkg: string[] } {
  const r = runChangeLint(p.root, p.dir, p.slug);
  if (!r.ok) throw new Error(`${r.errorCode} ${r.message}`);
  return {
    lint: r.violations.map(v => v.code).filter(c => PLAN_COVERAGE_CODES.has(c)),
    pkg: evaluatePlanPackage(p.root, p.dir).issues.map(i => i.code).filter(c => PLAN_COVERAGE_CODES.has(c)),
  };
}

function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.set(path.slice(root.length), createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

describe('S35 L5 部署方案覆盖——判定单点', () => {
  it('UT-S35-224: 判定单点、只读与操作错误', () => {
    // ① 注入式反证：真实判定下两个消费方都报；注入恒覆盖后两者同时转为无问题。
    const missing = project();
    const unresolved = project('OpenLogos 9.9.2 发布方案');
    expect(planCoverageCodes(missing)).toEqual({ lint: ['tasks_deployment_plan_missing', 'deployment_plan_missing'], pkg: ['tasks_deployment_plan_missing'] });
    expect(planCoverageCodes(unresolved)).toEqual({
      lint: ['proposal_deployment_plan_reference_unresolved', 'deployment_plan_reference_unresolved'],
      pkg: ['proposal_deployment_plan_reference_unresolved'],
    });
    injection.active = true;
    expect(planCoverageCodes(missing)).toEqual({ lint: [], pkg: [] });
    expect(planCoverageCodes(unresolved)).toEqual({ lint: [], pkg: [] });
    injection.active = false;

    // ② 只读：判定与 lint 前后项目根字节快照相等。
    for (const p of [missing, unresolved]) {
      const before = snapshotTree(p.root);
      planCoverageCodes(p);
      expect(snapshotTree(p.root)).toEqual(before);
    }

    // ③ 部署方案文件不可读 → artifact_unreadable，不降级为 not_found（EX-L5D-3）。以 cli/dist 真实进程执行：
    // 本文件对 proposal-lifecycle 做了 spy 注入，进程外执行可避开注入对错误类身份的影响。
    const unreadable = project('OpenLogos 9.9.1 发布方案（夹具）');
    const planFile = join(unreadable.root, PLAN_DIR_REL, 'core-01-deployment-plan.md');
    chmodSync(planFile, 0o000);
    cleanups.push(() => chmodSync(planFile, 0o644));
    const r = spawnSync(process.execPath, [CLI, 'change-lint', '--slug', 'feat', '--format', 'json'],
      { cwd: unreadable.root, encoding: 'utf-8', timeout: 120_000 });
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr.trim().split('\n').pop()!);
    expect(err.error.code).toBe('artifact_unreadable');
    expect(err.error.message).toContain(`${PLAN_DIR_REL}/core-01-deployment-plan.md`);
  });
});
