/**
 * S35 code-r1 F4/F5/F11（r2/r3 强化）：共享 Markdown **权威结构**扫描器。
 * 权威结构（段标记、表格 ID 列、module 头、复用声明、UI 声明标题）只认下列区域之外的行：
 * - 代码围栏（```/~~~ 同字符配对、不短于开栏、关闭行无 info string；开/闭栏最多 3 空格缩进——
 *   4 空格及以上属缩进代码，不构成围栏定界）；
 * - 缩进代码块（≥4 空格或制表符起始的行）；
 * - HTML 注释（<!-- ... -->，跨行整行掩蔽、行内片段从文本中剥除）。注释起止符的识别在
 *   **剥除行内 code span 之后**进行（r3 F4：`` `<!--` `` 是普通行内代码，不得开启注释状态）。
 * 行内代码按 CommonMark 等长 backtick delimiter 成对解析。
 */
export type AuthorityRegion = 'fence-open' | 'fence' | 'fence-close' | 'comment' | 'indented' | null;
export interface AuthorityScan {
    /** true = 该行处于代码围栏/缩进代码/HTML 注释内（含定界行本身），不构成权威结构。 */
    masked: boolean[];
    /** 供权威解析使用的行文本：未掩蔽行剥除行内 HTML 注释片段后的内容；掩蔽行为原文。 */
    text: string[];
    /** 掩蔽区域类型（r3 F11：调用方可区分「权威围栏定界」与注释/缩进代码，禁止采信后两者中的 fence）。 */
    region: AuthorityRegion[];
}
export type AuthoritySectionStatus = 'missing' | 'duplicate' | 'unique';
export interface AuthoritySectionResult {
    status: AuthoritySectionStatus;
    /** 仅 unique 时存在；内容已排除围栏、缩进代码与 HTML 注释区域。 */
    content: string | null;
}
/** 场景 CREATE 完整性校验使用的权威 ATX 标题节点。 */
export interface AuthorityHeadingNode {
    level: number;
    text: string;
    line: number;
}
/** 围栏本身不是普通权威正文，但合法 mermaid 围栏可作为时序证据。 */
export interface AuthorityFenceNode {
    info: string;
    content: string;
    startLine: number;
    endLine: number;
    closed: boolean;
}
export interface MarkdownAuthorityStructure {
    lines: string[];
    scan: AuthorityScan;
    headings: AuthorityHeadingNode[];
    fences: AuthorityFenceNode[];
    malformed: string[];
}
/** 权威结构掩码：围栏（≤3 空格缩进定界）、缩进代码（≥4 空格/制表符）、HTML 注释。 */
export declare function authorityScan(lines: string[]): AuthorityScan;
/**
 * 扫描场景 CREATE 所需的权威 Markdown 结构。
 *
 * 普通标题只收集围栏/注释/缩进代码之外的 ATX 标题；围栏则单独保留 info string 与正文，
 * 让调用方只能从完整且明确标记为 mermaid 的围栏采信时序证据。
 */
export declare function scanMarkdownAuthorityStructure(content: string): MarkdownAuthorityStructure;
/**
 * 提取恰好一个权威二级 Markdown section。
 *
 * 标题与 section 边界只认 authorityScan 判定为权威的行；返回内容同样把所有非权威行
 * 置空，因此 fenced 示例、缩进代码和 HTML 注释中的同名标题/字段都不能参与业务解析。
 * ATX 同义写法先规范化；ATX/Setext H2 统一参与同名唯一性计数，多个围栏外同名标题
 * 显式返回 duplicate，禁止 first-wins。
 * section 遇到任一权威 H1/H2（ATX 或 Setext）即结束，防止兄弟/父级章节字段串入。
 */
export declare function extractUniqueAuthoritySection(content: string, heading: string): AuthoritySectionResult;
/** 兼容旧签名：仅返回掩码（含围栏/缩进代码/HTML 注释）。 */
export declare function fenceMask(lines: string[]): boolean[];
/**
 * 剥掉一行内的行内代码 span——按 CommonMark 等长 backtick delimiter 成对解析
 * （code-r2 F4：`` ``[占位]`` `` 等任意长度定界符的引用均不得命中权威结构）。
 * 未闭合的 backtick 串保留原文。
 */
export declare function stripInlineCode(line: string): string;
/**
 * 取表格行的单元格清单（r3 F19：GFM 语义——`\|` 转义管道与 code span 内管道不是单元格分隔符；
 * 兼容无首尾 pipe 的合法 Markdown 表格）。
 */
export declare function tableRowCells(line: string): string[];
/** Markdown 表格 delimiter 行（`|---|:---:|` 形态；兼容无首尾 pipe）。 */
export declare function isTableDelimiterRow(line: string): boolean;
//# sourceMappingURL=markdown-scan.d.ts.map