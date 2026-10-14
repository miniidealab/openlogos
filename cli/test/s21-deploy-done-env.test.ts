/**
 * environment-registry 切片 3：deploy-done 环境校验、版本声明与部署账本（S21）。
 *
 * 覆盖 UT-S21-12～UT-S21-19、ST-S21-05（logos/resources/test/core-S21-test-cases.md「S21 环境校验、版本声明与部署账本测试」）。
 * 规范源：spec/environments.md §3～§5；功能规格 §2.11、§2.93.2、§2.93.3。
 * 全部在一次性临时 git 仓库中构造：UT 进程内调用 deployDone，ST 走真实 CLI 入口 cli/dist/index.js。
 * 零副作用断言以调用前后提案目录文件集合、tasks.md 字节与账本存在性比对取证。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { deployDone, restoreWriteSnapshot, takeWriteSnapshot } from '../src/commands/deploy-done.js';
import { DEPLOY_LEDGER_LOCK_REL, appendLedgerLine, removeOwnLedgerLine } from '../src/lib/deployment-ledger.js';
import { DEPLOY_LEDGER_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const SLUG = 'ship-it';

const PROPOSAL = [
  '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布运行时代码', '- 影响环境：测试',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
].join('\n');
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n');
const REGISTRY = 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test, aliases: [测试]}\n  - {id: prod, name: Production, tier: prod}\n';
const MARKER_KEYS = ['deploy_id', 'environment', 'recorded_at', 'ref', 'ref_source'];
const BASE_DATA_KEYS = ['cleared_smoke_markers', 'deploy_tasks_checked', 'deploy_tasks_total', 'deployment_report_path', 'environment', 'marker_path', 'next_step', 'slug'];

let root: string;
let cleanup: () => void;
let restoreCwd: () => void;
let con: ReturnType<typeof captureConsole>;
let exitSpy: ReturnType<typeof mockProcessExit>;

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(file: string, content: string): string {
  writeFileSync(join(root, file), content);
  git(['add', '-A']);
  git(['commit', '-qm', file]);
  return git(['rev-parse', 'HEAD']);
}

function setup(opts: { registry?: boolean; gitRepo?: boolean } = {}): string {
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
  const proposalDir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: new Date().toISOString() }));
  writeFileSync(join(proposalDir, 'proposal.md'), PROPOSAL);
  writeFileSync(join(proposalDir, 'tasks.md'), TASKS);
  writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n\nok\n');
  if (opts.registry !== false) writeFileSync(join(root, ENV_REGISTRY_REL), REGISTRY);
  if (opts.gitRepo !== false) {
    git(['init', '-q']);
    git(['config', 'user.name', 't']);
    git(['config', 'user.email', 't@example.invalid']);
    git(['add', '-A']);
    git(['commit', '-qm', 'init']);
  }
  return proposalDir;
}

const markerPath = () => join(root, 'logos', 'changes', SLUG, 'DEPLOY_DONE');
const ledgerPath = () => join(root, DEPLOY_LEDGER_REL);
const readMarker = () => JSON.parse(readFileSync(markerPath(), 'utf-8'));
const readLedger = () => readFileSync(ledgerPath(), 'utf-8').trim().split('\n').map(l => JSON.parse(l));

function snapshot(): string {
  const dir = join(root, 'logos', 'changes', SLUG);
  return JSON.stringify({
    files: readdirSync(dir).sort(),
    tasks: readFileSync(join(dir, 'tasks.md'), 'utf-8'),
    ledger: existsSync(ledgerPath()) ? readFileSync(ledgerPath(), 'utf-8') : null,
  });
}

async function expectRejected(run: () => Promise<unknown>, code: string, contains?: string): Promise<void> {
  const before = snapshot();
  con.errors.length = 0;
  await expect(run()).rejects.toThrow('process.exit(1)');
  const err = JSON.parse(con.errors.join('\n'));
  expect(err.error.code).toBe(code);
  if (contains) expect(err.error.message).toContain(contains);
  expect(snapshot(), `${code} 零副作用`).toBe(before);
}

function jsonOut(): Record<string, any> {
  return JSON.parse(con.logs[con.logs.length - 1]);
}

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  restoreCwd = mockCwd(root);
  con = captureConsole();
  exitSpy = mockProcessExit();
});

afterEach(() => {
  con.restore();
  exitSpy.mockRestore();
  restoreCwd();
  cleanup();
});

describe('S21 deploy-done 环境与版本 — 单元测试', () => {
  it('UT-S21-12: 登记表存在时环境未登记拒绝', async () => {
    setup();
    await expectRejected(() => deployDone('json', 'staging'), 'ENV_UNKNOWN', 'test, prod');
    expect(existsSync(markerPath())).toBe(false);
    expect(existsSync(ledgerPath())).toBe(false);
  });

  it('UT-S21-13: 登记表存在时未传 --env 拒绝', async () => {
    setup();
    await expectRejected(() => deployDone('json'), 'ENV_REQUIRED', 'test, prod');
    expect(existsSync(markerPath())).toBe(false);
    expect(readFileSync(join(root, 'logos/changes', SLUG, 'tasks.md'), 'utf-8')).toContain('- [ ] 发布');
  });

  it('UT-S21-14: 别名解析为 id 并写入 marker 与账本', async () => {
    setup();
    const head = git(['rev-parse', 'HEAD']);
    await deployDone('json', '测试', 'HEAD');
    const marker = readMarker();
    expect(Object.keys(marker).sort()).toEqual(MARKER_KEYS);
    expect(marker.environment).toBe('test');
    expect(readFileSync(markerPath(), 'utf-8').split('\n').filter(Boolean)).toHaveLength(1);
    const ledger = readLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: 'deploy', environment: 'test', slug: SLUG, result: 'done', ref: head, deploy_id: marker.deploy_id });
    expect(jsonOut().data.environment).toBe('test');
  });

  it('UT-S21-15: 部署版本只来自 --ref', async () => {
    setup();
    const r0 = git(['rev-parse', 'HEAD']);
    const r1 = commit('src.txt', 'r1\n');
    writeFileSync(join(root, 'dirty.txt'), 'uncommitted\n');
    await deployDone('json', 'test', r0.slice(0, 10));
    const marker = readMarker();
    expect(marker).toMatchObject({ ref: r0, ref_source: 'explicit' });
    const [line] = readLedger();
    expect(line).toMatchObject({ ref: r0, ref_source: 'explicit', observed_head: r1, observed_dirty: true });
    expect(jsonOut().data.deployment).toEqual({
      deploy_id: marker.deploy_id, environment: 'test', ref: r0, ref_source: 'explicit', observed_head: r1, ledger_written: true,
    });
  });

  it('UT-S21-16: 未传 --ref 时版本未知', async () => {
    setup();
    const r1 = commit('src.txt', 'r1\n');
    await deployDone('json', 'prod');
    expect(readMarker()).toMatchObject({ environment: 'prod', ref: null, ref_source: 'unknown' });
    const [line] = readLedger();
    expect(line).toMatchObject({ ref: null, ref_source: 'unknown', observed_head: r1 });
    expect(jsonOut().data.deployment.ref).toBeNull();
  });

  it('UT-S21-17: --ref 无法解析拒绝', async () => {
    setup();
    await expectRejected(() => deployDone('json', 'test', 'deadbeef'), 'ENV_REF_UNRESOLVED', 'deadbeef');
    await expectRejected(() => deployDone('json', 'test', '--version'), 'ENV_REF_UNRESOLVED');
    await expectRejected(() => deployDone('json', 'test', ''), 'ENV_REF_UNRESOLVED');
    expect(existsSync(markerPath())).toBe(false);
    expect(existsSync(ledgerPath())).toBe(false);
  });

  it('UT-S21-17: --ref 无法解析拒绝（非 git 仓库）', async () => {
    setup({ gitRepo: false });
    await expectRejected(() => deployDone('json', 'test', 'HEAD'), 'ENV_REF_UNRESOLVED', 'HEAD');
    expect(existsSync(markerPath())).toBe(false);
  });

  it('UT-S21-18: 无登记表时输出逐字不变', async () => {
    setup({ registry: false });
    // ① 不传 --env：JSON 字段集合与引入前合同一致，marker 为单行 JSON 且 environment 为 null，不写账本
    await deployDone('json');
    const d1 = jsonOut().data;
    expect(Object.keys(d1).sort()).toEqual(BASE_DATA_KEYS);
    expect(d1.environment).toBeNull();
    expect(readMarker()).toMatchObject({ environment: null, ref: null, ref_source: 'unknown' });
    expect(existsSync(ledgerPath())).toBe(false);
    // ② --env staging：原始标签原样输出，追加账本
    await deployDone('json', 'staging');
    const d2 = jsonOut().data;
    expect(Object.keys(d2).sort()).toEqual(BASE_DATA_KEYS);
    expect(d2.environment).toBe('staging');
    expect(readMarker().environment).toBe('staging');
    expect(readLedger().map(l => l.environment)).toEqual(['staging']);
    // ③ 文本输出与引入前格式一致：不出现部署版本行
    con.logs.length = 0;
    await deployDone('text', 'staging');
    const text = con.logs.join('\n');
    expect(text).toContain('staging');
    expect(text).not.toContain('部署版本');
    expect(text).toContain('openlogos smoke --env staging');
  });

  it('UT-S21-19: 重跑整体重写 marker', async () => {
    setup();
    const r0 = git(['rev-parse', 'HEAD']);
    const r1 = commit('src.txt', 'r1\n');
    await deployDone('json', 'test', r0);
    const first = readMarker();
    await deployDone('json', 'test', r1);
    const second = readMarker();
    expect(readFileSync(markerPath(), 'utf-8').split('\n').filter(Boolean)).toHaveLength(1);
    expect(second.deploy_id).not.toBe(first.deploy_id);
    expect(second.ref).toBe(r1);
    expect(readLedger().map(l => l.ref)).toEqual([r0, r1]);
  });
});

describe('S21 deploy-done 写入失败不产生部分状态更新（code-r1 F2）', () => {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const proposalDir = () => join(root, 'logos/changes', SLUG);
  const smokePass = () => join(proposalDir(), 'SMOKE_PASS');

  /** 相关文件逐字节快照：tasks.md、SMOKE_PASS、DEPLOY_DONE、账本（目录时记为 <dir>）。 */
  function bytes(): Record<string, string | null> {
    const read = (p: string) => {
      if (!existsSync(p)) return null;
      try { return readFileSync(p, 'utf-8'); } catch { return '<dir>'; }
    };
    return {
      tasks: read(join(proposalDir(), 'tasks.md')),
      smokePass: read(smokePass()),
      marker: read(markerPath()),
      ledger: read(ledgerPath()),
      files: readdirSync(proposalDir()).sort().join(','),
    };
  }

  async function expectRolledBack(run: () => Promise<unknown>, before: Record<string, string | null>): Promise<void> {
    con.errors.length = 0;
    await expect(run()).rejects.toThrow('process.exit(1)');
    const err = JSON.parse(con.errors.join('\n')).error;
    expect(err.code).toBe('DEPLOY_DONE_WRITE_FAILED');
    expect(err.message).not.toContain('incomplete');
    expect(bytes()).toEqual(before);
  }

  it('UT-S21-11: 首次落标时账本追加失败，tasks / 旧 smoke marker / 账本均回到执行前', async () => {
    setup();
    writeFileSync(smokePass(), 'old-pass');
    mkdirSync(ledgerPath(), { recursive: true }); // 账本路径被目录占据：appendFileSync 失败
    const before = bytes();
    expect(before.tasks).toContain('- [ ] 发布');
    await expectRolledBack(() => deployDone('json', 'test', 'HEAD'), before);
    expect(existsSync(markerPath())).toBe(false);
  });

  it('UT-S21-11: 重跑时账本追加失败，旧 DEPLOY_DONE 与旧账本逐字保留', async () => {
    if (isRoot) return;
    setup();
    await deployDone('json', 'test', 'HEAD');
    writeFileSync(smokePass(), 'old-pass');
    chmodSync(ledgerPath(), 0o444);
    try {
      const before = bytes();
      await expectRolledBack(() => deployDone('json', 'prod'), before);
    } finally {
      chmodSync(ledgerPath(), 0o644);
    }
  });

  it('UT-S21-11: 重跑时最后写 DEPLOY_DONE 失败，已追加的账本被截回、旧 smoke marker 恢复', async () => {
    if (isRoot) return;
    setup();
    await deployDone('json', 'test', 'HEAD');
    writeFileSync(smokePass(), 'old-pass');
    chmodSync(markerPath(), 0o444);
    try {
      const before = bytes();
      await expectRolledBack(() => deployDone('json', 'prod'), before);
      expect(readFileSync(ledgerPath(), 'utf-8').trim().split('\n')).toHaveLength(1);
    } finally {
      chmodSync(markerPath(), 0o644);
    }
  });

  it('UT-S21-11: 首次落标时 DEPLOY_DONE 无法创建，tasks 恢复、本次新建的账本被移除', async () => {
    if (isRoot) return;
    setup();
    const before = bytes();
    chmodSync(proposalDir(), 0o555); // 目录只读：已有 tasks.md 可写，但无法创建 DEPLOY_DONE
    try {
      await expectRolledBack(() => deployDone('json', 'test', 'HEAD'), before);
      expect(existsSync(ledgerPath())).toBe(false);
    } finally {
      chmodSync(proposalDir(), 0o755);
    }
  });
});

describe('S21 deploy-done 失败补偿只回退本次账本记录（code-r2 F2）', () => {
  const proposalDir = () => join(root, 'logos/changes', SLUG);
  const lockPath = () => join(root, DEPLOY_LEDGER_LOCK_REL);
  /** 另一 CLI writer（smoke）成功追加的合法记录。 */
  const otherLine = (n = 1) => `${JSON.stringify({
    kind: 'smoke', environment: 'test', slug: SLUG, recorded_at: '2026-01-01T00:00:00.000Z', observed_head: null,
    observed_dirty: null, deploy_id: `other-${n}`, ref: null, result: 'pass', env_evidence: 'declared',
    fresh_results: true, deploy_env_confirmed: true, verified: false,
  })}\n`;
  const ownLine = () => `${JSON.stringify({ kind: 'deploy', environment: 'prod', deploy_id: 'own-deploy' })}\n`;
  const snap = () => takeWriteSnapshot(root, proposalDir(), markerPath(), ledgerPath());
  const ledgerText = () => readFileSync(ledgerPath(), 'utf-8');

  it('UT-S21-11: 快照后另一 writer 成功追加，本次未追加账本即失败，补偿不触碰账本', async () => {
    setup();
    await deployDone('json', 'test', 'HEAD');
    const s = snap();
    const before = ledgerText();
    appendLedgerLine(root, otherLine());
    expect(restoreWriteSnapshot(s, null)).toEqual([]);
    expect(ledgerText()).toBe(before + otherLine());
  });

  it('UT-S21-11: 本次已追加、另一 writer 随后追加、最终 marker 写入失败，只移除本次那一行', async () => {
    setup();
    await deployDone('json', 'test', 'HEAD');
    const s = snap();
    const before = ledgerText();
    const other = otherLine();
    appendLedgerLine(root, ownLine());
    appendLedgerLine(root, other);
    expect(restoreWriteSnapshot(s, ownLine())).toEqual([]);
    expect(ledgerText()).toBe(before + other);
  });

  it('UT-S21-11: 首次落标时账本由本次新建，期间另一 writer 追加，补偿保留文件与对方记录', () => {
    setup();
    const s = snap();
    expect(existsSync(ledgerPath())).toBe(false);
    const other = otherLine();
    appendLedgerLine(root, ownLine());
    appendLedgerLine(root, other);
    expect(restoreWriteSnapshot(s, ownLine())).toEqual([]);
    expect(ledgerText()).toBe(other);
  });

  it('UT-S21-11: 本次记录归属无法确认时不改账本并报告恢复冲突', () => {
    setup();
    const s = snap();
    appendLedgerLine(root, ownLine());
    appendLedgerLine(root, otherLine());
    appendLedgerLine(root, ownLine());
    const before = ledgerText();
    const problems = restoreWriteSnapshot(s, ownLine());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('deployments.jsonl');
    expect(ledgerText()).toBe(before);
    expect(removeOwnLedgerLine(root, `${JSON.stringify({ missing: true })}\n`, false)).toBe('absent');
  });

  it('UT-S21-11: 账本锁被占用时追加等待超时且不写入，遗留陈旧锁可回收，结束后不残留锁文件', async () => {
    setup();
    await deployDone('json', 'test', 'HEAD');
    expect(existsSync(lockPath())).toBe(false);
    const before = ledgerText();
    writeFileSync(lockPath(), 'other-pid');
    expect(() => appendLedgerLine(root, otherLine(), { timeoutMs: 100 })).toThrow(/locked/);
    expect(ledgerText()).toBe(before);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath(), old, old);
    appendLedgerLine(root, otherLine(2), { timeoutMs: 100 });
    expect(ledgerText()).toBe(before + otherLine(2));
    expect(existsSync(lockPath())).toBe(false);
  });
});

describe('S21 deploy-done 环境与版本 — 场景测试', () => {
  it('ST-S21-05: 真实 CLI 下的环境与版本落标', () => {
    setup();
    const head = git(['rev-parse', 'HEAD']);
    const cli = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8', timeout: 60_000 });
    const r = cli(['deploy-done', '--env', '测试', '--ref', 'HEAD', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    const data = JSON.parse(r.stdout).data;
    expect(data.environment).toBe('test');
    expect(data.deployment).toMatchObject({ environment: 'test', ref: head, ref_source: 'explicit', ledger_written: true });
    const marker = readMarker();
    expect(Object.keys(marker).sort()).toEqual(MARKER_KEYS);
    expect(marker).toMatchObject({ deploy_id: data.deployment.deploy_id, environment: 'test', ref: head, ref_source: 'explicit' });
    const ledger = readLedger();
    expect(ledger[ledger.length - 1]).toMatchObject({ kind: 'deploy', deploy_id: marker.deploy_id, environment: 'test', ref: head });
    const show = cli(['env', 'show', 'test', '--format', 'json']);
    expect(show.status, show.stderr).toBe(0);
    expect(JSON.parse(show.stdout).data.current_ref).toBe(head);
    const st = cli(['status', '--format', 'json']);
    expect(JSON.parse(st.stdout).data.environments.find((e: any) => e.id === 'test').current_ref).toBe(head);
  }, 120_000);
});
