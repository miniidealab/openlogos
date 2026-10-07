/**
 * guard-versioned-content-scope [code] 切片 7：安装态 smoke runner `scripts/smoke-guard-versioned-content-0-15-18.js`
 * （SMOKE-core-215～SMOKE-core-222）的判据自测，不落真实全局环境。
 *
 * - 全局入口经 OPENLOGOS_GUARD_VERSIONED_SMOKE_ENTRY 注入伪造安装包：`--version` 返回伪造候选版本，其余子命令委托
 *   仓内 cli/dist/index.js（init / sync 走真实分发），随包 guard / 引擎为仓内分发源字节。
 * - runner 的 cwd 为伪造仓库（活跃提案、候选版本常量、guard / 引擎分发源）；结果写入临时账本。
 * - SMOKE-core-221 的旧版制品指向不存在的路径（避免依赖网络安装），断言其显式 skip 且携带缺失项。
 * 本文件不认领 UT/ST 编号（smoke 用例的结果由 runner 自身写入 smoke 账本）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot } from './helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(REPO_ROOT, 'scripts', 'smoke-guard-versioned-content-0-15-18.js');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const GUARD_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-check');
const ENGINE_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-post-check.cjs');
const CURSOR_HOOKS_SRC = join(REPO_ROOT, 'plugin-cursor', 'hooks', 'hooks.json');
const SLUG = 'guard-versioned-content-scope';
const CANDIDATE = '0.15.99';
const IDS = Array.from({ length: 8 }, (_, i) => `SMOKE-core-${215 + i}`);
const AUTO = IDS.slice(0, 7);
const TIMEOUT = 60_000;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

function fakeRepo(activeSlug: string | null): string {
  const repo = tempRoot();
  mkdirSync(join(repo, 'logos'), { recursive: true });
  if (activeSlug) writeFileSync(join(repo, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: activeSlug, module: 'core' }));
  mkdirSync(join(repo, 'cli/src/lib'), { recursive: true });
  writeFileSync(join(repo, 'cli/src/lib/local-release-candidate.ts'),
    `export const LOCAL_RELEASE_CANDIDATE_VERSION = '${CANDIDATE}' as const;\nexport const LOCAL_RELEASE_ROLLBACK_VERSION = '0.15.98' as const;\n`);
  mkdirSync(join(repo, 'plugin/bin'), { recursive: true });
  writeFileSync(join(repo, 'plugin/bin/guard-check'), readFileSync(GUARD_SRC));
  writeFileSync(join(repo, 'plugin/bin/guard-post-check.cjs'), readFileSync(ENGINE_SRC));
  return repo;
}

interface FakeInstall { version?: string; withEngine?: boolean; engine?: string }

/** 伪造安装包：--version 返回指定版本，其余子命令委托仓内 CLI；asset-manifest 校验为空实现（身份由 hash 比对把关）。 */
function fakeInstall(spec: FakeInstall = {}): string {
  const version = spec.version ?? CANDIDATE;
  const pkg = tempRoot();
  mkdirSync(join(pkg, 'dist/lib'), { recursive: true });
  mkdirSync(join(pkg, 'claude-plugin-template/bin'), { recursive: true });
  mkdirSync(join(pkg, 'cursor-plugin-template/hooks'), { recursive: true });
  const guard = readFileSync(GUARD_SRC);
  writeFileSync(join(pkg, 'claude-plugin-template/bin/guard-check'), guard);
  const plugins = [{ path: 'claude-plugin-template/bin/guard-check', sha256: sha256(guard) }];
  if (spec.withEngine !== false) {
    const engine = spec.engine ?? readFileSync(ENGINE_SRC, 'utf-8');
    writeFileSync(join(pkg, 'claude-plugin-template/bin/guard-post-check.cjs'), engine);
    plugins.push({ path: 'claude-plugin-template/bin/guard-post-check.cjs', sha256: sha256(engine) });
  }
  writeFileSync(join(pkg, 'cursor-plugin-template/hooks/hooks.json'), readFileSync(CURSOR_HOOKS_SRC));
  writeFileSync(join(pkg, 'asset-manifest.json'), JSON.stringify({ version, plugins }));
  writeFileSync(join(pkg, 'dist/lib/asset-manifest.js'), 'export function validateAssetManifest() {}\n');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@miniidealab/openlogos', version, type: 'module' }));
  const entry = join(pkg, 'dist/index.js');
  writeFileSync(entry, [
    "import { spawnSync } from 'node:child_process';",
    'const args = process.argv.slice(2);',
    `if (args[0] === '--version') { console.log(${JSON.stringify(version)}); process.exit(0); }`,
    `const r = spawnSync(process.execPath, [${JSON.stringify(CLI_ENTRY)}, ...args], { stdio: 'inherit' });`,
    'process.exit(r.status ?? 1);',
  ].join('\n'));
  return entry;
}

interface Row { id: string; status: string; detail?: string; missing_requirements?: string[]; evidence?: string[] }

function runRunner(repo: string, entry: string | null, extraEnv: Record<string, string> = {}, args: string[] = []) {
  const results = join(tempRoot(), 'smoke-results.jsonl');
  const env: NodeJS.ProcessEnv = { ...process.env, OPENLOGOS_SMOKE_RESULT_PATH: results, ...extraEnv };
  delete env.OPENLOGOS_GUARD_VERSIONED_SMOKE;
  // 失败用例的隔离目录按失败处置保留：测试中放进可清理的临时根，避免泄漏到系统临时目录
  env.TMPDIR = tempRoot();
  env.OPENLOGOS_GUARD_VERSIONED_SMOKE_ENTRY = entry ?? join(repo, 'no-such-openlogos');
  env.OPENLOGOS_GUARD_VERSIONED_SMOKE_ROLLBACK_TARBALL ??= join(repo, 'no-such-rollback.tgz');
  const r = spawnSync(process.execPath, [RUNNER, ...args], { cwd: repo, env, encoding: 'utf-8', timeout: 300_000 });
  const rows: Row[] = existsSync(results)
    ? readFileSync(results, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Row)
    : [];
  return { status: r.status, rows, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const byId = (rows: Row[], id: string) => rows.find(r => r.id === id);

function evidenceFile(doc: unknown): string {
  const f = join(tempRoot(), 'SMOKE-core-222.json');
  writeFileSync(f, typeof doc === 'string' ? doc : JSON.stringify(doc));
  return f;
}

const FULL_EVIDENCE = {
  operator: 'tester', host: 'cursor-agent', host_version: '/usr/local/bin/cursor-agent 2026.10.1',
  observed_channel: 'post-report', spec_declared_channel: 'post-report',
  steps: [1, 2, 3, 4, 5].map(step => ({ step, observation: 'x' })),
  cursor_findings: {
    invocation_id_field: 'none', generation_concurrent_same_command: 'not_observed', after_shell_injects_agent: 'no',
    after_shell_can_block: 'no', ask_prompt_default_mode: 'yes', ask_prompt_auto_run_mode: 'yes',
    before_shell_agent_message_delivered: 'yes', session_start_delivers_pending: 'no', tarball_engine_sha256: 'abc',
  },
  verdict: 'pass',
};

describe('SMOKE-core-215～222 安装态 runner 判据（不落真实全局环境）', () => {
  it('--self-test 输出契约：8 条 owned ID 与 222 证据字段', () => {
    const r = spawnSync(process.execPath, [RUNNER, '--self-test'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    expect(r.status).toBe(0);
    const c = JSON.parse(r.stdout);
    expect(c.ids).toEqual(IDS);
    expect(c.manual_evidence.required_fields).toEqual(
      ['operator', 'host', 'host_version', 'observed_channel', 'spec_declared_channel', 'steps', 'verdict']);
    expect(c.public_release_commands).toEqual([]);
  });

  it('本案窗口之外 → 8 条 skip、退出 0（不拉黑后续提案）', () => {
    const run = runRunner(fakeRepo('some-later-change'), null);
    expect(run.status).toBe(0);
    expect(run.rows.map(r => [r.id, r.status])).toEqual(IDS.map(id => [id, 'skip']));
  }, TIMEOUT);

  it('窗口内全局入口缺失 → 215～221 fail（明确诊断）、222 无证据 skip、非零退出且每 ID 恰一条', () => {
    const run = runRunner(fakeRepo(SLUG), null);
    expect(run.status).not.toBe(0);
    expect(run.rows.map(r => r.id)).toEqual(IDS);
    for (const id of AUTO) {
      expect(byId(run.rows, id)?.status).toBe('fail');
      expect(byId(run.rows, id)?.detail).toContain('未找到全局 openlogos 入口');
    }
    expect(byId(run.rows, 'SMOKE-core-222')?.status).toBe('skip');
    expect(byId(run.rows, 'SMOKE-core-222')?.missing_requirements?.[0]).toContain('SMOKE-core-222.json');
  }, TIMEOUT);

  it('窗口内安装态不含事后检查引擎（旧版）→ 215～221 fail', () => {
    const run = runRunner(fakeRepo(SLUG), fakeInstall({ withEngine: false }));
    expect(run.status).not.toBe(0);
    for (const id of AUTO) expect(byId(run.rows, id)?.detail).toContain('不含事后检查引擎');
  }, TIMEOUT);

  it('窗口内版本与冻结候选不符 → 215～221 fail', () => {
    const run = runRunner(fakeRepo(SLUG), fakeInstall({ version: '9.9.9' }));
    expect(run.status).not.toBe(0);
    for (const id of AUTO) expect(byId(run.rows, id)?.detail).toContain('不符');
  }, TIMEOUT);

  it('SMOKE-core-222 证据判定：齐全 pass / verdict fail / 渠道不一致 / 字段不全 / 非法 JSON', () => {
    const repo = fakeRepo(SLUG);
    const cases: Array<[unknown, string, string]> = [
      [FULL_EVIDENCE, 'pass', '一致'],
      [{ ...FULL_EVIDENCE, verdict: 'fail' }, 'fail', 'fail'],
      [{ ...FULL_EVIDENCE, observed_channel: 'inject-agent' }, 'fail', '不一致'],
      [{ ...FULL_EVIDENCE, host_version: '', cursor_findings: { ...FULL_EVIDENCE.cursor_findings, invocation_id_field: null } }, 'skip', 'host_version'],
      [{ ...FULL_EVIDENCE, steps: [{ step: 1 }] }, 'skip', 'steps[step=2]'],
      ['{not json', 'skip', 'JSON'],
    ];
    for (const [doc, status, hint] of cases) {
      const run = runRunner(repo, null, { OPENLOGOS_GUARD_VERSIONED_SMOKE_EVIDENCE: evidenceFile(doc) });
      const row = byId(run.rows, 'SMOKE-core-222');
      expect(row?.status, JSON.stringify(row)).toBe(status);
      expect(row?.detail, JSON.stringify(row)).toContain(hint);
    }
    const partial = runRunner(repo, null, { OPENLOGOS_GUARD_VERSIONED_SMOKE_EVIDENCE: evidenceFile({ ...FULL_EVIDENCE, cursor_findings: { ...FULL_EVIDENCE.cursor_findings, invocation_id_field: null } }) });
    expect(byId(partial.rows, 'SMOKE-core-222')?.missing_requirements).toContain('cursor_findings.invocation_id_field');
  }, 120_000);

  it('窗口内候选正确 → 215～220 真实执行行为矩阵并 pass；221 缺回滚制品显式 skip；222 skip；退出 0', () => {
    const run = runRunner(fakeRepo(SLUG), fakeInstall());
    expect(run.rows.map(r => r.id)).toEqual(IDS);
    for (const id of IDS.slice(0, 6)) expect(byId(run.rows, id)?.status, `${id}: ${byId(run.rows, id)?.detail}`).toBe('pass');
    const r221 = byId(run.rows, 'SMOKE-core-221');
    expect(r221?.status).toBe('skip');
    expect(r221?.missing_requirements?.[0]).toContain('no-such-rollback.tgz');
    expect(byId(run.rows, 'SMOKE-core-222')?.status).toBe('skip');
    expect(run.status, run.stderr).toBe(0);
    // 行为证据：hook 调用被逐条记录（事件名、退出码）
    expect(byId(run.rows, 'SMOKE-core-217')?.evidence?.some(e => e.includes('"event":"PostToolUseFailure"') && e.includes('"exit":2'))).toBe(true);
  }, 300_000);

  it('随包引擎字节与本仓分发源不一致 → 215 fail（不以文件存在代替字节一致）', () => {
    const drifted = `${readFileSync(ENGINE_SRC, 'utf-8')}\n// drifted build\n`;
    const run = runRunner(fakeRepo(SLUG), fakeInstall({ engine: drifted }));
    expect(run.status).not.toBe(0);
    expect(byId(run.rows, 'SMOKE-core-215')?.status).toBe('fail');
    expect(byId(run.rows, 'SMOKE-core-215')?.detail).toContain('不一致');
  }, 300_000);
});
