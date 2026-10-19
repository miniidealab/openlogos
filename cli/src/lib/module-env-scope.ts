/**
 * 按模块区分环境（module-scoped-env-smoke，spec/environments.md §14.1～§14.4，决策 C01）。
 *
 * - 启用判定（§14.1）先于任何解析：只读 logos-project.yaml 与 logos.config.json，不读登记表。
 * - E(m)（§14.2）：deployment_gates.<m>.environments 逐项按 §3 解析；缺失或 [] 为「未声明」；
 *   含任一解析不了的项为「引用失效」——永不降级为未声明，也不剔除失效项。
 * - 目标模块与部署上下文（§14.3）：--env 恰好属于一个模块 → 该模块；否则取活跃提案模块；都没有 → 不限定模块。
 * 环境归属只有 deployment_gates 这一个来源，登记表格式不变。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectYaml } from './project-yaml.js';
import { resolveEnvironment } from './environments.js';
import type { EnvironmentDef } from './environments.js';
import { resolveProposalModuleContext } from './change-lint.js';
import { t } from '../i18n.js';
import type { Locale } from '../i18n.js';

export type ModuleEnvState = 'undeclared' | 'declared' | 'invalid';

export interface ModuleEnvDecl {
  module: string;
  state: ModuleEnvState;
  /** E(m)：解析成功的环境 id（声明顺序、去重）；引用失效的模块仍保留其可解析项（用于归属）。 */
  environments: string[];
  /** 无法解析的原始声明项（state=invalid 时非空）。 */
  invalid_references: string[];
}

export interface ModuleEnvMap {
  /** logos-project.yaml 模块顺序。 */
  modules: string[];
  decls: Map<string, ModuleEnvDecl>;
}

/** smoke.modules 是否配置了任一项（§14.1 第 2 条；未登记 id 也计入，由 smoke 另报 smoke_module_unknown）。 */
function smokeModulesConfigured(root: string): boolean {
  const file = join(root, 'logos', 'logos.config.json');
  if (!existsSync(file)) return false;
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf-8')) as { smoke?: { modules?: unknown } };
    const modules = cfg.smoke?.modules;
    return typeof modules === 'object' && modules !== null && !Array.isArray(modules) && Object.keys(modules).length > 0;
  } catch {
    return false;
  }
}

/**
 * 启用判定（§14.1），按顺序取第一条成立的：① 只登记了一个模块 → 未启用；② 没有任何模块声明非空 environments
 * 且没有 smoke.modules → 未启用；③ 其余启用。不读取登记表。
 */
export function isModuleScopeEnabled(root: string): boolean {
  const data = readProjectYaml(root).data;
  const modules = data?.modules ?? [];
  if (modules.length <= 1) return false;
  const gates = data?.deployment_gates ?? {};
  if (modules.some(m => (gates[m.id]?.environments?.length ?? 0) > 0)) return true;
  return smokeModulesConfigured(root);
}

/**
 * 解析各模块的 E(m)（§14.2）。environments 为 null 表示登记表不存在：全部模块视为未声明、不做引用校验。
 */
export function resolveModuleEnvironments(root: string, environments: EnvironmentDef[] | null): ModuleEnvMap {
  const data = readProjectYaml(root).data;
  const modules = (data?.modules ?? []).map(m => m.id);
  const gates = data?.deployment_gates ?? {};
  const decls = new Map<string, ModuleEnvDecl>();
  for (const id of modules) {
    const raw = environments === null ? [] : (gates[id]?.environments ?? []);
    const resolved: string[] = [];
    const invalid: string[] = [];
    for (const value of raw) {
      const r = resolveEnvironment(environments ?? [], value);
      if (r.ok) {
        if (!resolved.includes(r.id)) resolved.push(r.id);
      } else {
        invalid.push(value);
      }
    }
    const state: ModuleEnvState = raw.length === 0 ? 'undeclared' : invalid.length > 0 ? 'invalid' : 'declared';
    decls.set(id, { module: id, state, environments: resolved, invalid_references: invalid });
  }
  return { modules, decls };
}

/** 声明了该环境的模块 id（按 logos-project.yaml 模块顺序；env list / show 的 modules 字段）。 */
export function modulesOwning(map: ModuleEnvMap, envId: string): string[] {
  return map.modules.filter(m => map.decls.get(m)!.environments.includes(envId));
}

export type TargetModule =
  | { mode: 'module'; module: string; reasons: Array<'env' | 'proposal'>; context: 'proposal' | 'version' }
  | { mode: 'project'; module: null; fallback: 'no_env_no_proposal' | 'env_unattributed' | 'env_shared'; context: 'proposal' | 'version' };

/**
 * 目标模块与部署上下文（§14.3）。envId 为已解析的登记环境 id（未传 --env 或无法解析时为 null）；
 * proposalModule 为活跃提案所属模块（无活跃提案时为 null）。
 */
export function resolveTargetModule(map: ModuleEnvMap, envId: string | null, proposalModule: string | null): TargetModule {
  const owners = envId === null ? [] : modulesOwning(map, envId);
  if (owners.length === 1) {
    const module = owners[0];
    return {
      mode: 'module', module,
      reasons: module === proposalModule ? ['env', 'proposal'] : ['env'],
      context: module === proposalModule ? 'proposal' : 'version',
    };
  }
  if (proposalModule !== null) return { mode: 'module', module: proposalModule, reasons: ['proposal'], context: 'proposal' };
  const fallback = envId === null ? 'no_env_no_proposal' : owners.length === 0 ? 'env_unattributed' : 'env_shared';
  return { mode: 'project', module: null, fallback, context: 'version' };
}

/**
 * 活跃提案所属模块：proposal.md 头 → guard module（resolveProposalModuleContext）；解析不了时回退 guard 记录的模块。
 */
export function activeProposalModule(root: string, slug: string, proposalDir: string, guardModule: string | null): string | null {
  const r = resolveProposalModuleContext(root, proposalDir, slug);
  return r.ok ? r.moduleId : guardModule;
}

/** ENV_GATE_REFERENCE_UNKNOWN / ENV_MODULE_MISMATCH 的 error.details（spec/cli-json-output.md「smoke / deploy-done / deploy 新增错误码」）。 */
export function gateReferenceDetails(decl: ModuleEnvDecl): { module: string; invalid_references: string[] } {
  return { module: decl.module, invalid_references: decl.invalid_references };
}

export function moduleMismatchDetails(decl: ModuleEnvDecl, environment: string): {
  module: string; environment: string; module_environments: string[];
} {
  return { module: decl.module, environment, module_environments: decl.environments };
}

export function gateReferenceMessage(locale: Locale, decl: ModuleEnvDecl): string {
  return t(locale, 'envScope.error.gateReferenceUnknown', { module: decl.module, references: decl.invalid_references.join(', ') });
}

export function moduleMismatchMessage(locale: Locale, decl: ModuleEnvDecl, environment: string): string {
  return t(locale, 'envScope.error.moduleMismatch', {
    environment, module: decl.module,
    environments: decl.environments.length > 0 ? decl.environments.join(', ') : t(locale, 'envScope.word.none'),
  });
}
