# 实现任务

> 变更类型：代码级。无 `[delta]` section（OpenLogos 仓库本体无业务规格，所有改动直接落到源码资产）。
> 无 `[deploy]` section（CLI 工具，发布走常规版本升级流程，不属本提案范围）。

## [code] Vendor 上游 ui-ux-pro-max skill

- [x] 在 `/tmp/uipro-vendor` 临时目录运行 `npx -y uipro-cli init --ai claude` 生成干净产物
- [x] 将 `/tmp/uipro-vendor/.claude/skills/ui-ux-pro-max/` 完整拷贝到 `skills/ui-ux-pro-max/`（含 SKILL.md、data/、scripts/）
- [x] 用 `curl` 从上游 main 分支拉取 `LICENSE` 副本到 `skills/ui-ux-pro-max/LICENSE`
- [x] 创建 `skills/ui-ux-pro-max/UPSTREAM.md`，按需求文档 §4.4 模板填写：source、license、vendored version、vendored commit（用 `git ls-remote` 拿上游 HEAD）、vendored date（2026-05-24）、vendored by、re-sync 步骤、OpenLogos-Side Modifications 列表

## [code] 路径本地化与标注

- [x] 在 `skills/ui-ux-pro-max/SKILL.md` 顶部插入 OpenLogos vendor 标注：`> 本 Skill 来自 [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT），由 OpenLogos vendor 内置。`
- [x] 在 `skills/ui-ux-pro-max/SKILL.md` 全文替换 `skills/ui-ux-pro-max/scripts/` → `logos/skills/ui-ux-pro-max/scripts/`
- [x] 验证替换结果：`grep -n "skills/ui-ux-pro-max/scripts" skills/ui-ux-pro-max/SKILL.md` 应只返回带 `logos/` 前缀的命中
- [x] 把上述本地化改动写入 `UPSTREAM.md` 的 OpenLogos-Side Modifications 段

## [code] 同步到 plugin/skills/

- [x] 把 `skills/ui-ux-pro-max/` 整体复制到 `plugin/skills/ui-ux-pro-max/`（含 LICENSE、UPSTREAM.md）
- [x] 确认 `plugin/skills/ui-ux-pro-max/SKILL.md` 与 `skills/ui-ux-pro-max/SKILL.md` 内容一致

## [code] 改造 product-designer 触发链

- [x] **扩展产品类型表**：在 `skills/product-designer/SKILL.md` 第 25-32 行的产品类型表中插入「桌面应用」整行：
  - 典型特征：本地安装、含 GUI、有独立窗口
  - 原型形式：HTML 模拟桌面布局（含菜单栏 / 工具栏 / 状态栏）或对应栈风格指南（SwiftUI / Jetpack Compose / Qt 等）
  - 交互规格重点：窗口管理、菜单栏 / 上下文菜单、快捷键、系统托盘、多窗口协作、文件系统交互
- [x] **同步信息架构维度**：在同文件 Step 2「设计信息架构」（第 47-54 行）补充一条：
  - **桌面应用**：窗口结构、菜单 / 快捷键体系、IPC 设计（主进程↔渲染进程 / 各 native 层）、本地存储与文件系统
- [x] 在 `skills/product-designer/SKILL.en.md` 同步上述两项改动（产品类型表新增 Desktop Application 行 + Step 2 增加 Desktop 维度）
- [x] 在 `skills/product-designer/SKILL.md` 的 Step 5「生成原型」前插入 Step 5a：
  - 适用条件：**凡产品交付物中包含图形用户界面（GUI）的产品类型**——
    - ✅ 触发：Web 应用 / 移动应用 / 桌面应用（Electron / Tauri / SwiftUI / Jetpack Compose / Qt / WPF / GTK 等）/ 混合型中含 GUI 交付物的部分
    - ❌ 不触发：纯 CLI 工具 / Library / AI Skills / 纯 API 服务 等无 GUI 交付物的产品
  - 调用命令：`python3 logos/skills/ui-ux-pro-max/scripts/search.py "<product_type> <industry> <style_keywords>" --design-system -p "<项目名>"`
  - 输出消费：拿到的风格 + 调色板 + 字体配对 + 登陆页模式 + 反模式清单作为生成原型的视觉基础（Web 用 HTML，桌面/移动按对应栈输出风格指南）
  - 降级路径：检测不到 `python3` 时跳过本步并给中文友好提示，原型用通用风格生成，不阻塞 Step 5
- [x] 在 `skills/product-designer/SKILL.en.md` 同步 Step 5a 英文版（保持中英文触发条件一致）
- [x] 复制改动到 `plugin/skills/product-designer/SKILL.md`、`plugin/skills/product-designer/SKILL.en.md`（如存在）

## [code] 修改 CLI init 生成器

- [x] 修改 `cli/src/commands/init.ts` 的 `generateActiveSkillsSection`（locale=zh 与 en 两条分支）：在 Skill 列表追加 `ui-ux-pro-max` 条目，描述为「UI/UX 设计智能（67 风格 / 96 调色板 / 57 字体配对 / 25 图表 / 13 技术栈）。Phase 2 处理 **GUI 类产品（Web / Mobile / Desktop）** 设计时由 product-designer 自动调用。」
- [x] 在 `openlogos init` 成功创建项目的最后阶段（init 流程结束前）加入非阻塞 Python 3 检测：
  - 用 `which python3` 或等价 node API 探测
  - 缺失时输出黄色警告 + 中英 locale 双语提示 + 多 OS 安装命令（macOS `brew install python3` / Ubuntu `sudo apt install python3`）+ 「不影响主流程」说明
  - 检测到 Python 3 时静默通过

## [code] 同步根目录 CLAUDE.md / AGENTS.md

- [x] 在 openlogos 仓库根目录运行 `cd cli && npm run build`（如需要）后重新跑生成器，确保 `CLAUDE.md` / `AGENTS.md` 的 Active Skills 列表中含 ui-ux-pro-max 条目
- [x] 不直接手编 `CLAUDE.md` / `AGENTS.md`；改动必须从 `cli/src/commands/init.ts` 的生成器源头出发（参见 [feedback_logos_vs_source.md]）

## [code] 测试与验证

- [x] 在干净测试目录跑 `openlogos init`，确认 `logos/skills/ui-ux-pro-max/` 被创建（来自 plugin 分发）
- [x] 跑 `python3 logos/skills/ui-ux-pro-max/scripts/search.py "saas dashboard" --domain product -n 3`，确认结构化推荐输出正常
- [x] 跑 `python3 logos/skills/ui-ux-pro-max/scripts/search.py "saas" --design-system -p "test"`，确认完整设计系统输出
- [x] 跑 `openlogos sync`，确认 ui-ux-pro-max 同步到 `.claude/skills/`、`.codex/skills/`、`.opencode/skills/`、`.cursor/skills/` 全部目标目录
- [x] 在没有 Python 3 的环境（容器或 PATH 屏蔽）跑 `openlogos init`，确认警告显示且 init 不阻塞
- [x] 更新 `cli/test/s01-init.test.ts` 等受影响的快照/断言（如有）
- [x] 运行 `cd cli && npm test`，全部测试通过

## [code] 收尾

- [x] 在 `CHANGELOG.md` 顶部追加本次条目：vendor 上游 ui-ux-pro-max skill、product-designer 触发链改造、init Python 检测
- [x] 检查 `skills/ui-ux-pro-max/LICENSE`、`UPSTREAM.md` 就位且字段完整
- [x] 检查根目录 `CLAUDE.md` / `AGENTS.md` 的 Active Skills 列表已含 ui-ux-pro-max
