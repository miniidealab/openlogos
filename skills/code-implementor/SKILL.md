# Skill: Code Implementor

> 基于完整规格链（时序图、API YAML、DB DDL、测试用例规格）生成业务代码和测试代码。确保代码与规格严格一致，嵌入 OpenLogos reporter，按场景分批交付闭环产物。

## 触发条件

- 用户要求实现代码、生成代码或编写代码
- 用户提到 "Phase 3 Step 4"、"代码生成"、"帮我实现 S01"
- 测试用例设计已完成（`logos/resources/test/` 非空），需要开始编码
- 用户指定某个场景编号（如 S01）需要实现

## 前置依赖

- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中包含场景时序图（**必需**）
- `logos/resources/api/` 中包含 API 规格（有则读取）
- `logos/resources/database/` 中包含 DB DDL（有则读取）
- `logos/resources/test/` 中包含测试用例规格（**必需**）
- `logos/logos-project.yaml` 中包含 `tech_stack`（**必需**）

如果时序图或测试用例目录为空，提示用户先完成 Phase 3 Step 1（scenario-architect）和 Step 3a（test-writer）。

## 核心能力

1. 加载完整规格上下文，建立实现基准
2. 规划分批策略，按场景或模块拆分大任务
3. 生成与 API YAML 严格一致的业务代码（路由、状态码、错误码、字段）
4. 生成与 DB DDL 严格对齐的数据访问代码（表名、列名、类型、约束）
5. 生成与 test-cases.md 中 ID 完全对齐的测试代码
6. 在测试代码中嵌入 OpenLogos reporter（输出到 `test-results.jsonl`）
7. 每批完成后执行自检，确保规格一致性

## 与 test-writer 和 code-reviewer 的关系

本 Skill 处于三者链条的中间位置：

- **test-writer**（Step 3a）：设计测试用例**规格文档**（Markdown），定义 UT/ST ID——是"出卷人"
- **code-implementor**（Step 4，本 Skill）：将所有规格转化为**可运行的业务代码和测试代码**——是"答卷人"
- **code-reviewer**（Step 4 之后）：拿着规格**审计已生成的业务代码**，输出审查报告——是"阅卷人"

test-writer 不写代码；code-implementor 不设计用例；code-reviewer 不修改代码。三者形成 **设计 → 执行 → 审查** 闭环。

## 执行步骤

### Step 1: 加载规格上下文

**在写任何一行代码之前**，必须读取以下文档建立完整上下文：

| 文档 | 路径 | 用途 |
|------|------|------|
| 技术架构 | `prd/3-technical-plan/1-architecture/` | 整体结构、框架、设计模式 |
| 场景时序图 | `prd/3-technical-plan/2-scenario-implementation/` | 实现蓝图——Step 序列即代码调用链 |
| API 规格 | `logos/resources/api/*.yaml` | 端点契约——路由、方法、状态码、字段定义 |
| DB DDL | `logos/resources/database/*.sql` | 数据层契约——表结构、约束、索引 |
| 测试用例规格 | `logos/resources/test/*-test-cases.md` | 验证目标——UT/ST ID、预期输入输出 |
| 编排测试 | `logos/resources/scenario/*.json` | 端到端验证目标（API 项目） |
| 项目配置 | `logos/logos-project.yaml` | `tech_stack`、`external_dependencies` |

读取完成后，确认以下信息：
- 本次实现涉及哪些场景（S01、S02...）
- 涉及哪些 API 端点和 DB 表
- 对应的 UT/ST 用例总数
- 技术栈确认（语言、框架、测试框架）

### Step 2: 规划分批策略

**大任务必须拆批，但每批必须闭环。**

1. **拆分维度**：按场景（S01、S02）或按模块（auth、projects）拆分
2. **批前声明**：每批开始前，列出本批覆盖的 UT/ST case ID 清单，确保与 `logos/resources/test/*.md` 可追溯
3. **闭环要求**：每批必须同时交付三要素——业务代码 + 测试代码 + reporter
4. **不得延迟测试**：不允许"先写完所有业务代码，最后统一补测试"

输出格式示例：

```markdown
## 本批次范围

- 场景：S01（用户注册）
- 端点：POST /api/auth/register, POST /api/auth/verify-email
- DB 表：users, profiles
- 覆盖用例：UT-S01-01 ~ UT-S01-08, ST-S01-01 ~ ST-S01-03
```

### Step 3: 生成业务代码

按时序图 Step 序列逐步实现业务逻辑，**严格遵守以下规格一致性规则**：

#### API 一致性（必须遵守）

| 规则 | 说明 |
|------|------|
| 路由路径 | 代码中的路由必须与 API YAML 的 `paths` 完全一致 |
| HTTP 方法 | GET/POST/PUT/DELETE 必须匹配 |
| 请求体字段 | 代码必须读取 YAML `requestBody.schema` 中定义的所有 `required` 字段 |
| 字段验证 | `type`、`format`（email/uuid）、`minLength` 等约束必须在代码中实现验证 |
| 响应字段 | 返回的 JSON 字段名和类型必须与 YAML `responses.schema` 一致 |
| HTTP 状态码 | 正常和错误情况的状态码必须与 YAML 定义一致（不能把 201 写成 200） |
| 错误响应格式 | 必须遵循统一的 `{ code, message, details? }` 格式 |

#### DB 一致性（必须遵守）

| 规则 | 说明 |
|------|------|
| 表名和列名 | 代码中引用的表名、列名必须与 DDL 一致（无拼写错误、大小写差异） |
| 字段类型 | 传入的值类型必须与 DDL 定义匹配（如金额字段用分而非元） |
| 约束遵守 | NOT NULL 字段必须有值；UNIQUE 字段必须处理冲突；CHECK 约束的枚举值需有对应常量 |
| 事务使用 | 多表写操作必须包裹在事务中 |
| 参数化查询 | 禁止字符串拼接 SQL，必须使用参数化查询 |

#### 异常处理（必须遵守）

- 时序图中的每个 EX 异常用例必须在代码中有对应的错误处理分支
- 外部服务调用（DB、第三方 API）必须有超时和错误处理
- 不允许空 catch 块（静默吞异常）
- 多步写入失败时需要有补偿/回滚机制

### Step 4: 生成测试代码

#### 测试 ID 契约

测试代码中的用例 ID 必须与 `test-cases.md` 中定义的 **完全一致**：

- `UT-S01-01` 在测试代码中必须原封不动使用，不允许改名、缩写或重排序
- 这些 ID 是跨阶段契约：test-cases.md → 测试代码 → test-results.jsonl → acceptance-report.md

#### OpenLogos Reporter 嵌入

每个测试文件必须嵌入 OpenLogos reporter，按照 `logos/spec/test-results.md` 中的模板实现：

- 输出路径：`logos/resources/verify/test-results.jsonl`
- 格式：JSONL（每行一个 JSON 对象）
- 每个用例输出：`{ "id": "UT-S01-01", "status": "pass"|"fail"|"skip", ... }`
- 首次运行 truncate 文件，后续 append
- 写入前确保 `logos/resources/verify/` 目录存在

根据 `tech_stack` 选择对应语言的 reporter 模板（TypeScript/Python/Go 等，模板见 `logos/spec/test-results.md`）。

#### 测试代码结构

- 单元测试：每个 UT 用例对应一个独立的测试函数
- 场景测试：每个 ST 用例对应一个端到端流程测试
- 测试数据：每个测试准备独立的测试数据，测试后清理，确保幂等性

### Step 5: 自检

每批代码完成后，执行以下自检（相当于 code-reviewer 的前置轻量版本）：

- [ ] API 路由路径和 HTTP 方法与 YAML 一致
- [ ] HTTP 状态码（正常 + 异常）与 YAML 一致
- [ ] 错误响应格式遵循 `{ code, message }` 规范
- [ ] DB 操作的表名、列名与 DDL 一致
- [ ] 多表写操作已使用事务
- [ ] 批前声明的所有 UT/ST ID 在测试代码中都存在
- [ ] Reporter 已嵌入且输出路径正确
- [ ] 无硬编码敏感信息（密码、密钥、测试数据）

如果发现不一致，**立即修正后再交付**，不要等到 code-reviewer 阶段。

### Step 6: 引导下一步

每批完成后：

1. **提示运行测试**：告诉用户运行测试命令（如 `npm test`、`pytest`）
2. **提示检查结果**：确认 `logos/resources/verify/test-results.jsonl` 已生成
3. **所有批次完成后**：引导用户运行 `openlogos verify` 执行 Gate 3.5 验收

如果用户希望审查代码质量，引导使用 `code-reviewer` Skill。

## 输出规范

- **业务代码**：输出到项目源码树（目录结构遵循架构设计中的约定）
- **测试代码**：输出到项目测试目录
- **Reporter**：嵌入测试代码中（非独立文件）
- **JSONL 结果**：`logos/resources/verify/test-results.jsonl`
- 本 Skill 不在 `logos/resources/` 下产出文件（代码进入项目源码树，JSONL 由测试运行时产出）

## 实践经验

- **规格一致性是第一优先级**：代码必须与 API YAML / DB DDL 严格对齐——大部分生产 Bug 来自代码与规格的细微不一致
- **先写业务代码后写测试是允许的**，但必须在同一批次内完成，不允许拆到不同批次
- **Reporter 不要忘记**：这是 `openlogos verify` 能自动验收的关键——没有 reporter 就没有自动化验收
- **不要发明用例 ID**：测试代码中的 ID 必须来自 test-cases.md，不允许自行新增或改名
- **不要跳过异常处理**：时序图中标注的每个 EX 用例必须在代码中有对应分支
- **自检比返工便宜**：Step 5 的 5 分钟自检可以避免 code-reviewer 阶段 30 分钟的返工
- **分批粒度**：单批次不宜过大（一个场景是合适的粒度），也不宜过小（一个 API 端点太碎）

## 推荐提示词

以下提示词可以直接复制给 AI 使用：

- `帮我实现 S01 的代码`
- `基于规格文档帮我生成 S01 的业务代码和测试代码`
- `执行 Phase 3 Step 4，按场景分批实现`
- `帮我实现 S01，确保与 API YAML 和 DB DDL 一致`
- `Please execute Phase 3 Step 4 for S01. Deliver business code + test code + OpenLogos reporter in each batch.`
