function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}

function optionalPassword(value) {
  const password = String(value || '')
  return password || undefined
}

function getLegacyDatabaseConfig(overrides = {}) {
  return {
    host: process.env.PG_HOST || 'localhost',
    port: positiveInteger(process.env.PG_PORT, 5432, 65535),
    user: process.env.PG_USER || 'postgres',
    password: optionalPassword(process.env.PG_PASSWORD),
    database: process.env.PG_DATABASE || 'nanjing_uni_grid_score',
    ...overrides,
  }
}

function getV3DatabaseConfig(overrides = {}) {
  return {
    host: process.env.PG_V3_HOST || process.env.PG_HOST || 'localhost',
    port: positiveInteger(process.env.PG_V3_PORT || process.env.PG_PORT, 5432, 65535),
    user: process.env.PG_V3_USER || process.env.PG_USER || 'postgres',
    password: optionalPassword(process.env.PG_V3_PASSWORD || process.env.PG_PASSWORD),
    database: process.env.PG_V3_DATABASE || 'nanjing_uni_grid_v3_test',
    ...overrides,
  }
}

module.exports = { positiveInteger, getLegacyDatabaseConfig, getV3DatabaseConfig }
