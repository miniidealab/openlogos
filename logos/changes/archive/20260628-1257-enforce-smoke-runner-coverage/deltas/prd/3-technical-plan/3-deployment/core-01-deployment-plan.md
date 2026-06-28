## ADDED — 十七、smoke runner 覆盖发布检查

本提案会修改 smoke 覆盖规则、CLI 预检行为、随包分发的 Skill / Spec 和官网文档，因此需要执行 CLI/npm 发布与官网文档同步。

发布前检查：
- `cd cli && npm test` 覆盖新增 smoke 用例时 runner 缺失、reporter 缺失、用例 uncovered 的诊断。
- `cd cli && npm test` 覆盖 `openlogos smoke --format json` 对 `smoke_runner_missing`、`smoke_reporter_missing`、`smoke_cases_uncovered` 的结构化输出。
- `skills/change-writer/SKILL.md`、`skills/test-writer/SKILL.md`、`skills/code-implementor/SKILL.md` 已要求新增或修改 smoke 用例时同步交付 smoke runner/reporter/dispatcher。
- `logos.config.json.smoke.command` 的推荐配置指向统一 dispatcher，或文档明确项目 runner 如何接入现有 command。

部署后检查：
- 安装发布后的 CLI，构造一个新增 `SMOKE-*` 用例但没有 runner 的提案，执行 smoke 覆盖预检应返回 `smoke_runner_missing`。
- 构造一个 runner 存在但未写入 `smoke-results.jsonl` 的提案，预检或 `openlogos smoke --format json` 应返回 `smoke_reporter_missing`。
- 构造一个结果文件缺少新增 `SMOKE-*` ID 的提案，预检或 `openlogos smoke --format json` 应返回 `smoke_cases_uncovered` 并列出缺失 ID。
- 构造统一 dispatcher 可发现 `scripts/smoke-*.sh` 或等效 runner 的项目，执行 `openlogos smoke --format json` 后新增 smoke ID 不应进入 `uncovered_cases`。

回滚策略：
- 若 smoke 覆盖预检误阻断正常提案，按既有 npm 补丁版本策略修复；必要时临时回退到上一版本 CLI。
- 官网文档异常时，通过 Cloudflare Pages 回滚到上一成功部署。
- 用户项目中已存在的 smoke runner 与 `smoke-results.jsonl` 属普通项目文件，回滚 CLI 不应删除。
