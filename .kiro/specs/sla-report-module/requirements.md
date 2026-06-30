# Requirements Document

## Introduction

SLA 报告模块为 Uptime Kuma v2.0 扩展了针对受监控服务的可用性报告能力。它允许管理员在可配置的时间
范围内生成在线/离线报告，查看图表（可用性百分比、响应时间趋势、事件时间线），将报告导出为 PDF 或
CSV，按计划周期性地生成报告并通过电子邮件发送，以及将多个监控项合并为单个对比报告。

该模块从 SQLite 数据库读取现有的 Heartbeat 数据，通过现有的 Socket.IO 通道与前端通信，遵循现有的
Vue 3 组件模式，并在不干扰正在进行的监控的前提下运行报告生成。它的设计目标是在查询大型 Heartbeat
数据集（至少 100,000 行）时仍然保持响应能力。

本文档仅规定功能性与非功能性需求。它不规定具体实现；技术决策属于设计阶段。

## Glossary

- **SLA_Report_Module**：本文档所描述的整体功能，包含报告生成、可视化、导出、计划调度以及对比能力。
- **Report_Generator**：后端组件，负责读取 Heartbeat 数据，并在某一时间范围内为一个或多个监控项
  计算报告指标。
- **Report_Scheduler**：后端组件，按照已存储的计划触发周期性的报告生成与电子邮件发送。
- **Report_Exporter**：后端组件，负责将已生成的报告渲染为 PDF 或 CSV 制品。
- **Report_Request**：定义一份报告的一组参数，包括所选的监控项、时间范围以及报告周期类型。
- **Report_Result**：Report_Generator 的计算输出，包括可用性指标、响应时间序列以及事件记录。
- **Time_Range**：界定报告所包含 Heartbeat 数据的起始时刻与结束时刻。
- **Period_Type**：报告时间范围的类别，取值为 `daily`、`weekly`、`monthly` 或 `custom` 之一。
- **Availability_Percentage**：监控项处于 `UP` 状态的受监控时间所占的比例，以保留两位小数的百分比
  表示，且不包含监控项处于 `MAINTENANCE` 状态的时间。
- **Incident**：监控项处于 `DOWN` 状态的连续区间，由起始时刻、结束时刻和持续时长来定义。
- **MTTR**：平均恢复时间（Mean Time To Recovery），即某一 Time_Range 内已解决的 Incident 的平均
  持续时长。
- **Schedule**：一项已存储的配置，定义自动报告生成的周期性规则、收件人以及报告参数。
- **Monitor**：现有的 Uptime Kuma 受监控目标，按当前系统的定义。
- **Heartbeat**：现有的 Uptime Kuma 检测结果记录行，包括状态、时间戳和响应时间。
- **Admin**：已通过身份验证的管理员用户，按当前系统的定义。
- **SMTP_Channel**：现有的 Uptime Kuma 电子邮件通知配置，用于发送计划报告。

## Requirements

### 需求 1：为某一时间范围生成可用性报告

**用户故事：** 作为 Admin，我希望为选定的时间范围生成在线和离线报告，以便我能够向相关方共享服务
可用性情况。

#### 验收标准

1. 当 Admin 提交一个 Report_Request 时，THE Report_Generator SHALL 基于受所请求 Time_Range
   界定的 Heartbeat 数据计算出一个 Report_Result。
2. THE SLA_Report_Module SHALL 在 Report_Request 中接受取值为 `daily`、`weekly`、`monthly`
   或 `custom` 的 Period_Type。
3. WHERE Period_Type 为 `custom`，THE SLA_Report_Module SHALL 要求 Report_Request 中提供
   明确的起始时刻和结束时刻。
4. WHERE Period_Type 为 `daily`、`weekly` 或 `monthly`，THE SLA_Report_Module SHALL 依据
   Period_Type 和 Report_Request 中提供的参考日期推导出 Time_Range。
5. IF 所请求的 Time_Range 的起始时刻晚于其结束时刻，THEN THE SLA_Report_Module SHALL 拒绝该
   Report_Request 并返回一个验证错误。
6. IF 某个 Report_Request 引用了一个不存在的 Monitor 标识符，THEN THE SLA_Report_Module SHALL
   拒绝该 Report_Request 并返回一个指明缺失标识符的验证错误。

### 需求 2：计算可用性指标

**用户故事：** 作为 Admin，我希望每份报告中包含准确的可用性指标，以便我能够依据 SLA 目标报告服务
健康状况。

#### 验收标准

1. THE Report_Generator SHALL 在 Report_Result 中为每个 Monitor 计算 Availability_Percentage。
2. THE Report_Generator SHALL 在计算 Availability_Percentage 时排除 Monitor 处于 `MAINTENANCE`
   状态的时间。
3. THE Report_Generator SHALL 在 Report_Result 中为每个 Monitor 计算总在线时长和总离线时长。
4. THE Report_Generator SHALL 在 Report_Result 中为每个 Monitor 计算 Incident 的数量。
5. THE Report_Generator SHALL 在 Report_Result 中为每个 Monitor 计算其在该 Time_Range 内的
   MTTR。
6. THE Report_Generator SHALL 在 Report_Result 中为每个 Monitor 计算最小、最大和平均响应时间。
7. WHERE 某个 Monitor 在该 Time_Range 内没有 Heartbeat 数据，THE Report_Generator SHALL 将
   Availability_Percentage 报告为不可用，而非报告为零，并 SHALL 将事件指标和响应时间指标设置为
   表示数据缺失。
8. THE Report_Generator SHALL 以保留两位小数的方式表示每个 Availability_Percentage。

### 需求 3：可视化报告数据

**用户故事：** 作为 Admin，我希望报告中包含可视化图表，以便我能够快速理解服务健康状况。

#### 验收标准

1. 当一个 Report_Result 被展示时，THE SLA_Report_Module SHALL 为所包含的 Monitor 渲染一张
   Availability_Percentage 图表。
2. 当一个 Report_Result 被展示时，THE SLA_Report_Module SHALL 为所包含的 Monitor 渲染一张
   覆盖该 Time_Range 的响应时间趋势图表。
3. 当一个 Report_Result 被展示时，THE SLA_Report_Module SHALL 渲染一个事件时间线，展示每个
   Incident 的起始时刻、结束时刻和持续时长。
4. WHERE 某个 Report_Result 不包含任何 Incident，THE SLA_Report_Module SHALL 以空状态提示
   信息展示事件时间线，而不是展示一张空图表。
5. THE SLA_Report_Module SHALL 使用前端现有的 Vue 3 组件模式渲染报告图表。

### 需求 4：导出报告

**用户故事：** 作为 Admin，我希望将报告导出为 PDF 或 CSV，以便我能够离线分发它。

#### 验收标准

1. 当 Admin 请求将某个 Report_Result 导出为 PDF 时，THE Report_Exporter SHALL 生成一个 PDF
   制品，其中包含该 Report_Result 的可用性指标、图表和事件记录。
2. 当 Admin 请求将某个 Report_Result 导出为 CSV 时，THE Report_Exporter SHALL 生成一个 CSV
   制品，其中包含该 Report_Result 中按 Monitor 划分的可用性指标和 Incident 记录。
3. THE Report_Exporter SHALL 在每个导出制品中包含 Time_Range 和生成时刻。
4. IF 某次导出操作失败，THEN THE Report_Exporter SHALL 返回一个指明失败导出格式的错误，并 SHALL
   使现有的监控运行不受影响。
5. THE Report_Exporter SHALL 将 CSV 制品编码为 UTF-8。

### 需求 5：计划自动生成报告并通过电子邮件发送

**用户故事：** 作为 Admin，我希望计划自动生成报告并通过电子邮件发送，以便我无需手动创建报告。

#### 验收标准

1. THE SLA_Report_Module SHALL 允许 Admin 创建、查看、编辑和删除一个 Schedule。
2. THE Schedule SHALL 存储一个周期性规则定义、一组 Monitor 标识符、一个 Period_Type、一个或多个
   电子邮件收件人以及一个导出格式。
3. 当某个 Schedule 的周期性条件被满足时，THE Report_Scheduler SHALL 生成该 Schedule 所定义的
   Report_Result，并通过一个 SMTP_Channel 将导出制品发送给所配置的收件人。
4. IF 某个 Schedule 的电子邮件发送失败，THEN THE Report_Scheduler SHALL 记录该失败，包含
   Schedule 标识符和失败原因，并 SHALL 为后续运行保留该 Schedule。
5. WHILE 某个 Schedule 处于禁用状态期间，THE Report_Scheduler SHALL NOT 为该 Schedule 生成
   报告。
6. THE Report_Scheduler SHALL 在现有的后台作业进程中运行报告生成，以使计划生成不会阻塞监控检测。
7. IF 在保存一个启用电子邮件发送的 Schedule 时尚未配置任何 SMTP_Channel，THEN THE
   SLA_Report_Module SHALL 返回一个验证错误，提示 Admin 配置电子邮件发送。

### 需求 6：在一份报告中对比多个监控项

**用户故事：** 作为 Admin，我希望将多个监控项合并为单份报告，以便我能够呈现整体的服务视图。

#### 验收标准

1. THE SLA_Report_Module SHALL 在单个 Report_Request 中接受多于一个的 Monitor 标识符。
2. 当某个 Report_Request 包含多个 Monitor 时，THE Report_Generator SHALL 在同一 Time_Range
   内为每个所包含的 Monitor 计算需求 2 中的可用性指标。
3. 当一个多 Monitor 的 Report_Result 被展示时，THE SLA_Report_Module SHALL 在一个对比视图中
   呈现按 Monitor 划分的指标，且该视图对所有所包含的 Monitor 使用一致的 Time_Range。
4. THE SLA_Report_Module SHALL 在对应的导出制品中包含 Report_Request 中所指定的每一个 Monitor。

### 需求 7：高效处理大型数据集

**用户故事：** 作为 Admin，我希望报告生成在大型数据集上仍保持响应能力，以便长期运行的监控项也能
生成报告。

#### 验收标准

1. 当某个 Report_Request 覆盖多达 100,000 条 Heartbeat 的数据集时，THE Report_Generator
   SHALL 在 10 秒内返回 Report_Result。
2. WHILE Report_Generator 正在处理某个 Report_Request 期间，THE SLA_Report_Module SHALL 保持
   现有的监控检测和 Socket.IO 事件处理可正常运行。
3. THE Report_Generator SHALL 通过受 Monitor 标识符和 Time_Range 界定的索引查询来查询
   Heartbeat 数据。
4. WHERE 某个 Monitor 存在预聚合的统计数据，THE Report_Generator SHALL 使用该预聚合统计数据来
   计算长时间范围的指标。

### 需求 8：与现有的通信机制和访问控制集成

**用户故事：** 作为 Admin，我希望报告模块使用现有的通信和身份验证机制，以便它保持一致且安全。

#### 验收标准

1. THE SLA_Report_Module SHALL 通过现有的 Socket.IO 通道与前端交换 Report_Request 和
   Report_Result 数据。
2. IF 某个未通过身份验证的客户端发送一个与报告相关的 Socket.IO 事件，THEN THE SLA_Report_Module
   SHALL 拒绝该事件并返回一个身份验证错误。
3. THE SLA_Report_Module SHALL 将报告生成、导出和 Schedule 管理限制为仅供已通过身份验证的 Admin
   使用。

### 需求 9：持久化计划调度配置

**用户故事：** 作为 Admin，我希望我的报告计划在重启后依然存在，以便自动发送能够无需重新配置即可
继续进行。

#### 验收标准

1. THE SLA_Report_Module SHALL 在 SQLite 数据库中持久化每一个 Schedule。
2. 当应用程序启动时，THE Report_Scheduler SHALL 加载已持久化的 Schedule 并恢复其周期性调度。
3. THE SLA_Report_Module SHALL 通过 `db/knex_migrations/` 中的数据库迁移来应用其数据库 schema
   变更。
4. THE SLA_Report_Module SHALL 在不改动现有 Heartbeat 或 Monitor 表数据的前提下应用其 schema
   变更。

### 需求 10：保留现有功能并处理错误

**用户故事：** 作为 Admin，我希望报告模块能够安全地失败，以便监控永远不会因报告错误而被中断。

#### 验收标准

1. IF 报告生成抛出错误，THEN THE SLA_Report_Module SHALL 向发起请求的客户端返回一个可据以采取
   行动的错误消息，并 SHALL 继续现有的监控运行。
2. IF Report_Scheduler 在某次计划运行期间抛出错误，THEN THE Report_Scheduler SHALL 记录该错误
   并 SHALL 继续处理其他 Schedule。
3. THE SLA_Report_Module SHALL 在不修改现有监控检测、通知、状态页面或维护窗口行为的前提下运行。

### 需求 11：用户可见文本的国际化

**用户故事：** 作为 Admin，我希望报告模块的文本可被翻译，以便该功能与界面其余已本地化的部分保持
一致。

#### 验收标准

1. THE SLA_Report_Module SHALL 将每一个用户可见字符串定义为 `src/lang/en.json` 中的一个键。
2. THE SLA_Report_Module SHALL 通过前端现有的 i18n 机制渲染用户可见文本。
