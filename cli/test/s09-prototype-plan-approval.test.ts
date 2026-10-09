/**
 * S09 原型任务勾选不越过 plan 批准门（fix-prototype-plan-approval-state）。
 *
 * 用例 ID 与 logos/resources/test/core-S09-test-cases.md「S09 原型任务勾选不越过 plan 批准门测试」严格对齐：
 * UT-S09-421～UT-S09-428、ST-S09-193～ST-S09-195。OpenLogos reporter 按测试名中的 ID 写入 test-results.jsonl。
 *
 * 全部断言走真实 CLI 进程（cli/dist/index.js，由 globalSetup 预构建）读取最终 proposal_step / plan_state，
 * guard 步骤以宿主 PreToolUse stdin 驱动部署到临时项目 .claude/openlogos/bin/ 的托管 guard-check。
 *
 * 「plan-exit 门前」的判定口径：现有 next 契约在 ready-to-delta 以 `step_meta.kind=="gate"` +「批准方案」表达门，
 * `next_node` 指向门后的 write-delta（修复前非 GUI 零勾选的 ready-to-delta 即如此，宿主据 kind 不派发）。
 * 故门前等待以 proposal_step / step_meta.kind / plan_gate_pending 及「默认 next 不消费批准、不写审计」判定，不以 next_node 缺席判定。
 * 已合并 ST-S09-193 / ST-S09-194 步骤②「不返回 next_node.id=="write-delta"」与上述既有契约冲突（code 评审 r1 F1），
 * 规格更正待人类经规格修订流程决定；本文件不断言 next_node 的门前取值，避免把任一口径钉成既成事实。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, copyFileSync, chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot } from './helpers.js';
import { readPlanApproved, classifyProvenance } from '../src/lib/ui-provenance.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const GUARD_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-check');
const ENGINE_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-post-check.cjs');
const SLUG = 'feat';
const PROTO = 'deltas/prd/2-product-design/2-page-design/core-01-home.html';
const PROTO_2 = 'deltas/prd/2-product-design/2-page-design/core-02-list.html';
const FEATURE_DELTA = 'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';
const ST_TIMEOUT = 60_000;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// ── 夹具 ────────────────────────────────────────────────────────────────────

function proposalMd(uiImpact: boolean): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新页面。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01-feature-specs', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：说明', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## UI/UX 变更声明', '', '```yaml', `ui_impact: ${uiImpact}`, 'design_system_mode: generated',
    'design_system_fallback_reason: ""', 'pages:', '  - id: home', '    prototype: core-01-home.html',
    '    description: 首页', '```', '',
    '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
    'impacts:', '  data: {status: none, reason: "无"}', '  compatibility: {status: none, reason: "无"}',
    '  security_privacy: {status: none, reason: "无"}', '  public_release: {status: none, reason: "无"}',
    '  external_commitment: {status: none, reason: "无"}', 'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
    '## 变更概述', '概述。', '', '## 复用测试 ID', '', '- UT-S09-01 — 回归覆盖', '',
  ].join('\n');
}

const CODE_PROPOSAL = proposalMd(true)
  .replace('## 变更类型\n设计级', '## 变更类型\n代码级修复')
  .replace('## 变更概述\n概述。', '## 变更概述\n需要 CLI 状态派生代码、测试和 reporter 实现。');

const UNFILLED_PROPOSAL = '# 变更提案：feat\n\n## 变更原因\n[为什么要做这个变更？]\n';

/** `[delta]` 任务清单：items 为 [是否勾选, 文本]。 */
function tasksMd(items: Array<[boolean, string]>): string {
  return ['# 实现任务', '', '## [delta] 规格变更', ...items.map(([c, t]) => `- [${c ? 'x' : ' '}] ${t}`), ''].join('\n');
}
/** 事故形态：7 条 [delta]，第 3 条为原型（checkedProto 控制是否勾选）。 */
function sevenTasks(checkedProto: boolean): string {
  return tasksMd([
    [false, '产出需求 delta'], [false, '产出功能规格 delta'], [checkedProto, `产出 \`${PROTO}\` — 原型`],
    [false, '产出场景 delta'], [false, '产出测试 delta'], [false, '产出部署 delta'], [false, '产出 smoke delta'],
  ]);
}
const ONE_PROTO_CHECKED = tasksMd([[true, `产出 \`${PROTO}\` — 原型`]]);
const TWO_PROTO_CHECKED = tasksMd([[true, `产出 \`${PROTO}\` — 原型`], [true, `产出 \`${PROTO_2}\` — 原型`]]);
const MIXED_PARTIAL = tasksMd([[true, `产出 \`${PROTO}\` — 原型`], [false, `产出 \`${FEATURE_DELTA}\``]]);
const MIXED_ALL = tasksMd([[true, `产出 \`${PROTO}\` — 原型`], [true, `产出 \`${FEATURE_DELTA}\``]]);
const PARTIAL_TWO = tasksMd([[true, `产出 \`${PROTO}\` — 原型`], [false, '产出功能规格 delta']]);
const ZERO_TWO = tasksMd([[false, `产出 \`${PROTO}\` — 原型`], [false, '产出功能规格 delta']]);
const CODE_ONLY_TASKS = '# 实现任务\n\n## [code] 代码实现\n（占位：切片由 slice-planner 写入。）\n';

const PROTO_CONTENT = '<html>proto</html>';
/** 合法 provenance body：pages 与原型文件名一致，hashes 为原型真实字节的 64-hex sha256（无前缀）。 */
const VALID_BODY = JSON.stringify({
  ui_prototype_rendered: true,
  pages: ['core-01-home.html'],
  hashes: { 'core-01-home.html': createHash('sha256').update(PROTO_CONTENT).digest('hex') },
});

/** 夹具自检：预置的合法 body 必须被现有 reader / classifier 判为非 malformed 的 full 记录。 */
function expectFullProvenance(dir: string) {
  const prov = readPlanApproved(dir);
  expect(prov.malformed).not.toBe(true);
  expect(classifyProvenance(prov)).toBe('full');
}

interface FixtureOpts {
  productType?: string;
  proposal?: string;
  tasks: string;
  /** 提案目录内相对路径 → 内容（delta、前置 marker）。 */
  files?: Record<string, string>;
  /** 部署托管 guard 到 .claude/openlogos/bin/。 */
  guard?: boolean;
}

/** 一次性隔离 launched 项目；返回项目根与提案目录。 */
function fixture(o: FixtureOpts): { root: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  const put = (rel: string, content: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  put('logos/logos.config.json', JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  put('logos/logos-project.yaml', [
    'project:', '  name: "t"', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
    `    product_type: ${o.productType ?? 'web'}`, 'deployment_gates:', '  core:',
    '    deployment_required: false', '    smoke_required: false', 'resource_index: []', '',
  ].join('\n'));
  mkdirSync(join(root, 'logos', 'changes', 'archive'), { recursive: true });
  put('logos/resources/test/core-S09-test-cases.md', '| ID | 用例 |\n|---|---|\n| UT-S09-01 | 回归 |\n');
  put('logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const dir = join(root, 'logos', 'changes', SLUG);
  put(`logos/changes/${SLUG}/proposal.md`, o.proposal ?? proposalMd(true));
  put(`logos/changes/${SLUG}/tasks.md`, o.tasks);
  for (const [rel, content] of Object.entries(o.files ?? {})) put(`logos/changes/${SLUG}/${rel}`, content);
  if (o.guard) {
    const bin = join(root, '.claude', 'openlogos', 'bin');
    mkdirSync(bin, { recursive: true });
    copyFileSync(GUARD_SRC, join(bin, 'guard-check'));
    copyFileSync(ENGINE_SRC, join(bin, 'guard-post-check.cjs'));
    chmodSync(join(bin, 'guard-check'), 0o755);
  }
  return { root, dir };
}

const PROTO_FILE = { [PROTO]: PROTO_CONTENT };

// ── 真实进程驱动 ─────────────────────────────────────────────────────────────

function cli(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--format', 'json'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, json: JSON.parse(r.stdout) as { data: Record<string, any> } };
}

function statusOf(root: string) {
  const r = cli(root, ['status']);
  expect(r.status).toBe(0);
  const ac = r.json.data.modules[0].active_change;
  return { step: ac.proposal_step as string, plan: ac.plan_state as Record<string, any> };
}

function nextOf(root: string, auto = false) {
  const r = cli(root, auto ? ['next', '--auto'] : ['next']);
  expect(r.status).toBe(0);
  const d = r.json.data;
  const m = d.modules[0];
  return {
    step: m.proposal_step as string,
    kind: m.step_meta?.kind as string | undefined,
    nextNode: m.next_node?.id as string | undefined,
    gateAutoPassed: d.gate_auto_passed === true,
    gateId: d.gate_id as string | undefined,
    planGatePending: m.plan_state?.plan_gate_pending as boolean | undefined,
    planApproved: m.plan_state?.plan_approved as boolean | undefined,
  };
}

/** 宿主真实 PreToolUse stdin 驱动临时项目的托管 guard-check。 */
function guardWrite(root: string, relInProposal: string, toolUseId: string) {
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: join(root, 'logos', 'changes', SLUG, relInProposal), content: '# x' },
    tool_use_id: toolUseId,
    session_id: 'st-s09-prototype',
    cwd: root,
  });
  const r = spawnSync('bash', [join(root, '.claude', 'openlogos', 'bin', 'guard-check')], {
    input, cwd: root, encoding: 'utf8', timeout: 15_000, env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '' };
}

function sha(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function dirDigest(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p, `${rel}${name.name}/`);
      else h.update(`${rel}${name.name}\0`).update(readFileSync(p)).update('\0');
    }
  };
  walk(dir, '');
  return h.digest('hex');
}
function planExitLines(dir: string): Array<Record<string, string>> {
  const p = join(dir, 'GATE_AUTO_PASSED');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => l.gate_id === 'plan-exit');
}

/** proposal_step + plan_state 关键字段（修复前后比对口径）。 */
function stateTuple(root: string): unknown[] {
  const { step, plan } = statusOf(root);
  return [step, plan.plan_ready, plan.plan_gate_pending, plan.plan_approved,
    plan.tasks_execution_done, plan.tasks_execution_total, plan.tasks_execution_scope];
}

function expectGatePending(root: string) {
  const { step, plan } = statusOf(root);
  expect(step).toBe('ready-to-delta');
  expect(plan.plan_ready).toBe(true);
  expect(plan.plan_gate_pending).toBe(true);
  expect(plan.plan_approved).toBe(false);
}

// ── 单元测试 ─────────────────────────────────────────────────────────────────

describe('S09 原型任务勾选不越过 plan 批准门 — 单元测试', () => {
  it('UT-S09-421: 零勾选、仅原型、无批准仍驻留 plan（回归）', () => {
    const { root } = fixture({ tasks: sevenTasks(false), files: PROTO_FILE });
    expectGatePending(root);
  });

  it('UT-S09-422: 部分勾选（7 条只勾原型 1 条）、仅原型、无批准不进入 delta-writing', () => {
    const { root } = fixture({ tasks: sevenTasks(true), files: PROTO_FILE });
    // 修复前：delta-writing / plan_approved=true（事故形态）
    expectGatePending(root);
  });

  it('UT-S09-423: 全部勾选、仅原型、无批准不进入 ready-to-merge（单原型与双原型两臂）', () => {
    const one = fixture({ tasks: ONE_PROTO_CHECKED, files: PROTO_FILE });
    expectGatePending(one.root); // 修复前：ready-to-merge / plan_approved=true
    const two = fixture({ tasks: TWO_PROTO_CHECKED, files: { [PROTO]: '<html>a</html>', [PROTO_2]: '<html>b</html>' } });
    expectGatePending(two.root);
  });

  it('UT-S09-424: 已批准（空 marker / 合法 provenance body）后沿用既有完成语义，派生不改写批准文件', () => {
    for (const body of ['', VALID_BODY]) {
      for (const [tasks, expected] of [[PARTIAL_TWO, 'delta-writing'], [ONE_PROTO_CHECKED, 'ready-to-merge']] as const) {
        // 「已批准」为前置状态：允许前置构造批准文件（已合并规格的批准文件来源规则）
        const { root, dir } = fixture({ tasks, files: { ...PROTO_FILE, PLAN_APPROVED: body } });
        if (body) expectFullProvenance(dir);
        const before = sha(join(dir, 'PLAN_APPROVED'));
        const { step, plan } = statusOf(root);
        expect(step).toBe(expected);
        expect(plan.plan_approved).toBe(true);
        expect(plan.plan_gate_pending).toBe(false);
        expect(sha(join(dir, 'PLAN_APPROVED'))).toBe(before);
      }
    }
  });

  it('UT-S09-425: 混合非原型 delta 照常进入 spec（与修复前逐字一致）', () => {
    const files = { ...PROTO_FILE, [FEATURE_DELTA]: '# spec' };
    // 期望值取自修复前实现（0.15.18）对同一夹具的派生结果
    expect(stateTuple(fixture({ tasks: MIXED_PARTIAL, files }).root))
      .toEqual(['delta-writing', true, false, true, 1, 2, 'delta']);
    expect(stateTuple(fixture({ tasks: MIXED_ALL, files }).root))
      .toEqual(['ready-to-merge', true, false, true, 2, 2, 'delta']);
  });

  it('UT-S09-426: 非 GUI 与 ui_impact:false 判据逐字节不变（固定期望值取自修复前实现）', () => {
    // ① 非 GUI、[delta] 已勾但零 delta 文件、无批准
    expect(stateTuple(fixture({ productType: 'cli', tasks: PARTIAL_TWO }).root))
      .toEqual(['delta-writing', true, false, true, 1, 2, 'delta']);
    // ② 非 GUI、零勾选零 delta 文件、无批准
    expect(stateTuple(fixture({ productType: 'cli', tasks: ZERO_TWO }).root))
      .toEqual(['ready-to-delta', true, true, false, 0, 2, 'delta']);
    // ③ GUI 但 ui_impact:false、仅原型 html、已勾、无批准
    expect(stateTuple(fixture({ proposal: proposalMd(false), tasks: PARTIAL_TWO, files: PROTO_FILE }).root))
      .toEqual(['delta-writing', true, false, true, 1, 2, 'delta']);
  });

  it('UT-S09-427: 纯代码、未脱模板与更高优先级出口不受影响，不依据历史审计推断批准', () => {
    // ① 无 [delta]、含空 [code] 的纯代码提案
    expect(stateTuple(fixture({ proposal: CODE_PROPOSAL, tasks: CODE_ONLY_TASKS }).root))
      .toEqual(['spec-complete-required', true, false, true, 0, 0, 'code']);
    // ② proposal 未脱模板
    expect(stateTuple(fixture({ proposal: UNFILLED_PROPOSAL, tasks: PARTIAL_TWO, files: PROTO_FILE }).root))
      .toEqual(['writing', false, false, false, 1, 2, 'delta']);
    // ③ GUI 仅原型部分勾选 + SPEC_MERGED：更高优先级出口，不被拉回 ready-to-delta
    expect(stateTuple(fixture({ tasks: PARTIAL_TWO, files: { ...PROTO_FILE, SPEC_MERGED: '' } }).root))
      .toEqual(['ready-to-verify', true, false, true, 1, 2, 'delta']);
    // ④ GUI 仅原型部分勾选 + VERIFY_PASS
    expect(stateTuple(fixture({ tasks: PARTIAL_TWO, files: { ...PROTO_FILE, VERIFY_PASS: '' } }).root))
      .toEqual(['verify-passed', true, false, true, 1, 2, 'delta']);
    // 历史审计不构成批准：只有 GATE_AUTO_PASSED、无 PLAN_APPROVED 时仍驻留 plan
    const audit = JSON.stringify({ gate_id: 'plan-exit', proposal_step: 'ready-to-delta', timestamp: '2026-10-08T00:00:00.000Z' }) + '\n';
    expectGatePending(fixture({ tasks: sevenTasks(true), files: { ...PROTO_FILE, GATE_AUTO_PASSED: audit } }).root);
  });

  it('UT-S09-428: status 只读——三个无批准夹具连续两次真实 status，提案目录零变化', () => {
    const fixtures = [
      fixture({ tasks: sevenTasks(false), files: PROTO_FILE }),
      fixture({ tasks: sevenTasks(true), files: PROTO_FILE }),
      fixture({ tasks: ONE_PROTO_CHECKED, files: PROTO_FILE }),
    ];
    for (const { root, dir } of fixtures) {
      const before = dirDigest(dir);
      const first = stateTuple(root);
      const second = stateTuple(root);
      expect(second).toEqual(first);
      expect(dirDigest(dir)).toBe(before);
      expect(existsSync(join(dir, 'PLAN_APPROVED'))).toBe(false);
      expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false);
    }
  });
});

// ── 场景测试 ─────────────────────────────────────────────────────────────────

/** ST-S09-193 / ST-S09-194 共用的完整命令链 ①～⑦，返回步骤 ⑦ 的 status。 */
function runApprovalChain(root: string, dir: string, label: string) {
  // ① 真实 status：门前驻留
  expectGatePending(root);
  // ② 真实默认 next：停在 plan-exit 门——step_meta.kind=gate、plan_gate_pending=true、未自动放行，
  //    且不消费批准、不写审计（批准文件与 GATE_AUTO_PASSED 均不产生）
  const n = nextOf(root);
  expect(n.step).toBe('ready-to-delta');
  expect(n.kind).toBe('gate');
  expect(n.planGatePending).toBe(true);
  expect(n.planApproved).toBe(false);
  expect(n.gateAutoPassed).toBe(false);
  expect(existsSync(join(dir, 'PLAN_APPROVED'))).toBe(false);
  expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false);
  // ③ 批准前：托管 guard 拒绝非原型 delta
  const denied = guardWrite(root, FEATURE_DELTA, `${label}-pre`);
  expect(denied.exitCode).toBe(2);
  expect(JSON.parse(denied.stdout).reason).toContain('plan 阶段');
  // ④ 真实 next --auto：消费 plan-exit，本次响应按 R4 返回 write-delta
  const a = nextOf(root, true);
  expect(a.gateAutoPassed).toBe(true);
  expect(a.gateId).toBe('plan-exit');
  expect(a.nextNode).toBe('write-delta');
  // ⑤ 批准文件与审计在放行之前落盘
  expect(existsSync(join(dir, 'PLAN_APPROVED'))).toBe(true);
  const lines = planExitLines(dir);
  expect(lines).toHaveLength(1);
  expect(lines[0].proposal_step).toBe('ready-to-delta');
  // ⑥ 批准后：同一写入被托管 guard 放行
  expect(guardWrite(root, FEATURE_DELTA, `${label}-post`).exitCode).toBe(0);
  // ⑦ 重新派生
  return statusOf(root);
}

describe('S09 原型任务勾选不越过 plan 批准门 — 场景测试', () => {
  it('ST-S09-193: 零勾选（臂 a）与部分勾选（臂 b）两臂端到端，批准先于非原型写入', () => {
    for (const [label, checked] of [['arm-a', false], ['arm-b', true]] as const) {
      // 顺序类 ST：auto 前不预置 PLAN_APPROVED / GATE_AUTO_PASSED；两臂独立夹具
      const { root, dir } = fixture({ tasks: sevenTasks(checked), files: PROTO_FILE, guard: true });
      const after = runApprovalChain(root, dir, label);
      expect(after.step).toBe('delta-writing');
      expect(after.plan.plan_approved).toBe(true);
    }
  }, ST_TIMEOUT);

  it('ST-S09-194: 全部勾选形态端到端，批准前后 guard 一致，批准后重新派生为 ready-to-merge', () => {
    const { root, dir } = fixture({ tasks: ONE_PROTO_CHECKED, files: PROTO_FILE, guard: true });
    const after = runApprovalChain(root, dir, 'all-checked');
    expect(after.step).toBe('ready-to-merge');
    expect(after.plan.plan_approved).toBe(true);
    // ⑧ 真实默认 next：前沿为 spec 出口门，不再指向 write-delta
    const n = nextOf(root);
    expect(n.step).toBe('ready-to-merge');
    expect(n.kind).toBe('gate');
    expect(n.nextNode).not.toBe('write-delta');
  }, ST_TIMEOUT);

  it('ST-S09-195: auto 消费幂等且不覆盖合法 provenance body', () => {
    // 夹具 A：无批准，连续两次 auto
    const A = fixture({ tasks: sevenTasks(true), files: PROTO_FILE });
    expect(nextOf(A.root, true).gateAutoPassed).toBe(true);
    const second = nextOf(A.root, true);
    expect(second.gateAutoPassed).toBe(false);
    expect(planExitLines(A.dir)).toHaveLength(1);
    // 夹具 B：已有合法 provenance body（前置状态，允许预置）
    const B = fixture({ tasks: sevenTasks(true), files: { ...PROTO_FILE, PLAN_APPROVED: VALID_BODY } });
    expectFullProvenance(B.dir);
    const before = sha(join(B.dir, 'PLAN_APPROVED'));
    for (let i = 0; i < 2; i++) expect(nextOf(B.root, true).step).toBe('delta-writing');
    expect(sha(join(B.dir, 'PLAN_APPROVED'))).toBe(before);
    expect(planExitLines(B.dir)).toHaveLength(0);
  }, ST_TIMEOUT);
});
