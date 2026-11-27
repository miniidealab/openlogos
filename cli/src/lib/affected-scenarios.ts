/**
 * layered-verification：proposal「受影响场景」段的唯一读取入口与可用性判定（功能规格 §2.109.4）。
 *
 * verify（分层开启时计算受影响用例与扩大规则）与 change-lint（结构检查）消费同一个判定——
 * lint 报告为违规的声明，verify 一律按扩大处理，不会出现「lint 通过但 verify 读不懂」。
 *
 * 本段是**非 canonical 段**：不进 `PLAN_SECTION_REGISTRY`，缺段不影响 Plan Package 判定。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const AFFECTED_SCENARIOS_SECTION_TITLES = ['受影响场景', 'Affected Scenarios'] as const;
export const AFFECTED_SCENARIOS_SCHEMA = 'openlogos/affected-scenarios@1';

export type AffectedDeclarationStatus = 'usable' | 'missing' | 'invalid' | 'unknown' | 'scenario_unknown';

export interface AffectedScenarioItem { id: string; reason: string }

export interface AffectedDeclaration {
  status: AffectedDeclarationStatus;
  /** 段标题的 1 基行号；段不在场时为 null。 */
  line: number | null;
  /** 结构问题（status 为 invalid 时非空）；每条是可直接展示的一句话。 */
  problems: string[];
  /** 声明中不存在的场景编号（status 为 scenario_unknown 时非空；其他状态下也如实给出）。 */
  unknownScenarioIds: string[];
  /** `assessment` 原值（字符串时）；否则为 null。 */
  assessment: string | null;
  /**
   * 共享标志：YAML 可解析且 `shared_change` 是布尔 true。不论 status 如何都独立采信（只扩大不缩小）。
   */
  sharedChange: boolean;
  /**
   * 已识别场景：`scenarios` 中结构合法（编号形态、理由非空）且场景存在的项，去重、保持出现序。
   * 不论 status 如何都独立采信。
   */
  recognized: AffectedScenarioItem[];
}

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
export const SCENARIO_ID_RE = /^S\d+$/;
const SCENARIO_IN_FILENAME_RE = /-(S\d+)-/;

const SCENARIO_DOC_DIR = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const TEST_DOC_DIR = 'logos/resources/test';
const DELTA_SCENARIO_DIR = 'deltas/prd/3-technical-plan/2-scenario-implementation';
const DELTA_TEST_DIR = 'deltas/test';

/** 文件名中的场景编号（`<module>-SXX-…`）；没有时为 null。 */
export function scenarioIdOfFile(filePath: string): string | null {
  const m = SCENARIO_IN_FILENAME_RE.exec(basename(filePath));
  return m ? m[1] : null;
}

function listMarkdown(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { recursive }).map(f => String(f).split('\\').join('/')).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/** 本提案 delta 触及的场景（deltas 下场景文档与测试用例文档文件名中的场景编号），字典序。 */
export function deltaTouchedScenarioIds(proposalDir: string): string[] {
  const ids = new Set<string>();
  for (const file of listMarkdown(join(proposalDir, DELTA_SCENARIO_DIR), false)) {
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  for (const file of listMarkdown(join(proposalDir, DELTA_TEST_DIR), false)) {
    if (!file.endsWith('-test-cases.md')) continue;
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  return Array.from(ids).sort();
}

/**
 * 存在的场景编号：已合并资源中有该编号的场景文档或测试用例文档，或本提案 delta 中有该编号的同类文件。
 */
export function knownScenarioIds(root: string, proposalDir: string | null): Set<string> {
  const ids = new Set<string>();
  for (const file of listMarkdown(join(root, SCENARIO_DOC_DIR), false)) {
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  for (const file of listMarkdown(join(root, TEST_DOC_DIR), false)) {
    if (!file.endsWith('-test-cases.md')) continue;
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  if (proposalDir) for (const id of deltaTouchedScenarioIds(proposalDir)) ids.add(id);
  return ids;
}

interface SectionBody { line: number; yamlText: string | null }

/** 定位「受影响场景」段并取出其中第一个 fenced 代码块的正文。 */
function locateSection(content: string): SectionBody | null {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = HEADING_RE.exec(line);
    if (!h) continue;
    if (start < 0) {
      if (h[1].length === 2 && (AFFECTED_SCENARIOS_SECTION_TITLES as readonly string[]).includes(h[2].trim())) start = i;
    } else if (h[1].length <= 2) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;
  let open = -1;
  for (let i = start + 1; i < end; i++) {
    if (!FENCE_RE.test(lines[i])) continue;
    if (open < 0) { open = i; continue; }
    return { line: start + 1, yamlText: lines.slice(open + 1, i).join('\n') };
  }
  return { line: start + 1, yamlText: null };
}

/**
 * 解析 proposal 全文中的「受影响场景」段并判定可用性。
 * `known`：存在的场景编号集合（见 knownScenarioIds）。
 */
export function parseAffectedDeclaration(content: string, known: ReadonlySet<string>): AffectedDeclaration {
  const base: AffectedDeclaration = {
    status: 'missing', line: null, problems: [], unknownScenarioIds: [], assessment: null, sharedChange: false, recognized: [],
  };
  const section = locateSection(content);
  if (!section) return base;
  const out: AffectedDeclaration = { ...base, status: 'invalid', line: section.line };
  if (section.yamlText === null) {
    out.problems.push('段内没有 fenced YAML 代码块');
    return out;
  }
  let doc: unknown;
  try {
    doc = parseYaml(section.yamlText);
  } catch (error) {
    out.problems.push(`YAML 无法解析：${(error as Error).message.split('\n')[0]}`);
    return out;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    out.problems.push('YAML 顶层不是对象');
    return out;
  }
  const record = doc as Record<string, unknown>;
  // 共享标志与已识别场景：能读出就独立采信
  out.sharedChange = record.shared_change === true;
  if (record.schema !== AFFECTED_SCENARIOS_SCHEMA) out.problems.push(`schema 必须为 ${AFFECTED_SCENARIOS_SCHEMA}`);
  if (typeof record.assessment === 'string') out.assessment = record.assessment;
  if (record.assessment === 'pending') out.problems.push('assessment 仍为脚手架占位 pending，尚未评估');
  else if (record.assessment !== 'assessed' && record.assessment !== 'unknown') out.problems.push('assessment 必须为 assessed 或 unknown');
  if (typeof record.shared_change !== 'boolean') out.problems.push('shared_change 必须为布尔值');
  const seen = new Set<string>();
  const unknown: string[] = [];
  if (!Array.isArray(record.scenarios)) {
    out.problems.push('scenarios 必须为数组');
  } else {
    record.scenarios.forEach((raw, index) => {
      const where = `scenarios[${index}]`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { out.problems.push(`${where} 必须是含 id 与 reason 的对象`); return; }
      const item = raw as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
      let itemOk = true;
      if (!SCENARIO_ID_RE.test(id)) { out.problems.push(`${where}.id 不是场景编号（形如 S13）`); itemOk = false; }
      if (!reason) { out.problems.push(`${where}${id ? `（${id}）` : ''} 的 reason 为空`); itemOk = false; }
      if (itemOk && seen.has(id)) { out.problems.push(`场景编号 ${id} 重复`); itemOk = false; }
      if (!itemOk) return;
      seen.add(id);
      if (!known.has(id)) { unknown.push(id); return; }
      out.recognized.push({ id, reason });
    });
  }
  out.unknownScenarioIds = unknown;
  if (out.problems.length > 0) { out.status = 'invalid'; return out; }
  if (unknown.length > 0) { out.status = 'scenario_unknown'; return out; }
  out.status = record.assessment === 'unknown' ? 'unknown' : 'usable';
  return out;
}

/** 读取提案目录中 proposal.md 的「受影响场景」声明。proposal 不可读时按 missing。 */
export function readAffectedDeclaration(root: string, proposalDir: string): AffectedDeclaration {
  let content = '';
  try { content = readFileSync(join(proposalDir, 'proposal.md'), 'utf-8'); } catch { /* 按缺段 */ }
  return parseAffectedDeclaration(content, knownScenarioIds(root, proposalDir));
}
