# Delta: baseline-closure.md

> change: lite-cut2c-spec-hygiene-and-anchors
> 目标：`spec/baseline-closure.md`

lite-cut2b 废止本规范时逐节枚举，遗漏了 4 节。其中两节引用的合并事务早在 lite-cut1b 就已删除，自那时起即为悬空定义——这正是「靠人逐节枚举必然会漏」的实证。

## REMOVED — 18. 测试变更集原子固化

本节定义 `openlogos/baseline-merge-apply@1` 严格 Agent 输入与 `MERGE_APPLY_MANIFEST.json` 字段合同。`merge-apply` 命令已随 lite-cut1b 删除，本节自那时起悬空。

## REMOVED — 合并事务中的 baseline closure

本节定义闭包在合并事务 slot/seal/apply 各相位中的求值时机。合并事务已随 lite-cut1b 删除、闭包已随 lite-cut2b 删除，本节两头落空。

## REMOVED — 消费者可提交闭包与无环 hash

本节定义提交闭包的路径集合恒等式与 hash 计算顺序，其 `protocol_artifact_paths` 直接引用已删除的 `MERGE_RECEIPT.json`。

## REMOVED — 19. Seal-bound Preflight 与 Test-change-set 归因

本节定义 seal 阶段绑定的 preflight 与其归因口径。seal 相位已随 lite-cut1b 删除。
