#!/usr/bin/env node
/** SMOKE-core-160/161/168 安装态 fixture；只写系统临时目录。 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const id = arg('--case');
const cliArg = arg('--openlogos');
if (!['SMOKE-core-160', 'SMOKE-core-161', 'SMOKE-core-168'].includes(id) || !cliArg) {
  throw new Error('需要 --case SMOKE-core-160|SMOKE-core-161|SMOKE-core-168 --openlogos <absolute>');
}
const cli = realpathSync(resolve(cliArg));
const packageRoot = realpathSync(join(dirname(cli), '..'));
const txModule = await import(`${pathToFileURL(join(packageRoot, 'dist/lib/merge-transaction.js')).href}?smoke=${Date.now()}`);

function put(root, path, content) {
  const target = join(root, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function run(root, args) {
  const command = cli.endsWith('.js') ? process.execPath : cli;
  const commandArgs = cli.endsWith('.js') ? [cli, ...args] : args;
  return spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', timeout: 120_000 });
}

function json(root, args) {
  const result = run(root, [...args, '--format', 'json']);
  if (result.status !== 0) throw new Error(`${args.join(' ')}：${result.stderr}`);
  return JSON.parse(result.stdout).data.merge_transaction;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function finalContent(index, valid, duplicateId = null) {
  const suffix = String(index + 1).padStart(2, '0');
  const testId = duplicateId ?? `UT-S${suffix}-01`;
  return `# 测试 ${suffix}\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| ${testId} |${valid ? ' 新定义 |' : ''}\n`;
}

function fixture(contents) {
  const root = mkdtempSync(join(tmpdir(), `openlogos-${id.toLowerCase()}-`));
  const slug = `smoke-${id.toLowerCase().replaceAll('-', '')}`;
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","sourceRoots":{"src":["src"],"test":["test"]}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: preflight smoke\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const targets = contents.map((content, index) => {
    const suffix = String(index + 1).padStart(2, '0');
    const targetPath = `logos/resources/test/core-S${suffix}-test-cases.md`;
    const deltaPath = `deltas/test/core-S${suffix}-test-cases.md`;
    put(root, targetPath, `# 测试 ${suffix}\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S${suffix}-01 | 旧定义 |\n`);
    const body = content.split('## 测试矩阵')[1].replace(/^\s*/, '');
    put(root, `logos/changes/${slug}/${deltaPath}`, `## MODIFIED — 测试矩阵\n\n${body}`);
    return { targetPath, deltaPath, content };
  });
  const yaml = targets.map(target => [
    '    - category: test', '      scenario_ids: [S09]', '      mode: MODIFY',
    `      delta_path: ${target.deltaPath}`, '      reason: 安装态 preflight fixture',
    '      evidence: [target_exists]', '      missing_evidence: []',
  ].join('\n')).join('\n');
  put(root, `logos/changes/${slug}/proposal.md`, `# smoke\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S09]\n  targets:\n${yaml}\n\`\`\`\n`);
  put(root, `logos/changes/${slug}/tasks.md`, '# 任务\n\n## [code] 代码实现\n');
  const tx = txModule.createMergeTransaction(root, proposalDir, slug);
  for (const target of txModule.listMergeTransactionPlanTargets(proposalDir)) {
    const content = targets.find(item => item.targetPath === target.target_path).content;
    const slot = tx.content_slots.items.find(item => item.slot_id === target.slot_id);
    const path = join(root, ...slot.staging_path.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    const temp = join(dirname(path), `.content.${process.pid}.tmp`);
    writeFileSync(temp, content);
    renameSync(temp, path);
    json(root, ['merge', 'transaction', 'submit-content', '--slug', slug, '--slot', slot.slot_id, '--file', slot.staging_path]);
  }
  return { root, slug, proposalDir, tx, targets, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function repair(root, slug, projection, content) {
  const slot = projection.content_slots.items.find(item => projection.content_slots.missing_slot_ids.includes(item.slot_id));
  if (!slot) throw new Error('缺少待修复 slot');
  const path = join(root, ...slot.staging_path.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.content.${process.pid}.tmp`);
  writeFileSync(temp, content);
  renameSync(temp, path);
  json(root, ['merge', 'transaction', 'submit-content', '--slug', slug, '--slot', slot.slot_id, '--file', slot.staging_path]);
}

function exerciseNewSeal() {
  const f = fixture([finalContent(0, false)]);
  try {
    const formalBefore = readFileSync(join(f.root, f.targets[0].targetPath));
    const failed = run(f.root, ['merge', 'transaction', 'seal', '--slug', f.slug, '--format', 'json']);
    if (failed.status === 0) throw new Error('歧义 after 未在 seal 前拒绝');
    const details = JSON.parse(failed.stderr).error.details;
    const reopened = json(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]);
    if (details.phase !== 'collecting' || !details.retryable || reopened.content_slots.missing_slot_ids.length !== 1) {
      throw new Error('seal reject 投影不符合 collecting/missing/retryable');
    }
    if (!formalBefore.equals(readFileSync(join(f.root, f.targets[0].targetPath)))) throw new Error('seal reject 改写正式目标');
    for (const path of ['BASELINE_CLOSURE_APPLY_JOURNAL.json', '.baseline-closure-apply-txn', 'MERGE_RECEIPT.json', 'SPEC_MERGED']) {
      if (existsSync(join(f.proposalDir, path))) throw new Error(`seal reject 产生首写产物：${path}`);
    }
    repair(f.root, f.slug, reopened, finalContent(0, true));
    const sealed = json(f.root, ['merge', 'transaction', 'seal', '--slug', f.slug]);
    const completed = json(f.root, ['merge', 'transaction', 'apply', '--slug', f.slug]);
    if (completed.phase !== 'completed') throw new Error('修复后未 completed');
    return { transaction_id: completed.transaction_id, first_seal: details, new_seal_sha256: sealed.seal_sha256, receipt_sha256: completed.receipt.receipt_sha256 };
  } finally { f.cleanup(); }
}

function forceLegacySealed(f) {
  const path = join(f.proposalDir, 'MERGE_TRANSACTION.json');
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  delete stored.preflight;
  stored.phase = 'sealed';
  stored.targets.forEach(target => { target.sealed_sha256 = target.content_sha256; });
  const hashes = stored.targets.map(target => ({ slot_id: target.slot_id, content_sha256: target.content_sha256 }));
  stored.seal_sha256 = sha256(Buffer.from(canonical({ transaction_id: stored.transaction_id, target_set_sha256: stored.target_set_sha256, hashes })));
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

function exerciseLegacy() {
  const f = fixture([finalContent(0, false), finalContent(1, true)]);
  try {
    const legacy = forceLegacySealed(f);
    const preserved = legacy.targets[1].content_sha256;
    const failed = run(f.root, ['merge', 'transaction', 'apply', '--slug', f.slug, '--format', 'json']);
    if (failed.status === 0) throw new Error('legacy invalid fixture 未 reopen');
    const reopened = json(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]);
    const stored = JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'));
    if (reopened.transaction_id !== legacy.transaction_id || reopened.content_slots.missing_slot_ids.length !== 1
      || stored.targets[1].content_sha256 !== preserved || stored.seal_sha256 !== null) {
      throw new Error('legacy reopen 身份或局部 slot 守恒失败');
    }
    repair(f.root, f.slug, reopened, finalContent(0, true));
    json(f.root, ['merge', 'transaction', 'seal', '--slug', f.slug]);
    const completed = json(f.root, ['merge', 'transaction', 'apply', '--slug', f.slug]);
    return { transaction_id: completed.transaction_id, preserved_slot_sha256: preserved, receipt_sha256: completed.receipt.receipt_sha256 };
  } finally { f.cleanup(); }
}

function exerciseNestedAnchor() {
  const parent = '七、项目文件夹动态 watcher 交互规则';
  const leaf = '7.1 已打开文件外部变化感知';
  const root = mkdtempSync(join(tmpdir(), 'openlogos-smoke-core-168-'));
  const slug = 'smoke-core-168';
  const proposalDir = join(root, 'logos', 'changes', slug);
  const targetPath = 'logos/resources/test/core-S09-test-cases.md';
  const deltaPath = 'deltas/test/core-S09-test-cases.md';
  const before = `# S09\n\n## ${parent}\n\n### ${leaf}\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S09-01 | 旧定义 |\n\n## 八、其它规则\n\n### ${leaf}\n\n同名叶保持。\n`;
  const body = '| 用例ID | 验证目标 |\n|---|---|\n| UT-S09-01 | 新定义 |\n\n### 事件与最终态交互\n\n同形规则。';
  const final = before.replace(
    '| UT-S09-01 | 旧定义 |',
    '| UT-S09-01 | 新定义 |\n\n#### 事件与最终态交互\n\n同形规则。',
  );
  try {
    put(root, 'logos/logos.config.json', '{"locale":"zh","sourceRoots":{"src":["src"],"test":["test"]}}\n');
    put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
    put(root, 'logos/logos-project.yaml', 'project:\n  name: nested smoke\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
    put(root, targetPath, before);
    put(root, `logos/changes/${slug}/${deltaPath}`, `\`\`\`md\n## MODIFIED — 伪锚\n\`\`\`\n\n## MODIFIED — ${parent} > ${leaf}\n\n${body}\n`);
    put(root, `logos/changes/${slug}/proposal.md`, `# smoke\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S09]\n  targets:\n    - category: test\n      scenario_ids: [S09]\n      mode: MODIFY\n      delta_path: ${deltaPath}\n      reason: 嵌套章节锚安装态 fixture\n      evidence: [target_exists]\n      missing_evidence: []\n\`\`\`\n`);
    put(root, `logos/changes/${slug}/tasks.md`, '# 任务\n\n## [code] 代码实现\n');
    const created = txModule.createMergeTransaction(root, proposalDir, slug);
    const plan = txModule.listMergeTransactionPlanTargets(proposalDir)[0];
    const descriptor = created.content_slots.items.find(item => item.slot_id === plan.slot_id);
    const staging = join(root, ...descriptor.staging_path.split('/'));
    mkdirSync(dirname(staging), { recursive: true });
    const temp = join(dirname(staging), `.content.${process.pid}.tmp`);
    writeFileSync(temp, final);
    renameSync(temp, staging);
    const ready = json(root, ['merge', 'transaction', 'submit-content', '--slug', slug, '--slot', descriptor.slot_id, '--file', descriptor.staging_path]);
    if (ready.phase !== 'ready') throw new Error('嵌套锚 submit 未进入 ready');
    const sealed = json(root, ['merge', 'transaction', 'seal', '--slug', slug]);
    const completed = json(root, ['merge', 'transaction', 'apply', '--slug', slug]);
    const official = readFileSync(join(root, targetPath), 'utf8');
    if (sealed.phase !== 'sealed' || completed.phase !== 'completed'
      || !official.includes(`## ${parent}\n\n### ${leaf}`)
      || official.includes(`${parent} > ${leaf}`)) throw new Error('嵌套章节锚安装态闭环不成立');
    return {
      transaction_id: completed.transaction_id,
      receipt_sha256: completed.receipt.receipt_sha256,
      final_sha256: sha256(Buffer.from(official)),
      heading_identity: { level: 3, text: leaf, path: [parent, leaf] },
    };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const evidence = id === 'SMOKE-core-160' ? exerciseNewSeal()
  : id === 'SMOKE-core-161' ? exerciseLegacy() : exerciseNestedAnchor();
console.log(JSON.stringify({ id, status: 'pass', cli_realpath: cli, ...evidence }));
