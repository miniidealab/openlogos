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
import { runChangeLint, isDangerousSlug, SLUG_STRICT_RE, type ChangeLintOpErrorCode } from '../lib/change-lint.js';

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
      violations: result.violations,
      // S38（delta-r1 F4）：warnings 仅非空时出现，否则整个字段省略（零漂移，契约见 cli-json-output §3.15）
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    })));
  } else {
    console.log(`change-lint: ${result.slug}`);
    for (const check of result.checks) {
      if (check.violations === 0) {
        console.log(`  ✓ L${check.id} ${check.label}`);
      } else {
        const checkViolations = result.violations.filter(v => {
          const l = checkOfCode(v.code);
          return l === check.id;
        });
        for (const v of checkViolations) {
          console.log(`  ✗ L${check.id} [${v.code}]`);
          console.log(`      缺什么：${v.message}`);
          console.log(`      在哪补：${v.path}`);
          console.log(`      补成什么样：${v.fix_hint}`);
        }
      }
    }
    // S38：决策记录 warning（提醒级，不改结论 / exit code）
    for (const w of result.warnings) {
      console.log(`  ⚠ 决策记录：${w.message}`);
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

/** violation code → 检查项编号（仅文本渲染用；排序与归属由 lib 的生成序保证）。 */
function checkOfCode(code: string): number {
  switch (code) {
    case 'tasks_sections_unparsable': return 1;
    case 'tasks_code_header_missing': return 2;
    case 'code_change_requires_real_test_ids': return 3;
    case 'delta_missing_section_marker':
    case 'delta_template_skeleton': return 4;
    case 'deployment_decision_conflict': return 5;
    case 'delta_path_invalid': return 6;
    case 'delta_implicit_id_removal':
    case 'delta_removed_unknown_id':
    case 'delta_section_anchor_unresolvable': return 8;
    default: return 7;
  }
}
