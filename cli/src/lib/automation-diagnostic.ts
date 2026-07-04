import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, relative, sep } from 'node:path';
import { readVerifyConfig } from './verify-config.js';
import { deriveSliceState } from './flow-loop-derive.js';
import type { LoopState, SliceState } from './flow-loop-derive.js';

export type CompletionState =
  | 'slice_done'
  | 'slice_done_global_verify_failed'
  | 'slice_incomplete'
  | 'invalid_done_claim'
  | 'no_progress';

export type AutomationDiagnosticReason =
  | 'artifact-missing'
  | 'artifact-out-of-scope'
  | 'focused-tests-missing'
  | 'reporter-missing'
  | 'global-verify-failed'
  | 'driver-cannot-validate-artifacts'
  | 'no-progress';

export interface AutomationDiagnostic {
  reason: AutomationDiagnosticReason;
  completion_state: CompletionState;
  failed_tests: string[];
  required_test_ids: string[];
  validated_artifacts: string[];
  missing_artifacts: string[];
  suggested_next_node: 'code' | 'plan-slices' | 'verify' | 'manual';
  human_action_required: boolean;
  remediation: string;
}

export interface DeriveAutomationDiagnosticOptions {
  proposalDir?: string | null;
  requiredTestIds?: string[];
  declaredArtifacts?: string[];
  allowedArtifactPrefixes?: string[];
  loopState?: LoopState | null;
  sliceState?: SliceState | null;
  verifyGate?: 'PASS' | 'FAIL' | null;
  failedTests?: string[];
}

export function canConsumeAutomationDiagnosticAtStep(step: string | null | undefined): boolean {
  return step === 'coding' || step === 'ready-to-verify' || step === 'verify-failed';
}

interface RuntimeResult {
  id: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
}

const TEST_ID_RE = /\b(?:UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*\b/g;
const DEFAULT_ALLOWED_PREFIXES = [
  'cli/src/',
  'cli/test/',
  'logos/changes/',
  'logos/resources/verify/',
  'test/',
  'tests/',
  'src/',
  'scripts/',
];

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractTestIds(text: string): string[] {
  return uniq([...text.matchAll(TEST_ID_RE)].map(match => match[0]));
}

function readFileIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function parseRuntimeResults(content: string): RuntimeResult[] {
  const rows = new Map<string, RuntimeResult>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RuntimeResult;
      if (parsed.id && ['pass', 'fail', 'skip'].includes(parsed.status)) {
        rows.set(parsed.id, parsed);
      }
    } catch {
      // 坏行不参与诊断。
    }
  }
  return Array.from(rows.values());
}

function readRuntimeResults(root: string): RuntimeResult[] {
  const config = readVerifyConfig(root);
  const resultPath = join(root, config.resultPath);
  return parseRuntimeResults(readFileIfExists(resultPath));
}

function readAcceptanceFailedTests(root: string): string[] {
  const report = readFileIfExists(join(root, 'logos', 'resources', 'verify', 'acceptance-report.md'));
  if (!report.trim()) return [];
  const failedSectionStart = report.indexOf('## Failed Cases');
  if (failedSectionStart === -1) return [];
  const failedSectionEnd = report.indexOf('\n## ', failedSectionStart + 1);
  const failedSection = failedSectionEnd === -1
    ? report.slice(failedSectionStart)
    : report.slice(failedSectionStart, failedSectionEnd);
  return extractTestIds(failedSection);
}

function relFromRoot(root: string, artifact: string): string {
  const normalized = artifact.replace(/\\/g, '/').trim();
  if (!normalized) return '';
  if (normalized.startsWith('/')) {
    const rel = relative(root, normalized).replace(/\\/g, '/');
    return rel.startsWith('..') ? normalized : rel;
  }
  return normalize(normalized).replace(/\\/g, '/').replace(/^\.\//, '');
}

function isSafeRelative(path: string): boolean {
  return Boolean(path) && !path.startsWith('..') && !path.includes(`${sep}..${sep}`) && !path.startsWith('/');
}

function isAllowedArtifact(path: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => path === prefix.replace(/\/$/, '') || path.startsWith(prefix));
}

function classifyArtifacts(
  root: string,
  declaredArtifacts: string[],
  allowedArtifactPrefixes: string[] | undefined,
): { validated: string[]; missing: string[]; outOfScope: string[] } {
  const prefixes = allowedArtifactPrefixes ?? DEFAULT_ALLOWED_PREFIXES;
  const validated: string[] = [];
  const missing: string[] = [];
  const outOfScope: string[] = [];

  for (const raw of declaredArtifacts) {
    const rel = relFromRoot(root, raw);
    if (!isSafeRelative(rel) || !isAllowedArtifact(rel, prefixes)) {
      outOfScope.push(rel || raw);
      continue;
    }
    const full = join(root, rel);
    if (!existsSync(full)) {
      missing.push(rel);
      continue;
    }
    try {
      if (statSync(full).isFile() || statSync(full).isDirectory()) validated.push(rel);
    } catch {
      missing.push(rel);
    }
  }
  return { validated: uniq(validated), missing: uniq(missing), outOfScope: uniq(outOfScope) };
}

function inferRequiredTestIdsFromProposal(proposalDir: string, sliceState?: SliceState | null): string[] {
  const tasks = readFileIfExists(join(proposalDir, 'tasks.md'));
  if (!tasks.trim()) return [];
  const ids = new Set<string>();

  if (sliceState?.current) {
    for (const id of extractTestIds(sliceState.current)) ids.add(id);
    for (const child of sliceState.current_children ?? []) {
      for (const id of extractTestIds(child.text)) ids.add(id);
    }
  }

  if (ids.size === 0) {
    const state = sliceState ?? deriveSliceState(proposalDir, tasks);
    if (state.current) {
      for (const id of extractTestIds(state.current)) ids.add(id);
      for (const child of state.current_children ?? []) {
        for (const id of extractTestIds(child.text)) ids.add(id);
      }
    }
  }

  if (ids.size === 0) {
    for (const id of extractTestIds(tasks)) ids.add(id);
  }

  return Array.from(ids);
}

function inferArtifactHintsFromProposal(proposalDir: string): string[] {
  const tasks = readFileIfExists(join(proposalDir, 'tasks.md'));
  const hints = new Set<string>();
  if (/\b业务代码|源码|CLI|状态派生|实现\b/i.test(tasks)) hints.add('cli/src/');
  if (/\bUT-|ST-|测试|reporter\b/i.test(tasks)) hints.add('cli/test/');
  if (/\bgolden|baseline\b/i.test(tasks)) hints.add('cli/test/');
  return Array.from(hints);
}

function build(
  reason: AutomationDiagnosticReason,
  completionState: CompletionState,
  values: Omit<AutomationDiagnostic, 'reason' | 'completion_state'>,
): AutomationDiagnostic {
  return { reason, completion_state: completionState, ...values };
}

export function deriveAutomationDiagnostic(
  root: string,
  opts: DeriveAutomationDiagnosticOptions = {},
): AutomationDiagnostic | null {
  const proposalDir = opts.proposalDir ?? null;
  const runtimeResults = readRuntimeResults(root);
  const runtimeById = new Map(runtimeResults.map(result => [result.id, result]));
  const failedTests = uniq([
    ...(opts.failedTests ?? []),
    ...runtimeResults.filter(result => result.status === 'fail').map(result => result.id),
    ...readAcceptanceFailedTests(root),
  ]);
  const requiredTestIds = uniq([
    ...(opts.requiredTestIds ?? []),
    ...(proposalDir ? inferRequiredTestIdsFromProposal(proposalDir, opts.sliceState) : []),
  ]);
  const declaredArtifacts = opts.declaredArtifacts ?? [];
  const artifactCheck = classifyArtifacts(root, declaredArtifacts, opts.allowedArtifactPrefixes);
  const artifactHints = proposalDir ? inferArtifactHintsFromProposal(proposalDir) : [];
  const validatedArtifacts = artifactCheck.validated;
  const missingArtifacts = uniq([...artifactCheck.missing, ...artifactHints.filter(hint =>
    declaredArtifacts.length > 0 && !validatedArtifacts.some(path => path.startsWith(hint)),
  )]);
  const base = {
    failed_tests: failedTests,
    required_test_ids: requiredTestIds,
    validated_artifacts: validatedArtifacts,
    missing_artifacts: missingArtifacts,
    suggested_next_node: 'code' as const,
    human_action_required: false,
    remediation: '',
  };

  if (artifactCheck.outOfScope.length > 0) {
    return build('artifact-out-of-scope', 'invalid_done_claim', {
      ...base,
      missing_artifacts: uniq([...missingArtifacts, ...artifactCheck.outOfScope]),
      suggested_next_node: 'manual',
      human_action_required: true,
      remediation: '移除越界 artifact 声明，或由人类确认该路径属于当前工作单元后重新校验。',
    });
  }

  if (missingArtifacts.length > 0) {
    return build('artifact-missing', 'slice_incomplete', {
      ...base,
      missing_artifacts: missingArtifacts,
      remediation: '补齐缺失 artifact，或更正 done --artifacts 后重新校验当前切片。',
    });
  }

  if (requiredTestIds.length > 0) {
    const missingFocused = requiredTestIds.filter(id => !runtimeById.has(id));
    if (runtimeResults.length === 0) {
      return build('reporter-missing', 'slice_incomplete', {
        ...base,
        missing_artifacts: ['logos/resources/verify/test-results.jsonl'],
        remediation: '运行该切片对应测试并确保 OpenLogos reporter 写入 test-results.jsonl。',
      });
    }
    if (missingFocused.length > 0) {
      return build('focused-tests-missing', 'slice_incomplete', {
        ...base,
        missing_artifacts: missingFocused,
        remediation: '补跑当前切片要求的 focused tests，或补齐测试代码中的 OpenLogos reporter ID。',
      });
    }
    const focusedFailed = requiredTestIds.filter(id => runtimeById.get(id)?.status !== 'pass');
    if (focusedFailed.length > 0) {
      return build('focused-tests-missing', 'slice_incomplete', {
        ...base,
        failed_tests: uniq([...failedTests, ...focusedFailed]),
        remediation: '修复当前切片 focused tests 后重新运行 verify。',
      });
    }
  }

  const loopHasFailureEvidence = opts.loopState?.converged === false
    && opts.loopState.iteration > 0;
  const verifyFailed = opts.verifyGate === 'FAIL' || failedTests.length > 0 || loopHasFailureEvidence;
  const hasLocalEvidence = validatedArtifacts.length > 0
    || requiredTestIds.some(id => runtimeById.get(id)?.status === 'pass')
    || runtimeResults.some(result => result.status === 'pass');
  const sliceAttempted = opts.verifyGate != null
    || failedTests.length > 0
    || (opts.loopState?.iteration ?? 0) > 0
    || (opts.sliceState?.done ?? 0) > 0
    || validatedArtifacts.length > 0
    || declaredArtifacts.length > 0;

  if (verifyFailed && hasLocalEvidence) {
    return build('global-verify-failed', 'slice_done_global_verify_failed', {
      ...base,
      suggested_next_node: 'code',
      remediation: '当前切片局部证据成立，但全量 verify 仍失败；按 failed_tests 派发 repair/code 修复后重跑 verify。',
    });
  }

  if (verifyFailed && !hasLocalEvidence && opts.loopState && opts.loopState.iteration > 0) {
    return build('no-progress', 'no_progress', {
      ...base,
      suggested_next_node: opts.loopState.escalated ? 'manual' : 'code',
      human_action_required: opts.loopState.escalated,
      remediation: opts.loopState.escalated
        ? '多轮无本地证据推进，已达到 loop 上限；需要人类决定继续、调整或放弃。'
        : '本轮缺少 artifact 或 reporter 证据，重派当前切片并要求明确产物与测试结果。',
    });
  }

  if (sliceAttempted && (validatedArtifacts.length > 0 || requiredTestIds.some(id => runtimeById.get(id)?.status === 'pass'))) {
    return build('driver-cannot-validate-artifacts', 'slice_done', {
      ...base,
      suggested_next_node: 'verify',
      remediation: '局部证据已存在；若 driver 仍无法判定，请补充 artifacts 校验规则或重新运行全量 verify。',
    });
  }

  return null;
}
