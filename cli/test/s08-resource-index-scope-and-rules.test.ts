import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, mockCwd } from './helpers.js';
import { inferResourceDesc, scanCandidateFiles, syncResourceIndex } from '../src/lib/sync-resource-index.js';
import { KIND_ENUM } from '../src/lib/baseline-seed-txn.js';

/**
 * S08 资源索引候选范围与描述推断锚定
 * （fix-resource-index-scan-and-desc-rules 单切片）
 *
 * 三条缺陷共享同一条流水线：候选集合决定「哪些路径进入推断」，起始锚决定「路径怎么匹配」，
 * 兜底规则决定「匹配不上时是否还有描述」。因描述规则的覆盖面**等于**索引的收录面
 * （无匹配即 skipped 不收录），规则漏了什么，索引就永久缺什么。
 */

const ARCH = 'logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md';
const CANDIDATES = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md';
const SEED_PREFIX = 'logos/resources/verify/baseline-seed-runs/seed-core-0001/staging';

/** baseline-seed 各 kind 的规范产出路径（kind 名从 KIND_ENUM 取，不硬编码） */
function canonicalPathForKind(kind: string): string {
  return kind === 'scenario-candidates'
    ? `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-${kind}.md`
    : `logos/resources/prd/3-technical-plan/1-architecture/core-${kind}.md`;
}

describe('S08 Unit Tests — 候选范围与描述推断锚定', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
  });

  afterEach(() => { restoreCwd(); cleanup(); });

  const put = (rel: string, body = '# doc\n') => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };

  it('UT-S08-47: verify/ 只收顶层报告，子目录一律排除', () => {
    put('logos/resources/verify/acceptance-report.md');
    put(`${SEED_PREFIX}/logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md`);
    put('logos/resources/verify/evidence/run-1/notes.md');
    put('logos/resources/verify/deployment-artifacts/x/readme.md');
    // 其余扫描根照常递归
    put(ARCH);
    put('logos/resources/test/core-S99-test-cases.md');

    const candidates = scanCandidateFiles(root);

    expect(candidates).toContain('logos/resources/verify/acceptance-report.md');
    // verify/ 子目录下的任何文件都不进候选
    expect(candidates.filter(p => p.startsWith('logos/resources/verify/') && p.split('/').length > 4)).toEqual([]);
    // 其余扫描根的递归行为不变
    expect(candidates).toContain(ARCH);
    expect(candidates).toContain('logos/resources/test/core-S99-test-cases.md');
  });

  it('UT-S08-48: 每条规则「权威命中、同名嵌套不命中」——逐条成对断言', () => {
    // 覆盖全部规则的代表性权威路径；缺陷成因是 17 条规则**全部**缺起始锚，
    // 因此必须逐条成对断言，抽查说明不了任何事。
    const authoritative = [
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-00-scenario-overview.md',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md',
      CANDIDATES,
      'logos/resources/test/core-S01-test-cases.md',
      'logos/resources/test/smoke/core-smoke-test-cases.md',
      'logos/resources/decisions/core-D01-choice.md',
      ARCH,
      'logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md',
      'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
      'logos/resources/prd/2-product-design/2-page-design/core-01-cli.md',
      'logos/resources/prd/1-product-requirements/core-01-requirements.md',
      'logos/resources/api/core-api.yaml',
      'logos/resources/database/core.sql',
      'logos/resources/scenario/core-S01.json',
      'logos/resources/verify/acceptance-report.md',
      'logos/resources/implementation/implementation-manifest.md',
      'skills/change-writer/SKILL.md',
      'spec/flow-spec.md',
    ];

    expect(authoritative.length).toBeGreaterThanOrEqual(18);
    for (const path of authoritative) {
      // ① 权威路径命中
      expect(inferResourceDesc(path, 'zh'), `权威应命中: ${path}`).not.toBeNull();
      // ② 把权威路径整体内嵌进 seed 事务工作区后不得命中
      const nested = `${SEED_PREFIX.replace('/staging', '/resolved')}/${path}`;
      expect(inferResourceDesc(nested, 'zh'), `嵌套不得命中: ${nested}`).toBeNull();
    }
  });

  it('UT-S08-49: 场景实现目录非 SXX 文档命中兜底，且 SXX 描述零回归', () => {
    for (const name of ['core-scenario-candidates.md', 'core-dependency-map.md', 'core-entry-points.md']) {
      const desc = inferResourceDesc(`logos/resources/prd/3-technical-plan/2-scenario-implementation/${name}`, 'zh');
      expect(desc, name).not.toBeNull();
      expect(desc, name).toContain('场景实现');
      // 不得被判为验收报告
      expect(desc, name).not.toContain('验收报告');
    }
    // 既有 SXX 文档与总览的描述逐字不变
    expect(inferResourceDesc('logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-cli-init.md', 'zh'))
      .toBe('S01 场景时序图。涉及 S01 实现细节、API 设计、异常分支时必读。');
    expect(inferResourceDesc('logos/resources/prd/3-technical-plan/2-scenario-implementation/core-00-scenario-overview.md', 'zh'))
      .toBe('场景实现概览索引。涉及全量场景分类、参与方、实现文档映射关系时必读。');
  });

  it('UT-S08-50: KIND_ENUM 每个 kind 的规范产出路径均可识别', () => {
    // kind 名从常量遍历取值——硬编码等于在测试里再造一次同源漂移，那条锚就白设了
    expect(KIND_ENUM.length).toBeGreaterThan(0);
    for (const kind of KIND_ENUM) {
      const path = canonicalPathForKind(kind);
      expect(inferResourceDesc(path, 'zh'), `kind 无法识别: ${kind} → ${path}`).not.toBeNull();
      expect(inferResourceDesc(path, 'en'), `kind 无法识别(en): ${kind}`).not.toBeNull();
    }
  });
});

describe('S08 Scenario Tests — 候选范围与描述推断', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
  });

  afterEach(() => { restoreCwd(); cleanup(); });

  const put = (rel: string, body: string) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  const readIndex = () => (parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')) as {
    resource_index?: Array<{ path: string; desc: string }>;
  }).resource_index ?? [];

  it('ST-S08-32: Bug 报告 #02 四步复现路径闭环', () => {
    // ② 两份权威文档
    put(ARCH, '# core 现状系统图\n\n权威版本（第 2 版）。\n');
    put(CANDIDATES, '# core 逆向场景候选\n\n权威版本。\n');
    // ③ seed 事务工作区下的同名陈旧快照
    put(`${SEED_PREFIX}/${ARCH}`, '# core 现状系统图\n\n陈旧快照（第 1 版）。\n');
    put(`${SEED_PREFIX}/${CANDIDATES}`, '# core 逆向场景候选\n\n陈旧快照。\n');

    // ④ 补录
    expect(syncResourceIndex(root, 'zh').added).toBe(2);

    const index = readIndex();
    // 恰含 2 条权威条目、0 条快照条目
    expect(index).toHaveLength(2);
    expect(index.map(e => e.path).sort()).toEqual([ARCH, CANDIDATES].sort());
    expect(index.some(e => e.path.includes('baseline-seed-runs'))).toBe(false);

    // 权威场景文档在列且描述为场景实现语义、非验收报告
    const candidatesEntry = index.find(e => e.path === CANDIDATES)!;
    expect(candidatesEntry.desc).toContain('场景实现');
    expect(candidatesEntry.desc).not.toContain('验收报告');
    // 不存在两条描述相同的同名文档条目
    expect(new Set(index.map(e => e.desc)).size).toBe(index.length);
  });

  it('ST-S08-33: 既有条目守恒且 sync 幂等', () => {
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const preexisting = [
      { path: 'spec/kept.md', desc: '人工维护的权威条目' },
      { path: `${SEED_PREFIX}/${ARCH}`, desc: '历史快照条目（污染，但不由 CLI 删除）' },
      { path: 'logos/resources/prd/1-product-requirements/gone.md', desc: '指向已不存在文件的过期残留' },
    ];
    writeFileSync(yamlPath, [
      'project:', '  name: "t"', '',
      'resource_index:',
      ...preexisting.flatMap(e => [`  - path: ${e.path}`, `    desc: ${e.desc}`]),
      '', 'conventions:', '  - "x"', '',
    ].join('\n'));

    put(ARCH, '# arch\n');
    put(`${SEED_PREFIX}/${ARCH}`, '# 快照\n');

    syncResourceIndex(root, 'zh');
    const afterFirst = readFileSync(yamlPath, 'utf-8');
    const index = readIndex();

    // 三条既有条目逐字保留——CLI 不删除任何条目（决策 C01）
    for (const entry of preexisting) {
      expect(index.find(e => e.path === entry.path), entry.path).toEqual(entry);
    }
    // 快照路径不再被新增收录（既有那条是预置的，不是本次新增）
    expect(index.filter(e => e.path.includes('baseline-seed-runs'))).toHaveLength(1);

    // 幂等：再 sync 两次，字节不变
    expect(syncResourceIndex(root, 'zh').added).toBe(0);
    expect(syncResourceIndex(root, 'zh').added).toBe(0);
    expect(readFileSync(yamlPath, 'utf-8')).toBe(afterFirst);
  });
});
