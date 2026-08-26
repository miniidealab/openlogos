# S08: 同步 AI 工具资产与资源索引 — 测试用例


## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S08-01 | 同步项目名 | syncLogosProjectName | yaml 与 config 名称不一致 | sync | 修正名称 |
| UT-S08-02 | 补全 scenarios.module | syncScenariosModuleField | scenarios 缺失 module | sync | 回填 module |
| UT-S08-03 | 同步时补齐 verify.pre_run_command | sync 逻辑 | 已初始化项目缺少预跑配置但可识别测试栈 | sync | 写入全量测试命令 |
| UT-S08-04 | 同步时无法推断测试命令 | sync 逻辑 | 已初始化项目缺少预跑配置且无法识别测试栈 | sync | 输出 TODO，不写入伪造命令 |
| UT-S08-05 | sync 只替换 managed block | 根指令文件同步 | `AGENTS.md` / `CLAUDE.md` 含完整 marker 且 marker 外有用户内容 | sync | marker 内内容更新，marker 外内容不变 |
| UT-S08-06 | sync 无 marker 时追加托管片段 | 根指令文件同步 | 文件无 marker 且含用户内容 | sync | 保留原文并追加 OpenLogos managed block |
| UT-S08-07 | sync 幂等刷新托管片段 | 根指令文件同步 | 文件已有 OpenLogos managed block | 连续执行 sync 两次 | 不重复追加 managed block，用户内容仍保留 |

## 二、场景测试用例

### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-01 | 同步 AI 资产与索引 | Step 1→9 | 已初始化 | 执行 sync | 更新 AGENTS、CLAUDE 与 resource_index，并在可识别测试栈时补齐 verify 预跑配置 |
| ST-S08-02 | 旧项目缺失 verify 预跑配置时输出诊断 | Step 1→9 | 已初始化且缺少预跑配置 | 执行 sync | 输出 verify 预跑配置补齐结果或 TODO 诊断，不静默跳过 |
| ST-S08-03 | sync 保留根指令文件用户配置 | Step 7 | 已初始化，`AGENTS.md` / `CLAUDE.md` marker 外有用户内容 | 执行 sync | 用户内容仍存在；OpenLogos managed block 被刷新；没有重复 block |


## 三、覆盖度校验
- [x] 同步项目名：已覆盖（UT-S08-01）
- [x] 补全 scenarios.module：已覆盖（UT-S08-02）
- [x] 同步时补齐 verify 预跑配置：已覆盖（UT-S08-03）
- [x] 无法推断时输出 TODO：已覆盖（UT-S08-04）
- [x] sync 主路径：已覆盖（ST-S08-01）
- [x] sync 诊断路径：已覆盖（ST-S08-02）
- [x] sync 根指令文件合并：已覆盖（UT-S08-05 / UT-S08-06 / UT-S08-07 / ST-S08-03）

## 四、Codex / Claude Skill 命名空间同步测试补充

### 4.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S08-08 | sync 只刷新 marketplace 的 `openlogos` 条目 | Codex repo marketplace 同步 | `.agents/plugins/marketplace.json` 含 `openlogos` 与项目插件条目 | sync | 只更新 `openlogos` 条目；项目插件条目内容不变 |
| UT-S08-09 | sync 不把 `.agents/skills` 未知 skill 迁移到 OpenLogos 插件 | Codex Skill 归属判定 | `.agents/skills/release-guard/SKILL.md` 存在 | sync | 文件原样保留；`openlogos` 插件不新增 `release-guard` |
| UT-S08-10 | sync 可刷新 OpenLogos 官方 Codex skills | Codex 官方 skill 同步 | `openlogos` 插件内存在旧版 `prd-writer` | sync | 官方 skill 被刷新为当前模板 |
| UT-S08-11 | sync 保留 Claude `.claude/skills` 项目技能 | Claude Skill 边界 | `.claude/skills/release-guard/SKILL.md` 存在 | sync | 项目 skill 内容与路径不变；OpenLogos 官方插件不包含该 skill |
| UT-S08-12 | sync 输出项目 skill 命名空间诊断 | 同步结果输出 | 存在项目专属 Codex 或 Claude skill | sync | 输出中说明项目 skill 未进入 OpenLogos 命名空间 |

### 4.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-04 | sync 保留 Codex 项目插件并刷新 OpenLogos 插件 | Step 8→10 | 已初始化 Codex 项目，marketplace 含 `openlogos` 与 `adcn` | 执行 sync | `openlogos` 插件刷新；`adcn` 插件不被删除、改名或重排为 OpenLogos 插件 |
| ST-S08-05 | sync 保留历史 `.agents/skills` 项目 skill | Step 8→10 | 已初始化项目存在 `.agents/skills/release-guard/SKILL.md` | 执行 sync | 项目 skill 原样保留；生成说明不出现 `openlogos:release-guard` |
| ST-S08-06 | sync 保留 Claude 项目 skill 并刷新托管片段 | Step 7→10 | 已初始化 Claude 项目，`.claude/skills/release-guard/SKILL.md` 与 `CLAUDE.md` 均存在 | 执行 sync | `CLAUDE.md` managed block 刷新；项目 skill 原样保留且单独分组 |

### 4.3 覆盖度校验补充
- [x] Codex marketplace 项目插件保留：已覆盖（UT-S08-08 / ST-S08-04）
- [x] 历史 `.agents/skills` 项目 skill 不被吸收：已覆盖（UT-S08-09 / ST-S08-05）
- [x] OpenLogos 官方 Codex skills 可刷新：已覆盖（UT-S08-10）
- [x] Claude 项目 skill 保留：已覆盖（UT-S08-11 / ST-S08-06）
- [x] 同步输出命名空间诊断：已覆盖（UT-S08-12）

## 五、版本戳落盘（.openlogos-sync.json）测试补充

### 5.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S08-13 | 成功 sync 落盘版本戳 | sync 版本戳落盘 | 已初始化项目，`logos/.openlogos-sync.json` 不存在 | sync | 生成 `logos/.openlogos-sync.json`，`cliVersion` 等于当前 CLI VERSION，`syncedAt` 为合法 ISO 8601 时间戳 |
| UT-S08-14 | 失败路径不写/不刷新版本戳 | sync 版本戳落盘 | 模块 baseline 提交进行中（锁被占用且无法恢复），`logos/.openlogos-sync.json` 已含上一次成功 sync 的旧内容 | sync | 非零退出并报 `baseline_commit_in_progress`；版本戳文件内容与 sync 前逐字节一致（不刷新 `cliVersion` / `syncedAt`） |

### 5.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-07 | sync 后版本戳存在且幂等覆盖 | Step 1→11 | 已初始化 | 连续执行 sync 两次 | 每次成功 sync 后 `logos/.openlogos-sync.json` 均存在且为单一 JSON 对象（非追加）；`cliVersion` 等于当前 CLI VERSION；第二次 sync 整体覆盖写入，文件仍只含 `cliVersion` / `syncedAt` 两个字段 |

### 5.3 覆盖度校验补充
- [ ] 成功 sync 落盘版本戳：UT-S08-13
- [ ] 失败路径零写副作用：UT-S08-14
- [ ] 版本戳主路径与幂等覆盖：ST-S08-07

## S08 ZCode 同步、保留与版本戳测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S08-15 | 旧配置兼容 | 历史单值/数组不含 zcode | 只同步原宿主，不擅自加入 ZCode |
| UT-S08-16 | `all` 新展开 | 历史或当前配置为 all | Registry 展开结果包含 ZCode，既有宿主顺序兼容 |
| UT-S08-17 | managed/user 分区 | ZCode 目录混合托管与用户文件 | 只计划托管文件，用户文件标记 preserved |
| UT-S08-18 | 幂等差异 | 模板、locale、lifecycle 均未变化 | 第二次计划全部 unchanged，无时间戳外漂移 |
| UT-S08-19 | 失败不写版本戳 | 任一 Adapter 暂存或读回失败 | `.openlogos-sync.json` 保持旧值或不存在 |
| UT-S08-20 | 资产语法校验 | 非法 hooks JSON、manifest 或 Markdown frontmatter | 预检阻断且目标未被替换 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S08-16 | 两次同步幂等 | 对含 ZCode 的项目连续执行两次 sync | 首次按需 updated，第二次 ZCode 全部 unchanged；版本戳只在完整成功后刷新 |
| ST-S08-17 | 保留用户配置与插件 | 预置 `.zcode/config.json`、用户插件和托管目录内未知文件后 sync | 用户资产哈希不变，结果逐项 preserved；OpenLogos 托管资产正常刷新 |
| ST-S08-18 | 中途失败回滚 | 注入 ZCode rename/权限/读回失败后 sync | 整体非零退出；ZCode 事务回滚，最终版本戳不变，不输出完成文案 |

### 自动化与证据要求

- 旧配置 fixture 必须覆盖标量、数组、`all` 与未知值的明确错误路径。
- 幂等断言比较受管文件内容和用户文件哈希，不把合法 `syncedAt` 更新当资产漂移。
- 实现测试时必须内嵌 OpenLogos reporter，向 `logos/resources/verify/test-results.jsonl` 写入本节全部 ID；记录包含 `status`、`timestamp`、`duration_ms`、`scenario: "S08"`，失败含 `error`。
- ST-S08-18 必须保存版本戳和目标树前后快照作为回滚证据。

## S08 Qoder 同步、用户资产保护与回滚测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S08-21 | 历史配置兼容 | 标量/数组不含 qoder | 只同步原宿主，不擅自加入 Qoder |
| UT-S08-22 | all 包含 Qoder | aiTool=all | 稳定展开含 qoder，既有宿主相对顺序不变 |
| UT-S08-23 | managed/user 分区 | Qoder plugin 混合托管、settings、用户组件 | 只计划 OpenLogos owner；其它 preserved/blocked |
| UT-S08-24 | 幂等差异 | 模板、locale、lifecycle 未变 | 第二次所有 Qoder 托管资产 unchanged，无时间戳外漂移 |
| UT-S08-25 | 失败不写版本戳 | Qoder stage/rename/readback 注入失败 | 回滚且 `.openlogos-sync.json` 保持旧值或不存在 |
| UT-S08-26 | 资产语法与重复发现 | 非法 manifest/hooks/frontmatter 或重复组件声明 | 预检阻断，目标树与用户资产不变 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S08-19 | 两次 Qoder sync | 对 aiTool=qoder 项目连续 sync | 首次按差异更新；第二次托管资产 unchanged；版本戳只在完整成功后写入 |
| ST-S08-20 | settings/用户插件保留 | 预置 Qoder settings、不同 identity plugin、未知文件后 sync | 用户资产 SHA-256 不变并逐项 preserved；OpenLogos 资产正常刷新 |
| ST-S08-21 | 中途失败总回滚 | all 配置下对 Qoder 注入 rename/读回失败 | 命令非零；所有 Adapter 提交恢复，版本戳不变，不输出总成功 |

### 自动化与证据要求

- fixture 覆盖标量、数组、all、未知 id，验证未知值仍 fail loud。
- 幂等比较 manifest、组件、runtime、AGENTS managed block 与用户资产哈希，不把合法 syncedAt 当内容漂移。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，字段含 `status`、`timestamp`、`duration_ms`、`scenario: "S08"`，失败含 `error`。
- ST-S08-21 保存版本戳和所有 Adapter 目标树前后快照；reporter 写入失败使测试失败。

## WorkBuddy 同步测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S08-27 | 历史配置兼容 | 未选择 WorkBuddy 的单值/数组不自动部署，`all` 才包含它 |
| UT-S08-28 | lifecycle 模板选择 | initial/launched 选择正确且由 capability 驱动 |
| UT-S08-29 | 托管资产差异 | 只更新 OpenLogos owner；用户 settings、插件和未知文件 preserved |
| UT-S08-30 | 原生记忆零写入 | 记忆路径/内容不进入扫描、计划、暂存、备份或回滚集合 |
| UT-S08-31 | 失败回滚与版本戳 | 暂存、替换、权限或读回失败均回滚，版本戳保持旧值 |
| UT-S08-32 | 幂等与结果分类 | 第二次同步哈希稳定，结果正确区分 updated/unchanged/preserved/blocked |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-22 | WorkBuddy 托管插件升级 | 只刷新托管资产，成功后最后写 `.openlogos-sync.json` |
| ST-S08-23 | 混合宿主与用户资产 | 全部 Adapter 稳定执行；settings、用户插件和原生记忆字节不变 |
| ST-S08-24 | WorkBuddy 提交中途失败 | 已写资产全部恢复，不输出 Sync complete，不更新版本戳 |

### 自动化与证据要求

- 测试夹具必须包含未知插件文件、不同 identity 插件、settings 和不透明记忆样本，并对前后哈希作断言。
- 故障注入覆盖暂存、rename 和读回三个位置，证明事务和版本戳顺序。
- 每个用例通过 OpenLogos reporter 追加 `test_id`、`scenario_id="S08"`、`status`、`duration_ms`、`evidence` 到 `logos/resources/verify/test-results.jsonl`。

## TRAE non-deployable 同步负向测试

### 单元测试

| ID | 测试点 | 前置/输入 | 关键断言 |
|---|---|---|---|
| UT-S08-33 | `all` 同步排除 TRAE | 配置选择 `all` | 资产计划只含现有七宿主，不含 `.trae/**` 或 TRAE capability；顺序稳定 |
| UT-S08-34 | 历史配置零漂移 | 单值、数组与 `all` 的既有七宿主 fixtures | 规范值、目标路径、内容哈希、结果分类和版本戳语义与基线一致 |
| UT-S08-35 | 显式 TRAE 不产生计划 | 非法/手工配置含 `trae` | 在资产事务前返回不支持错误，不将其忽略、映射成 `other` 或提交部分同步 |
| UT-S08-36 | 用户 TRAE 资产排除 | 工作区预置 Rules、Skills、Agents、Hooks、MCP、settings 和不透明记忆 fixture | 所有路径均不进入扫描、写入、暂存、备份、删除或回滚集合 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-25 | `sync` + `all` 保持七宿主 | 现有七宿主按稳定顺序完成，同步版本戳最后提交；工作区不新增任何 TRAE 托管资产 |
| ST-S08-26 | 含 `trae` 的配置 fail loud | 总同步在首个目标写入前停止，不输出 Sync complete，不刷新版本戳；已有 `.trae/**` 和现有宿主资产字节不变 |

### 自动化与证据要求

- 测试从真实 Registry 和真实同步资产计划取证，不能用“没有模板文件”作为唯一排除证明。
- 隔离 fixture 须包含 `.trae/rules/`、`.trae/skills/`、`.trae/hooks.json`、settings、MCP 与不透明记忆样本；断言前后文件清单及 SHA-256 完全相同。
- 每个用例通过 OpenLogos reporter 写入 `test_id`、`scenario_id="S08"`、`status`、`duration_ms`、`evidence`；失败不得写 pass。

## TRAE 候选 tarball 安装态同步测试

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|---|---|---|---|---|---|
| UT-S08-37 | 本地负向 sync runner 的七宿主、严格失败与用户边界合同 | S08 候选 tarball 安装态同步时序 | 隔离 prefix 内为真实 `0.13.29` CLI；workspace 含七宿主基线和合成 TRAE fixture | `all` 配置、含 `trae` 的非法配置、入口逃逸、用户边界哈希变化等结果 fixture | `all` 精确稳定七宿主且版本戳最后写；非法配置在事务前失败；入口逃逸或任何 `.trae/**`/用户边界变化均返回失败诊断 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S08-27 | 真实 `0.13.29` tarball 的同步排除闭环 | 候选安装 → `all` sync → 严格配置失败 → 边界审计 | 候选 CLI realpath 位于一次性 prefix；fixture 预置 `.trae/**`、settings、账号占位、`enabled_folders`、MCP 和不透明记忆 | 记录前态；执行 `all` sync；记录七宿主结果/版本戳；在独立副本配置 `trae` 后 sync；比较全部目标与用户边界 | `all` 只提交七宿主且版本戳最后更新；含 `trae` 时首次事务前非零退出、无部分提交且版本戳不变；TRAE fixture 清单/SHA-256 始终不变；reporter 写入真实结果 |

### 自动化、证据与覆盖

- 测试必须通过真实 Registry、同步计划和安装态 CLI 取证；不得读取真实 TRAE 记忆正文或启动客户端。
- reporter 向 `logos/resources/verify/test-results.jsonl` 追加 `test_id`、`scenario_id="S08"`、`status`、`duration_ms`、候选 tarball SHA-256、逐宿主结果、版本戳与脱敏 evidence；失败不得写 pass。
- [x] `all`/sync 七宿主稳定性：UT-S08-37、ST-S08-27。
- [x] 配置含 TRAE 时事务前严格失败：UT-S08-37、ST-S08-27。
- [x] `.trae/**` 与用户边界不进入同步事务：UT-S08-37、ST-S08-27。
