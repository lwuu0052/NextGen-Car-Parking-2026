# NextGen Car Parking System Backend (Level 1 Phase)

停车场管理系统后端 - Level 1 基础架构实现

---

## 1. 项目简介

本项目为**停车场管理系统后端**，负责接收模拟器（Parking Simulator）事件、通过 REST API 调用模拟器进行设备与车位管理、提供 PostgreSQL 数据持久化及降级保障，并向前端及运维提供标准化接口。

---

## 2. 环境要求与安装方式

- **Node.js**: v20.0.0 或更高版本 (建议 v24.x)
- **npm**: v10.0.0 或更高版本
- **PostgreSQL**: v14.0 或更高版本 (可选，本地或远程)
- **Parking Simulator**: 包含在同级目录 `ParkingSimulator-osx-arm64`

### 安装步骤

```bash
# 1. 进入项目根目录
cd NextGen-Car-Parking-2026

# 2. 安装项目依赖
npm install

# 3. 复制环境变量配置文件
cp .env.example .env
```

---

## 3. 环境变量配置说明

修改 `.env` 配置文件中的具体配置：

```ini
# Application Server Configuration
APP_HOST=0.0.0.0
APP_PORT=3000
APP_ENV=development
LOG_LEVEL=info

# PostgreSQL Database Configuration
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=parking_db

# Simulator REST API Configuration
SIMULATOR_BASE_URL=http://127.0.0.1:9898
SIMULATOR_USERNAME=admin
SIMULATOR_PASSWORD=admin
SIMULATOR_TIMEOUT_SECONDS=5

# Webhook Authentication Configuration (Optional)
WEBHOOK_SECRET=

# Feature Flags
ENABLE_DEVICE_CONTROL_ROUTE=false
```

> **注意**：
> - `WebhookUrl` 填写配置：在模拟器 `settings/settings.json` 中，`WebhookUrl` 应填入后端完整的 Webhook 接收地址：`http://127.0.0.1:3000/webhooks/simulator` (部署在容器或异机时请填入模拟器能直接访问的主机 IP)。

---

## 4. 数据库初始化 (PostgreSQL DDL)

建表脚本位于 `database/pg_schema.sql`，可直接通过 `psql` 执行：

```bash
# 执行建表 DDL 脚本
psql -h 127.0.0.1 -U postgres -d parking_db -f database/pg_schema.sql

# 执行 DDL 验证脚本
psql -h 127.0.0.1 -U postgres -d parking_db -f database/pg_verify.sql
```

---

## 5. 编译与启动命令

```bash
# 编译 TypeScript 代码
npm run build

# 启动生产运行服务
npm start

# 本地开发热重载启动
npm run dev

# 运行自动化测试套件
npm test
```

---

## 6. API 路由与健康检查说明

### 6.1 健康检查

| 方法 | 路径 | 描述 | 成功响应 | 未就绪/失败响应 |
|---|---|---|---|---|
| `GET` | `/health/live` | 确认后端进程存活 | `200 OK` `{"data":{"status":"UP"}}` | N/A |
| `GET` | `/health/ready` | 检查 PostgreSQL 数据库可用性 | `200 OK` `{"data":{"status":"READY","database":"UP"}}` | `503 Service Unavailable` `{"error":{"code":"DATABASE_UNAVAILABLE"}}` |

### 6.2 基础查询与 Webhook 接口

| 方法 | 路径 | 描述 | 数据源标记 |
|---|---|---|---|
| `GET` | `/api/parking-spots` | 查询实时车位列表 | `simulator_realtime` |
| `GET` | `/api/devices` | 查询实时设备列表（闸门、灯光、排风扇） | `simulator_realtime` |
| `POST` | `/api/devices/:id/commands` | 执行设备控制（默认禁用，需认证启用） | N/A |
| `POST` | `/api/sync/base-data` | 手动同步模拟器区域、车位、设备基础数据入库 | N/A |
| `POST` | `/webhooks/simulator` | 模拟器事件 Webhook 接收入口 | N/A |

---

## 7. 联调步骤与常见错误排查

### 联调步骤

1. **启动模拟器**：在 `ParkingSimulator-osx-arm64` 目录下运行 `./ParkingSimulator`，确认控制台输出 `[API Server] Initialized Listen on: http://0.0.0.0:9898`。
2. **启动后端服务**：在 `NextGen-Car-Parking-2026` 目录下运行 `npm start`。
3. **验证连通性**：
   - 执行 `curl http://127.0.0.1:3000/health/live` 确认进程正常。
   - 执行 `curl http://127.0.0.1:3000/api/parking-spots` 确认能成功连接模拟器并自动完成 JWT Token 登录。
4. **测试 Webhook**：向 `http://127.0.0.1:3000/webhooks/simulator` 发送 `test_webhook` 测试事件。

### 常见错误排查

- **`503 DATABASE_UNAVAILABLE`**：
  - 原因：PostgreSQL 未启动或 `.env` 数据库连接参数错误。
  - 处理：检查 PostgreSQL 服务状态，运行 `psql` 验证账号密码。
- **`502 SIMULATOR_AUTH_FAILED`**：
  - 原因：模拟器未启动或 `.env` 中的 `SIMULATOR_USERNAME`/`SIMULATOR_PASSWORD` 与模拟器 `settings.json` 不匹配。
  - 处理：确认模拟器成功运行在 `9898` 端口，验证 `Email` 为 `"admin"`，`Password` 为 `"admin"`。
- **`504 SIMULATOR_TIMEOUT`**：
  - 原因：模拟器响应超时。
  - 处理：检查 `SIMULATOR_TIMEOUT_SECONDS` 设置，或确认模拟器未卡死。

---

## 8. 第一阶段完成报告

### 已实现 (Implemented)
- [x] 清晰模块化的 Node.js + TypeScript 后端架构。
- [x] Zod 环境配置校验，缺少必填项时启动即报错退出。
- [x] Pino 结构化日志系统，带有 `x-request-id` 追踪及密码/Token 字段自动脱敏。
- [x] 模拟器 REST API 客户端封装（登录、Token 自动管理、Promise Mutex 并发登录锁、指数避障安全重试）。
- [x] 确切解析模拟器 8 类 Webhook 事件（`car_spot_action`, `gate_action`, `component_broken`, `component_fixed`, `carbon_monoxide_event`, `payment_made`, `penalty`, `test_webhook`）。
- [x] Webhook 校验、按 `external_event_id` 去重、数据落盘与事件分发框架。
- [x] PostgreSQL 数据访问层（Zones, ParkingSpots, Devices, WebhookEvents），支持参数化查询与 `JSONB` 格式。
- [x] 数据库降级机制：数据库未就绪时 `/health/ready` 返回 503，依赖数据库的请求明确失败，不假造成功。
- [x] 11 项全覆盖自动化测试套件 (`npm test` 100% 通过) 以及 TypeScript 编译验证 (`npm run build` 0 error)。

### 已验证 (Verified)
- [x] 模拟器实际运行与登录联调（HTTP POST `/api/v1/auth/login` 实测获取 Token 成功）。
- [x] 模拟器受保护 API 联调（`/list-zones`, `/list-parking-spots`, `/list-barriers` 等 200 OK）。
- [x] `/health/live` 及 `/health/ready` 状态隔离验证。
- [x] 敏感凭据日志脱敏验证。
- [x] 控制请求超时不盲目重试验证。

### 待后续阶段验证/补充 (Pending / Deferred)
- [ ] 完整的前端 Web 页面接入。
- [ ] 网站 Admin / Operator 登录与 RBAC 角色管理（已预留数据库 schema 与防护路由开关）。
- [ ] 自动分配车位算法。
- [ ] 完整计费、付款验证与车辆放行业务主流程（预留 Handlers 入口）。
- [ ] 自动维修与节能控制策略。
