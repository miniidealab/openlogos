## ADDED — smoke runner / reporter 覆盖测试用例

### 一、单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-SMOKE-01 | 缺少 smoke runner 时输出诊断 | smoke runner coverage | 新增 smoke ID，`smoke.command` 未配置且无 `scripts/smoke-*` | smoke coverage check | 返回 `smoke_runner_missing` |
| UT-S19-SMOKE-02 | runner 未写入 result path 时输出诊断 | smoke reporter coverage | 存在 runner，但 `smoke-results.jsonl` 不存在或为空 | smoke coverage check | 返回 `smoke_reporter_missing` |
| UT-S19-SMOKE-03 | dispatcher 可发现 smoke runner | smoke dispatcher | 存在 `scripts/smoke-driver-smoke-repair-loop.sh` 或等效 runner | dispatcher discovery | 返回 runner 列表并纳入 `smoke.command` 执行链 |

### 二、场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-SMOKE-01 | 新增 smoke case 未执行时 Gate FAIL 且诊断明确 | S19 Step 4→9 | 已部署提案新增 `SMOKE-DRV-SMOKE-01`，结果文件缺少该 ID | `openlogos smoke --format json` | `gate.result=FAIL`，`uncovered_cases` 包含该 ID，诊断为 `smoke_cases_uncovered` |
| ST-S19-SMOKE-02 | 统一 dispatcher 执行新增 runner 后无 uncovered | S19 Step 4→9 | `smoke.command` 指向统一 dispatcher，runner 写入新增 smoke ID 的 pass 结果 | `openlogos smoke --format json` | 新增 ID 不在 `uncovered_cases`，无 runner/reporter 缺失诊断 |

### 三、异常测试用例补充
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S19-EX-SMOKE-01 | 禁止伪造 smoke PASS | smoke reporter validation | runner 仅追加新增 ID 的 pass 结果但未执行实际检查或缺少 runner 审计 | smoke coverage check | 输出 runner 审计缺失或伪造风险诊断，不写入 `SMOKE_PASS` |

### 四、覆盖度校验补充
- [ ] runner 缺失诊断：UT-S19-SMOKE-01
- [ ] reporter 缺失诊断：UT-S19-SMOKE-02
- [ ] dispatcher 发现 runner：UT-S19-SMOKE-03、ST-S19-SMOKE-02
- [ ] 新增 smoke ID uncovered：ST-S19-SMOKE-01
- [ ] 禁止伪造 PASS：ST-S19-EX-SMOKE-01
