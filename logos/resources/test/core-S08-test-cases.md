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

## S08 resource_index 结构化补录测试用例

> 覆盖 Step 5 补录步骤改为 YAML AST 写入后的三形态、幂等、守恒与原子性。**验收判据必须是「产物可被 CLI 捆绑的 YAML 解析器无异常解析」，不得以「产物包含某段字符串」代替**——既有 `ST-S18-01` 正是因为断言字符串包含、且 fixture 与 `init` 真实模板形态不一致，才长期放过本缺陷。
>
> 所有 fixture 的 `logos-project.yaml` 必须取自 `openlogos init` 真实模板产出（含 `resource_index: []` 与 `conventions:` 块），不得使用与模板形态不一致的手工简化文本。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S08-43 | 空 flow sequence 形态首次补录后可解析 | Step 5.5b 形态归一 | `logos-project.yaml` 取自 `init` 真实模板，`resource_index: []`，存在一份未收录的可识别文档 | 执行补录 | 产物经 CLI 捆绑解析器 `parse()` **无异常**；`resource_index` 为承载条目的 block sequence 且含该 path；`conventions` 等其它顶层键与注释守恒 |
| UT-S08-44 | 空 block 形态补录且既有条目守恒 | Step 5.5b 形态归一 | `resource_index:` 为空 block 且已含 ≥1 既有条目 | 执行补录 | 产物可解析；新条目追加在既有条目之后；既有条目的 path/desc 逐字节不变 |
| UT-S08-45 | 键缺失时创建键并追加 | Step 5.5b 形态归一 | `logos-project.yaml` 完全不含 `resource_index` 键 | 执行补录 | 产物可解析；新建 `resource_index` 键并承载条目；其它顶层键相对位置与注释不受影响 |
| UT-S08-46 | 补录幂等且无键序/注释漂移 | Step 5.3 幂等判定 | 已完成一次补录的项目 | 连续再执行两次补录 | 第二、三次为 no-op（added=0）；文件字节与首次补录后逐字节一致，不重复追加已收录 path |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S08-30 | Bug 复现路径三步闭环 | Step 5.1→5.9 | 全新 `openlogos init` 项目（`--locale zh`） | 放入 `logos/resources/prd/3-technical-plan/1-architecture/<any>.md` → 执行 `openlogos sync` → 读回 `logos-project.yaml` | sync 报告新增 1 条；读回内容经 `parse()` 无异常；`resource_index` 下含该 path 与推断出的 desc；**该用例即上游 Bug 报告的三步复现路径，必须逐步等价** |
| ST-S08-31 | 序列化自检失败时零副作用 | EX-S08-IDX-2 | 在序列化/写盘环节注入故障 | 执行 `openlogos sync` | 命令报错退出；`logos-project.yaml` 字节与执行前**逐字节相同**，不留半成品、不产生临时残留文件 |

### 追溯与覆盖

- AC-YAMLW-01 复现路径修复：UT-S08-43、ST-S08-30。
- AC-YAMLW-02 三形态与守恒：UT-S08-43～UT-S08-45。
- AC-YAMLW-03 幂等无漂移：UT-S08-46。
- AC-YAMLW-05 只读不改写 / 原子：ST-S08-31（写路径原子性；只读路径归 ST-S11-44）。
- 场景：S08 resource_index 结构化补录时序；架构：§三十八.1；安装态：SMOKE-core-169。

## S08 候选集合排除与描述推断锚定测试用例

> 覆盖候选集合的排除边界、路径判据的起始锚，以及 baseline-seed kind 与描述规则的对齐。
>
> **断言纪律**：`UT-S08-48` 必须**遍历全部规则**做「权威命中 / 同名嵌套不命中」的成对断言，不得只抽查其中一两条——本缺陷的成因正是 17 条规则**全部**缺起始锚，逐条覆盖才是有效的回归锁。`UT-S08-50` 必须从 `KIND_ENUM` 常量本身取值遍历，不得把 kind 名硬编码进测试——硬编码等于再造一次同源漂移。
>
> 测试实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S08-47 | `verify/` 只收顶层报告，子目录一律排除 | Step 5.4b～5.4c | fixture 的 `verify/` 下同时存在顶层 `acceptance-report.md` 与子目录文件（`baseline-seed-runs/<run>/staging/…/core-system-map.md`、`evidence/x.md`、`deployment-artifacts/y.md`） | 执行候选扫描 | 候选集合含顶层 `acceptance-report.md`；**不含**任何 `verify/` 子目录下的路径；其余扫描根（prd/test/spec 等）的候选集合与本变更前逐字相同 |
| UT-S08-48 | 每条规则「权威命中、同名嵌套不命中」 | Step 5.4e 判据锚定 | 取描述规则表中的每一条规则 | 对每条规则各构造一对路径：① 从项目根起的权威路径；② 把该权威路径整体内嵌在 `logos/resources/verify/baseline-seed-runs/<run>/resolved/` 之下的嵌套路径 | ① 推断出该规则的描述；② 推断结果为 `null`。**逐条规则成对断言，不得抽查** |
| UT-S08-49 | 场景实现目录非 `SXX-` 文档命中兜底规则 | Step 5.4d 兜底分支 | 路径 `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md`，以及同目录的 `core-dependency-map.md`、`core-entry-points.md` | 逐个推断描述 | 三者均返回非 `null` 且为场景实现语义；**不得**是「验收报告」语义；同目录既有 `SXX-` 文档的描述与本变更前逐字相同 |
| UT-S08-50 | `KIND_ENUM` 每个 kind 的规范产出路径均可识别 | 架构 §四十.3 对齐锚 | 从 `baseline-seed-txn` 的 `KIND_ENUM` 常量遍历取值（不硬编码 kind 名） | 为每个 kind 构造其规范产出路径并推断描述 | 全部返回非 `null`。新增 kind 而未补描述规则时该用例必须失败——这是防止两模块再次漂移的机器锚 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S08-32 | Bug 报告 #02 四步复现路径闭环 | Step 5.4a→5.9 | 全新 `openlogos init` 项目 | 放两份权威文档（`1-architecture/core-system-map.md`、`2-scenario-implementation/core-scenario-candidates.md`）→ 在 `verify/baseline-seed-runs/<run>/staging/` 下放同名陈旧快照 → 执行 `sync` → 读回索引 | 索引**恰含 2 条**权威条目、**0 条**快照条目；`core-scenario-candidates.md` 在列且描述为场景实现语义；产物仍可被 CLI 捆绑解析器解析。**该用例即上游 Bug 报告 #02 的复现路径，必须逐步等价** |
| ST-S08-33 | 既有条目守恒且 sync 幂等 | Step 5.4→5.9、EX-S08-IDX-4～6 | 索引中预置 3 条既有条目：1 条权威、1 条指向 `verify/` 子目录的历史快照、1 条指向已不存在文件的过期残留 | 连续执行 `sync` 两次 | 三条既有条目**逐字保留**——CLI 不删除任何条目（决策 C01）；快照路径不再被**新增**收录；两次 sync 后文件逐字节相同 |

### 追溯与覆盖

- AC-RIDX-01 候选范围排除：UT-S08-47、ST-S08-32。
- AC-RIDX-02 四步复现路径产出正确：ST-S08-32。
- AC-RIDX-03 判据锚定、嵌套不命中：UT-S08-48。
- AC-RIDX-04 场景目录兜底：UT-S08-49。
- AC-RIDX-05 kind 与规则对齐锚：UT-S08-50。
- AC-RIDX-06 既有条目不被改写：ST-S08-33。
- 场景：S08 候选集合排除与描述推断锚定时序；功能规格：§2.49；架构：§四十；安装态：SMOKE-core-171。

## Cursor 同步刷新与 .mdc 迁移测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S08-51 | sync 计划经 Registry 派生 | cursor 刷新计划仅由 capability 驱动，无宿主名条件分支；标量/数组/all 旧配置进入同一路径 |
| UT-S08-52 | 托管 .mdc 清理清单派生 | 清单 = OpenLogos Skill 名单 + openlogos-policy.mdc，逐文件精确匹配；用户自有 rules 不入清单 |
| UT-S08-53 | 迁移顺序不变量 | Skills 事务成功 → hooks 合并 → .mdc 清理；任一前序失败则清理不执行 |
| UT-S08-54 | hooks.json 幂等合并 | 第二次 sync 托管条目零 diff；用户条目与未知字段字节不变 |
| UT-S08-55 | 清理项缺失容错 | 清单中 .mdc 已被用户删除/改名时跳过并如实报告，不判失败 |
| UT-S08-56 | 失败回滚 | Skills 读回不一致或 hooks 解析失败时回滚、.mdc 保留、版本戳不变 |
| UT-S08-57 | 版本戳后置 | 仅全部 Adapter 成功后刷新 .openlogos-sync.json |
| UT-S08-58 | 其余宿主零漂移 | claude-code/opencode/codex/zcode/qoder/workbuddy 计划与输出结构回归一致 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-34 | 历史 cursor 项目首次升级 sync | 旧 .mdc 项目一次 sync 后 Skills 就位、托管 .mdc 清空、用户 rules 保留且逐项 preserved |
| ST-S08-35 | 重复 sync 幂等 | 第二次执行 unchanged 收敛、清理清单为空、hooks.json 与用户资产哈希不变 |
| ST-S08-36 | 中途失败回滚 | 注入 hooks.json 损坏后 sync 失败：零写入、.mdc 保留、版本戳不变、错误含精确路径 |

### 自动化与证据要求

- ST 需构造「历史 .mdc 布局 + 用户自有 rules + 用户自有 hooks 条目」的混合 fixture，保存前后哈希对照。
- 每个用例必须通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S08"`；失败不得写 pass。

## sync 托管 guard 资产测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S08-59 | 托管资产面纳入 guard | asset-manifest 含 guard-check 条目（版本化哈希）；sync 对缺失/哈希漂移的 guard-check 落盘刷新为随包字节；非 Claude 宿主项目不部署、不触碰 settings.json |
| UT-S08-60 | 存量项目补齐与迁移 | 无 guard-check、settings.json 仅 SessionStart（旧相对路径）的存量 fixture：sync 后 bin 在盘、PreToolUse 段补齐为 `$CLAUDE_PROJECT_DIR` 形态、SessionStart 条目同步升级；重复 sync 零变化 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-37 | 真实 CLI sync 端到端补齐 | 真实 `openlogos sync` 驱动存量项目 fixture：guard-check 落盘且哈希与随包一致、hook 注册齐备、用户自有 hooks 字节不变；再跑一次 sync settings.json 与 bin 均零变化 |

### 自动化与证据要求

- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S08"`；失败不得写 pass。

## S08 资产 manifest 与 sync stamp 对账测试用例

> 以下测试实现必须通过 OpenLogos reporter 上报；fixture 只使用一次性 HOME/prefix/cache，用户资产按 hash 检查且不读取私密正文。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S08-38 | asset manifest canonical hash 稳定 | S08 Step 2 | 同一权威 Skill/模板集合 | 两次不同目录构建 manifest | payload 与 SHA-256 逐字节一致，无时间戳入 hash |
| UT-S08-39 | Skill/模板改变要求版本或 cachebuster | 资产版本边界 | semver 不变、任一资产字节变化 | 构建验证 | 失败并指出 asset path、expected/actual hash |
| UT-S08-40 | sync stamp 新字段完整 | S08 Step 6 | 合法 manifest | 写 stamp | 含 cliVersion、syncedAt、planContractVersion、managedAssetsHash |
| UT-S08-41 | 过期 stamp 产生 producer 诊断 | EX-2.1 | stamp hash/contract 落后 | status/next 读取 | 提示 sync + 重开 session；只读命令仍可观察 |
| UT-S08-42 | 用户与项目 Skill 所有权不变 | EX-5.1 | 托管/用户/未知资产混合 | 两次 sync + fault injection | 仅托管资产变化；失败全回滚，用户/未知 hash 不变 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S08-28 | 候选包到项目 stamp 全链对账 | Step 1→6 | 隔离安装候选包 | sync、读回、重开 session、再 sync | manifest/插件/Skill/stamp hash 一致；第二次幂等 |
| ST-S08-29 | 同 semver 旧缓存与中途失败均 fail loud | EX-2.1、EX-5.1 | 预置旧 cache，注入提交/读回故障 | 执行 sync 与 producer dispatch | 旧缓存不复用；失败无部分提交，诊断可定位 |

### 追溯与覆盖

- S08-AC-Plan-01 资产可核验：UT-S08-38～UT-S08-40、ST-S08-28。
- S08-AC-Plan-02 过期/漂移可诊断：UT-S08-39、UT-S08-41、ST-S08-29。
- S08-AC-Plan-03 用户资产保护：UT-S08-42、ST-S08-28～ST-S08-29。

## S08 Windows 平台资产同步与钩子可移植性测试

> 覆盖架构文档「五十二、Windows 平台兼容约束」52.1、52.3、52.4、52.5、52.7；场景 S08「同步 AI 工具资产与资源索引」；来源变更 fix-windows-platform-compat。
>
> **夹具口径**：一律在一次性隔离项目内运行真实 `init` / `sync` 入口或其导出函数；「win32 路径形态」用例以 `path.win32` 构造输入或在 Windows CI job 中真实运行，不以字符串替换伪造结论。Python 探测三态（P-none / P-stub / P-real）定义与前置断言要求同 `core-S09-test-cases.md`「S09 guard 跨平台可移植性与输入 fail-closed 测试」夹具口径。Git 相关夹具使用真实 `git` 创建一次性仓库。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S08"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S08-61 | sync 戳临时文件名在反斜杠路径下合法 | 以 win32 路径形态调用 `writeSyncStamp`（Windows CI 真实运行；POSIX 上以 `path.win32` 驱动临时路径推导函数） | stamp 路径 `C:\p\logos\.openlogos-sync.json`，旧 stamp 不存在 | 推导出的临时文件与目标同目录、文件名为 `.openlogos-sync.json.tmp-<pid>`，不含 `:` 与 `\`；写入后 stamp 内容合法；**必红对照**：修复前实现推导出含 `C:` 的非法文件名 |
| UT-S08-62 | 托管 `.gitattributes` 块幂等写入并保留用户内容 | ① 无 `.gitattributes`；② 已有用户内容 `*.png binary`；③ 已含旧版托管块 | 运行 init / sync 两次 | ① 新建且仅含托管块；② 用户行字节不变、托管块追加一次；③ 托管块原地替换不重复；三者第二次运行零 diff；托管块对 `logos/**` 与托管钩子 / 运行时目录设 `-text` |
| UT-S08-63 | 存量 CRLF：仅换行被转换的哈希绑定文件写回 index 字节 | 真实 git 仓库：提交 LF 的测试规格 target（其 `after_sha256` 记录于 `SPEC_MERGED.test_change_set`）与原型 HTML（哈希记录于 provenance）；随后把工作区改写为该 blob 的 LF→CRLF 转换结果 | 运行 sync 的存量恢复 | 两文件工作区字节等于 index blob 原始字节；既有哈希复验通过；`git status` 对两路径无修改；sync 输出列出已恢复路径 |
| UT-S08-64 | 存量 CRLF：有本地修改的文件不动并逐路径报告 | 同上，但工作区在 CRLF 之外另改了一个单元格 | 运行 sync 的存量恢复 | 该文件字节保持不变（本地修改未被覆盖）；sync 输出点名该路径「需人工处理」；未重签哈希；未执行任何批量换行改写 |
| UT-S08-65 | 存量 CRLF：非 Git 仓库 / index 不可读只报告 | ① 删除 `.git` 的项目；② index 中无该路径 | 运行 sync 的存量恢复 | 均不写任何哈希绑定文件，逐路径报告；sync 不因此失败 |
| UT-S08-66 | 托管钩子脚本 CRLF 由随包字节恢复 | 托管 `.claude/openlogos/bin/guard-check`、`openlogos-phase` 被改写为 CRLF | 运行 sync | 两脚本与随包字节逐字节一致（LF）；与 asset-manifest 登记 hash 一致 |
| UT-S08-67 | Cursor skill 备份目录与目标同卷 | 记录 `renameSync` 的源与目标 | 触发需更新托管 skill 的 sync | 备份目录的父目录为目标所在目录（或其同级托管目录），不在 `os.tmpdir()` 下；更新成功后备份目录被清理；注入 fault 时回滚恢复原目录 |
| UT-S08-68 | ZCode / Qoder / WorkBuddy / Cursor 目录 rename 瞬时锁重试 | `platform='win32'` 注入；rename 包装层**只对**「把新托管目录 rename 到目标位置」这一安装 rename（按目标路径匹配）注入故障，备份 rename 与回滚恢复 rename 透传：① 前 2 次抛 `EPERM` 后透传；② 从首次调用起持续 `EPERM` 直到本次 sync 返回 | 对四个适配器各触发一次需替换托管目录的 sync | ① 四者均成功，重试次数恰为 2；② 重试至上限后抛出，回滚恢复原目录（字节与 sync 前一致）、备份目录被清理，sync 非零退出并点名目录；两者的重试判据均为 archive-watch 既有同一实现；递归删除调用均传入内置 `maxRetries` |
| UT-S08-72 | 适配器目录故障覆盖回滚阶段：如实报告、保留备份 | `platform='win32'` 注入；故障**从**安装 rename **开始**，作用于其后本进程内**全部**目录 rename（含回滚恢复 rename），持续 `EPERM` **直到**测试显式解除；以 Cursor 与 ZCode 各跑一次 | ① 触发 sync；② 检查目标与备份目录；③ 解除故障后重跑 sync | ① 非零退出，输出如实说明回滚未完成并点名备份目录位置；② 备份目录仍在且内容等于原托管目录（未被清理）；③ sync 成功，托管目录为新版本，残留备份被清理 |
| UT-S08-69 | init 的 Python 探测以执行成功为准 | P-none、P-stub、P-real 三态 | 调用 init 的 Python 检测 | P-none 与 P-stub 均判「不可用」并给出安装提示（P-stub 不得被判可用）；P-real 判可用且记录所选命令（`python3` / `python` / `py -3` 之一）；不使用 `command -v` 作为判据 |
| UT-S08-70 | openlogos-phase 与 Codex session-start 三态下正确注入 | 中文 locale 的 launched 项目、存在活跃提案；P-none、P-stub、P-real 三态 | 分别执行分发源 `plugin/bin/openlogos-phase` 与 `plugin-codex/session-start.sh` | 三态输出逐条相同：中文上下文、阶段与活跃提案字段非空；两脚本不含 `/dev/stdin` 字面量；**必红对照**：修复前实现在 P-stub 下输出英文且状态字段为空 |
| UT-S08-71 | Codex hook 显式 bash、OpenCode 在 win32 以 shell 调 CLI | ① init 生成 Codex `config.toml`；② 以 `platform='win32'` 注入调用 `plugin-opencode` 的 CLI 桥接（`template/openlogos.js` 与 `src/cli-bridge.js`），参数含空格与引号 | ① 读取 SessionStart hook command；② 记录 `spawn` 参数 | ① command 形如 `bash "<相对路径>/session-start.sh"`，POSIX 与 Windows 同一写法；② win32 下以 shell 方式调用且每个参数经引用、参数值原样到达 CLI；非 win32 仍为直接 `spawn("openlogos", args)` |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-38 | Windows 真实 init + sync 全流程 | S08 sync 主时序 | **Windows CI job**（windows-latest，真实 NTFS、真实 Node、真实 Git Bash）；一次性隔离目录；真实 CLI | ① 真实 `openlogos init`（Claude + Cursor 目标）；② 修改包内资产版本标识后真实 `openlogos sync`；③ 再次 `openlogos sync`；④ `openlogos status --format json` | ① ② 退出码 0，输出不含 `EINVAL` / `ENOENT` / `EXDEV`；`logos/.openlogos-sync.json` 存在且与当前 manifest 一致；③ 零 diff；④ `managed_assets` 不为 `missing` / `stale` |
| ST-S08-39 | 存量 CRLF 工作区升级后恢复 | S08 sync + 52.4 存量恢复 | **Windows CI job**；真实 git：在 `core.autocrlf=false` 下提交 LF 的 launched 夹具（含 `SPEC_MERGED.test_change_set` 与原型 provenance）；随后以 `core.autocrlf=true` 另行 clone 得到 CRLF 工作区，并对其中一个规格文件做一处换行以外的未提交修改 | ① 在 CRLF clone 中真实 `openlogos sync`；② 读回各文件字节与 `git status`；③ 运行依赖 `test_change_set` 哈希的读取入口（如 `openlogos status --format json` 中的切片 / 测试变更集诊断） | ① 退出码 0，报告点名被保留的有本地修改文件；② 仅换行被转换的文件恢复为 index 字节、托管钩子为 LF；有本地修改的文件字节不变；③ 不再报 `test-slice-change-set-target-hash`（有本地修改的那一个除外，其诊断如实保留） |

### 追溯与覆盖

- 路径分隔符（52.1-2）：UT-S08-61、ST-S08-38。
- rename 重试与删除内置重试（52.3）：UT-S08-67、UT-S08-68；故障覆盖回滚阶段时保留备份：UT-S08-72。
- 换行保真预防与存量恢复（52.4）：UT-S08-62～UT-S08-66、ST-S08-39。
- Python 探测、`readFileSync(0)`、`.cmd` 调用、bash 显式调用（52.5）：UT-S08-69～UT-S08-71。
- 来源变更 fix-windows-platform-compat。

### 自动化与证据要求

- 依赖 Python 探测的用例必须先记录并断言所处 PATH 条件，条件不成立判 FAIL 而非 skip。
- ST-S08-38、ST-S08-39 属 Windows 回归集，必须在 CI `windows-latest` 阻断 job 中运行；POSIX 结果不计入其覆盖。
- UT-S08-63～UT-S08-65 必须用真实 `git` 仓库与真实 index，不得以手写 blob 代替。
- 夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等。

## sync 托管区块重渲染与事后检查接线测试用例

> 覆盖场景 S08「S08 .gitignore 托管区块按配置重渲染时序」「S08 sync 事后检查 hook 注册与 guard 引擎分发时序」；来源变更 guard-versioned-content-scope（决策 C02、C06、C11、C12、C13、C14）。独立 `openlogos sync` 调用不被事后检查误报（C13）属于 guard 判定行为，由 `core-S09-test-cases.md` 覆盖，本节不重复。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S08-73 | 托管区块按配置重渲染且幂等 | ① 存量项目 `.gitignore` 无区块、配置无 `guard.unversioned` → 末尾追加仅含说明注释与 `logos/.openlogos-runtime/` 的区块（前补空行）；② 配置 `guard.unversioned=["dist/","*.log"]` → 区块按配置顺序含两条；③ 区块内部被手工改动（删行、加行）→ 恢复为配置描述的内容；④ 区块外含 CRLF 行尾与用户规则 → 区块外字节不变、区块使用 CRLF；⑤ 无 `.gitignore` → 新建仅含区块的文件；⑥ 配置未变时第二次 sync → `.gitignore` 字节与 mtime 不变；区块内容与 `openlogos ignore` 渲染结果逐字节相同；sync 不改写 `guard.unversioned` / `guard.exempt` |
| UT-S08-74 | 区块损坏 fail loud 但不阻断其他同步 | ① `.gitignore` 含两个起始标记；② 只有起始标记；③ 配置 `guard.unversioned` 含以 `!` 开头的条目：三者 `.gitignore` 字节不变、stderr 点名路径（③点名条目）；同一次 sync 中 AGENTS.md / CLAUDE.md、托管资产、hook 注册、`.gitattributes` 照常更新，版本戳刷新；输出含「sync 部分完成：.gitignore 托管区块未更新」；退出码 1；修复后再次 sync 退出码 0 且区块写入 |
| UT-S08-75 | Claude PostToolUse / PostToolUseFailure / Stop 注册幂等 | 0.15.17 形态 settings.json（只有 PreToolUse + SessionStart）→ sync 后新增三条托管条目：PostToolUse matcher `Bash\|PowerShell\|BashOutput\|TaskOutput\|KillShell\|TaskStop`、PostToolUseFailure matcher `Bash\|PowerShell`、Stop 无 matcher，command 为 `node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" check`（Stop 附 `--stop`）；预置 matcher 与当前版本不一致（多出或缺少工具名）的托管条目被就地校正为当前 matcher；同一事件两条托管条目收敛为一条；用户自有 PostToolUse / Stop 条目字节与相对顺序不变；第二次 sync settings.json 零变化；无 SessionEnd 条目；非 Claude 宿主项目不触碰 settings.json |
| UT-S08-76 | 新 guard 与引擎随 manifest 分发 | asset-manifest 含 `guard-post-check.cjs` 条目（版本化哈希）且与 guard-check、openlogos-phase 同列；`.claude/openlogos/bin/guard-post-check.cjs` 缺失或被改动时 sync 以随包字节重写，guard-check 同理刷新为新版本字节；`managedAssetsHash` 随引擎变化；随包缺少引擎时 sync fail loud 点名资产路径、不注册指向缺失文件的 hook |
| UT-S08-77 | Cursor hooks.json 含 afterShellExecution 且合并幂等 | `CURSOR_HOOK_EVENTS` 含 `afterShellExecution`，模板 hooks.json 事件集合与之相等；只有三事件的存量 `.cursor/hooks.json` 经 sync 后含 `afterShellExecution` 托管条目（command `node .cursor/hooks/openlogos-runtime.cjs shell-after`）；用户自有 `afterShellExecution` 条目与未知字段字节不变；第二次 sync 零 diff；`.cursor/hooks/openlogos-guard-post.cjs` 与 `plugin/bin/guard-post-check.cjs` 字节一致；hooks.json 不可解析时零写入并回滚 |
| UT-S08-78 | Cursor 托管文案不再宣称 IDE preToolUse 硬拦 | 存量项目托管指令片段含旧文案「Cursor IDE 经同一 .cursor/hooks.json 获得完整 preToolUse 硬拦」→ sync 后托管片段与 `CURSOR_GUARD_STRENGTH_NOTICE_ZH` 均不含「完整 preToolUse 硬拦」/ `Full pre-edit blocking`，并声明文件编辑（IDE 与 CLI）为 `afterFileEdit` 事后报告、shell 为事前轻判 + `afterShellExecution` 事后检查；托管片段外用户内容不变 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-40 | 真实 sync 重渲染托管区块 | 真实 git 存量夹具（含用户规则的 `.gitignore`、配置 `guard.unversioned=["dist/"]`）执行真实 `openlogos sync`：`git check-ignore` 对 `dist/x` 与 `logos/.openlogos-runtime/x` 返回已忽略；区块外字节不变；再跑一次 sync `.gitignore` 零变化；随后人为破坏区块再 sync，退出码 1、`.gitignore` 字节不变、其他托管资产仍为新版本 |
| ST-S08-41 | 存量项目升级 sync 补齐事后检查接线 | 以 0.15.17 形态夹具（Claude + Cursor，含用户自有 hooks 条目）执行真实候选 CLI 的 `openlogos sync`：两份引擎副本在盘且哈希与 manifest 一致；settings.json 三条托管 hook 与 `.cursor/hooks.json` 四个托管事件齐备；Cursor 托管文案已更正；用户条目前后哈希一致；再次 sync 两份配置文件、引擎与 guard-check 字节零变化 |

### 自动化与证据要求

- 夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等；git 相关断言使用真实 `git`。
- ST-S08-41 使用固定候选 tarball 安装到隔离 prefix 后的真实 CLI 入口，记录 tarball SHA-256 与 CLI 入口类别。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S08"`，含 `test_id`、`status`、`duration_ms`、`evidence`；失败不得写 pass。

### 覆盖度校验

- [x] 重渲染托管区块幂等、区块外不动：UT-S08-73、ST-S08-40。
- [x] 区块损坏 fail loud 不阻断其他同步：UT-S08-74、ST-S08-40。
- [x] PostToolUse / PostToolUseFailure / Stop hook 注册幂等：UT-S08-75、ST-S08-41。
- [x] 新 guard 与引擎分发：UT-S08-76、ST-S08-41。
- [x] Cursor 部署后 `.cursor/hooks.json` 含 `afterShellExecution` 且合并幂等：UT-S08-77、ST-S08-41。
- [x] 托管文案不再宣称 IDE preToolUse 硬拦：UT-S08-78、ST-S08-41。

## sync 托管 Claude Code 回复语言设置测试用例

> 覆盖场景 S08「S08 sync 合并 Claude Code 项目回复语言设置时序」；来源变更 sync-claude-response-language（决策 C01、C02、C03）。init / adopt / launch 与 sync 共用 `deployAiToolAssets` → `deployClaudeCodePlugin(root, locale)` 链路，本节以 sync 入口为主、UT 直接驱动部署函数覆盖 init 新建分支。「宿主是否实际采用项目级 `language`」不在自动化范围内，按功能规格 §2.89.5 在发布确认时人工确认。

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S08-79 | 按 locale 写入与骨架创建 | ① `.claude/settings.json` 不存在、locale `zh` → 部署后文件含 SessionStart 托管条目与顶层 `"language": "chinese"`；② 同上 locale `en` → `"english"`；③ 存量合法 settings.json 无 `language`（含用户自有 PreToolUse 条目与 `permissions` 等其它顶层键）→ 写入映射值且为顶层末尾键，其它字段的值深度相等、用户 hook 条目相对顺序不变 |
| UT-S08-80 | 托管值按当前 locale 跟随 | ① 预置 `"language": "chinese"`、locale `en` → 更新为 `"english"`；② 预置 `"english"`、locale `zh` → 更新为 `"chinese"`；③ 预置值已等于当前映射值 → 不写盘（文件字节与 mtime 不变）；三种情况其它字段的值不变 |
| UT-S08-81 | 自定义值保留并提示 | 预置 `language` 分别为 `"japanese"`、`"Chinese"`、`123`、`null`：值逐一保持不变；每次输出恰好一行自定义值提示，zh 项目含「language 为自定义值」与 JSON 序列化后的值，en 项目含 `custom value`；同一轮托管 hooks 合并照常（缺失的 PreToolUse 条目被补齐）；退出码不受影响 |
| UT-S08-82 | 损坏 settings.json 原样保留 | ① 非法 JSON；② 合法 JSON 但顶层为数组：部署后 `.claude/settings.json` 字节不变、不抛错；同一次 sync 的 AGENTS.md / CLAUDE.md 与托管 bin 照常更新 |
| UT-S08-83 | 恒部署路径、幂等与作用边界 | ① `.claude/commands/openlogos/` 已有 `.md`（commands 幂等 skip 分支）的存量项目，sync 仍写入 `language`；② 自定义值提示在 skip 分支下照常输出；③ 写入后第二次 sync `.claude/settings.json` 字节不变；④ 预置 `.claude/settings.local.json` 含 `"language": "japanese"` → 该文件字节不变，项目 `.claude/settings.json` 仍按 locale 写入；⑤ aiTool 不含 `claude-code` 的项目 sync 后不存在 `.claude/settings.json`（或既有文件字节不变） |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S08-42 | zh 存量项目真实 sync 端到端 | 在一次性隔离项目内构造 `locale: zh`、aiTool 含 `claude-code` 的存量夹具，`.claude/settings.json` 含当前版本全部托管 hooks、用户自有 hook 条目与 `permissions` 顶层键、无 `language`；执行真实 `openlogos sync`：退出码 0，文件含 `"language": "chinese"`，其它字段的值与用户条目顺序与运行前一致；再跑一次 sync，`.claude/settings.json` 字节不变 |
| ST-S08-43 | locale 切换后 sync 跟随与自定义值保留 | 接 ST-S08-42 夹具：把 `logos/logos.config.json` 的 `locale` 改为 `en` 后执行真实 `openlogos sync` → `language` 变为 `"english"`；再把 `language` 手工改为 `"japanese"` 后执行 sync → 值保持 `"japanese"`、stdout 含一行 `custom value` 提示、退出码 0 |

### 自动化与证据要求

- 夹具一律在一次性隔离项目内构造，运行前后本仓项目根字节快照相等；不读写用户级 `~/.claude/settings.json`。
- ST 用例经真实 CLI 入口执行，记录 CLI 入口类别。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S08"`，含 `test_id`、`status`、`duration_ms`、`evidence`；失败不得写 pass。

### 覆盖度校验

- [x] 按 locale 写入（zh / en）与骨架创建：UT-S08-79、ST-S08-42。
- [x] 托管值随 locale 更新：UT-S08-80、ST-S08-43。
- [x] 自定义值保留并提示一行：UT-S08-81、ST-S08-43。
- [x] 损坏 JSON 原样保留：UT-S08-82。
- [x] 其它键值与用户条目顺序不变、重复运行幂等：UT-S08-79、UT-S08-83、ST-S08-42。
- [x] 不受 commands 幂等 skip 影响、不触碰 settings.local.json 与非 Claude 项目：UT-S08-83。
