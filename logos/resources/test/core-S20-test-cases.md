# S20: 已有项目接入 OpenLogos — 测试用例

## 一、单元测试用例

| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S20-01 | 读取 package.json 提取项目名 | adopt 逻辑 | 存在 package.json | 项目目录 | 返回 package.name |
| UT-S20-02 | 读取 Cargo.toml 提取项目名 | adopt 逻辑 | 存在 Cargo.toml，无 package.json | 项目目录 | 返回 package.name 字段值 |
| UT-S20-03 | 目录名兜底提取项目名 | adopt 逻辑 | 无任何项目清单文件 | 项目目录 | 返回目录名 |
| UT-S20-04 | 已初始化项目应拒绝重复接入 | adopt 逻辑 | 已存在 `logos/logos.config.json` | adopt | 返回错误 |
| UT-S20-05 | 生成 logos-project.yaml 含 bootstrap=skipped | adopt 逻辑 | 空 logos/ | adopt 配置 | yaml 中 modules[0].bootstrap = skipped |
| UT-S20-06 | 生成 logos-project.yaml 含 lifecycle=launched | adopt 逻辑 | 空 logos/ | adopt 配置 | yaml 中 modules[0].lifecycle = launched |
| UT-S20-07 | 可识别测试栈时写入 verify.pre_run_command | adopt 逻辑 | 存在 package.json / pytest / Go / Cargo 等可识别测试栈 | adopt | 写入可执行的全量测试命令 |
| UT-S20-08 | 无法推断测试命令时输出 TODO | adopt 逻辑 | 无任何可识别测试脚本或框架配置 | adopt | 保留 `verify.result_path`，并输出补齐提示 |

## 二、场景测试用例

### 2.1 主路径

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S20-01 | 已有项目快速接入 | Step 1→9 | 有 package.json，无 logos/ | 执行 adopt | 生成全部基础文件（含 Skills、插件模板），bootstrap=skipped，lifecycle=launched，并在可识别测试栈时写入 verify 预跑配置 |
| ST-S20-02 | 接入后 next 输出补文档引导 | S05 联动 | adopt 完成，无活跃提案 | 执行 next | 输出补文档引导，建议 change add-baseline-docs |
| ST-S20-03 | 接入后 status 显示 Phase 1~3 为已跳过 | S11 联动 | adopt 完成 | 执行 status | Phase 1~3 显示「文档基线已跳过（快速接入）」，不报错 |
| ST-S20-04 | 接入后 launch 豁免 Phase 1~3 门禁 | S14 联动 | adopt 完成，bootstrap=skipped | 执行 launch | 不检查 Phase 1~3，直接放行 |
| ST-S20-05 | adopt 后写入 verify 预跑配置 | Step 1→9 | 有 package.json 且可识别测试脚本 | 执行 adopt | 接入报告说明 verify 预跑配置已补齐 |

### 2.2 异常路径

| ID | 描述 | 覆盖 EX | 前置条件 | 触发条件 | 预期结果 |
|----|------|--------|---------|---------|---------|
| ST-S20-EX-01 | 已初始化项目拒绝重复接入 | EX-2.1 | 已存在 logos/logos.config.json | 执行 adopt | 退出并报错，不覆盖文件 |
| ST-S20-EX-02 | 无法推断测试命令时输出 TODO | EX-5.1 | 无任何可识别测试脚本或框架配置 | 执行 adopt | 接入成功，但输出 verify 预跑配置补齐提示 |

## 三、覆盖度校验

- [x] adopt 命令主路径：已覆盖（ST-S20-01）
- [x] bootstrap=skipped 标记写入：已覆盖（UT-S20-05/06、ST-S20-01）
- [x] verify 预跑配置写入：已覆盖（UT-S20-07、ST-S20-05）
- [x] 无法推断时输出 TODO：已覆盖（UT-S20-08、ST-S20-EX-02）
- [x] next 补文档引导：已覆盖（ST-S20-02）
- [x] status Phase 1~3 已跳过显示：已覆盖（ST-S20-03）
- [x] launch 门禁豁免：已覆盖（ST-S20-04）
- [x] 重复接入异常：已覆盖（ST-S20-EX-01）
