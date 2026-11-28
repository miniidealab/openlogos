# 实现任务

## [delta] 规格变更
- [x] 产出 `deltas/prd/1-product-requirements/core-01-requirements.md` — 新增「冒烟阶段人工验收需求（smoke-manual-acceptance）」，内容包括：
  - 用户价值；
  - SMOKE 人工标记；
  - 按环境开关；
  - 待验收清单，含基线、累积，以及首次开启取全部现有人工用例（C02）；
  - 只能由人记录；
  - 结果绑定 deploy_id；
  - 门禁三态与「等待人工验收」；
  - 关闭时只列出；
  - 验收条件 AC-SMOKE-MANUAL-01 起；
  - 非目标：RunLogos 界面属 RunLogos #34；人工结果不入库；不校验证据内容。
- [x] 产出 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 新增 §2.107「冒烟阶段人工验收」，内容包括：
  - SMOKE 人工标记与首格读法，修复全文回退，以及 `manual_smoke_result_id`；
  - 登记表 `manual_acceptance` 字段与校验、`manual_regression_unknown`；
  - 开关字段纳入登记表保护；
  - 待验收清单 P(E, D) 的计算口径：基线（只认未过期的通过结论）、行对比、首次开启、已部署版本未确认或不可读时 `manual_scope_unresolved`（不退回工作区）、基线不可读按全量与 `manual_baseline_unavailable`；回归用例在已部署版本上解析，开启环境失效即 `manual_regression_unresolved`；
  - `openlogos accept` 的参数（含必填 `--deploy`）、前置检查、锁内部署身份核对与 `ACCEPT_DEPLOY_CHANGED`、错误码、账本写入与使已有通过结论过期；
  - smoke 门禁顺序：自动用例为零时的空自动阶段（`NO_SMOKE_CASES` 只在两类用例都没有时报出）、人工阶段的 `manual_scope_unresolved` / `manual_regression_unresolved` / `manual_cases_failed` / `PENDING`；`PENDING` 写账本 smoke 记录 `result=pending`、提案通道清除旧标记、版本通道只写账本；
  - 结论过期：通过后追加人工记录即删除 `SMOKE_PASS`、账本中不再作为基线与晋级依据；smoke 在账本锁内复核人工记录后落账；archive 在该部署有 manual 记录时以账本最近有效结论核对（`smoke_pass_expired`）；
  - 关闭时的「未执行的人工用例」；
  - next / status 的 `awaiting-manual-acceptance`；
  - `--auto` 硬停点；
  - JSON 契约；
  - 兼容性；
  - 实现映射与追溯。
- [x] 产出 `deltas/prd/3-technical-plan/1-architecture/core-01-architecture-overview.md` — 新增「五十九、冒烟阶段人工验收：账本 manual 记录与待验收清单」，内容包括：
  - 组件关系：smoke-coverage、manual-acceptance、environments 账本、accept、smoke、flow 派生、guard；
  - 数据流：两个 commit 间的规格行对比；
  - 单一写入者与 marker 顺序；
  - 与审批门（五十五）的异同。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S46-smoke-manual-acceptance.md` — 新建场景「S46：冒烟阶段人工验收」，按 canonical 结构包括：
  - 场景目标、参与者、前置条件、成功后置条件；
  - Mermaid 时序：deploy → smoke（自动 PASS）→ PENDING → 人执行 accept → 重跑 smoke → SMOKE_PASS；
  - 步骤说明；
  - 异常与边界：人工用例失败、记录不在清单中的用例、未开启环境、无当前部署、失败缺说明、重新部署后旧结果作废、关闭时只列出、不部署提案的累积、首次开启全量、清单无法确定（已部署版本未确认或不可读）、回归用例失效、部署已更换时记录被拒、通过后更正为失败使通过过期、全人工项目、基线不可读按全量、AI 调用被 guard 拦截、`--auto` 停机；
  - 追溯。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-00-scenario-overview.md` — 场景总览新增 S46 行。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md` — 新增「S19 SMOKE 人工标记读取与人工判定接入」，内容包括：
  - 首格读法容忍 manual 标记、不触发全文回退；
  - 自动判定之后接人工判定；
  - `PENDING` 结论写账本 smoke 记录（`result=pending`、`verified=false`、`manual_pending`），提案通道清除 `SMOKE_PASS` / `SMOKE_FAIL`（沿用写入顺序与快照恢复），版本通道只写账本；
  - 自动用例为零、存在人工用例时的空自动阶段；
  - 关闭时的报告；
  - 异常与边界；
  - 追溯。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S41-environment-registry.md` — 新增「人工验收字段（smoke-manual-acceptance）」，内容包括：
  - `manual_acceptance` 结构校验与 `ENV_FIELD_INVALID`；
  - 字段名字面量要求；
  - 不构成受门环境；
  - EnvView 的 `manual_acceptance`；
  - 账本 `kind=manual` 的读取校验与旧读取方兼容；
  - 异常与边界；
  - 追溯。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S05-next-guidance.md` — 新增「等待人工验收的 next 建议」，内容包括：
  - 账本中当前部署最近一条 smoke 记录为 `pending` → `awaiting-manual-acceptance` 驻留态与标签（剩余清单只读账本）；
  - 剩余非空时建议列出剩余用例与带 `--deploy` 的 `openlogos accept` 命令原文、注明需要人执行；剩余为空时建议重跑 smoke；
  - `auto_execute=false`、`--auto` 不放行；
  - 记录完成后的下一步（重跑 smoke）；
  - 追溯。
- [x] 产出 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-management.md` — 新增「S09 人工验收记录命令受限与开关字段保护」，内容包括：
  - `openlogos accept`（任何参数形态）加入受限命令，与 approve 同一宿主原生审批路径，复合形态阻断；
  - 写了 `manual_acceptance` 的登记表按「已配置门禁的登记表」保护；
  - 生成指令硬红线条目；
  - 异常与边界；
  - 追溯。
- [x] 产出 `deltas/spec/environments.md` — 新增 §15「冒烟阶段人工验收」，内容包括：字段、待验收清单、`openlogos accept`、门禁与 marker、关闭时、guard、兼容性。同时修改：
  - §5.1「位置与写入者」：新增 accept 写入者；
  - §5.2「记录字段」：`kind` 新增 `manual`、manual 记录字段、smoke 记录 `result` 新增 `pending` 及可选字段 `manual_passed` / `manual_pending`；
  - §5.4「读取」：manual 行与 pending 行校验、通过结论过期推导（晋级候选与已验证集合只认未过期记录）、旧读取方兼容；
  - §9「guard」：开关字段识别。
- [x] 产出 `deltas/spec/test-results.md` — 修改一节、新增一节：
  - MODIFIED「`[manual]` 标记用例」：扩展到 SMOKE，删去「SMOKE 部分由 openlogos #3 交付」的过渡说明，并说明人工用例进入冒烟阶段人工验收；
  - ADDED「Smoke 人工用例与冒烟阶段人工验收」：首格读法、人工 SMOKE 不写结果（`manual_smoke_result_id`）、不计入 defined 与 uncovered、全人工项目的空自动阶段、runner 窗口。既有「Smoke 结果与覆盖预检」原文不改，由新增节补充。
- [x] 产出 `deltas/spec/pretooluse-guard.md` — 修改以下两处：
  - 受限命令清单新增 `openlogos accept`（任何参数形态，含 `--help`），提示文案为「人工验收结果只能由人记录」；
  - 「已配置门禁的登记表」识别字段新增 `manual_acceptance`。
- [x] 产出 `deltas/spec/agents-md.md` — 生成指令硬红线新增「等待人工验收」，中英文案各一份：任何模式、含 `--auto`，AI 都不得执行 `openlogos accept`、不得修改 `manual_acceptance` 来关闭人工验收；人记录后宿主重新驱动 smoke 即可继续。
- [x] 产出 `deltas/spec/change-management.md` — 硬红线条目新增「等待人工验收」：`awaiting-manual-acceptance`（剩余清单非空）在任何模式下都不自动放行，不新增恢复机制。
- [x] 产出 `deltas/spec/cli-json-output.md` — 修改与新增以下内容：
  - `openlogos smoke --format json`：新增 `data.manual_acceptance`，`gate.result` 新增 `PENDING`，`gate.reason` 新增 `manual_acceptance_pending` / `manual_cases_failed`；
  - 新增「`openlogos accept --format json`」；
  - EnvView 新增 `manual_acceptance`；
  - next / status 新增驻留态 `awaiting-manual-acceptance`。
- [x] 产出 `deltas/skills/test-writer/SKILL.md` — 修改 3c：
  - SMOKE 可以标 `[manual]` / `[manual/<平台>]`，判据与 UT/ST 相同；
  - 人工 SMOKE 不写 runner、不写结果；
  - 每次发布必跑的回归人工用例由人在登记表 `manual_acceptance.regression` 中指定，AI 只在提案「验收标准」中提出建议；
  - 删去「SMOKE 人工标记留给 openlogos #3」。
- [x] 产出 `deltas/skills/change-writer/SKILL.md` — 修改「Step 4 补充：『验收标准』段」：「需要人参与的验收」写出人工用例 ID 与将在哪个开启人工验收的环境执行（未开启时写明累积到下一次开启环境）；删去「#3 落地前用文字写明」与「不要为此给 `SMOKE-*` 写 `[manual]`」的过渡说明。
- [x] 产出 `deltas/test/core-S46-test-cases.md` — 新建 S46 测试用例 UT-S46-01 起、ST-S46-01 起，覆盖以下内容：
  - 待验收清单：首次全量、有基线时的增量、行内容变化、回归用例并入、UT/ST/SMOKE 三类都计入；
  - `accept`：前置错误码、`--deploy` 在锁内核对（同一提交的两次部署也报 `ACCEPT_DEPLOY_CHANGED`）、整批零写入、失败缺说明、证据路径警告、重复记录以最后一条为准、账本锁并发；
  - smoke 门禁三态、重新部署后旧结果作废、关闭时只列出；
  - 清单无法确定：已部署版本 ref 为 null 或对象不可读时开启环境 FAIL `manual_scope_unresolved`，用缺少人工用例的另一分支作工作区也不签发通过、不推进基线；基线对象不可读时按全量；
  - 回归用例：一个有效 ID 加一个失效 ID，只记录有效项后仍 FAIL `manual_regression_unresolved`；关闭环境只警告；
  - 结论过期：通过 → 更正为失败 → 直接 archive 被拒，账本中过期记录不作为基线与晋级依据；交错执行（重跑暂停在 PASS 账本追加后 → 失败更正完成 → 重跑恢复写回 SMOKE_PASS → 直接 archive）仍被拒（`smoke_pass_expired`）；smoke 在账本锁内复核人工记录后才落账；
  - 等待状态恢复：有、无活跃提案两种通道各走一次「记录 A → 重跑仍等待 B → 记录 B → 重启」，剩余清单为空并提示重跑 smoke；`manual_pending` 只含写入时仍无记录的用例；
  - 不部署提案的人工用例在下一次部署中出现；
  - JSON 契约；
  - 真实 CLI 端到端。

  要求 OpenLogos reporter。
- [x] 产出 `deltas/test/core-S19-test-cases.md` — 新增 UT-S19-127 起、ST-S19-40 起，覆盖以下内容：
  - 首格 `SMOKE-x [manual]` 容忍；
  - 全人工文件不触发全文回退；
  - 人工行不计入 defined 与 uncovered；
  - `manual_smoke_result_id`；
  - 未配置人工验收的项目门禁结论不变的回归对照；
  - 全人工项目（只有一条人工 SMOKE、无 runner、无结果文件）走通等待、记录与重跑；有自动用例缺结果时仍报 `NO_SMOKE_RESULTS`；
  - `PENDING` 账本记录与旧标记清除的写入顺序与失败恢复，有、无活跃提案两种通道。

  要求 OpenLogos reporter。
- [x] 产出 `deltas/test/core-S41-test-cases.md` — 新增 UT-S41-30 起，覆盖以下内容：
  - `manual_acceptance` 结构校验（enabled 非布尔、regression 非数组或 ID 格式非法 → `ENV_FIELD_INVALID`）；
  - 转义键拒绝；
  - 不构成受门环境（deploy-done 不受影响）；
  - EnvView 字段只在配置时出现；
  - 账本 manual 行校验与坏行计数。

  要求 OpenLogos reporter。
- [x] 产出 `deltas/test/core-S05-test-cases.md` — 新增 UT-S05-58 起，覆盖以下内容：
  - 当前部署最近 smoke 记录为 `pending` 时 next / status 驻留 `awaiting-manual-acceptance`；
  - 剩余非空时建议含剩余用例与带 `--deploy` 的命令原文，剩余为空时建议重跑 smoke；
  - `auto_execute=false`；
  - `--auto` 不放行；
  - 重新部署或 smoke 得出 PASS / FAIL 后回到既有派生。

  要求 OpenLogos reporter。
- [x] 产出 `deltas/test/core-S09-test-cases.md` — 新增 UT-S09-493 起，覆盖以下内容：
  - guard 对 `openlogos accept` 各形态（独立、复合、`bash -c`、`--help`）的识别与宿主审批 / 阻断；
  - 写了 `manual_acceptance` 的登记表受保护；
  - 未写时保持现有豁免。

  要求 OpenLogos reporter。
- [x] 产出 `deltas/test/core-S08-test-cases.md` — 新增 UT-S08-93 起：`openlogos init` / `sync` 生成的 AGENTS.md / CLAUDE.md 硬红线含「等待人工验收」条目，中英文案各一份。要求 OpenLogos reporter。
- [x] 产出 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 新增「OpenLogos 0.16.25 本机测试环境发布（smoke-manual-acceptance）」：引用「本机测试环境脚本部署（scripts/deploy-local.mjs）」通用方案，只写以下内容：
  - 版本 0.16.25；
  - 回滚目标（test 当前 current_ref aa1d9fd，即 0.16.24）；
  - CHANGELOG；
  - 源码回归范围；
  - 本仓 `openlogos sync`；
  - 安装态 smoke。
- [x] 产出 `deltas/test/smoke/core-smoke-test-cases.md` — 新增「OpenLogos 0.16.25 冒烟阶段人工验收安装态 smoke（SMOKE-core-342 起）」，覆盖以下内容：
  - 安装态版本与制品身份；
  - 全局 CLI 在一次性项目中：SMOKE `[manual]` 行不进自动集合；开启环境在自动全过后返回 `PENDING`（账本 `result=pending`）；`accept --deploy` 全部通过后重跑写 `SMOKE_PASS`；一条失败写 `SMOKE_FAIL`；部署已更换时 accept 零写入；通过后更正为失败使 archive 被拒；全人工项目进入等待；重新部署后旧结果不计入；关闭时只列出；不部署提案的人工用例进入下一次清单；
  - 目标环境非 test 时 runner 先写带原因的 skip。

## [code] 代码实现

- [x] 切片1：SMOKE 人工标记读取与全人工项目的空自动阶段。六维评分 11（影响 2：smoke / 账本 / env / accept / next / archive / guard / 生成指令跨多个子系统；复杂度 2：门禁三态、锁内复核、结论过期与清单计算；契约 2：账本新记录类型、gate.result=PENDING、新命令与 JSON；测试 2：90+ 条 UT/ST/SMOKE；风险 2：账本与 guard 受限命令；不确定性 1：两 commit 间规格行对比），达大任务，按四条端到端能力线垂直拆分。删后续自检：①只做切片 1，SMOKE 人工标记读取、全人工空自动阶段与 manual_smoke_result_id 在 smoke 中即可观察，owned 用例不涉及清单计算（UT-S19-132 需要关闭环境的「未执行的人工用例」，归切片 2）；②只做到切片 2，登记表字段、账本 manual / pending 行读取与过期推导、待验收清单与关闭环境 unexecuted、EnvView 在 env show / smoke 中即可观察，owned 用例只用账本夹具，不依赖 accept 与人工阶段；③accept、smoke 人工阶段、next 等待驻留态与 archive 核对互相咬死（ST-S46-01 同时断言 PENDING、next 驻留态、accept、重跑 PASS 与 archive），向前合并为切片 3；④guard 受限命令与生成指令硬红线不依赖切片 1～3 的运行时行为，与升版及安装态 smoke 合为最后一片（SMOKE-core-343～346 需要前三片全部落地，只能放最后）。 本片：cli/src/lib/smoke-coverage.ts 首格读法容忍 [manual] / [manual/<平台>]（与 MANUAL_MARKER_RE 同源），人工行计为表格用例行不触发全文回退，输出自动集合与人工集合，人工 SMOKE 不计 defined / uncovered / changed_case_ids；smoke 结果出现人工 SMOKE ID 报 manual_smoke_result_id；自动用例为零而存在人工用例（任意 UT/ST/SMOKE）时自动阶段空通过，NO_SMOKE_CASES 只在两类都没有时报出；smoke JSON 输出默认 data.manual_acceptance；未配置项目零变化。同步 UT/ST + OpenLogos reporter。（覆盖 UT-S19-127、UT-S19-128、UT-S19-129、UT-S19-130、UT-S19-131、UT-S19-133、UT-S19-134、ST-S19-40）
- [x] 切片2：登记表人工验收字段、账本 manual / pending 记录与待验收清单。cli/src/lib/environments.ts：manual_acceptance 结构与字段名字面量校验（ENV_FIELD_INVALID / ENV_UNKNOWN_FIELD，不构成受门环境）；账本 kind=manual 行与 smoke result=pending 行的校验与读取；同一次流式扫描推导当前部署（最近一条 deploy 记录及是否已确认）、通过记录过期、基线 B（排除当前部署自身）、已验证集合与晋级候选只认未过期记录（deploy 晋级判定改用该数据）、等待状态与剩余清单；EnvView 与 status 的 manual_acceptance（spec/schema/status.schema.json 同步）。新增 cli/src/lib/manual-acceptance.ts：git ls-tree / git show 枚举 commit 上的人工用例行，计算 P(E, D)（首次全量、增量、行内容变化、regression 解析与 regression_unresolved、目标版本未确认或不可读时 scope_unresolved、基线不可读按全量与 manual_baseline_unavailable），关闭环境计算 unexecuted（相对 previous_ref）与 manual_regression_unknown；smoke 关闭时在报告与 JSON 列出「未执行的人工用例」。同步 UT/ST + OpenLogos reporter。删后续自检：owned 用例只用账本与 git 夹具，不依赖切片 3 的 accept 与人工阶段。（覆盖 UT-S41-30、UT-S41-31、UT-S41-32、UT-S41-33、UT-S41-34、UT-S41-35、UT-S41-36、UT-S41-37、UT-S41-38、UT-S41-39、ST-S41-08、UT-S46-01、UT-S46-02、UT-S46-03、UT-S46-04、UT-S46-05、UT-S46-06、UT-S46-07、UT-S46-08、UT-S46-09、UT-S46-10、UT-S46-11、UT-S46-25、UT-S46-26、UT-S46-27、UT-S46-28、UT-S19-132）
- [x] 切片3：人工结果记录、smoke 人工阶段、等待人工验收与归档核对的完整闭环。新增 cli/src/commands/accept.ts 并在 cli/src/index.ts 注册（参数校验、前置、身份 → 确认状态 → 清单可确定 → 清单成员的判定顺序，锁外预检与锁内复核同序，整批零写入，追加 manual 行，expired_pass，提案通道删除 SMOKE_PASS 及失败时撤销本次账本行，--evidence 警告，JSON 与 i18n）；cli/src/commands/smoke.ts 人工阶段（scope_unresolved / regression_unresolved / cases_failed / PASS+manual_passed / PENDING+manual_pending 判定顺序，账本锁内复核后落账，PENDING 写 pending 行并清除旧标记、版本通道只写账本、失败恢复，JSON manual_acceptance 完整字段）；cli/src/lib/flow-derive.ts、next、status 新增 awaiting-manual-acceptance（剩余非空 auto_execute=false、--auto 不放行；剩余为空建议重跑 smoke；通过过期或不属于本部署回到 ready-to-smoke；spec/schema/next.schema.json 同步）；cli/src/lib/lifecycle-gate.ts / archive：环境开启人工验收或本部署有 manual 记录时以账本核对本部署自己的最近有效结论（smoke_pass_expired）。同步 UT/ST + OpenLogos reporter（含锁内复核与交错执行的测试接缝）。删后续自检：accept、人工阶段、next 与 archive 互相咬死，任一单独成片都过不了 ST-S46-01 / ST-S46-08 / ST-S46-11，故合为一片；只依赖切片 1、2。（覆盖 UT-S46-12、UT-S46-13、UT-S46-14、UT-S46-15、UT-S46-16、UT-S46-17、UT-S46-18、UT-S46-19、UT-S46-20、UT-S46-21、UT-S46-22、UT-S46-23、UT-S46-24、UT-S46-29、UT-S46-30、UT-S46-31、UT-S46-32、UT-S46-33、UT-S46-34、UT-S46-35、UT-S46-36、UT-S46-37、ST-S46-01、ST-S46-02、ST-S46-03、ST-S46-04、ST-S46-05、ST-S46-06、ST-S46-07、ST-S46-08、ST-S46-09、ST-S46-10、ST-S46-11、ST-S46-12、UT-S19-135、UT-S19-136、UT-S19-137、ST-S19-41、UT-S05-58、UT-S05-59、UT-S05-60、UT-S05-61、UT-S05-62、UT-S05-63、UT-S05-64、UT-S05-65、UT-S05-66）
- [x] 切片4：「只能由人记录」防线与 0.16.25 安装态交付。plugin/bin/guard-check 与 plugin-cursor/hooks/runtime.cjs：受限命令类别 accept（任何形态，含 --help，复合与 bash -c / eval 内嵌阻断），登记表识别字段新增 manual_acceptance；plugin-qoder/hooks/runtime.cjs、plugin-workbuddy/hooks/runtime.cjs、plugin-zcode/runtime/hook-runtime.js：decideGuard 在生命周期与安全命令提前放行之前拒绝含 openlogos accept 的命令；cli/src/commands/init.ts 生成指令硬红线新增「等待人工验收」中英条目（initial 不生成，重复 sync 零变化）。升版：node cli/scripts/bump-version.mjs 0.16.25（候选按部署方案复核）、CHANGELOG 新增 0.16.25 条目；新增安装态 smoke runner scripts/smoke-manual-acceptance.js（显式分派 SMOKE-core-342～346，目标非 test 先写 env-not-test skip，窗口为活跃变更或 OPENLOGOS_MA_SMOKE=1，部署前置先读账本与回执，一次性项目内版本通道部署一律 --ref HEAD 并断言 data.status/deploy_id，各用例独立 P），由 scripts/run-smoke.js 发现执行、写 smoke-results.jsonl，完成后跑 smoke 覆盖预检。同步 UT + OpenLogos reporter。删后续自检：本片为最后一片，SMOKE-core-343～346 依赖切片 1～3 全部落地；checkpoint 阶段 SMOKE 由 runner 窗口与部署前置写显式 skip。（覆盖 UT-S09-493、UT-S09-494、UT-S09-495、UT-S09-496、UT-S09-497、UT-S09-498、UT-S09-499、UT-S09-500、UT-S09-501、UT-S09-502、UT-S09-503、UT-S08-93、UT-S08-94、UT-S08-95、UT-S08-96、SMOKE-core-342、SMOKE-core-343、SMOKE-core-344、SMOKE-core-345、SMOKE-core-346）

## [deploy] 部署到 test（本机全局，C03）
- [x] 按已合并部署方案「OpenLogos 0.16.25 本机测试环境发布（smoke-manual-acceptance）」执行 `openlogos deploy --env test`，部署后在本仓执行 `openlogos sync`，确认安装态版本为 0.16.25 且回滚目标为 test 部署前的 current_ref
