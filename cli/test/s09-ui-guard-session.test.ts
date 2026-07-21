/**
 * S09 — proposal-ui-ux-first 切片1：
 *   1) guard-check plan 阶段 allowlist（仅放行 page-design 原型 delta）
 *   2) 两源会话模板（openlogos-phase / Codex session-start.sh）writing/ready-to-delta
 *      GUI+ui_impact 例外文案
 *   3) change.ts proposal.md 注入「UI/UX 变更声明」段
 * 含 OpenLogos reporter：用例名带 UT/ST/SMOKE-S09/core 编号。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { change } from '../src/commands/change.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD_CHECK_SRC = join(rootDir, 'plugin', 'bin', 'guard-check');
const CODEX_HOOK = join(rootDir, 'plugin-codex', 'session-start.sh');
const PHASE_HOOK = join(rootDir, 'plugin', 'bin', 'openlogos-phase');
const OVERLAY_SRC = join(rootDir, 'spec', 'flow', 'overlays', 'gui-ui-first.yaml');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// ── guard-check harness ─────────────────────────────────────────────────────

function launchedYaml(): string {
  return 'project:\n  name: "ui-guard"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n';
}

/** Scaffold a launched project with an active guard for `slug`, plan-stage toggle. */
function planStageProject(slug: string, planApproved: boolean): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), launchedYaml());
  writeFileSync(
    join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: new Date().toISOString() }),
  );
  mkdirSync(join(root, 'logos', 'changes', slug, 'deltas', 'prd'), { recursive: true });
  if (planApproved) {
    writeFileSync(join(root, 'logos', 'changes', slug, 'PLAN_APPROVED'), '{}');
  }
  return root;
}

function runGuardCheck(root: string, toolName: string, toolInput: Record<string, unknown>) {
  const input = JSON.stringify({ tool_name: toolName, tool_input: toolInput });
  const result = spawnSync('bash', [GUARD_CHECK_SRC], {
    input,
    cwd: root,
    encoding: 'utf-8',
    timeout: 5000,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ── session-start harness ───────────────────────────────────────────────────

function sessionProject(gui: boolean): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), launchedYaml());
  if (gui) {
    mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
    writeFileSync(join(root, 'logos', 'flow', 'launched.yaml'), [
      'version: 1',
      'flow: launched',
      'extends: builtin:launched@v1',
      'overlay:',
      '  - op: add',
      '    after: write-tasks',
      '    node:',
      '      id: write-ui-prototype',
      '      produces: deltas/prd/2-product-design/2-page-design/',
      '',
    ].join('\n'));
  }
  return root;
}

function installOpenlogosWrapper(root: string, statusJson: string): string {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const wrapperPath = join(binDir, 'openlogos');
  writeFileSync(wrapperPath, [
    '#!/usr/bin/env bash',
    'if [ "$1" = "status" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then',
    `  cat <<'JSON'\n${statusJson}\nJSON\n  exit 0`,
    'fi',
    'echo "unexpected openlogos args: $*" >&2',
    'exit 1',
    '',
  ].join('\n'));
  execFileSync('chmod', ['755', wrapperPath]);
  return binDir;
}

function statusJson(fields: Record<string, unknown>): string {
  return JSON.stringify({
    command: 'status',
    version: 'test',
    data: { lifecycle: 'launched', current_phase: null, suggestion: 's', all_done: true, ...fields },
  });
}

function runCodex(root: string, binDir: string): string {
  const output = execFileSync('bash', [CODEX_HOOK], {
    cwd: root,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    encoding: 'utf-8',
  });
  return JSON.parse(output).hookSpecificOutput.additionalContext as string;
}

function runPhase(root: string, binDir: string): string {
  const output = execFileSync('bash', [PHASE_HOOK], {
    cwd: root,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    encoding: 'utf-8',
  });
  return JSON.parse(output).hookSpecificOutput.additionalContext as string;
}

// ── guard-check plan allowlist ──────────────────────────────────────────────

describe('S09 — guard-check plan-stage allowlist', () => {
  it('UT-S09-66: plan 阶段允许 page-design 原型 .html', () => {
    const root = planStageProject('feat', false);
    const r = runGuardCheck(root, 'Write', {
      file_path: join(root, 'logos', 'changes', 'feat', 'deltas', 'prd', '2-product-design', '2-page-design', 'core-01-home.html'),
    });
    expect(r.exitCode).toBe(0);
  });

  it('UT-S09-67: plan 阶段拒绝非原型 .md delta', () => {
    const root = planStageProject('feat', false);
    const r = runGuardCheck(root, 'Write', {
      file_path: join(root, 'logos', 'changes', 'feat', 'deltas', 'prd', '2-product-design', '1-feature-specs', 'core-01-feature-specs.md'),
    });
    expect(r.exitCode).toBe(2);
    expect(JSON.parse(r.stdout).reason).toContain('plan 阶段');
  });

  it('UT-S09-68: plan 阶段拒绝 page-design 目录下非 .html', () => {
    const root = planStageProject('feat', false);
    const r = runGuardCheck(root, 'Write', {
      file_path: join(root, 'logos', 'changes', 'feat', 'deltas', 'prd', '2-product-design', '2-page-design', 'core-01.md'),
    });
    expect(r.exitCode).toBe(2);
  });

  it('UT-S09-69: delta-writing（PLAN_APPROVED 存在）恢复常规 allowlist', () => {
    const root = planStageProject('feat', true);
    const r = runGuardCheck(root, 'Write', {
      file_path: join(root, 'logos', 'changes', 'feat', 'deltas', 'prd', '2-product-design', '1-feature-specs', 'x.md'),
    });
    expect(r.exitCode).toBe(0);
  });

  it('UT-S09-65: overlay write-ui-prototype produces 声明 2-page-design 目录', () => {
    const doc = parseYaml(readFileSync(OVERLAY_SRC, 'utf-8')) as {
      overlay: Array<{ node?: { id?: string; produces?: string } }>;
    };
    const node = doc.overlay.map(o => o.node).find(n => n?.id === 'write-ui-prototype');
    expect(node).toBeDefined();
    expect(node!.produces).toContain('deltas/prd/2-product-design/2-page-design/');
  });

  it('SMOKE-core-40: guard plan allowlist 端到端（放行原型、拦非原型）', () => {
    const root = planStageProject('feat', false);
    const html = runGuardCheck(root, 'Write', {
      file_path: join(root, 'logos', 'changes', 'feat', 'deltas', 'prd', '2-product-design', '2-page-design', 'core-01-home.html'),
    });
    const md = runGuardCheck(root, 'Write', {
      file_path: join(root, 'logos', 'changes', 'feat', 'deltas', 'prd', '1-feature-specs', 'x.md'),
    });
    expect(html.exitCode).toBe(0);
    expect(md.exitCode).toBe(2);
  });
});

// ── session template GUI+ui_impact exception ────────────────────────────────

describe('S09 — SessionStart writing GUI 例外文案', () => {
  it('UT-S09-107: GUI + writing → 含 page-design 原型 delta 例外', () => {
    const root = sessionProject(true);
    const binDir = installOpenlogosWrapper(root, statusJson({ active_change: 'feat', proposal_step: 'writing' }));
    const ctx = runCodex(root, binDir);
    expect(ctx).toContain('例外');
    expect(ctx).toContain('page-design 原型 delta');
    const phaseCtx = runPhase(root, binDir);
    expect(phaseCtx).toContain('page-design 原型 delta');
  });

  it('UT-S09-108: GUI + ready-to-delta → 同样含例外', () => {
    const root = sessionProject(true);
    const binDir = installOpenlogosWrapper(root, statusJson({ active_change: 'feat', proposal_step: 'ready-to-delta' }));
    const ctx = runCodex(root, binDir);
    expect(ctx).toContain('例外');
    expect(ctx).toContain('page-design 原型 delta');
  });

  it('UT-S09-109: 非 GUI → 不含例外文案，保留原禁令', () => {
    const root = sessionProject(false);
    const binDir = installOpenlogosWrapper(root, statusJson({ active_change: 'feat', proposal_step: 'writing' }));
    const ctx = runCodex(root, binDir);
    expect(ctx).not.toContain('page-design 原型 delta');
    expect(ctx).toContain('Do not write deltas');
  });

  it('ST-S09-40: 非 GUI ready-to-delta 回归 — 无例外且保留原文案', () => {
    const root = sessionProject(false);
    const binDir = installOpenlogosWrapper(root, statusJson({ active_change: 'feat', proposal_step: 'ready-to-delta' }));
    const ctx = runCodex(root, binDir);
    const phaseCtx = runPhase(root, binDir);
    expect(ctx).not.toContain('例外');
    expect(ctx).toContain('proceed to delta-writing');
    expect(phaseCtx).not.toContain('例外');
  });
});

// ── change.ts UI/UX declaration injection ───────────────────────────────────

describe('S09 — change 注入 UI/UX 变更声明段', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });
  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('SMOKE-core-38 / ST-S09-33: proposal.md 含 UI/UX 变更声明段与 yaml 占位字段', () => {
    change('ui-slug');
    const md = readFileSync(join(root, 'logos', 'changes', 'ui-slug', 'proposal.md'), 'utf-8');
    expect(md).toContain('## UI/UX 变更声明');
    expect(md).toContain('ui_impact: false');
    expect(md).toContain('design_system_mode: generated');
    expect(md).toContain('pages: []');
    // 占位段不打断后续 markdown 结构
    expect(md).toContain('## 变更概述');
  });

  it('ST-S09-33a: 占位允许 fallback 值（design_system_mode 支持 generated|fallback）', () => {
    change('ui-fallback');
    const md = readFileSync(join(root, 'logos', 'changes', 'ui-fallback', 'proposal.md'), 'utf-8');
    // 模板显式声明 fallback 分支与 design_system_fallback_reason 占位，checker 片据此判 fallback
    expect(md).toContain('fallback');
    expect(md).toContain('design_system_fallback_reason');
  });
});
