import type { OutputFormat } from '../lib/json-output.js';
/** begin：提交逻辑产物计划（无内容 hash），CLI 校验后签发 run_id + 建 staging + 持久化 run 记录。 */
export declare function baselineSeedBegin(moduleId: string | undefined, manifestPath: string | undefined, format: OutputFormat): void;
/** commit：对 staged 字节校验；全部合法 → seeded 事务提交；≥1 未全 → partial（不提交）；0 → 保持。 */
export declare function baselineSeedCommit(moduleId: string | undefined, runId: string | undefined, format: OutputFormat): void;
/** status：只读当前 run、staging 进度与状态，供恢复/重试决策。 */
export declare function baselineSeedStatus(moduleId: string | undefined, format: OutputFormat): void;
//# sourceMappingURL=baseline-seed.d.ts.map