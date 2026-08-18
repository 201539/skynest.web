# Skynest V3 数据库交付说明

## 文件内容

- `nanjing_uni_grid_v3_test_20260818.dump`：PostgreSQL 自定义格式完整备份，包含格网、建筑、任务工作流、无人机静态能力与动态状态。
- `008_drone_capability_recommendations.sql`：本次无人机能力与推荐功能的独立迁移脚本，便于代码审查。

## 本次新增的数据结构

- `static.drone_models`：8 个调研无人机型号及载重、航程、速度、抗风、定位等静态参数。
- `static.transport_capabilities`：防震、防水、防漏、冷链、恒温、静音等运输能力字典。
- `static.drone_model_capabilities`：型号与运输能力的对应关系，并区分原生支持、需配件和未知。
- `runtime.drones` 扩展字段：型号关联、故障状态、状态来源、最后在线时间、遥测更新时间。
- `runtime.task_drone_candidates`：每个任务的候选无人机、筛选结果、淘汰原因和推荐理由。
- `runtime.tasks` 扩展字段：学生确认、AI 推荐无人机、运营人员资源确认及最终选择理由。

## 恢复方式

建议安装 PostgreSQL 18，并新建一个空数据库后执行：

```powershell
createdb -U postgres skynest_v3
pg_restore -U postgres -d skynest_v3 --clean --if-exists --no-owner .\nanjing_uni_grid_v3_test_20260818.dump
```

如果目标数据库不是空库，恢复前请先备份原数据。数据库账号、密码和 DeepSeek API Key 不包含在交付包中，需要在目标电脑的本地环境变量或 `.env` 文件中单独配置。

## 业务规则

- 后台先用确定性规则筛选载重、航程、电量、占用状态、故障状态与功能要求。
- 当前安全可用航程按“标称航程 × 当前电量比例 × 0.7 安全系数”计算。
- Agent 只解释推荐结果，不直接派发无人机；运营人员确认后才能执行。
- 防震、防水等标记为“需配件”的型号，必须由运营人员确认对应货箱或包装配置。
