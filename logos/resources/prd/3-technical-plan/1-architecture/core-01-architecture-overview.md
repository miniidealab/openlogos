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
| S05 | `cli/src/commands/next.ts`、`cli/src/lib/flow-derive.ts` | `cli/test/s05-next.test.ts`、`cli/test/s11-flow-derive.test.ts` |
| S08 | `cli/src/commands/sync.ts` | `cli/test/s08-sync.test.ts` |
| S09 | `cli/src/commands/change.ts`、`merge.ts`、`archive.ts`、`cli/src/lib/proposal-lifecycle.ts`、`cli/src/lib/flow-derive.ts` | `cli/test/s09-change.test.ts`、`cli/test/s09-flow-derive-launched.test.ts` |
| S11 | `cli/src/commands/status.ts`、`cli/src/lib/proposal-lifecycle.ts`、`cli/src/lib/flow-derive.ts` | `cli/test/s11-status.test.ts`、`cli/test/s11-flow-derive.test.ts`、`cli/test/s09-flow-derive-launched.test.ts` |
| S13 | `cli/src/commands/verify.ts` | `cli/test/s13-verify.test.ts` |
| S14 | `cli/src/commands/launch.ts` | `cli/test/s14-launch.test.ts` |
| S15 | `cli/src/lib/sql-comments.ts` | `cli/test/s15-sql-comments.test.ts` |
| S16 | `cli/src/lib/json-output.ts` | `cli/test/s16-json-output.test.ts` |
| S17 | `cli/src/commands/module.ts` | `cli/test/s17-module.test.ts` |
| S18 | `cli/src/lib/sync-resource-index.ts` | `cli/test/s18-sync-resource-index.test.ts` |
| S19 | `cli/src/commands/smoke.ts` | `cli/test/s19-smoke.test.ts` |
| S20 | `cli/src/commands/adopt.ts` | `cli/test/s20-adopt.test.ts` |
| S21 | `cli/src/commands/deploy-done.ts` | `cli/test/s21-deploy-done.test.ts` |
| S22 | `cli/src/lib/flow.ts`、`cli/src/commands/flow.ts` | `cli/test/s22-flow.test.ts` |
| S23 | `cli/src/commands/watch.ts`（轮询 `collectStatusData`） | `cli/test/s23-watch.test.ts` |
| S24 | `cli/src/commands/next.ts`、`cli/src/lib/flow-derive.ts`（gate 查询助手） | `cli/test/s24-auto-gate.test.ts` |
| S25 | `cli/src/lib/flow-derive.ts`（三入口接入 resolved）、`cli/src/lib/flow.ts`（applyOverlay 校验）、`cli/src/commands/{status,next,watch}.ts`（node 级视图 / 错误信封） | `cli/test/s25-overlay-derive.test.ts` |

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

## 十一、DEPLOY_DONE 受控落标架构

部署完成状态由三类事实共同决定：

1. `VERIFY_PASS`：由 `openlogos verify` 根据验收门禁自动写入。
2. `[deploy]` section：由当前提案 `tasks.md` 描述部署执行任务，并由 `openlogos deploy-done` 成功后统一勾选。
3. `DEPLOY_DONE`：由 `openlogos deploy-done` 在前置条件全部满足后写入。

CLI 不提供通用 `deploy` 命令，因为实际部署动作依赖项目部署方案，可能包含 npm 发布、GitHub Actions、Cloudflare Pages、SSH、容器发布或其他外部步骤。CLI 只负责部署动作完成后的状态确认。

实现映射补充：

| 能力 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| 部署完成落标命令 | `cli/src/commands/deploy-done.ts`、`cli/src/index.ts` | `cli/test/s21-deploy-done.test.ts` |
| 部署状态与下一步建议 | `cli/src/commands/status.ts`、`cli/src/commands/next.ts` | `cli/test/s05-next.test.ts`、`cli/test/s11-status.test.ts` |
| deployment-executor 调用命令 | `logos/skills/deployment-executor/SKILL.md` | `cli/test/s21-deploy-done.test.ts` |

状态一致性要求：
- `DEPLOY_DONE` 不得绕过 `VERIFY_PASS`。
- `DEPLOY_DONE` 不得在部署决策冲突时写入。
- `DEPLOY_DONE` 与 `[deploy]` section 全勾必须同步满足，状态机才可离开 `ready-to-deploy`。
- 重新写入 `DEPLOY_DONE` 时必须清理旧的 `SMOKE_PASS` / `SMOKE_FAIL`，因为旧 smoke 结论只对应旧部署环境。

资源索引同步要求：
- `logos-project.yaml` 的 `scenario_counter.next_id` 应从 `21` 推进到 `22`。
- `logos-project.yaml` 的 `scenarios` 应新增 `S21 标记部署完成`，模块为 `core`。
- `logos-project.yaml` 的 `resource_index` 应补录 `core-S21-deploy-done-marker.md`、`core-S21-test-cases.md` 和新增命令实现路径。

## 十二、initial phase 派生引擎（flow-derive）

M1 切片 B1 引入 `cli/src/lib/flow-derive.ts`，把 **initial 模块**的 phase 派生从硬编码的
`PHASE_KEYS` / `PHASE_SUBPATHS` 数组改为**从内置（builtin）flow 模型派生**，让声明式 flow
真正成为 `status` / `next` 的事实来源。行为严格 1:1 不变，由 golden 快照 + 全量测试 +
测试期并跑断言三重锁定。

### 引擎定位

- **数据来源 = builtin initial flow**（`spec/flow/initial.yaml` 经 loader 加载的内置模型），
  **本切片不应用项目 overlay**。理由：overlay（skip/add/modify/reorder）会按设计改变流程，
  属于有意的行为变更，与 1:1 目标冲突；overlay 驱动 status/next 留作后续独立切片。
- **launched 的 `detectProposalStep` 状态机不在本切片范围**（高风险改造留切片 B2），
  `flow-derive` 只服务 initial 模块。

### 派生流程

1. 求值各 node 的 `when` 上下文标志（`bootstrap` / `api_enabled` / `db_enabled` /
   `scenario_enabled` / `deployment_required` / `smoke_required`），不满足者标 skipped。
   - `deployment_required = module.deployment_required !== false && !skip_phases.includes('deployment')`；
   - `smoke_required = deployment_required && module.smoke_required !== false`
     （`module.smoke_required` 未声明视为 `true`，仅显式 `false` 才关闭）。
2. 按 `done_when` 判定每个 node：`dir_nonempty` / `file:<path>` / fan-out 场景覆盖；
   fan-out 节点输出覆盖数据 `{ total, covered, missing }`。场景文件匹配**保留 legacy
   `includes()` 子串匹配**（不采用 flow-spec §141 的 glob 精确匹配——glob 是未来的有意修正）。
3. 经 **code 侧 node-id → phase-key 映射表**（维护在 `flow-derive.ts`，使 `spec/flow/*.yaml`
   保持纯净）把 node 结果翻译为 `phase_progress` / 顶层 `phases[]` / `current_phase`。
   13 个节点 1:1 映射：`prd→phase.1`、`product-design→phase.2`、`architecture→phase.3-0`、
   `scenario-modeling→phase.3-1`、`api-design→phase.3-2-api`、`db-design→phase.3-2-db`、
   `deployment-design→phase.3-3-deployment`、`test-cases→phase.3-4a`、
   `orchestration-test→phase.3-4b`、`code→phase.3-5`、`verify→phase.3-6`、
   `deploy→phase.3-7-deploy`、`smoke→phase.3-8-smoke`。

### done 规则由消费端分别保持（两套 legacy 语义）

引擎只产数据，**done 判定规则由消费端各自套用，二者均与现状 1:1**：

- **场景阶段**（`phase.3-1` / `phase.3-4a`）：顶层 `phases[]` = 目录有任意文件即 done
  （any-present）；per-module `phase_progress` = 场景全覆盖才 done（all-present，产
  covered/total/missing）。
- **非场景阶段**：顶层 `phases[]` = 扫整个目录有任意文件即 done；per-module（多模块时）
  = 仅按 `{module}-` 前缀过滤后有任意文件即 done。

### 消费方与约束

- `status` 的 `deriveModulePhaseProgress` 与顶层 `phases[]` 改用引擎数据，JSON 输出 shape
  不变；`next` 的 initial 路径消费引擎派生的 `current_phase`（launched 路径不动）。
- **并跑断言仅存在于测试期**：在测试套件里对同一 fixture 同时跑新引擎与旧
  `deriveModulePhaseProgress` / `phases[]` 并断言相等，**不进入生产 CLI 路径**——生产路径
  直接用新派生，运行时绝不因断言导致 status/next 崩溃。

## 十三、launched 变更生命周期派生引擎（flow-derive）

M1 切片 B2 把 **launched 模块**的变更生命周期判定 `detectProposalStep`（11+ 态 `ProposalStep`
状态机）改为从**内置（builtin）launched flow**（`spec/flow/launched.yaml`）派生，新增
`detectProposalStepViaFlow(proposalDir, moduleDefaults)`，让声明式 flow 也成为 launched 路径的
事实来源。行为严格 1:1 不变，由 golden 快照 + 全量测试 + 测试期并跑等价断言三重锁定。

### 先抽公共 lib 断循环依赖

为让 `flow-derive.ts` 能复用 launched 判定所依赖的纯函数，又不与 `status.ts` 形成运行时循环依赖，
先把这批 proposal-lifecycle 纯函数下沉到新的 `cli/src/lib/proposal-lifecycle.ts`：
`resolveProposalDeploymentDecision` / `parseTaskSections` / `getDeploySectionSummary` /
`hasSmokeCasesForProposal` / `isProposalTemplateFilled` / `isTasksTemplateFilled` /
`countMergeableDeltaFiles` / `allTasksChecked` / `getDeployTasks`，以及
`detectProposalStep` 本身。`status.ts` 改为从该 lib `import` 并 **re-export**（对外接口不变），
`flow-derive.ts` 依赖该 lib。该下沉与 B1 把 `listFiles` 下沉到 `cli/src/lib/list-files.ts` 同理。

### 引擎定位（诚实的范围边界）

launched flow 红利是**部分的**：`launched.yaml` 提供**节点序列 + 各节点 `done_when`/`fail_when`**，
但 `detectProposalStep` 的两类核心逻辑作为**引擎派生规则保留、不下沉到 flow**：

- **marker 优先级（非对称，须精确复刻）**：`VERIFY_FAIL` 是**全局最先**判定（在 template 检查、
  merge、deploy 之前）；而 `SMOKE_FAIL` / `SMOKE_PASS` **不是全局优先**——仅在 `VERIFY_PASS`
  成立、需要部署、`DEPLOY_DONE` 存在且 deploy 任务全勾之后的 deploy 子块内才评估，否则仍停在
  `ready-to-deploy`（对照 `status.ts` 旧 `detectProposalStep`：`VERIFY_FAIL` 在最前 vs
  `SMOKE_FAIL`/`SMOKE_PASS` 在 deploy 子块内）。
- **提案级部署决策**：`resolveProposalDeploymentDecision`（含冲突态、`deployment_required` /
  `smoke_required` 是否需要、deploy 任务勾选）继续复用——`launched flow` 的 `deployment_required` /
  `smoke_required` 取**提案级**决策（见 flow-spec §163），**不得**回退到模块默认。
- **section 完成语义按 legacy**：`done_when: section_complete:<tag>` 须按旧 `detectProposalStep`
  实现为 **`total > 0 && checked === total`**（present-but-empty 的 `[delta]`/`[code]`
  **不算完成**），**不**采用 flow-spec §184 字面的"全部勾选或不存在"（否则空 section 会让状态漂移）。

即 B2 = 「节点序列声明化 + 规则仍在引擎」，与 B1 中 fallback-skip / 多模块交集留在引擎同理。

### 派生流程

`detectProposalStepViaFlow` 按 `launched.yaml` 的节点顺序（propose → merge → implement →
deliver → close）求值各节点的 `done_when` / `fail_when`，叠加上述引擎规则映射为 `ProposalStep`：

1. **全局优先**：`fail_when: marker:VERIFY_FAIL` 命中 → `verify-failed`（最先判定，先于 template /
   merge / deploy）。
2. **propose 子流程**：`done_when: proposal_package_filled`（proposal.md + tasks.md 均脱模板）未满足
   → `writing`；`write-delta` 节点 `done_when: section_complete:delta` 未满足（`[delta]` 存在且未全勾）
   → `delta-writing`，全勾 → `ready-to-merge`；纯代码提案（无 `[delta]`，`when: delta_required` 为假）
   整段跳过 merge。
3. **merge 子流程**（`when: delta_required`）：`generate-merge-prompt` 的
   `done_when: any_present:[MERGE_PROMPT_GENERATED, MERGE_PROMPT.md]` 满足而 `apply-merge` 的
   `done_when: any_present:[SPEC_MERGED, MERGED]` 未满足 → `merge-generated`。
4. **implement 子流程**：`code` 节点 `done_when: section_complete:code` 未满足 → `coding`，满足
   （或纯代码提案无 `[delta]` 时直接评估 `[code]`、旧格式无 section 兜底）→ `ready-to-verify`；
   `verify` 节点 `done_when: marker:VERIFY_PASS` 满足后进入 deliver。
5. **deliver 子流程**：经 `resolveProposalDeploymentDecision` 取提案级决策——
   决策冲突或 `deployment_required !== true` → `verify-passed`；需部署但无 deploy 任务、或
   `DEPLOY_DONE` 缺失、或 deploy 任务未全勾 → `ready-to-deploy`；满足后在 deploy 子块内按
   `fail_when: marker:SMOKE_FAIL` → `smoke-failed`、`done_when: marker:SMOKE_PASS` → `smoke-passed`、
   `smoke_required=false` → `deploy-done`、`smoke_required=true`（或未声明但存在 smoke 用例）→ `ready-to-smoke`。

### 消费方与约束

- `status` 的 `detectProposalStep` 调用点切换到 `detectProposalStepViaFlow`；旧
  `detectProposalStep` 保留导出，供测试期并跑对照。`active_change.proposal_step` 的 JSON 契约
  （`cli-json-output` 的 `proposal_step` 枚举）保持不变——这正是 1:1 目标。
- `next` 经 `collectStatusData` 消费同一 `proposal_step` 映射到 `action` / `detail`，间接受益但行为不变。
- **并跑断言仅存在于测试期**：在测试套件对同一 fixture 同时跑 `detectProposalStepViaFlow` 与旧
  `detectProposalStep` 并断言相等，覆盖全部 `ProposalStep` 态与边角，**不进入生产 CLI 路径**——
  生产路径直接用新派生，运行时绝不因断言导致 status/next 崩溃。

## 十四、watch 与 next --auto（skip-gate）架构

M1 切片 C 在已就绪的派生层（A `flow show` + B1 initial 派生 + B2 launched 派生）之上补两个新能力，让 M1 的「声明式可编排 + 实时观测 + 基础自动化」闭环。

### watch（实时观测，只读）
- `cli/src/commands/watch.ts` 轮询 `collectStatusData`（与 `status` 同一派生数据源），**启动先输出一次初始快照**，之后**仅在派生 `data` 深比较变化时**输出，每条含 `seq` / `timestamp`。
- 继承 `--module` 过滤；`--interval` 默认 2s；`--format json` 输出行分隔 JSON 流；Ctrl-C / SIGINT 优雅退出。
- **只读、A 架构一致**：不写文件、不推进状态、不接入 status / next 写副作用。watch 的 `status` 与 `openlogos status` 的 `data` 严格同构。

### next --auto（skip-gate，最小 A 方案）
- `cli/src/commands/next.ts` 新增 `--auto`；gate 查询助手在 `cli/src/lib/flow-derive.ts`，从内置 launched flow 取某停顿步（`proposal_step`）对应 subflow gate 的 `skippable`。
- **gate 范围（精确锁定）**：
  - **propose 出口 gate（`skippable:true`）→ `ready-to-merge`**：auto 下放行。
  - **deliver 入口 gate（`skippable:false`）→ `ready-to-deploy`**：auto 下仍卡住。
  - `smoke` **无对应 gate**，`ready-to-smoke` 不在范围；initial 的 WHY/WHAT 建议门本轮不接入（仅 schema 预留）。
- **A 架构一致**：引擎只派生"此 gate 可跳 + 当前 auto → 视为通过"，是否进入 auto 由宿主（`--auto`）决定。

### GATE_AUTO_PASSED 纯审计语义
- 文件 = 活跃提案目录下 JSONL 审计日志（`logos/changes/<slug>/GATE_AUTO_PASSED`）。
- 每次 auto 放行**总是追加一行** `{gate_id, proposal_step, timestamp}`（**不去重、不覆盖**）。
- **纯审计、不改变派生**：默认 `next`（无 `--auto`）与 `status` **忽略**该文件、输出 1:1 不变——绝不因其存在而让默认 `next` 自动越过 gate。
- **幂等**仅指对默认 `next`/`status` 的派生结论无影响、可安全重跑，并非审计去重。

### 边界与零漂移约束
- **默认 `next`（无 `--auto`）与 `status` 严格 1:1 不变**，由 `golden-baseline.test.ts` 锁定零漂移；`--auto` 与 `watch` 均为纯 opt-in 新能力。
- 本切片**不做**（M2）：overlay 驱动派生、loop 真迭代、`cmd:` 谓词。
- 切片 C 完成后，M1 的「派生层（A/B1/B2）+ 实时观测 + launched skip-gate」闭环；initial 建议门的 gate 化属已知后续项。

## 十五、overlay 驱动派生架构（flow-overlay-derive）

M2 切片 1a 把派生引擎 `cli/src/lib/flow-derive.ts` 的三个入口（initial / launched / gate）从
`loadBuiltinFlow(lifecycle)` 改为读 **resolved flow**：

```
resolved = applyOverlay(loadBuiltinFlow(lifecycle), readOverlay(root, lifecycle))
```

复用 `cli/src/lib/flow.ts` 中 `flow show --resolved` 已有的同一套合并件，**不新造合并器**。

**1. node→维度映射**：`NODE_TO_PHASE_KEY` 仍只覆盖 13 个内置节点；overlay `op:add` 节点无 phase key /
proposal_step，经 node 级视图（`overlay_nodes` / `current_node`，见 `spec/cli-json-output.md`）承载，
参与 current 选取与 next 建议。

**2. 校验分层（与 flow show 解耦）**：
- `applyOverlay`（结构层）保持宽松，仅新增**拦截 `op:modify` 覆盖 `id`**（`FLOW_SCHEMA_INVALID`）——
  故 `flow show --resolved` 仍可展示结构合法节点，**现有 S22 测试不受影响**。
- **派生入口**（语义层）校验：overlay-add 节点须有可求值 `done_when`/`produces` 组合；
  launched 上对 builtin 节点的 `skip`/`reorder` 视为非法——均抛 `FlowError(FLOW_SCHEMA_INVALID)`。

**3. launched 的 marker 驱动约束**：`detectProposalStepViaFlow` 由各节点 marker/section 按固定优先级判定 step、
**不消费 flow 顺序**；故 launched builtin `skip`/`reorder` 本切片不生效并 fail loud；`add`/`modify` 生效。
其中 `modify` 对**经 flow 读取的 marker 名**（verify/deploy/smoke 节点的 `markerName`）生效；
`section_complete:*` 的 tag（`delta`/`code`）由 `parseTaskSections` 固定读取，**本切片不承诺经 modify 覆盖**。
launched current 落 overlay-added 节点时 `proposal_step` = 前序最近 builtin step（无前序则 `writing`）。

**4. 命令层错误信封**：`status`/`next`/`watch` 捕获派生 `FlowError`，JSON 模式输出
`makeErrorEnvelope(command, e.code, e.message)`（用 `e.code` 不硬编码）到 stderr、非零退出；`watch` 不进入/停止轮询。

**5. 安全红线**：无 overlay 文件时 `resolved == builtin`，`NODE_TO_PHASE_KEY` 全命中、无新增节点、node 级字段全省略 →
派生与机器输出逐字节不变 → `golden-baseline.test.ts` 零漂移。

**边界**：本切片不含 `cmd:` 谓词、loop 真迭代（属 S26 及之后）。
