## ADDED — 十二、Canonical change set 与切片归属分层回归

> 以下用例实现必须包含精确 ID，并通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。测试不得以 Delta 出现集合、手写 changed IDs 或 Git diff 代替 `SPEC_MERGED.test_change_set`。

### 12.1 单元测试用例补充

| ID | 描述 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|---|
| UT-S32-43 | 有效 change set 是 C/R 唯一来源 | 构造精确 v1 marker：C 含一新增与一语义修改，R 含一删除；当前 targets 与 after hashes 匹配 | 通过共享 TestChangeSetReader 调用 slice state/validator | reader valid；C/R 精确等于 marker；不读取 `deltas/test`，所有消费者得到同一 provenance |
| UT-S32-44 | 原样基线 ID 不可 owned | change set 的 C 不含原样携带 ID，D 含该 ID；slice manifest 把该 ID 放入 owned | validator | 返回 `test-slice-test-id-unknown` 并指出 owned 字段路径；runner 不启动，不把 ID 补入 C |
| UT-S32-45 | 新增或真实修改 ID 漏配 | C 含新增与语义修改 ID，manifest 分别遗漏一个 | validator 参数化执行 | 每个漏项返回 `test-slice-test-id-missing`；`O != C`；不得写 checkpoint/loop/marker |
| UT-S32-46 | changed ID 多片归属仍 fail-closed | 同一个 C 中 ID 同时位于两片 owned | validator | 返回 `test-slice-test-id-duplicate` 或 assignment ambiguous，列出两片；不自动选 owner、不重写 manifest |
| UT-S32-47 | removed ID 与 owned 解耦 | R 含 final 已不存在的 ID，C/O 不含它；再构造 manifest owned 含该 removed ID | reader + validator | 正例不要求 R 在 D 中存在或 owned；反例返回 unknown；R 不进入 eligible、pending、uncovered |
| UT-S32-48 | 不可信 change set 阻断且不误恢复 | 参数化：字段缺失、未知 schema、payload hash 错、target identity/hash 漂移；slice manifest 同时 missing/invalid | deriveSliceVerificationState / next action | `manifest_status=invalid`、reason=`test-slice-manifest-invalid`，含精确 `test-slice-change-set-*` violation 与 `human_action_required=true`；`next_node` 不为 `plan-slices`，零 Gate/loop/checkpoint/runner 副作用 |
| UT-S32-49 | 跨仓事故的 C 精确为六 ID | before 含 UT-S10-121～129 与 ST-S10-36～39；final 原样携带其中 12 个，修改 UT-S10-129，新增 UT-S10-137～140 与 ST-S10-44 | 结构化差异后交给 reader/validator | C 精确按 ASCII 排序为 ST-S10-44、UT-S10-129、UT-S10-137、UT-S10-138、UT-S10-139、UT-S10-140；12 个原样 ID 留在 B 且不得 owned；无 18-ID 假阳性 |

### 12.2 场景测试用例补充

| ID | 描述 | 覆盖步骤 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S32-14 | 五个消费者对同一 C/R 同源一致 | S32 读取与校验主路径 | 准备一个有效 marker/targets 快照，依次执行 `status`、`next`、`change-lint`、manifest validator 与 `verify` | 五者报告的 C/R、provenance、validity 与 violation 排序一致；无命令扫描 Delta 或产生影子集合 |
| ST-S32-15 | change set 有效时保留 slice manifest 恢复 | S32 manifest 恢复分支 | 有效 change set + 依次构造 slice manifest missing/invalid/stale，调用 `next`，由 slice-planner 重建后复检 | 三态均派 `plan-slices`；只替换 manifest并保持 tasks、SLICES_APPROVED、checkpoint；复检后按 C 唯一归属继续 |
| ST-S32-16 | change set 不可信时保持人工边界 | S32 change-set 失败分支 | 有效 slice manifest + 篡改 change-set schema/hash/target，跨进程调用 `status`、`next` 与 `verify` | 每次稳定返回 human action required；不派 slice-planner，不启动 runner，不写/推进 Gate、loop、checkpoint、tasks 或 VERIFY marker |

### 12.3 测试数据与断言

- 事故 fixture 必须逐 ID 断言六个 C 和十二个 B，不得只断言数组长度。
- UT-S32-48/ST-S32-16 必须对命令前后文件清单与逐文件 SHA-256 做快照，证明恢复和验收副作用为零。
- 测试 double 必须对 Delta scanner、Git 命令和 runner 入口设调用哨兵；不允许以“输出看似正确”替代单一入口证明。
- 所有数组、violations 和 JSON 输出需重复执行两次，证明 ASCII 顺序及跨进程派生稳定。

### 12.4 覆盖度校验

- [ ] change set reader 与 C/R authority：UT-S32-43、ST-S32-14
- [ ] 原样、漏配、重复归属与删除：UT-S32-44～UT-S32-47
- [ ] 不可信 change set 分层阻断：UT-S32-48、ST-S32-16
- [ ] 跨仓事故精确六 ID：UT-S32-49
- [ ] 有效 change set 下的 manifest recovery：ST-S32-15
