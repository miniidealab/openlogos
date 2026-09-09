#!/usr/bin/env node
/**
 * SMOKE-core-200..202 — 切片 checkpoint 身份绑定的**安装态**取证。
 *
 * 缺陷只在安装态发作：RunLogos 等宿主调用的是**全局** `openlogos verify` / `next`，
 * 仓库内改完不重新打包安装，宿主拿到的仍是旧判定。故本 runner 一律穿过全局 CLI，
 * 只读 `--format json` 结构化输出，不解析文本渲染（功能规格 §2.77；根规范
 * `spec/test-slice-manifest.md` §6.1～§6.3、§8、§11）。
 *
 * 执行边界（已合并 smoke 规格「二、执行边界」）：
 *   - 全部读写只发生在 `mktemp -d` 的一次性项目内，结束即删除；
 *   - **不得**触碰本机全局 prefix（本 runner 不执行任何 npm 安装/卸载）与本仓活跃提案；
 *   - 命令图中不出现 npm publish / dist-tag / git tag / gh release / git push。
 *
 * SMOKE-core-200 与 SMOKE-core-201 **必须成对**评估：只过 200 而 201 失败，等于身份函数
 * 退化成常量——那是实现缺陷，不是环境问题，一律判 FAIL 并停止部署。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const CHECKPOINT_IDENTITY_SMOKE_IDS = ['SMOKE-core-200', 'SMOKE-core-201', 'SMOKE-core-202'];
const ENVIRONMENT = 'local-global-temp-project';
const SLUG = 'checkpoint-identity-demo';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';
const SPEC_BEFORE = '| ID | 描述 |\n|---|---|\n';
const SPEC_AFTER = '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');

const SLICES = [
  {
    slice_id: 'slice-01-alpha', task_text: '切片1：实现 alpha（覆盖 UT-S01-01）',
    owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL],
  },
  {
    slice_id: 'slice-02-beta', task_text: '切片2：实现 beta（覆盖 UT-S01-02）',
    owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL],
  },
];

const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '（本段在 plan 段留空。）', '',
  '## [deploy] 部署执行', '', '- [ ] 无。', '',
].join('\n');

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: CHECKPOINT_IDENTITY_SMOKE_IDS,
    environment: ENVIRONMENT,
    // 候选身份随 LOCAL_RELEASE_CANDIDATE_VERSION 移动；本 runner 不写死任何版本字面量。
    candidate_version_source: 'cli/dist/lib/local-release-candidate.js',
    paired_ids: ['SMOKE-core-200', 'SMOKE-core-201'],
    public_release_commands: [],
  }));
  process.exit(0);
}

/**
 * 结果先在内存定稿、退出前一次性落盘：每个 owned ID **恰好一条**记录。
 *
 * 边跑边 append 会让「200 先 pass、201 再失败」在账本里留下互相矛盾的两条——而按已合并
 * smoke 规格，这两条必须**成对**评估：只过其一即说明绑定对象仍然错误，200 也应判 FAIL。
 */
const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of CHECKPOINT_IDENTITY_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: 0,
      environment: ENVIRONMENT, detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

const run = (cmd, args, cwd = repoRoot) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000 });

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout;
}

const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);
const cliJson = (entry, cwd, args) => JSON.parse(cli(entry, cwd, [...args, '--format', 'json']));
/**
 * 只取结构化输出，**不以退出码为准**。
 *
 * `verify` 在夹具项目里没有测试结果，必然非零退出——但它的 envelope 仍携带本用例要读的
 * 切片派生。已合并 smoke 规格要求「判定一律读命令的 `--format json` 结构化输出」，
 * 故此处按输出判定，而不是把「命令失败」误当成「派生不可读」。
 */
function cliJsonLenient(entry, cwd, args) {
  const r = run(cliBin(entry), cliArgs(entry, [...args, '--format', 'json']), cwd);
  const raw = (r.stdout || '').trim() || (r.stderr || '').trim();
  const line = raw.split('\n').find(item => item.trim().startsWith('{'));
  if (!line) throw new Error(`openlogos ${args.join(' ')} 未输出结构化 envelope：${raw.slice(0, 300)}`);
  return JSON.parse(line);
}

function commandLookup() {
  const r = process.platform === 'win32'
    ? run('where', ['openlogos'])
    : run('/bin/sh', ['-lc', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

/** 候选版本取自仓库常量单点，不在本 runner 内重复钉死版本字面量。 */
function candidateVersion() {
  const path = join(repoRoot, 'cli/dist/lib/local-release-candidate.js');
  if (!existsSync(path)) return null;
  const m = /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(path, 'utf8'));
  return m ? m[1] : null;
}

/** 隔离临时项目：launched 模块 + 活跃提案 + spec-complete，全部经全局 CLI 建立。 */
function scaffold(entry) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-ckid-'));
  cli(entry, base, ['init', 'ckid-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'logos', 'resources', 'test'), { recursive: true });
  writeFileSync(join(base, SPEC_REL), SPEC_AFTER);
  cli(entry, base, ['change', SLUG]);

  const dir = join(base, 'logos', 'changes', SLUG);
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  // change set 由**安装态包自己的**库构造，与被测 CLI 同源；不手工拼哈希。
  const pkgRoot = packageRoot(entry);
  const req = createRequire(join(pkgRoot, 'package.json'));
  const { buildTestChangeSet } = req(join(pkgRoot, 'dist', 'lib', 'test-change-set.js'));
  writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'merge_complete',
    completed_at: new Date().toISOString(),
    test_change_set: buildTestChangeSet({
      change: SLUG,
      module: 'core',
      targets: [{
        targetPath: SPEC_REL,
        beforeBytes: Buffer.from(SPEC_BEFORE, 'utf8'),
        afterBytes: Buffer.from(SPEC_AFTER, 'utf8'),
      }],
    }),
  }, null, 2)}\n`);

  const slicesPath = join(base, 'slices.json');
  writeFileSync(slicesPath, JSON.stringify({ slices: SLICES }, null, 2));
  return { base, dir, slicesPath, manifest: join(dir, 'TEST_SLICE_MANIFEST.json'), ledger: join(dir, 'SLICE_CHECKPOINTS.jsonl') };
}

/** 从全局 CLI 的结构化输出里取切片派生（next / verify 同一形态）。 */
function sliceDerivation(payload) {
  const seen = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (Array.isArray(node.confirmed_slice_ids)) seen.push(node);
    Object.values(node).forEach(walk);
  };
  walk(payload);
  if (seen.length === 0) throw new Error('结构化输出中缺少切片派生（confirmed_slice_ids）');
  return seen[0];
}

const codeEntries = tasksPath => readFileSync(tasksPath, 'utf8')
  .split('\n').filter(line => /^- \[[ xX]\]/.test(line));

/** 用安装态 CLI 自己的身份函数写一条真实 PASS checkpoint（不伪造格式）。 */
function appendPassCheckpoint(entry, fx, base) {
  const pkgRoot = packageRoot(entry);
  const req = createRequire(join(pkgRoot, 'package.json'));
  const lib = req(join(pkgRoot, 'dist', 'lib', 'test-slice-manifest.js'));
  const state = lib.deriveSliceVerificationState(base, fx.dir, { change: SLUG, module: 'core' });
  if (!state || state.verify_mode !== 'slice-checkpoint') {
    throw new Error(`未进入 slice-checkpoint 增量验收：${JSON.stringify(state?.reason ?? state)}`);
  }
  if (!lib.appendSliceCheckpoint(fx.dir, state, 'PASS')) throw new Error('checkpoint 写入失败');
  return { lib, state };
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const entry = commandLookup();
if (!entry) {
  exitNotApplicable(CHECKPOINT_IDENTITY_SMOKE_IDS, {
    reason: '本机未安装全局 openlogos——安装态取证不适用',
    missing: ['global:openlogos'],
    environment: ENVIRONMENT,
    repoRoot,
  });
}
const globalVersion = cli(entry, repoRoot, ['--version']).trim();
const expected = candidateVersion();
if (!expected || !globalVersion.includes(expected)) {
  exitNotApplicable(CHECKPOINT_IDENTITY_SMOKE_IDS, {
    reason: `全局 openlogos 尚未是本次候选（期望 ${expected ?? '<未知>'}，实际 ${globalVersion}）——请先完成 [deploy] 全局安装`,
    missing: ['global-candidate-installed'],
    environment: ENVIRONMENT,
    repoRoot,
  });
}

const scopes = [];
let pairedFailure = null;
try {
  const fx = scaffold(entry);
  scopes.push(fx.base);
  const evidence = [`entry=${entry}`, `version=${globalVersion}`, `project=${fx.base}`];

  // ── SMOKE-core-200：安装态恢复重跑保住 checkpoint 账本 ──
  // ① 规划两片
  cli(entry, fx.base, ['slice', 'plan', '--file', fx.slicesPath]);
  const manifestBefore = readFileSync(fx.manifest, 'utf8');
  // ② 为切片 1 追加一条真实 PASS checkpoint 并勾选该条目
  appendPassCheckpoint(entry, fx, fx.base);
  const tasksPath = join(fx.dir, 'tasks.md');
  writeFileSync(tasksPath, readFileSync(tasksPath, 'utf8')
    .replace(`- [ ] ${SLICES[0].task_text}`, `- [x] ${SLICES[0].task_text}`));
  const ledgerAfterFirst = readFileSync(fx.ledger);
  const firstRow = JSON.parse(ledgerAfterFirst.toString('utf8').trim().split('\n')[0]);
  if (firstRow.schema !== 'openlogos/slice-checkpoint@2') {
    throw new Error(`新写入未升至 @2：${firstRow.schema}`);
  }
  // ③ 删除 manifest；④ 以逐字相同的 slices.json 重跑
  rmSync(fx.manifest);
  cli(entry, fx.base, ['slice', 'plan', '--file', fx.slicesPath]);
  const manifestAfter = readFileSync(fx.manifest, 'utf8');
  if (!codeEntries(tasksPath)[0].startsWith('- [x]')) throw new Error('恢复后 [code] 首条勾选未保留');
  if (manifestAfter === manifestBefore) throw new Error('manifest 未真正重建（generated_at 应不同）');
  // ⑤ 全局 next 的切片派生
  const recovered = sliceDerivation(cliJson(entry, fx.base, ['next']));
  const keptLedger = readFileSync(fx.ledger);
  if (!keptLedger.equals(ledgerAfterFirst)) throw new Error('账本被改写——slice plan 不得触碰 SLICE_CHECKPOINTS.jsonl');
  if (!recovered.confirmed_slice_ids.includes('slice-01-alpha')) {
    throw new Error(`恢复后切片 1 未被采信：confirmed=${JSON.stringify(recovered.confirmed_slice_ids)}`);
  }
  if (recovered.attempted_slice_id !== 'slice-02-beta') {
    throw new Error(`恢复后前沿应指向切片 2，实为 ${recovered.attempted_slice_id}`);
  }
  record('SMOKE-core-200', 'pass',
    `恢复重跑后 confirmed=${JSON.stringify(recovered.confirmed_slice_ids)}、前沿=${recovered.attempted_slice_id}；账本字节未变`,
    [...evidence, `manifest_sha_before=${sha256(manifestBefore)}`, `manifest_sha_after=${sha256(manifestAfter)}`]);

  // ── SMOKE-core-201：安装态重划作废旧账本（与 200 互为反例）──
  try {
    const replanned = [{ ...SLICES[0], task_text: '切片1：实现 alpha v2（覆盖 UT-S01-01）' }, SLICES[1]];
    writeFileSync(fx.slicesPath, JSON.stringify({ slices: replanned }, null, 2));
    cli(entry, fx.base, ['slice', 'plan', '--file', fx.slicesPath]);
    const replan = sliceDerivation(cliJson(entry, fx.base, ['next']));
    if (replan.confirmed_slice_ids.length !== 0) {
      throw new Error(`重划后旧账本仍被采信：confirmed=${JSON.stringify(replan.confirmed_slice_ids)}——身份函数疑似退化为常量`);
    }
    if (replan.attempted_slice_id !== 'slice-01-alpha') {
      throw new Error(`重划后前沿应回到第一片，实为 ${replan.attempted_slice_id}`);
    }
    const afterReplanLedger = readFileSync(fx.ledger);
    if (!afterReplanLedger.subarray(0, ledgerAfterFirst.length).equals(ledgerAfterFirst)) {
      throw new Error('账本历史行被删除或重写——账本必须 append-only');
    }
    record('SMOKE-core-201', 'pass', '重划后 confirmed 变空、前沿回到第一片；账本历史行未被改写', evidence);
  } catch (error) {
    pairedFailure = error;
    throw error;
  }

  // ── SMOKE-core-202：安装态混合账本按行 schema 分派 ──
  // 复位到与 200 相同的划分，使既有 @2 行重新匹配当前身份。
  writeFileSync(fx.slicesPath, JSON.stringify({ slices: SLICES }, null, 2));
  cli(entry, fx.base, ['slice', 'plan', '--file', fx.slicesPath]);
  const fileSha = `sha256:${sha256(readFileSync(fx.manifest))}`;
  const eligibleSha = JSON.parse(readFileSync(fx.ledger, 'utf8').trim().split('\n')[0]).eligible_test_ids_sha256;
  const row = (schema, sliceId, sha) => `${JSON.stringify({
    schema, slice_id: sliceId, manifest_sha256: sha, result: 'PASS',
    eligible_test_ids_sha256: eligibleSha, timestamp: new Date().toISOString(),
  })}\n`;
  // 人为并存一条 @1 行（其 manifest_sha256 为当前 manifest 的**文件字节**哈希）。
  appendFileSync(fx.ledger, row('openlogos/slice-checkpoint@1', 'slice-02-beta', fileSha));
  const mixedNext = cliJsonLenient(entry, fx.base, ['next']);
  const mixedVerify = cliJsonLenient(entry, fx.base, ['verify']);
  for (const [label, state] of [['next', sliceDerivation(mixedNext)], ['verify', sliceDerivation(mixedVerify)]]) {
    for (const id of ['slice-01-alpha', 'slice-02-beta']) {
      if (!state.confirmed_slice_ids.includes(id)) {
        throw new Error(`${label} 混合账本未按行分派：${id} 未被采信（confirmed=${JSON.stringify(state.confirmed_slice_ids)}）`);
      }
    }
  }
  // 再注入一条未知主版本行 → 不被采信，且不产生 violation、不中断命令。
  //
  // 判据是**与注入前逐项对照**，不是「输出里没有任何 violation」：夹具本身可能带与本用例
  // 无关的诊断（如 [code] 未勾完时的 slice-task-state-inconsistent）。只有「注入前后完全
  // 一致」才真正说明这一行既没被采信、也没牵连任何其他判定。
  const beforeViolations = JSON.stringify(sliceDerivation(mixedNext).violations ?? []);
  appendFileSync(fx.ledger, row('openlogos/slice-checkpoint@9', 'slice-01-alpha', fileSha));
  const unknownState = sliceDerivation(cliJsonLenient(entry, fx.base, ['next']));
  for (const id of ['slice-01-alpha', 'slice-02-beta']) {
    if (!unknownState.confirmed_slice_ids.includes(id)) {
      throw new Error(`未知主版本行牵连了其余行：confirmed=${JSON.stringify(unknownState.confirmed_slice_ids)}`);
    }
  }
  const afterViolations = JSON.stringify(unknownState.violations ?? []);
  if (afterViolations !== beforeViolations) {
    throw new Error(`未知 checkpoint 主版本改变了诊断集合：注入前 ${beforeViolations} → 注入后 ${afterViolations}`);
  }
  record('SMOKE-core-202', 'pass', '混合账本 @1/@2 各按其 schema 采信；未知主版本不采信且不产生 violation、不中断', evidence);

  console.log('checkpoint 身份绑定安装态 smoke 全部通过');
} catch (error) {
  const message = String(error instanceof Error ? error.message : error);
  for (const id of CHECKPOINT_IDENTITY_SMOKE_IDS) {
    if (results.get(id)?.status === 'pass' && !(pairedFailure && id === 'SMOKE-core-200')) continue;
    // 200/201 成对：201 失败即把已 pass 的 200 一并改判 FAIL，绝不让「只过其一」读成部分成功。
    record(id, 'fail', pairedFailure && id === 'SMOKE-core-200'
      ? `与 SMOKE-core-201 成对失败（只过 200 说明身份函数疑似退化为常量）：${message}`
      : message);
  }
  console.error(message);
  process.exitCode = 1;
} finally {
  flush();
  for (const dir of scopes) rmSync(dir, { recursive: true, force: true });
}
