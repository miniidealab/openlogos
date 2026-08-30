## ADDED — S19 OpenLogos 0.14.2 候选与回滚测试

### 单元测试

| 用例ID | 验证目标 | 输入 | 关键断言 |
|---|---|---|---|
| UT-S19-24 | 0.14.2 candidate facts冻结 | package/version/tarball/schema/status/next/contract/skill/golden hashes参数化 | 精确字段、SHA-256和0.14.2 identity全部匹配才接受；任一旧hash、混装资产或私有transaction路径字段fail closed |
| UT-S19-25 | 安装/回滚选择 | 0.14.1 previous、0.14.2 candidate，pack/install/self-check/contract/behavior矩阵逐项故障 | 任一失败选择完整restore-previous；成功选择candidate；恢复后入口和全部资产等于0.14.1；禁止半新混装 |

### 场景测试

| 用例ID | 验证目标 | 步骤 | 关键断言 |
|---|---|---|---|
| ST-S19-16 | 真实pack与隔离回滚 | build/npm pack 0.14.2；隔离prefix运行新seal、legacy reopen、完成；执行0.14.1→0.14.2→0.14.1→0.14.2 | 每次新shell版本/realpath/hash正确；固定tarball可复装；行为矩阵和reporter全过；不触达全局或远程发布 |

### OpenLogos Reporter

UT-S19-24～25、ST-S19-16逐ID写`test-results.jsonl`。真实npm命令、tarball路径/大小/hash和隔离prefix证据必须来自runner实际输出；mock pack或源码直跑不算ST PASS。

### 授权边界

这些自动化测试可在verify沙箱运行；覆盖本机全局、执行smoke和RunLogos恢复仍分别等待用户明确授权。
