## ADDED — OpenLogos 0.14.4 嵌套章节锚与原事务恢复安装态 Smoke

### 授权与统一前置

- 仅在 `openlogos verify` PASS、固定 `0.14.4` tarball 隔离矩阵通过、用户已明确授权本机全局部署且部署身份自检通过后执行。
- 执行 SMOKE-core-168 需要独立 smoke 授权；其中写入并完成 RunLogos 原 transaction 的步骤还需要 RunLogos merge 独立授权。只有 smoke 授权时，可完成安装态临时 fixture 与原事务只读核对，但不得写 RunLogos并不得把用例报 PASS。
- runner 必须使用 `command -v openlogos` 解析出的本机全局绝对入口，版本精确为 `0.14.4`；源码入口、workspace link、mock transaction 或手工 receipt 不算验收。

### 冒烟测试用例

| ID | 场景 | 安装态执行步骤 | PASS 判据 |
|---|---|---|---|
| SMOKE-core-168 | 0.14.4 嵌套章节锚、回滚与 RunLogos 原事务恢复 | ① 核对固定 tarball SHA、全局 entry/realpath/version 与 package/plugin/asset/schema/Skill identity；② 在临时项目使用真实标题路径与重复叶结构，写 Agent final 后运行 submit/status/seal/apply；③ 运行围栏伪 marker、单段歧义、错误父链与 OpenLogos producer路径锚正反例；④ 演练 `0.14.4→0.14.3→0.14.4` 并复核每阶段 identity；⑤ 在 RunLogos 根只读核对 `mtx_e7f7b924499d49f96aaf8a2f`、6/7 hash与唯一 missing slot；⑥ 仅在 RunLogos merge已授权时写声明 staging、submit目标slot、seal/apply同一事务 | candidate各身份绑定同一tarball；submit不做锚语义拒绝，seal/apply共享resolver且正式标题层级正确、不含路径字面量；负例零正式副作用且仅可归因slot局部reopen；往返无混装；原transaction保持ID/plan/target-set/其它6 hash并最终7/7 completed，receipt/final/artifact hashes与`SPEC_MERGED`可复算；全程无abort/新transaction/公开发布副作用 |

### Runner 与证据

1. `scripts/run-smoke.js` 或受控子 runner 必须显式分派 `SMOKE-core-168`，不得依靠通配发现后无条件 PASS。
2. evidence 至少包含：tarball路径/大小/SHA-256、全局入口/realpath/version、package/plugin/asset hash、临时 transaction ID、共享 hit `level/text/path/range`、各 phase/hash、回滚每阶段 identity，以及脱敏后的 RunLogos transaction/slot/receipt hash。
3. 临时 fixture 在结果持久化后清理；RunLogos 原 transaction、正式目标、receipt 与 marker是跨仓审计证据，不得由 smoke runner伪造或删除。
4. runner 不得执行 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署或 git push；检测到任一远程副作用立即 FAIL。

### OpenLogos Smoke Reporter

- 用例向 `logos/resources/verify/smoke-results.jsonl` 写唯一一条 `SMOKE-core-168` 结果，字段包含 `id/status/timestamp/duration_ms/environment/evidence`。
- 原事务只读核对完成但尚未获得 RunLogos merge授权时，状态只能保持未完成，不得以 SKIP/PASS替代最终步骤。
- 缺失、skip、重复矛盾、源码直跑、candidate/hash归属漂移、回滚未恢复、其它6 slot hash漂移或 receipt 不可复算均判 FAIL，不得写 `SMOKE_PASS`。

### 失败、自愈与完成边界

- 临时 fixture 失败：保留脱敏诊断，修复后重新 verify/build/pack/install/smoke；不得只重跑失败断言绕过 candidate identity。
- 全局身份或回滚失败：立即尝试恢复固定 `0.14.3` 并报告环境状态；未证明全旧或全新时阻断后续动作。
- RunLogos 失败：只处理 transaction 返回的可归因 missing slot；source/before/plan漂移、journal/recovery错误立即停止，不abort、不新建事务。
- 只有本机全局最终恢复为同一 `0.14.4` candidate、SMOKE-core-168 唯一真实 PASS、RunLogos 原 transaction completed且远程副作用为零，才允许生成 smoke报告/`SMOKE_PASS`并进入后续 archive授权点。

### 追溯

- 需求：AC-MT-ANCHOR-01～07。
- 功能规格：§2.46.3～§2.46.7。
- 架构：§37.4～§37.7。
- 部署：OpenLogos 0.14.4 嵌套章节锚修复本机全局部署方案。
- UT/ST：UT-S09-271～274、ST-S09-106～107、UT-S37-37～40、ST-S37-09～10。
