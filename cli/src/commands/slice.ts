/**
 * `openlogos slice plan` —— 切片规划的**唯一受控写入口**（功能规格 §2.68）。
 *
 * 取代此前的六动作切片事务（submit-content ×2 → seal → apply）：一次调用完成
 * 「校验结构化输入 → 写 tasks.md 的 [code] 段 → 写 TEST_SLICE_MANIFEST.json →
 * 依刚写出的 tasks.md 自算指纹」。6 次 CLI 往返降为 1 次。
 *
 * 设计不变量（根规范 spec/cli-json-output.md「结构化事实源不变量」）：
 * **流程判断必须使用结构化数据。** `owned_test_ids` 是 verify 计算 eligible 的输入，
 * 只能来自本命令写入的 TEST_SLICE_MANIFEST.json，禁止从 tasks.md 的 [code] 散文反解析
 * ——正文中「被提及」的测试 ID 不等于该切片「拥有」它。故结构化产物的生成权留在 CLI，
 * AI 只提供结构化 slices.json 输入。
 */
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { OutputFormat } from '../lib/json-output.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import { extractCodeSectionRaw, replaceCodeSectionBody } from '../lib/proposal-lifecycle.js';
import {
  TEST_SLICE_MANIFEST,
  TEST_SLICE_SCHEMA,
  collectSliceManifestViolations,
  commitStagedFile,
  computeSpecFingerprint,
  computeTaskFingerprint,
  discardStagedFile,
  readTestChangeSet,
  serializeTestSliceManifest,
  shouldUseSliceVerificationForTasks,
  stageFileAtomic,
  type TestSliceManifestSlice,
  type TestSliceManifestV1,
  type TestSliceViolation,
} from '../lib/test-slice-manifest.js';

export type SlicePlanErrorCode =
  | 'SLICE_PLAN_NO_ACTIVE_CHANGE'
  | 'SLICE_PLAN_INPUT_INVALID'
  | 'SLICE_PLAN_DUPLICATE_SLICE_ID'
  | 'SLICE_PLAN_UNKNOWN_TEST_ID'
  | 'SLICE_PLAN_ARTIFACT_INVALID';

export class SlicePlanError extends Error {
  /**
   * `violations` 只在产物被判定不合法时非空——它们由读取侧同一 validator 产出，
   * 必须**原样带出**（逐条保留 code / path / message / fix_hint、顺序稳定）：
   * 折叠为一句摘要等于把一个当轮可自愈的失败升级为停点（功能规格 §2.78.3）。
   */
  constructor(
    readonly code: SlicePlanErrorCode,
    message: string,
    readonly violations: TestSliceViolation[] = [],
  ) {
    super(message);
    this.name = 'SlicePlanError';
  }
}

/**
 * 退出码分级（功能规格 §2.78.3）：产物非法为 2，操作错误为 1。
 * 对只判断「是否非零」的既有消费方零影响。
 */
export function slicePlanExitCode(code: SlicePlanErrorCode): 1 | 2 {
  return code === 'SLICE_PLAN_ARTIFACT_INVALID' ? 2 : 1;
}

/**
 * 把读取侧 violation 的稳定码映射为写入口的稳定错误码（identity 保留在 `violations` 里）。
 *
 * 这不是第二套判据——判定完全由 validator 完成，本函数只为既有消费方保留可分派的顶层码。
 */
function slicePlanCodeFor(violations: TestSliceViolation[]): SlicePlanErrorCode {
  const codes = new Set(violations.map(item => item.code));
  if (codes.has('test-slice-id-duplicate')) return 'SLICE_PLAN_DUPLICATE_SLICE_ID';
  if (codes.has('test-slice-test-id-unknown') || codes.has('test-slice-test-id-missing')
    || codes.has('test-slice-test-id-duplicate')) return 'SLICE_PLAN_UNKNOWN_TEST_ID';
  return 'SLICE_PLAN_ARTIFACT_INVALID';
}

const ARRAY_FIELDS = ['owned_test_ids', 'runner_selectors', 'spec_targets'] as const;

/** 纯类型守卫：数组是否为字符串数组（空数组由读取侧判据裁决，不在此拦截）。 */
function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/**
 * 解析结构化 `slices.json`——**只做纯输入形状检查**（功能规格 §2.78.1）。
 *
 * 保留在此的判据仅限「连产物都构造不出来」的前置：输入是合法 JSON、`slices` 是非空数组、
 * 各字段类型正确。`slice_id` 词法与唯一性、`task_text` 非空、数组字段非空、`owned_test_ids`
 * 归属与真实性、`spec_targets` 路径前缀——**一律交读取侧同一 validator 判定**
 * （{@link collectSliceManifestViolations}），写入口不得再抄一份。
 */
export function parseSlicesInput(raw: string): TestSliceManifestSlice[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID',
      `slices 输入不是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  const rows = Array.isArray(value) ? value : (value as { slices?: unknown })?.slices;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID', 'slices 必须是非空数组（或含非空 slices 键的对象）');
  }

  return rows.map((row, index) => {
    const item = row as Record<string, unknown>;
    if (typeof item.slice_id !== 'string') {
      throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID', `slices[${index}].slice_id 必须是字符串`);
    }
    for (const field of ARRAY_FIELDS) {
      if (!stringArray(item[field])) {
        throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID',
          `slices[${index}].${field} 必须是字符串数组`);
      }
    }
    if (typeof item.task_text !== 'string') {
      throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID', `slices[${index}].task_text 必须是字符串`);
    }
    return {
      slice_id: item.slice_id,
      task_text: item.task_text,
      owned_test_ids: item.owned_test_ids as string[],
      runner_selectors: item.runner_selectors as string[],
      spec_targets: item.spec_targets as string[],
    } as TestSliceManifestSlice;
  });
}

/**
 * 旧 `[code]` 段中「该条目文本是否**无歧义地已勾选**」（功能规格 §2.68.5）。
 *
 * 同一文本出现多次且状态不一致时判未勾选——本规则的安全侧统一为「有疑即未完成」，
 * 绝不把不确定读成已完成。
 */
export function parseCodeSectionCheckState(codeSectionRaw: string): Map<string, boolean> {
  const seen = new Map<string, boolean>();
  for (const line of codeSectionRaw.split(/\r?\n/)) {
    const m = /^- \[([ xX])\]\s+(\S.*)$/.exec(line);
    if (!m) continue;
    const text = m[2].trimEnd();
    const checked = m[1] !== ' ';
    seen.set(text, seen.has(text) ? (seen.get(text)! && checked) : checked);
  }
  return seen;
}

/**
 * 逐 `slice_id` 决定新 `[code]` 条目的勾选状态（功能规格 §2.68.5、根规范 §2.3）。
 *
 * 判据是 `task_text` **逐字相等**：内容没变则既有进度仍然可信；变了或是新增切片则重置为
 * 未勾选。旧 manifest 在盘时以其 `slice_id → task_text` 映射为准（`slice_id` 是稳定身份）；
 * 缺失或不可解析时——manifest missing 的恢复正是此形态——退化为直接在旧 `[code]` 段中查找
 * 同文本条目，判据仍是同一条。
 *
 * 保留由**写入者构造性完成**：不设开关、不由调用方或 Agent 纪律兜底（根规范 §2.2）。
 */
export function resolveRetainedCheckState(
  slices: TestSliceManifestSlice[],
  oldCodeSectionRaw: string,
  oldManifestSlices: ReadonlyArray<{ slice_id?: unknown; task_text?: unknown }> | null,
): boolean[] {
  const checkedByText = parseCodeSectionCheckState(oldCodeSectionRaw);
  const oldTextById = new Map<string, string>();
  for (const row of oldManifestSlices ?? []) {
    if (typeof row?.slice_id === 'string' && typeof row?.task_text === 'string') {
      oldTextById.set(row.slice_id, row.task_text);
    }
  }
  return slices.map(slice => {
    // 旧 manifest 可用：只有该 slice_id 此前就是逐字相同的 task_text 才谈得上保留。
    if (oldManifestSlices !== null && oldTextById.get(slice.slice_id) !== slice.task_text) return false;
    return checkedByText.get(slice.task_text) === true;
  });
}

/** 由切片数组渲染 `[code]` 段正文；task_text 逐字进入 checkbox 条目。 */
export function renderCodeSection(slices: TestSliceManifestSlice[], retained: boolean[] = []): string {
  return slices.map((slice, i) => `- [${retained[i] ? 'x' : ' '}] ${slice.task_text}`).join('\n');
}

/** 读在盘旧 manifest 的 `slices` 数组；文件缺失或不可解析返回 null（触发文本回退判据）。 */
function readOldManifestSlices(manifestPath: string): Array<Record<string, unknown>> | null {
  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { slices?: unknown };
    return Array.isArray(parsed?.slices) ? parsed.slices as Array<Record<string, unknown>> : null;
  } catch {
    return null;
  }
}

export interface SlicePlanResult {
  slug: string;
  slice_count: number;
  slice_ids: string[];
  task_fingerprint: string;
  spec_fingerprint: string;
  manifest_path: string;
}

function resolveActiveProposal(root: string, explicitSlug?: string): { slug: string; proposalDir: string } {
  let slug = explicitSlug;
  if (!slug) {
    try {
      const guard = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8')) as Record<string, unknown>;
      slug = typeof guard.activeChange === 'string' ? guard.activeChange : undefined;
    } catch { /* 下方统一报错 */ }
  }
  if (!slug) throw new SlicePlanError('SLICE_PLAN_NO_ACTIVE_CHANGE', '未找到活跃变更提案');
  const proposalDir = join(root, 'logos', 'changes', slug);
  if (!existsSync(proposalDir)) {
    throw new SlicePlanError('SLICE_PLAN_NO_ACTIVE_CHANGE', `变更提案不存在：${slug}`);
  }
  if (!existsSync(join(proposalDir, 'tasks.md'))) {
    throw new SlicePlanError('SLICE_PLAN_NO_ACTIVE_CHANGE', `提案缺少 tasks.md：${slug}`);
  }
  return { slug, proposalDir };
}

/**
 * 以**读取侧同一判据**判定「即将生效的这一对产物」（根规范 §2.2、功能规格 §2.78.1/§2.78.2）。
 *
 * 判定输入是临时文件的内容，不是在盘旧字节。归属对账（变更 ID 是否恰好全部归属）只在
 * 该对产物**生效后切片验证确实启用**、且 change set 可信时进行——这与读取侧的启用条件
 * 逐字相同，故两侧对同一对产物给出同一结论。
 */
function validateStagedArtifacts(
  root: string,
  proposalDir: string,
  slug: string,
  tasksTemp: string,
  manifestTemp: string,
): TestSliceViolation[] {
  const tasksContent = readFileSync(tasksTemp, 'utf8');
  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(readFileSync(manifestTemp, 'utf8'));
  } catch (error) {
    return [{
      code: 'test-slice-manifest-invalid', path: '$',
      message: `manifest 无法严格解析：${String(error)}`,
      fix_hint: '修复 JSON 或由 slice-planner 原子重建。',
    }];
  }
  let changedTestIds: string[] | null = null;
  if (shouldUseSliceVerificationForTasks(tasksContent)) {
    const changeSet = readTestChangeSet(root, proposalDir, { change: slug, module: 'core' });
    if (changeSet.valid) changedTestIds = changeSet.value.changed_test_ids;
  }
  return collectSliceManifestViolations({
    root, manifestRaw, tasksContent,
    expected: { change: slug, module: 'core' },
    changedTestIds,
  }).violations;
}

/**
 * 一次性完成切片规划落盘。校验全部前置于写入——任一失败时 tasks.md 与 manifest
 * 均未被触碰（零副作用）。重复执行幂等：同一输入得到同一 [code] 与同一 manifest。
 */
export function planSlices(root: string, slicesFile: string, explicitSlug?: string): SlicePlanResult {
  const { slug, proposalDir } = resolveActiveProposal(root, explicitSlug);
  const inputPath = isAbsolute(slicesFile) ? slicesFile : resolve(root, slicesFile);
  if (!existsSync(inputPath)) {
    throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID', `slices 文件不存在：${slicesFile}`);
  }

  const slices = parseSlicesInput(readFileSync(inputPath, 'utf8'));

  const tasksPath = join(proposalDir, 'tasks.md');
  const manifestPath = join(proposalDir, TEST_SLICE_MANIFEST);
  // 整节替换会丢弃旧 body，故勾选状态必须在覆盖**之前**从旧 [code] 与旧 manifest 读出（§2.68.5）。
  // 初次规划无旧条目也无旧 manifest → retained 全 false，与本能力上线前逐字节一致。
  const oldTasks = readFileSync(tasksPath, 'utf8');
  const retained = resolveRetainedCheckState(slices, extractCodeSectionRaw(oldTasks), readOldManifestSlices(manifestPath));
  const nextTasks = replaceCodeSectionBody(oldTasks, renderCodeSection(slices, retained));

  // 指纹依**即将生效的** tasks.md 计算：写入者与指纹计算者同一方、同一时刻，漂移窗口从构造上消失。
  const specTargets = [...new Set(slices.flatMap(slice => slice.spec_targets))].sort();
  let specFingerprint: string;
  try {
    specFingerprint = computeSpecFingerprint(root, specTargets);
  } catch {
    // spec_targets 路径违规（越界 / 不存在）——判据仍归读取侧，此处只给一个可算的占位，
    // 让 validator 以「非法或不存在的测试规格路径」原样点名，而不是抛裸异常。
    specFingerprint = `sha256:${'0'.repeat(64)}`;
  }
  const manifest: TestSliceManifestV1 = {
    schema: TEST_SLICE_SCHEMA,
    change: slug,
    module: 'core',
    task_fingerprint: computeTaskFingerprint(nextTasks),
    spec_fingerprint: specFingerprint,
    generated_at: new Date().toISOString(),
    slices,
  };

  // ── fail-closed 落盘（根规范 §2.2.1 / §10，功能规格 §2.78.2）──
  // 两产物先各写同目录临时文件并 fsync/关闭；随后以**读取侧同一判据**对「即将生效的这一对
  // 产物」整体判定；全过才逐一原子 rename，任一不过即删除临时文件——正式产物字节零改写。
  // 禁止先以普通写入提交 tasks.md 再写 manifest：那条路径下 manifest 非法时 tasks.md 已被
  // 改写且无从恢复，直接违反 §2.2「两产物的原子一致性」。
  const tasksTemp = stageFileAtomic(tasksPath, Buffer.from(nextTasks, 'utf8'));
  let manifestTemp: string | null = null;
  try {
    manifestTemp = stageFileAtomic(manifestPath, serializeTestSliceManifest(manifest));
    const violations = validateStagedArtifacts(root, proposalDir, slug, tasksTemp, manifestTemp);
    if (violations.length > 0) {
      throw new SlicePlanError(slicePlanCodeFor(violations),
        `切片产物未通过校验，两产物均未落盘（${violations.length} 条违规）`, violations);
    }
    commitStagedFile(tasksTemp, tasksPath);
    commitStagedFile(manifestTemp, manifestPath);
    manifestTemp = null;
  } finally {
    if (manifestTemp !== null) discardStagedFile(manifestTemp);
    discardStagedFile(tasksTemp);
  }

  return {
    slug,
    slice_count: slices.length,
    slice_ids: slices.map(slice => slice.slice_id),
    task_fingerprint: manifest.task_fingerprint,
    spec_fingerprint: manifest.spec_fingerprint,
    manifest_path: `logos/changes/${slug}/${TEST_SLICE_MANIFEST}`,
  };
}

export function sliceCommand(sub: string | undefined, args: string[], format: OutputFormat = 'text'): void {
  if (sub !== 'plan') {
    console.error('Usage: openlogos slice plan --file <slices.json> [--slug <slug>] [--format json]');
    process.exit(1);
  }
  const fileIndex = args.indexOf('--file');
  const slugIndex = args.indexOf('--slug');
  const slicesFile = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  if (!slicesFile) {
    console.error('Error: openlogos slice plan 需要 --file <slices.json>');
    process.exit(1);
  }
  try {
    const result = planSlices(process.cwd(), slicesFile, slugIndex >= 0 ? args[slugIndex + 1] : undefined);
    if (format === 'json') {
      console.log(JSON.stringify(makeEnvelope('slice plan', result)));
      return;
    }
    console.log(`\n✓ 切片规划已写入 ${result.slug}`);
    console.log(`  切片数：${result.slice_count}`);
    for (const id of result.slice_ids) console.log(`    - ${id}`);
    console.log(`  manifest：${result.manifest_path}`);
    console.log(`  task_fingerprint：${result.task_fingerprint}`);
    console.log('\n下一步：批准切片划分（slice-exit）后开始实现代码。');
  } catch (error) {
    const code = error instanceof SlicePlanError ? error.code : 'SLICE_PLAN_INPUT_INVALID';
    const message = error instanceof Error ? error.message : String(error);
    const violations = error instanceof SlicePlanError ? error.violations : [];
    if (format === 'json') {
      // 违规明细原样进结构化输出：消费方靠 code / path / fix_hint 定位，不得只拿到一句摘要。
      const envelope = { ...makeErrorEnvelope('slice plan', code, message) } as unknown as Record<string, unknown>;
      if (violations.length > 0) envelope.violations = violations;
      console.error(JSON.stringify(envelope));
    } else {
      console.error(`Error: [${code}] ${message}`);
      // 人读模式同样逐条原样输出：这些明细已带 fix_hint，是当轮自愈的全部所需（§2.78.3）。
      for (const item of violations) {
        console.error(`  - [${item.code}] ${item.path}：${item.message}`);
        console.error(`    修复：${item.fix_hint}`);
      }
      if (violations.length > 0) {
        console.error('  两产物均未落盘：tasks.md 与 TEST_SLICE_MANIFEST.json 字节保持本次调用前状态。');
      }
    }
    process.exit(slicePlanExitCode(code));
  }
}
