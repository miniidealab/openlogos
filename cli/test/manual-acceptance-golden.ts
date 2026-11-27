/**
 * smoke-manual-acceptance（功能规格 §2.107.13）：未配置人工验收、没有人工用例的项目，smoke JSON 唯一声明的加法是值为默认的
 * `data.manual_acceptance`。既有零回归基线录制于引入之前，比对前先断言该字段等于默认值，再剥离它，其余输出仍须与基线逐字一致
 * （与 proposal-default-environment 对 `environment.deploy` 的处理同一做法）。
 */
import { expect } from 'vitest';

const DEFAULT_KEYS = ['enabled', 'environment', 'deploy_id', 'deploy_confirmed', 'ref', 'baseline_ref', 'pending', 'passed',
  'failed', 'remaining', 'regression_unresolved', 'unexecuted', 'warnings'];

/** 断言 smoke data 中的 manual_acceptance 为默认值并将其删除（就地修改）；没有该字段时不做任何事。 */
export function stripDefaultManualAcceptance(data: Record<string, unknown> | null | undefined, label = 'smoke'): void {
  if (!data || typeof data !== 'object' || !('manual_acceptance' in data)) return;
  const ma = data.manual_acceptance as Record<string, unknown>;
  expect(Object.keys(ma), `${label} manual_acceptance 字段集合`).toEqual(DEFAULT_KEYS);
  expect(ma, `${label} manual_acceptance 为默认值`).toEqual({
    enabled: false,
    environment: data.environment ?? null,
    deploy_id: null,
    deploy_confirmed: false,
    ref: null,
    baseline_ref: null,
    pending: [],
    passed: [],
    failed: [],
    remaining: [],
    regression_unresolved: [],
    unexecuted: [],
    warnings: [],
  });
  delete data.manual_acceptance;
}

/**
 * 对一段进程输出文本中的 smoke JSON envelope 行剥离默认 manual_acceptance，其余行与字节原样保留。
 * envelope 由 `JSON.stringify` 单行输出，删除一个键后重新序列化不改变其余键的顺序与格式。
 */
export function stripDefaultManualAcceptanceFromText(text: string, label = 'smoke'): string {
  return text.split('\n').map(line => {
    if (!line.includes('"manual_acceptance"')) return line;
    let obj: any;
    try { obj = JSON.parse(line); } catch { return line; }
    if (!obj || obj.command !== 'smoke' || !obj.data) return line;
    stripDefaultManualAcceptance(obj.data, label);
    return JSON.stringify(obj);
  }).join('\n');
}

/** 对 `{ status, stdout, stderr }` 形态的进程结果剥离默认 manual_acceptance（返回新对象）。 */
export function stripDefaultManualAcceptanceFromRun<T extends { stdout: string; stderr: string }>(run: T, label = 'smoke'): T {
  return { ...run, stdout: stripDefaultManualAcceptanceFromText(run.stdout, label), stderr: stripDefaultManualAcceptanceFromText(run.stderr, label) };
}

/** 对 observe*Fixtures 形态（steps[].stdout 为已解析 envelope）的 smoke 步骤剥离默认 manual_acceptance（就地修改）。 */
export function stripDefaultManualAcceptanceFromSteps(steps: Array<{ args?: unknown; stdout?: any }>, label = 'smoke'): void {
  for (const step of steps) {
    if (typeof step.args !== 'string' || !step.args.startsWith('smoke')) continue;
    stripDefaultManualAcceptance(step.stdout?.data, `${label} ${step.args}`);
  }
}
