/**
 * verify-git-local-only：安装态 smoke runner（scripts/smoke-verify-git-local-only.js）的判据，不落真实全局环境。
 * 规格：core-smoke-test-cases.md「OpenLogos 0.16.30 验收期间 git 调用只读本地安装态 smoke」「四、自动化与证据要求」的
 * 版本一致性与失败证据。本文件的用例是 runner 自身的判据测试，不对应、也不写入任何 SMOKE 用例结果。
 */
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_VERSION, GIT_LOCATION_ENV_KEYS, IDENTITY_CASE, OWNED, approvedVersionProblem, cleanupScopes, dispatchCases, fixtureG, objectSnapshot,
  resolveGlobalEntry, runCli, shellQuote,
  // @ts-expect-error smoke runner 为 ESM .js 脚本，无类型声明；以模块方式导入时不执行主流程
} from '../../scripts/smoke-verify-git-local-only.js';

import { mkdirSync } from 'node:fs';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { attachRemote, cleanupScratch, makeRemoteOnlyCommit, observeComplete, plainGit } from './golden/s13-git-local-fixture.mjs';

vi.setConfig({ testTimeout: 180_000 });

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.js');
type Row = { status: string; detail: string; evidence: string[] };
type Case = (entry: string) => Promise<{ detail: string; evidence: string[] }>;
const pass: Case = async () => ({ detail: '通过', evidence: [] });
const stubCases = (): Record<string, Case> => Object.fromEntries((OWNED as string[]).map(id => [id, pass]));

describe('安装态 smoke runner 判据：版本一致性与失败证据（不落真实全局环境）', () => {
  it('批准版本、全局版本、回执与源码候选版本四者必须相等', () => {
    expect(APPROVED_VERSION).toBe('0.16.30');
    const receipt = { candidate_version: APPROVED_VERSION };
    expect(approvedVersionProblem(APPROVED_VERSION, receipt, APPROVED_VERSION)).toBeNull();
    const other = '0.16.31';
    const problem = approvedVersionProblem(other, { candidate_version: other }, other);
    expect(problem).toContain(APPROVED_VERSION);
    expect(problem).toContain(other);
    expect(approvedVersionProblem(APPROVED_VERSION, { candidate_version: other }, APPROVED_VERSION)).toContain('candidate_version');
    expect(approvedVersionProblem(APPROVED_VERSION, receipt, null)).toContain('源码候选版本');
  });

  it('行为用例失败：夹具清理后仍能从失败记录读到完整命令输出、git 调用记录与各项记录的缺失说明', async () => {
    const roots: string[] = [];
    const cases = stubCases();
    cases['SMOKE-core-379'] = async entry => {
      const fx = await fixtureG(entry, 'evidence');
      roots.push(fx.root);
      await runCli(entry, fx, ['verify', '--format', 'json'], 0);
      throw Object.assign(new Error('故意失败：核对失败证据'), { evidence: ['probe=evidence'] });
    };
    const receipt = { deploy_id: 'test-deploy', result: 'done', environment: 'test', candidate_version: APPROVED_VERSION, entry_realpath: CLI };
    const rows = await dispatchCases(CLI, receipt, cases) as Map<string, Row>;
    cleanupScopes();
    expect(roots).toHaveLength(1);
    expect(existsSync(roots[0])).toBe(false);

    const row = rows.get('SMOKE-core-379')!;
    expect(row.status).toBe('fail');
    expect(row.evidence).toContain('probe=evidence');
    const value = (prefix: string) => { const line = row.evidence.find(e => e.startsWith(prefix))!; expect(line, prefix).toBeDefined(); return line.slice(prefix.length); };
    // 对象齐全的运行：远端没有收到请求（明确记录缺失），git 调用记录与逐次调用记录都在
    expect(value('artifact.fixture[evidence].remote_access=')).toContain('缺失');
    expect(value('artifact.fixture[evidence].git_calls=')).toContain('diff --name-status');
    const calls = value('artifact.fixture[evidence].calls=').split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(calls[0].eligible).toEqual(['UT-S02-01', 'UT-S02-02', 'UT-S03-01']);
    expect(JSON.parse(value('artifact.fixture[evidence].objects_after=')).length).toBeGreaterThan(0);
    // 本用例已执行的每一条被测 CLI 命令都保留完整输出（含成功的 init）；verify 的信封可整体解析
    const commands = row.evidence.filter(e => e.startsWith('artifact.command[')).map(e => JSON.parse(e.slice(e.indexOf('=') + 1)));
    expect(commands.map(c => c.args[0])).toEqual(['init', 'change', 'verify']);
    expect(commands[0].status).toBe(0);
    expect(JSON.parse(commands[2].stdout.trim()).command).toBe('verify');
    // 通过的用例不附带失败证据
    expect(rows.get('SMOKE-core-376')!.evidence.some(e => e.startsWith('artifact.'))).toBe(false);
    expect(rows.get(IDENTITY_CASE)!.status).toBe('pass');
  });

  it('被测 CLI 返回非预期退出码：失败记录里有对象库终态快照与已执行的全部命令输出', async () => {
    const cases = stubCases();
    cases['SMOKE-core-379'] = async entry => {
      const fx = await fixtureG(entry, 'evidence-exit');
      // verify 实际以 0 退出；这里按 5 期待，让被测 CLI 自己「返回了非预期退出码」
      await runCli(entry, fx, ['verify', '--format', 'json'], 5);
      return { detail: '不应到达', evidence: [] };
    };
    const receipt = { deploy_id: 'test-deploy', result: 'done', environment: 'test', candidate_version: APPROVED_VERSION, entry_realpath: CLI };
    const rows = await dispatchCases(CLI, receipt, cases) as Map<string, Row>;
    cleanupScopes();
    const row = rows.get('SMOKE-core-379')!;
    expect(row.status).toBe('fail');
    expect(row.detail).toContain('退出码 0，预期 5');
    // 被测 CLI 已经运行：终态快照是真实的对象清单，不是「尚未执行」
    const after = row.evidence.find(e => e.startsWith('artifact.fixture[evidence-exit].objects_after='))!;
    expect(after).not.toContain('缺失');
    expect(JSON.parse(after.slice(after.indexOf('=') + 1)).length).toBeGreaterThan(0);
    const commands = row.evidence.filter(e => e.startsWith('artifact.command[')).map(e => JSON.parse(e.slice(e.indexOf('=') + 1)));
    expect(commands.map(c => c.args[0])).toEqual(['init', 'change', 'verify']);
    expect(commands[0].stdout.length + commands[0].stderr.length).toBeGreaterThan(0);
    expect(JSON.parse(commands[2].stdout.trim()).command).toBe('verify');
  });

  it('宿主设置了 git 仓库定位、索引与对象库变量时，夹具与被测 CLI 都不写进宿主仓库', async () => {
    // 另一份临时仓库充当宿主：把它的仓库定位变量放进当前进程环境，核对运行前后它的配置、引用与对象清单
    const host = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-vgl-host-')));
    const hostGit = (args: string[]) => spawnSync('git', args, { cwd: host, encoding: 'utf8', env: { ...baseEnv, GIT_AUTHOR_NAME: 'h', GIT_AUTHOR_EMAIL: 'h@example.invalid', GIT_COMMITTER_NAME: 'h', GIT_COMMITTER_EMAIL: 'h@example.invalid' } });
    const baseEnv = { ...process.env };
    for (const key of GIT_LOCATION_ENV_KEYS as string[]) delete baseEnv[key];
    hostGit(['init', '-q']);
    writeFileSync(join(host, 'host.txt'), 'host\n');
    hostGit(['add', '-A']);
    expect(hostGit(['commit', '-qm', 'host']).status).toBe(0);
    const hostState = () => ({
      config: readFileSync(join(host, '.git/config'), 'utf8'),
      refs: hostGit(['for-each-ref']).stdout,
      head: hostGit(['rev-parse', 'HEAD']).stdout,
      objects: objectSnapshot(host),
      index: readFileSync(join(host, '.git/index')).toString('base64'),
    });
    const before = hostState();
    const injected: Record<string, string> = {
      GIT_DIR: join(host, '.git'), GIT_WORK_TREE: host, GIT_INDEX_FILE: join(host, '.git/index'), GIT_OBJECT_DIRECTORY: join(host, '.git/objects'),
    };
    const saved = Object.fromEntries(Object.keys(injected).map(key => [key, process.env[key]]));
    Object.assign(process.env, injected);
    const roots: string[] = [];
    try {
      // ① 安装态夹具 + 被测 CLI：走一条会写对象、改配置的完整路径（建项目、提交、登记远端、阳性对照取回、verify）
      const cases = stubCases();
      cases['SMOKE-core-379'] = async entry => {
        const fx = await fixtureG(entry, 'isolation');
        roots.push(fx.root);
        const run = await runCli(entry, fx, ['verify', '--format', 'json'], 0);
        // 项目自己的仓库照常可用：范围照常收窄，说明 git 读写的是一次性项目而不是宿主
        if (run.data?.layers?.expansion?.level !== 'none') throw new Error(`一次性项目的验收应照常收窄：${JSON.stringify(run.data?.layers?.expansion)}`);
        if (!existsSync(join(fx.root, '.git/config'))) throw new Error('一次性项目没有自己的 .git');
        return { detail: '通过', evidence: [] };
      };
      const receipt = { deploy_id: 'test-deploy', result: 'done', environment: 'test', candidate_version: APPROVED_VERSION, entry_realpath: CLI };
      const rows = await dispatchCases(CLI, receipt, cases) as Map<string, Row>;
      expect(rows.get('SMOKE-core-379')!.detail).toBe('通过');
      expect(rows.get('SMOKE-core-379')!.status).toBe('pass');
      // ② 源码测试夹具自己的 git：在一个已建好的项目上登记远端并做阳性对照（写配置、克隆、取回、还原）
      const project = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-vgl-iso-')));
      roots.push(project);
      plainGit(project, ['init', '-q']);
      writeFileSync(join(project, 'a.txt'), 'a\n');
      plainGit(project, ['add', '-A']);
      plainGit(project, ['commit', '-qm', 'init']);
      const remote = attachRemote(project);
      makeRemoteOnlyCommit(project, remote);
      expect(readFileSync(join(project, '.git/config'), 'utf8')).toContain('partialclonefilter');
      // ③ UT-S13-318 的真实入口：两套夹具从创建项目起（git init、git add、git commit）到阳性对照、被测 CLI 全程
      const observed = observeComplete(CLI, buildTestChangeSet);
      expect(observed['ms-narrowed'].envelope.data.scope.mode).toBe('module');
      expect(observed['lv-narrowed'].envelope.data.layers.expansion.level).toBe('none');
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      cleanupScopes();
      cleanupScratch();
    }
    expect(hostState()).toEqual(before);
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    rmSync(host, { recursive: true, force: true });
  });

  it('Windows：入口取 npm 启动脚本所指向的包内文件，启动脚本本身在包目录之外不构成拒绝理由', () => {
    // 按 npm 在 Windows 上的安装布局造一个 prefix：<prefix>\\openlogos.cmd 与 <prefix>\\node_modules\\@miniidealab\\openlogos
    const prefix = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-vgl win prefix-')));
    try {
      const pkgDir = join(prefix, 'node_modules', '@miniidealab', 'openlogos');
      mkdirSync(join(pkgDir, 'dist'), { recursive: true });
      writeFileSync(join(pkgDir, 'dist', 'index.js'), '// entry\n');
      const shim = join(prefix, 'openlogos.cmd');
      writeFileSync(shim, '@ECHO off\r\nnode "%dp0%\\node_modules\\@miniidealab\\openlogos\\dist\\index.js" %*\r\n');
      const probes = { platform: 'win32', prefix: () => prefix, shimVersion: () => '0.16.30', entryVersion: () => '0.16.30' };
      const ok = resolveGlobalEntry(probes);
      expect(ok.problem).toBeUndefined();
      expect(ok.entry).toBe(realpathSync(join(pkgDir, 'dist', 'index.js')));
      // 启动脚本与入口的版本不一致：拒绝
      expect(resolveGlobalEntry({ ...probes, shimVersion: () => '0.16.29' }).problem).toContain('不一致');
      // 启动脚本没有指向包内入口：拒绝
      writeFileSync(shim, '@ECHO off\r\nnode "C:\\elsewhere\\index.js" %*\r\n');
      expect(resolveGlobalEntry(probes).problem).toContain('启动脚本校验未通过');
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
  });

  it('远端命令路径按 shell 规则引用（含空格、单引号与反斜杠）', () => {
    expect(shellQuote('/tmp/a b/up.sh')).toBe("'/tmp/a b/up.sh'");
    expect(shellQuote("C:\\Users\\A B\\it's.sh")).toBe("'C:/Users/A B/it'\\''s.sh'");
  });

  it('建夹具的 init 失败：超过错误摘要长度的完整输出仍保留在失败记录中', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-vgl-fake-entry-')));
    const fake = join(dir, 'fake-cli.mjs');
    writeFileSync(fake, [
      "if (process.argv[2] === '--version') { console.log('0.0.0'); process.exit(0); }",
      "process.stderr.write('e'.repeat(600) + ' STDERR-TAIL-DIAGNOSTIC\\n');",
      'process.exit(1);',
    ].join('\n'));
    try {
      const cases = stubCases();
      cases['SMOKE-core-376'] = async entry => { await fixtureG(entry, 'evidence-init'); return { detail: '不应到达', evidence: [] }; };
      const receipt = { deploy_id: 'test-deploy', result: 'done', environment: 'test', candidate_version: APPROVED_VERSION, entry_realpath: fake };
      const rows = await dispatchCases(fake, receipt, cases) as Map<string, Row>;
      cleanupScopes();
      const row = rows.get('SMOKE-core-376')!;
      expect(row.status).toBe('fail');
      expect(row.detail).not.toContain('STDERR-TAIL-DIAGNOSTIC');
      const commands = row.evidence.filter(e => e.startsWith('artifact.command[')).map(e => JSON.parse(e.slice(e.indexOf('=') + 1)));
      expect(commands).toHaveLength(1);
      expect(commands[0].args[0]).toBe('init');
      expect(commands[0].stderr.trimEnd().endsWith('STDERR-TAIL-DIAGNOSTIC')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
