import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  abortMergeTransaction, applyMergeTransaction, createMergeTransaction,
  listMergeTransactionPlanTargets, MERGE_TRANSACTION_ACTION_COMMANDS,
  mergeTransactionCommandForAction, readMergeTransaction, recoverMergeTransaction,
  sealMergeTransaction, submitMergeContent,
} from '../src/lib/merge-transaction.js';
import {
  computeMergeReceiptSha256, validateMergeTransactionSemantics,
} from '../src/lib/merge-transaction-semantic.js';
import {
  assertMergeTransactionCandidateMatch, assertMergeTransactionCandidateRestored,
  buildMergeTransactionRollbackCommands, decideMergeTransactionCandidate, freezeMergeTransactionCandidateFacts,
  MERGE_TRANSACTION_CANDIDATE_SCHEMA, MERGE_TRANSACTION_CANDIDATE_VERSION,
  type MergeTransactionCandidateFacts,
} from '../src/lib/merge-transaction-candidate.js';
import { validateAndStripNonMarkdownDelta } from '../src/lib/baseline-closure.js';
import { validateRunLogosCandidateEvidence } from '../../scripts/lib/runlogos-candidate-evidence.mjs';

const roots: string[] = [];
const repoRoot = resolve(import.meta.dirname, '../..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function put(root: string, path: string, content: string): void {
  const target = join(root, ...path.split('/'));
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function checked(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败：${result.error?.message ?? `exit ${result.status}`}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function candidateFacts(commandPath: string, tarball: string, packageRoot: string): MergeTransactionCandidateFacts {
  return freezeMergeTransactionCandidateFacts({
    schema: MERGE_TRANSACTION_CANDIDATE_SCHEMA,
    command_path: resolve(commandPath),
    cli_version: MERGE_TRANSACTION_CANDIDATE_VERSION,
    candidate_tarball_sha256: sha256(readFileSync(tarball)),
    merge_transaction_schema_sha256: sha256(readFileSync(join(packageRoot, 'spec/schema/merge-transaction.schema.json'))),
    status_schema_sha256: sha256(readFileSync(join(packageRoot, 'spec/schema/status.schema.json'))),
    next_schema_sha256: sha256(readFileSync(join(packageRoot, 'spec/schema/next.schema.json'))),
    contract_sha256: sha256(readFileSync(join(packageRoot, 'spec/cli-json-output.md'))),
    semantic_validator: 'openlogos/merge-transaction-semantic@1',
  });
}

function atomicStage(root: string, stagingPath: string, content: string | Buffer): string {
  const staging = join(root, ...stagingPath.split('/'));
  mkdirSync(resolve(staging, '..'), { recursive: true });
  const temp = join(resolve(staging, '..'), `.content.${process.pid}.tmp`);
  writeFileSync(temp, content);
  renameSync(temp, staging);
  return staging;
}

function treeSha256(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string, prefix = ''): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue;
      const path = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(path);
      hash.update(`${rel}\0${stat.isDirectory() ? 'd' : stat.isSymbolicLink() ? 'l' : 'f'}\0`);
      if (stat.isDirectory()) walk(path, rel);
      else if (stat.isFile()) hash.update(readFileSync(path));
    }
  };
  walk(root);
  return `sha256:${hash.digest('hex')}`;
}

function fixture(): { root: string; proposalDir: string; slug: string } {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-merge-tx-'));
  roots.push(root);
  const slug = 'transaction-fixture';
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: Fixture\nscenario_counter:\n  next_id: 2\ndecision_counter:\n  next_id: 7\nresource_index:\n  - path: logos/resources/prd/1-product-requirements/core-01.md\n    desc: 基线\n');
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
  for (const target of listMergeTransactionPlanTargets(f.proposalDir).filter(item => item.producer === 'agent')) {
    const content = target.mode === 'CREATE'
      ? Buffer.from('# D07 事务权威\n')
      : Buffer.from('# 需求基线\n\n## 事务需求\n\n正文\n');
    const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
    const staging = atomicStage(f.root, descriptor.staging_path, content);
    tx = submitMergeContent(f.proposalDir, target.slot_id, staging);
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
  it('UT-S09-251 UT-S09-252 UT-S09-253 ST-S09-99 UT-S11-71 UT-S16-28: 声明 staging path 是唯一 Agent 写入与 submit 入口', async () => {
    const f = fixture();
    let tx = createMergeTransaction(f.root, f.proposalDir, f.slug);
    expect(tx.content_slots.items).toHaveLength(2);
    expect(tx.content_slots.items.map(item => item.slot_id)).toEqual([...tx.content_slots.items.map(item => item.slot_id)].sort());
    for (const item of tx.content_slots.items) {
      expect(Object.keys(item).sort()).toEqual([
        'content_encoding', 'max_bytes', 'required', 'slot_id', 'staging_path',
        'submitted_sha256', 'target_ref', 'write_protocol',
      ]);
      expect(item.target_ref).toMatch(/^target_[a-f0-9]{20}$/);
      expect(item.staging_path).toContain(`/merge-staging/${tx.transaction_id}/${item.slot_id}/content`);
      expect(item).toMatchObject({ required: true, content_encoding: 'utf8-raw', max_bytes: 20 * 1024 * 1024, write_protocol: 'atomic-rename', submitted_sha256: null });
      expect(existsSync(join(f.root, ...item.staging_path.split('/')))).toBe(false);
    }
    const beforeStatus = readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
    expect(readMergeTransaction(f.proposalDir)).toEqual(tx);
    expect(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'))).toEqual(beforeStatus);

    const target = listMergeTransactionPlanTargets(f.proposalDir).find(item => item.producer === 'agent')!;
    const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
    const wrong = join(f.root, 'wrong.content');
    writeFileSync(wrong, '# 非声明路径\n');
    expect(() => submitMergeContent(f.proposalDir, target.slot_id, wrong)).toThrow(/staging_path/);
    expect(readMergeTransaction(f.proposalDir).content_slots.submitted).toBe(0);

    const staging = join(f.root, ...descriptor.staging_path.split('/'));
    mkdirSync(resolve(staging, '..'), { recursive: true });
    const outside = join(f.root, 'outside.content');
    writeFileSync(outside, '# 符号链接内容\n');
    symlinkSync(outside, staging);
    expect(lstatSync(staging).isSymbolicLink()).toBe(true);
    expect(() => submitMergeContent(f.proposalDir, target.slot_id, staging)).toThrow(/路径越界|符号链接/);
    rmSync(staging, { force: true });

    const content = target.mode === 'CREATE' ? '# D07 事务权威\n' : '# 需求基线\n\n## 事务需求\n\n正文\n';
    atomicStage(f.root, descriptor.staging_path, content);
    tx = submitMergeContent(f.proposalDir, target.slot_id, staging);
    expect(tx.content_slots.items.find(item => item.slot_id === target.slot_id)?.submitted_sha256).toBe(sha256(Buffer.from(content)));

    tx = prepare(f).tx;
    const sealed = sealMergeTransaction(f.root, f.proposalDir);
    const completed = applyMergeTransaction(f.root, f.proposalDir);
    expect(tx.phase).toBe('ready');
    expect(sealed.phase).toBe('sealed');
    expect(completed.phase).toBe('completed');
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')));
    expect(validate(completed), JSON.stringify(validate.errors)).toBe(true);
  });

  it('UT-S09-257 UT-S09-258 UT-S09-259 UT-S09-260 ST-S09-101 UT-S11-72 UT-S16-29 UT-S39-51 UT-S39-52 UT-S39-53 UT-S39-54 UT-S39-55 ST-S39-26: completed 无环 receipt、重放与精确 Git 白名单闭环', () => {
    const f = prepare();
    sealMergeTransaction(f.root, f.proposalDir);
    const completed = applyMergeTransaction(f.root, f.proposalDir);
    const receipt = completed.receipt!;
    expect(receipt.receipt_sha256).toBe(computeMergeReceiptSha256(receipt));
    const payloadPaths = [...new Set([...receipt.changed_paths, ...receipt.created_paths])].sort();
    const finalPaths = receipt.final_hashes.map(item => item.path);
    const artifactPaths = completed.artifact_hashes.map(item => item.path);
    expect(finalPaths).toEqual(payloadPaths);
    expect(finalPaths.filter(path => artifactPaths.includes(path))).toEqual([]);
    expect([...new Set([...finalPaths, ...artifactPaths])].sort()).toEqual(receipt.commit_paths);
    expect(artifactPaths).toEqual([
      `logos/changes/${f.slug}/MERGE_RECEIPT.json`,
      `logos/changes/${f.slug}/SPEC_MERGED`,
    ]);
    for (const item of [...receipt.final_hashes, ...completed.artifact_hashes]) {
      expect(sha256(readFileSync(join(f.root, ...item.path.split('/'))))).toBe(item.sha256);
    }
    expect(receipt.final_hashes.some(item => /merge-(?:content|staging)|journal|backup|MERGE_RECEIPT|SPEC_MERGED/.test(item.path))).toBe(false);
    expect(existsSync(join(f.proposalDir, 'merge-content', completed.transaction_id))).toBe(false);
    expect(existsSync(join(f.proposalDir, 'merge-staging', completed.transaction_id))).toBe(false);

    const beforeStatus = readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
    const replay = readMergeTransaction(f.proposalDir);
    expect(replay).toEqual(completed);
    expect(applyMergeTransaction(f.root, f.proposalDir)).toEqual(completed);
    expect(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'))).toEqual(beforeStatus);

    const invalid = structuredClone(completed);
    invalid.receipt!.commit_paths = invalid.receipt!.commit_paths.slice(1);
    expect(validateMergeTransactionSemantics(invalid).ok).toBe(false);
    expect(validateMergeTransactionSemantics(invalid).violations.map(item => item.code)).toContain('commit_paths_mismatch');

    writeFileSync(join(f.root, 'unrelated-dirty.txt'), 'keep me unstaged\n');
    execFileSync('git', ['init', '-q'], { cwd: f.root });
    execFileSync('git', ['add', '--', ...receipt.commit_paths], { cwd: f.root });
    const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: f.root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
    expect(staged).toEqual(receipt.commit_paths);
    expect(staged).not.toContain('unrelated-dirty.txt');
  });

  it('根 spec/schema JSON 整文件 Delta 由 OpenLogos producer 受控剥离与校验', () => {
    const payload = JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'openlogos/self-hosting-test@1',
      type: 'object',
      properties: { value: { type: 'string' } },
    }, null, 2) + '\n';
    const checked = validateAndStripNonMarkdownDelta(
      `## MODIFIED — spec/schema/self-hosting-test.schema.json（整文件替换）\n${payload}`,
      'MODIFY',
      'spec/schema/self-hosting-test.schema.json',
    );
    expect(checked).toEqual({ ok: true, payload });
    expect(validateAndStripNonMarkdownDelta(
      `## MODIFIED — spec/not-schema.json（整文件替换）\n${payload}`,
      'MODIFY',
      'spec/not-schema.json',
    ).ok).toBe(false);
  });

  it('UT-S05-43 ST-S05-20 UT-S16-31 UT-S16-32: action-command 注册表与未知值 fail-closed', async () => {
    expect(MERGE_TRANSACTION_ACTION_COMMANDS).toEqual({
      submit_content: 'submit-content', seal: 'seal', apply: 'apply', recover: 'recover', abort: 'abort',
    });
    for (const [action, command] of Object.entries(MERGE_TRANSACTION_ACTION_COMMANDS)) {
      expect(mergeTransactionCommandForAction(action)).toBe(command);
      expect(readFileSync(join(repoRoot, 'cli/src/commands/merge-transaction.ts'), 'utf8')).toContain(`'${command}'`);
    }
    expect(mergeTransactionCommandForAction('future_action')).toBeNull();
    expect(readFileSync(join(repoRoot, 'cli/src/index.ts'), 'utf8')).toContain('recover / abort');

    const f = fixture();
    const tx = createMergeTransaction(f.root, f.proposalDir, f.slug);
    const unknown = structuredClone(tx) as unknown as Record<string, unknown>;
    unknown.allowed_actions = ['future_action'];
    unknown.next_action = 'future_action';
    expect(validateMergeTransactionSemantics(unknown as never).ok).toBe(false);
    const unknownClassification = { ...tx, classification: 'future_failure' };
    expect(validateMergeTransactionSemantics(unknownClassification as never).violations.map(item => item.code)).toContain('classification_unknown');
    const invalidHash = { ...tx, contract_sha256: `sha256:${'A'.repeat(64)}` };
    expect(validateMergeTransactionSemantics(invalidHash as never).violations.map(item => item.code)).toContain('hash_invalid');
    const additional = { ...tx, private_transaction_path: '/tmp/private' };
    expect(validateMergeTransactionSemantics(additional as never).violations.map(item => item.code)).toContain('projection_fields_invalid');
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')));
    expect(validate(unknown)).toBe(false);
  });

  it('UT-S05-44 UT-S05-45 UT-S09-254 UT-S09-255 UT-S09-256 ST-S09-100 UT-S11-73 ST-S11-42 UT-S16-30: abort 三阶段清理、幂等与只读终态闭环', async () => {
    const collecting = fixture();
    createMergeTransaction(collecting.root, collecting.proposalDir, collecting.slug);
    const fixtures = [collecting, prepare(), prepare()];
    sealMergeTransaction(fixtures[2].root, fixtures[2].proposalDir);
    for (const f of fixtures) {
      const beforeFormal = [
        'logos/resources/prd/1-product-requirements/core-01.md',
        'logos/logos-project.yaml',
        'spec/example.md',
      ].map(path => sha256(readFileSync(join(f.root, ...path.split('/')))));
      const aborted = abortMergeTransaction(f.proposalDir);
      expect(aborted).toMatchObject({
        phase: 'failed', classification: 'aborted', allowed_actions: [], next_action: null,
        receipt: null, artifact_hashes: [],
      });
      expect(aborted.aborted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(existsSync(join(f.proposalDir, 'merge-content', aborted.transaction_id))).toBe(false);
      expect(existsSync(join(f.proposalDir, 'merge-staging', aborted.transaction_id))).toBe(false);
      expect(existsSync(join(f.proposalDir, 'MERGE_RECEIPT.json'))).toBe(false);
      expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(false);
      const afterFormal = [
        'logos/resources/prd/1-product-requirements/core-01.md',
        'logos/logos-project.yaml',
        'spec/example.md',
      ].map(path => sha256(readFileSync(join(f.root, ...path.split('/')))));
      expect(afterFormal).toEqual(beforeFormal);

      const terminalBytes = readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
      const terminalTree = treeSha256(f.root);
      expect(abortMergeTransaction(f.proposalDir)).toEqual(aborted);
      expect(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'))).toEqual(terminalBytes);
      const statusOne = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'status', '--slug', f.slug, '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
      const statusTwo = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'abort', '--slug', f.slug, '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
      expect(statusOne.status, statusOne.stderr).toBe(0);
      expect(statusTwo.status, statusTwo.stderr).toBe(0);
      expect(JSON.parse(statusOne.stdout).data.merge_transaction).toEqual(aborted);
      expect(JSON.parse(statusTwo.stdout).data.merge_transaction).toEqual(aborted);
      expect(treeSha256(f.root)).toBe(terminalTree);
    }

    const fatal = fixture();
    createMergeTransaction(fatal.root, fatal.proposalDir, fatal.slug);
    const fatalPath = join(fatal.proposalDir, 'MERGE_TRANSACTION.json');
    const fatalStored = JSON.parse(readFileSync(fatalPath, 'utf8'));
    fatalStored.phase = 'failed'; fatalStored.classification = 'internal_failure';
    writeFileSync(fatalPath, `${JSON.stringify(fatalStored, null, 2)}\n`);
    expect(readMergeTransaction(fatal.proposalDir)).toMatchObject({ allowed_actions: [], next_action: null, aborted_at: null });
    expect(() => abortMergeTransaction(fatal.proposalDir)).toThrow(/禁止 abort/);
    fatalStored.classification = 'recovery_required';
    writeFileSync(fatalPath, `${JSON.stringify(fatalStored, null, 2)}\n`);
    expect(readMergeTransaction(fatal.proposalDir)).toMatchObject({ allowed_actions: ['recover'], next_action: 'recover' });

    const completedFixture = prepare();
    sealMergeTransaction(completedFixture.root, completedFixture.proposalDir);
    applyMergeTransaction(completedFixture.root, completedFixture.proposalDir);
    expect(() => abortMergeTransaction(completedFixture.proposalDir)).toThrow(/禁止 abort/);

    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')));
    expect(validate(abortMergeTransaction(fixtures[0].proposalDir)), JSON.stringify(validate.errors)).toBe(true);
  });

  it(`${controlIds}: 状态机、身份、slot、schema 与只读投影保持单一权威`, async () => {
    const f = fixture();
    expect(existsSync(join(f.root, 'spec/schema/merge-transaction.schema.json'))).toBe(false);
    expect(existsSync(join(f.root, 'spec/cli-json-output.md'))).toBe(false);
    const first = createMergeTransaction(f.root, f.proposalDir, f.slug);
    const golden = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/merge-transaction-golden.json'), 'utf8')) as { transaction_id: string };
    expect(first.transaction_id).toBe(golden.transaction_id);
    const retry = createMergeTransaction(f.root, f.proposalDir, f.slug);
    expect(retry.transaction_id).toBe(first.transaction_id);
    expect(first.phase).toBe('collecting');
    expect(first.allowed_actions).toEqual(['submit_content', 'abort']);
    expect(first.content_slots.items.map(item => item.slot_id)).toEqual([...first.content_slots.items.map(item => item.slot_id)].sort());
    expect(first.content_slots.items.every(item => item.target_ref.startsWith('target_'))).toBe(true);
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

  it('UT-S19-20: 部署记录与 RunLogos handoff 对旧 candidate 任一 hash 均 fail-closed', () => {
    const hashA = `sha256:${'a'.repeat(64)}`;
    const hashB = `sha256:${'b'.repeat(64)}`;
    const current = freezeMergeTransactionCandidateFacts({
      schema: MERGE_TRANSACTION_CANDIDATE_SCHEMA,
      command_path: '/opt/openlogos/bin/openlogos',
      cli_version: MERGE_TRANSACTION_CANDIDATE_VERSION,
      candidate_tarball_sha256: hashA,
      merge_transaction_schema_sha256: hashA,
      status_schema_sha256: hashA,
      next_schema_sha256: hashA,
      contract_sha256: hashA,
      semantic_validator: 'openlogos/merge-transaction-semantic@1',
    });
    for (const field of [
      'candidate_tarball_sha256', 'merge_transaction_schema_sha256', 'status_schema_sha256',
      'next_schema_sha256', 'contract_sha256',
    ] as const) {
      const old = { ...current, [field]: hashB };
      expect(() => assertMergeTransactionCandidateMatch(current, old)).toThrow(`candidate_fact_mismatch:${field}`);
      expect(() => assertMergeTransactionCandidateMatch(old, old, [hashB])).toThrow(`candidate_hash_invalidated:${field}`);
    }
    expect(() => freezeMergeTransactionCandidateFacts({ ...current, private_transaction_path: '/tmp/private' } as never)).toThrow(/fields/);
  });

  it('UT-S19-21: candidate 任一步失败都选择完整旧事实，混装资产不能通过回滚对账', () => {
    const previous = freezeMergeTransactionCandidateFacts({
      schema: MERGE_TRANSACTION_CANDIDATE_SCHEMA,
      command_path: '/opt/openlogos/bin/openlogos',
      cli_version: MERGE_TRANSACTION_CANDIDATE_VERSION,
      candidate_tarball_sha256: `sha256:${'1'.repeat(64)}`,
      merge_transaction_schema_sha256: `sha256:${'2'.repeat(64)}`,
      status_schema_sha256: `sha256:${'3'.repeat(64)}`,
      next_schema_sha256: `sha256:${'4'.repeat(64)}`,
      contract_sha256: `sha256:${'5'.repeat(64)}`,
      semantic_validator: 'openlogos/merge-transaction-semantic@1',
    });
    const candidate = { ...previous, candidate_tarball_sha256: `sha256:${'6'.repeat(64)}`, contract_sha256: `sha256:${'7'.repeat(64)}` };
    for (const failed of ['install_ok', 'self_check_ok', 'contract_match'] as const) {
      const check = { install_ok: true, self_check_ok: true, contract_match: true, [failed]: false };
      expect(decideMergeTransactionCandidate(previous, candidate, check)).toEqual({ action: 'restore-previous', selected: previous });
    }
    expect(decideMergeTransactionCandidate(previous, candidate, { install_ok: true, self_check_ok: true, contract_match: true }))
      .toEqual({ action: 'keep-candidate', selected: candidate });
    expect(() => assertMergeTransactionCandidateRestored(previous, candidate)).toThrow('candidate_rollback_mixed_assets');
    expect(() => assertMergeTransactionCandidateRestored(previous, previous)).not.toThrow();
  });

  it('ST-S16-09 UT-S19-19 ST-S19-14: 修正源码真实 pack/install，随包双层 golden 自检并演练隔离回滚', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openlogos-corrected-candidate-'));
    roots.push(root);
    const installRoot = join(root, 'install');
    const oldSource = join(root, 'old-source');
    mkdirSync(join(oldSource, 'dist'), { recursive: true });
    mkdirSync(join(oldSource, 'spec/schema'), { recursive: true });
    writeFileSync(join(oldSource, 'package.json'), `${JSON.stringify({
      name: '@miniidealab/openlogos', version: '0.14.0', type: 'module',
      bin: { openlogos: 'dist/index.js' }, files: ['dist', 'spec'],
    }, null, 2)}\n`);
    writeFileSync(join(oldSource, 'dist/index.js'), '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("0.14.0"); else console.log("旧 candidate");\n');
    for (const name of ['merge-transaction', 'status', 'next']) writeFileSync(join(oldSource, `spec/schema/${name}.schema.json`), '{}\n');
    writeFileSync(join(oldSource, 'spec/cli-json-output.md'), '旧 candidate 合同\n');

    const parsePack = (stdout: string): { filename: string; files: Array<{ path: string }> } => {
      const start = stdout.indexOf('[');
      if (start < 0) throw new Error(`npm pack 输出缺 JSON：${stdout}`);
      return JSON.parse(stdout.slice(start))[0];
    };
    const oldPackRoot = join(root, 'old-pack');
    mkdirSync(oldPackRoot, { recursive: true });
    const oldMeta = parsePack(checked(npmCommand, ['pack', oldSource, '--pack-destination', oldPackRoot, '--json', '--ignore-scripts'], repoRoot));
    const oldTarball = join(oldPackRoot, oldMeta.filename);
    const isolatedSource = join(root, 'candidate-source');
    const isolatedCli = join(isolatedSource, 'cli');
    const generatedPackageDirs = new Set([
      'node_modules', 'skills', 'spec', 'opencode-plugin-template', 'codex-plugin-template',
      'claude-plugin-template', 'zcode-plugin-template', 'qoder-plugin-template', 'workbuddy-plugin-template',
    ]);
    cpSync(join(repoRoot, 'cli'), isolatedCli, {
      recursive: true,
      filter: source => source === join(repoRoot, 'cli') || !generatedPackageDirs.has(source.slice(join(repoRoot, 'cli').length + 1).split('/')[0]),
    });
    for (const dir of ['skills', 'spec', 'plugin-opencode', 'plugin-codex', 'plugin', 'plugin-zcode', 'plugin-qoder', 'plugin-workbuddy']) {
      cpSync(join(repoRoot, dir), join(isolatedSource, dir), { recursive: true });
    }
    symlinkSync(join(repoRoot, 'cli/node_modules'), join(isolatedCli, 'node_modules'));
    const candidateMeta = parsePack(checked(npmCommand, ['pack', isolatedCli, '--pack-destination', root, '--json'], repoRoot));
    const tarball = join(root, candidateMeta.filename);
    const required = [
      'spec/schema/merge-transaction.schema.json', 'spec/schema/status.schema.json', 'spec/schema/next.schema.json',
      'skills/merge-executor/SKILL.md', 'skills/merge-executor/SKILL.en.md',
      'dist/lib/merge-transaction-semantic.js', 'dist/lib/merge-transaction-candidate.js',
      'spec/golden/merge-transaction-completed.json',
    ];
    const packedFiles = new Set(candidateMeta.files.map(item => item.path));
    for (const path of required) expect(packedFiles.has(path), `tarball 缺少 ${path}`).toBe(true);

    checked(npmCommand, ['install', '--prefix', installRoot, '--force', '--ignore-scripts', '--no-audit', '--no-fund', oldTarball], repoRoot);
    const packageRoot = join(installRoot, 'node_modules/@miniidealab/openlogos');
    const entry = join(packageRoot, 'dist/index.js');
    const previous = candidateFacts(entry, oldTarball, packageRoot);
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe('0.14.0');

    checked(npmCommand, ['install', '--prefix', installRoot, '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarball], repoRoot);
    const current = candidateFacts(entry, tarball, packageRoot);
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe('0.14.1');
    expect(checked(process.execPath, [entry, '--help'], root)).toContain('submit-content / seal / apply / recover / abort');
    expect(current.merge_transaction_schema_sha256).toBe(sha256(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'))));
    expect(current.status_schema_sha256).toBe(sha256(readFileSync(join(repoRoot, 'spec/schema/status.schema.json'))));
    expect(current.next_schema_sha256).toBe(sha256(readFileSync(join(repoRoot, 'spec/schema/next.schema.json'))));
    expect(current.contract_sha256).toBe(sha256(readFileSync(join(repoRoot, 'spec/cli-json-output.md'))));

    const golden = JSON.parse(readFileSync(join(packageRoot, 'spec/golden/merge-transaction-completed.json'), 'utf8'));
    const semantic = await import(`${pathToFileURL(join(packageRoot, 'dist/lib/merge-transaction-semantic.js')).href}?candidate=${Date.now()}`);
    expect(semantic.validateMergeTransactionSemantics(golden)).toEqual({ schema: 'openlogos/merge-transaction-semantic@1', ok: true, violations: [] });
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const mergeSchema = ajv.compile(JSON.parse(readFileSync(join(packageRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')));
    expect(mergeSchema(golden), JSON.stringify(mergeSchema.errors)).toBe(true);

    let observed;
    for (const id of ['SMOKE-core-148', 'SMOKE-core-151', 'SMOKE-core-153', 'SMOKE-core-154']) {
      const output = checked(process.execPath, [join(repoRoot, 'scripts/merge-transaction-smoke-fixtures.js'), '--case', id, '--openlogos', entry], repoRoot);
      const evidence = JSON.parse(output);
      expect(evidence).toMatchObject({ id, status: 'pass', precreated_completed: false });
      if (id === 'SMOKE-core-148') observed = evidence;
    }
    const statusSchema = ajv.compile(JSON.parse(readFileSync(join(packageRoot, 'spec/schema/status.schema.json'), 'utf8')));
    const nextSchema = ajv.compile(JSON.parse(readFileSync(join(packageRoot, 'spec/schema/next.schema.json'), 'utf8')));
    expect(statusSchema(observed.status_data), JSON.stringify(statusSchema.errors)).toBe(true);
    expect(nextSchema(observed.next_data), JSON.stringify(nextSchema.errors)).toBe(true);

    const decision = decideMergeTransactionCandidate(previous, current, { install_ok: true, self_check_ok: true, contract_match: false });
    expect(decision).toEqual({ action: 'restore-previous', selected: previous });
    const rollbackCommands = buildMergeTransactionRollbackCommands(resolve(installRoot), resolve(oldTarball));
    expect(rollbackCommands).toHaveLength(2);
    for (const command of rollbackCommands) checked(npmCommand, command.args, repoRoot);
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe('0.14.0');
    const restored = candidateFacts(entry, oldTarball, packageRoot);
    expect(() => assertMergeTransactionCandidateRestored(previous, restored)).not.toThrow();
    expect(existsSync(join(packageRoot, 'dist/lib/merge-transaction-semantic.js'))).toBe(false);
    expect(existsSync(join(packageRoot, 'spec/golden/merge-transaction-completed.json'))).toBe(false);
  }, 120_000);

  it('ST-S16-07 UT-S19-12 UT-S19-13 UT-S19-14 UT-S19-15 UT-S19-16 UT-S19-17 UT-S19-18 ST-S19-10 ST-S19-11 ST-S19-12 ST-S19-13: 当前安装态合同与命令入口自描述一致', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'cli/package.json'), 'utf8')) as { version: string; files: string[] };
    expect(pkg.version).toBe('0.14.1');
    expect(pkg.files).toContain('spec');
    expect(readFileSync(join(repoRoot, 'cli/src/index.ts'), 'utf8')).toContain("args[1] === 'transaction'");
    expect(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')).toContain('openlogos/merge-transaction@1');
    expect(readFileSync(join(repoRoot, 'skills/merge-executor/SKILL.md'), 'utf8')).toContain('Merge transaction');
    expect(readFileSync(join(repoRoot, 'scripts/smoke-merge-transaction-candidate.js'), 'utf8')).toContain('SMOKE-core-150');
    const bridgeSource = readFileSync(join(repoRoot, 'scripts/run-runlogos-merge-transaction-candidate-e2e.mjs'), 'utf8');
    expect(bridgeSource).toContain('run-openlogos-merge-transaction-candidate-e2e.mjs');
    expect(bridgeSource).toContain('adopt-openlogos-merge-transaction-authority');
    expect(bridgeSource).toContain("['clone', '--quiet', '--no-hardlinks'");
    const evidence = {
      schema: 'runlogos/openlogos-candidate-e2e@1', passed: true,
      candidate: { version: '0.14.0' },
      scenarios: [
        { scenario: 'create', phase: 'completed', apply_count: 1, final_path_count: 15, artifact_path_count: 2, commit_path_count: 17 },
        { scenario: 'modify', phase: 'completed', apply_count: 1, final_path_count: 15, artifact_path_count: 2, commit_path_count: 17 },
        { scenario: 'mixed', phase: 'completed', apply_count: 1, final_path_count: 15, artifact_path_count: 2, commit_path_count: 17 },
        { scenario: 'response-lost', phase: 'completed', apply_count: 1, final_path_count: 15, artifact_path_count: 2, commit_path_count: 17, response_lost_injected: true },
      ],
    };
    expect(validateRunLogosCandidateEvidence(evidence)).toBe(evidence);
    expect(() => validateRunLogosCandidateEvidence({ ...evidence, passed: false })).toThrow(/通过状态/);
    expect(() => validateRunLogosCandidateEvidence({ ...evidence, used_mock: true })).toThrow(/禁止项/);
    expect(() => validateRunLogosCandidateEvidence({ ...evidence, scenarios: evidence.scenarios.slice(0, 3) })).toThrow(/完整覆盖/);
  });
});
