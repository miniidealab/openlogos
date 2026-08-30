/** 固定保留伪 feature id（双下划线包裹，不匹配 `^F\d+` 合法 ID，防冲突），恒排末位。 */
export const UNGROUPED_FEATURE_ID = '__ungrouped__';
export const UNGROUPED_FEATURE_NAME = '未分组';
function toMember(s) {
    return { id: s.id, name: s.name ?? s.id };
}
/**
 * 共享分组核心（status/next 与 feature list 复用）：按注册 feature 分桶 + 末位 __ungrouped__ 降级桶。
 * - 注册 feature 按 YAML 声明顺序、重复 id 取首现；成员为空保留 `scenarios:[]`。
 * - `scenario.feature` 缺失 / 未知 / 跨 module（不在本 module 注册集）一律入 __ungrouped__。
 */
function groupCore(moduleId, moduleScenarios, allFeatures) {
    // feature ID **项目全局唯一**（delta-F3）：重复 id 取**全项目 YAML 首现**为权威归属。
    // 先建全局首现映射，再筛出权威归属属于本 module 的 feature（保 YAML 声明顺序）。
    // 例：features=[F01/admin, F01/core] → F01 权威属 admin；core 场景引用 F01 应跨 module 降级到未分组。
    const firstById = new Map();
    for (const f of allFeatures ?? []) {
        if (!firstById.has(f.id))
            firstById.set(f.id, f);
    }
    const registered = [];
    for (const f of allFeatures ?? []) {
        if (firstById.get(f.id) !== f)
            continue; // 只在全局首现位置登记（去重）
        if (f.module !== moduleId)
            continue; // 权威归属不在本 module → 跳过
        registered.push(f);
    }
    const registeredIds = new Set(registered.map((f) => f.id));
    const buckets = new Map();
    for (const f of registered)
        buckets.set(f.id, []);
    const ungrouped = [];
    for (const s of moduleScenarios) {
        const fid = s.feature;
        if (typeof fid === 'string' && registeredIds.has(fid)) {
            buckets.get(fid).push(toMember(s));
        }
        else {
            ungrouped.push(toMember(s));
        }
    }
    const items = registered.map((f) => ({
        id: f.id,
        name: f.name,
        spec: f.spec ?? null,
        scenarios: buckets.get(f.id),
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
export function buildModuleFeatures(moduleId, moduleScenarios, allFeatures) {
    const core = groupCore(moduleId, moduleScenarios, allFeatures);
    // 省略当且仅当：无注册 feature 且无场景带 feature 键
    if (!core.hasRegistered && !core.hasFeatureKey)
        return undefined;
    return core.items;
}
/**
 * 为单个 module 构建 feature 分组（**feature list 语义**，add-feature-model delta-F10）。
 * 专用分组视图，无零漂移约束、**始终返回数组**：
 * - 列出全部注册 feature（空成员 `scenarios:[]`）+ 末位 `__ungrouped__`（当有未归属/降级场景）。
 * - 有场景但无注册 feature → `[{__ungrouped__}]`；`[]` **仅**用于真正空 module（无注册 feature 且无场景成员）。
 */
export function buildModuleFeatureList(moduleId, moduleScenarios, allFeatures) {
    return groupCore(moduleId, moduleScenarios, allFeatures).items;
}
/**
 * status/next 文本模式的 feature 分组渲染（add-feature-model delta-F2，status/next 共用同一 formatter）。
 * @param features module 项的 `features`（可能为 `undefined`）
 * @param indent 每行前缀缩进（与调用方 module 子行对齐）
 * @returns 待逐行打印的字符串数组；`features` 缺失/为空 → **返回 `[]`（零字节，保纯 pre-feature 零漂移）**。
 */
export function formatFeaturesText(features, indent = '       ') {
    if (!features || features.length === 0)
        return [];
    const lines = [`${indent}🗂 features`];
    for (const f of features) {
        const spec = f.spec ? ` → ${f.spec}` : '';
        lines.push(`${indent}  ${f.id} ${f.name}${spec} (${f.scenarios.length})`);
        for (const s of f.scenarios) {
            lines.push(`${indent}    - ${s.id} ${s.name}`);
        }
    }
    return lines;
}
//# sourceMappingURL=feature-grouping.js.map