# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：删除合并事务单一权威、Preflight 与可修复 reopen、嵌套章节锚、终态出路与二次 merge 通道、merge 流程契约自洽等验收要求整节；新增 merge 直接合并与 lint-specs 的验收要求。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：删除 §2.44 合并事务单一权威、§2.44.10 Preflight 与局部 Reopen、§2.46 嵌套章节锚同源解析、§2.58 终态出路、§2.60 merge 流程契约自洽；新增「merge 直接合并」与「lint-specs 独立结构检查」功能小节。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md`：删除 merge 前沿事务事实相关时序节，next 回归以 SPEC_MERGED 在场判定 spec-complete。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：删除合并事务生命周期、公共 staging/abort/receipt、Seal Preflight 与 Legacy Reopen、嵌套锚 Slot、前沿推进等时序节；新增 merge 直接合并时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S11-status-progress.md`：删除 status 的 merge_transaction 投影时序。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`：删除 merge-transaction@1 机器输出、消费者 JSON 合同、投影必挂与失败路径结构化错误码等时序节。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：删除合并事务的安装态覆盖要求节。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md`：reopen 通道随合并事务删除，「reopen 后切片归属」时序节改写为「二次合并（回滚重来）后切片归属」。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S39-baseline-on-touch.md`：删除「canonical closure 进入单一 merge transaction」节，闭包 apply 回归直接由 merge 命令一次性提交。
- [x] [MODIFY] `deltas/spec/change-management.md`：删除事务化合并流程段，merge 回归一次性直接合并描述。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：删除 merge transaction 命令族 JSON envelope 合同；新增 merge 直接合并与 lint-specs 的输出契约。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：删除事务前沿映射与兼容优先级段，merge 节点完成回归以 SPEC_MERGED 在场判定。
- [x] [MODIFY] `deltas/spec/tasks-spec.md`：删除 Driver 完成证据中依赖 submit-content 的段落。
- [x] [MODIFY] `deltas/test/core-S05-test-cases.md`：整节删除 merge 前沿事务事实用例（12 个）。
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：整节删除合并事务用例（47 个）；新增 merge 直接合并与 lint-specs 回归锚（新 ID 自 UT-S09-340 / ST-S09-140 起）。
- [x] [MODIFY] `deltas/test/core-S11-test-cases.md`：整节删除 status 的 merge_transaction 投影用例（8 个）。
- [x] [MODIFY] `deltas/test/core-S16-test-cases.md`：整节删除事务机器输出用例（10 个）。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：整节删除事务安装态覆盖用例（18 个）。
- [x] [MODIFY] `deltas/test/core-S32-test-cases.md`：ST-S32-23 的驱动方式由 reopen 重合并改为回滚重来二次合并；UT-S32-69/70 消费语义不变，ID 全部沿用。
- [x] [MODIFY] `deltas/test/core-S39-test-cases.md`：整节删除 canonical closure 单一事务、completed 提交闭包与 seal-bound preflight 用例（12 个）。

## [code] 代码实现

- [x] 切片1：merge 改直接合并 + 删合并事务外壳——重写 `cli/src/commands/merge.ts` 走新的 `lib/merge-direct.ts`：解析 [delta] 目标集做 P==T==D 与路径合法性校验（前置于写入）→ 逐 canonical target 调 `composeOpenLogosMarkdown` 合成最终字节（内含锚唯一定位、标题 rebase、`verifyAgentMaterialOutcome` 物质结果复验）→ 交 `applyBaselineClosureBatch` 一次性原子落盘（失败整批回滚）→ 末步写含结构化 `test_change_set` 的 `SPEC_MERGED`；删除 `lib/merge-transaction{,-candidate,-semantic}.ts`、`commands/merge-transaction.ts`、`commands/merge-apply.ts` 与 index/next/status 的接线及 4 个事务测试文件；二次合并后切片归属消费（S32）随之改写。
- [x] 切片2：lint-specs 独立规格结构检查——新增 `cli/src/commands/lint-specs.ts`，对 `logos/resources/test/` 做重复 ID / 表格列数 / ID 格式三项只读检查（ID 语法一律复用 `lib/test-id.ts` 唯一权威，ID 表按结构识别而非表头措辞），接入 index 路由与 help；**不参与 merge / verify / archive / change-lint 任何门**，仅非零退出并逐条列出位置供人判断。