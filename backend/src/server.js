// backend/src/server.js
require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const helmet    = require('helmet')
const rateLimit = require('express-rate-limit')

// ─── ROUTES ───────────────────────────────────────────────────────────────────
const authMiddleware  = require('./middleware/auth')
const episodeRoutes   = require('./routes/episodes')
const vaultRoutes     = require('./routes/vault')
const analyticsRoutes = require('./routes/analytics')
const billingRoutes   = require('./routes/billing')
const seriesRoutes    = require('./routes/series')
const categoryRoutes  = require('./routes/categories')
const chatRoutes      = require('./routes/chat')
const refreshRoutes   = require('./routes/refresh')
const collabRoutes    = require('./routes/collab')
const userRoutes      = require('./routes/users')
const adminRoutes     = require('./routes/admin')
const dashboardRoutes = require('./routes/dashboard')
const shortsRoutes    = require('./routes/shorts')
const pushRoutes      = require('./routes/push')
const editorRoutes    = require('./routes/editor')
const sessionRoutes   = require('./routes/session')
const soundRoutes     = require('./routes/sound')

const { startSmartScheduler } = require('./services/smartScheduler')

const app  = express()

// Railway sits behind a proxy — tell Express to trust X-Forwarded-For headers
app.set('trust proxy', 1)
const PORT = process.env.PORT || 3001

// ─── MIDDLEWARE ────────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }))
// Build allowed origins list — always include the production domain
const ALLOWED_ORIGINS = [
  'https://whispacuts.com',
  'https://www.whispacuts.com',
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
    // Allow any subdomain of whispacuts.com
    if (/^https?:\/\/([a-z0-9-]+\.)?whispacuts\.com$/.test(origin)) return callback(null, true)
    // Allow Railway preview URLs
    if (/\.railway\.app$/.test(origin)) return callback(null, true)
    // Allow Netlify preview URLs
    if (/\.netlify\.app$/.test(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials:    true,
  methods:        ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Request timeout — SSE routes and session processing exempt
app.use((req, res, next) => {
  const isSSE        = req.path.endsWith('/generate') || req.path.endsWith('/message')
  const isProcess    = req.path.includes('/process')
  const isTranscribe = req.path.includes('/transcribe')
  if (isSSE || isProcess || isTranscribe) return next()
  const t = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ error: 'Request timed out — try again' })
  }, 30000)
  res.on('finish', () => clearTimeout(t))
  res.on('close',  () => clearTimeout(t))
  next()
})

// ─── RATE LIMITING ─────────────────────────────────────────────────────────────

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests — slow down.' },
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
// All registered BEFORE app.listen() — Express requires this

app.use('/api/users',      userRoutes)
app.use('/api/admin',      authMiddleware, adminRoutes)
app.use('/api/dashboard',  authMiddleware, dashboardRoutes)
app.use('/api/shorts',     authMiddleware, shortsRoutes)
app.use('/api/push',       authMiddleware, pushRoutes)
app.use('/api/categories', authMiddleware, categoryRoutes)
app.use('/api/episodes',   authMiddleware, episodeRoutes)
app.use('/api/vault',      authMiddleware, vaultRoutes)
// YouTube connect needs token via query param (browser redirect) — auth handled inside route
app.use('/api/analytics',  authMiddleware, analyticsRoutes)
app.use('/api/billing/webhook', billingRoutes)  // webhook before auth — PayPal sends no token
app.use('/api/billing',    authMiddleware, billingRoutes)
app.use('/api/series',     authMiddleware, seriesRoutes)
app.use('/api/chat',       authMiddleware, chatRoutes)
app.use('/api/refresh',    authMiddleware, refreshRoutes)
app.use('/api/collab',     authMiddleware, collabRoutes)
app.use('/api/editor',     authMiddleware, editorRoutes)
app.use('/api/session',    authMiddleware, sessionRoutes)
app.use('/api/sound',      authMiddleware, soundRoutes)

app.get('/api/ping', authMiddleware, (req, res) => {
  res.json({ pong: true, ts: new Date().toISOString() })
})

// Test webhook — sends a test notification to configured Discord/Slack webhook
app.post('/api/test-webhook', authMiddleware, async (req, res) => {
  const url = process.env.DISCORD_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL
  if (!url) return res.status(400).json({ error: 'No webhook URL configured in .env (DISCORD_WEBHOOK_URL or SLACK_WEBHOOK_URL)' })
  try {
    const body = process.env.DISCORD_WEBHOOK_URL
      ? JSON.stringify({ content: '✅ WhispaCuts webhook test — notifications are working.' })
      : JSON.stringify({ text:    '✅ WhispaCuts webhook test — notifications are working.' })
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
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .catch(() => {})
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

  // Allow long-running requests (Claude memo generation can take 30-60s)
  server.timeout = 180000          // 3 min socket timeout
  server.keepAliveTimeout = 65000  // slightly above Railway's 60s idle timeout
  startSmartScheduler()

  // Configure VAPID push notifications
  const pushService = require('./services/pushService')
  pushService.configure()

  // Start background scheduler (weekly analytics pull, cadence reminders)
  const schedulerService = require('./services/schedulerService')
  schedulerService.start()
})

// Graceful shutdown — drain SSE streams before Railway's 30s kill
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM — draining connections...')
  server.close(() => { console.log('[server] Clean exit'); process.exit(0) })
  setTimeout(() => process.exit(0), 25000)
})
process.on('SIGINT', () => process.emit('SIGTERM'))

module.exports = app