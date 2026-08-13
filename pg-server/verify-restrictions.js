require('dotenv').config()

const assert = require('node:assert/strict')
const restrictionStore = require('./lib/restrictionStore')

async function main() {
  assert.throws(
    () => restrictionStore.validateRestriction({}),
    /center\.lng/,
    'missing center should be rejected'
  )
  assert.throws(
    () => restrictionStore.validateRestriction({
      name: 'invalid radius',
      reason: 'test',
      center: { lng: 118.9479, lat: 32.1101 },
      radius_m: 20,
      start_at: new Date().toISOString(),
      end_at: new Date(Date.now() + 3600000).toISOString(),
    }),
    /between 50 and 2000/,
    'unsafe radius should be rejected'
  )

  const client = await restrictionStore._pool.connect()
  let initialCount = 0
  try {
    initialCount = Number((await client.query('SELECT COUNT(*) AS count FROM runtime.no_fly_zones')).rows[0].count)
    await client.query('BEGIN')
    const startAt = new Date()
    const created = await restrictionStore.createRestriction({
      name: 'Codex事务自测限制区',
      reason: '接口增删改查自测，事务结束后回滚',
      center: { lng: 118.9479, lat: 32.1101 },
      radius_m: 150,
      start_at: startAt.toISOString(),
      end_at: new Date(startAt.getTime() + 4 * 3600000).toISOString(),
      created_by: { name: '自动测试', department: '项目组' },
    }, { client })

    assert.equal(created.name, 'Codex事务自测限制区')
    assert.equal(created.status, 'active')
    assert.ok(Math.abs(created.center.lng - 118.9479) < 0.00002)
    assert.ok(Math.abs(created.center.lat - 32.1101) < 0.00002)
    assert.ok(Math.abs(created.radius_m - 150) <= 2)

    const listed = await restrictionStore.listRestrictions({ client })
    assert.ok(listed.some((item) => item.id === created.id), 'created restriction should be listed')

    const disabled = await restrictionStore.setRestrictionActive(created.id, false, { client })
    assert.equal(disabled.status, 'inactive')
    const enabled = await restrictionStore.setRestrictionActive(created.id, true, { client })
    assert.equal(enabled.status, 'active')

    const workspace = await restrictionStore.getSafetyWorkspace({ client })
    assert.equal(workspace.source, 'v3')
    assert.ok(workspace.restrictions.some((item) => item.id === created.id))
    assert.ok(Array.isArray(workspace.active_tasks))
    assert.ok(Array.isArray(workspace.recent_replans))

    const cancelled = await restrictionStore.cancelRestriction(created.id, { client })
    assert.equal(cancelled.status, 'inactive')
    await client.query('ROLLBACK')

    const finalCount = Number((await client.query('SELECT COUNT(*) AS count FROM runtime.no_fly_zones')).rows[0].count)
    assert.equal(finalCount, initialCount, 'transaction test must not leave restriction rows behind')
    console.log(JSON.stringify({
      ok: true,
      database: process.env.PG_V3_DATABASE || 'nanjing_uni_grid_v3_test',
      tested: ['validation', 'create', 'read', 'disable', 'enable', 'cancel', 'workspace'],
      persisted_test_rows: finalCount - initialCount,
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
    await restrictionStore.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
