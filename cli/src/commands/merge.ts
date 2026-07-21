import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { readLocale, t, mergePromptTemplate } from '../i18n.js';
import { resetCodeSection } from '../lib/proposal-lifecycle.js';
import { deriveUiImpact, readUiUxDeclaration } from '../lib/ui-first.js';
import {
  checkUiHashMatch, commitVerifiedPrototypes, recoverCommitJournal,
  readPlanApproved, classifyProvenance, PROTOTYPE_DELTA_SUBPATH,
} from '../lib/ui-provenance.js';

/** F3：markdown 规格/skill delta 必须含 ADDED/MODIFIED/REMOVED 段标记（防静默整份覆盖）。 */
const SECTION_MARKER_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\b/m;
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

/**
 * 从 proposal.md 头部 `> module: <id>` 读取提案归属模块（**持久、不可歧义**的事实源，
 * 不依赖易失/可损坏的 guard 文件）。用于 module-aware ui_impact 派生，避免 guard 缺失即静默跳过强制门（F2）。
 */
function readProposalModule(proposalDir: string): string | undefined {
  const p = join(proposalDir, 'proposal.md');
  if (!existsSync(p)) return undefined;
  const m = /(?:^|\n)>\s*module:\s*([a-z][a-z0-9-]*)/i.exec(readFileSync(p, 'utf-8'));
  return m ? m[1] : undefined;
}

const DELTA_TO_RESOURCE: Record<string, string> = {
  'prd': 'logos/resources/prd',
  'api': 'logos/resources/api',
  'database': 'logos/resources/database',
  'scenario': 'logos/resources/scenario',
  'test': 'logos/resources/test',
  'spec': 'spec',
  'skills': 'skills',
};

interface DeltaFile {
  deltaPath: string;
  targetDir: string;
  relativePath: string;
}

export function scanDeltas(deltasDir: string): DeltaFile[] {
  const results: DeltaFile[] = [];
  if (!existsSync(deltasDir)) return results;

  for (const category of readdirSync(deltasDir).sort()) {
    const categoryDir = join(deltasDir, category);
    if (!statSync(categoryDir).isDirectory()) continue;

    const targetDir = DELTA_TO_RESOURCE[category];
    if (!targetDir) continue;

    const files = readdirSync(categoryDir, { recursive: true })
      .map(f => String(f))
      .filter(f => {
        const full = join(categoryDir, f);
        return statSync(full).isFile()
          && !f.split(/[\\/]/).some(part => part.startsWith('.'))
          && !f.endsWith('.gitkeep');
      })
      .sort();

    for (const file of files) {
      results.push({
        deltaPath: join(categoryDir, file),
        targetDir: join(targetDir, dirname(file)),
        relativePath: `deltas/${category}/${file}`,
      });
    }
  }

  return results;
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
  const deltas = scanDeltas(deltasDir);

  if (deltas.length === 0) {
    writeFileSync(join(changePath, 'SPEC_MERGED'), noDeltaSpecMergedMarker());
    console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}`);
    return;
  }

  // F3：非法 .md delta（缺 ADDED/MODIFIED/REMOVED 段标记）报错停下——绝不静默整份覆盖主文档、不写 SPEC_MERGED。
  // 收窄：仅 markdown 规格/skill delta 受此约束；`2-page-design/` 原型资产（.html）走整份落盘、不需段标记。
  for (const d of deltas) {
    if (d.relativePath.endsWith('.md') && !isPrototypeAsset(d.relativePath)) {
      const content = readFileSync(d.deltaPath, 'utf-8');
      if (!SECTION_MARKER_RE.test(content)) {
        console.error(`Error: 非法 delta（缺 ADDED/MODIFIED/REMOVED 段标记）：${d.relativePath}`);
        console.error('  绝不静默整份覆盖主文档；请补段标记后重试。未生成 MERGE_PROMPT、未写 SPEC_MERGED。');
        process.exit(1);
      }
    }
  }

  // F4 R7 / F1 freshness：原型完整性门（键=持久化 PLAN_APPROVED provenance，不读会话 capability）。
  // F2 修复：强制门的**触发**不得依赖易失/可损坏的 guard——两条独立触发，取或：
  //   (a) 持久化 PLAN_APPROVED 已含「曾渲染」证据（full/partial）⇒ 无论 guard/module 能否解析都强制（这是 F4 R7 的核心：证据固化于批准记录）；
  //   (b) module-aware ui_impact 派生为真（module 取自 proposal.md 持久归属，其次 guard）——覆盖「原型已产出但批准记录为空/legacy」的 advisory 落盘路径。
  const provClass = classifyProvenance(readPlanApproved(changePath));
  const hasUiProvenanceEvidence = provClass === 'full' || provClass === 'partial';
  const moduleId = readProposalModule(changePath) ?? readGuard(root)?.module;

  // F2（code-r2）：当提案「看起来是 UI-first」（声明 ui_impact:true 或 deltas 下存在 page-design 原型 HTML）
  // 但既无「曾渲染」provenance 证据、两处 module 事实源（proposal.md `> module:` + guard.module）又都不可解析时，
  // **无法确认是否 GUI 项目** → 不得把 undefined 当非 GUI 静默跳过强制门 → fail closed 拒绝 merge。
  const decl = readUiUxDeclaration(changePath);
  const protoDeltaDir = join(changePath, PROTOTYPE_DELTA_SUBPATH);
  const hasPrototypeHtml = existsSync(protoDeltaDir)
    && readdirSync(protoDeltaDir).some(f => f.endsWith('.html') && statSync(join(protoDeltaDir, f)).isFile());
  const looksUiFirst = decl.ui_impact === true || hasPrototypeHtml;
  if (looksUiFirst && !hasUiProvenanceEvidence && moduleId === undefined) {
    console.error('Error: 提案声明 ui_impact:true 或存在 page-design 原型，但无法解析归属 module（proposal.md 缺 `> module:` 且 guard 缺失/损坏/缺 module）。');
    console.error('  无法确认是否 GUI 项目 → fail closed 拒绝 merge：未生成 MERGE_PROMPT、未写 resources、未写 SPEC_MERGED。补 proposal.md 的 `> module:` 头或修复 guard 后重试。');
    process.exit(1);
  }

  const uiImpact = hasUiProvenanceEvidence || deriveUiImpact(root, moduleId, changePath);
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
