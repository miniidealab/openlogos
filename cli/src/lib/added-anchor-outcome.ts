/**
 * `ADDED` 锚合成后唯一性判据的**唯一实现点**。
 *
 * S35「ADDED 锚合成后唯一性的 L4 前移」：该判据此前只存在于 merge 合成侧的
 * `verifyAgentMaterialOutcome`，change-lint 零覆盖——`change-lint.ts` 的守恒对账谓词
 * `b.op !== 'ADDED' && b.op !== 'RENAMED'` 把 ADDED 排除在外，别处亦无等价检查，于是
 * `PASS（10/10）` 与 merge 必炸可以并存。2026-09-21 runlogos `add-workbuddy-agent-type`
 * 即因此空转 199 次 merge 后以 `max-hops` 收场，停因面板显示的还不是真因。
 *
 * **为什么独立成模块**：单点要经得起「注入式反证」——把本判据换成相反结论时，lint 与 merge
 * 两侧必须**同时**翻转；只翻转一侧即证明存在第二份实现。同模块内的函数调用不经过导出绑定，
 * 注入不到，那样的「单点」无法被证伪。故把判据下沉到这里，两个消费方**跨模块**同源调用：
 * `markdown-section-authority.ts` 的 `verifyAgentMaterialOutcome`（merge 侧复验）与
 * `evaluateAddedAnchorUniqueness`（lint 侧 L4 前移）。
 *
 * 本模块只做**判定**，不做合成、不做锚解析——输入是两侧各自已解析好的 before/final 结论。
 */

/** 判定所需的锚解析结论投影（结构化取用，避免与 `markdown-section-authority` 互相 import）。 */
export interface AnchorResolutionView {
  status: 'ok' | 'not_found' | 'ambiguous';
}

export type AddedAnchorOutcome = { ok: true } | { ok: false; error: string };

/**
 * `ADDED` 块是否形成了**唯一新增结果**：锚在合成前文档中不存在，且在合成后文档中唯一命中。
 *
 * 最常见的违反形态是 **body 重复标题**：`ADDED` 的锚本身会被合成器发射为章节标题，若作者又在
 * body 里写一遍同名标题，合成后该标题出现两次，锚解析返回 ambiguous，`final.status !== 'ok'`。
 */
export function evaluateAddedAnchorOutcome(
  anchor: string,
  before: AnchorResolutionView,
  final: AnchorResolutionView,
): AddedAnchorOutcome {
  if (before.status !== 'not_found' || final.status !== 'ok') {
    return { ok: false, error: `ADDED 章节没有形成唯一新增结果：${anchor}` };
  }
  return { ok: true };
}

/**
 * 诊断 `fix_hint` 的**契约文案单点**：两侧引用同一份，措辞不漂移。
 *
 * 本族已有一次教训：change-lint 手写的 marker fix_hint 与实际协议三处不符，照它修复必然再次
 * 失败。文案是可达性的一部分，不是装饰。
 */
export const ADDED_ANCHOR_FIX_HINT =
  '`ADDED` 的 body **不含章节标题本身**，标题由锚发射——把 body 里与锚同名的那行标题删掉；'
  + '锚在合并前文档已存在时，请改用 `## MODIFIED — <章节锚>`（整节替换）而不是 `## ADDED`';
