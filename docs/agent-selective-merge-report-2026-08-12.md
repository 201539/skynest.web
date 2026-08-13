# SkyNest Agent 选择性合并说明（2026-08-12）

## 合并原则

- 以当前 V3 代码为主干，保留动态 Cost、A* 路径规划、航线持久化、动态重规划、安全熔断、审计记录和三端真实工作流。
- 吸收压缩包中“任务解析 → 地点匹配 → 机型规则 → 角色解释”的 Agent 分层结构。
- 不合入压缩包中的旧路线算法、旧任务表、重复迁移、整页覆盖代码及任何 `.env` 密钥文件。

## 已合入功能

1. V3 任务 Agent
   - 自然语言提取起点、终点、物品、重量、时限、优先级和特殊要求。
   - 使用当前 `static.vehicle_rules` 与 `static.high_risk_categories` 重新计算机型、风险和包装要求。
   - 对前端提交结果进行服务端二次验证，防止客户端把高风险任务改成低风险或伪造机型。
   - 地点无法可靠匹配时不猜测，返回候选地点与澄清问题。

2. 可选解释模型
   - 支持本地 Ollama 和阿里云百炼两种解释来源。
   - 默认关闭模型，只用 V3 确定性规则说明，不影响离线演示。
   - 模型只润色角色说明，风险、机型、特殊要求等安全关键字段始终由规则覆盖。
   - 模型不可用、输出格式错误或越过审批权限时自动安全降级。
   - 百炼密钥只允许通过服务端环境变量配置，前端页面不接收也不显示密钥。

3. 页面接入
   - 师生端：显示解释来源、解析置信度、识别依据和人工核对项。
   - 校方端：新增模型状态与 Ollama/百炼选择；任务详情显示校方审核建议。
   - 运营端：任务详情显示批准后的机型、包装和执行要求。

## 新接口

- `POST /api/v3/agent/parse`：解析自然语言任务。
- `GET /api/v3/agent/status`：读取解释模型状态。
- `PUT /api/v3/agent/config`：切换解释来源及启用状态；不接受密钥。
- `POST /api/v3/tasks`：保留原接口，但在入库前增加 V3 Agent 服务端复核。

## 配置

配置示例位于 `pg-server/.env.example`。默认值为：

```ini
LLM_ENABLED=false
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:4b
LLM_FALLBACK_ENABLED=true
```

如使用百炼，只在后端 `.env` 配置 `DASHSCOPE_API_KEY`，不要写入前端或提交到代码仓库。

## 自测结果

- `npm run verify-agent`：通过。覆盖真实 V3 规则读取、自然语言解析、高风险判断、机型纠偏、特殊要求合并、地点歧义、模型越权输出拦截、事务回滚。
- `npm run verify-task-workflow`：通过。
- `npm run verify-operator-workflow`：通过。
- `npm run verify-route-explanation`：通过。
- 前端 `npm run build`：通过。
- 页面自测：师生端解析、校方模型状态、校方角色说明、运营角色说明均通过；仅出现已有 Cesium 地形轮廓提示，无新增页面错误。
- 页面自测临时任务已精确删除，相关任务、审批、航线与审计测试记录均未保留。
