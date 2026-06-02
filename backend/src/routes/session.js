// backend/src/routes/session.js
// Session journal API.
// index-audio now uses async job pattern:
//   POST /session/index-audio        → returns jobId immediately (202)
//   GET  /session/index-audio/:jobId → poll for status/result

const express    = require('express')
const Anthropic  = require('@anthropic-ai/sdk')
const multer     = require('multer')
const { supabase } = require('../utils/supabase')

const router = express.Router()
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── IN-MEMORY JOB STORE ──────────────────────────────────────────────────────
// Stores active transcription jobs. Survives for the lifetime of the process.
// On Railway this is fine — jobs complete within minutes.
// If you scale to multiple instances, swap this for a Supabase table.

const jobs = new Map()
// job shape: { id, userId, status, progress, total, transcript, sessionId, error, createdAt }

function makeJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

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

// ─── INDEX AUDIO — ASYNC JOB PATTERN ─────────────────────────────────────────
// POST /api/session/index-audio
// Returns 202 immediately with a jobId.
// Background worker transcribes chunks and writes progress to the jobs map.
// Frontend polls GET /api/session/index-audio/:jobId for status.
//
// Uses diskStorage instead of memoryStorage so large files never load into RAM.
// Chunks are read from disk 20MB at a time — max RAM usage stays flat.

const fs   = require('fs')
const path = require('path')
const os   = require('os')

const audioIndexUpload = multer({
  // Write to OS temp dir — never loads full file into RAM
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename:    (req, file, cb) => cb(null, `whispa-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },  // 500MB
})

router.post('/index-audio', express.json(), async (req, res) => {
  const { audioUrl, storagePath, categoryId, title = 'Indexed Audio', fileSizeMb } = req.body
  if (!audioUrl)   return res.status(400).json({ error: 'audioUrl required' })
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' })

  const jobId = makeJobId()
  jobs.set(jobId, {
    id: jobId, userId: req.user.id, status: 'processing',
    progress: 0, total: 0, transcript: null, sessionId: null, error: null, createdAt: Date.now(),
  })

  res.status(202).json({ jobId, status: 'processing' })

  // ── Background worker ───────────────────────────────────────────────────────
  ;(async () => {
    const job         = jobs.get(jobId)
    const CHUNK_SECS  = 600
    const MAX_CHUNK_MB = 24
    const allSegments = []
    const tmpChunks   = []
    let   tempFilePath = null

    const axios    = require('axios')
    const FormData = require('form-data')
    const ffmpeg   = require('fluent-ffmpeg')

    try { ffmpeg.setFfmpegPath(require('ffmpeg-static')) } catch {}

    try {
      // ── Step 1: Download from Supabase Storage ──────────────────────────────
      // Server-to-server — fast, no Railway proxy timeout
      console.log(`[index-audio] job=${jobId} — downloading (${fileSizeMb || '?'}MB)`)
      tempFilePath = path.join(os.tmpdir(), `whispa-${jobId}.audio`)

      const dlRes = await axios.get(audioUrl, {
        responseType: 'stream',
        timeout:      0,          // no timeout on the connection itself
        maxRedirects: 5,
        httpAgent:    new (require('http').Agent)({ keepAlive: true }),
        httpsAgent:   new (require('https').Agent)({ keepAlive: true }),
      })
      await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(tempFilePath)
        dlRes.data.pipe(writer)
        dlRes.data.on('error', reject)
        writer.on('finish', resolve)
        writer.on('error', reject)
      })
      console.log(`[index-audio] job=${jobId} — downloaded OK`)

      // ── Step 2: Get duration via ffprobe ──────────────────────────────────
      const totalSecs = await new Promise(resolve => {
        const ffmpeg_ = require('fluent-ffmpeg')
        ffmpeg_.ffprobe(tempFilePath, ['-analyzeduration', '100M', '-probesize', '100M'], (err, meta) => {
          resolve(err ? 0 : Math.ceil(meta?.format?.duration || 0))
        })
      })

      // When ffprobe can't determine duration (returns 0), extract the whole
      // file as ONE chunk at very low bitrate to stay under Whisper's 25MB limit.
      // 32kbps mono = ~14MB/hour — safe for files up to ~1.5hrs.
      const durationUnknown = totalSecs === 0
      const numChunks = durationUnknown ? 1 : Math.max(1, Math.ceil(totalSecs / CHUNK_SECS))
      job.total = numChunks
      console.log(`[index-audio] job=${jobId} — ${durationUnknown ? 'duration unknown, single chunk' : Math.round(totalSecs/60) + 'min, ' + numChunks + ' chunk(s)'}`)

      // ── Extract + transcribe each time-based chunk ──────────────────────────
      for (let i = 0; i < numChunks; i++) {
        const startSec  = i * CHUNK_SECS
        const chunkPath = path.join(os.tmpdir(), `wc-chunk-${jobId}-${i}.mp3`)
        tmpChunks.push(chunkPath)

        await new Promise((resolve, reject) => {
          const cmd = ffmpeg(tempFilePath)
            .inputOptions(['-analyzeduration', '100M', '-probesize', '100M'])
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate(durationUnknown ? '32k' : '64k')  // lower bitrate when unknown duration
            .audioChannels(1)
            .audioFrequency(16000)
            .output(chunkPath)
          if (!durationUnknown && startSec > 0) cmd.seekInput(startSec)
          if (!durationUnknown) cmd.duration(CHUNK_SECS)
          cmd.on('end', resolve).on('error', reject).run()
        })

        const chunkStat = fs.statSync(chunkPath)
        console.log(`[index-audio] chunk ${i+1}/${numChunks} extracted: ${Math.round(chunkStat.size/1024/1024)}MB`)

        if (chunkStat.size < 1024) {
          console.log(`[index-audio] chunk ${i+1} empty — done`)
          break
        }
        if (chunkStat.size > MAX_CHUNK_MB * 1024 * 1024) {
          console.warn(`[index-audio] chunk ${i+1} still too large (${Math.round(chunkStat.size/1024/1024)}MB) — skipping`)
          continue
        }

        // Send to Whisper
        const form = new FormData()
        form.append('file', fs.createReadStream(chunkPath), { filename: `chunk_${i}.mp3`, contentType: 'audio/mpeg' })
        form.append('model', 'whisper-1')
        form.append('language', 'en')
        form.append('response_format', 'verbose_json')
        form.append('timestamp_granularities[]', 'word')
        form.append('timestamp_granularities[]', 'segment')

        const response = await axios.post(
          'https://api.openai.com/v1/audio/transcriptions',
          form,
          {
            headers:          { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
            maxBodyLength:    Infinity,
            maxContentLength: Infinity,
            timeout:          0,  // no timeout — a 14MB file can take 3-5 mins
          }
        )

        const segs = response.data?.segments || []
        for (const seg of segs) {
          allSegments.push({
            start: startSec + seg.start,
            end:   startSec + seg.end,
            text:  seg.text.trim(),
          })
        }

        job.progress = i + 1
        console.log(`[index-audio] job=${jobId} chunk ${i+1}/${numChunks} done — ${segs.length} segs`)

        // Clean up chunk immediately to save disk space
        try { fs.unlinkSync(chunkPath) } catch {}
      }

      // Build full transcript with second-level timecodes from word timestamps
      // Format: [M:SS] text — one line per segment for KB readability
      // Word-level data is also stored for EDL precision cutting
      const fullTranscript = allSegments
        .map(s => {
          const m   = Math.floor(s.start / 60)
          const sec = Math.floor(s.start % 60).toString().padStart(2, '0')
          const ms  = Math.round((s.start % 1) * 1000).toString().padStart(3, '0')
          return `[${m}:${sec}.${ms}] ${s.text}`
        })
        .join('\n')

      // Save as session journal
      const durationMs = allSegments.length
        ? Math.round(allSegments[allSegments.length - 1].end * 1000)
        : 0

      const { data: session, error: insertError } = await supabase
        .from('session_journals')
        .insert({
          user_id:         req.user.id,
          category_id:     categoryId,
          title,
          voice_memo_text: fullTranscript,
          transcript:      fullTranscript,
          status:          'ready',
          duration_ms:     durationMs,
          key_moments:     allSegments.slice(0, 20).map(s => `[${Math.floor(s.start/60)}:${Math.floor(s.start%60).toString().padStart(2,'0')}] ${s.text.slice(0,60)}`),
          created_at:      new Date().toISOString(),
        })
        .select()
        .single()

      if (insertError) {
        console.error('[index-audio] Supabase insert error:', insertError.message)
      }

      // Mark job done
      job.status      = 'done'
      job.transcript  = fullTranscript
      job.sessionId   = session?.id
      job.segments    = allSegments.length
      job.duration    = allSegments.length ? Math.round(allSegments[allSegments.length - 1].end) : 0
      console.log(`[index-audio] job=${jobId} complete — ${allSegments.length} segments`)

      // Auto-expire job from memory after 30 minutes
      setTimeout(() => jobs.delete(jobId), 30 * 60 * 1000)

    } catch (err) {
      console.error(`[index-audio] job=${jobId} failed:`, err.response?.data || err.message)
      job.status = 'error'
      job.error  = err.response?.data?.error?.message || err.message
      setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000)
    } finally {
      // Always delete temp files — success or failure
      if (tempFilePath) { try { fs.unlinkSync(tempFilePath) } catch {} }
      tmpChunks.forEach(p => { try { fs.unlinkSync(p) } catch {} })
    }
  })()
})

// ─── POLL JOB STATUS ─────────────────────────────────────────────────────────
// GET /api/session/index-audio/:jobId
// Returns current job state. Frontend polls this every 4 seconds.
// Responses:
//   { status: 'processing', progress: 2, total: 7 }   — still running
//   { status: 'done', transcript, sessionId, segments, duration }
//   { status: 'error', error: '...' }
//   404 if job not found (expired or never existed)

router.get('/index-audio/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'Job not found or expired' })

  // Security: only the user who created the job can poll it
  if (job.userId !== req.user.id) return res.status(403).json({ error: 'Forbidden' })

  if (job.status === 'processing') {
    return res.json({ status: 'processing', progress: job.progress, total: job.total })
  }

  if (job.status === 'done') {
    return res.json({
      status:     'done',
      segments:   job.segments,
      duration:   job.duration,
      transcript: job.transcript,
      sessionId:  job.sessionId,
    })
  }

  return res.json({ status: 'error', error: job.error })
})

// ─── STANDALONE TRANSCRIBE (Teleprompter VO alignment) ───────────────────────

const standaloneUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },
})

router.post('/standalone/transcribe', standaloneUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured' })
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

// ─── TRANSCRIBE AUDIO CHUNK (legacy) ─────────────────────────────────────────

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

function formatMs(ms) {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

module.exports = router