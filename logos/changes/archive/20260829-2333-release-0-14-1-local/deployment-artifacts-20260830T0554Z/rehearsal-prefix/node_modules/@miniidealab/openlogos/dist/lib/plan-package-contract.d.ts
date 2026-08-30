export declare const PLAN_PACKAGE_SCHEMA: "openlogos/plan-package-evaluation@1";
export declare const PLAN_PACKAGE_CONTRACT_VERSION = "1";
export declare const PLAN_PACKAGE_CLI_CONTRACT_VERSION = "1.3.0";
export declare const PLAN_SECTION_REGISTRY: {
    readonly reason: {
        readonly zh: "变更原因";
        readonly en: "Reason";
    };
    readonly type: {
        readonly zh: "变更类型";
        readonly en: "Change Type";
    };
    readonly scope: {
        readonly zh: "变更范围";
        readonly en: "Scope";
    };
    readonly deployment: {
        readonly zh: "部署影响";
        readonly en: "Deployment Impact";
    };
    readonly summary: {
        readonly zh: "变更概述";
        readonly en: "Summary";
    };
    readonly clarification: {
        readonly zh: "决策澄清";
        readonly en: "Decision Clarification";
    };
};
export type PlanSectionId = keyof typeof PLAN_SECTION_REGISTRY;
export type PlanPackageIssueCode = 'proposal_required_section_missing' | 'proposal_required_section_duplicate' | 'proposal_required_section_empty' | 'proposal_placeholder_remaining' | 'proposal_change_type_invalid' | 'proposal_deployment_fields_invalid' | 'proposal_clarification_invalid' | 'tasks_template_remaining' | 'tasks_code_entry_before_spec_complete' | 'tasks_code_section_missing' | 'tasks_deployment_conflict';
export interface CompletionIssue {
    code: PlanPackageIssueCode;
    path: string;
    section_id?: PlanSectionId | 'code' | 'delta' | 'deploy';
    line?: number;
    actual?: string;
    expected?: string;
    message: string;
    fix_hint: string;
}
export interface PlanPackageEvaluation {
    schema: typeof PLAN_PACKAGE_SCHEMA;
    contract_version: string;
    ready: boolean;
    proposal: {
        filled: boolean;
        issues: CompletionIssue[];
    };
    tasks: {
        plan_filled: boolean;
        code_required: boolean;
        code_slices_filled: boolean;
        issues: CompletionIssue[];
    };
    issues: CompletionIssue[];
}
export declare function detectPlanLocale(content: string): 'zh' | 'en';
export declare function evaluateProposalStructure(content: string, path?: string, locale?: 'zh' | 'en'): CompletionIssue[];
export declare function sortCompletionIssues(issues: CompletionIssue[]): CompletionIssue[];
//# sourceMappingURL=plan-package-contract.d.ts.map