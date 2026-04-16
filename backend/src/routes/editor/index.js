// backend/src/routes/editor/index.js
// All editor API routes. Mounts at /api/editor
// STATUS: ROUTES WIRED — individual handlers vary from working to stubbed

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
 * STATUS: READY — depends on clipIndexer.indexClip (stubbed)
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
 * STATUS: READY — depends on clipIndexer.indexClipBatch (stubbed)
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
 * STATUS: READY — depends on clipIndexer.searchClips (stubbed at DB level)
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
 * STATUS: PLACEHOLDER — core assembly logic stubbed in visionMatcher
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
 * STATUS: PLACEHOLDER — depends on visionMatcher.getSwapCandidates (stubbed)
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
 * STATUS: EDL WORKING — FCPXML/OTIO are stubs
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
