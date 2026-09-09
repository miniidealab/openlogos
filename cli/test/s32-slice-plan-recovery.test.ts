/**
 * ST-S32-41：manifest 失效 → 恢复重跑 → 实现进度不丢的端到端（真实 CLI）。
 *
 * 对应功能规格 §2.68.5 / §2.77、根规范 `spec/test-slice-manifest.md` §2.3/§2.4/§6.1/§9。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import {
  TEST_SLICE_MANIFEST, SLICE_CHECKPOINTS,
  appendSliceCheckpoint, computeSliceManifestIdentity, deriveSliceVerificationState,
} from '../src/lib/test-slice-manifest.js';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'slice-recovery-demo';
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
    '# 变更提案：slice-recovery-demo', '',
    '## 变更原因', '验证 manifest 失效后的恢复重跑。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '恢复重跑不冲掉已完成切片的勾选。',
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

function codeEntries(dir: string): string[] {
  const lines = readFileSync(join(dir, 'tasks.md'), 'utf-8').split('\n');
  const start = lines.findIndex(line => /^## \[code\]/.test(line));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter(line => /^- \[[ xX]\]/.test(line));
}

function markFirstDone(dir: string): void {
  const path = join(dir, 'tasks.md');
  writeFileSync(path, readFileSync(path, 'utf-8')
    .replace('- [ ] 切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）',
      '- [x] 切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）'));
}

describe('S32 slice plan 恢复重跑与 checkbox 保留（真实 CLI）', () => {
  it('ST-S32-41: manifest 失效 → 恢复重跑 → 进度不丢', () => {
    const { root, dir, input } = fixture();

    // ① 真实 CLI 规划 2 切片，并在 slice-exit 写 SLICES_APPROVED
    const planned = cli(root, 'slice', 'plan', '--file', input);
    expect(planned.status, planned.stderr).toBe(0);
    expect(codeEntries(dir)).toEqual([
      '- [ ] 切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）',
      '- [ ] 切片2：实现 beta（覆盖 UT-S99-02、ST-S99-02）',
    ]);
    writeFileSync(join(dir, 'SLICES_APPROVED'), `${JSON.stringify({ approved_at: '2026-09-09T00:00:00.000Z' })}\n`);

    // ② 切片1 完成：写入一条真实 checkpoint（判定器给出 slice-checkpoint 前沿），再勾选该条目
    const first = deriveSliceVerificationState(root, dir, { change: SLUG, module: 'core' })!;
    expect(first.manifest_status).toBe('valid');
    expect(first.verify_mode).toBe('slice-checkpoint');
    expect(first.attempted_slice_id).toBe('slice-01-alpha');
    expect(appendSliceCheckpoint(dir, first, 'PASS')).toBe(true);
    markFirstDone(dir);
    expect(codeEntries(dir)[0]).toMatch(/^- \[x\]/);

    const approvedBefore = readFileSync(join(dir, 'SLICES_APPROVED'));
    const checkpointsBefore = readFileSync(join(dir, SLICE_CHECKPOINTS));
    const manifestBefore = JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf-8'));
    const idsBefore = manifestBefore.slices.map((s: { slice_id: string }) => s.slice_id);

    // ③ manifest 失效（missing）：判定器判可自动恢复，next 派 plan-slices
    rmSync(join(dir, TEST_SLICE_MANIFEST));
    const missing = deriveSliceVerificationState(root, dir, { change: SLUG, module: 'core' })!;
    expect(missing.manifest_status).toBe('missing');
    expect(missing.human_action_required).toBe(false);
    const next = cli(root, 'next', '--format', 'json');
    expect(JSON.parse(next.stdout).data.modules[0].next_node.id).toBe('plan-slices');

    // ④ 以**相同** slices.json 重跑：勾选保留、manifest 重建、切片身份不变
    const recovered = cli(root, 'slice', 'plan', '--file', input);
    expect(recovered.status, recovered.stderr).toBe(0);
    expect(codeEntries(dir)).toEqual([
      '- [x] 切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）',
      '- [ ] 切片2：实现 beta（覆盖 UT-S99-02、ST-S99-02）',
    ]);
    expect(existsSync(join(dir, TEST_SLICE_MANIFEST))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf-8'))
      .slices.map((s: { slice_id: string }) => s.slice_id)).toEqual(idsBefore);

    // ⑤ SLICES_APPROVED 与 checkpoint 账本字节均未变——两者不在 slice plan 的写域内
    expect(readFileSync(join(dir, 'SLICES_APPROVED'))).toEqual(approvedBefore);
    expect(readFileSync(join(dir, SLICE_CHECKPOINTS))).toEqual(checkpointsBefore);

    // ⑥ 恢复后增量验收从未完成切片继续、已完成切片不重跑（AC-SLICE-RECOVER-06）。
    //    账本按根规范 §6.1 绑定 manifest 的**判定实质**（排除 generated_at），恢复重建不改变
    //    身份，故切片1 的 PASS 仍被采信、前沿前移到切片2。
    const after = deriveSliceVerificationState(root, dir, { change: SLUG, module: 'core' })!;
    expect(after.manifest_status).toBe('valid');
    expect(after.verify_mode).toBe('slice-checkpoint');
    expect(after.confirmed_slice_ids).toEqual(['slice-01-alpha']);
    expect(after.attempted_slice_id).toBe('slice-02-beta');

    // ⑦ 首次规划与恢复后两份 manifest 的 task_fingerprint / spec_fingerprint / 判定实质身份
    //    分别逐字相等。本条在步骤② 已勾选切片1 **之后**求值，故同时锁住「勾选不参与
    //    task_fingerprint」（根规范 §4.1）——它是⑥ 能成立的前提。
    const afterManifest = JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf-8'));
    expect(afterManifest.task_fingerprint).toBe(manifestBefore.task_fingerprint);
    expect(afterManifest.spec_fingerprint).toBe(manifestBefore.spec_fingerprint);
    expect(computeSliceManifestIdentity(afterManifest))
      .toBe(computeSliceManifestIdentity(manifestBefore));
    expect(afterManifest.generated_at).not.toBe(manifestBefore.generated_at);
  });
});
