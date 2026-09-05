## ADDED — OpenLogos 0.14.20 reopen 前滚修复 Smoke

### 授权与统一前置

- 执行 `SMOKE-core-191` 需要独立 smoke 授权。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.20`。
- 全部断言在一次性临时项目中构造；**不得触碰本仓或用户其它项目的活跃提案、guard 与事务文件**，**不得手工创建 / 删除 / 改写 `SPEC_MERGED`、`MERGE_REOPENS.jsonl` 与归档 receipt**（失配反例仅在隔离副本中篡改演示）。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-191 | 0.14.20 reopen 后 change set 前滚全链且空 change set 缺陷在 0.14.19 复现 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 asset identity；② **前滚全链**：临时 launched 项目首次 merge 全链 completed，断言 `SPEC_MERGED.test_change_set.changed_test_ids` 含全部新增 ID → `merge transaction reopen --reason ... --confirm-spec-merged` → 仅修正一个非测试目标、其余 delta 幂等 → 重跑 merge→submit→seal→apply → 断言 changed 仍含首轮全部 ID 且 sha256 合法；③ **removed 后写胜出**：追加一轮 reopen 删除一个首轮 ID → 重合并后该 ID 在 removed、不在 changed；④ **失配 fail-closed**：隔离副本篡改归档 receipt 身份 → seal 稳定拒绝并点名路径；⑤ **无留痕零回归**：未 reopen 的对照提案 change set 与 0.14.19 逐字节等价；⑥ **零回归对照**：固定 `0.14.19` 上重放步骤② → `changed_test_ids` 必须为空或缺失首轮 ID（缺陷复现，防断言空转）；⑦ 演练 `0.14.19→0.14.20→0.14.19→0.14.20` 并复核每阶段 identity 与 ②⑥ 结论 | ② changed 提案级完整，任一首轮 ID 丢失即 FAIL；③ removed 语义正确；④ 稳定拒绝、无静默降级；⑤ 逐字节等价；⑥ **0.14.19 必须复现空 change set**——旧版也完整则矩阵空转判 FAIL；⑦ 往返无混装且结论不变；全程无 `npm publish`/tag/release/官网/git push 副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-191`，不得依靠通配发现后无条件 PASS。
2. 环境不具备时（缺候选或回滚 tarball）必须写显式 `skip` 记录并携带缺失项，禁止静默零记录退出。
3. **全部关键断言必须穿过公开 `openlogos merge` / `merge transaction` 命令与 `SPEC_MERGED` 磁盘事实**；库级函数调用构造或断言的步骤不计入闭环证据。
4. 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-191` 结果，字段含 `id/status/timestamp/duration_ms/environment/evidence`。

### 零回归对照（强制）

步骤⑥是本用例的空转防线：固定 `0.14.19` 上 reopen 后部分幂等重合并的 change set **必须**为空或缺失首轮 ID；否则矩阵空转，必须重写矩阵而非放行部署。

### OpenLogos Smoke Reporter

- 失败不得写 pass；缺失、skip 无原因、重复矛盾、源码直跑、candidate/hash 归属漂移或回滚未恢复均判 FAIL，不得写 `SMOKE_PASS`。
