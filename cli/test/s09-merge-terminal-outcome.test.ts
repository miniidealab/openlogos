/**
 * S09 合并事务终态出路实现验收（fix-merge-transaction-abort-recover-reopen）。
 * 覆盖 UT-S09-289～UT-S09-292、ST-S09-111；用例名中的逐条 ID 由全局 OpenLogos reporter
 * 写入 test-results.jsonl。权威判据：功能规格 §2.58、架构 §四十五、spec/change-management.md。
 * UT-S09-292 的 preflight-reopen 维度另由既有 UT-S09-271～274 全量回归锚定。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  abortMergeTransaction, applyMergeTransaction, createMergeTransaction,
  listMergeTransactionPlanTargets, MergeTransactionError, readMergeTransaction,
  reopenMergeTransaction, sealMergeTransaction, submitMergeContent,
} from '../src/lib/merge-transaction.js';
import { withCompleteClarification } from './helpers.js';

const roots: string[] = [];
const CLI_DIST = join(process.cwd(), 'dist/index.js');
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function put(root: string, rel: string, content: string): void {
  const path = join(root, ...rel.split('/'));
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

const CATEGORIES: Array<[string, string, string]> = [
  ['requirement', 'deltas/prd/1-product-requirements/core-req.md', 'logos/resources/prd/1-product-requirements/core-req.md'],
  ['feature', 'deltas/prd/2-product-design/1-feature-specs/core-feature.md', 'logos/resources/prd/2-product-design/1-feature-specs/core-feature.md'],
  ['architecture', 'deltas/prd/3-technical-plan/1-architecture/core-arch.md', 'logos/resources/prd/3-technical-plan/1-architecture/core-arch.md'],
  ['scenario', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S09.md', 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09.md'],
  ['test', 'deltas/test/core-S09-test-cases.md', 'logos/resources/test/core-S09-test-cases.md'],
];

function closureYaml(): string {
  const material = [...CATEGORIES].sort((a, b) => a[1].localeCompare(b[1], 'en'))
    .map(([category, deltaPath, targetPath]) => [
      `    - category: ${category}`, '      scenario_ids: [S09]', '      mode: MODIFY',
      `      delta_path: "${deltaPath}"`, `      reason: "${category} 由 S09 触达并需要最终态更新。"`,
      `      evidence: ["target_exists: ${targetPath}"]`, '      missing_evidence: []',
    ].join('\n'));
  const skips = ['api', 'database', 'deployment', 'orchestration', 'smoke'].sort().map(category => [
    `    - category: ${category}`, '      scenario_ids: [S09]', '      mode: SKIP', '      delta_path: null',
    `      reason: "${category} 经场景证据判定不适用。"`, '      evidence: ["scenario:S09#evidence"]', '      missing_evidence: []',
  ].join('\n'));
  return [
    'baseline_closure:', '  policy: on-touch-v1', '  schema_version: 1', '  unit: canonical-merge-target-path',
    '  delta_cardinality: exactly-one-per-non-skip-target',
    '  effective_view: merged-resources-plus-current-change-deltas',
    '  ambiguity: block-before-existing-plan-exit', '  standalone_baseline_required: false',
    '  jit_confirmation: disabled', '  touched_scenario_ids: [S09]', '  targets:', ...material, ...skips,
  ].join('\n');
}

interface Fixture { root: string; proposalDir: string; slug: string }

/** 可合并提案夹具：五个 MODIFY 目标，delta 各为一个 ADDED 章节。 */
function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mtx-outcome-'));
  roots.push(root);
  const slug = 'terminal-fixture';
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', JSON.stringify({ name: 'terminal', locale: 'zh' }));
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', [
    'project:', '  name: terminal', 'tech_stack:', '  database: sqlite', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    bootstrap: normal', '    product_type: cli',
  ].join('\n'));
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  for (const [category, deltaPath, targetPath] of CATEGORIES) {
    put(root, targetPath, `# ${category}\n\n## 最终态\n\n既有最终态。\n`);
    const body = category === 'test'
      ? `| ID | 描述 |\n|---|---|\n| UT-S09-01 | 夹具用例（v1） |\n`
      : `${category} 新增内容 v1。\n`;
    put(root, `logos/changes/${slug}/${deltaPath}`, `## ADDED — ${category} 新增节\n\n${body}`);
  }
  put(root, `logos/changes/${slug}/proposal.md`, withCompleteClarification([
    '# 变更提案', '', '> module: core', '', '## 基线闭包计划', '', '```yaml', closureYaml(), '```', '',
    '## 变更类型', '设计级', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：本地测试', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否',
  ].join('\n')));
  const tasks = CATEGORIES.map(([category, deltaPath]) => `- [x] [MODIFY] \`${deltaPath}\`：${category} 最终态。`).sort().join('\n');
  put(root, `logos/changes/${slug}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n\n${tasks}\n\n## [code] 代码实现\n`);
  return { root, proposalDir, slug };
}

/** 提交全部 agent slot（final = 目标现状 + 新增节），返回 ready 投影。 */
function submitAll(f: Fixture) {
  let tx = readMergeTransaction(f.proposalDir);
  for (const target of listMergeTransactionPlanTargets(f.proposalDir).filter(item => item.producer === 'agent')) {
    const deltaRaw = readFileSync(join(f.proposalDir, target.delta_path), 'utf-8');
    const base = readFileSync(join(f.root, target.target_path), 'utf-8');
    if (deltaRaw.startsWith('## MODIFIED — ')) {
      // 二次 merge 订正形态：整节替换既有「新增节」的正文
      const newBody = deltaRaw.split('\n').slice(1).join('\n').trim();
      const anchor = deltaRaw.split('\n')[0].replace('## MODIFIED — ', '');
      const sectionStart = base.indexOf(`## ${anchor}`);
      const final = `${base.slice(0, sectionStart)}## ${anchor}\n\n${newBody}\n`;
      const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
      const staging = join(f.root, ...descriptor.staging_path.split('/'));
      mkdirSync(resolve(staging, '..'), { recursive: true });
      const temp = `${staging}.tmp`;
      writeFileSync(temp, final);
      renameSync(temp, staging);
      tx = submitMergeContent(f.proposalDir, target.slot_id, staging);
      continue;
    }
    const body = deltaRaw.replace(/^## ADDED — /, '## ');
    const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
    const staging = join(f.root, ...descriptor.staging_path.split('/'));
    mkdirSync(resolve(staging, '..'), { recursive: true });
    const temp = `${staging}.tmp`;
    writeFileSync(temp, `${base}\n${body}`);
    renameSync(temp, staging);
    tx = submitMergeContent(f.proposalDir, target.slot_id, staging);
  }
  return tx;
}

function driveToCompleted(f: Fixture) {
  createMergeTransaction(f.root, f.proposalDir, f.slug);
  submitAll(f);
  sealMergeTransaction(f.root, f.proposalDir);
  return applyMergeTransaction(f.root, f.proposalDir);
}

function mutateDelta(f: Fixture, suffix: string): void {
  const [, deltaPath] = CATEGORIES[0];
  const path = join(f.proposalDir, deltaPath);
  writeFileSync(path, readFileSync(path, 'utf-8').replace('新增内容 v1。', `新增内容 ${suffix}。`));
}

function rewriteStored(f: Fixture, patch: Record<string, unknown>): void {
  const path = join(f.proposalDir, 'MERGE_TRANSACTION.json');
  const stored = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  writeFileSync(path, `${JSON.stringify({ ...stored, ...patch }, null, 2)}\n`);
}

describe('S09 合并事务终态出路（§2.58）', () => {
  it('UT-S09-289: abort 后归档让位重建，非终态保持幂等', () => {
    const f = fixture();
    const first = createMergeTransaction(f.root, f.proposalDir, f.slug);
    // 非终态幂等对照：collecting 重复创建返回同一事务
    expect(createMergeTransaction(f.root, f.proposalDir, f.slug).transaction_id).toBe(first.transaction_id);

    abortMergeTransaction(f.proposalDir);
    mutateDelta(f, 'v2');
    const rebuilt = createMergeTransaction(f.root, f.proposalDir, f.slug);
    expect(rebuilt.phase).toBe('collecting');
    expect(rebuilt.transaction_id).not.toBe(first.transaction_id);
    // 旧事务归档在场、receipt 字段保留可审计
    const archivedPath = join(f.proposalDir, 'merge-transactions', `${first.transaction_id}.json`);
    expect(existsSync(archivedPath)).toBe(true);
    const archived = JSON.parse(readFileSync(archivedPath, 'utf-8')) as { classification: string };
    expect(archived.classification).toBe('aborted');
  });

  it('UT-S09-290: fatal failed 可 abort 后重来；recovery_required 仍走 recover 且不可 abort', () => {
    const fatal = fixture();
    const first = createMergeTransaction(fatal.root, fatal.proposalDir, fatal.slug);
    rewriteStored(fatal, { phase: 'failed', classification: 'internal_failure' });
    expect(readMergeTransaction(fatal.proposalDir).allowed_actions).toEqual(['abort']);
    expect(abortMergeTransaction(fatal.proposalDir).classification).toBe('aborted');
    mutateDelta(fatal, 'v2');
    const rebuilt = createMergeTransaction(fatal.root, fatal.proposalDir, fatal.slug);
    expect(rebuilt.phase).toBe('collecting');
    expect(rebuilt.transaction_id).not.toBe(first.transaction_id);
    expect(existsSync(join(fatal.proposalDir, 'merge-transactions', `${first.transaction_id}.json`))).toBe(true);

    const recoverable = fixture();
    createMergeTransaction(recoverable.root, recoverable.proposalDir, recoverable.slug);
    rewriteStored(recoverable, { phase: 'failed', classification: 'recovery_required' });
    expect(readMergeTransaction(recoverable.proposalDir).allowed_actions).toEqual(['recover']);
    expect(() => abortMergeTransaction(recoverable.proposalDir)).toThrowError(MergeTransactionError);
  });

  it('UT-S09-291: completed reopen 准入矩阵、留痕与归档', () => {
    // ① SPEC_MERGED 不在场（异常残局）→ 直接重开
    const orphan = fixture();
    const orphanTx = driveToCompleted(orphan);
    rmSync(join(orphan.proposalDir, 'SPEC_MERGED'), { force: true });
    const reopened = reopenMergeTransaction(orphan.root, orphan.proposalDir, orphan.slug, { reason: '规格有误' });
    expect(reopened.phase).toBe('collecting');
    expect(reopened.transaction_id).not.toBe(orphanTx.transaction_id);

    // ② 在场未附确认 → 拒绝且零副作用
    const guarded = fixture();
    const guardedTx = driveToCompleted(guarded);
    expect(() => reopenMergeTransaction(guarded.root, guarded.proposalDir, guarded.slug, { reason: '规格有误' }))
      .toThrow(/--confirm-spec-merged/);
    expect(existsSync(join(guarded.proposalDir, 'MERGE_REOPENS.jsonl'))).toBe(false);
    expect(existsSync(join(guarded.proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(readMergeTransaction(guarded.proposalDir).transaction_id).toBe(guardedTx.transaction_id);

    // ③ 附确认 → 重开成功：留痕齐备、旧事务与 receipt 归档、SPEC_MERGED 作废
    mutateDelta(guarded, 'v2');
    const confirmed = reopenMergeTransaction(guarded.root, guarded.proposalDir, guarded.slug,
      { reason: '已合并规格有误', confirmSpecMerged: true });
    expect(confirmed.phase).toBe('collecting');
    const audit = JSON.parse(readFileSync(join(guarded.proposalDir, 'MERGE_REOPENS.jsonl'), 'utf-8').trim().split('\n')[0]) as Record<string, unknown>;
    expect(audit).toMatchObject({
      schema: 'openlogos/merge-reopen@1', old_transaction_id: guardedTx.transaction_id,
      reason: '已合并规格有误', spec_merged_present: true, confirmed: true,
    });
    expect(existsSync(join(guarded.proposalDir, 'merge-transactions', `${guardedTx.transaction_id}.json`))).toBe(true);
    expect(existsSync(join(guarded.proposalDir, 'merge-transactions', `${guardedTx.transaction_id}.receipt.json`))).toBe(true);
    expect(existsSync(join(guarded.proposalDir, 'SPEC_MERGED'))).toBe(false);

    // ④ reason 空白 → 拒绝；非 completed 执行 reopen → action_not_allowed
    const blank = fixture();
    driveToCompleted(blank);
    expect(() => reopenMergeTransaction(blank.root, blank.proposalDir, blank.slug, { reason: '   ', confirmSpecMerged: true }))
      .toThrow(/非空 --reason/);
    const collecting = fixture();
    createMergeTransaction(collecting.root, collecting.proposalDir, collecting.slug);
    expect(() => reopenMergeTransaction(collecting.root, collecting.proposalDir, collecting.slug, { reason: '早了' }))
      .toThrow(/禁止 reopen/);
  });

  it('UT-S09-292: completed 拒绝静默重建；abort 既有拒绝面与终态动作域零回归', () => {
    // ① completed + SPEC_MERGED 完好：直接重跑 merge 被拒且指向 reopen；零副作用
    const f = fixture();
    const done = driveToCompleted(f);
    expect(done.phase).toBe('completed');
    expect(readMergeTransaction(f.proposalDir).allowed_actions).toEqual(['reopen']);
    let hint = '';
    try {
      createMergeTransaction(f.root, f.proposalDir, f.slug);
      expect.unreachable('completed + SPEC_MERGED 完好必须拒绝静默重建');
    } catch (error) {
      expect(error).toBeInstanceOf(MergeTransactionError);
      hint = (error as Error).message;
    }
    expect(hint).toContain('reopen');
    expect(readMergeTransaction(f.proposalDir).transaction_id).toBe(done.transaction_id);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);

    // ② abort 既有拒绝面零回归：正式 receipt/marker 在场时拒绝破坏性清理（构造 collecting + 伪 receipt）
    const guardedAbort = fixture();
    createMergeTransaction(guardedAbort.root, guardedAbort.proposalDir, guardedAbort.slug);
    writeFileSync(join(guardedAbort.proposalDir, 'MERGE_RECEIPT.json'), '{}\n');
    expect(() => abortMergeTransaction(guardedAbort.proposalDir)).toThrow(/拒绝破坏性清理/);

    // ③ 非终态动作域零回归：collecting/ready/sealed/applying 的 allowed_actions 逐项与 0.14.16 一致
    const phases = fixture();
    createMergeTransaction(phases.root, phases.proposalDir, phases.slug);
    expect(readMergeTransaction(phases.proposalDir).allowed_actions).toEqual(['submit_content', 'abort']);
    submitAll(phases);
    expect(readMergeTransaction(phases.proposalDir).allowed_actions).toEqual(['seal', 'abort']);
    sealMergeTransaction(phases.root, phases.proposalDir);
    expect(readMergeTransaction(phases.proposalDir).allowed_actions).toEqual(['apply', 'abort']);
    rewriteStored(phases, { phase: 'applying' });
    expect(readMergeTransaction(phases.proposalDir).allowed_actions).toEqual(['recover']);
  });

  it('ST-S09-111: 真实 CLI 三条出路全链', () => {
    const cliEnv = { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' };
    const run = (f: Fixture, args: string[]) => spawnSync(process.execPath, [CLI_DIST, ...args], {
      cwd: f.root, encoding: 'utf8', timeout: 120_000, env: cliEnv,
    });
    const txCli = (f: Fixture, ...args: string[]) => run(f, ['merge', 'transaction', ...args, '--slug', f.slug]);
    const submitSealApply = (f: Fixture) => {
      submitAll(f);
      const sealed = txCli(f, 'seal');
      expect(sealed.status, `seal 必须成功：${`${sealed.stdout}${sealed.stderr}`.slice(0, 500)}`).toBe(0);
      const applied = txCli(f, 'apply');
      expect(applied.status, `apply 必须成功：${`${applied.stdout}${applied.stderr}`.slice(0, 400)}`).toBe(0);
    };

    // A：merge → abort → 修正 delta → merge（新事务）→ 全链 completed
    const a = fixture();
    const firstMerge = run(a, ['merge', a.slug]);
    expect(firstMerge.status, `merge 必须成功：${`${firstMerge.stdout}${firstMerge.stderr}`.slice(0, 500)}`).toBe(0);
    const firstId = readMergeTransaction(a.proposalDir).transaction_id;
    expect(txCli(a, 'abort').status).toBe(0);
    mutateDelta(a, 'v2');
    expect(run(a, ['merge', a.slug]).status).toBe(0);
    const rebuiltId = readMergeTransaction(a.proposalDir).transaction_id;
    expect(rebuiltId).not.toBe(firstId);
    expect(existsSync(join(a.proposalDir, 'merge-transactions', `${firstId}.json`))).toBe(true);
    submitSealApply(a);
    expect(existsSync(join(a.proposalDir, 'SPEC_MERGED'))).toBe(true);

    // B：completed → reopen（确认）→ 修正 delta → 重合并 → SPEC_MERGED 重写；下游产物零删除
    const downstream = join(a.proposalDir, 'TEST_SLICE_MANIFEST.json');
    writeFileSync(downstream, '{"schema":"openlogos/test-slice-manifest@1"}\n');
    const noConfirm = txCli(a, 'reopen', '--reason', '规格有误');
    expect(noConfirm.status).not.toBe(0);
    expect(`${noConfirm.stdout}${noConfirm.stderr}`).toContain('--confirm-spec-merged');
    const reopened = txCli(a, 'reopen', '--reason', '规格有误', '--confirm-spec-merged');
    expect(reopened.status, `reopen 必须成功：${`${reopened.stdout}${reopened.stderr}`.slice(0, 400)}`).toBe(0);
    expect(existsSync(join(a.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(readFileSync(join(a.proposalDir, 'MERGE_REOPENS.jsonl'), 'utf-8')).toContain(rebuiltId);
    expect(existsSync(join(a.proposalDir, 'merge-transactions', `${rebuiltId}.json`))).toBe(true);
    // 二次 merge 的订正 delta：目标已含各节，全部改为 MODIFIED 整节订正
    for (const [category, deltaPath] of CATEGORIES) {
      const body = category === 'test'
        ? '| ID | 描述 |\n|---|---|\n| UT-S09-01 | 夹具用例（v3） |'
        : `${category} 订正内容 v3。`;
      writeFileSync(join(a.proposalDir, deltaPath), `## MODIFIED — ${category} 新增节\n\n${body}\n`);
    }
    // reopen 已重建 collecting 事务，但 delta 再次修正后需重建计划：abort 让位后重跑 merge
    expect(txCli(a, 'abort').status).toBe(0);
    expect(run(a, ['merge', a.slug]).status).toBe(0);
    submitSealApply(a);
    expect(existsSync(join(a.proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(readFileSync(downstream, 'utf-8')).toContain('test-slice-manifest');

    // C：违例矩阵（空 reason / 非 completed reopen）逐一被拒且零副作用
    const c = fixture();
    expect(run(c, ['merge', c.slug]).status).toBe(0);
    const early = txCli(c, 'reopen', '--reason', '早了');
    expect(early.status).not.toBe(0);
    const blank = txCli(c, 'reopen', '--reason', '   ');
    expect(blank.status).not.toBe(0);
    expect(existsSync(join(c.proposalDir, 'MERGE_REOPENS.jsonl'))).toBe(false);
  });
});
