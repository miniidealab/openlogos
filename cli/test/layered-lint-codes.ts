/**
 * layered-verification（功能规格 §2.109.3、§2.109.4）有意新增的 change-lint 契约：
 * - 违规码 `affected_scenarios_invalid`（L12，「受影响场景」段在场时的结构检查）；
 * - 警告码 `affected_scenarios_missing`（缺段提醒）、`affected_scenarios_unknown`、`main_path_invalid`、`main_path_over_limit`。
 *
 * 与 `acceptance-criteria-lint-codes.ts` 同一做法：零回归锚对照「改动前实测基线 + 本模块追加的部分」，
 * 承认这次有意扩充，同时保留「其它任何意外增删改序都会变红」的强度。
 * 早于本能力的夹具提案没有「受影响场景」段，只会多出一条缺段提醒；既有锚经 acceptance-criteria-lint-codes.ts
 * 的同名辅助函数一并剔除它（两类缺段提醒同源：都是非 canonical 段的提醒）。
 */
export const LAYERED_VIOLATION_CODES = ['affected_scenarios_invalid'] as const;
export const AFFECTED_MISSING_WARNING = 'affected_scenarios_missing';

/** 合法的「受影响场景」段（已评估、无其他受影响场景），供需要「无警告、无违规」夹具的测试追加到 proposal。 */
export const AFFECTED_NONE_SECTION = [
  '## 受影响场景',
  '',
  '```yaml',
  'schema: openlogos/affected-scenarios@1',
  'assessment: assessed',
  'shared_change: false',
  'scenarios: []',
  '```',
  '',
].join('\n');
