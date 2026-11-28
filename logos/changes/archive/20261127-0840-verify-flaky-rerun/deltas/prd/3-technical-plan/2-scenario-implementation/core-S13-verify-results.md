## ADDED — S13 失败用例复跑与偶发判定（verify-flaky-rerun）

### 场景目标

预跑命令跑出失败用例时，verify 先在同一沙箱内把失败的那几条再跑一次，再算门禁：复跑通过的记为偶发并单独列出，复跑仍失败的照常判失败。规则权威见功能规格 §2.108；runner 约定见 `spec/test-results.md`「失败用例复跑与偶发（verify-flaky-rerun）」。

### 参与者

| 别名 | 组件 | 说明 |
|---|---|---|
| Caller | 用户或 RunLogos driver | 发起 verify |
| CLI | `openlogos verify` | 判断是否复跑、持有首跑快照、合并结果、门禁与统计 |
| Cfg | 生效配置 | `verify.rerun_failed`（缺省开启、上限 10） |
| Box | 执行环境 | 首跑所用的沙箱副本；`sandbox_mode: off` 时为工作区 |
| Runner | 项目测试入口 + OpenLogos reporter | 按 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 收窄执行并写结果文件 |
| Gate | 门禁判定 | §2.75.1、§2.106.7 优先级，输入取复跑合并后的结果 |
| Hist | 验收历史 | 中央索引记录 `flaky_ids` |

### 前置条件

- 本次命令已通过用法检查与环境预检（§2.106.5），至少执行了一个预跑命令组。
- 结果路径运行锁已获取，复跑在同一把锁内进行。
- 首跑所用的执行环境按 §2.108.5 第 4 条保留到复跑决策结束（一次性沙箱副本推迟删除，持久副本保持本次占用）；确实无法继续使用时走 EX-13.27。

### 成功后置条件

- 复跑集合内的每个用例都有确定结论：偶发，或维持失败。
- 复跑集合之外的用例结论与首跑一致。
- `result_path` 的内容等于合并后的最终结果；JSON、验收报告与验收历史中的偶发清单一致。

### 时序图

```mermaid
sequenceDiagram
    actor Caller as 用户/宿主
    participant CLI as openlogos verify
    participant Cfg as 生效配置
    participant Box as 沙箱（首跑同一副本）
    participant Runner as 测试入口/reporter
    participant Gate as 门禁判定
    participant Hist as 验收历史

    Caller->>CLI: Step 1: verify [--format json]
    CLI->>Box: Step 2: 首跑预跑命令组
    Box->>Runner: 执行测试
    Runner-->>CLI: Step 3: 结果文件（含 fail 记录）与命令退出码
    CLI->>CLI: Step 4: 归一化，求复跑集合 R
    CLI->>Cfg: Step 5: 读取 rerun_failed，按 §2.108.3 判断是否复跑
    alt 不复跑
        CLI->>Gate: 按首跑结果判定，rerun.skipped_reason 给出原因
    else 复跑
        CLI->>CLI: Step 6: 保存首跑快照（生效记录及其来源、一致性诊断）
        CLI->>Box: Step 7: 按生效记录来源分派，同一副本内再执行该来源（清空其结果路径，注入 ELIGIBLE_TEST_IDS=分派子集、RERUN=1）
        Box->>Runner: 只执行分派到的用例
        Runner-->>CLI: Step 8: 该来源的复跑采集与退出码
        CLI->>CLI: Step 9: 以快照为底合并：R 外取首跑，R 内取其来源本次采集的记录；保留一致性诊断
        CLI->>CLI: Step 10: 判定偶发 / 维持失败，改判命令组状态
        CLI->>Gate: Step 11: 以合并结果与改判后的命令组状态判定
    end
    Gate-->>CLI: Step 12: 门禁结论
    CLI->>Hist: Step 13: 写入本次记录（flaky_ids）
    CLI-->>Caller: Step 14: 门禁结论、failed_cases、flaky_cases、rerun、警告
```

### 步骤说明

1. **Caller** 执行 `openlogos verify`。
2. **CLI** 按既有流程在沙箱内执行预跑命令组（单阶段、两阶段或按模块的命令组）。
3. **Runner** 写结果文件；**CLI** 记录每个命令组的退出码。
4. **CLI** 读取并归一化结果，求复跑集合 R = 失败用例 ∩ 规格内 UT/ST ∩ 本轮应执行集合。
5. **CLI** 按 §2.108.3 的顺序判断。命中任一不复跑的情形 → 跳到 Step 11，以首跑结果判定。
6. **CLI** 在内存中保存首跑快照：每个用例的生效记录及其来源（首跑逐段采集得到的命令组与阶段），以及首跑应计入一致性检查的诊断（非法行的行号与原因等）。
7. **CLI** 把 R 内每个用例只分派给其生效记录的来源；对每个分派到用例的来源，在首跑的**同一个执行环境**内再执行一次：执行前清空该来源的结果路径，注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`（分派给该来源的子集）与 `OPENLOGOS_VERIFY_RERUN=1`，其余注入变量保持首跑取值。不重新创建沙箱、不重新准备依赖。
8. **Runner** 只执行集合内用例并写结果文件；**CLI** 在执行结束后立即采集该来源的结果路径，记录复跑退出码。
9. **CLI** 以快照为底合并：R 之外的用例取快照；R 之内的用例只看其来源本次复跑采集中的有效记录（出现在采集中即为新记录，不比较 timestamp），没有记录时维持首跑的失败。首跑与复跑中的非法行计入一致性诊断，不因合并消失。
10. **CLI** 对 R 内每个用例判定：新记录为 pass → 偶发；其余 → 维持失败。命令组首跑非零退出、复跑零退出且其 R 子集全部偶发时，改判为通过。
11. **Gate** 以合并后的结果与改判后的命令组状态，按既有优先级判定。
12. 门禁 PASS 且有偶发用例时，`warnings` 增加 `flaky_cases_present`。
13. **CLI** 把合并后的有效记录写回 `result_path`（按原文保留计入诊断的非法行），写验收报告（含「偶发用例」小节）与验收历史（`flaky_ids`）。
14. **CLI** 输出结论；退出码与 `gate.result` 一致。

### 异常与边界

#### EX-13.16：失败用例数超过上限
- **触发条件**：R 的大小超过 `verify.rerun_failed.max_cases`。
- **期望响应**：不复跑，按首跑判定；`rerun.attempted=false`、`skipped_reason="too_many_failures"`，`requested_ids` 仍列出 R。
- **副作用**：无。

#### EX-13.17：复跑后没有新记录或新记录为 skip
- **触发条件**：测试入口不支持按用例收窄、未执行到该用例，或对该用例写了 skip。
- **期望响应**：该用例维持失败，`error` 取首跑的；诊断说明复跑未产生通过结果。不进入跳过分类。
- **副作用**：无。

#### EX-13.18：测试入口回滚了结果账本
- **触发条件**：首跑命令非零退出，结果文件中没有任何 fail 记录（EX-9.1 形态）。
- **期望响应**：不复跑，`skipped_reason="no_failed_cases"`；门禁照旧 `pre_run_failed`。
- **副作用**：无。

#### EX-13.19：复跑命令自身非零退出
- **触发条件**：复跑的命令组非零退出。
- **期望响应**：R 内用例仍按各自的新记录判定（通过的记偶发）；该命令组不改判，维持首跑的失败状态。若此时已无失败用例，门禁按预跑失败一支取 `pre_run_failed`。
- **副作用**：`rerun.commands[]` 记录首跑与复跑退出码。

#### EX-13.20：复跑期间结果文件被清空或覆盖
- **触发条件**：测试入口启动时清空结果文件，复跑后文件只含 R 内用例的记录。
- **期望响应**：R 之外的用例取首跑快照，统计与覆盖度不变，不出现未覆盖；最终写回的 `result_path` 含全部用例。
- **副作用**：无。

#### EX-13.21：复跑写入了 R 之外的记录
- **触发条件**：测试入口没有收窄，复跑时把全部用例又跑了一遍，其中某条首跑通过的用例这次失败。
- **期望响应**：R 之外的记录不采信，该用例仍计为通过；诊断提示测试入口未按集合收窄。
- **副作用**：无。

#### EX-13.22：切片 checkpoint 与模块范围
- **触发条件**：slice-checkpoint 验收，或启用了按模块限定范围。
- **期望响应**：R 先与本轮 eligible / 范围内用例求交；只复跑服务这些用例的命令组；`OPENLOGOS_VERIFY_SLICE_SCOPE`、`OPENLOGOS_VERIFY_MODULES` 保持首跑取值。偶发用例按通过计入 checkpoint 与模块验收报告。
- **副作用**：无。

#### EX-13.23：两阶段命令
- **触发条件**：配置了 `regression_command` 与 `incremental_command`，失败用例来自其中一段或两段。
- **期望响应**：每个失败用例只在其生效记录所在的阶段复跑一次，只采信该阶段本次复跑的采集。两阶段共用 `result_path`、同一 ID 在两段都出现时（例如 regression pass、incremental fail，生效记录为后者），只向 incremental 分派该 ID；regression 不被再执行，其记录不参与该 ID 的复跑判定。
- **副作用**：无。

#### EX-13.24：配置关闭或非法
- **触发条件**：`enabled: false`；或 `rerun_failed` 取值非法。
- **期望响应**：关闭时不复跑，`skipped_reason="disabled"`，其余输出与 0.16.25 一致；非法项按缺省值处理并输出警告 `rerun_config_invalid`。
- **副作用**：无。

#### EX-13.25：不执行预跑的情形
- **触发条件**：环境预检类原因命中；或未配置预跑命令、只读取既有结果；或 `test_change_set_invalid` 命中。
- **期望响应**：不复跑，`skipped_reason` 分别为 `precheck_failed`、`no_command`、`gate_blocked`；门禁结论与引入前一致。
- **副作用**：无。

#### EX-13.26：首跑账本含非法行
- **触发条件**：首跑结果文件中有无法解析或不合法的行（例如末尾一行坏 JSON），同时有失败用例触发复跑；复跑时测试入口清空结果文件并只写复跑记录。
- **期望响应**：首跑的非法行随快照保留到最终门禁。复跑通过的用例照常列为偶发，但门禁按既有优先级为 `result_ledger_inconsistent`，验收报告保留非法行原因，不写 `VERIFY_PASS`；写回的 `result_path` 按原文保留该非法行。
- **副作用**：无。

#### EX-13.27：首跑执行环境无法继续使用
- **触发条件**：首跑使用的沙箱副本在复跑前已不存在、已被重置，或本次占用无法保持。
- **期望响应**：该命令组不复跑，不新建副本、不退回工作区执行；分派给它的用例维持失败，`error` 取首跑的，诊断说明原因；`rerun.commands[]` 中该项保留，`rerun_exit_code=null`、`skipped_reason="sandbox_unavailable"`，`status_after` 取首跑的命令组状态（不强制为 fail）。全部需要复跑的命令组都不可用时 `rerun.attempted=false`、`skipped_reason="sandbox_unavailable"`；门禁按首跑的命令组状态与结果走既有优先级——首跑非零退出时为 `failed_cases`；首跑零退出时进入「预跑命令全部成功」一支，账本有非法行时主原因为 `result_ledger_inconsistent`，否则为 `failed_cases`。
- **副作用**：一次性副本在决策结束后照常删除。

### 追溯

- 需求：AC-VERIFY-RERUN-01～11、13。
- 功能规格：§2.108、§2.104.3。
- 测试：`core-S13-test-cases.md`（UT-S13-180 起、ST-S13-44 起）。
