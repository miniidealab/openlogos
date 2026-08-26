/**
 * Plan Package 在 status / next / flow 的同源契约回归。
 * 测试结果由全局 OpenLogos reporter 写入 test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { collectStatusData } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { detectProposalStepViaFlow } from '../src/lib/flow-derive.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { PLAN_PACKAGE_CLI_CONTRACT_VERSION } from '../src/lib/plan-package-contract.js';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, withCompleteClarification } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function proposal(): string {
  return withCompleteClarification([
    '# 变更提案：plan-contract', '',
    '## 变更原因', '修复计划包收敛故障。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI 状态契约', '',
    '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：仅本地测试', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '让四个消费者共享同一 evaluation。',
  ].join('\n'));
}

function tasks(): string {
  return '# 任务\n\n## [delta] 规格变更\n- [ ] 更新规格\n\n## [code] 代码实现\n';
}

function fixture(options: { proposal?: string; tasks?: string; marker?: string } = {}) {
  const made = makeTempRoot(); cleanups.push(made.cleanup);
  scaffoldProject(made.root, { locale: 'zh' });
  writeFileSync(join(made.root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
  }));
  writeFileSync(join(made.root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'plan-contract', module: 'core' }));
  const dir = join(made.root, 'logos', 'changes', 'plan-contract');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), options.proposal ?? proposal());
  writeFileSync(join(dir, 'tasks.md'), options.tasks ?? tasks());
  if (options.marker) writeFileSync(join(dir, options.marker), '{}');
  return { root: made.root, dir };
}

async function nextData(root: string): Promise<any> {
  const restore = mockCwd(root); const consoleCapture = captureConsole(); const exit = mockProcessExit();
  try { await next('json'); } finally { consoleCapture.restore(); exit.mockRestore(); restore(); }
  return JSON.parse(consoleCapture.logs.at(-1)!).data;
}

function snapshot(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name); const stat = statSync(path);
      hash.update(path.slice(root.length));
      if (stat.isDirectory()) walk(path); else hash.update(readFileSync(path));
    }
  };
  walk(root); return hash.digest('hex');
}

describe('S05 Plan Package next 契约', () => {
  it('UT-S05-30: ready evaluation 推进 plan 前沿', () => {
    const f = fixture();
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(true);
    expect(detectProposalStepViaFlow(f.dir)).toBe('ready-to-delta');
  });

  it('UT-S05-31: 非 ready 保持 writing', async () => {
    const f = fixture({ proposal: proposal().replace('## 变更概述', '## 核心设计') });
    const data = await nextData(f.root);
    expect(data.modules[0].proposal_step).toBe('writing');
    expect(data.modules[0].plan_state.completion_issues).toContainEqual(expect.objectContaining({ code: 'proposal_required_section_missing' }));
  });

  it('UT-S05-32: completion command 自描述', async () => {
    const f = fixture({ proposal: proposal().replace('让四个消费者共享同一 evaluation。', '<!-- empty -->') });
    const node = (await nextData(f.root)).modules[0].next_node;
    expect(node.dispatch.completion).toEqual({
      command: 'openlogos change-lint --slug plan-contract --format json',
      expected: { '/data/pass': true, '/data/plan_package/ready': true },
      expected_proposal_step: 'ready-to-delta',
    });
  });

  it('UT-S05-33: 旧 CLI completion 缺失保守兼容', () => {
    expect(PLAN_PACKAGE_CLI_CONTRACT_VERSION).toBe('1.3.0');
    expect('1.2.0'.localeCompare(PLAN_PACKAGE_CLI_CONTRACT_VERSION, undefined, { numeric: true })).toBeLessThan(0);
  });

  it('UT-S05-34: history bypass 不回退', async () => {
    const f = fixture({ proposal: '# Old proposal', marker: 'SPEC_MERGED' });
    expect((await nextData(f.root)).modules[0].proposal_step).not.toBe('writing');
  });

  it('ST-S05-14: next 与 flow 使用同一 ready', async () => {
    const f = fixture();
    const data = await nextData(f.root);
    expect(data.modules[0].plan_state.plan_package.ready).toBe(true);
    expect(data.modules[0].proposal_step).toBe(detectProposalStepViaFlow(f.dir));
  });

  it('ST-S05-15: next 求值只读', async () => {
    const f = fixture(); const before = snapshot(f.root);
    await nextData(f.root);
    expect(snapshot(f.root)).toBe(before);
  });
});

describe('S11 Plan Package status 契约', () => {
  it('UT-S11-58: plan_state 挂载完整 evaluation', () => {
    const f = fixture(); const active = collectStatusData(f.root).modules![0].active_change!;
    expect(active.plan_state).toMatchObject({ completion_contract_version: '1', proposal_filled: true, tasks_plan_filled: true });
    expect(active.plan_state!.plan_package.schema).toBe('openlogos/plan-package-evaluation@1');
  });

  it('UT-S11-59: ready 投影与 evaluator 同义', () => {
    for (const text of [proposal(), proposal().replace('## 变更概述', '## 核心设计')]) {
      const f = fixture({ proposal: text }); const active = collectStatusData(f.root).modules![0].active_change!;
      expect(active.plan_state!.plan_ready).toBe(evaluatePlanPackage(f.root, f.dir).ready);
    }
  });

  it('UT-S11-60: issue 稳定排序与字段保真', () => {
    const f = fixture({ proposal: proposal().replace('## 变更概述', '## 核心设计') });
    const first = collectStatusData(f.root).modules![0].active_change!.plan_state!.completion_issues;
    const second = collectStatusData(f.root).modules![0].active_change!.plan_state!.completion_issues;
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({ path: 'logos/changes/plan-contract/proposal.md', section_id: 'summary', expected: '变更概述' });
  });

  it('UT-S11-61: evaluator 操作错误不吞成成功态', () => {
    const f = fixture();
    expect(() => evaluatePlanPackage(f.root, join(f.root, 'logos', 'changes', 'missing'))).toThrow();
  });

  it('UT-S11-62: 历史旁路维持真实前沿', () => {
    const f = fixture({ proposal: '# Old proposal', marker: 'SPEC_MERGED' });
    const active = collectStatusData(f.root).modules![0].active_change!;
    expect(active.proposal_step).not.toBe('writing');
    expect(active.plan_state!.plan_package.ready).toBe(true);
  });

  it('ST-S11-36: status/lint/next/flow 四方同源', async () => {
    const f = fixture(); const evaluation = evaluatePlanPackage(f.root, f.dir);
    const lint = runChangeLint(f.root, f.dir, 'plan-contract');
    if (!lint.ok) throw new Error(lint.message);
    expect(lint.plan_package).toEqual(evaluation);
    expect(collectStatusData(f.root).modules![0].active_change!.plan_state!.plan_package).toEqual(evaluation);
    expect((await nextData(f.root)).modules[0].plan_state.plan_package).toEqual(evaluation);
    expect(detectProposalStepViaFlow(f.dir)).toBe('ready-to-delta');
  });

  it('ST-S11-37: status 所有路径只读', () => {
    for (const options of [{}, { proposal: proposal().replace('## 变更概述', '## 核心设计') }, { marker: 'SPEC_MERGED' }]) {
      const f = fixture(options); const before = snapshot(f.root);
      collectStatusData(f.root);
      expect(snapshot(f.root)).toBe(before);
    }
  });
});
