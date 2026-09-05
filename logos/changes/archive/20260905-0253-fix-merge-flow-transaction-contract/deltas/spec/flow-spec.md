## MODIFIED — 12.7 提前填充的 [code] auto-reset（enforce-slice-stage-ordering）

**问题**：`isTasksCodeFilled`（判 `tasks_code_filled`）是纯内容判据，不带时序前置，无法区分「slice-planner 在正确时机（merge 后）划的切片」与「`write-tasks`（plan 段、merge 前）AI 提前填的切片」——两者磁盘状态相同。提前填充使 §12.5 / §12.6 派生把前沿直接判到 `slice-exit` 门（有 delta 提案 merge 后）或 `ready-to-implement` 已 `tasks_code_filled`（纯代码提案），**跳过 slice-planner 独立环节**。

**（1）提前填充的定义**

`[code]` 已 `tasks_code_filled`，但「slice 阶段尚未合法进入」：
- 有 delta 提案（`delta_required==true`）：`SPEC_MERGED` 尚不在场；
- 任一需要代码的提案：`SPEC_MERGED` / `MERGED` 尚不在场，或 `[code]` 填充发生在合法 slice 阶段之前。

**（2）auto-reset 触发点（确定性 CLI 动作，不依赖 AI）**

在「进入 slice 段 / 放行 slice-exit」的确定性 CLI 动作上，若检测到 `[code]` 已 `tasks_code_filled` 但非 slice-planner 正常产出，则先清理再继续：
- **所有代码提案 → `openlogos merge`**（有 delta 时创建/推进合并事务；无 delta 时执行 no-op merge）。在写入 `SPEC_MERGED` 前，若检测到 `[code]` 已脱模板且不是合法 slice-planner 产物，先执行 auto-reset，再进入 slice 段。此后 `[code]` 恒为空或占位，slice-planner 正常填。

**（3）清理动作**

- 把 `tasks.md` 的 `## [code]` section 重置为模板占位（等价 change-writer 纯代码模板：保留空 `## [code]` 标题、令 `isTasksCodeFilled==false`）；
- 被清理的旧 `[code]` 原文备份到提案目录 `CODE_AUTORESET`（append-only jsonl，每行含 `ts` / 触发点 `trigger:"merge"` / 旧 `[code]` 原文），可追溯、非无痕删除。

**（4）幂等**

`[code]` 已是占位（未 `tasks_code_filled`）时，触发点不清理、不追加 `CODE_AUTORESET`。重复 `merge` / 重复触发 slice-exit 守卫不产生重复备份。

**（5）被动派生边界（A 被动派生不变）**

auto-reset 是**命令副作用**，只发生在 `openlogos merge` 这个本就有副作用的动作上。`status` / 默认 `next` / `flow-derive` 的**派生路径保持只读**，绝不触发清理。清理后 `[code]` 恒为空进入 slice 阶段，§12.5 / §12.6 派生自然落「前沿 `plan-slices` → 唤起 slice-planner」，派生规则本身一行不改。

**（6）扩展的副作用（显式登记，未破枚举 / 判据 INV）**

- EXT-1：`openlogos merge` 副作用扩展——除创建 / 推进合并事务（legacy 测试模式为生成 `MERGE_PROMPT`）/ 应用 delta 外，新增「进入 slice 前 auto-reset 提前填充的 `[code]`」，保持 merge 幂等。
- EXT-2：no-delta merge 副作用扩展——无 delta 代码提案同样经过 `openlogos merge`，因此提前填充兜底统一收敛在 merge 落点，不再需要额外 slice 进入 marker。
- 不破 `isTasksCodeFilled` 判据、不破 `proposal_step` 闭合枚举（**不新增阻断态**）、不破 A 被动派生。

**（7）残留边界**

半自动与无人值守模式均通过 `openlogos merge` 进入 spec-complete，因此提前填充兜底不依赖 `--auto`。若用户绕过 CLI 手写 marker，仍可能跳过该兜底；此类越权写入由 guard / review 层处理。

## ADDED — 12.10 merge-generated 的权威推进事实（fix-merge-flow-transaction-contract）

0.14.x 生产语义下，`merge-generated` 步骤（即 `generate-merge-prompt` 节点 done）的**权威推进事实**为：

```text
活跃提案目录存在 MERGE_TRANSACTION.json（合并事务已创建 / 幂等在场 / 归档让位后重建）
∨ 存在 MERGE_PROMPT_GENERATED / MERGE_PROMPT.md（legacy 测试模式兼容影子）
```

规则：

1. **判据单源两处声明**：`spec/flow/launched.yaml` 的 `done_when: any_present:[MERGE_TRANSACTION.json, MERGE_PROMPT_GENERATED, MERGE_PROMPT.md]` 与 `flow-derive` 的 step 推导声明同一判据，由回归测试断言两处一致；单改任一处即缺陷（架构「四十七」authority cutover）。
2. **推进语义**：事务在盘（任意相位，含 failed——终态由 merge 重跑走归档让位重建）即 `proposal_step: merge-generated`、`next_node: apply-merge`（skill: merge-executor）；`SPEC_MERGED` 落盘后按既有规则越过 merge 段。§12.8 派生顺序第 4 条「`delta-writing → ready-to-merge → merge-generated`」的推进链与 step 注册表条目（`merge-generated: pre-implement / command-required`）不变。
3. **中间态合法**：有 delta 提案 merge exit 0 后、apply 完成前，前沿停在 `apply-merge` 是合法中间态（合同见 `spec/cli-json-output.md`「merge 成功后置条件与前沿推进契约」与 `spec/change-management.md`「merge 中间态与前沿推进」）；宿主以「exit 0 + 事务在盘且 phase 合法」判本跳成功。
4. **禁止影子判据复活**：生产路径永不写 MERGE_PROMPT marker；除 legacy 测试模式外，任何组件不得以生成 marker 的方式推进前沿，也不得绕过投影自行 stat 事务文件推导 step。
