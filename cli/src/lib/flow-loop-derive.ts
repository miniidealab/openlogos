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
  const converged = iteration > 0 && rows[rows.length - 1].result === 'pass';
  const escalated = iteration >= act.max_iters && !converged;
  const state: LoopState = { subflow_id: act.subflow_id, until: act.until, max_iters: act.max_iters, iteration, converged, escalated };
  // S29：仅当 resolved loop 显式带 exhausted_gate（来自 overlay set-loop）时才输出 exhausted_skippable；
  // 未写则省略该键 → 既有 S27 激活-loop 的 loop_state JSON 不新增字段（真零漂移）。
  const eg = resolved.subflows.find(s => s.id === act.subflow_id)?.loop?.exhausted_gate;
  if (eg != null) state.exhausted_skippable = eg.skippable ?? false;
  return state;
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
