import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runner = join(repoRoot, 'scripts', 'smoke-qoder-staging.js');
const driver = join(repoRoot, 'scripts', 'qoder-staging-driver.js');

describe('Qoder staging smoke runner 合同', () => {
  it('声明完整 SMOKE 归属、真实环境前置且没有公开发布命令', () => {
    const result = spawnSync(process.execPath, [runner, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const contract = JSON.parse(result.stdout);
    expect(contract.ids).toEqual(Array.from({ length: 8 }, (_, index) => `SMOKE-core-${108 + index}`));
    expect(contract.required_env).toContain('OPENLOGOS_QODER_BIN');
    expect(contract.required_env).toContain('OPENLOGOS_TARBALL');
    expect(contract.public_release_commands).toEqual([]);
  });

  it('dispatcher 可发现 runner，runner 使用 JSONL reporter 并在非本提案时安全退出', () => {
    const dispatcher = readFileSync(join(repoRoot, 'scripts', 'run-smoke.js'), 'utf8');
    const source = readFileSync(runner, 'utf8');
    expect(dispatcher).toContain('smoke-');
    expect(source).toContain('OPENLOGOS_SMOKE_RESULT_PATH');
    expect(source).toContain("environment: 'staging'");
    expect(source).toContain("activeChange() !== 'qoder-adapter-foundation'");
    expect(source).toContain("runCli(context.entry, workspace, ['launch'])");
    for (let id = 108; id <= 115; id += 1) {
      expect(source).toContain(`await smoke('SMOKE-core-${id}'`);
    }
    expect(source).not.toMatch(/await smoke\('SMOKE-core-10[0-7]'/);
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });

  it('真实 driver 声明完整阶段并调用 Qoder CLI，不包含公开发布动作', () => {
    const result = spawnSync(process.execPath, [driver, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const contract = JSON.parse(result.stdout);
    expect(contract.phases).toEqual(['install', 'inventory', 'session-start', 'write', 'hard-deny', 'sync-launch', 'rollback']);
    expect(contract.real_cli_commands).toContain('plugins install');
    expect(contract.real_cli_commands).toContain('--print');
    expect(contract.public_release_commands).toEqual([]);
    const source = readFileSync(driver, 'utf8');
    expect(source).toContain("['plugins', 'validate'");
    expect(source).toContain("['plugins', 'install'");
    expect(source).toContain("'--print'");
    expect(source).toContain('invokeSessionRuntime(payload)');
    expect(source).toContain('用户可见的项目状态结论');
    expect(source).not.toContain('请只返回你收到的 OpenLogos SessionStart 上下文');
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });
});
