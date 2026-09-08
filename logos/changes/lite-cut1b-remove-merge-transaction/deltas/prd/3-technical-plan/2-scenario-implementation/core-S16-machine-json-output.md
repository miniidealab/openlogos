# Delta: core-S16-machine-json-output.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`

## REMOVED — S16 Merge transaction 消费者 JSON 合同补充

跨仓消费方按 `schema_sha256` / `contract_sha256` 精确匹配事务投影的合同，随事务删除。

## REMOVED — S16 Preflight/Reopen 机器输出同源合同

preflight/reopen 的机器输出依附于事务相位与 `missing_slot_ids`，随事务删除。

## REMOVED — S16 merge 事务投影必挂与失败路径结构化错误码的机器消费时序

事务投影必挂要求随事务删除；merge 的失败路径改为通用错误 envelope，见 `spec/cli-json-output.md` 的 merge 直接合并输出契约。
