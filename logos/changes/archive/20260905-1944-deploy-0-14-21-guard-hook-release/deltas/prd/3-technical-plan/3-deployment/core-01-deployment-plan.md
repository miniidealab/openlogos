## ADDED — OpenLogos 0.14.21 guard 修复本机全局部署方案

### 部署目标与授权边界

把已入仓的 guard hook 三项修复冻结为唯一 `@miniidealab/openlogos@0.14.21` npm tarball，先在隔离 prefix 完成行为矩阵与回滚演练，再在用户明确授权后覆盖本机全局 `openlogos@0.14.20`。部署完成后仍需独立 smoke 授权。

本方案不包含 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 git push。

**本次为何必须部署**：三项缺陷存在于**已安装的 0.14.20 全局 CLI**——非根 cwd 会话 guard 静默 fail-open、存量项目（含 runlogos）硬闸缺失；不发布则修复永不生效、存量项目无法经 sync 补齐。

**本次为何必须走安装态**：hook 注册形态由 init/sync 写入项目 `.claude/settings.json`、guard-check 为随包 bin、sync 资产面依 asset-manifest 托管——三者全是安装态行为；「存量项目 sync 补齐」只有安装态能实测。

### 部署前置与冻结事实

1. guard 修复提案已归档（verify 2160/2160 PASS）；本提案 Delta 已 merge、代码切片与 UT/SMOKE runner 已实现并 verify PASS。
2. 冻结当前本机全局 `0.14.20`：`command -v openlogos`、realpath、npm prefix、package/plugin/asset manifest version/hash。
3. 固定回滚制品：`logos/resources/verify/deployment-artifacts/fix-reopen-test-change-set-forward-merge/miniidealab-openlogos-0.14.20.tgz`（SHA-256 `b252cec4465806a4555fa2cc2018fb908fc09f71ba9a198bbd9dd28fec01fcbf`，0.14.20 部署窗口冻结件）；回滚自检失败时不得覆盖全局。
4. 部署输入绑定可追溯 source commit。

### 0.14.21 版本与制品身份

实现阶段必须同步：CLI `package.json` 与 lockfile 根包版本；全部随包 plugin/资产模板 manifest 版本；package asset manifest 与携带版本的 schema/golden/runner 元数据；`openlogos --version` 编译输出与 tarball 包名版本；`LOCAL_RELEASE_CANDIDATE_VERSION` 提升为 `0.14.21`、`LOCAL_RELEASE_ROLLBACK_VERSION` 置为 `0.14.20`，并同步发布身份 tripwire 断言。禁止继续以 `0.14.20` 构建新字节。

### 构建与 Tarball 冻结

1. 仓库真实 CLI package 完整 test/build/package-assets 流程；真实 `npm pack`，记录 tarball 路径、字节数、清单与 SHA-256。
2. 从解包 tarball 核对 CLI entry、`0.14.21` version、随包 `claude-plugin-template/bin/guard-check` 新字节（含 Step 0 工作目录收敛）与 asset-manifest 的 guard-check 条目。
3. 任何重新 pack 产生新 candidate identity。

### 隔离 Prefix 行为矩阵

`mktemp -d` 一次性 npm prefix 安装固定 `0.14.21` tarball，从新 shell/绝对入口执行：

| 类别 | 必须证明 |
|---|---|
| candidate identity | version、entry realpath、package/asset hash 全部来自固定 tarball，无 workspace link |
| **guard 全链（核心验收）** | init 新项目：settings.json 两 hook 均 `$CLAUDE_PROJECT_DIR` 形态；launched 无提案 + 子目录 cwd + 变量在场 → Edit 拦截（exit 2 + reason）；有提案（guard 文件在场）→ 放行 |
| **fail-closed** | 变量缺失且 cwd 为项目子目录 → exit 2 + 诊断（不再静默放行）；变量指向不可进入目录 → exit 2 |
| **存量项目 sync 补齐实测** | 构造无 guard-check、settings 仅旧相对 SessionStart 的项目：`openlogos sync` 后 bin 落盘（与随包同字节）、PreToolUse 补齐新形态、旧条目迁移；重复 sync 幂等零变化 |
| **既有能力零回归** | merge 事务/前沿/change set 前滚（SMOKE-core-190/191 断言族抽样）保持通过 |
| rollback roundtrip | `0.14.20→0.14.21→0.14.20→0.14.21` 每阶段 identity 与行为对应固定制品，无混装 |

### 零回归对照（强制，不可省略）

guard 矩阵项必须在固定 `0.14.20` 上执行一次并记录：

| 矩阵项 | 在 0.14.20 上的预期表现 |
|---|---|
| 子目录 cwd + 变量缺失 + 无提案改码 | **静默放行（exit 0）**——fail-open 缺陷复现（缺陷本身） |
| 存量项目 sync | guard-check 不落盘、PreToolUse 不补齐（sync 资产面缺失复现） |

若 0.14.20 上也拦截/也补齐，说明矩阵空转，必须重写矩阵而非放行部署。

### 本机全局部署

隔离矩阵、零回归对照与 `0.14.20` 回滚演练全部 PASS，且用户明确授权后，把同一 SHA-256 的 `0.14.21` tarball 安装到已冻结 npm global prefix；新 shell 复核 entry/realpath/version 与 manifest 全同源 `0.14.21`。

### 失败处置与回滚边界

- 隔离矩阵失败：停止部署，回实现，重新 verify/build/pack。
- 全局安装后行为异常：以固定 `0.14.20` tarball 回滚并复核 identity 全回 `0.14.20`。
- 不得为让矩阵通过而伪造 settings.json/guard 产物或跳过零回归对照。

### 追溯

- 需求：OpenLogos 0.14.21 guard 修复候选发布需求。
- smoke：SMOKE-core-192。
