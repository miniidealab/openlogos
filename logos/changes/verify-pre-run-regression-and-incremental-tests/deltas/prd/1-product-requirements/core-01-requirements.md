## MODIFIED — S01: 初始化 OpenLogos 项目
### S01: 初始化 OpenLogos 项目
- **触发条件**：用户在空目录中准备创建新项目，或需要把现有目录接入 OpenLogos。
- **用户价值**：一次性生成标准目录、配置、AI 指令文件和基础索引，并尽可能补齐后续验收所需的测试预跑配置。
- **优先级**：P0
- **主路径**：CLI 检查初始化状态，生成目录结构与基础配置，识别常见测试栈，写入或提示 `verify.pre_run_command` / `verify.regression_command`，部署 AI 指令文件，并提示后续从需求文档开始。

#### 验收条件
##### 正常：全新项目初始化
- **GIVEN** 当前目录没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos init my-project`
- **THEN** 生成 `logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md` 和 `CLAUDE.md`

##### 正常：可识别测试栈时补齐 verify 预跑配置
- **GIVEN** 当前目录存在可识别测试配置或脚本（如 Node/Vitest/Jest、pytest、Go、Cargo）
- **WHEN** 用户执行 `openlogos init`
- **THEN** `logos.config.json` 的 `verify` 配置包含可执行的全量测试预跑命令，确保后续 `openlogos verify` 可先生成完整 `test-results.jsonl`

##### 异常：项目已初始化
- **GIVEN** 当前目录已存在 `logos/logos.config.json`
- **WHEN** 用户再次执行 `openlogos init`
- **THEN** 输出错误并退出，不覆盖已有文件

## MODIFIED — S08: 同步 AI 工具资产与资源索引
### S08: 同步 AI 工具资产与资源索引
- **触发条件**：项目配置、AI 工具目标、文档内容或测试栈配置变化后需要刷新。
- **用户价值**：让 AI 工具指令、插件、资源索引与 verify 预跑配置保持同步，减少覆盖率误失败。
- **优先级**：P0
- **主路径**：CLI 同步 `AGENTS.md`、`CLAUDE.md`、插件模板、Skills、`resource_index`，并对缺失的 verify 预跑配置进行补齐或诊断。

#### 验收条件
##### 正常：配置更新后同步
- **GIVEN** `logos.config.json` 或 `logos-project.yaml` 已更新
- **WHEN** 用户执行 `openlogos sync`
- **THEN** 相关 AI 资产与 `resource_index` 被重新生成或补录

##### 正常：旧项目缺失 verify 预跑配置时补齐或提示
- **GIVEN** 已初始化项目缺少 `verify.pre_run_command`、`verify.regression_command` 和 `verify.incremental_command`
- **WHEN** 用户执行 `openlogos sync`
- **THEN** CLI 对可识别测试栈写入默认预跑命令；无法推断时输出明确 TODO，不静默跳过

## MODIFIED — S13: 运行测试验收并生成报告
### S13: 运行测试验收并生成报告
- **触发条件**：实现和测试代码完成后需要验收。
- **用户价值**：把测试结果与测试用例规格关联，生成可读报告，并避免局部测试 JSONL 导致的覆盖率误失败。
- **优先级**：P0
- **主路径**：按配置执行 verify 预跑命令，支持旧的 `pre_run_command` 与新的回归 + 增量两阶段模型，读取合并后的 JSONL 结果和测试用例，计算覆盖度与通过率，写入验收报告。

#### 验收条件
##### 正常：兼容旧的 pre_run_command
- **GIVEN** `logos.config.json` 配置 `verify.pre_run_command`
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 先执行该命令，再读取 `verify.result_path` 中的测试结果

##### 正常：两阶段预跑并合并结果
- **GIVEN** `logos.config.json` 配置 `verify.regression_command` 与 `verify.incremental_command`
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 先执行回归测试，再执行增量测试，并按“同 ID 最后一次结果生效”合并两阶段 JSONL，最终按合并结果计算覆盖度

##### 异常：缺少预跑命令且覆盖不足
- **GIVEN** 项目未配置任何 verify 预跑命令，且 `test-results.jsonl` 覆盖不足
- **WHEN** 用户执行 `openlogos verify`
- **THEN** CLI 输出覆盖不足失败，同时诊断可能只运行了局部测试，并建议配置 `verify.pre_run_command` 或 `verify.regression_command`

## MODIFIED — S16: 输出机器可读 JSON
### S16: 输出机器可读 JSON
- **触发条件**：CI、脚本、RunLogos 或其他工具需要消费 CLI 结果。
- **用户价值**：让 `status`、`verify`、`detect` 等命令能被机器稳定解析，并让客户端理解 verify 预跑状态与覆盖不足诊断。
- **优先级**：P1
- **主路径**：CLI 在文本和 JSON 输出之间切换，保持统一 envelope；`verify --format json` 额外输出预跑阶段、命令执行结果、合并策略、诊断和修复建议。

## MODIFIED — S20: 已有项目接入 OpenLogos
### S20: 已有项目接入 OpenLogos
- **触发条件**：用户在已有代码库（有 `package.json` / `Cargo.toml` / `pyproject.toml` 或其他项目文件）的目录中首次接入 OpenLogos。
- **用户价值**：无需从头补齐全部设计文档，即可立即进入变更管理模式，并让已有项目的 verify 验收从接入开始具备可执行的预跑配置或明确诊断。
- **优先级**：P0
- **主路径**：CLI 检测已有项目信息，交互确认配置，生成 `logos/` 标准目录结构与配置文件，推断并写入 verify 预跑配置或输出 TODO，模块 `bootstrap` 标记为 `skipped`，`lifecycle` 直接设为 `launched`，输出接入报告并建议创建补文档提案。

#### 验收条件
##### 正常：已有项目快速接入
- **GIVEN** 当前目录存在 `package.json`（或其他项目清单文件），且没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 生成 `logos/` 标准目录、`logos.config.json`、`logos-project.yaml`（含 `bootstrap: skipped`、`lifecycle: launched`）、`AGENTS.md` 和 `CLAUDE.md`；输出接入报告并建议执行 `openlogos change add-baseline-docs`

##### 正常：可识别测试栈时补齐 verify 预跑配置
- **GIVEN** 已有项目包含可识别测试脚本或测试框架配置
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 生成的 `logos.config.json` 包含可执行的 verify 全量预跑命令，RunLogos 仍只需调用 `openlogos verify --format json`

##### 正常：无法推断测试命令时输出 TODO
- **GIVEN** 已有项目无法推断测试命令
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 在接入报告中输出明确 TODO，提示用户补充 `verify.pre_run_command` 或 `verify.regression_command`
