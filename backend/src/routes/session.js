// backend/src/routes/session.js
// Session journal API.
// Upload audio files for transcription → saved as session journals
// that KB reads in every conversation.

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

// ─── INDEX AUDIO ─────────────────────────────────────────────────────────────
// POST /api/session/index-audio
// Upload a large audio file (MP3 exported from DaVinci or direct recording).
// Transcribes in sequential 20MB chunks with running timecodes.
// Saved as a session journal so KB reads it in every conversation.
// MUST be registered before /:id routes — Express matches top to bottom.

const audioIndexUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },  // 500MB max
})

router.post('/index-audio', audioIndexUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured — add it to Railway environment variables' })
  }

  const { categoryId, title = 'Indexed Audio' } = req.body
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  const CHUNK_SIZE      = 20 * 1024 * 1024  // 20MB per Whisper call
  const totalSize       = req.file.size
  const chunks          = Math.ceil(totalSize / CHUNK_SIZE)
  const allSegments     = []
  let   runningOffsetSec = 0

  console.log(`[index-audio] ${req.file.originalname} — ${Math.round(totalSize / 1024 / 1024)}MB, ${chunks} chunk(s)`)

  const axios    = require('axios')
  const FormData = require('form-data')
  const rawMime  = req.file.mimetype || 'audio/mpeg'
  const baseMime = rawMime.split(';')[0].trim()
  const extMap   = {
    'audio/mpeg':  'mp3',
    'audio/mp4':   'mp4',
    'audio/webm':  'webm',
    'audio/wav':   'wav',
    'audio/ogg':   'ogg',
    'audio/x-m4a': 'm4a',
  }
  const ext = extMap[baseMime] || 'mp3'

  try {
    for (let i = 0; i < chunks; i++) {
      const start = i * CHUNK_SIZE
      const end   = Math.min(start + CHUNK_SIZE, totalSize)
      const chunk = req.file.buffer.slice(start, end)

      const form = new FormData()
      form.append('file', chunk, { filename: `chunk_${i}.${ext}`, contentType: baseMime })
      form.append('model', 'whisper-1')
      form.append('language', 'en')
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'segment')

      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          maxBodyLength:    Infinity,
          maxContentLength: Infinity,
          timeout:          180000,  // 3 min per chunk
        }
      )

      const segs = response.data?.segments || []
      for (const seg of segs) {
        allSegments.push({
          start: runningOffsetSec + seg.start,
          end:   runningOffsetSec + seg.end,
          text:  seg.text.trim(),
        })
      }

      // Advance running offset by this chunk's actual duration
      const chunkDuration = response.data?.duration || (chunk.length / (128 * 1024 / 8))
      runningOffsetSec += chunkDuration

      console.log(`[index-audio] Chunk ${i + 1}/${chunks} done — ${segs.length} segments, offset now ${Math.round(runningOffsetSec)}s`)
    }

    // Build full transcript with timecodes
    const fullTranscript = allSegments
      .map(s => {
        const m   = Math.floor(s.start / 60)
        const sec = Math.floor(s.start % 60).toString().padStart(2, '0')
        return `[${m}:${sec}] ${s.text}`
      })
      .join('\n')

    // Save as a session journal so KB can read it
    const { data: session, error: insertError } = await supabase
      .from('session_journals')
      .insert({
        user_id:         req.user.id,
        category_id:     categoryId,
        title:           title,
        voice_memo_text: fullTranscript.slice(0, 8000),
        transcript:      fullTranscript,
        status:          'ready',
        created_at:      new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      console.error('[index-audio] Supabase insert error:', insertError.message)
    }

    res.json({
      success:    true,
      segments:   allSegments.length,
      duration:   Math.round(runningOffsetSec),
      transcript: fullTranscript,
      sessionId:  session?.id,
    })
  } catch (err) {
    console.error('[index-audio]', err.response?.data || err.message)
    res.status(500).json({ error: err.response?.data?.error?.message || err.message })
  }
})

// ─── STANDALONE TRANSCRIBE (Teleprompter VO alignment) ───────────────────────
// POST /api/session/standalone/transcribe
// Receives a full VO recording and returns word-level timestamps.
// MUST also be above /:id routes.

const standaloneUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
})

router.post('/standalone/transcribe', standaloneUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({
      error: 'OPENAI_API_KEY not configured — add it to your Railway environment variables',
    })
  }

  try {
    const FormData = require('form-data')
    const axios    = require('axios')
    const form     = new FormData()

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
        headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
        timeout:          120000,
      }
    )

    const { text, words = [], segments = [], duration } = response.data

    const normalisedWords = words
      .map(w => ({
        word:    w.word?.trim().replace(/[^\w']/g, '') || '',
        startMs: Math.round((w.start || 0) * 1000),
        endMs:   Math.round((w.end   || 0) * 1000),
      }))
      .filter(w => w.word)

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

// ─── ADD ENTRY ────────────────────────────────────────────────────────────────

router.post('/:id/entry', async (req, res) => {
  const { text, type = 'speech', timestampMs, energy = 0.5 } = req.body

  const { data: session } = await supabase
    .from('session_journals')
    .select('entries, duration_ms')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const entries  = session.entries || []
  const newEntry = {
    id:           `entry-${Date.now()}`,
    timestamp_ms: timestampMs || entries.reduce((max, e) => Math.max(max, e.timestamp_ms || 0), 0) + 1000,
    text:         text?.trim() || '',
    type,
    energy:       parseFloat(energy),
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

// ─── BATCH ENTRIES ────────────────────────────────────────────────────────────

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

  const existing = session.entries || []
  const merged   = [...existing, ...entries]
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

  const speechEntries = entries.filter(e => e.text?.trim() && e.type !== 'marker')
  const markerEntries = entries.filter(e => e.type === 'marker')

  if (!speechEntries.length && markerEntries.length > 0) {
    const markerMemo = markerEntries
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
      .map(e => `At ${formatMs(e.timestamp_ms)}: ${e.text || 'marked moment'}`)
      .join('\n')

    await supabase.from('session_journals').update({
      transcript:      markerMemo,
      voice_memo_text: `Session with ${markerEntries.length} marked moment${markerEntries.length > 1 ? 's' : ''}.\n\n${markerMemo}`,
      key_moments:     markerEntries.map(e => ({
        timestampMs:  e.timestamp_ms,
        description:  e.text || 'marked moment',
        timestampFmt: formatMs(e.timestamp_ms),
      })),
      status:     'ready',
      updated_at: new Date().toISOString(),
    }).eq('id', req.params.id).eq('user_id', req.user.id)

    return res.json({ voiceMemoText: markerMemo, keyMoments: [], transcript: markerMemo })
  }

  if (!speechEntries.length) {
    return res.status(400).json({ error: 'No transcribed speech found.' })
  }

  const transcript = entries
    .filter(e => e.text?.trim())
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
    .map(e => {
      const mins = Math.floor((e.timestamp_ms || 0) / 60000)
      const secs = Math.floor(((e.timestamp_ms || 0) % 60000) / 1000)
      const time   = `${mins}:${String(secs).padStart(2, '0')}`
      const prefix = e.type === 'marker' ? `[MARK ${time}]` : `[${time}]`
      return `${prefix} ${e.text}`
    })
    .join('\n')

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

Return ONLY the voice memo text, no preamble.`,
      }],
    })
  } catch (err) {
    return res.status(502).json({ error: 'Claude API unavailable — try again shortly: ' + err.message })
  }

  const voiceMemoText = response.content[0].text.trim()

  const keyMoments = entries
    .filter(e => e.type === 'marker')
    .map(e => ({
      timestampMs:  e.timestamp_ms,
      description:  e.text,
      timestampFmt: formatMs(e.timestamp_ms),
    }))

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

// ─── UPDATE SESSION TITLE ─────────────────────────────────────────────────────

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

// ─── TRANSCRIBE AUDIO CHUNK (legacy — kept for any existing callers) ──────────

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

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function formatMs (ms) {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

module.exports = router