## ADDED — Qoder Adapter staging 真实 tarball 部署方案

### 部署目标与授权边界

- 目标仅为隔离 staging：安装本提案构建的真实 npm tarball，并由真实 Qoder CLI 验证插件与 Hook。
- 禁止 npm publish、Git tag、GitHub Release、官网/Cloudflare 部署和 `git push`。
- 部署必须在 verify PASS 后获得独立人类授权；本节不构成当前执行授权。

### 前置条件

1. 所有实现切片、UT/ST 与 OpenLogos reporter 完成，最终 verify 为 PASS。
2. staging 具备受支持的 Node.js/npm 与真实 Qoder CLI；记录 CLI 绝对路径、版本和可启动新 session 的证明。
3. 保存当前 staging OpenLogos CLI/插件状态、上一可用 tarball 与 SHA-256，确保可离线回滚。
4. 使用一次性 init/adopt fixture 和隔离 Qoder 用户/插件数据目录，不读取生产凭据或生产工作区。
5. 真实 Qoder CLI 缺失、版本不可识别或插件功能不可用时停止；不得用 mock/合同测试替代。

### 制品构建与证明

未来获部署授权后执行仓库真实 build/test/pack 流程：

1. 依据锁文件安装依赖并运行 CLI build、全部自动化测试与 reporter 完整性检查。
2. 在 `cli/` 生成真实 `.tgz`；禁止 workspace link、源码直跑或已发布包替代。
3. 记录 package、version、tarball 字节数和 SHA-256。
4. 列出 tarball，证明包含编译 CLI、`.qoder-plugin/plugin.json`、Skills、Commands、Agents、`hooks/hooks.json`、runtime 与必要规范。
5. 从隔离目录安装 tarball，记录 `openlogos --version` 和实际可执行文件路径，排除全局旧版本。

### staging 安装与真实 Qoder CLI 验证

1. 创建空项目和包含既有 AGENTS、Qoder settings、用户插件/未知文件的存量项目。
2. 分别执行 qoder 与 all 的 init/adopt，核对配置、plugin identity、资产清单与用户文件前后哈希。
3. 按 Qoder CLI 官方插件安装/启用流程加载安装产物；不得引用仓库模板源码。
4. 启动新 Qoder CLI session，验证唯一插件 identity、Skills、Commands、Agents 与 SessionStart 上下文。
5. delta-writing 下用真实 Qoder 发起允许写入；再请求源码、提案外和 symlink 逃逸写入，验证 permissionDecision、reason、exit 2 与目标哈希。
6. 连续 sync、两次 adopted launch，每次刷新后重开 session；第二次托管资产应 unchanged，用户资产不变。
7. 对 Claude Code、OpenCode、Codex、Cursor、ZCode 运行既有最小回归。

### 证据清单

- build/test 退出状态、UT/ST JSONL 摘要。
- tarball 路径、版本、大小、SHA-256 与完整文件清单。
- staging 安装命令、实际 OpenLogos/Qoder CLI 路径、Qoder 版本、隔离目录说明。
- 插件发现、Skills/Commands/Agents、SessionStart、PreToolUse allow/deny 的脱敏原始 stdout/stderr/exit code。
- 用户资产前后哈希、两次 sync/launch 差异、五个既有宿主回归和回滚结果。

### 失败与回滚

- 任一 build、test、pack、安装、真实插件发现、hard guard 或回归失败即停止，不产生部署成功结论。
- 禁用/卸载本次隔离 Qoder 插件与 tarball CLI，恢复上一 tarball/插件状态并启动新 session。
- 校验恢复后的 CLI 版本、插件状态和用户资产哈希；保留脱敏失败日志与失败制品。
- 回滚只作用于 staging 隔离目标，不删除真实用户工作区、全局 Qoder settings 或未知 owner 插件。

### 完成判据

只有 SMOKE-core-108～SMOKE-core-115 全部产生可追溯 PASS、制品与回滚证据齐全，且无公开发布、部署或 push 外部副作用，才能判定本提案 staging 部署完成。
