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
