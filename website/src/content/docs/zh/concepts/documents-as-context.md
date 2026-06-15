---
title: 文档即上下文
description: "每个决策都存在于一份文档中 —— 可审查、可复现、可累积。AI 读的是文档，而不是你的心思。"
---

在「Vibe Coding（凭感觉编码）」中，AI 的上下文是一个黑盒 —— 你不知道它做了哪些假设。在 OpenLogos 中，每个决策都存在于一份文档里。相同的提示词配上相同的文档，无论由哪个 AI 工具或哪位团队成员运行，都会得到一致的结果。

## 问题：黑盒上下文

当你在没有文档的情况下告诉 AI「构建一个登录功能」时：

- **需求？** 靠猜。
- **UI 设计？** 靠猜。
- **API 结构？** 靠猜。
- **边界情况？** 靠猜。

输出千差万别。每次会话都从零开始。决策不断丢失。

而当你提供结构化的文档（需求 → 设计 → API 规格 → 测试用例）时，AI 会全部读取，并产出一致、可追溯的输出。

## `logos/` 目录

一切都存放在 `logos/` 下的结构化目录中。每个阶段的产出都成为下一阶段的输入 —— 全部采用人类可读的格式：

```
logos/
├── logos.config.json                        # Project config
├── logos-project.yaml                       # AI collaboration index
├── resources/
│   ├── prd/
│   │   ├── 1-product-requirements/          # Phase 1 · WHY
│   │   ├── 2-product-design/                # Phase 2 · WHAT
│   │   │   ├── 1-feature-specs/
│   │   │   └── 2-page-design/
│   │   └── 3-technical-plan/                # Phase 3 · HOW
│   │       ├── 1-architecture/
│   │       └── 2-scenario-implementation/
│   ├── api/                                 # OpenAPI YAML specs
│   ├── database/                            # SQL DDL / schema
│   ├── test/                                # Test case specs (Markdown)
│   ├── scenario/                            # API orchestration tests (JSON)
│   └── verify/                              # Acceptance reports
├── changes/                                 # Delta change proposals
│   ├── <slug>/                              # Active proposal
│   │   ├── proposal.md                      # Impact analysis + summary
│   │   ├── tasks.md                         # Phase-based task checklist
│   │   └── deltas/                          # Changed artifacts per task
│   │       ├── prd/
│   │       ├── api/
│   │       ├── database/
│   │       └── scenario/
│   └── archive/                             # Completed proposals
├── skills/                                  # AI Skills (SKILL.md per skill)
│   ├── prd-writer/
│   ├── product-designer/
│   ├── scenario-architect/
│   ├── api-designer/
│   ├── db-designer/
│   ├── test-writer/
│   ├── code-implementor/
│   ├── code-reviewer/
│   ├── change-writer/
│   ├── merge-executor/
│   └── ...                                  # 13 built-in skills
└── spec/                                    # Methodology specifications
```

完整规格参见 [项目结构](/zh/specs/project-structure)。

## 三大特性

| 特性 | 描述 |
|----------|-------------|
| **可审查** | AI 使用的每一条信息都在 Markdown、YAML 或 JSON 中。你可以在生成代码之前阅读、审计并纠正任何假设。 |
| **可复现** | 相同文档 → 相同上下文 → 一致的 AI 输出。更换 AI 工具、更换团队成员 —— 结果依然可预测。 |
| **可累积** | 文档是项目的知识资产。决策永不丢失。新成员读文档即可理解完整历史 —— 无需依赖口口相传的隐性知识。 |

## AGENTS.md —— AI 的导航器

当 AI 打开你的项目时，它会先读 `AGENTS.md`。这个文件就像一台 GPS：

| 功能 | 描述 |
|----------|-------------|
| 阶段检测 | 扫描 `logos/resources/` 以确定当前阶段 |
| 下一步 | 根据缺失的内容建议接下来该做什么 |
| 活跃 Skill | 列出每项任务应加载哪些 AI Skill |
| 规则 | 「没有设计文档就不写代码」—— 自动强制执行 |

AI 不需要你每次都解释项目。它读文档、检测阶段、加载正确的 Skill，然后开始工作 —— 带着完整的上下文。

## 格式选择

| 工件 | 格式 | 理由 |
|----------|--------|-----------|
| 需求、设计 | Markdown | 人类可读、可纳入版本控制、对 AI 友好 |
| API 规格 | OpenAPI YAML | 行业标准、工具生态完善 |
| DB schema | SQL DDL 或 YAML | 与数据库直接兼容 |
| 测试结果 | JSONL | 可流式处理、与语言无关 |
| 配置 | JSON | 机器可解析、可做 schema 校验 |

所有格式都是纯文本 —— `git diff` 能精确显示改动了什么。

---

*另见：[交互式深入解读 —— 文档即上下文](/zh/deep-dive/documents-as-context) →*
