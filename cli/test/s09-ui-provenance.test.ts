/**
 * proposal-ui-ux-first 切片2：落盘完整性防漂移。
 * PLAN_APPROVED 可选 body / check-ui-hash-match 三分支 / merge 命令级 hash gate /
 * commitVerifiedPrototypes 事务落盘 + journal 崩溃恢复。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  readPlanApproved, writePlanApprovedMarker, classifyProvenance, computePrototypeHashes,
  checkUiHashMatch, commitVerifiedPrototypes, recoverCommitJournal, isFullProvenanceValid,
  PROTOTYPE_DELTA_SUBPATH, PROTOTYPE_RESOURCE_SUBPATH, COMMIT_JOURNAL,
} from '../src/lib/ui-provenance.js';
import { merge } from '../src/commands/merge.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function guiProject(root: string, slug: string, opts: {
  uiImpact?: boolean; productType?: string; module?: string;
} = {}) {
  scaffoldProject(root);
  const module = opts.module ?? 'core';
  const pt = opts.productType ?? 'web';
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    `project:\n  name: t\nmodules:\n  - id: ${module}\n    name: ${module}\n    lifecycle: launched\n    product_type: ${pt}\n`);
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module }));
  const proposalDir = join(root, 'logos', 'changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  const uiImpact = opts.uiImpact ?? true;
  writeFileSync(join(proposalDir, 'proposal.md'),
    `# ${slug}\n\n## UI/UX 变更声明\n\n\`\`\`yaml\nui_impact: ${uiImpact}\ndesign_system_mode: generated\npages:\n  - id: home\n    prototype: core-01-home.html\n    description: home\n\`\`\`\n`);
  return proposalDir;
}

function writePrototype(proposalDir: string, basename: string, content: string): string {
  const dir = join(proposalDir, PROTOTYPE_DELTA_SUBPATH);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, basename);
  writeFileSync(p, content);
  return p;
}

describe('S09 切片2 — provenance 载体向后兼容（F3、F4）', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; restoreCwd = mockCwd(root); con = captureConsole(); });
  afterEach(() => { con.restore(); restoreCwd(); cleanup(); });

  it('UT-S09-82: writePlanApproved 空写仍合法（存在性语义不变）', () => {
    const dir = join(root, 'logos', 'changes', 'x'); mkdirSync(dir, { recursive: true });
    writePlanApprovedMarker(dir);
    const prov = readPlanApproved(dir);
    expect(prov.present).toBe(true);
    expect(prov.empty).toBe(true);
    expect(classifyProvenance(prov)).toBe('legacy');
    // 二次空写不覆盖已有
    writePlanApprovedMarker(dir);
    expect(readPlanApproved(dir).present).toBe(true);
  });

  it('UT-S09-83: 可选 JSON body 不破坏仅存在性读取', () => {
    const dir = join(root, 'logos', 'changes', 'x'); mkdirSync(dir, { recursive: true });
    writePlanApprovedMarker(dir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('a') } });
    const prov = readPlanApproved(dir);
    expect(prov.present).toBe(true);            // 门已过，仅存在性读取不受影响
    expect(prov.empty).toBe(false);
    expect(prov.ui_prototype_rendered).toBe(true);
  });

  it('UT-S09-85: provenance 绑定 hash 记录批准时刻内容', () => {
    const dir = join(root, 'logos', 'changes', 'x'); mkdirSync(dir, { recursive: true });
    const h = sha('home-content');
    writePlanApprovedMarker(dir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': h } });
    const prov = readPlanApproved(dir);
    expect(prov.ui_prototype_rendered).toBe(true);
    expect(prov.pages).toEqual(['core-01-home.html']);
    expect(prov.hashes).toEqual({ 'core-01-home.html': h });
  });

  it('UT-S09-85h: PLAN_APPROVED.pages/hashes 键与声明 basename 一致', () => {
    const dir = join(root, 'logos', 'changes', 'x'); mkdirSync(dir, { recursive: true });
    const pages = ['core-01-home.html', 'core-02-detail.html'];
    const hashes = { 'core-01-home.html': sha('a'), 'core-02-detail.html': sha('b') };
    writePlanApprovedMarker(dir, { ui_prototype_rendered: true, pages, hashes });
    const prov = readPlanApproved(dir);
    expect(Object.keys(prov.hashes!).sort()).toEqual(prov.pages!.slice().sort());  // 同一 basename 键空间
  });
});

describe('S09 切片2 — check-ui-hash-match 三分支（F4 R4/R7）', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());

  function setup(slug: string, content: string, provHash?: string, rendered = true): string {
    const proposalDir = guiProject(root, slug);
    writePrototype(proposalDir, 'core-01-home.html', content);
    if (provHash !== undefined) {
      writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: rendered, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': provHash } });
    }
    return proposalDir;
  }

  it('UT-S09-87: F6 match — 完整 provenance 且 hash 匹配 → ok（exit0 语义）', () => {
    const dir = setup('m', 'HOME', sha('HOME'));
    const r = checkUiHashMatch(dir);
    expect(r.ok).toBe(true); expect(r.cls).toBe('full'); expect(r.code).toBe('match');
  });

  it('UT-S09-88: hash 失配 → fail closed（未 done 阻断）', () => {
    const dir = setup('d', 'DRIFTED', sha('HOME'));  // 批准 hash 是 HOME，现值 DRIFTED
    const r = checkUiHashMatch(dir);
    expect(r.ok).toBe(false); expect(r.code).toBe('hash_content_mismatch');
  });

  it('UT-S09-88a: F6 partial — rendered:true 但缺 hashes → fail closed', () => {
    const proposalDir = guiProject(root, 'p');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    // 部分 provenance：rendered true 但无 hashes
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), JSON.stringify({ ui_prototype_rendered: true, pages: ['core-01-home.html'] }));
    const r = checkUiHashMatch(proposalDir);
    expect(r.ok).toBe(false); expect(r.cls).toBe('partial'); expect(r.code).toBe('partial_provenance_fail_closed');
  });

  it('UT-S09-84: legacy 空 marker（无曾渲染证据）→ 记 advisory 后 ok（exit0）', () => {
    const proposalDir = guiProject(root, 'leg');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');  // 空 marker
    const r = checkUiHashMatch(proposalDir);
    expect(r.ok).toBe(true); expect(r.advisory).toBe(true); expect(r.cls).toBe('legacy');
  });

  it('UT-S09-94: 对照组 — 空 marker 经节点 advisory exit0 达 merge（与 88a fail 对照）', () => {
    const proposalDir = guiProject(root, 'leg2');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');
    expect(checkUiHashMatch(proposalDir).ok).toBe(true);       // legacy advisory
    // 对照：partial 则 fail
    const p2 = guiProject(root, 'leg2b');
    writeFileSync(join(p2, 'PLAN_APPROVED'), JSON.stringify({ ui_prototype_rendered: true }));
    expect(checkUiHashMatch(p2).ok).toBe(false);
  });

  it('UT-S09-90: 失配后刷新 PLAN_APPROVED.hashes → 再匹配放行', () => {
    const dir = setup('r', 'V2', sha('V1'));            // 先失配（批准 V1、现值 V2）
    expect(checkUiHashMatch(dir).ok).toBe(false);
    // 显式重入 plan：重批刷新 hashes 到 V2
    writePlanApprovedMarker(dir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('V2') } });
    expect(checkUiHashMatch(dir).ok).toBe(true);
  });

  it('UT-S09-93: 强制语义不读会话 capability（有无 capability 文件结果一致）', () => {
    const dir = setup('c', 'DRIFTED', sha('HOME'));    // full 失配
    // 无 capability 文件 → fail
    expect(checkUiHashMatch(dir).ok).toBe(false);
    // 写 capability 文件（渲染就绪）→ 仍 fail（强制语义键=持久化 provenance，不因 capability 降级）
    writeFileSync(join(root, 'logos', '.session-capabilities.json'), JSON.stringify({ ui_prototype_render: true }));
    expect(checkUiHashMatch(dir).ok).toBe(false);
    // 删 capability 文件 → 仍 fail
    rmSync(join(root, 'logos', '.session-capabilities.json'), { force: true });
    expect(checkUiHashMatch(dir).ok).toBe(false);
  });

  it('UT-S09-86 / UT-S09-89: verify-ui-provenance overlay 结构（merge 前、单 done_when:cmd）', () => {
    // 复用真实 overlay 源断言（与 slice1 flow 覆盖同 ID，结构性）
    const REPO = join(__dirname, '..', '..');
    const overlay = readFileSync(join(REPO, 'spec', 'flow', 'overlays', 'gui-ui-first.yaml'), 'utf-8');
    expect(overlay).toContain('verify-ui-provenance');
    expect(overlay).toContain('before: generate-merge-prompt');   // merge 之前
    expect(overlay).toContain('done_when: "cmd:openlogos check-ui-hash-match"');
    expect(/^\s*fail_when:/m.test(overlay)).toBe(false);           // 单 done_when:cmd（无 fail_when 键，决策 B 规避）
  });
});

describe('S09 切片2 — commitVerifiedPrototypes 事务落盘（F1 R2/R3）', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());

  function fullProposal(slug: string, files: Record<string, string>): string {
    const proposalDir = guiProject(root, slug);
    const hashes: Record<string, string> = {};
    for (const [bn, content] of Object.entries(files)) { writePrototype(proposalDir, bn, content); hashes[bn] = sha(content); }
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: Object.keys(files), hashes });
    return proposalDir;
  }

  it('UT-S09-96: commitVerifiedPrototypes 为原型落盘唯一入口（落入 resources）', () => {
    const dir = fullProposal('a', { 'core-01-home.html': 'HOME' });
    const r = commitVerifiedPrototypes(dir, root);
    expect(r.ok).toBe(true); expect(r.committed).toEqual(['core-01-home.html']);
    const landed = join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html');
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, 'utf-8')).toBe('HOME');
    expect(computePrototypeHashes(join(root, PROTOTYPE_RESOURCE_SUBPATH))['core-01-home.html']).toBe(sha('HOME'));
  });

  it('UT-S09-96a: advisory 分支也经同一入口落盘（不做严格 hash 校验）', () => {
    const proposalDir = guiProject(root, 'adv');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');   // legacy → advisory
    const r = commitVerifiedPrototypes(proposalDir, root);
    expect(r.ok).toBe(true); expect(r.advisory).toBe(true); expect(r.cls).toBe('legacy');
    expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'))).toBe(true);
  });

  it('UT-S09-97: 三段事务 — 全量校验先于任何写入（其一失配即全 abort）', () => {
    const proposalDir = guiProject(root, 'multi');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writePrototype(proposalDir, 'core-02-detail.html', 'DETAIL-DRIFTED');
    writePlanApprovedMarker(proposalDir, {
      ui_prototype_rendered: true, pages: ['core-01-home.html', 'core-02-detail.html'],
      hashes: { 'core-01-home.html': sha('HOME'), 'core-02-detail.html': sha('DETAIL') },  // detail 现值漂移
    });
    const r = commitVerifiedPrototypes(proposalDir, root);
    expect(r.ok).toBe(false); expect(r.reason).toBe('hash_mismatch');
    // 无部分落盘：连匹配的 home 也没落
    expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'))).toBe(false);
    expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-02-detail.html'))).toBe(false);
  });

  it('UT-S09-98: 校验 staged 字节 — 源在校验后再变不影响已提交快照', () => {
    const dir = fullProposal('staged', { 'core-01-home.html': 'HOME' });
    const r = commitVerifiedPrototypes(dir, root);
    expect(r.ok).toBe(true);
    // 落盘的是 staged 快照 == 已校验字节
    expect(readFileSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'), 'utf-8')).toBe('HOME');
  });

  it('UT-S09-95 / ST-S09-EX-9.3: full provenance staged hash 失配 → 落盘门 fail closed、零残留', () => {
    const proposalDir = guiProject(root, 'gate');
    writePrototype(proposalDir, 'core-01-home.html', 'DRIFTED');
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    const r = commitVerifiedPrototypes(proposalDir, root);
    expect(r.ok).toBe(false);
    expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'))).toBe(false);  // resources 零残留
  });

  it('UT-S09-101: 失败回滚零残留（已有 target 时回滚到 merge 前内容）', () => {
    // 预置 resources 已有旧原型
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'core-01-home.html'), 'OLD');
    const proposalDir = guiProject(root, 'rb');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writePrototype(proposalDir, 'core-02-detail.html', 'DRIFTED');
    writePlanApprovedMarker(proposalDir, {
      ui_prototype_rendered: true, pages: ['core-01-home.html', 'core-02-detail.html'],
      hashes: { 'core-01-home.html': sha('HOME'), 'core-02-detail.html': sha('DETAIL') },
    });
    const r = commitVerifiedPrototypes(proposalDir, root);
    expect(r.ok).toBe(false);
    // 旧 home 内容保持（回到 merge 前态）
    expect(readFileSync(join(targetDir, 'core-01-home.html'), 'utf-8')).toBe('OLD');
  });

  it('UT-S09-99: commit journal 崩溃恢复 — 前滚补完', () => {
    const dir = fullProposal('fwd', { 'core-01-home.html': 'HOME', 'core-02-detail.html': 'DETAIL' });
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    // 手工模拟中途崩溃：staged 存在、journal 一条 done 一条未 done
    const stagingDir = join(dir, '.ui-commit-staging'); mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'core-02-detail.html'), 'DETAIL');       // 未提交的 staged
    writeFileSync(join(targetDir, 'core-01-home.html'), 'HOME');            // 已提交
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent: 'commit', targets: [
      { basename: 'core-01-home.html', staged: join(stagingDir, 'core-01-home.html'), target: join(targetDir, 'core-01-home.html'), backup: null, done: true },
      { basename: 'core-02-detail.html', staged: join(stagingDir, 'core-02-detail.html'), target: join(targetDir, 'core-02-detail.html'), backup: null, done: false },
    ] }));
    const outcome = recoverCommitJournal(dir);
    expect(outcome).toBe('rolled_forward');
    expect(existsSync(join(targetDir, 'core-02-detail.html'))).toBe(true);  // 前滚补完
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(false);              // journal 已清
  });

  it('UT-S09-100 / ST-S09-38: commit journal 崩溃恢复 — 回滚到全无', () => {
    const dir = fullProposal('bwd', { 'core-01-home.html': 'HOME' });
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    const backupDir = join(dir, '.ui-commit-backup'); mkdirSync(backupDir, { recursive: true });
    // 崩溃：已提交 home（target 存在、有 backup=OLD），无 staged 可前滚
    writeFileSync(join(targetDir, 'core-01-home.html'), 'HOME');
    writeFileSync(join(backupDir, 'core-01-home.html'), 'OLD');
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent: 'abort', targets: [
      { basename: 'core-01-home.html', staged: join(dir, '.ui-commit-staging', 'core-01-home.html'), target: join(targetDir, 'core-01-home.html'), backup: join(backupDir, 'core-01-home.html'), done: true },
      { basename: 'core-02-x.html', staged: join(dir, '.ui-commit-staging', 'core-02-x.html'), target: join(targetDir, 'core-02-x.html'), backup: null, done: false },
    ] }));
    const outcome = recoverCommitJournal(dir);
    expect(outcome).toBe('rolled_back');
    expect(readFileSync(join(targetDir, 'core-01-home.html'), 'utf-8')).toBe('OLD');  // 回滚到全无（还原 backup）
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(false);
  });

  it('UT-S09-102: apply-merge 后复核 hash 一致（成功路径落盘 hash == provenance）', () => {
    const dir = fullProposal('post', { 'core-01-home.html': 'HOME' });
    const r = commitVerifiedPrototypes(dir, root);
    expect(r.ok).toBe(true);
    const landed = computePrototypeHashes(join(root, PROTOTYPE_RESOURCE_SUBPATH));
    expect(landed['core-01-home.html']).toBe(readPlanApproved(dir).hashes!['core-01-home.html']);
  });
});

describe('S09 切片2 — merge 命令级 hash gate 与 F3 段标记（F4 R5/R7、F3）', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; restoreCwd = mockCwd(root);
    con = captureConsole(); exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  it('UT-S09-91 / UT-S09-92 / ST-S09-36: ui_impact 漂移 → merge 命令级拒绝、不生成 MERGE_PROMPT/SPEC_MERGED', () => {
    const proposalDir = guiProject(root, 'drift');
    writePrototype(proposalDir, 'core-01-home.html', 'DRIFTED');
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    // 跨会话：删 capability 文件（本就无）——强制语义仍拒绝
    expect(() => merge('drift')).toThrow('process.exit(1)');
    expect(existsSync(join(proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(con.errors.join('\n')).toContain('UI provenance');
  });

  it('UT-S09-95(merge) / SMOKE-core-39: ui_impact 匹配 → 原型经 commitVerifiedPrototypes 落盘、merge 成功', () => {
    const proposalDir = guiProject(root, 'ok');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    merge('ok');
    // 原型落入 resources（唯一入口）
    const landed = join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html');
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, 'utf-8')).toBe('HOME');
    // 全为原型资产 → 写 SPEC_MERGED、不生成 MERGE_PROMPT（原型不进 prompt，merge-executor 不碰）
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(existsSync(join(proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
  });

  it('ST-S09-37: 对照组 — 旧空 marker（legacy）advisory 放行、merge 不拒绝', () => {
    const proposalDir = guiProject(root, 'legacy');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');  // 空 marker → advisory
    merge('legacy');  // 不抛（不 exit1）
    expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'))).toBe(true);  // advisory 仍经唯一入口落盘
  });

  it('ST-S09-EX-9.1 / SMOKE-core-41: 无段标记 .md delta → merge 报错停下、不写 SPEC_MERGED', () => {
    scaffoldProject(root);
    const proposalDir = join(root, 'logos', 'changes', 'badmd');
    mkdirSync(join(proposalDir, 'deltas', 'prd', '2-product-design', '1-feature-specs'), { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# bad');
    writeFileSync(join(proposalDir, 'deltas', 'prd', '2-product-design', '1-feature-specs', 'core-01-feature-specs.md'), '# 无段标记正文，缺 ADDED/MODIFIED/REMOVED');
    expect(() => merge('badmd')).toThrow('process.exit(1)');
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(con.errors.join('\n')).toContain('段标记');
  });

  it('ST-S09-EX-9.5: 提示前 gate 与落盘门一致 fail closed（同一持久化判据）', () => {
    // 提示前 gate（merge 命令）与 commitVerifiedPrototypes 落盘门对同一漂移原型均 fail closed
    const proposalDir = guiProject(root, 'depth');
    writePrototype(proposalDir, 'core-01-home.html', 'DRIFTED');
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    expect(checkUiHashMatch(proposalDir).ok).toBe(false);              // 提示前
    expect(commitVerifiedPrototypes(proposalDir, root).ok).toBe(false); // 落盘时
    expect(() => merge('depth')).toThrow('process.exit(1)');           // 命令级
  });
});

describe('S09 切片2 — ST-34/35 provenance 写入与漂移阻断', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());

  it('ST-S09-34: 批准即 UI 确认 — 面板写 provenance body（openlogos 支持读取）', () => {
    const proposalDir = guiProject(root, 'approve');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    // 模拟渲染面板批准写 body
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    const prov = readPlanApproved(proposalDir);
    expect(classifyProvenance(prov)).toBe('full');   // 曾渲染确认
    expect(checkUiHashMatch(proposalDir).ok).toBe(true);
  });

  it('ST-S09-35: 批准后漂移经 verify-ui-provenance 阻断，刷新后放行', () => {
    const proposalDir = guiProject(root, 'drift2');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    // 批准后漂移
    writeFileSync(join(proposalDir, PROTOTYPE_DELTA_SUBPATH, 'core-01-home.html'), 'DRIFTED');
    expect(checkUiHashMatch(proposalDir).ok).toBe(false);   // 阻断
    // 显式重入 plan 刷新
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('DRIFTED') } });
    expect(checkUiHashMatch(proposalDir).ok).toBe(true);    // 放行
  });
});

// ── code-r1 修复 ─────────────────────────────────────────────────────────────

describe('S09 code-r1 F3 — full provenance 必须含合法 pages 且与 hashes/声明一致', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());

  const full = (o: Record<string, unknown>) => ({ present: true, empty: false, ui_prototype_rendered: true, ...o } as any);

  it('F3-1: 有 hashes 但缺 pages → 非 full（partial，fail closed）', () => {
    const prov = full({ hashes: { 'core-01-home.html': sha('a') } });   // 无 pages
    expect(isFullProvenanceValid(prov)).toBe(false);
    expect(classifyProvenance(prov)).toBe('partial');
  });

  it('F3-2: pages 为空数组 → partial', () => {
    expect(classifyProvenance(full({ pages: [], hashes: { 'core-01-home.html': sha('a') } }))).toBe('partial');
  });

  it('F3-3: pages 重复 basename → partial', () => {
    expect(classifyProvenance(full({ pages: ['core-01-home.html', 'core-01-home.html'], hashes: { 'core-01-home.html': sha('a') } }))).toBe('partial');
  });

  it('F3-4: pages 含非法/路径穿越 basename → partial', () => {
    expect(classifyProvenance(full({ pages: ['../etc/x.html'], hashes: { '../etc/x.html': sha('a') } }))).toBe('partial');
  });

  it('F3-5: pages 集合 != hashes 键集合 → partial', () => {
    expect(classifyProvenance(full({ pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('a'), 'core-02-detail.html': sha('b') } }))).toBe('partial');
  });

  it('F3-6: pages/hashes 一致且合法 → full', () => {
    expect(classifyProvenance(full({ pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('a') } }))).toBe('full');
  });

  it('F3-7: checkUiHashMatch — 批准 pages 与 proposal 声明集合不一致 → fail closed', () => {
    // 声明只声明 home（guiProject 默认），但 PLAN_APPROVED 批准了 home+detail（full、pages==hashes）
    const proposalDir = guiProject(root, 'decl');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writePrototype(proposalDir, 'core-02-detail.html', 'DETAIL');
    writePlanApprovedMarker(proposalDir, {
      ui_prototype_rendered: true, pages: ['core-01-home.html', 'core-02-detail.html'],
      hashes: { 'core-01-home.html': sha('HOME'), 'core-02-detail.html': sha('DETAIL') },
    });
    const r = checkUiHashMatch(proposalDir);
    expect(r.ok).toBe(false); expect(r.code).toBe('pages_declaration_mismatch');
  });

  it('F3-8: 损坏批准记录（有 hashes 恰好匹配目录但无 pages）→ merge/落盘 fail closed', () => {
    const proposalDir = guiProject(root, 'nopages');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), JSON.stringify({ ui_prototype_rendered: true, hashes: { 'core-01-home.html': sha('HOME') } }));  // 无 pages
    expect(checkUiHashMatch(proposalDir).ok).toBe(false);              // partial → fail closed
    expect(commitVerifiedPrototypes(proposalDir, root).ok).toBe(false);
  });
});

describe('S09 code-r1 F2 — guard/module 解析失败不得静默跳过 UI 强制门', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; restoreCwd = mockCwd(root);
    con = captureConsole(); exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  function driftedFull(slug: string): string {
    const proposalDir = guiProject(root, slug);
    writePrototype(proposalDir, 'core-01-home.html', 'DRIFTED');   // 批准后漂移
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    return proposalDir;
  }

  it('F2-1: guard 缺失 → full provenance 漂移仍被 merge 拒绝（触发键=持久化 PLAN_APPROVED）', () => {
    const proposalDir = driftedFull('noguard');
    rmSync(join(root, 'logos', '.openlogos-guard'), { force: true });   // 删 guard
    expect(() => merge('noguard')).toThrow('process.exit(1)');
    expect(existsSync(join(proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
  });

  it('F2-2: guard 损坏（非法 JSON）→ 漂移仍被拒绝、不绕过', () => {
    const proposalDir = driftedFull('corrupt');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), '{ not json');
    expect(() => merge('corrupt')).toThrow('process.exit(1)');
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
  });

  it('F2-3: guard 缺 module → 漂移仍被拒绝', () => {
    const proposalDir = driftedFull('nomod');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'nomod' }));  // 无 module
    expect(() => merge('nomod')).toThrow('process.exit(1)');
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
  });

  it('F2-4: guard.activeChange 指向别的提案 → merge 拒绝（slug 一致性）', () => {
    const proposalDir = guiProject(root, 'target');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'other-proposal', module: 'core' }));
    expect(() => merge('target')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('不一致');
    expect(existsSync(join(proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
  });
});

describe('S09 code-r1 F1 — merge 生产路径消化残留 commit journal（崩溃恢复接线）', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; restoreCwd = mockCwd(root); con = captureConsole(); });
  afterEach(() => { con.restore(); restoreCwd(); cleanup(); });

  it('F1-1: merge 启动前滚补完残留 journal（前一事务未完成的 rename）', () => {
    const proposalDir = guiProject(root, 'crashfwd');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    // 残留：上次崩溃遗留 journal + staged（前滚可补完）
    const stagingDir = join(proposalDir, '.ui-commit-staging'); mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'core-09-legacy.html'), 'LEGACY');
    writeFileSync(join(proposalDir, COMMIT_JOURNAL), JSON.stringify({ intent: 'commit', targets: [
      { basename: 'core-09-legacy.html', staged: join(stagingDir, 'core-09-legacy.html'), target: join(targetDir, 'core-09-legacy.html'), backup: null, done: false },
    ] }));
    merge('crashfwd');
    // 残留 journal 已被消化（前滚），且在新事务开始前
    expect(existsSync(join(proposalDir, COMMIT_JOURNAL))).toBe(false);
    expect(existsSync(join(targetDir, 'core-09-legacy.html'))).toBe(true);   // 前滚补完
    expect(con.logs.join('\n')).toContain('journal');
    // 当前 merge 亦正常落盘 home
    expect(existsSync(join(targetDir, 'core-01-home.html'))).toBe(true);
  });

  it('F1-2: merge 启动回滚残留 journal（无法前滚 → 还原 backup 到全无态）', () => {
    const proposalDir = guiProject(root, 'crashbwd');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writePlanApprovedMarker(proposalDir, { ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME') } });
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    const backupDir = join(proposalDir, '.ui-commit-backup'); mkdirSync(backupDir, { recursive: true });
    // 残留：已提交 legacy（target 存在、backup=OLD），另一条 pending 但 staged 丢失 → 只能回滚
    writeFileSync(join(targetDir, 'core-09-legacy.html'), 'NEW');
    writeFileSync(join(backupDir, 'core-09-legacy.html'), 'OLD');
    writeFileSync(join(proposalDir, COMMIT_JOURNAL), JSON.stringify({ intent: 'abort', targets: [
      { basename: 'core-09-legacy.html', staged: join(proposalDir, '.ui-commit-staging', 'core-09-legacy.html'), target: join(targetDir, 'core-09-legacy.html'), backup: join(backupDir, 'core-09-legacy.html'), done: true },
      { basename: 'core-10-gone.html', staged: join(proposalDir, '.ui-commit-staging', 'core-10-gone.html'), target: join(targetDir, 'core-10-gone.html'), backup: null, done: false },
    ] }));
    merge('crashbwd');
    expect(existsSync(join(proposalDir, COMMIT_JOURNAL))).toBe(false);
    expect(readFileSync(join(targetDir, 'core-09-legacy.html'), 'utf-8')).toBe('OLD');  // 回滚还原
  });
});

// ── code-r2 深化：损坏输入/事实源缺失边界 fail closed ─────────────────────────

describe('S09 code-r2 F1 — 损坏/越界 journal 一律 fail closed（保留诊断材料）', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());
  const mkProposal = (slug: string) => { const d = join(root, 'logos', 'changes', slug); mkdirSync(d, { recursive: true }); return d; };

  it('F1r2-1: 截断/损坏 JSON journal → failed，不删除 journal（保留恢复意图）', () => {
    const dir = mkProposal('trunc');
    writeFileSync(join(dir, COMMIT_JOURNAL), '{ "targets": [ { "basename": "core-01-home.html", ');  // 截断
    expect(recoverCommitJournal(dir)).toBe('failed');
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(true);   // 未删除
  });

  it('F1r2-2: targets 非数组 → failed', () => {
    const dir = mkProposal('nonarr');
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ targets: 'nope' }));
    expect(recoverCommitJournal(dir)).toBe('failed');
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(true);
  });

  it('F1r2-3: target 路径越界（page-design resources 之外）→ failed，不动任何文件', () => {
    const dir = mkProposal('escape');
    const evil = join(root, 'evil.html');   // 越界目标（不在 targetDir 下）
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent: 'commit', targets: [
      { basename: 'core-01-home.html', staged: join(dir, '.ui-commit-staging', 'core-01-home.html'), target: evil, backup: null, done: false },
    ] }));
    expect(recoverCommitJournal(dir)).toBe('failed');
    expect(existsSync(evil)).toBe(false);   // 未写越界路径
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(true);
  });

  it('F1r2-4: backup 路径越界 → failed', () => {
    const dir = mkProposal('escbak');
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH);
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent: 'commit', targets: [
      { basename: 'core-01-home.html', staged: join(dir, '.ui-commit-staging', 'core-01-home.html'), target: join(targetDir, 'core-01-home.html'), backup: join(root, 'evil-backup.html'), done: true },
    ] }));
    expect(recoverCommitJournal(dir)).toBe('failed');
  });

  it('F1r2-5: merge 遇损坏 journal → fail closed（exit1、不写 SPEC_MERGED、保留 journal）', () => {
    const restoreCwd = mockCwd(root); const con = captureConsole(); const exitSpy = mockProcessExit();
    try {
      const proposalDir = guiProject(root, 'badj');
      writeFileSync(join(proposalDir, COMMIT_JOURNAL), '{ truncated');
      expect(() => merge('badj')).toThrow('process.exit(1)');
      expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
      expect(existsSync(join(proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
      expect(existsSync(join(proposalDir, COMMIT_JOURNAL))).toBe(true);   // 诊断材料保留
    } finally { con.restore(); exitSpy.mockRestore(); restoreCwd(); }
  });
});

describe('S09 code-r3 F1 — 恢复前滚逐项持久化 done，中途 I/O 失败收敛到全有或全无', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());
  const mkProposal = (slug: string) => { const d = join(root, 'logos', 'changes', slug); mkdirSync(d, { recursive: true }); return d; };

  it('F1r3-1: 前滚中途 rename 失败（B target 为非空目录 EISDIR）→ 立即回滚已提交 A 到全无态、不遗留部分提交', () => {
    const dir = mkProposal('midfail');
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    const stagingDir = join(dir, '.ui-commit-staging'); mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'core-01-home.html'), 'A-NEW');       // A：可提交
    writeFileSync(join(stagingDir, 'core-02-detail.html'), 'B-NEW');     // B：rename 必失败
    const bTargetDir = join(targetDir, 'core-02-detail.html'); mkdirSync(bTargetDir, { recursive: true });
    writeFileSync(join(bTargetDir, 'inner'), 'x');                        // 非空目录 → rename EISDIR
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent: 'commit', targets: [
      { basename: 'core-01-home.html', staged: join(stagingDir, 'core-01-home.html'), target: join(targetDir, 'core-01-home.html'), backup: null, done: false },
      { basename: 'core-02-detail.html', staged: join(stagingDir, 'core-02-detail.html'), target: bTargetDir, backup: null, done: false },
    ] }));
    const outcome = recoverCommitJournal(dir);
    expect(outcome).toBe('rolled_back');                                  // 中途失败 → 立即回滚到一致态
    expect(existsSync(join(targetDir, 'core-01-home.html'))).toBe(false); // A 已被回滚、无部分提交遗留
  });

  it('F1r3-2: 磁盘 journal 已持久化 A.done=true（A 已提交、staged 消失）→ 下次恢复前滚 B 收敛全新、不误回滚丢 A', () => {
    const dir = mkProposal('converge');
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    const stagingDir = join(dir, '.ui-commit-staging'); mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(targetDir, 'core-01-home.html'), 'A-NEW');        // A 已提交
    writeFileSync(join(stagingDir, 'core-02-detail.html'), 'B-NEW');     // B 未提交
    // 关键：磁盘 journal 记录 A.done=true（正是 code-r3 每步持久化所保证的真实状态）
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent: 'commit', targets: [
      { basename: 'core-01-home.html', staged: join(stagingDir, 'core-01-home.html'), target: join(targetDir, 'core-01-home.html'), backup: null, done: true },
      { basename: 'core-02-detail.html', staged: join(stagingDir, 'core-02-detail.html'), target: join(targetDir, 'core-02-detail.html'), backup: null, done: false },
    ] }));
    const outcome = recoverCommitJournal(dir);
    expect(outcome).toBe('rolled_forward');
    expect(readFileSync(join(targetDir, 'core-01-home.html'), 'utf-8')).toBe('A-NEW');   // A 未丢（旧 bug 会回滚丢 A）
    expect(readFileSync(join(targetDir, 'core-02-detail.html'), 'utf-8')).toBe('B-NEW'); // B 前滚补完
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(false);
  });
});

describe('S09 code-r4 F1 — 回滚中途失败：三处共用 abortTransaction，逐项持久化 + 保留材料 + 不谎报成功', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());
  const mkProposal = (slug: string) => { const d = join(root, 'logos', 'changes', slug); mkdirSync(d, { recursive: true }); return d; };

  // 构造「A/B 已提交、C pending、回滚 B 会失败（B.target 为非空目录 EISDIR）」的崩溃后 journal（恢复入口与 commit catch 共用同一回滚）。
  function setupRollbackFailure(dir: string) {
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    const stagingDir = join(dir, '.ui-commit-staging'); mkdirSync(stagingDir, { recursive: true });
    const backupDir = join(dir, '.ui-commit-backup'); mkdirSync(backupDir, { recursive: true });
    // A：done，backup=A-OLD（还原成功）
    writeFileSync(join(targetDir, 'core-01-a.html'), 'A-NEW');
    writeFileSync(join(backupDir, 'core-01-a.html'), 'A-OLD');
    // B：done，backup 存在，但 target 是非空目录 → 还原 copyFileSync EISDIR 失败
    const bTarget = join(targetDir, 'core-02-b.html'); mkdirSync(bTarget, { recursive: true }); writeFileSync(join(bTarget, 'inner'), 'x');
    writeFileSync(join(backupDir, 'core-02-b.html'), 'B-OLD');
    // C：pending，staged 丢失 → canRollForward=false → 走回滚分支
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent: 'abort', targets: [
      { basename: 'core-01-a.html', staged: join(stagingDir, 'core-01-a.html'), target: join(targetDir, 'core-01-a.html'), backup: join(backupDir, 'core-01-a.html'), done: true },
      { basename: 'core-02-b.html', staged: join(stagingDir, 'core-02-b.html'), target: bTarget, backup: join(backupDir, 'core-02-b.html'), done: true },
      { basename: 'core-03-c.html', staged: join(stagingDir, 'core-03-c.html'), target: join(targetDir, 'core-03-c.html'), backup: null, done: false },
    ] }));
    return { targetDir, stagingDir };
  }

  it('F1r4-1: 回滚某已提交项失败 → failed、保留材料、磁盘 journal 逐项反映真实进度（A 已回滚/B 未回滚）', () => {
    const dir = mkProposal('rbfail');
    const { targetDir, stagingDir } = setupRollbackFailure(dir);
    const outcome = recoverCommitJournal(dir);
    expect(outcome).toBe('failed');                       // 不谎报 rolled_back
    // 未达一致态 → 材料全部保留
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(true);
    expect(existsSync(stagingDir)).toBe(true);
    // 逐项持久化：A 已回滚（done:false）、B 回滚失败仍 done:true
    const j = JSON.parse(readFileSync(join(dir, COMMIT_JOURNAL), 'utf-8'));
    const done: Record<string, boolean> = Object.fromEntries(j.targets.map((t: { basename: string; done: boolean }) => [t.basename, t.done]));
    expect(done['core-01-a.html']).toBe(false);
    expect(done['core-02-b.html']).toBe(true);
    expect(readFileSync(join(targetDir, 'core-01-a.html'), 'utf-8')).toBe('A-OLD');   // A 已还原为旧内容
  });

  it('F1r4-1b: 再次调用恢复仍 failed、材料仍保留（未一致态前绝不删除，绝不收敛为新旧混合）', () => {
    const dir = mkProposal('rbfail2');
    const { stagingDir } = setupRollbackFailure(dir);
    expect(recoverCommitJournal(dir)).toBe('failed');
    expect(recoverCommitJournal(dir)).toBe('failed');     // 幂等 fail closed
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(true);
    expect(existsSync(stagingDir)).toBe(true);
  });

  it('F1r4-2: 正常 commit 入口中途 rename 失败 → 共用容错回滚到全旧一致态、rolledBack:true', () => {
    const proposalDir = guiProject(root, 'commitfail');
    writePrototype(proposalDir, 'core-01-a.html', 'A-NEW');
    writePrototype(proposalDir, 'core-02-b.html', 'B-NEW');
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'core-01-a.html'), 'A-OLD');   // A 有旧内容 → commit 时会 backup
    const bDir = join(targetDir, 'core-02-b.html'); mkdirSync(bDir, { recursive: true }); writeFileSync(join(bDir, 'x'), 'x');  // B target 非空目录 → commit 时 rename/backup 失败
    writePlanApprovedMarker(proposalDir, {
      ui_prototype_rendered: true, pages: ['core-01-a.html', 'core-02-b.html'],
      hashes: { 'core-01-a.html': sha('A-NEW'), 'core-02-b.html': sha('B-NEW') },
    });
    const r = commitVerifiedPrototypes(proposalDir, root);
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(true);                            // 完整回滚成功
    expect(readFileSync(join(targetDir, 'core-01-a.html'), 'utf-8')).toBe('A-OLD');   // A 回滚到旧内容（全旧一致）
    expect(existsSync(join(proposalDir, COMMIT_JOURNAL))).toBe(false);                // 一致态达成 → 材料清理
  });
});

describe('S09 code-r5 F1 — rename↔done 落盘崩溃窗口：恢复据 intent + 文件系统真实状态，绝不忽略已替换 target', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());
  const mkProposal = (slug: string) => { const d = join(root, 'logos', 'changes', slug); mkdirSync(d, { recursive: true }); return d; };

  // 崩溃窗口快照：A 的 rename 已完成（target=新、staged 消失、backup=旧）但 done:true 未落盘（磁盘 done:false）；B pending。
  function crashWindow(dir: string, intent: 'commit' | 'abort') {
    const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH); mkdirSync(targetDir, { recursive: true });
    const stagingDir = join(dir, '.ui-commit-staging'); mkdirSync(stagingDir, { recursive: true });
    const backupDir = join(dir, '.ui-commit-backup'); mkdirSync(backupDir, { recursive: true });
    writeFileSync(join(targetDir, 'core-01-a.html'), 'A-NEW');     // A.target 已替换为新内容
    writeFileSync(join(backupDir, 'core-01-a.html'), 'A-OLD');     // A.backup 保留旧内容
    // A.staged **不创建**（rename 已把它消费掉）——正是磁盘 done:false 但 target 已替换的崩溃窗口
    writeFileSync(join(stagingDir, 'core-02-b.html'), 'B-NEW');    // B pending：staged 在、target 无
    writeFileSync(join(dir, COMMIT_JOURNAL), JSON.stringify({ intent, targets: [
      { basename: 'core-01-a.html', staged: join(stagingDir, 'core-01-a.html'), target: join(targetDir, 'core-01-a.html'), backup: join(backupDir, 'core-01-a.html'), done: false },
      { basename: 'core-02-b.html', staged: join(stagingDir, 'core-02-b.html'), target: join(targetDir, 'core-02-b.html'), backup: null, done: false },
    ] }));
    return targetDir;
  }

  it('F1r5-1: intent=commit 崩溃窗口 → 前滚：A 据 staged 消失识别为已替换、补记 done、保留新内容；B 补完 → 全新（不遗留部分提交）', () => {
    const dir = mkProposal('cw-commit');
    const targetDir = crashWindow(dir, 'commit');
    expect(recoverCommitJournal(dir)).toBe('rolled_forward');
    expect(readFileSync(join(targetDir, 'core-01-a.html'), 'utf-8')).toBe('A-NEW');   // A 未被忽略
    expect(readFileSync(join(targetDir, 'core-02-b.html'), 'utf-8')).toBe('B-NEW');
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(false);
  });

  it('F1r5-2: intent=abort 崩溃窗口 → 回滚：A 据 staged 消失识别为已替换、还原为旧内容（旧实现因 done:false 会忽略 A、遗留新内容）；B 未提交 → 全旧', () => {
    const dir = mkProposal('cw-abort');
    const targetDir = crashWindow(dir, 'abort');
    expect(recoverCommitJournal(dir)).toBe('rolled_back');
    expect(readFileSync(join(targetDir, 'core-01-a.html'), 'utf-8')).toBe('A-OLD');   // A 据文件系统真实状态被还原、绝不忽略
    expect(existsSync(join(targetDir, 'core-02-b.html'))).toBe(false);
    expect(existsSync(join(dir, COMMIT_JOURNAL))).toBe(false);
  });
});

describe('S09 code-r2 F2 — module 事实源均不可解析且无 provenance → fail closed', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; restoreCwd = mockCwd(root);
    con = captureConsole(); exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  it('F2r2-1: legacy 空 marker + proposal 无 `> module:` + guard 缺失 → fail closed（不生成 MERGE_PROMPT/不写 resources/SPEC_MERGED）', () => {
    const proposalDir = guiProject(root, 'unres1');   // 声明 ui_impact:true、proposal.md 无 module 头
    rmSync(join(root, 'logos', '.openlogos-guard'), { force: true });   // guard 缺失
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');   // legacy 空 marker（无曾渲染证据）
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');   // 存在 page-design 原型
    expect(() => merge('unres1')).toThrow('process.exit(1)');
    expect(existsSync(join(proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'))).toBe(false);
  });

  it('F2r2-2: guard 缺 module + 无 module 头 + legacy → fail closed', () => {
    const proposalDir = guiProject(root, 'unres2');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'unres2' }));   // 无 module
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    expect(() => merge('unres2')).toThrow('process.exit(1)');
    expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
  });

  it('F2r2-3: 对照 — proposal.md 含 `> module: core`（GUI）时正常经唯一入口 advisory 落盘、不误 fail closed', () => {
    const proposalDir = guiProject(root, 'resolved');
    // 补 `> module: core` 头（持久归属可解析）
    const pm = readFileSync(join(proposalDir, 'proposal.md'), 'utf-8').replace(/^# .*/m, m => `${m}\n\n> module: core`);
    writeFileSync(join(proposalDir, 'proposal.md'), pm);
    rmSync(join(root, 'logos', '.openlogos-guard'), { force: true });   // 即使 guard 缺失，proposal 头可解析
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');   // legacy → advisory
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    merge('resolved');   // 不抛
    expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'))).toBe(true);  // advisory 经唯一入口落盘
  });
});

describe('S09 code-r2 F3 — 损坏 provenance 成员不得过滤后重判 full', () => {
  let root: string; let cleanup: () => void;
  beforeEach(() => { const t = makeTempRoot(); root = t.root; cleanup = t.cleanup; });
  afterEach(() => cleanup());

  it('F3r2-1: pages 含非字符串成员 → malformed → partial（不过滤后判 full）', () => {
    const proposalDir = guiProject(root, 'mixpages');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), JSON.stringify({ ui_prototype_rendered: true, pages: ['core-01-home.html', 7], hashes: { 'core-01-home.html': sha('HOME') } }));
    const prov = readPlanApproved(proposalDir);
    expect(prov.malformed).toBe(true);
    expect(classifyProvenance(prov)).toBe('partial');
    expect(checkUiHashMatch(proposalDir).ok).toBe(false);   // fail closed
  });

  it('F3r2-2: hashes 含非字符串 value → malformed → partial', () => {
    const proposalDir = guiProject(root, 'mixhash');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), JSON.stringify({ ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': sha('HOME'), corrupt: 7 } }));
    const prov = readPlanApproved(proposalDir);
    expect(prov.malformed).toBe(true);
    expect(classifyProvenance(prov)).toBe('partial');
    expect(checkUiHashMatch(proposalDir).ok).toBe(false);
  });

  it('F3r2-3: hash value 非 64-hex → malformed → partial', () => {
    const proposalDir = guiProject(root, 'badhash');
    writePrototype(proposalDir, 'core-01-home.html', 'HOME');
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), JSON.stringify({ ui_prototype_rendered: true, pages: ['core-01-home.html'], hashes: { 'core-01-home.html': 'not-a-valid-sha256' } }));
    const prov = readPlanApproved(proposalDir);
    expect(prov.malformed).toBe(true);
    expect(classifyProvenance(prov)).toBe('partial');
  });

  it('F3r2-4: merge 入口对损坏 provenance（过滤后本会误判 full）fail closed', () => {
    const restoreCwd = mockCwd(root); const con = captureConsole(); const exitSpy = mockProcessExit();
    try {
      const proposalDir = guiProject(root, 'mergecorrupt');
      writePrototype(proposalDir, 'core-01-home.html', 'HOME');
      // pages 混入非法成员、但合法部分 hash 恰好匹配目录——旧实现会过滤后判 full 放行
      writeFileSync(join(proposalDir, 'PLAN_APPROVED'), JSON.stringify({ ui_prototype_rendered: true, pages: ['core-01-home.html', 7], hashes: { 'core-01-home.html': sha('HOME') } }));
      expect(() => merge('mergecorrupt')).toThrow('process.exit(1)');
      expect(existsSync(join(proposalDir, 'SPEC_MERGED'))).toBe(false);
      expect(existsSync(join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html'))).toBe(false);
    } finally { con.restore(); exitSpy.mockRestore(); restoreCwd(); }
  });
});
