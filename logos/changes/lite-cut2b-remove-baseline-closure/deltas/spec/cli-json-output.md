# Delta: cli-json-output.md

> change: lite-cut2b-remove-baseline-closure
> 目标：`spec/cli-json-output.md`

## REMOVED — change-lint L9 与 seed 非阻断动作契约（S39）

本节定义 change-lint envelope 中 `data.baseline_closure` 摘要的字段结构、`baseline_closure_*` violation 码族，以及 seed 相关的非阻断动作投影。L9 删除后该摘要不再产出、码族从码表整体移除，本节失去定义对象。

envelope 的通用结构（`ok` / `data` / `error.code` / issues 稳定排序）与其余检查项的投影不受影响。
