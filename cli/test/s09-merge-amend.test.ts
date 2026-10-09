/**
 * S09 已合并提案的增量修正（merge-amend-merged-change，切片 slice-01-merge-amend）。
 *
 * 覆盖 UT-S09-429～UT-S09-447、ST-S09-196、ST-S09-197、ST-S09-199、ST-S09-200、ST-S09-201，
 * 对应功能规格 §2.69.1、§2.69.2、§2.69.4、§2.85.3 与场景 S09「已合并提案的增量修正时序」。
 * 夹具一律为 `mktemp -d` 下 `git init` 的隔离 launched 项目；CLI 用例以真实 `openlogos` 子进程执行。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupFixtureRoots, cli, fixtureRoots, frontierFixture, invoke, put } from './frontier-fixture.js';
import { computeDeltaDigest, readSpecMergedRecord } from '../src/lib/merge-baseline.js';
import { checkMergedProposal, executeAmend } from '../src/lib/merge-amend.js';
import { MergeDirectError, mergeDirect, readMergeFailureStage } from '../src/lib/merge-direct.js';
import { applyBaselineClosureBatch } from '../src/lib/baseline-apply.js';
import { classifyMergeFailureTier, describeMergeFailure, readMergeFailureDiskFacts } from '../src/lib/merge-failure-report.js';
import { composeOpenLogosMarkdown } from '../src/lib/markdown-section-authority.js';
import { runChangeLint } from '../src/lib/change-lint.js';

afterAll(cleanupFixtureRoots);

const REQ = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';
const FEATURE = 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';
const SCENARIO = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md';
const TEST = 'logos/resources/test/core-S01-test-cases.md';
const CREATED = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S02-new.md';
const OTHER = 'logos/resources/prd/2-product-design/1-feature-specs/core-02-other.md';
const MARKERS = ['DEPLOY_DONE', 'SMOKE_FAIL', 'SMOKE_PASS', 'VERIFY_FAIL', 'VERIFY_PASS'];

function sha(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}：${r.stderr}`);
  return r.stdout;
}

function commitAll(root: string, message: string): void {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', message]);
}

type Fixture = ReturnType<typeof frontierFixture>;

function deltaPathOf(target: string): string {
  return target.replace(/^logos\/resources\//, 'deltas/');
}

function writeDelta(f: Fixture, target: string, content: string): void {
  put(f.root, `logos/changes/${f.slug}/${deltaPathOf(target)}`, content);
}

function removeDelta(f: Fixture, target: string): void {
  rmSync(join(f.proposalDir, ...deltaPathOf(target).split('/')));
}

function read(f: Fixture, rel: string): Buffer {
  return readFileSync(join(f.root, ...rel.split('/')));
}

/** 一次性 git 项目：frontier 夹具（四个首次 MODIFY 目标）+ 一个首次 CREATE 场景目标 + 一个未触及的既有文件。 */
function gitFixture(opts: { createTarget?: boolean } = {}): Fixture {
  const f = frontierFixture();
  put(f.root, OTHER, '# 其它\n\n## 一、判据\n\n其它正文。\n');
  if (opts.createTarget !== false) writeDelta(f, CREATED, '## ADDED — 新场景\n\n第一版场景内容。\n');
  git(f.root, ['init', '-q']);
  git(f.root, ['config', 'user.email', 'fixture@example.com']);
  git(f.root, ['config', 'user.name', 'fixture']);
  git(f.root, ['config', 'commit.gpgsign', 'false']);
  commitAll(f.root, 'init');
  return f;
}

function mergeCli(f: Fixture, env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [cli, 'merge', f.slug, '--format', 'json'], {
    cwd: f.root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0', ...env },
  });
  const data = r.status === 0 ? JSON.parse(r.stdout).data : null;
  const lastErr = r.stderr.trim().split('\n').pop() ?? '';
  let error: { code: string; message: string } | null = null;
  if (r.status !== 0) { try { error = JSON.parse(lastErr).error; } catch { error = null; } }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, data, error };
}

/** 首次合并并提交（模拟「merge 后 AI 自动 commit 规格」）。 */
function mergedFixture(opts: { createTarget?: boolean } = {}): Fixture {
  const f = gitFixture(opts);
  const r = mergeCli(f);
  expect(r.status, r.stderr).toBe(0);
  expect(r.data.result).toBe('merged');
  commitAll(f.root, 'merge specs');
  return f;
}

/** 提案目录 + logos/ 下全部常规文件的 SHA-256 快照（排除 git 与 node 产物）。 */
function snapshot(f: Fixture): Map<string, string> {
  const snap = new Map<string, string>();
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs)) {
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else snap.set(childRel, sha(readFileSync(childAbs)));
    }
  };
  walk(join(f.root, 'logos'), 'logos');
  return snap;
}

function expectSnapshotEqual(before: Map<string, string>, after: Map<string, string>, label: string): void {
  expect([...after.keys()].sort(), `${label}：文件集合`).toEqual([...before.keys()].sort());
  for (const [k, v] of before) expect(after.get(k), `${label}：${k}`).toBe(v);
}

function placeMarkers(f: Fixture, names: string[]): Map<string, Buffer> {
  const bytes = new Map<string, Buffer>();
  for (const name of names) {
    const content = Buffer.from(`${name} fixture ${Math.random()}\n`);
    writeFileSync(join(f.proposalDir, name), content);
    bytes.set(name, content);
  }
  return bytes;
}

function marker(f: Fixture): Record<string, any> {
  return JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8'));
}

/** 把 SPEC_MERGED 改写为旧标记（去掉合并基线字段）。 */
function stripBaseline(f: Fixture): void {
  const m = marker(f);
  delete m.merge_baseline;
  delete m.amendments;
  writeFileSync(join(f.proposalDir, 'SPEC_MERGED'), `${JSON.stringify(m, null, 2)}\n`);
}

const TABLE_HEAD = '| 用例ID | 验证目标 |\n|---|---|\n';

/** 在 proposal.md 补「复用测试 ID」小节：删除测试 delta 或进入切片阶段后，L3 证据由复用声明承担。 */
function declareReuse(f: Fixture): void {
  const p = join(f.proposalDir, 'proposal.md');
  writeFileSync(p, readFileSync(p, 'utf8').replace('## 决策澄清', '## 复用测试 ID\n\n- UT-S01-01 — 回归覆盖\n\n## 决策澄清'));
}

function idRows(ids: string[], suffix: (id: string) => string): string {
  return ids.map(id => `| ${id} | ${suffix(id)} |`).join('\n');
}

const THIRTY = Array.from({ length: 27 }, (_, i) => `UT-S01-${String(i + 1).padStart(2, '0')}`);

describe('S09 已合并提案的增量修正 — 合并基线与幂等', () => {
  it('UT-S09-429: 首次合并写入逐目标合并基线', () => {
    const f = gitFixture();
    const before = new Map([REQ, FEATURE, SCENARIO, TEST].map(t => [t, read(f, t)]));
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    const m = marker(f);
    const b = m.merge_baseline;
    expect(b.schema).toBe('openlogos/merge-baseline@1');
    expect(b.delta_digest).toBe(computeDeltaDigest(f.proposalDir));
    expect(r.data.delta_digest).toBe(b.delta_digest);
    const paths = b.targets.map((t: any) => t.path);
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual([...[REQ, FEATURE, SCENARIO, TEST, CREATED]].sort());
    for (const t of b.targets) {
      expect(t.after_sha256, t.path).toBe(sha(read(f, t.path)));
      if (t.path === CREATED) {
        expect(t.mode).toBe('CREATE');
        expect(t.before).toBeNull();
        continue;
      }
      expect(t.mode).toBe('MODIFY');
      expect(t.before.sha256).toBe(sha(before.get(t.path)!));
      const blob = spawnSync('git', ['cat-file', 'blob', t.before.git_blob], { cwd: f.root });
      expect(Buffer.compare(blob.stdout, before.get(t.path)!), t.path).toBe(0);
    }
    expect(m.amendments).toEqual([]);
    expect(m.test_change_set.changed_test_ids).toContain('UT-S01-01');
    expect(m.type).toBe('merge_complete');
  });

  it('UT-S09-430: 合并前工作区脏时基线为真实 before', () => {
    const f = gitFixture();
    const head = git(f.root, ['rev-parse', 'HEAD']);
    const dirty = `${read(f, REQ).toString('utf8')}\n## 附录\n\n未提交的脏改动。\n`;
    writeFileSync(join(f.root, ...REQ.split('/')), dirty);
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    const entry = marker(f).merge_baseline.targets.find((t: any) => t.path === REQ);
    const headBytes = spawnSync('git', ['show', `HEAD:${REQ}`], { cwd: f.root }).stdout;
    expect(entry.before.sha256).toBe(sha(dirty));
    expect(entry.before.sha256).not.toBe(sha(headBytes));
    const blob = spawnSync('git', ['cat-file', 'blob', entry.before.git_blob], { cwd: f.root }).stdout;
    expect(blob.toString('utf8')).toBe(dirty);
    expect(git(f.root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: f.root }).status, '索引不得被改动').toBe(0);
  });

  it('UT-S09-431: delta 摘要算法确定性', () => {
    const mk = () => { const d = mkdtempSync(join(tmpdir(), 'openlogos-digest-')); fixtureRoots.push(d); return d; };
    const files: Array<[string, string]> = [
      ['deltas/test/b.md', 'B\n'], ['deltas/prd/a.md', 'A\n'], ['deltas/prd/sub/Z.md', 'Z\n'], ['deltas/prd/sub/a.md', 'a\n'],
    ];
    const p1 = mk();
    for (const [rel, c] of files) put(p1, rel, c);
    const p2 = mk();
    for (const [rel, c] of [...files].reverse()) put(p2, rel, c);
    const d1 = computeDeltaDigest(p1);
    expect(computeDeltaDigest(p2)).toBe(d1);
    // 按 §2.69.4.1 手算参考值
    const sorted = files.map(([rel, c]) => [rel.slice('deltas/'.length), c] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const h = createHash('sha256');
    for (const [rel, c] of sorted) h.update(`${rel}\0${sha(c)}\n`);
    expect(d1).toBe(`sha256:${h.digest('hex')}`);
    put(p1, 'deltas/prd/.gitkeep', '');
    expect(computeDeltaDigest(p1), '.gitkeep 不计入').toBe(d1);
    put(p1, 'deltas/prd/a.md', 'A!\n');
    expect(computeDeltaDigest(p1), '改一个字节').not.toBe(d1);
    const empty = mk();
    mkdirSync(join(empty, 'deltas'));
    expect(computeDeltaDigest(empty)).toBe(`sha256:${sha('')}`);

    // code-r1 F1：merge 实际消费的合法 symlink delta 必须计入摘要，内容取实际消费字节
    const linked = mk();
    put(linked, 'sources/t.md', 'v1\n');
    mkdirSync(join(linked, 'deltas', 'test'), { recursive: true });
    symlinkSync(join(linked, 'sources', 't.md'), join(linked, 'deltas', 'test', 't.md'));
    const l1 = computeDeltaDigest(linked);
    expect(l1, '合法文件 symlink 不得被排除').not.toBe(`sha256:${sha('')}`);
    put(linked, 'sources/t.md', 'v2\n');
    expect(computeDeltaDigest(linked), '文件 symlink 目标内容变化').not.toBe(l1);
    const viaDir = mk();
    put(viaDir, 'sources/prd/a.md', 'a1\n');
    mkdirSync(join(viaDir, 'deltas'), { recursive: true });
    symlinkSync(join(viaDir, 'sources', 'prd'), join(viaDir, 'deltas', 'prd'));
    const d1v = computeDeltaDigest(viaDir);
    expect(d1v, '目录 symlink 内的文件计入').not.toBe(`sha256:${sha('')}`);
    put(viaDir, 'sources/prd/a.md', 'a2\n');
    expect(computeDeltaDigest(viaDir), '目录 symlink 内容变化').not.toBe(d1v);
    // 逃逸 / 断链 symlink：不解引用，但以链接身份计入——变化可见，不被误报为已应用
    const odd = mk();
    const outside = mk();
    put(outside, 'x.md', 'outside\n');
    mkdirSync(join(odd, 'deltas', 'test'), { recursive: true });
    symlinkSync(join(outside, 'x.md'), join(odd, 'deltas', 'test', 'escape.md'));
    const e1 = computeDeltaDigest(odd);
    expect(e1).not.toBe(`sha256:${sha('')}`);
    symlinkSync(join(odd, 'missing.md'), join(odd, 'deltas', 'test', 'broken.md'));
    const e2 = computeDeltaDigest(odd);
    expect(e2, '新增断链 symlink 改变摘要').not.toBe(e1);
    put(outside, 'x.md', 'outside changed\n');
    expect(computeDeltaDigest(odd), '逃逸目标内容不被读取').toBe(e2);
  });

  it('UT-S09-432: delta 未变时幂等返回 already-merged', () => {
    const f = mergedFixture();
    placeMarkers(f, ['VERIFY_PASS', 'DEPLOY_DONE']);
    const tasksBefore = readFileSync(join(f.proposalDir, 'tasks.md'));
    const snap = snapshot(f);
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.result).toBe('already-merged');
    expect(r.data.targets).toEqual([]);
    expect(r.data.target_count).toBe(0);
    expect(r.data.invalidated_markers).toEqual([]);
    expectSnapshotEqual(snap, snapshot(f), '幂等');
    expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(true);
    expect(existsSync(join(f.proposalDir, 'DEPLOY_DONE'))).toBe(true);
    expect(readFileSync(join(f.proposalDir, 'tasks.md')).equals(tasksBefore)).toBe(true);

    // code-r1 F1：测试 delta 为指向提案目录内文件的合法 symlink——未变时幂等，目标内容变化后必须重合成
    const g = gitFixture();
    const source = join(g.proposalDir, 'sources', 'core-S01-test-cases.md');
    put(g.root, `logos/changes/${g.slug}/sources/core-S01-test-cases.md`, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 经 symlink 的定义 |\n`);
    const deltaAbs = join(g.proposalDir, 'deltas', 'test', 'core-S01-test-cases.md');
    rmSync(deltaAbs);
    symlinkSync(source, deltaAbs);
    commitAll(g.root, 'symlink delta');
    expect(mergeCli(g).data.result).toBe('merged');
    commitAll(g.root, 'merge');
    placeMarkers(g, ['VERIFY_PASS']);
    expect(mergeCli(g).data.result, '未变时幂等').toBe('already-merged');
    writeFileSync(source, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 经 symlink 修正后的定义 |\n`);
    const amended = mergeCli(g);
    expect(amended.status, amended.stderr).toBe(0);
    expect(amended.data.result, 'symlink 目标内容变化不得被判 already-merged').toBe('amended');
    expect(read(g, TEST).toString('utf8')).toContain('经 symlink 修正后的定义');
    expect(amended.data.invalidated_markers).toEqual(['VERIFY_PASS']);
  });
});

describe('S09 已合并提案的增量修正 — 目标集三类与测试变更集', () => {
  it('UT-S09-433: 重修从合并基线合成，不重复追加、可撤回上一轮内容', () => {
    const f = gitFixture();
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n写错的正文。\n\n## ADDED — 新增小节\n\n第一版新增。\n');
    commitAll(f.root, 'delta v1');
    const featureBefore = read(f, FEATURE).toString('utf8');
    expect(mergeCli(f).status).toBe(0);
    commitAll(f.root, 'merge');
    const delta2 = '## MODIFIED — 一、判据\n\n修正后的正文。\n\n## ADDED — 新增小节\n\n第二版新增。\n';
    writeDelta(f, FEATURE, delta2);
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.result).toBe('amended');
    const after = read(f, FEATURE).toString('utf8');
    expect(after.split('## 新增小节').length - 1, 'ADDED 章节恰出现一次').toBe(1);
    expect(after).toContain('第二版新增。');
    expect(after).not.toContain('第一版新增。');
    expect(after).toContain('修正后的正文。');
    expect(after).not.toContain('写错的正文。');
    expect(after).toBe(composeOpenLogosMarkdown(featureBefore, delta2, 'MODIFY'));
  });

  it('UT-S09-434: 测试变更集按合并前到修正后整体重算（事故复刻）', () => {
    const v1 = idRows(THIRTY, id => (id === 'UT-S01-01' ? '新定义' : `新增 ${id}`));
    const round = (f: Fixture, body: string) => writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}${body}\n`);
    const v2 = v1.replace('新增 UT-S01-02', '改述 UT-S01-02').replace('新增 UT-S01-03', '改述 UT-S01-03');

    // 新实现：同一条 merge 增量修正
    const f = gitFixture();
    round(f, v1);
    const counts: number[] = [];
    expect(mergeCli(f).status).toBe(0);
    counts.push(marker(f).test_change_set.changed_test_ids.length);
    commitAll(f.root, 'r1');
    round(f, v2);
    expect(mergeCli(f).data.result).toBe('amended');
    counts.push(marker(f).test_change_set.changed_test_ids.length);
    commitAll(f.root, 'r2');
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n第三轮只改功能规格。\n');
    expect(mergeCli(f).data.result).toBe('amended');
    counts.push(marker(f).test_change_set.changed_test_ids.length);
    expect(counts).toEqual([27, 27, 27]);
    expect(marker(f).test_change_set.changed_test_ids).toEqual([...THIRTY].sort());

    // 旧实现对照（删标记后首次合并路径重合并）：逐轮缩小——证明本用例对旧实现必红
    const g = gitFixture({ createTarget: false });
    round(g, v1);
    const old: number[] = [];
    mergeDirect(g.root, g.proposalDir, g.slug);
    old.push(marker(g).test_change_set.changed_test_ids.length);
    rmSync(join(g.proposalDir, 'SPEC_MERGED'));
    round(g, v2);
    mergeDirect(g.root, g.proposalDir, g.slug);
    old.push(marker(g).test_change_set.changed_test_ids.length);
    rmSync(join(g.proposalDir, 'SPEC_MERGED'));
    writeDelta(g, FEATURE, '## MODIFIED — 一、判据\n\n第三轮只改功能规格。\n');
    mergeDirect(g.root, g.proposalDir, g.slug);
    old.push(marker(g).test_change_set.changed_test_ids.length);
    expect(old).toEqual([27, 2, 0]);
  });

  it('UT-S09-435: 首次 CREATE 目标重修通过', () => {
    const f = mergedFixture();
    const yamlBefore = read(f, 'logos/logos-project.yaml');
    const delta = '## ADDED — 新场景\n\n第二版场景内容。\n';
    writeDelta(f, CREATED, delta);
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.result).toBe('amended');
    expect(r.data.amend.targets_recomposed).toContain(CREATED);
    expect(read(f, CREATED).toString('utf8')).toBe(composeOpenLogosMarkdown('', delta, 'CREATE'));
    expect(read(f, 'logos/logos-project.yaml').equals(yamlBefore), 'resource_index 不重复登记').toBe(true);
    expect(read(f, 'logos/logos-project.yaml').toString('utf8').split(CREATED).length - 1).toBe(1);
    const entry = marker(f).merge_baseline.targets.find((t: any) => t.path === CREATED);
    expect(entry.mode).toBe('CREATE');
    expect(entry.before).toBeNull();
  });

  it('UT-S09-436: 新增目标以当前主文档为起点并采集基线', () => {
    const f = mergedFixture();
    const otherBefore = read(f, OTHER).toString('utf8');
    const before = marker(f).merge_baseline.targets;
    const delta = '## MODIFIED — 一、判据\n\n其它的新正文。\n';
    writeDelta(f, OTHER, delta);
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.amend.targets_added).toEqual([OTHER]);
    expect(read(f, OTHER).toString('utf8')).toBe(composeOpenLogosMarkdown(otherBefore, delta, 'MODIFY'));
    const targets = marker(f).merge_baseline.targets;
    const added = targets.find((t: any) => t.path === OTHER);
    expect(added.mode).toBe('MODIFY');
    expect(added.before.sha256).toBe(sha(otherBefore));
    expect(spawnSync('git', ['cat-file', 'blob', added.before.git_blob], { cwd: f.root }).stdout.toString('utf8')).toBe(otherBefore);
    for (const old of before) {
      const now = targets.find((t: any) => t.path === old.path);
      expect(now.mode, old.path).toBe(old.mode);
      expect(now.before, old.path).toEqual(old.before);
    }
  });

  it('UT-S09-437: 撤回首次 MODIFY 目标恢复为合并前字节', () => {
    const f = gitFixture();
    const featureBefore = read(f, FEATURE);
    const testBefore = read(f, TEST);
    expect(mergeCli(f).status).toBe(0);
    commitAll(f.root, 'merge');
    declareReuse(f);
    removeDelta(f, FEATURE);
    removeDelta(f, TEST);
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.amend.targets_restored).toEqual([FEATURE, TEST].sort());
    expect(read(f, FEATURE).equals(featureBefore)).toBe(true);
    expect(read(f, TEST).equals(testBefore)).toBe(true);
    const paths = marker(f).merge_baseline.targets.map((t: any) => t.path);
    expect(paths).not.toContain(FEATURE);
    expect(paths).not.toContain(TEST);
    expect(marker(f).test_change_set.changed_test_ids).not.toContain('UT-S01-01');
  });
});

describe('S09 已合并提案的增量修正 — 拒绝边界（写入前、零副作用）', () => {
  it('UT-S09-438: 撤回首次 CREATE 目标写入前拒绝且零写入', () => {
    const f = mergedFixture();
    placeMarkers(f, ['VERIFY_PASS']);
    removeDelta(f, CREATED);
    const snap = snapshot(f);
    const r = mergeCli(f);
    expect(r.status).not.toBe(0);
    expect(r.error?.code).toBe('MERGE_AMEND_CREATE_WITHDRAW');
    expect(r.error?.message).toContain(CREATED);
    expect(r.error?.message).toContain('另立新提案');
    expectSnapshotEqual(snap, snapshot(f), 'CREATE 撤回');
    expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(true);
  });

  it('UT-S09-439: 旧标记一律拒绝而非回推', () => {
    // PATH 首位的 git 包装器记录全部调用参数，证明拒绝路径不读取 git 历史
    const binDir = mkdtempSync(join(tmpdir(), 'openlogos-gitwrap-'));
    fixtureRoots.push(binDir);
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    const log = join(binDir, 'calls.log');
    writeFileSync(join(binDir, 'git'), `#!/bin/sh\necho "$@" >> "${log}"\nexec "${realGit}" "$@"\n`);
    chmodSync(join(binDir, 'git'), 0o755);

    const arms: Array<[string, () => Fixture]> = [
      ['① 规格先提交、标记后单独提交', () => {
        const f = gitFixture();
        expect(mergeCli(f).status).toBe(0);
        git(f.root, ['add', 'logos/resources']);
        git(f.root, ['commit', '-q', '-m', 'specs']);
        stripBaseline(f);
        commitAll(f.root, 'marker');
        return f;
      }],
      ['② 合并前工作区脏、合并后一起提交', () => {
        const f = gitFixture();
        writeFileSync(join(f.root, ...REQ.split('/')), `${read(f, REQ)}\n## 附录\n\n脏改动。\n`);
        expect(mergeCli(f).status).toBe(0);
        stripBaseline(f);
        commitAll(f.root, 'merge');
        return f;
      }],
      ['③ 曾删标记重合并', () => {
        const f = gitFixture({ createTarget: false });
        expect(mergeCli(f).status).toBe(0);
        commitAll(f.root, 'merge1');
        rmSync(join(f.proposalDir, 'SPEC_MERGED'));
        writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n第二次合并的正文。\n');
        expect(mergeCli(f).status).toBe(0);
        stripBaseline(f);
        commitAll(f.root, 'merge2');
        return f;
      }],
      ['④ legacy MERGED', () => {
        const f = gitFixture();
        writeFileSync(join(f.proposalDir, 'MERGED'), '');
        commitAll(f.root, 'legacy');
        return f;
      }],
    ];
    for (const [label, build] of arms) {
      const f = build();
      writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
      const snap = snapshot(f);
      rmSync(log, { force: true });
      const r = mergeCli(f, { PATH: `${binDir}:${process.env.PATH}` });
      expect(r.status, label).not.toBe(0);
      expect(r.error?.code, label).toBe('MERGE_AMEND_BASELINE_MISSING');
      expect(r.error?.message, label).toContain('不从 git 历史回推');
      expect(r.error?.message, label).toContain('另立新提案');
      const calls = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
      for (const call of calls) {
        expect(['log', 'rev-list', 'show'].includes(call.split(' ')[0]), `${label}：不得读取 git 历史（${call}）`).toBe(false);
      }
      expectSnapshotEqual(snap, snapshot(f), label);
    }
  });

  it('UT-S09-440: 合并基线不可读或不匹配时拒绝', () => {
    const arms: Array<[string, (f: Fixture) => void]> = [
      ['① git_blob 为 null', (f) => {
        const m = marker(f);
        m.merge_baseline.targets.find((t: any) => t.path === REQ).before.git_blob = null;
        writeFileSync(join(f.proposalDir, 'SPEC_MERGED'), `${JSON.stringify(m, null, 2)}\n`);
      }],
      ['② blob 对象已被清理', (f) => {
        // 夹具的合并前字节为未提交的脏内容：其 blob 只以松散对象存在、不被任何提交引用，删除即模拟被清理
        const id = marker(f).merge_baseline.targets.find((t: any) => t.path === REQ).before.git_blob as string;
        rmSync(join(f.root, '.git', 'objects', id.slice(0, 2), id.slice(2)));
        expect(spawnSync('git', ['cat-file', '-e', id], { cwd: f.root }).status, '前置：对象已不可读').not.toBe(0);
      }],
      ['③ before.sha256 不匹配', (f) => {
        const m = marker(f);
        m.merge_baseline.targets.find((t: any) => t.path === REQ).before.sha256 = 'f'.repeat(64);
        writeFileSync(join(f.proposalDir, 'SPEC_MERGED'), `${JSON.stringify(m, null, 2)}\n`);
      }],
    ];
    for (const [label, corrupt] of arms) {
      const f = gitFixture();
      writeFileSync(join(f.root, ...REQ.split('/')), `${read(f, REQ)}\n## 附录\n\n合并前未提交的内容（${label}）。\n`);
      expect(mergeCli(f).status).toBe(0);
      commitAll(f.root, 'merge');
      corrupt(f);
      writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
      const snap = snapshot(f);
      const r = mergeCli(f);
      expect(r.status, label).not.toBe(0);
      expect(r.error?.code, label).toBe('MERGE_AMEND_BASELINE_UNREADABLE');
      expect(r.error?.message, label).toContain(REQ);
      expectSnapshotEqual(snap, snapshot(f), label);
    }
  });

  it('UT-S09-441: 主文档漂移时拒绝', () => {
    const f = mergedFixture();
    writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
    writeFileSync(join(f.root, ...REQ.split('/')), `${read(f, REQ)}手工改动一行。\n`);
    const snap = snapshot(f);
    const r = mergeCli(f);
    expect(r.status).not.toBe(0);
    expect(r.error?.code).toBe('MERGE_AMEND_DRIFT');
    expect(r.error?.message).toContain(REQ);
    expect(r.error?.message).toContain('不做三方合并');
    expectSnapshotEqual(snap, snapshot(f), '漂移');
  });

  it('UT-S09-442: 原型资产变化时拒绝', () => {
    const html = '<!doctype html><title>原型</title>\n';
    const protoDir = (f: Fixture) => join(f.proposalDir, 'deltas', 'prd', '2-product-design', '2-page-design');
    const withPrototypes = (): Fixture => {
      const f = gitFixture();
      for (const name of ['core-01-home.html', 'core-02-list.html']) {
        put(f.root, `logos/changes/${f.slug}/deltas/prd/2-product-design/2-page-design/${name}`, html);
        put(f.root, `logos/resources/prd/2-product-design/2-page-design/${name}`, html);
      }
      commitAll(f.root, 'prototype');
      expect(mergeCli(f).status).toBe(0);
      commitAll(f.root, 'merge');
      return f;
    };
    // code-r1 F2：修改、删除一份、删除整个原型目录、新增一份——均为变化，写入与清除验收事实之前拒绝
    const arms: Array<[string, (f: Fixture) => void]> = [
      ['修改原型', f => writeFileSync(join(protoDir(f), 'core-01-home.html'), `${html}<p>改版</p>\n`)],
      ['删除一份旧原型', f => rmSync(join(protoDir(f), 'core-02-list.html'))],
      ['删除整个原型目录', f => rmSync(protoDir(f), { recursive: true })],
      ['新增原型', f => writeFileSync(join(protoDir(f), 'core-03-new.html'), html)],
    ];
    for (const [label, mutate] of arms) {
      const f = withPrototypes();
      placeMarkers(f, ['VERIFY_PASS']);
      mutate(f);
      const snap = snapshot(f);
      const r = mergeCli(f);
      expect(r.status, label).not.toBe(0);
      expect(r.error?.code, label).toBe('MERGE_AMEND_PROTOTYPE_UNSUPPORTED');
      expectSnapshotEqual(snap, snapshot(f), label);
      expect(existsSync(join(f.proposalDir, 'VERIFY_PASS')), label).toBe(true);
    }
    // 原型未变、只改文档：照常修正
    const ok = withPrototypes();
    writeDelta(ok, FEATURE, '## MODIFIED — 一、判据\n\n只改文档。\n');
    const r = mergeCli(ok);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.result).toBe('amended');
  });
});

describe('S09 已合并提案的增量修正 — 待应用修正准入与 change-lint 同判', () => {
  it('UT-S09-443: 修正待应用时 change-lint 与 merge 同判', () => {
    // code-r1 F3：首次合并沿用 §2.73 警告口径（零回归对照）；修正待应用时条目丢失同判拒绝
    const lost = `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-99 | 换掉了既有 ID |\n`;
    {
      const g = gitFixture();
      writeDelta(g, TEST, lost);
      const pre = runChangeLint(g.root, g.proposalDir, g.slug);
      expect(pre.ok && pre.warnings.map(w => w.code), '首次合并：§2.73 警告').toContain('delta_implicit_id_removal');
      expect(pre.ok && pre.violations.map(v => v.code), '首次合并：不升为违规').not.toContain('delta_implicit_id_removal');
    }
    // 三臂均为违规级：lint 报码、merge 以准入拒绝出口拒绝，目标字节与验收标记零变化
    const arms: Array<[string, string, string, string]> = [
      ['① 条目丢失', TEST, lost, 'delta_implicit_id_removal'],
      ['② 重复测试 ID', TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 新定义 |\n\n## ADDED — 二、补充\n\n${TABLE_HEAD}| UT-S01-01 | 重复 |\n`, 'delta_test_id_duplicate'],
      ['③ 非法整文件封装', CREATED, `## MODIFIED — ${CREATED}（整文件替换）\n# 新场景\n\n内容。\n`, 'non_markdown_delta_invalid'],
    ];
    for (const [label, target, content, code] of arms) {
      const f = mergedFixture();
      placeMarkers(f, ['VERIFY_PASS']);
      writeDelta(f, target, content);
      const snap = snapshot(f);
      const lint = runChangeLint(f.root, f.proposalDir, f.slug);
      expect(lint.ok && lint.violations.map(v => v.code), label).toContain(code);
      const r = mergeCli(f);
      expect(r.status, label).not.toBe(0);
      expect(r.error?.code, label).toBe('MERGE_ADMISSION_REJECTED');
      expect(r.stderr, label).toContain(code);
      expectSnapshotEqual(snap, snapshot(f), label);
      expect(existsSync(join(f.proposalDir, 'VERIFY_PASS')), label).toBe(true);
    }
  });

  it('UT-S09-444: 合法修正同判通过与摘要相同不重放', () => {
    const f = mergedFixture();
    writeDelta(f, CREATED, '## ADDED — 新场景\n\n合法重修。\n');
    const lint = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(lint.ok && lint.violations).toEqual([]);
    expect(mergeCli(f).data.result).toBe('amended');

    // 摘要相同：lint 结论与「无基线（旧语义：合并完成后不重放）」逐字一致
    const g = mergedFixture();
    const strip = (x: ReturnType<typeof runChangeLint>) => (x.ok ? { v: x.violations, w: x.warnings, c: x.checks } : x);
    const withBaseline = strip(runChangeLint(g.root, g.proposalDir, g.slug));
    stripBaseline(g);
    const frozen = strip(runChangeLint(g.root, g.proposalDir, g.slug));
    expect(withBaseline).toEqual(frozen);
  });
});

describe('S09 已合并提案的增量修正 — 验收事实失效与分档恢复', () => {
  const CODE = '## [code] 代码实现\n\n- [x] 切片1：已完成部分（覆盖 UT-S01-01）\n- [ ] 切片2：未完成部分（覆盖 UT-S01-01）\n';

  function withCode(f: Fixture): void {
    const tasks = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf8').replace(/## \[code\] 代码实现\n?/, CODE);
    writeFileSync(join(f.proposalDir, 'tasks.md'), tasks);
  }

  it('UT-S09-445: 增量修正清除验收与交付事实且不重置 [code]', () => {
    const arms: Array<[string, (f: Fixture) => void, boolean]> = [
      ['① 单切片改测试 delta', f => writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 再修定义 |\n`), false],
      ['② 只改功能规格', f => writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n只改业务规格。\n'), false],
      ['③ 多切片改测试 delta', f => writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 多切片再修 |\n| UT-S01-02 | 第二个用例 |\n`), true],
    ];
    for (const [label, change, multi] of arms) {
      let f: Fixture;
      let manifest = '';
      if (multi) {
        // 多切片：两个测试 ID 分属两片，经真实 slice plan 生成 [code] 与 TEST_SLICE_MANIFEST.json
        f = gitFixture();
        writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 新定义 |\n| UT-S01-02 | 第二个用例 |\n`);
        expect(mergeCli(f).status).toBe(0);
        writeFileSync(join(f.proposalDir, 'slices.json'), JSON.stringify({ slices: [
          { slice_id: 'slice-01-a', task_text: '切片1（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [TEST] },
          { slice_id: 'slice-02-b', task_text: '切片2（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [TEST] },
        ] }));
        const planned = invoke(['slice', 'plan', '--file', `logos/changes/${f.slug}/slices.json`], f.root);
        expect(planned.status, planned.stderr).toBe(0);
        writeFileSync(join(f.proposalDir, 'SLICES_APPROVED'), 'approved\n');
        manifest = readFileSync(join(f.proposalDir, 'TEST_SLICE_MANIFEST.json'), 'utf8');
        commitAll(f.root, 'slices');
      } else {
        f = mergedFixture();
        withCode(f);
      }
      placeMarkers(f, MARKERS);
      const tasks = readFileSync(join(f.proposalDir, 'tasks.md'));
      change(f);
      const r = mergeCli(f);
      expect(r.status, `${label}：${r.stderr}`).toBe(0);
      expect(r.data.result, label).toBe('amended');
      expect(r.data.invalidated_markers, label).toEqual(MARKERS);
      for (const name of MARKERS) expect(existsSync(join(f.proposalDir, name)), `${label}：${name}`).toBe(false);
      expect(readFileSync(join(f.proposalDir, 'tasks.md')).equals(tasks), `${label}：[code] 不被重置`).toBe(true);
      if (multi) {
        expect(readFileSync(join(f.proposalDir, 'SLICES_APPROVED'), 'utf8')).toBe('approved\n');
        expect(readFileSync(join(f.proposalDir, 'TEST_SLICE_MANIFEST.json'), 'utf8')).toBe(manifest);
      }
      const last = marker(f).amendments.at(-1);
      expect(last.invalidated_markers, label).toEqual(MARKERS);
    }
  });

  /** 在已合并夹具上准备一次增量修正（lib 级，供故障注入）。 */
  function preparedAmend() {
    const f = mergedFixture();
    const markers = placeMarkers(f, ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS']);
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n故障注入下的修正。\n');
    writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n场景也修正。\n');
    const check = checkMergedProposal(f.root, f.proposalDir);
    if (check.kind !== 'amend') throw new Error('前置：应进入增量修正');
    return { f, markers, plan: check.plan, resources: snapshot(f) };
  }

  function catchAmend(run: () => unknown): Error {
    try { run(); } catch (e) { return e as Error; }
    throw new Error('预期失败但成功');
  }

  afterEach(() => {
    delete process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    delete process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL;
  });

  it('UT-S09-446: 已确认旧规格时恢复被清除的事实（档 A / 档 B）', () => {
    // ① 回滚成功（rolled_back:true）→ 档 B，标记逐字节恢复
    {
      const { f, markers, plan, resources } = preparedAmend();
      process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = SCENARIO;
      const err = catchAmend(() => executeAmend(f.root, f.proposalDir, f.slug, plan));
      delete process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
      expect((err as MergeDirectError).code).toBe('MERGE_APPLY_FAILED');
      expect(readMergeFailureStage(err)).toBe('apply-rolled-back');
      expect(classifyMergeFailureTier(err, readMergeFailureDiskFacts(f.proposalDir))).toBe('B');
      expectSnapshotEqual(resources, snapshot(f), '臂①');
      for (const [name, bytes] of markers) expect(readFileSync(join(f.proposalDir, name)).equals(bytes), name).toBe(true);
    }
    // ② 同 ① 但标记恢复写入失败 → 点名未恢复的标记、提示重新 verify，主文档仍为修正前字节
    {
      const { f, plan, resources } = preparedAmend();
      process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = SCENARIO;
      const err = catchAmend(() => executeAmend(f.root, f.proposalDir, f.slug, plan, {
        restoreMarker: () => { throw new Error('restore fault'); },
      }));
      delete process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
      expect(classifyMergeFailureTier(err, readMergeFailureDiskFacts(f.proposalDir))).toBe('B');
      expect(err.message).toContain('恢复失败');
      expect(err.message).toContain('VERIFY_PASS');
      expect(err.message).toContain('重新 verify');
      for (const rel of [REQ, FEATURE, SCENARIO, TEST]) expect(snapshot(f).get(rel), rel).toBe(resources.get(rel));
    }
    // ③ 标记清除阶段在删除第二个标记时失败（尚未调用落盘原语）→ 档 A，已删标记按备份恢复
    {
      const { f, markers, plan, resources } = preparedAmend();
      let calls = 0;
      const err = catchAmend(() => executeAmend(f.root, f.proposalDir, f.slug, plan, {
        removeMarker: (abs) => { calls += 1; if (calls === 2) throw new Error('unlink fault'); rmSync(abs); },
      }));
      expect(readMergeFailureStage(err)).toBe('prepare');
      expect(classifyMergeFailureTier(err, readMergeFailureDiskFacts(f.proposalDir))).toBe('A');
      expectSnapshotEqual(resources, snapshot(f), '臂③');
      for (const [name, bytes] of markers) expect(readFileSync(join(f.proposalDir, name)).equals(bytes), name).toBe(true);
    }
  });

  it('UT-S09-447: 回滚未确认时不恢复旧验收事实（档 C）', () => {
    const arms: Array<[string, (f: Fixture, plan: any) => Error]> = [
      ['① 已提交后清理失败、恢复判为 committed', (f, plan) => catchAmend(() => executeAmend(f.root, f.proposalDir, f.slug, plan, {
        apply: (root, dir, inputs, hook) => {
          const real = applyBaselineClosureBatch(root, dir, inputs, hook);
          return real.ok ? { ok: false, error: 'test: committed 后清理首次失败，恢复判为 committed', rolled_back: false } : real;
        },
      }))],
      ['② 中途写入失败且回滚未完成', (f, plan) => catchAmend(() => executeAmend(f.root, f.proposalDir, f.slug, plan, {
        apply: (root, _dir, inputs) => {
          const first = inputs[0] as { targetPath: string; bytes: Buffer };
          writeFileSync(join(root, ...first.targetPath.split('/')), first.bytes);
          return { ok: false, error: 'test: backup 不可用，整批回滚未完成', rolled_back: false };
        },
      }))],
      ['③ 原语抛错逃逸', (f, plan) => {
        process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL = '1';
        try { return catchAmend(() => executeAmend(f.root, f.proposalDir, f.slug, plan)); }
        finally { delete process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL; }
      }],
    ];
    for (const [label, run] of arms) {
      const { f, plan } = preparedAmend();
      const err = run(f, plan);
      expect(readMergeFailureStage(err), label).toBe('apply-unconfirmed');
      expect(classifyMergeFailureTier(err, readMergeFailureDiskFacts(f.proposalDir)), label).toBe('C');
      const lines = describeMergeFailure(f.proposalDir, f.slug, err).lines.join('\n');
      expect(lines, label).not.toContain('保持合并前字节');
      expect(lines, label).not.toContain('已整批回滚');
      expect(lines, label).not.toContain('已按备份恢复');
      expect(lines, label).toContain('可能已是修正后字节');
      expect(lines, label).toContain('git status');
      for (const name of ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS']) {
        expect(existsSync(join(f.proposalDir, name)), `${label}：${name} 不得恢复`).toBe(false);
      }
      if (label.startsWith('①')) {
        expect(read(f, FEATURE).toString('utf8')).toContain('故障注入下的修正。');
        expect(marker(f).amendments.length).toBe(1);
      }
      const archived = invoke(['archive', f.slug], f.root);
      expect(archived.status, label).not.toBe(0);
      expect(archived.stderr, label).toContain('ARCHIVE_VERIFY_NOT_PASSED');
      expect(existsSync(f.proposalDir), `${label}：提案目录未移动`).toBe(true);
    }
  });
});

describe('S09 已合并提案的增量修正 — 场景测试', () => {
  it('ST-S09-196: 事故复刻端到端：合并、提交、多轮修正后切片可重建', () => {
    const f = gitFixture();
    writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}${idRows(THIRTY, id => `新增 ${id}`)}\n`);
    expect(mergeCli(f).status).toBe(0);
    commitAll(f.root, 'r1');
    const slices = {
      slices: [
        { slice_id: 'slice-01-a', task_text: `切片1（覆盖 ${THIRTY.slice(0, 14).join('、')}）`, owned_test_ids: THIRTY.slice(0, 14), runner_selectors: THIRTY.slice(0, 14), spec_targets: [TEST] },
        { slice_id: 'slice-02-b', task_text: `切片2（覆盖 ${THIRTY.slice(14).join('、')}）`, owned_test_ids: THIRTY.slice(14), runner_selectors: THIRTY.slice(14), spec_targets: [TEST] },
      ],
    };
    writeFileSync(join(f.proposalDir, 'slices.json'), JSON.stringify(slices));
    const planned = invoke(['slice', 'plan', '--file', `logos/changes/${f.slug}/slices.json`], f.root);
    expect(planned.status, planned.stderr).toBe(0);
    commitAll(f.root, 'slices');
    // ③④ 改 2 个 ID 的描述 → lint → 增量修正
    writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}${idRows(THIRTY, id => (id === 'UT-S01-02' || id === 'UT-S01-03' ? `改述 ${id}` : `新增 ${id}`))}\n`);
    const lint = invoke(['change-lint', '--format', 'json'], f.root);
    expect(JSON.parse(lint.stdout).data.pass, lint.stdout).toBe(true);
    const r2 = mergeCli(f);
    expect(r2.data.result).toBe('amended');
    expect(r2.data.test_change_set.changed_test_ids).toEqual([...THIRTY].sort());
    commitAll(f.root, 'r2');
    // ⑤ 只改功能规格的再一轮
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n再一轮。\n');
    const r3 = mergeCli(f);
    expect(r3.data.result).toBe('amended');
    expect(r3.data.test_change_set.changed_test_ids.length).toBe(27);
    // ⑥ 重建清单；⑦ lint 无 manifest 违规
    const replanned = invoke(['slice', 'plan', '--file', `logos/changes/${f.slug}/slices.json`], f.root);
    expect(replanned.status, replanned.stderr).toBe(0);
    expect(replanned.stderr).not.toContain('test-slice-test-id-unknown');
    const lint2 = invoke(['change-lint', '--format', 'json'], f.root);
    expect(lint2.stdout).not.toContain('test-slice-manifest-invalid');
  });

  it('ST-S09-197: 修正后未重新 verify 即 archive 必拒绝', () => {
    const f = mergedFixture();
    // 前置：无部署提案、[code] 全勾、验收已通过
    const tasks = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf8').replace(/## \[code\] 代码实现\n?/, '## [code] 代码实现\n\n- [x] 单切片：实现（覆盖 UT-S01-01）\n');
    writeFileSync(join(f.proposalDir, 'tasks.md'), tasks);
    writeFileSync(join(f.proposalDir, 'VERIFY_PASS'), '');
    commitAll(f.root, 'verified');
    writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 修正后的期望 |\n`);
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.invalidated_markers).toContain('VERIFY_PASS');
    const archived = invoke(['archive', f.slug], f.root);
    expect(archived.status).not.toBe(0);
    expect(archived.stderr).toContain('ARCHIVE_VERIFY_NOT_PASSED');
    expect(existsSync(f.proposalDir)).toBe(true);
    expect(existsSync(join(f.root, 'logos', '.openlogos-guard'))).toBe(true);
    // ③④ 对新规格重新验收通过（VERIFY_PASS 由验收写回）后归档成功
    writeFileSync(join(f.proposalDir, 'VERIFY_PASS'), '');
    const archived2 = invoke(['archive', f.slug], f.root);
    expect(archived2.status, archived2.stderr).toBe(0);
    expect(existsSync(f.proposalDir)).toBe(false);
  });

  it('ST-S09-199: 拒绝路径端到端零副作用', () => {
    const legacy = mergedFixture();
    stripBaseline(legacy);
    commitAll(legacy.root, 'legacy');
    writeDelta(legacy, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
    const drift = mergedFixture();
    writeDelta(drift, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
    writeFileSync(join(drift.root, ...REQ.split('/')), `${read(drift, REQ)}手工改动。\n`);
    const withdraw = mergedFixture();
    removeDelta(withdraw, CREATED);
    const cases: Array<[Fixture, string]> = [
      [legacy, 'MERGE_AMEND_BASELINE_MISSING'],
      [drift, 'MERGE_AMEND_DRIFT'],
      [withdraw, 'MERGE_AMEND_CREATE_WITHDRAW'],
    ];
    for (const [f, code] of cases) {
      writeFileSync(join(f.proposalDir, 'VERIFY_PASS'), '');
      const porcelain = git(f.root, ['status', '--porcelain']);
      const snap = snapshot(f);
      const r = mergeCli(f);
      expect(r.status, code).not.toBe(0);
      expect(r.error?.code).toBe(code);
      expect(git(f.root, ['status', '--porcelain']), code).toBe(porcelain);
      expectSnapshotEqual(snap, snapshot(f), code);
      expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(true);
    }
  });

  it('ST-S09-200: change-lint 与 merge 在修正待应用时同判', () => {
    const f = mergedFixture();
    writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 新定义 |\n\n## ADDED — 二、补充\n\n${TABLE_HEAD}| UT-S01-01 | 重复 |\n`);
    const snap = snapshot(f);
    const lint = JSON.parse(invoke(['change-lint', '--format', 'json'], f.root).stdout).data;
    expect(lint.pass).toBe(false);
    expect(lint.violations.map((v: any) => v.code)).toContain('delta_test_id_duplicate');
    const rejected = mergeCli(f);
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain('delta_test_id_duplicate');
    expectSnapshotEqual(snap, snapshot(f), '同判拒绝');
    writeDelta(f, TEST, `## MODIFIED — 一、判据\n\n${TABLE_HEAD}| UT-S01-01 | 新定义 |\n\n## ADDED — 二、补充\n\n${TABLE_HEAD}| UT-S01-02 | 合法新增 |\n`);
    const lint2 = JSON.parse(invoke(['change-lint', '--format', 'json'], f.root).stdout).data;
    expect(lint2.pass, JSON.stringify(lint2.violations)).toBe(true);
    const accepted = mergeCli(f);
    expect(accepted.status, accepted.stderr).toBe(0);
    expect(accepted.data.result).toBe('amended');
  });

  it('ST-S09-201: 需要部署的提案修正后须重新部署与 smoke', () => {
    const f = mergedFixture();
    put(f.root, 'logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md', '# 部署方案\n\n## 本机全局发布\n\n按既有流程发布。\n');
    declareReuse(f);
    const proposal = readFileSync(join(f.proposalDir, 'proposal.md'), 'utf8')
      .replace('- 是否需要部署：否', '- 是否需要部署：是\n- 部署方案依据：本机全局发布').replace('- 是否需要 smoke：否', '- 是否需要 smoke：是');
    writeFileSync(join(f.proposalDir, 'proposal.md'), proposal);
    const tasks = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf8')
      .replace(/## \[code\] 代码实现\n?/, '## [code] 代码实现\n\n- [x] 单切片：实现（覆盖 UT-S01-01）\n\n## [deploy] 部署任务\n- [x] 按部署方案发布\n');
    writeFileSync(join(f.proposalDir, 'tasks.md'), tasks);
    for (const name of ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS']) writeFileSync(join(f.proposalDir, name), '');
    commitAll(f.root, 'delivered');
    const statusBefore = JSON.parse(invoke(['status', '--format', 'json'], f.root).stdout).data;
    const stepBefore = statusBefore.modules[0].active_change.proposal_step;
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n交付后修正业务规格。\n');
    const r = mergeCli(f);
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.invalidated_markers).toEqual(['DEPLOY_DONE', 'SMOKE_PASS', 'VERIFY_PASS']);
    const step = JSON.parse(invoke(['status', '--format', 'json'], f.root).stdout).data.modules[0].active_change.proposal_step;
    expect(['smoke-passed', 'deploy-done', 'ready-to-smoke', 'verify-passed', 'ready-to-deploy'], `交付态 ${stepBefore} 后不得停留`).not.toContain(step);
    const archived = invoke(['archive', f.slug], f.root);
    expect(archived.status).not.toBe(0);
    expect(existsSync(f.proposalDir)).toBe(true);
  });
});
