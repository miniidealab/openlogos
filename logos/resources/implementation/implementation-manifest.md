# website-release-feed 实现清单

## 范围
- 官网发布动态页面 `/releases`
- 首页发布日志入口
- npm 发布数据生成脚本
- 官网发布动态 smoke 检查脚本

## 覆盖任务
- [x] 增加官网构建期 npm 发布数据生成脚本和静态数据文件
- [x] 新增 `/releases` 全量发布日志页面并在首页加入发布日志入口
- [x] 更新官网导航、构建脚本和 smoke 测试覆盖

## 产物
- `website/scripts/generate-releases.mjs`
- `website/src/data/releases.json`
- `website/src/pages/releases.astro`
- `website/src/pages/index.astro`
- `website/src/layouts/BaseLayout.astro`
- `website/src/pages/zh/index.astro`
- `website/scripts/smoke-releases.mjs`

## 验证
- `npm run generate:releases`
- `npm run build`
- `npm run smoke:releases`
