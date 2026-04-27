// backend/src/routes/shorts.js
// Endpoints for Shorts/Reels generation and thumbnail concepts.
//
//   POST /api/shorts/generate       — generate 3 shorts from an episode
//   POST /api/shorts/thumbnails     — generate 3 thumbnail concepts for an episode
//   GET  /api/shorts/:episodeId     — fetch saved shorts + thumbnails for an episode

const express  = require('express')
const { supabase } = require('../utils/supabase')
const { generateShortsFromEpisode, generateThumbnailConcepts } = require('../services/shortsService')

const router = express.Router()

// ─── GENERATE SHORTS ─────────────────────────────────────────────────────────

router.post('/generate', async (req, res) => {
  const { episodeId, categoryId } = req.body
  if (!episodeId || !categoryId) {
    return res.status(400).json({ error: 'episodeId and categoryId required' })
  }

  try {
    const result = await generateShortsFromEpisode(req.user.id, categoryId, episodeId)
    res.json(result)
  } catch (err) {
    console.error('[shorts/generate]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── GENERATE THUMBNAIL CONCEPTS ─────────────────────────────────────────────

router.post('/thumbnails', async (req, res) => {
  const { episodeId, categoryId } = req.body
  if (!episodeId || !categoryId) {
    return res.status(400).json({ error: 'episodeId and categoryId required' })
  }

  try {
    const result = await generateThumbnailConcepts(req.user.id, categoryId, episodeId)
    res.json(result)
  } catch (err) {
    console.error('[shorts/thumbnails]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── ADD SERIES BIBLE ROUTE ───────────────────────────────────────────────────
// Must be registered BEFORE /:episodeId to prevent Express matching 'bible' as an episodeId

const { generateSeriesBible } = require('../services/seriesBible')

router.get('/bible/:categoryId', async (req, res) => {
  const force = req.query.force === 'true'
  try {
    const bible = await generateSeriesBible(req.user.id, req.params.categoryId, force)
    res.json(bible)
  } catch (err) {
    console.error('[shorts/bible]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── GET SAVED SHORTS + THUMBNAILS ───────────────────────────────────────────

router.get('/:episodeId', async (req, res) => {
  const { data, error } = await supabase
    .from('episodes')
    .select('id, episode_number, track_name, shorts_scripts, thumbnail_concepts, short_form_moments')
    .eq('id', req.params.episodeId)
    .eq('user_id', req.user.id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Episode not found' })

  res.json({
    episodeId:          data.id,
    episodeNumber:      data.episode_number,
    trackName:          data.track_name,
    shorts:             data.shorts_scripts    || [],
    thumbnailConcepts:  data.thumbnail_concepts || [],
    shortformMoments:   data.short_form_moments || '',
  })
})

module.exports = router
