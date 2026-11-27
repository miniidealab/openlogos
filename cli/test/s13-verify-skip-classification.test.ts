/**
 * verify-self-sufficient-cases 切片 4：verify 跳过分类、模块报告改判、平台跳过登记与本仓前置工具检查。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 verify 自足：环境预检与跳过分类测试」严格对齐：
 * UT-S13-165～168、UT-S13-170～174、UT-S13-179、ST-S13-41～43。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { cleanupVsMerged, changedIdsOf, readSpecMerged, runCli, vsMerged, VS_NEW_ID, VS_SLUG } from './vs-merged-fixture.js';
import { isModuleReportComplete, MODULE_ROW_LABEL } from '../src/lib/module-phase-report.js';
import { detectLivenessCapability } from '../src/lib/sandbox-reuse.js';
import { platformSkipName, PLATFORM_SKIP_MARKER_RE } from './platform-skip.js';
import { nondumpApplicable, livenessAvailable, checkExitCode, NONDUMP_SKIP_DETAIL } from '../../scripts/linux-nondump-cc.mjs';

vi.setConfig({ testTimeout: 120_000 });
afterAll(() => cleanupVsMerged());

const CLI_ROOT = resolve(import.meta.dirname, '..');
const REPO = resolve(CLI_ROOT, '..');
const REPORT = 'logos/resources/verify/acceptance-report.md';

type Fx = ReturnType<typeof vsMerged>;
function verify(f: Fx, env: Record<string, string | undefined> = {}, args: string[] = []) {
  const r = runCli(f.root, ['verify', '--format', 'json', ...args], { VS_RAN: f.ran, ...env });
  const line = (r.stdout ?? '').trim().split('\n').pop() ?? '';
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', data: line.startsWith('{') ? JSON.parse(line).data : null };
}
const report = (f: Fx) => readFileSync(join(f.root, REPORT), 'utf8');
/** 启动 verify 前的前置断言（评审 delta-r1 F4）：真实变更集含新增用例、不含存量对照。 */
function assertChangeSet(f: Fx) {
  const ids = changedIdsOf(f);
  expect(ids).toContain(VS_NEW_ID);
  expect(ids).not.toContain('UT-S01-02');
}
function setConfig(root: string, patch: (v: Record<string, any>) => void) {
  const p = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  patch(cfg.verify);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
}

describe('S13 verify 跳过分类与模块报告改判', () => {
  it('UT-S13-165: 严格集合内的非平台 skip 判用例分层错误', () => {
    for (const [label, skip] of [['无原因', VS_NEW_ID], ['其他 reason_code', `${VS_NEW_ID}=env-missing:db down`]]) {
      const f = vsMerged();
      assertChangeSet(f);
      const r = verify(f, { VS_SKIP: skip });
      expect(r.status, label).toBe(1);
      expect(r.data.gate, label).toEqual({ result: 'FAIL', reason: 'case_tier_mismatch' });
      expect(r.data.tier_mismatch_cases.map((c: any) => c.id), label).toEqual([VS_NEW_ID]);
      expect(r.data.tier_mismatch_cases[0].fix_hint, label).toBe('准备好环境并声明到 verify.requirements，或改标 `[manual]`');
    }
  });

  it('UT-S13-166: 平台跳过放行与 detail 为空不放行', () => {
    const f = vsMerged();
    assertChangeSet(f);
    const r1 = verify(f, { VS_SKIP: `${VS_NEW_ID}=platform-unavailable:requires win32` });
    expect(r1.status).toBe(0);
    expect(r1.data.gate.result).toBe('PASS');
    expect(r1.data.platform_skipped_cases).toEqual([{ id: VS_NEW_ID, detail: 'requires win32' }]);
    expect(report(f)).toContain('平台跳过 / Platform Skips');
    expect(report(f)).toContain(`| ${VS_NEW_ID} | requires win32 |`);
    for (const skip of [`${VS_NEW_ID}=platform-unavailable:`, `${VS_NEW_ID}=platform-unavailable`]) {
      const r = verify(f, { VS_SKIP: skip });
      expect(r.data.gate.reason, skip).toBe('case_tier_mismatch');
    }
  });

  it('UT-S13-167: 存量与无活跃提案只警告', () => {
    // ① 有真实变更集，存量 UT-S01-02 写无原因 skip，UT-S01-90 pass
    const f = vsMerged();
    assertChangeSet(f);
    const r1 = verify(f, { VS_SKIP: 'UT-S01-02' });
    expect(r1.status).toBe(0);
    expect(r1.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r1.data.warnings).toEqual([{ code: 'unclassified_skipped_cases', ids: ['UT-S01-02'] }]);
    expect(r1.data.summary).toMatchObject({ skipped_count: 1, pass_rate_pct: 100, executed_count: 4 });
    // ② 无活跃提案
    rmSync(join(f.root, 'logos', '.openlogos-guard'));
    const r2 = verify(f, { VS_SKIP: 'UT-S01-02' });
    expect(r2.status).toBe(0);
    expect(r2.data.gate.result).toBe('PASS');
    expect(r2.data.warnings).toEqual([{ code: 'unclassified_skipped_cases', ids: ['UT-S01-02'] }]);
  });

  it('UT-S13-168: 门禁原因优先级', () => {
    // ① 对账失败且环境也缺失 → acceptance_requirement_undeclared，不再预检
    const f1 = vsMerged({ verify: { requirements: { env: ['VS_TOKEN'] } } });
    const p1 = join(f1.proposalDir, 'proposal.md');
    writeFileSync(p1, readFileSync(p1, 'utf8').replace('- 自动验收环境要求：无', '- 自动验收环境要求：`command:vs-fake-tool`'));
    const r1 = verify(f1, { VS_TOKEN: undefined });
    expect(r1.data.gate.reason).toBe('acceptance_requirement_undeclared');
    expect(r1.data.requirements.missing_environment).toEqual([]);
    // ② 预跑非零退出 + 严格集合内无原因 skip、无失败用例 → case_tier_mismatch
    const f = vsMerged();
    assertChangeSet(f);
    expect(verify(f, { VS_SKIP: VS_NEW_ID, VS_EXIT: '3' }).data.gate.reason).toBe('case_tier_mismatch');
    // ③ 预跑成功 + 一条失败用例 + 无原因 skip → failed_cases，tier_mismatch_cases 照常输出
    const r3 = verify(f, { VS_SKIP: VS_NEW_ID, VS_FAIL: 'UT-S01-01' });
    expect(r3.data.gate.reason).toBe('failed_cases');
    expect(r3.data.tier_mismatch_cases.map((c: any) => c.id)).toEqual([VS_NEW_ID]);
    // ④ 无原因 skip + 另有未覆盖用例 → case_tier_mismatch，uncovered_cases 照常输出
    const r4 = verify(f, { VS_SKIP: VS_NEW_ID, VS_OMIT: 'UT-S01-02' });
    expect(r4.data.gate.reason).toBe('case_tier_mismatch');
    expect(r4.data.uncovered_cases).toEqual(['UT-S01-02']);
  });

  it('UT-S13-170: 验收报告与 JSON 展示', () => {
    const undeclared = vsMerged();
    const pp = join(undeclared.proposalDir, 'proposal.md');
    writeFileSync(pp, readFileSync(pp, 'utf8').replace('- 自动验收环境要求：无', '- 自动验收环境要求：`check:db-ready`'));
    const r1 = verify(undeclared);
    expect(r1.data.requirements.missing_declarations).toEqual(['check:db-ready']);
    expect(report(undeclared)).toContain('验收标准条目未写入配置');
    expect(report(undeclared)).toContain('未执行 / not executed');

    const envMissing = vsMerged({ verify: { requirements: { env: ['VS_TOKEN'] } } });
    const r2 = verify(envMissing, { VS_TOKEN: undefined });
    expect(r2.data.requirements.missing_environment).toEqual([{ kind: 'env', name: 'VS_TOKEN' }]);
    expect(report(envMissing)).toContain('环境未就绪 / Missing Environment');
    expect(report(envMissing)).toContain('env VS_TOKEN');

    const platform = vsMerged();
    verify(platform, { VS_SKIP: `${VS_NEW_ID}=platform-unavailable:requires win32` });
    expect(report(platform)).toContain('## 平台跳过 / Platform Skips');

    const legacy = vsMerged();
    const r4 = verify(legacy, { VS_SKIP: 'UT-S01-02' });
    expect(report(legacy)).toContain('## 未分类跳过（警告）/ Unclassified Skips (warning)');
    // 验收历史记录的门禁结论与报告一致
    const hist = readdirSync(join(legacy.root, 'logos/resources/verify/history')).sort().pop()!;
    const h = JSON.parse(readFileSync(join(legacy.root, 'logos/resources/verify/history', hist), 'utf8'));
    expect(h.gate.result).toBe(r4.data.gate.result);
    expect(report(legacy)).toContain(`**Gate 3.5** | **${r4.data.gate.result}**`);
  });

  it('UT-S13-171: ST-S13-26 适用条件单一判定', () => {
    expect(nondumpApplicable({ platform: 'darwin', uid: 501, liveness: true })).toBe(false);
    expect(nondumpApplicable({ platform: 'linux', uid: 0, liveness: true })).toBe(false);
    expect(nondumpApplicable({ platform: 'linux', uid: 1000, liveness: false })).toBe(false);
    expect(nondumpApplicable({ platform: 'linux', uid: 1000, liveness: true })).toBe(true);
    // 复用能力与 detectLivenessCapability 同口径：测试接缝下两者都不可用；Linux 上两者一致
    expect(livenessAvailable({ OPENLOGOS_SANDBOX_TEST_NO_LIVENESS: '1' }, 'linux')).toBe(false);
    const saved = process.env.OPENLOGOS_SANDBOX_TEST_NO_LIVENESS;
    process.env.OPENLOGOS_SANDBOX_TEST_NO_LIVENESS = '1';
    try { expect(detectLivenessCapability().available).toBe(false); } finally {
      if (saved === undefined) delete process.env.OPENLOGOS_SANDBOX_TEST_NO_LIVENESS; else process.env.OPENLOGOS_SANDBOX_TEST_NO_LIVENESS = saved;
    }
    if (process.platform === 'linux') expect(livenessAvailable(process.env, 'linux')).toBe(detectLivenessCapability().available);
    // 检查命令：不适用退出 0；适用时退出码 = cc 是否可用
    expect(checkExitCode({ platform: 'darwin', uid: 501, liveness: true }, () => false)).toBe(0);
    expect(checkExitCode({ platform: 'linux', uid: 1000, liveness: false }, () => false)).toBe(0);
    expect(checkExitCode({ platform: 'linux', uid: 1000, liveness: true }, () => true)).toBe(0);
    expect(checkExitCode({ platform: 'linux', uid: 1000, liveness: true }, () => false)).toBe(1);
    // ST-S13-26 的跳过条件与检查命令调用同一判定（源码中只有一处实现）
    const testSrc = readFileSync(join(CLI_ROOT, 'test/s13-sandbox-reuse.test.ts'), 'utf8');
    expect(testSrc).toContain("from '../../scripts/linux-nondump-cc.mjs'");
    expect(testSrc).toContain('itOnPlatform(nondumpApplicable(');
    expect(testSrc).not.toMatch(/getuid\(\) !== 0/);
    // 不适用时 ST-S13-26 写平台跳过与说明条件的 detail
    expect(platformSkipName('ST-S13-26: x', false, NONDUMP_SKIP_DETAIL)).toContain(`[platform-unavailable: ${NONDUMP_SKIP_DETAIL}]`);
  });

  it('UT-S13-172: 分类判据进入规范与 Skill', () => {
    const texts: Array<[string, string]> = [
      ['spec/test-results.md', readFileSync(join(REPO, 'spec/test-results.md'), 'utf8')],
      ['skills/test-writer/SKILL.md', readFileSync(join(REPO, 'skills/test-writer/SKILL.md'), 'utf8')],
    ];
    // sync / init 部署后的副本：用构建产物在一次性项目里 init，读部署出的 logos/skills/test-writer/SKILL.md
    const tmp = mkdtempSync(join(tmpdir(), 'openlogos-tw-'));
    try {
      const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist/index.js'), 'init', 'tw', '--locale', 'zh', '--ai-tool', 'claude-code'], { cwd: tmp, encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      texts.push(['deployed logos/skills/test-writer/SKILL.md', readFileSync(join(tmp, 'logos/skills/test-writer/SKILL.md'), 'utf8')]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    for (const [label, text] of texts) {
      expect(text, label).toContain('换一个待验版本');
      expect(text, label).toContain('移除上一版本的结果与人工证据');
      expect(text, label).toMatch(/每个版本都要人(重新)?准备的证据|每个版本都要人提供新的凭据/);
      expect(text, label).toMatch(/只约束 UT\/ST/);
      expect(text, label).not.toContain('**判断标准**：如果该用例在 CI 无头环境中无法稳定运行并自动断言结果，就应加 `[manual]`');
    }
  });

  it('UT-S13-173: reporter 写平台跳过原因', () => {
    // 登记入口：不适用时名称带标记，适用时名称不变
    expect(platformSkipName('UT-S01-01: a', true, 'requires win32')).toBe('UT-S01-01: a');
    const skippedName = platformSkipName('UT-S01-01: a', false, 'requires win32');
    expect(PLATFORM_SKIP_MARKER_RE.exec(skippedName)?.[1]).toBe('requires win32');
    // reporter 按同一标记写 reason_code / detail；普通跳过不带 reason_code
    const reporterSrc = readFileSync(join(CLI_ROOT, 'test/openlogos-reporter.ts'), 'utf8');
    expect(reporterSrc).toContain("record.reason_code = 'platform-unavailable'");
    expect(reporterSrc).toContain('PLATFORM_SKIP_MARKER_RE.exec(nameForMatch)');
    // 整组跳过（describeOnPlatform）时按用例组链识别标记
    expect(reporterSrc).toContain('PLATFORM_SKIP_MARKER_RE.exec(nameWithSuites)');
    expect(reporterSrc).toMatch(/if \(status === 'skip'\) \{\n\s+const platform = PLATFORM_SKIP_MARKER_RE/);
    // 本仓五条 Windows 用例经登记入口声明「requires win32」
    const uses: Array<[string, string]> = [
      ['test/git-bash-prerequisite.test.ts', "itOnPlatform(IS_WIN, 'requires win32', 'ST-S08-45:"],
      ['test/s09-claude-hook-powershell.test.ts', "itOnPlatform(IS_WIN, 'requires win32', 'ST-S09-219:"],
      ['test/s19-windows-latest-release-gate.test.ts', "itOnPlatform(process.platform === 'win32', 'requires win32', 'ST-S19-37:"],
      ['test/s19-windows-public-upgrade.test.ts', "describeOnPlatform(process.platform === 'win32', 'requires win32', '真实 Windows 升级'"],
    ];
    for (const [file, snippet] of uses) expect(readFileSync(join(CLI_ROOT, file), 'utf8'), file).toContain(snippet);
    const upgrade = readFileSync(join(CLI_ROOT, 'test/s19-windows-public-upgrade.test.ts'), 'utf8');
    expect(upgrade).toContain("'ST-S19-35:");
    expect(upgrade).toContain("'ST-S19-36:");
    if (process.platform !== 'win32') {
      expect(platformSkipName('真实 Windows 升级', process.platform === 'win32', 'requires win32')).toContain('[platform-unavailable: requires win32]');
    }
  });

  it('UT-S13-174: 模块验收报告不残留旧 PASS', () => {
    const modulesYaml = [
      'project:', '  name: VS Mod', 'modules:',
      '  - id: core', '    name: Core', '    lifecycle: launched', '    paths: ["core/**"]',
      '  - id: a', '    name: A', '    lifecycle: initial', '    paths: ["a/**"]',
      '  - id: b', '    name: B', '    lifecycle: initial', '    paths: ["b/**"]',
      'scenario_counter:', '  next_id: 40', 'resource_index: []', '',
    ].join('\n');
    const f = vsMerged({
      modulesYaml,
      testTarget: 'a-S01-test-cases.md',
      extraFiles: { 'logos/resources/test/b-S02-test-cases.md': '| 用例ID | 验证目标 |\n|---|---|\n| UT-S02-01 | b 夹具 |\n' },
      extraIds: ['UT-S02-01'],
    });
    assertChangeSet(f);
    // 起点：两个 initial 模块的报告均为 PASS
    const r0 = verify(f, {}, ['--all']);
    expect(r0.data.gate.result, JSON.stringify(r0.data.gate)).toBe('PASS');
    expect(isModuleReportComplete(f.root, 'a', 'acceptance')).toBe(true);
    expect(isModuleReportComplete(f.root, 'b', 'acceptance')).toBe(true);
    const ledgerBefore = readFileSync(join(f.root, 'logos/resources/verify/test-results.jsonl'), 'utf8');

    // ① 项目级环境要求缺失：两份模块报告都改写为 FAIL（计数「未执行」），旧账本未被读取改动
    setConfig(f.root, v => { v.requirements = { env: ['VS_TOKEN'] }; });
    const r1 = verify(f, { VS_TOKEN: undefined }, ['--all']);
    expect(r1.data.gate.reason).toBe('verify_env_not_ready');
    for (const m of ['a', 'b']) {
      expect(isModuleReportComplete(f.root, m, 'acceptance'), m).toBe(false);
      const text = readFileSync(join(f.root, `logos/resources/verify/${m}-acceptance-report.md`), 'utf8');
      expect(text, m).toContain(`| ${MODULE_ROW_LABEL} | ${m} |`);
      expect(text, m).toContain('未执行 / not executed');
      expect(text, m).toContain('verify_env_not_ready');
    }
    expect(readFileSync(join(f.root, 'logos/resources/verify/test-results.jsonl'), 'utf8')).toBe(ledgerBefore);

    // ② 环境就绪，模块 a 的新增用例写无原因 skip：a FAIL、b PASS
    const r2 = verify(f, { VS_TOKEN: 'x', VS_SKIP: VS_NEW_ID }, ['--all']);
    expect(r2.data.gate.reason).toBe('case_tier_mismatch');
    expect(isModuleReportComplete(f.root, 'a', 'acceptance')).toBe(false);
    expect(readFileSync(join(f.root, 'logos/resources/verify/a-acceptance-report.md'), 'utf8')).toContain(`case_tier_mismatch: ${VS_NEW_ID}`);
    expect(isModuleReportComplete(f.root, 'b', 'acceptance')).toBe(true);
  });

  it('UT-S13-179: 已合并提案的测试变更集无效时不得放行', () => {
    const corruptHash = (spec: Record<string, any>) => { spec.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`; };
    const dropSet = (spec: Record<string, any>) => { delete spec.test_change_set; };
    for (const [label, mutate, expectCode] of [['摘要不符', corruptHash, 'hash'], ['change set 缺失', dropSet, 'missing']] as const) {
      const f = vsMerged();
      assertChangeSet(f);
      const spec = readSpecMerged(f);
      mutate(spec);
      writeFileSync(join(f.proposalDir, 'SPEC_MERGED'), JSON.stringify(spec, null, 2));
      const r = verify(f, { VS_SKIP: VS_NEW_ID });
      expect(r.data.gate, label).toEqual({ result: 'FAIL', reason: 'test_change_set_invalid' });
      expect(r.data.change_set_diagnostic.detail, label).toContain(expectCode);
      expect(existsSync(join(f.proposalDir, 'VERIFY_PASS')), label).toBe(false);
    }
    // ③ 未改动（对照）
    const ok = vsMerged();
    assertChangeSet(ok);
    expect(verify(ok, { VS_SKIP: VS_NEW_ID }).data.gate.reason).toBe('case_tier_mismatch');
    // ④ 尚未 merge 的基线：只对存量 UT-S01-02 写无原因 skip，不产生 UT-S01-90 结果行
    const unmerged = vsMerged({ skipMerge: true });
    expect(existsSync(join(unmerged.proposalDir, 'SPEC_MERGED'))).toBe(false);
    const r4 = verify(unmerged, { VS_SKIP: 'UT-S01-02' });
    expect(r4.data.gate.result).toBe('PASS');
    expect(r4.data.warnings).toEqual([{ code: 'unclassified_skipped_cases', ids: ['UT-S01-02'] }]);
    expect(r4.data.consistency.unknown_result_ids).toEqual([]);
  });

  it('code-r1 F1：变更集损坏——多切片提案保持人工边界零副作用（S32），非切片提案缺账本 / 缺用例定义仍进入完整性拒绝收尾', () => {
    const modulesYaml = [
      'project:', '  name: VS Mod', 'modules:',
      '  - id: core', '    name: Core', '    lifecycle: launched', '    paths: ["core/**"]',
      '  - id: a', '    name: A', '    lifecycle: initial', '    paths: ["a/**"]',
      'scenario_counter:', '  next_id: 40', 'resource_index: []', '',
    ].join('\n');
    const f = vsMerged({ modulesYaml, testTarget: 'a-S01-test-cases.md' });
    assertChangeSet(f);
    const r0 = verify(f, {}, ['--all']);
    expect(r0.data.gate.result, JSON.stringify(r0.data.gate)).toBe('PASS');
    expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(true);
    expect(isModuleReportComplete(f.root, 'a', 'acceptance')).toBe(true);
    // 变成多切片提案：两个带测试 ID 的切片 + manifest
    const tasksPath = join(f.proposalDir, 'tasks.md');
    writeFileSync(tasksPath, readFileSync(tasksPath, 'utf8').replace('## [code] 代码实现\n',
      `## [code] 代码实现\n- [x] 切片1：新增用例 ${VS_NEW_ID}\n- [x] 切片2：存量用例 UT-S01-01、UT-S01-02、ST-S01-01\n`));
    writeFileSync(join(f.proposalDir, 'TEST_SLICE_MANIFEST.json'), '{}\n');
    const spec = readSpecMerged(f);
    spec.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`;
    writeFileSync(join(f.proposalDir, 'SPEC_MERGED'), JSON.stringify(spec, null, 2));
    // S32 UT-S32-48 / ST-S32-16（EX-13.14「副作用：无」）：多切片提案的变更集不可信时由切片清单暂停分支返回人工边界，
    // 不写、不推进任何 Gate / loop / VERIFY 标记，也不改写模块报告
    const markers = () => ['VERIFY_PASS', 'VERIFY_FAIL', 'LOOP_ITERS', 'SLICE_CHECKPOINTS.jsonl'].filter(n => existsSync(join(f.proposalDir, n)));
    const markersBefore = markers();
    const moduleReportBefore = readFileSync(join(f.root, 'logos/resources/verify/a-acceptance-report.md'), 'utf8');
    const r = verify(f, {}, ['--all']);
    expect(r.status).toBe(2);
    expect(r.data.reason).toBe('test-slice-manifest-invalid');
    expect(r.data.slice_verification_state.human_action_required).toBe(true);
    expect(JSON.stringify(r.data.slice_verification_state.violations)).toContain('test-slice-change-set');
    expect(markers()).toEqual(markersBefore);
    expect(readFileSync(join(f.root, 'logos/resources/verify/a-acceptance-report.md'), 'utf8')).toBe(moduleReportBefore);

    // 评审 code-r2 F1（非切片提案）：有旧 PASS、无预跑、无结果账本——不得以 NO_TEST_RESULTS 早退，完整性拒绝照常进入门禁
    const g = vsMerged({ modulesYaml, testTarget: 'a-S01-test-cases.md' });
    assertChangeSet(g);
    expect(verify(g, {}, ['--all']).data.gate.result).toBe('PASS');
    expect(existsSync(join(g.proposalDir, 'VERIFY_PASS'))).toBe(true);
    expect(isModuleReportComplete(g.root, 'a', 'acceptance')).toBe(true);
    const gSpec = readSpecMerged(g);
    gSpec.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`;
    writeFileSync(join(g.proposalDir, 'SPEC_MERGED'), JSON.stringify(gSpec, null, 2));
    setConfig(g.root, v => { delete v.pre_run_command; });
    rmSync(join(g.root, 'logos/resources/verify/test-results.jsonl'), { force: true });
    const rg = verify(g, {}, ['--all']);
    expect(rg.status, rg.stderr).toBe(1);
    expect(rg.data?.gate, rg.stderr).toEqual({ result: 'FAIL', reason: 'test_change_set_invalid' });
    expect(rg.data.change_set_diagnostic.detail).toContain('hash');
    expect(existsSync(join(g.proposalDir, 'VERIFY_PASS')), '旧 PASS 证据须撤销').toBe(false);
    expect(isModuleReportComplete(g.root, 'a', 'acceptance')).toBe(false);
    expect(readFileSync(join(g.root, 'logos/resources/verify/a-acceptance-report.md'), 'utf8')).toContain('test_change_set_invalid');
    expect(readFileSync(join(g.root, REPORT), 'utf8')).toContain('test_change_set_invalid');
    const histDir = join(g.root, 'logos/resources/verify/history');
    const runs = readdirSync(histDir).filter(n => n.endsWith('.json')).sort();
    expect(JSON.parse(readFileSync(join(histDir, runs[runs.length - 1]), 'utf8'))).toMatchObject({
      outcome: 'completed', result_source: 'none', gate: { result: 'FAIL', reason: 'test_change_set_invalid' },
    });

    // 评审 code-r3 F1（非切片提案）：保留旧账本与旧 PASS、清空测试规格中的用例行——不得以 NO_TEST_CASES 早退
    const h = vsMerged({ modulesYaml, testTarget: 'a-S01-test-cases.md' });
    assertChangeSet(h);
    expect(verify(h, {}, ['--all']).data.gate.result).toBe('PASS');
    expect(existsSync(join(h.proposalDir, 'VERIFY_PASS'))).toBe(true);
    const hSpec = readSpecMerged(h);
    hSpec.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`;
    writeFileSync(join(h.proposalDir, 'SPEC_MERGED'), JSON.stringify(hSpec, null, 2));
    setConfig(h.root, v => { delete v.pre_run_command; });
    const hLedger = join(h.root, 'logos/resources/verify/test-results.jsonl');
    expect(existsSync(hLedger), '旧账本保留').toBe(true);
    const testDir = join(h.root, 'logos/resources/test');
    for (const name of readdirSync(testDir).filter(n => n.endsWith('-test-cases.md'))) {
      writeFileSync(join(testDir, name), '| 用例ID | 验证目标 |\n|---|---|\n');
    }
    const rh = verify(h, {}, ['--all']);
    expect(rh.status, rh.stderr).toBe(1);
    expect(rh.data?.gate, rh.stderr).toEqual({ result: 'FAIL', reason: 'test_change_set_invalid' });
    expect(rh.data.change_set_diagnostic.detail).toContain('hash');
    expect(existsSync(join(h.proposalDir, 'VERIFY_PASS')), '旧 PASS 证据须撤销').toBe(false);
    expect(readFileSync(join(h.root, REPORT), 'utf8')).toContain('test_change_set_invalid');
    const hHist = join(h.root, 'logos/resources/verify/history');
    const hRuns = readdirSync(hHist).filter(n => n.endsWith('.json')).sort();
    expect(JSON.parse(readFileSync(join(hHist, hRuns[hRuns.length - 1]), 'utf8'))).toMatchObject({
      outcome: 'completed', result_source: 'none', gate: { result: 'FAIL', reason: 'test_change_set_invalid' },
    });
  });

  it('ST-S13-41: 人工用例不被测试入口启动', () => {
    const root = mkdtempSync(join(tmpdir(), 'openlogos-manual-'));
    try {
      const put = (rel: string, content: string) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), content); };
      put('logos/logos.config.json', JSON.stringify({ name: 'm', locale: 'zh', documents: {}, verify: { result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/run-tests.cjs', sandbox_mode: 'off' } }));
      put('logos/logos-project.yaml', 'project:\n  name: m\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
      put('logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | 自动用例 |\n| ST-S01-02 [manual] | 需要人在实机上确认 |\n');
      const sentinel = `${root}.SENTINEL`;
      // 测试入口按「独立文件命名」在调度前排除 *.manual.test.cjs（spec/test-results.md「人工用例不得被测试入口启动」）
      put('tools/run-tests.cjs', `const fs = require('fs'); const path = require('path');
const results = [];
for (const f of fs.readdirSync('tests').filter(n => n.endsWith('.test.cjs') && !n.endsWith('.manual.test.cjs')).sort()) {
  results.push(...require(path.resolve('tests', f)));
}
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', results.map(r => JSON.stringify(r)).join('\\n') + '\\n');
`);
      put('tests/auto.test.cjs', "module.exports = [{ id: 'UT-S01-01', status: 'pass', scenario: 'S01' }];\n");
      put('tests/device.manual.test.cjs', `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'launched'); module.exports = [{ id: 'ST-S01-02', status: 'pass' }];\n`);
      const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist/index.js'), 'verify', '--format', 'json'], { cwd: root, encoding: 'utf8' });
      const data = JSON.parse(r.stdout.trim().split('\n').pop()!).data;
      expect(data.gate.result).toBe('PASS');
      expect(data.summary.manual_count).toBe(1);
      expect(existsSync(sentinel)).toBe(false);
      const ledger = readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf8');
      expect(ledger).toContain('UT-S01-01');
      expect(ledger).not.toContain('ST-S01-02');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}.SENTINEL`, { force: true });
    }
  });

  it('ST-S13-42: 本次改动用例的跳过分类端到端', () => {
    const f = vsMerged();
    assertChangeSet(f);
    const t1 = runCli(f.root, ['verify'], { VS_SKIP: VS_NEW_ID, VS_RAN: f.ran });
    expect(t1.status).toBe(1);
    expect(t1.stdout).toContain('case_tier_mismatch');
    expect(report(f)).toContain('用例分层错误 / Case Tier Mismatch');
    expect(report(f)).toContain(`| ${VS_NEW_ID} |`);
    const t2 = runCli(f.root, ['verify'], { VS_SKIP: `${VS_NEW_ID}=platform-unavailable:requires win32`, VS_RAN: f.ran });
    expect(t2.status).toBe(0);
    expect(report(f)).toContain('平台跳过 / Platform Skips');
    expect(report(f)).toContain('requires win32');
    expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(true);
  });

  it('code-r2 F4：干净检出由 pretest 把可共享声明应用到真实配置（不入库本机路径、不覆盖本机配置）', async () => {
    const pkg = JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.pretest).toBe('node ../scripts/apply-repo-verify-requirements.mjs');
    const decl = JSON.parse(readFileSync(join(REPO, 'scripts/repo-verify-requirements.json'), 'utf8'));
    expect(decl.checks).toEqual([{ name: 'linux-nondump-cc', command: 'node scripts/linux-nondump-cc.mjs' }]);
    expect(JSON.stringify(decl)).not.toMatch(/\/Volumes\/|\/Users\/|sandbox_root/);
    const { applyRepoVerifyRequirements } = await import('../../scripts/apply-repo-verify-requirements.mjs');
    const root = mkdtempSync(join(tmpdir(), 'openlogos-repo-req-'));
    try {
      mkdirSync(join(root, 'scripts'));
      copyFileSync(join(REPO, 'scripts/repo-verify-requirements.json'), join(root, 'scripts/repo-verify-requirements.json'));
      const cfgPath = join(root, 'logos/logos.config.json');
      // ① 干净检出：无配置 → 建立只含可共享声明的最小配置
      expect(applyRepoVerifyRequirements(root)).toEqual({ action: 'created', added: ['linux-nondump-cc'] });
      expect(JSON.parse(readFileSync(cfgPath, 'utf8'))).toEqual({ verify: { requirements: { checks: decl.checks } } });
      // ② 已齐全：不改写
      const before = readFileSync(cfgPath, 'utf8');
      expect(applyRepoVerifyRequirements(root).action).toBe('unchanged');
      expect(readFileSync(cfgPath, 'utf8')).toBe(before);
      // ③ 本机配置缺该检查：只补齐，其余字段原样保留
      writeFileSync(cfgPath, JSON.stringify({ locale: 'zh', verify: { pre_run_command: 'x', requirements: { env: ['A'] } } }));
      expect(applyRepoVerifyRequirements(root)).toEqual({ action: 'updated', added: ['linux-nondump-cc'] });
      expect(JSON.parse(readFileSync(cfgPath, 'utf8'))).toEqual({ locale: 'zh', verify: { pre_run_command: 'x', requirements: { env: ['A'], checks: decl.checks } } });
      // ④ 同名异命令：报错且不改写
      writeFileSync(cfgPath, JSON.stringify({ verify: { requirements: { checks: [{ name: 'linux-nondump-cc', command: 'true' }] } } }));
      const drift = readFileSync(cfgPath, 'utf8');
      expect(() => applyRepoVerifyRequirements(root)).toThrow(/不一致/);
      expect(readFileSync(cfgPath, 'utf8')).toBe(drift);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ST-S13-43: 本仓 check:linux-nondump-cc 的完整路径', () => {
    const cfg = JSON.parse(readFileSync(join(REPO, 'logos/logos.config.json'), 'utf8'));
    const check = (cfg.verify.requirements?.checks ?? []).find((c: any) => c.name === 'linux-nondump-cc');
    expect(check).toBeDefined();
    const run = spawnSync(check.command, { cwd: REPO, shell: true, encoding: 'utf8' });
    const ccOk = spawnSync('cc', ['--version'], { stdio: 'ignore' }).status === 0;
    const expected = nondumpApplicable() ? (ccOk ? 0 : 1) : 0;
    expect(run.status).toBe(expected);
    // 一次性夹具：复制该 check 与同一验收标准条目，verify 对账通过、预检结论与检查退出码一致
    const f = vsMerged({ verify: { requirements: { checks: [check] } }, extraFiles: { 'scripts/linux-nondump-cc.mjs': readFileSync(join(REPO, 'scripts/linux-nondump-cc.mjs'), 'utf8') } });
    const pp = join(f.proposalDir, 'proposal.md');
    writeFileSync(pp, readFileSync(pp, 'utf8').replace('- 自动验收环境要求：无', '- 自动验收环境要求：`check:linux-nondump-cc` — ST-S13-26 的前置'));
    const r = verify(f);
    expect(r.data.requirements.missing_declarations).toEqual([]);
    if (expected === 0) expect(r.data.requirements.missing_environment).toEqual([]);
    else expect(r.data.requirements.missing_environment).toEqual([{ kind: 'check', name: 'linux-nondump-cc', detail: 'exit 1' }]);
    void copyFileSync;
  });
});
