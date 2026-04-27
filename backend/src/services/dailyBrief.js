// backend/src/services/dailyBrief.js
// Generates the "what to work on today" AI directive shown at the top of Dashboard.
// Cached per user+category for 4 hours — fast on repeat loads, fresh each session.
// Called via GET /api/dashboard/brief

const Anthropic  = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')

const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── In-memory cache (4 hours) ─────────────────────────────────────────────────
const briefCache = new Map()
const BRIEF_TTL  = 4 * 60 * 60 * 1000  // 4 hours

function getCachedBrief(key) {
  const entry = briefCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > BRIEF_TTL) { briefCache.delete(key); return null }
  return entry.value
}

function setCachedBrief(key, value) {
  briefCache.set(key, { value, ts: Date.now() })
  if (briefCache.size > 200) {
    const oldest = [...briefCache.entries()].sort((a,b) => a[1].ts - b[1].ts)[0]
    briefCache.delete(oldest[0])
  }
}

function invalidateBrief(userId, categoryId) {
  briefCache.delete(`${userId}:${categoryId}`)
}

// ── Main generator ────────────────────────────────────────────────────────────

async function generateDailyBrief(userId, categoryId) {
  const cacheKey = `${userId}:${categoryId}`
  const cached   = getCachedBrief(cacheKey)
  if (cached) return { ...cached, fromCache: true }

  // Pull all the signals we need in parallel
  const [
    category,
    pipeline,
    vaultRecs,
    analyticsInsight,
    seriesGap,
  ] = await Promise.all([
    getCategory(userId, categoryId),
    getPipelineState(userId, categoryId),
    getTopVaultRec(userId, categoryId),
    getLatestAnalyticsInsight(userId, categoryId),
    getSeriesGap(userId, categoryId),
  ])

  if (!category) {
    return { directive: 'Set up your first workspace to get started.', action: null, fromCache: false }
  }

  // Build a tightly scoped prompt — no streaming needed, just one sharp sentence
  const contextLines = [
    `Creator niche: ${category.niche}`,
    `Series: ${category.name}`,
    pipeline.readyToRecord   ? `Episode ${pipeline.readyToRecord.episode_number} ("${pipeline.readyToRecord.track_name}") is generated and ready to record` : null,
    pipeline.readyToEdit     ? `Episode ${pipeline.readyToEdit.episode_number} ("${pipeline.readyToEdit.track_name}") is recorded and ready to edit` : null,
    pipeline.readyToPublish  ? `Episode ${pipeline.readyToPublish.episode_number} ("${pipeline.readyToPublish.track_name}") is edited and ready to publish` : null,
    pipeline.nothingInFlight ? `No episodes currently in progress — nothing generated yet or all published` : null,
    pipeline.daysSinceLastPublish != null
      ? `Last published ${pipeline.daysSinceLastPublish} day${pipeline.daysSinceLastPublish !== 1 ? 's' : ''} ago`
      : null,
    vaultRecs   ? `Top unused vault idea: "${vaultRecs.title}"` : null,
    analyticsInsight ? `Latest analytics insight: ${analyticsInsight.slice(0, 150)}` : null,
    seriesGap   ? `Series gap: ${seriesGap}` : null,
  ].filter(Boolean).join('\n')

  const prompt = `You are the daily brief system for a solo content creator using WhispaCuts.

Current state:
${contextLines}

Write ONE sentence (max 25 words) telling the creator exactly what to work on right now.
Be direct and specific — name the episode, name the action, name the number.
Do not use "you should" or "consider" — use imperative: "Record", "Generate", "Publish".
Do not add explanation or context — just the action.

Then on a new line, write one of these exact action keywords that matches your directive:
RECORD | GENERATE | EDIT | PUBLISH | VAULT | ANALYTICS

Return nothing else.`

  let text = ''
  try {
    const response = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 80,
      messages:   [{ role: 'user', content: prompt }],
    })
    text = response.content[0]?.text?.trim() || ''
  } catch {
    // Fallback to a rule-based directive if Claude is unavailable
    text = buildFallbackDirective(pipeline, vaultRecs) + '\nGENERATE'
  }

  // Parse the two-line response
  const lines     = text.split('\n').map(l => l.trim()).filter(Boolean)
  const directive = lines[0] || 'Open Generate and start a new episode.'
  const actionRaw = (lines[1] || 'GENERATE').toUpperCase()
  const VALID_ACTIONS = ['RECORD', 'GENERATE', 'EDIT', 'PUBLISH', 'VAULT', 'ANALYTICS']
  const action    = VALID_ACTIONS.includes(actionRaw) ? actionRaw : 'GENERATE'

  // Map action to a route
  const ACTION_ROUTES = {
    RECORD:     '/teleprompter',
    GENERATE:   '/generate',
    EDIT:       '/editor',
    PUBLISH:    '/series',
    VAULT:      '/vault',
    ANALYTICS:  '/analytics',
  }

  const result = {
    directive,
    action,
    route:        ACTION_ROUTES[action],
    pipeline,
    generatedAt:  new Date().toISOString(),
    fromCache:    false,
  }

  setCachedBrief(cacheKey, result)
  return result
}

// ── Fallback (no Claude) ──────────────────────────────────────────────────────

function buildFallbackDirective(pipeline, vaultRec) {
  if (pipeline.readyToRecord)   return `Record episode ${pipeline.readyToRecord.episode_number} — "${pipeline.readyToRecord.track_name}" is ready.`
  if (pipeline.readyToEdit)     return `Edit episode ${pipeline.readyToEdit.episode_number} — recording is done.`
  if (pipeline.readyToPublish)  return `Publish episode ${pipeline.readyToPublish.episode_number} — it's ready to go live.`
  if (vaultRec)                 return `Generate a new episode using your vault idea: "${vaultRec.title}".`
  return 'Generate your next episode.'
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function getCategory(userId, categoryId) {
  const { data } = await supabase
    .from('categories')
    .select('name, niche')
    .eq('id', categoryId)
    .eq('user_id', userId)
    .single()
  return data
}

async function getPipelineState(userId, categoryId) {
  const { data: episodes } = await supabase
    .from('episodes')
    .select('id, episode_number, track_name, status, published_at, updated_at')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: false })
    .limit(20)

  const eps = episodes || []

  // Last published date
  const published    = eps.filter(e => e.status === 'published' && e.published_at)
  const lastPub      = published[0]?.published_at ? new Date(published[0].published_at) : null
  const daysSince    = lastPub ? Math.floor((Date.now() - lastPub.getTime()) / 86400000) : null

  return {
    readyToRecord:      eps.find(e => e.status === 'ready')      || null,
    readyToEdit:        eps.find(e => e.status === 'recorded')   || null,
    readyToPublish:     eps.find(e => e.status === 'edited')     || null,
    nothingInFlight:    eps.every(e => e.status === 'published' || e.status === 'draft'),
    daysSinceLastPublish: daysSince,
    all:                eps,
  }
}

async function getTopVaultRec(userId, categoryId) {
  const { data } = await supabase
    .from('vault_entries')
    .select('title, type')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('is_favourite', true)
    .is('used_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data
}

async function getLatestAnalyticsInsight(userId, categoryId) {
  const { data } = await supabase
    .from('analytics_uploads')
    .select('insights')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .not('insights', 'is', null)
    .order('upload_date', { ascending: false })
    .limit(1)
    .single()
  return data?.insights || null
}

async function getSeriesGap(userId, categoryId) {
  const { data } = await supabase
    .from('episodes')
    .select('episode_number, published_at')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(2)

  const eps = data || []
  if (eps.length < 2) return null

  const gap = new Date(eps[0].published_at) - new Date(eps[1].published_at)
  const days = Math.round(gap / 86400000)
  if (days > 14) return `${days} days between last two episodes — cadence is slipping`
  return null
}

module.exports = { generateDailyBrief, invalidateBrief }
