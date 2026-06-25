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
    verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
      sandbox_mode: 'auto',
      sandbox_root: '/private/tmp',
      sandbox_deny_workspace_write: true,
    },
    smoke: {
      result_path: 'logos/resources/verify/smoke-results.jsonl',
      report_path: 'logos/resources/verify/smoke-report.md',
      sandbox_mode: 'auto',
      sandbox_root: '/private/tmp',
      sandbox_deny_workspace_write: true,
    },
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
 * Capture console.log / console.error / console.warn output as string arrays.
 * Returns { logs, errors, warns, restore }.
 */
export function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
    logs.push(args.map(String).join(' ')); // also mirror to logs for backward compat
  });

  return {
    logs,
    errors,
    warns,
    restore: () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
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

/**
 * change-flow-redesign：builtin launched 的 implement 子流程默认激活切片循环
 * （until: code_slices_green, max_iters: 30）。任何处于 verify-pass 之后的 launched 提案
 * 在真实流程中由 `openlogos verify` 同时写一行 pass 的 LOOP_ITERS 账本（loop 收敛）。
 * 合成测试 fixture 写 VERIFY_PASS marker 时须补写这行账本，否则 loop 未收敛会把
 * proposal_step 回拉到 ready-to-verify（converged 裁决出环，见 spec/flow-spec.md §6/§12.4）。
 * @param proposalDir 提案目录（VERIFY_PASS 同目录）
 * @param module 归属模块（默认 core，须与 guard.module 一致）
 */
export function writeLoopPass(proposalDir: string, module = 'core'): void {
  writeFileSync(
    join(proposalDir, 'LOOP_ITERS'),
    JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module, timestamp: '2026-06-20T00:00:00.000Z' }) + '\n',
  );
}
