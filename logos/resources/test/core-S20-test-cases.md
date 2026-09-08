# S20: 已有项目接入 OpenLogos — 测试用例


## 一、单元测试用例

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S20-01 | 读取 package.json 提取项目名 | adopt 逻辑 | 存在 package.json | 项目目录 | 返回 package.name |
| UT-S20-02 | 读取 Cargo.toml 提取项目名 | adopt 逻辑 | 存在 Cargo.toml，无 package.json | 项目目录 | 返回 package.name 字段值 |
| UT-S20-03 | 目录名兜底提取项目名 | adopt 逻辑 | 无任何项目清单文件 | 项目目录 | 返回目录名 |
| UT-S20-04 | 已初始化项目应拒绝重复接入 | adopt 逻辑 | 已存在 `logos/logos.config.json` | adopt | 返回错误 |
| UT-S20-05 | 生成 logos-project.yaml 含 bootstrap=adopted | adopt 逻辑 | 空 logos/ | adopt 配置 | yaml 中 modules[0].bootstrap = adopted |
| UT-S20-06 | 生成 logos-project.yaml 含 lifecycle=launched | adopt 逻辑 | 空 logos/ | adopt 配置 | yaml 中 modules[0].lifecycle = launched |
| UT-S20-07 | 可识别测试栈时写入 verify.pre_run_command | adopt 逻辑 | 存在 package.json / pytest / Go / Cargo 等可识别测试栈 | adopt | 写入可执行的全量测试命令 |
| UT-S20-08 | 无法推断测试命令时输出 TODO | adopt 逻辑 | 无任何可识别测试脚本或框架配置 | adopt | 保留 `verify.result_path`，并输出补齐提示 |
| UT-S20-09 | 历史 bootstrap=skipped 兼容为 adopted 接入模式 | 状态/次序逻辑 | 旧项目 `logos-project.yaml` 中存在 bootstrap=skipped | status / next / launch / detect | 按 adopted 接入模式处理，不回退为 initial |
| UT-S20-10 | adopt 保留已有 AGENTS.md / CLAUDE.md 用户内容 | adopt 逻辑 | 存量项目已有根指令文件且含用户内容 | adopt | 用户内容保留，OpenLogos managed block 追加或刷新 |
| UT-S20-11 | adopt 识别大小写变体 | adopt 逻辑 | 存量项目已有 `agents.md` / `claude.md` | adopt | 复用既有真实路径，不创建重复大小写入口 |

## 二、场景测试用例

### 2.1 主路径

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S20-01 | 已有项目完整接入 | Step 1→10 | 有 package.json，无 logos/ | 执行 adopt | 生成全部基础文件（含 Skills、插件模板、logos/spec/）；`logos/resources/reference/` 下包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；bootstrap=adopted，lifecycle=launched，并在可识别测试栈时写入 verify 预跑配置 |
| ST-S20-02 | 接入后 next 直接引导首个 change | S05 联动 | adopt 完成、无活跃提案、无未终结 journal | 执行 next | 主动作建议 `openlogos change <slug>`；不建议 `change add-baseline-docs`，baseline-seed 仅为显式可选旁路 |
| ST-S20-03 | 接入后 status 显示 Initial 基线已跳过 | S11 联动 | adopt 完成 | 执行 status | Initial 文档基线显示为「文档基线已跳过（存量项目接入）」，不报错 |
| ST-S20-04 | 接入后 launch 豁免 Initial 门禁 | S14 联动 | adopt 完成，bootstrap=adopted，Initial 文档为空 | 执行 launch | 不检查 Initial 文档，直接放行 |
| ST-S20-05 | adopt 后写入 verify 预跑配置 | Step 1→10 | 有 package.json 且可识别测试脚本 | 执行 adopt | 接入报告说明 verify 预跑配置已补齐 |
| ST-S20-06 | 历史 skipped 项目按接入模式输出 next/status | Step 1→10 | 旧项目已有 bootstrap=skipped、无活跃提案、无未终结 journal | 执行 next / status | next 与 adopted 一致直接建议 `openlogos change <slug>`，不产生 add-baseline-docs 分支；status 保持 Initial 豁免阶段显示 |
| ST-S20-07 | adopt 保留已有根指令文件 | Step 9 | 有 package.json，无 logos/，预置含用户内容的 `AGENTS.md` / `CLAUDE.md` | 执行 adopt | 用户内容仍存在；OpenLogos managed block 被追加或刷新 |
| ST-S20-08 | adopt 保护大小写变体 | Step 9 | 有 package.json，无 logos/，预置 `agents.md` / `claude.md` | 执行 adopt | 复用既有小写路径合并内容，不创建重复大小写入口 |

### 2.2 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S20-EX-01 | 已初始化项目拒绝重复接入 | EX-2.1 | 已存在 logos/logos.config.json | 执行 adopt | 退出并报错，不覆盖文件 |
| ST-S20-EX-02 | 无法推断测试命令时输出 TODO | EX-5.1 | 无任何可识别测试脚本或框架配置 | 执行 adopt | 接入成功，但输出 verify 预跑配置补齐提示 |

## 三、覆盖度校验

- [x] adopt 命令主路径：已覆盖（ST-S20-01）
- [x] Reference 默认子目录生成：已覆盖（ST-S20-01）
- [x] bootstrap=adopted 标记写入：已覆盖（UT-S20-05/06、ST-S20-01）
- [x] 历史 skipped 兼容且默认 direct-change：已覆盖（UT-S20-09、ST-S20-06）
- [x] verify 预跑配置写入：已覆盖（UT-S20-07、ST-S20-05）
- [x] 无法推断时输出 TODO：已覆盖（UT-S20-08、ST-S20-EX-02）
- [x] next 直接引导首个 change、不生成 add-baseline-docs 分支：已覆盖（ST-S20-02、ST-S20-06）
- [x] status Initial 基线已跳过显示：已覆盖（ST-S20-03）
- [x] launch 门禁豁免：已覆盖（ST-S20-04）
- [x] 重复接入异常：已覆盖（ST-S20-EX-01）
- [x] adopt 保留根指令文件用户配置：已覆盖（UT-S20-10、ST-S20-07）
- [x] adopt 大小写变体保护：已覆盖（UT-S20-11、ST-S20-08）

## 四、逆向建基线衔接补充用例（brownfield-adopter）

| 用例 ID | 名称 | 覆盖点 | 前置 | 输入 | 期望 |
|---|---|---|---|---|---|
| UT-S20-12 | adopt 写入 baseline_seed_state:required，但默认引导直接 change | adopt 逻辑 | 空 logos/ | 执行 adopt | `logos-project.yaml` 模块含枚举 `baseline_seed_state: required`（非布尔）；接入报告的主动作是 `openlogos change <slug>`，baseline-seed 仅为显式可选全库预扫 |
| UT-S20-13 | adopt 不启动 AI、不声称基线已建立 | adopt 逻辑 | 空 logos/ | 执行 adopt | 未调用 AI；接入报告不出现「基线已建立」；`logos/resources/` 无逆向产物；不把缺少 seed 写成 change 前置条件 |
| ST-S20-09 | adopt 能力缺失时降级不伪造且 change 可达 | S33 EX-4.1 联动 | CLI-only / 非交互 CI | 执行 adopt | 保持 `baseline_seed_state: required`，输出可复制的 `openlogos change <slug>` 主提示；可附显式 seed 说明，但不显示基线已建立、不要求先 seed |

> 说明：本补充衔接 S33 的**显式可选**种子扫描能力；S20 默认主路径是 adopt 后直接创建 change。S20 主用例 ID（ST-S20-01…08、UT-S20-01…11）全部保留，其中 ST-S20-02/06 已在第二节改写为 direct-change 预期。

## 五、adopt 后直接 change 测试（baseline-on-touch）

> 所有用例实现必须写入 OpenLogos reporter `logos/resources/verify/test-results.jsonl`。

### 5.1 单元测试

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S20-14 | adopt 完成主提示 | 新存量项目执行 adopt | 主动作是 `openlogos change <slug>`；seed 仅可选说明 |
| UT-S20-15 | required 不劫持 next | adopted + `baseline_seed_state: required` + 无提案 | next action 指向 change；不指向强制 baseline-seed |
| UT-S20-16 | 安全 partial 不劫持 next | adopted + partial/open run、无未终结 journal | 未提交 staging 不采信；change 仍可达；seed 重试为非阻断诊断 |
| UT-S20-18 | legacy 缺字段兼容 | adopted、缺 seed 字段 | helper 可派生兼容状态；默认 action 仍为 change，JSON shape 合法 |
| UT-S20-19 | 未终结 journal 恢复失败即隔离并继续 | adopted + journal=`prepared|committing`，故障注入使前滚/回滚失败 | **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留；在 resources/index/coverage 读取前停止，不输出 change 主动作 |

### 5.2 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S20-10 | 从 adopt 到首个 plan | 真实临时项目 adopt → next → change → 生成 proposal/tasks | 无 baseline-seed 步骤即可到 plan；proposal/tasks 结构完整可解析 |
| ST-S20-11 | 能力缺失降级 | CLI-only adopt，无 AI seed 能力 | 不伪造文档；给出可复制 change 命令；不把 required 当阻塞 |
| ST-S20-13 | safe partial 与半新事务分流 | 分别构造仅 staging 的 partial 与 rename 中断的未终结 journal，执行 next/change 入口 | 前者直接 change 且 staging 排除；后者恢复失败硬报 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留，读取哨兵未触发、无 proposal 写入 |

### 5.3 覆盖与兼容

- Initial phase 仍显示“已跳过（存量项目接入）”，launch 豁免不变。
- 既有 AI 指令文件合并、reference 目录、verify 预跑推断与重复初始化拒绝均保持。
- 不删除 seed 字段/命令，不触发数据迁移；只改变默认用户路径与消费优先级。

## S20 存量项目 ZCode 接入测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S20-20 | adopt 解析 zcode | 交互选择或非交互 `--ai-tool zcode` | 解析为 Registry id 并进入资产预检 |
| UT-S20-21 | AGENTS 安全合并 | 已有用户内容、无 marker 或完整 marker | 用户内容保留，OpenLogos 完整托管片段插入/替换 |
| UT-S20-22 | 保留 `.zcode/config.json` | 已有模型、权限和插件配置 | 文件字节不变，不在项目配置中安装 Hooks |
| UT-S20-23 | 保留非 OpenLogos 插件 | 存量 ZCode 插件集合 | 未知 identity 和文件均 preserved，不进入删除计划 |
| UT-S20-24 | 冲突预检无部分写入 | 同名不同 owner 或不完整 marker | 在首个提交前失败；logos 与 Adapter 目标均不创建 |
| UT-S20-25 | 配置持久化 | adopt 成功 | `aiTool=zcode`，module bootstrap=adopted、lifecycle=launched |
| UT-S20-26 | change 指引兼容 | ZCode adopt 报告与 status/next | 下一主动作仍为 change，不增加 ZCode seed 前置 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S20-14 | ZCode 完整 adopt | 在未初始化存量项目选择 zcode | logos/spec、配置、索引、ZCode 插件/指令/AGENTS/Hooks 完整生成，可直接创建 change |
| ST-S20-15 | 存量资产保护 | 预置 AGENTS、`.zcode/config.json`、用户插件后 adopt | 三类用户资产哈希不变；OpenLogos 资产独立安装并报告 preserved |
| ST-S20-16 | 冲突整体回滚 | 预置同名不同 owner，注入接入事务中途失败 | 非零退出；无半套 logos、配置或插件；不输出接入完成 |

### 自动化与证据要求

- fixture 必须同时覆盖用户 AGENTS 无 marker、完整 marker 和不完整 marker 三种状态。
- ST-S20-14 在 adopt 后实际执行 change 工作区创建的可达性断言，但不得把 ZCode 作为该命令的必要前置。
- 实现测试时必须内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，包含 `status`、`timestamp`、`duration_ms`、`scenario: "S20"`；失败含 `error`。
- ST-S20-16 必须以接入前后目录快照证明原子回滚。

## S20 存量项目 Qoder 安全接入测试

### 单元测试

| ID | 验证点 | 输入/前置 | 预期结果 |
|---|---|---|---|
| UT-S20-27 | adopt 解析 qoder | 交互选择/`--ai-tool qoder` | Registry 返回规范 id 并进入总资产预检 |
| UT-S20-28 | AGENTS 安全合并 | 用户内容 + 无/完整/残缺 marker | 无/完整安全追加或替换；残缺 blocked；用户原文保留 |
| UT-S20-29 | Qoder settings/记忆保留 | 预置 settings、用户级/本地 AGENTS、rules | 全部字节不变，不纳入 OpenLogos owner |
| UT-S20-30 | 非 OpenLogos plugin 保留 | 存量插件和未知组件 | 不同 identity/未知文件 preserved，不进入删除计划 |
| UT-S20-31 | 冲突预检无部分写入 | 同名不同 owner、非法 manifest、不可写目标 | 首个提交前失败；logos/配置/Adapter 目标均不创建 |
| UT-S20-32 | 配置持久化 | adopt 成功 | aiTool=qoder，bootstrap=adopted，lifecycle=launched |
| UT-S20-33 | change 指引兼容 | adopt 报告与 status/next | 下一主动作仍为 change，无 Qoder seed/IDE 前置 |

### 场景测试

| ID | 场景 | 操作序列 | 预期结果 |
|---|---|---|---|
| ST-S20-17 | Qoder 完整 adopt | 未初始化存量项目选择 qoder | logos/spec/配置/索引、plugin/AGENTS/Hooks 完整原子生成，可创建 change |
| ST-S20-18 | 多类用户资产保护 | 预置 AGENTS、AGENTS.local、rules、settings、用户 plugin 后 adopt | 全部用户资产 SHA-256 不变；OpenLogos plugin 独立安装并报告 preserved |
| ST-S20-19 | 冲突/中途失败回滚 | 预置同名不同 owner 并注入事务失败 | 非零退出；无半套 logos、配置或 plugin；不输出接入完成 |

### 自动化与证据要求

- fixture 覆盖根 AGENTS 无 marker、完整 marker、残缺/重复 marker，以及自定义 Qoder 用户资产。
- ST-S20-17 在 adopt 后验证 change 工作区创建可达性，但不得把 Qoder CLI 运行作为 change 命令的前置。
- 内嵌 OpenLogos reporter，将全部 ID 写入 `logos/resources/verify/test-results.jsonl`，含 `status`、`timestamp`、`duration_ms`、`scenario: "S20"`，失败含 `error`。
- ST-S20-18/19 以目录快照、owner 清单和 SHA-256 证明保护/回滚；reporter 写入失败使测试失败。

## WorkBuddy 存量项目接入测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S20-34 | adopt 参数与持久化 | `workbuddy` 解析并持久化规范 id，不写猜测别名 |
| UT-S20-35 | adopted + launched 一次规划 | 不先写 initial 再覆盖，资产内容匹配 launched lifecycle |
| UT-S20-36 | 项目指令合并 | 只维护完整 marker，marker 外内容逐字节保留，残缺 marker blocked |
| UT-S20-37 | settings 与用户插件保护 | 非 OpenLogos owner 全部 preserved，identity 冲突不覆盖 |
| UT-S20-38 | 原生记忆保护 | 不读取内容、不写入/清空/迁移，前后不透明证据一致 |
| UT-S20-39 | 总事务回滚 | logos/config/index/spec/插件任一步失败全部恢复，不留半套状态 |
| UT-S20-40 | 接入后 change 可达性 | 成功后 status/next/change 走既有方法论主路径，无 WorkBuddy 分叉 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S20-20 | 带既有资产的 `adopt --ai-tool workbuddy` | 插件与配置成功，项目指令、settings、用户插件和原生记忆保留 |
| ST-S20-21 | marker/identity/权限冲突 | 首个写入前阻断或总事务回滚，精确诊断，无伪造完成态 |
| ST-S20-22 | 接入后首个 change | 新 session 可发现插件，change 创建可达且 guard 按 proposal_step 生效 |

### 自动化与证据要求

- 隔离 fixture 必须预置项目指令、settings、不同 identity 插件、未知文件和原生记忆样本。
- 对成功与失败路径保存所有不可由 OpenLogos 拥有的资产前后哈希，并断言配置只含规范 id。
- 每个用例通过 OpenLogos reporter 追加 `test_id`、`scenario_id="S20"`、`status`、`duration_ms`、`evidence` 到结果账本。

## S20 读取门并发只读不假阳性测试（fix-baseline-readlock-reader-contention）

> 本节补充 S20 读取门（规则 11）的读锁重试回归；实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期输出 |
|---|---|---|---|---|
| UT-S20-41 | change/next 入口读取门在 reader 竞争下不假阳性 | adopted 临时项目，无 writer、无未终结 journal；注入可控时钟；夹具短暂持有模块锁并在预算内释放 | 执行经读取门的入口（如 `next` 与 change 前置读取路径） | 入口成功；不出现 `baseline_commit_in_progress`；恢复门四步与安全 partial 分流行为与无竞争时一致 |
| UT-S20-42 | writer 真持锁时读取门仍硬阻断 | 夹具模拟 seed commit 全程持锁并注入时钟超过总预算 | 执行同一读取门入口 | 非零 `baseline_commit_in_progress`，EX-11.1 分流语义零回退：不读取 resources/index、不输出 change 建议；error envelope 合同不变 |

### 自动化与证据要求

- 两用例复用 S33 的锁注入夹具，不得各自复制重试实现或直接操作锁文件内部格式。
- 用例结束必须断言无残留锁文件与 marker。

### 追溯与覆盖

- AC-READLOCK-01/03 读者不假阳性：UT-S20-41。
- AC-READLOCK-04/06 真冲突硬阻断：UT-S20-42。
- 场景：S20 读取门锁获取有界重试补充（规则 11、EX-11.1）；功能规格：§2.54；架构：§四.B。

## 存量项目 Cursor 接入与迁移测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S20-43 | adopt 解析 cursor 三件套能力 | capability 含 plugin/hooks 且 preToolUse=false；引导链路消费能力而非宿主名 |
| UT-S20-44 | 存量资产边界扫描 | 用户 rules/skills/hooks 非托管条目全部识别为 preserved，不进入写计划 |
| UT-S20-45 | 冲突预检 blocked | 同名非托管 Skills 目录或 hooks 条目身份冲突时首个写入前 blocked，报告精确路径 |
| UT-S20-46 | 迁移完成点 | Skills 部署成功后同次执行清理托管 .mdc；失败路径 .mdc 保留 |
| UT-S20-47 | 配置持久化后置 | 接入成功才持久化 aiTool；失败不留半套配置 |
| UT-S20-48 | 后续 change 可达性 | 接入后 next/change 引导链路与其他宿主一致（sessionStart 注入可用） |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S20-23 | `adopt --ai-tool cursor` 成功接入 | 三件套就位、托管 .mdc 迁移完成、用户资产哈希不变、首个 change 引导输出 |
| ST-S20-24 | 冲突接入 blocked | 预置冲突 fixture 后 adopt 非零退出、零写入、无伪造完成信息 |
| ST-S20-25 | 中途失败恢复 | 注入事务失败后无半套资产，重跑 adopt 可成功收敛 |

### 自动化与证据要求

- fixture 覆盖「历史 .mdc + 用户自有 rules + 用户 hooks 条目 + 既有项目指令」组合。
- 每个用例必须通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S20"`；失败不得写 pass。
