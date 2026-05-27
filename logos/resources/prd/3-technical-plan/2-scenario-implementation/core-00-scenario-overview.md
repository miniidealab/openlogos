# core-00-scenario-overview

## 场景地图
| 编号 | 场景名称 | 主要代码 | 主要测试 | 状态 |
|------|---------|---------|---------|------|
| S01 | 初始化 OpenLogos 项目 | `init.ts` | `s01-init.test.ts` | 进行中 |
| S05 | 查看下一步建议 | `next.ts` | `s05-next.test.ts` | 进行中 |
| S08 | 同步 AI 工具资产与资源索引 | `sync.ts` | `s08-sync.test.ts` | 进行中 |
| S09 | 创建、合并、归档变更提案 | `change.ts` / `merge.ts` / `archive.ts` | `s09-change.test.ts` | 进行中 |
| S11 | 查看阶段进度与活跃变更 | `status.ts` | `s11-status.test.ts` | 进行中 |
| S13 | 运行测试验收并生成报告 | `verify.ts` | `s13-verify.test.ts` | 进行中 |
| S14 | 切换到 launched 生命周期 | `launch.ts` | `s14-launch.test.ts` | 进行中 |
| S15 | 处理 SQL 注释规范 | `sql-comments.ts` | `s15-sql-comments.test.ts` | 进行中 |
| S16 | 输出机器可读 JSON | `json-output.ts` | `s16-json-output.test.ts` | 进行中 |
| S17 | 管理模块注册表 | `module.ts` | `s17-module.test.ts` | 进行中 |
| S18 | 同步 resource_index | `sync-resource-index.ts` | `s18-sync-resource-index.test.ts` | 进行中 |
| S19 | 执行部署后 smoke 门禁 | `smoke.ts` | `s19-smoke.test.ts` | 进行中 |
| S20 | 已有项目接入 OpenLogos | `adopt.ts` | `s20-adopt.test.ts` | 进行中 |

## 场景依赖关系
- S01 生成基础项目结构，为后续所有场景提供配置与目录前提。
- S20 与 S01 并列，同为入场路径，但专为已有项目设计；S20 生成的 `bootstrap: adopted` 标记影响 S05、S11、S14 的行为，并要求 CLI 兼容历史 `bootstrap: skipped`。
- S08 依赖 S01 或 S20 生成的配置与资产目录。
- S09 依赖已初始化项目和 guard 机制。
- S11/S13/S14/S19 依赖前序阶段文档与测试结果；S14 对 S20 接入的模块豁免 Initial 文档门禁。

## 场景索引
- [S01](./core-S01-cli-init.md)
- [S05](./core-S05-next-guidance.md)
- [S08](./core-S08-sync-ai-tools.md)
- [S09](./core-S09-change-lifecycle.md)
- [S11](./core-S11-status-progress.md)
- [S13](./core-S13-verify-results.md)
- [S14](./core-S14-launch-lifecycle.md)
- [S15](./core-S15-sql-comment-convention.md)
- [S16](./core-S16-machine-json-output.md)
- [S17](./core-S17-module-management.md)
- [S18](./core-S18-resource-index-sync.md)
- [S19](./core-S19-smoke-gate.md)
- [S20](./core-S20-adopt-existing-project.md)
