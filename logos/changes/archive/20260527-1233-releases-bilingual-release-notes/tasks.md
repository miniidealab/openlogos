# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/core-02-docs-website-experience.md` — 更新官网发布日志页双语摘要展示规格
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/core-03-release-page-prototype.html` — 更新 release 页面原型中的双语摘要结构
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 更新官网重新部署与回滚说明
- [x] 产出 delta 文件到 `deltas/test/smoke/core-smoke-test-cases.md` — 更新 release 页面双语摘要 smoke 用例

## [code] 代码实现
- [x] 扩展 release 摘要解析 / 数据生成逻辑，产出英文优先与中文原文并存的双语摘要字段
- [x] 更新 `/releases` 页面渲染，英文摘要主展示、中文原文次级展示，并处理缺失摘要回退
- [x] 更新 release 页面 smoke 脚本与相关测试，覆盖双语摘要和英文回退文案

## [deploy] 部署任务
- [x] 按部署方案重新构建并部署官网到 staging / 生产环境
- [x] 确认官网发布日志页面可访问、版本数据刷新成功，并保留回滚到上一版官网构建的能力
