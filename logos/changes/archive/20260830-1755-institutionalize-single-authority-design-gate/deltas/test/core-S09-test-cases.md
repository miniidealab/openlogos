## ADDED — S09 authority_impact 生命周期测试

### 单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S09-266 | required 完整 | writing proposal 含完整 fact/cutover/tests | plan package authority 维度 ready |
| UT-S09-267 | not_applicable 合法 | 纯文案变更 + 非空 evidence，无 facts | 通过且 summary 计数全 0 |
| UT-S09-268 | 缺声明不降级 | 新 writing proposal 无区块 | `authority_impact_declaration_missing`，plan 不 ready |
| UT-S09-269 | 历史前沿兼容 | 无区块但已有 PLAN_APPROVED/SPEC_MERGED/MERGED/VERIFY_PASS 各夹具 | 不回退现有前沿，不伪造 not_applicable |
| UT-S09-270 | 授权分层 | authority 通过并写 PLAN_APPROVED | 只进入 delta-writing，不自动 merge/verify/deploy/smoke/archive |

### 场景测试

| ID | 场景 | 操作序列 | 精确期望 |
|---|---|---|---|
| ST-S09-104 | writing→修复→批准 | 缺声明运行 lint；补完整 required；用户批准 | 首次 exit 2；补齐后 ready-to-delta；批准后 delta-writing |
| ST-S09-105 | 批准后 authority 漂移 | PLAN_APPROVED 后修改 fact/cutover 内容再进入消费点 | 完整性门拒绝沿用旧批准，要求重新审阅；不授权后续门 |

### 追溯与 reporter

覆盖 `openlogos/authority-impact@1`、AC-01～AC-08、历史兼容与授权分层。测试实现必须使用 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`。
