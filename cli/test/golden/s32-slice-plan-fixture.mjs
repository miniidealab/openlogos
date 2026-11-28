/**
 * verify-scope-fields-and-slice-module 切片 1 的夹具辅助：切片规划的目标提案与模块（功能规格 §2.110）。
 * 建在 S13 夹具 LV / LV-mod 之上（记录型入口、调用记录在项目外）。
 *
 * 夹具 SM：多模块（core、backend、web，各自声明 paths 且各有命令组；分层关闭）。活跃提案登记在 backend：
 * guard 的 module 为 backend，SPEC_MERGED.test_change_set.module 为 backend，变更用例 UT-S05-03、04、05。
 * 切片输入 slices.json：slice-a 拥有 UT-S05-03，slice-b 拥有 UT-S05-04、05。
 * 提案名取 S13 夹具的固定值（SLUG = lv-demo），对应测试规格中的 sm-demo。
 *
 * 作为脚本运行时生成 UT-S32-133 的 golden：
 *   node cli/test/golden/s32-slice-plan-fixture.mjs <引入前 CLI 的 dist/index.js> <输出 json>
 * 只依赖 CLI 入口与其 lib/test-change-set.js，对引入前、引入后的构建都能运行。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SLUG, createLv, destroyLv, lvEnv } from './s13-layered-fixture.mjs';

export const SM_CHANGED = ['UT-S05-03', 'UT-S05-04', 'UT-S05-05'];
export const SM_TARGET = 'logos/resources/test/backend-S05-test-cases.md';
export const CORE_CHANGED = ['UT-S90-01', 'UT-S90-02', 'UT-S90-03'];
export const CORE_TARGET = 'logos/resources/test/core-S90-test-cases.md';
const MANIFEST = 'TEST_SLICE_MANIFEST.json';

export const taskText = (n, name, ids) => `切片${n}：能力 ${name}（覆盖 ${ids.join('、')}）`;

/** 规划前的 tasks.md：[code] 段为占位，由 slice plan 写入切片条目。 */
export const PLACEHOLDER_TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '', '## [code] 代码实现',
  '（由 slice plan 写入）', '',
].join('\n');

export function sliceInput(a, b, specTarget) {
  return { slices: [
    { slice_id: 'slice-a', task_text: taskText(1, 'a', a), owned_test_ids: a, runner_selectors: a, spec_targets: [specTarget] },
    { slice_id: 'slice-b', task_text: taskText(2, 'b', b), owned_test_ids: b, runner_selectors: b, spec_targets: [specTarget] },
  ] };
}

/** 夹具 SM：提案登记在 backend 的多模块项目；opts 透传给 createLv。 */
export function createSm(buildTestChangeSet, opts = {}) {
  const f = createLv({
    mod: true,
    layered: null,
    buildTestChangeSet,
    change: { target: 'backend-S05-test-cases.md', added: SM_CHANGED },
    tasks: PLACEHOLDER_TASKS,
    ...opts,
  });
  writeSlices(f, 'slices.json', sliceInput(['UT-S05-03'], ['UT-S05-04', 'UT-S05-05'], SM_TARGET));
  return f;
}

/** 单模块夹具：提案登记在 core，变更用例 UT-S90-01～03。 */
export function createCore(buildTestChangeSet, opts = {}) {
  const f = createLv({
    layered: null,
    buildTestChangeSet,
    change: { target: 'core-S90-test-cases.md', added: CORE_CHANGED },
    tasks: PLACEHOLDER_TASKS,
    ...opts,
  });
  writeSlices(f, 'slices.json', sliceInput(['UT-S90-01', 'UT-S90-02'], ['UT-S90-03'], CORE_TARGET));
  return f;
}

/** 切片输入写在项目根（未跟踪文件不影响 slice plan；verify 前由调用方删除或忽略）。 */
export function writeSlices(f, name, input) {
  const path = join(f.root, name);
  writeFileSync(path, JSON.stringify(input, null, 2));
  return path;
}

/** 以真实 CLI 子进程执行 slice plan；JSON 模式下成功信封在 stdout、错误信封在 stderr，各自整体解析。 */
export function runSlicePlan(cliEntry, f, args) {
  const r = spawnSync(process.execPath, [resolve(cliEntry), 'slice', 'plan', ...args], {
    cwd: f.root, encoding: 'utf8', timeout: 60_000, env: lvEnv(f),
  });
  const parse = text => { try { return JSON.parse((text ?? '').trim()); } catch { return null; } };
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: parse(r.stdout), err: parse(r.stderr) };
}

export const tasksPath = (f, slug = SLUG) => join(f.root, 'logos/changes', slug, 'tasks.md');
export const manifestPath = (f, slug = SLUG) => join(f.root, 'logos/changes', slug, MANIFEST);
export const readManifest = (f, slug = SLUG) => (existsSync(manifestPath(f, slug)) ? JSON.parse(readFileSync(manifestPath(f, slug), 'utf8')) : null);

/** 去掉随调用变化的值：generated_at、信封的版本与时间、临时目录。 */
export function normalizePlan(f, run) {
  const strip = text => text.split(f.root).join('<ROOT>');
  const manifest = readManifest(f);
  if (manifest) delete manifest.generated_at;
  return {
    status: run.status,
    data: run.out?.data ? JSON.parse(strip(JSON.stringify(run.out.data))) : null,
    tasks: existsSync(tasksPath(f)) ? readFileSync(tasksPath(f), 'utf8') : null,
    manifest,
  };
}

/** UT-S32-133 的观测：core 模块提案执行 slice plan 后的 stdout data、tasks.md 与清单（generated_at 除外）。 */
export function observeCorePlan(cliEntry, buildTestChangeSet) {
  const f = createCore(buildTestChangeSet);
  try {
    return normalizePlan(f, runSlicePlan(cliEntry, f, ['--file', 'slices.json', '--format', 'json']));
  } finally {
    destroyLv(f);
  }
}

if (process.argv[1] && process.argv[1].endsWith('s32-slice-plan-fixture.mjs') && process.argv[2] && process.argv[3]) {
  const lib = await import(pathToFileURL(resolve(dirname(process.argv[2]), 'lib/test-change-set.js')).href);
  writeFileSync(process.argv[3], `${JSON.stringify(observeCorePlan(process.argv[2], lib.buildTestChangeSet), null, 2)}\n`);
  console.log(`golden written: ${process.argv[3]}`);
}
