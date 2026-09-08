# Delta: core-S11-test-cases.md

> change: lite-cut3a-degate-clarification-ui-seed
> 目标：`logos/resources/test/core-S11-test-cases.md`

seed 恢复门由「不可恢复即硬阻塞」改为「隔离损坏 journal 后继续」（§2.74.3）。**只改损坏分支**：可前滚/可回滚路径与读锁竞争语义逐字不变，故本文件中断言锁竞争的用例一律不动。

## MODIFIED — baseline-on-touch：status journal 恢复门测试


> 本节补充 S11 status 的事务一致性回归；实现必须通过 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。

### 单元测试

| ID | 描述 | 前置条件 | 操作 | 预期输出 |
|---|---|---|---|---|
| UT-S11-B01 | 安全 partial 仍输出正常 status | adopted、仅 open run/未提交 staging、无未终结 journal | `status` / `status --format json` | staging 被排除；成功 envelope 的 `baseline_seed_state=partial`；正常阶段/提案前沿可读取 |
| UT-S11-B02 | 未终结 journal 恢复失败即隔离并继续 | journal=`prepared|committing`，staging/backup 损坏使前滚与回滚均失败；对 resources/index/coverage 读取点设哨兵 | `status --format json` | 非零 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留 error envelope；读取哨兵均为 0；不输出伪成功 modules/coverage/action |
| UT-S11-B03 | journal 可恢复后只读一致集合 | 分别准备可前滚全新与可回滚全旧夹具 | `status --format json` | 恢复与读取位于同一锁序；输出只匹配完整全新或全旧 fixture，不出现混合 hash/index/state |

### 场景测试

| ID | 描述 | 前置/故障注入 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S11-B01 | status/next 对安全 partial 与未终结事务分流 | 先构造仅 staging 的 partial，再在多文件 rename/index/state 各崩溃点构造可恢复/不可恢复 journal | 分别执行 status 与 next，并记录标准资源读取哨兵 | 安全 partial 两入口成功且 staging 不采信；可恢复夹具只读全旧/全新；不可恢复夹具（隔离后继续）两入口均硬报 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留、读取计数为 0 |

### golden 边界

- 无 journal、已成功恢复及安全 partial 的既有 status golden 只按本案明确改变的 seed/action 字段重拍。
- 不可恢复 journal 是操作错误夹具，不得录成正常 status golden，也不得以“始终输出 baseline_seed_state”覆盖错误 envelope。

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

