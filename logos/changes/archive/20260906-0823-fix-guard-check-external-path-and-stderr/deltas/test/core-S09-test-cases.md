# Delta: core-S09-test-cases.md（fix-guard-check-external-path-and-stderr）

## ADDED — guard-check 管辖边界与阻断输出双通道测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-315 | 项目外路径放行（管辖边界） | launched 无提案 + 变量在场：Edit/Write `file_path` 为项目根之外目标（`~/.claude/projects/x/memory/a.md` 形态、另一临时目录绝对路径、`../other-repo/src/x.ts` 相对穿越）→ 一律 exit 0 放行；Bash 命令重定向项目外目标 → 放行；同批断言项目内非白名单源码仍 exit 2（边界收窄不外溢）；python3/node 归一化分支与 bash 兜底分支（PATH 中屏蔽 python3/node）行为一致 |
| UT-S09-316 | 阻断 reason 双通道输出 | launched 无提案 Edit 项目内源码 → exit 2；stdout 为 `{"reason":…}` 合法 JSON 且字面结构与旧版一致；**stderr 非空**且含「变更管理拦截」与 `openlogos change` 指引；Step 0 两处 fail-closed（变量指向不可进入目录 / 变量缺失且 cwd 非项目根）→ exit 2 且 stdout JSON 与 stderr 诊断同时在场；全部放行路径（exit 0）stderr 不新增噪音输出 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-121 | 项目外放行与项目内双通道拦截端到端 | 以 stdin JSON + env + cwd 模拟 Claude Code hook 调用真实 guard-check 脚本：① launched 无提案写项目外目标（用户级 `~/.claude` 形态路径于临时 HOME 下构造）→ exit 0、目标可由后续写入落盘；② 同一项目写项目内源码 → exit 2、stderr 含变更管理指引、stdout JSON 可解析且 reason 与 stderr 文本语义一致；③ 创建提案（guard 文件在场）后重放② → exit 0 放行 |

### 自动化与证据要求

- guard-check 为 bash 脚本：用例以 spawnSync 直接驱动脚本（stdin JSON、cwd、env 三输入矩阵），同时捕获并断言 stdout 与 stderr 两通道，不 mock 文件系统。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
