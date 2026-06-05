require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '974853',
  database: process.env.PG_DATABASE || 'nanjing_uni_grid_score',
})

const LOD_LEVELS = [2, 4, 8, 16]

async function rebuildGridLods(client, total) {
  if (total === 0) return

  const metadataResult = await client.query(`
    SELECT
      MIN(x_min) AS origin_x,
      MIN(y_min) AS origin_y,
      MIN(z_min) AS origin_z,
      MIN(x_max - x_min) AS step_x,
      MIN(y_max - y_min) AS step_y,
      MIN(z_max - z_min) AS step_z
    FROM nanjing_uni_3d_grid_new
  `)
  const metadata = metadataResult.rows[0]

  console.log('Rebuilding adaptive grid LOD levels...')
  await client.query('BEGIN')
  try {
    await client.query('TRUNCATE TABLE nanjing_uni_3d_grid_lod')

    for (const lod of LOD_LEVELS) {
      const result = await client.query(
        `
        INSERT INTO nanjing_uni_3d_grid_lod (
          lod,
          x_min, x_max, y_min, y_max, z_min, z_max,
          static_suitability_score,
          min_suitability_score,
          max_suitability_score,
          source_count
        )
        SELECT
          ${lod},
          MIN(x_min), MAX(x_max),
          MIN(y_min), MAX(y_max),
          MIN(z_min), MAX(z_max),
          AVG(static_suitability_score),
          MIN(static_suitability_score),
          MAX(static_suitability_score),
          COUNT(*)::integer
        FROM nanjing_uni_3d_grid_new
        GROUP BY
          ROUND((x_min - $1) / $4)::bigint / ${lod},
          ROUND((y_min - $2) / $5)::bigint / ${lod},
          ROUND((z_min - $3) / $6)::bigint / ${lod}
        `,
        [
          metadata.origin_x,
          metadata.origin_y,
          metadata.origin_z,
          metadata.step_x,
          metadata.step_y,
          metadata.step_z,
        ]
      )
      console.log(`  LOD ${lod}: ${result.rowCount} aggregated cells`)
    }

    await client.query('ANALYZE nanjing_uni_3d_grid_lod')
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  }
}

async function main() {
  const schemaPath = path.join(__dirname, 'schema.sql')
  const sql = fs.readFileSync(schemaPath, 'utf8')

  console.log('连接数据库...')
  const client = await pool.connect()
  try {
    console.log('执行 schema.sql（建表 + 索引）...')
    await client.query(sql)

    const count = await client.query('SELECT COUNT(*) AS total FROM nanjing_uni_3d_grid_new')
    const total = parseInt(count.rows[0].total, 10)
    console.log(`表 nanjing_uni_3d_grid_new 当前记录数: ${total}`)

    await rebuildGridLods(client, total)

    const indexes = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'nanjing_uni_3d_grid_new'
    `)
    console.log('已有索引:', indexes.rows.map((r) => r.indexname).join(', ') || '(无)')

    console.log('数据库初始化完成')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error('初始化失败:', e.message)
  process.exit(1)
})
