/**
 * verify-self-sufficient-cases（功能规格 §2.106.8）有意新增的 change-lint 契约：
 * - 违规码 `acceptance_criteria_invalid`（L11，「验收标准」段在场时的格式检查）；
 * - 警告码 `acceptance_criteria_missing`（缺段提醒，不计违规、不改退出码）。
 *
 * 与 `knowledge-lint-codes.ts` / `deploy-plan-coverage-codes.ts` 同一做法：零回归锚对照
 * 「改动前实测基线（golden）+ 本模块追加的部分」，承认这次有意扩充，同时保留「其它任何意外增删改序都会变红」的强度。
 */
import type { ChangeLintWarning } from '../src/lib/change-lint.js';

/** 追加在注册表末尾（注册表中紧跟 `knowledge_apply_incomplete`；按序比对的测试中基线末项即该锚）。 */
export const ACCEPTANCE_CRITERIA_CODES = ['acceptance_criteria_invalid'] as const;

export function withAcceptanceCriteriaCodes(codes: readonly string[]): string[] {
  if (!codes.includes('knowledge_apply_incomplete')) {
    throw new Error('golden 违规码基线缺少锚 knowledge_apply_incomplete（应先经 withKnowledgeCodes 并入 L10 码）');
  }
  return [...codes, ...ACCEPTANCE_CRITERIA_CODES];
}

export const ACCEPTANCE_MISSING_WARNING = 'acceptance_criteria_missing';

/** 去掉缺段提醒：夹具提案早于本能力、刻意不带「验收标准」段时，用于比对其余 warning 零漂移。 */
export function withoutAcceptanceMissing<T extends Pick<ChangeLintWarning, 'code'>>(warnings: readonly T[] | undefined): T[] {
  return (warnings ?? []).filter(w => w.code !== ACCEPTANCE_MISSING_WARNING);
}

/** JSON 信封层面同口径去掉缺段提醒；剩余 warnings 为空时按契约省略整个字段。 */
export function stripAcceptanceMissingFromData<T extends { warnings?: Array<{ code: string }> }>(data: T): T {
  if (!data.warnings) return data;
  const rest = data.warnings.filter(w => w.code !== ACCEPTANCE_MISSING_WARNING);
  const out = { ...data } as T;
  if (rest.length === 0) delete out.warnings;
  else out.warnings = rest;
  return out;
}

/** 合法的「验收标准」段（三个字段均为「无」），供需要「无警告、无违规」夹具的测试追加到 proposal。 */
export const ACCEPTANCE_NONE_SECTION_ZH = [
  '## 验收标准',
  '- 自动验收环境要求：无',
  '- 平台限定用例：无',
  '- 需要人参与的验收：无',
  '',
].join('\n');

/** 把 `openlogos change` 脚手架里「验收标准」段的三个占位填成「无」（zh / en 均可）。 */
export function fillAcceptanceNone(proposal: string): string {
  return proposal
    .replace(/^(- 自动验收环境要求：).*$/m, '$1无')
    .replace(/^(- 平台限定用例：).*$/m, '$1无')
    .replace(/^(- 需要人参与的验收：).*$/m, '$1无')
    .replace(/^(- Automated verification requirements: ).*$/m, '$1none')
    .replace(/^(- Platform-limited cases: ).*$/m, '$1none')
    .replace(/^(- Human-involved acceptance: ).*$/m, '$1none');
}

/**
 * 人读输出同口径去掉缺段提醒：删除该 warning 的两行（`⚠ [acceptance_criteria_missing] …` 与其「建议」行），
 * 并把末行结论里的 warning 计数减一（减到 0 时去掉「，N warning」后缀）。其余字节原样保留。
 */
export function stripAcceptanceMissingFromText(stdout: string): string {
  const lines = stdout.split('\n');
  const out: string[] = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`  ⚠ [${ACCEPTANCE_MISSING_WARNING}] `)) {
      removed++;
      if (i + 1 < lines.length && lines[i + 1].startsWith('      建议：')) i++;
      continue;
    }
    out.push(lines[i]);
  }
  if (removed === 0) return stdout;
  return out.map(line => line.replace(/，(\d+) warning）$/, (_m, n: string) => {
    const left = Number(n) - removed;
    return left > 0 ? `，${left} warning）` : '）';
  })).join('\n');
}
