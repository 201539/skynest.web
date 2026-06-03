const express = require('express')
const cors = require('cors')
const path = require('path')
const fs = require('fs')
const { Pool } = require('pg')
const { wgs84ToCgcs } = require('./lib/coords')

const app = express()
app.use(cors())
app.use(express.json())

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '974853',
  database: process.env.PG_DATABASE || 'nanjing_uni_grid_score',
  max: 10,
})

const ROUTES_FILE = path.join(__dirname, 'data', 'routes.json')
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

app.get('/api/routes/:id/evaluate', async (req, res) => {
  const route = loadRoutes().routes.find((r) => r.id === req.params.id)
  if (!route) return res.status(404).json({ error: '航线不存在' })

  const groundHeight = parseFloat(req.query.groundHeight) || GROUND_HEIGHT
  const waypoints = []

  try {
    for (let i = 0; i < route.points.length; i++) {
      const pt = route.points[i]
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
    const minScore = validScores.length ? Math.min(...validScores) : null
    const maxScore = validScores.length ? Math.max(...validScores) : null

    res.json({
      routeId: route.id,
      routeName: route.name,
      groundHeight,
      averageScore: averageScore != null ? parseFloat(averageScore.toFixed(4)) : null,
      minScore,
      maxScore,
      overallVerdict: scoreVerdict(averageScore),
      passable: averageScore != null && averageScore >= 0.4,
      waypoints,
      evaluatedAt: new Date().toISOString(),
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
  console.log('  GET /api/routes/:id/evaluate')
  console.log('  GET /api/grids/bbox')
  console.log('  GET /api/grids/demo  (演示模式)')
})
