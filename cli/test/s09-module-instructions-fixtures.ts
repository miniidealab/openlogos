/**
 * module-lifecycle-guard 切片 2 共用夹具：持久化指令文本矩阵、SessionStart 注入与 init + sync 托管段。
 *
 * 口径见 logos/resources/test/core-S09-test-cases.md「S09 guard 按模块生命周期判定测试」UT-S09-478～480、ST-S09-206～209。
 * 本模块不得 import vitest，供零回归基准生成器（fixtures/gen-s09-module-instructions-baseline.ts）复用。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, cleanEnv } from './s09-guard-vcs-fixtures.js';
import { buildMlgProject, projectYaml, withProposal, type MlgKind, type MlgState } from './s09-module-lifecycle-fixtures.js';

export const MLI_BASELINE_FILE = join(REPO_ROOT, 'cli', 'test', 'fixtures', 's09-module-instructions-baseline.json');
export const PHASE_HOOK = join(REPO_ROOT, 'plugin', 'bin', 'openlogos-phase');
export const CODEX_HOOK = join(REPO_ROOT, 'plugin-codex', 'session-start.sh');

export const AI_TOOLS = [undefined, 'claude-code', 'codex', 'opencode', 'cursor', 'zcode', 'qoder', 'workbuddy'] as const;
export const TARGETS = ['agents', 'claude'] as const;
export const LOCALES = ['zh', 'en'] as const;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface InstructionFns {
  createAgentsMd: (...a: any[]) => string;
  generatePolicyMdc: (...a: any[]) => string;
  createZCodeAgentsInstruction: (...a: any[]) => string;
  createQoderAgentsInstruction: (...a: any[]) => string;
  createWorkBuddyAgentsInstruction: (...a: any[]) => string;
  createCursorAgentsInstruction: (...a: any[]) => string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * 布尔入参（修改前的唯一形态）下的全部指令文本：AGENTS.md / CLAUDE.md 托管内容、Cursor policy 与四宿主指令段。
 * 键：agents|<aiTool>|<target>|<locale>|<launched>、policy|<locale>|<launched>、host|<name>|<locale>|<lifecycle>。
 */
export function instructionTextMatrix(fns: InstructionFns): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tool of AI_TOOLS) {
    for (const target of TARGETS) {
      for (const locale of LOCALES) {
        for (const launched of [false, true]) {
          out[`agents|${tool ?? 'none'}|${target}|${locale}|${launched}`] = fns.createAgentsMd(locale, tool, target, launched);
        }
      }
    }
  }
  for (const locale of LOCALES) {
    for (const launched of [false, true]) out[`policy|${locale}|${launched}`] = fns.generatePolicyMdc(locale, launched);
    for (const lc of ['initial', 'launched']) {
      out[`host|zcode|${locale}|${lc}`] = fns.createZCodeAgentsInstruction(locale, lc);
      out[`host|qoder|${locale}|${lc}`] = fns.createQoderAgentsInstruction(locale, lc);
      out[`host|workbuddy|${locale}|${lc}`] = fns.createWorkBuddyAgentsInstruction(locale, lc);
      out[`host|cursor|${locale}|${lc}`] = fns.createCursorAgentsInstruction(locale, lc);
    }
  }
  return out;
}

function normalize(text: string, root: string): string {
  let out = text;
  for (const r of [realpathSync(root), root]) out = out.split(r).join('<ROOT>');
  return out;
}

/** 让 `openlogos status` 失败的包装（SessionStart 回落到脚本自行派生，结果确定）。 */
function failingOpenlogos(dir: string): string {
  const bin = join(dir, 'bin-openlogos');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'openlogos'), '#!/usr/bin/env bash\nexit 42\n');
  chmodSync(join(bin, 'openlogos'), 0o755);
  return bin;
}

/** 在夹具项目上运行 SessionStart 脚本，返回 additionalContext（项目根替换为 <ROOT>）。 */
export function runSessionStart(script: 'phase' | 'codex', root: string, hook = script === 'phase' ? PHASE_HOOK : CODEX_HOOK): string {
  const bin = failingOpenlogos(mkdtempSync(join(tmpdir(), 'openlogos-mli-bin-')));
  const r = spawnSync('bash', [hook], {
    cwd: root, encoding: 'utf-8', timeout: 60_000, input: '{}',
    env: cleanEnv({ PATH: `${bin}:${process.env.PATH ?? ''}`, CLAUDE_PROJECT_DIR: root }),
  });
  rmSync(join(bin, '..'), { recursive: true, force: true });
  const parsed = JSON.parse(r.stdout || '{}') as { hookSpecificOutput?: { additionalContext?: string } };
  return normalize(parsed.hookSpecificOutput?.additionalContext ?? '', root);
}

export const SESSION_COMBOS: Array<{ kind: MlgKind; state: MlgState }> = [
  { kind: 'A-initial', state: 'none' },
  { kind: 'A-launched', state: 'none' },
  { kind: 'A-launched', state: 'delta-writing' },
];

export function sessionMatrix(hooks: { phase?: string; codex?: string } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { kind, state } of SESSION_COMBOS) {
    for (const script of ['phase', 'codex'] as const) {
      const root = mkdtempSync(join(tmpdir(), 'openlogos-mli-s-'));
      try {
        withProposal(buildMlgProject(root, kind), state);
        out[`session|${script}|${kind}|${state}`] = runSessionStart(script, root, hooks[script]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
  return out;
}

/** 托管段（OPENLOGOS:BEGIN 与 OPENLOGOS:END 之间的内容）。 */
export function managedBlock(file: string): string {
  const text = readFileSync(file, 'utf-8');
  const s = text.indexOf('<!-- OPENLOGOS:BEGIN -->');
  const e = text.indexOf('<!-- OPENLOGOS:END -->');
  if (s < 0 || e < 0) throw new Error(`缺少托管片段 marker：${file}`);
  return text.slice(s, e);
}

/**
 * 在 root 上（cwd 已指向 root）执行 init（claude-code）后写入夹具 yaml，再执行 sync，返回 AGENTS.md / CLAUDE.md 托管段。
 * commands 由调用方注入（生成器与测试各自导入同一份 src 实现）。
 */
export async function initThenSync(
  root: string, kind: MlgKind, commands: { init: (n: string, o: { locale: string; aiTool: string }) => Promise<void>; sync: () => void },
  aiTool = 'claude-code',
): Promise<{ agents: string; claude: string }> {
  const original = process.cwd;
  process.cwd = () => root;
  try {
    await commands.init('demo', { locale: 'zh', aiTool });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), projectYaml(kind));
    commands.sync();
  } finally {
    process.cwd = original;
  }
  return { agents: managedBlock(join(root, 'AGENTS.md')), claude: managedBlock(join(root, 'CLAUDE.md')) };
}
