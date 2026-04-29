import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readLocale, t } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';

export interface TestResult {
  id: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms?: number;
  timestamp?: string;
  error?: string;
  scenario?: string;
}

const DEFAULT_RESULT_PATH = 'logos/resources/verify/test-results.jsonl';
const TEST_CASES_DIR = 'logos/resources/test';
const REPORT_DIR = 'logos/resources/verify';
const ID_PATTERN = /\b(UT|ST)-S\d{2}-\d{2,3}[a-z]?\b/g;
const CHECKLIST_PATTERN = /^- \[([ x])\] (.+)$/gm;
const AC_TABLE_HEADER = /^## 四、验收条件追溯$/m;
const AC_ROW_PATTERN = /^\|\s*(S\d{2}-AC-\d{2,3})\s*\|([^|]*)\|([^|]*)\|/gm;
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

export interface VerifyData {
  summary: {
    defined_count: number;
    ut_count: number;
    st_count: number;
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
  report_path: string;
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

export function extractDefinedIds(root: string): { ids: string[]; utCount: number; stCount: number } {
  const dir = join(root, TEST_CASES_DIR);
  if (!existsSync(dir)) return { ids: [], utCount: 0, stCount: 0 };

  const idSet = new Set<string>();
  try {
    const files = readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => f.endsWith('-test-cases.md'));

    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = ID_PATTERN.exec(content)) !== null) {
        idSet.add(match[0]);
      }
    }
  } catch { /* directory read error */ }

  const ids = Array.from(idSet).sort();
  const utCount = ids.filter(id => id.startsWith('UT-')).length;
  const stCount = ids.filter(id => id.startsWith('ST-')).length;
  return { ids, utCount, stCount };
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
        const caseIdTest = /\b(UT|ST)-S\d{2}-\d{2,3}[a-z]?\b/;
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
): string {
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Acceptance Report\n\n> Generated by \`openlogos verify\` on ${now}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Defined cases | ${defined.length} |\n`;
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
        if (!r) return `${cid}:⚠️missing`;
        if (r.status === 'pass') return `${cid}:✅`;
        if (r.status === 'fail') return `${cid}:❌`;
        return `${cid}:⏭️`;
      });
      const allPass = ac.linkedCaseIds.length > 0 && ac.linkedCaseIds.every(cid => {
        const r = resultMap.get(cid);
        return r?.status === 'pass';
      });
      const acStatus = ac.linkedCaseIds.length === 0
        ? '⚠️ no linked cases'
        : allPass ? '✅ PASS' : '❌ FAIL';
      md += `| ${ac.acId} | ${ac.description} | ${statuses.join(', ')} | ${acStatus} |\n`;
    }
    const acPassed = acTrace.filter(ac =>
      ac.linkedCaseIds.length > 0 && ac.linkedCaseIds.every(cid => {
        const r = resultMap.get(cid);
        return r?.status === 'pass';
      }),
    ).length;
    const acWithoutLinks = acTrace.filter(ac => ac.linkedCaseIds.length === 0).length;
    md += `\n**${acPassed}/${acTrace.length}** acceptance criteria passed.`;
    if (acWithoutLinks > 0) {
      md += ` ⚠️ ${acWithoutLinks} criteria have no linked test cases.`;
    }
    md += '\n\n';
  }

  return md;
}

export function collectVerifyData(root: string): VerifyData {
  const configPath = join(root, 'logos', 'logos.config.json');
  let resultPath = DEFAULT_RESULT_PATH;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.verify?.result_path) {
      resultPath = config.verify.result_path;
    }
  } catch { /* use default */ }

  const fullResultPath = join(root, resultPath);
  const results = parseJsonl(readFileSync(fullResultPath, 'utf-8'));
  const { ids: defined, utCount, stCount } = extractDefinedIds(root);

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
  const acFailed = acTrace.filter(ac =>
    ac.linkedCaseIds.length === 0 ||
    !ac.linkedCaseIds.every(cid => resultMap.get(cid)?.status === 'pass'),
  );

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

  // Generate the acceptance report (side effect, same as before)
  const reportPath = join(root, REPORT_DIR, 'acceptance-report.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, generateReport(
    defined, results, passed, failed, skipped, uncovered,
    String(coveragePct), String(passRatePct), gateResult, checklist, acTrace, resultIds,
  ));

  const relReportPath = 'logos/resources/verify/acceptance-report.md';

  return {
    summary: {
      defined_count: defined.length,
      ut_count: utCount,
      st_count: stCount,
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
      failed_criteria: acFailed.map(ac => ({
        ac_id: ac.acId,
        description: ac.description,
        linked_case_ids: ac.linkedCaseIds,
        status: ac.linkedCaseIds.length === 0 ? 'NO_LINKED_CASES' : 'FAIL',
      })),
    },
    report_path: relReportPath,
  };
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
  let resultPath = DEFAULT_RESULT_PATH;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.verify?.result_path) {
      resultPath = config.verify.result_path;
    }
  } catch { /* use default */ }

  const fullResultPath = join(root, resultPath);
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

  const data = collectVerifyData(root);

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

  const { summary, gate, failed_cases, uncovered_cases, checklist, ac_trace } = data;

  console.log(`\n${LINE}`);
  console.log(`📊 ${t(locale, 'verify.summary')}`);
  console.log(LINE);
  console.log(`  ${t(locale, 'verify.totalDefined', { count: String(summary.defined_count), ut: String(summary.ut_count), st: String(summary.st_count) })}`);
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

  if (gate.result !== 'PASS') {
    process.exit(1);
  }
}
