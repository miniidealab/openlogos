import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBaselineClosureBatch } from '../src/lib/baseline-apply.js';
import {
  buildTestChangeSet, readTestChangeSet, scanTestDefinitions, validateTestChangeSet,
} from '../src/lib/test-change-set.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempRoot(): { root: string; proposalDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-change-set-'));
  roots.push(root);
  const proposalDir = join(root, 'logos/changes/change-set-fixture');
  mkdirSync(proposalDir, { recursive: true });
  return { root, proposalDir };
}

function table(rows: Array<[string, string]>, crlf = false): Buffer {
  const text = ['| ID | 描述 |', '| :--- | ---: |', ...rows.map(([id, value]) => `| ${id} | ${value} |`), ''].join('\n');
  return Buffer.from(crlf ? text.replace(/\n/g, '\r\n') : text);
}

function target(path: string, before: Buffer | null, after: Buffer) {
  return { targetPath: path, beforeBytes: before, afterBytes: after };
}

function persist(root: string, proposalDir: string, changeSet: ReturnType<typeof buildTestChangeSet>): void {
  for (const item of changeSet.targets) {
    const source = changeSet.targets.length === 1
      ? table(changeSet.changed_test_ids.map(id => [id, 'after']))
      : Buffer.from('after');
    mkdirSync(dirname(join(root, item.target_path)), { recursive: true });
    if (!existsSync(join(root, item.target_path))) writeFileSync(join(root, item.target_path), source);
  }
  writeFileSync(join(proposalDir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete', test_change_set: changeSet,
  }, null, 2)}\n`);
}

describe('canonical test change set', () => {
  it('UT-S39-33: 严格字段、ASCII 排序去重与 canonical hash', () => {
    const bytes = table([['UT-S10-140', 'new'], ['ST-S10-44', 'new']]);
    const changeSet = buildTestChangeSet({
      change: 'fixture', module: 'core', targets: [target('logos/resources/test/a.md', null, bytes)],
    });
    expect(Object.keys(changeSet)).toEqual([
      'schema', 'change', 'module', 'source', 'changed_test_ids', 'removed_test_ids', 'targets', 'sha256',
    ]);
    expect(Object.keys(changeSet.targets[0])).toEqual(['target_path', 'before_sha256', 'after_sha256']);
    expect(changeSet.changed_test_ids).toEqual(['ST-S10-44', 'UT-S10-140']);
    const { root } = tempRoot();
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/a.md'), bytes);
    expect(validateTestChangeSet(root, changeSet, { change: 'fixture', module: 'core' }).valid).toBe(true);
    const reordered = { change: changeSet.change, schema: changeSet.schema, ...changeSet };
    expect(validateTestChangeSet(root, reordered, { change: 'fixture', module: 'core' })).toMatchObject({
      valid: false, code: 'test-slice-change-set-shape',
    });
    expect(validateTestChangeSet(root, { ...changeSet, unknown: true }, { change: 'fixture', module: 'core' }).valid).toBe(false);
    expect(validateTestChangeSet(root, { ...changeSet, sha256: `sha256:${'0'.repeat(64)}` }, { change: 'fixture', module: 'core' })).toMatchObject({
      valid: false, code: 'test-slice-change-set-hash',
    });
  });

  it('UT-S39-34: before/final 新增、修改、原样、删除、排版与跨 target 分类', () => {
    const beforeA = table([['UT-S10-121', 'same'], ['UT-S10-129', 'old'], ['UT-S10-130', 'gone'], ['UT-S10-131', 'move']]);
    const afterA = Buffer.from([
      '| ID|描述 |', '|---|:---|', '| UT-S10-121 | same |', '| UT-S10-129 |new |', '| UT-S10-137 | added |', '',
    ].join('\n'));
    const afterB = table([['UT-S10-131', 'move']]);
    const changeSet = buildTestChangeSet({ change: 'fixture', module: 'core', targets: [
      target('logos/resources/test/a.md', beforeA, afterA),
      target('logos/resources/test/b.md', null, afterB),
    ] });
    expect(changeSet.changed_test_ids).toEqual(['UT-S10-129', 'UT-S10-131', 'UT-S10-137']);
    expect(changeSet.removed_test_ids).toEqual(['UT-S10-130']);
  });

  it('UT-S39-35: authority 表格、escaped pipe、inline-code pipe 与换行归一化', () => {
    const before = Buffer.from([
      '```md', '| ID | 描述 |', '|---|---|', '| UT-S10-999 | fake |', '```',
      '<!--', '| ID | 描述 |', '|---|---|', '| UT-S10-998 | fake |', '-->',
      '散文 UT-S10-997。', '| ID | 描述 |', '|---|---|', '| UT-S10-121 | a\\|b and `x|y` |', '',
    ].join('\r\n'));
    const after = Buffer.from('| ID|描述|\n|:---|---:|\n| UT-S10-121|a\\|b and `x|y`|\n');
    expect([...scanTestDefinitions('logos/resources/test/a.md', before).keys()]).toEqual(['UT-S10-121']);
    expect(buildTestChangeSet({ change: 'fixture', module: 'core', targets: [
      target('logos/resources/test/a.md', before, after),
    ] }).changed_test_ids).toEqual([]);
  });

  it('UT-S39-36: 重复 ID、非法 UTF-8与歧义表格在首写前 fail-closed', () => {
    const duplicate = Buffer.from('| ID | 描述 |\n|---|---|\n| UT-S10-121 | a |\n| UT-S10-121 | b |\n');
    expect(() => buildTestChangeSet({ change: 'fixture', module: 'core', targets: [
      target('logos/resources/test/a.md', null, duplicate),
    ] })).toThrow('test-change-set-duplicate-id');
    expect(() => scanTestDefinitions('logos/resources/test/a.md', Buffer.from([0xff]))).toThrow('test-change-set-invalid-utf8');
    const ambiguous = Buffer.from('| ID | ID |\n|---|---|\n| UT-S10-121 | a |\n');
    expect(() => scanTestDefinitions('logos/resources/test/a.md', ambiguous)).toThrow('test-change-set-ambiguous-table');
  });

  it('UT-S39-37: 后置复核 fault 仍回滚 resources、metadata 与 marker', () => {
    const { root, proposalDir } = tempRoot();
    const resource = 'logos/resources/test/a.md';
    const metadata = 'logos/logos-project.yaml';
    const marker = 'logos/changes/change-set-fixture/SPEC_MERGED';
    mkdirSync(dirname(join(root, resource)), { recursive: true });
    writeFileSync(join(root, resource), 'old');
    writeFileSync(join(root, metadata), 'old-meta');
    const result = applyBaselineClosureBatch(root, proposalDir, [
      { kind: 'prepared', targetPath: resource, mode: 'MODIFY', bytes: 'new' },
      { kind: 'prepared', targetPath: metadata, mode: 'MODIFY', bytes: 'new-meta' },
      { kind: 'prepared', targetPath: marker, mode: 'CREATE', bytes: '{}' },
    ], { validateCommitted() { throw new Error('post-read-fault'); } });
    expect(result).toMatchObject({ ok: false, rolled_back: true });
    expect(readFileSync(join(root, resource), 'utf8')).toBe('old');
    expect(readFileSync(join(root, metadata), 'utf8')).toBe('old-meta');
    expect(existsSync(join(root, marker))).toBe(false);
  });

  it('UT-S39-38: CREATE/MODIFY 前态哈希与无 Git 确定性', () => {
    const before = table([['UT-S10-121', 'old']]);
    const input = {
      change: 'fixture', module: 'core', targets: [
        target('logos/resources/test/a.md', before, table([['UT-S10-121', 'new']])),
        target('logos/resources/test/b.md', null, table([['UT-S10-137', 'new']])),
      ],
    };
    const first = buildTestChangeSet(input);
    const second = buildTestChangeSet(input);
    expect(first).toEqual(second);
    expect(first.targets[0].before_sha256).toBe(createHash('sha256').update(before).digest('hex'));
    expect(first.targets[1].before_sha256).toBeNull();
    expect(first.source).toBe('semantic-before-after-diff');
    const { root, proposalDir } = tempRoot();
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), JSON.stringify({ type: 'no_delta_spec_complete' }));
    expect(readTestChangeSet(root, proposalDir, { change: 'change-set-fixture', module: 'core' }))
      .toMatchObject({ valid: true, value: { changed_test_ids: [], removed_test_ids: [], targets: [] } });
  });

  it('ST-S39-17: 事故 fixture canonical C 精确为六 ID', () => {
    const baseline = [
      ...Array.from({ length: 9 }, (_, index) => `UT-S10-${121 + index}`),
      ...Array.from({ length: 4 }, (_, index) => `ST-S10-${36 + index}`),
    ];
    const before = table(baseline.map(id => [id, id === 'UT-S10-129' ? 'old' : 'same']));
    const finalIds = [...baseline, 'UT-S10-137', 'UT-S10-138', 'UT-S10-139', 'UT-S10-140', 'ST-S10-44'];
    const after = table(finalIds.map(id => [id, id === 'UT-S10-129' ? 'new' : id.startsWith('UT-S10-13') || id === 'ST-S10-44' ? 'added' : 'same']));
    const result = buildTestChangeSet({ change: 'incident', module: 'core', targets: [
      target('logos/resources/test/incident.md', before, after),
    ] });
    expect(result.changed_test_ids).toEqual([
      'ST-S10-44', 'UT-S10-129', 'UT-S10-137', 'UT-S10-138', 'UT-S10-139', 'UT-S10-140',
    ]);
    expect(result.removed_test_ids).toEqual([]);
  });

  it('ST-S39-18: resource、marker 与 post-read fault 均完整回滚并可重试', () => {
    for (const fault of ['logos/resources/test/a.md', 'logos/changes/change-set-fixture/SPEC_MERGED', 'post-read']) {
      const { root, proposalDir } = tempRoot();
      const resource = 'logos/resources/test/a.md';
      const marker = 'logos/changes/change-set-fixture/SPEC_MERGED';
      mkdirSync(dirname(join(root, resource)), { recursive: true });
      writeFileSync(join(root, resource), 'old');
      const inputs = [
        { kind: 'prepared' as const, targetPath: resource, mode: 'MODIFY' as const, bytes: 'new' },
        { kind: 'prepared' as const, targetPath: marker, mode: 'CREATE' as const, bytes: '{}' },
      ];
      const failed = applyBaselineClosureBatch(root, proposalDir, inputs, {
        afterWrite(path) { if (path === fault) throw new Error(fault); },
        validateCommitted() { if (fault === 'post-read') throw new Error(fault); },
      });
      expect(failed).toMatchObject({ ok: false, rolled_back: true });
      expect(readFileSync(join(root, resource), 'utf8')).toBe('old');
      expect(existsSync(join(root, marker))).toBe(false);
      expect(applyBaselineClosureBatch(root, proposalDir, inputs).ok).toBe(true);
    }
  });

  it('ST-S39-19: 重启读取稳定且 marker/target 篡改均 fail-closed', () => {
    const { root, proposalDir } = tempRoot();
    const path = 'logos/resources/test/a.md';
    const after = table([['UT-S10-137', 'after']]);
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), after);
    const changeSet = buildTestChangeSet({ change: 'change-set-fixture', module: 'core', targets: [target(path, null, after)] });
    persist(root, proposalDir, changeSet);
    const first = readTestChangeSet(root, proposalDir, { change: 'change-set-fixture', module: 'core', targetPaths: [path] });
    const second = readTestChangeSet(root, proposalDir, { change: 'change-set-fixture', module: 'core', targetPaths: [path] });
    expect(first).toEqual(second);
    expect(first.valid).toBe(true);
    writeFileSync(join(root, path), `${readFileSync(join(root, path), 'utf8')}tamper`);
    expect(readTestChangeSet(root, proposalDir, { change: 'change-set-fixture', module: 'core' })).toMatchObject({
      valid: false, code: 'test-slice-change-set-target-hash',
    });
    writeFileSync(join(root, path), after);
    const marker = JSON.parse(readFileSync(join(proposalDir, 'SPEC_MERGED'), 'utf8'));
    marker.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`;
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), JSON.stringify(marker));
    expect(readTestChangeSet(root, proposalDir, { change: 'change-set-fixture', module: 'core' })).toMatchObject({
      valid: false, code: 'test-slice-change-set-hash',
    });
  });
});
