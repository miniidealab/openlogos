# Delta: flow-spec.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`spec/flow-spec.md`（项目根规范，权威）

## REMOVED — Plan completion 与 merge transaction 前沿隔离

前沿隔离依附于事务在盘这一前沿事实源，随事务删除。

## REMOVED — Merge transaction action-command parity 与跨仓交接

动作—子命令固定映射（submit_content→submit-content、seal→seal、apply→apply、recover→recover、abort→abort）随事务命令族删除。merge 节点的派发回归单一动作：执行 `openlogos merge <slug>`。

## REMOVED — Preflight Reopen 后的 Flow 前沿派生

preflight reopen 后的前沿派生依附于事务相位，随之删除。

## REMOVED — 12.10 merge-generated 的权威推进事实（fix-merge-flow-transaction-contract）

`merge-generated` 相位作为事务在盘的派生态随事务删除。merge 节点只有两态：`SPEC_MERGED` 不在场（待合并）与在场（已完成）。
