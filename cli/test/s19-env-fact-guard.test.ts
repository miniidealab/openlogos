/**
 * UT-S19-47 / UT-S19-48：环境事实不入 verify 期断言的**守卫元测试**。
 *
 * 规范源：`logos/resources/test/core-S19-test-cases.md`「S19 环境事实不入 verify 期断言的守卫元测试」、
 * 架构 §四十九、部署方案「发布前检查通则：环境事实不入 verify 期断言」。
 *
 * 本文件自身不含任何包版本字面量：判据问的是「这个位置该不该出现版本」，而不是「这个字符串是不是当前版本」。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runEnvFactGuard, scanSnapshot, scanTestSource, formatViolations,
  type GuardSource,
} from './env-fact-guard.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(TEST_DIR, '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');

/** 运行时读取——仅用于诊断文案与夹具取值，**判据不依赖它**。 */
const PKG_VERSION: string = (JSON.parse(
  readFileSync(join(CLI_ROOT, 'package.json'), 'utf-8'),
) as { version: string }).version;

function walk(dir: string, suffix: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, suffix, out);
    else if (name.endsWith(suffix)) out.push(p);
  }
  return out;
}

const load = (paths: string[]): GuardSource[] =>
  paths.map(p => ({ path: relative(REPO_ROOT, p), text: readFileSync(p, 'utf-8') }));

describe('S19 — 环境事实守卫元测试', () => {
  it('UT-S19-47: 包版本承载位不得出现任何版本字面量（按字段语义判定）', () => {
    const snapshots = load(walk(join(TEST_DIR, '__snapshots__'), '.snap'));
    const sources = load(walk(TEST_DIR, '.test.ts'));
    expect(snapshots.length, '必须真的扫到快照资产（遍历源是磁盘资产，不是人工白名单）').toBeGreaterThan(0);
    expect(sources.length, '必须真的扫到测试源').toBeGreaterThan(0);

    const violations = runEnvFactGuard(snapshots, sources);
    expect(
      violations,
      violations.length === 0 ? '' : `环境事实守卫拦截（当前包版本 ${PKG_VERSION} 仅用于本诊断文案）：\n${formatViolations(violations)}`,
    ).toEqual([]);
  });

  it('UT-S19-47: 边界——契约版本位、运行时读取形态与叙述文本均不误伤', () => {
    // ① 契约版本位保持固定字面量：不得报错
    const contractOk: GuardSource = {
      path: 'fixture/contract-ok.snap',
      text: '"command":"status","version":"<PKG_VERSION>","data":{"contract":{"version":"1.0.0"}}',
    };
    expect(scanSnapshot(contractOk)).toEqual([]);

    // ② 契约版本位被规范化成占位符：反向报错（把被测性质当噪声抹掉同样是缺陷）
    const contractNormalized: GuardSource = {
      path: 'fixture/contract-normalized.snap',
      text: '"command":"status","version":"<PKG_VERSION>","data":{"contract":{"version":"<CONTRACT_VERSION>"}}',
    };
    const reverse = scanSnapshot(contractNormalized);
    expect(reverse.map(v => v.code)).toEqual(['contract_version_normalized']);

    // ③ 运行时读取形态（标识符、无字面量）：不得报错
    const runtimeRead: GuardSource = {
      path: 'fixture/runtime-read.test.ts',
      text: [
        "expect(tarballVersion).toBe(readPkgVersion());",
        "expect(globalVersion).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);",
      ].join('\n'),
    };
    expect(scanTestSource(runtimeRead)).toEqual([]);

    // ④ 叙述文本（注释 / 用例标题 / 文档字符串）中的历史版本：不参与判定
    const prose: GuardSource = {
      path: 'fixture/prose.test.ts',
      text: [
        '// 0.15.2 发布后 UT-S34-09 复发，故立本守卫',
        "it('回归：0.15.2 快照钉死包版本导致假红', () => {",
        '  /** 参见 0.14.25 的同形态事故 */',
        '});',
      ].join('\n'),
    };
    expect(scanTestSource(prose)).toEqual([]);

    // ⑤ 契约类断言主语（contract / planContract / minimum_app）：钉死是要求，不得报错
    const contractAssertions: GuardSource = {
      path: 'fixture/contract-assertions.test.ts',
      text: [
        "expect(env.data.contract.version).toBe('1.0.0');",
        "expect(second.planContractVersion).toBe('1.4.0');",
        "expect(contract.minimum_app_version).toBe('5.3.5');",
      ].join('\n'),
    };
    expect(scanTestSource(contractAssertions)).toEqual([]);
  });

  it('UT-S19-48: 判据不随版本漂移——快照钉 vA 而当前包为 vB 时同样被拦（F1 回归锚）', () => {
    // 夹具复刻 0.15.3 上的真实形态：当前包版本 vB，快照里钉着上一个版本 vA。
    const [major, minor, patch] = PKG_VERSION.split('.').map(Number);
    const vB = PKG_VERSION;
    const vA = `${major}.${minor}.${Math.max(0, patch - 1)}`;
    expect(vA, '夹具必须构造出与当前包版本不同的旧版本').not.toBe(vB);

    const stale: GuardSource = {
      path: 'fixture/stale-golden.snap',
      text: `exports[\`golden > next-json 1\`] = \`"{"command":"next","version":"${vA}","data":{"contract":{"version":"1.0.0"}}}"\`;`,
    };

    const violations = scanSnapshot(stale);
    expect(violations.map(v => v.code)).toEqual(['package_version_pinned']);
    expect(violations[0].excerpt).toContain(vA);
    expect(violations[0].path).toBe('fixture/stale-golden.snap');

    // F1 的核心：按「等于当前包版本」实现的守卫在本例**命中为零**——那正是它放行真实故障的原因。
    const naiveHits = stale.text.includes(vB);
    expect(naiveHits, '旧判据（等于当前包版本）在本夹具上必然漏判，故不得作为守卫实现').toBe(false);

    // 反向：同一位置写成占位符即合法，证明拦的是「该位置有具体版本」而非「有版本这个词」
    const normalized: GuardSource = { path: stale.path, text: stale.text.split(vA).join('<PKG_VERSION>') };
    expect(scanSnapshot(normalized)).toEqual([]);
  });
});
