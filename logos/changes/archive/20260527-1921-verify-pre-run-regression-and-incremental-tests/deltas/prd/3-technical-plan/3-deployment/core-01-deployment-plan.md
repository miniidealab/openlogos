## ADDED — 十二、verify 预执行模型发布检查
本提案会修改 CLI 运行时行为、配置 schema、公开规范和 Skill 文档，因此需要执行 CLI/npm 发布与官网 / 文档站同步。

发布前检查：
- `cd cli && npm test` 覆盖 `verify.pre_run_command` 兼容路径。
- `cd cli && npm test` 覆盖 `verify.regression_command` + `verify.incremental_command` 两阶段执行与结果合并。
- `openlogos verify --format json` 输出 `pre_run` 状态、诊断和建议字段。
- `openlogos init`、`openlogos adopt`、`openlogos sync` 对可识别测试栈补齐 verify 预跑配置，无法推断时输出 TODO。
- `logos/spec/logos.config.schema.json` 与官网配置说明同步。

部署后检查：
- 安装发布后的 CLI，构造一个缺少预跑配置且 JSONL 覆盖不足的项目，`openlogos verify` 应输出局部测试诊断。
- 构造两阶段测试 fixture，`openlogos verify --format json` 应展示 regression / incremental 命令状态，并按最后一次同 ID 结果计算。
- 官网 / 文档站能展示新的 verify 配置字段、两阶段结果合并语义和 code-implementor 强制检查规则。

回滚策略：
- npm 包通过发布补丁版本回滚，必要时撤回客户端推荐版本。
- 官网通过 Cloudflare Pages 回滚到上一成功部署。
- 若两阶段模型存在兼容问题，旧项目仍可保留 `verify.pre_run_command` 单阶段路径作为临时降级方案。
