<template>
  <div id="cesiumContainer" :class="{ 'pick-mode': pickModeActive }"></div>

  <header class="platform-header">
    <div class="header-title">{{ appConfig.title || '仙林校区无人机适航评估平台' }}</div>
    <div v-if="currentUser" class="session-badge">
      <span>{{ currentUser.role_label }}</span>
      <strong>{{ currentUser.name }}</strong>
      <button type="button" @click="handleLogout">退出</button>
    </div>
    <button v-if="legacyToolsEnabled" type="button" class="portal-home-button" @click="returnToRolePortal">旧角色入口</button>
    <div class="header-status">
      <span :class="['status-dot', dbConnected ? 'online' : 'offline']"></span>
      <span v-if="dbConnected">数据库已连接 · {{ gridTotal.toLocaleString() }} 条格网</span>
      <span v-else-if="dbServiceOnline">格网数据未导入
        <button class="link-btn" @click="checkDatabase(true)">重试</button>
      </span>
      <span v-else>
        数据库未连接
        <button class="link-btn" @click="checkDatabase(true)">重试</button>
      </span>
    </div>
  </header>

  <TaskSubmitPanel
    v-if="activeRole === ROLE.STUDENT"
    id="role-workspace-panel"
    :class="{ 'role-panel-collapsed': rightPanelCollapsed }"
    :aria-hidden="rightPanelCollapsed"
    :inert="rightPanelCollapsed"
    :current-user="currentUser"
    @notify="showStatus"
    @view-route="handleViewTaskRoute"
  />

  <SchoolReviewPanel
    v-else-if="activeRole === ROLE.SCHOOL"
    id="role-workspace-panel"
    :class="{ 'role-panel-collapsed': rightPanelCollapsed }"
    :aria-hidden="rightPanelCollapsed"
    :inert="rightPanelCollapsed"
    @notify="showStatus"
    @view-route="handleViewTaskRoute"
    @safety-updated="handleSafetyUpdated"
    @view-restriction="handleViewRestriction"
  />

  <OperatorTaskPanel
    v-else-if="activeRole === ROLE.OPERATOR"
    id="role-workspace-panel"
    :class="{ 'role-panel-collapsed': rightPanelCollapsed }"
    :aria-hidden="rightPanelCollapsed"
    :inert="rightPanelCollapsed"
    @notify="showStatus"
    @view-route="handleViewTaskRoute"
  />

  <button
    v-if="currentUser"
    type="button"
    class="panel-edge-toggle right-panel-toggle"
    :class="{ collapsed: rightPanelCollapsed }"
    :title="rightPanelCollapsed ? '展开任务工作台' : '收起任务工作台'"
    :aria-label="rightPanelCollapsed ? '展开右侧任务工作台' : '收起右侧任务工作台'"
    :aria-expanded="!rightPanelCollapsed"
    aria-controls="role-workspace-panel"
    @click="rightPanelCollapsed = !rightPanelCollapsed"
  >
    <span aria-hidden="true">{{ rightPanelCollapsed ? '‹' : '›' }}</span>
  </button>

  <aside id="map-control-panel" class="side-panel" :class="{ 'panel-collapsed': leftPanelCollapsed }" :aria-hidden="leftPanelCollapsed" :inert="leftPanelCollapsed">
    <section v-if="legacyToolsEnabled && activeRole === ROLE.SCHOOL" class="panel-section admin-task-section">
      <div class="admin-title-row">
        <h3>校方任务中心</h3>
        <button type="button" class="admin-refresh-btn" @click="loadAdminTasks(true)" :disabled="adminLoading">刷新</button>
      </div>
      <p class="hint">校方审核校园侧合规与空间适配；企业订单、遥测均为沙箱仿真。</p>
      <div class="admin-metrics">
        <div><span>待审</span><strong>{{ adminTaskCounts.pending }}</strong></div>
        <div><span>飞行中</span><strong>{{ adminTaskCounts.flying }}</strong></div>
        <div><span>已完成</span><strong>{{ adminTaskCounts.completed }}</strong></div>
      </div>
      <select v-model="adminStatusFilter" class="full-width" @change="loadAdminTasks()">
        <option value="">全部演示任务</option>
        <option value="PENDING_APPROVAL">待校方审核</option>
        <option value="APPROVED">已批准待派单</option>
        <option value="IN_FLIGHT">配送飞行中</option>
        <option value="EXCEPTION">配送异常</option>
        <option value="COMPLETED">已完成</option>
      </select>
      <div class="admin-task-list">
        <button
          v-for="task in adminTasks"
          :key="task.id"
          type="button"
          class="admin-task-item"
          :class="{ selected: task.id === selectedAdminTaskId }"
          @click="selectAdminTask(task.id)"
        >
          <span><strong>{{ task.origin_text }} → {{ task.destination_text }}</strong><small>{{ task.request_no }}</small></span>
          <em :class="adminStatusClass(task.status)">{{ task.status_label }}</em>
        </button>
        <p v-if="!adminLoading && !adminTasks.length" class="hint">当前筛选条件下暂无任务</p>
      </div>
      <div v-if="selectedAdminTask" class="admin-task-detail">
        <div class="admin-detail-head"><strong>{{ selectedAdminTask.item_category }} · {{ selectedAdminTask.weight_kg }}kg</strong><span>{{ selectedAdminTask.priority === 'high' ? '高优先级' : '常规任务' }}</span></div>
        <p>AI 建议：{{ selectedAdminTask.agent_result?.explanation || selectedAdminTask.agent_summary || '—' }}</p>
        <p v-if="selectedAdminTask.route_result">路线：{{ selectedAdminTask.route_result.algorithm }} · {{ selectedAdminTask.route_result.totalLengthMeters }}m · {{ selectedAdminTask.route_result.route?.points?.length || 0 }} 航点</p>
        <p v-if="selectedAdminTask.provider_display_name" class="sandbox-text">{{ selectedAdminTask.provider_display_name }} · {{ selectedAdminTask.provider_order_no || '尚未生成运单' }}</p>
        <div class="admin-action-row">
          <button v-if="selectedAdminTask.status === 'PENDING_APPROVAL'" type="button" class="approve-btn" @click="runAdminTaskAction('approve')" :disabled="Boolean(adminActionLoading)">批准并生成路线</button>
          <button v-if="selectedAdminTask.status === 'PENDING_APPROVAL'" type="button" class="reject-btn" @click="runAdminTaskAction('reject')" :disabled="Boolean(adminActionLoading)">驳回</button>
          <button v-if="selectedAdminTask.status === 'APPROVED'" type="button" class="dispatch-btn" @click="runAdminTaskAction('dispatch')" :disabled="Boolean(adminActionLoading)">匹配企业沙箱</button>
          <button v-if="canAdvanceAdminTask" type="button" class="advance-btn" @click="runAdminTaskAction('advance')" :disabled="Boolean(adminActionLoading)">推进至下一阶段</button>
          <button v-if="canSimulateAdminException" type="button" class="exception-btn" @click="runAdminTaskAction('exception')" :disabled="Boolean(adminActionLoading)">模拟异常</button>
          <button v-if="selectedAdminTask.route_result" type="button" class="show-route-btn" @click="showSelectedAdminTaskRoute" :disabled="Boolean(adminActionLoading)">在三维地图展示</button>
        </div>
        <div v-if="selectedAdminTask.telemetry" class="telemetry-box">
          <span>沙箱进度 {{ selectedAdminTask.telemetry.progress_percent ?? 0 }}%</span>
          <span>{{ selectedAdminTask.telemetry.provider_status || '待派单' }}</span>
        </div>
        <div v-if="adminTaskEvents.length" class="admin-events">
          <div v-for="event in adminTaskEvents.slice(-4)" :key="event.id">• {{ event.title }}</div>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <h3>图层控制</h3>
      <label class="layer-item"><input type="checkbox" v-model="layers.terrain" @change="toggleTerrain" /> 本地地形</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.tileset" @change="toggleTileset" /> 3D Tiles 实景</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.fallbackModel" @change="toggleFallbackModel" /> 校园三维模型</label>
      <label v-if="legacyToolsEnabled" class="layer-item"><input type="checkbox" v-model="layers.buildings" @change="toggleBuildings" /> 校园建筑（GeoJSON维护层）</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.officialBuildings" @change="toggleOfficialBuildings" /> 正式建筑点位（83）</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.fixedNodes" @change="toggleFixedNodes" /> 三级运输节点（13）</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.heatmap" @change="toggleHeatmap" /> 热力图</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.grid" @change="toggleGrid" /> 适航格网</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.route" @change="toggleRoute" /> 飞行路径</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.drone" @change="toggleDrone" /> 无人机</label>
    </section>

    <section class="panel-section">
      <h3>热力图时序</h3>
      <div class="row">
        <select v-model="selectedFile" @change="onFileChange" class="full-width">
          <option v-if="!csvFiles.length" disabled value="">暂无数据，请刷新页面</option>
          <option v-for="f in csvFiles" :key="f" :value="f">{{ f }}</option>
        </select>
      </div>
      <div class="row btn-row">
        <button @click="prev">上一帧</button>
        <button @click="next">下一帧</button>
      </div>
    </section>

    <section v-if="legacyToolsEnabled && activeRole === ROLE.SCHOOL" class="panel-section">
      <h3>智能航线规划</h3>
      <label class="field-label">起点建筑</label>
      <select v-model="planStartName" class="full-width">
        <option v-if="!campusPlaces.length" disabled value="">加载建筑列表中...</option>
        <option v-for="p in campusPlaces" :key="'s-' + p.name" :value="p.name">{{ p.name }}</option>
      </select>
      <label class="field-label">终点建筑</label>
      <select v-model="planEndName" class="full-width">
        <option v-if="!campusPlaces.length" disabled value="">加载建筑列表中...</option>
        <option v-for="p in campusPlaces" :key="'e-' + p.name" :value="p.name">{{ p.name }}</option>
      </select>
      <p v-if="planStartPlace && planEndPlace" class="hint">
        起点 {{ planStartPlace.lng.toFixed(5) }}, {{ planStartPlace.lat.toFixed(5) }} ·
        高度 {{ planFlightHeight }}m
        <span v-if="planStartPlace.eastMeters != null">
          （相对白模锚点 E{{ Math.round(planStartPlace.eastMeters) }}m N{{ Math.round(planStartPlace.northMeters) }}m）
        </span>
        <span v-else-if="officialBuildingsLoaded">（V3正式建筑坐标）</span>
      </p>
      <p v-if="planSearchBboxText" class="hint">局部搜索：{{ planSearchBboxText }}</p>
      <p v-if="!officialBuildingsLoaded" class="hint warn-hint">
        正式建筑库尚未加载，旧演示点位不会用于航线规划
      </p>
      <p v-else-if="!canPlanRoute && campusPlaces.length" class="hint warn-hint">
        请选择不同的起点与终点建筑
      </p>
      <p v-if="!campusPlaces.length" class="hint warn-hint">建筑列表未加载，请刷新页面</p>
      <div class="row btn-row">
        <button type="button" class="plan-btn" @click="planSmartRoute" :disabled="planning || !canPlanRoute">
          {{ planning ? '动态 Cost A* 规划中...' : '动态 Cost 生成航线' }}
        </button>
        <button type="button" @click="flyToCampus">飞到校区</button>
      </div>
      <div v-if="planResult" class="eval-box pass">
        <div class="eval-title">规划结果</div>
        <div>算法：{{ planResult.algorithm }} · 航点 {{ planResult.route?.points?.length ?? 0 }} 个</div>
        <div>航程约 {{ ((planResult.totalLengthMeters || 0) / 1000).toFixed(2) }} km</div>
        <div v-if="planResult.dynamicCost?.enabled" class="hint">
          动态 Cost · 可通行 {{ planResult.dynamicCost.summary?.passable ?? 0 }}/{{ planResult.dynamicCost.summary?.total ?? 0 }} 个采样格网
          · 平均通行成本 {{ Number(planResult.dynamicCost.summary?.average_traversal_cost || 0).toFixed(2) }}
        </div>
        <div v-else-if="planResult.algorithm === 'A*' && !planResult.fallbackUsed" class="hint">
          基于适航格网 A* 寻路；开阔区域最优路径可能接近直线
        </div>
        <div v-if="planResult.fallbackUsed" class="demo-hint">未找到格网最优路径，已使用直线备选</div>
        <div v-if="planResult.demo" class="demo-hint">演示格网模式</div>
      </div>
    </section>

    <section v-if="legacyToolsEnabled && activeRole === ROLE.SCHOOL && !officialBuildingsLoaded" class="panel-section pick-section" :class="{ active: pickModeActive }">
      <h3>白模坐标标定</h3>
      <p class="hint">选建筑 → 开始取点 → 点击白模中心（取点后<strong>自动写入</strong>该建筑）</p>
      <label class="field-label">标定建筑</label>
      <select v-model="pickTargetName" class="full-width">
        <option v-if="!campusPlaces.length" disabled value="">加载建筑列表中...</option>
        <option v-for="p in campusPlaces" :key="'pick-' + p.name" :value="p.name">{{ p.name }}</option>
      </select>
      <div class="row btn-row">
        <button
          type="button"
          class="pick-btn"
          :class="{ on: pickModeActive }"
          @click="togglePickMode"
          :disabled="pickModeLoading"
        >
          {{ pickModeLoading ? '准备取点...' : pickModeActive ? '退出取点' : '开始取点' }}
        </button>
        <button type="button" @click="() => applyPickToBuilding()" :disabled="!lastPick || !pickTargetName">
          应用到建筑
        </button>
      </div>
      <div v-if="lastPick" class="eval-box pass pick-result">
        <div class="eval-title">最近取点</div>
        <div>WGS84：{{ lastPick.lng.toFixed(6) }}, {{ lastPick.lat.toFixed(6) }}</div>
        <div>相对白模锚点：E{{ Math.round(lastPick.eastMeters) }}m · N{{ Math.round(lastPick.northMeters) }}m</div>
        <div v-if="pickTargetName">已写入：{{ pickTargetName }}</div>
        <div v-if="pickAppliedName" class="demo-hint">✓ 已同步到航线规划坐标</div>
      </div>
      <div v-if="pickModeActive" class="hint warn-hint">取点模式：请在右侧白模上点击目标建筑中心（Esc 退出）</div>
      <div class="row btn-row">
        <button type="button" class="full-width-btn pick-save-btn" @click="savePlacesToServer" :disabled="placesSaving">
          {{ placesSaving ? '保存中...' : '保存 places.json 到服务器' }}
        </button>
      </div>
      <p v-if="campusPlaces.length" class="hint">已标定 {{ campusPlaces.length }} 栋 · 保存前请勿关闭页面</p>
      <button type="button" class="link-btn pick-link" @click="downloadPlacesJson">下载 JSON</button>
      <button type="button" class="link-btn pick-link" @click="copyPlacesJson">复制 JSON</button>
    </section>

    <section v-else-if="activeRole === ROLE.SCHOOL" class="panel-section official-place-section">
      <h3>正式校园点位</h3>
      <p class="hint">已从 V3 数据库加载 {{ campusPlaces.length }} 栋建筑、{{ officialFixedNodes.length }} 个三级运输节点，名称和坐标已锁定。</p>
      <div class="official-node-summary">
        <span>L1枢纽 <strong>{{ officialNodeSummary.l1 }}</strong></span>
        <span>L2运输节点 <strong>{{ officialNodeSummary.l2 }}</strong></span>
        <span>L3师生运输节点 <strong>{{ officialNodeSummary.l3 }}</strong></span>
      </div>
    </section>

    <section v-if="selectedOfficialFeature" class="panel-section official-feature-section">
      <div class="official-feature-heading">
        <h3>{{ selectedOfficialFeature.kind === 'building' ? '建筑点位详情' : '运输节点详情' }}</h3>
        <button type="button" class="detail-close-btn" @click="selectedOfficialFeature = null">×</button>
      </div>
      <template v-if="selectedOfficialFeature.kind === 'building'">
        <strong class="official-feature-name">{{ selectedOfficialFeature.name }}</strong>
        <p class="hint">分类：{{ buildingCategoryLabel(selectedOfficialFeature.category) }} · 数据库ID {{ selectedOfficialFeature.buildingId }}</p>
        <p class="hint">坐标：{{ formatOfficialCoordinate(selectedOfficialFeature) }}</p>
        <p class="hint">来源：{{ selectedOfficialFeature.sourceDataset || 'V3正式建筑库' }}</p>
        <div v-if="activeRole === ROLE.SCHOOL" class="row btn-row official-feature-actions">
          <button type="button" @click="setOfficialBuildingEndpoint(selectedOfficialFeature, 'start')">设为起点</button>
          <button type="button" @click="setOfficialBuildingEndpoint(selectedOfficialFeature, 'end')">设为终点</button>
        </div>
      </template>
      <template v-else>
        <strong class="official-feature-name">{{ fixedNodeLevelLabel(selectedOfficialFeature) }} · {{ officialNodeDisplayName(selectedOfficialFeature) }}</strong>
        <p class="hint">编号：{{ selectedOfficialFeature.node_code }} · {{ fixedNodeServiceLabel(selectedOfficialFeature) }}</p>
        <p class="hint">坐标：{{ formatOfficialCoordinate(selectedOfficialFeature.location) }}</p>
        <p class="hint">容量：{{ selectedOfficialFeature.capacity }} · 状态：{{ selectedOfficialFeature.status === 'active' ? '可用' : selectedOfficialFeature.status }}</p>
        <p class="hint">{{ selectedOfficialFeature.description || '暂无节点说明' }}</p>
        <button type="button" class="full-width-btn" @click="focusOfficialFeature(selectedOfficialFeature)">定位此节点</button>
      </template>
    </section>

    <section v-if="legacyToolsEnabled || currentRoute" class="panel-section">
      <h3>{{ legacyToolsEnabled ? '飞行航线' : '当前任务航线' }}</h3>
      <select v-if="legacyToolsEnabled" v-model="selectedRouteId" @change="onRouteSelect" class="full-width">
        <option value="">— 选择预设航线 —</option>
        <option v-for="r in routes" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <p v-if="currentRoute" class="route-desc">{{ currentRoute.description }}</p>
      <div class="row btn-row">
        <button type="button" @click="replayFlight" :disabled="!currentRoute">重播</button>
        <button type="button" @click="flyToCampus">飞到校区</button>
        <button v-if="legacyToolsEnabled && activeRole === ROLE.SCHOOL" type="button" @click="evaluateCurrentRoute" :disabled="evaluating">评估</button>
      </div>
      <div v-if="routeEvaluation" class="eval-box" :class="routeEvaluation.passable ? 'pass' : 'fail'">
        <div class="eval-title">航线适航评估</div>
        <div>综合评分：<strong>{{ routeEvaluation.averageScore?.toFixed(3) ?? '—' }}</strong></div>
        <div>结论：{{ routeEvaluation.overallVerdict }}</div>
        <div class="eval-waypoints">
          <div v-for="w in routeEvaluation.waypoints" :key="w.index" class="eval-wp">
            航点{{ w.index + 1 }}：{{ w.score?.toFixed(2) ?? '—' }}（{{ w.verdict }}）
          </div>
        </div>
      </div>
    </section>

    <section class="panel-section">
      <h3>格网设置</h3>
      <label class="slider-label">
        透明度 {{ Math.round(gridAlpha * 100) }}%
        <input type="range" min="0.1" max="1" step="0.05" v-model.number="gridAlpha" @input="onGridAlphaChange" />
      </label>
      <label v-if="gridDisplayMode !== 'route-dynamic'" class="slider-label">
        高度下限 {{ gridZMin }}m
        <input type="range" min="0" max="150" step="5" v-model.number="gridZMin" @change="reloadCurrentGridDisplay" />
      </label>
      <label v-if="gridDisplayMode !== 'route-dynamic'" class="slider-label">
        高度上限 {{ gridZMax }}m
        <input type="range" min="50" max="300" step="5" v-model.number="gridZMax" @change="reloadCurrentGridDisplay" />
      </label>
      <label class="slider-label">
        适宜性筛选
        <select v-model="gridScorePreset" @change="reloadCurrentGridDisplay" class="full-width">
          <option value="all">全部格网</option>
          <option value="risk">风险格网（低于 0.4）</option>
          <option value="caution">需关注格网（低于 0.6）</option>
          <option value="suitable">适宜格网（不低于 0.6）</option>
        </select>
      </label>
      <button class="full-width-btn" @click="reloadGridsInView" :disabled="gridLoading">
        {{ gridLoading ? '加载中...' : '显示当前视口静态格网' }}
      </button>
      <button
        v-if="activeRole === ROLE.SCHOOL && currentRoute?.planned"
        class="full-width-btn dynamic-grid-btn"
        @click="loadDynamicRouteGrids(currentRoute, { forceCurrentTime: true })"
        :disabled="gridLoading"
      >
        刷新航线动态评分
      </button>
      <label v-if="activeRole === ROLE.SCHOOL && currentRoute?.planned" class="dynamic-auto-refresh">
        <input v-model="gridAutoRefreshEnabled" type="checkbox" />
        <span>每 {{ gridAutoRefreshSeconds }} 秒自动刷新</span>
      </label>
      <p v-if="gridDemoMode" class="hint demo-hint">演示模式：格网数据未导入，显示校区模拟格网</p>
      <p v-else class="hint">
        已显示 {{ gridDisplayCount.toLocaleString() }} 个 · LOD {{ gridLod }}
        <span v-if="gridQueryMs != null"> · 查询 {{ gridQueryMs }}ms</span>
      </p>
      <p v-if="gridDisplayMode === 'route-dynamic'" class="hint dynamic-grid-hint">
        航线两侧 {{ gridCorridorMeters }}m · 静态/周期/实时三层 Cost
        <span v-if="gridDynamicAt"> · {{ formatGridTime(gridDynamicAt) }}</span>
      </p>
      <p v-if="gridDisplayMode === 'route-dynamic' && gridAutoRefreshEnabled" class="hint dynamic-grid-hint">
        自动刷新{{ gridAutoRefreshError ? `异常：${gridAutoRefreshError}` : gridAutoRefreshNextAt ? `已开启 · 下次 ${formatGridTime(gridAutoRefreshNextAt)}` : '等待中' }}
      </p>
      <p v-else class="hint">80m 飞行高度层 · 自动聚合远处格网 · 数据库 {{ gridTotal.toLocaleString() }} 条</p>
      <div v-if="gridDynamicSummary && gridDisplayMode === 'route-dynamic'" class="grid-summary-card">
        <span>可通行 <strong>{{ gridDynamicSummary.passable }}/{{ gridDynamicSummary.total }}</strong></span>
        <span>阻断 <strong>{{ gridDynamicSummary.blocked }}</strong></span>
        <span>平均 Cost <strong>{{ Number(gridDynamicSummary.average_traversal_cost || 0).toFixed(2) }}</strong></span>
      </div>
      <p v-if="gridDynamicSummary?.weather_data && gridDisplayMode === 'route-dynamic'" class="hint">
        天气参数：实时 {{ gridDynamicSummary.weather_data.realtime || 0 }} · 默认 {{ gridDynamicSummary.weather_data.configured_default || 0 }} · 过期 {{ gridDynamicSummary.weather_data.stale || 0 }} · 缺失 {{ gridDynamicSummary.weather_data.not_available || 0 }}
      </p>
      <div v-if="gridSelectedCell" class="grid-detail-card">
        <div class="grid-detail-title">
          <strong>格网 {{ gridSelectedCell.grid_code || gridSelectedCell.new_id }}</strong>
          <button type="button" @click="gridSelectedCell = null">×</button>
        </div>
        <div class="grid-layer-scores">
          <span>静态层 <strong>{{ formatGridScore(gridSelectedCell.layer_scores?.static) }}</strong></span>
          <span>周期层 <strong>{{ formatGridScore(gridSelectedCell.layer_scores?.periodic) }}</strong></span>
          <span>实时层 <strong>{{ formatGridScore(gridSelectedCell.layer_scores?.realtime) }}</strong></span>
        </div>
        <p>综合适航分：<strong>{{ formatGridScore(gridSelectedCell.suitability_score) }}</strong> · Cost {{ gridSelectedCell.traversal_cost ?? '阻断' }}</p>
        <p v-if="gridSelectedCell.risk_factors?.length">主要风险：{{ gridSelectedCell.risk_factors.map(riskFactorLabel).join('、') }}</p>
        <p>数据状态：周期层{{ formatPeriodicSources(gridSelectedCell) }}；天气{{ formatWeatherStatus(gridSelectedCell) }}</p>
        <p v-if="formatPeriodicMatches(gridSelectedCell)">周期命中：{{ formatPeriodicMatches(gridSelectedCell) }}</p>
        <p v-if="gridSelectedCell.hard_constraints?.length" class="grid-blocked">硬约束：{{ gridSelectedCell.hard_constraints.map(hardConstraintLabel).join('、') }}</p>
      </div>
    </section>
  </aside>

  <button
    type="button"
    class="panel-edge-toggle left-panel-toggle"
    :class="{ collapsed: leftPanelCollapsed }"
    :title="leftPanelCollapsed ? '展开地图控制面板' : '收起地图控制面板'"
    :aria-label="leftPanelCollapsed ? '展开左侧地图控制面板' : '收起左侧地图控制面板'"
    :aria-expanded="!leftPanelCollapsed"
    aria-controls="map-control-panel"
    @click="leftPanelCollapsed = !leftPanelCollapsed"
  >
    <span aria-hidden="true">{{ leftPanelCollapsed ? '›' : '‹' }}</span>
  </button>

  <div class="legend" :class="`legend-role-${activeRole}`">
    <h4>{{ gridDisplayMode === 'route-dynamic' ? '动态 Cost 适航评分' : '静态适航评分图例' }}</h4>
    <div class="legend-item"><span class="swatch" style="background:#be1414"></span> 0–0.2 严重不适航</div>
    <div class="legend-item"><span class="swatch" style="background:#ff6e14"></span> 0.2–0.4 不适航</div>
    <div class="legend-item"><span class="swatch" style="background:#fae650"></span> 0.4–0.6 基本达标</div>
    <div class="legend-item"><span class="swatch" style="background:#46bed2"></span> 0.6–0.8 良好适航</div>
    <div class="legend-item"><span class="swatch" style="background:#1482dc"></span> 0.8–1.0 最优适航</div>
  </div>

  <div v-if="statusMessage" class="status-toast">{{ statusMessage }}</div>

  <div v-if="loadingProgress > 0 && loadingProgress < 1" class="progress-bar">
    <div class="progress-fill" :style="{ width: (loadingProgress * 100) + '%' }"></div>
    <span>{{ Math.round(loadingProgress * 100) }}%</span>
  </div>

  <div v-if="!authReady" class="auth-loading">正在验证登录状态…</div>
  <LoginPanel
    v-else-if="!currentUser"
    :show-quick-accounts="Boolean(appConfig.ui?.showQuickLogin)"
    @authenticated="handleAuthenticated"
  />
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import proj4 from 'proj4'
import OperatorTaskPanel from './components/OperatorTaskPanel.vue'
import LoginPanel from './components/LoginPanel.vue'
import SchoolReviewPanel from './components/SchoolReviewPanel.vue'
import TaskSubmitPanel from './components/TaskSubmitPanel.vue'
import { ROLE } from './domain/contracts'
import { demoApi } from './services/demoApi'

proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs')
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs')
const cgcs2wgs84 = proj4('EPSG:4490', 'EPSG:4326')
const wgs842cgcs = proj4('EPSG:4326', 'EPSG:4490')

window.CESIUM_BASE_URL = '/'

const API_BASE = '/api'

const activeRole = ref('')
const currentUser = ref(null)
const authReady = ref(false)
const leftPanelCollapsed = ref(false)
const rightPanelCollapsed = ref(false)

async function handleAuthenticated(session) {
  currentUser.value = session.user
  activeRole.value = session.user.role
  await loadCampusPlaces()
  if (session.user.role === ROLE.SCHOOL) {
    if (fallbackModelEntity) await alignPlacesToModel()
  } else if (gridDisplayMode.value === 'route-dynamic') {
    resetDynamicGridDisplay({ reloadStatic: true })
  }
  if (viewer) {
    await renderOfficialMapFeatures()
    setupOfficialFeaturePickHandler()
  }
  showStatus(`已登录：${session.user.name} · ${session.user.role_label}`, 3500)
}

async function handleLogout() {
  await demoApi.logout()
  currentUser.value = null
  activeRole.value = ''
  resetDynamicGridDisplay()
  clearSessionRouteState()
  selectedOfficialFeature.value = null
  clearOfficialAccessHighlights()
}

function handleAuthExpired() {
  currentUser.value = null
  activeRole.value = ''
  resetDynamicGridDisplay()
  clearSessionRouteState()
  selectedOfficialFeature.value = null
  clearOfficialAccessHighlights()
  showStatus('登录状态已失效，请重新登录', 4500)
}

function clearSessionRouteState() {
  selectedRouteId.value = ''
  routes.value = []
  planResult.value = null
  routeEvaluation.value = null
  clearFlightEntities()
  clearReplanOriginalRoute()
}

function resetDynamicGridDisplay({ reloadStatic = false } = {}) {
  stopDynamicGridAutoRefresh()
  gridAutoRefreshError.value = ''
  if (gridDisplayMode.value !== 'route-dynamic') return
  gridAbortController?.abort()
  gridDisplayMode.value = 'viewport-static'
  gridDynamicAt.value = ''
  gridDynamicSummary.value = null
  clearAllGrids()
  if (reloadStatic && viewer && layers.grid) reloadGridsInView()
}

function authenticatedHeaders(extra = {}) {
  const token = demoApi.getCurrentSession()?.token
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }
}

function normalizeTaskRoute(payload) {
  const sourceRoute = payload?.route
  const task = payload?.task || {}
  const sourcePoints = sourceRoute?.points || sourceRoute?.waypoints || []
  const points = sourcePoints
    .map((point) => ({
      lng: Number(point.lng),
      lat: Number(point.lat),
      height: Number(point.height ?? 80),
    }))
    .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat) && Number.isFinite(point.height))

  if (!sourceRoute || points.length < 2) return null
  const estimatedSeconds = Number(sourceRoute.estimated_duration_seconds)
  const animationDuration = Number.isFinite(estimatedSeconds)
    ? Math.max(25, Math.min(60, Math.round(estimatedSeconds / 4)))
    : 35

  return {
    ...sourceRoute,
    id: sourceRoute.id || `task-route-${task.id || Date.now()}`,
    name: `任务航线 · ${task.origin || '起点'} → ${task.destination || '终点'}`,
    description: `关联任务 ${task.id || '未编号'}，共 ${points.length} 个航点`,
    points,
    duration: animationDuration,
    planned: true,
    taskRoute: true,
    sourceTaskId: task.id || null,
  }
}

async function handleViewTaskRoute(payload) {
  const taskRoute = normalizeTaskRoute(payload)
  if (!taskRoute) {
    showStatus('该任务暂未生成可显示的航点链', 4500)
    return
  }
  if (!viewer || viewer.isDestroyed()) {
    showStatus('三维地图尚未加载完成，请稍后重试', 4500)
    return
  }

  routes.value = [taskRoute, ...routes.value.filter((route) => route.id !== taskRoute.id)]
  selectedRouteId.value = taskRoute.id
  layers.route = true
  layers.drone = true
  await loadSelectedRoute(taskRoute, { isPlanned: true, skipEvaluation: true })
  if (activeRole.value === ROLE.SCHOOL) {
    await loadDynamicRouteGrids(taskRoute, {
      forceCurrentTime: !taskRoute.planning_context?.planned_for,
      at: taskRoute.planning_context?.planned_for,
    })
  }
  showReplanOriginalRoute(taskRoute)
  showStatus(taskRoute.replan_summary
    ? `动态重规划完成：航程${formatSignedChange(taskRoute.replan_summary.distance_change_percent)}，风险${formatSignedChange(taskRoute.replan_summary.risk_change_percent)}`
    : `已在地图中显示：${taskRoute.name}`, 5000)
}

function formatSignedChange(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '待计算'
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`
}

function applyRouteAccessHighlights(route) {
  const accessPoints = route?.planning_context?.access_points
  if (!accessPoints) return clearOfficialAccessHighlights()
  setOfficialAccessHighlights(accessPoints.departure, accessPoints.receiving)
}

function clearReplanOriginalRoute() {
  if (replanOriginalRouteEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(replanOriginalRouteEntity)
  }
  replanOriginalRouteEntity = null
}

function showReplanOriginalRoute(route) {
  clearReplanOriginalRoute()
  const points = route?.previous_waypoints || []
  if (!viewer || points.length < 2) return
  const positions = points
    .map((point) => Cesium.Cartesian3.fromDegrees(Number(point.lng), Number(point.lat), Number(point.height || 80)))
  replanOriginalRouteEntity = viewer.entities.add({
    name: '重规划前冲突航线',
    show: layers.route,
    polyline: {
      positions,
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.ORANGERED.withAlpha(0.9),
        dashLength: 14,
      }),
    },
  })
}

function clearRestrictionEntities() {
  if (!viewer) return
  restrictionEntities.forEach((entity) => viewer.entities.remove(entity))
  restrictionEntities = []
}

function renderSafetyRestrictions() {
  if (!viewer || viewer.isDestroyed()) return
  clearRestrictionEntities()
  safetyRestrictions.value
    .filter((restriction) => restriction.status === 'active')
    .forEach((restriction) => {
      const lng = Number(restriction.center?.lng)
      const lat = Number(restriction.center?.lat)
      const radius = Number(restriction.radius_m)
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(radius)) return

      const entity = viewer.entities.add({
        id: `safety-${restriction.id}`,
        name: restriction.name,
        position: Cesium.Cartesian3.fromDegrees(lng, lat, 8),
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          material: Cesium.Color.RED.withAlpha(0.22),
          outline: true,
          outlineColor: Cesium.Color.ORANGERED.withAlpha(0.9),
          height: 8,
        },
        label: {
          text: `临时限制 · ${restriction.name}`,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          backgroundColor: Cesium.Color.DARKRED.withAlpha(0.8),
          pixelOffset: new Cesium.Cartesian2(0, -18),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      restrictionEntities.push(entity)
    })
}

function handleSafetyUpdated(workspace) {
  safetyRestrictions.value = Array.isArray(workspace?.restrictions) ? workspace.restrictions : []
  renderSafetyRestrictions()
}

function handleViewRestriction(restriction) {
  if (!viewer || viewer.isDestroyed()) return
  const lng = Number(restriction?.center?.lng)
  const lat = Number(restriction?.center?.lat)
  const radius = Number(restriction?.radius_m)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, Math.max(700, (Number.isFinite(radius) ? radius : 150) * 4.5)),
    orientation: {
      heading: 0,
      pitch: -Cesium.Math.PI_OVER_TWO,
      roll: 0,
    },
    duration: 1.2,
  })
  showStatus(`已定位限制区：${restriction.name}`, 3500)
}

let viewer = null
let heatmapLayer = null
let tileset3d = null
let terrainProvider = null
let fallbackModelEntity = null
let campusBuildingsDs = null
let officialBuildingsDs = null
let officialFixedNodesDs = null
let routePolylineEntity = null
let replanOriginalRouteEntity = null
let droneEntity = null
let searchBboxEntity = null
let planPreviewEntity = null
let planMarkerEntities = []
let routeWaypointEntities = []
let restrictionEntities = []
let pickHandler = null
let pickMarkerEntity = null
let gridLoadTimer = null
let dbCheckTimer = null
let adminTaskTimer = null
let gridAutoRefreshTimer = null
let cameraMoveHandler = null
let gridAbortController = null
let gridRequestVersion = 0
let geometryCache = new Map()
let gridPrimitives = []
let renderedGridCells = new Map()
let gridPickHandler = null
let officialFeaturePickHandler = null
let officialFeatureByEntityId = new Map()

const appConfig = reactive({ title: '仙林校区无人机适航评估平台' })
const legacyToolsEnabled = computed(() => appConfig.ui?.showLegacyTools === true)
const csvFiles = ref([])
const selectedFile = ref('')
const DEFAULT_ROUTES = [
  {
    id: 'xianlin-demo-1',
    name: '仙林校区示范航线 A',
    description: '南门 → 图书馆 → 实验中心 → 体育馆',
    duration: 45,
    points: [
      { lng: 118.9490, lat: 32.1068, height: 80 },
      { lng: 118.9492, lat: 32.1082, height: 80 },
      { lng: 118.9505, lat: 32.1088, height: 80 },
      { lng: 118.9515, lat: 32.1078, height: 80 },
    ],
  },
  {
    id: 'xianlin-demo-2',
    name: '仙林校区示范航线 B',
    description: '食堂 → 敬文学院 → 理科楼 → 文科楼',
    duration: 50,
    points: [
      { lng: 118.9455, lat: 32.1085, height: 80 },
      { lng: 118.9468, lat: 32.1088, height: 80 },
      { lng: 118.9498, lat: 32.1095, height: 80 },
      { lng: 118.9518, lat: 32.1098, height: 80 },
    ],
  },
]

const routes = ref([])
const safetyRestrictions = ref([])
const selectedRouteId = ref('')
const loadingProgress = ref(0)
const gridLoading = ref(false)
const dbConnected = ref(false)
const dbServiceOnline = ref(false)
const gridTotal = ref(0)
const statusMessage = ref('')
const gridAlpha = ref(0.7)
const bboxLimit = ref(8000)
const groundHeight = ref(50)
const gridZMin = ref(0)
const gridZMax = ref(200)
const gridDemoMode = ref(false)
const gridScorePreset = ref('all')
const gridDisplayCount = ref(0)
const gridLod = ref(1)
const gridQueryMs = ref(null)
const gridBounds = ref(null)
const gridDisplayMode = ref('viewport-static')
const gridDynamicAt = ref('')
const gridDynamicSummary = ref(null)
const gridCorridorMeters = ref(90)
const gridSelectedCell = ref(null)
const gridAutoRefreshEnabled = ref(true)
const gridAutoRefreshNextAt = ref('')
const gridAutoRefreshError = ref('')
const gridAutoRefreshSeconds = computed(() => Math.max(
  10,
  Number(appConfig.grid?.dynamicRefreshSeconds) || 30,
))
const routeEvaluation = ref(null)
const evaluating = ref(false)

const campusPlaces = ref([])
const placesSource = ref('')
const officialFixedNodes = ref([])
const selectedOfficialFeature = ref(null)
const selectedAccessNodes = ref({ departure: null, receiving: null })
const planStartName = ref('')
const planEndName = ref('')
const planFlightHeight = ref(80)
const planning = ref(false)
const planResult = ref(null)
const agentSubmitting = ref(false)
const agentResult = ref(null)
const adminTasks = ref([])
const adminLoading = ref(false)
const adminStatusFilter = ref('')
const selectedAdminTaskId = ref('')
const adminTaskDetail = ref(null)
const adminTaskEvents = ref([])
const adminActionLoading = ref('')
const TASK_STATUS_PROVIDER_ACCEPTED = 'PROVIDER_ACCEPTED'
const agentForm = reactive({
  origin: '',
  destination: '',
  itemCategory: 'document',
  weightKg: null,
  deadline: '',
  priority: 'normal',
  specialRequirements: [],
})
const agentCategoryOptions = [
  { value: 'document', label: '文件资料' },
  { value: 'book', label: '图书教材' },
  { value: 'experimental_material', label: '实验材料' },
  { value: 'medicine', label: '药品' },
  { value: 'meal', label: '餐食外卖' },
  { value: 'medical_sample', label: '医疗样本（需人工审核）' },
  { value: 'biological_material', label: '生物材料（需人工审核）' },
]
const agentRequirementOptions = [
  { value: 'shockproof', label: '防震' },
  { value: 'cold_chain', label: '冷链' },
  { value: 'temperature_controlled', label: '恒温' },
  { value: 'fragile', label: '易碎' },
  { value: 'waterproof', label: '防水' },
]
const pickModeActive = ref(false)
const pickModeLoading = ref(false)
const pickTargetName = ref('')
const lastPick = ref(null)
const pickAppliedName = ref('')
const placesSaving = ref(false)
let placeLayoutRaw = []
const PLACES_DRAFT_KEY = 'xianlin-campus-places-draft'

function persistPlacesDraft() {
  if (!placeLayoutRaw.length) return
  try {
    localStorage.setItem(PLACES_DRAFT_KEY, JSON.stringify({
      places: placeLayoutRaw,
      updatedAt: new Date().toISOString(),
    }))
  } catch (e) {
    console.warn('标定草稿写入 localStorage 失败', e)
  }
}

function loadPlacesDraft() {
  try {
    const raw = localStorage.getItem(PLACES_DRAFT_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return Array.isArray(data?.places) && data.places.length ? data : null
  } catch {
    return null
  }
}

function clearPlacesDraft() {
  try {
    localStorage.removeItem(PLACES_DRAFT_KEY)
  } catch {
    // ignore
  }
}

const layers = reactive({
  terrain: true,
  tileset: true,
  fallbackModel: true,
  buildings: false,
  officialBuildings: true,
  fixedNodes: true,
  heatmap: false,
  grid: true,
  route: false,
  drone: true,
})

const currentRoute = computed(() => routes.value.find((r) => r.id === selectedRouteId.value))

const planStartPlace = computed(() =>
  campusPlaces.value.find((p) => p.name === planStartName.value) || null
)
const planEndPlace = computed(() =>
  campusPlaces.value.find((p) => p.name === planEndName.value) || null
)
const canPlanRoute = computed(() =>
  Boolean(
    officialBuildingsLoaded.value &&
    planStartName.value &&
    planEndName.value &&
    planStartName.value !== planEndName.value
  )
)
const officialBuildingsLoaded = computed(() => placesSource.value === 'v3-buildings' && campusPlaces.value.length === 83)
const selectedAdminTask = computed(() => {
  if (adminTaskDetail.value?.id === selectedAdminTaskId.value) return adminTaskDetail.value
  return adminTasks.value.find((task) => task.id === selectedAdminTaskId.value) || null
})
const adminTaskCounts = computed(() => ({
  pending: adminTasks.value.filter((task) => task.status === 'PENDING_APPROVAL').length,
  flying: adminTasks.value.filter((task) => task.status === 'IN_FLIGHT').length,
  completed: adminTasks.value.filter((task) => task.status === 'COMPLETED').length,
}))
const canAdvanceAdminTask = computed(() => [
  TASK_STATUS_PROVIDER_ACCEPTED,
  'READY_FOR_TAKEOFF',
  'IN_FLIGHT',
].includes(selectedAdminTask.value?.status))
const canSimulateAdminException = computed(() => [
  TASK_STATUS_PROVIDER_ACCEPTED,
  'READY_FOR_TAKEOFF',
  'IN_FLIGHT',
].includes(selectedAdminTask.value?.status))
const agentFormComplete = computed(() => Boolean(
  agentForm.origin.trim() &&
  agentForm.destination.trim() &&
  agentForm.itemCategory &&
  Number(agentForm.weightKg) > 0
))
const officialNodeSummary = computed(() => officialFixedNodes.value.reduce((summary, node) => {
  if (node.node_code === 'hub') summary.l1 += 1
  else if (/^[a-e]$/.test(node.node_code)) summary.l2 += 1
  else if (/^[A-G]$/.test(node.node_code)) summary.l3 += 1
  return summary
}, { l1: 0, l2: 0, l3: 0 }))

watch([planStartName, planEndName], () => {
  refreshPlanUi()
})

function fixedNodeLevel(node) {
  if (node?.node_code === 'hub') return 'L1'
  if (/^[a-e]$/.test(String(node?.node_code || ''))) return 'L2'
  if (/^[A-G]$/.test(String(node?.node_code || ''))) return 'L3'
  return '其他'
}

function fixedNodeLevelLabel(node) {
  return ({ L1: 'L1综合枢纽', L2: 'L2运输节点', L3: 'L3师生运输节点' })[fixedNodeLevel(node)] || '运输节点'
}

function officialNodeDisplayName(node) {
  const level = fixedNodeLevel(node)
  if (level === 'L1') return '校园综合运输枢纽'
  if (level === 'L2') return `${node.node_code}-L2运输节点`
  if (level === 'L3') return `${node.node_code}-L3三级运输节点`
  return node?.node_name || '运输节点'
}

function fixedNodeServiceLabel(node) {
  return node?.service_group === 'departure' ? '起飞服务节点'
    : node?.service_group === 'receiving' ? '接收服务节点'
      : '其他节点'
}

function buildingCategoryLabel(category) {
  return ({
    university: '学院/教学楼', school: '学校建筑', dormitory: '宿舍', stadium: '体育场馆', yes: '其他建筑',
  })[category] || category || '未分类'
}

function formatOfficialCoordinate(point) {
  const lng = Number(point?.lng)
  const lat = Number(point?.lat)
  return Number.isFinite(lng) && Number.isFinite(lat) ? `${lng.toFixed(6)}, ${lat.toFixed(6)}` : '坐标缺失'
}

const planSearchBbox = computed(() => {
  if (!planStartPlace.value || !planEndPlace.value) return null
  return computeLocalSearchBbox(planStartPlace.value, planEndPlace.value)
})
const planSearchBboxText = computed(() => {
  const b = planSearchBbox.value
  const start = planStartPlace.value
  if (!b || !start) return ''
  const w = ((b.xMax - b.xMin) * 111000 * Math.cos((start.lat * Math.PI) / 180) / 1000).toFixed(2)
  const h = ((b.yMax - b.yMin) * 111000 / 1000).toFixed(2)
  return `约 ${w}×${h} km`
})

function normalizeBbox(bbox) {
  if (!bbox) return null
  const xMin = Math.min(bbox.xMin, bbox.xMax)
  const xMax = Math.max(bbox.xMin, bbox.xMax)
  const yMin = Math.min(bbox.yMin, bbox.yMax)
  const yMax = Math.max(bbox.yMin, bbox.yMax)
  const minSpan = 0.0008
  return {
    xMin: xMax - xMin < minSpan ? xMin - minSpan / 2 : xMin,
    xMax: xMax - xMin < minSpan ? xMax + minSpan / 2 : xMax,
    yMin: yMax - yMin < minSpan ? yMin - minSpan / 2 : yMin,
    yMax: yMax - yMin < minSpan ? yMax + minSpan / 2 : yMax,
  }
}

function computeLocalSearchBbox(start, end) {
  const cfg = appConfig.routePlan?.searchBbox || {}
  const minPad = cfg.minPad ?? 0.002
  const ratio = cfg.ratio ?? 0.3
  const lngMin = Math.min(start.lng, end.lng)
  const lngMax = Math.max(start.lng, end.lng)
  const latMin = Math.min(start.lat, end.lat)
  const latMax = Math.max(start.lat, end.lat)
  const span = Math.max(lngMax - lngMin, latMax - latMin, 0.0008)
  const pad = Math.max(minPad, span * ratio)
  return normalizeBbox(clampBboxToCampus({
    xMin: lngMin - pad,
    xMax: lngMax + pad,
    yMin: latMin - pad,
    yMax: latMax + pad,
  }))
}

function showPlanSearchBbox(bbox) {
  if (!viewer || !bbox || appConfig.routePlan?.showSearchBbox === false) return
  const box = normalizeBbox(bbox)
  if (!box || box.xMax <= box.xMin || box.yMax <= box.yMin) return
  clearPlanSearchBbox()
  try {
    searchBboxEntity = viewer.entities.add({
      name: 'A* 局部搜索范围',
      rectangle: {
        coordinates: Cesium.Rectangle.fromDegrees(box.xMin, box.yMin, box.xMax, box.yMax),
        material: Cesium.Color.CYAN.withAlpha(0.08),
        outline: true,
        outlineColor: Cesium.Color.CYAN.withAlpha(0.7),
      },
    })
  } catch (e) {
    console.warn('搜索范围框绘制失败', e)
  }
}

function clearPlanSearchBbox() {
  if (searchBboxEntity && viewer) {
    viewer.entities.remove(searchBboxEntity)
    searchBboxEntity = null
  }
}

function clearRouteWaypoints() {
  if (viewer && !viewer.isDestroyed()) {
    for (const entity of routeWaypointEntities) {
      viewer.entities.remove(entity)
    }
  }
  routeWaypointEntities = []
}

function showRouteWaypoints(route) {
  if (!viewer || !route?.points?.length || route.points.length < 3) return
  clearRouteWaypoints()
  for (let i = 1; i < route.points.length - 1; i++) {
    const p = route.points[i]
    const entity = viewer.entities.add({
      name: `航点${i}`,
      position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.height),
      point: {
        pixelSize: 6,
        color: Cesium.Color.CYAN.withAlpha(0.9),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    routeWaypointEntities.push(entity)
  }
}

function clearPlanMarkers() {
  if (!viewer) return
  for (const entity of planMarkerEntities) {
    viewer.entities.remove(entity)
  }
  planMarkerEntities = []
}

function showPlanMarkers(start, end) {
  if (!viewer) return
  clearPlanMarkers()
  const addMarker = (place, color, label) => {
    const h = place.surfaceHeight ?? 5
    const entity = viewer.entities.add({
      name: label,
      position: Cesium.Cartesian3.fromDegrees(place.lng, place.lat, h),
      point: {
        pixelSize: 12,
        color,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: label,
        font: '13px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -22),
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromBytes(0, 0, 0, 160),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    planMarkerEntities.push(entity)
  }
  addMarker(start, Cesium.Color.LIME, `起点：${start.name}`)
  addMarker(end, Cesium.Color.ORANGE, `终点：${end.name}`)
}

function clearOfficialAccessHighlights() {
  selectedAccessNodes.value = { departure: null, receiving: null }
  refreshOfficialNodeStyles()
}

function setOfficialAccessHighlights(departure, receiving) {
  selectedAccessNodes.value = {
    departure: departure?.node_code || null,
    receiving: receiving?.node_code || null,
  }
  refreshOfficialNodeStyles()
}

function clearPlanPreviewLine() {
  if (planPreviewEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(planPreviewEntity)
  }
  planPreviewEntity = null
}

function showPlanPreviewLine(start, end) {
  if (!viewer || !start || !end) return
  clearPlanPreviewLine()
  const h = planFlightHeight.value || 80
  planPreviewEntity = viewer.entities.add({
    name: '规划预览',
    polyline: {
      positions: Cesium.Cartesian3.fromDegreesArrayHeights([
        start.lng, start.lat, h,
        end.lng, end.lat, h,
      ]),
      width: 3,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.CYAN.withAlpha(0.75),
        dashLength: 14,
      }),
    },
  })
}

function invalidatePlannedRouteIfStale() {
  const planned = routes.value.find((r) => r.id === selectedRouteId.value && r.planned)
  if (!planned) return
  const matchStart = planned.startName === planStartName.value
  const matchEnd = planned.endName === planEndName.value
  if (matchStart && matchEnd) return
  clearFlightEntities()
  selectedRouteId.value = ''
  planResult.value = null
  routeEvaluation.value = null
  clearOfficialAccessHighlights()
  resetDynamicGridDisplay({ reloadStatic: true })
  showStatus('起终点已变更，请重新点击 A* 生成航线', 4500)
}

function refreshPlanUi() {
  if (!viewer) return
  try {
    invalidatePlannedRouteIfStale()
    if (
      planStartPlace.value &&
      planEndPlace.value &&
      planStartName.value !== planEndName.value
    ) {
      showPlanMarkers(planStartPlace.value, planEndPlace.value)
      if (planSearchBbox.value) showPlanSearchBbox(planSearchBbox.value)
      showPlanPreviewLine(planStartPlace.value, planEndPlace.value)
    } else {
      clearPlanMarkers()
      clearPlanSearchBbox()
      clearPlanPreviewLine()
    }
  } catch (e) {
    console.warn('规划 UI 刷新失败', e)
  }
}

function onPlanPlaceChange() {
  refreshPlanUi()
}

function getModelAnchorDegrees(entity = null) {
  if (entity?.position) {
    const carto = Cesium.Cartographic.fromCartesian(
      entity.position.getValue(Cesium.JulianDate.now()),
    )
    return {
      lng: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height: carto.height,
    }
  }
  return appConfig.fallbackModel?.position || { lng: 118.944736, lat: 32.107470, height: 0 }
}

/** 世界坐标 → 相对白模锚点的 ENU 米制偏移（含 up，保证可逆） */
function cartesianToModelLocal(cartesian, entity = null) {
  const anchor = getModelAnchorDegrees(entity)
  const origin = Cesium.Cartesian3.fromDegrees(anchor.lng, anchor.lat, anchor.height || 0)
  const invEnu = Cesium.Matrix4.inverse(
    Cesium.Transforms.eastNorthUpToFixedFrame(origin),
    new Cesium.Matrix4(),
  )
  const local = Cesium.Matrix4.multiplyByPoint(invEnu, cartesian, new Cesium.Cartesian3())
  return {
    eastMeters: local.x,
    northMeters: local.y,
    upMeters: local.z,
  }
}

function wgs84ToModelLocalMeters(lng, lat, height = 0, entity = null) {
  const cartesian = Cesium.Cartesian3.fromDegrees(lng, lat, height)
  const local = cartesianToModelLocal(cartesian, entity)
  return { eastMeters: local.eastMeters, northMeters: local.northMeters, upMeters: local.upMeters }
}

/** 与白模同一坐标系：锚点 + 东/北米制偏移 → WGS84 绝对坐标 */
function resolvePlacesFromModelLocal(layout, entity = null) {
  const anchor = getModelAnchorDegrees(entity)
  const origin = Cesium.Cartesian3.fromDegrees(anchor.lng, anchor.lat, anchor.height || 0)
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(origin)

  return layout.map((p) => {
    if (p.lng != null && p.lat != null && p.eastMeters == null && p.northMeters == null) {
      return { ...p, name: p.name, lng: Number(p.lng), lat: Number(p.lat), height: p.height || 80 }
    }
    const east = p.eastMeters ?? (p.nx != null ? p.nx * 400 : 0)
    const north = p.northMeters ?? (p.ny != null ? p.ny * 400 : 0)
    const up = p.upMeters ?? 0
    const height = p.height || planFlightHeight.value || 80
    const world = Cesium.Matrix4.multiplyByPoint(
      enu,
      new Cesium.Cartesian3(east, north, up),
      new Cesium.Cartesian3(),
    )
    const carto = Cesium.Cartographic.fromCartesian(world)
    return {
      ...p,
      name: p.name,
      lng: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
      height,
      surfaceHeight: p.surfaceHeight ?? carto.height,
      eastMeters: east,
      northMeters: north,
      upMeters: up,
    }
  })
}

function getCampusReferenceSphere() {
  if (campusPlaces.value.length) {
    const lngs = campusPlaces.value.map((p) => p.lng)
    const lats = campusPlaces.value.map((p) => p.lat)
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2
    const radius = Math.max(
      ((Math.max(...lngs) - Math.min(...lngs)) * 111000) / 2,
      ((Math.max(...lats) - Math.min(...lats)) * 111000) / 2,
      350,
    ) * 1.15
    return new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lng, lat, 80), radius)
  }
  const anchor = getModelAnchorDegrees(fallbackModelEntity)
  return new Cesium.BoundingSphere(
    Cesium.Cartesian3.fromDegrees(anchor.lng, anchor.lat, 50),
    500,
  )
}

function getFallbackAnchorSphere() {
  return getCampusReferenceSphere()
}

function buildRoutesFromPlaces() {
  const find = (name) => campusPlaces.value.find((p) => p.name === name)
  const pt = (name) => {
    const p = find(name)
    return p ? { lng: p.lng, lat: p.lat, height: p.height } : null
  }
  const routeDefs = [
    {
      id: 'xianlin-demo-1',
      name: '仙林校区示范航线 A',
      description: '南门 → 图书馆 → 实验中心 → 体育馆',
      duration: 45,
      names: ['南门入口', '图书馆', '实验中心', '方肇周体育馆'],
    },
    {
      id: 'xianlin-demo-2',
      name: '仙林校区示范航线 B',
      description: '食堂 → 敬文学院 → 理科楼 → 文科楼',
      duration: 50,
      names: ['食堂', '敬文学院', '理科楼群', '文科楼群'],
    },
    {
      id: 'xianlin-perimeter',
      name: '仙林校区环线巡检',
      description: '沿校区主要建筑环线飞行',
      duration: 70,
      names: ['南门入口', '方肇周体育馆', '北门广场', '学生公寓区 A', '食堂', '南门入口'],
    },
  ]
  return routeDefs
    .map((def) => {
      const points = def.names.map(pt).filter(Boolean)
      if (points.length < 2) return null
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        duration: def.duration,
        points,
      }
    })
    .filter(Boolean)
}

async function alignPlacesToModel() {
  if (!placeLayoutRaw.length) return
  const preservedPlanned = routes.value.filter((r) => r.planned)
  campusPlaces.value = resolvePlacesFromModelLocal(placeLayoutRaw, fallbackModelEntity)
  routes.value = officialBuildingsLoaded.value
    ? preservedPlanned
    : [...preservedPlanned, ...buildRoutesFromPlaces()]
  if (!campusPlaces.value.find((p) => p.name === planStartName.value)) {
    planStartName.value = campusPlaces.value[0]?.name || ''
  }
  if (!campusPlaces.value.find((p) => p.name === planEndName.value)) {
    planEndName.value = campusPlaces.value[Math.min(1, campusPlaces.value.length - 1)]?.name || ''
  }
  const anchor = getModelAnchorDegrees(fallbackModelEntity)
  const sample = campusPlaces.value.find((p) => p.name === '杜厦图书馆') || campusPlaces.value[0]
  if (sample && sample.eastMeters != null) {
    console.info(
      '[places] 白模锚点',
      anchor.lng.toFixed(6),
      anchor.lat.toFixed(6),
      '→',
      sample.name,
      sample.lng.toFixed(6),
      sample.lat.toFixed(6),
      `(E${sample.eastMeters}m N${sample.northMeters}m)`,
    )
  }
  if (planStartPlace.value && planEndPlace.value) {
    refreshPlanUi()
  }
}

async function loadCampusPlaces() {
  try {
    const [buildings, nodes] = await Promise.all([
      demoApi.listBuildings(),
      demoApi.listFixedNodes(),
    ])
    if (Array.isArray(buildings) && buildings.length === 83) {
      placeLayoutRaw = buildings.map((building) => ({
        name: building.building_name,
        lng: Number(building.location.lng),
        lat: Number(building.location.lat),
        height: appConfig.routePlan?.defaultFlightHeight || 80,
        buildingId: building.building_id,
        category: building.category,
        sourceDataset: building.source_dataset,
        source: 'v3-buildings',
      }))
      campusPlaces.value = resolvePlacesFromModelLocal(placeLayoutRaw, null)
      placesSource.value = 'v3-buildings'
      officialFixedNodes.value = Array.isArray(nodes) ? nodes : []
      if (officialFixedNodes.value.length !== 13) {
        throw new Error(`V3正式节点数量异常：${officialFixedNodes.value.length}`)
      }
      planStartName.value = campusPlaces.value.find((place) => place.name === '环境学院')?.name
        || campusPlaces.value[0]?.name || ''
      planEndName.value = campusPlaces.value.find((place) => place.name === '杜厦图书馆')?.name
        || campusPlaces.value[Math.min(1, campusPlaces.value.length - 1)]?.name || ''
      if (appConfig.routePlan?.defaultFlightHeight != null) {
        planFlightHeight.value = appConfig.routePlan.defaultFlightHeight
      }
      return true
    }
    throw new Error(`V3正式建筑数量异常：${buildings.length}`)
  } catch (officialError) {
    console.warn('V3正式建筑列表加载失败', officialError)
    if (viewer) clearOfficialMapFeatures()
    placeLayoutRaw = []
    campusPlaces.value = []
    officialFixedNodes.value = []
    selectedOfficialFeature.value = null
    selectedAccessNodes.value = { departure: null, receiving: null }
    planStartName.value = ''
    planEndName.value = ''
    placesSource.value = ''
    return false
  }
}

function getPlacesExportData() {
  return placeLayoutRaw.map((p) => {
    const eastMeters = Math.round(Number(p.eastMeters))
    const northMeters = Math.round(Number(p.northMeters))
    const out = {
      name: p.name,
      eastMeters: Number.isFinite(eastMeters) ? eastMeters : 0,
      northMeters: Number.isFinite(northMeters) ? northMeters : 0,
      height: p.height || planFlightHeight.value || 80,
    }
    if (p.upMeters != null && Number.isFinite(Number(p.upMeters))) {
      out.upMeters = Math.round(Number(p.upMeters) * 10) / 10
    }
    if (p.surfaceHeight != null && Number.isFinite(Number(p.surfaceHeight))) {
      out.surfaceHeight = Math.round(Number(p.surfaceHeight))
    }
    return out
  })
}

function validatePlacesPayload(places) {
  for (const p of places) {
    if (!p.name) return `存在未命名建筑`
    if (!Number.isFinite(p.eastMeters) || !Number.isFinite(p.northMeters)) {
      return `「${p.name}」坐标无效，请重新取点`
    }
  }
  return null
}

function clearPickMarker() {
  if (pickMarkerEntity && viewer) {
    viewer.entities.remove(pickMarkerEntity)
    pickMarkerEntity = null
  }
}

function showPickMarker(pick) {
  if (!viewer || !pick) return
  clearPickMarker()
  const position = pick.cartesian
    ? Cesium.Cartesian3.clone(pick.cartesian)
    : Cesium.Cartesian3.fromDegrees(pick.lng, pick.lat, pick.height || 0)
  pickMarkerEntity = viewer.entities.add({
    name: '标定点',
    position,
    point: {
      pixelSize: 14,
      color: Cesium.Color.MAGENTA,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `E${Math.round(pick.eastMeters)} N${Math.round(pick.northMeters)}`,
      font: '12px sans-serif',
      pixelOffset: new Cesium.Cartesian2(0, -24),
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromBytes(120, 0, 120, 200),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  })
}

function isCampusModelPick(picked) {
  if (!picked || !fallbackModelEntity) return false
  if (picked.id === fallbackModelEntity) return true
  return false
}

function pickCartesianOnModelRay(ray) {
  if (!ray || !fallbackModelEntity || !viewer) return null

  const time = viewer.clock.currentTime
  const sphere = new Cesium.BoundingSphere()
  if (fallbackModelEntity.computeBoundingSphere(time, sphere)) {
    const hit = Cesium.IntersectionTests.raySphere(ray, sphere)
    if (hit) {
      return Cesium.Ray.getPoint(ray, hit.start)
    }
  }

  const anchorPos = fallbackModelEntity.position?.getValue(time)
  if (anchorPos) {
    const normal = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(anchorPos, new Cesium.Cartesian3())
    const plane = Cesium.Plane.fromPointNormal(anchorPos, normal)
    return Cesium.IntersectionTests.rayPlane(ray, plane)
  }

  return null
}

function pickPointOnScene(windowPosition) {
  if (!viewer) return null
  const scene = viewer.scene
  scene.pickTranslucentDepth = true

  let cartesian = scene.pickPosition(windowPosition)
  if (Cesium.defined(cartesian)) {
    return cartesianToPickResult(cartesian)
  }

  const ray = viewer.camera.getPickRay(windowPosition)
  if (!ray) return null

  const picked = scene.pick(windowPosition)
  const drilled = scene.drillPick(windowPosition, 12)
  const hitModel = isCampusModelPick(picked)
    || drilled.some((item) => isCampusModelPick(item))

  if (hitModel) {
    cartesian = pickCartesianOnModelRay(ray)
    if (Cesium.defined(cartesian)) {
      return cartesianToPickResult(cartesian)
    }
  }

  if (Cesium.defined(picked)) {
    cartesian = scene.pickPosition(windowPosition)
    if (Cesium.defined(cartesian)) {
      return cartesianToPickResult(cartesian)
    }
  }

  cartesian = scene.globe.pick(ray, scene)
  if (Cesium.defined(cartesian)) {
    return cartesianToPickResult(cartesian, hitModel ? 'globe-fallback' : 'globe')
  }

  cartesian = viewer.camera.pickEllipsoid(windowPosition, Cesium.Ellipsoid.WGS84)
  if (Cesium.defined(cartesian)) {
    return cartesianToPickResult(cartesian, 'ellipsoid')
  }

  return null
}

function cartesianToPickResult(cartesian, source = 'direct') {
  const carto = Cesium.Cartographic.fromCartesian(cartesian)
  const lng = Cesium.Math.toDegrees(carto.longitude)
  const lat = Cesium.Math.toDegrees(carto.latitude)
  const local = cartesianToModelLocal(cartesian, fallbackModelEntity)
  return {
    cartesian: Cesium.Cartesian3.clone(cartesian),
    lng,
    lat,
    height: carto.height,
    eastMeters: local.eastMeters,
    northMeters: local.northMeters,
    upMeters: local.upMeters,
    source,
  }
}

function pickPointOnSceneDeferred(windowPosition) {
  return new Promise((resolve) => {
    if (!viewer) {
      resolve(null)
      return
    }
    viewer.scene.requestRender()
    const remove = viewer.scene.postRender.addEventListener(() => {
      remove()
      resolve(pickPointOnScene(windowPosition))
    })
  })
}

async function onPickClick(movement) {
  if (!pickModeActive.value) return

  try {
    let pick = pickPointOnScene(movement.position)
    if (!pick) {
      pick = await pickPointOnSceneDeferred(movement.position)
    }
    if (!pick) {
      showStatus('未取到坐标，请放大后点击地图或白模区域', 5000)
      return
    }
    if (pick.source === 'globe-fallback' || pick.source === 'globe' || pick.source === 'ellipsoid') {
      showStatus('已近似取点；放大后点击白模表面可提高精度', 3500)
    }

    lastPick.value = pick
    showPickMarker(pick)

    if (pickTargetName.value) {
      await applyPickToBuilding(pickTargetName.value, pick)
    } else {
      showStatus(
        `已取点 E${Math.round(pick.eastMeters)}m N${Math.round(pick.northMeters)}m，请先选择要标定的建筑`,
        4000,
      )
    }
  } catch (e) {
    console.error('取点失败', e)
    showStatus(`取点失败：${e.message}`, 5000)
  }
}

function setupPickHandler() {
  if (!viewer) return
  destroyPickHandler()
  pickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  pickHandler.setInputAction(onPickClick, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function destroyPickHandler() {
  if (pickHandler && !pickHandler.isDestroyed()) {
    pickHandler.destroy()
  }
  pickHandler = null
}

function exitPickMode() {
  pickModeActive.value = false
  pickModeLoading.value = false
  destroyPickHandler()
  showStatus('已退出取点模式', 2000)
}

async function togglePickMode() {
  if (pickModeActive.value || pickModeLoading.value) {
    exitPickMode()
    return
  }
  pickModeLoading.value = true
  try {
    const ok = await enterPickMode()
    if (!ok) exitPickMode()
  } finally {
    pickModeLoading.value = false
  }
}

async function enterPickMode() {
  if (!viewer) {
    showStatus('地图尚未加载', 3000)
    return false
  }

  layers.fallbackModel = true
  if (!fallbackModelEntity) {
    await setupFallbackModel()
  }
  if (fallbackModelEntity) {
    fallbackModelEntity.show = true
  }
  if (!fallbackModelEntity) {
    showStatus('白模未加载：请勾选「简易校园模型」或点「飞到校区」后重试', 6000)
    return false
  }

  await new Promise((r) => setTimeout(r, 200))
  pickModeActive.value = true
  setupPickHandler()
  showStatus('取点模式已开启：在地图上左键点击目标位置（Esc 退出）', 5000)
  return true
}

async function applyPickToBuilding(targetName = pickTargetName.value, pick = lastPick.value) {
  if (typeof targetName !== 'string') targetName = pickTargetName.value
  if (!pick || typeof targetName !== 'string' || !targetName) return

  if (!placeLayoutRaw.length) {
    await loadCampusPlaces()
  }

  const idx = placeLayoutRaw.findIndex((p) => p.name === targetName)
  if (idx < 0) {
    showStatus(`未找到建筑：${targetName}`, 4000)
    return
  }

  placeLayoutRaw[idx] = {
    name: targetName,
    eastMeters: pick.eastMeters,
    northMeters: pick.northMeters,
    upMeters: pick.upMeters ?? 0,
    height: placeLayoutRaw[idx].height || planFlightHeight.value || 80,
    surfaceHeight: pick.height,
  }

  pickAppliedName.value = targetName
  persistPlacesDraft()
  await alignPlacesToModel()
  refreshPlanUi()
  showStatus(
    `已更新 ${targetName}：E${Math.round(pick.eastMeters)}m N${Math.round(pick.northMeters)}m（已与航线规划同步）`,
    5000,
  )
}

function downloadPlacesJson(silent = false) {
  const data = getPlacesExportData()
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'places.json'
  a.click()
  URL.revokeObjectURL(url)
  if (!silent) showStatus('places.json 已下载', 3000)
}

async function copyPlacesJson() {
  const text = JSON.stringify(getPlacesExportData(), null, 2)
  try {
    await navigator.clipboard.writeText(text)
    showStatus('places.json 已复制到剪贴板', 3000)
  } catch {
    showStatus('复制失败，请使用下载按钮', 4000)
  }
}

async function savePlacesToServer() {
  placesSaving.value = true
  const places = getPlacesExportData()
  const invalid = validatePlacesPayload(places)
  if (invalid) {
    placesSaving.value = false
    showStatus(invalid, 6000)
    return
  }
  const payload = { places }

  try {
    let res = await fetch(`${API_BASE}/places`, {
      method: 'PUT',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
      body: JSON.stringify(payload),
    })

    if (res.status === 404) {
      res = await fetch(`${API_BASE}/places/save`, {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
        body: JSON.stringify(payload),
      })
    }

    let data = null
    const text = await res.text()
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      throw new Error(
        res.status === 404
          ? 'API 未支持保存，请重启 pg-server（node index.js）后重试'
          : `服务器返回异常（${res.status}）`,
      )
    }

    if (!res.ok) throw new Error(data?.error || data?.detail || `保存失败 ${res.status}`)

    clearPlacesDraft()
    downloadPlacesJson(true)
    await loadCampusPlaces()
    await alignPlacesToModel()
    showStatus(`已保存 ${data.count} 栋建筑到 places.json，并已下载备份`, 6000)
  } catch (e) {
    console.error('保存 places.json 失败', e)
    showStatus(`${e.message}。可先点「下载 JSON」手动替换文件`, 8000)
  } finally {
    placesSaving.value = false
  }
}

function agentWorkflowLabel(status) {
  const labels = {
    ready_for_algorithm: '可进入路径规划',
    needs_clarification: '需要补充信息',
    needs_location_confirmation: '需要确认地点',
    needs_manual_review: '需要人工审核',
  }
  return labels[status] || '处理中'
}

function buildAgentRawRequest() {
  const category = agentCategoryOptions.find((item) => item.value === agentForm.itemCategory)?.label || '物资'
  const requirements = agentForm.specialRequirements.length
    ? `，要求${agentForm.specialRequirements.map((value) => agentRequirementOptions.find((item) => item.value === value)?.label).filter(Boolean).join('、')}`
    : ''
  return `请于${agentForm.deadline}前，将${agentForm.weightKg}公斤${category}从${agentForm.origin}送到${agentForm.destination}${requirements}`
}

async function submitAgentTask() {
  if (!agentFormComplete.value || agentSubmitting.value) return

  agentSubmitting.value = true
  agentResult.value = null

  const task = {
    raw_request: buildAgentRawRequest(),
    origin_text: agentForm.origin,
    destination_text: agentForm.destination,
    item_category: agentForm.itemCategory,
    weight_kg: Number(agentForm.weightKg),
    deadline: agentForm.deadline,
    priority: agentForm.priority,
    special_requirements: agentForm.specialRequirements,
  }

  try {
    const res = await fetch(`${API_BASE}/agent/process-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `任务处理失败 ${res.status}`)

    agentResult.value = data
    showStatus(data.can_submit_to_algorithm ? 'Agent预审通过，可进入路径规划' : 'Agent已生成下一步处理建议', 5000)
  } catch (e) {
    console.error('Agent任务处理失败', e)
    showStatus(`Agent任务处理失败：${e.message}`, 6000)
  } finally {
    agentSubmitting.value = false
  }
}

async function applyAgentTaskToRoutePlanner() {
  if (!agentResult.value?.can_submit_to_algorithm) return

  const origin = agentResult.value.location_matches?.origin?.selected_node?.name
  const destination = agentResult.value.location_matches?.destination?.selected_node?.name
  if (!origin || !destination) {
    showStatus('Agent未返回可靠的起终点节点，暂不能规划航线', 5000)
    return
  }

  planStartName.value = origin
  planEndName.value = destination
  await planSmartRoute()
}

async function planSmartRoute() {
  if (!canPlanRoute.value || planning.value) return
  const start = planStartPlace.value
  const end = planEndPlace.value
  if (!start || !end) return

  planning.value = true
  planResult.value = null
  routeEvaluation.value = null

  let searchBBox = computeLocalSearchBbox(start, end)
  if (!searchBBox || searchBBox.xMax <= searchBBox.xMin || searchBBox.yMax <= searchBBox.yMin) {
    showStatus('局部搜索范围无效，请先点「飞到校区」对齐建筑坐标', 6000)
    planning.value = false
    return
  }

  try {
    showPlanSearchBbox(searchBBox)
    showPlanMarkers(start, end)
  } catch (e) {
    console.warn('规划标记绘制失败，继续请求后端', e)
  }

  let routeStart = start
  let routeEnd = end
  if (officialBuildingsLoaded.value) {
    try {
      const [startAccess, endAccess] = await Promise.all([
        demoApi.getBuildingAccessPoints(start.name, 1),
        demoApi.getBuildingAccessPoints(end.name, 1),
      ])
      routeStart = startAccess.departure_nodes?.[0]
      routeEnd = endAccess.receiving_nodes?.[0]
      if (!routeStart || !routeEnd) throw new Error('未找到起点或终点对应的可用L3三级运输节点')
      const startLocation = routeStart.location || routeStart
      const endLocation = routeEnd.location || routeEnd
      searchBBox = computeLocalSearchBbox(startLocation, endLocation)
      showPlanSearchBbox(searchBBox)
      showPlanMarkers(
        { name: `${start.name} · ${routeStart.node_code}`, ...startLocation },
        { name: `${end.name} · ${routeEnd.node_code}`, ...endLocation },
      )
      setOfficialAccessHighlights(routeStart, routeEnd)
    } catch (error) {
      showStatus(`建筑接入点匹配失败：${error.message}`, 7000)
      planning.value = false
      return
    }
  } else {
    clearOfficialAccessHighlights()
  }

  const payload = {
    start: { lng: routeStart.location?.lng ?? routeStart.lng, lat: routeStart.location?.lat ?? routeStart.lat, height: planFlightHeight.value },
    end: { lng: routeEnd.location?.lng ?? routeEnd.lng, lat: routeEnd.location?.lat ?? routeEnd.lat, height: planFlightHeight.value },
    startName: officialBuildingsLoaded.value ? `${start.name} · ${routeStart.node_code}` : start.name,
    endName: officialBuildingsLoaded.value ? `${end.name} · ${routeEnd.node_code}` : end.name,
    searchBBox,
    groundHeight: groundHeight.value,
    minScore: appConfig.routePlan?.minScore,
    gridSize: appConfig.routePlan?.gridSize,
    simplifyToleranceMeters: appConfig.routePlan?.simplifyToleranceMeters,
    useDynamicCost: true,
    costProfile: 'balanced',
    planningAt: new Date().toISOString(),
    accessPoints: officialBuildingsLoaded.value ? {
      departure: { ...routeStart, building_name: start.name },
      receiving: { ...routeEnd, building_name: end.name },
    } : null,
  }

  try {
    const res = await fetch(`${API_BASE}/route-plan`, {
      method: 'POST',
      headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `规划失败 ${res.status}`)

    planResult.value = data
    routeEvaluation.value = data.evaluation || null

    const planned = data.route
    planned.planning_context = {
      ...(planned.planning_context || {}),
      access_points: payload.accessPoints,
      planned_for: payload.planningAt,
    }
    routes.value = routes.value.filter((r) => !r.planned)
    routes.value.unshift(planned)
    selectedRouteId.value = planned.id

    layers.route = true
    layers.drone = true
    await loadSelectedRoute(planned, { isPlanned: true, skipCameraFly: true })
    await loadDynamicRouteGrids(planned)

    showStatus(`智能航线已生成：${planned.name}（${data.algorithm}）`, 5000)
  } catch (e) {
    console.error('航线规划失败', e)
    showStatus(`航线规划失败：${e.message}`, 6000)
  } finally {
    planning.value = false
  }
}

async function fetchDemoApi(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `${url} ${res.status}`)
  }
  return data
}

function adminStatusClass(status) {
  if (status === 'PENDING_APPROVAL') return 'status-pending'
  if (status === 'APPROVED') return 'status-approved'
  if (status === 'IN_FLIGHT') return 'status-flying'
  if (status === 'EXCEPTION') return 'status-exception'
  if (status === 'COMPLETED') return 'status-completed'
  return 'status-default'
}

async function loadAdminTaskDetail(id) {
  if (!id) return
  const data = await fetchDemoApi(`${API_BASE}/admin/demo/tasks/${id}`)
  adminTaskDetail.value = data.task
  adminTaskEvents.value = data.events || []
  const index = adminTasks.value.findIndex((task) => task.id === id)
  if (index >= 0) adminTasks.value.splice(index, 1, data.task)
}

async function loadAdminTasks(showToast = false) {
  if (adminLoading.value) return
  adminLoading.value = true
  try {
    const params = new URLSearchParams({ limit: '50' })
    if (adminStatusFilter.value) params.set('status', adminStatusFilter.value)
    const data = await fetchDemoApi(`${API_BASE}/admin/demo/tasks?${params}`)
    adminTasks.value = data.tasks || []
    if (!adminTasks.value.some((task) => task.id === selectedAdminTaskId.value)) {
      selectedAdminTaskId.value = adminTasks.value[0]?.id || ''
      adminTaskDetail.value = null
      adminTaskEvents.value = []
    }
    if (selectedAdminTaskId.value) await loadAdminTaskDetail(selectedAdminTaskId.value)
    if (showToast) showStatus(`已同步 ${adminTasks.value.length} 条演示任务`)
  } catch (error) {
    console.warn('校方任务加载失败', error)
    if (showToast) showStatus('任务中心加载失败，请确认 pg-server 已启动', 5000)
  } finally {
    adminLoading.value = false
  }
}

async function selectAdminTask(id) {
  if (!id) return
  selectedAdminTaskId.value = id
  try {
    await loadAdminTaskDetail(id)
  } catch (error) {
    showStatus(`读取任务详情失败：${error.message}`, 5000)
  }
}

async function showSelectedAdminTaskRoute() {
  const task = selectedAdminTask.value
  const sourceRoute = task?.route_result?.route
  if (!task || !sourceRoute?.points?.length) {
    showStatus('该任务尚未生成可展示的校园推荐通道', 4000)
    return
  }
  const route = {
    ...sourceRoute,
    id: `demo-task-${task.id}`,
    name: `${task.request_no} · 校园推荐通道`,
    description: `${task.origin_text} → ${task.destination_text}｜${task.route_result.algorithm || 'A*'} 规划`,
    planned: true,
  }
  const existingIndex = routes.value.findIndex((item) => item.id === route.id)
  if (existingIndex >= 0) routes.value.splice(existingIndex, 1, route)
  else routes.value.unshift(route)
  selectedRouteId.value = route.id
  planResult.value = { ...task.route_result, route }
  layers.route = true
  const animationMode = task.status === 'IN_FLIGHT'
    ? 'play'
    : ['ARRIVED', 'PICKED_UP', 'COMPLETED'].includes(task.status)
      ? 'arrived'
      : 'idle'
  await loadSelectedRoute(route, { isPlanned: true, skipCameraFly: true, animationMode })
  showStatus('已在三维地图中加载该任务的校园推荐通道')
}

async function runAdminTaskAction(action) {
  const task = selectedAdminTask.value
  if (!task || adminActionLoading.value) return
  const endpoints = {
    approve: 'approve',
    reject: 'reject',
    dispatch: 'dispatch',
    advance: 'advance',
    exception: 'exception',
  }
  const endpoint = endpoints[action]
  if (!endpoint) return

  adminActionLoading.value = action
  try {
    const body = action === 'approve'
      ? { comment: '校方演示审批：校园空间适配通过，允许进入企业运力匹配。' }
      : action === 'reject'
        ? { comment: '校方演示驳回：请补充校园运输条件后重新提交。' }
        : action === 'exception'
          ? { reason: '沙箱模拟：天气窗口变化，航班暂缓执行。' }
          : {}
    const data = await fetchDemoApi(`${API_BASE}/admin/demo/tasks/${task.id}/${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    adminTaskDetail.value = data.task
    if (action === 'approve' && data.task?.route_result) await showSelectedAdminTaskRoute()
    if (action === 'advance' && data.task?.route_result) await showSelectedAdminTaskRoute()
    await loadAdminTasks()
    const labels = { approve: '已批准并生成推荐通道', reject: '任务已驳回', dispatch: '企业沙箱已接单', advance: '任务已推进至下一阶段', exception: '已写入沙箱异常分支' }
    showStatus(labels[action])
  } catch (error) {
    showStatus(`操作失败：${error.message}`, 5000)
  } finally {
    adminActionLoading.value = ''
  }
}

function showStatus(msg, ms = 3000) {
  statusMessage.value = msg
  if (ms > 0) setTimeout(() => { statusMessage.value = '' }, ms)
}

function returnToRolePortal() {
  window.location.assign('/?portal=1')
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

async function assetExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return false
    const contentType = res.headers.get('content-type') || ''
    return !contentType.includes('text/html')
  } catch {
    return false
  }
}

async function jsonAssetExists(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return false
    const contentType = res.headers.get('content-type') || ''
    if (contentType.includes('text/html')) return false
    await res.clone().json()
    return true
  } catch {
    return false
  }
}

function createCesiumTerrainProvider(url) {
  if (typeof Cesium.CesiumTerrainProvider.fromUrl === 'function') {
    return Cesium.CesiumTerrainProvider.fromUrl(url)
  }
  return new Cesium.CesiumTerrainProvider({ url })
}

function createCesium3DTileset(url, options = {}) {
  if (typeof Cesium.Cesium3DTileset.fromUrl === 'function') {
    return Cesium.Cesium3DTileset.fromUrl(url, options)
  }
  return new Cesium.Cesium3DTileset({ url, ...options })
}

function setupGridPickHandler() {
  if (!viewer || gridPickHandler) return
  gridPickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  gridPickHandler.setInputAction((movement) => {
    if (pickModeActive.value || !layers.grid) return
    const picked = viewer.scene.pick(movement.position)
    const key = typeof picked?.id === 'string'
      ? picked.id
      : typeof picked?.primitive?.id === 'string'
        ? picked.primitive.id
        : null
    const cell = key ? renderedGridCells.get(key) : null
    if (cell?.suitability_score != null) gridSelectedCell.value = cell
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function destroyGridPickHandler() {
  if (gridPickHandler && !gridPickHandler.isDestroyed()) gridPickHandler.destroy()
  gridPickHandler = null
}

function removeGridPrimitives(primitives) {
  if (!viewer || viewer.isDestroyed()) return
  for (const prim of primitives) {
    if (prim && !prim.isDestroyed()) viewer.scene.primitives.remove(prim)
  }
}

function clearAllGrids() {
  removeGridPrimitives(gridPrimitives)
  gridPrimitives = []
  renderedGridCells = new Map()
  gridDisplayCount.value = 0
  gridSelectedCell.value = null
}

async function renderBatchInstances(instances, targetPrimitives) {
  if (!instances.length || !viewer) return
  const primitive = new Cesium.Primitive({
    geometryInstances: instances,
    appearance: new Cesium.PerInstanceColorAppearance({
      closed: true,
      translucent: true,
      flat: true,
      renderState: {
        depthTest: { enabled: false },
      },
    }),
    show: layers.grid,
    asynchronous: true,
    releaseGeometryInstances: true,
  })
  viewer.scene.primitives.add(primitive)
  targetPrimitives.push(primitive)
}

function getFlightLayerZRange() {
  const fh = appConfig.grid?.flightHeight ?? planFlightHeight.value ?? 80
  const tol = appConfig.grid?.layerTolerance ?? 20
  const zTarget = fh - groundHeight.value
  return {
    zMin: Math.max(gridZMin.value, zTarget - tol),
    zMax: Math.min(gridZMax.value, zTarget + tol),
  }
}

function syncCampusModelTransparency() {
  if (!fallbackModelEntity?.model) return
  fallbackModelEntity.model.color = layers.heatmap
    ? Cesium.Color.WHITE.withAlpha(0.22)
    : Cesium.Color.WHITE
}

function filterGridByFlightLayer(gridDataList) {
  if (appConfig.grid?.flightLayerOnly === false) return gridDataList
  const fh = appConfig.grid?.flightHeight ?? planFlightHeight.value ?? 80
  const tol = appConfig.grid?.layerTolerance ?? 20
  const zTarget = fh - groundHeight.value
  const filtered = gridDataList.filter((g) => {
    const z1 = parseFloat(g.z_min)
    const z2 = parseFloat(g.z_max)
    if (Number.isNaN(z1) || Number.isNaN(z2)) return false
    const zMid = (z1 + z2) / 2
    return Math.abs(zMid - zTarget) <= tol
  })
  return filtered.length ? filtered : gridDataList
}

function scoreToColor(score) {
  const alpha = gridAlpha.value
  if (score < 0.2) return Cesium.Color.fromBytes(190, 20, 20, 255 * alpha)
  if (score < 0.4) return Cesium.Color.fromBytes(255, 110, 20, 255 * alpha)
  if (score < 0.6) return Cesium.Color.fromBytes(250, 230, 80, 255 * alpha)
  if (score < 0.8) return Cesium.Color.fromBytes(70, 190, 210, 255 * alpha)
  return Cesium.Color.fromBytes(20, 130, 220, 255 * alpha)
}

function gridScore(grid) {
  const value = grid.suitability_score ?? grid.static_suitability_score
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Cesium.Math.clamp(parsed, 0, 1) : 0
}

function convertToInstances(gridDataList, targetCellMap = renderedGridCells) {
  const instances = []
  const minBoxHeight = appConfig.grid?.minBoxHeight ?? 8

  for (const g of gridDataList) {
    let x1 = parseFloat(g.x_min)
    let y1 = parseFloat(g.y_min)
    let x2 = parseFloat(g.x_max)
    let y2 = parseFloat(g.y_max)
    let z1 = parseFloat(g.z_min)
    let z2 = parseFloat(g.z_max)
    const score = gridScore(g)

    if ([x1, y1, x2, y2, z1, z2].some((v) => Number.isNaN(v))) continue
    if (x1 === x2) x2 += 0.0001
    if (y1 === y2) y2 += 0.0001
    if (z1 === z2) z2 += 0.1

    const minLng = Math.min(x1, x2)
    const maxLng = Math.max(x1, x2)
    const minLat = Math.min(y1, y2)
    const maxLat = Math.max(y1, y2)
    const minHeight = groundHeight.value + Math.min(z1, z2)
    const maxHeight = groundHeight.value + Math.max(z1, z2)
    const centerLng = (minLng + maxLng) / 2
    const centerLat = (minLat + maxLat) / 2
    let centerHeight = (minHeight + maxHeight) / 2

    // 局部校园范围内使用经纬度近似换算，可避免每个格网额外创建四个 Cartesian3。
    const metersPerDegreeLat = 111320
    const metersPerDegreeLng = metersPerDegreeLat * Math.cos(Cesium.Math.toRadians(centerLat))
    const dimX = Math.max((maxLng - minLng) * metersPerDegreeLng, 0.01)
    const dimY = Math.max((maxLat - minLat) * metersPerDegreeLat, 0.01)
    let dimZ = Math.max(maxHeight - minHeight, minBoxHeight)
    if (maxHeight - minHeight < minBoxHeight) {
      centerHeight = minHeight + dimZ / 2
    }
    const modelMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
      Cesium.Cartesian3.fromDegrees(centerLng, centerLat, centerHeight)
    )
    const cacheKey = `${dimX.toFixed(4)}_${dimY.toFixed(4)}_${dimZ.toFixed(4)}`
    let boxGeometry = geometryCache.get(cacheKey)
    if (!boxGeometry) {
      boxGeometry = Cesium.BoxGeometry.fromDimensions({
        dimensions: new Cesium.Cartesian3(dimX, dimY, dimZ),
      })
      geometryCache.set(cacheKey, boxGeometry)
    }

    const instanceId = `grid-cell:${g.grid_code || g.new_id || `${centerLng.toFixed(7)}:${centerLat.toFixed(7)}`}`
    targetCellMap.set(instanceId, g)
    instances.push(new Cesium.GeometryInstance({
      id: instanceId,
      geometry: boxGeometry,
      modelMatrix,
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(scoreToColor(score)) },
    }))
  }
  return instances
}

function getCampusBbox(pad = 0.004) {
  if (campusPlaces.value.length) {
    const lngs = campusPlaces.value.map((p) => p.lng)
    const lats = campusPlaces.value.map((p) => p.lat)
    return {
      xMin: Math.min(...lngs) - pad,
      xMax: Math.max(...lngs) + pad,
      yMin: Math.min(...lats) - pad,
      yMax: Math.max(...lats) + pad,
    }
  }
  const c = appConfig.campusCenter || { lng: 118.9545, lat: 32.111 }
  return {
    xMin: c.lng - 0.008,
    xMax: c.lng + 0.008,
    yMin: c.lat - 0.008,
    yMax: c.lat + 0.008,
  }
}

function intersectBboxes(a, b) {
  const bbox = {
    xMin: Math.max(a.xMin, b.xMin),
    xMax: Math.min(a.xMax, b.xMax),
    yMin: Math.max(a.yMin, b.yMin),
    yMax: Math.min(a.yMax, b.yMax),
  }
  return bbox.xMin <= bbox.xMax && bbox.yMin <= bbox.yMax ? bbox : null
}

function clampBboxToCampus(bbox, pad = 0.004) {
  return intersectBboxes(bbox, getCampusBbox(pad))
}

function getGridScoreFilter() {
  if (gridScorePreset.value === 'risk') return { scoreMax: '0.4' }
  if (gridScorePreset.value === 'caution') return { scoreMax: '0.6' }
  if (gridScorePreset.value === 'suitable') return { scoreMin: '0.6' }
  return {}
}

function filterGridsByScore(gridDataList) {
  const filter = getGridScoreFilter()
  const minimum = filter.scoreMin == null ? null : Number(filter.scoreMin)
  const maximum = filter.scoreMax == null ? null : Number(filter.scoreMax)
  return gridDataList.filter((cell) => {
    const score = gridScore(cell)
    return (minimum == null || score >= minimum) && (maximum == null || score < maximum)
  })
}

function formatGridScore(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—'
}

function formatGridTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function periodicSourceLabel(value) {
  return ({
    population: '人口热度', static_population: '静态人口', class_periods: '上课时段',
    access_control: '场馆开放', consumption: '食堂营业',
  })[value] || value
}

function formatPeriodicSources(cell) {
  const sources = cell?.layer_data_status?.periodic_sources || []
  return sources.length ? `已匹配（${sources.map(periodicSourceLabel).join('、')}）` : '暂无匹配'
}

function formatPeriodicMatches(cell) {
  const context = cell?.active_context || {}
  const parts = []
  if (context.class_periods?.length) parts.push(`第${context.class_periods.join('、')}节课`)
  if (context.consumption?.length) parts.push(context.consumption.join('、'))
  if (context.access_control?.length) {
    const state = cell?.layer_data_status?.access_control === 'closed' ? '关闭' : '开放'
    parts.push(`${context.access_control.join('、')}（${state}）`)
  }
  return parts.join('；')
}

function formatWeatherStatus(cell) {
  const weather = cell?.freshness?.weather || {}
  if (weather.status === 'configured_default') {
    const inputs = cell?.inputs || {}
    return `默认参数（风速 ${inputs.wind_speed ?? 3}m/s，降雨 ${inputs.precipitation ?? 0}mm/h，能见度 ${inputs.visibility ?? 5000}m）`
  }
  if (weather.status === 'realtime') {
    return weather.age_minutes == null ? '已匹配' : `已匹配（${Number(weather.age_minutes).toFixed(1)}分钟前）`
  }
  if (weather.status === 'stale') {
    return weather.age_minutes == null
      ? '已过期'
      : `已过期（${Number(weather.age_minutes).toFixed(1)}分钟前，限${Number(weather.max_age_minutes || 30).toFixed(0)}分钟）`
  }
  return '暂无记录'
}

function riskFactorLabel(value) {
  return ({
    static_environment: '静态环境', population_density: '人流密度', weather: '天气',
    construction: '施工', event: '临时事件', data_coverage_gap: '数据缺口',
    energy: '能源', no_fly_zone: '禁飞区', class_period: '上课时段',
    consumption_peak: '食堂营业高峰', access_closed: '场馆关闭',
    weather_default_configured: '默认天气参数',
    weather_data_stale: '天气数据过期', weather_data_missing: '天气数据缺失',
  })[value] || value
}

function hardConstraintLabel(value) {
  return ({
    active_no_fly_zone: '活动禁飞区', static_suitability_below_minimum: '静态适航分过低',
    wind_speed_exceeds_limit: '风速超限', precipitation_exceeds_limit: '降水超限',
    visibility_below_minimum: '能见度过低', construction_blocked: '施工阻断', manually_blocked: '人工阻断',
    periodic_access_closed: '场馆关闭时段不可达',
  })[value] || value
}

async function replaceRenderedGrids(data, metadata, controller, requestVersion) {
  const nextPrimitives = []
  const nextCellMap = new Map()
  const BATCH = 2000
  for (let i = 0; i < data.length; i += BATCH) {
    if (controller.signal.aborted || requestVersion !== gridRequestVersion) {
      removeGridPrimitives(nextPrimitives)
      return false
    }
    const batch = data.slice(i, i + BATCH)
    await renderBatchInstances(convertToInstances(batch, nextCellMap), nextPrimitives)
    loadingProgress.value = (i + batch.length) / Math.max(data.length, 1)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  if (controller.signal.aborted || requestVersion !== gridRequestVersion) {
    removeGridPrimitives(nextPrimitives)
    return false
  }
  const previousPrimitives = gridPrimitives
  gridPrimitives = nextPrimitives
  renderedGridCells = nextCellMap
  removeGridPrimitives(previousPrimitives)
  gridSelectedCell.value = null
  gridDisplayCount.value = data.length
  gridLod.value = metadata.lod || 1
  gridQueryMs.value = metadata.queryMs ?? null
  return true
}

function dynamicGridAutoRefreshEligible() {
  return Boolean(
    gridAutoRefreshEnabled.value
    && activeRole.value === ROLE.SCHOOL
    && gridDisplayMode.value === 'route-dynamic'
    && currentRoute.value?.planned
    && layers.grid
    && viewer
    && !viewer.isDestroyed()
  )
}

function stopDynamicGridAutoRefresh() {
  clearTimeout(gridAutoRefreshTimer)
  gridAutoRefreshTimer = null
  gridAutoRefreshNextAt.value = ''
}

function scheduleDynamicGridAutoRefresh(delayMs = gridAutoRefreshSeconds.value * 1000) {
  stopDynamicGridAutoRefresh()
  if (!dynamicGridAutoRefreshEligible() || document.hidden) return
  const safeDelay = Math.max(Number(delayMs) || 0, 500)
  gridAutoRefreshNextAt.value = new Date(Date.now() + safeDelay).toISOString()
  gridAutoRefreshTimer = setTimeout(runDynamicGridAutoRefresh, safeDelay)
}

async function runDynamicGridAutoRefresh() {
  gridAutoRefreshTimer = null
  gridAutoRefreshNextAt.value = ''
  if (!dynamicGridAutoRefreshEligible()) return
  if (document.hidden || gridLoading.value) {
    scheduleDynamicGridAutoRefresh()
    return
  }
  await loadDynamicRouteGrids(currentRoute.value, {
    forceCurrentTime: true,
    automatic: true,
    silent: true,
  })
}

function handleDocumentVisibilityChange() {
  if (document.hidden) stopDynamicGridAutoRefresh()
  else if (dynamicGridAutoRefreshEligible()) scheduleDynamicGridAutoRefresh(1000)
}

watch(
  [activeRole, currentRoute, gridDisplayMode, gridAutoRefreshEnabled, () => layers.grid],
  () => scheduleDynamicGridAutoRefresh(),
)

async function loadDynamicRouteGrids(routeOverride = null, options = {}) {
  const route = routeOverride || currentRoute.value
  if (activeRole.value !== ROLE.SCHOOL) return
  if (!viewer || viewer.isDestroyed() || !layers.grid || !route?.points?.length || route.points.length < 2) return

  const requestVersion = ++gridRequestVersion
  gridAbortController?.abort()
  const controller = new AbortController()
  gridAbortController = controller
  gridLoading.value = true
  loadingProgress.value = 0.05
  const startedAt = performance.now()
  try {
    const planningAt = options.at || (options.forceCurrentTime
      ? new Date().toISOString()
      : planResult.value?.dynamicCost?.sampledAt || new Date().toISOString())
    const result = await demoApi.getDynamicCostCorridor({
      route: route.points.map((point) => ({ lng: Number(point.lng), lat: Number(point.lat) })),
      corridor_meters: gridCorridorMeters.value,
      z_target: Number(route.points[0]?.height || planFlightHeight.value || 80) - groundHeight.value,
      cols: 70,
      rows: 70,
      at: planningAt,
      time_zone: 'Asia/Shanghai',
      profile: 'balanced',
      thresholds: {
        minSuitability: appConfig.routePlan?.minScore ?? 0.25,
        weatherFreshnessMinutes: appConfig.grid?.weatherFreshnessMinutes ?? 30,
        useDefaultWeather: appConfig.grid?.defaultWeather?.enabled === false ? 0 : 1,
        defaultWindSpeed: appConfig.grid?.defaultWeather?.windSpeed ?? 3,
        defaultPrecipitation: appConfig.grid?.defaultWeather?.precipitation ?? 0,
        defaultVisibility: appConfig.grid?.defaultWeather?.visibility ?? 5000,
      },
    }, { signal: controller.signal })
    const data = filterGridsByScore(result.data || [])
    const rendered = await replaceRenderedGrids(data, {
      lod: 1,
      queryMs: Math.round(performance.now() - startedAt),
    }, controller, requestVersion)
    if (!rendered) return
    gridDisplayMode.value = 'route-dynamic'
    gridDynamicAt.value = result.at
    gridDynamicSummary.value = result.summary
    gridCorridorMeters.value = result.corridor_meters || gridCorridorMeters.value
    gridDemoMode.value = false
    gridAutoRefreshError.value = ''
    if (!options.silent) {
      showStatus(`已显示航线周围 ${data.length} 个动态 Cost 格网（走廊 ${gridCorridorMeters.value}m）`, 5000)
    }
  } catch (error) {
    if (error.name === 'AbortError') return
    console.error('航线动态格网加载失败', error)
    if (options.automatic) gridAutoRefreshError.value = error.message
    else showStatus(`航线动态格网加载失败：${error.message}`, 6000)
  } finally {
    if (requestVersion === gridRequestVersion) {
      loadingProgress.value = 0
      gridLoading.value = false
      gridAbortController = null
      scheduleDynamicGridAutoRefresh()
    }
  }
}

function reloadCurrentGridDisplay() {
  if (activeRole.value === ROLE.SCHOOL && gridDisplayMode.value === 'route-dynamic' && currentRoute.value?.planned) {
    return loadDynamicRouteGrids(currentRoute.value, { forceCurrentTime: true })
  }
  return reloadGridsInView()
}

function getViewBbox() {
  const rect = viewer.camera.computeViewRectangle()
  if (!rect) return null

  const pad = appConfig.grid?.viewPadding ?? 0.0003
  const viewBbox = {
    xMin: Cesium.Math.toDegrees(rect.west) - pad,
    xMax: Cesium.Math.toDegrees(rect.east) + pad,
    yMin: Cesium.Math.toDegrees(rect.south) - pad,
    yMax: Cesium.Math.toDegrees(rect.north) + pad,
  }
  return gridBounds.value ? intersectBboxes(viewBbox, gridBounds.value) : viewBbox
}

function generateLocalDemoGrids(bbox, zRange, limit = 800) {
  const xSpan = bbox.xMax - bbox.xMin
  const ySpan = bbox.yMax - bbox.yMin
  if (!(xSpan > 0) || !(ySpan > 0) || limit <= 0) return []

  const sideLength = Math.max(1, Math.ceil(Math.sqrt(limit)))
  const stepX = xSpan / sideLength
  const stepY = ySpan / sideLength
  const center = appConfig.campusCenter || { lng: 118.944736, lat: 32.10747 }
  const scoreFilter = getGridScoreFilter()
  const minScore = scoreFilter.scoreMin == null ? null : Number(scoreFilter.scoreMin)
  const maxScore = scoreFilter.scoreMax == null ? null : Number(scoreFilter.scoreMax)
  const rangeMin = Number(zRange.zMin)
  const rangeMax = Number(zRange.zMax)
  const rangeCenter = Number.isFinite(rangeMin) && Number.isFinite(rangeMax)
    ? (rangeMin + rangeMax) / 2
    : 25
  const halfThickness = Math.max(1, Math.min(4, Math.abs(rangeMax - rangeMin) / 2 || 4))
  const data = []

  for (let xIndex = 0; xIndex < sideLength && data.length < limit; xIndex += 1) {
    for (let yIndex = 0; yIndex < sideLength && data.length < limit; yIndex += 1) {
      const xMin = bbox.xMin + xIndex * stepX
      const yMin = bbox.yMin + yIndex * stepY
      const xMax = xMin + stepX
      const yMax = yMin + stepY
      const centerX = xMin + stepX / 2
      const centerY = yMin + stepY / 2
      const distance = Math.hypot(centerX - center.lng, centerY - center.lat)
      const hash = Math.sin((centerX * 12989.8) + (centerY * 78233.1)) * 43758.5453
      const noise = ((hash - Math.floor(hash)) - 0.5) * 0.1
      const score = Cesium.Math.clamp(0.85 - distance * 40 + noise, 0, 1)
      if (minScore != null && score < minScore) continue
      if (maxScore != null && score >= maxScore) continue

      data.push({
        x_min: xMin,
        x_max: xMax,
        y_min: yMin,
        y_max: yMax,
        // Demo cells represent the selected flight layer, not a solid column
        // from the ground to the aircraft. A thin slab keeps the campus model
        // readable while still showing the suitability distribution.
        z_min: Math.max(0, rangeCenter - halfThickness),
        z_max: Math.max(1, rangeCenter + halfThickness),
        static_suitability_score: Number(score.toFixed(3)),
      })
    }
  }

  return data
}

async function reloadGridsInView() {
  if (!viewer || viewer.isDestroyed() || !layers.grid) return
  let bbox = getViewBbox()
  if (!bbox) bbox = getCampusBbox(0.002)

  bbox = clampBboxToCampus(bbox)

  if (!bbox) {
    gridAbortController?.abort()
    clearAllGrids()
    return
  }

  const zRange = appConfig.grid?.flightLayerOnly !== false
    ? getFlightLayerZRange()
    : { zMin: gridZMin.value, zMax: gridZMax.value }

  const requestVersion = ++gridRequestVersion
  gridAbortController?.abort()
  const controller = new AbortController()
  gridAbortController = controller
  gridLoading.value = true
  loadingProgress.value = 0.05

  try {
    let result
    if (dbConnected.value) {
      const params = new URLSearchParams({
        ...bbox,
        zMin: String(zRange.zMin),
        zMax: String(zRange.zMax),
        limit: String(bboxLimit.value),
        lod: 'auto',
        ...getGridScoreFilter(),
      })
      result = await fetchJson(`${API_BASE}/grids/bbox?${params}`, { signal: controller.signal })
      gridDemoMode.value = false
    } else if (legacyToolsEnabled.value && appConfig.grid?.useDemoWhenOffline === true) {
      const demoLimit = Math.min(bboxLimit.value, 800)
      if (!gridDemoMode.value && gridAlpha.value > 0.45) gridAlpha.value = 0.35
      result = {
        data: generateLocalDemoGrids(bbox, zRange, demoLimit),
        lod: 1,
        queryMs: 0,
        source: 'frontend-demo',
      }
      gridDemoMode.value = true
    } else {
      gridDemoMode.value = false
      clearAllGrids()
      showStatus('数据库未连接，无法加载格网')
      return
    }

    const data = filterGridByFlightLayer(result.data || [])
    const rendered = await replaceRenderedGrids(data, result, controller, requestVersion)
    if (!rendered) return
    gridDisplayMode.value = 'viewport-static'
    gridDynamicAt.value = ''
    gridDynamicSummary.value = null

    const mode = gridDemoMode.value ? '（演示）' : ''
    const layerHint = appConfig.grid?.flightLayerOnly !== false ? ' · 飞行高度层' : ''
    const lodText = gridLod.value > 1 ? `，LOD ${gridLod.value} 聚合显示` : ''
    showStatus(`已加载视口内 ${data.length.toLocaleString()} 个格网${layerHint}${mode}${lodText}`)
  } catch (e) {
    if (e.name === 'AbortError') return
    console.error('格网加载失败', e)
    showStatus('格网加载失败，请确认 API 服务已启动')
  } finally {
    if (requestVersion === gridRequestVersion) {
      loadingProgress.value = 0
      gridLoading.value = false
      gridAbortController = null
    }
  }
}

function scheduleGridReload(delay = appConfig.grid?.reloadDebounceMs ?? 350) {
  if (!layers.grid || !appConfig.grid?.loadOnCameraMove) return
  if (activeRole.value === ROLE.SCHOOL && gridDisplayMode.value === 'route-dynamic' && currentRoute.value?.planned) return
  clearTimeout(gridLoadTimer)
  gridLoadTimer = setTimeout(reloadGridsInView, delay)
}

async function checkDatabase(showToast = false) {
  const maxRetry = 3
  for (let i = 0; i < maxRetry; i++) {
    try {
      const health = await fetchJson(`${API_BASE}/health`)
      dbServiceOnline.value = health.ok === true
      if (!dbServiceOnline.value) {
        dbConnected.value = false
        gridTotal.value = 0
        continue
      }

      try {
        const stats = await fetchJson(`${API_BASE}/stats`)
        dbConnected.value = true
        gridTotal.value = stats.total || 0
        gridBounds.value = stats.bounds || null
        if (showToast) {
          showStatus(`数据库已连接 · ${gridTotal.value.toLocaleString()} 条格网`)
          await Promise.all([loadHotspotsIndex(), loadRoutesFromApi()])
        }
        if (layers.grid && viewer && gridDisplayMode.value !== 'route-dynamic') await reloadGridsInView()
        return true
      } catch (statsErr) {
        dbConnected.value = false
        gridTotal.value = 0
        if (showToast) {
          showStatus('PostgreSQL 在线，但格网数据表损坏或未导入，请运行 import-data.ps1', 6000)
        }
        if (layers.grid && viewer && gridDisplayMode.value !== 'route-dynamic') await reloadGridsInView()
        return false
      }
    } catch (e) {
      dbServiceOnline.value = false
      dbConnected.value = false
      gridTotal.value = 0
      if (i < maxRetry - 1) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  if (showToast) {
    showStatus('无法连接 API，请先启动 pg-server（node index.js）', 5000)
  }
  return false
}

function startDbWatch() {
  dbCheckTimer = setInterval(async () => {
    if (!dbConnected.value) await checkDatabase()
  }, 15000)
}

async function loadAppConfig() {
  try {
    const cfg = await fetchJson('./config/app.json')
    Object.assign(appConfig, cfg)
    if (cfg.grid?.alpha != null) gridAlpha.value = cfg.grid.alpha
    if (cfg.grid?.bboxLimit != null) bboxLimit.value = cfg.grid.bboxLimit
    if (cfg.grid?.groundHeight != null) groundHeight.value = cfg.grid.groundHeight
    if (cfg.grid?.zMin != null) gridZMin.value = cfg.grid.zMin
    if (cfg.grid?.zMax != null) gridZMax.value = cfg.grid.zMax
    if (cfg.defaultLayers) {
      Object.assign(layers, cfg.defaultLayers)
    }
    if (cfg.fallbackModel?.enabled === false) {
      layers.fallbackModel = false
    }
  } catch (e) {
    console.warn('配置加载失败，使用默认值', e)
  }
}

async function loadHotspotsIndex() {
  try {
    const list = await fetchJson('./hotspotsdata/index.json')
    if (Array.isArray(list) && list.length) {
      csvFiles.value = list
      selectedFile.value = list[0]
      return true
    }
  } catch (e) {
    console.warn('热力图索引加载失败', e)
  }
  return false
}

async function loadRoutesFromApi() {
  if (!legacyToolsEnabled.value) {
    routes.value = routes.value.filter((route) => route.planned)
    return
  }
  if (appConfig.routePlan?.alignToModel !== false) return
  try {
    const data = await fetchJson(`${API_BASE}/routes`)
    if (data.routes?.length) {
      routes.value = data.routes
      return
    }
  } catch (e) {
    console.warn('航线 API 不可用，使用内置默认航线', e)
  }
  routes.value = [...DEFAULT_ROUTES]
}

function onRouteSelect() {
  if (!selectedRouteId.value) {
    clearFlightEntities()
    clearOfficialAccessHighlights()
    routeEvaluation.value = null
    resetDynamicGridDisplay({ reloadStatic: true })
    return
  }
  const selectedRoute = routes.value.find((route) => route.id === selectedRouteId.value)
  if (!(activeRole.value === ROLE.SCHOOL && selectedRoute?.planned)) {
    resetDynamicGridDisplay({ reloadStatic: true })
  }
  layers.route = true
  layers.drone = true
  loadSelectedRoute().then(() => {
    if (activeRole.value === ROLE.SCHOOL && currentRoute.value?.planned && layers.grid) return loadDynamicRouteGrids(currentRoute.value)
    return undefined
  })
}

function createFallbackImageryProvider() {
  const cfg = appConfig.imagery || {}
  if (cfg.enabled === false) return false
  return new Cesium.UrlTemplateImageryProvider({
    url: cfg.fallbackUrl || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: Number(cfg.maximumLevel) || 19,
    credit: new Cesium.Credit(cfg.credit || 'Tiles © Esri'),
  })
}

async function setupTerrain() {
  if (!appConfig.terrain?.enabled) return
  const url = appConfig.terrain.url || './terrain'
  if (!(await jsonAssetExists(`${url}/layer.json`))) {
    showStatus('本地地形数据不可用')
    layers.terrain = false
    return
  }
  try {
    terrainProvider = await createCesiumTerrainProvider(url)
    viewer.terrainProvider = terrainProvider
    viewer.scene.globe.depthTestAgainstTerrain = true
  } catch (e) {
    console.warn('地形加载失败', e)
    layers.terrain = false
  }
}

async function setupTileset() {
  const cfg = appConfig.tileset3d
  if (!cfg?.enabled) return

  const url = cfg.url || './3dtiles/tileset.json'
  if (!(await jsonAssetExists(url))) {
    showStatus('校园实景模型暂不可用，已切换到校园三维模型')
    layers.tileset = false
    layers.fallbackModel = appConfig.fallbackModel?.enabled !== false
    return
  }

  try {
    tileset3d = await createCesium3DTileset(url, {
      maximumScreenSpaceError: cfg.maximumScreenSpaceError || 16,
    })
    if (tileset3d.readyPromise) await tileset3d.readyPromise
    viewer.scene.primitives.add(tileset3d)
    tileset3d.show = layers.tileset

    const offset = cfg.heightOffset || 0
    if (offset !== 0) {
      const cartographic = Cesium.Cartographic.fromCartesian(tileset3d.boundingSphere.center)
      const surface = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0)
      const offsetPos = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, offset)
      const translation = Cesium.Cartesian3.subtract(offsetPos, surface, new Cesium.Cartesian3())
      tileset3d.modelMatrix = Cesium.Matrix4.fromTranslation(translation)
    }

    await viewer.zoomTo(tileset3d)
    layers.fallbackModel = false
    if (fallbackModelEntity) fallbackModelEntity.show = false
    if (campusBuildingsDs) campusBuildingsDs.show = false
    layers.buildings = false
    showStatus('3D Tiles 仙林校区实景模型加载成功')
  } catch (e) {
    console.error('3D Tiles 加载失败', e)
    layers.tileset = false
    layers.fallbackModel = appConfig.fallbackModel?.enabled !== false
    showStatus('校园实景模型加载失败，已切换到校园三维模型')
  }
}

async function setupCampusBuildings() {
  if (layers.fallbackModel) return
  const cfg = appConfig.campusBuildings
  if (!cfg?.enabled) return

  const url = cfg.url || './data/campus-buildings.geojson'
  if (!(await assetExists(url))) {
    showStatus('校园建筑 GeoJSON 未找到')
    return
  }

  try {
    campusBuildingsDs = await Cesium.GeoJsonDataSource.load(url, { clampToGround: true })
    await viewer.dataSources.add(campusBuildingsDs)
    campusBuildingsDs.show = layers.buildings

    for (const entity of campusBuildingsDs.entities.values) {
      const h = entity.properties?.height?.getValue() || 20
      const color = entity.properties?.color?.getValue() || '#8ea4c0'
      const name = entity.properties?.name?.getValue() || ''
      if (!entity.polygon) continue
      entity.polygon.material = Cesium.Color.fromCssColorString(color).withAlpha(0.88)
      entity.polygon.outline = true
      entity.polygon.outlineColor = Cesium.Color.WHITE.withAlpha(0.85)
      entity.polygon.outlineWidth = 2
      entity.polygon.height = 0
      entity.polygon.extrudedHeight = h
      entity.polygon.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND
      entity.polygon.extrudedHeightReference = Cesium.HeightReference.RELATIVE_TO_GROUND
      if (name) entity.name = name
    }
    showStatus('校园建筑已加载')
  } catch (e) {
    console.warn('校园建筑加载失败', e)
    showStatus('校园建筑加载失败')
  }
}

async function setupFallbackModel() {
  const cfg = appConfig.fallbackModel
  if (!cfg || cfg.enabled === false || !layers.fallbackModel) return

  const pos = cfg.position || { lng: 118.944736, lat: 32.107470, height: 0 }
  const modelUrl = cfg.url || './Models/campus-model2.glb'

  if (await assetExists(modelUrl)) {
    fallbackModelEntity = viewer.entities.add({
      name: 'CampusModel',
      position: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, pos.height),
      model: { uri: modelUrl, scale: cfg.scale || 100, color: Cesium.Color.WHITE },
      show: layers.fallbackModel,
    })
    showStatus('校园三维模型已加载')
  } else {
    fallbackModelEntity = viewer.entities.add({
      name: 'CampusPlaceholder',
      position: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, pos.height + 30),
      box: {
        dimensions: new Cesium.Cartesian3(800, 800, 60),
        material: Cesium.Color.fromBytes(180, 200, 220, 120),
        outline: true,
        outlineColor: Cesium.Color.WHITE,
      },
      label: {
        text: '校园三维模型暂不可用',
        font: '14px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -50),
        fillColor: Cesium.Color.YELLOW,
        showBackground: true,
        backgroundColor: Cesium.Color.fromBytes(0, 0, 0, 180),
      },
      show: layers.fallbackModel,
    })
  }
}

function buildFlightPathFromRoute(route) {
  const points = route.points
  if (points.length < 2) return { positions: [], totalLength: 0 }

  const positions = []
  let totalLength = 0

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const start = Cesium.Cartesian3.fromDegrees(a.lng, a.lat, a.height)
    const end = Cesium.Cartesian3.fromDegrees(b.lng, b.lat, b.height)
    const segLen = Cesium.Cartesian3.distance(start, end)
    totalLength += segLen
    const steps = Math.max(10, Math.ceil(segLen / 12))

    for (let s = 0; s < steps; s++) {
      const t = s / steps
      positions.push(
        Cesium.Cartesian3.fromDegrees(
          a.lng + (b.lng - a.lng) * t,
          a.lat + (b.lat - a.lat) * t,
          a.height + (b.height - a.height) * t,
        ),
      )
    }
  }

  const last = points[points.length - 1]
  positions.push(Cesium.Cartesian3.fromDegrees(last.lng, last.lat, last.height))
  return { positions, totalLength }
}

function createLevelFlightOrientation(positionProperty, headingOffset = 0) {
  const scratchNext = new Cesium.JulianDate()
  return new Cesium.CallbackProperty((time, result) => {
    const pos = positionProperty.getValue(time)
    if (!pos) {
      return Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY, result)
    }

    const nextTime = Cesium.JulianDate.addSeconds(time, 0.3, scratchNext)
    const nextPos = positionProperty.getValue(nextTime)

    let heading = headingOffset
    if (nextPos) {
      const transform = Cesium.Transforms.eastNorthUpToFixedFrame(pos)
      const invTransform = Cesium.Matrix4.inverse(transform, new Cesium.Matrix4())
      const delta = Cesium.Cartesian3.subtract(nextPos, pos, new Cesium.Cartesian3())
      const local = Cesium.Matrix4.multiplyByPointAsVector(invTransform, delta, new Cesium.Cartesian3())
      const horizontal = Math.sqrt(local.x * local.x + local.y * local.y)
      if (horizontal > 0.05) {
        heading = Math.atan2(local.x, local.y) + headingOffset
      }
    }

    return Cesium.Transforms.headingPitchRollQuaternion(
      pos,
      new Cesium.HeadingPitchRoll(heading, 0, 0),
      Cesium.Ellipsoid.WGS84,
      Cesium.Transforms.eastNorthUpToFixedFrame,
      result,
    )
  }, false)
}

function clearFlightEntities() {
  clearRouteWaypoints()
  clearPlanPreviewLine()
  clearReplanOriginalRoute()
  if (routePolylineEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(routePolylineEntity)
  }
  routePolylineEntity = null
  if (droneEntity && viewer && !viewer.isDestroyed()) {
    viewer.entities.remove(droneEntity)
  }
  droneEntity = null
}

async function loadSelectedRoute(routeOverride = null, options = {}) {
  const route = routeOverride || currentRoute.value
  if (!route || !viewer) return
  clearFlightEntities()
  applyRouteAccessHighlights(route)

  const pathData = buildFlightPathFromRoute(route)
  if (pathData.positions.length < 2) return

  const isPlanned = options.isPlanned || route.planned
  const lineColor = isPlanned ? Cesium.Color.CYAN : Cesium.Color.YELLOW
  const polylinePositions = isPlanned
    ? route.points.map((p) => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.height))
    : pathData.positions

  routePolylineEntity = viewer.entities.add({
    name: route.name,
    show: layers.route,
    polyline: {
      positions: polylinePositions,
      width: isPlanned ? 5 : 4,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.3,
        color: lineColor,
      }),
    },
  })

  if (isPlanned) showRouteWaypoints(route)

  const start = route.points[0]
  const droneCfg = appConfig.droneModel || {}
  const droneUrl = droneCfg.url || './Models/parrot_camo_drone.glb'
  const headingOffset = Cesium.Math.toRadians(droneCfg.headingOffset || 0)
  const hasDroneModel = await assetExists(droneUrl)

  if (hasDroneModel) {
    droneEntity = viewer.entities.add({
      name: '无人机',
      show: layers.drone,
      model: {
        uri: droneUrl,
        minimumPixelSize: droneCfg.minimumPixelSize ?? 32,
        scale: droneCfg.scale ?? 2,
        maximumScale: droneCfg.maximumScale ?? 120,
      },
    })
  } else {
    droneEntity = viewer.entities.add({
      name: '无人机',
      show: layers.drone,
      position: Cesium.Cartesian3.fromDegrees(start.lng, start.lat, start.height),
      ellipsoid: {
        radii: new Cesium.Cartesian3(8, 8, 4),
        material: Cesium.Color.ORANGE,
        outline: true,
        outlineColor: Cesium.Color.WHITE,
      },
      label: {
        text: 'UAV',
        font: '12px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -20),
        fillColor: Cesium.Color.WHITE,
      },
    })
  }

  const animationMode = options.animationMode || 'play'
  if (animationMode === 'play') {
    startFlightAnimation(route, pathData, headingOffset)
  } else {
    setDroneStaticPosition(route, headingOffset, animationMode === 'arrived')
  }
  const lenKm = (pathData.totalLength / 1000).toFixed(2)
  const tag = isPlanned ? '智能规划' : '已加载'
  const animationText = animationMode === 'play'
    ? '动画播放中'
    : animationMode === 'arrived'
      ? '已到达终点接驳点'
      : '等待企业沙箱起飞'
  showStatus(`${tag}航线：${route.name}（约 ${lenKm} km），${animationText}`)

  if (!options.skipEvaluation) {
    if (route.planned && routeEvaluation.value) {
      // 规划接口已返回评估结果
    } else {
      evaluateCurrentRoute(route)
    }
  }

  if (!options.skipCameraFly) {
    const sphere = Cesium.BoundingSphere.fromPoints(pathData.positions)
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(25),
        Cesium.Math.toRadians(-32),
        Math.max(pathData.totalLength * 1.5, 700),
      ),
    })
  }
}

function setDroneStaticPosition(route, headingOffset = 0, atEnd = false) {
  if (!droneEntity || !route?.points?.length || !viewer) return
  const point = atEnd ? route.points[route.points.length - 1] : route.points[0]
  const position = Cesium.Cartesian3.fromDegrees(point.lng, point.lat, point.height)
  droneEntity.position = position
  droneEntity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
    position,
    new Cesium.HeadingPitchRoll(headingOffset, 0, 0),
  )
  viewer.clock.shouldAnimate = false
}

async function evaluateCurrentRoute(routeOverride = null) {
  const route = routeOverride || currentRoute.value
  if (!route?.points?.length) return

  evaluating.value = true
  if (!route.planned) routeEvaluation.value = null

  try {
    if (route.planned) {
      const res = await fetch(`${API_BASE}/routes/evaluate`, {
        method: 'POST',
        headers: authenticatedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          points: route.points,
          groundHeight: groundHeight.value,
        }),
      })
      routeEvaluation.value = await res.json()
      if (!res.ok) throw new Error(routeEvaluation.value.error || '评估失败')
      return
    }

    const params = new URLSearchParams({ groundHeight: String(groundHeight.value) })
    routeEvaluation.value = await fetchJson(
      `${API_BASE}/routes/${route.id}/evaluate?${params}`
    )
  } catch (e) {
    console.warn('航线评估失败', e)
    if (!dbConnected.value) {
      showStatus('航线评估需要 PostgreSQL 数据库连接')
    }
  } finally {
    evaluating.value = false
  }
}

function startFlightAnimation(route, pathData, headingOffset = 0) {
  const { positions, totalLength } = pathData
  if (positions.length < 2 || totalLength <= 0) return

  const duration = route.duration || 30
  const startTime = Cesium.JulianDate.now()
  const stopTime = Cesium.JulianDate.addSeconds(startTime, duration, new Cesium.JulianDate())
  const positionProperty = new Cesium.SampledPositionProperty()
  positionProperty.setInterpolationOptions({
    interpolationDegree: 1,
    interpolationAlgorithm: Cesium.LinearApproximation,
  })

  positionProperty.addSample(startTime, positions[0])
  let accumulated = 0
  for (let i = 1; i < positions.length; i++) {
    accumulated += Cesium.Cartesian3.distance(positions[i - 1], positions[i])
    const t = accumulated / totalLength
    const time = Cesium.JulianDate.addSeconds(startTime, t * duration, new Cesium.JulianDate())
    positionProperty.addSample(time, positions[i])
  }

  droneEntity.position = positionProperty
  droneEntity.orientation = createLevelFlightOrientation(positionProperty, headingOffset)

  const clock = viewer.clock
  clock.startTime = startTime.clone()
  clock.stopTime = stopTime.clone()
  clock.currentTime = startTime.clone()
  clock.clockRange = Cesium.ClockRange.LOOP_STOP
  clock.multiplier = 1
  clock.shouldAnimate = true
  viewer.timeline.zoomTo(startTime, stopTime)
}

function replayFlight() {
  if (!viewer || !currentRoute.value) return
  if (droneEntity && viewer.clock.startTime) {
    viewer.clock.currentTime = viewer.clock.startTime.clone()
    viewer.clock.shouldAnimate = true
    showStatus(`重播航线：${currentRoute.value.name}`)
    return
  }
  loadSelectedRoute()
}

async function flyToCampus() {
  if (!viewer || viewer.isDestroyed()) {
    showStatus('地图尚未加载，请刷新页面（Ctrl+Shift+R）', 5000)
    return
  }

  try {
    viewer.camera.cancelFlight()
  } catch {
    // ignore
  }

  showStatus('正在飞到仙林校区...')

  const flyOffset = new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(25),
    Cesium.Math.toRadians(-35),
    1100,
  )

  const afterFly = async () => {
    showStatus('已定位到仙林校区')
    if (layers.fallbackModel && placeLayoutRaw.length) {
      await alignPlacesToModel()
    }
    if (layers.grid) scheduleGridReload()
  }

  try {
    if (fallbackModelEntity) {
      await viewer.flyTo(fallbackModelEntity, { duration: 2, offset: flyOffset })
      await afterFly()
      return
    }
  } catch (e) {
    console.warn('flyTo model failed', e)
  }

  const pos = appConfig.fallbackModel?.position
    || appConfig.campusCenter
    || { lng: 118.944736, lat: 32.107470 }
  const sphere = new Cesium.BoundingSphere(
    Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 50),
    900,
  )
  try {
    await viewer.camera.flyToBoundingSphere(sphere, { duration: 2, offset: flyOffset })
    await afterFly()
  } catch (e) {
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 480),
      orientation: {
        heading: Cesium.Math.toRadians(25),
        pitch: Cesium.Math.toRadians(-35),
        roll: 0,
      },
    })
    await afterFly()
  }
}

function toggleTerrain() {
  if (terrainProvider) {
    viewer.terrainProvider = layers.terrain
      ? terrainProvider
      : new Cesium.EllipsoidTerrainProvider()
  }
}

function toggleTileset() {
  if (tileset3d) tileset3d.show = layers.tileset
}

async function toggleFallbackModel() {
  if (layers.fallbackModel && !fallbackModelEntity) {
    await setupFallbackModel()
    return
  }
  if (fallbackModelEntity) fallbackModelEntity.show = layers.fallbackModel
}

async function toggleBuildings() {
  if (layers.buildings && layers.fallbackModel) {
    layers.buildings = false
    showStatus('校园三维模型已启用，维护图层无需重复显示', 4000)
    return
  }
  if (layers.buildings && !campusBuildingsDs) {
    await setupCampusBuildings()
  }
  if (campusBuildingsDs) campusBuildingsDs.show = layers.buildings
}

async function toggleOfficialBuildings() {
  if (layers.officialBuildings && !officialBuildingsDs) await renderOfficialMapFeatures()
  if (officialBuildingsDs) officialBuildingsDs.show = layers.officialBuildings
}

async function toggleFixedNodes() {
  if (layers.fixedNodes && !officialFixedNodesDs) await renderOfficialMapFeatures()
  if (officialFixedNodesDs) officialFixedNodesDs.show = layers.fixedNodes
}

async function toggleHeatmap() {
  if (layers.heatmap) {
    if (!selectedFile.value) {
      if (csvFiles.value.length) selectedFile.value = csvFiles.value[0]
      else {
        showStatus('热力图数据未就绪，请刷新页面', 4000)
        layers.heatmap = false
        return
      }
    }
    if (!heatmapLayer) {
      await loadAndShow(selectedFile.value)
    } else {
      heatmapLayer.show = true
      viewer.imageryLayers.raiseToTop(heatmapLayer)
    }
    syncCampusModelTransparency()
    if (heatmapLayer) showStatus('热力图已显示', 2500)
    else {
      showStatus('当前帧无校区热力数据，请切换其他时序', 4000)
      layers.heatmap = false
    }
  } else {
    if (heatmapLayer) heatmapLayer.show = false
    syncCampusModelTransparency()
  }
}

function toggleGrid() {
  for (const prim of gridPrimitives) prim.show = layers.grid
  if (layers.grid) {
    if (activeRole.value === ROLE.SCHOOL && currentRoute.value?.planned) loadDynamicRouteGrids(currentRoute.value)
    else scheduleGridReload()
  } else {
    gridAbortController?.abort()
    clearAllGrids()
  }
}

function officialBuildingPointColor(category) {
  if (category === 'dormitory') return Cesium.Color.fromCssColorString('#42a5f5')
  if (category === 'stadium') return Cesium.Color.fromCssColorString('#ff8a65')
  if (category === 'school' || category === 'university') return Cesium.Color.fromCssColorString('#7e57c2')
  return Cesium.Color.fromCssColorString('#90a4ae')
}

function officialNodeColor(node) {
  const level = fixedNodeLevel(node)
  if (level === 'L1') return Cesium.Color.fromCssColorString('#e91e63')
  if (level === 'L2') return Cesium.Color.fromCssColorString('#fb8c00')
  if (level === 'L3') return Cesium.Color.fromCssColorString('#00acc1')
  return Cesium.Color.GRAY
}

function officialNodeEntityId(node) {
  return `official-node:${node.node_code}`
}

function officialNodeIsHighlighted(node) {
  return selectedAccessNodes.value.departure === node.node_code
    || selectedAccessNodes.value.receiving === node.node_code
}

function clearOfficialMapFeatures() {
  if (!viewer || viewer.isDestroyed()) return
  if (officialBuildingsDs) viewer.dataSources.remove(officialBuildingsDs, true)
  if (officialFixedNodesDs) viewer.dataSources.remove(officialFixedNodesDs, true)
  officialBuildingsDs = null
  officialFixedNodesDs = null
  officialFeatureByEntityId = new Map()
  selectedOfficialFeature.value = null
}

function createOfficialBuildingDataSource() {
  const source = new Cesium.CustomDataSource('V3正式建筑点位')
  campusPlaces.value.forEach((place) => {
    const id = `official-building:${place.buildingId || place.name}`
    const feature = {
      kind: 'building',
      name: place.name,
      buildingId: place.buildingId,
      category: place.category,
      sourceDataset: place.sourceDataset,
      lng: Number(place.lng),
      lat: Number(place.lat),
    }
    officialFeatureByEntityId.set(id, feature)
    source.entities.add({
      id,
      name: place.name,
      position: Cesium.Cartesian3.fromDegrees(feature.lng, feature.lat, 8),
      point: {
        pixelSize: 7,
        color: officialBuildingPointColor(place.category).withAlpha(0.95),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.85),
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 6500),
      },
      label: {
        text: place.name,
        font: '11px Microsoft YaHei, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -15),
        showBackground: true,
        backgroundColor: Cesium.Color.fromBytes(4, 18, 35, 180),
        backgroundPadding: new Cesium.Cartesian2(5, 3),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1150),
        scaleByDistance: new Cesium.NearFarScalar(300, 1, 1150, 0.72),
      },
    })
  })
  return source
}

function createOfficialNodeDataSource() {
  const source = new Cesium.CustomDataSource('V3三级运输节点')
  officialFixedNodes.value.forEach((node) => {
    const id = officialNodeEntityId(node)
    const feature = { kind: 'node', ...node }
    const color = officialNodeColor(node)
    const highlighted = officialNodeIsHighlighted(node)
    officialFeatureByEntityId.set(id, feature)
    source.entities.add({
      id,
      name: officialNodeDisplayName(node),
      position: Cesium.Cartesian3.fromDegrees(Number(node.location.lng), Number(node.location.lat), 12),
      point: {
        pixelSize: highlighted ? 18 : fixedNodeLevel(node) === 'L1' ? 16 : 13,
        color,
        outlineColor: highlighted ? Cesium.Color.LIME : Cesium.Color.WHITE,
        outlineWidth: highlighted ? 4 : 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${node.node_code} · ${fixedNodeLevel(node)}`,
        font: highlighted ? 'bold 14px Microsoft YaHei, sans-serif' : 'bold 12px Microsoft YaHei, sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -23),
        showBackground: true,
        backgroundColor: color.withAlpha(highlighted ? 0.95 : 0.78),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 9000),
      },
    })
  })
  return source
}

async function renderOfficialMapFeatures() {
  if (!viewer || viewer.isDestroyed() || !officialBuildingsLoaded.value || officialFixedNodes.value.length !== 13) return false
  clearOfficialMapFeatures()
  officialBuildingsDs = createOfficialBuildingDataSource()
  officialFixedNodesDs = createOfficialNodeDataSource()
  await Promise.all([
    viewer.dataSources.add(officialBuildingsDs),
    viewer.dataSources.add(officialFixedNodesDs),
  ])
  officialBuildingsDs.show = layers.officialBuildings
  officialFixedNodesDs.show = layers.fixedNodes
  return true
}

function refreshOfficialNodeStyles() {
  if (!officialFixedNodesDs) return
  officialFixedNodes.value.forEach((node) => {
    const entity = officialFixedNodesDs.entities.getById(officialNodeEntityId(node))
    if (!entity?.point || !entity.label) return
    const highlighted = officialNodeIsHighlighted(node)
    const color = officialNodeColor(node)
    entity.point.pixelSize = highlighted ? 18 : fixedNodeLevel(node) === 'L1' ? 16 : 13
    entity.point.outlineColor = highlighted ? Cesium.Color.LIME : Cesium.Color.WHITE
    entity.point.outlineWidth = highlighted ? 4 : 2
    entity.label.font = highlighted ? 'bold 14px Microsoft YaHei, sans-serif' : 'bold 12px Microsoft YaHei, sans-serif'
    entity.label.backgroundColor = color.withAlpha(highlighted ? 0.95 : 0.78)
  })
}

function setupOfficialFeaturePickHandler() {
  if (!viewer || officialFeaturePickHandler) return
  officialFeaturePickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
  officialFeaturePickHandler.setInputAction((movement) => {
    if (pickModeActive.value || !currentUser.value) return
    const picked = viewer.scene.pick(movement.position)
    const entityId = typeof picked?.id?.id === 'string' ? picked.id.id : typeof picked?.id === 'string' ? picked.id : null
    const feature = entityId ? officialFeatureByEntityId.get(entityId) : null
    if (!feature) return
    selectedOfficialFeature.value = feature
    if (feature.kind === 'node') focusOfficialFeature(feature, { silent: true })
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK)
}

function destroyOfficialFeaturePickHandler() {
  if (officialFeaturePickHandler && !officialFeaturePickHandler.isDestroyed()) officialFeaturePickHandler.destroy()
  officialFeaturePickHandler = null
}

function focusOfficialFeature(feature, options = {}) {
  if (!viewer || viewer.isDestroyed()) return
  const location = feature.kind === 'node' ? feature.location : feature
  const lng = Number(location?.lng)
  const lat = Number(location?.lat)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, feature.kind === 'node' ? 420 : 520),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-55), roll: 0 },
    duration: 1,
  })
  if (!options.silent) showStatus(`已定位：${feature.kind === 'node' ? officialNodeDisplayName(feature) : feature.name}`, 3000)
}

function setOfficialBuildingEndpoint(feature, endpoint) {
  if (feature?.kind !== 'building') return
  if (endpoint === 'start') planStartName.value = feature.name
  else planEndName.value = feature.name
  focusOfficialFeature(feature)
  showStatus(`已将${feature.name}设为${endpoint === 'start' ? '起点' : '终点'}建筑`, 3500)
}

function toggleRoute() {
  if (routePolylineEntity) routePolylineEntity.show = layers.route
  if (replanOriginalRouteEntity) replanOriginalRouteEntity.show = layers.route
}

function toggleDrone() {
  if (droneEntity) droneEntity.show = layers.drone
}

function onGridAlphaChange() {
  clearTimeout(gridLoadTimer)
  gridLoadTimer = setTimeout(() => {
    if (activeRole.value === ROLE.SCHOOL && gridDisplayMode.value === 'route-dynamic' && currentRoute.value?.planned) loadDynamicRouteGrids(currentRoute.value)
    else reloadGridsInView()
  }, 200)
}

async function loadAndShow(file) {
  if (!viewer) return
  const data = await loadCSVFile('./hotspotsdata/' + file)
  if (heatmapLayer) {
    try { viewer.imageryLayers.remove(heatmapLayer) } catch {}
    heatmapLayer = null
  }
  if (data.length) {
    heatmapLayer = createHeatmap(viewer, data)
    if (heatmapLayer) {
      heatmapLayer.show = layers.heatmap
      viewer.imageryLayers.raiseToTop(heatmapLayer)
      syncCampusModelTransparency()
    }
  } else {
    showStatus('该帧 CSV 无有效数据', 3000)
  }
}

function onFileChange() { loadAndShow(selectedFile.value) }

function prev() {
  const i = csvFiles.value.indexOf(selectedFile.value)
  if (i > 0) { selectedFile.value = csvFiles.value[i - 1]; loadAndShow(selectedFile.value) }
}

function next() {
  const i = csvFiles.value.indexOf(selectedFile.value)
  if (i < csvFiles.value.length - 1) { selectedFile.value = csvFiles.value[i + 1]; loadAndShow(selectedFile.value) }
}

function parseCSVData(csvText) {
  const lines = csvText.trim().split('\n')
  const points = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(',')
    if (parts.length >= 3) {
      const lng = parseFloat(parts[0])
      const lat = parseFloat(parts[1])
      const value = parseFloat(parts[2])
      if (!Number.isNaN(lng) && !Number.isNaN(lat) && !Number.isNaN(value)) {
        points.push({ lng, lat, value })
      }
    }
  }
  return points
}

async function loadCSVFile(url) {
  try {
    const response = await fetch(url)
    return parseCSVData(await response.text())
  } catch {
    return []
  }
}

function filterPointsNearCampus(points, pad = 0.025) {
  const c = appConfig.campusCenter || { lng: 118.956833, lat: 32.111583 }
  const filtered = points.filter(
    (p) => Math.abs(p.lng - c.lng) <= pad && Math.abs(p.lat - c.lat) <= pad
  )
  return filtered.length ? filtered : points
}

function createHeatmap(viewer, points) {
  if (!points.length) return null
  points = filterPointsNearCampus(points)
  if (!points.length) return null
  const lngs = points.map((p) => p.lng)
  const lats = points.map((p) => p.lat)
  const west = Math.min(...lngs)
  const east = Math.max(...lngs)
  const south = Math.min(...lats)
  const north = Math.max(...lats)

  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 1024
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const values = points.map((p) => p.value)
  const maxValue = Math.max(...values)
  const minValue = Math.min(...values)

  const intensityCanvas = document.createElement('canvas')
  intensityCanvas.width = canvas.width
  intensityCanvas.height = canvas.height
  const intensityCtx = intensityCanvas.getContext('2d')

  points.forEach((point) => {
    const x = ((point.lng - west) / (east - west)) * canvas.width
    const y = ((north - point.lat) / (north - south)) * canvas.height
    const normalized = Math.pow((point.value - minValue) / (maxValue - minValue || 1), 0.6)
    const radius = 30 + normalized * 40
    const grad = intensityCtx.createRadialGradient(x, y, 0, x, y, radius)
    grad.addColorStop(0, `rgba(255,255,255,${normalized * 0.9})`)
    grad.addColorStop(0.7, `rgba(255,255,255,${normalized * 0.3})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    intensityCtx.fillStyle = grad
    intensityCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  })

  ctx.filter = 'blur(25px)'
  ctx.drawImage(intensityCanvas, 0, 0)
  ctx.filter = 'none'
  ctx.globalCompositeOperation = 'lighten'
  ctx.drawImage(intensityCanvas, 0, 0)
  ctx.globalCompositeOperation = 'source-over'

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  const colors = [[0,10,80],[0,50,150],[0,255,255],[0,220,0],[255,255,0],[255,165,0],[255,0,0]]
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha > 0) {
      const t = alpha / 255
      const colorIndex = t * (colors.length - 1)
      const prevIndex = Math.floor(colorIndex)
      const nextIndex = Math.min(prevIndex + 1, colors.length - 1)
      const ratio = colorIndex - prevIndex
      const c1 = colors[prevIndex]
      const c2 = colors[nextIndex]
      data[i] = Math.round(c1[0] * (1 - ratio) + c2[0] * ratio)
      data[i + 1] = Math.round(c1[1] * (1 - ratio) + c2[1] * ratio)
      data[i + 2] = Math.round(c1[2] * (1 - ratio) + c2[2] * ratio)
      data[i + 3] = 220
    }
  }
  ctx.putImageData(imageData, 0, 0)

  const heatmapProvider = new Cesium.SingleTileImageryProvider({
    url: canvas.toDataURL('image/png'),
    rectangle: Cesium.Rectangle.fromDegrees(west, south, east, north),
  })
  const imageryLayer = viewer.imageryLayers.addImageryProvider(heatmapProvider)
  imageryLayer.alpha = 0.82
  viewer.imageryLayers.raiseToTop(imageryLayer)
  return imageryLayer
}

function handleGlobalKeyDown(event) {
  if (event.key === 'o') flyToCampus()
  if (event.key === 'h') { layers.heatmap = !layers.heatmap; toggleHeatmap() }
  if (event.key === 'g') { layers.grid = !layers.grid; toggleGrid() }
  if (event.key === 'Escape' && (pickModeActive.value || pickModeLoading.value)) exitPickMode()
}

onMounted(async () => {
  globalThis.addEventListener('skynest-auth-expired', handleAuthExpired)
  const session = await demoApi.restoreSession()
  if (session) {
    currentUser.value = session.user
    activeRole.value = session.user.role
  }
  authReady.value = true

  await loadAppConfig()
  const cesiumIonToken = String(import.meta.env.VITE_CESIUM_ION_TOKEN || '').trim()
  Cesium.Ion.defaultAccessToken = cesiumIonToken
  // 优先加载下拉框数据，避免被 Cesium 初始化阻塞
  await Promise.all([
    loadHotspotsIndex(),
    loadRoutesFromApi(),
    currentUser.value ? loadCampusPlaces() : Promise.resolve(false),
    checkDatabase(),
    legacyToolsEnabled.value ? loadAdminTasks() : Promise.resolve(),
  ])

  const viewerOptions = {
    timeline: true,
    animation: true,
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
  }
  if (!cesiumIonToken) viewerOptions.imageryProvider = createFallbackImageryProvider()
  viewer = new Cesium.Viewer('cesiumContainer', viewerOptions)
  viewer.scene.globe.show = true
  viewer.scene.skyAtmosphere.show = true
  viewer.scene.fog.enabled = true
  viewer.scene.globe.depthTestAgainstTerrain = true
  viewer.scene.pickTranslucentDepth = true

  await setupTerrain()
  await setupTileset()
  if (!tileset3d && layers.fallbackModel) {
    await setupFallbackModel()
    await new Promise((r) => setTimeout(r, 2000))
    await alignPlacesToModel()
  }
  if (layers.buildings && !layers.fallbackModel) await setupCampusBuildings()
  if (officialBuildingsLoaded.value && officialFixedNodes.value.length === 13) await renderOfficialMapFeatures()

  clearFlightEntities()
  clearPlanSearchBbox()
  clearPlanMarkers()
  renderSafetyRestrictions()

  if (layers.heatmap && selectedFile.value) await loadAndShow(selectedFile.value)

  flyToCampus()
  await new Promise((r) => setTimeout(r, 2500))
  refreshPlanUi()
  setupGridPickHandler()
  setupOfficialFeaturePickHandler()

  cameraMoveHandler = viewer.camera.moveEnd.addEventListener(scheduleGridReload)
  if (layers.grid) await reloadGridsInView()
  await checkDatabase()
  startDbWatch()
  if (legacyToolsEnabled.value) {
    adminTaskTimer = setInterval(() => { loadAdminTasks() }, 5000)
  }
  document.addEventListener('keydown', handleGlobalKeyDown)
  document.addEventListener('visibilitychange', handleDocumentVisibilityChange)
})

onUnmounted(() => {
  globalThis.removeEventListener('skynest-auth-expired', handleAuthExpired)
  document.removeEventListener('keydown', handleGlobalKeyDown)
  document.removeEventListener('visibilitychange', handleDocumentVisibilityChange)
  clearTimeout(gridLoadTimer)
  clearInterval(dbCheckTimer)
  clearInterval(adminTaskTimer)
  stopDynamicGridAutoRefresh()
  destroyPickHandler()
  destroyGridPickHandler()
  destroyOfficialFeaturePickHandler()
  clearPickMarker()
  clearPlanPreviewLine()
  clearPlanSearchBbox()
  clearPlanMarkers()
  clearRestrictionEntities()
  clearOfficialMapFeatures()
  gridAbortController?.abort()
  if (cameraMoveHandler) cameraMoveHandler()
  if (viewer && !viewer.isDestroyed()) viewer.destroy()
  viewer = null
})
</script>

<style scoped>
#cesiumContainer {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

#cesiumContainer.pick-mode {
  cursor: crosshair;
}

.platform-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 0 16px 0 300px;
  background: linear-gradient(180deg, rgba(10, 25, 50, 0.92), rgba(10, 25, 50, 0.6));
  color: #fff;
  z-index: 1000;
  pointer-events: none;
}

.header-title {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.portal-home-button {
  pointer-events: auto;
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid rgba(255, 255, 255, .35);
  border-radius: 6px;
  background: rgba(255, 255, 255, .1);
  color: #e4f3ff;
  cursor: pointer;
  font-size: 11px;
}

.header-status {
  flex: 0 0 auto;
  min-width: 0;
  margin-right: 152px;
  padding: 5px 10px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  color: #e6f4ff;
  background: rgba(8, 19, 38, 0.72);
  border: 1px solid rgba(144, 202, 249, 0.2);
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
  white-space: nowrap;
}

.session-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 5px 4px 9px;
  color: #cfe6f9;
  background: rgba(8, 19, 38, 0.68);
  border: 1px solid rgba(144, 202, 249, 0.22);
  border-radius: 9px;
  pointer-events: auto;
  white-space: nowrap;
}
.session-badge span { color: #4fc3f7; font-size: 10px; }
.session-badge strong { font-size: 11px; }
.session-badge button { flex: 0 0 auto; padding: 4px 7px; color: #b0bec5; background: rgba(255, 255, 255, 0.06); font-size: 10px; }
.session-badge button:hover { color: #fff; background: rgba(255, 255, 255, 0.14); }

.auth-loading {
  position: fixed;
  inset: 0;
  z-index: 3100;
  display: grid;
  place-items: center;
  color: #b3e5fc;
  background: #030a17;
  font-size: 13px;
  letter-spacing: 1px;
}

.link-btn {
  margin-left: 6px;
  padding: 2px 8px;
  font-size: 11px;
  background: rgba(255,255,255,0.15);
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 4px;
  color: #90caf9;
  cursor: pointer;
}
.link-btn:hover { background: rgba(255,255,255,0.25); }

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot.online { background: #4caf50; }
.status-dot.offline { background: #f44336; }

@media (max-width: 1100px) {
  .header-title { display: none; }
  .header-status { flex: 0 1 auto; margin-right: 140px; }
}

.side-panel {
  position: absolute;
  top: 48px;
  left: 0;
  width: 280px;
  bottom: 0;
  background: rgba(15, 20, 35, 0.88);
  color: #e8eaf0;
  overflow-y: auto;
  z-index: 999;
  padding: 12px;
  box-sizing: border-box;
  backdrop-filter: blur(8px);
  transition: transform 220ms ease, opacity 180ms ease;
  will-change: transform;
}

.side-panel.panel-collapsed {
  transform: translateX(-100%);
  opacity: 0;
  pointer-events: none;
}

.panel-edge-toggle {
  position: absolute;
  top: 88px;
  z-index: 1200;
  display: grid;
  width: 30px;
  height: 54px;
  padding: 0;
  place-items: center;
  color: #d9f2ff;
  background: linear-gradient(180deg, rgba(15, 43, 72, 0.96), rgba(7, 24, 45, 0.94));
  border: 1px solid rgba(100, 181, 246, 0.42);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  cursor: pointer;
  transition: left 220ms ease, right 220ms ease, background 160ms ease;
}

.panel-edge-toggle:hover {
  color: #fff;
  background: linear-gradient(180deg, rgba(22, 71, 110, 0.98), rgba(9, 37, 67, 0.98));
}

.panel-edge-toggle:focus-visible {
  outline: 2px solid #81d4fa;
  outline-offset: 2px;
}

.panel-edge-toggle span {
  font-size: 25px;
  line-height: 1;
  transform: translateY(-1px);
}

.left-panel-toggle {
  left: 280px;
  border-left: 0;
  border-radius: 0 9px 9px 0;
}

.left-panel-toggle.collapsed {
  left: 0;
}

.right-panel-toggle {
  right: 436px;
  border-right: 0;
  border-radius: 9px 0 0 9px;
}

.right-panel-toggle.collapsed {
  right: 0;
}

@media (max-width: 980px) {
  .right-panel-toggle { right: 380px; }
  .right-panel-toggle.collapsed { right: 0; }
}

.panel-section {
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.panel-section h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: #90caf9;
  font-weight: 600;
}

.admin-task-section {
  border-left: 2px solid rgba(66, 165, 245, 0.82);
  padding-left: 8px;
}

.admin-title-row, .admin-detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.admin-title-row h3 { margin-bottom: 0; }
.admin-refresh-btn { flex: 0; padding: 4px 8px; font-size: 11px; }
.admin-metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin: 8px 0; }
.admin-metrics div { padding: 6px 4px; border-radius: 4px; background: rgba(144,202,249,.1); text-align: center; }
.admin-metrics span { display: block; color: #9db1c6; font-size: 10px; }
.admin-metrics strong { color: #e3f2fd; font-size: 16px; }
.admin-task-list { max-height: 160px; margin-top: 8px; overflow-y: auto; }
.admin-task-item { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 6px; margin: 4px 0; padding: 7px; background: rgba(255,255,255,.06); text-align: left; }
.admin-task-item:hover, .admin-task-item.selected { background: rgba(66,165,245,.3); }
.admin-task-item strong, .admin-task-item small { display: block; overflow: hidden; max-width: 165px; text-overflow: ellipsis; white-space: nowrap; }
.admin-task-item strong { color: #e7f3ff; font-size: 11px; }
.admin-task-item small { margin-top: 2px; color: #9eb3c5; font-size: 9px; }
.admin-task-item em { padding: 3px 5px; border-radius: 3px; font-size: 9px; font-style: normal; white-space: nowrap; }
.status-pending { background: #6b4f16; color: #ffe19c; }
.status-approved { background: #135a5e; color: #b9fffb; }
.status-flying { background: #16508b; color: #c8e7ff; }
.status-exception { background: #772e35; color: #ffd0d4; }
.status-completed { background: #275d40; color: #c4f6d4; }
.status-default { background: #485565; color: #dbe8f5; }
.admin-task-detail { margin-top: 8px; padding: 8px; border: 1px solid rgba(144,202,249,.28); border-radius: 5px; background: rgba(0,0,0,.15); font-size: 11px; line-height: 1.45; }
.admin-task-detail p { margin: 5px 0; color: #d3deea; }
.admin-detail-head span { color: #ffcc80; font-size: 10px; }
.admin-action-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
.admin-action-row button { flex: auto; padding: 5px 6px; font-size: 10px; }
.approve-btn, .dispatch-btn { background: #00897b; }
.approve-btn:hover:not(:disabled), .dispatch-btn:hover:not(:disabled) { background: #00695c; }
.reject-btn, .exception-btn { background: #a73d4a; }
.reject-btn:hover:not(:disabled), .exception-btn:hover:not(:disabled) { background: #832e38; }
.advance-btn { background: #1565c0; }
.show-route-btn { background: #6a1b9a; }
.sandbox-text { color: #ffcc80 !important; }
.telemetry-box { display: flex; justify-content: space-between; margin-top: 7px; padding: 5px 6px; border-radius: 3px; background: rgba(0,137,123,.2); color: #b2dfdb; font-size: 10px; }
.admin-events { margin-top: 7px; color: #a8c3d7; font-size: 10px; line-height: 1.55; }

.layer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  font-size: 13px;
  cursor: pointer;
}

.row { margin: 8px 0; }
.btn-row { display: flex; gap: 8px; }
.full-width { width: 100%; }
.full-width-btn { width: 100%; margin-top: 8px; }

button {
  flex: 1;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: #1976d2;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
button:hover { background: #1565c0; }
button:disabled { background: #555; cursor: not-allowed; }

select {
  padding: 6px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #1a2035;
  color: #fff;
  font-size: 12px;
}

.form-input {
  box-sizing: border-box;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid #444;
  background: #1a2035;
  color: #fff;
  font-size: 12px;
}

.agent-section {
  border-left: 2px solid rgba(0, 137, 123, 0.8);
  padding-left: 8px;
}

.agent-check-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 4px 10px 2px 0;
  font-size: 11px;
  color: #c7d7e8;
}

.agent-submit-btn { background: #7b1fa2; }
.agent-submit-btn:hover:not(:disabled) { background: #6a1b9a; }
.agent-route-btn { background: #00897b; }
.agent-route-btn:hover:not(:disabled) { background: #00695c; }
.agent-questions { margin-top: 6px; color: #ffcc80; }

.route-desc, .hint {
  font-size: 11px;
  color: #aaa;
  margin: 6px 0 0;
  line-height: 1.4;
}

.warn-hint {
  color: #ffb74d;
}

.official-node-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 8px; }
.official-node-summary span { display: flex; flex-direction: column; gap: 2px; padding: 6px 3px; color: #90a4ae; text-align: center; background: rgba(33, 150, 243, 0.08); border-radius: 5px; font-size: 9px; }
.official-node-summary strong { color: #81d4fa; font-size: 12px; }
.official-node-summary span:nth-child(1) { border-top: 2px solid #e91e63; }
.official-node-summary span:nth-child(2) { border-top: 2px solid #fb8c00; }
.official-node-summary span:nth-child(3) { border-top: 2px solid #00acc1; }
.official-feature-section { padding: 10px; background: rgba(0, 172, 193, 0.06); border: 1px solid rgba(0, 188, 212, 0.25); border-radius: 7px; }
.official-feature-heading { display: flex; align-items: center; justify-content: space-between; }
.official-feature-heading h3 { margin-bottom: 5px; }
.detail-close-btn { flex: 0 0 auto; padding: 0 4px; color: #90a4ae; background: transparent; font-size: 16px; }
.official-feature-name { display: block; color: #e0f7fa; font-size: 12px; line-height: 1.45; }
.official-feature-actions button:first-child { background: #2e7d32; }
.official-feature-actions button:last-child { background: #ef6c00; }

.field-label {
  display: block;
  font-size: 11px;
  color: #bbb;
  margin: 8px 0 4px;
}

.plan-btn {
  background: #00897b;
}
.plan-btn:hover:not(:disabled) {
  background: #00695c;
}

.pick-section.active {
  border-color: rgba(186, 104, 200, 0.7);
  box-shadow: inset 0 0 0 1px rgba(186, 104, 200, 0.35);
}

.pick-btn {
  background: #6a1b9a;
}
.pick-btn.on {
  background: #4a148c;
  box-shadow: 0 0 0 2px rgba(186, 104, 200, 0.6);
}

.pick-result {
  margin-top: 8px;
}

.pick-link {
  margin-top: 6px;
  margin-right: 10px;
}

.demo-hint { color: #ffb74d; }

.eval-box {
  margin-top: 10px;
  padding: 10px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.15);
}
.eval-box.pass { border-color: rgba(76,175,80,0.6); }
.eval-box.fail { border-color: rgba(244,67,54,0.6); }
.eval-title { font-weight: 600; color: #90caf9; margin-bottom: 4px; }
.eval-waypoints { margin-top: 6px; max-height: 100px; overflow-y: auto; }
.eval-wp { font-size: 10px; color: #bbb; }

.slider-label {
  display: block;
  font-size: 12px;
}
.slider-label input[type="range"] {
  width: 100%;
  margin-top: 6px;
}

.dynamic-grid-btn { margin-top: 7px; border-color: rgba(77, 208, 225, 0.4); color: #80deea; }
.dynamic-auto-refresh { display: flex; align-items: center; gap: 6px; margin-top: 7px; color: #b2dfdb; font-size: 10px; }
.dynamic-auto-refresh input { width: auto; margin: 0; padding: 0; accent-color: #26c6da; }
.dynamic-grid-hint { color: #80cbc4; }
.grid-summary-card { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; margin-top: 7px; }
.grid-summary-card span { display: flex; flex-direction: column; gap: 2px; padding: 6px 4px; color: #78909c; text-align: center; background: rgba(77, 208, 225, 0.07); border-radius: 5px; font-size: 9px; }
.grid-summary-card strong { color: #b2ebf2; font-size: 11px; }
.grid-detail-card { margin-top: 8px; padding: 8px; color: #b0bec5; background: rgba(4, 13, 27, 0.7); border: 1px solid rgba(77, 208, 225, 0.24); border-radius: 7px; font-size: 9px; }
.grid-detail-title { display: flex; align-items: center; justify-content: space-between; color: #e0f7fa; }
.grid-detail-title button { padding: 0 4px; color: #90a4ae; background: transparent; border: 0; cursor: pointer; }
.grid-layer-scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 6px; }
.grid-layer-scores span { display: flex; flex-direction: column; padding: 5px; background: rgba(255, 255, 255, 0.04); border-radius: 4px; }
.grid-layer-scores strong { color: #80cbc4; }
.grid-detail-card p { margin: 6px 0 0; line-height: 1.45; }
.grid-detail-card p strong { color: #e0f2f1; }
.grid-detail-card .grid-blocked { color: #ffab91; }

.legend {
  position: absolute;
  bottom: 40px;
  right: 16px;
  background: rgba(15, 20, 35, 0.88);
  color: #e8eaf0;
  padding: 12px 14px;
  border-radius: 8px;
  z-index: 999;
  font-size: 11px;
  backdrop-filter: blur(8px);
  transition: right 0.2s ease;
}

.legend.legend-role-student { right: 452px; }
.legend.legend-role-school { right: 452px; }
.legend.legend-role-operator { right: 452px; }

.legend h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #90caf9;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
}

.swatch {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  flex-shrink: 0;
}

.status-toast {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.75);
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  z-index: 1001;
  font-size: 13px;
}

.progress-bar {
  position: absolute;
  bottom: 30px;
  left: 300px;
  right: 16px;
  height: 24px;
  background: rgba(0,0,0,0.6);
  border-radius: 12px;
  z-index: 1000;
  overflow: hidden;
  color: white;
  text-align: center;
  line-height: 24px;
  font-size: 14px;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  background: #4caf50;
  height: 100%;
  transition: width 0.2s;
}
</style>
