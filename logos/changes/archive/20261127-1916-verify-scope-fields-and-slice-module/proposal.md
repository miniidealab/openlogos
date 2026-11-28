# 变更提案：verify-scope-fields-and-slice-module

> module: core | created: 2026-11-28

## 变更原因
来源：Team 需求池 openlogos #4（想法）与 #7（Bug）。两条互不依赖、改动文件不重叠，用户 2026-11-28 决定合成一个提案做。

### 问题一（#4）：两个配置文件只要有差异，验收范围就回落全量

- **现状**：`cli/src/lib/verify-scope.ts` 的 `SHARED_VERIFY_CONFIG_PATHS` 把 `logos/logos.config.json` 与 `logos/logos-project.yaml` 整个文件当作共享验收配置。相对提案起点（guard 的 `baseRef`）只要有任何差异，按模块限定范围（§2.96.3）就判 `shared_config_changed`、回落全量；0.16.27 的分层验收（§2.109.7）用同一份清单，判 `shared_path_changed`、扩大到全量。
- **为什么是问题**：这两个文件里大部分内容与验收无关，却几乎每个提案都会改到它们。
  - `logos-project.yaml` 的 `resource_index`、`scenarios`、各类计数器在合并规格时就会变化；
  - `logos.config.json` 的 `driver`、`branch_sync` 等是宿主写回的运行偏好。
  - 差异按「`baseRef` → 工作区」计算，提交之后差异仍在，整个提案期间每次验收都是全量。
- **现场**：
  - 2026-11-27，runlogos 提案 `fix-repair-verify-handoff-and-review-cap` 切片 1：`logos-project.yaml` 的 `resource_index` 新增两条索引 → 回落全量 → 执行 1418 条用例 → 切片验收判 `result_ledger_inconsistent`（本片 8 条用例全部通过）。
  - 2026-11-26，RunLogos 写回 `logos.config.json` 的 `driver.review`，同样回落全量（原 RunLogos 需求 #30）。
- **对分层验收的影响**：项目开启 `verify.layered` 后，只要合并过规格（`logos-project.yaml` 必然变化），提案级验收就会扩大到全量，三层收窄实际不生效。

### 问题二（#7）：`slice plan` 把提案模块写死为 core

- **现状**：`cli/src/commands/slice.ts` 第 325、330、369 行，读取测试变更集、校验清单与写出 `TEST_SLICE_MANIFEST.json` 时，模块一律写 `'core'`。
- **规格怎么说**：`spec/test-slice-manifest.md` 规定清单的 `module`「等于活跃 guard module」。合并时写入 `SPEC_MERGED.test_change_set` 的模块取自 guard（`moduleFromGuard`），verify 读取切片状态时也用 guard 的模块比对。只有 `slice plan` 这一处没有照做。
- **现象**：提案登记在非 core 模块（例如 `backend`）时，`openlogos slice plan` 写出的清单 `module=core`，随后 `openlogos verify` 报 `test-slice-manifest-invalid`（`$.module`：`core` 与 `backend` 不一致），验收暂停。
- **复现**：多模块项目，提案登记在 `backend`，`tasks.md` 有两个带用例 ID 的切片，执行 `openlogos slice plan` 后执行 `openlogos verify --format json`。
- **发现于**：`layered-verification` 切片 3 的多模块测试夹具，当时把提案登记到 core 名下绕开了。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：
  - **改动文件集合**（`resolveProposalChangedFiles`，§2.96.3）：按模块限定范围与分层验收已共用，继续复用，不新增差异计算入口。
  - **流程产物豁免**（`PATH_CLASSES_V1` 的 lifecycle 集合）：只能整文件豁免，两个配置文件里既有相关字段也有无关字段，用不上。
  - **`verify.layered.shared_paths`**：只能增减路径，不能表达「同一个文件里哪些字段算数」。
  - **YAML / JSON 解析**：`readProjectYaml` 与配置读取已有解析器（`yaml` 包、`JSON.parse`），复用，不引入新依赖。
  - **提案模块来源**：`moduleFromGuard`（合并时写入测试变更集用的同一个函数）已存在，`slice plan` 在确认目标提案即活跃提案之后调用它，不新建解析逻辑。
- 为什么不能更小：
  - 只修 `logos-project.yaml` 不修 `logos.config.json`：两个现场各占一个文件，只修一半另一半照旧回落。
  - 只修按模块限定范围、不修分层验收：两处读同一份清单，分开改会让同一次改动在两条规则下得出不同结论。
  - #7 只改写出清单的那一行：同一函数里校验清单与读取测试变更集的两处仍是 `'core'`，写出的清单会被自己的校验拒绝。
  - #7 只换模块来源、不核对 `--slug`：`slice plan --slug B` 而 guard 指向 A 时，`moduleFromGuard(root, B)` 会因提案名不符返回缺省 `core`，写出与校验用同一个错值，B 仍会得到一份模块错误的清单（proposal-r1 F2）。
- 本提案主动砍掉的：
  - **字段内部再细分**（如 `modules[].paths` 变了才算、`modules[].name` 变了不算）：只比较顶层字段。再往下分要逐个论证每个子字段是否影响验收，收益小、漏判风险大。
  - **让项目自己配置相关字段清单**：多一个配置项就多一处写错的可能，清单由 CLI 固定。
  - **新增原因代码**：沿用 `shared_config_changed` 与 `shared_path_changed`，只把 `detail` 写细，JSON 契约与 schema 的枚举不变。
  - **修复现场里的 `result_ledger_inconsistent`**：那是回落全量之后的连带结果，不再回落即不再触发；它本身的判定不在本提案内调整。
  - **其余写死 `'core'` 的位置**（`status`、`feature`、`sync` 等对缺 `module` 字段的旧数据取缺省值）：是读取旧数据的兼容缺省，不是把活跃提案的模块写错，不动。

## 变更类型
需求级（#4 修改一条既有验收场景的结论：共享验收配置被修改时不再一律回落全量，改为按字段判断，并贯穿功能规格、场景、CLI JSON 契约、测试用例、部署方案与 smoke；#7 是代码与既有规格不符的修复，只补测试用例，不改规则。不涉及 API / DB）

## 变更范围
> 与 `tasks.md` 的 `[delta]` 目标一一对应。

- 影响的需求文档：`logos/resources/prd/1-product-requirements/core-01-requirements.md`
  - 「S13 按模块限定 verify 范围验收补充」：修改「异常：共享验收配置被修改时回落全量」，新增「正常：只改了与验收无关的字段时不回落」；
  - 「verify 分层验收需求」：共享改动扩大到全量的验收场景同步改为按字段判断。
- 影响的功能规格：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
  - §2.96.3「范围 M 的计算」改动文件分类第 2 条；
  - §2.96 新增一小节「共享验收配置按字段判断」（两个文件的相关字段、无关字段、未列出字段的处理、比较口径、无法判断时的处理、`detail` 写法）；
  - §2.109.2 与 §2.109.7 中「两个配置文件恒按共享配置处理」的表述。
- 影响的技术架构：无（不新增组件与数据流；只是既有范围计算内部多读一次提案起点的文件内容）。
- 影响的业务场景：
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S13-verify-results.md`：按模块限定范围的 Step 8c 与「共享验收配置被修改」异常；分层验收的扩大步骤；
  - `logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S32-slice-planning.md`：新增异常「`--slug` 指向的不是活跃提案」；清单模块等于 guard 模块是既有规则，不改。
- 影响的根规范：
  - `spec/cli-json-output.md`：`scope.fallback_reason` 的 `shared_config_changed` 行与 `layers.expansion` 的 `shared_path_changed` 的 `detail` 说明；`slice plan` 错误码 `SLICE_PLAN_NO_ACTIVE_CHANGE` 的触发条件增加「`--slug` 指向的不是活跃提案」；
  - `spec/test-results.md`：分层验收扩大规则表中「改动命中共享配置」的说明；
  - `spec/test-slice-manifest.md`：写入前置条件——目标提案必须是活跃提案，模块解析一次、三处共用。
- 影响的测试用例：
  - `logos/resources/test/core-S13-test-cases.md`：新增一节（UT-S13-275 起、ST-S13-52 起）；修改既有 UT-S13-109、UT-S13-225、UT-S13-227 的前置与预期（它们断言「改了文件就回落」；其中 UT-S13-225 的第三组输入只改 `logos.config.json` 的 `description`，改为修改与验收相关的字段以保留正向覆盖，「只改 `description` 时分层保持收窄」由新增用例断言）；
  - `logos/resources/test/core-S32-test-cases.md`：新增一节（UT-S32-126 起），覆盖非 core 模块的切片规划与随后的验收，以及 `--slug` 指向非活跃提案时拒绝且两个产物不变。
- 影响的部署方案：`logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` 新增「OpenLogos 0.16.28 本机测试环境发布」。
- 影响的 smoke 用例：`logos/resources/test/smoke/core-smoke-test-cases.md` 新增 0.16.28 安装态 smoke（SMOKE-core-359 起）。
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无（CLI 项目，`skip_phases` 含 api / scenario）
- 影响的代码（merge 后由 slice-planner 划分，这里只列范围）：
  - `cli/src/lib/verify-scope.ts`（共享配置按字段判断，供按模块限定范围与分层验收共用）、`cli/src/lib/layered-verify.ts`（改用同一判断）；
  - `cli/src/commands/slice.ts`（目标提案与活跃 guard 的一致性校验、三处模块来源）；`cli/src/commands/verify.ts`、`cli/src/lib/verify-scope.ts` 与 `cli/src/lib/verify-skip-classification.ts` 中读取切片清单、测试变更集时的模块期望值改用同一取值规则（delta-r1 F2、delta-r2 F2）；
  - `cli/test/` 下对应测试与夹具（含把 `layered-verification` 夹具里绕开 #7 的写法改回）；
  - `scripts/` 下 0.16.28 的 smoke runner；升版 0.16.28 与 `CHANGELOG.md`。

## 部署影响
- 是否需要部署：是
- 部署原因：verify 与 slice 都是 CLI 产品代码，只有装进本机全局 CLI，RunLogos 等用全局 CLI 推进的多模块项目才能用上（两个现场都发生在 runlogos）；登记表配置了 `proposal_default_env: test`。升版到 0.16.28 以区分新旧安装态
- 影响环境：`test`（登记表 `proposal_default_env`，本机 npm 全局安装态）；不 npm publish、不打 tag、不 push
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」：脚本失败时自动回装回滚制品；成功落账后需要回滚时执行 `openlogos deploy --env test --rollback`，回滚目标以执行时 `openlogos env show test` 返回的 `previous_ref` 为准。写提案时观测到 test 的 `current_ref` 为 `42f75d2`（0.16.27），它只是规划时的观测值：如果本提案部署前 test 又有别的成功部署，回滚目标随之变化。部署脚本自身失败时，以本次回执记录的部署前安装态为准）
- 是否需要 smoke：是（安装态 smoke 在一次性项目中证明：
  - 安装态版本与部署回执一致；
  - 多模块项目只改两个配置文件里与验收无关的字段时，验收范围不回落；
  - 改了相关字段时回落全量，原因写明文件与字段；工作区配置有效、提案起点中的同一文件无法解析时同样回落并写明原因；工作区 `logos-project.yaml` 有语法错误但仍能恢复出模块时，模块范围回落全量并点名工作区的该文件；
  - 工作区的 `logos/logos.config.json` 被删除时，verify 仍按既有入口错误 `PROJECT_NOT_INITIALIZED` 退出，不产生回落原因；
  - 提案登记在非 core 模块时，`slice plan` 写出的清单模块与提案一致，随后的 verify 不再报清单无效；`--slug` 指向非活跃提案时命令拒绝。）

## UI/UX 变更声明

```yaml
ui_impact: false            # 本次是否触及界面（GUI 项目才有意义）
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: complete
impacts:
  data:
    status: none
    reason: 不改任何文件格式；切片清单、测试变更集、验收历史的结构与字段不变，不迁移、不改写既有数据
  compatibility:
    status: none
    reason: 升级后多模块项目与开启分层的项目回落全量的次数会减少，这正是需求 #4 提出的行为，没有需要用户另选的方案；无法判断时仍回落全量。原因代码、JSON 字段与 schema 枚举不变，只有 detail 文本写得更细。#7 是让实现符合既有规格，core 模块提案的产物逐字节不变
  security_privacy:
    status: none
    reason: 只读取提案起点提交中两个配置文件的内容用于比较，不写入、不外传；不改沙箱、权限与 guard 规则
  public_release:
    status: none
    reason: 只部署到本机 test 环境，不 npm publish、不打 tag、不 push
  external_commitment:
    status: none
    reason: 不新增、不删除、不改名任何命令、参数、JSON 字段或原因代码；slice plan 对「--slug 不是活跃提案」改为拒绝，沿用既有错误码，此前这种调用写出的清单本来就不被 verify 采信
decisions:
  - id: C01
    category: product
    source: user
    question: openlogos #4（配置文件按字段判断是否回落）与 #7（slice plan 模块写死）做成一个提案还是两个
    choice: 合成一个提案，分两个切片做
    reason: 用户 2026-11-28 原话「两个提案都不大,可以放到一个提案里面做吗?」，在看过合并的理由与代价后说「生成提案来做吧」
    scope: 本提案全部范围；归档后 openlogos #4 与 #7 一并关联
    rejected: 各立一个提案——每个都要单独走一轮升版、部署、冒烟、归档
  - id: C02
    category: deployment
    source: policy
    question: 本提案是否部署、部署到哪个环境、怎么部署、怎么回滚、以什么为 smoke 证据
    choice: 部署到 test（登记表 proposal_default_env）；部署方式为登记表 test.deploy（mode script，scripts/deploy-local.mjs），提案通道执行 openlogos deploy --env test；回滚按已合并部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」——脚本失败时以本次回执记录的部署前安装态为准，成功落账后显式回滚以执行时 env show test 的 previous_ref 为准（规划时观测到 test 的 current_ref 为 42f75d2，即 0.16.27，仅为观测值）；smoke 证据为 logos.config.json 的 smoke.command 经 openlogos smoke --env test 的实际运行结果
    reason: env list 的 proposal_default_env 为 test，test 的 deploy_mode 为 script、current_ref 为 42f75d2c8fe5；已合并部署方案有通用章节；CLI 产品代码有改动，需要装进全局才能被下游使用
    scope: "[deploy] 段、部署方案与 smoke 用例 delta、升版 0.16.28；不含 npm publish / tag / push"
    rejected: 不部署——两个现场都发生在用全局 CLI 的 runlogos，不部署就用不上
unresolved: []
defaults:
  - "判断口径：两个配置文件不再整文件算共享配置，改为比较顶层字段。取提案起点（guard baseRef）中的文件内容与工作区中的文件内容，各自解析后逐个顶层字段比较取值；键的顺序、空白、注释、引号写法不算变化，数组元素顺序算变化。只有「相关字段」或「未列出的字段」有变化才回落（按模块限定范围）或扩大到全量（分层验收）。"
  - "logos/logos-project.yaml：相关字段为 modules（模块清单、paths、生命周期等，决定模块范围与模块报告）。无关字段为 project、tech_stack、scenario_counter、feature_counter、decision_counter、features、scenarios、release_workflows、deployment_gates、resource_index、conventions、baseline_index。"
  - "logos/logos.config.json：相关字段为 verify、smoke、sourceRoots、guard。无关字段为 name、description、locale、aiTool、agents、driver、branch_sync、maxOpenTabs、modules、fileModules。其中 verify 与 smoke 是验收实际读取的字段；sourceRoots 与 guard 当前不被 verify 读取，按需求 #4 的原文列为相关（宁可多跑）。"
  - "未列出的顶层字段（含今后新增的字段、logos.config.json 的 documents 与 flow）一律按相关处理：清单漏更新时多跑，不会少跑。"
  - "适用前提：字段比较只发生在相应范围机制已启用、并且已经进入改动文件分类之后——按模块限定范围要求 §2.96.2 判定为启用（由工作区的 logos-project.yaml 得出多个模块且有模块声明 paths），分层验收要求工作区的 logos.config.json 可读且 verify.layered.enabled 为 true。两个机制各自判断是否启用，互不影响（delta-r1 F1）。对每个机制、每个文件，字段比较的唯一触发条件是「该机制已取得改动文件集合，且集合包含这个文件」（delta-r2 F1、delta-r3 F1）；成立时该文件只贡献自己的原因或明细，不成立时它不贡献任何原因，其余入口行为与原因照旧：工作区缺 logos/logos.config.json 时 verify 仍以 PROJECT_NOT_INITIALIZED 退出；工作区 logos.config.json 无法解析时分层按未开启处理、没有 layers；工作区 logos-project.yaml 缺失或解析不出模块时模块范围未启用、不输出 scope；起点不可用、差异计算失败等既有回落原因先于字段比较；文件两侧都没有或两侧相同时不比较。配置文件未被比较不掩盖同一机制的其他原因（如依赖锁文件命中 shared_paths、提案声明的共享标志）。"
  - "进入字段比较后无法判断时回落全量，按条件判定、不按情形枚举：某一范围机制已启用、并已进入某个文件的变化分类时，该文件任一侧（提案起点、工作区）的原文不存在、读取失败、不能严格解析或顶层不是对象，就按整文件变化处理。规则对两个文件、两个机制一视同仁。"
  - "严格解析：原文按 JSON / YAML 解析时没有任何语法错误（YAML 的重复键等同样算错误）。字段比较只使用严格解析的结果，不使用恢复解析的结果。既有的恢复解析（readProjectYaml 在 YAML 有错时尽量恢复出 modules，parse_status 为 recovered）继续只用于判断模块范围是否启用。因此工作区 logos-project.yaml 有语法错误但仍能恢复出多个带 paths 的模块时，模块范围照常启用并进入分类，该文件因不能严格解析而按整文件变化处理，回落全量（shared_config_changed），即使分层验收没有开启。"
  - "原因代码不变：按模块限定范围仍为 shared_config_changed，分层验收仍为 shared_path_changed。detail 写明文件与变化的字段，如「logos/logos.config.json（verify、smoke）」；无法判断时写明是哪一侧与原因，如「logos/logos-project.yaml（提案起点中的内容无法解析）」「logos/logos-project.yaml（工作区中的内容无法解析）」。只有无关字段变化时不产生该原因，范围照常计算。"
  - "项目在 verify.layered.shared_paths 中显式列出这两个文件之一时，按路径命中处理（整文件算共享改动）：项目自己写的配置优先。"
  - "按模块限定范围下，这两个文件在只有无关字段变化时不参与后续分类，不会因为不属于任何模块的 paths 而判 unmapped_file。"
  - "#7：slice plan 先确认目标提案就是活跃提案，再解析一次模块供三处共用。显式 --slug 与活跃 guard 的 activeChange 不一致（含没有 guard）时，以既有错误码 SLICE_PLAN_NO_ACTIVE_CHANGE 拒绝，退出码 1，tasks.md 与切片清单保持原内容；不传 --slug 时行为不变。确认一致后，模块按合并侧已有的取值规则（moduleFromGuard）取值：guard 的 module 去掉首尾空白后非空则取该值，缺该字段或为空白（旧版 CLI 创建）时为 core。读取测试变更集、校验清单、写出清单三处使用这同一个值；verify 一次运行中凡以活跃提案的模块为期望值读取切片清单或测试变更集的位置（切片状态派生、范围计算、门禁的严格跳过集合）也改用同一规则（此前直接用 guard 的原始字符串，module 带首尾空白时会与写入侧不一致，delta-r1 F2、delta-r2 F2）。core 模块提案写出的清单与修复前逐字节一致。"
  - "依据：spec/test-slice-manifest.md 规定清单的 change 与 module 均对应活跃 guard；合并写入测试变更集、verify 读取切片状态都只认活跃 guard。因此不为「给非活跃提案规划切片」另找模块来源（如读 proposal.md 头），而是拒绝。"
  - "新增编号：UT-S13-275、ST-S13-52、UT-S32-126、SMOKE-core-359 起；具体条数在 delta 中定稿。需求沿用「S13 按模块限定 verify 范围验收补充」既有编号体系。"
  - "不新增长期 DXX 决策记录：规则直接写入功能规格 §2.96。"
```

## 验收标准
- 自动验收环境要求：无（用例需要 git，夹具自建一次性仓库；本仓 verify 已依赖 git，不新增声明）
- 平台限定用例：无
- 需要人参与的验收：无

## 受影响场景

```yaml
schema: openlogos/affected-scenarios@1
assessment: assessed         # pending（未评估）| assessed（已逐个评估）| unknown（无法评估）
shared_change: false         # 本次是否涉及共享代码、配置或依赖
scenarios:                   # 每项 { id: "S13", reason: "<为什么受波及>" }
  - id: S13
    reason: 修改 verify-scope.ts 中共享验收配置的判定，按模块限定范围的回落与分层验收的扩大都经过它
  - id: S32
    reason: 修改 slice.ts 中切片清单与测试变更集的模块来源；切片 checkpoint 的验收范围读取同一份模块范围计算结果
```

## 变更概述
**#4：两个配置文件按字段判断。** verify 计算验收范围时，不再因为 `logos/logos.config.json` 或 `logos/logos-project.yaml` 有任何差异就回落全量，而是把提案起点与工作区中的内容各自解析后比较顶层字段。只有与验收相关的字段变了才回落，回落原因里写明是哪个文件的哪些字段。清单之外的字段、进入比较后解析不了的文件一律按相关处理，保持「宁可多跑、不少跑」；范围机制本身因工作区配置缺失或损坏而没有启用时，沿用既有的入口行为，不新增回落原因。按模块限定范围（§2.96）与分层验收（§2.109）共用同一个判断。

| 文件 | 变化即回落的字段 | 变化不回落的字段 |
|---|---|---|
| `logos/logos-project.yaml` | `modules` | `project`、`tech_stack`、`scenario_counter`、`feature_counter`、`decision_counter`、`features`、`scenarios`、`release_workflows`、`deployment_gates`、`resource_index`、`conventions`、`baseline_index` |
| `logos/logos.config.json` | `verify`、`smoke`、`sourceRoots`、`guard` | `name`、`description`、`locale`、`aiTool`、`agents`、`driver`、`branch_sync`、`maxOpenTabs`、`modules`、`fileModules` |

两列都没有列出的字段（例如 `documents`、`flow`，以及今后新增的字段）按「变化即回落」处理。

**#7：`slice plan` 使用提案的真实模块。** `openlogos slice plan` 读取测试变更集、校验清单、写出清单三处的模块，从写死的 `core` 改为 guard 中该提案的模块，与合并时写入测试变更集、verify 读取切片状态时用的是同一个来源。非 core 模块的多切片提案不再被 verify 判清单无效；core 模块提案的产物不变。`--slug` 指向的不是活跃提案时，命令拒绝执行、不改任何文件。

两项改动各为一个切片，文件不重叠。升版 0.16.28 并部署到本机 test 环境。
