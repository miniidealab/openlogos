/**
 * 整文件 delta 首行控制 marker 的**协议单点**：井号数、op 词、破折号、两种后缀。
 *
 * 本模块自 `non-markdown-delta.ts` 提取而来，协议定义**仍然只有这一份**。提取的唯一理由是
 * 消除依赖环：`canonical-target.ts` 的三值分流判定需要识别 marker 形态，而 `non-markdown-delta.ts`
 * 反过来消费 `classifyCanonicalTargetCategory`。若让 canonical-target 直接 import 校验器模块，
 * 路径判据这一最底层模块会被拖上 OpenAPI/SQL 校验器的全部依赖。故把**纯协议形态**下沉到这里，
 * 两侧同源消费；`non-markdown-delta.ts` 继续 re-export `nonMarkdownMarkerForm` 以保持既有导入不变。
 *
 * `NON_MD_MARKER` 正则与对外的 fix_hint 形态（`nonMarkdownMarkerForm`）**都从这里派生**，
 * 二者不可能漂移。此前 change-lint 手写的 fix_hint 是 `# ADDED|MODIFIED <路径>`——井号数、
 * 破折号、后缀三处全不符，照它修复必然再次失败（事故中的 gap-repair agent 绕开该文案、
 * 自行去读判据实现才写对，属侥幸）。
 */

const NON_MD_MARKER_PROTOCOL = {
  heading: '##',
  ops: { CREATE: 'ADDED', MODIFY: 'MODIFIED' },
  separator: '—',
  suffixes: { CREATE: '（新文件，整文件）', MODIFY: '（整文件替换）' },
} as const;

const reEscape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const P = NON_MD_MARKER_PROTOCOL;

export const NON_MD_MARKER = new RegExp(
  `^${reEscape(P.heading)} (${P.ops.CREATE}|${P.ops.MODIFY}) ${reEscape(P.separator)} `
  + `(.+?)(${reEscape(P.suffixes.CREATE)}|${reEscape(P.suffixes.MODIFY)})$`,
);

/** payload 内残留控制 marker 的探测式——与首行协议同源，不另写一份前缀。 */
export const NON_MD_MARKER_RESIDUE = new RegExp(
  `^${reEscape(P.heading)} (?:${P.ops.CREATE}|${P.ops.MODIFY}) ${reEscape(P.separator)} `,
  'm',
);

/**
 * 某 mode 下合法首行 marker 的**形态**，供诊断的 fix_hint 逐字引用。
 *
 * 派生的是形态（井号数 / op 词 / 破折号 / 后缀 / 占位符位置）；解释性措辞由调用方按 locale 组织，
 * 不在本函数内。调用方**禁止**手写该形态。
 */
export function nonMarkdownMarkerForm(mode: 'MODIFY' | 'CREATE'): string {
  const op = mode === 'CREATE' ? P.ops.CREATE : P.ops.MODIFY;
  const suffix = mode === 'CREATE' ? P.suffixes.CREATE : P.suffixes.MODIFY;
  return `${P.heading} ${op} ${P.separator} <canonical target 路径>${suffix}`;
}

/** 首行解析结果。`declaredMode` 是该 op/后缀组合**声明**的模式，不是本次磁盘事实的模式。 */
export interface WholeFileMarker {
  op: 'ADDED' | 'MODIFIED';
  declaredTarget: string;
  suffix: string;
  declaredMode: 'CREATE' | 'MODIFY';
}

/**
 * **封装形态识别（判别器）**：首行是否声明了整文件封装。
 *
 * S39「识别与受理是两件事，且识别在先」：本函数**只看声明**——`ADDED` / `MODIFIED` 两个 op 与
 * `（新文件，整文件）` / `（整文件替换）` 两种后缀**都算声明了封装**，不检查 op 与本次 mode 是否
 * 相符、target 是否漂移、类别是否受理。把「受理合法」当成识别的前提，会让一份已经声明封装、但
 * 声明不自洽的 delta 落回章节路径——那正是残渣文档的产生机制（锚带后缀却被当成章节标题，后缀被
 * 永久写进落盘标题），不是对它的修复。
 *
 * op 与后缀**交叉**的组合（如 `ADDED` + `（整文件替换）`）同样算声明：它只是声明不自洽，
 * 交由受理阶段拒绝，绝不因此回退成章节锚。
 */
export function parseWholeFileMarkerLine(firstLine: string): WholeFileMarker | null {
  const hit = NON_MD_MARKER.exec(firstLine.replace(/\r$/, ''));
  if (!hit) return null;
  const op = hit[1] as 'ADDED' | 'MODIFIED';
  const suffix = hit[3];
  return {
    op,
    declaredTarget: hit[2],
    suffix,
    // 声明模式取 op 与后缀的**合取**：两者不一致时以 op 为准并由受理阶段点名后缀不符。
    declaredMode: op === P.ops.CREATE ? 'CREATE' : 'MODIFY',
  };
}

/** 该 mode 下合法的 op 与后缀，供受理阶段逐项比对（不在调用方复述字面量）。 */
export function expectedMarkerFor(mode: 'CREATE' | 'MODIFY'): { op: string; suffix: string } {
  return mode === 'CREATE'
    ? { op: P.ops.CREATE, suffix: P.suffixes.CREATE }
    : { op: P.ops.MODIFY, suffix: P.suffixes.MODIFY };
}

/** 取一段文本的首行（去掉行尾 `\r`）；无换行符时整段即首行。 */
export function firstLineOf(text: string): string {
  const nl = text.indexOf('\n');
  return (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, '');
}
