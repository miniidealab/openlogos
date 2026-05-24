# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/` — 更新官网信息架构，补充发布动态入口和 npm 数据源边界
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/` — 更新官网页面设计，定义首页发布入口和 `/releases` 全量发布日志页面
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/` — 新增 `/releases` 页面 HTML 原型
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/` — 更新官网构建发布流程，加入 npm 发布数据生成步骤
- [x] 产出 delta 文件到 `deltas/test/smoke/` — 更新官网发布动态 smoke 检查项

## [code] 代码实现
- [x] 增加官网构建期 npm 发布数据生成脚本和静态数据文件
- [x] 新增 `/releases` 全量发布日志页面并在首页加入发布日志入口
- [x] 更新官网导航、构建脚本和 smoke 测试覆盖

## [deploy] 部署任务
- [ ] 构建并部署官网到 Cloudflare Pages
- [ ] 按 smoke 用例确认发布动态页面、首页入口和 npm 数据展示可用
