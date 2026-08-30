import type { OutputFormat } from '../lib/json-output.js';
import { type MergeTransactionProjection } from '../lib/merge-transaction.js';
export declare function mergeTransactionCommand(subcommand: string | undefined, args: string[], format: OutputFormat): void;
export declare function beginMergeTransaction(root: string, proposalDir: string, slug: string): MergeTransactionProjection;
//# sourceMappingURL=merge-transaction.d.ts.map