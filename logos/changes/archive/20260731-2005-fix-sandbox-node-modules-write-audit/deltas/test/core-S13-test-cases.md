## ADDED — 十三、verify 沙箱依赖目录豁免测试（fix-sandbox-node-modules-write-audit）

## 十三、verify 沙箱依赖目录豁免测试（fix-sandbox-node-modules-write-audit）

> 覆盖沙箱写入审计的依赖目录豁免（S13 EX-3.3 / 功能规格 §2.9）、symlink 隔离与运行期写保护不变量（EX-3.4，含启动前拓扑与运行期动态逃逸、能力分层）与白名单定点采集回收：豁免匹配规则为「规范化并统一分隔符后存在完整路径段严格等于 `node_modules`」，禁止子串/前缀/后缀匹配；豁免说明走 `sandbox.infos` 信息级通道；白名单回收优先于豁免；`node_modules` 之外的审计语义一字不改。本节用例编号顺延既有最大编号（UT-S13-46 / ST-S13-13）。用例实现必须写入 OpenLogos reporter，测试名包含对应 ID 供 verify 抽取。

### 13.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-47 | always 模式下仅写 node_modules 不判非白名单，豁免说明走 infos 通道 | EX-3.3 / §2.9 依赖目录豁免 | `verify.sandbox_mode=always`、`sandbox_deny_workspace_write=true`；项目含 `node_modules` 目录；预跑命令仅写入 `node_modules/.bin/*`（新增/改写文件）并正常写结果文件 | `runSandboxedCommand` 或 `openlogos verify --format json` | 命令 `status="pass"`，`sandbox.status="pass"`（不 FAIL、不 warn）；`sandbox.infos` 含一条信息级豁免说明；`sandbox.diagnostics` 与 `pre_run.diagnostics` 均**不含**该说明且无「检测到非白名单写入」；文本输出该说明以 `ℹ️` 渲染且全程仅出现一次，不以 `⚠️` 渲染 |
| UT-S13-48 | 精确段匹配边界：近似名称与豁免外路径语义不变（回归 + 负例） | EX-3.2 回归 / §2.9 匹配规则 | 同上配置；预跑命令写入 `node_modules/.bin/x` 及以下四类路径：`src/evil.txt`、`src/node_modules-cache/evil.txt`、`vendor/my-node_modules/data`、`node_modules.txt` | `runSandboxedCommand`（分别以 `always` / `auto` 执行）；路径含 Windows 分隔符形态（如 `src\\node_modules-cache\\evil.txt`）时先归一再判定 | `always`：命令 FAIL，非白名单列表**恰好**包含四条近似/无关路径且**不含**任何完整段等于 `node_modules` 的路径；`auto`：`sandbox.status="warn"` 并建议改用 `always`；分隔符归一化后判定结果一致；白名单构成不变 |
| UT-S13-49 | monorepo 嵌套 node_modules 同样豁免（完整段等于，非根前缀） | EX-3.3 嵌套形态 | 同 UT-S13-47 配置；预跑命令仅写入 `packages/a/node_modules/.bin/*` | `runSandboxedCommand`（`always` 模式） | 不判非白名单、不 FAIL；豁免按「存在完整路径段严格等于 `node_modules`」匹配而非仅根目录前缀，也非子串匹配 |
| UT-S13-50 | 内部相对 symlink 保持相对语义，穿透写入不落原 workspace | EX-3.4 / §2.9 symlink 隔离不变量 | monorepo 布局：`node_modules/pkg -> ../packages/pkg`（相对链接）；`verify.sandbox_mode=always`；预跑命令经 `node_modules/pkg/**` 写入文件 | `runSandboxedCommand` 后比对原 workspace | 沙箱副本内该链接目标仍为相对字面量且解析落在沙箱 workspace 内；写入发生在沙箱副本；**原 workspace `packages/pkg` 目录字节不变**（不得出现 cpSync 默认改写为指向原 workspace 绝对路径后穿透写入） |
| UT-S13-51 | 逃逸 symlink 按无法隔离处理，不得静默豁免 | EX-3.4 | 项目内存在解析目标位于 workspace 之外的 symlink（绝对目标外链，或复制后无法收敛进沙箱的链接），且该链接位于 `node_modules` 下 | 分别以 `always` / `auto` 执行 `runSandboxedCommand` | `always`：沙箱建立失败路径生效，命令 FAIL 并输出逃逸链接路径与修复建议；`auto`：降级为非隔离执行且 `sandbox.status="warn"`；两种模式下均不得把逃逸链接按依赖目录豁免静默放过 |
| UT-S13-52 | 白名单结果文件位于 node_modules 下仍被定点采集回收 | §2.9 白名单回收优先 | `verify.result_path="node_modules/.cache/openlogos/test-results.jsonl"`（合法配置）；`sandbox_mode=always`；预跑命令在沙箱内写出该结果文件 | `runSandboxedCommand` / `openlogos verify --format json` | 结果文件被定点采集回收到原 workspace 对应路径，verify 正常读取结果（不报无结果/覆盖不足）；回收不依赖快照 diff；该路径回收不触发非白名单判定 |
| UT-S13-53 | 运行期新建绝对逃逸 symlink 后写入被写保护阻断 | EX-3.4 运行期 / §2.9 运行期不可逃逸 | 运行期写保护机制可用；原 workspace 含哨兵文件；预跑命令在通过启动前校验后于沙箱 `node_modules/` 下新建指向原 workspace 的绝对 symlink，再经该链接写文件 | 分别以 `always` / `auto` 执行 `runSandboxedCommand` 后比对原 workspace | 写入尝试在文件系统层被拒绝（写入发生前阻断，非事后检测）；**原 workspace 字节零改动**（哨兵文件与目录内容不变）；`always` 下命令失败；任一模式均不得以依赖目录豁免静默通过 |
| UT-S13-54 | 运行期 retarget 内部链接指向原 workspace 后写入被写保护阻断 | EX-3.4 运行期 | 同 UT-S13-53 前置；沙箱内存在已通过启动前校验的内部相对链接；预跑命令运行期将其 retarget 到原 workspace 后经该链接写文件 | 分别以 `always` / `auto` 执行 `runSandboxedCommand` 后比对原 workspace | 同 UT-S13-53：写入发生前被阻断，原 workspace 字节零改动，不得以豁免静默通过 |
| UT-S13-55 | 运行期写保护不可用时按能力分层处理 | §2.9 能力分层 | 模拟运行期写保护机制不可用（如强制关闭 OS 隔离能力探测） | 分别以 `always` / `auto` 执行 `runSandboxedCommand` | `always`：命令失败，输出「无法启用运行期写保护」原因与修复建议；`auto`：继续沙箱复制执行但 `sandbox.status="warn"`，告警披露运行期动态 symlink 逃逸残留风险；两种模式均不得静默视为已隔离 |

### 13.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-14 | 模拟 pnpm 依赖修复式写入的项目在 always 沙箱下 verify PASS | Step 1→9 | 活跃提案 ready-to-verify；`verify.sandbox_mode=always`、`sandbox_deny_workspace_write=true`；预跑命令模拟 pnpm 依赖准备（改写 `node_modules/.bin/*` 后运行测试并写 `test-results.jsonl`），全部定义用例 pass | `openlogos verify --format json` | verify Gate PASS，生成 `acceptance-report.md`；`sandbox.isolated=true`、`sandbox.status="pass"`；`sandbox.infos` 含信息级豁免说明，`sandbox.diagnostics` / `pre_run.diagnostics` 无「检测到非白名单写入」告警且不含该说明；结果文件正常回收，`node_modules` 变更不回收到原 workspace |

### 13.3 覆盖度校验补充

- [ ] always 模式 node_modules 写入豁免 + infos 信息级通道（不入 diagnostics / pre_run.diagnostics、ℹ️ 单次渲染）：UT-S13-47
- [ ] 精确段匹配负例（node_modules-cache / my-node_modules / node_modules.txt）+ 豁免外语义不变（always FAIL / auto warn）+ 分隔符归一：UT-S13-48
- [ ] monorepo 嵌套 node_modules 豁免：UT-S13-49
- [ ] 内部相对 symlink 保持相对语义、原 workspace 字节不变：UT-S13-50
- [ ] 启动前逃逸 symlink 按无法隔离处理（always FAIL / auto 降级告警）：UT-S13-51
- [ ] 运行期新建绝对逃逸链接写入被写保护阻断、原 workspace 零改动：UT-S13-53
- [ ] 运行期 retarget 内部链接写入被写保护阻断：UT-S13-54
- [ ] 运行期写保护不可用时能力分层（always FAIL / auto warn 披露残留风险）：UT-S13-55
- [ ] 白名单结果文件位于 node_modules 下定点采集回收：UT-S13-52
- [ ] pnpm 依赖修复式写入端到端 verify PASS：ST-S13-14
