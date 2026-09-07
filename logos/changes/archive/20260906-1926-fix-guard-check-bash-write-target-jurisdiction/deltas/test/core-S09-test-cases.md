# Delta: core-S09-test-cases.md

> change: fix-guard-check-bash-write-target-jurisdiction
> 目标：`logos/resources/test/core-S09-test-cases.md`

## ADDED — guard-check Bash 写命令路径级管辖判定测试用例

### 单元测试

| ID | 测试点 | 关键断言 |
|---|---|---|
| UT-S09-317 | Bash 写命令全外路径放行（回归锚：误拦必红→放行必绿） | launched 无提案 + 变量在场：`rm -rf <项目外绝对路径>`（session scratchpad 形态）、`cp <项目外→项目外>`、`mv <项目外→项目外>`、`mkdir <项目外>`、`touch <项目外>` → 一律 exit 0 放行；选项 flag（`-rf`、`-p`、`--`）被跳过不当作路径；既有 `>`/`>>` 重定向项目外目标放行不回归；**该组用例在修复前的 guard-check 上必须失败（无条件拦截 exit 2），修复后必须通过**——作为缺陷回归锚 |
| UT-S09-318 | 任一路径在内拦截 + 解析不出保守臂 + 三运行时一致（安全面零放宽） | ① `rm <项目内源码>`、混合形态 `cp <项目外> <项目内非白名单>`、`mv <项目内> <项目外>` → exit 2 且 stderr 含变更管理指引、stdout `{"reason":…}` JSON 结构不变；② 白名单目标（如 `touch logos/changes/x/a.md`）放行；③ 解析不出形态（`rm $VAR`、`rm $(cmd)`、`rm a.txt && rm b.txt`、反引号、管道复合）→ exit 2 维持现行拦截，不放宽；④ `BASH_SAFE_PATTERNS`（含 `git push`）先判放行优先级不变；⑤ 同批断言在 python3 归一化、node 归一化与 bash 兜底（PATH 屏蔽 python3/node）三运行时下结论一致 |

### 场景测试

| ID | 场景 | 关键断言 |
|---|---|---|
| ST-S09-122 | Bash 写命令项目外放行与项目内拦截端到端 | 以 stdin JSON + env + cwd 模拟 Claude Code hook 调用真实 guard-check 脚本：① launched 无提案对项目外目标（临时 HOME 下 `~/.claude` 形态路径与临时 scratchpad 目录）执行 `rm -rf`/`cp` → exit 0、后续写入可落盘；② 同一项目 `rm <项目内源码>` → exit 2、stderr 含变更管理指引、stdout JSON 可解析且 reason 与 stderr 文本语义一致；③ 解析不出形态（含 `$VAR` 与 `&&` 复合）→ exit 2；④ 创建提案（guard 文件在场）后重放② → exit 0 放行 |

### 自动化与证据要求

- guard-check 为 bash 脚本：用例以 spawnSync 直接驱动脚本（stdin JSON、cwd、env 三输入矩阵），同时捕获并断言 stdout 与 stderr 两通道，不 mock 文件系统。
- 每个用例通过 OpenLogos reporter 追加 `logos/resources/verify/test-results.jsonl`，`scenario_id="S09"`；失败不得写 pass。
