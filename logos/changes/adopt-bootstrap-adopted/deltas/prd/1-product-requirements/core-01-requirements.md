## MODIFIED — ### S20: 已有项目接入 OpenLogos
### S20: 已有项目接入 OpenLogos
- **触发条件**：用户在已有代码库（有 `package.json` / `Cargo.toml` / `pyproject.toml` 或其他项目文件）的目录中首次接入 OpenLogos，且当前目录没有 `logos/logos.config.json`。
- **用户价值**：用户不需要把存量代码当作全新项目从零推进，但仍能一次性获得完整 OpenLogos 基础设施、AI 工具资产、语言策略、verify 预跑配置和变更管理入口。
- **优先级**：P0
- **主路径**：CLI 检测已有项目信息，交互确认项目名、文档语言与 AI 工具，按 `init` 等价能力生成完整 `logos/` 标准目录结构、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 与目标 AI 工具资产；推断并写入 verify 预跑配置或输出 TODO；模块写入 `bootstrap: adopted` 与 `lifecycle: launched`，表示“通过存量项目接入进入迭代工作流，但 Initial 文档基线尚待补齐”；输出接入报告并建议创建补文档提案。

#### 验收条件
##### 正常：已有项目完整接入
- **GIVEN** 当前目录存在 `package.json`（或其他项目清单文件），且没有 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 生成与 `init` 同级别的基础设施：`logos/` 标准目录、`logos.config.json`、`logos-project.yaml`、`AGENTS.md`、`CLAUDE.md`、`logos/spec/` 和所选 AI tools 的 Skills / 插件 / 命令资产；`logos-project.yaml` 中模块包含 `bootstrap: adopted` 与 `lifecycle: launched`；输出接入报告并建议执行 `openlogos change add-baseline-docs`

##### 正常：语言和 AI 工具选择
- **GIVEN** 用户在无 `logos/` 的存量项目目录中执行 `openlogos adopt`
- **WHEN** 命令进入检测与确认阶段
- **THEN** 用户可以通过交互或 `--locale <en|zh>` 选择文档语言，并通过交互或 `--ai-tool <claude-code|opencode|codex|cursor|other|all>` 选择 AI 工具；生成的 `logos.config.json`、根目录指令文件和 AI 资产必须与选择一致

##### 正常：可识别测试栈时补齐 verify 预跑配置
- **GIVEN** 已有项目包含可识别测试脚本或测试框架配置
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 生成的 `logos.config.json` 包含可执行的 verify 全量预跑命令，RunLogos 仍只需调用 `openlogos verify --format json`

##### 正常：无法推断测试命令时输出 TODO
- **GIVEN** 已有项目无法推断测试命令
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** CLI 在接入报告中输出明确 TODO，提示用户补充 `verify.pre_run_command` 或 `verify.regression_command`

##### 正常：接入后 next 引导补文档
- **GIVEN** 项目已通过 `adopt` 接入（`bootstrap: adopted`），且无活跃变更提案
- **WHEN** 用户执行 `openlogos next`
- **THEN** 输出补文档引导，建议先执行 `openlogos change add-baseline-docs`，不建议直接开始业务迭代

##### 正常：status 不将 Initial 文档缺失显示为错误
- **GIVEN** 项目已通过 `adopt` 接入（`bootstrap: adopted`）
- **WHEN** 用户执行 `openlogos status`
- **THEN** Phase 1、Phase 2 和 Phase 3-0 显示为「文档基线已跳过（存量项目接入）」，不显示为未完成或错误

##### 正常：launch 对存量项目接入模块豁免 Initial 文档门禁
- **GIVEN** 项目模块 `bootstrap: adopted` 且 `lifecycle: launched`
- **WHEN** 用户执行 `openlogos launch`
- **THEN** 不检查 Phase 1、Phase 2 和 Phase 3-0 文档是否存在，直接放行

##### 正常：历史 skipped 项目兼容
- **GIVEN** 历史项目的 `logos-project.yaml` 中存在 `bootstrap: skipped`
- **WHEN** 用户执行 `openlogos status`、`openlogos next`、`openlogos launch` 或 `openlogos detect --format json`
- **THEN** CLI 将其按存量项目接入模式处理，不破坏补文档引导、状态展示、launch 豁免和生命周期派生；新写入的项目必须使用 `bootstrap: adopted`

##### 异常：目录已存在 logos/ 时拒绝重复接入
- **GIVEN** 当前目录已存在 `logos/logos.config.json`
- **WHEN** 用户执行 `openlogos adopt`
- **THEN** 输出错误并退出，不覆盖已有文件；提示用户该项目已初始化
