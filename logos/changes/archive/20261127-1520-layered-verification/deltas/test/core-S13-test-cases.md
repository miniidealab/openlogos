## ADDED — S13 分层验收与发布级验收测试（layered-verification）

> 覆盖场景 `core-S13-verify-results.md`「S13 分层验收：提案级三层集合」（Step 1～18、EX-13.28～EX-13.41、EX-13.54、EX-13.55）与「S13 发布级全量验收」（Step 1～17、EX-13.42～EX-13.53、EX-13.56），功能规格 §2.109.1～§2.109.15、§2.104.3（修改），`spec/test-results.md`「分层验收（layered-verification）」，`spec/cli-json-output.md`「verify 分层验收与发布级验收（layered-verification）」；需求 AC-VERIFY-TIER-01～04、06～12、14～20。
>
> **夹具 LV**：`mktemp -d` 一次性 git 项目，单模块 `core`（launched）。已合并测试规格：
> - `core-S01-test-cases.md`：UT-S01-01、UT-S01-02、UT-S01-03；
> - `core-S02-test-cases.md`：UT-S02-01、UT-S02-02；
> - `core-S03-test-cases.md`：UT-S03-01、UT-S03-02，含主链路小节，列出 UT-S03-01；
> - `core-S04-test-cases.md`：UT-S04-01 `[manual]`、UT-S04-02。
>
> 初始提交之后建立活跃提案 `lv-demo`（guard 带 `baseRef`）：`deltas/test/core-S01-test-cases.md` 新增 UT-S01-04 并经正常 merge 写入 `SPEC_MERGED`（本提案用例 C = {UT-S01-04}，delta 触及场景 S01）；`proposal.md` 的「受影响场景」段按用例设置，缺省为 `assessment: assessed`、`shared_change: false`、`scenarios: [S02]`。`verify.layered.enabled: true`。
>
> `verify.pre_run_command` 指向记录型入口 `lv-runner.mjs`：
> - 每次被执行时在项目外临时目录追加一行调用记录（第几次调用、收到的 `OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS`、`OPENLOGOS_VERIFY_SLICE_SCOPE`、`OPENLOGOS_VERIFY_MODULES`、`OPENLOGOS_VERIFY_RERUN`、**实际执行的用例 ID**、当前工作目录）；
> - 启动时清空结果文件；收到清单时只执行、只上报清单内的用例，否则执行全部不带 `[manual]` 的用例；
> - 按剧本文件决定每条用例第 n 次调用时写 pass / fail / skip（可带平台原因）；有 fail 时非零退出，剧本可覆盖某次调用的退出码。
>
> 缺省情况下 P = {UT-S01-01、02、03、04、UT-S02-01、02、UT-S03-01}，UT-S03-02 与 UT-S04-02 在 P 之外。
>
> 变体：
> - **LV-wide**：入口忽略清单，执行并上报全部用例。
> - **LV-quiet**：入口执行全部用例，但只上报清单内的用例。
> - **LV-mod**：多模块（`core`、`backend`、`web`，各自声明非空 `paths`，`verify.modules` 各有命令组，各命令组的入口分别记录调用）；测试规格 `core-S01`、`core-S03`（含主链路小节）、`backend-S05`、`backend-S06`、`web-S07`。
> - **LV-rel**：夹具 LV 去掉活跃提案，全部内容已提交、工作区干净；用于发布级验收。入口剧本可在执行期间运行 git 命令（新建提交、留下未提交文件）。
>
> 「与引入前一致」类断言以同一夹具在引入前实现上生成的 golden 比对（新增的 `level` 字段除外）。断言「入口被调用几次」「收到的清单」「实际执行了哪些用例」一律读调用记录，不从 CLI 输出推断。

### 单元测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S13-217 | 分层配置的缺省与非法取值 | §2.109.2、EX-13.41 | 夹具 LV；依次为：不写 `layered`、`layered: []`、`enabled: "yes"`、`main_path_max: 0`、`shared_paths: "x"` | `verify --format json` | 不写时未开启且无警告；其余各情形非法项按缺省值处理，`warnings` 含 `layered_config_invalid` 并指出字段；`enabled` 非法时按未开启处理；门禁结论不因警告改变 |
| UT-S13-218 | 未开启时与引入前一致 | §2.109.15、EX-13.28、AC-VERIFY-TIER-11 | 夹具 LV 设 `enabled: false`（文档中仍有主链路小节，提案仍有受影响场景段） | `verify --format json`，读取报告 | 入口未收到分层清单、执行全部自动化用例；`data.level="proposal"`，没有 `layers`；除 `level` 外 JSON、验收报告字节与退出码和 golden 一致 |
| UT-S13-219 | 主链路小节读取 | §2.109.3、AC-VERIFY-TIER-01 | 夹具 LV；另备文档：二级标题与三级标题各一、英文标题 `Main Path Cases`、列表项带说明文字、`*` 列表、没有小节 | 调用主链路读取 | 各文档的主链路集合符合所列 ID；说明文字不参与判定；没有小节的文档贡献为空；用例表首格没有任何主链路标记 |
| UT-S13-220 | 主链路小节的结构错误 | §2.109.3 | 测试文档分别含：未定义 ID、`[manual]` 用例、SMOKE ID、同一小节重复 ID、两个主链路小节、不以 ID 开头的列表项 | 调用主链路读取 | 依次给出 `undefined_id`、`manual_case`、`not_ut_st`、`duplicate_id`、`duplicate_section`、`item_without_id`，各带文档路径与 ID |
| UT-S13-221 | 三层合集与去重 | §2.109.6、AC-VERIFY-TIER-06 | 夹具 LV；另把 UT-S01-01 也列入 `core-S01` 的主链路小节 | `verify --format json` | `layers.total` 的 ID 恰为 P 的 7 条，无重复、字典序；`layers.changed.ids=["UT-S01-04"]`；`layers.affected.scenarios` 含 S01（来源含 `delta`）与 S02（来源 `declared`）；`layers.main_path.ids` 含 UT-S01-01、UT-S03-01；`layers.expansion.level="none"` |
| UT-S13-222 | 清单交给测试入口，集合外用例不计未覆盖 | §2.109.8、AC-VERIFY-TIER-06 | 夹具 LV；全部 pass | `verify --format json` | 入口收到的 `ELIGIBLE_TEST_IDS` 等于 P；未收到 `SLICE_SCOPE`；实际执行的用例恰为 P；`summary.defined_count=7`；UT-S03-02、UT-S04-02 不在 `uncovered_cases`；`gate.result="PASS"`；调用结束后进程环境中两个变量恢复原状 |
| UT-S13-223 | delta 触及的场景自动并入 | §2.109.5、EX-13.34、AC-VERIFY-TIER-07 | 夹具 LV；声明改为 `scenarios: []` | `verify --format json` | `layers.affected.scenarios` 仅 S01，来源 `delta`；P 含 S01 的全部自动化用例；不含 S02 的用例 |
| UT-S13-224 | 人工用例不进入受影响用例 | §2.109.5 | 夹具 LV；声明 `scenarios: [S04]` | `verify --format json` | 受影响用例含 UT-S04-02，不含 UT-S04-01 |
| UT-S13-225 | 共享路径改动扩大到全量 | §2.109.7、EX-13.32、AC-VERIFY-TIER-08 | 夹具 LV；依次为：修改根 `package.json`、修改子目录 `tools/package-lock.json`、修改 `logos/logos.config.json` | `verify --format json` | 三种情形 `layers.expansion.level="full"`，原因 `shared_path_changed` 并列出命中的文件；入口执行全部自动化用例；`summary.defined_count` 为全量 |
| UT-S13-226 | 声明涉及共享改动扩大到全量 | §2.109.7、EX-13.32、AC-VERIFY-TIER-08 | 夹具 LV；声明 `shared_change: true` | `verify --format json` | `level="full"`，原因 `shared_change_declared` |
| UT-S13-227 | 自定义共享路径替换缺省清单 | §2.109.2 | 夹具 LV；① `shared_paths: ["shared/**"]` 并修改 `shared/util.ts`；② 同配置下修改根 `package.json`；③ `shared_paths: []` 并修改 `logos/logos-project.yaml` | `verify --format json` | ① 扩大到全量；② 不因 `package.json` 扩大；③ 仍扩大到全量（两个 logos 配置文件恒为共享配置） |
| UT-S13-228 | 声明缺失退回按模块 | §2.109.7、EX-13.30、AC-VERIFY-TIER-09 | 夹具 LV；删除「受影响场景」段 | `verify --format json` | 原因含 `declaration_missing` 与 `module_scope_unavailable`；`level="full"`（单模块）；不报错，门禁按全量判定 |
| UT-S13-229 | 声明非法或未填写 | §2.109.4、§2.109.7、EX-13.30 | 夹具 LV；依次为：`assessment: pending`、YAML 损坏、`scenarios` 项缺 `reason`、编号重复、`shared_change: "no"` | `verify --format json` | 各情形原因 `declaration_invalid`，`layers.declaration.status="invalid"` 并给出明细；范围扩大 |
| UT-S13-230 | 无法评估 | §2.109.7、EX-13.30 | 夹具 LV；`assessment: unknown` | `verify --format json` | 原因 `assessment_unknown`；范围扩大 |
| UT-S13-231 | 声明了不存在的场景 | §2.109.7、EX-13.31 | 夹具 LV；`scenarios: [S02, S99]` | `verify --format json` | 原因 `scenario_unknown` 并点名 S99；范围扩大，不以 S02 缩小范围 |
| UT-S13-232 | 提案起点不可用 | §2.109.7、EX-13.33 | 夹具 LV；依次为：guard 去掉 `baseRef`、`baseRef` 改为不存在的提交、删除 `.git` | `verify --format json` | 三种情形 `level="full"`，原因 `base_ref_unavailable` 并附具体情形 |
| UT-S13-233 | 没有活跃提案按全量 | §2.109.7、EX-13.29、AC-VERIFY-TIER-12 | 夹具 LV 删除 guard | `verify --format json` | `level="full"`，原因 `no_active_change`；主链路约束照常检查 |
| UT-S13-234 | 只扩大不缩小 | §2.109.7、AC-VERIFY-TIER-10 | 夹具 LV；全部 pass；依次取 UT-S13-225～233 的各扩大情形 | `verify --format json` | 每种情形的验收集合都是未扩大时 P 的超集；`gate.result` 与未扩大时相同（PASS）。多模块下真正按模块扩大的超集关系由 UT-S13-271 断言 |
| UT-S13-235 | 提案尚未合并时本提案用例为空 | §2.109.6、EX-13.40 | 夹具 LV；删除 `SPEC_MERGED` 与已合并的 UT-S01-04 行 | `verify --format json` | `layers.changed.ids=[]`；受影响与主链路两层照常；不报 `test_change_set_invalid` |
| UT-S13-236 | 按模块级扩大 | §2.109.7、EX-13.39 | 夹具 LV-mod；提案只改动 `backend/**`；删除「受影响场景」段 | `verify --format json` | `level="module"`，原因 `declaration_missing`；受影响用例为 `backend` 模块的全部自动化用例；P 另含本提案用例与主链路用例（主链路在 `core-S03`） |
| UT-S13-237 | 与模块范围并存时的命令组 | §2.109.8、EX-13.39 | 夹具 LV-mod；① 未扩大，P 只含 `backend` 的用例与 `core-S03` 的主链路用例；② 同 UT-S13-236 | `verify --format json` | ① 执行 `backend` 与 `core` 两个命令组，各自收到的清单为 P，`web` 未被执行；② 执行范围 M 的 `backend` 命令组与主链路所属的 `core` 命令组，`web` 未被执行；每条命令的 `OPENLOGOS_VERIFY_MODULES` 正确；`data.scope` 照旧输出 |
| UT-S13-238 | 主链路超过上限在执行前判 FAIL | §2.109.10、EX-13.35、AC-VERIFY-TIER-02 | 夹具 LV；`main_path_max: 1`；主链路列 2 条 | `verify --format json`，读取报告与历史 | 入口未被调用；`gate.reason="main_path_over_limit"`；`layers.main_path` 给出 `limit=1`、`count=2`；报告计数显示「未执行」并写明原因；历史 `result_source="none"` |
| UT-S13-239 | 主链路小节结构错误在执行前判 FAIL | §2.109.10、EX-13.36、AC-VERIFY-TIER-03 | 夹具 LV；主链路小节列未定义 ID；另一情形同时超过上限 | `verify --format json` | 入口未被调用；`gate.reason="main_path_invalid"`，`layers.main_path.problems` 逐条给出文档、ID 与代码；同时超限时仍取 `main_path_invalid` |
| UT-S13-240 | 执行前判 FAIL 时变更集无效优先 | §2.109.10 | 夹具 LV；主链路超限；把 `SPEC_MERGED.test_change_set` 改为无效 | `verify --format json` | 入口未被调用；`gate.reason="test_change_set_invalid"`；`layers.main_path` 仍列出超限 |
| UT-S13-241 | 主链路用例不得靠复跑通过 | §2.109.10、EX-13.37、AC-VERIFY-TIER-04 | 夹具 LV；剧本：UT-S03-01 第 1 次 fail、第 2 次 pass | `verify --format json` | 入口被调用 2 次；`gate.result="FAIL"`、`gate.reason="main_path_flaky"`；UT-S03-01 在 `flaky_cases` 与 `layers.main_path.flaky_ids` 中；不写 `VERIFY_PASS`；无 `flaky_cases_present` 警告 |
| UT-S13-242 | 非主链路偶发与未开启时的主链路偶发照常放行 | §2.109.10、§2.108 | ① 夹具 LV，UT-S02-01 第 1 次 fail、第 2 次 pass；② `enabled: false`，UT-S03-01 第 1 次 fail、第 2 次 pass | `verify --format json` | ① PASS，带 `flaky_cases_present`；② PASS，带 `flaky_cases_present`，无 `main_path_flaky` |
| UT-S13-243 | 分层下的原因优先级 | §2.109.10 | 夹具 LV；依次构造：主链路偶发且另有用例失败；主链路偶发且预跑命令非零退出；主链路偶发且账本有非法行 | `verify --format json` | 三种情形 `gate.reason` 都是 `main_path_flaky`；去掉主链路偶发后分别回到 `failed_cases`、`pre_run_failed`、`result_ledger_inconsistent` |
| UT-S13-244 | 测试入口未收窄且因集合外失败而非零退出 | §2.109.8、EX-13.38、AC-VERIFY-TIER-20 | 夹具 LV-wide；P 之外的 UT-S03-02 写 fail，入口因此非零退出；P 内全部 pass | `verify --format json` | 入口执行了全部用例；UT-S03-02 的结果不采信，`failed_cases` 为空；`layers.outside_result_count=2`；`warnings` 含 `layered_runner_not_narrowed`；`consistency.ok=true`，无 `result_outside_eligible_scope`；没有集合内失败可供复跑（`rerun.skipped_reason="no_failed_cases"`），命令组状态不改判；`gate.result="FAIL"`、`gate.reason="pre_run_failed"` |
| UT-S13-245 | 入口未收窄但未上报时不告警 | §2.109.8、EX-13.38 | 夹具 LV-quiet | `verify --format json` | 调用记录显示执行了全部用例；`outside_result_count=0`；没有 `layered_runner_not_narrowed`；门禁按 P 判定 |
| UT-S13-246 | 失败复跑的范围在 P 之内 | §2.109.8、§2.108.4 | 夹具 LV-wide；UT-S02-01 与 P 之外的 UT-S03-02 首跑都 fail，复跑都 pass | `verify --format json` | `rerun.requested_ids=["UT-S02-01"]`；`flaky_cases` 仅 UT-S02-01 |
| UT-S13-247 | 提案级报告的级别与验收范围小节 | §2.109.13、AC-VERIFY-TIER-19 | 夹具 LV；全部 pass | `verify`，读取 `acceptance-report.md` | Summary 有「级别 / Level」行，取值为提案级（分层）；「验收范围」小节列出三层各自的用例数、受影响场景与来源、合计、扩大级别与原因、集合外结果行数，并注明提案级通过不等于可以发布；不含命令输出 |
| UT-S13-248 | 文本模式标明级别 | §2.109.13 | 夹具 LV；zh 与 en 各一次；另一次用 LV-rel 执行 `--release` | 文本模式运行 | 提案级输出含级别与「提案级通过不等于可以发布」的提示（两种语言各有文案）；发布级输出含级别、提交号与平台 |
| UT-S13-249 | JSON 的 `level` 与 `layers` 结构 | §2.109.14 | 夹具 LV；未扩大与扩大到全量各一次 | `verify --format json`，以 `spec/schema/verify.schema.json` 校验 | 两次输出都通过 schema 校验；`layers` 含 `changed`、`affected`、`main_path`、`total`、`declaration`、`expansion`、`outside_result_count`；扩大到全量时 `expansion.reasons` 非空 |
| UT-S13-250 | 历史记录的 `level`、`platform` 与读取兼容 | §2.104.3 | 夹具 LV 运行一次；另预置四份记录：缺 `level` 与 `platform`、`level: "release"`、`level: "x"`、`platform: 1` | `history list --format json` | 新记录 `level="proposal"`、`platform` 为 `<platform>-<arch>`；缺字段的记录读出 `level="proposal"`、`platform=null`；后两份按损坏记录跳过并警告 |
| UT-S13-251 | `history list` 按级别与提交筛选 | §2.109.14 | 预置同一提交的提案级与发布级记录各一，另一提交的发布级记录一条 | `history list --level release --format json`；加 `--commit <前缀>` | 前者只含发布级两条；后者只含该提交的一条；`--level` 取值非法时报用法错误 |
| UT-S13-252 | 发布级：不是 git 仓库时拒绝 | §2.109.11、EX-13.43、AC-VERIFY-TIER-15 | 夹具 LV-rel 删除 `.git`；另一情形为刚 `git init`、尚无提交 | `verify --release --format json` | 两种情形 `RELEASE_VERIFY_NOT_GIT`，退出码 2；入口未被调用；结果文件未被截断；不写历史 |
| UT-S13-253 | 发布级：工作区不干净时拒绝 | §2.109.11、EX-13.42、AC-VERIFY-TIER-15 | 夹具 LV-rel；依次为：修改已跟踪文件、新增未跟踪文件、只改动 `logos/resources/verify/` 下的文件 | `verify --release --format json` | 前两种 `RELEASE_VERIFY_DIRTY`，`details.paths` 列出该文件，入口未被调用；第三种不算不干净，照常执行 |
| UT-S13-254 | 发布级：没有测试命令时拒绝，旧结果不能充当证据 | §2.109.11、EX-13.44、AC-VERIFY-TIER-15 | 夹具 LV-rel 去掉 `pre_run_command` 并提交；`result_path` 预置全部 pass 的完整结果 | ① `verify --release --format json`；② `verify --release --check --format json` | ① `RELEASE_VERIFY_NO_COMMAND`，退出码 2，结果文件未被读取或改动，不写历史；② `valid=false`、`reason="no_conclusive_run"`，退出码 1 |
| UT-S13-255 | 发布级恒为全量 | §2.109.11、EX-13.46、EX-13.47、AC-VERIFY-TIER-14 | 依次为：LV-rel 开启分层；LV-mod 全部提交且干净；LV 的活跃提案全部提交且干净（处于 slice-checkpoint） | `verify --release --format json` | 三种情形入口都未收到 `ELIGIBLE_TEST_IDS` 与 `SLICE_SCOPE`，执行全部自动化用例（多模块时全部命令组）；`data.level="release"`；没有 `layers`、`verify_mode`、`scope`；不检查主链路约束（主链路超限时仍照常执行） |
| UT-S13-256 | 发布级不触碰提案标记与提案级报告 | §2.109.11、EX-13.46 | 夹具 LV 全部提交且干净；提案目录已有 `VERIFY_PASS`、`SLICE_CHECKPOINTS.jsonl`、`LOOP_ITERS`，已有提案级 `acceptance-report.md`；发布级运行一次 PASS、一次 FAIL | `verify --release` | 两次运行前后，提案目录全部文件与提案级验收报告的字节不变；没有新增 `verify-runs/` 记录；不写 `VERIFY_FAIL` |
| UT-S13-257 | 发布级报告与 JSON | §2.109.13、§2.109.14、AC-VERIFY-TIER-19 | 夹具 LV-rel；一条用例 fail | `verify --release --format json`，读取 `logos/resources/verify/release/acceptance-report.md` | 报告 Summary 含级别为发布级（全量）、完整提交号、平台；列出失败用例；`data.release` 含 `commit`、`platform`、`commit_unchanged=true`；`report_path` 为发布级报告路径；退出码 1 |
| UT-S13-258 | 发布级的历史记录 | §2.104.3、§2.109.14 | 夹具 LV-rel；全部 pass | `verify --release --format json`，读取中央索引 | 记录 `level="release"`、`commit.head` 为运行前的 HEAD、`commit.dirty=false`、`platform` 正确、`proposal=null`、`raw_location="none"`、`verify_mode=null`、`result_source="executed"` |
| UT-S13-259 | 提交身份在执行前固定 | §2.109.11、EX-13.45、AC-VERIFY-TIER-16 | 夹具 LV-rel（沙箱关闭）；HEAD 为提交 A；入口剧本在执行期间新建提交 B；全部用例 pass | ① `verify --release --format json`；② `verify --release --check --commit B`；③ `--check --commit A` | ① `gate.result="FAIL"`、`gate.reason="release_commit_changed"`；历史 `commit.head=A`；报告写明收尾时 HEAD 为 B；② `valid=false`，不命中这次运行；③ `valid=false`、`reason="latest_failed"` |
| UT-S13-260 | 收尾时工作区不干净 | §2.109.11、EX-13.45 | 夹具 LV-rel（沙箱关闭）；入口剧本在执行期间留下一个未跟踪的源码文件 | `verify --release --format json` | `gate.reason="release_commit_changed"`；`data.release.commit_unchanged=true`、`worktree_clean=false` |
| UT-S13-261 | 查询以最近一次结论为准 | §2.109.12、EX-13.48、AC-VERIFY-TIER-17 | 夹具 LV-rel；同一提交依次运行：① PASS 后 FAIL；② 另一项目 FAIL 后 PASS | 每组之后 `verify --release --check --format json` | ① `valid=false`、`reason="latest_failed"`，退出码 1，`latest.run_id` 为后一次；② `valid=true`、`reason=null`，退出码 0 |
| UT-S13-262 | 环境预检未通过的运行不是结论 | §2.109.12、EX-13.49、AC-VERIFY-TIER-17 | 夹具 LV-rel 声明 `verify.requirements.env: ["LV_TOKEN"]`；① 设置变量运行 PASS，再不设置变量运行；② 新项目只在不设置变量时运行 | 每组之后 `--release --check` | ① 第二次运行 `verify_env_not_ready`、历史 `result_source="none"`；查询仍 `valid=true`；② `valid=false`、`reason="no_conclusive_run"` |
| UT-S13-263 | 提交变了即作废；其他平台的结论不算 | §2.109.12、EX-13.50、AC-VERIFY-TIER-18 | 夹具 LV-rel；① 提交 A 上 PASS 后新建提交 B；② 预置一条提交相同、`platform` 不同的 PASS 记录；③ 没有任何发布级记录 | `--release --check --format json` | ① `valid=false`、`reason="other_commit_only"`；② `reason="other_platform_only"`；③ `reason="no_conclusive_run"`；退出码都是 1；三种情形都不执行入口、不写任何文件 |
| UT-S13-264 | `--check` 指定提交 | §2.109.12、EX-13.51 | 承 UT-S13-263 ①；工作区另有未提交改动 | `--release --check --commit A`；`--commit <A 的缩写>`；`--commit 不存在的值` | 前两者 `valid=true`、`commit` 为 A 的完整提交号，退出码 0（不要求工作区干净）；第三者 `RELEASE_CHECK_COMMIT_INVALID`，退出码 2 |
| UT-S13-265 | 发布级报告与 `release` 模块的验收报告互不覆盖 | §2.109.13、EX-13.53 | 多模块项目含 initial 模块 `release`，其模块验收报告 `release-acceptance-report.md` 已为 PASS；全部提交且干净 | 依次 `verify --release`、`verify`、`verify --release` | 两个文件始终各自存在；模块验收报告的「模块」行与 Gate 行不被发布级运行改动；`isModuleReportComplete` 对 `release` 模块的判定不受发布级运行影响 |
| UT-S13-266 | 结果路径落在发布级报告路径上 | §2.109.13、EX-13.52 | `verify.result_path` 配置为 `logos/resources/verify/release/acceptance-report.md` | `verify --format json` | 按既有保留路径规则改写到默认结果路径，`pre_run.diagnostics` 给出提示；发布级报告路径不被写入结果内容 |
| UT-S13-267 | 发布级沿用失败复跑 | §2.109.11、§2.108 | 夹具 LV-rel；一条用例第 1 次 fail、第 2 次 pass（该用例在主链路中） | `verify --release --format json` | `gate.result="PASS"`，带 `flaky_cases_present`；历史 `flaky_ids` 含该用例；不出现 `main_path_flaky`；随后 `--check` 返回 `valid=true` |
| UT-S13-269 | 集合外失败行被忽略且入口零退出时放行 | §2.109.8、EX-13.38 | 夹具 LV-wide；P 之外的 UT-S03-02 写 fail；剧本把入口退出码覆盖为 0；P 内全部 pass | `verify --format json` | `failed_cases` 为空；`outside_result_count=2`，警告 `layered_runner_not_narrowed`；`pre_run.commands[0].status="pass"`；`gate.result="PASS"`。与 UT-S13-244 只差退出码，结论相反 |
| UT-S13-270 | 共享标志独立于评估状态被采信 | §2.109.4、§2.109.7、EX-13.32、AC-VERIFY-TIER-08 | 夹具 LV-mod；提案只改动 `backend/**`；声明依次为：`assessment: unknown` 加 `shared_change: true`；`assessment: pending` 加 `shared_change: true`；`scenarios` 含不存在的 S99 加 `shared_change: true` | `verify --format json` | 三种情形 `layers.expansion.level="full"`，原因含 `shared_change_declared`；`core`、`backend`、`web` 三个命令组都被执行；验收集合为全量（不停在 `backend` 模块） |
| UT-S13-271 | 按模块扩大时保留已识别场景与 delta 触及场景 | §2.109.7、EX-13.30、EX-13.31、AC-VERIFY-TIER-10 | 夹具 LV-mod；提案只改动 `backend/**`，delta 触及 `backend-S05`；主链路在 `core-S03`。① 基准：声明 `scenarios: [S07]`（`web` 模块）；② 声明 `scenarios: [S07, S99]`；③ 声明 `assessment: unknown`、`scenarios: [S07]` | 三种声明各执行 `verify --format json` | ① `level="none"`，集合含 `web-S07` 的用例；② `level="module"`、原因 `scenario_unknown`；③ `level="module"`、原因 `assessment_unknown`；②③ 的 `layers.total.ids` 都是 ① 的超集：含 `backend` 模块全部自动化用例、`web-S07` 的用例、主链路用例与本提案用例；②③ 都执行了 `web` 命令组；`layers.affected.scenarios` 仍列出 S07（`declared`）与 S05（`delta`） |
| UT-S13-272 | 环境预检针对本次实际执行的命令组 | §2.109.8、EX-13.55 | 夹具 LV-mod；范围 M 只有 `backend`（声明缺失，按模块扩大），主链路在 `core-S03`；`verify.modules.core.requirements.env: ["LV_CORE_TOKEN"]`，`verify.modules.web.requirements.env: ["LV_WEB_TOKEN"]`，两个变量都未设置 | ① `verify --format json`；② 只设置 `LV_CORE_TOKEN` 后再次执行 | ① `gate.reason="verify_env_not_ready"`，缺失项为 `LV_CORE_TOKEN` 且归属 `core`，不含 `LV_WEB_TOKEN`；`core`、`backend`、`web` 三个入口的调用数都是 0；② 预检通过，`backend` 与 `core` 两个命令组被执行，`web` 未被执行也未因 `LV_WEB_TOKEN` 被阻断 |
| UT-S13-273 | 发布级：无理由的跳过不能构成通过 | §2.109.11、EX-13.56、AC-VERIFY-TIER-14 | 夹具 LV-rel；入口零退出；依次为：全部自动化用例都写无原因的 skip；只有一条写无原因的 skip、其余 pass | ① `verify --release --format json`；② `verify --release --check --format json` | 两种情形 ① `gate.result="FAIL"`、`gate.reason="case_tier_mismatch"`，这些用例在 `tier_mismatch_cases` 中，没有 `unclassified_skipped_cases` 警告；② `valid=false`、`reason="latest_failed"`，退出码 1 |
| UT-S13-274 | 发布级：带平台原因的跳过被接受 | §2.109.11、EX-13.56 | 夹具 LV-rel；一条用例写 `reason_code: "platform-unavailable"` 加非空 `detail` 的 skip，其余 pass | ① `verify --release --format json`；② `--release --check` | ① `gate.result="PASS"`；该用例在 `platform_skipped_cases` 与发布级报告的平台跳过小节中；② `valid=true`，退出码 0 |
| UT-S13-268 | 发布级参数的用法检查 | §2.109.12 | 夹具 LV-rel | `verify --check`；`verify --commit <sha>`；`verify --release --commit <sha>`（无 `--check`） | 三者都是用法错误，退出码非 0，不执行入口、不写历史 |

### 场景测试

| ID | 描述 | 来源 | 前置条件 | 输入/操作 | 预期输出 |
|----|------|------|---------|------|---------|
| ST-S13-48 | 分层开启的提案级验收只跑该跑的部分 | 提案级 Step 1～18、AC-VERIFY-TIER-06、07、19 | 真实 CLI（构建后的 `dist/index.js`）；夹具 LV；全部 pass | ① `verify --format json`；② 读取调用记录、`result_path` 与 `acceptance-report.md`；③ `history list --format json` | ① 退出码 0，`gate.result="PASS"`，`level="proposal"`，`layers.expansion.level="none"`；② 入口只执行 P 的 7 条，UT-S03-02、UT-S04-02 未被执行；报告标明提案级与三层用例数；`VERIFY_PASS` 已写入；③ 最新记录 `level="proposal"` |
| ST-S13-49 | 评估不可用时扩大而不是放过 | 提案级 EX-13.30、EX-13.32、AC-VERIFY-TIER-08～10 | 真实 CLI；夹具 LV；P 之外的 UT-S03-02 实际会失败 | ① 缺省声明下 `verify --format json`；② 声明改为 `shared_change: true` 后再次运行 | ① PASS（UT-S03-02 不在 P 内、未执行）；② 扩大到全量，UT-S03-02 被执行并失败，`gate.reason="failed_cases"`，报告写明扩大原因 |
| ST-S13-50 | 同一提交先提案级、后发布级，两份结论并存 | 发布级 Step 1～14、EX-13.46、AC-VERIFY-TIER-14、19 | 真实 CLI；夹具 LV，提案内容全部提交且工作区干净；全部 pass | ① `verify --format json`；② `verify --release --format json`；③ 读取两份报告与提案目录 | ① 提案级 PASS，入口只执行 P；② 发布级 PASS，入口执行全部自动化用例；③ 两份报告并存、级别分别为提案级与发布级；`VERIFY_PASS` 仍在且未被改写；历史中两条记录 `level` 不同、提交号相同 |
| ST-S13-51 | 发布前查询：失败、修复、再通过 | 发布级 Step 15～17、EX-13.48、EX-13.50、AC-VERIFY-TIER-17、18 | 真实 CLI；夹具 LV-rel；提交 A 上一条用例会失败 | ① `verify --release`；② `--release --check`；③ 提交修复得到提交 B；④ `--release --check`；⑤ `verify --release`；⑥ `--release --check`；⑦ `--release --check --commit A` | ① 退出码 1；② 退出码 1，`latest_failed`；④ 退出码 1，`other_commit_only`；⑤ 退出码 0；⑥ 退出码 0，`valid=true`；⑦ 退出码 1，`latest_failed` |

### 覆盖度校验

- 配置与未开启：UT-S13-217、UT-S13-218。
- 主链路读取与约束：UT-S13-219、UT-S13-220、UT-S13-238～UT-S13-243。
- 三层集合与受影响场景：UT-S13-221～UT-S13-224、UT-S13-235、ST-S13-48。
- 扩大规则：UT-S13-225～UT-S13-234、UT-S13-236、UT-S13-270、UT-S13-271、ST-S13-49。
- 执行与核对：UT-S13-222、UT-S13-237、UT-S13-244～UT-S13-246、UT-S13-269、UT-S13-272。
- 报告、JSON、历史：UT-S13-247～UT-S13-251。
- 发布级验收：UT-S13-252～UT-S13-260、UT-S13-265～UT-S13-268、UT-S13-273、UT-S13-274、ST-S13-50。
- 发布级查询：UT-S13-261～UT-S13-264、ST-S13-51。
- 提案级异常 EX-13.28～EX-13.41 各至少一条：28（218）、29（233）、30（228～230、271）、31（231、271）、32（225、226、270）、33（232）、34（223）、35（238）、36（239）、37（241）、38（244、245、269）、39（236、237）、40（235）、41（217）、54（`core-S32-test-cases.md` 的 UT-S32-118、UT-S32-119、UT-S32-124、UT-S32-125）、55（272）。
- 发布级异常 EX-13.42～EX-13.53 各至少一条：42（253）、43（252）、44（254）、45（259、260）、46（255、256）、47（255）、48（261）、49（262）、50（263）、51（264）、52（266）、53（265）、56（273、274）。
- 需求 AC-VERIFY-TIER-01～04、06～12、14～20 均有对应用例；05、21 由 S09 / S35 的用例覆盖，13 由 S32 的用例覆盖，22 由安装态 smoke 覆盖。

### 自动化与证据要求

- 全部用例由 `cli/test` 下的自动化测试实现，结果经 OpenLogos reporter 写入 `logos/resources/verify/test-results.jsonl`。
- 不需要人参与；不需要额外的环境要求（夹具自建一次性 git 仓库，本仓测试已依赖 git）；无平台限定用例——平台取值一律用 `process.platform` 与 `process.arch` 的关系式断言，「其他平台」用预置的历史记录构造。
- 「第几次调用」「收到的清单」「实际执行的用例」以项目外临时目录中的调用记录为准，不依赖时间或随机。
- 发布级用例中「运行期间提交变化」由夹具入口在被执行时运行 git 命令实现，不依赖并发时序。
