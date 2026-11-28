# S13: 运行测试验收并生成报告 — 时序图

```mermaid
sequenceDiagram
    participant U as User
    participant C as OpenLogos CLI
    participant X as Sandbox Executor
    participant T as Test Runner
    participant R as Result Merger

    U->>C: Step 1: openlogos verify
    C->>C: Step 2: 读取 verify 配置与 sandbox 配置
    alt regression/incremental configured
        C->>X: Step 3a: 通过沙箱执行 regression_command
        X->>T: Step 3b: 运行回归测试
        T-->>X: Step 3c: 写入回归结果
        X-->>C: Step 3d: 回收回归结果与沙箱诊断
        C->>X: Step 4a: 通过沙箱执行 incremental_command
        X->>T: Step 4b: 运行增量测试
        T-->>X: Step 4c: 写入增量结果
        X-->>C: Step 4d: 回收增量结果与沙箱诊断
        C->>R: Step 5: 合并两阶段 JSONL
        R-->>C: Step 6: 写入 result_path
    else pre_run_command configured
        C->>X: Step 3: 通过沙箱执行 pre_run_command
        X->>T: Step 4: 运行测试
        T-->>X: Step 5: 写入 test-results.jsonl
        X-->>C: Step 6: 回收结果与沙箱诊断
    else no pre-run configured
        C->>C: Step 3: 跳过预跑，保留兼容
    end
    C->>C: Step 7: 读取测试用例与结果
    C->>C: Step 8: 计算覆盖度、通过率、AC 追溯与沙箱状态
    C-->>U: Step 9: 写入 acceptance-report.md 并输出 Gate / 诊断
```

## 步骤说明

1. **用户**执行 `openlogos verify`。
2. **CLI** 读取 `logos.config.json` 的 `verify` 配置，包括预跑命令、结果路径与 `sandbox_mode`。
3. **CLI** 若检测到 `regression_command` 或 `incremental_command`，进入两阶段模型；若仅检测到 `pre_run_command`，走旧兼容路径；若都不存在，直接读取现有结果。
4. **Sandbox Executor** 根据 `sandbox_mode` 决定是否隔离执行：
   - `off`：保持历史行为。
   - `auto`：优先沙箱执行，无法隔离时降级并告警。
   - `always`：无法隔离或检测到非白名单写入时失败。
   - 复制 workspace 时保持 symlink 原始目标字面量，复制后执行 realpath containment 校验，存在逃逸链接按「无法隔离」处理；命令执行期间以 OS 级写保护（如 macOS `sandbox-exec` 拒写原 workspace 子树 / Linux mount namespace 只读绑定）保证运行期新建或改写的 symlink 也无法写入原 workspace，写保护不可用时按能力分层处理（见 EX-3.4 与功能规格 §2.9 symlink 隔离与运行期写保护不变量）。
   - 写入审计豁免沙箱内一次性依赖目录：规范化并统一分隔符后，存在**完整路径段严格等于** `node_modules` 的写入不参与非白名单判定，快照遍历直接跳过该目录（见 EX-3.3 与功能规格 §2.9）；近似名称（如 `node_modules-cache`）不豁免。
5. **测试运行器**写入阶段结果。阶段结果路径可由 `regression_result_path` / `incremental_result_path` 指定。
6. **Sandbox Executor** 只回收配置声明的结果文件，回收采用**定点采集**（对每个白名单路径在沙箱副本内存在即拷回，不依赖快照 diff），白名单路径位于豁免目录下亦照常回收；并返回沙箱诊断，依赖目录豁免生效时向 `sandbox.infos` 附一条信息级说明，不改变 `sandbox.status`、不进入 `pre_run.diagnostics`。
7. **结果合并器**将回归与增量结果合并到 `result_path`。同一用例 ID 多次出现时，按最新 `timestamp` 去重后生效（完整全序规则见「verify 结果账本一致性预检 → 规则」第 3 条；该 ID 存在任一缺失/非法时间戳时，整组退回文件行序 last-wins，等价旧行为）。
8. **CLI** 读取测试规格和合并后的结果。
9. **CLI** 计算验收指标，输出 PASS/FAIL，并在覆盖不足、预跑失败或沙箱失败时输出诊断。Gate 判据为四项（功能规格 §2.75.1）：**预跑命令全部成功**、账本一致、零失败、零未覆盖。单阶段 `pre_run_command` 或两阶段任一段非零退出时一律 FAIL，`gate.reason` 在账本含失败用例时取 `failed_cases`、否则取 `pre_run_failed`；预跑命令全部成功或未配置时保持既有顺序「`result_ledger_inconsistent` → `failed_cases` → `incomplete_coverage`」逐字不变。主原因之外的诊断照常输出（EX-9.1～EX-9.3、EX-9.6）。不再提示「Continuing verify with existing results.」。`--format json` 时 `pre_run.commands[]` 各条目附有界输出尾部 `stdout_tail` / `stderr_tail`（末尾最多 80 行、不超过 8 KiB、去除 ANSI 控制序列；截获不中断子进程、不改退出码，EX-9.4）；文本模式保持实时输出、不截获；`acceptance-report.md` 只记失败阶段与退出码，不写命令输出（EX-9.5）。

## 异常用例
### EX-4.1: 缺少测试结果
- **触发条件**：结果文件不存在。
- **期望响应**：输出错误并退出。

### EX-2.1: 两阶段与 pre_run_command 同时配置
- **触发条件**：`verify.pre_run_command` 与 `verify.regression_command` / `verify.incremental_command` 同时存在。
- **期望响应**：优先执行两阶段模型；在文本和 JSON 输出中标记 `pre_run_command` 被兼容保留但未执行。

### EX-5.1: 第二阶段清空第一阶段结果
- **触发条件**：增量测试 reporter 清空默认 `result_path`。
- **期望响应**：CLI 通过阶段化结果路径、临时快照或等价机制保留回归阶段结果，并在合并后写入最终 `result_path`。

### EX-3.1: sandbox always 无法隔离
- **触发条件**：`verify.sandbox_mode=always`，但当前环境无法创建沙箱。
- **期望响应**：verify FAIL，输出沙箱根目录、失败原因和修复建议；不得继续读取旧结果伪装通过。

### EX-3.2: 预跑命令写入仓库非白名单路径
- **触发条件**：`verify.sandbox_deny_workspace_write=true`，预跑命令写入仓库根目录中的非白名单路径（规范化后存在完整路径段严格等于 `node_modules` 的写入不参与本判定，见 EX-3.3；近似名称目录如 `src/node_modules-cache/**` 仍参与本判定）。
- **期望响应**：`always` 模式下 verify FAIL；`auto` 模式下若无法阻断写入必须输出 `sandbox.status=warn`，并给出改用 `always` 的建议。

### EX-3.3: 沙箱内依赖准备写入（依赖目录豁免）
- **触发条件**：`verify.sandbox_deny_workspace_write=true`，预跑命令仅写入沙箱副本内命中豁免规则的路径——规范化并统一分隔符后存在完整路径段严格等于 `node_modules`（含 monorepo 嵌套形态如 `packages/a/node_modules/**`）。典型来源：pnpm 11 `verifyDepsBeforeRun=install` 在沙箱副本内自动 install/repair，重写 `node_modules/.bin/*`。
- **期望响应**：任一沙箱模式下均不判为非白名单写入——`always` 不因此 FAIL，`auto` 不因此 warn；`sandbox.infos` 输出一条固定信息级豁免说明（依赖目录为沙箱内一次性目录，不参与写入审计，不会回收到工作区），`sandbox.diagnostics` 与 `pre_run.diagnostics` 不含该说明，文本输出以 `ℹ️` 渲染一次；`sandbox.status` 不因此改变；白名单之外的豁免路径不回收到原 workspace，快照遍历直接跳过；白名单结果文件即使位于 `node_modules` 下仍被定点采集回收。豁免规则之外的非白名单写入判定不变（仍按 EX-3.2 处理）。

### EX-3.4: 沙箱副本内 symlink 逃逸（启动前拓扑 + 运行期动态逃逸）
- **触发条件（启动前）**：workspace 复制进沙箱后，沙箱 workspace 内存在解析目标位于沙箱之外（含原 workspace）的 symlink——例如 monorepo 的 `node_modules/pkg -> ../packages/pkg` 被复制语义改写为指向原 workspace 的绝对路径，或项目本身含绝对目标外链。
- **期望响应（启动前）**：逃逸链接按「无法隔离」处理：`always` 模式下命令失败，输出逃逸链接路径与修复建议；`auto` 模式下降级为非隔离执行并告警（`sandbox.status=warn`）。逃逸链接不进入依赖目录豁免；复制必须保持内部相对链接的相对语义，保证内部链接不构成逃逸。
- **触发条件（运行期）**：预跑命令在通过启动前校验之后，于沙箱内（含 `node_modules` 下）**新建**指向沙箱外的 symlink，或把已通过校验的内部链接 **retarget** 到原 workspace，再经该链接写入。install/repair 类命令重建依赖 symlink 属正常行为，本情形不限于恶意构造。
- **期望响应（运行期）**：由 OS 级运行期写保护在**写入发生前**阻断（文件系统层拒绝对原 workspace 子树的写入）——任一模式下原 workspace 必须保持字节不变，写入尝试失败由命令自身报错体现；不得以依赖目录豁免静默通过。运行期写保护机制不可用时按能力分层处理：`always` 模式命令失败并说明「无法启用运行期写保护」；`auto` 模式继续沙箱执行但 `sandbox.status=warn` 并披露残留风险。仅命令后复查不满足本用例——写入已发生则无法挽回。

### EX-8.1: 覆盖不足且无预跑配置
- **触发条件**：未配置任何预跑命令，且存在未覆盖用例。
- **期望响应**：verify FAIL，输出覆盖不足列表，同时提示可能只运行了局部测试，并建议配置 `verify.pre_run_command`、`verify.regression_command` 或启用 verify 沙箱以隔离完整测试执行。

### EX-9.1: 单阶段预跑命令失败且账本被回滚为旧的完整结果

- **触发条件**：`verify.pre_run_command` 以非零状态退出；测试运行器在失败后把 `result_path` 回滚为上一份完好账本（RunLogos `scripts/run-vitest.js` 的既有行为，2026-10-06、2026-10-09 两次事故形态），或账本恰好完整、全部通过。
- **期望响应**：Gate FAIL，`gate.reason` 为 `pre_run_failed`（修改前分别误报为 `result_ledger_inconsistent` 或直接 PASS）；`pre_run.commands[0]` 如实记录 `status:"fail"` 与 `exit_code`；账本一致性与未覆盖诊断照常输出，不作为主原因。
- **副作用**：`acceptance-report.md` 记录失败阶段 `pre_run` 与退出码，不写命令输出；不写 `VERIFY_PASS`。

### EX-9.2: 预跑命令失败且账本含失败用例

- **触发条件**：预跑命令非零退出，结果账本中存在 `status:"fail"` 的用例。
- **期望响应**：Gate FAIL，`gate.reason` 仍为 `failed_cases`（更具体、可直接定位），`failed_cases` 照常列出；`pre_run.commands[]` 如实记录该段失败。账本同时不自洽时仍取 `failed_cases`（预跑失败分支），`consistency` 照常输出。
- **副作用**：同 EX-9.1。

### EX-9.3: 两阶段中任一段失败

- **触发条件**：`regression_command` 或 `incremental_command` 任一段以非零状态退出（另一段成功或未配置）。
- **期望响应**：与单阶段同一判据——Gate FAIL，原因按 §2.75.1 优先级取值；`pre_run.commands[]` 中失败段 `status:"fail"`、成功段 `status:"pass"`，两段结果照常合并到 `result_path`。
- **副作用**：报告记录失败的阶段名（`regression` / `incremental`）与退出码。

### EX-9.4: 预跑命令输出超过截获上限

- **触发条件**：`--format json` 下预跑命令输出远超 80 行或 8 KiB（含 ANSI 控制序列），或在沙箱中执行。
- **期望响应**：子进程完整运行至自然结束，不因输出量被提前终止；退出码如实记录；`stdout_tail` / `stderr_tail` 只保留末尾最多 80 行且不超过 8 KiB，截断落在完整 UTF-8 字符边界，ANSI 控制序列被去除。沙箱与非沙箱执行同一口径。
- **副作用**：无；输出全文不落盘。

### EX-9.5: 命令输出不进入验收报告

- **触发条件**：任一预跑命令失败，或 `--format json` 截获了输出尾部。
- **期望响应**：`acceptance-report.md` 只含失败阶段与退出码，不含 `stdout_tail` / `stderr_tail` 或任何命令输出片段；文本模式下命令输出实时打到终端，不被截获。
- **副作用**：无。

### EX-9.6: 预跑成功时失败用例与账本不一致并存

- **触发条件**：预跑命令全部以零状态退出（或未配置任何预跑命令），结果账本既含 `status:"fail"` 的规格用例，又不自洽（如含未知 ID 或计数不符）。
- **期望响应**：保持既有优先级，`gate.reason` 为 `result_ledger_inconsistent`（与修改前逐字一致），`failed_cases` 与 `consistency` 照常输出；本提案的新优先级只在预跑命令失败时生效。
- **副作用**：无。

## verify 结果账本一致性预检

在 Step 7 读取测试用例与结果之后、Step 8 计算验收指标之前，`openlogos verify` 必须执行结果账本一致性预检：

```mermaid
sequenceDiagram
    participant C as OpenLogos CLI
    participant S as Test Specs
    participant R as test-results.jsonl
    participant G as Gate Calculator

    C->>S: Step 7a: 读取已定义自动化 UT/ST ID 与 manual ID
    C->>R: Step 7b: 逐行解析 JSONL
    C->>C: Step 7c: 按 id 依 timestamp 去重全序规则归一化合法候选结果
    C->>C: Step 7d: 校验 status、unknown ID、manual ID 与统计不变量
    alt 账本自洽
        C->>G: Step 8: 计算覆盖率、有效通过率、AC 追溯与 Gate
    else 账本不自洽
        C-->>G: Step 8: Gate FAIL，reason=result_ledger_inconsistent
    end
```

### 规则

1. `status` 只能为 `pass`、`fail`、`skip`；其它值必须进入一致性错误，不得计入 PASS。
2. 结果 ID 必须属于已定义自动化用例；未定义 ID 和 `[manual]` ID 都必须进入一致性错误。
3. 同一用例 ID 多条记录按最新 `timestamp` 去重（取代旧「文件行序 last-wins」，属 contract-self-description 主动语义变更），全序规则（`timestamp` 是可选字段，必须消除歧义）：
   1. 逐条严格解析 `timestamp`（ISO 8601，时区归一为绝对时刻）；非法格式按「缺失」处理；
   2. 该 ID 全部合法 → 绝对时刻最新优先；同刻（含异时区同刻）→ 文件行序后者优先；
   3. 该 ID 存在任一缺失/非法 → 整组退回文件行序 last-wins（等价旧行为，不做时间猜测——不对不完整证据做时间猜测，对齐宁慢勿错杀原则，也保证旧 reporter 产物零行为变化）。
4. 去重后的统计必须满足 `passed + failed + skipped == executed` 和 `executed <= defined`。守恒不变量（executed≤defined 等，既有 `consistency` 契约不变）在去重后计算。
5. `skip` 是合法的环境性跳过结果，计入 executed / covered / skipped，并在报告中展示，但不作为失败结果。
6. 通过率必须使用有效通过数计算：`pass_rate_pct = round((passed + skipped) / executed * 100)`。
7. 当 `failed == 0` 时，`passed + skipped` 必须等于 `executed`；否则说明存在幽灵结果，Gate 必须 FAIL。
8. Gate PASS 条件为：一致性通过、无 fail、无 uncovered、checklist 完成、AC 追溯完成。合法 skip 不得单独导致 `skipped_cases` 失败。
9. 一致性错误优先级高于覆盖率 / AC 追溯的普通失败诊断，因为结果账本不可信时覆盖率和通过率都不可作为放行依据。

### 诊断

- `invalid_test_result_json`：JSONL 行不可解析或不是对象。
- `invalid_test_result_schema`：缺少 `id` / `status`，或 `fail` 缺少 `error`。
- `invalid_test_result_status`：`status` 不属于 `pass` / `fail` / `skip`。
- `unknown_test_result_id`：结果 ID 不在自动化测试规格中。
- `manual_test_result_id`：结果 ID 对应 `[manual]` 用例。
- `result_count_mismatch`：统计守恒不成立。
- `executed_exceeds_defined`：执行数大于定义数。

## EX-7.1: 结果账本统计不自洽

- **触发条件**：去重后的结果集合出现 `passed + failed + skipped != executed`、`executed > defined`，或 `failed=0 && passed + skipped != executed`。
- **期望响应**：verify FAIL，`gate.reason` 为 `result_ledger_inconsistent` 或等价具体错误码；JSON 输出包含 `consistency.ok=false` 与具体不变量失败原因；不得写入 `VERIFY_PASS`。

## EX-7.2: JSONL 含非法结果状态

- **触发条件**：某条结果记录的 `status` 不是 `pass`、`fail` 或 `skip`。
- **期望响应**：verify FAIL，诊断 `invalid_test_result_status`；该记录不得被算作通过、失败或跳过，也不得让 Gate PASS。

## EX-7.3: JSONL 含未定义或 manual 用例 ID

- **触发条件**：结果记录 ID 不存在于自动化测试规格，或对应 `[manual]` 用例。
- **期望响应**：verify FAIL，诊断 `unknown_test_result_id` 或 `manual_test_result_id`，并列出相关 ID；不得因为 defined 用例均 pass 就忽略额外污染结果。

## EX-7.4: 合法 skip 不阻塞 verify Gate

- **触发条件**：已定义自动化用例全部被覆盖，其中部分结果为 `status:"skip"`，且无 `fail`、无 unknown ID、无 manual ID、无 schema 错误。
- **期望响应**：verify PASS；`skipped_count` 与 `skipped_cases` 正常展示；`pass_rate_pct` 为 100；不得返回 `gate.reason="skipped_cases"`。

## EX-7.5: 同一用例 ID 多条记录按 timestamp 去重

- **背景**：contract-self-description（C6）将同 ID 去重从「文件行序 last-wins」改为「按最新 `timestamp` 去重」。守恒不变量在去重后计算，既有 `consistency` 契约不变。
- **触发条件与期望响应**（测试必须覆盖混合情况）：
  1. **乱序追加**：该 ID 全部记录时间戳合法、但文件行序与时间顺序不一致 → 按绝对时刻比较取最新记录生效；
  2. **异时区同刻**：不同时区表示的同一绝对时刻（如 `2026-07-17T10:00:00+08:00` 与 `2026-07-17T02:00:00Z`）→ 视为同刻，文件行序后者优先；
  3. **缺失+合法混排**：该 ID 存在任一缺失 `timestamp` 的记录 → 该 ID 整组退回文件行序 last-wins（等价旧行为，旧 reporter 产物零行为变化）；
  4. **非法格式**：`timestamp` 存在但非合法 ISO 8601 → 按「缺失」处理，同上整组退回文件行序 last-wins。
- **副作用**：去重仅决定同 ID 的生效候选；一致性校验、守恒不变量与 Gate 规则在去重后照常计算，不因去重规则变化而放宽。

## smoke 覆盖预检步骤

在 Step 7 读取测试用例与结果之后、Step 8 计算验收指标之前，`openlogos verify` 或 code completion gate 应增加 smoke 覆盖预检：

```mermaid
sequenceDiagram
    participant C as OpenLogos CLI
    participant P as Proposal Workspace
    participant S as Smoke Specs
    participant R as Smoke Results

    C->>P: Step 7a: 读取活跃提案 delta / merged spec
    C->>S: Step 7b: 提取新增或修改的 SMOKE-* ID
    C->>R: Step 7c: 读取 smoke.result_path
    C->>C: Step 7d: 校验 runner / reporter / dispatcher 覆盖
    alt 新增 smoke ID 全部可执行
        C->>C: Step 8: 继续计算 verify Gate
    else runner 或 reporter 缺失
        C-->>P: Step 8: 输出 smoke 覆盖诊断并阻止 code 完成
    end
```

### 规则
1. 预检只针对当前提案新增或修改的 smoke 用例；历史未执行 smoke 用例仍由部署后 `openlogos smoke` 统一判定。
2. 新增 smoke 用例 ID 来自 `logos/changes/<slug>/deltas/test/smoke/*.md`，merge 后也可从 `logos/resources/test/smoke/*.md` 与变更范围推导。
3. 若新增 `SMOKE-*` ID 没有对应执行结果，且无法发现 runner/dispatcher 接入证据，预检必须返回失败诊断。
4. 预检不得伪造 `SMOKE_PASS` / `SMOKE_FAIL`，不得替代部署后 `openlogos smoke`。

### 诊断
- `smoke_runner_missing`：找不到当前提案新增 smoke 用例对应 runner 或 dispatcher 注册。
- `smoke_reporter_missing`：runner 存在但没有写入 `smoke.result_path`。
- `smoke_cases_uncovered`：结果文件存在但缺少新增 `SMOKE-*` ID。

## verify 结果与 reporter 证据分层

### 目标

`openlogos verify` 的结果必须支持自动 driver 区分局部切片证据与全量回归结论。focused tests / reporter pass 证明某个切片的指定测试已执行通过；acceptance report 的全量失败证明仍需要 repair。二者不是互斥关系。

### 时序补充

```mermaid
sequenceDiagram
    participant A as Agent
    participant R as Reporter
    participant V as openlogos verify
    participant D as Driver

    A->>R: 写入本片 UT/ST pass 记录
    D->>V: 运行全量 verify
    V-->>D: 输出 failed_tests 与 acceptance report
    alt 本片 reporter pass 且全量 verify failed
        D-->>D: 标记 slice_done_global_verify_failed
        D-->>A: 派发 repair / code，附 failed_tests
    else reporter / focused tests 缺失
        D-->>A: 重派当前切片或补 reporter
    else 全量 verify pass
        D-->>D: 进入后续流程
    end
```

### 规则

- `test-results.jsonl` 中存在本片要求的 test ID 且均 pass 时，可作为本片 focused tests 通过证据。
- acceptance report 中存在失败用例时，应输出 `global-verify-failed` 与失败用例列表。
- 本片 focused tests pass + global verify failed 时，不得输出 `claimed-done-but-unverified`。
- verify JSON / report 应为 driver 暴露足够字段，避免 driver 解析自然语言报告。

### 异常路径

- reporter 缺失对应 test ID：输出 `reporter-missing` 或 `focused-tests-missing`。
- acceptance report 失败但没有失败测试列表：输出 `global-verify-failed` 并附 `driver-cannot-validate-artifacts` 或等价诊断，提示补充结构化失败证据。

## verify 诊断与后续前沿传播边界

`openlogos verify --format json` 可以在本次验收失败时输出 `automation_diagnostic`，包括 `global-verify-failed`、失败测试列表、缺失 reporter、缺失 focused tests 等结构化原因。该诊断用于解释 verify 结果，并为实现/验证闭环中的 repair 提供输入。

verify 诊断不得无条件传播到后续 `status` / `next` 的所有前沿。传播规则如下：

1. 若当前活跃提案仍处于 plan/spec/merge/slice 未完成前沿，历史 verify 诊断只能作为只读背景信息或被省略，不得覆盖当前前沿。
2. 若当前活跃提案处于 `coding`、`ready-to-verify` 或 `verify-failed`，且存在本轮切片 artifacts、reporter 与 focused tests 证据，`global-verify-failed` 可以驱动 repair/code。
3. 若失败证据属于上一提案、上一轮已离开的 flow 阶段或过期 acceptance report，`status` / `next` 不得把它提升为当前提案的 `suggested_next_node:"code"`。

该边界不削弱 verify 本身的诊断能力；它只限制诊断在非当前前沿中的跨阶段抢占。

## 切片 checkpoint 与 final verify 时序

### 目标

在多切片实现期只验收当前可交付集合，并在全部切片通过后执行最终全量验收；任何模式都不得伪造未来测试结果。

### 参与者

- 用户或自动化宿主
- OpenLogos CLI
- SliceVerificationService
- 测试 runner / OpenLogos reporter
- manifest、checkpoint、marker 与 loop 账本

### 前置条件

- 活跃 launched 提案已完成 spec-complete 与切片规划。
- `TEST_SLICE_MANIFEST.json` 有效；若无效则转 S28/S32 恢复路径。
- 测试规格中的 UT/ST/SMOKE ID 已定稿。

```mermaid
sequenceDiagram
    actor Caller as 用户/宿主
    participant CLI as openlogos verify
    participant SV as SliceVerificationService
    participant Runner as 测试 runner
    participant State as manifest/checkpoint/marker/loop

    Caller->>CLI: verify [--format json]
    CLI->>SV: 加载并校验 manifest + checkpoint
    alt 仍有未确认切片
        SV-->>CLI: mode=slice-checkpoint, attempted, eligible, pending
        CLI->>Runner: 以 runner_selectors 执行 eligible 测试
        Runner-->>CLI: reporter JSONL
        alt eligible 全覆盖且通过
            CLI->>State: 追加 slice PASS checkpoint
            CLI->>State: 清除本 slice 的 VERIFY_FAIL
            CLI-->>Caller: checkpoint PASS，不写 VERIFY_PASS
        else eligible 真实失败
            CLI->>State: 写 VERIFY_FAIL + LOOP_ITERS(attempted_slice_id)
            CLI-->>Caller: checkpoint FAIL，repair 锁定同一 slice
        end
    else 所有切片已确认且任务完成
        SV-->>CLI: mode=final, eligible=全部定义, pending=[]
        CLI->>Runner: 执行全量测试
        Runner-->>CLI: reporter JSONL
        alt 全量通过
            CLI->>State: 写 VERIFY_PASS，清 VERIFY_FAIL
            CLI-->>Caller: final PASS
        else 全量失败
            CLI->>State: 写 VERIFY_FAIL + final LOOP_ITERS
            CLI-->>Caller: final FAIL
        end
    end
```

### 步骤说明

1. verify 在运行任何测试前校验 manifest 和 fingerprint。
2. 服务以有效 PASS checkpoint 恢复 attempted slice，不读取“下一未勾 checkbox”决定身份。
3. checkpoint 运行基线回归、已确认切片与 attempted slice；未来切片只进入 pending。
4. CLI 按 eligible 集合执行既有结果合法性、去重、覆盖和通过率硬门。
5. checkpoint PASS 仅追加检查点；final PASS 才写最终 marker。

### 异常与边界

- manifest 缺失/可恢复失效：测试不启动，转 `plan-slices`，不写失败事实。
- reporter 出现 pending ID：视为结果越界并失败，不把它吸收入 eligible。
- checkbox 已勾但 checkpoint 未通过：attempted identity 保持不变。
- checkpoint 重试得到相同 PASS：幂等，不追加重复有效事实。
- final 发现任何未覆盖 ID：全量失败，绝不改列 pending。

### 追溯

- 需求：S13/S16/S27/S31 多切片验收边界。
- 规格：功能规格 §2.37；`spec/test-slice-manifest.md`。
- 测试：UT-S13-56～UT-S13-64、ST-S13-15～ST-S13-17。

## S13 权威测试 ID 语法放宽后的 defined 集合与覆盖度口径

### 场景目标

明确测试 ID 语法放宽后，verify 的 `defined` / `eligible` / `pending` 集合如何变化，以及覆盖度判据为何不因分母变大而放宽。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|---|---|---|
| V | `openlogos verify` | 验收门 |
| E | `extractDefinedVerificationIds` | 从已合并测试规格提取可验收 ID |
| G | 测试 ID 语法权威 | 表格首列读法的唯一来源 |

前置：已合并测试规格中存在 11 个 `UT-JSON-*` / `ST-JSON-*` 表格首列 ID（全部在 `core-S16-test-cases.md`）。

### 集合变化时序

```mermaid
sequenceDiagram
    participant V as verify
    participant E as extractDefinedVerificationIds
    participant G as 测试 ID 语法权威

    V->>E: Step 1: 求 defined 集合
    E->>G: Step 2: 以表格首列读法逐文件提取（排除 smoke/ 目录）
    G-->>E: Step 3: 放宽后的语法接纳 JSON 系 ID
    E-->>V: Step 4: defined 集合较此前增加 11 项
    V->>V: Step 5: eligible = defined 减去未确认切片的 pending
    V->>V: Step 6: 覆盖度 = executed ∩ eligible / eligible
```

**Step 4 的变化方向只增不减**：不存在此前进入 defined、此后被排除的 ID。

**Step 6 的判据不变**：覆盖度与通过率的公式、100% 的门槛、`failed==0` 的要求全部保持。分母变大意味着**这 11 个用例此后必须真实执行并报告**——它们对应的测试代码本就存在（`cli/test/s16-json-output.test.ts` 引用 37 处），此前只是没被计入统计。

### 为何这是修复而非加严

这些用例一直在跑、也一直在通过，只是 verify 看不见它们：

| | 此前 | 此后 |
|---|---|---|
| 测试代码是否执行 | 是 | 是 |
| 是否计入 defined | **否** | 是 |
| 改动是否受切片归属约束 | **否** | 是 |
| 缺失时是否被 verify 发现 | **否** | 是 |

所以放宽语法不是把标准降低，而是**把一批一直在暗处的用例纳入统计口径**。若其中某条实际未被执行，verify 会立刻报为未覆盖——那是它本就该被发现的状态。

### 不变量

1. `defined` 集合的提取判据只有一处，即权威语法的表格首列读法。
2. 语法放宽只增不减；ID 一旦进入 defined 集合，不得因语法调整而静默移出。
3. 覆盖度与通过率的判据不因分母变化而放宽。
4. `smoke/` 目录仍被排除在 `defined` 之外——smoke 由独立的 Gate 3.8 统计。

### 异常与边界

- 放宽后某 JSON 系 ID 未被任何测试报告：verify 判其未覆盖并阻断，这是正确行为。
- 该批 ID 无场景号，不影响切片归属——归属以切片的 `owned_test_ids` 为准，不依赖 ID 中的场景编号。

### 追溯

- 需求：AC-MERGEGATE-08、AC-MERGEGATE-09。
- 功能规格：§2.51.7；架构：§四十一.6.1。
- 测试：UT-S13-65～UT-S13-66、ST-S13-18。

## S13 人工用例判据的声明位与一致性判据的输入

### 场景目标

本节把两件事各自钉到一个判据上：**「某 ID 是不是人工用例」只看标记的声明位**，
**「账本是否自洽」只看精确计数**。前者此前有两套读法，后者此前消费的是舍入后的展示值，
两者叠加使一个零失败、100% 覆盖的下游提案被 Gate 3.5 拒收。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|---|---|---|
| V | `openlogos verify` | 验收门与统计器 |
| M | manual 判定 | 判断某表格行是否声明为人工用例 |
| C | 计数一致性判据 | `buildVerifyCountMismatches` 一族 |
| R | 验收报告渲染 | `acceptance-report.md` 的 Summary |

前置：已合并测试规格中存在一条**首格干净、描述列含裸 `[manual]` 字面量**的自动化用例
（典型情形：「manual 标记排除」这条能力自己的元用例），且其结果已按正常路径写入账本。

### 判定时序

```mermaid
sequenceDiagram
    participant V as verify
    participant M as manual 判定
    participant C as 一致性判据
    participant R as 报告渲染

    V->>M: Step 1: 逐行求「是否人工用例」
    M->>M: Step 2: 只读首格中 ID 之后的标记（[manual] / [manual/<平台>]）
    Note over M: 描述列等叙述文本一律不参与判定
    M-->>V: Step 3: 同一集合供 defined / executed / passed / uncovered 共用
    V->>C: Step 4: 送入精确计数（covered、defined、passed、failed、skipped、executed）
    C->>C: Step 5: 以计数比较判自洽，不读 coverage_pct / pass_rate_pct
    C-->>V: Step 6: 矛盾时点名两个相互矛盾的计数器取值与来源
    V->>R: Step 7: coverage_pct / pass_rate_pct 仅用于展示
```

**Step 2 的方向只收不放**：收敛后被排除的集合是收敛前的**子集**——原先因整行匹配而被误排除的
用例回到统计口径内，真人工用例的判定逐字不变。

**Step 5 与 Step 7 的分工是本节的要点**：判定消费事实，展示消费格式化后的值；
一旦判定去读展示值，`Math.round` 就会把「差一条未覆盖」这种自洽状态塌缩成矛盾。

### 为何这是修复而非加严

被误排除的那条用例一直在跑、也一直在通过，只是统计口径把它当人工用例丢掉了：

| | 此前 | 此后 |
|---|---|---|
| 测试代码是否执行 | 是 | 是 |
| 是否计入 `defined` | 视判据而定（两套读法互相矛盾） | 是（单一判据） |
| 是否计入 `executed` | **否**（被整行匹配排除） | 是 |
| 是否计入 `passed` | 是（该计数器不过滤） | 是 |
| Gate 结论 | ❌ 账本自相矛盾 | 按真实通过率判定 |

所以收敛判据不是降低标准，而是**让四个计数器数同一件事**。

### 不变量

1. **声明位唯一**：人工用例的标记只在测试用例表**首格** ID 之后声明；其余列出现的标记字面量是
   叙述文本，不参与判定。
2. **判定单一事实源**：`defined` / `executed` / `passed` / `skipped` / `uncovered` 与报告渲染
   消费同一个判定函数；任一计数器自带一套读法即为回归。
3. **只收不放**：收敛后的人工集合必须是收敛前的子集；不得有任何原先计入统计的 ID 被新判据排除。
4. **一致性判据只消费精确计数**：覆盖与通过的自洽判定用计数比较；把展示精度改成任意位数
   都不得改变任何判定结论。
5. **判定强度零放宽**：结果含未定义 ID 或人工 ID、真实计数不等、存在未覆盖用例，
   这些情形仍按既有诊断码判 FAIL。
6. **矛盾必须可自证**：报告内部矛盾时，诊断点名两个相互矛盾的计数器**取值与来源**，
   不得只给一个笼统结论——否则 CLI 自身的算术分叉会被归咎于下游账本。

### 异常与边界

#### EX-7.6: 首格干净、描述列含裸标记字面量

- **触发条件**：某自动化用例首格为纯 ID，描述列出现裸 `[manual]` 字面量。
- **期望响应**：该 ID 正常计入 `defined` 与 `executed`，`passed + failed + skipped == executed`；
  Gate 按真实通过率判定，不产出任何计数矛盾诊断。
- **副作用**：无。

#### EX-7.7: 覆盖差一条而真实覆盖率四舍五入为 100%

- **触发条件**：`covered == defined - 1` 且 `defined` 足够大（真实覆盖率 ≥ 99.5%）。
- **期望响应**：判 `uncovered_count == 1` 并逐个点名，**不得**产出
  `coverage_full_with_uncovered`——那条判据的输入必须是计数而非舍入后的百分比。
- **副作用**：无；展示仍可显示 100%（展示与判定分离）。

#### EX-7.8: 真人工用例的判定不得被收敛波及

- **触发条件**：首格带 `[manual]` 或 `[manual/<平台>]`。
- **期望响应**：仍被排除在 `defined` 与 `executed` 之外；若其 ID 出现在结果中，
  仍按既有 `manual_test_result_id` 判 FAIL。
- **副作用**：无。

#### EX-7.9: 修复未进入安装态

- **触发条件**：仓内源码已修，但本机全局安装态仍是旧版本。
- **期望响应**：安装态 smoke 判 FAIL——下游消费的是安装态，源码修好不等于阻塞解除。
- **副作用**：无；回滚为重装上一版本。

### 追溯

- 需求：`AC-VERIFY-MANUAL-01～04`、`AC-VERIFY-COUNT-01～03`。
- 同源章节：本文档 >「verify 结果与 reporter 证据分层」、
  >「S13 权威测试 ID 语法放宽后的 defined 集合与覆盖度口径」。
- 测试：`core-S13-test-cases.md`（UT-S13-69 起、ST-S13-20 起）；
  部署后 smoke：`core-smoke-test-cases.md`（SMOKE-core-208 起）。

## S13 沙箱复用与增量同步时序

> 来源变更：verify-sandbox-reuse-0-16-1（决策 C01～C05）；功能规格 §2.91。本节细化 S13 主时序 Step 3～6 中「Sandbox Executor」在 `sandbox_reuse` 生效时的内部步骤；主时序其余步骤、门禁判据与 EX-3.1～EX-3.4、EX-9.x 不变。

### 场景目标

`verify.sandbox_mode` 为 `auto` / `always` 且 `verify.sandbox_reuse` 未设为 `false` 时，预跑命令在**每项目一份的持久沙箱**中执行：路径稳定、mtime 保真、构建产物留存，让项目构建工具的增量编译生效；隔离不变量与一次性沙箱逐条相同。

### 参与者

- **CLI**：`openlogos verify`。
- **Sandbox Executor**：`runSandboxedCommand`。
- **Lock**：持久沙箱项目目录下的 `lock/` 世代锁记录。
- **Workspace Generation**：当前工作区世代 `ws-<世代号>/`（`workspace/` + `sync-manifest.json`）。
- **Test Runner**：项目的预跑命令及其构建工具。

### 时序

```mermaid
sequenceDiagram
    participant C as OpenLogos CLI
    participant X as Sandbox Executor
    participant L as Lock (lock/gen-*)
    participant W as Workspace Generation
    participant T as Test Runner

    C->>X: Step R1: 执行预跑命令（sandbox_reuse 生效，可带 --fresh-sandbox）
    X->>X: Step R2: 定位项目目录 <sandbox_root>/openlogos-cli-sandbox-reuse-<hash16>/，校验其不在项目根内
    X->>L: Step R3: 读最大世代 N 并判定分支，在发布前确定本轮目标世代 ws
    alt N 已 released 且旧写入者存活检查复查通过，且未带 --fresh-sandbox
        X->>L: Step R4a: 记录 {token,pid,ws=gen-N.ws} 经 link() 排他创建 gen-<N+1>（reused）
    else 无记录 / N 未释放且 pid 确认不存在 / N 已 tainted / 复查不通过 / 带 --fresh-sandbox
        X->>L: Step R4b: 记录 {token,pid,ws=ws-<N+1>} 经 link() 排他创建 gen-<N+1>（created / recovered / fresh）
    else N 未释放且 pid 存活 / 无法确认，或 link() 失败
        X-->>C: Step R4c: 退回一次性临时沙箱（busy-fallback），按既有一次性流程执行
    else 文件系统不支持 link() / 平台无进程组探测或运行标记扫描
        X-->>C: Step R4d: 退回一次性临时沙箱（unsupported）
    end
    X->>W: Step R5: 发布成功后建立目标世代：新名则新建空目录；fresh 且旧世代 released 并复查通过才删除旧世代，否则列入 abandoned
    X->>W: Step R6: 镜像同步（ctime 指纹 + racy 判定，否则逐字节比较；跳过缓存路径；删除多余）
    X->>W: Step R7: 原子写入 sync-manifest.json
    X->>W: Step R8: 逃逸 symlink 扫描（含缓存路径）、建立运行期写保护、拍基线快照
    X->>T: Step R9: 在 workspace/ 中以独立进程组（pgid）并注入运行标记 OPENLOGOS_SANDBOX_RUN 执行命令，转发中断信号
    T-->>X: Step R10: 写入结果文件与构建产物；主进程退出
    X->>X: Step R10a: 旧写入者存活检查——kill(-pgid, 0) 探测进程组 + 扫描带本世代运行标记的存活进程
    X->>W: Step R11: 写入审计、白名单定点回收到原工作区
    X->>L: Step R12: 检查通过 → 排他创建 gen-<本号>.released；不通过 / 无法完成 → 排他创建 gen-<本号>.tainted
    X-->>C: Step R13: 返回命令结果与 sandbox（含 reuse）
```

### 步骤说明

1. **R1**：两阶段模型下回归、增量两段各走一次本时序；第二段命中第一段刚释放的世代（`reused`）。
2. **R2**：项目目录名取项目根 realpath 的 SHA-256 前 16 位十六进制；位于项目根内时按「无法创建沙箱」处理（EX-3.10）。
3. **R3～R4**：世代锁规则见功能规格 §2.91.6。目标世代在发布前确定并随锁记录一起原子发布，`gen-<N+1>.ws` 即本轮实际使用的世代；发布后不再改写锁记录。已用世代号永久占位，锁记录在 CLI 中从不删除、不复用、不压缩；获取以 `link()` 排他创建成功为准。
4. **R5**：目录操作只在发布成功后进行。`--fresh-sandbox` 删除旧世代的条件与 `reused` 判定同一（`released` 且旧写入者存活检查复查通过），否则保留并列入 `abandoned`（EX-3.9）。发布后、同步完成前中断时，下次按「未释放且 pid 确认不存在」新建世代（EX-3.7）。
5. **R6～R7**：同步规则见功能规格 §2.91.4，内容同步后对 `mode`、`mtime` 不一致的副本原位整定（不重写字节、不换 inode），整定后才记录指纹。verify 已在 R1 之前清空结果文件，清空状态经同步进入沙箱；只复用旧写入者存活检查通过（进程组已空且无带该世代运行标记的存活进程）的世代，上次运行及其后代写出的结果不会被回收为本次结果（EX-3.7、EX-3.8）。
6. **R8～R11**：与一次性沙箱完全相同——逃逸 symlink 按「无法隔离」处理（EX-3.4，持久世代内残留的同样适用），运行期写保护按能力分层，非白名单写入（含缓存路径内的写入）`auto` 告警、`always` 失败，依赖目录豁免不变，白名单定点回收不变。
7. **R9～R12**：命令置于独立进程组并注入运行标记，CLI 收到的 SIGINT / SIGTERM / SIGHUP 转发给该组。主进程退出后做旧写入者存活检查：通过写 `released`；进程组仍有成员（如关闭继承 stdio 的后台进程）、扫描到带运行标记的存活进程（如 `setsid` / `detached` 脱组的后台进程）或无法完成检查写 `tainted`，不杀进程、不删目录，下一轮新建世代（EX-3.7）。命令失败、审计失败也照此释放；CLI 被强杀则不释放，下次运行按「未释放且 pid 确认不存在」新建世代。
8. **R13**：`sandbox.reuse` 字段见 `spec/cli-json-output.md`「verify / smoke `sandbox.reuse` 沙箱复用字段」；复用摘要经 `sandbox.infos` 以 `ℹ️` 输出一行，不影响 `sandbox.status`。

### 异常用例

#### EX-3.5: 等长改写且 mtime 被保留

- **触发条件**：① 工作区源文件被等长改写，mtime 与权限保持不变（如保留时间戳的恢复 / 复制）；② 上轮命令在沙箱副本中等长改写源文件并恢复其 mtime。
- **期望响应**：两种情形下该文件的 `ctime` 均已变化，与同步清单不符，必然进入逐字节内容比较并以工作区内容覆盖；本轮命令读到的是工作区的实际内容。仅凭大小 + mtime 跳过复制的实现在此必红。

#### EX-3.6: 两个进程竞争同一世代

- **触发条件**：① 两个进程同时读到同一个「未释放且持有者已死」的最大世代 N 并交错获取；② 三方交错：A 读到已释放的世代 N 后暂停于 `link()` 前，B 取得并释放 N+1，C 取得 N+2 并运行，随后恢复 A。
- **期望响应**：① 至多一方 `link(gen-<N+1>)` 成功，另一方 `busy-fallback`；② A 的 `link(gen-<N+1>)` 命中已存在编号而失败，按占用退回一次性沙箱；任何时刻同一工作区世代至多一个持有者；`lock/` 下已用编号的记录全部保留；旧持有者的释放不能使新持有者的锁失效。

#### EX-3.7: 旧写入者跨轮残留

- **触发条件**：① 上一轮 CLI 被超时强杀或单独终止，其测试 / 编译子进程仍在旧世代内写入，锁未释放、持有者 pid 已不存在；② 上一轮命令主进程正常退出，但启动了后台进程——②a 关闭继承 stdio、仍在命令进程组内；②b 以 `setsid` / Node `spawn(..., {detached:true, stdio:"ignore"})` 并 `unref` 脱离进程组——该进程在下一轮清空结果之后、回收之前向结果路径写入旧的全 pass 账本；③ 发布锁记录后、目标世代同步完成前 CLI 被杀。
- **期望响应**：① 上一世代未释放且 pid 确认不存在；② 上一轮主进程退出后的旧写入者存活检查不通过——②a 进程组仍有成员，②b 进程组已空但运行标记扫描命中脱组后代——释放写为 `tainted`；若后代在释放时尚未被调度、释放后才出现，下一轮发布前的复查同样命中；③ 同 ①。三者本轮均以新世代号获取锁，锁记录 `ws` 即新建的空工作区世代，全量同步（`recovered`），对旧世代不同步、不改写、不删除；旧世代（③ 中若半成品目录已存在）列入 `sandbox.reuse.abandoned` 并在文本输出提示确认无进程使用后手动清理；旧写入者写出的结果只落在旧世代，不会被回收为本轮结果——② 中本轮命令不写结果时，门禁必须 FAIL。执行器不终止残留进程。

#### EX-3.8: 上轮结果文件残留在沙箱

- **触发条件**：上一轮命令在沙箱中写过结果文件；本轮命令异常，未写任何结果。
- **期望响应**：verify 预先清空的结果文件经同步覆盖沙箱副本，回收得到的是空结果；门禁按空结果判定（如 `pre_run_failed` / `incomplete_coverage`），不会因旧结果而 PASS。

#### EX-3.9: `--fresh-sandbox` 与占用 / 非正常退出

- **触发条件**：带 `--fresh-sandbox` 执行 verify，分别处于：锁已释放；锁被存活进程持有；上一轮非正常退出且后代仍在写。
- **期望响应**：锁已释放（`released` 且旧写入者存活检查复查通过）→ 锁记录 `ws` 写为新世代名后发布，新建空世代全量同步，发布成功后删除被替换的旧世代，`state=fresh`，下一轮普通运行读到的锁记录 `ws` 即该新世代并 `reused`；锁被占用 → `busy-fallback`，不删除任何世代；非正常退出、`tainted` 或复查不通过 → 新建空世代，旧世代保留并列入 `abandoned`。

#### EX-3.10: 无法复用的环境

- **触发条件**：① 持久沙箱项目目录位于项目根之内；② `sandbox_root` 所在文件系统不支持 `link()`（如 exFAT），或当前平台不具备进程组探测或运行标记扫描能力（如 Windows）；③ 工作区含 socket / FIFO 等特殊文件。
- **期望响应**：① 与 ③ 按「无法创建沙箱」处理（`auto` 降级为非隔离执行并告警，`always` 失败），与一次性沙箱口径一致；② 退回一次性临时沙箱（`state=unsupported`）并在 `sandbox.infos` 给出信息级说明，`sandbox.status` 不因此改变。

#### EX-3.11: 非法缓存路径

- **触发条件**：`verify.sandbox_cache_paths` 含绝对路径、含 `..`、为空或项目根，或与任一白名单结果路径相同 / 为其祖先 / 为其后代（如 `logos/resources/verify`）。
- **期望响应**：该项被忽略，`sandbox.diagnostics` 点名该项与原因，`sandbox.status` 至少为 `warn`；该路径按普通镜像路径同步，结果文件不会跨运行留存。合法缓存路径照常生效。

#### EX-3.12: 关闭复用与关闭沙箱

- **触发条件**：① `verify.sandbox_reuse=false`；② `verify.sandbox_mode=off`。
- **期望响应**：① 走一次性临时沙箱，行为与引入复用前逐字一致，仅 `sandbox.reuse` 为 `{enabled:false, state:"disabled", …}`；② 行为与输出逐字不变，不出现 `sandbox.reuse`；两者下 `--fresh-sandbox` 无效果、不报错。

### 追溯

- 功能规格：§2.91（复用）、§2.9（隔离不变量）、§2.7（结果文件清空与预跑失败判定）。
- 测试：UT-S13-89～UT-S13-100、ST-S13-25。
- 根规范：`spec/cli-json-output.md`「verify / smoke `sandbox.reuse` 沙箱复用字段」；`spec/test-results.md`「沙箱复用配置」。

## S13 Linux 运行标记扫描与环境不可读进程

> 来源变更：fix-sandbox-reuse-linux-liveness（决策 C01、C02）；功能规格 §2.92。本节细化「S13 沙箱复用与增量同步时序」Step R9～R12 中旧写入者存活检查在 Linux 上的判定，时序其余步骤不变。

### 步骤补充

1. **R9 之前**：执行器在 Linux 上读取 `/proc/uptime` 记录本世代命令启动时刻（§2.92.3）。
2. **R10a**：运行标记扫描遇到同用户、environ 不可读的存活进程时，读取其 `/proc/<pid>/stat` 启动时刻，早于「命令启动时刻 − 1 秒」即跳过，否则判无法完成扫描（§2.92.2）。
3. **R12**：释放记录写入 `command_started_uptime`；下一轮 R3 对 `released` 世代的复查与 `--fresh-sandbox` 删除条件使用该值；旧记录缺该字段时按保守口径处理（§2.92.4）。

### 异常用例

#### EX-3.13: Linux 上存在环境不可读的同用户进程

- **触发条件**：Linux 上与 CLI 同用户的进程中存在不可转储进程（`/proc/<pid>/environ` 读取 EACCES），分四种情形：① 该进程的启动时刻早于「本世代命令启动时刻 − 1 秒」（如早已运行的 Electron 沙箱渲染进程）；② 该进程在命令启动前不足 1 秒内启动（处于容差内），或其启动时刻无法读取；③ 该进程由本世代命令启动并脱离命令进程组，命令退出后仍存活；④ 上一轮释放记录缺 `command_started_uptime`（旧版写入），本轮复查时存在情形 ① 的进程。
- **期望响应**：① 该进程被跳过，存活检查通过，释放写 `released`，下一轮 `reused`；② 按保守口径判无法完成扫描，释放写 `tainted`，下一轮 `recovered`——容差保护不得为通过而放宽；③ 进程组探测已空，运行标记扫描对该后代判无法完成扫描（原因点名其 pid），释放写 `tainted`，下一轮 `recovered`，旧世代列入 `abandoned`，不删除；④ 本轮复查判不通过，新建世代（`recovered`），本次释放写入新字段后，后续轮次恢复 `reused`。macOS 不出现本情形（经 setuid `/bin/ps` 读取）。

### 追溯

- 功能规格：§2.92、§2.91.6。
- 测试：UT-S13-101、UT-S13-102、ST-S13-26。

## S13 按模块限定范围的 verify

> 来源变更：module-scoped-verify（决策 C01、C02；review F1、F2 处置）。功能规格 §2.96；规范 `spec/test-results.md`「按模块限定 verify 范围的运行约定（module-scoped-verify）」、`spec/test-slice-manifest.md` §7、`spec/cli-json-output.md`（`scope`）。

### 场景目标

一个仓库按模块承载多个子系统时，提案 verify 只执行、只核对受本提案影响的模块（及全局）测试，跨模块改动覆盖每个受影响的模块；判断不了归属时回落全量，不降级测试门。未启用模块范围的项目（单模块，或没有任何模块声明 `paths`）行为完全不变。

### 参与者

- 用户或自动化宿主（RunLogos driver）
- OpenLogos CLI（`openlogos change`、`openlogos verify`）
- 范围计算（ScopeResolver）：读取 `logos-project.yaml`、guard、提案 delta 与 git 差异
- 测试 runner 与 OpenLogos reporter（按模块命令执行）
- 切片服务（SliceVerificationService）与结果账本

### 前置条件

- 项目已登记多个模块；至少一个模块在 `modules[].paths` 声明了代码目录（否则走「未启用」分支）。
- 活跃提案由新版 `openlogos change` 创建，guard 记有 `baseRef`；项目为 git 仓库。
- 测试规格文件按 `<module>-SXX-test-cases.md` 命名；可选地为部分模块配置 `verify.modules.<id>` 命令。

### 成功后置条件

- 只执行了范围内模块的测试命令（相同命令组只执行一次），只核对范围内模块与全局测试规格中的用例；范围外结果被忽略并计数。
- verify JSON `data.scope` 记录范围、每个模块进入范围的依据与回落原因；验收报告 Summary 有「范围」行。
- 门禁结论（PASS / FAIL）、`VERIFY_PASS` / `VERIFY_FAIL` / `LOOP_ITERS` 语义与现有一致。

### 时序图

```mermaid
sequenceDiagram
    actor Caller as 用户/宿主
    participant Change as openlogos change
    participant CLI as openlogos verify
    participant Scope as ScopeResolver
    participant Git as git
    participant Runner as 模块测试命令/reporter
    participant SV as SliceVerificationService

    Caller->>Change: Step 1: change <slug>
    Change->>Git: Step 2: rev-parse HEAD
    Change-->>Caller: Step 3: guard 写入 activeChange + baseRef
    Caller->>CLI: Step 4: verify [--all] [--format json]
    CLI->>Scope: Step 5: 判断启用条件（--all / 单模块或无 paths / 进入计算）
    alt 未启用
        Scope-->>CLI: Step 6a: disabled（不计算范围）
        CLI->>Runner: Step 7a: 执行项目级命令（现有流程）
    else --all
        Scope-->>CLI: Step 6b: mode=all，modules=全部
    else 进入范围计算
        Scope->>Git: Step 6c: diff --name-status baseRef + 未跟踪文件
        Git-->>Scope: Step 7c: 改动文件集合
        Scope->>Scope: Step 8c: 流程产物豁免 → 共享配置按字段判断 → 规格前缀 → paths 归属
        Scope-->>CLI: Step 9c: mode=module（M、reasons）或 fallback-full（fallback_reason）
    end
    CLI->>SV: Step 10: baseline / eligible 与范围内用例求交
    CLI->>Runner: Step 11: 按命令组执行（注入 OPENLOGOS_VERIFY_MODULES、收窄后的 eligible）
    Runner-->>CLI: Step 12: 各阶段结果，按同 ID 规则合并
    CLI->>CLI: Step 13: 忽略范围外结果，计算门禁
    CLI-->>Caller: Step 14: 报告（含 scope 与「范围」行）、marker 与 LOOP_ITERS
```

### 步骤说明

1. **用户 / 宿主**执行 `openlogos change <slug>`（时序 Step 1）。
2. **openlogos change** 读取当时 `HEAD`（Step 2），在 guard 中写入 `activeChange` 与 `baseRef`（Step 3）；非 git 或无提交时不写 `baseRef`。
3. **用户 / 宿主**执行 `openlogos verify`（Step 4）。
4. **ScopeResolver** 先判断启用条件（Step 5）：传 `--all` 时直接全量（Step 6b）；单模块或没有任何模块声明 `paths` 时不启用，CLI 按现有流程只执行项目级命令、不输出 `scope`（Step 6a、7a），跳到第 8 步的门禁计算。
5. **ScopeResolver** 取 `baseRef` 到工作区的差异与未跟踪文件（Step 6c、7c），按「流程产物豁免 → 共享验收配置按字段判断（相关变化或无法判断时回落，只有无关变化时该文件不参与后续分类；见「S13 共享验收配置按字段判断」）→ `logos/resources/` 下模块前缀规格归属 → `paths` 归属」分类（Step 8c），与提案归属模块、delta 前缀模块合并为 M（Step 9c）；任一回落条件成立则 `fallback-full`。
6. **SliceVerificationService** 把 baseline、confirmed、attempted、eligible 与范围内用例求交（Step 10）。
7. **CLI** 为范围内模块选出命令组并去重，逐组执行，注入 `OPENLOGOS_VERIFY_MODULES` 与收窄后的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`（Step 11）；各阶段结果按同 ID 去重全序规则合并（Step 12）。
8. **CLI** 忽略范围外模块用例的结果行并计入 `out_of_scope_result_count`，按既有硬门计算门禁（Step 13），写报告、marker 与 `LOOP_ITERS`（Step 14）。

### 异常与边界

#### EX-10.1: 未启用模块范围的多模块项目上的纯规格提案（review F1）
- **触发条件**：多模块项目没有任何模块声明 `paths`；提案由新版 change 创建（有合法 `baseRef`），只改了某个模块前缀的 delta，改动文件集合为空。
- **期望响应**：不进入范围计算；defined、失败结果处理与命令选择与现有流程一致；JSON 不输出 `scope`，报告无「范围」行。
- **副作用**：无。

#### EX-10.2: 改动文件归不到任何模块
- **触发条件**：模块范围已启用，改动文件中有不属于流程产物、不是共享验收配置、不是带模块前缀规格、也不命中任何 `paths` 的文件。
- **期望响应**：`mode: "fallback-full"`，`fallback_reason.code: "unmapped_file"`，`detail` 给出首个文件与总数；按全部模块执行与核对。
- **副作用**：无。

#### EX-10.3: 共享验收配置被修改（review F2）

- **触发条件**：改动文件含 `logos/logos.config.json` 或 `logos/logos-project.yaml`，且按字段判断为相关变化——相关字段或清单未列出的字段有变化，或任一侧原文无法严格解析（功能规格 §2.96.3.1）。
- **期望响应**：回落全量，`fallback_reason.code: "shared_config_changed"`，`detail` 写明文件与变化的字段（无法判断时写明是哪一侧与原因）。只有无关字段变化时不回落，见「S13 共享验收配置按字段判断」EX-13.57。
- **副作用**：无。

#### EX-10.4: logos/ 下已声明归属的文件被修改（review F2）
- **触发条件**：`core` 的 `paths` 含 `logos/tools/**`，提案修改 `logos/tools/protocol-check.ts`。
- **期望响应**：`core` 进入范围，`reasons` 含 `{ module: "core", source: "path", ref: "logos/tools/protocol-check.ts" }`；只有 `PATH_CLASSES_V1` 的流程产物不参与判定。
- **副作用**：无。

#### EX-10.5: 提案起点不可用
- **触发条件**：guard 缺 `baseRef`、项目不是 git 仓库、`baseRef` 不可达，或差异计算失败。
- **期望响应**：回落全量，`fallback_reason.code` 依次为 `base_ref_missing`、`not_git_repository`、`base_ref_unreachable`、`diff_failed`。
- **副作用**：无。

#### EX-10.6: 模块命令失败
- **触发条件**：范围内某模块的命令组非零退出。
- **期望响应**：其余命令组照常执行；门禁以既有 `pre_run_failed` 失败，`pre_run.commands[]` 的 `modules` 与诊断点名该模块。
- **副作用**：写 `VERIFY_FAIL` 与失败的 `LOOP_ITERS`，与现有预跑失败相同。

#### EX-10.7: 跨模块提案
- **触发条件**：归属 `portal-web` 的提案还改了命中 `core` `paths` 的文件。
- **期望响应**：两个模块都进入范围，两组命令都执行；`reasons` 分别记录 `proposal` / `delta` 与 `path` 依据。
- **副作用**：无。

#### EX-10.8: `--all`
- **触发条件**：用户执行 `openlogos verify --all`。
- **期望响应**：不计算范围，`mode: "all"`，按全部模块执行与核对；未启用项目同样输出 `scope.mode: "all"`。
- **副作用**：marker 与 `LOOP_ITERS` 语义不变；archive 不要求做过 `--all`。

#### EX-10.9: `paths` 非法或 `verify.modules` 引用未登记模块
- **触发条件**：某模块 `paths` 以 `/` 开头、含 `..` 段或为空串；或 `verify.modules` 含未登记的模块 id。
- **期望响应**：前者回落全量（`module_paths_invalid`）；后者给出警告 `verify_module_unknown` 并忽略该项，不影响门禁。
- **副作用**：无。

### 追溯

- 需求：`core-01-requirements.md`「S13 按模块限定 verify 范围验收补充」。
- 功能规格：§2.96。
- 测试：`core-S13-test-cases.md`「S13 按模块限定 verify 范围测试」——UT-S13-104～UT-S13-121、ST-S13-27～ST-S13-32；smoke：SMOKE-core-280～284。

## S13 切片 checkpoint 的 owned 验收范围

### 场景目标

用例规模达到阈值的项目，多切片提案的每次 slice-checkpoint 只验收本片与已通过前序切片的 owned 用例，不再回归基线集 B；所有切片完成后由 final 跑一次全量回归。本子场景是「切片 checkpoint 与 final verify 时序」在 manifest 冻结 `verify_scope: "owned"` 时的分支；`baseline` 范围（含旧 manifest 缺该字段）沿用原时序，行为不变。

### 参与者

- **用户或自动化宿主**：执行 `openlogos verify`，读取 `status` / `next` 的 `slice_verification_state.verify_scope` 调整派发。
- **openlogos verify（CLI）**：读取 manifest 冻结的验收范围，计算 eligible / pending，注入环境变量，执行 Gate 并写报告。
- **SliceVerificationService**（`deriveSliceVerificationState()`）：按 `verify_scope` 分支计算集合，与 status / next 同源。
- **测试 runner / OpenLogos reporter**：据 `OPENLOGOS_VERIFY_SLICE_SCOPE` 与 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 只运行覆盖 eligible 的测试，只输出 eligible 内结果。
- **manifest / checkpoint 账本 / 验收报告**：`TEST_SLICE_MANIFEST.json`、`SLICE_CHECKPOINTS.jsonl`、`acceptance-report.md` 与多模块项目的 `<m>-acceptance-report.md`。

### 前置条件

- 活跃 launched 提案已 spec-complete，`openlogos slice plan` 已按 S32「S32 切片规划冻结验收范围时序」写出有效 manifest，且其 `verify_scope` 为 `owned`。
- 仍有未通过 checkpoint 的切片（存在 attempted slice A），或全部切片已通过且 `[code]` 全部勾选（进入 final）。

### 成功后置条件

- checkpoint：eligible 为 `owned(P) ∪ owned({A})`；基线 ID 不进入分母、不计 uncovered；PASS 追加绑定当前 manifest 身份的 checkpoint 行，不写 `VERIFY_PASS`；共用验收报告标明验收范围；模块验收报告字节不变。
- final：eligible 为全部已定义非 manual 用例 D，100% 覆盖、一致性与 `VERIFY_PASS` 规则与 `baseline` 范围相同，模块验收报告照常写出。

### 时序图

```mermaid
sequenceDiagram
    actor Caller as 用户/宿主
    participant CLI as openlogos verify
    participant SV as SliceVerificationService
    participant Runner as 测试 runner
    participant State as manifest/checkpoint/报告

    Caller->>CLI: Step 1: verify [--format json]
    CLI->>SV: Step 2: 校验 manifest 并读取冻结的 verify_scope（缺省 baseline）
    alt 仍有未确认切片
        SV-->>CLI: Step 3: mode=slice-checkpoint, eligible=owned(P)∪owned(A), pending=C−owned(P)−owned(A)
        CLI->>Runner: Step 4: 注入 OPENLOGOS_VERIFY_SLICE_SCOPE=owned 与收窄后的 OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS，执行预跑
        Runner-->>CLI: Step 5: reporter JSONL（只含 eligible 内结果）
        CLI->>CLI: Step 6: 按 eligible 执行覆盖、合法性、去重与通过率 Gate；基线 ID 结果判 result_outside_eligible_scope
        alt eligible 全覆盖且通过
            CLI->>State: Step 7a: 追加 PASS checkpoint，写共用报告（验收范围 owned），不写模块验收报告
            CLI-->>Caller: Step 8a: checkpoint PASS，不写 VERIFY_PASS
        else eligible 失败或越界
            CLI->>State: Step 7b: 写 VERIFY_FAIL + LOOP_ITERS(attempted_slice_id)，写共用报告，不写模块验收报告
            CLI-->>Caller: Step 8b: checkpoint FAIL，repair 锁定同一切片
        end
    else 所有切片已确认且任务完成
        SV-->>CLI: Step 9: mode=final, eligible=D, pending=[]
        CLI->>Runner: Step 10: 不注入 OPENLOGOS_VERIFY_SLICE_SCOPE，执行全量测试
        Runner-->>CLI: Step 11: reporter JSONL
        CLI->>State: Step 12: 全量 Gate；PASS 写 VERIFY_PASS，写共用报告与模块验收报告
        CLI-->>Caller: Step 13: final PASS / FAIL
    end
```

### 步骤说明

1. **用户或宿主**执行 `openlogos verify`；宿主可先从 `status` / `next` 的 `slice_verification_state.verify_scope` 得知本提案的验收范围。
2. **CLI** 在运行任何测试前校验 manifest，读取冻结的 `verify_scope`；字段缺省按 `baseline`，取值非法时 manifest 判 `test-slice-manifest-invalid`，转 S32 恢复路径，不启动 runner。
3. **SliceVerificationService** 在 `owned` 范围下计算 `eligible = owned(P) ∪ owned({A})`，pending 与 `baseline` 范围相同；启用模块范围时先与范围 S 求交，C 始终在 S 内，结果不变。
4. **CLI** 在执行预跑命令前注入 `OPENLOGOS_VERIFY_SLICE_SCOPE=owned` 与收窄后的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`；runner 据此只运行覆盖 eligible 的测试，ID 到测试文件的映射由项目 runner 自行决定。
5. **Runner** 通过 OpenLogos reporter 只输出 eligible 内的结果。
6. **CLI** 只按 eligible 执行既有 Gate；基线与 pending ID 的结果一律判 `result_outside_eligible_scope`。
7. **CLI** 在 PASS 时追加 checkpoint 行（身份含 `verify_scope: "owned"`）；PASS 与 FAIL 都写共用验收报告并标明验收范围；`owned` 范围的 checkpoint 不写、不改模块验收报告。
8. **CLI** 返回 checkpoint 结论；checkpoint PASS 不写 `VERIFY_PASS`，FAIL 锁定同一 attempted slice。
9. **SliceVerificationService** 在全部切片确认且 `[code]` 全部勾选时切换为 final，eligible 为 D。
10. **CLI** final 不注入 `OPENLOGOS_VERIFY_SLICE_SCOPE`，执行全量预跑。
11. **Runner** 输出全量结果。
12. **CLI** 以全量 Gate 裁决：100% 覆盖且通过才写 `VERIFY_PASS`；共用与模块验收报告照常写出。基线回归在此处第一次、也是唯一一次被验收。
13. **CLI** 返回 final 结论。

### 异常与边界

#### EX-11.1: owned 范围下 runner 输出基线用例结果
- **触发条件**：runner 未按 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 收窄，输出了基线用例的结果行。
- **期望响应**：既有越界规则不变，以 `result_outside_eligible_scope` 判 checkpoint FAIL，不把基线结果吸收入 eligible。
- **副作用**：写 `VERIFY_FAIL` 与带 `attempted_slice_id` 的 `LOOP_ITERS`，与其他 checkpoint 失败相同。

#### EX-11.2: 旧 manifest 没有 `verify_scope` 字段
- **触发条件**：升级前规划的在途提案，manifest 无 `verify_scope`。
- **期望响应**：按 `baseline` 处理，eligible 含 B，注入 `OPENLOGOS_VERIFY_SLICE_SCOPE=baseline`；判定实质身份与升级前相同，已确认 checkpoint 继续被采信。
- **副作用**：无。

#### EX-11.3: 多模块项目 owned 范围的 checkpoint
- **触发条件**：多模块项目，manifest 冻结为 `owned`，checkpoint 完成 Gate 裁决。
- **期望响应**：共用验收报告照常写；各 initial 模块的 `<m>-acceptance-report.md` 字节与修改时间不变（模块报告按完整 U(m) 统计，只验收 owned 时会把基线误报为未覆盖）。
- **副作用**：无；final 照常写模块验收报告。

#### EX-11.4: 后续切片改坏了前序切片
- **触发条件**：`owned` 范围下切片二的实现使切片一的 owned 用例失败。
- **期望响应**：切片二的 checkpoint eligible 含 `owned(P)`，切片一的用例失败使 checkpoint FAIL，repair 锁定切片二。
- **副作用**：写 `VERIFY_FAIL` 与 `LOOP_ITERS(attempted_slice_id=切片二)`。

#### EX-11.5: final 发现基线回归
- **触发条件**：`owned` 范围下所有切片已通过 checkpoint，final 全量中某个基线用例失败。
- **期望响应**：final FAIL，不得把缺失或失败的基线结果改列 pending；修复目标由失败输出判断。
- **副作用**：写 `VERIFY_FAIL` 与 final `LOOP_ITERS`，不写 `VERIFY_PASS`。

### 追溯

- 需求：`core-01-requirements.md`「S13/S16/S27/S28/S31/S32 多切片验收边界与自动恢复要求」高效模式验收条件。
- 功能规格：§2.37.2、§2.37.4、§2.37.8、§2.101。
- 根规范：`spec/test-slice-manifest.md` §7；`spec/test-results.md`「切片 checkpoint 的结果集合与 pending 语义」。
- 测试：`core-S13-test-cases.md`「S13 切片 checkpoint owned 验收范围测试」——UT-S13-132～UT-S13-140、ST-S13-35～ST-S13-37。

## 验收历史留存与查询时序（verification-history）

### 目标

让每一次进入执行的 `openlogos verify` 都留下一条不会被覆盖的历史，历史与同一次调用的最终门禁、共用验收报告一致，并能在提案归档后按 run_id 查到完整记录。规则权威见功能规格 §2.104。

### 参与者

- 用户或自动化宿主（RunLogos driver）
- OpenLogos CLI（`openlogos verify`、`openlogos history`）
- ResultPathLock（结果路径运行锁）
- 测试 runner / OpenLogos reporter
- VerificationHistory（三层写入与读取）
- 提案目录、中央索引目录与本机运行态目录

### 前置条件

- 项目已初始化；`verify` 配置可解析。
- 有活跃提案时提案目录存在；没有活跃提案时同样适用（只写中央索引）。
- 本次命令已通过用法、配置与前置拒绝检查（未通过时不开启运行、不留历史）。

### 时序图

```mermaid
sequenceDiagram
    actor Caller as 用户/宿主
    participant CLI as openlogos verify
    participant Lock as ResultPathLock
    participant Runner as 测试 runner
    participant Gate as 门禁判定
    participant Hist as VerificationHistory
    participant FS as 报告/中央索引/提案运行目录

    Caller->>CLI: verify [--format json]
    CLI->>CLI: Step 1 用法/配置/前置检查（拒绝则退出，不记录）
    CLI->>Lock: Step 2 开启运行：生成 run_id，按真实路径排序获取全部有效结果路径的锁
    alt 任一路径被占用
        Lock-->>CLI: 冲突
        CLI-->>Caller: RESULT_PATH_BUSY（退出 2，不截断，不记录）
    else 全部获取
        Lock-->>CLI: 已持有
        opt 配置了预跑 / 两阶段命令
            CLI->>Runner: Step 3 截断阶段结果并执行命令
            Runner-->>CLI: reporter JSONL（result_source=executed）
        end
        CLI->>CLI: Step 4 读取结果（未执行命令时 result_source=reused）
        alt 进入执行后早退（NO_TEST_RESULTS / NO_TEST_CASES）
            CLI->>Hist: Step 5a 收尾：outcome=aborted，沿用错误码与已取得的计数
            Hist->>FS: 写中央索引；有活跃提案时写提案运行目录
            CLI->>Lock: 释放
            CLI-->>Caller: 既有错误信封（error.details.history）与既有退出码
        else 结果可判定
            CLI->>Gate: Step 6 覆盖/账本 → smoke 覆盖预检 → 沙箱裁决
            Gate-->>CLI: 最终门禁
            CLI->>FS: Step 7 由最终数据渲染报告字节（一次，留在内存），写共用 acceptance-report.md 与既有标记
            CLI->>Hist: Step 8 收尾：outcome=completed，报告快照用同一份内存字节
            Hist->>FS: 写中央索引（结构化字段）；有活跃提案时写 verify-runs/<run_id>/；raw_in_proposal=false 时原文写本机
            CLI->>Lock: Step 9 释放
            CLI-->>Caller: 门禁结论 + data.history
        end
    end
    Caller->>CLI: Step 10 history list / history show <run_id>
    CLI->>Hist: 读中央索引；按 run_id 查活动/归档提案运行目录与本机原文
    Hist-->>Caller: 历史与完整记录（缺失时标明不可用）
```

### 步骤说明

1. **Step 1**：用法错误、`logos.config.json` 缺失、guard 拒绝等在开启运行前退出，不留历史，行为与修改前一致。
2. **Step 2**：锁集合为 `result_path`、`regression_result_path`、`incremental_result_path` 的有效值（按模块命令组解析），统一解析为真实路径后排序，全有或全无获取。
3. **Step 3～4**：执行了任一预跑 / 两阶段命令时 `result_source=executed`，只读取既有结果时为 `reused`。
4. **Step 5a**：进入执行后的早退（未配置预跑且结果文件不存在的 `NO_TEST_RESULTS`、缺少可验收用例定义的 `NO_TEST_CASES`）写 `outcome=aborted` 记录，报告字段缺省；沿用既有 stderr 错误信封、错误码与退出码，history 元数据放在 `error.details.history`。结果文件存在但为空（如预跑失败）时不是早退，照常到达门禁。
5. **Step 6～7**：共用 `acceptance-report.md` 在全部门禁（含 smoke 覆盖预检改判与沙箱裁决）之后写出一次；`VERIFY_PASS` / `VERIFY_FAIL`、`LOOP_ITERS`、切片 checkpoint 按既有规则写入。
6. **Step 8**：报告快照使用 Step 7 渲染时留在内存的同一份字节，不从共用报告路径回读；中央索引只写结构化白名单字段；有活跃提案时 `verify-runs/<run_id>/` 写 `record.json`、`results.jsonl`、`report.md`；`verify.history.raw_in_proposal=false` 时 `results.jsonl` 去掉自由文本字段，报告快照与被去掉的字段写到 `logos/.openlogos-runtime/verify-runs/<run_id>/`。写入失败只在 history 元数据中置 `write_status: "failed"` 与 `write_error`。
7. **Step 9**：释放全部锁。
8. **Step 10**：`history list` 只读中央索引；`history show` 以 run_id 精确匹配活动或归档提案的运行目录。

### 异常与边界

#### EX-13H.1: smoke 覆盖预检把门禁改判 FAIL
- 用例全部通过，但本提案新增的 smoke 用例缺 runner，`applySmokePrecheck` 把门禁改为 FAIL。
- 共用 `acceptance-report.md`、命令结果与历史的结论都是 FAIL；报告快照与共用报告逐字节一致。

#### EX-13H.2: 复用既有结果
- 未配置预跑命令，两次 verify 读取同一份预先生成的结果文件。
- 两条记录的 `result_source` 都是 `reused`，不冒充重新执行。

#### EX-13H.3: 进入执行后早退
- 未配置预跑且结果文件不存在（`NO_TEST_RESULTS`），或已合并测试规格中没有可验收用例（`NO_TEST_CASES`，预跑可能已执行）。
- 写 `outcome=aborted` 记录，带既有错误码与已取得的计数；报告字段缺省；stderr 错误信封、错误码与退出码不变，`error.details.history` 给出历史元数据。预跑失败但结果文件已被创建（为空）时不属于早退，照常判定为 FAIL 并记 `completed`。用法错误与配置缺失不记录。

#### EX-13H.4: 结果路径冲突
- 另一个 verify 或 smoke 正在运行，且其有效结果路径与本次锁集合有交集（包括只共享 regression / incremental 阶段路径、或对方只读取既有结果）。
- 本次以 `RESULT_PATH_BUSY` 拒绝（退出 2），释放已获取的锁，不截断、不改写任何结果文件，不写历史。

#### EX-13H.5: 历史写入失败
- 中央索引目录不可写或提案运行目录写入失败。
- `data.history.write_status="failed"`，`write_error.code="verification_history_write_failed"` 点名失败层与路径；门禁结论、退出码与标记不受影响。

#### EX-13H.6: 损坏的历史文件
- 中央索引目录中有非 JSON 或缺必填字段的文件。
- `history list` / `show` 跳过它并给出 `verification_history_corrupt` 警告，其余记录照常返回。

#### EX-13H.7: 切片 checkpoint 与 final
- 多切片提案依次执行 checkpoint verify 与 final verify。
- 各留一条记录，`verify_mode` 分别为 `slice-checkpoint`（带 `attempted_slice_id`）与 `final`；checkpoint 重复 PASS 也各留一条（历史记录每次运行，不同于 checkpoint 账本的去重）。

#### EX-13H.8: 没有活跃提案
- 初始开发阶段或两次提案之间执行 verify。
- 只写中央索引，`proposal=null`、`raw_location="none"`；`history show` 注明没有完整记录。

#### EX-13H.9: 归档后与同名新提案
- 提案归档后又新建同名提案并运行 verify。
- 旧 run_id 从 `logos/changes/archive/*-<slug>/verify-runs/<run_id>/` 读到完整记录；新运行 run_id 不同，不会被认成旧记录；中央索引不改写。完整记录在本机缺失时（如重新克隆）返回中央字段并标明 `full_record: "unavailable"`。

#### EX-13H.10: 历史路径被 git 忽略
- 历史目录命中 `.gitignore` 规则。
- 文件照常写入，输出给出路径；由流程提交或用户以 `git add -f` 纳入。CLI 不执行 git 操作。

### 追溯

- 需求：「S13/S19 验收历史留存与追溯要求」。
- 规格：功能规格 §2.104；架构「五十八、验收历史留存与查询」；`spec/test-results.md`「验收历史留存（verification-history）」。
- 测试：UT-S13-141～UT-S13-156、ST-S13-38～ST-S13-39。

## S13 verify 自足：环境预检与跳过分类（verify-self-sufficient-cases）

### 场景目标

让 `openlogos verify` 全程不需要人配合：执行任何预跑命令之前，先确认提案承诺的环境要求已写入配置、本机环境已就绪；测试结束后，本次改动的 UT/ST 只允许平台跳过，不允许「环境没准备好就写 skip」混过门禁。规则权威见功能规格 §2.106；格式见 `spec/test-results.md`「verify 环境要求声明、对账与预检」「verify 跳过分类」。

### 参与者

| 别名 | 组件 | 说明 |
|---|---|---|
| Caller | 用户或 RunLogos driver | 发起 verify |
| CLI | `openlogos verify` | 门禁与统计 |
| Cfg | 生效配置 | 未启用模块范围时为项目级 `verify.requirements`；启用时先按覆盖模块求 E(m)（模块级同名 check 只替换本模块），再合并（同名同命令合并、同名异命令分别执行） |
| Prop | 活跃提案 | proposal「验收标准」段；`SPEC_MERGED.test_change_set`（经 `readTestChangeSet` 校验） |
| Env | 预检执行环境 | 预跑命令将继承的环境变量与 `PATH`；检查命令经与预跑命令同一个沙箱执行器执行 |
| Runner | 项目测试入口 + OpenLogos reporter | 在调度前排除 `[manual]` 用例，写结果账本 |
| Gate | 门禁判定 | §2.106.7 优先级 |

### 前置条件

- 项目已初始化，`verify` 配置可解析；本次命令已通过用法与前置拒绝检查。
- 结果路径锁已获取（见本文档「验收历史留存与查询时序」Step 2）。
- 有无活跃提案均适用；无活跃提案时不对账，跳过分类只出警告。

### 成功后置条件

- 预检类原因均未命中时，预跑与门禁按既有流程执行；严格集合内只有平台跳过，平台跳过在 JSON 与报告中单独列出。
- 预检类原因命中时，未执行任何预跑命令，门禁 FAIL 并逐项列出缺失项。

### 时序图

```mermaid
sequenceDiagram
    actor Caller as 用户/宿主
    participant CLI as openlogos verify
    participant Prop as 活跃提案
    participant Cfg as 生效配置
    participant Env as 预检执行环境（沙箱执行器）
    participant Runner as 测试入口/reporter
    participant Gate as 门禁判定

    Caller->>CLI: Step 1: verify [--format json]
    CLI->>Cfg: Step 2: 读取 verify.requirements 与实际执行命令组的模块级要求，校验结构
    alt 结构非法
        CLI-->>Caller: FAIL verify_requirements_invalid（不执行预跑）
    end
    CLI->>Prop: Step 3: 读取「验收标准」的自动验收环境要求条目
    CLI->>Cfg: Step 4: 逐条对账 env:/command:/check: 是否已声明
    alt 有条目未声明
        CLI-->>Caller: FAIL acceptance_requirement_undeclared（点名条目，不执行预跑）
    end
    CLI->>Env: Step 5: 预检变量非空、命令在 PATH、检查命令经沙箱执行器限时退出 0
    alt 有缺失
        CLI-->>Caller: FAIL verify_env_not_ready（只写变量名，不执行预跑、不读结果；模块报告改写 FAIL；历史 result_source=none）
    end
    CLI->>Runner: Step 6: 执行预跑命令（入口已在调度前排除 [manual] 用例）
    Runner-->>CLI: Step 7: 结果账本（UT/ST 可带 reason_code / detail）
    CLI->>Prop: Step 8: 取测试变更集作为严格判定集合
    CLI->>CLI: Step 9: 归一化后对 skip 分类：平台跳过 / 用例分层错误 / 存量未分类
    CLI->>Gate: Step 10: 按 §2.106.7 优先级判定
    Gate-->>Caller: Step 11: 门禁结论、platform_skipped_cases、tier_mismatch_cases、unclassified_skipped_cases 警告
```

### 步骤说明

1. **Caller** 执行 `openlogos verify`（可带 `--format json`）。
2. **CLI** 求生效集合：未启用模块范围时取项目级 `verify.requirements`；启用时先沿用既有命令组选择得到本次实际执行的命令组，只对这些命令组服务的模块 m 求 E(m)（项目级加 `verify.modules.<m>.requirements`，m 的同名 check 只替换 m 自己的），再合并——`env`、`commands` 取并集，名称与命令都相同的 check 合并，名称相同、命令不同的 check 分别执行并记录归属模块。结构非法时以 `verify_requirements_invalid` 判 FAIL，不执行预跑。
3. **CLI** 有活跃提案时读取 proposal「验收标准」段的「自动验收环境要求」；字段为「无」、缺段或无活跃提案时跳过 Step 4。
4. **CLI** 逐条核对 `env:` / `command:` / `check:` 条目是否出现在生效集合对应字段；缺任一项以 `acceptance_requirement_undeclared` 判 FAIL 并点名，不执行预跑。
5. **CLI** 逐项预检：变量（按预跑命令将继承的环境）存在且非空；命令可在同一 `PATH` 解析；检查命令经与预跑命令同一个沙箱执行器执行（同一沙箱模式与复用配置，工作目录为沙箱工作副本中的项目根，写回白名单为空，注入归属模块的 `OPENLOGOS_VERIFY_MODULES`），60 秒内退出 0。缺任一项以 `verify_env_not_ready` 判 FAIL，诊断只写变量名与检查名（check 只写退出码或「超时」，并带归属模块）。本次没有任何预跑命令执行时，Step 5 只检查项目级要求（模块级要求不检查），缺项即在读取结果文件前判 FAIL。无沙箱隔离（`off` 或 `auto` 降级）时检查命令在源工作区运行、不承诺源工作区保护，检查命令须只读，输出标注 `isolation: "unisolated"`。Step 2～5 任一失败：不执行预跑、不截断也不读取结果文件；共用报告计数显示「未执行」；覆盖的 initial 模块报告改写为 FAIL；验收历史记 `result_source: "none"`。
6. **CLI** 执行既有预跑流程；项目测试入口在调度前排除 `[manual]` 用例的测试代码（测试分组、独立文件或独立入口）。
7. **Runner** 通过 reporter 写结果账本；平台限定用例在不适用时写 `reason_code: "platform-unavailable"` 与说明执行条件的 `detail`。
8. **CLI** 经 `readTestChangeSet` 读取活跃提案 `SPEC_MERGED.test_change_set.changed_test_ids`，取其中 UT/ST 作为严格判定集合：尚未 merge 时为空集；读取器判有效时取其集合（含合法空集）；已有 `SPEC_MERGED` 但读取器判无效时报 `test_change_set_invalid`，门禁 FAIL；切片 checkpoint 下与可计入集合求交。
9. **CLI** 对 `status:"skip"` 分类：严格集合内的平台跳过入 `platform_skipped_cases`；严格集合内的其余 skip 入 `tier_mismatch_cases`；严格集合外的非平台 skip 入 `unclassified_skipped_cases`（警告）。
10. **Gate** 按功能规格 §2.106.7 取 `gate.reason`：预检类原因最先；`case_tier_mismatch` 紧随 `failed_cases`。
11. **CLI** 输出门禁结论、`data.requirements` 与三个跳过子集；验收报告单独列出平台跳过与用例分层错误，警告单列。

### 异常与边界

#### EX-13.1：验收标准条目未写入配置
- **触发条件**：活跃提案验收标准列出 `check:db-ready`，生效配置中没有同名 check。
- **期望响应**：门禁 FAIL，`gate.reason="acceptance_requirement_undeclared"`，诊断点名 `check:db-ready`；预跑命令未执行。
- **副作用**：无；验收历史记一条门禁 FAIL 的记录。

#### EX-13.2：环境缺失
- **触发条件**：生效配置声明 `env: ["DB_URL"]` 与 `commands: ["docker"]`，本机两者都缺。
- **期望响应**：门禁 FAIL，`gate.reason="verify_env_not_ready"`，诊断依次列出 `env DB_URL` 与 `command docker`；输出与报告中不出现任何变量值；预跑命令未执行。
- **副作用**：无。

#### EX-13.3：检查命令超时或非零退出
- **触发条件**：`checks` 中某项 60 秒未退出，或以非零状态退出。
- **期望响应**：该项计为缺失，`detail` 为「超时」或退出码；超时的检查进程组被终止；不写检查命令的输出。
- **副作用**：无。

#### EX-13.4：严格集合内的非平台 skip
- **触发条件**：活跃提案新增 UT-S01-90，结果为无原因的 skip。
- **期望响应**：门禁 FAIL，`gate.reason="case_tier_mismatch"`（无失败用例且账本自洽时），`tier_mismatch_cases` 含该 ID 与 fix_hint「准备好环境并声明到 verify.requirements，或改标 `[manual]`」。
- **副作用**：无。

#### EX-13.5：平台跳过缺 detail
- **触发条件**：严格集合内用例写 `reason_code: "platform-unavailable"`，`detail` 为空串或缺失。
- **期望响应**：不按平台跳过放行，按 EX-13.4 判用例分层错误。
- **副作用**：无。

#### EX-13.6：适用平台缺前置工具与平台不适用的区分
- **触发条件**：本仓 ST-S13-26 只在「Linux、非 root、沙箱复用能力可用」时执行并需要 `cc`；`check:linux-nondump-cc` 与用例共用同一适用判定。机器为非 root Linux、没有 `cc`。
- **期望响应**：复用能力不可用时，检查直接通过，用例写平台跳过；复用能力可用时，预检报 `verify_env_not_ready`（缺 `check linux-nondump-cc`），不执行预跑；非 Linux 机器上检查直接通过、用例写平台跳过。
- **副作用**：无。

#### EX-13.7：人工用例不被测试入口启动
- **触发条件**：项目有一条自动用例与一条 `[manual]` 用例，后者的测试代码被启动即写哨兵文件。
- **期望响应**：普通最终 verify 完成，自动用例有结果，哨兵文件不存在；人工 ID 未出现在结果账本中。
- **副作用**：无。

#### EX-13.8：无活跃提案或存量用例
- **触发条件**：无活跃提案时执行 verify；或存量用例写了无原因的 skip。
- **期望响应**：不对账；skip 口径按 §2.7A 不变，门禁结论与退出码不变；输出警告 `unclassified_skipped_cases` 并列出 ID。
- **副作用**：无。

#### EX-13.9：未声明任何要求的零变化
- **触发条件**：未声明 `verify.requirements`，验收标准未列条目，严格集合内没有 skip。
- **期望响应**：判定、`gate.reason` 与退出码与引入前一致；`data.requirements` 缺省。
- **副作用**：无。

#### EX-13.10：模块验收报告不残留旧 PASS
- **触发条件**：双模块项目，两个 initial 模块已有 PASS 模块报告；随后 ① 项目级环境要求缺失；② 环境就绪，但模块 a 的用例子集中有严格集合内的非平台 skip。
- **期望响应**：① 两份模块报告都整份改写为 FAIL（计数「未执行」，写明预检原因），不读取旧账本；② 模块 a 的报告 FAIL（用例分层错误），模块 b 的报告 PASS。两种情形下受影响模块都不能再通过 `launch` 的验收报告检查。
- **副作用**：被改写的模块报告原子替换。

#### EX-13.11：预检失败的验收历史
- **触发条件**：① 首次 verify、从未生成过结果文件、验收标准条目未写入配置；② 上次 verify 留下 PASS 账本，本次环境未就绪。
- **期望响应**：两种情形都写一条 `outcome: "completed"`、`result_source: "none"`、`gate.result: "FAIL"` 的中央索引，计数为 null、ID 数组为空；报告快照按既有留存策略落点——无活跃提案只有中央索引；有活跃提案且 `raw_in_proposal: true` 时在提案完整记录；`raw_in_proposal: false` 时提案完整记录只有结构化 `record.json`、快照在本机原文目录。任何情况下都不写本轮结果文件；② 中旧账本未被截断，也不被复制或引用。
- **副作用**：无。

#### EX-13.12：模块同名检查命令不同
- **触发条件**：模块 a、b 同时被覆盖，各自声明 `db-ready`，命令分别检查各自的数据库；a 的数据库不可用。
- **期望响应**：两条检查都被执行；预检报 `verify_env_not_ready`，缺失项为 `{kind:"check", name:"db-ready", modules:["a"]}`；不因名称相同而漏掉任何一个模块的检查。
- **副作用**：无。

#### EX-13.13：检查命令在沙箱中执行
- **触发条件**：`verify.sandbox_mode: "always"`；某依赖只在宿主工作区存在、沙箱工作副本中不存在；检查命令还会在当前目录写一个临时文件。
- **期望响应**：检查在沙箱工作副本中执行并失败，报 `verify_env_not_ready`，测试入口未启动；源工作区没有出现检查写出的文件，`isolation: "sandboxed"`。沙箱无法隔离时：`always` 按既有规则判 FAIL；`auto` 降级后检查在源工作区运行，`isolation: "unisolated"`，此时不承诺源工作区保护，只读检查执行后源工作区不变。
- **副作用**：无。

#### EX-13.14：已合并提案的测试变更集无效
- **触发条件**：活跃提案已正常 merge（新增 UT-S01-90），随后 `SPEC_MERGED.test_change_set` 的摘要被改坏；UT-S01-90 写无原因 skip，其余用例通过。
- **期望响应**：读取器判无效，不推导为空集；门禁 FAIL，`gate.reason="test_change_set_invalid"`，`detail` 带读取器原因码；不产生最终 PASS。
- **副作用**：无。

#### EX-13.15：被覆盖但没有任何预跑命令的模块
- **触发条件**：`verify --all` 覆盖 a、b；项目级未配置预跑命令，a 有自己的命令组，b 只有模块级要求 `command:b-tool`，本机没有 `b-tool`。
- **期望响应**：既有命令组选择只返回服务 a 的命令组；b 的要求不检查；预检通过，a 的 runner 被启动。另一种情形：项目没有任何预跑命令、已有一份通过的旧账本、显式声明的项目级 `env: ["DB_URL"]` 缺失——预检照常执行并报 `verify_env_not_ready`（点名 `DB_URL`），旧账本不被读取，不得 PASS。
- **副作用**：无。

### 追溯

- 需求：AC-VERIFY-SELF-01～08、AC-VERIFY-SELF-11、AC-VERIFY-SELF-13。
- 功能规格：§2.106.2～§2.106.7A、§2.106.10、§2.104.3（`result_source: "none"`）。
- 同源章节：本文档「verify 结果账本一致性预检」「EX-7.4: 合法 skip 不阻塞 verify Gate」（存量口径不变）、「S13 人工用例判据的声明位与一致性判据的输入」（声明位不变）、「验收历史留存与查询时序（verification-history）」（预检失败照常留存）。
- 测试：`core-S13-test-cases.md`（UT-S13-157 起、ST-S13-40 起）；安装态 smoke：`core-smoke-test-cases.md`（SMOKE-core-338 起）。

## S13 失败用例复跑与偶发判定（verify-flaky-rerun）

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

## S13 分层验收：提案级三层集合（layered-verification）

### 场景目标

分层开启的项目上，`openlogos verify` 的提案级验收只对「本提案用例 ∪ 受影响用例 ∪ 主链路用例」给出结论；评估不可用或涉及共享改动时扩大范围，不缩小。规则权威见功能规格 §2.109.2～§2.109.10、§2.109.13～§2.109.14；测试入口约定见 `spec/test-results.md`「分层验收（layered-verification）」。

### 参与者

| 别名 | 组件 | 说明 |
|---|---|---|
| Caller | 用户或 RunLogos driver | 发起 verify |
| CLI | `openlogos verify` | 读取配置、计算集合、注入、核对、门禁、报告 |
| Cfg | 生效配置 | `verify.layered`（缺省关闭、上限 50、共享路径清单） |
| MP | 主链路读取 | 测试用例文档主链路小节 → 集合与结构错误 |
| Decl | 受影响场景声明读取 | 提案「受影响场景」段 → 可用性状态 |
| Scope | 按模块限定范围（§2.96） | 提案起点、改动文件集合、范围内模块 |
| Runner | 项目测试入口 + OpenLogos reporter | 按 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS` 选择并执行 |
| Gate | 门禁判定 | §2.109.10 的原因优先级 |
| Hist | 验收历史 | 记录 `level: "proposal"`、`platform` |

### 前置条件

- 命令已通过用法检查；`verify.layered.enabled` 为 true。
- 结果路径运行锁已获取。

### 成功后置条件

- 验收集合 P 及其三层来源、扩大级别与原因在 JSON 与验收报告中可见。
- 门禁只依据 P 内的结果；P 之外的已定义用例不计未覆盖。
- 验收报告标明级别为提案级。

### 时序图

```mermaid
sequenceDiagram
    actor Caller as 用户/宿主
    participant CLI as openlogos verify
    participant Cfg as 生效配置
    participant MP as 主链路读取
    participant Decl as 声明读取
    participant Scope as 按模块范围
    participant Runner as 测试入口/reporter
    participant Gate as 门禁判定
    participant Hist as 验收历史

    Caller->>CLI: Step 1: verify [--format json]
    CLI->>Cfg: Step 2: 读取 verify.layered
    CLI->>MP: Step 3: 读取主链路小节（只读）
    MP-->>CLI: Step 4: 集合 MP、结构错误、总数
    CLI->>Decl: Step 5: 读取提案「受影响场景」段（只读）
    Decl-->>CLI: Step 6: 可用性状态、已识别场景、共享标志
    CLI->>Scope: Step 7: 提案起点、改动文件、范围内模块（只读）
    Scope-->>CLI: Step 8: 改动文件集合或不可用原因
    CLI->>CLI: Step 9: 应用扩大规则，得到 P、执行集合 E、扩大级别与本次命令组
    CLI->>CLI: Step 10: 环境预检（对本次命令组服务的模块）
    alt 主链路结构错误或超过上限
        CLI->>Gate: Step 11: 执行前判 FAIL（main_path_invalid / main_path_over_limit）
    else 主链路检查通过
        CLI->>Runner: Step 12: 注入 ELIGIBLE_TEST_IDS=E，执行本次命令组
        Runner-->>CLI: Step 13: 结果文件与退出码
        CLI->>CLI: Step 14: 失败复跑（既有）；统计集合外结果行数
        CLI->>Gate: Step 15: 以 E 为已定义集合判定；主链路用例偶发 → main_path_flaky
    end
    Gate-->>CLI: Step 16: 门禁结论
    CLI->>Hist: Step 17: 写入记录（level、platform）
    CLI-->>Caller: Step 18: 结论、layers、警告、提案级报告
```

### 步骤说明

1. **Caller** 执行 `openlogos verify`。
2. **CLI** 读取 `verify.layered`；非法项按缺省值处理并记警告 `layered_config_invalid`。`enabled` 不为 true 时不进入本场景（EX-13.28）。
3. **CLI** 读取全部测试用例文档的主链路小节。Step 3～9 都是只读计算，发生在环境预检之前。
4. **主链路读取** 返回集合 MP、结构错误清单与总数。
5. **CLI** 读取活跃提案的「受影响场景」段；没有活跃提案时直接到 Step 9（扩大到全量）。
6. **声明读取** 返回状态（`usable` / `missing` / `invalid` / `unknown` / `scenario_unknown`），以及不论状态如何都能独立采信的两项：已识别场景与共享标志。
7. **CLI** 取得提案起点与改动文件集合（§2.96 的同一计算，不要求模块范围已启用）。
8. 起点不可用或差异计算失败时返回原因。
9. **CLI** 应用扩大规则（§2.109.7），得到：扩大级别 `none` / `module` / `full` 与原因清单；提案集合 P；本次执行集合 E（final 时等于 P，切片 checkpoint 时为当前 eligible）；本次要执行的命令组（§2.109.8）。
10. **CLI** 对本次命令组服务的模块做环境预检。未通过时按既有预检类原因收尾，不进入后续步骤——因主链路或已识别场景多带出的模块同样被预检，最终不执行的模块不参与预检。
11. 主链路有结构错误，或总数超过 `main_path_max` → 不执行预跑命令、不读取结果文件，直接判 FAIL；`result_source` 为 `"none"`。已合并提案的测试变更集无效时，原因取 `test_change_set_invalid`。
12. **CLI** 在级别为 `none` 或 `module` 时注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`=E，执行本次命令组；final 验收不注入 `OPENLOGOS_VERIFY_SLICE_SCOPE`。
13. **Runner** 按清单选择并执行，写结果文件。
14. **CLI** 照既有规则做失败复跑（复跑集合与 E 求交）；统计属于已定义用例但不在 P 内的结果行数。
15. **Gate** 以 E 为已定义集合判定。MP 中的用例被判为偶发时原因为 `main_path_flaky`。命令组的退出状态照常计入，不因忽略集合外结果行而改变。
16. 集合外结果行数大于 0 时 `warnings` 增加 `layered_runner_not_narrowed`。
17. **CLI** 写验收历史（`level: "proposal"`、`platform`）。
18. **CLI** 写提案级验收报告（含级别与验收范围小节）与提案标记，输出结论；退出码与 `gate.result` 一致。

### 异常与边界

#### EX-13.28：分层未开启
- **触发条件**：`verify.layered.enabled` 未配置或为 false。
- **期望响应**：不读取主链路小节与受影响场景段；验收范围、门禁、报告、退出码与引入前一致；JSON 只多出 `level: "proposal"`，没有 `layers`。
- **副作用**：无。

#### EX-13.29：没有活跃提案
- **触发条件**：分层开启，没有 guard 或没有活跃提案。
- **期望响应**：扩大到全量，原因 `no_active_change`；主链路约束照常检查。
- **副作用**：无。

#### EX-13.30：声明缺失、非法或无法评估
- **触发条件**：声明状态为 `missing`、`invalid` 或 `unknown`。
- **期望响应**：扩大到按模块，原因分别为 `declaration_missing`、`declaration_invalid`、`assessment_unknown`；模块范围未启用或其自身回落时结果为全量，并追加原因 `module_scope_unavailable`。按模块扩大时，声明中已识别的场景与 delta 触及的场景仍保留在集合内（即使不在范围 M 的模块中），其所属模块的命令组一并执行。门禁结论不因扩大改变。
- **副作用**：无。

#### EX-13.31：声明了不存在的场景
- **触发条件**：`scenarios` 中有不存在的场景编号。
- **期望响应**：同 EX-13.30，原因 `scenario_unknown`，点名该编号。声明中其余存在的场景照常计入（已识别场景），结果是「按模块范围 ∪ 已识别场景 ∪ delta 触及场景」，不小于未写错时的集合。
- **副作用**：无。

#### EX-13.32：涉及共享改动

- **触发条件**：改动文件命中 `shared_paths`；或 `logos/logos.config.json`、`logos/logos-project.yaml` 按字段判断为相关变化（功能规格 §2.96.3.1，含无法判断；只有无关字段变化时不命中）；或声明的共享标志为真——只要 `shared_change: true` 可读出即采信，声明其余部分为 `unknown`、未填写或有错时同样成立。
- **期望响应**：扩大到全量，原因 `shared_path_changed`（列出命中的文件，共享验收配置文件写明字段或原因）或 `shared_change_declared`。
- **副作用**：无。

#### EX-13.33：提案起点不可用
- **触发条件**：不是 git 仓库、guard 缺 `baseRef`、`baseRef` 不可达，或差异计算失败。
- **期望响应**：扩大到全量，原因 `base_ref_unavailable` 并附具体情形。
- **副作用**：无。

#### EX-13.34：delta 触及的场景未在声明中

- **触发条件**：声明没有 S21，且提案 `deltas/` 中属于下列之一：有 S21 的场景文档；或有 S21 的测试用例文档，并且这份文档的用例有变化（新增、修改或删除），或处于按文件名判断的情形（提案未合并、测试变更集无效、无法逐份文档判断，见 EX-13.66、EX-13.67）。
- **期望响应**：S21 计入受影响场景，来源 `delta`；不报错。测试用例文档的 delta 没有改动用例时不计入，见 EX-13.64。
- **副作用**：无。

#### EX-13.35：主链路超过上限
- **触发条件**：MP 的大小大于 `main_path_max`。
- **期望响应**：FAIL `main_path_over_limit`，报告与 JSON 给出上限与实际数量；测试入口未被调用。
- **副作用**：无。

#### EX-13.36：主链路小节结构错误
- **触发条件**：小节列了未定义 ID、人工用例、SMOKE、重复 ID，或同一文档有多个小节。
- **期望响应**：FAIL `main_path_invalid`，逐条给出文档、ID 与错误代码；测试入口未被调用。与 EX-13.35 同时成立时取本条。
- **副作用**：无。

#### EX-13.37：主链路用例偶发
- **触发条件**：MP 中的用例首跑失败、复跑通过。
- **期望响应**：FAIL `main_path_flaky`；该用例在 `flaky_cases` 与 `layers.main_path.flaky_ids` 中；不写 `VERIFY_PASS`；报告提示修复或移出主链路。同一次运行中非主链路用例的偶发照常按 §2.108 处理。
- **副作用**：无。

#### EX-13.38：测试入口没有收窄
- **触发条件**：测试入口忽略清单，执行并上报了全部用例。
- **期望响应**：P 之外的已定义用例的结果不采信、不计入统计、不判 `result_outside_eligible_scope`；`layers.outside_result_count` 大于 0，警告 `layered_runner_not_narrowed`；门禁按执行集合判定。测试入口执行了集合外文件但没有上报时不告警。命令的退出状态是另一份证据：入口因集合外用例失败而非零退出、又没有集合内失败可供复跑改判时，门禁为 `pre_run_failed`；入口零退出时才可能 PASS。
- **副作用**：无。

#### EX-13.39：与按模块限定范围并存
- **触发条件**：分层开启，且模块范围已启用。
- **期望响应**：未扩大时执行「P 中用例所属模块」的命令组（P 含不带模块前缀的文档中的用例时执行全部命令组）；扩大到按模块时执行范围 M 的命令组，加 MP 与已识别场景、delta 触及场景所属模块的命令组；环境预检针对同一组命令组服务的模块；`data.scope` 照旧输出。
- **副作用**：无。

#### EX-13.40：提案尚未合并规格
- **触发条件**：活跃提案没有 `SPEC_MERGED`。
- **期望响应**：本提案用例为空集；其余两层照常。
- **副作用**：无。

#### EX-13.54：切片 checkpoint 的执行集合
- **触发条件**：分层开启的 slice-checkpoint（`baseline` 范围）。
- **期望响应**：注入的清单、已定义集合与复跑集合都取当前 eligible（提案集合 P 的子集，不含 pending）；`layers.total` 为 P，`layers.execution` 为当前 eligible。pending 用例没有结果是正常的；pending 用例被提前上报时照既有规则判 `result_outside_eligible_scope`；P 之外的已定义用例被上报时只计入 `outside_result_count`。`owned` 范围的 checkpoint 不适用最后一条：当前 eligible 之外的任何已定义用例被上报都判 `result_outside_eligible_scope`。
- **副作用**：无。

#### EX-13.55：多带出的模块缺少环境条件
- **触发条件**：模块范围 M 只有 `backend`，主链路用例在 `core`，`core` 声明了独有的环境要求且未满足。
- **期望响应**：环境预检覆盖 `core`，判 `verify_env_not_ready`；任何命令组都未执行。
- **副作用**：无。

#### EX-13.41：配置非法
- **触发条件**：`layered` 不是对象，或其字段取值非法。
- **期望响应**：非法项按缺省值处理（`enabled` 非法即视为未开启），警告 `layered_config_invalid` 指出字段。
- **副作用**：无。

### 追溯

- 需求：AC-VERIFY-TIER-01～13、AC-VERIFY-TIER-19、AC-VERIFY-TIER-20。
- 功能规格：§2.109.2～§2.109.10、§2.109.13、§2.109.14。
- 测试：`core-S13-test-cases.md`（UT-S13-217 起、ST-S13-48 起）。

## S13 发布级全量验收（layered-verification）

### 场景目标

在确定的提交上实际执行全量并留下与提交号绑定的结论；任何时候都能查询某个提交在当前平台上是否有有效的发布级结论。规则权威见功能规格 §2.109.11、§2.109.12。全量的调度、执行机与发布门不在本场景内。

### 参与者

| 别名 | 组件 | 说明 |
|---|---|---|
| Caller | 用户、执行机或宿主 | 发起发布级验收或查询 |
| CLI | `openlogos verify --release` | 前置检查、固定提交号、全量执行、收尾复核、报告 |
| Git | git | 提交号与工作区状态 |
| Runner | 项目测试入口 + OpenLogos reporter | 执行全量 |
| Gate | 门禁判定 | 既有全量判据，加 `release_commit_changed` |
| Hist | 验收历史 | 记录 `level: "release"`、提交号、平台 |

### 前置条件

- 项目已初始化。发布级验收不要求、也不读取活跃提案。

### 成功后置条件

- 验收历史有一条 `level: "release"` 的记录，`commit.head` 为执行前固定的提交号。
- 发布级报告写在 `logos/resources/verify/release/acceptance-report.md`。
- 提案目录中的任何标记与提案级验收报告都没有被改动。

### 时序图

```mermaid
sequenceDiagram
    actor Caller as 用户/执行机
    participant CLI as openlogos verify --release
    participant Git as git
    participant Runner as 测试入口/reporter
    participant Gate as 门禁判定
    participant Hist as 验收历史

    Caller->>CLI: Step 1: verify --release [--format json]
    CLI->>Git: Step 2: 是否 git 仓库、工作区是否干净
    CLI->>CLI: Step 3: 是否配置了可执行的测试命令
    alt 任一前置条件不满足
        CLI-->>Caller: Step 4: 错误信封，退出码 2（不执行、不写历史）
    else 前置条件满足
        CLI->>Git: Step 5: 固定 HEAD 的完整提交号 R
        CLI->>CLI: Step 6: 环境预检（既有）
        CLI->>Runner: Step 7: 执行全部命令组（不注入 ELIGIBLE / SLICE_SCOPE）
        Runner-->>CLI: Step 8: 结果文件与退出码
        CLI->>CLI: Step 9: 失败复跑与偶发判定（既有）
        CLI->>Git: Step 10: 收尾复核 HEAD 与工作区
        CLI->>Gate: Step 11: 全量判定；HEAD≠R 或工作区不干净 → release_commit_changed
        Gate-->>CLI: Step 12: 门禁结论
        CLI->>Hist: Step 13: 写入记录（level=release、commit.head=R、platform）
        CLI-->>Caller: Step 14: 结论与发布级报告
    end
    Caller->>CLI: Step 15: verify --release --check [--commit <sha>]
    CLI->>Hist: Step 16: 取目标提交与当前平台下最近一次有结论的发布级运行
    CLI-->>Caller: Step 17: valid 与原因；退出码 0 / 1
```

### 步骤说明

1. **Caller** 执行 `openlogos verify --release`。
2. **CLI** 检查项目是 git 仓库、HEAD 可解析；检查工作区干净（lifecycle 路径之外没有任何未提交或未跟踪的条目）。
3. **CLI** 检查配置了可执行的测试命令。
4. 任一不满足：`RELEASE_VERIFY_NOT_GIT` / `RELEASE_VERIFY_DIRTY` / `RELEASE_VERIFY_NO_COMMAND`，退出码 2。不获取运行锁、不截断结果文件、不写历史。
5. **CLI** 解析并固定当前 HEAD 的完整提交号 R。
6. **CLI** 做环境预检（项目级与全部模块的要求）。未通过时按既有预检类原因判 FAIL，`result_source` 为 `"none"`——这次运行不是发布级结论。
7. **CLI** 执行全部命令组（命令组选择等同 `--all`）；清除并不注入 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`、`OPENLOGOS_VERIFY_SLICE_SCOPE`。
8. **Runner** 执行全量并写结果文件。
9. **CLI** 照既有规则做失败复跑与偶发判定；对全部自动化用例严格判定跳过（只接受带平台原因的跳过）。
10. **CLI** 再次读取 HEAD 与工作区状态。
11. **Gate** 以全部不带 `[manual]` 的 UT/ST 为已定义集合判定。HEAD 不等于 R 或工作区不干净时，原因为 `release_commit_changed`，优先于其他原因。
12. 得到门禁结论。
13. **CLI** 写验收历史：`level: "release"`、`commit: { head: R, dirty: false }`、`platform`、`proposal: null`、`raw_location: "none"`。
14. **CLI** 写发布级报告，输出结论；不写任何提案标记，不改写提案级验收报告与模块验收报告，不执行 smoke 覆盖预检。
15. **Caller** 执行 `openlogos verify --release --check`（只读，不要求工作区干净）。
16. **CLI** 解析目标提交（`--commit` 或当前 HEAD），在验收历史中取「目标提交 + 当前平台」下最近一次有结论的发布级运行。
17. **CLI** 输出 `valid`、`reason` 与该运行；`valid` 为 true 时退出码 0，否则 1。

### 异常与边界

#### EX-13.42：工作区不干净
- **触发条件**：有未提交的改动或未跟踪文件（lifecycle 路径除外）。
- **期望响应**：`RELEASE_VERIFY_DIRTY`，`details.paths` 列出至多 20 条；不执行任何命令。
- **副作用**：无。

#### EX-13.43：不是 git 仓库
- **触发条件**：项目不在 git 仓库内，或 HEAD 无法解析（尚无提交）。
- **期望响应**：`RELEASE_VERIFY_NOT_GIT`；不执行任何命令。
- **副作用**：无。

#### EX-13.44：没有测试命令但有旧的全绿结果
- **触发条件**：未配置任何测试命令，`result_path` 上有一份完整且全部通过的结果文件。
- **期望响应**：`RELEASE_VERIFY_NO_COMMAND`；结果文件不被读取、不被改动；随后的 `--check` 不因它给出有效结论。
- **副作用**：无。

#### EX-13.45：运行期间提交变化
- **触发条件**：在提交 A 上启动，收尾时 HEAD 已是提交 B（或工作区出现未提交改动）。
- **期望响应**：FAIL `release_commit_changed`；历史记录的提交号是 A；`--check --commit B` 不命中这次运行。
- **副作用**：无。

#### EX-13.46：存在活跃提案
- **触发条件**：仓库里有活跃提案及其标记。
- **期望响应**：发布级验收照常执行全量；`VERIFY_PASS`、`VERIFY_FAIL`、切片 checkpoint、循环账本、提案完整记录目录、提案级验收报告都保持原样。
- **副作用**：`result_path` 被本次全量结果覆盖。

#### EX-13.47：分层开启或模块范围启用
- **触发条件**：`verify.layered.enabled` 为 true，或项目启用了按模块限定范围。
- **期望响应**：发布级验收仍为全量，不计算三层集合与模块范围，不检查主链路约束。
- **副作用**：无。

#### EX-13.56：全量入口只上报跳过
- **触发条件**：测试入口正常退出，为用例写了没有平台原因的 skip（极端情形是每条用例都是无理由 skip）。
- **期望响应**：发布级对全部自动化用例严格判定跳过：这些用例列入 `tier_mismatch_cases`，门禁 FAIL，原因 `case_tier_mismatch`；随后的 `--check` 返回 `latest_failed`。带平台原因的跳过（`platform-unavailable` 加非空说明）被接受并列入 `platform_skipped_cases`，其余用例通过时门禁 PASS。
- **副作用**：无。

#### EX-13.48：同一提交先通过后失败
- **触发条件**：同一提交、同一平台上先后两次有结论的发布级运行，先 PASS 后 FAIL。
- **期望响应**：`--check` 返回 `valid: false`、`reason: "latest_failed"`，退出码 1。先 FAIL 后 PASS 时 `valid: true`，退出码 0。
- **副作用**：无。

#### EX-13.49：环境预检未通过的运行
- **触发条件**：某次发布级运行因环境预检类原因判 FAIL（`result_source: "none"`）。
- **期望响应**：它不是结论：此前同一提交的 PASS 仍然有效；此前没有结论时 `--check` 返回 `no_conclusive_run`。
- **副作用**：无。

#### EX-13.50：只有其他提交或其他平台的结论
- **触发条件**：目标提交在当前平台没有结论。
- **期望响应**：其他平台有该提交的结论 → `other_platform_only`；只有其他提交的结论 → `other_commit_only`；什么都没有 → `no_conclusive_run`。退出码 1。
- **副作用**：无。

#### EX-13.51：`--commit` 无法解析
- **触发条件**：`--commit` 的值不是当前仓库中的提交。
- **期望响应**：`RELEASE_CHECK_COMMIT_INVALID`，退出码 2。
- **副作用**：无。

#### EX-13.52：结果路径配置落在发布级报告路径上
- **触发条件**：`result_path` 等配置为 `logos/resources/verify/release/acceptance-report.md`。
- **期望响应**：按既有报告保留路径规则改写到默认路径并提示；发布级报告不被结果内容覆盖。
- **副作用**：无。

#### EX-13.53：存在名为 `release` 的模块
- **触发条件**：多模块项目有模块 `release`，其模块验收报告为 `logos/resources/verify/release-acceptance-report.md`。
- **期望响应**：发布级报告在 `release/` 子目录，与模块验收报告是两个文件，互不覆盖；模块完成判定不受影响。
- **副作用**：无。

### 追溯

- 需求：AC-VERIFY-TIER-14～19。
- 功能规格：§2.109.11～§2.109.14、§2.104.3。
- 测试：`core-S13-test-cases.md`（UT-S13-217 起、ST-S13-48 起）。

## S13 共享验收配置按字段判断（verify-scope-fields-and-slice-module）

> 来源变更：verify-scope-fields-and-slice-module（openlogos #4）。规则权威见功能规格 §2.96.3.1；本节细化「S13 按模块限定范围的 verify」Step 8c 与「S13 分层验收：提案级三层集合」的共享改动判定，两处共用同一判断。

### 场景目标

提案期间 `logos/logos.config.json` 或 `logos/logos-project.yaml` 有变化时，verify 只在与验收相关的字段变了、或无法判断时才回落全量，并说明是哪个文件的哪些字段；合并规格写入的资源索引、宿主写回的运行偏好不再触发全量。

### 参与者

| 别名 | 组件 | 说明 |
|---|---|---|
| CLI | `openlogos verify` | 发起范围计算，输出 `scope` 或 `layers` |
| Scope | 范围计算 | 按模块限定范围（§2.96.3）或分层验收的扩大规则（§2.109.7） |
| Cmp | 共享配置字段比较 | 取两侧原文、严格解析、比较顶层字段 |
| Git | git | 提供提案起点提交中的文件内容 |
| FS | 工作区文件 | 提供当前文件内容 |

### 前置条件

- 相应范围机制已启用：按模块限定范围经 §2.96.2 判定为启用，或分层验收已开启且存在活跃提案、提案起点可用。
- 改动文件集合（`baseRef` → 工作区）已算出。

### 成功后置条件

- 每个共享验收配置文件得到「相关变化」「无关变化」或「未改动」之一。
- 有相关变化时回落（或扩大到）全量，原因的 `detail` 写明文件与字段；否则范围照常计算，这两个文件不参与后续分类。

### 时序图

```mermaid
sequenceDiagram
    participant CLI as openlogos verify
    participant Scope as 范围计算
    participant Cmp as 共享配置字段比较
    participant Git as git
    participant FS as 工作区文件

    CLI->>Scope: Step 1: 计算本次验收范围
    Scope->>Scope: Step 2: 确认机制已启用，取改动文件集合
    Scope->>Cmp: Step 3: 对改动集合中的共享验收配置文件逐个判断
    Cmp->>Git: Step 4: 读取 baseRef 提交中该文件的内容（项目根相对路径）
    Git-->>Cmp: Step 5: 原文，或不存在 / 读取失败
    Cmp->>FS: Step 6: 读取工作区中该文件的内容
    FS-->>Cmp: Step 7: 原文，或不存在 / 读取失败
    Cmp->>Cmp: Step 8: 两侧严格解析并比较顶层字段
    Cmp-->>Scope: Step 9: 相关变化（字段或原因）/ 无关变化
    Scope-->>CLI: Step 10: 回落或扩大到全量（写明文件与字段），或照常计算范围
```

### 步骤说明

1. **verify** 请求范围计算（Step 1）。
2. **范围计算** 确认相应机制已启用并取得改动文件集合（Step 2）。起点不可用、差异计算失败等既有回落条件在本步按既有规则给出原因并结束，不进入后续步骤。某个机制未启用时，该机制不进入本场景、入口行为与引入前相同，另一个已启用的机制照常进入（EX-13.61）。
3. **范围计算** 把改动集合中属于共享验收配置的文件交给字段比较（Step 3）；流程产物豁免先于本步。分层验收中，被 `shared_paths` 显式列出的文件不交给字段比较，直接按路径命中（EX-13.62）。
4. **字段比较** 从 git 读取提案起点提交中该文件的内容（Step 4、5）。项目根在 git 仓库子目录时按项目根相对路径读取。
5. **字段比较** 读取工作区中该文件的内容（Step 6、7）。
6. **字段比较** 对两侧原文严格解析；都通过且顶层都是对象时，取顶层键的并集逐个比较取值（Step 8）：对象不看键顺序，数组看元素顺序，标量按解析后的值。
7. **字段比较** 返回结论（Step 9）：变化的键中有相关字段或未列出的字段，或任一侧无法判断 → 相关变化，并带上字段名或原因；否则 → 无关变化。
8. **范围计算** 汇总（Step 10）：任一文件为相关变化 → 按模块限定范围回落全量（`shared_config_changed`），分层验收扩大到全量（`shared_path_changed`）；都是无关变化 → 这两个文件不参与后续分类，范围照常计算。

### 异常与边界

#### EX-13.57：只有无关字段变化
- **触发条件**：变化的顶层键全部在无关字段清单中（如 `resource_index`、`scenarios`、`driver`、`description`）。
- **期望响应**：不回落、不扩大；按模块限定范围下该文件不进入规格前缀与 `paths` 归属，不会被判 `unmapped_file`。
- **副作用**：无。

#### EX-13.58：未列出的字段变化
- **触发条件**：变化的顶层键中有清单两列都没有列出的键（如 `documents`、`flow`，或今后新增的字段）。
- **期望响应**：按相关变化处理，`detail` 列出该键。
- **副作用**：无。

#### EX-13.59：只调整写法
- **触发条件**：相关字段的键顺序、空白、注释或引号写法变了，解析后的取值相同。
- **期望响应**：不算变化。数组元素顺序变化算变化。
- **副作用**：无。

#### EX-13.60：进入比较后无法判断
- **触发条件**：任一侧原文不存在、读取失败、不能严格解析或顶层不是对象。包括：提案起点中没有该文件；提案起点中的内容损坏而工作区有效；工作区 `logos-project.yaml` 有语法错误（如重复顶层键）但恢复解析仍得到多个声明了 `paths` 的模块，模块范围照常启用；模块范围已启用而工作区 `logos.config.json` 损坏；分层已开启而工作区 `logos-project.yaml` 损坏。
- **期望响应**：按整文件变化处理，回落或扩大到全量；`detail` 写 `<路径>（提案起点中的内容<原因>）` 或 `<路径>（工作区中的内容<原因>）`。恢复解析的结果只用于判断模块范围是否启用，不用于字段比较。
- **副作用**：无。

#### EX-13.61：配置文件没有被比较
- **触发条件**：下列之一——
  1. 工作区没有 `logos/logos.config.json`；
  2. 工作区 `logos/logos.config.json` 无法解析（分层按未开启）；
  3. 工作区 `logos/logos-project.yaml` 缺失或解析不出模块（模块范围未启用）；
  4. 机制已启用，但没有取得改动文件集合：没有活跃提案、guard 缺 `baseRef`、`baseRef` 不可达、不是 git 仓库、差异计算失败、`paths` 非法；
  5. 已取得改动文件集合，但集合不包含该配置文件（两侧都没有，或两侧相同）。
- **期望响应**：字段比较的唯一触发条件是「该机制已取得改动文件集合，且集合包含该配置文件」（功能规格 §2.96.3.1）。条件不成立时该文件不被比较、不贡献任何原因或明细，其余照旧：
  1. 以 `PROJECT_NOT_INITIALIZED` 退出。
  2. 不输出 `layers`；模块范围是否启用只看 `logos-project.yaml`，已启用且满足触发条件时照常按 EX-13.60 回落并点名该文件。
  3. 不输出 `scope`；分层是否开启只看 `logos.config.json`，已开启且满足触发条件时照常按 EX-13.60 扩大并点名该文件。
  4. 按既有规则给出各自的原因（模块范围为 `base_ref_missing` 等，分层为 `base_ref_unavailable` 等），不读取两个文件的内容。例：多模块项目工作区 `logos.config.json` 损坏且 guard 缺 `baseRef` → `scope.fallback_reason.code` 为 `base_ref_missing`。
  5. 同一机制按其他规则给出的原因照常保留，只是 `detail` 中没有该配置文件。例：分层已开启，两侧都没有 `logos/logos-project.yaml`，`logos/logos.config.json` 两侧相同，提案只改了 `package-lock.json` → 扩大到全量，`shared_path_changed` 的 `detail` 含 `package-lock.json`，不含这两个配置文件。
- **副作用**：无。

#### EX-13.62：`shared_paths` 显式列出共享验收配置文件
- **触发条件**：分层验收已开启，`verify.layered.shared_paths` 的某个 glob 命中 `logos/logos.config.json` 或 `logos/logos-project.yaml`，且该文件在改动集合中。
- **期望响应**：该文件按路径命中处理，任何差异都扩大到全量，`detail` 只写路径。按模块限定范围不读取 `shared_paths`，仍按字段判断。
- **副作用**：无。

#### EX-13.63：两个文件同时相关变化
- **触发条件**：两个文件都判为相关变化。
- **期望响应**：一个原因，`detail` 用 `、` 连接两个文件，`logos/logos.config.json` 在前；每个文件内的字段按字典序。
- **副作用**：无。

### 追溯

- 需求：AC-VERIFY-FIELD-01～07。
- 功能规格：§2.96.3、§2.96.3.1、§2.109.2、§2.109.7。
- 测试：`core-S13-test-cases.md`「S13 共享验收配置按字段判断测试」（UT-S13-275～293、ST-S13-52～54）。

## S13 测试用例文档按用例变化判断 delta 触及（fix-delta-touched-by-case-change）

> 来源变更：fix-delta-touched-by-case-change（决策 C01）。规则权威见功能规格 §2.109.5；本节细化「S13 分层验收：提案级三层集合」中计算受影响场景的一步，其余步骤不变。

### 场景目标

分层验收开启的项目上，提案的 delta 改了测试用例文档时，verify 逐份文档确认其中的用例有没有变化：有变化才把对应场景计入受影响场景。只调整「主链路用例」小节、覆盖说明、追溯表的提案，不再把这些场景的全部用例并入提案级验收集合；删除用例、把用例移到别的文档时，原场景照常并入。

### 参与者

| 别名 | 组件 | 说明 |
|---|---|---|
| CLI | `openlogos verify` | 发起提案级验收集合的计算，输出 `layers` |
| Layer | 分层验收的集合计算 | 计算受影响场景集合 AS 与三层合集（§2.109.5、§2.109.6） |
| Touch | delta 触及判断 | 对提案 `deltas/` 下的场景文档与测试用例文档给出被触及的场景 |
| Marker | `SPEC_MERGED` | 提供测试变更集的状态与合并基线（逐目标的合并前内容证据、合并后 sha256） |
| Git | git 对象库 | 按合并基线记录的 blob 读回合并前内容 |
| Compare | 用例行比较 | 构建测试变更集使用的同一套比较，本场景中每次只送入一份文档 |

### 前置条件

- `verify.layered.enabled: true`，存在活跃提案。
- 提案 `deltas/test/` 下至少有一份 `<module>-SXX-test-cases.md`。

### 成功后置条件

- 受影响场景集合中，来源 `delta` 的场景恰为：有场景文档 delta 的场景，加上测试用例文档的用例有变化（或按文件名判断）的场景。
- `layers.affected.scenarios` 的结构与来源取值不变；不读取、不改写任何提案产物。

### 时序图

```mermaid
sequenceDiagram
    participant CLI as openlogos verify
    participant Layer as 集合计算
    participant Touch as delta 触及判断
    participant Marker as SPEC_MERGED
    participant Git as git 对象库
    participant Compare as 用例行比较

    CLI->>Layer: Step 1: 计算提案级验收集合
    Layer->>Touch: Step 2: 请求本提案 delta 触及的场景
    Touch->>Touch: Step 3: 场景文档 delta 按文件名记为触及
    Touch->>Marker: Step 4: 读取测试变更集状态与合并基线
    Marker-->>Touch: Step 5: 状态（未合并 / 有效 / 无效）与基线（可能没有）
    alt 未合并或变更集无效
        Touch->>Touch: Step 6: 每份测试用例文档按文件名记为触及
    else 已合并且变更集有效
        loop 每一份测试用例文档 delta
            Touch->>Marker: Step 7: 取该文档在基线中的目标记录
            Touch->>Git: Step 8: 按记录读回合并前内容并复核 sha256
            Git-->>Touch: Step 9: 合并前内容，或读取失败
            Touch->>Touch: Step 10: 读取工作区当前内容并与基线的合并后 sha256 核对
            alt 任一步无法得到可信内容
                Touch->>Touch: Step 11: 该文档按文件名记为触及
            else 两侧内容可信
                Touch->>Compare: Step 12: 只送入这一份文档的前后内容
                Compare-->>Touch: Step 13: 新增、修改、删除的用例
                Touch->>Touch: Step 14: 有任何一条即记为触及，否则不记
            end
        end
    end
    Touch-->>Layer: Step 15: 被触及的场景集合
    Layer-->>CLI: Step 16: 受影响场景（声明 ∪ delta 触及）与三层合集
```

### 步骤说明

1. **CLI** 进入分层验收的集合计算（Step 1），这是「S13 分层验收：提案级三层集合」中计算受影响场景的一步。
2. **集合计算** 向触及判断请求本提案 delta 触及的场景（Step 2）。
3. **触及判断** 先处理场景文档：`deltas/prd/3-technical-plan/2-scenario-implementation/` 下文件名含 `-SXX-` 的文件，SXX 直接记为触及（Step 3）。
4. **触及判断** 读取 `SPEC_MERGED`：测试变更集的状态（与跳过分类同一读取结果）和合并基线（Step 4、5）。
5. 提案未合并、或测试变更集无效时，`deltas/test/` 下每一份 `<module>-SXX-test-cases.md` 都按文件名记为触及（Step 6），不进入后续步骤（EX-13.67）。
6. 已合并且变更集有效时，对每一份测试用例文档 delta：
   - 取它对应的合并目标在合并基线中的记录（Step 7）；记录为新建（`CREATE`）时合并前内容为空；
   - 按记录的 blob 从 git 对象库读回合并前内容，并以记录的 sha256 复核（Step 8、9）；
   - 读取工作区当前文件，并与记录的合并后 sha256 核对（Step 10）。
7. 任一步得不到可信内容时，这份文档按文件名记为触及（Step 11，EX-13.66）；其他文档继续判断。
8. 两侧内容可信时，把这一份文档的前后内容单独送入用例行比较（Step 12、13）。结果中有新增、修改或删除的用例，即记为触及；一条都没有则不记（Step 14，EX-13.64）。
9. **触及判断** 返回被触及的场景集合（Step 15）；**集合计算** 与声明中的已识别场景取并集，按既有规则得到受影响用例与三层合集（Step 16）。

### 异常与边界

#### EX-13.64：测试用例文档的 delta 没有改动用例
- **触发条件**：提案已合并且测试变更集有效；S21 的测试用例文档可以逐份判断（Step 7～10 都得到可信内容，Step 12、13 的比较成功完成）；这份文档的 delta 只改了「主链路用例」小节、覆盖说明、追溯表、导言等不属于任何用例的内容，比较结果中没有新增、修改或删除的用例；没有 S21 的场景文档 delta。同样的 delta 在无法逐份判断时不属于本条，按 EX-13.66 处理（按文件名记为触及）；提案未合并或测试变更集无效时按 EX-13.67 处理。
- **期望响应**：S21 没有 `delta` 来源。声明了 S21 时照常计入，来源只有 `declared`。新列入「主链路用例」小节的用例作为主链路用例在提案集合内。不输出任何额外字段或提示。
  - S21 的其余用例是否执行由集合的其他规则决定：声明可用、没有任何扩大、这些用例也不属于本提案用例或主链路用例时，它们不在提案集合内；触发扩大规则时（如声明 `shared_change: true` 扩大到全量，EX-13.32）照常进入集合并执行，此时 S21 仍然没有 `delta` 来源。
- **副作用**：无。

#### EX-13.65：删除用例与跨文档移动用例
- **触发条件**：提案已合并且测试变更集有效；① 只从 S21 的文档删除一条用例（编号可以不含场景号，如 `UT-JSON-09`）；② 把一条用例从 S21 的文档原样移到 S22 的文档，编号不变。
- **期望响应**：① S21 计入，来源 `delta`；② S21 与 S22 都计入，来源 `delta`。判断不依赖提案汇总的 `changed_test_ids` / `removed_test_ids`，也不依赖编号中的场景号。
- **副作用**：无。

#### EX-13.66：无法逐份文档判断
- **触发条件**：提案已合并且测试变更集有效，但对某一份测试用例文档：`SPEC_MERGED` 中没有合法的合并基线；基线中找不到该文档对应的目标；合并前内容读不回或 sha256 复核不过；工作区当前文件不存在，或其 sha256 与基线记录的合并后 sha256 不一致；用例行比较报错。
- **期望响应**：这份文档按文件名记为触及，来源 `delta`；同一提案中其他可以判断的文档照常按用例变化判断。不报错，不新增原因代码。
- **副作用**：无；不向 git 对象库写入。

#### EX-13.67：提案未合并或测试变更集无效
- **触发条件**：活跃提案没有 `SPEC_MERGED`；或已有 `SPEC_MERGED` 但测试变更集无效。
- **期望响应**：范围计算把 `deltas/test/` 下每一份 `<module>-SXX-test-cases.md` 都按文件名记为触及。命令对外的响应沿用既有出口：
  - 未合并：输出中这些场景来源 `delta`，本提案用例为空（EX-13.40）。
  - 变更集无效、不是多切片提案：输出中这些场景来源 `delta`；门禁以 `test_change_set_invalid` 判 FAIL（EX-13.14）。本轮没有结果账本或没有用例定义时，既有的早退出口不输出 `layers`，同样不变。
  - 变更集无效、是多切片提案：切片清单暂停出口先行返回——`reason="test-slice-manifest-invalid"`、`human_action_required=true`、退出码 2，输出中没有 `gate` 与 `layers`。本场景不改变这一提前返回的优先级。
- **副作用**：无。多切片提案的暂停出口保持零推进：不启动测试入口，不写入、不推进门禁、循环计数、checkpoint 与验收标记。

#### EX-13.68：同一场景既有场景文档 delta 又有没改用例的测试用例文档 delta
- **触发条件**：提案 `deltas/` 中同时有 S21 的场景文档和 S21 的测试用例文档，后者没有改动用例。
- **期望响应**：S21 因场景文档计入，来源 `delta`。
- **副作用**：无。

#### EX-13.69：同一提案中的文档互不影响
- **触发条件**：同一个已合并提案改了两份测试用例文档，S21 的只改「主链路用例」小节，S22 的既改小节又修改了一条用例；声明只有 S22。
- **期望响应**：S22 计入，来源 `declared` 与 `delta`；S21 不带 `delta` 来源、不计入。S21 新列入的主链路用例在提案集合内并被执行。
- **副作用**：无。

### 追溯

- 需求：AC-VERIFY-TIER-07（修改）、AC-VERIFY-TIER-23～AC-VERIFY-TIER-25。
- 功能规格：§2.109.5、§2.109.15。
- 测试：`core-S13-test-cases.md`（UT-S13-294～UT-S13-308、ST-S13-55、ST-S13-56；多切片提案的暂停出口另见 `core-S32-test-cases.md` 的 UT-S32-48、ST-S32-16）。
