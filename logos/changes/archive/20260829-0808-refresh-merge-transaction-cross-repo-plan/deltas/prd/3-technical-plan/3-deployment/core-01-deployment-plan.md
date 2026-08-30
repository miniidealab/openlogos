## ADDED — OpenLogos 0.14.0 merge transaction 本机全局 candidate 部署

### 部署目标与授权边界

本部署只把当前仓库构建出的 `@miniidealab/openlogos` `0.14.0` npm tarball 安装到本机全局环境，供安装态 smoke 和后续 RunLogos 真实跨仓 E2E 使用。它必须在 `openlogos verify` PASS 且用户明确授权部署后执行。

该授权不包含 `npm publish`、Git tag、GitHub Release、官网部署或 `git push`；部署脚本和 runner 的调用图不得包含这些命令。

### 部署前冻结

在改变全局安装前记录：

```bash
command -v openlogos
openlogos --version
npm prefix -g
npm root -g
npm list -g @miniidealab/openlogos --depth=0
```

部署报告必须保存旧命令绝对路径、精确版本 `0.13.31`、npm 全局 prefix/root、安装来源和可复制回滚命令。若无法证明旧版本恢复来源，不得覆盖全局安装。

### 构建与制品校验

在 `cli/` 内执行项目锁定的测试/build/prepack流程，再生成 tarball：

```bash
npm test
npm run build
npm pack
shasum -a 256 miniidealab-openlogos-0.14.0.tgz
```

`cli/package.json`、lockfile、插件/随包版本事实必须精确为 `0.14.0`。解包检查必须证明 tarball 含：

- `openlogos/merge-transaction@1` schema；
- next/status 更新后的 schema；
- 中文和英文 merge-executor Skill；
- contract hash/golden 所需资产；
- `merge-transaction status|seal|apply` 命令实现。

只生成 tarball而不安装，部署状态仍为未完成。

### 本机全局安装

```bash
npm install -g ./miniidealab-openlogos-0.14.0.tgz
hash -r 2>/dev/null || true
command -v openlogos
openlogos --version
openlogos merge-transaction --help
```

必须在新 shell 或清除命令缓存后验证：

1. `command -v openlogos` 指向预期全局 prefix 下的可执行文件；
2. `openlogos --version` 精确输出 `0.14.0`；
3. `merge-transaction --help` 暴露 status/seal/apply 且不暴露外部 manifest 成功入口；
4. 运行时 schema/contract hash 与 tarball 冻结值一致；
5. 全局二进制不通过仓库源码相对路径或开发 symlink 启动。

完成后按既有 `deploy-done` 合同记录环境、命令路径、版本、tarball 绝对路径/SHA-256、schema/contract hash 与回滚事实；禁止手写不含证据的 `DEPLOY_DONE`。

### 安装态 smoke 与 RunLogos 交接

部署完成后，在独立 smoke 人类门运行 `openlogos smoke`，覆盖 SMOKE-core-141～SMOKE-core-150。smoke PASS 后冻结以下 candidate facts 供 RunLogos companion change 消费：

- 全局 `openlogos` 绝对路径；
- 版本 `0.14.0`；
- tarball SHA-256；
- merge transaction schema hash 与 contract hash；
- OpenLogos smoke report/marker identity。

RunLogos 必须调用该绝对全局命令完成 CREATE、MODIFY、mixed、no-delta、validator retry、crash recovery 和 response-lost E2E。若下游使用源码路径、mock、手工 target/marker 或预造 receipt，验收无效。

### 回滚

出现安装失败、命令路径/版本错误、随包资产缺失、contract hash 漂移或安装态 smoke FAIL 时：

1. 停止向 RunLogos 宣布 candidate ready；
2. 使用部署前冻结的 0.13.31 安装来源执行可复制回滚命令；
3. 清除 shell 命令缓存并重新验证路径与 `openlogos --version`；
4. 记录失败阶段、候选 tarball hash、脱敏诊断、回滚命令和回滚结果；
5. 未恢复到已记录旧事实前，不得归档本提案。

回滚只恢复全局安装，不回退仓库内已提交规格/代码；后者遵循变更流程另行修复。

### 成功标准

- verify PASS；
- 0.14.0 tarball、SHA-256 与随包资产完整；
- 本机全局命令路径和版本正确；
- 安装态 smoke PASS；
- RunLogos 真实跨仓 E2E PASS；
- 无公开发布副作用；
- 回滚事实可复现。
