# Skill: Code Implementor

> 基于完整规格链（时序图、API YAML、DB DDL、测试用例规格）生成业务代码和测试代码。确保代码与规格严格一致，嵌入 OpenLogos reporter，按场景分批交付闭环产物。

## 触发条件

- 用户要求实现代码、生成代码或编写代码
- 用户提到 "Phase 3 Step 5"、"代码生成"、"帮我实现 S01"
- 测试用例设计已完成（`logos/resources/test/` 非空），需要开始编码
- 用户指定某个场景编号（如 S01）需要实现

## 前置依赖

- `logos/resources/prd/3-technical-plan/2-scenario-implementation/` 中包含场景时序图（**必需**）
- `logos/resources/api/` 中包含 API 规格（有则读取）
- `logos/resources/database/` 中包含 DB DDL（有则读取）
- `logos/resources/test/` 中包含测试用例规格（**必需**）
- `logos/logos-project.yaml` 中包含 `tech_stack`（**必需**）

如果时序图或测试用例目录为空，提示用户先完成 Phase 3 Step 1（scenario-architect）和 Step 4a（test-writer）。

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

- **test-writer**（Step 4a）：设计测试用例**规格文档**（Markdown），定义 UT/ST ID——是"出卷人"
- **code-implementor**（Step 5，本 Skill）：将所有规格转化为**可运行的业务代码和测试代码**——是"答卷人"
- **code-reviewer**（Step 5 之后）：拿着规格**审计已生成的业务代码**，输出审查报告——是"阅卷人"

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
| 源码位置 | `logos/logos.config.json` → `sourceRoots` | 业务代码和测试代码的输出根目录 |

读取完成后，确认以下信息：
- 本次实现涉及哪些场景（S01、S02...）
- 涉及哪些 API 端点和 DB 表
- 对应的 UT/ST 用例总数
- 技术栈确认（语言、框架、测试框架）
- 源码输出目录确认（读取 `sourceRoots.src` 和 `sourceRoots.test`，若不存在则默认 `src/` 和 `test/`）
- verify 预跑配置确认：`verify.pre_run_command`、`verify.regression_command` 或 `verify.incremental_command` 至少存在一个；若缺失则需要在实现前补齐或明确诊断

### Step 2: 规划分批策略

> ⚠️ **适用范围（必读）**：本 Step 的「六维打分 + 分批 / 切片判定」**仅适用于 initial 阶段**——首轮从 0 到 1 开发，没有变更提案、没有 `tasks.md`，需由实现者自行按场景 / 子模块分批。
>
> **launched 变更下本 Step 不适用**：切片数量已由 `change-writer` 在写提案时用**同一套六维打分**写进 `tasks.md` 的 `[code]` section（每个未勾行 = 一片，是唯一事实源）。code-implementor 在 launched 下**不得重新打分、不得自行分批**，必须**逐行消费 `[code]` 切片**——做哪一片、做几片，一律以 `[code]` 为准（具体执行见下方「Step 2 补充」的激活门）。

**（以下仅 initial）只有大任务才拆批；大任务 = 切片评分 8 分及以上。每批必须闭环。**

在规划分批前，先按 6 个维度打分（每项 0/1/2，总分 0-12）：

| 维度 | 0 分 | 1 分 | 2 分 |
|---|---|---|---|
| 影响范围 | 1 个文件或局部函数 | 2-5 个相关文件 | 跨模块 / 跨服务 / 跨端 |
| 行为复杂度 | 单一路径 bugfix | 2-3 个分支 | 多场景 / 状态机 / 异步流程 |
| 契约变化 | 无 | CLI/API 输出小改 | API/DB/flow/兼容契约变更 |
| 测试规模 | 1-3 个用例 | 4-8 个用例 | 9+ 个用例或多类测试矩阵 |
| 风险等级 | 易回滚 | 有兼容性风险 | 涉数据、安全、部署、迁移 |
| 不确定性 | 原因明确 | 1 个待验证假设 | 多个未知点 / 需要探索 |

判定规则：
- **0-7 分：不是大任务，必须单批 / 单切片实现**，不得把测试、reporter、golden baseline 拆成独立批次。
- **8 分及以上：定义为大任务，需要拆批 / 切片实现**。
- **无法垂直闭环时仍单批**：即使达到 8 分，如果拆不出独立可验证的垂直闭环，保留单批并说明原因。

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

### Step 2 补充：切片循环驱动模型（change-flow-redesign）

> 自 change-flow-redesign 起，launched `implement` 默认以**切片循环**推进（场景 S31）。`tasks.md` 的 `[code]` section 每个未勾行 = 一个切片，由宿主（如 RunLogos driver）逐片驱动；Step 2 的"分批策略"在 launched 下即对齐这些切片。

> 🚦 **激活前提（最高优先级，必读）**：下列「每轮只实现一片」的纪律，**仅当 `openlogos next` 实际返回了 `next_node.slice`（即宿主 / driver 正逐片注入「只做这一片」的上下文）时才适用**。
>
> **若你并未被逐片注入**——例如手动执行、没有 driver 驱动循环、或所用 `openlogos` CLI 不支持切片循环（< 0.11，`next` 不输出 `next_node.slice` / `slice_state`）——则**必须在本次实现里把整个 `[code]` section 的所有未勾切片一次性全部实现完**（每片仍各自闭环：业务代码 + 该片 UT/ST + reporter），全部完成后再交 `verify`。
>
> **严禁**在没有逐片注入的情况下，自行把单个 `[code]` 行当作「第一个切片」、实现完就停下等下一轮。**为什么**：切片只 scope `code` 的上下文注入、**不 scope verify**（verify 永远全量回归）；只做完一片就跑全量 verify 必然飘红（其余切片的测试尚不存在 / 不过），循环无法出环，会直接死锁在 `verify-failed`。

切片循环下的实现纪律（**仅在上述激活前提满足、即宿主正逐片注入时适用**）：

1. **每轮只实现一片**：宿主读 `openlogos next` 的 `next_node.slice` / `slice_state.current` 注入"只做这一片 + 该片相关 spec/测试"的上下文。**逐片注入正是为规避"一次塞太多导致 AI 失败"**。
2. **每片自闭环**：该片的业务代码 + 该片 UT/ST 测试 + reporter 同批交付（与既有 Step 2「闭环要求」一致），切片 ID 来自 `[code]` 行标注的 `UT-Sxx-..`/`ST-Sxx-..`。
3. **verify 跑全量回归，不只跑本片**：`openlogos verify` 始终全量执行——切片只 scope `code` 的上下文注入，**不 scope verify**；这样后做切片若打断先做切片，全量 verify 会飘红、loop 不出环，从模型层杜绝"局部绿全局红"。
4. **绿后才勾该片**：该片相关测试（及全量回归）满足后，由宿主把 `tasks.md` `[code]` 该行勾上——OpenLogos 只派生、不代勾。
5. **收敛 = 全部切片勾选 ∧ 末轮全量测试绿**（`code_slices_green`）；达 `max_iters`（默认 30）仍未达成升级 `gate:implement:loop-exhausted`（`skippable:false`，默认不放行未完成大功能）。
6. **修哪片由 verify 失败输出决定**：`next_node.slice` 提示的是"下一个**未建**切片"，不是"该修哪片"；回归飘红时具体修复目标由全量 verify 失败信息判断，归宿主/实现者，引擎不代判。

> 非 launched（initial 单模块默认 / initial 多模块）不默认激活切片循环，沿用既有"按场景/子模块分批"策略。

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

#### OpenLogos Reporter 嵌入（强制前置）

> ⚠️ **Reporter 是第零步，不是最后一步。** 在写任何测试用例代码之前，必须先创建共享 reporter 工具文件。没有 reporter，`openlogos verify` 无法读取结果，Gate 3.5 永远无法通过。

**第一步：创建共享 reporter 文件**

在测试目录下创建共享 reporter 工具文件（根据 `tech_stack` 选择语言），所有测试文件统一从这里 import，不要在每个测试文件里重复内联：

```
<sourceRoots.test>/
└── helpers/
    └── reporter.ts   ← 先建这个，再写测试用例
```

reporter 模板见 `logos/spec/test-results.md`。核心要求：

- 输出路径：`logos/resources/verify/test-results.jsonl`
- 格式：JSONL（每行一个 JSON 对象）
- 每个用例输出：`{ "id": "UT-S01-01", "status": "pass"|"fail"|"skip", ... }`
- 首次运行 truncate 文件，后续 append
- 写入前确保 `logos/resources/verify/` 目录存在

**第二步：在每个测试文件顶部 import reporter**

```typescript
import { reportResult } from './helpers/reporter';
```

**第三步：每个测试用例用 try/catch 包裹并调用 reportResult**

```typescript
it('UT-S01-01: ...', () => {
  const start = Date.now();
  try {
    // 测试逻辑
    reportResult('UT-S01-01', 'pass', undefined, Date.now() - start);
  } catch (e) {
    reportResult('UT-S01-01', 'fail', String(e), Date.now() - start);
    throw e;
  }
});
```

Playwright E2E 测试使用 `test.afterEach` + fixture 捕获结果，参见 `logos/spec/test-results.md` 中的 Playwright 模板。

#### Smoke Runner / Reporter 闭环（强制）

如果本批实现新增或修改了 `logos/resources/test/smoke/*.md`，或当前活跃提案的 `deltas/test/smoke/` 中存在新增/修改的 `SMOKE-*` 用例，必须在同一批代码中同步交付 smoke 可执行验收：

1. 提取本提案新增或修改的 `SMOKE-*` 用例 ID，逐项列入本批覆盖清单。
2. 实现或更新 `scripts/smoke-*.sh`、`scripts/smoke-*.js` 或等效 smoke runner；runner 必须执行真实检查，不能只伪造 pass 记录。
3. smoke runner 必须将每个新增 `SMOKE-*` 的执行结果写入 `logos/resources/verify/smoke-results.jsonl`，或写入 `logos.config.json.smoke.result_path` 指定路径。
4. 确保 `logos.config.json.smoke.command` 能执行新增 runner；推荐使用统一 `scripts/run-smoke.js` smoke dispatcher 自动发现并顺序运行 `scripts/smoke-*`。
5. 完成后运行 smoke runner、`openlogos smoke --format json`，或等效 smoke 覆盖预检；如出现 `smoke_runner_missing`、`smoke_reporter_missing`、`smoke_cases_uncovered`，不得标记 `[code]` 任务完成。

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
- [ ] **共享 reporter 文件已创建**（`<test>/helpers/reporter.ts` 或等效路径）
- [ ] **每个测试文件都已 import reporter**，无遗漏
- [ ] **每个测试用例都有 try/catch + reportResult 调用**，无遗漏
- [ ] 运行测试后 `logos/resources/verify/test-results.jsonl` 已生成且非空
- [ ] 若本批新增或修改 `SMOKE-*`：smoke runner / reporter / dispatcher 已实现，`smoke-results.jsonl` 覆盖新增 ID，且 smoke 覆盖预检无 `smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`
- [ ] 无硬编码敏感信息（密码、密钥、测试数据）

如果发现不一致，**立即修正后再交付**，不要等到 code-reviewer 阶段。

### Step 6: 引导下一步

每批完成后：

1. **提示运行测试**：告诉用户运行测试命令（如 `npm test`、`pytest`）
2. **提示检查结果**：确认 `logos/resources/verify/test-results.jsonl` 已生成
3. **所有批次完成后**：引导用户运行 `openlogos verify` 执行 Gate 3.5 验收
4. **更新 sourceRoots**：如果实际使用的源码目录与 `logos.config.json` 中的 `sourceRoots` 不同，更新配置文件以反映实际路径。例如，如果业务代码放在 `app/` 而非默认的 `src/`，将 `sourceRoots.src` 更新为 `["app"]`
5. **自动写入 `verify.pre_run_command`**：检查 `logos.config.json` 是否已有 `verify.pre_run_command`、`verify.regression_command` 或 `verify.incremental_command` 字段。若没有，根据 `logos-project.yaml` 的 `tech_stack` 推断默认命令并写入，确保后续 `openlogos verify` 能自动跑全量测试：

   | tech_stack 关键词 | 写入命令 |
   |---|---|
   | vitest | `npx vitest run` |
   | jest | `npx jest` |
   | pytest | `pytest` |
   | go test | `go test ./...` |
   | cargo test | `cargo test` |
   | 无法推断 | 提示用户手动在 `logos.config.json` 的 `verify.pre_run_command` 字段填写测试命令 |

   **为什么必须配置**：`openlogos-reporter` 每次运行测试时会清空 `test-results.jsonl`，若只跑部分场景的测试，JSONL 将缺少其他场景的结果，导致 `openlogos verify` 覆盖率不足而失败。配置预跑命令后，`openlogos verify` 会在读取 JSONL 前自动执行全量测试，确保覆盖率完整。若项目明确使用两阶段模型，也可写入 `verify.regression_command` 与 `verify.incremental_command`，并保证阶段结果不会互相覆盖。

6. **写入实现清单**：在 `logos/resources/implementation/` 目录下创建实现清单文件（如 `implementation-manifest.md`），记录本次实现覆盖的场景、端点、用例 ID 等信息，标记 Phase 3-4 完成

如果用户希望审查代码质量，引导使用 `code-reviewer` Skill。

## 输出规范

- **业务代码**：输出到 `sourceRoots.src` 指定的目录（默认 `src/`，以 `logos.config.json` 配置为准）
- **测试代码**：输出到 `sourceRoots.test` 指定的目录（默认 `test/`，以 `logos.config.json` 配置为准）
- **Reporter**：嵌入测试代码中（非独立文件）
- **JSONL 结果**：`logos/resources/verify/test-results.jsonl`
- **实现清单**：`logos/resources/implementation/implementation-manifest.md`（所有批次完成后创建）

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
