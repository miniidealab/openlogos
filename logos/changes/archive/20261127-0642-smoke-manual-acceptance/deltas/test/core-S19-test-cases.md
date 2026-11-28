## ADDED — S19 SMOKE 人工标记读取与人工判定接入测试（smoke-manual-acceptance）

> 覆盖场景 `core-S19-smoke-gate.md`「S19 SMOKE 人工标记读取与人工判定接入」Step 1～6、EX-19.26～EX-19.29，功能规格 §2.107.2、§2.107.6，需求 AC-SMOKE-MANUAL-01、AC-SMOKE-MANUAL-12。全部用例在 `mktemp -d` 一次性项目中构造，测试代码写入 OpenLogos reporter，`scenario_id="S19"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| UT-S19-127 | 首格容忍人工标记 | smoke 规格表含 `\| SMOKE-core-01 \|`、`\| SMOKE-core-901 [manual] \|`、`` \| `SMOKE-core-902` [manual/macos] \| `` | 调用 smoke ID 读取函数 | 自动集合 = {SMOKE-core-01}；人工集合 = {SMOKE-core-901, SMOKE-core-902} |
| UT-S19-128 | 全人工文件不触发全文回退 | 某规格文件只有一行 `\| SMOKE-core-901 [manual] \|`，正文另提到 `SMOKE-core-950` | 读取 | 人工集合含 SMOKE-core-901；SMOKE-core-950 不进入任何集合 |
| UT-S19-129 | 人工 SMOKE 不计入覆盖与 runner 要求 | 活跃提案 smoke delta 只新增 `SMOKE-core-901 [manual]`；没有 runner | smoke 覆盖预检与 `collectSmokeData` | 无 `smoke_runner_missing` / `smoke_cases_uncovered`；`defined_count` 不含它；`uncovered_cases` 不含它；`changed_case_ids` 不含它 |
| UT-S19-130 | 人工 SMOKE 被写入结果 | 结果文件含 `{"id":"SMOKE-core-901","status":"pass"}` | `openlogos smoke` | 门禁 FAIL，诊断 `manual_smoke_result_id` 点名该 ID |
| UT-S19-131 | 未带标记的行读法不变（回归对照） | 既有夹具（不含任何 `[manual]`），含正文提及 ID 的全文回退文件 | 读取与门禁 | 自动集合、全文回退结果、门禁结论、`gate.reason`、退出码与引入前逐字一致 |
| UT-S19-132 | 自动用例为零但有人工用例 | 只有人工 SMOKE（或只有人工 UT/ST），没有结果文件，环境未开启人工验收 | `smoke --env test` | 不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`；PASS；`defined_count=0`；报告列出「未执行的人工用例」 |
| UT-S19-133 | 有自动用例缺结果仍早退 | 自动集合非空、人工集合非空，结果文件不存在 | `smoke --env prod`（开启） | `NO_SMOKE_RESULTS`，不进入人工阶段，不写 pending 行 |
| UT-S19-134 | 两类用例都没有 | 无任何 smoke 规格表行，测试规格中也没有人工用例 | `smoke` | `NO_SMOKE_CASES`（既有） |
| UT-S19-135 | PENDING 清除旧标记的写入顺序 | 活跃提案有旧 `SMOKE_FAIL` | `smoke --env prod` 得到 PENDING | 先追加账本 pending 行，再删除 `SMOKE_FAIL`；不写 `SMOKE_PASS`；`data.evidence.markers_cleared=["SMOKE_FAIL"]` |
| UT-S19-136 | PENDING 清除标记失败时恢复 | 测试接缝让删除旧 `SMOKE_PASS` 失败 | `smoke --env prod` | 两种标记按快照恢复，本次 pending 行按整行原文撤销；`SMOKE_LEDGER_WRITE_FAILED`、退出码 1 |
| UT-S19-137 | 开启环境自动阶段 FAIL 时不进入人工阶段 | 一条自动 SMOKE fail | `smoke --env prod` | FAIL `failed_cases`（既有）；`data.manual_acceptance.pending` 仍计算并展示，但不写 pending 行 |

### 场景测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| ST-S19-40 | 真实 CLI：未配置人工验收、无人工用例的项目零变化 | 既有 S19 ST 夹具 | 运行既有 `smoke --env test --format json` 流程 | 除新增的默认 `data.manual_acceptance` 外，JSON 其余字段、报告、标记、账本行与引入前一致 |
| ST-S19-41 | 真实 CLI：全人工项目走通等待、记录与重跑 | 只有 `SMOKE-core-901 [manual]`，无 runner、无结果文件；`prod` 开启人工验收并已部署 | `smoke --env prod` → accept → 重跑 | 依次 PENDING（账本 pending 行）、PASS（`SMOKE_PASS`、`manual_passed=true`、`verified=false`） |

### 覆盖度校验

| 来源 | 覆盖用例 |
|------|---------|
| 首格读法与人工集合 | UT-S19-127、UT-S19-128、UT-S19-129、UT-S19-131 |
| Step 2（自动阶段三分支） | UT-S19-132、UT-S19-133、UT-S19-134、ST-S19-41 |
| Step 3～6（人工阶段接入与标记） | UT-S19-135、UT-S19-137、ST-S19-41 |
| EX-19.26 | UT-S19-128 |
| EX-19.27 | UT-S19-130 |
| EX-19.28 | UT-S19-133 |
| EX-19.29 | UT-S19-136 |
| 不变的部分 | UT-S19-131、ST-S19-40 |

### 自动化与证据要求

- 写账本的用例只操作一次性项目的 `logos/.openlogos-runtime/deployments.jsonl`；失败恢复用例通过测试接缝注入，不依赖文件权限。
- 全部用例写 OpenLogos reporter，测试名含对应 ID。
