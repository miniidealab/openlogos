import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { collectStatusData } from '../src/commands/status.js';
import { createAdoptLogosProject } from '../src/commands/init.js';
import {
  scanModuleCandidates,
  collectBaselineSoftWarnings,
  candidateKey,
} from '../src/lib/baseline-provenance.js';

function docWithCandidates(yamlBody: string): string {
  return `# system-map\n\n模块图正文。\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${yamlBody}\`\`\`\n`;
}

/** 规范候选行（key = candidateKey(core, anchor)，带 anchor——真实 seeded 候选的必然形态）。 */
function revCand(anchor: string, o: { state?: string; verified?: boolean; confirmed_by?: string } = {}): string {
  let s = `  - key: "${candidateKey('core', anchor)}"\n    anchor: "${anchor}"\n    state: ${o.state ?? 'active'}\n    verified: ${o.verified ?? false}\n`;
  if (o.confirmed_by) s += `    confirmed_by: "${o.confirmed_by}"\n`;
  return s;
}

/** 写入 bootstrap=adopted + 指定 baseline_seed_state 的模块（可选 baseline_index）。 */
function writeAdoptedSeedState(
  root: string,
  state: 'required' | 'partial' | 'seeded',
  baselineIndex?: Record<string, unknown>,
) {
  const doc: Record<string, unknown> = {
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', bootstrap: 'adopted', baseline_seed_state: state }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  };
  if (baselineIndex) doc.baseline_index = baselineIndex;
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(doc, { lineWidth: 0 }));
}

/** 在 logos/resources/prd 下落一份含 candidates 的逆向产物文档。 */
function writeReverseDoc(root: string, filename: string, candidatesYaml: string) {
  const dir = join(root, 'logos', 'resources', 'prd');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), docWithCandidates(candidatesYaml));
}

describe('S33 read-side integration — adopt enum / seeded coverage / verify soft-warn', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
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

  it('UT-S33-01: adopt 生成的 logos-project.yaml 含枚举 baseline_seed_state:required（非布尔）', () => {
    const yaml = parseYaml(createAdoptLogosProject('demo', 'zh')) as {
      modules?: Array<{ baseline_seed_state?: string; baseline_seed_required?: unknown }>;
    };
    expect(yaml.modules?.[0].baseline_seed_state).toBe('required');
    expect(yaml.modules?.[0].baseline_seed_required).toBeUndefined();
  });

  it('UT-S33-02: adopt（CLI）不产逆向内容——resources 下无逆向产物', () => {
    writeAdoptedSeedState(root, 'required');
    expect(scanModuleCandidates(root, 'core').doc_count).toBe(0);
    expect(scanModuleCandidates(root, 'core').candidates).toHaveLength(0);
  });

  it('UT-S05-B01 / ST-S05-B01: seeded 无提案时 status/next 展示覆盖率、字段一致', () => {
    writeAdoptedSeedState(root, 'seeded');
    writeReverseDoc(root, 'core-system-map.md',
      revCand('cli:adopt', { verified: true, confirmed_by: 'fred' }) +
      revCand('cli:next', { verified: false }));

    const data = collectStatusData(root);
    const mod = data.modules![0];
    expect(mod.baseline_seed_state).toBe('seeded');
    expect(mod.baseline_coverage).toMatchObject({ state: 'seeded', human_verified: 1, denominator: 2, incomplete: false });
    expect(mod.suggestion).toContain('human-verified 1'); // 覆盖率行（locale 无关子串）

    next('json');
    const parsed = JSON.parse(con.logs[0]);
    // status 与 next 的 baseline_coverage 字段一致
    expect(parsed.data.modules[0].baseline_coverage).toEqual(mod.baseline_coverage);
  });

  it('UT-S05-B02: next --format json 输出 baseline_coverage 全字段、state 映射 baseline_seed_state', () => {
    writeAdoptedSeedState(root, 'seeded');
    writeReverseDoc(root, 'core-system-map.md', revCand('cli:adopt', { verified: false }));

    next('json');
    const bc = JSON.parse(con.logs[0]).data.modules[0].baseline_coverage;
    for (const field of ['state', 'incomplete', 'human_verified', 'denominator', 'tombstones', 'human_verified_delta', 'source', 'freshness']) {
      expect(bc).toHaveProperty(field);
    }
    expect(bc.state).toBe('seeded');
    expect(typeof bc.incomplete).toBe('boolean');
  });

  it('UT-S05-B03: 派生索引 source_hash 与文档不符时 freshness=stale', () => {
    writeAdoptedSeedState(root, 'seeded', { core: { source_hash: 'deadbeef-mismatch' } });
    writeReverseDoc(root, 'core-system-map.md', revCand('cli:adopt', { verified: false }));

    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_coverage?.freshness).toBe('stale');
    expect(mod.baseline_coverage?.source).toBe('derived-index');
  });

  it('UT-S05-B04: 零候选 seeded 覆盖率报 n/a（denominator 0、coverage 不虚报）', () => {
    writeAdoptedSeedState(root, 'seeded');
    // 无逆向产物文档
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_coverage).toMatchObject({ state: 'seeded', denominator: 0, human_verified: 0, incomplete: false });
    expect(mod.suggestion).toContain('n/a');
  });

  it('ST-S05-B01（tombstone 不虚增）: 删除候选转 tombstone 后百分比不上升、分母不缩', () => {
    writeAdoptedSeedState(root, 'seeded');
    writeReverseDoc(root, 'core-system-map.md',
      revCand('cli:adopt', { verified: true }) +
      revCand('cli:next', { verified: false }));
    const before = collectStatusData(root).modules![0].baseline_coverage!;
    expect(before).toMatchObject({ human_verified: 1, denominator: 2 });

    // 重扫：b 消失 → 转 tombstone（仍在分母）
    writeReverseDoc(root, 'core-system-map.md',
      revCand('cli:adopt', { verified: true }) +
      revCand('cli:next', { state: 'tombstone', verified: false }));
    const after = collectStatusData(root).modules![0].baseline_coverage!;
    expect(after.denominator).toBe(2);
    expect(after.human_verified).toBe(1);
    expect(after.tombstones).toBe(1);
  });

  it('UT-S33-17 / ST-S33-EX-04: verify 对 verified:false 逆向 spec 仅软告警（不硬失败机制）', () => {
    writeAdoptedSeedState(root, 'seeded');
    writeReverseDoc(root, 'core-system-map.md', revCand('cli:adopt', { verified: false }));
    const warnings = collectBaselineSoftWarnings(root, ['core']);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('软告警');
    expect(warnings[0]).toContain('不阻断');

    // 全部人工确认后无软告警
    writeReverseDoc(root, 'core-system-map.md', revCand('cli:adopt', { verified: true, confirmed_by: 'fred' }));
    expect(collectBaselineSoftWarnings(root, ['core'])).toHaveLength(0);
  });
});
