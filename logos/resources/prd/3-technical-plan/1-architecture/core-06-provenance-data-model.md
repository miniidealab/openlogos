# core-06-provenance-data-model

存量项目逆向建基线（brownfield-adopter）的 provenance、候选与覆盖率数据模型。目标：用**现行 delta 协议可表达**、且**可序列化/可重算**的结构记录「哪些现状是逆向推断、哪些已人工确认」，并给出可计算、不虚增的覆盖率。

## 一、权威载体：文档内具名章节 `## 逆向基线来源` + `candidates[]` 注册表

- 每份逆向产物内含一个具名章节 `## 逆向基线来源`，是 provenance 与候选的**唯一权威载体**。选具名章节而非 YAML frontmatter：`MODIFIED` delta 的可寻址/替换单位是「同名章节」，把整章节（含 `candidates[]`）作为一个 `MODIFIED` 原子替换，无需扩展 merge 协议。
- **一文档可含 N 个候选**（`场景候选清单` 天然多候选）：候选状态存于章节内的 `candidates[]` 注册表（fenced YAML），而非文档级单值。章节示例：

  ```markdown
  ## 逆向基线来源
  ```yaml
  # 本章节整体为覆盖率与 provenance 的权威源；source_hash 覆盖本整段内容
  candidates:
    - key: "core::9f2a4c7b1e83"     # 规范键：<module>::<sha256(normalize(anchor))[:12]>
      anchor: "cli:adopt"           # 规范化前的语义锚点（命令名/导出入口符号/路由），仅供人读
      display: "adopt 命令建基线"    # 展示名，可选
      state: active                 # active | tombstone | retired
      verified: false               # 残留字段（恒 false；确认概念已删除，不再被 provenance 派生或覆盖率读取，见下「删除说明」）
      aliases: []                   # 重命名/移动锚点时追加旧 anchor，匹配不新建候选
      superseded_by: []             # 合并/拆分时旧键指向新键（可多）
      confirmed_by: null            # 残留字段（恒 null，确认机制已删除）
      evidence: null                # 残留字段（恒 null，确认机制已删除）
      confirmed_at: null            # 残留字段（恒 null，确认机制已删除）
      retired_by: null              # state:retired 时的废弃者审计
      retire_event_id: null         # 指向事件日志条目
  ```
  ```

- **provenance 为派生值、非独立存储**（单一可信来源，消除双状态）：`provenance` 不落盘，由 `state` 派生——`state∈{active,tombstone}` ⇒ `reverse-engineered`；候选/章节缺失 ⇒ `unknown`/`legacy-unclassified`。**不再有 `human-verified` provenance 值**（确认机制已删除，`deriveProvenance` 不再读 `verified`）。任何读取方按此单一规则派生，不存在第二个 provenance 真相源。
- **删除说明（drop-coverage-human-verified）**：前序变更 `drop-baseline-confirmation` 删除逆向基线的「人工确认机制」（JIT advisory / verify 软告警 / `verified:false→true` 升级路径）后，曾**冻结保留** `human_verified`（分子）、`human_verified_delta`、`coverage`（比值）等悬空字段（分子恒 0、语义悬空）。因该字段/契约形态**尚未对用户发布、无历史数据、无向后兼容负担**，本变更**干净删除**这些字段（见 §三与 `baseline_coverage` JSON 契约），并删除 `provenance` 的 `human-verified` 派生值——覆盖率退化为纯逆向候选计数。候选章节内 `verified`（恒 `false`）、`confirmed_by`/`evidence`/`confirmed_at`（恒 `null`）作为扫描器写入的**残留字段保留**（不改 `candidates[]` 结构、`source_hash` 算法不变），但**不再被任何 provenance 派生或覆盖率计数读取**；`verified:true ⇒ human-verified` 等历史语义彻底移除、无任何机制路径。

## 一.A、扫描侧候选采信：alias-aware canonical 重算（provenance-scan-canonical-recompute）

> 修复 issue「provenance 扫描器把指南文档里的示例章节当真实候选」。根因 = 读侧（扫描）与写侧（`baseline-seed`）校验强度不对齐。

**问题**：`## 逆向基线来源` 扫描器（`scanModuleCandidates` / `listModuleProvenanceDocs` → `listResourceMarkdown`）递归全扫 `logos/resources/**`，采信候选仅以 `key.startsWith("<module>::")` **前缀匹配**为判据。而 §三「规范键」规定 `key = <module>::sha256(normalize(anchor))[:12]`——前缀匹配**不校验 hash**，故文档/教学示例里"语法真、语义假"的编造候选（`key` 格式合法但与 `anchor` 的重算值对不上，如示例 `core::a1b2c3d4e5f6` 而 anchor `cli:baseline-seed-commit` 真实应为 `core::f48ead911dcf`）会被误当模块真实 provenance 迹象，造成 `feature-backfill` 硬报错与覆盖率分母/freshness 污染。

**不变量（扫描侧采信 = 与写侧同强度的 canonical 重算）**：扫描器采信一个候选为某 module 的权威候选，当且仅当其 `key` **可由该候选的 `anchor` 或任一 `aliases[]` 成员重算得出**：

```
admit(candidate, module) ⇔
    key === candidateKey(module, anchor)
 ∨  ∃ a ∈ aliases[] : key === candidateKey(module, a)
```

- 与写侧 `baseline-seed` 的 `validateSeedCandidate`（`key === candidateKey(module, anchor)`，见功能规格 §2.27.8）**对齐强度、零新约定**：凡能通过写侧落盘的合法候选，读侧必采信；写侧本就会拒的编造 key，读侧也不再采信。
- **必须 alias-aware（否则误杀合法候选）**：由 §三「身份继承」——重命名/移动锚点时旧 anchor 追加进 `aliases[]`、`key` 保持稳定（不随当前 anchor 变）。故改名继承候选满足 `key === candidateKey(module, 旧anchor∈aliases)` 而**非**当前 anchor；合并/拆分产生的 `tombstone`（`superseded_by` 指向新 key）其 `key` 由自身原 anchor 或 alias 可重算。单纯用当前 anchor 重算会误杀这些合法候选，故判据取「anchor ∪ aliases 任一命中」。
- **判据只认 hash 可重算性、不认前缀**：`isCanonicalKey`（格式校验 `<module>::<12hex>`）**不足**——示例 key 格式合法却能过格式校验，必须用 `candidateKey` 重算比对。
- **作用面（读侧全链一致）**：`listModuleProvenanceDocs`（哪些文档持有本 module 候选）与 `scanModuleCandidates`（聚合候选 + `aggregate_hash` + `parse_failed`）均按本不变量过滤；由此 `buildBaselineCoverage`（覆盖率分母/新鲜度）与 `feature-backfill`（候选查询）同源受益：幽灵示例候选不进分母、不进 `aggregate_hash`（含示例章节的无关文档改动不再把 freshness 打成 `stale`）、不触发 `feature-backfill` 误报。
- **不改 `candidates[]` 结构、不改覆盖率口径**：本不变量只收紧「哪些候选被采信」，不新增字段、不改分母法（§三）、不改 provenance 派生（§一）。合法基线项目的覆盖率数值与新鲜度**逐字节不变**。

## 二、派生索引与新鲜度：`logos-project.yaml`

- `logos-project.yaml` 为 provenance/覆盖率的**派生索引（非权威、非唯一持久化源）**，只汇总各文档 `## 逆向基线来源` 章节的 `candidates[]`，沿用既有 index 生成模式。
- 索引每模块携 `source_hash` + 生成时间；`source_hash` = 对该文档 **`## 逆向基线来源` 整章节内容**（含 `candidates[]` 全部字段）的 sha256，**不只覆盖单行横幅**——章节任一候选字段变化即改变 hash。
- 读取新鲜度校验：索引 `source_hash` 与当前文档章节重算 hash 不符 / 索引缺失 / 解析失败 ⇒ `next/status` 输出 `stale`/`unknown`、不输出精确百分比，或按文档权威章节实时重算（`verify` 已与基线候选解耦、不读取覆盖率）。覆盖率**永远可从文档 `candidates[]` 单独重算**，索引仅为缓存加速。

## 三、覆盖率模型：tombstone 分母法（可从文档权威源重算）

- **规范键** `key` = `<module> + "::" + sha256(normalize(anchor))[:12]`；`normalize` = NFKC 归一 + 去首尾空白 + 小写 + 折叠内部空白。`anchor` 取语义标识（CLI 命令名 / 导出入口符号 / 路由），非易变文件路径。**规范值是 hash 形式**（如 `core::9f2a4c7b1e83`）；可读 slug 只能进 `display`/`anchor`，不得作 `key`。
- **身份继承**：重命名/移动锚点 → 旧 anchor 追加进 `aliases[]`，匹配 alias 即同一候选、不新建；合并/拆分 → 旧 key 保留、`state:tombstone` 且 `superseded_by` 指向新 key；扫描器版本升级 → 迁移映射（见下）继承旧 key，无法继承者按新 key 登记、旧 key 转 tombstone。
- **候选三态**：`active`（存活）/ `tombstone`（重扫已消失但未废弃）/ `retired`（已废弃）。
- **候选计数（原「分母」）** = `active ∪ tombstone` 候选数（`retired` **不计入**）。覆盖率**退化为纯逆向候选计数**：只报 `denominator = |active ∪ tombstone|` 与单列 `tombstones`（其中 tombstone 数），**不再有分子（`human_verified`）、不再有 `coverage` 比值/百分比**，按 module 聚合。
- **零候选**：`|active ∪ tombstone| == 0` ⇒ `denominator` 为 `0`、覆盖率报 `n/a`（无候选可计，不报 100%/0%）。
- **不虚增定理**：重扫删除/合并候选只令其 `active→tombstone`（仍计入 `denominator`），计数不因删除而缩小 ⇒ 覆盖度不会因删除候选而虚假变好；`retired` 候选移出计数（合法变化，写事件日志）。`status --format json` 的 `baseline_coverage` **不再输出 `human_verified_delta`**——纯计数下无分子波动可误读。

## 四、状态位、迁移映射与事件日志

### 4.1 模块级种子状态：单一枚举 `baseline_seed_state`
- **唯一字段**（消除布尔/三态自相矛盾）：`logos-project.yaml` 的 `modules[].baseline_seed_state`，枚举 `required | partial | seeded`。**不再使用布尔 `baseline_seed_required`**。
- 取值与转换：
  - `adopt` 确定性初始化写入初值 `required`。
  - `brownfield-adopter` 扫描落盘产物后经 CLI 命令按 manifest 计算：**≥1 但未全** expected 合法 → `partial`；**全部** expected 合法 → `seeded`。
  - 扫描失败 → 保持当前值（`required` 或 `partial`），允许重试；重扫按 `key` 覆盖/清理部分产物，不回滚已初始化的 `logos/`。
- **owner 与唯一写入入口（两阶段 staging）**：字段的原子写入 owner 是 **CLI**，唯一合法**状态推进**路径是命令 `openlogos baseline-seed`（`begin`/`commit`/`status`，见 feature-specs §2.27.8）——`adopt` 写初值 `required`；producer（skill/driver）**不直接改 YAML、也不直接写目标 `logos/resources/`**，只把产物写入 run 私有 staging，经 `commit` 让 CLI 校验后原子提交目标文件与状态。此外 `openlogos sync` 的元数据迁移可对**缺失该字段的 legacy adopted 模块**做一次性回填（见下方「缺省语义」，仅回填缺失字段、不推进状态）。
- **run 记录与完整性权威**：`begin` 提交**逻辑产物计划**（`{ module, expected:[{kind,target_path,candidate_keys[]}] }`，**无内容 hash**——产物字节此刻未生成），CLI 做 schema + 安全校验（**必需 kind 含 `system-map`+`scenario-candidates`**、`target_path` 项目根相对且位于允许基线目录、拒绝绝对路径/`..`/符号链接/重复路径）后签发 `run_id`、建 staging `logos/resources/verify/baseline-seed-runs/<run_id>/staging/`、持久化 run 记录。`commit` 对 **staged 实际字节**算 hash + 校验 schema + 比对 `candidate_keys` 与 staged `candidates[]` 一致，仅在**必需 kind 齐全且全部 expected 合法**时经 **commit journal 事务**（见 §4.4）提交全部目标文件 + 派生索引 + `baseline_seed_state: seeded`；否则 `partial`（不提交不完整集合）。同模块新 `begin` 使旧 run `superseded`，stale/未知 run_id/路径逃逸/key 不匹配 commit 拒绝，并发由锁互斥，崩溃后按 §4.4 journal 前滚/回滚恢复。
- **`begin` 不回退状态**：`begin` **不下调** `baseline_seed_state`——`partial` 保留至新 run 首次有效 `commit`；仅 `adopt` 写 `required`、`commit` 写 `partial`/`seeded`。
- **JSON 映射**：`status`/`next --format json` 的 `baseline_coverage.state` 直接映射该枚举（`required`/`partial`/`seeded`），`incomplete` 恒为布尔（`partial`→`true`，否则 `false`）；有活跃提案时 partial 恢复以 `baseline_coverage.recovery` advisory 呈现、不改 `proposal_step`；`baseline-seed commit --format json` 另返回 `{committed,missing,invalid}`。**adopted 模块的 `modules[].baseline_seed_state` 恒输出**（explicit 或缺省派生值，含 `baseline_commit_in_progress` 降级分支），不存在「缺省 → 字段缺失」路径。
- **缺省语义（不变量：三入口单一事实源，baseline-seed-legacy-default-unify）**：字段缺失（legacy adopted，字段引入前接入）时的有效状态由**唯一共享 helper** `effectiveBaselineSeedState(root, moduleId, explicit) → { state, legacy }`（`cli/src/lib/baseline-jit.ts`）派生，`next` / `status` / `baseline-seed` 状态机三入口**只准**经该 helper 取有效状态，**禁止任何入口持有第二份私有缺省规则**（本地 `?? 'required'`、私有 `effectiveAdoptedState` 一类实现全部废除）。派生规则：explicit 优先；缺省时**有候选（`scanModuleCandidates` > 0）且同模块存在 open run record → `partial`**（与状态机「扫描中断」语义对齐）、**有候选无 open run → `seeded`**（候选在场 = 基线事实上建立过）、**无候选 → `required`**（advisory 引导，不设硬门）。**不存在 `unknown` 第三态**——任何命令的任何输出不得以 `unknown` 作为该字段取值。**读锁纪律（继承 §4.4 恢复门 / F7）**：helper 内部派生读权威文档与 run 记录，必须在模块读锁区间内执行（helper 自取读锁、支持外层已持锁复用），调用方不得在锁外派生。`legacy: true` 表示派生值（yaml 未落盘），供 legacy 迁移提示与 sync 迁移使用。
- **历史兼容迁移（sync 落盘，legacy 缺省态物理消亡）**：读到旧布尔 `baseline_seed_required: true` ⇒ 映射为 `baseline_seed_state: required`；`false` ⇒ 移除布尔、不推断。**两字段皆无的 adopted 模块**（含历史 `skipped` 兼容读取）⇒ `openlogos sync` 迁移调用上述共享 helper 派生并**写入显式枚举**到 `logos-project.yaml`，changes 记录写明派生依据（如 `core: baseline_seed_state 缺省 → required（派生：无逆向候选）`）。已有显式枚举**不覆盖**。迁移幂等、写前备份。迁移后运行时派生仅作「迁移尚未执行」的过渡兜底。

### 4.2 迁移映射与事件日志（审计权威）
- **事件日志**：`logos/resources/verify/baseline-events.jsonl`（append-only）为迁移/废弃事件的**审计权威源**，每行 `{event_id, type: register|rename|merge|split|retire|scanner-migrate, module, keys:[...], actor, at, evidence}`。`retired_by`/`retire_event_id` 等审计字段引用其 `event_id`。
- **单一持久化职责划分**：候选**当前状态**（active/tombstone/retired + verified）的权威源是文档 `candidates[]`（覆盖率据此单独重算）；事件日志承载**审计轨迹与迁移映射**，不重复承担当前状态的唯一持久化。二者不构成双状态源：覆盖率只读文档，审计只读事件日志。
- **迁移映射**（扫描器版本升级）：以事件日志 `type:scanner-migrate` 记录 `old_key→new_key`；应用后旧 key 若无对应新 key 则在文档 `candidates[]` 置 `tombstone`。迁移成功/失败均留痕，失败不改文档候选状态。

### 4.3 存量文档保守迁移
- `migrate-lifecycle` 对老 adopted 项目回填时**保守逐产物**：缺 `## 逆向基线来源` 章节的文档，其派生 provenance 为 `unknown`/`legacy-unclassified`，**不自动生成 `candidates[]`、不推断 `reverse-engineered`**；无产物不创建任何候选。派生索引只汇总真实存在的候选。迁移是持久化元数据迁移，须幂等、写前备份、失败可恢复、旧版 CLI 忽略未知字段。

### 4.4 多文件提交事务、恢复门与崩溃一致性（commit journal，F10）
`baseline-seed commit` 的提交跨**多个目标文档 + 派生索引 + `logos-project.yaml` 状态**，普通文件系统只保证单次 `rename` 原子，无法把多次 rename 与 YAML 更新合成一个原子事务。`committing` 期间**物理目标文件客观上可能半新**（第一个目标已 rename、第二个未），故本协议**不宣称对直接按路径读取的人工/Skill 提供跨文件原子可见性**；而是用 **commit journal + 模块级事务锁 + 恢复门**保证：**所有机器消费者永不把未终结提交的目标集合当权威**，且崩溃后落定为全旧或全新。

**journal 文件**：`logos/resources/verify/baseline-seed-runs/<run_id>/commit-journal.json`，阶段 `prepared → committing → committed`。**journal 每次阶段切换与进度追加本身以临时文件 + rename 原子写入**（避免 journal 与磁盘不一致的窗口）。

**模块级事务锁**：`logos/resources/verify/baseline-seed-runs/<module>.commit.lock`。`commit` 全程持该锁；任何机器读取入口在读取目标/覆盖率前也必须经此锁 + journal 检测（见「恢复门」）。

**提交顺序（状态最后写）**：
1. **prepared**：全部 staged 校验通过后，原子写 `prepared` journal——`{ run_id, module, targets:[{ target_path, old_sha256|null, new_sha256 }], index:{ old_sha256, new_sha256, backup_path }, state_transition:{ from, to:"seeded" } }`。**此刻尚未改任何目标**。
2. **committing**：切 journal 为 `committing`；逐目标：先把原目标（若存在）移入 `<run_id>/backup/`、再 `<target>.tmp` 写入 + `rename` 覆盖，随后**原子**追加 `applied`。全部目标 applied 后**更新派生索引**（旧索引先按 `index.backup_path` 备份）、**最后写 `baseline_seed_state`**。
3. **committed**：切 journal 为 `committed`；清理 staging / backup。

**恢复门（消除崩溃后、恢复前的半新可见窗口）**：所有机器消费者——`status` / `next` / 覆盖率重算 / resource-index 扫描 / 派生器——在读取该模块任何目标或据其算覆盖率**之前**，必须：① 取模块级事务锁；② 检测是否存在未终结（`prepared`/`committing`）journal；③ 若有则**先执行恢复**（下述前滚/回滚），恢复后再读；④ 若无法恢复（如持锁失败）则输出 `baseline_commit_in_progress` 并**不把当前目标集合视为权威**（不算覆盖率、不报 `seeded`）。因此即使 `committing` 期间物理半新、且 prior 状态曾为 `seeded`，机器读取者也经门先恢复到全旧/全新、绝不复用旧 `seeded` 或据半新集合出权威结论。

**崩溃恢复**（`commit` 重跑、下次 `begin`、或任一读取门触发时，持模块锁读 journal，**按每目标 on-disk hash 与 journal `old_sha256`/`new_sha256` 重判态**，不只依 `applied` 列表）：
- 无 journal / `committed`：无事可做（幂等）。
- `prepared`（无目标已改）：**回滚**＝丢弃 journal，目标全旧、状态不变（`partial`/prior）。
- `committing`：
  - **staging 完好**（新集合齐全、`new_sha256` 可校验）→ **前滚**：从 staging 补齐未落新值的目标、按 `index.new_sha256` 完成索引 + 写状态、标 `committed`（结果全新 + `seeded`）。
  - **staging 缺失/损坏** → **回滚**：按 `<run_id>/backup/` + `old_sha256` 还原已改目标、按 `index.backup_path`/`old_sha256` 还原索引，状态保持 `partial`/prior（结果全旧）。
- 恢复后强制断言：**目标集合全旧或全新、索引与目标集合匹配、`baseline_seed_state==seeded` 当且仅当完整新集合在盘**。

**半提交 run 与 supersede**：带未终结 journal 的 run 持恢复优先权；新 `begin` 必须在锁内先跑其恢复（前滚/回滚）到一致态再 `supersede`。

> **可选更强实现（真原子可见性）**：若把整版基线写入版本化目录、所有消费者只经一个可原子 rename 的指针/manifest 解析当前版本、commit 只切该单指针，则连人工/Skill 直接读取也原子可见；本 change 因目标为人读的标准路径 Markdown 规格文件，采「恢复门」语义，机器消费者一致性由门保证、不对直接路径人工读取宣称原子可见。

**半提交 run 与 supersede 的恢复权**：带未终结（`prepared`/`committing`）journal 的 run **持有恢复优先权**；同模块新 `begin` 必须**先在锁内跑该 run 的恢复**（前滚或回滚到一致态）再 `supersede`，不得在半提交状态上叠新 run。若选目录级快照 + 单指针切换实现，则消费者只经该原子指针读一致版本，语义等价。
