## ADDED — OpenLogos 0.16.22 Windows 公开升级修复发布方案

目标为 prod。冻结发布提交 V 的 tag、npm dist-tags、当前生产站点部署标识，并下载及校验 0.16.21 官方回滚 tarball。沿用「OpenLogos 0.16.21 公开发布方案」的本机、非 root Linux 干净克隆、GitHub Linux 与 Windows CI、凭据四门及档 A～D。npm 版本与 tag 均空闲才可发布。发布后需要回退 npm 最新指针或弃用版本时，由用户另行确认。

### Windows 前置门

真实 Windows 回归模拟旧版已安装的环境。测试使用一次性 npm prefix 和可恢复的用户级 Path 夹具。通过 npm 安装候选包，再按相同用户环境在新 CMD 运行裸 `openlogos --version`。覆盖用户 Path 可修复的旧入口，以及机器级入口或当前目录遮蔽。后者须报告实际路径并核实绝对目标入口。保存版本、入口路径、退出码和 Path 前后证据。缺 Windows 执行证据时暂停打 tag。

### 发布、同步与回滚

在双 CI 成功的同一提交创建并推送 annotated tag。确认官方 npm 目标版本、可下载 tarball 和来源证明，GitHub Release 附件同源。官网中英文升级说明提供指定官方源的命令与 Windows 升级脚本，脚本属于同一提交。官网生成数据因 registry 传播过早读到旧版时沿用档 C，等待正式制品可取后补做站点。npmmirror 滞后时调用其现有同步通道并分别复核 `latest` 和 tarball URI，发布说明明确实际可用的来源。

将部署证据、官网发布数据和 Windows 验收状态写入仓库，依据实际 prod ref 落部署标记。公网 smoke 按现行门禁运行。公开回滚保留已发 tag，回退目标为 0.16.21 和上一生产站点。
