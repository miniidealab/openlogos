# S06：测试设计（test-writer）测试用例

> 本文件原有的全部用例（UT-S06-01～06、ST-S06-01～02）验证的是 test-writer 依 Authority Closure 生成 happy/stale/conflict/legacy_writer/restart/rebuild/rollback/reverse_inference 八维必测矩阵。change-lint L10 删除后该矩阵要求不复存在，用例失去验证对象，整体删除。
>
> S06 的通用测试设计能力（UT/ST 用例设计、异常边界覆盖、reporter 接入）由 `logos/skills/test-writer/SKILL.md` 与 S06 场景实现文档约束，本轮不新增自动化用例。
