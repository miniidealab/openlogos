## ADDED — S19 Windows 公开版升级验收

| ID | 场景 | 前置与操作 | 期望 |
|---|---|---|---|
| UT-S19-108 | 官方源与版本 | 用可控 npm 响应检查升级脚本的调用参数，输入合法或无效的目标版本 | 合法版本以精确包名、版本及官方 registry 全局安装，无效版本在启动 npm 前失败 |
| UT-S19-109 | 用户目录重排 | 一次性 Path 夹具含等价路径引用、多个普通目录与目标目录 | 目标 npm 目录仅出现一次且优先，其他目录与变量引用按原相对顺序保留 |
| ST-S19-35 | Windows 旧版原地升级 | Windows 一次性 prefix 装旧版后安装候选 tarball并启动 CMD | npm 安装前后复用 prefix，直接运行 `openlogos --version` 输出候选版本 |
| ST-S19-36 | Windows 旧入口遮蔽 | 在 Windows 创建旧入口和可修复、不可修复的 Path 夹具，执行同一脚本 | 用户级遮蔽经持久化调整后由新 CMD 调用目标版本。持续遮蔽时提示实际命中的路径和已验证的目标入口，保留原 Path |

用例通过 OpenLogos reporter 记录。真实 Windows 行为由 Windows 回归任务取证。非 Windows 环境可对同一实现的输入校验和路径排序运行局部测试。
