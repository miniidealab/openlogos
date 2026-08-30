## ADDED — S19 OpenLogos 0.14.0 全局 candidate 测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S19-12 | 部署前事实冻结 | 记录旧命令绝对路径、0.13.31 版本、安装来源与可复制回滚命令 |
| UT-S19-13 | tarball 身份 | package version=0.14.0，文件名/内容/SHA-256 与部署记录一致 |
| UT-S19-14 | 全局命令解析 | 新 shell 的 `command -v` 与期望全局 bin 一致，排除 shell cache |
| UT-S19-15 | 随包资产 | schema、双语 Skill、golden 和 contract hash 均存在且匹配源码冻结值 |
| UT-S19-16 | 公开发布隔离 | 部署命令图不含 publish/tag/release/官网部署/push |
| UT-S19-17 | 失败回滚 | 任一安装/自检失败执行 0.13.31 回滚并验证路径/版本恢复 |
| UT-S19-18 | RunLogos candidate 证据 | 只接受绝对全局命令、tarball hash、schema/contract hash 完整集合 |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S19-10 | pack→install→self-check | 真实 tarball 安装后版本、help、schema/Skill 与 contract 全部通过 |
| ST-S19-11 | 安装态 transaction smoke | 全局 CLI 完成 CREATE/MODIFY/mixed/no-delta 与 validator retry |
| ST-S19-12 | 安装态恢复 | 崩溃与 response-lost 后全局 CLI 收敛同一 completed receipt |
| ST-S19-13 | 回滚与下游交接 | 故障时恢复 0.13.31；成功时冻结 RunLogos 可消费 candidate facts |

### Runner 与 Reporter

- UT 对部署计划和命令构造做纯函数/临时前缀验证，不触碰用户真实全局环境。
- ST-S19-10～13 只在 verify PASS 且获得部署授权的隔离部署执行中运行；实际 `openlogos smoke` 仍是独立确认节点。
- 每个 ID 使用 OpenLogos reporter；evidence 对绝对路径做允许的脱敏，但保留 basename、版本、tarball/schema/contract SHA-256 与回滚结论。
