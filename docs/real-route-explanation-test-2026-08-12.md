# 航线解释助手联调自测记录

日期：2026-08-12

## 已完成能力

- 解释只读取数据库已保存的算法结构化结果：主要风险因素、绕行区域、航程变化百分比、风险变化百分比。
- 风险因素代码在展示层转换为中文名称，原始证据仍完整保留在接口响应中。
- 首版航线没有上一版对照时，不展示或编造变化百分比。
- 重规划航线仅使用算法已计算并落库的百分比。
- 航点链或重规划对比值缺失时，自动降低可信度并要求人工确认。
- 校方端、师生端和运营端复用同一个解释结果和同一个展示组件。
- 提供独立真实接口：`GET /api/v3/tasks/:taskId/route-explanation`。

## 验证结果

- `npm run verify-route-explanation`：通过。
- `npm run verify-task-workflow`：通过，事务回滚后无测试残留。
- `npm run verify-replanning`：通过，新旧航线版本及变化百分比仍正常。
- 前端生产构建：通过。
- 浏览器校方端：解释卡片、证据完整度、数据来源正常显示。
- 浏览器师生端、运营端：同一解释卡片正常复用。
- 页面自测任务与关联航线、审批、审计记录已清理。

## 保护规则

接口中的 `guardrails.route_reason_inference_used` 固定为 `false`，表示解释服务没有自行推测路线原因；`guardrails.percentages_only_from_persisted_algorithm_result` 固定为 `true`，表示所有变化百分比只来自路径算法的持久化结果。
