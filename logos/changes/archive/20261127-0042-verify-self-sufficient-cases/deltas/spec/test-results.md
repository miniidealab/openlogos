## MODIFIED — 字段定义

每行是一个 JSON 对象，包含以下字段：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 用例 ID，与 `test-cases.md` 中的 `UT-xx` / `ST-xx` 完全一致 |
| `status` | `"pass"` \| `"fail"` \| `"skip"` | 是 | 运行结果 |
| `duration_ms` | number | 否 | 执行耗时（毫秒） |
| `timestamp` | string (ISO 8601) | 否 | 执行时间，如 `2026-04-03T15:30:01Z` |
| `error` | string | `status=fail` 时必需 | 失败原因（断言错误信息） |
| `scenario` | string | 否 | 场景编号（如 `S01`），用于验证 ID 前缀一致性 |
| `reason_code` | string | 否 | 机器可读的跳过原因（verify-self-sufficient-cases）；平台跳过固定为 `"platform-unavailable"`，见「verify 跳过分类」 |
| `detail` | string | 否 | 跳过原因说明；平台跳过时必须为非空字符串，写明需要的平台或执行条件（如 `requires win32`） |

### 示例

```jsonl
{"id":"UT-S01-01","status":"pass","duration_ms":12,"timestamp":"2026-04-03T15:30:01Z"}
{"id":"UT-S01-02","status":"fail","duration_ms":45,"timestamp":"2026-04-03T15:30:01Z","error":"Expected exit code 0, got 1"}
{"id":"UT-S01-03","status":"skip","timestamp":"2026-04-03T15:30:01Z"}
{"id":"ST-S01-01","status":"pass","duration_ms":230,"timestamp":"2026-04-03T15:30:02Z","scenario":"S01"}
{"id":"ST-S01-30","status":"skip","timestamp":"2026-04-03T15:30:02Z","reason_code":"platform-unavailable","detail":"requires win32"}
```

### 字段约束

- `id` 必须匹配正则 `^(UT|ST)-S\d{2}-\d{2,3}$`
- `status` 仅允许三个值：`pass`、`fail`、`skip`
- `error` 在 `status=fail` 时必须提供，其他状态可省略
- `reason_code` / `detail` 可选，旧记录不写时原样有效；它们不改变 `status` 的语义，只供「verify 跳过分类」判定
- 同一个 `id` 如果出现多次（如重试），`openlogos verify` 按「同 ID timestamp 去重全序规则」取最新一次的结果（完整算法见「JSONL 结果账本一致性与 Gate 判据 → 归一化规则」；该 ID 存在任一缺失/非法 `timestamp` 时整组退回文件行序 last-wins，等价旧行为——旧 reporter 不写 `timestamp`，产物零行为变化）

### `[manual]` 标记用例

`[manual]` 表示**需要人参与**的 UT/ST 用例（verify-self-sufficient-cases，功能规格 §2.106.2）。在 `test-cases.md` 中，于首格 ID 后追加标记：

```markdown
| ST-S01-05 [manual] | 需要人在真实终端里观察颜色与光标 | ... |
| UT-S01-77 [manual/windows] | 需要人在 Windows 上确认系统弹窗 | ... |
```

**判据**：保留预装的机器环境，换一个待验版本（新的提交或制品），移除上一版本的结果与人工证据后，verify 命令能自行产生适用于新版本的证据——不需要人参与，不标 `[manual]`；否则需要人参与，必须标 `[manual]`。

- 机器自动签发、采集或获取的证据可用于自动验收；每个版本都要人重新准备的证据（例如带制品摘要的外部证据索引、人工截图）归入需要人参与。
- 一次性准备机器（安装 Docker、JDK、编译器等）不算人参与，但必须在 `verify.requirements` 中声明，见「verify 环境要求声明、对账与预检」。
- 典型的需要人参与情形：人工观察真实 TTY/PTY 渲染或界面效果、点击系统确认框、插拔设备、在实机上安装签名包、输入验证码、每个版本提供新的凭据或证据文件。
- `[manual/<平台>]` 表示「需要人参与，且在该平台上执行」。
- 本节只约束 UT/ST。SMOKE 用例的人工标记及其读取、待验与记录规则由后续需求（openlogos #3）交付，在此之前 SMOKE 的读取与判定不变。

`[manual]` 用例的行为规则：

- **不写入 JSONL**：`[manual]` 用例不由自动化测试执行，不产出 JSONL 记录；出现即 `manual_test_result_id`
- **不计入 `defined_count`**：`openlogos verify` 扫描 test-cases.md 时跳过这类用例，不计入覆盖率分母
- **不出现在 `uncovered_cases`**：不会因为缺少运行结果而报告为未覆盖
- **单独计入 `manual_count`**：在 summary 中以独立字段展示，方便感知人工用例数量
- **AC trace 中标记为 `MANUAL_PENDING`**：若某个验收条件（AC）关联的用例全部为 `[manual]`，该 AC 标记为 `🔵 MANUAL`（人工待验），不触发 Gate 3.5 失败

#### 人工用例不得被测试入口启动

verify 只在统计时排除人工 ID，预跑命令整条执行，reporter 在测试结束后才处理结果——这些都挡不住人工用例被启动。因此：

- 项目的 verify 预跑命令（`pre_run_command` / `regression_command` / `incremental_command`，含 `verify.modules.<id>` 命令组）必须在**调度前**排除 `[manual]` 用例的测试代码，沿用项目已有的测试分组、独立文件命名或独立入口（例如 vitest 的 `exclude` 匹配 `*.manual.test.ts`、pytest 以 marker 反选 `-m "not manual"`）。
- 人工用例的测试代码可以保留，供人工验收时用独立入口启动。
- 验收方式：已标人工的用例一旦被启动就写哨兵文件；普通最终 verify 完成后，自动用例有结果、哨兵文件不存在。

## ADDED — verify 环境要求声明、对账与预检（verify-self-sufficient-cases）

不需要人参与的用例可以对机器提要求，但要求必须声明在 `logos/logos.config.json`，并在执行任何预跑命令前由 verify 检查（功能规格 §2.106.4、§2.106.5）。

### 声明

```json
{
  "verify": {
    "requirements": {
      "env": ["DB_URL"],
      "commands": ["docker"],
      "checks": [{ "name": "db-ready", "command": "node scripts/check-db.mjs" }]
    },
    "modules": {
      "backend": { "requirements": { "commands": ["mvn"] } }
    }
  }
}
```

- `env`：变量名数组，要求变量存在且值非空。
- `commands`：命令名数组（不含路径与参数），要求能在 `PATH` 上解析到可执行文件。
- `checks`：`{name, command}` 数组，`name` 唯一且匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`；以 shell 执行 `command`，限时 60 秒内退出码为 0。检查命令应跨平台可执行（推荐用 `node` 脚本）。
- 生效集合：
  - 未启用模块范围时，生效集合即项目级 `verify.requirements`。
  - 启用时，先沿用既有命令组选择得到本次实际执行的命令组，只对这些命令组服务的模块 m 求 E(m)（被选择器跳过、没有任何命令的模块不检查）：项目级加上 `verify.modules.<m>.requirements`，m 的同名 check 只替换 m 自己的那一项。
  - 再合并：`env`、`commands` 取并集；名称与命令都相同的 check 合并为一项；名称相同、命令不同的 check 分别执行，诊断带归属模块（功能规格 §2.106.4）。
- 「实际执行的命令组」只用于选择模块级要求：本次没有任何预跑命令执行时，模块级要求不检查，显式声明的项目级要求仍照常预检，缺项即在读取任何结果文件前判 `verify_env_not_ready`（结构校验与对账照常）。
- 不过滤未声明的环境变量：预跑命令照旧继承调用时的全部环境。
- 执行环境：
  - `env` 与 `commands` 按预跑命令将继承的环境与 `PATH` 判定。
  - `checks` 经与预跑命令同一个沙箱执行器执行：同一 `sandbox_mode` 与复用配置，工作目录为（沙箱工作副本中的）项目根，写回白名单为空，注入 `OPENLOGOS_VERIFY_MODULES` 为归属模块。
  - 隔离失败按既有沙箱模式规则处理（`always` 判 FAIL 且不执行预跑；`auto` 按既有规则降级）。
  - 无隔离（`sandbox_mode: off` 或 `auto` 降级）时，检查命令与预跑命令一样在源工作区的项目根执行，不承诺源工作区保护；因此**检查命令必须只读**，不创建、不修改文件。verify 以 `data.requirements.isolation`（`"sandboxed"` / `"unisolated"`）与验收报告标注本次检查是否隔离。
- 平台限定用例的前置工具写成 `checks`，触发条件必须与用例完整适用条件同源（同一判定）：适用条件任一不成立时直接退出 0，用例写平台跳过。

### 写入责任

proposal「验收标准」的「自动验收环境要求」以 `env:<名>` / `command:<名>` / `check:<名>` 条目记录预期配置差异；merge 后的 `[code]` 实现任务在活跃提案内把它们写入 `verify.requirements`。`.gitignore`、`.git/info/exclude` 与 `logos.config.json` 的 `guard` 字段不在此列，仍只能经 `openlogos ignore|exempt` 修改。

### 执行顺序

在任何预跑命令之前依次执行，前一步失败不再执行后一步：

1. 结构校验：类型不符、`name` 重复或非法 → `verify_requirements_invalid`。
2. 对账（仅当有活跃提案且「自动验收环境要求」列出条目）：每个条目都必须出现在生效集合对应字段 → 否则 `acceptance_requirement_undeclared`。
3. 预检：逐项检查生效集合 → 缺任一项 `verify_env_not_ready`，诊断逐项列出 `{kind, name, detail}`；**只写变量名，不写变量值**；check 的 `detail` 只写退出码或「超时」，不写命令输出。

任一步失败时：

- 门禁 FAIL，不执行任何预跑命令，不截断、也不读取任何结果文件，上次留下的账本不成为本轮证据；
- 本次覆盖的 initial 模块验收报告改写为 FAIL（见「多模块项目的模块验收报告与模块冒烟报告」→「模块验收报告」）；
- 验收历史记 `result_source: "none"`（见「验收历史留存」→「结果来源」）。

## ADDED — verify 跳过分类（verify-self-sufficient-cases）

本节补充「skip 结果的有效通过语义」：对**严格判定集合**中的 UT/ST 收紧 skip，其余口径不变（功能规格 §2.106.6）。

严格判定集合取自活跃提案 `SPEC_MERGED.test_change_set.changed_test_ids`，必须经正式读取器校验（与 `spec/test-slice-manifest.md` §13.3 的同一读取器）。按读取状态分三种：

- 尚未 merge（无活跃提案或没有 `SPEC_MERGED`）：严格集合为空，只出警告；
- 读取器判有效：取其集合，读取器认可的合法空集即为空集；
- 已有 `SPEC_MERGED` 但读取器判无效：拒绝采信、不推导为空集，报 `test_change_set_invalid`，门禁 FAIL、不得产生最终 PASS。

切片 checkpoint 模式下与可计入集合求交，pending 用例没有结果仍合法。

| 情形 | 判定 | 输出 |
|---|---|---|
| 严格集合内，`reason_code === "platform-unavailable"` 且 `detail` 非空 | 平台跳过，放行 | `platform_skipped_cases: [{id, detail}]`，报告单独列出 |
| 严格集合内，其余 skip（无 `reason_code`、取其他值、`detail` 缺失或为空） | 用例分层错误，门禁 FAIL | `tier_mismatch_cases`，`gate.reason = "case_tier_mismatch"`（优先级见功能规格 §2.106.7） |
| 严格集合外（存量）或无活跃提案，非平台 skip | 口径不变（有效通过） | 警告 `unclassified_skipped_cases`，不改门禁与退出码 |

- 三个子集都是 `skipped_cases` 的子集；统计不变量不变。
- 用例分层错误的修复方式只有两种：准备好环境并声明到 `verify.requirements`，或把用例改标 `[manual]`。
- 本节不适用于 SMOKE；smoke 的跳过规则见功能规格 §2.48，不变。

## ADDED — 平台跳过原因的 reporter 写法（verify-self-sufficient-cases）

reporter 写平台跳过时，按用例**实际的**不适用条件写 `reason_code` 与 `detail`，不能把环境缺失写成平台跳过：

- 用例声明自己的适用条件（平台、执行身份、平台能力），条件不成立时 reporter 写 `{"status":"skip","reason_code":"platform-unavailable","detail":"<需要的条件>"}`。
- 适用条件全部成立、但缺少前置工具时，不得跳过：该工具应在 `verify.requirements.checks` 中声明（触发条件与用例同源），由预检报 `verify_env_not_ready`。
- TypeScript（vitest / jest）：共享 reporter 提供登记平台跳过原因的入口（例如测试文件以 `platformSkip(id, detail)` 登记、reporter 在写 skip 行时读取），避免用框架的通用 `skipIf` 丢失原因；Python（pytest）可用 `pytest.mark.skipif(..., reason=...)` 并约定 `platform-unavailable:` 前缀映射为 `reason_code`；Go 在 `t.Skip` 消息中使用同一前缀。具体写法以各语言模板为准，判据以本节与「verify 跳过分类」为准。

## MODIFIED — 多模块项目的模块验收报告与模块冒烟报告（module-scoped-phase-reports） > 模块验收报告

- **写入对象**：本次 verify 覆盖的 initial 模块——范围未启用、`--all`、`fallback-full` 时为全部已登记模块中的 initial 模块；`module` 模式时为范围 M 中的 initial 模块。未覆盖模块的已有报告保持不动。
- **用例子集 U(m)**：m 前缀测试规格中的用例 ∪ 不带已登记模块前缀的测试规格中的用例，文件判据与「按模块限定 verify 范围的运行约定」中范围 M={m} 时相同。本提案的变更用例只在属于这些规格时计入。U(m) 为空时不写。手工用例的排除规则与共用报告相同。
- **模块 Gate**：以下全部成立才为 PASS：
  1. U(m) 内零失败、零未覆盖；
  2. 带 `modules` 的预跑命令组非零退出时，只计入该组 `modules` 中的模块；不带 `modules` 的预跑命令（范围未启用时的项目级命令）非零退出，计入每个被覆盖模块；
  3. 无法按用例或命令组归属的拒绝——结果账本不自洽、未定义结果 ID、沙箱判定失败、切片核验失败——计入每个被覆盖模块；
  4. **verify 环境预检类原因**（verify-self-sufficient-cases，功能规格 §2.106.7A）——`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready` 任一命中时，本次没有执行测试，计入每个被覆盖模块；诊断中只属于某些模块的 check 失败，在这些模块的报告里点名，其余被覆盖模块的报告写明「本次未执行测试」；
  5. **用例分层错误**（verify-self-sufficient-cases）——`tier_mismatch_cases` 中属于 U(m) 的 ID 计入 m，不属于的模块不受影响；
  6. **测试变更集无效**（`test_change_set_invalid`，verify-self-sufficient-cases）——计入每个被覆盖模块。
- **预检失败时的写法**：不读取任何结果文件，不计算子集统计；每个被覆盖模块的报告整份覆盖为 FAIL：Summary 表「模块」行照常，计数显示「未执行」，Gate 行为 FAIL，正文写明原因与缺失项。旧的 PASS 报告因此被撤销。
- **写入时机**：全部门禁（含沙箱改判）裁决之后、verify 输出最终结果之前；预检类原因判 FAIL 属于已算出 Gate，照常写入；在算出 Gate 之前就中止时不写。切片 checkpoint 下的写入边界不变。
- runner 无需为模块报告做任何改动：子集统计与归属只使用既有结果行、`pre_run.commands[].modules` 与预检诊断中的归属模块。

## MODIFIED — 验收历史留存（verification-history） > 结果来源

- `result_source: "executed"`：本次调用执行了预跑 / 两阶段命令或 smoke 命令。
- `result_source: "reused"`：本次调用只读取了既有结果文件。
- `result_source: "none"`（verify-self-sufficient-cases，功能规格 §2.104.3、§2.106.5）：verify 因环境预检类原因（`verify_requirements_invalid`、`acceptance_requirement_undeclared`、`verify_env_not_ready`）判 FAIL，本次既未执行任何命令，也未读取任何结果文件。此时记录为 `outcome: "completed"`、`gate.result: "FAIL"`、`gate.reason` 为该原因；`counts` 各项为 null；`failed_ids` / `skipped_ids` / `uncovered_ids` 为空数组。报告快照沿用「三层数据与字段边界」的留存策略：无活跃提案时只写中央索引；有活跃提案且 `verify.history.raw_in_proposal` 为 `true` 时，提案完整记录写 `record.json` 与 `report.md`；为 `false` 时，提案完整记录只写 `record.json`，`report.md` 写本机原文目录。任何情况下都不写本轮 `results.jsonl` / `results-raw.jsonl`，上次留下的结果文件不被复制或引用。
- 读取兼容：0.16.24 起的读取方接受三个取值；更早版本的读取方把含 `"none"` 的记录当作损坏记录跳过并提示，不影响其他记录。
