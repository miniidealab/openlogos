# Delta: core-S35-change-lint.md

> change: lite-cut2b-remove-baseline-closure
> 目标：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S35-change-lint.md`

change-lint 检查项由 10 项收敛为 9 项（L0～L8）。non-Markdown（OpenAPI / SQL）整文件 delta 的 marker 与内容校验原挂在 L9 下，L9 删除后迁入 **L4（delta 段标记与脱模板）**——它本就是「delta 的形态是否合法」这一判据，与 Markdown 段标记同类。

## MODIFIED — 时序图


```mermaid
sequenceDiagram
    participant H as 用户或宿主
    participant W as change-writer
    participant L as change-lint
    participant E as PlanPackageEvaluator
    participant C as 共享子 evaluator
    participant O as status next flow

    H->>W: Step 1: 请求完成 proposal/tasks
    W->>W: Step 2: 填充 scaffold 并从磁盘读回
    W->>L: Step 3: 运行 change-lint --format json
    L->>E: Step 4: 求值 Plan Package
    E->>C: Step 5: 求值章节、tasks、澄清、部署与 UI
    C-->>E: Step 6: 返回事实与问题
    E-->>L: Step 7: 返回 ready 与稳定 issues
    alt Plan Package 非法
        L-->>W: Step 8: exit 2 与 completion issues
        W->>W: Step 9: 定点修复并回到 Step 2
    else Plan Package 合法
        L-->>W: Step 8: exit 0 与 pass true
        W->>O: Step 9: 运行 next 双检查
        O-->>W: Step 10: 返回 ready-to-delta
        W-->>H: Step 11: 报告方案待批准
    end
```


## MODIFIED — 步骤说明


1. **用户或宿主**要求 change-writer 完成当前提案，而不是直接授权 Delta 或 merge。
2. **change-writer**保留 CLI canonical scaffold，只替换占位正文；落盘后重新读取真实字节。
3. **change-writer**从项目根运行带明确 slug 的 change-lint JSON 命令。
4. **change-lint**完成操作错误前置检查后调用唯一 **PlanPackageEvaluator** 作为 L0。
5. **PlanPackageEvaluator**调用 authority scan、tasks parser、clarification、deployment、baseline closure 与 UI 声明共享 evaluator。
6. **共享子 evaluator**返回结构化事实；不得自行写文件或吞掉解析错误。
7. **PlanPackageEvaluator**规范化、去重并稳定排序 issues，计算 proposal/tasks 三态与 ready。
8. **change-lint**在 ready=false 时 exit 2、ready=true 时继续 L1～L8 并最终 exit 0；操作错误仍 exit 1。
9. 失败时 **change-writer**只修 issues 指向的当前提案文件并读回重试；成功时运行 next 双检查。
10. **status/next/flow**消费同一 evaluation；next 必须进入 `ready-to-delta`，不得仍为 writing。
11. **change-writer**向用户报告最终收敛结果并等待 plan gate 批准，不自动产 Delta 或 marker。


## MODIFIED — S35 围栏提取单点、可归因诊断与门禁可满足性断言


### 场景目标

消除 `change-lint` 判定链上的两处判据分裂（YAML 围栏提取、测试 ID 语法），让多命中不再静默降级，并为「门在其阶段可满足」建立可执行的失败信号。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|---|---|---|
| C | `change-lint` evaluator | L0～L8 的完整判定 |
| S | `markdown-scan.authorityScan` | 围栏 / 缩进代码 / HTML 注释掩码的唯一判据（函数名承自历史，判据本身与 authority 无关） |
| G | 测试 ID 语法权威 | 语法与三种具名读法的唯一铸造点 |
| T | 门禁可满足性断言 | 每道门 × 该阶段合法最小提案 |

### 围栏提取归位时序

```mermaid
sequenceDiagram
    participant C as baseline-closure
    participant S as authorityScan（fence-aware 掩码）
    participant D as 诊断输出

    C->>S: Step 1: 对 proposal 全文求掩码
    S-->>C: Step 2: 每行的 masked 位
    C->>C: Step 3: 只在掩码外识别 ```yaml 围栏起止
    C->>C: Step 4: 过滤出含结构化声明的围栏
    alt 候选恰为 1
        C->>C: Step 5a: 正常解析
    else 候选为 0 或多于 1
        C->>D: Step 5b: 产出点名诊断——命中几处、分别在第几行
        Note over C,D: 禁止静默返回空集
    end
```

**Step 3 的判据**：全部 YAML 围栏提取器一律走 `markdown-scan` 的 fence-aware 掩码，不得自建裸正则。对含嵌套围栏的文档（如四反引号 markdown 块内示意一段 yaml），裸正则会比 fence-aware 多命中一个围栏——这正是掩码必须单点的原因。

**多命中不得静默降级**：任一围栏提取器在候选数不为 1 时，必须产出点名的诊断，说明命中了几处、分别在哪；不得静默返回空集或取第一个命中。

### 测试 ID 语法的单点与具名读法

| 读法 | 消费方 | 与权威语法的关系 |
|---|---|---|
| 结构化判定 | `test-change-set`、`test-slice-manifest`、`baseline-closure` | 完整语法 |
| 表格首列提取 | `test-slice-manifest` | 完整语法 + 行首锚定 |
| 正文扫描 | `automation-diagnostic` | 完整语法减去 SMOKE |

读法差异正当，各自定义不正当。本次消除的是四份独立演化的定义。

**语法与数据的一致性锚**：断言已合并测试规格中每一个表格首列 ID 都被权威语法接纳。原始缺陷不是正则写错了，而是没人检查正则与真实数据是否还对得上——11 个 JSON 系 ID 因此静默失联。

### 门禁可满足性断言

对每一道门构造「该门所处阶段的合法最小提案」，断言其通过：

| 阶段 | 合法最小提案含有 | 不含 |
|---|---|---|
| plan | 完整 proposal + tasks（`[delta]` 已规划、`[code]` 空标题） | 任何 delta |
| spec / merge | 上述 + 全部已规划 delta | `[code]` 切片 |

断言的价值不在验证当前 11 道门，而在新增门禁时立刻给出失败信号（架构 §四十一.6.2）。

### 诊断可归因要求

全部门禁诊断必须点名导致失败的实体本身——fact_id、测试 ID、文件路径、字段名。禁止「为空、非法或不在某集合中」这类无法定位的措辞。

### 不变量

1. **围栏判据唯一**：四个提取器对同一文档得到同一组围栏。
2. **多命中不静默**：候选数异常时必须产出诊断，不得降级为空集或空结论。
3. **语法唯一、读法具名**：语法恰一处定义；每种读法从其具名派生，不得独立定义。
4. **语法与数据不漂移**：已合并规格中每个表格首列 ID 都被权威语法接纳。
5. **门禁可满足性有断言**：每道门都有对应的「该阶段合法最小提案通过」断言。

### 异常与边界

- 文档不含任何 YAML 围栏：`extractDeclaration` 返回 `missing`，行为不变。
- 语法放宽只增不减：不存在此前被接纳、此后被拒绝的 ID。
- 元测试发现语法与数据漂移时，修复方向是调整语法或修正数据，**不得放宽断言本身**。

### 追溯

- 需求：AC-MERGEGATE-03、AC-MERGEGATE-04、AC-MERGEGATE-06～08。
- 功能规格：§2.51.3、§2.51.5～§2.51.7；架构：§四十一.6.1、§四十一.6.2。
- 测试：UT-S35-127～UT-S35-131、ST-S35-24；安装态 SMOKE-core-173。


## MODIFIED — S35 SQL 校验降级留痕的输出通道


### 场景目标

让 SQL 方言层的降级留痕经 `change-lint` 的既有 `warnings` 通道可见，且不改变 L4 的通过与否，也不产生输出漂移。

### 参与者与前置条件

| 别名 | 组件 | 说明 |
|---|---|---|
| L | `change-lint` | L4 的判定与输出 |
| V | `validateSql` | 回传层级结论与降级留痕 |
| W | `warnings` 通道 | 既有字段，非空才出现 |

### 输出时序

```mermaid
sequenceDiagram
    participant L as change-lint
    participant V as validateSql
    participant W as warnings

    L->>V: Step 1: 对每份 .sql delta 求校验结论
    V-->>L: Step 2: { 通过与否, 实际层级, 降级留痕? }
    alt 未通过
        L->>L: Step 3a: 计入 L4 violations（non_markdown_delta_invalid）
    else 通过且无降级
        L->>L: Step 3b: L4 通过，不产生 warning
    else 通过但已降级
        L->>W: Step 3c: 追加一条 warning（原因 / 缺失项 / 已执行层级）
        L->>L: Step 3d: L4 **照常通过**
    end
    L-->>L: Step 4: warnings 非空才输出该字段
```

### 输出契约

- **不计入 violations**：降级留痕不是违规，不影响 L4 通过与否，也不影响 `change-lint` 的整体退出码。
- **零漂移**：`warnings` 为空时字段整体省略——与既有约定一致，不因本功能改变无降级项目的输出字节。
- **可归因**：每条 warning 含 `code` / `message` / `fix_hint`；message 点名方言、缺失项与已执行层级，fix_hint 说明如何获得更强层级（如安装 `sqlite3`）。

### 不变量

1. 降级留痕只出现在 `warnings`，绝不出现在 `violations`。
2. 无降级的项目，其 `change-lint` 输出与本功能引入前逐字节一致。
3. warning 的存在与否不改变 merge 的准入结论——merge 只看 violations（S09 已冻结「准入判据等于 change-lint 完整结论」，此处的 violations 集合不因 warning 变化）。

### 异常与边界

- 同一提案多份 `.sql` delta 都降级：逐份产出 warning，不合并为一条——用户需要知道具体是哪一份。
- 降级与真实违规并存：violations 与 warnings 各自输出，互不吞并。

### 追溯

- 需求：AC-SQLGATE-08。
- 功能规格：§2.52.7；架构：§四十二.2。
- 测试：UT-S35-132～UT-S35-133、ST-S35-25；安装态 SMOKE-core-174。

