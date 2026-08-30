import type { OutputFormat } from '../lib/json-output.js';
export interface ActiveProposalGuard {
    slug: string;
    proposalDir: string;
    moduleId: string | null;
}
export interface DeployDoneData {
    slug: string;
    environment: string | null;
    marker_path: string;
    deployment_report_path: string;
    deploy_tasks_checked: number;
    deploy_tasks_total: number;
    cleared_smoke_markers: string[];
    next_step: 'ready-to-smoke' | 'deploy-done';
}
interface SectionCheckResult {
    content: string;
    checked: number;
    total: number;
}
export declare function readActiveProposalGuard(root: string): ActiveProposalGuard | null;
export declare function checkTaskSection(content: string, tag: string): SectionCheckResult;
export declare function deployDone(format?: OutputFormat, environment?: string): Promise<void>;
export {};
//# sourceMappingURL=deploy-done.d.ts.map