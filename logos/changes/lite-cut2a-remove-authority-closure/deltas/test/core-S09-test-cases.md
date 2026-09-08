# Delta: core-S09-test-cases.md

> change: lite-cut2a-remove-authority-closure
> 目标：`logos/resources/test/core-S09-test-cases.md`

## REMOVED — S09 authority_impact 生命周期测试

本节（UT-S09-266～270、ST-S09-104～105）验证 `authority_impact` 声明在提案生命周期中的判定：required 完整、not_applicable 合法、缺声明不降级、历史前沿兼容、授权分层。`authority_impact` 块随 L10 删除后不再被解析（存量块忽略而非报错，见提案决策 C01），本节整体失去验证对象。

## MODIFIED — S09 merge 准入判定与 change-lint 同源测试


### 单元测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|---|
| UT-S09-283 | merge 准入与 change-lint 结论逐字同源 | Step 3→5 | 两组夹具：① change-lint PASS 的合规提案；② 含任一违规的提案 | 对同一提案目录分别取 `runChangeLint` 的 violations 与 merge 的准入结论 | ① lint 无违规 → merge 放行；② lint 有违规 → merge 拒绝。二者结论在两组夹具上均一致；**不存在 lint 红而 merge 绿的组合** |
| UT-S09-284 | 无 baseline_closure 信号的提案同样经预检 | Step 3 | 提案不含 `baseline_closure` 声明，`[delta]` 任务也不用 `[MODIFY]`/`[CREATE]` 标记，且 `deltas/` 下存在一个缺段标记的 `.md` delta | 发起 merge | 判 `delta_missing_section_marker` 并拒绝；此前该形态的提案整道预检不做、直接放行。诊断中点名该 delta 的具体路径；不写 `SPEC_MERGED`、不生成 `MERGE_PROMPT.md` |
| UT-S09-285 | 拒绝时逐条输出可归因诊断 | Step 5b | 提案含 ≥2 条不同类型的违规 | 捕获 merge 的 stderr | 每条违规单独成行，各含 `code`、文件路径、具体字段与 `fix_hint`；不得只出现「L1-L9 未全过」这类聚合结论；诊断中出现导致失败的实体本身 |
| UT-S09-286 | test-change-set 捕获此前不可见的 ID | test-change-set 写入 | test delta 中含 `UT-JSON-09` 形态的表格首列 ID | 求本次变更 ID 集合 | 该 ID 被捕获。同时断言集合只增不减——原有严格形态 ID 全部仍在 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S09-110 | 真实 CLI 下 merge 与 change-lint 可预测一致 | Step 1→6 | 真实 CLI；launched 夹具项目；一份含任一 change-lint 违规（如 delta 缺段标记）的提案 | ① 跑 `change-lint` 记录退出码与违规集；② 跑 `merge` 记录退出码与输出；③ 修正该违规后重复①② | ①② 两者结论逐条一致——lint 判违规则 merge 必拒、且拒绝理由是同一批 code；③ 修正后两者同时放行。用户可仅凭 `change-lint` 预知 merge 是否会被拒 |

### 追溯与覆盖

- AC-MERGEGATE-01 准入同源与无条件预检：UT-S09-283、UT-S09-284。
- AC-MERGEGATE-02 阻断逐条可归因：UT-S09-285。
- AC-MERGEGATE-05 可预测性：ST-S09-110。
- AC-MERGEGATE-09 捕获集扩大：UT-S09-286。
- 场景：S09 merge 准入判定与 change-lint 同源；功能规格：§2.51.2、§2.51.5；架构：§四十一.6.1；安装态：SMOKE-core-173。

