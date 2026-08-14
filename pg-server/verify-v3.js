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
    const buildingTable = tables.find((table) => table.schema === 'static' && table.table === 'buildings')
    assert.ok(gridTable, 'static.grid_3d is missing')
    assert.ok(buildingTable, 'static.buildings is missing')
    assert.ok(gridTable.estimated_rows >= 2000000, 'static.grid_3d row estimate is unexpectedly low')

    const nodes = await v3Database.listFixedNodes({ limit: 100 })
    const buildings = await v3Database.listBuildings({ limit: 100 })
    const librarySearch = await v3Database.searchBuildings('图书馆')
    const libraryAccess = await v3Database.getBuildingAccessPoints('杜厦图书馆', { limitPerGroup: 3 })
    const libraryDistances = await v3Database.listBuildingNearestNodes('杜厦图书馆', { limit: 13 })
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

    assert.equal(nodes.length, 13, 'Expected exactly 13 fixed nodes')
    assert.equal(buildings.length, 83, 'Expected exactly 83 official buildings')
    assert.equal(librarySearch[0]?.building_name, '杜厦图书馆', 'Building search did not find the official library')
    assert.equal(libraryDistances.nodes.length, 13, 'A building must have distances to all 13 fixed nodes')
    assert.equal(libraryAccess.departure_nodes.length, 3, 'Departure-node ranking is incomplete')
    assert.equal(libraryAccess.receiving_nodes.length, 3, 'Receiving-node ranking is incomplete')
    assert.ok(
      libraryAccess.departure_nodes.every((node) => node.service_group === 'departure'),
      'Departure ranking returned a receiving node'
    )
    assert.ok(
      libraryAccess.receiving_nodes.every((node) => node.service_group === 'receiving'),
      'Receiving ranking returned a departure node'
    )
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
          official_buildings: buildings.length,
          building_node_distances: libraryDistances.nodes.length,
          nearest_departure_node: libraryAccess.departure_nodes[0]?.node_code,
          nearest_receiving_node: libraryAccess.receiving_nodes[0]?.node_code,
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
