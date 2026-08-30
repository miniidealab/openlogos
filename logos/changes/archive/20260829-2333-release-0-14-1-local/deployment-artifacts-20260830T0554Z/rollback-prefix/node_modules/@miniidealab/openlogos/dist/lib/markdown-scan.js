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
/** 剥掉一行内已闭合的 HTML 注释片段（<!-- ... -->）。 */
function stripInlineHtmlComments(line) {
    return line.replace(/<!--[\s\S]*?-->/g, '');
}
/** code-span 感知的行内注释剥除：只剥 span 外的已闭合注释，span 内的 `<!--`/`-->` 原样保留。 */
function stripCommentsOutsideCode(line) {
    let out = '';
    let i = 0;
    while (i < line.length) {
        if (line[i] === '`') {
            let n = 0;
            while (line[i + n] === '`')
                n++;
            let j = i + n;
            let closeEnd = -1;
            while (j < line.length) {
                if (line[j] === '`') {
                    let m = 0;
                    while (line[j + m] === '`')
                        m++;
                    if (m === n) {
                        closeEnd = j + m;
                        break;
                    }
                    j += m;
                }
                else {
                    j++;
                }
            }
            if (closeEnd !== -1) {
                out += line.slice(i, closeEnd);
                i = closeEnd;
                continue;
            }
            out += line.slice(i, i + n);
            i += n;
            continue;
        }
        if (line.startsWith('<!--', i)) {
            const close = line.indexOf('-->', i + 4);
            if (close !== -1) {
                i = close + 3;
                continue;
            } // 剥掉已闭合注释
            out += line.slice(i); // 未闭合（调用方已在 codeView 上判定过）——保留原文
            break;
        }
        out += line[i];
        i++;
    }
    return out;
}
/** 权威结构掩码：围栏（≤3 空格缩进定界）、缩进代码（≥4 空格/制表符）、HTML 注释。 */
export function authorityScan(lines) {
    let fenceChar = null;
    let fenceLen = 0;
    let inComment = false;
    const masked = [];
    const text = [];
    const region = [];
    for (const line of lines) {
        // HTML 注释延续：注释可包住围栏/表格等一切内容
        if (inComment) {
            masked.push(true);
            text.push(line);
            region.push('comment');
            if (line.includes('-->'))
                inComment = false;
            continue;
        }
        if (fenceChar) {
            const m = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
            const closes = Boolean(m && m[1][0] === fenceChar && m[1].length >= fenceLen);
            masked.push(true);
            text.push(line);
            region.push(closes ? 'fence-close' : 'fence');
            if (closes)
                fenceChar = null;
            continue;
        }
        // r3 F4：注释起始符的识别基于「剥除行内 code span 后」的词法视图——
        // `` `<!--` `` 是普通行内代码，不得把扫描器切入跨行注释状态。
        const codeView = stripInlineCode(line);
        const codeViewNoComments = stripInlineHtmlComments(codeView);
        if (codeViewNoComments.includes('<!--')) {
            inComment = true;
            masked.push(true);
            text.push(line);
            region.push('comment');
            continue;
        }
        // 行内已闭合注释：从权威文本中剥除（仅 code span **外**识别到的注释会被剥，span 内原样保留）
        const stripped = stripCommentsOutsideCode(line);
        // 围栏开启：最多 3 空格缩进（4 空格及以上是缩进代码，不是围栏定界）
        const open = stripped.match(/^ {0,3}(`{3,}|~{3,})/);
        if (open) {
            fenceChar = open[1][0];
            fenceLen = open[1].length;
            masked.push(true);
            text.push(line);
            region.push('fence-open');
            continue;
        }
        // 缩进代码块：≥4 空格或制表符起始且非空
        if (/^(?: {4,}|\t)\S/.test(stripped)) {
            masked.push(true);
            text.push(line);
            region.push('indented');
            continue;
        }
        masked.push(false);
        text.push(stripped);
        region.push(null);
    }
    return { masked, text, region };
}
/**
 * 解析 CommonMark ATX 标题的结构部分：允许 0–3 个前导空格、标题标记后的多个空格，
 * 并剥离前有空白的可选关闭 `#` 序列。返回的 text 可用于同义标题唯一性判断。
 */
function parseAuthorityAtxHeading(line) {
    const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
    if (!match)
        return null;
    const text = (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
    return { level: match[1].length, text };
}
/** Setext 下划线对应的标题层级。 */
function setextHeadingLevel(line) {
    const match = line.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (!match)
        return null;
    return match[1][0] === '=' ? 1 : 2;
}
/** 从标题文本行识别权威 Setext H1/H2，并把下划线纳入同一个标题跨度。 */
function parseAuthoritySetextHeading(scan, index) {
    if (scan.masked[index] || index + 1 >= scan.text.length || scan.masked[index + 1])
        return null;
    const text = scan.text[index].trim();
    const level = setextHeadingLevel(scan.text[index + 1]);
    if (!text || level === null)
        return null;
    // 列表项后的 `---` 是 thematic break/list 延续，不把它误认成 Setext 标题。
    if (/^(?:[-+*]|\d+[.)])\s+/.test(scan.text[index].trimStart()))
        return null;
    if (parseAuthorityAtxHeading(scan.text[index]) !== null)
        return null;
    return { level, text, endIndex: index + 1 };
}
/** ATX 与 Setext 共用的权威标题入口，供唯一性计数、section 起点和边界判断复用。 */
function parseAuthorityHeading(scan, index) {
    if (scan.masked[index])
        return null;
    const atx = parseAuthorityAtxHeading(scan.text[index]);
    if (atx)
        return { ...atx, endIndex: index };
    return parseAuthoritySetextHeading(scan, index);
}
/**
 * 扫描场景 CREATE 所需的权威 Markdown 结构。
 *
 * 普通标题只收集围栏/注释/缩进代码之外的 ATX 标题；围栏则单独保留 info string 与正文，
 * 让调用方只能从完整且明确标记为 mermaid 的围栏采信时序证据。
 */
export function scanMarkdownAuthorityStructure(content) {
    const lines = content.split(/\r?\n/);
    const scan = authorityScan(lines);
    const headings = [];
    const fences = [];
    const malformed = [];
    for (let i = 0; i < lines.length; i++) {
        if (!scan.masked[i]) {
            const heading = parseAuthorityAtxHeading(scan.text[i]);
            if (heading)
                headings.push({ ...heading, line: i });
            continue;
        }
        if (scan.region[i] !== 'fence-open')
            continue;
        const open = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (!open)
            continue;
        let end = i + 1;
        while (end < lines.length && scan.region[end] !== 'fence-close')
            end++;
        const closed = end < lines.length;
        fences.push({
            info: open[2].trim(),
            content: lines.slice(i + 1, closed ? end : lines.length).join('\n'),
            startLine: i,
            endLine: closed ? end : lines.length - 1,
            closed,
        });
        if (!closed)
            malformed.push('未闭合 fenced code block');
        i = closed ? end : lines.length;
    }
    const last = lines.length - 1;
    if (last >= 0 && scan.region[last] === 'comment' && !lines[last].includes('-->')) {
        malformed.push('未闭合 HTML 注释');
    }
    return { lines, scan, headings, fences, malformed };
}
/**
 * 提取恰好一个权威二级 Markdown section。
 *
 * 标题与 section 边界只认 authorityScan 判定为权威的行；返回内容同样把所有非权威行
 * 置空，因此 fenced 示例、缩进代码和 HTML 注释中的同名标题/字段都不能参与业务解析。
 * ATX 同义写法先规范化；ATX/Setext H2 统一参与同名唯一性计数，多个围栏外同名标题
 * 显式返回 duplicate，禁止 first-wins。
 * section 遇到任一权威 H1/H2（ATX 或 Setext）即结束，防止兄弟/父级章节字段串入。
 */
export function extractUniqueAuthoritySection(content, heading) {
    const lines = content.split(/\r?\n/);
    const scan = authorityScan(lines);
    const starts = [];
    for (let i = 0; i < lines.length; i++) {
        const candidate = parseAuthorityHeading(scan, i);
        if (candidate?.level === 2 && candidate.text === heading)
            starts.push(candidate);
    }
    if (starts.length === 0)
        return { status: 'missing', content: null };
    if (starts.length > 1)
        return { status: 'duplicate', content: null };
    const sectionLines = [];
    for (let i = starts[0].endIndex + 1; i < lines.length; i++) {
        const candidate = parseAuthorityHeading(scan, i);
        if (candidate && candidate.level <= 2)
            break;
        sectionLines.push(scan.masked[i] ? '' : scan.text[i]);
    }
    return { status: 'unique', content: sectionLines.join('\n') };
}
/** 兼容旧签名：仅返回掩码（含围栏/缩进代码/HTML 注释）。 */
export function fenceMask(lines) {
    return authorityScan(lines).masked;
}
/**
 * 剥掉一行内的行内代码 span——按 CommonMark 等长 backtick delimiter 成对解析
 * （code-r2 F4：`` ``[占位]`` `` 等任意长度定界符的引用均不得命中权威结构）。
 * 未闭合的 backtick 串保留原文。
 */
export function stripInlineCode(line) {
    let out = '';
    let i = 0;
    while (i < line.length) {
        if (line[i] !== '`') {
            out += line[i];
            i++;
            continue;
        }
        let n = 0;
        while (line[i + n] === '`')
            n++;
        // 向后找**等长**的关闭 backtick 串
        let j = i + n;
        let closeEnd = -1;
        while (j < line.length) {
            if (line[j] === '`') {
                let m = 0;
                while (line[j + m] === '`')
                    m++;
                if (m === n) {
                    closeEnd = j + m;
                    break;
                }
                j += m;
            }
            else {
                j++;
            }
        }
        if (closeEnd !== -1) {
            i = closeEnd; // 剥掉整个 code span（含定界符）
        }
        else {
            out += line.slice(i, i + n); // 未闭合：保留
            i += n;
        }
    }
    return out;
}
/**
 * 取表格行的单元格清单（r3 F19：GFM 语义——`\|` 转义管道与 code span 内管道不是单元格分隔符；
 * 兼容无首尾 pipe 的合法 Markdown 表格）。
 */
export function tableRowCells(line) {
    const t = line.trim();
    const cells = [];
    let cur = '';
    let i = 0;
    while (i < t.length) {
        const ch = t[i];
        if (ch === '\\' && t[i + 1] === '|') {
            cur += '\\|';
            i += 2;
            continue;
        }
        if (ch === '`') {
            // 等长 backtick code span：span 内的 | 不分隔单元格
            let n = 0;
            while (t[i + n] === '`')
                n++;
            let j = i + n;
            let closeEnd = -1;
            while (j < t.length) {
                if (t[j] === '`') {
                    let m = 0;
                    while (t[j + m] === '`')
                        m++;
                    if (m === n) {
                        closeEnd = j + m;
                        break;
                    }
                    j += m;
                }
                else {
                    j++;
                }
            }
            if (closeEnd !== -1) {
                cur += t.slice(i, closeEnd);
                i = closeEnd;
                continue;
            }
            cur += t.slice(i, i + n);
            i += n;
            continue;
        }
        if (ch === '|') {
            cells.push(cur);
            cur = '';
            i++;
            continue;
        }
        cur += ch;
        i++;
    }
    cells.push(cur);
    const trimmed = cells.map(c => c.trim());
    if (t.startsWith('|') && trimmed.length > 0 && trimmed[0] === '')
        trimmed.shift();
    if (/[^\\]\|$/.test(t) && trimmed.length > 0 && trimmed[trimmed.length - 1] === '')
        trimmed.pop();
    return trimmed;
}
/** Markdown 表格 delimiter 行（`|---|:---:|` 形态；兼容无首尾 pipe）。 */
export function isTableDelimiterRow(line) {
    if (!line.includes('|'))
        return false;
    const cells = tableRowCells(line);
    return cells.length > 0 && cells.every(c => /^:?-{3,}:?$/.test(c));
}
//# sourceMappingURL=markdown-scan.js.map