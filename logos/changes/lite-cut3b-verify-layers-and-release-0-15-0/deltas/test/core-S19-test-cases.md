# Delta: core-S19-test-cases.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`logos/resources/test/core-S19-test-cases.md`

## ADDED — S19 OpenLogos 0.15.0 打包候选测试用例

> 覆盖 0.15.0 的版本身份同源与隔离 prefix 行为矩阵。**本轮不做本机全局安装**（减法方案 §13 保险条款），故无「全局切换/回滚」用例。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S19-46 | 0.15.0 版本身份全源一致 | 仓库处于 0.15.0 实现完成态 | 读取 CLI `package.json`、lockfile 根包、asset manifest、随包 plugin/模板 manifest 与携带版本的 schema/runner 元数据 | 全部为 `0.15.0`，无一处残留 `0.14.25`；asset manifest 的逐文件 hash 与磁盘字节一致 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S19-22 | 隔离 prefix 真实 pack、安装与破坏性契约验收 | CLI 全量测试与构建已通过；`mktemp -d` 一次性 npm prefix；**不得触碰本机全局 prefix 与本仓活跃提案** | ① 真实 `npm pack --json` 并记录 tarball SHA-256；② 从 tarball 安装到隔离 prefix；③ 新 shell 绝对入口执行验收矩阵 | ① candidate identity 全部来自固定 tarball、无 workspace link；② 已删除命令面（`merge transaction status`、`merge-apply`、切片事务）一律非零退出；③ 临时项目内 `merge <slug>` 一次调用完成多目标合并并写 `SPEC_MERGED`；④ `change-lint` 输出恰 9 项检查、`slice plan --file` 与 `lint-specs` 可用；⑤ **执行前后 `command -v openlogos` 与其 version 均仍为 0.14.25**——全局未被触碰 |

### 追溯与覆盖

- AC-RELEASE-0150-01 candidate identity：UT-S19-46、ST-S19-22 步骤①。
- AC-RELEASE-0150-02 破坏性命令面：ST-S19-22 步骤②③。
- AC-RELEASE-0150-03 新命令可用：ST-S19-22 步骤④。
- AC-RELEASE-0150-04 全局未触碰：ST-S19-22 步骤⑤。
- 部署后 smoke：SMOKE-core-197～199。

## MODIFIED — S19 smoke 前置 fail-closed 校验测试


> 覆盖 S19「smoke 前置依赖 deploy-done」既有规格的**实现对齐**：四项前置的判定顺序与错误码、拒绝时的零副作用、补救命令提示，以及前置满足时的零回归。
>
> 这些规则**并非新语义**：已合并的「smoke 前置依赖 deploy-done」章节早已规定四项前置与「缺 `DEPLOY_DONE` 应提示先执行 `openlogos deploy-done`」。本节把该规格变成可执行的强制判据——此前它只是文字，`cli/src/commands/smoke.ts` 完全没有该校验（20260907 事故：缺标状态下 smoke 照常执行并写入 `SMOKE_PASS`）。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S19-42 | 缺 `DEPLOY_DONE` 时 fail-closed 拒绝且零副作用 | EX-19.5 | 活跃提案：`VERIFY_PASS` 在场、`deployment_required=true`、`smoke_required=true`、`[deploy]` 全勾、`DEPLOY_DONE` **缺失** | 执行 `openlogos smoke`（含 `--format json`） | 非零退出；错误码 `SMOKE_DEPLOY_NOT_DONE`；message 含 `openlogos deploy-done`；`--format json` 走 stderr 通用错误 envelope；**`smoke.command` 未被执行**、`SMOKE_PASS`/`SMOKE_FAIL` 未产生、`smoke-report.md` 未生成、`smoke-results.jsonl` 无新增行 |
| UT-S19-43 | `[deploy]` 未全勾时 fail-closed 拒绝 | EX-19.6 | `DEPLOY_DONE` 在场（旁路写入），但 `tasks.md` 的 `[deploy]` section 仍有未勾条目 | 执行 `openlogos smoke` | 非零退出；错误码 `SMOKE_DEPLOY_TASKS_INCOMPLETE`；message 提示补齐 `[deploy]` 任务后执行 `openlogos deploy-done`；零副作用同 UT-S19-42 |
| UT-S19-44 | 判定顺序固定且只报第一个错误码 | §2.67.1 判定顺序 | 同时构造多项不满足（`smoke_required=false` + 部署决策冲突 + 缺 `DEPLOY_DONE` + `[deploy]` 未全勾） | 执行 `openlogos smoke` | 只输出 ① 对应的 `SMOKE_NOT_REQUIRED`；逐项去掉更靠前的不满足项后，依次得到 `SMOKE_DEPLOY_DECISION_CONFLICT` → `SMOKE_DEPLOY_NOT_DONE` → `SMOKE_DEPLOY_TASKS_INCOMPLETE`（顺序 ①→②→③→④ 命中即停） |
| UT-S19-45 | 0.14.25 候选发布的版本无关接线锚 | 0.14.25 候选发布需求 | 候选身份链已让位给 0.15.0 | 读取 runner 注册与回滚制品接线 | `scripts/run-smoke.js` 仍注册 0.14.25 的 SMOKE-core-196 runner；回滚制品 tripwire 在场。**版本身份断言（`LOCAL_RELEASE_CANDIDATE_VERSION` / `LOCAL_RELEASE_ROLLBACK_VERSION`）自 0.15.0 起由 UT-S19-46 承载**——按本文件既有惯例，旧候选锚退为版本无关的接线锚，避免每次发布都改写历史用例 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S19-20 | 缺标拒绝 → 补标后放行的全链闭环 | Step 1→10 | 真实 CLI；提案需部署需 smoke、`VERIFY_PASS` 在场、`deployment-report.md` 已生成、`[deploy]` 未勾且无 `DEPLOY_DONE` | ① `openlogos smoke` → ② `openlogos deploy-done` → ③ 再次 `openlogos smoke` | ① `SMOKE_DEPLOY_NOT_DONE` 拒绝、零副作用；② 落标成功（`[deploy]` 全勾、`DEPLOY_DONE` 在场）；③ 进入既有正常执行路径——sandbox 执行、runner/reporter 覆盖预检、gate 判定与 `gate.reason` 取值、skip 统计口径逐项与修复前一致 |
| ST-S19-21 | `--auto` 下前置门同样 fail-closed | Step 1、§2.67.1 两档模式 | 同 UT-S19-42 的缺标提案；以 `--auto` standing 授权驱动 smoke | 由 driver 在 `--auto` 下自动运行 `openlogos smoke` | 同样非零退出、`SMOKE_DEPLOY_NOT_DONE`、零副作用；`--auto` 放行的是「运行 smoke 这个动作」，不跳过前置门；`GATE_AUTO_PASSED` 审计行不构成对缺标状态的放行依据 |

### 追溯与覆盖

- AC-SMOKE-FC-01 缺 `DEPLOY_DONE` 拒绝且零副作用：UT-S19-42、ST-S19-20。
- AC-SMOKE-FC-02 `[deploy]` 未全勾拒绝：UT-S19-43。
- AC-SMOKE-FC-03 判定顺序与错误码确定性：UT-S19-44。
- AC-SMOKE-FC-04 前置满足放行零回归：ST-S19-20 步骤③。
- AC-SMOKE-FC-05 `--auto` 不跳过前置门：ST-S19-21。
- AC-RELEASE-0.14.25 候选身份：UT-S19-45；安装态行为由 SMOKE-core-196 取证。
- 场景：S19「smoke 前置依赖 deploy-done」§前置校验的可验收契约、S19 OpenLogos 0.14.25 生命周期 fail-closed 候选发布时序；功能规格：§2.67.1、§2.67.5。

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S19"`；失败不得写 pass。
- 零副作用断言必须以**磁盘事实**取证（marker 文件不存在、报告文件不存在、JSONL 行数未变），不得只断言退出码。

