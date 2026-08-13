const crypto = require('crypto')

const ROLES = Object.freeze({
  STUDENT: 'student',
  SCHOOL: 'school',
  OPERATOR: 'operator',
})

const ROLE_LABELS = Object.freeze({
  [ROLES.STUDENT]: '师生端',
  [ROLES.SCHOOL]: '校方端',
  [ROLES.OPERATOR]: '运营端',
})

const SESSION_TTL_MS = positiveInteger(process.env.AUTH_SESSION_TTL_HOURS, 8) * 60 * 60 * 1000
const FAILURE_WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const sessions = new Map()
const loginFailures = new Map()

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function demoUsersEnabled() {
  if (process.env.NODE_ENV === 'production') return false
  return process.env.AUTH_ALLOW_DEMO_USERS !== 'false'
}

function configuredUsers() {
  const definitions = [
    {
      id: process.env.AUTH_STUDENT_ID || 'student-wanli',
      username: process.env.AUTH_STUDENT_USERNAME || 'student',
      password: process.env.AUTH_STUDENT_PASSWORD || (demoUsersEnabled() ? 'Student@2026' : ''),
      demoPassword: !process.env.AUTH_STUDENT_PASSWORD && demoUsersEnabled() ? 'Student@2026' : null,
      role: ROLES.STUDENT,
      name: process.env.AUTH_STUDENT_NAME || '万理',
      department: process.env.AUTH_STUDENT_DEPARTMENT || '南京大学师生',
    },
    {
      id: process.env.AUTH_SCHOOL_ID || 'school-reviewer',
      username: process.env.AUTH_SCHOOL_USERNAME || 'school',
      password: process.env.AUTH_SCHOOL_PASSWORD || (demoUsersEnabled() ? 'School@2026' : ''),
      demoPassword: !process.env.AUTH_SCHOOL_PASSWORD && demoUsersEnabled() ? 'School@2026' : null,
      role: ROLES.SCHOOL,
      name: process.env.AUTH_SCHOOL_NAME || '校方审核员',
      department: process.env.AUTH_SCHOOL_DEPARTMENT || '校园管理部门',
    },
    {
      id: process.env.AUTH_OPERATOR_ID || 'operator-dispatcher',
      username: process.env.AUTH_OPERATOR_USERNAME || 'operator',
      password: process.env.AUTH_OPERATOR_PASSWORD || (demoUsersEnabled() ? 'Operator@2026' : ''),
      demoPassword: !process.env.AUTH_OPERATOR_PASSWORD && demoUsersEnabled() ? 'Operator@2026' : null,
      role: ROLES.OPERATOR,
      name: process.env.AUTH_OPERATOR_NAME || '运营调度员',
      department: process.env.AUTH_OPERATOR_DEPARTMENT || 'SkyNest运营中心',
    },
  ]

  return definitions
    .filter((user) => user.password)
    .map((user) => {
      const username = String(user.username).trim().toLowerCase()
      const salt = `skynest-auth:${username}`
      return {
        ...user,
        username,
        passwordHash: crypto.scryptSync(String(user.password), salt, 64),
        password: undefined,
      }
    })
}

const users = configuredUsers()

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    role_label: ROLE_LABELS[user.role] || user.role,
    name: user.name,
    department: user.department,
  }
}

function clientKey(req, username = '') {
  return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${String(username).toLowerCase()}`
}

function currentFailures(key) {
  const record = loginFailures.get(key)
  if (!record || Date.now() - record.startedAt > FAILURE_WINDOW_MS) {
    loginFailures.delete(key)
    return 0
  }
  return record.count
}

function recordFailure(key) {
  const count = currentFailures(key)
  loginFailures.set(key, {
    count: count + 1,
    startedAt: count ? loginFailures.get(key).startedAt : Date.now(),
  })
}

function safePasswordMatch(user, password) {
  const candidate = crypto.scryptSync(String(password || ''), `skynest-auth:${user?.username || 'unknown'}`, 64)
  const expected = user?.passwordHash || crypto.scryptSync('invalid-password', 'skynest-auth:unknown', 64)
  return crypto.timingSafeEqual(candidate, expected)
}

function login(req, usernameValue, password) {
  const username = String(usernameValue || '').trim().toLowerCase()
  const key = clientKey(req, username)
  if (currentFailures(key) >= MAX_FAILURES) {
    const error = new Error('登录尝试过多，请15分钟后重试')
    error.code = 'AUTH_RATE_LIMITED'
    error.status = 429
    throw error
  }

  const user = users.find((item) => item.username === username)
  const passwordMatches = safePasswordMatch(user, password)
  if (!user || !passwordMatches) {
    recordFailure(key)
    const error = new Error('账号或密码错误')
    error.code = 'INVALID_CREDENTIALS'
    error.status = 401
    throw error
  }

  loginFailures.delete(key)
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + SESSION_TTL_MS
  sessions.set(token, { user, expiresAt })
  return {
    token,
    expires_at: new Date(expiresAt).toISOString(),
    user: publicUser(user),
  }
}

function extractToken(req) {
  const authorization = String(req.headers.authorization || '')
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || ''
}

function authenticate(req, res, next) {
  const token = extractToken(req)
  const session = sessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token)
    return res.status(401).json({
      error: 'authentication_required',
      detail: '登录状态已失效，请重新登录',
    })
  }
  req.auth = { token, user: publicUser(session.user) }
  return next()
}

function requireRoles(...roles) {
  const allowed = new Set(roles.flat())
  return (req, res, next) => {
    if (!req.auth?.user || !allowed.has(req.auth.user.role)) {
      return res.status(403).json({
        error: 'permission_denied',
        detail: '当前账号没有执行此操作的权限',
        required_roles: [...allowed],
      })
    }
    return next()
  }
}

function logout(req) {
  if (req.auth?.token) sessions.delete(req.auth.token)
}

function getLoginOptions() {
  return {
    demo_mode: demoUsersEnabled(),
    roles: users.map((user) => ({
      username: user.username,
      role: user.role,
      role_label: ROLE_LABELS[user.role],
      demo_password: user.demoPassword,
    })),
  }
}

function isTaskOwner(user, task) {
  return user?.role === ROLES.STUDENT && String(task?.requester?.id || '') === String(user.id)
}

module.exports = {
  ROLES,
  authenticate,
  requireRoles,
  login,
  logout,
  getLoginOptions,
  isTaskOwner,
}
