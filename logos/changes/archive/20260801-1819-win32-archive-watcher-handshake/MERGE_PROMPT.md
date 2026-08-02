# 合并指令

## 变更提案
- 提案名称：win32-archive-watcher-handshake
- 提案目录：logos/changes/win32-archive-watcher-handshake/

## 提案内容

# 变更提案：openlogos archive 外部归档 watcher 握手（仅 Windows）

> module: core | created: 2026-08-01

## 变更原因

来源于方案文档 `logos/resources/reference/openlogos-cli-external-archive-watcher-handshake-plan.md`。

Windows 不允许在目录 watcher 仍持有句柄时重命名目录。`openlogos archive` 的核心动作是 `renameSync(changePath, archivePath)`（`cli/src/commands/archive.ts:49`），当用户从 PowerShell / CMD / IDE 终端等**外部进程**直接运行 `openlogos archive <slug>` 时，若有 RunLogos 实例正监听该项目目录，rename 会抛 `EPERM`，归档失败。RunLogos 内部归档入口已能在进程内先 pause watcher，但外部 CLI 调用无法触达该进程内协调器。

本提案为 CLI 增加**仅 Windows 启用**的外部归档 watcher 握手：archive rename 前，与所有正在监听目标项目的 RunLogos 实例完成有界文件协议握手，等其释放监听句柄后再 rename。协议只负责释放句柄，**不改变**归档资格、授权、verify、smoke、提交或 push 规则。

## 变更类型

设计级变更（新增 Windows 归档握手协议与 archive 状态机，传播到 S09 场景 + 测试 + 代码 + 文档），附带接口级成分：新增稳定错误码 `ARCHIVE_WATCH_*`、新增项目本地 runtime 协议目录约定 `logos/.runtime/archive-watch/v1/`、新增去递归环境变量 `OPENLOGOS_ARCHIVE_WATCH_PREPARED`。不涉及 API / DB / 原型 / 配置 schema。

## 变更范围

- 影响的需求文档：`prd/1-product-requirements/core-01-requirements.md` — S09（`:225`「创建、合并、归档变更提案」）新增「异常：Windows 外部归档遇活跃监听（有界握手）」验收条件；archive 主路径（`:229`）补一句 Windows 前置握手说明
- 影响的功能规格：`prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — §S09（`:1015`）验收摘要补 Windows 握手不变量；新增小节「Windows 外部归档 watcher 握手协议」（协议对象、状态机、去递归、并发/崩溃/安全边界）
- 影响的业务场景：S09（`core-S09-change-lifecycle.md` `:21` Step 13 archive）— archive 步骤补 Windows 握手状态机；新增异常用例（快照空快路径、ACK 超时 fail-closed、实例 failed、可信 token 去递归、三态调和）
- 影响的部署方案：无
- 影响的 API：无
- 影响的 DB 表：无
- 影响的编排测试：无（`logos/resources/scenario/` 为空）
- 影响的 smoke 测试：无
- 影响的测试用例规格：`test/core-S09-test-cases.md` — 顺延既有最大编号（UT-S09-124 / ST-S09-43 / ST-S09-EX-9.5），新增 UT-S09-125 起、ST-S09-44 起、ST-S09-EX-10.x 起
- 代码阶段随源更新（不产 delta、直接改源）：`cli/src/commands/archive.ts`（win32 门控 + 握手编排）、新增 `cli/src/lib/archive-watch.ts`（协议路径解析 / 实例租约快照 / prepare / ACK 轮询 / result / 去递归 token 校验 / 过期清理）、`cli/src/i18n.ts`（`archive.watch.*` 文案 key）、`cli/test/s09-change.test.ts`（含 OpenLogos reporter）；根 `spec/cli-json-output.md`（§6.1 错误码表 `:1245` 新增 `ARCHIVE_WATCH_*`）与 `spec/workflow.md`（archive 段 `:508` 附近补 Windows 握手说明）及其 `logos/spec/` dogfood 副本

## 部署影响

- 是否需要部署：否
- 部署原因：纯 CLI 本地行为改动。按既有做法本提案**不升级版本、不发布、不部署**，随后续 release 提案统一发版
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

```yaml
ui_impact: false            # 纯 CLI 项目，非 GUI，整节不启用
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
```

## 变更概述

**① 仅 Windows 门控（非 Windows 零改动）**：archive 握手在最外层以 `process.platform === 'win32'` 门控（参照 `cli/src/lib/flow-cmd.ts:33` 既有 win32 分支先例）。macOS / Linux **不创建、不读取、不监听**任何协议文件，不引入任何等待，直接沿用现有 archive rename 快路径——非 Windows 行为逐字节不变。

**② 本仓只实现 CLI 消费端**：按方案第 9 节非目标，RunLogos 协议端（pause watcher、写 ACK、读 result 后恢复/换表）不在本仓。本仓实现 CLI 侧：读实例租约快照、写 `prepare`、轮询 ACK、执行既有 rename、写 `result`、三态调和、去递归 token 校验、过期协议文件清理。**协议路径解析必须由本仓提供确定性函数并附兼容测试向量**，供 RunLogos 复用同一算法。

**③ archive 状态机（Windows 分支）**：先执行既有归档资格/授权校验（校验失败不创建 prepare）→ 解析 `logos/.runtime/archive-watch/v1/` 并清理过期请求/租约 → 快照匹配项目且未过期的活跃实例 → **快照为空走现有 rename 快路径、不引入固定等待** → 快照非空则原子写 prepare 并轮询 ACK，直到全部 `released` / 任一 `failed` / deadline 到达 → 任一失败或超时一律 **fail-closed（不 rename、不动 guard）** → 全部释放后执行既有 rename 事务 → 无论成败在 `finally` 尽力写 result → 以 live/archive/guard 三态裁决最终结果，「命令报错但磁盘已归档」调和为成功。

**④ 去递归 token（无全局逃生开关）**：RunLogos 内部入口调用新版 CLI 时，通过仅对子进程可见的一次性环境变量 `OPENLOGOS_ARCHIVE_WATCH_PREPARED=<request/token>` 声明「宿主已协调」，CLI 仅在 token 结构有效、cwd/projectId 与 token 绑定项目一致、slug 一致、未过期时跳过外部握手。**不提供** `--no-watch-handshake` 之类长期全局开关。

**⑤ 稳定错误码，不新增 stdout JSON envelope**：archive 命令目前是纯文本输出、不支持 `--format json`（`cli/src/index.ts:211` 不传 format，`:97` supported 列表不含 archive）。为把冲击降到最小，本提案**不**给 archive 新增 stdout JSON envelope，握手失败以稳定错误码字符串 + 非零退出码返回：`ARCHIVE_WATCH_PREPARE_FAILED` / `ARCHIVE_WATCH_ACK_TIMEOUT` / `ARCHIVE_WATCH_INSTANCE_FAILED` / `ARCHIVE_WATCH_STATE_INCONSISTENT`；机器可读的握手细节写进 runtime 目录的 `result.json` **协议文件**（非 stdout）。这些错误码登记进 `spec/cli-json-output.md` §6.1 错误码表以保持契约可追溯。

**⑥ runtime 目录约定（新增、天然不入库）**：协议运行时文件落在 `logos/.runtime/archive-watch/v1/`。根 `.gitignore:51-52` 已整体忽略 `/logos/`，该目录天然不进 Git（无需改 gitignore），但需在功能规格中显式声明其用途与生命周期。所有 JSON 采用同目录临时文件 + 原子 rename；未知字段忽略、未知主版本拒绝；slug / requestId / instanceId 严格白名单；协议目录拒绝 symlink 越界。

**新增副作用/退出路径（显式枚举）**：本提案在 Windows 下为 archive 新增两类既有实现没有的行为——(a) 写入 `logos/.runtime/archive-watch/v1/` 协议文件（新副作用，均在 gitignore 的 `logos/` 下）；(b) 握手超时/实例失败的 fail-closed 非零退出（`ARCHIVE_WATCH_*`，扩展了 archive 现有的「config 缺失 / slug 缺失 / 目标不存在 / archive 已存在」失败集合）。archive 的人类授权语义、流程 Gate、guard 删除时机、归档目录命名与非 Windows 路径均不变。

**兼容与无回归**：CLI 先行、RunLogos 未配套发布期间，Windows 上实例快照恒为空 → 直接走 rename 快路径，行为与当前一致、无新回归（方案第 7 节场景 2）。迁移期遇旧版 RunLogos 持句柄导致的 `EPERM`，CLI 捕获后给出「可能有旧版 RunLogos 正在监听，请升级或关闭应用」的明确诊断，但**不自动重试移动**（方案第 7 节场景 4、第 9 节非目标）。

**证伪面说明**：代码改动落在 `cli/src/commands/archive.ts`——Windows 分支在既有 archive rename 外层包裹握手，非 Windows 路径逐字节不变，故以下节所列已合并的 S09 提案生命周期与归档信号链路回归锚点作为核心证伪面。

## 复用测试 ID
- ST-S09-01 — S09 提案生命周期回归锚点，创建提案工作区行为在 archive.ts 握手改造后保持不变
- ST-S11-08 — 归档前置门禁锚点，verify PASS 后才显示可归档，Windows 握手不改变归档资格判定
- UT-S24-AE-01 — 全自动归档信号锚点，verify-passed + --auto 仍产出 auto_execute 与 command=archive，握手不破坏自动归档链路
- ST-S24-AE-01 — 全自动端到端归档锚点，driver 据 auto_execute 自动归档的信号契约在握手改造后不变


## 需要合并的 Delta 文件

### 1. deltas/prd/1-product-requirements/core-01-requirements.md

- Delta 文件：`logos/changes/win32-archive-watcher-handshake/deltas/prd/1-product-requirements/core-01-requirements.md`
- 目标目录：`logos/resources/prd/1-product-requirements/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 2. deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md

- Delta 文件：`logos/changes/win32-archive-watcher-handshake/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`
- 目标目录：`logos/resources/prd/2-product-design/1-feature-specs/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 3. deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md

- Delta 文件：`logos/changes/win32-archive-watcher-handshake/deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`
- 目标目录：`logos/resources/prd/3-technical-plan/2-scenario-implementation/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

### 4. deltas/test/core-S09-test-cases.md

- Delta 文件：`logos/changes/win32-archive-watcher-handshake/deltas/test/core-S09-test-cases.md`
- 目标目录：`logos/resources/test/`
- 操作：读取 delta 中的 ADDED / MODIFIED / REMOVED 标记，合并到目标目录中对应的主文档

## 执行要求

1. 逐个 Delta 文件处理，每处理完一个报告修改摘要
2. 对于 ADDED 标记：在主文档的指定位置插入新内容
3. 对于 MODIFIED 标记：替换主文档中同名章节的内容
4. 对于 REMOVED 标记：从主文档中删除对应章节
5. 保持主文档的原有格式和风格
6. 如果主文档有"最后更新"时间戳，同步更新
7. 所有变更完成后，列出修改清单
8. 所有变更合并完成后，自动执行 git commit（告知用户，无需确认）：
   git add -A && git commit -m "docs(win32-archive-watcher-handshake): merge spec deltas"
   然后提示用户：按更新后的规格实现代码，代码完成后运行 `openlogos verify` 验收，验收通过后明确授权执行 `openlogos archive win32-archive-watcher-handshake`。
