import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot } from './helpers.js';
import {
  parseProvenanceSection,
  deriveProvenance,
  computeCoverage,
  candidateKey,
  normalizeAnchor,
  buildBaselineCoverage,
  classifyDocProvenance,
  scanModuleCandidates,
  listModuleProvenanceDocs,
  isCandidateKeyRecomputable,
  isCanonicalKey,
  type BaselineCandidate,
} from '../src/lib/baseline-provenance.js';
import { normalizeBaselineSeedState, readProjectYaml } from '../src/lib/project-yaml.js';
import { migrateBaselineProvenance } from '../src/lib/migrate-lifecycle.js';

/** 构造一份含 `## 逆向基线来源` 章节的逆向产物文档。 */
function docWithCandidates(yamlBody: string): string {
  return `# system-map\n\n模块图正文。\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${yamlBody}\`\`\`\n`;
}

function cand(partial: Partial<BaselineCandidate> & { key: string }): BaselineCandidate {
  return {
    anchor: undefined,
    display: undefined,
    state: 'active',
    verified: false,
    aliases: [],
    superseded_by: [],
    confirmed_by: null,
    evidence: null,
    confirmed_at: null,
    retired_by: null,
    retire_event_id: null,
    ...partial,
  };
}

describe('S33 provenance 数据模型与覆盖率（读侧可信边界）', () => {
  it('UT-S33-03: 章节 candidates[] 解析（一文档多候选）+ provenance 派生', () => {
    const md = docWithCandidates(
      `  - key: "core::aaa111bbb222"\n    anchor: "cli:adopt"\n    state: active\n    verified: false\n` +
      `  - key: "core::ccc333ddd444"\n    anchor: "cli:next"\n    state: active\n    verified: true\n    confirmed_by: "fred"\n` +
      `  - key: "core::eee555fff666"\n    anchor: "cli:old"\n    state: tombstone\n    verified: false\n`,
    );
    const parsed = parseProvenanceSection(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.candidates).toHaveLength(3);
    expect(parsed!.candidates.map(c => c.state)).toEqual(['active', 'active', 'tombstone']);
    // provenance 为派生值（非独立字段，由 state 派生、无 human-verified 分支）
    expect(deriveProvenance(parsed!.candidates[0])).toBe('reverse-engineered');
    expect(deriveProvenance(parsed!.candidates[1])).toBe('reverse-engineered'); // verified:true 不再派生 human-verified
    expect(deriveProvenance(parsed!.candidates[2])).toBe('reverse-engineered');
  });

  it('UT-S33-04: verified 升级仅由 delta merge 落主文档（内容替换）触发', () => {
    const before = docWithCandidates(`  - key: "core::aaa111bbb222"\n    anchor: "cli:adopt"\n    state: active\n    verified: false\n`);
    const after = docWithCandidates(`  - key: "core::aaa111bbb222"\n    anchor: "cli:adopt"\n    state: active\n    verified: true\n    confirmed_by: "fred"\n`);
    expect(parseProvenanceSection(before)!.candidates[0].verified).toBe(false);
    expect(parseProvenanceSection(after)!.candidates[0].verified).toBe(true);
    // source_hash 随章节内容变化而变化（覆盖整章节）
    expect(parseProvenanceSection(before)!.source_hash).not.toBe(parseProvenanceSection(after)!.source_hash);
  });

  it('UT-S33-05: tombstone 计数——删除候选转 tombstone 仍计入 denominator，计数不缩小', () => {
    const active5 = [
      cand({ key: 'core::a' }),
      cand({ key: 'core::b' }),
      cand({ key: 'core::c' }),
      cand({ key: 'core::d' }),
      cand({ key: 'core::e' }),
    ];
    const before = computeCoverage(active5);
    expect(before).toEqual({ denominator: 5, tombstones: 0 });
    // 重扫删除一个候选 → 转 tombstone（仍计入 denominator）
    const afterDelete = active5.map(c => (c.key === 'core::e' ? { ...c, state: 'tombstone' as const } : c));
    const after = computeCoverage(afterDelete);
    expect(after.denominator).toBe(5); // 计数不缩小
    expect(after.tombstones).toBe(1);
  });

  it('UT-S33-07: 规范键确定性 + alias 承载（重命名不新建候选的数据模型）', () => {
    expect(candidateKey('core', 'cli:adopt')).toBe(candidateKey('core', 'cli:adopt'));
    // 规范化前后等价的 anchor 映射到同一 key（重命名后旧 anchor 进 aliases、匹配 alias 即同一候选）
    expect(candidateKey('core', 'CLI:Adopt')).toBe(candidateKey('core', 'cli:adopt'));
    const md = docWithCandidates(`  - key: "${candidateKey('core', 'cli:adopt')}"\n    anchor: "cli:adopt"\n    state: active\n    verified: false\n    aliases: ["cli:old-adopt"]\n`);
    const parsed = parseProvenanceSection(md)!;
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0].aliases).toContain('cli:old-adopt');
  });

  it('UT-S33-08: 规范键为 hash 形式 <module>::<sha256(normalize(anchor))[:12]>', () => {
    const key = candidateKey('core', 'cli:adopt');
    expect(key).toMatch(/^core::[0-9a-f]{12}$/);
    const expected = 'core::' + createHash('sha256').update(normalizeAnchor('cli:adopt')).digest('hex').slice(0, 12);
    expect(key).toBe(expected);
  });

  it('UT-S33-09: 派生索引 source_hash 与文档不符时覆盖率降级 stale', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const dir = join(root, 'logos', 'resources', 'prd');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'core-system-map.md'), docWithCandidates(`  - key: "core::aaa111bbb222"\n    anchor: "cli:adopt"\n    state: active\n    verified: false\n`));
      const live = scanModuleCandidates(root, 'core');
      // 匹配 → fresh
      const fresh = buildBaselineCoverage(root, 'core', 'seeded', { source_hash: live.aggregate_hash });
      expect(fresh.freshness).toBe('fresh');
      // 不匹配 → stale
      const stale = buildBaselineCoverage(root, 'core', 'seeded', { source_hash: 'deadbeef' });
      expect(stale.freshness).toBe('stale');
    } finally {
      cleanup();
    }
  });

  it('UT-S33-10: 零候选 denominator=0（n/a，不报 100%/0%）', () => {
    expect(computeCoverage([]).denominator).toBe(0);
    expect(computeCoverage([cand({ key: 'core::a', state: 'retired' })]).denominator).toBe(0);
  });

  it('UT-S33-11: tombstone 仅废弃才 retired 移出计数', () => {
    const withTombstone = [cand({ key: 'core::a', state: 'active' }), cand({ key: 'core::b', state: 'tombstone' })];
    expect(computeCoverage(withTombstone).denominator).toBe(2);
    const afterRetire = withTombstone.map(c => (c.key === 'core::b' ? { ...c, state: 'retired' as const, retired_by: 'fred' } : c));
    expect(computeCoverage(afterRetire).denominator).toBe(1);
  });

  it('UT-S33-13: 合并/拆分 superseded_by 承载——旧 key 转 tombstone 仍留分母', () => {
    const md = docWithCandidates(
      `  - key: "core::oldkey000000"\n    state: tombstone\n    verified: false\n    superseded_by: ["core::newkey000000"]\n` +
      `  - key: "core::newkey000000"\n    state: active\n    verified: false\n`,
    );
    const parsed = parseProvenanceSection(md)!;
    expect(parsed.candidates[0].superseded_by).toEqual(['core::newkey000000']);
    expect(computeCoverage(parsed.candidates).denominator).toBe(2); // tombstone 仍在分母
  });

  it('UT-S33-14: 扫描器版本升级——可继承者 key 稳定、无对应新 key 者转 tombstone（读侧表示）', () => {
    // 可继承：规范化 anchor 不变 → key 稳定
    expect(candidateKey('core', 'cli:verify')).toBe(candidateKey('core', 'cli:verify'));
    // 无对应新 key 的旧候选以 tombstone 表示，仍计入分母、provenance 为 reverse-engineered
    const orphan = cand({ key: 'core::orphan000000', state: 'tombstone', verified: false });
    expect(deriveProvenance(orphan)).toBe('reverse-engineered');
    expect(computeCoverage([orphan]).denominator).toBe(1);
  });

  it('UT-S33-15: 存量文档缺章节派生 unknown，不虚构 candidates', () => {
    const legacyDoc = '# 旧文档\n\n没有逆向基线来源章节的既有人工文档。\n';
    expect(classifyDocProvenance(legacyDoc)).toBe('unknown');
    expect(parseProvenanceSection(legacyDoc)).toBeNull();
  });

  it('UT-S33-16: 存量迁移幂等 + 布尔兼容（baseline_seed_required:true → baseline_seed_state:required）', () => {
    // 读取兼容映射
    expect(normalizeBaselineSeedState(undefined, true)).toBe('required');
    expect(normalizeBaselineSeedState(undefined, false)).toBeUndefined();
    expect(normalizeBaselineSeedState('seeded', true)).toBe('seeded');

    const { root, cleanup } = makeTempRoot();
    try {
      mkdirSync(join(root, 'logos'), { recursive: true });
      writeFileSync(
        join(root, 'logos', 'logos-project.yaml'),
        'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_required: true\n',
      );
      const first = migrateBaselineProvenance(root);
      expect(first.migrated).toBe(true);
      expect(first.backupPath).toBeTruthy();
      const data = readProjectYaml(root);
      expect(data.data?.modules?.[0].baseline_seed_state).toBe('required');
      // 幂等：再次迁移无变化
      const second = migrateBaselineProvenance(root);
      expect(second.migrated).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('ST-S33-EX-05: 存量 provenance 保守迁移——缺章节标 unknown、不伪造不降级', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const dir = join(root, 'logos', 'resources', 'prd');
      mkdirSync(dir, { recursive: true });
      // 既有人工文档（无逆向基线来源章节）
      writeFileSync(join(dir, 'core-01-requirements.md'), '# 需求文档\n\n人工撰写的需求。\n');
      mkdirSync(join(root, 'logos'), { recursive: true });
      writeFileSync(
        join(root, 'logos', 'logos-project.yaml'),
        'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n',
      );
      migrateBaselineProvenance(root);
      // 不虚构 candidates（扫描结果为空）
      expect(scanModuleCandidates(root, 'core').doc_count).toBe(0);
      // 缺章节文档派生 unknown（不降级为 reverse-engineered、不推断 human-verified）
      expect(classifyDocProvenance(readFileSync(join(dir, 'core-01-requirements.md'), 'utf-8'))).toBe('unknown');
    } finally {
      cleanup();
    }
  });
});

// ── provenance-scan-canonical-recompute：扫描侧 alias-aware canonical 采信 ──
/** 单条候选的 fenced YAML 片段（可显式指定 key/anchor/state/verified/aliases）。 */
function candYaml(o: { key: string; anchor?: string; state?: string; verified?: boolean; aliases?: string[] }): string {
  let s = `  - key: "${o.key}"\n`;
  if (o.anchor !== undefined) s += `    anchor: "${o.anchor}"\n`;
  s += `    state: ${o.state ?? 'active'}\n    verified: ${o.verified ?? false}\n`;
  if (o.aliases && o.aliases.length) s += `    aliases: [${o.aliases.map((a) => `"${a}"`).join(', ')}]\n`;
  return s;
}
function writeResourceDoc(root: string, rel: string, body: string): void {
  const abs = join(root, 'logos', 'resources', rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, docWithCandidates(body));
}

describe('S33 provenance 扫描侧 alias-aware canonical 采信（provenance-scan-canonical-recompute）', () => {
  it('UT-S33-37: 扫描侧排除不可重算候选（格式合法、hash 失配的示例/编造 key）', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const legitKey = candidateKey('core', 'cli:adopt');
      const ghostKey = 'core::a1b2c3d4e5f6'; // 格式合法（<module>::<12hex>）但与 anchor 重算失配
      // doc1：合法候选；doc2：仅含幽灵示例候选（模拟指南示例章节）
      writeResourceDoc(root, 'prd/core-system-map.md', candYaml({ key: legitKey, anchor: 'cli:adopt' }));
      writeResourceDoc(root, 'reference/brownfield-adopter-guide.md', candYaml({ key: ghostKey, anchor: 'cli:baseline-seed-commit' }));

      const scan = scanModuleCandidates(root, 'core');
      const keys = scan.candidates.map((c) => c.key);
      expect(keys).toContain(legitKey);      // 合法候选采信
      expect(keys).not.toContain(ghostKey);  // 幽灵示例候选排除

      const docs = listModuleProvenanceDocs(root, 'core');
      expect(docs).toContain('logos/resources/prd/core-system-map.md');            // 持有合法候选
      expect(docs).not.toContain('logos/resources/reference/brownfield-adopter-guide.md'); // 仅幽灵候选 → 不算持有

      // 证明格式校验不足、必须重算：幽灵 key 能过 isCanonicalKey 格式校验
      expect(isCanonicalKey(ghostKey, 'core')).toBe(true);
      expect(ghostKey).not.toBe(candidateKey('core', 'cli:baseline-seed-commit'));
    } finally {
      cleanup();
    }
  });

  it('UT-S33-38: alias-aware——改名继承 / 多级改名 / tombstone 合法候选仍被采信', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const renamedKey = candidateKey('core', 'cli:old');           // key 由旧 anchor 派生
      const multiKey = candidateKey('core', 'cli:a');               // key 由最初锚点 A 派生
      const tombKey = candidateKey('core', 'cli:gone');
      writeResourceDoc(root, 'prd/core-system-map.md',
        candYaml({ key: renamedKey, anchor: 'cli:new', aliases: ['cli:old'] }) +          // ① 改名：当前 anchor≠key 派生源
        candYaml({ key: multiKey, anchor: 'cli:c', aliases: ['cli:a', 'cli:b'] }) +       // ② 多级改名 A→B→C
        candYaml({ key: tombKey, anchor: 'cli:gone', state: 'tombstone' }));              // ③ tombstone（自身 anchor 可重算）

      const keys = scanModuleCandidates(root, 'core').candidates.map((c) => c.key);
      expect(keys).toEqual(expect.arrayContaining([renamedKey, multiKey, tombKey])); // 三类均被采信、不误杀

      // 直接判据级断言
      const mk = (key: string, anchor: string, aliases: string[], state = 'active'): BaselineCandidate =>
        cand({ key, anchor, aliases, state: state as BaselineCandidate['state'] });
      expect(isCandidateKeyRecomputable(mk(renamedKey, 'cli:new', ['cli:old']), 'core')).toBe(true);
      expect(isCandidateKeyRecomputable(mk(multiKey, 'cli:c', ['cli:a', 'cli:b']), 'core')).toBe(true);
      expect(isCandidateKeyRecomputable(mk(tombKey, 'cli:gone', [], 'tombstone'), 'core')).toBe(true);
      // 幽灵：既非当前 anchor 也非任一 alias 可重算 → 不采信
      expect(isCandidateKeyRecomputable(mk('core::a1b2c3d4e5f6', 'cli:new', ['cli:old']), 'core')).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('UT-S33-39: 含示例章节的无关文档不污染覆盖率计数 / aggregate_hash / freshness', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      // 合法基线：2 active + 1 tombstone（均进 denominator）
      const body =
        candYaml({ key: candidateKey('core', 'cli:a'), anchor: 'cli:a' }) +
        candYaml({ key: candidateKey('core', 'cli:b'), anchor: 'cli:b' }) +
        candYaml({ key: candidateKey('core', 'cli:c'), anchor: 'cli:c', state: 'tombstone' });
      writeResourceDoc(root, 'prd/core-system-map.md', body);

      const scanBefore = scanModuleCandidates(root, 'core');
      const covBefore = computeCoverage(scanBefore.candidates);
      expect(covBefore).toEqual({ denominator: 3, tombstones: 1 });

      // 加入含示例章节的无关文档（幽灵候选，parse_ok=true）
      writeResourceDoc(root, 'reference/brownfield-adopter-guide.md',
        candYaml({ key: 'core::a1b2c3d4e5f6', anchor: 'cli:baseline-seed-commit' }));

      const scanAfter = scanModuleCandidates(root, 'core');
      expect(computeCoverage(scanAfter.candidates)).toEqual(covBefore); // 覆盖率各字段深相等（幽灵不进计数）
      expect(scanAfter.aggregate_hash).toBe(scanBefore.aggregate_hash); // 示例文档不进 aggregate_hash
      // 对既有索引对账仍 fresh（示例文档改动不改 hash → 不打成 stale）
      expect(buildBaselineCoverage(root, 'core', 'seeded', { source_hash: scanBefore.aggregate_hash }).freshness).toBe('fresh');
    } finally {
      cleanup();
    }
  });

  it('UT-S33-40: 采信收紧不改合法基线（全部可重算候选零漂移）', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const ks = ['cli:a', 'cli:b', 'cli:c', 'cli:d'].map((a) => candidateKey('core', a));
      writeResourceDoc(root, 'prd/core-system-map.md',
        candYaml({ key: ks[0], anchor: 'cli:a', verified: true }) +
        candYaml({ key: ks[1], anchor: 'cli:b' }) +
        candYaml({ key: ks[2], anchor: 'cli:c', state: 'tombstone' }) +
        candYaml({ key: ks[3], anchor: 'cli:d', state: 'retired', verified: true }));
      const scan = scanModuleCandidates(root, 'core');
      expect(scan.candidates.map((c) => c.key).sort()).toEqual([...ks].sort()); // 全部合法候选均被采信
      // 计数：denominator = active(a,b) ∪ tombstone(c) = 3；retired(d) 不计入
      expect(computeCoverage(scan.candidates)).toEqual({ denominator: 3, tombstones: 1 });
    } finally {
      cleanup();
    }
  });
});
