# S17: 管理模块注册表 — 测试用例

## 一、单元测试用例
| ID | 描述 | 来源 | 前置条件 | 输入 | 预期输出 |
|----|------|------|---------|------|---------|
| UT-S17-01 | 添加模块 | moduleAdd | 合法名称 | add | 写入模块 |
| UT-S17-02 | 重命名模块 | moduleRename | 现有模块 | rename | 更新 YAML 与引用 |
| UT-S17-03 | 恢复态 list 返回恢复 modules | moduleList | yaml 局部损坏但 AST 可恢复出 modules | `module list --format json` | data.modules 为恢复出的模块集合，envelope 附 `yaml_diagnostics`（`parse_status: "recovered"`） |
| UT-S17-04 | 不可恢复 yaml 报独立错误码 | module 命令族共用读取 | yaml 解析失败且 AST 无法恢复出 modules | list / add / rename / remove / set-product-type | 错误码 `PROJECT_YAML_UNPARSABLE`（附解析器原始错误与行号），**不得**输出 `MODULE_NOT_FOUND` 或空模块清单 |
| UT-S17-05 | 降级态写命令拒绝写回 | moduleAdd / moduleRename / moduleRemove / moduleSetProductType | yaml 局部损坏但可恢复（recovered 态） | add / rename / remove / set-product-type | 错误码 `PROJECT_YAML_DEGRADED_WRITE_REFUSED`，提示先修复 yaml；执行前后 `logos-project.yaml` 文件字节完全不变 |
| UT-S17-06 | MODULE_NOT_FOUND 语义收窄 | moduleSetProductType | yaml 正常解析（或已恢复出 modules），modules 中无目标 id | `set-product-type ghost web` | 错误码 `MODULE_NOT_FOUND`（仅此情形使用该码） |

## 二、场景测试用例
### 2.1 主路径
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S17-01 | 管理模块注册表 | Step 1→5 | 已初始化 | module add/rename/remove | YAML 与引用同步 |

### 2.2 异常路径：YAML 损坏错误分层
| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S17-02 | 坏 yaml 上 module 族错误分层 | Step 2→5（EX-3.2 / EX-3.3） | yaml 损坏（分别构造可恢复 / 不可恢复两态） | `module list` → `module set-product-type <真实id> web` → `module add x` | 可恢复态：list 返回恢复 modules + `yaml_diagnostics`，写命令报 `PROJECT_YAML_DEGRADED_WRITE_REFUSED`；不可恢复态：全族报 `PROJECT_YAML_UNPARSABLE`；全程 `logos-project.yaml` 字节不变 |
| ST-S17-03 | 与 status 读取口径一致 | Step 2（EX-3.3） | yaml 局部损坏但可恢复 | `status --format json` 与 `module list --format json` 各执行一次 | 两者可见的模块 id 集合一致；status 判定缺 product_type 的模块，module 族必须可见——不再出现「status 说缺、set 说无」分叉 |

## 三、module rename 跨平台路径测试（fix-windows-platform-compat）

> 覆盖架构文档「五十二、Windows 平台兼容约束」52.1-2（OS 路径只经 `node:path` API 拆解）；场景 S17「管理模块注册表」的 `module rename`；缺陷：`cli/src/commands/module.ts` 以 `lastIndexOf('/')` 拆解 `walkAndCollect` 产出的 OS 路径，Windows 下 yaml 已改名而文件改名 ENOENT，项目停在半重命名态。测试实现必须写入 OpenLogos reporter，测试名包含对应 ID，`scenario_id="S17"`。

### 单元测试

| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |
|---|---|---|---|---|
| UT-S17-07 | 改名目标路径由 path API 推导 | 以 `path.win32` 驱动改名路径推导函数；输入 `C:\p\logos\resources\prd\1-product-requirements\core-01-requirements.md`，旧名 `core`、新名 `billing` | 求改名目标 | 目标为同目录下的 `billing-01-requirements.md`（`C:\p\logos\resources\prd\1-product-requirements\billing-01-requirements.md`）；不产生相对 cwd 的路径；日志显示的 base 名同为 `billing-01-requirements.md`。**必红对照**：修复前实现得到 `billing-` 前缀拼在整条路径上的非法目标 |
| UT-S17-08 | 多级目录、多文件改名与引用更新正常完成 | 隔离项目：`logos/resources/` 下至少三级子目录中分布 3 个以上 `core-` 前缀文档，另有非 `core-` 前缀文档引用这些文件名；在 Windows CI 真实运行（POSIX 同跑作一致性对照） | 执行 `module rename core billing` | 退出码 0；yaml 模块名为 `billing`；每个原 `core-` 文件在**原目录**下改为 `billing-` 前缀，无文件被移出原目录或残留旧名；交叉引用按既有 `updateCrossReferences` 语义更新为新文件名；控制台列出的改名条目与引用更新条目显示为项目相对路径（不含项目根绝对前缀）；Windows 与 POSIX 两次运行的结果文件集合与内容逐字节一致 |

### 场景测试

| ID | 描述 | 覆盖 Steps | 前置条件 | 操作序列 | 预期结果 |
|----|------|-----------|---------|---------|---------|
| ST-S17-04 | Windows 真实 module rename | S17 rename 主路径 | **Windows CI job**（windows-latest，真实 NTFS）；一次性隔离项目，`logos/resources/` 多级子目录下含若干 `core-` 前缀文档；真实 CLI | ① 真实 `openlogos module rename core billing`；② 读回 yaml 与文件列表 | ① 退出码 0；② yaml 模块名为 `billing`；所有原 `core-` 前缀文件在原目录下改为 `billing-` 前缀，无文件残留旧名、无文件被移出原目录 |

### 追溯与覆盖

- OS 路径拆解（52.1-2）：UT-S17-07、ST-S17-04。
- 多级目录 / 多文件 / 引用更新正常完成与日志相对路径：UT-S17-08。
- 边界：本节只验证路径拆解修复；`module rename` 在任意 IO 失败下的整体回滚不属本案范围（`module.ts` 既有流程无事务，本案不新增）。
- ST-S17-04 属 Windows 回归集，必须在 CI `windows-latest` 阻断 job 中运行；夹具在一次性隔离项目内构造。
