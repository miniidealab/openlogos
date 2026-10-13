---
title: "openlogos impact"
description: 判断一个 git 变更区间是否只是 OpenLogos 生命周期记账——供 CI 使用的只读检查。
---

告诉 CI 一次 push 是否只改动了 **OpenLogos 生命周期记账**——例如 `openlogos archive` 产生的提交、verify 结果或 guard 文件——从而跳过制品的构建与部署。其余一切都报告为「不只是生命周期记账」，交由项目自己判断。

本命令只读（项目内外都不写任何东西），也不是人类确认点。

## 命令格式

```bash
openlogos impact --base <rev> --head <rev> [--format json]
git diff --no-relative --name-status -z <base> <head> | openlogos impact --stdin [--prefix <dir/>] [--format json]
```

## 选项

| 选项 | 说明 |
|------|------|
| `--base <rev> --head <rev>` | git 区间模式，两者须同时给出。每个修订先被安全解析为 commit ID 再取 diff；空值或以 `-` 开头的值直接拒绝。 |
| `--stdin` | 从 stdin 读取 `git diff --no-relative --name-status -z` 的字节流，不调用 git。与 `--base` / `--head` 互斥。 |
| `--prefix <dir/>` | 仅 `--stdin` 模式：OpenLogos 项目在 monorepo 中的目录（相对 git 顶层）。区间模式下前缀自动探测。 |
| `--format json` | 输出 JSON envelope（schema `openlogos-change-impact.v1`）。 |

## 路径分类

路径按相对 OpenLogos 项目根、按路径段边界匹配：

| 类别 | 路径 | 含义 |
|------|------|------|
| `lifecycle` | `logos/.openlogos-guard`、`logos/changes/**`（含 `archive/`）、`logos/resources/verify/**`、`logos/.runtime/**` | 纯记账，确定不会进入可部署制品 |
| `project` | `logos/` 下其余一切（规格、`logos.config.json` 等） | 由项目自决，OpenLogos 不背书 |
| `external` | `logos/` 之外或项目前缀之外的一切 | 业务代码，OpenLogos 不判断 |

只有当变更集非空、每条记录都能解析、且每个文件（重命名与复制的新旧两侧）都是 `lifecycle` 时，`lifecycle_only` 才为 `true`。空 diff、未知状态字母或字节流损坏一律得到 `lifecycle_only: false` 并列出原因——宁可多构建一次。

## 输出与退出码

CI 只应依据 `lifecycle_only` 做决定。`files[]`、`non_lifecycle_paths`、`operations`、`changes`、`reasons` 仅供展示。

| 退出码 | 含义 |
|--------|------|
| `0` | 判定完成——无论 `lifecycle_only` 为 true **还是** false。退出码不编码结论。 |
| `1` | 操作错误：`IMPACT_INPUT_INVALID`（选项组合或取值非法）或 `IMPACT_GIT_DIFF_FAILED`（git 不可用、不是仓库、修订不存在） |

## CI 示例

```bash
result=$(openlogos impact --base "$BASE_SHA" --head "$HEAD_SHA" --format json)
if [ "$(echo "$result" | jq -r '.data.lifecycle_only')" = "true" ]; then
  echo "仅生命周期记账变更——跳过构建与部署"
  exit 0
fi
```

建议在 CI 中固定 CLI 版本，避免判定规则在升级时悄悄变化；契约的破坏性变更会以新的 schema 版本发布。

## 相关命令

- [`archive`](/zh/cli/archive) — 典型的纯生命周期记账提交来源
- [`verify`](/zh/cli/verify) — 结果写在 `logos/resources/verify/` 下
