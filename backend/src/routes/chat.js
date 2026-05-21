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
  const { categoryId, mode = 'generate', message, episodeCtx, messages = [], activeEpisodeId } = req.body

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
    // Load full history from DB for current mode
    const { messages: dbHistory } = await loadHistory(req.user.id, categoryId, mode)

    // Also pull recent messages from other modes for cross-context awareness
    const { data: otherHistory } = await supabase
      .from('chat_history')
      .select('mode, messages')
      .eq('user_id', req.user.id)
      .neq('mode', mode)
      .order('updated_at', { ascending: false })
      .limit(5)

    const crossContext = (otherHistory || [])
      .flatMap(h => (h.messages || []).slice(-2).map(m => ({
        ...m,
        content: m.content  // no mode prefix — prevents KB echoing metadata
      })))
      .slice(-4)

    // ── Auto-commit detection ────────────────────────────────────────────────────
    const COMMIT_TRIGGERS = ['commit', 'save this', 'lock it in', 'lock this in',
      'commit this', "let's commit", 'save episode', 'finalise', 'finalize', 'done planning']
    const isCommitCmd = COMMIT_TRIGGERS.some(t => message.toLowerCase().includes(t))

    // Assemble system context
    const ctxKey = (episodeCtx || activeEpisodeId) ? null : `${req.user.id}:${categoryId}:${mode}`
    let systemContext = ctxKey ? getCachedCtx(ctxKey) : null
    if (!systemContext) {
      systemContext = await assembleContext(req.user.id, categoryId, { mode, episodeCtx, activeEpisodeId })
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

    // ── Auto-commit if triggered ─────────────────────────────────────────────────
    if (isCommitCmd) {
      try {
        const { messages: h } = await loadHistory(req.user.id, categoryId, mode)
        if (h.length >= 2) {
          const extractRes = await client.messages.create({
            model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
            max_tokens: 500,
            system:     'Extract the episode plan from this conversation as compact JSON only. No preamble, no markdown. Fields: {"track_name":string,"summary":string,"themes":string[],"mood":string,"thumbnail_concept":string}. thumbnail_concept should be a one-sentence description of the visual moment that would stop the viewer mid-scroll — the image, expression, or scene that encapsulates the episode. If no thumbnail has been discussed, infer the most compelling visual from the summary. If no clear plan exists return {}.',
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

            // Save to history
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
        // Fall through to normal response
      }
    }

    // Build message list — current mode history + cross-mode context
    const historyForClaude = [
      ...crossContext,
      ...dbHistory.slice(-30),
    ].map(m => ({ role: m.role, content: m.content }))

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

    // Persist full history — auto-saves every message, no manual save needed
    if (categoryId) {
      const updatedHistory = [
        ...dbHistory,
        { role: 'user',      content: message,      timestamp: new Date().toISOString() },
        { role: 'assistant', content: fullResponse,  timestamp: new Date().toISOString() },
      ]
      await saveHistory(req.user.id, categoryId, mode, updatedHistory)

      // Post-message extraction — runs async, non-blocking
      // Every 5 messages: extract learnings and check for voice profile updates
      if (updatedHistory.length % 5 === 0) {
        extractLearnings(req.user.id, categoryId, updatedHistory.slice(-10), fullResponse, message)
          .catch(err => console.warn('[extract] Failed:', err.message))
      }

      // Always check for voice profile corrections in the user's last message
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
      system:     'Extract episode planning data as JSON only. No preamble. Return: { "track_name": string, "episode_number": number|null, "mood": string, "summary": string, "themes": string[], "callback_seeds": string[], "targetDurationMinutes": number, "thumbnail_concept": string }. thumbnail_concept is a one-sentence visual description of the thumbnail moment — the image that would stop the viewer mid-scroll. Infer from the episode summary if not explicitly discussed.',
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
  const { text } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'text required' })

  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'TTS not configured — add ELEVENLABS_API_KEY to Railway' })
  }

  try {
    // Use creator's voice clone if available, fall back to env default
    let voiceId = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
    if (categoryId) {
      const { data: cat } = await supabase
        .from('categories')
        .select('voice_profile')
        .eq('id', categoryId)
        .eq('user_id', req.user.id)
        .single()
        .catch(() => ({ data: null }))
      if (cat?.voice_profile?.elevenLabsVoiceId) {
        voiceId = cat.voice_profile.elevenLabsVoiceId
      }
    }
    const clean   = text
      .replace(/#+\s*/g, '')        // remove markdown headers
      .replace(/\*+/g, '')          // remove bold/italic
      .replace(/`[^`]*`/g, '')      // remove code
      .replace(/\[[^\]]*\]/g, '')   // remove links
      .slice(0, 500)                // cap at 500 chars per call

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
            stability:        0.45,
            similarity_boost: 0.80,
            style:            0.0,
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

    // Stream audio directly to client
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


// ── POST /api/chat/onboard — KB voice profile interview ──────────────────────
// Runs a conversational onboarding. Client sends { categoryId, message, history }
// KB asks 6 questions one at a time. On the final answer it extracts + saves the
// voice profile, then sends onboardingComplete: true in the done event.
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

    // FIX: explicit no-markdown instruction added to prevent raw symbols in chat
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

    // First message — KB opens the conversation
    if (messages.length === 0) {
      messages.push({ role: 'user', content: 'start' })
    }

    // FIX: max_tokens raised from 400 → 1200. The JSON block alone is ~300 tokens;
    // 400 was guaranteed to truncate mid-JSON on the final turn, silently breaking
    // the regex extraction and leaving the user in the onboarding loop forever.
    const stream = await client.messages.stream({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 1200,
      system:     SYSTEM,
      messages,
    })

    // FIX: accumulate the FULL response before streaming anything to the client.
    // The previous approach filtered chunks during streaming — if the ===VOICE_PROFILE===
    // tag split across two chunks, the toggle fired twice and the JSON leaked to the
    // client. Accumulating first then stripping is safe and simple.
    let full = ''
    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
        full += chunk.delta.text
      }
    }

    console.log('[onboard] full response length:', full.length, '| preview:', full.slice(0, 120))

    // FIX: split-based extraction instead of greedy regex.
    // The old regex /===VOICE_PROFILE===\s*({[\s\S]*?})\s*===VOICE_PROFILE===/ used a
    // lazy match on `{...}` which stops at the first `}` — breaking on any nested object
    // in the profile JSON. Split on the delimiter instead to grab everything between the tags.
    let voiceProfileSaved = false
    let cleanResponse = full

    if (full.includes('===VOICE_PROFILE===')) {
      const parts = full.split('===VOICE_PROFILE===')
      // parts[0] = text before opening tag
      // parts[1] = the JSON block
      // parts[2] = text after closing tag (the warm closing sentence)
      const jsonRaw = parts[1]?.trim()
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

      // Show the text before the tag + anything after the closing tag (warm close sentence)
      // Strip any leftover whitespace artifacts
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
// KB edits a storyboard frame directly from chat.
// Body: { frameId, description, notes, shot_type }

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

// ── POST /api/chat/thumbnail-prompt ──────────────────────────────────────────
// Generates a Flux-ready thumbnail prompt based on:
// - The episode plan (track_name, summary, thumbnail_concept)
// - The audience model (what triggers clicks for this specific viewer)
// - The creator's voice profile (their brand aesthetic)
// Returns a copyable prompt ready to paste into Flux or Ideogram.

router.post('/thumbnail-prompt', async (req, res) => {
  const { categoryId, episodeId, plannedEpisodeId } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  try {
    // Load category for audience model + voice profile
    const { data: cat } = await supabase
      .from('categories')
      .select('niche, name, audience_model, voice_profile')
      .eq('id', categoryId)
      .single()

    // Load reaction images for thumbnail compositing
    const { data: reactionImages } = await supabase
      .from('creator_assets')
      .select('tag, file_name, storage_url')
      .eq('user_id', req.user.id)
      .eq('category_id', categoryId)
      .eq('asset_type', 'reaction')
      .order('created_at', { ascending: false })
      .limit(10)

    // Load episode or planned episode for context
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

    // Build audience context string
    const audience = cat?.audience_model?.geminiInsights
    const ytAudience = cat?.audience_model?.youtube
    const audienceStr = audience ? [
      audience.primaryAudience?.ageRange && `Viewer: ${audience.primaryAudience.ageRange}`,
      audience.psychographics?.corePainPoint && `Pain point: ${audience.psychographics.corePainPoint}`,
      audience.psychographics?.coreAspiration && `Aspiration: ${audience.psychographics.coreAspiration}`,
      audience.thumbnailPsychology?.emotionalTriggers?.length && `Click triggers: ${audience.thumbnailPsychology.emotionalTriggers.join(', ')}`,
      audience.thumbnailPsychology?.visualPatterns && `Visual patterns that work: ${audience.thumbnailPsychology.visualPatterns}`,
    ].filter(Boolean).join('\n') : 'No audience data yet — using niche knowledge.'

    const ytStr = ytAudience?.devices?.[0]
      ? `Primary device: ${ytAudience.devices[0].device} (${ytAudience.devices[0].pct}% of views)`
      : ''

    // Generate the Flux prompt
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
Thumbnail concept: ${episodeContext.thumbnail_concept || 'not specified — infer the most compelling visual from the episode summary'}
Themes: ${(episodeContext.themes || []).join(', ') || 'not specified'}
Niche: ${cat?.niche || 'content creation'}

Audience intelligence:
${audienceStr}
${ytStr}

${reactionImages?.length ? `Creator reaction images available (use one of these):
${reactionImages.map(r => `[${r.tag}]: ${r.file_name}`).join('\n')}
Choose the tag that best matches the episode emotional hook. In the Flux prompt, describe the environment/background to composite around the creator. Include: "Reference image provided. Do NOT alter the face, expression, or skin tone. Composite only. No text overlays."` : 'No reaction images uploaded yet — describe a photorealistic scene without the creator face.'}

The thumbnail must emotionally resonate with this specific viewer. What visual moment would make them stop scrolling? Write the Flux prompt now.`,
      }],
    })

    const fluxPrompt = promptRes.content[0]?.text?.trim() || ''

    // Also generate title formulas based on audience
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
Title formulas that work for this audience: ${audience?.thumbnailPsychology?.titleFormulas?.join(' | ') || 'not researched yet'}

Write titles that speak directly to the pain point or aspiration. No clickbait, no generic hooks.`,
      }],
    })

    const titleOptions = (titleRes.content[0]?.text || '').trim().split('\n').filter(Boolean)

    res.json({
      fluxPrompt,
      titleOptions,
      thumbnailConcept:  episodeContext.thumbnail_concept || '',
      audienceUsed:      !!audience,
      reactionImages:    reactionImages || [],
    })

  } catch (err) {
    console.error('[thumbnail-prompt]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/chat/voice-clone ────────────────────────────────────────────────
// Initiates ElevenLabs voice clone training from an uploaded audio file.
// Body: multipart/form-data — file (audio), categoryId
// After training completes, stores the voice ID in voice_profile.elevenLabsVoiceId

const multerClone = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } })

router.post('/voice-clone', multerClone.single('file'), async (req, res) => {
  const { categoryId } = req.body
  if (!categoryId)  return res.status(400).json({ error: 'categoryId required' })
  if (!req.file)    return res.status(400).json({ error: 'Audio file required' })
  if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'ElevenLabs not configured' })

  try {
    // Fetch category for naming the clone
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
        headers: {
          ...form.getHeaders(),
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    )

    const voiceId = cloneRes.data.voice_id
    if (!voiceId) throw new Error('No voice ID returned from ElevenLabs')

    // Store in voice_profile
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

// ── POST /api/chat/generate-episode ───────────────────────────────────────────────
// KB extracts a plan from conversation then triggers full episode generation
// Returns SSE stream — same format as /episodes/generate
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

    // Load conversation history
    const { messages: history } = await loadHistory(req.user.id, categoryId, mode || 'series')
    const recentMessages = history.slice(-20)

    if (!recentMessages.length) {
      send('error', { message: 'No conversation to generate from — discuss an episode with KB first' })
      clearInterval(keepalive)
      return res.end()
    }

    // Extract structured plan from conversation
    const extraction = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 600,
      system:     'Extract episode plan as JSON only. No preamble. Return: { "track_name": string, "episode_number": number|null, "mood": string, "targetDurationMinutes": number, "summary": string, "themes": string[], "voiceMemoText": string }. voiceMemoText should be 2-3 sentences summarising what the creator wants to say in this episode.',
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

    // Forward to the generate endpoint via internal fetch
    const generateRes = await fetch(`http://localhost:${process.env.PORT || 3001}/api/episodes/generate`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': req.headers.authorization,
      },
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

    // Pipe the SSE stream through
    const reader = generateRes.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      res.write(chunk)
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
// Runs async after every 5 messages. Extracts learnings and writes to kb_learnings.

async function extractLearnings(userId, categoryId, recentMessages, lastResponse, lastMessage) {
  const conversation = recentMessages
    .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
    .join('\n')

  const extraction = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 400,
    system:     'Extract creative learnings from this conversation. Return ONLY valid JSON, no preamble. Fields: { "insights": string[], "preferences": string[], "episodeIdeas": string[], "voiceNotes": string[] }. insights = things learned about what works for this creator. preferences = stated likes/dislikes. episodeIdeas = any episode concepts mentioned. voiceNotes = anything about how they communicate. Return empty arrays if nothing relevant. Max 3 items per array.',
    messages:   [{ role: 'user', content: conversation }],
  })

  let learnings = {}
  try {
    learnings = JSON.parse(extraction.content[0]?.text?.replace(/```json|```/g, '').trim() || '{}')
  } catch { return }

  // Only save if there's something meaningful
  const hasContent = Object.values(learnings).some(v => Array.isArray(v) && v.length > 0)
  if (!hasContent) return

  await supabase.from('kb_learnings').insert({
    user_id:     userId,
    category_id: categoryId,
    insights:    learnings.insights    || [],
    preferences: learnings.preferences || [],
    episode_ideas: learnings.episodeIdeas || [],
    voice_notes: learnings.voiceNotes  || [],
    extracted_at: new Date().toISOString(),
  })
}

// ── VOICE PROFILE LIVE UPDATE ─────────────────────────────────────────────────
// Detects when the creator corrects or refines their voice profile mid-conversation
// and patches the category voice_profile immediately.

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
    system:     'Detect if the creator is correcting or refining their voice profile. Return ONLY valid JSON: { "hasUpdate": boolean, "field": string, "oldValue": string, "newValue": string, "path": string }. path is the dot-notation path in the voice_profile object to update (e.g. "languageFingerprint.avoidPhrases", "voiceCharacteristics.rhythmNote"). If no clear voice correction, return { "hasUpdate": false }.',
    messages:   [{ role: 'user', content: `Creator said: "${userMessage}"\n\nCurrent voice profile: ${JSON.stringify(cat.voice_profile).slice(0, 500)}\n\nIs this a voice profile correction?` }],
  })

  let update = {}
  try {
    update = JSON.parse(detection.content[0]?.text?.replace(/```json|```/g, '').trim() || '{}')
  } catch { return }

  if (!update.hasUpdate || !update.path || !update.newValue) return

  // Apply the update via dot-notation path
  const vp = { ...cat.voice_profile }
  const parts = update.path.split('.')
  let obj = vp
  for (let i = 0; i < parts.length - 1; i++) {
    if (!obj[parts[i]]) obj[parts[i]] = {}
    obj = obj[parts[i]]
  }
  const lastKey = parts[parts.length - 1]

  // Handle array fields (avoidPhrases, signaturePhrases etc.)
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

  // Bust context cache so next message sees the update
  const { invalidateContext } = require('./contextAssembler')  // already imported
  // Note: invalidateContext is already available from the contextAssembler require at top
  console.log(`[voice-update] Patched ${update.path} for category ${categoryId}`)
}

// FIX: module.exports moved to end of file — it was previously mid-file which
// caused the duplicate session routes below it to be unreachable/ambiguous.
module.exports = router;