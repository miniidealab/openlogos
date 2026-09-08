# Delta: core-smoke-test-cases.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`logos/resources/test/smoke/core-smoke-test-cases.md`

## ADDED — OpenLogos 0.15.0 打包候选安装态 smoke（SMOKE-core-197～199）

> 在**一次性隔离 npm prefix** 中对固定 0.15.0 tarball 取证。runner 必须为每个 owned ID 写 `pass|fail|skip`，禁止零记录退出；全程不得触碰本机全局 prefix。

| ID | 描述 | 精确期望 |
|---|---|---|
| SMOKE-core-197 | candidate identity 冻结 | 隔离 prefix 内 `--version` 为 `0.15.0`；入口 realpath 落在该 prefix 内；package 与 asset manifest 的 hash 与固定 tarball 逐字节一致，无 workspace link |
| SMOKE-core-198 | 破坏性契约生效 | `merge transaction status`、`merge-apply`、切片事务命令一律非零退出；临时项目内 `merge <slug>` 一次调用合并多目标并写 `SPEC_MERGED`；`change-lint` 输出恰 9 项检查；`slice plan --file` 与 `lint-specs` 均可执行 |
| SMOKE-core-199 | 本机全局零触碰 | smoke 执行前后 `command -v openlogos` 指向同一路径且 `--version` 均为 `0.14.25`；本机全局 prefix 下无 0.15.0 制品残留 |

### 自动化与证据要求

- runner 记录 tarball 路径与 SHA-256、隔离 prefix 路径、每步入口 realpath 与 version。
- 命令图中不得出现 `npm publish` / `dist-tag` / `git tag` / `gh release` / `git push` / 本机全局 `npm install -g`。
