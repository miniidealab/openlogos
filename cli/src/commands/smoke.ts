import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { readLocale, t } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { normalizeSandboxConfig, runSandboxedCommand, buildInitialSandboxData, type SandboxData } from '../lib/sandbox.js';
import { parseJsonl } from './verify.js';
import {
  checkSmokeCoverage,
  resolveSmokeCommand,
  extractSmokeIdsFromContent,
  type SmokeCoverageCheck,
  type SmokeCoverageDiagnostic,
} from '../lib/smoke-coverage.js';
import { evaluateSmokePrecondition, readDeployDoneMarker, readLifecycleFacts } from '../lib/lifecycle-gate.js';
import type { LifecycleFacts } from '../lib/lifecycle-gate.js';
import {
  ENV_REGISTRY_REL, computeVerified, isDeployExecutionEnabled, loadEnvironmentRegistry, readDeploymentLedger, resolveEnvironment,
} from '../lib/environments.js';
import { DEPLOY_LEDGER_REL } from '../lib/environments.js';
import type { DeployLedgerRecord, EnvEvidence, SmokeLedgerRecord } from '../lib/environments.js';
import { appendLedgerLine, removeOwnLedgerLine } from '../lib/deployment-ledger.js';
import type { Locale } from '../i18n.js';

const DEFAULT_SMOKE_RESULT_PATH = 'logos/resources/verify/smoke-results.jsonl';
const DEFAULT_SMOKE_REPORT_PATH = 'logos/resources/verify/smoke-report.md';
const SMOKE_CASES_DIR = 'logos/resources/test/smoke';

export interface SmokeData {
  environment: string | null;
  summary: {
    defined_count: number;
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
  changed_cases: string[];
  diagnostics: SmokeCoverageDiagnostic[];
  runners: string[];
  failed_cases: Array<{ id: string; error: string }>;
  uncovered_cases: string[];
  skipped_cases: string[];
  /**
   * 本提案新增 / 修改的 smoke 用例中以 skip 结束者（携带 runner 写入的缺失项说明）。这些用例是本次部署的必要证据，
   * skip 只说明未取得证据，门禁据此 FAIL（各提案 smoke 规格「有 skip 时不得写 SMOKE_PASS」）。仅非空时出现。
   */
  required_skipped_cases?: Array<{ id: string; detail: string }>;
  /**
   * 本提案变更用例中以 `reason_code:"platform-unavailable"` 且 `detail` 非空放行的 skip（功能规格 §2.48.5「平台不可执行
   * 例外」，verify-smoke-guard-fixes-0-15-20 决策 C03）：当前平台不能执行该用例，skip 即终态；单独列出供审计。仅非空时出现。
   */
  platform_skipped_cases?: Array<{ id: string; detail: string }>;
  sandbox: SandboxData;
  report_path: string;
  result_path: string;
  /** environment-registry：仅在项目存在 logos/environments.yaml 时输出（spec/cli-json-output.md）。 */
  environment_evidence?: SmokeEnvironmentEvidence;
}

/** smoke 环境证据（spec/environments.md §5.2、§6）。 */
export interface SmokeEnvironmentEvidence {
  target: string;
  deploy_id: string | null;
  ref: string | null;
  deploy_env_confirmed: boolean;
  env_evidence: EnvEvidence;
  mismatched_case_ids: string[];
  missing_case_ids: string[];
  fresh_results: boolean;
  verified: boolean;
  ledger_written: boolean;
}

/** smoke 的环境上下文：环境解析结果与所依据的 DEPLOY_DONE（无活跃提案时 deploy 信息为空、未确认）。 */
interface SmokeEnvContext {
  registryPresent: boolean;
  target: string | null;
  slug: string | null;
  deployId: string | null;
  ref: string | null;
  deployEnvConfirmed: boolean;
  /**
   * 部署执行已启用（spec/environments.md §1，environment-deploy）：启用时做部署身份核对（§4.2），
   * 无活跃提案时也写账本（slug 为 null）。未启用时 smoke 行为与引入部署执行前逐字一致。
   */
  deployEnabled: boolean;
}

function smokeReject(format: OutputFormat, code: string, message: string, extra?: Record<string, unknown>): never {
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope('smoke', code, message, extra)));
  } else {
    console.error(`Error: [${code}] ${message}`);
  }
  process.exit(1);
}

/**
 * environment-registry：环境解析（spec/environments.md §3）与 DEPLOY_DONE 分类（§4.2）。
 * 在既有 fail-closed 前置之后、运行 smoke.command 之前执行；任一拒绝零副作用。
 * 无活跃提案（facts 为 null）时沿用既有行为：不读 marker、部署环境未确认。
 */
function resolveSmokeEnvironment(
  root: string, environment: string | undefined, facts: LifecycleFacts | null, format: OutputFormat, locale: Locale,
): SmokeEnvContext {
  const reg = loadEnvironmentRegistry(root);
  let target: string | null = environment ?? null;
  if (reg.state !== 'absent') {
    if (reg.state === 'unloadable' || reg.errors.length > 0) {
      const reason = reg.state === 'unloadable'
        ? reg.error.reason
        : reg.errors.map(e => `${e.environment ?? ''}.${e.field ?? ''}: ${e.reason}`).join('; ');
      smokeReject(format, 'ENV_REGISTRY_INVALID', t(locale, 'smoke.env.registryInvalid', { path: ENV_REGISTRY_REL, reason }));
    }
    const available = reg.environments.map(e => e.id).join(', ');
    if (environment === undefined || environment.trim() === '') {
      smokeReject(format, 'ENV_REQUIRED', t(locale, 'smoke.env.required', { available }));
    }
    const resolved = resolveEnvironment(reg.environments, environment);
    if (!resolved.ok) smokeReject(format, 'ENV_UNKNOWN', t(locale, 'smoke.env.unknown', { input: environment, available }));
    target = resolved.id;
  }

  const ctx: SmokeEnvContext = {
    registryPresent: reg.state !== 'absent', target, slug: facts?.slug ?? null, deployId: null, ref: null, deployEnvConfirmed: false,
    deployEnabled: false,
  };
  // 部署身份核对的依据：账本中该环境最近一条 deploy 记录（任意 result；同一 deploy_id 以最后一行为准）
  let latestDeploy: DeployLedgerRecord | null = null;
  if (reg.state === 'loaded' && target !== null) {
    const ledger = readDeploymentLedger(root);
    ctx.deployEnabled = isDeployExecutionEnabled(reg.environments, ledger);
    latestDeploy = ledger.byEnvironment.get(target)?.lastDeploy ?? null;
  }
  if (!facts) {
    if (ctx.deployEnabled && latestDeploy) {
      // 无活跃提案（environment-deploy，决策 C15）：部署身份取自账本记录
      ctx.deployId = latestDeploy.deploy_id;
      ctx.ref = latestDeploy.ref;
      ctx.deployEnvConfirmed = latestDeploy.result === 'done';
    }
    return ctx;
  }
  const cls = readDeployDoneMarker(facts.proposalDir);
  if (cls.kind === 'unreadable') {
    // 读取失败不能证明文件属于旧空格式：零副作用拒绝并保留 I/O 原因（code-r1 F1）
    smokeReject(format, 'SMOKE_DEPLOY_MARKER_INVALID', t(locale, 'smoke.env.markerUnreadable', { reason: cls.reason }),
      { details: { problems: ['unreadable'], reason: cls.reason } });
  }
  if (cls.kind === 'invalid') {
    smokeReject(format, 'SMOKE_DEPLOY_MARKER_INVALID', t(locale, 'smoke.env.markerInvalid', { problems: cls.problems.join(', ') }),
      { details: { problems: cls.problems } }); // spec/cli-json-output.md：error.details.problems 点名问题字段
  }
  if (cls.kind === 'valid') {
    ctx.deployId = cls.marker.deploy_id;
    ctx.ref = cls.marker.ref;
    if (cls.marker.environment !== null && target !== null) {
      if (cls.marker.environment === target) {
        ctx.deployEnvConfirmed = true;
      } else if (ctx.registryPresent) {
        smokeReject(format, 'SMOKE_ENV_MISMATCH', t(locale, 'smoke.env.mismatch', { deployed: cls.marker.environment, target }));
      }
    }
    // 部署身份核对（决策 C15）：提案落标之后该环境又被部署过时，marker 已不代表环境当前部署，零副作用拒绝
    if (ctx.deployEnabled && latestDeploy && latestDeploy.deploy_id !== cls.marker.deploy_id) {
      smokeReject(format, 'SMOKE_DEPLOY_SUPERSEDED', t(locale, 'smoke.env.superseded', {
        marker: cls.marker.deploy_id, latest: latestDeploy.deploy_id, channel: latestDeploy.channel ?? 'proposal', result: latestDeploy.result,
      }), {
        details: {
          marker: { deploy_id: cls.marker.deploy_id, ref: cls.marker.ref },
          latest: {
            deploy_id: latestDeploy.deploy_id, ref: latestDeploy.ref, channel: latestDeploy.channel ?? 'proposal', result: latestDeploy.result,
          },
        },
      });
    }
  }
  return ctx;
}

/** 按计入门禁的结果行判定环境证据（spec/environments.md §6）。 */
function evaluateEnvEvidence(rows: Array<Record<string, unknown>>, target: string): {
  env_evidence: EnvEvidence; mismatched: string[]; missing: string[];
} {
  const mismatched: string[] = [];
  const missing: string[] = [];
  for (const row of rows) {
    const id = String(row.id);
    if (!Object.prototype.hasOwnProperty.call(row, 'target_environment') || row.target_environment === undefined) missing.push(id);
    else if (row.target_environment !== target) mismatched.push(id);
  }
  const env_evidence: EnvEvidence = mismatched.length > 0
    ? 'mismatch'
    : (rows.length > 0 && missing.length === 0 ? 'declared' : 'missing');
  return { env_evidence, mismatched, missing };
}

/** 调用时 HEAD 与工作区状态：只作观察信息，不作为 smoke 记录的版本（版本继承 DEPLOY_DONE）。 */
function observeWorkspace(root: string): { head: string | null; dirty: boolean | null } {
  const run = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf-8', timeout: 30_000 });
  const head = run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const status = run(['status', '--porcelain']);
  const headOut = (head.stdout ?? '').trim();
  return {
    head: !head.error && head.status === 0 && /^[0-9a-f]{40}$/.test(headOut) ? headOut : null,
    dirty: !status.error && status.status === 0 ? (status.stdout ?? '').trim().length > 0 : null,
  };
}

export function extractSmokeDefinedIds(root: string): string[] {
  const dir = join(root, SMOKE_CASES_DIR);
  if (!existsSync(dir)) return [];

  const ids = new Set<string>();
  try {
    const files = readdirSync(dir, { recursive: true })
      .map(f => String(f))
      .filter(f => f.endsWith('.md'));

    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf-8');
      for (const id of extractSmokeIdsFromContent(content)) ids.add(id);
    }
  } catch { /* directory read error */ }

  return Array.from(ids).sort();
}

function readSmokeResults(root: string, resultPath: string) {
  const fullResultPath = join(root, resultPath);
  return existsSync(fullResultPath) ? parseJsonl(readFileSync(fullResultPath, 'utf-8')) : [];
}

function generateSmokeReport(data: SmokeData): string {
  const now = new Date().toISOString().slice(0, 10);
  let md = `# Smoke Report\n\n> Generated by \`openlogos smoke\` on ${now}\n`;
  if (data.environment) md += `> Environment: ${data.environment}\n`;
  md += '\n## Summary\n\n';
  md += '| Metric | Value |\n|--------|-------|\n';
  md += `| Defined cases | ${data.summary.defined_count} |\n`;
  md += `| Executed cases | ${data.summary.executed_count} |\n`;
  md += `| Passed | ${data.summary.passed_count} |\n`;
  md += `| Failed | ${data.summary.failed_count} |\n`;
  md += `| Skipped | ${data.summary.skipped_count} |\n`;
  md += `| Uncovered | ${data.summary.uncovered_count} |\n`;
  md += `| Coverage | ${data.summary.coverage_pct}% |\n`;
  md += `| Pass rate | ${data.summary.pass_rate_pct}% |\n`;
  md += `| **Gate 3.8** | **${data.gate.result}** |\n\n`;

  if (data.failed_cases.length > 0) {
    md += '## Failed Cases\n\n| ID | Error |\n|----|-------|\n';
    for (const item of data.failed_cases) {
      md += `| ${item.id} | ${item.error.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
    }
    md += '\n';
  }

  if (data.uncovered_cases.length > 0) {
    md += '## Uncovered Cases\n\n';
    for (const id of data.uncovered_cases) md += `- ${id}\n`;
    md += '\n';
  }

  if (data.diagnostics.length > 0) {
    md += '## Diagnostics\n\n| Code | Message | Cases |\n|------|---------|-------|\n';
    for (const item of data.diagnostics) {
      md += `| ${item.code} | ${item.message.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${(item.case_ids ?? []).join(', ')} |\n`;
    }
    md += '\n';
  }

  if (data.platform_skipped_cases && data.platform_skipped_cases.length > 0) {
    md += '## Platform-Unavailable Skips（平台不可执行）\n\n| ID | Detail |\n|----|--------|\n';
    for (const item of data.platform_skipped_cases) {
      md += `| ${item.id} | ${item.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
    }
    md += '\n';
  }

  if (data.required_skipped_cases && data.required_skipped_cases.length > 0) {
    md += '## Required Cases Without Evidence\n\n| ID | Detail |\n|----|--------|\n';
    for (const item of data.required_skipped_cases) {
      md += `| ${item.id} | ${item.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |\n`;
    }
    md += '\n';
  }

  if (data.skipped_cases.length > 0) {
    md += '## Skipped Cases\n\n';
    for (const id of data.skipped_cases) md += `- ${id}\n`;
    md += '\n';
  }

  return md;
}

export function collectSmokeData(
  root: string,
  environment?: string,
  sandbox?: SandboxData,
  coverageCheck?: SmokeCoverageCheck,
): SmokeData {
  const configPath = join(root, 'logos', 'logos.config.json');
  let resultPath = DEFAULT_SMOKE_RESULT_PATH;
  let reportPath = DEFAULT_SMOKE_REPORT_PATH;

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.smoke?.result_path) resultPath = config.smoke.result_path;
    if (config.smoke?.report_path) reportPath = config.smoke.report_path;
  } catch { /* use defaults */ }

  const check = coverageCheck ?? checkSmokeCoverage(root, { resultPath });
  const results = readSmokeResults(root, resultPath);
  const defined = extractSmokeDefinedIds(root);
  const resultIds = new Set(results.map(r => r.id));
  const passed = results.filter(r => r.status === 'pass');
  const failed = results.filter(r => r.status === 'fail');
  const skipped = results.filter(r => r.status === 'skip');
  const uncovered = defined.filter(id => !resultIds.has(id));
  const coveredCount = defined.filter(id => resultIds.has(id)).length;

  const coveragePct = defined.length > 0 ? Math.round((coveredCount / defined.length) * 100) : 0;
  const passRatePct = results.length > 0 ? Math.round(((passed.length + skipped.length) / results.length) * 100) : 0;
  // 必要证据缺失：本提案新增 / 修改的 smoke 用例以 skip 结束。历史 runner 的「不适用」skip 不在本提案变更集合内，
  // 统计口径不变（计入 executed、不计入 failed / uncovered）。
  const changedSet = new Set(check.changed_case_ids);
  // 平台不可执行例外（§2.48.5，决策 C03）：runner 声明 reason_code==="platform-unavailable" 且 detail 非空时放行；
  // 是否「不可执行」由 runner 声明，CLI 只核对声明完整。缺原因码、其他原因码或 detail 为空仍属必要证据缺失。
  const isPlatformSkip = (r: { reason_code?: unknown; detail?: unknown }) =>
    r.reason_code === 'platform-unavailable' && typeof r.detail === 'string' && r.detail.trim() !== '';
  const changedSkipped = skipped.filter(r => changedSet.has(r.id));
  const platformSkipped = changedSkipped.filter(r => isPlatformSkip(r as { reason_code?: unknown; detail?: unknown }))
    .map(r => ({ id: r.id, detail: String((r as { detail?: unknown }).detail) }));
  const requiredSkipped = changedSkipped.filter(r => !isPlatformSkip(r as { reason_code?: unknown; detail?: unknown }))
    .map(r => ({ id: r.id, detail: String((r as { detail?: unknown }).detail ?? r.error ?? '') }));
  const isPass = failed.length === 0 && uncovered.length === 0 && check.diagnostics.length === 0
    && requiredSkipped.length === 0;
  let reason: string | null = null;
  if (!isPass) {
    if (failed.length > 0) reason = 'failed_cases';
    else if (check.diagnostics.length > 0) reason = check.diagnostics[0].code;
    else if (requiredSkipped.length > 0) reason = 'required_cases_skipped';
    else reason = 'incomplete_coverage';
  }

  const data: SmokeData = {
    environment: environment ?? null,
    summary: {
      defined_count: defined.length,
      executed_count: results.length,
      passed_count: passed.length,
      failed_count: failed.length,
      skipped_count: skipped.length,
      uncovered_count: uncovered.length,
      coverage_pct: coveragePct,
      pass_rate_pct: passRatePct,
    },
    gate: {
      result: isPass ? 'PASS' : 'FAIL',
      reason,
    },
    changed_cases: check.changed_case_ids,
    diagnostics: check.diagnostics,
    runners: check.runners,
    failed_cases: failed.map(r => ({ id: r.id, error: r.error ?? 'unknown' })),
    uncovered_cases: uncovered,
    skipped_cases: skipped.map(r => r.id),
    ...(requiredSkipped.length > 0 ? { required_skipped_cases: requiredSkipped } : {}),
    ...(platformSkipped.length > 0 ? { platform_skipped_cases: platformSkipped } : {}),
    sandbox: sandbox ?? buildInitialSandboxData(normalizeSandboxConfig({ sandbox_mode: 'auto' })),
    report_path: reportPath,
    result_path: resultPath,
  };

  const fullReportPath = join(root, reportPath);
  mkdirSync(dirname(fullReportPath), { recursive: true });
  writeFileSync(fullReportPath, generateSmokeReport(data));

  return data;
}

function readSmokeConfig(root: string): {
  command?: string;
  resultPath: string;
  reportPath: string;
  sandbox: ReturnType<typeof normalizeSandboxConfig>;
} {
  const configPath = join(root, 'logos', 'logos.config.json');
  let resultPath = DEFAULT_SMOKE_RESULT_PATH;
  let reportPath = DEFAULT_SMOKE_REPORT_PATH;
  let command: string | undefined;
  let sandbox = normalizeSandboxConfig({});
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.smoke?.result_path) resultPath = config.smoke.result_path;
    if (config.smoke?.report_path) reportPath = config.smoke.report_path;
    if (config.smoke?.command) command = config.smoke.command;
    sandbox = normalizeSandboxConfig(config.smoke);
  } catch { /* use defaults */ }
  return { command: resolveSmokeCommand(root, command) ?? undefined, resultPath, reportPath, sandbox };
}

/**
 * 写账本路径上 smoke marker 与账本的写入口（fix-environment-registry-review-gaps 决策 C02）。
 * 缺省为真实文件系统与账本锁；测试据此注入失败以构造标记阶段失败与恢复失败（UT-S19-69～UT-S19-71）。
 */
export interface SmokeWriteIo {
  writeMarker(path: string, content: string | Buffer): void;
  removeMarker(path: string): void;
  appendLedger(root: string, line: string): void;
  removeOwnLedger(root: string, line: string, removeIfEmpty: boolean): 'removed' | 'absent';
}

export const defaultSmokeWriteIo: SmokeWriteIo = {
  writeMarker: (path, content) => writeFileSync(path, content),
  removeMarker: path => rmSync(path, { force: true }),
  appendLedger: (root, line) => appendLedgerLine(root, line),
  removeOwnLedger: (root, line, removeIfEmpty) => removeOwnLedgerLine(root, line, removeIfEmpty),
};

/** 标记阶段失败后未能恢复的位置及原因（`error.details.rollback_problems` 的元素）。 */
export interface SmokeRollbackProblem {
  path: string;
  reason: string;
}

/** smoke 侧运行选项（功能规格 §2.91.7，S19「smoke 沙箱复用」规则 4）。 */
export interface SmokeRunOptions {
  freshSandbox?: boolean;
  /** 仅供测试注入：写账本路径上的标记与账本写入口（未给出的项用缺省实现）。 */
  writeIo?: Partial<SmokeWriteIo>;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function smoke(format: OutputFormat = 'text', environment?: string, runOptions: SmokeRunOptions = {}) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'smoke', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const locale = readLocale(root);

  // §2.67.1 前置 fail-closed 门：在读取配置、执行 smoke.command、进入 sandbox 之前判定。
  // 顺序 ①→②→③→④ 命中即停，只报第一个错误码；拒绝时零副作用——尤其不得先清空
  // smoke-results.jsonl（下方 command 分支会截断该文件），也绝不补写 DEPLOY_DONE。
  const facts = readLifecycleFacts(root);
  if (facts) {
    const rejection = evaluateSmokePrecondition(facts, (key, vars) => t(locale, key, vars));
    if (rejection) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('smoke', rejection.code, rejection.message)));
      } else {
        console.error(`Error: [${rejection.code}] ${rejection.message}`);
      }
      process.exit(1);
    }
  }

  // environment-registry：环境解析与 DEPLOY_DONE 分类（拒绝时零副作用，排在运行 smoke.command 之前）
  const envCtx = resolveSmokeEnvironment(root, environment, facts, format, locale);
  // 有登记表时 JSON / 报告中的 environment 为解析后的 id；无登记表时为原始标签（逐字不变）
  const reportedEnvironment = envCtx.target ?? undefined;

  const { command, resultPath, reportPath, sandbox } = readSmokeConfig(root);
  const allowedWritePaths = [resultPath, reportPath, 'logos/resources/verify/smoke-report.md'];
  let sandboxData = buildInitialSandboxData(sandbox);
  // 只有本次实际运行 smoke.command（运行前清空结果文件）时，结果才属于这次部署
  const freshResults = Boolean(command);

  if (command) {
    // 每次执行已配置的 smoke.command 都必须从空账本开始。
    // 否则上一次部署留下的 pass/skip 会被当成本轮真实结果，形成伪覆盖。
    const fullResultPath = join(root, resultPath);
    mkdirSync(dirname(fullResultPath), { recursive: true });
    writeFileSync(fullResultPath, '');

    if (format !== 'json') console.log(`\n⚙️  Running smoke.command: ${command}`);
    const result = runSandboxedCommand({
      root,
      command,
      format,
      sandbox,
      allowedWritePaths,
      freshSandbox: runOptions.freshSandbox === true,
      ...(envCtx.registryPresent && envCtx.target !== null ? { extraEnv: { OPENLOGOS_SMOKE_ENV: envCtx.target } } : {}),
    });
    sandboxData = result.sandbox;
    if (result.command.status === 'fail') {
      if (format !== 'json') {
        console.warn('\n⚠️  smoke.command exited with non-zero status. Continuing smoke with existing results.');
      }
    }
  }

  const coverageCheck = checkSmokeCoverage(root, { command, resultPath });
  const io: SmokeWriteIo = { ...defaultSmokeWriteIo, ...runOptions.writeIo };

  /**
   * 门禁结论的统一收尾（code-r1 F3）：环境证据（spec/environments.md §6）→ 账本 smoke 行（§5.1）→ smoke marker。
   * 所有已形成 PASS / FAIL 结论的路径都必须经过这里，不得在输出前提前返回而遗漏证据与账本。
   */
  const finalizeVerdict = (data: SmokeData): void => {
    let evidence: SmokeEnvironmentEvidence | null = null;
    if (envCtx.target !== null) {
      const rows = readSmokeResults(root, resultPath) as unknown as Array<Record<string, unknown>>;
      const judged = evaluateEnvEvidence(rows, envCtx.target);
      if (envCtx.registryPresent && judged.env_evidence === 'mismatch' && data.gate.result === 'PASS') {
        data.gate.result = 'FAIL';
        data.gate.reason = 'SMOKE_ENV_EVIDENCE_MISMATCH';
      }
      const result: 'pass' | 'fail' = data.gate.result === 'PASS' ? 'pass' : 'fail';
      evidence = {
        target: envCtx.target,
        deploy_id: envCtx.deployId,
        ref: envCtx.ref,
        deploy_env_confirmed: envCtx.deployEnvConfirmed,
        env_evidence: judged.env_evidence,
        mismatched_case_ids: judged.mismatched,
        missing_case_ids: judged.missing,
        fresh_results: freshResults,
        verified: computeVerified({
          result, env_evidence: judged.env_evidence, fresh_results: freshResults,
          deploy_env_confirmed: envCtx.deployEnvConfirmed, ref: envCtx.ref,
        }),
        ledger_written: false,
      };
      if (envCtx.registryPresent) {
        data.environment_evidence = evidence;
        // 门禁结论可能被环境证据改写：按最终 data 重写报告
        writeFileSync(join(root, data.report_path), generateSmokeReport(data));
      }
    }

    // 存在活跃提案且传入 --env 时先追加账本 smoke 行、再写 smoke marker（spec/environments.md §5.1，决策 C02）
    // 部署执行已启用而无活跃提案时也写账本（slug 为 null，只写账本、不写提案标记；environment-deploy 决策 C15）
    if (evidence && (envCtx.slug !== null || envCtx.deployEnabled)) {
      writeLedgerThenMarkers(data, evidence, envCtx.slug);
      return;
    }

    // 不写账本时（未传 --env 或无活跃提案）沿用既有行为：按 guard 写 marker，失败静默跳过
    const guardPath = join(root, 'logos', '.openlogos-guard');
    if (existsSync(guardPath)) {
      try {
        const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
        const slug = guard.activeChange;
        if (slug) {
          const proposalDir = join(root, 'logos', 'changes', slug);
          if (existsSync(proposalDir)) {
            if (data.gate.result === 'PASS') {
              writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
              const failPath = join(proposalDir, 'SMOKE_FAIL');
              if (existsSync(failPath)) rmSync(failPath, { force: true });
            } else {
              writeFileSync(join(proposalDir, 'SMOKE_FAIL'), '');
              const passPath = join(proposalDir, 'SMOKE_PASS');
              if (existsSync(passPath)) rmSync(passPath, { force: true });
            }
          }
        }
      } catch { /* guard 文件读取失败时静默跳过 */ }
    }
  };

  /**
   * 账本先写、标记后写（EX-19.20、EX-19.21）：账本追加失败不碰任何 marker；账本已写后标记阶段任一步失败，
   * 按变更前快照恢复两种 marker 并撤销本次账本行。失败以 SMOKE_LEDGER_WRITE_FAILED 结束，恢复动作逐项捕获。
   */
  const writeLedgerThenMarkers = (data: SmokeData, evidence: SmokeEnvironmentEvidence, slug: string | null): void => {
    const gateResult = data.gate.result;
    const ledgerFailure = (stage: 'ledger' | 'marker', message: string, details: Record<string, unknown>): never =>
      smokeReject(format, 'SMOKE_LEDGER_WRITE_FAILED', message, { details: { stage, ...details, gate_result: gateResult } });

    const observed = observeWorkspace(root);
    const record: SmokeLedgerRecord = {
      kind: 'smoke',
      environment: evidence.target,
      slug,
      recorded_at: new Date().toISOString(),
      observed_head: observed.head,
      observed_dirty: observed.dirty,
      deploy_id: evidence.deploy_id,
      ref: evidence.ref,
      result: gateResult === 'PASS' ? 'pass' : 'fail',
      env_evidence: evidence.env_evidence,
      fresh_results: evidence.fresh_results,
      deploy_env_confirmed: evidence.deploy_env_confirmed,
      verified: evidence.verified,
    };
    const line = `${JSON.stringify(record)}\n`;
    const ledgerExisted = existsSync(join(root, DEPLOY_LEDGER_REL));
    let appendError: unknown = null;
    try {
      // 与 deploy-done 共用账本锁（code-r2 F2）。抛错即账本保持调用前字节：末行缺换行时原样拒绝，追加经临时文件
      // 原子替换、失败不留残片；释放锁失败不算追加失败（code-r1 F1、F2，code-r2 F1）
      io.appendLedger(root, line);
    } catch (error) {
      appendError = error;
    }
    if (appendError !== null) {
      const reason = errorReason(appendError);
      ledgerFailure('ledger', t(locale, 'smoke.ledger.appendFailed', { reason, gate: gateResult }), { reason });
    }
    evidence.ledger_written = true;
    // 无活跃提案：没有提案标记阶段
    if (slug === null) return;

    const proposalRel = `logos/changes/${slug}`;
    const proposalDir = join(root, proposalRel);
    if (!existsSync(proposalDir)) return;
    const names = ['SMOKE_PASS', 'SMOKE_FAIL'] as const;
    const target = gateResult === 'PASS' ? 'SMOKE_PASS' : 'SMOKE_FAIL';
    const other = gateResult === 'PASS' ? 'SMOKE_FAIL' : 'SMOKE_PASS';
    let snapshot: Map<string, Buffer | null> | null = null;
    let markerError: unknown = null;
    try {
      // 变更 marker 前快照两种 marker 的存在性与原始字节
      snapshot = new Map(names.map(name => {
        const path = join(proposalDir, name);
        return [name, existsSync(path) ? readFileSync(path) : null] as [string, Buffer | null];
      }));
      io.writeMarker(join(proposalDir, target), '');
      const otherPath = join(proposalDir, other);
      if (existsSync(otherPath)) io.removeMarker(otherPath);
    } catch (error) {
      markerError = error;
    }
    if (markerError === null) return;

    const problems: SmokeRollbackProblem[] = [];
    const attempt = (path: string, fn: () => void) => {
      try { fn(); } catch (error) { problems.push({ path, reason: errorReason(error) }); }
    };
    // 快照未取得时 marker 尚未被改动，只需撤销账本行
    for (const [name, before] of snapshot ?? []) {
      const path = join(proposalDir, name);
      attempt(`${proposalRel}/${name}`, () => {
        if (before === null) {
          if (existsSync(path)) io.removeMarker(path);
        } else if (!existsSync(path) || !readFileSync(path).equals(before)) {
          io.writeMarker(path, before);
        }
      });
    }
    attempt(DEPLOY_LEDGER_REL, () => { io.removeOwnLedger(root, line, !ledgerExisted); });

    const reason = errorReason(markerError);
    const rollback = problems.length === 0 ? 'complete' : 'incomplete';
    ledgerFailure('marker', t(locale, 'smoke.ledger.markerFailed', {
      reason,
      gate: gateResult,
      rollback: problems.length === 0
        ? t(locale, 'smoke.ledger.rollbackComplete')
        : t(locale, 'smoke.ledger.rollbackIncomplete', { problems: problems.map(p => `${p.path}: ${p.reason}`).join('; ') }),
    }), { reason, rollback, rollback_problems: problems });
  };

  if (!existsSync(join(root, resultPath))) {
    if (coverageCheck.changed_case_ids.length > 0) {
      const data = collectSmokeData(root, reportedEnvironment, sandboxData, coverageCheck);
      finalizeVerdict(data);
      if (format === 'json') {
        console.log(JSON.stringify(makeEnvelope('smoke', data)));
        // 设 exitCode 后返回，保证管道消费方读到完整 envelope（S16 EX-2.6）
        process.exitCode = 1;
        return;
      }
      console.error(`\nError: No smoke results found at ${resultPath}.`);
      for (const item of data.diagnostics) {
        console.error(`- ${item.code}: ${item.message}`);
      }
      process.exit(1);
    }
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'smoke', 'NO_SMOKE_RESULTS', `No smoke results found at ${resultPath}.`,
      )));
      process.exit(1);
    }
    console.error(`\nError: No smoke results found at ${resultPath}.`);
    process.exit(1);
  }

  const defined = extractSmokeDefinedIds(root);
  if (defined.length === 0) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'smoke', 'NO_SMOKE_CASES', 'No smoke case specs found in logos/resources/test/smoke/.',
      )));
      process.exit(1);
    }
    console.error('\nError: No smoke case specs found in logos/resources/test/smoke/.');
    process.exit(1);
  }

  const data = collectSmokeData(root, reportedEnvironment, sandboxData, coverageCheck);
  if (sandboxData.status === 'fail' && data.gate.result === 'PASS') {
    data.gate.result = 'FAIL';
    data.gate.reason = 'failed_cases';
    if (data.failed_cases.length === 0) {
      data.failed_cases.push({
        id: 'sandbox',
        error: sandboxData.diagnostics[0] ?? 'smoke sandbox failed',
      });
    }
  }

  finalizeVerdict(data);

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('smoke', data)));
    // 设 exitCode 后自然退出，保证管道消费方读到完整 envelope（S16 EX-2.6）
    if (data.gate.result !== 'PASS') process.exitCode = 1;
    return;
  }

  console.log('\n🔎 OpenLogos Smoke Verification\n');
  if (data.environment) console.log(`  Environment: ${data.environment}`);
  if (data.environment_evidence) {
    const ev = data.environment_evidence;
    console.log(`  ${t(locale, 'smoke.env.evidence', {
      evidence: ev.env_evidence,
      ref: ev.ref ?? t(locale, 'smoke.env.refUnknown'),
      verified: t(locale, ev.verified ? 'smoke.env.verified' : 'smoke.env.notVerified'),
    })}`);
  }
  console.log(`  Defined:  ${data.summary.defined_count}`);
  console.log(`  Executed: ${data.summary.executed_count}`);
  console.log(`  Passed:   ${data.summary.passed_count}`);
  console.log(`  Failed:   ${data.summary.failed_count}`);
  console.log(`  Skipped:  ${data.summary.skipped_count}`);
  console.log(`  Coverage: ${data.summary.coverage_pct}%`);
  console.log(`  Pass rate: ${data.summary.pass_rate_pct}%`);
  if (data.sandbox.mode !== 'off' || data.sandbox.status !== 'skipped') {
    console.log(`  ${t(locale, 'smoke.sandboxSummary', {
      mode: data.sandbox.mode,
      status: data.sandbox.status,
      isolated: String(data.sandbox.isolated),
      writeDenied: String(data.sandbox.workspace_write_denied),
    })}`);
    for (const line of data.sandbox.diagnostics) {
      console.log(`    - ${line}`);
    }
    if (data.sandbox.infos && data.sandbox.infos.length > 0) {
      for (const line of data.sandbox.infos) {
        console.log(`    ℹ️  ${line}`);
      }
    }
  }

  if (data.failed_cases.length > 0) {
    console.log('\nFailed smoke cases:');
    for (const item of data.failed_cases) console.log(`  ${item.id}  ${item.error}`);
  }

  if (data.uncovered_cases.length > 0) {
    console.log('\nUncovered smoke cases:');
    for (const id of data.uncovered_cases) console.log(`  ${id}`);
  }

  if (data.platform_skipped_cases && data.platform_skipped_cases.length > 0) {
    console.log('\nPlatform-unavailable smoke cases (skip accepted):');
    for (const item of data.platform_skipped_cases) console.log(`  ${item.id}: ${item.detail}`);
  }

  if (data.required_skipped_cases && data.required_skipped_cases.length > 0) {
    console.log('\nRequired smoke cases without evidence (skip):');
    for (const item of data.required_skipped_cases) console.log(`  ${item.id}: ${item.detail}`);
  }

  if (data.diagnostics.length > 0) {
    console.log('\nSmoke diagnostics:');
    for (const item of data.diagnostics) {
      const cases = item.case_ids?.length ? ` (${item.case_ids.join(', ')})` : '';
      console.log(`  ${item.code}${cases}: ${item.message}`);
    }
  }

  console.log(`\n${data.gate.result === 'PASS' ? '✅' : '❌'} Gate 3.8: ${data.gate.result}`);
  console.log(`\n📄 ${t(locale, 'verify.reportPath', { path: data.report_path })}\n`);

  if (data.gate.result !== 'PASS') process.exit(1);
}
