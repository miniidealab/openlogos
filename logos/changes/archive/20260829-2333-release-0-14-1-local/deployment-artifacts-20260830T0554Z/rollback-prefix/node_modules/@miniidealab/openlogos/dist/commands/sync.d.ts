export declare function syncLogosProjectName(root: string, projectName: string): boolean;
/**
 * For each scenario in logos-project.yaml that lacks a `module` field,
 * infer the owning module by scanning logos/resources/ for files matching
 * `<moduleId>-<scenarioId>-*.md`. Falls back to 'core' when ambiguous.
 * Idempotent: entries that already have a `module` field are left unchanged.
 * Returns the number of entries that were updated.
 */
export declare function syncScenariosModuleField(root: string): number;
export declare function sync(): void;
//# sourceMappingURL=sync.d.ts.map