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
  abortMergeTransaction, applyMergeTransaction, attributeMergePreflightError, createMergeTransaction,
  listMergeTransactionPlanTargets, MERGE_TRANSACTION_ACTION_COMMANDS,
  MergeTransactionError, mergeTransactionCommandForAction, readMergeTransaction, recoverMergeTransaction,
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
import { buildTestChangeSet, TestChangeSetBuildError } from '../src/lib/test-change-set.js';
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
  const assetHash = (path: string): string => existsSync(join(packageRoot, ...path.split('/')))
    ? sha256(readFileSync(join(packageRoot, ...path.split('/'))))
    : sha256(Buffer.from(`absent:${path}`));
  return freezeMergeTransactionCandidateFacts({
    schema: MERGE_TRANSACTION_CANDIDATE_SCHEMA,
    command_path: resolve(commandPath),
    cli_version: MERGE_TRANSACTION_CANDIDATE_VERSION,
    candidate_tarball_sha256: sha256(readFileSync(tarball)),
    merge_transaction_schema_sha256: sha256(readFileSync(join(packageRoot, 'spec/schema/merge-transaction.schema.json'))),
    status_schema_sha256: sha256(readFileSync(join(packageRoot, 'spec/schema/status.schema.json'))),
    next_schema_sha256: sha256(readFileSync(join(packageRoot, 'spec/schema/next.schema.json'))),
    contract_sha256: sha256(readFileSync(join(packageRoot, 'spec/cli-json-output.md'))),
    merge_executor_skill_sha256: assetHash('skills/merge-executor/SKILL.md'),
    merge_transaction_golden_sha256: assetHash('spec/golden/merge-transaction-completed.json'),
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

function preflightFixture(afterContents: string[], targetNames?: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-merge-preflight-'));
  roots.push(root);
  const slug = 'preflight-fixture';
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: Preflight Fixture\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const targets = afterContents.map((content, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    const targetName = targetNames?.[index] ?? `core-S${suffix}-test-cases.md`;
    const targetPath = `logos/resources/test/${targetName}`;
    const deltaPath = `deltas/test/${targetName}`;
    put(root, targetPath, `# 测试 ${suffix}\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S${suffix}-01 | 旧定义 |\n`);
    const body = content.includes('## 测试矩阵') ? content.split('## 测试矩阵')[1].replace(/^\s*/, '') : content;
    put(root, `logos/changes/${slug}/${deltaPath}`, `## MODIFIED — 测试矩阵\n\n${body}`);
    return { targetPath, deltaPath, content };
  });
  const yamlTargets = targets.map(({ targetPath, deltaPath }) => `    - category: test\n      scenario_ids: [S09]\n      mode: MODIFY\n      delta_path: ${deltaPath}\n      reason: preflight fixture\n      evidence: [target_exists]\n      missing_evidence: []`).join('\n');
  put(root, `logos/changes/${slug}/proposal.md`, `# preflight fixture\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S09]\n  targets:\n${yamlTargets}\n\`\`\`\n`);
  put(root, `logos/changes/${slug}/tasks.md`, '# 任务\n\n## [delta] 规格变更\n\n## [code] 代码实现\n');
  let tx = createMergeTransaction(root, proposalDir, slug);
  for (const target of listMergeTransactionPlanTargets(proposalDir)) {
    const configured = targets.find(item => item.targetPath === target.target_path)!;
    const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
    const staging = atomicStage(root, descriptor.staging_path, configured.content);
    tx = submitMergeContent(proposalDir, target.slot_id, staging);
  }
  return { root, proposalDir, slug, tx, targets };
}

function nestedAnchorFixture(count = 1, invalidIndex: number | null = null, submit = true) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-nested-anchor-'));
  roots.push(root);
  const slug = 'nested-anchor-fixture';
  const proposalDir = join(root, 'logos', 'changes', slug);
  const parent = '七、项目文件夹动态 watcher 交互规则';
  const leaf = '7.1 已打开文件外部变化感知';
  put(root, 'logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: Nested Anchor Fixture\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const targets = Array.from({ length: count }, (_, index) => {
    const scenario = String(index + 1).padStart(2, '0');
    const targetPath = `logos/resources/test/core-S${scenario}-test-cases.md`;
    const deltaPath = `deltas/test/core-S${scenario}-test-cases.md`;
    const id = `UT-S${scenario}-01`;
    const before = [
      `# S${scenario} 测试`, '', `## ${parent}`, '', `### ${leaf}`, '',
      '| 用例ID | 验证目标 |', '|---|---|', `| ${id} | 旧定义 |`, '',
      '## 八、其它规则', '', `### ${leaf}`, '', '同名叶保持。', '',
    ].join('\n');
    const body = [
      '| 用例ID | 验证目标 |', '|---|---|', `| ${id} | 新定义 |`, '',
      '### 事件与最终态交互', '', '同形规则。',
    ].join('\n');
    const finalBody = body.replace('### 事件与最终态交互', '#### 事件与最终态交互');
    const finalParent = index === invalidIndex ? '错误父标题' : parent;
    const final = before.replace(`## ${parent}\n\n### ${leaf}\n\n| 用例ID | 验证目标 |\n|---|---|\n| ${id} | 旧定义 |`,
      `## ${finalParent}\n\n### ${leaf}\n\n${finalBody}`);
    put(root, targetPath, before);
    put(root, `logos/changes/${slug}/${deltaPath}`, `## MODIFIED — ${parent} > ${leaf}\n\n${body}\n`);
    return { targetPath, deltaPath, before, final };
  });
  const yamlTargets = targets.map(({ deltaPath }) => [
    '    - category: test', '      scenario_ids: [S09]', '      mode: MODIFY',
    `      delta_path: ${deltaPath}`, '      reason: nested anchor fixture',
    '      evidence: [target_exists]', '      missing_evidence: []',
  ].join('\n')).join('\n');
  put(root, `logos/changes/${slug}/proposal.md`, `# nested anchor fixture\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S09]\n  targets:\n${yamlTargets}\n\`\`\`\n`);
  put(root, `logos/changes/${slug}/tasks.md`, '# 任务\n\n## [delta] 规格变更\n\n## [code] 代码实现\n');
  let tx = createMergeTransaction(root, proposalDir, slug);
  if (submit) {
    for (const target of listMergeTransactionPlanTargets(proposalDir)) {
      const configured = targets.find(item => item.targetPath === target.target_path)!;
      const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
      const staging = atomicStage(root, descriptor.staging_path, configured.final);
      tx = submitMergeContent(proposalDir, target.slot_id, staging);
    }
  }
  return { root, proposalDir, slug, tx, targets, parent, leaf };
}

function canonicalForTest(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalForTest).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalForTest(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function forceLegacySealed(
  f: ReturnType<typeof preflightFixture>,
  replacements: Map<number, string> = new Map(),
  producerOverrides: Map<number, 'agent' | 'openlogos'> = new Map(),
) {
  const path = join(f.proposalDir, 'MERGE_TRANSACTION.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  delete stored.preflight;
  stored.phase = 'sealed';
  stored.classification = null;
  stored.targets.forEach((target: Record<string, unknown>, index: number) => {
    const replacement = replacements.get(index);
    if (replacement !== undefined) {
      const contentPath = join(f.proposalDir, 'merge-content', stored.transaction_id, `${target.slot_id}.content`);
      mkdirSync(resolve(contentPath, '..'), { recursive: true });
      writeFileSync(contentPath, replacement);
      target.content_sha256 = sha256(Buffer.from(replacement));
    }
    if (producerOverrides.has(index)) target.producer = producerOverrides.get(index);
    target.sealed_sha256 = target.content_sha256;
  });
  const hashes = stored.targets.map((target: Record<string, unknown>) => ({
    slot_id: target.slot_id,
    content_sha256: target.content_sha256,
  }));
  stored.seal_sha256 = sha256(Buffer.from(canonicalForTest({
    transaction_id: stored.transaction_id,
    target_set_sha256: stored.target_set_sha256,
    hashes,
  })));
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

afterEach(() => {
  delete process.env.OPENLOGOS_TEST_MERGE_TX_FAIL_AFTER;
  delete process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT;
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
  it('UT-S09-271: submit 只持久化安全原始字节，嵌套锚语义延迟到 seal', () => {
    const f = nestedAnchorFixture(1, 0);
    expect(f.tx).toMatchObject({ phase: 'ready', classification: null });
    expect(f.tx.content_slots.items[0].submitted_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => sealMergeTransaction(f.root, f.proposalDir)).toThrowError(MergeTransactionError);
    const reopened = readMergeTransaction(f.proposalDir);
    expect(reopened).toMatchObject({ phase: 'collecting', classification: 'slot_identity_mismatch' });
    expect(reopened.content_slots.missing_slot_ids).toEqual([reopened.content_slots.items[0].slot_id]);
  });

  it('UT-S09-272: seal 以真实父子标题链验证嵌套锚并拒绝字面量路径伪标题', () => {
    const valid = nestedAnchorFixture();
    expect(sealMergeTransaction(valid.root, valid.proposalDir)).toMatchObject({ phase: 'sealed', classification: null });

    const invalid = nestedAnchorFixture(1, 0);
    const descriptor = invalid.tx.content_slots.items[0];
    const literal = `${invalid.targets[0].before}\n## ${invalid.parent} > ${invalid.leaf}\n\n伪修复。\n`;
    const staging = atomicStage(invalid.root, descriptor.staging_path, literal);
    submitMergeContent(invalid.proposalDir, descriptor.slot_id, staging);
    expect(() => sealMergeTransaction(invalid.root, invalid.proposalDir)).toThrow(/MODIFIED 章节/);
    expect(readMergeTransaction(invalid.proposalDir).phase).toBe('collecting');
  });

  it('UT-S09-273: 七 slot 局部 reopen 只清责任 hash，故障窗口保持完整状态', () => {
    const f = nestedAnchorFixture(7, 3);
    const before = readMergeTransaction(f.proposalDir);
    expect(before.content_slots.items.filter(item => item.submitted_sha256)).toHaveLength(7);
    expect(() => sealMergeTransaction(f.root, f.proposalDir)).toThrow(/MODIFIED 章节/);
    const reopened = readMergeTransaction(f.proposalDir);
    expect(reopened.transaction_id).toBe(before.transaction_id);
    expect(reopened.target_set_sha256).toBe(before.target_set_sha256);
    expect(reopened.content_slots.items.filter(item => item.submitted_sha256)).toHaveLength(6);
    expect(reopened.content_slots.missing_slot_ids).toHaveLength(1);

    process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT = 'before-rename';
    const crash = nestedAnchorFixture(1, 0);
    expect(() => sealMergeTransaction(crash.root, crash.proposalDir)).toThrow('test fault before reopen rename');
    expect(readMergeTransaction(crash.proposalDir).phase).toBe('ready');
    delete process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT;
  });

  it('UT-S09-274: apply 首写前重验 Agent/OpenLogos producer，旧影子解析器不可达', () => {
    const nested = nestedAnchorFixture();
    const sealed = sealMergeTransaction(nested.root, nested.proposalDir);
    expect(sealed.phase).toBe('sealed');
    writeFileSync(join(nested.proposalDir, nested.targets[0].deltaPath), '## MODIFIED — 漂移\n\n内容\n');
    expect(() => applyMergeTransaction(nested.root, nested.proposalDir)).toThrow(/Delta 已漂移/);
    expect(readFileSync(join(nested.root, nested.targets[0].targetPath), 'utf8')).toBe(nested.targets[0].before);

    const mixed = prepare();
    expect(sealMergeTransaction(mixed.root, mixed.proposalDir).phase).toBe('sealed');
    expect(applyMergeTransaction(mixed.root, mixed.proposalDir).phase).toBe('completed');
    const source = readFileSync(join(repoRoot, 'cli/src/lib/merge-transaction.ts'), 'utf8');
    expect(source).not.toContain('function parseDeltaSections');
    expect(source).not.toContain('function applyMarkdownDelta');
    expect(source).not.toContain('function validateAgentSemantics');
  });

  it('ST-S09-106: 真实 CLI 完成嵌套锚 submit→status→seal→apply', () => {
    const f = nestedAnchorFixture(1, null, false);
    const target = listMergeTransactionPlanTargets(f.proposalDir)[0];
    const descriptor = f.tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
    const staging = atomicStage(f.root, descriptor.staging_path, f.targets[0].final);
    const cli = join(repoRoot, 'cli/dist/index.js');
    const invoke = (args: string[]) => JSON.parse(checked(process.execPath, [cli, ...args, '--format', 'json'], f.root));
    expect(invoke(['merge', 'transaction', 'submit-content', '--slug', f.slug, '--slot', target.slot_id, '--file', staging]).data.merge_transaction.phase).toBe('ready');
    expect(invoke(['merge', 'transaction', 'status', '--slug', f.slug]).data.merge_transaction.phase).toBe('ready');
    expect(invoke(['merge', 'transaction', 'seal', '--slug', f.slug]).data.merge_transaction.phase).toBe('sealed');
    expect(invoke(['merge', 'transaction', 'apply', '--slug', f.slug]).data.merge_transaction.phase).toBe('completed');
    const final = readFileSync(join(f.root, f.targets[0].targetPath), 'utf8');
    expect(final).toContain(`## ${f.parent}\n\n### ${f.leaf}`);
    expect(final).not.toContain(`${f.parent} > ${f.leaf}`);
  });

  it('ST-S09-107: RunLogos 同形七 slot 在同事务局部恢复并幂等重放 completed', () => {
    const f = nestedAnchorFixture(7, 6);
    expect(() => sealMergeTransaction(f.root, f.proposalDir)).toThrow(/MODIFIED 章节/);
    const reopened = readMergeTransaction(f.proposalDir);
    const missing = reopened.content_slots.missing_slot_ids[0];
    const missingTarget = listMergeTransactionPlanTargets(f.proposalDir).find(item => item.slot_id === missing)!;
    const configured = f.targets.find(item => item.targetPath === missingTarget.target_path)!;
    const descriptor = reopened.content_slots.items.find(item => item.slot_id === missing)!;
    const staging = atomicStage(f.root, descriptor.staging_path, configured.final.replace('错误父标题', f.parent));
    submitMergeContent(f.proposalDir, missing, staging);
    expect(sealMergeTransaction(f.root, f.proposalDir).transaction_id).toBe(reopened.transaction_id);
    const completed = applyMergeTransaction(f.root, f.proposalDir);
    expect(completed).toMatchObject({ transaction_id: reopened.transaction_id, phase: 'completed' });
    expect(applyMergeTransaction(f.root, f.proposalDir)).toEqual(completed);
  });

  it('UT-S09-261: 新事务在 seal 首写前拒绝歧义 after，并只退回责任 slot', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const f = preflightFixture([invalid]);
    const formalBefore = readFileSync(join(f.root, f.targets[0].targetPath));
    let caught: MergeTransactionError | null = null;
    try { sealMergeTransaction(f.root, f.proposalDir); } catch (error) {
      if (error instanceof MergeTransactionError) caught = error;
      else throw error;
    }
    expect(caught).toMatchObject({ classification: 'slot_identity_mismatch', retryable: true });
    expect(caught?.transaction).toMatchObject({
      phase: 'collecting', classification: 'slot_identity_mismatch',
      allowed_actions: ['submit_content', 'abort'], next_action: 'submit_content',
    });
    expect(caught?.transaction?.content_slots.missing_slot_ids).toEqual([f.tx.content_slots.items[0].slot_id]);
    expect(readFileSync(join(f.root, f.targets[0].targetPath))).toEqual(formalBefore);
    for (const artifact of ['BASELINE_CLOSURE_APPLY_JOURNAL.json', '.baseline-closure-apply-txn', 'MERGE_RECEIPT.json', 'SPEC_MERGED']) {
      expect(existsSync(join(f.proposalDir, artifact))).toBe(false);
    }

    const repaired = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n';
    const descriptor = readMergeTransaction(f.proposalDir).content_slots.items[0];
    const staging = atomicStage(f.root, descriptor.staging_path, repaired);
    submitMergeContent(f.proposalDir, descriptor.slot_id, staging);
    expect(sealMergeTransaction(f.root, f.proposalDir)).toMatchObject({ phase: 'sealed', classification: null });
  });

  it('UT-S16-33: retryable CLI 错误与 status/next 读取同一 collecting 投影', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const f = preflightFixture([invalid]);
    const seal = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'seal', '--slug', f.slug, '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
    expect(seal.status).toBe(1);
    const envelope = JSON.parse(seal.stderr.trim());
    expect(envelope.error.details).toMatchObject({
      transaction_id: f.tx.transaction_id, phase: 'collecting', classification: 'slot_identity_mismatch',
      allowed_actions: ['submit_content', 'abort'], next_action: 'submit_content', retryable: true,
    });
    const status = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'status', '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
    const next = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'next', '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
    expect(status.status, status.stderr).toBe(0);
    expect(next.status, next.stderr).toBe(0);
    const statusTx = JSON.parse(status.stdout).data.merge_transaction;
    const nextTx = JSON.parse(next.stdout).data.merge_transaction;
    expect(nextTx).toEqual(statusTx);
    expect(statusTx).toMatchObject({ transaction_id: f.tx.transaction_id, phase: 'collecting', next_action: 'submit_content' });
  });

  it('UT-S39-56: after 严格扫描输出结构化 target paths，before 历史歧义保持兼容', () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe]);
    const ambiguous = Buffer.from('| 用例ID | 目标 |\n|---|---|\n| UT-S01-01 |\n');
    const duplicate = Buffer.from('| 用例ID | 目标 |\n|---|---|\n| UT-S01-01 | A |\n| UT-S01-01 | B |\n');
    for (const [bytes, code] of [
      [invalidUtf8, 'test-change-set-invalid-utf8'],
      [ambiguous, 'test-change-set-ambiguous-table'],
      [duplicate, 'test-change-set-duplicate-id'],
    ] as const) {
      expect(() => buildTestChangeSet({ change: 'x', module: 'core', targets: [{ targetPath: 'logos/resources/test/core-S01-test-cases.md', beforeBytes: null, afterBytes: bytes }] }))
        .toThrowError(expect.objectContaining({ code, targetPaths: ['logos/resources/test/core-S01-test-cases.md'] }));
    }
    const pathA = 'logos/resources/test/core-S01-test-cases.md';
    const pathB = 'logos/resources/test/core-S02-test-cases.md';
    try {
      buildTestChangeSet({ change: 'x', module: 'core', targets: [
        { targetPath: pathB, beforeBytes: null, afterBytes: Buffer.from('| 用例ID | 目标 |\n|---|---|\n| UT-S01-01 | B |\n') },
        { targetPath: pathA, beforeBytes: Buffer.from('| 用例ID | 目标 |\n|---|---|\n| UT-S01-01 |\n'), afterBytes: Buffer.from('| 用例ID | 目标 |\n|---|---|\n| UT-S01-01 | A |\n') },
      ] });
      throw new Error('预期 duplicate 错误');
    } catch (error) {
      expect(error).toBeInstanceOf(TestChangeSetBuildError);
      expect((error as TestChangeSetBuildError).targetPaths).toEqual([pathA, pathB]);
    }
  });

  it('UT-S39-57: preflight canonical hash 绑定 seal，并在 apply 首写前拒绝 metadata 漂移', () => {
    const first = prepare();
    sealMergeTransaction(first.root, first.proposalDir);
    const stored = JSON.parse(readFileSync(join(first.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'));
    expect(stored.preflight).toMatchObject({ schema: 'openlogos/merge-preflight@1', transaction_id: stored.transaction_id });
    expect(stored.preflight.targets.map((target: { path: string }) => target.path)).toEqual(
      [...stored.preflight.targets.map((target: { path: string }) => target.path)].sort(),
    );
    expect(stored.preflight.final_target_paths).toEqual([...stored.preflight.final_target_paths].sort());
    expect(stored.seal_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(stored.preflight)).not.toContain('completed_at');
    writeFileSync(join(first.root, 'logos/logos-project.yaml'), `${readFileSync(join(first.root, 'logos/logos-project.yaml'), 'utf8')}# metadata drift\n`);
    expect(() => applyMergeTransaction(first.root, first.proposalDir)).toThrow(/preflight identity 漂移/);
    expect(readMergeTransaction(first.proposalDir).phase).toBe('sealed');
    expect(existsSync(join(first.proposalDir, 'BASELINE_CLOSURE_APPLY_JOURNAL.json'))).toBe(false);
  });

  it('UT-S05-46: legacy reopen 后 next_action 只由 collecting/missing slot 派生', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const f = preflightFixture([invalid]);
    forceLegacySealed(f);
    expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow();
    expect(readMergeTransaction(f.proposalDir)).toMatchObject({
      transaction_id: f.tx.transaction_id, phase: 'collecting', classification: 'slot_identity_mismatch',
      allowed_actions: ['submit_content', 'abort'], next_action: 'submit_content',
      content_slots: { submitted: 0, missing_slot_ids: [f.tx.content_slots.items[0].slot_id] },
    });
  });

  it('ST-S05-21: status 与 next 跨进程稳定重放 reopened collecting 投影', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const f = preflightFixture([invalid]);
    forceLegacySealed(f);
    expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow();
    const status = checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'status', '--format', 'json'], f.root);
    const next = checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'next', '--format', 'json'], f.root);
    const statusTx = JSON.parse(status).data.merge_transaction;
    const nextTx = JSON.parse(next).data.merge_transaction;
    expect(nextTx).toEqual(statusTx);
    expect(nextTx).toMatchObject({ phase: 'collecting', next_action: 'submit_content' });
  });

  it('UT-S09-262: 0.14.1 legacy sealed 只清空实际拒绝 slot 并保留事务身份', () => {
    const validA = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | A |\n';
    const validB = '# 测试 02\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S02-01 | B |\n';
    const invalid = validA.replace('| A |', '|');
    const f = preflightFixture([validA, validB]);
    const legacy = forceLegacySealed(f, new Map([[0, invalid]]));
    expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow();
    const reopened = JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'));
    expect(reopened).toMatchObject({
      transaction_id: legacy.transaction_id, plan_sha256: legacy.plan_sha256,
      target_set_sha256: legacy.target_set_sha256, phase: 'collecting', seal_sha256: null,
    });
    expect(reopened.targets[0].content_sha256).toBeNull();
    expect(reopened.targets[1].content_sha256).toBe(legacy.targets[1].content_sha256);
    expect(reopened.targets.every((target: Record<string, unknown>) => target.sealed_sha256 === null)).toBe(true);
  });

  it('UT-S09-263: 多 target 仅在全部唯一归因 Agent 时共同 reopen', () => {
    const duplicateA = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | A |\n';
    const duplicateB = '# 测试 02\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | B |\n';
    const allAgent = preflightFixture([duplicateA, duplicateB]);
    forceLegacySealed(allAgent);
    expect(() => applyMergeTransaction(allAgent.root, allAgent.proposalDir)).toThrow();
    expect(readMergeTransaction(allAgent.proposalDir).content_slots.missing_slot_ids).toHaveLength(2);

    const frozenTargets = [
      { slot_id: 'slot-agent', target_path: 'logos/resources/test/a.md', producer: 'agent' as const },
      { slot_id: 'slot-core', target_path: 'spec/a.md', producer: 'openlogos' as const },
    ];
    expect(attributeMergePreflightError(frozenTargets, {
      code: 'duplicate', target_paths: ['logos/resources/test/a.md', 'spec/a.md'], producer: 'mixed', retryable: true,
    })).toBeNull();
    expect(attributeMergePreflightError(frozenTargets, {
      code: 'unknown', target_paths: ['message/forged.md'], producer: 'unknown', retryable: true,
    })).toBeNull();
  });

  it('UT-S09-264: reopen 在 rename 前保持 sealed，rename 后保持完整 collecting', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    for (const [fault, expectedPhase] of [
      ['before-rename', 'sealed'], ['after-rename', 'collecting'], ['during-cleanup', 'collecting'],
    ] as const) {
      const f = preflightFixture([invalid]);
      forceLegacySealed(f);
      process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT = fault;
      expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow(`test fault ${fault === 'during-cleanup' ? 'during reopen cleanup' : fault.replace('-', ' reopen ')}`);
      const stored = JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'));
      expect(stored.phase).toBe(expectedPhase);
      if (expectedPhase === 'collecting') {
        expect(stored.seal_sha256).toBeNull();
        expect(stored.targets.every((target: Record<string, unknown>) => target.sealed_sha256 === null)).toBe(true);
      }
      delete process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT;
    }
  });

  it('UT-S09-265: journal/receipt/marker/正式漂移与 applying 均禁止倒退 collecting', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    for (const artifact of ['BASELINE_CLOSURE_APPLY_JOURNAL.json', 'MERGE_RECEIPT.json', 'SPEC_MERGED']) {
      const f = preflightFixture([invalid]);
      forceLegacySealed(f);
      writeFileSync(join(f.proposalDir, artifact), '{}\n');
      expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow();
      expect(JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8')).phase).toBe('sealed');
    }
    const drift = preflightFixture([invalid]);
    forceLegacySealed(drift);
    writeFileSync(join(drift.root, drift.targets[0].targetPath), '# 正式新字节\n');
    expect(() => applyMergeTransaction(drift.root, drift.proposalDir)).toThrow(/正式目标已漂移/);
    expect(readMergeTransaction(drift.proposalDir).phase).toBe('sealed');

    const applying = preflightFixture([invalid]);
    const stored = forceLegacySealed(applying);
    stored.phase = 'applying';
    writeFileSync(join(applying.proposalDir, 'MERGE_TRANSACTION.json'), `${JSON.stringify(stored, null, 2)}\n`);
    expect(readMergeTransaction(applying.proposalDir)).toMatchObject({ phase: 'applying', allowed_actions: ['recover'] });
    expect(applyMergeTransaction(applying.root, applying.proposalDir).phase).toBe('sealed');
  });

  it('ST-S09-102: legacy CLI apply→reopen→submit→reseal→apply 保持同一事务', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const valid = invalid.replace('| UT-S01-01 |\n', '| UT-S01-01 | 修复 |\n');
    const f = preflightFixture([invalid]);
    forceLegacySealed(f);
    const failed = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'apply', '--slug', f.slug, '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(JSON.parse(failed.stderr).error.details).toMatchObject({ phase: 'collecting', retryable: true });
    const reopened = readMergeTransaction(f.proposalDir);
    const slot = reopened.content_slots.items[0];
    atomicStage(f.root, slot.staging_path, valid);
    checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'submit-content', '--slug', f.slug, '--slot', slot.slot_id, '--file', slot.staging_path, '--format', 'json'], f.root);
    checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'seal', '--slug', f.slug, '--format', 'json'], f.root);
    const completed = JSON.parse(checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'apply', '--slug', f.slug, '--format', 'json'], f.root)).data.merge_transaction;
    expect(completed).toMatchObject({ transaction_id: f.tx.transaction_id, phase: 'completed' });
    expect(completed.receipt.receipt_sha256).toBe(computeMergeReceiptSha256(completed.receipt));
  });

  it('ST-S09-103: response-lost 后可由 status 重放并重复修复同一 rejected slot', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const valid = invalid.replace('| UT-S01-01 |\n', '| UT-S01-01 | 最终修复 |\n');
    const f = preflightFixture([invalid]);
    forceLegacySealed(f);
    expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow();
    for (const attempt of [invalid, valid]) {
      const projected = readMergeTransaction(f.proposalDir);
      const slot = projected.content_slots.items[0];
      const staging = atomicStage(f.root, slot.staging_path, attempt);
      submitMergeContent(f.proposalDir, slot.slot_id, staging);
      if (attempt === invalid) expect(() => sealMergeTransaction(f.root, f.proposalDir)).toThrow();
      else expect(sealMergeTransaction(f.root, f.proposalDir).phase).toBe('sealed');
    }
    expect(applyMergeTransaction(f.root, f.proposalDir)).toMatchObject({ transaction_id: f.tx.transaction_id, phase: 'completed' });
  });

  it('UT-S11-74: 残留私有字节不参与 reopened status 投影', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const f = preflightFixture([invalid]);
    forceLegacySealed(f);
    process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT = 'after-rename';
    expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow();
    const slot = readMergeTransaction(f.proposalDir).content_slots.items[0];
    const privatePath = join(f.proposalDir, 'merge-content', f.tx.transaction_id, `${slot.slot_id}.content`);
    expect(existsSync(privatePath)).toBe(true);
    expect(readMergeTransaction(f.proposalDir)).toMatchObject({ phase: 'collecting', content_slots: { submitted: 0, missing_slot_ids: [slot.slot_id] } });
  });

  it('ST-S11-43: rename 崩溃窗口跨进程只观察完整 sealed 或完整 collecting', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    for (const [fault, phase] of [['before-rename', 'sealed'], ['after-rename', 'collecting']] as const) {
      const f = preflightFixture([invalid]);
      forceLegacySealed(f);
      process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT = fault;
      expect(() => applyMergeTransaction(f.root, f.proposalDir)).toThrow();
      delete process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT;
      const status = JSON.parse(checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'status', '--slug', f.slug, '--format', 'json'], f.root)).data.merge_transaction;
      expect(status.phase).toBe(phase);
    }
  });

  it('UT-S16-34: new/legacy/reopened/completed 公共 projection 不泄漏 preflight 字段', async () => {
    const valid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 合法 |\n';
    const invalid = valid.replace('| 合法 |', '|');
    const fresh = preflightFixture([valid]);
    const sealed = sealMergeTransaction(fresh.root, fresh.proposalDir);
    const completed = applyMergeTransaction(fresh.root, fresh.proposalDir);
    const legacy = preflightFixture([invalid]);
    forceLegacySealed(legacy);
    expect(() => applyMergeTransaction(legacy.root, legacy.proposalDir)).toThrow();
    const reopened = readMergeTransaction(legacy.proposalDir);
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
    const validate = ajv.compile(JSON.parse(readFileSync(join(repoRoot, 'spec/schema/merge-transaction.schema.json'), 'utf8')));
    for (const projection of [sealed, reopened, completed]) {
      expect(validate(projection), JSON.stringify(validate.errors)).toBe(true);
      expect(JSON.stringify(projection)).not.toMatch(/preflight_sha256|target_paths|"producer"/);
    }
  });

  it('ST-S16-10: CLI 错误落盘后可跨进程修复并读回 completed', () => {
    const invalid = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 |\n';
    const valid = invalid.replace('| UT-S01-01 |\n', '| UT-S01-01 | 修复 |\n');
    const f = preflightFixture([invalid]);
    forceLegacySealed(f);
    const apply = spawnSync(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'apply', '--format', 'json'], { cwd: f.root, encoding: 'utf8' });
    expect(JSON.parse(apply.stderr).error.details).toMatchObject({ phase: 'collecting', retryable: true });
    const status = JSON.parse(checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'status', '--format', 'json'], f.root)).data.merge_transaction;
    const slot = status.content_slots.items[0];
    atomicStage(f.root, slot.staging_path, valid);
    checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'submit-content', '--slot', slot.slot_id, '--file', slot.staging_path, '--format', 'json'], f.root);
    checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'seal', '--format', 'json'], f.root);
    checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'apply', '--format', 'json'], f.root);
    expect(JSON.parse(checked(process.execPath, [join(repoRoot, 'cli/dist/index.js'), 'merge', 'transaction', 'status', '--format', 'json'], f.root)).data.merge_transaction.phase).toBe('completed');
  });

  it('UT-S39-58: target→slot 归因不解析错误 message 且 mixed 组整体 fail-closed', () => {
    const a = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | message: spec/fake.md |\n';
    const b = '# 测试 02\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | B |\n';
    const agent = preflightFixture([a, b]);
    forceLegacySealed(agent);
    expect(() => applyMergeTransaction(agent.root, agent.proposalDir)).toThrow();
    expect(readMergeTransaction(agent.proposalDir).content_slots.missing_slot_ids).toHaveLength(2);
    const targets = [
      { slot_id: 'slot-a', target_path: 'logos/resources/test/a.md', producer: 'agent' as const },
      { slot_id: 'slot-b', target_path: 'spec/b.md', producer: 'openlogos' as const },
    ];
    expect(attributeMergePreflightError(targets, {
      code: 'duplicate', target_paths: ['logos/resources/test/a.md', 'spec/b.md'], producer: 'mixed', retryable: true,
    })).toBeNull();
    expect(attributeMergePreflightError(targets, {
      code: 'duplicate', target_paths: ['logos/resources/test/a.md'], producer: 'agent', retryable: true,
    })).toEqual(['slot-a']);
  });

  it('ST-S39-27: sealed view 同时守恒 test-change-set、metadata 与最终路径并完成 apply', () => {
    const f = fixture();
    const proposalPath = join(f.proposalDir, 'proposal.md');
    const testTarget = 'logos/resources/test/core-S39-test-cases.md';
    const testDelta = 'deltas/test/core-S39-test-cases.md';
    put(f.root, testTarget, '# S39\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S39-01 | 旧 |\n');
    put(f.root, `logos/changes/${f.slug}/${testDelta}`, '## MODIFIED — 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S39-01 | 新 |\n');
    const proposal = readFileSync(proposalPath, 'utf8').replace('\n```\n', `\n    - category: test\n      scenario_ids: [S09]\n      mode: MODIFY\n      delta_path: ${testDelta}\n      reason: 完整 preflight fixture\n      evidence: [target_exists]\n      missing_evidence: []\n\`\`\`\n`);
    writeFileSync(proposalPath, proposal);
    let tx = createMergeTransaction(f.root, f.proposalDir, f.slug);
    for (const target of listMergeTransactionPlanTargets(f.proposalDir).filter(item => item.producer === 'agent')) {
      const content = target.target_path === testTarget
        ? '# S39\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S39-01 | 新 |\n'
        : target.mode === 'CREATE' ? '# D07 事务权威\n' : '# 需求基线\n\n## 事务需求\n\n正文\n';
      const slot = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
      tx = submitMergeContent(f.proposalDir, target.slot_id, atomicStage(f.root, slot.staging_path, content));
    }
    sealMergeTransaction(f.root, f.proposalDir);
    const stored = JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'));
    expect(stored.preflight.test_change_set_sha256).toMatch(/^sha256:/);
    expect(stored.preflight.final_target_paths).toContain('logos/logos-project.yaml');
    expect(stored.preflight.final_target_paths).toContain(testTarget);
    const completed = applyMergeTransaction(f.root, f.proposalDir);
    expect(completed.receipt?.test_change_set).toMatchObject({ changed_test_ids: ['UT-S39-01'] });
    expect(completed.receipt?.final_hashes.map(item => item.path)).toEqual(stored.preflight.final_target_paths);
  });
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
    const validA = '# 测试 01\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | A |\n';
    const validB = '# 测试 02\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S02-01 | B |\n';
    const mixedCase = preflightFixture([validA, validB], ['core-S44-test-cases.md', 'S10-test-cases.md']);
    sealMergeTransaction(mixedCase.root, mixedCase.proposalDir);
    const mixedCompleted = applyMergeTransaction(mixedCase.root, mixedCase.proposalDir);
    expect(mixedCompleted.receipt?.final_hashes.map(item => item.path)).toEqual(
      mixedCompleted.receipt?.final_hashes.map(item => item.path).sort(),
    );
    expect(validateMergeTransactionSemantics(mixedCompleted).ok).toBe(true);
    const mixedReceiptPath = join(mixedCase.proposalDir, 'MERGE_RECEIPT.json');
    const mixedMarkerPath = join(mixedCase.proposalDir, 'SPEC_MERGED');
    const legacyEnvelope = JSON.parse(readFileSync(mixedReceiptPath, 'utf8'));
    const legacyFinalHashes = [...legacyEnvelope.final_hashes]
      .sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path));
    legacyEnvelope.final_hashes = legacyFinalHashes;
    legacyEnvelope.metadata_summaries = [...legacyEnvelope.metadata_summaries]
      .sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path));
    legacyEnvelope.closure_sha256 = sha256(Buffer.from(canonicalForTest(legacyFinalHashes)));
    const { schema: legacySchema, ...legacyReceiptPayload } = legacyEnvelope;
    legacyEnvelope.receipt_sha256 = computeMergeReceiptSha256(legacyReceiptPayload);
    const legacyMarker = JSON.parse(readFileSync(mixedMarkerPath, 'utf8'));
    legacyMarker.receipt_sha256 = legacyEnvelope.receipt_sha256;
    writeFileSync(mixedReceiptPath, `${JSON.stringify({ schema: legacySchema, ...legacyEnvelope }, null, 2)}\n`);
    writeFileSync(mixedMarkerPath, `${JSON.stringify(legacyMarker, null, 2)}\n`);
    const applyingPath = join(mixedCase.proposalDir, 'MERGE_TRANSACTION.json');
    const applyingStored = JSON.parse(readFileSync(applyingPath, 'utf8'));
    applyingStored.phase = 'applying';
    applyingStored.receipt = null;
    applyingStored.artifact_hashes = [];
    writeFileSync(applyingPath, `${JSON.stringify(applyingStored, null, 2)}\n`);
    const recovered = recoverMergeTransaction(mixedCase.root, mixedCase.proposalDir);
    expect(recovered.phase).toBe('completed');
    expect(recovered.receipt?.final_hashes.map(item => item.path)).toEqual(
      recovered.receipt?.final_hashes.map(item => item.path).sort(),
    );
    expect(validateMergeTransactionSemantics(recovered).ok).toBe(true);

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
      // 0.14.17 终态出路：completed 携带 reopen 出边，消费者映射新增 reopen→reopen（功能规格 §2.58.6）
      submit_content: 'submit-content', seal: 'seal', apply: 'apply', recover: 'recover', abort: 'abort', reopen: 'reopen',
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
        // 0.14.17 终态出路（§2.58.2）：aborted 属 fatal 分类，携带幂等 abort 出边（重建走归档让位）
        phase: 'failed', classification: 'aborted', allowed_actions: ['abort'], next_action: 'abort',
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
    // 0.14.17 终态出路（§2.58.2）：fatal failed 不再是死局——携带 abort 出边并可幂等转 aborted
    expect(readMergeTransaction(fatal.proposalDir)).toMatchObject({ allowed_actions: ['abort'], next_action: 'abort', aborted_at: null });
    expect(abortMergeTransaction(fatal.proposalDir).classification).toBe('aborted');
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
    // 0.14.17 终态出路（§2.58.3）：completed 携带唯一 reopen 出边
    expect(completed.allowed_actions).toEqual(['reopen']);
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

  it('UT-S19-24: 当前 candidate facts 同时冻结 schema/contract/skill/golden hashes', () => {
    const hash = (char: string) => `sha256:${char.repeat(64)}`;
    const facts = freezeMergeTransactionCandidateFacts({
      schema: MERGE_TRANSACTION_CANDIDATE_SCHEMA,
      command_path: '/opt/openlogos/dist/index.js',
      cli_version: MERGE_TRANSACTION_CANDIDATE_VERSION,
      candidate_tarball_sha256: hash('1'),
      merge_transaction_schema_sha256: hash('2'),
      status_schema_sha256: hash('3'),
      next_schema_sha256: hash('4'),
      contract_sha256: hash('5'),
      merge_executor_skill_sha256: hash('6'),
      merge_transaction_golden_sha256: hash('7'),
      semantic_validator: 'openlogos/merge-transaction-semantic@1',
    });
    expect(facts.cli_version).toBe('0.14.21');
    for (const field of [
      'candidate_tarball_sha256', 'merge_transaction_schema_sha256', 'status_schema_sha256',
      'next_schema_sha256', 'contract_sha256', 'merge_executor_skill_sha256',
      'merge_transaction_golden_sha256',
    ] as const) {
      expect(() => assertMergeTransactionCandidateMatch(facts, { ...facts, [field]: hash('a') })).toThrow(`candidate_fact_mismatch:${field}`);
    }
    expect(() => freezeMergeTransactionCandidateFacts({ ...facts, private_transaction_path: '/tmp/private' } as never)).toThrow('candidate_fact_invalid:fields');
  });

  it('UT-S19-25: previous→0.14.4 任一安装/自检/合同/行为失败均完整选择 rollback', () => {
    const base = freezeMergeTransactionCandidateFacts({
      schema: MERGE_TRANSACTION_CANDIDATE_SCHEMA,
      command_path: '/opt/openlogos/dist/index.js',
      cli_version: MERGE_TRANSACTION_CANDIDATE_VERSION,
      candidate_tarball_sha256: `sha256:${'1'.repeat(64)}`,
      merge_transaction_schema_sha256: `sha256:${'2'.repeat(64)}`,
      status_schema_sha256: `sha256:${'3'.repeat(64)}`,
      next_schema_sha256: `sha256:${'4'.repeat(64)}`,
      contract_sha256: `sha256:${'5'.repeat(64)}`,
      merge_executor_skill_sha256: `sha256:${'6'.repeat(64)}`,
      merge_transaction_golden_sha256: `sha256:${'7'.repeat(64)}`,
      semantic_validator: 'openlogos/merge-transaction-semantic@1',
    });
    const candidate = freezeMergeTransactionCandidateFacts({
      ...base,
      candidate_tarball_sha256: `sha256:${'8'.repeat(64)}`,
      merge_executor_skill_sha256: `sha256:${'9'.repeat(64)}`,
    });
    for (const failed of ['install_ok', 'self_check_ok', 'contract_match', 'behavior_ok'] as const) {
      const checks = { install_ok: true, self_check_ok: true, contract_match: true, behavior_ok: true, [failed]: false };
      expect(decideMergeTransactionCandidate(base, candidate, checks)).toEqual({ action: 'restore-previous', selected: base });
    }
    expect(decideMergeTransactionCandidate(base, candidate, {
      install_ok: true, self_check_ok: true, contract_match: true, behavior_ok: true,
    })).toEqual({ action: 'keep-candidate', selected: candidate });
    expect(buildMergeTransactionRollbackCommands('/tmp/openlogos-prefix', '/tmp/openlogos-0.14.1.tgz')).toEqual([
      { command: 'npm', args: ['uninstall', '--prefix', '/tmp/openlogos-prefix', '--ignore-scripts', '@miniidealab/openlogos'] },
      { command: 'npm', args: ['install', '--prefix', '/tmp/openlogos-prefix', '--force', '--ignore-scripts', '--no-audit', '--no-fund', '/tmp/openlogos-0.14.1.tgz'] },
    ]);
  });

  it('ST-S19-16: 真实 0.14.4 pack/install、preflight/reopen 与 0.14.1 rollback/restore', () => {
    const root = mkdtempSync(join(tmpdir(), 'openlogos-0142-candidate-'));
    roots.push(root);
    const oldSource = join(root, 'old-source');
    mkdirSync(join(oldSource, 'dist'), { recursive: true });
    writeFileSync(join(oldSource, 'package.json'), `${JSON.stringify({
      name: '@miniidealab/openlogos', version: '0.14.1', type: 'module',
      bin: { openlogos: 'dist/index.js' }, files: ['dist'],
    }, null, 2)}\n`);
    writeFileSync(join(oldSource, 'dist/index.js'), '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("0.14.1");\n');
    const parsePack = (stdout: string): { filename: string } => {
      const start = stdout.indexOf('[');
      if (start < 0) throw new Error(`npm pack 输出缺 JSON：${stdout}`);
      return JSON.parse(stdout.slice(start))[0];
    };
    const oldMeta = parsePack(checked(npmCommand, ['pack', oldSource, '--pack-destination', root, '--json', '--ignore-scripts'], repoRoot));
    const oldTarball = join(root, oldMeta.filename);

    const isolatedSource = join(root, 'candidate-source');
    const isolatedCli = join(isolatedSource, 'cli');
    const generatedPackageDirs = new Set([
      'node_modules', 'skills', 'spec', 'opencode-plugin-template', 'codex-plugin-template',
      'claude-plugin-template', 'zcode-plugin-template', 'qoder-plugin-template', 'workbuddy-plugin-template', 'cursor-plugin-template',
    ]);
    cpSync(join(repoRoot, 'cli'), isolatedCli, {
      recursive: true,
      filter: source => source === join(repoRoot, 'cli') || !generatedPackageDirs.has(source.slice(join(repoRoot, 'cli').length + 1).split('/')[0]),
    });
    for (const dir of ['skills', 'spec', 'plugin-opencode', 'plugin-codex', 'plugin', 'plugin-zcode', 'plugin-qoder', 'plugin-workbuddy', 'plugin-cursor']) {
      cpSync(join(repoRoot, dir), join(isolatedSource, dir), { recursive: true });
    }
    symlinkSync(join(repoRoot, 'cli/node_modules'), join(isolatedCli, 'node_modules'));
    const candidateMeta = parsePack(checked(npmCommand, ['pack', isolatedCli, '--pack-destination', root, '--json'], repoRoot));
    const candidateTarball = join(root, candidateMeta.filename);
    const prefix = join(root, 'prefix');
    const install = (tarball: string) => checked(npmCommand, ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarball], repoRoot);
    const uninstall = () => checked(npmCommand, ['uninstall', '--prefix', prefix, '--ignore-scripts', '@miniidealab/openlogos'], repoRoot);
    install(oldTarball);
    const entry = join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js');
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe('0.14.1');
    uninstall(); install(candidateTarball);
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe(MERGE_TRANSACTION_CANDIDATE_VERSION);
    for (const id of ['SMOKE-core-160', 'SMOKE-core-161']) {
      const evidence = JSON.parse(checked(process.execPath, [join(repoRoot, 'scripts/merge-preflight-reopen-smoke-fixtures.js'), '--case', id, '--openlogos', entry], repoRoot));
      expect(evidence).toMatchObject({ id, status: 'pass' });
    }
    uninstall(); install(oldTarball);
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe('0.14.1');
    uninstall(); install(candidateTarball);
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe(MERGE_TRANSACTION_CANDIDATE_VERSION);
    const selfTest = JSON.parse(checked(process.execPath, [join(repoRoot, 'scripts/smoke-release-0-14-2-preflight-reopen.js'), '--self-test'], repoRoot));
    expect(selfTest).toMatchObject({
      ids: ['SMOKE-core-160', 'SMOKE-core-161', 'SMOKE-core-162'],
      candidate_version: '0.14.2', rollback_version: '0.14.1', public_release_commands: [],
      runlogos_archive_env: 'OPENLOGOS_RUNLOGOS_ARCHIVED_CHANGE_DIR',
    });
    const releaseSmokeSource = readFileSync(join(repoRoot, 'scripts/smoke-release-0-14-2-preflight-reopen.js'), 'utf8');
    expect(releaseSmokeSource).toContain("realpathSync(join(root, 'logos/changes/archive'))");
    expect(releaseSmokeSource).toContain("semanticModule.assertMergeTransactionSemantics(transaction)");
    expect(releaseSmokeSource).toContain('semanticModule.computeMergeReceiptSha256(canonicalReceipt)');
    expect(readFileSync(join(repoRoot, 'scripts/run-smoke.js'), 'utf8')).toContain('smoke-release-0-14-2-preflight-reopen.js');
  }, 120_000);

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
      merge_executor_skill_sha256: hashA,
      merge_transaction_golden_sha256: hashA,
      semantic_validator: 'openlogos/merge-transaction-semantic@1',
    });
    for (const field of [
      'candidate_tarball_sha256', 'merge_transaction_schema_sha256', 'status_schema_sha256',
      'next_schema_sha256', 'contract_sha256',
      'merge_executor_skill_sha256', 'merge_transaction_golden_sha256',
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
      merge_executor_skill_sha256: `sha256:${'8'.repeat(64)}`,
      merge_transaction_golden_sha256: `sha256:${'9'.repeat(64)}`,
      semantic_validator: 'openlogos/merge-transaction-semantic@1',
    });
    const candidate = { ...previous, candidate_tarball_sha256: `sha256:${'6'.repeat(64)}`, contract_sha256: `sha256:${'7'.repeat(64)}` };
    for (const failed of ['install_ok', 'self_check_ok', 'contract_match', 'behavior_ok'] as const) {
      const check = { install_ok: true, self_check_ok: true, contract_match: true, behavior_ok: true, [failed]: false };
      expect(decideMergeTransactionCandidate(previous, candidate, check)).toEqual({ action: 'restore-previous', selected: previous });
    }
    expect(decideMergeTransactionCandidate(previous, candidate, { install_ok: true, self_check_ok: true, contract_match: true, behavior_ok: true }))
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
      'claude-plugin-template', 'zcode-plugin-template', 'qoder-plugin-template', 'workbuddy-plugin-template', 'cursor-plugin-template',
    ]);
    cpSync(join(repoRoot, 'cli'), isolatedCli, {
      recursive: true,
      filter: source => source === join(repoRoot, 'cli') || !generatedPackageDirs.has(source.slice(join(repoRoot, 'cli').length + 1).split('/')[0]),
    });
    for (const dir of ['skills', 'spec', 'plugin-opencode', 'plugin-codex', 'plugin', 'plugin-zcode', 'plugin-qoder', 'plugin-workbuddy', 'plugin-cursor']) {
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
    expect(checked(process.execPath, [entry, '--version'], root).trim()).toBe(MERGE_TRANSACTION_CANDIDATE_VERSION);
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

    const decision = decideMergeTransactionCandidate(previous, current, { install_ok: true, self_check_ok: true, contract_match: false, behavior_ok: true });
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
    expect(pkg.version).toBe(MERGE_TRANSACTION_CANDIDATE_VERSION);
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
