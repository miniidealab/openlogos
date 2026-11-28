## ADDED — S32 切片规划的目标提案与模块测试（verify-scope-fields-and-slice-module）

> 覆盖场景 `core-S32-slice-planning.md`「S32 切片规划的目标提案与模块」（Step 1～10、EX-32.38～EX-32.42），功能规格 §2.110、§2.78.3（修改），`spec/test-slice-manifest.md`「写入前置条件：目标提案与模块」，`spec/cli-json-output.md` 中 `SLICE_PLAN_NO_ACTIVE_CHANGE` 的说明；需求 AC-VERIFY-FIELD-08～10。
>
> **夹具 SM**：`mktemp -d` 一次性 git 项目，模块 `core` 与 `backend`（均 launched，各自声明非空 `paths`，`verify.modules` 各有命令组）。已合并测试规格 `core-S01`（UT-S01-01、02）、`backend-S05`（UT-S05-01、02，以及本提案新增的 UT-S05-03、04、05）。活跃提案 `sm-demo` 登记在 `backend`：guard 的 `activeChange` 为 `sm-demo`、`module` 为 `backend`、带 `baseRef`；`proposal.md` 头为 `> module: backend`；经正常 `merge` 写入 `SPEC_MERGED`，其 `test_change_set.module` 为 `backend`、变更用例为 UT-S05-03、04、05。切片输入 `slices.json`：slice-a 拥有 UT-S05-03，slice-b 拥有 UT-S05-04、05。
>
> 夹具不得把提案改登记到 `core` 来绕开模块比对（layered-verification 的多模块夹具曾这样做，随本变更改回）。「不变」类断言比较文件字节的哈希。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S32-126 | 非 core 模块提案的清单模块等于提案模块 | §2.110.2、Step 1～10、EX-32.39、AC-VERIFY-FIELD-08 | 夹具 SM | `slice plan --file slices.json --format json`，读取 `TEST_SLICE_MANIFEST.json` | 退出码 0；清单 `change=="sm-demo"`、`module=="backend"`；`tasks.md` 的 `[code]` 段含两个切片 |
| UT-S32-127 | 规划后的验收不再判清单无效 | §2.110.2、EX-32.39、AC-VERIFY-FIELD-08 | 夹具 SM，已执行 UT-S32-126 的规划；入口对当前切片的用例写 pass | `verify --format json` | 没有 `test-slice-manifest-invalid`；`verify_mode=="slice-checkpoint"`，`attempted_slice_id` 为第一个切片，`eligible_test_ids` 含该切片的用例；checkpoint PASS |
| UT-S32-128 | 读取测试变更集与校验使用同一个模块（delta-r2 F4） | §2.110.2、§2.78.3 | 夹具 SM（变更用例三条）；每次调用前写入对应的切片输入：① `slices-missing.json` 有两个合法切片——slice-a 拥有 UT-S05-03、slice-b 只拥有 UT-S05-04，第三条变更用例 UT-S05-05 无人认领（两个切片且每个都带用例 ID，切片验证因此启用、写入者会读取测试变更集并做归属对账）；② `slices.json` 为完整输入（slice-b 拥有 UT-S05-04、05） | ① `slice plan --file slices-missing.json --format json`；② `slice plan --file slices.json --format json` | ① 按既有输出合同拒绝：退出码 1，stderr 错误信封 `error.code=="SLICE_PLAN_UNKNOWN_TEST_ID"`，信封顶层 `violations` 含一条 `code=="test-slice-test-id-missing"` 且 message 点名 UT-S05-05（说明以 `backend` 读取的测试变更集有效并参与了归属对账；若仍以 `core` 读取，变更集无效、对账被跳过，本次调用会成功）；`tasks.md` 不变、没有生成清单；② 退出码 0，没有 `$.module` 相关违规 |
| UT-S32-129 | `--slug` 指向另一个提案时拒绝且不改文件（proposal-r1 F2） | §2.110.1、EX-32.38、AC-VERIFY-FIELD-09 | 夹具 SM 增加第二个提案 `other-demo`（登记在 `backend`、已合并、有 `tasks.md`，并预置一份旧的切片清单）；guard 仍指向 `sm-demo`；记录 `other-demo` 的 `tasks.md` 与清单的字节哈希 | `slice plan --slug other-demo --file slices.json --format json` | 退出码 1；stderr 错误信封 `error.code=="SLICE_PLAN_NO_ACTIVE_CHANGE"`，message 含 `other-demo` 与当前活跃提案 `sm-demo`；`other-demo` 的 `tasks.md` 与清单哈希不变；提案目录中没有残留的临时文件；`sm-demo` 的产物同样不变 |
| UT-S32-130 | 没有 guard 或 guard 无法解析时带 `--slug` 同样拒绝 | §2.110.1、EX-32.38 | 夹具 SM；① 删除 `logos/.openlogos-guard`；② 把 guard 写成损坏的 JSON；③ guard 是合法 JSON 但没有 `activeChange` | 每臂 `slice plan --slug sm-demo --file slices.json --format json` | 每臂退出码 1、`SLICE_PLAN_NO_ACTIVE_CHANGE`，message 写明没有活跃提案；`sm-demo` 的 `tasks.md` 不变，没有生成清单 |
| UT-S32-131 | `--slug` 等于活跃提案时与不传相同 | §2.110.1 | 夹具 SM | ① `slice plan --file slices.json`；还原后 ② `slice plan --slug sm-demo --file slices.json` | 两次写出的 `tasks.md` 相同；清单除 `generated_at` 外相同，`module=="backend"` |
| UT-S32-132 | guard 缺 `module` 字段时取 core | §2.110.2、EX-32.40、AC-VERIFY-FIELD-10 | 单模块夹具（`core`），guard 指向活跃提案但没有 `module` 字段，`SPEC_MERGED.test_change_set` 的 `module` 为 `core` | `slice plan --file slices.json --format json` | 退出码 0，清单 `module=="core"` |
| UT-S32-133 | core 模块提案的产物与引入前一致 | §2.110.3、EX-32.41、AC-VERIFY-FIELD-10 | 单模块夹具，提案登记在 `core` | `slice plan --file slices.json --format json` | `tasks.md` 与引入前实现生成的 golden 逐字节相同；清单除 `generated_at` 外与 golden 相同；stdout 的 `data` 字段与 golden 相同 |
| UT-S32-134 | guard 的 `module` 带首尾空白时写入与读取一致（delta-r1 F2、delta-r2 F2） | §2.110.2、EX-32.42 | 夹具 SM，guard 的 `module` 写成 `" backend "`；入口对当前切片的用例写 pass | ① `slice plan --file slices.json --format json`，读取清单；② `verify --format json`，读取 `SLICE_CHECKPOINTS.jsonl` | ① 退出码 0，清单 `module=="backend"`；② 输出中没有 `test-slice-manifest-invalid`；`verify_mode=="slice-checkpoint"`、`attempted_slice_id=="slice-a"`、`eligible_test_ids` 含 UT-S05-03；`pending_test_ids` 含 UT-S05-04、UT-S05-05（范围计算读出了测试变更集）；`gate.result=="PASS"`、`gate.reason` 不是 `test_change_set_invalid`（门禁的严格跳过集合读取同样接受该变更集）；checkpoint 账本新增一条 slice-a 的 PASS 行 |

### 覆盖度校验

- 模块来源三处共用：UT-S32-126～UT-S32-128、UT-S32-134。
- 目标必须是活跃提案：UT-S32-129～UT-S32-131。
- 兼容：UT-S32-132、UT-S32-133。
- 异常 EX-32.38～EX-32.42 各至少一条：38（129、130）、39（126、127）、40（132）、41（133）、42（134）。
- 需求 AC-VERIFY-FIELD-08（126、127）、09（129、130）、10（132、133）。

### 自动化与证据要求

- 由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。不需要人参与，无平台限定，不需要额外的环境要求。
- `slice plan` 拒绝时的读取位置按既有输出合同（`spec/cli-json-output.md`「openlogos slice plan 输出合同」）：归属类违规（`test-slice-test-id-missing` 等）的顶层错误码为 `SLICE_PLAN_UNKNOWN_TEST_ID`、退出码 1，明细在 stderr 错误信封根的 `violations`；只有顶层码为 `SLICE_PLAN_ARTIFACT_INVALID` 时退出码才是 2（功能规格 §2.78.3 的表已按此改正）。本提案不改 CLI 的这一行为。
- 命令一律以构建后的 CLI 在夹具项目根执行；「与引入前一致」以同一夹具在引入前实现上生成的 golden 比对。
