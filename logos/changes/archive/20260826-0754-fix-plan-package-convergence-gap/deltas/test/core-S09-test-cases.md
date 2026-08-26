## MODIFIED — 八、proposal/tasks 写完后的 final 前校验测试

> 覆盖 AI/driver 在 `proposal.md` 与 `tasks.md` 已脱模板后必须确认前沿或消费 auto gate，避免把 `ready-to-delta + tasks 0/N` 误判为任务规划失败。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

| ID | 用例 | 覆盖点 | 前置条件 | 操作 | 期望 |
|---|---|---|---|---|---|
| UT-S09-231 | proposal/tasks 已脱模板后 final 前识别 ready-to-delta | final 前校验 | `proposal.md` 已填、`tasks.md` 含 `[delta]` 且 checkbox `0/N`、无 `PLAN_APPROVED` | 调用 proposal lifecycle / driver 前沿校验函数 | 返回 `proposal_step=="ready-to-delta"`；`plan_ready==true`；不得返回任务规划失败 |
| UT-S09-63 | tasks checkbox 0/N 不触发规划失败 | 执行进度分层 | 同 UT-S09-231，`tasks_execution_done=0`、`tasks_execution_total>0` | 生成 final 诊断 | 诊断说明“delta 尚未执行 / plan gate pending”；不包含 blocked、planning failed 或要求重写 tasks 的语义 |
| UT-S09-64 | auto 消费 plan-exit 后继续派发 write-delta | final 前 auto 闭环 | `ready-to-delta` 提案，`next --auto` 响应含 `gate_auto_passed=true`、`next_node.id="write-delta"` | driver 消费响应 | 下一 dispatch 为 `write-delta` / change-writer；不得 final 停止在 plan gate |
| ST-S09-31 | proposal/tasks 产出端到端不被误判为 block | S09 Step 3→8 | 从新建提案到 AI 写完 proposal/tasks，`tasks.md` `[delta]` 全未勾 | 模拟 driver 完成 write-proposal/write-tasks 后读取 `status/next` | 流程进入 `ready-to-delta`；面向用户的状态为“方案待批准/auto 消费”；无“任务规划失败” |
| ST-S09-32 | 全自动下 plan gate 后进入 delta-writing | S09 + S24 联动 | 同 ST-S09-31，随后执行 `next --auto --format json` | driver 按响应继续派发 | `PLAN_APPROVED` 语义成立，下一工作单元为 `write-delta`；不出现 blocked/no-progress |

## REMOVED-ITEMS — 八、proposal/tasks 写完后的 final 前校验测试

- UT-S09-62 — 该章节误复用了上一章节已占用的测试 ID；改由唯一 ID UT-S09-231 承载同一用例语义。

## MODIFIED — 9.9 writing 阶段冲突消解与三层指令资产（F2 R6、R3）

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-107 | writing 阶段 GUI+ui_impact 放行 page-design 原型 delta | openlogos-phase writing 分支 | GUI 项目、`ui_impact:true`、writing 阶段 | 执行 SessionStart hook | 注入文本含「例外：GUI + 触及 UI 时允许在 plan 阶段产 page-design 原型 delta」；不与「不得写 delta」注入冲突（F2 R6） |
| UT-S09-108 | ready-to-delta 阶段同例外放行原型 delta | plugin-codex/session-start.sh ready-to-delta 分支 | 同上、ready-to-delta 阶段 | 执行 SessionStart hook | 同样注入 GUI+ui_impact 例外；其余 delta 仍禁于 plan 阶段 |
| UT-S09-109 | 非 GUI 或 ui_impact:false 时不放行原型例外 | 两源 writing/ready-to-delta 分支 | 非 GUI 项目或 `ui_impact:false` | 执行 hook | 不注入例外文案，保持「不得写 delta」原语义（例外仅 GUI+ui_impact） |
| UT-S09-110 | 三层指令资产齐备 | L1/L2/L3 交付物 | 已 sync 的 GUI 项目 | 检查交付物 | (L1) `change-writer`/`product-designer`/`merge-executor` SKILL + checker 说明；(L2) `sync` 重生成的 `AGENTS.md`/`CLAUDE.md` 承载 UI-first 工作流；(L3) **读取真实文件 `spec/flow/overlays/gui-ui-first.yaml`**、经现有 overlay parser/schema 校验为合法 overlay 片段且含两个 `op:add`（`write-ui-prototype`/`verify-ui-provenance`）——而非检索 Markdown 示例文本；三层缺一即指令链断 |
| UT-S09-110a | GUI overlay 唯一源真实存在、含两个合法 `op:add`，且 `done_when` 命令实际可求值 | `spec/flow/overlays/gui-ui-first.yaml`（唯一源）+ 真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match` | 已 sync 的 GUI 项目；准备①合法 `generated` 提案（逐页原型齐全 + 合法 `design-system.json`/令牌 + hash 已记录）与②合法 `fallback` 提案（逐页原型齐全 + `design_system_fallback_reason`、无令牌） | 读取真实文件经 overlay parser/schema 校验；再**实际执行**两个 `done_when` 后端子命令 | 文件存在、解析为合法 overlay 片段；恰含两个 `op:add`——① `write-ui-prototype`（`after: write-tasks`、`when: ui_impact`、`produces: 2-page-design/`、`done_when: cmd:<check-ui-prototype>`）；② `verify-ui-provenance`（`before: generate-merge-prompt`、`when: ui_impact`、`done_when: cmd:<check-ui-hash-match>`）；两节点均合法（overlay-add 允许 `cmd:`）。**不止校验 schema 接受 `cmd:`**：`done_when` 后端为真实子命令 `openlogos check-ui-prototype`/`openlogos check-ui-hash-match`，对上述合法 generated 与 fallback 提案实际求值 → 两命令均 `exit 0` |
| UT-S09-110a-neg | `done_when` 命令不存在或仍含字面占位符 → 必须失败（负向） | overlay `done_when` 后端可执行性 | 已 sync 的 GUI 项目 | ①将 `done_when: cmd:` 后端指向**不存在的子命令**求值；②或 overlay 仍保留字面 `<check-ui-prototype>`/`<...>` 占位符未被真实子命令名替换；运行/求值 `done_when` | **必须失败**（非零退出/校验失败）：命令不存在无法求值即节点不可 done；overlay 仍含字面 `<...>` 占位=未落地为真实可执行命令，判非法（保证 `cmd:` 后端确为真实子命令而非示意文本） |
| UT-S09-110b | init/sync 对 GUI 项目注入 overlay 到项目实例 `launched.yaml` | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，该模块值 ∈ GUI={`web`,`desktop`,`mobile`}（即项目含 ≥1 GUI 模块） | 运行 init/sync | `spec/flow/overlays/gui-ui-first.yaml` 两个 `op:add` 被并入项目实例 `logos/flow/launched.yaml` 顶层 `overlay:`（该实例 `extends: builtin:launched@v1`）；注入后 plan subflow 含 `write-ui-prototype`、merge subflow 前含 `verify-ui-provenance`（product_type 唯一源 = `logos-project.yaml modules[].product_type`，非凭空给定） |
| UT-S09-110c | 非 GUI 项目不注入 GUI overlay | project-init/sync overlay 注入 | 从真实 `logos-project.yaml` 读取 `modules[].product_type`，全部模块值 ∈ 非 GUI={`cli`,`api`,`library`,`skills`}（项目无任何 GUI 模块） | 运行 init/sync | **不注入** gui-ui-first overlay；项目实例 `launched.yaml` 不含 `write-ui-prototype`/`verify-ui-provenance`；特性零启用、流程零改动 |
| UT-S09-110d | `product_type` 字段缺失 → 按非 GUI、overlay 不注入 | project-init/sync overlay 注入（缺字段默认） | 真实 `logos-project.yaml` 的 `modules[]` 条目**完全缺 `product_type` 字段** | 运行 init/sync | 缺失=非 GUI（安全默认）；**overlay 不注入**；项目实例 `launched.yaml` 不含 `write-ui-prototype`/`verify-ui-provenance`；对应 GUI 模块存在时该缺字段模块节点 skip（`ui_impact` 不因缺字段模块置真） |
| UT-S09-110e | 多模块（一 GUI 一非 GUI）：节点参与由活跃提案 module 的 `product_type` 决定 | module-aware `ui_impact` 派生 | 真实 `logos-project.yaml` 含两模块——`moduleA.product_type=web`（GUI）、`moduleB.product_type=cli`（非 GUI） | 活跃提案分别归属两模块时派生 `ui_impact` | 活跃提案属**非 GUI 模块 B** → `ui_impact==false`、`write-ui-prototype`/`verify-ui-provenance` 节点 skip；活跃提案属 **GUI 模块 A** → `ui_impact==true`、两节点参与（overlay 项目级注入因项目含 ≥1 GUI 模块成立，但**节点参与由 module-aware `ui_impact`＝活跃提案所属 module 的 product_type 决定**，非项目级一刀切） |
| UT-S09-111 | Python3 缺失时通用风格兜底并写 `fallback` 声明 | change-writer 降级 | GUI 项目、`ui_impact:true`、无 Python3 | 产出原型 | 以通用风格兜底；声明段写 `design_system_mode: fallback` + 非空 `design_system_fallback_reason`（如「无 Python3，未走设计系统」）；不产 `design-system.json`、不伪造令牌；`check-ui-prototype` exit0（不阻塞、不报错），与 UT-S09-81a 端到端一致 |

## ADDED — canonical scaffold 与 plan 生命周期测试

> 所有测试实现必须写 OpenLogos reporter；中英文 fixture 均从真实 `openlogos change` scaffold 起步。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S09-224 | 中文 proposal canonical 章节齐全 | S09 Step 2→3 | locale=zh | `proposalTemplate` | reason/type/scope/deployment/summary/clarification 各恰一次 |
| UT-S09-225 | 英文 proposal 共享语义 ID | S09 Step 2→3 | locale=en | `proposalTemplate` + registry | 英文 canonical 标题映射同一语义集合 |
| UT-S09-226 | launched tasks 生成空 code 锚点 | S09 Step 3 | 中文/英文 launched | `tasksTemplate` | 有 `[delta]` scaffold 与空 `[code]`；无代码 checkbox |
| UT-S09-227 | plan 三态相互独立 | tasks 合同 | 空 code、真实 code slices、纯规格三 fixture | evaluator | plan_filled/code_required/code_slices_filled 精确组合 |
| UT-S09-228 | summary 改名不能被详细设计替代 | EX-6.1 | 删除 summary，保留核心设计 | evaluator | summary missing，expected 为 locale canonical 标题 |
| UT-S09-229 | plan code checkbox 精确拒绝 | EX-3.1 | `[code]` 含模板或真实 checkbox | evaluator | code-entry-before-spec-complete；空标题正例通过 |
| UT-S09-230 | 历史 marker bypass | 历史兼容 | 四类 marker 参数化 | lifecycle derive | 不回退 writing；只允许非阻塞 warning |
| UT-S09-232 | 历史 before 重复/歧义、after 唯一可收敛 | merge-apply test change set | before 同一 ID 有两条定义且另有列数歧义行；after 保留一条、重编号另一条并修正歧义行 | `buildTestChangeSet` | 不抛 before duplicate/ambiguous；保留 ID unchanged，新 ID 与修复行进入 changed；after 重复/歧义反例仍拒绝 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S09-88 | 中英文 change→fill→lint→next 全链 | Step 1→8 | 两个 launched fixture | change、按 scaffold 填充、双检查 | 两者 lint PASS、next ready-to-delta，code section 仍空 |
| ST-S09-89 | 现场双错误一次返回并可修复 | EX-3.1、EX-6.1 | summary 改名 + code 模板行 | lint→按 issues 修复→重跑 | 首轮精确两类 issue；修复后四方一致，无额外人工决定 |
| ST-S09-90 | 历史重复基线可经真实 merge-apply 原子收敛 | merge apply bootstrap | 正式测试 target 的 before 含重复 ID，manifest after 唯一 | 生成 test change set 并执行受控 apply | apply 成功、after ID 唯一、marker changed/removed 集合准确；after 重复负例零写回滚 |

### 追溯与覆盖

- S09-AC-Plan-01 canonical scaffold：UT-S09-224～UT-S09-226、ST-S09-88。
- S09-AC-Plan-02 tasks 三态：UT-S09-227、UT-S09-229。
- S09-AC-Plan-03 现场错误收敛：UT-S09-228、ST-S09-89。
- S09-AC-Plan-04 历史不回退：UT-S09-230。
- S09-AC-Plan-05 merge 自举收敛：UT-S09-232、ST-S09-90。
