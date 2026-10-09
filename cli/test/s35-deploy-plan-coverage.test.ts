/**
 * deploy-plan-gate-release-0-15-19 [code] 单切片：change-lint L5 部署方案覆盖（功能规格 §2.90，场景 S35「L5 部署方案覆盖判定」）。
 *
 * 覆盖 UT-S35-216～UT-S35-223、ST-S35-38、ST-S35-39（与 logos/resources/test/core-S35-test-cases.md 对齐）；
 * UT-S35-224（注入式反证）在 s35-deploy-plan-coverage-injection.test.ts。
 * UT 调用真实 runChangeLint / evaluateDeploymentPlanCoverage / evaluatePlanPackage；ST 以 cli/dist 真实 CLI 进程执行。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 *
 * 「与本变更前逐字一致」的对照快照：test/fixtures/s35-deploy-plan-coverage/prechange-baseline.json，
 * 取自变更前实现（本机全局 0.15.18）对同一夹具的实际输出。重录方式：
 *   OPENLOGOS_S35_PRECHANGE_CLI=<变更前 CLI 的 dist/index.js> npx vitest run test/s35-deploy-plan-coverage.test.ts
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, registerCoreModule, withCompleteClarification } from './helpers.js';
import {
  evaluateDeploymentPlanCoverage, resolveProposalDeploymentDecision,
} from '../src/lib/proposal-lifecycle.js';
import { classifyProposalDeltas, runChangeLint, type ChangeLintViolation } from '../src/lib/change-lint.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'dist', 'index.js');
const FIXTURE_DIR = join(HERE, 'fixtures', 's35-deploy-plan-coverage');
const INCIDENT_DIR = join(FIXTURE_DIR, 'sync-claude-response-language');
const BASELINE_PATH = join(FIXTURE_DIR, 'prechange-baseline.json');
const PRECHANGE_CLI = process.env.OPENLOGOS_S35_PRECHANGE_CLI;

const PLAN_DIR_REL = 'logos/resources/prd/3-technical-plan/3-deployment';
const PLAN_TASK = '- [ ] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 新增本次发布章节';
const UNIQUE_TITLE = 'OpenLogos 9.9.1 发布方案（夹具）';
const MISSING_MESSAGE = 'proposal.md 声明需要部署，但本提案既未更新部署方案，也未说明沿用哪一节已合并部署方案';
const MISSING_FIX = '二选一：在 tasks.md 的 [delta] 增加一条部署方案任务，如「- [ ] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/<模块>-01-deployment-plan.md` — 新增本次发布章节」；或在 proposal.md「部署影响」写「- 部署方案依据：<已合并部署方案中的章节标题>」';
const PLAN_FIXTURE = [
  '# core-01-deployment-plan', '',
  '## OpenLogos 9.9.0 发布方案（夹具旧版本）', '', '### 本机全局部署', '旧版本步骤。', '',
  `## ${UNIQUE_TITLE}`, '', '### 本机全局部署', '本版本步骤。', '',
  '## 附录', '', '```markdown', '## 围栏内标题', '```', '',
].join('\n');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

interface FixtureOpts {
  /** 「是否需要部署」取值；null = 整个部署影响段缺失。 */
  deploy?: '是' | '否' | null;
  /** 部署影响段追加的行（如「- 部署方案依据：…」）。 */
  deployExtra?: string[];
  /** [delta] 追加行。 */
  deltaExtra?: string[];
  /** [deploy] 段：true = 非空段；false = 无段。 */
  deploySection?: boolean;
  /** [deploy] 追加行（默认一条发布任务）。 */
  deployTasks?: string[];
  planFile?: string | null;
  markers?: string[];
}

function proposalOf(o: FixtureOpts): string {
  const lines = ['# 变更提案：feat', '', '> module: core', '',
    '## 变更原因', '需要新能力。', '',
    '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01', ''];
  if (o.deploy !== null) {
    lines.push('## 部署影响',
      `- 是否需要部署：${o.deploy ?? '是'}`, '- 部署原因：说明', '- 影响环境：本地',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', ...(o.deployExtra ?? []), '');
  }
  lines.push('## 变更概述', '纯文档更新，无需代码。');
  const content = withCompleteClarification(lines.join('\n'));
  // 部署影响段缺失的夹具：去掉辅助函数自动补上的默认部署影响段，使决策走 tasks / legacy 回退路径。
  return o.deploy === null ? content.replace(/\n## 部署影响\n(?:- .*\n)+/, '\n') : content;
}

function tasksOf(o: FixtureOpts): string {
  const lines = ['# 任务', '', '## [delta] 规格变更', '- [ ] 产出 delta 到 `deltas/test/` — 新增用例', ...(o.deltaExtra ?? []), '',
    '## [code] 代码实现', ''];
  if (o.deploySection ?? (o.deploy !== '否')) lines.push('## [deploy] 发布', ...(o.deployTasks ?? ['- [ ] 按部署方案发布']), '');
  return lines.join('\n');
}

function scaffold(slug = 'feat'): { root: string; dir: string; slug: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: 'cli' }],
  }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-07-01T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  return { root, dir, slug };
}

function writePlan(root: string, content: string | null): void {
  if (content === null) return;
  mkdirSync(join(root, PLAN_DIR_REL), { recursive: true });
  writeFileSync(join(root, PLAN_DIR_REL, 'core-01-deployment-plan.md'), content);
}

function project(o: FixtureOpts = {}): { root: string; dir: string; slug: string } {
  const p = scaffold();
  writeFileSync(join(p.dir, 'proposal.md'), proposalOf(o));
  writeFileSync(join(p.dir, 'tasks.md'), tasksOf(o));
  writePlan(p.root, o.planFile === undefined ? PLAN_FIXTURE : o.planFile);
  for (const m of o.markers ?? []) writeFileSync(join(p.dir, m), '');
  return p;
}

/** ST-S35-38 的事故复刻夹具：原始 proposal / tasks 原文 + 只含其它版本章节的部署方案。 */
function incidentProject(): { root: string; dir: string; slug: string } {
  const p = scaffold('sync-claude-response-language');
  copyFileSync(join(INCIDENT_DIR, 'proposal.md'), join(p.dir, 'proposal.md'));
  copyFileSync(join(INCIDENT_DIR, 'tasks.md'), join(p.dir, 'tasks.md'));
  writePlan(p.root, PLAN_FIXTURE);
  return p;
}

function lint(p: { root: string; dir: string; slug: string }): { violations: ChangeLintViolation[]; checks: { id: number; label: string; violations: number }[] } {
  const r = runChangeLint(p.root, p.dir, p.slug);
  if (!r.ok) throw new Error(`操作错误：${r.errorCode} ${r.message}`);
  return { violations: r.violations, checks: r.checks };
}

function cli(cwd: string, args: string[], entry = CLI): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf-8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function lintJson(p: { root: string; slug: string }, entry = CLI): { status: number | null; data: any } {
  const r = cli(p.root, ['change-lint', '--slug', p.slug, '--format', 'json'], entry);
  return { status: r.status, data: JSON.parse(r.stdout).data };
}

function coverage(p: { root: string; dir: string }) {
  return evaluateDeploymentPlanCoverage(p.root, p.dir, resolveProposalDeploymentDecision(p.dir));
}

function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else out.set(path.slice(root.length), createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

// ── 变更前实现对照快照（UT-S35-222 ①～④、ST-S35-39 ⑤）──

const REGRESSION_FIXTURES: Record<string, () => { root: string; dir: string; slug: string }> = {
  'no-deploy': () => project({ deploy: '否', deploySection: false }),
  'section-missing-with-deploy': () => project({ deploy: null, deploySection: true }),
  'section-missing-no-deploy': () => project({ deploy: null, deploySection: false }),
  'conflict-no-but-deploy': () => project({ deploy: '否', deploySection: true }),
};

interface Observed { status: number | null; violations: unknown[]; text: string }

function observe(p: { root: string; slug: string }, entry = CLI): Observed {
  const j = lintJson(p, entry);
  const t = cli(p.root, ['change-lint', '--slug', p.slug], entry);
  return { status: j.status, violations: j.data.violations, text: t.stdout };
}

function repairedIncident(): { root: string; dir: string; slug: string } {
  const p = incidentProject();
  const tasks = readFileSync(join(p.dir, 'tasks.md'), 'utf-8');
  writeFileSync(join(p.dir, 'tasks.md'), tasks.replace('## [code] 代码实现', `${PLAN_TASK}\n\n## [code] 代码实现`));
  return p;
}

function readBaseline(): Record<string, Observed> {
  if (!existsSync(BASELINE_PATH)) throw new Error(`缺少变更前对照快照 ${BASELINE_PATH}，请按文件头说明重录`);
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
}

if (PRECHANGE_CLI) {
  describe('录制变更前对照快照（仅 OPENLOGOS_S35_PRECHANGE_CLI 在场时）', () => {
    it('record prechange baseline', () => {
      const out: Record<string, Observed> = {};
      for (const [name, build] of Object.entries(REGRESSION_FIXTURES)) out[name] = observe(build(), PRECHANGE_CLI);
      out['incident-repaired'] = observe(repairedIncident(), PRECHANGE_CLI);
      writeFileSync(BASELINE_PATH, `${JSON.stringify(out, null, 2)}\n`);
    }, 120_000);
  });
}

describe('S35 L5 部署方案覆盖判定', () => {
  it('UT-S35-216: 缺部署方案报 deployment_plan_missing', () => {
    const p = project();
    const { violations } = lint(p);
    expect(violations).toHaveLength(2);
    const l5 = violations.find(v => v.check_layer === 5)!;
    expect(l5.code).toBe('deployment_plan_missing');
    expect(l5.path).toBe(`logos/changes/${p.slug}/proposal.md`);
    expect(l5.message).toBe(MISSING_MESSAGE);
    expect(l5.fix_hint).toBe(MISSING_FIX);
    const l0 = violations.find(v => v.check_layer === 0)!;
    expect(l0.code).toBe('tasks_deployment_plan_missing');
    expect(violations.map(v => v.code)).not.toContain('deployment_plan_reference_unresolved');
    expect(cli(p.root, ['change-lint', '--slug', p.slug, '--format', 'json']).status).toBe(2);
  });

  it('UT-S35-217: (a) [delta] 部署方案任务即覆盖', () => {
    const cases: Array<[FixtureOpts, string]> = [
      [{ deltaExtra: [PLAN_TASK] }, 'covered_by_delta'],
      [{ deltaExtra: [PLAN_TASK.replace('- [ ]', '- [x]')] }, 'covered_by_delta'],
      [{ deployTasks: ['- [ ] 按 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 发布'] }, 'missing'],
      [{ deltaExtra: ['说明：部署方案见 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`'] }, 'missing'],
    ];
    for (const [opts, status] of cases) {
      const p = project(opts);
      expect(coverage(p).status, JSON.stringify(opts)).toBe(status);
      const codes = lint(p).violations.map(v => v.code);
      if (status === 'covered_by_delta') expect(codes).not.toContain('deployment_plan_missing');
      else expect(codes).toContain('deployment_plan_missing');
    }
  });

  it('UT-S35-218: (a) 已有部署方案 delta 文件即覆盖，且复用 L6 分类器', () => {
    const rel = 'deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md';
    const variants: Array<[string, (dir: string, root: string) => void, string]> = [
      ['regular', dir => {
        mkdirSync(join(dir, 'deltas/prd/3-technical-plan/3-deployment'), { recursive: true });
        writeFileSync(join(dir, rel), '## ADDED — OpenLogos 9.9.2 发布方案\n\n本次发布步骤。\n');
      }, 'covered_by_delta'],
      ['escaping-symlink', (dir, root) => {
        mkdirSync(join(dir, 'deltas/prd/3-technical-plan/3-deployment'), { recursive: true });
        const outside = join(dirname(root), `outside-${createHash('md5').update(root).digest('hex')}.md`);
        writeFileSync(outside, '## ADDED — 外部\n\n外部内容。\n');
        cleanups.push(() => rmSync(outside, { force: true }));
        symlinkSync(outside, join(dir, rel));
      }, 'missing'],
      ['empty-dir', dir => { mkdirSync(join(dir, 'deltas/prd/3-technical-plan/3-deployment'), { recursive: true }); }, 'missing'],
      ['subdir-only', dir => { mkdirSync(join(dir, 'deltas/prd/3-technical-plan/3-deployment/nested'), { recursive: true }); }, 'missing'],
    ];
    for (const [name, prepare, status] of variants) {
      const p = project();
      prepare(p.dir, p.root);
      expect(coverage(p).status, name).toBe(status);
      // 「是否算覆盖」与 L6 分类器对该文件的结论一致：被 merge 消费且 L6 判 valid 才算。
      // 逃逸的文件 symlink 会被 merge 跟随（mergeable），但 L6 判 invalid，故不算覆盖。
      const entry = classifyProposalDeltas(p.dir).find(e => e.relativePath === rel);
      const countsAsPlanDelta = entry?.mergeDisposition === 'mergeable' && entry.lintValidity === 'valid';
      expect(countsAsPlanDelta, name).toBe(status === 'covered_by_delta');
      if (name === 'escaping-symlink') expect(entry?.lintValidity).toBe('invalid');
    }
  });

  it('UT-S35-219: (b) 引用逐字唯一命中即覆盖', () => {
    for (const value of [UNIQUE_TITLE, `「${UNIQUE_TITLE}」`, `\`${UNIQUE_TITLE}\``, `  ${UNIQUE_TITLE}  `]) {
      const p = project({ deployExtra: [`- 部署方案依据：${value}`] });
      const c = coverage(p);
      expect(c, value).toEqual({ status: 'covered_by_reference', reference: UNIQUE_TITLE, reference_problem: null, hits: 1 });
      expect(lint(p).violations.map(v => v.code), value).toEqual([]);
      expect(cli(p.root, ['change-lint', '--slug', p.slug, '--format', 'json']).status).toBe(0);
    }
  });

  it('UT-S35-220: (b) 引用无法解析的三种形态与围栏、目录边界', () => {
    const cases: Array<[FixtureOpts, string, string | null]> = [
      [{ deployExtra: ['- 部署方案依据：OpenLogos 9.9.2 发布方案'] }, 'not_found', '找不到同名标题'],
      [{ deployExtra: ['- 部署方案依据：本机全局部署'] }, 'ambiguous', '命中 2 处标题'],
      [{ deployExtra: [`- 部署方案依据：${UNIQUE_TITLE}`, `- 部署方案依据：${UNIQUE_TITLE}`] }, 'duplicate', '出现了 2 次'],
      [{ deployExtra: ['- 部署方案依据：围栏内标题'] }, 'not_found', '找不到同名标题'],
      [{ deployExtra: [`- 部署方案依据：${UNIQUE_TITLE}`], planFile: null }, 'not_found', '找不到同名标题'],
    ];
    for (const [opts, problem, fragment] of cases) {
      const p = project(opts);
      const c = coverage(p);
      expect(c.status, problem).toBe('reference_unresolved');
      expect(c.reference_problem, JSON.stringify(opts)).toBe(problem);
      const l5 = lint(p).violations.filter(v => v.check_layer === 5);
      expect(l5.map(v => v.code)).toEqual(['deployment_plan_reference_unresolved']);
      expect(l5[0].message).toContain(fragment!);
      expect(cli(p.root, ['change-lint', '--slug', p.slug, '--format', 'json']).status).toBe(2);
    }
  });

  it('UT-S35-221: 先 (a) 后 (b)：delta 覆盖时不解析引用', () => {
    const prose = '- 部署方案依据：本提案 `[delta]` 新增「OpenLogos 0.15.19 发布方案」章节';
    const p = project({ deltaExtra: [PLAN_TASK], deployExtra: [prose] });
    const planFile = join(p.root, PLAN_DIR_REL, 'core-01-deployment-plan.md');
    // 部署方案文件设为不可读：判定若读取部署方案目录即抛 artifact_unreadable——读取 0 次的直接证据。
    chmodSync(planFile, 0o000);
    cleanups.push(() => chmodSync(planFile, 0o644));
    expect(coverage(p).status).toBe('covered_by_delta');
    expect(lint(p).violations.map(v => v.code)).not.toContain('deployment_plan_reference_unresolved');
    // 对照臂：去掉部署方案任务后同一引用按 (b) 解析——not_found。
    chmodSync(planFile, 0o644);
    writeFileSync(join(p.dir, 'tasks.md'), tasksOf({}));
    expect(coverage(p)).toMatchObject({ status: 'reference_unresolved', reference_problem: 'not_found' });
  });

  it('UT-S35-222: 不适用与冲突判定回归', () => {
    const baseline = readBaseline();
    for (const [name, build] of Object.entries(REGRESSION_FIXTURES)) {
      const p = build();
      expect(coverage(p).status, name).toBe('not_applicable');
      // 与变更前实现在同一夹具上的公开输出逐字一致（违规、退出码与人读全文）。
      const now = observe(p);
      expect(now, name).toEqual(baseline[name]);
    }
    const conflict = lint(REGRESSION_FIXTURES['conflict-no-but-deploy']()).violations;
    expect(conflict.filter(v => v.check_layer === 5).map(v => v.code)).toEqual(['deployment_decision_conflict']);
    // ⑤ EX-L5D-1：声明需要部署、缺 [deploy]、未覆盖 → L5 两条 + L0 两条。
    const both = lint(project({ deploySection: false })).violations;
    expect(both.filter(v => v.check_layer === 5).map(v => v.code)).toEqual(['deployment_decision_conflict', 'deployment_plan_missing']);
    expect(both.filter(v => v.check_layer === 0).map(v => v.code)).toEqual(['tasks_deployment_conflict', 'tasks_deployment_plan_missing']);
    // L5 通过时人读行与变更前相同。
    for (const name of ['no-deploy', 'section-missing-with-deploy']) {
      expect(baseline[name].text.split('\n')).toContain('  ✓ L5 部署决策一致');
    }
  });

  it('UT-S35-223: Plan Package 投影与 change-lint 收敛，历史提案边界', () => {
    const cases: Array<[string, FixtureOpts, string | null]> = [
      ['missing', {}, 'tasks_deployment_plan_missing'],
      ['unresolved', { deployExtra: ['- 部署方案依据：OpenLogos 9.9.2 发布方案'] }, 'proposal_deployment_plan_reference_unresolved'],
      ['covered', { deployExtra: [`- 部署方案依据：${UNIQUE_TITLE}`] }, null],
    ];
    for (const [name, opts, issueCode] of cases) {
      const p = project(opts);
      const pkg = evaluatePlanPackage(p.root, p.dir);
      const lintCodes = lint(p).violations.map(v => v.code);
      const pkgCodes = pkg.issues.map(i => i.code);
      if (issueCode) {
        expect(pkg.ready, name).toBe(false);
        expect(pkgCodes, name).toContain(issueCode);
        const issue = pkg.issues.find(i => i.code === issueCode)!;
        if (name === 'missing') expect(issue.section_id).toBe('delta');
        else { expect(issue.section_id).toBe('deployment'); expect(issue.actual).toBe('OpenLogos 9.9.2 发布方案'); }
        expect(cli(p.root, ['next', '--format', 'json']).stdout).not.toMatch(/"proposal_step":\s*"ready-to-delta"/);
      } else {
        expect(pkg.ready, name).toBe(true);
        expect(cli(p.root, ['next', '--format', 'json']).stdout).toMatch(/"proposal_step":\s*"ready-to-delta"/);
      }
      // lint 有无新违规与 Plan Package 有无对应问题两两一致。
      const lintHas = lintCodes.some(c => c === 'deployment_plan_missing' || c === 'deployment_plan_reference_unresolved');
      const pkgHas = pkgCodes.some(c => c === 'tasks_deployment_plan_missing' || c === 'proposal_deployment_plan_reference_unresolved');
      expect(lintHas, name).toBe(pkgHas);
    }
    // ④ 历史提案（PLAN_APPROVED）：Plan Package 不追加问题，change-lint 仍报。
    const hist = project({ markers: ['PLAN_APPROVED'] });
    expect(evaluatePlanPackage(hist.root, hist.dir).issues.map(i => i.code)).not.toContain('tasks_deployment_plan_missing');
    expect(lint(hist).violations.map(v => v.code)).toEqual(['deployment_plan_missing']);
  });
});

describe('S35 L5 部署方案覆盖——场景测试', () => {
  it('ST-S35-38: 事故端到端：sync-claude-response-language 原始提案在提案阶段被拦下', { timeout: 120_000 }, () => {
    const p = incidentProject();
    const before = snapshotTree(p.root);
    // ① 原始计划产物：exit 2，报 deployment_plan_missing（旧 L5 对该夹具通过、exit 0）。
    const r1 = lintJson(p);
    expect(r1.status).toBe(2);
    expect(r1.data.violations.map((v: any) => v.code)).toContain('deployment_plan_missing');
    expect(snapshotTree(p.root)).toEqual(before);
    // ② [delta] 追加部署方案任务 → exit 0。
    const tasks = readFileSync(join(p.dir, 'tasks.md'), 'utf-8');
    writeFileSync(join(p.dir, 'tasks.md'), tasks.replace('## [code] 代码实现', `${PLAN_TASK}\n\n## [code] 代码实现`));
    expect(lintJson(p).status).toBe(0);
    // ③ 撤回 ②，改为引用夹具部署方案中唯一的版本章节标题 → exit 0。
    writeFileSync(join(p.dir, 'tasks.md'), tasks);
    const proposal = readFileSync(join(p.dir, 'proposal.md'), 'utf-8');
    const withRef = (title: string) => proposal.replace('- 是否需要 smoke：否（', `- 部署方案依据：${title}\n- 是否需要 smoke：否（`);
    writeFileSync(join(p.dir, 'proposal.md'), withRef(UNIQUE_TITLE));
    expect(lintJson(p).status).toBe(0);
    // ④ 依据改为不存在的标题 → exit 2，报 deployment_plan_reference_unresolved。
    writeFileSync(join(p.dir, 'proposal.md'), withRef('OpenLogos 0.15.19 发布方案'));
    const r4 = lintJson(p);
    expect(r4.status).toBe(2);
    expect(r4.data.violations.map((v: any) => v.code)).toContain('deployment_plan_reference_unresolved');
    // ⑤ 每次 lint 前后项目根零写入。
    const snap = snapshotTree(p.root);
    lintJson(p);
    expect(snapshotTree(p.root)).toEqual(snap);
  });

  it('ST-S35-39: 真实 CLI 人读输出、JSON 信封与 next 投影（沿用既有输出合同）', { timeout: 120_000 }, () => {
    const p = incidentProject();
    // ① 人读输出：L0 与 L5 各一条，三段式，末行 FAIL（7/9，2 项违规）。
    const text = cli(p.root, ['change-lint', '--slug', p.slug]);
    expect(text.status).toBe(2);
    const lines = text.stdout.trimEnd().split('\n');
    const i0 = lines.indexOf('  ✗ L0 [tasks_deployment_plan_missing]');
    const i5 = lines.indexOf('  ✗ L5 [deployment_plan_missing]');
    expect(i0).toBeGreaterThan(-1);
    expect(i5).toBeGreaterThan(i0);
    expect(lines.slice(i5 + 1, i5 + 4)).toEqual([
      `      缺什么：${MISSING_MESSAGE}`,
      `      在哪补：logos/changes/${p.slug}/proposal.md`,
      `      补成什么样：${MISSING_FIX}`,
    ]);
    expect(lines[i0 + 1]).toMatch(/^ {6}缺什么：/);
    expect(lines[i0 + 2]).toMatch(/^ {6}在哪补：/);
    expect(lines[i0 + 3]).toMatch(/^ {6}补成什么样：/);
    expect(lines[lines.length - 1]).toBe('FAIL（7/9，2 项违规）');
    // ② JSON：两项违规，键集合恰为 code/path/message/fix_hint，不含 check_layer。
    const j = lintJson(p);
    expect(j.data.pass).toBe(false);
    expect(j.data.violations.map((v: any) => v.code)).toEqual(['tasks_deployment_plan_missing', 'deployment_plan_missing']);
    for (const v of j.data.violations) expect(Object.keys(v).sort()).toEqual(['code', 'fix_hint', 'message', 'path']);
    // ③ next / status 投影。
    expect(cli(p.root, ['next', '--format', 'json']).stdout).not.toMatch(/"proposal_step":\s*"ready-to-delta"/);
    const status = JSON.parse(cli(p.root, ['status', '--format', 'json']).stdout).data;
    const pkg = status.modules[0].active_change.plan_state.plan_package;
    expect(pkg.ready).toBe(false);
    expect(pkg.issues.map((i: any) => i.code)).toContain('tasks_deployment_plan_missing');
    // ④ 修复后：L0 / L5 行与 PASS 末行；next 进入 ready-to-delta。
    const fixed = repairedIncident();
    const fixedText = cli(fixed.root, ['change-lint', '--slug', fixed.slug]).stdout.trimEnd().split('\n');
    expect(fixedText).toContain('  ✓ L0 Plan Package 完成合同');
    expect(fixedText).toContain('  ✓ L5 部署决策一致');
    expect(fixedText[fixedText.length - 1]).toBe('PASS（9/9）');
    expect(cli(fixed.root, ['next', '--format', 'json']).stdout).toMatch(/"proposal_step":\s*"ready-to-delta"/);
    // ⑤ 对照：修复后夹具的人读输出与变更前实现逐字相同。
    expect(observe(fixed).text).toBe(readBaseline()['incident-repaired'].text);
  });
});

