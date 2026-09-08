# Delta: core-S06-test-cases.md

> change: lite-cut2a-remove-authority-closure
> 目标：`logos/resources/test/core-S06-test-cases.md`

## REMOVED — S06 Authority Closure 测试设计用例

文档顶部的空壳章节（仅承载标题，无正文与用例），随本文件的 Authority Closure 用例一并删除。

## MODIFIED — S06：Authority Closure 测试设计用例

> 本文件原有的全部用例（UT-S06-01～06、ST-S06-01～02）验证的是 test-writer 依 Authority Closure 生成 happy/stale/conflict/legacy_writer/restart/rebuild/rollback/reverse_inference 八维必测矩阵。change-lint L10 删除后该矩阵要求不复存在，用例失去验证对象，整体删除。
>
> S06 的通用测试设计能力（UT/ST 用例设计、异常边界覆盖、reporter 接入）由 `logos/skills/test-writer/SKILL.md` 与 S06 场景实现文档约束，本轮不新增自动化用例。

## REMOVED-ITEMS — S06：Authority Closure 测试设计用例

- UT-S06-01 — 每 fact 八维矩阵生成，随 L10 删除
- UT-S06-02 — 真实 ID 与 fact/AC 反向追溯，随 L10 删除
- UT-S06-03 — stale 夹具有效性校验，随 L10 删除
- UT-S06-04 — restart 复用内存拒绝，随 L10 删除
- UT-S06-05 — 漏 legacy writer 的覆盖闭合校验，随 L10 删除
- UT-S06-06 — 证据化 SKIP 判据，随 L10 删除
- ST-S06-01 — 完整八维矩阵产出，随 L10 删除
- ST-S06-02 — 矩阵产出的 reporter 接入，随 L10 删除
