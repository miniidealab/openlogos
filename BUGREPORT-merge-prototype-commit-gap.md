# BUGREPORT：merge 原型落盘缺口——安装态 page-design html delta 被静默丢弃

> 发现：2026-09-14，runlogos 提案 `remove-clarification-gate-and-panel` 执行 `openlogos merge` 时实测。
> 影响版本：0.15.x（实测 0.15.7）；引入点为合并事务重构（lite 系列）后 legacy apply 路径被门死。
> 严重度：**高**——ui_impact 提案的原型变更会无声丢失，且 merge 输出零告警，用户不核对 resources 无从察觉。

## 现象

带 `deltas/prd/2-product-design/2-page-design/*.html` 原型 delta 的提案执行 `openlogos merge <slug>`：

- 合并摘要只列出 `.md` canonical target（实测 21 个 delta 只落 20 个 target），html 不在列；
- `SPEC_MERGED` 正常写入、流程照常前移；
- `logos/resources/prd/2-product-design/2-page-design/` 下同名原型**字节保持 merge 前状态**（实测 core-80 文件 mtime 停在 8 月 18 日）；
- 全程无任何警告或错误——静默丢弃。

## 复现

1. 任一 launched 项目创建提案，`proposal.md` 声明 `ui_impact: true` 并在 pages 清单登记一页原型；
2. 在 `deltas/prd/2-product-design/2-page-design/` 放置与 resources 同名、内容不同的 `.html`；
3. 补齐其余 delta 后 `openlogos merge <slug>`；
4. 对比 resources 下同名 html：内容未更新，merge 输出无告警。

## 根因（两处代码互相指望对方，实际都不做）

**① merge-direct 把原型排除出 canonical target 集**，注释声称由 `commitVerifiedPrototypes` 落盘：

`cli/src/lib/merge-direct.ts:84-87`
```ts
// 原型资产（2-page-design 下的 .html）不是章节文档，由 commitVerifiedPrototypes 整份落盘，
// 不进 merge 的 canonical target 集合。（此前由闭包计划天然排除；改 delta 派生后需显式排除。）
if (entry.relativePath.replace(/\\/g, '/').includes('/2-product-design/2-page-design/')
  && entry.relativePath.endsWith('.html')) continue;
```

**② merge 命令只在 legacy 回归测试模式才调用 `commitVerifiedPrototypes`**：

`cli/src/commands/merge.ts:248-259`
```ts
// ② 原型正式字节由 commitVerifiedPrototypes 落盘；仅历史回归模式保留旧 UI commit 路径。
if (legacyMergeTestMode()) {
  const commit = commitVerifiedPrototypes(changePath, root);
  ...
}
```

`legacyMergeTestMode()`（同文件 :72-74）要求 `NODE_ENV === 'test' && OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY === '1'`，注释明言「安装态 0.14.0 永不启用」。于是：**直接合并路径排除 html（指望 ②），而 ② 在安装态永不执行**——原型 delta 没有任何落盘通道。

推断引入过程：lite 重构把旧 MERGE_PROMPT/apply 路径整体降为 legacy 时，`commitVerifiedPrototypes` 调用被一起圈进 `legacyMergeTestMode()` 门内，但 merge-direct 的排除逻辑与注释未同步更新，形成「排除方与落盘方约定失联」。

## 影响面

- 所有 0.15.x 安装态用户的 ui_impact 提案：原型变更（新增页/改版/墓碑化）一律不生效；
- 回归测试全绿的假象：CLI 自身测试走 legacy 模式（`OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=1`），恰好覆盖了会调用 `commitVerifiedPrototypes` 的那条死路径，安装态真路径无测试覆盖；
- 下游对账链受污染：`PLAN_APPROVED.hashes` / `check-ui-hash-match` 对账的是 delta 侧字节，resources 侧陈旧不入账，「批准的原型」与「落盘的原型」永久分叉。

## 修复方向（建议）

1. **非 legacy 路径补调用**：`merge.ts` 的 `uiImpact` 分支里，把 `commitVerifiedPrototypes(changePath, root)` 移出 `legacyMergeTestMode()` 门（保留其 fail-closed 语义：partial provenance 拒落盘 + 告警、合并照常，绝不静默写未验证字节）；
2. **落盘结果进合并摘要**：committed 的原型逐个列入 merge 输出（与 canonical target 同级可见），失败时明确打印「原型未落盘」告警——消除静默；
3. **补安装态路径测试**：一条不开 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY` 的集成用例——html delta 在场 → merge 后 resources 同名文件字节等于 delta 字节；以及 partial provenance 臂 → resources 不变 + 显式告警；
4. 顺手核对 `merge-direct.ts:84` 注释与实际调用点的约定一致性（本次失联的直接教训）。

## 临时绕行（已在下游执行）

带原型 delta 的 merge 后手动核对 resources 同名 html；未更新则 `cp` delta → resources 补完。runlogos 提案 `remove-clarification-gate-and-panel`（20260913-1853 归档）的 core-80 墓碑页即按此补落盘。

## 证据

- 实测项目：runlogos，提案 `logos/changes/archive/20260913-1853-remove-clarification-gate-and-panel/`（delta 21 个、merge 摘要仅 20 target、core-80 需手工补拷）；
- 代码锚点：`cli/src/lib/merge-direct.ts:84-87`、`cli/src/commands/merge.ts:72-74, 248-259`、`cli/src/lib/ui-provenance.ts:267`（`commitVerifiedPrototypes` 本体，逻辑完好、只是无人调用）。
