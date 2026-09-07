# D12：生命周期命令 fail-closed 校验上游事实，status/next 对矛盾事实显式对账

- **状态**：accepted
- **日期**：2026-09-07
- **来源**：提案 `fix-deploy-done-leak-failclosed-selfheal`；20260907 真实事故（runlogos 面板僵死复盘，提案 `fix-guard-check-bash-write-target-jurisdiction` 现场）

## 背景

`fix-guard-check-bash-write-target-jurisdiction` 的部署与 smoke 全部实际完成，但执行 Agent 漏跑 `openlogos deploy-done`，`DEPLOY_DONE` 缺失。这一个单点遗漏经三处不设防被放大：

1. **smoke 不设防**：S19「smoke 前置依赖 deploy-done」章节早已强制要求四项前置（提案声明需 smoke、部署决策无冲突、`DEPLOY_DONE` 存在、`[deploy]` 全勾），并要求缺标时提示先执行 `openlogos deploy-done`；但 `cli/src/commands/smoke.ts` 完全没有该校验——**规格已定、实现缺失**。smoke 照常执行并写入 `SMOKE_PASS`。
2. **archive 不设防**：`cli/src/commands/archive.ts` 不检查 `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS`，带缺口的提案被成功归档。归档是 audit-only 终态，缺口就此固化。
3. **派生沉默停滞**：`flow-derive` 在 `DEPLOY_DONE` 缺失时永远停在 `ready-to-deploy`，`SMOKE_PASS` 等下游强证据永不被评估。宿主面板长期显示「请执行部署任务」，无任何对账线索——人从输出里看不出缺的到底是什么。

三处的共性不是「某个命令有 bug」，而是**状态机的下游全体不设防、且派生对矛盾事实沉默**。

## 决策

1. **fail-closed 不变量**：生命周期命令（`smoke` / `archive` 等）必须在产生任何副作用之前，fail-closed 校验其上游事实标记；不满足即以稳定错误码拒绝，且**零副作用**（不写 marker、不生成报告、不移动目录、不删 guard）。错误 message 必须携带一条可直接执行的补救命令。
2. **显式对账不变量**：`status` / `next` 检测到事实矛盾（派生停在 `ready-to-deploy` 而下游存在 `SMOKE_PASS` / `SMOKE_FAIL` 或 `[deploy]` 已全勾）时，必须输出只读投影 `state_inconsistency`（`kind` / `evidence` / `remediation`）并在人读引导中给出补救命令，**不得沉默停滞**。
3. **唯一 writer 不变**：`DEPLOY_DONE` 的唯一 writer 仍是 `openlogos deploy-done`。任何消费者都不得写入或补写该 marker，也不得由「smoke 已过」反推「部署已完成」。消费者只能拒绝（fail-closed）或点名（对账投影）。
4. **`--auto` 不放宽**：standing 授权放行的是「运行该命令这个动作」，不跳过前置门；链条不满足时全自动同样 fail-closed。

## 理由

**为什么下游必须设防**：上游写者是人或 Agent 执行的一步操作，遗漏概率永远不为零。把正确性完全押在「写者不会漏」上，等于把单点遗漏的后果留给下游全体承担——本次事故正是如此，一次漏跑污染了 smoke 结论、归档记录与面板状态三处。fail-closed 让漏标**造不出来**：缺口在最早的消费点就被拒绝，且拒绝零副作用，状态机不会进入自相矛盾的中间态。

**为什么派生必须显式对账**：fail-closed 只能防住未来，防不住已经存在的缺口（历史提案、旧版本 CLI 写下的状态、任何旁路）。派生对矛盾沉默时，缺口会表现为「一切正常但永不前进」——这是最难诊断的故障形态。显式对账让缺口**藏不住**：矛盾在下一次 `status` / `next` 调用时即被点名，并附一条命令的补救路径。两者叠加，缺口既造不出来、也藏不住。

**为什么对账只点名不修复**：修复动作跨越了「机器推断」与「人类确认」的边界（见备选方案 1）。点名是纯粹的事实陈述，不承担授权语义，因此可以无条件、无副作用地做。

## 备选方案

- **smoke 检测到缺标时自动补写 `DEPLOY_DONE`（auto-heal）**：被否。① 绕过半自动模式下 `deploy-done` 的人类确认点语义——`DEPLOY_DONE` 表达的是「人确认部署已完成」，机器不能代人确认；② 把「人确认过」与「机器推断」混为同一事实，此后无法从 marker 反查它由谁写下；③ 掩盖遗漏本身——漏跑不再产生任何可见后果，流程纪律随之退化。该方案将来很可能被重新提出（「反正 smoke 都过了，顺手补上多方便」），本记录明确其否决理由。
- **只做 fail-closed，不做对账投影**：被否——防不住已存在的缺口，本次事故遗留的僵死状态无法自愈，面板仍需人工诊断。
- **只做对账投影，不做 fail-closed**：被否——缺口仍会持续产生，投影只是把噪音显示得更清楚，`SMOKE_PASS` 与归档记录仍会被污染。
- **让 `state_inconsistency` 改写 `proposal_step` 派生（如直接跳到 `ready-to-smoke`）**：被否——那等于用推断替代事实，与决策 3 的唯一 writer 不变量直接冲突，且会让下游门禁基于推断放行。

## 影响面

- 约束 `openlogos smoke` / `openlogos archive` 实现：产生副作用前必须完成前置链条校验，拒绝分支零副作用。
- 约束 `status` / `next` / `watch` 派生：矛盾事实必须投影，且投影保持只读、不改派生、零漂移。
- 约束未来新增的生命周期命令：任何消费上游事实标记的命令都适用本不变量。
- 约束宿主（RunLogos 等）：不得据 `state_inconsistency` 自动补写 marker；不得据 `--auto` 期望跳过前置门。
- 相关规格：`spec/change-management.md`（生命周期命令前置链条语义）、`spec/cli-json-output.md` §3.17 / §5.5 / §6.3；功能规格 §2.11.1、§2.67；场景 S05 / S09 / S11 / S19 / S21。

## 来源

- 提案：`fix-deploy-done-leak-failclosed-selfheal`
- 事故现场：提案 `fix-guard-check-bash-write-target-jurisdiction`（20260907，runlogos 面板僵死）
- 关联：S21 场景文档（`DEPLOY_DONE` 唯一 writer 与消费侧收口）、`spec/change-management.md` 变更工作流步骤 10–12
