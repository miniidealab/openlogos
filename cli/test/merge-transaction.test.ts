import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyMergeTransaction, createMergeTransaction, readMergeTransaction, recoverMergeTransaction,
  sealMergeTransaction, submitMergeContent,
} from '../src/lib/merge-transaction.js';

const roots: string[] = [];
const repoRoot = resolve(import.meta.dirname, '../..');

function put(root: string, path: string, content: string): void {
  const target = join(root, ...path.split('/'));
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

function fixture(): { root: string; proposalDir: string; slug: string } {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-merge-tx-'));
  roots.push(root);
  const slug = 'transaction-fixture';
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: Fixture\nscenario_counter:\n  next_id: 2\ndecision_counter:\n  next_id: 7\nresource_index:\n  - path: logos/resources/prd/1-product-requirements/core-01.md\n    desc: 基线\n');
  put(root, 'spec/schema/merge-transaction.schema.json', readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8'));
  put(root, 'spec/cli-json-output.md', readFileSync(join(repoRoot, 'spec/cli-json-output.md'), 'utf8'));
  put(root, 'spec/example.md', '# 根规格\n');
  put(root, 'logos/resources/prd/1-product-requirements/core-01.md', '# 需求基线\n');
  put(root, `logos/changes/${slug}/deltas/decisions/core-D07-choice.md`, '## ADDED — D07 事务权威\n\n正文\n');
  put(root, `logos/changes/${slug}/deltas/prd/1-product-requirements/core-01.md`, '## ADDED — 事务需求\n\n正文\n');
  put(root, `logos/changes/${slug}/deltas/spec/example.md`, '## ADDED — 事务合同\n\n正文\n');
  put(root, `logos/changes/${slug}/proposal.md`, `# fixture\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:
  policy: on-touch-v1
  schema_version: 1
  unit: canonical-merge-target-path
  delta_cardinality: exactly-one-per-non-skip-target
  effective_view: merged-resources-plus-current-change-deltas
  ambiguity: block-before-existing-plan-exit
  standalone_baseline_required: false
  jit_confirmation: disabled
  touched_scenario_ids: [S09]
  targets:
    - category: decision
      scenario_ids: [S09]
      mode: CREATE
      delta_path: deltas/decisions/core-D07-choice.md
      reason: 新建事务决策基线
      evidence: [target_absent]
      missing_evidence: []
    - category: requirement
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: deltas/prd/1-product-requirements/core-01.md
      reason: 更新事务需求基线
      evidence: [target_exists]
      missing_evidence: []
    - category: spec
      scenario_ids: [S09]
      mode: MODIFY
      delta_path: deltas/spec/example.md
      reason: 更新根事务合同
      evidence: [target_exists]
      missing_evidence: []
\`\`\`\n`);
  put(root, `logos/changes/${slug}/tasks.md`, '# 任务\n\n## [delta] 规格变更\n\n- [x] [CREATE] `deltas/decisions/core-D07-choice.md`\n- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01.md`\n- [x] [MODIFY] `deltas/spec/example.md`\n\n## [code] 代码实现\n');
  return { root, proposalDir, slug };
}

function prepare(f = fixture()) {
  let tx = createMergeTransaction(f.root, f.proposalDir, f.slug);
  for (const target of tx.targets.filter(item => item.content_sha256 === null && !item.target_path.startsWith('spec/'))) {
    const content = target.mode === 'CREATE'
      ? Buffer.from('# D07 事务权威\n')
      : Buffer.from('# 需求基线\n\n## 事务需求\n\n正文\n');
    tx = submitMergeContent(f.proposalDir, target.slot_id, content);
  }
  return { ...f, tx };
}

afterEach(() => {
  delete process.env.OPENLOGOS_TEST_MERGE_TX_FAIL_AFTER;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const controlIds = [
  'UT-S05-35','UT-S05-36','UT-S05-37','UT-S05-38','UT-S05-39','UT-S05-40','UT-S05-41','UT-S05-42',
  'ST-S05-16','ST-S05-17','ST-S05-18','ST-S05-19','UT-S09-233','UT-S09-234','UT-S09-235','UT-S09-236',
  'UT-S09-237','UT-S09-238','UT-S09-239','UT-S09-240','UT-S09-250','ST-S09-94','ST-S09-98','UT-S11-63',
  'UT-S11-64','UT-S11-65','UT-S11-67','UT-S11-68','UT-S11-70','ST-S11-38','ST-S11-41','UT-S16-18',
  'UT-S16-19','UT-S16-20','UT-S16-21','UT-S16-22','UT-S16-23','UT-S16-24','UT-S16-25','UT-S16-26',
  'UT-S16-27','ST-S16-05','ST-S16-06','ST-S16-08','UT-S39-39','UT-S39-40','UT-S39-41','UT-S39-42',
  'UT-S39-49','ST-S39-25',
].join(' ');

const applyIds = [
  'UT-S09-241','UT-S09-242','UT-S09-243','UT-S09-244','UT-S09-245','UT-S09-246','UT-S09-247','UT-S09-248',
  'ST-S09-91','ST-S09-92','ST-S09-93','ST-S09-95','ST-S09-96','ST-S09-97','UT-S11-66','UT-S11-69',
  'ST-S11-39','ST-S11-40','UT-S39-43','UT-S39-44','UT-S39-45','UT-S39-46','UT-S39-47','UT-S39-48',
  'UT-S39-50','ST-S39-20','ST-S39-21','ST-S39-22','ST-S39-23','ST-S39-24',
].join(' ');

describe('OpenLogos merge transaction', () => {
  it(`${controlIds}: 状态机、身份、slot、schema 与只读投影保持单一权威`, async () => {
    const f = fixture();
    const first = createMergeTransaction(f.root, f.proposalDir, f.slug);
    const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/merge-transaction-golden.json'), 'utf8')) as { transaction_id: string };
    expect(first.transaction_id).toBe(golden.transaction_id);
    const retry = createMergeTransaction(f.root, f.proposalDir, f.slug);
    expect(retry.transaction_id).toBe(first.transaction_id);
    expect(first.phase).toBe('collecting');
    expect(first.allowed_actions).toEqual(['submit_content', 'abort']);
    expect(first.targets.map(item => item.target_path)).toEqual([...first.targets.map(item => item.target_path)].sort());
    expect(first.targets.every(item => item.source_sha256.startsWith('sha256:'))).toBe(true);
    const statusResult = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'status', '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
    const nextResult = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'next', '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
    expect(statusResult.status, statusResult.stderr).toBe(0);
    expect(nextResult.status, nextResult.stderr).toBe(0);
    const statusProjection = JSON.parse(statusResult.stdout).data.merge_transaction;
    const nextProjection = JSON.parse(nextResult.stdout).data.merge_transaction;
    expect(nextProjection).toEqual(statusProjection);
    expect(statusProjection.transaction_id).toBe(first.transaction_id);
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')));
    expect(validate(statusProjection), JSON.stringify(validate.errors)).toBe(true);
    const prepared = prepare(f);
    expect(prepared.tx.phase).toBe('ready');
    expect(prepared.tx.next_action).toBe('seal');
    const sealed = sealMergeTransaction(f.root, f.proposalDir);
    expect(sealed.phase).toBe('sealed');
    expect(sealed.seal_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(sealed.next_action).toBe('apply');
    const before = readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
    expect(readMergeTransaction(f.proposalDir)).toEqual(sealed);
    expect(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'))).toEqual(before);
    expect(sealed.schema_sha256).toMatch(/^sha256:/);
    expect(sealed.contract_sha256).toMatch(/^sha256:/);
  });

  it(`${applyIds}: CREATE/MODIFY/metadata/test-change-set/receipt 作为一个原子闭包提交并支持恢复`, () => {
    const f = prepare();
    sealMergeTransaction(f.root, f.proposalDir);
    const completed = applyMergeTransaction(f.root, f.proposalDir);
    expect(completed.phase).toBe('completed');
    expect(completed.allowed_actions).toEqual([]);
    expect(completed.receipt?.receipt_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(readFileSync(join(f.root, 'logos/resources/decisions/core-D07-choice.md'), 'utf8')).toContain('D07');
    expect(readFileSync(join(f.root, 'logos/resources/prd/1-product-requirements/core-01.md'), 'utf8')).toContain('事务需求');
    expect(readFileSync(join(f.root, 'spec/example.md'), 'utf8')).toContain('事务合同');
    expect(readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf8')).toContain('core-D07-choice.md');
    expect(existsSync(join(f.proposalDir, 'MERGE_RECEIPT.json'))).toBe(true);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(applyMergeTransaction(f.root, f.proposalDir)).toEqual(completed);
  });

  it('UT-S09-242 ST-S09-96 UT-S11-69 ST-S11-39 UT-S39-44 ST-S39-21: apply 故障回滚后可从 sealed 重试', () => {
    const f = prepare();
    sealMergeTransaction(f.root, f.proposalDir);
    process.env.OPENLOGOS_TEST_MERGE_TX_FAIL_AFTER = 'logos/resources/prd/1-product-requirements/core-01.md';
    expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow(/test fault/);
    expect(readFileSync(join(f.root, 'logos/resources/prd/1-product-requirements/core-01.md'), 'utf8')).toBe('# 需求基线\n');
    expect(readMergeTransaction(f.proposalDir).phase).toBe('sealed');
    expect(recoverMergeTransaction(f.root, f.proposalDir).phase).toBe('sealed');
  });

  it('UT-S09-249: 旧 merge-apply 外部协议固定拒绝且零正式副作用', () => {
    const f = fixture();
    const env = { ...process.env, NODE_ENV: 'production' };
    delete env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY;
    const result = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge-apply', f.slug, '--manifest', 'x.json'], {
      cwd: f.root, env, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('legacy_manifest_rejected');
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(false);
  });

  it('ST-S16-07 UT-S19-12 UT-S19-13 UT-S19-14 UT-S19-15 UT-S19-16 UT-S19-17 UT-S19-18 ST-S19-10 ST-S19-11 ST-S19-12 ST-S19-13: 0.14.0 安装态合同与命令入口自描述一致', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'cli/package.json'), 'utf8')) as { version: string; files: string[] };
    expect(pkg.version).toBe('0.14.0');
    expect(pkg.files).toContain('spec');
    expect(readFileSync(join(repoRoot, 'cli/src/index.ts'), 'utf8')).toContain("args[1] === 'transaction'");
    expect(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')).toContain('openlogos/merge-transaction@1');
    expect(readFileSync(join(repoRoot, 'skills/merge-executor/SKILL.md'), 'utf8')).toContain('Merge transaction');
    expect(readFileSync(join(repoRoot, 'scripts/smoke-merge-transaction-candidate.js'), 'utf8')).toContain('SMOKE-core-150');
  });
});
