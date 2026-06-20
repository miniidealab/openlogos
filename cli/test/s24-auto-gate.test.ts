/**
 * S24 next --auto 自动跳过可跳人类确认点（skip-gate）—— 切片 C。
 *
 * 用例 ID 与 logos/resources/test/core-S24-test-cases.md 严格对齐（UT-S24-01~12 / ST-S24-01~06 / ST-S24-EX-2.1）。
 * 核心不变量：默认 next（无 --auto）行为与未引入 --auto 时 1:1 一致，且忽略 GATE_AUTO_PASSED；
 * --auto 仅作用于现有 launched 停顿点（ready-to-merge=propose 出口 gate skippable→放行+追加审计；
 * ready-to-deploy=deliver 入口 gate skippable:false→保持人类停顿；ready-to-smoke 无 gate 不涉及）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { gateForProposalStep } from '../src/lib/flow-derive.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 已填提案（deploy/smoke 经 ## 部署影响 字段控制）。 */
function filled(deploy: '是' | '否' = '否', smoke: '是' | '否' = '否'): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01-feature-specs', '', '## 部署影响',
    `- 是否需要部署：${deploy}`, '- 部署原因：说明', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', `- 是否需要 smoke：${smoke}`, '',
    '## 变更概述', '概述。',
  ].join('\n');
}
const DELTA_DONE = '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta';
const DEPLOY_EMPTY_TASKS = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [deploy] 部署\n';
const DEPLOY_DONE_TASKS = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [deploy] 部署\n- [x] 部署';

interface StepFixture { proposal: string; tasks: string; markers?: string[]; deploy?: boolean; smoke?: boolean; }
const FIXTURES: Record<string, StepFixture> = {
  'ready-to-merge': { proposal: filled(), tasks: DELTA_DONE },
  'ready-to-deploy': { proposal: filled('是', '否'), tasks: DEPLOY_EMPTY_TASKS, markers: ['VERIFY_PASS'], deploy: true },
  'ready-to-smoke': { proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'], deploy: true, smoke: true },
};

interface Ctx { root: string; dir: string; auditPath: string; con: ReturnType<typeof captureConsole>; }

/** 建一个 launched 项目，活跃提案处于指定 proposal_step，并接管 cwd/console/exit。 */
function setup(step: keyof typeof FIXTURES, slug = 'feat'): Ctx {
  const fx = FIXTURES[step];
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      deployment_gates: { core: { deployment_required: Boolean(fx.deploy), smoke_required: Boolean(fx.smoke) } },
    }, { lineWidth: 0 }),
  );
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-06-20T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), fx.proposal);
  writeFileSync(join(dir, 'tasks.md'), fx.tasks);
  for (const mk of fx.markers ?? []) writeFileSync(join(dir, mk), '');

  const restoreCwd = mockCwd(root);
  const con = captureConsole();
  const exitSpy = mockProcessExit();
  cleanups.push(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });
  return { root, dir, auditPath: join(dir, 'GATE_AUTO_PASSED'), con };
}

/** 解析最后一行 JSON envelope 的 data。 */
function jsonData(con: ReturnType<typeof captureConsole>): Record<string, unknown> {
  const last = con.logs[con.logs.length - 1];
  return JSON.parse(last).data;
}
function auditLines(p: string): string[] {
  return existsSync(p) ? readFileSync(p, 'utf-8').split('\n').filter(Boolean) : [];
}

// ── 一、gate 助手 UT ──
describe('S24 gate 助手（gateForProposalStep）', () => {
  it('UT-S24-01: ready-to-merge → propose 出口 gate skippable:true', () => {
    expect(gateForProposalStep('ready-to-merge')).toEqual({ gate_id: 'propose-exit', skippable: true });
  });
  it('UT-S24-02: ready-to-deploy → deliver 入口 gate skippable:false', () => {
    expect(gateForProposalStep('ready-to-deploy')).toEqual({ gate_id: 'deliver-entry', skippable: false });
  });
  it('UT-S24-03: ready-to-smoke 无对应 gate（不在 --auto 范围）', () => {
    expect(gateForProposalStep('ready-to-smoke')).toBeNull();
  });
});

// ── 二、next --auto 行为 UT ──
describe('S24 next --auto 行为', () => {
  it('UT-S24-04: ready-to-merge + --auto 放行并输出 merge 下一步建议', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_auto_passed).toBe(true);
    expect(d.command).toBe('openlogos merge feat');
  });

  it('UT-S24-05: ready-to-merge + --auto 追加 GATE_AUTO_PASSED 一行', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
  });

  it('UT-S24-06: ready-to-deploy + --auto 保持停顿不写审计', () => {
    const ctx = setup('ready-to-deploy');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_auto_passed).toBe(false);
    expect(d.skippable).toBe(false);
    expect(existsSync(ctx.auditPath)).toBe(false);
  });

  it('UT-S24-07: 重复 --auto 追加多行（不去重）', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    next('json', undefined, true);
    expect(auditLines(ctx.auditPath)).toHaveLength(2);
  });

  it('UT-S24-08: 默认 next 忽略 GATE_AUTO_PASSED 不越过 gate', () => {
    const ctx = setup('ready-to-merge');
    // 预置审计文件后，默认 next 仍应停在 ready-to-merge，且不含 auto 字段
    writeFileSync(ctx.auditPath,
      JSON.stringify({ gate_id: 'propose-exit', proposal_step: 'ready-to-merge', timestamp: '2026-06-20T00:00:00.000Z' }) + '\n');
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('ready-to-merge');
    expect(d.auto).toBeUndefined();
    expect(d.gate_id).toBeUndefined();
    expect(d.gate_auto_passed).toBeUndefined();
  });

  it('UT-S24-09: 重复 --auto 后默认 next 派生不变（幂等=派生不受审计行数影响）', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    next('json', undefined, true);
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    expect(jsonData(ctx.con).proposal_step).toBe('ready-to-merge');
    expect(auditLines(ctx.auditPath)).toHaveLength(2); // 默认 next 不写审计
  });

  it('UT-S24-10: GATE_AUTO_PASSED 每行 schema 含 gate_id/proposal_step/timestamp', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    const rec = JSON.parse(auditLines(ctx.auditPath)[0]);
    expect(Object.keys(rec).sort()).toEqual(['gate_id', 'proposal_step', 'timestamp']);
    expect(rec.gate_id).toBe('propose-exit');
    expect(rec.proposal_step).toBe('ready-to-merge');
    expect(typeof rec.timestamp).toBe('string');
  });

  it('UT-S24-11: ready-to-smoke + --auto 与默认 next 一致（无 gate、不写审计）', () => {
    const ctx = setup('ready-to-smoke');
    next('json', undefined, true);
    const autoData = jsonData(ctx.con);
    expect(autoData.gate_id).toBeNull();
    expect(autoData.gate_auto_passed).toBe(false);
    expect(existsSync(ctx.auditPath)).toBe(false);
    // action/command 与默认 next 等价
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const def = jsonData(ctx.con);
    expect(autoData.action).toBe(def.action);
    expect(autoData.command).toBe(def.command);
    expect(autoData.proposal_step).toBe(def.proposal_step);
  });

  it('UT-S24-12: --auto 的 JSON 附带 gate 字段；默认 next 不附带且 data 1:1', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    const autoData = jsonData(ctx.con);
    expect(autoData).toMatchObject({ auto: true, gate_id: 'propose-exit', skippable: true, gate_auto_passed: true });

    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const def = jsonData(ctx.con);
    for (const k of ['auto', 'gate_id', 'skippable', 'gate_auto_passed']) expect(def[k]).toBeUndefined();
    expect(def.proposal_step).toBe('ready-to-merge');
  });
});

// ── 三、场景测试 ──
describe('S24 场景测试', () => {
  it('ST-S24-01: ready-to-merge 在 --auto 下放行并留痕', () => {
    const ctx = setup('ready-to-merge');
    next('text', undefined, true);
    const out = ctx.con.logs.join('\n');
    expect(out).toContain('propose-exit');
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
  });

  it('ST-S24-02: ready-to-deploy 在 --auto 下仍卡住（不写审计）', () => {
    const ctx = setup('ready-to-deploy');
    next('json', undefined, true);
    expect(jsonData(ctx.con).gate_auto_passed).toBe(false);
    expect(existsSync(ctx.auditPath)).toBe(false);
  });

  it('ST-S24-03: 默认 next 忽略 GATE_AUTO_PASSED 不越过 gate', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true); // 先放行留下审计
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    expect(jsonData(ctx.con).proposal_step).toBe('ready-to-merge');
  });

  it('ST-S24-04: 重复 --auto 追加多行且默认派生不变', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    next('json', undefined, true);
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    expect(jsonData(ctx.con).proposal_step).toBe('ready-to-merge');
    expect(auditLines(ctx.auditPath)).toHaveLength(2);
  });

  it('ST-S24-05: 默认 next JSON 零漂移（不含任何 --auto gate 字段）', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect('auto' in d).toBe(false);
    expect('gate_id' in d).toBe(false);
    expect('skippable' in d).toBe(false);
    expect('gate_auto_passed' in d).toBe(false);
  });

  it('ST-S24-06: 审计 JSONL 内容可被消费（合法 JSON + 三字段）', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    for (const line of auditLines(ctx.auditPath)) {
      const rec = JSON.parse(line);
      expect(rec.gate_id).toBe('propose-exit');
      expect(rec.proposal_step).toBe('ready-to-merge');
      expect(rec.timestamp).toBeTruthy();
    }
  });
});

// ── 四、异常 ──
describe('S24 异常', () => {
  it('ST-S24-EX-2.1: 未初始化项目 next --auto 沿用既有错误语义，不写审计', () => {
    const { root, cleanup } = makeTempRoot();
    const restoreCwd = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    cleanups.push(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });
    expect(() => next('json', undefined, true)).toThrow('process.exit(1)');
    expect(existsSync(join(root, 'logos', 'changes', 'feat', 'GATE_AUTO_PASSED'))).toBe(false);
  });
});
