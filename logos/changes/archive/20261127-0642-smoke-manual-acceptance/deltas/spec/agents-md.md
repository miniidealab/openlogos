## ADDED — 两档授权语义的「等待人工验收」硬红线条目（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（功能规格 §2.107.9；沿用 D14）。本节规定 `openlogos init` / `sync` 生成的 AGENTS.md / CLAUDE.md 托管段「两档授权语义」中新增的一条硬红线。既有两条硬红线（`gate:implement:loop-exhausted`；部署审批 / 晋级的 `DEPLOY_APPROVAL_REQUIRED` / `DEPLOY_PROMOTION_UNVERIFIED`）原样保留，新条目紧随部署审批条目之后。

### 生成规则

1. 生成位置：「⛔ 变更管理（强制执行）→ 两档授权语义」的硬红线列表末尾，在部署审批条目之后。生命周期为 `initial` 时，该段整段不生成，本条也不生成；`mixed` 视图按「混合生命周期项目的变更管理条款生成」与其他硬红线一起生成。
2. zh 文案（逐字）：

   ```markdown
   - **硬红线（任何模式、含 `--auto` 都不放行）**：冒烟阶段「等待人工验收」且仍有未记录的人工用例（smoke `gate.result=PENDING` / `manual_acceptance_pending`，驻留态 `awaiting-manual-acceptance`）——人工验收结果只能由人记录。AI 不得执行 `openlogos accept`（任何参数形态），不得修改 `logos/environments.yaml` 的 `manual_acceptance` 来关闭人工验收，也不得为人工用例伪造 smoke 结果；人在终端或 RunLogos 界面记录后，宿主重新驱动 `openlogos smoke` 即可继续。
   ```

3. en 文案（逐字）：

   ```markdown
   - **Hard red line (never auto-passed in ANY mode, including `--auto`)**: the smoke stage is "awaiting manual acceptance" with unrecorded manual cases (smoke `gate.result=PENDING` / `manual_acceptance_pending`, stage `awaiting-manual-acceptance`) — manual acceptance results can only be recorded by a human. AI must never run `openlogos accept` (in any form), edit `manual_acceptance` in `logos/environments.yaml` to turn manual acceptance off, or fabricate smoke results for manual cases; once a human records the results in a terminal or the RunLogos UI, the host re-drives `openlogos smoke` to continue.
   ```

4. 托管段的其余文字（含 Guard 机制、变更流程、行为约束、保护范围配置）逐字不变。重复执行 `sync` 零变化。

### 一致性与验证

- 生成结果由 `core-S08-test-cases.md`（UT-S08-93 起）断言：中英两份文案逐字出现在托管段的硬红线列表中，位于部署审批条目之后；`initial` 生命周期不出现；重复 `sync` 零变化。
- 与 `spec/change-management.md`「冒烟阶段人工验收硬红线（smoke-manual-acceptance）」同口径。
