/**
 * S11 已合并提案的增量修正只读投影 spec_amend（merge-amend-merged-change，切片 slice-02-status-spec-amend）。
 *
 * 覆盖 UT-S11-91～UT-S11-95、ST-S11-50、ST-S11-51、ST-S09-198，对应场景 S11「已合并提案的增量修正只读投影」
 * （EX-11.16～EX-11.20）与 `spec/cli-json-output.md`「modules[].active_change.spec_amend 增量修正只读投影」。
 * 夹具为 `mktemp -d` 下 `git init` 的隔离 launched 项目；全部用例以真实 `openlogos` 子进程执行。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupFixtureRoots, cli, frontierFixture, invoke, put } from './frontier-fixture.js';
import { computeDeltaDigest } from '../src/lib/merge-baseline.js';

afterAll(cleanupFixtureRoots);

const REQ = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';
const FEATURE = 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';
const CREATED = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S02-new.md';
const PROTO_DELTA = 'deltas/prd/2-product-design/2-page-design/core-01-home.html';
const PROTO_RESOURCE = 'logos/resources/prd/2-product-design/2-page-design/core-01-home.html';

type Fixture = ReturnType<typeof frontierFixture>;

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}：${r.stderr}`);
  return r.stdout;
}

function commitAll(root: string, message: string): void {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', message]);
}

function writeDelta(f: Fixture, target: string, content: string): void {
  put(f.root, `logos/changes/${f.slug}/${target.replace(/^logos\/resources\//, 'deltas/')}`, content);
}

function gitFixture(): Fixture {
  const f = frontierFixture();
  writeDelta(f, CREATED, '## ADDED — 新场景\n\n第一版场景内容。\n');
  git(f.root, ['init', '-q']);
  git(f.root, ['config', 'user.email', 'fixture@example.com']);
  git(f.root, ['config', 'user.name', 'fixture']);
  git(f.root, ['config', 'commit.gpgsign', 'false']);
  commitAll(f.root, 'init');
  return f;
}

function mergeJson(f: Fixture) {
  const r = invoke(['merge', f.slug, '--format', 'json'], f.root);
  const data = r.status === 0 ? JSON.parse(r.stdout).data : null;
  let error: { code: string } | null = null;
  if (r.status !== 0) { try { error = JSON.parse(r.stderr.trim().split('\n').pop() ?? '').error; } catch { error = null; } }
  return { status: r.status, stderr: r.stderr, data, error };
}

function mergedFixture(build?: (f: Fixture) => void, beforeMerge?: (f: Fixture) => void): Fixture {
  const f = gitFixture();
  build?.(f);
  commitAll(f.root, 'pre');
  // 提交之后、合并之前的工作区改动（不进入任何提交）
  beforeMerge?.(f);
  const r = mergeJson(f);
  expect(r.status, r.stderr).toBe(0);
  commitAll(f.root, 'merge');
  return f;
}

function statusData(f: Fixture) {
  const r = invoke(['status', '--format', 'json'], f.root);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout).data;
}

function activeChange(f: Fixture) {
  return statusData(f).modules[0].active_change;
}

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

function stripBaseline(f: Fixture): void {
  const p = join(f.proposalDir, 'SPEC_MERGED');
  const m = JSON.parse(readFileSync(p, 'utf8'));
  delete m.merge_baseline;
  delete m.amendments;
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
}

/** 五种「修改 delta 后」夹具（UT-S11-93 五臂），返回预期 blocked_reason 与对应 merge 结果。 */
function pendingArms(): Array<[string, () => Fixture, string | null, string]> {
  return [
    ['① 合法改写', () => {
      const f = mergedFixture();
      writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n合法改写。\n');
      return f;
    }, null, 'amended'],
    ['② 撤回首次 CREATE 目标', () => {
      const f = mergedFixture();
      rmSync(join(f.proposalDir, ...CREATED.replace(/^logos\/resources\//, 'deltas/').split('/')));
      return f;
    }, 'create-withdraw', 'MERGE_AMEND_CREATE_WITHDRAW'],
    ['③ 原型资产变化', () => {
      const html = '<!doctype html><title>原型</title>\n';
      const f = mergedFixture(g => {
        put(g.root, `logos/changes/${g.slug}/${PROTO_DELTA}`, html);
        put(g.root, PROTO_RESOURCE, html);
      });
      put(f.root, `logos/changes/${f.slug}/${PROTO_DELTA}`, `${html}<p>改版</p>\n`);
      return f;
    }, 'prototype-changed', 'MERGE_AMEND_PROTOTYPE_UNSUPPORTED'],
    ['③b 删除原型', () => {
      const html = '<!doctype html><title>原型</title>\n';
      const f = mergedFixture(g => {
        put(g.root, `logos/changes/${g.slug}/${PROTO_DELTA}`, html);
        put(g.root, PROTO_RESOURCE, html);
      });
      rmSync(join(f.proposalDir, ...PROTO_DELTA.split('/')));
      return f;
    }, 'prototype-changed', 'MERGE_AMEND_PROTOTYPE_UNSUPPORTED'],
    ['④ 主文档漂移', () => {
      const f = mergedFixture();
      writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n合法改写。\n');
      writeFileSync(join(f.root, ...REQ.split('/')), `${readFileSync(join(f.root, ...REQ.split('/')), 'utf8')}手工改动。\n`);
      return f;
    }, 'drift', 'MERGE_AMEND_DRIFT'],
    ['⑤ 基线 blob 被清理', () => {
      // 合并前字节为未提交的脏内容：blob 只以松散对象存在，删除即模拟被清理
      const f = mergedFixture(undefined, g => {
        writeFileSync(join(g.root, ...REQ.split('/')), `${readFileSync(join(g.root, ...REQ.split('/')), 'utf8')}\n## 附录\n\n脏内容。\n`);
      });
      const m = JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8'));
      const id = m.merge_baseline.targets.find((t: any) => t.path === REQ).before.git_blob as string;
      // 前置：该 blob 不被任何提交引用（git fsck 无悬空引用以外的损坏）后才删除
      expect(spawnSync('git', ['fsck', '--no-dangling'], { cwd: f.root }).status).toBe(0);
      rmSync(join(f.root, '.git', 'objects', id.slice(0, 2), id.slice(2)));
      expect(spawnSync('git', ['fsck', '--no-dangling'], { cwd: f.root }).status, '删除未引用对象不得损坏仓库').toBe(0);
      writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n合法改写。\n');
      return f;
    }, 'baseline-unreadable', 'MERGE_AMEND_BASELINE_UNREADABLE'],
  ];
}

describe('S11 spec_amend 只读投影 — 单元测试', () => {
  it('UT-S11-91: 未合并提案不挂 spec_amend', () => {
    // ① 活跃提案处于 delta-writing 之后、尚未合并
    const f = gitFixture();
    const ac = activeChange(f);
    expect(ac).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(ac, 'spec_amend')).toBe(false);
    // ② 无活跃提案：active_change 为 null，输出中不出现该键
    rmSync(join(f.root, 'logos', '.openlogos-guard'));
    const data = statusData(f);
    expect(data.modules[0].active_change).toBeNull();
    expect(JSON.stringify(data)).not.toContain('spec_amend');
  });

  it('UT-S11-92: 合并后未修改 delta 时 pending 为 false', () => {
    const f = mergedFixture();
    const sa = activeChange(f).spec_amend;
    const marker = JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8'));
    expect(sa.merged_delta_digest).toBe(marker.merge_baseline.delta_digest);
    expect(sa.current_delta_digest).toBe(sa.merged_delta_digest);
    expect(sa.pending).toBe(false);
    expect(sa.blocked_reason).toBeNull();
    expect(sa.amend_count).toBe(0);
  });

  it('UT-S11-93: 修改 delta 后 pending 为 true 及受阻原因各取值', () => {
    for (const [label, build, blocked, mergeOutcome] of pendingArms()) {
      const f = build();
      const sa = activeChange(f).spec_amend;
      expect(sa.pending, label).toBe(true);
      expect(sa.current_delta_digest, label).toBe(computeDeltaDigest(f.proposalDir));
      expect(sa.blocked_reason, label).toBe(blocked);
      const r = mergeJson(f);
      if (mergeOutcome === 'amended') {
        expect(r.status, `${label}：${r.stderr}`).toBe(0);
        expect(r.data.result, label).toBe('amended');
      } else {
        expect(r.status, label).not.toBe(0);
        expect(r.error?.code, `${label}：blocked_reason 与 merge 错误码一一对应`).toBe(mergeOutcome);
      }
    }
  }, 60_000); // 五臂各起真实 CLI 子进程；CI 慢机器上 10s 默认超时不足（release-0-16-0：GitHub Linux runner 实证）

  it('UT-S11-94: 旧标记、legacy MERGED 与不可解析标记不可判定', () => {
    const arms: Array<[string, (f: Fixture) => void]> = [
      ['① 旧标记', f => stripBaseline(f)],
      ['② legacy MERGED', (f) => { rmSync(join(f.proposalDir, 'SPEC_MERGED')); writeFileSync(join(f.proposalDir, 'MERGED'), ''); }],
      ['③ 非法 JSON', f => writeFileSync(join(f.proposalDir, 'SPEC_MERGED'), '{ not json')],
    ];
    for (const [label, mutate] of arms) {
      const f = mergedFixture();
      mutate(f);
      writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n修改过。\n');
      const r = invoke(['status', '--format', 'json'], f.root);
      expect(r.status, label).toBe(0);
      const sa = JSON.parse(r.stdout).data.modules[0].active_change.spec_amend;
      expect(sa, label).toEqual({
        merged_delta_digest: null,
        current_delta_digest: computeDeltaDigest(f.proposalDir),
        pending: null,
        blocked_reason: 'baseline-missing',
        amend_count: 0,
      });
    }
  });

  it('UT-S11-95: status 只读', () => {
    const arms = pendingArms().filter(([label]) => label.startsWith('④') || label.startsWith('⑤'));
    const fixtures = arms.map(([, build]) => build());
    const legacy = mergedFixture();
    stripBaseline(legacy);
    writeDelta(legacy, FEATURE, '## MODIFIED — 一、判据\n\n修改过。\n');
    fixtures.push(legacy);
    for (const f of fixtures) {
      const before = snapshot(f);
      const objects = git(f.root, ['count-objects', '-v']);
      const first = activeChange(f).spec_amend;
      const second = activeChange(f).spec_amend;
      expect(second).toEqual(first);
      const after = snapshot(f);
      expect([...after.entries()]).toEqual([...before.entries()]);
      expect(git(f.root, ['count-objects', '-v'])).toBe(objects);
    }
  });
});

describe('S11 spec_amend 只读投影 — 场景测试', () => {
  it('ST-S11-50: 合并、修改、修正、归位的投影全过程', () => {
    const f = gitFixture();
    expect(Object.prototype.hasOwnProperty.call(activeChange(f), 'spec_amend')).toBe(false);
    expect(mergeJson(f).status).toBe(0);
    expect(activeChange(f).spec_amend.pending).toBe(false);
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n修正后的正文。\n');
    const pending = activeChange(f).spec_amend;
    expect(pending.pending).toBe(true);
    expect(pending.blocked_reason).toBeNull();
    expect(pending.current_delta_digest).not.toBe(pending.merged_delta_digest);
    const amended = mergeJson(f);
    expect(amended.status, amended.stderr).toBe(0);
    expect(amended.data.result).toBe('amended');
    expect(amended.data.delta_digest).toBe(pending.current_delta_digest);
    const settled = activeChange(f).spec_amend;
    expect(settled.pending).toBe(false);
    expect(settled.merged_delta_digest).toBe(settled.current_delta_digest);
    expect(settled.amend_count).toBe(1);
  });

  it('ST-S11-51: 投影不改变 proposal_step 派生且 watch 同构', () => {
    const f = mergedFixture();
    const tasks = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf8')
      .replace(/## \[code\] 代码实现\n?/, '## [code] 代码实现\n\n- [ ] 切片1：实现（覆盖 UT-S01-01）\n');
    writeFileSync(join(f.proposalDir, 'tasks.md'), tasks);
    const before = activeChange(f);
    expect(before.spec_amend.pending).toBe(false);
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n修改。\n');
    const after = activeChange(f);
    expect(after.proposal_step).toBe(before.proposal_step);
    expect(after.plan_state).toEqual(before.plan_state);
    expect(after.spec_amend.pending).toBe(true);
    // watch 首帧（snapshot）的 status 与 status 输出同构
    const w = spawnSync(process.execPath, [cli, 'watch', '--format', 'json'], {
      cwd: f.root, encoding: 'utf8', timeout: 6000, env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
    });
    const firstLine = w.stdout.split('\n').find(line => line.trim().startsWith('{'));
    expect(firstLine, w.stderr).toBeDefined();
    const event = JSON.parse(firstLine!);
    expect(event.data.event).toBe('snapshot');
    expect(event.data.status.modules[0].active_change.spec_amend).toEqual(after.spec_amend);
  });

  it('ST-S09-198: merge JSON 的 result 三值与 status 投影联动', () => {
    const f = gitFixture();
    const first = mergeJson(f);
    expect(first.status, first.stderr).toBe(0);
    expect(first.data.result).toBe('merged');
    const again = mergeJson(f);
    expect(again.data.result).toBe('already-merged');
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n联动修正。\n');
    const pending = activeChange(f).spec_amend;
    expect(pending.pending).toBe(true);
    expect(pending.blocked_reason).toBeNull();
    const amended = mergeJson(f);
    expect(amended.data.result).toBe('amended');
    expect(amended.data.delta_digest).toBe(pending.current_delta_digest);
    const settled = activeChange(f).spec_amend;
    expect(settled.pending).toBe(false);
    expect(settled.amend_count).toBe(1);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);

    // code-r1 F1：合法 symlink delta 的目标内容变化同样投影为 pending=true，merge 重合成
    const source = join(f.proposalDir, 'sources', 'feature.md');
    put(f.root, `logos/changes/${f.slug}/sources/feature.md`, '## MODIFIED — 一、判据\n\n经 symlink 的正文。\n');
    const deltaAbs = join(f.proposalDir, 'deltas', 'prd', '2-product-design', '1-feature-specs', 'core-01-feature-specs.md');
    rmSync(deltaAbs);
    symlinkSync(source, deltaAbs);
    expect(mergeJson(f).data.result).toBe('amended');
    expect(activeChange(f).spec_amend.pending).toBe(false);
    writeFileSync(source, '## MODIFIED — 一、判据\n\n经 symlink 再次修正。\n');
    expect(activeChange(f).spec_amend.pending, 'symlink 目标内容变化').toBe(true);
    expect(mergeJson(f).data.result).toBe('amended');
    expect(activeChange(f).spec_amend.pending).toBe(false);
  });
});
