## ADDED — S35 验收标准段检查测试（verify-self-sufficient-cases）

> 覆盖场景 `core-S35-change-lint.md`「S35 验收标准段检查」Step 1～7、EX-35.A1～EX-35.A5，功能规格 §2.106.8，需求 AC-VERIFY-SELF-09。
>
> **夹具 AC**：一次性 launched 项目与一份其余各段均合法、`change-lint` exit 0 的提案；各用例只改「验收标准」段。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|----|--------|---------|------|---------|
| UT-S35-225 | 缺段只警告 | 夹具 AC 删除整个「验收标准」段 | `change-lint --format json` | `warnings` 含 `acceptance_criteria_missing`，带指向 proposal.md 的 `path` 与补段 `fix_hint`；`violations` 为空、`pass=true`、退出码 0；`plan_package.ready` 与删段前相同 |
| UT-S35-226 | 字段缺失或为空 | 夹具 AC 依次：删去「平台限定用例」一行；「需要人参与的验收」冒号后为空 | `change-lint --format json` | 各产生一条 `acceptance_criteria_invalid`，点名字段与行号，`fix_hint` 含「没有就写『无』」；退出码 2 |
| UT-S35-227 | 占位文字未替换 | 夹具 AC 把三个字段恢复为脚手架的方括号占位 | `change-lint --format json` | 三个字段各一条 `acceptance_criteria_invalid`；退出码 2 |
| UT-S35-228 | 环境要求条目格式非法 | 夹具 AC 的「自动验收环境要求」依次为：`` `pkg:docker` ``；`` `env:` ``；`` `check:bad name` ``；散文「需要一个数据库」 | `change-lint --format json` | 四种各产生 `acceptance_criteria_invalid`，指出非法条目或「没有合法条目」，`fix_hint` 列出 `env:` / `command:` / `check:` 三种写法；退出码 2 |
| UT-S35-229 | 合法写法通过 | 夹具 AC 依次：三个字段均为「无」；「自动验收环境要求」为 `` `env:DB_URL` `` `` `command:docker` `` `` `check:db-ready` `` 后跟说明文字；`en` locale 的 `Acceptance Criteria` 段同等内容 | `change-lint --format json` | 均无违规与警告；退出码 0 |
| UT-S35-230 | 解析与 verify 对账同源 | 夹具 AC 的环境要求含三个合法条目与说明文字 | 以 change-lint 使用的段解析函数与 verify 对账读取条目 | 两者得到的条目集合相同（`env:DB_URL`、`command:docker`、`check:db-ready`），源码中只有一处解析实现 |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S35"`，测试名含用例 ID；失败不得写 pass。
- 每条用例在同一夹具上只改「验收标准」段，并以未修改夹具的 lint 结果作对照，证明违规或警告只来自该段。
- 所有临时目录在用例结束时删除。
