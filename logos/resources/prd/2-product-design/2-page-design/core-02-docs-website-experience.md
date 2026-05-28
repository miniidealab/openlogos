# core-02-docs-website-experience

## 一、站点目标
文档站承担 OpenLogos 的安装入口、方法论说明、命令索引、示例项目入口和版本发布说明。

## 二、信息结构
- 首页：产品定位、核心原则、安装入口和发布日志入口。
- 发布日志：基于 npm registry 展示 `@miniidealab/openlogos` 全量版本列表、历史发布时间、安装命令、npm 元数据和发布归档链接；每个版本的摘要采用英文优先、中文原文次级展示，帮助海外用户快速理解版本价值与修复内容，同时保留中文可追溯原文。
- 方法论：WHY → WHAT → HOW、阶段与门禁。
- CLI：命令说明与使用示例。
- Skills：各 Skill 的触发条件与职责。
- 示例：可运行项目与真实实践。
- RunLogos：OpenLogos 方法论与 RunLogos 工具关系。

## 三、页面原则
- 以工具说明为主，不做营销式英雄页。
- 重点展示命令、阶段和文档索引。
- 入口要能直接引导到 `openlogos init`、`status`、`next` 和 `sync`。

## 四、发布日志页面设计
### 4.1 首页发布日志入口
- 位置：首页 release summary 不再放在 Hero 后方；调整为倒数第二个 section，位于 Quick Start 之后、CTA 之前。
- 目的：保持首页首屏与主叙事聚焦 OpenLogos 理念，release note 仅作为次级辅助信息展示。
- 内容：仍仅展示 npm latest 版本号、发布时间、安装命令、版本总数、最新 dist-tag 和完整发布日志入口，不扩大首屏信息密度。
- 交互：安装命令以等宽代码块展示；链接仍分别指向 `/releases`、npm 包页面和 GitHub Release。

### 4.2 `/releases` 发布日志页
- 页面目标：不是“最近动态页”，而是完整的 OpenLogos npm 发布日志页，并让用户在页内快速理解每个版本解决了什么问题、带来什么价值。
- 文案语言：官网 UI 继续保持英文；版本摘要改为英文优先、中文原文次级展示。中文原文只作为可折叠的 secondary content，不作为主展示文案。
- 数据边界：英文摘要必须来自仓库内维护的结构化 bilingual summary table 或同等静态数据，不允许在构建或运行时调用外部翻译服务，也不允许由 AI 临时生成虚构说明。
- 首屏信息：页面标题、latest 版本号、latest 发布时间、npm 包链接、GitHub Release 链接、安装命令、版本总数、registry 最后更新时间。
- 主体：按发布时间倒序展示全部版本时间线，不只展示最近版本。
- 每个版本项至少展示：版本号、发布时间、npm 版本链接、GitHub Release 链接、是否为 latest / old dist-tag、包 tarball 链接、gitHead、包大小、解压后大小、fileCount、Node.js engine、直接依赖、许可证。
- 每个版本项新增双语摘要：
  - 英文主摘要：`valueSummaryEn[]` / `fixSummaryEn[]`
  - 中文原文：`valueSummary[]` / `fixSummary[]`
  - 展示策略：英文 bullet 作为主展示；中文原文以 `details` / 次级块方式保留，便于对照与追溯。
- 回退策略：
  - 当某版本缺少英文摘要时，显示固定英文回退文案，并保留中文原文和 GitHub Release / CHANGELOG 外链。
  - `summarySource` 与 `summaryFallbackReason` 继续用于标注结构化摘要是否可用，以及为何进入回退。
- 分组策略：版本按 minor 系列聚合，例如 `0.9.x`、`0.8.x`、`0.7.x`，每组内按发布时间倒序。每个组显示版本数量和时间范围。
- 筛选与导航：桌面端左侧提供 sticky minor 系列索引；移动端改为横向滚动的系列筛选条。
- 数据说明：页面应明确“发布时间和 npm 元数据来自 npm registry；英文版本摘要来自仓库内维护的结构化 bilingual 数据；中文原文来自仓库 CHANGELOG（结构化提取）”；详细变更说明跳转 GitHub Release / CHANGELOG。
- 视觉风格：按 `ui-ux-pro-max` 建议采用 Knowledge Base / Developer Tool 风格：深色、最小主义、清晰层级、开发者等宽字体、少量绿色与蓝色强调，不使用营销式 hero 或装饰性图形。
- 响应式：桌面端左侧索引 + 右侧发布日志；移动端 latest 概览在上、系列筛选在下、时间线单列展示，文本不得溢出卡片。
- 可访问性：链接不能只依赖颜色区分；hover / focus 必须有可见状态；版本卡片固定边界，hover 不改变布局尺寸。
- 发布一致性门禁：由 tag 触发的正式发版中，`/releases` 页面必须在发布完成后展示本次 tag 对应版本；若页面 latest 版本仍落后于 tag 版本，则发布流程判定失败并阻断“发布完成”结论。

### 4.3 数据字段
发布页面至少消费以下字段：
- `packageName`
- `latestVersion`
- `updatedAt`
- `versionCount`
- `distTags`
- `versions[].version`
- `versions[].publishedAt`
- `versions[].npmUrl`
- `versions[].githubReleaseUrl`
- `versions[].tarballUrl`
- `versions[].gitHead`
- `versions[].size`
- `versions[].unpackedSize`
- `versions[].fileCount`
- `versions[].license`
- `versions[].engines`
- `versions[].dependencies`
- `versions[].distTags`
- `versions[].valueSummary[]`（中文原文摘要）
- `versions[].fixSummary[]`（中文原文摘要）
- `versions[].valueSummaryEn[]`（英文主展示摘要）
- `versions[].fixSummaryEn[]`（英文主展示摘要）
- `versions[].summarySource`
- `versions[].summaryFallbackReason`
- `sourceUrl`

### 4.4 页面原型
- 原型文件：`logos/resources/prd/2-product-design/2-page-design/core-03-release-page-prototype.html`
- 原型目标：给官网开发者提供 `/releases` 页面布局、信息密度、响应式行为和视觉层级参照。
- 原型必须展示多个 minor 系列和全量时间线，而不是只展示最近版本。
- 原型必须展示英文主摘要、中文原文次级块和英文摘要缺失时的固定回退态，确保双语策略在视觉上可直接验证。
