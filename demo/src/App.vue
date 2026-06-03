<template>
  <div id="cesiumContainer"></div>

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
      <h3>飞行航线</h3>
      <select v-model="selectedRouteId" @change="loadSelectedRoute" class="full-width">
        <option v-if="!routes.length" disabled value="">暂无航线，请刷新页面</option>
        <option v-for="r in routes" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <p v-if="currentRoute" class="route-desc">{{ currentRoute.description }}</p>
      <div class="row btn-row">
        <button @click="replayFlight">重播</button>
        <button @click="flyToCampus">飞到校区</button>
        <button @click="evaluateCurrentRoute" :disabled="evaluating">评估</button>
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
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
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
    description: '自西向东横穿仙林校区北部',
    duration: 50,
    points: [
      { lng: 118.942000, lat: 32.118000, height: 130 },
      { lng: 118.946000, lat: 32.119500, height: 125 },
      { lng: 118.950000, lat: 32.121000, height: 120 },
      { lng: 118.954000, lat: 32.120000, height: 115 },
      { lng: 118.958000, lat: 32.118500, height: 125 },
      { lng: 118.962000, lat: 32.117000, height: 130 },
    ],
  },
  {
    id: 'xianlin-demo-2',
    name: '仙林校区示范航线 B',
    description: '斜穿校区中部适航评估区',
    duration: 55,
    points: [
      { lng: 118.942500, lat: 32.106000, height: 120 },
      { lng: 118.946500, lat: 32.108500, height: 125 },
      { lng: 118.950500, lat: 32.110500, height: 110 },
      { lng: 118.954500, lat: 32.112000, height: 130 },
      { lng: 118.958500, lat: 32.113500, height: 115 },
      { lng: 118.962500, lat: 32.115000, height: 125 },
    ],
  },
]

const routes = ref([...DEFAULT_ROUTES])
const selectedRouteId = ref(DEFAULT_ROUTES[0].id)
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

const layers = reactive({
  terrain: true,
  tileset: true,
  fallbackModel: true,
  buildings: false,
  heatmap: true,
  grid: true,
  route: true,
  drone: true,
})

const currentRoute = computed(() => routes.value.find((r) => r.id === selectedRouteId.value))

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
      closed: false,
      translucent: true,
      flat: true,
    }),
    show: layers.grid,
  })
  viewer.scene.primitives.add(primitive)
  gridPrimitives.push(primitive)
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
    // x_min/y_min 已是 WGS84 经纬度，无需 CGCS2000 转换
    const minHeight = groundHeight.value + Math.min(z1, z2)
    const maxHeight = groundHeight.value + Math.max(z1, z2)
    const centerLng = (minLng + maxLng) / 2
    const centerLat = (minLat + maxLat) / 2
    const centerHeight = (minHeight + maxHeight) / 2
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
    if (halfZ < 0.01) halfZ = 0.01

    const dimX = halfX * 2
    const dimY = halfY * 2
    const dimZ = halfZ * 2
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
      modelMatrix: Cesium.Transforms.eastNorthUpToFixedFrame(center),
      attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(scoreToColor(score)) },
    }))
  }
  return instances
}

function getCampusBbox(pad = 0.012) {
  const c = appConfig.campusCenter || { lng: 118.956833, lat: 32.111583 }
  return {
    xMin: c.lng - pad,
    xMax: c.lng + pad,
    yMin: c.lat - pad,
    yMax: c.lat + pad,
  }
}

function clampBboxToCampus(bbox, pad = 0.012) {
  const campus = getCampusBbox(pad)
  return {
    xMin: Math.max(bbox.xMin, campus.xMin),
    xMax: Math.min(bbox.xMax, campus.xMax),
    yMin: Math.max(bbox.yMin, campus.yMin),
    yMax: Math.min(bbox.yMax, campus.yMax),
  }
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
  if (!bbox) return

  gridLoading.value = true
  clearAllGrids()

  try {
    let result
    if (dbConnected.value) {
      const params = new URLSearchParams({
        ...bbox,
        zMin: String(gridZMin.value),
        zMax: String(gridZMax.value),
        limit: String(bboxLimit.value),
      })
      result = await fetchJson(`${API_BASE}/grids/bbox?${params}`)
      gridDemoMode.value = false
    } else if (appConfig.grid?.useDemoWhenOffline !== false) {
      bbox = clampBboxToCampus(bbox)
      const params = new URLSearchParams({
        ...bbox,
        zMin: String(gridZMin.value),
        zMax: String(gridZMax.value),
        limit: String(Math.min(bboxLimit.value, 1200)),
      })
      result = await fetchJson(`${API_BASE}/grids/demo?${params}`)
      gridDemoMode.value = true
    } else {
      showStatus('数据库未连接，无法加载格网')
      return
    }

    const data = result.data || []
    const BATCH = 5000
    for (let i = 0; i < data.length; i += BATCH) {
      const batch = data.slice(i, i + BATCH)
      await renderBatchInstances(convertToInstances(batch))
      loadingProgress.value = (i + batch.length) / Math.max(data.length, 1)
      await new Promise((r) => setTimeout(r, 5))
    }
    const mode = gridDemoMode.value ? '（演示）' : ''
    showStatus(`已加载视口内 ${data.length.toLocaleString()} 条格网${mode}`)
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
  try {
    const data = await fetchJson(`${API_BASE}/routes`)
    if (data.routes?.length) {
      routes.value = data.routes
      selectedRouteId.value = data.routes[0].id
      return
    }
  } catch (e) {
    console.warn('航线 API 不可用，使用内置默认航线', e)
  }
  routes.value = [...DEFAULT_ROUTES]
  selectedRouteId.value = DEFAULT_ROUTES[0].id
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
    return
  }

  try {
    tileset3d = await Cesium.Cesium3DTileset.fromUrl(url, {
      maximumScreenSpaceError: cfg.maximumScreenSpaceError || 16,
    })
    viewer.scene.primitives.add(tileset3d)
    tileset3d.show = layers.tileset
    await viewer.zoomTo(tileset3d)
    layers.fallbackModel = false
    if (fallbackModelEntity) fallbackModelEntity.show = false
    if (campusBuildingsDs) campusBuildingsDs.show = false
    layers.buildings = false
    showStatus('3D Tiles 实景模型加载成功')
  } catch (e) {
    console.error('3D Tiles 加载失败', e)
    layers.tileset = false
    showStatus('3D Tiles 加载失败，将加载 campus-model2.glb 校园模型')
  }
}

async function setupCampusBuildings() {
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
      entity.polygon.material = Cesium.Color.fromCssColorString(color).withAlpha(0.92)
      entity.polygon.outline = true
      entity.polygon.outlineColor = Cesium.Color.WHITE.withAlpha(0.7)
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
  if (!cfg) return

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
  if (routePolylineEntity) {
    viewer.entities.remove(routePolylineEntity)
    routePolylineEntity = null
  }
  if (droneEntity) {
    viewer.entities.remove(droneEntity)
    droneEntity = null
  }
}

async function loadSelectedRoute() {
  const route = currentRoute.value
  if (!route || !viewer) return
  clearFlightEntities()

  const pathData = buildFlightPathFromRoute(route)
  if (pathData.positions.length < 2) return

  routePolylineEntity = viewer.entities.add({
    name: route.name,
    show: layers.route,
    polyline: {
      positions: pathData.positions,
      width: 4,
      material: new Cesium.PolylineGlowMaterialProperty({
        glowPower: 0.25,
        color: Cesium.Color.YELLOW,
      }),
    },
  })

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
        minimumPixelSize: droneCfg.minimumPixelSize || 64,
        scale: droneCfg.scale || 1,
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
  showStatus(`已加载航线：${route.name}（约 ${lenKm} km），动画播放中`)
  evaluateCurrentRoute()

  // 加载航线后把视角移到航线附近，便于看到无人机飞行
  const sphere = Cesium.BoundingSphere.fromPoints(pathData.positions)
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(30),
      Cesium.Math.toRadians(-30),
      Math.max(pathData.totalLength * 1.8, 800),
    ),
  })
}

async function evaluateCurrentRoute() {
  if (!selectedRouteId.value) return
  evaluating.value = true
  routeEvaluation.value = null
  try {
    const params = new URLSearchParams({ groundHeight: String(groundHeight.value) })
    routeEvaluation.value = await fetchJson(
      `${API_BASE}/routes/${selectedRouteId.value}/evaluate?${params}`
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

function flyToCampus() {
  if (!viewer) return

  const flyOpts = {
    duration: 2,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(30),
      Cesium.Math.toRadians(-28),
      1400,
    ),
  }

  if (tileset3d?.show) {
    viewer.flyTo(tileset3d, flyOpts)
    return
  }

  if (fallbackModelEntity?.show) {
    viewer.flyTo(fallbackModelEntity, flyOpts)
    return
  }

  if (campusBuildingsDs?.show) {
    viewer.flyTo(campusBuildingsDs, flyOpts)
    return
  }

  const pos = appConfig.fallbackModel?.position
    || appConfig.campusCenter
    || { lng: 118.944736, lat: 32.107470, height: 0 }
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(pos.lng, pos.lat, 600),
    orientation: {
      heading: Cesium.Math.toRadians(30),
      pitch: Cesium.Math.toRadians(-28),
      roll: 0,
    },
    duration: 2,
  })
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

function toggleFallbackModel() {
  if (fallbackModelEntity) fallbackModelEntity.show = layers.fallbackModel
}

function toggleBuildings() {
  if (campusBuildingsDs) campusBuildingsDs.show = layers.buildings
}

function toggleHeatmap() {
  if (heatmapLayer) heatmapLayer.show = layers.heatmap
}

function toggleGrid() {
  for (const prim of gridPrimitives) prim.show = layers.grid
  if (layers.grid) scheduleGridReload()
  else clearAllGrids()
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
    if (heatmapLayer) heatmapLayer.show = layers.heatmap
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
  imageryLayer.alpha = 0.75
  return imageryLayer
}

onMounted(async () => {
  Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzNTQ0NDQ2MS01ZWY1LTQ1MTYtYTQxMy0xMGU3MDQ3MTdiOGIiLCJpZCI6MzgwMjU5LCJpYXQiOjE3Njg3MTE4NjN9.2iChjh8X6t7I-ENresR0UqwghQH3KgQYYnB_212G8OY'

  await loadAppConfig()
  // 优先加载下拉框数据，避免被 Cesium 初始化阻塞
  await Promise.all([loadHotspotsIndex(), loadRoutesFromApi(), checkDatabase()])

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

  await setupTerrain()
  await setupTileset()
  if (!tileset3d) {
    await setupFallbackModel()
    if (layers.buildings) await setupCampusBuildings()
  }

  if (selectedFile.value) await loadAndShow(selectedFile.value)
  if (currentRoute.value) {
    await loadSelectedRoute()
  } else {
    flyToCampus()
  }

  cameraMoveHandler = viewer.camera.moveEnd.addEventListener(scheduleGridReload)
  if (layers.grid) await reloadGridsInView()
  await checkDatabase()
  startDbWatch()

  const onKeyDown = (e) => {
    if (e.key === 'o') flyToCampus()
    if (e.key === 'h') { layers.heatmap = !layers.heatmap; toggleHeatmap() }
    if (e.key === 'g') { layers.grid = !layers.grid; toggleGrid() }
  }
  document.addEventListener('keydown', onKeyDown)

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeyDown)
  })
})

onUnmounted(() => {
  clearTimeout(gridLoadTimer)
  clearInterval(dbCheckTimer)
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
