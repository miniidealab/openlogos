## ADDED — L0 Plan Package 完整性与四方一致性测试

> 全部实现必须由 OpenLogos reporter 逐 ID 写入 `logos/resources/verify/test-results.jsonl`；不得用文件存在、旧结果或手写 PASS 补齐。

### 单元测试

| ID | 检查项 | 用例 | 期望 |
|---|---|---|---|
| UT-S35-100 | locale section registry | 中文/英文全部 canonical 标题 | 同一语义 ID 集，标题各 locale 唯一 |
| UT-S35-101 | proposal missing/duplicate/empty | 三类参数化 summary fixture | 对应三个稳定 code，含 path/section/expected/fix_hint |
| UT-S35-102 | placeholder/type/deployment | 占位残留、非法类型、重复/非法部署字段 | 精确 issue；不得被其它正文掩盖 |
| UT-S35-103 | clarification/baseline/UI 聚合 | 三个共享 evaluator 分别失败 | L0 聚合但不复制判据，问题排序稳定 |
| UT-S35-104 | tasks plan 模板残留 | 中英文 delta scaffold 未替换 | plan_filled=false，模板行可定位 |
| UT-S35-105 | code 三态 | 空锚点、提前 checkbox、缺标题、merge 后真实切片 | plan/code-required/code-slices 四 fixture 精确结论 |
| UT-S35-106 | L0 exit 分层 | ready false/true/读取错误 | exit 2/0/1；success/error envelope 分层不变 |
| UT-S35-107 | wrapper 委托单一 evaluator | 调用旧 proposal/tasks API | 结果来自同一 evaluation，无独立字符串规则 |
| UT-S35-108 | issue 去重与 canonical 排序 | 多 evaluator 返回同问题及多行问题 | 稳定去重；check/path/line/section/code 顺序固定 |
| UT-S35-109 | plan 前沿等价范围 | plan、已有 Delta、PLAN_APPROVED、SPEC_MERGED 参数化 | 仅 plan fixture 强制四方等价；历史不回退 |
| UT-S35-110 | 只读问题不自修 | summary/code 两错误 | evaluator 前后文件/marker hash 不变 |
| UT-S35-111 | completion/asset contract 绑定 | dispatch contract 与过期 manifest | 合法声明可执行；过期时要求 sync/new session |

### 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S35-16 | 现场事故完整复现 | proposal 把 summary 改为核心设计，tasks 保留代码模板行；运行四消费者 | change-lint exit 2 且返回两类精确 issue；status/next/flow 均不 ready，用户不可见“可写 Delta” |
| ST-S35-17 | 修复后四方同时全绿 | 按 issues 新增 canonical summary、删除模板行保留空 code；重跑 | lint pass/plan package/status/next/flow 全部 ready，next ready-to-delta |
| ST-S35-18 | 项目级只读与历史兼容矩阵 | 对 success/fail/error/history/zh/en fixture 前后快照 | 所有只读路径零写；历史 marker 不回退；文本/JSON issue 集合一致 |

### 问题码与覆盖要求

- proposal：required section missing/duplicate/empty、placeholder、type、deployment、clarification。
- tasks：template remaining、code entry before spec-complete、code section missing。
- 组合：同一 fixture 一次返回全部可修问题；操作错误仍 fail-fast。
- L0 不替代 L1～L9；L0 PASS 后现有检查继续执行，既有 35 码及顺序零回归。

### 验收追溯

- S35-AC-Plan-01 proposal 精确问题：UT-S35-100～UT-S35-103、ST-S35-16。
- S35-AC-Plan-02 tasks 三态：UT-S35-104～UT-S35-105、ST-S35-16～ST-S35-17。
- S35-AC-Plan-03 exit 与四方等价：UT-S35-106～UT-S35-109、ST-S35-17。
- S35-AC-Plan-04 只读/历史/资产：UT-S35-110～UT-S35-111、ST-S35-18。
