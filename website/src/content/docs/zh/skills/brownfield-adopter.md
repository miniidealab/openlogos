---
title: brownfield-adopter
description: 存量项目的可选加速器——逆向扫描现有代码，生成 verified:false 的系统地图与场景候选，经 openlogos baseline-seed 提交。
---

逆向扫描已有代码库，把能从代码中验证的事实——系统地图与场景候选清单——记录为**现状种子（seed）**。种子先写入私有 staging 区，再由 `openlogos baseline-seed` 命令提交，从不直接改写 `logos/resources/`。

本 Skill 是**显式可选**的加速器。它不是 `openlogos adopt` 之后的默认下一步，也从不决定你能否创建变更。即使完全跳过它，[`change-writer`](/zh/skills/change-writer) 仍会在每次变更中补齐被触达场景的正式规格。

## Phase 与触发条件

- **Phase**：存量项目接入（adopted 项目，`bootstrap: adopted`）
- **触发条件**：
  - 你明确要求「建立现状 seed」「预扫全库」「运行 baseline-seed」
  - 你明确要求续做或重扫一个安全的 open run / 未提交 staging
- **不会自动触发**：仅因 `adopt` 完成、或 `status` / `next` 显示 `baseline_seed_state: required` / `partial`，都不构成触发理由。任何种子状态都不是 change、plan、delta、merge、verify 的前置条件。

## 前置条件

1. `logos/logos.config.json` 存在，目标模块在 `logos-project.yaml` 中注册为 adopted 模块（`baseline-seed` 拒绝其他模块）。
2. AI 会话具备读取代码库的能力。
3. CLI 支持 `openlogos baseline-seed begin | commit | status`（0.16.0 已支持）。

与其他 Skill 不同，`brownfield-adopter` 不会被 `init` / `sync` 复制到 `logos/skills/`。它随 npm 包（`skills/brownfield-adopter/SKILL.md`）和 OpenLogos Claude Code 插件发布；需要建立种子时，请让 AI 加载它。

## `openlogos baseline-seed` 命令

`openlogos baseline-seed` 是种子状态与种子目标文档的唯一写入者。AI 只往本次 run 的 staging 目录写文件。

| 子命令 | 用途 |
|---|---|
| `openlogos baseline-seed begin --module <id> --manifest <path>` | 校验逻辑计划（manifest），创建私有 staging 目录 `logos/resources/verify/baseline-seed-runs/<run_id>/staging/` 并返回 `run_id`。同模块此前未完成的 open run 会被取代。 |
| `openlogos baseline-seed commit --module <id> --run-id <id>` | 校验 staging 中的实际字节（路径、schema、候选 key），连同索引与 `seeded` 状态一起原子提交。 |
| `openlogos baseline-seed status --module <id>` | 查看当前 run、种子状态，以及预期产物中已 staged / 仍缺失的数量。 |

三个子命令都支持 `--format json`。

模块的种子状态有三种：

| `baseline_seed_state` | 含义 |
|---|---|
| `required` | 尚未提交种子（`adopt` 后的默认值）。仅供参考——你可以立即创建变更。 |
| `partial` | 部分 staged 产物合法但集合不完整，未提交任何内容。未提交的 staging 从不进入有效视图。 |
| `seeded` | 已提交完整种子。后续变更可借助它更快地定位证据。 |

## 它做了什么

1. **确认意图与恢复门**——确认你确实要求的是 eager seed（而不是普通的 adopt → change），并先恢复任何未终结的提交 journal。若返回 `baseline_commit_in_progress`，本 Skill 停止。
2. **扫描代码并规划 manifest**——不含内容 hash 的逻辑计划，至少包含 `system-map` 与 `scenario-candidates` 两项：

   ```json
   {
     "module": "core",
     "expected": [
       { "kind": "system-map", "target_path": "logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md", "candidate_keys": ["core::<hash>"] },
       { "kind": "scenario-candidates", "target_path": "logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md", "candidate_keys": ["core::<hash>"] }
     ]
   }
   ```

   候选 key 为 `<module>::<sha256(normalize(anchor)) 的前 12 位>`，anchor 取 CLI 命令、导出入口、路由等语义标识。target_path 必须是项目根相对路径，且位于允许的 `logos/resources/` 基线目标内。
3. **开始 run**——

   ```bash
   openlogos baseline-seed begin --module core --manifest .logos-seed-plan.json --format json
   ```

4. **把文档写入 staging**——每份文档写到 `staging/<target_path>`，包含 `## 逆向基线来源` 小节和 fenced YAML `candidates[]` 清单。每个候选都是 `state: active`、`verified: false`；staged 的 key 集合必须与 manifest 的 `candidate_keys` 完全相等。
5. **提交 run**——

   ```bash
   openlogos baseline-seed commit --module core --run-id <run_id> --format json
   ```

   - 必需 kind 齐全且全部预期产物合法 → 原子提交，状态变为 `seeded`；
   - 至少一项合法但集合不完整 → `partial`，不提交；补齐 staging 后重跑 `commit`；
   - 没有合法产物 → 状态不变。
6. **交回控制**——无论种子已提交还是暂停，下一步都是 `openlogos change <slug>`。

:::caution
launched 项目在无活跃提案时，guard 会保护既未被 git 跟踪、也未被忽略的新文件。写在项目根目录的 manifest（如上面的 `.logos-seed-plan.json`）就属于这类文件，写入可能被拦截。请把 manifest 放在 git 忽略的路径下，或在有活跃提案时进行。staging 目录默认已豁免。
:::

## 核心原则

1. **只写能从代码验证的事实**——系统地图（模块、入口、依赖）与场景候选；不写 PRD，不写历史动机。
2. **`verified: false` 冻结**——不存在把候选升级为已确认的步骤。
3. **只写 staging**——本 Skill 从不修改 `logos-project.yaml` 或 `logos/resources/` 中的目标文件；唯一提交者是 CLI。
4. **能力缺失不阻断变更**——扫描无法进行时，如实说明，并给出可直接复制的 `openlogos change <slug>` 命令。
5. **安全 partial 与未终结事务分流**——open run 或未提交 staging 可以排除后继续；处于 `prepared` / `committing` 的提交 journal 必须先恢复。
6. **存量代码不追溯**——种子是未确认的事实快照；方法论硬门只约束新意图。

可依赖的来源是能重算的事实：代码入口、路由、依赖清单、配置与测试。注释、README 与文档示例只能作线索。

## 恢复

- **扫描在提交前中断**——安全的 `partial`：补齐 staging 后重跑 `commit`、重新 `begin`，或直接开始变更。
- **提交过程崩溃**——下一次 `baseline-seed`、`status`、`next`、`index` 或 `sync` 调用会在模块锁内恢复：`prepared` 状态回滚为全旧；`committing` 状态能前滚则全新，否则回滚。
- **无法恢复**——命令报告 `baseline_commit_in_progress`，在解决之前停止读取标准资源。

## 产出

- 提交成功后：`logos/resources/` 下的种子文档（例如 `core-system-map.md`、`core-scenario-candidates.md`）、派生的 `baseline_index`，以及 `logos-project.yaml` 中的 `baseline_seed_state: seeded`——全部由 CLI 写入。
- run 进行中：只有 `logos/resources/verify/baseline-seed-runs/<run_id>/staging/` 下的文件。

## 相关

- [接入已有项目](/zh/getting-started/adopt-existing-project) —— 默认路径：adopt 后直接创建变更
- [`openlogos adopt`](/zh/cli/adopt) —— 接入项目并设置 `baseline_seed_state: required`
- [`change-writer`](/zh/skills/change-writer) —— 无论有无种子，都会补齐每次变更触达的规格
