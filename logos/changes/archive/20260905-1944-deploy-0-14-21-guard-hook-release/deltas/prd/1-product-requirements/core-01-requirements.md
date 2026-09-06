## ADDED — OpenLogos 0.14.21 guard 修复候选发布需求

### 用户价值

已入仓的 Claude guard hook 三项修复（`$CLAUDE_PROJECT_DIR` 注册形态、guard-check 工作目录收敛 fail-closed、sync 托管 guard 资产）必须发布到本机全局才能生效：非根 cwd 静默 fail-open 与存量项目（含 runlogos）硬闸缺失存在于**已安装的 0.14.20 CLI**，发布 0.14.21 后存量项目一次 `openlogos sync` 即补齐硬闸。

### 候选发布要求（S19）

1. **候选身份链同步**：CLI package/lockfile、全部随包 plugin/资产模板 manifest、package asset manifest、`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.21`、`LOCAL_RELEASE_ROLLBACK_VERSION=0.14.20` 与发布身份 tripwire/golden 全链一致；真实 `npm pack` 冻结唯一 tarball SHA-256。
2. **隔离矩阵（部署前强制）**：一次性 npm prefix 安装固定 tarball，从绝对入口验收——candidate identity 无 workspace link；**guard 全链**（init 新项目 hook 为 `$CLAUDE_PROJECT_DIR` 形态；子目录 cwd 无提案改码被拦 exit 2 + reason、有提案放行；变量缺失且 cwd 非根 fail-closed）；**存量项目 sync 补齐实测**（无 guard-check/仅旧 SessionStart 的项目 sync 后硬闸齐备、旧条目迁移、重复 sync 幂等）；`0.14.20→0.14.21` roundtrip 无混装。
3. **零回归对照（强制）**：同一子目录 cwd 无提案改码场景在固定 `0.14.20` 上必须复现静默放行（fail-open 缺陷本身）；旧版也拦截则矩阵空转，必须重写矩阵而非放行部署。
4. **全局覆盖与 smoke**：矩阵与回滚演练 PASS 且用户授权后覆盖本机全局；新 shell 复核 identity 全同源 `0.14.21`；`openlogos smoke`（SMOKE-core-192）独立授权执行。
5. 回滚制品固定 0.14.20 tarball（SHA-256 `b252cec4465806a4555fa2cc2018fb908fc09f71ba9a198bbd9dd28fec01fcbf`）；回滚自检失败不得覆盖全局。

### 场景验收条件

#### S19 候选发布与 smoke 门禁

- 0.14.21 候选身份全源一致（UT-S19-38 tripwire）；SMOKE-core-192 全链 PASS 且 0.14.20 对照有效；部署与 smoke 各为独立人类确认点。

### 非目标

- 零新增语义（guard 行为合同已由 fix-claude-guard-hook-project-dir-and-sync-deploy 定稿）；不执行 npm publish、Git tag、GitHub Release、官网发布或 git push。
