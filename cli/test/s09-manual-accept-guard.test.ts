/**
 * S09 人工验收记录命令受限与开关字段保护（smoke-manual-acceptance，切片 slice-04-human-only-guard-and-release）。
 *
 * 覆盖 UT-S09-493～UT-S09-503，对应场景 S09「S09 人工验收记录命令受限与开关字段保护」与 EX-9M.1～EX-9M.5，功能规格 §2.107.10。
 * guard 判定以真实 plugin/bin/guard-check 与构造的 PreToolUse 输入执行；Cursor、qoder、workbuddy、zcode 以分发源 runtime 的函数层调用判定。
 * 用例只调用 guard 入口与适配层，不执行真实 openlogos accept。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(HERE, '../../plugin/bin/guard-check');
const require = createRequire(import.meta.url);
const cursor = require(resolve(HERE, '../../plugin-cursor/hooks/runtime.cjs')) as {
  decideShell(root: string, command: string, platform?: string, opts?: Record<string, unknown>): { decision: string; reason?: string; userMessage?: string };
};
type Decide = { decideGuard(root: string, event: Record<string, unknown>): { decision: string; reason: string } };
const hosts: Record<string, Decide> = {
  qoder: require(resolve(HERE, '../../plugin-qoder/hooks/runtime.cjs')),
  workbuddy: require(resolve(HERE, '../../plugin-workbuddy/hooks/runtime.cjs')),
  zcode: require(resolve(HERE, '../../plugin-zcode/runtime/hook-runtime.js')),
};
const LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const REG = 'logos/environments.yaml';
const ACCEPT = 'openlogos accept --env prod --deploy d1 --case ST-S01-05 --result pass';
const TIMEOUT = 60_000;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('OPENLOGOS_') || k === 'CLAUDE_PROJECT_DIR') delete env[k];
  return { ...env, ...extra };
}

/** launched 项目（git 仓库，可带活跃提案）；registry 为登记表内容（null 不写）。 */
function project(opts: { lifecycle?: 'launched' | 'initial'; proposal?: boolean; registry?: string | null; exemptRegistry?: boolean } = {}): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos/logos-project.yaml'), `project:\n  name: g\nmodules:\n  - id: core\n    name: Core\n    lifecycle: ${opts.lifecycle ?? 'launched'}\n`);
  if (opts.registry !== null && opts.registry !== undefined) writeFileSync(join(root, REG), opts.registry);
  if (opts.exemptRegistry) {
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    cfg.guard = { ...(cfg.guard ?? {}), exempt: [REG] };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  }
  if (opts.proposal) {
    mkdirSync(join(root, 'logos/changes/ship-it'), { recursive: true });
    writeFileSync(join(root, 'logos/changes/ship-it/proposal.md'), '# 变更提案：ship-it\n');
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'ship-it', module: 'core' }));
  }
  const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  git(['init', '-q']); git(['config', 'user.name', 't']); git(['config', 'user.email', 't@example.invalid']);
  git(['add', '-A']); git(['commit', '-qm', 'init']);
  return root;
}

function preToolUse(root: string, tool: string, toolInput: Record<string, unknown>, mode?: string) {
  const input: Record<string, unknown> = { session_id: 's09-ma', transcript_path: join(root, 't.jsonl'), cwd: root, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, tool_use_id: 'toolu_ma' };
  if (mode !== undefined) input.permission_mode = mode;
  const r = spawnSync('bash', [GUARD], { input: JSON.stringify(input), cwd: root, encoding: 'utf-8', timeout: 30_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root }) });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const bash = (root: string, command: string, mode?: string) => preToolUse(root, 'Bash', { command }, mode);

function expectAsk(r: ReturnType<typeof bash>, cmd: string, needle: string): void {
  expect(r.exitCode, cmd).toBe(0);
  const out = JSON.parse(r.stdout.trim());
  expect(out.hookSpecificOutput.permissionDecision).toBe('ask');
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain(cmd);
  expect(out.hookSpecificOutput.permissionDecisionReason).toContain(needle);
}

const MA_REGISTRY = 'schema_version: 1\nenvironments:\n  - id: prod\n    name: Production\n    tier: prod\n    manual_acceptance: {enabled: true}\n';
const PLAIN_REGISTRY = 'schema_version: 1\nenvironments:\n  - id: prod\n    name: Production\n    tier: prod\n';

describe('S09 openlogos accept 受限命令（smoke-manual-acceptance）', () => {
  it('UT-S09-493: 独立形态交宿主审批', () => {
    const root = project({ proposal: true });
    for (const mode of ['default', 'acceptEdits']) {
      for (const cmd of [ACCEPT, `cd ${root} && ${ACCEPT}`]) {
        expectAsk(bash(root, cmd, mode), cmd, '该命令会记录人工验收结果');
      }
    }
  }, TIMEOUT);

  it('UT-S09-494: 其他权限模式阻断', () => {
    const root = project({ proposal: true });
    for (const mode of ['bypassPermissions', 'dontAsk', 'auto', 'plan', undefined, 'weird-mode']) {
      const r = bash(root, ACCEPT, mode);
      expect(r.exitCode, String(mode)).toBe(2);
      expect(r.stdout).not.toContain('permissionDecision');
      expect(r.stderr).toContain(`! ${ACCEPT}`);
      expect(r.stderr).toContain('RunLogos');
      expect(r.stderr).toContain('不要由 AI 代记');
    }
  }, TIMEOUT);

  it('UT-S09-495: --help 与任何参数形态都受限', () => {
    const root = project();
    for (const cmd of ['openlogos accept --help', 'openlogos accept']) {
      expectAsk(bash(root, cmd, 'default'), cmd, '该命令会记录人工验收结果');
      expect(bash(root, cmd, 'bypassPermissions').exitCode, cmd).toBe(2);
    }
  }, TIMEOUT);

  it('UT-S09-496: 复合与内嵌形态阻断', () => {
    const root = project();
    for (const cmd of [`openlogos smoke --env prod && ${ACCEPT}`, `bash -c "${ACCEPT}"`, `eval '${ACCEPT}'`, `echo y | ${ACCEPT}`]) {
      const r = bash(root, cmd, 'default');
      expect(r.exitCode, cmd).toBe(2);
      expect(r.stdout, cmd).not.toContain('permissionDecision');
      expect(r.stderr, cmd).toContain('请拆成单独的调用后重试');
    }
  }, TIMEOUT);

  it('UT-S09-497: 写了 manual_acceptance 的登记表受保护', () => {
    const root = project({ proposal: true, registry: MA_REGISTRY, exemptRegistry: true });
    const edit = { file_path: join(root, REG), old_string: 'enabled: true', new_string: 'enabled: false' };
    const asked = preToolUse(root, 'Edit', edit, 'default');
    expect(asked.exitCode).toBe(0);
    expect(JSON.parse(asked.stdout.trim()).hookSpecificOutput.permissionDecisionReason).toContain('该修改会改变部署门禁配置');
    expect(preToolUse(root, 'Edit', edit, 'bypassPermissions').exitCode).toBe(2);
    const sed = bash(root, `sed -i '' 's/enabled: true/enabled: false/' ${REG}`, 'default');
    expect(sed.exitCode).toBe(2);
    expect(sed.stderr).toContain('manual_acceptance');
  }, TIMEOUT);

  it('UT-S09-498: 未写门禁字段的登记表保持豁免', () => {
    const root = project({ proposal: true, registry: PLAIN_REGISTRY, exemptRegistry: true });
    const r = preToolUse(root, 'Edit', { file_path: join(root, REG), old_string: 'tier: prod', new_string: 'tier: staging' }, 'bypassPermissions');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('permissionDecision');
  }, TIMEOUT);

  it('UT-S09-499: Cursor 适配层同口径', () => {
    const root = project({ registry: MA_REGISTRY });
    const ask = cursor.decideShell(root, ACCEPT, 'darwin');
    expect(['ask', 'deny']).toContain(ask.decision);
    if (ask.decision === 'ask') expect(ask.userMessage).toContain('人工验收结果');
    expect(cursor.decideShell(root, ACCEPT, 'darwin', { askPolicy: 'deny' }).decision).toBe('deny');
    expect(cursor.decideShell(root, `${ACCEPT} && ls`, 'darwin').decision).toBe('deny');
    expect(cursor.decideShell(root, `rm ${REG}`, 'darwin').decision).toBe('deny');
  }, TIMEOUT);

  it('UT-S09-500: 非受限的相邻命令不受影响', () => {
    const root = project({ proposal: true });
    for (const cmd of ['openlogos smoke --env prod', 'openlogos env show prod', 'openlogos next']) {
      const r = bash(root, cmd, 'default');
      expect(r.stdout, cmd).not.toContain('permissionDecision');
      expect(r.stderr, cmd).not.toContain('人工验收');
    }
  }, TIMEOUT);

  for (const [id, host] of [['UT-S09-501', 'qoder'], ['UT-S09-502', 'workbuddy'], ['UT-S09-503', 'zcode']] as const) {
    it(`${id}: ${host} 适配层在 initial 生命周期拒绝 accept`, () => {
      for (const lifecycle of ['initial', 'launched'] as const) {
        const root = project({ lifecycle, registry: MA_REGISTRY });
        const tools = host === 'workbuddy' ? ['Bash', 'execute_command'] : ['Bash'];
        for (const toolName of tools) {
          for (const command of [ACCEPT, `openlogos smoke --env prod && ${ACCEPT}`, `bash -c "${ACCEPT}"`]) {
            const input = toolName === 'execute_command' ? { cmd: command } : { command };
            const d = hosts[host].decideGuard(root, { hookEventName: 'PreToolUse', toolName, toolInput: input, cwd: root });
            expect(d.decision, `${host} ${lifecycle} ${toolName} ${command}`).toBe('deny');
            expect(d.reason).toContain('人工验收结果只能由人记录');
            expect(d.reason).not.toContain('initial 生命周期不启用变更硬门禁');
          }
        }
        expect(existsSync(join(root, LEDGER))).toBe(false);
      }
    }, TIMEOUT);
  }
});
