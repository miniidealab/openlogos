# S16: 输出机器可读 JSON — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S16-01 | 解析 format=json | parseFormat | CLI 参数 | --format json | 返回 json |
| UT-JSON-09 | `collectDetectData` 在可恢复 YAML 损坏下仍返回 launched 生命周期 | collectDetectData | `logos-project.yaml` 前半段 modules 完整，后半段存在语法错误 | detect helper | `project.modules` 存在，`project.lifecycle=launched`，并返回 `yaml_diagnostics.parse_status=recovered` |
| UT-JSON-10 | `collectStatusData` 在可恢复 YAML 损坏下仍返回 modules | collectStatusData | 同上 | status helper | `modules` 存在，`lifecycle=launched`，并返回 `yaml_diagnostics.parse_status=recovered` |
| UT-JSON-11 | `collectVerifyData` 暴露单阶段 pre_run 状态 | collectVerifyData | 配置 pre_run_command | verify helper | `pre_run.mode=pre_run_command`，包含命令状态与 final result_path |
| UT-JSON-12 | `collectVerifyData` 暴露两阶段预跑状态 | collectVerifyData | 配置 regression_command + incremental_command | verify helper | `pre_run.mode=two_phase`，包含阶段命令、合并策略与阶段结果路径 |
| UT-JSON-13 | `collectVerifyData` 暴露覆盖不足诊断 | collectVerifyData | 未配置预跑命令且覆盖不足 | verify helper | `pre_run.mode=none`，包含局部测试诊断与配置建议 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S16-01 | 输出 JSON envelope | Step 1→5 | 传入 json | detect/status/verify --format json | 返回统一 envelope |
| ST-JSON-24 | verify --format json 暴露单阶段 pre_run 状态 | Step 1→5 | 配置 pre_run_command | verify --format json | 返回 `pre_run.mode=pre_run_command`，且 commands 中包含执行状态 |
| ST-JSON-25 | verify --format json 暴露两阶段状态与合并策略 | Step 1→5 | 配置 regression/incremental 命令 | verify --format json | 返回 `pre_run.mode=two_phase`、阶段命令状态、结果路径和合并策略 |

### 2.2 异常路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-JSON-21 | detect --format json 在局部损坏 YAML 下仍暴露 launched 模块 | Step 1→5 | `logos-project.yaml` 部分损坏但 `modules` 可恢复 | detect --format json | `project.modules[0].lifecycle=launched`，`project.lifecycle=launched`，`yaml_diagnostics.parse_status=recovered` |
| ST-JSON-22 | status --format json 在局部损坏 YAML 下仍暴露 launched 模块 | Step 1→5 | 同上 | status --format json | `modules[0].lifecycle=launched`，`lifecycle=launched`，`yaml_diagnostics.parse_status=recovered` |
| ST-JSON-23 | detect/status --format json 在无法恢复 YAML 时返回诊断 | Step 1→5 | `logos-project.yaml` 整体损坏，无法恢复任何模块信息 | detect/status --format json | 返回明确 `yaml_diagnostics.parse_status=error` 与错误摘要，不得静默回退为“看起来正常” |
| ST-JSON-26 | verify --format json 在覆盖不足且无预跑配置时返回诊断 | Step 1→5 | 未配置预跑命令且结果不完整 | verify --format json | `pre_run.mode=none`，`diagnostics` 与 `suggestions` 可供 RunLogos 展示 |

## 三、覆盖度校验
- [x] format=json envelope：已覆盖（UT-S16-01 / ST-S16-01）
- [x] detect/status 容错：已覆盖（UT-JSON-09 / UT-JSON-10 / ST-JSON-21 / ST-JSON-22 / ST-JSON-23）
- [x] verify 单阶段 pre_run 状态：已覆盖（UT-JSON-11 / ST-JSON-24）
- [x] verify 两阶段状态与合并策略：已覆盖（UT-JSON-12 / ST-JSON-25）
- [x] verify 覆盖不足诊断：已覆盖（UT-JSON-13 / ST-JSON-26）

## 四、golden characterization 归属（机器可读 JSON 契约锚点）

`cli/test/golden-baseline.test.ts` 在录制 `status` / `next --format json` 快照时，同时**表征**
S16（输出机器可读 JSON）所定义的通用信封与 data schema 现状行为——golden 快照本身就是 S16
JSON 契约的字节级实例。

归属说明：
- 该 golden 测试**表征**（characterize）S16 现状 JSON 输出，而非定义新契约；本切片
  （flow-engine-foundation）应**全部通过**。
- 其作用是在后续 flow 派生切换切片（切片 B）时，作为"JSON 输出 1:1 不漂移"的等价锚点——
  若派生切换改变了 `--format json` 的字段或结构，golden 快照将立即失败。
- golden 测试不替代 S16 既有 UT/ST 用例，二者并存：S16 用例验证信封/字段契约定义；
  golden 快照锁定整段 JSON 的字节级等价。
