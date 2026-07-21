import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { collectStatusData } from '../src/commands/status.js';
import { baselineSeedBegin, baselineSeedCommit } from '../src/commands/baseline-seed.js';
import { stagingDir, readSeedState } from '../src/lib/baseline-seed-txn.js';
import { adopt } from '../src/commands/adopt.js';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';

import { candidateKey } from '../src/lib/baseline-provenance.js';

const SYSTEM_MAP = 'logos/resources/prd/core-system-map.md';
const SCENARIOS = 'logos/resources/prd/core-scenario-candidates.md';
// 契约保真：key = candidateKey(module, anchor)（F3：seed 输入须携锚点且 key 与 anchor 一致）。
const A1 = 'cli:one';
const A2 = 'cli:two';
const K1 = candidateKey('core', A1);
const K2 = candidateKey('core', A2);
const ANCHOR_OF: Record<string, string> = { [K1]: A1, [K2]: A2 };

function setupAdopted(root: string, state: 'required' | 'partial' | 'seeded' = 'required', extraYaml = '') {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: ${state}\n` + extraYaml);
}
function reverseDoc(key: string, verified = false) {
  const anchor = ANCHOR_OF[key] ?? key;
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    anchor: "${anchor}"\n    state: active\n    verified: ${verified}\n\`\`\`\n`;
}
function manifest(root: string) {
  writeFileSync(join(root, 'seed-plan.json'), JSON.stringify({ module: 'core', expected: [
    { kind: 'system-map', target_path: SYSTEM_MAP, candidate_keys: [K1] },
    { kind: 'scenario-candidates', target_path: SCENARIOS, candidate_keys: [K2] },
  ] }));
}
function stage(root: string, runId: string, target: string, content: string) {
  const p = join(stagingDir(root, runId), target);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
}
function beginRun(root: string, con: ReturnType<typeof captureConsole>): string {
  con.logs.length = 0;
  baselineSeedBegin('core', 'seed-plan.json', 'json');
  return JSON.parse(con.logs[0]).data.run_id;
}
function nextJson(con: ReturnType<typeof captureConsole>) {
  con.logs.length = 0;
  next('json');
  return JSON.parse(con.logs[0]).data;
}
function writeActiveProposal(root: string, slug = 'feat') {
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-07-14T00:00:00Z' }));
  const dir = join(root, 'logos/changes', slug);
  mkdirSync(join(dir, 'deltas'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# 变更提案：feat\n\n## 部署影响\n- 是否需要部署：否\n\n## 变更概述\n真实提案，非模板。\n');
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [ ] 写 delta\n');
}

describe('S33 partial 恢复态 + 端到端主路径（写侧种子状态提交）', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  it('ST-S33-01: adopt→begin→写 staging→commit 两阶段主路径 → seeded + 覆盖率', () => {
    setupAdopted(root, 'required');
    manifest(root);
    const runId = beginRun(root, con);
    // driver 派发 skill 把产物写入 run 私有 staging（未直接改 YAML、未直接写目标目录）
    stage(root, runId, SYSTEM_MAP, reverseDoc(K1));
    stage(root, runId, SCENARIOS, reverseDoc(K2));
    expect(existsSync(join(root, SYSTEM_MAP))).toBe(false); // commit 前目标目录未被直接写
    con.logs.length = 0;
    baselineSeedCommit('core', runId, 'json');
    const r = JSON.parse(con.logs[0]).data;
    expect(r.baseline_seed_state).toBe('seeded');
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_coverage).toMatchObject({ state: 'seeded', human_verified: 0, denominator: 2 });
  });

  it('ST-S33-04: 扫描中断→partial→重试→seeded 恢复闭环（next/status 一致）', () => {
    setupAdopted(root, 'required');
    manifest(root);
    const runId = beginRun(root, con);
    stage(root, runId, SYSTEM_MAP, reverseDoc(K1)); // 仅部分
    con.logs.length = 0;
    baselineSeedCommit('core', runId, 'json');
    expect(JSON.parse(con.logs[0]).data.baseline_seed_state).toBe('partial');
    // next/status 一致指向恢复入口
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_seed_state).toBe('partial');
    expect(mod.baseline_coverage?.incomplete).toBe(true);
    const nd = nextJson(con);
    expect(nd.modules[0].command ?? nd.command).toContain('openlogos baseline-seed');
    // 补齐 → 再 commit → seeded
    stage(root, runId, SCENARIOS, reverseDoc(K2));
    con.logs.length = 0;
    baselineSeedCommit('core', runId, 'json');
    expect(JSON.parse(con.logs[0]).data.baseline_seed_state).toBe('seeded');
    expect(readSeedState(root, 'core')).toBe('seeded');
  });

  it('UT-S05-B05 / ST-S05-B02: partial 无活跃提案 → next/status state=partial/incomplete、主动作指向 baseline-seed', () => {
    setupAdopted(root, 'partial');
    writeFileSync(join(root, SYSTEM_MAP), reverseDoc(K1));
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_seed_state).toBe('partial');
    expect(mod.baseline_coverage?.incomplete).toBe(true);
    const nd = nextJson(con);
    expect(nd.modules[0].command).toContain('openlogos baseline-seed');
    expect(nd.modules[0].baseline_coverage.state).toBe('partial');
    // status/next 一致
    expect(nd.modules[0].baseline_coverage.incomplete).toBe(true);
  });

  it('UT-S05-B06: partial + 派生索引 stale → 同时 state=partial/incomplete 且 freshness=stale', () => {
    setupAdopted(root, 'partial', '\nbaseline_index:\n  core:\n    source_hash: "deadbeef-mismatch"\n');
    writeFileSync(join(root, SYSTEM_MAP), reverseDoc(K1));
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_coverage).toMatchObject({ state: 'partial', incomplete: true, freshness: 'stale' });
  });

  it('UT-S05-B07 / ST-S05-B03: partial + 活跃提案 → proposal_step 保持前沿、recovery advisory 存在、不阻断', () => {
    setupAdopted(root, 'partial');
    writeFileSync(join(root, SYSTEM_MAP), reverseDoc(K1));
    // 建一个 open run 使 recovery.run_id 可填
    manifest(root);
    beginRun(root, con);
    writeActiveProposal(root, 'feat');

    const mod = collectStatusData(root).modules![0];
    // proposal_step 为提案真实前沿（非 null、非 baseline 相关）
    expect(mod.active_change?.slug).toBe('feat');
    expect(mod.active_change?.proposal_step).toBeTruthy();
    // recovery advisory 存在
    expect(mod.baseline_coverage?.state).toBe('partial');
    expect(mod.baseline_coverage?.recovery?.available).toBe(true);
    expect(mod.baseline_coverage?.recovery?.entry).toContain('openlogos baseline-seed');

    // next：主 action/next_node 保持提案前沿（不被恢复劫持），change 不阻断
    const nd = nextJson(con);
    expect(nd.modules[0].active_change).toBe('feat');
    expect(nd.modules[0].proposal_step).toBe(mod.active_change?.proposal_step);
  });

  it('UT-S05-B08: incomplete 恒布尔、三态稳定 shape（required/seeded → false，partial → true）', () => {
    for (const [state, expected] of [['required', false], ['seeded', false], ['partial', true]] as const) {
      const sub = makeTempRoot();
      const restore = mockCwd(sub.root);
      try {
        setupAdopted(sub.root, state);
        if (state !== 'required') writeFileSync(join(sub.root, SYSTEM_MAP), reverseDoc(K1));
        const mod = collectStatusData(sub.root).modules![0];
        expect(typeof mod.baseline_coverage?.incomplete).toBe('boolean');
        expect(mod.baseline_coverage?.incomplete).toBe(expected);
      } finally { restore(); sub.cleanup(); }
    }
  });

  it('ST-S33-EX-01: CLI-only / 非交互 adopt 不伪造基线（保持 required、不显示已建立）', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }));
    await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });
    const yaml = parseYaml(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8')) as { modules?: Array<{ baseline_seed_state?: string }> };
    expect(yaml.modules?.[0].baseline_seed_state).toBe('required');
    const out = con.logs.join('\n');
    expect(out).not.toContain('基线已建立');
    expect(out).toContain('未检测到可用的 AI 会话');
  });

  it('ST-S33-EX-02: 扫描失败可重试、不回滚已初始化 logos/（partial 保留、重扫按 key 覆盖）', () => {
    setupAdopted(root, 'required');
    manifest(root);
    const runId = beginRun(root, con);
    stage(root, runId, SYSTEM_MAP, reverseDoc(K1));
    con.logs.length = 0;
    baselineSeedCommit('core', runId, 'json'); // partial
    expect(readSeedState(root, 'core')).toBe('partial');
    // logos/ 未回滚：config/yaml 仍在
    expect(existsSync(join(root, 'logos/logos.config.json'))).toBe(true);
    expect(existsSync(join(root, 'logos/logos-project.yaml'))).toBe(true);
    // 重扫按 key 覆盖 staging 后重试成功
    stage(root, runId, SCENARIOS, reverseDoc(K2));
    con.logs.length = 0;
    baselineSeedCommit('core', runId, 'json');
    expect(readSeedState(root, 'core')).toBe('seeded');
  });
});
