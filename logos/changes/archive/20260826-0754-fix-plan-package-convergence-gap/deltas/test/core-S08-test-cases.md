## ADDED — Plan 合同资产 manifest 与 sync 测试

> 以下测试实现必须通过 OpenLogos reporter 上报；fixture 只使用一次性 HOME/prefix/cache，用户资产按 hash 检查且不读取私密正文。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|---|
| UT-S08-38 | asset manifest canonical hash 稳定 | S08 Step 2 | 同一权威 Skill/模板集合 | 两次不同目录构建 manifest | payload 与 SHA-256 逐字节一致，无时间戳入 hash |
| UT-S08-39 | Skill/模板改变要求版本或 cachebuster | 资产版本边界 | semver 不变、任一资产字节变化 | 构建验证 | 失败并指出 asset path、expected/actual hash |
| UT-S08-40 | sync stamp 新字段完整 | S08 Step 6 | 合法 manifest | 写 stamp | 含 cliVersion、syncedAt、planContractVersion、managedAssetsHash |
| UT-S08-41 | 过期 stamp 产生 producer 诊断 | EX-2.1 | stamp hash/contract 落后 | status/next 读取 | 提示 sync + 重开 session；只读命令仍可观察 |
| UT-S08-42 | 用户与项目 Skill 所有权不变 | EX-5.1 | 托管/用户/未知资产混合 | 两次 sync + fault injection | 仅托管资产变化；失败全回滚，用户/未知 hash 不变 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|---|---|---|---|---|---|
| ST-S08-28 | 候选包到项目 stamp 全链对账 | Step 1→6 | 隔离安装候选包 | sync、读回、重开 session、再 sync | manifest/插件/Skill/stamp hash 一致；第二次幂等 |
| ST-S08-29 | 同 semver 旧缓存与中途失败均 fail loud | EX-2.1、EX-5.1 | 预置旧 cache，注入提交/读回故障 | 执行 sync 与 producer dispatch | 旧缓存不复用；失败无部分提交，诊断可定位 |

### 追溯与覆盖

- S08-AC-Plan-01 资产可核验：UT-S08-38～UT-S08-40、ST-S08-28。
- S08-AC-Plan-02 过期/漂移可诊断：UT-S08-39、UT-S08-41、ST-S08-29。
- S08-AC-Plan-03 用户资产保护：UT-S08-42、ST-S08-28～ST-S08-29。
