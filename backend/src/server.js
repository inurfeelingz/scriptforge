// backend/src/server.js
require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const helmet    = require('helmet')
const rateLimit = require('express-rate-limit')

// ─── ROUTES ───────────────────────────────────────────────────────────────────
const authMiddleware        = require('./middleware/auth')
const episodeRoutes         = require('./routes/episodes')
const vaultRoutes           = require('./routes/vault')
const analyticsRoutes       = require('./routes/analytics')
const billingRoutes         = require('./routes/billing')
const seriesRoutes          = require('./routes/series')
const categoryRoutes        = require('./routes/categories')
const storyboardRoutes      = require('./routes/storyboard')
const chatRoutes            = require('./routes/chat')
const refreshRoutes         = require('./routes/refresh')
const collabRoutes          = require('./routes/collab')
const userRoutes            = require('./routes/users')
const adminRoutes           = require('./routes/admin')
const dashboardRoutes       = require('./routes/dashboard')
const shortsRoutes          = require('./routes/shorts')
const pushRoutes            = require('./routes/push')
const editorRoutes          = require('./routes/editor')
const sessionRoutes         = require('./routes/session')
const soundRoutes           = require('./routes/sound')
const creditRoutes          = require('./routes/credits')
const episodeCommentsRoutes = require('./routes/episodeComments')
const publicRoutes          = require('./routes/public')
const kbRoutes              = require('./routes/kb')

const { startSmartScheduler } = require('./services/smartScheduler')

const app  = express()
app.set('trust proxy', 1)
const PORT = process.env.PORT || 3001

// ─── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://whispacuts.com',
  'https://www.whispacuts.com',
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean)

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    if (/^https?:\/\/([a-z0-9-]+\.)?whispacuts\.com$/.test(origin)) return callback(null, true)
    if (/\.railway\.app$/.test(origin)) return callback(null, true)
    if (/\.netlify\.app$/.test(origin)) return callback(null, true)
    callback(null, false)
  },
  credentials:    true,
  methods:        ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

app.use((req, res, next) => {
  const isSSE        = req.path.endsWith('/generate') || req.path.endsWith('/message')
  const isProcess    = req.path.includes('/process')
  const isTranscribe = req.path.includes('/transcribe')
  const isOAuth      = req.path.includes('/youtube/connect') || req.path.includes('/youtube/callback')
  if (isSSE || isProcess || isTranscribe || isOAuth) return next()
  const t = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ error: 'Request timed out' })
  }, 30000)
  res.on('finish', () => clearTimeout(t))
  res.on('close',  () => clearTimeout(t))
  next()
})

// ─── RATE LIMITING ─────────────────────────────────────────────────────────────

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests.' },
}))

app.use('/api/episodes/generate', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Generation rate limit reached. Try again in an hour.' },
}))

app.use('/api/users/invite', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many invite attempts.' },
}))

app.use('/api/sound', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: 'Upload rate limit reached.' },
}))

// ─── HEALTH ────────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── API ROUTES ────────────────────────────────────────────────────────────────

app.use('/api/users',      userRoutes)
app.use('/api/admin',      authMiddleware, adminRoutes)
app.use('/api/credits',    authMiddleware, creditRoutes)
app.use('/api/dashboard',  authMiddleware, dashboardRoutes)
app.use('/api/shorts',     authMiddleware, shortsRoutes)
app.use('/api/push',       authMiddleware, pushRoutes)
app.use('/api/categories', authMiddleware, categoryRoutes)
app.use('/api/episodes',   authMiddleware, episodeRoutes)
app.use('/api/vault',      authMiddleware, vaultRoutes)

// YouTube OAuth routes are public (no auth header possible on browser redirects).
// Mount the WHOLE analytics router once — but skip authMiddleware for the three
// public OAuth paths. This avoids double-mounting the router which caused
// req.user to be undefined when the auth-protected catch-all re-ran the same handler.
const analyticsAuthMiddleware = (req, res, next) => {
  const pub = ['/youtube/callback', '/youtube/connect', '/youtube/debug']
  if (pub.some(p => req.path === p)) return next()
  return authMiddleware(req, res, next)
}
app.use('/api/analytics', analyticsAuthMiddleware, analyticsRoutes)

app.use('/api/billing/webhook', billingRoutes)  // PayPal webhook — no auth token
app.use('/api/billing',         authMiddleware, billingRoutes)
app.use('/api/series',          authMiddleware, seriesRoutes)
app.use('/api/chat',            authMiddleware, chatRoutes)
app.use('/api/storyboard',      authMiddleware, storyboardRoutes)
app.use('/api/refresh',         authMiddleware, refreshRoutes)
app.use('/api/collab',          authMiddleware, collabRoutes)
app.use('/api/editor',          authMiddleware, editorRoutes)
app.use('/api/session',         authMiddleware, sessionRoutes)
app.use('/api/sound',           authMiddleware, soundRoutes)
app.use('/api/episode-comments', episodeCommentsRoutes)
app.use('/api/kb',               authMiddleware, kbRoutes)
app.use('/api/public',           publicRoutes)  // No auth — public endpoints

app.get('/api/ping', authMiddleware, (req, res) => {
  res.json({ pong: true, ts: new Date().toISOString() })
})

app.post('/api/test-webhook', authMiddleware, async (req, res) => {
  const url = process.env.DISCORD_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  if (!url) return res.status(400).json({ error: 'No webhook URL configured' })
  try {
    const body = process.env.DISCORD_WEBHOOK_URL
      ? JSON.stringify({ content: 'WhispaCuts webhook test — working.' })
      : JSON.stringify({ text:    'WhispaCuts webhook test — working.' })
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    if (!r.ok) throw new Error(`Webhook returned ${r.status}`)
    res.json({ sent: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── ERROR LOGGING ─────────────────────────────────────────────────────────────

async function logError(context, err, extra = {}) {
  const msg = `[${context}] ${err?.message || err}`
  console.error(msg, extra)
  const url = process.env.DISCORD_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  if (!url) return
  try {
    const body = process.env.DISCORD_WEBHOOK_URL
      ? JSON.stringify({ content: `\`\`\`\n${msg}\n${JSON.stringify(extra)}\n\`\`\`` })
      : JSON.stringify({ text: `${msg}\n${JSON.stringify(extra)}` })
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {})
  } catch {}
}

module.exports.logError = logError

// ─── GLOBAL ERROR HANDLER ──────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  logError('server', err, { path: req.path, method: req.method })
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  })
})

// ─── START ─────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n WhispaCuts API  port ${PORT}  env ${process.env.NODE_ENV}`)
  console.log(` Frontend: ${process.env.FRONTEND_URL}\n`)

  server.timeout        = 180000
  server.keepAliveTimeout = 65000

  startSmartScheduler()

  const pushService = require('./services/pushService')
  pushService.configure()

  try {
    const schedulerService = require('./services/schedulerService')
    schedulerService.start()
  } catch {}
})

// ─── PROCESS SAFETY ────────────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason)
  console.error('[server] Unhandled rejection:', msg)
  if (msg.includes('credit balance')) {
    console.error('[server] Anthropic API credits exhausted')
  }
})

process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.message)
  if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
    process.exit(1)
  }
})

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM — draining connections...')
  server.close(() => {
    console.log('[server] Clean exit')
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 25000)
})

process.on('SIGINT', () => process.emit('SIGTERM'))

module.exports = app