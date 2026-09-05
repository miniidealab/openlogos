## ADDED — reopen 后 test change set 前滚合并测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-309 | 前滚合并规则 | 构造归档 receipt（changed=[A,B]）+ 当前快照 diff（changed=[C]，B 幂等零变化）：前滚后 changed=[A,B,C]；removed 后写胜出（祖先 changed 含 X、当前 removed 含 X → X 只在 removed）；两集合恒不相交、ASCII 排序去重 |
| UT-S09-310 | 边界情形 | 留痕行无对应 receipt（abort 祖先）跳过；receipt test_change_set 为 null 记空集；targets 与 hash 保持当前快照、sha256 重算且过既有 v1 校验 |
| UT-S09-311 | 失配与损坏 fail-closed | 祖先 receipt 身份（change/module/source）失配 → seal/apply 拒绝、错误信息含 receipt 路径与双方身份；留痕行或 receipt JSON 损坏 → fail-closed 点名损坏路径；均不静默降级为快照 diff |
| UT-S09-312 | 无留痕不变与同源 | 无 MERGE_REOPENS.jsonl 的提案 change set 与前滚关闭路径逐字节一致；sealed preflight 的 test_change_set_sha256 与 apply 落盘 SPEC_MERGED.test_change_set.sha256 恒相等 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-118 | reopen 幂等重合并全链 | 真实命令链：首次 merge 全链 completed（changed 含全部新增 ID）→ reopen --confirm-spec-merged → 仅修正一个非测试目标、其余 delta 幂等 → 重跑 merge→submit→seal→apply → SPEC_MERGED.changed_test_ids 仍含首轮全部 ID |
| ST-S09-119 | 多次 reopen 链式前滚 | 连续两次 reopen（每次修正不同目标、测试目标幂等），第二次重合并后 changed 仍提案级完整；每次前滚结果与按留痕行序逐次合并等价 |

### 自动化与证据要求

- ST 用例全部断言穿过公开 `openlogos merge` / `merge transaction` 命令，禁止库级函数直调充当闭环证据。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
