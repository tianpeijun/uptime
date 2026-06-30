# Uptime Kuma 架构概述

> 本文档基于源代码（`server/`、`src/`、`db/`）、Steering 文档（`.kiro/steering/Uptime.md`）与运行实例采集整理，描述系统当前的整体架构、技术栈、数据模型、接口与认证机制。统计数值（约 30 监控类型 / 95 通知渠道 / 77 语言）以采集时源码为准。

---

## 1. 系统架构

Uptime Kuma 是一个**单体（monolith）自托管监控应用**：一个 Node.js 进程同时承担后端逻辑、实时通信与静态前端托管，前后端共用同一个 `package.json`。

### 1.1 组件分层与通信方式

```
┌──────────────────────────────────────────────────────────────┐
│ 浏览器 (Vue 3 SPA)                                              │
│  - Dashboard / EditMonitor / StatusPage / Settings ...         │
└───────────────┬───────────────────────────┬───────────────────┘
                │ ① WebSocket (Socket.IO)    │ ② HTTP (REST/静态)
                │   主控制通道(双向、实时)     │   状态页/徽章/Push/静态资源
                ▼                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Node.js 单进程 (server/server.js)                              │
│                                                                │
│  ┌───────────────┐   ┌──────────────────────────────────────┐ │
│  │ Socket.IO 层   │   │ Express 层                           │ │
│  │ socket-handlers│   │ routers: api-router /                │ │
│  │ (CRUD/实时事件)│   │          status-page-router          │ │
│  └──────┬─────────┘   │ express-static-gzip → dist/          │ │
│         │             │ prometheus-api-metrics → /metrics    │ │
│         ▼             └───────────────┬──────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 领域逻辑：UptimeKumaServer / Monitor / 调度(croner)        │ │
│  │ monitor-types(检测) · notification-providers(通知)         │ │
│  │ UptimeCalculator(可用率聚合) · jobs(后台任务)              │ │
│  └───────────────┬──────────────────────────────────────────┘ │
│                  │ ③ redbean-node (ORM) + knex                 │
└──────────────────┼──────────────────────────────────────────┘
                   ▼
        ┌──────────────────────────────┐
        │ 数据库                        │
        │ 默认 SQLite (@louislam/sqlite3)│
        │ 可选 内嵌/外部 MariaDB/MySQL   │
        └──────────────────────────────┘
                   │ ④ 出站探测/通知
                   ▼
   被监控目标 (HTTP/TCP/DNS/DB/...)  ·  通知服务(Email/IM/Webhook...)
```

**通信方式说明**

| 编号 | 通道 | 用途 |
| --- | --- | --- |
| ① | WebSocket（Socket.IO） | 前端登录后的**主控制平面**：监控项/通知/状态页/维护/设置的增删改查、心跳与统计的实时推送。绝大部分管理操作走此通道而非 REST。 |
| ② | HTTP（Express） | 公开状态页（`/status/:slug`）、徽章 SVG、Push 上报端点、Prometheus `/metrics`、以及托管打包后的前端静态资源（`dist/`）。 |
| ③ | ORM（redbean-node + knex） | 后端访问数据库；启动时自动执行 `db/knex_migrations` 迁移。 |
| ④ | 出站连接 | 监控调度器对目标发起探测；状态变化时调用通知渠道。 |

**进程内关键模块**

- `server/server.js`：进程入口，初始化 Express、Socket.IO、优雅关闭、Cloudflared 隧道等。
- `server/uptime-kuma-server.js`：`UptimeKumaServer` 单例，承载核心运行时状态。
- `server/jobs/` + `croner`：周期性后台任务与监控调度。
- `server/monitor-types/`：各监控类型的 `check()` 实现。
- `server/notification-providers/`：各通知渠道实现。
- `server/uptime-calculator.js`：心跳数据按小时/天聚合，支撑可用率与图表。

---

## 2. 技术栈全景

| 层 | 技术 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 20.4.0 | 单进程，前后端共用 `package.json` |
| Web 框架 | Express 4 | HTTP 路由、静态资源托管 |
| 实时通信 | Socket.IO 4（服务端 + 客户端） | 主控制平面 |
| ORM/数据访问 | redbean-node + knex 3 | 自动表名映射、迁移 |
| 数据库 | SQLite（`@louislam/sqlite3`，默认）、内嵌 MariaDB、外部 MySQL/MariaDB | `data/db-config.json` 选择 |
| 调度 | croner | Cron/周期任务 |
| 认证 | express-basic-auth、bcryptjs、jsonwebtoken、notp + thirty-two（TOTP 2FA） | 见第 5 节 |
| 指标 | prom-client、prometheus-api-metrics | `/metrics` |
| HTTP 客户端 | axios（及各类代理 agent：http(s)-proxy-agent、socks-proxy-agent） | 监控探测 |
| 通知 | nodemailer、web-push、各 SDK（约 95 个 provider） | |
| 其他后端 | dayjs、croner、http-graceful-shutdown、express-static-gzip、compression、badge-maker、cheerio、jsonata、node-cloudflared-tunnel | |
| 前端框架 | Vue 3 + Vite 5 | SPA |
| 前端路由/状态 | vue-router 4、mitt、`src/mixins/socket.js`（集中状态） | |
| i18n | vue-i18n（约 77 种语言，`src/lang/`） | |
| UI | Bootstrap 5、FontAwesome、chart.js + vue-chartjs、vue-multiselect、vuedraggable 等 | |
| 测试 | Playwright（E2E）、`node --test`（后端单测） | |
| 代码质量 | ESLint、Stylelint、Prettier | |
| 打包/部署 | Docker（`docker/`）、Vite 构建到 `dist/` | |

---

## 3. 数据库表结构

> 来源：`db/knex_init_db.js`（基础表）+ `db/knex_migrations/`（增量演进）。
> 注意：`maintenance_timeslot` 在基础脚本中创建后又被补丁删除，维护改用 `maintenance.cron/timezone/duration` 实现，故**最终 schema 不含该表**。

### 3.1 核心实体表

**`user`** — 用户账户（通常仅一个管理员）
- `id` PK、`username`(唯一)、`password`(bcrypt)、`active`、`timezone`、`twofa_secret`、`twofa_status`、`twofa_last_token`

**`monitor`** — 监控项（字段最多，按用途分组）
- 基础：`id` PK、`name`、`type`、`active`、`url`、`hostname`、`port`、`interval`、`maxretries`、`retry_interval`、`timeout`、`resend_interval`、`weight`、`created_date`、`description`
- 关系：`user_id`→`user`(SET NULL)、`parent`→`monitor`(自引用,SET NULL)、`docker_host`→`docker_host`、`proxy_id`→`proxy`
- HTTP：`method`、`body`、`headers`、`http_body_encoding`、`accepted_statuscodes_json`、`maxredirects`、`ignore_tls`、`upside_down`、`expiry_notification`
- 鉴权：`basic_auth_user/pass`、`auth_method`、`auth_domain`、`auth_workstation`、`oauth_client_id/secret/token_url/scopes/auth_method`、`tls_ca/cert/key`
- 关键字/JSON：`keyword`、`invert_keyword`、`json_path`、`expected_value`
- DNS：`dns_resolve_type`、`dns_resolve_server`、`dns_last_result`、`packet_size`
- Push：`push_token`
- 数据库类：`database_connection_string`、`database_query`
- gRPC：`grpc_url/protobuf/body/metadata/method/service_name/enable_tls`
- MQTT：`mqtt_topic/success_message/username/password`
- Radius：`radius_username/password/calling_station_id/called_station_id/secret`
- Kafka：`kafka_producer_topic/brokers/ssl/allow_auto_topic_creation/sasl_options/message`
- 游戏：`game`、`gamedig_given_port_only`

**`heartbeat`** — 心跳记录（高写入）
- `id` PK、`monitor_id`→`monitor`(CASCADE)、`status`(0=DOWN,1=UP,2=PENDING,3=MAINTENANCE)、`important`、`msg`、`time`、`ping`、`duration`、`down_count`
- 索引：`monitor_time_index`、`monitor_important_time_index` 等

**`monitor_tls_info`** — 监控项 TLS 证书信息：`id`、`monitor_id`→`monitor`、`info_json`

### 3.2 通知

- **`notification`**：`id`、`name`、`active`、`user_id`、`is_default`、`config`(longtext JSON)
- **`monitor_notification`**（多对多）：`monitor_id`→`monitor`、`notification_id`→`notification`
- **`notification_sent_history`**：`type`、`monitor_id`、`days`，唯一约束 `(type,monitor_id,days)`（避免到期提醒重复发送）

### 3.3 分组与标签

- **`group`**：`id`、`name`、`public`、`active`、`weight`、`status_page_id`（状态页分组）
- **`monitor_group`**（多对多）：`monitor_id`→`monitor`、`group_id`→`group`、`weight`、`send_url`
- **`tag`**：`id`、`name`、`color`、`created_date`
- **`monitor_tag`**（多对多）：`monitor_id`→`monitor`、`tag_id`→`tag`、`value`

### 3.4 状态页

- **`status_page`**：`id`、`slug`(唯一)、`title`、`description`、`icon`、`theme`、`published`、`search_engine_index`、`show_tags`、`password`、`footer_text`、`custom_css`、`show_powered_by`、`google_analytics_tag_id`、`show_certificate_expiry`
- **`status_page_cname`**：`status_page_id`→`status_page`、`domain`(唯一)（自定义域名映射）
- **`incident`**：`id`、`title`、`content`、`style`、`pin`、`active`、`status_page_id`（状态页事件公告）

### 3.5 维护

- **`maintenance`**：`id`、`title`、`description`、`user_id`→`user`、`active`、`strategy`(single/manual/cron/...)、`start_date`、`end_date`、`start_time`、`end_time`、`weekdays`、`days_of_month`、`interval_day`、`cron`、`timezone`、`duration`
- **`monitor_maintenance`**（多对多）：`monitor_id`→`monitor`、`maintenance_id`→`maintenance`
- **`maintenance_status_page`**（多对多）：`status_page_id`→`status_page`、`maintenance_id`→`maintenance`

### 3.6 基础设施 / 配置

- **`api_key`**：`id`、`key`(bcrypt)、`name`、`user_id`→`user`、`created_date`、`active`、`expires`
- **`proxy`**：`id`、`user_id`、`protocol`、`host`、`port`、`auth`、`username`、`password`、`active`、`default`
- **`docker_host`**：`id`、`user_id`、`docker_daemon`、`docker_type`、`name`
- **`setting`**：`id`、`key`(唯一)、`value`、`type`（全局键值配置）

### 3.7 关系总览（外键）

| 子表 | 外键 | 父表 | 删除行为 |
| --- | --- | --- | --- |
| monitor | user_id | user | SET NULL |
| monitor | parent | monitor | SET NULL |
| monitor | docker_host / proxy_id | docker_host / proxy | — |
| heartbeat | monitor_id | monitor | CASCADE |
| monitor_tls_info | monitor_id | monitor | CASCADE |
| monitor_group | monitor_id / group_id | monitor / group | CASCADE |
| monitor_tag | monitor_id / tag_id | monitor / tag | CASCADE |
| monitor_notification | monitor_id / notification_id | monitor / notification | CASCADE |
| monitor_maintenance | monitor_id / maintenance_id | monitor / maintenance | CASCADE |
| maintenance | user_id | user | SET NULL |
| maintenance_status_page | status_page_id / maintenance_id | status_page / maintenance | CASCADE |
| status_page_cname | status_page_id | status_page | CASCADE |
| api_key | user_id | user | CASCADE |

> `group.status_page_id`、`incident.status_page_id`、`notification_sent_history.monitor_id` 在逻辑上分别关联 `status_page`/`monitor`，但未在基础脚本中声明外键约束。

---

## 4. API 接口文档

系统接口分两类：**Socket.IO 事件（主控制平面）** 与 **HTTP REST（公开/集成端点）**。

### 4.1 Socket.IO（前端 ↔ 后端）

前端登录后通过 Socket.IO 双向通信，事件由 `server/socket-handlers/` 处理，涵盖：

| Handler | 职责 |
| --- | --- |
| `general-socket-handler` | 登录、设置、通用操作 |
| `maintenance-socket-handler` | 维护计划 CRUD |
| `status-page-socket-handler` | 状态页 CRUD |
| `api-key-socket-handler` | API Key 管理 |
| `proxy-socket-handler` | 代理管理 |
| `docker-socket-handler` | Docker 宿主管理 |
| `remote-browser-socket-handler` | 远程浏览器管理 |
| `cloudflared-socket-handler` | Cloudflared 隧道控制 |
| `chart-socket-handler` | 图表数据 |
| `database-socket-handler` | 数据库维护操作 |

服务端向客户端推送的典型事件：`heartbeat`（心跳）、监控项列表/统计更新等（实时）。

### 4.2 HTTP REST 端点

**通用 / 监控（`server/routers/api-router.js`）**

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| GET | `/api/entry-page` | 返回入口页/匹配的状态页域名 | 公开 |
| ALL | `/api/push/:pushToken` | Push 类型监控上报心跳（`?status&msg&ping`） | Push Token |
| GET | `/api/badge/:id/status` | 状态徽章(SVG) | 公开(仅公开监控项) |
| GET | `/api/badge/:id/uptime/:duration?` | 可用率徽章 | 同上 |
| GET | `/api/badge/:id/ping/:duration?` | 平均 Ping 徽章 | 同上 |
| GET | `/api/badge/:id/avg-response/:duration?` | 平均响应徽章 | 同上 |
| GET | `/api/badge/:id/cert-exp` | 证书到期徽章 | 同上 |
| GET | `/api/badge/:id/response` | 最近响应徽章 | 同上 |

**状态页（`server/routers/status-page-router.js`）**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/status/:slug`、`/status`、`/status-page` | 渲染状态页 SPA |
| GET | `/status/:slug/rss` | 状态页 RSS |
| GET | `/api/status-page/:slug` | 状态页配置 + 监控/事件列表 |
| GET | `/api/status-page/heartbeat/:slug` | 状态页心跳与 24h 可用率轮询数据 |
| GET | `/api/status-page/:slug/manifest.json` | PWA manifest |
| GET | `/api/status-page/:slug/incident-history` | 事件历史（游标分页） |
| GET | `/api/status-page/:slug/badge` | 状态页整体状态徽章 |

**指标 / 集成**

| 方法 | 路径 | 说明 | 认证 |
| --- | --- | --- | --- |
| GET | `/metrics` | Prometheus 指标（`prometheus-api-metrics` + 每监控项自定义指标） | 受保护(Basic / API Key) |

> 徽章接口默认缓存 5 分钟（`apicache`）；状态页心跳缓存 1 分钟。多数“写”操作（创建监控、改设置等）不经 REST，而通过 Socket.IO 事件完成。

---

## 5. 认证 / 授权机制

**主体来源**：`server/auth.js`、`server/rate-limiter.js`、`server/2fa.js`、`server/password-hash.js`。

### 5.1 Web UI（Socket.IO）

1. 前端发送 `login` 事件（用户名/密码）。
2. 后端 `login()` 以 `bcrypt` 校验口令；若检测到旧式哈希则在登录成功时**自动升级为 bcrypt**。
3. 启用 2FA 时，需额外校验 TOTP 一次性验证码（`notp` + `thirty-two`）。
4. 校验通过后签发 JWT（`jsonwebtoken`），客户端后续以 token 重连认证。
5. 设置 `disableAuth=true` 时跳过认证。

### 5.2 REST API

- 受保护端点经 `express-basic-auth`（HTTP Basic）。
- 启用 API Key（`apiKeysEnabled`）时使用 API Key 校验，否则回退到用户名/密码。
- **API Key 格式**：`uk<id>_<secret>`；以 `id` 取出记录，`bcrypt` 校验 secret，并检查 `active` 与 `expires`（过期/停用即失效）。

### 5.3 Push 与状态页

- Push 端点（`/api/push/:pushToken`）以 URL 内 token 鉴别监控项，无需账户认证。
- 公开状态页对匿名访客开放；若状态页设置了 `password` 则需校验页面密码。

### 5.4 速率限制（`rate-limiter.js`）

| 场景 | 限额 |
| --- | --- |
| 登录 | 20 次 / 分钟 |
| API | 60 次 / 分钟 |
| 2FA | 30 次 / 分钟 |

超限即拒绝并记录告警日志。

### 5.5 授权模型

单管理员模型，无细粒度 RBAC：认证用户即拥有全部管理权限；徽章/状态页数据仅暴露被标记为 `public=1` 的监控项。

---

## 6. 目录结构说明

```
uptime-kuma/
├── server/                      后端源码（Node.js）
│   ├── server.js                进程入口：Express + Socket.IO + 优雅关闭 + 隧道
│   ├── uptime-kuma-server.js    UptimeKumaServer 单例，核心运行时
│   ├── auth.js / 2fa.js / password-hash.js / rate-limiter.js  认证与限流
│   ├── database.js / setup-database.js / settings.js  数据库与全局设置
│   ├── jobs.js, jobs/           后台周期任务
│   ├── model/                   领域对象模型(自动映射数据库表)
│   ├── monitor-types/           各监控类型 check() 实现(约23模块/30类型)
│   ├── monitor-conditions/      监控判定条件逻辑
│   ├── notification-providers/  各通知渠道实现(约95个)
│   ├── notification.js          通知渠道注册与分发
│   ├── routers/                 Express 路由(api-router, status-page-router)
│   ├── socket-handlers/         Socket.IO 事件处理(CRUD/实时)
│   ├── modules/                 改造过的第三方模块(如 apicache)
│   ├── analytics/               分析相关
│   ├── prometheus.js            每监控项 Prometheus 指标
│   ├── proxy.js / docker.js / remote-browser.js  集成能力
│   ├── uptime-calculator.js     可用率/心跳聚合计算
│   └── util-server.js / utils/  服务端工具
│
├── src/                         前端源码（Vue 3 SPA）
│   ├── main.js                  应用入口
│   ├── App.vue / router.js      根组件与路由
│   ├── pages/                   页面级组件(Dashboard, EditMonitor, StatusPage, Settings...)
│   ├── components/              复用组件(MonitorList, HeartbeatBar, NotificationDialog...)
│   │   ├── notifications/       各通知渠道的配置表单组件
│   │   └── settings/            各设置子页组件
│   ├── layouts/                 布局组件
│   ├── mixins/                  混入(socket.js 集中数据与 socket 逻辑)
│   ├── modules/                 前端模块
│   ├── lang/                    i18n 语言文件(约77种)
│   ├── assets/                  样式与静态资源
│   ├── icon.js / i18n.js        图标与国际化初始化
│   └── util.js / util.ts / util-frontend.js  前后端/前端共享工具
│
├── db/
│   ├── knex_init_db.js          基础表结构(SQLite/MariaDB)
│   └── knex_migrations/         增量迁移脚本(启动时自动执行)
│
├── config/                      构建/测试配置(vite.config.js, playwright.config.js)
├── extra/                       辅助脚本(发布、重置密码、download-dist 等)
├── docker/                      Dockerfile 与 compose
├── test/                        后端单测与 Playwright E2E
├── public/                      开发期前端静态资源
├── dist/                        前端构建产物(生产由 Express 托管)
├── data/                        运行期数据(kuma.db, 上传, 截图, db-config.json)
└── .kiro/steering/Uptime.md     项目 Steering 指南
```

---

## 7. 第三方依赖清单（核心 runtime）

> 取自 `package.json` 的 `dependencies`（后端运行时）。前端框架依赖见 `devDependencies`（最终打包进 `dist/`）。

| 依赖 | 用途 |
| --- | --- |
| `express` | HTTP 服务器与路由 |
| `socket.io` / `socket.io-client` | 前后端实时双向通信（主控制平面） |
| `redbean-node` + `knex` | ORM 与查询构建、数据库迁移 |
| `@louislam/sqlite3` | 默认 SQLite 驱动 |
| `mysql2` / `pg` / `mssql` / `mongodb` / `oracledb` / `redis` | 外部数据库连接（亦用于数据库类监控） |
| `@louislam/ping` / `tcp-ping` | Ping / TCP 探测 |
| `net-snmp` / `mqtt` / `kafkajs` / `gamedig` / `radius` | 各类协议监控 |
| `@grpc/grpc-js` + `protobufjs` | gRPC 监控 |
| `globalping` | 全球探测监控 |
| `axios` | HTTP 监控与外部调用 |
| `http-proxy-agent` / `https-proxy-agent` / `socks-proxy-agent` / `http-cookie-agent` | 代理与 Cookie 支持 |
| `cheerio` / `jsonata` | HTML 解析 / JSON 查询监控 |
| `croner` | 调度（监控间隔、维护 Cron） |
| `dayjs` | 时间处理 |
| `bcryptjs` / `password-hash` | 口令哈希 |
| `jsonwebtoken` / `jwt-decode` | 会话 JWT |
| `notp` / `thirty-two` | TOTP 两步验证 |
| `nodemailer` | 邮件通知（SMTP） |
| `web-push` | 浏览器推送通知 |
| `nostr-tools` | Nostr 通知 |
| `prom-client` / `prometheus-api-metrics` | Prometheus 指标暴露 |
| `badge-maker` | 生成状态/可用率徽章 SVG |
| `http-graceful-shutdown` | 优雅关闭 |
| `express-static-gzip` / `compression` | 静态资源压缩托管 |
| `express-basic-auth` | REST 接口基础认证 |
| `node-cloudflared-tunnel` | Cloudflared 隧道（对外暴露） |
| `tldts` / `validator` / `is-url` | 域名/URL 校验 |
| `iconv-lite` / `chardet` | 编码处理 |
| `feed` | 状态页 RSS |
| `limiter` | 速率限制 |
| `nanoid` | ID 生成 |
| `liquidjs` | 通知自定义消息模板渲染 |

---

## 附：数据流示例（一次 HTTP 监控）

1. `croner` 调度到期 → 调用对应 `monitor-types/*` 的 `check()`。
2. `check()` 用 `axios` 请求目标，按状态码/关键字/JSON 判定结果。
3. 生成 `heartbeat`，经 `UptimeCalculator` 更新聚合可用率，写入数据库（redbean-node）。
4. 通过 Socket.IO `heartbeat` 事件实时推送前端；同时更新 Prometheus 指标。
5. 若状态变化达到通知条件 → 调用已分配的 `notification-providers/*` 发送通知，并按 `notification_sent_history` 去重到期提醒。
