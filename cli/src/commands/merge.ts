import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { readLocale, t, mergePromptTemplate } from '../i18n.js';
import { resetCodeSection } from '../lib/proposal-lifecycle.js';
// S35 前置重构②③⑤：段标记/模板骨架校验、delta 分类、模块归属解析改为共享判据打包调用（严禁第二份判据）。
import { DELTA_TO_RESOURCE, validateMarkdownDelta, classifyProposalDeltas, resolveProposalModuleContext, DeltaScanUnreadableError, evaluateDeltaConservation, deltaTargetProjectPath, resolveModifiedSectionKeys, runChangeLint } from '../lib/change-lint.js';
import { BASELINE_CLOSURE_VIOLATION_CODES, hasBaselineClosureSignal } from '../lib/baseline-closure.js';
import { recoverBaselineClosureApply } from '../lib/baseline-apply.js';
import { deriveUiImpact, readUiUxDeclaration } from '../lib/ui-first.js';
import {
  applyMergeTransaction, createMergeTransaction, listMergeTransactionPlanTargets, sealMergeTransaction,
} from '../lib/merge-transaction.js';
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
  // 凭空激活；激活判据同样来自 baseline-closure 单点，调用方不复制 YAML/task 正则。
  let closureActive = false;
  try {
    const proposalBytes = existsSync(join(changePath, 'proposal.md'))
      ? readFileSync(join(changePath, 'proposal.md'), 'utf-8') : '';
    const tasksBytes = existsSync(join(changePath, 'tasks.md'))
      ? readFileSync(join(changePath, 'tasks.md'), 'utf-8') : '';
    closureActive = hasBaselineClosureSignal(proposalBytes, tasksBytes);
  } catch {
    console.error('Error: merge 前无法读取 proposal.md/tasks.md 以判定 on-touch 闭包（artifact_unreadable）。');
    console.error('  拒绝 merge：未生成 MERGE_PROMPT、未写 SPEC_MERGED、counter 或 index。');
    process.exit(1);
  }
  if (closureActive) {
    const closurePreflight = runChangeLint(root, changePath, slug);
    if (!closurePreflight.ok) {
      const prefix = closurePreflight.errorCode === 'module_unresolved' ? '模块归属无法解析；' : '';
      console.error(`Error: ${prefix}merge 前闭包预检无法完成（${closurePreflight.errorCode}）：${closurePreflight.message}`);
      console.error('  拒绝 merge：未生成 MERGE_PROMPT、未写 SPEC_MERGED、counter 或 index。');
      process.exit(1);
    }
    const closureCodes = new Set<string>(BASELINE_CLOSURE_VIOLATION_CODES);
    const closureViolations = closurePreflight.violations.filter(v => closureCodes.has(v.code));
    if (closureViolations.length > 0) {
      console.error('Error: on-touch 基线闭包未通过，拒绝 merge：');
      for (const v of closureViolations) console.error(`  - [${v.code}] ${v.path}：${v.message}`);
      console.error('  未生成 MERGE_PROMPT、未写 SPEC_MERGED、counter 或 index；按 fix_hint 修复后重试。');
      process.exit(1);
    }
  }

  // enforce-slice-stage-ordering §12.7：进入 slice 前 auto-reset 提前填充的 [code]（有 delta 提案落点，trigger:"merge"；幂等，已占位则不动）
  resetCodeSection(changePath, 'merge', locale);

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
    // ② 0.14.0 把原型正式字节纳入 merge transaction 同批提交；仅历史回归模式保留旧 UI commit。
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
    const transaction = createMergeTransaction(root, changePath, slug);
    if (transaction.phase === 'ready') {
      sealMergeTransaction(root, changePath);
      applyMergeTransaction(root, changePath);
    }
    console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}（merge transaction receipt）`);
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

  const transaction = createMergeTransaction(root, changePath, slug);

  console.log(`\n📋 ${t(locale, 'merge.summary')}`);
  console.log(t(locale, 'merge.proposal', { slug }));
  console.log(t(locale, 'merge.deltaCount', { count: String(deltas.length) }));
  for (const target of listMergeTransactionPlanTargets(changePath)) {
    const writeHint = target.staging_path ? `，staging=${target.staging_path}` : '，OpenLogos producer';
    console.log(`    ${target.delta_path} → ${target.target_ref}（${target.slot_id}${writeHint}）`);
  }

  console.log(`\n  ✓ logos/changes/${slug}/MERGE_TRANSACTION.json`);
  console.log(`  transaction_id: ${transaction.transaction_id}`);
  console.log(`  phase: ${transaction.phase}`);
  console.log(`  next_action: ${transaction.next_action ?? '<none>'}`);

  console.log('\n💡 Agent 只能通过 `openlogos merge transaction submit-content --slot <id> --file <path>` 提交最终内容；正式目标、receipt 与 marker 由 OpenLogos 写入。');
  console.log(`\n${t(locale, 'merge.archiveHint', { slug })}\n`);
}
