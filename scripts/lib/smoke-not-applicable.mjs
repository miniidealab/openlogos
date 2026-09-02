/**
 * 环境不具备时的显式 skip 留痕（功能规格 §2.48.4、架构 §三十九.2）。
 *
 * 门禁判据是 `failed == 0 && uncovered == 0`，其中 uncovered = 已定义但**没有任何结果
 * 记录**的用例。因此「记录的有无」本身就是判据输入——runner 静默零记录退出，等于把
 * 「我不适用」和「我没跑」压成同一个信号，两者都只能表现为 uncovered。
 *
 * 本模块是这条留痕的**单点实现**：所有依赖第三方宿主或历史制品的 runner 一律调用它，
 * 不各自拼装记录格式。skip 的统计口径沿用 S19 已合并规则（计入 executed、不计入
 * uncovered、不计入 failed），本模块不新增语义、不放宽任何判据。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 结果账本路径：与 CLI 的 `smoke.result_path` 配置保持一致 */
export function smokeResultPath(repoRoot = process.cwd()) {
  return resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
}

/**
 * 为 `ids` 中的**每一个**用例写一条 skip 记录。
 *
 * @param {string[]} ids            该 runner 拥有的全部 smoke 用例 ID（不得只写其中一部分）
 * @param {object}   options
 * @param {string}   options.reason 人类可读的不适用原因
 * @param {string[]} [options.missing] 机器可读的缺失项（env 名 / 制品名），供归因
 * @param {string}   [options.environment] 环境标识
 * @param {string}   [options.repoRoot]
 * @returns {number} 写入的记录条数
 */
export function recordSmokeNotApplicable(ids, { reason, missing = [], environment = 'not-applicable', repoRoot = process.cwd() }) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('recordSmokeNotApplicable 需要非空的 ids——不适用也必须为全部 owned 用例留痕');
  }
  if (!reason) throw new Error('recordSmokeNotApplicable 需要 reason——skip 不得不带不适用原因');

  const path = smokeResultPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  const timestamp = new Date().toISOString();
  let written = 0;
  for (const id of ids) {
    appendFileSync(path, `${JSON.stringify({
      id,
      status: 'skip',
      timestamp,
      duration_ms: 0,
      environment,
      not_applicable_reason: reason,
      missing_requirements: missing,
      evidence: [],
    })}\n`);
    written++;
  }
  return written;
}

/**
 * 便捷封装：判定不适用 → 留痕 → 以成功状态退出。
 * 不适用不是失败，故退出码为 0；但账本里必须留下每条用例的 skip。
 */
export function exitNotApplicable(ids, options) {
  recordSmokeNotApplicable(ids, options);
  process.exit(0);
}
