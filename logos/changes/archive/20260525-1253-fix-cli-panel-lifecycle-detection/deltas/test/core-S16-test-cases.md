## MODIFIED — core-S16: 输出机器可读 JSON — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S16-01 | 解析 format=json | parseFormat | CLI 参数 | --format json | 返回 json |
| UT-JSON-09 | `collectDetectData` 在可恢复 YAML 损坏下仍返回 launched 生命周期 | collectDetectData | `logos-project.yaml` 前半段 modules 完整，后半段存在语法错误 | detect helper | `project.modules` 存在，`project.lifecycle=launched`，并返回 `yaml_diagnostics.parse_status=recovered` |
| UT-JSON-10 | `collectStatusData` 在可恢复 YAML 损坏下仍返回 modules | collectStatusData | 同上 | status helper | `modules` 存在，`lifecycle=launched`，并返回 `yaml_diagnostics.parse_status=recovered` |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S16-01 | 输出 JSON envelope | Step 1→5 | 传入 json | detect/status/verify --format json | 返回统一 envelope |

### 2.2 异常路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-JSON-21 | detect --format json 在局部损坏 YAML 下仍暴露 launched 模块 | Step 1→5 | `logos-project.yaml` 部分损坏但 `modules` 可恢复 | detect --format json | `project.modules[0].lifecycle=launched`，`project.lifecycle=launched`，`yaml_diagnostics.parse_status=recovered` |
| ST-JSON-22 | status --format json 在局部损坏 YAML 下仍暴露 launched 模块 | Step 1→5 | 同上 | status --format json | `modules[0].lifecycle=launched`，`lifecycle=launched`，`yaml_diagnostics.parse_status=recovered` |
| ST-JSON-23 | detect/status --format json 在无法恢复 YAML 时返回诊断 | Step 1→5 | `logos-project.yaml` 整体损坏，无法恢复任何模块信息 | detect/status --format json | 返回明确 `yaml_diagnostics.parse_status=error` 与错误摘要，不得静默回退为“看起来正常” |

