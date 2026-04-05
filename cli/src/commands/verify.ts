import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readLocale, t } from '../i18n.js';

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
const ID_PATTERN = /\b(UT|ST)-S\d{2}-\d{2,3}\b/g;
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
        const caseIdTest = /\b(UT|ST)-S\d{2}-\d{2,3}\b/;
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

export function verify() {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
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

  console.log(`\n🔍 ${t(locale, 'verify.title')}\n`);
  console.log(t(locale, 'verify.readingResults', { path: resultPath }));
  console.log(t(locale, 'verify.readingCases'));

  const fullResultPath = join(root, resultPath);
  if (!existsSync(fullResultPath)) {
    console.error(`\nError: ${t(locale, 'verify.noResults', { path: resultPath })}`);
    process.exit(1);
  }

  const results = parseJsonl(readFileSync(fullResultPath, 'utf-8'));
  const { ids: defined, utCount, stCount } = extractDefinedIds(root);

  if (defined.length === 0) {
    console.error(`\nError: ${t(locale, 'verify.noCases')}`);
    process.exit(1);
  }

  const resultIds = new Set(results.map(r => r.id));
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  const skipped = results.filter(r => r.status === 'skip');
  const uncovered = defined.filter(id => !resultIds.has(id));
  const coveredCount = defined.filter(id => resultIds.has(id)).length;

  const coveragePct = defined.length > 0
    ? ((coveredCount / defined.length) * 100).toFixed(0)
    : '0';
  const passRatePct = results.length > 0
    ? ((passed.length / results.length) * 100).toFixed(0)
    : '0';

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

  console.log(`\n${LINE}`);
  console.log(`📊 ${t(locale, 'verify.summary')}`);
  console.log(LINE);
  console.log(`  ${t(locale, 'verify.totalDefined', { count: String(defined.length), ut: String(utCount), st: String(stCount) })}`);
  console.log(`  ${t(locale, 'verify.totalExecuted', { count: String(results.length) })}`);
  console.log(`  ✅ ${t(locale, 'verify.passed', { count: String(passed.length) })}`);
  console.log(`  ❌ ${t(locale, 'verify.failed', { count: String(failed.length) })}`);
  console.log(`  ⏭️  ${t(locale, 'verify.skipped', { count: String(skipped.length) })}`);
  console.log(LINE);
  console.log(`  ${t(locale, 'verify.coverage', { pct: coveragePct, covered: String(coveredCount), total: String(defined.length) })}`);
  console.log(`  ${t(locale, 'verify.passRate', { pct: passRatePct, passed: String(passed.length), total: String(results.length) })}`);
  console.log(LINE);

  if (failed.length > 0) {
    console.log(`\n❌ ${t(locale, 'verify.failedCases')}`);
    for (const r of failed) {
      console.log(`  ${r.id}  ${r.error ?? ''}`);
    }
  }

  if (uncovered.length > 0) {
    console.log(`\n⚠️  ${t(locale, 'verify.uncoveredCases', { count: String(uncovered.length) })}`);
    for (const id of uncovered) {
      console.log(`  ${id}`);
    }
  }

  if (checklist.length > 0) {
    const checked = checklist.filter(c => c.checked).length;
    console.log(`\n📋 ${t(locale, 'verify.checklistTitle')}`);
    console.log(`  ${t(locale, 'verify.checklistSummary', { checked: String(checked), total: String(checklist.length) })}`);
    if (checklistUnchecked.length > 0) {
      console.log(`  ⚠️  ${t(locale, 'verify.checklistUnchecked', { count: String(checklistUnchecked.length) })}`);
      for (const item of checklistUnchecked) {
        console.log(`    - ${item.text}  (${item.file})`);
      }
    }
  }

  if (acTrace.length > 0) {
    const acPassed = acTrace.length - acFailed.length;
    console.log(`\n🔗 ${t(locale, 'verify.acTitle')}`);
    console.log(`  ${t(locale, 'verify.acSummary', { passed: String(acPassed), total: String(acTrace.length) })}`);
    if (acFailed.length > 0) {
      console.log(`  ⚠️  ${t(locale, 'verify.acFailed', { count: String(acFailed.length) })}`);
      for (const ac of acFailed) {
        const reason = ac.linkedCaseIds.length === 0 ? 'no linked cases' : 'case(s) not passing';
        console.log(`    ${ac.acId}: ${ac.description}  (${reason})`);
      }
    }
  }

  const reportPath = join(root, REPORT_DIR, 'acceptance-report.md');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, generateReport(
    defined, results, passed, failed, skipped, uncovered,
    coveragePct, passRatePct, gateResult, checklist, acTrace, resultIds,
  ));

  if (isPass) {
    console.log(`\n✅ ${t(locale, 'verify.gatePass')}`);
  } else if (failed.length > 0) {
    console.log(`\n❌ ${t(locale, 'verify.gateFail')}`);
  } else if (uncovered.length > 0) {
    console.log(`\n❌ ${t(locale, 'verify.gateFailCoverage')}`);
  } else if (checklistUnchecked.length > 0) {
    console.log(`\n❌ ${t(locale, 'verify.gateFailChecklist')}`);
  } else {
    console.log(`\n❌ ${t(locale, 'verify.gateFailAc')}`);
  }

  const relReportPath = 'logos/resources/verify/acceptance-report.md';
  console.log(`\n📄 ${t(locale, 'verify.reportPath', { path: relReportPath })}\n`);

  if (!isPass) {
    process.exit(1);
  }
}
