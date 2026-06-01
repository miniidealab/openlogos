import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { deployClaudeCodePlugin, findClaudePluginTemplateSource } from '../src/commands/init.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Path to the guard-check script in the plugin template
const GUARD_CHECK_SRC = join(rootDir, 'plugin', 'bin', 'guard-check');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeYaml(lifecycle: 'initial' | 'launched'): string {
  return `project:\n  name: "test"\n  description: ""\nmodules:\n  - id: core\n    name: 核心功能\n    lifecycle: ${lifecycle}\n`;
}

function runGuardCheck(
  root: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): { exitCode: number; stdout: string; stderr: string } {
  const input = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  const result = spawnSync('bash', [GUARD_CHECK_SRC], {
    input,
    cwd: root,
    encoding: 'utf-8',
    timeout: 5000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

// ── Unit Tests ────────────────────────────────────────────────────────────────

describe('S09 Unit Tests — guard-check script', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });
  afterEach(() => cleanup());

  it('UT-S09-11: launched + no guard → block Edit on source file', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), makeYaml('launched'));

    const result = runGuardCheck(root, 'Edit', { file_path: join(root, 'src', 'index.ts') });

    expect(result.exitCode).toBe(2);
    const reason = JSON.parse(result.stdout).reason;
    expect(reason).toContain('变更管理拦截');
    expect(reason).toContain('openlogos change');
  });

  it('UT-S09-12: launched + guard exists → allow Edit', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), makeYaml('launched'));
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'my-change', module: 'core', createdAt: new Date().toISOString() }),
    );

    const result = runGuardCheck(root, 'Edit', { file_path: join(root, 'src', 'index.ts') });

    expect(result.exitCode).toBe(0);
  });

  it('UT-S09-13: initial lifecycle → allow Edit unconditionally', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), makeYaml('initial'));

    const result = runGuardCheck(root, 'Edit', { file_path: join(root, 'src', 'index.ts') });

    expect(result.exitCode).toBe(0);
  });

  it('UT-S09-14: whitelist logos/changes/ → allow Edit without guard', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), makeYaml('launched'));
    mkdirSync(join(root, 'logos', 'changes', 'my-change'), { recursive: true });

    const result = runGuardCheck(root, 'Edit', {
      file_path: join(root, 'logos', 'changes', 'my-change', 'proposal.md'),
    });

    expect(result.exitCode).toBe(0);
  });

  it('UT-S09-15: whitelist CLAUDE.md → allow Write without guard', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), makeYaml('launched'));

    const result = runGuardCheck(root, 'Write', {
      file_path: join(root, 'CLAUDE.md'),
    });

    expect(result.exitCode).toBe(0);
  });

  it('UT-S09-16: Bash sed -i on source file → block without guard', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), makeYaml('launched'));

    const result = runGuardCheck(root, 'Bash', {
      command: "sed -i 's/foo/bar/' src/foo.ts",
    });

    expect(result.exitCode).toBe(2);
    const reason = JSON.parse(result.stdout).reason;
    expect(reason).toContain('变更管理拦截');
  });

  it('UT-S09-17: openlogos CLI command → allow without guard', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), makeYaml('launched'));

    const result = runGuardCheck(root, 'Bash', {
      command: 'openlogos status',
    });

    expect(result.exitCode).toBe(0);
  });

  it('UT-S09-18: no logos.config.json → allow (not an OpenLogos project)', () => {
    // makeTempRoot without scaffoldProject — no logos dir
    const { root: emptyRoot, cleanup: emptyCleanup } = makeTempRoot();
    try {
      const result = runGuardCheck(emptyRoot, 'Edit', { file_path: join(emptyRoot, 'src', 'index.ts') });
      expect(result.exitCode).toBe(0);
    } finally {
      emptyCleanup();
    }
  });

  it('UT-S09-19: deployClaudeCodePlugin deploys guard-check script', () => {
    const source = findClaudePluginTemplateSource();
    if (!source) {
      console.warn('Skipping: plugin template source not found');
      return;
    }

    deployClaudeCodePlugin(root);

    const guardDest = join(root, '.claude', 'openlogos', 'bin', 'guard-check');
    expect(existsSync(guardDest)).toBe(true);

    // Should be executable
    const stat = require('node:fs').statSync(guardDest);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  it('UT-S09-20: deployClaudeCodePlugin registers PreToolUse hook in settings.json', () => {
    const source = findClaudePluginTemplateSource();
    if (!source) {
      console.warn('Skipping: plugin template source not found');
      return;
    }

    deployClaudeCodePlugin(root);

    const settingsPath = join(root, '.claude', 'settings.json');
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const preToolUse = settings?.hooks?.PreToolUse;
    expect(Array.isArray(preToolUse)).toBe(true);

    const hasGuardHook = preToolUse.some((group: unknown) => {
      if (typeof group !== 'object' || group === null) return false;
      const g = group as Record<string, unknown>;
      return g['matcher'] === 'Edit|Write|Bash' &&
        Array.isArray(g['hooks']) &&
        (g['hooks'] as unknown[]).some((h: unknown) => {
          if (typeof h !== 'object' || h === null) return false;
          return (h as Record<string, unknown>)['command'] === '.claude/openlogos/bin/guard-check';
        });
    });
    expect(hasGuardHook).toBe(true);
  });
});
