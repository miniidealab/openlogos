export declare const TEST_CHANGE_SET_SCHEMA: "openlogos/test-change-set@1";
export declare const TEST_CHANGE_SET_SOURCE: "semantic-before-after-diff";
export interface TestChangeSetTarget {
    target_path: string;
    before_sha256: string | null;
    after_sha256: string;
}
export interface TestChangeSetV1 {
    schema: typeof TEST_CHANGE_SET_SCHEMA;
    change: string;
    module: string;
    source: typeof TEST_CHANGE_SET_SOURCE;
    changed_test_ids: string[];
    removed_test_ids: string[];
    targets: TestChangeSetTarget[];
    sha256: `sha256:${string}`;
}
export interface TestChangeSetInputTarget {
    targetPath: string;
    beforeBytes: Buffer | null;
    afterBytes: Buffer;
}
export interface TestDefinitionRecord {
    target_path: string;
    column_identity: string[];
    cell_semantics: string[];
}
export type TestChangeSetReadResult = {
    valid: true;
    value: TestChangeSetV1;
} | {
    valid: false;
    code: string;
    message: string;
    path: string;
};
export declare function scanTestDefinitions(targetPath: string, bytes: Buffer): Map<string, TestDefinitionRecord>;
export declare function buildTestChangeSet(input: {
    change: string;
    module: string;
    targets: TestChangeSetInputTarget[];
}): TestChangeSetV1;
export declare function validateTestChangeSet(root: string, raw: unknown, expected: {
    change: string;
    module: string;
    targetPaths?: string[];
}): TestChangeSetReadResult;
export declare function readTestChangeSet(root: string, proposalDir: string, expected: {
    change: string;
    module: string;
    targetPaths?: string[];
}): TestChangeSetReadResult;
//# sourceMappingURL=test-change-set.d.ts.map