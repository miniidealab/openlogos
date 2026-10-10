/**
 * release-0-16-0：公开发布 smoke runner（scripts/smoke-public-release-0-16-0.js）SMOKE-core-232 的安装态判据回归
 * （code 评审 r1 F1、F2）。判据实现在 scripts/lib/public-release-checks.mjs，本文件以一次性 prefix 布局与子进程结果
 * 夹具验证：入口须为真实安装入口且可执行（Unix 链接 / Windows shim 两种布局），status 须成功退出并输出合法成功 envelope。
 * 本文件不认领 UT/ST 编号（SMOKE-core-232 的结果由 runner 自身写入 smoke 账本）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  entryCommand, entryIdentityProblems, installedLayout, processProblem, provenanceSourceProblems, statusEnvelopeProblems,
} from '../../scripts/lib/public-release-checks.mjs';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function tempPrefix(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openlogos-public-checks-'));
  roots.push(dir);
  return dir;
}

const V = '9.9.9';
const SCRIPT = `#!/usr/bin/env node\nconsole.log('${V}');\n`;

/** Unix 布局：<prefix>/lib/node_modules/@miniidealab/openlogos/dist/index.js + <prefix>/bin/openlogos 链接。 */
function unixPrefix(opts: { executable?: boolean; linkTarget?: string } = {}) {
  const prefix = tempPrefix();
  const layout = installedLayout(prefix, 'linux');
  mkdirSync(join(layout.pkgDir, 'dist'), { recursive: true });
  const index = join(layout.pkgDir, 'dist', 'index.js');
  writeFileSync(index, SCRIPT);
  chmodSync(index, opts.executable === false ? 0o644 : 0o755);
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  symlinkSync(opts.linkTarget ?? index, layout.entry);
  return layout;
}

/** Windows 布局：<prefix>/node_modules/@miniidealab/openlogos + npm 生成形态的 <prefix>/openlogos.cmd shim。 */
function winPrefix(target = 'node_modules\\@miniidealab\\openlogos\\dist\\index.js') {
  const prefix = tempPrefix();
  const layout = installedLayout(prefix, 'win32');
  mkdirSync(join(layout.pkgDir, 'dist'), { recursive: true });
  writeFileSync(join(layout.pkgDir, 'dist', 'index.js'), SCRIPT);
  writeFileSync(layout.entry, [
    '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`,
  ].join('\r\n'));
  return layout;
}

describe('公开发布 smoke — 安装态入口判据（code 评审 r1 F1）', () => {
  it('Unix：正常入口可执行且归属隔离安装包，经入口执行得到版本', () => {
    const layout = unixPrefix();
    expect(entryIdentityProblems(layout)).toEqual([]);
    const { command, args } = entryCommand(layout, ['--version']);
    expect(command).toBe(layout.entry);
    const r = spawnSync(command, args, { encoding: 'utf8' });
    expect(processProblem(r, '--version')).toBeNull();
    expect(r.stdout.trim()).toBe(V);
  });

  it.skipIf(process.platform === 'win32')('Unix：包内脚本正常但入口不可执行 → 判据报不可执行，经入口执行失败', () => {
    const layout = unixPrefix({ executable: false });
    expect(entryIdentityProblems(layout).join('；')).toContain('入口不可执行');
    const { command, args } = entryCommand(layout, ['--version']);
    const r = spawnSync(command, args, { encoding: 'utf8' });
    expect(processProblem(r, '--version')).not.toBeNull();
  });

  it('Unix：入口链接到隔离安装包之外 → 判据拒绝', () => {
    const outside = tempPrefix();
    const foreign = join(outside, 'index.js');
    writeFileSync(foreign, SCRIPT);
    chmodSync(foreign, 0o755);
    const layout = unixPrefix({ linkTarget: foreign });
    expect(entryIdentityProblems(layout).join('；')).toContain('不在隔离安装包目录内');
  });

  it('Windows shim：npm 形态的 .cmd 在 prefix 根、不在包目录内，按内容指向判定为通过', () => {
    const layout = winPrefix();
    expect(layout.entry.endsWith('openlogos.cmd')).toBe(true);
    expect(entryIdentityProblems(layout)).toEqual([]);
    const { args } = entryCommand(layout, ['--version']);
    expect(args.slice(-2)).toEqual([layout.entry, '--version']);
  });

  it('Windows shim：指向其它包的 shim → 判据拒绝', () => {
    const layout = winPrefix('node_modules\\other-pkg\\dist\\index.js');
    expect(entryIdentityProblems(layout).join('；')).toContain('未指向');
  });
});

describe('公开发布 smoke — status 成功判据（code 评审 r1 F2）', () => {
  const ok = { command: 'status', version: V, timestamp: '2026-10-10T00:00:00.000Z', data: { modules: [] } };
  const result = (status: number | null, stdout: unknown, extra: Record<string, unknown> = {}) => ({
    status, signal: null, error: undefined, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '', ...extra,
  });

  it('正常成功 envelope 通过', () => {
    expect(statusEnvelopeProblems(result(0, ok), V)).toEqual([]);
  });

  it('非零退出即使 stdout 带 version 也失败', () => {
    expect(statusEnvelopeProblems(result(1, { version: V }), V).join('；')).toContain('退出码 1');
  });

  it('错误 envelope 失败（非零退出与零退出两种形态）', () => {
    const errEnv = { command: 'status', version: V, timestamp: ok.timestamp, error: { code: 'config_invalid', message: '失败' } };
    expect(statusEnvelopeProblems(result(1, errEnv), V).join('；')).toContain('退出码 1');
    const zero = statusEnvelopeProblems(result(0, errEnv), V).join('；');
    expect(zero).toContain('含 error');
    expect(zero).toContain('data 缺失');
  });

  it('仅含 version 的缺项对象失败', () => {
    const problems = statusEnvelopeProblems(result(0, { version: V }), V).join('；');
    expect(problems).toContain('envelope.command');
    expect(problems).toContain('timestamp');
    expect(problems).toContain('data');
  });

  it('data 为数组时失败（typeof 同为 object，须显式排除；code 评审 r2 F2）', () => {
    expect(statusEnvelopeProblems(result(0, { ...ok, data: [] }), V).join('；')).toContain('envelope.data');
    expect(statusEnvelopeProblems(result(0, { ...ok, data: null }), V).join('；')).toContain('envelope.data');
  });

  it('timestamp 不是 ISO-8601 时失败（Date.parse 可解析的 "1" 与无效日期同样拒绝；code 评审 r2 F2）', () => {
    for (const timestamp of ['1', '2026-10-10', '2026-02-30T00:00:00Z', 'Oct 10 2026']) {
      expect(statusEnvelopeProblems(result(0, { ...ok, timestamp }), V).join('；'), timestamp).toContain('ISO-8601');
    }
    expect(statusEnvelopeProblems(result(0, { ...ok, timestamp: '2026-10-10T08:00:00+08:00' }), V)).toEqual([]);
  });

  it('版本不符、非 JSON、信号终止与启动错误均失败', () => {
    expect(statusEnvelopeProblems(result(0, { ...ok, version: '0.0.1' }), V).join('；')).toContain('envelope.version');
    expect(statusEnvelopeProblems(result(0, 'not json'), V).join('；')).toContain('不是合法 JSON');
    expect(statusEnvelopeProblems(result(null, '', { signal: 'SIGKILL' }), V).join('；')).toContain('SIGKILL');
    expect(statusEnvelopeProblems(result(null, '', { error: new Error('spawn EACCES') }), V).join('；')).toContain('启动失败');
  });
});

describe('公开发布 smoke — registry 来源提交判据（release-0-16-0 增量修正：tarball 发布不写 gitHead）', () => {
  const REPO = 'miniidealab/openlogos';
  const COMMIT = '99c8fb91d01a241e7a93a4a8be63f7eeb7018e29';
  /** 与 registry `dist.attestations.url` 返回结构同形（0.13.24 实测形态：publish 证明 + SLSA provenance v1）。 */
  const attestations = (dep: { uri: string; gitCommit: string } | null, predicateType = 'https://slsa.dev/provenance/v1') => ({
    attestations: [
      { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1', bundle: { dsseEnvelope: { payload: Buffer.from('{}').toString('base64') } } },
      {
        predicateType,
        bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify({
          predicate: { buildDefinition: { resolvedDependencies: dep ? [{ uri: dep.uri, digest: { gitCommit: dep.gitCommit } }] : [] } },
        })).toString('base64') } },
      },
    ],
  });
  const tagUri = (v: string) => `git+https://github.com/${REPO}@refs/tags/v${v}`;

  it('provenance 指向 refs/tags/v<V> 且 gitCommit 等于 tag 提交 → 通过', () => {
    expect(provenanceSourceProblems(attestations({ uri: tagUri('0.13.24'), gitCommit: COMMIT }), { repo: REPO, version: '0.13.24', commit: COMMIT })).toEqual([]);
  });

  it('提交号不符、tag ref 不符均失败', () => {
    expect(provenanceSourceProblems(attestations({ uri: tagUri('0.13.24'), gitCommit: 'deadbeef' }), { repo: REPO, version: '0.13.24', commit: COMMIT }).join('；')).toContain('gitCommit');
    expect(provenanceSourceProblems(attestations({ uri: tagUri('0.13.23'), gitCommit: COMMIT }), { repo: REPO, version: '0.13.24', commit: COMMIT }).join('；')).toContain('uri');
    expect(provenanceSourceProblems(attestations({ uri: `git+https://github.com/${REPO}@refs/heads/master`, gitCommit: COMMIT }), { repo: REPO, version: '0.13.24', commit: COMMIT }).join('；')).toContain('uri');
  });

  it('缺 SLSA provenance、缺来源依赖、载荷损坏均失败', () => {
    expect(provenanceSourceProblems(attestations(null, 'https://example.invalid/other'), { repo: REPO, version: '0.13.24', commit: COMMIT }).join('；')).toContain('缺少 SLSA provenance');
    expect(provenanceSourceProblems(attestations(null), { repo: REPO, version: '0.13.24', commit: COMMIT }).join('；')).toContain('resolvedDependencies');
    expect(provenanceSourceProblems({ attestations: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: '%%%' } } }] }, { repo: REPO, version: '0.13.24', commit: COMMIT }).join('；')).toMatch(/无法解析|resolvedDependencies/);
    expect(provenanceSourceProblems({}, { repo: REPO, version: '0.13.24', commit: COMMIT }).join('；')).toContain('缺少 SLSA provenance');
  });
});
