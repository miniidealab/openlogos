/**
 * decision-record-capability（S38）：决策记录 DXX 编号的**闭合分配公式**（纯函数，确定性）
 * 与 merge-executor apply 事务的**受控执行入口**（`applyDecisionRecords`）。
 *
 * delta-r2 F5 修正：**基准只含已落盘记录、绝不纳入本批待落盘 DXX**——否则首条合法记录
 * （资源空、next_id=1、拟号 D01）会被 `max(1, max{D01}+1)=D02` 算成 D02、再因「文件名 D01 ≠ allocated」自拒。
 *
 * 定位：本函数是分配语义的**单一事实源**，供 merge-executor（AI，apply 时取号）与测试共用；
 * 它**不是 CLI 命令自动取号**（无命令在正常流程中调用它落盘）——`decision_counter` 仍由
 * `project-yaml.ts` 只读取侧解析、CLI 不取号（比照 `scenario_counter` / `feature_counter`）。
 *
 * code-r2 F2：`applyDecisionRecords` 是 merge-executor 「决策记录 apply 事务」的**可执行受控入口**，
 * 也是 `allocateDecisionRecordIds` 的**真实生产消费者**——它**自行解析** delta 文件名 / 标题 DXX、
 * **扫描**已落盘 DXX、**读取并保留**现有 YAML、**应用** delta 正文（写主文档）、走**权威 index 路径**
 * 更新索引、**持久化** counter，最后才写 `SPEC_MERGED`；分配失败**写零字节**（不落盘、不消耗号），
 * 重复执行**幂等**（已落盘条目跳过）。它**不是**新增的 `openlogos decision` CLI 命令（提案红线：不新增
 * 该命令），而是 merge-executor apply 步的事务原语——ST-S38-03 只负责准备输入并调用它、断言其产物。
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Locale } from '../i18n.js';
import { readProjectYaml } from './project-yaml.js';
import { syncResourceIndex } from './sync-resource-index.js';

export interface DecisionCandidate {
  /** 文件名中的 DXX 数字（`core-D07-slug.md` → 7）。 */
  filenameDxx: number;
  /** 文档标题中的 DXX 数字（`# D07：...` → 7）。 */
  titleDxx: number;
}

export interface DecisionAllocationResult {
  ok: boolean;
  /** 分配基准（只据已落盘 + configured_next_id 计算，不含本批）。 */
  base: number;
  /** 每条候选的 `expected_i = base + i`（仅 ok 时有意义，与 candidates 同序）。 */
  allocations: number[];
  /** 全部落盘后应持久化的 `decision_counter.next_id`（= base + 候选数）。 */
  persistedNextId: number;
  /** 拒绝原因（!ok 时）：文件名/标题与 expected 不一致，或本批内重复。 */
  error?: string;
}

/**
 * 闭合分配公式：
 * - `base = max(configuredNextId ?? 1, max(landedDxx，空集按 0) + 1)`（**只据已落盘**）。
 * - 候选按传入的稳定顺序，第 i 条（0 基）`expected_i = base + i`。
 * - 校验每条「filenameDxx == titleDxx == expected_i」；本批内 filenameDxx 不得重复。
 * - `persistedNextId = base + candidates.length`。
 *
 * @param landedDxx  已落盘决策记录的 DXX 数字集合（`logos/resources/decisions/` 扫描所得）。
 * @param configuredNextId  `decision_counter.next_id`（缺失传 undefined，回落 1）。
 * @param candidates  本提案待落盘候选，**须已按不依赖待分配 DXX 的稳定序（文件名 slug）排列**。
 */
export function allocateDecisionRecordIds(
  landedDxx: number[],
  configuredNextId: number | undefined,
  candidates: DecisionCandidate[],
): DecisionAllocationResult {
  const maxLanded = landedDxx.length > 0 ? Math.max(...landedDxx) : 0;
  const base = Math.max(configuredNextId ?? 1, maxLanded + 1);
  const allocations = candidates.map((_, i) => base + i);
  const persistedNextId = base + candidates.length;

  const seenFilename = new Set<number>();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const expected = allocations[i];
    if (seenFilename.has(c.filenameDxx)) {
      return { ok: false, base, allocations, persistedNextId, error: `本提案内 DXX 重复：D${c.filenameDxx}` };
    }
    seenFilename.add(c.filenameDxx);
    if (c.filenameDxx !== expected || c.titleDxx !== expected) {
      return {
        ok: false, base, allocations, persistedNextId,
        error: `第 ${i + 1} 条候选文件名 D${c.filenameDxx} / 标题 D${c.titleDxx} 与应分配 D${expected} 不一致（须三者相等；base=${base}）`,
      };
    }
  }
  return { ok: true, base, allocations, persistedNextId };
}

/** 从决策记录文件名（`<module>-D<NN>-<slug>.md` 或 `D<NN>-<slug>.md`）解析 DXX 数字；不匹配 → null。 */
export function parseDecisionFilenameDxx(filename: string): number | null {
  const m = /^(?:[a-z][a-z0-9-]*-)?D(\d+)-.+\.md$/.exec(filename);
  return m ? Number(m[1]) : null;
}

/** 从决策记录文档标题（`# D07：…` / `# D07 …`）解析 DXX 数字；不匹配 → null。 */
export function parseDecisionTitleDxx(body: string): number | null {
  const m = /^#\s+D(\d+)(?=[：:\s]|$)/m.exec(body);
  return m ? Number(m[1]) : null;
}

/** 解析决策记录 delta 的首个段操作类型（`## ADDED` / `## MODIFIED`）；无显式段标记 → null。 */
function parseDeltaOp(deltaContent: string): 'ADDED' | 'MODIFIED' | null {
  for (const line of deltaContent.split(/\r?\n/)) {
    const m = /^##\s+(ADDED|MODIFIED)\b/.exec(line.trim());
    if (m) return m[1] as 'ADDED' | 'MODIFIED';
  }
  return null;
}

/**
 * 抽取决策记录 delta 首个段标记（`## ADDED` / `## MODIFIED`）后的正文——决策记录 delta 单块携带
 * 该记录的**整条全量正文**（新增 = 全新记录；superseded MODIFIED = 携整条剩余全量、仅改状态），
 * 正文即落盘主文档全文。无段标记时退化为整份内容。
 */
function extractDeltaBody(deltaContent: string): string {
  const lines = deltaContent.split(/\r?\n/);
  const idx = lines.findIndex(l => /^##\s+(ADDED|MODIFIED)\b/.test(l.trim()));
  const body = idx < 0 ? lines : lines.slice(idx + 1);
  const out = [...body];
  while (out.length && out[0].trim() === '') out.shift();
  return out.join('\n').replace(/\s+$/, '') + '\n';
}

/**
 * 持久化 `decision_counter.next_id`（保留 YAML 现有内容、原地更新/插入）：
 * 已有 `decision_counter:` 块含 `next_id` → 替换其值；块存在但**缺 `next_id` 字段** → 在块首插入
 * （code-r4 F2：原实现此时静默原样写回，磁盘仍无 `next_id`）；无块 → 在 `resource_index:` / `conventions:`
 * 前插入（或 EOF 追加），使 `resource_index` / `conventions` 恒在其后——不破坏 syncResourceIndex 的追加约定。
 */
function persistDecisionCounter(root: string, nextId: number): void {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  const lines = readFileSync(yamlPath, 'utf-8').split(/\r?\n/);
  const dcIdx = lines.findIndex(l => /^decision_counter:\s*$/.test(l));
  if (dcIdx >= 0) {
    let updated = false;
    for (let i = dcIdx + 1; i < lines.length; i++) {
      if (/^\S/.test(lines[i])) break; // 离开该块
      if (/^\s+next_id:/.test(lines[i])) { lines[i] = lines[i].replace(/next_id:\s*\d+/, `next_id: ${nextId}`); updated = true; break; }
    }
    if (!updated) lines.splice(dcIdx + 1, 0, `  next_id: ${nextId}`); // 块存在但缺字段 → 插入
    writeFileSync(yamlPath, lines.join('\n'));
    return;
  }
  const block = ['decision_counter:', `  next_id: ${nextId}`];
  const insertBefore = lines.findIndex(l => /^resource_index:\s*$/.test(l) || /^conventions:\s*$/.test(l));
  if (insertBefore >= 0) lines.splice(insertBefore, 0, ...block);
  else { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push(...block, ''); }
  writeFileSync(yamlPath, lines.join('\n'));
}

export interface DecisionApplyResult {
  ok: boolean;
  /** 本次真实落盘/更新的记录（op：ADDED 新增取号 / MODIFIED 就地更新保号）。 */
  applied: { file: string; dxx: number; op: 'ADDED' | 'MODIFIED' }[];
  base?: number;
  persistedNextId?: number;
  /** !ok 时的拒绝/解析原因。 */
  error?: string;
}

interface ParsedDecisionDelta {
  file: string;
  op: 'ADDED' | 'MODIFIED';
  body: string;
  filenameDxx: number;
  targetPath: string;
  targetExists: boolean;
}

/** 备份条目：记录事务写入前的文件在场态与内容，供失败时精确回滚（内容未变的文件回滚时跳过，避免只读目标二次抛错）。 */
interface Backup { path: string; existed: boolean; prev?: string }

/** 决策 apply 事务凭据（code-r5 F2，比照 ui-provenance 的 UI_COMMIT_JOURNAL）：崩溃/中断后据此前滚或回滚。 */
export const DECISION_APPLY_JOURNAL = 'DECISION_APPLY_JOURNAL.json';

/** journal 记录的单个目标：分配号、事务前在场态与旧内容（回滚用）、待写正文（身份摘要 = 正文全等）。 */
interface JournalTarget {
  file: string;
  op: 'ADDED' | 'MODIFIED';
  dxx: number;
  preExisted: boolean;
  prevContent: string | null;
  body: string;
}

/** 决策 apply 事务计划/凭据：一次 apply 的完整取号与目标集，落盘为 journal 供崩溃恢复。 */
interface DecisionApplyPlan {
  base: number;
  persistedNextId: number;
  addedCount: number;
  targets: JournalTarget[];
}

function readDecisionJournal(proposalDir: string): DecisionApplyPlan | null {
  const p = join(proposalDir, DECISION_APPLY_JOURNAL);
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    return (j && Array.isArray(j.targets) && typeof j.base === 'number' && typeof j.persistedNextId === 'number') ? j : null;
  } catch { return null; }
}

/** journal 是否为**当前 delta 集**的事务凭据：目标集合（文件名 + 正文全等）逐一相同。 */
function journalMatchesDeltas(plan: DecisionApplyPlan, parsed: ParsedDecisionDelta[]): boolean {
  if (plan.targets.length !== parsed.length) return false;
  const byFile = new Map(parsed.map(p => [p.file, p.body]));
  return plan.targets.every(t => byFile.get(t.file) === t.body);
}

/**
 * merge-executor 决策记录 apply 事务的受控执行入口（code-r2/r3/r4/r5 F2）。按 skills/merge-executor/SKILL.md
 * §「决策记录 apply 事务所有权」与场景 core-S38-decision-record §三（superseded）语义执行，**全部输入均从磁盘解析**：
 * ① 已提交（`SPEC_MERGED` 在场）→ 幂等 no-op；
 * ② 解析并**按段标记分类** ADDED / MODIFIED（MODIFIED = 就地更新既有记录、**保号不取新号**，支撑 superseded）；
 *    MODIFIED 目标须存在；文件名 DXX == 标题 DXX；
 * ③ **持久事务凭据（journal）判身份**（code-r5 F2，替代 r4 的内容摘要）：先原子落一份 `DECISION_APPLY_JOURNAL.json`
 *    （提案身份 = 目标集合 + 正文；含 base / 分配号 / 旧内容）再写任何资源。
 *    - **无匹配 journal（全新）**：同名 ADDED 目标已存在 → 一律**冲突拒绝**（即使正文相同——内容相等不能证明其
 *      由本次失败事务创建）；base 计入**全部已提交落盘 DXX**，`allocateDecisionRecordIds` 取号（重复即拒）。
 *    - **有匹配 journal（崩溃/中断恢复）**：直接沿用 journal 记录的 base/分配号（**绝不据已前移的 counter 重算**，
 *      故 marker 前崩溃可前滚补齐、不会重算成 D(N+1) 自拒）；同名既有目标是本事务残留、按 journal 恢复。
 * ④ **可回滚事务**：备份目标/YAML/marker，写主文档 → syncResourceIndex → 持久化 counter（仅 ADDED 批）→
 *    **写 marker 前重读校验后置条件**（文档集合 / counter / index）→ 写 `SPEC_MERGED` → 删 journal。
 *    任一步抛错 → 回滚已写、恢复旧内容/删除新建；全新事务回滚后删 journal，恢复事务保留 journal 供再次重试。
 * 事后点数由 S37 守恒门（lint L8 / merge 消费点）在 merge 前把关；本入口负责合法批的**原子**落盘、崩溃前滚与回滚。
 */
export function applyDecisionRecords(root: string, proposalDir: string, locale: Locale = 'zh'): DecisionApplyResult {
  const deltaDir = join(proposalDir, 'deltas', 'decisions');
  const decisionsDir = join(root, 'logos', 'resources', 'decisions');
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  const specMerged = join(proposalDir, 'SPEC_MERGED');
  const journalPath = join(proposalDir, DECISION_APPLY_JOURNAL);
  if (!existsSync(deltaDir)) return { ok: true, applied: [] }; // 无决策 delta → 零改动

  const deltaFiles = readdirSync(deltaDir).filter(f => f.endsWith('.md')).sort();
  if (deltaFiles.length === 0) return { ok: true, applied: [] };
  if (existsSync(specMerged)) return { ok: true, applied: [] }; // 已提交 → 幂等 no-op

  // ── 解析 + 分类（ADDED/MODIFIED）+ 结构校验 ──
  const parsed: ParsedDecisionDelta[] = [];
  for (const f of deltaFiles) {
    const raw = readFileSync(join(deltaDir, f), 'utf-8');
    const body = extractDeltaBody(raw);
    const filenameDxx = parseDecisionFilenameDxx(f);
    const titleDxx = parseDecisionTitleDxx(body);
    if (filenameDxx === null || titleDxx === null || filenameDxx !== titleDxx) {
      return { ok: false, applied: [], error: `${f}：文件名/标题 DXX 无法解析或不一致（文件名须 <module>-D<NN>-<slug>.md、标题须 # D<NN>：…、二者相等）` };
    }
    const targetPath = join(decisionsDir, f);
    const targetExists = existsSync(targetPath);
    const explicitOp = parseDeltaOp(raw);
    const op: 'ADDED' | 'MODIFIED' = explicitOp === 'MODIFIED' || (explicitOp === null && targetExists) ? 'MODIFIED' : 'ADDED';
    if (op === 'MODIFIED' && !targetExists) {
      return { ok: false, applied: [], error: `${f}：MODIFIED 目标 logos/resources/decisions/${f} 不存在，无法就地更新` };
    }
    parsed.push({ file: f, op, body, filenameDxx, targetPath, targetExists });
  }

  // ── ③ journal 判身份：恢复 or 全新 ──
  const journal = readDecisionJournal(proposalDir);
  const resuming = journal !== null && journalMatchesDeltas(journal, parsed);
  let plan: DecisionApplyPlan;
  if (resuming) {
    plan = journal!; // 崩溃/中断恢复：沿用 journal 记录的 base/分配号，绝不据已前移的 counter 重算
  } else {
    // 全新事务：无 journal 佐证 → 同名 ADDED 既有目标一律冲突拒绝（内容相等不能证明其为本次事务残留）
    for (const p of parsed) {
      if (p.op === 'ADDED' && p.targetExists) {
        return { ok: false, applied: [], error: `${p.file}：ADDED 目标 logos/resources/decisions/${p.file} 已存在——同名既有决策记录冲突，拒绝覆盖（无本次事务 journal 佐证其为崩溃残留；改用不同 DXX/slug，或对既有记录改用 MODIFIED 就地更新）` };
      }
    }
    const addedItems = parsed.filter(p => p.op === 'ADDED');
    // base 计入**全部已提交落盘 DXX**（同名既有 ADDED 已在上方拒绝，故不需排除任何项）
    const landed = (existsSync(decisionsDir) ? readdirSync(decisionsDir) : [])
      .map(parseDecisionFilenameDxx).filter((n): n is number => n !== null);
    const configuredNextId = readProjectYaml(root).data?.decision_counter?.next_id;
    const alloc = allocateDecisionRecordIds(
      landed, configuredNextId, addedItems.map(p => ({ filenameDxx: p.filenameDxx, titleDxx: p.filenameDxx })),
    );
    if (!alloc.ok) return { ok: false, applied: [], base: alloc.base, error: alloc.error }; // 零写入
    plan = {
      base: alloc.base,
      persistedNextId: alloc.persistedNextId,
      addedCount: addedItems.length,
      targets: parsed.map(p => ({
        file: p.file,
        op: p.op,
        dxx: p.op === 'ADDED' ? alloc.allocations[addedItems.indexOf(p)] : p.filenameDxx,
        preExisted: p.targetExists,
        prevContent: p.targetExists ? readFileSync(p.targetPath, 'utf-8') : null,
        body: p.body,
      })),
    };
  }

  // ── ④ 可回滚事务（前滚/回滚共用）──
  const backups: Backup[] = [];
  const backup = (path: string) => {
    const existed = existsSync(path);
    backups.push({ path, existed, prev: existed ? readFileSync(path, 'utf-8') : undefined });
  };
  const rollback = () => {
    for (const b of [...backups].reverse()) {
      try {
        const now = existsSync(b.path);
        if (b.existed) {
          // 仅在内容确被改动时回写——未改动（如只读 YAML 写失败前即原样）跳过，避免只读目标二次抛错。
          if (!now || readFileSync(b.path, 'utf-8') !== b.prev) writeFileSync(b.path, b.prev!);
        } else if (now) {
          rmSync(b.path);
        }
      } catch { /* 逐文件尽力回滚 */ }
    }
  };

  try {
    mkdirSync(decisionsDir, { recursive: true });
    for (const t of plan.targets) backup(join(decisionsDir, t.file));
    backup(yamlPath);
    if (!resuming) writeFileSync(journalPath, JSON.stringify(plan, null, 2)); // 首个资源写入前原子落 journal
    for (const t of plan.targets) writeFileSync(join(decisionsDir, t.file), t.body); // 主文档（ADDED 新建 / MODIFIED 覆盖整条全量）
    syncResourceIndex(root, locale);                                                  // 权威 index 路径
    if (plan.addedCount > 0) persistDecisionCounter(root, plan.persistedNextId);      // 仅 ADDED 批推进 counter
    // 写提交边界前**重读校验全部后置条件**（文档集合 / counter / index）——任一不满足即抛错回滚、不写 marker。
    for (const t of plan.targets) {
      const tp = join(decisionsDir, t.file);
      if (!existsSync(tp) || readFileSync(tp, 'utf-8') !== t.body) {
        throw new Error(`后置校验失败：决策文档 ${t.file} 未按预期落盘`);
      }
    }
    if (plan.addedCount > 0) {
      const persisted = readProjectYaml(root).data?.decision_counter?.next_id;
      if (persisted !== plan.persistedNextId) {
        throw new Error(`后置校验失败：decision_counter.next_id 未持久化为 ${plan.persistedNextId}（实际 ${persisted ?? '缺失'}）`);
      }
    }
    const yamlAfter = readFileSync(yamlPath, 'utf-8');
    for (const t of plan.targets) {
      if (!yamlAfter.includes(`path: logos/resources/decisions/${t.file}`)) {
        throw new Error(`后置校验失败：resource_index 未收录 ${t.file}`);
      }
    }
    writeFileSync(specMerged, '');                       // 全部后置条件满足后才写 marker（提交边界）
    if (existsSync(journalPath)) rmSync(journalPath);     // 提交成功 → 清 journal
  } catch (e) {
    rollback();
    // 全新事务：回滚已复原到事务前 → 删 journal；恢复事务：保留 journal 供下次重试（前滚点不丢）。
    if (!resuming && existsSync(journalPath)) { try { rmSync(journalPath); } catch { /* 尽力 */ } }
    return { ok: false, applied: [], base: plan.base, error: `apply 事务失败已回滚：${(e as Error).message}` };
  }

  return {
    ok: true,
    applied: plan.targets.map(t => ({ file: t.file, dxx: t.dxx, op: t.op })),
    base: plan.base,
    persistedNextId: plan.addedCount > 0 ? plan.persistedNextId : readProjectYaml(root).data?.decision_counter?.next_id,
  };
}
