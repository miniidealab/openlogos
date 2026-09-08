# Delta: core-S04-test-cases.md

> change: lite-cut2a-remove-authority-closure
> 目标：`logos/resources/test/core-S04-test-cases.md`

## REMOVED — S04 Authority Closure 场景建模测试用例

文档顶部的空壳章节（仅承载标题，无正文与用例），随本文件的 Authority Closure 用例一并删除。

## MODIFIED — S04：Authority Closure 场景建模测试用例

> 本文件原有的全部用例（UT-S04-01～04、ST-S04-01）验证的是 scenario-architect 对 Authority Closure 的时序建模——Registry fact 映射、command/query 分离、双 writer 反例、projection 反向恢复。change-lint L10 删除后这套建模要求不复存在，用例失去验证对象，整体删除。
>
> S04 的通用场景建模能力（时序图产出、场景编号校验、架构概要依赖）由 `logos/skills/scenario-architect/SKILL.md` 与 S04 场景实现文档约束，本轮不新增自动化用例。

## REMOVED-ITEMS — S04：Authority Closure 场景建模测试用例

- UT-S04-01 — Registry fact 映射建模，随 L10 删除
- UT-S04-02 — command/query 分离建模，随 L10 删除
- UT-S04-03 — 双 writer 反例建模，随 L10 删除
- UT-S04-04 — projection 反向恢复建模，随 L10 删除
- ST-S04-01 — 完整 Authority Closure 时序建模，随 L10 删除
