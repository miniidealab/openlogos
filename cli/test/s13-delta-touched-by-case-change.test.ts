/**
 * fix-delta-touched-by-case-change：分层验收对测试用例文档按用例变化判断 delta 触及（功能规格 §2.109.5、§2.109.15）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 测试用例文档按用例变化判断 delta 触及测试」严格对齐：
 * UT-S13-294～308、ST-S13-55、ST-S13-56。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 LD：在夹具 LV 的记录型入口与分层配置之上，测试规格带标题结构（便于 MODIFIED 定位），core-S02 另含编号不含场景号的
 * UT-JSON-90。提案经真实 CLI `change` 建立，delta 经真实 CLI `merge` 合并——SPEC_MERGED（含测试变更集与合并基线）
 * 一律由真实合并路径写出，不手写；需要破坏标记或正式文档的用例在合并之后再改。
 * 「实际执行了哪些用例」读项目外的调用记录，不从 CLI 输出推断。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerSchema, validate } from '@hyperjump/json-schema/draft-2020-12';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layeredDeltaTouchedScenarioIds, readAffectedDeclaration } from '../src/lib/affected-scenarios.js';
import { readBaselineBefore } from '../src/lib/merge-baseline.js';
import {
  createLv, declarationSection, declarationYaml, destroyLv, git, lvEnv, mainPathSection, put, runVerify, setScript, table,
} from './golden/s13-layered-fixture.mjs';

vi.setConfig({ testTimeout: 300_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const REPO = resolve(CLI_ROOT, '..');
const SLUG = 'ld-demo';
const TEST_DIR = 'logos/resources/test';
const SCENARIO_DIR = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const DELTA_SCENARIO = 'prd/3-technical-plan/2-scenario-implementation/core-S02-demo.md';

let schemaId = '';
beforeAll(() => {
  const schema = JSON.parse(readFileSync(join(REPO, 'spec/schema/verify.schema.json'), 'utf8'));
  schemaId = schema.$id;
  try { registerSchema(schema); } catch { /* 同一 worker 内已注册 */ }
});

type Lv = ReturnType<typeof createLv>;
type Ld = Lv & { proposalDir: string };
const made: Lv[] = [];
const extraDirs: string[] = [];
afterEach(() => {
  while (made.length) destroyLv(made.pop()!);
  while (extraDirs.length) rmSync(extraDirs.pop()!, { recursive: true, force: true });
});

/** 带标题结构的测试用例文档：用例表在「单元测试」下，另有一段「覆盖度校验」文字。 */
const rows = (ids: string[], desc: Record<string, string> = {}) =>
  `${['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${desc[id] ?? 'fixture'} |`)].join('\n')}\n`;
const doc = (ids: string[], tail = '') => `# 测试用例\n\n## 单元测试\n\n${rows(ids)}\n## 覆盖度校验\n\n- 覆盖说明\n${tail}`;
const S01 = ['UT-S01-01', 'UT-S01-02', 'UT-S01-03'];
const S02 = ['UT-S02-01', 'UT-S02-02', 'UT-JSON-90'];
const ALL = [...S01, ...S02, 'UT-S03-01', 'UT-S03-02', 'UT-S04-02'].sort();
const LD_DOCS = {
  'core-S01-test-cases.md': doc(S01),
  'core-S02-test-cases.md': doc(S02),
  'core-S03-test-cases.md': doc(['UT-S03-01', 'UT-S03-02'], mainPathSection(['UT-S03-01'])),
  'core-S04-test-cases.md': doc(['UT-S04-01 [manual]', 'UT-S04-02']),
};

/** 常用 delta。 */
const dMain = (ids: string[]) => `## ADDED — 主链路用例\n\n${ids.map(id => `- ${id}`).join('\n')}\n`;
const dText = '## MODIFIED — 覆盖度校验\n\n- 改写后的覆盖说明\n';
const dTable = (ids: string[], desc: Record<string, string> = {}, removed: string[] = []) =>
  `## MODIFIED — 单元测试\n\n${rows(ids, desc)}${removed.length ? `\n## REMOVED-ITEMS — 单元测试\n\n${removed.map(id => `- ${id}`).join('\n')}\n` : ''}`;
const S01_MAIN_AND_MODIFY = `${dTable(S01, { 'UT-S01-02': 'fixture（预期已修改）' })}\n${dMain(['UT-S01-01'])}`;
const D_MAIN_S02 = { 'test/core-S02-test-cases.md': dMain(['UT-S02-01']) };

function proposalMd(declaration: string | null): string {
  return [
    `# 变更提案：${SLUG}`, '', '> module: core', '',
    '## 变更原因', '夹具。', '', '## 变更类型', '代码级', '', '## 变更范围', '- 影响的测试规格：夹具私有测试用例文档。', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具不产生部署影响', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## UI/UX 变更声明', '', '```yaml', 'ui_impact: false', 'design_system_mode: generated', 'design_system_fallback_reason: ""', 'pages: []', '```', '',
    '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
    'impacts:', '  data:', '    status: none', '    reason: 夹具不涉及数据影响',
    '  compatibility:', '    status: none', '    reason: 夹具不涉及兼容性影响',
    '  security_privacy:', '    status: none', '    reason: 夹具不涉及安全或隐私影响',
    '  public_release:', '    status: none', '    reason: 夹具不涉及公开发布',
    '  external_commitment:', '    status: none', '    reason: 夹具不涉及外部承诺',
    'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
    '## 验收标准', '- 自动验收环境要求：无', '- 平台限定用例：无', '- 需要人参与的验收：无', '',
    ...(declaration === null ? [] : [declarationSection(declaration)]),
    // 只改清单的 delta 不带任何测试 ID：以既有用例满足「需代码的提案须有可采信的测试 ID」的合并准入
    '## 复用测试 ID', '', '- UT-S03-01 — 夹具既有用例', '',
    '## 变更概述', '夹具。', '',
  ].join('\n');
}

function cli(f: Lv, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: f.root, encoding: 'utf8', timeout: 120_000, env: lvEnv(f, { OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' }),
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface LdOpts {
  /** 提案 delta：{ 相对 deltas/ 的路径: 内容 } */
  deltas: Record<string, string>;
  /** 声明的场景编号（夹具函数写成含 id 与非空 reason 的对象）；缺省为空 */
  scenarios?: string[];
  shared?: boolean;
  /** false → 不写「受影响场景」段 */
  declaration?: false;
  /** false → 只写 delta，不执行 merge */
  merged?: boolean;
  script?: Record<string, unknown>;
}

/** 建夹具 LD 并（缺省）经真实 CLI 合并。 */
function ld(opts: LdOpts): Ld {
  const f = createLv({
    guard: 'none', docs: LD_DOCS, commitAll: true,
    changes: { [`${SCENARIO_DIR}/core-S02-demo.md`]: '# S02 演示\n\n## 场景目标\n\n原目标。\n' },
    ...(opts.script ? { script: opts.script } : {}),
  });
  made.push(f);
  const created = cli(f, ['change', SLUG]);
  expect(created.status, created.stderr || created.stdout).toBe(0);
  const proposalDir = join(f.root, 'logos/changes', SLUG);
  const scenarios = opts.scenarios ?? [];
  const declaration = opts.declaration === false ? null : declarationYaml({ scenarios, shared: opts.shared ? 'true' : 'false' });
  put(f.root, `logos/changes/${SLUG}/proposal.md`, proposalMd(declaration));
  const targets = Object.keys(opts.deltas);
  put(f.root, `logos/changes/${SLUG}/tasks.md`, [
    '# 实现任务', '', '## [delta] 规格变更', '', ...targets.map(t => `- [x] 产出 delta 到 \`deltas/${t}\`。`), '', '## [code] 代码实现', '',
  ].join('\n'));
  for (const [rel, content] of Object.entries(opts.deltas)) put(f.root, `logos/changes/${SLUG}/deltas/${rel}`, content);
  if (declaration !== null) {
    // 声明的写法：读回确认 usable 且已识别场景与传入编号一致，否则夹具直接失败
    const read = readAffectedDeclaration(f.root, proposalDir);
    expect(read.status, JSON.stringify(read.problems)).toBe('usable');
    expect(read.recognized.map(item => item.id)).toEqual(scenarios);
  }
  if (opts.merged !== false) {
    const merged = cli(f, ['merge', SLUG]);
    expect(merged.status, merged.stderr || merged.stdout).toBe(0);
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(true);
  }
  return Object.assign(f, { proposalDir });
}

const verify = (f: Lv) => runVerify(CLI, f);
const executedOf = (run: { calls: any[] }): string[] => Array.from(new Set(run.calls.flatMap(c => c.executed as string[]))).sort();
const scenariosOf = (data: any): Array<{ id: string; sources: string[] }> => data.layers.affected.scenarios;
const reasonCodes = (data: any): string[] => data.layers.expansion.reasons.map((r: any) => r.code);
const markerPath = (f: Ld) => join(f.proposalDir, 'SPEC_MERGED');
const readMarker = (f: Ld) => JSON.parse(readFileSync(markerPath(f), 'utf8'));
const editMarker = (f: Ld, mutate: (marker: any) => void) => {
  const marker = readMarker(f);
  mutate(marker);
  writeFileSync(markerPath(f), `${JSON.stringify(marker, null, 2)}\n`);
};
const baselineTarget = (marker: any, file: string) => marker.merge_baseline.targets.find((t: any) => t.path === `${TEST_DIR}/${file}`);
const sha = (path: string) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
const objectCount = (f: Lv) => git(f.root, ['count-objects', '-v']);

describe('S13 测试用例文档按用例变化判断 delta 触及 — 没有改动用例时不并入', () => {
  it('UT-S13-294: 只改主链路小节时该场景不并入，新列入的主链路用例在集合内', async () => {
    const f = ld({ deltas: D_MAIN_S02 });
    const marker = readMarker(f);
    expect(marker.test_change_set.changed_test_ids).toEqual([]);
    expect(marker.test_change_set.removed_test_ids).toEqual([]);
    const run = verify(f);
    const l = run.data.layers;
    expect(l.affected.scenarios).toEqual([]);
    expect(l.changed.ids).toEqual([]);
    expect(l.main_path.ids).toEqual(['UT-S02-01', 'UT-S03-01']);
    expect(l.total.ids).toEqual(['UT-S02-01', 'UT-S03-01']);
    expect(executedOf(run)).toEqual(['UT-S02-01', 'UT-S03-01']);
    expect(l.expansion.level).toBe('none');
    expect(run.data.gate.result).toBe('PASS');
    const output = await validate(schemaId, run.data as any);
    expect(output.valid, JSON.stringify(output).slice(0, 400)).toBe(true);
    expect(Object.keys(l.affected).sort()).toEqual(['count', 'ids', 'scenarios']);
  });

  it('UT-S13-295: 只改非用例文字时该场景不并入', () => {
    const run = verify(ld({ deltas: { 'test/core-S02-test-cases.md': dText } }));
    expect(run.data.layers.affected.scenarios).toEqual([]);
    expect(run.data.layers.total.ids).toEqual(['UT-S03-01']);
  });

  it('UT-S13-302: 声明的场景不受影响', () => {
    const run = verify(ld({ deltas: D_MAIN_S02, scenarios: ['S02'] }));
    expect(scenariosOf(run.data)).toEqual([{ id: 'S02', sources: ['declared'] }]);
    for (const id of S02) expect(run.data.layers.total.ids).toContain(id);
  });

  it('UT-S13-307: 场景没有 delta 来源时扩大规则照常生效', () => {
    const shared = verify(ld({ deltas: D_MAIN_S02, shared: true }));
    expect(scenariosOf(shared.data).find(s => s.id === 'S02')).toBeUndefined();
    expect(shared.data.layers.expansion.level).toBe('full');
    expect(reasonCodes(shared.data)).toContain('shared_change_declared');
    expect(executedOf(shared)).toEqual(ALL);
    expect(shared.data.gate.result).toBe('PASS');

    const missing = verify(ld({ deltas: D_MAIN_S02, declaration: false }));
    expect(scenariosOf(missing.data).find(s => s.id === 'S02')).toBeUndefined();
    expect(reasonCodes(missing.data)).toEqual(expect.arrayContaining(['declaration_missing', 'module_scope_unavailable']));
    expect(missing.data.layers.expansion.level).toBe('full');
    expect(executedOf(missing)).toEqual(expect.arrayContaining(['UT-S02-02', 'UT-JSON-90']));
  });
});

describe('S13 测试用例文档按用例变化判断 delta 触及 — 用例有变化时并入', () => {
  it('UT-S13-296: 新增用例时并入，新建的文档同样并入', () => {
    const added = verify(ld({ deltas: { 'test/core-S02-test-cases.md': dTable([...S02, 'UT-S02-03']) } }));
    expect(scenariosOf(added.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
    for (const id of [...S02, 'UT-S02-03']) expect(added.data.layers.total.ids).toContain(id);

    const created = verify(ld({ deltas: { 'test/core-S05-test-cases.md': `## ADDED — 单元测试\n\n${rows(['UT-S05-01'])}` } }));
    expect(scenariosOf(created.data)).toEqual([{ id: 'S05', sources: ['delta'] }]);
  });

  it('UT-S13-297: 修改用例时并入', () => {
    const run = verify(ld({ deltas: { 'test/core-S02-test-cases.md': dTable(S02, { 'UT-S02-01': 'fixture（预期已修改）' }) } }));
    expect(scenariosOf(run.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
    expect(run.data.layers.changed.ids).toEqual(['UT-S02-01']);
    expect(run.data.layers.total.ids).toEqual(expect.arrayContaining(['UT-S02-02', 'UT-JSON-90']));
  });

  it('UT-S13-298: 删除用例时原场景并入，编号不含场景号时同样成立', () => {
    const a = ld({ deltas: { 'test/core-S02-test-cases.md': dTable(['UT-S02-01', 'UT-JSON-90'], {}, ['UT-S02-02']) } });
    expect(readMarker(a).test_change_set.removed_test_ids).toEqual(['UT-S02-02']);
    const ra = verify(a);
    expect(scenariosOf(ra.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
    expect(ra.data.layers.total.ids).toEqual(expect.arrayContaining(['UT-S02-01', 'UT-JSON-90']));

    const b = ld({ deltas: { 'test/core-S02-test-cases.md': dTable(['UT-S02-01', 'UT-S02-02'], {}, ['UT-JSON-90']) } });
    expect(readMarker(b).test_change_set.removed_test_ids).toEqual(['UT-JSON-90']);
    expect(readMarker(b).test_change_set.changed_test_ids).toEqual([]);
    const rb = verify(b);
    expect(scenariosOf(rb.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
    expect(rb.data.layers.total.ids).toEqual(expect.arrayContaining(['UT-S02-01', 'UT-S02-02']));
  });

  it('UT-S13-299: 跨文档移动用例时移出与移入的场景都并入', () => {
    const f = ld({ deltas: {
      'test/core-S02-test-cases.md': dTable(['UT-S02-01', 'UT-S02-02'], {}, ['UT-JSON-90']),
      'test/core-S01-test-cases.md': dTable([...S01, 'UT-JSON-90']),
    } });
    const set = readMarker(f).test_change_set;
    expect(set.changed_test_ids).toEqual(['UT-JSON-90']);
    expect(set.removed_test_ids).toEqual([]);
    const run = verify(f);
    expect(scenariosOf(run.data)).toEqual([{ id: 'S01', sources: ['delta'] }, { id: 'S02', sources: ['delta'] }]);
    expect(run.data.layers.total.ids).toEqual(expect.arrayContaining(['UT-S02-01', 'UT-S02-02', ...S01]));
  });

  it('UT-S13-300: 同一提案中各份文档互不影响', () => {
    const f = ld({
      deltas: { ...D_MAIN_S02, 'test/core-S01-test-cases.md': S01_MAIN_AND_MODIFY },
      scenarios: ['S01'],
    });
    expect(readMarker(f).test_change_set.changed_test_ids).toEqual(['UT-S01-02']);
    const run = verify(f);
    expect(scenariosOf(run.data)).toEqual([{ id: 'S01', sources: ['declared', 'delta'] }]);
    expect(run.data.layers.total.ids).toEqual([...S01, 'UT-S02-01', 'UT-S03-01']);
    const executed = executedOf(run);
    expect(executed).toContain('UT-S02-01');
    expect(executed).not.toContain('UT-S02-02');
    expect(executed).not.toContain('UT-JSON-90');
  });

  it('UT-S13-301: 场景文档的 delta 照常并入，与没改用例的测试用例文档并存时因场景文档并入', () => {
    const scenarioDelta = { [DELTA_SCENARIO]: '## MODIFIED — 场景目标\n\n新目标。\n' };
    for (const deltas of [scenarioDelta, { ...scenarioDelta, ...D_MAIN_S02 }]) {
      const run = verify(ld({ deltas }));
      expect(scenariosOf(run.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
      for (const id of S02) expect(run.data.layers.total.ids).toContain(id);
    }
  });
});

describe('S13 测试用例文档按用例变化判断 delta 触及 — 按文件名判断的情形与出口', () => {
  it('UT-S13-303: 提案未合并时按文件名并入', () => {
    const run = verify(ld({ deltas: D_MAIN_S02, merged: false }));
    expect(scenariosOf(run.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
    expect(run.data.layers.changed.ids).toEqual([]);
    expect(run.data.gate.reason).not.toBe('test_change_set_invalid');
    expect(run.data.change_set_diagnostic).toBeUndefined();
  });

  it('UT-S13-304: 普通提案：测试变更集无效时按文件名并入且门禁 FAIL', () => {
    const tampered = ld({ deltas: D_MAIN_S02 });
    editMarker(tampered, m => { m.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`; });
    const drifted = ld({ deltas: D_MAIN_S02 });
    appendFileSync(join(drifted.root, TEST_DIR, 'core-S02-test-cases.md'), '\n合并后追加的一行文字。\n');
    for (const f of [tampered, drifted]) {
      const run = verify(f);
      expect(scenariosOf(run.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
      expect(run.data.gate.result).toBe('FAIL');
      expect(run.data.gate.reason).toBe('test_change_set_invalid');
    }
  });

  it('UT-S13-305: 无法逐份文档判断时只对该文档按文件名并入', () => {
    const deltas = { 'test/core-S01-test-cases.md': dMain(['UT-S01-01']), ...D_MAIN_S02 };
    const S02_DOC = 'core-S02-test-cases.md';
    const arms: Array<[string, (m: any) => void, string[]]> = [
      ['① 删除 merge_baseline', m => { delete m.merge_baseline; }, ['S01', 'S02']],
      ['② 删除 S02 的基线条目', m => { m.merge_baseline.targets = m.merge_baseline.targets.filter((t: any) => t.path !== `${TEST_DIR}/${S02_DOC}`); }, ['S02']],
      ['③ before.git_blob 不存在', m => { baselineTarget(m, S02_DOC).before.git_blob = '0123456789abcdef0123456789abcdef01234567'; }, ['S02']],
      ['④ before.sha256 不匹配', m => { baselineTarget(m, S02_DOC).before.sha256 = '0'.repeat(64); }, ['S02']],
      ['⑤ after_sha256 不匹配', m => { baselineTarget(m, S02_DOC).after_sha256 = '0'.repeat(64); }, ['S02']],
    ];
    for (const [name, mutate, expected] of arms) {
      const f = ld({ deltas });
      // 对照：未改动标记时两份文档都可以逐份判断，都不并入
      expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid'), name).toEqual([]);
      editMarker(f, mutate);
      const objectsBefore = objectCount(f);
      const run = verify(f);
      expect(scenariosOf(run.data), name).toEqual(expected.map(id => ({ id, sources: ['delta'] })));
      expect(run.status, name).toBe(0);
      expect(run.data.layers.expansion, name).toEqual({ level: 'none', reasons: [] });
      expect(run.data.gate.reason, name).not.toBe('test_change_set_invalid');
      expect(run.data.gate.result, name).toBe('PASS');
      if (name.startsWith('③')) expect(objectCount(f), name).toBe(objectsBefore);
    }
    // 比较报错（EX-13.66 最后一项）：含重复 ID 的文档无法经正常 merge 构造，以比较函数抛错的接缝断言同一条兜底路径
    const f = ld({ deltas });
    const throwing = () => { throw new Error('compare failed'); };
    expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid', { compare: throwing as any })).toEqual(['S01', 'S02']);
    // 只有 S02 的比较抛错时，S01 照常按内容判断
    let calls = 0;
    const real = (input: any) => {
      calls += 1;
      if (String(input.targets[0].targetPath).endsWith(S02_DOC)) throw new Error('compare failed');
      return { changed_test_ids: [], removed_test_ids: [] } as any;
    };
    expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid', { compare: real as any })).toEqual(['S02']);
    expect(calls).toBe(2);
    partialCloneArm();
  });

  /** UT-S13-305 的部分克隆臂：本地缺少合并前内容时不取回，只对该文档按文件名并入（EX-13.66「副作用：无」）。 */
  function partialCloneArm(): void {
    const S02_DOC = 'core-S02-test-cases.md';
    const f = ld({ deltas: { 'test/core-S01-test-cases.md': dMain(['UT-S01-01']), ...D_MAIN_S02 } });
    const blob: string = baselineTarget(readMarker(f), S02_DOC).before.git_blob;
    // 把夹具改造成缺对象时会访问远端的仓库：远端持有全部对象并允许按对象取回，本地删掉 S02 合并前内容的对象。
    // 远端只配 URL 与 partialclonefilter——不设 remote.origin.promisor，也不设 extensions.partialclone：
    // 判断不得依赖识别某几个配置键，只配过滤器时 Git 同样会按需取回
    const remote = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-ld-remote-')));
    extraDirs.push(remote);
    git(f.root, ['clone', '-q', '--bare', f.root, join(remote, 'origin.git')]);
    const origin = join(remote, 'origin.git');
    git(origin, ['config', 'uploadpack.allowfilter', 'true']);
    git(origin, ['config', 'uploadpack.allowanysha1inwant', 'true']);
    git(f.root, ['remote', 'add', 'origin', `file://${origin}`]);
    git(f.root, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
    const s01Blob: string = baselineTarget(readMarker(f), 'core-S01-test-cases.md').before.git_blob;
    expect(s01Blob).not.toBe(blob);
    const loose = join(f.root, '.git/objects', blob.slice(0, 2), blob.slice(2));
    expect(existsSync(loose)).toBe(true);
    rmSync(loose);
    const packs = () => (existsSync(join(f.root, '.git/objects/pack')) ? readdirSync(join(f.root, '.git/objects/pack')).sort() : []);
    const packsBefore = packs();
    const objectsBefore = objectCount(f);

    // 逐文档判断：S02 的合并前内容本地读不回 → 按文件名；S01 照常按内容判断、不并入
    expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid')).toEqual(['S02']);
    expect(existsSync(loose)).toBe(false);
    expect(packs()).toEqual(packsBefore);
    expect(objectCount(f)).toBe(objectsBefore);
    // 旧版 Git（不支持禁用按需取回）同样逐份判断：本地缺失的 S02 不读、按文件名；本地完整的 S01 照常比较、不并入；对象库不变
    const OLD_GIT = { gitVersion: (): [number, number] => [2, 44] };
    // 记录哪些对象进入了读取：旧版 Git 下 S01 的合并前内容被读取，本地缺失的 S02 根本不进入读取调用
    // （测试机的新版 Git 自带防取回开关，所以「没有读取」必须直接观察，不能只看对象库有没有变化）
    const readBlobs: Array<string | null> = [];
    const recording: typeof readBaselineBefore = (root, before) => { readBlobs.push(before.git_blob); return readBaselineBefore(root, before); };
    expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid', { ...OLD_GIT, readBaselineBefore: recording })).toEqual(['S02']);
    expect(readBlobs).toEqual([s01Blob]);
    // 对照：报告为支持该开关的版本时，两份文档都进入读取，且读取时已设置禁止取回的开关。
    // 这里用独立的读取替身，不调用宿主的真实 Git 去读缺失对象：宿主若是不认该开关的旧版 Git，
    // 强行报告新版本再真实读取会把 S02 从远端取回，既破坏夹具，也得不到「只并入 S02」的结论。
    const switchSeen: Array<string | undefined> = [];
    const doubleReads: Array<string | null> = [];
    const readDouble: typeof readBaselineBefore = (root, before) => {
      doubleReads.push(before.git_blob);
      switchSeen.push(process.env.GIT_NO_LAZY_FETCH);
      // 本地缺失的对象：带开关的读取判为不可读；本地已有的对象照常读回（不会触发取回）
      return before.git_blob === blob ? null : readBaselineBefore(root, before);
    };
    const switchBefore = process.env.GIT_NO_LAZY_FETCH;
    expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid', { gitVersion: () => [2, 45], readBaselineBefore: readDouble })).toEqual(['S02']);
    expect([...doubleReads].sort()).toEqual([s01Blob, blob].sort());
    expect(switchSeen).toEqual(['1', '1']);
    // 开关只在读取期间设置，返回后恢复原值
    expect(process.env.GIT_NO_LAZY_FETCH).toBe(switchBefore);
    expect(existsSync(loose)).toBe(false);
    expect(packs()).toEqual(packsBefore);
    expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid', OLD_GIT)).toEqual(['S02']);
    expect(existsSync(loose)).toBe(false);
    expect(packs()).toEqual(packsBefore);
    expect(objectCount(f)).toBe(objectsBefore);
    // 取不到 Git 版本时按不支持该开关处理，结论相同
    readBlobs.length = 0;
    expect(layeredDeltaTouchedScenarioIds(f.root, f.proposalDir, 'valid', { gitVersion: () => null, readBaselineBefore: recording })).toEqual(['S02']);
    expect(readBlobs).toEqual([s01Blob]);
    expect(existsSync(loose)).toBe(false);

    // 对照：普通仓库显式写了 remote.origin.promisor=false——
    // 基线对象全部在本地，新旧 Git 下两份只改清单的文档都照常比较、都不并入（AC-VERIFY-TIER-23）
    const plain = ld({ deltas: { 'test/core-S01-test-cases.md': dMain(['UT-S01-01']), ...D_MAIN_S02 } });
    git(plain.root, ['remote', 'add', 'origin', `file://${origin}`]);
    git(plain.root, ['config', 'remote.origin.promisor', 'false']);
    expect(layeredDeltaTouchedScenarioIds(plain.root, plain.proposalDir, 'valid', OLD_GIT)).toEqual([]);
    expect(layeredDeltaTouchedScenarioIds(plain.root, plain.proposalDir, 'valid')).toEqual([]);
    // 同一仓库改为 promisor=true 且对象都在本地：旧版 Git 下逐对象确认存在，仍然都不并入（与配置怎么写无关）
    git(plain.root, ['config', 'remote.origin.promisor', 'true']);
    expect(layeredDeltaTouchedScenarioIds(plain.root, plain.proposalDir, 'valid', OLD_GIT)).toEqual([]);

    // 这里只断言「delta 触及」这一步自己的读取。真实 verify 在此之前还有既有的改动文件计算
    // （`git diff --name-status -M <baseRef>`，重命名检测会读取 blob），它在部分克隆中的行为不属于本用例的范围。

    // 夹具有效性：不禁用按需取回时，同一条读取会从远端取回该对象并写入本地对象库——上面的「对象库不变」因此有区分力
    const fetched = spawnSync('git', ['cat-file', '-e', blob], { cwd: f.root, encoding: 'utf8', env: lvEnv(f) });
    expect(fetched.status, fetched.stderr).toBe(0);
    expect(existsSync(loose) || packs().length > packsBefore.length).toBe(true);
  }

  it('UT-S13-306: change-lint 的「场景是否存在」判断不变', () => {
    const deltas = { ...D_MAIN_S02, 'test/core-S06-test-cases.md': '## ADDED — 说明\n\n本文档暂未定义用例。\n\n| ID | 描述 |\n|---|---|\n' };
    for (const merged of [false, true]) {
      const f = ld({ deltas, scenarios: ['S06'], merged });
      const r = cli(f, ['change-lint', '--format', 'json']);
      const arm = merged ? '已合并' : '未合并';
      // 检查必须真正执行完：退出码 0（全过）或 2（有其他违规）；1 是操作错误（如没有活跃提案），此时尚未进入场景存在性检查
      expect([0, 2], `${arm} stderr=${r.stderr.slice(0, 300)}`).toContain(r.status);
      const envelope = JSON.parse(r.stdout.trim());
      expect(envelope.command, arm).toBe('change-lint');
      expect(envelope.error, arm).toBeUndefined();
      expect(envelope.data.slug, arm).toBe(SLUG);
      expect(Array.isArray(envelope.data.violations), arm).toBe(true);
      const codes = envelope.data.violations.map((v: any) => v.code);
      expect(codes, arm).not.toContain('affected_scenarios_invalid');
      expect(JSON.stringify(envelope.data), arm).not.toContain('不存在的场景');
      // 声明确实被读到并采信：S06 只出现在本提案的 delta 中，按文件名算存在
      const declared = readAffectedDeclaration(f.root, f.proposalDir);
      expect(declared.status, arm).toBe('usable');
      expect(declared.unknownScenarioIds, arm).toEqual([]);
    }
  });

  it('UT-S13-308: 多切片提案：测试变更集无效时沿用切片清单暂停出口', () => {
    const build = (): Ld => {
      const f = ld({ deltas: { ...D_MAIN_S02, 'test/core-S01-test-cases.md': dTable([...S01, 'UT-S01-04', 'UT-S01-05']) } });
      const input = { slices: ['UT-S01-04', 'UT-S01-05'].map((id, i) => ({
        slice_id: `slice-${i === 0 ? 'a' : 'b'}`, task_text: `切片${i + 1}：能力（覆盖 ${id}）`,
        owned_test_ids: [id], runner_selectors: [id], spec_targets: [`${TEST_DIR}/core-S01-test-cases.md`],
      })) };
      put(f.root, `logos/changes/${SLUG}/slices.json`, JSON.stringify(input, null, 2));
      const planned = cli(f, ['slice', 'plan', '--file', `logos/changes/${SLUG}/slices.json`, '--format', 'json']);
      expect(planned.status, planned.stderr || planned.stdout).toBe(0);
      expect(existsSync(join(f.proposalDir, 'TEST_SLICE_MANIFEST.json'))).toBe(true);
      return f;
    };
    const tampered = build();
    const drifted = build();
    const tracked = ['VERIFY_PASS', 'VERIFY_FAIL', 'SLICE_CHECKPOINTS.jsonl', 'LOOP_ITERS', 'tasks.md', 'TEST_SLICE_MANIFEST.json'];
    const snapshot = (f: Ld) => tracked.map(name => sha(join(f.proposalDir, name)));
    const before = new Map<Ld, Array<string | null>>([[tampered, snapshot(tampered)], [drifted, snapshot(drifted)]]);
    editMarker(tampered, m => { m.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`; });
    appendFileSync(join(drifted.root, TEST_DIR, 'core-S02-test-cases.md'), '\n合并后追加的一行文字。\n');
    for (const f of [tampered, drifted]) {
      setScript(f, { mode: 'narrow' });
      const run = verify(f);
      expect(run.status).toBe(2);
      expect(run.data.reason).toBe('test-slice-manifest-invalid');
      expect(run.data.slice_verification_state.human_action_required).toBe(true);
      const codes = (run.data.slice_verification_state.violations ?? []).map((v: any) => v.code);
      expect(codes.some((code: string) => code.startsWith('test-slice-change-set-'))).toBe(true);
      expect(run.data.gate).toBeUndefined();
      expect(run.data.layers).toBeUndefined();
      expect(run.calls).toEqual([]);
      expect(snapshot(f)).toEqual(before.get(f));
    }
  });
});

describe('S13 测试用例文档按用例变化判断 delta 触及 — 场景测试', () => {
  it('ST-S13-55: 一次调整多份主链路小节的提案只验收该验收的部分', () => {
    const f = ld({
      deltas: {
        ...D_MAIN_S02,
        'test/core-S04-test-cases.md': dMain(['UT-S04-02']),
        'test/core-S01-test-cases.md': S01_MAIN_AND_MODIFY,
      },
      scenarios: ['S01'],
    });
    const run = verify(f);
    expect(run.status).toBe(0);
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.layers.expansion.level).toBe('none');
    expect(scenariosOf(run.data)).toEqual([{ id: 'S01', sources: ['declared', 'delta'] }]);
    expect(executedOf(run)).toEqual([...S01, 'UT-S02-01', 'UT-S03-01', 'UT-S04-02']);
    // 报告「验收范围」小节列出的受影响场景只有 S01
    const scope = run.report!.slice(run.report!.indexOf('验收范围'));
    expect(scope).toContain('S01');
    expect(scope).not.toMatch(/S02|S04/);
    expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(true);
  });

  it('ST-S13-56: 删除与移动用例时原场景仍被回归', () => {
    const script = { cases: { 'UT-S02-01': 'fail' } };
    const removed = verify(ld({ deltas: { 'test/core-S02-test-cases.md': dTable(['UT-S02-01', 'UT-S02-02'], {}, ['UT-JSON-90']) }, script }));
    expect(scenariosOf(removed.data)).toEqual([{ id: 'S02', sources: ['delta'] }]);
    expect(executedOf(removed)).toContain('UT-S02-01');
    expect(removed.status).toBe(1);
    expect(removed.data.gate.reason).toBe('failed_cases');

    const moved = verify(ld({
      deltas: {
        'test/core-S02-test-cases.md': dTable(['UT-S02-01', 'UT-S02-02'], {}, ['UT-JSON-90']),
        'test/core-S01-test-cases.md': dTable([...S01, 'UT-JSON-90']),
      },
      script,
    }));
    expect(scenariosOf(moved.data).map(s => s.id)).toEqual(['S01', 'S02']);
    expect(executedOf(moved)).toContain('UT-S02-01');
    expect(moved.status).toBe(1);
  });
});
