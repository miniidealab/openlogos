# S09: 创建、合并、归档变更提案 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-01 | 扫描 delta 目录 | scanDeltas | 有 prd/test delta | change slug | 返回映射 |
| UT-S09-02 | 任务模板结构正确 | tasksTemplate | 模板生成 | slug | 含 [delta]/[code]/[deploy] |
| UT-S09-09 | 提案模板包含部署影响字段 | proposalTemplate | 模板生成 | slug | 含是否需要部署、部署原因、影响环境、数据迁移、回滚预案、是否需要 smoke |
| UT-S09-10 | 扫描 delta 时忽略 reference 目录 | scanDeltas | 存在 `deltas/reference/` | change slug | 不把 reference 文件计入可 merge delta |
| UT-S09-11 | guard-check: launched + 无 guard → 阻断 Edit | guard-check 脚本 | launched 模块，无 guard 文件 | Edit tool_input file_path=src/index.ts | exit 2，reason 含"变更管理拦截" |
| UT-S09-12 | guard-check: launched + 有 guard → 放行 Edit | guard-check 脚本 | launched 模块，有 guard 文件 | Edit tool_input file_path=src/index.ts | exit 0 |
| UT-S09-13 | guard-check: initial lifecycle → 放行 | guard-check 脚本 | 所有模块 initial | Edit tool_input file_path=src/index.ts | exit 0 |
| UT-S09-14 | guard-check: 白名单路径 logos/changes/ → 放行 | guard-check 脚本 | launched 模块，无 guard | Edit tool_input file_path=logos/changes/my-change/proposal.md | exit 0 |
| UT-S09-15 | guard-check: 白名单路径 CLAUDE.md → 放行 | guard-check 脚本 | launched 模块，无 guard | Write tool_input file_path=CLAUDE.md | exit 0 |
| UT-S09-16 | guard-check: Bash 写入命令 → 阻断 | guard-check 脚本 | launched 模块，无 guard | Bash command="sed -i 's/a/b/' src/foo.ts" | exit 2 |
| UT-S09-17 | guard-check: openlogos CLI 命令 → 放行 | guard-check 脚本 | launched 模块，无 guard | Bash command="openlogos status" | exit 0 |
| UT-S09-18 | guard-check: 非 OpenLogos 项目 → 放行 | guard-check 脚本 | 无 logos.config.json | Edit tool_input file_path=src/index.ts | exit 0 |
| UT-S09-19 | deployClaudeCodePlugin 部署 guard-check 脚本 | deployClaudeCodePlugin | plugin/bin/guard-check 存在 | 调用 deployClaudeCodePlugin | .claude/openlogos/bin/guard-check 存在且可执行 |
| UT-S09-20 | deployClaudeCodePlugin 注册 PreToolUse hook | deployClaudeCodePlugin | plugin/bin/guard-check 存在 | 调用 deployClaudeCodePlugin | settings.json 含 PreToolUse matcher=Edit\|Write\|Bash |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-01 | 创建提案工作区 | Step 1→2 | 无 guard | change slug | 生成提案目录 |
| ST-S09-12 | 创建后填写提案级部署决策 | Step 3→5 | 已创建提案 | AI 填写 proposal/tasks | `proposal.md` 含部署影响，`tasks.md` 的 `[deploy]` 与声明一致 |
| ST-S09-13 | 只按 delta section 产出可 merge delta | Step 6→7 | 用户已确认提案 | 产出 delta | delta 文件落入 prd/api/database/scenario/test/spec/skills 支持目录，不写入 reference 作为 merge 目标 |

## 三、异常测试用例
| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|----------|---------|---------|---------|
| ST-S09-EX-5.1 | 部署决策与 tasks 冲突 | EX-5.1 | `proposal.md` 与 `[deploy]` section 冲突 | status / next | 输出冲突警告 |
