# Delta 变更管理规范

> 版本：0.3.0
>
> 本文档定义 OpenLogos 的 Delta 变更管理机制。每次功能迭代或 Bug 修复，先创建变更提案，审核通过后再合并回主文档。确保变更过程可追溯、可审核、可回滚。

## 核心原则

1. **不直接修改主文档**：每次变更先在 `logos/changes/` 中创建提案
2. **影响分析先行**：在 `proposal.md` 中明确变更范围和部署影响
3. **按需传播**：不是每次都全链路更新，只更新受影响的环节
4. **部署可追溯**：需要部署的提案必须产出部署 delta、部署任务和冒烟测试方案
5. **归档留痕**：变更完成后归档，保留完整历史
6. **guard 互斥**：同一时间只允许一个活动提案；存在活动 guard 时，必须阻止新的 `openlogos change`

## 目录结构

```
project-root/
└── logos/
    ├── resources/                    # 主文档（当前已生效的"真相"）
    │
    └── changes/                      # 变更提案工作区
        ├── add-remember-me/          # 一个变更提案
        │   ├── proposal.md           # 变更说明
        │   ├── tasks.md              # 实现任务清单
        │   └── deltas/               # 增量修改（Delta）
        │       ├── prd/
        │       ├── api/
        │       ├── database/
        │       └── scenario/
        │
        └── archive/                  # 已完成变更的历史归档
            └── add-remember-me/
```

> `logos/.openlogos-guard` 是活动提案锁文件。只要它指向 `logos/changes/` 下一个未归档提案，`openlogos change` 就必须拒绝创建新的提案，直到当前提案被 `openlogos archive` 归档后释放锁。

## 文件规范

### proposal.md

变更说明文档，必须包含：

```markdown
# 变更提案：[变更名称]

## 变更原因
[为什么要做这个变更？来源于哪个需求/反馈/Bug？]

## 变更类型
[需求级 / 设计级 / 接口级 / 代码级]

## 变更范围
- 影响的需求文档：[列表]
- 影响的功能规格：[列表]
- 影响的业务场景：[列表]
- 影响的 API：[列表]
- 影响的 DB 表：[列表]
- 影响的编排测试：[列表]

## 部署影响
- 是否需要部署：是 / 否
- 部署原因：[说明为什么需要或不需要部署]
- 影响环境：[本地 / 测试 / 预发 / 生产 / 无]
- 是否涉及数据迁移：是 / 否
- 是否需要回滚预案：是 / 否

## 变更概述
[用 1-3 段话概述具体改什么]
```

`## 部署影响` 是人工审核依据。CLI 的部署状态判断以 `tasks.md` 的 `[deploy]` section 和提案目录标记文件为准，不解析自由文本作为唯一依据。

`## 部署影响` 同时也是提案级部署决策入口。CLI 应从该章节解析结构化决策，并与 `tasks.md` 的 `[deploy]` section 交叉校验：
- `是否需要部署：否` 时，不得创建 `[deploy]` section；verify PASS 后下一步为 archive。
- `是否需要部署：是` 时，必须创建 `[deploy]` section，并在 delta 阶段补齐部署方案影响；verify PASS 后下一步为人类确认部署。
- `是否需要 smoke：是` 只在已部署后生效；smoke 仍由 `openlogos smoke` 独立执行。
- 旧提案缺少结构化部署影响时，CLI 可回退到 `[deploy]` section 与模块级默认值，但必须标注兼容来源。

### tasks.md

实现任务清单，使用结构化 section 格式，每个 section 对应提案流程中的一个阶段。完整格式规范见 `spec/tasks-spec.md`。

```markdown
# 实现任务

## [delta] 规格变更
- [ ] 产出 delta 文件到 deltas/prd/1-product-requirements/ — 更新需求文档
- [ ] 产出 delta 文件到 deltas/api/ — 更新 API YAML

## [code] 代码实现
- [ ] 实现 src/xxx 中的业务逻辑
- [ ] 编写对应测试

## [deploy] 部署任务
- [ ] 按部署方案部署到 staging
- [ ] 确认迁移、配置、服务启动和回滚预案
```

Section 标记规则：
- `## [delta]` — delta 文档产出任务，该 section 全部勾选后可进入 `ready-to-merge`
- `## [code]` — 代码实现任务，直接修改源文件，不产出 delta
- `## [deploy]` — 部署执行任务，只能在 verify PASS 后、人类明确确认后执行
- 纯代码提案可只有 `[code]` section（无 `[delta]`），CLI 会直接跳过 delta-writing 阶段
- 不需要部署的提案不得创建 `[deploy]` section
- 旧格式（无 section 标记）向后兼容，降级为全局勾选判断

> **注意**：`openlogos verify` 和 `openlogos smoke` 是独立 CLI 操作节点，不应写入 tasks.md 作为可勾选任务。tasks.md 只追踪 delta、代码和部署执行任务。

### deltas/ 目录

增量修改文件，使用标记格式：

```markdown
## ADDED — [新增内容标题]
[新增的完整内容]

## MODIFIED — [修改内容标题]
[修改后的完整内容，替换主文档中同名章节]

## REMOVED — [删除内容标题]
[说明删除原因]
```

Delta 文件的目录结构映射主文档目录：
- `deltas/prd/` → 对应 `logos/resources/prd/` 的变更
- `deltas/api/` → 对应 `logos/resources/api/` 的变更
- `deltas/database/` → 对应 `logos/resources/database/` 的变更
- `deltas/scenario/` → 对应 `logos/resources/scenario/` 的变更
- `deltas/test/` → 对应 `logos/resources/test/` 的变更
- `deltas/spec/` → 对应项目根目录 `spec/` 的方法论规范变更
- `deltas/skills/` → 对应 `logos/skills/` 的 Skill 文档变更

部署方案 delta 使用 `deltas/prd/3-technical-plan/3-deployment/`，合并目标为 `logos/resources/prd/3-technical-plan/3-deployment/`。

`openlogos merge` 会递归扫描上述目录，保留子目录映射。例如 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 会合并到 `logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`。

## 变更工作流

> **核心原则**：`openlogos merge`、`openlogos verify`、部署执行、`openlogos smoke`、`openlogos archive` 和 `git push` 是人类确认点。AI 可提醒、解释、准备命令；未经用户明确授权不得执行。用户以明确请求或 slash command 授权时，AI 可以代为执行。不得在“顺手完成流程”“按流程走完”等隐式场景中自动触发。
>
> **规格驱动代码**：代码实现必须在规格合并进主文档之后才能开始，不允许基于 delta 草稿直接写代码。

```
1. 创建变更提案（CLI）
   └── openlogos change {slug}
   └── 生成 logos/changes/{slug}/proposal.md + tasks.md + deltas/
   └── 写入 logos/.openlogos-guard，锁定当前活动提案

2. AI 辅助填写提案（change-writer Skill）
   └── AI 分析影响范围，填写 proposal.md 和 tasks.md
   └── 等待用户确认提案内容后，才开始产出 delta

3. 按 tasks.md 逐项产出 Delta 文件（各阶段 Skill）
   └── 每完成一项任务，将增量变更写入 deltas/ 对应子目录
   └── AI 每完成一项任务后，立即将 tasks.md 中该项从 [ ] 更新为 [x]
   └── 对应 proposal_step: delta-writing

4. 审核变更提案
   └── 团队/自审 proposal.md 和 delta 文件
   └── delta 任务全部勾选且存在可合并 delta 后，对应 proposal_step: ready-to-merge

5. 生成合并指令（CLI）【人类确认点】
   └── openlogos merge {slug}
   └── 扫描 deltas/，生成 MERGE_PROMPT.md
   └── 写入 MERGE_PROMPT_GENERATED，表示“合并指令已生成，等待 AI 合并主规格”

6. AI 执行合并（merge-executor Skill）
   └── AI 读取 MERGE_PROMPT.md，逐个 delta 合并到主文档（logos/resources/）
   └── 合并完成后，AI 自动 commit 规格文档变更（告知用户，无需确认）
   └── commit message 格式：docs({slug}): merge spec deltas
   └── 写入 SPEC_MERGED，表示“主规格已合并，可以开始代码实现”

7. 实现代码（code-implementor Skill）
   └── 按合并后的主文档实现业务代码 + 测试代码 + OpenLogos reporter
   └── 代码实现完成后，AI 自动 commit 代码变更（告知用户，无需确认）
   └── commit message 格式：feat/fix({slug}): implement changes

8. 运行验收（CLI）【人类确认点】
   └── 用户运行 openlogos verify，生成验收报告
   └── 验收通过（PASS）→ 继续步骤 9
   └── 验收失败（FAIL）→ 修复代码后重新运行，不需要重走 merge 流程

9. 部署执行（如需要）【人类确认点】
   └── 仅当 VERIFY_PASS 存在、提案级 `是否需要部署：是` 且 tasks.md 有 [deploy] section 时进入
   └── 用户必须明确授权 AI 执行部署
   └── AI 必须读取合并后的部署方案文档和 [deploy] section
   └── 部署完成后生成 logos/resources/verify/deployment-report.md
   └── 部署完成后写入 logos/changes/{slug}/DEPLOY_DONE
   └── 部署失败时不得写入 DEPLOY_DONE，应输出失败点和回滚建议

10. 运行部署后冒烟测试（CLI）【人类确认点】
   └── 仅当提案级 `是否需要 smoke：是` 且 DEPLOY_DONE 存在时运行 openlogos smoke
   └── openlogos smoke 读取 smoke 结果并生成 logos/resources/verify/smoke-report.md
   └── 冒烟通过写入 SMOKE_PASS
   └── 冒烟失败写入 SMOKE_FAIL
   └── SMOKE_PASS 后才能归档提案；无需 smoke 的提案在部署完成后可归档

11. 归档变更（CLI）【人类确认点】
   └── openlogos archive {slug}
   └── 将 logos/changes/{slug}/ 移入 logos/changes/archive/
   └── 若当前 guard 指向该提案，则删除 logos/.openlogos-guard
   └── 归档完成后，AI 自动 commit 归档变更（告知用户，无需确认）
   └── commit message 格式：chore({slug}): archive change proposal

12. 推送到远端（Git）【人类确认点】
    └── AI 提示用户确认是否执行 git push
    └── 用户明确授权后，AI 执行 git push
    └── 未获授权不得自动推送
```

### commit 粒度规则

| 变更类型 | commit 策略 |
|---------|------------|
| 需求级 / 设计级变更 | 至少 3 个 commit：规格（Step 6）+ 代码（Step 7）+ 归档（Step 11） |
| 接口级变更 | 至少 2 个 commit：规格+代码合并（Step 6-7）+ 归档（Step 11） |
| 代码级修复 | 至少 2 个 commit：代码（Step 7）+ 归档（Step 11） |

## 变更传播规则

不是每次变更都需要全链路更新。根据变更类型决定影响范围：

| 变更类型 | 最少需要更新 | 说明 |
|---------|------------|------|
| 需求级变更 | 全链路 + 部署影响分析 | 需求变了，所有下游都可能受影响 |
| 设计级变更 | 原型 + 场景 + API/DB + 编排 + 代码 + 部署影响分析 | 需求不变，实现方案调整 |
| 接口级变更 | API/DB + 编排 + 代码 + 部署影响分析 | 设计不变，接口细节调整 |
| 部署级变更 | 部署方案 + smoke 用例 + `[deploy]` 任务 | 发布平台、环境变量、迁移、回滚、健康检查变化 |
| 代码级修复 | 代码 + 重新验收 + 部署影响分析 | Bug 修复，不涉及设计变更时仍需判断是否需要重新部署 |

## 提案级部署决策优先级

部署与 smoke 的判断顺序如下：
1. 活跃提案存在时，优先读取 `proposal.md` 的 `## 部署影响`。
2. `tasks.md` 的 `[deploy]` section 是部署执行任务的结构化证据，必须与 `proposal.md` 一致。
3. `logos-project.yaml` 的模块级 `deployment_required` / `smoke_required` 是 Initial 阶段和历史提案的默认值，不得覆盖活跃提案的明确决策。
4. 文档-only 或规格-only 提案声明无需部署时，即使模块默认需要部署，verify PASS 后也直接建议 archive。
5. 部署决策缺失或冲突时，CLI 应输出警告，并采用保守策略：不自动部署，等待用户修正提案。

## Git 集成

- 每个变更提案对应一个 Git 分支：`change/{change-name}`
- 分支合并时，`logos/changes/{change-name}/` 同步移入 `logos/changes/archive/`
- 重大变更在文档顶部的"最后更新"时间戳中标注
- `logos/changes/archive/` 提供完整变更历史

### commit 时机与 message 规范

AI 在以下三个节点自动提交（告知用户，无需确认）：

| 节点 | commit message 格式 | 包含内容 |
|------|-------------------|---------|
| merge 完成后（Step 6） | `docs({slug}): merge spec deltas` | logos/resources/ 下的规格文档变更 |
| 代码实现完成后（Step 7） | `feat/fix({slug}): implement changes` | 业务代码 + 测试代码 |
| archive 完成后（Step 11） | `chore({slug}): archive change proposal` | logos/changes/archive/ 归档文件 |

push 是独立的人类确认点（Step 12），AI 必须等待用户明确授权后才执行。

## MERGE_PROMPT.md 文件规范

`openlogos merge` 命令自动生成的指令文件，结构如下：

```markdown
# Merge Instruction

## 变更提案
- 提案名称：{slug}
- 提案目录：logos/changes/{slug}/

## 提案内容
[从 proposal.md 中读取的完整内容]

## 需要合并的 Delta 文件

### 1. {delta-relative-path}
- Delta 文件：`logos/changes/{slug}/deltas/{category}/{relative-file}`
- 目标目录：`{target-dir}/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求
1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   `git add -A && git commit -m "docs({slug}): merge spec deltas"`
9. 写入 `logos/changes/{slug}/SPEC_MERGED`
   然后提示用户：按更新后的规格实现代码；代码完成后运行 `openlogos verify`；如有 `[deploy]` section，验收通过后由用户明确授权部署，再运行 `openlogos smoke`；最后明确授权执行 `openlogos archive {slug}`。
```

## CLI 命令

```bash
# 创建变更提案
openlogos change add-remember-me

# 生成合并指令（由 AI 执行实际合并）
openlogos merge add-remember-me

# 归档已完成的变更
openlogos archive add-remember-me
```

## AI Skills 集成

- **change-writer**：在 `openlogos change` 后使用，辅助填写 proposal.md 和 tasks.md
- **merge-executor**：在 `openlogos merge` 后使用，读取 MERGE_PROMPT.md 执行实际合并
