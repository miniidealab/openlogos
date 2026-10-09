/**
 * deploy-plan-gate-release-0-15-19（功能规格 §2.90）有意新增的 change-lint 违规码。
 *
 * 违规码注册表的零回归锚对照的是「改动前实测基线」（golden），本次新增的四个码不在其中。
 * 各锚改为对照「基线 + 本函数插入的四个码」：既承认这次有意扩充，又保留「任何其它意外增删改序都会变红」的强度。
 * 插入位置与 `CHANGE_LINT_VIOLATION_CODES` 的登记位置一致：Plan Package 投影两码紧跟 `tasks_deployment_conflict`，
 * L5 两码紧跟 `deployment_decision_conflict`。
 */
export const DEPLOY_PLAN_COVERAGE_PLAN_PACKAGE_CODES = [
  'proposal_deployment_plan_reference_unresolved',
  'tasks_deployment_plan_missing',
] as const;
export const DEPLOY_PLAN_COVERAGE_L5_CODES = [
  'deployment_plan_missing',
  'deployment_plan_reference_unresolved',
] as const;

export function withDeployPlanCoverageCodes(golden: readonly string[]): string[] {
  const out: string[] = [];
  for (const code of golden) {
    out.push(code);
    if (code === 'tasks_deployment_conflict') out.push(...DEPLOY_PLAN_COVERAGE_PLAN_PACKAGE_CODES);
    if (code === 'deployment_decision_conflict') out.push(...DEPLOY_PLAN_COVERAGE_L5_CODES);
  }
  if (out.length !== golden.length + 4) {
    throw new Error('golden 违规码基线缺少插入锚 tasks_deployment_conflict / deployment_decision_conflict');
  }
  return out;
}
