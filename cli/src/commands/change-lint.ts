/**
 * openlogos change-lint —— S35 提案计划产物左移硬检查（change-lint-shift-left）。
 *
 * 只读命令（项目级红线）：不写任何项目文件 / marker / guard / 哈希清单，不改变任何 step/gate 派生。
 * 读取顺序（操作错误即终止）：logos/logos.config.json 存在性（所有分支第一步）→ guard →
 * slug 词法/containment → proposal.md（含 module resolver）→ tasks.md → deltas/**。
 * exit code：0 = 全过；2 = 检查完成有违规；1 = 操作错误。
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import {
  runChangeLint, isDangerousSlug, SLUG_STRICT_RE, toPublicViolation,
  type ChangeLintOpErrorCode, type ChangeLintRunResult,
} from '../lib/change-lint.js';

const COMMAND = 'change-lint';

function opError(format: OutputFormat, code: ChangeLintOpErrorCode, message: string): never {
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope(COMMAND, code, message)));
  } else {
    console.error(`Error [${code}]: ${message}`);
  }
  process.exit(1);
  throw new Error('unreachable'); // process.exit 被测试 mock 成 throw 时的类型收口
}

export function changeLint(slugArg: string | undefined, format: OutputFormat = 'text'): void {
  const root = process.cwd();

  // 1. logos.config.json 存在性探测（所有分支的第一步；缺失即终止，不读 guard 及任何后续产物）
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    opError(format, 'not_initialized', 'logos/logos.config.json 不存在——项目未初始化，请先运行 openlogos init/adopt');
  }

  // 2. guard → slug 解析。
  // code-r1 F8：`--slug` flag 一旦出现即视为显式指定——缺值/空串/值为另一 option（index.ts 归一为 ''）
  // 直接 slug_invalid，**绝不**回退 guard；只有 flag 完全缺席（slugArg === undefined）才允许 guard 回退。
  let slug: string;
  if (slugArg !== undefined) {
    slug = slugArg.trim();
    if (isDangerousSlug(slug)) {
      opError(format, 'slug_invalid', `--slug 显式指定但值为空或含非法路径字符（合法：[a-z0-9][a-z0-9-]*）：${JSON.stringify(slug)}`);
    }
  } else {
    let active = '';
    const guardPath = join(root, 'logos', '.openlogos-guard');
    if (existsSync(guardPath)) {
      try {
        const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
        if (guard && typeof guard.activeChange === 'string') active = guard.activeChange.trim();
      } catch { /* guard 损坏视同无活跃提案 */ }
    }
    if (!active) {
      opError(format, 'no_active_proposal', '无活跃提案且未指定 --slug');
    }
    slug = active;
    // 3. guard 提供的 slug 同样过词法硬拒（guard 内容不可信）
    if (isDangerousSlug(slug)) {
      opError(format, 'slug_invalid', `slug 含非法路径字符（合法：[a-z0-9][a-z0-9-]*）：${JSON.stringify(slug)}`);
    }
  }
  const changesDir = join(root, 'logos', 'changes');
  const proposalDir = join(changesDir, slug);
  // code-r2 F18：严格词法 [a-z0-9][a-z0-9-]* 真正生效——不合词法的值**仅当**历史目录实际存在时
  // 走只读兼容（仍过 containment）；非法且不存在 → slug_invalid（词法阶段拒绝，而非 slug_not_found）。
  if (!SLUG_STRICT_RE.test(slug) && !existsSync(proposalDir)) {
    opError(format, 'slug_invalid', `slug 不满足严格词法（合法：[a-z0-9][a-z0-9-]*）且无同名历史提案目录：${JSON.stringify(slug)}`);
  }
  if (!existsSync(proposalDir)) {
    opError(format, 'slug_not_found', `提案 logos/changes/${slug} 不存在`);
  }
  // realpath containment：目标必须落在 logos/changes/ 内（symlink 逃逸同拒）
  try {
    const realProposal = realpathSync(proposalDir);
    const realChanges = realpathSync(changesDir);
    if (!(realProposal + sep).startsWith(realChanges + sep)) {
      opError(format, 'slug_invalid', `提案目录解析后逃逸 logos/changes/：${realProposal}`);
    }
  } catch {
    opError(format, 'slug_not_found', `提案 logos/changes/${slug} 无法解析`);
  }

  // 4–6. proposal.md（含 module resolver）→ tasks.md → deltas/**，L1–L7 聚合（runChangeLint 内部按此序读取）
  const result = runChangeLint(root, proposalDir, slug);
  if (!result.ok) {
    opError(format, result.errorCode, result.message);
  }

  const pass = result.violations.length === 0;

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope(COMMAND, {
      slug: result.slug,
      pass,
      plan_package: result.plan_package,
      // C03：层号止于命令层——对外 JSON 经投影剥离 `check_layer`，字段集合与排序零漂移。
      violations: result.violations.map(toPublicViolation),
      // S38（delta-r1 F4）：warnings 仅非空时出现，否则整个字段省略（零漂移，契约见 cli-json-output §3.15）
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    })));
  } else {
    console.log(`change-lint: ${result.slug}`);
    try {
      renderChecks(result);
    } catch (e) {
      if (!(e instanceof ChangeLintRenderError)) throw e;
      // fail-loud 的对外形态：稳定错误码 + 点名层与计数 + 非零退出，绝不裸抛未捕获堆栈。
      console.error(`Error [${e.code}]: ${e.message}`);
      process.exit(1);
    }
    // 提醒级 warning（不改结论 / exit code）：决策记录、SQL 方言降级、条目守恒（§2.73）。
    // 告警通道自 lite-cut2c 起承载多类，故逐条打印 code——否则用户无从分辨来源。
    for (const w of result.warnings) {
      console.log(`  ⚠ [${w.code}] ${w.message}`);
      console.log(`      建议：${w.fix_hint}`);
    }
    const total = result.checks.length;
    const passed = result.checks.filter(c => c.violations === 0).length;
    const warnSuffix = result.warnings.length > 0 ? `，${result.warnings.length} warning` : '';
    if (pass) {
      console.log(`PASS（${passed}/${total}${warnSuffix}）`);
    } else {
      console.log(`FAIL（${passed}/${total}，${result.violations.length} 项违规${warnSuffix}）`);
    }
  }

  process.exit(pass ? 0 : 2);
}

/**
 * 呈现层归属漂移的 fail-loud 信号（S35 契约三 / C02）。
 *
 * 本刀之前，「某层计数非零却筛不出可打印违规」走 else 分支、循环体零次——**整行消失**
 * 且不报错、不影响 exit code，缺陷因此隐蔽存在（20260921 实测：L4 整行不见，底部只剩
 * `FAIL（9/10，1 项违规，1 warning）`）。显式异常让同类漂移在**第一次**发生时即暴露。
 */
export class ChangeLintRenderError extends Error {
  readonly code = 'render_layer_attribution_inconsistent';
  constructor(message: string) {
    super(message);
    this.name = 'ChangeLintRenderError';
  }
}

/**
 * 人类可读输出的检查项渲染（S35 契约二·逐条可归因，与 merge 准入输出
 * `spec/change-management.md` §2.51.5「禁止只给聚合结论」同口径）。
 *
 * 归层只读 violation 本体的 `check_layer`（唯一来源）——**不存在**任何从 `code` 反推层号的
 * 映射（被删除的 `checkOfCode` 即该反推副本：同一 code 已横跨 L4 与 L8，入参只有 code
 * 的函数结构上无法区分，补 case 补不出来、留作兜底就是留第二份来源，故整函数删除，C01）。
 *
 * 每个检查项**恰产生一行结论**：`✓` 行、若干 `✗` 条目、或一个显式异常——不存在「整行消失」
 * 的第四种可能（不变量 3）。
 */
export function renderChecks(result: Extract<ChangeLintRunResult, { ok: true }>): void {
  let printed = 0;
  for (const check of result.checks) {
    const checkViolations = result.violations.filter(v => v.check_layer === check.id);
    if (checkViolations.length !== check.violations) {
      throw new ChangeLintRenderError(
        `检查项 L${check.id}（${check.label}）计数为 ${check.violations}，但按层归属筛出 ${checkViolations.length} 条可打印违规`
        + '——层归属出现了第二份来源或已漂移；违规详情无法逐条归因，拒绝只输出聚合结论',
      );
    }
    printed += checkViolations.length;
    if (checkViolations.length === 0) {
      console.log(`  ✓ L${check.id} ${check.label}`);
      continue;
    }
    for (const v of checkViolations) {
      console.log(`  ✗ L${check.id} [${v.code}]`);
      console.log(`      缺什么：${v.message}`);
      console.log(`      在哪补：${v.path}`);
      console.log(`      补成什么样：${v.fix_hint}`);
    }
  }
  // 孤儿违规同属「整行消失」形态：某层根本没有检查项行（如层号未登记进 checks），
  // 该层违规将无声蒸发。逐层计数相等不足以覆盖它，故再锁一次总数。
  if (printed !== result.violations.length) {
    const orphans = [...new Set(result.violations.filter(
      v => !result.checks.some(c => c.id === v.check_layer)).map(v => v.check_layer))].sort((a, b) => a - b);
    throw new ChangeLintRenderError(
      `共 ${result.violations.length} 项违规，但只有 ${printed} 项落在检查项行下`
      + `${orphans.length > 0 ? `；无对应检查项的层号：${orphans.map(l => `L${l}`).join('、')}` : ''}`
      + '——这些违规不会被打印，拒绝只输出聚合结论',
    );
  }
}
