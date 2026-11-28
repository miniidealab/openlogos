## ADDED — 写入前置条件：目标提案与模块（verify-scope-fields-and-slice-module）

本节约束 §2 的写入者 `openlogos slice plan`，补充 §3 中 `change`「等于活跃 guard slug」、`module`「等于活跃 guard module」两条约束在写入侧的落实方式。规则权威见功能规格 §2.110。

### 目标提案必须是活跃提案

写入者在读取输入、暂存 `tasks.md` 与 manifest **之前**确认目标提案：

- 不传 `--slug`：目标为 guard 的 `activeChange`；没有时拒绝（`SLICE_PLAN_NO_ACTIVE_CHANGE`）。
- 传 `--slug X`：要求 guard 的 `activeChange` 等于 `X`。不相等、没有 guard 或 guard 无法解析时拒绝（`SLICE_PLAN_NO_ACTIVE_CHANGE`）。

拒绝属于操作错误（exit 1）：两产物零改写，不留临时文件。写入者不得为非活跃提案生成 manifest，也不得从 `proposal.md` 等其他来源推断其模块。

### 模块解析一次，三处共用

**提案模块取值规则**（全文唯一，写入 §13 Canonical Test Change Set 的 `module` 时已在使用，实现为 `moduleFromGuard`，`cli/src/lib/merge-direct.ts`）：guard 指向该提案且 `module` 去掉首尾空白后非空时，取去掉首尾空白后的值；guard 指向该提案但没有 `module` 字段或其值为空白时，取 `core`。

目标确认后，写入者按该规则解析一次模块。

这一个值同时用于：

1. 读取 §13 的测试变更集时期望的 `module`；
2. §8 Validator 校验暂存产物时期望的 `module`；
3. 写出的 manifest 的 `module` 字段。

三处不得使用不同的值，也不得使用字面量。

### 读取侧使用同一取值规则

§3「`module` 等于活跃 guard module」与 §13「`module` 等于 guard module」中的「guard module」，对写入者与读取者都指按上述规则取值后的结果，不是 guard 文件中的原始字符串。读取者包括：

- verify 的切片状态派生：比对 manifest `module` 的期望值；
- verify 的范围计算读取本提案变更用例：比对测试变更集 `module` 的期望值；
- verify 的门禁读取「严格跳过」所依据的本提案变更用例：比对测试变更集 `module` 的期望值。

`openlogos verify` 一次运行中，凡是以活跃提案的模块作为期望值读取 manifest 或测试变更集的位置都适用，不以上面三处为限；它们必须经同一个取值函数得到该值。任何一处仍使用原始字符串，都会让同一个 guard 在一次运行中对同一份产物给出相反结论（manifest 通过而门禁判 `test_change_set_invalid`）。

三处此前直接使用 guard 的原始 `module` 字符串。guard 的 `module` 带首尾空白时，写入者写出去掉空白的值，读取者以原值严格比较会判 `test-slice-manifest-invalid`（`$.module`）。改用同一规则后两侧一致；guard 的 `module` 不带空白时读取侧的行为不变。

### 验收要求

- 提案登记在非 `core` 模块时，写出的 manifest `module` 等于该模块，读取侧不报 `test-slice-manifest-invalid`。
- `--slug` 指向非活跃提案时命令失败，目标提案的 `tasks.md` 与 manifest 逐字节不变。
- 提案登记在 `core`、或 guard 缺 `module` 字段时，产物与引入前相同（`generated_at` 除外）。
- guard 的 `module` 带首尾空白时，写出的 manifest `module` 为去掉空白后的值，读取侧接受该 manifest 与测试变更集，进入第一个切片的 checkpoint 且该 checkpoint 可以 PASS（门禁不出现 `test_change_set_invalid`）。
