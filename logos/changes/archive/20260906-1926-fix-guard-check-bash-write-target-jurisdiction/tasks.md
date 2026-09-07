# 实现任务

## [delta] 规格变更

- [x] [MODIFY] `deltas/prd/1-product-requirements/core-01-requirements.md`：S09 补 Bash 写命令路径级管辖判定验收（全外放行/任一内拦截/解析不出 fail-closed）；S19 补 0.14.24 候选发布要求
- [x] [MODIFY] `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`：新增 2.66 Bash 写命令路径提取与管辖判定功能规格 + 0.14.24 候选内容清单与发布验收
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S09-change-lifecycle.md`：S09 guard-check Bash 判定时序补路径提取与逐路径管辖分支（含解析不出保守臂）
- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke-gate.md`：S19 新增 0.14.24 候选发布节（身份冻结→隔离矩阵→全局覆盖→smoke 与失败回滚边界）
- [x] [MODIFY] `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md`：新增 0.14.24 本机全局部署方案章节（隔离矩阵 + 0.14.23 误拦对照 + 回滚制品固定 0.14.23 tarball）
- [x] [MODIFY] `deltas/spec/pretooluse-guard.md`：Bash 写模式判定节补路径提取与逐路径管辖判定合同（放行判据、fail-closed 边界、三运行时一致）
- [x] [MODIFY] `deltas/test/core-S09-test-cases.md`：回归锚（项目外 rm/cp 误拦必红→放行必绿）/安全面零放宽/解析不出保守臂/三运行时一致（新 ID 自 UT-S09-317 / ST-S09-122 起）
- [x] [MODIFY] `deltas/test/core-S19-test-cases.md`：0.14.24 候选身份全源一致与回滚身份 0.14.23 tripwire（新 ID 自 UT-S19-41 起）
- [x] [MODIFY] `deltas/test/smoke/core-smoke-test-cases.md`：SMOKE-core-195（安装态项目外放行 + 项目内拦截零回归 + 0.14.23 误拦缺陷复现对照 + roundtrip）

## [code] 代码实现

> 六维打分：影响范围 1（plugin/bin/guard-check + 版本身份文件族 + runner + 两个测试文件）、行为复杂度 1（路径提取/逐路径判定/解析不出保守臂三分支）、契约变化 1（guard Bash 放行边界修复 + 候选身份推进，无 API/DB）、测试规模 1（5 个新 ID + 2 个旧 tripwire 演替）、风险 2（安全面判定 + 部署发布，回滚制品固定 0.14.23 tarball）、不确定性 0（缺陷机理已由 runlogos 生产实证与 bug report 定性，0.14.22/0.14.23 有同构发布先例）→ 6 分，非大任务，单切片。
> 删后续自检：单切片无后续可删。补充证伪：曾拟拆「guard-check Bash 判定修复片」+「0.14.24 身份与 runner 片」——guard-check 字节一改，asset-manifest 托管哈希（UT-S08-59 / UT-S19-38/39 既有断言）必须同步再生，而 manifest 再生与候选身份、SMOKE-core-195 runner 同属一次发布事实；后片单独做则路径提取新行为不存在，SMOKE-core-195 的项目外放行断言无字节可验，(b) 否。两片共享同一组身份/manifest 文件、互相咬死，向前合并为单片。
- [x] 单切片：guard-check Bash 写命令路径提取与逐路径管辖判定 + 0.14.24 候选身份与 SMOKE-core-195 runner——`plugin/bin/guard-check` Bash 分支对命中 `BASH_WRITE_PATTERNS` 的 `rm`/`cp`/`mv`/`mkdir`/`touch`/`chmod`/`chown` 结构化单命令形态跳过 `-` 开头选项 flag 提取全量路径实参（cp/mv 含源与目标），逐路径走既有 `is_whitelisted_path`（0.14.22 管辖边界 + 白名单）——全部路径在项目根之外或白名单内 → exit 0 放行，任一路径在项目内非白名单 → 维持 `block()` 双通道拦截；含变量展开/命令替换/反引号/管道/复合形态解析不出 → 维持现行无条件拦截（fail-closed 不放宽），`BASH_SAFE_PATTERNS`（含 `^git push`）优先级与 `>`/`>>` 重定向目标提取保持不变，python3/node/bash 兜底三运行时同判；0.14.24 候选身份全链同步（package/lockfile/五 plugin manifest/asset-manifest 再生/`LOCAL_RELEASE_CANDIDATE_VERSION=0.14.24`、`ROLLBACK=0.14.23`/UT-S19-39/40 tripwire 演替为版本无关锚）；新增 `scripts/smoke-guard-bash-0-14-24.js`（candidate identity 含随包 guard 新字节与 manifest 条目 + 安装态项目外 rm/cp/mkdir 放行 + 项目内拦截与安全白名单零回归 + 解析不出保守臂 + 固定 0.14.23 误拦缺陷复现对照 + 0.14.23↔0.14.24 roundtrip）并接入 `scripts/run-smoke.js` 注册表、写 `logos/resources/verify/smoke-results.jsonl`、完成后跑 smoke 覆盖预检；实现含 OpenLogos reporter 的 UT-S09-317～318、ST-S09-122、UT-S19-41、SMOKE-core-195

## [deploy] 部署任务
- [x] 按部署方案 0.14.24 章节执行隔离矩阵（SMOKE-core-195 runner：candidate identity、项目外放行/项目内拦截矩阵、0.14.23 误拦缺陷复现对照、roundtrip 回滚演练）
- [x] 矩阵与回滚演练 PASS 后，覆盖安装 0.14.24 tarball 到本机全局 prefix（`/opt/homebrew`），新 shell 复核 identity 全同源 0.14.24，并确认回滚预案（0.14.23 tarball，sha256 de042d28…07a5b）就位
