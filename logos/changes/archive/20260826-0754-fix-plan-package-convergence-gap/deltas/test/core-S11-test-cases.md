## ADDED — status 统一 Plan Package 观测测试

> 测试实现必须写 OpenLogos reporter；只读性用临时项目全量文件清单与逐文件 SHA-256 前后比较证明。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S11-58 | plan_state 挂载完整 evaluation | S11 Step 2→6 | 活跃 writing plan | collect status | plan_package、version、issues 与投影字段一致 |
| UT-S11-59 | ready 投影与 evaluator 同义 | S11 Step 3 | ready true/false 参数化 | status mapper | plan_ready 精确等于 evaluation.ready，不可被 checkbox 覆盖 |
| UT-S11-60 | issue 稳定排序与字段保真 | S11 Step 3 | 多文件多行问题 | 两次 collect | code/path/section/line/actual/expected/fix_hint 顺序逐字节一致 |
| UT-S11-61 | evaluator 操作错误不吞成成功态 | EX-3.1 | proposal 不可读/解析器抛错 | status | error envelope、非零；无 plan_ready 成功对象 |
| UT-S11-62 | 历史旁路维持真实前沿 | EX-6.1 | marker + 旧模板 | status derive | proposal_step 不回退，warning 不改变 plan_state |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S11-36 | status/lint/next/flow 四方同源 | Step 1→6 | 合法与多类非法 fixture | 连续运行四消费者 | ready、三态、issues 完全一致；schema 1.3.0 通过 |
| ST-S11-37 | status 所有路径只读 | EX-3.1、EX-6.1 | ready/invalid/operation-error/history fixture | 前后全量快照并运行 status | 文件集合与 hash 完全不变，无 marker/cache/stamp 写入 |

### 追溯与覆盖

- S11-AC-Plan-01 统一观测：UT-S11-58～UT-S11-60、ST-S11-36。
- S11-AC-Plan-02 操作错误：UT-S11-61、ST-S11-37。
- S11-AC-Plan-03 历史与只读：UT-S11-62、ST-S11-37。
