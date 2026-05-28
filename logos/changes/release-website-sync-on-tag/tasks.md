# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-00-information-architecture.md` — 增加“tag 发版后官网 release 数据必须同步”的信息架构约束
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/core-02-docs-website-experience.md` — 更新 `/releases` 发布可见性与回退策略
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 将官网 release 同步写入标准发布步骤和发布后检查项
- [x] 产出 delta 文件到 `deltas/test/smoke/core-smoke-test-cases.md` — 增加“tag 发版后官网 release 同步成功”冒烟用例

## [code] 代码实现
- [x] 更新 `.github/workflows/publish.yml`，在 tag 发版后串联官网 release 数据生成与站点部署流程（含失败中断与日志）
- [x] 更新 `website/scripts/generate-releases.mjs` 或相关发布脚本，确保发布数据刷新失败时给出可诊断输出并支持重试
- [x] 补充/更新 CI 或脚本测试，覆盖 release 同步链路的关键分支（成功、数据源失败、回退）

## [deploy] 部署任务
- [ ] 按更新后的发布链路执行一次 staging 发版演练，确认 npm / GitHub Release / 官网 `/releases` 三者版本一致
- [ ] 在生产执行正式发布后，检查 `/releases` 最新版本、发布时间、摘要与链接均可访问，并保留回滚到上一版站点部署的能力
