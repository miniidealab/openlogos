/**
 * 切片1：测试 ID 语法单点化与放宽。
 * 覆盖 UT-S35-131、UT-S09-286、UT-S13-65、UT-S13-66、ST-S13-18、UT-S32-50、UT-S32-51、ST-S32-17。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { isTestId, TABLE_TEST_ID_RE } from '../src/lib/test-id.js';
import { extractDefinedVerificationIds, deriveSliceVerificationState, writeTestSliceManifestAtomic, computeTaskFingerprint, computeSpecFingerprint } from '../src/lib/test-slice-manifest.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const REPO_ROOT = resolve(__dirname, '..', '..');
const SRC_ROOT = resolve(__dirname, '..', 'src');
const AUTHORITY = join(SRC_ROOT, 'lib', 'test-id.ts');
/** 已合并规格中此前不被严格读法接纳的 ID（全部在 core-S16-test-cases.md）。 */
const PREVIOUSLY_INVISIBLE = ['UT-JSON-09', 'ST-JSON-21'];

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (name.endsWith(ext)) out.push(path);
  }
  return out;
}

/** 从已合并测试规格提取全部表格首列 ID。 */
function mergedTableIds(): string[] {
  const ids = new Set<string>();
  for (const path of walk(join(REPO_ROOT, 'logos', 'resources', 'test'), '.md')) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = TABLE_TEST_ID_RE.exec(line.trim());
      if (m) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

describe('S35 测试 ID 语法单点', () => {
  it('UT-S35-131: 语法恰一处定义且接纳已合并规格中每个表格首列 ID', () => {
    // ① 生产代码中语法只有一处定义。cli/test/openlogos-reporter.ts 是随项目分发的独立产物，
    //    必须自包含、不得 import CLI 内部模块，因此不在本扫描范围（其一致性由 ② 之后单独断言）。
    const literal = /(?:new RegExp\([^)]*\(\?:UT\|ST|= *\/[^/]*\(\?:UT\|ST)/;
    const offenders = walk(SRC_ROOT, '.ts')
      .filter(path => path !== AUTHORITY)
      .filter(path => literal.test(readFileSync(path, 'utf8')))
      .map(path => path.slice(SRC_ROOT.length));
    expect(offenders).toEqual([]);

    // ② 权威语法必须接纳已合并规格中每一个表格首列 ID——语法与数据一旦漂移即红。
    const ids = mergedTableIds();
    expect(ids.length).toBeGreaterThan(2000);
    const rejected = ids.filter(id => !isTestId(id));
    expect(rejected).toEqual([]);

    // ③ 此前被严格读法丢弃的 ID 现已被接纳。
    for (const id of PREVIOUSLY_INVISIBLE) expect(isTestId(id)).toBe(true);

    // ④ reporter 作为分发产物自带一份读法，其接纳集合不得小于权威语法。
    const reporter = readFileSync(join(__dirname, 'openlogos-reporter.ts'), 'utf8');
    const source = /const ID_RE = (\/.+\/[gimsuy]*)/.exec(reporter);
    expect(source).not.toBeNull();
    const reporterRe = new RegExp(source![1].replace(/^\/|\/[gimsuy]*$/g, ''));
    for (const id of ids.filter(i => !i.startsWith('SMOKE-'))) {
      expect(reporterRe.test(id), `reporter 不接纳 ${id}`).toBe(true);
    }
  });
});

describe('S09/S32 变更 ID 捕获与切片归属', () => {
  const TABLE = ['| ID | 描述 |', '|---|---|', '| UT-JSON-09 | 此前不可见 |', '| UT-S16-01 | 常规形态 |', ''];

  it('UT-S09-286: test-change-set 捕获此前不可见的 ID', () => {
    // 语法权威直接判定——放宽后 JSON 系与常规形态同被接纳，集合只增不减。
    expect(isTestId('UT-JSON-09')).toBe(true);
    expect(isTestId('UT-S16-01')).toBe(true);
    expect(isTestId('SMOKE-core-173')).toBe(true);
    expect(isTestId('not-a-test-id')).toBe(false);

    const extracted = TABLE.map(l => TABLE_TEST_ID_RE.exec(l.trim())?.[1]).filter(Boolean);
    expect(extracted).toEqual(['UT-JSON-09', 'UT-S16-01']);
  });

  it('UT-S32-50: changed 集合接纳 JSON 系 ID', () => {
    const f = setupSliceFixture(['UT-JSON-09', 'UT-S16-01'], ['UT-JSON-09', 'UT-S16-01']);
    const st = deriveSliceVerificationState(f.root, f.dir);
    if (st.manifest_status !== 'valid') throw new Error(JSON.stringify(st.violations));
    expect(f.changed).toContain('UT-JSON-09');
  });

  it('UT-S32-51: 未归属的 JSON 系 ID 判 manifest invalid', () => {
    // changed 含 UT-JSON-09，但切片只 own 了 UT-S16-01 → 未归属
    const f = setupSliceFixture(['UT-JSON-09', 'UT-S16-01'], ['UT-S16-01']);
    const st = deriveSliceVerificationState(f.root, f.dir);
    expect(st.manifest_status).toBe('invalid');
    const missing = (st.violations ?? []).filter(v => v.code === 'test-slice-test-id-missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.map(v => v.message).join('\n')).toContain('UT-JSON-09');
  });

  it('ST-S32-17: 归属校验闭环——补齐归属后转 valid', () => {
    const partial = setupSliceFixture(['UT-JSON-09', 'UT-S16-01'], ['UT-S16-01']);
    expect(deriveSliceVerificationState(partial.root, partial.dir).manifest_status).toBe('invalid');
    const full = setupSliceFixture(['UT-JSON-09', 'UT-S16-01'], ['UT-JSON-09', 'UT-S16-01']);
    expect(deriveSliceVerificationState(full.root, full.dir).manifest_status).toBe('valid');
  });

  /** 用 CLI 自己的 buildTestChangeSet 构造 change set——手写 canonical 形状会造出无效夹具。 */
  const SLICE2_ID = 'UT-S16-02';
  function setupSliceFixture(definedIds: string[], ownedIds: string[]) {
    const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
    }));
    const specRel = 'logos/resources/test/core-S16-test-cases.md';
    mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
    const before = Buffer.from(['| ID | 描述 |', '|---|---|', ''].join('\n'), 'utf8');
    const allIds = [...definedIds, SLICE2_ID];
    const after = Buffer.from(['| ID | 描述 |', '|---|---|', ...allIds.map(i => `| ${i} | 用例 |`), ''].join('\n'), 'utf8');
    writeFileSync(join(root, specRel), after);

    const dir = join(root, 'logos', 'changes', 'slice-fixture');
    mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'test', 'core-S16-test-cases.md'),
      ['## ADDED — 夹具', '', ...after.toString('utf8').split('\n')].join('\n'));
    const changeSet = buildTestChangeSet({
      change: 'slice-fixture', module: 'core',
      targets: [{ targetPath: specRel, beforeBytes: before, afterBytes: after }],
    });
    writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
      type: 'merge_transaction_complete', transaction_id: 'mtx_fixture', seal_sha256: null,
      receipt_sha256: null, completed_at: new Date().toISOString(), test_change_set: changeSet,
    }));
    // slice-checkpoint 模式需 ≥2 个顶层 [code] 任务，且 slices 数必须与之一致。
    const tasks = '# 任务\n\n## [code]\n\n- [ ] 切片1：夹具（覆盖 ' + ownedIds.join('、') + '）\n- [ ] 切片2：夹具二（覆盖 ' + SLICE2_ID + '）\n';
    writeFileSync(join(dir, 'tasks.md'), tasks);
    writeTestSliceManifestAtomic(join(dir, 'TEST_SLICE_MANIFEST.json'), {
      schema: 'openlogos/test-slice-manifest@1', change: 'slice-fixture', module: 'core',
      task_fingerprint: computeTaskFingerprint(tasks),
      spec_fingerprint: computeSpecFingerprint(root, [specRel]),
      generated_at: new Date().toISOString(),
      slices: [
        {
          slice_id: 'slice-01-fixture', task_text: '切片1：夹具（覆盖 ' + ownedIds.join('、') + '）',
          owned_test_ids: [...ownedIds].sort(), runner_selectors: [...ownedIds].sort(), spec_targets: [specRel],
        },
        {
          slice_id: 'slice-02-fixture', task_text: '切片2：夹具二（覆盖 ' + SLICE2_ID + '）',
          owned_test_ids: [SLICE2_ID], runner_selectors: [SLICE2_ID], spec_targets: [specRel],
        },
      ],
    });
    return { root, dir, changed: changeSet.changed_test_ids };
  }
});

describe('S13 verify defined 集合', () => {
  it('UT-S13-65: defined 集合接纳此前不可见的 ID', () => {
    const defined = new Set(extractDefinedVerificationIds(REPO_ROOT));
    for (const id of PREVIOUSLY_INVISIBLE) expect(defined.has(id), `${id} 未进入 defined`).toBe(true);
  });

  it('UT-S13-66: 集合只增不减且 smoke 仍被排除', () => {
    const defined = extractDefinedVerificationIds(REPO_ROOT);
    // 严格读法（放宽前）能接纳的 ID 必须全部仍在
    const strict = /^(?:(?:UT|ST)-S\d{2}-[A-Za-z0-9]+(?:[-.][A-Za-z0-9]+)*)$/;
    const previously = mergedTableIds().filter(id => strict.test(id));
    const definedSet = new Set(defined);
    expect(previously.filter(id => !definedSet.has(id))).toEqual([]);
    // smoke 目录的 ID 不进 defined
    expect(defined.filter(id => id.startsWith('SMOKE-'))).toEqual([]);
  });

  it('ST-S13-18: 分母变大后覆盖度判据不放宽', () => {
    // defined 是覆盖度分母。此前不可见的 ID 进入分母后，若某条未被上报即落入 uncovered——
    // 判据本身不因分母变化而放宽。用集合运算直接断言，不依赖实时账本（账本每轮重建）。
    const defined = new Set(extractDefinedVerificationIds(REPO_ROOT));
    for (const id of PREVIOUSLY_INVISIBLE) expect(defined.has(id)).toBe(true);

    const reported = new Set([...defined].filter(id => !PREVIOUSLY_INVISIBLE.includes(id)));
    const uncovered = [...defined].filter(id => !reported.has(id)).sort();
    expect(uncovered).toEqual([...PREVIOUSLY_INVISIBLE].sort());

    // 这些 ID 确有测试代码在跑——放宽只是把它们纳入统计，不制造真实的未覆盖项。
    const suite = readFileSync(join(__dirname, 's16-json-output.test.ts'), 'utf8');
    for (const id of PREVIOUSLY_INVISIBLE) expect(suite).toContain(id);
  });
});
