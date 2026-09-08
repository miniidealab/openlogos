# Delta: core-S19-smoke-gate.md

> change: lite-cut1b-remove-merge-transaction
> 目标：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`

## REMOVED — S19 OpenLogos 0.14.2 Preflight/Reopen 候选门

该候选门要求在安装态验证合并事务的 preflight 与局部 reopen，随事务删除而失去验证对象。

## REMOVED — S19 切片事务的安装态覆盖要求

切片事务已由 `lite-cut1a-remove-slice-transaction` 删除，本节的安装态覆盖要求随之失去验证对象——1a 未将 S19 纳入目标集，此处为其遗留清理。

## REMOVED — S19 单切片事务终态判定的安装态覆盖（fix-apply-verdict-not-applicable-vs-invalid）

单切片事务终态三分支已随 1a 删除，本节安装态覆盖要求同样失去验证对象，一并清理。
