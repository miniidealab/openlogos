export declare const CLARIFICATION_SCHEMA = "openlogos/clarification@1";
export declare const CLARIFICATION_CATEGORIES: readonly ["product", "ownership", "data", "compatibility", "security_privacy", "deployment", "release", "external_commitment", "acceptance"];
export type ClarificationCategory = typeof CLARIFICATION_CATEGORIES[number];
export type ClarificationMode = 'adaptive' | 'deep' | 'provided';
export type ClarificationReason = 'high-impact-user-decision-required' | 'data-clarification-required' | 'compatibility-clarification-required' | 'security-privacy-clarification-required' | 'deployment-clarification-required' | 'release-clarification-required' | 'external-commitment-clarification-required' | 'clarification-contract-invalid' | 'clarification-upgrade-required' | 'legacy-clarification-backfill-required';
export interface ClarificationOption {
    id: string;
    label: string;
    tradeoff: string;
}
export interface ClarificationNextDecision {
    id: string;
    category: ClarificationCategory;
    question: string;
    impact: string;
    recommendation: string;
    recommendation_reason: string;
    options: ClarificationOption[];
}
export interface ClarificationOutput {
    schema: string | null;
    mode: ClarificationMode | null;
    status: 'pending' | 'complete' | 'invalid';
    required: boolean;
    required_categories: ClarificationCategory[];
    unresolved_decisions: number;
    next_decision_id: string | null;
    reason: ClarificationReason | null;
    next_decision: ClarificationNextDecision | null;
}
export interface ClarificationEvaluation {
    present: boolean;
    valid: boolean;
    issues: string[];
    output: ClarificationOutput;
}
export declare function validateClarificationOutput(value: ClarificationOutput): boolean;
export declare function evaluateProposalClarification(content: string, deploymentRequired: boolean | null): ClarificationEvaluation;
//# sourceMappingURL=clarification.d.ts.map