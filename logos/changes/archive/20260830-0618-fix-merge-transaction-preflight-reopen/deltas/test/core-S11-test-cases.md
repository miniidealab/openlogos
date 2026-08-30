## ADDED — S11 Reopen 状态权威与残留字节测试

### 单元测试

| 用例ID | 验证目标 | Fixture | 关键断言 |
|---|---|---|---|
| UT-S11-74 | collecting projection不扫描私有字节 | transaction中一个slot hash=null，但对应merge-content/merge-staging旧字节仍存在；另一个submitted字节已被外部删除作fatal对照 | status的submitted/missing只由transaction hash派生；残留不恢复submitted；只读前后transaction和项目树hash不变；语义矛盾按稳定错误处理 |

### 场景测试

| 用例ID | 验证目标 | 步骤 | 关键断言 |
|---|---|---|---|
| ST-S11-43 | 跨进程崩溃窗口只读重放 | 分别构造rename前sealed、rename后collecting+残留、journal applying三个fixture；两个新进程读取status | 各fixture重复输出canonical相同；sealed/apply、collecting/submit_content、applying/recover映射准确；零写副作用 |

### 既有合同锚

UT-S11-63继续验证collecting快照基本字段。本节补充状态文件提交点与私有垃圾回收之间的真实磁盘窗口。

### Runner 与 OpenLogos Reporter

UT-S11-74、ST-S11-43必须由真实状态读取路径执行并逐ID写OpenLogos reporter；禁止mock掉transaction投影或仅比较手工对象。
