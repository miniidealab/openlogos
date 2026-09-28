/**
 * Windows 路径分隔符与大小写：status/next 派生、module rename、slice done 产物归属、baseline-seed
 * journal 恢复（fix-windows-platform-compat，切片 2）。
 * 覆盖 UT-S25-25～UT-S25-28、ST-S25-07、UT-S17-07～UT-S17-08、ST-S17-04、UT-S31-37～UT-S31-38、
 * UT-S33-61～UT-S33-62（与 logos/resources/test/core-S25/S17/S31/S33-test-cases.md 严格对齐）。
 *
 * 依据架构 §五十二 52.1：OS 路径只经 node:path API 拆解；listFiles 返回 `/` 分隔相对路径；
 * 绝对路径判定同时识别 posix 与 win32；win32 上比较不同调用得到的绝对路径前统一大小写。
 * 需要 Windows 真实 `readdirSync` / NTFS 语义的用例属 Windows 回归集，在 CI windows-latest 上运行；
 * 纯推导函数以 `path.win32` 或注入 platform 驱动，在 POSIX 上同样可证伪。
 *
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, posix, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeTempRoot, scaffoldProject, mockCwd, captureConsole, mergeAdmissibleProposal,
} from './helpers.js';
import { listFiles } from '../src/lib/list-files.js';
import { isPrototypeOnlyDelta, shouldEnterSpec, deriveModulePhaseProgressViaFlow } from '../src/lib/flow-derive.js';
import { deriveModulePhaseProgress, type ModuleInfo } from '../src/commands/status.js';
import { deriveOverlayView } from '../src/lib/flow-overlay-derive.js';
import { moduleRename, renamedModuleFilePath } from '../src/commands/module.js';
import { relFromRoot } from '../src/lib/automation-diagnostic.js';
import { isWithinBackupBase } from '../src/lib/baseline-seed-txn.js';
import { platformPathKey } from '../src/lib/canonical-target.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  return root;
}

function writeAt(root: string, rel: string, content = 'x\n'): void {
  const full = join(root, ...rel.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

// ── S25：派生层路径分隔符 ────────────────────────────────────────────────────

describe('S25 派生层路径分隔符跨平台', () => {
  it('UT-S25-25: listFiles 返回 / 分隔相对路径', () => {
    const root = tempProject();
    const dir = join(root, 'fixture');
    writeAt(dir, 'a.md');
    writeAt(dir, '1-feature-specs/core-01-x.md');
    writeAt(dir, '2-page-design/sub/core-02-y.html');
    writeAt(dir, 'sub/.gitkeep', '');
    const files = listFiles(dir).sort();
    expect(files).toEqual(['1-feature-specs/core-01-x.md', '2-page-design/sub/core-02-y.html', 'a.md']);
    expect(files.some(f => f.includes('\\'))).toBe(false);
    // 既有行为：传入文件路径时返回其 basename
    expect(listFiles(join(dir, '1-feature-specs', 'core-01-x.md'))).toEqual(['core-01-x.md']);
  });

  it('UT-S25-26: 原型-only delta 判定', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'proto');
    writeAt(proposalDir, 'deltas/prd/2-product-design/2-page-design/core-01-x.html', '<h1>x</h1>\n');
    expect(isPrototypeOnlyDelta(proposalDir)).toBe(true);
    // ui_impact:true、仅原型、无 PLAN_APPROVED → 停在门前态（ready-to-delta），不进 spec
    expect(shouldEnterSpec(proposalDir, true)).toBe(false);
    writeAt(proposalDir, 'deltas/test/core-S01-test-cases.md', '## ADDED — x\n');
    expect(isPrototypeOnlyDelta(proposalDir)).toBe(false);
    expect(shouldEnterSpec(proposalDir, true)).toBe(true);
  });

  it('UT-S25-27: 多模块前缀过滤覆盖子目录文件（flow-derive / status / overlay 三入口一致）', () => {
    const root = tempProject();
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
      'modules:', '  - id: core', '    name: core', '    lifecycle: initial',
      '  - id: billing', '    name: billing', '    lifecycle: initial', '',
    ].join('\n'));
    writeAt(root, 'logos/resources/prd/2-product-design/1-feature-specs/core-01-x.md');
    const core: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'initial' };
    const billing: ModuleInfo = { id: 'billing', name: 'billing', lifecycle: 'initial' };

    // 入口一：flow-derive
    expect(deriveModulePhaseProgressViaFlow(root, core, [], true).progress['phase.2'].done).toBe(true);
    expect(deriveModulePhaseProgressViaFlow(root, billing, [], true).progress['phase.2'].done).toBe(false);
    // 入口二：status（旧派生，保留作等价对照）
    expect(deriveModulePhaseProgress(root, core, [], true).progress['phase.2'].done).toBe(true);
    expect(deriveModulePhaseProgress(root, billing, [], true).progress['phase.2'].done).toBe(false);
    // 入口三：overlay dir_nonempty 谓词
    mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
    writeFileSync(join(root, 'logos', 'flow', 'initial.yaml'), [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd',
      '    node: { id: pd-probe, name: 设计探针, done_when: "dir_nonempty", produces: "logos/resources/prd/2-product-design/" }',
    ].join('\n'));
    const coreView = deriveOverlayView(root, core, [], null, true)!;
    const billingView = deriveOverlayView(root, billing, [], null, true)!;
    expect(coreView.overlay_nodes.find(n => n.id === 'pd-probe')?.state ?? 'omitted').not.toBe('active');
    expect(billingView.overlay_nodes.find(n => n.id === 'pd-probe')?.state).toBe('active');
  });

  it('UT-S25-28: 消费方不再各自按 / 拆解 OS 路径', () => {
    const read = (rel: string) => readFileSync(join(CLI_ROOT, rel), 'utf-8');
    for (const rel of ['src/lib/flow-derive.ts', 'src/commands/status.ts', 'src/lib/flow-overlay-derive.ts']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/split\('\/'\)\.pop\(\)/);
      expect(src, rel).toContain('posix.basename(f)');
    }
    const derive = read('src/lib/flow-derive.ts');
    expect(derive).toContain("PROTOTYPE_DELTA_PREFIX = 'prd/2-product-design/2-page-design/'");
    expect(derive).not.toMatch(/PROTOTYPE_DELTA_PREFIX \+ '\/'/);
  });

  it('ST-S25-07: 真实 status / next 派生（Windows 回归集）', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
    const root = tempProject();
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
      'modules:',
      '  - id: core', '    name: core', '    lifecycle: initial',
      '  - id: billing', '    name: billing', '    lifecycle: initial', '',
    ].join('\n'));
    writeAt(root, 'logos/resources/prd/1-product-requirements/core-01-requirements.md');
    writeAt(root, 'logos/resources/prd/1-product-requirements/billing-01-requirements.md');
    writeAt(root, 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md');
    const run = (args: string[]) => {
      const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd: root, encoding: 'utf-8' });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      return JSON.parse(r.stdout);
    };
    const status = run(['status', '--format', 'json']);
    const phase2 = (id: string) => (status.data.modules as Array<{ id: string; phase_progress: Record<string, { done: boolean }> }>)
      .find(m => m.id === id)!.phase_progress['phase.2'].done;
    expect(phase2('core')).toBe(true);
    expect(phase2('billing')).toBe(false);
    const next = run(['next', '--format', 'json']);
    const nextNode = (id: string) => (next.data.modules as Array<{ id: string; next_node?: { id: string } }>)
      .find(m => m.id === id)!.next_node?.id;
    expect(nextNode('billing')).toBe('product-design');
    expect(nextNode('core')).not.toBe('product-design');

    // ② GUI 模块提案仅含原型 delta、未批准 → 停在批准门前（ready-to-delta），不进入写 delta / merge
    const gui = tempProject();
    writeFileSync(join(gui, 'logos', 'logos-project.yaml'),
      'modules:\n  - id: core\n    name: core\n    lifecycle: launched\n    product_type: web\n');
    writeFileSync(join(gui, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'proto', module: 'core' }));
    const dir = join(gui, 'logos', 'changes', 'proto');
    const uiBlock = '\n## UI/UX 变更声明\n\n```yaml\nui_impact: true\ndesign_system_mode: generated\npages:\n'
      + '  - id: home\n    prototype: core-01-home.html\n    description: 首页\n```\n';
    writeAt(dir, 'proposal.md', mergeAdmissibleProposal('proto', 'core').replace(/\n## 决策澄清/, `${uiBlock}\n## 决策澄清`));
    writeAt(dir, 'tasks.md', [
      '# 实现任务', '', '## [delta] 规格变更',
      '- [ ] 产出 `deltas/prd/2-product-design/2-page-design/core-01-home.html` — 原型', '',
      '## [code] 代码实现', '',
    ].join('\n'));
    writeAt(dir, 'deltas/prd/2-product-design/2-page-design/core-01-home.html', '<h1>home</h1>\n');
    const r = spawnSync(process.execPath, [CLI_ENTRY, 'next', '--format', 'json'], { cwd: gui, encoding: 'utf-8' });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    const guiNext = JSON.parse(r.stdout).data;
    expect(guiNext.proposal_step).toBe('ready-to-delta');
    expect(guiNext.action).toContain('批准');
  });
});

// ── S17：module rename ─────────────────────────────────────────────────────────

describe('S17 module rename 跨平台路径', () => {
  it('UT-S17-07: 改名目标路径由 path API 推导', () => {
    const src = 'C:\\p\\logos\\resources\\prd\\1-product-requirements\\core-01-requirements.md';
    const target = renamedModuleFilePath(src, 'core', 'billing', win32);
    expect(target).toBe('C:\\p\\logos\\resources\\prd\\1-product-requirements\\billing-01-requirements.md');
    expect(win32.dirname(target)).toBe(win32.dirname(src));
    expect(win32.basename(target)).toBe('billing-01-requirements.md');
    // 必红对照：修复前以 lastIndexOf('/') 拆解，反斜杠路径下 dir='' 、base=整条路径
    const legacyBase = src.substring(src.lastIndexOf('/') + 1);
    const legacyTarget = win32.join(src.substring(0, src.lastIndexOf('/')), `billing-${legacyBase.slice('core'.length + 1)}`);
    expect(legacyTarget).not.toBe(target);
    expect(win32.isAbsolute(legacyTarget)).toBe(false);
    // POSIX 语义不变
    expect(renamedModuleFilePath('/p/logos/resources/a/core-02-x.md', 'core', 'billing', posix))
      .toBe('/p/logos/resources/a/billing-02-x.md');
  });

  it('UT-S17-08: 多级目录、多文件改名与引用更新正常完成', () => {
    const root = tempProject();
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
      'modules:', '  - id: core', '    name: core', '    lifecycle: initial', '',
    ].join('\n'));
    const files = [
      'logos/resources/prd/1-product-requirements/core-01-requirements.md',
      'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/deep/core-S01-x.md',
    ];
    files.forEach((f, i) => writeAt(root, f, `# 文档 ${i}\n`));
    writeAt(root, 'logos/resources/prd/index.md', '见 core-01-requirements.md 与 core-S01-x.md\n');
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try { moduleRename('core', 'billing'); } finally { cap.restore(); restoreCwd(); }

    expect(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')).toContain('id: billing');
    for (const f of files) {
      const oldAbs = join(root, ...f.split('/'));
      const newAbs = join(dirname(oldAbs), posix.basename(f).replace(/^core-/, 'billing-'));
      expect(existsSync(oldAbs), f).toBe(false);
      expect(existsSync(newAbs), f).toBe(true);
      expect(readFileSync(newAbs, 'utf-8')).toBe(`# 文档 ${files.indexOf(f)}\n`);
    }
    expect(readFileSync(join(root, 'logos/resources/prd/index.md'), 'utf-8'))
      .toBe('见 billing-01-requirements.md 与 billing-S01-x.md\n');
    const out = cap.logs.join('\n');
    // 日志为项目相对 / 分隔路径，不含项目根绝对前缀
    expect(out).toContain('logos/resources/prd/1-product-requirements/core-01-requirements.md → billing-01-requirements.md');
    expect(out).toContain('logos/resources/prd/index.md');
    expect(out).not.toContain(root);
  });

  it('ST-S17-04: 真实 module rename（Windows 回归集）', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
    const root = tempProject();
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
      'modules:', '  - id: core', '    name: core', '    lifecycle: initial', '',
    ].join('\n'));
    const files = [
      'logos/resources/prd/1-product-requirements/core-01-requirements.md',
      'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
      'logos/resources/test/core-S01-test-cases.md',
    ];
    for (const f of files) writeAt(root, f);
    const r = spawnSync(process.execPath, [CLI_ENTRY, 'module', 'rename', 'core', 'billing'], { cwd: root, encoding: 'utf-8' });
    expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')).toContain('id: billing');
    const all: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p); else all.push(p.slice(root.length + 1).split(sep).join('/'));
      }
    };
    walk(join(root, 'logos', 'resources'));
    for (const f of files) {
      expect(all).not.toContain(f);
      expect(all).toContain(`${posix.dirname(f)}/${posix.basename(f).replace(/^core-/, 'billing-')}`);
    }
    expect(all.filter(f => posix.basename(f).startsWith('core-'))).toEqual([]);
  });
});

// ── S31：slice done 产物路径 ───────────────────────────────────────────────────

describe('S31 slice done 产物路径跨平台归一', () => {
  it('UT-S31-37: Windows 绝对路径归一为项目相对路径', () => {
    const root = 'C:\\p';
    expect(relFromRoot(root, 'C:\\p\\cli\\src\\a.ts', win32)).toBe('cli/src/a.ts');
    expect(relFromRoot(root, 'c:\\p\\cli\\src\\b.ts', win32)).toBe('cli/src/b.ts');
    expect(relFromRoot(root, 'C:/p/cli/src/c.ts', win32)).toBe('cli/src/c.ts');
    expect(relFromRoot(root, 'cli\\src\\d.ts', win32)).toBe('cli/src/d.ts');
    // 必红对照：修复前实现只把 '/' 开头视为绝对路径，前三者走相对分支后保留盘符（判越界）
    const legacy = (artifact: string) => {
      const normalized = artifact.replace(/\\/g, '/').trim();
      return normalized.startsWith('/') ? 'abs' : posix.normalize(normalized);
    };
    expect(legacy('C:\\p\\cli\\src\\a.ts')).toBe('C:/p/cli/src/a.ts');
  });

  it('UT-S31-38: 项目外绝对路径与 posix 行为不变', () => {
    // ① win32 项目外（另一盘符）→ 原样返回，由调用方判越界
    const outside = relFromRoot('C:\\p', 'D:\\other\\x.ts', win32);
    expect(outside).toBe('D:/other/x.ts');
    expect(outside.startsWith('cli/')).toBe(false);
    // ② posix：与修复前逐条相同
    expect(relFromRoot('/p', '/p/cli/src/a.ts', posix)).toBe('cli/src/a.ts');
    expect(relFromRoot('/p', '/other/x.ts', posix)).toBe('/other/x.ts');
    expect(relFromRoot('/p', 'cli/src/a.ts', posix)).toBe('cli/src/a.ts');
    expect(relFromRoot('/p', './cli/src/a.ts', posix)).toBe('cli/src/a.ts');
  });
});

// ── S33：baseline-seed journal 恢复路径大小写 ──────────────────────────────────

describe('S33 baseline-seed journal 恢复路径大小写跨平台', () => {
  const runId = 'core-20260928-001';
  it('UT-S33-61: win32 下备份路径比较大小写不敏感', () => {
    const journalPath = `C:\\Proj\\logos\\resources\\verify\\baseline-seed-runs\\${runId}\\backup\\logos-project.yaml`;
    const base = `c:\\proj\\logos\\resources\\verify\\baseline-seed-runs\\${runId}\\backup`;
    expect(isWithinBackupBase(journalPath, base, 'win32')).toBe(true);
    // 与 canonical-target 既有 toLocaleLowerCase('en-US') 口径同源
    expect(platformPathKey('C:\\Proj', 'win32')).toBe('C:\\Proj'.toLocaleLowerCase('en-US'));
    expect(platformPathKey('C:\\Proj', 'linux')).toBe('C:\\Proj');
    // 必红对照：修复前区分大小写的 startsWith 判为越界
    expect(win32.normalize(journalPath).startsWith(base + win32.sep)).toBe(false);
  });

  it('UT-S33-62: 越界判定不放宽、非 win32 保持区分大小写', () => {
    const base = `C:\\Proj\\logos\\resources\\verify\\baseline-seed-runs\\${runId}\\backup`;
    expect(isWithinBackupBase(`C:\\Proj\\..\\Other\\x.yaml`, base, 'win32')).toBe(false);
    expect(isWithinBackupBase(`D:\\Proj\\logos\\resources\\verify\\baseline-seed-runs\\${runId}\\backup\\x.yaml`, base, 'win32')).toBe(false);
    expect(isWithinBackupBase(`${base}\\..\\..\\x.yaml`, base, 'win32')).toBe(false);
    expect(isWithinBackupBase('relative\\x.yaml', base, 'win32')).toBe(false);
    const posixBase = `/proj/logos/resources/verify/baseline-seed-runs/${runId}/backup`;
    expect(isWithinBackupBase(`${posixBase}/logos-project.yaml`, posixBase, 'linux')).toBe(true);
    expect(isWithinBackupBase(`/PROJ/logos/resources/verify/baseline-seed-runs/${runId}/backup/x.yaml`, posixBase, 'linux')).toBe(false);
  });
});
