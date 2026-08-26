# S01: 初始化 OpenLogos 项目 — 测试用例


## 一、单元测试用例
### 1.1 初始化前置校验
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-01 | 读取 package.json 项目名 | 初始化逻辑 | 存在 package.json | 项目目录 | 返回目录名或 package 名 |
| UT-S01-02 | 已安装项目应拒绝重复初始化 | 初始化逻辑 | 已存在 `logos/logos.config.json` | init | 返回错误 |
| UT-S01-03 | 可识别测试栈时写入 verify.pre_run_command | 初始化逻辑 | 存在可识别测试脚本或框架配置 | init | 写入可执行的全量测试预跑命令 |
| UT-S01-04 | 无法推断测试命令时输出 TODO | 初始化逻辑 | 无可识别测试脚本或框架配置 | init | 保留 `verify.result_path`，并输出补齐提示 |
| UT-S01-45 | 合并写入已有 AGENTS.md / CLAUDE.md | 根指令文件写入 helper | 目标文件存在且包含用户自定义内容，无 OpenLogos marker | init | 保留原内容并追加 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 托管片段 |
| UT-S01-46 | 已有完整 managed block 时只替换托管片段 | 根指令文件写入 helper | 文件含完整 OpenLogos marker，marker 外有用户内容 | init / init --ai-tool | marker 内内容更新，marker 外内容不变 |
| UT-S01-47 | 不完整 marker fail loud | 根指令文件写入 helper | 文件只含 begin 或只含 end marker | init | 返回错误，不覆盖文件 |
| UT-S01-48 | 大小写变体复用既有路径 | 根指令文件写入 helper | 存在 `agents.md` / `claude.md` 小写文件 | init | 复用既有真实路径合并内容，不创建重复大小写入口 |

## 二、场景测试用例

### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S01-01 | 全新项目初始化 | Step 1→9 | 空目录 | 执行 init | 生成全部基础文件；`logos/resources/reference/` 下包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；`AGENTS.md` / `CLAUDE.md` 包含 OpenLogos managed block |
| ST-S01-03 | 可识别测试栈时写入 verify 预跑配置 | Step 1→9 | 空目录且存在可识别测试脚本 | 执行 init | `logos.config.json` 写入 `verify.pre_run_command` 或等价全量测试命令 |
| ST-S01-04 | init 保留已有用户根指令文件 | Step 7→8 | 无 `logos/logos.config.json`，预置含用户内容的 `AGENTS.md` / `CLAUDE.md` | 执行 init | 用户内容仍存在；OpenLogos managed block 被追加；无整文件覆盖 |
| ST-S01-05 | init --ai-tool 保留用户根指令文件 | Step 7→8 | 已初始化项目，根指令文件 marker 外有用户内容 | 执行 `openlogos init --ai-tool codex` | 目标工具资产补齐；OpenLogos managed block 更新；用户内容仍存在 |


### 2.2 异常路径
| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S01-02 | 项目已初始化 | EX-2.1 | 存在 config | 再次 init | 退出并报错 |
| ST-S01-EX-adopt | logos/ 已存在时提示改用 adopt | EX-2.2 | 存在 logos/logos.config.json 且存在 package.json | 执行 init | 退出并报错；输出提示建议改用 openlogos adopt |
| ST-S01-EX-03 | 无法推断测试命令时输出 TODO | EX-5.1 | 无可识别测试脚本或框架配置 | 执行 init | 成功创建基础文件，但输出 verify 预跑配置补齐提示 |
| ST-S01-EX-04 | 不完整 managed block 阻止覆盖 | EX-8.1 | 预置只含 `OPENLOGOS:BEGIN` 的 `AGENTS.md` | 执行 init | 失败并提示修复 marker；原文件内容不变 |


## 三、覆盖度校验
- [x] init 主路径：已覆盖（ST-S01-01）
- [x] Reference 默认子目录生成：已覆盖（ST-S01-01）
- [x] 重复初始化拒绝：已覆盖（UT-S01-02 / ST-S01-02）
- [x] 可识别测试栈写入 verify 预跑配置：已覆盖（UT-S01-03 / ST-S01-03）
- [x] 无法推断时输出 TODO：已覆盖（UT-S01-04 / ST-S01-EX-03）
- [x] 用户根指令文件保留：已覆盖（UT-S01-45 / UT-S01-46 / ST-S01-04 / ST-S01-05）
- [x] 大小写变体保护：已覆盖（UT-S01-48）
- [x] 不完整 marker fail loud：已覆盖（UT-S01-47 / ST-S01-EX-04）

## 四、Codex / Claude Skill 命名空间边界测试补充

### 4.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-49 | Codex init 生成 repo marketplace 的 OpenLogos 插件命名空间 | Codex 插件初始化 | 空目录，选择 `--ai-tool codex` | init | 生成 `.agents/plugins/marketplace.json` 与 `openlogos` 插件条目；OpenLogos 官方 skill 位于 `openlogos` 插件内 |
| UT-S01-50 | Codex init 不吸收项目专属 `.agents/skills` | Codex Skill 归属判定 | 预置 `.agents/skills/release-guard/SKILL.md` | init | `release-guard` 不进入 `openlogos` 插件；无 `openlogos:release-guard` 描述 |
| UT-S01-51 | Codex init 兼容历史 `.codex-plugin` | Codex 兼容迁移 | 预置历史 `.codex-plugin/plugin.json` | init | 历史入口不被破坏；新 OpenLogos marketplace 资产生成或刷新；未知文件不被覆盖 |
| UT-S01-52 | Claude Code init 保留 `.claude/skills` 项目技能 | Claude Skill 边界 | 预置 `.claude/skills/release-guard/SKILL.md` | init | 项目技能原样保留；OpenLogos 官方插件不包含该 skill |
| UT-S01-53 | 生成指令分组展示 OpenLogos 与项目专属 Skills | 指令生成 | 同时存在 OpenLogos skill 与项目 skill | init | `AGENTS.md` / `CLAUDE.md` 将两类 skill 分组；项目 skill 不被描述为 OpenLogos 官方能力 |

### 4.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S01-06 | Codex 初始化生成 OpenLogos marketplace 且保留项目插件 | Step 8→11 | 空目录预置 `.agents/plugins/adcn/skills/release-guard/SKILL.md` | 执行 `openlogos init demo --ai-tool codex` | `openlogos` 插件生成；`adcn` 项目插件保留；marketplace 同时包含两类条目 |
| ST-S01-07 | Codex 初始化不把项目 skill 暴露成 OpenLogos skill | Step 8→11 | 空目录预置 `.agents/skills/release-guard/SKILL.md` | 执行 `openlogos init demo --ai-tool codex` | 输出诊断说明项目 skill 归属；生成资产中不存在 `openlogos:release-guard` |
| ST-S01-08 | Claude 初始化保留项目专属 `.claude/skills` | Step 8→11 | 空目录预置 `.claude/skills/release-guard/SKILL.md` | 执行 `openlogos init demo --ai-tool claude-code` | `.claude/skills/release-guard/SKILL.md` 内容不变；`CLAUDE.md` 分组说明项目 skill |

### 4.3 覆盖度校验补充
- [x] Codex repo marketplace 生成：已覆盖（UT-S01-49 / ST-S01-06）
- [x] Codex 项目 skill 不进入 OpenLogos 命名空间：已覆盖（UT-S01-50 / ST-S01-07）
- [x] 历史 `.codex-plugin` 兼容：已覆盖（UT-S01-51）
- [x] Claude `.claude/skills` 项目技能保留：已覆盖（UT-S01-52 / ST-S01-08）
- [x] 指令分组展示命名空间边界：已覆盖（UT-S01-53）

## S01 ZCode 初始化与 Adapter Registry 测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S01-100 | ZCode 参数解析 | `--ai-tool zcode` | 解析为稳定 id `zcode` 并写入配置 |
| UT-S01-101 | `all` 展开 | Registry 注册既有宿主与 ZCode | 结果包含 ZCode、无重复且顺序稳定 |
| UT-S01-102 | Registry 唯一性 | 重复 id、未知 id、合法 Adapter | 重复/未知显式报错；合法集合可枚举 |
| UT-S01-103 | 能力清单 | 读取 ZCode capability manifest | 声明 init/sync/launch/adopt、AGENTS、plugin、hooks |
| UT-S01-104 | 模板完整性 | 遍历随包 ZCode 模板 | manifest、Skills、Commands、Agents、hooks 与 runtime 均存在可解析 |
| UT-S01-105 | AGENTS 自包含 | 生成 ZCode 根指令片段 | 不依赖子目录 AGENTS、include 或 CLAUDE.md 运行时读取 |
| UT-S01-106 | owner 冲突保护 | 目标已有不同 owner 文件 | 初始化预检失败且不覆盖用户文件 |
| UT-S01-107 | 双语结果 | locale 分别为 zh/en | 安装、保留、冲突和新 session 提示均使用配置语言 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S01-15 | ZCode 完整初始化 | 对空项目执行 init 并选择 zcode | 配置、插件、指令、AGENTS 托管片段和 Hooks 一次性生成；模板来自 npm 包 |
| ST-S01-16 | `all` 初始化回归 | 选择 all，连续执行资产规划 | ZCode 与既有四宿主均部署；各宿主目标互不覆盖，第二次计划无语义差异 |
| ST-S01-17 | 冲突时整体回滚 | 预置用户同名插件/不完整 marker 后初始化 | 非零退出；logos、配置和全部 Adapter 目标保持执行前状态；报告精确冲突路径 |

### 自动化与证据要求

- UT/ST 均须自动化，不标记 `[manual]`。
- 测试必须从构建后包目录或 `npm pack --dry-run` 等价清单读取模板，避免只验证源码树。
- 实现测试时必须内嵌 OpenLogos reporter，将每个用例的 `id`、`status`、`duration_ms`、`timestamp`、`scenario: "S01"` 追加到 `logos/resources/verify/test-results.jsonl`；失败记录必须含 `error`。
- ST-S01-17 必须比较执行前后文件快照，不能只断言退出码。

## S01 Qoder 初始化、Registry 与随包资产测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S01-108 | qoder 参数解析 | `--ai-tool qoder` | 解析为规范 id 并持久化，不写 alias |
| UT-S01-109 | all 新展开 | Registry 含既有宿主和 Qoder | 结果稳定包含 qoder、排除 other、无重复 |
| UT-S01-110 | capability 合同 | 读取 Qoder Adapter | instructions/skills/commands/agents/plugin/sessionStart/preToolUse 全为 true |
| UT-S01-111 | 原生 manifest | 解析 `.qoder-plugin/plugin.json` | 路径正确、name 稳定、版本同源、JSON 合法 |
| UT-S01-112 | 约定组件完整性 | 遍历构建后 Qoder 模板 | Skills/Commands/Agents/Hooks/runtime 均存在且可解析，无重复声明 |
| UT-S01-113 | QODER_PLUGIN_ROOT 安全 | 模板路径含空格/元字符 | Hook command 仍将 runtime 作为单一路径解析 |
| UT-S01-114 | 用户 owner 冲突 | 同名不同 identity/未知文件/残缺 marker | 全量预检 blocked，任何目标不被覆盖 |
| UT-S01-115 | 双语逐资产反馈 | locale=zh/en，结果含各状态 | key/路径/ID 稳定，文案按 locale，新 session 提示存在 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S01-18 | Qoder 完整初始化 | 对空项目以 tarball CLI 执行 init qoder | 配置、AGENTS、manifest、Skills、Commands、Agents、Hooks/runtime 原子生成并读回一致 |
| ST-S01-19 | all 加法回归 | 选择 all 并连续执行两次资产规划 | Qoder 与既有五宿主均在稳定顺序；第二次计划无语义漂移 |
| ST-S01-20 | 冲突整体回滚 | 预置不同 identity plugin/残缺 marker 后初始化 | 非零退出；配置、logos、所有 Adapter 目标与用户哈希保持执行前状态 |

### 自动化与证据要求

- 全部 UT/ST 自动化，不允许 `[manual]`；模板断言必须读取构建后包或 `npm pack --dry-run` 等价清单。
- ST-S01-20 比较执行前后完整目录快照和用户文件 SHA-256，不能只断言退出码。
- 测试内嵌 OpenLogos reporter，将本节每个 ID 的 `id`、`status`、`duration_ms`、`timestamp`、`scenario: "S01"` 追加到 `logos/resources/verify/test-results.jsonl`；失败含 `error`。
- reporter 写入失败必须使对应测试失败，不能吞掉或延后补写。

## WorkBuddy 初始化测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S01-116 | `workbuddy` 参数解析 | 返回唯一规范 id，大小写策略与 Registry 一致，不接受虚构别名 |
| UT-S01-117 | `all` 稳定展开 | 在 Qoder 后包含 WorkBuddy，排除 `other`，无重复 |
| UT-S01-118 | capability 声明 | instructions/skills/commands/agents/plugin/sessionStart/preToolUse 均为 true |
| UT-S01-119 | 插件资产规划 | 精确包含 manifest、Skills、Commands、Agents、hooks.json、runtime |
| UT-S01-120 | 插件命令与协议静态校验 | 使用 `CODEBUDDY_PLUGIN_ROOT`，Hook 不写入 frontmatter，不重复注册 |
| UT-S01-121 | `0.13.28` tarball 清单 | 真实打包结果包含全部 WorkBuddy 模板与 runtime，版本同源 |
| UT-S01-122 | owner/marker 冲突预检 | 首个写入前 blocked，精确报告冲突路径，不覆盖用户资产 |
| UT-S01-123 | 原生记忆和用户资产排除 | settings、其它插件、未知文件、原生记忆均不进入 ManagedAsset 写计划 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S01-21 | `init --ai-tool workbuddy` 成功 | 配置、指令、完整插件原子落盘并读回；结果逐资产可审计 |
| ST-S01-22 | `init --ai-tool all` 与重复执行 | WorkBuddy 稳定包含；第二次收敛为 unchanged，既有宿主结果零漂移 |
| ST-S01-23 | 冲突/模板缺失失败 | 总事务回滚，无半初始化；用户 settings、插件和原生记忆前后证据一致 |

### 自动化与证据要求

- UT 必须从真实模板目录或真实 `npm pack --json` 结果取证，不得用手写清单冒充制品覆盖。
- ST 使用隔离临时 HOME/workspace，并保存配置、托管资产、用户资产和原生记忆边界的前后哈希。
- 每个用例必须通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，至少包含 `test_id`、`scenario_id="S01"`、`status`、`duration_ms`、`evidence`；失败不得写 pass。

## TRAE non-deployable 初始化负向测试

### 单元测试

| ID | 测试点 | 前置/输入 | 关键断言 |
|---|---|---|---|
| UT-S01-124 | Registry 排除 TRAE | 枚举全部 Adapter 规范值、别名和 capability | 不含 `trae`/TraeCode 占位；现有七宿主规范值与稳定顺序不变 |
| UT-S01-125 | `all` 稳定展开 | 解析 `--ai-tool all` | 只含 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy；排除 `other` 与 TRAE，无重复 |
| UT-S01-126 | 支持列表一致性 | 生成帮助、交互选项与结构化支持列表 | 三者均由 Registry 派生且不展示 TRAE；既有七宿主顺序一致 |
| UT-S01-127 | 显式 TRAE fail loud | 解析 `trae` 及大小写/猜测别名 | 返回未知/不支持错误与原始输入；不映射成 `other`，不产生资产计划 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S01-24 | `init --ai-tool trae` 被拒绝 | 首个目标写入前失败；配置、工作区与既有 `.trae/**` 哈希不变；错误列出真实支持值且说明 non-deployable |
| ST-S01-25 | `init --ai-tool all` 七宿主回归 | 只部署现有七宿主，目标顺序与历史 golden 一致；不创建 `.trae/**`、TRAE Agent/Rules/Skills/Hooks/MCP 或记忆资产 |

### 自动化与证据要求

- 测试必须枚举真实 `AiToolAdapterRegistry` 和真实 init 资产计划，不用手写支持数组代替断言。
- ST 使用隔离临时 HOME/workspace，并对配置、全部目标及预置 `.trae/owned-by-user.txt` 记录前后 SHA-256。
- 每个用例通过 OpenLogos reporter 向 `logos/resources/verify/test-results.jsonl` 追加 `test_id`、`scenario_id="S01"`、`status`、`duration_ms`、`evidence`；失败不得写 pass。
