/**
 * fix-deploy-done-leak-failclosed-selfheal 切片2：
 * archive 完成链条 fail-closed 校验（S09 §2.67.2）——VERIFY_PASS / DEPLOY_DONE / SMOKE_PASS
 * 三级链条、判定顺序、拒绝时零副作用，以及无需部署提案的零回归。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { archive } from '../src/commands/archive.js';

const DEPLOY_PROPOSAL = [
  '# 变更提案：runtime-change',
  '',
  '## 部署影响',
  '- 是否需要部署：是',
  '- 部署原因：修改 CLI 运行时代码，需要发布新包',
  '- 影响环境：生产',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：是',
  '- 是否需要 smoke：是',
  '',
  '## 变更概述',
  '修改运行时代码。',
].join('\n');

const NO_DEPLOY_PROPOSAL = [
  '# 变更提案：docs-only',
  '',
  '## 部署影响',
  '- 是否需要部署：否',
  '- 部署原因：仅更新文档，不需要发布运行产物',
  '- 影响环境：无',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：否',
  '- 是否需要 smoke：否',
  '',
  '## 变更概述',
  '补充文档。',
].join('\n');

const DEPLOY_TASKS = [
  '# 实现任务', '', '## [code] 代码实现', '- [x] 修改运行时代码', '',
  '## [deploy] 部署任务', '- [x] 发布 npm 包',
].join('\n');

const DOCS_TASKS = ['# 实现任务', '', '## [delta] 规格变更', '- [x] 更新文档'].join('\n');

let root: string;
let cleanup: () => void;
let restoreCwd: () => void;
let con: ReturnType<typeof captureConsole>;
let exitSpy: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
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

function setupProposal(opts: {
  slug?: string;
  proposal?: string;
  tasks?: string;
  markers?: string[];
} = {}) {
  const slug = opts.slug ?? 'deploy-feature';
  const proposalDir = join(root, 'logos', 'changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
    activeChange: slug, module: 'core', createdAt: new Date().toISOString(),
  }));
  writeFileSync(join(proposalDir, 'proposal.md'), opts.proposal ?? DEPLOY_PROPOSAL);
  writeFileSync(join(proposalDir, 'tasks.md'), opts.tasks ?? DEPLOY_TASKS);
  for (const marker of opts.markers ?? []) writeFileSync(join(proposalDir, marker), '');
  return { slug, proposalDir };
}

function runArchive(slug: string): { code: string; output: string } {
  con.errors.length = 0; con.logs.length = 0;
  exitSpy.mockClear();
  try { archive(slug); } catch { /* mockProcessExit throws */ }
  const output = [...con.errors, ...con.logs].join('\n');
  const match = output.match(/ARCHIVE_[A-Z_]+/);
  return { code: match ? match[0] : '', output };
}

/** 拒绝时零副作用：目录未移动、guard 未删、未建 Windows 握手 runtime 目录。 */
function expectNoSideEffects(proposalDir: string) {
  expect(existsSync(proposalDir), '提案目录不得被移动').toBe(true);
  expect(existsSync(join(root, 'logos', '.openlogos-guard')), 'guard 不得被删除').toBe(true);
  const archiveDir = join(root, 'logos', 'changes', 'archive');
  expect(existsSync(archiveDir) ? readdirSync(archiveDir) : []).toEqual([]);
  expect(existsSync(join(root, 'logos', '.runtime', 'archive-watch')), '不得建立握手请求目录').toBe(false);
}

describe('S09 archive 链条 fail-closed 校验', () => {
  it('UT-S09-319: 缺 VERIFY_PASS 时拒绝归档且零副作用', () => {
    const { slug, proposalDir } = setupProposal();
    const first = runArchive(slug);
    expect(first.code).toBe('ARCHIVE_VERIFY_NOT_PASSED');
    expect(first.output).toContain('openlogos verify');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expectNoSideEffects(proposalDir);

    // VERIFY_FAIL 在场同样拒绝（即使 VERIFY_PASS 也在）
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');
    expect(runArchive(slug).code).toBe('ARCHIVE_VERIFY_NOT_PASSED');
    expectNoSideEffects(proposalDir);
  });

  it('UT-S09-320: 需部署提案缺 DEPLOY_DONE 时拒绝，SMOKE_PASS 不得反推部署完成', () => {
    // 20260907 孤儿状态：SMOKE_PASS 在场但 DEPLOY_DONE 缺失
    const { slug, proposalDir } = setupProposal({ markers: ['VERIFY_PASS', 'SMOKE_PASS'] });
    const result = runArchive(slug);
    expect(result.code).toBe('ARCHIVE_DEPLOY_NOT_DONE');
    expect(result.output).toContain('openlogos deploy-done');
    expectNoSideEffects(proposalDir);
  });

  it('UT-S09-321: 需 smoke 提案缺 SMOKE_PASS 时拒绝归档', () => {
    const { slug, proposalDir } = setupProposal({ markers: ['VERIFY_PASS', 'DEPLOY_DONE'] });
    const first = runArchive(slug);
    expect(first.code).toBe('ARCHIVE_SMOKE_NOT_PASSED');
    expect(first.output).toContain('openlogos smoke');
    expectNoSideEffects(proposalDir);

    // SMOKE_FAIL 在场同样拒绝
    writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), '');
    expect(runArchive(slug).code).toBe('ARCHIVE_SMOKE_NOT_PASSED');
    expectNoSideEffects(proposalDir);
  });

  it('ST-S09-123: 链条逐级补齐后归档放行', () => {
    const { slug, proposalDir } = setupProposal();

    // ① 缺 VERIFY_PASS
    expect(runArchive(slug).code).toBe('ARCHIVE_VERIFY_NOT_PASSED');
    expectNoSideEffects(proposalDir);

    // ② 补 VERIFY_PASS → 缺 DEPLOY_DONE
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    expect(runArchive(slug).code).toBe('ARCHIVE_DEPLOY_NOT_DONE');
    expectNoSideEffects(proposalDir);

    // ③ 补 DEPLOY_DONE → 缺 SMOKE_PASS
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    expect(runArchive(slug).code).toBe('ARCHIVE_SMOKE_NOT_PASSED');
    expectNoSideEffects(proposalDir);

    // ④ 补 SMOKE_PASS → 归档成功：目录移入 archive、guard 释放
    writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
    const done = runArchive(slug);
    expect(done.code).toBe('');
    expect(existsSync(proposalDir)).toBe(false);
    expect(existsSync(join(root, 'logos', '.openlogos-guard'))).toBe(false);
    const archived = readdirSync(join(root, 'logos', 'changes', 'archive'));
    expect(archived.some(name => name.endsWith(slug))).toBe(true);
  });

  it('ST-S09-124: 无需部署提案零回归——链条只到 ①', () => {
    const { slug, proposalDir } = setupProposal({
      slug: 'docs-only', proposal: NO_DEPLOY_PROPOSAL, tasks: DOCS_TASKS,
    });

    // 缺 VERIFY_PASS 仍拒绝（① 对全部提案生效）
    expect(runArchive(slug).code).toBe('ARCHIVE_VERIFY_NOT_PASSED');
    expectNoSideEffects(proposalDir);

    // 仅 VERIFY_PASS 在场、无 DEPLOY_DONE / SMOKE_PASS → 归档成功
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    const done = runArchive(slug);
    expect(done.code).toBe('');
    expect(existsSync(proposalDir)).toBe(false);
    expect(readdirSync(join(root, 'logos', 'changes', 'archive')).some(n => n.endsWith(slug))).toBe(true);
  });
});
