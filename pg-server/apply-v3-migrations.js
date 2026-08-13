require('dotenv').config()

const fs = require('node:fs/promises')
const path = require('node:path')
const { Pool } = require('pg')
const { getV3DatabaseConfig } = require('./lib/databaseConfig')

const pool = new Pool(getV3DatabaseConfig({
  application_name: 'skynest-v3-migrations',
}))

async function main() {
  try {
    const migrationsDirectory = path.join(__dirname, 'migrations')
    const migrationNames = (await fs.readdir(migrationsDirectory))
      .filter((name) => /^\d+_.+\.sql$/i.test(name))
      .sort((left, right) => left.localeCompare(right, 'en'))
    for (const migrationName of migrationNames) {
      const sql = await fs.readFile(path.join(migrationsDirectory, migrationName), 'utf8')
      await pool.query(sql)
    }
    console.log(JSON.stringify({
      ok: true,
      database: process.env.PG_V3_DATABASE || 'nanjing_uni_grid_v3_test',
      migrations: migrationNames,
    }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
