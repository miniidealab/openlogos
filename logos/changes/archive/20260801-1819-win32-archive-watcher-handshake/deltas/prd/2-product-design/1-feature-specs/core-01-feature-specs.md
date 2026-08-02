## MODIFIED — S09

### S09
change/merge/archive 必须构成闭环；提案填写阶段必须同步形成部署影响判断。`proposal.md` 声明无需部署时，`tasks.md` 不得出现 `[deploy]` section；声明需要部署时，必须有 `[deploy]` section，并在 delta 阶段补齐部署方案与 smoke 影响。AI 生成 proposal/tasks 后必须先做一致性自检，自检失败不得进入 delta-writing。

**Windows 外部归档 watcher 握手（win32-archive-watcher-handshake）**：在 Windows 上，`openlogos archive` 在 rename 前必须与所有「未过期、projectId 匹配、capabilities 含 prepare」的活跃 RunLogos 实例完成有界文件协议握手，等其释放监听句柄后再 rename（详见 §2.31）。握手只负责释放句柄，不改变归档资格、授权、verify、smoke、guard 删除时机、归档目录命名等既有规则。快照为空（未装/未运行/未监听）时走既有 rename 快路径、不引入等待；ACK 超时、实例 failed、遇不可协调监听者（旧版持句柄致 EPERM、capabilities 不足、未知高版本）均 fail-closed：不 rename、不动 guard、不自动重试。**非 Windows 平台完全不启用本协议。**

## ADDED — 2.31 Windows 外部归档 watcher 握手协议

### 2.31 Windows 外部归档 watcher 握手协议

**目标与门控**：Windows 不允许在目录 watcher 持句柄时 rename 目录，导致外部 `openlogos archive` 遇活跃监听时 EPERM。本协议让 CLI 在 rename 前与监听方完成有界握手以释放句柄。**仅在 `process.platform === 'win32'` 启用**；macOS/Linux 不创建/读取/监听任何协议文件、不增加等待，直接走既有 archive 路径。

**发现判据（存在即协商，无版本探测）**：CLI 读取 `logos/.runtime/archive-watch/v1/` 下实例租约，只把「未过期 + projectId 匹配 + capabilities 含 prepare」的租约纳入 ACK 快照。会写租约的新版 RunLogos 才可见；未装/未运行/旧版（不写租约）一律不出现，天然退化为 rename 快路径。

**协议对象**（`openlogos.archive-watch/v1`；JSON 用 UTF-8、同目录临时文件写入后原子 rename；未知字段忽略、未知主版本拒绝）：
- **实例租约** `instances/<instanceId>.json`：`protocol`/`instanceId`/`pid`/`projectId`(realpath 不可逆哈希)/`startedAt`/`heartbeatAt`/`expiresAt`/`capabilities`。RunLogos 周期续租，退出/切项目时删租约。PID 仅辅助诊断，不替代租约与 projectId 校验。
- **准备请求** `requests/<requestId>/prepare.json`：`requestId`/`projectId`/`slug`/`cliPid`/`createdAt`/`deadlineAt`/`expectedInstances`(稳定屏障)/`mode`。CLI 写请求前须完成项目根 realpath、slug 语法、live change 路径与 guard 校验。
- **实例 ACK** `requests/<requestId>/acks/<instanceId>.json`：`status` 至少 `released|failed|ignored`，只有 released 满足屏障；failed 必带稳定 reason。ACK 不得含用户文件内容/绝对路径/命令输出全文。
- **CLI 结果** `requests/<requestId>/result.json`：`status` 至少 `archived|not-archived|inconsistent|cancelled`，附 `archivePathHint`(仅相对名)/`exitCode`。RunLogos 收到后须以磁盘真相(live/archive/guard)决定恢复或换表。

**archive 状态机（Windows 分支）**：
1. 既有归档资格与授权校验；失败不创建 prepare。
2. 解析 runtime 目录，清理过期请求与租约。
3. 快照匹配项目且未过期的活跃实例。
4. **快照为空 → 走既有 rename 快路径，不引入等待**（runtime 缺失即空快照、非错误）。
5. 快照非空 → 原子写 prepare，轮询 ACK 直到全 released / 任一 failed / deadline。
6. 失败或超时 → fail-closed：不 rename、不更新 guard；写 cancelled/not-archived result，返回稳定错误码。
7. 全 released → 执行既有 archive 事务；无论成败在 finally 尽力写 result。
8. 以 live/archive/guard 三态裁决；「命令报错但磁盘已归档」调和为成功并标记 `reconciledFromDisk`。
9. result 保留短 TTL 供迟到消费者读取，再幂等清理；清理失败不反转归档结果。

**去递归（无全局逃生开关）**：RunLogos spawn CLI 时注入仅对子进程可见的一次性 `OPENLOGOS_ARCHIVE_WATCH_PREPARED=<token>` 声明「宿主已协调」。CLI 仅在 token 结构有效、cwd/projectId 与绑定项目一致、slug 一致、未过期时跳过外部握手；不提供长期全局开关。

**稳定错误码（不新增 stdout JSON envelope）**：archive 保持纯文本输出；握手失败以稳定错误码 + 非零退出码返回，机器可读细节写进 result.json：`ARCHIVE_WATCH_PREPARE_FAILED`/`ARCHIVE_WATCH_ACK_TIMEOUT`/`ARCHIVE_WATCH_INSTANCE_FAILED`/`ARCHIVE_WATCH_STATE_INCONSISTENT`（登记于 `spec/cli-json-output.md` §6.1）。

**runtime 目录**：`logos/.runtime/archive-watch/v1/`。根 `.gitignore` 已忽略 `/logos/`，天然不入库。协议路径须由 CLI 提供确定性解析函数并附兼容测试向量，供 RunLogos 复用同一算法。

**并发/崩溃/安全**：同一 projectId+slug 仅一个请求在途（重复共享结果或返回 archive-in-flight）；RunLogos 以 requestId+instanceId 幂等、同一 token 只恢复一次；CLI 崩溃致 result 缺失时 RunLogos 在 deadline/租约过期后重读磁盘三态；RunLogos 崩溃或 ACK 丢失时 CLI 等到 deadline 后拒绝 rename；协议目录拒绝 symlink 越界，slug/requestId/instanceId 严格白名单；日志只记项目哈希/slug/requestId/实例数/耗时/状态/稳定 reason。

**实现边界**：本仓只实现 CLI 消费端；RunLogos 协议端（pause watcher、写 ACK、读 result 恢复）不在本仓。CLI 先行、RunLogos 未配套期间快照恒空 → 走快路径、无回归。
