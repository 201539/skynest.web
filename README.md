# SkyNest 仙林校区无人机低空配送平台

基于 **Vue 3 + Cesium 1.95 + Express + PostgreSQL 18** 的校园低空配送服务平台，包含师生任务端、校方三维管理端、运营履约端、AI Agent 结构化编排、适航格网、热力图时序与航线规划，并保留可选的旧企业接口沙箱用于兼容测试。

当前版本适合本地比赛演示。核心业务闭环和三类角色权限已经完成；正式上线前仍需替换生产账号并完成生产部署。

## 已实现能力

| 模块 | 当前能力 |
| --- | --- |
| 三维校园 | Cesium 场景、本地地形、校园 GLB、无人机 GLB、格网与热力图展示 |
| 师生端 | 自然语言解析、表单回填、人工确认、任务提交、进度查询及驳回后修改重提 |
| 任务 Agent | 地点匹配、物品识别、V3 机型与高风险规则校验、服务端防篡改复核 |
| 校方端 | 任务审核、动态航线生成、临时限制区、冲突检测、重规划、安全熔断和审计查询 |
| 运营端 | 分配无人机和接驳节点、派发、运输、到达、交付及资源释放 |
| 动态 Cost | 静态适航、人口/校历/上课时段/场馆开放/食堂营业、天气、施工/活动、禁飞区和能源风险综合计算 |
| 路径算法 | 基于动态 Cost 的 A*、航线持久化、新旧版本关联和安全失败处理 |
| 解释能力 | 师生自然语言需求解析；可选 Ollama/百炼/DeepSeek；航线解释包含SLA、直线距离、绕行、天气与分类风险，模型不可用或数字校验失败时安全降级 |
| 身份权限 | 登录会话、师生/校方/运营接口权限、师生任务隔离、服务端操作者身份 |

## 本次更新重点

- 师生端保留“自然语言解析＋表单确认”流程，解析结果不会自动提交；输入框下方提供当前稳定句式示例与人工确认提醒。
- 师生收发货只允许映射到 `A–G` 的 L3 三级运输节点，L1、L2 不作为师生放货或收货节点；同一 L3 节点仍允许形成 0 米节点间航线。
- 新增 DeepSeek 服务端接入。API Key 仅从后端环境变量读取，不进入 Vue 源码、浏览器请求或数据库解释内容。
- 航线生成后保存一段式 Agent 解释，包含预计飞行时间与时限可达性、实际/直线距离和绕行比例、默认天气提示及物品分类核验项。
- 危险化学品、高价值设备、医疗/生物样本分别使用专项核验规则；Agent 仅解释已有证据，不修改节点、机型、航线或审批结果。
- 航线解释状态支持 `pending`、`generating`、`generated`、`fallback` 和 `failed`，校方端与运营端可以查看生成状态。
- 新增数字硬校验：模型回答中的路线距离和预计时间必须与算法证据一致，否则自动回退到确定性规则说明。

### 2026-08-18 补丁更新

以下内容是在原有三端业务、动态 Cost、A* 航线与 Agent 解释能力上的增量补丁，不替代前述主体功能：

- 从行业调研数据导入 FP400 V4、ARK40、FZ90、TR9S、RA3P、FC30、JDX20、JDX50 共 8 个无人机型号。
- 新增防震、防水、防漏、冷链、恒温、静音 6 类运输能力，以及型号—能力关联和“需要配套货箱”状态。
- 无人机推荐合并静态型号能力与动态单机状态，检查载重、任务航程、电量、占用、故障和功能要求；Agent 只解释筛选结果，运营人员负责最终确认。
- 校方审核说明增加具体型号推荐理由；运营端增加 Agent 型号解释与 AI 推荐；学生端增加运输功能选项和“确认任务信息”。
- Cost 公式改为中文展示；无人机与航线使用相同高度；适航格网默认透明度调整为 25%。
- 修复运营端自动刷新导致确认框回退、重复勾选，以及重新派发时触发 `idx_runtime_drones_active_task` 唯一约束的问题。
- 新增迁移 `008_drone_capability_recommendations.sql`；完整数据库交付和恢复说明位于 `deliverables/`。

> **展示提醒：** 当前仅对运营端“接收并派发任务”启用了临时强制派发模式。页面不显示该模式提示，但代码中保留了 `TODO`。展示结束后必须关闭，具体方法见“运营端强制派发展示开关”。

## 目录结构

```
skynest.web-main\
├── README.md                      # 本说明文档
├── start.ps1                      # 一键启动 API + 前端
├── docs/                          # Demo 范围与产品说明
│
├── demo/                          # 前端（Vite + Vue + Cesium）
│   ├── src/App.vue                # 主界面与地图逻辑
│   ├── public/
│   │   ├── config/app.json        # 前端配置（校区中心、图层、格网参数）
│   │   ├── data/campus-buildings.geojson   # 简易校园建筑（12 栋）
│   │   ├── hotspotsdata/          # 热力图 CSV（168 帧）+ index.json
│   │   ├── terrain/               # 本地 Cesium 地形
│   │   ├── 3dtiles/               # 3D Tiles 实景（待放入 tileset.json）
│   │   └── Models/                # GLB 模型（待放入）
│   └── vite.config.js             # /api 代理 → localhost:3001
│
└── pg-server/                     # 后端 API
    ├── index.js                   # Express 服务
    ├── agent/                     # AI Agent 解析、地点匹配与运力规则
    ├── llm/                       # Ollama、百炼、DeepSeek及航线解释服务
    ├── migrations/007_route_agent_explanations.sql  # 航线解释与生成状态字段
    ├── migrations/008_drone_capability_recommendations.sql # 无人机型号、能力与推荐记录
    ├── demo/                      # 任务状态、路线编排与企业沙箱
    ├── public/student/            # 学生端轻量页面
    ├── data/routes.json           # 示范航线
    ├── schema.sql                 # 建表与索引
    ├── import-table.sql           # 无 PostGIS 兼容建表脚本
    ├── import-data.ps1            # 一键导入格网数据
    ├── setup-db.js                # 执行 schema.sql / 检查索引
    ├── install-postgresql-service.ps1  # PostgreSQL 18 安装与注册服务
    └── .env.example               # 环境变量模板
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
npm --prefix .\pg-server install
npm --prefix .\demo install
```

### 2. 配置数据库

复制模板并填写本机数据库密码：

```powershell
cd ..\pg-server
Copy-Item .env.example .env
```

最少需要配置：

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
& ".\pg-server\install-postgresql-service.ps1"
```

- `.env` 已被 Git 忽略，不要将真实密码发给其他成员或提交到仓库。
- 如果 V3 数据库使用不同账号，可在 `.env` 中单独设置 `PG_V3_HOST`、`PG_V3_PORT`、`PG_V3_USER` 和 `PG_V3_PASSWORD`。
- 项目代码不再内置默认数据库密码。

| 项 | 值 |
|----|-----|
| 安装路径 | `C:\Program Files\PostgreSQL\18` |
| 数据目录 | `C:\PostgreSQL\18\data` |
| 服务名 | `postgresql-x64-18` |
| 超级用户 | `postgres` |
| 密码 | 安装时自行设置，不要提交到 Git |
| 数据库 | `nanjing_uni_grid_score` |

项目同时保留两套数据入口：

- `PG_DATABASE`：早期三维格网与 `/api/*` 兼容接口使用。
- `PG_V3_DATABASE`：当前任务、规则、动态 Cost、航线和安全流程使用。

如果需要导入早期格网备份，可执行：

```powershell
Copy-Item .\pg-server\.env.example .\pg-server\.env
```

`.env` 字段说明：

```env
PG_HOST=localhost          # 数据库主机
PG_PORT=5432               # 数据库端口
PG_USER=postgres           # 数据库用户
PG_PASSWORD=replace_with_your_local_password   # 本机数据库密码
PG_DATABASE=nanjing_uni_grid_score   # 数据库名
PORT=3001                  # API 监听端口
```

`.env` 只保存在本机并已被 Git 忽略；未设置密码时，后端不会使用仓库内置密码。

### 3. 配置解释模型（可选）

系统默认可使用 V3 确定性规则说明。若启用 DeepSeek，在本机 `pg-server/.env` 中配置：

```env
LLM_ENABLED=true
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=请填写新建的服务端密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
LLM_FALLBACK_ENABLED=true
LLM_TIMEOUT_MS=90000
```

不要把真实 `DEEPSEEK_API_KEY` 写入 `.env.example`、前端代码、README、提交记录或截图。若密钥曾在聊天或日志中明文出现，应先在平台撤销并重新生成。

### 4. 导入格网数据（约 240 万条）

大型格网数据库备份不会上传 GitHub。如需重新导入，先把 `nanjing_uni_3d_grid_new.sql` 放在项目根目录，然后执行：

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
& ".\pg-server\import-data.ps1"
cd .\pg-server
npm run migrate-v3
npm run verify-building-catalog
npm run verify-v3
```

迁移脚本可重复执行，不会删除已有业务数据。`006_building_catalog.sql` 会导入点位清单中的 83 栋正式建筑坐标，并校验 13 个固定节点和 1,079 条建筑—节点距离矩阵。建筑经纬度来源为 WGS84，数据库按现有空间数据规范存为 SRID 4490；统一的 25 米海拔是占位值，不用于建筑避障。

当前 V3 自测可读取约 240 万格网、83 栋建筑、13 个固定节点和 8 架无人机。

### 4. 启动项目

在项目根目录执行：

```powershell
cd .\pg-server
node setup-db.js
```

### 6. 配置前端（可选）

如需 Cesium Ion 在线底图，复制令牌模板并填写自己的公开访问令牌：

```powershell
Copy-Item .\demo\.env.example .\demo\.env.local
```

再按需编辑 `demo/public/config/app.json`：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `campusCenter` | 飞到校区的相机中心 | lng 118.944736, lat 32.107470 |
| `tileset3d` | 3D Tiles 实景路径 | `./3dtiles/tileset.json` |
| `campusBuildings` | 简易建筑 GeoJSON | `./data/campus-buildings.geojson` |
| `terrain` | 本地地形 | `./terrain`，enabled: true |
| `grid.bboxLimit` | 单次视口最大格网数 | 6000 |
| `grid.zMin / zMax` | 高度过滤（米） | 0 ~ 200 |
| `grid.useDemoWhenOffline` | DB 不可用时演示格网 | true |
| `apiBase` | API 前缀 | `/api`（由 Vite 代理） |

---

## 日常启动流程

### 推荐：一键启动

```powershell
# 1. 确保 PostgreSQL 已运行
Start-Service postgresql-x64-18

# 2. 一键启动 API + 前端（会打开两个 PowerShell 窗口）
.\start.ps1
```

### 手动启动（便于查看日志）

**终端 1 — 后端 API**

```powershell
cd .\pg-server
node index.js
# 输出：API 服务已启动: http://localhost:3001
```

**终端 2 — 前端**

```powershell
cd .\demo
npm run dev
```

打开：

- 页面：<http://localhost:5173/>
- 后端：<http://localhost:3001/api/v3/health>

正式入口统一为 `http://localhost:5173/`，登录后系统会按师生、校方或运营账号自动进入对应工作台。远程分支带来的旧角色首页可通过 `/?portal=1` 单独访问；`/student/` 与 `/enterprise/` 仅作为兼容演示页保留，不属于正式三端入口。

> ⚠️ 必须通过 Vite 开发服务器访问，**不要**用 `file://` 直接打开 HTML，否则 API 代理与静态资源会失效。

### 5. 登录账号

本地开发提供三类测试账号。正式页面默认不显示账号快捷填充入口，请手动输入：

| 工作台 | 账号 | 本地演示密码 |
| --- | --- | --- |
| 师生端 | `student` | `Student@2026` |
| 校方端 | `school` | `School@2026` |
| 运营端 | `operator` | `Operator@2026` |

测试密码只在非生产环境且未配置独立密码时启用。正式部署必须在服务端 `.env` 中设置 `AUTH_STUDENT_PASSWORD`、`AUTH_SCHOOL_PASSWORD` 和 `AUTH_OPERATOR_PASSWORD`；生产环境不会启用上述默认密码。

### 6. 正式页面模式

`demo/public/config/app.json` 默认关闭旧版独立规划器、白模坐标标定、预设航线、GeoJSON 维护层、账号快捷填充和离线模拟格网。正式页面只展示真实三端业务、V3 正式建筑/节点、任务航线与真实数据库格网；数据库不可用时会明确报错，不会用模拟数据伪装成功。

如需维护旧数据，可在本地临时把 `ui.showLegacyTools` 和 `ui.showQuickLogin` 设为 `true`，并按需启用 `grid.useDemoWhenOffline`。旧角色入口位于 `/?portal=1`。这些开关和兼容入口不应在比赛或生产页面开启。

## 三类角色操作流程

```
打开 localhost:5173 并使用师生、校方或运营账号登录
    ↓
师生提交需求 → 校方审核并生成航线 → 运营端派发与运输 → 完成交付
    ↓（进入校方端）
确认顶栏「已连接」
    ↓
点击「飞到校区」或按 O 键
    ↓
┌─────────────────────────────────────────────┐
│ 图层控制：勾选/取消 地形、建筑、热力图、     │
│           适航格网、飞行路径、无人机         │
├─────────────────────────────────────────────┤
│ 热力图时序：下拉选 CSV → 上一帧/下一帧       │
├─────────────────────────────────────────────┤
│ 飞行航线：选航线 → 重播 / 评估               │
├─────────────────────────────────────────────┤
│ 适航格网：勾选后拖动地图，自动加载视口格网   │
└─────────────────────────────────────────────┘
```

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

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 数据库连接状态 |
| GET | `/api/stats` | 格网总数与评分统计 |
| GET | `/api/routes` | 航线列表 |
| GET | `/api/routes/:id` | 单条航线详情 |
| GET | `/api/routes/:id/evaluate` | 航线适航评估（逐航点查格网评分） |
| GET | `/api/grids/bbox` | 视口范围格网查询（前端主要使用） |
| GET | `/api/grids/demo` | 数据库不可用时的演示格网 |
| GET | `/api/grids` | 分页/限量格网查询 |
| POST | `/api/demo/tasks` | 学生端创建并执行 Agent 分析 |
| POST | `/api/demo/tasks/:id/submit` | 学生提交校方审核 |
| GET | `/api/admin/demo/tasks` | 校方查看完整任务队列 |
| POST | `/api/admin/demo/tasks/:id/approve` | 校方批准并生成推荐通道 |
| GET | `/api/enterprise/demo/tasks` | 企业端查看可履约任务 |
| POST | `/api/enterprise/demo/tasks/:id/accept` | 企业沙箱接受任务 |
| POST | `/api/enterprise/demo/tasks/:id/advance` | 企业沙箱推进履约状态 |

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
| 建筑与节点 | `GET /api/v3/buildings`、`/buildings/search`、`/buildings/:name/nearest-nodes`、`/buildings/:name/access-points`、`/fixed-nodes` | 83栋建筑、候选搜索、距离排序和13个固定节点 |
| 静态规则 | `GET /api/v3/nodes`、`/vehicle-rules`、`/high-risk-categories`、`/drones` | 兼容节点接口、规则和无人机 |
| Agent | `POST /api/v3/agent/parse`、`GET /api/v3/agent/status`、`PUT /api/v3/agent/config` | 任务解析与解释来源 |
| 师生任务 | `GET/POST /api/v3/tasks`、`GET /api/v3/student/workspace`、`PUT /api/v3/student/tasks/:taskId/resubmit` | 提交、跟踪及驳回后修改重提 |
| 校方审核 | `GET /api/v3/reviews`、`POST /api/v3/tasks/:taskId/review` | 审核与生成航线 |
| 运营执行 | `GET /api/v3/operator/workspace`、`POST .../dispatch`、`POST .../advance` | 派发和状态推进 |
| 动态算法 | `GET /api/v3/grids/bbox`、`POST /api/v3/dynamic-cost/evaluate` | V3 格网与 Cost |
| 安全管控 | `/api/v3/safety/*`、`/api/v3/replanning/*` | 限制区、重规划与熔断 |
| 审计解释 | `GET /api/v3/audit`、`GET /api/v3/tasks/:taskId/route-explanation` | 审计与航线说明 |

师生端和校方航线规划均使用 `static.buildings` 中的 83 栋正式建筑。任务地点必须完成正式名称匹配后才能提交；系统通过 `building_node_distance` 自动选择起点建筑最近的 `hub/a~e` 起飞节点，以及终点建筑最近的 `A~G` L3 接驳箱。旧 `places.json` 只用于旧坐标标定维护，不会作为正式任务的航线端点。

三维地图默认显示数据库中的83栋正式建筑点位和13个三级运输节点：`hub` 为L1综合枢纽，小写 `a~e` 为L2起飞机巢，大写 `A~G` 为L3接驳箱。建筑名称在近景显示，节点保持全校区可见；点击点位可查看正式名称、坐标、分类或节点状态。规划航线时实际采用的起飞节点和接驳箱会在地图上高亮，并写入航线 `planning_context.access_points` 供任务航线再次打开时恢复。

校方生成或查看航线后，地图通过 `POST /api/v3/dynamic-cost/corridor` 加载航线两侧默认 90 米范围内的真实格网，并按同一时刻的静态层、周期层和实时层动态 Cost 综合适航分着色。周期层同时读取人口热度、节假日、上课时段、场馆开放时间和食堂营业时段；周期表已有 `grid_code` 时优先精确匹配，当前空值数据则通过83栋正式建筑点位映射到教学楼、宿舍/图书馆和食堂周边。点击格网可查看三层分数、周期命中、综合 Cost、主要风险和硬约束；镜头移动不会再把航线走廊覆盖为旧的视口静态格网。

航线格网默认每 30 秒按当前时间重新计算一次，并在页面切到后台时暂停、返回页面后自动恢复。天气记录默认以 30 分钟为新鲜度上限：有效期内作为实时数据参与风险与硬约束判断，超时后标为“过期”并加入保守风险，不再用旧天气触发实时硬约束；没有数据库天气记录时使用明确标注的默认天气参数（风速 3 m/s、降雨 0 mm/h、能见度 5000 m）参与 Cost，不冒充实时数据。数据库一旦提供天气观测记录便优先覆盖默认值。刷新时间、新鲜度和默认天气可分别通过 `grid.dynamicRefreshSeconds`、`grid.weatherFreshnessMinutes` 与 `grid.defaultWeather` 配置，校方页面会显示实时、默认、过期和缺失格网数量。

旧版 `/api/health`、`/api/stats`、`/api/routes` 和 `/api/grids/*` 仍为三维地图兼容接口。

## 无人机能力数据库与推荐流程

本次新增的主要数据结构：

| 表 | 作用 |
| --- | --- |
| `static.drone_models` | 保存型号、厂商、载重、航程、速度、抗风和定位等静态参数 |
| `static.transport_capabilities` | 防震、防水、防漏、冷链、恒温和静音能力字典 |
| `static.drone_model_capabilities` | 保存型号是否原生支持、需要配件或尚未确认某项能力 |
| `runtime.drones` | 保存每架无人机当前电量、占用、故障、位置和最后在线时间 |
| `runtime.task_drone_candidates` | 保存候选无人机、通过/淘汰原因、排序和推荐理由 |

推荐过程为“确定性规则筛选 → Agent 解释”，Agent 不直接修改推荐和派发结果：

```text
任务重量、功能要求 + 算法航线里程
  → 查询型号载重、航程和运输能力
  → 合并单机电量、占用和故障状态
  → 生成候选与淘汰原因
  → Agent 向校方和运营人员解释
  → 运营人员最终确认
```

安全可用航程暂按“标称航程 × 当前电量比例 × 0.7 安全系数”计算。防震、防水等标记为“需要配件”的能力，必须由运营人员确认对应货箱或包装。

操作记录继续保存在 PostgreSQL：

- `runtime.operation_events`：派发、起飞、到达和交付等运营事件。
- `runtime.audit_events`：任务、审批、运营和安全事件的完整审计记录。

## 运营端强制派发展示开关

为保证比赛现场展示连续性，目前仅在“接收并派发任务”步骤启用临时强制派发：

- 前端允许直接点击派发按钮。
- 后端暂时跳过无人机占用、电量、载重、能力和接驳节点占用检查。
- 若资源仍与旧任务关联，会先解除旧关联，再绑定到当前任务。
- 其他任务提交、校方审核、航线生成和后续状态流程不受影响。

代码中已经标记 `TODO`。展示结束后必须同时执行：

1. 在 `demo/src/components/OperatorTaskPanel.vue` 中修改：

```js
const DEMO_FORCE_DISPATCH = false
```

2. 在 `pg-server/.env` 中配置并重启后端：

```env
DEMO_FORCE_DISPATCH=false
```

正式环境不得保持强制派发模式，否则可能转移其他任务正在使用的无人机或接驳节点。

## 数据库交付

完整数据库交付包位于 `deliverables/skynest_v3_database_20260818.zip`，包含 PostgreSQL 自定义格式备份、迁移脚本、SHA256 和恢复说明。数据库备份和 ZIP 体积较大，不应提交 GitHub，应单独交给组长。

恢复说明见 `deliverables/README_数据库恢复说明.md`。真实数据库密码和 DeepSeek API Key 不包含在交付包中。

## 验证与构建

后端提供建筑目录、V3数据与业务流程自测，涉及写入的测试均在事务中回滚或精确清理：

```powershell
cd pg-server
npm run verify-v3
npm run verify-building-catalog
npm run verify-dynamic-cost
npm run verify-dynamic-corridor
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

首次拉取包含本次航线解释功能的代码后，还需要执行：

```powershell
cd .\pg-server
npm run migrate-v3
```

该命令会应用 `007_route_agent_explanations.sql`，为当前航线保存解释正文、生成状态、生成时间和错误信息。

前端生产构建：

```powershell
cd demo
npm run build
```

- `demo/public/3dtiles/tileset.json` 尚未放入 → 自动回退到 GeoJSON 简易建筑
- 校园与无人机 GLB 模型已包含在 `demo/public/Models/`

## 当前未完成项

- Ollama 或百炼真实模型环境验证。
- nginx/进程守护等生产部署配置。
- 真实倾斜摄影 3D Tiles；当前使用校园 GLB 和简易建筑降级。

- 确认本机 dump 文件路径：`.\nanjing_uni_3d_grid_new.sql`
- 查看日志：`pg-server/import.log`
- 若表已存在可先清空：`TRUNCATE nanjing_uni_3d_grid_new;` 后重新导入

## 常见问题

### 页面打不开

确认 3001 和 5173 端口服务均已启动，并通过 `http://localhost:5173/` 访问。

| 模块 | 内容 |
|------|------|
| **数据库** | PostgreSQL 18 安装配置；`nanjing_uni_3d_grid_new` 表 **2,401,380 条**数据已导入 |
| **后端 API** | Express 服务：健康检查、统计、视口 bbox 查询、航线列表、航线适航评估、离线演示格网 |
| **前端平台 UI** | 学生任务端、校方任务中心、图层控制、热力图时序、航线、适航图例与评估面板 |
| **AI 与系统集成** | 结构化任务 Agent、地点匹配、运力规则、任务状态机、企业接口沙箱与遥测状态聚合 |
| **Cesium 三维** | 卫星底图（Cesium Ion）、本地地形、校园建筑 GeoJSON 贴地显示、视口格网渲染 |
| **性能优化** | 240 万条改为视口按需加载（bbox + limit 6000），避免全量渲染卡死 |
| **坐标修正** | 确认格网坐标为 WGS84，移除错误的 CGCS2000 转换 |
| **容错机制** | DB 连接重试 + 15 秒轮询；API 不可用时的默认航线与演示格网；下拉数据优先于 Cesium 初始化加载 |
| **启动脚本** | `start.ps1` 一键启动；`import-data.ps1` 一键导入；`install-postgresql-service.ps1` 安装数据库 |

检查 PostgreSQL 服务、本地 `.env`、`PG_V3_DATABASE` 和 PostGIS，然后运行 `npm run verify-v3` 获取明确错误。

| 模块 | 说明 |
|------|------|
| **3D Tiles 实景** | `demo/public/3dtiles/tileset.json` 待放入倾斜摄影数据 |
| **PostGIS** | 当前以 text 字段替代 geometry，功能可用；后续可选安装 PostGIS 恢复空间索引 |
| **生产部署** | 目前为开发模式（Vite dev + Node API），尚未配置 nginx / PM2 等生产方案 |

这是默认且可用的安全模式，不代表 Agent 失败。只有自然语言润色需要 Ollama 或百炼，字段解析与安全规则不依赖语言模型。

### 3D Tiles 无法显示

`demo/public/3dtiles/tileset.json` 尚未提供时，页面会使用 `campus-model2.glb`；格网、热力图和业务流程不受影响。

### 前端构建出现 Cesium externalized 提示

| 需求 | 命令 / 文件 |
|------|-------------|
| 一键启动 | `.\start.ps1` |
| 导入格网 | `.\pg-server\import-data.ps1` |
| 建索引 | `cd pg-server && node setup-db.js` |
| 修改航线 | 编辑 `pg-server/data/routes.json` |
| 修改前端配置 | 编辑 `demo/public/config/app.json` |
| 修改数据库连接 | 编辑 `pg-server/.env` 或环境变量 |

---

最后更新：2026-08-18
