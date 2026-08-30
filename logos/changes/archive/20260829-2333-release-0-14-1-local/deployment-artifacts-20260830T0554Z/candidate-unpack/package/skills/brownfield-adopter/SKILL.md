# Skill: Brownfield Adopter（存量项目逆向建基线）

> **显式可选**的存量项目 eager seed 加速器：用户或宿主明确要求预扫全库时，由 AI 会话/driver 逆向扫描可验证代码事实，经 `openlogos baseline-seed` 两阶段事务落盘。它不是 `openlogos adopt` 后的默认下一步，不决定项目能否创建 change；完全跳过本 Skill 时，change-writer 仍按 S39 在每次变更中补齐触达场景的正式规格。

## 触发条件

- 用户明确要求「建立现状 seed」「预扫全库」「运行 baseline-seed」；或宿主明确选择 eager seed 作为扫描优化。
- 用户对安全的 open run / 未提交 staging 明确要求续做或重扫。
- **不得触发**：仅因 `openlogos adopt` 完成、`baseline_seed_state: required|partial`、`next`/`status` 展示 seed 状态而自动派发。三态均不构成 change/plan/delta/merge/verify 前置。

## 前置依赖

1. `logos/logos.config.json` 存在，目标模块可解析；通常为 `bootstrap: adopted`，但显式重扫不以 bootstrap 值替代用户意图。
2. 具备用户/driver 授权的代码库读取能力。
3. CLI 支持 `openlogos baseline-seed begin|commit|status`。
4. 任一资源/索引读取前，先在模块锁内检查并恢复未终结 commit journal；无法恢复立即报 `baseline_commit_in_progress`，不得开始扫描或读取半新 resources。

## 核心原则（不可违反）

1. **只写可从代码忠实验证的事实**：system-map（模块图/入口/依赖）+ 场景候选清单；绝不写 PRD/历史 Why。
2. **`verified:false` 冻结**：不存在确认升级、`verified:true`、confirmed_*、JIT advisory 或 baseline warning。
3. **只写 run 私有 staging**：不得直接改 `logos-project.yaml` 或目标 `logos/resources/`；唯一提交者是 baseline-seed CLI。
4. **能力缺失不伪造且不阻断 change**：显式 seed 失败可重试；用户仍可直接创建 change。
5. **安全 partial 与未终结事务分流**：open run/未提交 staging 可排除后继续；`prepared|committing` journal 必须恢复，失败是硬操作错误，不能降级为“seed 证据不可用”。
6. **存量代码 grandfather 边界不变**：seed 是未确认事实快照，方法论硬门只约束新意图；候选按 active/tombstone/alias 维护。

## 执行步骤

### Step 1: 确认显式意图与恢复门

确认当前请求确实要求 eager seed，而非普通 adopt→change。随后在项目根调用 seed status/恢复入口；读取目标、索引或 coverage 必须位于「取模块锁 → 检查/恢复 journal → 读取」同一锁区间。若返回 `baseline_commit_in_progress`，停止本 Skill，不得以代码重扫绕过可能半新的标准 resources。

### Step 2: 逆向扫描并规划逻辑 manifest

仅在恢复门通过后扫描代码库，规划无内容 hash 的逻辑产物计划；必需 kind 至少含 `system-map` 与 `scenario-candidates`：

```json
{
  "module": "core",
  "expected": [
    { "kind": "system-map", "target_path": "logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md", "candidate_keys": ["core::<hash>"] },
    { "kind": "scenario-candidates", "target_path": "logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md", "candidate_keys": ["core::<hash>"] }
  ]
}
```

- candidate key = `<module>::<sha256(normalize(anchor))[:12]>`，anchor 取 CLI 命令/导出入口/路由等语义标识。
- target_path 必须项目根相对、位于允许的 `logos/resources/` 基线目标内；拒绝绝对路径、`..`、symlink escape 与重复。

### Step 3: `baseline-seed begin`

```bash
openlogos baseline-seed begin --module core --manifest .logos-seed-plan.json --format json
```

CLI 校验必需 kind、路径和签发账本后创建 run 私有 staging、持久化 run 记录并返回 `run_id`。begin 不下调既有状态；安全 partial 保持至新 run 首次有效 commit。

### Step 4: 生成产物写入 staging

把产物写入 `staging/<target_path>`。每份文档含 `## 逆向基线来源` 与 fenced YAML `candidates[]`：

````markdown
## 逆向基线来源
```yaml
candidates:
  - key: "core::9f2a4c7b1e83"
    anchor: "cli:adopt"
    display: "adopt 命令"
    state: active
    verified: false
    aliases: []
    superseded_by: []
```
````

staged candidates key 集合必须与 manifest 对应 `candidate_keys` 全集合相等；只写 active/verified:false 候选，不写 PRD。

## 逆向基线来源

- 代码入口、路由、依赖清单、配置与测试是可重算事实来源。
- 注释、README 与文档示例只能作线索；candidate key 必须由 anchor/alias 规范重算匹配后才采信。
- seed 不能证明历史业务动机、优先级、未来验收或正式场景闭包。

### Step 5: `baseline-seed commit`

```bash
openlogos baseline-seed commit --module core --run-id <run_id> --format json
```

CLI 校验 staged 实际字节 hash、schema、candidate key 与路径：

- 必需 kind 齐且全部 expected 合法 → 经 commit journal 原子提交目标+索引+`seeded`；
- 至少一项合法但未齐，且尚未进入目标写事务 → 安全 `partial`，不提交不完整集合；
- 0 项合法 → 保持当前状态；
- 一旦 journal 进入 `prepared|committing`，后续任何消费者必须先恢复，全旧/全新落定前不得读取标准资源。

### Step 6: 交回控制（默认进入 change）

commit 成功或用户决定暂停 seed 后，主提示均为「可运行 `openlogos change <slug>`」。`seeded` 只说明后续证据定位可加速；安全 partial 可附重试命令。不得把 `required|partial|seeded` 任何一态写成 change 前置，也不得提示创建 `add-baseline-docs`。

S39 消费已提交 seed 时只取入口、依赖与候选线索，并从代码/测试重算；正式目标缺失仍 CREATE，candidate verified/provenance 不升级。

## 恢复 / 重试

- 扫描中断且未进入 commit journal → 安全 partial：补齐 staging 后重试 commit、重新 begin，或直接 change；staging 永不进入 effective view。
- commit 崩溃 → baseline-seed/status/next/index/sync/S39 等入口在同一锁区间恢复：prepared 回滚全旧；committing 可前滚则全新，否则按 backup 回滚全旧。
- 无法恢复 → 硬报 `baseline_commit_in_progress`，停止所有标准 resources/index/coverage 读取与迁移写入；不得降级成非阻断 seed 诊断。
- 恢复后才允许新 begin supersede 旧 run；锁回收必须做死 owner 身份仲裁与原子替换，禁止盲删活锁。

## 降级（能力缺失）

AI/扫描能力不可用时，不派发、不伪造、不改目标。向用户说明可稍后重试显式 seed，**同时给出直接创建 change 的可复制命令**；兼容状态保留不构成阻塞。

## 边界

- 本 Skill 只产种子现状快照，不写 PRD、业务代码、前向设计或正式闭包。
- 状态、索引与目标文件唯一写入者是 baseline-seed CLI；Skill 只写 staging。
- provenance 权威载体是主文档 `## 逆向基线来源`；`baseline_index` 是派生索引。
- 不恢复人工确认、JIT advisory、verified 升级、baseline warning、baseline task/gate/marker。
