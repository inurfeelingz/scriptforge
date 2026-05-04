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
    ffmpeg.ffprobe(inputPath, (err, meta) => {
      resolve(err ? 0 : Math.ceil(meta?.format?.duration || 0))
    })
  })
}

// Extract a single audio chunk from inputPath
function extractChunk(inputPath, outputPath, startSecs, durationSecs) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .seekInput(startSecs)
      .duration(durationSecs)
      .audioCodec('libmp3lame')
      .audioBitrate('64k')
      .audioChannels(1)
      .audioFrequency(16000)
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run()
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
  const { categoryId } = req.query

  const { data, error } = await supabase
    .from('editor_projects')
    .select('id, name, status, duration_ms, ai_confidence, last_exported_at, created_at, episode_id')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .order('created_at', { ascending: false })

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