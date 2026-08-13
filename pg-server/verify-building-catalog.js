require('dotenv').config()

const assert = require('node:assert/strict')
const { Pool } = require('pg')
const { getV3DatabaseConfig } = require('./lib/databaseConfig')
const v3Database = require('./lib/v3Database')

const pool = new Pool(getV3DatabaseConfig({
  options: '-c default_transaction_read_only=on',
  application_name: 'skynest-building-catalog-verification',
}))

async function main() {
  try {
    const summary = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM static.buildings)::integer AS buildings,
        (SELECT COUNT(*) FROM static.fixed_nodes)::integer AS fixed_nodes,
        (SELECT COUNT(*) FROM static.building_node_distance)::integer AS matrix_rows,
        (
          SELECT COUNT(*)
          FROM (
            SELECT building_name
            FROM static.building_node_distance
            GROUP BY building_name
            HAVING COUNT(*) <> 13
          ) invalid
        )::integer AS invalid_matrix_buildings,
        (
          SELECT COUNT(*)
          FROM static.building_node_distance d
          LEFT JOIN static.buildings b ON b.building_name = d.building_name
          WHERE b.building_id IS NULL
        )::integer AS unmatched_names
    `)
    assert.deepEqual(summary.rows[0], {
      buildings: 83,
      fixed_nodes: 13,
      matrix_rows: 1079,
      invalid_matrix_buildings: 0,
      unmatched_names: 0,
    })

    const buildings = await v3Database.listBuildings({ limit: 100 })
    assert.equal(buildings.length, 83)
    assert.ok(buildings.every((building) => (
      Number.isFinite(Number(building.location?.lng)) &&
      Number.isFinite(Number(building.location?.lat)) &&
      Number.isFinite(building.source_lng) &&
      Number.isFinite(building.source_lat) &&
      Math.abs(building.location.lng - building.source_lng) < 0.0000001 &&
      Math.abs(building.location.lat - building.source_lat) < 0.0000001 &&
      Number.isFinite(building.altitude_m) &&
      Number.isInteger(building.merged_count) &&
      building.source_crs === 'EPSG:4326' &&
      building.altitude_is_placeholder === true
    )))

    const fixedNodes = await v3Database.listFixedNodes({ limit: 100 })
    assert.equal(fixedNodes.length, 13)
    assert.deepEqual(
      fixedNodes.map((node) => node.node_code).sort(),
      ['hub', 'a', 'b', 'c', 'd', 'e', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].sort(),
    )
    assert.equal(fixedNodes.filter((node) => node.node_code === 'hub').length, 1)
    assert.equal(fixedNodes.filter((node) => /^[a-e]$/.test(node.node_code)).length, 5)
    assert.equal(fixedNodes.filter((node) => /^[A-G]$/.test(node.node_code)).length, 7)
    assert.ok(fixedNodes.every((node) => (
      Number.isFinite(Number(node.location?.lng))
      && Number.isFinite(Number(node.location?.lat))
      && (node.node_code === 'hub' || /^[a-e]$/.test(node.node_code)
        ? node.service_group === 'departure'
        : node.service_group === 'receiving')
    )))

    const search = await v3Database.searchBuildings('图书馆')
    assert.equal(search[0]?.building_name, '杜厦图书馆')

    const access = await v3Database.getBuildingAccessPoints('环境学院', { limitPerGroup: 3 })
    assert.equal(access.building.building_name, '环境学院')
    assert.equal(access.departure_nodes.length, 3)
    assert.equal(access.receiving_nodes.length, 3)
    assert.ok(access.departure_nodes.every((node, index, nodes) => (
      index === 0 || Number(nodes[index - 1].distance_m) <= Number(node.distance_m)
    )))
    assert.ok(access.receiving_nodes.every((node, index, nodes) => (
      index === 0 || Number(nodes[index - 1].distance_m) <= Number(node.distance_m)
    )))

    const constraints = await pool.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'static.building_node_distance'::regclass
    `)
    assert.ok(
      constraints.rows.some((row) => row.conname === 'building_node_distance_building_name_fkey'),
      'The distance matrix must reference the official building catalog'
    )

    console.log(JSON.stringify({
      ok: true,
      ...summary.rows[0],
      search_result: search[0].building_name,
      environment_college: {
        nearest_departure: access.departure_nodes[0].node_code,
        nearest_receiving: access.receiving_nodes[0].node_code,
      },
      node_levels: { l1: 1, l2: 5, l3: 7 },
      referential_integrity: true,
    }, null, 2))
  } finally {
    await v3Database.close()
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
