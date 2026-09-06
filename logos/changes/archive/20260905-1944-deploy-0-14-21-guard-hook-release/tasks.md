# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：S19 验收补 0.14.21 候选发布要求
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：0.14.21 候选内容清单与发布验收
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：0.14.21 候选发布节（身份冻结→矩阵→覆盖→smoke）
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：OpenLogos 0.14.21 本机全局部署方案章节
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：UT-S19-38
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：SMOKE-core-192

## [code] 代码实现

> 六维打分：影响范围 1（版本身份文件族 + runner + 注册表）、行为复杂度 0（无业务分支）、契约变化 1（候选身份推进）、测试规模 1（2 个新 ID）、风险 1（部署提案但回滚制品固定）、不确定性 0 → 4 分，非大任务，单切片。
> 删后续自检：单切片无后续可删；身份 bump 与 runner 共享同一候选身份事实，拆开不自闭环。
- [x] 单切片：0.14.21 候选身份与 SMOKE-core-192 runner——package/lockfile/五 plugin manifest/asset-manifest/LOCAL_RELEASE_CANDIDATE_VERSION=0.14.21、ROLLBACK=0.14.20/tripwire/golden 同步（UT-S19-38 断言全源一致含 guard-check manifest 条目）；新增 scripts/smoke-guard-hook-0-14-21.js（安装态 guard 全链+fail-closed+存量 sync 补齐+0.14.20 fail-open/资产缺失对照+roundtrip）并接入 scripts/run-smoke.js 注册表、写 smoke-results.jsonl；实现含 OpenLogos reporter 的 UT-S19-38、SMOKE-core-192

## [deploy] 部署任务

- [x] 使用本提案构建的真实 npm tarball（0.14.21）完成隔离矩阵（含 guard 全链验收、存量项目 sync 补齐实测与 0.14.20 fail-open 零回归对照）后部署到本机全局；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
- [x] 按合并后的部署方案确认制品哈希、回滚制品（固定 0.14.20 tarball，sha256 b252cec4465806a4555fa2cc2018fb908fc09f71ba9a198bbd9dd28fec01fcbf）、全局 identity 同源与失败回滚准备，并更新部署报告。
