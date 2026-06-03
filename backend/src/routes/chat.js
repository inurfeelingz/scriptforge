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
  const { categoryId, mode = 'generate', message, episodeCtx, messages = [], activeEpisodeId } = req.body

  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const keepalive = setInterval(() => {
    res.write(': ping\n\n')
  }, 8000)

  try {
    const { messages: dbHistory } = await loadHistory(req.user.id, categoryId, mode)

    const { data: otherHistory } = await supabase
      .from('chat_history')
      .select('mode, messages')
      .eq('user_id', req.user.id)
      .neq('mode', mode)
      .order('updated_at', { ascending: false })
      .limit(5)

    const crossContext = (otherHistory || [])
      .flatMap(h => (h.messages || []).slice(-2).map(m => ({ ...m })))
      .slice(-4)

    const COMMIT_TRIGGERS = ['commit', 'save this', 'lock it in', 'lock this in',
      'commit this', "let's commit", 'save episode', 'finalise', 'finalize', 'done planning']
    const isCommitCmd = COMMIT_TRIGGERS.some(t => message.toLowerCase().includes(t))

    const ctxKey = (episodeCtx || activeEpisodeId) ? null : `${req.user.id}:${categoryId}:${mode}`
    let systemContext = ctxKey ? getCachedCtx(ctxKey) : null
    if (!systemContext) {
      systemContext = await assembleContext(req.user.id, categoryId, { mode, episodeCtx, activeEpisodeId })
      if (ctxKey) setCachedCtx(ctxKey, systemContext)
    }

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

    if (isCommitCmd) {
      try {
        const { messages: h } = await loadHistory(req.user.id, categoryId, mode)
        if (h.length >= 2) {
          const extractRes = await client.messages.create({
            model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
            max_tokens: 500,
            system:     'Extract the episode plan from this conversation as compact JSON only. No preamble, no markdown. Fields: {"track_name":string,"summary":string,"themes":string[],"mood":string,"thumbnail_concept":string}. thumbnail_concept should be a one-sentence description of the visual moment that would stop the viewer mid-scroll. If no clear plan exists return {}.',
            messages:   [{ role: 'user', content: h.slice(-12).map(m => `${m.role}: ${m.content}`).join('\n') }],
          })
          const raw  = (extractRes.content[0]?.text || '{}').replace(/```json|```/g, '').trim()
          const plan = JSON.parse(raw)

          if (plan.track_name) {
            await supabase.from('kb_planned_episodes').insert({
              user_id:           req.user.id,
              category_id:       categoryId,
              track_name:        plan.track_name,
              summary:           plan.summary || '',
              themes:            plan.themes  || [],
              thumbnail_concept: plan.thumbnail_concept || '',
              track_context:     { mood: plan.mood || '' },
              status:            'planned',
              chat_session:      mode,
              updated_at:        new Date().toISOString(),
            })

            const ack = `"${plan.track_name}" is locked in. Head to Generate whenever you're ready — your plan is saved.`
            send('chunk', { text: ack })
            send('done',  { response: ack })

            const updatedHistory = [
              ...h,
              { role: 'user',      content: message,   timestamp: new Date().toISOString() },
              { role: 'assistant', content: ack,        timestamp: new Date().toISOString() },
            ]
            await saveHistory(req.user.id, categoryId, mode, updatedHistory)
            clearInterval(keepalive)
            return res.end()
          }
        }
      } catch (commitErr) {
        console.warn('[auto-commit]', commitErr.message)
      }
    }

    const historyForClaude = [
      ...crossContext,
      ...dbHistory.slice(-30),
    ].map(m => ({ role: m.role, content: m.content }))

    const historyTriggers = ['show my history', 'past conversations', 'previous chats',
      'what did we discuss', 'show history', 'my conversations', 'old chats', 'past sessions']
    if (historyTriggers.some(t => message.toLowerCase().includes(t))) {
      send('chunk', { text: "Here are your past conversations." })
      send('done',  { response: "Here are your past conversations.", action: 'show_history' })
      clearInterval(keepalive)
      return res.end()
    }

    // Generate episode triggers — KB confirms then fires generation
    const generateTriggers = ['generate the episode', 'generate episode', 'build it', 'build the episode',
      'make the episode', 'create the episode', 'generate now', 'go ahead and generate',
      'yes generate', 'generate this', 'make it', 'build this now']
    if (generateTriggers.some(t => message.toLowerCase().includes(t))) {
      send('chunk', { text: "On it — generating the episode now." })
      send('done',  { response: "On it — generating the episode now.", action: 'generate_episode' })
      clearInterval(keepalive)
      return res.end()
    }

    // ── EDL conversation flow ────────────────────────────────────────────────
    // KB detects EDL intent, loads session list, and walks through sync + build.
    // The action string carries all params needed by ChatPanel's handleEdlAction.

    const msgLower = message.toLowerCase()


    // ── Map moments — fires async job, polls in frontend ─────────────────────
    const mapMomentsTriggers = [
      'map this session', 'map the session', 'find interesting moments',
      'map all moments', 'interesting moments', 'find the moments',
      'what are the best moments', 'highlight the moments', 'find highlights',
      'map highlights', 'find the peaks', 'scan the transcript',
      'go through the whole session', 'map the whole session',
      'find all moments', 'analyze the session',
    ]
    if (mapMomentsTriggers.some(t => msgLower.includes(t))) {
      const { data: sessions } = await supabase
        .from('session_journals')
        .select('id, title, duration_ms')
        .eq('user_id', req.user.id)
        .eq('category_id', categoryId)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(1)

      if (!sessions?.length) {
        send('chunk', { text: "No indexed sessions found. Upload your audio first using the Upload button." })
        send('done',  { response: "No indexed sessions found. Upload your audio first using the Upload button." })
        clearInterval(keepalive)
        return res.end()
      }

      const session  = sessions[0]
      const mins     = Math.round((session.duration_ms || 0) / 60000)
      const msg      = 'Scanning the full ' + mins + '-minute session for interesting moments. This will take a minute — I'll work through it chunk by chunk and bring back everything worth keeping.'
      send('chunk', { text: msg })
      send('done',  { response: msg, action: 'map_moments:' + session.id })
      clearInterval(keepalive)
      return res.end()
    }

    // ── Transcript review mode ───────────────────────────────────────────────
    // KB presents the transcript minute by minute so the creator can say
    // keep/cut for each section. That conversation becomes the edit brief.
    const transcriptReviewTriggers = [
      'review the transcript', 'go through the transcript', 'review my session',
      'what did i say', 'walk me through', 'show me the transcript',
      'transcript review', 'what was in the session', 'read the session',
      'comb through', 'what happened in', 'what did i record',
    ]
    if (transcriptReviewTriggers.some(t => msgLower.includes(t))) {
      const { data: sessions } = await supabase
        .from('session_journals')
        .select('id, title, transcript, duration_ms')
        .eq('user_id', req.user.id)
        .eq('category_id', categoryId)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(5)

      if (!sessions?.length) {
        send('chunk', { text: "No indexed sessions yet. Upload your audio files first using the Upload button." })
        send('done',  { response: "No indexed sessions yet. Upload your audio files first using the Upload button." })
        clearInterval(keepalive)
        return res.end()
      }

      // Parse first session into minute blocks
      const session   = sessions[0]
      const lines     = (session.transcript || '').split('\n').map(line => {
        const m = line.match(/^\[(\d+):(\d+)\]\s*(.*)/)
        if (!m) return null
        return { min: parseInt(m[1]), text: m[3].trim() }
      }).filter(Boolean)

      const blocks = {}
      for (const l of lines) {
        blocks[l.min] = blocks[l.min] || []
        blocks[l.min].push(l.text)
      }

      const preview = Object.entries(blocks).slice(0, 5).map(([min, texts]) =>
        `[Minute ${min}] ${texts.slice(0, 3).join(' ').slice(0, 150)}...`
      ).join('\n')

      const totalMins = Math.round((session.duration_ms || 0) / 60000)
      const response  = `Reviewing "${session.title}" — ${totalMins} minutes total.\n\n${preview}\n\nThat's the first 5 minutes. Tell me what to keep or cut, and I'll go through the rest. Say "keep" or "cut" for each section, or give me specific instructions like "cut everything before minute 15" and I'll map it to the full transcript.`

      send('chunk', { text: response })
      send('done',  { response, action: `edl:review:${session.id}` })
      clearInterval(keepalive)
      return res.end()
    }

    // Step 1: User wants an EDL — show available sessions
    // Cast a wide net — KB must NEVER generate fake EDL text, always route through actions
    const edlListTriggers = [
      'build the edl', 'make the edl', 'create the edl', 'build an edl',
      'cut for retention', 'edit this session', 'make my edit', 'build my edit',
      'cut this down', 'sync the audio', 'sync my sessions', 'sync and build',
      'i want an edl', 'need an edl', 'building an edl', 'we are building',
      'build the edit', 'make the edit', 'create the edit', 'cut the footage',
      'edit the footage', 'edit the video', 'cut the video', 'build the video',
      'process the edl', 'generate the edl', 'export the edl', 'download the edl',
      'ready to download', 'edl file', 'edl export', 'edl ready',
      'build it for davinci', 'cut for davinci', 'davinci edl',
    ]
    if (edlListTriggers.some(t => msgLower.includes(t))) {
      send('chunk', { text: "Let me check what indexed sessions you have." })
      send('done',  { response: "Let me check what indexed sessions you have.", action: `edl:list_sessions:${categoryId}` })
      clearInterval(keepalive)
      return res.end()
    }

    // Step 2: User confirms sessions / clip names — extract and build
    const edlBuildTriggers = [
      'screen is', 'camera is', "that's the screen", "that's the camera",
      'screen capture is', 'use session', 'sync those', 'go ahead and sync',
      'yes sync', 'build it now', 'cut those', 'yes build', 'proceed',
      'synchronizing yes', 'after synchronizing', 'confirm', 'i confirm',
      'yes proceed', 'go ahead', "let's go", 'start the build', 'build now',
    ]
    const hasBuildIntent = edlBuildTriggers.some(t => msgLower.includes(t))

    if (hasBuildIntent) {
      const { data: sessions } = await supabase
        .from('session_journals')
        .select('id, title')
        .eq('user_id', req.user.id)
        .eq('category_id', categoryId)
        .eq('status', 'ready')
        .order('created_at', { ascending: false })
        .limit(10)

      const recentConvo = dbHistory.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n')
      const extractRes  = await client.messages.create({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
        max_tokens: 300,
        system:     'Extract EDL build parameters from this conversation. Return ONLY valid JSON, no preamble. Fields: { "sessionIdA": "id of screen capture session", "sessionIdB": "id of camera session or null", "clipNameA": "filename of screen capture video", "clipNameB": "filename of camera video", "targetMinutes": 8 }. If you cannot confidently identify a field, use null.',
        messages: [{
          role:    'user',
          content: `Available sessions:\n${(sessions || []).map(s => `ID: ${s.id} — "${s.title}"`).join('\n')}\n\nConversation:\n${recentConvo}\n\nLatest message: ${message}\n\nExtract the EDL parameters.`,
        }],
      })

      let params = {}
      try {
        params = JSON.parse((extractRes.content[0]?.text || '{}').replace(/```json|```/g, '').trim())
      } catch { params = {} }

      if (!params.sessionIdA) {
        const clarify = `I need a bit more to go on. Tell me:\n1. Which session is the screen capture? (from the list above)\n2. Which is the camera footage?\n3. What are the actual video filenames on your drive? (e.g. WRITING_A_SONG_SCREEN.mp4)`
        send('chunk', { text: clarify })
        send('done',  { response: clarify })
        clearInterval(keepalive)
        return res.end()
      }

      const sidA  = params.sessionIdA
      const sidB  = params.sessionIdB || 'none'
      const clipA = encodeURIComponent(params.clipNameA || 'SCREEN_CAPTURE.mp4')
      const clipB = encodeURIComponent(params.clipNameB || 'CAMERA_FOOTAGE.mp4')
      const mins  = params.targetMinutes || 8

      if (sidB !== 'none') {
        const syncMsg = `Syncing "${sessions?.find(s=>s.id===sidA)?.title || 'screen'}" and "${sessions?.find(s=>s.id===sidB)?.title || 'camera'}" — matching word sequences…`
        send('chunk', { text: syncMsg })
        send('done',  { response: syncMsg, action: `edl:sync_then_build:${sidA}:${sidB}:${clipA}:${clipB}:${mins}` })
      } else {
        const buildMsg = 'Building EDL from single audio source…'
        send('chunk', { text: buildMsg })
        send('done',  { response: buildMsg, action: `edl:build:${sidA}:none:0:${clipA}:${clipB}:${mins}` })
      }
      clearInterval(keepalive)
      return res.end()
    }

    // EDL instruction — injected into every message to prevent fake EDL generation
    // This runs BEFORE the main Claude stream so it's always in context
    if (!systemContext.includes('NEVER write EDL content as text')) {
      systemContext += `

CRITICAL EDL RULE: You NEVER write EDL files, timecodes, or cut lists as text in chat. NEVER.
If someone asks you to build, generate, export, download, or create an EDL — say only:
"Let me check what sessions you have indexed." and stop. The system handles the rest.
If you write fake timecodes or fake EDL structure in chat, the download button will never appear
and the user cannot edit their video. Route ALL EDL requests through the action system only.`
    }

    const startFreshTriggers = ['start fresh', 'new chat', 'start over', 'fresh start', 'clear', 'reset chat']
    if (startFreshTriggers.some(t => message.toLowerCase().includes(t)) && dbHistory.length <= 4) {
      await saveHistory(req.user.id, categoryId, mode, [])
      send('chunk', { text: "Clean slate. What are we working on?" })
      send('done', { response: "Clean slate. What are we working on?" })
      clearInterval(keepalive)
      return res.end()
    }

    // ── New chat orientation ───────────────────────────────────────────────────
    // On first message pull a live workspace snapshot and inject it so KB knows
    // exactly what he's looking at before he responds.
    // This prevents KB from acting blind or asking generic questions.
    const isNewChat = dbHistory.length === 0

    let workspaceCtx = ''
    if (isNewChat) {
      const [epRes, vaultRes, sessRes, anaRes, planRes] = await Promise.allSettled([
        supabase.from('episodes').select('track_name, yt_retention_score').eq('user_id', req.user.id).eq('category_id', categoryId).order('created_at', { ascending: false }).limit(5),
        supabase.from('vault_entries').select('id', { count: 'exact' }).eq('user_id', req.user.id).eq('category_id', categoryId),
        supabase.from('session_journals').select('title').eq('user_id', req.user.id).eq('category_id', categoryId).eq('status', 'ready').order('created_at', { ascending: false }).limit(3),
        supabase.from('analytics_uploads').select('avg_score, platform').eq('user_id', req.user.id).eq('category_id', categoryId).order('upload_date', { ascending: false }).limit(1),
        supabase.from('kb_planned_episodes').select('track_name').eq('user_id', req.user.id).eq('category_id', categoryId).eq('status', 'planned').limit(3),
      ])
      const eps      = epRes.status    === 'fulfilled' ? epRes.value?.data      || [] : []
      const vault    = vaultRes.status === 'fulfilled' ? (vaultRes.value?.count || 0) : 0
      const sessions = sessRes.status  === 'fulfilled' ? sessRes.value?.data    || [] : []
      const lastAna  = anaRes.status   === 'fulfilled' ? anaRes.value?.data?.[0]    : null
      const planEps  = planRes.status  === 'fulfilled' ? planRes.value?.data    || [] : []

      workspaceCtx = [
        eps.length     ? `Episodes generated: ${eps.map(e => `"${e.track_name}"${e.yt_retention_score ? ` (score ${e.yt_retention_score})` : ''}`).join(', ')}` : 'No episodes generated yet — fresh workspace',
        planEps.length ? `Planned not generated yet: ${planEps.map(p => `"${p.track_name}"`).join(', ')}`                                                        : null,
        vault > 0      ? `Vault: ${vault} saved ideas`                                                                                                            : 'Vault is empty',
        sessions.length? `Session journals: ${sessions.map(s => `"${s.title}"`).join(', ')}`                                                                      : null,
        lastAna        ? `Last analytics: avg score ${lastAna.avg_score} on ${lastAna.platform}`                                                                  : 'No analytics uploaded',
      ].filter(Boolean).join('. ')
    }

    const claudeMessages = [
      ...historyForClaude,
      ...(isNewChat ? [{
        role:    'user',
        content: `__WORKSPACE__ ${workspaceCtx}. Creator just opened KB. Use this context in your response — reference what you can actually see. Be specific, not generic. No em dashes, no markdown, no self-introduction.`,
      }, {
        role:    'assistant',
        content: 'Noted.',
      }] : []),
      { role: 'user', content: message },
    ]

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

    if (categoryId) {
      const updatedHistory = [
        ...dbHistory,
        { role: 'user',      content: message,      timestamp: new Date().toISOString() },
        { role: 'assistant', content: fullResponse,  timestamp: new Date().toISOString() },
      ]
      await saveHistory(req.user.id, categoryId, mode, updatedHistory)

      if (updatedHistory.length % 5 === 0) {
        extractLearnings(req.user.id, categoryId, updatedHistory.slice(-10), fullResponse, message)
          .catch(err => console.warn('[extract] Failed:', err.message))
      }

      if (message.toLowerCase().includes("my style") ||
          message.toLowerCase().includes("i never") ||
          message.toLowerCase().includes("i always") ||
          message.toLowerCase().includes("don't say") ||
          message.toLowerCase().includes("i prefer") ||
          message.toLowerCase().includes("sounds like me") ||
          message.toLowerCase().includes("not my voice")) {
        updateVoiceProfile(req.user.id, categoryId, message, fullResponse)
          .catch(err => console.warn('[voice-update] Failed:', err.message))
      }
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
router.post('/commit-episode', async (req, res) => {
  const { categoryId, mode, episodeNumber, conversationSummary } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  try {
    const { messages: history } = await loadHistory(req.user.id, categoryId, mode || 'generate')
    const recentMessages = history.slice(-20)

    if (!recentMessages.length && !conversationSummary) {
      return res.status(400).json({ error: 'No conversation to commit' })
    }

    const extractionPrompt = conversationSummary
      ? `Extract a structured episode plan from this summary: ${conversationSummary}`
      : `Extract a structured episode plan from this conversation:\n${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n\n')}`

    const extraction = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 800,
      system:     'Extract episode planning data as JSON only. No preamble. Return: { "track_name": string, "episode_number": number|null, "mood": string, "summary": string, "themes": string[], "callback_seeds": string[], "targetDurationMinutes": number, "thumbnail_concept": string }. thumbnail_concept is a one-sentence visual description of the thumbnail moment.',
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

    const { data: planned, error: pe } = await supabase
      .from('kb_planned_episodes')
      .upsert({
        user_id:           req.user.id,
        category_id:       categoryId,
        episode_number:    epNumber,
        track_name:        plan.track_name,
        track_context: {
          mood:                   plan.mood || '',
          targetDurationMinutes:  plan.targetDurationMinutes || 8,
        },
        summary:           plan.summary,
        themes:            plan.themes || [],
        callback_seeds:    plan.callback_seeds || [],
        thumbnail_concept: plan.thumbnail_concept || '',
        status:            'planned',
        chat_session:      mode || 'generate',
        updated_at:        new Date().toISOString(),
      }, { onConflict: epNumber ? 'user_id,category_id,episode_number' : undefined })
      .select()
      .single()

    if (pe) throw pe

    if (epNumber) {
      await supabase
        .from('series_memory')
        .upsert({
          user_id:        req.user.id,
          category_id:    categoryId,
          episode_number: epNumber,
          track_name:     plan.track_name,
          track_context:  { mood: plan.mood || '', targetDurationMinutes: plan.targetDurationMinutes || 8 },
          summary:        plan.summary,
          themes:         plan.themes || [],
          callback_seeds: plan.callback_seeds || [],
        }, { onConflict: 'user_id,category_id,episode_number' })
    }

    const ctxKey = `${req.user.id}:${categoryId}:${mode || 'generate'}`
    ctxCache.delete(ctxKey)

    res.json({
      committed: true,
      plan: {
        track_name:     plan.track_name,
        episode_number: epNumber,
        mood:           plan.mood,
        summary:        plan.summary,
        themes:         plan.themes,
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
  const { data } = await supabase
    .from('chat_sessions')
    .select('id, title, mode, category_id, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false })
    .limit(50)
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

// ── POST /api/chat/speak — ElevenLabs TTS ────────────────────────────────────
router.post('/speak', async (req, res) => {
  const { text, categoryId } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'TTS not configured — add ELEVENLABS_API_KEY to Railway' })
  }

  try {
    let voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
    if (categoryId) {
      const { data: cat } = await supabase
        .from('categories')
        .select('voice_profile')
        .eq('id', categoryId)
        .eq('user_id', req.user.id)
        .single()
        .then(r => r)
        .catch(() => ({ data: null }))
      if (cat?.voice_profile?.elevenLabsVoiceId) {
        voiceId = cat.voice_profile.elevenLabsVoiceId
      }
    }

    const clean = text
      .replace(/#+\s*/g, '')
      .replace(/\*+/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .slice(0, 500)

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
      {
        method:  'POST',
        headers: {
          'Accept':       'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key':   process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text:           clean,
          model_id:       'eleven_turbo_v2',
          voice_settings: {
            stability:         0.45,
            similarity_boost:  0.80,
            style:             0.0,
            use_speaker_boost: true,
          },
        }),
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('[speak] ElevenLabs error:', response.status, errText.slice(0, 200))
      return res.status(response.status).json({ error: 'ElevenLabs error: ' + errText.slice(0, 100) })
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Transfer-Encoding', 'chunked')

    const reader = response.body.getReader()
    const pump   = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(Buffer.from(value))
      }
      res.end()
    }
    pump().catch(err => {
      console.error('[speak] stream error:', err.message)
      if (!res.writableEnded) res.end()
    })

  } catch (err) {
    console.error('[speak]', err.message)
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

// ── POST /api/chat/onboard ────────────────────────────────────────────────────
router.post('/onboard', async (req, res) => {
  const { categoryId, message, history = [] } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const keepalive = setInterval(() => res.write(': ping\n\n'), 15000)

  try {
    const { data: cat } = await supabase.from('categories').select('name, niche').eq('id', categoryId).single()

    const SYSTEM = `You are KB, the AI inside WhispaCuts. You are onboarding a new creator.
Your job is to learn how they communicate on camera so their scripts sound like them.
Ask ONE question at a time. Be warm, direct, and brief — like a creative friend, not a form.
After collecting all answers, output a JSON block wrapped in ===VOICE_PROFILE=== tags.

CRITICAL FORMATTING RULE: Never use markdown symbols of any kind. No bold, no italic, no headers, no bullet points, no backticks, no dividers. Plain prose only. Line breaks between paragraphs are fine.
After completing onboarding, let the creator know that the next step is to connect YouTube or upload audience data on the Analytics page so KB can tailor everything to their specific viewers.

The 6 questions to work through (adapt naturally based on their answers):
1. What kind of content do you make? (format, length, style)
2. Who watches it — who are you talking to?
3. How do you talk on camera — casual and raw, polished, energetic, calm?
4. What's a phrase or expression you say a lot? (their verbal fingerprint)
5. Name a creator whose style you admire and why
6. How often do you want to post?

When you have all 6 answers, output this exact format with no text before or after the tags:
===VOICE_PROFILE===
{"voiceCharacteristics":{"sentenceLengthPattern":"","rhythmNote":"","vocabularyLevel":""},"structuralPatterns":{"hookStyle":"","ctaStyle":""},"languageFingerprint":{"signaturePhrases":[],"avoidPhrases":[],"humourStyle":"","storytellingStyle":""},"audience":"","postingCadence":"","referenceCreators":[]}
===VOICE_PROFILE===

After the closing ===VOICE_PROFILE=== tag, write one short warm closing sentence to wrap the conversation (plain text, no markdown).
Keep all responses short — max 2-3 sentences per message. No lists.
Show name: ${cat?.name || 'their show'}. Niche: ${cat?.niche || 'content creation'}.`

    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      ...(message ? [{ role: 'user', content: message }] : []),
    ]

    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'start' })
    }

    const stream = await client.messages.stream({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 1200,
      system:     SYSTEM,
      messages,
    })

    let full = ''
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        full += chunk.delta.text
      }
    }

    console.log('[onboard] full response length:', full.length, '| preview:', full.slice(0, 120))

    let voiceProfileSaved = false
    let cleanResponse = full

    if (full.includes('===VOICE_PROFILE===')) {
      const parts = full.split('===VOICE_PROFILE===')
      const jsonRaw  = parts[1]?.trim()
      const afterTag = parts[2]?.trim() || ''

      if (jsonRaw) {
        try {
          const vp = JSON.parse(jsonRaw)
          const { error: dbErr } = await supabase.from('categories').update({
            voice_profile: vp,
            onboarded_at:  new Date().toISOString(),
          }).eq('id', categoryId).eq('user_id', req.user.id)

          if (dbErr) {
            console.error('[onboard] supabase update error:', dbErr.message)
          } else {
            voiceProfileSaved = true
            console.log('[onboard] voice profile saved for category:', categoryId)
          }
        } catch (e) {
          console.warn('[onboard] voice profile parse error:', e.message)
          console.warn('[onboard] raw JSON attempted:', jsonRaw.slice(0, 200))
        }
      }

      cleanResponse = [parts[0]?.trim(), afterTag].filter(Boolean).join('\n\n').trim()
    }

    send('done', {
      response: cleanResponse,
      voiceProfileSaved,
      onboardingComplete: voiceProfileSaved,
    })

  } catch (err) {
    console.error('[chat/onboard]', err.message)
    send('error', { message: err.message })
  } finally {
    clearInterval(keepalive)
    res.end()
  }
})

// ── POST /api/chat/edit-frame ────────────────────────────────────────────────
router.post('/edit-frame', async (req, res) => {
  const { frameId, description, notes, shot_type } = req.body
  if (!frameId) return res.status(400).json({ error: 'frameId required' })

  const updates = {}
  if (description !== undefined) updates.description = description
  if (notes       !== undefined) updates.notes       = notes
  if (shot_type   !== undefined) updates.shot_type   = shot_type

  const { data, error } = await supabase
    .from('storyboard_frames')
    .update(updates)
    .eq('id', frameId)
    .eq('user_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ frame: data })
})

// ── GET /api/chat/greet ───────────────────────────────────────────────────────
// Called when the app loads (or reopens after 5+ minutes).
// Pulls REAL workspace data before generating the greeting — episodes, vault,
// sessions, analytics — so KB actually knows what he's looking at.

router.get('/greet', async (req, res) => {
  const { categoryId, mode = 'generate' } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  try {
    const [
      historyResult,
      catResult,
      episodesResult,
      vaultResult,
      sessionsResult,
      analyticsResult,
      plannedResult,
    ] = await Promise.allSettled([
      loadHistory(req.user.id, categoryId, mode),
      supabase.from('categories').select('name, niche, voice_profile, audience_model').eq('id', categoryId).single(),
      supabase.from('episodes').select('track_name, status, created_at, yt_retention_score').eq('user_id', req.user.id).eq('category_id', categoryId).order('created_at', { ascending: false }).limit(5),
      supabase.from('vault_entries').select('id', { count: 'exact' }).eq('user_id', req.user.id).eq('category_id', categoryId),
      supabase.from('session_journals').select('title, created_at').eq('user_id', req.user.id).eq('category_id', categoryId).eq('status', 'ready').order('created_at', { ascending: false }).limit(3),
      supabase.from('analytics_uploads').select('avg_score, platform, upload_date').eq('user_id', req.user.id).eq('category_id', categoryId).order('upload_date', { ascending: false }).limit(1),
      supabase.from('kb_planned_episodes').select('track_name, status').eq('user_id', req.user.id).eq('category_id', categoryId).eq('status', 'planned').limit(5),
    ])

    const history    = historyResult.status   === 'fulfilled' ? historyResult.value?.messages  || [] : []
    const cat        = catResult.status       === 'fulfilled' ? catResult.value?.data              : null
    const episodes   = episodesResult.status  === 'fulfilled' ? episodesResult.value?.data     || [] : []
    const vaultCount = vaultResult.status     === 'fulfilled' ? (vaultResult.value?.count      || 0) : 0
    const sessions   = sessionsResult.status  === 'fulfilled' ? sessionsResult.value?.data     || [] : []
    const analytics  = analyticsResult.status === 'fulfilled' ? analyticsResult.value?.data?.[0]   : null
    const planned    = plannedResult.status   === 'fulfilled' ? plannedResult.value?.data      || [] : []

    // Less than 5 minutes since last message — still in session, no greeting
    const lastMsg = history[history.length - 1]
    if (lastMsg?.timestamp) {
      const minsAgo = Math.round((Date.now() - new Date(lastMsg.timestamp).getTime()) / 60000)
      if (minsAgo < 5) return res.json({ greet: false, message: null })
    }

    // Compact snapshot of what KB can actually see
    const snapshot = [
      cat?.niche ? `Niche: ${cat.niche}` : null,
      episodes.length
        ? `Episodes: ${episodes.slice(0,3).map(e => `"${e.track_name}"${e.yt_retention_score ? ` (score ${e.yt_retention_score})` : ''}`).join(', ')}`
        : 'No episodes generated yet',
      planned.length  ? `Planned not generated: ${planned.map(p => `"${p.track_name}"`).join(', ')}` : null,
      vaultCount > 0  ? `Vault: ${vaultCount} saved idea${vaultCount !== 1 ? 's' : ''}` : 'Vault empty',
      sessions.length ? `Session journals: ${sessions.map(s => `"${s.title}"`).join(', ')}` : 'No session journals',
      analytics       ? `Analytics: last upload avg score ${analytics.avg_score} on ${analytics.platform}` : 'No analytics uploaded',
      cat?.voice_profile ? 'Voice profile: set' : 'Voice profile: not set',
      cat?.audience_model?.geminiInsights ? 'Audience model: researched' : 'Audience: not researched',
    ].filter(Boolean).join('\n')

    const lastTimestamp = lastMsg?.timestamp
    const minsAway = lastTimestamp
      ? Math.round((Date.now() - new Date(lastTimestamp).getTime()) / 60000)
      : null
    const timeLabel = minsAway === null ? null
      : minsAway < 60   ? `${minsAway} minutes`
      : minsAway < 1440 ? `${Math.round(minsAway / 60)} hours`
      : `${Math.round(minsAway / 1440)} days`

    const lastUserMsg = [...history].reverse().find(m => m.role === 'user')
    const lastKBMsg   = [...history].reverse().find(m => m.role === 'assistant')
    const isNewUser   = history.length === 0

    const system = isNewUser
      ? `You are KB, a sharp creative collaborator inside WhispaCuts. A creator just opened their workspace.
You can see their workspace data below — use it. Don't act like you can't see anything.
If they have no episodes yet, ask about their first one using the niche specifically.
If they have episodes, reference one by name and say something concrete about it.
If they have session journals, mention one specifically.
If analytics score is low, you can call it out — be a collaborator, not a cheerleader.
RULES: 1-2 sentences only. Never introduce yourself. No markdown, no em dashes.
Ask one specific question. Vary your tone — direct, curious, dry, energetic. Never generic.`
      : `You are KB, a sharp creative collaborator inside WhispaCuts. A creator just came back.
You can see their full workspace below — reference what's actually there, not what might be there.
If something is clearly missing (no analytics, no sessions) you can mention it if relevant.
Never say "Welcome back". Never introduce yourself. No markdown, no em dashes.
1-2 sentences max. Reference something specific. Ask one question.`

    const userContent = [
      `Workspace — "${cat?.name || 'untitled'}"`,
      snapshot,
      timeLabel          ? `Away for: ${timeLabel}`                                      : '',
      lastUserMsg        ? `Last discussed: "${lastUserMsg.content.slice(0, 120)}"`      : '',
      lastKBMsg          ? `KB last said: "${lastKBMsg.content.slice(0, 120)}"`          : '',
      'Write the greeting.',
    ].filter(Boolean).join('\n')

    const greetRes = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 120,
      system,
      messages: [{ role: 'user', content: userContent }],
    })

    res.json({
      greet:   true,
      message: greetRes.content[0]?.text?.trim() || '',
      minsAgo: minsAway,
    })

  } catch (err) {
    console.error('[greet]', err.message)
    res.json({ greet: false, message: null })
  }
})

// ── POST /api/chat/thumbnail-prompt ──────────────────────────────────────────
router.post('/thumbnail-prompt', async (req, res) => {
  const { categoryId, episodeId, plannedEpisodeId } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  try {
    const { data: cat } = await supabase
      .from('categories')
      .select('niche, name, audience_model, voice_profile')
      .eq('id', categoryId)
      .single()

    const { data: reactionImages } = await supabase
      .from('creator_assets')
      .select('tag, file_name, storage_url')
      .eq('user_id', req.user.id)
      .eq('category_id', categoryId)
      .eq('asset_type', 'reaction')
      .order('created_at', { ascending: false })
      .limit(10)

    let episodeContext = {}
    if (episodeId) {
      const { data: ep } = await supabase
        .from('episodes')
        .select('track_name, episode_concept, summary, themes, thumbnail_concept')
        .eq('id', episodeId)
        .single()
      episodeContext = ep || {}
    } else if (plannedEpisodeId) {
      const { data: planned } = await supabase
        .from('kb_planned_episodes')
        .select('track_name, summary, themes, thumbnail_concept, track_context')
        .eq('id', plannedEpisodeId)
        .single()
      episodeContext = planned || {}
    }

    const audience    = cat?.audience_model?.geminiInsights
    const ytAudience  = cat?.audience_model?.youtube
    const audienceStr = audience ? [
      audience.primaryAudience?.ageRange            && `Viewer: ${audience.primaryAudience.ageRange}`,
      audience.psychographics?.corePainPoint        && `Pain point: ${audience.psychographics.corePainPoint}`,
      audience.psychographics?.coreAspiration       && `Aspiration: ${audience.psychographics.coreAspiration}`,
      audience.thumbnailPsychology?.emotionalTriggers?.length && `Click triggers: ${audience.thumbnailPsychology.emotionalTriggers.join(', ')}`,
      audience.thumbnailPsychology?.visualPatterns  && `Visual patterns: ${audience.thumbnailPsychology.visualPatterns}`,
    ].filter(Boolean).join('\n') : 'No audience data yet.'

    const ytStr = ytAudience?.devices?.[0]
      ? `Primary device: ${ytAudience.devices[0].device} (${ytAudience.devices[0].pct}% of views)`
      : ''

    const promptRes = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 600,
      system:     `You are a thumbnail strategist who writes precise Flux/Midjourney image generation prompts.
Your prompts are specific, visual, emotionally targeted, and optimised for YouTube CTR.
Never use markdown. Write the prompt as a single paragraph of plain text.
The prompt must describe a photorealistic or cinematic image — no illustrations or cartoons unless the creator's brand requires it.
The prompt must NOT request any text overlays — those are added in Canva after.
End with: "16:9 aspect ratio, photorealistic, cinematic lighting"`,
      messages: [{
        role: 'user',
        content: `Write a Flux image generation prompt for this YouTube thumbnail.

Episode: "${episodeContext.track_name || 'untitled'}"
Summary: ${episodeContext.summary || episodeContext.episode_concept || 'not provided'}
Thumbnail concept: ${episodeContext.thumbnail_concept || 'infer the most compelling visual from the episode summary'}
Themes: ${(episodeContext.themes || []).join(', ') || 'not specified'}
Niche: ${cat?.niche || 'content creation'}

Audience intelligence:
${audienceStr}
${ytStr}

${reactionImages?.length
  ? `Creator reaction images available:\n${reactionImages.map(r => `[${r.tag}]: ${r.file_name}`).join('\n')}\nChoose the tag that best matches the episode emotional hook. Describe the environment/background to composite around the creator. Include: "Reference image provided. Do NOT alter the face, expression, or skin tone. Composite only. No text overlays."`
  : 'No reaction images uploaded — describe a photorealistic scene without the creator face.'}

Write the Flux prompt now.`,
      }],
    })

    const fluxPrompt = promptRes.content[0]?.text?.trim() || ''

    const titleRes = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 300,
      system:     'You write YouTube titles optimised for CTR. Return 3 title options as plain text, one per line, no numbering, no quotes, no markdown.',
      messages: [{
        role: 'user',
        content: `Write 3 YouTube title options for this episode.

Episode: "${episodeContext.track_name || 'untitled'}"
Summary: ${episodeContext.summary || 'not provided'}
Audience pain point: ${audience?.psychographics?.corePainPoint || 'not researched yet'}
Audience aspiration: ${audience?.psychographics?.coreAspiration || 'not researched yet'}
Title formulas that work: ${audience?.thumbnailPsychology?.titleFormulas?.join(' | ') || 'not researched yet'}

Write titles that speak directly to the pain point or aspiration.`,
      }],
    })

    const titleOptions = (titleRes.content[0]?.text || '').trim().split('\n').filter(Boolean)

    res.json({
      fluxPrompt,
      titleOptions,
      thumbnailConcept: episodeContext.thumbnail_concept || '',
      audienceUsed:     !!audience,
      reactionImages:   reactionImages || [],
    })

  } catch (err) {
    console.error('[thumbnail-prompt]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/chat/voice-clone ────────────────────────────────────────────────
const multerClone = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } })

router.post('/voice-clone', multerClone.single('file'), async (req, res) => {
  const { categoryId } = req.body
  if (!categoryId)  return res.status(400).json({ error: 'categoryId required' })
  if (!req.file)    return res.status(400).json({ error: 'Audio file required' })
  if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'ElevenLabs not configured' })

  try {
    const { data: cat } = await supabase
      .from('categories')
      .select('name, voice_profile')
      .eq('id', categoryId)
      .eq('user_id', req.user.id)
      .single()

    const FormData = require('form-data')
    const form = new FormData()
    form.append('name', `${cat?.name || 'Creator'} — WhispaCuts Voice Clone`)
    form.append('description', `Voice clone for ${cat?.name || 'WhispaCuts creator'}, trained ${new Date().toLocaleDateString()}`)
    form.append('files', req.file.buffer, {
      filename:    req.file.originalname || 'voice_sample.mp3',
      contentType: req.file.mimetype || 'audio/mpeg',
    })

    const axios = require('axios')
    const cloneRes = await axios.post(
      'https://api.elevenlabs.io/v1/voices/add',
      form,
      {
        headers: { ...form.getHeaders(), 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        maxBodyLength:    Infinity,
        maxContentLength: Infinity,
      }
    )

    const voiceId = cloneRes.data.voice_id
    if (!voiceId) throw new Error('No voice ID returned from ElevenLabs')

    const existingVP = cat?.voice_profile || {}
    await supabase.from('categories').update({
      voice_profile: { ...existingVP, elevenLabsVoiceId: voiceId },
      updated_at:    new Date().toISOString(),
    }).eq('id', categoryId).eq('user_id', req.user.id)

    res.json({ success: true, voiceId, message: 'Voice clone created — KB will now speak in your voice' })
  } catch (err) {
    console.error('[voice-clone]', err.response?.data || err.message)
    res.status(500).json({ error: err.response?.data?.detail || err.message })
  }
})

// ── POST /api/chat/generate-episode ──────────────────────────────────────────
router.post('/generate-episode', async (req, res) => {
  const { categoryId, mode } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const keepalive = setInterval(() => res.write(': ping\n\n'), 15000)

  try {
    send('progress', { step: 'extracting', message: 'KB is extracting the episode plan...', pct: 5 })

    const { messages: history } = await loadHistory(req.user.id, categoryId, mode || 'series')
    const recentMessages = history.slice(-20)

    if (!recentMessages.length) {
      send('error', { message: 'No conversation to generate from — discuss an episode with KB first' })
      clearInterval(keepalive)
      return res.end()
    }

    const extraction = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 600,
      system:     'Extract episode plan as JSON only. No preamble. Return: { "track_name": string, "episode_number": number|null, "mood": string, "targetDurationMinutes": number, "summary": string, "themes": string[], "voiceMemoText": string }.',
      messages:   [{ role: 'user', content: `Extract episode plan from:\n${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n\n')}` }],
    })

    let plan = {}
    try {
      plan = JSON.parse(extraction.content[0]?.text?.replace(/```json|```/g, '').trim() || '{}')
    } catch {
      send('error', { message: 'Could not extract episode plan — be more specific about the episode name, mood, and what you want to say' })
      clearInterval(keepalive)
      return res.end()
    }

    if (!plan.track_name) {
      send('error', { message: 'KB needs an episode name — tell KB what this episode is called' })
      clearInterval(keepalive)
      return res.end()
    }

    send('progress', { step: 'generating', message: `Generating "${plan.track_name}"...`, pct: 15 })

    const generateRes = await fetch(`http://localhost:${process.env.PORT || 3001}/api/episodes/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': req.headers.authorization },
      body: JSON.stringify({
        categoryId,
        episodeNumber: plan.episode_number || null,
        trackContext: {
          name:                  plan.track_name,
          mood:                  plan.mood || 'conversational',
          targetDurationMinutes: plan.targetDurationMinutes || 8,
          summary:               plan.summary || '',
          themes:                plan.themes || [],
        },
        voiceMemoText: plan.voiceMemoText || plan.summary || '',
      }),
    })

    const reader  = generateRes.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(decoder.decode(value, { stream: true }))
    }

    clearInterval(keepalive)
    res.end()

  } catch (err) {
    console.error('[chat/generate-episode]', err.message)
    clearInterval(keepalive)
    send('error', { message: err.message })
    res.end()
  }
})

// ── POST-CONVERSATION EXTRACTION ─────────────────────────────────────────────
async function extractLearnings(userId, categoryId, recentMessages, lastResponse, lastMessage) {
  const conversation = recentMessages
    .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
    .join('\n')

  const extraction = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 400,
    system:     'Extract creative learnings from this conversation. Return ONLY valid JSON, no preamble. Fields: { "insights": string[], "preferences": string[], "episodeIdeas": string[], "voiceNotes": string[] }. Max 3 items per array.',
    messages:   [{ role: 'user', content: conversation }],
  })

  let learnings = {}
  try {
    learnings = JSON.parse(extraction.content[0]?.text?.replace(/```json|```/g, '').trim() || '{}')
  } catch { return }

  const hasContent = Object.values(learnings).some(v => Array.isArray(v) && v.length > 0)
  if (!hasContent) return

  await supabase.from('kb_learnings').insert({
    user_id:       userId,
    category_id:   categoryId,
    insights:      learnings.insights      || [],
    preferences:   learnings.preferences   || [],
    episode_ideas: learnings.episodeIdeas  || [],
    voice_notes:   learnings.voiceNotes    || [],
    extracted_at:  new Date().toISOString(),
  })
}

// ── VOICE PROFILE LIVE UPDATE ─────────────────────────────────────────────────
async function updateVoiceProfile(userId, categoryId, userMessage, kbResponse) {
  const { data: cat } = await supabase
    .from('categories')
    .select('voice_profile')
    .eq('id', categoryId)
    .eq('user_id', userId)
    .single()

  if (!cat?.voice_profile) return

  const detection = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 300,
    system:     'Detect if the creator is correcting or refining their voice profile. Return ONLY valid JSON: { "hasUpdate": boolean, "field": string, "oldValue": string, "newValue": string, "path": string }. path is the dot-notation path in the voice_profile object (e.g. "languageFingerprint.avoidPhrases"). If no clear voice correction, return { "hasUpdate": false }.',
    messages:   [{ role: 'user', content: `Creator said: "${userMessage}"\n\nCurrent voice profile: ${JSON.stringify(cat.voice_profile).slice(0, 500)}\n\nIs this a voice profile correction?` }],
  })

  let update = {}
  try {
    update = JSON.parse(detection.content[0]?.text?.replace(/```json|```/g, '').trim() || '{}')
  } catch { return }

  if (!update.hasUpdate || !update.path || !update.newValue) return

  const vp    = { ...cat.voice_profile }
  const parts = update.path.split('.')
  let obj     = vp
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {}
    obj = obj[parts[i]]
  }
  const lastKey = parts[parts.length - 1]

  if (Array.isArray(obj[lastKey])) {
    if (!obj[lastKey].includes(update.newValue)) {
      obj[lastKey] = [...obj[lastKey], update.newValue]
    }
  } else {
    obj[lastKey] = update.newValue
  }

  await supabase.from('categories').update({
    voice_profile: vp,
    updated_at:    new Date().toISOString(),
  }).eq('id', categoryId).eq('user_id', userId)

  console.log(`[voice-update] Patched ${update.path} for category ${categoryId}`)
}

module.exports = router;