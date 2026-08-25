import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runner = join(repoRoot, 'scripts', 'smoke-workbuddy-staging.js');
const driver = join(repoRoot, 'scripts', 'workbuddy-staging-driver.js');

describe('WorkBuddy staging smoke runner 合同', () => {
  it('声明 SMOKE-core-116..123、真实环境前置且没有公开发布命令', () => {
    const result = spawnSync(process.execPath, [runner, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const contract = JSON.parse(result.stdout);
    expect(contract.ids).toEqual(Array.from({ length: 8 }, (_, index) => `SMOKE-core-${116 + index}`));
    expect(contract.required_env).toContain('OPENLOGOS_WORKBUDDY_BIN');
    expect(contract.required_env).toContain('OPENLOGOS_TARBALL');
    expect(contract.required_env).toContain('OPENLOGOS_PREVIOUS_TARBALL');
    expect(contract.public_release_commands).toEqual([]);
  });

  it('dispatcher 可发现 runner，JSONL reporter 含 staging/宿主版本/tarball 哈希', () => {
    const dispatcher = readFileSync(join(repoRoot, 'scripts', 'run-smoke.js'), 'utf8');
    const source = readFileSync(runner, 'utf8');
    expect(dispatcher).toContain('smoke-');
    expect(source).toContain('OPENLOGOS_SMOKE_RESULT_PATH');
    expect(source).toContain("environment: 'staging'");
    expect(source).toContain('workbuddy_version');
    expect(source).toContain('tarball_sha256');
    expect(source).toContain("activeChange() !== 'workbuddy-adapter-foundation' && process.env.OPENLOGOS_WORKBUDDY_STAGING !== '1'");
    for (let id = 116; id <= 123; id += 1) expect(source).toContain(`await smoke('SMOKE-core-${id}'`);
    expect(source).not.toMatch(/await smoke\('SMOKE-core-10[8-9]'/);
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });

  it('真实 driver 使用官方 CodeBuddy CLI 命令面与隔离 profile，不以 runtime 直调冒充真实宿主', () => {
    const result = spawnSync(process.execPath, [driver, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const contract = JSON.parse(result.stdout);
    expect(contract.minimum_version).toBe('5.3.5');
    expect(contract.phases).toEqual(['capability', 'inventory', 'session-start', 'write', 'hard-deny', 'sync-launch', 'rollback']);
    expect(contract.real_cli_commands).toContain('plugin validate');
    expect(contract.real_cli_commands).toContain('--plugin-dir');
    expect(contract.real_cli_commands).toContain('--print');
    expect(contract.public_release_commands).toEqual([]);
    const source = readFileSync(driver, 'utf8');
    expect(source).toContain("['plugin', 'validate'");
    expect(source).toContain("'--plugin-dir', payload.pluginPath");
    expect(source).toContain("'--no-session-persistence'");
    expect(source).toContain("'--permission-mode', 'acceptEdits'");
    expect(source).toContain('workBuddySession(payload');
    expect(source).toContain("HOME: payload.profile");
    expect(source).toContain("permissionDecision !== 'deny'");
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });
});
