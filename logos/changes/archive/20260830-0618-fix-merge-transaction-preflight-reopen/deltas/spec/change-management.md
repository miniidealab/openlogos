## ADDED — Merge Transaction Preflight、局部 Reopen 与确认点

### 状态机补充

```text
ready --preflight pass--> sealed --identity pass--> applying --> completed
  ^                          |
  |                          +-- legacy attributable preflight fail
  +---- rejected slots missing -------------------------------+
```

新事务preflight失败时不形成sealed；legacy sealed只在首写前、错误可唯一归因到Agent slots时退回collecting。公共phase/action/classification集合不变。

### 结构化归因

validator/producer内部错误必须携带稳定code、canonical target paths、producer、retryable。归因只使用冻结target→slot map；message仅供人读。全部错误都在可修复allowlist且全部target唯一映射到Agent slots才可reopen。混合、未知、OpenLogos producer、contract/schema/plan/source/before/seal/path/internal invariant整体fatal，一个slot也不清。

### Reopen 提交点

1. 复核无apply journal/staging/backup、receipt、marker、正式新字节或before drift。
2. 内存构造collecting snapshot，清外层seal、全部sealed hashes和rejected content hashes。
3. durable temp+fsync+atomic rename替换transaction；此后才能返回retryable。
4. best-effort清rejected私有content/staging；残留非权威，status/next不得扫描。

这是一项单文件原子状态转换加可重放垃圾回收，不声称跨文件删除原子。rename前崩溃保留完整sealed；rename后崩溃保留完整collecting。

### Legacy 与不可逆边界

0.14.1 sealed且无preflight record的事务可在apply首写前ephemeral检查。pass沿用legacy seal；fail可reopen并在修正后生成新seal。applying/journal后只recover/rollback；completed幂等，不迁移。

### 消费者动作

retryable error后消费者读取status/next的missing slots，只重提这些slots，再seal/apply。不得写正式target或transaction私有制品，不得abort重建规避validator。status/next/error envelope从持久化projection同源。

### 人类确认点

`PLAN_APPROVED`只消费plan-exit并允许Delta。merge、verify、部署、smoke、RunLogos继续merge、archive、公开发布、git push各自需要明确授权；proposal/tasks/decision/Skill不能自授权。用户显式选择`next --auto`时才有全链路standing语义，且loop-exhausted红线不变。

### 测试与Reporter

新增UT/ST必须是独立可失败断言并写OpenLogos reporter；不得只把UT-S05-36、UT-S09-239、UT-S11-63等ID拼接到happy-path测试名。部署与smoke继续执行各自报告门。
