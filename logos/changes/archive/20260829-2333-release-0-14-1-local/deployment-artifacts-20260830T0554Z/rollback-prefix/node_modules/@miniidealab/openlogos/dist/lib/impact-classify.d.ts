/**
 * S36 — 生命周期变更影响分类（ci-change-impact-contract）纯函数层。
 *
 * 路径语义契约 v1 的机器常量（`PATH_CLASSES_V1`）与分类器（`classifyImpact`）。
 * 权威文字声明见根 `spec/change-impact.md`；JSON data 契约登记于 `spec/cli-json-output.md` §3.16。
 * 三处同源维护：任何一处变更必须同轮同步其余两处。
 *
 * 判定红线（全部 fail-closed）：
 * - 只按路径前缀分类（路径段边界），完全不依赖 rename 配对结果 / 时间戳目录名 / marker 文件名；
 * - R/C 必须新旧路径双侧均为 lifecycle 才算 lifecycle，`files[].class` 取双侧中更不安全一侧；
 * - 未知状态字母、字节流解析失败、空 diff、空输入 → 判定完成且 `lifecycle_only: false`；
 * - 分类坐标 = 剥除项目前缀后的项目根相对路径；输出坐标 = 原始输入路径（不剥前缀）；
 * - 项目前缀外路径不静默丢弃：直接归 external 并照常计入 files[] 与 non_lifecycle_paths。
 */
export declare const IMPACT_SCHEMA_VERSION = "openlogos-change-impact.v1";
export type PathClass = 'lifecycle' | 'project' | 'external';
/**
 * 路径语义契约 v1（版本化冻结常量）：只声明「确定安全」的 lifecycle 集合，其余不背书。
 * v1 集合冻结；扩集合须升 v2 并保留 v1 过渡期（spec/change-impact.md §6）。
 */
export declare const PATH_CLASSES_V1: Readonly<{
    version: "v1";
    /** 精确文件匹配（非目录前缀） */
    guardFile: "logos/.openlogos-guard";
    /** 目录集合，按路径段边界匹配（含其下全部子路径） */
    lifecycleDirs: readonly string[];
    /** logos/** 下非 lifecycle 的一切 → project（项目自决，不背书） */
    projectDir: "logos";
}>;
export interface ImpactFile {
    status: string;
    path: string;
    old_path: string | null;
    class: PathClass;
}
export interface ImpactResult {
    lifecycle_only: boolean;
    files: ImpactFile[];
    non_lifecycle_paths: string[];
    operations: string[];
    changes: string[];
    reasons: string[];
}
/**
 * 修订参数词法校验（三层防线第一层）：值为空或以 `-` 开头（option-like）即拒绝，
 * 不把该值传给任何 git 进程（映射 IMPACT_INPUT_INVALID）。
 */
export declare function isRevArgLexicallyValid(value: string | undefined): boolean;
/**
 * Git top-level 相对路径语法校验：合法 git 树路径不会产生绝对路径、空段、`.` / `..` 段。
 * 在 `--stdin` 边界收到此类字节流即畸形输入（如 `logos/changes/../logos.config.json`
 * 可用点段先命中 lifecycle 前缀、归一化后却指向 project 文件），必须 fail-closed；
 * 禁止用会改写合法特殊文件名的文件系统归一化代替本校验。
 */
export declare function isValidGitTopLevelPath(path: string): boolean;
/** `--prefix` / `git rev-parse --show-prefix` 同段级不变量：空前缀合法；非空剥尾 `/` 后须为合法 top-level 相对路径。 */
export declare function isValidPrefixArg(prefix: string): boolean;
/** 前缀规范化：空前缀原样返回；非空保证以 `/` 结尾（git show-prefix 原生形态）。 */
export declare function normalizePrefix(prefix: string): string;
/**
 * 按路径段边界剥除项目前缀。返回剥除后的项目根相对路径；
 * 路径不在前缀下 → null（调用方归 external，不静默丢弃）。
 */
export declare function stripProjectPrefix(path: string, prefix: string): string | null;
/** 分类项目根相对路径（契约 v1 查表）。 */
export declare function classifyRootRelativePath(rel: string): PathClass;
/** 分类原始输入路径：剥前缀失败（前缀外）直接 external。 */
export declare function classifyInputPath(path: string, prefix: string): PathClass;
/**
 * 分类器主入口（纯函数，两输入模式共用的唯一判据）：
 * 输入 `git diff --no-relative --name-status -z` 字节流（utf-8 字符串形态）与项目前缀，
 * 输出 §3.16 data 契约的全部字段（snake_case）。不抛未捕获异常。
 */
export declare function classifyImpact(stream: string, prefix: string): ImpactResult;
//# sourceMappingURL=impact-classify.d.ts.map