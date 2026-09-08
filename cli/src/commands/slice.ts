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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { OutputFormat } from '../lib/json-output.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import { replaceCodeSectionBody } from '../lib/proposal-lifecycle.js';
import {
  TEST_SLICE_MANIFEST,
  TEST_SLICE_SCHEMA,
  computeSpecFingerprint,
  computeTaskFingerprint,
  extractDefinedVerificationIds,
  writeTestSliceManifestAtomic,
  type TestSliceManifestSlice,
  type TestSliceManifestV1,
} from '../lib/test-slice-manifest.js';

export type SlicePlanErrorCode =
  | 'SLICE_PLAN_NO_ACTIVE_CHANGE'
  | 'SLICE_PLAN_INPUT_INVALID'
  | 'SLICE_PLAN_DUPLICATE_SLICE_ID'
  | 'SLICE_PLAN_UNKNOWN_TEST_ID';

export class SlicePlanError extends Error {
  constructor(readonly code: SlicePlanErrorCode, message: string) {
    super(message);
    this.name = 'SlicePlanError';
  }
}

const SLICE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARRAY_FIELDS = ['owned_test_ids', 'runner_selectors', 'spec_targets'] as const;

function nonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0
    && value.every(item => typeof item === 'string' && item.trim() !== '');
}

/** 解析并校验结构化 slices.json；任一失败即抛错，调用方保证零副作用。 */
export function parseSlicesInput(raw: string, definedTestIds: Set<string>): TestSliceManifestSlice[] {
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

  const seen = new Set<string>();
  return rows.map((row, index) => {
    const item = row as Record<string, unknown>;
    const sliceId = item.slice_id;
    if (typeof sliceId !== 'string' || !SLICE_ID_RE.test(sliceId)) {
      throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID',
        `slices[${index}].slice_id 缺失或非法（须为 kebab-case）`);
    }
    if (seen.has(sliceId)) {
      throw new SlicePlanError('SLICE_PLAN_DUPLICATE_SLICE_ID', `slice_id 在提案内重复：${sliceId}`);
    }
    seen.add(sliceId);
    for (const field of ARRAY_FIELDS) {
      if (!nonEmptyStringArray(item[field])) {
        throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID',
          `slices[${index}].${field} 必须是非空字符串数组`);
      }
    }
    if (typeof item.task_text !== 'string' || item.task_text.trim() === '') {
      throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID', `slices[${index}].task_text 必须是非空字符串`);
    }
    // owned_test_ids 是 verify 计算 eligible 的输入，必须在已合并测试规格中真实存在，
    // 否则 eligible 会含幽灵 ID 并以「缺结果」误红。
    const unknown = (item.owned_test_ids as string[]).filter(id => !definedTestIds.has(id));
    if (unknown.length > 0) {
      throw new SlicePlanError('SLICE_PLAN_UNKNOWN_TEST_ID',
        `slices[${index}] 的 owned_test_ids 含未在已合并测试规格中定义的 ID：${unknown.join('、')}`);
    }
    return {
      slice_id: sliceId,
      task_text: item.task_text,
      owned_test_ids: item.owned_test_ids as string[],
      runner_selectors: item.runner_selectors as string[],
      spec_targets: item.spec_targets as string[],
    } as TestSliceManifestSlice;
  });
}

/** 由切片数组渲染 `[code]` 段正文；task_text 逐字进入 checkbox 条目。 */
export function renderCodeSection(slices: TestSliceManifestSlice[]): string {
  return slices.map(slice => `- [ ] ${slice.task_text}`).join('\n');
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
 * 一次性完成切片规划落盘。校验全部前置于写入——任一失败时 tasks.md 与 manifest
 * 均未被触碰（零副作用）。重复执行幂等：同一输入得到同一 [code] 与同一 manifest。
 */
export function planSlices(root: string, slicesFile: string, explicitSlug?: string): SlicePlanResult {
  const { slug, proposalDir } = resolveActiveProposal(root, explicitSlug);
  const inputPath = isAbsolute(slicesFile) ? slicesFile : resolve(root, slicesFile);
  if (!existsSync(inputPath)) {
    throw new SlicePlanError('SLICE_PLAN_INPUT_INVALID', `slices 文件不存在：${slicesFile}`);
  }

  const defined = new Set(extractDefinedVerificationIds(root));
  const slices = parseSlicesInput(readFileSync(inputPath, 'utf8'), defined);

  // —— 至此全部校验通过，开始写入 ——
  const tasksPath = join(proposalDir, 'tasks.md');
  writeFileSync(tasksPath, replaceCodeSectionBody(readFileSync(tasksPath, 'utf8'), renderCodeSection(slices)));

  // 指纹依**刚写出的** tasks.md 计算：写入者与指纹计算者同一方、同一时刻，漂移窗口从构造上消失。
  const specTargets = [...new Set(slices.flatMap(slice => slice.spec_targets))].sort();
  const manifest: TestSliceManifestV1 = {
    schema: TEST_SLICE_SCHEMA,
    change: slug,
    module: 'core',
    task_fingerprint: computeTaskFingerprint(readFileSync(tasksPath, 'utf8')),
    spec_fingerprint: computeSpecFingerprint(root, specTargets),
    generated_at: new Date().toISOString(),
    slices,
  };
  const manifestPath = join(proposalDir, TEST_SLICE_MANIFEST);
  writeTestSliceManifestAtomic(manifestPath, manifest);

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
    if (format === 'json') console.error(JSON.stringify(makeErrorEnvelope('slice plan', code, message)));
    else console.error(`Error: [${code}] ${message}`);
    process.exit(1);
  }
}
