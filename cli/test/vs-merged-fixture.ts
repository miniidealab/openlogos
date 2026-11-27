/**
 * verify-self-sufficient-cases 夹具 VS-prop（真实变更集）：从不含 UT-S01-90 的已合并基线出发，
 * 活跃提案的测试 delta 新增 UT-S01-90，经真实 `openlogos merge` 写出 SPEC_MERGED.test_change_set。
 * 评审 delta-r1 F4：严格判定集合只认经正式读取器校验的变更集，夹具不得把 ID 直接写进已合并规格冒充。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readTestChangeSet } from '../src/lib/test-change-set.js';

const CLI = resolve(import.meta.dirname, '../dist/index.js');
export const VS_SLUG = 'vs-demo';
export const VS_BASE_IDS = ['ST-S01-01', 'UT-S01-01', 'UT-S01-02'];
export const VS_NEW_ID = 'UT-S01-90';

const roots: string[] = [];
export function cleanupVsMerged(): void { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); }

function put(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

export function runCli(root: string, args: string[], env: Record<string, string | undefined> = {}) {
  const merged: Record<string, string | undefined> = { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0', NO_COLOR: '1', ...env };
  for (const k of Object.keys(merged)) if (k.startsWith('OPENLOGOS_VERIFY_') && !(k in env)) delete merged[k];
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete merged[k];
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env: merged as NodeJS.ProcessEnv, timeout: 120_000 });
}

const table = (ids: string[]) => ['| 用例ID | 验证目标 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具 |`)].join('\n');

export interface VsMergedOptions {
  /** 记录型 runner：按环境变量 VS_SKIP（逗号分隔 id=reason_code:detail 或 id）写 skip，其余 pass。 */
  runner?: boolean;
  /** 合并前不执行 merge（「尚未 merge」对照）。 */
  skipMerge?: boolean;
  /** 额外的 logos.config.json verify 字段。 */
  verify?: Record<string, unknown>;
  /** 模块（缺省单模块 core）。 */
  modulesYaml?: string;
  /** 测试 delta 的目标规格（缺省 core-S01-test-cases.md）。 */
  testTarget?: string;
  /** 额外文件（项目根相对路径 → 内容），在 merge 之前写入。 */
  extraFiles?: Record<string, string>;
  /** runner 额外上报的用例 ID。 */
  extraIds?: string[];
}

const RUNNER = `const fs = require('fs');
if (process.env.VS_RAN) fs.writeFileSync(process.env.VS_RAN, 'ran');
const ids = JSON.parse(fs.readFileSync('tools/ids.json', 'utf8'));
const skips = {};
for (const item of (process.env.VS_SKIP || '').split(',').filter(Boolean)) {
  const [id, spec] = item.split('=');
  if (!spec) { skips[id] = {}; continue; }
  const [reason_code, ...rest] = spec.split(':');
  skips[id] = { reason_code, detail: rest.join(':') };
}
const fail = (process.env.VS_FAIL || '').split(',').filter(Boolean);
const omit = (process.env.VS_OMIT || '').split(',').filter(Boolean);
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ids.filter(id => !omit.includes(id)).map(id => {
  if (fail.includes(id)) return JSON.stringify({ id, status: 'fail', scenario: 'S01', error: 'assert failed' });
  if (!(id in skips)) return JSON.stringify({ id, status: 'pass', scenario: 'S01' });
  const s = skips[id];
  return JSON.stringify({ id, status: 'skip', scenario: 'S01', ...(s.reason_code !== undefined ? { reason_code: s.reason_code } : {}), ...(s.detail !== undefined ? { detail: s.detail } : {}) });
}).join('\\n') + '\\n');
if (process.env.VS_EXIT) process.exit(Number(process.env.VS_EXIT));
`;

/** 建立并（缺省）合并 VS-prop 夹具；返回项目根与提案目录。 */
export function vsMerged(opts: VsMergedOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-vs-merged-'));
  roots.push(root);
  const proposalDir = join(root, 'logos', 'changes', VS_SLUG);
  put(root, 'logos/logos.config.json', `${JSON.stringify({
    name: 'vs', locale: 'zh', documents: {},
    verify: { result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/run.cjs', sandbox_mode: 'off', ...(opts.verify ?? {}) },
  }, null, 2)}\n`);
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: VS_SLUG, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', opts.modulesYaml
    ?? 'project:\n  name: VS Fixture\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const parent = '一、判据';
  const files = [
    { category: 'requirement', target: 'logos/resources/prd/1-product-requirements/core-01-requirements.md', delta: 'deltas/prd/1-product-requirements/core-01-requirements.md' },
    { category: 'feature', target: 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', delta: 'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md' },
    { category: 'scenario', target: 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', delta: 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md' },
    { category: 'test', target: `logos/resources/test/${opts.testTarget ?? 'core-S01-test-cases.md'}`, delta: `deltas/test/${opts.testTarget ?? 'core-S01-test-cases.md'}` },
  ];
  for (const f of files) {
    const isTest = f.category === 'test';
    put(root, f.target, `# 文档\n\n## ${parent}\n\n${isTest ? table(VS_BASE_IDS) : '旧正文。'}\n`);
    put(root, `logos/changes/${VS_SLUG}/${f.delta}`, `## MODIFIED — ${parent}\n\n${isTest ? table([...VS_BASE_IDS, VS_NEW_ID]) : '新正文。'}\n`);
  }
  const clarification = '## 决策澄清\n\n```yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: fixture}\n  compatibility: {status: none, reason: fixture}\n  security_privacy: {status: none, reason: fixture}\n  public_release: {status: none, reason: fixture}\n  external_commitment: {status: none, reason: fixture}\ndecisions: []\nunresolved: []\ndefaults: []\n```\n';
  put(root, `logos/changes/${VS_SLUG}/proposal.md`, `# 变更提案：vs fixture\n\n## 变更原因\n真实原因。\n\n## 变更类型\n需求级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 验收标准\n- 自动验收环境要求：无\n- 平台限定用例：无\n- 需要人参与的验收：无\n\n## 变更概述\n概述。\n\n${clarification}`);
  const deltaTasks = [...files].sort((a, b) => a.delta.localeCompare(b.delta)).map(f => `- [x] [MODIFY] \`${f.delta}\`：fixture 更新`).join('\n');
  put(root, `logos/changes/${VS_SLUG}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${deltaTasks}\n\n## [code] 代码实现\n`);
  put(root, `logos/changes/${VS_SLUG}/PLAN_APPROVED`, '{}');
  put(root, 'tools/run.cjs', RUNNER);
  put(root, 'tools/ids.json', JSON.stringify([...(opts.skipMerge ? VS_BASE_IDS : [...VS_BASE_IDS, VS_NEW_ID]), ...(opts.extraIds ?? [])]));
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) put(root, rel, content);
  if (!opts.skipMerge) {
    const r = runCli(root, ['merge', VS_SLUG]);
    if (r.status !== 0) throw new Error(`fixture merge 失败：${r.stderr || r.stdout}`);
  }
  return { root, proposalDir, ran: `${root}.RAN` };
}

/** 启动 verify 前的前置断言材料：经正式读取器读到的变更集 ID。 */
export function changedIdsOf(f: { root: string; proposalDir: string }): string[] | null {
  const read = readTestChangeSet(f.root, f.proposalDir, { change: VS_SLUG, module: 'core' });
  return read.valid ? read.value.changed_test_ids : null;
}

export function readSpecMerged(f: { proposalDir: string }): Record<string, any> {
  return JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8'));
}
