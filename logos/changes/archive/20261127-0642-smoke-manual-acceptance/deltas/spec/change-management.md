## ADDED — 冒烟阶段人工验收硬红线（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（功能规格 §2.107.9；沿用 D14）。本节补充「变更工作流 → 核心原则（两档模式）→ 无人值守模型」第 3 类硬红线，其余条目不变。

- **第三条硬红线**：冒烟阶段「等待人工验收」，且剩余清单非空。
  - 触发信号：smoke `gate.result=PENDING`、`gate.reason=manual_acceptance_pending`，next / status 驻留态 `awaiting-manual-acceptance`，且 `auto_execute=false`。
  - 任何模式、含 `--auto`，都不自动放行。
- **AI 在任何模式下都不得**：
  - 执行 `openlogos accept`（guard 受限命令，见 `spec/pretooluse-guard.md`「保护范围变更的宿主原生审批（C14）」）；
  - 修改 `logos/environments.yaml` 的 `manual_acceptance` 来关闭人工验收（写了该字段的登记表受 guard 保护）；
  - 为人工用例伪造 smoke 结果（`manual_smoke_result_id` 会使门禁 FAIL）。
- **恢复**：人在终端或 RunLogos 界面记录全部结果后，剩余清单为空，next 建议重跑 `openlogos smoke`。这一步属于既有的第 2 类红线步骤（`smoke`），`--auto` 下由 standing 授权重新驱动，半自动下仍需用户授权。不新增恢复机制、flow 节点、门或提案标记。
- **结论过期不是绕道**：通过后若又记录了人工结果，原 `SMOKE_PASS` 过期，archive 以账本核对拒绝（`smoke_pass_expired`），须重跑 smoke。AI 不得手工恢复或保留过期的 `SMOKE_PASS`。
- 未开启人工验收的环境不受本条影响：人工用例只在报告中列出，不阻断。
