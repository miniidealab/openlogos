# S01: 初始化 OpenLogos 项目 — 测试用例


## 一、单元测试用例
### 1.1 初始化前置校验
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S01-01 | 读取 package.json 项目名 | 初始化逻辑 | 存在 package.json | 项目目录 | 返回目录名或 package 名 |
| UT-S01-02 | 已安装项目应拒绝重复初始化 | 初始化逻辑 | 已存在 `logos/logos.config.json` | init | 返回错误 |
| UT-S01-03 | 可识别测试栈时写入 verify.pre_run_command | 初始化逻辑 | 存在可识别测试脚本或框架配置 | init | 写入可执行的全量测试预跑命令 |
| UT-S01-04 | 无法推断测试命令时输出 TODO | 初始化逻辑 | 无可识别测试脚本或框架配置 | init | 保留 `verify.result_path`，并输出补齐提示 |
| UT-S01-45 | 合并写入已有 AGENTS.md / CLAUDE.md | 根指令文件写入 helper | 目标文件存在且包含用户自定义内容，无 OpenLogos marker | init | 保留原内容并追加 `OPENLOGOS:BEGIN` / `OPENLOGOS:END` 托管片段 |
| UT-S01-46 | 已有完整 managed block 时只替换托管片段 | 根指令文件写入 helper | 文件含完整 OpenLogos marker，marker 外有用户内容 | init / init --ai-tool | marker 内内容更新，marker 外内容不变 |
| UT-S01-47 | 不完整 marker fail loud | 根指令文件写入 helper | 文件只含 begin 或只含 end marker | init | 返回错误，不覆盖文件 |
| UT-S01-48 | 大小写变体复用既有路径 | 根指令文件写入 helper | 存在 `agents.md` / `claude.md` 小写文件 | init | 复用既有真实路径合并内容，不创建重复大小写入口 |

## 二、场景测试用例

### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S01-01 | 全新项目初始化 | Step 1→9 | 空目录 | 执行 init | 生成全部基础文件；`logos/resources/reference/` 下包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录；`AGENTS.md` / `CLAUDE.md` 包含 OpenLogos managed block |
| ST-S01-03 | 可识别测试栈时写入 verify 预跑配置 | Step 1→9 | 空目录且存在可识别测试脚本 | 执行 init | `logos.config.json` 写入 `verify.pre_run_command` 或等价全量测试命令 |
| ST-S01-04 | init 保留已有用户根指令文件 | Step 7→8 | 无 `logos/logos.config.json`，预置含用户内容的 `AGENTS.md` / `CLAUDE.md` | 执行 init | 用户内容仍存在；OpenLogos managed block 被追加；无整文件覆盖 |
| ST-S01-05 | init --ai-tool 保留用户根指令文件 | Step 7→8 | 已初始化项目，根指令文件 marker 外有用户内容 | 执行 `openlogos init --ai-tool codex` | 目标工具资产补齐；OpenLogos managed block 更新；用户内容仍存在 |


### 2.2 异常路径
| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S01-02 | 项目已初始化 | EX-2.1 | 存在 config | 再次 init | 退出并报错 |
| ST-S01-EX-adopt | logos/ 已存在时提示改用 adopt | EX-2.2 | 存在 logos/logos.config.json 且存在 package.json | 执行 init | 退出并报错；输出提示建议改用 openlogos adopt |
| ST-S01-EX-03 | 无法推断测试命令时输出 TODO | EX-5.1 | 无可识别测试脚本或框架配置 | 执行 init | 成功创建基础文件，但输出 verify 预跑配置补齐提示 |
| ST-S01-EX-04 | 不完整 managed block 阻止覆盖 | EX-8.1 | 预置只含 `OPENLOGOS:BEGIN` 的 `AGENTS.md` | 执行 init | 失败并提示修复 marker；原文件内容不变 |


## 三、覆盖度校验
- [x] init 主路径：已覆盖（ST-S01-01）
- [x] Reference 默认子目录生成：已覆盖（ST-S01-01）
- [x] 重复初始化拒绝：已覆盖（UT-S01-02 / ST-S01-02）
- [x] 可识别测试栈写入 verify 预跑配置：已覆盖（UT-S01-03 / ST-S01-03）
- [x] 无法推断时输出 TODO：已覆盖（UT-S01-04 / ST-S01-EX-03）
- [x] 用户根指令文件保留：已覆盖（UT-S01-45 / UT-S01-46 / ST-S01-04 / ST-S01-05）
- [x] 大小写变体保护：已覆盖（UT-S01-48）
- [x] 不完整 marker fail loud：已覆盖（UT-S01-47 / ST-S01-EX-04）

