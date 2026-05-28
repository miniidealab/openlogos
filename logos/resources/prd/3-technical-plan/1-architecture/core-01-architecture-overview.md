# core-01-architecture-overview

## 一、架构总览
OpenLogos 由 CLI、规范源码、Skills、插件模板、静态文档站和示例项目组成。

## 二、系统组件
- `cli/`：核心命令和阶段判断逻辑。
- `spec/`：方法论规范源码。
- `skills/`：AI Skills。
- `plugin/`、`plugin-codex/`、`plugin-opencode/`：宿主工具插件模板。
- `website/`：文档站。
- `logos/resources/`：项目内真相源。

## 三、技术选型
- 语言：TypeScript。
- CLI 运行时：Node.js。
- 文档站：Astro。
- 输出策略：文本 + JSON envelope。

## 四、部署约束
- CLI 与文档站可独立发布。
- 不依赖业务数据库。
- 主要外部依赖是宿主 AI 工具、npm 发布和站点托管。

## 五、非功能性约束
- 阶段判断必须确定性。
- 索引同步必须幂等。
- 变更门禁必须可追溯。
- 测试命令执行必须可选沙箱化，且沙箱结果必须可诊断、可降级、可强制失败。

## 六、项目索引目标
`logos/logos-project.yaml` 应明确：
- `tech_stack`
- `modules`
- `scenario_counter`
- `scenarios`
- `deployment_gates`
- `resource_index`

## 七、实现映射
| 场景 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| S01 | `cli/src/commands/init.ts` | `cli/test/s01-init.test.ts` |
| S05 | `cli/src/commands/next.ts` | `cli/test/s05-next.test.ts` |
| S08 | `cli/src/commands/sync.ts` | `cli/test/s08-sync.test.ts` |
| S09 | `cli/src/commands/change.ts`、`merge.ts`、`archive.ts` | `cli/test/s09-change.test.ts` |
| S11 | `cli/src/commands/status.ts` | `cli/test/s11-status.test.ts` |
| S13 | `cli/src/commands/verify.ts` | `cli/test/s13-verify.test.ts` |
| S14 | `cli/src/commands/launch.ts` | `cli/test/s14-launch.test.ts` |
| S15 | `cli/src/lib/sql-comments.ts` | `cli/test/s15-sql-comments.test.ts` |
| S16 | `cli/src/lib/json-output.ts` | `cli/test/s16-json-output.test.ts` |
| S17 | `cli/src/commands/module.ts` | `cli/test/s17-module.test.ts` |
| S18 | `cli/src/lib/sync-resource-index.ts` | `cli/test/s18-sync-resource-index.test.ts` |
| S19 | `cli/src/commands/smoke.ts` | `cli/test/s19-smoke.test.ts` |
| S20 | `cli/src/commands/adopt.ts` | `cli/test/s20-adopt.test.ts` |

## 八、提案级部署决策架构
部署门禁分为两层：
- **模块级默认值**：`logos-project.yaml` 中 `modules[].deployment_required`、`modules[].smoke_required` 和 `deployment_gates` 描述模块在 Initial / launch 阶段的默认部署要求。
- **提案级决策**：活跃提案的 `proposal.md` 与 `tasks.md` 描述本次变更是否真的需要部署与 smoke。

运行态优先级：
1. 存在活跃提案时，`status` / `next` / JSON 输出优先读取提案级部署决策。
2. 提案级声明无需部署且无 `[deploy]` section 时，verify PASS 后进入 `verify-passed`，下一步为 archive。
3. 提案级声明需要部署且存在 `[deploy]` section 时，verify PASS 后进入 `ready-to-deploy`。
4. 部署完成后，只有提案级 `smoke_required: true` 才进入 `ready-to-smoke`。
5. 历史提案缺少结构化部署决策时，CLI 可回退到 `[deploy]` section 和模块级默认值，但必须标注 `deployment_decision_source`。

实现映射补充：
| 能力 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| 提案级部署决策解析 | `cli/src/commands/status.ts`、`cli/src/commands/next.ts` | `cli/test/s05-next.test.ts`、`cli/test/s11-status.test.ts` |
| 提案模板部署影响字段 | `cli/src/i18n.ts`、`cli/src/commands/change.ts` | `cli/test/s09-change.test.ts` |
| JSON 输出部署决策 | `cli/src/commands/status.ts`、`cli/src/lib/json-output.ts` | `cli/test/s16-json-output.test.ts` |

## 九、verify 预执行架构
verify 预执行由 CLI 统一编排，RunLogos 等客户端只调用 `openlogos verify --format json`，不复制测试编排逻辑。

配置优先级：
1. 若配置 `verify.regression_command` 或 `verify.incremental_command`，启用两阶段模型。
2. 若未配置两阶段命令但配置 `verify.pre_run_command`，执行旧的单阶段全量测试模型。
3. 若均未配置，verify 保持兼容，直接读取现有 `verify.result_path`；覆盖不足时输出诊断与修复建议。

结果路径：
- `verify.result_path`：最终验收读取的逻辑结果路径。
- `verify.regression_result_path`：回归阶段结果路径，可选。
- `verify.incremental_result_path`：增量阶段结果路径，可选。
- 未配置阶段路径时，CLI 需要通过临时快照或等价机制避免增量阶段 reporter 清空回归结果。

合并策略：
- 默认 `last-write-wins`，同一用例 ID 以最后一次阶段结果生效。
- 合并结果写入 `verify.result_path`，供现有 `collectVerifyData` / 报告生成逻辑复用。
- 预跑命令状态、合并来源和诊断进入 `VerifyData` 与 JSON 输出。

实现映射补充：
| 能力 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| verify 预执行与结果合并 | `cli/src/commands/verify.ts` | `cli/test/s13-verify.test.ts` |
| 初始化预跑配置推断 | `cli/src/commands/init.ts` | `cli/test/s01-init.test.ts` |
| sync 预跑配置补齐 | `cli/src/commands/sync.ts` | `cli/test/s08-sync.test.ts` |
| adopt 预跑配置推断 | `cli/src/commands/adopt.ts` | `cli/test/s20-adopt.test.ts` |
| verify JSON 预跑状态 | `cli/src/commands/verify.ts`、`cli/src/lib/json-output.ts` | `cli/test/s16-json-output.test.ts` |

## 十、verify / smoke 沙箱执行架构
OpenLogos CLI 需要在运行时层面支持测试命令隔离，避免外部测试脚本误写工作区。

### 配置优先级
1. `logos.config.json.verify.sandbox_mode` / `logos.config.json.smoke.sandbox_mode`
2. `sandbox_root`
3. `sandbox_deny_workspace_write`
4. 既有预跑 / smoke 命令配置

### 执行边界
- `verify` 与 `smoke` 的沙箱执行是 CLI 责任，不由外部客户端复制。
- 沙箱执行器只能回收配置声明的结果文件和报告文件。
- `always` 模式下，任何非白名单写入都应视为安全违规并导致失败。
- `auto` 模式下，若当前平台无法提供有效隔离，CLI 必须输出告警并在 JSON 中标记降级。

### 实现映射补充
| 能力 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| verify 沙箱执行与结果回收 | `cli/src/commands/verify.ts`、`cli/src/lib/sandbox.ts`（新增） | `cli/test/s13-verify.test.ts`、`cli/test/s16-json-output.test.ts` |
| smoke 沙箱执行与结果回收 | `cli/src/commands/smoke.ts`、`website/scripts/smoke-releases.mjs` | `cli/test/s19-smoke.test.ts` |
| verify / smoke 沙箱配置同步 | `cli/src/commands/init.ts`、`cli/src/commands/adopt.ts`、`cli/src/commands/sync.ts` | `cli/test/s01-init.test.ts`、`cli/test/s20-adopt.test.ts`、`cli/test/s08-sync.test.ts` |
| 沙箱 JSON 诊断 | `cli/src/lib/json-output.ts`、`cli/src/commands/verify.ts`、`cli/src/commands/smoke.ts` | `cli/test/s16-json-output.test.ts` |
