## ADDED — Step 4 补充：「验收标准」段（verify-self-sufficient-cases）

> 来源变更：verify-self-sufficient-cases（功能规格 §2.106.8、§2.106.9；`spec/test-results.md`「verify 环境要求声明、对账与预检」）。本节是 Step 4「逐段填写要点」的补充，脚手架保真规则不变。

`openlogos change` 的脚手架在「决策澄清」与「变更概述」之间生成「验收标准」段（en：`Acceptance Criteria`）。它让用户在批准方案时就看到本次验收要求什么机器环境、哪些用例只在特定平台执行、哪些事要人亲手做。三个字段都必须填写，没有就写「无」：

- **自动验收环境要求** — 本次不需要人参与的用例需要哪些机器条件。内容是**预期写入 `verify.requirements` 的配置差异**，写成一个及以上反引号条目，条目后可跟说明：
  - `` `env:<变量名>` ``：环境变量（只写名字）；
  - `` `command:<命令名>` ``：需要在 `PATH` 上的命令；
  - `` `check:<检查名>` ``：需要检查命令确认的条件，说明里写清检查什么、在什么条件下才要求。

  条目来自 test-writer（3c）。写下条目即意味着：merge 后的 `[code]` 实现任务必须在活跃提案内把它们写入 `logos/logos.config.json` 的 `verify.requirements`；verify 在执行任何预跑命令前对账，漏写会以 `acceptance_requirement_undeclared` 判 FAIL。规划 `[code]` 时不要漏掉这项配置写入。
- **平台限定用例** — 只在特定平台、执行身份或平台能力下执行的用例 ID 与条件；它们在条件不成立时写平台跳过原因。条件成立却缺工具的情形不属于这里，应写成上一字段的 `check:` 条目。
- **需要人参与的验收** — 本次需要人亲手做的验收事项与预期执行环节。冒烟阶段的人工验收能力（openlogos #3）落地前，用文字写明事项即可，不产生机器判定；不要为此给 `SMOKE-*` 写 `[manual]`。

修改保护范围不在本段：`.gitignore`、`.git/info/exclude` 与 `logos.config.json` 的 `guard` 字段仍只能经 `openlogos ignore|exempt` 修改；「已立案可改」只适用于 `verify.requirements` 等其他配置字段。

段缺失时 change-lint 只出警告 `acceptance_criteria_missing`；段在场但字段缺失、为空、仍为占位文字或条目格式非法时报违规 `acceptance_criteria_invalid`，按 `fix_hint` 修复后重跑。
