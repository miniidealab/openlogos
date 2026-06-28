# S13: 运行测试验收并生成报告 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-01 | 解析 JSONL | parseJsonl | 结果文件内容 | JSONL | 返回测试结果 |
| UT-S13-02 | 兼容执行 pre_run_command | verify 预跑 | 配置了单阶段测试命令 | verify | 先执行预跑命令，再读取结果 |
| UT-S13-03 | 两阶段预跑按回归 → 增量顺序执行 | verify 预跑 | 同时配置 regression / incremental 命令 | verify | 两阶段按顺序执行，重复 ID 最后一次结果生效 |
| UT-S13-04 | 覆盖不足且无预跑配置时输出诊断 | verify 诊断 | 无预跑配置且 JSONL 覆盖不足 | verify | 产生 FAIL 和局部测试诊断 |
| UT-S13-05 | verify JSON 输出包含 pre_run 状态 | verify JSON | 传入 --format json | verify --format json | 返回 pre_run.mode、commands、diagnostics 和 suggestions |
| UT-S13-24 | release 摘要双语字段与回退原因 | release summary parser | CHANGELOG 含中英文摘要映射 | version list | 生成英文主摘要、中文原文摘要和英文缺失回退原因 |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-01 | 生成验收报告 | Step 1→9 | 存在测试结果 | verify | 写入 acceptance-report.md |
| ST-S13-02 | 单阶段 pre_run_command 验收通过 | Step 1→9 | 配置 pre_run_command 且结果完整 | verify | 先跑预执行命令，再生成 PASS 报告 |
| ST-S13-03 | 两阶段 regression + incremental 验收通过 | Step 1→9 | 配置两阶段命令且阶段结果完整 | verify | 两阶段结果合并后生成 PASS 报告 |

### 2.2 异常路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-04 | 无预跑配置且覆盖不足 | Step 1→9 | 未配置任何预跑命令且结果不完整 | verify | FAIL，并输出可能只运行局部测试的诊断和配置建议 |

## 三、覆盖度校验
- [x] JSONL 解析：已覆盖（UT-S13-01）
- [x] 单阶段 pre_run_command 兼容：已覆盖（UT-S13-02 / ST-S13-02）
- [x] 两阶段 regression + incremental：已覆盖（UT-S13-03 / ST-S13-03）
- [x] 覆盖不足诊断：已覆盖（UT-S13-04 / ST-S13-04）
- [x] verify JSON 状态输出：已覆盖（UT-S13-05）

## 四、smoke 覆盖预检测试用例

### 4.1 单元测试用例补充
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-SMOKE-01 | 提取当前提案新增 smoke case ID | smoke coverage precheck | 活跃提案 deltas/test/smoke 中新增 `SMOKE-NEW-01` | proposal slug | 返回新增 ID 列表，不包含历史 smoke ID |
| UT-S13-SMOKE-02 | verify/code gate 发现新增 smoke case uncovered | smoke coverage precheck | 新增 smoke ID 存在，`smoke-results.jsonl` 缺少对应结果 | precheck | 返回 FAIL，诊断 `smoke_cases_uncovered` 并列出缺失 ID |

### 4.2 场景测试用例补充
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S13-SMOKE-01 | code 完成前阻断遗漏 smoke runner 的提案 | S13 Step 7a→7d | 活跃提案新增 smoke 用例，`[code]` 任务已尝试完成但无 runner/reporter | smoke 覆盖预检或 verify | 输出 `smoke_runner_missing` / `smoke_reporter_missing` / `smoke_cases_uncovered`，不允许把 code completion 视为通过 |

### 4.3 覆盖度校验补充
- [ ] smoke 覆盖预检提取新增 ID：UT-S13-SMOKE-01
- [ ] smoke 覆盖预检 uncovered 诊断：UT-S13-SMOKE-02、ST-S13-SMOKE-01
