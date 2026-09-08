# Delta: core-01-requirements.md

> change: lite-cut3b-verify-layers-and-release-0-15-0
> 目标：`logos/resources/prd/1-product-requirements/core-01-requirements.md`

## ADDED — verify 判定层收敛与 0.15.0 发布要求

### 用户问题与价值

`openlogos verify` 此前让三层同时参与放行：作者在设计期勾选的覆盖度清单、机器观察到的测试执行结果、人工维护的 AC 追溯矩阵。第一层与第三层是「人声称覆盖了」，第二层与 ID 覆盖检查是「机器看到确实跑了」。让声明参与放行，等于让声明覆盖事实。

同时，真正不可替代的那条判据必须留下：**规格声明了哪些用例，就必须都真的跑过**。否则「规格声明 10 个、只实现 3 个、那 3 个绿了」也会判通过，规格驱动的核心价值就没了。

### 核心需求

1. **Gate 判据收敛为三项**：结果账本自洽、零失败、零未覆盖。设计时覆盖度清单与 AC 追溯矩阵不再参与判定，其报告段与 JSON 字段一并移除。
2. **ID 覆盖检查完整保留**：规格声明的 ID 集合必须是测试结果中出现的 ID 集合的子集；未覆盖时判 FAIL 并逐个点名。
3. **文档保留**：测试规格中的「三、覆盖度校验」小节与 AC 追溯行作为文档保留，供人阅读，不被解析。
4. **0.15.0 为破坏性版本**，不做兼容层；以真实 tarball 在一次性隔离 npm prefix 中证明安装态身份与行为。
5. **不做本机全局安装**：全局保持 0.14.25 直到 runlogos 侧改造完成（减法方案 §13 保险条款）。

### 验收条件

| ID | 验收条件 |
|---|---|
| AC-VERIFY-LAYER-01 | Gate 判据恰为三项；设计时清单未勾选或 AC 追溯缺链均**不影响** Gate 结论 |
| AC-VERIFY-LAYER-02 | 规格声明 ID 未全部出现在结果中时判 FAIL 并逐个点名；该判据强度与收敛前逐字相同 |
| AC-VERIFY-LAYER-03 | 报告与 JSON envelope 不再含 `checklist` / `ac_trace` 字段与其失败原因码 |
| AC-RELEASE-0150-01 | 隔离 prefix 内 candidate identity 全部来自固定 tarball，无 workspace link |
| AC-RELEASE-0150-02 | 已删除的命令面（`merge transaction *`、`merge-apply`、切片事务）一律非零退出；`merge <slug>` 一次调用完成多目标合并 |
| AC-RELEASE-0150-03 | `change-lint` 为 9 项；`slice plan` 与 `lint-specs` 可用 |
| AC-RELEASE-0150-04 | **本机全局仍为 0.14.25**——部署全程未触碰全局 prefix |

### 追溯

- 场景：S13 消费 verify 结果、S19 发布与安装态 smoke。
- 测试：UT-S13-67～68、ST-S13-19、UT-S19-46、ST-S19-22。
- 部署后 smoke：SMOKE-core-197～199。
