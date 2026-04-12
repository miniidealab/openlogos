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
6. All generated test code must include an OpenLogos reporter (see logos/spec/test-results.md)

## Interaction Guidelines
When the user's request is vague or they ask "what should I do next":
1. Scan `logos/resources/` to determine the current project phase
2. Suggest the specific next step based on what's missing
3. Provide a ready-to-use prompt the user can directly say
4. Never start generating documents without confirming key information

Phase 检测逻辑：
- `logos/resources/prd/1-product-requirements/` 为空 → 建议 Phase 1（prd-writer）
- 需求存在但 `2-product-design/` 为空 → 建议 Phase 2（product-designer）
- 设计存在但 `3-technical-plan/1-architecture/` 为空 → 建议 Phase 3 Step 0（architecture-designer）
- 架构存在但 `3-technical-plan/2-scenario-implementation/` 为空 → 建议 Phase 3 Step 1（scenario-architect）
- 场景存在但 `logos/resources/api/` 为空 → 建议 Phase 3 Step 2（api-designer + db-designer）
- API 存在但 `logos/resources/test/` 为空 → 建议 Phase 3 Step 3a（test-writer）
- 测试用例存在但 `logos/resources/scenario/` 为空 → 建议 Phase 3 Step 3b（test-orchestrator，仅 API 项目）
- 以上全部完成 → 建议 Phase 3 Step 4（code-implementor）
- 代码已生成但 `logos/resources/verify/` 为空 → 建议 Phase 3 Step 5（运行测试后 `openlogos verify`）

Step 4 执行规则（大任务）：
1. 大任务可按场景/子模块分批实现，但每一批必须闭环
2. 每一批必须同时包含：业务代码 + UT/ST 测试代码 + OpenLogos reporter
3. 输出代码前，先列出本批覆盖的 UT/ST 用例 ID，并确保与 `logos/resources/test/*.md` 对齐
4. 不允许将全部测试推迟到最终批次统一补写

Step 4 分批执行提示词（可直接复用）：
- `请按 Phase 3 Step 4 执行本次实现。若任务较大可分批，但每批必须同时交付：（1）业务代码，（2）对应 UT/ST 测试代码，（3）写入 logos/resources/verify/test-results.jsonl 的 OpenLogos reporter。输出代码前请先列出本批覆盖的 UT/ST 用例 ID。`

## 文档修改后的验证（强制）

每次**写入或修改** Markdown / 文本类规格文档（例如 `logos/resources/`、`logos/changes/`、`logos/spec/` 或项目根 `spec/` 下的 `.md`，以及根目录 `AGENTS.md` / `CLAUDE.md`）后：

1. **必须**用当前环境可用的方式**从磁盘重新读取**本次修改涉及的片段（例如 Read 工具、或终端 `sed` / `rg`），向用户展示**文件中的实际原文**（可省略无关段落并标注 `...`）。
2. **禁止**仅以自然语言概括「已改为……」作为唯一交付物，而不附带可对照的原文佐证。
3. **例外**：纯 typo 或单字符标点修改时，至少读回**受影响的那一行**，或展示等价的 diff 片段。

**目的**：避免工具声称已保存、但实际未落盘或路径错误导致内容「丢失」而不自知。


## ⛔ 变更管理（强制执行）

### Guard 机制
本项目使用 `logos/.openlogos-guard` 锁文件来追踪活跃变更。
- **有 guard 文件** → 可以修改代码，但 **只能在该提案范围内** 修改
- **无 guard 文件** → **禁止修改任何源代码**，必须先运行 `openlogos change <slug>`

### 变更流程
1. 运行 `openlogos change <slug>` 创建提案（自动写入 guard 文件）
2. 使用 change-writer Skill 填写 `proposal.md` + `tasks.md`
3. **等待用户确认后** 再开始编码
4. 完成后运行 `openlogos merge <slug>` → `openlogos archive <slug>`（自动删除 guard 文件）

### 行为约束
- **发现 bug/问题时**：只输出分析和修复方案，**禁止直接修改代码**，等待用户决定是否创建变更提案
- **修改代码前**：先确认 guard 文件存在且当前修改在提案范围内
- **唯一例外**：纯 typo 修复（不改变语义）、`.gitignore`/`README.md` 等非方法论文件

**违反此规则将破坏项目的变更可追溯性。**

## ⚠️ openlogos CLI 规则

运行任何 `openlogos` 命令之前，**必须先 cd 到项目根目录**（即 `logos/logos.config.json` 所在目录）。
在子目录（如 `src/`、`src-tauri/`）下直接运行会导致 `logos.config.json not found` 错误。

正确写法：
```bash
cd <项目根目录> && openlogos <command>
```

## Conventions
- 遵循 OpenLogos 三层推进模型（Why → What → How）
- 每次变更必须先创建 logos/changes/ 变更提案
