# Delta: core-01-requirements.md

> change: lite-cut2a-remove-authority-closure
> 目标：`logos/resources/prd/1-product-requirements/core-01-requirements.md`

## REMOVED — S04/S06/S07/S09/S12/S16/S19/S35 Authority Closure 方法论门需求

本节定义 Authority Closure 作为方法论门的全部验收要求：每个变更声明 `authority_impact`、每个业务事实闭合 15 个字段、scenario-architect 产出权威时序、test-writer 产出八维必测矩阵、change-lint 以 L10 强制、机器输出携带 authority summary、安装态 smoke 覆盖 cutover。L10 删除后本节整体失去要求对象。

## MODIFIED — S05/S35 门禁前置可满足性与规范补救手段可用性要求

### 用户问题与价值

门禁存在一种结构性缺陷：**门禁的前置条件，依赖了该门之后才被允许产出的产物**。当一道门所处状态的定义是「尚未产出任何 delta」，而它的通过条件却要求 delta 已存在时，两个条件不可能同时成立，用户被迫手工伪造 marker 绕过——代价是绕过正常的 gate 派生、丢失审计行，并让下游消费者的输入为空。

2026-09 的 authority closure plan 门死锁即该形态的一个实例（该门已随 L10 一并删除）。缺陷的形状与具体是哪道门无关，因此本节把「门在其所处阶段必须可满足」升格为对**全部门禁**的通用要求，并要求它有可执行的失败信号，而不是靠人逐个复核。

第二个相关问题：规范中列明的补救手段必须在对应校验器里真实可用。规范告诉用户「可以用某小节补救」，而该小节从未接入判定——用户照规范填写也不会被采信，这类文档与实现的背离同样要有回归锁。

### 核心需求

1. **门禁前置条件必须在该门所处状态下可满足**。任何门的通过条件，不得依赖只有通过该门之后才被允许产出的产物。该性质必须由一条遍历门禁全集的断言锁定：为每个阶段构造该阶段的合法最小产物，逐门求判定，任一门在其阶段不可满足即失败并点名是哪道门、哪个阶段。
2. **同类判据只有一个实现**：「是否已完成规格阶段」「合法 marker 名集合」「`proposal_step` 取值集合」各只有一处权威定义，消费方一律调用它，不得内联重写或各列一份。
3. **诊断必须可归因**：每条门禁诊断中须出现导致失败的实体本身（测试 ID / 文件路径 / 字段名 / 章节锚），不得只给「为空、非法或不在」这类无法定位的措辞。
4. 规范中列明的每个补救手段，必须在对应校验器中真实可用。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-PLANGATE-09 | 「该提案是否已完成规格阶段」只有一个判定实现；全部消费方（含 change-lint）对同一提案得到同一结论，legacy `MERGED` 的读法一致 |
| AC-PLANGATE-10 | 每一份对外发布的 schema 中的 `proposal_step` 枚举都由测试锚到唯一注册表；仅靠 sha256 冻结不算锚 |
| AC-PLANGATE-11 | 提案生命周期 marker 的名称只有一处定义；`HISTORICAL_MARKERS` 不得在多处各列一份 |
| AC-MERGEGATE-04 | 门禁全集在其各自阶段均可满足，且该性质由遍历式断言锁定，新增不可满足的门时立刻变红 |

### 授权与非目标

- 本节只定义交付合同，不授权 `openlogos merge`、verify、本机全局部署、smoke、archive、公开发布或 git push；每个动作继续使用独立人类确认点。
- 不新增命令，不改动公共 JSON envelope 的字段结构。
- **不修改** `guard-check` 的 plan 阶段 delta 白名单，**不修改** `flow-spec` §12.4 对 plan 门状态的定义。
- 不引入以手工 marker 绕过 plan-exit 派生的做法。

### 追溯

- 场景：S05 查看下一步建议（`proposal_step` 派生）、S35 提案计划产物左移硬检查（change-lint）。
- 测试：UT-S35-125、UT-S35-126、UT-S35-129、ST-S35-23。
