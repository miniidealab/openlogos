# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：S09 补 guard 管辖边界（项目外路径放行）与阻断原因可见性（stderr 可读 reason）验收条件；S19 补 0.14.22 候选发布要求
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：新增 2.64 guard 管辖边界与阻断 reason 双通道输出功能规格 + 0.14.22 候选内容清单与发布验收
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：S09 补 guard-check 管辖边界判定分支与阻断输出双通道时序
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：S19 新增 0.14.22 候选发布节（身份冻结→隔离矩阵→全局覆盖→smoke 与失败回滚边界）
- [x] [MODIFY] `deltas/spec/pretooluse-guard.md`：§阻断（exit 2）改双通道输出、§工作目录收敛与 fail-closed 补 stderr 语义、新增管辖边界节
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：新增 0.14.22 本机全局部署方案章节（隔离矩阵 + 0.14.21 对照 + 回滚制品固定 0.14.21 tarball）
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：UT-S09-315～316、ST-S09-121
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：UT-S19-39（0.14.22 候选身份全源一致与回滚身份 0.14.21 tripwire）
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：SMOKE-core-193（安装态 guard 两处修复全链 + 0.14.21 对照 + roundtrip）

## [code] 代码实现

> 六维打分：影响范围 1（plugin/bin/guard-check + 版本身份文件族 + runner + 三个测试文件）、行为复杂度 1（管辖边界 python3/node 归一化与 bash 兜底分支 + 阻断双通道输出）、契约变化 1（阻断输出合同补 stderr + 候选身份推进，无 API/DB）、测试规模 1（5 个新 ID）、风险 1（部署提案但回滚制品固定 0.14.21 tarball）、不确定性 0（两缺陷已在 runlogos 本地热修复核成立）→ 5 分，非大任务，单切片。
> 删后续自检：单切片无后续可删。曾拟拆「guard 修复片」+「0.14.22 身份与 runner 片」：UT-S19-39 断言 asset-manifest 含 guard-check **新字节**哈希、SMOKE-core-193 矩阵同时断言 0.14.22 身份与两处修复行为——前片单独跑全量 verify 时 UT-S19-39（身份仍 0.14.21）必红，(a) 否；后片单独做则 guard 新字节不存在，(b) 亦否。两片共享同一候选发布事实，互相咬死，向前合并为单片。
- [x] 单切片：guard-check 管辖边界与阻断双通道修复 + 0.14.22 候选身份与 SMOKE-core-193 runner——`plugin/bin/guard-check` 两处修复（①`is_whitelisted_path` 白名单前缀匹配前先判管辖：python3/node 归一化 `rel_path` 为 `..` 或 `../` 前缀即项目根之外放行，bash 兜底分支绝对路径不位于 `$(pwd)/` 之下放行，项目内判定逐项不变；②`block()` 与 Step 0 两处 fail-closed 在既有 stdout `{"reason":…}` JSON 之外以 `printf '%b\n' >&2` 同步输出可读 reason，放行路径 stderr 零噪音）；0.14.22 候选身份全链同步（package/lockfile/五 plugin manifest/asset-manifest/`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.22`、`ROLLBACK=0.14.21`/tripwire/golden，asset-manifest 含 guard-check 新字节版本化哈希条目）；新增 `scripts/smoke-guard-fix-0-14-22.js`（candidate identity + 项目外放行 + 项目内拦截 stderr 含指引 + fail-closed stderr + 项目内零回归 + 0.14.21 误拦截/空 stderr 缺陷复现对照 + 0.14.21→0.14.22 roundtrip）并接入 `scripts/run-smoke.js` 注册表、写 `logos/resources/verify/smoke-results.jsonl`、完成后跑 smoke 覆盖预检；实现含 OpenLogos reporter 的 UT-S09-315～316、ST-S09-121、UT-S19-39、SMOKE-core-193

## [deploy] 部署任务
- [x] 按部署方案 0.14.22 章节执行隔离矩阵（SMOKE-core-193 runner：candidate identity、guard 两处修复全链、0.14.21 缺陷复现对照、roundtrip 回滚演练）——0.14.22 tarball sha256 0bdcefb37a0743575d44c7645169c0c668bbcaaa22e206e7e209325f8a283ac1，矩阵 PASS（证据：deployment-artifacts/fix-guard-check-external-path-and-stderr/matrix-smoke-results.jsonl）
- [x] 矩阵与回滚演练 PASS 后，覆盖安装 0.14.22 tarball 到本机全局 prefix（`/opt/homebrew`），新 shell 复核 identity 全同源 0.14.22，并确认回滚预案（0.14.21 tarball，sha256 ac173f5f…c285f）就位——新 shell 复核 entry/realpath/version/五 manifest/asset-manifest 全 0.14.22，随包 guard-check sha256 3edd5259…8881d74f 与仓库一致
