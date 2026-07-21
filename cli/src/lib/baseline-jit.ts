/**
 * brownfield-adopter 切片3：JIT 深化的判定 helper。
 *
 * 支撑 change-writer 在 `bootstrap: adopted` 下对「触碰只有 verified:false 逆向 spec 的区域」给 advisory
 * （不设硬门）；建议在**当前 change 的单份最终态 delta**内一并确认现状（`## 逆向基线来源` 候选置 verified:true）。
 *
 * 关键不变量：**只读已合并主文档**（`logos/resources/`），不看未合并 delta —— advisory 不因未合并 delta 前移/消失；
 * 覆盖率同理（见 baseline-provenance.scanModuleCandidates，只扫 resources）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseProvenanceSection, scanModuleCandidates } from './baseline-provenance.js';
import type { BaselineSeedState } from './baseline-provenance.js';
import { withRecoveredReadLocks, listProjectModuleIds, withBaselineReadLock, listRunIds, readRunRecord } from './baseline-seed-txn.js';

/** `effectiveBaselineSeedState` 的返回：有效状态 + 是否为 legacy 派生值（yaml 未落盘）。 */
export interface EffectiveBaselineSeedState {
  state: BaselineSeedState;
  /** true = 派生值（yaml 缺省，尚未经 sync 迁移落盘），供 legacy 迁移提示与 sync 迁移使用。 */
  legacy: boolean;
  /** true = 派生时模块锁被占用（提交进行中），state 为保守兜底 `partial`（不据半提交集合扫描）。 */
  commit_in_progress?: boolean;
}

/**
 * baseline-seed-legacy-default-unify：`baseline_seed_state` 缺省语义的**唯一事实源**（架构 core-06 §4.1）。
 * `next` / `status` / `baseline-seed` 状态机三入口只准经本 helper 取有效状态，禁止本地 `?? 'required'` 一类私有缺省规则。
 *
 * 派生规则：explicit 显式值优先（含 project-yaml/readSeedState 已把旧布尔归一为 required）；缺省（legacy）时——
 *   有候选 ∧ 有 open run → `partial`（与状态机「扫描中断」语义对齐）；
 *   有候选 ∧ 无 open run → `seeded`（候选在场 = 基线事实上建立过）；
 *   无候选 → `required`（advisory 引导，不设硬门）。
 * **无 `unknown` 第三态**。
 *
 * 锁纪律（继承 F7 恢复门）：派生读权威文档与 run 记录，必须在模块读锁区间内——缺省派生时本函数自取读锁；
 * 调用方已持锁（如 status 的 withBaselineReadLock 区间、baseline-seed 的写锁区间）则传 `assumeLocked: true` 复用。
 * 锁被占用（提交进行中）→ 不做锁外扫描，返回保守兜底 `partial` + `commit_in_progress: true`（契约恒输出仍成立）。
 */
export function effectiveBaselineSeedState(
  root: string,
  moduleId: string,
  explicit?: BaselineSeedState | null,
  opts?: { assumeLocked?: boolean },
): EffectiveBaselineSeedState {
  if (explicit) return { state: explicit, legacy: false };
  const derive = (): BaselineSeedState => {
    const hasCandidates = scanModuleCandidates(root, moduleId).candidates.length > 0;
    if (!hasCandidates) return 'required';
    const hasOpenRun = listRunIds(root)
      .map(id => readRunRecord(root, id))
      .some(r => r !== null && r.module === moduleId && r.status === 'open');
    return hasOpenRun ? 'partial' : 'seeded';
  };
  if (opts?.assumeLocked) return { state: derive(), legacy: true };
  const res = withBaselineReadLock(root, moduleId, new Date().toISOString(), derive);
  if (!res.ok) return { state: 'partial', legacy: true, commit_in_progress: true };
  return { state: res.value, legacy: true };
}

export interface JitRegion {
  /** 已合并主文档路径（项目根相对）。 */
  target_path: string;
  /** 该区域内未验证（verified:false）的候选 key。 */
  unverified_keys: string[];
}

export interface JitAdvisory {
  advise: boolean;
  regions: JitRegion[];
  message: string;
}

/** 把 change 的 delta 相对路径映射到目标主文档：`deltas/<rel>` → `logos/resources/<rel>`。 */
export function deltaToTarget(deltaRel: string): string {
  return `logos/resources/${deltaRel.replace(/\\/g, '/')}`;
}

/** 列出 change 的 delta 文件（相对 `deltas/` 的路径）。 */
export function listDeltaRelPaths(root: string, slug: string): string[] {
  const base = join(root, 'logos', 'changes', slug, 'deltas');
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true })
    .map(f => String(f).replace(/\\/g, '/'))
    .filter(f => f.endsWith('.md'))
    .filter(f => {
      try { return statSync(join(base, f)).isFile(); } catch { return false; }
    });
}

/**
 * 检测活跃 change 的目标区域中是否存在「只有 verified:false 逆向 spec」的未验证逆向区域。
 * 只读已合并主文档：某目标主文档的 `## 逆向基线来源` 章节存在候选、且其 active/tombstone 候选**全部** verified:false ⇒ 未验证逆向区域。
 * 任一候选 verified:true（human-verified）或无该章节 ⇒ 不算「只有未验证逆向 spec」。
 */
export function detectBaselineJitAdvisory(root: string, slug: string): JitAdvisory {
  // F7：把「取锁—检查/恢复—读取已合并主文档」并入**同一读锁区间**——旧实现先 recoverPendingForRead 恢复后即释放锁，
  // 真实文档扫描发生在锁外，writer 可在门检查完成与读取之间启动提交，advisory 仍据半提交集合判定。
  // 现按确定顺序取**所有项目模块**读锁、恢复各自未终结 journal，并把全部目标扫描持锁完成；任一模块提交进行中
  // （锁被占用无法恢复）→ 绝不据可能半提交的集合判 advisory，返回非权威结果（不阻断、不误导）。
  const at = new Date().toISOString();
  const res = withRecoveredReadLocks(root, at, listProjectModuleIds(root), () => {
    const regions: JitRegion[] = [];
    const seen = new Set<string>();
    for (const rel of listDeltaRelPaths(root, slug)) {
      const target = deltaToTarget(rel);
      if (seen.has(target)) continue;
      seen.add(target);
      const abs = join(root, target);
      if (!existsSync(abs)) continue;
      const section = parseProvenanceSection(readFileSync(abs, 'utf-8'));
      if (!section) continue;
      const live = section.candidates.filter(c => c.state === 'active' || c.state === 'tombstone');
      if (live.length === 0) continue;
      if (live.every(c => !c.verified)) {
        regions.push({ target_path: target, unverified_keys: live.map(c => c.key) });
      }
    }
    return regions;
  });
  if (!res.ok) {
    return { advise: false, regions: [], message: `baseline_commit_in_progress: 模块 ${res.inProgress.join(',')} 提交进行中，暂不据当前集合判 JIT advisory（稍后重试）。` };
  }
  const regions = res.value;
  const advise = regions.length > 0;
  return {
    advise,
    regions,
    message: advise
      ? '检测到本次 change 触碰只有未验证逆向 spec 的区域。建议（不设硬门）：在当前 change 的单份最终态 delta 内，把对应 `## 逆向基线来源` 候选置 verified:true 并记 confirmed_by/evidence/confirmed_at，与前向改动一并落盘；不生成第二份「现状确认 delta」、不直接改 resources/**、不嵌套第二个 change。用户可跳过。'
      : '',
  };
}

/**
 * 判定一份 delta 是否在其 `## 逆向基线来源` 章节内确认现状（verified:true）——
 * 用于校验「单份最终态 delta 承载『确认现状 + 前向改动』」（无需第二份「现状确认 delta」）。
 */
export function deltaConfirmsCurrentState(deltaContent: string): { confirms: boolean; verifiedKeys: string[] } {
  const section = parseProvenanceSection(deltaContent);
  if (!section) return { confirms: false, verifiedKeys: [] };
  const verified = section.candidates.filter(c => c.verified);
  return { confirms: verified.length > 0, verifiedKeys: verified.map(c => c.key) };
}
