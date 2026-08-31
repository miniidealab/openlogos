## ADDED — Authority Closure JSON 契约

## Authority Closure JSON 契约

### evaluation schema

当新合同适用时，change-lint、status、next 与 flow 的 Plan Package 投影使用同一个对象：

```json
{
  "authority_closure": {
    "schema": "openlogos/authority-closure-evaluation@1",
    "applicability": "required",
    "facts_total": 1,
    "facts_closed": 1,
    "projections": 4,
    "retired_shadow_sources": 2,
    "unresolved": 0,
    "pass": true
  }
}
```

字段均必填。`applicability` 闭合枚举为 `required|not_applicable`；所有计数是非负整数；`pass` 来自 AuthorityClosureEvaluator，不由 serializer 重新计算。已越过 plan 且从未启用新合同的 legacy proposal 可省略整个对象，不能输出伪造的 `not_applicable`。

### change-lint violations

`ChangeLintViolationCode` 新增：

```text
authority_impact_declaration_missing
authority_impact_malformed
authority_fact_reference_missing
authority_closure_incomplete
authority_cutover_unclosed
```

每项沿用 `code/path/message/fix_hint` 必填合同；不新增 warning 分支。排序层位于现有 Plan Package 结构检查之后、Delta 内容检查之前，同层按 path、fact 源出现序、code、message 全序。任一项使 `pass:false`、exit 2；文件不可读或 parser 无法完成为 exit 1 error envelope。

### 同源与挂载

- change-lint 在 `data.authority_closure` 输出 summary，并把 issues 映射为上述 violations。
- status/next 的 `plan_state.plan_package` 与 flow 当前节点从同一 evaluation 读取 ready/summary。
- 同一输入的 summary 必须深相等；命令特有 envelope、timestamp 与其它既有字段不参与比较。
- 消费者遇未知 schema/code 应保守阻断，不按 message 猜测语义。

### 兼容

既有字段、exit code 和 envelope 不改名。合法 not_applicable 返回 facts/projections/retired/unresolved 全 0、`pass:true`；required malformed 不得降级为 not_applicable。text 输出与 JSON 使用同一 issue 集合。
