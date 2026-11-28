## ADDED — 生成指令保护范围条款与 guard 同口径测试用例（verify-self-sufficient-cases）

> 覆盖 `spec/agents-md.md`「变更管理例外文件清单与保护范围配置（guard-versioned-content-scope）」第 2、3、5 条（verify-self-sufficient-cases 评审 proposal-r2 F5 收窄后的口径）、功能规格 §2.106.9、需求 AC-VERIFY-SELF-10；场景 `core-S09-change-management.md`「S09 提案验收标准段」EX-9I.4。

### 单元测试

| ID | 测试点 | 关键断言 |
|----|--------|---------|
| UT-S08-90 | `zh` locale 下 `openlogos init` 与 `openlogos sync` 生成的 AGENTS.md / CLAUDE.md 托管段「保护范围配置」条款 | 两个文件都含新口径整行：`.gitignore`、`.git/info/exclude` 与 `logos/logos.config.json` 的 `guard` 字段决定保护范围、不得直接修改、走 `openlogos ignore|exempt` 并经宿主原生审批；同一条款写明 `logos/logos.config.json` 的其他字段（如 `verify.requirements`）只在已立案且属于当前提案范围时由实现任务直接修改；不再出现「`.gitignore`、`.git/info/exclude` 与 `logos/logos.config.json` 决定 guard 的保护范围」这种对整份配置文件的禁改文案 |
| UT-S08-91 | `en` locale 下同一条款 | 含 `spec/agents-md.md` 第 3 条的 en 文案全文（`the guard field of logos/logos.config.json` 与 `Other fields of logos/logos.config.json (such as verify.requirements) may be edited directly by the implementation task only when a change proposal is active and the edit is within its scope`）；不含旧的整文件禁改英文文案 |
| UT-S08-92 | 存量项目 `openlogos sync` 只更新托管段 | 夹具项目的 AGENTS.md / CLAUDE.md 托管段为旧文案、托管段外有用户内容；`sync` 后托管段换成新文案，用户段外内容逐字节不变；混合生命周期视图（`mixed`）下生成的同一条款与 `launched` 视图一致 |

### 自动化与证据要求

- 用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S08"`，测试名含用例 ID；失败不得写 pass。
- 既有断言旧文案的测试（`cli/test/s08-gitignore-sync.test.ts` 中「生成指令『唯一例外』不再列 .gitignore，追加保护范围配置行」与 `cli/test/s09-module-instructions.test.ts` 的基准 `fixtures/s09-module-instructions-baseline.json`）同步更新为新文案；基准只允许这一条款发生变化，其余字节不变。
- 所有临时目录在用例结束时删除。
