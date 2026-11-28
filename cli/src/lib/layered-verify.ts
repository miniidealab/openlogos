/**
 * layered-verification：提案级验收的三层集合与扩大规则（功能规格 §2.109.5～§2.109.8）。
 *
 * 只读计算，单一事实源：verify 与切片状态派生共用这一份结果，不各自再算受影响用例。
 *   P = C ∪ A ∪ MP
 *   - C  本提案用例：经校验的测试变更集中的 UT/ST；
 *   - A  受影响用例：受影响场景 AS（声明中的已识别场景 ∪ 本提案 delta 触及的场景）的全部自动化 UT/ST；
 *   - MP 主链路用例：全部测试用例文档主链路小节的并集。
 * 扩大规则只扩大不缩小：全量（第 1 级）或按模块（第 2 级）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NormalizedLayeredConfig } from './verify-config.js';
import {
  SHARED_VERIFY_CONFIG_PATHS, compareSharedVerifyConfig, globToRegExp, sharedConfigOrder, moduleIdsOf, resolveProposalChangedFiles, testFileModule,
  type GitRunner, type VerifyScopeData,
} from './verify-scope.js';
import { classifyRootRelativePath } from './impact-classify.js';
import { readStrictSkipSet } from './verify-skip-classification.js';
import { deltaTouchedScenarioIds, readAffectedDeclaration, scenarioIdOfFile, type AffectedDeclarationStatus } from './affected-scenarios.js';
import { readMainPathSet, type MainPathProblemCode } from './main-path.js';
import { MANUAL_MARKER_RE, TABLE_CELL_ID_RE } from './test-id.js';

export type LayeredExpansionLevel = 'none' | 'module' | 'full';
export type LayeredExpansionCode =
  | 'no_active_change' | 'base_ref_unavailable' | 'shared_path_changed' | 'shared_change_declared'
  | 'declaration_missing' | 'declaration_invalid' | 'assessment_unknown' | 'scenario_unknown'
  | 'module_scope_unavailable';
export type LayeredScenarioSource = 'declared' | 'delta';

export interface LayeredIdSet { count: number; ids: string[] }

/** verify JSON `data.layers`（spec/cli-json-output.md「verify 分层验收与发布级验收」）。 */
export interface VerifyLayersData {
  changed: LayeredIdSet;
  affected: LayeredIdSet & { scenarios: Array<{ id: string; sources: LayeredScenarioSource[] }> };
  main_path: LayeredIdSet & {
    limit: number;
    problems: Array<{ file: string; id: string | null; code: MainPathProblemCode }>;
    flaky_ids: string[];
  };
  total: LayeredIdSet;
  execution: LayeredIdSet;
  declaration: { status: AffectedDeclarationStatus | 'none'; detail: string | null };
  expansion: { level: LayeredExpansionLevel; reasons: Array<{ code: LayeredExpansionCode; detail: string }> };
  outside_result_count: number;
}

export interface LayeredPlan {
  /** 输出用数据；`execution`、`main_path.flaky_ids`、`outside_result_count` 由 verify 在执行后回填。 */
  layers: VerifyLayersData;
  /** 提案集合 P（字典序）。 */
  total: string[];
  /** P 是否小于全量（扩大级别不是 full）。 */
  narrowed: boolean;
  /**
   * 启用了按模块限定范围（或 --all）时，本次要执行命令组的模块（按模块登记顺序）；未启用时为 null。
   */
  commandModules: string[] | null;
  /** 主链路门禁（执行预跑命令之前）：结构错误优先于超限；都没有时为 null。 */
  mainPathBlock: 'main_path_invalid' | 'main_path_over_limit' | null;
}

export interface LayeredPlanInput {
  root: string;
  config: NormalizedLayeredConfig;
  /** 全部不带 `[manual]` 的已定义用例（verify 的已定义集合全集）。 */
  definedIds: readonly string[];
  /** §2.96 的计算结果；未启用按模块限定范围时为 null。 */
  scope: VerifyScopeData | null;
  /** §2.96 的范围内用例集 S = D_M ∪ C；scope.mode 不是 module 时为 null。 */
  scopeInScope: ReadonlySet<string> | null;
  git?: GitRunner;
}

const TEST_CASES_DIR = 'logos/resources/test';
const AUTOMATED_RE = /^(UT|ST)-/;

interface TestDoc { file: string; scenario: string | null; module: string | null; ids: string[] }

/** 测试用例文档索引：每个文档的场景编号、所属模块与其中的自动化 UT/ST（限已定义集合内）。 */
function indexTestDocs(root: string, defined: ReadonlySet<string>, moduleIds: string[]): TestDoc[] {
  const dir = join(root, TEST_CASES_DIR);
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir, { recursive: true }).map(f => String(f).split('\\').join('/')).filter(f => f.endsWith('-test-cases.md')).sort();
  } catch {
    return [];
  }
  const docs: TestDoc[] = [];
  for (const file of files) {
    let content: string;
    try { content = readFileSync(join(dir, file), 'utf-8'); } catch { continue; }
    const ids = new Set<string>();
    for (const line of content.split('\n')) {
      if (!line.trim().startsWith('|')) continue;
      const firstCell = (line.split('|').map(cell => cell.trim())[1]) ?? '';
      if (!TABLE_CELL_ID_RE.test(firstCell)) continue;
      const id = firstCell.replace(MANUAL_MARKER_RE, '').replace(/\s+/g, ' ').trim();
      if (AUTOMATED_RE.test(id) && defined.has(id)) ids.add(id);
    }
    docs.push({ file, scenario: scenarioIdOfFile(file), module: testFileModule(file, moduleIds), ids: Array.from(ids) });
  }
  return docs;
}

const idSet = (ids: Iterable<string>): LayeredIdSet => {
  const sorted = Array.from(new Set(ids)).sort();
  return { count: sorted.length, ids: sorted };
};

/** 计算分层验收的三层集合、扩大级别与本次命令组（只读）。 */
export function computeLayeredPlan(input: LayeredPlanInput): LayeredPlan {
  const { root, config, scope, scopeInScope } = input;
  const defined = new Set(input.definedIds);
  const moduleIds = moduleIdsOf(root);
  const docs = indexTestDocs(root, defined, moduleIds);
  const reasons: Array<{ code: LayeredExpansionCode; detail: string }> = [];

  // —— 主链路 MP（没有活跃提案时照常读取与检查）
  const mainPathRead = readMainPathSet(root);
  const mainPathIds = mainPathRead.ids.filter(id => defined.has(id));
  const problems = mainPathRead.problems.map(p => ({ file: p.file, id: p.id, code: p.code }));

  // —— 第 1 级：全量
  const base = resolveProposalChangedFiles(root, input.git);
  const hasProposal = base.ok || base.code !== 'no_active_change';
  if (!hasProposal) reasons.push({ code: 'no_active_change', detail: '没有活跃提案' });
  else if (!base.ok) reasons.push({ code: 'base_ref_unavailable', detail: `${base.code}：${base.detail}` });
  else {
    const sharedRes = config.sharedPaths.map(globToRegExp);
    // 共享路径命中按路径点名；两个共享验收配置文件按字段判断（§2.96.3.1，与模块范围同一判断），
    // 被 shared_paths 显式列出时改按路径命中。配置文件未命中只是 detail 中没有它，不影响其他文件的原因。
    const hits: Array<{ file: string; detail: string }> = [];
    for (const file of base.files) {
      if (classifyRootRelativePath(file) === 'lifecycle') continue;
      if (sharedRes.some(re => re.test(file))) { hits.push({ file, detail: file }); continue; }
      if (!SHARED_VERIFY_CONFIG_PATHS.includes(file)) continue;
      const verdict = compareSharedVerifyConfig(root, base.baseRef, file, input.git);
      if (verdict.kind === 'related') hits.push({ file, detail: verdict.detail });
    }
    if (hits.length > 0) {
      // 先按规定顺序列出命中的两份共享验收配置（logos.config.json 在前），再按路径顺序列出其余共享文件。
      // 两条规则不能混在同一个比较函数里：夹在两份配置的路径之间的文件（如 logos/logos-shared/…）会让先后关系不一致。
      const isConfig = (file: string) => SHARED_VERIFY_CONFIG_PATHS.includes(file);
      const configs = hits.filter(h => isConfig(h.file)).sort((a, b) => sharedConfigOrder(a.file) - sharedConfigOrder(b.file));
      const others = hits.filter(h => !isConfig(h.file)).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
      reasons.push({ code: 'shared_path_changed', detail: [...configs, ...others].map(h => h.detail).join('、') });
    }
  }

  // —— 声明、受影响场景 AS、本提案用例 C
  const proposalDir = hasProposal ? base.proposalDir : null;
  const declaration = proposalDir ? readAffectedDeclaration(root, proposalDir) : null;
  const sources = new Map<string, Set<LayeredScenarioSource>>();
  const addSource = (id: string, source: LayeredScenarioSource) => {
    if (!sources.has(id)) sources.set(id, new Set());
    sources.get(id)!.add(source);
  };
  for (const item of declaration?.recognized ?? []) addSource(item.id, 'declared');
  for (const id of proposalDir ? deltaTouchedScenarioIds(proposalDir) : []) addSource(id, 'delta');
  const scenarios = Array.from(sources.keys())
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)) || a.localeCompare(b))
    .map(id => ({ id, sources: (['declared', 'delta'] as const).filter(s => sources.get(id)!.has(s)) }));
  const scenarioCases = docs.filter(doc => doc.scenario !== null && sources.has(doc.scenario)).flatMap(doc => doc.ids);

  const changedIds = hasProposal ? Array.from(readStrictSkipSet(root).ids).filter(id => defined.has(id)) : [];

  if (declaration?.sharedChange) reasons.push({ code: 'shared_change_declared', detail: '提案声明 shared_change: true' });
  const fullByLevelOne = reasons.length > 0;

  // —— 第 2 级：按模块
  let declarationDetail: string | null = null;
  let moduleLevel = false;
  if (declaration) {
    if (declaration.status === 'missing') {
      moduleLevel = true;
      reasons.push({ code: 'declaration_missing', detail: '提案没有「受影响场景」段' });
    } else if (declaration.status === 'invalid') {
      moduleLevel = true;
      declarationDetail = declaration.problems.join('；');
      reasons.push({ code: 'declaration_invalid', detail: declarationDetail });
    } else if (declaration.status === 'unknown') {
      moduleLevel = true;
      reasons.push({ code: 'assessment_unknown', detail: '提案声明 assessment: unknown' });
    } else if (declaration.status === 'scenario_unknown') {
      moduleLevel = true;
      declarationDetail = `不存在的场景：${declaration.unknownScenarioIds.join('、')}`;
      reasons.push({ code: 'scenario_unknown', detail: declarationDetail });
    }
  }
  const moduleScopeUsable = scope !== null && scope.mode === 'module' && scopeInScope !== null;
  let level: LayeredExpansionLevel = 'none';
  if (fullByLevelOne) level = 'full';
  else if (moduleLevel) {
    if (moduleScopeUsable) level = 'module';
    else {
      level = 'full';
      reasons.push({
        code: 'module_scope_unavailable',
        detail: scope === null ? '按模块限定范围未启用' : `按模块限定范围为 ${scope.mode}${scope.fallback_reason ? `（${scope.fallback_reason.code}）` : ''}`,
      });
    }
  }

  // —— 集合
  let affectedIds: string[];
  let totalIds: string[];
  if (level === 'full') {
    affectedIds = [...input.definedIds];
    totalIds = [...input.definedIds];
  } else {
    affectedIds = level === 'module'
      ? [...input.definedIds.filter(id => scopeInScope!.has(id) && AUTOMATED_RE.test(id)), ...scenarioCases]
      : scenarioCases;
    totalIds = [...changedIds, ...affectedIds, ...mainPathIds];
  }
  const total = idSet(totalIds);

  // —— 命令组（§2.109.8）：只在启用了按模块限定范围或 --all 时区分
  let commandModules: string[] | null = null;
  if (scope !== null) {
    if (level === 'full' || scope.mode === 'all') commandModules = [...moduleIds];
    else {
      const wanted = new Set<string>(level === 'module' ? scope.modules : []);
      let global = false;
      const totalSet = new Set(total.ids);
      const mainPathSet = new Set(mainPathIds);
      for (const doc of docs) {
        // none：P 中用例所属模块；module：范围 M 之外只再取 MP 与 AS 中用例所属模块
        const relevant = level === 'none'
          ? doc.ids.some(id => totalSet.has(id))
          : doc.ids.some(id => mainPathSet.has(id)) || (doc.scenario !== null && sources.has(doc.scenario) && doc.ids.length > 0);
        if (!relevant) continue;
        if (doc.module === null) global = true;
        else wanted.add(doc.module);
      }
      commandModules = global ? [...moduleIds] : moduleIds.filter(id => wanted.has(id));
    }
  }

  const mainPathBlock = problems.length > 0 ? 'main_path_invalid' as const
    : mainPathIds.length > config.mainPathMax ? 'main_path_over_limit' as const : null;

  return {
    layers: {
      changed: idSet(changedIds),
      affected: { ...idSet(affectedIds), scenarios },
      main_path: { ...idSet(mainPathIds), limit: config.mainPathMax, problems, flaky_ids: [] },
      total,
      execution: { count: total.count, ids: [...total.ids] },
      declaration: { status: declaration ? declaration.status : 'none', detail: declarationDetail },
      expansion: { level, reasons },
      outside_result_count: 0,
    },
    total: total.ids,
    narrowed: level !== 'full',
    commandModules,
    mainPathBlock,
  };
}

export const LAYERED_LEVEL_LABEL = '提案级（分层）/ proposal (layered)';
export const LAYERED_NOT_RELEASE_NOTE = '提案级通过不等于可以发布；发布前须有该提交的发布级全量结论 / A proposal-level pass does not mean the product can be released; a release-level full run for this commit is required before release';

/** 验收报告「验收范围 / Verification Scope」小节（§2.109.13）；不含命令输出。 */
export function renderLayeredScopeSection(layers: VerifyLayersData, gateReason: string | null): string {
  const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  let md = '## 验收范围 / Verification Scope\n\n';
  md += '| 层 / Layer | 用例数 / Cases |\n|---|---|\n';
  md += `| 本提案用例 / Changed | ${layers.changed.count} |\n`;
  md += `| 受影响用例 / Affected | ${layers.affected.count} |\n`;
  md += `| 主链路用例 / Main path | ${layers.main_path.count}（上限 / limit ${layers.main_path.limit}） |\n`;
  md += `| 合计（提案集合）/ Total | ${layers.total.count} |\n`;
  md += `| 本次执行集合 / Execution | ${layers.execution.count} |\n\n`;
  const scenarios = layers.affected.scenarios.map(s => `${s.id}（${s.sources.join('、')}）`).join('、');
  md += `- 受影响场景 / Affected scenarios：${scenarios || '无 / none'}\n`;
  md += `- 声明状态 / Declaration：\`${layers.declaration.status}\`${layers.declaration.detail ? ` — ${cell(layers.declaration.detail)}` : ''}\n`;
  md += `- 扩大级别 / Expansion：\`${layers.expansion.level}\`\n`;
  for (const reason of layers.expansion.reasons) md += `  - \`${reason.code}\`：${cell(reason.detail)}\n`;
  md += `- 集合外结果行数 / Results outside the set：${layers.outside_result_count}\n\n`;
  if (gateReason === 'main_path_invalid') {
    md += '### 主链路小节结构错误 / Main Path Section Invalid\n\n- Reason: `main_path_invalid`；本次未执行任何预跑命令 / no pre-run command was executed\n';
    for (const p of layers.main_path.problems) md += `- ${p.file}：\`${p.code}\`${p.id ? `（${p.id}）` : ''}\n`;
    md += '\n';
  } else if (gateReason === 'main_path_over_limit') {
    md += '### 主链路超过上限 / Main Path Over Limit\n\n- Reason: `main_path_over_limit`；本次未执行任何预跑命令 / no pre-run command was executed\n';
    md += `- 上限 / limit：${layers.main_path.limit}；实际 / actual：${layers.main_path.count}\n\n`;
  } else if (layers.main_path.problems.length > 0 || layers.main_path.count > layers.main_path.limit) {
    md += '### 主链路约束 / Main Path Constraints\n\n';
    for (const p of layers.main_path.problems) md += `- ${p.file}：\`${p.code}\`${p.id ? `（${p.id}）` : ''}\n`;
    if (layers.main_path.count > layers.main_path.limit) md += `- 上限 / limit：${layers.main_path.limit}；实际 / actual：${layers.main_path.count}\n`;
    md += '\n';
  }
  if (layers.main_path.flaky_ids.length > 0) {
    md += '### 主链路用例偶发 / Flaky Main Path Cases\n\n';
    md += `- \`main_path_flaky\`：${layers.main_path.flaky_ids.join('、')}\n`;
    md += '- 主链路用例不得依赖复跑通过：修复该用例，或把它移出主链路 / main path cases must not rely on reruns: fix the case or remove it from the main path\n\n';
  }
  md += `> ${LAYERED_NOT_RELEASE_NOTE}\n\n`;
  return md;
}
