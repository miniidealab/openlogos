## MODIFIED — 判定流程（两消费点同流程）

1. 解析 delta 的 `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 块（段标记解析扩展承认 REMOVED-ITEMS；仅含 REMOVED-ITEMS 无物质变更块 → 非法）；
2. 目标主文档不存在 → 跳过（新文件无守恒义务）；
3. 逐锚解析章节（0 / ≥2 命中 → `delta_section_anchor_unresolvable`，该锚不再进入后续对账）；
4. 对每个被 MODIFIED / REMOVED / REMOVED-ITEMS 触及的章节，从目标切片的真实根标题到章节末尾按注册表**结构化抽取**既有 ID 集合；
5. 对唯一命中的 MODIFIED 块构造真实最终章节视图：`effectiveLines = ["#".repeat(hit.level) + " " + hit.text, ...block.lines]`，再以 `chunkRootIsFirstHeading=true` 调用现有 `extractRegistryIds` 抽取 retained。禁止从 anchor 字符串提取 ID；标题路径中的父标题或散文 token 不得成为保留伪证；
6. 逐章节集合对账：既有 ID −（最终章节视图的结构 ID ∪ 同锚 REMOVED-ITEMS 点名 ID ∪ 整节 REMOVED 的全节 ID）≠ ∅ → 逐 ID 产 `delta_implicit_id_removal`；点名 ID ∉ 锚定章节既有集合 → `delta_removed_unknown_id`；REMOVED-ITEMS 无同锚 MODIFIED 配对 → 按 `delta_implicit_id_removal` 对偶缺陷报出；
7. 违规稳定排序（L8 位于 L7 之后，同 path 按源位置出现序）。

## MODIFIED — 二十四、delta 条目守恒判据架构（merge-conservation-archive-audit S37） > 实现映射

| 面 | 位置 | 内容 |
|----|------|------|
| 判据纯函数 + 锚解析器 + ID 模式注册表 | `cli/src/lib/change-lint.ts` | 守恒对账函数、heading-path 锚解析、`ID_PATTERN_REGISTRY`（文法 + 结构位置双要素）、violation code 定义 |
| 根标题最终态重建 | `cli/src/lib/change-lint.ts` 的 `evaluateDeltaConservation` | 锚唯一命中后复用 `hit.level` / `hit.text` 重建根标题，与 MODIFIED 正文共同形成 retained 抽取输入；不得解析 anchor token |
| L8 检查项接线 | `cli/src/commands/change-lint.ts`（经 lib 打包） | L8 汇入 violations 聚合与稳定排序 |
| merge 消费点拒绝 | `cli/src/commands/merge.ts` | 生成 MERGE_PROMPT 前打包调用，违规非零退出 |
| 违规文案 | `cli/src/i18n.ts` | L8 违规与 merge 拒绝文案 key（zh/en）；本修复不改变文案与错误码 |
| 契约登记 | `spec/cli-json-output.md` §3.15 | `ChangeLintViolationCode` 闭合枚举维持不变 |
| 回归测试 | `cli/test/s37-delta-conservation.test.ts` | 根标题 SXX/DXX/数字节号正例、内嵌 ID 删除反例、标题路径与 lint/merge CLI 闭环 |
| 映射一致性回归 | `cli/test/`（S37 测试） | `DELTA_TO_RESOURCE` 与 `spec/change-management.md`、change-writer 目录映射表三方一致（含 `spec → 根 spec/`、`skills → 根 skills/`） |

## MODIFIED — 二十四、delta 条目守恒判据架构（merge-conservation-archive-audit S37） > 架构不变量

1. 守恒判据纯函数、无副作用、不读写文件系统之外的状态（输入即字符串）。
2. lint 与 merge 共享同一判据、同一锚解析器、同一注册表，严禁第二份。
3. 锚解析 fail-closed：0 / 多命中一律拒绝，禁止任何猜测式回退；只有唯一命中后才能构造最终章节视图。
4. 根标题身份来自目标命中的真实 `level/text`，不来自控制锚字符串；控制锚可能是标题路径，父级 ID 不得进入 retained。
5. 结构化归属：根标题重建只证明该根标题仍在最终文档中；内嵌标题、测试表和带身份场景表行仍按原结构位置逐项守恒，任何正文 token 扫描式实现均不合规。
6. 零回归：L1–L7 判据、合法 delta 的 merge 消费行为、违规码、JSON envelope、稳定排序与 `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 操作语义不变；L8 只消除根标题假阳性。
7. archive audit-only 契约（见功能规格 §2.33.6）不引入任何读 archive 的代码路径——resources 自足性在代码面的体现是「archive 只写不读」维持现状并固化为红线。
