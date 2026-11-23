# 变更提案：fix-public-upgrade-0-16-22

> module: core | created: 2026-11-23

## 变更原因
公开发布 0.16.21 后，两位 Windows 用户报告 npm 执行升级后仍只能运行旧版。一台电脑的 npmmirror 将 `latest` 解析为 0.16.7，改用官方源安装 0.16.21 后恢复。另一台电脑已在 `AppData\Roaming\npm` 安装 0.16.21，CMD 优先命中 WindowsApps 的旧入口，临时提升正确目录的优先级后恢复。另有一台服务器报告相同症状，具体安装源和命令入口待核对。

已使用镜像同步接口为已公开的 0.16.21 提交同步。任务 `6b03ecf63270f90e7fc038fc` 成功，复查镜像 `latest` 为 0.16.21，tarball 返回 HTTP 200。

## 最小实现论证

> S35/S09：本段**不进 canonical 必填章节**——缺段、未填、占位残留三者均不触发任何检查。
> 它是自律提示，作用在设计发生**之前**；事后的规模信号由 change-lint 的观测 warning 承担。

- 先检索既有机制：沿用 0.16.21 的 npm、GitHub Release 与官网发布流程。复用 `scripts/lib/public-release-checks.mjs` 的 Windows npm 入口检查。现有 `test:windows` 回归集覆盖耐久性、沙箱、sync、guard 与文件改名，需要补充从已装旧版执行用户公告命令的用例。
- 为什么不能更小：给安装命令指定官方源与版本可以解决选源问题。Windows 全局安装和命令解析分属不同环节，还需核验 npm 的全局目录、实际执行入口与重新打开的 CMD。提供一份用户显式执行的 Windows 升级脚本即可实现这两项检查与当前用户修复。
- 本提案主动砍掉的：npm 生命周期自动修改 PATH、替换第三方启动脚本和新建更新服务均移出范围。系统级 PATH、当前目录里的同名程序及第三方托管入口继续由其所有者管理，升级脚本报告实际路径和处理结果。

## 变更类型
代码级（Windows 公开安装入口、升级指引和发布验收修复）。

## 变更范围
- 影响的需求文档：无。
- 影响的功能规格：无，Windows 升级脚本的下载、执行、修复权限与验证口径归入公开部署方案。
- 影响的业务场景：`core-S19-smoke-gate.md` 增加 Windows 原地升级与公开制品可用性验证时序。
- 影响的 API：无。
- 影响的 DB 表：无。
- 影响的编排测试：无。
- 影响的测试：`core-S19-test-cases.md` 增加来源选择、旧入口遮蔽、用户 Path 修复与不可修复分支的回归。 `core-smoke-test-cases.md` 增加对应的公开升级 smoke。
- 影响的部署方案：`core-01-deployment-plan.md` 补充 0.16.22 的生产发布、Windows 验证、镜像状态与回滚。
- 影响的代码和说明：Windows 升级脚本、其 Windows CI 入口、README 中英文、官网安装和升级指引、版本制品、CHANGELOG 和官网英文摘要。

## 部署影响
- 是否需要部署：是
- 部署原因：将修订的升级入口和安装指引发到官网，并公开发布 0.16.22 补丁制品，使公告中的升级版本、官网和 registry 同源。
- 影响环境：prod（npm registry、GitHub Release、Cloudflare Pages 官网）及本地 Windows 安装。
- 是否涉及数据迁移：否
- 是否需要回滚预案：是（保留 0.16.21 的 registry 制品与生产站点部署标识）
- 是否需要 smoke：是

## UI/UX 变更声明

```yaml
ui_impact: false            # 本次是否触及界面（GUI 项目才有意义）
design_system_mode: generated   # generated | fallback（fallback 时须填 design_system_fallback_reason）
design_system_fallback_reason: ""
pages: []                   # 每项 {id, prototype: core-NN-<slug>.html, description}
```

## 决策澄清

```yaml
schema: openlogos/clarification@1
mode: adaptive
status: ready
impacts:
  data:
    status: none
    reason: "既有项目和历史数据沿用现有格式。"
  compatibility:
    status: none
    reason: "继续使用现有 npm 包名和 openlogos CLI。Windows 安装与入口修复由用户运行升级脚本触发。"
  security_privacy:
    status: none
    reason: "脚本只处理当前用户的 npm 安装目录和用户 Path 中的目标条目。保留已有值的变量引用及其余条目。"
  public_release:
    status: decided
    reason: "用户要求快速发布修复版本，预定以未占用的 0.16.22 patch 按现有公开发布流程交付。"
  external_commitment:
    status: none
    reason: "镜像的传播时延取决于镜像服务，发布状态以实际可下载性为准。"
decisions:
  - id: C01
    category: public_release
    source: user
    question: "是否公开发布升级修复？"
    answer: "我们能赶紧发布一个版本,把这个问题彻底解决吗?"
    choice: "预定公开发布 0.16.22，发布前复核 npm 版本与 Git tag 的占用状态。"
    reason: "用户需要一个可验证的 Windows 升级方案及公开制品。"
  - id: C02
    category: compatibility
    source: agent
    choice: "Windows 升级入口由用户显式运行，按实际 npm prefix 安装并验证。当前用户 Path 内可解决时，将目标目录提到前面；无法由用户 Path 解决时，报告优先命中的入口，并给出目标 npm shim 的确切路径。"
    reason: "已观察到全局 npm 安装与 CMD 命令解析分离，需要区分安装成功和切换成功。"
unresolved: []
defaults:
  - "官网升级命令使用 npm 官方源和公告中的目标版本，外部镜像在目标版本及 tarball 可读取后再标为就绪。"
  - "官方 npm 发布后，如 npmmirror 版本滞后，使用其现有包同步入口请求同步并复核结果。"
```

## 变更概述
官网下载的 Windows 升级脚本使用当前 npm 的全局目录，从官方 registry 安装指定版本。先运行该目录的真实 npm shim 核对版本，再检查用户重新打开 CMD 后的裸命令。用户运行入口即授权调整当前用户 Path 中目标目录的顺序，验证未通过时给出实际命中的入口、目标入口和可执行的下一步。

在公开发布前用实际 Windows 运行候选包原地升级用例。正式发布后分别核实官方源和镜像的版本及 tarball 下载状态。新公告与官网指引使用已验证的官方源安装命令。

## 验收条件

- **镜像滞后**：默认镜像只提供旧版时，按公告指定官方源和版本，真实 npm shim 返回目标版本。若目标版本尚不可下载，执行结果给出失败原因。
- **同一目录升级**：在真实 Windows 上从 registry 安装旧版，在同一 npm prefix 安装候选包，重新读取用户环境后启动 CMD，执行 `openlogos --version` 得到候选版本。
- **多入口共存**：在真实 Windows 上让另一份旧入口先于候选目录，运行升级脚本。用户 Path 决定顺序的环境中，按持久化设置重新打开的 CMD 调用得到目标版本。记录修改前后解析路径以及当前用户 Path 中其他条目的保留情况。系统级入口优先等用户 Path 无法修复的场景，明确报告旧路径，并核实显式目标入口可执行。
- **公开同源**：官方源目标版本与 tarball 可读取，GitHub Release 附件、官网和版本说明均指向本次提交。镜像的 `latest` 与 tarball 另外记录，公告给出已验证的下载入口。
