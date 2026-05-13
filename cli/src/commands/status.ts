import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, PHASE_KEYS, SUGGEST_KEYS } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { parse as parseYaml } from 'yaml';

export type ProposalStep =
  | 'writing'
  | 'delta-writing'
  | 'ready-to-merge'
  | 'merge-generated'
  | 'coding'
  | 'ready-to-verify'
  | 'verify-passed'
  | 'verify-failed'
  | 'implementing'
  | 'in-progress';

interface PhaseStatus {
  key: string;
  label: string;
  path: string;
  done: boolean;
  skipped: boolean;
  files: string[];
}

interface ProposalInfo {
  name: string;
  hasProposal: boolean;
  hasTasks: boolean;
  deltaCount: number;
}

export interface ModuleInfo {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
  skip_phases?: string[];
}

interface ScenarioCoverage {
  total: number;
  covered: number;
  missing: string[];
}

interface PhaseProgressItem {
  done: boolean;
  skipped: boolean;
  scenario_coverage?: ScenarioCoverage;
}

export interface ModuleStatusItem {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
  current_phase: string | null;
  current_phase_label: string | null;
  phase_progress: Record<string, PhaseProgressItem> | null;
  active_change: {
    slug: string;
    proposal_step: ProposalStep;
    proposal_step_label: string;
    has_proposal: boolean;
    has_tasks: boolean;
    tasks_checked: number;
    tasks_total: number;
    delta_count: number;
  } | null;
  suggestion: string;
}

export interface StatusData {
  phases: Array<{ key: string; label: string; done: boolean; skipped: boolean; files: string[] }>;
  modules?: ModuleStatusItem[];
  active_proposals: Array<{
    name: string;
    has_proposal: boolean;
    has_tasks: boolean;
    delta_count: number;
  }>;
  current_phase: string | null;
  suggestion: string;
  all_done: boolean;
  lifecycle: string;
  locale: string;
  source_roots: { src: string[]; test: string[] } | null;
  active_change: string | null;
  proposal_step: ProposalStep | null;
}

const MERGE_SUPPORTED_DELTA_DIRS = ['prd', 'api', 'database', 'scenario', 'test'] as const;

// Phase paths indexed by PHASE_KEYS order
const PHASE_SUBPATHS = [
  'logos/resources/prd/1-product-requirements',
  'logos/resources/prd/2-product-design',
  'logos/resources/prd/3-technical-plan/1-architecture',
  'logos/resources/prd/3-technical-plan/2-scenario-implementation',
  'logos/resources/api',
  'logos/resources/database',
  'logos/resources/test',
  'logos/resources/scenario',
  'logos/resources/implementation',
  'logos/resources/verify',
];

// Phases that require per-scenario file coverage
const SCENARIO_PHASES = new Set(['phase.3-1', 'phase.3-3a']);

function isProposalTemplateFilled(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  return normalized.includes('## 变更原因')
    && normalized.includes('## 变更类型')
    && normalized.includes('## 变更范围')
    && normalized.includes('## 变更概述')
    && !normalized.includes('[为什么要做这个变更？')
    && !normalized.includes('[需求级 / 设计级 / 接口级 / 代码级]')
    && !normalized.includes('[列表]')
    && !normalized.includes('[用 1-3 段话概述具体改什么]');
}

function isTasksTemplateFilled(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  const placeholderLines = [
    '- [ ] 更新需求文档的场景和验收条件',
    '- [ ] 更新产品设计文档的功能规格',
    '- [ ] 更新原型',
    '- [ ] 更新场景时序图',
    '- [ ] 更新 API YAML',
    '- [ ] 更新 DB DDL',
    '- [ ] 更新 API 编排测试用例',
    '- [ ] 实现代码变更',
    '- [ ] Update requirements scenarios and acceptance criteria',
    '- [ ] Update product design feature specs',
    '- [ ] Update prototypes',
    '- [ ] Update scenario sequence diagrams',
    '- [ ] Update API YAML',
    '- [ ] Update DB DDL',
    '- [ ] Update API orchestration test cases',
    '- [ ] Implement code changes',
  ];
  const lines = new Set(normalized.split(/\r?\n/).map(line => line.trim()));
  return !placeholderLines.some(line => lines.has(line));
}

function countMergeableDeltaFiles(proposalDir: string): number {
  let count = 0;
  for (const category of MERGE_SUPPORTED_DELTA_DIRS) {
    count += listFiles(join(proposalDir, 'deltas', category)).length;
  }
  return count;
}

function countTasks(content: string): { checked: number; total: number } {
  const checked = (content.match(/^- \[x\]/gim) ?? []).length;
  const unchecked = (content.match(/^- \[ \]/gm) ?? []).length;
  return { checked, total: checked + unchecked };
}

function allTasksChecked(content: string): boolean {
  const { checked, total } = countTasks(content);
  return total > 0 && checked === total;
}

/**
 * 解析 tasks.md 中的结构化 section。
 * 识别 `## [tag] ...` 格式的 section 标题，返回每个 tag 对应的 checked/total。
 * 若文件中没有任何 `## [tag]` 标记，返回 null（表示旧格式，降级为全局判断）。
 */
function parseTaskSections(content: string): Record<string, { checked: number; total: number }> | null {
  const lines = content.split(/\r?\n/);
  const sectionPattern = /^## \[([a-z][a-z0-9-]*)\]/i;
  let currentTag: string | null = null;
  let hasAnyTag = false;
  const sections: Record<string, { checked: number; total: number }> = {};

  for (const line of lines) {
    const match = line.match(sectionPattern);
    if (match) {
      currentTag = match[1].toLowerCase();
      hasAnyTag = true;
      if (!sections[currentTag]) {
        sections[currentTag] = { checked: 0, total: 0 };
      }
    } else if (currentTag) {
      if (/^- \[x\]/i.test(line)) {
        sections[currentTag].checked++;
        sections[currentTag].total++;
      } else if (/^- \[ \]/.test(line)) {
        sections[currentTag].total++;
      }
    }
  }

  return hasAnyTag ? sections : null;
}

export function detectProposalStep(proposalDir: string): ProposalStep {
  if (existsSync(join(proposalDir, 'VERIFY_PASS'))) {
    return 'verify-passed';
  }
  if (existsSync(join(proposalDir, 'VERIFY_FAIL'))) {
    return 'verify-failed';
  }
  if (existsSync(join(proposalDir, 'SPEC_MERGED')) || existsSync(join(proposalDir, 'MERGED'))) {
    // 规格已合并，判断 [code] section 是否全部完成
    const tasksContent = existsSync(join(proposalDir, 'tasks.md'))
      ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
    const sections = parseTaskSections(tasksContent);
    if (sections !== null) {
      const code = sections['code'];
      if (!code || (code.total > 0 && code.checked === code.total)) {
        // 无 [code] section 或 [code] 全勾 → 可以 verify
        return 'ready-to-verify';
      }
      return 'coding';
    }
    // 旧格式：无 section 标记，直接进入 ready-to-verify
    return 'ready-to-verify';
  }
  if (existsSync(join(proposalDir, 'MERGE_PROMPT_GENERATED')) || existsSync(join(proposalDir, 'MERGE_PROMPT.md'))) {
    return 'merge-generated';
  }
  const proposalContent = existsSync(join(proposalDir, 'proposal.md'))
    ? readFileSync(join(proposalDir, 'proposal.md'), 'utf-8') : '';
  const tasksContent = existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
  const mergeableDeltaCount = countMergeableDeltaFiles(proposalDir);

  if (!isProposalTemplateFilled(proposalContent) || !isTasksTemplateFilled(tasksContent)) {
    return 'writing';
  }

  // 结构化 section 判断
  const sections = parseTaskSections(tasksContent);
  if (sections !== null) {
    const delta = sections['delta'];
    const code = sections['code'];

    // 纯代码提案（新格式无 [delta] section）：完全跳过 merge 阶段
    if (!delta) {
      if (!code || (code.total > 0 && code.checked === code.total)) {
        return 'ready-to-verify';
      }
      return 'coding';
    }

    // 有 [delta] section：按 delta 勾选状态判断
    if (delta.total > 0 && delta.checked === delta.total) {
      return 'ready-to-merge';
    }
    return 'delta-writing';
  }

  // 旧格式降级：全局判断（向后兼容）
  if (mergeableDeltaCount > 0 && allTasksChecked(tasksContent)) {
    return 'ready-to-merge';
  }
  return 'delta-writing';
}

export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => {
        const full = join(dir, f);
        return statSync(full).isFile() && !f.endsWith('.gitkeep');
      });
  } catch {
    return [];
  }
}

// skip_phases value → PHASE_KEY mapping
const SKIP_PHASE_MAP: Record<string, string> = {
  api:      'phase.3-2-api',
  database: 'phase.3-2-db',
  scenario: 'phase.3-3b',
};

function deriveModulePhaseProgress(
  root: string,
  moduleId: string,
  scenarios: Array<{ id: string }>,
  skipPhases: string[] = [],
  isMultiModule: boolean = false,
): { progress: Record<string, PhaseProgressItem>; currentPhase: string | null } {
  const progress: Record<string, PhaseProgressItem> = {};

  // Build set of phase keys to skip from explicit skip_phases declaration
  const explicitSkip = new Set(skipPhases.map(s => SKIP_PHASE_MAP[s]).filter(Boolean));

  for (let i = 0; i < PHASE_KEYS.length; i++) {
    const key = PHASE_KEYS[i];
    const dir = join(root, PHASE_SUBPATHS[i]);

    // Explicitly skipped via skip_phases
    if (explicitSkip.has(key)) {
      progress[key] = { done: false, skipped: true };
      continue;
    }

    if (SCENARIO_PHASES.has(key)) {
      // Per-scenario coverage check
      const suffix = key === 'phase.3-1' ? '' : '-test-cases';
      const covered: string[] = [];
      const missing: string[] = [];
      for (const s of scenarios) {
        const pattern = `${moduleId}-${s.id}`;
        const files = listFiles(dir);
        const found = files.some(f => f.includes(pattern) && (suffix === '' || f.includes(suffix)));
        if (found) covered.push(s.id);
        else missing.push(s.id);
      }
      progress[key] = {
        done: missing.length === 0 && scenarios.length > 0,
        skipped: false,
        scenario_coverage: { total: scenarios.length, covered: covered.length, missing },
      };
    } else {
      // In multi-module projects, only count files with the module's prefix.
      // In single-module projects, any file in the directory counts (backward compat).
      const allFiles = listFiles(dir);
      const files = isMultiModule
        ? allFiles.filter(f => (f.split('/').pop() ?? f).startsWith(`${moduleId}-`))
        : allFiles;
      progress[key] = { done: files.length > 0, skipped: false };
    }
  }

  // Fallback: mark skipped for empty phases that appear before a done phase
  // (handles projects without skip_phases declared — backward compatibility)
  const keys = PHASE_KEYS;
  const lastDoneIdx = keys.reduce((acc, k, i) => (progress[k].done ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!progress[keys[i]].done) progress[keys[i]].skipped = true;
  }

  const currentPhase = keys.find(k => !progress[k].done && !progress[k].skipped) ?? null;
  return { progress, currentPhase };
}

function buildModuleStatusItem(
  root: string,
  mod: ModuleInfo,
  scenarios: Array<{ id: string }>,
  locale: string,
  guardActiveChange: string | null,
  guardModule: string | null,
  isMultiModule: boolean = false,
): ModuleStatusItem {
  if (mod.lifecycle === 'launched') {
    let activeChange: ModuleStatusItem['active_change'] = null;

    if (guardActiveChange && guardModule === mod.id) {
      const proposalDir = join(root, 'logos', 'changes', guardActiveChange);
      const step = existsSync(proposalDir) ? detectProposalStep(proposalDir) : 'writing';
      const stepLabel = t(locale as Parameters<typeof t>[0], `status.proposalStep.${step}`);
      const hasProposal = existsSync(join(proposalDir, 'proposal.md'));
      const hasTasksFile = existsSync(join(proposalDir, 'tasks.md'));
      const tasksContent = hasTasksFile ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
      const { checked, total } = countTasks(tasksContent);
      const deltaCount = countMergeableDeltaFiles(proposalDir);

      activeChange = {
        slug: guardActiveChange,
        proposal_step: step,
        proposal_step_label: stepLabel,
        has_proposal: hasProposal,
        has_tasks: hasTasksFile,
        tasks_checked: checked,
        tasks_total: total,
        delta_count: deltaCount,
      };
    }

    let suggestion: string;
    if (activeChange) {
      if (activeChange.proposal_step === 'ready-to-merge') {
        suggestion = locale === 'zh'
          ? `明确授权执行 openlogos merge ${activeChange.slug}`
          : `Explicitly request: openlogos merge ${activeChange.slug}`;
      } else if (activeChange.proposal_step === 'merge-generated') {
        suggestion = locale === 'zh'
          ? `让 AI 读取 logos/changes/${activeChange.slug}/MERGE_PROMPT.md 并执行规格合并；完成后写入 SPEC_MERGED`
          : `Ask AI to read logos/changes/${activeChange.slug}/MERGE_PROMPT.md and merge specs; write SPEC_MERGED when done`;
      } else if (activeChange.proposal_step === 'coding') {
        suggestion = locale === 'zh'
          ? `按已合并规格实现代码，完成后勾选 [code] section 所有任务`
          : `Implement code from merged specs, then check off all [code] section tasks`;
      } else if (activeChange.proposal_step === 'ready-to-verify') {
        suggestion = locale === 'zh'
          ? `代码已完成，明确授权执行 openlogos verify`
          : `Code is done — explicitly request: openlogos verify`;
      } else if (activeChange.proposal_step === 'verify-passed') {
        suggestion = locale === 'zh'
          ? `验收通过，明确授权执行 openlogos archive ${activeChange.slug}`
          : `Verification passed — explicitly request: openlogos archive ${activeChange.slug}`;
      } else if (activeChange.proposal_step === 'verify-failed') {
        suggestion = locale === 'zh'
          ? `验收未通过，修复问题后重新运行 openlogos verify`
          : `Verification failed — fix the issues and run openlogos verify again`;
      } else if (activeChange.proposal_step === 'delta-writing' || activeChange.proposal_step === 'implementing' || activeChange.proposal_step === 'in-progress') {
        suggestion = locale === 'zh'
          ? `继续为 ${activeChange.slug} 产出 delta 文件，完成后明确授权执行 openlogos merge ${activeChange.slug}`
          : `Continue writing delta files for ${activeChange.slug}, then explicitly request: openlogos merge ${activeChange.slug}`;
      } else {
        suggestion = locale === 'zh'
          ? `继续完善 ${activeChange.slug}`
          : `Continue working on ${activeChange.slug}`;
      }
    } else if (guardActiveChange && guardModule !== mod.id) {
      suggestion = locale === 'zh'
        ? `当前提案 ${guardActiveChange}（归属 ${guardModule ?? '?'}）未完成，请先完成后再为此模块创建新提案`
        : `Active proposal ${guardActiveChange} (module: ${guardModule ?? '?'}) is in progress — finish it before creating a new proposal for this module`;
    } else {
      suggestion = locale === 'zh'
        ? '运行 openlogos change <slug> 创建新提案'
        : 'Run openlogos change <slug> to create a new change proposal';
    }

    return {
      id: mod.id,
      name: mod.name,
      lifecycle: 'launched',
      current_phase: null,
      current_phase_label: null,
      phase_progress: null,
      active_change: activeChange,
      suggestion,
    };
  }

  // initial lifecycle
  const { progress, currentPhase } = deriveModulePhaseProgress(root, mod.id, scenarios, mod.skip_phases ?? [], isMultiModule);
  const currentPhaseLabel = currentPhase ? t(locale as Parameters<typeof t>[0], currentPhase) : null;

  let suggestion: string;
  if (!currentPhase) {
    suggestion = locale === 'zh' ? '所有阶段已完成' : 'All phases complete';
  } else {
    const suggestKey = SUGGEST_KEYS[currentPhase];
    suggestion = suggestKey
      ? t(locale as Parameters<typeof t>[0], suggestKey)
      : (locale === 'zh' ? '继续推进当前阶段' : 'Continue current phase');
  }

  return {
    id: mod.id,
    name: mod.name,
    lifecycle: 'initial',
    current_phase: currentPhase,
    current_phase_label: currentPhaseLabel,
    phase_progress: progress,
    active_change: null,
    suggestion,
  };
}

export function collectStatusData(root: string, filterModuleId?: string): StatusData {
  const configPath = join(root, 'logos', 'logos.config.json');
  const locale = readLocale(root);

  // ── Read YAML first so skip_phases is available before phase calculation ──
  let lifecycle: 'initial' | 'launched' = 'initial';
  let sourceRoots: { src: string[]; test: string[] } | null = null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    sourceRoots = config.sourceRoots ?? null;
  } catch { /* ignore */ }

  const projectYamlPath = join(root, 'logos', 'logos-project.yaml');
  let rawModules: ModuleInfo[] | undefined;
  let scenarios: Array<{ id: string; module?: string }> = [];
  // Global skip: only skip a phase if ALL initial modules declare it in skip_phases
  // (intersection, not union — one module needing a phase is enough to keep it)
  const globalSkipPhaseKeys = new Set<string>();

  if (existsSync(projectYamlPath)) {
    try {
      const yaml = parseYaml(readFileSync(projectYamlPath, 'utf-8'));
      if (Array.isArray(yaml?.modules)) {
        rawModules = (yaml.modules as Array<{ id: string; name: string; lifecycle?: string; skip_phases?: string[] }>).map(m => ({
          id: m.id,
          name: m.name,
          lifecycle: (m.lifecycle === 'launched' ? 'launched' : 'initial') as 'initial' | 'launched',
          skip_phases: Array.isArray(m.skip_phases) ? m.skip_phases : [],
        }));
        if (rawModules.some(m => m.lifecycle === 'launched')) {
          lifecycle = 'launched';
        }
        // Intersection: a phase key is globally skipped only if every initial module skips it
        const initialModules = rawModules.filter(m => m.lifecycle === 'initial');
        if (initialModules.length > 0) {
          const allSkipValues = Object.keys(SKIP_PHASE_MAP);
          for (const skipVal of allSkipValues) {
            const phaseKey = SKIP_PHASE_MAP[skipVal];
            if (initialModules.every(m => (m.skip_phases ?? []).includes(skipVal))) {
              globalSkipPhaseKeys.add(phaseKey);
            }
          }
        }
      }
      if (Array.isArray(yaml?.scenarios)) {
        scenarios = yaml.scenarios as Array<{ id: string; module?: string }>;
      }
    } catch { /* ignore */ }
  }

  // ── Build top-level phases, applying skip_phases ──
  const phasePaths = PHASE_SUBPATHS.map(p => join(root, p));

  const phases: PhaseStatus[] = PHASE_KEYS.map((key, i) => ({
    key,
    label: t(locale, key),
    path: phasePaths[i],
    done: false,
    skipped: globalSkipPhaseKeys.has(key), // pre-mark explicitly skipped phases
    files: [],
  }));

  for (const phase of phases) {
    if (phase.skipped) continue; // don't scan explicitly skipped dirs
    phase.files = listFiles(phase.path);
    phase.done = phase.files.length > 0;
  }

  // Fallback: also mark empty phases before the last done phase as skipped
  const lastDoneIdx = phases.reduce((acc, p, i) => (p.done ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!phases[i].done) phases[i].skipped = true;
  }

  // Collect active proposals
  const changesDir = join(root, 'logos', 'changes');
  const activeProposals: ProposalInfo[] = [];
  if (existsSync(changesDir)) {
    for (const entry of readdirSync(changesDir)) {
      if (entry === 'archive' || entry === '.gitkeep') continue;
      const entryPath = join(changesDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const hasProposal = existsSync(join(entryPath, 'proposal.md'));
      const hasTasks = existsSync(join(entryPath, 'tasks.md'));
      const deltaCount = existsSync(join(entryPath, 'deltas')) ? listFiles(join(entryPath, 'deltas')).length : 0;
      activeProposals.push({ name: entry, hasProposal, hasTasks, deltaCount });
    }
  }

  const firstIncomplete = phases.find(p => !p.done && !p.skipped);
  const allDone = !firstIncomplete;

  // Read guard
  let activeChange: string | null = null;
  let proposalStep: ProposalStep | null = null;
  let guardModule: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      activeChange = guard.activeChange || null;
      guardModule = guard.module || null;
      if (activeChange) {
        const proposalDir = join(root, 'logos', 'changes', activeChange);
        proposalStep = existsSync(proposalDir) ? detectProposalStep(proposalDir) : 'writing';
      }
    } catch { /* ignore */ }
  }

  // Build module status items
  let modules: ModuleStatusItem[] | undefined;
  if (rawModules !== undefined) {
    const isMultiModule = rawModules.length > 1;
    const filtered = filterModuleId
      ? rawModules.filter(m => m.id === filterModuleId)
      : rawModules;
    modules = filtered.map(m => {
      // Only pass scenarios that belong to this module (module field defaults to 'core')
      const moduleScenarios = scenarios.filter(s => (s.module ?? 'core') === m.id);
      return buildModuleStatusItem(root, m, moduleScenarios, locale, activeChange, guardModule, isMultiModule);
    });
  }

  let suggestion: string;
  if (allDone) {
    suggestion = lifecycle === 'launched'
      ? t(locale, 'status.allDoneHint').trim()
      : t(locale, 'launch.suggest');
  } else {
    const suggestKey = SUGGEST_KEYS[firstIncomplete!.key];
    suggestion = suggestKey ? t(locale, suggestKey) : t(locale, 'suggest.fallback');
  }

  return {
    phases: phases.map(p => ({ key: p.key, label: p.label, done: p.done, skipped: p.skipped, files: p.files })),
    ...(modules !== undefined ? { modules } : {}),
    active_proposals: activeProposals.map(p => ({
      name: p.name,
      has_proposal: p.hasProposal,
      has_tasks: p.hasTasks,
      delta_count: p.deltaCount,
    })),
    current_phase: firstIncomplete ? firstIncomplete.key : null,
    suggestion,
    all_done: allDone,
    lifecycle,
    locale,
    source_roots: sourceRoots,
    active_change: activeChange,
    proposal_step: proposalStep,
  };
}

export function status(format: OutputFormat = 'text', moduleId?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'status', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  // Validate --module if provided
  if (moduleId) {
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    if (existsSync(yamlPath)) {
      try {
        const yaml = parseYaml(readFileSync(yamlPath, 'utf-8'));
        const mods = Array.isArray(yaml?.modules) ? yaml.modules as Array<{ id: string }> : [];
        if (!mods.find(m => m.id === moduleId)) {
          console.error(`Error: Module '${moduleId}' not found in logos-project.yaml.`);
          console.error('Run `openlogos module list` to see available modules.');
          process.exit(1);
        }
      } catch { /* ignore */ }
    }
  }

  const data = collectStatusData(root, moduleId);

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('status', data)));
    return;
  }

  const locale = readLocale(root);
  const LINE = '─'.repeat(50);

  if (!moduleId) {
    console.log('\n📊 OpenLogos Project Status\n');
    console.log(LINE);

    for (const phase of data.phases) {
      if (phase.skipped) continue;
      const icon = phase.done ? '✅' : '🔲';
      console.log(`${icon}  ${phase.label}`);
      if (phase.done) {
        for (const f of phase.files) console.log(`     └─ ${f}`);
      }
    }
    console.log(LINE);
  }

  // Show modules
  if (data.modules && data.modules.length > 0) {
    if (!moduleId) console.log(`\n🧩 ${t(locale, 'status.modules')}`);
    for (const m of data.modules) {
      if (m.lifecycle === 'launched') {
        const ac = m.active_change;
        if (ac) {
          console.log(`  🔄  ${m.id} (${m.name})  [launched]`);
          console.log(`       ${t(locale, 'status.activeChange')}: ${ac.slug}  →  ${ac.proposal_step_label}`);
          console.log(`       tasks: ${ac.tasks_checked}/${ac.tasks_total}  deltas: ${ac.delta_count}`);
        } else {
          const blocked = data.active_change && data.active_change !== null;
          const icon = blocked ? '⏸️ ' : '✅';
          console.log(`  ${icon}  ${m.id} (${m.name})  [launched]`);
        }
      } else {
        const phase = m.current_phase ? ` → ${m.current_phase_label}` : ' → 全部完成';
        console.log(`  🔄  ${m.id} (${m.name})  [initial${phase}]`);
        if (m.phase_progress && m.current_phase) {
          const cp = m.phase_progress[m.current_phase];
          if (cp?.scenario_coverage && cp.scenario_coverage.missing.length > 0) {
            console.log(`       缺少场景: ${cp.scenario_coverage.missing.join(', ')}`);
          }
        }
      }
      console.log(`       💡 ${m.suggestion}`);
    }
    console.log('');
  }

  if (!moduleId) {
    if (data.source_roots) {
      console.log(`\n📂 Source roots: src=[${data.source_roots.src.join(', ')}] test=[${data.source_roots.test.join(', ')}]`);
    }

    if (data.active_change) {
      const stepLabel = t(locale, `status.proposalStep.${data.proposal_step ?? 'writing'}`);
      console.log(`\n🔒 ${t(locale, 'status.activeChange')}: ${data.active_change}`);
      console.log(`   ${t(locale, 'status.proposalStepLabel')}: ${stepLabel}`);
      console.log(LINE);
    } else if (data.active_proposals.length > 0) {
      console.log(`\n📝 ${t(locale, 'status.activeProposals')}`);
      for (const p of data.active_proposals) {
        const parts = [
          p.has_proposal ? 'proposal.md ✓' : 'proposal.md ✗',
          p.has_tasks ? 'tasks.md ✓' : 'tasks.md ✗',
          `deltas: ${p.delta_count} files`,
        ];
        console.log(`     └─ ${p.name} (${parts.join(' | ')})`);
      }
      console.log(LINE);
    }

    if (data.all_done) {
      console.log(`\n🎉 ${t(locale, 'status.allDone')}`);
      if (data.lifecycle === 'initial') console.log(`   → ${t(locale, 'launch.suggest')}`);
      console.log(t(locale, 'status.allDoneHint') + '\n');
    } else {
      const firstIncomplete = data.phases.find(p => !p.done && !p.skipped)!;
      console.log(`\n💡 ${t(locale, 'status.suggestNext', { label: firstIncomplete.label })}`);
      console.log(`   → ${data.suggestion}\n`);
    }
  }
}
