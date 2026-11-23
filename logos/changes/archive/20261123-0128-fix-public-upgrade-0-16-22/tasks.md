# 实现任务

## [delta] 规格变更
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md` — 定义 Windows 原地升级、用户 Path 修复、入口验证与外部镜像就绪时序。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 定义 0.16.22 公开发布、真实 Windows 候选门、官方源与镜像可用性及回滚方案。
- [x] 产出 `deltas/test/core-S19-test-cases.md` — 定义 Windows 原地升级、旧入口遮蔽、仅用户 Path 可修复与不可修复场景的回归用例。
- [x] 产出 `deltas/test/smoke/core-smoke-test-cases.md` — 定义正式 npm 版本、官网升级入口与真实 Windows 升级的公开 smoke。

## [code] 代码实现

- [x] 单切片：交付 0.16.22 公开升级入口、Windows 原地升级验证、双语说明、公开 smoke 与制品升版。六维评分 8（影响 2、复杂度 2、契约 1、测试 1、发布风险 1、不确定性 1）。删后续自检：单独交付脚本或发布说明均无法在同一候选版本核验实际 CMD 入口和正式官网资产，单片独立交付可验收。（覆盖 UT-S19-108、UT-S19-109、ST-S19-35、ST-S19-36、SMOKE-core-334、SMOKE-core-335）

## [deploy] 公开发布 Windows 升级补丁
- [x] 冻结待发布 HEAD、版本号、远端 tag、npm 指针与 0.16.21 回滚包，保留上一站点部署标识。
- [x] 运行公开发布方案的本地、Linux、Windows 和 GitHub CI 前置门，留存真实 Windows 旧版原地升级与多入口顺序验证证据。
- [x] 发布凭据与 CI 通过后推送版本 tag，观察 npm、GitHub Release 和官网发布。根据实际版本与 tarball 可用性记录镜像状态。
- [x] 核对公网制品同源，提交官网发布数据与部署报告，按生产 ref 落部署标记。
