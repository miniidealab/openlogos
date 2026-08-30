## ADDED — S05 Preflight Reopen Next 动作回归

### 单元测试

| 用例ID | 验证目标 | 前置/输入 | 关键断言 |
|---|---|---|---|
| UT-S05-46 | legacy sealed reopen后的next权威动作 | transaction已由core原子落盘collecting；一个rejected slot hash=null；旧私有字节仍存在 | next只读返回`submit_content`，missing精确为rejected slot；不因残留字节返回seal/apply；未受影响slot保持submitted |

### 场景测试

| 用例ID | 验证目标 | 步骤 | 关键断言 |
|---|---|---|---|
| ST-S05-21 | 跨进程response-lost恢复 | legacy apply触发reopen但客户端丢失响应；新进程运行status/next，重提missing slot并再次next | 同transaction从collecting→ready→seal前沿；不创建新transaction、不重提无关slot，重复next零写 |

### 既有合同锚

UT-S05-36继续验证一般validator失败保持collecting。本节新增用例必须有独立fixture和断言，不能通过把ID拼接到其它happy-path测试名宣称覆盖。

### Runner 与 OpenLogos Reporter

CLI Vitest runner必须实际执行UT-S05-46、ST-S05-21，并为每个ID向`logos/resources/verify/test-results.jsonl`写一条包含`id/status/timestamp/duration_ms`的OpenLogos reporter记录；任一断言未执行或reporter缺失均不算PASS。
