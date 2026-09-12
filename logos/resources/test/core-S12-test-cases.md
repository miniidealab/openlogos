# S12：架构设计（architecture-designer）测试用例

> 本文件原有的全部用例（UT-S12-01～06、ST-S12-01）验证的是 architecture-designer 产出 Authority Registry 的完整性——每个 fact 登记 owner / canonical state / sole writer / mutation entry / decision API / projections，以及双 writer 与孤儿投影的拒绝。change-lint L10 删除后该 Registry 不再被消费，用例失去验证对象，整体删除。
>
> S12 的通用架构设计能力（技术选型、组件边界、架构决策记录）由 `logos/skills/architecture-designer/SKILL.md` 与 S12 场景实现文档约束，本轮不新增自动化用例。
