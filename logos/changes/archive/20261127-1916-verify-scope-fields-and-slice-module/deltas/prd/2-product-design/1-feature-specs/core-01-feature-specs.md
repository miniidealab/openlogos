## MODIFIED — 2.96.3 范围 M 的计算（C01）

M = 提案归属模块 ∪ delta 目标前缀模块 ∪ 改动文件归属模块。

- **提案归属模块**：与 change-lint 同源的提案模块解析（`resolveProposalModuleContext`）。没有活跃提案时回落全量（`no_active_change`）。
- **delta 目标前缀模块**：活跃提案 `deltas/**` 下每个 delta 文件名的 `<module>-` 前缀，按已登记模块 id 最长匹配。不带已登记模块前缀的 delta 不贡献模块，其合并目标的影响由改动文件分类判定。
- **改动文件集合**：guard 的 `baseRef` 到工作区的差异，包括已提交与未提交的改动（重命名取旧、新两个路径，删除取原路径），以及未跟踪且未被忽略的文件。被 `.gitignore` 忽略的文件不计。
- **改动文件分类**（review F2，不按 `logos/` 目录前缀整体跳过），按顺序取第一条成立的：
  1. **流程产物**不参与判定。复用既有路径契约 `PATH_CLASSES_V1`（`cli/src/lib/impact-classify.ts`）的 lifecycle 集合：`logos/.openlogos-guard`，以及 `logos/changes/`、`logos/resources/verify/`、`logos/.runtime/` 下的文件。提案目录中的 delta 已按目标前缀计入 M。
  2. **共享验收配置** `logos/logos.config.json`、`logos/logos-project.yaml`：按字段判断（§2.96.3.1）。相关字段或未列出的字段有变化、或无法判断 → 回落全量（`shared_config_changed`），因为它们决定测试命令与模块范围本身；只有无关字段变化 → 该文件不参与后续分类（不进入第 3、4 条，不会被判 `unmapped_file`），范围照常计算。
  3. `logos/resources/` 下文件名带已登记模块前缀（`<module>-`，最长匹配）的**规格文件** → 计入该模块（依据 `source: "spec"`），与 delta 前缀同口径。
  4. **其余文件**（含 `logos/` 下的其他内容，如 `logos/tools/**`）按 `modules[].paths` 归属（依据 `source: "path"`）；一个模块也命中不了 → 回落全量（`unmapped_file`）。
- **起点不可用 → 回落全量**：guard 没有 `baseRef`（旧版 CLI 创建的提案）为 `base_ref_missing`；项目不是 git 仓库为 `not_git_repository`；`baseRef` 不可达（如历史被改写）为 `base_ref_unreachable`；差异计算失败为 `diff_failed`。
- **`paths` 非法**（以 `/` 开头、含 `..` 段、空串或非字符串）→ 回落全量（`module_paths_invalid`）。宁可多跑，不因拼写错误少跑。
- 回落全量时范围为全部已登记模块，命令选择与用例核对都按全部模块执行（§2.96.4）。这与「未启用」不同：会输出 `scope`，并可能执行多个模块级命令。

#### 2.96.3.1 共享验收配置按字段判断（verify-scope-fields-and-slice-module）

> 来源变更：verify-scope-fields-and-slice-module（openlogos #4；proposal-r1 F1、proposal-r2 F1 处置）。0.16.27 及之前，这两个文件相对提案起点有任何差异即回落全量；合并规格时写入的 `resource_index`、宿主写回的 `driver` 等都会触发。本节把判定细化到顶层字段。按模块限定范围（本节所属 §2.96.3）与分层验收（§2.109.7）共用同一判断。

**字段清单**（由 CLI 固定，项目不可配置）：

| 文件 | 相关字段（变化即回落） | 无关字段（变化不回落） |
|---|---|---|
| `logos/logos-project.yaml` | `modules` | `project`、`tech_stack`、`scenario_counter`、`feature_counter`、`decision_counter`、`features`、`scenarios`、`release_workflows`、`deployment_gates`、`resource_index`、`conventions`、`baseline_index` |
| `logos/logos.config.json` | `verify`、`smoke`、`sourceRoots`、`guard` | `name`、`description`、`locale`、`aiTool`、`agents`、`driver`、`branch_sync`、`maxOpenTabs`、`modules`、`fileModules` |

- 两列都没有列出的顶层字段（如 `logos.config.json` 的 `documents`、`flow`，以及今后新增的字段）按相关字段处理：清单漏更新时多跑，不会少跑。
- `verify` 与 `smoke` 是验收实际读取的字段；`sourceRoots` 与 `guard` 当前不被 verify 读取，按保守口径列为相关。
- 不在顶层字段内部再细分：`modules` 中任何取值变化（含模块名称）都算相关字段变化。

**适用前提**：字段比较只发生在相应范围机制已启用、并且已经进入改动文件分类之后。

- 按模块限定范围：§2.96.2 判定为启用，且两个文件之一出现在改动文件集合中（流程产物豁免之后）。
- 分层验收：工作区 `logos/logos.config.json` 可读且 `verify.layered.enabled` 为 `true`，存在活跃提案且提案起点可用（§2.109.7）。
- 两个范围机制各自判断是否启用，互不影响：

  | 工作区的情形 | 按模块限定范围（`scope`） | 分层验收（`layers`） |
  |---|---|---|
  | 没有 `logos/logos.config.json` | verify 以 `PROJECT_NOT_INITIALIZED` 退出，两者都不输出 | 同左 |
  | `logos/logos.config.json` 无法解析 | 是否启用只看 `logos-project.yaml`；已启用时照常进入分类 | 读不到 `verify.layered`，按未开启处理，不输出 `layers` |
  | `logos/logos-project.yaml` 缺失或解析不出模块 | 未启用，不输出 `scope` | 是否开启只看 `logos.config.json`；已开启时照常进入分类 |

  某个机制未启用时，它的入口行为与引入前相同，不输出它的字段；这不影响另一个已启用的机制（delta-r1 F1）。

**字段比较的触发条件**（delta-r2 F1、delta-r3 F1）——对每个机制、每个文件分别判断，唯一条件是：

> 该机制已按既有规则取得改动文件集合，**且集合包含这个文件**。

条件成立时对该文件做字段比较，它**只贡献自己的那一份原因或明细**；条件不成立时，该文件不做比较、不贡献任何原因或明细。无论哪种情况，都不改变同一机制按其他规则给出的结果：

1. **先于改动集合的既有结果原样保留。** 按模块限定范围（§2.96.3 的既有顺序）：`paths` 非法（`module_paths_invalid`）→ 没有活跃提案（`no_active_change`）→ 不是 git 仓库（`not_git_repository`）→ guard 缺 `baseRef`（`base_ref_missing`）→ `baseRef` 不可达（`base_ref_unreachable`）→ 差异计算失败（`diff_failed`）。分层验收（§2.109.7）：`no_active_change`、`base_ref_unavailable`。以上任一成立时没有改动集合，不读取两个文件的任何一侧内容，原因中没有由这两个文件贡献的部分——即使此时工作区的文件已经损坏。
2. **文件不在改动集合内时不比较。** 两侧都没有该文件、或两侧字节相同，都属于不在集合内。例如提案起点与工作区都没有 `logos/logos-project.yaml`：该文件不贡献任何原因或明细。
3. **其他来源的原因照常给出。** 改动集合中的其他文件仍按各自的规则处理：分层验收中命中 `shared_paths` 的文件（如依赖锁文件）照常产生 `shared_path_changed` 并在 `detail` 中点名，提案声明的共享标志照常产生 `shared_change_declared`，声明缺失等照常产生第 2 级原因；按模块限定范围中归不到模块的文件照常产生 `unmapped_file`。配置文件未命中，只是 `detail` 中没有它，不是「没有任何原因」。

例：分层已开启，提案起点与工作区都没有 `logos/logos-project.yaml`，`logos/logos.config.json` 两侧相同，提案只改了 `package-lock.json` → 扩大到全量，原因 `shared_path_changed`，`detail` 含 `package-lock.json`，不含这两个配置文件。

**比较口径**：

1. 取两侧原文。**提案起点一侧**：guard `baseRef` 提交中该文件的内容；项目根位于 git 仓库的子目录时，按项目根相对路径读取（与改动文件集合 `--relative` 的口径一致），不得读到仓库根下的同名文件。**工作区一侧**：磁盘上的当前内容。
2. 两侧各自**严格解析**：`logos.config.json` 按 JSON，`logos-project.yaml` 按 YAML；没有任何语法错误才算通过（YAML 的重复键同样算错误）。
3. 两侧都通过且顶层都是对象时，取两侧顶层键的并集，逐个比较取值：一侧有、另一侧没有，算变化；都有时按取值深度比较——对象不看键的顺序，数组看元素顺序，标量按解析后的值比较。空白、注释、引号写法不影响结果。
4. 变化的键中只要有相关字段或未列出的字段，该文件即为「相关变化」；变化的键全部是无关字段（或没有变化的键）时为「无关变化」。

**无法判断时按整文件变化处理**（按条件判定，不按情形枚举）：某一范围机制已启用、并已进入某个文件的变化分类时，该文件任一侧的原文不存在、读取失败、不能严格解析或顶层不是对象，即视为「相关变化」。规则对两个文件、两个机制相同。

- 提案起点中没有该文件（提案期间新增）、`git` 读取失败，属于「不存在」「读取失败」。
- **严格解析与恢复解析的分工**：`readProjectYaml` 在 YAML 有语法错误时会尽量恢复出 `modules`（`parse_status: "recovered"`），该结果继续只用于判断模块范围是否启用（§2.96.2）；字段比较只使用严格解析的结果。因此工作区 `logos-project.yaml` 有语法错误（如重复一个顶层键）但仍能恢复出多个声明了 `paths` 的模块时，模块范围照常启用并进入分类，该文件因不能严格解析而回落全量——即使分层验收没有开启。

**原因与 `detail`**：原因代码不变（按模块限定范围 `shared_config_changed`，分层验收 `shared_path_changed`）。`detail` 逐个文件写明：

| 情形 | `detail` 中该文件的写法 |
|---|---|
| 相关字段或未列出的字段有变化 | `<路径>（<字段>、<字段>…）`，字段按字典序，只列相关字段与未列出的字段，不列同时变化的无关字段。例：`logos/logos.config.json（smoke、verify）` |
| 提案起点一侧无法判断 | `<路径>（提案起点中的内容<原因>）`，原因为 `不存在`、`读取失败`、`无法解析`、`顶层不是对象` 之一 |
| 工作区一侧无法判断 | `<路径>（工作区中的内容<原因>）`，原因同上 |

两个文件都命中时用 `、` 连接，`logos/logos.config.json` 在前。只有无关变化时不产生该原因。JSON 字段与 schema 的枚举不变。

**与 `verify.layered.shared_paths` 的关系**：项目在 `shared_paths` 中显式列出这两个文件之一（glob 命中该路径）时，分层验收对该文件按路径命中处理——任何差异都扩大到全量，`detail` 只写路径。缺省清单不含这两个文件。按模块限定范围不读取 `shared_paths`。

**实现映射**：`cli/src/lib/verify-scope.ts`（判断函数，供 `resolveVerifyScope` 与 `computeLayeredPlan` 共用）、`cli/src/lib/layered-verify.ts`。追溯：需求 AC-VERIFY-FIELD-01～07；测试 UT-S13-275～293、ST-S13-52～54。

## MODIFIED — 2.109.2 配置

`logos/logos.config.json`：

```jsonc
"verify": {
  "layered": {
    "enabled": false,        // 缺省 false
    "main_path_max": 50,     // 缺省 50，正整数
    "shared_paths": [        // 缺省如下；glob，语法同 modules[].paths（§2.96.1）
      "**/package.json", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock",
      "**/Cargo.toml", "**/Cargo.lock", "**/go.mod", "**/go.sum",
      "**/pyproject.toml", "**/requirements*.txt"
    ]
  }
}
```

- 整个对象可省略，省略等价于缺省值。配置了 `shared_paths` 时以配置值**替换**缺省清单（可以写空数组）。
- `logos/logos.config.json` 与 `logos/logos-project.yaml` 是共享验收配置，按字段判断（§2.96.3.1）：相关字段或未列出的字段有变化、或无法判断时扩大到全量，只有无关字段变化时不扩大。这一判断不依赖 `shared_paths`（写空数组时照常生效）；项目在 `shared_paths` 中显式列出这两个文件之一时，该文件改为按路径命中处理（任何差异都扩大）。
- `layered` 不是对象、`enabled` 不是布尔、`main_path_max` 不是正整数、`shared_paths` 不是合法 glob 字符串数组时：非法项按缺省值处理，`warnings` 增加 `layered_config_invalid` 并指出字段；不因此改变门禁结论。
- 只有项目级配置。发布级验收不读取 `enabled`。

## MODIFIED — 2.109.7 扩大规则

只扩大，不缩小。按下表从上到下判断，取**范围最大**的一级；命中的原因全部记录。扩大不是失败，不改变门禁结论。

| 级 | 扩大到 | 条件 | 原因代码 |
|---|---|---|---|
| 1 | 全量 | 没有活跃提案 | `no_active_change` |
| 1 | 全量 | 提案起点不可用：不是 git 仓库、guard 缺 `baseRef`、`baseRef` 不可达、差异计算失败（§2.96.6 的同一判定） | `base_ref_unavailable` |
| 1 | 全量 | 改动文件（`baseRef` → 工作区，§2.96.3 的同一集合）命中 `shared_paths`；或两个共享验收配置文件按字段判断为相关变化（§2.96.3.1，含无法判断）。`detail` 列出命中的路径，共享验收配置文件按 §2.96.3.1 写明字段或原因 | `shared_path_changed` |
| 1 | 全量 | 声明的共享标志为真（§2.109.4；不要求声明 `usable`） | `shared_change_declared` |
| 2 | 按模块 | 声明为 `missing` | `declaration_missing` |
| 2 | 按模块 | 声明为 `invalid` | `declaration_invalid` |
| 2 | 按模块 | 声明为 `unknown` | `assessment_unknown` |
| 2 | 按模块 | 声明为 `scenario_unknown` | `scenario_unknown` |

- **第 1 级（全量）**：验收集合为全部不带 `[manual]` 的 UT/ST，与分层未开启时相同。`layers.expansion.level` 为 `"full"`。
- **第 2 级（按模块）**：A 改为「§2.96 的范围内用例集（范围 M 内各模块的全部用例）∪ AS 中各场景的用例」——已识别的场景与 delta 触及的场景即使在范围 M 之外也保留，保证结果是未扩大时集合的超集；P = C ∪ A ∪ MP。§2.96 未启用（单模块或没有模块声明 `paths`），或其自身回落到全量（`fallback-full`）时，结果即全量，`level` 为 `"full"`，并追加原因 `module_scope_unavailable`；否则 `level` 为 `"module"`。
- 都未命中时 `level` 为 `"none"`，P 按 §2.109.6。

## MODIFIED — 2.78.3 退出码与输出契约

| 退出码 | 含义 | 输出 |
|---|---|---|
| 0 | 规划成功，两产物已落盘 | 既有五个 `data` 字段与人读摘要，逐字不变 |
| **2** | **产物非法被拒，顶层错误码为 `SLICE_PLAN_ARTIFACT_INVALID`**：validator 给出负面结论，且违规不属于下一行列出的三类归属 / 重号违规 | stderr 错误信封；逐条列出 violations，**原样保留 `code` / `path` / `message` / `fix_hint`**，顺序稳定；人读模式为「缺什么 / 在哪补 / 补成什么样」三段式；`--format json` 时结构化数组位于信封根的 `violations` |
| 1 | **产物非法被拒，顶层错误码为 `SLICE_PLAN_DUPLICATE_SLICE_ID` 或 `SLICE_PLAN_UNKNOWN_TEST_ID`**：validator 的违规含 `test-slice-id-duplicate`（前者），或含 `test-slice-test-id-unknown` / `test-slice-test-id-missing` / `test-slice-test-id-duplicate`（后者，包括本提案变更用例无人认领或被重复认领） | 同上一行：stderr 错误信封，违规明细同样原样位于信封根的 `violations` |
| 1 | 操作错误，没有违规明细：`SLICE_PLAN_NO_ACTIVE_CHANGE`（无活跃提案、提案目录或 `tasks.md` 缺失、`--slug` 指向的不是活跃提案（§2.110））、`SLICE_PLAN_INPUT_INVALID`（`--file` 不存在或不可读、输入非合法 JSON 或缺必需字段）、`SLICE_PLAN_VERIFY_SCOPE_AMBIGUOUS`、`SLICE_PLAN_VERIFY_SCOPE_CONFIG_INVALID` | stderr 错误信封，只有 `error.code` 与 `error.message` |

**读取规则**（verify-scope-fields-and-slice-module 按现行实现改正本表，行为不变；delta-r2 F4、delta-r3 F4）：

- 退出码由顶层错误码决定：只有 `SLICE_PLAN_ARTIFACT_INVALID` 为 2，其余错误码一律为 1。顶层码的映射顺序为：违规含 `test-slice-id-duplicate` → `SLICE_PLAN_DUPLICATE_SLICE_ID`；否则含三类用例 ID 违规之一 → `SLICE_PLAN_UNKNOWN_TEST_ID`；否则 → `SLICE_PLAN_ARTIFACT_INVALID`。
- 任何拒绝在 `--format json` 时都走 stderr 的错误信封，stdout 没有输出。违规明细的路径统一为相对信封根的 `violations`（与 `command`、`error` 同级），不在 `data` 下、也不在 `error` 下；没有违规明细时该键不出现。
- 消费方先看 `error.code` 分派，需要明细时读信封根的 `violations`；不要以「退出码是否为 2」判断有没有违规明细。

退出码分级与 `change-lint` 的对应关系：0 为全过；2 为产物非法（`SLICE_PLAN_ARTIFACT_INVALID`）；1 包含操作错误，以及上表第三行两类保留了专用顶层码的产物非法。对只判断「是否非零」的既有消费方**零影响**。

**违规明细不得折叠为一句摘要。** 它们已经带着 `fix_hint`，是 Agent 当轮自愈的全部所需；折叠即等于把可自愈的失败升级为停点——这正是 §2.78.0 后果链第 5 步的成因。

## ADDED — 2.110 切片规划的目标提案与模块（verify-scope-fields-and-slice-module）

> 来源变更：verify-scope-fields-and-slice-module（openlogos #7；proposal-r1 F2 处置）。`spec/test-slice-manifest.md` 规定切片清单的 `change` 与 `module` 对应活跃 guard；合并时写入 `SPEC_MERGED.test_change_set` 的模块、verify 读取切片状态时比对的模块都取自 guard。0.16.27 及之前，`openlogos slice plan` 在读取测试变更集、校验清单、写出清单三处把模块写死为 `core`，提案登记在其他模块时写出的清单被 verify 判 `test-slice-manifest-invalid`。

### 2.110.1 目标提案必须是活跃提案

`openlogos slice plan` 在读取输入、暂存 `tasks.md` 与切片清单**之前**确定目标提案：

| 调用 | guard | 结果 |
|---|---|---|
| 不传 `--slug` | 有 `activeChange` | 目标为 `activeChange`（行为不变） |
| 不传 `--slug` | 没有 guard 或没有 `activeChange` | `SLICE_PLAN_NO_ACTIVE_CHANGE`（行为不变） |
| `--slug X` | `activeChange` 等于 `X` | 目标为 `X` |
| `--slug X` | `activeChange` 不等于 `X`，或没有 guard、guard 无法解析 | `SLICE_PLAN_NO_ACTIVE_CHANGE`，message 写明 `X` 不是活跃提案并给出当前活跃提案（没有时写明没有） |

拒绝时退出码 1，`--format json` 时 stderr 输出错误信封；目标提案的 `tasks.md` 与 `TEST_SLICE_MANIFEST.json` 保持原内容（逐字节不变），不留临时文件。提案目录不存在、缺 `tasks.md` 的既有拒绝不变。

不为非活跃提案另找模块来源（例如读取 `proposal.md` 的 `> module:` 头）：清单随后要被 verify 以活跃 guard 比对，为非活跃提案写出的清单不会被采信。

### 2.110.2 模块解析一次，三处共用

目标确认后解析模块。**提案模块取值规则**只有一份，即合并时写入测试变更集所用的规则（`moduleFromGuard`，`cli/src/lib/merge-direct.ts`）：

- guard 指向该提案且 `module` 去掉首尾空白后非空 → 取去掉首尾空白后的值；
- guard 指向该提案但没有 `module` 字段，或其值为空白（旧版 CLI 创建的提案）→ `core`。

这一个值用于：

1. 读取并校验 `SPEC_MERGED.test_change_set`（期望的 `module`）；
2. 校验暂存的切片清单（期望的 `module`）；
3. 写出切片清单的 `module` 字段。

三处不得各自取值。提案登记在 `core` 时，写出的 `tasks.md` 与清单与 0.16.27 相同（清单的 `generated_at` 除外）。

**读取侧使用同一取值规则**（delta-r1 F2）。verify 中以下三处此前直接使用 guard 的原始 `module` 字符串，改为同一规则取值，使写入与读取对同一个 guard 得到同一个模块：

- 切片状态派生比对切片清单 `module` 时的期望值（`cli/src/commands/verify.ts`）；
- 读取本提案变更用例时比对测试变更集 `module` 的期望值（`cli/src/lib/verify-scope.ts` 的 `readChangedTestIdsForScope`）；
- 门禁读取「严格跳过」所依据的本提案变更用例时比对测试变更集 `module` 的期望值（`cli/src/lib/verify-skip-classification.ts` 的 `readStrictSkipSet`，delta-r2 F2）。该处单独读取 guard，不修正时清单与 pending 都已正确，门禁仍会以 `test_change_set_invalid` 判 FAIL。

规则按条件表述，不以上面的清单为限：`openlogos verify` 一次运行中，凡是以活跃提案的模块作为期望值去读取切片清单或测试变更集的位置，都必须经同一个取值函数（`moduleFromGuard`）得到该值，不得直接使用 guard 文件中的原始字符串。实现时以全仓检索 `readTestChangeSet`、`deriveSliceVerificationState` 的调用点为准逐个核对；`change-lint`、`status`、`next` 等以 `proposal.md` 头或 `logos-project.yaml` 的模块 id 为期望值的调用点不在此列。

否则 guard 的 `module` 带首尾空白时，`slice plan` 写出去掉空白的值，verify 却拿带空白的原值严格比较，清单在 `$.module` 被拒。guard 的 `module` 不带空白时，读取侧的行为与引入前相同。

### 2.110.3 兼容性与追溯

- 不新增错误码、参数与 JSON 字段；`SLICE_PLAN_NO_ACTIVE_CHANGE` 的触发条件增加一种（§2.78.3）。
- 此前以 `--slug` 为非活跃提案规划切片的调用改为失败。那种调用写出的清单本来就不被 verify 采信。
- 实现映射：`cli/src/commands/slice.ts`（写入侧）、`cli/src/commands/verify.ts`、`cli/src/lib/verify-scope.ts` 与 `cli/src/lib/verify-skip-classification.ts`（读取侧的模块取值）。追溯：需求 AC-VERIFY-FIELD-08～10；场景 `core-S32-slice-planning.md`「S32 切片规划的目标提案与模块」；测试 UT-S32-126～134；`spec/test-slice-manifest.md`、`spec/cli-json-output.md`。
