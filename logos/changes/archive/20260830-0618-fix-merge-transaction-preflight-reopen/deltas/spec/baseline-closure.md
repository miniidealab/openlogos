## ADDED — 19. Seal-bound Preflight 与 Test-change-set 归因

### 19.1 Preflight 输入与纯度

merge transaction在seal前以冻结Delta source、正式before和全部candidate final bytes构建`openlogos/merge-preflight@1`内部view。builder必须纯只读：不得写phase、journal、staging、backup、receipt、marker或正式target，也不得调用带恢复/清理副作用的apply入口。

### 19.2 Canonical View

view至少包含：

- transaction ID、plan hash、target-set hash；
- planned/derived targets的canonical path、mode、producer、before/final SHA-256；
- after测试定义严格扫描与`test-change-set` SHA-256；
- metadata/counter/index、dogfood/prototype绑定；
- 最终target path集合；
- view自身SHA-256。

数组ASCII排序去重，object固定键序列化。`completed_at`、临时路径、进程ID等非确定性值不得进入view。

### 19.3 Seal 与 Apply

新`seal_sha256`绑定content hashes和`preflight_sha256`。apply首个可变动作前重算view并逐项相等；metadata/before/derived/path集合漂移均fatal，禁止基于新基线静默rebase。apply成功的receipt确定性payload必须来自sealed view。

### 19.4 Test-change-set 结构化错误

after侧继续严格拒绝列数不一致、重复ID、非法UTF-8；before侧历史兼容不变。scanner/builder内部错误至少携带`code,target_paths[],producer,retryable`。跨target duplicate只有明确列出全部责任targets且全部唯一映射到可修复Agent slots时才可共同reopen；无法确定责任集合则fatal。

### 19.5 Legacy 事务

缺preflight record的0.14.1 sealed事务在apply首写前生成ephemeral view。pass则保持legacy seal完成apply；attributable fail则reopen。reopen后下一次seal使用新view/new seal。completed、applying或任何journal/receipt/marker/正式新字节不兼容迁移。

### 19.6 Reopen 与闭包守恒

reopen先原子持久化collecting：外层seal null、全部sealed hash null、rejected submitted hash null、其它submitted hash不变；之后才清理rejected私有字节。正式闭包、metadata和marker在该路径零写。只有completed receipt的final/artifact/commit paths构成可提交闭包。

### 19.7 验收

UT-S39-56～58、ST-S39-27与SMOKE-core-160～162必须覆盖歧义after、metadata drift、多target归因、legacy fixture、崩溃窗口、残留私有字节和RunLogos真实事务。
