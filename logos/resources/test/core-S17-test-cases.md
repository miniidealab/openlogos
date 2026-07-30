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
