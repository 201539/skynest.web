# SkyNest 仙林校区无人机低空配送平台

SkyNest 是基于 **Vue 3、Cesium、Express、PostgreSQL/PostGIS** 的校园无人机配送演示平台，包含师生端、校方端、运营端、自然语言任务 Agent、动态适航格网、A* 航线规划、无人机推荐和操作审计。

当前版本用于本地比赛展示。三端业务闭环已打通，但“接收并派发任务”启用了临时展示开关，正式使用前必须恢复资源校验，详见[展示模式说明](#展示模式说明重要)。

## 主要功能

| 模块 | 功能 |
| --- | --- |
| 师生端 | 自然语言需求解析、表单回填、功能要求选择、人工确认、提交及进度查询 |
| 校方端 | 任务审核、型号推荐理由、动态航线生成、限制区、重规划、安全熔断和审计记录 |
| 运营端 | Agent 型号解释、无人机与接驳节点选择、派发、运输、到达和交付 |
| 无人机推荐 | 综合载重、航程、电量、占用、故障及防震、防水等功能筛选候选无人机 |
| 航线规划 | 基于真实三维格网动态 Cost 的 A*，综合静态环境、人流、天气、实时事件、能耗和转弯成本 |
| 三维地图 | 本地地形、校园模型、83 栋建筑、13 个固定节点、240 万级格网、航线和无人机 GLB |
| Agent | DeepSeek 自然语言字段提取及任务、航线、型号解释；不可用时回退确定性规则 |
| 数据审计 | 保存任务、审批、派发、安全事件和资源状态变化 |

师生放货和收货只能使用 `A–G` 的 L3 三级运输节点；L1、L2 不作为师生收发节点。

## 本次交付新增内容

- 导入 FP400 V4、ARK40、FZ90、TR9S、RA3P、FC30、JDX20、JDX50 共 8 个调研型号。
- 新增防震、防水、防漏、冷链、恒温、静音 6 类运输能力。
- 新增无人机静态型号、型号能力、动态状态和任务候选无人机数据结构。
- 校方审核说明增加具体型号推荐理由。
- 运营端增加 Agent 型号解释、AI 推荐和资源确认。
- 学生端增加任务确认按钮和运输功能选项。
- Cost 公式改为中文；无人机与航线同高；格网默认透明度调整为 25%。
- 修复运营端自动刷新取消确认、重复勾选和资源唯一约束冲突。

## 目录结构

```text
skynest.web/
├─ README.md
├─ start.ps1
├─ deliverables/                  # 数据库交付说明与迁移副本
├─ demo/                          # Vue + Cesium 前端
│  ├─ src/App.vue                 # 地图、格网、航线和无人机
│  ├─ src/components/             # 三端业务组件
│  └─ public/config/app.json      # 地图和格网配置
└─ pg-server/                     # Express 后端
   ├─ index.js
   ├─ agent/                      # 任务解析和确定性规则
   ├─ llm/                        # DeepSeek/Ollama/百炼
   ├─ lib/                        # 工作流、推荐、航线和审计
   └─ migrations/                 # V3 数据库迁移
```

## 环境要求

- Windows 10/11
- Node.js 18+
- PostgreSQL 18
- PostGIS 3.x
- Chrome 或 Edge

## 安装与数据库配置

```powershell
npm --prefix .\pg-server install
npm --prefix .\demo install
Copy-Item .\pg-server\.env.example .\pg-server\.env
```

在 `pg-server/.env` 中填写本机配置，不要提交该文件：

```env
PG_V3_HOST=127.0.0.1
PG_V3_PORT=5432
PG_V3_USER=postgres
PG_V3_PASSWORD=请填写本机数据库密码
PG_V3_DATABASE=nanjing_uni_grid_v3_test
PORT=3001
```

应用数据库迁移：

```powershell
cd .\pg-server
npm run migrate-v3
```

本次无人机能力迁移为 `pg-server/migrations/008_drone_capability_recommendations.sql`。

### 恢复交付数据库

完整数据库包为 `deliverables/skynest_v3_database_20260818.zip`。它包含完整格网数据，不应提交 GitHub。

```powershell
createdb -U postgres skynest_v3
pg_restore -U postgres -d skynest_v3 --clean --if-exists --no-owner .\nanjing_uni_grid_v3_test_20260818.dump
```

详细说明见 `deliverables/README_数据库恢复说明.md`。

## DeepSeek 配置

API Key 只能放在后端 `pg-server/.env`：

```env
DEEPSEEK_API_KEY=请填写新生成的服务端密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_TIMEOUT_MS=30000
LLM_ENABLED=true
LLM_PROVIDER=deepseek
LLM_FALLBACK_ENABLED=true
LLM_TIMEOUT_MS=30000
```

不要把真实 Key 写入 README、前端代码、截图或 Git 提交。密钥若曾公开，应先撤销并重新生成。

Agent 仅解释数据库和算法结果，不负责修改节点、航线、机型或审批结论。

## 启动项目

一键启动：

```powershell
.\start.ps1
```

或者分别启动：

```powershell
# 终端 1
cd .\pg-server
npm start

# 终端 2
cd .\demo
npm run dev
```

访问：

- 前端：<http://localhost:5173/>
- 后端健康检查：<http://localhost:3001/api/v3/health>

必须通过 Vite 地址访问，不要用 `file://` 打开页面。

## 本地演示账号

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 师生端 | `student` | `Student@2026` |
| 校方端 | `school` | `School@2026` |
| 运营端 | `operator` | `Operator@2026` |

正式部署必须设置独立密码：

```env
AUTH_ALLOW_DEMO_USERS=false
AUTH_STUDENT_PASSWORD=请设置正式密码
AUTH_SCHOOL_PASSWORD=请设置正式密码
AUTH_OPERATOR_PASSWORD=请设置正式密码
```

## 三端业务流程

```text
师生输入自然语言或填写表单
  → 核对并确认任务
  → 校方审核
  → 动态 Cost + A* 生成航线
  → Agent 解释航线和型号依据
  → 运营端选择无人机与接驳节点
  → 派发 → 运输 → 到达 → 交付
  → 自动释放资源并写入审计记录
```

操作记录保存在 PostgreSQL：

- `runtime.operation_events`：派发、起飞、到达和交付等运营事件。
- `runtime.audit_events`：任务、审批、运营和安全事件的完整审计记录。

## 展示模式说明（重要）

为保证比赛展示连续性，目前仅在运营端“接收并派发任务”步骤启用强制展示模式：

- 前端按钮不受资源确认条件限制。
- 后端暂时跳过无人机占用、电量、载重、能力和节点占用检查。
- 如果资源仍被旧任务占用，会先解除旧关联，再绑定到当前任务。
- 页面不会显示展示模式提示，但代码中保留了 `TODO` 注释。
- 其他提交、审核、航线生成和后续状态流程不受影响。

展示结束后必须同时恢复以下两处。

前端 `demo/src/components/OperatorTaskPanel.vue`：

```js
const DEMO_FORCE_DISPATCH = false
```

后台 `pg-server/.env`：

```env
DEMO_FORCE_DISPATCH=false
```

修改后重启后端。正式环境不得保持强制派发模式，否则可能转移其他任务正在使用的资源。

## 验证命令

```powershell
cd .\pg-server
npm run verify-v3
npm run verify-building-catalog
npm run verify-agent
npm run verify-task-workflow
npm run verify-operator-workflow
npm run verify-audit-trail
npm run verify-replanning
npm run verify-safety-actions
```

前端构建：

```powershell
cd .\demo
npm run build
```

涉及写入的验证脚本会在事务中回滚或精确清理测试数据。

## Git 与交付注意事项

不得提交 GitHub：

- `pg-server/.env` 和其他真实环境变量文件
- DeepSeek API Key、数据库密码
- `node_modules/`、`dist/`
- `.dump`、`.backup`、数据库 ZIP 等大型备份

建议向组长交付：

1. GitHub PR 链接。
2. `deliverables/skynest_v3_database_20260818.zip`。
3. `deliverables/README_数据库恢复说明.md`。
4. 行业调研原始文档。
5. 展示结束后关闭 `DEMO_FORCE_DISPATCH` 的提醒。

## 已知限制

- 当前为本地开发/比赛演示部署，未配置 nginx、HTTPS 和进程守护。
- 动态电量和无人机状态来自数据库或人工/模拟更新，尚未连接真实飞控遥测。
- 真实 3D Tiles 缺失时使用校园 GLB/建筑点位降级展示。
- 强制派发模式仅供展示，不能用于正式运行。

---

最后更新：2026-08-18
