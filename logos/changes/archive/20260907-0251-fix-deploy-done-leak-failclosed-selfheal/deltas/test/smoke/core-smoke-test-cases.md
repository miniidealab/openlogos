# core-smoke-test-cases delta — fix-deploy-done-leak-failclosed-selfheal

## ADDED — OpenLogos 0.14.25 生命周期 fail-closed 发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-196` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.25`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与 marker 文件**（本用例会构造缺 `DEPLOY_DONE`、缺 `VERIFY_PASS` 等异常提案态并驱动 `archive`，必须完全隔离）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-196 | 0.14.25 生命周期 fail-closed 与对账投影全链且缺陷在 0.14.24 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **smoke 拒绝**：隔离 prefix init 新项目 → launched → 建需部署需 smoke 提案，置 `VERIFY_PASS` + `deployment-report.md`，`[deploy]` 全勾但**不跑** `deploy-done` → `openlogos smoke` → 非零退出、`SMOKE_DEPLOY_NOT_DONE`、提示含 `openlogos deploy-done`，且 `SMOKE_PASS`/`SMOKE_FAIL`/`smoke-report.md` 未产生、`smoke-results.jsonl` 行数未变；另构造 `[deploy]` 未全勾态 → `SMOKE_DEPLOY_TASKS_INCOMPLETE`；③ **archive 拒绝**：缺 `VERIFY_PASS` → `ARCHIVE_VERIFY_NOT_PASSED`；需部署缺 `DEPLOY_DONE`（且 `SMOKE_PASS` 在场的孤儿态）→ `ARCHIVE_DEPLOY_NOT_DONE`；需 smoke 缺 `SMOKE_PASS` → `ARCHIVE_SMOKE_NOT_PASSED`；三者均**不移动提案目录、不删 guard**；④ **对账投影**：孤儿态下 `status --format json` 的 `active_change.state_inconsistency` 三字段齐备（`kind`/`evidence` 顺序稳定/`remediation="openlogos deploy-done"`）、`proposal_step` 仍 `ready-to-deploy`；`next` 人读引导含补救命令；⑤ **补标后放行**：执行 `openlogos deploy-done` → smoke 进入正常执行路径、archive 链条通过并成功归档、投影字段消失；⑥ **零回归**：无需部署提案 `VERIFY_PASS` 后 archive 照常成功；一致状态下 `status`/`next` 无 `state_inconsistency` 键；⑦ **0.14.24 对照**：固定 0.14.24 上重放②③④ → smoke **必须照常写 `SMOKE_PASS`**、archive **必须照常成功**、status **必须无投影字段**（缺陷复现）；⑧ 演练 `0.14.24→0.14.25→0.14.24→0.14.25` 并复核每阶段 identity 与②～⑦结论 | ② 两类拒绝均生效且副作用清零（以磁盘事实取证）；③ 三类拒绝均生效且目录/guard 未动；④ 投影三字段齐备、派生未变；⑤ 补标后全链放行、投影消失；⑥ 逐项与 0.14.24 一致；⑦ **0.14.24 必须复现三处缺陷**——旧版也拒绝或已有投影则矩阵空转判 FAIL；⑧ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-196`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **fail-closed 与投影断言必须驱动真实安装态 `openlogos smoke` / `archive` / `status` / `next` 命令并解析其 stdout/stderr 与磁盘事实**；库级函数直调不计入闭环证据。副作用清零必须以磁盘取证（marker 文件不存在、报告文件不存在、JSONL 行数未变、提案目录仍在原处、guard 仍在盘），不得只断言退出码。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-196` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑦是本用例的空转防线：固定 `0.14.24` 上缺 `DEPLOY_DONE` 的 smoke **必须**照常执行并写入 `SMOKE_PASS`、缺链 archive **必须**照常成功、孤儿态 status **必须**无 `state_inconsistency` 字段；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。
