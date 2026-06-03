# 仙林校区无人机适航评估平台 — 运行与配置说明

基于 **Vue 3 + Cesium 1.95 + Express + PostgreSQL 18** 的 Web 三维适航评估平台，支持适航格网视口加载、热力图时序、飞行航线与适航评分。

---

## 目录结构

```
F:\无人机大创\
├── README.md                      # 本说明文档
├── start.ps1                      # 一键启动 API + 前端
├── nanjing_uni_3d_grid_new.sql    # 格网数据备份（pg_dump TAR，约 1.3GB）
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
    ├── data/routes.json           # 3 条示范航线
    ├── schema.sql                 # 建表与索引
    ├── import-table.sql           # 无 PostGIS 兼容建表脚本
    ├── import-data.ps1            # 一键导入格网数据
    ├── setup-db.js                # 执行 schema.sql / 检查索引
    ├── install-postgresql-service.ps1  # PostgreSQL 18 安装与注册服务
    └── .env.example               # 环境变量模板
```

---

## 环境要求

| 组件 | 版本 / 说明 |
|------|-------------|
| 操作系统 | Windows 10/11 |
| Node.js | 18+（需已安装 npm） |
| PostgreSQL | 18.x，服务名 `postgresql-x64-18`，端口 `5432` |
| 浏览器 | Chrome / Edge（推荐），须通过 `http://localhost:5173` 访问 |

---

## 首次安装与配置

### 1. 安装 Node 依赖

```powershell
cd F:\无人机大创\pg-server
npm install

cd F:\无人机大创\demo
npm install
```

### 2. 安装并配置 PostgreSQL 18

**方式 A：已安装 PostgreSQL 18**

确保服务运行：

```powershell
Start-Service postgresql-x64-18
```

**方式 B：全新安装（需管理员 PowerShell）**

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
& "F:\无人机大创\pg-server\install-postgresql-service.ps1"
```

脚本默认配置：

| 项 | 值 |
|----|-----|
| 安装路径 | `C:\Program Files\PostgreSQL\18` |
| 数据目录 | `C:\PostgreSQL\18\data` |
| 服务名 | `postgresql-x64-18` |
| 超级用户 | `postgres` |
| 密码 | `974853` |
| 数据库 | `nanjing_uni_grid_score` |

> 说明：Program Files 下因权限问题无法 initdb，数据目录单独放在 `C:\PostgreSQL\18\data`。

### 3. 配置后端环境变量（可选）

复制模板并按需修改：

```powershell
cd F:\无人机大创\pg-server
copy .env.example .env
```

`.env` 字段说明：

```env
PG_HOST=localhost          # 数据库主机
PG_PORT=5432               # 数据库端口
PG_USER=postgres           # 数据库用户
PG_PASSWORD=974853         # 数据库密码
PG_DATABASE=nanjing_uni_grid_score   # 数据库名
PORT=3001                  # API 监听端口
```

未创建 `.env` 时，程序使用上述默认值。

### 4. 导入格网数据（约 240 万条）

确保 `F:\无人机大创\nanjing_uni_3d_grid_new.sql` 存在，然后执行：

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
& "F:\无人机大创\pg-server\import-data.ps1"
```

流程：建兼容表结构 → `pg_restore --data-only` 导入 → 校验行数。  
预期结果：**2,401,380 条**记录。导入日志：`pg-server/import.log`。

> 原 dump 含 PostGIS 类型（`box3d`、`geometry`），本机未装 PostGIS，已通过 `import-table.sql` 将 `geom` 改为 `text` 后导入。坐标字段 `x_min/y_min` 等已是 **WGS84 经纬度**，无需 CGCS2000 转换。

### 5. 初始化数据库索引（推荐）

数据导入完成后执行，加速 bbox 视口查询：

```powershell
cd F:\无人机大创\pg-server
node setup-db.js
```

### 6. 配置前端（可选）

编辑 `demo/public/config/app.json`：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `campusCenter` | 飞到校区的相机中心 | lng 118.956833, lat 32.111583 |
| `tileset3d` | 3D Tiles 实景路径 | `./3dtiles/tileset.json` |
| `campusBuildings` | 简易建筑 GeoJSON | `./data/campus-buildings.geojson` |
| `terrain` | 本地地形 | `./terrain`，enabled: true |
| `grid.bboxLimit` | 单次视口最大格网数 | 8000 |
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
F:\无人机大创\start.ps1
```

### 手动启动（便于查看日志）

**终端 1 — 后端 API**

```powershell
cd F:\无人机大创\pg-server
node index.js
# 输出：API 服务已启动: http://localhost:3001
```

**终端 2 — 前端**

```powershell
cd F:\无人机大创\demo
npm run dev
# 输出：Local: http://localhost:5173/
```

**浏览器访问**

```
http://localhost:5173
```

> ⚠️ 必须通过 Vite 开发服务器访问，**不要**用 `file://` 直接打开 HTML，否则 API 代理与静态资源会失效。

### 启动后自检

| 检查项 | 地址 | 预期结果 |
|--------|------|----------|
| 数据库连接 | http://localhost:5173/api/health | `{"ok":true,"database":"connected"}` |
| 格网统计 | http://localhost:5173/api/stats | `total: 2401380` |
| 航线列表 | http://localhost:5173/api/routes | 3 条航线 |
| 热力图索引 | http://localhost:5173/hotspotsdata/index.json | 168 个 CSV 文件名 |

页面顶栏应显示：**已连接 · 2,401,380 条格网**。  
若显示「数据库未连接」，先确认 `pg-server` 已启动，再点击顶栏 **重试** 或 **Ctrl+Shift+R** 强制刷新。

---

## 平台功能使用流程

```
打开 localhost:5173
    ↓
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

### 快捷键

| 按键 | 功能 |
|------|------|
| `O` | 飞到仙林校区 |
| `H` | 切换热力图图层 |
| `G` | 切换适航格网图层 |

### 适航评分图例

| 分数区间 | 等级 |
|----------|------|
| 0 ~ 0.2 | 严重不适航 |
| 0.2 ~ 0.4 | 不适航 |
| 0.4 ~ 0.6 | 基本达标 |
| 0.6 ~ 0.8 | 良好适航 |
| 0.8 ~ 1.0 | 最优适航 |

---

## 数据流架构

```
浏览器 (Vue + Cesium :5173)
    │
    ├── /hotspotsdata/*.csv          → 本地静态文件（168 帧热力图）
    ├── /data/campus-buildings.geojson → 校园建筑
    ├── /terrain/                    → 本地地形
    │
    └── /api/*  ──Vite 代理──►  pg-server (:3001)
                                    │
                                    └── PostgreSQL
                                        nanjing_uni_grid_score
                                        └── nanjing_uni_3d_grid_new
                                            (~240 万条适航格网)
```

---

## API 接口一览

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

`/api/grids/bbox` 主要参数：`xMin`, `xMax`, `yMin`, `yMax`, `zMin`, `zMax`, `limit`。

---

## 常见问题

### 顶栏显示「数据库未连接」

1. 确认 PostgreSQL 服务已启动：`Get-Service postgresql-x64-18`
2. 确认 API 已启动：`node index.js`（端口 3001）
3. 浏览器访问 http://localhost:5173/api/health 检查
4. 点击顶栏「重试」或 Ctrl+Shift+R 刷新

### 热力图 / 航线下拉框为空

1. 确认通过 `http://localhost:5173` 访问（非 file://）
2. 确认 `demo/public/hotspotsdata/index.json` 存在（`npm run dev` 会自动生成）
3. 确认 `pg-server` 已启动（航线从 API 加载；API 不可用时使用内置默认航线）
4. 强制刷新页面（Ctrl+Shift+R）

### 适航格网不显示

1. 左侧面板勾选「适航格网」
2. 确认顶栏已连接数据库
3. 拖动/缩放地图触发视口加载（每次最多 8000 条）
4. 数据库不可用时，若 `useDemoWhenOffline: true` 会显示演示格网

### 3D Tiles 实景 / GLB 模型不显示

- `demo/public/3dtiles/tileset.json` 尚未放入 → 自动回退到 GeoJSON 简易建筑
- `demo/public/Models/*.glb` 尚未放入 → 无人机模型不可用，不影响格网与热力图

详见 `demo/public/3dtiles/README.md` 与 `demo/public/Models/README.md`。

### 导入数据失败

- 确认 dump 文件路径：`F:\无人机大创\nanjing_uni_3d_grid_new.sql`
- 查看日志：`pg-server/import.log`
- 若表已存在可先清空：`TRUNCATE nanjing_uni_3d_grid_new;` 后重新导入

---

## 当前项目进度

### 已完成 ✅

| 模块 | 内容 |
|------|------|
| **数据库** | PostgreSQL 18 安装配置；`nanjing_uni_3d_grid_new` 表 **2,401,380 条**数据已导入 |
| **后端 API** | Express 服务：健康检查、统计、视口 bbox 查询、航线列表、航线适航评估、离线演示格网 |
| **前端平台 UI** | 图层控制、热力图时序（168 帧）、飞行航线（3 条）、格网透明度、适航图例、评估面板 |
| **Cesium 三维** | 卫星底图（Cesium Ion）、本地地形、校园建筑 GeoJSON 贴地显示、视口格网渲染 |
| **性能优化** | 240 万条改为视口按需加载（bbox + limit 8000），避免全量渲染卡死 |
| **坐标修正** | 确认格网坐标为 WGS84，移除错误的 CGCS2000 转换 |
| **容错机制** | DB 连接重试 + 15 秒轮询；API 不可用时的默认航线与演示格网；下拉数据优先于 Cesium 初始化加载 |
| **启动脚本** | `start.ps1` 一键启动；`import-data.ps1` 一键导入；`install-postgresql-service.ps1` 安装数据库 |

### 进行中 / 待完善 🔄

| 模块 | 说明 |
|------|------|
| **3D Tiles 实景** | `demo/public/3dtiles/tileset.json` 待放入倾斜摄影数据 |
| **GLB 模型** | 校园模型 `campus-model2.glb`、无人机模型 `parrot_camo_drone.glb` 待放入 |
| **PostGIS** | 当前以 text 字段替代 geometry，功能可用；后续可选安装 PostGIS 恢复空间索引 |
| **生产部署** | 目前为开发模式（Vite dev + Node API），尚未配置 nginx / PM2 等生产方案 |

### 功能完成度概览

```
核心功能 ████████████████████░░  ~90%
  ├─ 适航格网加载与展示      ✅
  ├─ 热力图时序              ✅
  ├─ 飞行航线与适航评估      ✅
  ├─ 校园建筑图层            ✅
  ├─ 本地地形                ✅
  ├─ 3D Tiles 实景           ⏳ 待数据
  └─ 无人机 GLB 模型         ⏳ 待数据
```

---

## 相关文件速查

| 需求 | 命令 / 文件 |
|------|-------------|
| 一键启动 | `F:\无人机大创\start.ps1` |
| 导入格网 | `F:\无人机大创\pg-server\import-data.ps1` |
| 建索引 | `cd pg-server && node setup-db.js` |
| 修改航线 | 编辑 `pg-server/data/routes.json` |
| 修改前端配置 | 编辑 `demo/public/config/app.json` |
| 修改数据库连接 | 编辑 `pg-server/.env` 或环境变量 |

---

*最后更新：2026-06-03*
