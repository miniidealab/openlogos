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

## 部署说明

本文件（`spec/module-naming-convention.md`）是源码规范，由 `openlogos init` / `openlogos sync` 通过 `deploySpecs()` 自动部署到用户项目的 `logos/spec/` 目录。请勿直接修改 `logos/spec/` 下的副本。
