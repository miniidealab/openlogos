import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadFlow, findActivatedLoop, inferLifecycle, FlowError } from '../lib/flow.js';
import { loopLedgerPath, readLoopIters } from '../lib/flow-loop-derive.js';
import { readProjectYaml } from '../lib/project-yaml.js';
import { readLocale, t } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import {
  readVerifyConfig,
  type NormalizedVerifyConfig,
} from '../lib/verify-config.js';
import {
  buildInitialSandboxData,
  normalizeSandboxConfig,
  runSandboxedCommand,
  type SandboxCommandResult,
  type SandboxData,
} from '../lib/sandbox.js';
import { getDeployTasks } from './status.js';

export interface TestResult {
  id: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms?: number;
  timestamp?: string;
  error?: string;
  scenario?: string;
}

const TEST_CASES_DIR = 'logos/resources/test';
const REPORT_DIR = 'logos/resources/verify';
const MANUAL_SUFFIX = /\[manual\]/i;
const CHECKLIST_PATTERN = /^- \[([ x])\] (.+)$/gm;
const AC_TABLE_HEADER = /^## 四、验收条件追溯$/m;
const AC_ROW_PATTERN = /^\|\s*(S\d{2}-AC-\d{2,3})\s*\|([^|]*)\|([^|]*)\|/gm;
const TABLE_CELL_ID_PATTERN = /^\s*(?:UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*(?:\s*\[manual\])?\s*$/i;
const LINE = '─'.repeat(50);

export interface ChecklistItem {
  checked: boolean;
  text: string;
  file: string;
}

export interface AcTraceEntry {
  acId: string;
  description: string;
  linkedCaseIds: string[];
  file: string;
}

export type VerifyPreRunMode = 'none' | 'pre_run_command' | 'two_phase';
export type VerifyPreRunStage = 'pre_run' | 'regression' | 'incremental';

export interface VerifyPreRunCommandResult {
  stage: VerifyPreRunStage;
  command: string;
  status: 'pass' | 'fail' | 'skipped';
  exit_code?: number;
  duration_ms?: number;
  error?: string;
}

export interface VerifyPreRunData {
  mode: VerifyPreRunMode;
  commands: Array<VerifyPreRunCommandResult & {
    sandbox?: SandboxData;
  }>;
  result_paths: {
    final: string;
    regression: string | null;
    incremental: string | null;
  };
  merge_strategy: 'last-write-wins' | null;
  diagnostics: string[];
  suggestions: string[];
}

export interface VerifyData {
  summary: {
    defined_count: number;
    ut_count: number;
    st_count: number;
    manual_count: number;
    executed_count: number;
    passed_count: number;
    failed_count: number;
    skipped_count: number;
    uncovered_count: number;
    coverage_pct: number;
    pass_rate_pct: number;
  };
  gate: {
    result: 'PASS' | 'FAIL';
    reason: string | null;
  };
  failed_cases: Array<{ id: string; error: string }>;
  uncovered_cases: string[];
  skipped_cases: string[];
  checklist: {
    total: number;
    checked: number;
    unchecked_items: Array<{ text: string; file: string }>;
  };
  ac_trace: {
    total: number;
    passed: number;
    failed_criteria: Array<{
      ac_id: string;
      description: string;
      linked_case_ids: string[];
      status: string;
    }>;
  };
  pre_run: VerifyPreRunData;
  sandbox: SandboxData;
  report_path: string;
}

function safeReadFile(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function writeMergedResults(root: string, resultPath: string, contents: string[]): void {
  const fullResultPath = join(root, resultPath);
  mkdirSync(dirname(fullResultPath), { recursive: true });
  const joined = contents
    .map(content => content.trim())
    .filter(Boolean)
    .join('\n');
  writeFileSync(fullResultPath, joined ? `${joined}\n` : '');
}

export function buildInitialPreRunData(config: NormalizedVerifyConfig): VerifyPreRunData {
  const hasTwoPhase = Boolean(config.regressionCommand || config.incrementalCommand);
  const mode: VerifyPreRunMode = hasTwoPhase
    ? 'two_phase'
    : config.preRunCommand ? 'pre_run_command' : 'none';
  return {
    mode,
    commands: [],
    result_paths: {
      final: config.resultPath,
      regression: config.regressionResultPath ?? null,
      incremental: config.incrementalResultPath ?? null,
    },
    merge_strategy: mode === 'two_phase' ? config.mergeStrategy : null,
    diagnostics: [],
    suggestions: [],
  };
}

function skippedCompatPreRunCommand(config: NormalizedVerifyConfig): VerifyPreRunCommandResult | null {
  if (!config.preRunCommand || !(config.regressionCommand || config.incrementalCommand)) return null;
  return {
    stage: 'pre_run',
    command: config.preRunCommand,
    status: 'skipped',
  };
}

export interface RunVerifyPreRunResult {
  preRun: VerifyPreRunData;
  sandbox: SandboxData;
}

function ensureRelativePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function appendSandboxDiagnostics(preRun: VerifyPreRunData, sandbox: SandboxData): void {
  for (const line of sandbox.diagnostics) {
    if (!preRun.diagnostics.includes(line)) preRun.diagnostics.push(line);
  }
  for (const line of sandbox.suggestions) {
    if (!preRun.suggestions.includes(line)) preRun.suggestions.push(line);
  }
}

function executeVerifyCommand(
  root: string,
  stage: VerifyPreRunStage,
  command: string,
  format: OutputFormat,
  sandboxConfig: NormalizedVerifyConfig['sandbox'],
  allowedWritePaths: string[],
): { command: SandboxCommandResult; sandbox: SandboxData } {
  if (format !== 'json') {
    console.log(`\n⚙️  Running verify.${stage === 'pre_run' ? 'pre_run_command' : `${stage}_command`}: ${command}`);
  }
  return runSandboxedCommand({
    root,
    command,
    format,
    sandbox: sandboxConfig,
    allowedWritePaths,
  });
}

function toPreRunCommandResult(
  stage: VerifyPreRunStage,
  command: string,
  result: SandboxCommandResult,
  sandbox: SandboxData,
): VerifyPreRunCommandResult & { sandbox: SandboxData } {
  return {
    stage,
    command,
    status: result.status,
    exit_code: result.exit_code,
    duration_ms: result.duration_ms,
    error: result.error,
    sandbox,
  };
}

function mergeSandboxStatus(current: SandboxData, next: SandboxData): SandboxData {
  const rank: Record<SandboxData['status'], number> = {
    fail: 4,
    warn: 3,
    pass: 2,
    skipped: 1,
  };
  const status = rank[next.status] > rank[current.status] ? next.status : current.status;
  const diagnostics = Array.from(new Set([...current.diagnostics, ...next.diagnostics]));
  const suggestions = Array.from(new Set([...current.suggestions, ...next.suggestions]));
  return {
    mode: current.mode,
    root: next.isolated ? next.root : current.root,
    isolated: current.isolated || next.isolated,
    workspace_write_denied: current.workspace_write_denied,
    status,
    diagnostics,
    suggestions,
  };
}

export function runVerifyPreRunWithSandbox(root: string, config: NormalizedVerifyConfig, format: OutputFormat): RunVerifyPreRunResult {
  const preRun = buildInitialPreRunData(config);
  const sandboxConfig = config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' });
  let sandbox = buildInitialSandboxData(sandboxConfig);
  const allowPaths = new Set<string>([
    config.resultPath,
    'logos/resources/verify/acceptance-report.md',
  ]);
  if (config.regressionResultPath) allowPaths.add(config.regressionResultPath);
  if (config.incrementalResultPath) allowPaths.add(config.incrementalResultPath);
  const allowedWritePaths = Array.from(allowPaths).map(ensureRelativePath);

  if (preRun.mode === 'none') {
    return { preRun, sandbox };
  }

  if (preRun.mode === 'pre_run_command' && config.preRunCommand) {
    const resultPath = join(root, config.resultPath);
    mkdirSync(dirname(resultPath), { recursive: true });
    writeFileSync(resultPath, '');
    const stageResult = executeVerifyCommand(root, 'pre_run', config.preRunCommand, format, sandboxConfig, allowedWritePaths);
    const normalized = toPreRunCommandResult('pre_run', config.preRunCommand, stageResult.command, stageResult.sandbox);
    preRun.commands.push(normalized);
    sandbox = mergeSandboxStatus(sandbox, stageResult.sandbox);
    if (normalized.status === 'fail' && format !== 'json') {
      console.warn('\n⚠️  verify pre_run command exited with non-zero status. Continuing verify with existing results.');
    }
    appendSandboxDiagnostics(preRun, sandbox);
    return { preRun, sandbox };
  }

  const compatSkipped = skippedCompatPreRunCommand(config);
  if (compatSkipped) {
    preRun.commands.push(compatSkipped);
    preRun.diagnostics.push(t(readLocale(root), 'verify.preRunCompatSkipped'));
  }

  const stageContents: string[] = [];
  const runStage = (
    stage: Extract<VerifyPreRunStage, 'regression' | 'incremental'>,
    command: string | undefined,
    stageResultPath: string | undefined,
  ) => {
    if (!command) return;
    const effectiveStagePath = stageResultPath ?? config.resultPath;
    const fullStagePath = join(root, effectiveStagePath);
    mkdirSync(dirname(fullStagePath), { recursive: true });
    writeFileSync(fullStagePath, '');
    const stageResult = executeVerifyCommand(root, stage, command, format, sandboxConfig, allowedWritePaths);
    const normalized = toPreRunCommandResult(stage, command, stageResult.command, stageResult.sandbox);
    preRun.commands.push(normalized);
    sandbox = mergeSandboxStatus(sandbox, stageResult.sandbox);
    if (normalized.status === 'fail' && format !== 'json') {
      console.warn(`\n⚠️  verify ${stage} command exited with non-zero status. Continuing verify with existing results.`);
    }

    const content = safeReadFile(fullStagePath);
    if (content.trim()) stageContents.push(content);
  };

  runStage('regression', config.regressionCommand, config.regressionResultPath);
  runStage('incremental', config.incrementalCommand, config.incrementalResultPath);
  writeMergedResults(root, config.resultPath, stageContents);
  appendSandboxDiagnostics(preRun, sandbox);
  return { preRun, sandbox };
}

export function runVerifyPreRun(root: string, config: NormalizedVerifyConfig, format: OutputFormat): VerifyPreRunData {
  return runVerifyPreRunWithSandbox(root, config, format).preRun;
}

function addCoverageDiagnostics(root: string, data: VerifyData): VerifyData {
  if (data.gate.reason === 'incomplete_coverage' && data.pre_run.mode === 'none') {
    const locale = readLocale(root);
    data.pre_run.diagnostics.push(t(locale, 'verify.coverageLocalDiag'));
    data.pre_run.suggestions.push(
      t(locale, 'verify.coverageLocalSuggestionPreRun'),
      t(locale, 'verify.coverageLocalSuggestionTwoPhase'),
    );
  }
  return data;
}

function ensureResultFileWhenPreRunFailed(fullResultPath: string, preRun: VerifyPreRunData): void {
  if (existsSync(fullResultPath)) return;
  const failedPreRun = preRun.commands.some(cmd => cmd.status === 'fail');
  if (!failedPreRun) return;
  mkdirSync(dirname(fullResultPath), { recursive: true });
  writeFileSync(fullResultPath, '');
}

export function parseJsonl(content: string): TestResult[] {
  const resultMap = new Map<string, TestResult>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as TestResult;
      if (obj.id && obj.status) {
        resultMap.set(obj.id, obj);
      }
    } catch { /* skip malformed lines */ }
  }
  return Array.from(resultMap.values());
}

export function extractDefinedIds(root: string): { ids: string[]; utCount: number; stCount: number; manualCount: number } {
  const dir = join(root, TEST_CASES_DIR);
  if (!existsSync(dir)) return { ids: [], utCount: 0, stCount: 0, manualCount: 0 };

  const idSet = new Set<string>();
  const manualSet = new Set<string>();
  let manualCount = 0;
  try {
    const files = readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => f.endsWith('-test-cases.md'));

    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim().startsWith('|')) continue;

        const cells = line.split('|').map(cell => cell.trim());
        const firstCell = cells[1] ?? '';
        if (!TABLE_CELL_ID_PATTERN.test(firstCell)) continue;

        const id = firstCell.replace(MANUAL_SUFFIX, '').replace(/\s+/g, ' ').trim();
        const isManual = MANUAL_SUFFIX.test(firstCell) || MANUAL_SUFFIX.test(line);
        if (isManual) {
          if (!manualSet.has(id)) {
            manualSet.add(id);
            manualCount++;
          }
          idSet.delete(id);
          continue;
        }

        if (!manualSet.has(id)) {
          idSet.add(id);
        }
      }
    }
  } catch { /* directory read error */ }

  const ids = Array.from(idSet).sort();
  const utCount = ids.filter(id => id.startsWith('UT-')).length;
  const stCount = ids.filter(id => id.startsWith('ST-')).length;
  return { ids, utCount, stCount, manualCount };
}

export function extractChecklist(root: string): ChecklistItem[] {
  const dir = join(root, TEST_CASES_DIR);
  if (!existsSync(dir)) return [];

  const items: ChecklistItem[] = [];
  try {
    const files = readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => f.endsWith('-test-cases.md'));

    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      const sectionStart = content.indexOf('## 三、覆盖度校验');
      if (sectionStart === -1) continue;

      const sectionEnd = content.indexOf('\n## ', sectionStart + 1);
      const section = sectionEnd === -1
        ? content.slice(sectionStart)
        : content.slice(sectionStart, sectionEnd);

      let match: RegExpExecArray | null;
      const re = new RegExp(CHECKLIST_PATTERN.source, CHECKLIST_PATTERN.flags);
      while ((match = re.exec(section)) !== null) {
        items.push({
          checked: match[1] === 'x',
          text: match[2].trim(),
          file,
        });
      }
    }
  } catch { /* directory read error */ }
  return items;
}

export function extractAcTrace(root: string): AcTraceEntry[] {
  const dir = join(root, TEST_CASES_DIR);
  if (!existsSync(dir)) return [];

  const entries: AcTraceEntry[] = [];
  try {
    const files = readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => f.endsWith('-test-cases.md'));

    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      if (!AC_TABLE_HEADER.test(content)) continue;

      const sectionStart = content.search(AC_TABLE_HEADER);
      const sectionEnd = content.indexOf('\n## ', sectionStart + 1);
      const section = sectionEnd === -1
        ? content.slice(sectionStart)
        : content.slice(sectionStart, sectionEnd);

      let match: RegExpExecArray | null;
      const re = new RegExp(AC_ROW_PATTERN.source, AC_ROW_PATTERN.flags);
      while ((match = re.exec(section)) !== null) {
        const acId = match[1].trim();
        const description = match[2].trim();
        const caseIdsRaw = match[3].trim();
        const caseIdTest = /\b(?:UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*\b/;
        const linkedCaseIds = caseIdsRaw
          .split(/[,，]/)
          .map(s => s.trim())
          .filter(s => caseIdTest.test(s));
        entries.push({ acId, description, linkedCaseIds, file });
      }
    }
  } catch { /* directory read error */ }
  return entries;
}

export function generateReport(
  defined: string[],
  results: TestResult[],
  passed: TestResult[],
  failed: TestResult[],
  skipped: TestResult[],
  uncovered: string[],
  coveragePct: string,
  passRatePct: string,
  gateResult: 'PASS' | 'FAIL',
  checklist: ChecklistItem[],
  acTrace: AcTraceEntry[],
  _resultIds: Set<string>,
  manualCount: number,
): string {
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Acceptance Report\n\n> Generated by \`openlogos verify\` on ${now}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Defined cases | ${defined.length} |\n`;
  md += `| Manual cases (excluded) | ${manualCount} |\n`;
  md += `| Executed cases | ${results.length} |\n`;
  md += `| Passed | ${passed.length} |\n`;
  md += `| Failed | ${failed.length} |\n`;
  md += `| Skipped | ${skipped.length} |\n`;
  md += `| Uncovered | ${uncovered.length} |\n`;
  md += `| Coverage | ${coveragePct}% |\n`;
  md += `| Pass rate | ${passRatePct}% |\n`;
  md += `| **Gate 3.5** | **${gateResult}** |\n\n`;

  if (failed.length > 0) {
    md += `## Failed Cases\n\n`;
    md += `| ID | Error |\n|----|-------|\n`;
    for (const r of failed) {
      const error = (r.error ?? 'unknown').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      md += `| ${r.id} | ${error} |\n`;
    }
    md += '\n';
  }

  if (uncovered.length > 0) {
    md += `## Uncovered Cases\n\n`;
    for (const id of uncovered) {
      md += `- ${id}\n`;
    }
    md += '\n';
  }

  if (skipped.length > 0) {
    md += `## Skipped Cases\n\n`;
    for (const r of skipped) {
      md += `- ${r.id}\n`;
    }
    md += '\n';
  }

  if (checklist.length > 0) {
    const checked = checklist.filter(c => c.checked).length;
    md += `## Design-time Coverage (Layer 1)\n\n`;
    md += `> Parsed from the "三、覆盖度校验" checklist in test-cases.md. `;
    md += `These assertions were made by AI at test-design time.\n\n`;
    md += `| Status | Assertion | Source |\n|--------|-----------|--------|\n`;
    for (const item of checklist) {
      const icon = item.checked ? '✅' : '❌';
      md += `| ${icon} | ${item.text} | ${item.file} |\n`;
    }
    md += `\n**${checked}/${checklist.length}** assertions confirmed.\n\n`;
  }

  if (acTrace.length > 0) {
    const resultMap = new Map(results.map(r => [r.id, r]));
    md += `## Acceptance Criteria Traceability (Layer 3)\n\n`;
    md += `> Traces requirement acceptance criteria → test cases → runtime results.\n\n`;
    md += `| AC ID | Description | Linked Cases | Runtime Status |\n`;
    md += `|-------|-------------|-------------|----------------|\n`;
    for (const ac of acTrace) {
      const statuses = ac.linkedCaseIds.map(cid => {
        const r = resultMap.get(cid);
        if (!r) return `${cid}:🔵manual`;
        if (r.status === 'pass') return `${cid}:✅`;
        if (r.status === 'fail') return `${cid}:❌`;
        return `${cid}:⏭️`;
      });
      const automatedIds = ac.linkedCaseIds.filter(cid => resultMap.has(cid));
      const allManual = ac.linkedCaseIds.length > 0 && automatedIds.length === 0;
      const allPass = automatedIds.length > 0 && automatedIds.every(cid => resultMap.get(cid)?.status === 'pass');
      const acStatus = ac.linkedCaseIds.length === 0
        ? '⚠️ no linked cases'
        : allManual ? '🔵 MANUAL'
        : allPass ? '✅ PASS' : '❌ FAIL';
      md += `| ${ac.acId} | ${ac.description} | ${statuses.join(', ')} | ${acStatus} |\n`;
    }
    const acPassed = acTrace.filter(ac => {
      const automatedIds = ac.linkedCaseIds.filter(cid => resultMap.has(cid));
      return automatedIds.length > 0 && automatedIds.every(cid => resultMap.get(cid)?.status === 'pass');
    }).length;
    const acManual = acTrace.filter(ac =>
      ac.linkedCaseIds.length > 0 && !ac.linkedCaseIds.some(cid => resultMap.has(cid)),
    ).length;
    const acWithoutLinks = acTrace.filter(ac => ac.linkedCaseIds.length === 0).length;
    md += `\n**${acPassed}/${acTrace.length}** acceptance criteria passed.`;
    if (acManual > 0) md += ` 🔵 ${acManual} criteria are manual-only (pending human verification).`;
    if (acWithoutLinks > 0) md += ` ⚠️ ${acWithoutLinks} criteria have no linked test cases.`;
    md += '\n\n';
  }

  return md;
}

export function collectVerifyData(root: string, preRun?: VerifyPreRunData): VerifyData {
  const config = readVerifyConfig(root);
  const resultPath = config.resultPath;

  const fullResultPath = join(root, resultPath);
  const results = parseJsonl(readFileSync(fullResultPath, 'utf-8'));
  const { ids: defined, utCount, stCount, manualCount } = extractDefinedIds(root);

  const resultIds = new Set(results.map(r => r.id));
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  const skipped = results.filter(r => r.status === 'skip');
  const uncovered = defined.filter(id => !resultIds.has(id));
  const coveredCount = defined.filter(id => resultIds.has(id)).length;

  const coveragePct = defined.length > 0
    ? Math.round((coveredCount / defined.length) * 100)
    : 0;
  const passRatePct = results.length > 0
    ? Math.round((passed.length / results.length) * 100)
    : 0;

  const checklist = extractChecklist(root);
  const acTrace = extractAcTrace(root);

  const checklistUnchecked = checklist.filter(c => !c.checked);
  const resultMap = new Map(results.map(r => [r.id, r]));

  // AC 失败判定：全 [manual] 的 AC 标记为 MANUAL_PENDING，不计入失败
  const acFailed = acTrace.filter(ac => {
    if (ac.linkedCaseIds.length === 0) return true;
    const automatedIds = ac.linkedCaseIds.filter(cid => resultMap.has(cid));
    if (automatedIds.length === 0) return false; // 全 manual → MANUAL_PENDING，不失败
    return !automatedIds.every(cid => resultMap.get(cid)?.status === 'pass');
  });

  const isPass = failed.length === 0 && uncovered.length === 0
    && checklistUnchecked.length === 0 && acFailed.length === 0;
  const gateResult = isPass ? 'PASS' as const : 'FAIL' as const;

  let gateReason: string | null = null;
  if (!isPass) {
    if (failed.length > 0) gateReason = 'failed_cases';
    else if (uncovered.length > 0) gateReason = 'incomplete_coverage';
    else if (checklistUnchecked.length > 0) gateReason = 'checklist_incomplete';
    else gateReason = 'ac_trace_incomplete';
  }

  const reportPath = join(root, REPORT_DIR, 'acceptance-report.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, generateReport(
    defined, results, passed, failed, skipped, uncovered,
    String(coveragePct), String(passRatePct), gateResult, checklist, acTrace, resultIds, manualCount,
  ));

  const relReportPath = 'logos/resources/verify/acceptance-report.md';

  return addCoverageDiagnostics(root, {
    summary: {
      defined_count: defined.length,
      ut_count: utCount,
      st_count: stCount,
      manual_count: manualCount,
      executed_count: results.length,
      passed_count: passed.length,
      failed_count: failed.length,
      skipped_count: skipped.length,
      uncovered_count: uncovered.length,
      coverage_pct: coveragePct,
      pass_rate_pct: passRatePct,
    },
    gate: {
      result: gateResult,
      reason: gateReason,
    },
    failed_cases: failed.map(r => ({ id: r.id, error: r.error ?? 'unknown' })),
    uncovered_cases: uncovered,
    skipped_cases: skipped.map(r => r.id),
    checklist: {
      total: checklist.length,
      checked: checklist.filter(c => c.checked).length,
      unchecked_items: checklistUnchecked.map(c => ({ text: c.text, file: c.file })),
    },
    ac_trace: {
      total: acTrace.length,
      passed: acTrace.length - acFailed.length,
      failed_criteria: acFailed.map(ac => {
        const automatedIds = ac.linkedCaseIds.filter(cid => resultMap.has(cid));
        return {
          ac_id: ac.acId,
          description: ac.description,
          linked_case_ids: ac.linkedCaseIds,
          status: ac.linkedCaseIds.length === 0 ? 'NO_LINKED_CASES' : 'FAIL',
        };
        void automatedIds; // used in filter above
      }),
    },
    pre_run: preRun ?? buildInitialPreRunData(config),
    sandbox: buildInitialSandboxData(config.sandbox ?? normalizeSandboxConfig({ sandbox_mode: 'auto' })),
    report_path: relReportPath,
  });
}

/**
 * M2 切片 2：loop 激活时追加 `LOOP_ITERS` 账本（不依赖 guard 的共享路径，由主进程写）。
 * launched=guard.module/提案目录；initial 单模块=该模块/resources-verify；initial 多模块=不写（R7）。
 * 未激活（builtin max_iters:1）/无法定位 → 不写（零副作用）。
 */
function appendLoopIter(root: string, gatePass: boolean): void {
  let activeChange: string | null = null;
  let guardModule: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const g = JSON.parse(readFileSync(guardPath, 'utf-8'));
      activeChange = g.activeChange || null;
      guardModule = g.module || null;
    } catch { /* ignore */ }
  }

  let lifecycle: 'initial' | 'launched';
  let moduleId: string;
  let proposalDir: string | null;
  if (activeChange && guardModule) {
    lifecycle = 'launched';
    moduleId = guardModule;
    proposalDir = join(root, 'logos', 'changes', activeChange);
  } else {
    // 无活跃提案：launched 项目的账本只在提案目录、此处无提案 → 不写
    // （launch 后历史 logos/flow/initial.yaml 即便含 set-loop 也不得写 initial 账本，spec/cli-json-output.md §13）
    if (inferLifecycle(root) === 'launched') return;
    lifecycle = 'initial';
    proposalDir = null;
    const yaml = readProjectYaml(root);
    const mods = Array.isArray(yaml.data?.modules) ? yaml.data.modules : [];
    if (mods.length > 1) return; // initial 多模块：无法归属、不写（R7）
    moduleId = mods.length === 1 ? mods[0].id : 'core';
  }

  let resolved;
  try { resolved = loadFlow(root, { lifecycle, resolved: true }).flow; } catch { return; }
  if (!findActivatedLoop(resolved)) return; // 未激活 → 不写

  const path = loopLedgerPath(root, proposalDir);
  const iter = readLoopIters(path, moduleId).length + 1;
  const row = JSON.stringify({
    iter, node: 'verify', result: gatePass ? 'pass' : 'fail', module: moduleId,
    timestamp: new Date().toISOString(),
  });
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, row + '\n');
}

export function verify(format: OutputFormat = 'text') {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'verify', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const locale = readLocale(root);

  // M2 切片 2：尽早校验 resolved flow（overlay 含非法 set-loop 等）→ fail loud，
  // 避免静默退化为「不写 LOOP_ITERS、却仍写验收报告与 VERIFY_PASS/FAIL marker」。无 overlay 项目不触发（golden 零漂移）。
  try {
    loadFlow(root, { lifecycle: inferLifecycle(root), resolved: true });
  } catch (e) {
    if (e instanceof FlowError) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('verify', e.code, e.message)));
      } else {
        console.error(`✖ flow 配置错误（${e.code}）：${e.message}`);
      }
      process.exit(1);
    }
    throw e;
  }

  const config = readVerifyConfig(root);
  const resultPath = config.resultPath;
  const preRunResult = runVerifyPreRunWithSandbox(root, config, format);
  const preRun = preRunResult.preRun;
  const sandbox = preRunResult.sandbox;

  const fullResultPath = join(root, resultPath);
  ensureResultFileWhenPreRunFailed(fullResultPath, preRun);

  if (!existsSync(fullResultPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'verify', 'NO_TEST_RESULTS', `No test results found at ${resultPath}.`,
      )));
      process.exit(1);
    }
    console.error(`\nError: ${t(locale, 'verify.noResults', { path: resultPath })}`);
    process.exit(1);
  }

  const { ids: defined } = extractDefinedIds(root);
  if (defined.length === 0) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'verify', 'NO_TEST_CASES', 'No test case specs found in logos/resources/test/.',
      )));
      process.exit(1);
    }
    console.error(`\nError: ${t(locale, 'verify.noCases')}`);
    process.exit(1);
  }

  const data = collectVerifyData(root, preRun);
  data.sandbox = sandbox;
  if (sandbox.status === 'fail' && data.gate.result === 'PASS') {
    data.gate.result = 'FAIL';
    data.gate.reason = 'failed_cases';
    if (data.failed_cases.length === 0) {
      data.failed_cases.push({
        id: 'sandbox',
        error: sandbox.diagnostics[0] ?? 'verify sandbox failed',
      });
    }
  }

  // M2 切片 2：loop 激活时追加迭代账本（共享路径、取最终 data.gate.result；配置类早退已在上面 process.exit、不会到此）
  appendLoopIter(root, data.gate.result === 'PASS');

  // 写入提案目录标记文件（如果有活跃提案）
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      const slug = guard.activeChange;
      if (slug) {
        const proposalDir = join(root, 'logos', 'changes', slug);
        if (existsSync(proposalDir)) {
          if (data.gate.result === 'PASS') {
            writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
            for (const marker of ['VERIFY_FAIL']) {
              const markerPath = join(proposalDir, marker);
              if (existsSync(markerPath)) rmSync(markerPath, { force: true });
            }
          } else {
            writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');
            for (const marker of ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL']) {
              const markerPath = join(proposalDir, marker);
              if (existsSync(markerPath)) rmSync(markerPath, { force: true });
            }
          }
        }
      }
    } catch { /* guard 文件读取失败时静默跳过 */ }
  }

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('verify', data)));
    if (data.gate.result !== 'PASS') {
      process.exit(1);
    }
    return;
  }

  // Human-readable output (preserving original behavior)
  console.log(`\n🔍 ${t(locale, 'verify.title')}\n`);
  console.log(t(locale, 'verify.readingResults', { path: resultPath }));
  console.log(t(locale, 'verify.readingCases'));

  const { summary, gate, failed_cases, uncovered_cases, checklist, ac_trace, pre_run } = data;

  console.log(`\n${LINE}`);
  console.log(`📊 ${t(locale, 'verify.summary')}`);
  console.log(LINE);
  console.log(`  ${t(locale, 'verify.totalDefined', { count: String(summary.defined_count), ut: String(summary.ut_count), st: String(summary.st_count) })}`);
  if (summary.manual_count > 0) {
    console.log(`  🔵 ${t(locale, 'verify.manual', { count: String(summary.manual_count) })}`);
  }
  console.log(`  ${t(locale, 'verify.totalExecuted', { count: String(summary.executed_count) })}`);
  console.log(`  ✅ ${t(locale, 'verify.passed', { count: String(summary.passed_count) })}`);
  console.log(`  ❌ ${t(locale, 'verify.failed', { count: String(summary.failed_count) })}`);
  console.log(`  ⏭️  ${t(locale, 'verify.skipped', { count: String(summary.skipped_count) })}`);
  console.log(LINE);
  console.log(`  ${t(locale, 'verify.coverage', { pct: String(summary.coverage_pct), covered: String(summary.defined_count - summary.uncovered_count), total: String(summary.defined_count) })}`);
  console.log(`  ${t(locale, 'verify.passRate', { pct: String(summary.pass_rate_pct), passed: String(summary.passed_count), total: String(summary.executed_count) })}`);
  console.log(LINE);

  if (failed_cases.length > 0) {
    console.log(`\n❌ ${t(locale, 'verify.failedCases')}`);
    for (const r of failed_cases) {
      console.log(`  ${r.id}  ${r.error}`);
    }
  }

  if (uncovered_cases.length > 0) {
    console.log(`\n⚠️  ${t(locale, 'verify.uncoveredCases', { count: String(uncovered_cases.length) })}`);
    for (const id of uncovered_cases) {
      console.log(`  ${id}`);
    }
  }

  if (checklist.total > 0) {
    console.log(`\n📋 ${t(locale, 'verify.checklistTitle')}`);
    console.log(`  ${t(locale, 'verify.checklistSummary', { checked: String(checklist.checked), total: String(checklist.total) })}`);
    if (checklist.unchecked_items.length > 0) {
      console.log(`  ⚠️  ${t(locale, 'verify.checklistUnchecked', { count: String(checklist.unchecked_items.length) })}`);
      for (const item of checklist.unchecked_items) {
        console.log(`    - ${item.text}  (${item.file})`);
      }
    }
  }

  if (ac_trace.total > 0) {
    console.log(`\n🔗 ${t(locale, 'verify.acTitle')}`);
    console.log(`  ${t(locale, 'verify.acSummary', { passed: String(ac_trace.passed), total: String(ac_trace.total) })}`);
    if (ac_trace.failed_criteria.length > 0) {
      console.log(`  ⚠️  ${t(locale, 'verify.acFailed', { count: String(ac_trace.failed_criteria.length) })}`);
      for (const ac of ac_trace.failed_criteria) {
        const reason = ac.status === 'NO_LINKED_CASES' ? 'no linked cases' : 'case(s) not passing';
        console.log(`    ${ac.ac_id}: ${ac.description}  (${reason})`);
      }
    }
  }

  if (gate.result === 'PASS') {
    console.log(`\n✅ ${t(locale, 'verify.gatePass')}`);
  } else if (gate.reason === 'failed_cases') {
    console.log(`\n❌ ${t(locale, 'verify.gateFail')}`);
  } else if (gate.reason === 'incomplete_coverage') {
    console.log(`\n❌ ${t(locale, 'verify.gateFailCoverage')}`);
  } else if (gate.reason === 'checklist_incomplete') {
    console.log(`\n❌ ${t(locale, 'verify.gateFailChecklist')}`);
  } else {
    console.log(`\n❌ ${t(locale, 'verify.gateFailAc')}`);
  }

  console.log(`\n📄 ${t(locale, 'verify.reportPath', { path: data.report_path })}\n`);

  if (pre_run.mode !== 'none' || pre_run.diagnostics.length > 0 || pre_run.suggestions.length > 0) {
    if (pre_run.mode === 'pre_run_command') {
      console.log(`⚙️  ${t(locale, 'verify.preRunModeSingle')}`);
    } else if (pre_run.mode === 'two_phase') {
      console.log(`⚙️  ${t(locale, 'verify.preRunModeTwoPhase')}`);
    } else {
      console.log(`⚙️  ${t(locale, 'verify.preRunModeNone')}`);
    }
    for (const cmd of pre_run.commands) {
      const exit = cmd.exit_code === undefined ? 'n/a' : String(cmd.exit_code);
      const duration = cmd.duration_ms === undefined ? 'n/a' : `${cmd.duration_ms}ms`;
      console.log(`  ${t(locale, 'verify.preRunStageLine', {
        status: cmd.status,
        stage: cmd.stage,
        command: cmd.command,
        exit,
        duration,
      })}`);
      if (cmd.error) {
        console.log(`    ${cmd.error}`);
      }
    }
    for (const line of pre_run.diagnostics) {
      console.log(`  ⚠️  ${line}`);
    }
    for (const line of pre_run.suggestions) {
      console.log(`  💡 ${line}`);
    }
  }

  if (data.sandbox.mode !== 'off' || data.sandbox.status !== 'skipped') {
    console.log('\n🧪 verify sandbox');
    console.log(`  ${t(locale, 'verify.sandboxSummary', {
      mode: data.sandbox.mode,
      status: data.sandbox.status,
      isolated: String(data.sandbox.isolated),
      writeDenied: String(data.sandbox.workspace_write_denied),
    })}`);
    if (data.sandbox.diagnostics.length > 0) {
      for (const line of data.sandbox.diagnostics) {
        console.log(`  ⚠️  ${line}`);
      }
    }
    if (data.sandbox.suggestions.length > 0) {
      for (const line of data.sandbox.suggestions) {
        console.log(`  💡 ${line}`);
      }
    }
  }

  if (gate.result !== 'PASS') {
    process.exit(1);
  }

  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      const slug = guard.activeChange;
      if (slug) {
        const proposalDir = join(root, 'logos', 'changes', slug);
        const deployTasks = existsSync(proposalDir) ? getDeployTasks(proposalDir) : [];
        if (deployTasks.length > 0) {
          console.log(`📦 ${t(locale, 'verify.deployTasksTitle')}`);
          for (const task of deployTasks) {
            const icon = task.checked ? 'x' : ' ';
            console.log(`  - [${icon}] ${task.text}`);
          }
          console.log(`\n⚠️  ${t(locale, 'verify.deployHumanGate')}`);
          console.log(`${t(locale, 'verify.deployAiHint')}\n`);
        }
      }
    } catch { /* guard 文件读取失败时静默跳过 */ }
  }
}
