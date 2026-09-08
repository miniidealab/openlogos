# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/spec/change-management.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/spec/cli-json-output.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/spec/flow-spec.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S13-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：见 proposal 变更范围。
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：见 proposal 变更范围。

## [code] 代码实现

## [deploy] 部署执行

- [ ] 冻结本机全局 0.14.25 事实（command -v / realpath / version / manifest hash）
- [ ] 真实 `npm pack` 冻结 0.15.0 tarball 并记录 SHA-256
- [ ] `mktemp -d` 一次性 npm prefix 安装固定 tarball，执行隔离行为矩阵
- [ ] 复核本机全局仍为 0.14.25（部署后取证），删除临时 prefix
