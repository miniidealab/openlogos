/**
 * golden-baseline — characterization 快照，锁定现有 status / next --format json 的输出。
 *
 * 目的（见 docs/orchestratable-flow-verification.md、core-S11/S05/S16 test-cases 的 golden 归属）：
 * 在切片 B（status/next 改为从 flow 派生）前，把当前真实输出录成基线快照；切片 B 若导致
 * JSON 输出漂移，本快照将立即失败 —— 这是"1:1 不改行为"的等价锚点。
 *
 * 这些用例**不使用 UT-/ST- 编号**：它们表征既有 S05/S11/S16 行为，不是新增规格用例，
 * 故不纳入 verify 覆盖统计（OpenLogos reporter 仅提取带编号的用例）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { status } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function fixture(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  return root;
}

function runJson(root: string, fn: () => void): unknown {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  try {
    fn();
  } finally {
    cap.restore();
    restoreCwd();
  }
  return JSON.parse(cap.logs[0]).data;
}

function setLaunchedModule(root: string) {
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n',
  );
}

const FILLED_PROPOSAL = [
  '# 变更提案：feat', '',
  '## 变更原因', '需要一个新能力。', '',
  '## 变更类型', '设计级', '',
  '## 变更范围', '- 影响的功能规格：core-01-feature-specs', '',
  '## 部署影响',
  '- 是否需要部署：否',
  '- 部署原因：纯文档变更',
  '- 影响环境：无',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：否',
  '- 是否需要 smoke：否', '',
  '## 变更概述', '新增能力的概述。',
].join('\n');

const DELTA_TASKS = ['# 实现任务', '', '## [delta] 规格变更', '- [ ] 产出 delta 文件到 deltas/spec/x.md — 更新规格'].join('\n');

function addDeltaProposal(root: string, slug = 'feat') {
  mkdirSync(join(root, 'logos', 'changes', slug, 'deltas'), { recursive: true });
  writeFileSync(join(root, 'logos', 'changes', slug, 'proposal.md'), FILLED_PROPOSAL);
  writeFileSync(join(root, 'logos', 'changes', slug, 'tasks.md'), DELTA_TASKS);
}

function setAdoptedModule(root: string) {
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n    bootstrap: adopted\n',
  );
}

const PURE_CODE_TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [ ] 实现 src/x.ts 的逻辑'].join('\n');

function addPureCodeProposal(root: string, slug = 'codeonly') {
  mkdirSync(join(root, 'logos', 'changes', slug, 'deltas'), { recursive: true });
  writeFileSync(join(root, 'logos', 'changes', slug, 'proposal.md'), FILLED_PROPOSAL);
  writeFileSync(join(root, 'logos', 'changes', slug, 'tasks.md'), PURE_CODE_TASKS);
}

describe('golden-baseline: status/next JSON characterization', () => {
  it('golden: 全新 initial 项目 — status', () => {
    expect(runJson(fixture(), () => status('json'))).toMatchSnapshot();
  });

  it('golden: 全新 initial 项目 — next', () => {
    expect(runJson(fixture(), () => next('json'))).toMatchSnapshot();
  });

  it('golden: initial 项目含 phase-1 产物 — status', () => {
    const root = fixture();
    writeFileSync(join(root, 'logos/resources/prd/1-product-requirements/core-01-requirements.md'), '# req\n');
    expect(runJson(root, () => status('json'))).toMatchSnapshot();
  });

  it('golden: launched 模块无活跃提案 — status', () => {
    const root = fixture();
    setLaunchedModule(root);
    expect(runJson(root, () => status('json'))).toMatchSnapshot();
  });

  it('golden: launched 模块 + delta-writing 提案 — status', () => {
    const root = fixture();
    setLaunchedModule(root);
    addDeltaProposal(root);
    expect(runJson(root, () => status('json'))).toMatchSnapshot();
  });

  it('golden: launched 模块 + delta-writing 提案 — next', () => {
    const root = fixture();
    setLaunchedModule(root);
    addDeltaProposal(root);
    expect(runJson(root, () => next('json'))).toMatchSnapshot();
  });

  it('golden: initial-adopted 项目 — status', () => {
    const root = fixture();
    setAdoptedModule(root);
    expect(runJson(root, () => status('json'))).toMatchSnapshot();
  });

  it('golden: launched + ready-to-merge 提案（delta 全勾）— status', () => {
    const root = fixture();
    setLaunchedModule(root);
    addDeltaProposal(root);
    // 勾选 delta 任务 → ready-to-merge
    writeFileSync(
      join(root, 'logos', 'changes', 'feat', 'tasks.md'),
      DELTA_TASKS.replace('- [ ] ', '- [x] '),
    );
    expect(runJson(root, () => status('json'))).toMatchSnapshot();
  });

  it('golden: launched + 纯代码提案（无 [delta]）— status', () => {
    const root = fixture();
    setLaunchedModule(root);
    addPureCodeProposal(root);
    expect(runJson(root, () => status('json'))).toMatchSnapshot();
  });
});
