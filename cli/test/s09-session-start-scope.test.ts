/**
 * S09/S11 — AI 宿主 SessionStart guard 范围注入。
 * 覆盖 Codex session-start.sh 与 Claude/openlogos-phase 两套入口。
 * 含 OpenLogos reporter：用例名带 UT/ST-S09、UT/ST-S11 编号。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODEX_HOOK = join(rootDir, 'plugin-codex', 'session-start.sh');
const PHASE_HOOK = join(rootDir, 'plugin', 'bin', 'openlogos-phase');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:',
    '  name: "session-scope"',
    'modules:',
    '  - id: core',
    '    name: core',
    '    lifecycle: launched',
    '',
  ].join('\n'));
  return root;
}

function installOpenlogosWrapper(root: string, statusJson: string, failStatus = false) {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const wrapperPath = join(binDir, 'openlogos');
  writeFileSync(wrapperPath, [
    '#!/usr/bin/env bash',
    'if [ "$1" = "status" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then',
    failStatus ? '  exit 42' : `  cat <<'JSON'\n${statusJson}\nJSON\n  exit 0`,
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
    data: {
      lifecycle: 'launched',
      current_phase: null,
      suggestion: '中文 suggestion 不应作为唯一事实源',
      all_done: true,
      ...fields,
    },
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

function runPhase(root: string, binDir: string, plain = false): string {
  const args = plain ? [PHASE_HOOK, '--plain'] : [PHASE_HOOK];
  const output = execFileSync('bash', args, {
    cwd: root,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    encoding: 'utf-8',
  });
  if (plain) return output;
  return JSON.parse(output).hookSpecificOutput.additionalContext as string;
}

describe('S09/S11 — SessionStart guard 范围注入', () => {
  it('UT-S09-51: Codex SessionStart writing 阶段只允许 proposal/tasks', () => {
    const root = tempProject();
    const binDir = installOpenlogosWrapper(root, statusJson({
      active_change: 'feat',
      proposal_step: 'writing',
    }));

    const context = runCodex(root, binDir);

    expect(context).toContain('logos/changes/feat/proposal.md');
    expect(context).toContain('logos/changes/feat/tasks.md');
    expect(context).not.toContain('logos/changes/feat/deltas/**');
    expect(context).not.toContain('Only modify files within the scope of logos/changes/feat/proposal.md');
  });

  it('UT-S09-52 / ST-S09-27 / ST-S11-31: Codex delta-writing 阶段允许 deltas/tasks', () => {
    const root = tempProject();
    const binDir = installOpenlogosWrapper(root, statusJson({
      active_change: 'feat',
      proposal_step: 'delta-writing',
    }));

    const context = runCodex(root, binDir);

    expect(context).toContain('logos/changes/feat/deltas/**');
    expect(context).toContain('logos/changes/feat/tasks.md');
    expect(context).toContain('do not modify logos/resources/** or source code directly');
    expect(context).not.toContain('Only modify files within the scope of logos/changes/feat/proposal.md');
  });

  it('UT-S09-53: openlogos-phase delta-writing 阶段允许 deltas/tasks', () => {
    const root = tempProject();
    const binDir = installOpenlogosWrapper(root, statusJson({
      active_change: 'feat',
      proposal_step: 'delta-writing',
    }));

    const context = runPhase(root, binDir);

    expect(context).toContain('logos/changes/feat/deltas/**');
    expect(context).toContain('logos/changes/feat/tasks.md');
    expect(context).not.toContain('Only modify files within the scope of logos/changes/feat/proposal.md');
  });

  it('UT-S09-54: status 不可用时 guard 回退文案不得固定到 proposal.md', () => {
    const root = tempProject();
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    const binDir = installOpenlogosWrapper(root, '{}', true);

    const context = runCodex(root, binDir);

    expect(context).toContain('Active change proposal: \'feat\'');
    expect(context).toContain('Run openlogos status or openlogos next to confirm the current proposal step');
    expect(context).not.toContain('Only modify files within the scope of logos/changes/feat/proposal.md');
  });

  it('UT-S11-40: SessionStart 优先读取顶层 active_change / proposal_step', () => {
    const root = tempProject();
    const binDir = installOpenlogosWrapper(root, statusJson({
      active_change: 'feat',
      proposal_step: 'delta-writing',
      modules: [{ active_change: { slug: 'other', proposal_step: 'ready-to-merge' } }],
    }));

    const context = runCodex(root, binDir);

    expect(context).toContain('logos/changes/feat/deltas/**');
    expect(context).not.toContain('logos/changes/other');
  });

  it('UT-S11-41: SessionStart 顶层缺失时回退 modules[].active_change', () => {
    const root = tempProject();
    const binDir = installOpenlogosWrapper(root, statusJson({
      active_change: null,
      proposal_step: null,
      modules: [{ active_change: { slug: 'feat', proposal_step: 'delta-writing' } }],
    }));

    const context = runCodex(root, binDir);

    expect(context).toContain('logos/changes/feat/deltas/**');
    expect(context).toContain('logos/changes/feat/tasks.md');
  });

  it('UT-S11-42: SessionStart 不把 suggestion 当作唯一事实源', () => {
    const root = tempProject();
    const binDir = installOpenlogosWrapper(root, statusJson({
      active_change: 'feat',
      proposal_step: 'ready-to-merge',
      suggestion: '继续为 feat 产出 delta 文件',
    }));

    const context = runCodex(root, binDir);

    expect(context).toContain('openlogos merge feat');
    expect(context).not.toContain('logos/changes/feat/deltas/**');
  });
});
