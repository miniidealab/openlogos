# core-01-requirements delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — 生命周期命令 fail-closed 与状态对账需求

### 用户价值

20260907 真实事故（runlogos 面板僵死复盘）暴露：`fix-guard-check-bash-write-target-jurisdiction` 提案在部署与 smoke 全部实际完成后，因执行 Agent 漏跑 `openlogos deploy-done`，`DEPLOY_DONE` 缺失，随后三处防线全部失效——

1. `openlogos smoke` 在 deploy 门未过的状态下照常执行并写入 `SMOKE_PASS`。而 S19「smoke 前置依赖 deploy-done」章节**早已强制要求**「提案声明需 smoke、部署决策无冲突、`DEPLOY_DONE` 存在、`[deploy]` 全勾」为 smoke 前置校验，并要求缺标时提示先执行 `openlogos deploy-done`；实现（`cli/src/commands/smoke.ts`）完全没有该校验，属**规格已定、实现缺失**的缺陷。
2. `openlogos archive` 同样没有链条校验（`cli/src/commands/archive.ts` 不检查 `VERIFY_PASS` / `DEPLOY_DONE` / `SMOKE_PASS`），带着缺口的提案被成功归档，缺陷被永久固化进归档记录。
3. `status` / `next` 的 step 派生在 `DEPLOY_DONE` 缺失时永远停在 `ready-to-deploy`，`SMOKE_PASS` 等下游强证据永远不被评估——矛盾状态（smoke 已过、deploy 未落标）**沉默停滞**，宿主面板长期显示「请执行部署任务」的僵死提示，无任何对账建议，人也看不出到底缺什么。

用户价值是让漏标**造不出来**（fail-closed 收口）、即使因历史或旁路已存在也**藏不住**（对账投影）：单点遗漏不再放大为长期僵死状态，且任何缺口在下一次 `status` / `next` 调用时即被点名并给出一条命令的补救路径。

### smoke fail-closed 前置校验要求（S19）

1. `openlogos smoke` 在执行 `smoke.command` **之前**必须完成前置校验，任一不满足即 fail-closed 拒绝执行：提案声明需要 smoke（`smoke_required=true`）、提案部署决策无冲突、`DEPLOY_DONE` 存在、`tasks.md` 的 `[deploy]` section 已全部勾选。
2. fail-closed 拒绝时**绝不执行 smoke.command、绝不写 `SMOKE_PASS` / `SMOKE_FAIL`、绝不生成 smoke 报告**；以稳定错误码信封写 stderr 并非零退出，`--format json` 下走通用错误 envelope。
3. 错误信息必须给出**一条可直接执行的补救命令**：缺 `DEPLOY_DONE` 提示先完成部署并执行 `openlogos deploy-done`；`[deploy]` 未全勾提示补齐部署任务后执行 `openlogos deploy-done`。
4. **禁止 auto-heal**：`openlogos smoke` 不得在检测到缺标时自动补写 `DEPLOY_DONE`——那会绕过半自动模式下 `deploy-done` 的人类确认点语义并掩盖遗漏事实。
5. 前置全部满足时行为**零回归**：既有 sandbox、runner / reporter 覆盖判定、gate 判定、skip 统计口径与 `--auto` 自动执行信号逐项不变。

### archive 链条校验要求（S09）

1. `openlogos archive <slug>` 在移动提案目录**之前**必须校验完成链条：`VERIFY_PASS` 存在且 `VERIFY_FAIL` 不存在为必备；提案声明需要部署时还须 `DEPLOY_DONE` 存在；提案同时声明需要 smoke 时还须 `SMOKE_PASS` 存在且 `SMOKE_FAIL` 不存在。
2. 任一不满足即 fail-closed 拒绝：**不移动目录、不删除 guard、不产生任何部分状态更新**，以稳定错误码文本写 stderr 并非零退出（archive 保持纯文本命令，不新增 stdout JSON envelope），并给出对应的补救命令。
3. 无需部署的提案链条只到 `VERIFY_PASS`，行为零回归；`deployment_decision_conflict=true` 时 archive 本就不得作为主动作，语义不变。

### 状态对账投影要求（S05 / S11）

1. `status` / `next` 在活跃提案派生停在 `ready-to-deploy`、但发现**矛盾的下游证据**（`SMOKE_PASS` 或 `SMOKE_FAIL` 在场，或 `[deploy]` 已全勾）而 `DEPLOY_DONE` 缺失时，必须在 `active_change` 上输出只读投影 `state_inconsistency`，含矛盾类型（kind）、具体证据清单（evidence）与补救命令（remediation）。
2. `next` 的人类可读引导必须同步显式给出补救建议（`openlogos deploy-done`），不得继续沉默重复「请执行部署任务」。
3. 该投影为**每次调用的即时只读派生**：不落盘、不缓存、不改 `proposal_step` 派生本身、不写任何 marker；一致状态下字段不出现，零漂移。
4. 投影只描述事实矛盾并给建议，**不自动修复**——落标仍只能由 `openlogos deploy-done` 这一唯一 writer 完成。

### S21 场景文档化要求

场景总览已登记 S21（标记部署完成）并链接 `core-S21-deploy-done-marker.md`，但该文件缺失——S21 的时序、异常与追溯从未文档化，是本次事故所涉闭环唯一缺文档的场景。必须补齐完整场景文档：`deploy-done` 受控落标的目标、参与者、前后置条件、Mermaid 时序（verify 校验 → `[deploy]` 勾选同步 → 旧 smoke 标记清理 → 写标）、异常与边界、追溯，并覆盖消费侧（smoke / archive / status / next 如何消费 `DEPLOY_DONE`）。

### 场景验收条件

#### S19 smoke 门禁

- 活跃提案缺 `DEPLOY_DONE` 时 `openlogos smoke` fail-closed 拒绝：非零退出、错误码稳定、提示含 `openlogos deploy-done`，且 `SMOKE_PASS` / `SMOKE_FAIL` 与 smoke 报告均未产生。
- `[deploy]` 未全勾时同样 fail-closed 拒绝并给出补救命令。
- 四项前置全部满足时放行，既有 gate / 覆盖 / sandbox 判定逐项零回归。

#### S09 变更生命周期

- 缺 `VERIFY_PASS` → archive 拒绝；需部署提案缺 `DEPLOY_DONE` → 拒绝；需 smoke 提案缺 `SMOKE_PASS`（或存在 `SMOKE_FAIL`）→ 拒绝；三者均不移动目录、不删 guard。
- 无需部署的提案在 `VERIFY_PASS` 后照常归档（零回归）。

#### S05 下一步建议

- 构造「`SMOKE_PASS` 在场而 `DEPLOY_DONE` 缺失」的孤儿状态：`next` 输出 `state_inconsistency` 投影且人读引导含 `openlogos deploy-done` 补救建议。
- 一致状态下 `next` 输出不含该字段，既有引导逐字不变。

#### S11 状态进度

- 同一孤儿状态下 `status --format json` 的 `modules[].active_change.state_inconsistency` 在场且 `kind` / `evidence` / `remediation` 三字段齐备。
- 一致状态下该字段不出现；`proposal_step` 派生结果在两种状态下均与修复前一致（投影不改派生）。

#### S21 deploy-done 受控落标

- `core-S21-deploy-done-marker.md` 存在且含目标、参与者、前后置条件、Mermaid 时序、步骤说明、异常与边界、追溯；场景总览链接可达。
- `deploy-done` 命令行为零变化（既有校验、`[deploy]` 勾选同步、旧 smoke 标记清理逐项保持）。

### 非目标

- 不改 `openlogos deploy-done` 的命令行为、校验集合与唯一 writer 地位。
- 不实现 auto-heal（smoke 自动补写 `DEPLOY_DONE`）。
- 不改 `proposal_step` 派生本身与 flow 节点定义；不新增 marker、gate、cache 或落盘状态。
- 不给 `openlogos archive` 新增 stdout JSON envelope。

## ADDED — OpenLogos 0.14.25 候选发布需求

### 用户价值

三处修复均落在 `openlogos smoke` / `openlogos archive` / `status` / `next` 的 CLI 行为上：不发布不部署，本机全局运行的 0.14.25 之前版本将继续带着漏标缺口运行——smoke 仍可在 deploy 门未过时写 `SMOKE_PASS`、archive 仍可归档缺口提案、面板仍会僵死。用户决策 C01：发 0.14.25 并本机全局部署，早上线早止损。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.25`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.24` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**fail-closed 拒绝矩阵**（缺 `DEPLOY_DONE` 的 smoke 拒绝、`[deploy]` 未全勾的 smoke 拒绝、缺 `VERIFY_PASS` / 缺 `DEPLOY_DONE` / 缺 `SMOKE_PASS` 的 archive 拒绝）；**对账投影**（孤儿 `SMOKE_PASS` 状态下 `status` / `next` 输出 `state_inconsistency`）；**补标后全链放行**（执行 `openlogos deploy-done` 后 smoke 与 archive 恢复放行）；`0.14.24→0.14.25` roundtrip 无混装。
3. **零回归对照（强制）**：同一缺标场景在固定 `0.14.24` 上必须复现**缺陷本身**——smoke 照常执行并写 `SMOKE_PASS`、archive 照常成功、`status` / `next` 无 `state_inconsistency` 字段；旧版也拒绝则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.25`；`openlogos smoke`（SMOKE-core-196）独立授权执行。
5. 回滚制品固定 0.14.24 tarball 并留痕 SHA-256；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.25 候选身份全源一致（UT-S19-45 tripwire）；SMOKE-core-196 全链 PASS 且 0.14.24 缺陷对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 除生命周期 fail-closed 与状态对账修复外零新增语义；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
