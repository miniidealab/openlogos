/**
 * flow-overlay-derive — M2 切片 1a：overlay 驱动 status/next/watch 派生。
 *
 * 现状派生引擎只读 builtin flow（不应用项目 overlay）。本模块在 builtin 派生之上叠加
 * **resolved flow（含 overlay）** 的 node 级派生视图：overlay `op:add` 节点经
 * `overlay_nodes` / `current_node` 承载（builtin 节点仍走 phase / proposal_step 维度）。
 *
 * 安全红线：无 overlay 文件时返回 null（不新增任何字段 → golden 零漂移）。
 * 见 spec/flow-spec.md §12 / spec/cli-json-output.md §3.6/§3.7。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFlow, readOverlay, FlowError, type Flow, type FlowNode, type Lifecycle } from './flow.js';
import { listFiles } from './list-files.js';
import {
  parseTaskSections,
  isProposalTemplateFilled,
  isTasksTemplateFilled,
  resolveProposalDeploymentDecision,
} from './proposal-lifecycle.js';
import { NODE_TO_PHASE_KEY, evalNodeWhen, detectProposalStepViaFlow } from './flow-derive.js';
import type { ModuleInfo } from '../commands/status.js';
import type { ProposalStep } from './proposal-lifecycle.js';

export type OverlayNodeState = 'done' | 'active' | 'skipped' | 'failed';

export interface OverlayNode {
  id: string;
  name: string;
  state: OverlayNodeState;
  subflow_id: string;
  node_index: number;
  overlay_op: 'add';
}

export interface CurrentNode {
  id: string;
  name: string;
  state: OverlayNodeState;
  subflow_id: string;
  node_index: number;
  phase_key: string | null;
  overlay_op: string | null;
}

export interface OverlayView {
  overlay_nodes: OverlayNode[];
  current_node: CurrentNode | null;
  /** launched：当前节点落在 overlay-added 节点时的 proposal_step 回退值（前序最近 builtin step / writing）。 */
  proposal_step_override: string | null;
}

interface DeriveCtx {
  root: string;
  lifecycle: Lifecycle;
  mod: ModuleInfo;
  proposalDir: string | null;
  scenarios: Array<{ id: string }>;
  isMultiModule: boolean;
}

/**
 * proposal_step → 当前「正在进行 / 等待」的 builtin launched 节点 id（前沿节点）。
 * 用于 overlay 走查中定位 builtin 前沿，避免重复推导 launched 的 when/done 复杂度（marker 优先级、subflow when、提案级决策）。
 */
const STEP_TO_CURRENT_BUILTIN: Record<string, string> = {
  'writing': 'write-proposal',
  'delta-writing': 'write-delta',
  'ready-to-merge': 'generate-merge-prompt',
  'merge-generated': 'apply-merge',
  'coding': 'code',
  'ready-to-verify': 'verify',
  'verify-failed': 'verify',
  'verify-passed': 'archive',
  'ready-to-deploy': 'deploy',
  'deploy-done': 'archive',
  'ready-to-smoke': 'smoke',
  'smoke-failed': 'smoke',
  'smoke-passed': 'archive',
  'archived': 'archive',
};

/** 求值 done_when / fail_when 谓词（M1 词表）。返回 true = 命中。 */
function evalPredicate(pred: string, node: FlowNode, ctx: DeriveCtx): boolean {
  const { root, proposalDir } = ctx;
  if (pred === 'dir_nonempty') {
    const produces = node.produces ?? '';
    const dir = produces.replace(/\/+$/, '');
    if (!dir) return false;
    const files = listFiles(join(root, dir));
    // 多模块按 {module}- 前缀过滤（与 deriveModulePhaseProgressViaFlow 同语义，Review F1）
    const scoped = ctx.isMultiModule
      ? files.filter(f => (f.split('/').pop() ?? f).startsWith(`${ctx.mod.id}-`))
      : files;
    return scoped.length > 0;
  }
  if (pred.startsWith('file:')) {
    return existsSync(join(root, pred.slice('file:'.length).trim()));
  }
  if (pred.startsWith('marker:')) {
    return proposalDir ? existsSync(join(proposalDir, pred.slice('marker:'.length).trim())) : false;
  }
  if (pred.startsWith('any_present:')) {
    if (!proposalDir) return false;
    const names = pred.slice('any_present:'.length).trim().replace(/^\[|\]$/g, '')
      .split(',').map(s => s.trim()).filter(Boolean);
    return names.some(n => existsSync(join(proposalDir, n)));
  }
  if (pred.startsWith('section_complete:')) {
    if (!proposalDir) return false;
    const tag = pred.slice('section_complete:'.length).trim();
    const tasks = existsSync(join(proposalDir, 'tasks.md')) ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
    const sections = parseTaskSections(tasks);
    const sec = sections?.[tag];
    return !sec || (sec.total > 0 && sec.checked === sec.total);
  }
  if (pred === 'proposal_package_filled') {
    if (!proposalDir) return false;
    const proposal = existsSync(join(proposalDir, 'proposal.md')) ? readFileSync(join(proposalDir, 'proposal.md'), 'utf-8') : '';
    const tasks = existsSync(join(proposalDir, 'tasks.md')) ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
    return isProposalTemplateFilled(proposal) && isTasksTemplateFilled(tasks);
  }
  if (pred === 'archived') {
    return proposalDir ? existsSync(join(root, 'logos', 'changes', 'archive', proposalDir.split('/').pop() ?? '')) : false;
  }
  if (pred === 'all_present') {
    const produces = node.produces ?? '';
    const dir = produces.slice(0, produces.lastIndexOf('/'));
    const files = listFiles(join(root, dir));
    if (ctx.scenarios.length === 0) return false;
    return ctx.scenarios.every(s => files.some(f => f.includes(`${ctx.mod.id}-${s.id}`)));
  }
  // 未知谓词：保守视为未命中
  return false;
}

/** M1 谓词白名单（spec §9 词表）。`cmd:`（M2 预留）与未知谓词不在内。 */
function isKnownM1Predicate(p: string): boolean {
  return p === 'dir_nonempty' || p.startsWith('file:') || p.startsWith('marker:')
    || p.startsWith('any_present:') || p.startsWith('section_complete:')
    || p === 'proposal_package_filled' || p === 'archived' || p === 'all_present';
}

/** 单个谓词（done_when / fail_when）的白名单 + lifecycle/produces 校验。 */
function validateAddedPredicate(node: FlowNode, ctx: DeriveCtx, pred: string, field: string): void {
  // 白名单：cmd: 与未知/拼错谓词一律拒绝（避免静默永久 active）——spec §10.3/§12.1
  if (!isKnownM1Predicate(pred)) {
    throw new FlowError('FLOW_SCHEMA_INVALID',
      `overlay-add 节点 \`${node.id}\` 的 ${field} \`${pred}\` 非本切片支持的谓词（cmd: 属 M2；不接受未知谓词）`);
  }
  const launchedOnly = pred.startsWith('marker:') || pred.startsWith('any_present:')
    || pred.startsWith('section_complete:') || pred === 'proposal_package_filled' || pred === 'archived';
  if (launchedOnly && ctx.lifecycle !== 'launched') {
    throw new FlowError('FLOW_SCHEMA_INVALID',
      `overlay-add 节点 \`${node.id}\` 的 ${field} \`${pred}\` 仅 launched 可用（initial 无提案目录，请改用 file:/dir_nonempty）`);
  }
  if (pred === 'dir_nonempty' && !node.produces) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `overlay-add 节点 \`${node.id}\` 的 ${field} dir_nonempty 须配 produces`);
  }
  if (pred === 'all_present' && (!node.for_each || !node.produces)) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `overlay-add 节点 \`${node.id}\` 的 ${field} all_present 须配 for_each + produces`);
  }
}

/** overlay-add 节点的「谓词 × lifecycle」合法组合校验（done_when 必有 + fail_when 可选）。 */
function validateAddedNodePredicate(node: FlowNode, ctx: DeriveCtx): void {
  if (!node.done_when || typeof node.done_when !== 'string') {
    throw new FlowError('FLOW_SCHEMA_INVALID', `overlay-add 节点 \`${node.id}\` 缺少可求值的 done_when`);
  }
  validateAddedPredicate(node, ctx, node.done_when, 'done_when');
  if (node.fail_when != null) {
    if (typeof node.fail_when !== 'string') {
      throw new FlowError('FLOW_SCHEMA_INVALID', `overlay-add 节点 \`${node.id}\` 的 fail_when 必须是字符串`);
    }
    validateAddedPredicate(node, ctx, node.fail_when, 'fail_when');
  }
}

/** launched 提案级 when 标志（delta_required / deployment_required / smoke_required）。 */
function launchedWhenFlags(proposalDir: string | null, mod: ModuleInfo): Record<string, boolean> {
  if (!proposalDir) return { delta_required: false, deployment_required: false, smoke_required: false };
  const tasks = existsSync(join(proposalDir, 'tasks.md')) ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
  const sections = parseTaskSections(tasks);
  const decision = resolveProposalDeploymentDecision(proposalDir, mod);
  return {
    delta_required: sections?.['delta'] !== undefined,
    deployment_required: decision.deployment_required === true,
    smoke_required: decision.smoke_required === true,
  };
}

/** 求值 launched 节点/子流程的 when（`flag` / `not flag`）。无 when 视为参与。 */
function evalLaunchedWhen(when: string | null | undefined, flags: Record<string, boolean>): boolean {
  if (!when) return true;
  const e = when.trim();
  const neg = e.startsWith('not ');
  const flag = (neg ? e.slice(4) : e).trim();
  const val = Boolean(flags[flag]);
  return neg ? !val : val;
}

/**
 * 从**原始 overlay ops**（readOverlay）解析 `op:add` 的锚点：addedNodeId → anchorNodeId。
 * resolved flow 已丢失 before/after 锚点信息，且「after write-proposal」与「before write-delta」
 * 在 resolved 中同位置但语义不同——必须回原始 ops 才能正确区分锚点（Review）。
 */
function buildAnchorMap(root: string, lifecycle: Lifecycle): Map<string, string> {
  const map = new Map<string, string>();
  const doc = readOverlay(root, lifecycle);
  if (doc?.overlay && Array.isArray(doc.overlay)) {
    for (const op of doc.overlay) {
      const o = op as Record<string, unknown>;
      const node = o.node as Record<string, unknown> | undefined;
      if (o.op === 'add' && node && typeof node.id === 'string') {
        const anchor = o.after ?? o.before;
        if (typeof anchor === 'string') map.set(node.id, anchor);
      }
    }
  }
  return map;
}

/**
 * 锚点继承：add 节点若锚定到一个因 when 为假被跳过的 builtin → 该 add 一并跳过（不阻塞）。
 * 锚点为另一个 add 时沿链解析至 builtin。`isBuiltinSkipped(entry)` 判断 builtin 锚点是否 when-skipped。
 */
function isAnchorSkipped(
  addId: string,
  anchorMap: Map<string, string>,
  ordered: Array<{ node: FlowNode; subflowWhen: string | null }>,
  isBuiltinSkipped: (e: { node: FlowNode; subflowWhen: string | null }) => boolean,
  seen: Set<string> = new Set(),
): boolean {
  const anchorId = anchorMap.get(addId);
  if (!anchorId || seen.has(addId)) return false;
  seen.add(addId);
  const e = ordered.find(x => x.node.id === anchorId);
  if (!e) return false;
  if (e.node.overlay_op === 'add') return isAnchorSkipped(anchorId, anchorMap, ordered, isBuiltinSkipped, seen);
  return isBuiltinSkipped(e);
}

/**
 * 派生 overlay 视图。无 overlay 文件 → 返回 null（golden 零漂移）。
 * 抛 FLOW_SCHEMA_INVALID：launched 对 builtin 节点的 skip/reorder、overlay-add 谓词组合非法。
 */
export function deriveOverlayView(
  root: string,
  mod: ModuleInfo,
  scenarios: Array<{ id: string }>,
  proposalDir: string | null,
  isMultiModule: boolean = false,
): OverlayView | null {
  const lifecycle = mod.lifecycle;
  const loaded = loadFlow(root, { lifecycle, resolved: true });
  if (!loaded.overlay_applied) return null; // 无 overlay → 不新增字段

  const flow: Flow = loaded.flow;
  const ctx: DeriveCtx = { root, lifecycle, mod, proposalDir, scenarios, isMultiModule };

  // 校验：launched 对 builtin 节点的 skip/reorder 不支持（fail loud）
  if (lifecycle === 'launched') {
    for (const sub of flow.subflows) {
      for (const node of sub.nodes) {
        if (node.overlay_op === 'skip' || node.overlay_op === 'reorder') {
          throw new FlowError('FLOW_SCHEMA_INVALID',
            `launched 流程的内置节点不支持 overlay ${node.overlay_op}（节点 \`${node.id}\`）；本切片仅 add / modify 生效`);
        }
      }
    }
  }
  // 校验：overlay-add 节点谓词组合
  for (const sub of flow.subflows) {
    for (const node of sub.nodes) {
      if (node.overlay_op === 'add') validateAddedNodePredicate(node, ctx);
    }
  }

  // launched 无活跃提案：只做上面的 flow 配置校验（skip/reorder fail-loud、谓词白名单），
  // **不输出 node 级 overlay 视图**——否则会把 before write-proposal 的 add 误判为 current，
  // 覆盖「openlogos change <slug>」建议，且无 proposalDir 时 marker 类 done_when 永不可达（Review）。
  if (lifecycle === 'launched' && !proposalDir) {
    return { overlay_nodes: [], current_node: null, proposal_step_override: null };
  }

  // 按 resolved 顺序展开节点（带所属 subflow 的 when，供 overlay 节点跳过判定）。
  const ordered: Array<{ node: FlowNode; subflowId: string; subflowWhen: string | null; index: number }> = [];
  let idx = 0;
  for (const sub of flow.subflows) {
    for (const node of sub.nodes) ordered.push({ node, subflowId: sub.id, subflowWhen: sub.when ?? null, index: idx++ });
  }
  // add 节点的原始锚点（before/after + anchor id），用于锚点继承的 skip 判定。
  const anchorMap = buildAnchorMap(root, lifecycle);

  const reachedAdded: OverlayNode[] = [];
  let current: { node: FlowNode; subflowId: string; index: number; state: OverlayNodeState } | null = null;
  let proposalStepOverride: string | null = null;

  if (lifecycle === 'launched') {
    // launched：以 detectProposalStepViaFlow 为权威前沿，不重复推导 launched builtin 的 when/done。
    const step: ProposalStep = proposalDir ? detectProposalStepViaFlow(proposalDir, mod) : 'writing';
    const frontierId = STEP_TO_CURRENT_BUILTIN[step] ?? 'archive';
    const frontierIdx = ordered.findIndex(e => e.node.overlay_op !== 'add' && e.node.id === frontierId);
    const flags = launchedWhenFlags(proposalDir, mod);
    const launchedBuiltinSkipped = (e: { node: FlowNode; subflowWhen: string | null }) =>
      !evalLaunchedWhen(e.node.when, flags) || !evalLaunchedWhen(e.subflowWhen, flags);
    let passedBuiltin = false;
    for (const entry of ordered) {
      if (frontierIdx !== -1 && entry.index > frontierIdx) break; // 前沿之后：未到达
      const { node } = entry;
      if (node.overlay_op === 'add') {
        // 锚点继承（Review）：按原始 before/after 锚点判定——若锚定的 builtin 因 when 为假被跳过
        // （如无 [delta] 时 write-delta），该 add 节点一并 skipped；否则会卡在本应跳过的区域、阻塞进入 coding。
        const anchorSkipped = isAnchorSkipped(node.id, anchorMap, ordered, launchedBuiltinSkipped);
        // subflow.when / node.when / 锚点 builtin when 为假 → skipped（不阻塞）
        const skipped = anchorSkipped || !evalLaunchedWhen(entry.subflowWhen, flags) || !evalLaunchedWhen(node.when, flags);
        let state: OverlayNodeState;
        if (skipped) state = 'skipped';
        else if (node.fail_when && evalPredicate(node.fail_when, node, ctx)) state = 'failed';
        else if (node.done_when && evalPredicate(node.done_when, node, ctx)) state = 'done';
        else state = 'active';
        reachedAdded.push({
          id: node.id, name: node.name, state,
          subflow_id: entry.subflowId, node_index: entry.index, overlay_op: 'add',
        });
        if (state === 'active' || state === 'failed') { current = { ...entry, state }; break; }
      } else {
        if (entry.index === frontierIdx) { current = { ...entry, state: 'active' }; break; } // builtin 前沿即当前
        passedBuiltin = true; // 前沿之前的 builtin = 已完成/已跳过
      }
    }
    if (current && current.node.overlay_op === 'add') {
      // 当前落在 overlay-added 节点：无前序 builtin → writing；否则用权威 step（detectProposalStepViaFlow）
      proposalStepOverride = passedBuiltin ? step : 'writing';
    }
  } else {
    // initial：逐节点求值 when/done_when（module 级上下文足够，无 delta_required/提案级决策）。
    const initialBuiltinSkipped = (e: { node: FlowNode; subflowWhen: string | null }) =>
      e.node.skipped === true || !evalNodeWhen(e.node.when, mod);
    for (const entry of ordered) {
      const { node } = entry;
      // 锚点继承：add 锚定到 when 跳过的 builtin（如 api 关闭时的 api-design）→ 一并 skipped
      const anchorSkipped = node.overlay_op === 'add' && isAnchorSkipped(node.id, anchorMap, ordered, initialBuiltinSkipped);
      let state: OverlayNodeState;
      if (anchorSkipped || node.skipped === true || !evalNodeWhen(node.when, mod)) state = 'skipped';
      else if (node.fail_when && evalPredicate(node.fail_when, node, ctx)) state = 'failed';
      else if (node.done_when && evalPredicate(node.done_when, node, ctx)) state = 'done';
      else state = 'active';

      if (node.overlay_op === 'add') {
        reachedAdded.push({
          id: node.id, name: node.name, state,
          subflow_id: entry.subflowId, node_index: entry.index, overlay_op: 'add',
        });
      }
      if (state === 'active' || state === 'failed') { current = { ...entry, state }; break; }
    }
  }

  // current_node 仅当当前节点为 overlay-added 时输出
  let currentNode: CurrentNode | null = null;
  if (current && current.node.overlay_op === 'add') {
    currentNode = {
      id: current.node.id, name: current.node.name, state: current.state,
      subflow_id: current.subflowId, node_index: current.index,
      phase_key: null, overlay_op: 'add',
    };
  }

  return { overlay_nodes: reachedAdded, current_node: currentNode, proposal_step_override: proposalStepOverride };
}

/** 标记一个 id 是否为 builtin（用于消费端判断）。 */
export function isBuiltinNodeId(id: string): boolean {
  return id in NODE_TO_PHASE_KEY;
}
