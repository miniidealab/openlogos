/**
 * feature-backfill — add-feature-model（S34）：`openlogos feature-backfill` 生成 AI 回填 prompt。
 *
 * feature-backfill-brownfield（S34 扩展）：除顶层 `scenarios[]` 外，还在 S33 提交恢复读锁临界区内
 * 纳入逆向**场景候选**（scenario-candidates）。规范源：spec/cli-json-output.md §1.4/1.5、
 * logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S34-feature-management.md「补充时序」。
 *
 * 边界：CLI **只生成 prompt**（不改 `logos-project.yaml`、不改 `## 逆向基线来源` 章节、不触发覆盖率副作用），
 * 打印/返回 `prompt_path` + 必填 `baseline_candidates_total`，幂等。AI 按 prompt 聚类 + 为逆向候选取号 + 登记
 * `scenarios[]` + 分配 feature，但**不改** provenance `verified`（导航 ≠ 可信度）。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectYaml } from '../lib/project-yaml.js';
import type { ProjectYamlFeature, ProjectYamlScenario } from '../lib/project-yaml.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { parseProvenanceSection, listModuleProvenanceDocs, isCandidateKeyRecomputable } from '../lib/baseline-provenance.js';
import { withRecoveredReadLocks, listRunIds, readRunRecord } from '../lib/baseline-seed-txn.js';

const PROMPT_REL = 'logos/feature-backfill-prompt.md';
const FEATURE_SPECS_DIR = 'logos/resources/prd/2-product-design/1-feature-specs';

/** 逆向场景候选（纳入 prompt 的最终形态；携所属 module，来自 provenance 章节的 active && verified:false 候选）。 */
interface ScenarioCandidate {
  key: string;
  name: string;
  module: string;
}

/**
 * provenance-scan-canonical-recompute：provenance 判定失败的分类 + 触发文件（供 BASELINE_PROVENANCE_INVALID envelope）。
 * - `unparseable`：权威/约定目标 `## 逆向基线来源` 坏 fenced YAML。
 * - `unclassifiable-evidence`：有 provenance/baseline_index 迹象但无 manifest 且无约定命名文件、不可定类。
 */
interface ProvenanceInvalid {
  reason: 'unparseable' | 'unclassifiable-evidence';
  paths: string[];
}

/** 场景是否已解析到本 module 的某个注册 feature。 */
function isResolved(s: ProjectYamlScenario, features: readonly ProjectYamlFeature[]): boolean {
  if (typeof s.feature !== 'string') return false;
  const mod = s.module ?? 'core';
  return features.some((f) => f.id === s.feature && f.module === mod);
}

function firstLines(path: string, n: number): string {
  try {
    return readFileSync(path, 'utf-8').split('\n').slice(0, n).join('\n');
  } catch {
    return '';
  }
}

/**
 * scenario-candidates 命名约定回退（回应 r2-F2）：按**文件名**枚举 `logos/resources` 下 `<module>-scenario-candidates.md`，
 * **不依赖内容能否解析**（坏 fenced YAML 也返回，交由下游 parseProvenanceSection → parseFailed → BASELINE_PROVENANCE_INVALID）。
 * 排除 run 私有 staging/backup 副本。返回项目根相对 posix 路径（形如 `logos/resources/...`）。
 */
function conventionScenarioCandidateDocs(root: string, moduleId: string): string[] {
  const base = join(root, 'logos', 'resources');
  if (!existsSync(base)) return [];
  const name = `${moduleId}-scenario-candidates.md`;
  const out: string[] = [];
  for (const f of readdirSync(base, { recursive: true })) {
    const rel = String(f).replace(/\\/g, '/');
    if (rel.includes('verify/baseline-seed-runs/')) continue; // run 私有目录副本不算主文档
    if (rel === name || rel.endsWith(`/${name}`)) out.push(`logos/resources/${rel}`);
  }
  return out;
}

/**
 * 该 module 的逆向**场景候选**权威目标文档 + 候选 key 白名单（回应 F1：候选无 `kind`，须显式筛类，且**只读**这些目标）。
 * 优先级（架构 §二十.A 场景候选唯一查询协议）：
 *   ①最新 committed（非 superseded）run manifest 的 `kind==scenario-candidates → {target_path, candidate_keys}`（权威）；
 *   ②无 committed run manifest → 按**命名约定** `<module>-scenario-candidates.md` 回退（keys=null，无白名单）。
 * @returns null 表示"该 module 无可识别的场景候选目标"（调用侧据 provenance 迹象判"真·非存量" vs "不可定类降级"）。
 */
function scenarioCandidateTargets(root: string, moduleId: string): { targets: string[]; keys: Set<string> | null } | null {
  const committed = listRunIds(root)
    .map((id) => readRunRecord(root, id))
    .filter((r): r is NonNullable<typeof r> => !!r && r.module === moduleId && r.status === 'committed')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const latest = committed[committed.length - 1];
  if (latest) {
    const sc = latest.expected.filter((e) => e.kind === 'scenario-candidates');
    if (sc.length > 0) {
      const targets = [...new Set(sc.map((e) => e.target_path))];
      const keys = new Set<string>(sc.flatMap((e) => e.candidate_keys));
      return { targets, keys };
    }
  }
  // 回退：无 committed run manifest → 按**文件名**枚举命名约定目标（不依赖内容解析；坏 YAML 亦作为回退目标）
  const convTargets = conventionScenarioCandidateDocs(root, moduleId);
  if (convTargets.length > 0) return { targets: convTargets, keys: null };
  return null;
}

/**
 * 读某 module 的逆向**场景候选**（回应 F1/F2）：
 *   - 经 {@link scenarioCandidateTargets} 定位权威/约定目标文档，**只读这些文档**（无关坏 provenance 绝不阻断）；
 *   - 目标文档 `## 逆向基线来源` 直接解析（不信 baseline_index → stale 天然重算）；任一权威目标解析失败 → `parseFailed`；
 *   - 筛选谓词固定 `state==active && verified==false`（排除 verified:true / tombstone / retired；manifest 路径再交候选 key 白名单）；
 *   - 无可识别目标时：有 provenance/baseline_index 迹象但不可定类 → `parseFailed`（不静默计 0）；真·非存量 → 空且不报错。
 * @returns parseFailed 为真时 candidates 无意义，调用侧须报 BASELINE_PROVENANCE_INVALID。
 */
function readModuleScenarioCandidates(
  root: string,
  moduleId: string,
  hasIndexEntry: boolean,
): { candidates: ScenarioCandidate[]; invalid?: ProvenanceInvalid } {
  const located = scenarioCandidateTargets(root, moduleId);
  if (located === null) {
    // 无 manifest、无约定目标：区分"真·非存量"(0) 与"有迹象但不可定类"(降级报错)
    const evidenceDocs = listModuleProvenanceDocs(root, moduleId);
    if (hasIndexEntry || evidenceDocs.length > 0) {
      // 有 provenance/baseline_index 迹象但不可定类 → paths = 构成迹象的文档（baseline_index-only 时无文件路径）
      return { candidates: [], invalid: { reason: 'unclassifiable-evidence', paths: [...evidenceDocs].sort() } };
    }
    return { candidates: [] }; // 真·非存量
  }
  const { targets, keys } = located;
  const byKey = new Map<string, ScenarioCandidate>();
  for (const rel of [...targets].sort()) {
    let section: ReturnType<typeof parseProvenanceSection> = null;
    try {
      section = parseProvenanceSection(readFileSync(join(root, rel), 'utf-8'));
    } catch {
      section = null;
    }
    // 权威/约定目标缺失或坏 fenced YAML → 候选不可信、降级报错（区别于真·零候选），paths 指向该坏目标
    if (!section || !section.parse_ok) return { candidates: [], invalid: { reason: 'unparseable', paths: [rel] } };
    // provenance-scan-canonical-recompute：采信 = alias-aware canonical 重算（不再仅前缀匹配）
    const modCands = section.candidates
      .filter((c) => isCandidateKeyRecomputable(c, moduleId))
      .sort((a, b) => a.key.localeCompare(b.key));
    for (const c of modCands) {
      if ((keys === null || keys.has(c.key)) && c.state === 'active' && c.verified === false && !byKey.has(c.key)) {
        byKey.set(c.key, { key: c.key, name: c.display ?? c.anchor ?? c.key, module: moduleId });
      }
    }
  }
  return { candidates: [...byKey.values()] };
}

function buildPrompt(
  scenarios: ProjectYamlScenario[],
  features: ProjectYamlFeature[],
  baselineCandidates: ScenarioCandidate[],
  featureSpecs: Array<{ rel: string; content: string }>,
  currentYaml: string,
): string {
  const scenarioLines = scenarios
    .map((s) => `- ${s.id}｜${s.name ?? s.id}｜module=${s.module ?? 'core'}｜feature=${s.feature ?? '(未分组)'}`)
    .join('\n');
  const candidateLines = baselineCandidates
    .map((c) => `- ${c.key}｜${c.name}｜module=${c.module}｜逆向候选 · verified:false · 未进 scenarios[]`)
    .join('\n');
  const specBlocks = featureSpecs.length > 0
    ? featureSpecs.map((d) => `### ${d.rel}\n\n${d.content}`).join('\n\n')
    : '（未发现 feature-specs 文档）';

  return `# feature 回填指令（add-feature-model / S34 + feature-backfill-brownfield）

你的任务：为下列**平铺场景**与**逆向场景候选**按功能域聚类，回填 \`logos/logos-project.yaml\`：给已有场景补 \`scenario.feature\`、把逆向候选登记为新场景并分配 feature、维护 \`feature_counter\` 与 \`scenario_counter\`。**只补未分组场景，绝不覆盖已有归属；幂等、可反复运行。**

## feature ID 取号算法（AI 维护，务必遵守）

- feature ID 项目全局唯一、格式 \`F0X\`，**严禁不同 module 从 F01 重号**。
- **缺失默认**：\`configured_next_id = feature_counter?.next_id ?? 1\`（无 \`feature_counter\` 时从 \`F01\` 起）。
- **两步式冲突恢复（防 off-by-one 重号）**：设已有最大 feature 编号为 \`max(existing)\`（无 feature 时为 0），取
  \`allocated = max(configured_next_id, max(existing)+1)\`，用 \`allocated\` 创建，随后持久化
  \`feature_counter.next_id = allocated + 1\`。工作示例：已有 \`F05\`、\`next_id=3\` → \`allocated=max(3,6)=6\`（\`F06\`）、持久化 \`7\`、下次 \`F07\`；绝不复用已存在 ID。
- feature 归属单一 module；\`spec\` 可选链接 feature-specs 文档序号（如 \`core-01\`）。

## scenario ID 取号算法（登记逆向候选为新场景，务必遵守）

- **缺失默认**：\`configured_next_id = scenario_counter.next_id ?? 1\`（无 \`scenario_counter\` 时从 \`S01\` 起）。
- **两步式冲突恢复**：设已有最大 scenario 编号为 \`max(existing S)\`（无场景为 0），取
  \`allocated = max(configured_next_id, max(existing S)+1)\`，按下面逆向候选清单**确定顺序逐个**分配唯一 \`SXX\`（每次 \`+1\`），最后持久化 \`scenario_counter.next_id = 最后分配值 + 1\`。**严禁复用候选 key 作 scenario id、严禁从 S01 重号**。
- 每个新场景写 \`{id: SXX, name: <候选名>, module: <候选所属 module>, feature: F0X}\`。
- **红线：只登记进 \`scenarios[]\`（导航），绝不改动逆向候选在 \`## 逆向基线来源\` 章节的 \`verified\` 状态（导航 ≠ 可信度，可信度由 S33 JIT 确认流治理）。**

## 已有场景清单（待聚类）

${scenarioLines || '（无场景）'}

## 逆向场景候选（active && verified:false；未进 scenarios[]，需登记 + 聚类）

${candidateLines || '（无逆向场景候选）'}

## 现有 feature-specs 文档（聚类参考）

${specBlocks}

## 当前 logos-project.yaml 全文

\`\`\`yaml
${currentYaml}\`\`\`

## 执行要求

1. 把已有未分组场景 + 逆向候选按功能域聚类；为每个新 feature 用上述算法取号，写入 \`features[]\`（\`{id,name,module,spec?}\`）。
2. 给已有场景补 \`scenario.feature: F0X\`（已有归属的不动）；把每个逆向候选用 scenario 取号算法登记为新场景（\`{id,name,module,feature}\`）。
3. 维护 \`feature_counter.next_id\` 与 \`scenario_counter.next_id\`。
4. 直接回写 \`logos/logos-project.yaml\`（本命令未改动它）；**不改动 \`## 逆向基线来源\` 章节的候选 verified**。
`;
}

export function featureBackfill(format: OutputFormat = 'text', moduleId?: string): void {
  const root = process.cwd();

  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope('feature-backfill', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.')) + '\n');
    } else {
      console.error('Error: logos/logos.config.json not found.');
      console.error('Run `openlogos init` first to initialize the project.');
    }
    process.exit(1);
    return;
  }

  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  const data = readProjectYaml(root).data;
  const registeredModuleIds = (data?.modules ?? []).map((m) => m.id);

  // --module 未注册 → MODULE_NOT_FOUND（与 feature list 一致）
  if (moduleId !== undefined && !registeredModuleIds.includes(moduleId)) {
    const msg = `Module "${moduleId}" is not registered in logos-project.yaml modules[].`;
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope('feature-backfill', 'MODULE_NOT_FOUND', msg)) + '\n');
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
    return;
  }

  // 候选归属的 module 集合：--module 只该 module；否则按 modules[] 顺序聚合（无 modules[] 退化为 'core'）
  const targetModuleIds = moduleId
    ? [moduleId]
    : (registeredModuleIds.length > 0 ? registeredModuleIds : ['core']);

  const allScenarios = data?.scenarios ?? [];
  const features = data?.features ?? [];
  const scenarios = moduleId ? allScenarios.filter((s) => (s.module ?? 'core') === moduleId) : allScenarios;

  // 扫描现有 feature-specs 文档（首 80 行）供 AI 聚类参考
  const specsDir = join(root, FEATURE_SPECS_DIR);
  const featureSpecs: Array<{ rel: string; content: string }> = [];
  if (existsSync(specsDir)) {
    for (const entry of readdirSync(specsDir)) {
      if (!entry.endsWith('.md')) continue;
      featureSpecs.push({ rel: `${FEATURE_SPECS_DIR}/${entry}`, content: firstLines(join(specsDir, entry), 80) });
    }
  }

  // ── S33 提交恢复读锁临界区：候选筛选/计数/prompt 构造/写盘全部在锁内（withRecoveredReadLocks，index-cmd 同范式）──
  type LockOutcome =
    | { kind: 'written'; baselineCandidatesTotal: number; ungroupedTotal: number }
    | { kind: 'provenance_invalid'; modules: string[]; reason: ProvenanceInvalid['reason']; paths: string[] };
  const at = new Date().toISOString();
  const locked = withRecoveredReadLocks(root, at, targetModuleIds, (): LockOutcome => {
    // 逆向场景候选（按 module 顺序聚合），任一 module provenance 解析失败 → 不写 prompt、报错
    const baselineCandidates: ScenarioCandidate[] = [];
    const invalidModules: string[] = [];
    const invalidPaths = new Set<string>();
    let sawUnparseable = false;
    for (const m of targetModuleIds) {
      const hasIndexEntry = data?.baseline_index?.[m] !== undefined;
      const { candidates, invalid } = readModuleScenarioCandidates(root, m, hasIndexEntry);
      if (invalid) {
        invalidModules.push(m);
        for (const p of invalid.paths) invalidPaths.add(p);
        if (invalid.reason === 'unparseable') sawUnparseable = true;
      } else {
        baselineCandidates.push(...candidates);
      }
    }
    if (invalidModules.length > 0) {
      // 混合分类时 unparseable 更具体（有坏文件）→ 取之；否则 unclassifiable-evidence。paths 为跨 module 并集（确定性升序）。
      return {
        kind: 'provenance_invalid',
        modules: invalidModules,
        reason: sawUnparseable ? 'unparseable' : 'unclassifiable-evidence',
        paths: [...invalidPaths].sort(),
      };
    }

    const currentYaml = existsSync(yamlPath) ? readFileSync(yamlPath, 'utf-8') : '';
    const prompt = buildPrompt(scenarios, features, baselineCandidates, featureSpecs, currentYaml);
    // 只生成 prompt，绝不改动 logos-project.yaml / 逆向基线来源章节
    writeFileSync(join(root, PROMPT_REL), prompt);
    const ungroupedTotal = scenarios.filter((s) => !isResolved(s, features)).length;
    return { kind: 'written', baselineCandidatesTotal: baselineCandidates.length, ungroupedTotal };
  });

  // 取锁/恢复失败：提交进行中 → 不写/不覆盖 prompt、报错、非零退出
  if (!locked.ok) {
    const msg = `baseline commit in progress for module(s): ${locked.inProgress.join(', ')} — retry later.`;
    if (format === 'json') {
      process.stderr.write(JSON.stringify(makeErrorEnvelope('feature-backfill', 'BASELINE_COMMIT_IN_PROGRESS', msg)) + '\n');
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
    return;
  }

  // provenance 解析失败 → 不写 prompt、报错、非零退出（区别于真·零候选）
  if (locked.value.kind === 'provenance_invalid') {
    const { modules, reason, paths } = locked.value;
    // provenance-scan-canonical-recompute：message/envelope 带触发文件路径 + 失败分类，便于一眼定位
    const pathsHint = paths.length > 0 ? ` paths=[${paths.join(', ')}]` : '';
    const msg = `reverse baseline provenance section invalid/unparseable for module(s): ${modules.join(', ')}. reason=${reason};${pathsHint}`;
    if (format === 'json') {
      const env = makeErrorEnvelope('feature-backfill', 'BASELINE_PROVENANCE_INVALID', msg);
      // 富化错误对象：paths[]（触发文件相对路径清单，键恒在场）+ reason（失败分类）
      (env.error as Record<string, unknown>).paths = paths;
      (env.error as Record<string, unknown>).reason = reason;
      process.stderr.write(JSON.stringify(env) + '\n');
    } else {
      console.error(`Error: ${msg}`);
    }
    process.exit(1);
    return;
  }

  const { baselineCandidatesTotal, ungroupedTotal } = locked.value;

  if (format === 'json') {
    const data2 = {
      prompt_path: PROMPT_REL,
      scenarios_total: scenarios.length,
      ungrouped_total: ungroupedTotal,
      features_existing: features.length,
      // feature-backfill-brownfield：必填非负整数（键恒在场），= 最终写入 prompt 的逆向场景候选数
      baseline_candidates_total: baselineCandidatesTotal,
    };
    process.stdout.write(JSON.stringify(makeEnvelope('feature-backfill', data2)) + '\n');
    return;
  }

  console.log(`\n  ✓ Generated: ${PROMPT_REL}`);
  console.log(`    scenarios=${scenarios.length}  ungrouped=${ungroupedTotal}  features=${features.length}  baseline_candidates=${baselineCandidatesTotal}\n`);
  console.log('Next step:');
  console.log(`  Tell your AI assistant: "Read ${PROMPT_REL} and execute the instructions"`);
  console.log('  The AI will cluster scenarios (incl. reverse candidates) into features and write back logos/logos-project.yaml (this command did not modify it).\n');
}
