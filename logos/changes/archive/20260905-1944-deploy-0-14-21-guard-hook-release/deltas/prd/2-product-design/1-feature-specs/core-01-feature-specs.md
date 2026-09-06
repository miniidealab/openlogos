## ADDED — 2.63 OpenLogos 0.14.21 候选内容与发布验收

### 2.63.1 候选内容清单（零新增语义）

`@miniidealab/openlogos@0.14.21` 相对 0.14.20 的全部行为差异即已合并入仓的 guard hook 三项修复（§2.62，提案 `fix-claude-guard-hook-project-dir-and-sync-deploy`）：

| # | 内容 | 生效面 |
|---|---|---|
| ① | hook 注册 `$CLAUDE_PROJECT_DIR` 形态 + 新旧幂等迁移 | init/adopt 新项目与 sync 触达的存量项目 |
| ② | guard-check 工作目录收敛 + fail-closed | 安装态脚本随包字节 |
| ③ | guard 资产纳入 sync 托管资产面（asset-manifest 版本化哈希） | 存量项目一次 sync 补齐硬闸 |

### 2.63.2 发布验收口径

- **身份**：UT-S19-38 tripwire 钉 `LOCAL_RELEASE_CANDIDATE_VERSION=0.14.21`/`ROLLBACK=0.14.20` 与全源一致。
- **安装态行为**：SMOKE-core-192 承载——guard 全链（子目录 cwd 拦截/放行、fail-closed）、存量项目 sync 补齐实测、固定 0.14.20 fail-open 对照（防断言空转）、roundtrip 无混装。
- **发布边界**：仅本机全局；部署与 smoke 各为独立人类确认点；矩阵失败停止部署回实现，全局异常按固定 0.14.20 tarball 回滚。
