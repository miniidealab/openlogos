# core-S09-change-lifecycle delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — archive 链条 fail-closed 校验

### 问题：归档端不设防让缺口被固化

20260907 事故中，`fix-guard-check-bash-write-target-jurisdiction` 提案在 `DEPLOY_DONE` 缺失（执行 Agent 漏跑 `openlogos deploy-done`）的状态下被成功归档：`cli/src/commands/archive.ts` 不检查 `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS` 中的任何一个。归档是 audit-only 终态，缺口一旦被归档就永久固化——链条断点在归档记录里再也看不出来。archive 是生命周期链条的**末端兜底**，必须 fail-closed。

### 校验规则

`openlogos archive <slug>` 在移动提案目录**之前**校验完成链条，顺序固定 ①→②→③，命中即停：

| # | 条件 | 适用范围 | 错误码 | 补救命令 |
|---|---|---|---|---|
| ① | `VERIFY_PASS` 存在且 `VERIFY_FAIL` 不存在 | 全部提案 | `ARCHIVE_VERIFY_NOT_PASSED` | `openlogos verify` |
| ② | `DEPLOY_DONE` 存在 | 仅 `deployment_required=true` | `ARCHIVE_DEPLOY_NOT_DONE` | `openlogos deploy-done` |
| ③ | `SMOKE_PASS` 存在且 `SMOKE_FAIL` 不存在 | 仅 `deployment_required=true` 且 `smoke_required=true` | `ARCHIVE_SMOKE_NOT_PASSED` | `openlogos smoke` |

`deployment_required` / `smoke_required` 按 `spec/change-management.md`「提案级部署决策优先级」解析：活跃提案的 `proposal.md` 优先，`tasks.md` 的 `[deploy]` section 为结构化证据，模块级默认值不得覆盖提案的明确决策。

### fail-closed 语义（强制）

拒绝时**不移动提案目录、不删除 `logos/.openlogos-guard`、不产生任何部分状态更新**。`openlogos archive` 保持纯文本命令（不新增 stdout JSON envelope，与既有 `ARCHIVE_WATCH_*` 一致），以稳定错误码文本写 stderr 并非零退出，message 携带上表的补救命令。

**与 Windows 归档握手的顺序**：链条校验在最前——「链条校验 → 握手（`ARCHIVE_WATCH_*`）→ rename」。链条不满足时根本不建立握手请求，不占用协议目录、不惊动监听实例。

### 两档模式语义

校验只关命令自身的上游事实，不新增人类确认点。半自动下 archive 仍需人类明确授权；`--auto` 下 standing 授权照常放行执行，但**放行的是"运行 archive 这个动作"，不是"跳过链条门"**——链条不满足时 `--auto` 同样 fail-closed 拒绝。这与硬红线语义一致：全自动放行只发生在「已绿/已盖章」之后，绝不跨越未完成的链条。

### 零回归边界

- 无需部署的提案链条只到 ①，`VERIFY_PASS` 后照常归档。
- `deployment_decision_conflict=true` 时 archive 本就不得作为主动作（`spec/change-management.md`「提案级部署决策优先级」第 6 条），语义不变。
- 归档 audit-only 定位（S37）、commit 粒度规则、guard 释放行为在校验通过后逐项不变。
- Windows 归档握手协议（`ARCHIVE_WATCH_PREPARE_FAILED` / `ACK_TIMEOUT` / `INSTANCE_FAILED` / `STATE_INCONSISTENT`）行为不变。

### EX-9.13: 缺 VERIFY_PASS 的归档请求
- **触发条件**：活跃提案 `VERIFY_PASS` 缺失，或 `VERIFY_FAIL` 在场。
- **期望响应**：`ARCHIVE_VERIFY_NOT_PASSED` 写 stderr 并非零退出，提示 `openlogos verify`。
- **副作用**：零——目录未移动、guard 未删除、未建立握手请求。

### EX-9.14: 需部署提案缺 DEPLOY_DONE 的归档请求
- **触发条件**：提案 `deployment_required=true` 但 `DEPLOY_DONE` 缺失（漏跑 `openlogos deploy-done`）。
- **期望响应**：`ARCHIVE_DEPLOY_NOT_DONE` 拒绝，提示 `openlogos deploy-done`。即使 `SMOKE_PASS` 在场（本次事故的孤儿状态）也照常拒绝——smoke 结论不能反推部署完成。
- **副作用**：零。

### EX-9.15: 需 smoke 提案缺 SMOKE_PASS 的归档请求
- **触发条件**：提案需部署且需 smoke，`DEPLOY_DONE` 在场但 `SMOKE_PASS` 缺失，或 `SMOKE_FAIL` 在场。
- **期望响应**：`ARCHIVE_SMOKE_NOT_PASSED` 拒绝，提示 `openlogos smoke`。
- **副作用**：零。

### 与 smoke 门的纵深防御关系

S19 的 smoke 前置门是链条中段，本节的 archive 链条门是末端兜底。本次事故中两道门同时缺席，单点漏标才得以一路走到归档并被固化。两门叠加后：漏标 → smoke 拒绝（缺口在最早处暴露）；即使 smoke 因历史版本或旁路被绕过 → archive 仍拒绝（缺口不被固化）；两门都被绕过的历史提案 → 由 `status` / `next` 的 `state_inconsistency` 对账投影点名（S11 / S05）。
