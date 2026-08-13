require('dotenv').config()

const assert = require('node:assert/strict')
const v3Database = require('./lib/v3Database')

async function main() {
  try {
    const status = await v3Database.getStatus()
    assert.equal(status.ok, true, 'V3 database structure is incomplete')
    assert.equal(status.read_only, true, 'V3 adapter should be read-only during integration')
    assert.equal(
      status.database,
      process.env.PG_V3_DATABASE || v3Database.DEFAULT_DATABASE,
      'Connected to an unexpected database'
    )

    const tables = await v3Database.getSummary()
    const gridTable = tables.find((table) => table.schema === 'static' && table.table === 'grid_3d')
    assert.ok(gridTable, 'static.grid_3d is missing')
    assert.ok(gridTable.estimated_rows >= 2000000, 'static.grid_3d row estimate is unexpectedly low')

    const nodes = await v3Database.listFixedNodes({ limit: 100 })
    const drones = await v3Database.listDrones({ limit: 100 })
    const rules = await v3Database.listVehicleRules({ itemCategory: '食品饮料', weightKg: 2 })
    const grids = await v3Database.listGridCells({
      xMin: 118.9566,
      xMax: 118.9569,
      yMin: 32.1116,
      yMax: 32.112,
      zMin: 0,
      zMax: 200,
      limit: 5,
    })

    assert.ok(nodes.length > 0, 'No fixed nodes were returned')
    assert.ok(drones.length > 0, 'No drones were returned')
    assert.ok(rules.length > 0, 'No matching vehicle rule was returned')
    assert.ok(grids.length > 0, 'No grid cells were returned for the campus test bbox')

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: status.database,
          postgis: status.postgis_version,
          business_tables: tables.length,
          estimated_grid_rows: gridTable.estimated_rows,
          fixed_nodes: nodes.length,
          drones: drones.length,
          matching_vehicle_rules: rules.length,
          sample_grid_cells: grids.length,
        },
        null,
        2
      )
    )
  } finally {
    await v3Database.close()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
