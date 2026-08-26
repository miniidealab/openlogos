## ADDED — TRAE 候选 tarball 安装态同步测试

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S08-37 | 本地负向 sync runner 的七宿主、严格失败与用户边界合同 | S08 候选 tarball 安装态同步时序 | 隔离 prefix 内为真实 `0.13.29` CLI；workspace 含七宿主基线和合成 TRAE fixture | `all` 配置、含 `trae` 的非法配置、入口逃逸、用户边界哈希变化等结果 fixture | `all` 精确稳定七宿主且版本戳最后写；非法配置在事务前失败；入口逃逸或任何 `.trae/**`/用户边界变化均返回失败诊断 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S08-27 | 真实 `0.13.29` tarball 的同步排除闭环 | 候选安装 → `all` sync → 严格配置失败 → 边界审计 | 候选 CLI realpath 位于一次性 prefix；fixture 预置 `.trae/**`、settings、账号占位、`enabled_folders`、MCP 和不透明记忆 | 记录前态；执行 `all` sync；记录七宿主结果/版本戳；在独立副本配置 `trae` 后 sync；比较全部目标与用户边界 | `all` 只提交七宿主且版本戳最后更新；含 `trae` 时首次事务前非零退出、无部分提交且版本戳不变；TRAE fixture 清单/SHA-256 始终不变；reporter 写入真实结果 |

### 自动化、证据与覆盖

- 测试必须通过真实 Registry、同步计划和安装态 CLI 取证；不得读取真实 TRAE 记忆正文或启动客户端。
- reporter 向 `logos/resources/verify/test-results.jsonl` 追加 `test_id`、`scenario_id="S08"`、`status`、`duration_ms`、候选 tarball SHA-256、逐宿主结果、版本戳与脱敏 evidence；失败不得写 pass。
- [x] `all`/sync 七宿主稳定性：UT-S08-37、ST-S08-27。
- [x] 配置含 TRAE 时事务前严格失败：UT-S08-37、ST-S08-27。
- [x] `.trae/**` 与用户边界不进入同步事务：UT-S08-37、ST-S08-27。
