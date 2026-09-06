# Delta: core-smoke-test-cases.md（fix-next-ensure-initial-plan-slice-transaction）

## ADDED — OpenLogos 0.14.23 next 问即建发布 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-194` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.23`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与事务文件**。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-194 | 0.14.23 next 问即建全链且无投影缺陷在 0.14.22 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **问即建**：隔离 prefix init 新项目 → launched → 建提案并构造 spec-complete 态（`SPEC_MERGED`、tasks.md 含已勾 `[delta]` 与空 `[code]` 标题、`PLAN_APPROVED`）→ `next --format json` → 模块项携 `slice_transaction` 投影（`origin=initial-plan`、`phase=collecting`、`content_slots.required=2`）且 `TEST_SLICE_TRANSACTION.json` 落盘；③ **幂等与续用**：重跑 `next` → `transaction_id` 不变；`slice transaction submit-content` 提交 slot → 同一事务受理不重建；④ **非触发零回归**：delta-writing 前沿的提案 `next` 不创建事务、不输出该字段；⑤ **0.14.22 对照**：固定 0.14.22 上重放② → 输出**必须无 `slice_transaction` 字段**且事务文件**不落盘**（缺陷复现）；⑥ 演练 `0.14.22→0.14.23→0.14.22→0.14.23` 并复核每阶段 identity 与②⑤结论 | ② 投影在场且事务落盘；③ 幂等且续用同一事务；④ 逐项与 0.14.22 一致；⑤ **0.14.22 必须复现无投影且不落盘**——旧版也有投影则矩阵空转判 FAIL；⑥ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-194`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **next 行为断言必须驱动真实安装态 `openlogos next --format json` 并解析 JSON 输出**；库级函数直调不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-194` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑤是本用例的空转防线：固定 `0.14.22` 上同场景 `next` **必须**无投影且事务文件不落盘；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。
