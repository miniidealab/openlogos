import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, parseDocument } from 'yaml';

export type YamlParseStatus = 'recovered' | 'error';

export interface YamlDiagnostics {
  parse_status: YamlParseStatus;
  messages: string[];
}

export interface ProjectYamlModule {
  id: string;
  name: string;
  lifecycle?: string;
  bootstrap?: string;
  skip_phases?: string[];
  deployment_required?: boolean;
  smoke_required?: boolean;
}

export interface ProjectYamlScenario {
  id: string;
  module?: string;
}

export interface ProjectYamlDeploymentGate {
  deployment_required?: boolean;
  smoke_required?: boolean;
  environments?: string[];
}

export interface ProjectYamlData {
  modules?: ProjectYamlModule[];
  scenarios?: ProjectYamlScenario[];
  deployment_gates?: Record<string, ProjectYamlDeploymentGate>;
}

export interface ProjectYamlReadResult {
  exists: boolean;
  data: ProjectYamlData | null;
  yaml_diagnostics: YamlDiagnostics | null;
}

type YamlNodeLike = {
  toJSON?: (...args: unknown[]) => unknown;
};

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
    module.bootstrap = record.bootstrap;
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

  return module;
}

function normalizeScenario(raw: unknown): ProjectYamlScenario | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== 'string') return null;

  const scenario: ProjectYamlScenario = { id: record.id };
  if (typeof record.module === 'string') {
    scenario.module = record.module;
  }
  return scenario;
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
