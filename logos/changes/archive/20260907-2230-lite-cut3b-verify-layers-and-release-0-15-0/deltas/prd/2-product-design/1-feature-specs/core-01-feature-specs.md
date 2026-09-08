# Delta: core-01-feature-specs.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`

## REMOVED — 2.35 按触达目标形成规格闭包（S39，baseline-on-touch） [1]

lite-cut2b 废止本节时按 `#### 2.35.x` 子节逐节删除，留下嵌套的两个字节相同的空标题壳（`## 2.35` 内嵌 `### 2.35`），当时的章节锚无法唯一定位。lite-cut2c 交付序数锚 `[n]` 后首次可精确删除——`## 2.35` 是外层节，一并带走内层壳与 lite-cut2b **遗漏的 `#### 2.35.9 场景 CREATE 结构化完整性合同`**（该合同定义 scenario CREATE 的最低结构完整度，属 L9 的 `createCompletenessProblems`，随 L9 一并失效）。

## ADDED — 2.75 verify 判定层收敛为「执行结果 + ID 覆盖」

### 2.75.0 问题：声明覆盖了事实

`openlogos verify` 此前有三层同时参与 Gate：

| 层 | 内容 | 性质 |
|---|---|---|
| Layer1 | 测试规格「三、覆盖度校验」清单的勾选项 | **作者在设计期写下的自我断言** |
| Layer2 | 测试执行结果（pass/fail/skip） | 机器观察到的事实 |
| Layer3 | AC → 用例 → 结果的人工追溯矩阵 | **人工维护的对照表** |

Layer1 与 Layer3 都是「人声称覆盖了」，Layer2 与 ID 覆盖检查是「机器看到确实跑了」。让前者参与放行，等于让声明覆盖事实——这与减法方案 §10「任何审计产物都不得出现在流程分支的条件里」是同一条判据。

### 2.75.1 收敛后的 Gate 判据

Gate 通过当且仅当三项同时成立：

| 判据 | 含义 |
|---|---|
| 账本一致性 | 结果账本自洽（无重复记录、计数与集合相符） |
| 零失败 | 无 `status:"fail"` 的用例 |
| **零未覆盖** | **规格声明的 ID 集合 ⊆ 测试结果中出现的 ID 集合** |

第三项即方案 §11 B 类第一项要保住的能力，**完整保留**：规格声明 10 个用例、只实现 3 个、那 3 个绿了——仍判 FAIL 并逐个点名未覆盖 ID。规格驱动的核心价值由它承载。

### 2.75.2 随之移除

- Layer1 覆盖度校验清单的解析与 `checklist_incomplete` 判定
- Layer3 AC 追溯矩阵的构建与 `ac_trace_incomplete` 判定
- 二者在 `acceptance-report.md` 中的输出段与 JSON envelope 中的 `checklist` / `ac_trace` 字段

**为什么连报告一并删**：留着报告段而不参与判定，等于留一份没人负责维护的追溯表——它会随规格漂移而失真，反而误导读者。测试规格中的「三、覆盖度校验」小节与 AC 追溯行作为**文档**保留，供人阅读。

### 2.75.3 追溯

- 测试：UT-S13-67～68、ST-S13-19。

## ADDED — 2.76 OpenLogos 0.15.0 候选内容与打包验收

### 2.76.0 版本性质

0.15.0 是**破坏性版本**，不做兼容层。相对 0.14.25 的契约变更：

| 面 | 变更 |
|---|---|
| 命令 | `merge transaction *` 全族与 `merge-apply` 删除；`merge <slug>` 一次调用完成；新增 `slice plan --file`、`lint-specs` |
| change-lint | 检查项 11 → 9（L0～L8）；违规码 52 → 37；L8 降为警告 |
| JSON 投影 | 不再发射 `data.merge_transaction` / `data.baseline_closure` / `data.authority_closure` / `plan_state.clarification` / `checklist` / `ac_trace` |
| 契约版本 | 实际只发射 `1.0.0` / `1.1.0` / `1.3.0`；`1.2.0` 与 `1.4.0` 永不发射，superset schema 仍文档化（消费方按未知值保守处理） |
| flow | GUI overlay 移除 `verify-ui-provenance` 节点 |
| 提案文档 | `baseline_closure` / `authority_impact` 两个 YAML 块取消；「决策澄清」小节保留为纯文档 |

### 2.76.1 打包与验收边界

**只打包与隔离验证，不做本机全局安装**——减法方案 §13 保险条款：全局保持 0.14.25 直到 runlogos 侧改造完成，任何时刻只有一个项目处于施工中。

不包含 npm publish、dist-tag、Git tag、GitHub Release、官网部署或 `git push`。

### 2.76.2 追溯

- 测试：UT-S19-46、ST-S19-22、SMOKE-core-197～199。
