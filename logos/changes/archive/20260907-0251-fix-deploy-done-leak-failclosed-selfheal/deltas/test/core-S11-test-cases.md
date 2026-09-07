# core-S11-test-cases delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — S11 state_inconsistency 只读对账投影测试

> 覆盖 `status --format json` 在矛盾事实下输出 `state_inconsistency` 投影的挂载位置、字段完整性、证据顺序稳定性，以及一致状态零漂移与投影的只读性质。
>
> 背景：20260907 事故中 `DEPLOY_DONE` 缺失使派生停在 `ready-to-deploy`，下游强证据永不被评估，宿主面板长期显示「请执行部署任务」而无任何对账线索。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S11-80 | 矛盾事实下投影挂载与字段完整 | EX-11.5 | 活跃提案：`deployment_required=true`、`DEPLOY_DONE` **缺失**、`SMOKE_PASS` **在场**、`[deploy]` 已全勾 | 执行 `openlogos status --format json` | `modules[].active_change.state_inconsistency` 在场且三字段齐备：`kind==="deploy_done_missing_with_downstream_evidence"`、`evidence===["smoke_pass_marker_present","deploy_tasks_all_checked"]`（**按固定顺序去重**，稳定可 golden）、`remediation==="openlogos deploy-done"`；`proposal_step` 仍为 `ready-to-deploy`（投影不改派生）；legacy 单模块输出可回退顶层同名字段 |
| UT-S11-81 | 一致状态零漂移且投影只读 | EX-11.6 | 场景 A：`DEPLOY_DONE` 缺失且无任何矛盾证据；场景 B：`DEPLOY_DONE` 已在场 | 分别执行 `openlogos status --format json`，并比对调用前后磁盘 | 两种场景输出均**不含** `state_inconsistency` 键（不是 `null`）；其余字段与修复前逐字一致（既有 status golden 不受影响）；调用前后提案目录文件清单与 mtime 不变——**无写盘、无缓存、无 marker 变化** |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S11-46 | 三类证据分别触发且 `watch` 自动继承 | S11 主时序 + EX-11.5/11.6 | 真实 CLI；分别构造三种矛盾状态：仅 `SMOKE_PASS`、仅 `SMOKE_FAIL`、仅 `[deploy]` 全勾（三者均 `DEPLOY_DONE` 缺失） | 逐个状态执行 `openlogos status --format json`；再对其中一个状态启动 `openlogos watch` 读一帧；最后执行 `openlogos deploy-done` 后复跑 status | 三种状态各自输出投影，`evidence` 分别为 `["smoke_pass_marker_present"]` / `["smoke_fail_marker_present"]` / `["deploy_tasks_all_checked"]`；`watch` 因复用 `collectStatusData` 自动携带同一投影且保持只读；补标后投影字段消失、`proposal_step` 推进；与 `plan_state` / `automation_diagnostic` / `merge_transaction` 等既有只读投影并列挂载、互不覆盖 |

### 追溯与覆盖

- AC-RECON-STATUS-01 矛盾事实输出投影且字段齐备：UT-S11-80。
- AC-RECON-STATUS-02 证据枚举顺序稳定可 golden：UT-S11-80、ST-S11-46。
- AC-RECON-STATUS-03 一致状态零漂移：UT-S11-81。
- AC-RECON-STATUS-04 投影只读、不改派生、不写盘：UT-S11-81、ST-S11-46。
- AC-RECON-STATUS-05 `watch` 自动继承：ST-S11-46。
- 场景：S11「deploy-done 对 status 的影响」§state_inconsistency 只读对账投影；功能规格：§2.67.3；JSON 契约：`spec/cli-json-output.md` `state_inconsistency`。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S11"`；失败不得写 pass。
- 只读断言以调用前后提案目录文件清单与 mtime 比对取证；字段缺席断言必须校验**键不存在**，不得以值为 `null` 通过。
