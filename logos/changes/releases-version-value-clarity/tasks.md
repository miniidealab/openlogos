# 实现任务

## [delta] 规格变更
- [x] 更新 `prd/2-product-design/1-feature-specs/core-00-information-architecture.md` — 明确 release 页面应展示版本价值与问题解决摘要
- [x] 更新 `prd/2-product-design/2-page-design/core-02-docs-website-experience.md` — 定义 `/releases` 页面版本说明来源、展示字段与缺省回退规则
- [x] 更新 `prd/2-product-design/2-page-design/core-03-release-page-prototype.html` — 补充每个版本的价值摘要与问题解决摘要展示
- [x] 更新 `prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 补充 release 页面发布后检查项
- [x] 更新 `test/smoke/core-smoke-test-cases.md` — 增加 release 页面版本说明可见性烟测

## [code] 代码实现
- [ ] 更新 `website/scripts/generate-releases.mjs` — 读取 `CHANGELOG.md` 中的版本说明摘要并写入静态发布数据
- [ ] 更新 `website/src/data/releases.json` 的生成结果结构 — 为版本项提供可展示的说明摘要字段
- [ ] 更新 `website/src/pages/releases.astro` — 在版本卡片中展示版本价值、问题修复摘要与外链回退提示
- [ ] 更新 `website/scripts/smoke-releases.mjs` — 校验 `/releases` 页面存在版本说明摘要和回退提示
- [ ] 更新相关测试用例 — 覆盖 release 摘要解析、页面渲染与烟测校验

## [deploy] 部署任务
- [ ] 按部署方案重新部署官网生产环境
- [ ] 确认 `/releases` 页面可访问且版本说明已生效
