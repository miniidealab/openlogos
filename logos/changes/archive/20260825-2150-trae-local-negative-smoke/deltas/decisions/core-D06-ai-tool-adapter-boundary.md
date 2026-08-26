## ADDED — D06 TRAE 本地负向制品验证边界

### 决策结论

TRAE 国际版 `3.5.91` 与 CN `3.3.93` 的 hard guard 结论继续为 **BLOCKED**，规范 id `trae` 继续不注册且不得部署 TRAE Adapter。允许执行的部署仅指：将 OpenLogos CLI `0.13.29` 真实 npm tarball 安装到一次性 `local-isolated` 环境，并以负向 smoke 证明安装产物仍遵守 TRAE 排除合同。该活动不构成 TRAE capability PASS，也不重新开启 D06 Adapter 设计。

### 允许与禁止的部署语义

1. 允许对象仅为 `@miniidealab/openlogos@0.13.29` 候选 tarball；禁止对象包括 TRAE Adapter、插件、Hook normalizer、wrapper、模板和任何 `.trae/**` 托管资产。
2. 候选制品必须安装到一次性 npm prefix、HOME、缓存和项目目录；实际 CLI 解析路径必须位于该 prefix，禁止 workspace link、源码直跑、全局安装或真实用户 HOME。
3. `all`、帮助、交互选择与结构化支持列表继续只含既有七宿主；显式 `trae` 必须在首个目标写入前 fail loud。
4. TRAE Rules、Skills、Agents、Hooks、MCP、settings、账号、`enabled_folders`、原生记忆和未知文件保持宿主/用户所有；runner 不读取正文、不启动真实 TRAE 写工具，也不改变其状态。
5. 允许在同一隔离 prefix 演练 `0.13.29 → 0.13.28 → 0.13.29`，但两个 tarball 均须版本精确、SHA-256 可追溯且仅作用于一次性目录。
6. 不执行 npm publish、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署或 `git push`。

### 判定与重新开启条件

- 负向 smoke 只能报告“OpenLogos 安装产物保持 TRAE non-deployable”，不得报告“TRAE 已支持”或“TRAE hard guard 通过”。
- 任一制品身份、隔离边界、写前拒绝、七宿主回归、TRAE 用户资产哈希或回滚恢复检查失败，部署/smoke 即失败，不得写成功 marker。
- 文件存在、wrapper 直调、Rules/MCP 软拒绝、人工确认或客户端 UI 仍不得作为 hard guard PASS。
- D06 的重新开启条件保持不变：未来独立提案必须让国际版与 CN 的受支持版本共同通过真实内置写工具的完整 fail-closed 矩阵。

### 追溯

- 提案：`trae-local-negative-smoke`
- 场景：S01、S08、S19
- Smoke：SMOKE-core-124～SMOKE-core-129
