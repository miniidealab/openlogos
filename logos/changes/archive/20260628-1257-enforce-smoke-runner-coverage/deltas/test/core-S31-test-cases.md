## ADDED — smoke 用例变更下的切片闭环测试

### 一、单元测试用例补充
| ID | 描述 | 前置 | 输入 | 预期 |
|----|------|------|------|------|
| UT-S31-SMOKE-01 | `[code]` 切片描述必须携带新增 SMOKE ID | tasks.md `[code]` 行对应 smoke delta | change-writer output | 切片文本列出 `SMOKE-*`，并包含 runner/reporter/dispatcher 交付要求 |
| UT-S31-SMOKE-02 | smoke 覆盖预检未过时切片不得勾选 | 新增 smoke ID，runner/reporter 缺失 | code completion check | 该 `[code]` 行保持 `[ ]`，返回 smoke 覆盖诊断 |

### 二、场景测试用例补充
| ID | 描述 | 覆盖 | 操作 | 预期 |
|----|------|------|------|------|
| ST-S31-SMOKE-01 | 含 smoke 用例的切片完整闭环后才进入下一片 | 选片→code→verify→smoke precheck→勾片 | 第 1 片新增 `SMOKE-DRV-SMOKE-01`，实现业务代码、UT/ST、verify reporter、smoke runner/reporter/dispatcher 后执行预检 | 预检通过后才勾选第 1 片；下一次 `next` 指向第 2 个未勾切片 |

### 三、覆盖度校验补充
- [ ] smoke 切片任务描述完整：UT-S31-SMOKE-01
- [ ] smoke 覆盖预检阻止误勾切片：UT-S31-SMOKE-02
- [ ] smoke 切片端到端闭环：ST-S31-SMOKE-01
