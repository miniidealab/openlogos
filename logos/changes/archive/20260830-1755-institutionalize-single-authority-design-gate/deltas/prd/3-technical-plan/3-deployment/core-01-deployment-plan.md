## ADDED — Authority Closure 本机 candidate 部署方案

## Authority Closure 本机 candidate 部署方案

### 部署目标与授权边界

以固定 npm tarball 在隔离 prefix 验证 Authority Closure evaluator、根规范、六个 Skill、插件/cache 投影与 asset manifest 同源；verify 通过后仍需用户分别授权部署和 smoke。不执行公开 npm publish、tag、release、官网发布或 git push。

### 部署前冻结

- 当前全局 `openlogos` 版本、入口、realpath、package root、plugin/asset manifest hash。
- 可恢复的当前版本 tarball/安装命令及 SHA-256。
- candidate 版本、tarball 绝对路径、文件清单、大小和 SHA-256。
- 当前工作区与活跃 change 状态；不把未提交源码作为安装态证据。

### 构建与隔离安装

1. 全量测试与 build 通过后 pack candidate，只使用该固定 tarball完成后续步骤。
2. 在 `mktemp -d` 创建隔离 npm prefix，安装 tarball并从新 shell 解析入口。
3. 核对 CLI version、package realpath、根 `spec/authority-closure.md`、六个 Skill 及插件/cache 资产 hash 与 manifest。
4. 运行 required/not_applicable、五类 violation、status/next/flow 同源夹具。
5. 运行 stale/conflict/response-lost/restart/legacy-writer/cutover rollback 行为矩阵。

### writer cutover 与 projection 校验

冻结 authority identity 后先证明旧 writer 被拒绝，再启用新 mutation entry；从 authority 重建投影并以 generation/version/hash/receipt 校验 freshness。未取得 exit evidence 前不得宣称 cutover 完成。不得让两个独立 writer 同时成功。

### 回滚

candidate 产生任何不可逆业务写入前可以恢复冻结版本。失败时移除 candidate 入口、重装固定旧 tarball，验证 version/realpath/assets/最小行为全部回到 before。随后再次安装同一 candidate，证明过程幂等且无混合资产。

### Smoke 与完成条件

SMOKE-core-163～167 全部通过并写入 `logos/resources/verify/smoke-results.jsonl`；candidate identity、asset hashes、共享 evaluator、stale/restart/cutover 和回滚证据齐全。任一失败不得写伪成功 marker，不进入 archive。
