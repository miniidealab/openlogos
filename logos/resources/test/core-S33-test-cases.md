# S33: 存量项目逆向建种子基线 — 测试用例

## 一、单元测试用例

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
| UT-S33-33 | 读取门：committing 期间机器消费者先恢复或 baseline_commit_in_progress | 读取门（F10 R5） | 模块存在未终结 journal（committing），执行 `status`/`next`/覆盖率重算/index 扫描 | 任一读取命令 | 读取者持模块级事务锁检测到未终结 journal → **先恢复**，否则返回 `baseline_commit_in_progress`；**不把可能半新的目标集合当权威**（不据其算覆盖率/报 seeded） |
| UT-S33-34 | prior=seeded 重扫 committing 崩溃后先读不暴露半新/不报 seeded | 读取门（F10 R5） | 重扫 commit 使 prior `seeded`→新集合，committing 期间崩溃，随后**先**执行读取命令 | `status`/`next`/覆盖率重算 | 读取门拦截：不把半新集合当权威、不复用旧 `seeded`；恢复后才落定全旧/全新；断言在「恢复触发前首次读取」边界 |
| UT-S33-35 | 恢复按 old/new hash 逐目标重判态 + 进度原子写 | commit journal（F10 R5） | 崩溃点：目标已 rename 但 `applied` 未持久化 / backup-move 后 rename 前 / journal 进度写入中断 | 恢复 | 恢复不只依 `applied` 列表，而按每目标 on-disk hash 与 journal old/new 重判态；`applied` 与 journal 阶段切换本身以临时文件+rename 原子写入 |
| UT-S33-36 | 派生索引旧值 backup/hash 使回滚可执行 | commit journal（F10 R5） | `committing`+staging 缺失回滚 | 恢复回滚 | journal 记录旧索引 hash/backup，回滚后「索引匹配旧集合」可由该来源执行、可断言 |

## 二、场景测试用例

### 2.1 主路径
| 用例 ID | 名称 | 覆盖步骤 | 前置 | 输入 | 期望 |
|---|---|---|---|---|---|
| ST-S33-01 | adopt 后 AI driver 经 baseline-seed 两阶段建种子基线（真实 begin→生成→commit 主路径） | Step 4→9 | adopt 完成、`baseline_seed_state:required` | driver `baseline-seed begin`（逻辑计划含必需 kind）→ 派发 skill 写 staging → `baseline-seed commit` | 产出 system-map + 场景候选清单（含 candidates[]）写入 staging；commit 对 staged 字节校验、必需 kind 齐+全部合法 → 原子提交 + `seeded`；展示「现状基线已建立」引导（**不含覆盖率人读行**，无 `逆向候选`/`tombstone` 字样）；skill/driver 未直接改 YAML、未直接写目标目录 |
| ST-S33-04 | 扫描中断→partial→重试→seeded 恢复闭环 | EX-6.1/6.4 | begin 后仅部分产物落盘 | `commit`（partial）→ 补齐产物 → 再 `commit` | 首次 commit 写 `partial`、`next`/`status` 指向恢复入口且一致；补齐后再 commit 写 `seeded`；全程状态仅由 CLI 写 |

### 2.2 异常路径
| 用例 ID | 名称 | 覆盖点 | 前置 | 输入 | 期望 |
|---|---|---|---|---|---|
| ST-S33-EX-01 | CLI-only 不伪造基线 | EX-4.1 | 无可用 AI 会话 | adopt | 保持 `baseline_seed_state:required`，输出可复制提示，不显示已建立 |
| ST-S33-EX-02 | 扫描失败可重试不回滚 | EX-6.1 | 扫描中途失败 | 重试 | `baseline_seed_state:partial`；重扫按候选 `key` 覆盖；`logos/` 不回滚 |
| ST-S33-EX-04 | verify 对逆向 spec 无软告警且不硬失败（确认机制移除反向） | EX-15.1 | `verified=false` 逆向 spec | verify | 无现状基线软告警、JSON 无 `baseline_warnings`、不硬失败；verify gate 结果与基线逆向候选无关 |
| ST-S33-EX-05 | 存量 provenance 保守迁移 | EX-15.2 | 老文档缺章节 | 迁移 | 派生 `unknown`/`legacy-unclassified`，不伪造、不降级 |

## 三、覆盖度校验
- [x] adopt 写枚举状态、不产逆向内容：UT-S33-01/02
- [x] 一文档多候选 candidates[] 解析 + provenance 派生：UT-S33-03
- [x] tombstone 计数不虚增 + 零候选 n/a + retire 移出计数 + 合并拆分 + 迁移 + hash 漂移：UT-S33-05/09/10/11/13/14
- [x] 规范键 hash + alias 继承：UT-S33-07/08
- [x] 存量迁移保守 + 幂等 + 布尔兼容：UT-S33-15/16、ST-S33-EX-05
- [x] verify 对逆向 spec 不产软告警、JSON 无 baseline_warnings（确认机制移除反向回归）：UT-S33-17、ST-S33-EX-04
- [x] AI driver 唯一 producer + 降级不伪造：ST-S33-01、ST-S33-EX-01/02
- [x] baseline-seed 两阶段协议（begin 逻辑计划无 hash/staging、必需 kind、路径安全、candidate_keys 一致、commit 幂等/stale/并发/schema/少报不误判/partial 不回退）：UT-S33-18…27、ST-S33-01、EX-6.2/6.3
- [x] 多文件 commit journal 崩溃一致性 + 读取门（prepared 回滚 / committing 前滚·回滚 / 逐故障点恢复后不变量 / 半提交 supersede / 读取门 committing 先恢复或 baseline_commit_in_progress / prior=seeded 重扫先读不暴露半新 / old·new hash 逐目标重判 + 进度原子写 / 索引旧值 backup 回滚可执行）：UT-S33-28…36、EX-6.5（架构 §4.4）
- [x] partial 恢复态 next/status 一致 + 活跃提案优先级（EX-3.4 无提案 / EX-3.5 有提案互斥）+ 重试闭环：ST-S33-04、EX-6.4（并见 core-S05 UT-S05-B05…B08、ST-S05-B02/B03）

## 四、provenance 扫描侧 alias-aware canonical 采信（provenance-scan-canonical-recompute）

> 测试边界：只读、纯函数级——直接对 `scanModuleCandidates` / `listModuleProvenanceDocs` / `computeCoverage` / `buildBaselineCoverage` 断言；扫描器采信判据 = `key === candidateKey(module, anchor)` 或 `key === candidateKey(module, alias∈aliases)`（与写侧 `baseline-seed` 同强度）。

### 4.1 单元测试用例

| ID | 描述 | 前置条件 | 输入 | 预期输出 |
|----|------|---------|------|---------|
| UT-S33-37 | 扫描侧排除不可重算候选（格式合法、hash 失配的示例/编造 key） | 某文档 `## 逆向基线来源` 含候选 `key` 前缀 `core::` 且格式合法（`<module>::<12hex>`），但 `key !== candidateKey('core', anchor)`（教学编造，如 `core::a1b2c3d4e5f6` / anchor `cli:baseline-seed-commit`） | `scanModuleCandidates(root,'core')` / `listModuleProvenanceDocs(root,'core')` | 该候选**不出现**在 `scanModuleCandidates().candidates`；持有它的文档**不出现**在 `listModuleProvenanceDocs()`；`isCanonicalKey` 对该 key 返回 `true`（证明格式校验不足、必须重算） |
| UT-S33-38 | alias-aware：改名继承 / tombstone 合法候选仍被采信 | ①改名候选：`key === candidateKey('core', 旧anchor)`、当前 `anchor` 为新值、`aliases` 含旧 anchor；②多级改名 A→B→C：`key===candidateKey('core',A)`、`aliases` 含 A、B；③`tombstone` 候选 `key===candidateKey('core',自身anchor)` | `scanModuleCandidates(root,'core')` | 三类候选**均被采信**（出现在 candidates）——判据取「当前 anchor ∪ aliases 任一可重算命中」，不因当前 anchor≠key 派生源而误杀 |
| UT-S33-39 | 含示例章节的无关文档不污染覆盖率计数 / aggregate_hash / freshness | 一真实基线（若干合法可重算候选）+ 另一文档含 `## 逆向基线来源` 示例章节（不可重算候选） | `computeCoverage(scanModuleCandidates(...).candidates)` 与 `buildBaselineCoverage(...)` | 覆盖率 `denominator`/`tombstones` 与「无示例文档时」**深相等**（幽灵候选不进计数）；`aggregate_hash` 不含示例文档 → 改动/删除该示例文档**不改变** hash、`freshness` 不被打成 `stale` |
| UT-S33-40 | 采信收紧不改合法基线数值（回归零漂移） | 纯合法基线项目（全部候选可重算，含 active/tombstone 混合） | 采信收紧前后 `scanModuleCandidates` + `computeCoverage` | 候选集合、`aggregate_hash`、覆盖率各字段（`denominator`/`tombstones`）**逐字节/深相等**——本次收紧只排除不可重算幽灵候选，对合法候选零影响 |

### 4.2 覆盖度校验
- [ ] 扫描侧只采信可重算规范键、排除格式合法 hash 失配的示例 key：UT-S33-37
- [ ] alias-aware 保留改名继承 / 多级改名 / tombstone 合法候选：UT-S33-38
- [ ] 示例文档不污染覆盖率分母 / aggregate_hash / freshness：UT-S33-39
- [ ] 合法基线采信收紧零漂移：UT-S33-40

## 五、legacy 缺省语义三入口统一（baseline-seed-legacy-default-unify）

### 5.1 单元测试用例

| ID | 描述 | 前置条件 | 输入 | 预期输出 |
|----|------|---------|------|---------|
| UT-S33-41 | 三入口一致性：legacy 无候选 → required（核心防复发） | legacy 夹具：`bootstrap: adopted`、yaml 无 `baseline_seed_state` 也无旧布尔、`logos/resources/` 无逆向候选、无 guard | 依次运行 `next --format json`、`status --format json`、`baseline-seed status --module core --format json` | 三入口有效 state **逐字节一致** = `required`；next 给「建立现状基线」大白话引导；三者均附 legacy sync 迁移提示；无任何 `unknown` 输出 |
| UT-S33-42 | 三入口一致性：legacy 有候选（无 open run）→ seeded | legacy 夹具 + 一份含合法可重算候选的逆向产物（已合并主文档）、无 open run record | 同 UT-S33-41 三命令 | 三入口有效 state **逐字节一致** = `seeded`；status/next 引导正常 `openlogos change`（**不展示覆盖率人读行**） |
| UT-S33-43 | legacy 有候选 + open run → partial（与状态机「扫描中断」对齐） | legacy 夹具 + 合法候选 + 同模块存在 `status: open` 的 baseline-seed run record | 同 UT-S33-41 三命令 | 三入口有效 state **逐字节一致** = `partial`；`incomplete=true`；引导指向恢复入口（无 guard 前提） |
| UT-S33-44 | sync 迁移落盘：两档派生值写入显式枚举 + changes 记录派生依据 | 两个 legacy 夹具：①无候选；②有候选无 open run | 各自运行 `openlogos sync` | ①yaml 落 `baseline_seed_state: required`、changes 记录含「缺省 → required（派生：无逆向候选）」字样；②落 `seeded`、记录含派生依据；再跑一次 sync 无重复变更（幂等） |
| UT-S33-45 | sync 迁移不覆盖显式值 + 历史布尔迁移不回归 | ①模块已有显式 `baseline_seed_state: partial`；②模块只有旧布尔 `baseline_seed_required: true`；③只有 `baseline_seed_required: false` | 各自运行 `openlogos sync` | ①显式值保持 `partial` 不被派生覆盖；②布尔迁移为 `required`（既有行为不回归）；③移除布尔后按无字段走派生落盘（不再「不推断」空转） |
| UT-S33-46 | 契约恒输出：adopted 模块 status JSON 恒含合法枚举 | adopted 模块矩阵：explicit required/partial/seeded、legacy 有候选、legacy 无候选；另一非 adopted 模块 | `status --format json` | 每个 adopted 模块 `modules[].baseline_seed_state` 均存在且 ∈ `required｜partial｜seeded`（explicit 或派生值）；非 adopted 模块输出与本变更前逐字节一致 |
| UT-S33-47 | commit-in-progress 降级分支仍恒输出（legacy 无字段） | legacy 夹具（无字段）+ 模块事务锁被占用 / 未终结 journal（模拟提交进行中） | `status --format json` | 走 `baseline_commit_in_progress` 降级 suggestion，但 `modules[].baseline_seed_state` **仍存在**且为合法枚举（派生兜底），不因原始字段缺失而缺字段 |
| UT-S33-48 | 回归：unknown 不再出现于任何 JSON 输出 + 私有缺省规则清零 | 覆盖 UT-S33-41…47 全部夹具 | 三命令 JSON 输出全集 | 任何 JSON 序列化结果不含 `"baseline_seed_state":"unknown"`（或任何 `unknown` 状态值）；实现侧验收锚：`grep "baseline_seed_state ??"` 与 `grep "readSeedState(.*) ??"` 在 `cli/src/` 清零（唯一缺省规则在共享 helper 内） |

### 5.2 覆盖度校验
- [ ] 三入口一致性两档夹具（无候选→required / 有候选→seeded）：UT-S33-41、UT-S33-42
- [ ] 有候选 + open run → partial 与状态机对齐：UT-S33-43
- [ ] sync 迁移两档落盘 + 派生依据 + 幂等：UT-S33-44
- [ ] 显式值不覆盖 + 布尔迁移不回归：UT-S33-45
- [ ] adopted 恒输出契约（含非 adopted 零漂移）：UT-S33-46
- [ ] commit-in-progress + legacy 降级分支恒输出：UT-S33-47
- [ ] unknown 废除回归 + 私有缺省规则清零：UT-S33-48
