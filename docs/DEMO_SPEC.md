# SkyNest 轻量化双端 Demo 规格

版本：v1.0  
冻结日期：2026-08-07  
适用范围：国创赛路演 Demo

## 1. 产品定位

SkyNest 是连接校园运输需求、校方治理、校园空间数据与合规无人机企业运力的校园低空物流服务平台。

Demo 不表达“团队独立制造或运营无人机”，而表达以下分工：

- 学生与教师通过小程序提出运输需求并跟踪服务；
- 校方通过管理端审核任务、查看空间风险、确认推荐通道并监管运行；
- SkyNest 负责需求编排、AI 辅助分析、校园空间适配、企业运力连接和过程可视化；
- 无人机企业负责飞机、机巢、飞行资质、最终执行航线、真实飞行和异常处置；
- 路演阶段的企业运单、飞行状态和遥测数据由 Mock 企业沙箱产生，界面必须明确标识为仿真数据。

## 2. Demo 目标

通过一次跨校区实验材料运输，完整演示：

1. 学生端提交结构化需求；
2. AI Agent 分析物品、时限、节点与运力条件；
3. 校方管理端收到待审批任务；
4. 校方查看 AI 建议与空间风险并批准；
5. SkyNest 调用现有格网和路线算法生成校园侧推荐通道；
6. Mock 企业接受任务并返回运单号、机型和状态；
7. Cesium 管理端展示飞行过程，学生端同步展示任务时间线；
8. 无人机到达接驳点，学生端收到取件码并完成取件。

## 3. 主场景

### 3.1 固定演示任务

- 申请角色：理科楼群实验室助理；
- 起点：理科楼群；
- 终点：实验中心；
- 物品：实验材料；
- 重量：2.5 kg；
- 特殊要求：防震；
- 优先级：高；
- 时限：当日 16:00 前送达；
- 推荐服务：校园轻型急件运输；
- 执行运力：Mock 无人机企业沙箱；
- 交付方式：固定接驳舱取件，不演示宿舍窗外投递。

### 3.2 扩展场景

以下场景只作为首页入口或静态说明，不进入第一版完整闭环：

- 跨校区文件与图书；
- 校园生活物资；
- 外卖到公共接驳点。

## 4. 用户与权限边界

### 4.1 学生端用户

允许：

- 创建运输任务；
- 查看本人任务；
- 查看简化后的 AI 建议；
- 查看审核与配送状态；
- 查看预计到达时间、接驳点和取件码；
- 确认取件。

不允许：

- 审批任务；
- 查看校园内部热力原始数据；
- 修改格网、禁飞区或企业状态；
- 查看企业接口密钥和原始回调；
- 控制无人机。

### 4.2 校方管理用户

允许：

- 查看全部演示任务；
- 查看完整 AI 分析与风险说明；
- 批准或驳回任务；
- 查看校园格网、热力、推荐航线和飞行状态；
- 发起企业运力匹配；
- 控制 Demo 的状态推进、异常和重置；
- 查看运营汇总。

### 4.3 企业运力方

Demo 不开发企业端 App。企业通过统一适配接口接收运力请求并返回：

- 企业运单号；
- 分配机型；
- 航班状态；
- 模拟遥测；
- 异常原因；
- 取件码。

## 5. 学生端页面

### 5.1 服务首页

必须展示：

- SkyNest 校园低空配送品牌；
- 主入口“实验材料/跨校区急件”；
- 次入口“文件图书”“校园生活物资”；
- 当前服务状态；
- 我的任务入口；
- 固定接驳点服务提示。

路演前端实现：第一轮使用 Express 托管的移动网页，访问 `/student`；页面字段、状态和 API 契约保持 uni-app 迁移兼容，不绑定微信登录或支付能力。

### 5.2 创建任务页

字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| origin | 下拉选择 | 是 | 起点校园节点 |
| destination | 下拉选择 | 是 | 终点校园节点，不能与起点相同 |
| item_category | 下拉选择 | 是 | 实验材料、文件图书、生活物资等 |
| weight_kg | 数字 | 是 | 必须大于 0 |
| deadline | 日期时间 | 是 | 期望送达时间 |
| priority | 单选 | 是 | normal/high/emergency |
| special_requirements | 多选 | 否 | 防震、保温、防水、易碎 |
| contact_name | 文本 | 是 | Demo 使用预设姓名亦可 |
| contact_phone | 文本 | 是 | Demo 数据，不使用真实个人号码 |
| agreement | 勾选 | 是 | 已阅读禁运与接驳点规则 |

### 5.3 AI 分析页

学生可见信息：

- 是否适合无人机服务；
- 推荐服务类型；
- 推荐接驳节点；
- 预计飞行距离和时长；
- 风险等级；
- 简明推荐理由；
- “提交校方审核”按钮。

不得显示：原始热力数据、完整规则文本、内部评分权重、企业接口原始返回。

### 5.4 任务跟踪页

必须展示：

- 任务编号；
- 当前状态；
- 状态时间线；
- 企业运力名称及“沙箱仿真”标签；
- 预计到达时间；
- 飞行进度；
- 到达后的接驳点与取件码。

### 5.5 取件完成页

必须展示：

- 取件码；
- 接驳点名称；
- “确认已取件”按钮；
- 完成时间；
- 简单评价入口可以作为后续增强，不属于首版必做。

## 6. 校方管理端页面与组件

第一版沿用现有 Vue + Cesium 页面，在侧栏新增任务管理组件，不重写地图。

### 6.1 任务总览

- 今日任务数；
- 待审批数；
- 飞行中数；
- 已完成数；
- 异常数。

### 6.2 待审批任务

展示：

- 申请人角色与院系；
- 运输字段；
- AI 完整分析；
- 推荐机型等级；
- 起终点匹配结果；
- 风险说明；
- 批准与驳回按钮。

### 6.3 三维空间与路线

沿用现有能力：

- 校园建筑；
- 人流热力；
- 适航格网；
- A* 推荐航线；
- 无人机模型动画。

新增：

- 任务起终点高亮；
- 当前任务编号；
- Mock 企业运单号；
- 当前飞行状态；
- 模拟遥测信息。

### 6.4 企业运力卡片

展示：

- 企业名称：SkyNest Partner Sandbox；
- 环境：Mock/Sandbox；
- 接口状态：可用；
- 推荐机型；
- 企业运单号；
- 最近状态更新时间；
- “匹配企业运力”按钮；
- “下一阶段”“模拟异常”“重置 Demo”控制按钮。

## 7. 统一任务状态机

### 7.1 状态定义

| 状态值 | 学生端文案 | 校方端含义 |
| --- | --- | --- |
| SUBMITTED | 申请已提交 | 任务已入库，等待 Agent 分析 |
| AGENT_REVIEWED | AI 分析完成 | Agent 已输出结构化建议 |
| PENDING_APPROVAL | 校方审核中 | 等待管理用户处理 |
| APPROVED | 校方已批准 | 允许生成路线并请求企业运力 |
| REJECTED | 申请未通过 | 校方已驳回，流程终止 |
| PROVIDER_ACCEPTED | 企业已接单 | Mock 企业返回运单号 |
| READY_FOR_TAKEOFF | 等待起飞 | 航班任务已创建 |
| IN_FLIGHT | 配送飞行中 | 正在生成并推送模拟遥测 |
| ARRIVED | 已到达接驳点 | 无人机已降落，等待取件 |
| PICKED_UP | 已取件 | 用户已确认取件 |
| COMPLETED | 配送已完成 | 任务闭环完成 |
| EXCEPTION | 配送异常 | 天气、返航或接口异常 |
| CANCELLED | 任务已取消 | 用户或校方取消任务 |

### 7.2 正常流转

```text
SUBMITTED
  -> AGENT_REVIEWED
  -> PENDING_APPROVAL
  -> APPROVED
  -> PROVIDER_ACCEPTED
  -> READY_FOR_TAKEOFF
  -> IN_FLIGHT
  -> ARRIVED
  -> PICKED_UP
  -> COMPLETED
```

### 7.3 分支规则

- PENDING_APPROVAL 可以进入 APPROVED 或 REJECTED；
- PROVIDER_ACCEPTED、READY_FOR_TAKEOFF、IN_FLIGHT 可以进入 EXCEPTION；
- EXCEPTION 在 Demo 控制下可以恢复到 READY_FOR_TAKEOFF 或 IN_FLIGHT；
- 未审批任务不得请求企业运力；
- 未到达任务不得生成取件码；
- 未确认取件不得进入 COMPLETED；
- 每次状态改变必须写入任务事件时间线。

## 8. 最小业务数据

第一版只新增两张业务表。

### 8.1 demo_tasks

建议字段：

```text
id
request_no
requester_role
requester_org
contact_name
contact_phone_masked
origin_text
destination_text
origin_node_id
destination_node_id
item_category
weight_kg
deadline
priority
special_requirements_json
status
agent_result_json
route_result_json
provider_code
provider_name
provider_order_no
provider_vehicle
provider_status
telemetry_json
pickup_code
exception_reason
approved_at
completed_at
created_at
updated_at
```

### 8.2 demo_task_events

建议字段：

```text
id
task_id
event_type
status
title
detail
source
payload_json
created_at
```

现有格网表保持不变：

- nanjing_uni_3d_grid_new；
- nanjing_uni_3d_grid_lod。

## 9. API 契约

### 9.1 学生端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/demo/tasks | 创建任务并触发 Agent 分析 |
| GET | /api/demo/tasks/:id | 查询学生可见任务详情 |
| GET | /api/demo/tasks/:id/events | 查询任务时间线 |
| POST | /api/demo/tasks/:id/submit | 将已分析任务提交校方审核 |
| POST | /api/demo/tasks/:id/pickup | 确认取件并完成任务 |

### 9.2 校方管理端

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/admin/demo/tasks | 查询任务列表，可按状态过滤 |
| GET | /api/admin/demo/tasks/:id | 查询完整任务、Agent、路线与企业信息 |
| POST | /api/admin/demo/tasks/:id/approve | 批准任务并触发路线规划 |
| POST | /api/admin/demo/tasks/:id/plan-route | 对已批准、未派单任务重试路线规划 |
| POST | /api/admin/demo/tasks/:id/reject | 驳回任务 |
| POST | /api/admin/demo/tasks/:id/dispatch | 请求 Mock 企业运力 |
| POST | /api/admin/demo/tasks/:id/advance | 手动推进企业状态 |
| POST | /api/admin/demo/tasks/:id/exception | 模拟异常 |
| POST | /api/admin/demo/reset | 重置演示数据，必须传 `confirmation: RESET_SKYNEST_DEMO` |

### 9.3 企业适配器内部接口

```js
createWaybill(task)
getWaybill(providerOrderNo)
advanceStatus(providerOrderNo)
getTelemetry(providerOrderNo)
simulateException(providerOrderNo, reason)
```

企业适配器不是前端公开 API，第一版仅由后端任务服务调用。

第一版实现的 `SkyNest Partner Sandbox` 仅生成演示运单、机型分配和模拟遥测；所有接口响应与页面均应保留“沙箱仿真”标识，不能作为真实企业接单或真实飞行的证明。

## 10. 前后端可见字段边界

### 10.1 学生端返回

- request_no；
- origin_text、destination_text；
- item_category、weight_kg、deadline；
- status 和学生文案；
- 简化后的 agent_summary；
- provider_display_name；
- estimated_arrival；
- progress；
- pickup_code（仅 ARRIVED 后返回）；
- events。

### 10.2 校方端返回

在学生字段基础上增加：

- 完整 agent_result；
- location_matches；
- vehicle_recommendation；
- route_result；
- provider_order_no；
- provider_vehicle；
- provider_raw_status；
- telemetry；
- exception_reason；
- 操作权限。

## 11. 路演操作脚本

1. 学生端首页选择“实验材料/科研急件”；
2. 使用预设值快速填写任务并提交；
3. 展示 Agent 分析页并点击“提交校方审核”；
4. 切换至大屏校方管理端，待审批任务自动出现；
5. 打开任务，讲解内部校园数据、AI 建议和人工审批边界；
6. 点击“批准”，现有路线引擎生成并展示推荐通道；
7. 点击“匹配企业运力”，Mock 企业返回运单号和机型；
8. 点击“开始飞行”或“下一阶段”，Cesium 播放无人机动画；
9. 切回学生端，展示状态已同步为“配送飞行中”；
10. 推进至“已到达”，学生端展示接驳点与取件码；
11. 点击“确认已取件”，校方总览同步增加一条已完成任务。

## 12. 首版明确不做

- 不做商品商城、购物车、优惠券和支付；
- 不做学生真实微信登录和校园统一身份认证；
- 不做商家端、骑手端或企业端 App；
- 不接入 Fleetbase、Medusa Eats 或大型微服务系统；
- 不接入真实飞控，不修改 PX4 或 QGroundControl；
- 不宣称已与具体企业签约；
- 不使用真实学生手机号、校园卡或门禁明细；
- 不让 LLM 直接批准飞行或控制无人机；
- 不将宿舍窗外投递作为第一版方案；
- 不把 Mock 数据包装成真实商业运营数据。

## 13. 实现约束

- 保留现有 Vue + Cesium 管理端、Express 后端、PostgreSQL 格网和 Agent；
- 学生端使用 uni-app Vue 3，新建独立目录；
- 第一版双端同步使用短轮询，不引入 WebSocket；
- 所有状态变更必须经过后端状态机；
- 所有状态变更必须写入 demo_task_events；
- Mock 企业必须实现统一适配器，未来真实企业接入时替换实现，不改业务流程；
- Demo 必须提供自动推进、手动推进、模拟异常和一键重置；
- 一键重置只允许清空 `demo_tasks` 与 `demo_task_events`，不得影响校园格网、地点配置或其他数据表；
- 数据库或企业沙箱不可用时必须有离线演示兜底；
- 真实密钥、密码与企业凭证不得进入前端、仓库或演示截图。

## 14. 第一版验收标准

只有同时满足以下条件，Demo 才算完成：

1. 学生端可以创建固定主场景任务；
2. Agent 输出结构化建议且结果可保存；
3. 校方端可以看到、批准或驳回任务；
4. 批准后可以调用现有路线算法并在 Cesium 展示；
5. Mock 企业可以返回运单号并推进状态；
6. 学生端和校方端看到同一个任务的同步状态；
7. 飞行中 Cesium 可以展示模拟位置变化；
8. 到达后学生端可以获取取件码并确认取件；
9. 完整流程可以一键重置并再次演示；
10. 页面明确区分真实算法、校内数据与企业沙箱仿真数据。

## 15. 后续实施顺序

1. 新增 demo_tasks 与 demo_task_events；
2. 建立状态机与任务 API；
3. 将现有 Agent 和路线算法编排进任务流程；
4. 实现 Mock 企业适配器；
5. 开发学生端 uni-app；
6. 改造校方 Cesium 管理端；
7. 完成轮询同步、演示控制和离线兜底；
8. 完成视觉、测试、启动脚本和路演说明。
