## ADDED — reopen 后切片归属消费回归

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S32-69 | 前滚 change set 下 owned 校验放行 | SPEC_MERGED.test_change_set 为前滚结果（changed 含首轮 ID A/B 与本轮 ID C）：多切片 manifest 分别 own A/B 与 C 均通过 owned⊆changed；reader 不读 deltas/test、不读归档 |
| UT-S32-70 | removed 后写胜出的消费行为 | 前滚结果 removed 含被本轮删除的首轮 ID X：own X 触发 `test-slice-test-id-unknown` 并指出 owned 字段路径；changed 不含 X |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S32-23 | reopen 后多切片规划全链 | 真实命令链驱动 reopen 重合并（测试目标幂等）后进入切片规划：多切片 manifest 校验通过、slice-aware verify 按归属豁免未完成切片 ID、删后续证伪门成立；全程消费者只读当前 marker |

### 自动化与证据要求

- 消费侧断言必须经共享 TestChangeSetReader / validateTestSliceManifest 公开路径，禁止绕过 reader 直读 marker 字段断言。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S32"`；失败不得写 pass。
