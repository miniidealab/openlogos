## ADDED — S32/S39 测试变更 ID 语义差异与持久化要求

### 用户价值

多切片提案的代码切片必须只拥有本次真实新增或修改的测试，不能因为 `MODIFIED` Delta 完整携带历史表格行，就把未变化的基线测试错误提升为本次交付范围。规格合并完成后，即使没有 Git 历史或进程已经重启，OpenLogos 仍应从自身持久化事实得到相同的测试变更集合。

### 集合与所有权要求

设 `D` 为合并后正式测试规格中全部真实 UT/ST/SMOKE ID，`C` 为本次新增或语义修改的 ID，`R` 为本次删除的 ID，`B = D - C` 为未修改基线，`O` 为全部切片 `owned_test_ids` 的并集：

```text
O = C
C ∩ R = ∅
∀i≠j: owned(slice_i) ∩ owned(slice_j) = ∅
```

- 同 ID 前后规范化测试定义相同，必须留在 `B`，不得进入 `C/O`。
- 同 ID 前后定义不同，必须进入 `C`，即使它不是新 ID。
- 后态新增 ID 必须进入 `C`。
- 前态存在而后态不存在的 ID 只进入 `R`；删除项不要求在后态定义，也不得塞入 `O`。
- ID 在正式测试 target 之间迁移视为修改。

### 正常：merge 时固化语义差异

- **GIVEN** `merge-apply` 已校验正式测试 target 的 before 字节与 prepared final 字节
- **WHEN** apply 在任何正式写入前解析并比较两侧结构化测试定义
- **THEN** 生成版本化、稳定排序、带 target identity 与完整性哈希的 `openlogos/test-change-set@1`，并随 `SPEC_MERGED` 在同一事务原子落盘

### 正常：所有消费者同源

- **GIVEN** `SPEC_MERGED.test_change_set` 有效
- **WHEN** `status`、`next`、`change-lint`、测试切片 validator 或 `verify` 计算切片状态
- **THEN** 它们必须从同一 canonical reader 取得 C/R，禁止重新扫描 Delta 出现集合或依赖 Git `HEAD^`

### 事故回归：完整 MODIFIED 不扩大 C

- **GIVEN** 测试 Delta 原样携带 `UT-S10-121`～`UT-S10-128`、`ST-S10-36`～`ST-S10-39`，修改 `UT-S10-129`，并新增 `UT-S10-137`～`UT-S10-140`、`ST-S10-44`
- **WHEN** OpenLogos 计算语义 change set
- **THEN** `C` 必须精确为 `UT-S10-129`、`UT-S10-137`～`UT-S10-140`、`ST-S10-44`；12 个原样历史 ID 均留在 baseline

### 异常：change set 自身不可信

- **GIVEN** change set 缺失、schema 不支持、payload hash 失配或 target after identity 漂移
- **WHEN** 任一切片状态消费者运行
- **THEN** 保守阻塞并输出精确 `test-slice-change-set-*` violation；不得把该状态误派给只能重建 `TEST_SLICE_MANIFEST.json` 的 slice-planner，不得启动 runner、写 Gate/loop/checkpoint 或消耗 repair budget

### 恢复边界

- change set 有效、slice manifest 缺失/非法/漂移时，继续进入既有 `plan-slices` recovery。
- legacy marker 已有合法 final `VERIFY_PASS` 时不因升级回退。
- `type=no_delta_spec_complete` 且磁盘确无 mergeable delta 时，可可信派生 `C=[]、R=[]`。
- 旧活跃 marker 无可信 before snapshot 时不得伪造 change set；迁移需另行明确流程。

### 版本与部署验收

- CLI、lockfile、随包插件 manifest 与真实 tarball 版本统一为 `0.13.30`。
- verify 通过并获得部署授权后，只安装到本机 npm 全局环境；以固定、可校验的 `0.13.29` tarball 回滚并恢复 `0.13.30`。
- 安装态 smoke 必须覆盖事故六 ID、O=C 反例、removed 独立语义、无 Git 重启、篡改拒绝和实际回滚。
- 禁止 `npm publish`、dist-tag、Git tag、GitHub Release、官网部署与 `git push`。

### 非目标

- 不修改 RunLogos 对 invalid/missing/stale manifest 的消费与 recovery 派发。
- 不降低唯一归属、selector、spec target、fingerprint、checkpoint 或 final verify 硬门。
- 不把 Delta 中“出现过”的 ID 当作语义修改证明。
