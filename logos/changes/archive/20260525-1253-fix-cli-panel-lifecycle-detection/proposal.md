# 变更提案：fix-cli-panel-lifecycle-detection

> module: core | created: 2026-05-25

## 变更原因
RunLogos 研发在 `logos/changes/fix-cli-panel-lifecycle-detection/openlogos-cli-bug-report.md` 中反馈：项目已经执行过 `openlogos launch`，`logos/logos-project.yaml` 中 `modules[0].lifecycle: launched`，但 RunLogos 的 CLI 面板仍显示为开发中，无法进入 launched 后的变更管理视图。

已在 `/Users/huangxianglong/gitlab/runlogos` 复现：

- `openlogos detect --format json` 返回 `data.project.lifecycle: "initial"`，且 `data.project` 中没有 `modules` 字段。
- `openlogos status --format json` 返回 `data.lifecycle: "initial"`，且 `data` 中没有 `modules` 字段。
- 同一项目的 `logos/logos-project.yaml` 第 39-43 行实际存在 `modules[0].lifecycle: launched`。

进一步定位发现，RunLogos 的 `logos-project.yaml` 后半段存在局部 YAML 结构错误（第 258-259 行附近），当前 CLI 使用 `parseYaml()` 全量解析并在 `catch {}` 中静默吞掉解析异常，导致前半段原本可恢复读取的 `modules` 信息也被整体丢弃。最终 `detect/status` 都回退为 `initial`，客户端只能绕过 CLI 直接读 YAML，且多模块状态仍无法可靠展示。

## 变更类型
接口契约级 + 代码级修复 + 部署级

## 变更范围
- 影响的需求文档：无新增需求；修复既有“机器可读 JSON 输出”和“模块生命周期状态”能力的缺陷。
- 影响的功能规格：`logos/spec/cli-json-output.md`（CLI JSON 契约需补充 `detect.project.modules`、模块生命周期派生和 YAML 解析诊断语义）。
- 影响的业务场景：`logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S16-machine-json-output.md`（补充 `logos-project.yaml` 局部解析失败但 `modules` 可恢复时的异常分支）。
- 影响的 API：无 HTTP API；影响 CLI JSON 机器接口：
  - `openlogos detect --format json`
  - `openlogos status --format json`
- 影响的 DB 表：无。
- 影响的编排测试：无 HTTP API 编排测试；影响 `logos/resources/test/core-S16-test-cases.md` 与 CLI Vitest。
- 影响的 smoke 测试：`logos/resources/test/smoke/core-smoke-test-cases.md`（发布后需用含局部 YAML 错误但 `modules` 可读的项目验证 JSON 输出）。

## 部署影响
- 是否需要部署：是
- 部署原因：该缺陷存在于已安装的 `openlogos 0.9.27` CLI 中，RunLogos 通过全局/打包内 CLI 调用 `detect/status --format json`；源码修复必须发布到 npm 包后才能让 RunLogos 用户环境生效。
- 影响环境：npm 分发包、本地 CLI 安装环境、RunLogos 调用 OpenLogos CLI 的客户端环境。
- 是否涉及数据迁移：否。
- 是否需要回滚预案：是。
- 是否需要 smoke：是。

## 变更概述
本次修复将为 CLI 增加容错的 `logos-project.yaml` 读取路径：当 YAML 全量解析失败，但顶层 `modules` 节点仍能通过 YAML AST 恢复读取时，`detect/status` 不得静默丢弃模块注册表，而应继续输出 `modules[]` 并据此派生顶层 `lifecycle`。同时 JSON 输出应暴露可机读诊断信息，提示 `logos-project.yaml` 存在解析错误，避免客户端误以为项目真的没有模块或仍处于 `initial`。

`detect --format json` 需要补齐 `project.modules` 字段，至少包含 `id`、`name`、`lifecycle`，并保持顶层 `project.lifecycle` 规则：任意模块为 `launched` 时项目派生为 `launched`。`status --format json` 需要在同类局部 YAML 错误下继续输出 `data.modules`，且 `data.lifecycle` 不得因解析错误降级。

实现时应避免继续使用空 `catch {}` 掩盖 `logos-project.yaml` 解析问题；对可恢复错误输出 warning/diagnostics，对完全不可恢复的 YAML 错误也应返回明确诊断，而不是无声回退为 `initial`。
