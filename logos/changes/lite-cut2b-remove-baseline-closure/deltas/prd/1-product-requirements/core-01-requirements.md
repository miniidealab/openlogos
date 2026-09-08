# Delta: core-01-requirements.md

> change: lite-cut2b-remove-baseline-closure
> 目标：`logos/resources/prd/1-product-requirements/core-01-requirements.md`

## REMOVED — S39: 提案规划时按触达目标形成规格闭包

本节要求作者在规划阶段枚举本次触达的场景，并为每个触达场景补齐 requirement/feature/scenario/test 四维目标与 api/database/orchestration/deployment/smoke 的证据化 disposition，再由 L9 做 P==T==D 对账。

删除理由：让人预测「改动会波及哪些规格」是错误的分工。本次减法自身四次漏标（lite-cut1b 三轮、lite-cut2a 一轮，合计 200 余个用例）**全部由测试覆盖度发现，无一由 L9 发现**——L9 拦下的都是 targets 排序、SKIP 证据组合这类格式问题。同时它逼出编造：一处只涉及测试规格表格列数的修复，也要求为该场景补齐并不存在的场景文档变更。

替代要求见「merge 目标集由 delta 文件派生要求」一节。

## ADDED — merge 目标集由 delta 文件派生要求

### 用户问题与价值

合并需要知道「把哪些 delta 合进哪些主文档」。此前这个集合来自作者在 `proposal.md` 中手工枚举的闭包计划，与磁盘事实是两份数据，因此需要 P==T==D 三方对账来发现它们不一致——而不一致本身正是手工枚举带来的。

真正可靠的事实源是 `deltas/` 目录本身：作者产出了哪些 delta，就要合并哪些目标。这个集合不需要声明，只需要枚举。

### 核心需求

1. **目标集是 `deltas/` 的无逻辑投影**：每个可 merge 的 delta 文件经唯一的路径映射判据得到唯一 canonical target；merge 不读 `proposal.md` 的任何 YAML 声明。
2. **模式按磁盘事实即时判定**：目标文件存在即 MODIFY、缺失即 CREATE，在 merge 执行时判定。计划与事实分离所导致的「模式漂移」在结构上不再可能发生。
3. **路径非法即 fail-closed**：无法映射为 canonical target 的 delta（越界、`..`、未知类别目录）必须在写入任何文件前整体失败并点名该文件。
4. **存量兼容**：历史提案中已写的 `baseline_closure` 块被忽略而非报错，不做迁移。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-DERIVE-01 | merge 目标集等于 `deltas/` 下可 merge delta 的路径映射结果，逐个一一对应；merge 全程不读取 proposal 的 YAML 声明 |
| AC-DERIVE-02 | 目标存在判 MODIFY、缺失判 CREATE，且在 merge 执行时按磁盘事实判定 |
| AC-DERIVE-03 | 路径不可映射的 delta 在写入前整体失败并点名文件，`logos/resources/` 零改动 |
| AC-DERIVE-04 | 存量 `baseline_closure` 块不产生任何 violation 或 warning |

### 追溯

- 场景：S39 delta→canonical target 派生。
- 测试：UT-S39-68、UT-S39-69、ST-S39-30。
