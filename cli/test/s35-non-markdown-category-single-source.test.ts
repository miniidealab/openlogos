/**
 * slice-01-orchestration-full-file-channel 实现验收（S35 准入侧）。
 *
 * 覆盖 UT-S35-173～UT-S35-176 与 ST-S35-32，对应场景 S35「non-Markdown 类别集合单点与
 * fix_hint 协议派生」。结果由全局 OpenLogos reporter 依 it 标题中的 ID 写入 test-results.jsonl。
 *
 * 断言纪律：UT-S35-175 的 `fix_hint` 期望值**从协议常量生成**（`nonMarkdownMarkerForm`），
 * 禁止在测试里再抄一份文案——复述即构成第三份副本，正是本变更要消除的形态。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CHANGE_LINT_VIOLATION_CODES, runChangeLint } from '../src/lib/change-lint.js';
import {
  NON_MARKDOWN_CATEGORIES, canonicalTargetFromDeltaPath, classifyCanonicalTargetCategory,
  isNonMarkdownCategory, type CanonicalTargetCategory,
} from '../src/lib/canonical-target.js';
import { nonMarkdownMarkerForm } from '../src/lib/non-markdown-delta.js';
import { classifyProposalDeltas } from '../src/lib/delta-classify.js';
import { mergeDirect } from '../src/lib/merge-direct.js';
import BASELINE from './fixtures/s39-orchestration-baseline.json' with { type: 'json' };
import { invoke } from './frontier-fixture.js';

const roots: string[] = [];
afterAll(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

const SLUG = 'orch-fixture';
const ORCH_DELTA = `logos/changes/${SLUG}/deltas/scenario/core-auth.json`;

type LintScenario = { files: Record<string, string>; result: {
  ok: boolean; checkIds: number[]; total: number; passed: number; pass: boolean;
  violationCodes: string[]; checkViolations: Record<string, number> } };
const lintScenario = (key: string): LintScenario =>
  (BASELINE.lintScenarios as unknown as Record<string, LintScenario>)[key];

/** 把基线里内联的夹具文件原样物化——构造点即基线本身，不可能与捕获时漂移。 */
function materialize(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-s35-orch-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

function lintOf(root: string) {
  const result = runChangeLint(root, join(root, 'logos/changes', SLUG), SLUG);
  return {
    ok: result.ok,
    checkIds: result.checks.map(c => c.id),
    total: result.checks.length,
    passed: result.checks.filter(c => c.violations === 0).length,
    pass: result.violations.length === 0,
    violationCodes: [...new Set(result.violations.map(v => v.code))].sort(),
    checkViolations: Object.fromEntries(result.checks.map(c => [String(c.id), c.violations])),
    violations: result.violations,
  };
}

describe('S35 单元测试——non-Markdown 类别集合单点与 fix_hint 协议派生', () => {
  it('UT-S35-173: L4 对 deltas/scenario/*.json 进入判定（事故漏扫形态的锁）', () => {
    const root = materialize(lintScenario('orch-bare').files);
    const lint = lintOf(root);

    // ① 编排 JSON 进入 L4 判定并被点名
    expect(lint.checkViolations['4']).toBeGreaterThan(0);
    expect(lint.violations.some(v =>
      v.code === 'non_markdown_delta_invalid' && v.path.includes('deltas/scenario/core-auth.json'))).toBe(true);
    expect(lint.pass).toBe(false);

    // ② 回归对照：上线前同夹具 L4 对该文件零检查且整体 PASS
    expect(lintScenario('orch-bare').result.checkViolations['4']).toBe(0);
    expect(lintScenario('orch-bare').result.pass).toBe(true);

    // ③ L4 实际进入判定的集合与 L6 的 mergeable+valid 集合在**非 .md 部分**上不再有差集——
    //    事故现场该差集恰为 3 个（两份 api/*.yaml 与一份 scenario/*.json）。
    const entries = classifyProposalDeltas(join(root, 'logos/changes', SLUG));
    const mergeableNonMd = entries
      .filter(e => e.mergeDisposition === 'mergeable' && e.lintValidity === 'valid' && !e.relativePath.endsWith('.md'))
      .map(e => e.relativePath);
    const enteredL4 = mergeableNonMd.filter(relativePath => {
      const targetPath = canonicalTargetFromDeltaPath(relativePath);
      return targetPath !== null && isNonMarkdownCategory(classifyCanonicalTargetCategory(targetPath));
    });
    expect(mergeableNonMd.length).toBeGreaterThan(0);
    expect(enteredL4.sort()).toEqual([...mergeableNonMd].sort());
  });

  it('UT-S35-174: 零回归锚——检查项标识集合、总数与违规码注册表对上线前逐字同形', () => {
    // 违规码注册表：断言**成员集合本身**，集合被意外扩充同样是回归
    expect([...CHANGE_LINT_VIOLATION_CODES].sort()).toEqual(BASELINE.violationCodes);

    // 三组均为「行为不受本次修改影响」的回归夹具——此类夹具的通过数同样须与上线前逐字相同。
    // 预期行为改变的输入（裸 JSON）不进本用例，其断言见 ST-S35-32。
    for (const key of ['orch-legal', 'unrelated-violation', 'nodelta'] as const) {
      const root = materialize(lintScenario(key).files);
      const live = lintOf(root);
      const expected = lintScenario(key).result;
      expect(live.checkIds, key).toEqual(expected.checkIds);      // 标识集合
      expect(live.total, key).toBe(expected.total);               // 总数
      expect(live.passed, key).toBe(expected.passed);             // 通过数（仅此类夹具适用）
      expect(live.pass, key).toBe(expected.pass);
      expect(live.violationCodes, key).toEqual(expected.violationCodes);
      expect(live.checkViolations, key).toEqual(expected.checkViolations);
    }
  });

  it('UT-S35-175: fix_hint 与 NON_MD_MARKER 派生结果逐字相等', () => {
    // CREATE / MODIFY 两种 mode 参数化：mode 由目标是否存在的磁盘事实决定。
    const cases: Array<{ mode: 'MODIFY' | 'CREATE'; files: Record<string, string> }> = [
      { mode: 'MODIFY', files: lintScenario('orch-bare').files },
      {
        mode: 'CREATE',
        files: (() => {
          const files = { ...lintScenario('orch-bare').files };
          delete files['logos/resources/scenario/core-auth.json'];
          return files;
        })(),
      },
    ];

    for (const { mode, files } of cases) {
      const root = materialize(files);
      const violation = lintOf(root).violations.find(v => v.code === 'non_markdown_delta_invalid')!;
      expect(violation, mode).toBeDefined();

      // 期望值**从协议常量生成**；测试内不出现任何 marker 文案字面量。
      const form = nonMarkdownMarkerForm(mode);
      expect(violation.fix_hint, mode).toContain(`\`${form}\``);

      // 形态三要素（井号数 / 破折号 / 后缀）同样只从派生值读取，不在测试里复述：
      const [heading, op, separator] = form.split(' ');
      expect(heading, mode).toMatch(/^#+$/);
      expect(violation.fix_hint!, mode).toContain(`${heading} ${op} ${separator} `);
      expect(form.endsWith('）'), mode).toBe(true);

      // 回归对照：上线前文案在井号数、破折号、后缀三处均不符，照它修复必然再次失败。
      const staleHeading = heading.slice(1);                       // 上线前只有一个 `#`
      expect(violation.fix_hint!.includes(`\`${staleHeading} ${op}`), mode).toBe(false);
      expect(form.startsWith(`${staleHeading} `), mode).toBe(false);
    }
  });

  it('UT-S35-176: 类别集合单点——**真实**两侧消费方随集合同时变化（注入式反证）', () => {
    const orchTarget = 'logos/resources/scenario/core-auth.json';

    /**
     * lint 侧**真实消费方**：跑完整 `runChangeLint`，看 L4 是否真的把编排 delta 纳入判定。
     * 不在测试内复算类别判据——那只能证明测试自己的两次 helper 调用随常量变化（code-r1 F3）。
     */
    const lintFlagsOrchestration = (): boolean => {
      const root = materialize(lintScenario('orch-bare').files);
      return runChangeLint(root, join(root, 'logos/changes', SLUG), SLUG).violations
        .some(v => v.code === 'non_markdown_delta_invalid' && v.path.includes('deltas/scenario/'));
    };
    /**
     * merge 侧**真实消费方**：跑真实 `mergeDirect`（通道选择 → 整文件校验入口 → baseline-apply
     * 落盘）。成功且落盘字节等于 delta 剥离后正文，才说明三个消费点都走了共享集合；任一处
     * 留着私有字面量，本探针在集合被改动后都不会随之变化。
     */
    const mergeAcceptsFullFile = (): boolean => {
      const root = materialize(lintScenario('orch-legal').files);
      const body = lintScenario('orch-legal').files[`logos/changes/${SLUG}/deltas/scenario/core-auth.json`]
        .split('\n').slice(1).join('\n');
      try {
        mergeDirect(root, join(root, 'logos/changes', SLUG), SLUG);
        return readFileSync(join(root, orchTarget), 'utf8') === body;
      } catch {
        return false;
      }
    };

    // ① 基线：两侧真实消费方都把 orchestration 当整文件类别
    expect(lintFlagsOrchestration(), 'lint 侧真实 L4 未纳入编排 delta').toBe(true);
    expect(mergeAcceptsFullFile(), 'merge 侧真实通道/落盘未走整文件').toBe(true);

    // ② **注入式反证**：只改共享常量的成员，两侧**真实**消费方必须同时改变结论。
    //    任一侧仍持有私有字面量（change-lint / merge-direct / baseline-apply 任意一处），
    //    该侧不会随之变化，本臂即变红——这正是 code-r1 F3 实测出的漏网形态。
    const mutable = NON_MARKDOWN_CATEGORIES as Set<CanonicalTargetCategory>;
    expect(mutable.delete('orchestration')).toBe(true);
    try {
      expect(lintFlagsOrchestration(), 'lint 侧未随集合变化 → 仍持有第二份判据').toBe(false);
      expect(mergeAcceptsFullFile(), 'merge 侧未随集合变化 → 仍持有第二份判据').toBe(false);
    } finally {
      mutable.add('orchestration');
    }

    // ③ 恢复后两侧结论回到基线
    expect(lintFlagsOrchestration()).toBe(true);
    expect(mergeAcceptsFullFile()).toBe(true);
    expect([...NON_MARKDOWN_CATEGORIES].sort()).toEqual(['api', 'database', 'orchestration']);

    // ④ 类别判据只看**语义类别**、不看后缀：各类 canonical target 的分派结论
    const probes: Array<[string, boolean]> = [
      ['logos/resources/api/core-api.yaml', true],
      ['logos/resources/api/core-api.json', true],
      ['logos/resources/database/core.sql', true],
      [orchTarget, true],
      ['logos/resources/scenario/core-auth.md', true],   // 后缀是 .md，类别仍是 orchestration
      ['logos/resources/prd/1-product-requirements/core-01-requirements.md', false],
      ['logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', false],
      ['logos/resources/test/core-S01-test-cases.md', false],
      ['spec/change-management.md', false],
      ['skills/change-writer/SKILL.md', false],
    ];
    for (const [path, expected] of probes) {
      expect(isNonMarkdownCategory(classifyCanonicalTargetCategory(path)), path).toBe(expected);
    }
  });

  it('UT-S35-176 附加：类别与后缀不一致的负向夹具在**两侧真实入口**都被拒', () => {
    // code-r1 F2：`deltas/scenario/*.md` 的类别是 orchestration，merge 会把它交给整文件入口并
    // 拒绝「首行控制 marker 不合法」。此前 lint 按 `.md` 后缀先行排除、当作 Markdown 章节 delta
    // 放行——lint 全绿而 merge 必失败的组合再次成立。本用例锁两侧同拒。
    const files = { ...lintScenario('orch-legal').files };
    delete files[`logos/changes/${SLUG}/deltas/scenario/core-auth.json`];
    delete files['logos/resources/scenario/core-auth.json'];
    files[`logos/changes/${SLUG}/deltas/scenario/core-auth.md`] = '## ADDED — 编排\n\n正文。\n';
    const root = materialize(files);

    // ① lint 侧真实入口：L4 判 non_markdown_delta_invalid 并点名该文件
    const lint = lintOf(root);
    const offending = lint.violations.filter(
      v => v.code === 'non_markdown_delta_invalid' && v.path.includes('deltas/scenario/core-auth.md'));
    expect(offending.length).toBeGreaterThan(0);
    expect(lint.checkViolations['4']).toBeGreaterThan(0);
    expect(lint.pass).toBe(false);
    //    且**不得**被当作 Markdown 章节 delta 处理（不产出 Markdown 侧的段标记判定）
    expect(lint.violations.some(v => v.code === 'delta_missing_section_marker'
      && v.path.includes('deltas/scenario/core-auth.md'))).toBe(false);

    // ② merge 侧真实入口：整文件校验拒绝，零落盘
    expect(() => mergeDirect(root, join(root, 'logos/changes', SLUG), SLUG)).toThrow();
    expect(existsSync(join(root, 'logos/resources/scenario/core-auth.md'))).toBe(false);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(false);
  });

});

describe('S35 场景测试——准入先于合成，且门禁结论零漂移', () => {
  it('ST-S35-32: fix_hint 可直接据以修复，门禁口径零漂移', () => {
    // ① 裸 JSON：exit 2 并点名该文件（上线前同夹具实测 PASS，本臂即事故回归锁）
    const bare = materialize(lintScenario('orch-bare').files);
    const bareLint = invoke(['change-lint', '--slug', SLUG, '--format', 'json'], bare);
    expect(bareLint.status).toBe(2);
    const envelope = JSON.parse(bareLint.stdout.trim().split('\n').pop()!);
    expect(envelope.data.pass).toBe(false);
    const offending = envelope.data.violations.find(
      (v: { code: string }) => v.code === 'non_markdown_delta_invalid');
    expect(offending).toBeDefined();
    expect(offending.path).toContain('deltas/scenario/core-auth.json');
    expect(lintScenario('orch-bare').result.pass, '上线前同夹具为 PASS').toBe(true);

    // ② 照 fix_hint 给出的形态**逐字**构造修复后的 delta（不手写一个「正确但不同」的形态）——
    //    本臂检验的正是 fix_hint 的可用性。
    const form = /`([^`]+)`/.exec(offending.fix_hint)![1];
    const body = lintScenario('orch-bare').files[ORCH_DELTA];
    const repaired = `${form.replace('<canonical target 路径>', 'logos/resources/scenario/core-auth.json')}\n${body}`;
    const files = { ...lintScenario('orch-bare').files, [ORCH_DELTA]: repaired };
    const fixed = materialize(files);
    const fixedLint = invoke(['change-lint', '--slug', SLUG], fixed);
    expect(fixedLint.status, fixedLint.stdout + fixedLint.stderr).toBe(0);

    // ③ 门禁口径不变、通过数按分支断言
    const bareLive = lintOf(bare);
    const fixedLive = lintOf(fixed);
    const baseline = lintScenario('orch-bare').result;
    expect(bareLive.checkIds).toEqual(baseline.checkIds);      // 标识集合
    expect(fixedLive.checkIds).toEqual(baseline.checkIds);
    expect(bareLive.total).toBe(baseline.total);               // 总数
    expect(fixedLive.total).toBe(baseline.total);
    expect([...CHANGE_LINT_VIOLATION_CODES].sort()).toEqual(BASELINE.violationCodes);  // 注册表
    expect(bareLive.passed).toBeLessThan(bareLive.total);      // 预期新增拒绝分支
    expect(bareLive.checkViolations['4']).toBeGreaterThan(0);
    expect(fixedLive.passed).toBe(fixedLive.total);            // 修复后的合法分支
    expect(fixedLive.pass).toBe(true);

    // ④ api / database 两类既有 delta 的结论与上线前逐字相同（行为不受影响的回归臂）
    for (const key of ['orch-legal', 'unrelated-violation', 'nodelta'] as const) {
      const live = lintOf(materialize(lintScenario(key).files));
      const expected = lintScenario(key).result;
      expect(live.checkIds, key).toEqual(expected.checkIds);
      expect(live.total, key).toBe(expected.total);
      expect(live.passed, key).toBe(expected.passed);
      expect(live.violationCodes, key).toEqual(expected.violationCodes);
    }

    // ⑤ change-lint 项目级零写入：运行前后项目根字节快照相等
    const snapshot = invoke(['change-lint', '--slug', SLUG], fixed);
    expect(snapshot.status).toBe(0);
    const after = lintOf(fixed);
    expect(after.checkViolations).toEqual(fixedLive.checkViolations);
  });
});
