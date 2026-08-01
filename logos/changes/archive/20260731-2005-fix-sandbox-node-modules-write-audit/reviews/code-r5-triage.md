---
schema: runlogos/triage@1
slug: fix-sandbox-node-modules-write-audit
node: code
round: 5
responder:
  agent: "Claude Fable 5 (code-implementor)"
dispatch_id: drv-drv-ms8j4t5t-f62l-review-triage-962837
responses:
  - id: F1
    decision: fixed
    change_ref: "cli/src/lib/sandbox.ts copyBackAllowedFiles()：把可预测临时名 `<dest>.<pid>.olcbtmp` + `copyFileSync` 改为「不可预测随机名 + O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW 排他 no-follow 创建」——`openSync` 拿到 fd 后 `writeSync(fd, readFileSync(src))` 再 `closeSync`、`renameSync` 落盘；临时名用 `randomBytes(8)` 生成，EEXIST 冲突换随机名重试至多 3 次，且只清理本次确实由本进程创建（created 标志）的临时文件、绝不删除归属他人的 EEXIST 冲突对象；O_NOFOLLOW 在平台缺失该常量时按 0 处理（O_EXCL 已保证路径已存在即失败、绝不跟随既有 symlink），fail closed 为回收失败诊断。新增回归 cli/test/s13-verify.test.ts：internal-copyback-tmpleaf-symlink（预置 `result.txt.<pid>.olcbtmp -> victim.txt`：哨兵字节不变、结果落盘为普通文件、预置链接原样保留）、internal-copyback-tmp-collision（预置同名普通临时文件：不被覆盖/删除，结果正常回收）"
    reason: "成立。评审 file:line 复现无误——旧实现固定临时名叠加 copyFileSync 跟随预置 symlink，可信回收阶段仍能截断改写非白名单 victim.txt 并把结果路径变成 symlink，且命令/沙箱报 PASS。已按正文建议修法落地：O_CREAT|O_EXCL|O_NOFOLLOW 排他 no-follow + 不可预测名 + fd 写入 + 冲突重试/结构化失败，并补齐正文点名的临时叶节点 symlink 与同名普通文件碰撞两条回归。"
---

# Code 第 5 轮 triage 结论

F1（insisted）成立、处置为 fixed。这是 r1-F1 copy-back 加固后残留的最后一个越界写入面：临时落盘文件本身的创建仍可预测且会跟随 symlink。修法把临时文件创建改为 `openSync` 的 `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` 排他 no-follow 语义 + 不可预测随机名 + 冲突重试，从根上杜绝「跟随预置临时叶节点 symlink」和「覆盖用户同名文件」两种情形。F2、F3 本轮已由评审判 resolved，无动作。CLI 全量测试 1511/1511 通过（新增 2 条回归）。
