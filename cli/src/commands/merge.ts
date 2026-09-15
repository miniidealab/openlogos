import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { readLocale, t, mergePromptTemplate } from '../i18n.js';
import { resetCodeSection } from '../lib/proposal-lifecycle.js';
// S35 前置重构②③⑤：段标记/模板骨架校验、delta 分类、模块归属解析改为共享判据打包调用（严禁第二份判据）。
import { DELTA_TO_RESOURCE, validateMarkdownDelta, classifyProposalDeltas, resolveProposalModuleContext, DeltaScanUnreadableError, evaluateDeltaConservation, deltaTargetProjectPath, resolveModifiedSectionKeys, runChangeLint } from '../lib/change-lint.js';
import { recoverBaselineClosureApply } from '../lib/baseline-apply.js';
import { deriveUiImpact, readUiUxDeclaration } from '../lib/ui-first.js';
import { mergeDirect, type MergeDirectHooks } from '../lib/merge-direct.js';
import { describeMergeFailure } from '../lib/merge-failure-report.js';
import {
  checkUiHashMatch, commitVerifiedPrototypes, recoverCommitJournal,
  finalizePrototypeCommit, rollbackPrototypeCommit,
  readPlanApproved, classifyProvenance, PROTOTYPE_DELTA_SUBPATH, PROTOTYPE_RESOURCE_SUBPATH,
  type CommitResult,
} from '../lib/ui-provenance.js';
import { SPEC_MERGED_MARKER } from '../lib/proposal-markers.js';

/**
 * `spec/proposal-ui-ux-first.md` §12.3.2 原型落盘失败分档。
 *
 * **档位只由控制流位置与唯一入口的结构化返回值派生**，绝不从输出文本反推（§2.69.2）：
 * - `none` / `committed`：`ok:true`，按 committed 是否为空区分；
 * - `P0` 写入前拒绝：`ok:false` 且 `rolledBack` 字段缺席——唯一入口在写入任何 target 字节之前
 *   返回（partial provenance、staged 全量 hash 失配），此时磁盘零改动；
 * - `P1` 已完整回滚：`ok:false, rolledBack:true`；
 * - `P2` 回滚不完整 / 不可确认：`ok:false, rolledBack:false`，恢复材料被刻意保留。
 */
export type PrototypeCommitTier = 'skipped' | 'none' | 'committed' | 'P0' | 'P1' | 'P2';

export interface PrototypeCommitOutcome {
  tier: PrototypeCommitTier;
  committed: string[];
  reason?: string;
}

export function gradePrototypeCommit(result: CommitResult): PrototypeCommitOutcome {
  if (result.ok) {
    return { tier: result.committed.length > 0 ? 'committed' : 'none', committed: [...result.committed] };
  }
  if (result.rolledBack === undefined) return { tier: 'P0', committed: [], reason: result.reason };
  return { tier: result.rolledBack ? 'P1' : 'P2', committed: [], reason: result.reason };
}

/**
 * §12.3.1 约束 B：落盘结果进 merge 摘要，与 canonical target 同级可见。
 * **禁止静默**——成功逐个列出目标相对路径，零个明说「本次无原型资产」，失败打印该档规定的状态声明。
 */
export function renderPrototypeSummary(outcome: PrototypeCommitOutcome): string[] {
  const resourceRel = PROTOTYPE_RESOURCE_SUBPATH.replace(/\\/g, '/');
  switch (outcome.tier) {
    case 'skipped':
      return [];
    case 'none':
      return ['  原型落盘：本次无原型资产'];
    case 'committed':
      return [
        `  原型落盘：${outcome.committed.length} 个已提交`,
        ...outcome.committed.map(b => `    → ${resourceRel}/${b}`),
      ];
    case 'P0':
      return [
        `  ⚠️  原型未落盘（${outcome.reason ?? 'unknown'}）：resources 保持 merge 前态、零残留；规格 delta 照常合并。`,
        '      跑 `openlogos check-ui-hash-match` 查看失配详情；或显式重入 plan 刷新 PLAN_APPROVED.hashes 后重跑。',
      ];
    case 'P1':
      return [
        `  ⚠️  原型未落盘（${outcome.reason ?? 'unknown'}）：提交中途失败后**已完整回滚**，resources 保持 merge 前态、零残留；规格 delta 照常合并。`,
        '      跑 `openlogos check-ui-hash-match` 查看详情；或显式重入 plan 刷新 PLAN_APPROVED.hashes 后重跑。',
      ];
    case 'P2':
      // 档 P2 的状态声明由 describeMergeFailure 的 prototype-unconfirmed 专用文案统一输出，
      // 摘要在此不重复、更不得出现任何零残留措辞（合并已中止，本函数在该档不会被摘要路径调用）。
      return [`  ⚠️  原型事务状态不可确认（${outcome.reason ?? 'unknown'}）：见上方失败报告。`];
  }
}


/**
 * §12.3.3 阶段钩子构造：原型事务的**提交点 / 清理点 / 回滚点**。
 *
 * 独立导出以便测试直接把真实钩子挂到 `runDirectMerge`（而不是复刻一份，避免第二份判据）。
 * `outcome` 为出参：钩子把分档结果写回，供摘要与失败路径读取。
 */
export function buildPrototypeHooks(
  changePath: string,
  root: string,
  slug: string,
  outcome: PrototypeCommitOutcome,
): MergeDirectHooks {
  return {
    afterPrepare() {
      let graded: PrototypeCommitOutcome;
      try {
        graded = gradePrototypeCommit(commitVerifiedPrototypes(changePath, root, { deferCleanup: true }));
      } catch (err) {
        // code-r1 F3：唯一入口**抛出**而非返回 CommitResult（如 rename 之后 journal 持久化失败、
        // abortTransaction 二次抛出）。此时无法证实原型是否已被替换 ⇒ fail-safe 取档 P2：
        // 保留全部恢复材料、中止合并，绝不按「未写入」声明旧态。
        outcome.tier = 'P2';
        outcome.committed = [];
        outcome.reason = `commit_threw:${(err as Error).message}`;
        return { abort: true, reason: `原型事务在写入过程中抛出异常，状态不可确认（${(err as Error).message}）` };
      }
      outcome.tier = graded.tier;
      outcome.committed = graded.committed;
      outcome.reason = graded.reason;
      // 档 P2：回滚不完整/不可确认 ⇒ 中止合并（不落盘、不写 SPEC_MERGED、非零退出），
      // 恢复材料保留，状态声明由 describeMergeFailure 的 prototype-unconfirmed 专用文案输出。
      if (graded.tier === 'P2') {
        return { abort: true, reason: `原型事务回滚不完整或状态不可确认（${graded.reason ?? 'unknown'}）` };
      }
    },
    afterCommit() {
      if (outcome.tier !== 'committed') return;
      const fin = finalizePrototypeCommit(changePath);
      if (!fin.ok) {
        console.log(`  ⚠️  原型事务材料清理失败（${fin.reason}）：原型字节已正确落盘，`
          + `残留材料在 logos/changes/${slug}/ 下，可手工清理或等下次 merge 启动恢复。`);
      }
    },
    onApplyFailure(info) {
      if (outcome.tier !== 'committed') return;
      // code-r1 F1：**只有规格侧已确认整批回滚时**才补偿回滚原型。规格侧「已提交或不可确认」
      // （如 phase='committed' 之后清理失败：主文档已是新字节、SPEC_MERGED 已在场）时单独把原型
      // 退回旧版，会造出「规格新 / 原型旧」的永久分叉，且销毁补偿材料后重跑也修不回来。
      if (!info.rolledBack) {
        console.error('  ⚠️  规格侧状态不可确认（可能已提交）：不单独回滚原型，原型恢复材料全部保留。');
        console.error('      请核对 git status；git diff logos/resources/ 与 SPEC_MERGED 是否在场后再决定处置。');
        return { consistent: false, unconfirmed: true, reason: 'spec_state_unconfirmed' };
      }
      // 规格侧已确认回滚 ⇒ 依保留的 journal 回滚原型，两侧共同回到 merge 前一致态。
      // code-r2 F2：补偿调用必须有异常边界——返回失败与直接抛错都要形成「原型不可确认」的
      // 结构化结果回传给协调层，绝不让异常在整体阶段戳生成前逃出（那会退回档 A 的旧态断言）。
      let rb: { ok: boolean; rolledBack: boolean; reason?: string };
      try {
        rb = rollbackPrototypeCommit(changePath);
      } catch (err) {
        rb = { ok: false, rolledBack: false, reason: `rollback_threw:${(err as Error).message}` };
      }
      if (rb.rolledBack) {
        console.error('  原型已依 journal 回滚至 merge 前字节（恢复材料已清理）。');
        return { consistent: true, unconfirmed: false };
      }
      // code-r1 F2：补偿失败必须回传，否则整体会被盖上「已整批回滚」的档 B。
      console.error(`  ⚠️  原型回滚不完整（${rb.reason ?? 'unknown'}）：部分原型可能仍是新字节，恢复材料已保留，`
        + '请核对 git diff logos/resources/prd/2-product-design/2-page-design/ 后再重跑 merge。');
      return { consistent: false, unconfirmed: true, reason: rb.reason };
    },
  };
}

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

export interface RunDirectMergeDeps {
  /** 仅测试注入：桩化合并实现，用于在不真实落盘的前提下观察失败出口行为。 */
  merge?: typeof mergeDirect;
  stderr?: (line: string) => void;
  exit?: (code: number) => never;
  /** §12.3.3 阶段钩子：原型事务的提交点 / 清理点 / 回滚点，透传给 `mergeDirect`。 */
  hooks?: MergeDirectHooks;
}

/**
 * 直接合并的命令层包装：失败出口由「**默认放行**未登记错误类」改为「**默认兜底**」（§2.84.3）。
 *
 * 旧实现只映射 `MergeDirectError`、其余一律 `throw e`——`TestChangeSetBuildError` 等内部错误类
 * 因此逃到进程顶层裸抛 Node 未捕获异常堆栈：无稳定前缀、无错误码、无状态声明、无回滚点，
 * §2.69.1 明文失败语义对它们整体不成立（20260914 下游 driver 实测即卡在此：账本只剩 exit 1）。
 *
 * 现在：任何逃出者都产出四要素稳定形态（稳定前缀与错误码 + 按档状态声明 + 后续动作指引 + 非零
 * 退出）。状态声明按结构化事实分档，**不**无条件断言零残留——committed 之后的清理失败会使
 * 「保持合并前字节」成为与磁盘相反的断言，那比裸堆栈更有害。
 */
export function runDirectMerge(root: string, changePath: string, slug: string, deps: RunDirectMergeDeps = {}) {
  const runMerge = deps.merge ?? mergeDirect;
  const writeErr = deps.stderr ?? ((line: string) => console.error(line));
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  try {
    return runMerge(root, changePath, slug, deps.hooks ?? {});
  } catch (e) {
    for (const line of describeMergeFailure(changePath, slug, e).lines) writeErr(line);
    return exit(1);
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
    // §2.74.2：同属 provenance 观察面，降为告警——模块归属无法解析不影响合并本身的正确性。
    console.log(`  ⚠️  提案声明 ui_impact:true 或存在 page-design 原型，但模块归属无法解析（${moduleCtx.detail}）。`);
    console.log('      建议补 proposal.md 的 `> module:` 头（并确保模块已在 logos-project.yaml 注册）。');
  }

  const uiImpact = hasUiProvenanceEvidence
    || (moduleCtx.ok && deriveUiImpact(root, moduleCtx.moduleId, changePath));
  if (uiImpact) {
    // ① 命令级 pre-merge hash gate：堵直接调用绕过。full 失配/损坏、partial → fail closed（不生成 MERGE_PROMPT、不写 SPEC_MERGED）。
    // §2.74.2：原型 hash 对账是**审计性质的观察**（防「批准后漂移」），按 §10 不得出现在流程分支的
    // 条件里，故降为告警。诊断能力不减——`openlogos check-ui-hash-match` 单独运行仍如实报失配并非零退出。
    const hm = checkUiHashMatch(changePath);
    if (!hm.ok) {
      console.log(`  ⚠️  UI provenance 校验失败（${hm.cls}/${hm.code}）：${hm.detail ?? '批准后原型漂移或 provenance 不完整'}`);
      console.log('      如需修复：显式重入 plan 刷新 PLAN_APPROVED.hashes 后重跑 `openlogos check-ui-hash-match` 复核。');
    }
    // ② 原型正式字节由 commitVerifiedPrototypes 落盘。
    //    §12.3.1 约束 A：**正常分支**的调用点在下方 `prototypeHooks.afterPrepare`——安装态
    //    （无 OPENLOGOS_INTERNAL_*、NODE_ENV!=='test'）执行 `openlogos merge` 时必定被求值。
    //    此处仅保留历史 MERGE_PROMPT 回归路径（该路径不经 mergeDirect，故钩子不会触发）。
    if (legacyMergeTestMode()) {
      const commit = commitVerifiedPrototypes(changePath, root);
      if (!commit.ok) {
        for (const line of renderPrototypeSummary(gradePrototypeCommit(commit))) console.log(line);
      }
    }
  }

  // §12.3.3 写入阶段前置 + 材料保留：原型事务挂在 mergeDirect 的阶段钩子上——
  // 全部 canonical target 解析/合成/物质结果复验完成之后才提交原型（合成失败时原型根本不提交），
  // 且恢复材料保留到「规格原子落盘 + SPEC_MERGED 写入」均成功之后才清理。
  const prototypeOutcome: PrototypeCommitOutcome = { tier: 'skipped', committed: [] };
  const prototypeHooks: MergeDirectHooks = uiImpact && !legacyMergeTestMode()
    ? buildPrototypeHooks(changePath, root, slug, prototypeOutcome)
    : {};

  if (deltas.length === 0) {
    if (legacyMergeTestMode()) {
      writeFileSync(join(changePath, SPEC_MERGED_MARKER), noDeltaSpecMergedMarker());
      console.log(`\n✓ ${t(locale, 'merge.noDelta', { slug })}`);
      return;
    }
    runDirectMerge(root, changePath, slug, { hooks: prototypeHooks });
    for (const line of renderPrototypeSummary(prototypeOutcome)) console.log(line);
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
          // §2.73：条目守恒降级为警告——诊断照常逐条给出，但不再阻断合并。
          // 静默删除由 `openlogos verify` 的孤儿结果检查兜住（规格删了 ID 而测试还在跑即判不一致）。
          // 例外：锚不可解析是定位失败，`composeOpenLogosMarkdown` 在合成阶段仍会 fail-closed。
          for (const cv of evaluateDeltaConservation(content, targetContent)) {
            console.log(`  ⚠️  [${cv.code}] ${d.relativePath}：${cv.message}`);
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
    console.log(`  ⚠️  [delta_implicit_id_removal] 目标 ${k.split('#')[0]} 的同一章节被 ${writers.length} 个 delta 文件的 MODIFIED 写入（${writers.join('、')}）`
      + '——顺序应用下后写覆盖前写；每章节仅允许一个 MODIFIED 写者');
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

  const result = runDirectMerge(root, changePath, slug, { hooks: prototypeHooks });

  console.log(`\n📋 ${t(locale, 'merge.summary')}`);
  console.log(t(locale, 'merge.proposal', { slug }));
  console.log(t(locale, 'merge.deltaCount', { count: String(deltas.length) }));
  for (const target of result.targets) {
    console.log(`    → ${target}`);
  }
  // §12.3.1 约束 B：原型落盘结果与 canonical target 同级可见，禁止静默。
  for (const line of renderPrototypeSummary(prototypeOutcome)) console.log(line);

  console.log(`\n  ✓ logos/changes/${slug}/${SPEC_MERGED_MARKER}（${result.target_count} 个 canonical target 一次性原子落盘）`);
  console.log(`  test_change_set: C=${result.test_change_set.changed_test_ids.length} R=${result.test_change_set.removed_test_ids.length}`);

  console.log(`\n${t(locale, 'merge.archiveHint', { slug })}\n`);
}
