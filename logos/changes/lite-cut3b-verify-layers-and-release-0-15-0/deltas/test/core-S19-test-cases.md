# Delta: core-S19-test-cases.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`logos/resources/test/core-S19-test-cases.md`

## ADDED — S19 OpenLogos 0.15.0 打包候选测试用例

> 覆盖 0.15.0 的版本身份同源与隔离 prefix 行为矩阵。**本轮不做本机全局安装**（减法方案 §13 保险条款），故无「全局切换/回滚」用例。测试实现必须写入 OpenLogos reporter。

### 单元测试

| ID | 描述 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S19-46 | 0.15.0 版本身份全源一致 | 仓库处于 0.15.0 实现完成态 | 读取 CLI `package.json`、lockfile 根包、asset manifest、随包 plugin/模板 manifest 与携带版本的 schema/runner 元数据 | 全部为 `0.15.0`，无一处残留 `0.14.25`；asset manifest 的逐文件 hash 与磁盘字节一致 |

### 场景测试

| ID | 描述 | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|
| ST-S19-22 | 隔离 prefix 真实 pack、安装与破坏性契约验收 | CLI 全量测试与构建已通过；`mktemp -d` 一次性 npm prefix；**不得触碰本机全局 prefix 与本仓活跃提案** | ① 真实 `npm pack --json` 并记录 tarball SHA-256；② 从 tarball 安装到隔离 prefix；③ 新 shell 绝对入口执行验收矩阵 | ① candidate identity 全部来自固定 tarball、无 workspace link；② 已删除命令面（`merge transaction status`、`merge-apply`、切片事务）一律非零退出；③ 临时项目内 `merge <slug>` 一次调用完成多目标合并并写 `SPEC_MERGED`；④ `change-lint` 输出恰 9 项检查、`slice plan --file` 与 `lint-specs` 可用；⑤ **执行前后 `command -v openlogos` 与其 version 均仍为 0.14.25**——全局未被触碰 |

### 追溯与覆盖

- AC-RELEASE-0150-01 candidate identity：UT-S19-46、ST-S19-22 步骤①。
- AC-RELEASE-0150-02 破坏性命令面：ST-S19-22 步骤②③。
- AC-RELEASE-0150-03 新命令可用：ST-S19-22 步骤④。
- AC-RELEASE-0150-04 全局未触碰：ST-S19-22 步骤⑤。
- 部署后 smoke：SMOKE-core-197～199。
