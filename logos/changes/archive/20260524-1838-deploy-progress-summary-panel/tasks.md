# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/` — 更新部署进度摘要面板相关的阶段与验收条件
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — 更新 `status --format json` 的部署进度摘要契约与 RunLogos 面板说明
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/` — 更新 S05 / S11 / S19 的状态流转与门禁说明
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — 更新部署后检查清单，覆盖部署进度摘要字段
- [x] 产出 delta 文件到 `deltas/spec/cli-json-output.md` — 更新 `status --format json` 契约字段表与部署进度摘要定义
- [x] 产出 delta 文件到 `deltas/test/core-S11-test-cases.md` — 更新部署进度摘要相关测试用例
- [x] 产出 delta 文件到 `deltas/test/smoke/core-smoke-test-cases.md` — 更新部署后 smoke 用例中对部署进度摘要的覆盖

## [code] 代码实现
- [x] 更新 `openlogos status` 的 JSON 输出字段与部署进度判断逻辑
- [x] 更新 `openlogos next` 的建议文案与部署状态映射
- [x] 增加或调整对应的 CLI 单元测试与场景测试
- [x] 增加 OpenLogos reporter 输出，确保 verify 可读取结果

## [deploy] 部署任务
- [x] 发布新的 CLI 版本到 npm
- [x] 验证 RunLogos 可消费新的 `status --format json` 字段
- [x] 确认部署进度摘要面板在 verify / deploy / smoke 状态下展示正确
