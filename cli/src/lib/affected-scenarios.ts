/**
 * layered-verification：proposal「受影响场景」段的唯一读取入口与可用性判定（功能规格 §2.109.4）。
 *
 * verify（分层开启时计算受影响用例与扩大规则）与 change-lint（结构检查）消费同一个判定——
 * lint 报告为违规的声明，verify 一律按扩大处理，不会出现「lint 通过但 verify 读不懂」。
 *
 * 本段是**非 canonical 段**：不进 `PLAN_SECTION_REGISTRY`，缺段不影响 Plan Package 判定。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readBaselineBefore, readSpecMergedRecord, sha256Hex } from './merge-baseline.js';
import { buildTestChangeSet } from './test-change-set.js';
import { runGitReadonly, runGitReadonlyBuffer, withGitReadonlyEnv } from './git-readonly.js';

export const AFFECTED_SCENARIOS_SECTION_TITLES = ['受影响场景', 'Affected Scenarios'] as const;
export const AFFECTED_SCENARIOS_SCHEMA = 'openlogos/affected-scenarios@1';

export type AffectedDeclarationStatus = 'usable' | 'missing' | 'invalid' | 'unknown' | 'scenario_unknown';

export interface AffectedScenarioItem { id: string; reason: string }

export interface AffectedDeclaration {
  status: AffectedDeclarationStatus;
  /** 段标题的 1 基行号；段不在场时为 null。 */
  line: number | null;
  /** 结构问题（status 为 invalid 时非空）；每条是可直接展示的一句话。 */
  problems: string[];
  /** 声明中不存在的场景编号（status 为 scenario_unknown 时非空；其他状态下也如实给出）。 */
  unknownScenarioIds: string[];
  /** `assessment` 原值（字符串时）；否则为 null。 */
  assessment: string | null;
  /**
   * 共享标志：YAML 可解析且 `shared_change` 是布尔 true。不论 status 如何都独立采信（只扩大不缩小）。
   */
  sharedChange: boolean;
  /**
   * 已识别场景：`scenarios` 中结构合法（编号形态、理由非空）且场景存在的项，去重、保持出现序。
   * 不论 status 如何都独立采信。
   */
  recognized: AffectedScenarioItem[];
}

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
export const SCENARIO_ID_RE = /^S\d+$/;
const SCENARIO_IN_FILENAME_RE = /-(S\d+)-/;

const SCENARIO_DOC_DIR = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const TEST_DOC_DIR = 'logos/resources/test';
const DELTA_SCENARIO_DIR = 'deltas/prd/3-technical-plan/2-scenario-implementation';
const DELTA_TEST_DIR = 'deltas/test';

/** 文件名中的场景编号（`<module>-SXX-…`）；没有时为 null。 */
export function scenarioIdOfFile(filePath: string): string | null {
  const m = SCENARIO_IN_FILENAME_RE.exec(basename(filePath));
  return m ? m[1] : null;
}

function listMarkdown(dir: string, recursive: boolean): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { recursive }).map(f => String(f).split('\\').join('/')).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/** 本提案 delta 触及的场景（deltas 下场景文档与测试用例文档文件名中的场景编号），字典序。 */
export function deltaTouchedScenarioIds(proposalDir: string): string[] {
  const ids = new Set<string>();
  for (const file of listMarkdown(join(proposalDir, DELTA_SCENARIO_DIR), false)) {
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  for (const file of listMarkdown(join(proposalDir, DELTA_TEST_DIR), false)) {
    if (!file.endsWith('-test-cases.md')) continue;
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  return Array.from(ids).sort();
}

/** 测试变更集的三态（与跳过分类同一读取结果，功能规格 §2.106.6）。 */
export type DeltaTouchChangeSetState = 'unmerged' | 'valid' | 'invalid';

export interface DeltaTouchSeams {
  /** 用例行比较（缺省即构建测试变更集的同一套比较）；测试用接缝。 */
  compare?: typeof buildTestChangeSet;
  /** 取 Git 版本 `[major, minor]`（缺省执行 `git version`）；测试用接缝，用于覆盖不支持 `GIT_NO_LAZY_FETCH` 的旧版本路径。 */
  gitVersion?: (root: string) => [number, number] | null;
  /** 读回并复核合并前内容（缺省经只读 git 执行入口读取并复核 sha256）；测试用接缝，用于确认哪些对象进入了读取。 */
  readBaselineBefore?: typeof readBaselineBefore;
}

/** 提案 `deltas/test/` 下属于某个场景的测试用例文档：`{ file, scenario }`，按文件名升序。 */
function deltaTestCaseDocs(proposalDir: string): Array<{ file: string; scenario: string }> {
  const out: Array<{ file: string; scenario: string }> = [];
  for (const file of listMarkdown(join(proposalDir, DELTA_TEST_DIR), false).sort()) {
    if (!file.endsWith('-test-cases.md')) continue;
    const scenario = scenarioIdOfFile(file);
    if (scenario) out.push({ file, scenario });
  }
  return out;
}

/** `GIT_NO_LAZY_FETCH` 自 Git 2.45 起生效；更早的版本会忽略它。 */
const LAZY_FETCH_SWITCH_SINCE: readonly [number, number] = [2, 45];

/** 读取合并前内容时，某个 blob 能否安全读取（不触发按需取回）；每次计算建立一次。 */
type LocalBlobGate = (blobId: string | null) => boolean;

/** 经验收期间的只读 git 执行入口执行（§2.111.2）。 */
function gitText(root: string, args: string[], maxBuffer = 1024 * 1024): { status: number | null; stdout: string } {
  const r = runGitReadonly(root, args, { maxBuffer });
  return { status: r.error ? null : r.status, stdout: r.stdout };
}

function gitVersionOf(root: string): [number, number] | null {
  const version = gitText(root, ['version']);
  const m = /(\d+)\.(\d+)/.exec(version.stdout);
  return version.status === 0 && m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * 本地对象库中已有的对象 id 集合：`cat-file --batch-all-objects` 只枚举本地（松散、pack 与 alternates 中的）对象，
 * 不解析具体对象名，因此不会触发按需取回。枚举失败返回 null。
 */
function localObjectIds(root: string): Set<string> | null {
  const listed = gitText(root, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname)', '--unordered'], 1024 * 1024 * 512);
  if (listed.status !== 0) return null;
  return new Set(listed.stdout.split('\n').map(line => line.trim()).filter(Boolean));
}

/**
 * 建立「哪些 blob 可以安全读取」的判断（探测只读本地的 Git 版本与对象清单）：
 * - Git 支持 `GIT_NO_LAZY_FETCH`：全部可读——读取时带该开关，本地缺失的对象由那一次读取自己判为不可读；
 * - Git 不支持该开关，或取不到版本：逐个对象判断，只读本地对象清单里已有的；本地缺失的不读
 *   （该文档按文件名回退，其他文档照常比较）；
 * - 对象清单枚举失败：都不读。
 *
 * **不根据仓库配置判断「是不是部分克隆」**：会让 Git 在缺对象时访问远端的配置不止一种写法
 * （`remote.<name>.promisor`、`extensions.partialclone`、只配了 `remote.<name>.partialclonefilter` 等），
 * 逐个识别配置键容易漏；旧版本上直接以「对象是否在本地」为准，与配置怎么写无关。
 */
function localBlobGate(root: string, gitVersion: (root: string) => [number, number] | null): LocalBlobGate {
  try {
    const version = gitVersion(root);
    const hasSwitch = version !== null
      && (version[0] > LAZY_FETCH_SWITCH_SINCE[0] || (version[0] === LAZY_FETCH_SWITCH_SINCE[0] && version[1] >= LAZY_FETCH_SWITCH_SINCE[1]));
    if (hasSwitch) return () => true;
    const local = localObjectIds(root);
    if (local === null) return () => false;
    return blobId => blobId !== null && local.has(blobId);
  } catch {
    return () => false;
  }
}

/**
 * 只从本地对象库读回并复核合并前内容（场景 EX-13.66「副作用：无」）：经只读 git 执行入口读取 blob——不连接远端、
 * 不取回对象、有时限；本地缺对象、超时或 sha256 复核不过都判不可读。
 */
function readBaselineBeforeLocalOnly(root: string, before: Parameters<typeof readBaselineBefore>[1]): Buffer | null {
  if (before.git_blob === null || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(before.git_blob)) return null;
  const r = runGitReadonlyBuffer(root, ['cat-file', 'blob', before.git_blob], { maxBuffer: 1024 * 1024 * 512 });
  if (r.error || r.timedOut || r.status !== 0) return null;
  return sha256Hex(r.stdout) === before.sha256 ? r.stdout : null;
}

/**
 * 一份测试用例文档的用例在合并前后是否有变化（功能规格 §2.109.5「测试用例文档的用例变化」第 2、5 条）。
 * 返回 `null` 表示无法判断——调用方按文件名记为触及。只读：只读本地对象库，不触发按需取回，不向 git 对象库写入。
 */
function testCaseDocChanged(
  root: string,
  targetPath: string,
  baseline: NonNullable<ReturnType<typeof readSpecMergedRecord>['baseline']>,
  compare: typeof buildTestChangeSet,
  canRead: (blobId: string | null) => boolean,
  read: typeof readBaselineBefore | undefined,
): boolean | null {
  const target = baseline.targets.find(t => t.path === targetPath);
  if (!target) return null;
  let beforeBytes: Buffer | null = null;
  if (target.mode === 'MODIFY') {
    if (!target.before) return null;
    // 不能保证这一个对象的读取不触发按需取回时不读（旧版 Git 上本地缺少该对象，或探测失败）：这份文档按文件名回退
    if (!canRead(target.before.git_blob)) return null;
    // 测试接缝提供的读取函数在三项约束的环境下执行；缺省读取经只读 git 执行入口（带时限）
    beforeBytes = read ? withGitReadonlyEnv(() => read(root, target.before!)) : readBaselineBeforeLocalOnly(root, target.before);
    if (beforeBytes === null) return null;
  } else if (target.before !== null) {
    return null;
  }
  const abs = join(root, ...targetPath.split('/'));
  let afterBytes: Buffer;
  try {
    if (!existsSync(abs)) return null;
    afterBytes = readFileSync(abs);
  } catch {
    return null;
  }
  if (sha256Hex(afterBytes) !== target.after_sha256) return null;
  try {
    const result = compare({ change: 'delta-touch', module: 'delta-touch', targets: [{ targetPath, beforeBytes, afterBytes }] });
    return result.changed_test_ids.length > 0 || result.removed_test_ids.length > 0;
  } catch {
    return null;
  }
}

/**
 * 分层验收使用的「本提案 delta 触及的场景」（功能规格 §2.109.5，fix-delta-touched-by-case-change），字典序。
 *
 * - 场景文档：按文件名，不看内容。
 * - 测试用例文档：提案未合并或测试变更集无效时按文件名；已合并且变更集有效时**逐份文档**比较合并基线记录的
 *   合并前内容与工作区当前内容（构建测试变更集的同一套用例行比较，每次只送入一份文档），有新增、修改或删除才算触及。
 *   无法判断（没有合法的合并基线、找不到目标、合并前内容读不回、当前文件对不上、比较报错）时只对这一份文档按文件名。
 *
 * 不使用整个提案汇总的 `changed_test_ids` / `removed_test_ids`，不按用例编号归属。
 * `deltaTouchedScenarioIds`（只看文件名）继续供 `knownScenarioIds` 判断「场景是否存在」，不随本函数变化。
 */
export function layeredDeltaTouchedScenarioIds(
  root: string,
  proposalDir: string,
  changeSetState: DeltaTouchChangeSetState,
  seams: DeltaTouchSeams = {},
): string[] {
  const ids = new Set<string>();
  for (const file of listMarkdown(join(proposalDir, DELTA_SCENARIO_DIR), false)) {
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  const docs = deltaTestCaseDocs(proposalDir);
  if (docs.length > 0) {
    const baseline = changeSetState === 'valid' ? readSpecMergedRecord(proposalDir).baseline : null;
    const compare = seams.compare ?? buildTestChangeSet;
    // 「哪些 blob 可以安全读取」每次计算最多探测一次，且只在确有合并前内容要读时才探测；判断仍然逐个对象给出
    let gate: LocalBlobGate | null = null;
    const canRead: LocalBlobGate = blobId => (gate ??= localBlobGate(root, seams.gitVersion ?? gitVersionOf))(blobId);
    for (const doc of docs) {
      if (ids.has(doc.scenario)) continue;
      const changed = baseline === null ? null : testCaseDocChanged(root, `${TEST_DOC_DIR}/${doc.file}`, baseline, compare, canRead, seams.readBaselineBefore);
      if (changed !== false) ids.add(doc.scenario);
    }
  }
  return Array.from(ids).sort();
}

/**
 * 存在的场景编号：已合并资源中有该编号的场景文档或测试用例文档，或本提案 delta 中有该编号的同类文件。
 */
export function knownScenarioIds(root: string, proposalDir: string | null): Set<string> {
  const ids = new Set<string>();
  for (const file of listMarkdown(join(root, SCENARIO_DOC_DIR), false)) {
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  for (const file of listMarkdown(join(root, TEST_DOC_DIR), false)) {
    if (!file.endsWith('-test-cases.md')) continue;
    const id = scenarioIdOfFile(file);
    if (id) ids.add(id);
  }
  if (proposalDir) for (const id of deltaTouchedScenarioIds(proposalDir)) ids.add(id);
  return ids;
}

interface SectionBody { line: number; yamlText: string | null }

/** 定位「受影响场景」段并取出其中第一个 fenced 代码块的正文。 */
function locateSection(content: string): SectionBody | null {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = HEADING_RE.exec(line);
    if (!h) continue;
    if (start < 0) {
      if (h[1].length === 2 && (AFFECTED_SCENARIOS_SECTION_TITLES as readonly string[]).includes(h[2].trim())) start = i;
    } else if (h[1].length <= 2) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;
  let open = -1;
  for (let i = start + 1; i < end; i++) {
    if (!FENCE_RE.test(lines[i])) continue;
    if (open < 0) { open = i; continue; }
    return { line: start + 1, yamlText: lines.slice(open + 1, i).join('\n') };
  }
  return { line: start + 1, yamlText: null };
}

/**
 * 解析 proposal 全文中的「受影响场景」段并判定可用性。
 * `known`：存在的场景编号集合（见 knownScenarioIds）。
 */
export function parseAffectedDeclaration(content: string, known: ReadonlySet<string>): AffectedDeclaration {
  const base: AffectedDeclaration = {
    status: 'missing', line: null, problems: [], unknownScenarioIds: [], assessment: null, sharedChange: false, recognized: [],
  };
  const section = locateSection(content);
  if (!section) return base;
  const out: AffectedDeclaration = { ...base, status: 'invalid', line: section.line };
  if (section.yamlText === null) {
    out.problems.push('段内没有 fenced YAML 代码块');
    return out;
  }
  let doc: unknown;
  try {
    doc = parseYaml(section.yamlText);
  } catch (error) {
    out.problems.push(`YAML 无法解析：${(error as Error).message.split('\n')[0]}`);
    return out;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    out.problems.push('YAML 顶层不是对象');
    return out;
  }
  const record = doc as Record<string, unknown>;
  // 共享标志与已识别场景：能读出就独立采信
  out.sharedChange = record.shared_change === true;
  if (record.schema !== AFFECTED_SCENARIOS_SCHEMA) out.problems.push(`schema 必须为 ${AFFECTED_SCENARIOS_SCHEMA}`);
  if (typeof record.assessment === 'string') out.assessment = record.assessment;
  if (record.assessment === 'pending') out.problems.push('assessment 仍为脚手架占位 pending，尚未评估');
  else if (record.assessment !== 'assessed' && record.assessment !== 'unknown') out.problems.push('assessment 必须为 assessed 或 unknown');
  if (typeof record.shared_change !== 'boolean') out.problems.push('shared_change 必须为布尔值');
  const seen = new Set<string>();
  const unknown: string[] = [];
  if (!Array.isArray(record.scenarios)) {
    out.problems.push('scenarios 必须为数组');
  } else {
    record.scenarios.forEach((raw, index) => {
      const where = `scenarios[${index}]`;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { out.problems.push(`${where} 必须是含 id 与 reason 的对象`); return; }
      const item = raw as Record<string, unknown>;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
      let itemOk = true;
      if (!SCENARIO_ID_RE.test(id)) { out.problems.push(`${where}.id 不是场景编号（形如 S13）`); itemOk = false; }
      if (!reason) { out.problems.push(`${where}${id ? `（${id}）` : ''} 的 reason 为空`); itemOk = false; }
      if (itemOk && seen.has(id)) { out.problems.push(`场景编号 ${id} 重复`); itemOk = false; }
      if (!itemOk) return;
      seen.add(id);
      if (!known.has(id)) { unknown.push(id); return; }
      out.recognized.push({ id, reason });
    });
  }
  out.unknownScenarioIds = unknown;
  if (out.problems.length > 0) { out.status = 'invalid'; return out; }
  if (unknown.length > 0) { out.status = 'scenario_unknown'; return out; }
  out.status = record.assessment === 'unknown' ? 'unknown' : 'usable';
  return out;
}

/** 读取提案目录中 proposal.md 的「受影响场景」声明。proposal 不可读时按 missing。 */
export function readAffectedDeclaration(root: string, proposalDir: string): AffectedDeclaration {
  let content = '';
  try { content = readFileSync(join(proposalDir, 'proposal.md'), 'utf-8'); } catch { /* 按缺段 */ }
  return parseAffectedDeclaration(content, knownScenarioIds(root, proposalDir));
}
