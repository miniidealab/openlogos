export declare const LOCAL_RELEASE_CANDIDATE_SCHEMA: "openlogos/local-release-candidate@1";
export declare const LOCAL_RELEASE_PACKAGE_NAME: "@miniidealab/openlogos";
export declare const LOCAL_RELEASE_CANDIDATE_VERSION: "0.14.1";
export declare const LOCAL_RELEASE_ROLLBACK_VERSION: "0.14.0";
export declare const LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS: readonly ["claude-plugin-template/.claude-plugin/plugin.json", "codex-plugin-template/plugin.json", "zcode-plugin-template/.zcode-plugin/plugin.json", "qoder-plugin-template/.qoder-plugin/plugin.json", "workbuddy-plugin-template/.workbuddy-plugin/plugin.json"];
export interface LocalReleaseCandidateIdentity {
    schema: typeof LOCAL_RELEASE_CANDIDATE_SCHEMA;
    package_name: typeof LOCAL_RELEASE_PACKAGE_NAME;
    package_version: typeof LOCAL_RELEASE_CANDIDATE_VERSION;
    plugin_versions: Record<(typeof LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS)[number], string>;
    asset_manifest_version: typeof LOCAL_RELEASE_CANDIDATE_VERSION;
    tarball_sha256: string;
    command_path: string;
    package_root: string;
}
export interface LocalReleaseCommand {
    command: string;
    args: readonly string[];
}
/** 冻结本地候选的最小公开身份；五类插件、asset 与 package 必须同源。 */
export declare function freezeLocalReleaseCandidateIdentity(input: LocalReleaseCandidateIdentity): LocalReleaseCandidateIdentity;
/** 本地候选调用图不得包含任何公开发布或远程写动作。 */
export declare function assertLocalReleaseCommandGraph(commands: readonly LocalReleaseCommand[]): void;
/** 生成只引用固定 0.14.0 tarball 的可复制回滚与版本复核命令。 */
export declare function buildLocalReleaseRollbackPlan(prefix: string, rollbackTarball: string, installedEntry: string): LocalReleaseCommand[];
//# sourceMappingURL=local-release-candidate.d.ts.map