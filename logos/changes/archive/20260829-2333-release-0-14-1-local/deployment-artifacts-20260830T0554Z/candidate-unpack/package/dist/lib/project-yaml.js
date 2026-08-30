import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, parseDocument } from 'yaml';
export function normalizeBootstrap(value) {
    return value === 'adopted' || value === 'skipped' ? 'adopted' : 'normal';
}
export function isAdoptedBootstrap(value) {
    return normalizeBootstrap(value) === 'adopted';
}
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    return value;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    const items = value.filter((item) => typeof item === 'string');
    return items;
}
function asBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
}
function asNodeJson(node) {
    if (!node || typeof node !== 'object')
        return undefined;
    const toJSON = node.toJSON;
    if (typeof toJSON !== 'function')
        return undefined;
    try {
        return toJSON.call(node, null, {});
    }
    catch {
        return undefined;
    }
}
function collectMessages(...values) {
    const messages = new Set();
    for (const value of values) {
        const message = value instanceof Error
            ? value.message
            : typeof value === 'string'
                ? value
                : value && typeof value === 'object' && 'message' in value
                    ? String(value.message ?? '')
                    : String(value ?? '');
        const trimmed = message.trim();
        if (trimmed)
            messages.add(trimmed);
    }
    return Array.from(messages);
}
function normalizeModule(raw) {
    const record = asRecord(raw);
    if (!record || typeof record.id !== 'string' || typeof record.name !== 'string')
        return null;
    const module = {
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
export function normalizeBaselineSeedState(enumValue, legacyBoolean) {
    if (enumValue === 'required' || enumValue === 'partial' || enumValue === 'seeded') {
        return enumValue;
    }
    if (legacyBoolean === true)
        return 'required';
    return undefined;
}
function normalizeScenario(raw) {
    const record = asRecord(raw);
    if (!record || typeof record.id !== 'string')
        return null;
    const scenario = { id: record.id };
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
function normalizeFeature(raw) {
    const record = asRecord(raw);
    if (!record
        || typeof record.id !== 'string'
        || typeof record.name !== 'string'
        || typeof record.module !== 'string') {
        return null;
    }
    const feature = {
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
function normalizeFeatureCounter(raw) {
    const record = asRecord(raw);
    if (!record)
        return undefined;
    if (typeof record.next_id === 'number') {
        return { next_id: record.next_id };
    }
    return undefined;
}
/** decision-record-capability（S38）：解析 decision_counter（仅 next_id: number 合法；CLI 只读、不取号）。 */
function normalizeDecisionCounter(raw) {
    const record = asRecord(raw);
    if (!record)
        return undefined;
    if (typeof record.next_id === 'number') {
        return { next_id: record.next_id };
    }
    return undefined;
}
function normalizeDeploymentGate(raw) {
    const record = asRecord(raw);
    if (!record)
        return null;
    const gate = {};
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
function normalizeProjectYaml(raw) {
    const record = asRecord(raw);
    if (!record)
        return null;
    const data = {};
    const modules = Array.isArray(record.modules)
        ? record.modules.map(normalizeModule).filter((item) => item !== null)
        : undefined;
    if (modules !== undefined) {
        data.modules = modules;
    }
    const scenarios = Array.isArray(record.scenarios)
        ? record.scenarios.map(normalizeScenario).filter((item) => item !== null)
        : undefined;
    if (scenarios !== undefined) {
        data.scenarios = scenarios;
    }
    const features = Array.isArray(record.features)
        ? record.features.map(normalizeFeature).filter((item) => item !== null)
        : undefined;
    if (features !== undefined) {
        data.features = features;
    }
    const featureCounter = normalizeFeatureCounter(record.feature_counter);
    if (featureCounter !== undefined) {
        data.feature_counter = featureCounter;
    }
    const decisionCounter = normalizeDecisionCounter(record.decision_counter);
    if (decisionCounter !== undefined) {
        data.decision_counter = decisionCounter;
    }
    const deploymentGates = asRecord(record.deployment_gates);
    if (deploymentGates) {
        const normalized = {};
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
        const normalized = {};
        for (const [moduleId, entry] of Object.entries(baselineIndex)) {
            const rec = asRecord(entry);
            if (!rec)
                continue;
            const indexEntry = {};
            if (typeof rec.source_hash === 'string')
                indexEntry.source_hash = rec.source_hash;
            // drop-coverage-human-verified：不再解析 human_verified（旧值遇之忽略）。
            if (typeof rec.denominator === 'number')
                indexEntry.denominator = rec.denominator;
            if (typeof rec.generated_at === 'string')
                indexEntry.generated_at = rec.generated_at;
            if (Object.keys(indexEntry).length > 0)
                normalized[moduleId] = indexEntry;
        }
        if (Object.keys(normalized).length > 0) {
            data.baseline_index = normalized;
        }
    }
    return Object.keys(data).length > 0 ? data : null;
}
function recoverProjectYamlData(content) {
    const doc = parseDocument(content);
    const recoveredFields = [];
    const data = {};
    let hasRecoveredModules = false;
    const rawModules = asNodeJson(doc.get('modules', true));
    const modules = Array.isArray(rawModules)
        ? rawModules.map(normalizeModule).filter((item) => item !== null)
        : undefined;
    if (modules !== undefined) {
        if (modules.length > 0) {
            data.modules = modules;
            recoveredFields.push('modules');
            hasRecoveredModules = true;
        }
    }
    else if (rawModules !== undefined) {
        recoveredFields.push('modules');
    }
    const rawScenarios = asNodeJson(doc.get('scenarios', true));
    const scenarios = Array.isArray(rawScenarios)
        ? rawScenarios.map(normalizeScenario).filter((item) => item !== null)
        : undefined;
    if (scenarios !== undefined) {
        data.scenarios = scenarios;
        recoveredFields.push('scenarios');
    }
    const rawDeploymentGates = asNodeJson(doc.get('deployment_gates', true));
    const deploymentGatesRecord = asRecord(rawDeploymentGates);
    if (deploymentGatesRecord) {
        const normalized = {};
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
        messages: collectMessages('logos-project.yaml 存在可恢复的解析错误', ...doc.errors.map(error => error?.message ?? error)),
    };
}
function buildDiagnostics(status, messages, recoveredFields = [], hasRecoveredModules = false) {
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
export function readProjectYaml(root) {
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
    }
    catch (error) {
        const recovered = recoverProjectYamlData(content);
        const status = recovered.has_recovered_modules
            ? 'recovered'
            : 'error';
        return {
            exists: true,
            data: recovered.data,
            yaml_diagnostics: buildDiagnostics(status, collectMessages(error, ...recovered.messages), recovered.recovered_fields, recovered.has_recovered_modules),
        };
    }
}
//# sourceMappingURL=project-yaml.js.map