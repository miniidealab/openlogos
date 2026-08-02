## ADDED — 十、Windows 外部归档 watcher 握手测试用例（win32-archive-watcher-handshake）

## 十、Windows 外部归档 watcher 握手测试用例（win32-archive-watcher-handshake）

> 覆盖仅 Windows 的 archive watcher 握手（功能规格 §2.31 / S09 EX-10.1~10.7）。协议逻辑（路径解析、租约快照、prepare/ACK 轮询、去递归 token、稳定错误码、三态调和）以纯函数 + 注入式 fs/platform/env 单测，不依赖真实 Windows；平台分支用 `process.platform` 注入或 skipIf 门控。用例实现含 OpenLogos reporter，测试名含对应 ID。编号顺延既有最大（UT-S09-124 / ST-S09-43 / ST-S09-EX-9.5）。

### 10.1 单元测试用例补充

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S09-125 | 协议路径解析确定性 + 兼容向量 | §2.31 | 给定项目根 | 解析 instances/requests/acks/result 路径 | 与固定兼容向量逐一相等；`..`/symlink 越界被拒 |
| UT-S09-126 | 租约快照只纳入未过期+projectId 匹配+capabilities 含 prepare | §2.31 | instances/ 混合租约各一 | 快照函数 | 仅合格入快照；PID 存活不替代租约判定 |
| UT-S09-127 | runtime 目录缺失=空快照非错误 | EX-10.1 | `logos/.runtime/` 不存在 | 快照函数 | 返回空快照不抛错；调用方走快路径 |
| UT-S09-128 | prepare 原子写含 expectedInstances | §2.31 | 快照 2 实例 | 写 prepare | 临时文件+原子 rename 落盘，expectedInstances=快照集合，含 deadlineAt |
| UT-S09-129 | ACK 轮询屏障：全 released 才放行 | EX-10.2 | expectedInstances=2，acks 渐现 | 轮询函数 | 未齐放行=false；全 released 才 true；任一 failed 立返 failed+稳定 reason |
| UT-S09-130 | 去递归 token 严格校验 | EX-10.5 | 注入 env token | 一致/project 不符/slug 不符/过期 各一 | 仅一致者跳过握手；其余拒绝跳过 |
| UT-S09-131 | 稳定错误码映射 | §2.31 | prepare 失败/ACK 超时/实例 failed/三态矛盾 | 错误码映射 | 得 `ARCHIVE_WATCH_PREPARE_FAILED`/`ACK_TIMEOUT`/`INSTANCE_FAILED`/`STATE_INCONSISTENT`，均非零退出 |
| UT-S09-132 | 过期请求/租约清理幂等 | §2.31 | 含过期项 | 清理函数 | 过期清、未过期留、重复幂等；清理失败不反转归档 |
| UT-S09-133 | 三态调和：命令报错但磁盘已归档→成功 | EX-10.6 | live 已移走、archive 存在、guard 已删，命令非零 | 三态裁决 | archived+`reconciledFromDisk`；live 在则可恢复；矛盾则 inconsistent fail-closed |
| UT-S09-134 | 未知主版本/能力不足按不可协调处理 | EX-10.4(b) | 主版本高于认知或 capabilities 缺 prepare | 判定函数 | 不纳入可 ACK 快照，标记「存在不可协调监听者」，调用方 fail-closed 提示升级 |

### 10.2 场景测试用例补充

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S09-44 | 单实例 ACK 后才 rename | Step 13→14 | 注入 win32；快照 1 实例；rename 打桩计数 | 先不写 ACK 再写 released | released 前 rename=0；released 后 rename 1 次，删 guard，写 archived result |
| ST-S09-45 | 多实例必须全 ACK | Step 13→14 | 注入 win32；快照 2 实例 | 一个 released 另一超时 | rename=0，fail-closed，`ARCHIVE_WATCH_ACK_TIMEOUT`，guard 留，写 not-archived result |
| ST-S09-46 | 快照空走快路径归档 | EX-10.1 | 注入 win32；runtime 不存在 | 运行 archive | 不写 prepare、无等待，rename 成功，删 guard，等同无协议 |
| ST-S09-47 | single-flight：同 project+slug 仅一请求在途 | §2.31 | 注入 win32；已有未过期 prepare | 再次 archive | 共享结果或返回 archive-in-flight，不重复 pause |

### 10.3 异常测试用例补充

| ID | 描述 | 覆盖异常 | 前置条件 | 操作序列 | 预期结果 |
|----|------|---------|---------|---------|---------|
| ST-S09-EX-10.1 | 旧版持句柄致 rename EPERM 的明确诊断 | EX-10.4(a) | 注入 win32；快照空；rename 打桩抛 EPERM | 运行 archive | fail-closed 不动 guard、不自动重试；输出「可能有旧版 RunLogos 或其他程序正在监听，请升级或关闭后重试」 |
| ST-S09-EX-10.2 | 看得见但不可协调实例 fail-closed | EX-10.4(b) | 注入 win32；快照仅含 capabilities 缺 prepare/未知高版本 | 运行 archive | 不 rename、不动 guard；提示升级 CLI 或关闭该实例；不当作无监听者 |
| ST-S09-EX-10.3 | CLI 崩溃 result 缺失后重跑三态调和 | EX-10.6 | 注入 win32；rename 已完成但无 result | 重跑 archive | 三态裁决 archived+`reconciledFromDisk`，不重复 rename，不反转磁盘真相 |
| ST-S09-EX-10.4 | 非 Windows 完全不启用协议 | EX-10.7 | 注入 darwin/linux；即使存在 runtime 与租约 | 运行 archive | 不读/写/监听协议文件、不校验 token、不等待；直接 rename 归档，与现状逐字节一致 |

### 10.4 覆盖度校验补充

- [ ] 路径解析确定性+兼容向量+越界拒绝：UT-S09-125
- [ ] 租约快照判据：UT-S09-126、UT-S09-134
- [ ] runtime 缺失=空快照 + 快路径归档：UT-S09-127、ST-S09-46
- [ ] prepare 原子写与稳定屏障：UT-S09-128
- [ ] ACK 轮询屏障：UT-S09-129、ST-S09-44、ST-S09-45
- [ ] 去递归 token 校验：UT-S09-130
- [ ] 稳定错误码映射：UT-S09-131
- [ ] 过期清理幂等：UT-S09-132
- [ ] 三态调和 reconciledFromDisk：UT-S09-133、ST-S09-EX-10.3
- [ ] 旧版 EPERM 诊断不自动重试：ST-S09-EX-10.1
- [ ] 不可协调监听者 fail-closed：UT-S09-134、ST-S09-EX-10.2
- [ ] single-flight：ST-S09-47
- [ ] 非 Windows 不启用协议：ST-S09-EX-10.4
