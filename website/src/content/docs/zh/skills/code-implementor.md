---
title: code-implementor
description: 基于完整规格链严格忠于规格地生成业务代码与测试代码。
---

基于完整规格链（时序图、API YAML、DB DDL、测试用例规格）生成业务代码与测试代码。确保严格忠于规格、嵌入 OpenLogos reporter，并按场景交付闭环批次。

## Phase 与触发条件

- **Phase**：Phase 3 — HOW（实现），Step 4
- **触发条件**：
  - 用户请求代码实现或代码生成
  - 用户提到「Phase 3 Step 4」「实现 S01」「生成代码」
  - 测试用例设计已完成（`logos/resources/test/` 非空）

## 前置条件

- 时序图位于 `logos/resources/prd/3-technical-plan/2-scenario-implementation/`（必需）
- API 规格位于 `logos/resources/api/`（如有）
- DB DDL 位于 `logos/resources/database/`（如有）
- 测试用例规格位于 `logos/resources/test/`（必需）
- `logos/logos-project.yaml` 中含 `tech_stack`（必需）

如果时序图或测试用例缺失，提示用户先完成 Step 1（scenario-architect）与 Step 3a（test-writer）。

## 与 test-writer 和 code-reviewer 的关系

此 Skill 位于三 Skill 链条的中间：

| Skill | 角色 | 类比 |
|-------|------|---------|
| [`test-writer`](/zh/skills/test-writer)（Step 3a） | 设计测试用例**规格文档** —— 定义 UT/ST ID | 出题人 |
| **code-implementor**（Step 4） | 将所有规格转化为**可运行的业务代码与测试代码** | 答题人 |
| [`code-reviewer`](/zh/skills/code-reviewer)（Step 4 之后） | 对照规格审查生成的代码 —— 输出审查报告 | 阅卷人 |

test-writer 不写代码；code-implementor 不设计测试用例；code-reviewer 不修改代码。三者共同构成**设计 → 执行 → 审查**的闭环。

## 它做了什么

1. 加载完整规格上下文（7 类文档）以建立实现基线
2. 规划分批执行策略 —— 按场景或模块拆分
3. 生成与 API YAML 严格一致的业务代码（路由、状态码、错误码、字段）
4. 生成与 DB DDL 严格对齐的数据访问代码（表名、列名、类型、约束）
5. 生成 ID 与 test-cases.md 完全匹配的测试代码
6. 在测试代码中嵌入 OpenLogos reporter（输出到 `test-results.jsonl`）
7. 每批次后自检以确保忠于规格

## 执行步骤

### Step 1：加载规格上下文

在编写任何代码之前，先阅读这些文档以建立完整上下文：

| 文档 | 路径 | 用途 |
|----------|------|---------|
| 架构 | `prd/3-technical-plan/1-architecture/` | 结构、框架、模式 |
| 时序图 | `prd/3-technical-plan/2-scenario-implementation/` | 实现蓝图 |
| API 规格 | `logos/resources/api/*.yaml` | 端点契约 |
| DB DDL | `logos/resources/database/*.sql` | 数据层契约 |
| 测试用例规格 | `logos/resources/test/*-test-cases.md` | 验证目标 |
| 编排测试 | `logos/resources/scenario/*.json` | 端到端目标（API 项目） |
| 项目配置 | `logos/logos-project.yaml` | 技术栈、依赖 |

### Step 2：规划分批策略

大任务必须分批，但每批都必须**闭环**：

1. **拆分维度**：按场景（S01、S02）或按模块（auth、projects）
2. **批前声明**：列出本批覆盖的 UT/ST 用例 ID，确保可追溯到 `logos/resources/test/*.md`
3. **闭环要求**：每批交付业务代码 + 测试代码 + reporter
4. **禁止延后测试**：禁止「先写完所有业务代码，之后再补测试」

### Step 3：生成业务代码

遵循时序图 Step 序列，并坚持：

**API 忠实度** —— 路由路径、HTTP 方法、请求/响应字段、状态码与错误格式必须与 API YAML 定义完全一致。

**DB 忠实度** —— 表名、列名、类型与约束必须与 DDL 匹配。多表写入必须使用事务。所有查询都必须参数化。

**异常处理** —— 时序图中的每个 EX 情况都需要对应的错误处理分支。不允许空 catch 块。多步骤失败需要补偿/回滚。

### Step 4：生成测试代码

**测试 ID 契约**：测试代码中的 ID 必须与 `test-cases.md` 完全匹配 —— `UT-S01-01` 原样使用，不得重命名或缩写。这些 ID 构成跨阶段契约：test-cases.md → 测试代码 → test-results.jsonl → acceptance-report.md。

**OpenLogos Reporter**：每个测试文件都按 `logos/spec/test-results.md` 模板嵌入 reporter。输出：`logos/resources/verify/test-results.jsonl`，JSONL 格式。

### Step 5：自检

每批次后，验证：

- [ ] API 路由与状态码匹配 YAML
- [ ] DB 操作使用 DDL 中的正确名称
- [ ] 多表写入使用事务
- [ ] 所有预先声明的 UT/ST ID 都存在于测试代码中
- [ ] Reporter 已嵌入且输出路径正确
- [ ] 无硬编码的敏感数据

### Step 6：引导后续步骤

1. 提示用户运行测试（如 `npm test`、`pytest`）
2. 确认 `test-results.jsonl` 已生成
3. 所有批次完成后：引导用户运行 `openlogos verify`（Gate 3.5）
4. 如需代码质量审查：建议使用 [`code-reviewer`](/zh/skills/code-reviewer)

## 产出

| 产出 | 目标位置 |
|--------|-------------|
| 业务代码 | 项目源码树 |
| 测试代码 | 项目测试目录 |
| Reporter | 嵌入测试代码中 |
| JSONL 结果 | `logos/resources/verify/test-results.jsonl`（测试运行时生成） |

此 Skill 不在 `logos/resources/` 下产生文件 —— 代码进入项目源码树；JSONL 在测试运行时产生。

## 最佳实践

- **忠于规格是第一优先级** —— 大多数生产 bug 源自代码与规格之间的细微不一致
- **同一批次内业务代码先于测试代码无妨**，但两者必须在同一批次完成
- **别忘了 reporter** —— 没有 reporter 就无法通过 `openlogos verify` 自动验证
- **不要臆造测试 ID** —— ID 必须来自 test-cases.md，绝不自行创建
- **不要跳过异常处理** —— 时序图中的每个 EX 情况都需要一个代码分支
- **自检比返工便宜** —— 5 分钟的 Step 5 可避免 30 分钟的 code-reviewer 返工
- **批次粒度** —— 一个场景一批是最佳点；一个端点一批则过细

## 相关 Skill

- 上一步：[`test-writer`](/zh/skills/test-writer) / [`test-orchestrator`](/zh/skills/test-orchestrator) —— 设计测试规格
- 下一步：[`code-reviewer`](/zh/skills/code-reviewer) —— 对照规格审查生成的代码
