## ADDED — S19 修正后 0.14.0 candidate 测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S19-19 | 修正资产入包 | candidate 同时包含更新后三份 Schema、双语 merge-executor Skill、abort 命令与 golden，hash 对应同一冻结合同 |
| UT-S19-20 | 旧 hash 拒绝 | 旧 0.14.0 candidate 的 tarball/schema/contract 任一 hash 不得被部署记录或 RunLogos handoff 接受 |
| UT-S19-21 | 修正 candidate 回滚 | 安装、自检或合同对账任一步失败时恢复部署前入口/版本/hash，且不留下混合资产 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S19-14 | 隔离 pack/install/self-check/rollback | 从修正源码 pack，在隔离 prefix 安装并执行 slot/abort/completed golden；故障分支按冻结命令回滚，公开发布副作用为零 |

### Runner、Reporter 与追溯

- verify 阶段只验证隔离 prefix/临时项目；真实全局安装仍须 verify PASS 后单独获得部署授权。
- 每个 ID 必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`，evidence 保留版本、入口摘要、tarball/schema/contract SHA-256 与回滚结论。
- 入包/旧 hash：UT-S19-19～20；回滚：UT-S19-21；隔离全链：ST-S19-14。
