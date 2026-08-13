require('dotenv').config()

const assert = require('node:assert/strict')
const authService = require('./lib/authService')
const taskWorkflowStore = require('./lib/taskWorkflowStore')

function mockRequest(ip = '127.0.0.1') {
  return { ip, headers: {}, socket: { remoteAddress: ip } }
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
  }
}

function authenticate(token) {
  const req = mockRequest()
  req.headers.authorization = `Bearer ${token}`
  const res = mockResponse()
  let nextCalled = false
  authService.authenticate(req, res, () => { nextCalled = true })
  return { req, res, nextCalled }
}

async function main() {
  const options = authService.getLoginOptions()
  assert.deepEqual(options.roles.map((item) => item.role), ['student', 'school', 'operator'])
  const studentAccount = options.roles.find((item) => item.role === 'student')
  const schoolAccount = options.roles.find((item) => item.role === 'school')
  assert.ok(studentAccount.demo_password && schoolAccount.demo_password)

  const student = authService.login(mockRequest('127.0.0.2'), studentAccount.username, studentAccount.demo_password)
  const school = authService.login(mockRequest('127.0.0.3'), schoolAccount.username, schoolAccount.demo_password)
  assert.equal(student.user.role, 'student')
  assert.equal(school.user.role, 'school')

  const valid = authenticate(student.token)
  assert.equal(valid.nextCalled, true)
  assert.equal(valid.req.auth.user.id, student.user.id)

  const missingRes = mockResponse()
  authService.authenticate(mockRequest(), missingRes, () => {})
  assert.equal(missingRes.statusCode, 401)

  const forbiddenRes = mockResponse()
  let forbiddenNext = false
  authService.requireRoles('school')(valid.req, forbiddenRes, () => { forbiddenNext = true })
  assert.equal(forbiddenRes.statusCode, 403)
  assert.equal(forbiddenNext, false)

  const client = await taskWorkflowStore._pool.connect()
  try {
    await client.query('BEGIN')
    const task = await taskWorkflowStore.createTask({
      requester: { id: student.user.id, name: student.user.name, department: student.user.department },
      origin: '图书馆', destination: '行政楼', item_category: '文件图书', weight_kg: 0.5,
      deadline: new Date(Date.now() + 2 * 3600000).toISOString(),
      special_requirements: [], candidate_node_ids: [], missing_fields: [],
    }, { client })
    const owned = await taskWorkflowStore.listWorkspace({ requesterId: student.user.id, client })
    const foreign = await taskWorkflowStore.listWorkspace({ requesterId: 'another-student', client })
    assert.ok(owned.some((item) => item.task.id === task.id))
    assert.ok(!foreign.some((item) => item.task.id === task.id))
    await client.query('ROLLBACK')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }

  authService.logout(valid.req)
  assert.equal(authenticate(student.token).res.statusCode, 401)

  console.log(JSON.stringify({
    ok: true,
    roles: options.roles.map((item) => item.role),
    authentication_required: true,
    role_permission_denied: true,
    student_workspace_isolated: true,
    logout_invalidates_session: true,
    transaction_rolled_back: true,
    persisted_test_rows: 0,
  }, null, 2))
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
}).finally(() => taskWorkflowStore.close())
