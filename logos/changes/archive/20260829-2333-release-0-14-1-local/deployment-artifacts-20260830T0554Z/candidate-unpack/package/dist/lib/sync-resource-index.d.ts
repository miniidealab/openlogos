import type { Locale } from '../i18n.js';
/** 扫描项目中所有应纳入 resource_index 的文件，返回相对于项目根目录的路径列表 */
export declare function scanCandidateFiles(root: string): string[];
/** 根据文件路径推断 desc；无匹配规则返回 null */
export declare function inferResourceDesc(relPath: string, locale: Locale): string | null;
export interface SyncResourceIndexResult {
    added: number;
    skipped: number;
}
/** 扫描项目文档，将尚未收录的文件补录到 logos-project.yaml 的 resource_index */
export declare function syncResourceIndex(root: string, locale: Locale): SyncResourceIndexResult;
//# sourceMappingURL=sync-resource-index.d.ts.map