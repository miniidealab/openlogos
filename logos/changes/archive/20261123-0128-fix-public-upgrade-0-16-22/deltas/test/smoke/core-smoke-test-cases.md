## ADDED — OpenLogos 0.16.22 Windows 公开升级 smoke

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| SMOKE-core-334 | 公开制品与升级入口 | 从 prod 部署记录读取版本与提交，读取官方 npm、GitHub Release、官网中英文升级页及官网下载脚本 | 官方版本可下载，GitHub 资产与 registry 制品一致；官网脚本与发布提交同源，升级指引指定官方源与目标版本 |
| SMOKE-core-335 | 真实 Windows 升级证据 | 按部署 ref 查询 GitHub Windows CI 的升级用例与部署证据，核对候选包版本及实际 CMD 输出 | Windows 旧版原地升级、多入口遮蔽与不可修复分支实际执行，通过证据绑定发布提交与版本，用户重新打开 CMD 后的版本断言在场 |

公开 smoke 由既有 dispatcher 发现并记录当前目标环境。镜像传播的版本与 tarball 可用性附在 334 证据中。公告指向经过核验的官方源。
