/**
 * 切片2：spec-complete 判据与 marker 名单点化 + 发布 schema 枚举锚。
 * 覆盖 UT-S05-49、UT-S05-50、UT-S35-125、UT-S35-126、ST-S35-23。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { hasSpecCompleteMarker, SPEC_MERGED_MARKER, LEGACY_MERGED_MARKER } from '../src/lib/proposal-markers.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { REGISTERED_STEPS } from '../src/lib/step-registry.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const SRC_ROOT = resolve(__dirname, '..', 'src');
const REPO_ROOT = resolve(__dirname, '..', '..');
/** marker 名的唯一权威文件——只有它允许出现裸字面量。 */
const MARKER_AUTHORITY = join(SRC_ROOT, 'lib', 'proposal-markers.ts');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkTs(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function proposal(): string {
  return `# 变更提案：single-predicate

> module: core

## 变更原因
验证 spec-complete 判据单点。

## 变更类型
代码级变更。

## 变更范围
- CLI evaluator。

## 部署影响
- 是否需要部署：否
- 部署原因：仅本地测试
- 影响环境：本地
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## 变更概述
验证消费方读法一致。
`;
}

/**
 * 构造「守恒重放会假阳性」的真实形态：已合并目标里有两个 ID，而提案里那份 delta 的 MODIFIED 块只带其中一个
 * （另一个由本提案的其它 delta / merge 归一化写入）。post-merge 重放 L8 会把它误判为隐式删除。
 */
function withStaleDelta(f: { root: string; dir: string }): void {
  const targetDir = join(f.root, 'logos', 'resources', 'test');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, 'core-S01-test-cases.md'), [
    '# S01 测试用例', '', '## 一、单元测试', '', '| ID | 描述 |', '|---|---|',
    '| UT-S01-01 | 既有 |', '| UT-S01-02 | 合并后新增 |', '',
  ].join('\n'));
  const deltaDir = join(f.dir, 'deltas', 'test');
  mkdirSync(deltaDir, { recursive: true });
  writeFileSync(join(deltaDir, 'core-S01-test-cases.md'), [
    '## MODIFIED — 一、单元测试', '', '| ID | 描述 |', '|---|---|',
    '| UT-S01-01 | 既有 |', '',
  ].join('\n'));
}

function setup(marker: string | null) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  const dir = join(root, 'logos', 'changes', 'single-predicate');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposal());
  writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta]\n- [ ] `deltas/spec/x.md`\n\n## [code]\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'single-predicate', module: 'core' }));
  if (marker) writeFileSync(join(dir, marker), '');
  return { root, dir };
}

describe('S05 spec-complete 判据与发布 schema 锚', () => {
  it('UT-S05-49: plan-package 使用共享 spec-complete 判据', () => {
    // 两种 marker 布局下，plan-package 的结论必须与权威判据逐一相等。
    for (const marker of [SPEC_MERGED_MARKER, LEGACY_MERGED_MARKER]) {
      const f = setup(marker);
      expect(hasSpecCompleteMarker(f.dir)).toBe(true);
      // plan-package 对 spec-complete 提案不再要求 [code] 已填（其 specComplete 分支的可观察后果）。
      expect(evaluatePlanPackage(f.root, f.dir, undefined, 'plan').ready).toBe(true);
    }
    const none = setup(null);
    expect(hasSpecCompleteMarker(none.dir)).toBe(false);

    // 且 plan-package 源码中不再存在内联的 marker 文件名判定。
    const source = readFileSync(join(SRC_ROOT, 'lib', 'plan-package.ts'), 'utf8');
    expect(source).toContain('hasSpecCompleteMarker(proposalDir)');
    expect(source).not.toMatch(/['"]SPEC_MERGED['"]/);
    expect(source).not.toMatch(/['"]MERGED['"]/);
  });

  it('UT-S05-50: next.schema 的 proposalStep 锚到注册表', () => {
    // 每一份对外发布的 schema 都必须有自己的一致性锚；sha256 冻结只证明「没被改」，不证明「与源一致」。
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'spec', 'schema', 'next.schema.json'), 'utf8'));
    const enumValues: string[] = schema.$defs.proposalStep.enum;
    const registered = new Set<string>(REGISTERED_STEPS);
    const declared = new Set<string>(enumValues);

    const missingInSchema = [...registered].filter(step => !declared.has(step)).sort();
    const staleInSchema = [...declared].filter(step => !registered.has(step)).sort();
    expect({ missingInSchema, staleInSchema }).toEqual({ missingInSchema: [], staleInSchema: [] });
    expect([...enumValues].sort()).toEqual([...REGISTERED_STEPS].sort());
  });
});

describe('S35 change-lint 读法归位与 marker 名单点', () => {
  it('UT-S35-125: change-lint 对 legacy MERGED 的读法与权威一致', () => {
    const legacy = setup(LEGACY_MERGED_MARKER);
    const canonical = setup(SPEC_MERGED_MARKER);

    // 权威判据对两种布局同为「已 spec-complete」。
    expect(hasSpecCompleteMarker(legacy.dir)).toBe(hasSpecCompleteMarker(canonical.dir));

    // 两者都置入「重放即假阳性」的陈旧 delta：读法一致时，L8 对两者同样被跳过。
    withStaleDelta(legacy); withStaleDelta(canonical);
    const l8Of = (f: { root: string; dir: string }) => {
      const lint = runChangeLint(f.root, f.dir, 'single-predicate');
      if (!lint.ok) throw new Error(lint.message);
      return lint.checks.find(c => c.id === 8)?.violations ?? null;
    };
    // 修复前：legacy 被判「未 merge」→ 重放 L8 → 报隐式删除（假阳性），此处为 1 而 canonical 为 0。
    expect(l8Of(legacy)).toBe(l8Of(canonical));
    expect(l8Of(legacy)).toBe(0);
  });

  it('UT-S35-126: marker 名与 HISTORICAL_MARKERS 单点', () => {
    const files = walkTs(SRC_ROOT);
    expect(existsSync(MARKER_AUTHORITY)).toBe(true);

    // ① HISTORICAL_MARKERS 恰好 1 处定义，其余只能是 import / re-export。
    const definitions = files.filter(path =>
      /^\s*(?:export\s+)?const\s+HISTORICAL_MARKERS\s*=/m.test(readFileSync(path, 'utf8')));
    expect(definitions.map(p => p.slice(SRC_ROOT.length))).toEqual([MARKER_AUTHORITY.slice(SRC_ROOT.length)]);

    // ② marker 名裸字面量只允许出现在权威文件自身。
    const literal = /['"](?:SPEC_MERGED|MERGED|PLAN_APPROVED|VERIFY_PASS)['"]/;
    const offenders: string[] = [];
    for (const path of files) {
      if (path === MARKER_AUTHORITY) continue;
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        if (literal.test(line)) offenders.push(`${path.slice(SRC_ROOT.length)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('ST-S35-23: legacy MERGED 提案不被重放 L8', () => {
    const legacy = setup(LEGACY_MERGED_MARKER);
    const canonical = setup(SPEC_MERGED_MARKER);
    withStaleDelta(legacy); withStaleDelta(canonical);
    const runOf = (f: { root: string; dir: string }) => {
      const lint = runChangeLint(f.root, f.dir, 'single-predicate');
      if (!lint.ok) throw new Error(lint.message);
      return { l8: lint.checks.find(c => c.id === 8)?.violations ?? null, codes: lint.violations.map(v => v.code).sort() };
    };
    const legacyRun = runOf(legacy);
    // 走 post-merge 分支：L8 未重放，不产生守恒假阳性。
    expect(legacyRun.l8).toBe(0);
    expect(legacyRun.codes).not.toContain('delta_item_conservation');
    // 对照组：两种 marker 布局此后不可区分。
    expect(legacyRun).toEqual(runOf(canonical));
  });
});
