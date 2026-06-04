<template>
  <div id="cesiumContainer" :class="{ 'pick-mode': pickModeActive }"></div>

  <header class="platform-header">
    <div class="header-title">{{ appConfig.title || '仙林校区无人机适航评估平台' }}</div>
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

  <aside class="side-panel">
    <section class="panel-section">
      <h3>图层控制</h3>
      <label class="layer-item"><input type="checkbox" v-model="layers.terrain" @change="toggleTerrain" /> 本地地形</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.tileset" @change="toggleTileset" /> 3D Tiles 实景</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.fallbackModel" @change="toggleFallbackModel" /> 简易校园模型</label>
      <label class="layer-item"><input type="checkbox" v-model="layers.buildings" @change="toggleBuildings" /> 校园建筑（GeoJSON）</label>
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

    <section class="panel-section">
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
      </p>
      <p v-if="planSearchBboxText" class="hint">局部搜索：{{ planSearchBboxText }}</p>
      <p v-if="!canPlanRoute && campusPlaces.length" class="hint warn-hint">
        请选择不同的起点与终点建筑
      </p>
      <p v-if="!campusPlaces.length" class="hint warn-hint">建筑列表未加载，请刷新页面</p>
      <div class="row btn-row">
        <button type="button" class="plan-btn" @click="planSmartRoute" :disabled="planning || !canPlanRoute">
          {{ planning ? 'A* 规划中...' : 'A* 生成航线' }}
        </button>
        <button type="button" @click="flyToCampus">飞到校区</button>
      </div>
      <div v-if="planResult" class="eval-box pass">
        <div class="eval-title">规划结果</div>
        <div>算法：{{ planResult.algorithm }} · 航点 {{ planResult.route?.points?.length ?? 0 }} 个</div>
        <div>航程约 {{ ((planResult.totalLengthMeters || 0) / 1000).toFixed(2) }} km</div>
        <div v-if="planResult.algorithm === 'A*' && !planResult.fallbackUsed" class="hint">
          基于适航格网 A* 寻路；开阔区域最优路径可能接近直线
        </div>
        <div v-if="planResult.fallbackUsed" class="demo-hint">未找到格网最优路径，已使用直线备选</div>
        <div v-if="planResult.demo" class="demo-hint">演示格网模式</div>
      </div>
    </section>

    <section class="panel-section pick-section" :class="{ active: pickModeActive }">
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

    <section class="panel-section">
      <h3>飞行航线</h3>
      <select v-model="selectedRouteId" @change="onRouteSelect" class="full-width">
        <option value="">— 选择预设航线 —</option>
        <option v-for="r in routes" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <p v-if="currentRoute" class="route-desc">{{ currentRoute.description }}</p>
      <div class="row btn-row">
        <button type="button" @click="replayFlight">重播</button>
        <button type="button" @click="flyToCampus">飞到校区</button>
        <button type="button" @click="evaluateCurrentRoute" :disabled="evaluating">评估</button>
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
      <label class="slider-label">
        高度下限 {{ gridZMin }}m
        <input type="range" min="0" max="150" step="5" v-model.number="gridZMin" @change="reloadGridsInView" />
      </label>
      <label class="slider-label">
        高度上限 {{ gridZMax }}m
        <input type="range" min="50" max="300" step="5" v-model.number="gridZMax" @change="reloadGridsInView" />
      </label>
      <button class="full-width-btn" @click="reloadGridsInView" :disabled="gridLoading">
        {{ gridLoading ? '加载中...' : '刷新当前视口格网' }}
      </button>
      <p v-if="gridDemoMode" class="hint demo-hint">演示模式：格网数据未导入，显示校区模拟格网</p>
      <p v-else class="hint">视口内最多 {{ bboxLimit.toLocaleString() }} 条 · 数据库 {{ gridTotal.toLocaleString() }} 条</p>
      <p class="hint">默认显示 80m 飞行高度层 · 彩色立体体块</p>
    </section>
  </aside>

  <div class="legend">
    <h4>适航评分图例</h4>
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
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import * as Cesium from 'cesium'
import proj4 from 'proj4'

proj4.defs('EPSG:4490', '+proj=longlat +ellps=GRS80 +no_defs')
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs')
const cgcs2wgs84 = proj4('EPSG:4490', 'EPSG:4326')
const wgs842cgcs = proj4('EPSG:4326', 'EPSG:4490')

window.CESIUM_BASE_URL = '/'

const API_BASE = '/api'

let viewer = null
let heatmapLayer = null
let tileset3d = null
let terrainProvider = null
let fallbackModelEntity = null
let campusBuildingsDs = null
let routePolylineEntity = null
let droneEntity = null
let searchBboxEntity = null
let planPreviewEntity = null
let planMarkerEntities = []
let routeWaypointEntities = []
let pickHandler = null
let pickMarkerEntity = null
let gridLoadTimer = null
let dbCheckTimer = null
let cameraMoveHandler = null
let geometryCache = new Map()
let gridPrimitives = []

const appConfig = reactive({ title: '仙林校区无人机适航评估平台' })
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

const routes = ref([...DEFAULT_ROUTES])
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
const routeEvaluation = ref(null)
const evaluating = ref(false)

const campusPlaces = ref([])
const planStartName = ref('')
const planEndName = ref('')
const planFlightHeight = ref(80)
const planning = ref(false)
const planResult = ref(null)
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
    planStartName.value &&
    planEndName.value &&
    planStartName.value !== planEndName.value
  )
)

watch([planStartName, planEndName], () => {
  refreshPlanUi()
})

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
  if (!viewer) return
  for (const entity of routeWaypointEntities) {
    viewer.entities.remove(entity)
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

function clearPlanPreviewLine() {
  if (planPreviewEntity && viewer) {
    viewer.entities.remove(planPreviewEntity)
    planPreviewEntity = null
  }
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
      return { name: p.name, lng: p.lng, lat: p.lat, height: p.height || 80 }
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
  routes.value = [...preservedPlanned, ...buildRoutesFromPlaces()]
  if (!campusPlaces.value.find((p) => p.name === planStartName.value)) {
    planStartName.value = campusPlaces.value[0]?.name || ''
  }
  if (!campusPlaces.value.find((p) => p.name === planEndName.value)) {
    planEndName.value = campusPlaces.value[Math.min(1, campusPlaces.value.length - 1)]?.name || ''
  }
  const anchor = getModelAnchorDegrees(fallbackModelEntity)
  const sample = campusPlaces.value.find((p) => p.name === '图书馆') || campusPlaces.value[0]
  if (sample) {
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
  const url = appConfig.routePlan?.placesUrl || './data/places.json'
  try {
    let places = []
    try {
      const apiData = await fetchJson(`${API_BASE}/places`)
      places = apiData.places || []
    } catch {
      places = await fetchJson(url)
    }
    if (Array.isArray(places) && places.length) {
      const draft = loadPlacesDraft()
      if (draft?.places?.length) {
        placeLayoutRaw = draft.places
        console.info('[places] 已恢复浏览器标定草稿', draft.updatedAt)
      } else {
        placeLayoutRaw = places
      }
      campusPlaces.value = resolvePlacesFromModelLocal(placeLayoutRaw, null)
      planStartName.value = campusPlaces.value[0]?.name || ''
      planEndName.value = campusPlaces.value[Math.min(1, campusPlaces.value.length - 1)]?.name || ''
      if (!pickTargetName.value || !campusPlaces.value.find((p) => p.name === pickTargetName.value)) {
        pickTargetName.value = campusPlaces.value[0]?.name || ''
      }
      if (appConfig.routePlan?.defaultFlightHeight != null) {
        planFlightHeight.value = appConfig.routePlan.defaultFlightHeight
      }
      return true
    }
  } catch (e) {
    console.warn('建筑列表加载失败', e)
  }
  return false
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
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    })

    if (res.status === 404) {
      res = await fetch(`${API_BASE}/places/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
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

async function planSmartRoute() {
  if (!canPlanRoute.value || planning.value) return
  const start = planStartPlace.value
  const end = planEndPlace.value
  if (!start || !end) return

  planning.value = true
  planResult.value = null
  routeEvaluation.value = null

  const searchBBox = computeLocalSearchBbox(start, end)
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

  const payload = {
    start: { lng: start.lng, lat: start.lat, height: planFlightHeight.value },
    end: { lng: end.lng, lat: end.lat, height: planFlightHeight.value },
    startName: start.name,
    endName: end.name,
    searchBBox,
    groundHeight: groundHeight.value,
    minScore: appConfig.routePlan?.minScore,
    gridSize: appConfig.routePlan?.gridSize,
    simplifyToleranceMeters: appConfig.routePlan?.simplifyToleranceMeters,
  }

  try {
    const res = await fetch(`${API_BASE}/route-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `规划失败 ${res.status}`)

    planResult.value = data
    routeEvaluation.value = data.evaluation || null

    const planned = data.route
    routes.value = routes.value.filter((r) => !r.planned)
    routes.value.unshift(planned)
    selectedRouteId.value = planned.id

    layers.route = true
    layers.drone = true
    await loadSelectedRoute(planned, { isPlanned: true, skipCameraFly: true })

    showStatus(`智能航线已生成：${planned.name}（${data.algorithm}）`, 5000)
  } catch (e) {
    console.error('航线规划失败', e)
    showStatus(`航线规划失败：${e.message}`, 6000)
  } finally {
    planning.value = false
  }
}

function showStatus(msg, ms = 3000) {
  statusMessage.value = msg
  if (ms > 0) setTimeout(() => { statusMessage.value = '' }, ms)
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} ${res.status}`)
  return res.json()
}

async function assetExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

function clearAllGrids() {
  if (!viewer) return
  for (const prim of gridPrimitives) {
    if (prim && !prim.isDestroyed()) viewer.scene.primitives.remove(prim)
  }
  gridPrimitives = []
  geometryCache.clear()
}

async function renderBatchInstances(instances) {
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
  })
  viewer.scene.primitives.add(primitive)
  gridPrimitives.push(primitive)
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

function convertToInstances(gridDataList) {
  const instances = []
  const minBoxHeight = appConfig.grid?.minBoxHeight ?? 8

  for (const g of gridDataList) {
    let x1 = parseFloat(g.x_min)
    let y1 = parseFloat(g.y_min)
    let x2 = parseFloat(g.x_max)
    let y2 = parseFloat(g.y_max)
    let z1 = parseFloat(g.z_min)
    let z2 = parseFloat(g.z_max)
    const score = Cesium.Math.clamp(parseFloat(g.static_suitability_score) || 0, 0, 1)

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
    const center = Cesium.Cartesian3.fromDegrees(centerLng, centerLat, centerHeight)

    const westPoint = Cesium.Cartesian3.fromDegrees(minLng, centerLat, centerHeight)
    const eastPoint = Cesium.Cartesian3.fromDegrees(maxLng, centerLat, centerHeight)
    let halfX = Cesium.Cartesian3.distance(westPoint, eastPoint) / 2
    if (halfX < 0.01) halfX = 0.01

    const southPoint = Cesium.Cartesian3.fromDegrees(centerLng, minLat, centerHeight)
    const northPoint = Cesium.Cartesian3.fromDegrees(centerLng, maxLat, centerHeight)
    let halfY = Cesium.Cartesian3.distance(southPoint, northPoint) / 2
    if (halfY < 0.01) halfY = 0.01

    let halfZ = (maxHeight - minHeight) / 2
    if (halfZ < minBoxHeight / 2) {
      halfZ = minBoxHeight / 2
      centerHeight = minHeight + halfZ
    }

    const dimX = halfX * 2
    const dimY = halfY * 2
    const dimZ = halfZ * 2
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

    instances.push(new Cesium.GeometryInstance({
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

function intersectBbox(a, b) {
  return {
    xMin: Math.max(a.xMin, b.xMin),
    xMax: Math.min(a.xMax, b.xMax),
    yMin: Math.max(a.yMin, b.yMin),
    yMax: Math.min(a.yMax, b.yMax),
  }
}

function clampBboxToCampus(bbox, pad = 0.004) {
  const campus = getCampusBbox(pad)
  return intersectBbox(bbox, campus)
}

function getViewBbox() {
  const rect = viewer.camera.computeViewRectangle()
  if (!rect) return null

  const pad = 0.002
  return {
    xMin: Cesium.Math.toDegrees(rect.west) - pad,
    xMax: Cesium.Math.toDegrees(rect.east) + pad,
    yMin: Cesium.Math.toDegrees(rect.south) - pad,
    yMax: Cesium.Math.toDegrees(rect.north) + pad,
  }
}

async function reloadGridsInView() {
  if (!viewer || !layers.grid) return
  let bbox = getViewBbox()
  if (!bbox) bbox = getCampusBbox(0.002)

  const campus = getCampusBbox()
  bbox = intersectBbox(bbox, campus)
  if (bbox.xMax <= bbox.xMin || bbox.yMax <= bbox.yMin) {
    bbox = campus
  }

  const zRange = appConfig.grid?.flightLayerOnly !== false
    ? getFlightLayerZRange()
    : { zMin: gridZMin.value, zMax: gridZMax.value }

  gridLoading.value = true
  clearAllGrids()

  try {
    let result
    if (dbConnected.value) {
      const params = new URLSearchParams({
        ...bbox,
        zMin: String(zRange.zMin),
        zMax: String(zRange.zMax),
        limit: String(bboxLimit.value),
      })
      result = await fetchJson(`${API_BASE}/grids/bbox?${params}`)
      gridDemoMode.value = false
    } else if (appConfig.grid?.useDemoWhenOffline !== false) {
      const params = new URLSearchParams({
        ...bbox,
        zMin: String(zRange.zMin),
        zMax: String(zRange.zMax),
        limit: String(Math.min(bboxLimit.value, 1200)),
      })
      result = await fetchJson(`${API_BASE}/grids/demo?${params}`)
      gridDemoMode.value = true
    } else {
      showStatus('数据库未连接，无法加载格网')
      return
    }

    const data = filterGridByFlightLayer(result.data || [])
    const BATCH = 2500
    for (let i = 0; i < data.length; i += BATCH) {
      const batch = data.slice(i, i + BATCH)
      await renderBatchInstances(convertToInstances(batch))
      loadingProgress.value = (i + batch.length) / Math.max(data.length, 1)
      await new Promise((r) => setTimeout(r, 5))
    }
    const mode = gridDemoMode.value ? '（演示）' : ''
    const layerHint = appConfig.grid?.flightLayerOnly !== false ? ' · 飞行高度层' : ''
    showStatus(`已加载视口内 ${data.length.toLocaleString()} 条格网${layerHint}${mode}`)
  } catch (e) {
    console.error('格网加载失败', e)
    showStatus('格网加载失败，请确认 API 服务已启动')
  } finally {
    loadingProgress.value = 0
    gridLoading.value = false
  }
}

function scheduleGridReload() {
  if (!layers.grid || !appConfig.grid?.loadOnCameraMove) return
  clearTimeout(gridLoadTimer)
  gridLoadTimer = setTimeout(reloadGridsInView, 600)
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
        if (showToast) {
          showStatus(`数据库已连接 · ${gridTotal.value.toLocaleString()} 条格网`)
          await Promise.all([loadHotspotsIndex(), loadRoutesFromApi()])
        }
        if (layers.grid && viewer) await reloadGridsInView()
        return true
      } catch (statsErr) {
        dbConnected.value = false
        gridTotal.value = 0
        if (showToast) {
          showStatus('PostgreSQL 在线，但格网数据表损坏或未导入，请运行 import-data.ps1', 6000)
        }
        if (layers.grid && viewer) await reloadGridsInView()
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
    routeEvaluation.value = null
    return
  }
  layers.route = true
  layers.drone = true
  loadSelectedRoute()
}

async function setupTerrain() {
  if (!appConfig.terrain?.enabled) return
  const url = appConfig.terrain.url || './terrain'
  if (!(await assetExists(`${url}/layer.json`))) {
    showStatus('本地地形数据不可用')
    layers.terrain = false
    return
  }
  try {
    terrainProvider = await Cesium.CesiumTerrainProvider.fromUrl(url)
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
  if (!(await assetExists(url))) {
    showStatus('3D Tiles 未找到，将加载 campus-model2.glb 校园模型')
    layers.tileset = false
    layers.fallbackModel = appConfig.fallbackModel?.enabled !== false
    return
  }

  try {
    tileset3d = await Cesium.Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: cfg.maximumScreenSpaceError || 16,
    })
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
    showStatus('3D Tiles 加载失败，将加载 campus-model2.glb 校园模型')
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
    showStatus('校园模型 campus-model2.glb 已加载')
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
        text: '请将 3D Tiles 或 campus-model2.glb 放入对应目录',
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
  if (routePolylineEntity) {
    viewer.entities.remove(routePolylineEntity)
    routePolylineEntity = null
  }
  if (droneEntity) {
    viewer.entities.remove(droneEntity)
    droneEntity = null
  }
}

async function loadSelectedRoute(routeOverride = null, options = {}) {
  const route = routeOverride || currentRoute.value
  if (!route || !viewer) return
  clearFlightEntities()

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

  startFlightAnimation(route, pathData, headingOffset)
  const lenKm = (pathData.totalLength / 1000).toFixed(2)
  const tag = isPlanned ? '智能规划' : '已加载'
  showStatus(`${tag}航线：${route.name}（约 ${lenKm} km），动画播放中`)

  if (route.planned && routeEvaluation.value) {
    // 规划接口已返回评估结果
  } else {
    evaluateCurrentRoute(route)
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

async function evaluateCurrentRoute(routeOverride = null) {
  const route = routeOverride || currentRoute.value
  if (!route?.points?.length) return

  evaluating.value = true
  if (!route.planned) routeEvaluation.value = null

  try {
    if (route.planned) {
      const res = await fetch(`${API_BASE}/routes/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    showStatus('已定位到仙林校区白模')
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
    showStatus('已启用 GLB 校园白模，无需叠加 GeoJSON 建筑块', 4000)
    return
  }
  if (layers.buildings && !campusBuildingsDs) {
    await setupCampusBuildings()
  }
  if (campusBuildingsDs) campusBuildingsDs.show = layers.buildings
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
    scheduleGridReload()
  } else {
    clearAllGrids()
  }
}

function toggleRoute() {
  if (routePolylineEntity) routePolylineEntity.show = layers.route
}

function toggleDrone() {
  if (droneEntity) droneEntity.show = layers.drone
}

function onGridAlphaChange() {
  reloadGridsInView()
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

onMounted(async () => {
  Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzNTQ0NDQ2MS01ZWY1LTQ1MTYtYTQxMy0xMGU3MDQ3MTdiOGIiLCJpZCI6MzgwMjU5LCJpYXQiOjE3Njg3MTE4NjN9.2iChjh8X6t7I-ENresR0UqwghQH3KgQYYnB_212G8OY'

  await loadAppConfig()
  // 优先加载下拉框数据，避免被 Cesium 初始化阻塞
  await Promise.all([
    loadHotspotsIndex(),
    loadRoutesFromApi(),
    loadCampusPlaces(),
    checkDatabase(),
  ])

  viewer = new Cesium.Viewer('cesiumContainer', {
    timeline: true,
    animation: true,
    baseLayerPicker: true,
    geocoder: false,
    homeButton: true,
    sceneModePicker: true,
  })
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

  clearFlightEntities()
  clearPlanSearchBbox()
  clearPlanMarkers()

  if (layers.heatmap && selectedFile.value) await loadAndShow(selectedFile.value)

  flyToCampus()
  await new Promise((r) => setTimeout(r, 2500))
  refreshPlanUi()

  cameraMoveHandler = viewer.camera.moveEnd.addEventListener(scheduleGridReload)
  if (layers.grid) await reloadGridsInView()
  await checkDatabase()
  startDbWatch()

  const onKeyDown = (e) => {
    if (e.key === 'o') flyToCampus()
    if (e.key === 'h') { layers.heatmap = !layers.heatmap; toggleHeatmap() }
    if (e.key === 'g') { layers.grid = !layers.grid; toggleGrid() }
    if (e.key === 'Escape' && (pickModeActive.value || pickModeLoading.value)) exitPickMode()
  }
  document.addEventListener('keydown', onKeyDown)

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeyDown)
  })
})

onUnmounted(() => {
  clearTimeout(gridLoadTimer)
  clearInterval(dbCheckTimer)
  destroyPickHandler()
  clearPickMarker()
  clearPlanPreviewLine()
  clearPlanSearchBbox()
  clearPlanMarkers()
  if (cameraMoveHandler) cameraMoveHandler()
  if (viewer) viewer.destroy()
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
  padding: 0 16px 0 300px;
  background: linear-gradient(180deg, rgba(10, 25, 50, 0.92), rgba(10, 25, 50, 0.6));
  color: #fff;
  z-index: 1000;
  pointer-events: none;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 1px;
}

.header-status {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: auto;
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

.route-desc, .hint {
  font-size: 11px;
  color: #aaa;
  margin: 6px 0 0;
  line-height: 1.4;
}

.warn-hint {
  color: #ffb74d;
}

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
}

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
