# S08: 同步 AI 工具资产与资源索引 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S08-01 | 同步项目名 | syncLogosProjectName | yaml 与 config 名称不一致 | sync | 修正名称 |
| UT-S08-02 | 补全 scenarios.module | syncScenariosModuleField | scenarios 缺失 module | sync | 回填 module |
| UT-S08-03 | 同步时补齐 verify.pre_run_command | sync 逻辑 | 已初始化项目缺少预跑配置但可识别测试栈 | sync | 写入全量测试命令 |
| UT-S08-04 | 同步时无法推断测试命令 | sync 逻辑 | 已初始化项目缺少预跑配置且无法识别测试栈 | sync | 输出 TODO，不写入伪造命令 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S08-01 | 同步 AI 资产与索引 | Step 1→8 | 已初始化 | 执行 sync | 更新 AGENTS、CLAUDE 与 resource_index，并在可识别测试栈时补齐 verify 预跑配置 |
| ST-S08-02 | 旧项目缺失 verify 预跑配置时输出诊断 | Step 1→8 | 已初始化且缺少预跑配置 | 执行 sync | 输出 verify 预跑配置补齐结果或 TODO 诊断，不静默跳过 |

## 三、覆盖度校验
- [x] 同步项目名：已覆盖（UT-S08-01）
- [x] 补全 scenarios.module：已覆盖（UT-S08-02）
- [x] 同步时补齐 verify 预跑配置：已覆盖（UT-S08-03）
- [x] 无法推断时输出 TODO：已覆盖（UT-S08-04）
- [x] sync 主路径：已覆盖（ST-S08-01）
- [x] sync 诊断路径：已覆盖（ST-S08-02）
