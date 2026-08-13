require('dotenv').config()

const fs = require('fs')
const path = require('path')
const { Pool } = require('pg')

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '',
  database: process.env.PG_DATABASE || 'nanjing_uni_grid_score',
})

async function main() {
  const migrationsDir = path.join(__dirname, 'migrations')
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter((name) => /^\d+_.+\.sql$/i.test(name))
    .sort()

  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const appliedResult = await client.query('SELECT name FROM schema_migrations')
    const applied = new Set(appliedResult.rows.map((row) => row.name))

    for (const name of migrationFiles) {
      if (applied.has(name)) {
        console.log(`跳过已执行迁移: ${name}`)
        continue
      }

      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8')
      console.log(`执行迁移: ${name}`)
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    console.log('迁移执行完成')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((error) => {
  console.error('迁移失败:', error.message)
  process.exit(1)
})
