# 模块前缀命名规范

> 版本：1.0.0
>
> 本文档定义 OpenLogos 多模块项目的文件命名规范。所有 Skill 生成文件时必须遵循此规范。

## 核心原则：文件名即命名空间

所有设计文档文件名统一遵循格式：

```
<module>-<序号或语义名>-<类型>.md
```

- **module**：模块标识符，小写字母 + 连字符，如 `core`、`user`、`payment`
- 初始项目的默认模块统一使用 `core-` 前缀
- 新模块开发时，直接在同一目录下创建带新模块前缀的文件，无需新建子目录

## 各类文件命名规则

| 文件类型 | 格式 | 示例 |
|---------|------|------|
| 需求文档 | `<module>-{序号}-{英文名}.md` | `core-01-requirements.md` |
| 功能规格 | `<module>-{序号}-{英文名}.md` | `core-00-information-architecture.md` |
| 页面设计 | `<module>-{序号}-{英文名}.md` | `core-01-cli-terminal.md` |
| 架构文档 | `<module>-{序号}-{英文名}.md` | `core-01-architecture-overview.md`（全局唯一，始终在此文件上更新） |
| 场景概览 | `<module>-00-scenario-overview.md` | `core-00-scenario-overview.md` |
| 场景实现 | `<module>-SXX-{英文名}.md` | `core-S01-cli-init.md` |
| 测试用例 | `<module>-SXX-test-cases.md` | `core-S01-test-cases.md` |

## 场景编号全局唯一

所有模块的场景编号共享一个全局递增序列（`S01`、`S02`...），由 `logos-project.yaml` 中的 `scenario_counter.next_id` 字段维护。

**AI 行为约束**：
1. 生成新场景前，必须读取 `logos-project.yaml` 的 `scenario_counter.next_id` 取号
2. 生成后立即将 `next_id` 加 1 并写回
3. 严禁不同模块从 S01 重新开始编号

## 模块注册表

模块统一在 `logos-project.yaml` 的 `modules[]` 中维护，不另建 `modules.yaml`。

```yaml
scenario_counter:
  next_id: 19

modules:
  - id: core
    name: 核心功能
    lifecycle: launched
  - id: payment
    name: 支付模块
    lifecycle: initial
```

## 多模块共存示例

同一目录下，不同模块的文件自然共存，通过前缀区分：

```
logos/resources/prd/3-technical-plan/2-scenario-implementation/
├── core-00-scenario-overview.md
├── core-S01-cli-init.md
├── core-S02-prd-writer.md
├── payment-00-scenario-overview.md
└── payment-S19-checkout.md        # 场景编号全局连续，不从 S01 重新开始
```

## feature 功能分组编号规范（add-feature-model）

在 module（模块）与 scenario（场景）之间引入**可选的 feature（功能）分组层**。feature 是 module 的子分组，聚合若干 scenario，可选链接到 feature-specs 文档。

### 编号规则（feature ID 项目全局唯一）

- feature ID 格式 `F` + 两位零填充数字（`F01`…`F99`；超过 99 自然进位为三位 `F100`，零填充仅保证 ≤99 排序稳定）。
- **feature ID 项目全局唯一**，与 scenario 同策——**严禁不同 module 从 F01 重新编号**。
- 全局计数器 `logos-project.yaml` → `feature_counter.next_id`（integer），仿 `scenario_counter`。

### AI 维护范式（CLI 不取号）

与 `scenario_counter` 一致：取号是 **AI 的职责**，CLI 从不读写 `feature_counter`。

1. 生成新 feature 前读取 `feature_counter.next_id` 取号（用作 `F0X`）。**计数器或 `next_id` 缺失语义**：`configured_next_id = feature_counter?.next_id ?? 1`（存量首次回填、无 `feature_counter` 时从 `F01` 开始，不报错、不跳过）。
2. 生成后立即将 `next_id` 加 1 并写回。
3. **计数器冲突恢复（两步式，防重号）**：设已有最大 feature 编号为 `max(existing)`（无 feature 时为 0），取 `allocated = max(configured_next_id, max(existing)+1)`，用 `allocated` 创建，持久化 `feature_counter.next_id = allocated + 1`。例：已有 `F05` + `next_id=3` → 分配 `F06`、持久化 `next_id=7`、下次 `F07`。绝不复用已存在 ID。

### feature 注册表与场景归属

- feature 统一在 `logos-project.yaml` 的 `features[]` 维护，不另建文件。元素 `{id, name, module, spec?}`：
  - `module`：归属的模块 id（必指向 `modules[]` 已注册项；feature 不跨 module）。
  - `spec`（可选）：feature-specs 文档序号（如 `core-01`，即 `<module>-<序号>`，无 `.md`、无章节锚点），目标缺失视为未链接。
- 场景归属：`scenarios[]` 元素可选 `feature: F0X`。`scenario.feature` 缺失 / 指向未知 feature / 跨 module，一律降级为该场景所属 module 的"未分组"桶（不报错）。

```yaml
scenario_counter:
  next_id: 35
feature_counter:
  next_id: 4

features:
  - id: F01
    name: 项目生命周期与初始化
    module: core
    spec: core-01

scenarios:
  - id: S01
    module: core
    feature: F01
```

## 部署说明

本文件（`spec/module-naming-convention.md`）是源码规范，由 `openlogos init` / `openlogos sync` 通过 `deploySpecs()` 自动部署到用户项目的 `logos/spec/` 目录。请勿直接修改 `logos/spec/` 下的副本。
