const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const { Pool } = require('pg')
const { computeSearchBbox, planRoute } = require('./lib/routePlanner')

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '974853',
  database: process.env.PG_DATABASE || 'nanjing_uni_grid_score',
  max: 10,
})

const ROUTES_FILE = path.join(__dirname, 'data', 'routes.json')
const PLACES_FILE = path.join(__dirname, '..', 'demo', 'public', 'data', 'places.json')
const GROUND_HEIGHT = parseFloat(process.env.GROUND_HEIGHT || '50')

function loadRoutes() {
  try {
    return JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'))
  } catch (e) {
    console.warn('航线配置文件读取失败:', e.message)
    return { routes: [] }
  }
}

function scoreVerdict(score) {
  if (score == null) return '未知'
  if (score < 0.2) return '严重不适航'
  if (score < 0.4) return '不适航'
  if (score < 0.6) return '基本达标'
  if (score < 0.8) return '良好适航'
  return '最优适航'
}

function loadPlaces() {
  try {
    const data = JSON.parse(fs.readFileSync(PLACES_FILE, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.warn('places.json 读取失败:', e.message)
    return []
  }
}

function sanitizePlace(p) {
  const eastMeters = Number(p.eastMeters)
  const northMeters = Number(p.northMeters)
  if (!p?.name || !Number.isFinite(eastMeters) || !Number.isFinite(northMeters)) {
    throw new Error(`建筑「${p?.name || '未命名'}」缺少有效 eastMeters / northMeters`)
  }
  const out = {
    name: String(p.name).trim(),
    eastMeters: Math.round(eastMeters),
    northMeters: Math.round(northMeters),
    height: Number(p.height) || 80,
  }
  if (p.upMeters != null && Number.isFinite(Number(p.upMeters))) {
    out.upMeters = Math.round(Number(p.upMeters) * 10) / 10
  }
  if (p.surfaceHeight != null && Number.isFinite(Number(p.surfaceHeight))) {
    out.surfaceHeight = Math.round(Number(p.surfaceHeight))
  }
  return out
}

function savePlaces(places) {
  const data = places.map((p, i) => {
    try {
      return sanitizePlace(p)
    } catch (e) {
      throw new Error(`第 ${i + 1} 条：${e.message}`)
    }
  })

  const dir = path.dirname(PLACES_FILE)
  fs.mkdirSync(dir, { recursive: true })
  const content = `${JSON.stringify(data, null, 2)}\n`
  const tmpFile = `${PLACES_FILE}.tmp`

  try {
    fs.writeFileSync(tmpFile, content, 'utf8')
    fs.renameSync(tmpFile, PLACES_FILE)
  } catch (e) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
    } catch {
      // ignore
    }
    const backupFile = path.join(__dirname, 'data', 'places.json')
    fs.mkdirSync(path.dirname(backupFile), { recursive: true })
    fs.writeFileSync(backupFile, content, 'utf8')
    throw new Error(
      `无法写入 ${PLACES_FILE}（${e.code || e.message}）。已备份到 pg-server/data/places.json，请检查文件是否被占用`,
    )
  }
  return data
}

async function evaluateRoutePoints(points, groundHeight = GROUND_HEIGHT) {
  const waypoints = []

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    const zTarget = pt.height - groundHeight

    const result = await pool.query(
      `
      SELECT x_min, x_max, y_min, y_max, z_min, z_max, static_suitability_score
      FROM nanjing_uni_3d_grid_new
      WHERE x_min <= $1 AND x_max >= $1
        AND y_min <= $2 AND y_max >= $2
      ORDER BY ABS((z_min + z_max) / 2.0 - $3) ASC
      LIMIT 1
      `,
      [pt.lng, pt.lat, zTarget]
    )

    const grid = result.rows[0] || null
    const score = grid ? parseFloat(grid.static_suitability_score) : null

    waypoints.push({
      index: i,
      lng: pt.lng,
      lat: pt.lat,
      height: pt.height,
      score,
      verdict: scoreVerdict(score),
      grid,
    })
  }

  const validScores = waypoints.filter((w) => w.score != null).map((w) => w.score)
  const averageScore = validScores.length
    ? validScores.reduce((a, b) => a + b, 0) / validScores.length
    : null

  return {
    groundHeight,
    averageScore: averageScore != null ? parseFloat(averageScore.toFixed(4)) : null,
    minScore: validScores.length ? Math.min(...validScores) : null,
    maxScore: validScores.length ? Math.max(...validScores) : null,
    overallVerdict: scoreVerdict(averageScore),
    passable: averageScore != null && averageScore >= 0.4,
    waypoints,
    evaluatedAt: new Date().toISOString(),
  }
}

const CAMPUS = { lng: 118.956833, lat: 32.111583, pad: 0.012 }

function clampToCampus(bbox) {
  return {
    xMin: Math.max(bbox.xMin, CAMPUS.lng - CAMPUS.pad),
    xMax: Math.min(bbox.xMax, CAMPUS.lng + CAMPUS.pad),
    yMin: Math.max(bbox.yMin, CAMPUS.lat - CAMPUS.pad),
    yMax: Math.min(bbox.yMax, CAMPUS.lat + CAMPUS.pad),
  }
}

function generateDemoGrids(bbox, limit = 800) {
  const { xMin, xMax, yMin, yMax } = clampToCampus(bbox)
  if (xMax <= xMin || yMax <= yMin) return []

  const stepX = (xMax - xMin) / Math.sqrt(limit)
  const stepY = (yMax - yMin) / Math.sqrt(limit)
  const data = []
  let count = 0

  for (let x = xMin; x < xMax && count < limit; x += stepX) {
    for (let y = yMin; y < yMax && count < limit; y += stepY) {
      const cx = x + stepX / 2
      const cy = y + stepY / 2
      const dist = Math.sqrt(
        Math.pow(cx - CAMPUS.lng, 2) + Math.pow(cy - CAMPUS.lat, 2)
      )
      const score = Math.min(1, Math.max(0, 0.85 - dist * 40 + (Math.random() - 0.5) * 0.1))
      data.push({
        x_min: x,
        x_max: x + stepX,
        y_min: y,
        y_max: y + stepY,
        z_min: 50,
        z_max: 85,
        static_suitability_score: parseFloat(score.toFixed(3)),
      })
      count++
    }
  }
  return data
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, database: 'connected' })
  } catch (e) {
    res.status(503).json({ ok: false, database: 'disconnected', error: e.message })
  }
})

app.get('/api/stats', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT COUNT(*) AS total FROM nanjing_uni_3d_grid_new`)
    const total = parseInt(result.rows[0].total, 10)
    if (total === 0) {
      return res.status(503).json({
        error: '格网数据为空',
        detail: '表已存在但没有数据，请运行 pg-server/import-data.ps1 重新导入',
        total: 0,
      })
    }
    const scoreStats = await pool.query(`
      SELECT
        MIN(static_suitability_score) AS min_score,
        MAX(static_suitability_score) AS max_score,
        AVG(static_suitability_score) AS avg_score
      FROM nanjing_uni_3d_grid_new
    `)
    res.json({
      table: 'nanjing_uni_3d_grid_new',
      total,
      minScore: parseFloat(scoreStats.rows[0].min_score),
      maxScore: parseFloat(scoreStats.rows[0].max_score),
      avgScore: parseFloat(scoreStats.rows[0].avg_score),
    })
  } catch (e) {
    res.status(500).json({
      error: '统计查询失败',
      detail: e.message,
      hint: '格网数据表可能损坏，请运行 pg-server/import-data.ps1 重新导入',
    })
  }
})

app.get('/api/routes', (_req, res) => {
  res.json(loadRoutes())
})

app.get('/api/routes/:id', (req, res) => {
  const route = loadRoutes().routes.find((r) => r.id === req.params.id)
  if (!route) return res.status(404).json({ error: '航线不存在' })
  res.json(route)
})

app.get('/api/places', (_req, res) => {
  const places = loadPlaces()
  res.json({ places, count: places.length, source: 'places.json' })
})

app.put('/api/places', handleSavePlaces)
app.post('/api/places/save', handleSavePlaces)

function handleSavePlaces(req, res) {
  const { places } = req.body || {}
  if (!Array.isArray(places) || !places.length) {
    return res.status(400).json({ error: '请提供 places[] 数组' })
  }

  try {
    const saved = savePlaces(places)
    res.json({ ok: true, count: saved.length, places: saved, file: PLACES_FILE })
  } catch (e) {
    console.error('[places save]', e)
    const isValidation = /缺少有效|第 \d+ 条/.test(e.message)
    res.status(isValidation ? 400 : 500).json({
      error: e.message || '保存失败',
      file: PLACES_FILE,
    })
  }
}

app.post('/api/routes/evaluate', async (req, res) => {
  const { points, groundHeight: gh } = req.body || {}
  if (!Array.isArray(points) || points.length < 2) {
    return res.status(400).json({ error: '请提供至少 2 个航点 points[]' })
  }

  const groundHeight = parseFloat(gh) || GROUND_HEIGHT
  try {
    const evaluation = await evaluateRoutePoints(points, groundHeight)
    res.json(evaluation)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '航线评估失败', detail: e.message })
  }
})

app.post('/api/route-plan', async (req, res) => {
  const {
    start,
    end,
    startName,
    endName,
    searchBBox,
    groundHeight: gh,
    minScore,
    gridSize,
    simplifyToleranceMeters,
  } = req.body || {}

  if (!start?.lng || !start?.lat || !end?.lng || !end?.lat) {
    return res.status(400).json({ error: '请提供 start/end 的 lng、lat' })
  }

  if (startName && endName && startName === endName) {
    return res.status(400).json({ error: '起点与终点不能相同' })
  }

  const groundHeight = parseFloat(gh) || GROUND_HEIGHT
  const defaultHeight = parseFloat(process.env.DEFAULT_FLIGHT_HEIGHT || '80')

  const startPt = {
    lng: parseFloat(start.lng),
    lat: parseFloat(start.lat),
    height: parseFloat(start.height) || defaultHeight,
  }
  const endPt = {
    lng: parseFloat(end.lng),
    lat: parseFloat(end.lat),
    height: parseFloat(end.height) || defaultHeight,
  }

  let bbox = searchBBox
  if (bbox) {
    bbox = {
      xMin: Math.min(parseFloat(bbox.xMin), parseFloat(bbox.xMax)),
      xMax: Math.max(parseFloat(bbox.xMin), parseFloat(bbox.xMax)),
      yMin: Math.min(parseFloat(bbox.yMin), parseFloat(bbox.yMax)),
      yMax: Math.max(parseFloat(bbox.yMin), parseFloat(bbox.yMax)),
    }
    if ([bbox.xMin, bbox.xMax, bbox.yMin, bbox.yMax].some((v) => Number.isNaN(v))) {
      return res.status(400).json({ error: 'searchBBox 参数无效' })
    }
    if (bbox.xMax <= bbox.xMin || bbox.yMax <= bbox.yMin) {
      bbox = computeSearchBbox(startPt, endPt)
    }
  } else {
    bbox = computeSearchBbox(startPt, endPt)
  }

  try {
    const plan = await planRoute(
      pool,
      startPt,
      endPt,
      {
        searchBBox: bbox,
        groundHeight,
        minScore: minScore != null ? parseFloat(minScore) : undefined,
        gridSize: gridSize != null ? parseInt(gridSize, 10) : undefined,
        simplifyToleranceMeters:
          simplifyToleranceMeters != null ? parseFloat(simplifyToleranceMeters) : undefined,
        startName,
        endName,
        routeName: startName && endName ? `${startName} → ${endName}` : '智能规划航线',
      },
      generateDemoGrids
    )

    let evaluation = null
    try {
      evaluation = await evaluateRoutePoints(plan.route.points, groundHeight)
    } catch (evalErr) {
      console.warn('规划航线评估跳过（数据库不可用）:', evalErr.message)
    }

    res.json({
      ...plan,
      evaluation,
      start: startPt,
      end: endPt,
      plannedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '航线规划失败', detail: e.message })
  }
})

app.get('/api/routes/:id/evaluate', async (req, res) => {
  const route = loadRoutes().routes.find((r) => r.id === req.params.id)
  if (!route) return res.status(404).json({ error: '航线不存在' })

  const groundHeight = parseFloat(req.query.groundHeight) || GROUND_HEIGHT

  try {
    const evaluation = await evaluateRoutePoints(route.points, groundHeight)
    res.json({
      routeId: route.id,
      routeName: route.name,
      ...evaluation,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '航线评估失败', detail: e.message })
  }
})

app.get('/api/grids/demo', (req, res) => {
  const xMin = parseFloat(req.query.xMin)
  const xMax = parseFloat(req.query.xMax)
  const yMin = parseFloat(req.query.yMin)
  const yMax = parseFloat(req.query.yMax)
  const limit = Math.min(parseInt(req.query.limit, 10) || 800, 3000)

  if ([xMin, xMax, yMin, yMax].some((v) => Number.isNaN(v))) {
    return res.status(400).json({ error: '缺少 bbox 参数' })
  }

  const data = generateDemoGrids({ xMin, xMax, yMin, yMax }, limit)
  res.json({
    demo: true,
    message: '数据库不可用时的演示数据',
    bbox: { xMin, xMax, yMin, yMax },
    count: data.length,
    data,
  })
})

app.get('/api/grids/bbox', async (req, res) => {
  try {
    const xMin = parseFloat(req.query.xMin)
    const xMax = parseFloat(req.query.xMax)
    const yMin = parseFloat(req.query.yMin)
    const yMax = parseFloat(req.query.yMax)
    const zMin = req.query.zMin != null ? parseFloat(req.query.zMin) : null
    const zMax = req.query.zMax != null ? parseFloat(req.query.zMax) : null
    const limit = Math.min(parseInt(req.query.limit, 10) || 8000, 20000)

    if ([xMin, xMax, yMin, yMax].some((v) => Number.isNaN(v))) {
      return res.status(400).json({ error: '缺少有效的 bbox 参数 (xMin,xMax,yMin,yMax)' })
    }

    const result = await pool.query(
      `
      SELECT x_min, x_max, y_min, y_max, z_min, z_max, static_suitability_score
      FROM nanjing_uni_3d_grid_new
      WHERE x_max >= $1 AND x_min <= $2
        AND y_max >= $3 AND y_min <= $4
        AND ($5::double precision IS NULL OR z_max >= $5)
        AND ($6::double precision IS NULL OR z_min <= $6)
      ORDER BY x_min, y_min, z_min
      LIMIT $7
      `,
      [xMin, xMax, yMin, yMax, zMin, zMax, limit]
    )

    res.json({
      demo: false,
      bbox: { xMin, xMax, yMin, yMax, zMin, zMax },
      count: result.rows.length,
      limit,
      data: result.rows,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'bbox 查询失败', detail: e.message })
  }
})

app.get('/api/grids', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10)
    const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 50000)

    if (Number.isNaN(page)) {
      const result = await pool.query(
        `
        SELECT x_min, x_max, y_min, y_max, z_min, z_max, static_suitability_score
        FROM nanjing_uni_3d_grid_new
        ORDER BY x_min, y_min, z_min
        LIMIT $1
        `,
        [limit]
      )
      return res.json(result.rows)
    }

    const offset = (page - 1) * limit
    const countRes = await pool.query(`SELECT COUNT(*) AS total FROM nanjing_uni_3d_grid_new`)
    const total = parseInt(countRes.rows[0].total, 10)

    const result = await pool.query(
      `
      SELECT x_min, x_max, y_min, y_max, z_min, z_max, static_suitability_score
      FROM nanjing_uni_3d_grid_new
      ORDER BY x_min, y_min, z_min
      LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    )

    res.json({
      page,
      limit,
      total,
      data: result.rows,
      hasMore: offset + result.rows.length < total,
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: '查询失败', detail: e.message })
  }
})

const PORT = parseInt(process.env.PORT || '3001', 10)
app.listen(PORT, () => {
  console.log(`API 服务已启动: http://localhost:${PORT}`)
  console.log('  GET /api/health')
  console.log('  GET /api/stats')
  console.log('  GET /api/routes')
  console.log('  GET /api/places')
  console.log('  PUT /api/places')
  console.log('  POST /api/places/save')
  console.log('  POST /api/route-plan')
  console.log('  POST /api/routes/evaluate')
  console.log('  GET /api/routes/:id/evaluate')
  console.log('  GET /api/grids/bbox')
  console.log('  GET /api/grids/demo  (演示模式)')
})
