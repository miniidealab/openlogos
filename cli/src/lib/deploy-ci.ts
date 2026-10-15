/**
 * ci 方式部署适配（spec/environments.md §11.3、§11.4；来源变更 environment-deploy，场景 S42 Step 6、12、19）。
 *
 * - github-actions 预设：`gh` 可用与 `gh auth status`、工作流存在、调度 ref 检查（显式 / 缺省 workflow_ref 分开）、
 *   `gh api` 调用 dispatch 并带 `return_run_details=true` 取得运行身份（不扫描运行列表）、按 run_id 轮询 `gh run view`、
 *   运行成功后 `gh run download <run_id> -n openlogos-deploy-result` 读取实际部署提交。
 * - provider: script：trigger_script / status_script 的 JSON 协议（最后一行 stdout）。
 * - 版本证据：只有运行回报的 deployed_ref 等于请求 commit 才确认 ref（ref_source=ci-reported）；
 *   headSha、workflow_ref 与 inputs 均不构成证据。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTree } from './fs-remove.js';

export const CI_RESULT_ARTIFACT = 'openlogos-deploy-result';
export const CI_RESULT_FILE = 'result.json';
const GH_CALL_TIMEOUT_MS = 60_000;
const COMMIT_RE = /^[0-9a-f]{40}$/;

export interface GhCall {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  /** gh 无法启动（未安装等）时的原因。 */
  spawnError: string | null;
}

/** 执行 gh（参数数组、不经 shell）。 */
export function gh(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env, timeoutMs = GH_CALL_TIMEOUT_MS): GhCall {
  const r = spawnSync('gh', args, { cwd, env, encoding: 'utf-8', timeout: timeoutMs, windowsHide: true });
  if (r.error) {
    return { ok: false, status: null, stdout: r.stdout ?? '', stderr: r.stderr ?? '', spawnError: r.error.message };
  }
  return { ok: r.status === 0, status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim(), spawnError: null };
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : (typeof v === 'number' ? String(v) : null));

/** gh 可用且已登录；不满足时返回原因。 */
export function ghUnavailableReason(cwd: string): string | null {
  const version = gh(['--version'], cwd);
  if (!version.ok) return `gh --version: ${version.spawnError ?? version.stderr ?? `exit ${version.status}`}`;
  const auth = gh(['auth', 'status'], cwd);
  if (!auth.ok) return `gh auth status: ${auth.stderr || `exit ${auth.status}`}`;
  return null;
}

/** 工作流存在（.github/workflows 下的文件名）；不存在或查询失败时返回原因。 */
export function workflowMissingReason(cwd: string, workflow: string): string | null {
  const r = gh(['api', `repos/{owner}/{repo}/actions/workflows/${workflow}`], cwd);
  return r.ok ? null : `workflow ${workflow}: ${r.stderr || r.spawnError || `exit ${r.status}`}`;
}

/** 远端分支 / tag 解析出的 commit；不可解析为 null。 */
export function remoteRefCommit(cwd: string, ref: string): string | null {
  const r = gh(['api', `repos/{owner}/{repo}/commits/${encodeURIComponent(ref)}`], cwd);
  if (!r.ok) return null;
  const sha = parseObject(r.stdout)?.sha;
  return typeof sha === 'string' && COMMIT_RE.test(sha) ? sha : null;
}

/** 请求版本写法是否为可调度的名称（tag 或分支名），而不是 commit、HEAD 或修订表达式。 */
function isRefName(refInput: string, requested: string): boolean {
  if (refInput === 'HEAD' || refInput.trim() === '' || refInput.startsWith('-')) return false;
  if (/[~^:@{}\s\\]/.test(refInput)) return false;
  if (/^[0-9a-f]{4,40}$/.test(refInput) && requested.startsWith(refInput)) return false;
  return true;
}

export type DispatchRefCheck = { ok: true; ref: string } | { ok: false; reason: string };

/**
 * github-actions 调度 ref（§11.4，review delta-r1 F2）：显式 workflow_ref 只要求远端可解析、不要求等于请求 commit；
 * 缺省时以请求版本自身的 tag / 分支名调度，要求远端解析出的 commit 等于请求 commit（只给了 commit 时拒绝）。
 */
export function checkDispatchRef(cwd: string, workflowRef: string | null, refInput: string, requested: string): DispatchRefCheck {
  if (workflowRef !== null) {
    return remoteRefCommit(cwd, workflowRef) !== null
      ? { ok: true, ref: workflowRef }
      : { ok: false, reason: `workflow_ref ${workflowRef} is not resolvable on the remote` };
  }
  if (!isRefName(refInput, requested)) {
    return { ok: false, reason: `"${refInput}" is not a tag or branch name and workflow_ref is not configured` };
  }
  const remote = remoteRefCommit(cwd, refInput);
  if (remote === null) return { ok: false, reason: `${refInput} is not resolvable on the remote` };
  if (remote !== requested) return { ok: false, reason: `remote ${refInput} resolves to ${remote}, not the requested ${requested}` };
  return { ok: true, ref: refInput };
}

export interface DispatchResult {
  runId: string | null;
  runUrl: string | null;
  /** gh 调用失败的原因（失败时无法确认是否已触发，按缺运行身份处理）。 */
  error: string | null;
}

/** 以 gh api 调用 workflow dispatch 接口并带 return_run_details=true，从响应取得运行身份。 */
export function dispatchWorkflow(cwd: string, workflow: string, ref: string, inputs: Record<string, string>): DispatchResult {
  const args = [
    'api', '--method', 'POST', `repos/{owner}/{repo}/actions/workflows/${workflow}/dispatches`,
    '-f', `ref=${ref}`, '-F', 'return_run_details=true',
    ...Object.entries(inputs).flatMap(([k, v]) => ['-f', `inputs[${k}]=${v}`]),
  ];
  const r = gh(args, cwd);
  if (!r.ok) return { runId: null, runUrl: null, error: r.stderr || r.spawnError || `exit ${r.status}` };
  const body = parseObject(r.stdout) ?? {};
  return {
    runId: strOrNull(body.workflow_run_id) ?? strOrNull(body.run_id) ?? strOrNull(body.id),
    runUrl: strOrNull(body.html_url) ?? strOrNull(body.run_url) ?? strOrNull(body.url),
    error: null,
  };
}

export interface RunState {
  status: string | null;
  conclusion: string | null;
  url: string | null;
  /** 只作日志；不构成版本证据。 */
  headSha: string | null;
  /** provider: script 的 status_script 在 completed 时回报的实际部署提交原值。 */
  deployedRef?: unknown;
}

/** 查询一次运行状态；查询失败返回 null（视为暂时不可知，继续轮询）。 */
export function viewRun(cwd: string, runId: string): RunState | null {
  const r = gh(['run', 'view', runId, '--json', 'status,conclusion,url,headSha'], cwd);
  if (!r.ok) return null;
  const o = parseObject(r.stdout);
  if (!o) return null;
  return { status: strOrNull(o.status), conclusion: strOrNull(o.conclusion), url: strOrNull(o.url), headSha: strOrNull(o.headSha) };
}

/** 读取运行上传的 openlogos-deploy-result（result.json 的 deployed_ref 原值）；缺失或无法解析时 present=false。 */
export function downloadDeployResult(cwd: string, runId: string): { present: boolean; reported: unknown } {
  const dir = mkdtempSync(join(tmpdir(), 'openlogos-deploy-result-'));
  try {
    const r = gh(['run', 'download', runId, '-n', CI_RESULT_ARTIFACT, '-D', dir], cwd);
    const file = join(dir, CI_RESULT_FILE);
    if (!r.ok || !existsSync(file)) return { present: false, reported: undefined };
    const body = parseObject(readFileSync(file, 'utf-8'));
    return body ? { present: true, reported: body.deployed_ref } : { present: false, reported: undefined };
  } finally {
    try { removeTree(dir); } catch { /* 临时目录清理失败不影响结论 */ }
  }
}

export interface RefEvidence {
  ref: string | null;
  refSource: 'ci-reported' | 'unknown';
  /** 回报原值（审计用）；缺失或无法解析为 null。 */
  reportedRaw: string | null;
  confirmed: boolean;
}

/** 版本证据（§11.4）：回报值为 40 位 commit 且等于请求 commit 才确认。 */
export function evaluateEvidence(reported: unknown, requested: string): RefEvidence {
  const raw = typeof reported === 'string' ? reported : null;
  if (raw !== null && COMMIT_RE.test(raw) && raw === requested) {
    return { ref: requested, refSource: 'ci-reported', reportedRaw: raw, confirmed: true };
  }
  return { ref: null, refSource: 'unknown', reportedRaw: raw, confirmed: false };
}

/** provider: script 的 trigger_script 输出：最后一行 JSON `{"run_id","url"}`。 */
export function parseTriggerOutput(lastLine: string | null): { runId: string | null; runUrl: string | null } {
  const o = lastLine ? parseObject(lastLine) : null;
  return { runId: strOrNull(o?.run_id), runUrl: strOrNull(o?.url) };
}

/** provider: script 的 status_script 输出：最后一行 JSON `{"status","conclusion","deployed_ref"}`。 */
export function parseStatusOutput(lastLine: string | null): RunState | null {
  const o = lastLine ? parseObject(lastLine) : null;
  if (!o) return null;
  return { status: strOrNull(o.status), conclusion: strOrNull(o.conclusion), url: null, headSha: null, deployedRef: o.deployed_ref };
}
