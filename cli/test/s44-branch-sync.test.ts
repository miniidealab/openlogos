/**
 * branch-sync-generated-files 切片 2：openlogos branch sync 主链路（S44）。
 *
 * 覆盖 UT-S44-02、UT-S44-03、UT-S44-04、UT-S44-13、UT-S44-16、UT-S44-17、UT-S44-19、UT-S44-20、UT-S44-21、
 * UT-S44-23、UT-S44-25、UT-S44-26、ST-S44-01、ST-S44-02（logos/resources/test/core-S44-test-cases.md）。
 * 规范源：spec/branch-sync.md §4、§7～§9；spec/cli-json-output.md「`openlogos branch sync|status --format json`」。
 * 一次性 git 仓库（见 s44-helpers.ts），除清单计算函数与 verify 白名单外全部经真实 CLI 进程执行。
 * 「零改动」以全部文件、git 索引与各分支指向的前后比对取证；「取主分支版本」以 `git show main:<path>` 比对取证。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { computeReplaceList, BranchError } from '../src/lib/branch-sync.js';
import { normalizeVerifyConfig, readVerifyConfig } from '../src/lib/verify-config.js';
import { verifyReportAllowPaths } from '../src/commands/verify.js';
import { cleanupFixtures, CLI, CONFIG, Fixture, LEDGER, REGISTRY, REPORT, VERIFY } from './s44-helpers.js';

afterEach(cleanupFixtures);

const MULTI_REGISTRY = stringifyYaml({
  project: { name: 'x' },
  modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'team', name: 'Team', lifecycle: 'initial' }],
  resource_index: [],
  conventions: ['约定'],
});
const DEPLOY_REPORT = `${VERIFY}/deployment-report.md`;
const EVENTS = `${VERIFY}/baseline-events.jsonl`;
const REQ = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';
const paths = (list: Array<{ path: string }>): string[] => list.map(i => i.path).sort();

/** 两条分支各自重写验收报告与结果账本的常用构造。 */
function rewriteArtifacts(fx: Fixture, who: string): void {
  fx.put(REPORT, `# Acceptance Report\n\n${who}\n`);
  fx.put(LEDGER, `{"id":"UT-${who}-01","status":"pass"}\n`);
}

/** 以 spawn 读取 stdout / stderr 直至 EOF（管道消费方）。 */
function spawnCli(cwd: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += String(d); });
    child.stderr.on('data', d => { stderr += String(d); });
    child.on('error', reject);
    child.on('close', code => resolvePromise({ code, stdout, stderr }));
  });
}

describe('S44 同步处置清单', () => {
  it('UT-S44-02: 内置项只含验收报告与测试结果账本，路径取自 verify 的解析结果', () => {
    // ① 单模块、默认 verify 配置
    const single = new Fixture();
    expect(paths(computeReplaceList(single.root))).toEqual([REPORT, LEDGER].sort());

    // ② 登记 core、team 两个模块
    const multi = new Fixture({ registry: MULTI_REGISTRY });
    expect(paths(computeReplaceList(multi.root))).toEqual(
      [REPORT, LEDGER, `${VERIFY}/core-acceptance-report.md`, `${VERIFY}/team-acceptance-report.md`].sort());

    // ③ 自定义三个结果路径：不再含默认结果路径
    const custom = new Fixture({ config: { verify: {
      result_path: 'reports/out/final.jsonl', regression_result_path: 'reports/out/regression.jsonl', incremental_result_path: './reports/out/incremental.jsonl',
    } } });
    const customList = computeReplaceList(custom.root);
    expect(paths(customList)).toEqual([REPORT, 'reports/out/final.jsonl', 'reports/out/incremental.jsonl', 'reports/out/regression.jsonl'].sort());
    expect(customList.find(i => i.path === 'reports/out/final.jsonl')).toMatchObject({ source: 'builtin', config_key: 'verify.result_path' });

    // 三例均不含冒烟结果与报告、部署报告、基线运行目录、基线事件账本
    for (const fx of [single, multi, custom]) {
      const list = paths(computeReplaceList(fx.root));
      for (const p of list) {
        expect(p).not.toMatch(/smoke|deployment-report|baseline-seed-runs|baseline-events/);
      }
    }
  });

  it('UT-S44-03: 项目追加路径的校验——合法条目进入清单，非法条目在发起合并前零改动拒绝', () => {
    const fx = new Fixture();
    fx.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));

    // ①②③ 通过校验，对应路径进入清单
    for (const entry of [`${VERIFY}/run-log.jsonl`, `${VERIFY}/reports/`, `${VERIFY}/*/summary.md`]) {
      fx.setConfig({ branch_sync: { replace_paths: [entry] } });
      const list = computeReplaceList(fx.root);
      expect(list.find(i => i.path === entry)).toEqual({ path: entry, source: 'config', config_key: 'branch_sync.replace_paths' });
    }

    // ④～⑫ 非法：BRANCH_SYNC_CONFIG_INVALID，全部文件与索引不变、未发起合并
    const invalid: Array<[unknown, string]> = [
      [['cli/dist/'], 'outside-verify-dir'],
      [[`${VERIFY}/baseline-seed-runs/`], 'protected-path'],
      [[`${VERIFY}/baseline-seed-runs/r1/run.json`], 'protected-path'],
      [[`${VERIFY}/baseline-events.jsonl`], 'protected-path'],
      [[`${VERIFY}/deployment-report.md`], 'protected-path'],
      [[`${VERIFY}/team-deployment-report.md`], 'protected-path'],
      [[`${VERIFY}/`], 'protected-path'],
      [[`${VERIFY}/../x`], 'syntax'],
      ['not-an-array', 'type'],
    ];
    for (const [replacePaths, reason] of invalid) {
      fx.setConfig({ branch_sync: { replace_paths: replacePaths } });
      fx.commit(`config ${reason}`);
      const before = fx.state();
      const r = fx.sync();
      expect(r.status, JSON.stringify(replacePaths)).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.error!.code).toBe('BRANCH_SYNC_CONFIG_INVALID');
      expect(r.error!.details.entries).toHaveLength(1);
      expect(r.error!.details.entries[0]).toMatchObject({ config_key: 'branch_sync.replace_paths', reason });
      expect(fx.state()).toEqual(before);
      expect(fx.merging()).toBe(false);
    }

    // 进程内同样以 BranchError 表达
    expect(() => computeReplaceList(fx.root)).toThrowError(BranchError);
  }, 60_000);

  it('UT-S44-04: 清单内的文件取主分支版本，主分支没有的删除，未被跟踪的同名文件不动', () => {
    const fx = new Fixture({ registry: MULTI_REGISTRY, config: { branch_sync: { replace_paths: [`${VERIFY}/run-log.jsonl`] } } });
    fx.diverge(
      f => { rewriteArtifacts(f, 'A'); f.put(`${VERIFY}/team-acceptance-report.md`, '# team\n\nA\n'); },
      f => rewriteArtifacts(f, 'B'),
    );
    // 清单内、但未被跟踪的本地文件
    fx.put(`${VERIFY}/run-log.jsonl`, 'local only\n');

    const r = fx.sync();
    expect(r.status).toBe(0);
    expect(r.data!.result).toBe('synced');
    expect(fx.read(REPORT)).toBe(fx.show('main', REPORT));
    expect(fx.read(LEDGER)).toBe(fx.show('main', LEDGER));
    expect(fx.read(REPORT)).not.toContain('<<<<<<<');
    expect(fx.exists(`${VERIFY}/team-acceptance-report.md`)).toBe(false);
    expect(r.data!.replaced).toEqual([
      { path: REPORT, action: 'took-base' },
      { path: `${VERIFY}/team-acceptance-report.md`, action: 'deleted' },
      { path: LEDGER, action: 'took-base' },
    ]);
    expect(fx.read(`${VERIFY}/run-log.jsonl`)).toBe('local only\n');
    expect(fx.git(['status', '--porcelain', '--untracked-files=no'])).toBe('');

    // 另一用例：两边把验收报告改成相同内容——不计入 replaced
    const same = new Fixture();
    same.diverge(
      f => { f.put(REPORT, '# same\n'); f.put(LEDGER, 'A\n'); },
      f => { f.put(REPORT, '# same\n'); f.put(LEDGER, 'B\n'); },
    );
    const rs = same.sync();
    expect(rs.data!.result).toBe('synced');
    expect(rs.data!.replaced).toEqual([{ path: LEDGER, action: 'took-base' }]);
  }, 30_000);

  it('UT-S44-26: 内置结果路径命中保护路径时拒绝；verify 对该配置的处理不变；合法自定义路径照常处置', () => {
    const fx = new Fixture();
    fx.put(DEPLOY_REPORT, '# Deployment Report\n\nO\n');
    fx.put(`${VERIFY}/baseline-seed-runs/r1/run.json`, '{"run":"O"}\n');
    fx.commit('records');
    fx.diverge(
      f => { f.put(DEPLOY_REPORT, '# Deployment Report\n\nA\n'); f.put(`${VERIFY}/baseline-seed-runs/r1/run.json`, '{"run":"A"}\n'); f.put('logos/changes/a/VERIFY_PASS', ''); },
      f => { f.put(DEPLOY_REPORT, '# Deployment Report\n\nB\n'); f.put(`${VERIFY}/baseline-seed-runs/r1/run.json`, '{"run":"B"}\n'); },
    );
    const base = { sandbox_mode: 'auto', sandbox_root: '/private/tmp', sandbox_deny_workspace_write: true };
    const cases: Array<[Record<string, string>, string]> = [
      [{ result_path: DEPLOY_REPORT }, 'verify.result_path'],
      [{ result_path: `${VERIFY}/baseline-seed-runs/r1/run.json` }, 'verify.result_path'],
      [{ result_path: LEDGER, regression_result_path: EVENTS }, 'verify.regression_result_path'],
      [{ result_path: LEDGER, incremental_result_path: `${VERIFY}/team-deployment-report.md` }, 'verify.incremental_result_path'],
    ];
    for (const [verify, key] of cases) {
      fx.setConfig({ verify: { ...base, ...verify } });
      fx.commit(`config ${key}`);
      const before = fx.state();
      const r = fx.sync();
      expect(r.status, key).toBe(1);
      expect(r.error!.code).toBe('BRANCH_SYNC_CONFIG_INVALID');
      expect(r.error!.details.entries).toEqual([{ config_key: key, value: Object.values(verify).at(-1), reason: 'protected-path' }]);
      expect(fx.state()).toEqual(before);
      expect(fx.merging()).toBe(false);
      expect(fx.exists('logos/changes/a/VERIFY_PASS')).toBe(true);
    }
    // verify 行为不变：结果路径原样成为规范化结果
    expect(normalizeVerifyConfig({ result_path: DEPLOY_REPORT }).resultPath).toBe(DEPLOY_REPORT);
    expect(normalizeVerifyConfig({ result_path: `${VERIFY}/baseline-seed-runs/r1/run.json` }).resultPath).toBe(`${VERIFY}/baseline-seed-runs/r1/run.json`);

    // ⑤ 对照：验收目录之外的合法自定义结果路径
    const custom = new Fixture({ config: { verify: { ...base, result_path: 'reports/out/results.jsonl' } } });
    custom.put('reports/out/results.jsonl', 'O\n');
    custom.commit('custom ledger');
    custom.diverge(f => f.put('reports/out/results.jsonl', 'A\n'), f => f.put('reports/out/results.jsonl', 'B\n'));
    const rc = custom.sync();
    expect(rc.status).toBe(0);
    expect(rc.data!.replaced).toContainEqual({ path: 'reports/out/results.jsonl', action: 'took-base' });
    expect(custom.read('reports/out/results.jsonl')).toBe('B\n');
  }, 60_000);

  it('UT-S44-04 / UT-S44-26: 取主分支版本是逐字节的——签出会做换行转换的仓库里仍与主分支 blob 完全一致（普通合并与快进）', () => {
    const CUSTOM = 'reports/out/results.jsonl';
    const base = { sandbox_mode: 'auto', sandbox_root: '/private/tmp', sandbox_deny_workspace_write: true, result_path: CUSTOM };
    const ledger = (who: string): string => `{"id":"UT-${who}-01","status":"pass"}\n{"id":"UT-${who}-02","status":"pass"}\n`;
    const report = (who: string): string => `# Acceptance Report\n\n${who}\n\n| a | b |\n|---|---|\n`;
    /** 验收目录之外的自定义账本；setup 决定用哪种会改写签出字节的配置。 */
    const build = (setup: (fx: Fixture) => void, ownCommit: boolean): Fixture => {
      const fx = new Fixture({ config: { verify: base } });
      setup(fx);
      fx.put(CUSTOM, ledger('O'));
      fx.put(REPORT, report('O'));
      fx.commit('custom ledger');
      fx.git(['checkout', '-q', '-b', 'proposal/a']);
      if (ownCommit) { fx.put(CUSTOM, ledger('A')); fx.put(REPORT, report('A')); fx.commit('A'); }
      fx.git(['checkout', '-q', 'main']);
      fx.put(CUSTOM, ledger('B'));
      fx.put(REPORT, report('B'));
      fx.commit('B');
      fx.git(['checkout', '-q', 'proposal/a']);
      return fx;
    };
    const autocrlf = (fx: Fixture): void => { fx.git(['config', 'core.autocrlf', 'true']); };
    const eolAttr = (fx: Fixture): void => { fx.put('.gitattributes', 'reports/** text eol=crlf\n*.md text eol=crlf\n'); };

    for (const [label, setup, ownCommit] of [
      ['autocrlf / 普通合并', autocrlf, true], ['autocrlf / 快进', autocrlf, false],
      ['eol=crlf 属性 / 普通合并', eolAttr, true], ['eol=crlf 属性 / 快进', eolAttr, false],
    ] as const) {
      const fx = build(setup, ownCommit);
      // 前提成立：git 自己签出这些文件时确实会写成 CRLF
      expect(fx.bytes(CUSTOM).includes(Buffer.from('\r\n')), label).toBe(true);
      const r = fx.sync();
      expect(r.status, `${label}: ${r.stderr}`).toBe(0);
      expect(r.data).toMatchObject({ result: 'synced', fast_forward: !ownCommit });
      // 以 Buffer 比较工作区与主分支 blob，不做换行归一化
      for (const p of [CUSTOM, REPORT]) {
        expect(fx.bytes(p).equals(fx.blob('main', p)), `${label}: ${p}`).toBe(true);
        expect(fx.bytes(p).includes(Buffer.from('\r\n')), `${label}: ${p}`).toBe(false);
      }
      if (ownCommit) expect(r.data!.replaced).toEqual([{ path: REPORT, action: 'took-base' }, { path: CUSTOM, action: 'took-base' }]);
      // 最终工作区仍符合成功契约：干净，且 HEAD 中的 blob 就是主分支的 blob
      expect(fx.git(['status', '--porcelain']), label).toBe('');
      expect(fx.git(['rev-parse', `HEAD:${CUSTOM}`])).toBe(fx.git(['rev-parse', `main:${CUSTOM}`]));
    }
  }, 60_000);

  it('UT-S44-21: verify 沙箱写入白名单在配置 replace_paths 前后逐项相同', () => {
    const extra = { branch_sync: { replace_paths: [`${VERIFY}/run-log.jsonl`, `${VERIFY}/reports/`] } };
    const allow = (fx: Fixture): string[] => [...verifyReportAllowPaths(fx.root, readVerifyConfig(fx.root))].sort();

    for (const registry of [undefined, MULTI_REGISTRY]) {
      const plain = new Fixture({ registry });
      const configured = new Fixture({ registry, config: extra });
      expect(allow(configured)).toEqual(allow(plain));
      expect(allow(configured).some(p => p.includes('run-log.jsonl') || p.includes('/reports'))).toBe(false);
    }

    // 测试进程写入追加路径：两个夹具得到相同的沙箱审计结论
    const audit = (config: Record<string, unknown>): { status: unknown; diagnostics: unknown } => {
      const fx = new Fixture({ config });
      fx.setConfig({ verify: {
        result_path: LEDGER,
        pre_run_command: `mkdir -p ${VERIFY}/reports && echo x > ${VERIFY}/reports/x.md && echo '{"id":"UT-S01-01","status":"pass"}' > ${LEDGER}`,
        sandbox_mode: 'auto', sandbox_root: '/private/tmp', sandbox_deny_workspace_write: true,
      } });
      fx.put('logos/resources/test/core-S01-test-cases.md', '# t\n\n| ID | 描述 |\n|----|----|\n| UT-S01-01 | a |\n');
      const r = fx.cli(['verify', '--format', 'json']);
      const sandbox = (JSON.parse(r.stdout) as Record<string, any>).data.sandbox;
      return { status: sandbox.status, diagnostics: sandbox.diagnostics };
    };
    const without = audit({});
    const withPaths = audit(extra);
    expect(withPaths).toEqual(without);
    // 追加路径没有成为写入授权：对 reports/x.md 的写入仍被审计点名
    expect(JSON.stringify(withPaths.diagnostics)).toContain(`${VERIFY}/reports/x.md`);
  }, 60_000);
});

describe('S44 branch sync — 前置条件与结果', () => {
  it('UT-S44-13: 前置条件不满足时零改动拒绝；只有未跟踪的新文件不构成拒绝', () => {
    const fx = new Fixture();
    fx.put('logos/changes/a/VERIFY_PASS', '');
    fx.commit('marker');
    fx.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));

    const expectRejected = (code: string, setup: () => void, restore: () => void): void => {
      setup();
      const before = fx.state();
      const r = fx.sync();
      expect(r.status, code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.error!.code).toBe(code);
      expect(fx.state()).toEqual(before);
      expect(fx.exists('logos/changes/a/VERIFY_PASS')).toBe(true);
      restore();
    };
    // ② 未暂存改动；③ 已暂存改动
    expectRejected('BRANCH_WORKTREE_DIRTY', () => fx.put(REPORT, 'dirty\n'), () => fx.git(['checkout', '--', REPORT]));
    expectRejected('BRANCH_WORKTREE_DIRTY',
      () => { fx.put(REPORT, 'staged\n'); fx.git(['add', REPORT]); },
      () => { fx.git(['reset', '-q', 'HEAD', '--', REPORT]); fx.git(['checkout', '--', REPORT]); });
    // ⑤ 进行中的合并；⑥ 进行中的变基
    expectRejected('BRANCH_OPERATION_IN_PROGRESS',
      () => { fx.tryGit(['merge', '--no-ff', '--no-commit', 'main']); expect(fx.merging()).toBe(true); },
      () => fx.git(['merge', '--abort']));
    expectRejected('BRANCH_OPERATION_IN_PROGRESS',
      () => { fx.tryGit(['rebase', '--exec', 'false', 'HEAD~1']); },
      () => fx.git(['rebase', '--abort']));
    // ⑦ 没有共同起点（孤儿分支）
    fx.git(['checkout', '-q', '--orphan', 'lonely']);
    fx.commit('orphan');
    expectRejected('BRANCH_NO_MERGE_BASE', () => undefined, () => fx.git(['checkout', '-q', 'proposal/a']));

    // ① 非 git 目录；⑧ 未初始化的目录
    const plain = new Fixture({ init: false });
    const notRepo = new Fixture({ init: false });
    notRepo.put(CONFIG, JSON.stringify({ name: 'x', locale: 'en', documents: {} }));
    const r1 = notRepo.sync();
    // 临时目录不在任何 git 仓库内
    expect(r1.status).toBe(1);
    expect(r1.stdout).toBe('');
    expect(r1.error!.code).toBe('BRANCH_NOT_GIT_REPO');
    const r8 = plain.sync();
    expect(r8.status).toBe(1);
    expect(r8.error!.code).toBe('PROJECT_NOT_INITIALIZED');
    expect(plain.files()).toEqual({});

    // ④ 只有未跟踪的新文件：不被拒绝，正常同步
    fx.put('scratch/notes.txt', 'untracked\n');
    const ok = fx.sync();
    expect(ok.status).toBe(0);
    expect(ok.data!.result).toBe('synced');
    expect(fx.read('scratch/notes.txt')).toBe('untracked\n');
  }, 60_000);

  it('UT-S44-16: 不进清单的验收目录文件按普通文件由 git 合并，CLI 不取任何一边、不删除', () => {
    const fx = new Fixture();
    fx.put(DEPLOY_REPORT, '# Deployment Report\n\n## deploy 1\n');
    fx.put(`${VERIFY}/smoke-results.jsonl`, '{"id":"SMOKE-O"}\n');
    fx.put(`${VERIFY}/smoke-report.md`, '# Smoke\n\nO\n');
    fx.put(EVENTS, '{"event":"o"}\n');
    fx.commit('records');
    fx.diverge(
      f => {
        f.put(DEPLOY_REPORT, '# Deployment Report\n\n## deploy 1\n\n## deploy A\n');
        f.put(`${VERIFY}/smoke-results.jsonl`, '{"id":"SMOKE-A"}\n');
        f.put(`${VERIFY}/smoke-report.md`, '# Smoke\n\nA\n');
        f.put(EVENTS, '{"event":"o"}\n{"event":"a"}\n');
        f.put(`${VERIFY}/deployment-artifacts/x/pkg.tgz`, 'binary-ish\n');
        rewriteArtifacts(f, 'A');
      },
      f => {
        f.put(DEPLOY_REPORT, '# Deployment Report\n\n## deploy 1\n\n## deploy B\n');
        f.put(`${VERIFY}/smoke-results.jsonl`, '{"id":"SMOKE-B"}\n');
        f.put(`${VERIFY}/smoke-report.md`, '# Smoke\n\nB\n');
        f.put(EVENTS, '{"event":"o"}\n{"event":"b"}\n');
        rewriteArtifacts(f, 'B');
      },
    );
    const r = fx.sync();
    expect(r.status).toBe(2);
    const records = [DEPLOY_REPORT, `${VERIFY}/smoke-results.jsonl`, `${VERIFY}/smoke-report.md`, EVENTS];
    const replacedPaths = (r.data!.replaced as Array<{ path: string }>).map(i => i.path);
    for (const p of [...records, `${VERIFY}/deployment-artifacts/x/pkg.tgz`]) expect(replacedPaths).not.toContain(p);
    for (const p of records) {
      expect(r.data!.remaining_conflicts).toContainEqual({ path: p, category: 'verify-record', reason: 'git-conflict' });
      // 文件中保留 git 的冲突标记：CLI 没有取任何一边
      expect(fx.read(p)).toContain('<<<<<<<');
      // 合并的输入是已确认的提交，冲突标记里的标签是该提交的哈希
      expect(fx.read(p)).toContain(`>>>>>>> ${fx.git(['rev-parse', 'main'])}`);
    }
    expect(fx.read(`${VERIFY}/deployment-artifacts/x/pkg.tgz`)).toBe('binary-ish\n');
    // 清单内的文件照常处置
    expect(fx.read(REPORT)).toBe(fx.show('main', REPORT));
  });

  it('UT-S44-17: 剩余冲突按路径升序列出类别与原因，合并现场保留', () => {
    const fx = new Fixture();
    const clash = [CONFIG, REQ, 'logos/changes/a/proposal.md', 'cli/src/x.ts', DEPLOY_REPORT];
    for (const p of clash.slice(1)) fx.put(p, 'line 1\nshared\nline 3\n');
    fx.commit('files');
    const edit = (f: Fixture, who: string): void => {
      for (const p of clash.slice(1)) f.put(p, `line 1\n${who}\nline 3\n`);
      f.setConfig({ description: `changed by ${who}` });
      rewriteArtifacts(f, who);
    };
    const { prop } = fx.diverge(f => edit(f, 'A'), f => edit(f, 'B'));
    const plain = Object.fromEntries(clash.map(p => [p, fx.plainMergeBytes(p)]));

    const r = fx.sync();
    expect(r.status).toBe(2);
    expect(r.data!.result).toBe('conflicts');
    expect(r.data!.remaining_conflicts).toEqual([
      { path: 'cli/src/x.ts', category: 'other', reason: 'git-conflict' },
      { path: 'logos/changes/a/proposal.md', category: 'proposal', reason: 'git-conflict' },
      { path: CONFIG, category: 'config', reason: 'git-conflict' },
      { path: REQ, category: 'spec', reason: 'git-conflict' },
      { path: DEPLOY_REPORT, category: 'verify-record', reason: 'git-conflict' },
    ]);
    // 验收报告不在其中且已取主分支版本
    expect(fx.read(REPORT)).toBe(fx.show('main', REPORT));
    expect(r.data!.replaced).toContainEqual({ path: REPORT, action: 'took-base' });
    // 合并保持进行中；冲突文件的字节等于 git 合并后的内容
    expect(fx.merging()).toBe(true);
    expect(fx.head()).toBe(prop);
    for (const p of clash) expect(fx.read(p)).toBe(plain[p]);
  }, 30_000);

  it('UT-S44-19: 引入主分支提交后清除未归档提案的验收与交付标记；已是最新时不清除', () => {
    const build = (withClash: boolean): Fixture => {
      const fx = new Fixture();
      fx.put('clash.txt', 'shared\n');
      fx.commit('clash base');
      fx.diverge(
        f => {
          rewriteArtifacts(f, 'A');
          if (withClash) f.put('clash.txt', 'A\n');
          // 提案 a 的标记被 git 跟踪
          for (const m of ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS', 'PLAN_APPROVED']) f.put(`logos/changes/a/${m}`, `${m}\n`);
          f.put('logos/changes/archive/20260101-old/VERIFY_PASS', 'archived\n');
        },
        f => { rewriteArtifacts(f, 'B'); if (withClash) f.put('clash.txt', 'B\n'); },
      );
      // 提案 b 的标记未被跟踪
      fx.put('logos/changes/b/VERIFY_FAIL', 'fail\n');
      return fx;
    };
    const expectCleared = (fx: Fixture, data: Record<string, any>): void => {
      expect(data.invalidated_markers).toEqual([
        { slug: 'a', markers: ['DEPLOY_DONE', 'SMOKE_PASS', 'VERIFY_PASS'] },
        { slug: 'b', markers: ['VERIFY_FAIL'] },
      ]);
      for (const m of ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS']) expect(fx.exists(`logos/changes/a/${m}`)).toBe(false);
      expect(fx.exists('logos/changes/b/VERIFY_FAIL')).toBe(false);
      expect(fx.exists('logos/changes/a/PLAN_APPROVED')).toBe(true);
      expect(fx.read('logos/changes/archive/20260101-old/VERIFY_PASS')).toBe('archived\n');
    };

    // synced：被跟踪标记的删除出现在合并提交中
    const synced = build(false);
    const r1 = synced.sync();
    expect(r1.data!.result).toBe('synced');
    expectCleared(synced, r1.data!);
    const tree = synced.git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n');
    expect(tree).not.toContain('logos/changes/a/VERIFY_PASS');
    expect(tree).toContain('logos/changes/a/PLAN_APPROVED');
    expect(tree).toContain('logos/changes/archive/20260101-old/VERIFY_PASS');
    expect(synced.git(['status', '--porcelain', '--untracked-files=no'])).toBe('');

    // conflicts：同样清除
    const conflicted = build(true);
    const r2 = conflicted.sync();
    expect(r2.data!.result).toBe('conflicts');
    expectCleared(conflicted, r2.data!);

    // up-to-date：全部标记仍在
    synced.put('logos/changes/a/VERIFY_PASS', 'again\n');
    synced.put('logos/changes/b/VERIFY_FAIL', 'again\n');
    const r3 = synced.sync();
    expect(r3.data!.result).toBe('up-to-date');
    expect(r3.data!.invalidated_markers).toEqual([]);
    expect(synced.read('logos/changes/a/VERIFY_PASS')).toBe('again\n');
    expect(synced.read('logos/changes/b/VERIFY_FAIL')).toBe('again\n');
  }, 60_000);

  it('UT-S44-19: 标记清除不跟随符号链接——提案目录或 changes 根指向项目外时，外部标记保持原字节', () => {
    const MARKERS = ['VERIFY_PASS', 'VERIFY_FAIL', 'DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL'];
    const outside = (): Fixture => {
      const dir = new Fixture({ init: false });
      for (const m of MARKERS) dir.put(m, `external ${m}\n`);
      for (const m of MARKERS) dir.put(`x/${m}`, `external x ${m}\n`);
      return dir;
    };

    // 提案目录是指向项目外的链接；同时有一个正常的提案目录 a
    const ext1 = outside();
    const before1 = ext1.files();
    const fx = new Fixture();
    fx.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));
    fx.put('logos/changes/a/VERIFY_PASS', 'local\n');
    symlinkSync(ext1.root, join(fx.root, 'logos/changes/link'));
    const r1 = fx.sync();
    expect(r1.status, r1.stderr).toBe(0);
    expect(r1.data!.result).toBe('synced');
    // 正常目录内未跟踪的标记照常清除；链接目录既不被清除也不被报告
    expect(r1.data!.invalidated_markers).toEqual([{ slug: 'a', markers: ['VERIFY_PASS'] }]);
    expect(fx.exists('logos/changes/a/VERIFY_PASS')).toBe(false);
    expect(ext1.files()).toEqual(before1);

    // changes 根本身是指向项目外的链接
    const ext2 = outside();
    const before2 = ext2.files();
    const fx2 = new Fixture();
    fx2.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));
    fx2.remove('logos/changes');
    symlinkSync(ext2.root, join(fx2.root, 'logos/changes'));
    const r2 = fx2.sync();
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.data!.result).toBe('synced');
    expect(r2.data!.invalidated_markers).toEqual([]);
    expect(ext2.files()).toEqual(before2);
  }, 30_000);

  it('UT-S44-20: 已是最新时零改动；纯快进与「可快进但主分支带被跟踪标记」的合并方式', () => {
    // ① 本分支已合入 main 的最新提交
    const fx = new Fixture();
    fx.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));
    expect(fx.sync().data!.result).toBe('synced');
    const before = fx.state();
    const r1 = fx.sync();
    expect(r1.status).toBe(0);
    expect(r1.data).toMatchObject({ result: 'up-to-date', head_before: before.head, head_after: before.head, replaced: [], fast_forward: false });
    expect(r1.data!.registry.status).toBe('not-needed');
    expect(fx.state()).toEqual(before);
    expect(fx.exists(`${VERIFY}/baseline-seed-runs`)).toBe(false);

    // ② 本分支与 main 指向同一提交
    fx.git(['checkout', '-q', 'main']);
    const mainState = fx.state();
    const r2 = fx.sync();
    expect(r2.data).toMatchObject({ result: 'up-to-date', head_after: mainState.head, fast_forward: false });
    expect(fx.state()).toEqual(mainState);

    // ③ 本分支是 main 的祖先；标记未被跟踪，main 上也没有被跟踪的标记
    const ff = new Fixture();
    ff.git(['checkout', '-q', '-b', 'proposal/a']);
    ff.git(['checkout', '-q', 'main']);
    rewriteArtifacts(ff, 'B');
    const mainHead = ff.commit('B');
    ff.git(['checkout', '-q', 'proposal/a']);
    ff.put('logos/changes/a/VERIFY_PASS', 'local\n');
    const r3 = ff.sync();
    expect(r3.status).toBe(0);
    expect(r3.data).toMatchObject({ result: 'synced', fast_forward: true, head_after: mainHead });
    expect(ff.head()).toBe(mainHead);
    expect(ff.git(['rev-list', '--merges', '--count', 'HEAD'])).toBe('0');
    expect(ff.exists('logos/changes/a/VERIFY_PASS')).toBe(false);
    expect(r3.data!.invalidated_markers).toEqual([{ slug: 'a', markers: ['VERIFY_PASS'] }]);
    expect(ff.git(['status', '--porcelain'])).toBe('');

    // ④ 本分支是 main 的祖先；VERIFY_PASS 在两条分支上都被跟踪
    const tracked = new Fixture();
    tracked.put('logos/changes/a/VERIFY_PASS', 'tracked\n');
    const O = tracked.commit('O with marker');
    tracked.git(['checkout', '-q', '-b', 'proposal/a']);
    tracked.git(['checkout', '-q', 'main']);
    rewriteArtifacts(tracked, 'B');
    const trackedMain = tracked.commit('B');
    tracked.git(['checkout', '-q', 'proposal/a']);
    const r4 = tracked.sync();
    expect(r4.status).toBe(0);
    expect(r4.data).toMatchObject({ result: 'synced', fast_forward: false, head_before: O });
    expect(r4.data!.head_after).toBe(tracked.head());
    expect(tracked.git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)).toEqual([O, trackedMain]);
    expect(tracked.git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).not.toContain('logos/changes/a/VERIFY_PASS');
    expect(r4.data!.invalidated_markers).toEqual([{ slug: 'a', markers: ['VERIFY_PASS'] }]);
    expect(tracked.git(['status', '--porcelain'])).toBe('');
    expect(tracked.read(REPORT)).toBe(tracked.show('main', REPORT));
  }, 60_000);

  it('UT-S44-23: JSON 输出形态与退出码——管道读取到 EOF', async () => {
    const FIELDS = ['result', 'branch', 'base', 'merge_base', 'head_before', 'head_after', 'fast_forward', 'replaced', 'registry',
      'remaining_conflicts', 'invalidated_markers', 'diagnostics'].sort();
    const clean = new Fixture();
    clean.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));
    const clash = new Fixture();
    clash.put('clash.txt', 'shared\n');
    clash.commit('clash base');
    clash.diverge(f => { f.put('clash.txt', 'A\n'); rewriteArtifacts(f, 'A'); }, f => { f.put('clash.txt', 'B\n'); rewriteArtifacts(f, 'B'); });
    const args = ['branch', 'sync', '--base', 'main', '--format', 'json'];

    const expectEnvelope = (out: { code: number | null; stdout: string; stderr: string }, code: number, result: string): Record<string, any> => {
      expect(out.code).toBe(code);
      expect(out.stdout.trim().split('\n')).toHaveLength(1);
      const envelope = JSON.parse(out.stdout) as Record<string, any>;
      expect(envelope.command).toBe('branch sync');
      expect(typeof envelope.version).toBe('string');
      expect(Object.keys(envelope.data).sort()).toEqual(FIELDS);
      expect(envelope.data.result).toBe(result);
      expect(envelope.data.result === 'conflicts').toBe(envelope.data.remaining_conflicts.length > 0);
      expect(Object.keys(envelope.data.registry).sort()).toEqual(['conflicts', 'counters', 'index_backfilled', 'path', 'reason', 'status']);
      expect(envelope.data.base).toMatchObject({ ref: 'main', source: 'flag' });
      return envelope.data;
    };
    const synced = expectEnvelope(await spawnCli(clean.root, args), 0, 'synced');
    expect(synced.head_after).toBe(clean.head());
    expect(synced.branch).toBe('proposal/a');
    expectEnvelope(await spawnCli(clean.root, args), 0, 'up-to-date');
    const conflicts = expectEnvelope(await spawnCli(clash.root, args), 2, 'conflicts');
    expect(conflicts.head_after).toBe(conflicts.head_before);

    // 拒绝执行：stdout 为空，stderr 为错误 envelope
    const rejected = await spawnCli(clash.root, args);
    expect(rejected.code).toBe(1);
    expect(rejected.stdout).toBe('');
    const err = JSON.parse(rejected.stderr) as Record<string, any>;
    expect(err.command).toBe('branch sync');
    expect(err.error.code).toBe('BRANCH_OPERATION_IN_PROGRESS');
    expect(typeof err.error.message).toBe('string');
  }, 30_000);

  it('UT-S44-25: 文本输出跟随 locale；仍有冲突时逐行列出并给出两条 git 提示；拒绝时写明同步未执行', () => {
    const run = (locale: 'en' | 'zh'): { dirty: string; synced: string; conflicts: string; shas: Record<string, string> } => {
      const clean = new Fixture({ locale });
      const c = clean.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));
      // 拒绝执行：已跟踪文件有未提交改动
      clean.put(REPORT, 'dirty\n');
      const dirty = clean.cli(['branch', 'sync', '--base', 'main']);
      expect(dirty.status).toBe(1);
      expect(dirty.stdout).toBe('');
      clean.git(['checkout', '--', REPORT]);
      const synced = clean.cli(['branch', 'sync', '--base', 'main']);
      expect(synced.status).toBe(0);

      const clash = new Fixture({ locale });
      clash.put(REQ, 'shared\n');
      clash.commit('req');
      clash.diverge(f => { f.put(REQ, 'A\n'); rewriteArtifacts(f, 'A'); }, f => { f.put(REQ, 'B\n'); rewriteArtifacts(f, 'B'); });
      const conflicts = clash.cli(['branch', 'sync', '--base', 'main']);
      expect(conflicts.status).toBe(2);
      return { dirty: dirty.stderr, synced: synced.stdout, conflicts: conflicts.stdout, shas: { main: c.main.slice(0, 8), O: c.O.slice(0, 8), head: clean.head().slice(0, 8) } };
    };
    const en = run('en');
    const zh = run('zh');

    // 拒绝执行
    expect(en.dirty).toMatch(/^Error: \[BRANCH_WORKTREE_DIRTY\] /);
    expect(en.dirty).toMatch(/sync was not run/i);
    expect(zh.dirty).toMatch(/^Error: \[BRANCH_WORKTREE_DIRTY\] /);
    expect(zh.dirty).toContain('同步未执行');
    for (const out of [en.dirty, zh.dirty]) expect(out).toContain(REPORT);

    // 已同步
    expect(en.synced).toContain(`Syncing base branch: main (${en.shas.main}, source: --base)`);
    expect(en.synced).toContain(`Current branch: proposal/a  Merge base: ${en.shas.O}`);
    expect(en.synced).toContain(`  ✓ Took base version: ${REPORT}`);
    expect(en.synced).toContain(`✓ Synced. Merge commit ${en.shas.head}.`);
    expect(en.synced).toContain('run openlogos verify again');
    expect(zh.synced).toContain(`同步主分支：main（${zh.shas.main}，来源：--base）`);
    expect(zh.synced).toContain(`当前分支：proposal/a  共同起点：${zh.shas.O}`);
    expect(zh.synced).toContain(`  ✓ 取主分支版本：${REPORT}`);
    expect(zh.synced).toContain(`✓ 已同步，合并提交 ${zh.shas.head}。`);
    expect(zh.synced).toContain('请重新运行 openlogos verify');

    // 仍有冲突：每个剩余冲突各占一行，含类别、路径与原因；末尾两条 git 提示
    expect(en.conflicts).toContain('✗ 1 conflicts remain; the merge is not finished:');
    expect(en.conflicts.split('\n')).toContain(`  ✗ [spec] ${REQ} (git conflict)`);
    expect(zh.conflicts).toContain('✗ 仍有 1 处冲突，合并尚未完成：');
    expect(zh.conflicts.split('\n')).toContain(`  ✗ [规格] ${REQ}（git 冲突）`);
    for (const out of [en.conflicts, zh.conflicts]) {
      expect(out).toContain('git commit');
      expect(out).toContain('git merge --abort');
    }
  }, 60_000);
});

describe('S44 branch sync — 场景', () => {
  /** ST-S44-01 的构造：提案甲在 main 上完成，提案乙在 proposal/a 上完成。 */
  function parallelProposals(withSpecClash: boolean): { fx: Fixture; c: { O: string; main: string; prop: string } } {
    const O = {
      project: { name: 'x' },
      scenario_counter: { next_id: 50 },
      scenarios: [{ id: 'S01', name: '初始化', module: 'core' }],
      resource_index: [],
      conventions: ['约定'],
    };
    const fx = new Fixture({ registry: stringifyYaml(O) });
    fx.put(REQ, '# 需求\n\n## 场景总览\n\n共 1 个场景。\n\n## 约束\n\n无。\n');
    fx.commit('requirements');
    const withScenario = (id: string, name: string): string => {
      const v = structuredClone(O);
      v.scenario_counter.next_id = 51;
      v.scenarios.push({ id, name, module: 'core' });
      return stringifyYaml(v);
    };
    const c = fx.diverge(
      f => {
        // 提案乙：新增场景 S51 与一份新规格文档，重写验收产物，计数器推进到 51，写下 VERIFY_PASS
        f.put(REGISTRY, withScenario('S51', '导入'));
        f.put('logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S51-import.md', '# S51\n');
        if (withSpecClash) f.put(REQ, '# 需求\n\n## 场景总览\n\n共 2 个场景（新增导入）。\n\n## 约束\n\n无。\n');
        rewriteArtifacts(f, 'B2');
        f.put('logos/changes/b/proposal.md', '# 提案乙\n');
      },
      f => {
        // 提案甲：新增场景 S50，重写验收产物，计数器推进到 51
        f.put(REGISTRY, withScenario('S50', '导出'));
        if (withSpecClash) f.put(REQ, '# 需求\n\n## 场景总览\n\n共 2 个场景（新增导出）。\n\n## 约束\n\n无。\n');
        rewriteArtifacts(f, 'A1');
      },
    );
    fx.put('logos/changes/b/VERIFY_PASS', '');
    return { fx, c };
  }

  it('ST-S44-01: 两个提案并行、同步后无剩余冲突的全链路', () => {
    const { fx, c } = parallelProposals(false);

    // ① branch status
    const status = JSON.parse(fx.cli(['branch', 'status', '--base', 'main', '--format', 'json']).stdout).data;
    expect(status).toMatchObject({ behind: 1, ahead: 1, merge_base: c.O, up_to_date: false });

    // ② branch sync
    const r = fx.sync();
    expect(r.status).toBe(0);
    expect(r.data!.result).toBe('synced');
    expect(r.data!.replaced).toEqual([{ path: REPORT, action: 'took-base' }, { path: LEDGER, action: 'took-base' }]);
    expect(r.data!.registry.status).toBe('merged');
    expect(r.data!.registry.counters).toEqual([{ name: 'scenario_counter', base: 50, ours: 51, theirs: 51, merged: 51, both_advanced: true }]);
    expect(r.data!.diagnostics).toEqual([expect.objectContaining({ code: 'counter_both_advanced', counter: 'scenario_counter' })]);

    // ③ 登记表、验收产物与提案目录
    const registry = parseYaml(fx.read(REGISTRY)) as Record<string, any>;
    expect(registry.scenarios.map((s: { id: string }) => s.id)).toEqual(['S01', 'S51', 'S50']);
    expect(registry.scenario_counter.next_id).toBe(51);
    expect(fx.read(REPORT)).toBe(fx.show('main', REPORT));
    expect(fx.read(LEDGER)).toBe(fx.show('main', LEDGER));
    expect(fx.exists('logos/changes/b/VERIFY_PASS')).toBe(false);
    expect(fx.exists('logos/changes/b/proposal.md')).toBe(true);
    expect(r.data!.invalidated_markers).toEqual([{ slug: 'b', markers: ['VERIFY_PASS'] }]);

    // ④ 工作区干净，HEAD 是有两个父提交的合并提交
    expect(fx.git(['status', '--porcelain'])).toBe('');
    expect(fx.git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)).toEqual([c.prop, c.main]);
    expect(r.data!.head_after).toBe(fx.head());
  }, 30_000);

  it('ST-S44-02: 仍有规格冲突时保留现场，解决后再次同步为已是最新', () => {
    const { fx, c } = parallelProposals(true);

    // ① 仍有冲突
    const r1 = fx.sync();
    expect(r1.status).toBe(2);
    expect(r1.data!.result).toBe('conflicts');
    expect(r1.data!.remaining_conflicts).toEqual([{ path: REQ, category: 'spec', reason: 'git-conflict' }]);
    expect(r1.data!.registry.status).toBe('merged');
    expect(fx.read(REPORT)).toBe(fx.show('main', REPORT));
    expect((parseYaml(fx.read(REGISTRY)) as Record<string, any>).scenarios).toHaveLength(3);
    expect(fx.merging()).toBe(true);
    expect(fx.head()).toBe(c.prop);

    // ② 合并进行期间再次同步
    const r2 = fx.sync();
    expect(r2.status).toBe(1);
    expect(r2.error!.code).toBe('BRANCH_OPERATION_IN_PROGRESS');

    // ③ 手工解决需求文档的冲突并提交
    fx.put(REQ, '# 需求\n\n## 场景总览\n\n共 3 个场景（新增导出、导入）。\n\n## 约束\n\n无。\n');
    fx.git(['add', REQ]);
    fx.git(['commit', '-q', '--no-edit']);
    const resolved = fx.head();
    expect(fx.git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)).toEqual([c.prop, c.main]);

    // ④ 第三次同步：已是最新，没有新的提交
    const r4 = fx.sync();
    expect(r4.status).toBe(0);
    expect(r4.data!.result).toBe('up-to-date');
    expect(fx.head()).toBe(resolved);
  }, 30_000);
});
