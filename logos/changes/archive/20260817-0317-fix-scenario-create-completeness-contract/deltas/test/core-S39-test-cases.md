## ADDED — 场景 CREATE 结构化完整性回归测试

### 测试边界与事实源

本组用例追溯 S39 验收条件 8～12、功能规格 §2.35.9、S39 场景 EX-7.1～EX-10.1。测试只改变 scenario CREATE 的结构完整性判断；API/DB/编排为 SKIP，其它类别 CREATE 判据作为回归保持不变。

所有 UT/ST 实现必须使用下列真实 ID，并由项目全局 OpenLogos reporter 把结果写入 `logos/resources/verify/test-results.jsonl`。用例不得通过手工补写 JSONL 或族名占位满足覆盖率。

### 新增单元测试（UT）

| ID | 检查项 | 来源 | 输入/夹具 | 精确期望 |
|---|---|---|---|---|
| UT-S39-28 | canonical 与兼容标题矩阵 | S39-AC-08、EX-7.1 | 以同一份完整场景分别使用 h2/h3 的 `步骤说明`、`主路径步骤`、`主路径`、`主流程`、`正常流程`、`main path` | 每项均识别为唯一合法步骤章节；canonical 写入样例固定为 `## 步骤说明`；不报告“缺步骤” |
| UT-S39-29 | 权威区排除散文、围栏与注释 | S39-AC-09、EX-7.2 | 无真实步骤章节；分别只在普通散文、反引号/波浪线 fence、HTML 注释、Mermaid 消息中放入“步骤”或别名 | 每个夹具均返回 `create_target_incomplete`，missing evidence 精确包含步骤章节缺失；输入字节不变 |
| UT-S39-30 | 唯一步骤章节与有序列表阈值 | S39-AC-09、EX-7.3 | 参数化：恰好 3 个非空有序项、2 项、空项、仅无序列表、重复别名章节、其它章节中的编号 | 仅恰好/多于 3 个有效有序项且章节唯一时通过；其余分别报告列表不足/空项/无有序列表/章节重复，不被其它编号蒙混 |
| UT-S39-31 | Mermaid 时序结构 | S39-AC-10、EX-7.4 | 参数化：合法 mermaid fence；普通 fence/散文中的 `sequenceDiagram`；仅 1 个 participant；无消息；HTML 注释内完整图 | 只有含 `sequenceDiagram`、至少 2 个 participant/actor 和至少 1 条消息的 Mermaid fence 通过；其余精确失败 |
| UT-S39-32 | 异常/边界与追溯非空 | S39-AC-11、EX-7.3 | 参数化：两节均有正文/列表；标题后只有空白、注释或 fence；缺失；重复标题 | 仅唯一且具有权威非空内容时通过；其它夹具返回对应缺口，稳定排序且不受样例内容干扰 |

### 新增场景测试（ST）

| ID | 场景 | 覆盖 Steps/EX | 前置条件 | 操作序列 | 精确期望 |
|---|---|---|---|---|---|
| ST-S39-14 | 四份历史 `主流程` Delta 兼容 | Step 3→7、EX-7.1 | 从 bug 报告对应归档提取 S27/S28/S31/S32 原始语义结构，标题保持 `### 主流程`，每份至少 3 个有序项 | 在隔离项目声明四个 scenario CREATE target 与一一对应 tasks/deltas，运行 `openlogos change-lint --format json` | exit 0、`data.pass=true`；四个路径均不出现 `create_target_incomplete / 缺步骤`；fixture 不被自动改名 |
| ST-S39-15 | 完整 canonical 场景贯穿 lint 与 merge 预检 | Step 1→11 | 隔离 launched 项目，目标缺失；Delta 含 canonical 标题、3+ 步、合法 Mermaid、非空异常/追溯 | 运行 change-lint，随后在测试夹具授权范围内调用 merge 预检并检查生成物 | lint 通过；merge 预检结论一致并生成预期 apply 指令；最终目标预演不含 ADDED marker |
| ST-S39-16 | 真正缺步骤时 merge 原子失败 | EX-7.2、EX-10.1 | 合法闭包计划与其它 10 个目标齐备，仅场景 CREATE 无权威步骤章节；保存项目全文件清单/哈希、guard、counter、index、marker 快照 | 先运行 change-lint，再调用 merge；捕获 exit、violations 和前后快照 | lint exit 2；merge 非零且不生成 `MERGE_PROMPT.md`；资源、guard、counter、index、`PLAN_APPROVED`、`SPEC_MERGED` 与其它 marker 字节不变 |

### Fixture 与断言约束

- Markdown scanner 的单元夹具必须同时覆盖反引号与波浪线 fence、带语言 info string、跨行 HTML 注释、h2/h3 标题和 CRLF/LF。
- 历史四份 fixture 固定来自已归档事实，不在测试中先把 `主流程` 改成 canonical 后再验证。
- missing evidence/message/fix_hint 断言使用稳定语义字段；不得只断言“数组非空”。
- ST-S39-16 的无副作用快照至少覆盖文件集合和逐文件 sha256，不能只检查 `SPEC_MERGED` 缺失。
- UT/ST 运行必须包含现有 UT-S39-12、S09/S35 change-lint 与 merge 回归，证明其它 CREATE 类别和纵深门未被放宽。

### 验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|---|---|---|
| S39-AC-08 | canonical 写入与受控别名兼容读取 | UT-S39-28、ST-S39-14、ST-S39-15 |
| S39-AC-09 | 唯一步骤章节、至少 3 个非空有序项、非权威关键词不计 | UT-S39-29、UT-S39-30、ST-S39-16 |
| S39-AC-10 | Mermaid fence、参与者与消息完整 | UT-S39-31、ST-S39-15 |
| S39-AC-11 | 异常/边界和追溯唯一且非空 | UT-S39-32、ST-S39-15 |
| S39-AC-12 | lint/merge 同源、失败无副作用 | ST-S39-15、ST-S39-16 |

### 覆盖度结论

- [x] S39 新增正常验收条件全部有自动化 ST。
- [x] S39 新增异常/边界全部有 UT 或 ST。
- [x] S39 场景 EX-7.1～EX-10.1 全部有明确覆盖。
- [x] API required、DB 约束与 API 编排不适用，已由场景与 proposal 的 SKIP 证据闭环。
- [x] OpenLogos reporter 路径和真实 ID 已定稿，不能由 smoke 或旧 UT-S39-12 替代。
