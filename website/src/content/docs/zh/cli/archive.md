---
title: "openlogos archive"
description: 将已完成的变更提案移动到归档目录，并释放活跃提案 guard。
---

把已完成的变更提案从 `logos/changes/<slug>/` 移动到 `logos/changes/archive/YYYYMMDD-HHmm-<slug>/`；若 guard 文件指向本提案，则一并删除。

`openlogos archive` 是**人类确认点**：半自动模式下，AI 只有在你明确授权后才会执行（`openlogos next --auto` 下由 standing 授权覆盖）。

## 命令格式

```bash
openlogos archive <slug>
```

必须在项目根目录下运行。

## 参数

| 参数 | 必填 | 说明 |
|----------|----------|-------------|
| `slug` | **是** | 要归档的变更提案 slug |

## 执行过程

1. **先校验完成链条**，未通过时拒绝归档（非零退出、不移动任何东西）：
   - verify 未通过（缺 `VERIFY_PASS`，或存在 `VERIFY_FAIL`）——`ARCHIVE_VERIFY_NOT_PASSED`
   - 提案需要部署但缺 `DEPLOY_DONE`——`ARCHIVE_DEPLOY_NOT_DONE`
   - 提案需要部署且需要 smoke，但 smoke 未通过——`ARCHIVE_SMOKE_NOT_PASSED`
2. 生成带时间戳的目录名 `YYYYMMDD-HHmm-<slug>`（如 `20261012-1430-fix-redirect-bug`）。
3. 将 `logos/changes/<slug>/` 移动到 `logos/changes/archive/YYYYMMDD-HHmm-<slug>/`。
4. 若 `logos/.openlogos-guard` 的 `activeChange` 为本 slug，先为 guard 的事后检查关闭提案边界，再删除 guard 文件。此后直到下一次 `openlogos change`，会进入版本控制的代码与规格重新受保护。

归档目录保留提案产生的全部内容——`proposal.md`、`tasks.md`、`deltas/`，以及 `SPEC_MERGED`、`VERIFY_PASS`、`GATE_AUTO_PASSED` 等生命周期标记。归档仅供审计：当前真相在 `logos/resources/`。

归档完成后 AI 会自动提交本次移动；推送（`git push`）是另一个人类确认点。

## 输出示例

```
  ✓ logos/.openlogos-guard removed

✓ 变更提案 'fix-redirect-bug' 已归档。
  logos/changes/20261012-1430-fix-redirect-bug/ → logos/changes/archive/20261012-1430-fix-redirect-bug/
```

## 归档结构

```
logos/changes/archive/
└── 20261012-1430-fix-redirect-bug/
    ├── proposal.md
    ├── tasks.md
    ├── SPEC_MERGED
    ├── VERIFY_PASS
    └── deltas/
        ├── prd/
        ├── api/
        ├── database/
        └── scenario/
```

条目按时间戳前缀自然排序。CI 可以用 [`openlogos impact`](/zh/cli/impact) 把只含归档的提交识别为生命周期记账。

## 错误

| 错误 | 原因 | 解决方法 |
|-------|-------|-----|
| `Missing change proposal name` | 未提供 slug | `openlogos archive fix-redirect-bug` |
| `Change proposal 'X' not found` | `logos/changes/<slug>/` 下没有对应目录 | 检查拼写——是否已归档？ |
| `[ARCHIVE_VERIFY_NOT_PASSED]` / `[ARCHIVE_DEPLOY_NOT_DONE]` / `[ARCHIVE_SMOKE_NOT_PASSED]` | 完成链条未走完 | 先补齐缺失的步骤（`openlogos verify`、部署 + `openlogos deploy-done`、`openlogos smoke`） |
| `Archive 'X' already exists` | `logos/changes/archive/` 中已存在同名时间戳目录 | 稍等一分钟重试，或确认是否已归档 |
| `logos/logos.config.json not found` | 不在项目根目录 | `cd` 到项目根目录 |

在 Windows 上，`archive` 会在重命名目录前与正在运行的 `openlogos watch` 协调；若旧版 watcher 仍占用目录，请停止它后重试。

## 相关命令

- [`verify`](/zh/cli/verify) — Gate 3.6，归档前必须通过
- [`deploy-done`](/zh/cli/deploy-done) / [`smoke`](/zh/cli/smoke) — Gate 3.7 / 3.8，需部署的提案必须完成
- [`change`](/zh/cli/change) — 开始下一个提案
- [`impact`](/zh/cli/impact) — 在 CI 中识别归档提交
