# 实现任务

> 目标版本：`0.14.1`。本提案只授权本机 npm 全局部署，禁止公开发布。

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：补充 S19 对 0.14.1 本地全局制品、回滚恢复与公开发布隔离的验收条件。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：定义 patch candidate 的版本一致性、自检、回滚和成功证据。
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：补充 0.14.1 candidate 身份冻结、安装态检查和失败回滚分支。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：定义 0.14.1 真实 tarball、本机全局安装证据、0.14.0 回滚恢复和公开发布隔离。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：新增 UT-S19-22、UT-S19-23、ST-S19-15，覆盖版本/candidate 身份与真实 pack-install-self-check。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：新增 SMOKE-core-157～159，覆盖 0.14.1 全局制品、消费者合同与 0.14.0 回滚恢复。

## [code] 代码实现

> 六维评分：影响范围 2 + 行为复杂度 2 + 契约变化 1 + 测试规模 1 + 风险等级 1 + 不确定性 0 = 7，属于非大任务，按规则保留单切片。
>
> 删后续证伪：本提案只有一片，不存在后续片；完成后可由真实 0.14.1 tarball 的隔离安装、0.14.0 回滚与恢复链端到端观察，并由全量 UT/ST、OpenLogos reporter 和 smoke 覆盖预检独立验收。版本身份、candidate validator、pack/install/rollback 与安装态 smoke 共用同一冻结制品事实，若按文件或工种拆分会退化为横切，因此无需拆分。

- [x] 单切片：把当前 candidate/package identity 同步为 0.14.1，保留 0.14.0 breaking/history/legacy 语义；实现 0.14.1 同源证据校验、旧/混合证据与公开发布动作 fail-closed、固定 0.14.0 tarball 回滚命令，以及隔离 prefix 的真实 `pack → install → self-check → rollback → restore`；同步必要 golden、Vitest 测试与 OpenLogos `test-results.jsonl` reporter；实现 SMOKE-core-157、SMOKE-core-158、SMOKE-core-159 的 `scripts/smoke-*` runner、`smoke-results.jsonl` reporter、`scripts/run-smoke.js` 接入并运行 smoke 覆盖预检（覆盖 UT-S19-22、UT-S19-23、ST-S19-15、SMOKE-core-157、SMOKE-core-158、SMOKE-core-159）。

## [deploy] 本地全局部署任务

- [x] 在 verify PASS 后记录当前全局 `openlogos` 的命令路径、realpath、npm prefix、精确 0.14.0 版本、安装来源与可复制恢复命令。
- [x] 构建真实 `@miniidealab/openlogos@0.14.1` npm tarball，校验包名、版本、入口、文件清单、插件/asset manifest 版本、大小与 SHA-256。
- [x] 从固定 tarball 安装到本机 npm 全局环境，并在新 shell 中校验命令解析、`openlogos --version`、package/plugin/asset manifest 与 candidate 证据均为 0.14.1。
- [x] 若安装或自检失败，立即恢复部署前 0.14.0 并验证入口与版本；成功则保留 0.14.0 可恢复制品/来源并生成 `logos/resources/verify/deployment-report.md`。

`openlogos smoke` 是部署后的独立验收节点，不以本节 checkbox 代替；部署任务不授权 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。
