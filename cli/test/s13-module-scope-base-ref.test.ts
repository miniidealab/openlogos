/**
 * module-scoped-verify 切片1：openlogos change 在 guard 中记录提案起点 baseRef（S13）。
 *
 * 覆盖 UT-S13-121（logos/resources/test/core-S13-test-cases.md「S13 按模块限定 verify 范围测试」）。
 * 规范源：功能规格 §2.96.6；spec/change-management.md「guard 文件记录提案起点 baseRef（module-scoped-verify）」。
 * 三臂各在一次性目录内以真实 change 入口执行；结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { change } from '../src/commands/change.js';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'msv', GIT_AUTHOR_EMAIL: 'msv@example.invalid',
  GIT_COMMITTER_NAME: 'msv', GIT_COMMITTER_EMAIL: 'msv@example.invalid',
};

function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
}

function project(kind: 'committed' | 'empty-repo' | 'no-git'): string {
  const temp = makeTempRoot();
  cleanups.push(temp.cleanup);
  scaffoldProject(temp.root, { name: 'base-ref', locale: 'en' });
  if (kind !== 'no-git') git(temp.root, ['init', '-q']);
  if (kind === 'committed') {
    writeFileSync(join(temp.root, 'README.md'), '# base-ref\n');
    git(temp.root, ['add', '-A']);
    git(temp.root, ['commit', '-qm', 'init']);
  }
  return temp.root;
}

/** 以真实 change 入口创建提案；返回是否因 process.exit 被拒。 */
function runChange(root: string, slug: string): { rejected: boolean } {
  const restoreCwd = mockCwd(root);
  const exit = mockProcessExit();
  const con = captureConsole();
  try {
    change(slug);
    return { rejected: false };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('process.exit(')) return { rejected: true };
    throw error;
  } finally {
    con.restore();
    exit.mockRestore();
    restoreCwd();
  }
}

const guardText = (root: string) => readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8');

describe('S13 按模块限定 verify 范围 — 提案起点 baseRef（module-scoped-verify 切片1）', () => {
  it('UT-S13-121: openlogos change 记录 baseRef 与写入者保留', () => {
    // ① git 仓库且已有提交：写入当时 HEAD 的 40 位提交号；同 slug 再建被拒时 guard 字节与 baseRef 不变
    const committed = project('committed');
    const head = git(committed, ['rev-parse', 'HEAD']);
    expect(runChange(committed, 'demo').rejected).toBe(false);
    const before = guardText(committed);
    const guard = JSON.parse(before);
    expect(guard.baseRef).toBe(head);
    expect(guard.baseRef).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(guard)).toEqual(['activeChange', 'module', 'createdAt', 'baseRef']);
    expect(guard).toMatchObject({ activeChange: 'demo', module: 'core' });

    writeFileSync(join(committed, 'README.md'), '# moved on\n');
    git(committed, ['commit', '-qam', 'after proposal']);
    expect(runChange(committed, 'demo').rejected, '同 slug 再建应被拒').toBe(true);
    expect(guardText(committed), '被拒后 guard 字节不变').toBe(before);
    expect(JSON.parse(guardText(committed)).baseRef).toBe(head);

    // ② git 仓库但尚无提交；③ 非 git 目录：不写 baseRef，其余字段与引入前一致
    for (const kind of ['empty-repo', 'no-git'] as const) {
      const root = project(kind);
      expect(runChange(root, 'demo').rejected, kind).toBe(false);
      const g = JSON.parse(guardText(root));
      expect(Object.keys(g), kind).toEqual(['activeChange', 'module', 'createdAt']);
      expect(g, kind).toMatchObject({ activeChange: 'demo', module: 'core' });
      expect(typeof g.createdAt).toBe('string');
    }
  });
});
