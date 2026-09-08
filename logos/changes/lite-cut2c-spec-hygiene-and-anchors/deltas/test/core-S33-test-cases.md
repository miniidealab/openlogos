# Delta: core-S33-test-cases.md

> change: lite-cut2c-spec-hygiene-and-anchors
> 目标：`logos/resources/test/core-S33-test-cases.md`

本节六条用例的判据在 lite-cut2b 已迁座到存活消费者（seed 读取门由 status/next/change/sync/index/change-lint 共用），但措辞仍引用随 L9 删除的「S39 闭包 / EvidenceScanner / effective view」。此处只订正措辞使其与实现一致，ID 与断言强度均不变。

## MODIFIED — 六、eager seed 可选化与 S39 证据接口测试


> 所有用例实现必须写入 OpenLogos reporter `logos/resources/verify/test-results.jsonl`。

### 6.1 单元测试

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S33-49 | required 不阻断首个 change | state=required、无 seed 目标 | 目标集直接由 deltas 派生，规划与合并均可完成 |
| UT-S33-50 | 安全 partial staging 排除 | state=partial、staging 含完整-looking 文档、无未终结 journal | staging 不进入 merge 目标集，也不使同名 canonical target 判为已存在；change 可继续 |
| UT-S33-51 | seeded 只作加速 | state=seeded、candidate 指向触达代码 | candidate 仅供人定位现状；正式目标缺失时仍派生为 CREATE，不因 seeded 而略过 |
| UT-S33-52 | stale committed seed 降级 | source_hash 不匹配 | 忽略 stale 精确结论、回退重算；change 不阻断 |
| UT-S33-53 | seed state 不决定 action | required/安全 partial/seeded 参数化，且无未终结 journal或恢复成功 | 三态的无提案默认 action 均可创建 change；仅可选诊断不同 |
| UT-S33-54 | 无确认字段写入 | 任意 seed + on-touch change | 输出无 verified:true、confirmed_by、confirmed_at、baseline_warnings |
| UT-S33-55 | 未终结 journal 恢复失败不降级 | 参数化崩溃点：prepared、逐目标 rename、index/state 写入前后；恢复素材损坏 | 每个消费者先取锁恢复；无法恢复返回 `baseline_commit_in_progress`，resources/index/coverage/EvidenceScanner 读取计数为 0 |

### 6.2 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S33-05 | 完全跳过 seed 完成首个 change | adopted required → 直接 change → 规划并合并 | 全链路可达；缺失目标由 delta 派生为 CREATE；seed state 保持兼容值不被 change 流程改写 |
| ST-S33-06 | 安全 partial run 与 change 并存 | begin 后只写部分 staging、未进入 journal，再创建 change | staging 既不进入 merge 目标集、也不被当作「目标已存在」；change 正常推进；run 后续仍可恢复/提交 |
| ST-S33-07 | seeded candidate 首次转正式场景 | committed candidate、正式场景文档缺失 | 正式目标缺失时仍派生为 CREATE，seeded 不能让它变成「已存在」；candidate verified 不变 |
| ST-S33-08 | 旧确认机制反向回归 | fixture 含 verified:false 候选，执行 plan/spec/verify 消费路径 | 无 JIT advisory、无确认写回、无 baseline warning、门结果不受 verified 影响 |
| ST-S33-09 | commit journal 崩溃点故障注入 | 对多目标+index+state 事务逐崩溃点中断，分别验证可前滚、可回滚与不可恢复夹具 | 可恢复夹具落定全旧/全新；不可恢复夹具对 status/next/index/sync/S39 全部硬报 `baseline_commit_in_progress`，不读半新、不写迁移、不创建 change 产物 |

### 6.3 保留契约回归

- baseline-seed begin/commit/status、路径安全、candidate key 对账、锁、journal 恢复、partial→seeded 事务测试继续全绿；新增断言明确 safe partial 与未终结 journal 不共享降级分支。
- status/next 的 `baseline_coverage` 兼容 shape 不删除；改变的是它不再决定主 action。
- tombstone 分母、legacy 缺省派生与 sync 显式回填规则保持；S39 不新建每场景闭包状态。

