## ADDED — S39 Seal-bound Preflight 与 Test-change-set 归因测试

### 单元测试

| 用例ID | 验证目标 | 参数化fixture | 关键断言 |
|---|---|---|---|
| UT-S39-56 | after严格扫描前移seal | 列数歧义、重复ID、跨target重复、非法UTF-8、合法before历史歧义 | after错误均在seal前失败且携带结构化target paths；before单向兼容不回退；零apply状态/journal/正式写 |
| UT-S39-57 | preflight canonical hash与apply同一性 | target顺序变化、metadata before/final漂移、test-change-set变化、completed_at变化 | 等价输入hash相同；任一确定性事实变化hash不同并首写前拒绝；completed_at不影响preflight |
| UT-S39-58 | target→slot归因 | 单/多Agent target、OpenLogos producer、unknown/multi-map、mixed retryable/fatal | 全部唯一Agent可共同reopen；其它组合一个slot也不清；message中伪造path不影响归因 |

### 场景测试

| 用例ID | 验证目标 | 步骤 | 关键断言 |
|---|---|---|---|
| ST-S39-27 | 完整closure预演与同事务恢复 | 真实before/final test targets+metadata构建view；legacy S44 fixture失败、修正、reseal/apply | preflight绑定seal；metadata/test-change-set/final paths守恒；只S44 slot退回；completed receipt闭包可复算 |

### Runner 与 OpenLogos Reporter

UT-S39-56～58、ST-S39-27必须调用真实test-change-set scanner、preflight builder、merge transaction与atomic apply路径，逐ID写reporter。禁止只断言错误字符串或绕过正式before/final bytes。
