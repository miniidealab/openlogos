## MODIFIED — ## 一、核心能力列表
## 一、核心能力列表
1. 初始化 OpenLogos 项目（全新项目）。
2. 已有项目接入 OpenLogos（`adopt`，执行完整基础设施初始化，只跳过 Initial 文档门禁）。
3. 同步 AI 工具资产与资源索引。
4. 查看阶段进度与下一步建议。
5. 创建、合并、归档变更提案。
6. 执行 verify 与 smoke。
7. 切换 launched 生命周期。
8. 管理模块注册表。
9. 解析 SQL 注释与输出 JSON。
10. 预执行 verify 的回归与增量测试，并输出机器可读预跑状态。

## MODIFIED — ### 2.6 bootstrap: skipped 行为约束
### 2.6 bootstrap: adopted 行为约束

- `adopt` 命令生成的 `logos-project.yaml` 中，模块 `bootstrap` 字段值为 `adopted`，`lifecycle` 直接为 `launched`。
- `bootstrap: adopted` 表示模块通过存量项目接入进入 OpenLogos；它不是“首轮方法论闭环已完成”，而是“完整 OpenLogos 基础设施已初始化，Initial 文档基线被接入流程豁免，后续应通过补文档提案补齐”。
- `bootstrap: adopted` 模块不要求 Phase 1、Phase 2 和 Phase 3-0 文档存在；`status` 将其显示为「文档基线已跳过（存量项目接入）」，而非未完成。
- `next` 在 `bootstrap: adopted` 且无活跃提案时，固定输出补文档引导，建议执行 `openlogos change add-baseline-docs`，不建议直接开始业务迭代。
- `launch` 对 `bootstrap: adopted` 且 `lifecycle: launched` 的模块豁免 Initial 文档门禁检查。
- CLI 必须继续兼容历史 `bootstrap: skipped`，读取时按 adopted 接入模式处理；但 `adopt` 新写入的项目必须使用 `bootstrap: adopted`。
- 补文档提案（如 `add-baseline-docs`）归档后，`next` 恢复正常阶段建议逻辑。若后续需要表示基线已补齐，可由专门变更引入 `baseline_status`，本次不新增第三个状态维度。

## MODIFIED — ### S20
### S20
adopt 后必须生成完整 `logos/` 目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；生成的模块标记为 `bootstrap: adopted` 与 `lifecycle: launched`；同时应为可识别测试栈写入 verify 预跑配置，无法推断时输出 TODO。`status` 必须将 Initial 文档基线显示为「已跳过（存量项目接入）」；`next` 必须输出补文档引导；`launch` 必须豁免 Initial 文档门禁。目录已存在 `logos/logos.config.json` 时必须拒绝重复执行并报错。历史 `bootstrap: skipped` 项目必须保持兼容。
