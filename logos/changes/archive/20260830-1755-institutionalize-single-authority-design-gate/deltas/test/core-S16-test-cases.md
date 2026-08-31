## ADDED — S16 Authority Closure JSON 测试

### 单元测试

| ID | 场景 | 输入 | 精确期望 |
|---|---|---|---|
| UT-S16-35 | required summary shape | 一个闭合 fact、四个 projection、两个 retired source | 八字段全在场、snake_case、计数与 evaluator 一致、pass=true |
| UT-S16-36 | violation code 闭合枚举 | 分别触发缺声明/畸形/引用缺失/闭包缺失/cutover 缺失 | 仅返回五个规范 code，item 四字段必填 |
| UT-S16-37 | legacy 省略与 not_applicable 区分 | 已越过 plan legacy；合法 not_applicable | legacy 省略对象；not_applicable 对象在场且零计数/pass=true |

### 场景测试

| ID | 场景 | 操作序列 | 精确期望 |
|---|---|---|---|
| ST-S16-11 | 四消费者同源 | 对同一 proposal 运行 change-lint/status/next/flow JSON | 去除命令 envelope/timestamp 后 authority summary 深相等；issues 同源排序 |

### 追溯与 reporter

覆盖 JSON 规范、AC-05 和历史兼容。实现必须使用 OpenLogos reporter 写 `logos/resources/verify/test-results.jsonl`。
