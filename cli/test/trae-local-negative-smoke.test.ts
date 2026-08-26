import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  DEPLOYABLE_AI_TOOLS,
  TRAE_LOCAL_SMOKE_IDS,
  assertPackageMetadata,
  assertWithinRoot,
  snapshotTree,
  validateSmokeRecords,
} from '../../scripts/smoke-trae-local-negative.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runner = join(repoRoot, 'scripts', 'smoke-trae-local-negative.js');
const entry = join(repoRoot, 'cli', 'dist', 'index.js');

function isolatedEnv(root: string): NodeJS.ProcessEnv {
  const home = join(root, 'home');
  const prefix = join(root, 'prefix');
  const cache = join(root, 'cache');
  for (const dir of [home, prefix, cache]) mkdirSync(dir, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_CACHE_HOME: join(home, '.cache'),
    CODEX_HOME: join(home, '.codex'),
    OPENLOGOS_CODEX_PERSONAL_HOME: home,
    NPM_CONFIG_PREFIX: prefix,
    NPM_CONFIG_CACHE: cache,
  };
}

function runCli(root: string, workspace: string, args: string[]) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: workspace,
    env: isolatedEnv(root),
    encoding: 'utf8',
    timeout: 30_000,
  });
}

function writeTraeFixture(workspace: string): void {
  const fixtures: Array<[string, string | Buffer]> = [
    ['.trae/rules/project.md', '# 用户规则\n'],
    ['.trae/skills/local/SKILL.md', '# 用户技能\n'],
    ['.trae/agents/reviewer.md', '# 用户 Agent\n'],
    ['.trae/hooks.json', '{"hooks":{"PreToolUse":[]}}\n'],
    ['.trae/mcp.json', '{"servers":{}}\n'],
    ['.trae/settings.json', '{"model":"user-owned"}\n'],
    ['.trae/account.json', '{"account":"opaque"}\n'],
    ['.trae/enabled_folders', '/synthetic/workspace\n'],
    ['.trae/native-memory.bin', Buffer.from([0, 255, 8, 4])],
  ];
  for (const [relativePath, content] of fixtures) {
    const target = join(workspace, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

describe('TRAE local-isolated negative smoke 单切片', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openlogos-trae-negative-test-'));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('UT-S01-128: 制品身份和入口必须精确匹配候选版本且位于隔离根', () => {
    expect(assertPackageMetadata({ name: '@miniidealab/openlogos', version: '0.13.29' }, '0.13.29')).toEqual({
      name: '@miniidealab/openlogos',
      version: '0.13.29',
    });
    expect(() => assertPackageMetadata({ name: '@miniidealab/openlogos', version: '0.13.28' }, '0.13.29')).toThrow(/0\.13\.29/);
    const inside = join(root, 'prefix', 'bin');
    mkdirSync(inside, { recursive: true });
    expect(assertWithinRoot(root, inside)).toBe(realpathSync(inside));
    expect(() => assertWithinRoot(root, repoRoot)).toThrow(/逃逸/);
  });

  it('ST-S01-26: 真实 CLI 显式 trae 在首次写入前失败且合成用户边界不变', () => {
    const workspace = join(root, 'explicit-trae');
    mkdirSync(workspace, { recursive: true });
    writeTraeFixture(workspace);
    const before = snapshotTree(workspace);

    const result = runCli(root, workspace, ['init', 'explicit-trae', '--locale', 'zh', '--ai-tool', 'trae']);

    expect(result.status).not.toBe(0);
    expect(snapshotTree(workspace)).toEqual(before);
    expect(existsSync(join(workspace, 'logos', 'logos.config.json'))).toBe(false);
    const output = `${result.stderr}\n${result.stdout}`;
    for (const id of DEPLOYABLE_AI_TOOLS) expect(output).toContain(id);
  }, 30_000);

  it('UT-S08-37: runner 固定七宿主、严格配置失败和不透明哈希比较合同', () => {
    const source = readFileSync(runner, 'utf8');
    expect(DEPLOYABLE_AI_TOOLS).toEqual(['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy']);
    expect(source).toContain("runCli(context, workspace, ['init', 'all-seven-hosts'");
    expect(source).toContain("invalidConfig.aiTool = ['cursor', 'trae']");
    expect(source).toContain("snapshotTree(join(workspace, '.trae'))");
    expect(source).not.toContain('Trae.app/Contents/MacOS');
  });

  it('ST-S08-27: 真实 CLI all/sync 保持七宿主，含 trae 配置在事务前失败', () => {
    const allWorkspace = join(root, 'all-seven-hosts');
    mkdirSync(allWorkspace, { recursive: true });
    writeTraeFixture(allWorkspace);
    const traeBefore = snapshotTree(join(allWorkspace, '.trae'));
    const initialized = runCli(root, allWorkspace, ['init', 'all-seven-hosts', '--locale', 'zh', '--ai-tool', 'all']);
    expect(initialized.status, initialized.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(allWorkspace, 'logos', 'logos.config.json'), 'utf8')).aiTool).toEqual(DEPLOYABLE_AI_TOOLS);
    expect(snapshotTree(join(allWorkspace, '.trae'))).toEqual(traeBefore);
    const synced = runCli(root, allWorkspace, ['sync']);
    expect(synced.status, synced.stderr).toBe(0);
    expect(snapshotTree(join(allWorkspace, '.trae'))).toEqual(traeBefore);

    const invalidWorkspace = join(root, 'invalid-config');
    mkdirSync(invalidWorkspace, { recursive: true });
    expect(runCli(root, invalidWorkspace, ['init', 'invalid-config', '--locale', 'zh', '--ai-tool', 'cursor']).status).toBe(0);
    const configPath = join(invalidWorkspace, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.aiTool = ['cursor', 'trae'];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const invalidBefore = snapshotTree(invalidWorkspace);
    const rejected = runCli(root, invalidWorkspace, ['sync']);
    expect(rejected.status).not.toBe(0);
    expect(snapshotTree(invalidWorkspace)).toEqual(invalidBefore);
  }, 30_000);

  it('UT-S19-10: dispatcher 独立路由精确的 0.13.29 候选与 0.13.28 回滚输入', () => {
    const dispatcher = readFileSync(join(repoRoot, 'scripts', 'run-smoke.js'), 'utf8');
    expect(dispatcher).toContain("'scripts/smoke-trae-local-negative.js'");
    expect(dispatcher).toContain('OPENLOGOS_TRAE_LOCAL_TARBALL');
    expect(dispatcher).toContain('OPENLOGOS_TRAE_ROLLBACK_TARBALL');
    expect(() => assertPackageMetadata({ name: '@miniidealab/openlogos', version: '0.13.29' }, '0.13.29')).not.toThrow();
    expect(() => assertPackageMetadata({ name: '@miniidealab/openlogos', version: '0.13.28' }, '0.13.28')).not.toThrow();
  });

  it('UT-S19-11: reporter 只接受六个唯一 pass、local-isolated、匹配 SHA 和非空证据', () => {
    const records = TRAE_LOCAL_SMOKE_IDS.map(id => ({
      id,
      status: 'pass',
      environment: 'local-isolated',
      candidate_tarball_sha256: 'candidate',
      rollback_tarball_sha256: 'rollback',
      evidence: [`${id}.json`],
    }));
    expect(validateSmokeRecords(records, 'candidate', 'rollback')).toBe(true);
    expect(() => validateSmokeRecords(records.slice(1), 'candidate', 'rollback')).toThrow(/缺失/);
    expect(() => validateSmokeRecords([...records, records[0]], 'candidate', 'rollback')).toThrow(/重复/);
    expect(() => validateSmokeRecords(records.map((item, index) => index === 0 ? { ...item, status: 'skip' } : item), 'candidate', 'rollback')).toThrow(/未通过/);
  });

  it('ST-S19-09: runner/dispatcher/reporter 合同覆盖 SMOKE-core-124～SMOKE-core-129 且无公开发布或真实 TRAE 调用', () => {
    const result = spawnSync(process.execPath, [runner, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const contract = JSON.parse(result.stdout);
    expect(contract.ids).toEqual(TRAE_LOCAL_SMOKE_IDS);
    expect(contract.environment).toBe('local-isolated');
    expect(contract.required_source_env).toEqual(['OPENLOGOS_TRAE_LOCAL_TARBALL', 'OPENLOGOS_TRAE_ROLLBACK_TARBALL']);
    expect(contract.routed_env).toEqual(['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL']);
    expect(contract.capability_status).toBe('BLOCKED');
    expect(contract.launches_trae).toBe(false);
    expect(contract.public_release_commands).toEqual([]);

    const source = readFileSync(runner, 'utf8');
    for (const id of TRAE_LOCAL_SMOKE_IDS) expect(source).toContain(`await smoke('${id}'`);
    expect(source).toContain("environment: 'local-isolated'");
    expect(source).toContain('candidate_tarball_sha256');
    expect(source).toContain('rollback_tarball_sha256');
    expect(source).toContain("capability_status: 'BLOCKED'");
    expect(source).not.toMatch(/spawnSync\([^\n]*(?:Trae\.app|Trae CN\.app)/i);
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });

  it('SMOKE-core-124 / SMOKE-core-125 / SMOKE-core-126 / SMOKE-core-127 / SMOKE-core-128 / SMOKE-core-129: smoke 覆盖预检可发现全部真实 reporter 调用', () => {
    const source = readFileSync(runner, 'utf8');
    expect(TRAE_LOCAL_SMOKE_IDS).toHaveLength(6);
    for (const id of TRAE_LOCAL_SMOKE_IDS) {
      expect(source.match(new RegExp(`await smoke\\('${id}'`, 'g'))).toHaveLength(1);
    }
    expect(source).toContain('appendFileSync(resultPath');
    expect(source).toContain('validateSmokeRecords(produced');
  });
});
