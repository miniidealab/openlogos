/**
 * S11 — SessionStart 阶段横幅去排他措辞（make-phase-banner-informational）。
 * 覆盖 UT-S11-86～UT-S11-90、ST-S11-48、ST-S11-49（与 logos/resources/test/core-S11-test-cases.md 严格对齐）。
 *
 * 被测对象是**源模板** `plugin/bin/openlogos-phase` 的 `change_management_message`，
 * 不测 `.claude/openlogos/bin/` 的 sync 部署副本。横幅是情境信息而非写入授权：
 * plan-exit 之后的全部分支与未知 step 兜底分支不得出现 only / Allowed files: / Stop / do not modify；
 * 写入约束由 PreToolUse 层 `plugin/bin/guard-check` 承担，本变更不改它一个字节。
 *
 * - UT：桩 `openlogos` 置 PATH 首位，返回指定 `proposal_step` 的 `status --format json`。
 * - UT-S11-90：以改动前的留存副本 `fixtures/s11-openlogos-phase.pre-informational.sh` 作对照臂。
 * - ST：真实 CLI（`cli/dist/index.js`）+ 真实 guard-check；ST-S11-49 与改动前基线
 *   `fixtures/s11-banner/baseline.json` 逐项比对（易变字段具名剔除，见 VOLATILE_STATUS_FIELDS）。
 *
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHASE_HOOK = join(REPO_ROOT, 'plugin', 'bin', 'openlogos-phase');
const PHASE_HOOK_BEFORE = join(REPO_ROOT, 'cli', 'test', 'fixtures', 's11-openlogos-phase.pre-informational.sh');
const GUARD_CHECK = join(REPO_ROOT, 'plugin', 'bin', 'guard-check');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const FIXTURE_DIR = join(REPO_ROOT, 'cli', 'test', 'fixtures', 's11-banner');
const BASELINE_PATH = join(FIXTURE_DIR, 'baseline.json');

/** 单用例内串行多次拉起 bash / 真实 CLI，并行全量下单次可达 1～2s，按调用次数放宽。 */
const MULTI_RUN_TIMEOUT = 120_000;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 四类排他模式（场景 S11「措辞约束」第 2 条），均大小写不敏感。 */
const EXCLUSIVE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['only', /\bonly\b/i],
  ['Allowed files:', /Allowed files:/i],
  ['Stop', /\bStop\b/i],
  ['do not modify', /do not modify/i],
];

const CONFIRM_SENTENCE = 'openlogos merge, openlogos verify, openlogos smoke, openlogos archive, deployment, and git push are human confirmation points: AI must not execute them without explicit user authorization.';

/** plan-exit 之后全部已知 step（UT-S11-87 枚举）。 */
const POST_PLAN_STEPS = [
  'delta-writing', 'implementing', 'in-progress', 'ready-to-merge', 'merge-generated',
  'coding', 'ready-to-verify', 'verify-failed', 'verify-passed', 'deploy-done', 'smoke-passed',
  'ready-to-deploy', 'ready-to-smoke', 'smoke-failed',
] as const;

function exclusiveHits(line: string): string[] {
  return EXCLUSIVE_PATTERNS.filter(([, re]) => re.test(line)).map(([name]) => name);
}

// ── UT harness：桩 status ─────────────────────────────────────────────────────

interface StubOpts {
  activeChange?: string | null;
  step?: string;
  guard?: boolean;
  uiOverlay?: boolean;
  planState?: Record<string, unknown>;
}

function stubProject(opts: StubOpts = {}) {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:',
    '  name: "banner-scope"',
    'modules:',
    '  - id: core',
    '    name: core',
    '    lifecycle: launched',
    '',
  ].join('\n'));
  const active = opts.activeChange === undefined ? 'feat-x' : opts.activeChange;
  if (opts.guard !== false && active) {
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: active, module: 'core' }));
  }
  if (opts.uiOverlay) {
    mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
    writeFileSync(join(root, 'logos', 'flow', 'launched.yaml'), 'nodes:\n  - id: write-ui-prototype\n');
  }
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const data: Record<string, unknown> = {
    lifecycle: 'launched',
    current_phase: null,
    suggestion: '中文 suggestion 不作为事实源',
    all_done: true,
    active_change: active,
    proposal_step: opts.step ?? '',
  };
  if (opts.planState && active) {
    data.modules = [{ active_change: { slug: active, proposal_step: opts.step ?? '', plan_state: opts.planState } }];
  }
  const json = JSON.stringify({ command: 'status', version: 'test', data });
  const wrapper = join(binDir, 'openlogos');
  writeFileSync(wrapper, [
    '#!/usr/bin/env bash',
    'if [ "$1" = "status" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then',
    `  cat <<'JSON'\n${json}\nJSON\n  exit 0`,
    'fi',
    'exit 1',
    '',
  ].join('\n'));
  execFileSync('chmod', ['755', wrapper]);
  return { root, binDir };
}

interface PhaseOutput { systemMessage: string; context: string; changeLine: string }

function runPhaseJson(script: string, root: string, binDir: string): PhaseOutput {
  const out = execFileSync('bash', [script], {
    cwd: root,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    encoding: 'utf-8',
  });
  const parsed = JSON.parse(out);
  const context = parsed.hookSpecificOutput.additionalContext as string;
  const changeLine = context.split('\n').find(l => l.startsWith('Change Management:')) ?? '';
  return { systemMessage: parsed.systemMessage as string, context, changeLine };
}

function bannerFor(step: string): string {
  const { root, binDir } = stubProject({ step });
  return runPhaseJson(PHASE_HOOK, root, binDir).changeLine;
}

// ── ST harness：真实 CLI + 真实 guard-check ─────────────────────────────────

type RealState = 'delta-writing' | 'ready-to-merge' | 'coding' | 'plan-stage' | 'no-guard';

const REAL_STATES: readonly RealState[] = ['delta-writing', 'coding', 'ready-to-merge', 'plan-stage', 'no-guard'];

/** 一次性隔离 launched 项目：提案 `slug` 按 state 摆放 marker 与 tasks.md。 */
function realProject(state: RealState, slug = 'feat') {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:',
    '  name: "banner-real"',
    'modules:',
    '  - id: core',
    '    name: core',
    '    lifecycle: launched',
    '',
  ].join('\n'));
  placeProposal(root, state, slug);
  if (state !== 'no-guard') {
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
      activeChange: slug, module: 'core', createdAt: '2026-09-24T00:00:00.000Z',
    }));
  }
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const wrapper = join(binDir, 'openlogos');
  writeFileSync(wrapper, `#!/usr/bin/env bash\nexec node "${CLI_ENTRY}" "$@"\n`);
  execFileSync('chmod', ['755', wrapper]);
  return { root, binDir };
}

function placeProposal(root: string, state: RealState, slug: string) {
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  copyFileSync(join(FIXTURE_DIR, 'proposal.md'), join(dir, 'proposal.md'));
  const deltaDone = state === 'ready-to-merge' || state === 'coding';
  const lines = [
    '# 实现任务', '',
    '## [delta] 规格变更',
    `- [${deltaDone ? 'x' : ' '}] \`deltas/test/core-S01-test-cases.md\`：夹具 delta`, '',
    '## [code] 代码实现',
  ];
  if (state === 'coding') lines.push('- [ ] 切片：夹具实现（覆盖 UT-S01-01）');
  writeFileSync(join(dir, 'tasks.md'), lines.join('\n') + '\n');
  if (deltaDone) writeFileSync(join(dir, 'deltas', 'test', 'core-S01-test-cases.md'), '## ADDED — 夹具\n\n夹具内容\n');
  if (state !== 'plan-stage') writeFileSync(join(dir, 'PLAN_APPROVED'), '');
  if (state === 'coding') {
    writeFileSync(join(dir, 'SPEC_MERGED'), '');
    writeFileSync(join(dir, 'SLICES_APPROVED'), '');
  }
}

function realStatus(root: string): Record<string, unknown> {
  const out = execFileSync('node', [CLI_ENTRY, 'status', '--format', 'json'], { cwd: root, encoding: 'utf-8' });
  return JSON.parse(out);
}

/**
 * 具名剔除的易变字段（不得泛化忽略）：
 * - `timestamp`：每次调用的生成时刻；
 * - `version`（顶层）：CLI 包版本，随 [deploy] 升版变化；
 * - `managed_assets.expected_hash`：受管资产内容哈希，本切片改 openlogos-phase 文案必然改变它，
 *   属资产指纹而非 status 契约字段。
 */
const VOLATILE_STATUS_FIELDS = ['timestamp', 'version', 'managed_assets.expected_hash'] as const;

function normalizeStatus(json: Record<string, unknown>, root: string): unknown {
  const clone = JSON.parse(JSON.stringify(json).split(root).join('<ROOT>')) as Record<string, any>;
  delete clone.timestamp;
  delete clone.version;
  const strip = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(strip); return; }
    if (node && typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if (obj.managed_assets && typeof obj.managed_assets === 'object') {
        delete (obj.managed_assets as Record<string, unknown>).expected_hash;
      }
      Object.values(obj).forEach(strip);
    }
  };
  strip(clone);
  return clone;
}

function runGuard(root: string, toolName: string, toolInput: Record<string, unknown>) {
  const r = spawnSync('bash', [GUARD_CHECK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf-8',
    timeout: 10_000,
  });
  const norm = (s: string | null) => (s ?? '').split(root).join('<ROOT>');
  return { exit: r.status ?? -1, stdout: norm(r.stdout), stderr: norm(r.stderr) };
}

const GUARD_INPUTS: ReadonlyArray<[string, string, Record<string, unknown>]> = [
  ['write-source', 'Write', { file_path: 'src/a.ts', content: 'x' }],
  ['write-resources', 'Write', { file_path: 'logos/resources/test/core-S01-test-cases.md', content: 'x' }],
  ['write-delta', 'Write', { file_path: 'logos/changes/feat/deltas/test/core-S01-test-cases.md', content: 'x' }],
  ['write-plan-stage-non-page-design-delta', 'Write', {
    file_path: 'logos/changes/feat/deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-x.md', content: 'x',
  }],
  ['bash-redirect-source', 'Bash', { command: 'echo x > src/a.ts' }],
];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// ── 单元测试 ────────────────────────────────────────────────────────────────

describe('S11 — SessionStart 阶段横幅去排他措辞', () => {
  it('UT-S11-86: 三处原排他分支去排他后仍含提案 slug 与当前 step', () => {
    const steps = ['coding', 'ready-to-verify', 'verify-failed', 'delta-writing', 'implementing', 'in-progress', 'ready-to-merge'];
    for (const step of steps) {
      const line = bannerFor(step);
      const shown = step === 'implementing' || step === 'in-progress' ? 'delta-writing' : step;
      expect(line, step).toContain("Active change proposal: 'feat-x'");
      expect(line, step).toContain(`Current proposal step: ${shown}`);
      expect(exclusiveHits(line), `${step}: ${line}`).toEqual([]);
    }
  }, MULTI_RUN_TIMEOUT);

  it('UT-S11-87: 四类排他措辞在 plan-exit 之后全部分支零出现', () => {
    const hits = POST_PLAN_STEPS
      .map(step => ({ step, hits: exclusiveHits(bannerFor(step)) }))
      .filter(r => r.hits.length > 0);
    expect(hits).toEqual([]);
  }, MULTI_RUN_TIMEOUT);

  it('UT-S11-88: 未知 step 兜底分支同样非排他', () => {
    for (const step of ['', 'some-future-step']) {
      const line = bannerFor(step);
      expect(line, step).toContain('Current proposal step is unknown');
      expect(line, step).toContain('openlogos status');
      expect(line, step).toContain('openlogos next');
      expect(exclusiveHits(line), step).toEqual([]);
      expect(line, step).not.toMatch(/within\b.*\bscope/i);
      expect(line, step).toContain("'feat-x'");
      expect(line, step).toContain(CONFIRM_SENTENCE);
    }
  }, MULTI_RUN_TIMEOUT);

  it('UT-S11-89: 人工会话所需信息项逐项在场', () => {
    const delta = bannerFor('delta-writing');
    const merge = bannerFor('ready-to-merge');
    const coding = bannerFor('coding');
    for (const [step, line] of [['delta-writing', delta], ['ready-to-merge', merge], ['coding', coding]] as const) {
      expect(line, step).toContain("'feat-x'");
      expect(line, step).toContain(`Current proposal step: ${step}`);
      expect(line, step).toContain(CONFIRM_SENTENCE);
    }
    expect(delta).toContain('logos/changes/feat-x/deltas/');
    expect(delta).toContain('[delta]');
    expect(merge).toContain('openlogos merge feat-x');
    expect(merge).toMatch(/explicitly authorize/);
    expect(coding).toContain('logos/changes/feat-x/tasks.md');
    expect(coding).toContain('[code]');
    expect(coding).toContain('update tasks.md when complete');
  }, MULTI_RUN_TIMEOUT);

  it('UT-S11-90: 射程外分支与状态行逐字不变（对照改动前副本）', () => {
    const planState = {
      plan_ready: true, plan_gate_pending: true, plan_approved: false,
      tasks_template_filled: true, tasks_execution_done: 0, tasks_execution_total: 2, tasks_execution_scope: 'delta',
    };
    const cases: Array<[string, StubOpts]> = [
      ['writing', { step: 'writing' }],
      ['writing+ui-overlay', { step: 'writing', uiOverlay: true }],
      ['ready-to-delta', { step: 'ready-to-delta', planState }],
      ['ready-to-delta+ui-overlay', { step: 'ready-to-delta', planState, uiOverlay: true }],
      ['no-guard', { activeChange: null, guard: false }],
    ];
    for (const [name, opts] of cases) {
      const { root, binDir } = stubProject(opts);
      const after = runPhaseJson(PHASE_HOOK, root, binDir);
      const before = runPhaseJson(PHASE_HOOK_BEFORE, root, binDir);
      expect(after.changeLine, name).not.toBe('');
      expect(after.changeLine, name).toBe(before.changeLine);
      expect(after.systemMessage, name).toBe(before.systemMessage);
    }
    // GUARD_STATUS 已知残留：状态行仍为改动前原文
    const { root, binDir } = stubProject({ step: 'coding' });
    const after = runPhaseJson(PHASE_HOOK, root, binDir);
    const before = runPhaseJson(PHASE_HOOK_BEFORE, root, binDir);
    expect(after.systemMessage).toBe(before.systemMessage);
    expect(after.systemMessage).toContain('modify files within the scope of this proposal only.');
  }, MULTI_RUN_TIMEOUT);

  // ── 场景测试 ──────────────────────────────────────────────────────────────

  it('ST-S11-31: status 的 delta-writing 状态驱动 SessionStart 工作重心文案（真实 CLI）', () => {
    const { root, binDir } = realProject('delta-writing');
    expect((realStatus(root).data as Record<string, unknown>).proposal_step).toBe('delta-writing');
    const { changeLine } = runPhaseJson(PHASE_HOOK, root, binDir);
    expect(changeLine).toContain('Current proposal step: delta-writing');
    expect(changeLine).toContain('logos/changes/feat/deltas/**');
    expect(changeLine).toContain('[delta]');
    expect(changeLine).toContain('logos/changes/feat/tasks.md');
    expect(changeLine).toContain('openlogos merge');
    expect(changeLine).toContain('logos/resources/**');
    expect(changeLine).not.toMatch(/Allowed files:/i);
    expect(changeLine).not.toMatch(/do not modify/i);
  }, MULTI_RUN_TIMEOUT);

  it('ST-S11-48: 会话启动于提案 X 的 coding 阶段、随后被派去评审提案 Y 时横幅不再声称排他', () => {
    const { root, binDir } = realProject('coding', 'X');
    mkdirSync(join(root, 'logos', 'changes', 'Y', 'deltas'), { recursive: true });
    expect((realStatus(root).data as Record<string, unknown>).proposal_step).toBe('coding');

    const { changeLine } = runPhaseJson(PHASE_HOOK, root, binDir);
    expect(changeLine).toContain("'X'");
    expect(changeLine).toContain('Current proposal step: coding');
    expect(exclusiveHits(changeLine)).toEqual([]);
    expect(changeLine).not.toMatch(/\[code\] section scope/);

    const guard = runGuard(root, 'Write', {
      file_path: 'logos/changes/Y/reviews/candidates/delta-r1-demo.md',
      content: '# review\n',
    });
    expect(guard.exit).toBe(0);
  }, MULTI_RUN_TIMEOUT);

  it('ST-S11-49: guard-check 判定与 status --format json 输出在改动前后逐字不变', () => {
    const actual: Record<string, unknown> = { guard_check_sha256: sha256(GUARD_CHECK), states: {} };
    for (const state of REAL_STATES) {
      const { root } = realProject(state);
      const status = normalizeStatus(realStatus(root), root);
      const guard = Object.fromEntries(GUARD_INPUTS.map(([name, tool, input]) => [name, runGuard(root, tool, input)]));
      (actual.states as Record<string, unknown>)[state] = { status, guard };
      rmSync(root, { recursive: true, force: true });
    }

    if (process.env.OPENLOGOS_CAPTURE_S11_BANNER_BASELINE === '1') {
      writeFileSync(BASELINE_PATH, JSON.stringify({
        _note: '改动前基线（make-phase-banner-informational）：guard-check 与 CLI 均未被本变更修改，'
          + `易变字段具名剔除：${VOLATILE_STATUS_FIELDS.join(', ')}。禁止手改。`,
        ...actual,
      }, null, 2) + '\n');
    }

    const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as Record<string, unknown>;
    expect(actual.guard_check_sha256).toBe(baseline.guard_check_sha256);
    const baseStates = baseline.states as Record<string, { status: unknown; guard: unknown }>;
    const actStates = actual.states as Record<string, { status: unknown; guard: unknown }>;
    expect(Object.keys(actStates)).toEqual(Object.keys(baseStates));
    for (const state of REAL_STATES) {
      expect(actStates[state].status, `status@${state}`).toEqual(baseStates[state].status);
      expect(actStates[state].guard, `guard@${state}`).toEqual(baseStates[state].guard);
    }
  }, MULTI_RUN_TIMEOUT);
});
