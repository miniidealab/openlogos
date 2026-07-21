/**
 * proposal-ui-ux-first 切片3：前置能力门 + 双阶段发布状态。
 * 会话 capability 输入闭环（两源模板 + status/next JSON），能力缺失=降级；
 * 双阶段发布状态 contract-ready / feature-enabled 契约侧判定。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { collectStatusData } from '../src/commands/status.js';
import { status } from '../src/commands/status.js';
import {
  buildCapabilities, readSessionCapabilities, evaluateReleaseStatus, UI_UX_PANEL_DEPENDENCY,
} from '../src/lib/ui-first.js';

const rootDir = join(__dirname, '..', '..');
const PHASE_HOOK = join(rootDir, 'plugin', 'bin', 'openlogos-phase');
const CODEX_HOOK = join(rootDir, 'plugin-codex', 'session-start.sh');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function launchedProject(capability?: boolean): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: t\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n    product_type: web\n');
  if (capability !== undefined) {
    writeFileSync(join(root, 'logos', '.session-capabilities.json'),
      JSON.stringify({ ui_prototype_render: capability }));
  }
  return root;
}

/** 装一个 openlogos wrapper（会话模板会调 `openlogos status --format json`）。 */
function installWrapper(root: string): string {
  const binDir = join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const envelope = JSON.stringify({ command: 'status', version: 'test', data: { lifecycle: 'launched', current_phase: null, suggestion: 's', all_done: true } });
  const wrapper = join(binDir, 'openlogos');
  writeFileSync(wrapper, [
    '#!/usr/bin/env bash',
    'if [ "$1" = "status" ]; then',
    `  cat <<'JSON'\n${envelope}\nJSON`,
    '  exit 0',
    'fi',
    'exit 0',
    '',
  ].join('\n'));
  execFileSync('chmod', ['755', wrapper]);
  return binDir;
}

function runHook(hook: string, root: string, binDir: string): string {
  const out = execFileSync('bash', [hook], {
    cwd: root,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    encoding: 'utf-8',
  });
  return JSON.parse(out).hookSpecificOutput.additionalContext as string;
}

describe('S09 切片3 — 前置能力门 capability 输入闭环（F2 R6）', () => {
  it('UT-S09-103: 两源模板在 capability 就绪时一致 surface capabilities 段', () => {
    const root = launchedProject(true);
    const binDir = installWrapper(root);
    const phaseCtx = runHook(PHASE_HOOK, root, binDir);
    const codexCtx = runHook(CODEX_HOOK, root, binDir);
    expect(phaseCtx).toContain('Capabilities: ui_prototype_render=true');
    expect(codexCtx).toContain('Capabilities: ui_prototype_render=true');   // 两源一致 surface
  });

  it('UT-S09-105: 能力文件缺失 = 降级模式（两源均不注入 capabilities 段）', () => {
    const root = launchedProject(undefined);   // 无 .session-capabilities.json
    const binDir = installWrapper(root);
    expect(runHook(PHASE_HOOK, root, binDir)).not.toContain('Capabilities:');
    expect(runHook(CODEX_HOOK, root, binDir)).not.toContain('Capabilities:');
    expect(readSessionCapabilities(root)).toBeNull();
    expect(buildCapabilities(root)).toBeUndefined();
  });

  it('UT-S09-104: status/next JSON 承载 capabilities 字段（与上下文一致）', () => {
    const root = launchedProject(true);
    const data = collectStatusData(root);
    expect(data.capabilities).toEqual({ ui_prototype_render: true });
    // 命令级 JSON 输出也含该字段
    const restoreCwd = mockCwd(root); const con = captureConsole();
    status('json');
    con.restore(); restoreCwd();
    const line = con.logs.find(l => l.trim().startsWith('{'))!;
    expect(JSON.parse(line).data.capabilities).toEqual({ ui_prototype_render: true });
  });

  it('UT-S09-104b: 能力缺失时 status JSON 省略 capabilities（降级、golden 零漂移）', () => {
    const root = launchedProject(undefined);
    expect(collectStatusData(root).capabilities).toBeUndefined();
  });

  it('UT-S09-106: runlogos 写文件 → openlogos 读并 surface 闭环', () => {
    const root = launchedProject(undefined);
    // runlogos 会话建立时写文件
    writeFileSync(join(root, 'logos', '.session-capabilities.json'), JSON.stringify({ ui_prototype_render: true }));
    // openlogos 读并 surface：JSON 字段 + 会话上下文一致
    expect(buildCapabilities(root)).toEqual({ ui_prototype_render: true });
    expect(collectStatusData(root).capabilities).toEqual({ ui_prototype_render: true });
    const binDir = installWrapper(root);
    expect(runHook(PHASE_HOOK, root, binDir)).toContain('ui_prototype_render=true');
  });
});

describe('S09 切片3 — 双阶段发布状态（F2 R7，契约侧）', () => {
  it('UT-S09-112: 仅 openlogos 契约、无 runlogos → contract-ready（不 claim 已启用）', () => {
    expect(evaluateReleaseStatus({ panelDelivered: false, crossRepoSmokePassed: false })).toBe('contract-ready');
    expect(evaluateReleaseStatus({ panelDelivered: false, crossRepoSmokePassed: true })).toBe('contract-ready');
  });

  it('UT-S09-113: ui-ux-first-panel 具名依赖登记于契约（非「默认其存在」）', () => {
    expect(UI_UX_PANEL_DEPENDENCY).toBe('ui-ux-first-panel');
    // 契约文件显式登记该具名依赖 slug
    const specA = readFileSync(join(rootDir, 'spec', 'proposal-ui-ux-first.md'), 'utf-8');
    const specB = readFileSync(join(rootDir, 'spec', 'change-management.md'), 'utf-8');
    expect(specA.includes(UI_UX_PANEL_DEPENDENCY) || specB.includes(UI_UX_PANEL_DEPENDENCY)).toBe(true);
  });

  it('UT-S09-114 / ST-S09-39: 双阶段由验收机器判定、两态可区分', () => {
    // feature-enabled 当且仅当 panel 已部署 且 跨仓 smoke 全绿
    expect(evaluateReleaseStatus({ panelDelivered: true, crossRepoSmokePassed: true })).toBe('feature-enabled');
    // 任一不满足 → contract-ready（两态可由验收结果区分）
    expect(evaluateReleaseStatus({ panelDelivered: true, crossRepoSmokePassed: false })).toBe('contract-ready');
    expect(evaluateReleaseStatus({ panelDelivered: false, crossRepoSmokePassed: true })).toBe('contract-ready');
  });
});
