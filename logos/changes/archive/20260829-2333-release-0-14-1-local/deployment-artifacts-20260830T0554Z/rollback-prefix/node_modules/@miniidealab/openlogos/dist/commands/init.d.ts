import { type Locale } from '../i18n.js';
import { type AiTool, type AiToolId } from '../lib/ai-tool-adapter.js';
export type { AiTool } from '../lib/ai-tool-adapter.js';
export declare function parseAiTool(value: unknown): AiTool | undefined;
export declare function expandAiTools(rawAiTool: unknown): AiToolId[];
export declare function resolveDocsAiTool(rawAiTool: unknown): AiTool;
export declare function resolveDocsAiToolForTarget(rawAiTool: unknown, target: 'agents' | 'claude'): AiTool;
export declare function mergeAiToolConfig(existingRawAiTool: unknown, requestedAiTool: AiTool): AiTool | AiToolId[];
type NameSource = 'argument' | 'package.json' | 'Cargo.toml' | 'pyproject.toml' | 'directory';
interface NameResult {
    name: string;
    source: NameSource;
}
export declare function readConfigName(root: string): NameResult | null;
export declare function detectProjectName(root: string): NameResult;
export declare function chooseAiTool(locale: Locale): Promise<AiTool>;
export declare const SKILL_NAMES: readonly ["project-init", "prd-writer", "product-designer", "ui-ux-pro-max", "architecture-designer", "scenario-architect", "api-designer", "db-designer", "deployment-designer", "test-writer", "test-orchestrator", "code-implementor", "code-reviewer", "change-writer", "slice-planner", "deployment-executor", "merge-executor"];
export declare function findSkillsSource(): string | null;
export declare function findSpecSource(): string | null;
export declare function findOpenCodePluginTemplateSource(): string | null;
export declare function findCodexPluginTemplateSource(): string | null;
export declare function findZCodePluginTemplateSource(): string | null;
export declare function findQoderPluginTemplateSource(): string | null;
export declare function findWorkBuddyPluginTemplateSource(): string | null;
export declare function preflightAiToolAssets(root: string, aiTools: AiToolId[]): void;
export declare function preflightInstructionFiles(root: string, locale: Locale, rawAiTool: unknown, isLaunched: boolean): void;
export declare function deployCodexPlugin(root: string, locale?: Locale): {
    target: string;
    config: {
        created: boolean;
        updated: boolean;
    };
    marketplace: {
        created: boolean;
        updated: boolean;
    };
    personal: {
        skipped: boolean;
        plugin: {
            created: boolean;
            updated: boolean;
            path?: string;
        };
        marketplace: {
            created: boolean;
            updated: boolean;
            path?: string;
        };
        install: {
            status: 'installed' | 'skipped' | 'failed';
            error?: string;
        };
    };
    compatibilityPlugin: {
        created: boolean;
        updated: boolean;
        skipped: boolean;
    };
    boundary: {
        legacySkillCount: number;
        projectPluginCount: number;
        hasLegacyPlugin: boolean;
        legacyOpenLogosPluginRemoved: boolean;
    };
} | null;
export declare function findClaudePluginTemplateSource(): string | null;
export declare function deployClaudeCodePlugin(root: string, locale?: Locale): {
    commandCount: number;
    agentCount: number;
    hooksUpdated: boolean;
    skipped: boolean;
} | null;
export declare function deployOpenCodePlugin(root: string, locale?: Locale): {
    target: string;
    config: {
        created: boolean;
        updated: boolean;
    };
    commandCount: number;
} | null;
export declare function deploySpecs(root: string): {
    count: number;
} | null;
type DeployLogMode = 'deployed' | 'synced';
export declare function deployAiToolAssets(root: string, aiTools: AiToolId[], locale: Locale, isLaunched: boolean, mode?: DeployLogMode): void;
export declare function createManagedInstructionBlock(generatedContent: string): string;
export declare function mergeInstructionFileContent(existingContent: string | null, generatedContent: string): string;
export declare function writeManagedInstructionFile(root: string, fileName: 'AGENTS.md' | 'CLAUDE.md', generatedContent: string): string;
export declare function writeInstructionFiles(root: string, locale: Locale, rawAiTool: unknown, isLaunched: boolean): void;
export declare function generatePolicyMdc(locale: Locale, isLaunched?: boolean): string;
export declare function createCodexSkillContent(skillName: string, content: string): string;
export declare function ensureVerifyPreRunConfig(root: string, config: Record<string, unknown>): {
    status: 'exists' | 'added' | 'todo';
    command?: string;
    mutated: boolean;
};
export declare function printVerifyPreRunBackfillResult(locale: Locale, result: {
    status: 'exists' | 'added' | 'todo';
    command?: string;
}, prefix?: string): void;
export declare function deploySkills(root: string, aiTool: AiTool, locale?: Locale, isLaunched?: boolean, skillsSource?: string): {
    target: string;
    count: number;
} | null;
export declare const REFERENCE_SUBDIRECTORIES: string[];
export declare const DIRECTORIES: string[];
/** @deprecated use isLaunched: boolean instead */
export type Lifecycle = 'initial' | 'active';
export declare function createLogosConfig(name: string, locale: Locale, aiTool?: AiTool): string;
export declare function createLogosProject(name: string, locale: Locale): string;
export declare function createAdoptLogosProject(name: string, locale: Locale): string;
export declare function createAgentsMd(locale: Locale, aiTool?: AiTool, target?: 'agents' | 'claude', isLaunched?: boolean): string;
export declare function init(name?: string, options?: {
    locale?: string;
    aiTool?: string;
}): Promise<void>;
//# sourceMappingURL=init.d.ts.map