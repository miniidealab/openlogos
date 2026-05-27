## MODIFIED — ### 2.5 adopt
### 2.5 adopt

`openlogos adopt` 为已有项目接入专用命令。它不是轻量补丁命令，而是“只跳过 Initial 文档门禁的 init”：必须完成与 `init` 同级别的 OpenLogos 基础设施初始化，然后用 `bootstrap: adopted` 标记存量项目接入来源。

**检测与确认阶段**
```text
$ openlogos adopt

? 检测到已有项目：my-app（来自 package.json）
? 文档语言 (locale)：zh
? AI 工具：claude-code

✓ 读取项目信息完成
```

非交互场景应使用显式参数：

```text
openlogos adopt --locale zh --ai-tool all
```

**创建阶段**
```text
✓ 创建 logos/ 标准目录结构
✓ 写入 logos.config.json
✓ 写入 logos-project.yaml（bootstrap: adopted, lifecycle: launched）
✓ 写入 AGENTS.md / CLAUDE.md
✓ 部署所选 AI tools 的 Skills / 插件 / 命令资产
✓ 部署 OpenLogos 规范文件到 logos/spec/
```

**verify 预跑配置阶段**
```text
✓ 检测到测试脚本：npm test
✓ 写入 verify.pre_run_command: npm test
```

无法推断时：

```text
⚠ 未能推断测试命令。请补充 verify.pre_run_command 或 verify.regression_command。
```

**接入报告与下一步**
```text
🎉 已有项目接入完成！

项目已进入存量项目接入模式（bootstrap: adopted）：
  · OpenLogos 基础设施已完整初始化
  · Initial 文档基线已跳过，不强制要求
  · 模块生命周期直接设为 launched

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。
```

**异常：logos/ 已存在**
```text
✗ 该项目已初始化（logos/logos.config.json 已存在）
  若要重新配置，请先备份并删除 logos/ 目录。
```

## MODIFIED — ### 2.6 next（快速接入无提案时）
### 2.6 next（存量项目接入无提案时）

`bootstrap: adopted` 且无活跃提案时，`openlogos next` 输出固定引导。历史 `bootstrap: skipped` 项目按相同逻辑兼容处理。

```text
$ openlogos next

📌 当前状态：已接入（存量项目接入模式），尚无活跃变更提案

建议的下一步：先补充项目基线文档
  → openlogos change add-baseline-docs
  在变更提案中逐步补写需求、架构、场景、测试用例，
  把 TDD 思想贯彻到每一次迭代中。

补文档提案归档后，openlogos next 将恢复正常阶段建议。
```
