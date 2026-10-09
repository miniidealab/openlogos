# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 `deltas/prd/1-product-requirements/core-01-requirements.md` — Claude Code 托管资产需求补「按 locale 写入项目 language」
- [ ] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 新增 `language` 键的合并规则（变更概述 1～6）
- [ ] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S08-sync.md` — sync 时序中 `.claude/settings.json` 合并步骤补 `language`
- [ ] 产出 delta 文件到 `deltas/test/core-S08-test-cases.md` — 新增 UT-S08-79 起（写入 / 托管值更新 / 自定义值保留并提示 / 损坏容错 / 幂等）、ST-S08-42 起（zh 项目 sync 端到端、locale 切换后 sync 跟随）

## [code] 代码实现
（plan 段留空：由 merge 后的 slice-planner 基于已合并规格和真实测试 ID 规划。）

## [deploy] 发布
- [ ] 随下一个 openlogos 版本发布并本机全局安装；在 runlogos 运行 `openlogos sync` 确认项目 `.claude/settings.json` 出现 `"language": "chinese"`
