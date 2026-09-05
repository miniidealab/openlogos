## ADDED — OpenLogos 0.14.19 merge 流程契约自洽 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-190` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.19`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与事务文件**，**不得手工创建 / 删除 / 改写 `MERGE_TRANSACTION.json`、MERGE_PROMPT marker 与 `SPEC_MERGED`**（越权路径仅在专用反例中以隔离副本演示）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-190 | 0.14.19 merge 前沿事务事实全链（含跨组件验收）且旧死区在 0.14.18 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **跨组件全链**：临时 launched 项目构造有 delta 提案 → `openlogos merge` 开事务 → `status`/`next` 断言 `proposal_step=merge-generated`、`next_node=apply-merge`、`data.merge_transaction` 必挂且与 `merge transaction status` 同快照一致 → submit-content ×N → seal → apply → `SPEC_MERGED` 在场 → `status`/`next` 前沿越过 merge 段；③ **后置条件二分**：no-delta 提案 merge 当场 `SPEC_MERGED` 前沿即进；有 delta 收尾提示为事务引导且无「MERGE_PROMPT.md」字样；④ **幂等与终态协同**：非终态重跑 merge 幂等返回、前沿不回退；abort 后重跑归档让位重建、前沿仍 merge-generated；⑤ **错误码验收**：存量失配事务隔离 fixture → 稳定码 + 双方摘要 + remediation；status/next 既有失败路径抽样断言结构化 `error.code`；⑥ **零回归对照**：固定 `0.14.18` 上重放步骤②首段——merge 开事务后 `proposal_step` 必须仍停 `ready-to-merge`、`next_node` 停 `generate-merge-prompt`（死区复现，防断言空转）；⑦ 演练 `0.14.18→0.14.19→0.14.18→0.14.19` 并复核每阶段 identity 与 ②⑥ 结论 | ② 全链每步前沿与磁盘事实一致，任一步滞留即 FAIL（死区未除）；③ 二分成立且提示无旧文案；④ 幂等 / 重建后前沿正确；⑤ 稳定码齐备、无纯文本退化；⑥ **0.14.18 必须复现死区**——旧版也推进则矩阵空转判 FAIL；⑦ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-190`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos merge` / `merge transaction` / `status` / `next` 命令**；库级函数调用构造或断言的步骤不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-190` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑥是本用例的空转防线：固定 `0.14.18` 上 merge 开事务后前沿**必须**仍死区；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 步骤②是红线：任一步前沿滞留说明判据未同源或 done_when 未生效，停止并回实现，不得放宽断言。
- 观察到 runner 手工写事务文件 / marker 或以库级调用替代公开命令构造关键断言，直接 FAIL。

### 追溯

- 部署方案：OpenLogos 0.14.19 merge 流程契约自洽本机全局部署方案。
- 需求：merge 流程契约自洽需求「部署与非目标」；跨仓验收对齐 RunLogos 提案 `fix-driver-merge-transaction-contract-alignment`。
