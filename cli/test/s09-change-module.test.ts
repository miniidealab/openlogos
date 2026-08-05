/**
 * S09 — openlogos change 模块归属 fail-closed（change-module-fail-closed，issue #17）。
 * 用例 ID 与 logos/resources/test/core-S09-test-cases.md §五 对齐：
 *   UT-S09-140..146（resolveModule / i18n，函数直调）
 *   ST-S09-50..56（真实 CLI 端到端 spawn dist/index.js + 原子性 + 顺序契约）。
 * code-r1 处置：F1 非法 --module 输出合法清单（id+顺序）；F2 裸 --module 缺值拒绝；
 *   F3 ST 走真实 CLI 入口（spawnSync）；F4 候选命令顺序 toEqual 精确断言。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { change } from '../src/commands/change.js';

/** 覆写项目 yaml 的 modules（scaffoldProject 默认无 modules）。 */
function setModules(root: string, ids: string[]): void {
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    'modules:\n' + ids.map(id => `  - id: ${id}`).join('\n') + '\n',
  );
}

const CLI_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
/** F3：走真实 CLI 入口 dist/index.js（真实 argv 解析、命令分派、OS 退出码）。 */
function spawnCli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const guardOf = (root: string) => JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf-8'));
const proposalOf = (root: string, slug: string) =>
  readFileSync(join(root, 'logos', 'changes', slug, 'proposal.md'), 'utf-8');
const changeDir = (root: string, slug: string) => join(root, 'logos', 'changes', slug);
const guardPath = (root: string) => join(root, 'logos', '.openlogos-guard');
/** F4：抽取 stderr 中以 `openlogos change` 开头的候选命令行（保序）。 */
const candidateCmds = (s: string) => s.split(/\r?\n/).map(x => x.trim()).filter(x => x.startsWith('openlogos change'));

/* ═══════════ 一、UT（resolveModule / i18n，函数直调） ═══════════ */

describe('S09 模块归属 fail-closed — UT', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;

  function setup(locale: 'en' | 'zh', mods: string[]) {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale });
    setModules(root, mods);
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  }

  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  it('UT-S09-140: 显式 --module 存在 → 归属该模块', () => {
    setup('zh', ['module-a', 'module-b']);
    change('c1', 'module-b');
    expect(guardOf(root).module).toBe('module-b');
    expect(proposalOf(root, 'c1')).toContain('> module: module-b');
  });

  it('UT-S09-141: 显式非法 --module → 非零退出 + 合法模块清单（id 在场且按 modules[] 顺序）', () => {
    setup('zh', ['module-a', 'module-b']);
    expect(() => change('c1', 'nope')).toThrow('process.exit(1)');
    const err = con.errors.join('\n');
    expect(err).toContain("模块 'nope'");
    // F1：stderr 须逐字含合法 id（非仅「运行 module list」提示命令）
    expect(err).toContain('module-a');
    expect(err).toContain('module-b');
    // 顺序确定（modules[] 声明序）：module-a 在 module-b 之前
    expect(err.indexOf('module-a')).toBeLessThan(err.indexOf('module-b'));
    expect(existsSync(changeDir(root, 'c1'))).toBe(false);
  });

  it('UT-S09-142: 单模块（非 core）未传 --module → 自动归属该唯一模块（不硬编码 core）', () => {
    setup('zh', ['payments']);
    change('c1');
    expect(guardOf(root).module).toBe('payments');
    expect(guardOf(root).module).not.toBe('core');
    expect(proposalOf(root, 'c1')).toContain('> module: payments');
    expect(con.logs.join('\n')).toContain('自动挂靠，当前只有一个模块');
  });

  it('UT-S09-143: 多模块含 core 未传 --module → 默认 core，文案与实选一致', () => {
    setup('zh', ['module-a', 'core', 'module-b']);
    change('c1');
    expect(guardOf(root).module).toBe('core');
    expect(con.logs.join('\n')).toContain('归属模块：core（默认挂靠 core');
  });

  it('UT-S09-144: 多模块无 core 未传 --module → fail-closed + 逐候选可执行命令', () => {
    setup('zh', ['module-a', 'module-b']);
    expect(() => change('s1')).toThrow('process.exit(1)');
    const err = con.errors.join('\n');
    expect(err).toContain('未配置 core');
    expect(candidateCmds(err)).toEqual([
      'openlogos change s1 --module module-a',
      'openlogos change s1 --module module-b',
    ]);
    expect(err).not.toContain('--module <id>');
    expect(existsSync(guardPath(root))).toBe(false);
    expect(existsSync(changeDir(root, 's1'))).toBe(false);
  });

  it('UT-S09-145: 文案一致性 — 无「实选 modules[0] 却称默认 core」', () => {
    setup('zh', ['module-a', 'module-b']);
    expect(() => change('s1')).toThrow('process.exit(1)');
    const all = [...con.logs, ...con.errors].join('\n');
    expect(all).not.toContain('module-a（默认挂靠 core');
    expect(all).not.toMatch(/归属模块：(?!core)[a-z0-9-]+（默认挂靠 core/);
  });

  it('UT-S09-146: 英文 locale 无 core 错误文案在场且可诊断（不显示裸 key、无字面 <id>）', () => {
    setup('en', ['module-a', 'module-b']);
    expect(() => change('s1')).toThrow('process.exit(1)');
    const err = con.errors.join('\n');
    expect(err).toContain('multiple modules and no');
    expect(candidateCmds(err)).toEqual([
      'openlogos change s1 --module module-a',
      'openlogos change s1 --module module-b',
    ]);
    expect(err).not.toContain('change.moduleNoCore');
    expect(err).not.toContain('--module <id>');
  });
});

/* ═══════════ 二、ST（真实 CLI 端到端 spawn dist/index.js + 原子性 + 顺序契约） ═══════════ */

describe('S09 模块归属 fail-closed — ST（真实 CLI）', () => {
  let root: string; let cleanup: () => void;

  function setup(locale: 'en' | 'zh', mods: string[]) {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale });
    setModules(root, mods);
  }
  afterEach(() => cleanup());

  it('ST-S09-50: 多模块无 core 未传 --module → 非零退出 + 逐候选命令（顺序精确）+ 零残留', () => {
    setup('zh', ['module-a', 'module-b']);
    const r = spawnCli(root, ['change', 'test-change']);
    expect(r.status).not.toBe(0);
    // F4：候选命令按 modules[] 顺序精确匹配
    expect(candidateCmds(r.stderr)).toEqual([
      'openlogos change test-change --module module-a',
      'openlogos change test-change --module module-b',
    ]);
    expect(r.stderr).not.toContain('--module <id>');
    // 原子失败：未创建 change 目录、未写 guard
    expect(existsSync(changeDir(root, 'test-change'))).toBe(false);
    expect(existsSync(guardPath(root))).toBe(false);
  });

  it('ST-S09-51: 补 --module 后成功归属（真实 CLI，exit 0）', () => {
    setup('zh', ['module-a', 'module-b']);
    const r = spawnCli(root, ['change', 'test-change', '--module', 'module-b']);
    expect(r.status).toBe(0);
    expect(guardOf(root).module).toBe('module-b');
    expect(proposalOf(root, 'test-change')).toContain('> module: module-b');
  });

  it('ST-S09-52: 多模块含 core 默认挂靠零回归（真实 CLI，exit 0）', () => {
    setup('zh', ['module-a', 'core', 'module-b']);
    const r = spawnCli(root, ['change', 'c1']);
    expect(r.status).toBe(0);
    expect(guardOf(root).module).toBe('core');
    expect(proposalOf(root, 'c1')).toContain('> module: core');
    expect(r.stdout).toContain('归属模块：core（默认挂靠 core');
  });

  it('ST-S09-53: 单模块（非 core）自动挂靠归属该唯一模块（真实 CLI，exit 0）', () => {
    setup('zh', ['payments']);
    const r = spawnCli(root, ['change', 'c2']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('归属模块：payments');
    expect(guardOf(root).module).toBe('payments');
    expect(proposalOf(root, 'c2')).toContain('> module: payments');
  });

  it('ST-S09-54: 英文 locale 多模块无 core 端到端 fail-closed（顺序精确 + 零残留）', () => {
    setup('en', ['module-a', 'module-b']);
    const r = spawnCli(root, ['change', 's1']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('multiple modules and no');
    expect(candidateCmds(r.stderr)).toEqual([
      'openlogos change s1 --module module-a',
      'openlogos change s1 --module module-b',
    ]);
    expect(r.stderr).not.toContain('change.moduleNoCore');
    expect(r.stderr).not.toContain('--module <id>');
    expect(existsSync(changeDir(root, 's1'))).toBe(false);
    expect(existsSync(guardPath(root))).toBe(false);
  });

  it('ST-S09-55: 裸 --module（缺值）→ 非零退出 + 用法、零残留（F2，真实 CLI argv 解析）', () => {
    setup('zh', ['core', 'module-b']);
    const r = spawnCli(root, ['change', 'probe', '--module']);
    expect(r.status).not.toBe(0);                      // 不得折叠成未传参数、悄然创建 core 提案
    expect(r.stderr).toContain('--module requires a module id');
    expect(r.stderr.toLowerCase()).toContain('usage');
    expect(existsSync(changeDir(root, 'probe'))).toBe(false);
    expect(existsSync(guardPath(root))).toBe(false);
  });

  it('ST-S09-56: 显式非法 --module → 非零退出 + 合法清单（id + 顺序）+ 零残留（F1，真实 CLI）', () => {
    setup('zh', ['module-a', 'module-b']);
    const r = spawnCli(root, ['change', 'probe', '--module', 'nope']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("模块 'nope'");
    expect(r.stderr).toContain('module-a');
    expect(r.stderr).toContain('module-b');
    expect(r.stderr.indexOf('module-a')).toBeLessThan(r.stderr.indexOf('module-b')); // modules[] 顺序
    expect(existsSync(changeDir(root, 'probe'))).toBe(false);
    expect(existsSync(guardPath(root))).toBe(false);
  });
});
