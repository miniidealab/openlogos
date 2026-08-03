/**
 * brownfield-adopter 切片2：`openlogos baseline-seed`（begin / commit / status）。
 *
 * `baseline_seed_state` 与逆向产物目标文件的**唯一合法写入入口**——AI/driver/skill 不直接改 YAML、
 * 不直接写目标 `logos/resources/`，只把产物写入 run 私有 staging，经本命令让 CLI 校验后原子提交。
 * 两阶段 staging + commit journal 事务 + 模块级锁 + 恢复门，详见 lib/baseline-seed-txn.ts 与架构 §4.4。
 */
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import {
  parseProvenanceSection, isCanonicalKey, replaceProvenanceSection,
  reconcileModuleCandidates, extractRawCandidates, validateSeedCandidate,
  listModuleProvenanceDocs,
} from '../lib/baseline-provenance.js';
import type { BaselineSeedState, BaselineCandidate } from '../lib/baseline-provenance.js';
import { readProjectYaml, isAdoptedBootstrap } from '../lib/project-yaml.js';
import { effectiveBaselineSeedState } from '../lib/baseline-jit.js';
import {
  validateManifest, isSafeModuleId, isSafeRunId, acquireLock, releaseLock, readGate, recoverJournal,
  findUnfinalizedJournal, listRunIds, readRunRecord, runRecordPath, stagingDir,
  runDir, atomicWriteJson, writeSeedState, readSeedState,
  commitSeededTransaction, recordIssuedRun, isIssuedRun, newIssuedNonce,
  type ExpectedItem, type RunRecord, type SeedErrorCode,
} from '../lib/baseline-seed-txn.js';

/**
 * F4：manifest 目标必须**覆盖当前持有该模块权威候选的所有资源文档**。否则目标改名/换址后旧文档不进对账、
 * 旧候选残留 → 跨文档重复 key → 提交后扫描立即 parse_failed。此不变量强制「全模块重扫」计划纳入旧文档
 * （由生产者在 manifest 显式列出并 staging 迁移/清空其 provenance），杜绝「seeded 但立即冲突」。
 */
function assertManifestCoversHoldingDocs(root: string, moduleId: string, expected: ExpectedItem[]): void {
  const targetPaths = new Set(expected.map(e => e.target_path.replace(/\\/g, '/')));
  const uncovered = listModuleProvenanceDocs(root, moduleId).filter(d => !targetPaths.has(d));
  if (uncovered.length > 0) {
    fail('json', 'provenance_doc_uncovered',
      `manifest 未覆盖仍持有 ${moduleId} 现状候选的文档：${uncovered.join(', ')}（改名/换址须在 manifest 显式纳入旧文档以迁移/清空其 provenance）`);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** F2：校验 module 在 logos-project.yaml 注册表中存在且为 adopted（brownfield）模块。 */
function assertRegisteredAdoptedModule(root: string, moduleId: string, format: OutputFormat): void {
  const parsed = readProjectYaml(root);
  const mod = parsed.data?.modules?.find(m => m.id === moduleId);
  if (!mod) fail(format, 'unknown_run', `模块 ${moduleId} 未在 logos-project.yaml 注册`);
  if (!isAdoptedBootstrap(mod!.bootstrap)) fail(format, 'unknown_run', `模块 ${moduleId} 非 adopted（brownfield）模块，不接受 baseline-seed`);
}

/** 协议错误：抛出（而非 process.exit），使持锁的 finally 能先释放锁再由顶层统一打印+退出。 */
class SeedFailure extends Error {
  constructor(public readonly code: SeedErrorCode | string, message: string) {
    super(message);
  }
}

function fail(_format: OutputFormat, code: SeedErrorCode | string, message: string): never {
  throw new SeedFailure(code, message);
}

/**
 * 顶层错误包裹：运行命令体，SeedFailure → 打印 error envelope + 非零退出。
 * process.exit 不执行 finally，故锁释放必须在 body 的 try/finally 里（早于本处退出）完成。
 */
function runCommand(format: OutputFormat, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    if (e instanceof SeedFailure) {
      if (format === 'json') console.error(JSON.stringify(makeErrorEnvelope('baseline-seed', e.code, e.message)));
      else console.error(`✗ baseline-seed: ${e.message} (${e.code})`);
      process.exit(1);
    }
    throw e;
  }
}

/** 分配确定性 run_id：seed-<module>-<4 位序号>（基于既有 run 目录计数）。 */
function allocateRunId(root: string, moduleId: string): string {
  const prefix = `seed-${moduleId}-`;
  const existing = listRunIds(root).filter(id => id.startsWith(prefix));
  let n = existing.length + 1;
  let id = `${prefix}${String(n).padStart(4, '0')}`;
  while (existsSync(runDir(root, id))) {
    n += 1;
    id = `${prefix}${String(n).padStart(4, '0')}`;
  }
  return id;
}

/** begin：提交逻辑产物计划（无内容 hash），CLI 校验后签发 run_id + 建 staging + 持久化 run 记录。 */
export function baselineSeedBegin(moduleId: string | undefined, manifestPath: string | undefined, format: OutputFormat): void {
  runCommand(format, () => {
  const root = process.cwd();
  if (!moduleId) fail(format, 'invalid_manifest', '缺少 --module');
  if (!isSafeModuleId(moduleId)) fail(format, 'path_escape', `module id 非法：${moduleId}`);
  // F2：module 必须在项目注册表中存在且为 adopted（brownfield）模块——不接受对未注册/非 adopted 模块签发 seed run。
  assertRegisteredAdoptedModule(root, moduleId, format);
  if (!manifestPath || !existsSync(join(root, manifestPath))) fail(format, 'invalid_manifest', `manifest 不存在：${manifestPath}`);

  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(root, manifestPath!), 'utf-8'));
  } catch {
    fail(format, 'invalid_manifest', 'manifest 不是合法 JSON');
  }
  const validated = validateManifest(root, manifest);
  if (!validated.ok) {
    const msg = validated.error === 'missing_required_kind'
      ? '逻辑计划缺必需 kind（system-map + scenario-candidates）'
      : validated.error === 'path_escape'
        ? 'target_path 路径不安全（绝对/../符号链接/重复/越界）'
        : 'manifest schema 非法';
    fail(format, validated.error, msg);
  }
  const expected = validated.expected;

  // 先取锁 + 恢复门：把模块下未终结 run 先恢复到一致态，再 supersede，再建新 run（不在半提交态叠新 run）。
  if (!acquireLock(root, moduleId!)) fail(format, 'run_locked', `模块 ${moduleId} 正被其它提交占用`);
  try {
    const pending = findUnfinalizedJournal(root, moduleId!);
    if (pending) recoverJournal(root, pending.runId, nowIso());

    // F4：manifest 必须覆盖当前持有本模块候选的所有文档（改名/换址须显式纳入旧文档）——恢复后再校验。
    assertManifestCoversHoldingDocs(root, moduleId!, expected);

    // supersede 同模块此前 open 的 run（begin 不下调 baseline_seed_state：partial 保留至新 run 首次有效 commit）。
    for (const id of listRunIds(root)) {
      const rec = readRunRecord(root, id);
      if (rec && rec.module === moduleId && rec.status === 'open') {
        rec.status = 'superseded';
        atomicWriteJson(runRecordPath(root, id), rec);
      }
    }

    const runId = allocateRunId(root, moduleId!);
    mkdirSync(stagingDir(root, runId), { recursive: true });
    // F2：生成随机 nonce 并记入 CLI 受控签发账本——commit 双向核对，作为「本 run 确经 begin 签发」的证据。
    const issuedNonce = newIssuedNonce();
    const record: RunRecord = { run_id: runId, module: moduleId!, status: 'open', expected, created_at: nowIso(), issued_nonce: issuedNonce };
    atomicWriteJson(runRecordPath(root, runId), record);
    recordIssuedRun(root, runId, moduleId!, issuedNonce);

    // baseline-seed-legacy-default-unify：缺省经共享 helper（唯一事实源）；begin 持写锁 → assumeLocked 复用。
    const state = effectiveBaselineSeedState(root, moduleId!, readSeedState(root, moduleId!), { assumeLocked: true }).state;
    const payload = { ok: true, run_id: runId, module: moduleId!, baseline_seed_state: state, expected: expected.length, staging: `logos/resources/verify/baseline-seed-runs/${runId}/staging/` };
    if (format === 'json') console.log(JSON.stringify(makeEnvelope('baseline-seed', payload)));
    else {
      console.log(`✓ baseline-seed begin：run_id=${runId}，expected=${expected.length}`);
      console.log(`  staging：${payload.staging}`);
      console.log(`  把逆向产物写入 staging 后运行：openlogos baseline-seed commit --module ${moduleId} --run-id ${runId}`);
    }
  } finally {
    releaseLock(root, moduleId!);
  }
  });
}

interface CommitClassification {
  committed: string[];
  missing: string[];
  invalid: string[];
}

/**
 * 对 staged 实际字节逐项校验并分类（F3 严格化）：
 * - 缺章节 / fenced YAML 解析失败 / 结构非法（`parse_ok=false`）→ `invalid`（不得当作空候选放行 seeded）。
 * - 每个候选 key 必须为规范键且**归属本模块**（`<module>::<12hex>`）→ 否则 `candidate_key_mismatch` 硬拒（防伪造/跨模块）。
 * - staged candidates[] 的 key 集合与 manifest `candidate_keys` 逐项一致 → 否则 `candidate_key_mismatch` 硬拒。
 */
function classifyStaged(root: string, runId: string, moduleId: string, expected: ExpectedItem[]): CommitClassification | { hardError: SeedErrorCode } {
  const committed: string[] = [];
  const missing: string[] = [];
  const invalid: string[] = [];
  const seenKeysAcrossTargets = new Set<string>(); // F5：跨目标 staged 同 key 冲突检测
  for (const item of expected) {
    const staged = join(stagingDir(root, runId), item.target_path);
    if (!existsSync(staged)) { missing.push(item.target_path); continue; }
    const content = readFileSync(staged, 'utf-8');
    const section = parseProvenanceSection(content);
    if (!section || !section.parse_ok) { invalid.push(item.target_path); continue; } // 严格 schema
    // 模块归属 + 规范键（防跨模块/伪造 key 外形）——先行，保跨模块给 candidate_key_mismatch。
    for (const c of section.candidates) {
      if (!isCanonicalKey(c.key, moduleId)) return { hardError: 'candidate_key_mismatch' };
      // F5：同一稳定 key 出现在多个目标文档 → 冲突（写侧不得生成读侧即判 unknown 的集合）。
      if (seenKeysAcrossTargets.has(c.key)) return { hardError: 'candidate_key_conflict' };
      seenKeysAcrossTargets.add(c.key);
    }
    // F3：对**原始（未规范化）** candidates 做严格 seed 校验——state 显式 active、verified 显式 false、
    // anchor 非空、key == candidateKey(module, anchor)（重算比对）；任一不符即硬拒（不让宽松归一放行伪造边界）。
    const rawSec = extractRawCandidates(content);
    if (!rawSec || !rawSec.ok) { invalid.push(item.target_path); continue; }
    for (const raw of rawSec.raw) {
      if (validateSeedCandidate(raw, moduleId) !== null) return { hardError: 'invalid_provenance' };
    }
    // F10：candidate_keys 与 staged candidates[] **集合相等**（逐项一致）**无条件**校验——
    // 冻结计划（manifest.candidate_keys）必须约束实际提交集合。**不再**以 `length>0` 前置条件跳过：
    // 空 candidate_keys 对非空 staged（或反之）同样判 candidate_key_mismatch（EX-6.2 / UT-S33-23）。
    const stagedKeys = new Set(section.candidates.map(c => c.key));
    const expectedKeys = new Set(item.candidate_keys);
    const sameSize = stagedKeys.size === expectedKeys.size;
    const superset = [...expectedKeys].every(k => stagedKeys.has(k));
    if (!sameSize || !superset) {
      return { hardError: 'candidate_key_mismatch' };
    }
    committed.push(item.target_path);
  }
  return { committed, missing, invalid };
}

/** commit：对 staged 字节校验；全部合法 → seeded 事务提交；≥1 未全 → partial（不提交）；0 → 保持。 */
export function baselineSeedCommit(moduleId: string | undefined, runId: string | undefined, format: OutputFormat): void {
  runCommand(format, () => {
  const root = process.cwd();
  if (!moduleId) fail(format, 'invalid_manifest', '缺少 --module');
  if (!isSafeModuleId(moduleId)) fail(format, 'path_escape', `module id 非法：${moduleId}`);
  if (!runId) fail(format, 'invalid_manifest', '缺少 --run-id');
  if (!isSafeRunId(runId)) fail(format, 'path_escape', `run id 非法：${runId}`); // F2：防 --run-id 路径注入
  // F2：run id 必须匹配 begin 签发格式 `seed-<module>-<NNNN>`——拒绝手工放入的任意安全字符串 run 目录。
  if (!new RegExp(`^seed-${moduleId}-\\d{4,}$`).test(runId!)) {
    fail(format, 'unknown_run', `run_id 非 begin 签发格式：${runId}`);
  }
  assertRegisteredAdoptedModule(root, moduleId!, format);

  if (!acquireLock(root, moduleId!)) fail(format, 'run_locked', `模块 ${moduleId} 正被其它提交占用`);
  try {
    // 恢复门（已持锁）：先把本模块其它未终结 journal 恢复到一致态。
    const pending = findUnfinalizedJournal(root, moduleId!);
    if (pending && pending.runId !== runId) recoverJournal(root, pending.runId, nowIso());

    const record = readRunRecord(root, runId!);
    if (!record) fail(format, 'unknown_run', `未知 run_id：${runId}`);
    if (record!.module !== moduleId) fail(format, 'unknown_run', `run ${runId} 不属于模块 ${moduleId}`);
    // F2：run 记录自身的 run_id 必须与 --run-id 一致——防手工放入 run.json（run_id 指向他值）冒充签发。
    if (record!.run_id !== runId) fail(format, 'unknown_run', `run 记录 run_id 与 --run-id 不一致（记录 ${record!.run_id}）`);
    // F2：run 必须在 **CLI 受控签发账本**中登记且 nonce 一致——把「签发事实」从「目录内自述 JSON 自洽」提升为
    // 「CLI 受控账本已登记」。手工放入一个格式合法且自洽（run_id/module/expected 均对）却**从未经 begin**的 run 目录
    // 不会进入账本，此处即以 unknown_run 拒绝、绝不 seeded。
    if (!isIssuedRun(root, runId!, moduleId!, record!.issued_nonce)) {
      fail(format, 'unknown_run', `run ${runId} 未见于 CLI 签发账本（非 begin 签发或已被清理）`);
    }
    if (record!.status === 'superseded') fail(format, 'stale_run', `run ${runId} 已被新 begin 取代`);
    // F2：对持久化 run 记录重新执行**与 begin 同一**的完整 manifest 校验（schema + 必需 kind + kind 枚举 +
    // 跨目标 key 唯一性 + 路径安全）——防 run.json 被篡改后绕过 begin 校验改向合法资源文档/复制权威候选。
    const manifestCheck = validateManifest(root, { expected: record!.expected });
    if (!manifestCheck.ok) fail(format, manifestCheck.error, 'run 记录 manifest 校验未通过（被篡改或非法）');
    // F4：commit 时也强制「manifest 覆盖当前持有候选的所有文档」——防两轮之间目标改名致旧文档残留候选。
    assertManifestCoversHoldingDocs(root, moduleId!, record!.expected);

    // 幂等：staged 保持纯净（扫描器输出），每次 commit 独立重算、结果一致、不重复计数。
    const cls = classifyStaged(root, runId!, moduleId!, record!.expected);
    if ('hardError' in cls) fail(format, cls.hardError, 'staged 产物 candidates[] 非法：key 非本模块规范键或与 manifest candidate_keys 不一致');

    const fromState = readSeedState(root, moduleId!);
    const requiredKinds = new Set(['system-map', 'scenario-candidates']);
    const committedKinds = new Set(record!.expected.filter(e => cls.committed.includes(e.target_path)).map(e => e.kind));
    const requiredComplete = [...requiredKinds].every(k => committedKinds.has(k));
    const allValid = cls.missing.length === 0 && cls.invalid.length === 0 && requiredComplete;

    let finalState: BaselineSeedState;
    if (allValid && cls.committed.length > 0) {
      // F4：seeded 提交前，对每个目标做重扫对账——以已合并主文档为 prior 继承人工确认（verified:true 不降级）、
      // 消失候选转 tombstone（不缩分母、支持 alias/rename 身份继承）；**在内存计算最终内容，不改写 staged**
      // （staged 保持纯净扫描器输出 → 幂等重提交稳定、F3 校验恒对纯净输入）。最终内容交事务持久化到 resolved 后提交。
      // F4：以**模块级全局**注册表对账（prior/staged 均按目标文档聚合），支持真实 anchor 重命名（旧 anchor 进
      // aliases[]）身份继承与跨文档移动去重；结果按文档回写。staged 保持纯净（不改写），仅内存计算最终内容。
      const allKeys = new Set<string>();
      const priorByDoc = new Map<string, BaselineCandidate[]>();
      const stagedByDoc = new Map<string, BaselineCandidate[]>();
      const stagedContentByDoc = new Map<string, string>();
      for (const e of record!.expected) {
        const stagedPath = join(stagingDir(root, runId!), e.target_path);
        const abs = join(root, e.target_path);
        const stagedContent = readFileSync(stagedPath, 'utf-8');
        const stagedSection = parseProvenanceSection(stagedContent);
        if (!stagedSection) continue; // classifyStaged 已保证合法，防御性跳过
        stagedContentByDoc.set(e.target_path, stagedContent);
        stagedByDoc.set(e.target_path, stagedSection.candidates);
        const prior = existsSync(abs) ? parseProvenanceSection(readFileSync(abs, 'utf-8')) : null;
        priorByDoc.set(e.target_path, prior && prior.parse_ok ? prior.candidates : []);
      }
      const resolvedByDoc = reconcileModuleCandidates(moduleId!, priorByDoc, stagedByDoc);
      const finalTargets: Array<{ target_path: string; content: string }> = [];
      for (const e of record!.expected) {
        const stagedContent = stagedContentByDoc.get(e.target_path);
        if (stagedContent === undefined) continue;
        const reconciled = resolvedByDoc.get(e.target_path) ?? [];
        finalTargets.push({ target_path: e.target_path, content: replaceProvenanceSection(stagedContent, reconciled) });
        reconciled.forEach(c => allKeys.add(c.key));
      }
      commitSeededTransaction(root, moduleId!, runId!, finalTargets, fromState, nowIso(), [...allKeys]);
      record!.status = 'committed';
      atomicWriteJson(runRecordPath(root, runId!), record!);
      finalState = 'seeded';
    } else if (cls.committed.length > 0) {
      // partial：不提交不完整集合为权威，只写状态。
      writeSeedState(root, moduleId!, 'partial');
      finalState = 'partial';
    } else {
      // 0 合法 → 保持当前状态（缺省经共享 helper 派生；commit 持写锁 → assumeLocked 复用）。
      finalState = effectiveBaselineSeedState(root, moduleId!, fromState, { assumeLocked: true }).state;
    }

    const payload = {
      ok: true, run_id: runId, module: moduleId!, baseline_seed_state: finalState,
      committed: cls.committed, missing: cls.missing, invalid: cls.invalid,
    };
    if (format === 'json') console.log(JSON.stringify(makeEnvelope('baseline-seed', payload)));
    else {
      console.log(`✓ baseline-seed commit：baseline_seed_state=${finalState}`);
      console.log(`  committed=${cls.committed.length} missing=${cls.missing.length} invalid=${cls.invalid.length}`);
      if (finalState === 'partial') {
        console.log(`  未完成——补齐 staging 后重跑：openlogos baseline-seed commit --module ${moduleId} --run-id ${runId}`);
      }
    }
  } finally {
    releaseLock(root, moduleId!);
  }
  });
}

/** status：只读当前 run、staging 进度与状态，供恢复/重试决策。 */
export function baselineSeedStatus(moduleId: string | undefined, format: OutputFormat): void {
  runCommand(format, () => {
  const root = process.cwd();
  if (!moduleId) fail(format, 'invalid_manifest', '缺少 --module');

  // 只读也经恢复门（先恢复未终结 journal；无法取锁则 baseline_commit_in_progress）。
  const gate = readGate(root, moduleId!, nowIso());
  if (!gate.ok) fail(format, gate.error, '提交进行中，请稍后重试');

  // baseline-seed-legacy-default-unify：缺省经共享 helper（唯一事实源；已过恢复门，helper 自取读锁派生）。
  const eff = effectiveBaselineSeedState(root, moduleId!, readSeedState(root, moduleId!));
  const state = eff.state;
  // 选最近的 open run。
  const openRuns = listRunIds(root)
    .map(id => readRunRecord(root, id))
    .filter((r): r is RunRecord => r !== null && r.module === moduleId && r.status === 'open');
  const run = openRuns[openRuns.length - 1] ?? null;

  let staged = 0;
  let expected = 0;
  const missing: string[] = [];
  if (run) {
    expected = run.expected.length;
    for (const item of run.expected) {
      if (existsSync(join(stagingDir(root, run.run_id), item.target_path))) staged += 1;
      else missing.push(item.target_path);
    }
  }

  const payload = { ok: true, module: moduleId!, baseline_seed_state: state, run_id: run?.run_id ?? null, staged, expected, missing };
  if (format === 'json') console.log(JSON.stringify(makeEnvelope('baseline-seed', payload)));
  else {
    console.log(`run: ${run?.run_id ?? '(none)'}  state: ${state}  staged ${staged}/${expected}  missing ${missing.length}`);
    if (eff.legacy) {
      console.log('（legacy 项目未标注种子状态，建议运行 openlogos sync 迁移元数据）');
    }
    if (run && staged < expected) {
      console.log(`下一步：openlogos baseline-seed commit --module ${moduleId} --run-id ${run.run_id}（补齐 staging 后自动转 seeded）`);
    }
  }
  });
}
