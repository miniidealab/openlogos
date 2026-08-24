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
| UT-S20-17 | seeded 仍执行闭包 | adopted + seeded | 首个 change 仍声明 on-touch-v1；seed 只作为 EvidenceScanner 输入 |
| UT-S20-18 | legacy 缺字段兼容 | adopted、缺 seed 字段 | helper 可派生兼容状态；默认 action 仍为 change，JSON shape 合法 |
| UT-S20-19 | 未终结 journal 恢复失败硬阻断 | adopted + journal=`prepared|committing`，故障注入使前滚/回滚失败 | `baseline_commit_in_progress`；在 resources/index/coverage 读取前停止，不输出 change 主动作 |

### 5.2 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S20-10 | 从 adopt 到首个 plan | 真实临时项目 adopt → next → change → 生成 proposal/tasks | 无 baseline-seed 步骤即可到 plan；闭包目标模式在场 |
| ST-S20-11 | 能力缺失降级 | CLI-only adopt，无 AI seed 能力 | 不伪造文档；给出可复制 change 命令；不把 required 当阻塞 |
| ST-S20-12 | adopted skip 与真实接口冲突 | fixture 自动 skip api，但首个 change 时序含 HTTP | plan 暴露冲突并规划 API/编排或 AMBIGUOUS；不得静默 SKIP |
| ST-S20-13 | safe partial 与半新事务分流 | 分别构造仅 staging 的 partial 与 rename 中断的未终结 journal，执行 next/change 入口 | 前者直接 change 且 staging 排除；后者恢复失败硬报 `baseline_commit_in_progress`，读取哨兵未触发、无 proposal 写入 |

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
