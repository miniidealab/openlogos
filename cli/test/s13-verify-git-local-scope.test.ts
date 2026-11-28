/**
 * verify-git-local-only 切片 1：验收范围计算的 git 调用只读本地（功能规格 §2.111.1～§2.111.4、§2.111.6、§2.96.6）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 验收期间的 git 调用只读本地测试」严格对齐：
 * UT-S13-309、310、311、313、314、315、316、318、321、322，ST-S13-57、58。
 * （发布级验收、发布查询与验收历史的 UT-S13-312、317、319、320 属于切片 2。）
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 三种观测都不从 CLI 输出推断：「远端有没有收到请求」读远端接入记录，「对象库有没有新增」比较对象库快照，
 * 「某个 git 调用有没有发生、带了什么环境变量」读 git 调用记录。凡断言远端接入记录为空的用例，夹具都先执行对照步骤
 * （不加保护读取同一个缺失对象，记录中出现条目且对象被取回）证明记录有区分力，证明不了时夹具直接失败。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import {
  GIT_LOCAL_OBJECT_MISSING_NOTE, TEST_LAZY_SWITCH_ENV, TEST_TIMEOUT_INJECT_ENV, TEST_TIMEOUT_OVERRIDE_ENV,
} from '../src/lib/git-readonly.js';
import { createScopeProject, runVerify as runMsVerify } from './golden/s13-module-scope-fixture.mjs';
import { editConfig, msProposal } from './golden/s13-shared-config-fixture.mjs';
import {
  ALL_DEFAULT, P_DEFAULT, createLv, declarationSection, declarationYaml, destroyLv, lvEnv, put, runVerify as runLvVerify, table,
} from './golden/s13-layered-fixture.mjs';
import {
  cleanupScratch, installGitRecorder, lvWithRemote, makeContentMissing, makeRemoteOnlyCommit, msWithRemote, objectSnapshot,
  observeComplete, plainGit, processAlive, readGitCalls, remoteHits, scratchDir, setGuardBaseRef,
} from './golden/s13-git-local-fixture.mjs';

vi.setConfig({ testTimeout: 300_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const GOLDEN = JSON.parse(readFileSync(join(CLI_ROOT, 'test/golden/s13-git-local-complete-baseline.json'), 'utf8'));

type Lv = ReturnType<typeof createLv>;
const msRoots: string[] = [];
const lvs: Lv[] = [];
afterEach(() => {
  while (msRoots.length) rmSync(msRoots.pop()!, { recursive: true, force: true });
  while (lvs.length) destroyLv(lvs.pop()!);
  cleanupScratch();
});

function ms(proposal: Record<string, unknown> = {}) {
  const made = msWithRemote(proposal);
  msRoots.push(made.root);
  return made;
}
function lv(opts: Record<string, unknown> = {}) {
  const made = lvWithRemote(buildTestChangeSet, opts);
  lvs.push(made.f);
  return made;
}
/** 夹具 MS，不登记远端（对象齐全）。 */
function msPlain(): string {
  const root = createScopeProject();
  msRoots.push(root);
  msProposal(root);
  return root;
}

const labels = (run: { calls: any[] }): string[] => run.calls.map(c => c.label as string).sort();
const executedOf = (run: { calls: any[] }): string[] => Array.from(new Set(run.calls.flatMap(c => c.executed as string[]))).sort();
const expansionReason = (data: any, code: string) => data.layers.expansion.reasons.find((r: any) => r.code === code);
const inject = (patterns: string[]) => ({ [TEST_TIMEOUT_INJECT_ENV]: JSON.stringify(patterns) });
const hasCall = (calls: Array<{ args: string }>, prefix: string) => calls.some(c => c.args.startsWith(prefix));

describe('S13 验收期间的 git 调用只读本地 — 缺对象时不连接远端', () => {
  it('UT-S13-309: 按模块限定范围：缺文件内容时不连接远端并回落全量', () => {
    const { root, remote, baseRef } = ms();
    const { snapshot } = makeContentMissing(root, remote, baseRef, 'portal-web/app.ts');
    const run = runMsVerify(CLI, root);
    expect(remoteHits(remote)).toBe(0);
    expect(objectSnapshot(root)).toEqual(snapshot);
    expect(run.data.scope.mode).toBe('fallback-full');
    expect(run.data.scope.fallback_reason.code).toBe('diff_failed');
    expect(run.data.scope.fallback_reason.detail).toContain(GIT_LOCAL_OBJECT_MISSING_NOTE);
    expect(labels(run)).toEqual(['core', 'portal-web']);
    expect(run.data.gate.result).toBe('PASS');
  });

  it('UT-S13-310: 分层验收：缺文件内容时不连接远端并扩大到全量', () => {
    const { f, remote, baseRef } = lv();
    const { snapshot } = makeContentMissing(f.root, remote, baseRef, 'src/core.ts');
    const run = runLvVerify(CLI, f);
    expect(remoteHits(remote)).toBe(0);
    expect(objectSnapshot(f.root)).toEqual(snapshot);
    expect(run.data.layers.expansion.level).toBe('full');
    const reason = expansionReason(run.data, 'base_ref_unavailable');
    expect(reason).toBeDefined();
    expect(reason.detail).toContain(GIT_LOCAL_OBJECT_MISSING_NOTE);
    expect(executedOf(run)).toEqual(ALL_DEFAULT);
    expect(run.data.gate.result).toBe('PASS');
  });

  it('UT-S13-311: 缺起点提交对象时不连接远端，判为起点不可达且不执行差异计算', () => {
    // ① 按模块限定范围
    const a = ms();
    const madeA = makeRemoteOnlyCommit(a.root, a.remote);
    setGuardBaseRef(a.root, madeA.commit);
    const recA = installGitRecorder();
    const ra = runMsVerify(CLI, a.root, { env: recA.env() });
    expect(remoteHits(a.remote)).toBe(0);
    expect(objectSnapshot(a.root)).toEqual(madeA.snapshot);
    expect(ra.data.scope.fallback_reason.code).toBe('base_ref_unreachable');
    const callsA = readGitCalls(recA);
    expect(hasCall(callsA, `cat-file -e ${madeA.commit}`)).toBe(true);
    expect(hasCall(callsA, 'diff')).toBe(false);

    // ② 分层验收
    const b = lv();
    const madeB = makeRemoteOnlyCommit(b.f.root, b.remote);
    setGuardBaseRef(b.f.root, madeB.commit);
    const recB = installGitRecorder();
    const rb = runLvVerify(CLI, b.f, { env: recB.env() });
    expect(remoteHits(b.remote)).toBe(0);
    expect(objectSnapshot(b.f.root)).toEqual(madeB.snapshot);
    expect(rb.data.layers.expansion.level).toBe('full');
    const reason = expansionReason(rb.data, 'base_ref_unavailable');
    expect(reason.detail).toContain('base_ref_unreachable');
    expect(reason.detail).not.toContain('diff_failed');
    const callsB = readGitCalls(recB);
    expect(hasCall(callsB, `cat-file -e ${madeB.commit}`)).toBe(true);
    expect(hasCall(callsB, 'diff')).toBe(false);

    // ③ 说明文字按原因分开（原因代码都是 base_ref_unreachable）：真实缺失的提交附「本地缺少对象」；
    //    本地已有但不是提交的对象（一个 tree）不附——取回对象解决不了类型错误
    expect(ra.data.scope.fallback_reason.detail).toContain(GIT_LOCAL_OBJECT_MISSING_NOTE);
    const c = msPlain();
    const tree = plainGit(c, ['rev-parse', 'HEAD^{tree}']).stdout;
    setGuardBaseRef(c, tree);
    const rc = runMsVerify(CLI, c);
    expect(rc.data.scope.fallback_reason.code).toBe('base_ref_unreachable');
    expect(rc.data.scope.fallback_reason.detail).not.toContain(GIT_LOCAL_OBJECT_MISSING_NOTE);
    expect(rc.data.scope.fallback_reason.detail).toContain('tree');
    // ④ 起点是本地完整的提交，但 git 因进程级配置错误而失败（两次 cat-file 都以 128 退出）：
    //    没有缺失的证据，只保留通用的「不可达」，不附缺对象说明，也不说它不是提交
    const d = msPlain();
    const badConfig = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.logAllRefUpdates', GIT_CONFIG_VALUE_0: 'notabool' };
    const rd = runMsVerify(CLI, d, { env: badConfig });
    expect(rd.data.scope.fallback_reason.code).toBe('base_ref_unreachable');
    expect(rd.data.scope.fallback_reason.detail).toMatch(/^baseRef [0-9a-f]{40} 不可达$/);
  });

  it('UT-S13-313: 只有传输协议白名单生效时同样不连接远端（模拟不识别禁用取回开关的 Git）', () => {
    // 如实标注：测试机的 Git 识别 GIT_NO_LAZY_FETCH；这里经接缝不设置该开关，只保留置空的传输协议白名单，
    // 走的是白名单这条路径，不等于在真实的旧版 Git 上执行。
    const simulate = { [TEST_LAZY_SWITCH_ENV]: 'off' };
    const fetchSeen: Record<string, boolean> = {};
    const traceOf = (dir: string) => join(dir, 'git-trace.log');
    const sawFetch = (path: string) => existsSync(path) && /built-in: git fetch|run_command: .*git.*fetch/.test(readFileSync(path, 'utf8'));

    // ① MS +缺内容
    const a = ms();
    const madeA = makeContentMissing(a.root, a.remote, a.baseRef, 'portal-web/app.ts');
    const recA = installGitRecorder();
    const traceA = traceOf(scratchDir('trace'));
    const ra = runMsVerify(CLI, a.root, { env: recA.env({ ...simulate, GIT_TRACE: traceA }) });
    expect(remoteHits(a.remote)).toBe(0);
    expect(objectSnapshot(a.root)).toEqual(madeA.snapshot);
    expect(ra.data.scope.fallback_reason.code).toBe('diff_failed');
    // 模拟确实生效：verify 启动的 git 调用没有带禁用取回的开关，但带着置空的协议白名单
    const diffCall = readGitCalls(recA).find(c => c.args.startsWith('diff'))!;
    expect(diffCall.noLazyFetch).toBe('<unset>');
    expect(diffCall.allowProtocol).toBe('');
    fetchSeen.ms = sawFetch(traceA);

    // ② LV +缺起点
    const b = lv();
    const madeB = makeRemoteOnlyCommit(b.f.root, b.remote);
    setGuardBaseRef(b.f.root, madeB.commit);
    const traceB = traceOf(scratchDir('trace'));
    const rb = runLvVerify(CLI, b.f, { env: { ...simulate, GIT_TRACE: traceB } });
    expect(remoteHits(b.remote)).toBe(0);
    expect(objectSnapshot(b.f.root)).toEqual(madeB.snapshot);
    expect(expansionReason(rb.data, 'base_ref_unavailable').detail).toContain('base_ref_unreachable');
    fetchSeen.lv = sawFetch(traceB);

    // 是否出现过被启动又被拒绝的 fetch 子进程：只记录，不作为失败依据，也不作为通过依据
    expect(typeof fetchSeen.ms).toBe('boolean');
    expect(typeof fetchSeen.lv).toBe('boolean');
  });
});

describe('S13 验收期间的 git 调用只读本地 — 时限', () => {
  it('UT-S13-314: 超过时限按失败的那一次调用归类', () => {
    // 对象齐全、起点提交存在：检查起点提交或收集改动文件超时时按超时回落，不适用「与引入前一致」
    const arms: Array<[string, string, string]> = [
      ['① 检查起点提交', 'cat-file -e', 'base_ref_unreachable'],
      ['② 差异计算', 'diff --name-status', 'diff_failed'],
      ['③ 列出未跟踪文件', 'ls-files --others', 'diff_failed'],
    ];
    for (const [name, pattern, code] of arms) {
      const root = msPlain();
      const rec = installGitRecorder();
      const run = runMsVerify(CLI, root, { env: rec.env(inject([pattern])) });
      expect(run.data, name).not.toBeNull();
      expect(run.data.scope.mode, name).toBe('fallback-full');
      expect(run.data.scope.fallback_reason.code, name).toBe(code);
      expect(run.data.scope.fallback_reason.detail, name).toContain('超时');
      expect(run.data.scope.fallback_reason.detail, name).toContain('60 秒');
      expect(run.data.gate.result, name).toBe('PASS');
      if (name.startsWith('①')) expect(hasCall(readGitCalls(rec), 'diff'), name).toBe(false);
    }
    for (const pattern of ['cat-file -e', 'diff --name-status']) {
      const f = createLv({ buildTestChangeSet });
      lvs.push(f);
      const run = runLvVerify(CLI, f, { env: inject([pattern]) });
      expect(run.data.layers.expansion.level, pattern).toBe('full');
      const reason = expansionReason(run.data, 'base_ref_unavailable');
      expect(reason, pattern).toBeDefined();
      expect(reason.detail, pattern).toContain('超时');
      expect(run.data.gate.result, pattern).toBe('PASS');
    }
  });

  it('UT-S13-321: 超过时限的 git 子进程被真实终止，验收继续', () => {
    const arms: Array<[string, string, string]> = [
      ['① 检查起点提交', 'cat-file -e', 'base_ref_unreachable'],
      ['② 差异计算', 'diff --name-status', 'diff_failed'],
    ];
    for (const [name, pattern, code] of arms) {
      const root = msPlain();
      const rec = installGitRecorder();
      const started = Date.now();
      // 短时限（约 1 秒）驱动真实执行入口；git 替身对匹配的调用写出自己的 PID 后长时间等待
      const run = runMsVerify(CLI, root, { env: rec.env({ [TEST_TIMEOUT_OVERRIDE_ENV]: '1000', VGL_GIT_WAIT_MATCH: pattern }) });
      expect(Date.now() - started, name).toBeLessThan(60_000);
      expect(run.data, `${name} stderr=${run.stderr?.slice(0, 200)}`).not.toBeNull();
      expect(existsSync(rec.pidFile), name).toBe(true);
      const pid = Number(readFileSync(rec.pidFile, 'utf8').trim());
      expect(Number.isInteger(pid) && pid > 0, name).toBe(true);
      expect(processAlive(pid), `${name}：超时的 git 子进程须已被终止`).toBe(false);
      expect(run.data.scope.fallback_reason.code, name).toBe(code);
      expect(run.data.scope.fallback_reason.detail, name).toContain('超时');
      expect(labels(run), name).toEqual(['core', 'portal-web']);
      expect(run.data.gate.result, name).toBe('PASS');
      if (name.startsWith('①')) expect(hasCall(readGitCalls(rec), 'diff'), name).toBe(false);
    }
  });

  it('UT-S13-316: 读取提案起点中的配置内容经受约束的调用，读不到时按整文件变化', () => {
    const describeOnly = (root: string) => editConfig(root, (cfg: any) => { cfg.description = 'changed after baseRef'; });
    // ① 正常：不回落，读取起点内容的调用带三项约束
    const a = msPlain();
    describeOnly(a);
    const rec = installGitRecorder();
    const ra = runMsVerify(CLI, a, { env: rec.env() });
    expect(ra.data.scope.mode).toBe('module');
    const show = readGitCalls(rec).find(c => c.args.startsWith('show ') && c.args.includes('logos/logos.config.json'))!;
    expect(show).toBeDefined();
    expect(show.allowProtocol).toBe('');
    expect(show.noLazyFetch).toBe('1');
    expect(show.terminalPrompt).toBe('0');
    // ② 读取起点内容的调用超时：按整文件变化处理
    const b = msPlain();
    describeOnly(b);
    const rb = runMsVerify(CLI, b, { env: inject(['show ']) });
    expect(rb.data.scope.mode).toBe('fallback-full');
    expect(rb.data.scope.fallback_reason.code).toBe('shared_config_changed');
    expect(rb.data.scope.fallback_reason.detail).toBe('logos/logos.config.json（提案起点中的内容读取失败）');
  });

  it('UT-S13-322: 对象齐全时读取某份文档的合并前内容超时，只影响那一份文档', () => {
    const f = mergedTwoMainPathDocs();
    const marker = JSON.parse(readFileSync(join(f.root, 'logos/changes', SLUG, 'SPEC_MERGED'), 'utf8'));
    const s02Blob: string = marker.merge_baseline.targets.find((t: any) => t.path.endsWith('core-S02-test-cases.md')).before.git_blob;
    // 对照：不注入超时时两份文档都不并入
    const control = runLvVerify(CLI, f);
    expect(control.data.layers.affected.scenarios).toEqual([]);
    const run = runLvVerify(CLI, f, { env: inject([`cat-file blob ${s02Blob}`]) });
    expect(run.data.layers.affected.scenarios).toEqual([{ id: 'S02', sources: ['delta'] }]);
    expect(run.data.layers.expansion).toEqual({ level: 'none', reasons: [] });
    expect(run.data.gate.reason).not.toBe('test_change_set_invalid');
  });
});

describe('S13 验收期间的 git 调用只读本地 — 门禁与对象齐全', () => {
  it('UT-S13-315: 回落之后门禁按实际结果判定', () => {
    const run = (script?: Record<string, unknown>) => {
      const { f, remote, baseRef } = lv(script ? { script } : {});
      makeContentMissing(f.root, remote, baseRef, 'src/core.ts');
      return runLvVerify(CLI, f);
    };
    // ① 全部 pass
    const a = run();
    expect(a.data.gate.result).toBe('PASS');
    // ② 提案集合之外的 UT-S03-02 持续失败：入口因它非零退出并写出了失败记录，没有优先级更高的原因
    const b = run({ cases: { 'UT-S03-02': 'fail' } });
    expect(executedOf(b)).toContain('UT-S03-02');
    expect(b.data.failed_cases.map((c: any) => c.id)).toContain('UT-S03-02');
    expect(b.data.gate.result).toBe('FAIL');
    expect(b.data.gate.reason).toBe('failed_cases');
    expect(b.status).toBe(1);
    // ③ 另有主链路用例首跑失败、复跑通过：既有优先级不因扩大改变
    const c = run({ cases: { 'UT-S03-02': 'fail', 'UT-S03-01': ['fail', 'pass'] } });
    expect(c.data.gate.result).toBe('FAIL');
    expect(c.data.gate.reason).toBe('main_path_flaky');
    // 三臂的扩大原因相同
    for (const r of [a, b, c]) {
      expect(r.data.layers.expansion.level).toBe('full');
      expect(expansionReason(r.data, 'base_ref_unavailable').detail).toContain('diff_failed');
    }
  });

  it('UT-S13-318: 对象齐全且调用及时完成时与引入前一致，仍能缩小范围', () => {
    const now = observeComplete(CLI, buildTestChangeSet);
    // 明确断言仍然缩小了范围
    expect(now['ms-narrowed'].envelope.data.scope.mode).toBe('module');
    expect(now['ms-narrowed'].calls.map((c: any) => c.label)).toEqual(['portal-web']);
    expect(now['lv-narrowed'].envelope.data.layers.expansion).toEqual({ level: 'none', reasons: [] });
    expect(Array.from(new Set(now['lv-narrowed'].calls.flatMap((c: any) => c.executed))).sort()).toEqual(P_DEFAULT);
    expect(now['ms-remote-hits']).toBe(0);
    expect(now['lv-remote-hits']).toBe(0);
    // 与引入前实现（0.16.29）在同一夹具上生成的 golden 逐项相同：JSON（归一化后）、验收报告、调用记录与退出码
    expect(now).toEqual(GOLDEN);
  });
});

describe('S13 验收期间的 git 调用只读本地 — 场景测试', () => {
  it('ST-S13-57: 部分克隆缺对象的多模块项目：验收不联网，回落全量后给出结论', () => {
    // ① +缺内容
    const a = ms();
    const madeA = makeContentMissing(a.root, a.remote, a.baseRef, 'portal-web/app.ts');
    const ra = runMsVerify(CLI, a.root);
    expect(ra.status).toBe(0);
    expect(ra.data.scope.fallback_reason.code).toBe('diff_failed');
    // ② 另一个项目 +缺起点
    const b = ms();
    const madeB = makeRemoteOnlyCommit(b.root, b.remote);
    setGuardBaseRef(b.root, madeB.commit);
    const rb = runMsVerify(CLI, b.root);
    expect(rb.status).toBe(0);
    expect(rb.data.scope.fallback_reason.code).toBe('base_ref_unreachable');
    // ③ 两个项目：远端没有收到请求、对象库不变、两个模块的命令组都执行、报告写明回落原因、VERIFY_PASS 已写入
    for (const [project, made, run, code] of [[a, madeA, ra, 'diff_failed'], [b, madeB, rb, 'base_ref_unreachable']] as const) {
      expect(remoteHits(project.remote), code).toBe(0);
      expect(objectSnapshot(project.root), code).toEqual(made.snapshot);
      expect(labels(run), code).toEqual(['core', 'portal-web']);
      expect(run.report, code).toContain(code);
      expect(existsSync(join(project.root, 'logos/changes/msv-demo/VERIFY_PASS')), code).toBe(true);
    }
  });

  it('ST-S13-58: 分层项目：对象齐全时照常收窄，缺对象后扩大并如实判定', () => {
    // 提案集合之外的 UT-S03-02 实际会失败，没有其他门禁原因
    const { f, remote, baseRef } = lv({ script: { cases: { 'UT-S03-02': 'fail' } } });
    // ① 对象齐全
    const first = runLvVerify(CLI, f);
    expect(first.status).toBe(0);
    expect(first.data.layers.expansion.level).toBe('none');
    expect(executedOf(first)).not.toContain('UT-S03-02');
    const hitsFirst = remoteHits(remote);
    // ② 制造 +缺内容 后再次执行
    makeContentMissing(f.root, remote, baseRef, 'src/core.ts');
    const second = runLvVerify(CLI, f);
    expect(second.data.layers.expansion.level).toBe('full');
    expect(executedOf(second)).toContain('UT-S03-02');
    expect(second.status).toBe(1);
    expect(second.data.gate.reason).toBe('failed_cases');
    expect(second.report).toContain('base_ref_unavailable');
    // ③ 两次的远端接入记录都为空
    expect(hitsFirst).toBe(0);
    expect(remoteHits(remote)).toBe(0);
  });
});

// —— UT-S13-322 的夹具：分层项目（对象齐全），提案 delta 含两份只新增「主链路用例」小节的测试用例文档，经真实 merge 写入 SPEC_MERGED ——

const SLUG = 'vgl-demo';
const docWithHeadings = (ids: string[]) => `# 测试用例\n\n## 单元测试\n\n${table(ids)}\n## 覆盖度校验\n\n- 覆盖说明\n`;
const mainPathDelta = (ids: string[]) => `## ADDED — 主链路用例\n\n${ids.map(id => `- ${id}`).join('\n')}\n`;

function mergeableProposal(): string {
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
    declarationSection(declarationYaml({ scenarios: [] })),
    '## 复用测试 ID', '', '- UT-S03-01 — 夹具既有用例', '',
    '## 变更概述', '夹具。', '',
  ].join('\n');
}

function mergedTwoMainPathDocs(): Lv {
  const f = createLv({
    // commitAll 需要有内容可提交：另放一个源码文件，使初始内容与本次提交都非空
    guard: 'none', commitAll: true, changes: { 'src/extra.ts': 'export const extra = 1;\n' },
    docs: {
      'core-S01-test-cases.md': docWithHeadings(['UT-S01-01', 'UT-S01-02', 'UT-S01-03']),
      'core-S02-test-cases.md': docWithHeadings(['UT-S02-01', 'UT-S02-02']),
    },
  });
  lvs.push(f);
  const cli = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
    cwd: f.root, encoding: 'utf8', timeout: 120_000, env: lvEnv(f, { OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' }),
  });
  const created = cli(['change', SLUG]);
  expect(created.status, created.stderr || created.stdout).toBe(0);
  const deltas = { 'test/core-S01-test-cases.md': mainPathDelta(['UT-S01-01']), 'test/core-S02-test-cases.md': mainPathDelta(['UT-S02-01']) };
  put(f.root, `logos/changes/${SLUG}/proposal.md`, mergeableProposal());
  put(f.root, `logos/changes/${SLUG}/tasks.md`, [
    '# 实现任务', '', '## [delta] 规格变更', '', ...Object.keys(deltas).map(t => `- [x] 产出 delta 到 \`deltas/${t}\`。`), '', '## [code] 代码实现', '',
  ].join('\n'));
  for (const [rel, content] of Object.entries(deltas)) put(f.root, `logos/changes/${SLUG}/deltas/${rel}`, content);
  const merged = cli(['merge', SLUG]);
  expect(merged.status, merged.stderr || merged.stdout).toBe(0);
  return f;
}
