// backend/src/routes/editor/index.js
// All editor API routes. Mounts at /api/editor
// STATUS: FULLY WIRED — all handlers working

const express      = require('express')
const { supabase } = require('../../utils/supabase')
const clipIndexer  = require('../../services/vision/clipIndexer')
const visionMatcher = require('../../services/vision/visionMatcher')
const timelineBuilder = require('../../services/vision/timelineBuilder')

const router = express.Router()

// ─── CLIP INDEXING ────────────────────────────────────────────────────────────

/**
 * POST /api/editor/index/clip
 * Receive a single indexed clip from the browser (vectors computed client-side)
 * STATUS: READY
 */
router.post('/index/clip', async (req, res) => {
  const { categoryId, clipData } = req.body
  if (!clipData?.filepath) return res.status(400).json({ error: 'clipData.filepath required' })

  try {
    const result = await clipIndexer.indexClip(req.user.id, categoryId, clipData)
    res.json({ indexed: result })
  } catch (err) {
    console.error('[editor/index/clip]', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/editor/index/batch
 * Receive a batch of indexed clips from the browser
 * STATUS: READY
 */
router.post('/index/batch', async (req, res) => {
  const { categoryId, clips, jobId } = req.body
  if (!clips?.length) return res.status(400).json({ error: 'clips array required' })

  try {
    // Update job status to running
    if (jobId) {
      await supabase.from('indexing_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', jobId).eq('user_id', req.user.id)
    }

    const results = await clipIndexer.indexClipBatch(req.user.id, categoryId, clips)

    // Update job as complete
    if (jobId) {
      await supabase.from('indexing_jobs').update({
        status:         results.failed.length ? 'failed' : 'complete',
        indexed_clips:  results.success.length,
        failed_clips:   results.failed.length,
        error_log:      results.failed,
        completed_at:   new Date().toISOString(),
      }).eq('id', jobId).eq('user_id', req.user.id)
    }

    res.json(results)
  } catch (err) {
    console.error('[editor/index/batch]', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/editor/index/job
 * Create a new indexing job record (browser polls this for progress)
 * STATUS: WORKING
 */
router.post('/index/job', async (req, res) => {
  const { categoryId, totalClips } = req.body

  const { data, error } = await supabase.from('indexing_jobs').insert({
    user_id:      req.user.id,
    category_id:  categoryId,
    total_clips:  totalClips || 0,
    status:       'pending',
  }).select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ job: data })
})

/**
 * GET /api/editor/index/status?categoryId=
 * Get indexing stats for a category
 * STATUS: WORKING
 */
router.get('/index/status', async (req, res) => {
  const { categoryId } = req.query

  const [stats, latestJob] = await Promise.all([
    clipIndexer.getIndexStats(req.user.id, categoryId),
    supabase.from('indexing_jobs')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('category_id', categoryId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
      .then(({ data }) => data),
  ])

  res.json({ stats, latestJob })
})

// ─── CLIP LIBRARY ─────────────────────────────────────────────────────────────

/**
 * GET /api/editor/clips?categoryId=
 * Get all indexed clips for the clip browser
 * STATUS: WORKING
 */
// ── POST /editor/clips/transcribe — extract audio then send to OpenAI Whisper ──
const multer     = require('multer')
const FormData   = require('form-data')
const axios      = require('axios')
const ffmpeg     = require('fluent-ffmpeg')
const ffmpegPath = require('ffmpeg-static')
const os         = require('os')
const path       = require('path')
const fs         = require('fs')

ffmpeg.setFfmpegPath(ffmpegPath)

function detectClipType(filename) {
  const lower = filename.toLowerCase()
  if (lower.startsWith('daw') || lower.includes('screen') || lower.includes('capture')) return 'daw'
  if (lower.includes('broll') || lower.includes('b-roll') || lower.includes('b_roll'))  return 'broll'
  return 'cam'
}

const sharp  = require('sharp')
const { OpenAI } = require('openai')
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── TRANSCRIPTION HELPERS ─────────────────────────────────────────────────────

// Accept large video files — FFmpeg extracts + chunks audio before Whisper
const clipUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `clip-${Date.now()}-${file.originalname}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }  // 5GB max
})

const CHUNK_SECONDS  = 600   // 10-minute chunks
const MAX_CHUNK_BYTES = 24 * 1024 * 1024  // 24MB safety margin under Whisper's 25MB limit

// Get video duration in seconds via ffprobe
function getVideoDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, ['-analyzeduration', '100M', '-probesize', '100M'], (err, meta) => {
      resolve(err ? 0 : Math.ceil(meta?.format?.duration || 0))
    })
  })
}

// Extract a single audio chunk from inputPath
function extractChunk(inputPath, outputPath, startSecs, durationSecs) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(inputPath)
      .inputOptions(['-analyzeduration', '100M', '-probesize', '100M'])
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .audioChannels(1)
      .audioFrequency(16000)
      .output(outputPath)
    if (startSecs > 0) cmd.seekInput(startSecs)
    if (durationSecs < 36000) cmd.duration(durationSecs)
    cmd.on('end', resolve).on('error', reject).run()
  })
}

// Transcribe a single audio file via Whisper
async function transcribeChunk(audioPath) {
  const form = new FormData()
  form.append('file', fs.createReadStream(audioPath), { filename: 'audio.mp3', contentType: 'audio/mpeg' })
  form.append('model', 'whisper-1')
  form.append('language', 'en')
  const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  })
  return response.data?.text?.trim() || ''
}

// ── POST /editor/clips/transcribe ─────────────────────────────────────────────
router.post('/clips/transcribe', (req, res, next) => {
  clipUpload.single('file')(req, res, (err) => {
    if (err) return res.json({ text: '' })
    next()
  })
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' })
  if (!process.env.OPENAI_API_KEY) return res.json({ text: '' })

  const inputPath = req.file.path
  const sessionId = Date.now()
  const chunkPaths = []

  // Keepalive every 10s to prevent Railway 30s idle timeout
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Accel-Buffering', 'no')
  const keepalive = setInterval(() => { try { res.write(' ') } catch {} }, 10000)

  try {
    const fileSizeMB = Math.round(req.file.size / 1024 / 1024)
    console.log(`[clips/transcribe] Starting: ${req.file.originalname} (${fileSizeMB}MB)`)

    const totalSecs = await getVideoDuration(inputPath)
    console.log(`[clips/transcribe] Duration: ${Math.round(totalSecs / 60)}min`)

    const transcripts = []

    if (totalSecs === 0) {
      // ffprobe couldn't determine duration — extract full audio in one shot
      console.log(`[clips/transcribe] Duration unknown — extracting full audio`)
      const chunkPath = path.join(os.tmpdir(), `chunk-${sessionId}-0.mp3`)
      chunkPaths.push(chunkPath)
      await extractChunk(inputPath, chunkPath, 0, 36000)  // up to 10 hours
      const chunkSize = fs.statSync(chunkPath).size
      console.log(`[clips/transcribe] Audio extracted: ${Math.round(chunkSize / 1024)}KB`)
      if (chunkSize > 1024 && chunkSize <= MAX_CHUNK_BYTES) {
        const text = await transcribeChunk(chunkPath)
        if (text) transcripts.push(text)
        console.log(`[clips/transcribe] Done: "${text.slice(0, 80)}"`)
      } else if (chunkSize > MAX_CHUNK_BYTES) {
        // Too large — split by time anyway using estimated duration from file size
        // Rough estimate: 1GB video ≈ 60 minutes
        const estimatedSecs = Math.round((req.file.size / (1024 * 1024 * 1024)) * 3600)
        console.log(`[clips/transcribe] Estimated duration: ${Math.round(estimatedSecs/60)}min — chunking`)
        const numChunks = Math.ceil(estimatedSecs / CHUNK_SECONDS)
        for (let i = 0; i < numChunks; i++) {
          const startSecs    = i * CHUNK_SECONDS
          const cp = path.join(os.tmpdir(), `chunk-${sessionId}-${i+1}.mp3`)
          chunkPaths.push(cp)
          await extractChunk(inputPath, cp, startSecs, CHUNK_SECONDS)
          const sz = fs.statSync(cp).size
          if (sz < 1024) break  // past end of file
          if (sz > MAX_CHUNK_BYTES) continue
          console.log(`[clips/transcribe] Chunk ${i+1}/${numChunks}: ${Math.round(sz/1024)}KB`)
          const text = await transcribeChunk(cp)
          if (text) transcripts.push(text)
        }
      }
    } else {
      // Normal chunked path
      const numChunks = Math.max(1, Math.ceil(totalSecs / CHUNK_SECONDS))
      console.log(`[clips/transcribe] Splitting into ${numChunks} chunks`)
      for (let i = 0; i < numChunks; i++) {
        const startSecs    = i * CHUNK_SECONDS
        const durationSecs = Math.min(CHUNK_SECONDS, totalSecs - startSecs)
        const chunkPath    = path.join(os.tmpdir(), `chunk-${sessionId}-${i}.mp3`)
        chunkPaths.push(chunkPath)
        console.log(`[clips/transcribe] Extracting chunk ${i + 1}/${numChunks} (${Math.round(startSecs/60)}min - ${Math.round((startSecs + durationSecs)/60)}min)`)
        await extractChunk(inputPath, chunkPath, startSecs, durationSecs)
        const chunkSize = fs.statSync(chunkPath).size
        console.log(`[clips/transcribe] Chunk ${i + 1} extracted: ${Math.round(chunkSize / 1024)}KB`)
        if (chunkSize > MAX_CHUNK_BYTES) { console.warn(`[clips/transcribe] Chunk ${i+1} too large — skipping`); continue }
        if (chunkSize < 1024) { console.log(`[clips/transcribe] Chunk ${i+1} empty — stopping`); break }
        const text = await transcribeChunk(chunkPath)
        console.log(`[clips/transcribe] Chunk ${i + 1} done: "${text.slice(0, 60)}"`)
        if (text) transcripts.push(text)
      }
    }

    const fullTranscript = transcripts.join(' ').trim()
    console.log(`[clips/transcribe] Complete: ${transcripts.length} chunks, ${fullTranscript.length} chars`)

    clearInterval(keepalive)
    res.end(JSON.stringify({ text: fullTranscript }))

  } catch (err) {
    console.error('[clips/transcribe]', err.response?.data || err.message)
    clearInterval(keepalive)
    res.end(JSON.stringify({ text: '' }))
  } finally {
    try { fs.unlinkSync(inputPath) } catch {}
    chunkPaths.forEach(p => { try { fs.unlinkSync(p) } catch {} })
  }
})

// ── DELETE /editor/clips/all — wipe the entire clip index for this user ───────
router.delete('/clips/all', async (req, res) => {
  try {
    const { error } = await supabase
      .from('clip_index')
      .delete()
      .eq('user_id', req.user.id)
    if (error) throw error
    res.json({ deleted: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── SERVER-SIDE CLIP UPLOAD + INDEX ─────────────────────────────────────────
// Replaces client-side CLIP worker for cross-browser / mobile compatibility.
// Pipeline: upload → ffmpeg metadata + thumbnail + audio → Whisper → OpenAI embed → clip_index

const THUMB_SIZE  = 224  // px — matches CLIP input size
const EMBED_MODEL = 'text-embedding-3-small'  // 1536 dims — we truncate to 512 visual / 384 text

// Multer instance for clip uploads — large files, disk storage
const clipUploadMulter = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${file.originalname.replace(/[^a-z0-9._-]/gi,'_')}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }  // 5GB
})

/**
 * POST /api/editor/clips/upload
 * Upload a video/audio clip — server extracts metadata, transcribes, embeds, and indexes.
 * Returns the indexed clip record.
 */
router.post('/clips/upload', (req, res, next) => {
  clipUploadMulter.single('clip')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    next()
  })
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'clip file required' })

  const { categoryId, clipType: forcedType } = req.body
  const inputPath  = req.file.path
  const sessionId  = Date.now()
  const tmpFiles   = [inputPath]

  // SSE-style keepalive to prevent Railway 30s timeout on large files
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Accel-Buffering', 'no')
  const keepalive = setInterval(() => { try { res.write(' ') } catch {} }, 10000)

  try {
    const filename = req.file.originalname
    const clipType = forcedType || detectClipType(filename)

    console.log(`[clips/upload] Starting: ${filename} (${Math.round(req.file.size / 1024 / 1024)}MB)`)

    // ── 1. VIDEO METADATA via ffprobe ──────────────────────────────────────
    const meta = await new Promise((resolve) => {
      ffmpeg.ffprobe(inputPath, (err, data) => {
        if (err) { resolve({ width: null, height: null, fps: null, codec: null, durationMs: 0 }); return }
        const vs = data.streams?.find(s => s.codec_type === 'video')
        resolve({
          width:      vs?.width        || null,
          height:     vs?.height       || null,
          fps:        vs ? Math.round(eval(vs.r_frame_rate || '0')) : null,
          codec:      vs?.codec_name   || null,
          durationMs: Math.round((parseFloat(data.format?.duration) || 0) * 1000),
        })
      })
    })

    console.log(`[clips/upload] Meta: ${meta.width}x${meta.height} ${meta.durationMs}ms`)

    // ── 2. THUMBNAIL via ffmpeg ─────────────────────────────────────────────
    let thumbnailB64 = null
    const thumbPath  = path.join(os.tmpdir(), `thumb-${sessionId}.jpg`)
    tmpFiles.push(thumbPath)

    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(Math.min(2, (meta.durationMs / 1000) * 0.1))  // 10% in, max 2s
          .frames(1)
          .size(`${THUMB_SIZE}x${THUMB_SIZE}`)
          .aspect('1:1')
          .outputOptions(['-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease,pad=${THUMB_SIZE}:${THUMB_SIZE}:(ow-iw)/2:(oh-ih)/2`])
          .output(thumbPath)
          .on('end', resolve)
          .on('error', reject)
          .run()
      })
      const thumbBuf = fs.readFileSync(thumbPath)
      // Resize to 224x224 and compress
      const compressed = await sharp(thumbBuf).resize(THUMB_SIZE, THUMB_SIZE).jpeg({ quality: 60 }).toBuffer()
      thumbnailB64 = compressed.toString('base64')
      console.log(`[clips/upload] Thumbnail: ${Math.round(compressed.length / 1024)}KB`)
    } catch (thumbErr) {
      console.warn('[clips/upload] Thumbnail failed:', thumbErr.message)
    }

    // ── 3. AUDIO EXTRACTION + WHISPER TRANSCRIPT ───────────────────────────
    let transcript = ''
    const audioPath = path.join(os.tmpdir(), `audio-${sessionId}.mp3`)
    tmpFiles.push(audioPath)

    try {
      const totalSecs = (meta.durationMs || 0) / 1000
      await extractChunk(inputPath, audioPath, 0, Math.max(totalSecs, 3600))
      const audioSize = fs.statSync(audioPath).size

      if (audioSize > 1024 && audioSize <= MAX_CHUNK_BYTES && process.env.OPENAI_API_KEY) {
        const formData = new FormData()
        formData.append('file', fs.createReadStream(audioPath), { filename: 'audio.mp3', contentType: 'audio/mpeg' })
        formData.append('model', 'whisper-1')
        formData.append('response_format', 'text')

        const whisperRes = await openai.audio.transcriptions.create({
          file:  fs.createReadStream(audioPath),
          model: 'whisper-1',
          response_format: 'text',
        })
        transcript = (typeof whisperRes === 'string' ? whisperRes : whisperRes?.text || '').trim()
        console.log(`[clips/upload] Transcript: "${transcript.slice(0, 80)}"`)
      } else if (audioSize > MAX_CHUNK_BYTES) {
        // Long video — chunk it
        const chunks = []
        const numChunks = Math.ceil(totalSecs / CHUNK_SECONDS)
        for (let i = 0; i < Math.min(numChunks, 6); i++) {  // max 6 chunks = 1hr
          const cp = path.join(os.tmpdir(), `chunk-${sessionId}-${i}.mp3`)
          tmpFiles.push(cp)
          await extractChunk(inputPath, cp, i * CHUNK_SECONDS, CHUNK_SECONDS)
          const sz = fs.statSync(cp).size
          if (sz < 1024 || sz > MAX_CHUNK_BYTES) continue
          const t = await openai.audio.transcriptions.create({
            file:  fs.createReadStream(cp),
            model: 'whisper-1',
            response_format: 'text',
          })
          chunks.push(typeof t === 'string' ? t : t?.text || '')
        }
        transcript = chunks.join(' ').trim()
      }
    } catch (transcribeErr) {
      console.warn('[clips/upload] Transcript failed:', transcribeErr.message)
    }

    // ── 4. OPENAI EMBEDDINGS ───────────────────────────────────────────────
    // Visual tags from clip type + transcript + filename
    const visualTags = clipType === 'daw'
      ? ['DAW software', 'music production', 'screen capture']
      : clipType === 'broll'
        ? ['b-roll', 'cutaway', 'visual']
        : ['talking to camera', 'presenter', 'speaking']

    const textContent   = [transcript, ...visualTags, clipType, filename].filter(Boolean).join('. ')
    const visualContent = [filename, clipType, ...visualTags].join('. ')

    let textVector   = new Array(384).fill(0)
    let visualVector = new Array(512).fill(0)

    if (process.env.OPENAI_API_KEY) {
      try {
        const [textEmbed, visualEmbed] = await Promise.all([
          openai.embeddings.create({ model: EMBED_MODEL, input: textContent.slice(0, 8000) }),
          openai.embeddings.create({ model: EMBED_MODEL, input: visualContent.slice(0, 8000) }),
        ])
        // text-embedding-3-small returns 1536 dims — truncate to match expected dims
        textVector   = textEmbed.data[0].embedding.slice(0, 384)
        visualVector = visualEmbed.data[0].embedding.slice(0, 512)
      } catch (embedErr) {
        console.warn('[clips/upload] Embed failed:', embedErr.message)
      }
    }

    // ── 5. STORE IN clip_index ─────────────────────────────────────────────
    const clipData = {
      filename,
      filepath:        filename,
      fileSizeBytes:   req.file.size,
      fileModifiedAt:  null,
      durationMs:      meta.durationMs,
      width:           meta.width,
      height:          meta.height,
      fps:             meta.fps,
      codec:           meta.codec,
      clipType,
      transcript:      transcript || null,
      visualTags,
      dominantEmotion: null,
      audioEnergy:     0.5,
      sceneType:       clipType === 'daw' ? 'daw-screen' : 'talking-head',
      thumbnailB64,
      visualVector,
      textVector,
    }

    const indexed = await clipIndexer.indexClip(req.user.id, categoryId || null, clipData)

    console.log(`[clips/upload] Indexed: ${indexed.id} — ${filename}`)

    clearInterval(keepalive)
    res.end(JSON.stringify({
      clip: { ...indexed, thumbnail_b64: thumbnailB64, transcript, duration_ms: meta.durationMs, clip_type: clipType },
      transcript,
      durationMs: meta.durationMs,
    }))

  } catch (err) {
    console.error('[clips/upload]', err.message)
    clearInterval(keepalive)
    res.end(JSON.stringify({ error: err.message }))
  } finally {
    tmpFiles.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch {} })
  }
})

/**
 * DELETE /api/editor/clips/:id
 * Delete a single clip from the index
 */
router.delete('/clips/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('clip_index')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    if (error) throw error
    res.json({ deleted: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/editor/clips/storage
 * Get storage usage stats for the current user
 */
router.get('/clips/storage', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('clip_index')
      .select('id, filename, file_size, duration_ms, clip_type, indexed_at, thumbnail_b64')
      .eq('user_id', req.user.id)
      .order('indexed_at', { ascending: false })
    if (error) throw error

    const clips = data || []
    const totalBytes = clips.reduce((s, c) => s + (c.file_size || 0), 0)
    const totalMs    = clips.reduce((s, c) => s + (c.duration_ms || 0), 0)

    res.json({
      clips:           clips.map(c => ({ id: c.id, filename: c.filename, fileSize: c.file_size, durationMs: c.duration_ms, clipType: c.clip_type, indexedAt: c.indexed_at })),
      totalBytes,
      totalMb:         Math.round(totalBytes / 1024 / 1024),
      totalDurationMs: totalMs,
      count:           clips.length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


router.get('/clips', async (req, res) => {
  const { categoryId, limit = 100, offset = 0 } = req.query

  try {
    const result = await clipIndexer.getClipLibrary(req.user.id, categoryId, {
      limit:  parseInt(limit),
      offset: parseInt(offset),
    })
    res.json(result)  // { clips, total, limit, offset }
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/editor/clips/search
 * Semantic search — find clips matching an intent query
 * STATUS: READY
 */
router.post('/clips/search', async (req, res) => {
  const { categoryId, visualVector, textVector, clipType, count = 5 } = req.body

  if (!visualVector || !textVector) {
    return res.status(400).json({ error: 'visualVector and textVector required' })
  }

  try {
    const results = await clipIndexer.searchClips(
      req.user.id, visualVector, textVector,
      { categoryId, clipType, count }
    )
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PROJECTS ─────────────────────────────────────────────────────────────────

/**
 * GET /api/editor/projects?categoryId=
 * List editor projects
 * STATUS: WORKING
 */
router.get('/projects', async (req, res) => {
  const { categoryId, episodeId, limit } = req.query

  let query = supabase
    .from('editor_projects')
    .select('id, name, status, duration_ms, ai_confidence, last_exported_at, created_at, episode_id')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })

  if (categoryId) query = query.eq('category_id', categoryId)
  if (episodeId)  query = query.eq('episode_id', episodeId)
  if (limit)      query = query.limit(parseInt(limit))

  const { data, error } = await query

  if (error) return res.status(500).json({ error: error.message })
  res.json({ projects: data })
})

/**
 * POST /api/editor/projects
 * Create a new editor project (linked to an episode)
 * STATUS: WORKING
 */
router.post('/projects', async (req, res) => {
  const { categoryId, episodeId, name, footageRoot } = req.body

  const { data, error } = await supabase
    .from('editor_projects')
    .insert({
      user_id:      req.user.id,
      category_id:  categoryId,
      episode_id:   episodeId,
      name:         name || 'Untitled edit',
      footage_root: footageRoot,
    })
    .select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ project: data })
})

/**
 * GET /api/editor/projects/:id
 * Get a single project with full timeline
 * STATUS: WORKING
 */
router.get('/projects/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('editor_projects')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Project not found' })
  res.json({ project: data })
})

/**
 * POST /api/editor/projects/:id/assemble
 * AI assembles the timeline from EDL + clip index
 * STATUS: WORKING — visionMatcher.matchFullEDL assembles timeline from indexed clips
 */
router.post('/projects/:id/assemble', async (req, res) => {
  const { edlClipMap, beatVectors = [] } = req.body

  if (!edlClipMap) return res.status(400).json({ error: 'edlClipMap required' })

  try {
    // Get project for category context
    const { data: project } = await supabase
      .from('editor_projects')
      .select('category_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    if (!project) return res.status(404).json({ error: 'Project not found' })

    // Match EDL to clips
    const matchResult = await visionMatcher.matchFullEDL(
      req.user.id, project.category_id, edlClipMap, beatVectors
    )

    // Build virtual timeline
    const timeline = timelineBuilder.buildTimeline(matchResult.matches, edlClipMap)

    // Save to project
    const saved = await timelineBuilder.saveTimeline(
      req.params.id, req.user.id, timeline, matchResult.flags
    )

    res.json({
      project:      saved,
      timeline,
      matchSummary: {
        totalBeats:   matchResult.totalBeats,
        matched:      matchResult.matchedBeats,
        avgConfidence: matchResult.avgConfidence,
        flagCount:    matchResult.flags.length,
      }
    })
  } catch (err) {
    console.error('[editor/assemble]', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * PATCH /api/editor/projects/:id/timeline
 * Save timeline changes (user edits, approvals, swaps)
 * STATUS: WORKING
 */
router.patch('/projects/:id/timeline', async (req, res) => {
  const { timeline, approvedCuts, rejectedCuts, swapHistory } = req.body

  const updates = { updated_at: new Date().toISOString() }
  if (timeline)      updates.timeline      = timeline
  if (approvedCuts)  updates.approved_cuts = approvedCuts
  if (rejectedCuts)  updates.rejected_cuts = rejectedCuts
  if (swapHistory)   updates.swap_history  = swapHistory

  const { data, error } = await supabase
    .from('editor_projects')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select().single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ project: data })
})

/**
 * POST /api/editor/projects/:id/swap
 * Get swap candidates for a specific clip
 * STATUS: WORKING — returns top 3 alternative clips ranked by semantic similarity
 */
router.post('/projects/:id/swap', async (req, res) => {
  const { clipId, beat, visualVector, textVector } = req.body

  try {
    const { data: project } = await supabase
      .from('editor_projects')
      .select('category_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    const candidates = await visionMatcher.getSwapCandidates(
      req.user.id, project.category_id, clipId, beat, visualVector, textVector
    )

    res.json({ candidates })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/editor/projects/:id/export
 * Export timeline as EDL, FCPXML, or OTIO
 * STATUS: FULLY WORKING — EDL, FCPXML 1.10, and OTIO all implemented
 */
router.get('/projects/:id/export', async (req, res) => {
  const { format = 'edl' } = req.query

  try {
    const { data: project } = await supabase
      .from('editor_projects')
      .select('name, timeline, duration_ms')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    if (!project) return res.status(404).json({ error: 'Project not found' })

    const timeline = { clips: project.timeline || [], durationMs: project.duration_ms }
    let content, filename, mimeType

    if (format === 'fcpxml') {
      content  = timelineBuilder.exportFCPXML(timeline, project.name)
      filename = `${project.name.replace(/\s+/g,'-')}.fcpxml`
      mimeType = 'application/xml'
    } else if (format === 'otio') {
      content  = timelineBuilder.exportOTIO(timeline, project.name)
      filename = `${project.name.replace(/\s+/g,'-')}.otio`
      mimeType = 'application/json'
    } else {
      content  = timelineBuilder.exportEDL(timeline, project.name)
      filename = `${project.name.replace(/\s+/g,'-')}.edl`
      mimeType = 'text/plain'
    }

    await supabase.from('editor_projects').update({
      last_exported_at: new Date().toISOString(),
      export_format:    format,
      status:           'exported',
    }).eq('id', req.params.id)

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', mimeType)
    res.send(content)

  } catch (err) {
    console.error('[editor/export]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/projects/:id/export', async (req, res) => {
  const { format = 'edl' } = req.body

  try {
    const { data: project } = await supabase
      .from('editor_projects')
      .select('name, timeline, duration_ms')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    if (!project) return res.status(404).json({ error: 'Project not found' })

    const timeline = { clips: project.timeline || [], durationMs: project.duration_ms }
    let content, filename, mimeType

    if (format === 'fcpxml') {
      content  = timelineBuilder.exportFCPXML(timeline, project.name)
      filename = `${project.name.replace(/\s+/g,'-')}.fcpxml`
      mimeType = 'application/xml'
    } else if (format === 'otio') {
      content  = timelineBuilder.exportOTIO(timeline, project.name)
      filename = `${project.name.replace(/\s+/g,'-')}.otio`
      mimeType = 'application/json'
    } else {
      content  = timelineBuilder.exportEDL(timeline, project.name)
      filename = `${project.name.replace(/\s+/g,'-')}.edl`
      mimeType = 'text/plain'
    }

    // Log the export
    await supabase.from('editor_projects').update({
      last_exported_at: new Date().toISOString(),
      export_format:    format,
      status:           'exported',
    }).eq('id', req.params.id)

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', mimeType)
    res.send(content)

  } catch (err) {
    console.error('[editor/export]', err.message)
    res.status(500).json({ error: err.message })
  }
})


// ─── GET /api/editor/projects/:id/export-shorts ──────────────────────────────
// Exports a multi-sequence Shorts EDL from the project timeline + episode shorts scripts.
// One sequence per short (3 total). Import into DaVinci as one EDL, export per sequence.

router.get('/projects/:id/export-shorts', async (req, res) => {
  try {
    const { data: project, error } = await supabase
      .from('editor_projects')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    if (error || !project) return res.status(404).json({ error: 'Project not found' })

    const timeline = project.timeline || { clips: [] }

    // Fetch episode's shorts scripts
    let shortsScripts = []
    if (project.episode_id) {
      const { data: episode } = await supabase
        .from('episodes')
        .select('shorts_scripts, track_name, episode_number')
        .eq('id', project.episode_id)
        .eq('user_id', req.user.id)
        .single()

      if (episode?.shorts_scripts?.length) {
        shortsScripts = episode.shorts_scripts
      }
    }

    // If no shorts scripts yet, return helpful error
    if (!shortsScripts.length) {
      return res.status(400).json({
        error: 'No Shorts scripts found for this episode.',
        tip: 'Go to the Shorts page and generate shorts for this episode first.',
      })
    }

    const { exportShortsEDL } = require('../../services/vision/timelineBuilder')
    const content  = exportShortsEDL(shortsScripts, timeline, project.name)
    const filename = `${project.name.replace(/\s+/g, '-')}-SHORTS.edl`

    // Log export
    await supabase.from('editor_projects').update({
      last_exported_at: new Date().toISOString(),
      export_format:    'shorts_edl',
    }).eq('id', project.id)

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(content)

  } catch (err) {
    console.error('[editor/export-shorts]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router

// ─── NEXT LEVEL ROUTES ────────────────────────────────────────────────────────

const retentionMapper  = require('../../services/retentionMapper')
const voAlignment      = require('../../services/voAlignment')
const continuityScorer = require('../../services/continuityScorer')
const retentionModel   = require('../../services/retentionModel')

/**
 * POST /api/editor/retention-template
 * Build retention template from user's top episodes
 */
router.post('/retention-template', async (req, res) => {
  const { categoryId, force = false } = req.body
  try {
    // Serve from cache unless forced or stale (older than 24 hours)
    if (!force) {
      const { data: cat } = await supabase
        .from('categories')
        .select('retention_template, retention_template_at')
        .eq('id', categoryId)
        .eq('user_id', req.user.id)
        .single()

      const cacheAge = cat?.retention_template_at
        ? Date.now() - new Date(cat.retention_template_at).getTime()
        : Infinity

      if (cat?.retention_template && cacheAge < 24 * 60 * 60 * 1000) {
        return res.json({ template: cat.retention_template, fromCache: true })
      }
    }

    const template = await retentionMapper.buildRetentionTemplate(req.user.id, categoryId)
    res.json({ template, fromCache: false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/editor/retention-curve/:episodeId
 * Save a retention curve to an episode
 */
router.post('/retention-curve/:episodeId', async (req, res) => {
  const { curveData } = req.body
  try {
    const result = await retentionMapper.saveRetentionCurve(req.user.id, req.params.episodeId, curveData)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/editor/projects/:id/align
 * Apply Whisper word-level alignment to the timeline
 * Body: { whisperOutput, fps? }
 */
router.post('/projects/:id/align', async (req, res) => {
  const { whisperOutput, fps = 25 } = req.body
  if (!whisperOutput) return res.status(400).json({ error: 'whisperOutput required' })

  try {
    const { data: project } = await supabase
      .from('editor_projects')
      .select('timeline, episode_id')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    if (!project) return res.status(404).json({ error: 'Project not found' })

    const wordTimestamps = voAlignment.parseWhisperWordTimestamps(whisperOutput)
    const { timeline: aligned, alignments, aligned: count } =
      voAlignment.realignTimeline(project.timeline || [], wordTimestamps, fps)

    // Save aligned timeline
    await supabase
      .from('editor_projects')
      .update({ timeline: aligned, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)

    // Save alignment data to episode if linked
    if (project.episode_id) {
      await voAlignment.saveAlignmentData(req.user.id, project.episode_id, { alignments, alignedAt: new Date().toISOString() })
    }

    res.json({ timeline: aligned, alignments, aligned: count, wordCount: wordTimestamps.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/editor/projects/:id/continuity
 * Score the timeline for narrative continuity
 * Body: { voScript, trackContext? }
 */
router.post('/projects/:id/continuity', async (req, res) => {
  const { voScript, trackContext } = req.body

  try {
    const { data: project } = await supabase
      .from('editor_projects')
      .select('timeline')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    if (!project) return res.status(404).json({ error: 'Project not found' })

    const [continuityResult, energyResult] = await Promise.all([
      continuityScorer.scoreContinuity(project.timeline || [], voScript, trackContext),
      Promise.resolve(continuityScorer.analyseEnergyArc(project.timeline || [])),
    ])

    res.json({
      continuity: continuityResult,
      energy:     energyResult,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/editor/retention-model/stats?categoryId=
 * Get training data stats for the retention model
 */
router.get('/retention-model/stats', async (req, res) => {
  const { categoryId } = req.query
  try {
    const stats = await retentionModel.getModelStats(req.user.id, categoryId)
    res.json(stats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/editor/retention-model/training-data?categoryId=
 * Fetch training data for browser-side TF.js training
 */
router.get('/retention-model/training-data', async (req, res) => {
  const { categoryId } = req.query
  try {
    const data = await retentionModel.getTrainingData(req.user.id, categoryId)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})