## MODIFIED — ### modules
### modules

数组，模块注册表。多模块项目必填，统一在此文件维护，不另建 `modules.yaml`。`openlogos init` 时自动写入 `core` 模块初始数据。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 模块标识符，小写字母 + 连字符，如 `core`、`payment` |
| `name` | string | 是 | 模块名称（中文或英文均可） |
| `lifecycle` | string | 是 | 模块生命周期：`initial`（初始开发阶段，关注 phase 推进）或 `launched`（迭代开发阶段，关注变更提案） |
| `bootstrap` | string | 否 | 入场模式：`normal`（默认，完整走 Phase 1→3）或 `adopted`（存量项目接入，Initial 文档基线已跳过）。由 `openlogos adopt` 命令写入，不建议手动修改。历史值 `skipped` 仅用于兼容读取。 |
| `skip_phases` | array | 否 | 声明本模块不需要的阶段，phase 检测时跳过对应目录。由 `architecture-designer` Skill 在技术选型后填写。 |
| `deployment_required` | boolean | 否 | 是否需要部署执行门禁。软件项目默认 true；纯文档、纯库或明确无需部署的模块可设为 false。 |

**`bootstrap` 字段语义**：

| 值 | 含义 | 写入时机 |
|----|------|---------|
| `normal`（或缺省） | 完整走 Phase 1→3 文档基线再进入迭代 | `openlogos init` 创建的模块默认值 |
| `adopted` | 已有项目快速接入；OpenLogos 基础设施完整初始化，但 Initial 文档基线已跳过 | `openlogos adopt` 写入 |
| `skipped` | 历史兼容值，等价于 `adopted` 读取，不再新写入 | 旧版本 `openlogos adopt` 写入 |

`bootstrap: adopted` 时的行为约束：
- `status`：Phase 1、Phase 2 和 Phase 3-0 缺失不报错，显示「文档基线已跳过（存量项目接入）」
- `next`：无活跃提案时，固定建议先执行 `openlogos change add-baseline-docs` 补文档
- `launch`：豁免 Initial 文档门禁检查（不依赖 `lifecycle` 值）
- `detect/status --format json`：新项目输出 `bootstrap: adopted`；历史 `bootstrap: skipped` 至少必须被识别为同一种接入模式，不得回退为普通 launched 或 initial

`skip_phases` 允许值：

| 值 | 跳过的检查 | 适用场景 |
|----|-----------|---------|
| `api` | `logos/resources/api/` | 无 HTTP API 的项目（桌面应用、CLI 工具、前端库） |
| `database` | `logos/resources/database/` | 无数据库的项目（纯计算工具、无状态 CLI） |
| `scenario` | `logos/resources/scenario/` | 无 API 编排测试的项目（通常与 `api` 同时跳过） |
| `deployment` | 部署执行与 smoke 门禁 | 纯文档、无需发布运行环境的模块 |

> `deployment` skip 只跳过部署执行与 smoke 门禁，不跳过部署方案设计。Initial 软件项目仍应说明为什么不需要部署。

示例：

```yaml
modules:
  - id: core
    name: 核心功能
    lifecycle: initial
    skip_phases: [api, scenario]   # SQLite 桌面应用：有数据库，无 HTTP API
```

```yaml
modules:
  - id: core
    name: 核心功能
    lifecycle: launched
    bootstrap: adopted
    skip_phases: [api, database, scenario]   # 存量 CLI 项目接入
```
