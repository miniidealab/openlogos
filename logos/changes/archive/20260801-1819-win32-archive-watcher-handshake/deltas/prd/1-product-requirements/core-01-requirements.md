## ADDED — S09 验收条件「正常：Windows 外部归档无活跃监听时走快路径」

##### 正常：Windows 外部归档无活跃监听时走快路径
- **GIVEN** Windows 平台，用户从外部终端执行 `openlogos archive <slug>`，且 `logos/.runtime/archive-watch/v1/` 不存在或实例租约快照无「未过期且 projectId 匹配」的活跃 RunLogos 实例（未装/未运行/未监听本项目）
- **WHEN** CLI 执行归档
- **THEN** 直接走现有 rename 快路径，不写协议请求、不引入等待；runtime 目录缺失视为正常路径、不作为错误；行为与未引入本协议时一致

## ADDED — S09 验收条件「正常：与活跃 RunLogos 实例完成握手后归档」

##### 正常：与活跃 RunLogos 实例完成握手后归档
- **GIVEN** Windows 平台，快照存在「未过期、projectId 匹配、capabilities 含 prepare」的活跃实例
- **WHEN** 执行 `openlogos archive <slug>`
- **THEN** CLI 先过既有资格/授权校验，再原子写 prepare 并轮询 ACK；仅当全部实例 ACK 为 released 后才 rename；随后尽力写 result；归档命名、guard 删除时机、授权语义不变

## ADDED — S09 验收条件「异常：握手超时或实例失败」

##### 异常：握手超时或实例失败
- **GIVEN** Windows 平台，已写 prepare，但 deadline 前未收齐 released 或任一实例 ACK 为 failed
- **WHEN** CLI 等待 ACK
- **THEN** fail-closed：不 rename、不删 guard、不改状态；返回稳定错误码 `ARCHIVE_WATCH_ACK_TIMEOUT`/`ARCHIVE_WATCH_INSTANCE_FAILED` 与脱敏诊断；尽力写 not-archived/cancelled result

## ADDED — S09 验收条件「异常：遇不可协调的监听者」

##### 异常：遇不可协调的监听者
- **GIVEN** Windows 平台，(a) 旧版 RunLogos 持句柄但不写租约，CLI 走快路径时 rename 抛 EPERM/EACCES/EBUSY；或 (b) 租约可见但 capabilities 不含 prepare、或协议主版本高于本 CLI 认知
- **WHEN** CLI 尝试归档
- **THEN** 均 fail-closed（不 rename、不动 guard、不自动重试）：(a) 提示「可能有旧版 RunLogos 或其他程序正在监听，请升级或关闭后重试」；(b) 提示「检测到能力不足或更高版本的 RunLogos，请升级 openlogos CLI 或关闭该实例」

## ADDED — S09 验收条件「正常：宿主已协调时跳过外部握手」

##### 正常：宿主已协调时跳过外部握手
- **GIVEN** Windows 平台，RunLogos spawn CLI 时注入仅对子进程可见的一次性 `OPENLOGOS_ARCHIVE_WATCH_PREPARED=<token>`
- **WHEN** CLI 执行归档
- **THEN** 仅当 token 结构有效、cwd/projectId 与绑定项目一致、slug 一致、未过期时跳过握手直接 rename；任一不满足则不跳过；无 `--no-watch-handshake` 全局开关

## ADDED — S09 验收条件「正常：非 Windows 平台不启用握手协议」

##### 正常：非 Windows 平台不启用握手协议
- **GIVEN** 平台为 macOS 或 Linux
- **WHEN** 执行 `openlogos archive <slug>`
- **THEN** 不创建/读取/监听任何协议文件、不校验 token、不增加等待，沿用原 archive 路径；无论 CLI/RunLogos 版本新旧
