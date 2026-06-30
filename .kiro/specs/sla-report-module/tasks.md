# Implementation Plan：SLA 报告模块（SLA_Report_Module）

## Overview

本计划将设计文档转化为一系列可由代码生成 LLM 增量实现的编码任务。实现语言为 **JavaScript**（与设计一致），属性测试使用 **fast-check**。任务遵循项目约定：仅新增数据库表（`createTable`，绝不改动 `heartbeat`/`monitor`）、通过 Socket.IO 通信、用 `checkLogin` 鉴权、失败隔离。每个任务都基于先前任务的产物构建，最终将所有组件接线集成，不留孤立代码。

完成时按项目要求运行 `npm run build && npm test`，并通过 `npm run lint` 与 `npm run fmt`。

实现约定：

- 标注 `*` 的子任务为可选的测试任务（单元/属性/集成/基准），可为加速 MVP 而跳过。
- 每个属性测试至少运行 100 次迭代，并以注释标注：`Feature: sla-report-module, Property {n}: {属性文本}`。
- 设计中的 15 条正确性属性，每条由**单个**属性测试实现。

## Tasks

- [x] 1. 搭建报告模块结构与数据库迁移
  - [x] 1.1 添加依赖并创建后端模块骨架
    - 在 `package.json` 的 `dependencies` 添加 `pdfkit`（后端运行时 PDF 生成），在 `devDependencies` 添加 `fast-check`（属性测试）
    - 创建 `server/report/` 目录与骨架文件：`report-metrics.js`、`report-data-access.js`、`report-generator.js`、`report-exporter.js`、`report-scheduler.js`，各文件导出占位函数并带 JSDoc
    - _Requirements: 4.1_

  - [x] 1.2 创建仅含 createTable 的数据库迁移
    - 在 `db/knex_migrations/` 新增迁移文件，`up` 仅用 `createTable` 新建 `report_schedule`、`report_schedule_monitor`、`report_run_log` 三张表（列名 snake_case，按设计的数据模型定义）
    - `report_schedule_monitor.schedule_id`、`report_run_log.schedule_id`、`report_schedule_monitor.monitor_id` 建索引；不对现有表添加外键或做任何 `alterTable`
    - `down` 按反序 `dropTableIfExists` 三张表
    - _Requirements: 9.1, 9.3, 9.4_

  - [ ]* 1.3 编写迁移约定核查测试
    - 验证迁移可 up/down 往返，且仅创建三张新表、不修改 `heartbeat`/`monitor` 表结构
    - _Requirements: 9.3, 9.4_

- [x] 2. 实现纯函数指标层（`server/report/report-metrics.js`）
  - [x] 2.1 实现 `calculateAvailability`
    - 计算 `up/(up+down)`，从分母中排除 `MAINTENANCE`（status=3）区间；无受监控数据时返回 `null` 而非 `0`，并使事件/响应时间指标可被置为 `null`
    - 复用状态常量 `0=DOWN`、`1=UP`、`2=PENDING`、`3=MAINTENANCE`
    - _Requirements: 2.1, 2.2, 2.7_

  - [ ]* 2.2 编写属性测试 Property 3（可用性计算正确性）
    - **Property 3: 可用性计算正确性**
    - **Validates: Requirements 2.1, 2.2, 2.7**
    - 生成器需覆盖：空序列、全 DOWN、全 UP、含 MAINTENANCE；断言结果落在 [0,100]、加入 MAINTENANCE 不改变结果、无数据时为 null

  - [x] 2.3 实现总在线/离线时长计算
    - 在指标层计算每个 Monitor 在 Time_Range 内的总在线时长与总离线时长（排除维护时间）
    - _Requirements: 2.3_

  - [ ]* 2.4 编写属性测试 Property 4（在线与离线时长守恒）
    - **Property 4: 在线与离线时长守恒**
    - **Validates: Requirements 2.3**

  - [x] 2.5 实现 `detectIncidents`
    - 返回极大的连续 `DOWN` 区间数组（起始、结束、时长；未解决事件结束为 `null`）
    - _Requirements: 2.4_

  - [ ]* 2.6 编写属性测试 Property 5（事件检测正确性）
    - **Property 5: 事件检测正确性**
    - **Validates: Requirements 2.4**
    - 生成器覆盖未解决（无结束）的 Incident 边界

  - [x] 2.7 实现 `calculateMTTR`
    - 返回已解决 Incident 持续时长的算术平均；无已解决事件时返回 `null`
    - _Requirements: 2.5_

  - [ ]* 2.8 编写属性测试 Property 6（MTTR 等于已解决事件平均时长）
    - **Property 6: MTTR 等于已解决事件的平均时长**
    - **Validates: Requirements 2.5**

  - [x] 2.9 实现 `calculateResponseTimeStats`
    - 返回 `{min, max, avg}`（基于含响应时间的心跳）；无样本时三者均为 `null`
    - _Requirements: 2.6_

  - [ ]* 2.10 编写属性测试 Property 7（响应时间统计量有序且取自样本）
    - **Property 7: 响应时间统计量有序且取自样本**
    - **Validates: Requirements 2.6**

  - [x] 2.11 实现 `formatPercentage`
    - 将数值格式化为恰好两位小数的字符串；输入 `null` 时返回 `null`
    - _Requirements: 2.8_

  - [ ]* 2.12 编写属性测试 Property 8（可用性百分比保留两位小数）
    - **Property 8: 可用性百分比保留两位小数**
    - **Validates: Requirements 2.8**

- [x] 3. 检查点 - 确保指标层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. 实现请求校验与时间范围解析（`server/report/report-generator.js`）
  - [x] 4.1 实现 `resolveTimeRange`
    - 对 `daily`/`weekly`/`monthly` 由 `referenceDate` 推导范围；`custom` 使用显式 `start`/`end`
    - _Requirements: 1.2, 1.3, 1.4_

  - [ ]* 4.2 编写属性测试 Property 2（Time_Range 推导不变式）
    - **Property 2: Time_Range 推导不变式**
    - **Validates: Requirements 1.4**

  - [x] 4.3 实现 Report_Request 校验
    - 按设计校验顺序：`periodType` 枚举、`custom` 必含 `start`/`end`、`start > end` 拒绝、每个 `monitorId` 必须存在于 `monitor`（缺失时错误消息指明缺失标识符）、至少一个 `monitorId`
    - 校验失败返回可国际化的验证错误消息键，不触碰监控运行
    - _Requirements: 1.3, 1.5, 1.6, 6.1_

  - [ ]* 4.4 编写属性测试 Property 1（请求校验规则）
    - **Property 1: 请求校验规则**
    - **Validates: Requirements 1.3, 1.5, 1.6**

  - [ ]* 4.5 编写 Period_Type 合法枚举单元测试
    - 验证 `daily`/`weekly`/`monthly`/`custom` 四个合法枚举均被接受
    - _Requirements: 1.2_

- [x] 5. 实现 DB 访问层（`server/report/report-data-access.js`）
  - [x] 5.1 实现 `fetchHeartbeats`
    - 以 `monitor_id` + `time BETWEEN` 索引查询，按时间升序返回；只读，不写 `heartbeat`
    - _Requirements: 7.1, 7.3_

  - [x] 5.2 实现 `fetchAggregatedStats` 与数据源选择策略
    - 长时间范围读取预聚合 `stat_daily`/`stat_hourly`/`stat_minutely`；按范围跨度阈值在原始 heartbeat 与 stat 之间选择
    - _Requirements: 7.4_

  - [x]* 5.3 编写数据源选择单元测试
    - 验证长范围走 stat 表、短范围走原始 heartbeat
    - _Requirements: 7.4_

- [x] 6. 实现 Report_Generator 编排（`server/report/report-generator.js`）
  - [x] 6.1 实现 `generate`
    - 编排：校验 → 取数（data-access）→ 调用纯函数指标层 → 汇总为 Report_Result；支持多个 `monitorId`，所有监控共享同一 Time_Range
    - 缺失数据按设计以 `null` 表达
    - _Requirements: 1.1, 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 6.1, 6.2_

  - [ ]* 6.2 编写属性测试 Property 13（多监控逐一计算且共享一致 Time_Range）
    - **Property 13: 多监控逐一计算且共享一致的 Time_Range**
    - **Validates: Requirements 6.2**

  - [ ]* 6.3 编写按需生成编排单元测试
    - 验证单监控按需生成端到端编排返回 Report_Result
    - _Requirements: 1.1_

- [x] 7. 检查点 - 确保生成器测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. 实现 Report_Exporter（`server/report/report-exporter.js`）
  - [x] 8.1 实现 `exportCsv`
    - 生成 UTF-8（含 BOM）CSV，包含每个监控的可用性指标与 Incident 记录、Time_Range 与生成时刻；多监控报告包含请求中的每个监控
    - _Requirements: 4.2, 4.3, 4.5, 6.4_

  - [x]* 8.2 编写属性测试 Property 9（CSV 导出完整性与 UTF-8 往返）
    - **Property 9: CSV 导出完整性与 UTF-8 往返**
    - **Validates: Requirements 4.2, 4.3, 4.5, 6.4**
    - 生成器覆盖含非 ASCII/Unicode 文本

  - [x] 8.3 实现 `exportPdf`
    - 用 `pdfkit` 渲染 PDF Buffer，包含可用性指标、图表区与事件记录、Time_Range 与生成时刻
    - _Requirements: 4.1, 4.3_

  - [ ]* 8.4 编写导出失败注入与错误隔离单元测试
    - 注入导出失败，断言抛出指明失败格式的错误且不影响监控
    - _Requirements: 4.4, 10.1_

- [x] 9. 实现 Schedule 持久化与保存校验（`server/report/report-scheduler.js`）
  - [x] 9.1 实现 Schedule 持久化读写
    - 实现保存/加载/列出/删除 Schedule 的助手：将 `report_schedule` 行与其 `report_schedule_monitor` 成员一并往返
    - _Requirements: 5.2, 9.1_

  - [x]* 9.2 编写属性测试 Property 10（Schedule 持久化往返）
    - **Property 10: Schedule 持久化往返**
    - **Validates: Requirements 5.2, 9.1**

  - [x] 9.3 实现 Schedule 保存校验
    - 启用邮件投递但系统中无任何已配置 SMTP_Channel 时，拒绝保存并返回提示配置邮件的验证错误
    - _Requirements: 5.7_

  - [x]* 9.4 编写属性测试 Property 12（无 SMTP 配置时拒绝启用邮件的 Schedule）
    - **Property 12: 无 SMTP 配置时拒绝启用邮件的 Schedule**
    - **Validates: Requirements 5.7**

- [x] 10. 实现 Report_Scheduler 调度执行（`server/report/report-scheduler.js`，作业进程）
  - [x] 10.1 实现 `runSchedule`
    - 禁用（`active=0`）时跳过；启用时生成 → 导出 → 用存储的 SMTP 配置构建 nodemailer transporter 投递附件 → 写 `report_run_log`；邮件失败记为 `failed` 并保留 Schedule
    - _Requirements: 5.3, 5.4, 5.5_

  - [x]* 10.2 编写属性测试 Property 11（禁用的 Schedule 不生成报告）
    - **Property 11: 禁用的 Schedule 不生成报告**
    - **Validates: Requirements 5.5**

  - [x] 10.3 实现 `loadAndSchedule`
    - 启动时从 `report_schedule` 加载并用 `croner` 注册周期性作业，运行于 `server/jobs/` 作业进程，不阻塞监控检测
    - _Requirements: 5.6, 9.2_

  - [x] 10.4 实现多 Schedule 错误隔离循环
    - 对每个 Schedule 独立 try/catch；单个失败记录到 `report_run_log` 并继续处理其余 Schedule
    - _Requirements: 10.2_

  - [x]* 10.5 编写属性测试 Property 15（调度运行的错误隔离）
    - **Property 15: 调度运行的错误隔离**
    - **Validates: Requirements 10.2**

  - [ ]* 10.6 编写邮件失败记录单元测试
    - 注入 nodemailer 发送失败，断言写入 `failed` 运行记录且 Schedule 保留
    - _Requirements: 5.4_

- [x] 11. 检查点 - 确保后端测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 实现 Socket.IO 事件处理与鉴权（`server/socket-handlers/report-socket-handler.js`）
  - [x] 12.1 实现报告相关 Socket.IO 事件
    - 实现 `generateReport`、`exportReport`、`getReportSchedules`、`getReportSchedule`、`addReportSchedule`、`editReportSchedule`、`deleteReportSchedule`、`getReportRunLogs`，统一回调形态 `{ ok, ... | msg }`
    - 每个 handler 入口经 `checkLogin(socket)`，未通过则返回鉴权错误且不执行任何业务逻辑；接线到 Report_Generator/Exporter 与 Schedule 持久化/校验
    - _Requirements: 8.1, 8.2, 8.3, 1.1, 4.1, 4.2, 5.1_

  - [x]* 12.2 编写属性测试 Property 14（未通过身份验证的报告事件被拒绝）
    - **Property 14: 未通过身份验证的报告事件被拒绝**
    - **Validates: Requirements 8.2**

  - [x] 12.3 注册 handler 到服务器
    - 在 `server/server.js` 的 socket handler 注册区调用 `reportSocketHandler(socket)`（与 `maintenanceSocketHandler`、`generalSocketHandler` 等并列注册）
    - _Requirements: 8.1_

  - [x]* 12.4 编写非 Admin 被拒单元测试
    - 验证未通过身份验证的客户端调用各报告事件均返回鉴权错误
    - _Requirements: 8.3_

- [x] 13. 前端国际化与 socket 接线
  - [x] 13.1 添加用户可见文本键
    - 将报告模块所有用户可见字符串以键定义于 `src/lang/en.json`（仅此文件）
    - _Requirements: 11.1, 11.2_

  - [x] 13.2 在 socket mixin 添加报告方法
    - 在 `src/mixins/socket.js` 添加调用报告事件的方法，封装回调
    - _Requirements: 8.1_

- [x] 14. 实现前端组件与页面
  - [x] 14.1 实现 `src/components/report/ReportConfigForm.vue`
    - 多选监控、Period_Type、自定义起止、导出格式；提交 `generateReport`；文本走 i18n 键
    - _Requirements: 1.2, 6.1, 11.2_

  - [x] 14.2 实现 `AvailabilityChart.vue` 与 `ResponseTimeChart.vue`
    - 复用 chart.js + vue-chartjs 的现有 Vue 3 组件模式渲染可用性与响应时间趋势图
    - _Requirements: 3.1, 3.2, 3.5_

  - [ ]* 14.3 编写图表组件测试
    - 验证可用性图表与响应时间趋势图正常渲染
    - _Requirements: 3.1, 3.2_

  - [x] 14.4 实现 `IncidentTimeline.vue`
    - 渲染每个事件的起止与时长；无事件时展示空状态提示而非空图表
    - _Requirements: 3.3, 3.4_

  - [ ]* 14.5 编写事件时间线空状态组件测试
    - 验证无事件时展示空状态提示
    - _Requirements: 3.4_

  - [x] 14.6 实现 `MonitorComparisonTable.vue`
    - 多监控对比视图，所有监控共享同一 Time_Range 标签
    - _Requirements: 6.3_

  - [ ]* 14.7 编写多监控对比组件测试
    - 验证对比视图按监控呈现指标且共享一致 Time_Range
    - _Requirements: 6.3_

  - [x] 14.8 实现 `ReportView.vue` 并注册路由
    - 组合配置表单、图表、事件时间线与对比视图；在 `src/router.js` 注册路由
    - _Requirements: 1.1, 3.1, 3.2, 3.3_

  - [x] 14.9 实现 `ReportSchedules.vue` 与 `ReportScheduleForm.vue` 并注册路由
    - Schedule 增删改查与运行日志查看；保存启用邮件但无 SMTP 配置时展示验证错误；在 `src/router.js` 注册路由
    - _Requirements: 5.1, 5.7_

  - [x] 14.10 集成接线与可用性修复 - 添加导航入口与图标
    - 在 `src/layouts/Layout.vue` 下拉菜单添加「SLA Report」(/report) 与「Report Schedules」(/report-schedules) 导航入口；在 `src/icon.js` 注册所需 FontAwesome 图标（chart-bar、clock）
    - _Requirements: 3.5, 5.1_

  - [x] 14.11 集成接线与可用性修复 - 启动时恢复持久化计划
    - 在 `server/jobs.js` 的 `initBackgroundJobs()` 中调用 `loadAndSchedule()` 以在启动时恢复持久化计划，并用 try/catch 隔离失败
    - _Requirements: 9.2, 10.2_

  - [x] 14.12 集成接线与可用性修复 - 输出可用性时间序列
    - 在指标层新增 `calculateAvailabilityTimeSeries`，并在 `report-generator.generate` 中输出 `availabilityTimeSeries`，使前端可用性图表能正确渲染
    - _Requirements: 3.1_

  - [x] 14.13 集成接线与可用性修复 - 补充简体中文翻译
    - 在 `src/lang/zh-CN.json` 补充报告模块的简体中文翻译（`en.json` 已含全部键），确保中英文均可用
    - _Requirements: 11.1, 11.2_

  - [x] 14.14 修复响应时间图表数据形状
    - 在指标层新增 `calculateResponseTimeSeries`（分桶返回 {time,min,avg,max}），并在 `report-generator.generate` 输出 `responseTimeSeries`，使前端响应时间图表能正确渲染
    - _Requirements: 3.2_

  - [x] 14.15 对齐计划表单与后端契约
    - `ReportScheduleForm.vue` 提交改为后端期望的 camelCase（periodType/cronExpression/exportFormat/monitorIds），并修正 `ReportSchedules.vue`/编辑回显的字段引用，修复此前计划无法保存与不回显的问题
    - _Requirements: 5.1, 5.2_

  - [x] 14.16 接通 SMTP 邮件投递
    - 表单新增 SMTP 通知选择并提交 smtpNotificationId 与 emailEnabled；后端 `validateScheduleSave` 强制「启用邮件却无有效 SMTP 通知则拒绝」
    - _Requirements: 5.3, 5.7_

  - [x] 14.17 接通长范围预聚合数据源
    - 在 `report-generator.generate` 中按 `shouldUseAggregatedStats` 分支，新增 `computeFromAggregatedStats`，从 `stat_daily/hourly/minutely` 计算可用性、响应时间与按桶序列；uptime/downtime 按 up/down 比例估算，事件按桶粒度近似检测
    - 导出 `selectStatTable`/`getStatBucketSeconds` 与一组聚合纯函数（`calculateAggregatedAvailability` 等）
    - _Requirements: 7.4_

- [x] 15. 检查点 - 确保前端构建与组件测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. 集成测试与性能基准
  - [x]* 16.1 编写 Socket.IO 往返集成测试
    - 通过 Socket.IO 交换 Report_Request / Report_Result
    - _Requirements: 8.1_

  - [x]* 16.2 编写启动恢复调度集成测试
    - 启动时从持久化 Schedule 恢复 croner 调度
    - _Requirements: 9.2_

  - [x]* 16.3 编写计划运行端到端集成测试
    - mock nodemailer transporter，验证生成 → 导出 → 投递链路
    - _Requirements: 5.3_

  - [x]* 16.4 编写并发事件不受阻塞集成测试
    - 报告生成期间并发触发其他 Socket.IO 事件仍正常响应
    - _Requirements: 7.2_

  - [x]* 16.5 编写保留现有功能回归测试
    - 启用报告功能后，监控检测、通知、状态页与维护窗口行为不变
    - _Requirements: 10.3_

  - [x]* 16.6 编写性能基准测试
    - 构造约 100,000 行 Heartbeat，断言 `generate` 在 10 秒内返回；验证命中 `monitor_id` + `time` 索引、长范围使用预聚合 stat 表
    - _Requirements: 7.1, 7.3, 7.4_

- [x] 17. 最终检查点 - 构建、测试与代码规范
  - 运行 `npm run build && npm test`；通过 `npm run lint`（ESLint + Stylelint）与 `npm run fmt`（Prettier）
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标注 `*` 的子任务为可选测试任务，可为加速 MVP 而跳过；核心实现任务不会被标记为可选。
- 每个任务引用具体需求子条款编号以保证可追溯性。
- 检查点用于增量验证。
- 属性测试验证设计中的 15 条普适正确性属性（每条由单个属性测试实现，≥100 次迭代，按约定标签标注）；单元/集成/基准测试补充具体场景、端到端链路与非功能约束。
- 严格遵循项目约定：仅新增数据库表（绝不改动 `heartbeat`/`monitor`）、Socket.IO 通信、`checkLogin` 鉴权、用户可见文本仅写入 `src/lang/en.json`。
- 需求 7.4 已接入：`generate` 现按 `shouldUseAggregatedStats`（跨度 > 2 天）切换数据源，长范围从预聚合 stat 表计算可用性/响应时间/按桶序列，避免全表扫描；其中 uptime/downtime 为按 up/down 比例的估算，事件为桶粒度的近似检测（精确事件边界仍走短范围原始 heartbeat 路径）。需求 7.1 的 10 秒性能已通过 10 万行原始数据基准验证。

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "2.1", "5.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "5.2"] },
    { "id": 3, "tasks": ["2.4", "2.5", "5.3", "4.1"] },
    { "id": 4, "tasks": ["2.6", "2.7", "4.2", "4.3"] },
    { "id": 5, "tasks": ["2.8", "2.9", "4.4", "4.5"] },
    { "id": 6, "tasks": ["2.10", "2.11"] },
    { "id": 7, "tasks": ["2.12", "6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3", "8.1"] },
    { "id": 9, "tasks": ["8.2", "8.3"] },
    { "id": 10, "tasks": ["8.4", "9.1"] },
    { "id": 11, "tasks": ["9.2", "9.3"] },
    { "id": 12, "tasks": ["9.4", "10.1"] },
    { "id": 13, "tasks": ["10.2", "10.3"] },
    { "id": 14, "tasks": ["10.4"] },
    { "id": 15, "tasks": ["10.5", "10.6", "12.1"] },
    { "id": 16, "tasks": ["12.2", "12.3", "12.4", "13.1"] },
    { "id": 17, "tasks": ["13.2"] },
    { "id": 18, "tasks": ["14.1", "14.2", "14.4", "14.6"] },
    { "id": 19, "tasks": ["14.3", "14.5", "14.7", "14.8"] },
    { "id": 20, "tasks": ["14.9"] },
    { "id": 21, "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6"] }
  ]
}
```
