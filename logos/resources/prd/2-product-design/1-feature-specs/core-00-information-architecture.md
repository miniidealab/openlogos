# core-00-information-architecture

## 一、产品类型判断
OpenLogos 是混合型工具链：以 CLI 工具为主，辅以 AI Skills、方法论规范、插件模板和静态文档站。

## 二、信息架构
### 2.1 CLI 命令结构
- `init`：初始化项目和基础资产（全新项目）。
- `adopt`：已有项目接入 OpenLogos，生成 `logos/` 目录并直接进入 launched 迭代模式。
- `sync`：同步 AI 资产、规格与资源索引。
- `status`：查看阶段进度。
- `next`：查看下一步建议。
- `change` / `merge` / `archive`：管理变更提案。
- `verify` / `smoke`：执行验收与部署后门禁。
- `launch`：切换生命周期。
- `module`：管理模块注册表。
- `detect` / `index`：输出检测与索引辅助信息。

### 2.2 文档与资产结构
- `logos/resources/prd/1-product-requirements/`：需求与场景。
- `logos/resources/prd/2-product-design/`：功能规格与 CLI/文档站原型。
- `logos/resources/prd/3-technical-plan/`：架构、场景、部署。
- `logos/resources/test/`：测试用例。
- `logos/resources/test/smoke/`：部署后 smoke 用例。
- `logos/resources/verify/`：验收与 smoke 报告。
- `logos/resources/reference/`：参考资料根目录；初始化与接入时默认包含 `requirement/`、`todolist/`、`code/`、`image/`、`temp/`、`note/` 子目录，用于归档需求素材、待办清单、代码片段、图片、临时资料和笔记。
- `logos/resources/api/`、`database/`、`scenario/`：仅在项目存在对应能力时使用。

### 2.3 官网页面结构
- 首页：产品定位、核心原则、安装入口、最近发布动态入口。
- 发布动态：展示 `@miniidealab/openlogos` 的 npm 最新版本、历史版本发布时间、安装命令、npm 包链接和 GitHub Release 链接；在 `/releases` 页面中为每个版本展示“版本价值摘要 / 问题修复摘要”，若摘要缺失则给出显式回退提示。
- 方法论：WHY → WHAT → HOW、场景驱动、文档即上下文、工程理论根基。
- CLI：命令说明与使用示例。
- Skills：各 Skill 的触发条件与职责。
- 示例：可运行项目与真实实践。
- RunLogos：OpenLogos 方法论与 RunLogos 工具关系说明。

## 三、交互边界
### 3.1 CLI 终端体验
CLI 是主交互界面，所有阶段建议、状态判断和变更提案都应能在终端内完成。

### 3.2 AI 工具接入
Codex、Claude Code、OpenCode、Cursor 使用不同的指令文件与插件位置，但必须读取同一套方法论资产。

### 3.3 文档站与示例
官网负责安装入口、方法论说明、示例项目和发布信息，不承担业务运行逻辑。

## 四、资源索引策略
- `logos-project.yaml.resource_index` 是 AI 的主索引入口。
- 架构、场景、测试、部署和实现映射文档必须加入索引。
- 通过 `openlogos sync` 保持索引与真实文档同步。

## 五、原型策略
- CLI 场景使用终端输出模拟。
- AI Skill 场景使用对话脚本。
- 文档站场景使用页面结构说明与入口信息，而不是营销式页面。

## 六、官网发布动态数据源
- 官网发布动态必须以 npm registry 中 `@miniidealab/openlogos` 的真实数据为准，至少读取 `dist-tags.latest`、`versions` 和 `time`。
- 版本发布时间以 npm registry `time[version]` 为准，不从本地 git tag 或人工配置推断。
- 人类可读版本说明（版本价值 / 问题修复）优先来自仓库 `CHANGELOG.md` 的同版本章节，按 Keep a Changelog 分类提取：
  - `Added` / `Changed` / `Deprecated` / `Removed` / `Security` → 版本价值摘要
  - `Fixed` → 问题修复摘要
- 提取结果必须保持“可追溯到源文本”的语义，不得由 AI 生成虚构版本说明。
- 若 `CHANGELOG.md` 缺少对应版本或对应分类为空，构建产物必须标记为“结构化说明缺失”，前端显示固定回退提示，并提供 GitHub Release 与 CHANGELOG 外链。
- 官网构建应在构建期生成静态发布数据，页面运行时不依赖浏览器端访问 npm registry。
- 最新版本入口必须提供安装命令 `npm install -g @miniidealab/openlogos` 和 `npx @miniidealab/openlogos --version` 验证提示。

## 七、tag 发版后官网同步约束
- tag 发布链路（`git tag vX.Y.Z`）在完成 npm publish 与 GitHub Release 后，必须在同一链路执行官网发布动态同步（生成 release 数据、构建并部署站点）。
- 官网 `/releases` 的 latest 版本必须与本次 tag 版本一致；若不一致，本次发布视为未完成，不能标记“发布成功”。
- 官网同步步骤失败时，流程必须显式失败并输出可诊断日志，不得静默成功。
- 正式发版链路不得以历史缓存替代最新发布结果；历史缓存仅允许用于本地预览或离线演示。
