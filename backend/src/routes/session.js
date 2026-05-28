// backend/src/routes/session.js
// Companion app session journal API.
// Records timestamped utterances, processes them with Claude
// into a structured voice memo ready for episode generation.

const express    = require('express')
const Anthropic  = require('@anthropic-ai/sdk')
const multer     = require('multer')
const { supabase } = require('../utils/supabase')

const router = express.Router()
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── CREATE SESSION ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { categoryId, title } = req.body

  const { data, error } = await supabase
    .from('session_journals')
    .insert({
      user_id:     req.user.id,
      category_id: categoryId || null,
      title:       title || `Session ${new Date().toLocaleDateString()}`,
      status:      'recording',
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ session: data })
})

// ─── ADD ENTRY (utterance or marker) ─────────────────────────────────────────

router.post('/:id/entry', async (req, res) => {
  const { text, type = 'speech', timestampMs, energy = 0.5 } = req.body

  // Get current entries
  const { data: session } = await supabase
    .from('session_journals')
    .select('entries, duration_ms')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const entries = session.entries || []
  const newEntry = {
    id:          `entry-${Date.now()}`,
    timestamp_ms: timestampMs || entries.reduce((max, e) => Math.max(max, e.timestamp_ms || 0), 0) + 1000,
    text:        text?.trim() || '',
    type,        // 'speech' | 'marker' | 'note'
    energy:      parseFloat(energy),
  }

  entries.push(newEntry)

  await supabase
    .from('session_journals')
    .update({
      entries,
      duration_ms: Math.max(session.duration_ms || 0, newEntry.timestamp_ms),
      updated_at:  new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ entry: newEntry, totalEntries: entries.length })
})

// ─── BATCH ENTRIES (from client Whisper processing) ──────────────────────────

router.post('/:id/entries/batch', async (req, res) => {
  const { entries } = req.body
  if (!entries?.length) return res.status(400).json({ error: 'entries array required' })

  const { data: session } = await supabase
    .from('session_journals')
    .select('entries, duration_ms')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const existing   = session.entries || []
  const merged     = [...existing, ...entries]
    .sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))

  const maxTime = merged.reduce((max, e) => Math.max(max, e.timestamp_ms || 0), 0)

  await supabase
    .from('session_journals')
    .update({
      entries:     merged,
      duration_ms: maxTime,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ totalEntries: merged.length })
})

// ─── PROCESS SESSION → VOICE MEMO ────────────────────────────────────────────

router.post('/:id/process', async (req, res) => {
  console.info('[process] Request received for session:', req.params.id)
  const { data: session } = await supabase
    .from('session_journals')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const entries = session.entries || []
  if (!entries.length) return res.status(400).json({ error: 'No entries to process' })

  // Guard: if only marker entries exist with no speech text, Claude gets a blank prompt
  const speechEntries = entries.filter(e => e.text?.trim() && e.type !== 'marker')
  const markerEntries = entries.filter(e => e.type === 'marker')

  if (!speechEntries.length && markerEntries.length > 0) {
    // Markers only — generate a minimal memo from just the marks
    const markerMemo = markerEntries
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
      .map(e => `At ${formatMs(e.timestamp_ms)}: ${e.text || 'marked moment'}`)
      .join('\n')

    await supabase.from('session_journals').update({
      transcript:      markerMemo,
      voice_memo_text: `Session with ${markerEntries.length} marked moment${markerEntries.length > 1 ? 's' : ''}.\n\n${markerMemo}`,
      key_moments:     markerEntries.map(e => ({ timestampMs: e.timestamp_ms, description: e.text || 'marked moment', timestampFmt: formatMs(e.timestamp_ms) })),
      status:          'ready',
      updated_at:      new Date().toISOString(),
    }).eq('id', req.params.id).eq('user_id', req.user.id)

    return res.json({ voiceMemoText: markerMemo, keyMoments: [], transcript: markerMemo })
  }

  if (!speechEntries.length) {
    return res.status(400).json({ error: 'No transcribed speech found. Try speaking during the session.' })
  }

  // Build a chronological narrative from entries
  const transcript = entries
    .filter(e => e.text?.trim())
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
    .map(e => {
      const mins = Math.floor((e.timestamp_ms || 0) / 60000)
      const secs = Math.floor(((e.timestamp_ms || 0) % 60000) / 1000)
      const time = `${mins}:${String(secs).padStart(2, '0')}`
      const prefix = e.type === 'marker' ? `[MARK ${time}]` : `[${time}]`
      return `${prefix} ${e.text}`
    })
    .join('\n')

  // Ask Claude to synthesise into a coherent voice memo
  console.info('[process] Calling Claude, transcript length:', transcript.length)
  let response
  try {
    response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `This is a raw session journal from a music producer recorded while making a track.
Convert it into a 2-3 paragraph voice memo in their natural speaking voice.
Keep timestamps for any [MARK] moments — those are important visual cues.
Be concise and vivid. This will be used to generate a YouTube documentary episode.

RAW JOURNAL:
${transcript}

Return ONLY the voice memo text, no preamble.`
    }]
  })

  } catch (err) {
    return res.status(502).json({ error: 'Claude API unavailable — try again shortly: ' + err.message })
  }

  const voiceMemoText = response.content[0].text.trim()

  // ── Energy/pacing analysis ──────────────────────────────────────────────────
  // Read the energy values recorded throughout the session and extract
  // the creator's creative state — what excited them, where they slowed down.
  const energyEntries = entries.filter(e => e.energy != null && e.text)
  if (energyEntries.length >= 3) {
    try {
      const avgEnergy = energyEntries.reduce((s, e) => s + parseFloat(e.energy || 0), 0) / energyEntries.length
      const highMoments = energyEntries
        .filter(e => parseFloat(e.energy) > 0.7)
        .map(e => e.text.slice(0, 80))
        .slice(0, 4)
      const lowMoments = energyEntries
        .filter(e => parseFloat(e.energy) < 0.3)
        .map(e => e.text.slice(0, 80))
        .slice(0, 3)

      // Ask Claude to extract creative state insights
      const insightRes = await client.messages.create({
        model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
        max_tokens: 250,
        system:     'Extract creative state insights. Return ONLY JSON: { "energyNote": string, "excitedAbout": string[], "struggling": string[] }. Max 2 items per array. Short, specific, actionable.',
        messages: [{
          role: 'user',
          content: `Session energy avg: ${(avgEnergy * 100).toFixed(0)}%
High energy moments: ${highMoments.join(' | ') || 'none'}
Low energy moments:  ${lowMoments.join(' | ') || 'none'}
Full memo: ${voiceMemoText.slice(0, 400)}`,
        }],
      })

      const stateInsight = JSON.parse(
        insightRes.content[0]?.text?.replace(/\`\`\`json|\`\`\`/g, '').trim() || '{}'
      )

      // Write to kb_learnings as voice notes about creative state
      if (stateInsight.energyNote || stateInsight.excitedAbout?.length) {
        const { categoryId: sessionCatId } = await supabase
          .from('session_journals')
          .select('category_id')
          .eq('id', req.params.id)
          .single()
          .then(r => r.data || {})

        if (sessionCatId) {
          await supabase.from('kb_learnings').insert({
            user_id:     req.user.id,
            category_id: sessionCatId,
            insights:    stateInsight.energyNote ? [`Session energy ${(avgEnergy*100).toFixed(0)}%: ${stateInsight.energyNote}`] : [],
            preferences: [],
            voice_notes: stateInsight.excitedAbout || [],
            episode_ideas: [],
            extracted_at: new Date().toISOString(),
          })
        }
      }
    } catch (err) {
      console.warn('[session/energy] Analysis failed:', err.message)
    }
  }

  // Extract key moments (MARK entries)
  const keyMoments = entries
    .filter(e => e.type === 'marker')
    .map(e => ({
      timestampMs:  e.timestamp_ms,
      description:  e.text,
      timestampFmt: formatMs(e.timestamp_ms),
    }))

  // Save processed data
  await supabase
    .from('session_journals')
    .update({
      transcript:      transcript,
      voice_memo_text: voiceMemoText,
      key_moments:     keyMoments,
      status:          'ready',
      updated_at:      new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ voiceMemoText, keyMoments, transcript })
})

// ─── LIST SESSIONS ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { categoryId, status } = req.query

  let query = supabase
    .from('session_journals')
    .select('id, title, status, duration_ms, key_moments, voice_memo_text, recorded_at, episode_id')
    .eq('user_id', req.user.id)
    .order('recorded_at', { ascending: false })
    .limit(20)

  if (categoryId) query = query.eq('category_id', categoryId)
  if (status)     query = query.eq('status', status)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ sessions: data || [] })
})

// ─── GET SINGLE SESSION ───────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('session_journals')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Session not found' })
  res.json({ session: data })
})

// ─── UPDATE SESSION TITLE ────────────────────────────────────────────────────

router.patch('/:id/title', async (req, res) => {
  const { title } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })

  const { data, error } = await supabase
    .from('session_journals')
    .update({ title: title.trim(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select('id, title')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ session: data })
})

// ─── LINK SESSION TO EPISODE ──────────────────────────────────────────────────

router.patch('/:id/link', async (req, res) => {
  const { episodeId } = req.body

  const { data, error } = await supabase
    .from('session_journals')
    .update({
      episode_id:        episodeId,
      synced_to_episode: true,
      status:            'used',
      updated_at:        new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ session: data })
})

// ─── STANDALONE TRANSCRIBE (full VO audio → word timestamps) ─────────────────
// POST /api/session/standalone/transcribe
// Receives a full VO recording (MP3/WAV/WebM) uploaded from the Teleprompter.
// Returns Whisper output with word-level timestamps for VO alignment.
// Auth required — no session ID needed.

const standaloneUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

router.post('/standalone/transcribe', standaloneUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({
        error: 'OPENAI_API_KEY not configured — add it to your Railway environment variables to enable VO alignment',
      })
    }

    const FormData = require('form-data')
    const axios    = require('axios')
    const form     = new FormData()

    // Detect format from mimetype or filename
    const ext      = (req.file.originalname || 'audio.webm').split('.').pop().toLowerCase()
    const mimetype = req.file.mimetype || `audio/${ext}`

    form.append('file', req.file.buffer, {
      filename:    req.file.originalname || `vo-recording.${ext}`,
      contentType: mimetype,
    })
    form.append('model', 'whisper-1')
    form.append('language', 'en')
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'word')

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
        timeout:          120000,   // 2min — large files can take a while
      }
    )

    const { text, words = [], segments = [], duration } = response.data

    // Normalise word objects — Whisper returns { word, start, end }
    const normalisedWords = words.map(w => ({
      word:    w.word?.trim().replace(/[^\w']/g, '') || '',
      startMs: Math.round((w.start || 0) * 1000),
      endMs:   Math.round((w.end   || 0) * 1000),
    })).filter(w => w.word)

    res.json({
      text,
      words:      normalisedWords,
      wordCount:  normalisedWords.length,
      durationMs: Math.round((duration || 0) * 1000),
      segments:   segments.map(s => ({
        text:    s.text,
        startMs: Math.round(s.start * 1000),
        endMs:   Math.round(s.end   * 1000),
      })),
    })

  } catch (err) {
    console.error('[session/standalone/transcribe]', err.response?.data || err.message)
    const msg = err.response?.data?.error?.message || err.message
    res.status(502).json({ error: 'Whisper transcription failed: ' + msg })
  }
})

// ─── TRANSCRIBE AUDIO CHUNK (companion app) ─────────────────────────────────

const { handleTranscribe, upload } = require('./session/transcribe')
router.post('/:id/transcribe', upload.single('audio'), handleTranscribe)

// ─── DELETE SESSION ───────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  await supabase
    .from('session_journals')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
  res.json({ deleted: true })
})

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatMs(ms) {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

 // ── POST /api/session/index-audio ─────────────────────────────────────────────
// Accepts a large audio file (extracted from video) and transcribes it in
// sequential 20MB chunks. Returns full transcript with running timecodes.
// Use this after exporting audio from DaVinci as MP3.

const audioIndexUpload = require('multer')({
  storage: require('multer').memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },  // 500MB max
})

router.post('/index-audio', audioIndexUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' })

  const { categoryId, title = 'Indexed Audio' } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  const CHUNK_SIZE = 20 * 1024 * 1024  // 20MB per Whisper call
  const totalSize  = req.file.size
  const chunks     = Math.ceil(totalSize / CHUNK_SIZE)
  const allSegments = []
  let   runningOffsetSec = 0

  console.log(`[index-audio] ${req.file.originalname} — ${Math.round(totalSize/1024/1024)}MB, ${chunks} chunks`)

  const axios    = require('axios')
  const FormData = require('form-data')
  const rawMime  = req.file.mimetype || 'audio/mpeg'
  const baseMime = rawMime.split(';')[0].trim()
  const extMap   = { 'audio/mpeg':'mp3','audio/mp4':'mp4','audio/webm':'webm','audio/wav':'wav','audio/ogg':'ogg','audio/x-m4a':'m4a' }
  const ext      = extMap[baseMime] || 'mp3'

  try {
    for (let i = 0; i < chunks; i++) {
      const start  = i * CHUNK_SIZE
      const end    = Math.min(start + CHUNK_SIZE, totalSize)
      const chunk  = req.file.buffer.slice(start, end)

      const form = new FormData()
      form.append('file', chunk, { filename: `chunk_${i}.${ext}`, contentType: baseMime })
      form.append('model', 'whisper-1')
      form.append('language', 'en')
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'segment')

      const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      })

      const segs = response.data?.segments || []
      for (const seg of segs) {
        allSegments.push({
          start: runningOffsetSec + seg.start,
          end:   runningOffsetSec + seg.end,
          text:  seg.text.trim(),
        })
      }

      // Estimate offset for next chunk based on audio duration ratio
      const chunkDuration = response.data?.duration || (CHUNK_SIZE / (128 * 1024 / 8))  // 128kbps estimate
      runningOffsetSec += chunkDuration

      console.log(`[index-audio] Chunk ${i+1}/${chunks} done — ${segs.length} segments`)
    }

    // Build full transcript with timecodes
    const fullTranscript = allSegments
      .map(s => {
        const m = Math.floor(s.start / 60)
        const sec = Math.floor(s.start % 60).toString().padStart(2, '0')
        return '[' + m + ':' + sec + '] ' + s.text
      })
      .join('\n')

    // Save as a session journal so KB can read it
    const { data: session } = await supabase
      .from('session_journals')
      .insert({
        user_id:         req.user.id,
        category_id:     categoryId,
        title:           title,
        voice_memo_text: fullTranscript.slice(0, 8000),  // save up to 8K chars
        transcript:      fullTranscript,
        created_at:      new Date().toISOString(),
      })
      .select()
      .single()

    res.json({
      success:     true,
      segments:    allSegments.length,
      duration:    Math.round(runningOffsetSec),
      transcript:  fullTranscript,
      sessionId:   session?.id,
    })
  } catch (err) {
    console.error('[index-audio]', err.response?.data || err.message)
    res.status(500).json({ error: err.response?.data?.error?.message || err.message })
  }
})

module.exports = router