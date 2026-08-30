export type Locale = 'en' | 'zh';
export declare function readLocale(root: string): Locale;
export declare function t(locale: Locale, key: string, vars?: Record<string, string>): string;
export declare const PHASE_KEYS: readonly ["phase.1", "phase.2", "phase.3-0", "phase.3-1", "phase.3-2-api", "phase.3-2-db", "phase.3-3-deployment", "phase.3-4a", "phase.3-4b", "phase.3-5", "phase.3-6", "phase.3-7-deploy", "phase.3-8-smoke"];
export declare const SUGGEST_KEYS: Record<string, string>;
export declare function proposalTemplate(locale: Locale, slug: string, module?: string): string;
export declare function tasksTemplate(locale: Locale, launched?: boolean): string;
export declare function mergePromptTemplate(locale: Locale, slug: string, proposalContent: string, deltas: Array<{
    relativePath: string;
    deltaFullPath: string;
    targetDir: string;
}>): string;
export declare function conventionsForYaml(locale: Locale): string;
export declare function conventionsForAgentsMd(locale: Locale): string;
//# sourceMappingURL=i18n.d.ts.map