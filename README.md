# SkyNest 仙林校区无人机低空配送平台

SkyNest 是一个基于 **Vue 3、Cesium、Express、PostgreSQL/PostGIS** 的校园低空配送演示平台。系统已经接通师生、校方和运营商三类角色，并将任务 Agent、动态 Cost、A* 航线规划、动态重规划、安全管控和审计记录统一到 V3 数据库流程中。

当前版本适合本地比赛演示。核心业务闭环和三类角色权限已经完成；正式上线前仍需替换生产账号并完成生产部署。

## 已实现能力

| 模块 | 当前能力 |
| --- | --- |
| 三维校园 | Cesium 场景、本地地形、校园 GLB、无人机 GLB、格网与热力图展示 |
| 师生端 | 自然语言解析、表单回填、人工确认、任务提交、进度查询及驳回后修改重提 |
| 任务 Agent | 地点匹配、物品识别、V3 机型与高风险规则校验、服务端防篡改复核 |
| 校方端 | 任务审核、动态航线生成、临时限制区、冲突检测、重规划、安全熔断和审计查询 |
| 运营端 | 分配无人机和接驳节点、派发、运输、到达、交付及资源释放 |
| 动态 Cost | 静态适航、人流、天气、施工/活动、禁飞区和能源风险综合计算 |
| 路径算法 | 基于动态 Cost 的 A*、航线持久化、新旧版本关联和安全失败处理 |
| 解释能力 | 航线确定性解释；可选 Ollama/百炼任务说明，模型不可用时安全降级 |
| 身份权限 | 登录会话、师生/校方/运营接口权限、师生任务隔离、服务端操作者身份 |

## 目录结构

```text
skynest.web/
├── demo/                         # Vue + Cesium 前端
│   ├── src/App.vue               # 三维地图与角色入口
│   ├── src/components/           # 师生、校方、运营商及共享卡片
│   ├── src/domain/               # 前端数据契约与演示规则
│   ├── src/services/demoApi.js   # V3 接口与演示降级适配
│   └── public/                   # 地形、GLB、热力图、地点及可选 3D Tiles
├── pg-server/                    # Express 后端
│   ├── agent/                    # 确定性任务 Agent
│   ├── llm/                      # Ollama/百炼解释层与安全降级
│   ├── lib/                      # 动态 Cost、路径、流程、安全与审计服务
│   ├── migrations/               # V3 增量迁移
│   ├── routes/v3.js              # V3 API
│   └── verify-*.js               # 真实数据库事务自测
├── docs/                         # 数据契约、合并说明和联调报告
├── PROGRESS.md                   # 当前进度与剩余任务
└── start.ps1                     # Windows 一键启动
```

## 环境要求

- Windows 10/11
- Node.js 18 或更高版本
- PostgreSQL 18
- V3 数据库需安装 PostGIS；当前验证版本为 PostGIS 3.6.2
- Chrome 或 Edge

## 首次运行

### 1. 安装依赖

```powershell
cd pg-server
npm install

cd ..\demo
npm install
```

### 2. 配置数据库

复制模板并填写本机数据库密码：

```powershell
cd ..\pg-server
Copy-Item .env.example .env
```

最少需要配置：

```env
PG_HOST=localhost
PG_PORT=5432
PG_USER=postgres
PG_PASSWORD=请填写本机数据库密码
PG_DATABASE=nanjing_uni_grid_score
PG_V3_DATABASE=nanjing_uni_grid_v3_test
PORT=3001
```

- `.env` 已被 Git 忽略，不要将真实密码发给其他成员或提交到仓库。
- 如果 V3 数据库使用不同账号，可在 `.env` 中单独设置 `PG_V3_HOST`、`PG_V3_PORT`、`PG_V3_USER` 和 `PG_V3_PASSWORD`。
- 项目代码不再内置默认数据库密码。

### 3. 准备数据库

项目同时保留两套数据入口：

- `PG_DATABASE`：早期三维格网与 `/api/*` 兼容接口使用。
- `PG_V3_DATABASE`：当前任务、规则、动态 Cost、航线和安全流程使用。

如果需要导入早期格网备份，可执行：

```powershell
cd pg-server
.\import-data.ps1
npm run setup-db
```

V3 基础数据库应先包含 `static`、`periodic`、`runtime` 三个 schema。随后执行项目增量迁移：

```powershell
npm run migrate-v3
npm run verify-v3
```

迁移脚本可重复执行，不会删除已有业务数据。当前 V3 自测可读取约 240 万格网、13 个固定节点和 8 架无人机。

### 4. 启动项目

在项目根目录执行：

```powershell
.\start.ps1
```

也可以分别启动：

```powershell
# 终端 1
cd pg-server
npm start

# 终端 2
cd demo
npm run dev
```

打开：

- 页面：<http://localhost:5173/>
- 后端：<http://localhost:3001/api/v3/health>

请勿使用 `file://` 直接打开 HTML，否则前端代理和静态资源会失效。

### 5. 登录账号

本地开发默认提供三类演示账号，登录页可直接选择并自动填入：

| 工作台 | 账号 | 本地演示密码 |
| --- | --- | --- |
| 师生端 | `student` | `Student@2026` |
| 校方端 | `school` | `School@2026` |
| 运营端 | `operator` | `Operator@2026` |

演示密码只在非生产环境且未配置独立密码时启用。正式部署必须在服务端 `.env` 中设置 `AUTH_STUDENT_PASSWORD`、`AUTH_SCHOOL_PASSWORD` 和 `AUTH_OPERATOR_PASSWORD`；生产环境不会启用上述默认密码。

## 三类角色操作流程

### 师生端

1. 输入自然语言需求，或直接填写表单。
2. 检查 Agent 回填结果、风险提示和模型说明来源。
3. 人工确认后提交任务。
4. 在“我的任务”查看审核、派发、运输、到达和交付状态。
5. 任务被驳回时，根据校方意见修改原任务并使用同一任务编号重新提交。

### 校方端

1. 审核待处理任务；批准时调用动态 Cost A* 生成航线。
2. 在安全管控中创建临时限制区并检查航线冲突。
3. 对冲突航线执行重规划，或对执行中任务进行安全熔断。
4. 在审计记录中查询任务、审批、运营和安全事件。

### 运营端

1. 接收校方批准的任务和航点链。
2. 分配可用无人机与接驳节点。
3. 依次推进派发、运输、到达和交付状态。
4. 完成交付后系统自动释放无人机和节点。

## Agent 与解释模型

风险等级、机型、特殊运输要求和航线坐标由数据库与确定性算法决定。语言模型只生成面向不同角色的文字说明，不能修改安全关键字段或代替校方审批。

默认关闭模型，系统使用 V3 规则说明：

```env
LLM_ENABLED=false
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
LLM_FALLBACK_ENABLED=true
```

如使用阿里云百炼：

```env
LLM_ENABLED=true
LLM_PROVIDER=dashscope
DASHSCOPE_API_KEY=仅在服务端填写
DASHSCOPE_MODEL=qwen-plus
```

模型连接失败、输出格式错误或产生越权结论时，系统会自动回退到确定性说明。

## 主要 V3 API

| 分组 | 接口 | 说明 |
| --- | --- | --- |
| 数据库 | `GET /api/v3/health`、`GET /api/v3/summary` | V3 状态与表概览 |
| 静态资源 | `GET /api/v3/nodes`、`/vehicle-rules`、`/high-risk-categories`、`/drones` | 节点、规则和无人机 |
| Agent | `POST /api/v3/agent/parse`、`GET /api/v3/agent/status`、`PUT /api/v3/agent/config` | 任务解析与解释来源 |
| 师生任务 | `GET/POST /api/v3/tasks`、`GET /api/v3/student/workspace`、`PUT /api/v3/student/tasks/:taskId/resubmit` | 提交、跟踪及驳回后修改重提 |
| 校方审核 | `GET /api/v3/reviews`、`POST /api/v3/tasks/:taskId/review` | 审核与生成航线 |
| 运营执行 | `GET /api/v3/operator/workspace`、`POST .../dispatch`、`POST .../advance` | 派发和状态推进 |
| 动态算法 | `GET /api/v3/grids/bbox`、`POST /api/v3/dynamic-cost/evaluate` | V3 格网与 Cost |
| 安全管控 | `/api/v3/safety/*`、`/api/v3/replanning/*` | 限制区、重规划与熔断 |
| 审计解释 | `GET /api/v3/audit`、`GET /api/v3/tasks/:taskId/route-explanation` | 审计与航线说明 |

旧版 `/api/health`、`/api/stats`、`/api/routes` 和 `/api/grids/*` 仍为三维地图兼容接口。

## 验证与构建

后端提供 12 项自测，涉及写入的测试均在事务中回滚：

```powershell
cd pg-server
npm run verify-v3
npm run verify-dynamic-cost
npm run verify-dynamic-route
npm run verify-replanning
npm run verify-restrictions
npm run verify-task-workflow
npm run verify-operator-workflow
npm run verify-audit-trail
npm run verify-safety-actions
npm run verify-route-explanation
npm run verify-agent
npm run verify-auth
```

前端生产构建：

```powershell
cd demo
npm run build
```

2026-08-13 最近一次本地验证：上述 12 项后端测试全部通过，前端构建通过。详细记录见 [docs](./docs/)。

## 当前未完成项

- Ollama 或百炼真实模型环境验证。
- nginx/进程守护等生产部署配置。
- 真实倾斜摄影 3D Tiles；当前使用校园 GLB 和简易建筑降级。

具体优先级与外部依赖见 [PROGRESS.md](./PROGRESS.md)。

## 常见问题

### 页面打不开

确认 3001 和 5173 端口服务均已启动，并通过 `http://localhost:5173/` 访问。

### V3 数据库未连接

检查 PostgreSQL 服务、本地 `.env`、`PG_V3_DATABASE` 和 PostGIS，然后运行 `npm run verify-v3` 获取明确错误。

### 智能解析显示“V3规则说明”

这是默认且可用的安全模式，不代表 Agent 失败。只有自然语言润色需要 Ollama 或百炼，字段解析与安全规则不依赖语言模型。

### 3D Tiles 无法显示

`demo/public/3dtiles/tileset.json` 尚未提供时，页面会使用 `campus-model2.glb`；格网、热力图和业务流程不受影响。

### 前端构建出现 Cesium externalized 提示

这是 Cesium 1.95 与构建工具的兼容提示，当前不会导致构建失败。

---

最后更新：2026-08-13
