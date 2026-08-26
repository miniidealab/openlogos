## ADDED — Plan Package 收敛修复 `0.13.31` 安装态 Smoke

### 范围与前置条件

- verify 已 PASS，部署报告固定真实 0.13.31 候选与 0.13.30 回滚 tarball 的绝对路径、大小和 SHA-256。
- 全局部署、`DEPLOY_DONE` 与用户独立 smoke 授权均已完成；本节不得由 plan/merge 授权隐式触发。
- 所有破坏性 fixture 位于一次性 HOME/prefix/cache/workspace/evidence 根；不对本仓活跃提案或真实用户项目执行 change/merge/sync fixture。
- 统一 dispatcher 必须发现以下六个 ID，runner 通过 OpenLogos reporter 写 smoke JSONL；旧结果、mock、skip 或手写 PASS 不得补齐。

### 冒烟测试用例

| ID | 验证点 | 操作 | 通过标准与证据 |
|---|---|---|---|
| SMOKE-core-135 | 0.13.31 全局制品与 asset manifest 身份 | 新 shell 解析 realpath/prefix/version，解包并重算 CLI/plugin/Skill/template/schema hash | 入口关联固定 tarball；所有版本为 0.13.31，Plan contract=1.3.0，manifest hash 全匹配，无 workspace link/源码/旧缓存 |
| SMOKE-core-136 | 中英文 scaffold 与精确 L0 issues | 一次性 zh/en launched fixture 执行 change；检查空 code；分别注入 summary 改名与 code checkbox | 合法 scaffold canonical；反例 lint exit 2，issue 含 path/section/actual/expected/fix_hint；不写 approval/Delta |
| SMOKE-core-137 | 四方一致与零写副作用 | 对合法、双错误、操作错误、历史 marker fixture 运行 lint/status/next/flow，比较全量文件 hash | plan fixture 四方 ready/issue 同源；操作错误分层正确；所有只读命令零写；历史不回退 |
| SMOKE-core-138 | sync stamp、幂等与用户资产保护 | 隔离项目连续 sync 两次并重开 session；对托管/用户/未知资产前后 hash | stamp 含合同版本/hash；第二次 unchanged；新 session 读新 Skill；用户/未知资产逐字节不变 |
| SMOKE-core-139 | Codex plugin cache 同版本漂移识别 | 预置同 semver 旧 Skill 字节，再安装候选插件并触发发现/校验 | 缓存键含版本+hash；旧内容被拒绝/刷新，不静默复用；最终 Skill 与 tarball manifest 一致 |
| SMOKE-core-140 | 真实回滚恢复与公开副作用为零 | 同一全局 prefix 实际执行 `0.13.31 → 0.13.30 → 0.13.31`，每步新 shell 校验；最终重跑 SMOKE-core-136 最小正例 | 两包 SHA/入口/版本可证，最终恢复 0.13.31；无 publish/dist-tag/tag/release/官网/push；用户项目与真实 cache 未触达 |

### Reporter 合同

- 每个 ID 写一行，至少包含 `id/status/timestamp/duration_ms/environment`、候选/回滚 SHA、入口 realpath、Plan contract version 与脱敏 evidence 路径；失败含 error。
- 任一缺失、重复矛盾、skip、fail、环境/制品/hash 不匹配、runner 未发现或证据不完整，均不得生成 `SMOKE_PASS`。
- SMOKE-core-136/137 保存命令、exit code、issue 摘要、前后文件集合/hash；SMOKE-core-138/139 只保存资产元数据/hash，不保存用户 Skill 或对话正文。

### 清理与失败边界

- 仅清理本次创建且 realpath 已验证位于一次性根的目录；不得宽泛递归删除 HOME、仓库、全局 prefix 或未知路径。
- 失败保留脱敏证据并按部署方案恢复 0.13.30 或部署前状态；恢复失败必须显式阻塞，不写 SMOKE_PASS。
- 六项全绿只证明本机候选可安装、收敛、同步和回滚，不构成公开发布或 RunLogos 已适配的声明。

### 覆盖度校验

- [ ] 制品与资产 identity：SMOKE-core-135。
- [ ] 中英文 scaffold 与 issue：SMOKE-core-136。
- [ ] 四方一致、只读与历史：SMOKE-core-137。
- [ ] sync/new session/用户资产：SMOKE-core-138。
- [ ] Codex cache 漂移：SMOKE-core-139。
- [ ] 真实回滚与公开副作用为零：SMOKE-core-140。
