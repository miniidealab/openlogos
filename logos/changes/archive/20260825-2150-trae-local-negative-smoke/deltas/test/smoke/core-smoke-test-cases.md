## ADDED — TRAE `0.13.29` 本地隔离负向 Smoke

### 范围与统一前置条件

- 环境：`local-isolated`；HOME、npm prefix、cache、workspace 与 evidence root 均为一次性目录，禁止真实 HOME、全局 npm、workspace link 或源码直跑。
- 候选：`OPENLOGOS_TRAE_LOCAL_TARBALL` 指向本次真实 `@miniidealab/openlogos@0.13.29` tarball；包名、版本、清单、大小与 SHA-256 已在部署报告中固定。
- 回滚：`OPENLOGOS_TRAE_ROLLBACK_TARBALL` 指向真实 `0.13.28` tarball，版本与 SHA-256 已固定且可离线安装。
- 门禁：verify 已通过、`[deploy]` 已完成、`DEPLOY_DONE` 环境为 `local-isolated`，且用户独立授权 smoke。
- 边界：不启动 TRAE 国际版/CN，不执行真实写入工具，不读取或修改真实 `.trae/**`、账号、信任状态或记忆正文。

### 冒烟测试用例

| ID | 验证点 | 操作 | 通过标准与证据 |
|---|---|---|---|
| SMOKE-core-124 | `0.13.29` 真实 tarball 与 CLI 身份 | 只读核验候选 tarball 包名/version/清单/大小/SHA；从一次性 prefix 安装并解析 `openlogos` realpath 与版本 | 实际入口位于隔离 prefix，版本精确 `0.13.29`，清单含 CLI 与本地负向 runner/reporter；无 workspace link、源码入口、全局回退或网络替代 |
| SMOKE-core-125 | 本地隔离与公开副作用为零 | 核验 HOME、prefix、cache、workspace、evidence realpath；审计进程环境与允许写入根；检查发布调用审计 | 所有写入仅在一次性根；未触达真实 HOME、全局 npm、用户项目或真实 TRAE 状态；未执行 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 push |
| SMOKE-core-126 | 显式 TRAE 首写前拒绝 | 在隔离 workspace 预置合成 TRAE fixture 并记录清单/SHA；用安装态 CLI 执行 `init --ai-tool trae` | 非零退出且错误列出真实七宿主；不映射为 `other`；写入审计为零；配置、logos 与 fixture 前后清单/SHA 完全不变；输出不宣称 TRAE 可部署 |
| SMOKE-core-127 | `all` / sync 七宿主排除与严格失败 | 独立 fixture 执行 `init --ai-tool all`、`sync`；再用含 `trae` 的配置执行 sync | 成功路径精确包含 Claude Code、OpenCode、Codex、Cursor、ZCode、Qoder、WorkBuddy 且顺序稳定；无 `.trae/**` 新增；非法配置在总事务和版本戳前失败、无部分提交 |
| SMOKE-core-128 | 用户边界零触达且软控制非 PASS | 比较合成 Rules、Skills、Agents、Hooks、MCP、settings、账号占位、`enabled_folders`、不透明记忆与未知文件；审计 runner 的证据类型 | 全部文件清单/大小/SHA 不变，记忆正文未读取；runner 未启动 TRAE 或调用 wrapper；文件存在、UI、Rules/MCP/人工确认未被报告为 hard guard/capability PASS |
| SMOKE-core-129 | `0.13.29 → 0.13.28 → 0.13.29` 实际回滚恢复 | 在同一隔离 prefix 安装固定 0.13.28，核验入口/版本/七宿主最小状态，再恢复原 0.13.29 并重跑 SMOKE-core-126 的最小断言 | 两次切换均来自固定 tarball 且版本/realpath/SHA 可证；最终恢复 0.13.29；TRAE fixture 与用户边界始终不变；无真实全局安装或公开副作用 |

### 判定与 Reporter 合同

- dispatcher 必须发现并实际执行 SMOKE-core-124～SMOKE-core-129；不得由旧结果、mock、文件存在检查或手写 pass 补齐。
- 每个 runner 向配置的 smoke JSONL 路径写一行，至少含 `id`、`status`、`timestamp`、`duration_ms`、`environment: "local-isolated"`、候选/回滚 tarball SHA-256 和脱敏 `evidence`；失败还须含 `error`。
- 六个 ID 任一缺失、skip、fail、重复矛盾、环境/SHA 不匹配、runner/reporter 缺失或证据审计失败，均不得生成 `SMOKE_PASS`。
- SMOKE-core-126/127 保存脱敏命令、exit code、stderr 摘要、写入审计及目标 SHA-256；SMOKE-core-128 只保留不透明元数据与哈希，不保存账号或记忆正文。
- 本节全部 pass 只证明 OpenLogos 候选 tarball 保持 TRAE non-deployable 和隔离可回滚，不改变 D06 hard guard **BLOCKED**。

### 覆盖度校验

- [ ] 真实 tarball、版本与 CLI 身份：SMOKE-core-124。
- [ ] 一次性路径隔离与公开副作用为零：SMOKE-core-125。
- [ ] 显式 TRAE 首写前拒绝：SMOKE-core-126。
- [ ] `all`/sync 七宿主排除及严格配置失败：SMOKE-core-127。
- [ ] TRAE 用户边界零触达、软控制不得判定 PASS：SMOKE-core-128。
- [ ] 固定双 tarball 的真实回滚与恢复：SMOKE-core-129。
