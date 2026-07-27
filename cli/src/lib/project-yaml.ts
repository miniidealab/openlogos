import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, parseDocument } from 'yaml';
import type { BaselineSeedState, BaselineIndexEntry } from './baseline-provenance.js';

export type YamlParseStatus = 'recovered' | 'error';
export type BootstrapMode = 'normal' | 'adopted';

export interface YamlDiagnostics {
  parse_status: YamlParseStatus;
  messages: string[];
}

export interface ProjectYamlModule {
  id: string;
  name: string;
  lifecycle?: string;
  bootstrap?: BootstrapMode;
  skip_phases?: string[];
  deployment_required?: boolean;
  smoke_required?: boolean;
  /**
   * proposal-ui-ux-first（F1）：模块级 UI 产品类型，overlay 注入与 `ui_impact` 派生的唯一数据源。
   * 枚举 `web|desktop|mobile|cli|api|library|skills|service`，GUI 集合 = {web,desktop,mobile}。
   * 字段缺失一律按非 GUI 处理（安全默认），保「非 GUI 零改动」不变量。
   */
  product_type?: string;
  /**
   * brownfield-adopter（S33）：模块级现状基线种子状态，枚举 `required|partial|seeded`（唯一状态字段，非布尔）。
   * 读取兼容历史布尔 `baseline_seed_required: true` → 映射为 `required`；`false`/缺失不推断。
   */
  baseline_seed_state?: BaselineSeedState;
}

export interface ProjectYamlScenario {
  id: string;
  /** add-feature-model（S34）：场景名称（供 feature 分组成员列表 `scenarios:[{id,name}]`；缺失回退为 id）。 */
  name?: string;
  module?: string;
  /**
   * add-feature-model（S34）：可选 feature 归属（`F0X`）。缺失 / 指向未知 feature / 跨 module 一律
   * 降级为所属 module 的"未分组"桶（不报错、不阻断）。不改动 `module` 现状语义。
   */
  feature?: string;
}

/**
 * add-feature-model（S34）：feature 功能分组注册表元素。feature 是 module 的子分组（不跨 module），
 * 由 AI 维护（比照 scenario_counter，CLI 不取号），仅读取侧解析。
 */
export interface ProjectYamlFeature {
  id: string;
  name: string;
  module: string;
  /** 可选：feature-specs 文档序号（如 `core-01`，无 `.md`/无锚点），目标缺失视为未链接。 */
  spec?: string;
}

/** add-feature-model（S34）：全局 feature 编号计数器，AI 维护（仿 scenario_counter）。 */
export interface ProjectYamlFeatureCounter {
  next_id?: number;
}

export interface ProjectYamlDeploymentGate {
  deployment_required?: boolean;
  smoke_required?: boolean;
  environments?: string[];
}

export interface ProjectYamlData {
  modules?: ProjectYamlModule[];
  scenarios?: ProjectYamlScenario[];
  /** add-feature-model（S34）：可选 feature 分组注册表。 */
  features?: ProjectYamlFeature[];
  /** add-feature-model（S34）：可选全局 feature 计数器（AI 维护）。 */
  feature_counter?: ProjectYamlFeatureCounter;
  deployment_gates?: Record<string, ProjectYamlDeploymentGate>;
  /** brownfield-adopter（S33）：provenance/覆盖率的派生索引（非权威），按 module 携 source_hash 供新鲜度对账。 */
  baseline_index?: Record<string, BaselineIndexEntry>;
}

export interface ProjectYamlReadResult {
  exists: boolean;
  data: ProjectYamlData | null;
  yaml_diagnostics: YamlDiagnostics | null;
}

type YamlNodeLike = {
  toJSON?: (...args: unknown[]) => unknown;
};

export function normalizeBootstrap(value: unknown): BootstrapMode {
  return value === 'adopted' || value === 'skipped' ? 'adopted' : 'normal';
}

export function isAdoptedBootstrap(value: unknown): boolean {
  return normalizeBootstrap(value) === 'adopted';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNodeJson(node: unknown): unknown {
  if (!node || typeof node !== 'object') return undefined;
  const toJSON = (node as YamlNodeLike).toJSON;
  if (typeof toJSON !== 'function') return undefined;
  try {
    return toJSON.call(node, null, {});
  } catch {
    return undefined;
  }
}

function collectMessages(...values: unknown[]): string[] {
  const messages = new Set<string>();
  for (const value of values) {
    const message = value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : value && typeof value === 'object' && 'message' in value
          ? String((value as { message?: unknown }).message ?? '')
          : String(value ?? '');
    const trimmed = message.trim();
    if (trimmed) messages.add(trimmed);
  }
  return Array.from(messages);
}

function normalizeModule(raw: unknown): ProjectYamlModule | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== 'string' || typeof record.name !== 'string') return null;

  const module: ProjectYamlModule = {
    id: record.id,
    name: record.name,
  };

  if (typeof record.lifecycle === 'string') {
    module.lifecycle = record.lifecycle;
  }
  if (typeof record.bootstrap === 'string') {
    module.bootstrap = normalizeBootstrap(record.bootstrap);
  }
  const skipPhases = asStringArray(record.skip_phases);
  if (skipPhases) {
    module.skip_phases = skipPhases;
  }
  const deploymentRequired = asBoolean(record.deployment_required);
  if (deploymentRequired !== undefined) {
    module.deployment_required = deploymentRequired;
  }
  const smokeRequired = asBoolean(record.smoke_required);
  if (smokeRequired !== undefined) {
    module.smoke_required = smokeRequired;
  }
  if (typeof record.product_type === 'string') {
    module.product_type = record.product_type;
  }
  const seedState = normalizeBaselineSeedState(record.baseline_seed_state, record.baseline_seed_required);
  if (seedState !== undefined) {
    module.baseline_seed_state = seedState;
  }

  return module;
}

/**
 * 读取 baseline_seed_state 枚举，兼容历史布尔 baseline_seed_required：
 * 枚举合法值优先；否则布尔 true → 'required'；false/缺失 → undefined（不推断）。
 */
export function normalizeBaselineSeedState(
  enumValue: unknown,
  legacyBoolean?: unknown,
): BaselineSeedState | undefined {
  if (enumValue === 'required' || enumValue === 'partial' || enumValue === 'seeded') {
    return enumValue;
  }
  if (legacyBoolean === true) return 'required';
  return undefined;
}

function normalizeScenario(raw: unknown): ProjectYamlScenario | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== 'string') return null;

  const scenario: ProjectYamlScenario = { id: record.id };
  if (typeof record.name === 'string') {
    scenario.name = record.name;
  }
  if (typeof record.module === 'string') {
    scenario.module = record.module;
  }
  if (typeof record.feature === 'string') {
    scenario.feature = record.feature;
  }
  return scenario;
}

/** add-feature-model（S34）：解析单个 feature 注册项。id/name/module 必需，spec 可选。 */
function normalizeFeature(raw: unknown): ProjectYamlFeature | null {
  const record = asRecord(raw);
  if (!record
    || typeof record.id !== 'string'
    || typeof record.name !== 'string'
    || typeof record.module !== 'string') {
    return null;
  }
  const feature: ProjectYamlFeature = {
    id: record.id,
    name: record.name,
    module: record.module,
  };
  if (typeof record.spec === 'string') {
    feature.spec = record.spec;
  }
  return feature;
}

/** add-feature-model（S34）：解析 feature_counter（仅 next_id: number 合法）。 */
function normalizeFeatureCounter(raw: unknown): ProjectYamlFeatureCounter | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  if (typeof record.next_id === 'number') {
    return { next_id: record.next_id };
  }
  return undefined;
}

function normalizeDeploymentGate(raw: unknown): ProjectYamlDeploymentGate | null {
  const record = asRecord(raw);
  if (!record) return null;

  const gate: ProjectYamlDeploymentGate = {};
  const deploymentRequired = asBoolean(record.deployment_required);
  if (deploymentRequired !== undefined) {
    gate.deployment_required = deploymentRequired;
  }
  const smokeRequired = asBoolean(record.smoke_required);
  if (smokeRequired !== undefined) {
    gate.smoke_required = smokeRequired;
  }
  const environments = asStringArray(record.environments);
  if (environments) {
    gate.environments = environments;
  }

  return Object.keys(gate).length > 0 ? gate : null;
}

function normalizeProjectYaml(raw: unknown): ProjectYamlData | null {
  const record = asRecord(raw);
  if (!record) return null;

  const data: ProjectYamlData = {};
  const modules = Array.isArray(record.modules)
    ? record.modules.map(normalizeModule).filter((item): item is ProjectYamlModule => item !== null)
    : undefined;
  if (modules !== undefined) {
    data.modules = modules;
  }

  const scenarios = Array.isArray(record.scenarios)
    ? record.scenarios.map(normalizeScenario).filter((item): item is ProjectYamlScenario => item !== null)
    : undefined;
  if (scenarios !== undefined) {
    data.scenarios = scenarios;
  }

  const features = Array.isArray(record.features)
    ? record.features.map(normalizeFeature).filter((item): item is ProjectYamlFeature => item !== null)
    : undefined;
  if (features !== undefined) {
    data.features = features;
  }

  const featureCounter = normalizeFeatureCounter(record.feature_counter);
  if (featureCounter !== undefined) {
    data.feature_counter = featureCounter;
  }

  const deploymentGates = asRecord(record.deployment_gates);
  if (deploymentGates) {
    const normalized: Record<string, ProjectYamlDeploymentGate> = {};
    for (const [moduleId, gate] of Object.entries(deploymentGates)) {
      const normalizedGate = normalizeDeploymentGate(gate);
      if (normalizedGate) {
        normalized[moduleId] = normalizedGate;
      }
    }
    if (Object.keys(normalized).length > 0) {
      data.deployment_gates = normalized;
    }
  }

  const baselineIndex = asRecord(record.baseline_index);
  if (baselineIndex) {
    const normalized: Record<string, BaselineIndexEntry> = {};
    for (const [moduleId, entry] of Object.entries(baselineIndex)) {
      const rec = asRecord(entry);
      if (!rec) continue;
      const indexEntry: BaselineIndexEntry = {};
      if (typeof rec.source_hash === 'string') indexEntry.source_hash = rec.source_hash;
      // drop-coverage-human-verified：不再解析 human_verified（旧值遇之忽略）。
      if (typeof rec.denominator === 'number') indexEntry.denominator = rec.denominator;
      if (typeof rec.generated_at === 'string') indexEntry.generated_at = rec.generated_at;
      if (Object.keys(indexEntry).length > 0) normalized[moduleId] = indexEntry;
    }
    if (Object.keys(normalized).length > 0) {
      data.baseline_index = normalized;
    }
  }

  return Object.keys(data).length > 0 ? data : null;
}

function recoverProjectYamlData(content: string): {
  data: ProjectYamlData | null;
  recovered_fields: string[];
  messages: string[];
  has_recovered_modules: boolean;
} {
  const doc = parseDocument(content);
  const recoveredFields: string[] = [];
  const data: ProjectYamlData = {};
  let hasRecoveredModules = false;

  const rawModules = asNodeJson(doc.get('modules', true));
  const modules = Array.isArray(rawModules)
    ? rawModules.map(normalizeModule).filter((item): item is ProjectYamlModule => item !== null)
    : undefined;
  if (modules !== undefined) {
    if (modules.length > 0) {
      data.modules = modules;
      recoveredFields.push('modules');
      hasRecoveredModules = true;
    }
  } else if (rawModules !== undefined) {
    recoveredFields.push('modules');
  }

  const rawScenarios = asNodeJson(doc.get('scenarios', true));
  const scenarios = Array.isArray(rawScenarios)
    ? rawScenarios.map(normalizeScenario).filter((item): item is ProjectYamlScenario => item !== null)
    : undefined;
  if (scenarios !== undefined) {
    data.scenarios = scenarios;
    recoveredFields.push('scenarios');
  }

  const rawDeploymentGates = asNodeJson(doc.get('deployment_gates', true));
  const deploymentGatesRecord = asRecord(rawDeploymentGates);
  if (deploymentGatesRecord) {
    const normalized: Record<string, ProjectYamlDeploymentGate> = {};
    for (const [moduleId, gate] of Object.entries(deploymentGatesRecord)) {
      const normalizedGate = normalizeDeploymentGate(gate);
      if (normalizedGate) {
        normalized[moduleId] = normalizedGate;
      }
    }
    if (Object.keys(normalized).length > 0) {
      data.deployment_gates = normalized;
      recoveredFields.push('deployment_gates');
    }
  }

  return {
    data: Object.keys(data).length > 0 ? data : null,
    recovered_fields: recoveredFields,
    has_recovered_modules: hasRecoveredModules,
    messages: collectMessages(
      'logos-project.yaml 存在可恢复的解析错误',
      ...doc.errors.map(error => error?.message ?? error),
    ),
  };
}

function buildDiagnostics(
  status: YamlParseStatus,
  messages: string[],
  recoveredFields: string[] = [],
  hasRecoveredModules: boolean = false,
): YamlDiagnostics {
  const finalMessages = [...messages];
  if (status === 'recovered' && recoveredFields.length > 0) {
    finalMessages.push(`已从 AST 恢复：${recoveredFields.join('、')}`);
  }
  if (status === 'error' && !hasRecoveredModules) {
    finalMessages.push('无法从 AST 恢复 modules');
  }
  return {
    parse_status: status,
    messages: finalMessages,
  };
}

export function readProjectYaml(root: string): ProjectYamlReadResult {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(yamlPath)) {
    return {
      exists: false,
      data: null,
      yaml_diagnostics: null,
    };
  }

  const content = readFileSync(yamlPath, 'utf-8');
  try {
    return {
      exists: true,
      data: normalizeProjectYaml(parseYaml(content)),
      yaml_diagnostics: null,
    };
  } catch (error) {
    const recovered = recoverProjectYamlData(content);
    const status: YamlParseStatus = recovered.has_recovered_modules
      ? 'recovered'
      : 'error';
    return {
      exists: true,
      data: recovered.data,
      yaml_diagnostics: buildDiagnostics(
        status,
        collectMessages(error, ...recovered.messages),
        recovered.recovered_fields,
        recovered.has_recovered_modules,
      ),
    };
  }
}
