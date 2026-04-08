# AI Assistant Instructions

This project follows the **OpenLogos** methodology.
Read `logos/logos-project.yaml` first to understand the project resource index.

## Project Context
- Config: `logos/logos.config.json`
- Resource Index: `logos/logos-project.yaml`

## ⚠️ 语言策略（最高优先级）

本项目的文档语言为 **中文**（配置于 `logos/logos.config.json` → `locale: "zh"`）。

**你的所有输出——包括生成的文档、代码注释、回复消息——必须使用中文。**
即使 Skill 文件使用其他语言编写，你的输出也必须是中文。
违反此规则将导致产出不可用。

## Methodology Rules
1. Never write code without first completing the design documents
2. Follow the Why → What → How progression
3. All API designs must originate from scenario sequence diagrams
4. All code changes must have corresponding API orchestration tests
5. Use the Delta change workflow for iterations (see logos/changes/ directory)
6. All generated test code must write results to `logos/resources/verify/test-results.jsonl` (see spec/test-results.md)

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan `logos/resources/` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

Phase 检测逻辑（检测到对应阶段时，**必须先读取** Skill 文件并按其步骤执行）：
- `logos/resources/prd/1-product-requirements/` 为空 → Phase 1 → **读取 `logos/skills/prd-writer/SKILL.md` 并按其步骤执行**
- 需求存在但 `2-product-design/` 为空 → Phase 2 → **读取 `logos/skills/product-designer/SKILL.md` 并按其步骤执行**
- 设计存在但 `3-technical-plan/1-architecture/` 为空 → Phase 3 Step 0 → **读取 `logos/skills/architecture-designer/SKILL.md` 并按其步骤执行**
- 架构存在但 `3-technical-plan/2-scenario-implementation/` 为空 → Phase 3 Step 1 → **读取 `logos/skills/scenario-architect/SKILL.md` 并按其步骤执行**
- 场景存在但 `logos/resources/api/` 为空 → Phase 3 Step 2 → **读取 `logos/skills/api-designer/SKILL.md` 和 `logos/skills/db-designer/SKILL.md` 并按其步骤执行**
- API 存在但 `logos/resources/test/` 为空 → Phase 3 Step 3a → **读取 `logos/skills/test-writer/SKILL.md` 并按其步骤执行**
- 测试用例存在但 `logos/resources/scenario/` 为空 → Phase 3 Step 3b → **读取 `logos/skills/test-orchestrator/SKILL.md` 并按其步骤执行**（仅 API 项目）
- 以上全部完成 → Phase 3 Step 4（代码生成）→ **读取 `logos/skills/code-reviewer/SKILL.md` 进行代码审查**
- 代码已生成但 `logos/resources/verify/` 为空 → Phase 3 Step 5（运行测试后 `openlogos verify`）

## Active Skills
**重要**：当你识别到当前 Phase 后，必须先读取对应的 Skill 文件，按 Skill 中定义的步骤逐步执行。不要跳过 Skill 文件直接生成内容。

- `logos/skills/prd-writer/` — 需求文档编写
- `logos/skills/product-designer/` — 产品设计与原型
- `logos/skills/architecture-designer/` — 技术架构与技术选型
- `logos/skills/scenario-architect/` — 业务场景建模与时序图
- `logos/skills/api-designer/` — OpenAPI 规格设计
- `logos/skills/db-designer/` — 数据库 Schema 设计
- `logos/skills/test-writer/` — 单元测试 + 场景测试用例设计（Step 3a）
- `logos/skills/test-orchestrator/` — API 编排测试设计（Step 3b，仅 API 项目）
- `logos/skills/code-reviewer/` — 代码审查与规范检查
- `logos/skills/change-writer/` — 变更提案编写与影响分析
- `logos/skills/merge-executor/` — 通过 MERGE_PROMPT.md 执行 Delta 合并

## ⚠️ 变更管理（必须遵守）

**修改任何源代码或 Skill 文件之前，必须先创建变更提案：**

1. 运行 `openlogos change <slug>` 创建提案目录
2. 使用 change-writer Skill 填写 `proposal.md` + `tasks.md`
3. 用户确认后再开始编码
4. 完成后运行 `openlogos merge <slug>` → `openlogos archive <slug>`

唯一例外：纯 typo 修复、README 等非方法论文件的修改。
**跳过此步骤将违反 OpenLogos 核心方法论。**

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案

## ⚠️ openlogos CLI 规则

运行任何 `openlogos` 命令之前，**必须先 cd 到本示例的项目根目录**（OpenLogos monorepo 内为 `examples/flowtask/`，即同时包含 `logos/logos.config.json` 与 `package.json` 的目录）：
```bash
cd openlogos/examples/flowtask   # 克隆后的路径按你的本机为准
```
正确写法：
```bash
openlogos verify
```
错误写法（在子目录如 `src/`、`src-tauri/` 下直接运行）会导致 `logos.config.json not found` 错误。

## ⚠️ 测试 Reporter 规则

**每次生成测试代码时，必须确保测试运行后能产出 `logos/resources/verify/test-results.jsonl`。**
这是 `openlogos verify` 三层验收的数据来源，缺少此文件会导致验收无法进行。

### JSONL 格式

每行一个 JSON 对象：

```json
{"id": "UT-S01-01", "status": "pass", "name": "测试函数名"}
{"id": "UT-S01-02", "status": "fail", "name": "测试函数名", "error": "错误信息"}
```

- `id`：必须与 `logos/resources/test/*-test-cases.md` 中定义的用例 ID 完全一致
- `status`：只能是 `"pass"` / `"fail"` / `"skip"`（注意：不是 `"passed"`）
- `name`：测试函数名（可选）

### Rust 项目（本项目）

在测试模块中添加 reporter helper，每个测试函数末尾调用：

```rust
fn report(id: &str, status: &str, name: &str) {
    use std::io::Write;
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../logos/resources/verify/test-results.jsonl");
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap();
    writeln!(f, r#"{{"id": "{}", "status": "{}", "name": "{}"}}"#, id, status, name).unwrap();
}
```

### 生成测试代码的检查清单

- [ ] `logos/resources/test/` 中有对应的 `*-test-cases.md`，用例 ID 已定义
- [ ] 测试函数名与用例 ID 有明确对应关系
- [ ] 测试运行后能产出 `logos/resources/verify/test-results.jsonl`
- [ ] 运行测试前先清空旧的 jsonl，避免结果污染
