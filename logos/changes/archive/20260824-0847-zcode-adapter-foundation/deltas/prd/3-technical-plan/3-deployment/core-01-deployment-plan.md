## ADDED — ZCode Adapter staging 真实 tarball 部署检查

### 部署目标与边界

- 目标环境仅为 **staging**：安装本提案构建的真实 npm tarball，并由真实 ZCode CLI/客户端验证随包插件与 Hook 协议。
- 本次不是公开发布：禁止 `npm publish`、Git tag、GitHub Release、官网发布、Cloudflare 部署和 `git push`。
- 部署执行仍在 verify PASS 后，并需要独立的人类部署授权；本节只定义可执行方案，不构成当前执行授权。

### 前置门禁

1. 本提案所有实现切片与 OpenLogos reporter 已完成，验收报告为 PASS。
2. staging 主机安装受支持的 Node.js/npm 与真实 ZCode CLI，能启动全新 ZCode session。
3. 记录当前 staging CLI 版本、来源、上一可用 tarball 路径和 SHA-256；确认回滚 tarball 可离线安装。
4. 使用一次性临时项目与隔离的 ZCode 用户/插件目录，不复用生产凭据或生产工作区。
5. 确认网络、凭据和 npm registry 均非验证必需；tarball 来自当前受控构建目录。

### 制品构建与证明

在未来获部署授权后，部署执行者按仓库真实脚本解析等价命令，不在本 Delta 阶段执行：

1. 安装锁文件依赖，执行 CLI build 与全部自动化测试。
2. 在 `cli/` 运行真实 `npm pack`，保存生成的 `.tgz`，不得以源码链接或 workspace 直连替代。
3. 记录 tarball 文件名、package name、version、字节数和 SHA-256。
4. 展开或列出 tarball，证明包含编译后 CLI、ZCode plugin manifest、Skills、Commands、Agents、`hooks/hooks.json`、共享 Node.js runtime、双语模板与所需规范。
5. 从隔离目录用 tarball 安装 CLI，记录 `openlogos --version` 和实际解析的可执行文件路径，证明未命中全局旧版本。

### staging 安装与真实 ZCode 验证

1. 创建两套一次性 fixture：全新项目用于 init，含既有 AGENTS/`.zcode/config.json`/用户插件的存量项目用于 adopt。
2. 以 tarball 安装的 CLI 分别选择 `zcode` 和 `all`，检查配置、插件 identity、资产布局与用户文件哈希。
3. 按真实 ZCode 的插件安装/启用方式指向 tarball 生成的 OpenLogos 插件，不直接引用仓库 `plugin` 源目录。
4. 启动**新 ZCode session**，确认插件、Skills、Commands、Agents 可发现，SessionStart 注入当前 lifecycle/guard 上下文。
5. 在活跃提案允许范围内发起一项写入并确认执行；再对源码或阶段外路径发起写入，确认 PreToolUse 返回 deny、原因和 exit 2，目标哈希不变。
6. 执行 sync 与 adopted launch，重开 session，证明 launched 资产刷新且重复执行幂等。
7. 对 Claude Code、OpenCode、Codex、Cursor 跑既有最小资产回归，证明 Registry 加法未破坏原宿主。

### 证据清单

- 构建/测试退出状态与 OpenLogos JSONL 结果摘要。
- tarball 路径、版本、大小、SHA-256 及完整文件清单。
- staging 安装命令、实际 CLI 路径、ZCode 版本和隔离目录说明。
- 插件发现、Skills/Commands/Agents、SessionStart 与 PreToolUse allow/deny 的脱敏原始输出。
- 用户资产前后哈希、两次 sync/launch 差异与既有四宿主回归结果。
- 回滚演练结果和恢复后版本/插件状态。

### 失败与回滚

- 任一 build、测试、pack、安装、插件发现、Hook hard guard 或回归检查失败即停止，不进入公开发布。
- 禁用/卸载本次 staging OpenLogos ZCode 插件，移除隔离 fixture 和本次 tarball 安装。
- 从预先记录的上一 tarball 恢复 CLI，恢复上一插件版本或禁用插件；重新启动 ZCode session。
- 校验恢复后的 CLI 版本、插件发现与既有项目用户资产哈希；保留失败日志和本次 tarball，不伪造部署成功标记。
- 回滚只作用于 staging 隔离目标，不删除用户工作区、全局 ZCode 配置或未知 owner 插件。

### 完成判据

只有 SMOKE-core-100～SMOKE-core-107 全部产生可追溯 PASS、制品和回滚证据齐全，且没有 npm/GitHub/官网/git push 外部副作用，才可将本提案 staging 部署判为完成。
