## ADDED — S09 Seal Preflight、Legacy Reopen 与崩溃边界测试

### 单元测试

| 用例ID | 验证目标 | Fixture/故障注入 | 关键断言 |
|---|---|---|---|
| UT-S09-261 | 新事务seal前preflight拒绝 | ready事务的after测试表列数歧义 | seal不产生；phase=collecting；问题slot missing；正式树、journal、apply staging/backup、receipt/marker零变化 |
| UT-S09-262 | 0.14.1 legacy sealed局部reopen | 无preflight record、15个sealed Agent slots，其中一个内容错误 | 同transaction/plan/target-set；只错误slot submitted hash清空；其余14个保留；外层seal与全部sealed hash清空 |
| UT-S09-263 | 结构化多target归因 | 两个可修复Agent target错误、mixed/OpenLogos/unknown对照组 | 全Agent且唯一映射时共同missing；任一不可归因时一个slot也不清；不解析message文本 |
| UT-S09-264 | reopen崩溃一致性 | transaction atomic rename前/后及私有cleanup中fault injection | rename前完整sealed；rename后完整collecting；残留私有字节非权威；未受影响slot不删除 |
| UT-S09-265 | 首写后不可逆边界 | applying、journal prepared/committing、receipt/marker和正式新字节参数化fixture | 全部分支禁止reopen，只暴露recover/稳定fatal；transaction不倒退collecting |

### 场景测试

| 用例ID | 验证目标 | 步骤 | 关键断言 |
|---|---|---|---|
| ST-S09-102 | 新/旧事务真实CLI生命周期 | subprocess创建新事务验证seal reject；加载legacy sealed fixture触发reopen、修正、submit、reseal、apply | 新事务错误不sealed；legacy同transaction最终completed；receipt/marker/final hashes有效 |
| ST-S09-103 | response-lost与重复修复 | reopen响应丢失、status恢复、第一次修复仍失败、第二次修复通过 | 每轮只退回真实rejected slots；其它hash守恒；重复seal/apply幂等；不abort/新建事务 |

### 追溯

UT-S09-239继续锚定一般validator重试；UT-S09-240/242/243继续锚定seal、apply rollback和journal恢复。本节用例专门覆盖跨target preflight、legacy兼容和状态先落盘顺序。

### Runner 与 OpenLogos Reporter

Vitest/subprocess runner必须逐个执行UT-S09-261～265、ST-S09-102～103。每个ID独立写`test-results.jsonl`；测试名、fixture和reporter ID一一对应，禁止一个happy-path函数无条件为全部ID报PASS。
