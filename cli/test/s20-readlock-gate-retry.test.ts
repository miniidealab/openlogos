/**
 * S20 读取门锁获取有界重试（fix-baseline-readlock-reader-contention，读取门规则 11 补充）。
 * 覆盖：UT-S20-41、UT-S20-42。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { change } from '../src/commands/change.js';
import { next } from '../src/commands/next.js';
import {
  atomicWriteJson, backupDir, journalPath, lockPath, runsRoot, sha256,
  setReadLockRetryPolicyForTests, type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { captureConsole, makeTempRoot, mockProcessExit, scaffoldProject } from './helpers.js';

const T1 = 'logos/resources/prd/core-system-map.md';
const cleanups: Array<() => void> = [];
const originalCwd = process.cwd();
afterEach(() => {
  process.chdir(originalCwd);
  setReadLockRetryPolicyForTests();
  while (cleanups.length) cleanups.pop()!();
});

function adoptedFixture() {
  const temp = makeTempRoot(); cleanups.push(temp.cleanup);
  // change() 以 process.cwd()（realpath 后）为 root；journal 内绝对路径必须与其同一前缀，
  // 否则 macOS 的 /var → /private/var 符号链接会让 journal 严格校验误判「路径越界」。
  temp.root = realpathSync(temp.root);
  scaffoldProject(temp.root, { name: 'readlock-s20', locale: 'zh' });
  writeFileSync(join(temp.root, 'logos/logos-project.yaml'), [
    'project:', '  name: readlock-s20', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    bootstrap: adopted', '    baseline_seed_state: partial',
    '    product_type: cli', 'scenarios: []',
  ].join('\n'));
  return temp.root;
}

function holdLockAsOtherProcess(root: string) {
  mkdirSync(runsRoot(root), { recursive: true });
  writeFileSync(lockPath(root, 'core'),
    JSON.stringify({ pid: process.ppid, at: Date.now(), token: `other-${process.ppid}` }));
}

/** 合法 prepared journal：读取门必须在锁内先恢复（丢弃）它才能继续。 */
function makePreparedJournal(root: string, runId: string) {
  const oldA = '# old-a\n'; const newA = '# new-a\n';
  const bdir = backupDir(root, runId);
  mkdirSync(join(bdir, dirname(T1)), { recursive: true });
  writeFileSync(join(bdir, T1), oldA);
  const yBackup = join(bdir, 'logos-project.yaml.bak');
  writeFileSync(yBackup, readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8'));
  mkdirSync(dirname(join(root, T1)), { recursive: true });
  writeFileSync(join(root, T1), oldA);
  const journal: CommitJournal = {
    phase: 'prepared', run_id: runId, module: 'core',
    targets: [{ target_path: T1, old_sha256: sha256(oldA), new_sha256: sha256(newA), applied: false }],
    index: { yaml_backup_path: yBackup, old_yaml_sha256: sha256(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8')) },
    state_transition: { from: 'partial', to: 'seeded' },
    keys: ['core::a11111111111'],
  };
  atomicWriteJson(journalPath(root, runId), journal);
}

describe('S20 读取门锁获取有界重试', () => {
  it('UT-S20-41: change/next 入口读取门在 reader 竞争下不假阳性', async () => {
    const root = adoptedFixture();
    process.chdir(root);
    // next：锁被他者短暂持有，注入 sleep 在首次退避时释放 → 入口成功、主动作不变。
    let sleeps = 0;
    setReadLockRetryPolicyForTests({ sleep: () => { sleeps++; rmSync(lockPath(root, 'core'), { force: true }); } });
    holdLockAsOtherProcess(root);
    const con = captureConsole();
    try {
      await next('json');
      const env = JSON.parse(con.logs.find(line => line.startsWith('{'))!);
      expect(env.data.command).toBe('openlogos change <slug>');
      expect(JSON.stringify(env.data)).not.toContain('baseline_commit_in_progress');
    } finally { con.restore(); }
    expect(sleeps).toBeGreaterThanOrEqual(1);

    // change：pending journal + 锁竞争 → 预算内取到锁、在锁内恢复（丢弃 prepared journal）后正常建案。
    sleeps = 0;
    setReadLockRetryPolicyForTests({ sleep: () => { sleeps++; rmSync(lockPath(root, 'core'), { force: true }); } });
    makePreparedJournal(root, 'seed-core-s20-retry');
    holdLockAsOtherProcess(root);
    change('retry-ok');
    expect(existsSync(join(root, 'logos/changes/retry-ok/proposal.md'))).toBe(true);
    expect(existsSync(join(root, 'logos/changes/retry-ok/tasks.md'))).toBe(true);
    expect(existsSync(journalPath(root, 'seed-core-s20-retry'))).toBe(false); // 恢复门四步照旧
  });

  it('UT-S20-42: writer 真持锁时读取门仍硬阻断（EX-11.1 分流零回退）', () => {
    const root = adoptedFixture();
    process.chdir(root);
    let clock = 0;
    setReadLockRetryPolicyForTests({ now: () => { clock += 700; return clock; }, sleep: () => { /* noop */ } });
    makePreparedJournal(root, 'seed-core-s20-blocked');
    holdLockAsOtherProcess(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      expect(() => change('must-not-exist')).toThrow('process.exit(1)');
      expect(con.errors.join('\n')).toContain('baseline_commit_in_progress');
      // 不读半新集合、不产出任何提案/guard 副作用。
      expect(existsSync(join(root, 'logos/changes/must-not-exist'))).toBe(false);
      expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(false);
      // journal 原样在盘、锁仍归 writer——门没有被弱化。
      expect(existsSync(journalPath(root, 'seed-core-s20-blocked'))).toBe(true);
      expect(existsSync(lockPath(root, 'core'))).toBe(true);
    } finally {
      exitSpy.mockRestore();
      con.restore();
    }
  });
});
