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

async function main() {
  const schemaPath = path.join(__dirname, 'schema.sql')
  const sql = fs.readFileSync(schemaPath, 'utf8')

  console.log('连接数据库...')
  const client = await pool.connect()
  try {
    console.log('执行 schema.sql（建表 + 索引）...')
    await client.query(sql)

    const count = await client.query('SELECT COUNT(*) AS total FROM nanjing_uni_3d_grid_new')
    console.log(`表 nanjing_uni_3d_grid_new 当前记录数: ${count.rows[0].total}`)

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
