# Delta: cli-json-output.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`spec/cli-json-output.md`

## REMOVED — Authority Closure JSON 契约 [1]

空标题壳（第 1 处），正文已随 lite-cut2a 删除。

## REMOVED — Authority Closure JSON 契约 [1]

空标题壳（原第 2 处——合成顺序作用于变动中的文档，删掉第 1 处后它成为新的第 1 处）。

## REMOVED — verify data

本节定义 `openlogos verify --format json` 的 `checklist` 与 `ac_trace` 字段结构，以及 `checklist_incomplete` / `ac_trace_incomplete` 两个 Gate 失败原因。verify 判定层收敛后（§2.75）二者不再产出，本节失去定义对象。

envelope 的通用结构与 `summary` / `gate` / `uncovered` 字段**逐条保留**——ID 覆盖检查是收敛后仅存的那一条判据。
