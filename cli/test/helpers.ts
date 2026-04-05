import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi, type MockInstance } from 'vitest';

/**
 * Create an isolated temp directory that mimics an OpenLogos project root.
 * Returns { root, cleanup }.
 */
export function makeTempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-test-'));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Scaffold a minimal OpenLogos project structure inside `root`.
 */
export function scaffoldProject(
  root: string,
  opts: { name?: string; locale?: 'en' | 'zh' } = {},
) {
  const name = opts.name ?? 'test-project';
  const locale = opts.locale ?? 'en';

  const config = {
    name,
    locale,
    description: '',
    documents: {},
    verify: { result_path: 'logos/resources/verify/test-results.jsonl' },
  };

  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify(config, null, 2));

  const yaml = `project:\n  name: "${name}"\n  description: ""\n  methodology: "OpenLogos"\n`;
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), yaml);

  const dirs = [
    'logos/resources/prd/1-product-requirements',
    'logos/resources/prd/2-product-design',
    'logos/resources/prd/3-technical-plan/1-architecture',
    'logos/resources/prd/3-technical-plan/2-scenario-implementation',
    'logos/resources/api',
    'logos/resources/database',
    'logos/resources/test',
    'logos/resources/scenario',
    'logos/resources/verify',
    'logos/changes',
    'logos/changes/archive',
  ];
  for (const d of dirs) {
    mkdirSync(join(root, d), { recursive: true });
  }
}

/**
 * Capture console.log / console.error output as string arrays.
 * Returns { logs, errors, restore }.
 */
export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });

  return {
    logs,
    errors,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    },
  };
}

/**
 * Mock process.cwd to return a specific path.
 * Returns a restore function.
 */
export function mockCwd(dir: string): () => void {
  const original = process.cwd;
  process.cwd = () => dir;
  return () => { process.cwd = original; };
}

/**
 * Mock process.exit to throw instead of killing the process.
 * Returns the spy.
 */
export function mockProcessExit(): MockInstance {
  return vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit(${code})`);
  });
}
