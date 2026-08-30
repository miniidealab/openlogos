import { type OutputFormat } from '../lib/json-output.js';
interface ResolvedProposal {
    slug: string;
    proposalDir: string;
}
/**
 * 解析活跃提案目录：
 *   1. slug 显式给出 → logos/changes/<slug>
 *   2. 否则读 logos/.openlogos-guard 的 activeChange
 *   3. 否则若 logos/changes 下恰有一个非 archive 目录 → 用之
 * 无法唯一确定 → null
 */
export declare function resolveActiveProposal(root: string, slug: string | undefined): ResolvedProposal | null;
interface CheckOutcome {
    code: number;
    reason: string;
    data?: Record<string, unknown>;
    errorCode?: string;
}
/**
 * 纯判定（无副作用地对账），返回退出码与原因。
 * S35 前置重构④：本函数为**纯 evaluator（只读）**——`UI_PROTOTYPE_HASHES.json` 的写入归
 * 命令 wrapper（writeUiPrototypeHashes，仅 `check-ui-prototype` 命令路径），change-lint L7 只调本函数。
 */
export declare function evaluateUiPrototype(proposalDir: string): CheckOutcome;
/**
 * 产物写入 wrapper（S35 前置重构④）：仅当真正完成逐页对账且 outcome 明确携带 hashes 时写清单
 * （code-r1 F9：`ui_impact !== true` 分支无 data → 不写文件，保持改造前既有行为——不产生空哈希文件）。
 * 仅 check-ui-prototype 命令路径调用。
 */
export declare function writeUiPrototypeHashes(proposalDir: string, outcome: CheckOutcome): void;
export declare function checkUiPrototype(slug: string | undefined, format?: OutputFormat): void;
export {};
//# sourceMappingURL=check-ui-prototype.d.ts.map