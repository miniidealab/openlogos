import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { detectProposalStep } from '../src/commands/status.js';

function writeLaunchedModule(root: string) {
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }, { lineWidth: 0 }),
  );
}

describe('S05 Unit Tests — next command (initial lifecycle)', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('UT-S05-01: empty project → suggest Phase 1', () => {
    next();
    const out = con.logs.join('\n');
    const hasPhase1 = out.includes('requirements') || out.includes('需求文档');
    expect(hasPhase1).toBe(true);
  });

  it('UT-S05-02: all phases done, lifecycle=initial → suggest launch', () => {
    const dirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      'logos/resources/prd/3-technical-plan/1-architecture',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation',
      'logos/resources/api',
      'logos/resources/database',
      'logos/resources/test',
      'logos/resources/scenario',
      'logos/resources/implementation',
      'logos/resources/verify',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('openlogos launch');
  });

  it('UT-S05-03: uninitialized project → error exit', () => {
    con.restore();
    restoreCwd();
    const { root: emptyRoot, cleanup: clean2 } = makeTempRoot();
    const restore2 = mockCwd(emptyRoot);
    con = captureConsole();

    try {
      expect(() => next()).toThrow('process.exit(1)');
    } finally {
      con.restore();
      restore2();
      clean2();
    }
  });
});

describe('S05 Unit Tests — next command (launched lifecycle, no guard)', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    // Set lifecycle to launched via module
    writeLaunchedModule(root);
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('UT-S05-04: launched lifecycle, no guard → suggest openlogos change', () => {
    next();
    const out = con.logs.join('\n');
    expect(out).toContain('openlogos change');
  });
});

describe('S05 Unit Tests — next command (launched lifecycle, with guard)', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  function setupLaunchedWithGuard(slug: string) {
    writeLaunchedModule(root);

    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: slug, module: 'core', createdAt: new Date().toISOString() }));

    const proposalDir = join(root, 'logos', 'changes', slug);
    mkdirSync(proposalDir, { recursive: true });
    return proposalDir;
  }

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('UT-S05-05: proposal_step=writing → suggest fill proposal', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    // Write template (unfilled)
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n[为什么要做这个变更？]');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks');

    next();
    const out = con.logs.join('\n');
    const hasFillHint = out.includes('proposal') || out.includes('提案');
    expect(hasFillHint).toBe(true);
  });

  it('UT-S05-06: proposal_step=delta-writing → suggest writing deltas', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [ ] task one');

    next();
    const out = con.logs.join('\n');
    expect(detectProposalStep(proposalDir)).toBe('delta-writing');
    expect(out).toMatch(/delta|Delta/);
    expect(out).not.toMatch(/编码实现|Implement Code/);
  });

  it('UT-S05-06b: stock tasks template still counts as writing', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## Phase 1: 文档变更\n- [ ] 更新需求文档的场景和验收条件\n- [ ] 更新产品设计文档的功能规格\n');

    expect(detectProposalStep(proposalDir)).toBe('writing');
  });

  it('UT-S05-06c: real task mentioning 实现代码变更 is not treated as stock template', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n- [x] 实现代码变更（直接修改 src，无需 delta）\n');

    expect(detectProposalStep(proposalDir)).toBe('delta-writing');
  });

  it('UT-S05-07: proposal_step=delta-writing with partial delta tasks → suggest continuing deltas', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [ ] task one\n- [x] task two');
    const deltasDir = join(proposalDir, 'deltas', 'prd');
    mkdirSync(deltasDir, { recursive: true });
    writeFileSync(join(deltasDir, 'delta1.md'), 'delta content');

    next();
    const out = con.logs.join('\n');
    expect(detectProposalStep(proposalDir)).toBe('delta-writing');
    expect(out).toMatch(/delta|Delta/);
  });

  it('UT-S05-07b: unsupported delta folders do not make a proposal ready to merge', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [x] task one\n- [x] task two');
    mkdirSync(join(proposalDir, 'deltas', 'misc'), { recursive: true });
    writeFileSync(join(proposalDir, 'deltas', 'misc', 'delta1.md'), 'delta content');

    expect(detectProposalStep(proposalDir)).toBe('delta-writing');
  });

  it('UT-S05-08: proposal_step=ready-to-merge → suggest openlogos merge', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [x] task one\n- [x] task two');
    const deltasDir = join(proposalDir, 'deltas', 'prd');
    mkdirSync(deltasDir, { recursive: true });
    writeFileSync(join(deltasDir, 'delta1.md'), 'delta content');

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('openlogos merge my-feature');
    // must not use implicit "run X then Y" auto-advance phrasing
    expect(out).not.toMatch(/run `openlogos merge.+then `openlogos archive/);
    expect(out).not.toMatch(/运行 `openlogos merge.+然后 `openlogos archive/);
  });

  it('UT-S05-09: proposal_step=merge-generated → suggest executing MERGE_PROMPT', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [x] task one\n');
    writeFileSync(join(proposalDir, 'MERGE_PROMPT.md'), '# 合并指令');
    writeFileSync(join(proposalDir, 'MERGE_PROMPT_GENERATED'), '');

    expect(detectProposalStep(proposalDir)).toBe('merge-generated');

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('MERGE_PROMPT.md');
    expect(out).not.toContain('openlogos merge my-feature');
  });

  it('UT-S05-10: SPEC_MERGED + [code] section not done → coding', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [ ] 实现 src/xxx',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');

    expect(detectProposalStep(proposalDir)).toBe('coding');

    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/编码|implement/i);
    expect(out).not.toContain('openlogos merge my-feature');
  });

  it('UT-S05-10b: SPEC_MERGED + [code] section all done → ready-to-verify', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 实现 src/xxx',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');

    expect(detectProposalStep(proposalDir)).toBe('ready-to-verify');

    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/verify/i);
  });

  it('UT-S05-10c: SPEC_MERGED + no [code] section → ready-to-verify', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 影响的需求文档：无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [x] task one\n');
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');

    expect(detectProposalStep(proposalDir)).toBe('ready-to-verify');
  });

  it('UT-S05-10d: VERIFY_PASS → verify-passed, suggest archive', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    expect(detectProposalStep(proposalDir)).toBe('verify-passed');

    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/archive/i);
  });

  it('UT-S05-10e: VERIFY_FAIL → verify-failed, suggest fix', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');
    writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');

    expect(detectProposalStep(proposalDir)).toBe('verify-failed');

    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/fix|修复/i);
  });

  it('UT-S05-11: structured [delta] section all checked → ready-to-merge', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件到 deltas/api/ — 更新 API',
      '',
      '## [code] 代码实现',
      '- [ ] 实现代码',
    ].join('\n'));
    const deltasDir = join(proposalDir, 'deltas', 'api');
    mkdirSync(deltasDir, { recursive: true });
    writeFileSync(join(deltasDir, 'core-api.yaml'), 'delta content');

    expect(detectProposalStep(proposalDir)).toBe('ready-to-merge');
  });

  it('UT-S05-12: structured [delta] section partially checked → delta-writing', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件到 deltas/api/ — 更新 API',
      '- [ ] 产出 delta 文件到 deltas/prd/ — 更新需求文档',
      '',
      '## [code] 代码实现',
      '- [ ] 实现代码',
    ].join('\n'));

    expect(detectProposalStep(proposalDir)).toBe('delta-writing');
  });

  it('UT-S05-13: no [delta] section + [code] not done → coding (skips merge)', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [ ] 修复 src/xxx 中的问题',
    ].join('\n'));

    expect(detectProposalStep(proposalDir)).toBe('coding');
  });

  it('UT-S05-13b: no [delta] section + [code] all done → ready-to-verify (skips merge)', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n真实内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 修复 src/xxx 中的问题',
    ].join('\n'));

    expect(detectProposalStep(proposalDir)).toBe('ready-to-verify');
  });

  it('UT-S05-13c: no [delta] section + no [code] section → ready-to-verify (skips merge)', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n真实内容');
    // 新格式但两个 section 都没有（极端情况）
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [other] 其他\n- [x] 某任务\n');

    expect(detectProposalStep(proposalDir)).toBe('ready-to-verify');
  });

  it('UT-S05-14: old format tasks (no section tags) falls back to global allTasksChecked', () => {
    const proposalDir = setupLaunchedWithGuard('my-feature');
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n真实内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n真实内容');
    // 旧格式：无 section 标记，所有任务全勾 + 有 delta 文件 → ready-to-merge
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [x] task one\n- [x] task two\n');
    const deltasDir = join(proposalDir, 'deltas', 'prd');
    mkdirSync(deltasDir, { recursive: true });
    writeFileSync(join(deltasDir, 'delta1.md'), 'delta content');

    expect(detectProposalStep(proposalDir)).toBe('ready-to-merge');
  });
});

describe('S05 Scenario Tests — next --format json', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('ST-S05-01: json output has correct envelope shape', () => {
    next('json');
    const raw = con.logs[0];
    const parsed = JSON.parse(raw);
    expect(parsed.command).toBe('next');
    expect(parsed.version).toBeDefined();
    expect(parsed.data).toBeDefined();
    expect(parsed.data.action).toBeDefined();
    expect('active_change' in parsed.data).toBe(true);
    expect('proposal_step' in parsed.data).toBe(true);
  });

  it('ST-S05-02: json output active_change is null when no guard', () => {
    next('json');
    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.active_change).toBeNull();
    expect(parsed.data.proposal_step).toBeNull();
  });
});
