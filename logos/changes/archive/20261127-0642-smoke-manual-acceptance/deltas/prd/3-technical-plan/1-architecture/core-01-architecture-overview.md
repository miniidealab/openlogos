## ADDED — 五十九、冒烟阶段人工验收：账本 manual 记录与待验收清单

> 来源变更：smoke-manual-acceptance（决策 C01～C03；proposal-r1 F1～F6、proposal-r2 F3/F6 处置）。功能规格见 §2.107；场景见 `core-S46-smoke-manual-acceptance.md`、`core-S19-smoke-gate.md`「S19 SMOKE 人工标记读取与人工判定接入」、`core-S41-environment-registry.md`「人工验收字段（smoke-manual-acceptance）」、`core-S05-next-guidance.md`「等待人工验收的 next 建议」、`core-S09-change-management.md`「S09 人工验收记录命令受限与开关字段保护」；权威格式见 `spec/environments.md` §15。

### 59.1 目标与边界

- 让需要人参与的用例（`[manual]` 的 UT / ST / SMOKE）在部署后的冒烟验收中，按环境开关被执行、由人记录、以部署为单位留证，并能跨提案累积。
- **复用而非新建**：
  - 人工结果写进既有本机部署账本，成为第四类记录 `kind=manual`，复用账本锁、原子追加、失败补偿与流式读取；
  - 等待状态写成 smoke 记录的 `result=pending`；
  - 「只能由人产生」沿用部署审批（五十五）的受限命令与宿主原生审批（D14）；
  - 开关字段并入「已配置门禁的登记表」保护。
- **不新增**：提案标记、flow 节点、门、恢复机制，以及证据文件的存储与校验。RunLogos 的展示与记录界面属 RunLogos #34。

### 59.2 组件

| 组件 | 变化 |
|---|---|
| `cli/src/lib/smoke-coverage.ts` | 首格读法容忍 `[manual]` / `[manual/<平台>]`；人工行计入「文件存在表格用例行」，不触发全文回退；输出自动集合与人工集合两份 |
| `cli/src/lib/manual-acceptance.ts`（新增） | 在给定 commit 上枚举测试规格中的人工用例行（`git ls-tree` + `git show`）；计算 P(E, D)：基线增量、首次全量、回归用例解析；目标版本不可读时返回 `scope_unresolved`；基线不可读时降级为全量并给出警告；关闭环境计算 `unexecuted`（相对 `previous_ref`） |
| `cli/src/lib/environments.ts` | 登记表 `manual_acceptance` 字段校验与字段名字面量检查；账本 `kind=manual` 行与 smoke `result=pending` 行的写入与逐行校验；流式扫描中按环境推导当前部署、未过期的人工通过记录（基线）、晋级候选（只认未过期的 `verified` 记录）、等待状态与剩余清单；EnvView 的 `manual_acceptance` |
| `cli/src/commands/accept.ts`（新增） | 参数与前置检查；账本锁内重读、核对 `--deploy` 与清单成员、追加 manual 行；提案通道删除 `SMOKE_PASS`，失败时撤销本次账本行 |
| `cli/src/commands/smoke.ts` | 自动用例为零时走空自动阶段；人工阶段判定；账本锁内复核后落账；`PENDING` 写 pending 行并清除旧标记（版本通道只写账本）；报告与 JSON |
| `cli/src/lib/lifecycle-gate.ts`、`cli/src/commands/archive.ts` | `DEPLOY_DONE` 的环境已开启人工验收（即使本部署没有任何人工记录），或本部署已有人工记录时，在 `SMOKE_PASS` 之外按账本核对本部署 D 自己的最近有效结论：D 最近一条 smoke 记录为 pass（开启时还须 `manual_passed=true`），且其后没有 D 的 manual 记录；其他部署的记录与标记不算，否则 `smoke_pass_expired`（评审 delta-r1 F1、delta-r2 F1） |
| `cli/src/commands/deploy.ts` | 晋级判定读取的已验证集合排除过期记录（由 `environments.ts` 推导提供，判定代码只换数据来源） |
| `cli/src/lib/flow-derive.ts`、`cli/src/commands/next.ts`、`cli/src/commands/status.ts` | 新增驻留态 `awaiting-manual-acceptance`；剩余为空时给出重跑 smoke 的建议 |
| `plugin/bin/guard-check`、`plugin-cursor/hooks/runtime.cjs` | 受限命令类别新增 `accept`；「已配置门禁的登记表」识别字段新增 `manual_acceptance` |
| `plugin-qoder/hooks/runtime.cjs`、`plugin-workbuddy/hooks/runtime.cjs`、`plugin-zcode/runtime/hook-runtime.js` | `decideGuard` 在 initial 生命周期与安全命令的提前放行之前，对含 `openlogos accept` 的命令一律拒绝（这些宿主不能保证可靠的原生审批；评审 delta-r1 F3） |
| `cli/src/commands/init.ts` | 生成指令硬红线新增「等待人工验收」，中英各一份 |
| `cli/src/index.ts` | 注册 `accept` 与帮助文本 |

### 59.3 数据流

```text
登记表 manual_acceptance ─┐
                          ▼
deploy（D, ref=R）──▶ 账本 deploy 行
                          │
openlogos smoke --env E ──┤ 自动阶段（既有规则 / 自动用例为零时空通过）
                          │ PASS
                          ▼
manual-acceptance.ts：git ls-tree/show @R  vs  @B（账本中未过期的 manual_passed 记录）
                          │  → P(E, D) = 增量 ∪ regression；R 不可读 → scope_unresolved
                          ▼
取账本锁 → 重读 D 的 manual 行 → 人工阶段判定（锁内复核）
   ├─ FAIL（scope / regression / cases）→ smoke 行 result=fail → SMOKE_FAIL
   ├─ PASS → smoke 行 result=pass, manual_passed=true → SMOKE_PASS
   └─ PENDING → smoke 行 result=pending, manual_pending=P−已记录 → 清除旧标记（版本通道只写账本）

openlogos accept --env E --deploy D --case … ──▶ 取账本锁 → 核对 D 为当前部署、case∈P → 追加 manual 行
                                                  └─ 活跃提案 DEPLOY_DONE.deploy_id==D → 删除 SMOKE_PASS

next / status / env show ──▶ 只读账本：最近 smoke 行 pending → manual_pending − 其后 manual 行 = 剩余清单
archive ──▶ 环境已开启人工验收（D 零条 manual 行也核对），或 D 已有 manual 行时：
             D 自己的最近 smoke 行为 pass（开启时 manual_passed=true）且其后无 D 的 manual 行，否则 smoke_pass_expired
```

### 59.4 单一写入者与顺序

- **账本**仍是唯一事实源，写入方新增 `accept`（manual 行）；smoke 新增 pending 行。所有追加都在同一把账本锁的短临界区内完成。
- **smoke**：锁外计算 P（读 git，可能较慢），锁内只重读账本中 D 的 manual 行并重新判定人工阶段，判定与追加处在同一临界区。之后沿用 §5.1 的「先账本、后标记」与快照恢复。
- **accept**：锁内核对并追加；提案通道在追加之后删除 `SMOKE_PASS`，删除失败时按整行原文撤销本次追加。
- **过期以账本行序判定**：manual 行晚于某条通过记录，即使它过期。锁内复核保证晚于 manual 行写入的通过记录已采纳该 manual 行。标记是投影，可能被并发重跑写回，archive 以账本为准再核对一次。

### 59.5 与部署审批门（五十五）的异同

| 方面 | 部署审批 | 人工验收 |
|---|---|---|
| 「人批过」的产生 | `openlogos approve`，受限命令、宿主原生审批 | `openlogos accept`，同一机制 |
| 账本记录 | `kind=approval` | `kind=manual`，以及 smoke `result=pending` |
| 绑定对象 | 环境 + commit（一次部署使用） | 环境 + `deploy_id`（重新部署即作废） |
| 停在何处 | deploy 前置检查报错（`DEPLOY_APPROVAL_REQUIRED`） | smoke 结论 `PENDING`，驻留态 `awaiting-manual-acceptance` |
| 恢复 | 审批后重新驱动 deploy | 记录后重新驱动 smoke |
| 门禁策略来源 | `promote_from` / `require_approval`，受门环境 | `manual_acceptance`，**不**构成受门环境，只纳入登记表保护 |
| 提案标记 | 不新增 | 不新增；PENDING 时清除旧的 `SMOKE_PASS` / `SMOKE_FAIL` |

### 59.6 性能与降级

- P 的计算按 commit 读取规格文件，一次 smoke 最多读两个 commit 的测试规格目录；只在存在人工用例且需要判定时执行。next / status / env show 不读 git。
- 浅克隆、ref 为 null 等目标版本不可读的情况，开启环境 fail-closed（`manual_scope_unresolved`），关闭环境只警告；基线不可读降级为全量。任何情况都不退回工作区。
