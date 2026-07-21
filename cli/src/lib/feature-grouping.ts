/**
 * feature-grouping — add-feature-model（S34）：module → feature → scenario 分组派生（status/next 共享）。
 *
 * 规范源：spec/cli-json-output.md §1.4「modules[].features feature 分组契约」、
 * logos/resources/prd/3-technical-plan/1-architecture §二十。
 *
 * 契约要点（status/next）：
 * - **省略当且仅当**该 module 既无注册 feature（`features[]` 中 `module==本 module`）**且**其下无任何场景带
 *   `feature` 键（纯 pre-feature module）→ 返回 `undefined`（调用侧省略字段）。
 * - 否则输出：按 `features[]` 声明顺序列出每个注册 feature（成员为空 → `scenarios:[]`，保留），
 *   末位 `__ungrouped__`（当且仅当有 ≥1 个未归属/降级场景）。
 * - 归属降级：`scenario.feature` 缺失 / 指向未知 feature / 指向跨 module 的 feature —— 三态一律入
 *   `__ungrouped__`（不报错、不阻断）。因此显式带 `feature` 键即触发输出，绝不因"无注册 feature"丢失降级桶。
 * - 重复 feature id：取 YAML 首现，其余忽略。
 */
import type { ProjectYamlFeature, ProjectYamlScenario } from './project-yaml.js';

/** 固定保留伪 feature id（双下划线包裹，不匹配 `^F\d+` 合法 ID，防冲突），恒排末位。 */
export const UNGROUPED_FEATURE_ID = '__ungrouped__';
export const UNGROUPED_FEATURE_NAME = '未分组';

export interface FeatureScenarioMember {
  id: string;
  name: string;
}

export interface FeatureGroupItem {
  id: string;
  name: string;
  spec: string | null;
  scenarios: FeatureScenarioMember[];
}

function toMember(s: ProjectYamlScenario): FeatureScenarioMember {
  return { id: s.id, name: s.name ?? s.id };
}

interface GroupCore {
  items: FeatureGroupItem[];
  hasRegistered: boolean;
  hasFeatureKey: boolean;
}

/**
 * 共享分组核心（status/next 与 feature list 复用）：按注册 feature 分桶 + 末位 __ungrouped__ 降级桶。
 * - 注册 feature 按 YAML 声明顺序、重复 id 取首现；成员为空保留 `scenarios:[]`。
 * - `scenario.feature` 缺失 / 未知 / 跨 module（不在本 module 注册集）一律入 __ungrouped__。
 */
function groupCore(
  moduleId: string,
  moduleScenarios: readonly ProjectYamlScenario[],
  allFeatures: readonly ProjectYamlFeature[] | undefined,
): GroupCore {
  // feature ID **项目全局唯一**（delta-F3）：重复 id 取**全项目 YAML 首现**为权威归属。
  // 先建全局首现映射，再筛出权威归属属于本 module 的 feature（保 YAML 声明顺序）。
  // 例：features=[F01/admin, F01/core] → F01 权威属 admin；core 场景引用 F01 应跨 module 降级到未分组。
  const firstById = new Map<string, ProjectYamlFeature>();
  for (const f of allFeatures ?? []) {
    if (!firstById.has(f.id)) firstById.set(f.id, f);
  }
  const registered: ProjectYamlFeature[] = [];
  for (const f of allFeatures ?? []) {
    if (firstById.get(f.id) !== f) continue;      // 只在全局首现位置登记（去重）
    if (f.module !== moduleId) continue;           // 权威归属不在本 module → 跳过
    registered.push(f);
  }
  const registeredIds = new Set(registered.map((f) => f.id));

  const buckets = new Map<string, FeatureScenarioMember[]>();
  for (const f of registered) buckets.set(f.id, []);
  const ungrouped: FeatureScenarioMember[] = [];

  for (const s of moduleScenarios) {
    const fid = s.feature;
    if (typeof fid === 'string' && registeredIds.has(fid)) {
      buckets.get(fid)!.push(toMember(s));
    } else {
      ungrouped.push(toMember(s));
    }
  }

  const items: FeatureGroupItem[] = registered.map((f) => ({
    id: f.id,
    name: f.name,
    spec: f.spec ?? null,
    scenarios: buckets.get(f.id)!,
  }));
  if (ungrouped.length > 0) {
    items.push({ id: UNGROUPED_FEATURE_ID, name: UNGROUPED_FEATURE_NAME, spec: null, scenarios: ungrouped });
  }

  return {
    items,
    hasRegistered: registered.length > 0,
    hasFeatureKey: moduleScenarios.some((s) => typeof s.feature === 'string'),
  };
}

/**
 * 为单个 module 构建 feature 分组（**status/next 语义**）。
 * @returns feature 分组数组；`undefined` 表示应省略 `features` 字段（纯 pre-feature module：无注册 feature 且无场景带 feature 键）。
 */
export function buildModuleFeatures(
  moduleId: string,
  moduleScenarios: readonly ProjectYamlScenario[],
  allFeatures: readonly ProjectYamlFeature[] | undefined,
): FeatureGroupItem[] | undefined {
  const core = groupCore(moduleId, moduleScenarios, allFeatures);
  // 省略当且仅当：无注册 feature 且无场景带 feature 键
  if (!core.hasRegistered && !core.hasFeatureKey) return undefined;
  return core.items;
}

/**
 * 为单个 module 构建 feature 分组（**feature list 语义**，add-feature-model delta-F10）。
 * 专用分组视图，无零漂移约束、**始终返回数组**：
 * - 列出全部注册 feature（空成员 `scenarios:[]`）+ 末位 `__ungrouped__`（当有未归属/降级场景）。
 * - 有场景但无注册 feature → `[{__ungrouped__}]`；`[]` **仅**用于真正空 module（无注册 feature 且无场景成员）。
 */
export function buildModuleFeatureList(
  moduleId: string,
  moduleScenarios: readonly ProjectYamlScenario[],
  allFeatures: readonly ProjectYamlFeature[] | undefined,
): FeatureGroupItem[] {
  return groupCore(moduleId, moduleScenarios, allFeatures).items;
}

/**
 * status/next 文本模式的 feature 分组渲染（add-feature-model delta-F2，status/next 共用同一 formatter）。
 * @param features module 项的 `features`（可能为 `undefined`）
 * @param indent 每行前缀缩进（与调用方 module 子行对齐）
 * @returns 待逐行打印的字符串数组；`features` 缺失/为空 → **返回 `[]`（零字节，保纯 pre-feature 零漂移）**。
 */
export function formatFeaturesText(
  features: readonly FeatureGroupItem[] | undefined,
  indent = '       ',
): string[] {
  if (!features || features.length === 0) return [];
  const lines: string[] = [`${indent}🗂 features`];
  for (const f of features) {
    const spec = f.spec ? ` → ${f.spec}` : '';
    lines.push(`${indent}  ${f.id} ${f.name}${spec} (${f.scenarios.length})`);
    for (const s of f.scenarios) {
      lines.push(`${indent}    - ${s.id} ${s.name}`);
    }
  }
  return lines;
}
