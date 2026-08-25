import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runner = join(repoRoot, 'scripts', 'smoke-qoder-staging.js');

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
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
  });
});
