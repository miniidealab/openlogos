## ADDED — OpenLogos 0.14.2 Preflight/Reopen 安装态 Smoke

### 前置与授权

仅在verify PASS、固定0.14.2 tarball完成隔离验证并获得smoke明确授权后执行。SMOKE-core-162还需单独获得RunLogos恢复/继续merge授权。runner必须使用安装态绝对`openlogos`入口，不得源码直跑。

### 冒烟测试用例

| 用例ID | 场景 | 执行步骤 | PASS判据 |
|---|---|---|---|
| SMOKE-core-160 | 新事务seal preflight | 安装态CLI创建含歧义after测试表的事务，提交全部slots并seal；随后修正missing slot、reseal/apply | 首次seal前退回collecting且零正式/apply私有写；next指向submit_content；修正后completed receipt/marker有效 |
| SMOKE-core-161 | 0.14.1 legacy sealed兼容与回滚 | 加载无preflight record的sealed fixture；apply触发局部reopen；保留无关slots，修正后完成；演练0.14.1↔0.14.2 | 同transaction/plan/target-set；只有rejected missing；新seal后completed；每次版本/入口/资产hash一致，无混装 |
| SMOKE-core-162 | RunLogos真实事务恢复 | 在RunLogos根读取`mtx_7e0341e3719feccd22ef7615`；apply、核对missing、修正UT-S44-24声明slot、submit/reseal/apply | 仅S44 slot退回、其余14个保留；正式写前无journal/marker；同transaction最终completed，receipt/test-change-set/SPEC_MERGED可复算 |

### Runner 与 Dispatcher

- `scripts/run-smoke.js`或受控子runner必须显式分派SMOKE-core-160～162，记录实际安装态命令路径、版本、tarball SHA-256和fixture/项目根。
- SMOKE-core-160/161使用隔离临时项目并清理；SMOKE-core-162不得复制或伪造RunLogos transaction，只能在授权后使用真实项目。
- 任一步fatal、drift、journal/recovery错误立即停止，不abort或新建transaction掩盖。

### OpenLogos Smoke Reporter

每个ID向`logos/resources/verify/smoke-results.jsonl`写`id/status/timestamp/duration_ms/environment/evidence`；evidence至少绑定CLI realpath/version、candidate hash、transaction ID和关键before/after hashes。三个ID全部真实PASS后才可生成smoke报告/SMOKE_PASS；缺runner、缺reporter、mock或源码直跑均FAIL。

### 失败与回滚

安装态失败先恢复固定0.14.1并核验全部身份；RunLogos失败不伪造completed/receipt/marker。smoke失败不触发archive、公开发布或git push。
