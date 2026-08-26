## ADDED — 测试变更语义修复 v0.13.30 本机全局部署方案

### 一、部署目标与授权边界

- 部署对象：本仓库完成 build/test 后由 `npm pack` 生成的真实 `@miniidealab/openlogos@0.13.30` tarball。
- 目标环境：本机当前 npm 全局 prefix；验证项目必须是一次性 fixture，不得对本仓库活跃提案执行 merge 事故夹具。
- 前置门禁：规格已合并、代码和 reporter 已完成、`openlogos verify` PASS，且用户另行明确授权部署。
- 本节只定义部署方案，不构成当前部署、smoke 或公开发布授权。
- 禁止 `npm publish`、dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署、`git push`，也禁止以公开 registry 包或 workspace link 代替本次制品。

### 二、部署前快照与回滚输入

1. 解析并记录当前 `openlogos` 命令 realpath、shell command resolution、npm global prefix、全局包名/版本和插件版本；刷新 shell hash 后重复确认。
2. 固定可离线恢复的真实 `0.13.29` tarball，记录绝对路径、包名、版本、字节数、文件清单与 SHA-256；不得把临时网络下载作为唯一回滚来源。
3. 对当前全局安装包清单及关键入口计算 SHA-256，记录安装前状态；不得读取或记录 npm token、registry 凭据或其它秘密。
4. 创建仅用于验证的一次性 fixture/evidence 根，核验 realpath 不等于仓库根、真实用户项目、`$HOME`、`~` 或 `/`；失败证据须脱敏。
5. 任一版本、路径、权限或回滚制品不可证时停止，不卸载或覆盖当前全局包。

### 三、候选制品构建与身份核验

1. 按锁文件执行仓库既有依赖、build、全部 UT/ST 和 OpenLogos reporter 完整性检查；任何失败都阻止 pack/install。
2. 在 `cli/` 运行真实 `npm pack`，记录 tarball 绝对路径、包名、精确版本 `0.13.30`、大小和 SHA-256。
3. 校验 `cli/package.json`、`cli/package-lock.json` 根包版本、Claude/Codex/ZCode/Qoder/WorkBuddy 有版本字段的 plugin manifest 与 tarball 元数据均为 `0.13.30`；无版本字段的目录不得新增伪字段。
4. 列出 tarball 内容，确认包含编译后 CLI、各既有插件资产、`spec/test-slice-manifest.md`、`spec/baseline-closure.md`、运行时和 smoke dispatcher/runner/reporter；禁止源码直跑或目录/link 安装。
5. 对候选 tarball 做一次只读解包核验；解包内容、package metadata 与记录 SHA-256 不一致即失败。

### 四、本机全局安装与入口证明

1. 保存部署前快照后，从已固定候选 tarball 安装到已记录的 npm global prefix；安装命令必须显式引用本地 tarball。
2. 刷新 shell command cache，在新 shell 中解析 `openlogos` realpath，必须位于该全局 prefix 的候选包入口；不得命中仓库源码、workspace link、临时 prefix 或旧缓存。
3. 执行 `openlogos --version` 并读取全局 package/plugin metadata，全部应精确为 `0.13.30`；比较 tarball 清单中的关键文件 hash。
4. 在一次性 fixture 项目仅执行无破坏性的 status/version/协议资产读取，证明安装态 CLI 可启动且 TestChangeSetReader 资产随包；本阶段不运行事故 merge 或写本仓库 marker。
5. 记录安装命令、exit code、prefix、realpath、版本、关键文件 SHA-256 与 fixture 路径；所有证据必须可关联候选 tarball hash。

### 五、实际回滚与恢复演练

1. 候选入口证明通过后，从固定本地 `0.13.29` tarball 替换全局安装；刷新新 shell，确认 realpath 仍在同一 prefix、版本精确为 `0.13.29`，并执行上一版最小只读入口检查。
2. 再从原始候选 tarball 恢复 `0.13.30`，重复 realpath、版本、package/plugin metadata、关键文件 hash 与最小启动检查。
3. 两次切换都必须引用已记录 SHA-256 的本地 tarball；不得在回滚中从 registry 解析 latest 或重新打包一个“等价”版本。
4. 任一步失败立即尝试恢复部署前快照所指版本和入口；若恢复也失败，明确报告全局环境处于未恢复状态并停止，不产生部署完成标记。
5. 回滚/恢复不删除未知全局包、真实用户项目、配置或凭据；仅替换本次明确识别的 OpenLogos 全局包。

### 六、失败处理与证据

- build/test/pack/版本/清单/SHA、全局安装、入口、回滚或恢复任一失败即部署 FAIL，保留脱敏命令、stderr、exit code 与具体制品。
- `deployment-report.md` 必须记录部署前快照、候选/回滚 tarball、安装与两次切换、最终全局状态、失败处置和公开副作用审计。
- 报告必须逐项声明未执行 npm publish/dist-tag、Git tag、GitHub Release、官网/Cloudflare 部署与 `git push`。
- 部署通过后只说明 `0.13.30` 已安装并可回滚；仍须用户独立授权后，才可执行 SMOKE-core-130～SMOKE-core-134。

### 七、完成判据

- 候选与回滚 tarball 的包名、版本、清单、大小和 SHA-256 均固定且可离线读取。
- 本机全局实际入口来自 `0.13.30` tarball，版本和所有既有 plugin 版本元数据一致。
- `0.13.30 → 0.13.29 → 0.13.30` 已真实完成，每一步入口、版本与 tarball identity 可证。
- 最终全局状态为 `0.13.30`，临时 fixture 未触达本仓库活跃提案或真实用户项目。
- deployment report 完整，公开发布与 push 副作用为零，并停在独立 smoke 授权点。
