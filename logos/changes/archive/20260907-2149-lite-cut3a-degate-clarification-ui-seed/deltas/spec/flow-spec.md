# Delta: flow-spec.md

> change: lite-cut3a-degate-clarification-ui-seed
> 目标：`spec/flow-spec.md`

## REMOVED — 节点二：`verify-ui-provenance`（merge 前拦漂移）

本节定义 GUI overlay 的 `verify-ui-provenance` 节点及其 `done_when: cmd:openlogos check-ui-hash-match` 门语义。UI provenance 由阻断门降为警告（§2.74.2），该 overlay 节点随之移除。

`write-ui-prototype` 节点与 `check-ui-prototype` / `check-ui-hash-match` 两个命令**逐条保留**——后者从「门」变成用户主动运行的诊断。
