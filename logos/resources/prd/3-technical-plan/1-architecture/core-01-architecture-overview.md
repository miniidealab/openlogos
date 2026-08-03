# core-01-architecture-overview

## 一、架构总览
OpenLogos 由 CLI、规范源码、Skills、插件模板、静态文档站和示例项目组成。

## 二、系统组件
- `cli/`：核心命令、阶段判断逻辑、AI 工具资产同步逻辑和插件模板部署逻辑。
- `spec/`：方法论规范源码。
- `skills/`：OpenLogos 方法论 Skills 源码。
- `plugin/`、`plugin-codex/`、`plugin-opencode/`：宿主工具插件模板；其中 OpenLogos 官方插件只承载 OpenLogos 方法论技能。
- `website/`：文档站。
- `logos/resources/`：项目内真相源。
- 用户项目中的 `.agents/plugins/`、`.claude/skills/`、项目独立插件目录：项目 / 产品 / 仓库专属 Skill 的归属位置，不属于 OpenLogos 官方方法论命名空间。

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
- `scenarios`（可选 `feature` 归属字段，见「二十、feature 功能分组模型层」）
- `feature_counter`（可选，AI 维护，仿 `scenario_counter`）
- `features`（可选，feature 分组注册表）
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
| S26 | `cli/src/lib/flow-cmd.ts`（cmd 求值器）、`cli/src/lib/flow.ts`（cmd_timeout schema + FlowErrorCode）、`cli/src/lib/flow-overlay-derive.ts`（pending 态 + 校验）、`cli/src/commands/{next,status,watch}.ts` | `cli/test/s26-cmd-predicate.test.ts` |
| S27 | `cli/src/lib/flow.ts`（overlay `set-loop` + loop schema 校验）、`cli/src/lib/flow-loop-derive.ts`（读 `LOOP_ITERS` + resolved loop → `loop_state`）、`cli/src/lib/flow-overlay-derive.ts` / `flow-derive.ts`（未收敛不推进）、`cli/src/commands/verify.ts`（写 `LOOP_ITERS` 账本）、`cli/src/commands/{next,status,watch}.ts`、`cli/src/i18n.ts` | `cli/test/s27-loop-iterate.test.ts` |
| S28 | `cli/src/lib/flow-derive.ts`（新增 `PHASE_KEY_TO_NODE_ID` + `resolveNextNode`，复用 `flow-overlay-derive.ts` 导出的 `STEP_TO_CURRENT_BUILTIN`）、`cli/src/commands/next.ts`（输出 `next_node` + 文本展示）、`cli/src/i18n.ts` | `cli/test/s28-next-node.test.ts` |
| S29 | `cli/src/lib/flow.ts`（`set-loop` 的 `set` 白名单扩入 `exhausted_gate` + 子结构校验、node 解析 `coverage_threshold`）、`cli/src/lib/flow-loop-derive.ts`（`loop_state` 派生 `exhausted_skippable`）、`cli/src/lib/flow-derive.ts`（fan-out 覆盖 `coverage_threshold` 判 done）、`cli/src/commands/next.ts`（`--auto` 在 `escalated && exhausted_skippable` 放行退出 gate） | `cli/test/s29-gate-fanout-loop.test.ts` |
| S30 | `cli/src/lib/flow.ts`（overlay `modify` 的 `(节点,字段)` cmd: 精确白名单 + 决策 B 双 cmd: + 空命令 + F·loop 正交校验）、`cli/src/lib/flow-derive.ts`（`markerName` 容忍 cmd:、`extractLaunchedMarkers` per-field 标 cmd-gate、`detectProposalStepViaFlow` 改 cmd-aware）、`cli/src/lib/flow-overlay-derive.ts`（内部 `pending_cmd` 扩到 builtin gate、派生 JSON 字段 `cmd_gate`、budget=1 共享）、`cli/src/commands/next.ts`（builtin gate cmd 求值入 budget=1 + 回灌 detection + 瞬态 proposal_step + `next_node` R3）、`cli/src/commands/{status,watch}.ts`（输出 `cmd_gate`、停门前、observe 不执行）、`cli/src/lib/flow-cmd.ts`（S26 求值器复用，不改） | `cli/test/s30-cmd-builtin-gate.test.ts` |

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

## 八.A AI Skill 命名空间边界架构

OpenLogos 的 AI 资产同步由“官方方法论插件”和“项目专属技能”两条边界组成。

### Codex repo marketplace

Codex 新版推荐部署结构：

```text
<user-project>/
├── .agents/
│   ├── plugins/
│   │   ├── marketplace.json
│   │   ├── openlogos/
│   │   │   ├── .codex-plugin/plugin.json
│   │   │   ├── hooks/session-start.sh
│   │   │   └── skills/<openlogos-skill>/SKILL.md
│   │   └── <project-plugin>/
│   │       └── skills/<project-skill>/SKILL.md
│   └── skills/
│       └── <legacy-or-local-project-skill>/SKILL.md
├── .codex/
│   └── config.toml
└── AGENTS.md
```

规则：
1. `openlogos` 插件命名空间只由 OpenLogos CLI 维护，只包含 OpenLogos 方法论技能、OpenLogos SessionStart hook 和 OpenLogos 上下文注入逻辑。
2. 项目专属技能必须保留在项目插件命名空间或 repo-scoped local skill 目录；未知 skill 默认按项目资产处理。
3. `.agents/plugins/marketplace.json` 是 repo marketplace 入口，用于声明 `openlogos` 插件与项目插件并存；`sync` 可刷新 OpenLogos 条目，不删除或改写项目插件条目。
4. 历史 `.codex-plugin/` 继续作为兼容路径；迁移时只迁移 OpenLogos 自有资产，不吸收未知 `.agents/skills/*`。

### Claude Code 边界

Claude Code 中 OpenLogos 官方插件只承载 OpenLogos 方法论技能、guard 和 hook。项目专属技能推荐位于：

```text
<user-project>/
├── .claude/
│   └── skills/<project-skill>/SKILL.md
└── plugin/
    └── <project-plugin>/skills/<project-skill>/SKILL.md
```

规则：
1. OpenLogos 官方 Claude 插件不得把 `.claude/skills/*` 项目技能复制到 OpenLogos 插件 `plugin/skills`。
2. 项目插件若需要分发，应使用项目自己的命名空间，例如 `/adcn:release-guard`，不得使用 `/openlogos:*`。
3. `CLAUDE.md` managed block 负责说明边界，不负责重排项目技能目录。

### 实现映射补充

| 能力 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| Codex repo marketplace 生成与兼容迁移 | `cli/src/commands/init.ts`、`cli/src/commands/sync.ts`、`plugin-codex/`、`.codex-plugin/` | `cli/test/s01-init.test.ts`、`cli/test/s08-sync.test.ts` |
| OpenLogos / 项目 Skill 归属判定 | `cli/src/commands/init.ts`、`cli/src/commands/sync.ts` | `cli/test/s01-init.test.ts`、`cli/test/s08-sync.test.ts` |
| Claude Code 项目技能边界说明 | `cli/src/commands/init.ts`、`cli/src/commands/sync.ts`、`cli/src/commands/launch.ts`、`plugin/` | `cli/test/s01-init.test.ts`、`cli/test/s08-sync.test.ts`、`cli/test/s14-launch.test.ts` |
| 生成文档与官网同步 | `spec/agents-md.md`、`spec/codex-plugin.md`、`website/` | `cli/test/s01-init.test.ts`、`cli/test/s08-sync.test.ts`、发布 smoke |

### 不变量
- 无项目专属 skill 的项目，生成的 OpenLogos 方法论体验应保持兼容。
- 已有项目专属 skill 的项目，执行 `init --ai-tool`、`sync` 或 `launch` 后，项目 skill 的路径、命名空间和内容不得被 OpenLogos 托管逻辑重写。
- AI 工具运行时上下文必须能表达“OpenLogos 方法论规则”和“当前仓库规则”的区别；若两者同时存在，项目规则可补充具体工程约束，但不得删除或绕过 OpenLogos 变更管理门禁。

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

## 九.A verify 结果账本一致性架构

verify 结果汇总在 `cli/src/commands/verify.ts` 中增加一致性校验层，位于 JSONL 解析 / last-write-wins 归一化之后、Gate 判定与报告写入之前。

### 数据流

```mermaid
flowchart TB
    A["读取 test-results.jsonl"] --> B["解析 JSONL 行"]
    B --> C["按 id last-write-wins 归一化"]
    C --> D["校验 schema 与 defined test IDs"]
    D --> E["校验统计不变量"]
    E --> F["计算覆盖率 / 通过率 / AC trace"]
    F --> G["计算 verify Gate"]
```

### 一致性校验职责

1. `parseJsonl` 或其后置归一化逻辑必须区分“可用于统计的合法结果”和“需要诊断的非法结果”，不得把非法 `status` 结果作为已执行但既非 pass / fail / skip 的幽灵行放入 PASS 路径。
2. `collectVerifyData` 必须获得以下诊断输入：
   - `invalid_result_lines`：不可解析 JSON、缺少 `id` / `status`、非法 `status`、`fail` 缺少 `error`；
   - `unknown_result_ids`：结果 ID 不属于已定义自动化用例；
   - `manual_result_ids`：结果 ID 对应 `[manual]` 用例；
   - `count_mismatches`：`passed + failed + skipped != executed`、`executed > defined`、`pass_rate < 100` 但无失败 / 跳过解释等。
3. `VerifyData` JSON 输出应增加可选 `consistency` 字段：
   ```json
   {
     "ok": false,
     "reasons": ["invalid_test_result_status", "unknown_test_result_id"],
     "unknown_result_ids": ["UT-S13-GHOST"],
     "invalid_results": [{"line": 2, "id": "UT-S13-X", "reason": "invalid_status"}],
     "count_mismatches": ["passed_failed_skipped_ne_executed"]
   }
   ```
4. 当 `consistency.ok === false` 时，`gate.result` 必须为 `FAIL`，`gate.reason` 必须为 `result_ledger_inconsistent` 或更具体的首个一致性错误码。

### 实现映射补充

| 能力 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| verify JSONL schema 与结果账本一致性 | `cli/src/commands/verify.ts` | `cli/test/s13-verify.test.ts` |
| verify JSON consistency 字段稳定输出 | `cli/src/commands/verify.ts`、`cli/src/lib/json-output.ts` | `cli/test/s16-json-output.test.ts` |

### 兼容性

- 合法结果的 last-write-wins 行为保持不变。
- 没有非法行、没有未定义 ID、全部自动化用例通过的项目输出仍保持 PASS。
- 新增 `consistency` 字段是向后兼容字段；旧客户端可继续读取 `gate`，新客户端可用 `consistency` 展示更精确诊断。

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

## 十三点一、slice 子流程派生与 ready-to-implement 驻留态（split-slice-planner-stage）

把 `[code]` 切片划分从 plan 段（merge 前、`change-writer`）剥离为 spec-complete 之后的独立 `slice` 子流程（`spec/flow/launched.yaml` 节点 `plan-slices`，`skill: slice-planner`），并在 `detectProposalStepViaFlow` 的节点序列中于 **merge 子流程与 implement 子流程之间**插入前置门禁。

### spec-complete 统一信号

1. 含 `[delta]` 的提案：只有 `SPEC_MERGED` / `MERGED` 存在，才表示 delta 已合并进主规格。
2. 无 `[delta]` 的纯代码提案：不进入 `write-delta`，但必须通过 `openlogos merge <slug>` 执行 no-op merge 并写入 `SPEC_MERGED`，表示 no-delta spec-complete。
3. `SPEC_MERGED` 的新写入内容应为可解析审计对象，至少包含：

```json
{
  "type": "no_delta_spec_complete",
  "reason": "pure-code proposal has no spec delta",
  "completed_at": "..."
}
```

### 新增派生阻塞

- `spec-complete-required`：`code_required==true`，但提案未完成 spec-complete。该状态输出 `reason:"no_delta_spec_marker_missing"` 或等价诊断，`next_node` 不得指向 `plan-slices`。
- `test-id-required`：spec-complete 已完成，且 `code_required==true`，但相关真实 `UT-*` / `ST-*` / `SMOKE-*` ID 不可解析。该状态输出 `reason:"code_change_requires_real_test_ids"` 或等价诊断，`next_node` 不得指向 `plan-slices`。

### `ready-to-implement`

仅当 spec-complete 已完成、测试 ID 已稳定、`code_required==true` 且 `SLICES_APPROVED` 不存在时，才能派生 `ready-to-implement`。该驻留态内部仍按 `tasks_code_filled` 二分：

- `[code]` 未脱模板：前沿是 `plan-slices`，宿主派发 `slice-planner`。
- `[code]` 已脱模板：前沿是 `slice-exit` 门，宿主不得重派 `slice-planner`。

### driver 边界

RunLogos 等宿主不得自行用 `delta_required==false` 推断可以派发 `slice-planner`。宿主必须消费 OpenLogos `next/status` 的结构化前沿：只有 `next_node.id=="plan-slices"` 且无阻塞诊断时才派发 `slice-planner`。

## 十三点二、缺失 [code] section 的代码必需态兜底

S32 的 `slice` 子流程以 `when: code_required` 控制是否进入切片规划。该谓词不能只由 `tasks.md` 是否存在非空 `[code]` section 推导，否则会把“上游产物漏掉 `[code]` 标题”误判成“纯文档提案无需代码”，导致 merge 后直接进入 verify。

### `code_required` 的来源

`code_required` 是提案级语义谓词，来源包括：

- `tasks.md` 存在 `## [code]` section（空 section 也表示需要 merge 后规划切片）；
- `proposal.md` 声明代码级修复，或变更范围包含 CLI 派生、业务代码、测试代码、runner、reporter、面板展示等实现对象；
- delta 新增或修改实现相关 `UT-*` / `ST-*` / `SMOKE-*` 测试用例；
- delta 文字要求后续代码实现、测试 reporter 或 golden 更新。

### 缺失 `[code]` 的派生

当 `SPEC_MERGED` 在场且 `code_required==true` 时：

- `tasks.md` 缺失 `## [code]` section 是 `tasks-code-section-missing`，不是 `code_required=false`；
- 派生仍落 `ready-to-implement`，`next_node.id=="plan-slices"`；
- `slice-planner` 可以创建缺失的 `## [code]` section 并写入真实切片；
- `next --auto` 不得消费 `slice-exit`、不得写 `SLICES_APPROVED`、不得进入 `coding` / `verify`。

### implement loop 前置

S31 的 implement loop 只能在 `SLICES_APPROVED` 存在，或 `[code]` 切片确已规划并经 slice-exit 门确认后进入。缺失 `[code]` 的代码必需态不得输出会驱动宿主 `_loopRepair()` 或 canonical verify 的前沿。空 `[code]` 退化为 `tests_green` 仅适用于明确无需代码的纯文档提案。

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

## 十六、cmd: 谓词求值架构（flow-cmd-predicate）

M2 切片 1b 点亮 `cmd:<command>` 谓词（**仅 overlay-add 节点**），让节点完成判定由命令退出码决定。

**1. 求值器 `cli/src/lib/flow-cmd.ts`**：`spawn(cmd, { shell: true, cwd: 项目根, detached: POSIX })`；两级超时（节点级 > 项目级 `flow.cmd_timeout_seconds` > 60s，均须整数 ≥1）；
stdout/stderr 持续 drain、每路尾部 ≤64KiB 截断、不写父进程 stdout；返回 `{ exitCode, timedOut }`；仅 child_process `'error'` 事件抛错（→ `FLOW_CMD_SPAWN_FAILED`），命令不存在按 exit 127/9009 非 0 返回；超时尽力杀进程树（POSIX 进程组 / Windows `taskkill /T`）。暴露仅测试用 `opts.shell?`。

**2. 双模式派生**：
- **观察派生（status/watch）**：`cli/src/lib/flow-overlay-derive.ts` 对 `cmd:` overlay-add 节点**不执行**、态 = `pending`（`OverlayNodeState` 枚举追加 `pending`），阻断后续推进。
- **求值派生（next）**：`cli/src/commands/next.ts` 对当前 cmd 节点执行一次（先 `fail_when:cmd` 后 `done_when:cmd`）；exit 0 瞬态续推、不落盘；**cmd budget = 1**（续推后遇下一个 cmd 节点停为 current/pending）。

**3. 校验**（`flow-overlay-derive.ts` 派生入口）：`cmd:` 仅 overlay-add（builtin modify-cmd → `FLOW_SCHEMA_INVALID`）；禁同节点双 cmd；`cmd_timeout_seconds` < 1 → `FLOW_SCHEMA_INVALID`。`FlowErrorCode` 扩展 `FLOW_CMD_SPAWN_FAILED`。

**4. 结果字段**：next success envelope 带 `cmd_node_id` / `cmd_predicate_field` / `cmd_exit_code` / `cmd_timed_out` / `cmd_satisfied`（仅本次执行 cmd 时出现）。

**5. 安全红线**：内置模板零 `cmd:`、无 cmd 节点的项目派生与机器输出逐字节不变 → `golden-baseline.test.ts` 零漂移。

**边界**：不含 loop 真迭代、测试绿收敛、modify-cmd-on-builtin（属 M2 后续）。

## 十七、loop 真迭代派生架构（flow-loop-iterate）

M2 切片 2 把 implement（code/verify）子流程的 `loop { until: tests_green, max_iters }` 从 M1 的退化环（仅解析、不驱动）点亮为**真迭代派生**。严格 **A 被动派生**：OpenLogos 只派生「第几轮 / 是否收敛 / 是否升级 gate」，**不自驱动跑测试**——迭代由 working_agent 修复后重跑 `openlogos verify` 推进，CLI 只读账本派生措辞与进度。

### 激活条件（仅 overlay，守 golden 零漂移）

- builtin `initial.yaml` / `launched.yaml` 的 implement subflow 保持 `loop: { until: tests_green, max_iters: 1 }`（**模板零变更**）。
- 仅当 resolved 的 implement subflow `max_iters > 1`（经 overlay `set-loop` 改写）才进入真迭代派生：verify 写账本 + status/next/watch 派生 `loop_state`。未激活时所有派生与机器输出逐字节不变。
- **initial 多模块不支持（不激活）**：verify 是项目级单次测试运行，无法把一次 run 归属到某模块的 loop——故 initial 多模块即便 overlay 写了 `max_iters>1` 也**不激活**（不写账本、不输出 `loop_state`、派生退化为旧行为）。
- initial 单模块 / launched（单提案）两条 implement 走**同一套 loop 派生引擎**，仅在激活处生效。

### overlay `set-loop`（subflow 级能力）

- `cli/src/lib/flow.ts` 的 `applyOverlay` 新增 op **`set-loop`**：按 `subflow:<id>` 定位子流程、把 `set` 合并到该 subflow 的 `loop`（节点级 skip/add/modify/reorder 不变）。

  ```yaml
  - op: set-loop
    subflow: implement
    set: { max_iters: 3 }      # until 缺省沿用 builtin 的 tests_green
  ```

- **`set` 字段白名单**：`set` 仅允许 `max_iters` / `until`；`max_iters` 须整数 ≥1、`until` 仅枚举 `tests_green`；出现任何未知 key（如 `exhausted_gate`）→ `FLOW_SCHEMA_INVALID`（**不静默保留、不进 resolved flow**）。非法 subflow / 缺 `set` 亦 → `FLOW_SCHEMA_INVALID`。

### `LOOP_ITERS` 迭代账本（verify 写、单向追加）

迭代计数来源 = `openlogos verify` 追加 `LOOP_ITERS`（append-only JSONL，与 `GATE_AUTO_PASSED` 同理念），由 **CLI 主进程在 workspace 追加**，**不交给 pre-run 命令写**（否则需处理 sandbox allowed-write 白名单）。

- **写入时机/责任**：仅 loop 激活时，在 verify **算出 gate 结果（PASS/FAIL）之后**——紧接 `collectVerifyData` + sandbox 降级、取最终 `data.gate.result`——的**一段不依赖 guard 的共享路径**写，**而非**只在 launched 的 marker（guard）块里。launched 额外写 marker（`VERIFY_PASS`/`VERIFY_FAIL`）+ 写账本；**initial 不进 guard 块、只写 `LOOP_ITERS`**。
- **行结构**：`{ iter, node: "verify", result: "pass" | "fail", module, timestamp }`。`result` 取 verify 是否测试绿（PASS=pass / FAIL=fail），与 verify 节点 `done_when: marker:VERIFY_PASS` / `fail_when: marker:VERIFY_FAIL`（launched）一致。
- **`iter` 计算**：追加前 `iter = 同 module 已有行数 + 1`（**按 module 过滤后计数**，与读取侧 `iteration` 对齐），**不取整文件总行数**（initial 账本含多 module 行时整文件行数会串号）。
- **配置类早退不写**：`NO_TEST_RESULTS` / `NO_TEST_CASES` / `PROJECT_NOT_INITIALIZED` 等早退（`process.exit(1)`）**不计为一次迭代**、不写账本——它们是环境/配置错误，不是一次"测试未绿"的轮次。
- **路径与隔离**：launched 写 `logos/changes/<slug>/LOOP_ITERS`（提案级 episode）；initial 写 `logos/resources/verify/LOOP_ITERS`（项目级，行带 `module` 字段，派生按当前 module 过滤）。**launch 后** initial 账本仅作历史产物，launched 派生**只读提案目录账本**，绝不读 initial 账本。
- **写入侧 module 来源**：launched = `guard.module`（活跃提案归属模块）；initial 单模块 = 该唯一模块；initial 多模块 = 无法归属 → 不写账本（loop 视为未激活）。

### loop 派生引擎（`flow-loop-derive.ts`）

新增/扩展 `cli/src/lib/flow-loop-derive.ts`（或并入 `flow-overlay-derive.ts`）：读 `LOOP_ITERS` 账本（**按当前 module 过滤**）+ resolved implement loop，产 `loop_state`，**仅 `max_iters>1` 激活时产出，否则返回 null**（golden 零漂移）。

派生语义（A 被动派生）：

- `iteration` = `LOOP_ITERS`（按当前 module 过滤后）行数（已完成的 verify 轮次）。
- `converged` = 最后一行 `result == "pass"`（tests_green）。
- `escalated` = `iteration >= max_iters && !converged`。

### 出环条件 = `converged`，覆盖内节点 `done_when`（R2/R8）

loop 激活时，implement subflow 的出环（done）以 `loop_state.converged` 为准，**覆盖其内节点（含 verify）各自的 `done_when`**。关键修正：initial 的 verify 节点 `done_when: file:logos/resources/verify/acceptance-report.md`，而 `openlogos verify` 无论 PASS/FAIL 都会写该报告——若不覆盖，initial 首次 FAIL 会被误判为 done、错误推进到 deploy/launch。

「未收敛不得推进」必须落到**每条**会判定 verify/implement 完成的派生入口，否则 `current_phase` / `proposal_step` 仍按旧 `done_when` 前进：

- `flow-overlay-derive.ts` 的 node 级走查（`current_node`）；
- `deriveModulePhaseProgressViaFlow`（`flow-derive.ts`）：initial per-module verify phase（原判 = 报告文件存在 → 改由 `converged` 把关）；
- 顶层 phases 扫描（`status.ts` `phase.done = listFiles(...)` 扫 `acceptance-report.md`）；
- `detectProposalStepViaFlow`（launched）：marker 已 FAIL-safe → **只保持既有 step 枚举、不在此函数引入文案职责**（loop 未收敛/escalated 的文案放在 next/status 消费 `loop_state` 的层）。

统一原则：loop 激活且 `!converged` 时，verify/implement 视为**未完成**，上述各路径一律不推进到 deliver/deploy/launch。

### 达上限升级 = loop 退出 human gate（本切片不可 overlay 覆盖）

`escalated` 时派生为 implement subflow 的退出 gate（human），`skippable` 本切片固定 `false`，`gate_id = gate:<subflow_id>:loop-exhausted`（如 `gate:implement:loop-exhausted`）。next `--auto` 在 escalated 时输出 `gate_id` + `skippable:false`、照常阻塞、**不 auto-pass、不写 `GATE_AUTO_PASSED`**（与现有 deploy gate `skippable:false` 在 auto 下行为一致）。

「继续迭代」= 人类把 `max_iters` 调大（overlay `set-loop`）→ `iteration >= max_iters` 不再成立 → `escalated` 自动解除；或直接修到测试绿（`converged`）出环。**gate 本身不重置计数**。`loop-exhausted` **不是新的 `proposal_step` 枚举值**——`proposal_step` 保持现有 13 值集合不变，「是否达上限」只由 `loop_state.escalated` + `next --auto` 的 `gate_id`/`skippable` 表达（复用既有字段，非新字段）。

### `loop_state` JSON 契约与挂载位置

仅激活时输出，否则省略（golden 零漂移）：

```json
"loop_state": {
  "subflow_id": "implement",
  "until": "tests_green",
  "max_iters": 3,
  "iteration": 2,
  "converged": false,
  "escalated": false
}
```

挂载与 `overlay_nodes` / `current_node` 同构：有 `modules[]` 的项目挂 `modules[].loop_state`（按模块）；legacy 无 `modules[]` 才回退顶层 `loop_state`；`next` 同步挂 `next.modules[].loop_state`、顶层仅 legacy fallback；`watch.data`（与 status 同构）继承同样规则。next 措辞：未收敛 & `iteration < max_iters` → 「第 N/M 轮未绿 → 修复后重跑 `openlogos verify`（继续迭代）」；`escalated` → 「已达迭代上限仍未绿 → 升级人类确认点」；收敛 → 出环续推。

### Episode 边界与状态回退

一个提案的 implement loop = 一个 episode，账本随提案目录走、`archive` 时随提案归档/清理；initial loop = 项目级 episode（账本按 module 过滤），launch 后仅历史产物。收敛后再改再 verify 时复用现有 verify 行为：再次 FAIL 会清除 `VERIFY_PASS` 及下游 `DEPLOY_DONE` / `SMOKE_PASS` / `SMOKE_FAIL` marker → verify 节点回到"未 done" → `converged` 转 false → implement loop 重新打开；账本续写，`iteration` 继续增长、`converged` 反映最后一次结果。该回退对 launched 与 initial 一致（initial 由 `converged` 出环规则保证不被 report 文件误判为已完成）。

### 安全红线（零漂移）

无 loop 激活的项目（含**所有** golden fixture）：verify 不写账本、`loop_state` 省略、出环判定回退到既有 `done_when` → status / next / watch 输出逐字节不变 → `golden-baseline.test.ts` 零漂移。

**边界**：本切片不做 `exhausted_gate.skippable` 的 overlay 覆盖、不做"无人值守放行非收敛代码进入交付"（auto bypass 非收敛，语义危险，留独立切片）；initial 多模块 loop 为已知不支持项（读取侧 module 过滤仍保留作防御）。

## 十八、next_node 编排提示派生架构（flow-next-node）

S28 让 `openlogos next` 输出 **`next_node`**——把「本次 `next` 响应**最终建议处理的真实 flow node**」的编排提示（`skill` / `working_agent` / `review_agent` / `pre_script` / `post_script`）以**机器可读字段**透出，让宿主据此照「乐谱」编排（派哪个 skill/agent、是否跑脚本），不再回去读 `CLAUDE.md` 的 Phase→skill 散文映射。严格 **A 被动派生**：OpenLogos 只**声明**节点的 hints，**不映射 agent、不执行 script**——如何映射真实 agent、是否执行 script 由宿主权限模式决定（与 §十一信任边界一致）。本切片**有意**为 `next` 新增输出字段，故 `golden-baseline.test.ts` 的 `next --json` 快照需**重新 baseline**（`status`/`watch`/`flow show` 快照不变）。

### 字段定义（全套编排提示）

`next_node` = 取自 **resolved flow（含 overlay）** 的目标节点的 hints：

```json
"next_node": {
  "id": "code",
  "name": "代码实现",
  "subflow_id": "implement",
  "skill": "code-implementor",
  "working_agent": null,
  "review_agent": null,
  "pre_script": null,
  "post_script": null
}
```

- `id` / `name` / `subflow_id` 为 `string`；`skill` / `working_agent` / `review_agent` / `pre_script` / `post_script` 为 **`string | null`**（这 5 个字段固定存在、用 `null` 表示无绑定，如 verify/deploy/smoke 的 `skill` 为 `null`）。消费方**不得**把 `skill` 当作必有 `string`。
- 五个编排字段均为**不透明标签**：OpenLogos 不解释、不校验、不驱动；overlay `modify code set:{review_agent: my-reviewer}` 会**如实反映**为 `next_node.review_agent = "my-reviewer"`（overlay 重绑 agent 是关键价值）。
- builtin 模板里 `working_agent` / `review_agent` / `pre_script` / `post_script` 多为 `null`（留用户 overlay 填），`skill` 多已填（prd→prd-writer、code→code-implementor…；verify/deploy/smoke 由 CLI 驱动、`skill` 为 null）。

### 派生引擎：`resolveNextNode`（默认前沿节点 → resolved flow 取 hints）

`resolveNextNode(...)` 解析「最终建议处理节点」，再从 **resolved flow** 按 id 取该节点的 `{id,name,subflow_id,skill,working_agent,review_agent,pre_script,post_script}`。**默认 = 当前前沿节点**，三路解析（A 被动，复用既有映射）：

1. **overlay-added 当前节点**：`current_node` 存在 → 直接取该节点；
2. **launched builtin**：`STEP_TO_CURRENT_BUILTIN[proposal_step]` → builtin 节点 id；
3. **initial builtin**：`current_phase` → builtin 节点 id——经**显式新增的 `PHASE_KEY_TO_NODE_ID` map/helper**（`flow-derive.ts`）映射。**【R6】严禁拿正向表 `NODE_TO_PHASE_KEY` 反查**（避免实现误用），phase key → node id 是单独维护的显式表。

**单一来源约束**：`STEP_TO_CURRENT_BUILTIN` 当前是 `flow-overlay-derive.ts` 的私有常量；`resolveNextNode` 须**复用这唯一一份**（将其 export 后复用），**禁止复制第二份 step→node mapping** 以防漂移。

**挂载位置**（与 `current_node` / `loop_state` 同构）：有 `modules[]` → `modules[].next_node`；legacy 无 `modules[]` → 顶层 `next_node`。无目标节点（见下省略规则）则整体省略 `next_node`。

### 默认前沿的例外（R3 / R4 / R5 / R7）

`next_node` **仅当当前建议指向一个真实 flow 节点时输出**；以下例外覆盖或省略默认前沿：

- **【R3】cmd 瞬态求值续推**：`next.ts` 先 `cmdEval` 当前 pending cmd 再 `collectStatusData(cmdEval)` 续推（flow-spec §12 cmd 双模式「exit 0 本次响应内视为 done 并续推」）。故 `next_node` 取 **cmdEval 回灌后的最终建议处理节点**：
  - cmd done（exit 0）续推 → 指向续推后落到的节点（**不**指向刚求值已 done 的 cmd 节点）；
  - cmd 失败 / 超时 → 节点未完成，指向该 cmd 节点（需重跑）；
  - budget=1 遇第二个 cmd → 指向第二个 pending cmd 节点。
- **【R4】`--auto` gate 自动放行**：`gate_auto_passed === true` → **省略 `next_node`**——避免「机器字段仍指放行前节点、action 却已 proceed」的不一致；放行落地后宿主重新 `next` 派生下一节点。非放行的 `--auto`（gate 不可跳、仍阻塞）与无 `--auto` 时按前沿正常输出。
- **【R7】loop 阻塞**：S27 loop 未收敛时前沿钉在 verify，但 next 的 action 实为「让 working_agent 修复后重跑 verify」（修代码，非跑 verify）。故：
  - **阻塞、未达上限（继续迭代）**：`next_node` = **loop subflow 的工作节点 code**（含 overlay 重绑的 skill/working_agent）；`verify` 是 CLI 驱动度量节点（skill 为 null）不作 next_node。工作节点取法：① 若有 overlay-added `current_node` 仍**优先**（按默认解析，不被本条覆盖）；② 否则取 resolved flow 中 **`id == "code"` 且未 `skipped`** 的节点（不依赖「第一个」，兼容 overlay `reorder`）；③ 若 `code` 缺失 / 被 overlay `skip` → **省略 `next_node`**（loop 仍有效，宿主读 `loop_state`）。该省略分支**仅适用于合法 resolved flow（如 initial）**——launched 对 builtin `code` 的 `skip`/`reorder` 在 **S25 派生入口已 `FLOW_SCHEMA_INVALID`（fail loud）**，根本走不到此省略逻辑。
  - **达上限（`escalated` → `gate:implement:loop-exhausted` human gate）**：**省略 `next_node`**（同 R4，人类确认点、无可派发节点；宿主读 `loop_state.escalated`）。
  - 非阻塞（`iteration=0` / 已收敛 / 无 loop）：按前沿正常输出（如 `verify`）。`next_node` 与 `loop_state` 并存互补——`loop_state` 给环状态，`next_node` 给「这一轮该派发哪个节点的 skill/agent」。
- **【R5】命令级建议一律省略**（非某 flow node，`resolveNextNode` 返回 null）：`all_done`（流程走完）、launched 无 active proposal（建议 `openlogos change <slug>`）、adopted 补 baseline 文档（建议 `openlogos change add-baseline-docs`）、`openlogos launch` 等其它命令级提示、`--auto` gate 已放行（R4）。

### 范围边界与零漂移约束

- 本切片仅 `next` 暴露 `next_node`；`status` / `watch` **不动**（守其 golden，留后续切片决定是否镜像）。
- golden：`next` 对有当前节点的项目新增 `next_node`（builtin 节点恒有 skill 等），故**有意**重新 baseline `golden-baseline.test.ts`；**强约束**：必须在**干净基线**上重新 baseline 并**逐项复核 snapshot diff**，确认**唯一漂移就是新增 `next_node`**、无其它字段漂移（防止借 re-baseline 掩盖意外回归）。

## 十八点一、S31 切片子任务 checkbox 派生架构

S31 的切片派生需要从“逐行 checkbox 计数”升级为“顶层切片 + 缩进子任务”的两层模型，仍保持 A 被动派生：OpenLogos 只读取 `tasks.md`、派生机器状态，不代勾 checkbox，不运行测试，不解释宿主执行结果。

### 解析规则

- 只解析活跃提案 `tasks.md` 的 `## [code]` section。
- 顶层 checkbox 行表示父切片。顶层识别以 Markdown 列表缩进层级为准，`- [ ]` / `- [x]` 等价支持。
- 父切片下的缩进 checkbox 行表示该父切片的子任务。子任务归属最近的上一个顶层父切片。
- 缩进普通 bullet 仍是说明文字，不计入完成判定。
- 缩进 checkbox 不得增加 `slice_state.total`，不得作为 `slice_state.current` 的候选切片。

### 完成规则

```text
parent_slice_done =
  parent_checkbox_checked
  ∧ every(child_checkbox.checked == true)

code_slices_green =
  every(parent_slice_done)
  ∧ tests_green
```

空 `[code]` 或顶层切片数为 0 时，继续退化为 `tests_green`。父切片已勾但子任务未全勾时，父切片仍未完成；`slice_state.done` 不增加，`slice_state.current` 仍指向该父切片。

### 机器字段

`deriveSliceState` 在既有 `{total, done, current, remaining}` 基础上增加可选字段：

- `current_children: Array<{ text: string; checked: boolean }>`：当前父切片下所有缩进 checkbox 子任务。
- `current_unchecked_children: string[]`：当前父切片下未勾选子任务文本。

`next.ts` 在 loop 阻塞且 `next_node.id == "code"` 时，除既有 `next_node.slice = slice_state.current` 外，若存在 `slice_state.current_children`，同步挂载：

```json
{
  "next_node": {
    "id": "code",
    "slice": "切片1：...",
    "slice_children": [
      {"text": "扩展 AgentAdapter 状态入口。", "checked": false}
    ]
  }
}
```

### 兼容性约束

- 无子任务 checkbox 的既有 S31 fixture、golden 与用户项目语义保持不变。
- initial 多模块仍不激活切片循环，不输出 `slice_state`。
- `LOOP_ITERS.slice` 仍记录父切片标题，不记录子任务列表。
- `section_complete:code` 在 `code_slices_green` 语境下采用父切片完成规则；其它 section 的完成语义不受影响。

## 十九、M2 预留收尾派生架构（gate 可跳 / fan-out 阈值 / loop 整组收敛）

S29 一次收掉 `spec/flow-spec.md §13` 边界表 M2 列里**三个轻量预留项**，**复用既有 flow 派生引擎**、不新造组件：A·loop 达上限退出 gate 的 `skippable` 可经 overlay 覆盖（含 `--auto` 放行非收敛代码）；B·fan-out 聚合阈值 `coverage_threshold`；C·loop 内 fan-out 收敛语义定死为「整组收敛」。三项**全部 overlay/字段 opt-in，builtin 模板零变更 → `golden-baseline.test.ts` 零漂移**。严格 **A 被动派生**：OpenLogos 只**声明** gate/字段语义，是否放行、是否执行由 `--auto` + 用户 overlay 显式声明驱动，CLI 不自行决策。规格契约见 `spec/flow-spec.md`（§6/§7/§9/§10.4/§12.2/§13）与 `spec/cli-json-output.md`（§3.9/§9/§11.1）。

### A·loop 退出 gate `skippable` 可覆盖（含 auto 放行非收敛代码）

S27 把 loop 达上限的退出 human gate（`gate:<subflow>:loop-exhausted`）的 `skippable` 固定为 `false`。S29 让它可经 overlay 覆盖，**沿用 S27 的 `set-loop` + `loop_state` + `GATE_AUTO_PASSED` 既有路径**，不新增 marker、不新增 `proposal_step` 枚举值：

- **`set-loop` 白名单扩容**（`cli/src/lib/flow.ts`）：`applyOverlay` 的 `set-loop` 的 `set` 白名单由 `max_iters` / `until` 扩入 **`exhausted_gate`**。`exhausted_gate` **仅允许 `{ skippable: boolean }`**——`skippable` 非布尔、或出现其它 key、或 `exhausted_gate` 出现其它未知兄弟 key → `FLOW_SCHEMA_INVALID`（不静默保留、不进 resolved flow）。resolved loop 据此带出 `exhausted_gate`。
- **`loop_state` 派生新增 `exhausted_skippable`**（`cli/src/lib/flow-loop-derive.ts`）：取 resolved implement loop 的 `exhausted_gate.skippable`。**仅当 resolved loop 含 `exhausted_gate` 时才把该键加入 `loop_state`；不写则省略**（消费方按 `false` 处理）——这样既有 S27 激活-loop（仅 `max_iters>1`、无 `exhausted_gate`）的 `loop_state` JSON **不新增字段**（真零漂移）；builtin/未激活 loop 整个 `loop_state` 省略。挂载位置与 S27 `loop_state` 同构。
- **`next --auto` 放行逻辑**（`cli/src/commands/next.ts`）：仅当 **`escalated === true` 且 `exhausted_skippable === true`** 时放行 loop-exhausted gate——输出 `skippable: true`、`gate_auto_passed: true`、向 `GATE_AUTO_PASSED` 账本**追加审计行**、追加文案标记 `GATE_AUTO_PASSED`、action 转 **proceed**（放行未收敛代码进入后续 subflow，无人值守）。**复用既有 `GATE_AUTO_PASSED` 写入路径与 gate 字段助手**（与 S24 deploy gate / S27 退出 gate 同一套字段输出），不新造放行通道。`exhausted_skippable !== true`（默认）时仍固定 `skippable: false`、照常阻塞、不 auto-pass、不写账本（**S27 行为不变**）。
- **安全红线**：`skippable: true` 是高危 opt-in（自动放行未通过测试的代码），须用户在 overlay 显式写 `exhausted_gate.skippable: true`；默认关闭。A 角色边界严守——OpenLogos 只声明 gate 是否可跳，是否进入 `--auto`、是否真放行由宿主与用户 overlay 显式驱动，引擎不自行决策。

### B·fan-out 聚合阈值（`coverage_threshold`）

让 fan-out 节点可在 ≤100% 覆盖时即判 done，**复用既有 fan-out 覆盖度派生**（`{ total, covered, missing }` 计算），不改覆盖度对象结构：

- **node schema 解析**（`cli/src/lib/flow.ts`）：node 新增可选字段 **`coverage_threshold`**（float，`0 < x <= 1`）；非法值或类型 → `FLOW_SCHEMA_INVALID`。**仅对 `done_when: all_present` 的 fan-out 节点合法**；设在非 `all_present`（或无 `for_each`/非 fan-out）节点 → `FLOW_SCHEMA_INVALID`（fail loud，不静默忽略）。
- **覆盖判定**（fan-out 覆盖派生处——`cli/src/lib/flow-derive.ts` 或现有 `all_present` 覆盖计算）：判 done 规则由「全覆盖」放宽为 **`covered / total >= coverage_threshold`**。**缺省（不写）= 等价 `all_present`**（阈值 `1.0`、要求 100% 覆盖）；**`total == 0` 维持现状**（`all_present` 现状：0 场景视为未 done，不被阈值短路为 done）。
- **机器输出**：覆盖度对象 `{ total, covered, missing }` 不变；阈值仅作为声明出现在 **`flow show` 节点字段** `coverage_threshold`（仅设置时，见 `spec/cli-json-output.md §9`）；`status`/`watch`/`next` **不新增字段**，仅其 `done` 按阈值判定。
- **零漂移**：builtin 模板不写 `coverage_threshold` → 判定与 `all_present` 1:1，机器输出无新增字段 → golden 零漂移。

### C·loop 内 fan-out 收敛语义（定死=整组收敛，无新增代码字段）

把 loop（implement 子流程）内含 fan-out 节点时的「每实例 vs 整组」收敛语义**定死为「整组收敛」**，关闭该预留项。**本子能力无新增代码字段、无 schema 改动**——仅在架构文档与测试里把语义钉死：

- **收敛裁判仍是 loop 的测试绿**（`flow-loop-derive.ts` 的 `converged`，即 S27 `until: tests_green`）：loop 是否出环只看最后一轮 verify 是否绿，**不为单实例各自计 `iteration`、不新增 per-instance 字段、不留悬空 schema**。
- **fan-out 节点 done** 仍走各自的 `all_present` / `coverage_threshold`（B）独立判定。
- 现状 builtin loop 仅 `implement`（code/verify，无 fan-out）；fan-out-in-loop 只可能由用户 overlay 把 fan-out 节点加进 implement——此时同样整组收敛。语义写进 `spec/flow-spec.md §6`，并由 S29 测试断言「整组收敛、不做 per-instance」锁定。
- 无新增字段、无 builtin 变更 → golden 零漂移。

### 范围边界与零漂移约束

- 三项均**复用既有引擎**（`set-loop` / `loop_state` / `GATE_AUTO_PASSED` / fan-out 覆盖派生），不引入新组件、新 marker、新 `proposal_step` 枚举值。
- 三项全部 overlay/字段 opt-in，builtin `initial.yaml` / `launched.yaml` 不写 `exhausted_gate` / `coverage_threshold`，loop 仍 `max_iters: 1` 退化环 → 无 loop 激活、无新增字段 → status / next / watch / flow show 输出逐字节不变 → `golden-baseline.test.ts` **零漂移**。
- **A 被动派生不变**：A 项尤其严守——OpenLogos 只声明退出 gate 的 `skippable`，是否放行/执行由 `--auto` + 用户 overlay 显式声明驱动，引擎不自行越过 gate。
- 本切片**不做**：`modify-cmd-on-builtin`（§13 M2 列剩余的唯一重项，单独成切片）。

## 二十、modify-cmd-on-builtin 派生架构（cmd: 放开到 verify/deploy/smoke gate）

S30 收掉 `spec/flow-spec.md §13` 边界表 M2 列**最后一项** `modify-cmd-on-builtin`：把 S26 点亮的 `cmd:<command>` 谓词从「仅 overlay-add 节点」放开到 **overlay-`modify` 的 launched `verify`/`deploy`/`smoke` 三个 gate**，使这些门禁可接外部命令/CI（如 `gh pr checks`、自定义部署校验脚本）。**复用既有 flow 派生引擎与 S26 cmd 求值器**、不新造组件。语义采用 **per-field 独立求值**（cmd 字段 live 重评瞬态、非 cmd 字段照常，`fail_when` 优先 `done_when` 不变）+ **不写 marker**。严格 **A 被动派生**：`next` 对 cmd 字段求值**不写状态 marker**，cmd 字段每次重评、瞬态。**cmd-gate 仅经 overlay `modify` opt-in 激活；builtin 三模板仍 `marker:` → `golden-baseline.test.ts` 零漂移**。规格契约见 `spec/flow-spec.md`（§9.2 放开范围、§10.3 modify per-field 边界、§12 launched 检测 cmd-aware + loop 正交、§13 关闭最后一项）与 `spec/cli-json-output.md`（§3.8 cmd 结果字段复用、新增 `cmd_gate`、`next_node` R3），此处不重复全文。

### A·overlay `modify` 校验：`(节点,字段)` 精确白名单（`cli/src/lib/flow.ts`）

`applyOverlay` 的 `op:modify` 把 `done_when`/`fail_when` 改为 `cmd:` 时，按 **精确 `(节点, 字段)` 白名单**校验，越界即 `FLOW_SCHEMA_INVALID`（fail loud、不进 resolved flow）：

- **合法**：`verify.done_when` ✅ / `verify.fail_when` ✅ / `smoke.done_when` ✅ / `smoke.fail_when` ✅ / `deploy.done_when` ✅。
- **非法**：`deploy.fail_when:cmd` ❌（deploy builtin **无 `fail_when`**，见 `spec/flow/launched.yaml`；本切片不为 deploy 引入 `fail_when:cmd`）；其它任意 builtin 节点（initial 全部 + launched 的 `write-proposal`/`write-delta`/`generate-merge-prompt`/`apply-merge`/`code`/`archive`）的任意字段改 cmd: → `FLOW_SCHEMA_INVALID`（它们承载 OpenLogos 内部状态 proposal_package/section/marker，cmd: 无意义）。
- **决策 B（沿用 S26）**：同一节点 `done_when` 与 `fail_when` **不得均为 cmd:**（→ `FLOW_SCHEMA_INVALID`，仅 verify/smoke 适用）；混合（一 cmd 一 marker）按字段独立求值。
- **空命令** `cmd:`（命令体为空）→ `FLOW_SCHEMA_INVALID`。
- **F·loop 正交（fail loud 隔离）**：`implement` 子流程经 `set-loop` 激活 loop（`max_iters>1`）且 `verify` 的 `done_when` 或 `fail_when` **任一**为 cmd: → `FLOW_SCHEMA_INVALID`（两者同在 overlay、resolved 校验时静态可检）。**严格版**：不区分 done/fail 字段，verify 任一字段带 cmd 即与激活 loop 互斥（loop 出环靠 `LOOP_ITERS` 末轮 pass 账本、由 `openlogos verify` 写；cmd-gate 的 `next` 不写账本 → 激活 loop 时 cmd exit 0 也无法出环，故隔离）。`deploy`/`smoke` 在 `deliver` 子流程、无 loop → 无此冲突。本切片**不触碰 loop 收敛逻辑**。

### B·检测 cmd-aware（核心改造，`cli/src/lib/flow-derive.ts`）

把 launched proposal_step 状态机改为 cmd-aware，使其在 verify/deploy/smoke gate 接 cmd: 时不再因取不到 marker 名而崩，同时保持 marker: 路径 1:1 不变：

- **`markerName` 容忍 cmd:**：verify/deploy/smoke 的 `done_when`/`fail_when` 若为 cmd:，`markerName` **不再抛错**——不抽 marker 名，返回 cmd 描述符（标记为 cmd gate）。
- **`extractLaunchedMarkers` per-field 标 cmd-gate**：为 verify/deploy/smoke **逐字段**判定——cmd 字段标记为「cmd gate」（per-field），marker 字段照常抽 marker 名。
- **`detectProposalStepViaFlow` 改 cmd-aware（新增可选 cmd-eval 入参）**：
  - **非 cmd 字段照常**：marker: 等谓词仍按原规则求值，`fail_when` 优先 `done_when` 不变（如 `fail_when:marker:VERIFY_FAIL` 命中 → `verify-failed`）——status/watch/next 一致、与今天逐字节相同。
  - **无 cmd-eval 入参（`status`/`watch`）**：**仅对未被非 cmd 字段解析的前沿 cmd gate** 视为 unknown → 判 `pending`、proposal_step 停在门前（`verify`→`ready-to-verify`、`deploy`→`ready-to-deploy`、`smoke`→`ready-to-smoke`）；**非 cmd 字段已把节点解析为 done/failed 的，照常 done/failed、不停门前、不输出 pending**（frontier 模型，与 §12 cmd 观察语义一致——不为已解析节点跑命令）。
  - **有 cmd-eval 入参（`next`）**：仅对**前沿**节点按 cmd exit code 判 done/failed/未过（已 done/failed 的非前沿节点不求值其 cmd 字段）；前沿节点按 fail>done：`fail_when:cmd` 先（exit 0 → failed），未命中再 `done_when:cmd`（exit 0 → done）。
  - **marker: 路径 1:1 不变**：对纯 marker: 的 builtin（无 overlay 项目）detection 逐字节不变 → golden 锁定。
- **cmd 执行语义整体复用 S26**（`cli/src/lib/flow-cmd.ts`，本切片不改）：`spawn(shell)`、两级超时（节点 `cmd_timeout_seconds` > 项目 `flow.cmd_timeout_seconds` > 60s）、64KiB drain、`exit 0`=谓词命中（按字段：`done_when` 命中为 done、`fail_when` 命中为 failed）、命令输出不进契约、信任边界委托宿主。

### C·机器契约承载：`cmd_gate` + 内部 `pending_cmd` 扩展（`cli/src/lib/flow-overlay-derive.ts`）

现有契约 `current_node` 仅承载 overlay-added 节点（builtin 节点不输出 `current_node`），故 builtin cmd gate 需新字段机器可读地表达「这是 cmd pending」：

- **内部 `pending_cmd` 载荷扩到 builtin gate**：S26 的内部 `pending_cmd` 载荷（**不在 JSON 契约**、仅供 next 执行器取命令）扩展为可指向 builtin verify/deploy/smoke gate（含 field/command/timeout）。
- **派生 JSON 字段 `cmd_gate`**（observe-pending 时输出）：当当前前沿是 verify/deploy/smoke 且其 cmd 字段仍 pending（status/watch 恒未求值；next 中 cmd 非 0/超时/未命中，**或因 budget=1 被前序 cmd 耗尽而未求值**）时输出 `cmd_gate = { node_id: "verify"|"deploy"|"smoke", field: "done_when"|"fail_when", command, timeout_seconds }`。**挂载与 `loop_state`（§十七）同构**：有 `modules[]` → `modules[].cmd_gate`（**与 `active_change` 平级、不挂其下**——因 `next` 的 module item 里 `active_change` 是字符串而非 status 的对象）；legacy 无 `modules[]` → 顶层 `cmd_gate`；`next` base data 同步挂 `next.modules[].cmd_gate`。消费方先读 `modules[].*`、缺则读顶层（与 `loop_state`/`current_node` 一致）。
- `current_node` **维持只给 overlay-add**（不破坏现有契约约束）；builtin cmd gate 由 **`cmd_gate` + `proposal_step`（停门前）**共同表达。
- **budget=1 与 overlay-add cmd 共享**：builtin gate cmd 求值与 S26 overlay-add cmd 共用同一 budget=1，按 flow 顺序先到先求值（前有 overlay-add cmd + 后有 builtin cmd gate → 先执行前者、后者保持 pending）。

### D·next 求值与瞬态态（`cli/src/commands/next.ts`）

- **求值入 budget=1 + 回灌 detection**：对 builtin gate（verify/deploy/smoke）的 cmd 求值纳入 budget=1，结果回灌 `detectProposalStepViaFlow` 的 cmd-eval 入参；**复用现有 §3.8(c) cmd 结果字段**（`cmd_node_id`/`cmd_predicate_field`/`cmd_exit_code`/`cmd_timed_out`/`cmd_satisfied`，`cmd_node_id` 天然支持 builtin id 如 `"verify"`），无需新增字段。
- **瞬态 proposal_step（落契约）**：`done_when:cmd` exit 0 → 本次 envelope 的 `proposal_step` 显示推进过门（如 `ready-to-deploy`），但**不写 marker** → **下一次 `status` 回到 `ready-to-verify`**——这是**有意的 next/status 不一致**（`next` 门后态据本次 cmd 求值合成、`status`/`watch` 反映持久化前沿停门前）。`fail_when:cmd` exit 0 → 瞬态失败态 `verify-failed`/`smoke-failed`（非推进；deploy 无 `fail_when:cmd`）；非 0/超时 → 未命中、停门前。
- **`next_node` R3 扩到 builtin cmd gate**：cmd 命中续推 → `next_node` 指向续推后节点；cmd 失败/超时 → 指向该 builtin gate 节点（明确 `cmd_gate.node_id`/`cmd_satisfied`/`next_node`/`proposal_step` 的瞬态关系）。
- **不写任何状态 marker**：cmd 字段不持久化、每次 `next` 重评；`next` 不写 `VERIFY_PASS`/`DEPLOY_DONE`/`SMOKE_PASS`/`*_FAIL`（A 被动派生）。**现有 `openlogos verify`/`deploy-done`/`smoke` 命令的 marker 写入行为完全不变**（照常可跑、照常写各自 marker），这些 marker 只在仍为 marker: 谓词的字段上参与判定。

### E·status / watch 输出（`cli/src/commands/{status,watch}.ts`）

cmd-gate 时输出 `cmd_gate` 字段、`proposal_step` 停门前；**observe 不执行 cmd**（无新写入）。**仅有 cmd gate（overlay modify）时 `cmd_gate` 出现、否则整字段省略**。

### 范围边界与零漂移约束

- **复用既有引擎**：S26 cmd 求值器（`flow-cmd.ts`）、`detectProposalStepViaFlow` / `extractLaunchedMarkers` 检测层、overlay `modify` 路径——不引入新组件、新 marker、新 `proposal_step` 枚举值。
- **cmd-gate 仅经 overlay `modify` opt-in 激活**；`markerName` / `detectProposalStepViaFlow` 对 marker: 路径行为不变；JSON 字段 `cmd_gate` 仅 cmd gate 时出现。builtin 三模板 verify/deploy/smoke 仍 `marker:` → 无 overlay 项目 detection/status/next/watch **逐字节不变** → `golden-baseline.test.ts` 零漂移。
- **A 被动派生严守**：`next` 不写状态 marker、cmd 字段每次重评；OpenLogos 只声明 gate 接 cmd:，是否求值/推进由宿主 + 用户 overlay 显式驱动，引擎不自行越门。
- 本切片**收掉** `spec/flow-spec.md §13` M2 列最后一项 `modify-cmd-on-builtin`（M2 列清空）；**不触碰 loop 收敛逻辑**（与 verify cmd gate 经 fail-loud 隔离）。

## 二十、feature 功能分组模型层（add-feature-model）

在 module 与 scenario 之间引入**可选的 feature（功能）分组层**，形成三层模型 `module → feature → scenario`。feature 是轻量组织/导航维度，不承担部署/生命周期语义。

### 数据模型（logos-project.yaml）

```yaml
feature_counter:          # 可选，AI 维护，仿 scenario_counter
  next_id: 4
features:                 # 可选，feature 注册表
  - id: F01               # F0X 项目全局唯一（>99 进位三位）
    name: 项目生命周期与初始化
    module: core          # 归属单一 module（子分组、不跨 module）
    spec: core-01         # 可选：feature-specs 文档序号，缺失视为未链接
scenarios:
  - id: S01
    module: core
    feature: F01          # 可选
```

- **单一事实源读取侧**：`cli/src/lib/project-yaml.ts` 的 `ProjectYamlData` 补 `features[]` / `feature_counter`，`ProjectYamlScenario` 补可选 `feature`，`normalizeProjectYaml` / `normalizeScenario` 解析新字段。status/next/feature 命令统一从此读取。

### AI 维护范式（与 scenario 同构）

CLI 从不读写 `scenario_counter.next_id`（取号是 AI 职责）。feature 沿用同一范式：`feature_counter` / `features[]` / `scenario.feature` 由 AI 维护（Skill 指导），CLI **不新建取号机制**，只做只读消费与 prompt 生成。

- **取号**：读 `next_id` → 用作 `F0X` → `+1` 写回。
- **冲突恢复（两步式）**：`allocated = max(configured_next_id, max(existing)+1)`，用 `allocated` 创建，持久化 `feature_counter.next_id = allocated + 1`（防 off-by-one 重号）。

### 五条不变量

1. **feature 完全可选**：纯 pre-feature 项目**逐字节完全等同今天（含 `contract.version` 保持 `1.0.0`，条件版本见不变量 5）**；`normalizeScenario` 只读已知字段，旧 CLI 天然忽略新字段，新 CLI 读旧 yaml 视为无 feature（双向 CLI 兼容）。
2. **混合态一等合法**：同 module 下部分场景有 feature、部分没有 → "未分组"（`__ungrouped__`）桶收纳。
3. **feature 不承担 lifecycle/deployment**：纯组织维度。
4. **归属降级（独立规范）**：`scenario.feature` 缺失/指向未知 feature/跨 module 三态一律入所属 module 的"未分组"桶，不报错、不阻断。本层**不**类比 `scenario.module`（后者仅对缺失兜底 core，显式未知不回退），且不改动 `scenario.module` 现状。
5. **契约条件版本 minor（回应 delta-F1=B）**：新增可选 `modules[].features` 字段属 minor；采**条件版本发射**——`contract.version` = `1.1.0` **当且仅当**本次响应含 ≥1 个 `modules[].features`，否则**保持 `1.0.0`**。故纯 pre-feature 响应逐字节完全不变（含版本）、无 golden 重拍；仅带 feature 响应升 `1.1.0`。两版契约并存（1.0.0 无 features / 1.1.0 可含 features），`features`⟺`1.1.0`；两份 schema 的 `contract.version` 由 const 放宽为 `enum ["1.0.0","1.1.0"]` + 根级 allOf 约束（`version==1.0.0 ⟹ 无 features`），CI 校验"响应 version ∈ 支持集 + features⟹1.1.0"。**版本发射唯一改点 = `cli/src/lib/step-registry.ts`**：由单常量 `CONTRACT_VERSION` 改为导出两版本常量（`1.0.0`/`1.1.0`）或选择器；status/next import 后**按本次响应是否含 features 条件选择**发射版本（不各自硬编码——回应 delta-F6）。

### 派生与命令架构

- **契约版本发射（唯一改点，条件版本）**：`cli/src/lib/step-registry.ts` 由单常量 `CONTRACT_VERSION` 改为导出 `1.0.0`/`1.1.0` 两版本常量（或选择器 helper）；`status.ts:1227` / `next.ts:999` import 后**按本次响应是否含 `features` 条件选择**发射版本（含 features → 1.1.0，否则 1.0.0），不各自硬编码——保证两命令、两版 schema 与条件版本约束一致（回应 delta-F1=B / F6）。
- **status 分组桶**：`cli/src/commands/status.ts` 的 `collectStatusData` 在按 module 分组（`s.module ?? 'core'`）之下再按 `features[]` 声明顺序建 feature 桶（含成员为空的注册 feature，`scenarios:[]`）；`ModuleStatusItem` 补可选 `features`（元素含 `id`/`name`/`spec`/`scenarios:[{id,name}]` 稳定成员列表——与 phase 无关，**不复用**依附 phase 的 `ScenarioCoverage`）；overlay 路径 `cli/src/lib/flow-overlay-derive.ts` 同款分组处同步。
- **省略/降级派生规则（How 层，回应 delta-F10）**：`collectStatusData`（及 overlay 派生）**省略 `features` 当且仅当**该 module 既无注册 feature（`features[]` 中 `module==本 module`）**且**其下无任何场景带 `feature` 键（纯 pre-feature 项目）。**只要**有 ≥1 注册 feature，**或**有 ≥1 场景带 `feature` 键（含未知/跨 module 悬空引用），即**输出** `features` 并在末位补 `__ungrouped__` 降级桶——因此未知/跨 module 引用一定进入 `__ungrouped__`，不因"无注册 feature"被省略（与 UT-S34-12/13、产品规格、CLI 契约、schema `$comment` 一致）。`feature list` 为专用分组视图（无零漂移约束）：module 有场景但无注册 feature 时仍返回 `[{__ungrouped__}]`，`[]` 仅用于真正空 module。
- **next**：透传 status 的 feature 结构（`NextModuleItem` 增同形 `features?`），不在 feature 层改变"下一步"选择逻辑。
- **feature list**：`cli/src/commands/feature.ts` 只读视图，复用 `makeEnvelope`/`makeErrorEnvelope`（未注册 module → `MODULE_NOT_FOUND`）。
- **feature-backfill**：以 `cli/src/commands/index-cmd.ts` 为范式样板，生成 `logos/feature-backfill-prompt.md`，不改 yaml、幂等。
- **命令注册**：`cli/src/index.ts` 挂 `feature` / `feature-backfill` 命令 + HELP + `--format` 清单。

### 实现映射补充（S34）

| 场景 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| S34 | `cli/src/lib/step-registry.ts`（版本发射唯一改点：单常量→1.0.0/1.1.0 双常量或选择器，条件发射）、`cli/src/lib/project-yaml.ts`（features[]/feature_counter/scenario.feature 解析）、`cli/src/commands/status.ts`（feature 分组桶，消费 CONTRACT_VERSION）、`cli/src/lib/flow-overlay-derive.ts`（overlay 分组同步）、`cli/src/commands/feature.ts`（feature list）、`cli/src/commands/feature-backfill.ts`（生成 prompt）、`cli/src/index.ts`（命令注册） | `cli/test/s34-feature.test.ts` |

## 二十.A feature-backfill 纳入逆向候选架构（feature-backfill-brownfield）

补上「二十、feature 功能分组模型层」与「brownfield-adopter（S33，`core-06-provenance-data-model`）」之间的读侧桥接。

### 问题结构

- feature 侧（`feature list` / `feature-backfill` / status 分组）以顶层 `scenarios[]` 为唯一输入。
- S33 逆向候选活在文档 `## 逆向基线来源` 章节的 `candidates[]` + yaml 派生 `baseline_index`，**不进** `scenarios[]`。
- ⇒ 逆向接入的存量项目其候选在 feature 侧不可见、无从聚类。

### 场景候选唯一查询协议（回应 F1：候选无 `kind` 字段，须显式筛类）

**约束**：`BaselineCandidate`（`cli/src/lib/baseline-provenance.ts`）**不含 `kind`**；`scanModuleCandidates()` 会同时返回 `scenario-candidates` 与 `system-map` 两类产物的候选，`baseline_index[module]` 也只有聚合 hash/覆盖率/时间、无 `kind→target_path`。直接复用会把 system-map 候选（模块图/入口/依赖）误纳入 feature 聚类并多计 `baseline_candidates_total`。

**协议(权威、可持久重建)**：
- **权威来源 = 已提交 run manifest 的 `expected[{kind, target_path, candidate_keys[]}]`**（S33 §run 记录：`begin` 必含 `kind: system-map` + `kind: scenario-candidates`）。取该 module **最新 committed（非 `superseded`）run** 的 `expected[]` 中 `kind == "scenario-candidates"` 的 `target_path` 集合 → **只取这些文档** `## 逆向基线来源` 章节的候选,即"逆向场景候选"。
- **去重与顺序**：候选按 `key` 去重、按目标文档 + 文档内 `key` 升序（确定性、幂等，与 `scanModuleCandidates` 同序）。
- **筛选谓词（回应 delta-r2-F1，固定布尔）**：`state == "active" && verified == false`。`tombstone`/`retired` 不纳入;**`verified:true` 候选排除**——不纳入、不计数。⇒ 纳入项**全部**是 `verified:false`,prompt 统一标注 `verified:false` 即**如实**（不虚假标注）,`baseline_candidates_total` 口径= active 且未验证的场景候选数。
- **回退(run 历史缺失/迁移项目)**：无 committed run manifest 时,回退按 S33 既有 scenario-candidates 文档的**目标类型/命名约定**识别（与 `baseline-seed` 的 `target_path` 允许目录一致）;仍无法确定类别 → 该 module 记为**候选不可信**,走 F6 降级（不静默计 0）。

### 提交恢复门与同锁读取(回应 F2：feature-backfill 是新机器消费者)

`feature-backfill` 作为**新的基线机器消费者**,必须接入 S33 §4.4 的崩溃一致性读取门:
- **同锁临界区**：候选筛选（含上节 kind/module/state 过滤）、计数、prompt 内容构造**全部在 `withRecoveredReadLocks(root, at, moduleIds, cb)`（`cli/src/lib/baseline-seed-txn.ts`)的同一临界区内完成**（与 `openlogos index` 同范式);读前检测并恢复 `prepared`/`committing` journal。
- **无法取锁/恢复**：返回 `baseline_commit_in_progress`——**不写、不覆盖** `logos/feature-backfill-prompt.md`;`--format json` 走错误 envelope（错误码 `BASELINE_COMMIT_IN_PROGRESS`)、非零退出;文本模式打印同义错误。**绝不**把半新多文档集合当权威、绝不生成缺项/重复项 prompt。
- **多 module 锁顺序（无 `--module`)**：按 `modules[]` 声明顺序取锁（稳定顺序,防死锁与跨 module 混合快照);`listProjectModuleIds` 提供 module 集合。

### 降级语义(回应 F6：解析失败 / 索引 stale)

- **无 `baseline_index` 且无逆向产物**（真·非存量）→ `baseline_candidates_total=0`、prompt 无候选段、命中"非存量零改动"。
- **有权威章节但索引 stale / hash 不符** → 在读锁内**从权威文档 `## 逆向基线来源` 重算**（不信 stale 索引);重算成功即照常纳入。
- **权威章节解析失败（坏 fenced YAML 等)（回应 delta-r2-F6，唯一行为)** → **走错误 envelope、稳定错误码 `BASELINE_PROVENANCE_INVALID`、非零退出、不写/不覆盖 prompt**（不静默降为 0 冒充非存量、不走"warning 成功"以免与必填计数无法闭合)。与"真·零候选"（成功、`baseline_candidates_total=0`)明确区分。

### 五条不变量（How 层）

1. **导航 ≠ 可信度**：`scenarios[]` 登记是导航注册；provenance `verified` 权威源仍是 `## 逆向基线来源` 章节，覆盖率派生（`human_verified / 分母`）单独重算、不受 `scenarios[]` 影响,本命令**不触发索引重写或任何覆盖率副作用**。
2. **status/next 仍只读 `scenarios[]`**：不接入 `baseline_index` 候选到 status/next 输出；adopted 项目在 AI 回写前逐字节零漂移、条件版本沿用（无 features → `1.0.0`）。
3. **CLI 只读 + 生成 prompt**：`feature-backfill` 不取号、不写 yaml、不启动 AI；scenario/feature 取号由 AI 按 prompt 回写（见二十.B）。
4. **非存量零改动**：无逆向场景候选时 `baseline_candidates_total=0`、prompt 与今天一致。
5. **不改 merge / provenance 协议**：不扩展 provenance schema、不引入双有序 delta / 嵌套 change;不改 `candidates[]` 结构（不新增 `kind` 字段——类别经 run manifest 派生）。

### 实现映射补充（feature-backfill-brownfield）

| 场景 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| S34（feature-backfill-brownfield） | `cli/src/commands/feature-backfill.ts`（读锁临界区内:场景候选唯一查询 + 计数 + prompt 标注/取号指令 + `baseline_candidates_total` + `BASELINE_COMMIT_IN_PROGRESS`/降级)、`cli/src/lib/baseline-provenance.ts` + `baseline-seed-txn.ts`（复用 `scanModuleCandidates` / `withRecoveredReadLocks` / run manifest 只读)、（可选）`cli/src/commands/{next,status}.ts`（adopted 路径引导） | `cli/test/s34-feature-backfill.test.ts`（扩展） |

## 二十.A' 扫描侧 canonical 采信 + 错误 envelope 富化（provenance-scan-canonical-recompute）

补 §二十.A：修复 provenance 扫描侧采信强度低于写侧导致的「文档示例毒化基线」——既堵 `feature-backfill` 硬报错，也堵覆盖率分母/新鲜度静默污染。

### 扫描侧 canonical 重算采信（读写强度对齐）

- **问题**：`cli/src/lib/baseline-provenance.ts` 的 `scanModuleCandidates` / `listModuleProvenanceDocs`（经 `listResourceMarkdown` 递归全扫 `logos/resources/**`）采信候选仅 `key.startsWith("<module>::")` 前缀匹配，**不校验 hash**；而写侧 `baseline-seed`（`validateSeedCandidate`）是 `key === candidateKey(module, anchor)` 重算比对。示例/教学编造 key（格式合法、hash 失配）被读侧误采信。
- **改法**：读侧采信判据收紧为 `key === candidateKey(module, anchor) ∨ ∃ a∈aliases[] : key === candidateKey(module, a)`（**alias-aware**，见 core-06 §一.A / §三 身份继承）。`candidateKey` 已存在（`baseline-provenance.ts`），零新约定；判据加在 `listModuleProvenanceDocs` 的文档持有判定与 `scanModuleCandidates` 的候选聚合两处，读侧全链一致（`buildBaselineCoverage`、`feature-backfill` 同源受益）。
- **不变量**：合法基线项目（含改名继承 / tombstone / superseded 候选）覆盖率数值、`aggregate_hash`、freshness 逐字节不变；仅排除不可重算的幽灵候选。

### `BASELINE_PROVENANCE_INVALID` envelope 富化（可诊断性）

- §二十.A「降级语义」的 `BASELINE_PROVENANCE_INVALID` 失败路径，错误 envelope 补两字段（向后兼容、错误码/退出码/「不写不覆盖 prompt」红线不变）：
  - `paths[]`：判定为 provenance 迹象、导致失败的文件相对项目根路径清单（确定性排序）。
  - `reason`：`unparseable`（坏 fenced YAML）| `unclassifiable-evidence`（有迹象但无 manifest 且无约定命名文件、不可定类）。
- 与 canonical 采信配合：编造/示例 key 在采信阶段即排除、不再进入本错误路径；进入者必为真实坏结构或真不可定类，`paths[]` 直指问题文件。

### 实现映射补充（provenance-scan-canonical-recompute）

| 关注点 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| 扫描侧 alias-aware canonical 采信 | `cli/src/lib/baseline-provenance.ts`（`listModuleProvenanceDocs` / `scanModuleCandidates` 加 `key===candidateKey(module, anchor∪aliases)` 过滤，复用 `candidateKey`） | `cli/test/s33-*.test.ts`（UT-S33-37…40） |
| 错误 envelope `paths[]`+`reason` | `cli/src/commands/feature-backfill.ts`（`BASELINE_PROVENANCE_INVALID` envelope 补触发文件路径 + 分类） | `cli/test/s34-feature-backfill.test.ts`（UT-S34-23/24） |

## 二十.A'' legacy 缺省语义统一派生架构（baseline-seed-legacy-default-unify）

补 §二十.A / core-06 §4.1：修复 legacy adopted 项目（yaml 无 `baseline_seed_state` 字段）三入口缺省语义分歧——`next` / `baseline-seed` 状态机本地 `?? 'required'`，`status` 私有 `effectiveAdoptedState`（有候选→`seeded`，无候选→`unknown` 且不输出字段），下游按契约 fail-closed 后基线入口整体消失；且 `sync` 迁移只认旧布尔、对「两字段皆无」空转。

### 共享派生 helper（单一事实源）

- **唯一权威**：`cli/src/lib/baseline-jit.ts` 新增导出 `effectiveBaselineSeedState(root, moduleId, explicit?): { state: BaselineSeedState; legacy: boolean }`。派生规则：explicit 优先；缺省时 有候选 ∧ 有 open run → `partial`，有候选 ∧ 无 open run → `seeded`，无候选 → `required`；**废除 `unknown` 第三态**。「有候选」= `scanModuleCandidates(root, moduleId).candidates.length > 0`；「有 open run」= `listRunIds`/`readRunRecord` 中该模块存在 `status: 'open'` 的 run。
- **读锁纪律（继承 status F7 反 TOCTOU）**：helper 内部读权威文档 / run 记录必须在**模块读锁区间**（`withBaselineReadLock`）内执行——helper 自取读锁，并提供 `{ assumeLocked }` 一类入参支持外层已持锁时复用（status 的锁内派生场景）；锁被占用（提交进行中）时按恢复门语义返回降级信号，由调用方走 `baseline_commit_in_progress` 分支。
- **全量清点（一次收编，禁止残留）**：`next.ts:249/596/657`、`baseline-seed.ts:147/303/334`、`status.ts:30-35（删除私有 `effectiveAdoptedState`）/663/685` 全部改为经 helper 取有效状态；以 `grep "baseline_seed_state ??"` 与 `grep "readSeedState(.*) ??"` 在 `cli/src/` 下清零为验收锚。任何入口不得再持有第二份缺省规则。
- **status 恒输出**：adopted 模块 `modules[].baseline_seed_state` 无条件输出（explicit 或派生值）；**含 `!derived.ok`（`baseline_commit_in_progress`）降级分支**——该分支同样经派生兜底取值，不得回落到「原始字段缺失 → 不输出」。

### sync 迁移落盘（migrate-lifecycle 扩展）

- `cli/src/lib/migrate-lifecycle.ts`：在既有「布尔→枚举」迁移之后，对 `bootstrap: adopted`（含历史 `skipped` 兼容读取）且仍无 `baseline_seed_state` 的模块，调用共享 helper 派生并写入显式枚举；changes 记录写明派生依据（如 `core: baseline_seed_state 缺省 → required（派生：无逆向候选）`）。已有显式值不覆盖；历史布尔迁移行为不回归；幂等。
- 迁移后 legacy 缺省态物理消亡，运行时派生仅作过渡兜底；status legacyHint 文案保留且自此指向的 sync 真实有效。

### 实现映射补充（baseline-seed-legacy-default-unify）

| 关注点 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| 共享派生 helper（读锁内派生 + open run 判定） | `cli/src/lib/baseline-jit.ts`（`effectiveBaselineSeedState`，复用 `scanModuleCandidates` / `withBaselineReadLock` / run 记录读取） | `cli/test/s33-*.test.ts`（三入口一致性 UT） |
| 三入口收编（删私有缺省规则） | `cli/src/commands/next.ts`、`cli/src/commands/baseline-seed.ts`、`cli/src/commands/status.ts`（含 `effectiveAdoptedState` 删除与 commit-in-progress 分支兜底） | `cli/test/s05-next.test.ts`、`cli/test/s11-status.test.ts`、`cli/test/s33-*.test.ts` |
| sync 迁移落盘 | `cli/src/lib/migrate-lifecycle.ts`（无字段 adopted 派生回填 + changes 记录） | `cli/test/s33-*.test.ts`（迁移 UT） |
| status JSON 契约恒输出 | `cli/src/commands/status.ts`（adopted 恒输出 `baseline_seed_state`，废除 unknown → 缺失路径） | `cli/test/s11-status.test.ts`、`cli/test/s16-json-output.test.ts`、golden |

## 二十一、步骤注册表架构（step-registry 唯一铸造点，contract-self-description）

### 现状问题

`proposal_step` 字面量铸造点分散、无统一铸造点：`cli/src/lib/proposal-lifecycle.ts` 的 `detectProposalStep` 与 `cli/src/lib/flow-derive.ts` 的 `detectProposalStepViaFlow` 是**两套镜像实现**，另有 `cli/src/commands/status.ts`、`cli/src/commands/next.ts` 直接产字面量或覆盖派生结果。driver 侧被迫用本地枚举集反推步骤语义，已多次漂移。

### 改造：唯一铸造点

- 新增 `cli/src/lib/step-registry.ts` 作为 `proposal_step` 的**唯一铸造点**：任何代码路径产生 `proposal_step` 必须经注册表——收敛 `detectProposalStep` 与 `detectProposalStepViaFlow` 双镜像为一，`status.ts` / `next.ts` 的直接字面量与覆盖点一并改走注册表。
- 注册表为每个步骤铸造 `step_meta: {phase, kind}`（`phase ∈ pre-implement|implement|post-implement`、`kind ∈ produce|gate|command-required|residency`），由 `status` / `next` 的 `modules[].active_change.step_meta` 随步骤携带输出。全量注册表（**不新增 `proposal_step` 枚举值**）以功能规格 2.28 为唯一事实源。
- `step_meta` 不构成第二枚举——phase/kind 为小闭合枚举，且契约明文规定消费方遇未知值必须走保守分支。

### CI lint（注册表旁路防回归）

配套 lint 进 CLI 的 CI：全仓扫描「字面量赋给 `proposal_step` 却不在注册表」→ 挂测试失败。注册表成为步骤语义漂移的结构性闸门，而非约定。

### 实现映射补充

| 关注点 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| 步骤注册表 + step_meta | `cli/src/lib/step-registry.ts`（新增）、`cli/src/lib/proposal-lifecycle.ts`、`cli/src/lib/flow-derive.ts`、`cli/src/commands/{status,next}.ts` | `cli/test/s11-status.test.ts`、`cli/test/s05-next.test.ts`、注册表 lint 测试 |

## 二十二、机器契约层架构（contract.version 与 spec/schema/ 版本化 JSON Schema，contract-self-description）

### 契约版本握手

- `status` / `next` 的 `data` 顶层新增 `"contract": {"version": "1.0.0"}`（语义化契约版本，独立于 CLI 版本；与既有 envelope `version`（CLI 版本串）、flow 文件整数 schema `version` 是三个不同的版本维度，互不混用）。
- SemVer 规则：**major** = 必填字段删除/改义、闭合枚举语义变化（含移除值）、既有字段挂出判据变更；**minor** = 向后兼容扩展（新增可选字段、闭合枚举新增值）；**patch** = 不改形态与语义的澄清。
- 消费方约定（规范性引用，验收归 runlogos R5）：未知 major / 缺 `contract` 字段 → 保守模式（仅 next 驱动普通推进 + 看门狗，启发式判定降级为仅观察）；契约内任何枚举遇未知值 → 保守分支。

### 版本化 JSON Schema（spec/schema/）

- CLI 仓发布 status/next 的 JSON Schema：`spec/schema/status.schema.json`、`spec/schema/next.schema.json`（内嵌契约版本号，随 npm prepack 打包，附包内容验证测试）。
- **版本-schema 一一映射**：响应 `contract.version` 必须与打包 schema 版本一致，CI 加校验；契约演进时 schema 与版本号同步推进。

### 权威事实与派发契约的数据流（单一事实源）

- **facts**：`modules[].active_change.facts` 由 CLI 权威计算输出（复用既有权威判定 `hasSpecCompleteMarker` / `isTasksCodeFilled` 等，导出为单一实现）；`loop_state` 激活判据与 facts **同源**（同一份计算，不允许两处实现）。
- **dispatch**：权威数据源 = flow 节点定义——内置模板 `spec/flow/initial.yaml`、`spec/flow/launched.yaml` 逐节点补齐 `dispatch` 声明（flow 文件 schema 与加载层同步扩展，涉及 S22 加载/解析、S25 overlay 派生）；`defaults.dispatch.timeout_seconds` 为唯一默认值源（fallback），resolved 时物化进每个节点，输出层不再有第二处默认；**不从 produces/done_when 推导**（推导算法本身会成为新的隐式世界模型）。

### CI 一致性证伪（生产者契约）

- 每个注册步骤/节点必须通过 schema 校验（含 step_meta/dispatch 必填，overlay-add 未声明 dispatch 走保守默认后同样过校验）。
- **生产者一致性漂移注入测试**：在 CLI 注册全新步骤（如 `x-future-step`, `phase=pre-implement`）→ 断言 (a) 注册表/step_meta/schema 三方同步、schema 校验通过；(b) 该 pre-implement 步骤下 `loop_state` 不输出（激活判据的反面锚——`pre-implement + loop_state` 是非法组合，生产者测试断言其不存在，而非将其固化为合法夹具）。
- **验收边界**：本架构只承诺**生产者契约**（contract 版本字段在场、注册表/schema/输出三方同步、dispatch/facts 字段来源正确、包内 schema 完整）；消费方保守模式 / 零误杀 / suspect 可逆态验收归 runlogos R5 提案，双向契约测试是跨仓总方案完成定义。

### golden 影响（主动破例）

`data` 顶层新增 `contract` 打破「data 顶层逐字节不变（golden 零漂移）」——全部 9 个 golden 基线快照重拍（`cli/test/golden-baseline.test.ts`），破坏性集中在此、随大版本发布；`active_change` 新增 `step_meta` / `facts` 走既有可控扩展口径（仅有活跃提案的 golden 重拍）。

### 实现映射补充

| 关注点 | 主要代码路径 | 主要测试路径 |
|------|-------------|-------------|
| contract 版本握手 + schema 打包 | `cli/src/lib/json-output.ts`、`spec/schema/status.schema.json`、`spec/schema/next.schema.json`、npm prepack | `cli/test/s16-json-output.test.ts`、包内容验证测试 |
| facts 权威事实块 | `cli/src/lib/proposal-lifecycle.ts`（权威判定导出）、`cli/src/commands/{status,next}.ts` | `cli/test/s11-status.test.ts`、`cli/test/s05-next.test.ts` |
| dispatch 节点元数据 | `spec/flow/{initial,launched}.yaml`、`cli/src/lib/flow.ts`（schema + 加载）、`cli/src/lib/flow-overlay-derive.ts`（透传/保守默认） | `cli/test/s22-flow.test.ts`、`cli/test/s25-overlay-derive.test.ts`、`cli/test/s28-next-node.test.ts` |
| loop_state 激活收紧 | `cli/src/lib/flow-loop-derive.ts`（四事实合取判据）、SLICES_APPROVED 结构化 marker 写入点 | `cli/test/s27-loop-iterate.test.ts`、`cli/test/golden-baseline.test.ts` |
| 生产者漂移注入 | `cli/src/lib/step-registry.ts` + schema 校验测试 | 漂移注入（`x-future-step`）一致性测试 |

## 二十三、change-lint 打包调用层架构（change-lint-shift-left S35）

### 定位与不变量

`openlogos change-lint` 是**既有共享判据函数的打包调用层**。不变量（与 step-registry 唯一铸造点同级强度）：

- **严禁第二份判据**：lint 的每一项检查必须调用与 flow-derive / merge 相同的共享函数；判据改一处，消费点（惰性）与检查点（主动）同时生效。禁止在 lint 内复制正则、映射表或判定逻辑（教训参照 baseline-seed 三入口分歧事故）。
- **只读**：不写任何项目文件 / marker / 哈希清单；不改变任何 step/gate 派生语义。

### 实现映射

| 检查 | 共享函数（`cli/src/lib/`） | 说明 |
|------|--------------------------|------|
| L1 | `parseTaskSections`（proposal-lifecycle.ts） | 既有，直接复用 |
| L2 | `isCodeRequiredForProposal` × section 在场判定（proposal-lifecycle.ts） | 既有，直接复用 |
| L3 | 新共享结构化 test-id evaluator（含权威 parser `parseTestCaseIds` 与阶段分类函数） | 前置重构①：ID 闭合文法（锚定正则 + token 边界 + 整串匹配，见功能规格 §2.30）与阶段分类（marker × `[delta]` 勾选度 → plan / spec-complete / slice 三级证据；勾选度计数基**仅含任务文字带 `deltas/` 目标路径的 delta 产出条目**，非 delta / merge-time checkbox 不参与计数）单点实现；复用声明按固定语法逐项解析并校验已合并规格存在性；`hasRealTestIdsForProposal` / flow-derive 改为其打包调用（显式语义收紧之一） |
| L4 | 新共享 `validateMarkdownDelta` | 前置重构②：自 merge.ts 私有 `SECTION_MARKER_RE` 演进，结构化返回 `missing_section_marker` / `template_skeleton_present`。**模板骨架为结构规则而非全文词表**：先解析 marker block 并剔除行内代码、代码围栏内容，然后 (a) marker 标题本身等于占位标题即命中；(b) 块正文中**只要仍存在任一独占一行的权威模板占位符行**（未替换占位行）即命中——**不要求正文全部由占位构成**，真实标题/真实内容与残留占位行混合的部分脱模板产物同样报 `delta_template_skeleton`（否则该文件会被 merge 写入未替换占位内容）；行内代码、代码围栏中的引用与正常说明文字**不得命中**。占位字面量以**唯一常量表**承载，覆盖两个权威模板（`spec/change-management.md` `[新增内容标题]` 系 + 根 Skill `[新增章节标题]` 系）× ADDED/MODIFIED/REMOVED 全部标题与正文占位变体；merge 改为其打包调用（显式语义收紧之二），回归含「真实骨架全拒 + 真实内容混合残留占位行拒 + 合法引用不拒 + 本提案 delta 自检通过」 |
| L5 | `resolveProposalDeploymentDecision`（proposal-lifecycle.ts:740） | 既有，读 `deployment_decision_conflict` 布尔字段 |
| L6 | 新共享 delta 分类器（正交双结论） | 前置重构③：自 merge.ts 私有 `DELTA_TO_RESOURCE` + `scanDeltas` 演进；`mergeDisposition`（merge 消费，行为逐字节零改动）⊥ `lintValidity`（lint 报 `delta_path_invalid`）；原型资产通道（`commitVerifiedPrototypes`）语义不变 |
| L7 | `evaluateUiPrototype` 纯 evaluator + 共享 proposal-context resolver | 前置重构④：拆纯 evaluator（只读）与产物写入 wrapper（`UI_PROTOTYPE_HASHES.json` 归 wrapper，`check-ui-prototype` 命令行为不变）；激活判据 = 模块 `product_type ∈ GUI`，坏声明（缺段/坏 YAML/非布尔）报独立新码不被 false 吞。**前置重构⑤（模块归属单一事实源）**：把 merge.ts 私有 `readProposalModule` 提取为共享 proposal-context resolver——`proposal.md > module:` 头优先（持久事实源）；头缺失且 guard.activeChange==slug 才回退 guard.module；冲突以头为准；无法解析或模块不在 yaml → 操作错误 `module_unresolved`（fail-closed）。L7 及一切 module-aware 判据统一消费其结果，`--slug` 指向的提案按其自身模块判定、与 guard 指向无关 |

### violation code 注册表归属

`ChangeLintViolationCode` 为**23 码闭合注册表**（L1–L6 共 7 码 + L7 既有 13 码 + L7 新增 3 结构码），以导出的 TypeScript union/常量表承载，禁开放字符串；`spec/cli-json-output.md` §3.15 为契约唯一枚举源。仅 L2/L3/L5 三处语义真实重合携带可选 `flow_reason` 映射（L2 → `CodePlanningDiagnostic.reason` 枚举成员 `tasks-code-section-missing`；L3 → `ProposalBlockReason` 枚举成员 `code_change_requires_real_test_ids`；L5 → `resolveProposalDeploymentDecision` 返回值的 `deployment_decision_conflict` 布尔字段名）。

### 同源回归锚（守护测试架构）

不做「violation 集合 == flow 停因」判等（非同构：lint 多违规并发，flow 单停因）；改为对同一夹具断言**共享 evaluator 在 lint 与 flow-derive / merge 两侧 pass/fail 与结构化细节一致**。兼容回归锚定：占位串提案不再绕过 `test-id-required`；模板骨架 delta 被 merge 拒绝；unknown/reference 忽略语义（UT-S09-02/10）与已知 category 任意扩展名文件、文件 symlink 的 merge 消费行为逐字节零漂移。

## 二十四、delta 条目守恒判据架构（merge-conservation-archive-audit S37）

> 位于「二十三、change-lint 打包调用层架构（S35）」之后。

### 判据落点与共享（严禁第二份判据）

- 守恒判据以**纯函数**落 `cli/src/lib/change-lint.ts` **单点实现**（与 L4 `validateMarkdownDelta` 同文件同纪律）：输入（delta 内容, 目标主文档内容），输出结构化违规列表（`delta_implicit_id_removal` / `delta_removed_unknown_id` / `delta_section_anchor_unresolvable`，含缺失 ID、所属章节锚、fix_hint）。
- 两个消费点**打包调用同一函数**：`change-lint.ts` 作为 L8 检查项（产出点，exit 2 报违规）；`merge.ts` 在生成 MERGE_PROMPT 前调用（消费点，违规即拒绝、与模板骨架拒绝同级）。延续 S35 确立的「lint 与 merge / flow-derive 共享同一批判据函数（单一事实源，严禁第二份判据）」不变量。
- 同源回归锚：同一夹具断言 lint 与 merge 两侧 pass/fail 及结构化细节一致（对齐 §二十三「同源回归锚」模式）。

### 章节锚解析器（fail-closed，禁止猜测）

- 段标记标题即章节锚，支持**单段锚**（标题在目标文档中唯一时）与**标题路径锚**（`父级标题 > 目标标题`，` > ` 分隔，覆盖标题重复语料——`core-smoke-test-cases.md` 中 `### 二、冒烟测试用例补充` 重复 7 次、分属不同父章节）。
- 解析器按 heading 层级树匹配路径；结果为 **0 个或 ≥2 个**章节 → 返回 `delta_section_anchor_unresolvable`（诊断含 not-found / ambiguous 区分与候选位置列表）。**实现红线：不得取第一个命中、不得合并同名章节、不得用 delta 内容反猜目标。**
- L8 / merge 消费点 / merge-executor（人工定位，歧义暂停询问）三方共用同一定位规则。

### ID 模式注册表与结构化抽取（防散文绕过）

- 新增导出常量注册表（形如 `ID_PATTERN_REGISTRY`），每类含**token 文法**与**结构化抽取位置**双要素——ID 的「存在 / 保留 / 点名」只认结构位置，散文提及、非 ID 列单元格、fence 内引用一律不计：
  1. **测试 ID**（`UT-*` / `ST-*` / `SMOKE-*`）——结构位置：测试用例表 **ID 首列单元格**（结构识别对齐既有 `extractStructuredTestIds` 模式）；token 判形**复用既有 `parseTestCaseIds` 权威 parser**（锚定整串兼容基线 + 减法拒绝），不新建第二 parser。
  2. **场景 ID**（`SXX`）——结构位置：`## SXX:` / `### SXX` 形态章节标题；场景总览 / 场景地图表**行首列**。
  3. **节号**——**完整编号 token 文法**：`N(.N)*` 多级数字 + 可选**直接单字母后缀**或**末级点分单字母**（等价 `N(?:\.N)*(?:[A-Za-z]|\.[A-Za-z])?`），覆盖既有全部形态（`2.33`、`2.29.1`、`2.29.2`、`2.2b`、`2.2c`、`2.5a`、`2.7A`、`2.13.1`、`2.19.A`–`2.19.C`、`2.20.A`–`2.20.D`）；**完整 token 即 ID**（`2.29.1` ≠ `2.29.2` ≠ `2.29`；`2.2b` ≠ `2.2c`；`2.19.A` ≠ `2.19.B` ≠ `2.19`）；结构位置：仅**标题行**——版本号（`0.13.21`）与散文小数天然排除。
- **兼容语料回归（强制）**：从当前全部受管规格标题生成 corpus，闭合文法必须全量识别；逐个删除任一标题必须产生守恒违规（防文法漏形态）。
- 逐章节归属对账：保留 / 点名必须发生在 ID 原所在章节锚定的块内，跨章节引用不背书。
- 注册表是守恒判据的唯一 ID 事实源；未来扩类（如决策记录 `DXX`）只改注册表，判据函数零改动。**严禁在注册表外散落第二份 ID 正则。**

### 判定流程（两消费点同流程）

1. 解析 delta 的 `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 块（段标记解析扩展承认 REMOVED-ITEMS；仅含 REMOVED-ITEMS 无物质变更块 → 非法）；
2. 目标主文档不存在 → 跳过（新文件无守恒义务）；
3. 逐锚解析章节（0 / ≥2 命中 → `delta_section_anchor_unresolvable`，该锚不再进入后续对账）；
4. 对每个被 MODIFIED / REMOVED / REMOVED-ITEMS 触及的章节，按注册表**结构化抽取**既有 ID 集合；
5. 逐章节集合对账：既有 ID −（同锚 MODIFIED 新内容结构 ID ∪ 同锚 REMOVED-ITEMS 点名 ID ∪ 整节 REMOVED 的全节 ID）≠ ∅ → 逐 ID 产 `delta_implicit_id_removal`；点名 ID ∉ 锚定章节既有集合 → `delta_removed_unknown_id`；REMOVED-ITEMS 无同锚 MODIFIED 配对 → 按 `delta_implicit_id_removal` 对偶缺陷报出；
6. 违规稳定排序（L8 位于 L7 之后，同 path 按源位置出现序）。

### 事后点数（职责在 Skill 层，非 CLI）

- merge-executor（AI）合并落盘后、写 `SPEC_MERGED` 前，按同一注册表**结构化口径**清点：合并后主文档实际 ID 集合 == 合并前 − REMOVED 整节 ID − REMOVED-ITEMS 点名 + 新增；不符即报告并暂停。该步骤是 AI 行为规范（`skills/merge-executor/SKILL.md`），不新增 CLI 面；CLI 侧事前门已确定性拦截 delta 缺陷，事后点数只兜底「执行出错」。REMOVED-ITEMS 为纯声明性标记，merge-executor 不据其执行编辑。

### 实现映射

| 面 | 位置 | 内容 |
|----|------|------|
| 判据纯函数 + 锚解析器 + ID 模式注册表 | `cli/src/lib/change-lint.ts` | 守恒对账函数、heading-path 锚解析、`ID_PATTERN_REGISTRY`（文法 + 结构位置双要素）、新 violation code 定义 |
| L8 检查项接线 | `cli/src/commands/change-lint.ts`（经 lib 打包） | L8 汇入 violations 聚合与稳定排序 |
| merge 消费点拒绝 | `cli/src/commands/merge.ts` | 生成 MERGE_PROMPT 前打包调用，违规非零退出 |
| 违规文案 | `cli/src/i18n.ts` | L8 违规与 merge 拒绝文案 key（zh/en） |
| 契约登记 | `spec/cli-json-output.md` §3.15 | `ChangeLintViolationCode` 闭合枚举扩册 3 码 |
| 映射一致性回归 | `cli/test/`（S37 测试） | `DELTA_TO_RESOURCE` 与 `spec/change-management.md`、change-writer 目录映射表三方一致（含 `spec → 根 spec/`、`skills → 根 skills/`） |

### 架构不变量

1. 守恒判据纯函数、无副作用、不读写文件系统之外的状态（输入即字符串）。
2. lint 与 merge 共享同一判据、同一锚解析器、同一注册表，严禁第二份。
3. 锚解析 fail-closed：0 / 多命中一律拒绝，禁止任何猜测式回退。
4. 结构化归属：ID 计数只认结构位置，任何正文 token 扫描式实现均不合规。
5. 零回归：L1–L7 判据、合法 delta 的 merge 消费行为逐字节不变；L8 仅新增。
6. archive audit-only 契约（见功能规格 §2.33.6）不引入任何读 archive 的代码路径——resources 自足性在代码面的体现是「archive 只写不读」维持现状并固化为红线。



## 二十五、决策记录沉淀能力实现映射（S38，decision-record-capability）

> 来源变更：decision-record-capability（社区 RFC issue #12 补充观察）。位于 §二十四（S37 守恒判据实现映射）之后。delta-r1 复审后补齐自举路径、落盘所有权、索引扫描器与编号唯一性。

### 25.1 delta 类别注册（delta-r1 F1，解自举死锁）

- 现行 `cli/src/lib/delta-classify.ts` 的 `DELTA_TO_RESOURCE` 与合法类别校验（`invalidReason` 白名单）仅含 `prd/api/database/scenario/test/spec/skills`（+ `reference`），对 `deltas/decisions/` 判 `delta_path_invalid`。`cli/src/lib/flow-derive.ts` 的 `MERGE_SUPPORTED_DELTA_DIRS_FOR_UI` 与 `cli/src/lib/proposal-lifecycle.ts` 的 `MERGE_SUPPORTED_DELTA_DIRS` 同为该白名单的第二、三处副本。
- **`[code]` 注册 `decisions` 类别**：三处白名单 + `DELTA_TO_RESOURCE` 新增 `decisions → logos/resources/decisions/`（同源维护，一致性由回归测试锚定）。注册上线后 `deltas/decisions/` 才成为合法可 merge 类别——**首条 dogfood `core-D01` 由后续变更产出**（本案不含 `deltas/decisions/` 记录，见 §2.34.0）。

### 25.2 目录、编号与落盘所有权（delta-r1 F2/F5）

- **决策记录目录**：顶层 `logos/resources/decisions/`，文件 `<module>-DXX-<slug>.md`。
- **`decision_counter` 是「AI 维护、CLI 不取号、仅读取侧解析」**（比照 `project-yaml.ts` 现状：`scenario_counter` / `feature_counter` 由 AI 维护、CLI 不取号、只 read-side parse——**当前该模块无计数器写 helper**，delta-r1 F5 已核实）。故 `cli/src/lib/project-yaml.ts` 仅新增 `decision_counter` 的**读取侧解析**（缺失时 read-side 视为未配置，取号时按公式回落），**不新增 CLI 取号 / 写 helper**（不引入第二套计数逻辑）。
- **取号 / 落盘所有者 = merge-executor（AI），不是 `openlogos merge`（delta-r1 F2）**：`openlogos merge` 只校验 delta + 生成 `MERGE_PROMPT` / `MERGE_PROMPT_GENERATED`（`merge.ts` 不写资源、不改计数器）。merge-executor 在 apply 时于**同一提交**内：① 应用 delta 写决策记录主文档；② 按分配公式定号；③ 持久化 `decision_counter.next_id`；④ 更新 `resource_index`；⑤ 写 `SPEC_MERGED`。失败回滚（不提前消耗编号）、重试幂等。
- **分配公式（全局唯一，闭合；delta-r2 F5：基准只含已落盘、不含本批）**：`base = max(configured_next_id ?? 1, max(resources/decisions/ 中【已落盘】DXX，空集按 0) + 1)`——**基准只从已落盘记录取 max，绝不纳入本批 `deltas/decisions/` 待落盘 DXX**。本提案候选按不依赖待分配 DXX 的稳定顺序（文件名 slug 声明序）排列，第 `i` 条（0 基）`expected_i = base + i`；校验「文件名 DXX == 标题 DXX == `expected_i`」，与既有资源 / 本提案内重复即拒绝；全部 apply 成功后持久化 `next_id = base + 候选数`。**先扫已落盘最大 DXX** 消解「counter 缺失 / stale 但决策文件已存在 → 重复分配」；**排除本批** 消解「首条拟号 D01 被 `max(1,1+1)` 算成 D02 后自拒」（delta-r2 F5）。

### 25.3 resource_index 扫描器扩展（delta-r1 F3，需代码）

- 现行 `cli/src/lib/sync-resource-index.ts` 的 `scanCandidateFiles()` 逐项扫描 `prd/api/database/test/scenario/verify/implementation`，**无 `decisions`**；`inferResourceDesc()` 无决策记录规则。
- **`[code]` 扩展统一扫描器**：`scanCandidateFiles()` 纳入 `logos/resources/decisions/`；`inferResourceDesc()` 增 `logos/resources/decisions/(?:[a-z][a-z0-9-]*-)?D\d+-.+\.md$` 的内容化 desc 规则。扩展后 `openlogos index` / `sync` 才能发现新决策记录、生成内容化描述并进入 `resource_index`（AC7 / ST-S38-06 的机器保障）。`sync-resource-index.ts` 及其测试列入实现面；端到端用例从「索引无该项」的真实 YAML 起、落盘后跑权威 index/sync、断言路径 + desc 补入且重复运行幂等。

### 25.4 判据与守恒门联动 + change-lint warning（delta-r1 F4）

- **`DXX` 扩册进 `ID_PATTERN_REGISTRY`**（`cli/src/lib/change-lint.ts`，S37 §2.33.3 已预留「注册表扩展只改一处、判据函数零改动」）：token 文法 `D\d+`、结构化抽取位置 = 决策记录文档标题 / 决策表首列。扩册后决策记录条目**自动获得** S37 守恒门保护（`delta_implicit_id_removal`），无需第二份判据。superseded 用 `MODIFIED` 携整条剩余全量、仅改状态字段——`DXX` 在场、守恒通过。
- **change-lint 决策 warning（独立 warnings 通道）**：`change-lint.ts` 检测「proposal 含『已确定的设计决策』章节 且 `[delta]` 无 `deltas/decisions/` 任务」→ 产 warning（code `decision_record_section_without_delta`）。**warning 走独立 `warnings[]` 输出通道**，`pass` / exit code 不受影响、**不进** `ChangeLintViolationCode` 闭合枚举。其 JSON 契约（出现 / 省略 / 排序 / envelope）以 `spec/cli-json-output.md` §3.15 为唯一事实源；**仅非空时出现、否则省略**（零漂移）。文本经 `cli/src/commands/change-lint.ts` 追加 `⚠` 行、`cli/src/i18n.ts` 承载文案。复用 S35 change-lint 既有 proposal / tasks 解析，纯结构判定、无第二份 proposal 解析。

### 25.5 不变量

1. **判据单一事实源**：`DXX` 守恒复用 S37 `change-lint.ts` 判据函数，严禁第二份 ID 正则 / 判据（承 §二十四）。
2. **计数逻辑不重复**：`decision_counter` 复用 `scenario_counter` / `feature_counter` 的「AI 维护、CLI 只读」范式，取号由 merge-executor 按闭合公式执行，CLI 不新增取号逻辑。
3. **零回归**：无「已确定的设计决策」章节的提案，change-lint / merge / merge-executor / archive 行为逐字节不变；`warnings` 空时省略、DXX 类别注册不影响既有类别校验。

## 自动流程证据边界与责任分工

### 证据源

OpenLogos 自动流程涉及四类证据：

1. `tasks.md`：声明切片与任务完成状态，但不单独证明测试已通过。
2. `logos/resources/verify/test-results.jsonl`：OpenLogos reporter 写入的测试 ID 执行证据。
3. `logos/resources/verify/acceptance-report.md`：`openlogos verify` 汇总的全量验收结论。
4. driver audit / progress：RunLogos 或其它宿主记录的 agent dispatch、artifact 声明与调度结果。

架构上必须避免把四类证据压缩成单一布尔值。尤其是“本片 reporter 通过”和“全量验收失败”可以同时为真，二者应驱动 repair，而不是驱动 hard block。

### OpenLogos 主责

OpenLogos CLI 负责提供权威、结构化、可机器消费的状态：

- 当前 `proposal_step` / `next_node`；
- 当前 loop / slice 是否收敛；
- verify 的失败测试与覆盖诊断；
- artifacts / reporter / focused tests 的校验结果；
- 建议下一节点与是否需要人类介入。

### 外部 driver 主责

RunLogos / 外部 driver 负责执行调度：

- 根据 OpenLogos 输出派发 agent；
- 收集 agent 完成回报与 artifacts；
- 将 artifacts 与 OpenLogos 证据对齐；
- 在可恢复失败时重派 repair / code；
- 仅在 OpenLogos 明确输出硬阻塞或需要人类判断时停止。

### 设计约束

- `retry-exhausted` 不得作为所有校验失败的兜底出口。
- audit / progress 中的失败事件必须保留可恢复原因，不能只保留最终抽象原因。
- 当 driver 自身无法验证 artifacts 时，应输出 `driver-cannot-validate-artifacts`，而不是推断 agent 虚报。
