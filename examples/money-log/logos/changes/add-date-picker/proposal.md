# 变更提案：add-date-picker

## 变更原因
用户需求：记账页面增加选择日期的功能，可以补录之前日期的账单。默认显示当前日期。

## 变更类型
- [ ] 需求级
- [ ] 设计级
- [ ] 接口级
- [x] 代码级（功能增强）

## 变更范围
- 影响的业务场景：S01-快速记账
- 影响的代码文件：
  - src/main/database.js（saveRecord 方法需支持自定义日期）
  - src/main/index.js（IPC handler 需传递日期参数）
  - src/renderer/pages/AccountingPage.tsx（添加日期选择器 UI）

## 变更概述
在记账页面添加日期选择器，默认显示今天，用户可选择其他日期进行补账。数据库层面需支持自定义 created_at 时间戳。

## 变更状态
- [x] proposal.md 已填写
- [x] tasks.md 已填写
