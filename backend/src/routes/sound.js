// backend/src/routes/sound.js
// Sound library management and AI-powered episode sound design.
// Users upload their brand sounds once, Claude selects + places them per episode.

const express  = require('express')
const multer   = require('multer')
const Anthropic = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')
const { assembleContext } = require('../services/contextAssembler')

const router  = express.Router()
const client  = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const upload  = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 50 * 1024 * 1024 },   // 50MB per file
  fileFilter: (req, file, cb) => {
    const ok = /^audio\/(mpeg|mp3|wav|ogg|aac|flac|x-wav|x-flac|mp4|webm)/.test(file.mimetype)
      || /\.(mp3|wav|ogg|aac|flac|m4a)$/i.test(file.originalname)
    cb(null, ok)
    if (!ok) cb(new Error('Only audio files accepted'))
  },
})

// ─── GET OR CREATE LIBRARY ───────────────────────────────────────────────────

router.get('/library', async (req, res) => {
  const { categoryId } = req.query

  let { data: library } = await supabase
    .from('sound_libraries')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .single()

  if (!library) {
    const { data: created } = await supabase
      .from('sound_libraries')
      .insert({ user_id: req.user.id, category_id: categoryId })
      .select()
      .single()
    library = created
  }

  res.json({ library })
})

// ─── LIST ASSETS ─────────────────────────────────────────────────────────────

router.get('/assets', async (req, res) => {
  const { categoryId, assetType, mood } = req.query

  let query = supabase
    .from('sound_assets')
    .select(`
      id, name, filename, asset_type, mood_tags,
      energy_level, bpm, duration_ms, use_count, last_used_at
    `)
    .eq('user_id', req.user.id)
    .order('asset_type')
    .order('name')

  if (assetType) query = query.eq('asset_type', assetType)
  if (mood)      query = query.contains('mood_tags', [mood])

  // Filter by category via library join
  if (categoryId) {
    const { data: library } = await supabase
      .from('sound_libraries')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('category_id', categoryId)
      .single()
    if (library) query = query.eq('library_id', library.id)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  // Group by type for easy UI rendering
  const grouped = (data || []).reduce((acc, asset) => {
    if (!acc[asset.asset_type]) acc[asset.asset_type] = []
    acc[asset.asset_type].push(asset)
    return acc
  }, {})

  res.json({ assets: data || [], grouped, total: data?.length || 0 })
})

// ─── UPLOAD ASSET ─────────────────────────────────────────────────────────────

router.post('/assets', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })

  const { categoryId, name, assetType, moodTags, energyLevel, bpm } = req.body

  if (!assetType) return res.status(400).json({ error: 'assetType required' })

  // Get or create library
  let { data: library } = await supabase
    .from('sound_libraries')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .single()

  if (!library) {
    const { data: created } = await supabase
      .from('sound_libraries')
      .insert({ user_id: req.user.id, category_id: categoryId })
      .select()
      .single()
    library = created
  }

  // Upload to Supabase Storage
  const storagePath = `${req.user.id}/sounds/${library.id}/${Date.now()}-${req.file.originalname}`

  const { error: uploadError } = await supabase.storage
    .from('sound-library')
    .upload(storagePath, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert:      false,
    })

  if (uploadError) return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })

  // Parse mood tags
  const parsedMoods = typeof moodTags === 'string'
    ? moodTags.split(',').map(t => t.trim()).filter(Boolean)
    : (moodTags || [])

  // Save asset record
  const { data: asset, error: dbError } = await supabase
    .from('sound_assets')
    .insert({
      user_id:      req.user.id,
      library_id:   library.id,
      name:         name || req.file.originalname.replace(/\.[^.]+$/, ''),
      filename:     req.file.originalname,
      storage_path: storagePath,
      file_size:    req.file.size,
      mime_type:    req.file.mimetype,
      asset_type:   assetType,
      mood_tags:    parsedMoods,
      energy_level: energyLevel ? parseFloat(energyLevel) : null,
      bpm:          bpm ? parseInt(bpm) : null,
    })
    .select()
    .single()

  if (dbError) return res.status(500).json({ error: dbError.message })
  res.status(201).json({ asset })
})

// ─── GET SIGNED URL for playback ────────────────────────────────────────────

router.get('/assets/:id/url', async (req, res) => {
  const { data: asset } = await supabase
    .from('sound_assets')
    .select('storage_path')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!asset) return res.status(404).json({ error: 'Asset not found' })

  const { data, error } = await supabase.storage
    .from('sound-library')
    .createSignedUrl(asset.storage_path, 3600)   // 1hr signed URL

  if (error) return res.status(500).json({ error: error.message })
  res.json({ url: data.signedUrl })
})

// ─── UPDATE ASSET METADATA ────────────────────────────────────────────────────

router.patch('/assets/:id', async (req, res) => {
  const { name, moodTags, energyLevel, bpm, assetType } = req.body
  const updates = {}
  if (name !== undefined)        updates.name         = name
  if (assetType !== undefined)   updates.asset_type   = assetType
  if (energyLevel !== undefined) updates.energy_level = parseFloat(energyLevel)
  if (bpm !== undefined)         updates.bpm          = parseInt(bpm)
  if (moodTags !== undefined) {
    updates.mood_tags = typeof moodTags === 'string'
      ? moodTags.split(',').map(t => t.trim()).filter(Boolean)
      : moodTags
  }

  const { data, error } = await supabase
    .from('sound_assets')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ asset: data })
})

// ─── DELETE ASSET ─────────────────────────────────────────────────────────────

router.delete('/assets/:id', async (req, res) => {
  const force = req.query.force === 'true'

  const { data: asset } = await supabase
    .from('sound_assets')
    .select('storage_path, name')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!asset) return res.status(404).json({ error: 'Asset not found' })

  // Check for existing placements before deleting
  const { data: placements, count } = await supabase
    .from('episode_sound_placements')
    .select('episode_id', { count: 'exact' })
    .eq('asset_id', req.params.id)
    .eq('user_id', req.user.id)

  if (count > 0 && !force) {
    return res.status(409).json({
      error: `"${asset.name}" is placed in ${count} episode${count > 1 ? 's' : ''}`,
      placements: count,
      tip: 'Add ?force=true to delete anyway (placements will be cleared)',
    })
  }

  // Remove placements first (cascade)
  if (count > 0) {
    await supabase
      .from('episode_sound_placements')
      .delete()
      .eq('asset_id', req.params.id)
      .eq('user_id', req.user.id)
  }

  // Delete from Supabase Storage
  await supabase.storage.from('sound-library').remove([asset.storage_path])

  // Delete DB record
  await supabase.from('sound_assets').delete().eq('id', req.params.id)
  res.json({ deleted: true, placementsCleared: count || 0 })
})

// ─── GENERATE EPISODE SOUND DESIGN ───────────────────────────────────────────
// The core feature: Claude reads your library + episode structure
// and places specific assets at specific timecodes.

router.post('/episodes/:episodeId/design', async (req, res) => {
  const { episodeId } = req.params
  const { categoryId } = req.body

  // Load episode
  const { data: episode } = await supabase
    .from('episodes')
    .select('*')
    .eq('id', episodeId)
    .eq('user_id', req.user.id)
    .single()

  if (!episode) return res.status(404).json({ error: 'Episode not found' })

  // Load sound library
  const { data: assets } = await supabase
    .from('sound_assets')
    .select('id, name, asset_type, mood_tags, energy_level, bpm, duration_ms')
    .eq('user_id', req.user.id)

  if (!assets?.length) {
    return res.status(400).json({
      error: 'No sounds in your library yet. Upload your brand sounds first.',
    })
  }

  // Group assets by type for the prompt
  const byType = assets.reduce((acc, a) => {
    if (!acc[a.asset_type]) acc[a.asset_type] = []
    acc[a.asset_type].push(
      `ID:${a.id} "${a.name}" [${a.mood_tags?.join(', ')}] energy:${a.energy_level ?? '?'} ${a.bpm ? `${a.bpm}bpm` : ''} ${a.duration_ms ? `${Math.round(a.duration_ms/1000)}s` : ''}`
    )
    return acc
  }, {})

  const libraryStr = Object.entries(byType)
    .map(([type, items]) => `${type.toUpperCase()}:\n${items.map(i => `  ${i}`).join('\n')}`)
    .join('\n\n')

  // Build context
  const context = await assembleContext(req.user.id, categoryId, { mode: 'sound' })

  try {
    const response = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 2000,
      system:     context,
      messages: [{
        role: 'user',
        content: `Design the complete sound placement for this episode using ONLY assets from the library below.

EPISODE: "${episode.track_name}" — ${episode.track_mood || ''} ${episode.track_genre || ''}
BPM: ${episode.track_bpm || 'unknown'}
VO SCRIPT (excerpt):
${(episode.vo_script || '').slice(0, 600)}

RETENTION CURVE (energy by minute):
${episode.retention_curve || 'not available'}

SOUND LIBRARY:
${libraryStr}${lockedConstraints}

Create a complete sound design with placements at specific timecodes.
Rules:
- Use asset IDs exactly as shown (ID:xxx)
- Timecodes in MM:SS format
- Music beds should support, not fight the VO
- Stings at key editorial moments only
- Atmospheres throughout but at low volume (−12 to −18dB)
- Transition sounds at scene changes
- Match energy level to the retention curve

Return JSON:
{
  "placements": [
    {
      "assetId": "uuid",
      "assetName": "name",
      "track": "A2",
      "recInMs": 0,
      "recOutMs": 45000,
      "fadeInMs": 2000,
      "fadeOutMs": 3000,
      "volumeDb": -14,
      "note": "why this asset here"
    }
  ],
  "mixNotes": "overall mix strategy",
  "totalDurationMs": 0
}`
      }]
    })

    let placements = []
    let mixNotes   = ''
    let totalMs    = 0

    try {
      const parsed  = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim())
      placements    = parsed.placements || []
      mixNotes      = parsed.mixNotes   || ''
      totalMs       = parsed.totalDurationMs || 0
    } catch {
      return res.status(500).json({ error: 'Claude returned invalid JSON', raw: response.content[0].text })
    }

    // Save placements to DB — preserve any locked placements
    if (placements.length) {
      // Get locked placements before wiping (user may have locked specific ones)
      const { data: locked } = await supabase
        .from('episode_sound_placements')
        .select('*')
        .eq('episode_id', episodeId)
        .eq('user_id', req.user.id)
        .eq('is_locked', true)

      // Clear unlocked placements only
      await supabase
        .from('episode_sound_placements')
        .delete()
        .eq('episode_id', episodeId)
        .eq('user_id', req.user.id)
        .eq('is_locked', false)

      // Build constraint string for Claude from locked placements
      const lockedConstraints = locked?.length
        ? '\nLOCKED PLACEMENTS (keep these, design around them):\n' +
          locked.map(lp => `  ${lp.asset_name} at ${Math.round(lp.rec_in_ms/1000)}s on ${lp.track}`).join('\n')
        : ''

      // Insert new placements
      const rows = placements.map(p => ({
        user_id:        req.user.id,
        episode_id:     episodeId,
        asset_id:       p.assetId,
        asset_name:     p.assetName,
        track:          p.track || 'A2',
        rec_in_ms:      p.recInMs || 0,
        rec_out_ms:     p.recOutMs || null,
        fade_in_ms:     p.fadeInMs || 0,
        fade_out_ms:    p.fadeOutMs || 500,
        volume_db:      p.volumeDb || 0,
        placement_note: p.note || '',
      }))

      await supabase.from('episode_sound_placements').insert(rows)

      // Increment use counts
      const usedIds = [...new Set(placements.map(p => p.assetId).filter(Boolean))]
      for (const id of usedIds) {
        await supabase.from('sound_assets')
          .update({ use_count: supabase.rpc('increment', { x: 1 }), last_used_at: new Date().toISOString() })
          .eq('id', id)
          .eq('user_id', req.user.id)
      }
    }

    res.json({ placements, mixNotes, totalDurationMs: totalMs })

  } catch (err) {
    res.status(502).json({ error: 'Sound design failed: ' + err.message })
  }
})

// ─── LOCK / UNLOCK PLACEMENT ─────────────────────────────────────────────────

router.patch('/episodes/:episodeId/placements/:placementId/lock', async (req, res) => {
  const { locked } = req.body
  const { data, error } = await supabase
    .from('episode_sound_placements')
    .update({ is_locked: !!locked })
    .eq('id', req.params.placementId)
    .eq('episode_id', req.params.episodeId)
    .eq('user_id', req.user.id)
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json({ placement: data })
})

// ─── GET EPISODE PLACEMENTS ───────────────────────────────────────────────────

router.get('/episodes/:episodeId/placements', async (req, res) => {
  const { data, error } = await supabase
    .from('episode_sound_placements')
    .select('*, sound_assets(name, asset_type, duration_ms)')
    .eq('episode_id', req.params.episodeId)
    .eq('user_id', req.user.id)
    .order('rec_in_ms')

  if (error) return res.status(500).json({ error: error.message })
  res.json({ placements: data || [] })
})

// ─── EXPORT SOUND PLACEMENT EDL EXTENSION ────────────────────────────────────
// Returns additional EDL lines for audio tracks A2, A3, A4
// Append these to the main video EDL before importing to DaVinci

router.get('/episodes/:episodeId/export-edl', async (req, res) => {
  const { data: placements } = await supabase
    .from('episode_sound_placements')
    .select('*, sound_assets(filename, duration_ms)')
    .eq('episode_id', req.params.episodeId)
    .eq('user_id', req.user.id)
    .order('rec_in_ms')

  if (!placements?.length) {
    return res.status(404).json({ error: 'No sound placements found for this episode' })
  }

  const fps = 25
  const msToTc = ms => {
    const f  = Math.round(ms * fps / 1000)
    const ff = f % fps
    const ss = Math.floor(f / fps) % 60
    const mm = Math.floor(f / fps / 60) % 60
    const hh = Math.floor(f / fps / 3600)
    return [hh, mm, ss, ff].map(n => String(n).padStart(2, '0')).join(':')
  }

  let edl = `TITLE: episode-sound\nFCM: NON-DROP FRAME\n\n`
  let idx = 1

  placements.forEach(p => {
    const reel   = (p.asset_name || 'audio').replace(/[^a-z0-9_-]/gi,'_').slice(0, 32)
    const srcIn  = '00:00:00:00'
    const srcOut = p.rec_out_ms
      ? msToTc(p.rec_out_ms - p.rec_in_ms)
      : msToTc(p.sound_assets?.duration_ms || 30000)
    const recIn  = msToTc(p.rec_in_ms + 3600000)   // offset to 01:00:00:00
    const recOut = p.rec_out_ms
      ? msToTc(p.rec_out_ms + 3600000)
      : msToTc(p.rec_in_ms + (p.sound_assets?.duration_ms || 30000) + 3600000)

    const n    = String(idx).padStart(3, '0')
    const track = p.track || 'A2'
    edl += `${n}  ${reel.padEnd(32)} ${track}    C        ${srcIn} ${srcOut} ${recIn} ${recOut}\n`
    edl += `* FROM CLIP NAME: ${p.asset_name || 'audio'}\n`
    if (p.volume_db && p.volume_db !== 0) edl += `* AUDIO LEVEL: ${p.volume_db}dB\n`
    if (p.placement_note) edl += `* NOTE: ${p.placement_note}\n`
    edl += '\n'
    idx++
  })

  res.setHeader('Content-Disposition', `attachment; filename="episode-sound.edl"`)
  res.setHeader('Content-Type', 'text/plain')
  res.send(edl)
})

module.exports = router
