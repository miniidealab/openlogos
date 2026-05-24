## MODIFIED — 二、信息架构
### 2.1 CLI 命令结构
- `init`：初始化项目和基础资产。
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
- `logos/resources/api/`、`database/`、`scenario/`：仅在项目存在对应能力时使用。

### 2.3 官网页面结构
- 首页：产品定位、核心原则、安装入口、最近发布动态入口。
- 发布动态：展示 `@miniidealab/openlogos` 的 npm 最新版本、历史版本发布时间、安装命令、npm 包链接和 GitHub Release 链接。
- 方法论：WHY → WHAT → HOW、场景驱动、文档即上下文、工程理论根基。
- CLI：命令说明与使用示例。
- Skills：各 Skill 的触发条件与职责。
- 示例：可运行项目与真实实践。
- RunLogos：OpenLogos 方法论与 RunLogos 工具关系说明。

## ADDED — 六、官网发布动态数据源
- 官网发布动态必须以 npm registry 中 `@miniidealab/openlogos` 的真实数据为准，至少读取 `dist-tags.latest`、`versions` 和 `time`。
- 版本发布时间以 npm registry `time[version]` 为准，不从本地 git tag、`CHANGELOG.md` 或人工配置推断。
- npm registry 不提供逐版本详细变更正文，官网不得伪造“npm 发布日志正文”。详细说明可跳转 GitHub Release 或仓库 `CHANGELOG.md`。
- 官网构建应在构建期生成静态发布数据，页面运行时不依赖浏览器端访问 npm registry。
- 最新版本入口必须提供安装命令 `npm install -g @miniidealab/openlogos` 和 `npx @miniidealab/openlogos --version` 验证提示。
