/**
 * flow-loop-derive — M2 切片 2：implement(code/verify) loop 真迭代派生。
 *
 * A 被动派生：OpenLogos 不自驱动跑测试，只读 `LOOP_ITERS` 账本 + resolved flow 派生
 * `loop_state{iteration/converged/escalated}`。仅当 resolved 有激活的 loop（max_iters>1）
 * 且非「initial 多模块」时产出；否则 null（builtin/未激活项目逐字节不变 → golden 零漂移）。
 * 见 spec/flow-spec.md §6/§12.2、spec/cli-json-output.md §3.9/§13。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadFlow, findActivatedLoop, type Flow } from './flow.js';
import type { ModuleInfo } from '../commands/status.js';

export interface LoopState {
  subflow_id: string;
  until: string;
  max_iters: number;
  iteration: number;
  converged: boolean;
  escalated: boolean;
  // S29：仅当 overlay set-loop 显式写了 exhausted_gate 时才出现；未写则省略（消费方按 false 处理）→ 保 S27 激活-loop 零漂移
  exhausted_skippable?: boolean;
}

export interface LoopIterRow {
  iter?: number;
  node?: string;
  result?: 'pass' | 'fail';
  module?: string;
  timestamp?: string;
  slice?: string; // change-flow-redesign：切片循环（until=code_slices_green）激活时记录本轮尝试的切片
}

/** 账本路径：launched = 提案目录、initial = logos/resources/verify/。 */
export function loopLedgerPath(root: string, proposalDir: string | null): string {
  return proposalDir
    ? join(proposalDir, 'LOOP_ITERS')
    : join(root, 'logos', 'resources', 'verify', 'LOOP_ITERS');
}

/** 读账本并按 module 过滤（顺序保留；坏行跳过）。 */
export function readLoopIters(path: string, moduleId: string): LoopIterRow[] {
  if (!existsSync(path)) return [];
  const rows: LoopIterRow[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const r = JSON.parse(s) as LoopIterRow;
      if ((r.module ?? 'core') === moduleId) rows.push(r);
    } catch { /* 坏行跳过 */ }
  }
  return rows;
}

/**
 * 派生 loop_state。无激活 loop / initial 多模块 → null（不新增字段，golden 零漂移）。
 * @param flow 可传入已 resolved 的 flow 复用；缺省自行 loadFlow(resolved)。
 */
export function deriveLoopState(
  root: string,
  mod: ModuleInfo,
  proposalDir: string | null,
  isMultiModule: boolean = false,
  flow?: Flow,
): LoopState | null {
  const resolved = flow ?? loadFlow(root, { lifecycle: mod.lifecycle, resolved: true }).flow;
  const act = findActivatedLoop(resolved);
  if (!act) return null;
  // R7：initial 多模块无法把项目级单次 verify 归属到某模块 → 不激活
  if (mod.lifecycle === 'initial' && isMultiModule) return null;
  // launched 无活跃提案 → 无提案目录账本，绝不 fallback 读 initial 账本（“launch 后不读 initial 账本”）
  if (mod.lifecycle === 'launched' && !proposalDir) return null;

  const rows = readLoopIters(loopLedgerPath(root, proposalDir), mod.id);
  const iteration = rows.length;
  const testsGreen = iteration > 0 && rows[rows.length - 1].result === 'pass';
  // change-flow-redesign 切片4：until==code_slices_green 时收敛 = section_complete:code ∧ tests_green。
  // 空 [code]（无 section 或 total==0）→ 退化为纯 tests_green（converged 仅看末行 pass），绝不死锁。
  // until==tests_green 行为完全不变。
  let converged = testsGreen;
  if (act.until === 'code_slices_green' && proposalDir) {
    const code = readCodeSection(proposalDir);
    const hasCodeSlices = code.total > 0;
    converged = hasCodeSlices
      ? testsGreen && code.done === code.total // 复合收敛：父切片及子任务全勾 ∧ 测试绿
      : testsGreen;                                // 空 [code] → 退化为 tests_green
  }
  const escalated = iteration >= act.max_iters && !converged;
  const state: LoopState = { subflow_id: act.subflow_id, until: act.until, max_iters: act.max_iters, iteration, converged, escalated };
  // S29：仅当 resolved loop 显式带 exhausted_gate（来自 overlay set-loop）时才输出 exhausted_skippable；
  // 未写则省略该键 → 既有 S27 激活-loop 的 loop_state JSON 不新增字段（真零漂移）。
  const eg = resolved.subflows.find(s => s.id === act.subflow_id)?.loop?.exhausted_gate;
  if (eg != null) state.exhausted_skippable = eg.skippable ?? false;
  return state;
}

/**
 * 读提案 tasks.md 的 [code] section，判 section_complete（legacy 语义）：
 * 无 [code] section 或 total==0 → 视为完成（退化路径，由调用方决定如何退化）；
 * total>0 时 done===total 才完成。done 采用 S31 父切片完成规则：
 * 父切片 checkbox 已勾选，且其下所有缩进子任务 checkbox 均已勾选。
 */
function readCodeSection(proposalDir: string): { total: number; done: number } {
  const tasksPath = join(proposalDir, 'tasks.md');
  if (!existsSync(tasksPath)) return { total: 0, done: 0 };
  const state = deriveSliceState(proposalDir, readFileSync(tasksPath, 'utf-8'));
  return { total: state.total, done: state.done };
}

/** 代码切片循环状态（spec/cli-json-output.md §3.10(2)）。仅切片循环激活时由调用方输出。 */
export interface SliceChild {
  text: string;
  checked: boolean;
}

export interface SliceState {
  total: number;
  done: number;
  current?: string;
  current_children?: SliceChild[];
  current_unchecked_children?: string[];
  remaining: number;
}

interface CodeSlice {
  text: string;
  checked: boolean;
  children: SliceChild[];
}

function extractCodeSlices(content: string): CodeSlice[] {
  const slices: CodeSlice[] = [];
  const lines = content.split(/\r?\n/);
  const sectionPattern = /^## \[([a-z][a-z0-9-]*)\]/i;
  let inCode = false;
  let current: CodeSlice | null = null;

  for (const line of lines) {
    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch) {
      inCode = sectionMatch[1].toLowerCase() === 'code';
      current = null;
      continue;
    }
    if (!inCode) continue;

    const parentMatch = line.match(/^- \[([ x])\]\s+(.+)$/i);
    if (parentMatch) {
      current = {
        checked: parentMatch[1].toLowerCase() === 'x',
        text: parentMatch[2].trim(),
        children: [],
      };
      slices.push(current);
      continue;
    }

    const childMatch = line.match(/^\s+- \[([ x])\]\s+(.+)$/i);
    if (childMatch && current) {
      current.children.push({
        checked: childMatch[1].toLowerCase() === 'x',
        text: childMatch[2].trim(),
      });
    }
  }

  return slices;
}

function isSliceDone(slice: CodeSlice): boolean {
  return slice.checked && slice.children.every(child => child.checked);
}

/**
 * 派生切片状态：读提案 tasks.md 的 [code] section。
 * - total = 顶层父切片数（缩进 checkbox 不计入）
 * - done  = 已完成父切片数（父切片勾选且其下缩进 checkbox 全勾）
 * - current = 第一个未完成父切片标题文本（全完成时省略）
 * - remaining = total - done
 * 仅在切片循环激活（until=code_slices_green）时由调用方调用并挂载。
 */
export function deriveSliceState(proposalDir: string, tasksContent?: string): SliceState {
  let content = tasksContent;
  if (content === undefined) {
    const tasksPath = join(proposalDir, 'tasks.md');
    content = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf-8') : '';
  }
  const slices = extractCodeSlices(content);
  const total = slices.length;
  const done = slices.filter(isSliceDone).length;
  const currentSlice = slices.find(slice => !isSliceDone(slice));
  const currentUncheckedChildren = currentSlice?.children.filter(child => !child.checked).map(child => child.text);
  return {
    total,
    done,
    remaining: total - done,
    ...(currentSlice != null ? { current: currentSlice.text } : {}),
    ...(currentSlice && currentSlice.children.length > 0 ? { current_children: currentSlice.children } : {}),
    ...(currentUncheckedChildren && currentUncheckedChildren.length > 0 ? { current_unchecked_children: currentUncheckedChildren } : {}),
  };
}

/**
 * 切片循环激活时派生 slice_state，否则 null（与 deriveLoopState 同构的激活/归属门禁，保 golden）。
 * 激活条件：resolved 有激活 loop（max_iters>1）且 `until==='code_slices_green'`，
 * 且非「initial 多模块」、launched 必须有活跃提案目录。
 */
export function deriveSliceStateIfActive(
  root: string,
  mod: ModuleInfo,
  proposalDir: string | null,
  isMultiModule: boolean = false,
  flow?: Flow,
): SliceState | null {
  const resolved = flow ?? loadFlow(root, { lifecycle: mod.lifecycle, resolved: true }).flow;
  const act = findActivatedLoop(resolved);
  if (!act || act.until !== 'code_slices_green') return null;
  // 与 deriveLoopState 同构的归属门禁
  if (mod.lifecycle === 'initial' && isMultiModule) return null;
  if (mod.lifecycle === 'launched' && !proposalDir) return null;
  // 切片状态读提案目录 tasks.md 的 [code]；initial（无提案目录）→ 读项目级无意义，省略
  if (!proposalDir) return null;
  return deriveSliceState(proposalDir);
}

/** loop 退出 gate id（达上限 human gate）。 */
export function loopExhaustedGateId(subflowId: string): string {
  return `gate:${subflowId}:loop-exhausted`;
}

/**
 * loop 是否进入「阻塞 / 续迭代」语义：已激活、未收敛、**至少跑过一轮**（iteration≥1）、
 * 且**前沿已到 verify**。否则（iteration=0 / 前沿在 implement 之前）保持正常流程，
 * 不得抢占 ready-to-merge 等前序停顿点（仅约束 implement/verify 出环）。
 */
export function isLoopBlocking(loopState: LoopState | null | undefined, atVerifyFrontier: boolean): boolean {
  return Boolean(loopState && !loopState.converged && loopState.iteration >= 1 && atVerifyFrontier);
}
