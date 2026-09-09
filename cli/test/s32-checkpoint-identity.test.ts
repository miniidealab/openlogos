/**
 * UT-S32-96..99 / ST-S32-42：切片 checkpoint 的**身份绑定**。
 *
 * 对应功能规格 §2.77，根规范 `spec/test-slice-manifest.md` §6.1～§6.3、§8、§11，
 * JSON 契约 `spec/cli-json-output.md`「指纹语义（降级为观察）」。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import {
  SLICE_CHECKPOINTS, SLICE_CHECKPOINT_SCHEMA, SLICE_CHECKPOINT_SCHEMA_V1, TEST_SLICE_MANIFEST,
  appendSliceCheckpoint, computeSliceManifestIdentity, deriveSliceVerificationState,
  eligibleIdsFingerprint, type TestSliceManifestV1,
} from '../src/lib/test-slice-manifest.js';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'slice-identity-demo';
const SPEC_TARGET = 'logos/resources/test/core-S99-test-cases.md';
const IDS = ['UT-S99-01', 'UT-S99-02', 'ST-S99-01', 'ST-S99-02'];

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args],
    { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const SLICES = [
  {
    slice_id: 'slice-01-alpha', task_text: '切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）',
    owned_test_ids: ['ST-S99-01', 'UT-S99-01'], runner_selectors: ['ST-S99-01', 'UT-S99-01'],
    spec_targets: [SPEC_TARGET],
  },
  {
    slice_id: 'slice-02-beta', task_text: '切片2：实现 beta（覆盖 UT-S99-02、ST-S99-02）',
    owned_test_ids: ['ST-S99-02', 'UT-S99-02'], runner_selectors: ['ST-S99-02', 'UT-S99-02'],
    spec_targets: [SPEC_TARGET],
  },
];

/** 纯内存 manifest：UT-96/97 只考查身份函数本身，不需要落盘。 */
function manifestOf(overrides: Partial<TestSliceManifestV1> = {}): TestSliceManifestV1 {
  return {
    schema: 'openlogos/test-slice-manifest@1',
    change: SLUG,
    module: 'core',
    task_fingerprint: `sha256:${'a'.repeat(64)}`,
    spec_fingerprint: `sha256:${'b'.repeat(64)}`,
    generated_at: '2026-09-09T02:36:23.870Z',
    slices: SLICES.map(slice => ({ ...slice })),
    ...overrides,
  } as TestSliceManifestV1;
}

/** manifest 的**文件字节**哈希——旧绑定对象，`slice plan` 的落盘序列化形态。 */
function fileBytesSha(manifest: TestSliceManifestV1): string {
  return `sha256:${createHash('sha256')
    .update(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')).digest('hex')}`;
}

function fixture() {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: t', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
  ].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));

  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  const table = ['| ID | 用例 |', '|---|---|', ...IDS.map(id => `| ${id} | ${id} fixture |`)].join('\n');
  writeFileSync(join(root, SPEC_TARGET), table);
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    '# 变更提案：slice-identity-demo', '',
    '## 变更原因', '验证 checkpoint 身份绑定。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', 'checkpoint 绑定判定实质而非文件字节。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '',
    '## [code] 代码实现', '（本段在 plan 段留空。）', '',
    '## [deploy] 部署执行', '- [ ] 无', '',
  ].join('\n'));
  writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete',
    test_change_set: buildTestChangeSet({
      change: SLUG, module: 'core',
      targets: [{ targetPath: SPEC_TARGET, beforeBytes: null, afterBytes: Buffer.from(table) }],
    }),
  }, null, 2)}\n`);

  const input = join(root, 'slices.json');
  writeFileSync(input, JSON.stringify({ slices: SLICES }, null, 2));
  return { root, dir, input };
}

function derive(root: string, dir: string) {
  return deriveSliceVerificationState(root, dir, { change: SLUG, module: 'core' })!;
}

function codeEntries(dir: string): string[] {
  const lines = readFileSync(join(dir, 'tasks.md'), 'utf-8').split('\n');
  const start = lines.findIndex(line => /^## \[code\]/.test(line));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter(line => /^- \[[ xX]\]/.test(line));
}

function markDone(dir: string, taskText: string): void {
  const path = join(dir, 'tasks.md');
  writeFileSync(path, readFileSync(path, 'utf-8').replace(`- [ ] ${taskText}`, `- [x] ${taskText}`));
}

function readManifest(dir: string): TestSliceManifestV1 {
  return JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf-8')) as TestSliceManifestV1;
}

describe('S32 checkpoint 身份绑定（判定实质，不是文件字节）', () => {
  it('UT-S32-96: generated_at 不参与身份', () => {
    // 只差 73ms 的写盘时刻——正是 §2.77.0 实证复现的那一对。
    const a = manifestOf({ generated_at: '2026-09-09T02:36:23.870Z' });
    const b = manifestOf({ generated_at: '2026-09-09T02:36:23.943Z' });

    expect(computeSliceManifestIdentity(a)).toBe(computeSliceManifestIdentity(b));
    // 两条断言必须成对：只断言身份相等的话，把身份函数错写成常量也能通过。
    // 文件字节哈希不等，正是旧绑定会作废整本账本的原因。
    expect(fileBytesSha(a)).not.toBe(fileBytesSha(b));
  });

  it('UT-S32-97: 判定实质变化即身份变化', () => {
    const base = computeSliceManifestIdentity(manifestOf());
    const mutate = (fn: (m: TestSliceManifestV1) => void): string => {
      const m = manifestOf();
      fn(m);
      return computeSliceManifestIdentity(m);
    };

    const variants: Record<string, string> = {
      slice_id: mutate(m => { m.slices[0].slice_id = 'slice-01-alpha-renamed'; }),
      task_text: mutate(m => { m.slices[0].task_text = `${m.slices[0].task_text}。`; }),
      owned_test_ids: mutate(m => { m.slices[0].owned_test_ids = ['UT-S99-01']; }),
      // 顺序对调必须变化——顺序是划分的一部分（§6.1）。
      slice_order: mutate(m => { m.slices = [m.slices[1], m.slices[0]]; }),
      task_fingerprint: mutate(m => { m.task_fingerprint = `sha256:${'c'.repeat(64)}`; }),
      spec_fingerprint: mutate(m => { m.spec_fingerprint = `sha256:${'d'.repeat(64)}`; }),
    };
    for (const [name, identity] of Object.entries(variants)) {
      expect(identity, `${name} 改动后身份未变化`).not.toBe(base);
    }
    // 六种情形彼此也不得碰撞，否则身份函数在丢信息。
    expect(new Set(Object.values(variants)).size).toBe(6);
  });

  it('UT-S32-98: 混合账本按行 schema 分派', () => {
    const { root, dir, input } = fixture();
    expect(cli(root, 'slice', 'plan', '--file', input).status).toBe(0);

    const manifest = readManifest(dir);
    const identity = computeSliceManifestIdentity(manifest);
    const fileSha = fileBytesSha(manifest);
    expect(identity).not.toBe(fileSha);

    const ledger = join(dir, SLICE_CHECKPOINTS);
    const row = (schema: string, sliceId: string, sha: string) => `${JSON.stringify({
      schema, slice_id: sliceId, manifest_sha256: sha, result: 'PASS',
      eligible_test_ids_sha256: eligibleIdsFingerprint(IDS), timestamp: '2026-09-09T00:00:00.000Z',
    })}\n`;

    // @2 行按判定实质身份、@1 行按 manifest 整份文件字节哈希——各按其 schema 匹配。
    writeFileSync(ledger, row(SLICE_CHECKPOINT_SCHEMA, 'slice-01-alpha', identity)
      + row(SLICE_CHECKPOINT_SCHEMA_V1, 'slice-02-beta', fileSha));
    const mixed = derive(root, dir);
    expect(mixed.manifest_status).toBe('valid');
    expect(mixed.confirmed_slice_ids).toEqual(['slice-01-alpha', 'slice-02-beta']);

    // 把 @1 行的值换成新身份 → 该行不再匹配（证明未按行分派会误判）。
    writeFileSync(ledger, row(SLICE_CHECKPOINT_SCHEMA, 'slice-01-alpha', identity)
      + row(SLICE_CHECKPOINT_SCHEMA_V1, 'slice-02-beta', identity));
    expect(derive(root, dir).confirmed_slice_ids).toEqual(['slice-01-alpha']);
  });

  it('UT-S32-99: 未知 checkpoint 主版本保守处置', () => {
    const { root, dir, input } = fixture();
    expect(cli(root, 'slice', 'plan', '--file', input).status).toBe(0);

    const manifest = readManifest(dir);
    const identity = computeSliceManifestIdentity(manifest);
    const fileSha = fileBytesSha(manifest);
    const row = (schema: string, sliceId: string, sha: string) => `${JSON.stringify({
      schema, slice_id: sliceId, manifest_sha256: sha, result: 'PASS',
      eligible_test_ids_sha256: eligibleIdsFingerprint(IDS), timestamp: '2026-09-09T00:00:00.000Z',
    })}\n`;

    writeFileSync(join(dir, SLICE_CHECKPOINTS),
      row('openlogos/slice-checkpoint@9', 'slice-01-alpha', identity)
      + row(SLICE_CHECKPOINT_SCHEMA_V1, 'slice-02-beta', fileSha));

    const state = derive(root, dir);
    // 未知主版本的行不进确认集合，但同账本内 @1 / @2 行照常被采信。
    expect(state.confirmed_slice_ids).toEqual(['slice-02-beta']);
    // 不产生 violation、不中断 validator——与 manifest 自身 unsupported 的阻断语义互不牵连。
    expect(state.manifest_status).toBe('valid');
    expect(state.violations).toBeUndefined();
    expect(state.human_action_required).toBe(false);
    expect(state.verify_mode).toBe('slice-checkpoint');
    expect(state.attempted_slice_id).toBe('slice-01-alpha');
  });

  it('ST-S32-42: 恢复保住账本、重划作废账本的互为反例端到端', () => {
    const { root, dir, input } = fixture();

    // ① 规划 2 切片，切片 1 写入 PASS checkpoint 并勾选
    expect(cli(root, 'slice', 'plan', '--file', input).status).toBe(0);
    const first = derive(root, dir);
    expect(first.attempted_slice_id).toBe('slice-01-alpha');
    expect(appendSliceCheckpoint(dir, first, 'PASS')).toBe(true);
    markDone(dir, SLICES[0].task_text);
    expect(codeEntries(dir)[0]).toMatch(/^- \[x\]/);

    const beforeManifest = readManifest(dir);
    const ledgerAfterFirst = readFileSync(join(dir, SLICE_CHECKPOINTS));
    // 新写入一律 @2，且落的是判定实质身份而非文件字节。
    const written = JSON.parse(ledgerAfterFirst.toString('utf8').trim());
    expect(written.schema).toBe(SLICE_CHECKPOINT_SCHEMA);
    expect(written.manifest_sha256).toBe(computeSliceManifestIdentity(beforeManifest));

    // ② 删除 manifest 后以**相同** slices.json 重跑：三个值分别相等（本条在①已勾选之后求值，
    //    故同时锁住「勾选不参与 task_fingerprint」——它是恢复保住账本的前提）
    rmSync(join(dir, TEST_SLICE_MANIFEST));
    expect(cli(root, 'slice', 'plan', '--file', input).status).toBe(0);
    const afterManifest = readManifest(dir);
    expect(afterManifest.task_fingerprint).toBe(beforeManifest.task_fingerprint);
    expect(afterManifest.spec_fingerprint).toBe(beforeManifest.spec_fingerprint);
    expect(computeSliceManifestIdentity(afterManifest))
      .toBe(computeSliceManifestIdentity(beforeManifest));

    const recovered = derive(root, dir);
    expect(recovered.verify_mode).toBe('slice-checkpoint');
    expect(recovered.confirmed_slice_ids).toEqual(['slice-01-alpha']);
    expect(recovered.attempted_slice_id).toBe('slice-02-beta');
    const ledgerAfterRecover = readFileSync(join(dir, SLICE_CHECKPOINTS));

    // ③ 改动 slices.json（重划）后重跑 → 旧账本作废，前沿回到第一片
    const replanned = [{ ...SLICES[0], task_text: '切片1：实现 alpha v2（覆盖 UT-S99-01、ST-S99-01）' }, SLICES[1]];
    writeFileSync(input, JSON.stringify({ slices: replanned }, null, 2));
    expect(cli(root, 'slice', 'plan', '--file', input).status).toBe(0);
    expect(computeSliceManifestIdentity(readManifest(dir)))
      .not.toBe(computeSliceManifestIdentity(beforeManifest));

    const afterReplan = derive(root, dir);
    expect(afterReplan.confirmed_slice_ids).toEqual([]);
    expect(afterReplan.attempted_slice_id).toBe('slice-01-alpha');

    // ④ 全程账本只增不改：②③ 两步均未删除或重写历史行
    const ledgerFinal = readFileSync(join(dir, SLICE_CHECKPOINTS));
    expect(ledgerAfterRecover).toEqual(ledgerAfterFirst);
    expect(ledgerFinal).toEqual(ledgerAfterFirst);
    expect(ledgerFinal.subarray(0, ledgerAfterFirst.length)).toEqual(ledgerAfterFirst);
  });
});
