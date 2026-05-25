# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/spec/cli-json-output.md` — 补充 `detect.project.modules`、`status.modules` 的容错输出契约，以及 `logos-project.yaml` 解析 warning/diagnostics 字段语义
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md` — 补充局部 YAML 解析失败但 `modules` 可恢复读取的异常分支
- [x] 产出 delta 文件到 `deltas/test/core-S16-test-cases.md` — 增加 `detect/status --format json` 在 `logos-project.yaml` 局部损坏时仍返回 launched lifecycle 与 modules 的测试用例
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 明确 CLI npm 发布生效路径、回滚方式和发布前置检查
- [x] 产出 delta文件到 `deltas/test/smoke/core-smoke-test-cases.md` — 增加发布后 smoke：在 RunLogos 类项目中验证 `detect/status` JSON 生命周期与模块输出

## [code] 代码实现
- [x] 抽取或新增容错读取 `logos/logos-project.yaml` 的 helper：全量 `parseYaml()` 失败时使用 `parseDocument()` 从 AST 恢复读取顶层 `modules`，并返回解析 warning/diagnostics
- [x] 修改 `cli/src/commands/detect.ts`：`collectDetectData()` 使用容错 helper，输出 `project.modules`，并从模块生命周期派生 `project.lifecycle`
- [x] 修改 `cli/src/commands/status.ts`：`collectStatusData()` 和 `--module` 校验使用容错 helper，局部 YAML 错误时仍输出 `data.modules` 与正确 `data.lifecycle`
- [x] 更新 `cli/test/s16-json-output.test.ts`：覆盖 RunLogos 复现形态（前半段 `modules.lifecycle=launched`，后半段 YAML 局部错误）下的 `detect/status` JSON
- [x] 更新必要的 S11/S17 状态或模块测试，确保多模块、`--module` 校验和旧版无 `modules[]` 项目的兼容行为不回退
- [x] 运行 `cd cli && npm test -- --run test/s16-json-output.test.ts test/s11-status.test.ts test/s17-module.test.ts`

## [deploy] 部署任务
- [ ] 发布包含本修复的新版本 `@miniidealab/openlogos` npm 包
- [ ] 在安装新版本 CLI 的环境中进入 `/Users/huangxianglong/gitlab/runlogos`，复跑 `openlogos detect --format json` 与 `openlogos status --format json`，确认 `lifecycle=launched` 且输出 `modules[]`
