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
import { loadFlow, readOverlay, FlowError, fanoutDone, readProjectCmdTimeout, type Flow, type FlowNode, type Lifecycle } from './flow.js';
import { listFiles } from './list-files.js';
import {
  parseTaskSections,
  isProposalTemplateFilled,
  isTasksTemplateFilled,
  resolveProposalDeploymentDecision,
} from './proposal-lifecycle.js';
import { NODE_TO_PHASE_KEY, PHASE_KEY_TO_NODE_ID, evalNodeWhen, detectProposalStepViaFlow } from './flow-derive.js';
import type { ModuleInfo } from '../commands/status.js';
import type { ProposalStep } from './proposal-lifecycle.js';

export type OverlayNodeState = 'done' | 'active' | 'skipped' | 'failed' | 'pending';

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

/** 当前 pending cmd 节点的求值信息，供 next 执行命令（status/watch 不用）。 */
export interface PendingCmd {
  node_id: string;
  command: string;            // cmd: 之后的命令串（已 trim）
  predicate_field: 'done_when' | 'fail_when';
  timeout_seconds: number;    // 解析后的两级超时
}

export interface OverlayView {
  overlay_nodes: OverlayNode[];
  current_node: CurrentNode | null;
  /** launched：当前节点落在 overlay-added 节点时的 proposal_step 回退值（前序最近 builtin step / writing）。 */
  proposal_step_override: string | null;
  /** 当前节点是未求值的 cmd 节点时填充（仅 next 执行用）；否则 null。 */
  pending_cmd: PendingCmd | null;
}

/** next 执行 cmd 后回传的求值结果，让派生把该节点当 done/failed/active 续推（budget=1）。 */
export interface CmdEval {
  node_id: string;
  satisfied: boolean; // 命令 exit 0
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
export const STEP_TO_CURRENT_BUILTIN: Record<string, string> = {
  'writing': 'write-proposal',
  'ready-to-delta': 'write-delta',
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
    // S29：honor coverage_threshold（缺省=全覆盖）；复用共享 fanoutDone（与 initial phase 派生一致）
    const total = ctx.scenarios.length;
    const covered = ctx.scenarios.filter(s => files.some(f => f.includes(`${ctx.mod.id}-${s.id}`))).length;
    return fanoutDone(covered, total, node.coverage_threshold);
  }
  // 未知谓词：保守视为未命中
  return false;
}

/** 谓词白名单（spec §9 词表 + M2-1b 的 cmd:）。未知谓词不在内。 */
function isKnownPredicate(p: string): boolean {
  return p === 'dir_nonempty' || p.startsWith('file:') || p.startsWith('marker:')
    || p.startsWith('any_present:') || p.startsWith('section_complete:')
    || p === 'proposal_package_filled' || p === 'archived' || p === 'all_present'
    || p.startsWith('cmd:');
}

/** 单个谓词（done_when / fail_when）的白名单 + lifecycle/produces/cmd 校验。 */
function validateAddedPredicate(node: FlowNode, ctx: DeriveCtx, pred: string, field: string): void {
  // 白名单：未知/拼错谓词一律拒绝（避免静默永久 active）——spec §10.3/§12.1
  if (!isKnownPredicate(pred)) {
    throw new FlowError('FLOW_SCHEMA_INVALID',
      `overlay-add 节点 \`${node.id}\` 的 ${field} \`${pred}\` 非支持的谓词（不接受未知谓词）`);
  }
  // cmd:：空命令非法（spec §9.2）；其余执行约束由 flow-cmd 求值器/超时校验负责
  if (pred.startsWith('cmd:')) {
    if (pred.slice('cmd:'.length).trim() === '') {
      throw new FlowError('FLOW_SCHEMA_INVALID', `overlay-add 节点 \`${node.id}\` 的 ${field} cmd: 命令为空`);
    }
    return;
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
  // 决策 B：禁止同节点 done_when 与 fail_when 均为 cmd:
  if (node.done_when?.startsWith('cmd:') && node.fail_when?.startsWith('cmd:')) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `overlay-add 节点 \`${node.id}\` 不得同节点 done_when 与 fail_when 均为 cmd:`);
  }
}

/** 该节点是否带 cmd: 谓词（done_when 或 fail_when）。 */
function hasCmdPredicate(node: FlowNode): boolean {
  return Boolean(node.done_when?.startsWith('cmd:') || node.fail_when?.startsWith('cmd:'));
}

/** 取节点的 cmd 谓词（fail_when 优先于 done_when，G4）。无则 null。 */
function cmdPredicateOf(node: FlowNode): { field: 'done_when' | 'fail_when'; pred: string } | null {
  if (node.fail_when?.startsWith('cmd:')) return { field: 'fail_when', pred: node.fail_when };
  if (node.done_when?.startsWith('cmd:')) return { field: 'done_when', pred: node.done_when };
  return null;
}

/**
 * 读取项目级 flow.cmd_timeout_seconds。
 * - 未配置（缺字段 / 配置不可读）→ null（落内置 60s）。
 * - 字段存在但非整数 ≥1（0 / 负数 / 非整数）→ FLOW_SCHEMA_INVALID（spec flow-spec.md §9.2）。
 */
// S30：项目级 cmd 超时解析统一移到 flow.ts（readProjectCmdTimeout），此处复用导入。

/**
 * 求 overlay-add 节点的派生态（含 cmd:）。
 * - 观察派生（无 cmdEval）：cmd 节点 → `pending`（不执行）。
 * - 求值派生（next 传 cmdEval）：按命令退出码定 done/failed/active（fail_when 优先，G4）。
 */
function addNodeState(node: FlowNode, skipped: boolean, ctx: DeriveCtx, cmdEval?: CmdEval): OverlayNodeState {
  if (skipped) return 'skipped';
  // 非 cmd 的 fail_when 优先（G4）：命中即 failed，无需执行 cmd
  if (node.fail_when && !node.fail_when.startsWith('cmd:') && evalPredicate(node.fail_when, node, ctx)) return 'failed';
  const cmd = cmdPredicateOf(node);
  if (cmd) {
    if (cmdEval && cmdEval.node_id === node.id) {
      if (cmd.field === 'fail_when') {
        if (cmdEval.satisfied) return 'failed';
        // fail_when:cmd 未命中 → 评（非 cmd 的）done_when
        if (node.done_when && !node.done_when.startsWith('cmd:') && evalPredicate(node.done_when, node, ctx)) return 'done';
        return 'active';
      }
      return cmdEval.satisfied ? 'done' : 'active';
    }
    return 'pending'; // 观察 / 未求值
  }
  if (node.done_when && evalPredicate(node.done_when, node, ctx)) return 'done';
  return 'active';
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
  cmdEval?: CmdEval,
  haltAfterSubflow?: string,
): OverlayView | null {
  const lifecycle = mod.lifecycle;
  const loaded = loadFlow(root, { lifecycle, resolved: true });
  if (!loaded.overlay_applied) return null; // 无 overlay → 不新增字段

  const flow: Flow = loaded.flow;
  const ctx: DeriveCtx = { root, lifecycle, mod, proposalDir, scenarios, isMultiModule };
  const projectCmdTimeout = readProjectCmdTimeout(root);

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
  // 校验：overlay-add 节点谓词组合 + 决策 A（cmd: 仅 overlay-add 节点）
  for (const sub of flow.subflows) {
    for (const node of sub.nodes) {
      if (node.overlay_op === 'add') validateAddedNodePredicate(node, ctx);
      // S30：内置 verify/deploy/smoke gate 的 cmd: 已在 applyOverlay 阶段按 (节点,字段) 白名单校验；
      // 其它内置节点带 cmd: 仍 fail loud（兜底，正常应已在 applyOverlay 拦截）。
      else if (hasCmdPredicate(node) && !['verify', 'deploy', 'smoke'].includes(node.id)) {
        throw new FlowError('FLOW_SCHEMA_INVALID',
          `cmd: 谓词不支持内置节点 \`${node.id}\`（仅 overlay-add 节点或 overlay-modify 的 verify/deploy/smoke gate）`);
      }
    }
  }

  // launched 无活跃提案：只做上面的 flow 配置校验（skip/reorder fail-loud、谓词白名单），
  // **不输出 node 级 overlay 视图**——否则会把 before write-proposal 的 add 误判为 current，
  // 覆盖「openlogos change <slug>」建议，且无 proposalDir 时 marker 类 done_when 永不可达（Review）。
  if (lifecycle === 'launched' && !proposalDir) {
    return { overlay_nodes: [], current_node: null, proposal_step_override: null, pending_cmd: null };
  }

  // 按 resolved 顺序展开节点（带所属 subflow 的 when，供 overlay 节点跳过判定）。
  const ordered: Array<{ node: FlowNode; subflowId: string; subflowWhen: string | null; index: number }> = [];
  let idx = 0;
  for (const sub of flow.subflows) {
    for (const node of sub.nodes) ordered.push({ node, subflowId: sub.id, subflowWhen: sub.when ?? null, index: idx++ });
  }
  // add 节点的原始锚点（before/after + anchor id），用于锚点继承的 skip 判定。
  const anchorMap = buildAnchorMap(root, lifecycle);

  // F3/F2：loop 未收敛时（haltAfterSubflow=激活的 loop subflow），走查不得越过该 subflow 的最后一个
  // **builtin** 节点（implement 的 verify）。注意 after:verify 插入的 add 节点也属 implement，若按整段
  // 最大 index 会漏掉它们；故只取 builtin 节点的最大 index，使 verify 之后的 overlay-added 节点被 halt。
  const haltMaxIdx = haltAfterSubflow
    ? ordered.reduce((mx, e) => (e.subflowId === haltAfterSubflow && e.node.overlay_op !== 'add' ? Math.max(mx, e.index) : mx), -1)
    : -1;

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
      if (haltMaxIdx >= 0 && entry.index > haltMaxIdx) break; // F3：loop 未收敛 → 不越过 implement
      const { node } = entry;
      if (node.overlay_op === 'add') {
        // 锚点继承（Review）：按原始 before/after 锚点判定——若锚定的 builtin 因 when 为假被跳过
        // （如无 [delta] 时 write-delta），该 add 节点一并 skipped；否则会卡在本应跳过的区域、阻塞进入 coding。
        const anchorSkipped = isAnchorSkipped(node.id, anchorMap, ordered, launchedBuiltinSkipped);
        // subflow.when / node.when / 锚点 builtin when 为假 → skipped（不阻塞）
        const skipped = anchorSkipped || !evalLaunchedWhen(entry.subflowWhen, flags) || !evalLaunchedWhen(node.when, flags);
        const state = addNodeState(node, skipped, ctx, cmdEval);
        reachedAdded.push({
          id: node.id, name: node.name, state,
          subflow_id: entry.subflowId, node_index: entry.index, overlay_op: 'add',
        });
        if (state === 'active' || state === 'failed' || state === 'pending') { current = { ...entry, state }; break; }
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
      if (haltMaxIdx >= 0 && entry.index > haltMaxIdx) break; // F3：loop 未收敛 → 不越过 implement
      const { node } = entry;
      // 锚点继承：add 锚定到 when 跳过的 builtin（如 api 关闭时的 api-design）→ 一并 skipped
      const anchorSkipped = node.overlay_op === 'add' && isAnchorSkipped(node.id, anchorMap, ordered, initialBuiltinSkipped);
      const skipped = anchorSkipped || node.skipped === true || !evalNodeWhen(node.when, mod);
      let state: OverlayNodeState;
      if (node.overlay_op === 'add') {
        // add 节点（可能带 cmd:）→ addNodeState（观察 = pending；求值 = 按退出码）
        state = addNodeState(node, skipped, ctx, cmdEval);
        reachedAdded.push({
          id: node.id, name: node.name, state,
          subflow_id: entry.subflowId, node_index: entry.index, overlay_op: 'add',
        });
      } else {
        // builtin 节点（决策 A：无 cmd:）
        if (skipped) state = 'skipped';
        else if (node.fail_when && evalPredicate(node.fail_when, node, ctx)) state = 'failed';
        else if (node.done_when && evalPredicate(node.done_when, node, ctx)) state = 'done';
        else state = 'active';
      }
      if (state === 'active' || state === 'failed' || state === 'pending') { current = { ...entry, state }; break; }
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

  // pending_cmd：当前节点是「待执行的 cmd 节点」时，给消费端（next）执行所需载荷。
  // 仅观察派生（state==='pending'）输出；求值派生后 cmd 节点已转 done/failed/active，不再 pending。
  let pendingCmd: PendingCmd | null = null;
  if (current && current.state === 'pending') {
    const cmd = cmdPredicateOf(current.node);
    if (cmd) {
      pendingCmd = {
        node_id: current.node.id,
        command: cmd.pred.slice('cmd:'.length).trim(),
        predicate_field: cmd.field,
        timeout_seconds: current.node.cmd_timeout_seconds ?? projectCmdTimeout ?? 60,
      };
    }
  }

  return { overlay_nodes: reachedAdded, current_node: currentNode, proposal_step_override: proposalStepOverride, pending_cmd: pendingCmd };
}

/** 标记一个 id 是否为 builtin（用于消费端判断）。 */
export function isBuiltinNodeId(id: string): boolean {
  return id in NODE_TO_PHASE_KEY;
}

/** S28：next 透出的编排提示（取自 resolved flow 的最终建议处理节点）。 */
export interface NextNode {
  id: string;
  name: string;
  subflow_id: string;
  skill: string | null;
  working_agent: string | null;
  review_agent: string | null;
  pre_script: string | null;
  post_script: string | null;
  // change-flow-redesign 切片6：切片循环阻塞在 code 工作节点时的「只做这一片」子提示（= slice_state.current）。
  slice?: string;
}

/**
 * S28：解析「本次 next 响应最终建议处理的真实 flow node」的 hints（next_node）。
 * 默认 = 当前前沿节点（overlay current_node > launched step→builtin > initial phase→builtin）；
 * 例外：R4 auto 放行 / R7 loop 阻塞·达上限 / R5 命令级建议（无对应节点）→ 返回 null（省略）。
 * R3（cmd 续推）由调用方传入**已 cmdEval 回灌后**的 current/step/phase 自动满足（cmd done→续推后节点；失败→cmd 节点）。
 */
export function resolveNextNode(
  root: string,
  mod: ModuleInfo,
  opts: {
    currentNode?: { id: string } | null;
    proposalStep?: string | null;
    currentPhase?: string | null;
    loopBlocking?: boolean;   // isLoopBlocking 结果（前沿到 verify + iteration≥1 + 未收敛）
    loopEscalated?: boolean;
    gateAutoPassed?: boolean;
  },
): NextNode | null {
  if (opts.gateAutoPassed) return null;                       // R4：gate 自动放行 → 省略
  let targetId: string | undefined;
  if (opts.loopBlocking) {
    if (opts.loopEscalated) return null;                      // R7：达上限 → 省略（宿主读 loop_state）
    targetId = opts.currentNode?.id ?? 'code';                // R7：工作节点（overlay current_node 优先，否则 code）
  } else if (opts.currentNode) {
    targetId = opts.currentNode.id;                           // overlay-added 当前节点（含 cmd 节点）
  } else if (mod.lifecycle === 'launched') {
    targetId = opts.proposalStep ? STEP_TO_CURRENT_BUILTIN[opts.proposalStep] : undefined;
  } else {
    targetId = opts.currentPhase ? PHASE_KEY_TO_NODE_ID[opts.currentPhase] : undefined;
  }
  if (!targetId) return null;                                 // R5 / all_done：无对应 flow 节点 → 省略

  const flow = loadFlow(root, { lifecycle: mod.lifecycle, resolved: true }).flow;
  for (const sub of flow.subflows) {
    for (const n of sub.nodes) {
      if (n.id !== targetId) continue;
      if (n.skipped) return null;                             // 被 overlay skip → 省略
      return {
        id: n.id, name: n.name, subflow_id: sub.id,
        skill: n.skill ?? null, working_agent: n.working_agent ?? null, review_agent: n.review_agent ?? null,
        pre_script: n.pre_script ?? null, post_script: n.post_script ?? null,
      };
    }
  }
  return null;                                                // 目标节点缺失（如 code 被删）→ 省略
}
