## ADDED — S09 合并事务单一权威测试用例

### 单元测试

| 用例 ID | 验证目标 | 关键断言 |
|---|---|---|
| UT-S09-233 | canonical plan 稳定性 | target 排序、mode、source/before、producer/validator 相同则 plan_hash 相同 |
| UT-S09-234 | plan 漂移 | 任一 canonical identity 改变产生新 plan_hash，旧 transaction 不接受 |
| UT-S09-235 | opaque identity | target_ref/slot_id 不泄漏可写正式路径且由冻结算法稳定派生 |
| UT-S09-236 | slot allowlist | 仅声明 write_path 可写；额外、重复、逃逸、symlink 全部拒绝 |
| UT-S09-237 | 原子替换 | 半写与遗留临时文件不能被 seal；合法 rename 后可读取完整字节 |
| UT-S09-238 | slot 边界 | 缺失、空、超限、非法编码分别返回稳定 waiting/retryable code |
| UT-S09-239 | validator 重试 | 内容语义失败保持 collecting，同 transaction 可替换后重试 |
| UT-S09-240 | seal 冻结 | seal 后 slot hash 和字节不可改变，漂移触发 fatal |
| UT-S09-241 | apply 全批成功 | resources、metadata、dogfood、test change set、receipt、marker 全部提交 |
| UT-S09-242 | apply 回滚 | 每个故障注入点均恢复 MODIFY、删除 CREATE/marker并恢复 counter/index |
| UT-S09-243 | journal 前滚 | marker 前 response lost 后恢复到唯一 completed receipt |
| UT-S09-244 | 幂等调用 | 重复 seal/apply/status 不重复写入且返回相同 identity/receipt |
| UT-S09-245 | no-delta | 零 slot transaction 仍生成 completed receipt 和绑定 marker |
| UT-S09-246 | UI prototype | 原型 target/receipt 必须绑定同一 plan_hash，漂移时 apply 拒绝 |
| UT-S09-247 | OpenLogos producer | decision/counter/index/dogfood/test change set 不分配 Agent slot |
| UT-S09-248 | commit_paths | receipt 只含正式产物，排除 slot/journal/staging/backup |
| UT-S09-249 | 旧命令断代 | `merge-apply --manifest` 固定非零且零正式副作用 |
| UT-S09-250 | 命名空间隔离 | Plan completion receipt/journal/dispatch 不改变 merge phase |

### 场景测试

| 用例 ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-91 | 纯 CREATE transaction | Agent 写 slot→seal→apply→completed，目标与 marker 同批出现 |
| ST-S09-92 | 纯 MODIFY transaction | before/final hash 校验并原子替换，receipt 可重读 |
| ST-S09-93 | CREATE/MODIFY/metadata 混合 | 20+ 多根目标、counter/index 与 dogfood 全批一致 |
| ST-S09-94 | validator 修复闭环 | 第一次 seal retryable，替换 slot 后同 transaction 完成 |
| ST-S09-95 | no-delta/UI 分支 | 两者均产生同形 transaction receipt，无旁路 marker |
| ST-S09-96 | apply 崩溃与恢复 | 故障点重启后只得到全旧或全新，不存在半新成功 |
| ST-S09-97 | response lost | apply 已完成但响应丢失，重试返回同 receipt且不重复 commit |
| ST-S09-98 | RunLogos 权限边界 | Agent/Driver 对正式 target、metadata、marker 零写入，只消费公共动作 |

### Runner 与 Reporter

- UT 使用 Vitest 覆盖状态机、plan/hash、slot、validator、journal、receipt 和旧命令拒绝。
- ST 必须通过真实 CLI 子进程和隔离临时项目执行；不得 mock transaction 输出、手工 target/marker 或预造 completed receipt。
- 每个 ID 必须通过 OpenLogos reporter 追加到 `logos/resources/verify/test-results.jsonl`；故障注入证据包含 transaction_id、phase、stable code 与目标树 hash，但不得泄露绝对临时路径或敏感内容。
