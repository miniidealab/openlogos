export type AiToolId = 'claude-code' | 'opencode' | 'codex' | 'cursor' | 'zcode' | 'qoder' | 'workbuddy' | 'other';
export type AiTool = AiToolId | 'all';
export interface AiToolCapabilities {
    lifecycle: Array<'init' | 'sync' | 'launch' | 'adopt'>;
    assets: Array<'agents' | 'plugin' | 'hooks'>;
    instructions?: boolean;
    skills?: boolean;
    commands?: boolean;
    agents?: boolean;
    plugin?: boolean;
    sessionStart?: boolean;
    preToolUse?: boolean;
}
export interface AiToolAdapterDefinition {
    id: AiToolId;
    capabilities: AiToolCapabilities;
}
export declare class AiToolAdapterRegistry {
    private readonly definitions;
    constructor(definitions?: AiToolAdapterDefinition[]);
    get(id: string): AiToolAdapterDefinition;
    has(id: unknown): id is AiToolId;
    list(options?: {
        deployableOnly?: boolean;
    }): AiToolAdapterDefinition[];
}
export declare const aiToolAdapterRegistry: AiToolAdapterRegistry;
export declare function parseRegisteredAiTool(value: unknown): AiTool | undefined;
export declare function expandRegisteredAiTools(rawAiTool: unknown): AiToolId[];
/**
 * 严格解析持久化配置中的 AI 工具列表。
 *
 * 交互式入口会先通过 parseRegisteredAiTool 校验用户输入；同步入口读取的却是
 * 可被人工修改的配置文件，因此不能把未知值静默降级为 cursor。必须在任何同步
 * 写入发生前失败，避免看似成功但实际遗漏目标宿主。
 */
export declare function resolveConfiguredAiTools(rawAiTool: unknown): AiToolId[];
export declare const ZCODE_PLUGIN_REL_DIR = ".zcode/plugins/openlogos";
export declare const QODER_PLUGIN_REL_DIR = ".qoder/plugins/openlogos";
export declare const WORKBUDDY_PLUGIN_REL_DIR = ".workbuddy/plugins/openlogos";
export interface ZCodeDeploymentResult {
    target: string;
    status: 'installed' | 'updated' | 'unchanged';
    preserved: string[];
}
export interface QoderDeploymentResult {
    target: string;
    status: 'installed' | 'updated' | 'unchanged';
    preserved: string[];
}
export interface WorkBuddyDeploymentResult {
    target: string;
    status: 'installed' | 'updated' | 'unchanged';
    preserved: string[];
}
export declare function validateZCodeTemplate(source: string): void;
export declare function preflightZCodeTarget(root: string, source: string): void;
export declare class ManagedAssetTransaction {
    private readonly source;
    private readonly target;
    private staging;
    private backup;
    constructor(source: string, target: string);
    commit(): 'installed' | 'updated' | 'unchanged';
}
export declare function deployZCodeAssets(root: string, source: string, sharedAssets?: {
    skills?: string | null;
    commands?: string | null;
    agents?: string | null;
}): ZCodeDeploymentResult;
export declare function localizedZCodeResult(locale: 'zh' | 'en', result: ZCodeDeploymentResult, newSession?: boolean): string;
export declare function createZCodeAgentsInstruction(locale: 'zh' | 'en', lifecycle: string): string;
export declare function validateQoderTemplate(source: string): void;
export declare function preflightQoderTarget(root: string, source: string): void;
export declare function deployQoderAssets(root: string, source: string, sharedAssets?: {
    skills?: string | null;
    commands?: string | null;
    agents?: string | null;
}): QoderDeploymentResult;
export declare function localizedQoderResult(locale: 'zh' | 'en', result: QoderDeploymentResult): string;
export declare function createQoderAgentsInstruction(locale: 'zh' | 'en', lifecycle: string): string;
export declare function validateWorkBuddyTemplate(source: string): void;
export declare function preflightWorkBuddyTarget(root: string, source: string): void;
export declare function deployWorkBuddyAssets(root: string, source: string, sharedAssets?: {
    skills?: string | null;
    commands?: string | null;
    agents?: string | null;
}): WorkBuddyDeploymentResult;
export declare function localizedWorkBuddyResult(locale: 'zh' | 'en', result: WorkBuddyDeploymentResult): string;
export declare function createWorkBuddyAgentsInstruction(locale: 'zh' | 'en', lifecycle: string): string;
//# sourceMappingURL=ai-tool-adapter.d.ts.map