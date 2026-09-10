#!/usr/bin/env node
/**
 * SMOKE-core-203..205 — `slice plan` 写入侧 fail-closed 与 `change-lint` 阻塞理由自检的**安装态**取证。
 *
 * 缺陷只在安装态发作：RunLogos 等宿主调用的是**全局** `openlogos slice plan` / `change-lint`，
 * 仓库改完不重新打包安装，宿主拿到的仍是旧的 fail-open 写入口。故本 runner 一律穿过全局 CLI，
 * 判定只读 `--format json` 结构化输出与磁盘字节，不以命令自述的成功为准
 * （功能规格 §2.78 / §2.79；根规范 `spec/test-slice-manifest.md` §2.2 / §2.2.1 / §10）。
 *
 * 执行边界（已合并 smoke 规格「二、执行边界」）：
 *   - 全部读写只发生在 `mktemp -d` 的一次性项目内，结束即删除；
 *   - **不得**触碰本机全局 prefix（本 runner 不执行任何 npm 安装/卸载）与本仓活跃提案；
 *   - 命令图中不出现 npm publish / dist-tag / git tag / gh release / git push——本次为本地全局部署。
 *
 * SMOKE-core-203 与 SMOKE-core-204 **必须成对**评估：只过 203 说明收紧过头（合法输入也被拒），
 * 只过 204 说明写入口仍是 fail-open；两者共同界定「单向收紧且不产生新失败面」。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const SLICE_GATE_SMOKE_IDS = ['SMOKE-core-203', 'SMOKE-core-204', 'SMOKE-core-205'];
const ENVIRONMENT = 'local-global-temp-project';
const SLUG = 'slice-gate-failopen-demo';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';
const SPEC_BEFORE = '| ID | 描述 |\n|---|---|\n';
const SPEC_AFTER = '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n';
const FEATURE_REL = 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';

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

/** 事故输入（2026-09-10 实证）：把非测试规格的 merge 目标一并填进 spec_targets，其余各项完全合法。 */
const ACCIDENT_SLICES = [
  { ...SLICES[0], spec_targets: [SPEC_REL, FEATURE_REL] },
  SLICES[1],
];

const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '（本段在 plan 段留空。）', '',
].join('\n');

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: SLICE_GATE_SMOKE_IDS,
    environment: ENVIRONMENT,
    // 候选身份随 LOCAL_RELEASE_CANDIDATE_VERSION 移动；本 runner 不写死任何版本字面量。
    candidate_version_source: 'cli/dist/lib/local-release-candidate.js',
    paired_ids: ['SMOKE-core-203', 'SMOKE-core-204'],
    public_release_commands: [],
  }));
  process.exit(0);
}

/** 结果先在内存定稿、退出前一次性落盘：每个 owned ID **恰好一条**记录。 */
const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of SLICE_GATE_SMOKE_IDS) {
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
const cliRaw = (entry, cwd, args) => run(cliBin(entry), cliArgs(entry, args), cwd);
const cliJson = (entry, cwd, args) => JSON.parse(cli(entry, cwd, [...args, '--format', 'json']));

/** 只取结构化输出，**不以退出码为准**（拒绝态本就非零，其 envelope 仍是要读的事实）。 */
function cliJsonLenient(entry, cwd, args) {
  const r = cliRaw(entry, cwd, [...args, '--format', 'json']);
  const raw = `${(r.stdout || '').trim()}\n${(r.stderr || '').trim()}`;
  const line = raw.split('\n').find(item => item.trim().startsWith('{'));
  if (!line) throw new Error(`openlogos ${args.join(' ')} 未输出结构化 envelope：${raw.slice(0, 300)}`);
  return { status: r.status, payload: JSON.parse(line), stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
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

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** 两产物的字节指纹 + mtime——「零改写」只认磁盘事实。 */
function artifactState(dir) {
  const out = {};
  for (const name of ['tasks.md', 'TEST_SLICE_MANIFEST.json']) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const stat = statSync(path);
    out[name] = { sha: sha256(readFileSync(path)), mtimeMs: stat.mtimeMs, size: stat.size };
  }
  return JSON.stringify(out);
}

const tempLeftovers = dir => readdirSync(dir).filter(name => name.endsWith('.tmp'));

/** 隔离临时项目：launched 模块 + 活跃提案 + spec-complete，全部经全局 CLI 建立。 */
function scaffold(entry, slug = SLUG, options = {}) {
  const { specMerged = true, withDelta = true, codeBody = ['（本段在 plan 段留空。）'] } = options;
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-gate-'));
  cli(entry, base, ['init', 'gate-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'logos', 'resources', 'test'), { recursive: true });
  writeFileSync(join(base, SPEC_REL), SPEC_AFTER);
  mkdirSync(join(base, dirname(FEATURE_REL)), { recursive: true });
  writeFileSync(join(base, FEATURE_REL), '# 功能规格\n\n用于构造「非测试规格路径」的 spec_targets 反例。\n');
  cli(entry, base, ['change', slug]);

  const dir = join(base, 'logos', 'changes', slug);
  // 填写提案正文：模板态提案的 plan package 不 ready，步骤派生会停在 writing，
  // step 级阻塞理由（no_delta_spec_marker_missing）根本不会成立——夹具必须是真形态。
  writeFileSync(join(dir, 'proposal.md'), [
    `# 变更提案：${slug}`, '',
    '> module: core', '',
    '## 变更原因', '安装态取证写入侧 fail-closed 与阻塞理由自检。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：一次性隔离夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '校验前置于任一 rename，自检入口覆盖全部阻塞理由。', '',
    // plan package 必须 ready，否则步骤派生停在 writing，step 级阻塞理由不成立。
    '## 决策澄清', '', '```yaml',
    'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
    'impacts:',
    '  data:', '    status: none', '    reason: 一次性隔离夹具不涉及数据影响',
    '  compatibility:', '    status: none', '    reason: 一次性隔离夹具不涉及兼容性影响',
    '  security_privacy:', '    status: none', '    reason: 一次性隔离夹具不涉及安全或隐私影响',
    '  public_release:', '    status: none', '    reason: 一次性隔离夹具不涉及公开发布',
    '  external_commitment:', '    status: none', '    reason: 一次性隔离夹具不涉及外部承诺',
    'decisions:',
    '  - id: C99', '    category: deployment', '    question: 该夹具是否需要部署？',
    '    answer: 沿用夹具中的部署声明', '    rationale: 仅用于隔离取证',
    '    source: user', '    affects:', '      - proposal', '    rejected_options: []',
    'unresolved: []', 'defaults: []',
    '```', '',
  ].join('\n'));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '',
    ...(withDelta ? ['## [delta] 规格变更', '', '- [x] 产出 delta 文件到 `deltas/test/` — `core-S01-test-cases.md`', ''] : []),
    '## [code] 代码实现', '', ...codeBody, '',
  ].join('\n'));
  if (withDelta) {
    mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'test', 'core-S01-test-cases.md'), `## ADDED — S01 用例\n\n${SPEC_AFTER}`);
  }
  if (specMerged) {
    // change set 由**安装态包自己的**库构造，与被测 CLI 同源；不手工拼哈希。
    const pkgRoot = packageRoot(entry);
    const req = createRequire(join(pkgRoot, 'package.json'));
    const { buildTestChangeSet } = req(join(pkgRoot, 'dist', 'lib', 'test-change-set.js'));
    writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
      type: 'merge_complete',
      completed_at: new Date().toISOString(),
      test_change_set: buildTestChangeSet({
        change: slug, module: 'core',
        targets: [{
          targetPath: SPEC_REL,
          beforeBytes: Buffer.from(SPEC_BEFORE, 'utf8'),
          afterBytes: Buffer.from(SPEC_AFTER, 'utf8'),
        }],
      }),
    }, null, 2)}\n`);
  }
  const legalPath = join(base, 'slices.json');
  writeFileSync(legalPath, JSON.stringify({ slices: SLICES }, null, 2));
  const accidentPath = join(base, 'slices-accident.json');
  writeFileSync(accidentPath, JSON.stringify({ slices: ACCIDENT_SLICES }, null, 2));
  return { base, dir, legalPath, accidentPath, manifest: join(dir, 'TEST_SLICE_MANIFEST.json') };
}

function patchManifest(fx, patch) {
  const manifest = JSON.parse(readFileSync(fx.manifest, 'utf8'));
  patch(manifest);
  writeFileSync(fx.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** 从结构化输出里取阻塞理由（lint 的 violations/warnings 或 next 的派生）。 */
function lintReasons(payload) {
  const data = payload?.data ?? payload;
  const codes = new Set();
  for (const item of data?.violations ?? []) codes.add(item.code);
  for (const item of data?.warnings ?? []) codes.add(item.code);
  return codes;
}

function nextReasons(payload) {
  const seen = new Set();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node.reason === 'string') seen.add(node.reason);
    for (const item of node.violations ?? []) if (item?.code) seen.add(item.code);
    Object.values(node).forEach(walk);
  };
  walk(payload);
  return seen;
}

const entry = commandLookup();
if (!entry) {
  exitNotApplicable(SLICE_GATE_SMOKE_IDS, {
    reason: '本机未安装全局 openlogos——安装态取证不适用',
    missing: ['global:openlogos'],
    environment: ENVIRONMENT,
    repoRoot,
  });
}
const globalVersion = cli(entry, repoRoot, ['--version']).trim();
const expected = candidateVersion();
if (!expected || !globalVersion.includes(expected)) {
  exitNotApplicable(SLICE_GATE_SMOKE_IDS, {
    reason: `全局 openlogos 尚未是本次候选（期望 ${expected ?? '<未知>'}，实际 ${globalVersion}）——请先完成 [deploy] 全局安装`,
    missing: ['global-candidate-installed'],
    environment: ENVIRONMENT,
    repoRoot,
  });
}

/**
 * 能力探针：安装态包里是否已有**写入侧与读取侧共用的单点判据**。
 *
 * 只看版本号不够——版本常量与全局安装在 [deploy] 窗口内分两步移动，其间「号相同、字节是旧的」
 * 是常态。此时若照跑，runner 会把「候选尚未安装」记成 fail，用与被测能力无关的红把 Gate 拉黑
 * （这正是 S19 留痕契约要消除的形态）。故按**能力**判定适用性，版本只作证据。
 */
function candidateCapable() {
  try {
    const pkgRoot = packageRoot(entry);
    const req = createRequire(join(pkgRoot, 'package.json'));
    const lib = req(join(pkgRoot, 'dist', 'lib', 'test-slice-manifest.js'));
    return typeof lib.collectSliceManifestViolations === 'function';
  } catch {
    return false;
  }
}
if (!candidateCapable()) {
  exitNotApplicable(SLICE_GATE_SMOKE_IDS, {
    reason: `全局安装态尚不含写入侧单点判据（collectSliceManifestViolations 缺失，当前 ${globalVersion}）——请先完成 [deploy] 全局安装`,
    missing: ['global-candidate-capability:collectSliceManifestViolations'],
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

  // ── SMOKE-core-203：非法 spec_targets 被写入口拒绝且两产物零改写 ──
  cli(entry, fx.base, ['slice', 'plan', '--file', fx.legalPath]);        // 先建立合法基线
  const before = artifactState(fx.dir);
  const rejected = cliRaw(entry, fx.base, ['slice', 'plan', '--file', fx.accidentPath]);
  const rejectedText = `${rejected.stdout ?? ''}${rejected.stderr ?? ''}`;
  if (rejected.status !== 2) {
    throw new Error(`非法 spec_targets 未被拒绝或退出码不为 2：exit=${rejected.status}；输出=${rejectedText.slice(0, 300)}`);
  }
  if (!/spec_targets/.test(rejectedText) || !/修复|fix_hint/.test(rejectedText)) {
    throw new Error(`拒绝输出未原样携带可定位违规明细：${rejectedText.slice(0, 300)}`);
  }
  const after = artifactState(fx.dir);
  if (after !== before) throw new Error(`拒绝后两产物被改写：\nbefore=${before}\nafter =${after}`);
  const leftovers = tempLeftovers(fx.dir);
  if (leftovers.length > 0) throw new Error(`残留临时文件：${leftovers.join(', ')}`);
  // JSON 通道同样原样携带明细
  const rejectedJson = cliJsonLenient(entry, fx.base, ['slice', 'plan', '--file', fx.accidentPath]);
  const jsonViolations = rejectedJson.payload?.violations ?? [];
  if (!Array.isArray(jsonViolations) || jsonViolations.length === 0
    || !jsonViolations.every(v => v.code && v.path && v.message && v.fix_hint)) {
    throw new Error(`--format json 未逐条携带 code/path/message/fix_hint：${JSON.stringify(jsonViolations).slice(0, 300)}`);
  }
  record('SMOKE-core-203', 'pass',
    `非法 spec_targets 被写入口拒绝（exit 2、${jsonViolations.length} 条违规），两产物字节与 mtime 均未变、无临时文件残留`,
    [...evidence, `artifacts=${before}`]);

  // ── SMOKE-core-204：合法输入零行为变化（与 203 互为反例）──
  try {
    const fixed = cliRaw(entry, fx.base, ['slice', 'plan', '--file', fx.legalPath]);
    if (fixed.status !== 0) {
      throw new Error(`合法输入被拒——收紧越界：exit=${fixed.status}；${(fixed.stderr ?? '').slice(0, 300)}`);
    }
    const planJson = cliJson(entry, fx.base, ['slice', 'plan', '--file', fx.legalPath]);
    const data = planJson.data ?? planJson;
    for (const field of ['slug', 'slice_count', 'slice_ids', 'task_fingerprint', 'spec_fingerprint', 'manifest_path']) {
      if (!(field in data)) throw new Error(`成功输出缺字段 ${field}——五字段口径必须不变`);
    }
    const nextPayload = cliJsonLenient(entry, fx.base, ['next']).payload;
    const reasons = nextReasons(nextPayload);
    if (reasons.has('test-slice-manifest-invalid')) {
      throw new Error('合法产物仍被下游判 invalid——写入侧与读取侧判据未同源');
    }
    record('SMOKE-core-204', 'pass',
      `合法输入 exit 0、五个 data 字段齐备（slice_count=${data.slice_count}）、下游无 test-slice-manifest-invalid`,
      evidence);
  } catch (error) {
    pairedFailure = error;
    throw error;
  }

  // ── SMOKE-core-205：change-lint 覆盖 8 条阻塞理由，且与 next 同结论 ──
  const projectSnapshot = dir => {
    const rows = [];
    const walk = current => {
      for (const name of readdirSync(current).sort()) {
        if (name === 'node_modules' || name === '.git') continue;
        const path = join(current, name);
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path);
        else rows.push(`${path}:${sha256(readFileSync(path))}`);
      }
    };
    walk(dir);
    return sha256(Buffer.from(rows.join('\n'), 'utf8'));
  };

  /** 逐条阻塞理由的最小构造：键即 ProposalBlockReason。 */
  const states = {
    'test-slice-manifest-missing': () => { rmSync(fx.manifest); },
    'test-slice-manifest-invalid': () => patchManifest(fx, m => { m.slices[0].spec_targets = [FEATURE_REL]; }),
    'test-slice-manifest-stale': () => patchManifest(fx, m => { m.task_fingerprint = `sha256:${'c'.repeat(64)}`; }),
    'test-slice-manifest-unsupported': () => patchManifest(fx, m => { m.schema = 'openlogos/test-slice-manifest@9'; }),
    'test-slice-assignment-ambiguous': () => patchManifest(fx, m => {
      m.slices[1].owned_test_ids = ['UT-S01-01', 'UT-S01-02'];
      m.slices[1].runner_selectors = ['UT-S01-01', 'UT-S01-02'];
    }),
    'slice-task-state-inconsistent': () => {
      const pkgRoot = packageRoot(entry);
      const req = createRequire(join(pkgRoot, 'package.json'));
      const lib = req(join(pkgRoot, 'dist', 'lib', 'test-slice-manifest.js'));
      for (let i = 0; i < SLICES.length; i += 1) {
        const state = lib.deriveSliceVerificationState(fx.base, fx.dir, { change: SLUG, module: 'core' });
        if (!state || state.verify_mode !== 'slice-checkpoint') break;
        lib.appendSliceCheckpoint(fx.dir, state, 'PASS');
      }
    },
  };

  const covered = [];
  for (const [reason, mutate] of Object.entries(states)) {
    cli(entry, fx.base, ['slice', 'plan', '--file', fx.legalPath]);      // 每例前复位为合法基线
    rmSync(join(fx.dir, 'SLICE_CHECKPOINTS.jsonl'), { force: true });
    mutate();
    const snapBefore = projectSnapshot(fx.base);
    const lint = cliJsonLenient(entry, fx.base, ['change-lint']);
    const nextState = cliJsonLenient(entry, fx.base, ['next']);
    if (!lintReasons(lint.payload).has(reason)) {
      throw new Error(`change-lint 未检出 ${reason}——自检入口仍不可达（exit=${lint.status}）`);
    }
    if (!nextReasons(nextState.payload).has(reason)) {
      throw new Error(`夹具未真正触发 ${reason}（next 未报该理由），本条断言无效`);
    }
    if (reason !== 'test-slice-manifest-stale' && lint.status !== 2) {
      throw new Error(`${reason} 应为 violation（exit 2），实际 exit=${lint.status}`);
    }
    if (reason === 'test-slice-manifest-stale' && lint.status !== 0) {
      throw new Error(`stale 应为 warning、不改退出码，实际 exit=${lint.status}`);
    }
    if (projectSnapshot(fx.base) !== snapBefore) {
      throw new Error(`change-lint 破坏只读红线：${reason} 场景下项目根字节发生变化`);
    }
    covered.push(reason);
  }

  // 两条 step 级理由需要独立提案形态（无 [delta] / 无测试证据），各自新建一次性项目
  // [code] 一律保持空标题——spec-complete 前出现 checkbox 条目本身是 L0 违规，会污染本条断言。
  const stepCases = [
    ['no_delta_spec_marker_missing', { specMerged: false, withDelta: false }],
    ['code_change_requires_real_test_ids', { withDelta: false }],
  ];
  for (const [reason, options] of stepCases) {
    const sub = scaffold(entry, `${SLUG}-${reason.replace(/_/g, '-')}`.slice(0, 60), options);
    scopes.push(sub.base);
    const lint = cliJsonLenient(entry, sub.base, ['change-lint']);
    if (!lintReasons(lint.payload).has(reason)) {
      throw new Error(`change-lint 未检出 ${reason}（exit=${lint.status}）`);
    }
    if (lint.status !== 2) throw new Error(`${reason} 应为 violation（exit 2），实际 exit=${lint.status}`);
    covered.push(reason);
  }

  if (covered.length !== 8) throw new Error(`阻塞理由覆盖不足 8 条：${covered.join(', ')}`);
  record('SMOKE-core-205', 'pass',
    `change-lint 逐条检出 8 条阻塞理由（stale 走 warning 不改退出码），与 next 同结论，且 lint 前后项目字节快照相等`,
    [...evidence, `reasons=${covered.join('|')}`]);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  for (const id of SLICE_GATE_SMOKE_IDS) {
    if (!results.has(id)) record(id, 'fail', message, [`entry=${entry}`, `version=${globalVersion}`]);
  }
  if (pairedFailure) {
    // 成对语义：204 失败时 203 也不得记 pass——单向收紧的两侧缺一即结论不成立。
    record('SMOKE-core-203', 'fail',
      `与 SMOKE-core-204 成对评估失败：${pairedFailure.message}`, [`entry=${entry}`]);
  }
} finally {
  flush();
  for (const scope of scopes) rmSync(scope, { recursive: true, force: true });
}

const failed = SLICE_GATE_SMOKE_IDS.filter(id => (results.get(id)?.status ?? 'fail') !== 'pass');
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${SLICE_GATE_SMOKE_IDS.join(', ')}`);
