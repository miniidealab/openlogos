# Skill: Brownfield Adopter（存量项目逆向建基线）

> 存量项目 `openlogos adopt` 接入后，由 **AI 会话/driver** 检测 `baseline_seed_state: required`，逆向扫描代码库产出**种子基线**（现状快照，非权威意图），经 `openlogos baseline-seed` 两阶段提交落盘。
> 唯一 producer 边界（S33 F2）：`adopt` 只做确定性初始化并写 `baseline_seed_state: required`，**绝不启动 AI、不产逆向内容、不声称基线已建立**；逆向扫描是本 skill 的职责。

## 触发条件

- `openlogos adopt` 完成后模块处于 `bootstrap: adopted` 且 `baseline_seed_state: required`（或历史 `partial`，续做/重扫）。
- `openlogos next` / `status` 在 adopted 无活跃提案时提示「逆向建立现状基线」或「完成现状基线（恢复扫描）」。
- 用户或 driver 明确要求「建立现状基线」「逆向扫码」「seed baseline」。

## 前置依赖

1. 已 `adopt`：`logos/logos.config.json` 存在，模块 `bootstrap: adopted`。
2. 具备代码库读取能力（AI 会话/driver 授权的扫描范围）。
3. CLI 支持 `openlogos baseline-seed`（begin/commit/status）。

## 核心原则（不可违反）

1. **只写可从代码忠实验证的事实**：system-map（模块图 / 入口 / 依赖）+ **场景候选清单**。**绝不写 PRD / 意图类文档**（意图无法从代码忠实还原）。
2. **每份产物 `verified: false`（冻结字段）**：种子基线是「推断现状」，非权威意图基线。`verified` 恒为 `false`，人工确认机制已移除——不存在把 `verified` 升级为 `true` 的路径。
3. **不直接改 YAML、不直接写目标 `logos/resources/`**：产物只写入 run 私有 **staging**，由 `openlogos baseline-seed commit`（CLI，唯一写入者）校验后原子提交。
4. **能力缺失不伪造**：无法扫描时保持 `baseline_seed_state: required`、输出可复制提示，绝不声称基线已建立。
5. **存量代码不要求回头符合 spec**：种子基线是「未确认的事实」而非「被违反的意图」，方法论硬门只对新引入的意图生效、不对历史现状追溯生效；覆盖率退化为纯逆向候选计数、沿用 tombstone 分母法（`denominator` = `active ∪ tombstone`，无分子），删除候选转 tombstone 仍计入、不虚增。

## 执行步骤

### Step 1: 检测状态

`cd` 到项目根后运行 `openlogos status --format json` / `openlogos baseline-seed status --module <id> --format json`，确认 `baseline_seed_state` 为 `required`（首次）或 `partial`（续做/重扫）。

### Step 2: 逆向扫描 → 规划逻辑产物计划（manifest）

扫描代码库，规划**逻辑产物计划**（无内容 hash——产物字节此刻尚未生成）。必需 kind 至少覆盖 `system-map` 与 `scenario-candidates`：

```json
{
  "module": "core",
  "expected": [
    { "kind": "system-map",           "target_path": "logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md",      "candidate_keys": ["core::<hash>", "..."] },
    { "kind": "scenario-candidates",  "target_path": "logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md", "candidate_keys": ["core::<hash>", "..."] }
  ]
}
```

- `candidate_keys` 用规范键 `<module>::<sha256(normalize(anchor))[:12]>`；`anchor` 取语义标识（CLI 命令名 / 导出入口符号 / 路由）。
- `target_path` 必须为项目根相对、位于 `logos/resources/` 下；禁止绝对路径 / `..` / 符号链接 / 重复。

### Step 3: `baseline-seed begin`

```bash
openlogos baseline-seed begin --module core --manifest .logos-seed-plan.json --format json
```

CLI 校验计划（必需 kind、路径安全）后签发 `run_id`、创建 run 私有 staging 目录并持久化 run 记录。记下 `run_id` 与 `staging` 路径。**begin 不下调状态**（`partial` 保留至新 run 首次有效 commit）。

### Step 4: 生成产物写入 staging

把每份逆向产物写入 `staging/<target_path>`（镜像目标相对路径）。每份产物含具名章节 `## 逆向基线来源`，内嵌 fenced YAML 的 `candidates[]`：

```markdown
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
```

- staged 文档的 `candidates[]` key 集合**必须与 manifest 对应项的 `candidate_keys` 逐项一致**（不一致 commit 会 `candidate_key_mismatch` 拒绝）。
- 只写 active/verified:false 候选；**不写 PRD**。

### Step 5: `baseline-seed commit`

```bash
openlogos baseline-seed commit --module core --run-id <run_id> --format json
```

CLI 对 staged 实际字节算 hash + 校验 schema + 比对 candidate_keys，分类 `committed`/`missing`/`invalid`：

- **必需 kind 齐 + 全部 expected 合法** → 经 commit journal 事务原子提交全部目标 + 派生索引 + `baseline_seed_state: seeded`。
- **≥1 合法但未全** → `partial`（**不提交不完整集合为权威**）；补齐 staging 后重跑 commit（幂等）。
- **0 合法** → 保持当前状态。

### Step 6: 展示覆盖率 / 交回控制

commit 成功后运行 `openlogos next` / `status`，向用户展示现状基线覆盖率（`逆向候选 N 条（含 tombstone T）`，纯计数——`verified` 恒 `false`、`denominator` 采 `active ∪ tombstone` 分母法，无分子/百分比）。提示：后续 `openlogos change` 与普通 launched 模块一致，产出正常前向 delta；候选注册表仍随重扫维护 active/tombstone/alias 生命周期，无确认升级入口。

## 恢复 / 重试

- 扫描中断 → `partial`（持久化恢复态）：补齐 staging 后 `commit --run-id <id>` 续提交，或重新 `begin` 补齐缺失产物（旧 run `superseded`，状态保留 `partial` 至新 run 首次有效 commit）。
- 提交崩溃：`baseline-seed` / `status` / `next` / 覆盖率重算 / `index`·`sync` 等机器读取入口经**恢复门**（取模块锁 + 检测未终结 journal → 先恢复）保证目标集合落定全旧或全新，`seeded` 当且仅当完整新集合在盘。（`verify` 已与基线候选解耦，不读取基线、不承担恢复职责。）

## 降级（能力缺失）

CLI-only / `--ai-tool other` / 非交互 CI / AI 不可用时：不派发扫描，保持 `baseline_seed_state: required`，输出可复制的后续命令/提示；`status`/`next` 显示「种子基线待建立」，绝不把未产出的基线显示为已建立。

## 边界

- 本 skill 只产**种子基线**（现状快照）；不写 PRD、不写业务代码、不做前向设计。
- 状态与目标文件的唯一写入者是 CLI（`openlogos baseline-seed`）；skill 只写 staging。
- provenance 权威载体是文档内 `## 逆向基线来源` 章节；`logos-project.yaml` 的 `baseline_index` 仅为派生索引。
