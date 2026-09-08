# Delta: core-S33-test-cases.md

> change: lite-cut3a-degate-clarification-ui-seed
> 目标：`logos/resources/test/core-S33-test-cases.md`

seed 恢复门由「不可恢复即硬阻塞」改为「隔离损坏 journal 后继续」（§2.74.3）。**只改损坏分支**：第七节的读锁有界重试与 reader 串行化用例断言的是锁竞争这一真实瞬态条件，一律不动。

## MODIFIED — 一、单元测试用例


| 用例 ID | 名称 | 覆盖点 | 前置 | 输入 | 期望 |
|---|---|---|---|---|---|
| UT-S33-01 | adopt 写入 baseline_seed_state:required（枚举非布尔） | adopt 逻辑 | 空 logos/ | 执行 adopt | `logos-project.yaml` 模块含 `baseline_seed_state: required`；无布尔 `baseline_seed_required` 字段 |
| UT-S33-02 | adopt 不产逆向内容 | adopt 逻辑 | 空 logos/ | 执行 adopt | `logos/resources/` 无逆向产物；未调用任何 AI |
| UT-S33-03 | 章节 candidates[] 解析（一文档多候选） | provenance 解析 | 一份含 3 个候选的逆向产物 | 解析章节 | 提取 3 个候选，各自 `key`/`state`；provenance 由 `state` 派生（非独立字段，无 human-verified 分支） |
| UT-S33-05 | 覆盖率 tombstone 计数：删除候选不缩小 | 覆盖率计算 | active=5，重扫删除 1 候选 | 重算覆盖率 | 被删候选转 `state:tombstone` 仍计入 `denominator`，`denominator` 仍=5、计数不缩小（不虚增） |
| UT-S33-07 | 稳定键 alias 继承（重命名不新建候选） | 稳定键 | 候选锚点重命名 | 重扫 | 旧 anchor 进 `aliases[]`，同一 `key`，候选数不增 |
| UT-S33-08 | 规范键为 hash 形式 | 稳定键 | 锚点 `cli:adopt` | 计算 key | `key == <module>::<sha256(normalize(anchor))[:12]>`；slug 只进 `anchor`/`display` |
| UT-S33-09 | 派生索引 stale 时降级（source_hash 覆盖整章节） | 覆盖率呈现 | 候选正文变但索引 `source_hash` 未更新 | 读覆盖率 | 重算章节 hash≠索引 hash → 输出 `stale`，不输出精确计数结论 |
| UT-S33-10 | 零候选报 n/a | 覆盖率计算 | `active∪tombstone`=0 | 重算 | `denominator`=0、覆盖率 `n/a`，不报 100%/0% |
| UT-S33-11 | tombstone 仅废弃才 retired 移出计数 | 覆盖率计算 | 1 个 tombstone 候选 | 废弃（写事件日志） | 候选 `state:retired`，移出 `denominator`；`denominator`-1、记 `retire_event_id`；未废弃前始终计入 |
| UT-S33-13 | 合并/拆分 superseded_by 继承 | 稳定键 | 两候选合并为一 | 重扫 | 旧 key 保留 `state:tombstone` + `superseded_by`=新 key；新 key 登记 |
| UT-S33-14 | 扫描器版本升级 migration map 继承旧 key | 迁移映射 | scanner v1→v2，事件日志 scanner-migrate | 应用迁移 | 可继承者沿用旧 key；无对应新 key 者旧 key 转 tombstone；迁移成功/失败均留痕 |
| UT-S33-15 | 存量迁移缺章节标 unknown | migrate-lifecycle | 老文档缺 `## 逆向基线来源` | 迁移回填 | provenance 派生 `unknown`/`legacy-unclassified`；不生成 candidates[]、不推断 reverse-engineered |
| UT-S33-16 | 存量迁移幂等 + 布尔兼容 | migrate-lifecycle | 已迁移项目 / 旧布尔 `baseline_seed_required:true` | 再次迁移 / 读取 | 结果不变，写前备份存在；旧布尔 `true` 映射为 `baseline_seed_state: required` |
| UT-S33-17 | verify 对逆向 spec 不产软告警、JSON 无 baseline_warnings（确认机制移除反向回归） | verify | 主文档候选 `verified=false` | `verify --format json` | verify **不输出**现状基线/未确认逆向的软告警文本，JSON **不含** `baseline_warnings` 字段；verify gate 结果**不受**基线逆向候选影响（不软告警、不硬失败） |
| UT-S33-18 | begin 冻结逻辑计划（无 hash）+ 建 staging | baseline-seed 命令 | 有效逻辑计划 `{kind,target_path,candidate_keys}`（含必需 kind） | `baseline-seed begin --module --manifest` | 返回 `run_id`；建 `baseline-seed-runs/<run_id>/staging/`；持久化 run 记录；不下调 `baseline_seed_state`（begin 无内容 hash） |
| UT-S33-19 | commit 对 staged 字节校验 + 全部合法 → seeded | baseline-seed 命令 | 全部产物 staged 且 schema/hash 合法、必需 kind 齐 | `baseline-seed commit --run-id` | 原子提交 staged 到目标；写 `seeded`；`missing/invalid` 空 |
| UT-S33-20 | commit 部分 staged → partial（不提交不完整集合） | baseline-seed 命令 | manifest N 个，仅 M(<N) staged | `baseline-seed commit --run-id` | 写 `partial`；`committed`=M、`missing`=N-M；绝不 `seeded`；不提交不完整集合为权威 |
| UT-S33-21 | 缺必需 kind 的 manifest 被 begin 拒 | baseline-seed 命令 | 少报 manifest（缺 `system-map` 或 `scenario-candidates`） | `baseline-seed begin` | 非零退出 `missing_required_kind`；无法凭单项走到 seeded |
| UT-S33-22 | target_path 路径逃逸被拒 | baseline-seed 命令 | manifest 含绝对路径/`..`/符号链接/重复路径 | `baseline-seed begin` | 非零退出 `path_escape`；不建 run |
| UT-S33-23 | candidate_keys 与 staged candidates[] 不一致被拒 | baseline-seed 命令 | staged 文档 `candidates[]` key 集与 manifest `candidate_keys` 不符 | `baseline-seed commit` | 非零退出 `candidate_key_mismatch`；不写状态、不提交 |
| UT-S33-24 | commit 幂等（同 run 依 staging 重算一致） | baseline-seed 命令 | 已 commit 的 run | 再次 `commit --run-id` | 依 staging 重算、状态与分类一致、不重复计数 |
| UT-S33-25 | commit 拒绝 stale/未知/并发 run | baseline-seed 命令 | run superseded / run_id 未知 / 同模块并发 | `commit --run-id` | 非零退出 `stale_run`/`unknown_run`/`run_locked`；不写 `baseline_seed_state`、不提交 |
| UT-S33-26 | 产物 schema 非法计入 invalid、不进 seeded | baseline-seed 命令 | 某 staged 产物缺 `## 逆向基线来源`/candidates[] 非法 | `commit --run-id` | 该产物入 `invalid`；不满足全部合法 → 不 `seeded`（`partial` 或保持） |
| UT-S33-27 | 从 partial 重新 begin 不回退 required | baseline-seed 命令 | 模块 `partial`，发起新 `begin` | `baseline-seed begin` | 旧 run `superseded`、`baseline_seed_state` 保留 `partial`（不回 `required`），至新 run 首次有效 commit 才转 |
| UT-S33-28 | journal prepared 后崩溃 → 回滚（全旧） | commit journal（F10） | 崩溃点：journal=`prepared`、无目标已改 | 重跑 `commit`/恢复 | 目标全旧、索引匹配旧集合、`baseline_seed_state` 不变；journal 可丢弃 |
| UT-S33-29 | committing 中途崩溃 + staging 完好 → 前滚（全新+seeded） | commit journal（F10） | 崩溃点：部分目标已 rename、staging 齐全 | 重跑 `commit`/恢复 | 补齐未 applied 目标 + 索引 + 状态 → 全新集合、`seeded`、journal `committed` |
| UT-S33-30 | committing 中途崩溃 + staging 缺失 → 回滚（全旧） | commit journal（F10） | 崩溃点：部分目标已 rename、staging 丢失 | 重跑 `commit`/恢复 | 按 `backup/`+`old_sha256` 还原已 applied 目标 → 全旧集合、状态保持 `partial`/prior |
| UT-S33-31 | 逐故障点：恢复后全旧或全新 + seeded⇔完整新集合 | commit journal（F10） | 故障注入：prepared 后/各目标 rename 前后/backup-move 与 rename 之间/索引更新前后/写状态前后/标 committed 前 | 各磁盘态经恢复门恢复后断言 | 恢复后目标集合全旧或全新、索引与集合匹配、`seeded` 当且仅当完整新集合在盘 |
| UT-S33-32 | 半提交 run 被新 begin supersede 的恢复顺序 | commit journal（F10） | run A 处 `committing`（未终结 journal），发起 run B `begin` | `baseline-seed begin`(B) | begin(B) 先在锁内跑 A 的前滚/回滚到一致态，再 supersede A；不在半提交态叠新 run |
| UT-S33-33 | 读取门：committing 期间机器消费者先恢复；不可恢复则隔离 journal 后继续 | 读取门（F10 R5） | 模块存在未终结 journal（committing），执行 `status`/`next`/覆盖率重算/index 扫描 | 任一读取命令 | 读取者持模块级事务锁检测到未终结 journal → **先恢复**，否则返回 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留；**不把可能半新的目标集合当权威**（不据其算覆盖率/报 seeded） |
| UT-S33-34 | prior=seeded 重扫 committing 崩溃后先读不暴露半新/不报 seeded | 读取门（F10 R5） | 重扫 commit 使 prior `seeded`→新集合，committing 期间崩溃，随后**先**执行读取命令 | `status`/`next`/覆盖率重算 | 读取门拦截：不把半新集合当权威、不复用旧 `seeded`；恢复后才落定全旧/全新；断言在「恢复触发前首次读取」边界 |
| UT-S33-35 | 恢复按 old/new hash 逐目标重判态 + 进度原子写 | commit journal（F10 R5） | 崩溃点：目标已 rename 但 `applied` 未持久化 / backup-move 后 rename 前 / journal 进度写入中断 | 恢复 | 恢复不只依 `applied` 列表，而按每目标 on-disk hash 与 journal old/new 重判态；`applied` 与 journal 阶段切换本身以临时文件+rename 原子写入 |
| UT-S33-36 | 派生索引旧值 backup/hash 使回滚可执行 | commit journal（F10 R5） | `committing`+staging 缺失回滚 | 恢复回滚 | journal 记录旧索引 hash/backup，回滚后「索引匹配旧集合」可由该来源执行、可断言 |


## MODIFIED — 五、legacy 缺省语义三入口统一（baseline-seed-legacy-default-unify）


### 5.1 单元测试用例

| ID | 描述 | 前置条件 | 输入 | 预期输出 |
|----|------|---------|------|---------|
| UT-S33-41 | 三入口一致性：legacy 无候选 → required，默认 change 可达 | legacy 夹具：`bootstrap: adopted`、yaml 无 `baseline_seed_state` 也无旧布尔、`logos/resources/` 无逆向候选、无 guard、无未终结 journal | 依次运行 `next --format json`、`status --format json`、`baseline-seed status --module core --format json` | 三入口正常成功态的有效 state 逐字节一致=`required`；next 主动作是 `openlogos change <slug>`，可附 legacy sync/显式 seed 提示；无任何 `unknown` 输出 |
| UT-S33-42 | 三入口一致性：legacy 有候选（无 open run）→ seeded | legacy 夹具 + 一份含合法可重算候选的逆向产物（已合并主文档）、无 open run record、无未终结 journal | 同 UT-S33-41 三命令 | 三入口正常成功态的有效 state 逐字节一致=`seeded`；status/next 引导正常 `openlogos change`（不展示覆盖率人读行） |
| UT-S33-43 | legacy 有候选 + open run → 安全 partial，默认 change 可达 | legacy 夹具 + 合法候选 + 同模块存在 `status: open` 的 baseline-seed run record，但无 `prepared`/`committing` journal | 同 UT-S33-41 三命令 | 三入口正常成功态的有效 state 逐字节一致=`partial`，`incomplete=true`；next 主动作是 change，seed commit/begin 只作非阻断 recovery advisory |
| UT-S33-44 | sync 迁移落盘：两档派生值写入显式枚举 + changes 记录派生依据 | 两个 legacy 夹具：①无候选；②有候选无 open run；均无未终结 journal | 各自运行 `openlogos sync` | ①yaml 落 `baseline_seed_state: required`、changes 记录含「缺省 → required（派生：无逆向候选）」；②落 `seeded`、记录含派生依据；再跑一次 sync 无重复变更（幂等） |
| UT-S33-45 | sync 迁移不覆盖显式值 + 历史布尔迁移不回归 | ①模块已有显式 `baseline_seed_state: partial`；②模块只有旧布尔 `baseline_seed_required: true`；③只有 `baseline_seed_required: false`；均无未终结 journal | 各自运行 `openlogos sync` | ①显式值保持 `partial` 不被派生覆盖；②布尔迁移为 `required`；③移除布尔后按无字段走派生落盘（不再空转） |
| UT-S33-46 | 正常成功契约：adopted 模块 status JSON 恒含合法枚举 | adopted 模块矩阵：explicit required/partial/seeded、legacy 有候选、legacy 无候选；另一非 adopted 模块；恢复门均通过 | `status --format json` | 正常成功 envelope 中，每个 adopted 模块 `modules[].baseline_seed_state` 均存在且属于 `required｜partial｜seeded`；非 adopted 模块输出与本变更前逐字节一致 |
| UT-S33-47 | 不可恢复 journal 在 legacy 缺字段时先于状态派生完成隔离 | legacy 夹具（无字段）+ journal=`prepared|committing`，故障注入使前滚/回滚均失败；对 candidate/run/index/coverage/helper 设置读取哨兵 | `status --format json` | 非零返回 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留 通用 error envelope；只含最小安全 module/run/journal 诊断，不输出正常 `data.modules[]`、`baseline_seed_state`、coverage 或 suggestion；所有派生读取哨兵为 0 |
| UT-S33-48 | 回归：正常 JSON 无 unknown，错误分支不伪造枚举 | 覆盖 UT-S33-41…47 全部夹具 | 三命令 JSON 输出全集 | 恢复门通过的正常输出不含 `baseline_seed_state:unknown`；恢复失败输出错误 envelope 且不猜测 `required｜partial｜seeded`；实现侧私有缺省规则清零，唯一正常派生规则仍在共享 helper 内 |

### 5.2 覆盖度校验
- [ ] 三入口一致性两档夹具（无候选→required / 有候选→seeded），且默认 change 可达：UT-S33-41、UT-S33-42
- [ ] 有候选 + open run → 安全 partial，主动作 change、seed 恢复旁路：UT-S33-43
- [ ] sync 迁移两档落盘 + 派生依据 + 幂等：UT-S33-44
- [ ] 显式值不覆盖 + 布尔迁移不回归：UT-S33-45
- [ ] adopted 正常成功恒输出契约（含非 adopted 零漂移）：UT-S33-46
- [ ] 不可恢复 journal + legacy 缺字段在任何状态派生前硬错误、零读取：UT-S33-47
- [ ] 正常输出无 unknown + 错误分支不伪造枚举 + 私有缺省规则清零：UT-S33-48


## MODIFIED — 六、eager seed 可选化与 S39 证据接口测试


> 所有用例实现必须写入 OpenLogos reporter `logos/resources/verify/test-results.jsonl`。

### 6.1 单元测试

| ID | 检查项 | 输入 | 期望 |
|---|---|---|---|
| UT-S33-49 | required 不阻断首个 change | state=required、无 seed 目标 | 目标集直接由 deltas 派生，规划与合并均可完成 |
| UT-S33-50 | 安全 partial staging 排除 | state=partial、staging 含完整-looking 文档、无未终结 journal | staging 不进入 merge 目标集，也不使同名 canonical target 判为已存在；change 可继续 |
| UT-S33-51 | seeded 只作加速 | state=seeded、candidate 指向触达代码 | candidate 仅供人定位现状；正式目标缺失时仍派生为 CREATE，不因 seeded 而略过 |
| UT-S33-52 | stale committed seed 降级 | source_hash 不匹配 | 忽略 stale 精确结论、回退重算；change 不阻断 |
| UT-S33-53 | seed state 不决定 action | required/安全 partial/seeded 参数化，且无未终结 journal或恢复成功 | 三态的无提案默认 action 均可创建 change；仅可选诊断不同 |
| UT-S33-54 | 无确认字段写入 | 任意 seed + on-touch change | 输出无 verified:true、confirmed_by、confirmed_at、baseline_warnings |
| UT-S33-55 | 未终结 journal 恢复失败即隔离留存 | 参数化崩溃点：prepared、逐目标 rename、index/state 写入前后；恢复素材损坏 | 每个消费者先取锁恢复；无法恢复返回 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留，resources/index/coverage/EvidenceScanner 读取计数为 0 |

### 6.2 场景测试

| ID | 场景 | 操作 | 期望 |
|---|---|---|---|
| ST-S33-05 | 完全跳过 seed 完成首个 change | adopted required → 直接 change → 规划并合并 | 全链路可达；缺失目标由 delta 派生为 CREATE；seed state 保持兼容值不被 change 流程改写 |
| ST-S33-06 | 安全 partial run 与 change 并存 | begin 后只写部分 staging、未进入 journal，再创建 change | staging 既不进入 merge 目标集、也不被当作「目标已存在」；change 正常推进；run 后续仍可恢复/提交 |
| ST-S33-07 | seeded candidate 首次转正式场景 | committed candidate、正式场景文档缺失 | 正式目标缺失时仍派生为 CREATE，seeded 不能让它变成「已存在」；candidate verified 不变 |
| ST-S33-08 | 旧确认机制反向回归 | fixture 含 verified:false 候选，执行 plan/spec/verify 消费路径 | 无 JIT advisory、无确认写回、无 baseline warning、门结果不受 verified 影响 |
| ST-S33-09 | commit journal 崩溃点故障注入 | 对多目标+index+state 事务逐崩溃点中断，分别验证可前滚、可回滚与不可恢复夹具（隔离后继续） | 可恢复夹具落定全旧/全新；不可恢复夹具（隔离后继续）对 status/next/index/sync/S39 全部硬报 **零退出并告警**；损坏 journal 重命名为 `<run>.commit-journal.corrupt-<时间戳>.json` 且内容逐字节保留，不读半新、不写迁移、不创建 change 产物 |

### 6.3 保留契约回归

- baseline-seed begin/commit/status、路径安全、candidate key 对账、锁、journal 恢复、partial→seeded 事务测试继续全绿；新增断言明确 safe partial 与未终结 journal 不共享降级分支。
- status/next 的 `baseline_coverage` 兼容 shape 不删除；改变的是它不再决定主 action。
- tombstone 分母、legacy 缺省派生与 sync 显式回填规则保持；S39 不新建每场景闭包状态。

