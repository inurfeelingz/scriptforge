// backend/src/routes/chat.js
// KB chat — streaming, persistent history, episode planning + commit

const express   = require('express');
const Anthropic  = require('@anthropic-ai/sdk');
const { assembleContext } = require('../services/contextAssembler');
const { supabase }        = require('../utils/supabase');

const router = express.Router();
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Context cache (90s per user+category+mode) ────────────────────────────────
const ctxCache = new Map()
const CTX_TTL  = 90 * 1000

function getCachedCtx(key) {
  const entry = ctxCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > CTX_TTL) { ctxCache.delete(key); return null }
  return entry.value
}
function setCachedCtx(key, value) {
  ctxCache.set(key, { value, ts: Date.now() })
  if (ctxCache.size > 50) {
    const oldest = [...ctxCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]
    ctxCache.delete(oldest[0])
  }
}

// ── Load + save history helpers ───────────────────────────────────────────────
async function saveHistory(userId, categoryId, mode, messages) {
  // Use a zero UUID as placeholder when no category selected
  // — Postgres NULL != NULL in unique constraints so we need a real value
  const catId = categoryId || '00000000-0000-0000-0000-000000000000'
  await supabase
    .from('chat_history')
    .upsert({
      user_id:     userId,
      category_id: catId,
      mode,
      messages,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'user_id,mode,category_id' })
}

async function loadHistory(userId, categoryId, mode) {
  const catId = categoryId || '00000000-0000-0000-0000-000000000000'
  const { data } = await supabase
    .from('chat_history')
    .select('messages, updated_at')
    .eq('user_id', userId)
    .eq('category_id', catId)
    .eq('mode', mode)
    .maybeSingle()
  return { messages: data?.messages || [], updatedAt: data?.updated_at }
}

// ── POST /api/chat/message ─────────────────────────────────────────────────────
router.post('/message', async (req, res) => {
  const { categoryId, mode = 'generate', message, episodeCtx, messages = [] } = req.body

  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' })

  // SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  // Keepalive ping every 15s to prevent Railway/proxy timeout
  const keepalive = setInterval(() => {
    res.write(': ping\n\n')
  }, 15000)

  try {
    // Load full history from DB (client sends recent slice, we want the full log)
    const { messages: dbHistory } = await loadHistory(req.user.id, categoryId, mode)

    // Assemble system context
    const ctxKey = episodeCtx ? null : `${req.user.id}:${categoryId}:${mode}`
    let systemContext = ctxKey ? getCachedCtx(ctxKey) : null
    if (!systemContext) {
      systemContext = await assembleContext(req.user.id, categoryId, { mode, episodeCtx })
      if (ctxKey) setCachedCtx(ctxKey, systemContext)
    }

    // Append any planned episodes KB is aware of
    const { data: planned } = await supabase
      .from('kb_planned_episodes')
      .select('episode_number, track_name, summary, themes, status')
      .eq('user_id', req.user.id)
      .eq('category_id', categoryId)
      .order('episode_number', { ascending: true })
      .limit(20)

    if (planned?.length) {
      systemContext += `\n\n## KB PLANNED EPISODES (you helped plan these)\n` +
        planned.map(e =>
          `Ep ${e.episode_number}: "${e.track_name}" [${e.status}]${e.summary ? ` — ${e.summary}` : ''}`
        ).join('\n')
    }

    // Build message list — use DB history as source of truth, keep last 30
    const historyForClaude = dbHistory
      .slice(-30)
      .map(m => ({ role: m.role, content: m.content }))

    const claudeMessages = [
      ...historyForClaude,
      { role: 'user', content: message },
    ]

    // Stream response
    let fullResponse = ''
    const stream = await client.messages.stream({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 2000,
      system:     systemContext,
      messages:   claudeMessages,
    })

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        fullResponse += chunk.delta.text
        send('chunk', { text: chunk.delta.text })
      }
    }

    // Persist full history
    if (categoryId) {
      const updatedHistory = [
        ...dbHistory,
        { role: 'user',      content: message,      timestamp: new Date().toISOString() },
        { role: 'assistant', content: fullResponse,  timestamp: new Date().toISOString() },
      ]
      await saveHistory(req.user.id, categoryId, mode, updatedHistory)
    }

    send('done', { response: fullResponse })
    clearInterval(keepalive)
    res.end()

  } catch (err) {
    console.error('[chat] Error:', err.message)
    clearInterval(keepalive)
    send('error', { message: err.message })
    res.end()
  }
})

// ── POST /api/chat/commit-episode ──────────────────────────────────────────────
// KB extracts an episode plan from the conversation and commits it to series memory
// so the Generate page, Companion, and all context knows about it
router.post('/commit-episode', async (req, res) => {
  const { categoryId, mode, episodeNumber, conversationSummary } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  try {
    // Load the recent chat history for this mode
    const { messages: history } = await loadHistory(req.user.id, categoryId, mode || 'generate')
    const recentMessages = history.slice(-20)

    if (!recentMessages.length && !conversationSummary) {
      return res.status(400).json({ error: 'No conversation to commit' })
    }

    // Ask Claude to extract the episode plan from the conversation
    const extractionPrompt = conversationSummary
      ? `Extract a structured episode plan from this summary: ${conversationSummary}`
      : `Extract a structured episode plan from this conversation:\n${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`

    const extraction = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 800,
      system:     'Extract episode planning data as JSON only. No preamble. Return: { "track_name": string, "episode_number": number|null, "mood": string, "summary": string, "themes": string[], "callback_seeds": string[], "targetDurationMinutes": number }',
      messages:   [{ role: 'user', content: extractionPrompt }],
    })

    let plan = {}
    try {
      const text = extraction.content[0]?.text || '{}'
      plan = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch {
      return res.status(422).json({ error: 'Could not extract episode plan from conversation — try being more specific about the episode name, mood, and themes' })
    }

    const epNumber = episodeNumber || plan.episode_number

    // Write to kb_planned_episodes
    const { data: planned, error: pe } = await supabase
      .from('kb_planned_episodes')
      .upsert({
        user_id:      req.user.id,
        category_id:  categoryId,
        episode_number: epNumber,
        track_name:   plan.track_name,
        track_context: {
          mood:                   plan.mood || '',
          targetDurationMinutes:  plan.targetDurationMinutes || 8,
        },
        summary:       plan.summary,
        themes:        plan.themes || [],
        callback_seeds: plan.callback_seeds || [],
        status:        'planned',
        chat_session:  mode || 'generate',
        updated_at:    new Date().toISOString(),
      }, { onConflict: epNumber ? 'user_id,category_id,episode_number' : undefined })
      .select()
      .single()

    if (pe) throw pe

    // Also write to series_memory so it shows up in the Series page
    if (epNumber) {
      await supabase
        .from('series_memory')
        .upsert({
          user_id:       req.user.id,
          category_id:   categoryId,
          episode_number: epNumber,
          track_name:    plan.track_name,
          track_context: { mood: plan.mood || '', targetDurationMinutes: plan.targetDurationMinutes || 8 },
          summary:       plan.summary,
          themes:        plan.themes || [],
          callback_seeds: plan.callback_seeds || [],
        }, { onConflict: 'user_id,category_id,episode_number' })
    }

    // Bust context cache so next KB message sees the new plan
    const ctxKey = `${req.user.id}:${categoryId}:${mode || 'generate'}`
    ctxCache.delete(ctxKey)

    res.json({
      committed: true,
      plan: {
        track_name:    plan.track_name,
        episode_number: epNumber,
        mood:          plan.mood,
        summary:       plan.summary,
        themes:        plan.themes,
      }
    })

  } catch (err) {
    console.error('[commit-episode]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/chat/history ──────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const { categoryId, mode = 'generate' } = req.query
  const result = await loadHistory(req.user.id, categoryId, mode)
  res.json(result)
})

// ── DELETE /api/chat/history ───────────────────────────────────────────────────
router.delete('/history', async (req, res) => {
  const { categoryId, mode } = req.body
  await supabase
    .from('chat_history')
    .delete()
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .eq('mode', mode)
  res.json({ cleared: true })
})

// ── GET /api/chat/sessions ─────────────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
  const { categoryId, mode = 'generate' } = req.query
  const { data } = await supabase
    .from('chat_sessions')
    .select('id, title, mode, created_at, updated_at')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .eq('mode', mode)
    .order('updated_at', { ascending: false })
    .limit(30)
  res.json({ sessions: data || [] })
})

// ── GET /api/chat/sessions/:id ─────────────────────────────────────────────────
router.get('/sessions/:id', async (req, res) => {
  const { data } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()
  if (!data) return res.status(404).json({ error: 'Session not found' })
  res.json({ session: data })
})

// ── POST /api/chat/sessions ────────────────────────────────────────────────────
router.post('/sessions', async (req, res) => {
  const { categoryId, mode, messages, title } = req.body
  if (!categoryId || !messages?.length) return res.status(400).json({ error: 'categoryId and messages required' })

  const autoTitle = title ||
    messages.find(m => m.role === 'user')?.content?.slice(0, 60) ||
    'Untitled conversation'

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id:     req.user.id,
      category_id: categoryId,
      mode:        mode || 'generate',
      title:       autoTitle,
      messages,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ session: data })
})

// ── DELETE /api/chat/sessions/:id ──────────────────────────────────────────────
router.delete('/sessions/:id', async (req, res) => {
  await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
  res.json({ deleted: true })
})

module.exports = router;

// ── GET /api/chat/sessions ─────────────────────────────────────────────────────
// List past sessions for a mode/category
router.get('/sessions', async (req, res) => {
  const { categoryId, mode = 'generate' } = req.query
  const { data } = await supabase
    .from('chat_sessions')
    .select('id, title, mode, created_at, updated_at')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .eq('mode', mode)
    .order('updated_at', { ascending: false })
    .limit(30)
  res.json({ sessions: data || [] })
})

// ── GET /api/chat/sessions/:id ─────────────────────────────────────────────────
router.get('/sessions/:id', async (req, res) => {
  const { data } = await supabase
    .from('chat_sessions')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()
  if (!data) return res.status(404).json({ error: 'Session not found' })
  res.json({ session: data })
})

// ── POST /api/chat/sessions ────────────────────────────────────────────────────
// Save current conversation as a named session
router.post('/sessions', async (req, res) => {
  const { categoryId, mode, messages, title } = req.body
  if (!categoryId || !messages?.length) return res.status(400).json({ error: 'categoryId and messages required' })

  // Auto-title from first user message if not provided
  const autoTitle = title ||
    messages.find(m => m.role === 'user')?.content?.slice(0, 60) ||
    'Untitled conversation'

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({
      user_id:     req.user.id,
      category_id: categoryId,
      mode:        mode || 'generate',
      title:       autoTitle,
      messages,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ session: data })
})

// ── DELETE /api/chat/sessions/:id ──────────────────────────────────────────────
router.delete('/sessions/:id', async (req, res) => {
  await supabase
    .from('chat_sessions')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
  res.json({ deleted: true })
})