/**
 * UT-S35-138..141 / ST-S35-27：`change-lint` 新增检查项 L9「下游阻塞理由预检」
 * 与「阻塞理由 × 自检入口可达性」一致性锚。
 *
 * 对应功能规格 §2.30 / §2.79，场景 S35「阻塞理由自检可达性与一致性锚」。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { planSlices } from '../src/commands/slice.js';
import { runChangeLint, CHANGE_LINT_VIOLATION_CODES } from '../src/lib/change-lint.js';
import {
  PROPOSAL_BLOCK_REASONS, getProposalStepReason, type ProposalBlockReason,
} from '../src/lib/proposal-lifecycle.js';
import {
  TEST_SLICE_MANIFEST, appendSliceCheckpoint, deriveSliceVerificationState,
} from '../src/lib/test-slice-manifest.js';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'lint-block-reason-demo';
const SPEC_TARGET = 'logos/resources/test/core-S99-test-cases.md';
const IDS = ['UT-S99-01', 'UT-S99-02', 'ST-S99-01', 'ST-S99-02'];

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args],
    { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function slices() {
  return [
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
}

interface Fixture { root: string; dir: string; input: string }

/** 建活跃提案：默认已 spec-complete（含 change set），可选去掉 [delta] / SPEC_MERGED。 */
function fixture(options: { specMerged?: boolean; withDelta?: boolean; codeBody?: string[] } = {}): Fixture {
  const { specMerged = true, withDelta = true, codeBody = ['（本段在 plan 段留空。）'] } = options;
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
    '# 变更提案：lint-block-reason-demo', '',
    '> module: core', '',
    '## 变更原因', '验证 L9 阻塞理由预检。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', 'change-lint 覆盖全部阻塞理由。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '',
    ...(withDelta ? ['## [delta] 规格变更', '- [x] 产出 delta 文件到 `deltas/test/` — `core-S99-test-cases.md`', ''] : []),
    '## [code] 代码实现', ...codeBody, '',
  ].join('\n'));
  // L3 证据（slice 级要求本提案自己的测试 delta 实物）：与已合并规格同表，避免夹具噪声干扰 L9。
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'),
    `## ADDED — S99 用例\n\n${table}\n`);
  if (specMerged) {
    writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
      type: 'baseline_closure_spec_complete',
      test_change_set: buildTestChangeSet({
        change: SLUG, module: 'core',
        targets: [{ targetPath: SPEC_TARGET, beforeBytes: null, afterBytes: Buffer.from(table) }],
      }),
    }, null, 2)}\n`);
  }
  const input = join(root, 'slices.json');
  writeFileSync(input, JSON.stringify({ slices: slices() }, null, 2));
  return { root, dir, input };
}

/** 规划两片（合法），供各反例在其之上做最小改动。 */
function planned(options: Parameters<typeof fixture>[0] = {}): Fixture {
  const f = fixture(options);
  planSlices(f.root, f.input);
  return f;
}

function patchManifest(f: Fixture, patch: (m: Record<string, unknown>) => void): void {
  const path = join(f.dir, TEST_SLICE_MANIFEST);
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  patch(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function lintOf(f: Fixture) {
  const result = runChangeLint(f.root, f.dir, SLUG);
  if (!result.ok) throw new Error(`lint 操作错误：${result.errorCode}`);
  return result;
}

function lintCodes(f: Fixture): string[] {
  return lintOf(f).violations.map(v => v.code);
}

/** 逐条阻塞理由的最小构造——键即 ProposalBlockReason，用于与类型全集对账。 */
const BUILDERS: Record<ProposalBlockReason, () => Fixture> = {
  no_delta_spec_marker_missing: () => fixture({
    specMerged: false, withDelta: false,
    codeBody: ['- [ ] 切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）'],
  }),
  code_change_requires_real_test_ids: () => {
    const f = fixture({ codeBody: ['- [ ] 切片1：实现某能力（占位 UT-S99-xx）'] });
    rmSync(join(f.dir, 'deltas'), { recursive: true, force: true });   // 抽掉唯一证据源
    return f;
  },
  'test-slice-manifest-missing': () => {
    const f = planned();
    rmSync(join(f.dir, TEST_SLICE_MANIFEST));
    return f;
  },
  'test-slice-manifest-invalid': () => {
    const f = planned();
    patchManifest(f, m => {
      (m.slices as Array<Record<string, unknown>>)[0].spec_targets = ['logos/resources/prd/core-01.md'];
    });
    return f;
  },
  'test-slice-manifest-stale': () => {
    const f = planned();
    patchManifest(f, m => { m.task_fingerprint = `sha256:${'c'.repeat(64)}`; });
    return f;
  },
  'test-slice-manifest-unsupported': () => {
    const f = planned();
    patchManifest(f, m => { m.schema = 'openlogos/test-slice-manifest@9'; });
    return f;
  },
  'test-slice-assignment-ambiguous': () => {
    const f = planned();
    patchManifest(f, m => {
      const rows = m.slices as Array<Record<string, unknown>>;
      rows[1].owned_test_ids = ['ST-S99-01', 'UT-S99-02', 'ST-S99-02'];  // ST-S99-01 被两片同时 own
      rows[1].runner_selectors = ['ST-S99-01', 'UT-S99-02', 'ST-S99-02'];
    });
    return f;
  },
  'slice-task-state-inconsistent': () => {
    const f = planned();
    // 逐片写入真实 PASS checkpoint（走同一写入者），直到不再有 attempted 切片——
    // 此时 checkpoint 全过而 [code] 条目仍未勾选，即「任务事实与账本不一致」。
    for (let i = 0; i < 2; i += 1) {
      const state = deriveSliceVerificationState(f.root, f.dir, { change: SLUG, module: 'core' })!;
      if (state.verify_mode !== 'slice-checkpoint') break;
      appendSliceCheckpoint(f.dir, state, 'PASS');
    }
    return f;
  },
};

describe('S35 change-lint 阻塞理由自检覆盖', () => {
  it('UT-S35-138: 8 条阻塞理由逐条可被自检检出，stale 走 warning', () => {
    for (const reason of PROPOSAL_BLOCK_REASONS) {
      const f = BUILDERS[reason]();
      const result = lintOf(f);
      // 两条走 warning 通道：
      //   - test-slice-manifest-stale：指纹漂移是审计观察，不进流程分支（§2.68.4 / §2.79.1）；
      //   - no_delta_spec_marker_missing：待办步骤而非缺陷——merge 的准入判定就是 lint 的
      //     violations 全集，记成 violation 会让 merge 拒绝它自己要写入的 marker。
      if (reason === 'test-slice-manifest-stale' || reason === 'no_delta_spec_marker_missing') {
        expect(result.warnings.map(w => w.code), reason).toContain(reason);
        expect(result.violations.map(v => v.code), reason).not.toContain(reason);
        continue;
      }
      // 其余 6 条为 violation（exit 2）。修复前只有 code_change_requires_real_test_ids 被检出。
      expect(result.violations.map(v => v.code), reason).toContain(reason);
      const hit = result.violations.filter(v => v.code === reason);
      for (const item of hit) {
        expect(item.path, reason).toBeTruthy();
        expect(item.message, reason).toBeTruthy();
        expect(item.fix_hint, reason).toBeTruthy();
      }
    }
  });

  it('UT-S35-139: L9 与 next/status 同判据同结论', () => {
    for (const reason of PROPOSAL_BLOCK_REASONS) {
      if (reason === 'code_change_requires_real_test_ids') continue;   // L3 既有覆盖，判据另有其人
      const f = BUILDERS[reason]();

      // 基准值取自**真实的**下游派生路径，不在测试内复述期望违规
      const downstream = reason === 'no_delta_spec_marker_missing'
        ? { reason: getProposalStepReason(f.dir), violations: [] as Array<Record<string, string>> }
        : (() => {
          const state = deriveSliceVerificationState(f.root, f.dir, { change: SLUG, module: 'core' })!;
          return { reason: state.reason, violations: (state.violations ?? []) as Array<Record<string, string>> };
        })();
      expect(downstream.reason, `${reason}：夹具应当真的触发该理由`).toBe(reason);

      const result = lintOf(f);
      const lintRows = [
        ...result.violations.filter(v => v.code === reason)
          .map(v => ({ code: v.code, message: v.message, fix_hint: v.fix_hint })),
        ...result.warnings.filter(w => w.code === reason)
          .map(w => ({ code: w.code, message: w.message, fix_hint: w.fix_hint })),
      ];
      expect(lintRows.length, `${reason}：lint 必须给出结论`).toBeGreaterThan(0);

      if (downstream.violations.length > 0) {
        // 逐条同源：violation 的 message / fix_hint **原样**带出，一条不多一条不少。
        // 顺序按 lint 既有的全序（检查项 → path → 出现序 → code → message）重排，
        // 故按集合比对；lint 自身的稳定性另行断言（同一状态两次运行逐条相同）。
        // violation 通道 message 逐字原样；warning 通道（stale）无 path 字段，故在 message 前缀
        // 定位路径——两者都必须以下游 message 结尾，且 fix_hint 逐字相同。
        expect(lintRows.length, `${reason}：条数一致`).toBe(downstream.violations.length);
        const remaining = [...lintRows];
        for (const expectedRow of downstream.violations) {
          const idx = remaining.findIndex(row => row.fix_hint === expectedRow.fix_hint
            && row.message.endsWith(expectedRow.message));
          expect(idx, `${reason}：缺少与下游同源的一条（${expectedRow.message}）`).toBeGreaterThanOrEqual(0);
          remaining.splice(idx, 1);
        }
        expect(remaining, `${reason}：lint 不得产生下游没有的结论`).toEqual([]);
        const again = lintOf(f);
        expect(again.violations.map(v => `${v.code}|${v.path}|${v.message}`), `${reason}：排序稳定`)
          .toEqual(result.violations.map(v => `${v.code}|${v.path}|${v.message}`));
      }
    }
  });

  it('UT-S35-140: 一致性锚——阻塞理由全集逐条有可达自检入口', () => {
    // 遍历源是**类型全集的运行期投影**（ProposalBlockReason 由 PROPOSAL_BLOCK_REASONS 派生），
    // 不是测试内硬编码的名单：新增第 9 条理由而未接线时，本用例必挂红。
    const unreachable: string[] = [];
    for (const reason of PROPOSAL_BLOCK_REASONS) {
      const builder = BUILDERS[reason as ProposalBlockReason];
      if (!builder) { unreachable.push(`${reason}（无构造）`); continue; }
      const f = builder();
      const result = lintOf(f);
      const reachable = result.violations.some(v => v.code === reason)
        || result.warnings.some(w => w.code === reason);
      if (!reachable) unreachable.push(reason);
    }
    expect(unreachable, '每条阻塞理由都必须能被至少一个自检入口检出').toEqual([]);

    // 码闭合：L9 报出的每个理由都在 change-lint 的违规码枚举里（两条 warning 通道除外）
    for (const reason of PROPOSAL_BLOCK_REASONS) {
      if (reason === 'test-slice-manifest-stale' || reason === 'no_delta_spec_marker_missing') continue;
      expect(CHANGE_LINT_VIOLATION_CODES as readonly string[], reason).toContain(reason);
    }
  });

  it('UT-S35-141: 未阻塞与「判定器不适用」均不误报', () => {
    // ① 正常进行态：delta 未产完、SPEC_MERGED 尚未写入——是进度，不是缺陷
    const inProgress = fixture({
      specMerged: false,
      codeBody: ['（本段在 plan 段留空。）'],
    });
    writeFileSync(join(inProgress.dir, 'tasks.md'), [
      '# 实现任务', '', '## [delta] 规格变更',
      '- [ ] 产出 delta 文件到 `deltas/test/` — `core-S99-test-cases.md`', '',
      '## [code] 代码实现', '（本段在 plan 段留空。）', '',
    ].join('\n'));
    for (const reason of PROPOSAL_BLOCK_REASONS) {
      expect(lintCodes(inProgress), `进行态不得报 ${reason}`).not.toContain(reason);
    }

    // ② 判定器按设计不适用：单切片计划下 deriveSliceVerificationState 结论为 null
    const single = fixture();
    writeFileSync(join(single.root, 'slices.json'), JSON.stringify({
      slices: [{
        slice_id: 'slice-01-only', task_text: '单切片：实现全部（覆盖 UT-S99-01、ST-S99-01、UT-S99-02、ST-S99-02）',
        owned_test_ids: IDS, runner_selectors: IDS, spec_targets: [SPEC_TARGET],
      }],
    }, null, 2));
    planSlices(single.root, join(single.root, 'slices.json'));
    expect(deriveSliceVerificationState(single.root, single.dir, { change: SLUG, module: 'core' })).toBeNull();
    for (const reason of PROPOSAL_BLOCK_REASONS) {
      expect(lintCodes(single), `不适用不得读成失败：${reason}`).not.toContain(reason);
    }
  });

  it('ST-S35-27: 真实 CLI 下 Agent 报完成前的自检闭环', () => {
    const f = planned();
    patchManifest(f, m => {
      (m.slices as Array<Record<string, unknown>>)[0].spec_targets = ['logos/resources/prd/core-01.md'];
    });

    // ① 自检检出并给出可定位 fix_hint
    const lint = cli(f.root, 'change-lint');
    expect(lint.status).toBe(2);
    expect(lint.stdout).toContain('test-slice-manifest-invalid');

    // ② 与下游同结论
    const next = cli(f.root, 'next', '--format', 'json');
    expect(next.stdout).toContain('test-slice-manifest-invalid');

    // ③ 依指引重新规划为合法产物 → 自检转绿
    const replan = cli(f.root, 'slice', 'plan', '--file', f.input);
    expect(replan.status).toBe(0);
    const green = cli(f.root, 'change-lint');
    expect(green.status).toBe(0);
    expect(green.stdout).toContain('L9');

    // ④ 只读红线：lint 前后项目根字节快照相等
    const before = cli(f.root, 'change-lint');
    const snapshot = readFileSync(join(f.dir, 'tasks.md'), 'utf-8');
    const manifestBefore = readFileSync(join(f.dir, TEST_SLICE_MANIFEST), 'utf-8');
    expect(before.status).toBe(0);
    expect(readFileSync(join(f.dir, 'tasks.md'), 'utf-8')).toBe(snapshot);
    expect(readFileSync(join(f.dir, TEST_SLICE_MANIFEST), 'utf-8')).toBe(manifestBefore);
  });
});
