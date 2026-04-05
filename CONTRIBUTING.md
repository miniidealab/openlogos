# 贡献指南

感谢你对 OpenLogos 的关注！我们欢迎任何形式的贡献——无论是修复一个错别字，还是提出一个全新的 Skill。

## 如何参与

### 报告问题

在 [GitHub Issues](https://github.com/miniidealab/openlogos/issues) 中提交，请包含：

- 问题的清晰描述
- 复现步骤（如适用）
- 你期望的行为 vs 实际行为

### 提交改进

1. Fork 本仓库
2. 创建你的分支：`git checkout -b improve/your-improvement`
3. 提交更改：`git commit -m "improve: description"`
4. 推送分支：`git push origin improve/your-improvement`
5. 创建 Pull Request

### 贡献 Skill

Skill 是 OpenLogos 方法论的核心载体。贡献新 Skill 或改进现有 Skill 是最有价值的贡献方式。

**Skill 文件规范**：

每个 Skill 放在 `skills/{skill-name}/SKILL.md`，包含以下部分：

```markdown
# Skill: {Skill 名称}

> 一句话描述这个 Skill 的核心能力。

## 触发条件
[什么情况下应该使用这个 Skill]

## 核心能力
[这个 Skill 能做什么]

## 执行步骤
[按顺序列出 AI 应该执行的步骤]

## 输出规范
[定义产出物的格式和质量标准]

## 实践经验
[编码的关键经验、最佳实践、常见陷阱]
```

**贡献新 Skill 的流程**：

1. 在 Issues 中提出你想创建的 Skill，说明解决什么问题
2. 讨论通过后，按上述规范创建 SKILL.md
3. 在 `examples/demo-saas-project/` 中添加使用示例
4. 提交 PR

### 贡献规范文档

`spec/` 目录下的规范文档是 OpenLogos 的基础设施。修改规范文档请：

1. 在 Issues 中先讨论变更的理由和影响范围
2. 确保向后兼容（或明确标注 Breaking Change）
3. 更新相关的 Skill 和示例项目

## 分支命名规范

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat/` | 新功能 | `feat/add-ci-skill` |
| `improve/` | 改进现有内容 | `improve/prd-writer-examples` |
| `fix/` | 修复错误 | `fix/schema-validation` |
| `docs/` | 文档更新 | `docs/quick-start-guide` |

## Commit 消息规范

```
<type>: <description>

[optional body]
```

类型（type）：
- `feat`: 新功能或新 Skill
- `improve`: 改进现有功能
- `fix`: 修复错误
- `docs`: 文档更新
- `spec`: 规范变更
- `cli`: CLI 工具变更
- `website`: 官网变更

## 代码风格

- Markdown 文档使用中文撰写（国际化版本后续支持）
- 代码示例使用英文注释
- CLI 工具使用 TypeScript，遵循项目中的 ESLint 配置

## 许可证

提交贡献即表示你同意你的贡献将按照以下许可证发布：
- 代码和规范：Apache License 2.0
- 文档和教程：CC BY-SA 4.0

## 行为准则

请保持友善和专业。我们致力于营造一个包容、尊重的社区环境。
