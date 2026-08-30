import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runner = join(repoRoot, 'scripts', 'smoke-workbuddy-staging.js');
const driver = join(repoRoot, 'scripts', 'workbuddy-staging-driver.js');

describe('WorkBuddy staging smoke runner 合同', () => {
  it('SMOKE-core-116/117：声明完整归属、真实 app 与 tarball 前置且没有公开发布命令', () => {
    const result = spawnSync(process.execPath, [runner, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const contract = JSON.parse(result.stdout);
    expect(contract.ids).toEqual(Array.from({ length: 8 }, (_, index) => `SMOKE-core-${116 + index}`));
    expect(contract.required_env).toContain('OPENLOGOS_WORKBUDDY_APP');
    expect(contract.required_env).toContain('OPENLOGOS_WORKBUDDY_AUTH_HOME');
    expect(contract.required_env).toContain('OPENLOGOS_WORKBUDDY_BIN');
    expect(contract.required_env).toContain('OPENLOGOS_TARBALL');
    expect(contract.required_env).toContain('OPENLOGOS_PREVIOUS_TARBALL');
    expect(contract.public_release_commands).toEqual([]);
  });

  it('SMOKE-core-116/123：runner reporter 可发现，并强制 CLI profile 与真实 Home 边界隔离', () => {
    const dispatcher = readFileSync(join(repoRoot, 'scripts', 'run-smoke.js'), 'utf8');
    const source = readFileSync(runner, 'utf8');
    expect(dispatcher).toContain('smoke-');
    expect(source).toContain('OPENLOGOS_SMOKE_RESULT_PATH');
    expect(source).toContain("environment: 'staging'");
    expect(source).toContain('workbuddy_version');
    expect(source).toContain('tarball_sha256');
    expect(source).toContain('OPENLOGOS_CODEX_PERSONAL_HOME: profile');
    expect(source).toContain('CODEX_HOME: codexRoot');
    expect(source).toContain('snapshotHostBoundary()');
    expect(source).toContain('host-home-boundary.json');
    expect(source).toContain("runCli(context.entry, regressionRoot, ['init'");
    expect(source).toContain('context.profile);');
    expect(source).toContain("activeChange() !== 'workbuddy-adapter-foundation' && process.env.OPENLOGOS_WORKBUDDY_STAGING !== '1'");
    for (let id = 116; id <= 123; id += 1) expect(source).toContain(`await smoke('SMOKE-core-${id}'`);
    expect(source).not.toMatch(/await smoke\('SMOKE-core-10[8-9]'/);
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });

  it('SMOKE-core-117/118：driver 分离 app/engine 版本并用真实结构化会话发现和调用组件', () => {
    const result = spawnSync(process.execPath, [driver, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const contract = JSON.parse(result.stdout);
    expect(contract.minimum_app_version).toBe('5.3.5');
    expect(contract.phases).toEqual(['capability', 'inventory', 'session-start', 'write', 'hard-deny', 'sync-launch', 'rollback']);
    expect(contract.real_cli_commands).toContain('plugin validate');
    expect(contract.real_cli_commands).toContain('--plugin-dir');
    expect(contract.real_cli_commands).toContain('--print');
    expect(contract.real_cli_commands).toContain('--tools Read,Glob');
    expect(contract.real_cli_commands).toContain('--agent');
    expect(contract.public_release_commands).toEqual([]);
    const source = readFileSync(driver, 'utf8');
    expect(source).toContain("['plugin', 'validate'");
    expect(source).toContain("'--plugin-dir', payload.pluginPath");
    expect(source).toContain("'--no-session-persistence'");
    expect(source).toContain("'--permission-mode', 'acceptEdits'");
    expect(source).toContain('workBuddySession(payload');
    expect(source).toContain("HOME: payload.profile");
    expect(source).toContain('const appVersion = versionTuple(payload.workBuddyVersion)');
    expect(source).toContain('engineVersion: engineVersion.text');
    expect(source).toContain('HOME: payload.workBuddyAuthHome');
    expect(source).toContain("CODEBUDDY_DISABLE_AUTO_MEMORY: '1'");
    expect(source).toContain("item.type === 'result'");
    expect(source).toContain("agent: 'change-reviewer'");
    expect(source).toContain("['skills', 'change-writer']");
    expect(source).toContain("tools: 'Read,Glob'");
    expect(source).toContain('discoveryAttempts: session.attempt');
    expect(source).toContain('agentInvocationAttempts: agentProbe.attempt');
    expect(source).not.toContain("args.push('--json-schema'");
    expect(source).toContain('WorkBuddy headless session 失败（exit=');
    expect(source).not.toContain("'agents --json'");
    expect(source).not.toContain("['--plugin-dir', payload.pluginPath, 'agents', '--json']");
    expect(source).toContain("permissionDecision !== 'deny'");
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });

  it('SMOKE-core-67/100/108/116：dispatcher 为并行宿主路由独立制品，显式候选入口按候选版本验收', () => {
    const dispatcher = readFileSync(join(repoRoot, 'scripts', 'run-smoke.js'), 'utf8');
    const baseline = readFileSync(join(repoRoot, 'scripts', 'smoke-baseline-on-touch.js'), 'utf8');
    for (const host of ['ZCODE', 'QODER', 'WORKBUDDY']) {
      expect(dispatcher).toContain(`OPENLOGOS_${host}_TARBALL`);
      expect(dispatcher).toContain(`OPENLOGOS_${host}_PREVIOUS_TARBALL`);
    }
    expect(dispatcher).toContain('env: environmentFor(runner)');
    expect(baseline).toContain('const expectedVersion = packageJson.version');
  });
});
