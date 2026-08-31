## ADDED — S35 Authority Closure L10 测试

### 单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S35-112 | required 完整解析 | canonical YAML + current CREATE authority ref + 真实 test IDs | 无 violation，summary facts_closed=1/pass=true |
| UT-S35-113 | declaration missing | 新 writing proposal 无区块 | `authority_impact_declaration_missing` |
| UT-S35-114 | malformed 矩阵 | duplicate key/未知字段/非法 applicability/重复 fact_id/空字符串 | 每夹具 `authority_impact_malformed`，不得 last-wins |
| UT-S35-115 | fact 引用缺失 | Registry/当前 effective target 均不存在 | `authority_fact_reference_missing`，path/fact/fix_hint 精确 |
| UT-S35-116 | closure 字段缺失 | 分别缺 writer/mutation/projection freshness/recovery/tests/retired source | 每缺口 `authority_closure_incomplete`，多问题不短路 |
| UT-S35-117 | cutover 未闭合 | 分别缺 old stop/new start/rollback/exit，或 unresolved 非空 | `authority_cutover_unclosed`，稳定源序 |
| UT-S35-118 | not_applicable 严格分支 | 非空 evidence；空 evidence；夹带 facts | 仅首项通过，后两项 malformed/closure incomplete |
| UT-S35-119 | 真实测试 ID 校验 | effective test view 有/无引用 ID | 有者通过；未知/仅散文提及者 incomplete |
| UT-S35-120 | 多问题全序与只读性 | 同时触发五类 code并冻结全文件 hash | 全部返回且顺序稳定；命令前后字节集合一致 |

### 场景测试

| ID | 场景 | 操作序列 | 精确期望 |
|---|---|---|---|
| ST-S35-19 | producer 修复环 | 缺声明→按 issues 补 fact→补 cutover/tests→重跑 | exit 2→2→0；每轮只修指向内容，最终 plan ready |
| ST-S35-20 | lint/status/next/flow 共享 evaluator | 对同一合法与非法 proposal 运行四入口 | summary/issues 深相等；无命令局部 parser 分叉 |
| ST-S35-21 | stale/shadow/cutover 负向闭环 | 声明 stale projection、未退休 parser、旧 writer 仍活跃 | plan 被阻断；退休/关闭并补 exit evidence 后通过 |

### 追溯与 reporter

覆盖 `spec/authority-closure.md` §7～§9、AC-01～AC-08 和五类 violation。所有 UT/ST 使用 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`。
