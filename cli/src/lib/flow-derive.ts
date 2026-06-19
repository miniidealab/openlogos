/**
 * flow-derive — M1 切片 B1：initial 模块的 phase 派生引擎。
 *
 * 把硬编码的 PHASE_KEYS / PHASE_SUBPATHS / SCENARIO_PHASES / SKIP_PHASE_MAP 改为从 **builtin**
 * initial flow（spec/flow/initial.yaml）派生，再经 code 侧 node-id→phase-key 映射产出与现状
 * 逐字节一致的 phase_progress / 顶层 phases[] / current_phase。
 *
 * 规则（见 docs/orchestratable-flow-design.md、spec/flow-spec.md §12，与 status.ts 原逻辑 1:1）：
 * - 只用 builtin flow，**不应用项目 overlay**（overlay 驱动留后续切片）。
 * - 两套 legacy done 语义由消费端决定：顶层 phases[] = any-present、per-module = all-present（场景覆盖）。
 * - 场景文件保留 legacy `includes()` 子串匹配（非 glob）。
 * - launched 的 detectProposalStep 不在本引擎范围。
 */
import { join } from 'node:path';
import { isAdoptedBootstrap } from './project-yaml.js';
import { loadBuiltinFlow } from './flow.js';
import { listFiles } from './list-files.js';
import type { ModuleInfo, PhaseProgressItem } from '../commands/status.js';

/** node id → 原 PHASE_KEYS（13 个 1:1）。维护在 code 侧以保持 spec/flow/*.yaml 纯净。 */
export const NODE_TO_PHASE_KEY: Record<string, string> = {
  'prd': 'phase.1',
  'product-design': 'phase.2',
  'architecture': 'phase.3-0',
  'scenario-modeling': 'phase.3-1',
  'api-design': 'phase.3-2-api',
  'db-design': 'phase.3-2-db',
  'deployment-design': 'phase.3-3-deployment',
  'test-cases': 'phase.3-4a',
  'orchestration-test': 'phase.3-4b',
  'code': 'phase.3-5',
  'verify': 'phase.3-6',
  'deploy': 'phase.3-7-deploy',
  'smoke': 'phase.3-8-smoke',
};

const BOOTSTRAP_WHEN = 'bootstrap != adopted';

export interface FlowPhasePlanItem {
  phaseKey: string;
  subpath: string;        // node.produces，已去除末尾斜杠（== 原 PHASE_SUBPATHS[i]）
  isScenario: boolean;    // node.for_each 存在
  whenExpr: string | null;
  nodeId: string;
}

/** 从 builtin initial flow 构建有序 phase plan（顺序 == 原 PHASE_KEYS）。 */
export function buildInitialPhasePlan(): FlowPhasePlanItem[] {
  const flow = loadBuiltinFlow('initial');
  const items: FlowPhasePlanItem[] = [];
  for (const sub of flow.subflows) {
    for (const node of sub.nodes) {
      const phaseKey = NODE_TO_PHASE_KEY[node.id];
      if (!phaseKey) continue;
      const produces = node.produces ?? '';
      // fan-out 节点的 produces 是文件模式（含 {scenario}），扫描路径取其目录；
      // 其余为目录（去末尾斜杠）或报告文件路径（原样，listFiles 支持文件）。
      const subpath = node.for_each
        ? produces.slice(0, produces.lastIndexOf('/'))
        : produces.replace(/\/+$/, '');
      items.push({
        phaseKey,
        subpath,
        isScenario: Boolean(node.for_each),
        whenExpr: node.when ?? null,
        nodeId: node.id,
      });
    }
  }
  return items;
}

interface WhenContext {
  api_enabled: boolean;
  db_enabled: boolean;
  scenario_enabled: boolean;
  deployment_required: boolean;
  smoke_required: boolean;
}

function whenContext(mod: ModuleInfo): WhenContext {
  const skip = mod.skip_phases ?? [];
  const deployment_required = mod.deployment_required !== false && !skip.includes('deployment');
  return {
    api_enabled: !skip.includes('api'),
    db_enabled: !skip.includes('database'),
    scenario_enabled: !skip.includes('scenario'),
    deployment_required,
    smoke_required: deployment_required && mod.smoke_required !== false,
  };
}

/**
 * 求值 node.when。支持最小表达式集：`flag` / `not flag` / `bootstrap != adopted`。
 * 返回 true = 节点参与流程；false = 该节点被跳过。
 */
function evalWhen(expr: string, mod: ModuleInfo, ctx: WhenContext): boolean {
  const e = expr.trim();
  if (e === BOOTSTRAP_WHEN) return !isAdoptedBootstrap(mod.bootstrap);
  if (e.startsWith('not ')) {
    const flag = e.slice(4).trim() as keyof WhenContext;
    return !ctx[flag];
  }
  return Boolean(ctx[e as keyof WhenContext]);
}

/**
 * 复现 deriveExplicitSkipPhaseKeys：返回因显式 `when`（非 bootstrap）为假而跳过的 phase key 集合。
 * 用于多模块全局 skip 交集。
 */
export function flowExplicitSkipPhaseKeys(
  mod: ModuleInfo,
  plan: FlowPhasePlanItem[] = buildInitialPhasePlan(),
): Set<string> {
  const ctx = whenContext(mod);
  const skip = new Set<string>();
  for (const item of plan) {
    if (!item.whenExpr || item.whenExpr === BOOTSTRAP_WHEN) continue;
    if (!evalWhen(item.whenExpr, mod, ctx)) skip.add(item.phaseKey);
  }
  return skip;
}

/**
 * 复现 deriveModulePhaseProgress：per-module 派生（场景阶段 all-present 覆盖度）。
 * 与 status.ts 原算法 1:1（仅数据来源改为 builtin flow plan）。
 */
export function deriveModulePhaseProgressViaFlow(
  root: string,
  mod: ModuleInfo,
  scenarios: Array<{ id: string }>,
  isMultiModule: boolean = false,
  plan: FlowPhasePlanItem[] = buildInitialPhasePlan(),
): { progress: Record<string, PhaseProgressItem>; currentPhase: string | null } {
  const progress: Record<string, PhaseProgressItem> = {};
  const ctx = whenContext(mod);

  for (const item of plan) {
    const key = item.phaseKey;
    const dir = join(root, item.subpath);

    // bootstrap-adopted：phase.1/2/3-0 的 when 为 `bootstrap != adopted`，adopted 时跳过并标 reason
    if (item.whenExpr === BOOTSTRAP_WHEN && isAdoptedBootstrap(mod.bootstrap)) {
      progress[key] = { done: false, skipped: true, skip_reason: 'bootstrap-adopted' };
      continue;
    }

    // 其余显式 when 为假 → 跳过（== deriveExplicitSkipPhaseKeys）
    if (item.whenExpr && item.whenExpr !== BOOTSTRAP_WHEN && !evalWhen(item.whenExpr, mod, ctx)) {
      progress[key] = { done: false, skipped: true };
      continue;
    }

    if (item.isScenario) {
      // 场景阶段：per-module 全覆盖才 done（legacy includes 子串匹配）
      const suffix = key === 'phase.3-1' ? '' : '-test-cases';
      const covered: string[] = [];
      const missing: string[] = [];
      for (const s of scenarios) {
        const pattern = `${mod.id}-${s.id}`;
        const files = listFiles(dir);
        const found = files.some(f => f.includes(pattern) && (suffix === '' || f.includes(suffix)));
        if (found) covered.push(s.id);
        else missing.push(s.id);
      }
      progress[key] = {
        done: missing.length === 0 && scenarios.length > 0,
        skipped: false,
        scenario_coverage: { total: scenarios.length, covered: covered.length, missing },
      };
    } else {
      // 非场景阶段：多模块按 {module}- 前缀过滤，单模块任意文件
      const allFiles = listFiles(dir);
      const files = isMultiModule
        ? allFiles.filter(f => (f.split('/').pop() ?? f).startsWith(`${mod.id}-`))
        : allFiles;
      progress[key] = { done: files.length > 0, skipped: false };
    }
  }

  // fallback-skip：已完成 phase 之前的空 phase 标 skipped（NON_FALLBACK 除外）
  const keys = plan.map(p => p.phaseKey);
  const lastDoneIdx = keys.reduce((acc, k, i) => (progress[k].done ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!progress[keys[i]].done && !NON_FALLBACK_SKIP_PHASE_KEYS.has(keys[i])) progress[keys[i]].skipped = true;
  }

  const currentPhase = keys.find(k => !progress[k].done && !progress[k].skipped) ?? null;
  return { progress, currentPhase };
}

/** 与 status.ts NON_FALLBACK_SKIP_PHASES 对齐（免于 fallback-skip 的 phase）。 */
export const NON_FALLBACK_SKIP_PHASE_KEYS = new Set([
  'phase.3-3-deployment',
  'phase.3-7-deploy',
  'phase.3-8-smoke',
]);
