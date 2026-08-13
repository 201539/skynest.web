# SkyNest Demo 统一数据契约（v1）

本契约用于师生提交端、校方监管端、运营商端、AI Agent、路径算法与后端数据库之间的数据交换。前端代码中的唯一枚举与默认结构位于 `demo/src/domain/contracts.js`。

## 1. 角色

| 值 | 含义 |
|---|---|
| `student` | 师生及校内业务部门提交运输任务 |
| `school` | 校方查看解释、审批、临时限制与熔断 |
| `operator` | 运营商接收航点并更新无人机、任务与节点状态 |

## 2. 运输任务 `TransportTask`

核心字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | string | 是 | 任务唯一编号 |
| `input_text` | string | 否 | 用户输入的自然语言原文 |
| `requester` | object | 是 | 申请人编号、姓名和部门 |
| `origin` | string | 是 | 起点名称 |
| `destination` | string | 是 | 终点名称 |
| `item_category` | string | 是 | 物品类型 |
| `weight_kg` | number | 是 | 重量（kg） |
| `deadline` | string | 是 | ISO 8601时间或比赛阶段约定的时间字符串 |
| `priority` | string | 是 | `normal` / `urgent` / `emergency` |
| `safety_level` | string | 是 | `normal` / `high` |
| `special_requirements` | string[] | 否 | 防震、冷链等特殊要求 |
| `recommended_vehicle_class` | string/null | 否 | 必须由规则表返回，Agent不得凭常识生成 |
| `candidate_node_ids` | string[] | 否 | 候选接驳节点 |
| `assigned_drone_id` | string/null | 否 | 运营商实际分配的无人机 |
| `assigned_node_id` | string/null | 否 | 运营商实际分配的接驳节点 |
| `needs_manual_review` | boolean | 是 | 是否必须人工审核 |
| `missing_fields` | string[] | 是 | Agent发现的缺失字段 |
| `agent_analysis` | object/null | 否 | Agent解释、置信度、推理依据及用户确认记录 |
| `status` | string | 是 | 任务状态 |

任务状态顺序：

`draft` → `pending_review` → `approved` → `dispatched` → `in_transit` → `arriving` → `delivered`

异常分支：`rejected`、`exception`、`cancelled`。

### Agent解析结果 `agent_analysis`

| 字段 | 类型 | 说明 |
|---|---|---|
| `source` | string | 解析来源或版本标识 |
| `confidence_score` | number | 0—100的解析置信度，不代表任务安全评分 |
| `confidence_level` | string | `high` / `medium` / `low` |
| `explanation` | string | 面向用户的自然语言理解说明 |
| `reasoning` | string[] | 识别到的关键信息及推理依据 |
| `recognized_fields` | string[] | 已识别字段的中文名称 |
| `uncertain_fields` | string[] | 缺失或需要重点核对的字段 |
| `manual_review_reasons` | string[] | 触发人工复核的原因 |
| `confirmation_required` | boolean | 是否需要用户确认解析结果 |
| `confirmation_prompt` | string | 前端展示的确认提示 |
| `user_confirmed` | boolean | 用户是否确认解析结果 |
| `confirmed_at` | string/null | 用户确认时间 |

## 3. 航线 `RoutePlan`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 航线编号 |
| `task_id` | string | 对应任务编号 |
| `algorithm` | string | 算法名称，例如 `A*` |
| `waypoints` | object[] | 带经度、纬度、高度与ETA的航点链 |
| `main_risk_factors` | string[] | 算法实际返回的主要风险因素 |
| `avoided_zones` | string[] | 实际绕开的区域 |
| `distance_change_percent` | number/null | 相对基准航线的距离变化 |
| `risk_change_percent` | number/null | 相对基准航线的风险变化 |
| `total_length_meters` | number/null | 航程 |
| `estimated_duration_seconds` | number/null | 预计飞行时间 |

风险与距离百分比只有算法真实计算后才能展示；字段为空时前端不得编造。

## 4. 无人机状态 `DroneState`

关键字段：`id`、`name`、`operator`、`vehicle_class`、`position`、`battery_percent`、`status`、`task_id`、`updated_at`。

状态值：`idle`、`assigned`、`in_flight`、`returning`、`charging`、`fault`、`offline`。

## 5. 接驳节点 `NestNode`

关键字段：`id`、`name`、`node_type`、`location`、`availability`、`door_state`、`delivery_state`、`fault_code`、`updated_at`。

- 可用状态：`available`、`reserved`、`occupied`、`maintenance`、`offline`。
- 舱门状态：`closed`、`opening`、`open`、`closing`、`fault`。

## 6. 审批记录 `ApprovalRecord`

关键字段：`id`、`task_id`、`decision`、`reviewer`、`reason`、`reviewed_at`。

审批值：`pending`、`approved`、`rejected`、`cancelled`。

## 7. 审计记录 `AuditRecord`

审计记录用于保存任务、审批、运营和安全事件。关键字段：`id`、`event_type`、`category`、`task_id`、`title`、`description`、`actor`、`resource`、`metadata`、`created_at`。

- 分类值：`task`、`approval`、`operation`、`safety`。
- 记录只追加不覆盖；模拟模式最多保留最近 500 条。
- 模拟模式使用浏览器本地存储，刷新页面后任务状态和审计记录仍会保留。

## 8. 前端统一接口层

接口适配器位于 `demo/src/services/demoApi.js`。默认使用模拟数据：

```env
VITE_DEMO_API_MODE=mock
```

可选模式：

- `mock`：始终使用本地模拟数据，保证比赛演示稳定。
- `real`：只访问真实接口，失败时直接报错。
- `auto`：优先访问真实接口，失败后自动回退模拟数据。

为后续真实后端预留的路径：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/demo/overview/:role` | 角色工作台概览 |
| GET/POST | `/api/demo/tasks` | 查询或提交任务 |
| GET | `/api/demo/student/workspace` | 师生任务、审核、航线与执行进度 |
| GET | `/api/demo/audit` | 任务、审批、运营和安全操作审计记录 |
| POST | `/api/demo/agent/parse` | 自然语言任务解析 |
| GET | `/api/demo/reviews` | 校方任务审核队列（任务、航线、审批记录） |
| POST | `/api/demo/tasks/:id/review` | 校方批准或驳回任务 |
| GET | `/api/demo/operator/workspace` | 运营任务、无人机和接驳节点工作台 |
| POST | `/api/demo/operator/tasks/:id/dispatch` | 分配无人机与节点并派发任务 |
| POST | `/api/demo/operator/tasks/:id/advance` | 推进运输、到达与交付状态 |
| GET | `/api/demo/safety/workspace` | 临时限制区和执行中任务 |
| POST | `/api/demo/safety/restrictions` | 创建临时空域限制 |
| PATCH | `/api/demo/safety/restrictions/:id` | 启用或停用临时限制 |
| POST | `/api/demo/safety/tasks/:id/emergency-stop` | 对执行中任务实施安全熔断 |
| POST | `/api/demo/safety/tasks/:id/replan` | 根据生效限制区重新规划冲突航线 |
| GET | `/api/demo/drones` | 无人机状态列表 |
| GET | `/api/demo/nodes` | 接驳节点状态列表 |

真实接口未完成前，不修改页面调用方式，只需保持返回结构与本契约一致。
