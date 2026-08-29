/**
 * S39 baseline-on-touch：提案闭包的唯一确定性判据。
 *
 * 本模块只读。proposal/tasks/change-lint/merge 必须共享这里的 YAML、canonical target、
 * P/T/D 对账、CREATE 完整度与 non-Markdown 整文件协议，禁止在调用点复制判据。
 */
import {
  existsSync, lstatSync, readFileSync, realpathSync,
} from 'node:fs';
import {
  dirname, isAbsolute, join, posix, relative, sep,
} from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  validate as compileOpenApi30,
  type Output as OpenApiValidationOutput,
  type OutputUnit as OpenApiValidationOutputUnit,
} from '@hyperjump/json-schema/openapi-3-0';
import { validate as compileOpenApi31 } from '@hyperjump/json-schema/openapi-3-1';
import { parseDocument } from 'yaml';
import {
  authorityScan,
  scanMarkdownAuthorityStructure,
  type AuthorityHeadingNode,
  type MarkdownAuthorityStructure,
} from './markdown-scan.js';
import {
  extractStructuredTestIds,
  extractTaskSectionItems,
  resolveProposalDeploymentDecision,
} from './proposal-lifecycle.js';
import {
  DELTA_TO_RESOURCE,
  type DeltaEntryClassification,
} from './delta-classify.js';
import {
  BaselineCommitInProgressError,
  listBaselineSeedModuleIds,
  withRecoveredReadLocks,
} from './baseline-seed-txn.js';

export const BASELINE_CLOSURE_POLICY = 'on-touch-v1' as const;

export const BASELINE_CLOSURE_MODES = ['MODIFY', 'CREATE', 'SKIP', 'AMBIGUOUS'] as const;
export type BaselineClosureMode = typeof BASELINE_CLOSURE_MODES[number];

export const BASELINE_CLOSURE_CATEGORIES = [
  'requirement', 'feature', 'architecture', 'scenario', 'api', 'database', 'test',
  'orchestration', 'deployment', 'smoke', 'spec', 'skill', 'decision',
] as const;
export type BaselineClosureCategory = typeof BASELINE_CLOSURE_CATEGORIES[number];

export const BASELINE_CLOSURE_VIOLATION_CODES = [
  'baseline_closure_declaration_missing',
  'baseline_closure_malformed',
  'baseline_closure_target_missing',
  'delta_target_duplicate',
  'delta_target_mode_mismatch',
  'baseline_closure_ambiguous',
  'delta_target_unplanned',
  'create_target_incomplete',
  'non_markdown_delta_invalid',
] as const;
export type BaselineClosureViolationCode = typeof BASELINE_CLOSURE_VIOLATION_CODES[number];

export interface BaselineClosureViolation {
  code: BaselineClosureViolationCode;
  /** 项目根相对路径。 */
  path: string;
  message: string;
  fix_hint: string;
}

export interface BaselineClosureTarget {
  scenarioIds: string[];
  category: BaselineClosureCategory;
  deltaPath: string | null;
  targetPath: string | null;
  canonicalTargetPath: string | null;
  mode: BaselineClosureMode;
  reason: string;
  applicabilityEvidence: string[];
  missingEvidence: string[];
}

export interface BaselineClosurePlan {
  policy: typeof BASELINE_CLOSURE_POLICY;
  schemaVersion: 1;
  touchedScenarioIds: string[];
  targets: BaselineClosureTarget[];
}

export interface BaselineClosureSummary {
  policy: typeof BASELINE_CLOSURE_POLICY;
  stage: 'plan' | 'spec';
  touched_scenarios: number;
  targets_declared: number;
  targets_total: number;
  modify: number;
  create: number;
  skip: number;
  ambiguous: number;
  planned_delta_targets: number;
  actual_delta_targets: number;
}

export interface BaselineClosureEvaluation {
  active: boolean;
  plan?: BaselineClosurePlan;
  summary?: BaselineClosureSummary;
  violations: BaselineClosureViolation[];
}

export interface CanonicalTargetResolution {
  deltaPath: string;
  targetPath: string;
  canonicalTargetPath: string;
  category: string;
  semanticCategory: BaselineClosureCategory | null;
}

const PLAN_KEYS = new Set([
  'policy', 'schema_version', 'unit', 'delta_cardinality', 'effective_view', 'ambiguity',
  'standalone_baseline_required', 'jit_confirmation', 'touched_scenario_ids', 'targets',
]);
const TARGET_KEYS = new Set([
  'category', 'scenario_ids', 'mode', 'delta_path', 'reason', 'evidence', 'missing_evidence',
]);
const REQUIRED_SCENARIO_DIMENSIONS: BaselineClosureCategory[] = [
  'requirement', 'feature', 'scenario', 'test',
  'architecture', 'api', 'database', 'orchestration', 'deployment', 'smoke',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, expected: Set<string>): string | null {
  const actual = Object.keys(value);
  const missing = [...expected].filter(k => !Object.prototype.hasOwnProperty.call(value, k));
  const extra = actual.filter(k => !expected.has(k));
  if (missing.length === 0 && extra.length === 0) return null;
  return `字段集合不闭合${missing.length ? `，缺少 ${missing.join(', ')}` : ''}${extra.length ? `，未知 ${extra.join(', ')}` : ''}`;
}

function scenarioNumber(id: string): number {
  return Number(id.slice(1));
}

function isCanonicalScenarioArray(value: unknown, allowEmpty: boolean): value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  if (value.some(v => typeof v !== 'string' || !/^S[0-9]+$/.test(v))) return false;
  if (new Set(value).size !== value.length) return false;
  return value.every((v, i) => i === 0 || scenarioNumber(value[i - 1]) < scenarioNumber(v));
}

function isUniqueNonEmptyStringArray(value: unknown, allowEmpty: boolean): value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return false;
  if (value.some(v => typeof v !== 'string' || v.trim() === '')) return false;
  return new Set(value).size === value.length;
}

function contained(realChild: string, realBase: string): boolean {
  return realChild === realBase || realChild.startsWith(realBase + sep);
}

/**
 * 校验某一路径现存部分没有通过 symlink 逃逸 base。路径可以尚不存在；此时检查最深现存祖先。
 */
function existingPathContained(base: string, candidate: string): boolean {
  let realBase: string;
  try { realBase = realpathSync(base); } catch { return false; }
  let cursor = candidate;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
  try {
    const realCursor = realpathSync(cursor);
    return contained(realCursor, realBase);
  } catch {
    return false;
  }
}

/**
 * canonical target 的语义类别分类器。所有 plan/L9/apply 调用点必须消费本函数，
 * 禁止相信 proposal 中可伪造的 category 字段或仅相信 deltas 一级目录。
 */
export function classifyCanonicalTargetCategory(targetPath: string): BaselineClosureCategory | null {
  const path = targetPath.replace(/\\/g, '/');
  if (path.startsWith('logos/resources/prd/1-product-requirements/')) return 'requirement';
  if (path.startsWith('logos/resources/prd/2-product-design/1-feature-specs/')) return 'feature';
  if (path.startsWith('logos/resources/prd/2-product-design/2-page-design/')) return 'feature';
  if (path.startsWith('logos/resources/prd/3-technical-plan/1-architecture/')) return 'architecture';
  if (path.startsWith('logos/resources/prd/3-technical-plan/2-scenario-implementation/')) return 'scenario';
  if (path.startsWith('logos/resources/prd/3-technical-plan/3-deployment/')) return 'deployment';
  if (path.startsWith('logos/resources/api/')) return 'api';
  if (path.startsWith('logos/resources/database/')) return 'database';
  if (path.startsWith('logos/resources/test/smoke/')) return 'smoke';
  if (path.startsWith('logos/resources/test/')) return 'test';
  if (path.startsWith('logos/resources/scenario/')) return 'orchestration';
  if (path.startsWith('logos/resources/decisions/')) return 'decision';
  if (path.startsWith('spec/')) return 'spec';
  if (path.startsWith('skills/')) return 'skill';
  return null;
}

/**
 * delta 路径 → canonical merge target。统一分隔符/安全 `.`，拒绝绝对路径、`..`、未知类别及 symlink escape。
 */
export function resolveCanonicalMergeTarget(
  root: string,
  proposalDir: string,
  rawDeltaPath: string,
): CanonicalTargetResolution | null {
  if (typeof rawDeltaPath !== 'string' || rawDeltaPath.trim() !== rawDeltaPath || rawDeltaPath === '') return null;
  if (rawDeltaPath.includes('\0') || isAbsolute(rawDeltaPath) || /^[A-Za-z]:[\\/]/.test(rawDeltaPath)) return null;
  const slash = rawDeltaPath.replace(/\\/g, '/');
  const rawSegments = slash.split('/');
  if (rawSegments.some(s => s === '..' || s === '')) return null;
  const normalized = posix.normalize(slash);
  const segs = normalized.split('/');
  if (segs.length < 3 || segs[0] !== 'deltas' || segs.some(s => s === '..' || s === '')) return null;
  const category = segs[1];
  const mapped = DELTA_TO_RESOURCE[category];
  if (!mapped) return null;
  const rest = segs.slice(2).join('/');
  if (!rest || rest.endsWith('/')) return null;

  const deltaAbs = join(proposalDir, ...segs);
  const targetPath = posix.join(mapped.replace(/\\/g, '/'), rest);
  const targetAbs = join(root, ...targetPath.split('/'));
  const targetBase = join(root, ...mapped.split('/'));
  if (!existingPathContained(proposalDir, deltaAbs)) return null;
  // CREATE 时类别根本身可以尚不存在；此时以项目根检查现存祖先，待类别根出现后再收紧到该根。
  if (!existingPathContained(existsSync(targetBase) ? targetBase : root, targetAbs)) return null;

  // 已存在目标本身若是逃逸 symlink，最深祖先检查已通过 realpath；显式拒绝非常规目标。
  if (existsSync(targetAbs)) {
    try {
      const st = lstatSync(targetAbs);
      if (!(st.isFile() || st.isSymbolicLink())) return null;
    } catch { return null; }
  }

  const canonicalTargetPath = process.platform === 'win32' ? targetPath.toLocaleLowerCase('en-US') : targetPath;
  return {
    deltaPath: normalized,
    targetPath,
    canonicalTargetPath,
    category,
    semanticCategory: classifyCanonicalTargetCategory(targetPath),
  };
}

/** 兼容既有调用名；无法做 containment 时仍只返回经映射且词法安全的项目路径。 */
export function canonicalTargetFromDeltaPath(rawDeltaPath: string): string | null {
  if (typeof rawDeltaPath !== 'string' || isAbsolute(rawDeltaPath) || /^[A-Za-z]:[\\/]/.test(rawDeltaPath)) return null;
  const slash = rawDeltaPath.replace(/\\/g, '/');
  if (slash.split('/').some(s => s === '..' || s === '')) return null;
  const normalized = posix.normalize(slash);
  const segs = normalized.split('/');
  if (segs.length < 3 || segs[0] !== 'deltas') return null;
  const mapped = DELTA_TO_RESOURCE[segs[1]];
  return mapped ? posix.join(mapped, ...segs.slice(2)) : null;
}

interface ExtractedClosureYaml { present: boolean; yaml?: string; error?: string }

const TASK_CLOSURE_MODE_PREFIX_RE = /^\[(?:MODIFY|CREATE)\](?:\s|$)/;

/** 只认围栏/注释外的准确二级标题，且该节必须恰有一个 YAML fenced block。 */
function extractClosureYaml(proposalContent: string): ExtractedClosureYaml {
  const lines = proposalContent.split(/\r?\n/);
  const scan = authorityScan(lines);
  const headings: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!scan.masked[i] && /^##\s+基线闭包计划\s*$/.test(scan.text[i])) headings.push(i);
  }
  if (headings.length === 0) return { present: false };
  if (headings.length !== 1) return { present: true, error: '「## 基线闭包计划」必须恰出现一次' };
  const start = headings[0] + 1;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (!scan.masked[i] && /^##\s+/.test(scan.text[i])) { end = i; break; }
  }
  const section = lines.slice(start, end).join('\n');
  const blocks = [...section.matchAll(/^[ \t]*```(?:yaml|yml)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gmi)];
  const allFences = [...section.matchAll(/^[ \t]*```[^\r\n]*$/gm)].length;
  if (blocks.length !== 1 || allFences !== 2) {
    return { present: true, error: '基线闭包节必须恰含一个 YAML fenced block，且不得含其它 fenced block' };
  }
  return { present: true, yaml: blocks[0][1] };
}

/**
 * L9 激活判据的唯一入口：历史提案（无声明且 tasks 无模式）必须保持 legacy 零漂移；
 * 声明或 `[MODIFY]/[CREATE]` 任一在场则进入 fail-closed on-touch 校验。
 */
export function hasBaselineClosureSignal(proposalContent: string, tasksContent: string): boolean {
  if (extractClosureYaml(proposalContent).present) return true;
  return extractTaskSectionItems(tasksContent, 'delta')
    .some(item => TASK_CLOSURE_MODE_PREFIX_RE.test(item.text.trim()));
}

function malformed(path: string, message: string): BaselineClosureViolation {
  return {
    code: 'baseline_closure_malformed', path, message,
    fix_hint: '按 spec/baseline-closure.md §5 的 on-touch-v1 闭合 schema 修正唯一 YAML；不得用人读表或 parser last-wins 兜底',
  };
}

interface ParsedPlanResult { plan?: BaselineClosurePlan; violations: BaselineClosureViolation[] }

export function parseBaselineClosurePlan(
  root: string,
  proposalDir: string,
  proposalContent: string,
  proposalRelPath: string,
): ParsedPlanResult {
  const extracted = extractClosureYaml(proposalContent);
  if (!extracted.present) return { violations: [] };
  if (extracted.error || extracted.yaml === undefined) return { violations: [malformed(proposalRelPath, extracted.error ?? '缺少 YAML')] };

  const doc = parseDocument(extracted.yaml, { uniqueKeys: true, strict: true, prettyErrors: false });
  if (doc.errors.length > 0) {
    return { violations: [malformed(proposalRelPath, `YAML 严格解析失败：${doc.errors.map(e => e.message).join('；')}`)] };
  }
  let raw: unknown;
  try { raw = doc.toJS({ maxAliasCount: 100 }); } catch (e) {
    return { violations: [malformed(proposalRelPath, `YAML 转换失败：${String(e)}`)] };
  }
  const rootObj = asRecord(raw);
  if (!rootObj || Object.keys(rootObj).length !== 1 || !Object.prototype.hasOwnProperty.call(rootObj, 'baseline_closure')) {
    return { violations: [malformed(proposalRelPath, 'YAML 根必须恰含 baseline_closure')] };
  }
  const closure = asRecord(rootObj.baseline_closure);
  if (!closure) return { violations: [malformed(proposalRelPath, 'baseline_closure 必须是对象')] };
  const planKeyProblem = exactKeys(closure, PLAN_KEYS);
  if (planKeyProblem) return { violations: [malformed(proposalRelPath, `baseline_closure ${planKeyProblem}`)] };
  const literalsOk = closure.policy === BASELINE_CLOSURE_POLICY
    && closure.schema_version === 1
    && closure.unit === 'canonical-merge-target-path'
    && closure.delta_cardinality === 'exactly-one-per-non-skip-target'
    && closure.effective_view === 'merged-resources-plus-current-change-deltas'
    && closure.ambiguity === 'block-before-existing-plan-exit'
    && closure.standalone_baseline_required === false
    && closure.jit_confirmation === 'disabled';
  if (!literalsOk) return { violations: [malformed(proposalRelPath, 'on-touch-v1 固定字面量、schema_version 或布尔字段不匹配')] };
  if (!isCanonicalScenarioArray(closure.touched_scenario_ids, false)) {
    return { violations: [malformed(proposalRelPath, 'touched_scenario_ids 必须是非空、去重、按数值升序的 S<ID> 数组')] };
  }
  if (!Array.isArray(closure.targets) || closure.targets.length === 0) {
    return { violations: [malformed(proposalRelPath, 'targets 必须是非空数组')] };
  }

  const touched = closure.touched_scenario_ids;
  const touchedSet = new Set(touched);
  const targets: BaselineClosureTarget[] = [];
  const violations: BaselineClosureViolation[] = [];
  for (let i = 0; i < closure.targets.length; i++) {
    const rawTarget = asRecord(closure.targets[i]);
    const at = `targets[${i}]`;
    if (!rawTarget) { violations.push(malformed(proposalRelPath, `${at} 必须是对象`)); continue; }
    const keyProblem = exactKeys(rawTarget, TARGET_KEYS);
    if (keyProblem) { violations.push(malformed(proposalRelPath, `${at} ${keyProblem}`)); continue; }
    const category = rawTarget.category;
    const mode = rawTarget.mode;
    if (typeof category !== 'string' || !(BASELINE_CLOSURE_CATEGORIES as readonly string[]).includes(category)) {
      violations.push(malformed(proposalRelPath, `${at}.category 不在闭合枚举中`)); continue;
    }
    if (typeof mode !== 'string' || !(BASELINE_CLOSURE_MODES as readonly string[]).includes(mode)) {
      violations.push(malformed(proposalRelPath, `${at}.mode 不在闭合枚举中`)); continue;
    }
    if (!isCanonicalScenarioArray(rawTarget.scenario_ids, false)
      || rawTarget.scenario_ids.some(id => !touchedSet.has(id))) {
      violations.push(malformed(proposalRelPath, `${at}.scenario_ids 必须非空、去重、升序且属于 touched_scenario_ids`)); continue;
    }
    if (typeof rawTarget.reason !== 'string' || rawTarget.reason.trim() === ''
      || rawTarget.reason.trim() === mode) {
      violations.push(malformed(proposalRelPath, `${at}.reason 必须是有解释力的非空字符串`)); continue;
    }
    if (!isUniqueNonEmptyStringArray(rawTarget.evidence, mode === 'AMBIGUOUS')
      || !isUniqueNonEmptyStringArray(rawTarget.missing_evidence, mode !== 'AMBIGUOUS')) {
      violations.push(malformed(proposalRelPath, `${at} 的 evidence/missing_evidence 类型、非空性或唯一性不合法`)); continue;
    }
    const nonMaterial = mode === 'SKIP' || mode === 'AMBIGUOUS';
    if ((nonMaterial && rawTarget.delta_path !== null)
      || (!nonMaterial && (typeof rawTarget.delta_path !== 'string' || rawTarget.delta_path === ''))) {
      violations.push(malformed(proposalRelPath, `${at}.delta_path 与 mode=${mode} 的组合不合法`)); continue;
    }
    if (mode !== 'AMBIGUOUS' && rawTarget.missing_evidence.length !== 0) {
      violations.push(malformed(proposalRelPath, `${at}.missing_evidence 仅 AMBIGUOUS 可非空`)); continue;
    }
    if (mode === 'AMBIGUOUS' && rawTarget.missing_evidence.length === 0) {
      violations.push(malformed(proposalRelPath, `${at}.missing_evidence 在 AMBIGUOUS 时必须非空`)); continue;
    }

    let resolution: CanonicalTargetResolution | null = null;
    if (typeof rawTarget.delta_path === 'string') {
      resolution = resolveCanonicalMergeTarget(root, proposalDir, rawTarget.delta_path);
      if (!resolution) {
        violations.push(malformed(proposalRelPath, `${at}.delta_path 无法安全映射为 canonical target：${rawTarget.delta_path}`));
        continue;
      }
      if (resolution.semanticCategory === null) {
        violations.push(malformed(proposalRelPath,
          `${at}.delta_path 的 canonical target 不属于 on-touch-v1 可判定语义类别：${resolution.targetPath}`));
        continue;
      }
      if (resolution.semanticCategory !== category) {
        violations.push(malformed(proposalRelPath,
          `${at}.category=${category} 与 canonical target ${resolution.targetPath} 的语义类别=${resolution.semanticCategory} 不一致`));
        continue;
      }
    }
    targets.push({
      scenarioIds: rawTarget.scenario_ids,
      category: category as BaselineClosureCategory,
      deltaPath: resolution?.deltaPath ?? null,
      targetPath: resolution?.targetPath ?? null,
      canonicalTargetPath: resolution?.canonicalTargetPath ?? null,
      mode: mode as BaselineClosureMode,
      reason: rawTarget.reason.trim(),
      applicabilityEvidence: rawTarget.evidence,
      missingEvidence: rawTarget.missing_evidence,
    });
  }
  if (violations.length > 0) return { violations };

  const material = targets.filter(t => t.deltaPath !== null);
  const nonMaterial = targets.filter(t => t.deltaPath === null);
  const expectedOrder = [
    ...material.slice().sort((a, b) => a.deltaPath!.localeCompare(b.deltaPath!, 'en')),
    ...nonMaterial.slice().sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category, 'en');
      return scenarioNumber(a.scenarioIds[0]) - scenarioNumber(b.scenarioIds[0]);
    }),
  ];
  if (targets.some((t, i) => t !== expectedOrder[i])) {
    violations.push(malformed(proposalRelPath, 'targets 顺序非规范：非 SKIP/AMBIGUOUS 按 delta_path 升序，随后按 category/scenario 排序'));
  }
  return { plan: { policy: BASELINE_CLOSURE_POLICY, schemaVersion: 1, touchedScenarioIds: touched, targets }, violations };
}

export interface ParsedTaskTarget {
  checked: boolean;
  mode: 'MODIFY' | 'CREATE';
  deltaPath: string;
  targetPath: string;
  canonicalTargetPath: string;
}

export function parseBaselineClosureTaskTargets(
  root: string,
  proposalDir: string,
  tasksContent: string,
): { hasModeSyntax: boolean; targets: ParsedTaskTarget[]; invalid: string[] } {
  const items = extractTaskSectionItems(tasksContent, 'delta');
  const targets: ParsedTaskTarget[] = [];
  const invalid: string[] = [];
  let hasModeSyntax = false;
  for (const item of items) {
    if (TASK_CLOSURE_MODE_PREFIX_RE.test(item.text.trim())) hasModeSyntax = true;
    const m = /^\[(MODIFY|CREATE)\]\s+`([^`]+)`(?:\s*[:：]|\s*$)/.exec(item.text.trim());
    if (!m) continue;
    const resolution = resolveCanonicalMergeTarget(root, proposalDir, m[2]);
    if (!resolution) { invalid.push(m[2]); continue; }
    targets.push({ checked: item.checked, mode: m[1] as 'MODIFY' | 'CREATE', ...resolution });
  }
  return { hasModeSyntax, targets, invalid };
}

export interface NonMarkdownDeltaResult {
  ok: boolean;
  payload?: string;
  message?: string;
}

const NON_MD_MARKER = /^## (ADDED|MODIFIED) — (.+?)(（新文件，整文件）|（整文件替换）)$/;

function duplicateAwareObject(payload: string, extension: string): { value?: Record<string, unknown>; error?: string } {
  if (extension === '.json') {
    // JSON.parse 接受重复 key；先用 YAML 1.2 duplicate-aware parser 检查，再执行 JSON 严格语法。
    const ydoc = parseDocument(payload, { uniqueKeys: true, strict: true, prettyErrors: false });
    if (ydoc.errors.length > 0) return { error: ydoc.errors.map(e => e.message).join('；') };
    try {
      const value = JSON.parse(payload) as unknown;
      return asRecord(value) ? { value: value as Record<string, unknown> } : { error: '根必须是对象' };
    } catch (e) { return { error: String(e) }; }
  }
  const doc = parseDocument(payload, { uniqueKeys: true, strict: true, prettyErrors: false });
  if (doc.errors.length > 0) return { error: doc.errors.map(e => e.message).join('；') };
  try {
    const value = doc.toJS({ maxAliasCount: 100 });
    return asRecord(value) ? { value: value as Record<string, unknown> } : { error: '根必须是对象' };
  } catch (e) { return { error: String(e) }; }
}

function collectRefs(value: unknown, refs: string[]): void {
  if (Array.isArray(value)) { value.forEach(v => collectRefs(v, refs)); return; }
  const obj = asRecord(value);
  if (!obj) return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === '$ref' && typeof v === 'string') refs.push(v);
    collectRefs(v, refs);
  }
}

function pointerExists(root: Record<string, unknown>, pointer: string): boolean {
  // 当前受控 validator 没有外部 bundler；无法解析的外部引用必须 fail-closed，不能假定成功。
  if (!pointer.startsWith('#/')) return false;
  let cur: unknown = root;
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    const obj = asRecord(cur);
    if (!obj || !Object.prototype.hasOwnProperty.call(obj, key)) return false;
    cur = obj[key];
  }
  return true;
}

type ControlledOpenApiValidator = (value: unknown, outputFormat: 'DETAILED') => OpenApiValidationOutput;
const OFFICIAL_OPENAPI_VALIDATORS: Partial<Record<'3.0' | '3.1', ControlledOpenApiValidator>> = {};
let officialOpenApiCompilerError: string | null = null;

/*
 * Hyperjump 的公开 API 先异步编译、再返回同步 validator。模块加载时一次性预编译 OAI 官方
 * 3.0 schema 与 3.1 schema-base（后者同时校验 Schema Object）；之后 evaluator/merge-apply
 * 继续共享同步判据。编译器不可用时只记录失败并在 API 目标上 fail-closed。
 */
try {
  const [openApi30, openApi31] = await Promise.all([
    compileOpenApi30('https://spec.openapis.org/oas/3.0/schema'),
    compileOpenApi31('https://spec.openapis.org/oas/3.1/schema-base'),
  ]);
  OFFICIAL_OPENAPI_VALIDATORS['3.0'] = openApi30 as ControlledOpenApiValidator;
  OFFICIAL_OPENAPI_VALIDATORS['3.1'] = openApi31 as ControlledOpenApiValidator;
} catch (e) {
  officialOpenApiCompilerError = String(e);
}

function officialOpenApiValidator(version: '3.0' | '3.1'): { validate?: ControlledOpenApiValidator; error?: string } {
  const validate = OFFICIAL_OPENAPI_VALIDATORS[version];
  return validate
    ? { validate }
    : { error: officialOpenApiCompilerError ?? `OpenAPI ${version} 官方 schema 未完成编译` };
}

function formatSchemaErrors(output: OpenApiValidationOutput): string {
  if (output.valid) return '';
  const leaves: string[] = [];
  const visit = (items: OpenApiValidationOutputUnit[]): void => {
    for (const item of items) {
      if (leaves.length >= 5) return;
      if (item.errors && item.errors.length > 0) visit(item.errors);
      else {
        const keyword = item.keyword.split('/').pop() ?? item.keyword;
        leaves.push(`${item.instanceLocation || '#'} ${keyword}`);
      }
    }
  };
  visit(output.errors ?? []);
  return leaves.join('；') || '未提供详细错误';
}

function validateOpenApi(payload: string, extension: string): string | null {
  const parsed = duplicateAwareObject(payload, extension);
  if (!parsed.value) return `OpenAPI 解析失败：${parsed.error}`;
  const root = parsed.value;
  const version = typeof root.openapi === 'string' && /^3\.0\.[0-9]+$/.test(root.openapi)
    ? '3.0'
    : typeof root.openapi === 'string' && /^3\.1\.[0-9]+$/.test(root.openapi) ? '3.1' : null;
  if (!version) return 'openapi 必须是受支持的 3.0.x 或 3.1.x';
  const official = officialOpenApiValidator(version);
  if (!official.validate) return `OpenAPI ${version} 官方 schema validator 不可用：${official.error ?? '未知错误'}`;
  const schemaResult = official.validate(root, 'DETAILED');
  if (!schemaResult.valid) {
    return `OpenAPI ${version} 官方 schema 校验失败：${formatSchemaErrors(schemaResult)}`;
  }

  const paths = asRecord(root.paths)!;
  const components = asRecord(root.components);
  if (!components || !asRecord(components.schemas) || Object.keys(asRecord(components.schemas)!).length === 0) {
    return 'components.schemas 必须非空';
  }
  const operationIds = new Set<string>();
  for (const pathItem of Object.values(paths)) {
    const item = asRecord(pathItem);
    if (!item) continue;
    for (const [method, rawOp] of Object.entries(item)) {
      if (!/^(get|put|post|delete|patch|options|head|trace)$/.test(method)) continue;
      const op = asRecord(rawOp);
      if (!op || typeof op.operationId !== 'string' || op.operationId.trim() === '') return `operation ${method} 缺 operationId`;
      if (operationIds.has(op.operationId)) return `operationId 重复：${op.operationId}`;
      operationIds.add(op.operationId);
    }
  }
  if (operationIds.size === 0) return 'paths 中没有 operation';
  const refs: string[] = [];
  collectRefs(root, refs);
  const broken = refs.find(r => !pointerExists(root, r));
  if (broken) return `本地 $ref 无法解析：${broken}`;
  const lower = payload.toLowerCase();
  if (!/(security|bearer|oauth|api[-_ ]?key)/i.test(lower)) return '缺鉴权/security 定义';
  if (!/(deprecated|compatib|兼容|弃用)/i.test(lower)) return '缺兼容或弃用语义';
  if (!/(4\d\d|5\d\d|error|错误)/i.test(lower)) return '缺错误响应语义';
  return null;
}

export type DatabaseDialect = 'sqlite' | 'postgresql' | 'mysql';

function normalizeDatabaseDialect(value: string): DatabaseDialect | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (['sqlite', 'sqlite3'].includes(normalized)) return 'sqlite';
  if (['postgres', 'postgresql', 'pgsql'].includes(normalized)) return 'postgresql';
  if (['mysql', 'mariadb'].includes(normalized)) return 'mysql';
  return null;
}

/** 从合并后的项目 tech_stack 解析 SQL 方言；缺失、冲突或未知时一律 fail-closed。 */
export function resolveProjectDatabaseDialect(root: string): { dialect?: DatabaseDialect; error?: string } {
  const indexPath = join(root, 'logos', 'logos-project.yaml');
  if (!existsSync(indexPath)) return { error: '缺少 logos/logos-project.yaml，无法确定 SQL 方言' };
  const doc = parseDocument(readFileSync(indexPath, 'utf-8'), { uniqueKeys: true, strict: true, prettyErrors: false });
  if (doc.errors.length > 0) return { error: `logos-project.yaml 严格解析失败：${doc.errors.map(e => e.message).join('；')}` };
  let rootValue: unknown;
  try { rootValue = doc.toJS({ maxAliasCount: 100 }); } catch (e) { return { error: `logos-project.yaml 转换失败：${String(e)}` }; }
  const techStack = asRecord(asRecord(rootValue)?.tech_stack);
  const database = techStack?.database;
  const candidates: string[] = [];
  if (typeof database === 'string') candidates.push(database);
  else {
    const db = asRecord(database);
    if (db) {
      for (const key of ['dialect', 'engine', 'type', 'name']) {
        if (typeof db[key] === 'string') candidates.push(db[key] as string);
      }
    }
  }
  if (candidates.length === 0) return { error: 'tech_stack.database 未声明 SQL 方言' };
  const normalized = [...new Set(candidates.map(normalizeDatabaseDialect))];
  if (normalized.includes(null)) return { error: `tech_stack.database 含不支持的方言：${candidates.join('、')}` };
  if (normalized.length !== 1) return { error: `tech_stack.database 方言冲突：${candidates.join('、')}` };
  return { dialect: normalized[0]! };
}

function validateSql(payload: string, dialect: DatabaseDialect): string | null {
  // 类别最低完整度与真正 parser/执行预检是两层门；关键词只负责提示缺少哪种设计资产。
  if (!/\bCREATE\s+TABLE\b/i.test(payload)) return '缺 CREATE TABLE';
  if (!/\bPRIMARY\s+KEY\b/i.test(payload)) return '缺主键';
  if (!/\b(CONSTRAINT|FOREIGN\s+KEY|UNIQUE|CHECK)\b/i.test(payload)) return '缺约束';
  if (!/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(payload)) return '缺索引';
  if (!/(migration|migrate|迁移)/i.test(payload) || !/(rollback|回滚)/i.test(payload)) return '缺迁移/回滚语义';

  if (dialect !== 'sqlite') {
    return `${dialect} SQL parser/隔离执行适配器不可用；拒绝用 SQLite 冒充该方言`;
  }
  const sqlite = spawnSync('sqlite3', [':memory:'], {
    input: `.bail on\nPRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n${payload}\n`
      + "SELECT 'openlogos_tables=' || count(*) FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%';\n"
      + "SELECT 'openlogos_indexes=' || count(*) FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL;\nROLLBACK;\n",
    encoding: 'utf-8', timeout: 10_000,
  });
  if (sqlite.error) return `SQLite validator 不可用：${sqlite.error.message}`;
  if (sqlite.status !== 0) return `SQLite 执行预检失败：${(sqlite.stderr || '').trim()}`;
  const tables = Number(/openlogos_tables=(\d+)/.exec(sqlite.stdout || '')?.[1] ?? 0);
  const indexes = Number(/openlogos_indexes=(\d+)/.exec(sqlite.stdout || '')?.[1] ?? 0);
  if (tables < 1) return 'SQLite schema 预检后没有用户表';
  if (indexes < 1) return 'SQLite schema 预检后没有显式索引';
  return null;
}

/**
 * 校验并剥离 API/DB non-Markdown delta 首行。返回的 payload 不含 marker，调用方不得把 marker 写入目标。
 */
export function validateAndStripNonMarkdownDelta(
  content: string,
  mode: 'MODIFY' | 'CREATE',
  canonicalTargetPath: string,
  options: { root?: string; databaseDialect?: DatabaseDialect } = {},
): NonMarkdownDeltaResult {
  const newline = content.indexOf('\n');
  if (newline < 0) return { ok: false, message: '整文件 delta 缺 payload 或首行行结束符' };
  const first = content.slice(0, newline).replace(/\r$/, '');
  const marker = NON_MD_MARKER.exec(first);
  if (!marker) return { ok: false, message: '首行控制 marker 不合法' };
  const expectedOp = mode === 'CREATE' ? 'ADDED' : 'MODIFIED';
  const expectedSuffix = mode === 'CREATE' ? '（新文件，整文件）' : '（整文件替换）';
  if (marker[1] !== expectedOp || marker[3] !== expectedSuffix) return { ok: false, message: `首行 mode 与 ${mode} 不一致` };
  if (marker[2] !== canonicalTargetPath) return { ok: false, message: `首行 target 与 canonical target 不一致：${marker[2]}` };
  const payload = content.slice(newline + 1);
  if (payload.trim() === '') return { ok: false, message: '剥离 marker 后 payload 为空' };
  if (/^## (?:ADDED|MODIFIED) — /m.test(payload)) return { ok: false, message: 'payload 内残留控制 marker' };
  if (/\b(?:TODO|TBD)\b|后续补充|\[新增的完整内容\]/i.test(payload)) return { ok: false, message: 'payload 含模板/TODO 骨架' };
  const ext = posix.extname(canonicalTargetPath).toLowerCase();
  let problem: string | null;
  if (canonicalTargetPath.startsWith('logos/resources/api/') && ['.yaml', '.yml', '.json'].includes(ext)) {
    problem = validateOpenApi(payload, ext);
  } else if (canonicalTargetPath.startsWith('logos/resources/database/') && ext === '.sql') {
    const resolved = options.databaseDialect
      ? { dialect: options.databaseDialect }
      : options.root ? resolveProjectDatabaseDialect(options.root) : { error: '缺少项目根，无法确定 SQL 方言' };
    if (!resolved.dialect) return { ok: false, message: resolved.error ?? '无法确定 SQL 方言' };
    problem = validateSql(payload, resolved.dialect);
  } else {
    return { ok: false, message: '整文件协议只支持 API YAML/YML/JSON 与 database SQL' };
  }
  return problem ? { ok: false, message: problem } : { ok: true, payload };
}

interface MarkdownCreatePayload {
  payload: string;
  problems: string[];
}

/** Markdown CREATE 只能由围栏外 ADDED 块组成；其它控制段不能伪装成全量新文件。 */
function markdownCreatePayload(content: string): MarkdownCreatePayload {
  const lines = content.split(/\r?\n/);
  const scan = authorityScan(lines);
  const markers: Array<{ line: number; op: 'ADDED' | 'MODIFIED' | 'REMOVED' | 'REMOVED-ITEMS'; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan.masked[i]) continue;
    const match = scan.text[i].trim().match(/^##\s+(REMOVED-ITEMS|ADDED|MODIFIED|REMOVED)\b\s*(?:[—-]\s*(.*))?$/);
    if (match) markers.push({
      line: i,
      op: match[1] as 'ADDED' | 'MODIFIED' | 'REMOVED' | 'REMOVED-ITEMS',
      title: (match[2] ?? '').trim(),
    });
  }
  const problems: string[] = [];
  const added = markers.filter(marker => marker.op === 'ADDED');
  if (added.length === 0) problems.push('Markdown CREATE 缺围栏外 ADDED 控制段');
  const forbidden = [...new Set(markers.filter(marker => marker.op !== 'ADDED').map(marker => marker.op))];
  if (forbidden.length > 0) problems.push(`Markdown CREATE 禁止 ${forbidden.join('、')} 控制段`);

  const chunks: string[] = [];
  for (const marker of added) {
    const next = markers.find(candidate => candidate.line > marker.line)?.line ?? lines.length;
    const titleLine = marker.title ? `## ${marker.title}` : '';
    chunks.push([titleLine, ...lines.slice(marker.line + 1, next)].filter((line, index) => index > 0 || line !== '').join('\n'));
  }
  return { payload: chunks.join('\n'), problems };
}

const CREATE_REQUIREMENTS: Partial<Record<BaselineClosureCategory, Array<{ label: string; re: RegExp }>>> = {
  requirement: [
    { label: '身份', re: /(^|\n)#{1,6}\s+.*(?:P\d+|需求|requirement)/i },
    { label: '问题/目标', re: /问题|目标|problem|goal/i },
    { label: '价值', re: /价值|value/i },
    { label: '范围', re: /范围|scope/i },
    { label: '验收', re: /验收|acceptance/i },
    { label: '非目标', re: /非目标|non[- ]?goal/i },
  ],
  feature: [
    { label: '身份', re: /(^|\n)#{1,6}\s+.*(?:F\d+|功能|feature)/i },
    { label: '问题/目标', re: /问题|目标|problem|goal/i },
    { label: '价值', re: /价值|value/i },
    { label: '范围', re: /范围|scope/i },
    { label: '验收', re: /验收|acceptance/i },
    { label: '非目标', re: /非目标|non[- ]?goal/i },
  ],
  architecture: [
    { label: '边界', re: /边界|boundary/i },
    { label: '数据/控制流', re: /数据流|控制流|data flow|control flow/i },
    { label: '所有权', re: /所有权|归属|ownership/i },
    { label: '不变量', re: /不变量|invariant/i },
    { label: '失败策略', re: /失败|回滚|failure/i },
    { label: '实现映射', re: /实现映射|implementation mapping/i },
  ],
  test: [
    { label: '主路径', re: /主路径|正常路径|正例|main path|happy path/i },
    { label: '异常', re: /异常|exception/i },
    { label: '边界', re: /边界|boundary/i },
    { label: '追溯', re: /追溯|trace/i },
    { label: 'reporter', re: /OpenLogos reporter|test-results\.jsonl/i },
  ],
  orchestration: [
    { label: '调用链', re: /调用链|请求链|request chain/i },
    { label: 'fixture', re: /fixture/i },
    { label: '断言', re: /断言|assert/i },
    { label: 'cleanup', re: /cleanup|清理/i },
    { label: '失败诊断', re: /失败诊断|diagnostic/i },
    { label: 'reporter', re: /OpenLogos reporter|test-results\.jsonl/i },
  ],
  decision: [
    { label: '状态', re: /状态|status/i },
    { label: '背景', re: /背景|context/i },
    { label: '决策', re: /决策|decision/i },
    { label: '理由', re: /理由|reason/i },
    { label: '备选', re: /备选|alternative/i },
    { label: '影响面', re: /影响|consequence/i },
    { label: '来源', re: /来源|source/i },
  ],
};

const SCENARIO_STEP_HEADINGS = new Set([
  '步骤说明', '主路径步骤', '主路径', '主流程', '正常流程', 'main path',
]);

function normalizedHeading(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function matchingHeadings(
  structure: MarkdownAuthorityStructure,
  predicate: (text: string) => boolean,
): AuthorityHeadingNode[] {
  return structure.headings.filter(heading => predicate(normalizedHeading(heading.text)));
}

function sectionEnd(structure: MarkdownAuthorityStructure, heading: AuthorityHeadingNode): number {
  return structure.headings.find(candidate => candidate.line > heading.line && candidate.level <= heading.level)?.line
    ?? structure.lines.length;
}

function sectionHasAuthorityBody(
  structure: MarkdownAuthorityStructure,
  heading: AuthorityHeadingNode,
): boolean {
  const end = sectionEnd(structure, heading);
  const headingLines = new Set(structure.headings.map(item => item.line));
  for (let i = heading.line + 1; i < end; i++) {
    if (structure.scan.masked[i] || headingLines.has(i)) continue;
    if (structure.scan.text[i].trim().length > 0) return true;
  }
  return false;
}

function requiredSectionProblem(
  structure: MarkdownAuthorityStructure,
  predicate: (text: string) => boolean,
  label: string,
): string | null {
  const headings = matchingHeadings(structure, predicate);
  if (headings.length === 0) return `${label}章节缺失`;
  if (!headings.some(heading => sectionHasAuthorityBody(structure, heading))) return `${label}章节为空`;
  return null;
}

function uniqueSectionProblems(
  structure: MarkdownAuthorityStructure,
  predicate: (text: string) => boolean,
  label: string,
): string[] {
  const headings = matchingHeadings(structure, predicate);
  if (headings.length === 0) return [`${label}章节缺失`];
  if (headings.length > 1) return [`${label}章节重复`];
  return sectionHasAuthorityBody(structure, headings[0]) ? [] : [`${label}章节为空`];
}

function stepSectionProblems(
  structure: MarkdownAuthorityStructure,
  heading: AuthorityHeadingNode,
): string[] {
  const end = sectionEnd(structure, heading);
  let currentRun = 0;
  let longestRun = 0;
  let itemCount = 0;
  let hasEmptyItem = false;
  for (let i = heading.line + 1; i < end; i++) {
    if (structure.scan.masked[i]) {
      currentRun = 0;
      continue;
    }
    const line = structure.scan.text[i];
    const item = line.match(/^ {0,3}\d+[.)](?:[ \t]+(.*))?$/);
    if (item) {
      itemCount++;
      currentRun++;
      longestRun = Math.max(longestRun, currentRun);
      if (!(item[1] ?? '').trim()) hasEmptyItem = true;
      continue;
    }
    if (line.trim() === '' || (currentRun > 0 && /^(?: {2,}|\t)\S/.test(line))) continue;
    currentRun = 0;
  }
  const problems: string[] = [];
  if (itemCount === 0) problems.push('步骤章节无有序列表');
  else {
    if (longestRun < 3) problems.push('步骤有序列表少于 3 项');
    if (hasEmptyItem) problems.push('步骤有序列表存在空项');
  }
  return problems;
}

function mermaidProblems(structure: MarkdownAuthorityStructure): string[] {
  const diagrams = structure.fences
    .filter(fence => fence.closed && normalizedHeading(fence.info) === 'mermaid')
    .map(fence => fence.content.split(/\r?\n/)
      .map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('%%')))
    .filter(lines => lines[0]?.toLocaleLowerCase('en-US') === 'sequencediagram');
  if (diagrams.length === 0) return ['时序缺合法 Mermaid sequenceDiagram'];
  const complete = diagrams.some(lines => {
    const participants = lines.filter(line => /^(?:participant|actor)\s+\S+/i.test(line));
    const messages = lines.filter(line => /^\s*\S+\s*(?:-->>|->>|-->|->)\+?\s*\S+\s*:/.test(line));
    return participants.length >= 2 && messages.length >= 1;
  });
  if (complete) return [];
  const problems: string[] = [];
  if (!diagrams.some(lines => lines.filter(line => /^(?:participant|actor)\s+\S+/i.test(line)).length >= 2)) {
    problems.push('Mermaid sequenceDiagram 参与者少于 2');
  }
  if (!diagrams.some(lines => lines.some(line => /^\s*\S+\s*(?:-->>|->>|-->|->)\+?\s*\S+\s*:/.test(line)))) {
    problems.push('Mermaid sequenceDiagram 缺消息');
  }
  return problems;
}

/** S39 §17：scenario CREATE 只采信 Markdown 权威结构，不再以全文关键词判完整。 */
function scenarioCreateCompletenessProblems(payload: string): string[] {
  const structure = scanMarkdownAuthorityStructure(payload);
  const problems: string[] = [];
  const goal = requiredSectionProblem(structure, text => /^(?:场景)?目标$|^goal$/i.test(text), '目标');
  if (goal) problems.push(goal);
  const participants = requiredSectionProblem(
    structure, text => /^(?:参与者|participants?)$/i.test(text), '参与者',
  );
  if (participants) problems.push(participants);
  const pre = requiredSectionProblem(
    structure, text => /前置|preconditions?/i.test(text), '前置',
  );
  const post = requiredSectionProblem(
    structure, text => /后置|postconditions?/i.test(text), '后置',
  );
  if (pre || post) problems.push(pre && post ? '前后置章节缺失或为空' : (pre ?? post)!);

  problems.push(...mermaidProblems(structure));

  const stepHeadings = matchingHeadings(structure, text => SCENARIO_STEP_HEADINGS.has(text));
  if (stepHeadings.length === 0) problems.push('步骤章节缺失');
  else if (stepHeadings.length > 1) problems.push('步骤章节重复');
  else problems.push(...stepSectionProblems(structure, stepHeadings[0]));

  problems.push(...uniqueSectionProblems(
    structure,
    text => /^(?:异常|边界|异常(?:与|及|\/|&)边界|异常路径|边界条件|exceptions?|boundar(?:y|ies)|exceptions?\s*(?:and|&|\/)\s*boundar(?:y|ies))$/i.test(text),
    '异常/边界',
  ));
  problems.push(...uniqueSectionProblems(
    structure, text => /^(?:追溯|可追溯性|trace|traceability)$/i.test(text), '追溯',
  ));
  if (structure.malformed.length > 0) problems.push(`Markdown 结构无法确定：${structure.malformed.join('、')}`);
  return problems;
}

function createCompletenessProblems(category: BaselineClosureCategory, content: string): string[] {
  const create = markdownCreatePayload(content);
  if (create.problems.length > 0) return create.problems;
  const payload = create.payload;
  if (/\b(?:TODO|TBD)\b|后续补充|\[(?:新增|修改).*内容\]/i.test(payload)) return ['含模板/TODO 骨架'];
  if (category === 'scenario') return scenarioCreateCompletenessProblems(payload);
  const reqs = CREATE_REQUIREMENTS[category];
  // spec/skill/deployment/smoke 不在 §11 的 CREATE 类别注册表内，不用通用词表臆造完整度判据。
  if (!reqs) return [];
  const missing = reqs.filter(r => !r.re.test(payload)).map(r => r.label);
  if (category === 'test') {
    const ids = extractStructuredTestIds(payload);
    if (!ids.some(id => /^UT-/.test(id)) || !ids.some(id => /^ST-/.test(id))) missing.push('真实 UT/ST ID');
  }
  return missing;
}

function closureViolation(
  code: BaselineClosureViolationCode,
  path: string,
  message: string,
  fixHint: string,
): BaselineClosureViolation {
  return { code, path, message, fix_hint: fixHint };
}

function addDuplicateViolations(
  values: Array<{ canonicalTargetPath: string; sourcePath: string }>,
  violations: BaselineClosureViolation[],
): void {
  const grouped = new Map<string, string[]>();
  for (const value of values) grouped.set(value.canonicalTargetPath, [...(grouped.get(value.canonicalTargetPath) ?? []), value.sourcePath]);
  for (const [target, paths] of grouped) {
    if (paths.length < 2) continue;
    for (const path of paths) {
      violations.push(closureViolation('delta_target_duplicate', path,
        `canonical target ${target} 出现 ${paths.length} 次（${paths.join('、')}）`,
        '按 canonical target 聚合场景与改动，只保留一条 task 和一份最终态 delta'));
    }
  }
}

export interface EvaluateBaselineClosureOptions {
  root: string;
  proposalDir: string;
  slug: string;
  proposalContent: string;
  tasksContent: string;
  deltaEntries: DeltaEntryClassification[];
  deltaContents: Map<string, string>;
}

/** 共享 ClosureEvaluator：legacy 返回 active=false；on-touch-v1 对 plan/spec 执行完整闭包。 */
export function evaluateBaselineClosure(options: EvaluateBaselineClosureOptions): BaselineClosureEvaluation {
  const locked = withRecoveredReadLocks(
    options.root,
    new Date().toISOString(),
    listBaselineSeedModuleIds(options.root),
    () => evaluateBaselineClosureLocked(options),
  );
  if (!locked.ok) {
    throw new BaselineCommitInProgressError(
      `baseline_commit_in_progress — 模块 ${locked.inProgress.join(', ')} 的未终结 journal 无法在闭包读取前恢复`,
    );
  }
  return locked.value;
}

function evaluateBaselineClosureLocked(options: EvaluateBaselineClosureOptions): BaselineClosureEvaluation {
  const { root, proposalDir, slug, proposalContent, tasksContent, deltaEntries, deltaContents } = options;
  const proposalRel = `logos/changes/${slug}/proposal.md`;
  const tasksRel = `logos/changes/${slug}/tasks.md`;
  const parsedTasks = parseBaselineClosureTaskTargets(root, proposalDir, tasksContent);
  const extracted = extractClosureYaml(proposalContent);
  if (!extracted.present) {
    if (!parsedTasks.hasModeSyntax) return { active: false, violations: [] };
    return {
      active: true,
      violations: [closureViolation('baseline_closure_declaration_missing', proposalRel,
        '[delta] 已使用 [MODIFY]/[CREATE]，但 proposal 缺少 on-touch-v1 基线闭包声明',
        '在 proposal.md 的「## 基线闭包计划」写入唯一 baseline_closure fenced YAML；不得从 tasks 反推计划')],
    };
  }

  const parsed = parseBaselineClosurePlan(root, proposalDir, proposalContent, proposalRel);
  if (!parsed.plan) return { active: true, violations: parsed.violations };
  const plan = parsed.plan;
  const violations = [...parsed.violations];
  for (const invalid of parsedTasks.invalid) {
    violations.push(malformed(tasksRel, `task delta 路径无法安全映射：${invalid}`));
  }

  const planMaterial = plan.targets.filter(t => t.canonicalTargetPath !== null);
  addDuplicateViolations(planMaterial.map(t => ({ canonicalTargetPath: t.canonicalTargetPath!, sourcePath: proposalRel })), violations);
  addDuplicateViolations(parsedTasks.targets.map(t => ({ canonicalTargetPath: t.canonicalTargetPath, sourcePath: tasksRel })), violations);

  const planByTarget = new Map(planMaterial.map(t => [t.canonicalTargetPath!, t]));
  const taskByTarget = new Map(parsedTasks.targets.map(t => [t.canonicalTargetPath, t]));
  const specMerged = existsSync(join(proposalDir, 'SPEC_MERGED'));

  for (const target of plan.targets) {
    if (target.mode === 'AMBIGUOUS') {
      violations.push(closureViolation('baseline_closure_ambiguous', proposalRel,
        `${target.category}/${target.scenarioIds.join(',')} 仍为 AMBIGUOUS：${target.missingEvidence.join('；')}`,
        `在既有 plan-exit 前补齐证据并改为 MODIFY/CREATE/SKIP；缺失证据：${target.missingEvidence.join('；')}`));
    }
  }

  // touched scenario 的四强制 + 六条件维度逐项闭包；强制维度不能 SKIP/AMBIGUOUS。
  for (const scenario of plan.touchedScenarioIds) {
    for (const category of REQUIRED_SCENARIO_DIMENSIONS) {
      const dispositions = plan.targets.filter(t => t.category === category && t.scenarioIds.includes(scenario));
      const strong = ['requirement', 'feature', 'scenario', 'test'].includes(category);
      const covered = strong
        ? dispositions.some(t => t.mode === 'MODIFY' || t.mode === 'CREATE')
        : dispositions.length > 0;
      if (!covered) {
        violations.push(closureViolation('baseline_closure_target_missing', proposalRel,
          `touched scenario ${scenario} 缺少 ${category} ${strong ? '强制目标' : '条件维度 disposition'}`,
          `为 ${scenario} 增加 ${category} 的 MODIFY/CREATE${strong ? '' : '/SKIP/AMBIGUOUS'} target；不得从其它场景或 tasks 反推`));
      }
    }
    const api = plan.targets.filter(t => t.category === 'api' && t.scenarioIds.includes(scenario)).map(t => t.mode);
    const orchestration = plan.targets.filter(t => t.category === 'orchestration' && t.scenarioIds.includes(scenario)).map(t => t.mode);
    const apiMaterial = api.some(m => m === 'MODIFY' || m === 'CREATE');
    const apiSkipOnly = api.length > 0 && api.every(m => m === 'SKIP');
    const orchestrationMaterial = orchestration.some(m => m === 'MODIFY' || m === 'CREATE');
    const orchestrationSkipOnly = orchestration.length > 0 && orchestration.every(m => m === 'SKIP');
    if ((apiMaterial && !orchestrationMaterial) || (apiSkipOnly && !orchestrationSkipOnly)) {
      violations.push(closureViolation('baseline_closure_target_missing', proposalRel,
        `${scenario} 的 API 与 orchestration disposition 不一致`,
        'API 为 MODIFY/CREATE 时 orchestration 同为 MODIFY/CREATE；API 为 SKIP 时 orchestration 只能 SKIP'));
    }
  }

  // proposal 的结构化部署决策是 deployment/smoke disposition 的唯一业务事实源；
  // targets 只能与之对账，不能自行把需要部署伪装成 SKIP（或反向伪造物质目标）。
  const deploymentDecision = resolveProposalDeploymentDecision(proposalDir);
  if (deploymentDecision.deployment_decision_conflict) {
    violations.push(closureViolation('baseline_closure_target_missing', proposalRel,
      `部署决策与 tasks [deploy] 冲突：${deploymentDecision.deployment_decision_conflict_reason ?? '未知冲突'}`,
      '先统一 proposal「部署影响」与 tasks [deploy] section，再按同一决定填写 deployment/smoke disposition'));
  }
  const hasExplicitProposalDeploymentDecision = deploymentDecision.deployment_decision_source === 'proposal';
  const strictDeploymentRequired = hasExplicitProposalDeploymentDecision
    ? deploymentDecision.deployment_required : null;
  const strictSmokeRequired = hasExplicitProposalDeploymentDecision
    ? deploymentDecision.smoke_required : null;
  if (!hasExplicitProposalDeploymentDecision) {
    violations.push(closureViolation('baseline_closure_target_missing', proposalRel,
      `on-touch-v1 的部署结论必须来自当前 proposal，实际来源=${deploymentDecision.deployment_decision_source}`,
      '在当前 proposal「部署影响」中同时明确「是否需要部署」与「是否需要 smoke」；不得用 tasks、模块默认或 legacy fallback 代替'));
  } else if (strictDeploymentRequired === null || strictSmokeRequired === null) {
    violations.push(closureViolation('baseline_closure_target_missing', proposalRel,
      'on-touch-v1 要求 proposal 同时明确「是否需要部署」与「是否需要 smoke」',
      '在 proposal「部署影响」中把两个字段明确为是/否，再让 deployment/smoke targets 与之对账'));
  } else if (!strictDeploymentRequired && strictSmokeRequired) {
    violations.push(closureViolation('baseline_closure_target_missing', proposalRel,
      'proposal 声明无需部署但需要 smoke，部署决策自身不一致',
      '修正部署影响：无需部署时 smoke 必须为否；需要发布后 smoke 时部署必须为是'));
  }
  const dispositionMatches = (
    scenario: string,
    category: 'deployment' | 'smoke',
    required: boolean | null,
  ): void => {
    if (required === null) return;
    const dispositions = plan.targets.filter(target => target.category === category && target.scenarioIds.includes(scenario));
    const material = dispositions.some(target => target.mode === 'MODIFY' || target.mode === 'CREATE');
    const skipOnly = dispositions.length > 0 && dispositions.every(target => target.mode === 'SKIP');
    if ((required && !material) || (!required && !skipOnly)) {
      violations.push(closureViolation('baseline_closure_target_missing', proposalRel,
        `${scenario} 的 ${category} disposition 与 proposal 决策不一致：决策=${required ? '需要' : '不需要'}，targets=${dispositions.map(d => d.mode).join('/') || '缺失'}`,
        required
          ? `为 ${scenario} 增加 ${category} MODIFY/CREATE 物质目标`
          : `为 ${scenario} 仅保留带 evidence 的 ${category} SKIP，不得产生物质 delta`));
    }
  };
  for (const scenario of plan.touchedScenarioIds) {
    dispositionMatches(scenario, 'deployment', strictDeploymentRequired);
    dispositionMatches(scenario, 'smoke', strictSmokeRequired);
  }

  // plan 时核对磁盘事实；apply 完成后 CREATE 的最终事实必须已存在，避免 post-merge 自身假失败。
  for (const target of planMaterial) {
    const exists = existsSync(join(root, target.targetPath!));
    const expected = specMerged ? true : target.mode === 'MODIFY';
    if (exists !== expected) {
      violations.push(closureViolation('delta_target_mode_mismatch', proposalRel,
        `${target.mode} 与磁盘事实不一致：${target.targetPath} 当前${exists ? '存在' : '缺失'}`,
        specMerged
          ? 'SPEC_MERGED 后所有 MODIFY/CREATE 目标都必须存在；检查 apply 是否完整并回滚半提交'
          : `目标${exists ? '已存在，应改为 MODIFY' : '缺失，应改为 CREATE'}，并同步 proposal/task/delta`));
    }
  }

  // P == T，按成员差集而非只比数量；同 target 的 mode 也必须一致。
  for (const [key, target] of planByTarget) {
    const task = taskByTarget.get(key);
    if (!task) {
      violations.push(closureViolation('baseline_closure_target_missing', tasksRel,
        `proposal 目标 ${key} 未进入 [delta] task`,
        `新增唯一 [${target.mode}] \`${target.deltaPath}\` task，并聚合同目标全部场景`));
    } else if (task.mode !== target.mode) {
      violations.push(closureViolation('delta_target_mode_mismatch', tasksRel,
        `${key} 的 task mode=${task.mode}，proposal mode=${target.mode}`,
        `把 task mode 改为 ${target.mode}，不得以 task 覆盖 proposal 权威计划`));
    }
  }
  for (const [key, task] of taskByTarget) {
    if (!planByTarget.has(key)) {
      violations.push(closureViolation('delta_target_unplanned', tasksRel,
        `[delta] task ${key} 不在 proposal targets`,
        `删除未规划 task，或先在 proposal baseline_closure.targets 声明 ${task.mode} 目标并补证据`));
    }
  }

  const actual: Array<{ entry: DeltaEntryClassification; resolution: CanonicalTargetResolution }> = [];
  for (const entry of deltaEntries) {
    if (!(entry.mergeDisposition === 'mergeable' && entry.lintValidity === 'valid')) continue;
    const resolution = resolveCanonicalMergeTarget(root, proposalDir, entry.relativePath);
    if (resolution) actual.push({ entry, resolution });
  }
  addDuplicateViolations(actual.map(a => ({
    canonicalTargetPath: a.resolution.canonicalTargetPath,
    sourcePath: `logos/changes/${slug}/${a.entry.relativePath}`,
  })), violations);
  const actualByTarget = new Map(actual.map(a => [a.resolution.canonicalTargetPath, a]));

  // 未勾 task 或尚缺任一实际文件仍属 plan；全部 task 勾选且 D 齐才进入 spec。
  const stage: 'plan' | 'spec' = parsedTasks.targets.length > 0
    && parsedTasks.targets.every(t => t.checked) ? 'spec' : 'plan';
  if (stage === 'spec') {
    for (const [key] of taskByTarget) {
      if (!actualByTarget.has(key)) {
        violations.push(closureViolation('delta_target_unplanned', tasksRel,
          `已完成 task ${key} 缺少实际 delta`, '写入该目标唯一 delta，或把尚未完成的 task 恢复为未勾选'));
      }
    }
  }
  for (const [key, item] of actualByTarget) {
    if (!taskByTarget.has(key) || !planByTarget.has(key)) {
      violations.push(closureViolation('delta_target_unplanned', `logos/changes/${slug}/${item.entry.relativePath}`,
        `实际 delta ${key} 未同时出现在 proposal 与 tasks`,
        '删除未规划 delta；如确属变更范围，先在 proposal 声明并新增唯一 task'));
    }
  }

  // 已出现的 actual delta 即刻做协议检查；CREATE 最低完整度在 spec 阶段强制。
  for (const [key, item] of actualByTarget) {
    const target = planByTarget.get(key);
    if (!target) continue;
    const content = deltaContents.get(item.entry.relativePath) ?? '';
    const ext = posix.extname(item.entry.relativePath).toLowerCase();
    const nonMarkdown = (target.category === 'api' && ['.yaml', '.yml', '.json'].includes(ext))
      || (target.category === 'database' && ext === '.sql');
    const prototypeAsset = target.category === 'feature'
      && key.startsWith('logos/resources/prd/2-product-design/2-page-design/')
      && ['.html', '.css', '.svg'].includes(ext);
    if (nonMarkdown) {
      const checked = validateAndStripNonMarkdownDelta(content, target.mode as 'MODIFY' | 'CREATE', key, { root });
      if (!checked.ok) {
        violations.push(closureViolation('non_markdown_delta_invalid', `logos/changes/${slug}/${item.entry.relativePath}`,
          checked.message ?? 'non-Markdown delta 无效',
          '按精确首行协议声明 canonical target；只剥离首行后对 OpenAPI/SQL payload 做严格解析/执行预检'));
      }
    } else if (prototypeAsset) {
      if (content.trim() === '') {
        violations.push(closureViolation('create_target_incomplete', `logos/changes/${slug}/${item.entry.relativePath}`,
          'prototype CREATE payload 为空', '写入经 UI provenance 校验的非空原型资产'));
      }
    } else if (target.mode === 'CREATE') {
      const missing = createCompletenessProblems(target.category, content);
      if (missing.length > 0) {
        violations.push(closureViolation('create_target_incomplete', `logos/changes/${slug}/${item.entry.relativePath}`,
          `${target.category} CREATE 缺最低完整度字段：${missing.join('、')}`,
          '补成可独立合并的最终态全量文档，不得只追加补充段、TODO 或模板骨架'));
      }
    }
  }

  const counts = (mode: BaselineClosureMode) => plan.targets.filter(t => t.mode === mode).length;
  const summary: BaselineClosureSummary = {
    policy: BASELINE_CLOSURE_POLICY,
    stage,
    touched_scenarios: plan.touchedScenarioIds.length,
    targets_declared: plan.targets.length,
    targets_total: plan.targets.length,
    modify: counts('MODIFY'), create: counts('CREATE'), skip: counts('SKIP'), ambiguous: counts('AMBIGUOUS'),
    planned_delta_targets: planMaterial.length,
    actual_delta_targets: actualByTarget.size,
  };
  violations.sort((a, b) => a.path !== b.path ? a.path.localeCompare(b.path, 'en')
    : a.code !== b.code ? a.code.localeCompare(b.code, 'en') : a.message.localeCompare(b.message, 'zh'));
  return { active: true, plan, summary, violations };
}

/** Effective view：目标不存在视为空；当前 change 同目标必须唯一，否则不定义 last-wins。 */
export function effectiveTargetView(
  root: string,
  target: BaselineClosureTarget,
  deltaContents: Map<string, string>,
): { ok: true; mergedBytes: string | null; deltaBytes: string | null } | { ok: false; reason: string } {
  const locked = withRecoveredReadLocks(root, new Date().toISOString(), listBaselineSeedModuleIds(root),
    () => effectiveTargetViewLocked(root, target, deltaContents));
  if (!locked.ok) throw new BaselineCommitInProgressError();
  return locked.value;
}

function effectiveTargetViewLocked(
  root: string,
  target: BaselineClosureTarget,
  deltaContents: Map<string, string>,
): { ok: true; mergedBytes: string | null; deltaBytes: string | null } | { ok: false; reason: string } {
  if (!target.targetPath || !target.deltaPath) return { ok: false, reason: 'SKIP/AMBIGUOUS 无 effective target view' };
  let mergedBytes: string | null = null;
  const abs = join(root, target.targetPath);
  if (existsSync(abs)) {
    try { mergedBytes = readFileSync(abs, 'utf-8'); } catch { return { ok: false, reason: `无法读取 ${target.targetPath}` }; }
  }
  return { ok: true, mergedBytes, deltaBytes: deltaContents.get(target.deltaPath) ?? null };
}

/** EvidenceScanner 只采信已合并 resources；显式排除 baseline-seed run staging/resolved/backup。 */
export function scanCommittedEvidenceFiles(root: string, paths: string[]): string[] {
  const locked = withRecoveredReadLocks(root, new Date().toISOString(), listBaselineSeedModuleIds(root),
    () => scanCommittedEvidenceFilesLocked(root, paths));
  if (!locked.ok) throw new BaselineCommitInProgressError();
  return locked.value;
}

function scanCommittedEvidenceFilesLocked(root: string, paths: string[]): string[] {
  const resources = join(root, 'logos', 'resources');
  let realResources: string;
  try { realResources = realpathSync(resources); } catch { return []; }
  return paths.map(p => p.replace(/\\/g, '/')).filter(p => {
    if (p.includes('/baseline-seed-runs/') || /\/(?:staging|resolved|backup)\//.test(`/${p}`)) return false;
    const abs = join(root, ...p.split('/'));
    if (!existsSync(abs)) return false;
    try { return contained(realpathSync(abs), realResources); } catch { return false; }
  }).sort();
}

/** 供测试/诊断显示 root 相对位置。 */
export function projectRelativePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}
