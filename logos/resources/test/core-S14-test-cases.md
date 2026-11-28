# S14: 切换到 launched 生命周期 — 测试用例


## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S14-01 | 检查 deployment_required | launch 逻辑 | module 配置 | launch | 判断是否需要部署 |
| UT-S14-bootstrap-01 | bootstrap=adopted 时豁免 Initial 文档门禁 | launch 逻辑 | 模块 bootstrap=adopted（或历史 skipped），Initial 文档为空 | launch | 不检查 Initial 文档，直接通过 |
| UT-S14-bootstrap-02 | bootstrap=normal 时仍检查 Initial 文档门禁 | launch 逻辑 | 模块 bootstrap=normal（默认），Initial 文档为空 | launch | 拒绝并报错，提示 Initial 文档不完整 |
| UT-S14-02 | launch 刷新 AI 指令时保留用户内容 | launch 逻辑 | 根指令文件 marker 外有用户自定义内容 | launch | 托管片段更新为 launched 规则，用户内容不变 |
| UT-S14-03 | 指定模块不存在时报错退出 | EX-1.1 | 注册表无该模块 id | `launch <未知module>` | 输出 moduleNotFound 错误、非零退出，不改任何文件 |
| UT-S14-04 | 多模块未指定 --module 时报错退出 | EX-1.2 | 注册表 ≥2 模块，未带模块参数 | `launch` | 输出 multiModuleError（列出模块 id）、非零退出；0 模块则输出「无已注册模块」错误 |
| UT-S14-05 | 已 launched 模块幂等不重复推进 | EX-5.1 | 模块 lifecycle 已为 launched | `launch <module>` | normal：输出 moduleAlreadyLaunched、零码 no-op；adopted：幂等刷新资产、不改写 lifecycle |

## 二、场景测试用例

### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S14-01 | 标记 launched 生命周期 | Step 1→7 | verify PASS 且门禁满足 | launch | lifecycle 变更为 launched |
| ST-S14-bootstrap-01 | 存量项目接入模块 launch 豁免门禁 | Step 1→7（接入分支） | adopt 完成，bootstrap=adopted，Initial 文档为空 | 执行 launch | 成功，lifecycle=launched，无门禁错误 |
| ST-S14-bootstrap-02 | 历史 skipped 模块 launch 豁免门禁 | Step 1→7（接入分支） | 旧项目 bootstrap=skipped，Initial 文档为空 | 执行 launch | 成功，lifecycle=launched，无门禁错误 |
| ST-S14-03 | launch 保留根指令文件用户配置 | Step 6 | launch 前根指令文件已有用户内容 | 执行 launch | OpenLogos managed block 更新；用户内容仍存在 |
| ST-S14-04 | 已 launched 模块重复执行幂等收敛 | Step 1→5（幂等分支） | 模块 lifecycle 已为 launched | 再次执行 `launch <module>` | normal：提示已 launched 并 no-op 返回；adopted：幂等刷新托管片段与资产、lifecycle 不变、无语义漂移 |

## S14 Registry 驱动的 ZCode launch 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S14-06 | Registry 选择 ZCode | `aiTool=zcode`、`all`、不含 zcode 的旧配置 | 前两者选择一次 ZCode；旧配置不选择 |
| UT-S14-07 | launched 资产变体 | initial 模板与 launched 模板并存 | launch 计划只选择 launched Commands、Skills、Agents、AGENTS 与 Hooks |
| UT-S14-08 | adopted 幂等刷新 | adopted 模块已 launched，ZCode 资产新旧混合 | lifecycle 不改写，仅刷新托管差异，用户资产 preserved |
| UT-S14-09 | 既有宿主兼容 | 同一 fixtures 对比引入 Registry 前后 | Claude Code、OpenCode、Codex、Cursor 的计划与输出契约不变 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S14-19 | normal launch 刷新 ZCode | 满足 normal 门禁后 launch，再开启新 ZCode session | lifecycle=launched；插件与指令为 launched 变体；新 session 获取 launched 上下文 |
| ST-S14-20 | adopted 重复 launch | 对已 launched adopted 模块连续执行两次 launch | 两次均成功；第二次托管资产 unchanged，用户 AGENTS/配置/插件哈希不变 |

### 自动化与证据要求

- ST-S14-19 必须验证 lifecycle 的提交顺序：注入 ZCode 写入失败时 lifecycle 保持旧值。
- 既有宿主回归采用 golden 或结构化资产清单比较，不只检查命令零退出。
- 实现测试时必须内嵌 OpenLogos reporter，向 `logos/resources/verify/test-results.jsonl` 写入全部 ID，包含 `status`、`timestamp`、`duration_ms`、`scenario: "S14"`；失败含 `error`。
- 新 session 断言须明确配置/Hook 快照边界，不要求既有 session 热更新。

## S14 Registry 驱动的 Qoder launch 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S14-10 | Registry 选择 Qoder | qoder、all、历史不含 qoder | 前两者各选择一次 Qoder；历史配置不选择 |
| UT-S14-11 | launched 资产变体 | initial/launched 模板并存 | 只规划 launched AGENTS、Skills、Commands、Agents、Hooks/runtime |
| UT-S14-12 | adopted 幂等与提交顺序 | 已 launched 且资产新旧混合；注入 Qoder 失败 | 成功时只刷新差异；失败时 lifecycle 保持旧值并回滚 |
| UT-S14-13 | 既有宿主零漂移 | 同 fixtures 对比引入 Qoder 前后 | Claude Code、OpenCode、Codex、Cursor、ZCode 的计划/输出契约不变 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S14-21 | normal launch 刷新 Qoder | 满足门禁后 launch 并开新 Qoder CLI session | lifecycle=launched；插件/指令为 launched 变体；SessionStart 显示 launched |
| ST-S14-22 | adopted 重复 launch | 对已 launched adopted module 连续执行两次 | 第二次托管资产 unchanged；settings、用户 plugin、AGENTS marker 外哈希不变 |

### 自动化与证据要求

- ST-S14-21 注入 Qoder 提交/读回失败，证明 lifecycle 写入严格晚于全部 Adapter 成功。
- 既有宿主回归使用结构化资产清单或 golden，不只断言零退出。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，含 `status`、`timestamp`、`duration_ms`、`scenario: "S14"`，失败含 `error`。
- 新 session 只验证插件/静态上下文快照；PreToolUse 仍另行断言每次磁盘重读。

## WorkBuddy launched 刷新测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S14-14 | Registry 驱动 launched 计划 | 只有配置选择 WorkBuddy 时规划，命令无宿主名称分支 |
| UT-S14-15 | launched 资产范围 | 覆盖托管指令、Skills、Commands、Agents、Hooks，不包含用户资产或原生记忆 |
| UT-S14-16 | 提交顺序与失败回滚 | 全部 Adapter 读回后才提交 lifecycle；任一失败整体恢复 |
| UT-S14-17 | adopted 幂等与回归 | 重复刷新收敛为 unchanged；既有宿主计划、用户资产哈希不变 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S14-23 | adopted 模块 WorkBuddy launch | launched 插件原子刷新，lifecycle 最后提交，提示新 session |
| ST-S14-24 | 重复 launch 与故障注入 | 正常重复幂等；WorkBuddy 读回失败时所有宿主回滚、lifecycle 不变 |

### 自动化与证据要求

- 同时覆盖 normal 已 launched 的既有 no-op 与 adopted 已 launched 的幂等刷新，不得混淆两种语义。
- 保存 lifecycle、各 Adapter 托管资产、用户插件/settings/原生记忆的前后哈希。
- 每个用例通过 OpenLogos reporter 追加 `test_id`、`scenario_id="S14"`、`status`、`duration_ms`、`evidence` 到结果账本。

## Cursor launched 刷新测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S14-18 | launch 计划经 Registry 派生 | cursor launched 资产计划仅由 capability 驱动；launched 策略版指令/Skills 与 sync 版可区分 |
| UT-S14-19 | lifecycle 提交后置 | 任一 Adapter 失败则 lifecycle 不提交；成功后才提交 |
| UT-S14-20 | launched 幂等 | adopted + launched 重复执行零 diff，以 unchanged 收敛 |
| UT-S14-21 | 用户资产保留 | launch 刷新前后用户 rules/skills/hooks 条目与项目资产哈希不变；其余宿主行为回归一致 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S14-25 | launch 刷新 cursor launched 资产 | launched 指令、Skills、subagent、hooks 条目落盘读回成功，lifecycle 提交，新 session 提示输出 |
| ST-S14-26 | launch 中途失败 | 注入 cursor 资产失败后：回滚、lifecycle 不提交、错误含失败宿主与精确目标 |

### 自动化与证据要求

- ST 使用隔离 workspace 从 pre-launch 状态驱动真实 `launch` 代码路径，保存 lifecycle 状态与资产前后哈希。
- 每个用例必须通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S14"`；失败不得写 pass。

## S14 多模块 initial 模块 launch 前置测试（module-scoped-phase-reports）

> 覆盖场景 `core-S14-launch-lifecycle.md`「S14 多模块 initial 模块的 launch 前置」（EX-MR.1～EX-MR.3），功能规格 §2.99.3、§2.99.8，决策 C01。既有 S14 用例作为回归守护。测试实现必须写入 OpenLogos reporter（`logos/resources/verify/test-results.jsonl`），测试名包含对应 ID，`scenario_id="S14"`。
>
> **夹具 ML**：`mktemp -d` 一次性项目，`logos-project.yaml` 登记 `core`（launched）与 `team`（initial、`bootstrap: normal`，未声明 `deployment_required` / `smoke_required`，即需要部署与冒烟）；AI 资产写入使用测试替身，记录写入次数。报告样本按共用报告格式生成。**夹具 S1**：只登记 `core`（initial、normal）的单模块项目。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S14-22 | 验收按模块报告 Gate 行判定 | §2.99.8、EX-MR.1 | 夹具 ML；变体 ①：只有共用 `acceptance-report.md`（Gate PASS）；②：`team-acceptance-report.md` Gate FAIL；③：`team-acceptance-report.md` 无 Gate 行 | `openlogos launch team` | 三个变体都拒绝，退出码 1，错误信息点名 `logos/resources/verify/team-acceptance-report.md`；`logos-project.yaml` 中 team 仍为 initial，AI 资产写入次数为 0 |
| UT-S14-23 | 部署只认本模块部署报告 | §2.99.8、EX-MR.2 | 夹具 ML；`team-acceptance-report.md` Gate PASS；共用 `deployment-report.md` 与 `core-deployment-report.md` 存在，`team-deployment-report.md` 不存在 | `openlogos launch team` | 拒绝，错误信息点名 `team-deployment-report.md`；零写入 |
| UT-S14-24 | 错误信息中的 PASS 不算通过 | §2.99.3、EX-MR.3 | 夹具 ML；验收与部署模块报告满足判据；`team-smoke-report.md` 的 Gate 3.8 行为 FAIL，失败用例错误信息含 `expected PASS` | `openlogos launch team` | 以冒烟未通过拒绝，零写入 |
| UT-S14-25 | 不需要部署 / 冒烟时不检查对应模块报告 | §2.99.8 | 夹具 ML，team 声明 `deployment_required: false`；只有 `team-acceptance-report.md`（Gate PASS） | `openlogos launch team` | launch 成功，team 切为 launched；不检查部署与冒烟报告 |
| UT-S14-27 | 报告不属于本模块或不是合格文件时拒绝（delta-r1 F1、F2） | §2.99.3、EX-MR.4 | 夹具 ML；验收模块报告满足判据；变体 ①：`team-smoke-report.md` Gate PASS 但缺「模块」行；②：「模块」行为 `core`；③：`team-deployment-report.md` 位置是同名目录；④：`team-deployment-report.md` 为 0 字节文件 | `openlogos launch team` | 四个变体都拒绝，退出码 1，错误信息点名对应路径；零写入 |
| UT-S14-26 | 单模块项目判定不变 | §2.99.8 | 夹具 S1：只有共用报告（Gate PASS），无任何模块报告；变体：共用验收报告缺失 | `openlogos launch core` | 前者成功、后者以既有 `launch.verifyRequired` 拒绝；错误信息与退出码与修改前逐字节相同 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S14-27 | 多模块 initial 模块凭模块报告 launch 成功 | Step 1～6 | 真实 CLI；夹具 ML；三份 team 模块报告齐全（验收、冒烟 Gate PASS，部署报告存在）；另有 Gate FAIL 的共用 `acceptance-report.md` | ① `openlogos launch team`；② `openlogos status --format json` | ① 成功，team 的 lifecycle 为 launched，AI 资产按既有规则刷新；共用报告的 FAIL 不影响结论；② team 按 launched 模块展示，core 不变 |
| ST-S14-28 | 只有共用报告时拒绝 launch | Step 1～3 | 真实 CLI；夹具 ML；只有共用 `acceptance-report.md`、`deployment-report.md`、`smoke-report.md`（均 Gate PASS） | `openlogos launch team` | 退出码 1，错误信息点名 team 模块验收报告；`logos-project.yaml` 与 AI 资产字节不变 |

### 覆盖度校验

- 验收、部署、冒烟三类模块报告的取证：UT-S14-22、UT-S14-23、UT-S14-24、ST-S14-27、ST-S14-28。
- 只读 Gate 行：UT-S14-22 ③、UT-S14-24。
- 「模块」行与合格文件校验：UT-S14-27。
- 按需检查与单模块零回归：UT-S14-25、UT-S14-26。

## 主链路用例

> 主链路用例是「坏了就等于产品不可用」的核心流程用例（功能规格 §2.109.3）。分层验收开启时，每次提案级验收都执行它们，且不允许偶发。只读取下面的列表项；增删须经提案（enable-layered-verify 首次给出）。

- ST-S14-01 — 标记 launched 生命周期
