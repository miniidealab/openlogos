/**
 * S16 — next/status 机器契约暴露 code_required 字段（expose-code-required-field）
 *
 * 覆盖 UT-S16-02（字段存在性）、UT-S16-03（取值＝isCodeRequiredForProposal）、
 * UT-S16-04（零漂移边界：无活跃提案时不出现）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { status } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const LAUNCHED_YAML = 'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n';

/** 纯文档提案（部署原因含「纯文档」→ proposalDeclaresNoCode）——预期 code_required=false。 */
function docOnlyProposal(): string {
  return [
    '# 变更提案：docs', '', '## 变更原因', '补文档。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01', '', '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：纯文档变更', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '概述。',
  ].join('\n');
}
/** 代码级提案。 */
function codeProposal(): string {
  return docOnlyProposal()
    .replace('## 变更类型\n设计级', '## 变更类型\n代码级修复')
    .replace('## 变更概述\n概述。', '## 变更概述\n需要 CLI 状态派生代码与自动化测试实现。');
}

const PURE_DELTA = '# 任务\n\n## [delta] 规格变更\n- [x] d';
const DELTA_DONE_CODE_SLICES = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1\n- [ ] 切片2';

/** 建带 guard 的活跃提案 fixture。markers 传 'SPEC_MERGED' 等。 */
function setup(tasks: string, proposal: string, markers: string[] = [], slug = 'feat'): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), LAUNCHED_YAML);
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-06-20T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposal);
  writeFileSync(join(dir, 'tasks.md'), tasks);
  for (const mk of markers) writeFileSync(join(dir, mk), '');
  return root;
}
/** launched 模块但无 guard（无活跃提案）。 */
function setupNoActive(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), LAUNCHED_YAML);
  return root;
}
async function nextJson(root: string): Promise<Record<string, any>> {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { await next('json'); } finally { cap.restore(); ex.mockRestore(); restore(); }
  return JSON.parse(cap.logs[cap.logs.length - 1]).data;
}
function statusJson(root: string): Record<string, any> {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { status('json'); } finally { cap.restore(); ex.mockRestore(); restore(); }
  return JSON.parse(cap.logs[cap.logs.length - 1]).data;
}

describe('S16 — code_required 契约字段', () => {
  it('UT-S16-02: 活跃提案下 status.active_change 与 next module 级均暴露 boolean code_required', async () => {
    const root = setup(DELTA_DONE_CODE_SLICES, codeProposal(), ['SPEC_MERGED']);
    const s = statusJson(root);
    expect(typeof s.modules[0].active_change.code_required).toBe('boolean');
    const n = await nextJson(root);
    expect(typeof n.modules[0].code_required).toBe('boolean');
  });

  it('UT-S16-03: code_required 取值等于 isCodeRequiredForProposal（纯文档=false、代码提案=true）', async () => {
    // A：纯文档提案（无 [code]、部署原因声明纯文档）→ false，且 next_node 不落 code/plan-slices
    const rootA = setup(PURE_DELTA, docOnlyProposal(), ['SPEC_MERGED']);
    const sA = statusJson(rootA);
    expect(sA.modules[0].active_change.code_required).toBe(false);
    const nA = await nextJson(rootA);
    expect(nA.modules[0].code_required).toBe(false);
    expect(['code', 'plan-slices']).not.toContain(nA.modules[0].next_node?.id);

    // B：含 [code] 切片的代码提案 → true
    const rootB = setup(DELTA_DONE_CODE_SLICES, codeProposal(), ['SPEC_MERGED'], 'feat-b');
    const sB = statusJson(rootB);
    expect(sB.modules[0].active_change.code_required).toBe(true);
    const nB = await nextJson(rootB);
    expect(nB.modules[0].code_required).toBe(true);
  });

  it('UT-S16-04: 零漂移边界——无活跃提案时 active_change 为 null，输出不含 code_required', async () => {
    const root = setupNoActive();
    const s = statusJson(root);
    expect(s.modules[0].active_change).toBeNull();
    expect(JSON.stringify(s)).not.toContain('code_required');
    const n = await nextJson(root);
    expect(n.modules[0].code_required).toBeUndefined();
    expect(JSON.stringify(n)).not.toContain('code_required');
  });
});
