import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const repoRoot = resolve(import.meta.dirname, '../..');
export const cli = join(repoRoot, 'cli/dist/index.js');
export const fixtureRoots: string[] = [];
export function cleanupFixtureRoots(): void { for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true }); }

export function put(root: string, relative: string, content: string) {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

export function invoke(args: string[], cwd: string) {
  // vitest 全局开 legacy merge 开关供旧合同回归；本 fixture 族测生产合并语义，spawn 时显式关闭。
  const env = { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' };
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env });
}

export function invokeJson(args: string[], cwd: string) {
  const result = invoke([...args, '--format', 'json'], cwd);
  return JSON.parse(result.stdout);
}

export function invokeJsonErr(args: string[], cwd: string) {
  const result = invoke([...args, '--format', 'json'], cwd);
  const lastLine = result.stderr.trim().split('\n').pop() ?? '';
  return { status: result.status, envelope: JSON.parse(lastLine) };
}

/** launched 提案 fixture：ready-to-merge 态（PLAN_APPROVED + delta 勾选全）。
 * merge 命令准入要求 requirement/feature/scenario 为强制维度，故 fixture 携带四个 MODIFIED delta。 */
export function frontierFixture(withDelta = true) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-frontier-'));
  fixtureRoots.push(root);
  const slug = 'frontier-fixture';
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: Frontier Fixture\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const parent = '一、判据';
  const targetPath = 'logos/resources/test/core-S01-test-cases.md';
  const files = [
    { category: 'requirement', target: 'logos/resources/prd/1-product-requirements/core-01-requirements.md', delta: 'deltas/prd/1-product-requirements/core-01-requirements.md' },
    { category: 'feature', target: 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', delta: 'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md' },
    { category: 'scenario', target: 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', delta: 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md' },
    { category: 'test', target: targetPath, delta: 'deltas/test/core-S01-test-cases.md' },
  ];
  const tableBefore = '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |';
  const tableAfter = tableBefore.replace('旧定义', '新定义');
  for (const file of files) {
    const isTest = file.category === 'test';
    const body = isTest ? tableBefore : '旧正文。';
    put(root, file.target, `# 文档\n\n## ${parent}\n\n${body}\n`);
    const newBody = isTest ? tableAfter : '新正文。';
    if (withDelta) put(root, `logos/changes/${slug}/${file.delta}`, `## MODIFIED — ${parent}\n\n${newBody}\n`);
  }
  const before = readFileSync(join(root, targetPath), 'utf8');
  const final = before.replace('旧定义', '新定义');
  const finals: Record<string, string> = {};
  for (const file of files) {
    finals[file.target] = readFileSync(join(root, file.target), 'utf8').replace('旧定义', '新定义').replace('旧正文。', '新正文。');
  }
  const deltaTasks = withDelta
    ? `## [delta] 规格变更\n${[...files].sort((a, b) => a.delta.localeCompare(b.delta)).map(f => `- [x] [MODIFY] \`${f.delta}\`：fixture 更新`).join('\n')}\n`
    : '## [delta] 规格变更\n';
  const clarification = `## 决策澄清\n\n\`\`\`yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: fixture}\n  compatibility: {status: none, reason: fixture}\n  security_privacy: {status: none, reason: fixture}\n  public_release: {status: none, reason: fixture}\n  external_commitment: {status: none, reason: fixture}\ndecisions: []\nunresolved: []\ndefaults: []\n\`\`\`\n`;
  const head = `# 变更提案：frontier fixture\n\n## 变更原因\n真实原因。\n\n## 变更类型\n设计级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n`;
  if (withDelta) {
    put(root, `logos/changes/${slug}/proposal.md`,
      `${head}${clarification}`);
  } else {
    // no-delta（纯代码）先例：无 delta 可合并，靠「复用测试 ID」小节满足 L3 测试证据
    put(root, `logos/changes/${slug}/proposal.md`,
      `${head}## 复用测试 ID\n\n- UT-S01-01 — 回归覆盖\n\n${clarification}`);
  }
  put(root, `logos/changes/${slug}/tasks.md`, `# 任务\n\n${deltaTasks}\n## [code] 代码实现\n`);
  put(root, `logos/changes/${slug}/PLAN_APPROVED`, '{}');
  return { root, slug, proposalDir, targetPath, final, finals };
}
