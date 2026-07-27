#!/usr/bin/env node
/**
 * brownfield-adopter 切片1（读侧可信边界）发布后冒烟：SMOKE-core-44/45/46/47/48。
 *
 * 覆盖已发布包中 adopt 自动/降级建基线引导、status/next 的 baseline_coverage 一致性、
 * verify 对逆向 spec **不再产软告警**（drop-baseline-confirmation 确认机制移除反向回归：JSON 无 baseline_warnings、gate 不因 baseline 失败），以及 baseline-seed 两阶段提交协议 + partial 恢复态。
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
// smoke-repair（SMOKE-core-48）：规范键须与 anchor 哈希一致，从 repo dist 复用唯一实现（ESM 顶层 await）。
const { candidateKey } = await import(join(repoRoot, 'cli/dist/lib/baseline-provenance.js'));
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

function writeSmoke(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'brownfield-adopter read-side' };
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function cliCommand() {
  if (process.env.OPENLOGOS_BIN) return { command: process.env.OPENLOGOS_BIN, baseArgs: [] };
  const distEntry = join(repoRoot, 'cli/dist/index.js');
  if (existsSync(distEntry)) return { command: process.execPath, baseArgs: [distEntry] };
  return { command: 'npx', baseArgs: ['-y', '@miniidealab/openlogos@latest'] };
}

function runCli(root, args) {
  const cli = cliCommand();
  const env = { ...process.env };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(cli.command, [...cli.baseArgs, ...args], { cwd: root, encoding: 'utf-8', env });
}

function parseEnvelope(result) {
  const raw = `${result.stdout}\n${result.stderr}`;
  const line = raw.split('\n').find(item => item.trim().startsWith('{'));
  if (!line) throw new Error(`missing JSON envelope: ${raw.slice(0, 500)}`);
  return JSON.parse(line);
}

function withTempProject(prefix, fn) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function reverseDoc(candidatesYaml) {
  return `# system-map\n\n模块图正文。\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${candidatesYaml}\`\`\`\n`;
}

function scaffoldAdopted(root, seedState, candidatesYaml) {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({
    name: 'smoke', locale: 'zh', documents: {},
    verify: { result_path: 'logos/resources/verify/test-results.jsonl' },
  }, null, 2));
  const modules = [{ id: 'core', name: 'Core', lifecycle: 'launched', bootstrap: 'adopted', baseline_seed_state: seedState }];
  const yamlLines = [
    'modules:',
    ...modules.flatMap(m => [
      `  - id: ${m.id}`, `    name: ${m.name}`, `    lifecycle: ${m.lifecycle}`,
      `    bootstrap: ${m.bootstrap}`, `    baseline_seed_state: ${m.baseline_seed_state}`,
    ]),
    'deployment_gates:', '  core:', '    deployment_required: true', '    smoke_required: true',
  ];
  writeFileSync(join(root, 'logos/logos-project.yaml'), yamlLines.join('\n') + '\n');
  if (candidatesYaml) writeFileSync(join(root, 'logos/resources/prd/core-system-map.md'), reverseDoc(candidatesYaml));
}

// SMOKE-core-44：adopt 后 next 输出逆向建基线引导（真 adopt）。
try {
  withTempProject('smoke-bfa-44-', (root) => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));
    const adoptRes = runCli(root, ['adopt', '--locale', 'zh', '--ai-tool', 'cursor']);
    if (adoptRes.status !== 0) throw new Error(`adopt failed: ${adoptRes.stderr?.slice(0, 300)}`);
    const nextRes = runCli(root, ['next']);
    const out = `${nextRes.stdout}\n${nextRes.stderr}`;
    if (!out.includes('openlogos baseline-seed begin')) throw new Error('next missing reverse-baseline guidance');
    if (out.includes('openlogos change add-baseline-docs')) throw new Error('next still suggests add-baseline-docs');
  });
  writeSmoke('SMOKE-core-44', 'pass');
} catch (e) { writeSmoke('SMOKE-core-44', 'fail', e); }

// SMOKE-core-45：adopt 能力缺失降级不伪造基线（非交互）。
try {
  withTempProject('smoke-bfa-45-', (root) => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));
    const adoptRes = runCli(root, ['adopt', '--locale', 'zh', '--ai-tool', 'cursor']);
    if (adoptRes.status !== 0) throw new Error(`adopt failed`);
    const out = `${adoptRes.stdout}\n${adoptRes.stderr}`;
    if (out.includes('基线已建立')) throw new Error('adopt wrongly claims baseline established');
    const statusRes = runCli(root, ['status', '--format', 'json']);
    const env = parseEnvelope(statusRes);
    const mod = env.data.modules?.[0];
    if (mod?.baseline_seed_state !== 'required') throw new Error(`baseline_seed_state != required: ${mod?.baseline_seed_state}`);
  });
  writeSmoke('SMOKE-core-45', 'pass');
} catch (e) { writeSmoke('SMOKE-core-45', 'fail', e); }

// SMOKE-core-46：status/next baseline_coverage 字段一致 + tombstone 不虚增 + n/a + stale。
try {
  withTempProject('smoke-bfa-46-', (root) => {
    // smoke-repair（SMOKE-core-46）：扫描侧采信判据与写侧同强度（provenance-scan-canonical-recompute）——
    // 候选必须 key == candidateKey(module, anchor)（携 anchor 重算比对），旧手造 key（core::a11111111111、
    // 无 anchor）会被整条排除出 coverage 分母，夹具与 SMOKE-core-48 同步对齐 provenance 契约。
    const A1 = '系统边界：core CLI';
    const A2 = '场景候选：S90 示例';
    scaffoldAdopted(root, 'seeded',
      `  - key: "${candidateKey('core', A1)}"\n    anchor: "${A1}"\n    state: active\n    verified: true\n    confirmed_by: "fred"\n` +
      `  - key: "${candidateKey('core', A2)}"\n    anchor: "${A2}"\n    state: active\n    verified: false\n`);
    const s = parseEnvelope(runCli(root, ['status', '--format', 'json'])).data.modules[0].baseline_coverage;
    const n = parseEnvelope(runCli(root, ['next', '--format', 'json'])).data.modules[0].baseline_coverage;
    if (JSON.stringify(s) !== JSON.stringify(n)) throw new Error('status/next baseline_coverage mismatch');
    for (const f of ['state', 'incomplete', 'denominator', 'tombstones', 'source', 'freshness']) {
      if (!(f in s)) throw new Error(`missing baseline_coverage.${f}`);
    }
    if (s.denominator !== 2 || s.tombstones !== 0) throw new Error(`unexpected coverage ${JSON.stringify(s)}`);
    // 零候选 → n/a
    withTempProject('smoke-bfa-46b-', (root2) => {
      scaffoldAdopted(root2, 'seeded', null);
      const z = parseEnvelope(runCli(root2, ['status', '--format', 'json'])).data.modules[0].baseline_coverage;
      if (z.denominator !== 0) throw new Error('zero-denominator not n/a');
    });
  });
  writeSmoke('SMOKE-core-46', 'pass');
} catch (e) { writeSmoke('SMOKE-core-46', 'fail', e); }

// SMOKE-core-47：verify 对 verified:false 逆向 spec 不再产软告警（drop-baseline-confirmation 反向回归：JSON 无 baseline_warnings、gate 不因 baseline 失败）。
try {
  withTempProject('smoke-bfa-47-', (root) => {
    // 候选须为规范键 + anchor（真实 seeded 候选形态）；确认机制若还在，此 verified:false 候选会触发软告警。
    const A47 = '系统边界：core CLI';
    scaffoldAdopted(root, 'seeded', `  - key: "${candidateKey('core', A47)}"\n    anchor: "${A47}"\n    state: active\n    verified: false\n`);
    // 最小可运行 verify 集：一条已定义 UT 用例 + 其通过结果，使 verify 走到 gate 并打印 envelope。
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/core-X-test-cases.md'),
      '# X\n\n| 用例 ID | 名称 |\n|---|---|\n| UT-X-01 | 冒烟占位 |\n');
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'),
      JSON.stringify({ id: 'UT-X-01', status: 'pass' }) + '\n');
    const res = runCli(root, ['verify', '--format', 'json']);
    // 先证 verify 本身成功通过（否则"无 baseline_warnings"是假绿）：退出码 0 + 成功 envelope + gate.result=PASS。
    if (res.status !== 0) throw new Error(`verify exited non-zero (${res.status}): ${res.stdout}\n${res.stderr}`);
    const env = parseEnvelope(res);
    if (env.error) throw new Error(`verify returned error envelope: ${JSON.stringify(env.error)}`);
    if (env.data?.gate?.result !== 'PASS') throw new Error(`gate.result not PASS: ${JSON.stringify(env.data?.gate)}`);
    // 反向断言：verify 不再输出 data.baseline_warnings；gate 失败原因（若有）绝不因 baseline 造成。
    if (env.data?.baseline_warnings !== undefined) {
      throw new Error(`verify still surfaced baseline_warnings: ${JSON.stringify(env.data.baseline_warnings)}`);
    }
    const reason = env.data?.gate?.reason ?? '';
    if (String(reason).includes('baseline')) throw new Error(`gate.reason wrongly caused by baseline: ${reason}`);
  });
  writeSmoke('SMOKE-core-47', 'pass');
} catch (e) { writeSmoke('SMOKE-core-47', 'fail', e); }

// SMOKE-core-48：baseline-seed 两阶段提交协议 + partial 恢复态一致（begin → 部分 staged commit(partial) → 补齐 commit(seeded)）。
try {
  withTempProject('smoke-bfa-48-', (root) => {
    scaffoldAdopted(root, 'required', null);
    const T1 = 'logos/resources/prd/core-system-map.md';
    const T2 = 'logos/resources/prd/core-scenario-candidates.md';
    // smoke-repair（SMOKE-core-48）：staged fixture 对齐 provenance 契约（F3/F10）——
    // key 必须为规范键 `candidateKey(module, anchor)` 且 candidates[] 必须携 anchor，
    // 旧 fixture 的手造 key（core::a11111111111，无 anchor）会被 validateSeedCandidate 硬拒（invalid_provenance）。
    const A1 = '系统边界：core CLI';
    const A2 = '场景候选：S90 示例';
    const K1 = candidateKey('core', A1);
    const K2 = candidateKey('core', A2);
    writeFileSync(join(root, 'seed-plan.json'), JSON.stringify({ module: 'core', expected: [
      { kind: 'system-map', target_path: T1, candidate_keys: [K1] },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ] }));
    const beginEnv = parseEnvelope(runCli(root, ['baseline-seed', 'begin', '--module', 'core', '--manifest', 'seed-plan.json', '--format', 'json']));
    const runId = beginEnv.data.run_id;
    if (!runId) throw new Error('begin did not return run_id');
    const stagingBase = join(root, 'logos/resources/verify/baseline-seed-runs', runId, 'staging');
    const writeStaged = (rel, key, anchor) => {
      const p = join(stagingBase, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    anchor: "${anchor}"\n    state: active\n    verified: false\n\`\`\`\n`);
    };
    // 仅落盘部分 → partial
    writeStaged(T1, K1, A1);
    const partial = parseEnvelope(runCli(root, ['baseline-seed', 'commit', '--module', 'core', '--run-id', runId, '--format', 'json']));
    if (partial.data.baseline_seed_state !== 'partial') throw new Error(`expected partial, got ${partial.data.baseline_seed_state}`);
    if (!Array.isArray(partial.data.missing) || partial.data.missing.length === 0) throw new Error('partial missing not reported');
    if (existsSync(join(root, T1))) throw new Error('partial wrongly committed incomplete set to target');
    // next/status 一致指向 baseline-seed 恢复
    const nd = parseEnvelope(runCli(root, ['next', '--format', 'json'])).data;
    const ndCmd = nd.modules?.[0]?.command ?? nd.command ?? '';
    if (!String(ndCmd).includes('openlogos baseline-seed')) throw new Error(`next did not point to baseline-seed: ${ndCmd}`);
    // stale run_id commit 非零退出、不写状态
    const stale = runCli(root, ['baseline-seed', 'commit', '--module', 'core', '--run-id', 'seed-core-9999', '--format', 'json']);
    if (stale.status === 0) throw new Error('unknown run_id commit should be non-zero');
    // 补齐 → seeded
    writeStaged(T2, K2, A2);
    const seeded = parseEnvelope(runCli(root, ['baseline-seed', 'commit', '--module', 'core', '--run-id', runId, '--format', 'json']));
    if (seeded.data.baseline_seed_state !== 'seeded') throw new Error(`expected seeded, got ${seeded.data.baseline_seed_state}`);
    if (!existsSync(join(root, T1)) || !existsSync(join(root, T2))) throw new Error('seeded did not commit targets');
  });
  writeSmoke('SMOKE-core-48', 'pass');
} catch (e) { writeSmoke('SMOKE-core-48', 'fail', e); }
