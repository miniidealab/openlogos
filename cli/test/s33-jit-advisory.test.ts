import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot } from './helpers.js';
import {
  detectBaselineJitAdvisory, deltaConfirmsCurrentState, listDeltaRelPaths, deltaToTarget,
} from '../src/lib/baseline-jit.js';
import { scanModuleCandidates, computeCoverage, candidateKey } from '../src/lib/baseline-provenance.js';

const TARGET_REL = 'prd/1-product-requirements/core-01-requirements.md';
const TARGET = `logos/resources/${TARGET_REL}`;
const K = candidateKey('core', 'cli:adopt'); // 规范键（与 anchor 一致；扫描侧 canonical 采信要求可重算）

/** 一份含 `## 逆向基线来源` 的主文档（verified 可控），带正文以模拟「前向改动 + 现状确认」。 */
function doc(verified: boolean, body = '正文原文。') {
  const confirm = verified
    ? '    confirmed_by: "fred"\n    evidence: "cli/src/commands/adopt.ts"\n    confirmed_at: "2026-07-14"\n'
    : '';
  return `# 需求文档\n\n${body}\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${K}"\n    anchor: "cli:adopt"\n    state: active\n    verified: ${verified}\n${confirm}\`\`\`\n`;
}

function writeMerged(root: string, content: string) {
  const p = join(root, TARGET);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
function writeDelta(root: string, slug: string, content: string, rel = TARGET_REL) {
  const p = join(root, 'logos/changes', slug, 'deltas', rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
function setupYaml(root: string) {
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: seeded\n');
}
function coverage(root: string) {
  return computeCoverage(scanModuleCandidates(root, 'core').candidates);
}

describe('S33 JIT 深化——change-writer advisory（不设硬门）+ 单份最终态 delta', () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => { ({ root, cleanup } = makeTempRoot()); setupYaml(root); });
  afterEach(() => cleanup());

  it('UT-S09-B01 / ST-S33-02: change 触碰只有 verified:false 逆向区域 → 产出 advisory 标记', () => {
    writeMerged(root, doc(false));
    writeDelta(root, 'feat', doc(false, '前向改动正文。'));
    const adv = detectBaselineJitAdvisory(root, 'feat');
    expect(adv.advise).toBe(true);
    expect(adv.regions).toHaveLength(1);
    expect(adv.regions[0].target_path).toBe(TARGET);
    expect(adv.regions[0].unverified_keys).toContain(K);
    expect(adv.message).toContain('不设硬门');

    // 控制组：主文档已 human-verified → 不再 advise
    writeMerged(root, doc(true));
    expect(detectBaselineJitAdvisory(root, 'feat').advise).toBe(false);
  });

  it('UT-S09-B02: 单份最终态 delta 一个章节同时承载正文改动 + verified:true，无第二份「现状确认 delta」', () => {
    writeMerged(root, doc(false));
    // 单份最终态 delta：正文改动 + `## 逆向基线来源` verified:true
    const finalDelta = doc(true, '前向改动后的正文（本次迭代）。');
    writeDelta(root, 'feat', finalDelta);
    const conf = deltaConfirmsCurrentState(finalDelta);
    expect(conf.confirms).toBe(true);
    expect(conf.verifiedKeys).toContain(K);
    // 无第二份「现状确认 delta」：映射到该目标的 delta 文件恰好 1 份
    const forTarget = listDeltaRelPaths(root, 'feat').filter(rel => deltaToTarget(rel) === TARGET);
    expect(forTarget).toHaveLength(1);
  });

  it('UT-S09-B03: merge 前覆盖率不提前前移（只读已合并主文档、未合并 delta 不计入）', () => {
    writeMerged(root, doc(false));                       // 主文档仍 verified:false
    writeDelta(root, 'feat', doc(true, '含 verified:true 的最终态 delta（未 merge）。'));
    // 覆盖率只读 logos/resources 主文档；delta 在 logos/changes 下，不计入
    expect(coverage(root).human_verified).toBe(0);
    // advisory 也不因未合并 delta 消失（仍读主文档 verified:false）
    expect(detectBaselineJitAdvisory(root, 'feat').advise).toBe(true);
  });

  it('ST-S09-B01 / ST-S33-EX-03: advisory 不设硬门、可跳过——跳过后 verified 保持 false、覆盖率不前移', () => {
    writeMerged(root, doc(false));
    writeDelta(root, 'feat', doc(false, '用户跳过 advisory，直接写前向 delta（不确认现状）。'));
    const adv = detectBaselineJitAdvisory(root, 'feat');
    // 仅给建议，不阻断（无 blocking 语义）；跳过时主文档 verified 仍 false
    expect(adv.advise).toBe(true);
    expect(coverage(root).human_verified).toBe(0);
    // 跳过写前向 delta 不写 verified:true → 该 delta 不确认现状
    expect(deltaConfirmsCurrentState(doc(false, 'x')).confirms).toBe(false);
  });

  it('ST-S09-B02 / ST-S33-03: 接受 advisory → merge 后 verified 生效、覆盖率前移；guard 不被违反', () => {
    writeMerged(root, doc(false));
    expect(coverage(root).human_verified).toBe(0);
    // 接受 advisory：写单份最终态 delta（verified:true）
    const finalDelta = doc(true, '确认现状 + 前向改动，一并落盘。');
    writeDelta(root, 'feat', finalDelta);
    // guard 合规：全程只在 changes/<slug>/deltas 内写作，未直接改 resources、未嵌套第二个 change
    const deltas = listDeltaRelPaths(root, 'feat');
    expect(deltas).toHaveLength(1);
    // merge：merge-executor 把该 delta 落入主文档（此处以内容替换模拟）
    writeMerged(root, finalDelta);
    // merge 后 verified 生效、覆盖率前移一格
    expect(coverage(root)).toMatchObject({ human_verified: 1, denominator: 1 });
    // merge 后不再 advise（区域已 human-verified）
    expect(detectBaselineJitAdvisory(root, 'feat').advise).toBe(false);
  });
});
