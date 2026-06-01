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

router.post('/index/batch', async (req, res) => {
  const { categoryId, clips, jobId } = req.body
  if (!clips?.length) return res.status(400).json({ error: 'clips array required' })
  try {
    if (jobId) {
      await supabase.from('indexing_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', jobId).eq('user_id', req.user.id)
    }
    const results = await clipIndexer.indexClipBatch(req.user.id, categoryId, clips)
    if (jobId) {
      await supabase.from('indexing_jobs').update({
        status:        results.failed.length ? 'failed' : 'complete',
        indexed_clips: results.success.length,
        failed_clips:  results.failed.length,
        error_log:     results.failed,
        completed_at:  new Date().toISOString(),
      }).eq('id', jobId).eq('user_id', req.user.id)
    }
    res.json(results)
  } catch (err) {
    console.error('[editor/index/batch]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.post('/index/job', async (req, res) => {
  const { categoryId, totalClips } = req.body
  const { data, error } = await supabase.from('indexing_jobs').insert({
    user_id:     req.user.id,
    category_id: categoryId,
    total_clips: totalClips || 0,
    status:      'pending',
  }).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ job: data })
})

router.get('/index/status', async (req, res) => {
  const { categoryId } = req.query
  const [stats, latestJob] = await Promise.all([
    clipIndexer.getIndexStats(req.user.id, categoryId),
    supabase.from('indexing_jobs')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('category_id', categoryId)
      .order('created_at', { ascending: false })
      .limit(1).single()
      .then(({ data }) => data),
  ])
  res.json({ stats, latestJob })
})

// ─── CLIP LIBRARY ─────────────────────────────────────────────────────────────

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

const CHUNK_SECONDS   = 600
const MAX_CHUNK_BYTES = 24 * 1024 * 1024

function getVideoDuration(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, ['-analyzeduration', '100M', '-probesize', '100M'], (err, meta) => {
      resolve(err ? 0 : Math.ceil(meta?.format?.duration || 0))
    })
  })
}

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

const clipUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `clip-${Date.now()}-${file.originalname}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }
})

router.post('/clips/transcribe', (req, res, next) => {
  clipUpload.single('file')(req, res, (err) => {
    if (err) return res.json({ text: '' })
    next()
  })
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' })
  if (!process.env.OPENAI_API_KEY) return res.json({ text: '' })

  const inputPath  = req.file.path
  const sessionId  = Date.now()
  const chunkPaths = []

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
      const chunkPath = path.join(os.tmpdir(), `chunk-${sessionId}-0.mp3`)
      chunkPaths.push(chunkPath)
      await extractChunk(inputPath, chunkPath, 0, 36000)
      const chunkSize = fs.statSync(chunkPath).size
      if (chunkSize > 1024 && chunkSize <= MAX_CHUNK_BYTES) {
        const text = await transcribeChunk(chunkPath)
        if (text) transcripts.push(text)
      } else if (chunkSize > MAX_CHUNK_BYTES) {
        const estimatedSecs = Math.round((req.file.size / (1024 * 1024 * 1024)) * 3600)
        const numChunks = Math.ceil(estimatedSecs / CHUNK_SECONDS)
        for (let i = 0; i < numChunks; i++) {
          const cp = path.join(os.tmpdir(), `chunk-${sessionId}-${i+1}.mp3`)
          chunkPaths.push(cp)
          await extractChunk(inputPath, cp, i * CHUNK_SECONDS, CHUNK_SECONDS)
          const sz = fs.statSync(cp).size
          if (sz < 1024) break
          if (sz > MAX_CHUNK_BYTES) continue
          const text = await transcribeChunk(cp)
          if (text) transcripts.push(text)
        }
      }
    } else {
      const numChunks = Math.max(1, Math.ceil(totalSecs / CHUNK_SECONDS))
      for (let i = 0; i < numChunks; i++) {
        const startSecs    = i * CHUNK_SECONDS
        const durationSecs = Math.min(CHUNK_SECONDS, totalSecs - startSecs)
        const chunkPath    = path.join(os.tmpdir(), `chunk-${sessionId}-${i}.mp3`)
        chunkPaths.push(chunkPath)
        await extractChunk(inputPath, chunkPath, startSecs, durationSecs)
        const chunkSize = fs.statSync(chunkPath).size
        if (chunkSize > MAX_CHUNK_BYTES) continue
        if (chunkSize < 1024) break
        const text = await transcribeChunk(chunkPath)
        if (text) transcripts.push(text)
      }
    }

    const fullTranscript = transcripts.join(' ').trim()
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

router.delete('/clips/all', async (req, res) => {
  try {
    const { error } = await supabase.from('clip_index').delete().eq('user_id', req.user.id)
    if (error) throw error
    res.json({ deleted: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const THUMB_SIZE  = 224
const EMBED_MODEL = 'text-embedding-3-small'

const clipUploadMulter = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${file.originalname.replace(/[^a-z0-9._-]/gi,'_')}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }
})

router.post('/clips/upload', (req, res, next) => {
  clipUploadMulter.single('clip')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    next()
  })
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'clip file required' })

  const { categoryId, clipType: forcedType } = req.body
  const inputPath = req.file.path
  const sessionId = Date.now()
  const tmpFiles  = [inputPath]

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('X-Accel-Buffering', 'no')
  const keepalive = setInterval(() => { try { res.write(' ') } catch {} }, 10000)

  try {
    const filename = req.file.originalname
    const clipType = forcedType || detectClipType(filename)
    console.log(`[clips/upload] Starting: ${filename} (${Math.round(req.file.size / 1024 / 1024)}MB)`)

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

    let thumbnailB64 = null
    const thumbPath  = path.join(os.tmpdir(), `thumb-${sessionId}.jpg`)
    tmpFiles.push(thumbPath)
    try {
      await new Promise((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(Math.min(2, (meta.durationMs / 1000) * 0.1))
          .frames(1)
          .size(`${THUMB_SIZE}x${THUMB_SIZE}`)
          .aspect('1:1')
          .outputOptions(['-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease,pad=${THUMB_SIZE}:${THUMB_SIZE}:(ow-iw)/2:(oh-ih)/2`])
          .output(thumbPath)
          .on('end', resolve).on('error', reject).run()
      })
      const thumbBuf   = fs.readFileSync(thumbPath)
      const compressed = await sharp(thumbBuf).resize(THUMB_SIZE, THUMB_SIZE).jpeg({ quality: 60 }).toBuffer()
      thumbnailB64 = compressed.toString('base64')
    } catch (thumbErr) {
      console.warn('[clips/upload] Thumbnail failed:', thumbErr.message)
    }

    let transcript = ''
    const audioPath = path.join(os.tmpdir(), `audio-${sessionId}.mp3`)
    tmpFiles.push(audioPath)
    try {
      const totalSecs = (meta.durationMs || 0) / 1000
      await extractChunk(inputPath, audioPath, 0, Math.max(totalSecs, 3600))
      const audioSize = fs.statSync(audioPath).size
      if (audioSize > 1024 && audioSize <= MAX_CHUNK_BYTES && process.env.OPENAI_API_KEY) {
        const whisperRes = await openai.audio.transcriptions.create({
          file:            fs.createReadStream(audioPath),
          model:           'whisper-1',
          response_format: 'text',
        })
        transcript = (typeof whisperRes === 'string' ? whisperRes : whisperRes?.text || '').trim()
      } else if (audioSize > MAX_CHUNK_BYTES) {
        const chunks = []
        const numChunks = Math.ceil(totalSecs / CHUNK_SECONDS)
        for (let i = 0; i < Math.min(numChunks, 6); i++) {
          const cp = path.join(os.tmpdir(), `chunk-${sessionId}-${i}.mp3`)
          tmpFiles.push(cp)
          await extractChunk(inputPath, cp, i * CHUNK_SECONDS, CHUNK_SECONDS)
          const sz = fs.statSync(cp).size
          if (sz < 1024 || sz > MAX_CHUNK_BYTES) continue
          const t = await openai.audio.transcriptions.create({ file: fs.createReadStream(cp), model: 'whisper-1', response_format: 'text' })
          chunks.push(typeof t === 'string' ? t : t?.text || '')
        }
        transcript = chunks.join(' ').trim()
      }
    } catch (transcribeErr) {
      console.warn('[clips/upload] Transcript failed:', transcribeErr.message)
    }

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
        textVector   = textEmbed.data[0].embedding.slice(0, 384)
        visualVector = visualEmbed.data[0].embedding.slice(0, 512)
      } catch (embedErr) {
        console.warn('[clips/upload] Embed failed:', embedErr.message)
      }
    }

    const clipData = {
      filename, filepath: filename, fileSizeBytes: req.file.size, fileModifiedAt: null,
      durationMs: meta.durationMs, width: meta.width, height: meta.height, fps: meta.fps, codec: meta.codec,
      clipType, transcript: transcript || null, visualTags, dominantEmotion: null, audioEnergy: 0.5,
      sceneType: clipType === 'daw' ? 'daw-screen' : 'talking-head', thumbnailB64, visualVector, textVector,
    }

    const indexed = await clipIndexer.indexClip(req.user.id, categoryId || null, clipData)
    clearInterval(keepalive)
    res.end(JSON.stringify({
      clip: { ...indexed, thumbnail_b64: thumbnailB64, transcript, duration_ms: meta.durationMs, clip_type: clipType },
      transcript, durationMs: meta.durationMs,
    }))
  } catch (err) {
    console.error('[clips/upload]', err.message)
    clearInterval(keepalive)
    res.end(JSON.stringify({ error: err.message }))
  } finally {
    tmpFiles.forEach(p => { try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch {} })
  }
})

router.delete('/clips/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('clip_index').delete().eq('id', req.params.id).eq('user_id', req.user.id)
    if (error) throw error
    res.json({ deleted: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

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
      totalBytes, totalMb: Math.round(totalBytes / 1024 / 1024), totalDurationMs: totalMs, count: clips.length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/clips', async (req, res) => {
  const { categoryId, limit = 100, offset = 0 } = req.query
  try {
    const result = await clipIndexer.getClipLibrary(req.user.id, categoryId, { limit: parseInt(limit), offset: parseInt(offset) })
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/clips/search', async (req, res) => {
  const { categoryId, visualVector, textVector, clipType, count = 5 } = req.body
  if (!visualVector || !textVector) return res.status(400).json({ error: 'visualVector and textVector required' })
  try {
    const results = await clipIndexer.searchClips(req.user.id, visualVector, textVector, { categoryId, clipType, count })
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── PROJECTS ─────────────────────────────────────────────────────────────────

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

router.post('/projects', async (req, res) => {
  const { categoryId, episodeId, name, footageRoot } = req.body
  const { data, error } = await supabase.from('editor_projects').insert({
    user_id: req.user.id, category_id: categoryId, episode_id: episodeId,
    name: name || 'Untitled edit', footage_root: footageRoot,
  }).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ project: data })
})

router.get('/projects/:id', async (req, res) => {
  const { data, error } = await supabase.from('editor_projects').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single()
  if (error || !data) return res.status(404).json({ error: 'Project not found' })
  res.json({ project: data })
})

router.post('/projects/:id/assemble', async (req, res) => {
  const { edlClipMap, beatVectors = [] } = req.body
  if (!edlClipMap) return res.status(400).json({ error: 'edlClipMap required' })
  try {
    const { data: project } = await supabase.from('editor_projects').select('category_id').eq('id', req.params.id).eq('user_id', req.user.id).single()
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const matchResult = await visionMatcher.matchFullEDL(req.user.id, project.category_id, edlClipMap, beatVectors)
    const timeline    = timelineBuilder.buildTimeline(matchResult.matches, edlClipMap)
    const saved       = await timelineBuilder.saveTimeline(req.params.id, req.user.id, timeline, matchResult.flags)
    res.json({
      project: saved, timeline,
      matchSummary: { totalBeats: matchResult.totalBeats, matched: matchResult.matchedBeats, avgConfidence: matchResult.avgConfidence, flagCount: matchResult.flags.length }
    })
  } catch (err) {
    console.error('[editor/assemble]', err.message)
    res.status(500).json({ error: err.message })
  }
})

router.patch('/projects/:id/timeline', async (req, res) => {
  const { timeline, approvedCuts, rejectedCuts, swapHistory } = req.body
  const updates = { updated_at: new Date().toISOString() }
  if (timeline)      updates.timeline      = timeline
  if (approvedCuts)  updates.approved_cuts = approvedCuts
  if (rejectedCuts)  updates.rejected_cuts = rejectedCuts
  if (swapHistory)   updates.swap_history  = swapHistory
  const { data, error } = await supabase.from('editor_projects').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ project: data })
})

router.post('/projects/:id/swap', async (req, res) => {
  const { clipId, beat, visualVector, textVector } = req.body
  try {
    const { data: project } = await supabase.from('editor_projects').select('category_id').eq('id', req.params.id).eq('user_id', req.user.id).single()
    const candidates = await visionMatcher.getSwapCandidates(req.user.id, project.category_id, clipId, beat, visualVector, textVector)
    res.json({ candidates })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/projects/:id/export', async (req, res) => {
  const { format = 'edl' } = req.query
  try {
    const { data: project } = await supabase.from('editor_projects').select('name, timeline, duration_ms').eq('id', req.params.id).eq('user_id', req.user.id).single()
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const timeline = { clips: project.timeline || [], durationMs: project.duration_ms }
    let content, filename, mimeType
    if (format === 'fcpxml') {
      content = timelineBuilder.exportFCPXML(timeline, project.name); filename = `${project.name.replace(/\s+/g,'-')}.fcpxml`; mimeType = 'application/xml'
    } else if (format === 'otio') {
      content = timelineBuilder.exportOTIO(timeline, project.name); filename = `${project.name.replace(/\s+/g,'-')}.otio`; mimeType = 'application/json'
    } else {
      content = timelineBuilder.exportEDL(timeline, project.name); filename = `${project.name.replace(/\s+/g,'-')}.edl`; mimeType = 'text/plain'
    }
    await supabase.from('editor_projects').update({ last_exported_at: new Date().toISOString(), export_format: format, status: 'exported' }).eq('id', req.params.id)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); res.setHeader('Content-Type', mimeType); res.send(content)
  } catch (err) {
    console.error('[editor/export]', err.message); res.status(500).json({ error: err.message })
  }
})

router.post('/projects/:id/export', async (req, res) => {
  const { format = 'edl' } = req.body
  try {
    const { data: project } = await supabase.from('editor_projects').select('name, timeline, duration_ms').eq('id', req.params.id).eq('user_id', req.user.id).single()
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const timeline = { clips: project.timeline || [], durationMs: project.duration_ms }
    let content, filename, mimeType
    if (format === 'fcpxml') {
      content = timelineBuilder.exportFCPXML(timeline, project.name); filename = `${project.name.replace(/\s+/g,'-')}.fcpxml`; mimeType = 'application/xml'
    } else if (format === 'otio') {
      content = timelineBuilder.exportOTIO(timeline, project.name); filename = `${project.name.replace(/\s+/g,'-')}.otio`; mimeType = 'application/json'
    } else {
      content = timelineBuilder.exportEDL(timeline, project.name); filename = `${project.name.replace(/\s+/g,'-')}.edl`; mimeType = 'text/plain'
    }
    await supabase.from('editor_projects').update({ last_exported_at: new Date().toISOString(), export_format: format, status: 'exported' }).eq('id', req.params.id)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); res.setHeader('Content-Type', mimeType); res.send(content)
  } catch (err) {
    console.error('[editor/export]', err.message); res.status(500).json({ error: err.message })
  }
})

router.get('/projects/:id/export-shorts', async (req, res) => {
  try {
    const { data: project, error } = await supabase.from('editor_projects').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single()
    if (error || !project) return res.status(404).json({ error: 'Project not found' })
    const timeline = project.timeline || { clips: [] }
    let shortsScripts = []
    if (project.episode_id) {
      const { data: episode } = await supabase.from('episodes').select('shorts_scripts, track_name, episode_number').eq('id', project.episode_id).eq('user_id', req.user.id).single()
      if (episode?.shorts_scripts?.length) shortsScripts = episode.shorts_scripts
    }
    if (!shortsScripts.length) return res.status(400).json({ error: 'No Shorts scripts found.', tip: 'Generate shorts for this episode first.' })
    const { exportShortsEDL } = require('../../services/vision/timelineBuilder')
    const content  = exportShortsEDL(shortsScripts, timeline, project.name)
    const filename = `${project.name.replace(/\s+/g, '-')}-SHORTS.edl`
    await supabase.from('editor_projects').update({ last_exported_at: new Date().toISOString(), export_format: 'shorts_edl' }).eq('id', project.id)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(content)
  } catch (err) {
    console.error('[editor/export-shorts]', err.message); res.status(500).json({ error: err.message })
  }
})

// ─── NEXT LEVEL ROUTES ────────────────────────────────────────────────────────

const retentionMapper  = require('../../services/retentionMapper')
const voAlignment      = require('../../services/voAlignment')
const continuityScorer = require('../../services/continuityScorer')
const retentionModel   = require('../../services/retentionModel')

router.post('/retention-template', async (req, res) => {
  const { categoryId, force = false } = req.body
  try {
    if (!force) {
      const { data: cat } = await supabase.from('categories').select('retention_template, retention_template_at').eq('id', categoryId).eq('user_id', req.user.id).single()
      const cacheAge = cat?.retention_template_at ? Date.now() - new Date(cat.retention_template_at).getTime() : Infinity
      if (cat?.retention_template && cacheAge < 24 * 60 * 60 * 1000) return res.json({ template: cat.retention_template, fromCache: true })
    }
    const template = await retentionMapper.buildRetentionTemplate(req.user.id, categoryId)
    res.json({ template, fromCache: false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/retention-curve/:episodeId', async (req, res) => {
  const { curveData } = req.body
  try {
    const result = await retentionMapper.saveRetentionCurve(req.user.id, req.params.episodeId, curveData)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/projects/:id/align', async (req, res) => {
  const { whisperOutput, fps = 25 } = req.body
  if (!whisperOutput) return res.status(400).json({ error: 'whisperOutput required' })
  try {
    const { data: project } = await supabase.from('editor_projects').select('timeline, episode_id').eq('id', req.params.id).eq('user_id', req.user.id).single()
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const wordTimestamps = voAlignment.parseWhisperWordTimestamps(whisperOutput)
    const { timeline: aligned, alignments, aligned: count } = voAlignment.realignTimeline(project.timeline || [], wordTimestamps, fps)
    await supabase.from('editor_projects').update({ timeline: aligned, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('user_id', req.user.id)
    if (project.episode_id) await voAlignment.saveAlignmentData(req.user.id, project.episode_id, { alignments, alignedAt: new Date().toISOString() })
    res.json({ timeline: aligned, alignments, aligned: count, wordCount: wordTimestamps.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/projects/:id/continuity', async (req, res) => {
  const { voScript, trackContext } = req.body
  try {
    const { data: project } = await supabase.from('editor_projects').select('timeline').eq('id', req.params.id).eq('user_id', req.user.id).single()
    if (!project) return res.status(404).json({ error: 'Project not found' })
    const [continuityResult, energyResult] = await Promise.all([
      continuityScorer.scoreContinuity(project.timeline || [], voScript, trackContext),
      Promise.resolve(continuityScorer.analyseEnergyArc(project.timeline || [])),
    ])
    res.json({ continuity: continuityResult, energy: energyResult })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/retention-model/stats', async (req, res) => {
  const { categoryId } = req.query
  try {
    const stats = await retentionModel.getModelStats(req.user.id, categoryId)
    res.json(stats)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/retention-model/training-data', async (req, res) => {
  const { categoryId } = req.query
  try {
    const data = await retentionModel.getTrainingData(req.user.id, categoryId)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── SESSION AUDIO SYNC ───────────────────────────────────────────────────────
// POST /api/editor/sync-audio
// Matches two session journal transcripts by word overlap to find the time offset.
// Body: { sessionIdA, sessionIdB, categoryId }
// Returns: { offsetMs, confidence, syncPhrase, summary }

router.post('/sync-audio', async (req, res) => {
  const { sessionIdA, sessionIdB } = req.body
  if (!sessionIdA || !sessionIdB) return res.status(400).json({ error: 'sessionIdA and sessionIdB required' })

  try {
    const [{ data: sA }, { data: sB }] = await Promise.all([
      supabase.from('session_journals').select('title, transcript').eq('id', sessionIdA).eq('user_id', req.user.id).single(),
      supabase.from('session_journals').select('title, transcript').eq('id', sessionIdB).eq('user_id', req.user.id).single(),
    ])

    if (!sA?.transcript) return res.status(404).json({ error: 'Session A transcript not found — index the audio first' })
    if (!sB?.transcript) return res.status(404).json({ error: 'Session B transcript not found — index the audio first' })

    function parseLines(transcript) {
      return transcript.split('\n').map(line => {
        const m = line.match(/^\[(\d+):(\d+)\]\s*(.*)/)
        if (!m) return null
        return { ms: (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000, text: m[3].trim() }
      }).filter(Boolean)
    }

    function normalise(t) {
      return t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
    }

    const linesA = parseLines(sA.transcript)
    const linesB = parseLines(sB.transcript)

    if (linesA.length < 5 || linesB.length < 5) {
      return res.status(400).json({ error: 'Transcripts too short to sync — need at least 5 lines each' })
    }

    const wordsA = [], wordsB = []
    for (const l of linesA) normalise(l.text).split(' ').filter(Boolean).forEach(w => wordsA.push({ word: w, ms: l.ms }))
    for (const l of linesB) normalise(l.text).split(' ').filter(Boolean).forEach(w => wordsB.push({ word: w, ms: l.ms }))

    const WINDOW = 20
    let bestScore = 0, bestOffset = 0, bestPhrase = ''

    for (let i = 0; i < wordsA.length - WINDOW; i += 5) {
      const sliceA = wordsA.slice(i, i + WINDOW)
      const textA  = sliceA.map(w => w.word).join(' ')
      for (let j = 0; j < wordsB.length - WINDOW; j += 5) {
        const sliceB = wordsB.slice(j, j + WINDOW)
        const textB  = sliceB.map(w => w.word).join(' ')
        const bArr   = textB.split(' ')
        let score = 0, bi = 0
        for (const word of textA.split(' ')) {
          while (bi < bArr.length && bArr[bi] !== word) bi++
          if (bi < bArr.length) { score++; bi++ }
        }
        if (score > bestScore) {
          bestScore  = score
          bestOffset = wordsA[i].ms - wordsB[j].ms
          bestPhrase = textA.split(' ').slice(0, 4).join(' ')
        }
      }
    }

    const offsetSec = Math.round(bestOffset / 100) / 10
    res.json({
      offsetMs:      bestOffset,
      confidence:    bestScore,
      syncPhrase:    bestPhrase,
      sessionATitle: sA.title,
      sessionBTitle: sB.title,
      summary:       `"${sB.title}" is ${Math.abs(offsetSec)}s ${bestOffset >= 0 ? 'ahead' : 'behind'} "${sA.title}". Matched on: "${bestPhrase}"`,
    })
  } catch (err) {
    console.error('[editor/sync-audio]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── BUILD EDL FROM SESSION TRANSCRIPTS ──────────────────────────────────────
// POST /api/editor/build-session-edl
// Takes two synced session journals, asks Claude to cut for retention,
// returns a real CMX3600 .edl file referencing the original video filenames.
// Body: { sessionIdA, sessionIdB, offsetMs, clipNameA, clipNameB, categoryId, targetMinutes, instructions }

const Anthropic = require('@anthropic-ai/sdk')
const aiClient  = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

router.post('/build-session-edl', async (req, res) => {
  const {
    categoryId,
    sessionIdA,
    sessionIdB,
    offsetMs      = 0,
    clipNameA     = 'SCREEN_CAPTURE.mp4',
    clipNameB     = 'CAMERA_FOOTAGE.mp4',
    targetMinutes = 8,
    instructions  = '',
  } = req.body

  if (!categoryId || !sessionIdA) return res.status(400).json({ error: 'categoryId and sessionIdA required' })

  try {
    const [{ data: sA }, sessionBResult, { data: cat }] = await Promise.all([
      supabase.from('session_journals').select('title, transcript').eq('id', sessionIdA).eq('user_id', req.user.id).single(),
      sessionIdB
        ? supabase.from('session_journals').select('title, transcript').eq('id', sessionIdB).eq('user_id', req.user.id).single()
        : Promise.resolve({ data: null }),
      supabase.from('categories').select('name, niche, audience_model').eq('id', categoryId).single(),
    ])

    const sB = sessionBResult?.data || null
    if (!sA?.transcript) return res.status(404).json({ error: 'Primary transcript not found' })

    function parseLines(transcript) {
      return transcript.split('\n').map(line => {
        const m = line.match(/^\[(\d+):(\d+)\]\s*(.*)/)
        if (!m) return null
        return { ms: (parseInt(m[1]) * 60 + parseInt(m[2])) * 1000, text: m[3].trim() }
      }).filter(Boolean)
    }

    const linesA = parseLines(sA.transcript)
    const linesB = sB?.transcript
      ? parseLines(sB.transcript).map(l => ({ ...l, ms: l.ms + offsetMs }))
      : []

    const allLines = [
      ...linesA.map(l => ({ ...l, source: 'screen', clip: clipNameA })),
      ...linesB.map(l => ({ ...l, source: 'camera', clip: clipNameB })),
    ].sort((a, b) => a.ms - b.ms)

    const critical = [
      ...allLines.slice(0, 30),
      ...allLines.filter((_, i) => i >= 30 && i < allLines.length - 10 && i % 5 === 0),
      ...allLines.slice(-10),
    ]

    const transcriptSummary = critical.map(l => {
      const m = Math.floor(l.ms / 60000)
      const s = Math.floor((l.ms % 60000) / 1000)
      return `[${m}:${String(s).padStart(2,'0')}][${l.source}] ${l.text}`
    }).join('\n')

    const audiencePain = cat?.audience_model?.geminiInsights?.psychographics?.corePainPoint || ''

    const cutRes = await aiClient.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: `You are a YouTube video editor specialising in retention. Cut documentary-style creator content.
Output ONLY valid JSON array — no preamble, no markdown.
Format: [{"startMs":number,"endMs":number,"source":"screen"|"camera","reason":"brief reason"}]
Rules:
- Target ~${targetMinutes} minutes total
- Keep: hooks, energy peaks, moments of discovery, decisions, anything marked ★✨⚡
- Cut: dead air >3s, repeated explanations, uninteresting troubleshooting, filler
- Cold open must hook within 30 seconds
- Use camera for reaction/wide shots, screen for direct dialogue and monitor content`,
      messages: [{
        role: 'user',
        content: `Creator: "${cat?.name}". Niche: ${cat?.niche}.${audiencePain ? ` Audience pain: ${audiencePain}.` : ''}
Target: ~${targetMinutes}min.${instructions ? ` Notes: ${instructions}` : ''}

TRANSCRIPT (both sources merged, timecodes in ms):
${transcriptSummary}

Return the cut list JSON.`,
      }],
    })

    let cuts = []
    try {
      cuts = JSON.parse((cutRes.content[0]?.text || '[]').replace(/```json|```/g, '').trim())
    } catch {
      return res.status(500).json({ error: 'Failed to parse cut list — try again' })
    }

    if (!cuts.length) return res.status(500).json({ error: 'No cuts returned — provide more specific instructions' })

    const { msToTC } = timelineBuilder

    function sanitiseReel(filename) {
      return (filename || 'AX').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 32).padEnd(32)
    }

    const title = sA.title || 'WhispaCuts Session Edit'
    let edl = `TITLE: ${title.replace(/[^\x20-\x7E]/g, '_').slice(0, 64)}\nFCM: NON-DROP FRAME\n\n`
    let recMs = 3600000

    cuts.forEach((cut, i) => {
      const n        = String(i + 1).padStart(3, '0')
      const clipName = cut.source === 'camera' ? clipNameB : clipNameA
      const reel     = sanitiseReel(clipName)
      const durMs    = cut.endMs - cut.startMs
      edl += `${n}  ${reel} V   C        ${msToTC(cut.startMs)} ${msToTC(cut.endMs)} ${msToTC(recMs)} ${msToTC(recMs + durMs)}\n`
      edl += `* FROM CLIP NAME: ${clipName}\n`
      if (cut.reason) edl += `* LOC: ${msToTC(recMs)} WHITE  ${cut.reason}\n`
      edl += '\n'
      recMs += durMs
    })

    const totalMs  = recMs - 3600000
    const filename = `${title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 50)}_edit.edl`

    await supabase.from('edl_exports').insert({
      user_id: req.user.id, category_id: categoryId,
      session_id_a: sessionIdA, session_id_b: sessionIdB || null,
      title, edl_content: edl, cut_count: cuts.length,
      total_ms: totalMs, offset_ms: offsetMs,
      created_at: new Date().toISOString(),
    }).catch(() => {})

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('X-EDL-Summary', JSON.stringify({
      cutCount: cuts.length,
      totalMinutes: Math.round(totalMs / 60000 * 10) / 10,
      originalMinutes: Math.round((linesA[linesA.length - 1]?.ms || 0) / 60000),
      filename,
    }))
    res.send(edl)

  } catch (err) {
    console.error('[editor/build-session-edl]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── SESSION JOURNALS FOR EDL PICKER ─────────────────────────────────────────
// GET /api/editor/sessions?categoryId=

router.get('/sessions', async (req, res) => {
  const { categoryId } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })
  const { data } = await supabase
    .from('session_journals')
    .select('id, title, created_at, duration_ms, status')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(20)
  res.json({ sessions: data || [] })
})

// ─── EDL EXPORT HISTORY ───────────────────────────────────────────────────────
// GET /api/editor/edl-exports?categoryId=

router.get('/edl-exports', async (req, res) => {
  const { categoryId } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })
  const { data } = await supabase
    .from('edl_exports')
    .select('id, title, cut_count, total_ms, created_at')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .order('created_at', { ascending: false })
    .limit(10)
  res.json({ exports: data || [] })
})

// GET /api/editor/edl-exports/:id/download

router.get('/edl-exports/:id/download', async (req, res) => {
  const { data } = await supabase
    .from('edl_exports')
    .select('title, edl_content')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()
  if (!data) return res.status(404).json({ error: 'EDL not found' })
  const filename = `${data.title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')}_edit.edl`
  res.setHeader('Content-Type', 'text/plain')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(data.edl_content)
})

module.exports = router