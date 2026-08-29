#!/usr/bin/env node
/** 安装态 merge transaction fixture harness；仅写系统临时目录。 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
if (!/^SMOKE-core-14[3-9]$/.test(id ?? '') || !cli) throw new Error('需要 --case SMOKE-core-143..149 --openlogos <absolute>');
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
    title: `smoke requirement ${index + 1}`,
  }));
}
function submit(root, proposalDir, tx, invalidFirst = false) {
  const targets = new Map(txModule.listMergeTransactionPlanTargets(proposalDir).map(target => [target.slot_id, target]));
  for (const slot of tx.content_slots.items) {
    const target = targets.get(slot.slot_id);
    if (!target) throw new Error(`缺少 slot plan target：${slot.slot_id}`);
    if (target.target_path.startsWith('spec/') || /\.(?:html|css|svg)$/.test(target.target_path)) continue;
    const title = target.target_path.includes('D07') ? 'D07 smoke' : target.target_path.includes('core-01.md') ? 'smoke requirement' : `smoke requirement ${Number(/core-(\d+)/.exec(target.target_path)?.[1] ?? 9) - 9}`;
    const contentPath = join(root, ...slot.staging_path.split('/'));
    mkdirSync(dirname(contentPath), { recursive: true });
    if (invalidFirst) {
      writeFileSync(contentPath, `## ADDED — ${title}\n`);
      const rejected = run(root, ['merge', 'transaction', 'submit-content', '--slug', tx.slug, '--slot', slot.slot_id, '--file', contentPath, '--format', 'json']);
      if (rejected.status === 0) throw new Error('validator retry 首次非法内容未被拒绝');
    }
    writeFileSync(contentPath, `# ${title}\n`);
    json(root, ['merge', 'transaction', 'submit-content', '--slug', tx.slug, '--slot', slot.slot_id, '--file', contentPath]);
  }
}
async function execute(targets, options = {}) {
  const f = fixture(targets);
  try {
    let tx = txModule.createMergeTransaction(f.root, f.proposalDir, f.slug);
    submit(f.root, f.proposalDir, tx, options.invalidFirst);
    if (options.observe) {
      const status = json(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]);
      const statusTree = readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
      const next = JSON.parse(run(f.root, ['next', '--format', 'json']).stdout).data.merge_transaction;
      if (JSON.stringify(status) !== JSON.stringify(next) || !statusTree.equals(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json')))) throw new Error('status/next 只读投影不一致');
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
    return { transaction_id: completed.transaction_id, receipt_sha256: completed.receipt.receipt_sha256, target_count: completed.receipt.target_count };
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
else evidence = await execute(createTargets('modify'), { failOnce: true });
console.log(JSON.stringify({ id, status: 'pass', precreated_completed: false, ...evidence }));
