/**
 * verify 环境要求：声明、结构校验、生效集合、验收标准对账与预检（verify-self-sufficient-cases，功能规格 §2.106.4～§2.106.5，
 * spec/test-results.md「verify 环境要求声明、对账与预检」）。
 *
 * 执行顺序固定：结构校验 → 验收标准对账 → 环境预检；任一步失败即停止，verify 不执行任何预跑命令、不截断也不读取结果文件。
 */
import { accessSync, constants as fsConstants, existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OutputFormat } from './json-output.js';
import { runSandboxedCommand, type NormalizedSandboxConfig, type SandboxData } from './sandbox.js';
import { parseAcceptanceCriteria, ACCEPTANCE_ENTRY_NAME_RE, type AcceptanceEntry } from './acceptance-criteria.js';

export interface VerifyRequirementCheck { name: string; command: string }
export interface VerifyRequirements { env: string[]; commands: string[]; checks: VerifyRequirementCheck[] }

/** 生效集合中的一条 check：同名同命令合并后的归属模块（未启用模块范围时为空数组）。 */
export interface EffectiveCheck extends VerifyRequirementCheck { modules: string[] }
export interface EffectiveRequirements { env: string[]; commands: string[]; checks: EffectiveCheck[] }

export type RequirementKind = 'env' | 'command' | 'check';
export interface MissingRequirement {
  kind: RequirementKind;
  name: string;
  /** check 的退出码 / 「超时」 / 沙箱隔离失败说明；env 与 command 不写值。 */
  detail?: string;
  modules?: string[];
}

export type PrecheckReason = 'verify_requirements_invalid' | 'acceptance_requirement_undeclared' | 'verify_env_not_ready';

/** JSON `data.requirements`（§2.106.5）。 */
export interface VerifyRequirementsData {
  declared: { env: string[]; commands: string[]; checks: Array<{ name: string; modules?: string[] }> };
  acceptance_entries: string[];
  missing_declarations: string[];
  missing_environment: MissingRequirement[];
  /** 本次检查命令是否在沙箱中隔离执行；没有执行任何检查时省略。 */
  isolation?: 'sandboxed' | 'unisolated';
  /** 结构非法时的逐项说明。 */
  invalid?: string[];
}

export interface PrecheckOutcome {
  ok: boolean;
  reason: PrecheckReason | null;
  data: VerifyRequirementsData | null;
  /** 检查命令沙箱执行的状态（隔离失败等），用于合入 verify 的 sandbox 字段。 */
  sandbox: SandboxData | null;
}

const NAME_RE = ACCEPTANCE_ENTRY_NAME_RE;
/** 检查命令时限（§2.106.4：60 秒）；测试接缝 OPENLOGOS_VERIFY_CHECK_TIMEOUT_MS 可缩短。 */
export const DEFAULT_CHECK_TIMEOUT_MS = 60_000;
/** 检查命令超时的约定退出码（同 GNU timeout）。 */
export const CHECK_TIMEOUT_EXIT_CODE = 124;

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** 结构校验：类型、名称规则、check 名称唯一。`where` 用于诊断定位。 */
export function parseRequirements(raw: unknown, where: string): { value: VerifyRequirements; errors: string[] } {
  const value: VerifyRequirements = { env: [], commands: [], checks: [] };
  const errors: string[] = [];
  if (raw === undefined) return { value, errors };
  if (!isRecord(raw)) return { value, errors: [`${where} 必须是对象`] };
  const strList = (key: 'env' | 'commands') => {
    const v = raw[key];
    if (v === undefined) return;
    if (!Array.isArray(v) || !v.every(x => typeof x === 'string' && x.trim() !== '')) {
      errors.push(`${where}.${key} 必须是非空字符串数组`);
      return;
    }
    for (const x of v as string[]) {
      if (key === 'commands' && /[\s/\\]/.test(x)) errors.push(`${where}.commands 中的「${x}」必须是命令名（不含路径与参数）`);
      else if (!value[key].includes(x)) value[key].push(x);
    }
  };
  strList('env');
  strList('commands');
  const checks = raw.checks;
  if (checks !== undefined) {
    if (!Array.isArray(checks)) {
      errors.push(`${where}.checks 必须是数组`);
    } else {
      const seen = new Set<string>();
      checks.forEach((c, i) => {
        if (!isRecord(c) || typeof c.name !== 'string' || typeof c.command !== 'string' || c.command.trim() === '') {
          errors.push(`${where}.checks[${i}] 必须含字符串 name 与非空 command`);
          return;
        }
        if (!NAME_RE.test(c.name)) { errors.push(`${where}.checks[${i}].name「${c.name}」不合法（须匹配 ^[A-Za-z0-9][A-Za-z0-9._-]*$）`); return; }
        if (seen.has(c.name)) { errors.push(`${where}.checks 中 name「${c.name}」重复`); return; }
        seen.add(c.name);
        value.checks.push({ name: c.name, command: c.command });
      });
    }
  }
  return { value, errors };
}

/** 读取 `logos.config.json` 的 verify 原始对象（不经 normalize，保留 requirements 原值）。 */
export function readRawVerifyConfig(root: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf8')) as unknown;
    return isRecord(parsed) && isRecord(parsed.verify) ? parsed.verify : {};
  } catch {
    return {};
  }
}

export interface DeclaredRequirements {
  project: VerifyRequirements;
  modules: Record<string, VerifyRequirements>;
  errors: string[];
  /** 是否声明了任何要求（项目级或模块级任一字段非空）。 */
  any: boolean;
}

export function readDeclaredRequirements(rawVerify: Record<string, unknown>): DeclaredRequirements {
  const project = parseRequirements(rawVerify.requirements, 'verify.requirements');
  const errors = [...project.errors];
  const modules: Record<string, VerifyRequirements> = {};
  if (isRecord(rawVerify.modules)) {
    for (const [id, m] of Object.entries(rawVerify.modules)) {
      if (!isRecord(m) || m.requirements === undefined) continue;
      const parsed = parseRequirements(m.requirements, `verify.modules.${id}.requirements`);
      errors.push(...parsed.errors);
      modules[id] = parsed.value;
    }
  }
  const nonEmpty = (r: VerifyRequirements) => r.env.length + r.commands.length + r.checks.length > 0;
  return { project: project.value, modules, errors, any: nonEmpty(project.value) || Object.values(modules).some(nonEmpty) };
}

/**
 * 生效集合（§2.106.4 生效集合第 1～4 条）：
 * - `servedModules === null`：未启用模块范围，生效集合即项目级要求；
 * - 否则只对实际执行的命令组服务的模块求 E(m)（项目级 + 模块级，模块级同名 check 只替换本模块），再合并：
 *   env / commands 取并集；名称与命令都相同的 check 合并、归属模块取并集；名称相同命令不同的分别保留。
 * - `servedModules` 为空数组（启用了模块范围但本次没有任何预跑命令）：模块级要求不检查，只取项目级。
 */
export function computeEffectiveRequirements(declared: DeclaredRequirements, servedModules: string[] | null): EffectiveRequirements {
  if (servedModules === null || servedModules.length === 0) {
    return {
      env: [...declared.project.env],
      commands: [...declared.project.commands],
      checks: declared.project.checks.map(c => ({ ...c, modules: [] })),
    };
  }
  const env: string[] = [];
  const commands: string[] = [];
  const checks: EffectiveCheck[] = [];
  const add = (list: string[], v: string) => { if (!list.includes(v)) list.push(v); };
  for (const m of servedModules) {
    const own = declared.modules[m] ?? { env: [], commands: [], checks: [] };
    for (const v of [...declared.project.env, ...own.env]) add(env, v);
    for (const v of [...declared.project.commands, ...own.commands]) add(commands, v);
    const ownNames = new Set(own.checks.map(c => c.name));
    const em = [...declared.project.checks.filter(c => !ownNames.has(c.name)), ...own.checks];
    for (const c of em) {
      const same = checks.find(x => x.name === c.name && x.command === c.command);
      if (same) { if (!same.modules.includes(m)) same.modules.push(m); } else checks.push({ ...c, modules: [m] });
    }
  }
  return { env, commands, checks };
}

/** 活跃提案「验收标准」中的环境要求条目（与 change-lint 同一解析，§2.106.8）。无活跃提案 / 无段 / 旧式段 / 「无」时为空。 */
export function readAcceptanceEntries(root: string): AcceptanceEntry[] {
  try {
    const guard = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8')) as { activeChange?: unknown };
    if (typeof guard.activeChange !== 'string' || !guard.activeChange) return [];
    const proposal = join(root, 'logos', 'changes', guard.activeChange, 'proposal.md');
    if (!existsSync(proposal)) return [];
    const parsed = parseAcceptanceCriteria(readFileSync(proposal, 'utf8'));
    return parsed.structured ? parsed.entries : [];
  } catch {
    return [];
  }
}

/** 对账（§2.106.5 第 2 步）：返回未写入生效集合的条目原文。 */
export function reconcileAcceptanceEntries(entries: AcceptanceEntry[], effective: EffectiveRequirements): string[] {
  return entries.filter(e => {
    if (e.kind === 'env') return !effective.env.includes(e.name);
    if (e.kind === 'command') return !effective.commands.includes(e.name);
    return !effective.checks.some(c => c.name === e.name);
  }).map(e => e.raw);
}

/** 命令能否在 PATH 上解析到可执行文件（不执行它）。 */
export function commandOnPath(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== 'win32') accessSync(candidate, fsConstants.X_OK);
        return true;
      } catch { /* 继续下一个候选 */ }
    }
  }
  return false;
}

function checkTimeoutMs(): number {
  const v = Number(process.env.OPENLOGOS_VERIFY_CHECK_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_CHECK_TIMEOUT_MS;
}

/** 检查命令外包一层限时执行器：独立进程组运行、超时终止整组并以 124 退出（不改写检查命令的退出码）。 */
export function checkRunnerPath(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const sibling = resolve(here, 'verify-check-runner.js');
  // 安装态与构建产物：与本模块同目录；以 TS 源码直接运行（测试）时回落到构建产物 dist/lib/
  return existsSync(sibling) ? sibling : resolve(here, '../../dist/lib/verify-check-runner.js');
}

function shellQuote(s: string): string {
  return process.platform === 'win32' ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface PrecheckInput {
  root: string;
  format: OutputFormat;
  sandbox: NormalizedSandboxConfig;
  rawVerify: Record<string, unknown>;
  /** null：未启用模块范围；数组：实际执行的命令组服务的模块（可为空）。 */
  servedModules: string[] | null;
}

/** 依次执行结构校验 → 对账 → 预检（§2.106.5）。未声明任何要求且无对账条目时返回 data=null（零变化）。 */
export function runVerifyPrecheck(input: PrecheckInput): PrecheckOutcome {
  const declared = readDeclaredRequirements(input.rawVerify);
  const entries = readAcceptanceEntries(input.root);
  if (declared.errors.length > 0) {
    return {
      ok: false,
      reason: 'verify_requirements_invalid',
      data: { declared: { env: [], commands: [], checks: [] }, acceptance_entries: entries.map(e => e.raw), missing_declarations: [], missing_environment: [], invalid: declared.errors },
      sandbox: null,
    };
  }
  if (!declared.any && entries.length === 0) return { ok: true, reason: null, data: null, sandbox: null };

  const effective = computeEffectiveRequirements(declared, input.servedModules);
  const data: VerifyRequirementsData = {
    declared: {
      env: effective.env,
      commands: effective.commands,
      checks: effective.checks.map(c => (c.modules.length > 0 ? { name: c.name, modules: [...c.modules] } : { name: c.name })),
    },
    acceptance_entries: entries.map(e => e.raw),
    missing_declarations: [],
    missing_environment: [],
  };
  data.missing_declarations = reconcileAcceptanceEntries(entries, effective);
  if (data.missing_declarations.length > 0) return { ok: false, reason: 'acceptance_requirement_undeclared', data, sandbox: null };

  for (const name of effective.env) {
    const v = process.env[name];
    if (v === undefined || v === '') data.missing_environment.push({ kind: 'env', name });
  }
  for (const name of effective.commands) {
    if (!commandOnPath(name)) data.missing_environment.push({ kind: 'command', name });
  }
  let sandbox: SandboxData | null = null;
  let anyIsolated = false;
  let anyUnisolated = false;
  for (const check of effective.checks) {
    const wrapped = `${shellQuote(process.execPath)} ${shellQuote(checkRunnerPath())} ${checkTimeoutMs()} ${shellQuote(check.command)}`;
    const run = runSandboxedCommand({
      root: input.root,
      command: wrapped,
      // 检查命令的输出不进入诊断与报告：一律按 json 格式截获，不透传到终端
      format: 'json',
      sandbox: input.sandbox,
      allowedWritePaths: [],
      ...(check.modules.length > 0 ? { extraEnv: { OPENLOGOS_VERIFY_MODULES: check.modules.join(',') } } : {}),
    });
    sandbox = run.sandbox;
    const modules = check.modules.length > 0 ? { modules: [...check.modules] } : {};
    if (run.sandbox.status === 'fail' && !run.sandbox.isolated) {
      // always 模式下无法隔离：按既有沙箱规则判失败，检查命令未执行
      data.missing_environment.push({ kind: 'check', name: check.name, detail: 'sandbox-isolation-failed', ...modules });
      continue;
    }
    if (run.sandbox.isolated) anyIsolated = true; else anyUnisolated = true;
    if (run.command.status !== 'pass') {
      const detail = run.command.exit_code === CHECK_TIMEOUT_EXIT_CODE ? 'timeout' : `exit ${run.command.exit_code ?? 'unknown'}`;
      data.missing_environment.push({ kind: 'check', name: check.name, detail, ...modules });
    }
  }
  if (anyIsolated || anyUnisolated) data.isolation = anyUnisolated ? 'unisolated' : 'sandboxed';
  if (data.missing_environment.length > 0) return { ok: false, reason: 'verify_env_not_ready', data, sandbox };
  return { ok: true, reason: null, data, sandbox };
}

/** 人读 / 报告用的缺失项描述（只写名称，不写变量值）。 */
export function describeMissing(m: MissingRequirement): string {
  const owner = m.modules && m.modules.length > 0 ? `（模块 ${m.modules.join(', ')}）` : '';
  const detail = m.detail === 'timeout' ? '超时' : m.detail === 'sandbox-isolation-failed' ? '沙箱无法隔离，未执行' : m.detail;
  return `${m.kind} ${m.name}${detail ? `：${detail}` : ''}${owner}`;
}
