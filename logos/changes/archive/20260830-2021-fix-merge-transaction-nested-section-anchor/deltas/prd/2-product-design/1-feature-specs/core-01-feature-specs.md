## ADDED — 2.46 Merge Transaction 嵌套章节锚同源解析

### 2.46.1 功能目标与职责边界

本功能让 S37 已生效的标题路径锚合同覆盖 merge transaction 的两个 producer：Agent producer 提交最终目标字节，由 transaction 在 seal/apply 阶段验证；OpenLogos producer 由 transaction 从 Delta 与 before 字节确定性合成。两者共享 Delta block 与 section-anchor 解析结果，但不混淆提交职责：`submit-content` 只保存原始 slot，语义裁决发生在 preflight。

### 2.46.2 共享解析模型

共享模块至少返回下列不可变事实，不向消费者暴露私有正则：

```ts
interface DeltaMaterialBlock {
  op: 'ADDED' | 'MODIFIED' | 'REMOVED';
  anchor: string;
  body: string;
  sourceStart: number;
}

interface ResolvedSectionAnchor {
  level: number;
  text: string;
  path: string[];
  start: number;
  end: number;
}
```

- block parser 只识别代码围栏外的 `ADDED / MODIFIED / REMOVED / REMOVED-ITEMS` 控制行，保留源序；`REMOVED-ITEMS` 交给守恒 evaluator，不能进入物质 composer。
- heading parser 只识别代码围栏外的 ATX heading，按 level 建树；路径以精确 ` > ` 分隔并按祖先层级逐段匹配。
- 单段锚只在全文件唯一时成功；路径锚只在完整祖先链唯一时成功。零命中、多命中、空段、同锚多物质 writer 均返回结构化失败，不取第一个候选。
- `start/end` 覆盖真实命中标题到下一同级或更高级标题之前；根标题身份始终来自 `level/text/path`，不得从 anchor 字符串重建。

### 2.46.3 Agent producer 语义验证

1. `submit-content` 成功条件只覆盖 slot identity 与原始字节安全，不读取 Delta 章节锚。
2. seal preflight 读取冻结 Delta、before 与已提交 final bytes，并按共享 block parser/resolver 验证物质操作：
   - `ADDED`：before 中不存在同名唯一目标，final 中形成唯一真实章节；
   - `MODIFIED`：before/final 中路径均唯一命中，真实叶标题 level/text 与祖先路径身份守恒，最终章节承载该 block 的完整正文；
   - `REMOVED`：before 唯一命中，final 中该路径不再可解析。
3. 验证不得要求 final 出现字面量 `父标题 > 叶标题`，不得仅凭叶标题首命中，也不得把围栏内 heading/marker 当成结构。
4. 失败通过结构化 target path 归因；只有唯一 Agent target 可 retry 时才局部 reopen。apply 在首写前重跑同一验证并与 sealed preflight identity 对账。

### 2.46.4 OpenLogos producer 合成

- `MODIFIED` 用 before 命中的真实 heading 行作为根标题，以 Delta body 替换 `[start,end)` 内正文；父章节、叶标题 level/text、未触及区段和相对子标题层级保持。
- `REMOVED` 只删除唯一命中的 `[start,end)`；`ADDED` 沿用既有追加语义，但重复标题仍 fail-closed。
- composer 与 Agent verifier 消费同一个 block/parser/resolver，不得保留 `^## ${anchor}`、扁平路径 heading regex 或非 fence-aware `parseDeltaSections()` fallback。
- 合成后的 candidate 重新解析并验证物质后置条件；失败不得进入 seal 或正式 apply。

### 2.46.5 同事务局部恢复体验

当 seal preflight 发现可归因的嵌套锚错误时，OpenLogos 先原子写回 `phase=collecting`，清除外层 seal、全部 sealed hash 与 rejected slot submitted hash，再尽力清理该 slot 私有字节。status/next 只从该权威 transaction 投影 missing slot。用户重写声明 staging path并 submit 后继续 seal/apply；transaction ID、plan hash、target set 与无关 slot hash 必须保持。

RunLogos 真实恢复固定使用 `mtx_e7f7b924499d49f96aaf8a2f`：修正版安装后只重提产品设计 slot，不修改其它 6 个已提交 slot，不 abort、不创建新 transaction。

### 2.46.6 兼容、失败与发布边界

- 公共 `openlogos/merge-transaction@1`、phase/action/classification、status/next JSON 与 receipt shape 零变化。
- 单段唯一锚、0/多命中 fail-closed、`ADDED / MODIFIED / REMOVED` 与 `REMOVED-ITEMS` 既有语义零回归。
- package/plugin/asset identity 必须统一提升为本地 candidate `0.14.4`；全局 `0.14.3` 作为固定回滚制品，不允许同 semver 不同字节。
- 不执行 npm publish、dist-tag、Git tag、GitHub Release、官网发布或 git push。

### 2.46.7 验收与追溯

- UT：UT-S09-271～274、UT-S37-37～40。
- ST：ST-S09-106～107、ST-S37-09～10。
- 安装态：SMOKE-core-168。
- 需求：AC-MT-ANCHOR-01～07；场景：S09、S37；架构：§三十七。
