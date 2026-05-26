## MODIFIED — 一、冒烟测试范围
| 环境 | 覆盖范围 | 说明 |
|------|----------|------|
| staging | CLI、插件模板、官网构建、官网发布动态、提案级部署门禁、部署进度摘要面板、CLI JSON 容错输出、adopt 命令 | 发布前最小检查；仅在提案级声明需要部署 / smoke 时执行 |

## MODIFIED — 二、冒烟测试用例
| ID | 描述 | 来源 | 目标环境 | 前置条件 | 操作 | 预期结果 |
|----|------|------|----------|----------|------|----------|
| SMOKE-core-01 | CLI 包可安装并输出版本 | 部署方案 | staging | 包已发布或本地 pack 完成 | `openlogos --version` | 返回版本号 |
| SMOKE-core-02 | 初始化命令可生成 all 工具资产 | 部署方案 | staging | CLI 可执行 | `openlogos init smoke --locale zh --ai-tool all` | 生成 `logos/` 与各工具资产 |
| SMOKE-core-03 | 官网构建产物可生成 | 部署方案 | staging | website 依赖已安装 | `npm run build` | 构建成功 |
| SMOKE-core-04 | 插件模板随包存在 | 部署方案 | staging | npm pack 完成 | 检查 tarball | 包含插件模板 |
| SMOKE-core-05 | 提案级无需部署时面板不展示部署入口 | 提案级部署门禁 | staging | 安装含本变更的 CLI | 构造无需部署且 VERIFY_PASS 的提案后运行 `openlogos status --format json` | `active_change.deployment_required=false`，下一步允许 archive |
| SMOKE-core-06 | 部署进度摘要仅统计 `[deploy]` | 提案级部署门禁 | staging | 安装含本变更的 CLI | 构造活跃提案且 `[code]` / `[deploy]` 同时存在后运行 `openlogos status --format json` | `deployment_progress` 只反映 `[deploy]` section，`deployment_document.name=tasks.md` |
| SMOKE-core-07 | 官网发布动态页面展示版本摘要 | 官网发布动态 | staging | 官网已部署或本地预览已启动 | 访问 `/releases` | 页面展示至少一个版本的版本价值摘要 / 问题修复摘要，并在摘要缺失时显示固定回退提示 |
| SMOKE-core-08 | 首页可进入发布动态 | 官网发布动态 | staging | 官网已部署或本地预览已启动 | 访问首页并点击最近发布入口 | 可跳转 `/releases`，且页面非 404 |
| SMOKE-core-09 | `detect/status` JSON 在局部损坏 YAML 下仍输出 launched 模块 | CLI JSON 容错输出 | staging | 安装含本修复的 CLI | 准备一个 `logos-project.yaml` 前半段含 `modules[0].lifecycle: launched`、后半段存在语法错误的 fixture，运行 `openlogos detect --format json` 与 `openlogos status --format json` | `project.lifecycle=launched`、`data.lifecycle=launched`、`modules[0].lifecycle=launched`，并返回 YAML 诊断信息 |
| SMOKE-core-10 | adopt 命令可在已有项目执行并生成 bootstrap=skipped 配置 | adopt 命令 | staging | 安装含本变更的 CLI，准备含 package.json 的测试目录（无 logos/） | 执行 `openlogos adopt --locale zh --ai-tool claude-code` | 生成 `logos/` 目录，`logos-project.yaml` 中 `modules[0].bootstrap=skipped`，`modules[0].lifecycle=launched` |
| SMOKE-core-11 | adopt 后 next 输出补文档引导 | adopt 命令 | staging | SMOKE-core-10 完成，无活跃提案 | 执行 `openlogos next` | 输出补文档引导文案，包含 `openlogos change add-baseline-docs` 建议 |

## 三、覆盖度校验
- [x] CLI 健康检查：已覆盖
- [x] 插件模板：已覆盖
- [x] 官网构建：已覆盖
- [x] 官网发布动态：已覆盖
- [x] 提案级部署门禁：已覆盖
- [x] 部署进度摘要：已覆盖
- [x] CLI JSON 容错输出：已覆盖
- [x] 发布前最小链路：已覆盖
- [x] adopt 命令：已覆盖
