## MODIFIED — 三层集合与扩大

- **本提案用例**：已合并提案的测试变更集中的 UT/ST。
- **受影响用例**：受影响场景的测试用例文档（`<module>-SXX-test-cases.md`）中全部不带 `[manual]` 的 UT/ST。受影响场景 = 提案「受影响场景」段声明的场景 ∪ 提案 delta 触及的场景。
- **主链路用例**：全部主链路小节所列用例。

只扩大，不缩小：

| 情形 | 扩大到 |
|---|---|
| 没有活跃提案；提案起点不可用；改动命中 `verify.layered.shared_paths`；`logos/logos.config.json` 或 `logos/logos-project.yaml` 中与验收相关的字段（或清单未列出的字段）有变化、或无法判断（按字段判断，只有无关字段变化时不扩大；字段清单见功能规格 §2.96.3.1）；声明写明涉及共享改动 | 全量 |
| 提案没有「受影响场景」段、该段非法或未填写、写了无法评估、声明了不存在的场景 | 按模块（按模块限定范围的结果，并保留声明中已识别的场景与 delta 触及的场景；不可用时为全量） |

声明中的共享标志只要能读出且为真就扩大到全量，即使声明的其余部分不可用。扩大不是失败，不改变门禁结论；原因写在 JSON `layers.expansion` 与验收报告中。

## ADDED — 共享验收配置按字段判断（verify-scope-fields-and-slice-module）

`logos/logos.config.json` 与 `logos/logos-project.yaml` 在提案期间有变化时，verify 不再一律回落（按模块限定范围）或扩大（分层验收）到全量，而是比较提案起点与工作区中两份内容的顶层字段。规则权威见功能规格 §2.96.3.1，这里只列对使用者可见的约定：

| 文件 | 变化即全量的字段 | 变化不影响范围的字段 |
|---|---|---|
| `logos/logos-project.yaml` | `modules` | `project`、`tech_stack`、`scenario_counter`、`feature_counter`、`decision_counter`、`features`、`scenarios`、`release_workflows`、`deployment_gates`、`resource_index`、`conventions`、`baseline_index` |
| `logos/logos.config.json` | `verify`、`smoke`、`sourceRoots`、`guard` | `name`、`description`、`locale`、`aiTool`、`agents`、`driver`、`branch_sync`、`maxOpenTabs`、`modules`、`fileModules` |

- 两列都没有列出的顶层字段按「变化即全量」处理。
- 比较的是解析后的取值：键顺序、空白、注释、引号写法不算变化，数组元素顺序算变化。
- 范围机制已启用并进入比较后，任一侧内容不存在、读取失败、有语法错误或顶层不是对象，按整文件变化处理。`logos-project.yaml` 有语法错误但仍能读出模块时同样如此。
- 原因代码不变（`shared_config_changed`、`shared_path_changed`），`detail` 写明文件与字段。
- 某个配置文件只在「该范围机制已取得改动文件集合，且集合包含这个文件」时才被比较，并只贡献它自己的原因或明细。条件不成立时它不贡献任何原因，其余照旧：
  - 工作区缺 `logos.config.json`：verify 以 `PROJECT_NOT_INITIALIZED` 退出；
  - 工作区 `logos.config.json` 无法解析：分层验收按未开启处理（没有 `layers`）；模块范围已启用且该文件在改动集合中时照常回落并点名它；
  - 工作区 `logos-project.yaml` 缺失或读不出模块：模块范围未启用（没有 `scope`）；分层验收已开启且该文件在改动集合中时照常扩大并点名它；
  - 没有活跃提案、提案起点不可用、差异计算失败等：按既有规则给出各自的原因，不比较这两个文件；
  - 文件两侧都没有或两侧相同：不比较；改动集合中其他文件的原因照常给出（例如只改了 `package-lock.json` 时，分层验收仍以 `shared_path_changed` 扩大并点名该锁文件）。
