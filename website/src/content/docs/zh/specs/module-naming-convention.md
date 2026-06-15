---
title: 模块命名约定
description: 多模块 OpenLogos 项目的文件命名规则——以模块前缀作为命名空间。
---

本规格定义多模块 OpenLogos 项目的文件命名约定。所有 Skill 在生成文件时都必须遵循这些规则。

## 核心原则：文件名即命名空间

所有设计文档文件名遵循以下格式：

```
<module>-<number-or-semantic-name>-<type>.md
```

- **module**：模块标识符——小写字母 + 连字符（如 `core`、`user`、`payment`）
- 初始项目使用 `core-` 作为默认模块前缀
- 新模块在同一目录中创建带其前缀的文件——无需子目录

## 按文件类型的命名规则

### 需求文档

```
<module>-01-requirements.md
```

示例：`core-01-requirements.md`、`admin-01-requirements.md`

### 功能规格

```
<module>-01-feature-specs.md
<module>-00-information-architecture.md
```

### 架构文档

```
<module>-01-architecture-overview.md
<module>-02-skip-phases-and-interfaces.md
```

### 场景实现文档

```
<module>-SXX-<english-slug>.md
```

示例：`core-S01-cli-init.md`、`admin-S08-dashboard.md`

场景编号**全局唯一**——由 `logos-project.yaml` 中的 `scenario_counter.next_id` 维护。不同模块绝不能从 S01 重新开始。

### 测试用例文档

```
<module>-SXX-test-cases.md
```

示例：`core-S01-test-cases.md`、`payment-S12-test-cases.md`

### 部署方案

```
<module>-01-deployment-plan.md
```

### Smoke 测试用例

```
<module>-smoke-test-cases.md
```

存放于 `logos/resources/test/smoke/`。

### API 文件

按领域拆分，通常在模块间共享（无需模块前缀）：

```
auth.yaml
payment.yaml
```

### 数据库文件

按领域拆分，通常在模块间共享：

```
schema.sql
auth.sql
```

## `openlogos status` 如何使用前缀

`openlogos status` 使用 `<moduleId>-` 前缀来判定每个模块的阶段完成情况：

- 当阶段目录中至少存在一个带该模块前缀的文件时，该模块的此阶段才算**完成**
- 属于其他模块的文件会被忽略
- 场景阶段（`phase.3-1`、`phase.3-4a`）要求逐场景的文件覆盖，而不只是任意文件

## 多模块共存

多个模块共享同一组目录而不冲突：

```
logos/resources/prd/1-product-requirements/
├── core-01-requirements.md      # core module
├── admin-01-requirements.md     # admin module
└── payment-01-requirements.md   # payment module
```

每个模块没有独立子目录——前缀即命名空间。

## 相关

- [目录约定](/zh/specs/directory-convention)——标准目录布局
- [logos-project.yaml](/zh/specs/logos-project)——模块注册表与场景计数器
- [`openlogos module`](/zh/cli/module)——管理模块的 CLI 命令
