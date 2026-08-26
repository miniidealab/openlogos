## ADDED — TRAE 候选 tarball 安装态初始化测试

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S01-128 | 本地负向 init runner 的制品与排除合同 | S01 候选 tarball 安装态初始化时序 | 提供真实 `0.13.29` tarball；一次性 root 含 prefix/HOME/workspace/evidence 与合成 TRAE fixture | 分别注入正确制品、错误版本、prefix 外入口、`trae` 和 `all` 执行结果 | 正确制品只接受 prefix 内入口；`trae` 非零且零写入；`all` 精确七宿主且无 `.trae/**` 变化；错误版本/入口/集合/哈希均 fail loud |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S01-26 | 真实 `0.13.29` tarball 的初始化排除闭环 | 候选安装 → 显式 TRAE 拒绝 → `all` 七宿主 → 边界审计 | 候选 tarball 已校验并安装到一次性 prefix；fixture 预置合成 `.trae/**`、settings、账号占位、`enabled_folders` 和不透明记忆 | 解析 tarball 内 CLI；记录前态；执行 `init --ai-tool trae`；执行独立 workspace 的 `init --ai-tool all`；比较写入审计、支持集合、目标树与哈希 | CLI 版本为 0.13.29 且 realpath 位于 prefix；显式 TRAE 在首次写入前失败；`all` 只部署稳定七宿主；TRAE fixture 清单/SHA-256 不变；reporter 写入真实结果 |

### 自动化、证据与覆盖

- 测试必须执行打包后 CLI 或对 runner 进行可验证的进程级合同测试；不得用手写支持数组或“模板不存在”作为唯一证据。
- reporter 向 `logos/resources/verify/test-results.jsonl` 追加 `test_id`、`scenario_id="S01"`、`status`、`duration_ms`、候选 tarball SHA-256、CLI 入口类别和脱敏 evidence；失败不得写 pass。
- [x] 真实候选制品与隔离入口：UT-S01-128、ST-S01-26。
- [x] 显式 TRAE 首写前拒绝：UT-S01-128、ST-S01-26。
- [x] `all` 七宿主与 TRAE 用户边界零触达：UT-S01-128、ST-S01-26。
