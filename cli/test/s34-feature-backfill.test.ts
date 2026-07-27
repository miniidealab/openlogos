/**
 * S34 — 管理 feature 分组（add-feature-model）。切片3：`openlogos feature-backfill` 生成 prompt 命令。
 *
 * 规范源：logos/resources/test/core-S34-test-cases.md、spec/cli-json-output.md §1.4。
 * 覆盖：UT-S34-04 + UT-S34-05 + UT-S34-11 + ST-S34-03。
 *
 * 测试边界（delta-F2）：CLI 不取号、不改 yaml；取号算法以「生成 prompt + scenario-architect Skill 文本」
 * 的静态快照校验锁定，AI 回写不在 CLI 测试执行范围。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { featureBackfill } from '../src/commands/feature-backfill.js';
import { candidateKey, buildBaselineCoverage } from '../src/lib/baseline-provenance.js';
import { atomicWriteJson, runRecordPath, lockPath, journalPath, backupDir, sha256 } from '../src/lib/baseline-seed-txn.js';
import type { CommitJournal, ExpectedItem } from '../src/lib/baseline-seed-txn.js';

const REPO = join(process.cwd(), '..'); // vitest cwd = cli/
const SKILL_PATH = join(REPO, 'skills', 'scenario-architect', 'SKILL.md');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function projectRoot(yamlObj: Record<string, unknown>): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(yamlObj, { lineWidth: 0 }));
  return root;
}

/** 运行 featureBackfill，捕获 console.log（text）、process.stdout.write（json）、stderr、process.exit。 */
function runBackfill(root: string, format: 'text' | 'json', moduleArg?: string): { out: string; stderr: string; threw: boolean } {
  const restoreCwd = mockCwd(root);
  const exitSpy = mockProcessExit();
  const cap = captureConsole();
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const oW = process.stdout.write.bind(process.stdout);
  const eW = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: unknown) => { outChunks.push(String(c)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown) => { errChunks.push(String(c)); return true; }) as typeof process.stderr.write;
  let threw = false;
  try {
    featureBackfill(format, moduleArg);
  } catch {
    threw = true;
  } finally {
    process.stdout.write = oW;
    process.stderr.write = eW;
    cap.restore();
    exitSpy.mockRestore();
    restoreCwd();
  }
  return { out: format === 'json' ? outChunks.join('') : cap.logs.join('\n'), stderr: errChunks.join(''), threw };
}

// ── feature-backfill-brownfield fixtures（provenance 文档 + committed run manifest + commit-in-progress）──
const RESRC = ['logos', 'resources', 'prd', '3-technical-plan', '2-scenario-implementation'];
function reverseDoc(candBody: string): string {
  return `# doc\n\n模块图/场景候选正文。\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${candBody}\`\`\`\n`;
}
function candLine(key: string, anchor: string, o: { state?: string; verified?: boolean } = {}): string {
  return `  - key: "${key}"\n    anchor: "${anchor}"\n    state: ${o.state ?? 'active'}\n    verified: ${o.verified ?? false}\n`;
}
function writeDoc(root: string, rel: string, content: string): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return rel;
}
function writeCommittedRun(root: string, module: string, runId: string, expected: ExpectedItem[]): void {
  atomicWriteJson(runRecordPath(root, runId), { run_id: runId, module, status: 'committed', expected, created_at: '2026-07-14T00:00:00Z' });
}
/** 造 committing journal + 存活进程持锁 → withRecoveredReadLocks 恢复门返回 inProgress。 */
function stallCommit(root: string, module: string): void {
  mkdirSync(dirname(lockPath(root, module)), { recursive: true });
  writeFileSync(lockPath(root, module), JSON.stringify({ pid: 1, at: 0 })); // pid=1 存活 → 不可回收
  const runId = `seed-${module}-stall`;
  const journal: CommitJournal = {
    phase: 'committing', run_id: runId, module,
    targets: [{ target_path: `${RESRC.join('/')}/x.md`, old_sha256: null, new_sha256: sha256('x'), applied: true }],
    index: { yaml_backup_path: join(backupDir(root, runId), 'x.bak'), old_yaml_sha256: null },
    state_transition: { from: 'partial', to: 'seeded' }, keys: [],
  };
  atomicWriteJson(journalPath(root, runId), journal);
}

const FLAT_PROJECT = {
  project: { name: 't' },
  modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
  scenarios: [
    { id: 'S01', name: '场景 S01', module: 'core' },
    { id: 'S02', name: '场景 S02', module: 'core' },
  ],
};

describe('S34 — feature-backfill：取号算法静态快照（prompt + Skill）', () => {
  it('UT-S34-04: prompt 与 scenario-architect Skill 均含两步式冲突恢复 + F05 工作示例', () => {
    const root = projectRoot(FLAT_PROJECT);
    runBackfill(root, 'text');
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    const skill = readFileSync(SKILL_PATH, 'utf-8');
    for (const doc of [prompt, skill]) {
      expect(doc).toContain('allocated = max(configured_next_id, max(existing)+1)');
      // F05 工作示例（分配 F06、持久化 next_id=7、下次 F07、绝不复用）
      expect(doc).toContain('F05');
      expect(doc).toContain('F06');
      expect(doc).toContain('F07');
      expect(doc).toMatch(/next_id\s*=?\s*7|持久化.*7/);
    }
  });

  it('UT-S34-05: prompt 与 Skill 均含计数器缺失默认 configured_next_id = ?? 1', () => {
    const root = projectRoot(FLAT_PROJECT);
    runBackfill(root, 'text');
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    const skill = readFileSync(SKILL_PATH, 'utf-8');
    for (const doc of [prompt, skill]) {
      expect(doc).toContain('configured_next_id = feature_counter?.next_id ?? 1');
    }
  });

  it('feature-backfill prompt 红线不再引用已删除的 JIT 确认流（drop-baseline-confirmation 反向回归）', () => {
    const root = projectRoot(FLAT_PROJECT);
    runBackfill(root, 'text');
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    // 反向：运行时给 AI 的红线不得再指向已删除的 JIT 确认流 / verified 升级。
    expect(prompt).not.toContain('JIT');
    expect(prompt).not.toContain('确认流');
    expect(prompt).not.toMatch(/verified\s*:?\s*true/);
    // 正向：明确 verified 为冻结字段、无确认升级入口。
    expect(prompt).toContain('冻结字段');
    expect(prompt).toContain('不存在确认升级入口');
  });
});

describe('S34 — feature-backfill：CLI 边界（生成 prompt、不改 yaml、幂等）', () => {
  it('UT-S34-11: 打印 prompt_path（text + json），写 prompt 文件，yaml 字节不变，幂等覆盖', () => {
    const root = projectRoot(FLAT_PROJECT);
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const yamlBefore = readFileSync(yamlPath, 'utf-8');

    // text 模式：stdout 含 prompt 相对路径
    const textRes = runBackfill(root, 'text');
    expect(textRes.out).toContain('logos/feature-backfill-prompt.md');

    // json 模式：data.prompt_path 精确等于该路径 + 统计字段
    const jsonRes = runBackfill(root, 'json');
    const env = JSON.parse(jsonRes.out);
    expect(env.command).toBe('feature-backfill');
    expect(env.data.prompt_path).toBe('logos/feature-backfill-prompt.md');
    expect(env.data.scenarios_total).toBe(2);
    expect(env.data.ungrouped_total).toBe(2); // 两个场景均未分组
    expect(env.data.features_existing).toBe(0);

    // prompt 文件已写
    const promptPath = join(root, 'logos', 'feature-backfill-prompt.md');
    const prompt1 = readFileSync(promptPath, 'utf-8');
    expect(prompt1.length).toBeGreaterThan(0);

    // yaml 字节不变（CLI 不改 yaml）
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);

    // 幂等：再次运行覆盖同一 prompt、内容一致
    runBackfill(root, 'text');
    expect(readFileSync(promptPath, 'utf-8')).toBe(prompt1);
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);
  });

  it('ST-S34-03: 存量一键回填 CLI 边界（生成 prompt、路径可读、yaml 字节不变、幂等）', () => {
    const root = projectRoot(FLAT_PROJECT);
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const yamlBefore = readFileSync(yamlPath, 'utf-8');

    const res1 = runBackfill(root, 'json');
    expect(JSON.parse(res1.out).data.prompt_path).toBe('logos/feature-backfill-prompt.md');
    const promptPath = join(root, 'logos', 'feature-backfill-prompt.md');
    const p1 = readFileSync(promptPath, 'utf-8');
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);

    // 幂等重跑
    runBackfill(root, 'json');
    expect(readFileSync(promptPath, 'utf-8')).toBe(p1);
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);
  });
});

// ── feature-backfill-brownfield：纳入逆向场景候选 ──
const BROWNFIELD_YAML = {
  project: { name: 't' },
  modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
  scenarios: [] as unknown[],
};
/** 写 provenance 文档(scenario-candidates + 可选 system-map) + committed run manifest。返回场景候选 key。 */
function setupBrownfield(
  root: string,
  module: string,
  sc: Array<{ anchor: string; state?: string; verified?: boolean }>,
  sm: string[] = [],
): { scKeys: string[] } {
  const scKeys = sc.map((c) => candidateKey(module, c.anchor));
  const scPath = writeDoc(root, `${RESRC.join('/')}/${module}-scenarios.md`,
    reverseDoc(sc.map((c, i) => candLine(scKeys[i], c.anchor, { state: c.state, verified: c.verified })).join('')));
  const expected: ExpectedItem[] = [{ kind: 'scenario-candidates', target_path: scPath, candidate_keys: scKeys }];
  if (sm.length) {
    const smKeys = sm.map((a) => candidateKey(module, a));
    const smPath = writeDoc(root, `${RESRC.join('/')}/${module}-systemmap.md`,
      reverseDoc(sm.map((a, i) => candLine(smKeys[i], a)).join('')));
    expected.push({ kind: 'system-map', target_path: smPath, candidate_keys: smKeys });
  }
  writeCommittedRun(root, module, `seed-${module}-1`, expected);
  return { scKeys };
}
/** `## 逆向基线来源` 章节含**真·坏 fenced YAML**（未终止引号 → parseYaml 抛错 → parse_ok=false）。 */
function badReverseDoc(): string {
  return '# doc\n\n## 逆向基线来源\n```yaml\ncandidates:\n  - key: "unterminated\n    state: active\n```\n';
}
/** 写按**命名约定** `<module>-scenario-candidates.md` 的合法场景候选文档（无 run manifest；供 F2 回退分类器）。 */
function writeConventionCandidates(root: string, module: string, anchors: string[]): string[] {
  const keys = anchors.map((a) => candidateKey(module, a));
  writeDoc(root, `${RESRC.join('/')}/${module}-scenario-candidates.md`,
    reverseDoc(anchors.map((a, i) => candLine(keys[i], a)).join('')));
  return keys;
}

describe('S34 — feature-backfill-brownfield：纳入逆向场景候选', () => {
  it('UT-S34-15: 只纳入 active&&verified==false 场景候选，排除 system-map/verified:true/tombstone；同 module 坏 system-map 不阻断（回应 F1）', () => {
    const root = projectRoot(BROWNFIELD_YAML);
    setupBrownfield(root, 'core',
      [
        { anchor: 'sc:a' },                        // active verified:false → 纳入
        { anchor: 'sc:b', verified: true },        // verified:true → 排除
        { anchor: 'sc:t', state: 'tombstone' },    // tombstone → 排除
      ],
      ['sys:map']);                                 // system-map 候选 → 排除
    // F1 隔离：同 module 另有一份**坏 fenced YAML 的 system-map 文档**（旧实现 scanModuleCandidates 会全局 parse_failed → 误报）
    writeDoc(root, `${RESRC.join('/')}/core-system-map.md`, badReverseDoc());
    const env = JSON.parse(runBackfill(root, 'json').out);
    expect(env.data.baseline_candidates_total).toBe(1); // 只读 scenario-candidates target，坏 system-map 不阻断
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).toContain('sc:a');       // 纳入
    expect(prompt).not.toContain('sc:b');   // verified:true 排除
    expect(prompt).not.toContain('sc:t');   // tombstone 排除
    expect(prompt).not.toContain('sys:map'); // system-map 排除
    expect(prompt).toContain('verified:false'); // 如实标注
  });

  it('UT-S34-16: baseline_candidates_total == 最终纳入的场景候选数', () => {
    const root = projectRoot(BROWNFIELD_YAML);
    setupBrownfield(root, 'core', [{ anchor: 'a' }, { anchor: 'b' }, { anchor: 'c' }]);
    const env = JSON.parse(runBackfill(root, 'json').out);
    expect(env.data.baseline_candidates_total).toBe(3);
    expect(typeof env.data.baseline_candidates_total).toBe('number');
  });

  it('UT-S34-17: 非存量→0 / 无 run 历史按命名约定回退→N / 有迹象不可定类→报错（回应 F2/F4）', () => {
    // ① 真·非存量（无 provenance / 无 baseline_index / 无 run manifest）→ 键在场且 0，命令成功
    const root0 = projectRoot(FLAT_PROJECT);
    const env0 = JSON.parse(runBackfill(root0, 'json').out);
    expect('baseline_candidates_total' in env0.data).toBe(true);
    expect(env0.data.baseline_candidates_total).toBe(0);
    expect(readFileSync(join(root0, 'logos', 'feature-backfill-prompt.md'), 'utf-8')).toContain('（无逆向场景候选）');

    // ② 有合法场景候选但 run 历史缺失/已迁移 → 按命名约定 `<module>-scenario-candidates.md` 回退识别 → 不静默计 0
    const root1 = projectRoot(BROWNFIELD_YAML);
    writeConventionCandidates(root1, 'core', ['mig:a', 'mig:b']); // 无 committed run manifest
    const env1 = JSON.parse(runBackfill(root1, 'json').out);
    expect(env1.data.baseline_candidates_total).toBe(2); // 命名约定回退纳入，绝非伪装成 0
    expect(readFileSync(join(root1, 'logos', 'feature-backfill-prompt.md'), 'utf-8')).toContain('mig:a');

    // ③ 有 provenance 迹象但无 run manifest 且无约定命名文档（无法可靠区分场景候选/system-map）→ 降级报错，不静默计 0
    const root2 = projectRoot(BROWNFIELD_YAML);
    const k = candidateKey('core', 'x');
    writeDoc(root2, `${RESRC.join('/')}/core-mystery.md`, reverseDoc(candLine(k, 'x'))); // 命名非 scenario-candidates、无 manifest
    const res2 = runBackfill(root2, 'json');
    expect(res2.threw).toBe(true);
    expect(JSON.parse(res2.stderr).error.code).toBe('BASELINE_PROVENANCE_INVALID');
    expect(existsSync(join(root2, 'logos', 'feature-backfill-prompt.md'))).toBe(false);

    // ④ 无 run、无 index，但**约定命名目标 `<module>-scenario-candidates.md` 本身坏 fenced YAML**（回应 r2-F2）
    //    回退目标发现按文件名枚举、不依赖解析 → 读取该目标解析失败 → 报错，绝不伪装成真·非存量计 0，且不覆盖哨兵 prompt
    const root3 = projectRoot(BROWNFIELD_YAML);
    writeDoc(root3, `${RESRC.join('/')}/core-scenario-candidates.md`, badReverseDoc()); // 约定命名 + 坏 YAML，无 manifest/无 index
    const promptPath3 = join(root3, 'logos', 'feature-backfill-prompt.md');
    const SENTINEL = '# SENTINEL — 坏迁移目标不得伪装成 0\n';
    writeFileSync(promptPath3, SENTINEL);
    const res3 = runBackfill(root3, 'json');
    expect(res3.threw).toBe(true);
    expect(JSON.parse(res3.stderr).error.code).toBe('BASELINE_PROVENANCE_INVALID');
    expect(readFileSync(promptPath3, 'utf-8')).toBe(SENTINEL); // 字节不变、未覆盖、未计 0
  });

  it('UT-S34-18: CLI 不改 yaml、不改 provenance verified、幂等', () => {
    const root = projectRoot(BROWNFIELD_YAML);
    setupBrownfield(root, 'core', [{ anchor: 'a' }, { anchor: 'b' }]);
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const scDoc = join(root, ...RESRC, 'core-scenarios.md');
    const yamlBefore = readFileSync(yamlPath, 'utf-8');
    const docBefore = readFileSync(scDoc, 'utf-8');
    const p1 = (runBackfill(root, 'text'), readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8'));
    // 重复执行
    runBackfill(root, 'text');
    expect(readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8')).toBe(p1); // prompt 幂等
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);                                   // yaml 不变
    expect(readFileSync(scDoc, 'utf-8')).toBe(docBefore);                                       // provenance verified 不变
  });

  it('UT-S34-19: 提交进行中 → BASELINE_COMMIT_IN_PROGRESS、非零退出、不覆盖已有 prompt（哨兵字节，回应 F3）', () => {
    const root = projectRoot(BROWNFIELD_YAML);
    setupBrownfield(root, 'core', [{ anchor: 'a' }]);
    // 预写哨兵 prompt：失败路径必须**不覆盖**它（比"文件不存在"更强）
    const promptPath = join(root, 'logos', 'feature-backfill-prompt.md');
    const SENTINEL = '# SENTINEL PROMPT — 不得被覆盖\n';
    writeFileSync(promptPath, SENTINEL);
    stallCommit(root, 'core'); // committing journal + 存活进程持锁
    const res = runBackfill(root, 'json');
    expect(res.threw).toBe(true); // process.exit(1)
    expect(JSON.parse(res.stderr).error.code).toBe('BASELINE_COMMIT_IN_PROGRESS');
    expect(readFileSync(promptPath, 'utf-8')).toBe(SENTINEL); // 字节完全不变，未被覆盖
  });

  it('UT-S34-20: prompt 含 scenario 全局取号契约与"不改 provenance verified"红线（静态快照）', () => {
    const root = projectRoot(BROWNFIELD_YAML);
    setupBrownfield(root, 'core', [{ anchor: 'a' }]);
    runBackfill(root, 'text');
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).toContain('configured_next_id = scenario_counter.next_id ?? 1');
    expect(prompt).toContain('allocated = max(configured_next_id, max(existing S)+1)');
    expect(prompt).toContain('绝不改动逆向候选在 `## 逆向基线来源` 章节的 `verified` 状态');
  });

  it('UT-S34-21: 索引 stale 重算(成功) / 权威目标坏 fenced YAML 报错(哨兵字节) / 无关坏文档不阻断（回应 F6+F3+F1）', () => {
    // ① 索引 stale 但权威文档有效 → CLI 只读 manifest 目标文档(不信 index) → 成功、正常纳入
    const root1 = projectRoot({ ...BROWNFIELD_YAML, baseline_index: { core: { source_hash: 'STALE_WRONG', denominator: 1 } } });
    setupBrownfield(root1, 'core', [{ anchor: 'a' }]);
    const env = JSON.parse(runBackfill(root1, 'json').out);
    expect(env.data.baseline_candidates_total).toBe(1); // stale index 不影响，从权威文档重算

    // ② 权威 scenario-candidates 目标本身坏 fenced YAML（未终止引号）→ BASELINE_PROVENANCE_INVALID、非零退出、不覆盖哨兵 prompt
    const root2 = projectRoot(BROWNFIELD_YAML);
    const badPath = `${RESRC.join('/')}/core-scenarios.md`;
    writeDoc(root2, badPath, badReverseDoc());
    writeCommittedRun(root2, 'core', 'seed-core-1', [{ kind: 'scenario-candidates', target_path: badPath, candidate_keys: [candidateKey('core', 'a')] }]);
    const promptPath2 = join(root2, 'logos', 'feature-backfill-prompt.md');
    const SENTINEL = '# SENTINEL — 权威目标坏也不得覆盖\n';
    writeFileSync(promptPath2, SENTINEL);
    const res = runBackfill(root2, 'json');
    expect(res.threw).toBe(true);
    expect(JSON.parse(res.stderr).error.code).toBe('BASELINE_PROVENANCE_INVALID');
    expect(readFileSync(promptPath2, 'utf-8')).toBe(SENTINEL); // 未覆盖

    // ③ F1：`--module core`，另一 module(admin) 有坏 provenance → 只读 core scenario-candidates target → 不受 admin 坏文档阻断
    const root3 = projectRoot({
      project: { name: 't' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'admin', name: 'Admin', lifecycle: 'launched' }],
      scenarios: [],
    });
    setupBrownfield(root3, 'core', [{ anchor: 'a' }]);
    writeDoc(root3, `${RESRC.join('/')}/admin-scenario-candidates.md`, badReverseDoc()); // 无关 module 坏文档
    const env3 = JSON.parse(runBackfill(root3, 'json', 'core').out);
    expect(env3.data.baseline_candidates_total).toBe(1); // core 正常、admin 坏文档不阻断
  });

  it('UT-S34-22: 经 S33 正式覆盖率读取入口 buildBaselineCoverage，命令前后深相等（含 freshness，回应 F7）', () => {
    // 带 baseline_index 使 freshness 参与判定（正式入口 = 生产 status/next 所用同一读取路径）
    const root = projectRoot({ ...BROWNFIELD_YAML, baseline_index: { core: { source_hash: 'X', denominator: 3 } } });
    setupBrownfield(root, 'core', [
      { anchor: 'a' },                              // active
      { anchor: 'v', verified: true },              // active（verified 为残留字段，不影响计数）
      { anchor: 't', state: 'tombstone' },          // tombstone（进 denominator）
    ]);
    const indexEntry = { source_hash: 'X', denominator: 3 };
    const readCov = () => buildBaselineCoverage(root, 'core', 'seeded', indexEntry);
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const scDoc = join(root, ...RESRC, 'core-scenarios.md');
    const before = readCov();
    const yamlBefore = readFileSync(yamlPath, 'utf-8');
    const docBefore = readFileSync(scDoc, 'utf-8');
    runBackfill(root, 'json');
    const after = readCov();
    // 正式入口返回对象整体深相等（纯计数 shape：state/incomplete/denominator/tombstones/source/freshness）
    expect(after).toEqual(before);
    expect(after.freshness).toBe(before.freshness);
    // denominator = active(a,v) ∪ tombstone(t) = 3；tombstones = 1，命令前后不变（纯逆向候选计数，无分子/比值）
    expect(before.denominator).toBe(3);
    expect(before.tombstones).toBe(1);
    expect(before).not.toHaveProperty('human_verified'); // 分子字段已删
    expect(before).not.toHaveProperty('coverage');       // 比值字段已删
    // 并存：YAML / provenance / prompt 幂等字节断言
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);
    expect(readFileSync(scDoc, 'utf-8')).toBe(docBefore);
    const p1 = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    runBackfill(root, 'json');
    expect(readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8')).toBe(p1);
  });

  it('ST-S34-04: 存量项目 feature-backfill 纳入场景候选（CLI 边界，yaml/provenance 不变）', () => {
    const root = projectRoot(BROWNFIELD_YAML);
    setupBrownfield(root, 'core', [{ anchor: 'sc:x' }]);
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const scDoc = join(root, ...RESRC, 'core-scenarios.md');
    const yamlBefore = readFileSync(yamlPath, 'utf-8');
    const docBefore = readFileSync(scDoc, 'utf-8');
    const env = JSON.parse(runBackfill(root, 'json').out);
    expect(env.data.prompt_path).toBe('logos/feature-backfill-prompt.md');
    expect(env.data.baseline_candidates_total).toBe(1);
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).toContain('sc:x');
    expect(prompt).toContain('逆向候选 · verified:false · 未进 scenarios[]');
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);   // yaml 不变
    expect(readFileSync(scDoc, 'utf-8')).toBe(docBefore);       // provenance 不变
  });

  it('ST-S34-05: --module 与全项目候选口径 + 未注册 module 报错', () => {
    const root = projectRoot({
      project: { name: 't' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'admin', name: 'Admin', lifecycle: 'launched' }],
      scenarios: [],
    });
    setupBrownfield(root, 'core', [{ anchor: 'c1' }, { anchor: 'c2' }]); // core: 2
    setupBrownfield(root, 'admin', [{ anchor: 'a1' }]);                   // admin: 1
    // ① --module core → 仅 core
    expect(JSON.parse(runBackfill(root, 'json', 'core').out).data.baseline_candidates_total).toBe(2);
    // ② 无 --module → 聚合两 module
    expect(JSON.parse(runBackfill(root, 'json').out).data.baseline_candidates_total).toBe(3);
    // ③ 未注册 module → MODULE_NOT_FOUND、非零退出
    const ghost = runBackfill(root, 'json', 'ghost');
    expect(ghost.threw).toBe(true);
    expect(JSON.parse(ghost.stderr).error.code).toBe('MODULE_NOT_FOUND');
  });
});

describe('S34 — feature-backfill 防文档示例毒化 + 错误 envelope 富化（provenance-scan-canonical-recompute）', () => {
  it('UT-S34-23: 含示例章节的文档不使真·非存量项目误报（扫描侧 canonical 采信）', () => {
    const root = projectRoot(FLAT_PROJECT); // 无 baseline_index / 无 committed run manifest
    // 指南格式示例章节：ghost 候选（key 格式合法但与 anchor 重算失配）存入 reference/
    writeDoc(root, 'logos/resources/reference/brownfield-adopter-guide.md',
      reverseDoc(candLine('core::a1b2c3d4e5f6', 'cli:baseline-seed-commit')));
    const guideBefore = readFileSync(join(root, 'logos/resources/reference/brownfield-adopter-guide.md'), 'utf-8');

    const res = runBackfill(root, 'json');
    expect(res.threw).toBe(false); // 不再硬报错
    const env = JSON.parse(res.out);
    expect(env.error).toBeUndefined();
    expect(env.data.baseline_candidates_total).toBe(0); // 幽灵候选不采信 → 真·非存量计 0
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).toContain('（无逆向场景候选）');
    // CLI 只读：示例文档字节不变
    expect(readFileSync(join(root, 'logos/resources/reference/brownfield-adopter-guide.md'), 'utf-8')).toBe(guideBefore);
  });

  it('UT-S34-24: BASELINE_PROVENANCE_INVALID envelope 含触发文件路径 + 失败分类', () => {
    // ① unparseable：约定目标 core-scenario-candidates.md 坏 fenced YAML
    const root1 = projectRoot(BROWNFIELD_YAML);
    const badPath = `${RESRC.join('/')}/core-scenario-candidates.md`;
    writeDoc(root1, badPath, badReverseDoc());
    const res1 = runBackfill(root1, 'json');
    expect(res1.threw).toBe(true);
    const e1 = JSON.parse(res1.stderr).error;
    expect(e1.code).toBe('BASELINE_PROVENANCE_INVALID');
    expect(e1.reason).toBe('unparseable');
    expect(Array.isArray(e1.paths)).toBe(true);
    expect(e1.paths).toContain(badPath); // 触发文件相对路径

    // ② unclassifiable-evidence：有可重算 provenance 迹象但无 manifest 且非约定命名
    const root2 = projectRoot(BROWNFIELD_YAML);
    const mysteryRel = `${RESRC.join('/')}/core-mystery.md`;
    writeDoc(root2, mysteryRel, reverseDoc(candLine(candidateKey('core', 'x'), 'x'))); // key 可重算 → 真迹象
    const res2 = runBackfill(root2, 'json');
    expect(res2.threw).toBe(true);
    const e2 = JSON.parse(res2.stderr).error;
    expect(e2.code).toBe('BASELINE_PROVENANCE_INVALID');
    expect(e2.reason).toBe('unclassifiable-evidence');
    expect(e2.paths).toContain(mysteryRel);
  });
});

// ── 已登记去重（幂等硬门，scenario-registry-duplicate-on-rescan）──
// 候选 name = display ?? anchor ?? key（feature-backfill.ts）；fixture 无 display → name = anchor。
// 故让 scenarios[].name 与候选 anchor 逐字相等即可触发去重。候选 key（candidateKey）只出现在候选段，
// 用作"是否入 prompt"的判据（scenarios[] 清单只含 name，不含 key，故 key 不会误命中已有场景清单）。
describe('S34 — feature-backfill：已登记去重（scenario-registry-duplicate-on-rescan）', () => {
  it('UT-S34-25: 候选与 scenarios[] 同 module 同 name → 剔除、不入 prompt、不计数；provenance 字节不变', () => {
    const anchor = '用户注册与登录';
    const root = projectRoot({
      project: { name: 't' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      scenarios: [{ id: 'S01', name: anchor, module: 'core' }],
    });
    setupBrownfield(root, 'core', [{ anchor }]); // 候选 anchor 与已登记场景同名同 module
    const scDoc = join(root, ...RESRC, 'core-scenarios.md');
    const docBefore = readFileSync(scDoc, 'utf-8');

    const env = JSON.parse(runBackfill(root, 'json').out);
    expect(env.data.baseline_candidates_total).toBe(0); // 已登记 → 剔除、不计数
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).not.toContain(candidateKey('core', anchor)); // 候选 key 未入 prompt
    expect(prompt).toContain('（无逆向场景候选）');
    // 红线：只读侧过滤，不改 `## 逆向基线来源` 章节候选 state/verified
    expect(readFileSync(scDoc, 'utf-8')).toBe(docBefore);
  });

  it('UT-S34-26: 真·新增候选（scenarios[] 无同名）不误杀、仍纳入', () => {
    const registered = 'A：账号登录';
    const fresh = 'B：证书解析';
    const root = projectRoot({
      project: { name: 't' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      scenarios: [{ id: 'S01', name: registered, module: 'core' }],
    });
    setupBrownfield(root, 'core', [{ anchor: registered }, { anchor: fresh }]);
    const env = JSON.parse(runBackfill(root, 'json').out);
    expect(env.data.baseline_candidates_total).toBe(1); // 只计入未登记的 B
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).toContain(candidateKey('core', fresh));       // B 纳入
    expect(prompt).not.toContain(candidateKey('core', registered)); // A（已登记）剔除
  });

  it('UT-S34-27: 重跑 backfill 对已登记候选幂等（total 稳定、prompt 幂等、yaml/provenance 字节不变）', () => {
    const a = '场景甲'; const b = '场景乙';
    const root = projectRoot({
      project: { name: 't' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      scenarios: [
        { id: 'S01', name: a, module: 'core' },
        { id: 'S02', name: b, module: 'core' },
      ],
    });
    setupBrownfield(root, 'core', [{ anchor: a }, { anchor: b }]); // 全部已登记
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const scDoc = join(root, ...RESRC, 'core-scenarios.md');
    const yamlBefore = readFileSync(yamlPath, 'utf-8');
    const docBefore = readFileSync(scDoc, 'utf-8');

    const env1 = JSON.parse(runBackfill(root, 'json').out);
    expect(env1.data.baseline_candidates_total).toBe(0);
    const p1 = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    // 重跑
    const env2 = JSON.parse(runBackfill(root, 'json').out);
    expect(env2.data.baseline_candidates_total).toBe(0);
    expect(readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8')).toBe(p1); // prompt 幂等
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);   // yaml 不变
    expect(readFileSync(scDoc, 'utf-8')).toBe(docBefore);       // provenance 不变（无同名孤儿产生入口）
  });

  it('UT-S34-28: 去重键为 (module, name)——跨 module 同名不误剔除', () => {
    const name = '登录';
    const root = projectRoot({
      project: { name: 't' },
      modules: [
        { id: 'core', name: 'Core', lifecycle: 'launched' },
        { id: 'admin', name: 'Admin', lifecycle: 'launched' },
      ],
      scenarios: [{ id: 'S01', name, module: 'core' }], // core 已登记「登录」
    });
    setupBrownfield(root, 'admin', [{ anchor: name }]); // admin 的「登录」候选：同名不同 module
    // 聚合口径：admin 的「登录」不因 core 同名场景被剔除
    const env = JSON.parse(runBackfill(root, 'json').out);
    expect(env.data.baseline_candidates_total).toBe(1);
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).toContain(candidateKey('admin', name)); // admin 候选仍纳入
  });

  it('ST-S34-06: 存量项目重扫不产生同名孤儿场景（CLI 边界；候选段空、total=0、yaml/provenance 字节不变）', () => {
    const names = ['注册登录', '工具发现', '证书解析'];
    const root = projectRoot({
      project: { name: 't' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      scenarios: names.map((n, i) => ({ id: `S0${i + 1}`, name: n, module: 'core' })),
    });
    setupBrownfield(root, 'core', names.map((anchor) => ({ anchor }))); // 上一轮已全部登记
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const scDoc = join(root, ...RESRC, 'core-scenarios.md');
    const yamlBefore = readFileSync(yamlPath, 'utf-8');
    const docBefore = readFileSync(scDoc, 'utf-8');

    const res = runBackfill(root, 'json');
    expect(res.threw).toBe(false); // 退出码 0
    const env = JSON.parse(res.out);
    expect(env.data.baseline_candidates_total).toBe(0);
    const prompt = readFileSync(join(root, 'logos', 'feature-backfill-prompt.md'), 'utf-8');
    expect(prompt).toContain('（无逆向场景候选）'); // 候选段为空
    for (const n of names) expect(prompt).not.toContain(candidateKey('core', n));
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);
    expect(readFileSync(scDoc, 'utf-8')).toBe(docBefore);
  });
});
