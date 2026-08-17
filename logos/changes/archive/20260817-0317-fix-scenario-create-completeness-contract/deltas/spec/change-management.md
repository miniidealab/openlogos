## ADDED — 场景 CREATE 结构完整性生产门与合并纵深防御

### 生产端完成条件

当 `baseline_closure` 含 `category: scenario, mode: CREATE` 目标时，change-writer 必须按 `spec/baseline-closure.md` §17 生成 canonical 文档。文件在场、task 已勾选或 Agent 自报 done 均不是完成证据；全部 Delta 产出后必须在项目根执行：

```bash
openlogos change-lint --slug <active-change> --format json
```

只有命令 exit 0 且 JSON `data.pass=true` 时，write-delta producer 才可报告规格完成。交付报告应携 slug、实际执行时间、exit code 与 `pass:true` 摘要；该摘要是本轮执行收据，不新增 marker 或生命周期事实源。exit 2 时必须消费 `violations[].code/path/message/fix_hint`，只修当前提案内被指向的 Delta，重跑直至通过；exit 1 先修复命令环境。

### canonical 与兼容边界

- producer 新写入固定使用 `## 步骤说明`，且步骤为至少 3 个非空有序列表项。
- evaluator 兼容 `步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`、`main path` 的精确标题；别名只用于读取，不授权 producer 继续生成多种格式。
- 兼容不 grandfather 旧假阳性：只有散文、围栏、注释或样例关键词的文档必须失败。
- Mermaid、异常/边界、追溯按结构和非空内容验收，不以全文字符串命中替代。

### merge 纵深防御与副作用边界

`openlogos merge <slug>` 继续在任何 `MERGE_PROMPT.md`、资源或状态写入前运行共享 closure evaluator。lint 通过不允许 merge 跳过重检；lint 后 Delta 漂移、目标模式漂移或 parser 异常均 fail-closed。

scenario CREATE 不完整时：

1. merge 返回非零并展示同源 `create_target_incomplete` 诊断；
2. 不生成或覆盖 `MERGE_PROMPT.md`；
3. 不修改 `logos/resources/**`、guard、scenario/decision counter、resource index、`SPEC_MERGED` 或其它 marker；
4. 修复后重新运行 change-lint，并在人工模式下重新到独立 spec-exit/merge 授权点。

### 跨仓边界

本仓修复 CLI evaluator、producer Skill 与规格/测试合同。RunLogos 正常 `write-delta` WorkUnit 的 lint barrier、重派预算、stderr/violation 展示和 triage 分类由独立 companion change `enforce-write-delta-lint-barrier` 承担；不得在本案中声称该宿主能力已经完成。merge 纵深预检无论宿主是否适配都必须保留。
