/**
 * drop-baseline-confirmation：删除逆向基线「人工确认机制」的反向回归。
 *  - verify 不再对 verified:false 逆向 spec 产软告警：JSON 无 `data.baseline_warnings`、gate 结果不因基线候选改变（UT-S33-17 / ST-S33-EX-04）。
 *  - next 对 seeded 逆向项目不再给 JIT 确认提示（UT-S09-B01）。
 * 含 OpenLogos reporter（用例名带 UT/ST ID，由 vitest reporter 抽取写 test-results.jsonl）。
 * 不改 spec/flow/*.yaml、真实 logos/flow/、golden fixture。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { verify } from '../src/commands/verify.js';
import { next } from '../src/commands/next.js';
import { candidateKey } from '../src/lib/baseline-provenance.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 临时 adopted+launched 项目，显式 baseline_seed_state。 */
function tempAdopted(seedState: 'required' | 'partial' | 'seeded'): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    `project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: ${seedState}\n`);
  return root;
}

/** 写一份含 verified:false 逆向候选（规范键，会被采信）的主文档——确认机制若还在，此候选会触发软告警。 */
function writeReverseCandidate(root: string): void {
  const key = candidateKey('core', 'cli:adopt');
  const doc = `# system-map\n\n模块图正文。\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    anchor: "cli:adopt"\n    state: active\n    verified: false\n\`\`\`\n`;
  const p = join(root, 'logos', 'resources', 'prd', '3-technical-plan', '1-architecture', 'core-system-map.md');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, doc);
}

/** 最小 verify fixture：一份用例 + 通过结果 → gate 能出结论。 */
function writeVerifyFixture(root: string): void {
  writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S99-test-cases.md'),
    '# S99\n\n| ID | 描述 |\n|----|----|\n| UT-S99-01 | demo |\n');
  mkdirSync(join(root, 'logos', 'resources', 'verify'), { recursive: true });
  writeFileSync(join(root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
    JSON.stringify({ id: 'UT-S99-01', status: 'pass' }) + '\n');
}

function runVerifyJson(root: string): any {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { verify('json'); } catch { /* process.exit via gate */ } finally { cap.restore(); restore(); ex.mockRestore(); }
  const line = cap.logs.find(l => { try { return JSON.parse(l)?.command === 'verify'; } catch { return false; } });
  return line ? JSON.parse(line) : null;
}

async function runNextJsonRaw(root: string): Promise<string> {
  const restore = mockCwd(root); const cap = captureConsole();
  try { await next('json'); } finally { cap.restore(); restore(); }
  return cap.logs.join('\n');
}

describe('drop-baseline-confirmation：确认机制删除反向回归', () => {
  it('UT-S33-17 / ST-S33-EX-04: verify 对 verified:false 逆向 spec 不产软告警、JSON 无 baseline_warnings、gate 不受基线影响', () => {
    const root = tempAdopted('seeded');
    writeReverseCandidate(root);
    writeVerifyFixture(root);

    const env = runVerifyJson(root);
    expect(env).not.toBeNull();
    // 先证 verify 本身通过（否则"无 baseline_warnings"是假绿）。
    expect(env.data.gate.result).toBe('PASS');
    // 反向断言：软告警机制已删除——不再有 baseline_warnings 字段。
    expect(env.data.baseline_warnings).toBeUndefined();
    // gate 失败原因（若有）绝不因逆向候选（verified:false）而产生。
    expect(String(env.data.gate?.reason ?? '')).not.toContain('baseline');

    // 控制组：无逆向候选的同型项目，gate 结果一致——证明逆向候选对 verify 无任何影响。
    const ctl = tempAdopted('required');
    writeVerifyFixture(ctl);
    const ctlEnv = runVerifyJson(ctl);
    expect(ctlEnv.data.gate.result).toBe(env.data.gate.result);
    expect(ctlEnv.data.baseline_warnings).toBeUndefined();

    // 文本模式也不再打印现状基线软告警。
    const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
    try { verify('text'); } catch { /* exit */ } finally { cap.restore(); restore(); ex.mockRestore(); }
    expect(cap.logs.join('\n')).not.toContain('现状基线软告警');
  });

  it('UT-S09-B01: seeded 逆向项目 next 不再给 JIT 确认提示（change-writer 不建议在 delta 内确认现状）', async () => {
    const root = tempAdopted('seeded');
    writeReverseCandidate(root);
    const out = await runNextJsonRaw(root);
    // 反向断言：删除后的 next 输出不含 JIT advisory / 确认现状措辞。
    expect(out).not.toContain('change-writer 会建议');
    expect(out).not.toContain('一并确认现状');
    expect(out).not.toContain('不设硬门');
    // 保留：正常引导发起变更。
    expect(out).toContain('可正常发起变更迭代');
  });

  // ---- 分发资产（skills/ + docs/ 随 npm 包分发）静态契约回归 ----
  const REPO = resolve(process.cwd(), '..');
  const DIST_DOCS = ['skills/brownfield-adopter/SKILL.md', 'docs/brownfield-adopter-guide.md'];

  it('F1 回归：分发 Skill/指南保留 baseline_coverage 契约（human_verified 分子 / active∪tombstone 分母），不改成候选纯计数/不可变快照', () => {
    for (const rel of DIST_DOCS) {
      const doc = readFileSync(join(REPO, rel), 'utf-8');
      expect(doc).toContain('human_verified');            // 分子字段保留
      expect(doc).toContain('tombstone');                 // tombstone 生命周期保留
      expect(doc).toContain('active ∪ tombstone');        // 分母口径保留
      expect(doc).not.toContain('候选纯计数');            // 不得改写为纯计数
      expect(doc).not.toContain('候选计数');              // 也不得写"候选计数 N"（流程图残留）
      expect(doc).not.toContain('不可变的现状快照');      // 不得称注册表为不可变快照（仍随重扫维护）
      expect(doc).not.toContain('冻结的现状快照');        // 同上
    }
  });

  // 权威规格（已合并主文档）——恢复门/机器读取者清单不得把 verify 当基线读取者。
  const SPEC_DOCS = [
    'logos/resources/prd/3-technical-plan/1-architecture/core-06-provenance-data-model.md',
    'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
    'logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md',
  ];

  it('F2 回归：分发 Skill/指南明确 verify 已与基线解耦（不再列为恢复门机器消费者）', () => {
    for (const rel of DIST_DOCS) {
      const doc = readFileSync(join(REPO, rel), 'utf-8');
      expect(doc).toContain('`verify` 已与基线候选解耦');
    }
  });

  it('F2 回归：权威规格恢复门/读取者清单不再把 verify 列为基线读取者', () => {
    for (const rel of [...SPEC_DOCS, ...DIST_DOCS]) {
      const doc = readFileSync(join(REPO, rel), 'utf-8');
      // 仅约束"恢复门 / 机器读取者 / coverage 新鲜度输出"这类句子——verify 不得作为斜杠分隔的消费者出现；
      // 解耦说明（括号/分号引入的"`verify` 已解耦…"）与其它无关句（如"迁移不被 launch/verify 强制"）不受此约束。
      const gateLines = doc.split('\n').filter(l =>
        /恢复门|机器读取入口|机器消费者|机器一致性|输出 `stale`/.test(l));
      for (const l of gateLines) {
        expect(l).not.toContain('/`verify`');
        expect(l).not.toContain('`verify`/');
        expect(l).not.toContain('status/verify');
      }
    }
  });

  it('F5 回归：活跃功能/需求/CLI 规格不再要求"深化引导"，且 seeded 正常引导 change', () => {
    const ACTIVE_SPECS = [
      'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
      'logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md',
      'logos/resources/prd/1-product-requirements/core-01-requirements.md',
    ];
    for (const rel of ACTIVE_SPECS) {
      const doc = readFileSync(join(REPO, rel), 'utf-8');
      expect(doc).not.toContain('深化引导');   // JIT 按需深化引导已删除
    }
    // feature-specs 的 next/bootstrap 行为必须按 baseline_seed_state 分档、seeded 正常引导 change。
    const fspec = readFileSync(join(REPO, ACTIVE_SPECS[0]), 'utf-8');
    expect(fspec).toMatch(/`seeded`[^\n]*正常引导 `openlogos change`/);
  });
});
