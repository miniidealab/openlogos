## ADDED — S39 canonical closure 单一事务测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S39-39 | P=T=D 转 transaction | canonical target/mode 集合与 transaction planned targets 精确相等 |
| UT-S39-40 | Agent/OpenLogos producer 分流 | 语义内容有 slot；metadata/dogfood/test change set/marker 无 slot |
| UT-S39-41 | CREATE 磁盘事实 | 目标存在时 plan/apply 拒绝，不覆盖同名文件 |
| UT-S39-42 | MODIFY before 漂移 | before hash 变化触发 fatal plan drift，不静默重算 |
| UT-S39-43 | decision D07 分配 | 文件名/标题/counter/index 在同批按稳定 base 分配并可恢复 |
| UT-S39-44 | scenario/feature/decision counter | 任一推进失败回滚所有 counter 与正式目标 |
| UT-S39-45 | resource index | 新资源登记稳定排序且与 receipt metadata summary 一致 |
| UT-S39-46 | 根 spec/skill dogfood | 根权威与 dogfood 同批，失败不留下单边新字节 |
| UT-S39-47 | test change set | 从 test before/final 唯一计算 C/R，与 marker/receipt identity 一致 |
| UT-S39-48 | no-delta closure | 空 P/T/D 生成零 slot transaction 与可信空 test change set |
| UT-S39-49 | UI receipt 绑定 | UI receipt 必须绑定 plan_hash；缺失/漂移 fail-closed |
| UT-S39-50 | 后置复核 | 任一 final hash/metadata/marker 不一致触发全批回滚 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S39-20 | 30 目标多根 closure | resources/spec/skills/test/decision/metadata 单 transaction completed |
| ST-S39-21 | CREATE+MODIFY+decision 混合 | D07、counter/index、正式目标与 marker 全有或全无 |
| ST-S39-22 | metadata 故障矩阵 | decision/counter/index/dogfood/test change set 各故障点均零半状态 |
| ST-S39-23 | UI/no-delta 分支 | 两分支与普通 closure 共享 transaction/receipt 完成谓词 |
| ST-S39-24 | marker 后 response lost | 重启后沿用 journal/receipt，不重新分配 DXX 或 counter |
| ST-S39-25 | 额外/重复 target 拒绝 | seal 前拒绝 scope 扩张，proposal/tasks/deltas 不被反向改写 |

### Runner 与 Reporter

- UT 使用固定 before/final tree、counter/index 与 fault injection fixture。
- ST 必须覆盖跨 `logos/resources`、根 `spec`、根 `skills` 和 decision metadata 的真实临时项目；禁止只测单文件 helper。
- 每个 ID 通过 OpenLogos reporter 写入 test-results；原子性 evidence 记录 before/after tree hash、transaction/receipt hash 与回滚状态。
