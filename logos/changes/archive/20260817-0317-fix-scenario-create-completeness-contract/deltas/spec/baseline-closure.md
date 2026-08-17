## ADDED — 17. 场景 CREATE Markdown 结构完整性合同

### 17.1 适用范围与单一事实源

本节规范 `category: scenario, mode: CREATE` 的最低完整性判定，替代 scenario 分支对整段 payload 的关键词正则。`ScenarioCreateCompletenessContract` 与 Markdown authority scanner 由 baseline closure evaluator 统一持有；change-lint、merge、proposal lifecycle 只能调用该 evaluator，不得各自复制别名、阈值或围栏解析。

本节只证明目标文档结构自足，不判断业务语义是否正确，不改变 requirement/API/database/test/orchestration/decision 等其它类别的完整性合同。

### 17.2 canonical 写入与兼容读取

新建场景文档必须使用以下 canonical 二级章节：

```text
# SXX：场景名称
## 场景目标
## 参与者
## 前置条件
## 成功后置条件
## 时序图
## 步骤说明
## 异常与边界
## 追溯
```

步骤读取端接受去除首尾空白后、大小写不敏感的完整标题文本：`步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`、`main path`。其中 `main path` 保留旧校验器已有兼容。兼容标题可位于 h2～h6 ATX 标题，但新写入只能使用 `## 步骤说明`；不接受子串、模糊词干或任意包含“步骤”的标题。

### 17.3 权威 Markdown 扫描

scanner 按行维护 fenced code 与 HTML comment 状态，并输出 ATX 标题、章节范围、有序列表项和 fenced block：

- 反引号/波浪线 fence 中的标题、列表、关键词和 `sequenceDiagram` 均不属于普通 Markdown 权威结构；只有 info string 精确为 `mermaid` 的完整 fence 可作为时序候选。
- `<!-- ... -->` 单行或跨行注释中的全部内容忽略。
- 普通散文、表格、链接文字、inline code 和 Mermaid 消息中的步骤别名不作为标题。
- 未闭合 fence/comment 或 scanner 无法确定边界时 fail-closed，不退回全文正则。
- LF/CRLF 归一化只影响解析，不改写输入字节。

### 17.4 步骤章节判定

1. 受控别名命中的权威步骤章节必须恰好一个；零个为缺失，两个及以上为重复。
2. 章节范围内必须有一个连续有序列表，合计至少 3 个列表项；每项移除有序 marker 后正文 trim 非空。
3. 普通段落、无序列表、其它章节中的编号、代码 fence 内列表均不计入。
4. 标题合法但无列表、少于 3 项或存在空项分别产生精确 missing evidence，不压缩为笼统“步骤”缺失。

### 17.5 Mermaid、异常与追溯判定

- 至少一个合法 Mermaid fence 的有效正文包含 `sequenceDiagram`，并至少包含 2 条 `participant` 或 `actor` 声明和 1 条消息箭头；普通 fence/散文/注释中的相同字符串无效。
- 异常/边界章节与追溯章节必须各自唯一；章节内容排除空白、注释和 fence 样例后，至少有一段非空正文或一个非空列表项。
- 目标、参与者、前置与成功后置继续是 scenario CREATE 必需维度；本节的结构判定不得导致既有维度被移除或放宽。

### 17.6 诊断、顺序与原子性

外层 violation code 保持 `create_target_incomplete`。evaluator 一次收集全部结构缺口，按“目标/参与者/前后置/时序/步骤/异常边界/追溯”的固定维度顺序返回，并在 `message`、`missing_evidence`、`fix_hint` 中区分具体原因。

change-lint 对失败返回 exit 2 且项目字节不变。merge 在生成 `MERGE_PROMPT.md` 或任何 apply 输入前纵深重跑同一 evaluator；失败返回非零且不得写资源、guard、counter、resource_index、`SPEC_MERGED` 或其它 marker。任何 parser 异常都按不完整处理，不得因兼容需要放弃 fail-closed。

### 17.7 验收矩阵

- canonical 标题与全部受控别名、h2/h3、LF/CRLF 正例通过。
- 散文、fence、HTML 注释、样例中的关键词不能假通过。
- 空/重复步骤章节、少步骤、空项、无序列表不能通过。
- 伪 Mermaid、参与者不足或无消息不能通过。
- 空异常/边界或追溯不能通过。
- 四份历史 `主流程` fixture 通过；真实缺步骤的 change-lint/merge 失败且无副作用。
