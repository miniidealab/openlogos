/**
 * S19 smoke 沙箱复用（verify-sandbox-reuse-0-16-1，切片 slice-02-smoke-sandbox-reuse）。
 *
 * 覆盖 UT-S19-57，对应功能规格 §2.91、场景 S19「smoke 沙箱复用」规则 1～6。
 * 夹具：一次性 launched 项目与一次性 sandbox_root；smoke 前置标记（VERIFY_PASS、DEPLOY_DONE、[deploy] 全勾、
 * 需要 smoke）齐备；smoke.command 指向真实 runner，为本提案用例写 pass 并在 detail 中记录工作区内缓存哨兵是否存在。
 * 全部经真实 `openlogos verify` / `openlogos smoke` 子进程执行。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, cleanupFixtureRoots, fixtureRoots, put } from './frontier-fixture.js';
import { scaffoldProject } from './helpers.js';
import { detectLivenessCapability, projectDirName } from '../src/lib/sandbox-reuse.js';

const SLUG = 'smoke-reuse-fixture';
const RESULT = 'logos/resources/verify/test-results.jsonl';
const SMOKE_RESULT = 'logos/resources/verify/smoke-results.jsonl';
const IDS = ['UT-S01-01', 'UT-S01-02'];

/** 复用依赖旧写入者存活检查能力；嵌套沙箱内按规格 unsupported，本用例显式 skip（同 s13-sandbox-reuse）。 */
const REUSE_CAPABLE = detectLivenessCapability().available;

afterAll(cleanupFixtureRoots);

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureRoots.push(dir);
  return dir;
}

function project(): { root: string; sbx: string } {
  const root = tmp('openlogos-s19-reuse-');
  const sbx = tmp('openlogos-s19-reuse-sbx-');
  scaffoldProject(root, { locale: 'zh' });
  put(root, 'logos/resources/test/core-S01-test-cases.md',
    `# S01\n\n| ID | 描述 |\n|---|---|\n${IDS.map(id => `| ${id} | ${id} 用例 |`).join('\n')}\n`);
  put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  const proposalDir = join(root, 'logos/changes', SLUG);
  put(root, `logos/changes/${SLUG}/deltas/test/smoke/core-smoke-test-cases.md`,
    '## ADDED — 夹具 smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  writeFileSync(join(proposalDir, 'proposal.md'), [
    '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
  ].join('\n'));
  writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [deploy] 发布\n- [x] 本机全局安装\n');
  writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
  // 部署后阶段：smoke 账本已有记录（verify 的 smoke 覆盖预检读取它）
  put(root, SMOKE_RESULT, JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: '2026-10-13T00:00:00.000Z' }) + '\n');
  writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
  // verify 预跑：向缓存路径写哨兵并写全部 pass 账本
  put(root, 'tools/verify-runner.js', `
const fs = require('fs');
fs.mkdirSync('build-cache', { recursive: true });
fs.writeFileSync('build-cache/sentinel', 'from-verify');
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync(${JSON.stringify(RESULT)}, ${JSON.stringify(IDS.map(id => JSON.stringify({ id, status: 'pass', timestamp: '2026-10-13T00:00:00.000Z' })).join('\n') + '\n')});
`);
  // smoke runner：为本提案用例写 pass，detail 记录哨兵是否可见
  put(root, 'scripts/smoke-reuse-fixture.mjs', `
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || ${JSON.stringify(SMOKE_RESULT)};
mkdirSync(dirname(p), { recursive: true });
const sentinel = existsSync('build-cache/sentinel') ? 'present' : 'missing';
appendFileSync(p, JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: new Date().toISOString(), detail: 'sentinel=' + sentinel }) + '\\n');
`);
  const configPath = join(root, 'logos/logos.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const sandbox = { sandbox_mode: 'auto', sandbox_root: sbx, sandbox_deny_workspace_write: true, sandbox_cache_paths: ['build-cache'] };
  config.verify = { ...config.verify, ...sandbox, result_path: RESULT, pre_run_command: 'node tools/verify-runner.js' };
  config.smoke = { ...config.smoke, ...sandbox, result_path: SMOKE_RESULT, command: 'node scripts/smoke-reuse-fixture.mjs' };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { root, sbx };
}

function run(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [cli, ...args, '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024,
  });
  let data;
  try { data = JSON.parse(r.stdout).data; } catch { throw new Error(`${args.join(' ')} 输出不是 JSON：${r.stdout}${r.stderr}`); }
  return data;
}

function sentinelOf(root: string): string | undefined {
  const lines = readFileSync(join(root, SMOKE_RESULT), 'utf8').trim().split('\n').filter(Boolean);
  const rec = lines.map(l => JSON.parse(l)).reverse().find(r => r.id === 'SMOKE-core-901');
  return /sentinel=(\w+)/.exec(rec?.detail ?? '')?.[1];
}

function latestLockWs(projectDir: string): string {
  const names = readdirSync(join(projectDir, 'lock')).filter(n => /^gen-\d{12}$/.test(n)).sort();
  return JSON.parse(readFileSync(join(projectDir, 'lock', names[names.length - 1]), 'utf8')).ws;
}

describe('S19 smoke 沙箱复用 — 单元测试', () => {
  it.skipIf(!REUSE_CAPABLE)('UT-S19-57: smoke 与 verify 共用持久沙箱并支持 --fresh-sandbox', () => {
    const { root, sbx } = project();
    const projectDir = join(sbx, projectDirName(root));
    const smokePass = join(root, 'logos/changes', SLUG, 'SMOKE_PASS');

    // ① verify：创建持久沙箱，预跑在缓存路径写入哨兵
    const v = run(root, ['verify']);
    expect(v.gate.result, JSON.stringify({ gate: v.gate, failed: v.failed_cases, unc: v.uncovered_cases, pre: v.pre_run?.commands })).toBe('PASS');
    expect(v.sandbox.reuse.state).toBe('created');
    const firstWs = v.sandbox.reuse.generation;

    // ② smoke：复用同一持久沙箱，缓存哨兵可见
    const s1 = run(root, ['smoke']);
    expect(s1.sandbox.reuse.dir).toBe(v.sandbox.reuse.dir);
    expect(s1.sandbox.reuse.dir).toBe(projectDir);
    expect(s1.sandbox.reuse.state).toBe('reused');
    expect(s1.sandbox.reuse.generation).toBe(firstWs);
    expect(sentinelOf(root)).toBe('present');
    expect(s1.gate.result, JSON.stringify({ gate: s1.gate, diag: s1.coverage_check ?? s1.diagnostics })).toBe('PASS');
    expect(existsSync(smokePass), 'SMOKE_PASS 写入规则不变').toBe(true);

    // ③ smoke --fresh-sandbox：新建世代，缓存从空开始，被替换的正常释放世代已删除，锁记录 ws 与 generation 一致
    const s2 = run(root, ['smoke', '--fresh-sandbox']);
    expect(s2.sandbox.reuse.state).toBe('fresh');
    expect(s2.sandbox.reuse.generation).not.toBe(firstWs);
    expect(sentinelOf(root)).toBe('missing');
    expect(existsSync(join(projectDir, firstWs)), '① 的世代目录已删除').toBe(false);
    expect(latestLockWs(projectDir)).toBe(s2.sandbox.reuse.generation);
    expect(s2.gate.result).toBe('PASS');

    // ④ smoke：沿用 ③ 的世代，① 的旧世代未被重新创建
    const s3 = run(root, ['smoke']);
    expect(s3.sandbox.reuse.state).toBe('reused');
    expect(s3.sandbox.reuse.generation).toBe(s2.sandbox.reuse.generation);
    expect(existsSync(join(projectDir, firstWs))).toBe(false);
    expect(s3.gate.result).toBe('PASS');

    // ⑤ smoke.sandbox_mode=off：不出现 reuse
    const configPath = join(root, 'logos/logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.smoke.sandbox_mode = 'off';
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const s4 = run(root, ['smoke']);
    expect('reuse' in s4.sandbox).toBe(false);
    expect(s4.gate.result).toBe('PASS');
  }, 120_000);
});
