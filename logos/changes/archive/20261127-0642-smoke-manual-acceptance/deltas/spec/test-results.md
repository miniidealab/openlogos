## MODIFIED — `[manual]` 标记用例

`[manual]` 表示**需要人参与**的 UT / ST / SMOKE 用例（verify-self-sufficient-cases，功能规格 §2.106.2；SMOKE 来源变更 smoke-manual-acceptance，功能规格 §2.107.2）。在 `test-cases.md` 中，于首格 ID 后追加标记：

```markdown
| ST-S01-05 [manual] | 需要人在真实终端里观察颜色与光标 | ... |
| UT-S01-77 [manual/windows] | 需要人在 Windows 上确认系统弹窗 | ... |
| SMOKE-core-12 [manual] | 需要人在实机上安装签名包并确认首启界面 | ... |
```

**判据**：保留预装的机器环境，换一个待验版本（新的提交或制品），移除上一版本的结果与人工证据后，verify 命令能自行产生适用于新版本的证据——不需要人参与，不标 `[manual]`；否则需要人参与，必须标 `[manual]`。

- 机器自动签发、采集或获取的证据可用于自动验收；每个版本都要人重新准备的证据（例如带制品摘要的外部证据索引、人工截图）归入需要人参与。
- 一次性准备机器（安装 Docker、JDK、编译器等）不算人参与，但必须在 `verify.requirements` 中声明，见「verify 环境要求声明、对账与预检」。
- 典型的需要人参与情形：人工观察真实 TTY/PTY 渲染或界面效果、点击系统确认框、插拔设备、在实机上安装签名包、输入验证码、每个版本提供新的凭据或证据文件。
- `[manual/<平台>]` 表示「需要人参与，且在该平台上执行」。
- 判据对 UT、ST、SMOKE 相同。人工用例在部署后的冒烟阶段按环境开关由人执行并记录（`openlogos accept`），待验收清单、记录与门禁规则见本文件「Smoke 人工用例与冒烟阶段人工验收」与 `spec/environments.md` §15。

`[manual]` 用例的行为规则：

- **不写入 JSONL**：`[manual]` 用例不由自动化测试执行，不产出 JSONL 记录；UT/ST 结果出现即 `manual_test_result_id`，SMOKE 结果出现即 `manual_smoke_result_id`
- **不计入 `defined_count`**：`openlogos verify` 扫描 test-cases.md 时跳过这类用例，不计入覆盖率分母
- **不出现在 `uncovered_cases`**：不会因为缺少运行结果而报告为未覆盖
- **单独计入 `manual_count`**：在 summary 中以独立字段展示，方便感知人工用例数量
- **AC trace 中标记为 `MANUAL_PENDING`**：若某个验收条件（AC）关联的用例全部为 `[manual]`，该 AC 标记为 `🔵 MANUAL`（人工待验），不触发 Gate 3.5 失败；人工结果在冒烟阶段记录，不回写 verify 的 AC trace

#### 人工用例不得被测试入口启动

verify 只在统计时排除人工 ID，预跑命令整条执行，reporter 在测试结束后才处理结果——这些都挡不住人工用例被启动。因此：

- 项目的 verify 预跑命令（`pre_run_command` / `regression_command` / `incremental_command`，含 `verify.modules.<id>` 命令组）必须在**调度前**排除 `[manual]` 用例的测试代码，沿用项目已有的测试分组、独立文件命名或独立入口（例如 vitest 的 `exclude` 匹配 `*.manual.test.ts`、pytest 以 marker 反选 `-m "not manual"`）。
- 人工用例的测试代码可以保留，供人工验收时用独立入口启动。
- 验收方式：已标人工的用例一旦被启动就写哨兵文件；普通最终 verify 完成后，自动用例有结果、哨兵文件不存在。

## ADDED — Smoke 人工用例与冒烟阶段人工验收（smoke-manual-acceptance）

> 来源变更：smoke-manual-acceptance（功能规格 §2.107）。环境开关、账本记录、待验收清单与门禁的权威定义见 `spec/environments.md` §15；本节只约束测试规格与 smoke 结果文件。

### 首格读法

- smoke 规格的首格读法与 UT/ST 同源：`| SMOKE-<…> |` 为自动用例，`| SMOKE-<…> [manual] |` 或 `| SMOKE-<…> [manual/<平台>] |` 为人工用例。
- 两种行都计为「表格用例行」；一份文件只要有任一表格用例行，就不退回全文扫描。
- 人工 SMOKE 不计入自动 defined 集合与覆盖率，不出现在 `uncovered_cases`，不要求 runner，不进入本提案变更用例的必要证据判定（「smoke skip 统计口径」）。

### 结果文件

- runner 不得为人工 SMOKE 写结果行；出现即门禁 FAIL，诊断 `manual_smoke_result_id`。
- 人工结果不写进 `smoke-results.jsonl`，由 `openlogos accept` 写进本机部署账本（`kind=manual`）。

### 全人工项目

- 自动 SMOKE 用例为零、存在人工用例（任意 UT / ST / SMOKE）时，smoke 的自动阶段视为空通过：不要求 runner 与结果文件，不报 `NO_SMOKE_RESULTS` / `NO_SMOKE_CASES`。
- 这类 smoke 没有结果行，`env_evidence=missing`、`verified=false`，不能作为晋级依据；需要晋级的项目须至少有一条自动 smoke 用例。

### runner 窗口

人工用例的测试代码（如有）不得被 `smoke.command` 的默认 dispatcher 启动，沿用「人工用例不得被测试入口启动」的做法：独立文件命名或独立入口。
