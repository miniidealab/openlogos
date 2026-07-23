import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { readLocale, t, mergePromptTemplate } from '../i18n.js';
import { resetCodeSection } from '../lib/proposal-lifecycle.js';
// S35 前置重构②③⑤：段标记/模板骨架校验、delta 分类、模块归属解析改为共享判据打包调用（严禁第二份判据）。
import { DELTA_TO_RESOURCE, validateMarkdownDelta, classifyProposalDeltas, resolveProposalModuleContext, DeltaScanUnreadableError } from '../lib/change-lint.js';
import { deriveUiImpact, readUiUxDeclaration } from '../lib/ui-first.js';
import {
  checkUiHashMatch, commitVerifiedPrototypes, recoverCommitJournal,
  readPlanApproved, classifyProvenance, PROTOTYPE_DELTA_SUBPATH,
} from '../lib/ui-provenance.js';

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

  if (existsSync(join(changePath, 'SPEC_MERGED'))) {
    console.log(`\n✓ ${t(locale, 'merge.alreadyMerged', { slug })}`);
    return;
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
    // ② 原型资产落盘唯一入口（事务性）：commitVerifiedPrototypes；merge-executor 绝不触碰原型资产。
    const commit = commitVerifiedPrototypes(changePath, root);
    if (!commit.ok) {
      console.error(`Error: 原型事务落盘失败（${commit.reason}）：resources 回 merge 前态、零残留，拒绝 merge。`);
      process.exit(1);
    }
  }

  if (deltas.length === 0) {
    writeFileSync(join(changePath, 'SPEC_MERGED'), noDeltaSpecMergedMarker());
    console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}`);
    return;
  }

  // F3：非法 .md delta 报错停下——绝不静默整份覆盖主文档、不写 SPEC_MERGED。
  // 收窄：仅 markdown 规格/skill delta 受此约束；`2-page-design/` 原型资产（.html）走整份落盘、不需段标记。
  // S35 显式语义收紧之二：经共享 validateMarkdownDelta，除段标记外同时拒绝模板骨架（占位字面量未替换）。
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
    }
  }

  const proposalPath = join(changePath, 'proposal.md');
  const proposalContent = existsSync(proposalPath)
    ? readFileSync(proposalPath, 'utf-8')
    : '(proposal.md not found)';

  // 原型资产已由 commitVerifiedPrototypes 落盘，从 MERGE_PROMPT 的 delta 清单剔除（merge-executor 只应用 markdown 规格 delta）。
  const promptDeltas = uiImpact ? deltas.filter(d => !isPrototypeAsset(d.relativePath)) : deltas;

  // 剔除原型后无 markdown delta 可合并（全为原型资产）→ 视同 no-delta 已完成 spec 阶段。
  if (promptDeltas.length === 0) {
    writeFileSync(join(changePath, 'SPEC_MERGED'), noDeltaSpecMergedMarker());
    console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}`);
    return;
  }

  const promptContent = mergePromptTemplate(locale, slug, proposalContent, promptDeltas.map(d => ({
    relativePath: d.relativePath,
    deltaFullPath: relative(root, d.deltaPath),
    targetDir: d.targetDir,
  })));

  const promptPath = join(changePath, 'MERGE_PROMPT.md');
  writeFileSync(promptPath, promptContent);
  writeFileSync(join(changePath, 'MERGE_PROMPT_GENERATED'), '');

  console.log(`\n📋 ${t(locale, 'merge.summary')}`);
  console.log(t(locale, 'merge.proposal', { slug }));
  console.log(t(locale, 'merge.deltaCount', { count: String(promptDeltas.length) }));
  for (const d of promptDeltas) {
    console.log(`    ${d.relativePath} → ${d.targetDir}/`);
  }

  console.log(`\n  ✓ logos/changes/${slug}/MERGE_PROMPT.md`);

  console.log(`\n💡 ${t(locale, 'merge.aiHint', { slug })}`);
  console.log(`\n${t(locale, 'merge.archiveHint', { slug })}\n`);
}
