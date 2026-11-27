/**
 * 冒烟阶段人工验收：待验收清单 P(E, D) 与关闭环境的「未执行的人工用例」（smoke-manual-acceptance，S46）。
 *
 * 规范源：spec/environments.md §15.1、§15.3、§15.4；功能规格 §2.107.4；架构「五十九」。
 *
 * 本模块只读：在给定 commit 上经 `git ls-tree` / `git show` 枚举测试规格中的人工用例行（首格带 `[manual]` /
 * `[manual/<平台>]` 的 UT / ST / SMOKE），并在两个 commit 之间对比行内容。工作区与 HEAD 只作观察信息，不参与计算。
 * 账本推导（当前部署、基线、过期）由 environments.ts 提供。
 */
import { execFileSync } from 'node:child_process';
import type { CurrentDeployment, EnvLedgerState, EnvironmentDef } from './environments.js';
import { currentDeploymentOf, manualBaselineOf, previousRefOf } from './environments.js';
import { matchTableTestIdRow } from './test-id.js';
import { parseSmokeFirstCell } from './smoke-coverage.js';

const TEST_SPEC_DIR = 'logos/resources/test';

export interface ManualAcceptanceWarning {
  code: 'manual_scope_unresolved' | 'manual_baseline_unavailable' | 'manual_regression_unknown' | 'manual_deployment_replaced';
  message: string;
}

/** smoke JSON `data.manual_acceptance` 的计算结果（功能规格 §2.107.11）。 */
export interface ManualAcceptanceScope {
  enabled: boolean;
  environment: string | null;
  deploy_id: string | null;
  deploy_confirmed: boolean;
  ref: string | null;
  baseline_ref: string | null;
  /** 开启时清单无法确定（当前部署未确认、R 为 null 或不可读）。 */
  scope_unresolved: boolean;
  /** P(E, D)（开启时）；关闭时为空。 */
  pending: string[];
  regression_unresolved: string[];
  /** 关闭时「未执行的人工用例」；开启时为空。 */
  unexecuted: string[];
  warnings: ManualAcceptanceWarning[];
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

/** 一行表格的人工用例身份：首格为「裸 ID + manual 标记」（UT/ST 与 SMOKE 各用既有首格读法）。 */
function manualRowId(line: string): string | null {
  if (!line.trim().startsWith('|')) return null;
  const row = matchTableTestIdRow(line);
  if (row) return row.manual ? row.id : null;
  const smoke = parseSmokeFirstCell(line.split('|')[1]?.trim() ?? '');
  return smoke && smoke.manual ? smoke.id : null;
}

/** 从一份规格文本中提取人工用例行：ID → 行内容（去首尾空白）。同一 ID 出现多次时以最后一行为准。 */
export function manualRowsFromContent(content: string, into: Map<string, string> = new Map()): Map<string, string> {
  for (const line of content.split('\n')) {
    const id = manualRowId(line);
    if (id) into.set(id, line.trim());
  }
  return into;
}

/**
 * 在给定 commit 上枚举测试规格中的人工用例行（§15.4 第 2 步）。commit 不存在或不可读（如浅克隆）时返回 null；
 * 不读取工作区。
 */
const manualRowsCache = new Map<string, Map<string, string>>();

export function listManualCasesAt(root: string, commit: string): Map<string, string> | null {
  if (!/^[0-9a-f]{40}$/.test(commit)) return null;
  // commit 内容不可变：同一进程内复用读取结果（评审 code-r2 F5：空自动阶段判定与人工清单计算共用一次读取）。
  // 只缓存可读结果；不可读（如浅克隆）可能在 fetch 后变为可读，不缓存
  const cacheKey = `${root}\0${commit}`;
  const cached = manualRowsCache.get(cacheKey);
  if (cached) return cached;
  if (git(root, ['cat-file', '-e', `${commit}^{commit}`]) === null) return null;
  // -z：按 NUL 切分原始路径。默认输出会给含非 ASCII 字符的路径加引号并转义（评审 code-r1 F3），不能当作文件名使用
  const listing = git(root, ['ls-tree', '-r', '-z', '--name-only', commit, '--', TEST_SPEC_DIR]);
  if (listing === null) return null;
  const rows = new Map<string, string>();
  for (const path of listing.split('\0').filter(p => p.endsWith('.md')).sort()) {
    const content = git(root, ['show', `${commit}:${path}`]);
    if (content === null) return null;
    manualRowsFromContent(content, rows);
  }
  manualRowsCache.set(cacheKey, rows);
  return rows;
}

/** 已部署版本是否含人工用例（任意 UT / ST / SMOKE）：当前部署未确认、ref 为 null 或不可读时为 false。 */
export function deploymentHasManualCases(root: string, deployment: CurrentDeployment | null): boolean {
  if (!deployment || !deployment.confirmed || deployment.ref === null) return false;
  return (listManualCasesAt(root, deployment.ref)?.size ?? 0) > 0;
}

const sorted = (values: Iterable<string>): string[] => Array.from(new Set(values)).sort();

/** R 相对 base 新增或行内容变化的人工用例；base 为 null 时取 R 全部（§15.4 第 3、4 步）。 */
function changedSince(rows: Map<string, string>, base: Map<string, string> | null): string[] {
  if (base === null) return sorted(rows.keys());
  return sorted([...rows.entries()].filter(([id, line]) => base.get(id) !== line).map(([id]) => id));
}

/**
 * 计算环境 E 当前部署 D 的人工验收范围（spec/environments.md §15.4）。
 * - 开启：P = R 相对基线 B 的增量（无基线或 B 不可读时为 R 全部人工用例）∪ 有效回归用例；失效回归 ID 进 regression_unresolved。
 * - 关闭：unexecuted = R 相对 previous_ref 的增量（没有上一次部署或其不可读时为 R 全部）∪ 有效回归用例；失效回归 ID 只警告。
 * - 当前部署未确认、R 为 null 或不可读：开启时 scope_unresolved；关闭时只出警告。都不读取工作区。
 */
export function computeManualAcceptanceScope(
  root: string, env: EnvironmentDef | null, state: EnvLedgerState | undefined,
  opts: { expected?: CurrentDeployment | null } = {},
): ManualAcceptanceScope {
  const enabled = env?.manualAcceptance?.enabled === true;
  const regression = env?.manualAcceptance?.regression ?? [];
  const current = currentDeploymentOf(state);
  // 评审 code-r1 F1：调用方（smoke）以本次运行开始时的部署身份为准；环境当前部署已被更替时清单不可确定，要求对当前部署重跑
  const expected = opts.expected ?? null;
  const replaced = Boolean(expected && current && current.deploy_id !== expected.deploy_id);
  const out: ManualAcceptanceScope = {
    enabled,
    environment: env?.id ?? null,
    deploy_id: current?.deploy_id ?? null,
    deploy_confirmed: current?.confirmed ?? false,
    ref: current?.ref ?? null,
    baseline_ref: null,
    scope_unresolved: false,
    pending: [],
    regression_unresolved: [],
    unexecuted: [],
    warnings: [],
  };

  const rows = !replaced && current && current.confirmed && current.ref !== null ? listManualCasesAt(root, current.ref) : null;
  if (replaced) {
    // 评审 code-r2 F1：编号、提交与确认状态整组取自开始时的部署 D，不与更替后的部署混用；更替后的部署只在警告中列出
    out.deploy_id = expected!.deploy_id;
    out.ref = expected!.ref;
    out.deploy_confirmed = expected!.confirmed;
    out.warnings.push({
      code: 'manual_deployment_replaced',
      message: `Environment deployment changed from ${expected!.deploy_id} to ${current!.deploy_id} (ref ${current!.ref ?? 'null'}) during this run; re-run smoke for the current deployment.`,
    });
    if (enabled) out.scope_unresolved = true;
    return out;
  }
  if (rows === null) {
    const reason = !current
      ? 'no deployment recorded for this environment'
      : !current.confirmed
        ? `current deployment ${current.deploy_id} is not confirmed (result=${current.result})`
        : current.ref === null
          ? `current deployment ${current.deploy_id} has no confirmed ref`
          : `deployed commit ${current.ref} is not readable locally (fetch it, e.g. git fetch --unshallow)`;
    if (enabled) out.scope_unresolved = true;
    else out.warnings.push({ code: 'manual_scope_unresolved', message: `Manual case list cannot be determined: ${reason}.` });
    return out;
  }

  const validRegression = regression.filter(id => rows.has(id));
  const invalidRegression = regression.filter(id => !rows.has(id));

  if (enabled) {
    const baseline = manualBaselineOf(state);
    let base: Map<string, string> | null = null;
    if (baseline !== null) {
      base = listManualCasesAt(root, baseline);
      if (base === null) {
        out.warnings.push({
          code: 'manual_baseline_unavailable',
          message: `Baseline commit ${baseline} is not readable locally; all manual cases at the deployed commit are pending.`,
        });
      } else {
        out.baseline_ref = baseline;
      }
    }
    out.pending = sorted([...changedSince(rows, base), ...validRegression]);
    out.regression_unresolved = sorted(invalidRegression);
    return out;
  }

  const previous = previousRefOf(state);
  const prevRows = previous !== null ? listManualCasesAt(root, previous) : null;
  out.unexecuted = sorted([...changedSince(rows, prevRows), ...validRegression]);
  for (const id of sorted(invalidRegression)) {
    out.warnings.push({
      code: 'manual_regression_unknown',
      message: `Regression case ${id} does not exist as a manual case at the deployed commit; ignored.`,
    });
  }
  return out;
}
