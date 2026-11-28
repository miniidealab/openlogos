## MODIFIED — 异常：共享验收配置被修改时回落全量（review F2）
- **GIVEN** 模块范围已启用，提案修改了 `logos/logos.config.json` 或 `logos/logos-project.yaml` 中与验收相关的字段（或清单未列出的字段），或者这两个文件之一在提案起点或工作区中的内容无法严格解析
- **WHEN** 用户执行 `openlogos verify`
- **THEN** 回落全量，`fallback_reason.code` 为 `"shared_config_changed"`，`detail` 写明文件与变化的字段（无法解析时写明是哪一侧）
- 只改了与验收无关的字段时不回落。字段清单与完整规则见「S13 共享验收配置按字段判断与切片规划目标校验验收补充（verify-scope-fields-and-slice-module）」

## MODIFIED — AC-VERIFY-TIER-08：共享改动扩大到全量
- **GIVEN** 分别为：改动文件命中依赖清单等共享路径；或两个共享验收配置文件中与验收相关的字段有变化（按字段判断，AC-VERIFY-FIELD-07）；或声明写明涉及共享改动（只要这一项可读出即采信，即使声明的其余部分写了无法评估或有错）
- **WHEN** 执行 `openlogos verify`
- **THEN** 验收集合扩大到全量，JSON 与报告写明扩大原因

## ADDED — S13 共享验收配置按字段判断与切片规划目标校验验收补充（verify-scope-fields-and-slice-module）

> 来源：Team 需求池 openlogos #4、#7。修订「S13 按模块限定 verify 范围验收补充」中「共享验收配置被修改时回落全量」的判定粒度，并同步「verify 分层验收需求」的共享改动判定；补充切片规划（S32）对目标提案与模块的要求。

### 场景定义

- **触发条件**：
  - 多模块项目或开启分层验收的项目，提案期间 `logos/logos-project.yaml` 或 `logos/logos.config.json` 有了变化。0.16.27 及之前，只要这两个文件相对提案起点有任何差异，验收范围就回落全量。
  - 提案登记在非 `core` 模块，执行 `openlogos slice plan` 规划切片。
- **用户价值**：
  - 合并规格时写入的资源索引、场景清单、计数器，以及宿主写回的运行偏好，不再让整个提案期间的每次验收都跑全量。
  - 真正影响验收的配置变了，仍然回落全量，并说明是哪个文件的哪些字段。判断不了时多跑，不少跑。
  - 非 `core` 模块的提案可以正常使用多切片验收。
- **优先级**：P1
- **主路径**：verify 进入改动文件分类后，对这两个文件各自取提案起点与工作区中的内容，严格解析后逐个比较顶层字段；只有相关字段或清单未列出的字段有变化才回落。`slice plan` 先确认目标提案就是活跃提案，再用该提案的模块写出切片清单。

### 定义

| 文件 | 相关字段（变化即回落） | 无关字段（变化不回落） |
|---|---|---|
| `logos/logos-project.yaml` | `modules` | `project`、`tech_stack`、`scenario_counter`、`feature_counter`、`decision_counter`、`features`、`scenarios`、`release_workflows`、`deployment_gates`、`resource_index`、`conventions`、`baseline_index` |
| `logos/logos.config.json` | `verify`、`smoke`、`sourceRoots`、`guard` | `name`、`description`、`locale`、`aiTool`、`agents`、`driver`、`branch_sync`、`maxOpenTabs`、`modules`、`fileModules` |

- **未列出的字段**：两列都没有列出的顶层字段（例如 `logos.config.json` 的 `documents`、`flow`，以及今后新增的字段）按相关字段处理。
- **比较口径**：比较解析后的取值。键的顺序、空白、注释、引号写法不算变化；数组元素顺序算变化。
- **严格解析**：原文按 JSON / YAML 解析时没有任何语法错误（YAML 的重复键同样算错误）。
- **提案起点**：guard 中的 `baseRef`（与「S13 按模块限定 verify 范围验收补充」同一定义）。

### 验收条件

#### AC-VERIFY-FIELD-01：只改无关字段时不回落
- **GIVEN** 模块范围已启用，提案期间只有 `logos/logos-project.yaml` 的 `resource_index`（或其他无关字段）、`logos/logos.config.json` 的 `driver`（或其他无关字段）有变化
- **WHEN** 用户执行 `openlogos verify --format json`
- **THEN** 不因这两个文件回落；`scope.mode` 为 `"module"`，范围按其余依据照常计算；这两个文件不因为不属于任何模块的 `paths` 而被判 `unmapped_file`

#### AC-VERIFY-FIELD-02：改了相关字段时回落并写明字段
- **GIVEN** 模块范围已启用，提案期间 `logos/logos.config.json` 的 `verify` 与 `smoke` 有变化，或 `logos/logos-project.yaml` 的 `modules` 有变化
- **WHEN** 用户执行 `openlogos verify --format json`
- **THEN** 回落全量，`fallback_reason.code` 为 `"shared_config_changed"`，`detail` 写明文件与变化的字段，如 `logos/logos.config.json（verify、smoke）`

#### AC-VERIFY-FIELD-03：未列出的字段按相关处理
- **GIVEN** 模块范围已启用，提案期间 `logos/logos.config.json` 新增或修改了清单两列都没有列出的顶层字段
- **WHEN** 用户执行 `openlogos verify --format json`
- **THEN** 回落全量，`detail` 写明该字段

#### AC-VERIFY-FIELD-04：只调整写法不算变化
- **GIVEN** 模块范围已启用，提案期间只调整了相关字段的键顺序、空白、注释或引号写法，取值未变
- **WHEN** 用户执行 `openlogos verify --format json`
- **THEN** 不回落

#### AC-VERIFY-FIELD-05：进入比较后无法判断时回落
- **GIVEN** 某一范围机制已启用并已进入这两个文件的变化分类，且其中一个文件在提案起点或工作区中的原文不存在、读取失败、不能严格解析或顶层不是对象。包括：工作区 `logos/logos-project.yaml` 有语法错误，但仍能恢复出多个声明了 `paths` 的模块，模块范围因此照常启用
- **WHEN** 用户执行 `openlogos verify --format json`
- **THEN** 按整文件变化处理，回落全量；`detail` 写明文件、是哪一侧与原因

#### AC-VERIFY-FIELD-06：配置文件只在被比较时贡献原因，其余入口行为与原因不变
- **GIVEN** 分别为：
  1. 工作区没有 `logos/logos.config.json`；
  2. 工作区 `logos/logos.config.json` 无法解析；
  3. 工作区 `logos/logos-project.yaml` 缺失或解析不出模块；
  4. 某机制已启用，但没有取得改动文件集合（没有活跃提案、guard 缺 `baseRef`、`baseRef` 不可达、不是 git 仓库、差异计算失败、`paths` 非法）；
  5. 某机制已取得改动文件集合，但集合不包含某个配置文件（两侧都没有该文件，或两侧相同）
- **WHEN** 用户执行 `openlogos verify --format json`
- **THEN** 依次为：
  1. 以 `PROJECT_NOT_INITIALIZED` 退出，与 0.16.27 相同；
  2. 分层验收按未开启处理，输出中没有 `layers`；模块范围是否启用只看 `logos-project.yaml`，与本条无关；
  3. 模块范围未启用，输出中没有 `scope`；分层验收是否开启只看 `logos.config.json`，与本条无关；
  4. 按既有规则给出各自的原因（如 `base_ref_missing`、`base_ref_unavailable`），不读取这两个文件的内容，原因中没有由它们贡献的部分——即使工作区的这两个文件已经损坏；
  5. 该文件不做字段比较，不贡献任何原因或明细
- **统一的触发条件**：某个机制只在「已取得改动文件集合，且集合包含该配置文件」时才对该文件做字段比较，并按 AC-VERIFY-FIELD-02、03、05 贡献它自己的原因或明细。第 2、3 种情形下，另一个已启用的机制满足该条件时照常回落或扩大并点名该文件
- **不掩盖其他原因**：配置文件未被比较时，只是原因与 `detail` 中没有它；同一机制按其他规则给出的原因照常保留——命中 `verify.layered.shared_paths` 的其他文件（如依赖锁文件）、提案声明的共享标志、声明缺失、归不到模块的文件等。例：分层已开启，提案起点与工作区都没有 `logos/logos-project.yaml`，`logos/logos.config.json` 两侧相同，提案只改了 `package-lock.json` → 扩大到全量，`shared_path_changed` 的 `detail` 含该锁文件，不含这两个配置文件

#### AC-VERIFY-FIELD-07：分层验收使用同一判断
- **GIVEN** 分层验收已开启，提案期间这两个文件有变化
- **WHEN** 用户执行 `openlogos verify --format json`
- **THEN** 只改无关字段时验收集合保持收窄；改了相关字段、未列出的字段，或进入比较后无法判断时，扩大到全量，原因 `shared_path_changed`，`detail` 写明文件与字段。项目在 `verify.layered.shared_paths` 中显式列出这两个文件之一时，该文件按路径命中处理（任何差异都扩大）

#### AC-VERIFY-FIELD-08：切片规划使用提案的模块
- **GIVEN** 多模块项目，活跃提案登记在非 `core` 模块，规格已合并，`tasks.md` 有两个带用例 ID 的切片
- **WHEN** 用户执行 `openlogos slice plan`，随后执行 `openlogos verify --format json`
- **THEN** 写出的切片清单 `module` 等于该提案的模块；verify 不报 `test-slice-manifest-invalid`，进入第一个切片的 checkpoint。写入与读取对 guard 的 `module` 使用同一取值规则（去掉首尾空白，缺失或空白时为 `core`）

#### AC-VERIFY-FIELD-09：目标不是活跃提案时拒绝规划
- **GIVEN** guard 指向提案 A（或没有 guard），用户执行 `openlogos slice plan --slug B`
- **WHEN** 命令执行
- **THEN** 以 `SLICE_PLAN_NO_ACTIVE_CHANGE` 失败，退出码 1；提案 B 的 `tasks.md` 与切片清单保持原内容

#### AC-VERIFY-FIELD-10：core 模块提案与旧 guard 不受影响
- **GIVEN** 活跃提案登记在 `core`；或 guard 指向该提案但没有 `module` 字段（旧版 CLI 创建）
- **WHEN** 用户执行 `openlogos slice plan`
- **THEN** 清单 `module` 为 `core`，写出的内容与 0.16.27 相同（`generated_at` 除外）

### 验收条件索引

| 编号 | 内容 |
|---|---|
| AC-VERIFY-FIELD-01 | 只改无关字段时不回落，也不判未归属文件 |
| AC-VERIFY-FIELD-02 | 改了相关字段时回落，原因写明文件与字段 |
| AC-VERIFY-FIELD-03 | 未列出的字段按相关处理 |
| AC-VERIFY-FIELD-04 | 键顺序、空白、注释、引号写法不算变化 |
| AC-VERIFY-FIELD-05 | 进入比较后任一侧无法严格解析时回落，含 YAML 有错但恢复出模块的情形 |
| AC-VERIFY-FIELD-06 | 配置文件只在「已取得改动集合且集合包含它」时被比较并贡献原因；机制未启用、起点不可用时入口行为与既有原因不变；不掩盖其他共享路径与声明产生的原因 |
| AC-VERIFY-FIELD-07 | 分层验收使用同一判断；`shared_paths` 显式列出时按路径命中 |
| AC-VERIFY-FIELD-08 | 切片清单的模块等于提案的模块 |
| AC-VERIFY-FIELD-09 | `--slug` 指向的不是活跃提案时拒绝，不改任何文件 |
| AC-VERIFY-FIELD-10 | core 模块提案与缺 `module` 的旧 guard 行为不变 |

### 非目标

- 不在顶层字段内部再细分（例如只看 `modules[].paths`）。
- 不提供让项目自行配置相关字段清单的配置项。
- 不新增原因代码与 JSON 字段；只把 `detail` 写细。
- 不调整回落全量之后其他门禁的判定。
- 不支持为非活跃提案规划切片。

### 追溯

- 功能规格：§2.96.3（含「2.96.3.1 共享验收配置按字段判断」）、§2.109.2、§2.109.7、§2.110
- 场景：`core-S13-verify-results.md`「S13 共享验收配置按字段判断」、`core-S32-slice-planning.md`「S32 切片规划的目标提案与模块」
- 测试：UT-S13-275～293、ST-S13-52～54、UT-S32-126～134；SMOKE-core-359～366
