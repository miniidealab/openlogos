#!/usr/bin/env node
/** 安装态 merge transaction fixture harness；仅写系统临时目录。 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const value = name => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const id = value('--case');
const cli = value('--openlogos');
if (!/^(?:SMOKE-core-14[3-9]|SMOKE-core-15[1-4])$/.test(id ?? '') || !cli) throw new Error('需要 --case SMOKE-core-143..149/151..154 --openlogos <absolute>');
const candidate = realpathSync(resolve(cli));
const packageRoot = realpathSync(join(dirname(candidate), '..'));
const assetRoot = existsSync(join(packageRoot, 'spec')) ? packageRoot : realpathSync(join(packageRoot, '..'));
const modulePath = join(packageRoot, 'dist/lib/merge-transaction.js');
const txModule = await import(`${pathToFileURL(modulePath).href}?smoke=${Date.now()}`);

function put(root, path, content) {
  const target = join(root, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}
function run(root, args, env = {}) {
  const command = candidate.endsWith('.js') ? process.execPath : candidate;
  const commandArgs = candidate.endsWith('.js') ? [candidate, ...args] : args;
  return spawnSync(command, commandArgs, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 120_000 });
}
function json(root, args, env = {}) {
  const result = run(root, [...args, '--format', 'json'], env);
  if (result.status !== 0) throw new Error(`${args.join(' ')}：${result.stderr}`);
  return JSON.parse(result.stdout).data.merge_transaction;
}
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
function targetYaml(target) {
  return [
    `    - category: ${target.category}`,
    '      scenario_ids: [S09]',
    `      mode: ${target.mode}`,
    `      delta_path: ${target.delta}`,
    `      reason: smoke ${target.mode} transaction target`,
    `      evidence: [${target.mode === 'CREATE' ? 'target_absent' : 'target_exists'}]`,
    '      missing_evidence: []',
  ].join('\n');
}
function fixture(targets) {
  const root = mkdtempSync(join(tmpdir(), `openlogos-${id}-`));
  const slug = `smoke-${id.toLowerCase().replaceAll('-', '')}`;
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","sourceRoots":{"src":["src"],"test":["test"]}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: smoke\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\ndecision_counter:\n  next_id: 7\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  put(root, 'spec/schema/merge-transaction.schema.json', readFileSync(join(assetRoot, 'spec/schema/merge-transaction.schema.json')));
  put(root, 'spec/cli-json-output.md', readFileSync(join(assetRoot, 'spec/cli-json-output.md')));
  for (const target of targets) {
    const title = target.title ?? target.path.split('/').pop();
    put(root, `logos/changes/${slug}/${target.delta}`, target.path.endsWith('.html')
      ? '<!doctype html><html><body>smoke ui</body></html>\n'
      : `## ADDED — ${title}\n\nsmoke body\n`);
    if (target.mode === 'MODIFY') put(root, target.path, '# baseline\n');
  }
  const closure = targets.length === 0 ? '' : `\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S09]\n  targets:\n${targets.map(targetYaml).join('\n')}\n\`\`\`\n`;
  put(root, `logos/changes/${slug}/proposal.md`, `# smoke\n${closure}`);
  put(root, `logos/changes/${slug}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${targets.map(target => `- [x] [${target.mode}] \`${target.delta}\``).join('\n')}\n\n## [code] 代码实现\n`);
  return { root, slug, proposalDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function createTargets(kind) {
  if (kind === 'create') return [{ category: 'decision', mode: 'CREATE', delta: 'deltas/decisions/core-D07-smoke.md', path: 'logos/resources/decisions/core-D07-smoke.md', title: 'D07 smoke' }];
  if (kind === 'modify') return [{ category: 'requirement', mode: 'MODIFY', delta: 'deltas/prd/1-product-requirements/core-01.md', path: 'logos/resources/prd/1-product-requirements/core-01.md', title: 'smoke requirement' }];
  if (kind === 'ui') return [{ category: 'feature', mode: 'CREATE', delta: 'deltas/prd/2-product-design/2-page-design/core-smoke.html', path: 'logos/resources/prd/2-product-design/2-page-design/core-smoke.html', title: 'smoke ui' }];
  return Array.from({ length: 20 }, (_, index) => ({
    category: 'requirement', mode: 'CREATE',
    delta: `deltas/prd/1-product-requirements/core-${String(index + 10).padStart(2, '0')}.md`,
    path: `logos/resources/prd/1-product-requirements/core-${String(index + 10).padStart(2, '0')}.md`,
    title: 'smoke requirement',
  }));
}
function submit(root, proposalDir, tx, targets, invalidFirst = false, stagingNegatives = false) {
  const title = targets.some(target => target.path.includes('D07')) ? 'D07 smoke' : 'smoke requirement';
  for (const descriptor of tx.content_slots.items) {
    const contentPath = join(root, ...descriptor.staging_path.split('/'));
    mkdirSync(dirname(contentPath), { recursive: true });
    const atomicWrite = content => {
      const temp = join(dirname(contentPath), `.content.${process.pid}.tmp`);
      writeFileSync(temp, content);
      renameSync(temp, contentPath);
    };
    if (stagingNegatives) {
      const wrong = join(root, `${descriptor.slot_id}.wrong`);
      writeFileSync(wrong, `# ${title}\n`);
      const rejected = run(root, ['merge', 'transaction', 'submit-content', '--slug', tx.slug, '--slot', descriptor.slot_id, '--file', wrong, '--format', 'json']);
      if (rejected.status === 0) throw new Error('非声明 staging path 未被拒绝');
      const outside = join(root, `${descriptor.slot_id}.outside`);
      writeFileSync(outside, `# ${title}\n`);
      symlinkSync(outside, contentPath);
      const symlinkRejected = run(root, ['merge', 'transaction', 'submit-content', '--slug', tx.slug, '--slot', descriptor.slot_id, '--file', contentPath, '--format', 'json']);
      if (symlinkRejected.status === 0) throw new Error('staging symlink 未被拒绝');
      rmSync(contentPath, { force: true });
    }
    if (invalidFirst) {
      atomicWrite(`## ADDED — ${title}\n`);
      const rejected = run(root, ['merge', 'transaction', 'submit-content', '--slug', tx.slug, '--slot', descriptor.slot_id, '--file', contentPath, '--format', 'json']);
      if (rejected.status === 0) throw new Error('validator retry 首次非法内容未被拒绝');
    }
    atomicWrite(`# ${title}\n`);
    json(root, ['merge', 'transaction', 'submit-content', '--slug', tx.slug, '--slot', descriptor.slot_id, '--file', contentPath]);
  }
}
async function execute(targets, options = {}) {
  const f = fixture(targets);
  try {
    let observed = null;
    let tx = txModule.createMergeTransaction(f.root, f.proposalDir, f.slug);
    submit(f.root, f.proposalDir, tx, targets, options.invalidFirst, options.stagingNegatives);
    if (options.observe) {
      const statusEnvelope = JSON.parse(run(f.root, ['status', '--format', 'json']).stdout).data;
      const status = statusEnvelope.merge_transaction;
      const statusTree = readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
      const nextEnvelope = JSON.parse(run(f.root, ['next', '--format', 'json']).stdout).data;
      const next = nextEnvelope.merge_transaction;
      if (JSON.stringify(status) !== JSON.stringify(next) || !statusTree.equals(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json')))) throw new Error('status/next 只读投影不一致');
      observed = { status_data: statusEnvelope, next_data: nextEnvelope };
    }
    tx = json(f.root, ['merge', 'transaction', 'seal', '--slug', f.slug]);
    if (options.failOnce) {
      const failureTarget = targets[0]?.path;
      const failed = run(f.root, ['merge', 'transaction', 'apply', '--slug', f.slug, '--format', 'json'], { NODE_ENV: 'test', OPENLOGOS_TEST_MERGE_TX_FAIL_AFTER: failureTarget });
      if (failed.status === 0 || json(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]).phase !== 'sealed') throw new Error('故障注入没有回滚到可重试 sealed');
      json(f.root, ['merge', 'transaction', 'recover', '--slug', f.slug]);
    }
    const completed = json(f.root, ['merge', 'transaction', 'apply', '--slug', f.slug]);
    const repeated = json(f.root, ['merge', 'transaction', 'apply', '--slug', f.slug]);
    if (completed.phase !== 'completed' || JSON.stringify(completed.receipt) !== JSON.stringify(repeated.receipt)) throw new Error('completed receipt 不幂等');
    if (options.validateClosure) {
      const finalPaths = completed.receipt.final_hashes.map(item => item.path);
      const artifactPaths = completed.artifact_hashes.map(item => item.path);
      const union = [...new Set([...finalPaths, ...artifactPaths])].sort();
      if (finalPaths.some(path => artifactPaths.includes(path)) || JSON.stringify(union) !== JSON.stringify(completed.receipt.commit_paths)) {
        throw new Error('completed receipt 闭包不守恒');
      }
      for (const item of [...completed.receipt.final_hashes, ...completed.artifact_hashes]) {
        if (sha256(readFileSync(join(f.root, ...item.path.split('/')))) !== item.sha256) throw new Error(`公开 hash 不可重算：${item.path}`);
      }
    }
    return { transaction_id: completed.transaction_id, receipt_sha256: completed.receipt.receipt_sha256, target_count: completed.receipt.target_count, commit_paths: completed.receipt.commit_paths, ...(observed ?? {}) };
  } finally { f.cleanup(); }
}

async function executeAbortContract() {
  const phases = ['collecting', 'ready', 'sealed'];
  const evidence = [];
  for (const phase of phases) {
    const f = fixture(createTargets('create'));
    try {
      let tx = txModule.createMergeTransaction(f.root, f.proposalDir, f.slug);
      if (phase !== 'collecting') {
        submit(f.root, f.proposalDir, tx, createTargets('create'));
        tx = json(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]);
      }
      if (phase === 'sealed') tx = json(f.root, ['merge', 'transaction', 'seal', '--slug', f.slug]);
      if (tx.phase !== phase) throw new Error(`abort fixture phase 漂移：${tx.phase} != ${phase}`);
      const first = json(f.root, ['merge', 'transaction', 'abort', '--slug', f.slug]);
      const terminalBytes = readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
      const second = json(f.root, ['merge', 'transaction', 'abort', '--slug', f.slug]);
      // 0.14.17 终态出路（§2.58.2）：aborted 携带幂等 abort 出边（重建走 merge 的归档让位）
      if (first.phase !== 'failed' || first.classification !== 'aborted'
        || JSON.stringify(first.allowed_actions) !== '["abort"]'
        || first.next_action !== 'abort' || first.receipt !== null || first.aborted_at !== second.aborted_at
        || !terminalBytes.equals(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json')))
        || existsSync(join(f.proposalDir, 'MERGE_RECEIPT.json')) || existsSync(join(f.proposalDir, 'SPEC_MERGED'))) {
        throw new Error(`abort ${phase} 终态、清理或幂等不成立`);
      }
      evidence.push({ phase, transaction_id: first.transaction_id, aborted_at: first.aborted_at });
    } finally { f.cleanup(); }
  }
  return { phases: evidence };
}

async function executeActionParity() {
  const f = fixture(createTargets('create'));
  try {
    const tx = txModule.createMergeTransaction(f.root, f.proposalDir, f.slug);
    const help = run(f.root, ['--help']);
    if (help.status !== 0 || !help.stdout.includes('submit-content / seal / apply / recover / abort')) throw new Error('安装态 help 缺 action-command parity');
    const unknown = run(f.root, ['merge', 'transaction', 'future-action', '--slug', f.slug, '--format', 'json']);
    if (unknown.status === 0) throw new Error('未知 action 未 fail-closed');
    const aborted = json(f.root, ['merge', 'transaction', 'abort', '--slug', f.slug]);
    if (tx.next_action !== 'submit_content' || aborted.classification !== 'aborted') throw new Error('已知 action 与命令执行不一致');
    return { known_actions: ['submit_content', 'seal', 'apply', 'recover', 'abort'], unknown_rejected: true };
  } finally { f.cleanup(); }
}

let evidence;
if (id === 'SMOKE-core-143') evidence = await execute(createTargets('create'));
else if (id === 'SMOKE-core-144') evidence = await execute(createTargets('modify'));
else if (id === 'SMOKE-core-145') evidence = await execute(createTargets('mixed'));
else if (id === 'SMOKE-core-146') evidence = await execute(createTargets('create'), { invalidFirst: true });
else if (id === 'SMOKE-core-147') {
  const noDelta = await execute([]);
  const ui = await execute(createTargets('ui'));
  evidence = { no_delta: noDelta, ui };
} else if (id === 'SMOKE-core-148') evidence = await execute(createTargets('modify'), { observe: true });
else if (id === 'SMOKE-core-149') evidence = await execute(createTargets('modify'), { failOnce: true });
else if (id === 'SMOKE-core-151') evidence = await executeActionParity();
else if (id === 'SMOKE-core-152') evidence = await execute(createTargets('create'), { stagingNegatives: true });
else if (id === 'SMOKE-core-153') evidence = await execute(createTargets('mixed'), { validateClosure: true });
else evidence = await executeAbortContract();
console.log(JSON.stringify({ id, status: 'pass', precreated_completed: false, ...evidence }));
