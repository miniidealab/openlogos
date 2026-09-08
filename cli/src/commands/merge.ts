import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { readLocale, t, mergePromptTemplate } from '../i18n.js';
import { resetCodeSection } from '../lib/proposal-lifecycle.js';
// S35 前置重构②③⑤：段标记/模板骨架校验、delta 分类、模块归属解析改为共享判据打包调用（严禁第二份判据）。
import { DELTA_TO_RESOURCE, validateMarkdownDelta, classifyProposalDeltas, resolveProposalModuleContext, DeltaScanUnreadableError, evaluateDeltaConservation, deltaTargetProjectPath, resolveModifiedSectionKeys, runChangeLint } from '../lib/change-lint.js';
import { recoverBaselineClosureApply } from '../lib/baseline-apply.js';
import { deriveUiImpact, readUiUxDeclaration } from '../lib/ui-first.js';
import { mergeDirect, MergeDirectError } from '../lib/merge-direct.js';
import {
  checkUiHashMatch, commitVerifiedPrototypes, recoverCommitJournal,
  readPlanApproved, classifyProvenance, PROTOTYPE_DELTA_SUBPATH,
} from '../lib/ui-provenance.js';
import { SPEC_MERGED_MARKER } from '../lib/proposal-markers.js';

/** 原型资产：2-page-design 下的 .html（由 commitVerifiedPrototypes 落盘，merge-executor 不碰）。 */
function isPrototypeAsset(relativePath: string): boolean {
  return relativePath.replace(/\\/g, '/').includes('/2-product-design/2-page-design/')
    && relativePath.endsWith('.html');
}

/** 读 guard 文件（activeChange / module）；缺失或损坏返回 null。 */
function readGuard(root: string): { activeChange?: string; module?: string } | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) return null;
  try {
    const g = JSON.parse(readFileSync(guardPath, 'utf-8'));
    return (g && typeof g === 'object') ? g : null;
  } catch { return null; }
}

interface DeltaFile {
  deltaPath: string;
  targetDir: string;
  relativePath: string;
}

/**
 * S35 code-r1 F2：merge 的 delta 消费集合 = 共享分类器的**无逻辑投影**
 * （`classifyProposalDeltas(...).filter(mergeDisposition === 'mergeable')`）。
 * 路径枚举、隐藏规则、symlink containment 与 IO 错误只在 delta-classify.ts 实现一次——
 * 判据改一处，消费点（merge）与检查点（lint L6）同时生效。
 */
export function scanDeltas(deltasDir: string): DeltaFile[] {
  const proposalDir = dirname(deltasDir);
  const entries = classifyProposalDeltas(proposalDir);
  // r4 F7：错误态先于投影——分类器的 ioError fail-fast 哨兵条目绝不混入普通清单
  // （否则「产物不可读」被过滤成空 delta，经 no-delta 早退写成 SPEC_MERGED 假成功）。
  const ioBroken = entries.find(e => e.ioError);
  if (ioBroken) throw new DeltaScanUnreadableError(ioBroken);
  return entries
    .filter(e => e.mergeDisposition === 'mergeable')
    .map(e => {
      const withinCategory = e.relativePath.split('/').slice(2).join('/');
      return {
        deltaPath: join(proposalDir, e.relativePath),
        targetDir: join(DELTA_TO_RESOURCE[e.category], dirname(withinCategory)),
        relativePath: e.relativePath,
      };
    });
}

function noDeltaSpecMergedMarker(): string {
  return JSON.stringify({
    type: 'no_delta_spec_complete',
    reason: 'pure-code proposal has no spec delta',
    completed_at: new Date().toISOString(),
  }, null, 2) + '\n';
}

/** 仅供既有 0.13.x 回归测试读取；安装态 0.14.0 永不启用。 */
function legacyMergeTestMode(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY === '1';
}

/**
 * 直接合并的命令层包装：把 MergeDirectError 映射为稳定退出信息。
 * §2.69.1 失败语义——任一步失败整批回滚，主文档保持合并前字节，错误信息附 git 回滚点。
 */
function runDirectMerge(root: string, changePath: string, slug: string) {
  try {
    return mergeDirect(root, changePath, slug);
  } catch (e) {
    if (e instanceof MergeDirectError) {
      console.error(`Error: merge 失败（${e.code}）：${e.message}`);
      console.error('  logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');
      console.error('  回滚点：git checkout logos/resources/；修正 delta 后重跑 `openlogos merge ' + slug + '`。');
      process.exit(1);
    }
    throw e;
  }
}

export function merge(slug?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  if (!slug) {
    console.error('Error: Missing change proposal name.');
    console.error('Usage: openlogos merge <slug>');
    console.error('Example: openlogos merge add-remember-me');
    process.exit(1);
  }

  const changePath = join(root, 'logos', 'changes', slug);

  if (!existsSync(changePath)) {
    console.error(`Error: Change proposal '${slug}' not found.`);
    process.exit(1);
  }

  const locale = readLocale(root);

  // F2：显式 merge <slug> 必须与 active guard 一致——guard 指向另一个提案时拒绝，
  // 杜绝「guard 指向 B、却 merge A」绕过 A 的 UI 强制门。guard 缺失（纯 CLI/无提案态）不强制此项。
  const guard = readGuard(root);
  if (guard && typeof guard.activeChange === 'string' && guard.activeChange && guard.activeChange !== slug) {
    console.error(`Error: active guard 指向提案 '${guard.activeChange}'，与 merge 目标 '${slug}' 不一致。`);
    console.error('  拒绝 merge：请先切换到正确的活跃提案，或核对 slug。未生成 MERGE_PROMPT、未写 SPEC_MERGED。');
    process.exit(1);
  }

  // S39 apply 崩溃恢复：任何新 prompt/marker 或其它事务动作前，先把上一次闭包 apply
  // 收敛为全旧或已提交全新；journal 损坏/材料不足时 fail-closed 并保留诊断材料。
  const closureApplyRecovery = recoverBaselineClosureApply(root, changePath);
  if (!closureApplyRecovery.ok) {
    console.error(`Error: baseline closure apply 事务无法安全恢复：${closureApplyRecovery.error}`);
    console.error('  拒绝 merge：未生成新的 MERGE_PROMPT、未写 SPEC_MERGED、counter 或 index。');
    process.exit(1);
  }
  if (closureApplyRecovery.recovered === 'rolled_back') {
    console.log('  ↺ 检测到残留 baseline closure apply journal，已回滚至全旧一致态。');
  } else if (closureApplyRecovery.recovered === 'committed') {
    console.log('  ↺ 检测到已提交 baseline closure apply journal，后置状态完整，已清理恢复材料。');
  }

  // F1：崩溃恢复——在扫描 delta / 任何新校验或写入之前，先检测并消化残留 commit journal
  // （前滚补完或回滚到全有或全无态），避免后续 commitVerifiedPrototypes 删除恢复材料造成断链。
  const recovered = recoverCommitJournal(changePath);
  if (recovered === 'failed') {
    // 损坏/截断 journal、schema 非法、路径越界或恢复 I/O 失败 → fail closed：保留诊断材料、不继续新事务。
    console.error('Error: 检测到残留原型事务 journal 损坏/截断/路径越界，无法安全恢复到全有或全无态。');
    console.error(`  已保留 logos/changes/${slug}/${'UI_COMMIT_JOURNAL.json'} 及 staging/backup 供诊断；拒绝继续 merge（未生成 MERGE_PROMPT、未写 SPEC_MERGED）。`);
    process.exit(1);
  }
  if (recovered !== 'none') {
    console.log(`  ↺ 检测到残留原型事务 journal，已${recovered === 'rolled_forward' ? '前滚补完' : '回滚'}至一致态。`);
  }

  if (existsSync(join(changePath, SPEC_MERGED_MARKER))) {
    console.log(`\n✓ ${t(locale, 'merge.alreadyMerged', { slug })}`);
    return;
  }

  // S39 merge 纵深防御：任何 reset/UI commit/prompt/marker 写入之前，对已激活 on-touch 的提案
  // 重跑 change-lint 所消费的同一 ClosureEvaluator。legacy（无声明且 tasks 无模式）不得被 L9
  // §12.7 的 auto-reset 必须**先于**准入判定：提前填充的 [code] 正是本流程设计来自动自愈的状态
  // （幂等、旧内容备份到 CODE_AUTORESET、不阻断）。若把合规门放在自愈之前，就会拒绝流程本该
  // 自动修好的东西——那是真误伤，而非提案不合规（架构 §四十一.6.3）。
  resetCodeSection(changePath, 'merge', locale);

  // §2.51.2 / 架构 §四十一.6.1：merge 的准入判定**等于** change-lint 的完整结论。
  //
  // 此前这里有两处缩水：① 用 hasBaselineClosureSignal 决定要不要预检——没有 baseline_closure
  // 声明或 [MODIFY]/[CREATE] 标记的提案整道预检不做；② 即使做了，也只保留
  // BASELINE_CLOSURE_VIOLATION_CODES 共 9 个码，L10 的 authority 违规与 L0～L7 全部被丢弃。
  // 于是 change-lint 判 FAIL 并点名具体测试 ID 的提案，在这里被照常放行。
  //
  // 此前另有一条 apply 路径对同一提案给出不同结论，正是「消费方自建缩水副本」这一分裂形态。
  // 0.15.0 删除该路径后，merge 的准入判定就是 change-lint 的完整结论，唯一一份。
  const preflight = runChangeLint(root, changePath, slug);
  if (!preflight.ok) {
    const prefix = preflight.errorCode === 'module_unresolved' ? '模块归属无法解析；' : '';
    console.error(`Error: ${prefix}merge 前合规预检无法完成（${preflight.errorCode}）：${preflight.message}`);
    console.error('  拒绝 merge：未生成 MERGE_PROMPT、未写 SPEC_MERGED、counter 或 index。');
    process.exit(1);
  }
  if (preflight.violations.length > 0) {
    console.error(`Error: change-lint 未通过（${preflight.violations.length} 项违规），拒绝 merge：`);
    // §2.51.5：逐条可归因——每条单独输出 code / 路径 / 具体字段 / fix_hint，禁止只给聚合结论。
    for (const v of preflight.violations) {
      console.error(`  - [${v.code}] ${v.path}：${v.message}`);
      if (v.fix_hint) console.error(`      修复：${v.fix_hint}`);
    }
    console.error('  未生成 MERGE_PROMPT、未写 SPEC_MERGED、counter 或 index。');
    console.error('  自查命令：openlogos change-lint --slug ' + slug + '（其结论与本准入判定同源）');
    process.exit(1);
  }


  const deltasDir = join(changePath, 'deltas');
  let deltas: DeltaFile[];
  try {
    deltas = scanDeltas(deltasDir);
  } catch (e) {
    // r4 F7：delta 枚举/元数据 IO 错误 → 与 change-lint 同映射（artifact_unreadable），
    // 绝不把不可读产物投影成 no-delta 成功。
    if (e instanceof DeltaScanUnreadableError) {
      console.error(`Error: delta 产物不可读（artifact_unreadable）：logos/changes/${slug}/${e.entry.relativePath}：${e.entry.ioError}`);
      console.error('  拒绝 merge：未生成 MERGE_PROMPT、未写 SPEC_MERGED。修复文件权限/IO 后重试。');
      process.exit(1);
    }
    throw e;
  }

  // F4 R7 / F1 freshness：原型完整性门（键=持久化 PLAN_APPROVED provenance，不读会话 capability）。
  // F2 修复：强制门的**触发**不得依赖易失/可损坏的 guard——两条独立触发，取或：
  //   (a) 持久化 PLAN_APPROVED 已含「曾渲染」证据（full/partial）⇒ 无论 guard/module 能否解析都强制；
  //   (b) module-aware ui_impact 派生为真（module 经共享 resolver 解析）。
  // S35 code-r2 F1：本块必须先于 no-delta 早退——否则 `> module: ghost` + ui_impact:true 的无 delta 提案
  // 会在 resolver 与 UI 门执行前直接写入 SPEC_MERGED（module-aware 判定的提案须先完成 resolver）。
  const provClass = classifyProvenance(readPlanApproved(changePath));
  const hasUiProvenanceEvidence = provClass === 'full' || provClass === 'partial';
  // S35 code-r1 F1：模块归属经共享 proposal-context resolver（头优先 / 同 slug guard 回退 / 模块须在 yaml 注册）。
  const moduleCtx = resolveProposalModuleContext(root, changePath, slug);

  // F2（code-r2）+ S35 code-r1 F1：当提案「看起来是 UI-first」（声明 ui_impact:true 或 deltas 下存在
  // page-design 原型 HTML）但既无「曾渲染」provenance 证据、模块上下文又不可解析（含**模块不存在于
  // logos-project.yaml** 的未知模块）时，**无法确认是否 GUI 项目** → 不得静默按非 GUI 跳过强制门 → fail closed。
  const decl = readUiUxDeclaration(changePath);
  const protoDeltaDir = join(changePath, PROTOTYPE_DELTA_SUBPATH);
  const hasPrototypeHtml = existsSync(protoDeltaDir)
    && readdirSync(protoDeltaDir).some(f => f.endsWith('.html') && statSync(join(protoDeltaDir, f)).isFile());
  const looksUiFirst = decl.ui_impact === true || hasPrototypeHtml;
  if (looksUiFirst && !hasUiProvenanceEvidence && !moduleCtx.ok) {
    console.error(`Error: 提案声明 ui_impact:true 或存在 page-design 原型，但模块归属无法解析（${moduleCtx.detail}）。`);
    console.error('  无法确认是否 GUI 项目 → fail closed 拒绝 merge：未生成 MERGE_PROMPT、未写 resources、未写 SPEC_MERGED。补 proposal.md 的 `> module:` 头（并确保模块已注册）后重试。');
    process.exit(1);
  }

  const uiImpact = hasUiProvenanceEvidence
    || (moduleCtx.ok && deriveUiImpact(root, moduleCtx.moduleId, changePath));
  if (uiImpact) {
    // ① 命令级 pre-merge hash gate：堵直接调用绕过。full 失配/损坏、partial → fail closed（不生成 MERGE_PROMPT、不写 SPEC_MERGED）。
    const hm = checkUiHashMatch(changePath);
    if (!hm.ok) {
      console.error(`Error: UI provenance 校验失败（${hm.cls}/${hm.code}）：${hm.detail ?? '批准后原型漂移或 provenance 不完整'}`);
      console.error('  拒绝 merge：未生成 MERGE_PROMPT、未写 resources、未写 SPEC_MERGED。remediation：显式重入 plan 刷新 PLAN_APPROVED.hashes 后重跑。');
      process.exit(1);
    }
    // ② 原型正式字节由 commitVerifiedPrototypes 落盘；仅历史回归模式保留旧 UI commit 路径。
    if (legacyMergeTestMode()) {
      const commit = commitVerifiedPrototypes(changePath, root);
      if (!commit.ok) {
        console.error(`Error: 原型事务落盘失败（${commit.reason}）：resources 回 merge 前态、零残留，拒绝 merge。`);
        process.exit(1);
      }
    }
  }

  if (deltas.length === 0) {
    if (legacyMergeTestMode()) {
      writeFileSync(join(changePath, SPEC_MERGED_MARKER), noDeltaSpecMergedMarker());
      console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}`);
      return;
    }
    runDirectMerge(root, changePath, slug);
    console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}`);
    return;
  }

  // F3：非法 .md delta 报错停下——绝不静默整份覆盖主文档、不写 SPEC_MERGED。
  // 收窄：仅 markdown 规格/skill delta 受此约束；`2-page-design/` 原型资产（.html）走整份落盘、不需段标记。
  // S35 显式语义收紧之二：经共享 validateMarkdownDelta，除段标记外同时拒绝模板骨架（占位字面量未替换）。
  const conservationSectionWriters = new Map<string, string[]>(); // code-r1 F1：`${targetRel}#${sectionLine}` → 写者列表
  for (const d of deltas) {
    if (d.relativePath.endsWith('.md') && !isPrototypeAsset(d.relativePath)) {
      const content = readFileSync(d.deltaPath, 'utf-8');
      const v = validateMarkdownDelta(content);
      if (v.missingSectionMarker) {
        console.error(`Error: 非法 delta（缺 ADDED/MODIFIED/REMOVED 段标记）：${d.relativePath}`);
        console.error('  绝不静默整份覆盖主文档；请补段标记后重试。未生成 MERGE_PROMPT、未写 SPEC_MERGED。');
        process.exit(1);
      }
      if (v.templateSkeleton) {
        console.error(`Error: 非法 delta（模板占位字面量未替换）：${d.relativePath}（${v.skeletonHits[0]}）`);
        console.error('  模板骨架 delta 会把占位内容写入主文档；请替换为真实内容后重试。未生成 MERGE_PROMPT、未写 SPEC_MERGED。');
        process.exit(1);
      }
      // S37 L8 条目守恒（merge-conservation-archive-audit）：与 change-lint L8 共享同一判据函数
      //（严禁第二份判据）。任一违规 → 非零退出、不生成 MERGE_PROMPT、不写任何 marker（与模板骨架拒绝同级）。
      // 目标主文档不存在（全新文档）无守恒义务。
      const targetRel = deltaTargetProjectPath(d.relativePath);
      if (targetRel) {
        const targetAbs = join(root, targetRel);
        if (existsSync(targetAbs)) {
          const targetContent = readFileSync(targetAbs, 'utf-8');
          const conservation = evaluateDeltaConservation(content, targetContent);
          if (conservation.length > 0) {
            console.error(t(locale, 'merge.conservationRejected', { path: d.relativePath }));
            for (const cv of conservation) {
              console.error(`  - [${cv.code}] ${cv.message}`);
            }
            console.error(t(locale, 'merge.conservationHint'));
            process.exit(1);
          }
          // code-r1 F1：跨 delta 文件的同一目标章节多写者 fail-closed（与 lint 共享同一解析辅助）
          for (const key of resolveModifiedSectionKeys(content, targetContent)) {
            const k = `${targetRel}#${key}`;
            conservationSectionWriters.set(k, [...(conservationSectionWriters.get(k) ?? []), d.relativePath]);
          }
        }
      }
    }
  }
  for (const [k, writers] of conservationSectionWriters) {
    if (writers.length < 2) continue;
    console.error(t(locale, 'merge.conservationRejected', { path: writers.join('、') }));
    console.error(`  - [delta_implicit_id_removal] 目标 ${k.split('#')[0]} 的同一章节被 ${writers.length} 个 delta 文件的 MODIFIED 写入——顺序应用下后写覆盖前写；每章节仅允许一个 MODIFIED 写者`);
    console.error(t(locale, 'merge.conservationHint'));
    process.exit(1);
  }

  if (legacyMergeTestMode()) {
    const proposalPath = join(changePath, 'proposal.md');
    const proposalContent = existsSync(proposalPath) ? readFileSync(proposalPath, 'utf-8') : '(proposal.md not found)';
    const promptDeltas = uiImpact ? deltas.filter(d => !isPrototypeAsset(d.relativePath)) : deltas;
    if (promptDeltas.length === 0) {
      writeFileSync(join(changePath, SPEC_MERGED_MARKER), noDeltaSpecMergedMarker());
      console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}`);
      return;
    }
    const promptContent = mergePromptTemplate(locale, slug, proposalContent, promptDeltas.map(d => ({
      relativePath: d.relativePath, deltaFullPath: relative(root, d.deltaPath), targetDir: d.targetDir,
    })));
    writeFileSync(join(changePath, 'MERGE_PROMPT.md'), promptContent);
    writeFileSync(join(changePath, 'MERGE_PROMPT_GENERATED'), '');
    console.log(`\n  ✓ logos/changes/${slug}/MERGE_PROMPT.md`);
    return;
  }

  const result = runDirectMerge(root, changePath, slug);

  console.log(`\n📋 ${t(locale, 'merge.summary')}`);
  console.log(t(locale, 'merge.proposal', { slug }));
  console.log(t(locale, 'merge.deltaCount', { count: String(deltas.length) }));
  for (const target of result.targets) {
    console.log(`    → ${target}`);
  }

  console.log(`\n  ✓ logos/changes/${slug}/${SPEC_MERGED_MARKER}（${result.target_count} 个 canonical target 一次性原子落盘）`);
  console.log(`  test_change_set: C=${result.test_change_set.changed_test_ids.length} R=${result.test_change_set.removed_test_ids.length}`);

  console.log(`\n${t(locale, 'merge.archiveHint', { slug })}\n`);
}
