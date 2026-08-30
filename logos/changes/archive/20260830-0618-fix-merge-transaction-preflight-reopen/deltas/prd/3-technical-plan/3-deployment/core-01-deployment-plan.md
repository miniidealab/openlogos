## ADDED — OpenLogos 0.14.2 Preflight/Reopen 本机候选部署方案

### 部署目标与授权边界

目标是构建并验证固定字节的 `@miniidealab/openlogos@0.14.2` npm tarball，在隔离 prefix 证明新/旧事务行为与完整回滚后，再在独立授权下覆盖本机全局0.14.1，并在后续独立授权下执行smoke和RunLogos恢复。

本节是部署计划，不构成执行授权。npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare部署和git push均不在范围内。

### 前置条件

1. 25个Delta已合并，代码切片与全部UT/ST/SMOKE runner/reporter完成，`openlogos verify`为PASS。
2. 用户明确授权本机部署后才开始pack/install；smoke与RunLogos恢复分别再次确认。
3. 工作区待部署字节已形成可追溯提交或固定source hash集合，避免脏工作区混入tarball。
4. 记录当前全局0.14.1命令路径、realpath、npm prefix、package version及随包schema/skill/golden/asset hashes。
5. 冻结可离线安装的0.14.1回滚tarball及SHA-256；无法取得固定回滚制品时不得覆盖全局。

### 0.14.2 构建与制品证明

1. 在仓库真实CLI目录运行完整测试、build和package asset生成流程。
2. 执行真实`npm pack --json`，记录tarball绝对路径、文件名、字节数和SHA-256。
3. 校验package/plugin/asset版本均为0.14.2，且tarball包含编译CLI、merge transaction schemas、status/next schemas、双语merge-executor Skill、golden和smoke runner。
4. 从tarball而非源码/workspace link导入语义validator，验证completed golden及公共字段集合。
5. candidate facts任一不一致立即停止并重新build/pack，不复用旧hash或覆盖同名不同字节。

### 隔离安装与行为矩阵

在一次性npm prefix安装0.14.2，并使用新shell/绝对入口运行：

| 类别 | 必须证明 |
|---|---|
| 新事务 | 歧义after表在seal前退回collecting；无seal、journal、apply staging或正式写入 |
| 新事务成功 | preflight-bound seal与apply重算一致并completed |
| legacy sealed | 无preflight record的0.14.1 fixture通过时沿用legacy seal；可归因失败时只退回错误slot |
| 崩溃窗口 | transaction rename前/后fault分别收敛完整sealed/collecting；残留私有字节不影响status/next |
| fatal边界 | OpenLogos producer、mixed attribution、metadata drift、journal存在均不清slot |
| 回滚 | 0.14.1→0.14.2→0.14.1→0.14.2，入口及全部资产hash与所选版本一致，无混装 |

### 本机全局安装

只有隔离矩阵全部PASS后才安装同一SHA-256 tarball到已冻结全局prefix。新shell必须核验：

- `openlogos --version`、命令路径和realpath；
- package/plugin/asset identity；
- merge/status/next schema与contract hashes；
- 新事务seal正反例、legacy最小reopen、reporter可写临时fixture；
- 全局旧文件不存在、npm缓存或shell hash未指向0.14.1。

### Smoke 与 RunLogos 交接

获得smoke授权后执行SMOKE-core-160～162并写`smoke-results.jsonl`。获得RunLogos恢复授权后：

1. 在RunLogos项目根确认guard、transaction ID `mtx_7e0341e3719feccd22ef7615`、plan/target-set/seal和15个slot。
2. apply触发preflight reopen，确认只`core-S44-test-cases.md` slot缺失、其余14个submitted。
3. 在声明staging修正`UT-S44-24`六列表格，submit同slot；不得写正式baseline或transaction私有文件。
4. 同transaction重新seal/apply至completed，核验receipt、final/artifact hashes、test-change-set和`SPEC_MERGED`。
5. 出现不可归因fatal、drift或recovery错误立即停止，不abort/新建transaction掩盖。

### 失败与回滚

- pack/隔离/回滚任一步失败：不覆盖全局。
- 全局安装或自检失败：立即用固定0.14.1 tarball恢复，并复核入口和全部资产hash。
- smoke失败：不生成SMOKE_PASS；修复后重新verify/pack/install/smoke，或回滚0.14.1。
- RunLogos失败：不伪造completed/receipt/marker，不修改未授权仓库事实。

### 完成判据

部署完成只证明0.14.2固定制品已正确安装且可回滚；smoke与RunLogos transaction completed分别由其独立报告/receipt证明。任何公开发布、archive或push仍需独立授权。
