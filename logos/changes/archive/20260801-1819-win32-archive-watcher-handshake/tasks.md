# 实现任务

## [delta] 规格变更
- [x] 产出 delta 文件到 `deltas/prd/1-product-requirements/core-01-requirements.md` — ADDED S09 验收条件 6 条（快照空快路径 / 活跃实例握手后归档 / 握手超时或实例失败 fail-closed / 不可协调监听者旧版EPERM+能力不足+未知版本 / 宿主已协调去递归 token / 非 Windows 不启用）
- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — MODIFIED §S09 验收摘要补 Windows 握手不变量；ADDED §2.31「Windows 外部归档 watcher 握手协议」（仅 win32 门控、存在即协商发现判据、协议对象租约/prepare/ACK/result、archive 状态机、去递归 token 无全局开关、稳定错误码不上 stdout envelope、runtime 目录约定、并发/崩溃/安全边界、CLI 只实现消费端）
- [x] 产出 delta 文件到 `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md` — ADDED Windows 握手时序图 + 异常用例 EX-10.1~10.7（快照空快路径 / 握手成功才 rename / 超时或 failed fail-closed / 不可协调监听者 / 去递归 token / CLI 崩溃三态调和 / 非 Windows 不启用）
- [x] 产出 delta 文件到 `deltas/test/core-S09-test-cases.md` — ADDED 第十节 UT-S09-125~134 / ST-S09-44~47 / ST-S09-EX-10.1~10.4（协议路径解析兼容向量、租约快照判据、runtime 缺失=空快照、prepare 原子写、ACK 轮询屏障、去递归 token 严格校验、稳定错误码、过期清理幂等、三态调和 reconciledFromDisk、旧版 EPERM 诊断、不可协调监听者 fail-closed、single-flight、非 Windows 不启用）

## [code] 代码实现

> 六维评分：10/12（影响范围 1、行为复杂度 2、契约变化 2、测试规模 2、风险等级 2、不确定性 1），属于大任务。
>
> 删后续自检：协议路径/租约快照、prepare/ACK 屏障、去递归 token、single-flight、三态调和与 archive rename 共同构成同一有界状态机；拆成“协议底座 / 命令接入 / 测试”会横切，按场景拆分又会让前片无法独立满足已合并测试全集与全量 verify。故按逃生口保留单一自闭环切片；不存在后续片与前向依赖，完成后端到端可观察为“Windows 分支先协调 watcher，再决定 rename/result”，非 Windows 路径保持原行为。
>
> 平台验证边界：本轮在 macOS 以 `fs/platform/env/clock` 注入运行全部协议 UT/ST，不伪装执行 Windows 分支；真实 Windows 端到端验证须在打包后移交 Windows 机器执行，属于后续发布验收，不作为本地测试通过声明。

- [x] 单切片：实现仅 Windows 启用的 archive watcher 有界握手完整闭环（确定性协议路径、symlink/标识符边界、租约快照与不可协调实例判定、原子 prepare/ACK/result、超时/failed fail-closed、去递归 token、过期清理、single-flight、三态调和、旧版 EPERM 诊断、archive.ts 接入、i18n 与 CLI/workflow 契约同步），同片交付注入式测试与 OpenLogos reporter；macOS 运行注入式全量测试，Windows 真机 E2E 留待打包验收（覆盖 UT-S09-125、UT-S09-126、UT-S09-127、UT-S09-128、UT-S09-129、UT-S09-130、UT-S09-131、UT-S09-132、UT-S09-133、UT-S09-134、ST-S09-44、ST-S09-45、ST-S09-46、ST-S09-47、ST-S09-EX-10.1、ST-S09-EX-10.2、ST-S09-EX-10.3、ST-S09-EX-10.4、ST-S09-01、ST-S11-08、UT-S24-AE-01、ST-S24-AE-01）
