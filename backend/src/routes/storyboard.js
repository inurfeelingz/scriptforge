// backend/src/routes/storyboard.js
// Storyboard generation — extracts shots from episode scripts, matches to clip index

const express   = require('express')
const Anthropic  = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')

const router = express.Router()
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SHOT_TYPES = ['ecu','cu','mcu','ms','mws','ws','ews','ots','two','low','high','dutch','pov','th']

// ── POST /api/storyboard/generate ─────────────────────────────────────────────
// Generate a storyboard from an episode script
router.post('/generate', async (req, res) => {
  const { episodeId, categoryId, gender = 'male', maxFrames = 20 } = req.body
  if (!episodeId) return res.status(400).json({ error: 'episodeId required' })

  try {
    console.log('[storyboard/generate] userId:', req.user.id, 'episodeId:', episodeId)
    // Load the episode
    const { data: episode, error: epErr } = await supabase
      .from('episodes')
      .select('title, track_name, parsed_content, generation_decisions, track_context')
      .eq('id', episodeId)
      .eq('user_id', req.user.id)
      .single()

    if (epErr || !episode) return res.status(404).json({ error: 'Episode not found' })

    const scriptContent = episode.parsed_content
      ? JSON.stringify(episode.parsed_content)
      : 'No script content available'

    // Ask Claude to extract shot list
    const extraction = await client.messages.create({
      model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: `You are a cinematographer breaking down a YouTube video script into a shot list.
Extract shots from the script and return ONLY a JSON array. No preamble.
Each shot: { "position": number, "shot_type": one of [${SHOT_TYPES.join(',')}], "section": string, "description": string (what to physically capture, 1 sentence), "notes": string (framing/performance tip, 1 sentence) }
Choose shot types that match the content:
- ecu/cu for emotional moments, reactions
- mcu/ms for talking head/presentation (most common for YouTube)  
- th for standard presenter shots
- mws/ws when showing full body or demonstrating something
- ots/two for conversations or when referencing something off-camera
- low/high/dutch for stylistic variety or emphasis
- pov when referencing what the creator is looking at
- ews for establishing context
Keep it practical and achievable for a solo creator. Max ${maxFrames} shots.`,
      messages: [{ role: 'user', content: `Extract a shot list from this episode:\n\nTitle: ${episode.track_name || episode.title}\n\nScript:\n${scriptContent.slice(0, 4000)}` }],
    })

    let frames = []
    try {
      const text = extraction.content[0]?.text || '[]'
      frames = JSON.parse(text.replace(/```json|```/g, '').trim())
    } catch {
      return res.status(422).json({ error: 'Could not extract shot list from episode' })
    }

    // Create storyboard record
    const { data: board, error: boardErr } = await supabase
      .from('storyboards')
      .insert({
        user_id:    req.user.id,
        category_id: categoryId || null,
        episode_id: episodeId,
        title:      episode.track_name || episode.title,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (boardErr) throw boardErr

    // Insert frames
    const frameRows = frames.map((f, i) => ({
      storyboard_id: board.id,
      user_id:       req.user.id,
      position:      f.position ?? i,
      shot_type:     SHOT_TYPES.includes(f.shot_type) ? f.shot_type : 'ms',
      gender,
      section:       f.section || '',
      description:   f.description || '',
      notes:         f.notes || '',
    }))

    const { data: insertedFrames, error: framesErr } = await supabase
      .from('storyboard_frames')
      .insert(frameRows)
      .select()

    if (framesErr) throw framesErr

    // Auto-match clips from clip_index using text similarity
    await matchClipsToFrames(req.user.id, insertedFrames)

    // Reload with matched clips
    const { data: finalFrames } = await supabase
      .from('storyboard_frames')
      .select('*')
      .eq('storyboard_id', board.id)
      .order('position')

    res.json({ storyboard: board, frames: finalFrames })

  } catch (err) {
    console.error('[storyboard/generate]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/storyboard ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { categoryId, episodeId } = req.query
  let query = supabase
    .from('storyboards')
    .select('id, title, episode_id, category_id, created_at, updated_at')
    .eq('user_id', req.user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (categoryId) query = query.eq('category_id', categoryId)
  if (episodeId)  query = query.eq('episode_id', episodeId)

  const { data } = await query
  res.json({ storyboards: data || [] })
})

// ── GET /api/storyboard/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  const { data: board } = await supabase
    .from('storyboards')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!board) return res.status(404).json({ error: 'Not found' })

  const { data: frames } = await supabase
    .from('storyboard_frames')
    .select(`*, matched_clip:clip_index(filename, transcript, duration_ms, visual_tags)`)
    .eq('storyboard_id', req.params.id)
    .order('position')

  res.json({ storyboard: board, frames: frames || [] })
})

// ── PATCH /api/storyboard/frame/:id ───────────────────────────────────────────
router.patch('/frame/:id', async (req, res) => {
  const { shot_type, gender, notes, description, position, matched_clip_id } = req.body
  const updates = {}
  if (shot_type)       updates.shot_type       = shot_type
  if (gender)          updates.gender          = gender
  if (notes !== undefined)       updates.notes = notes
  if (description !== undefined) updates.description = description
  if (position !== undefined)    updates.position    = position
  if (matched_clip_id !== undefined) updates.matched_clip_id = matched_clip_id

  const { data, error } = await supabase
    .from('storyboard_frames')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ frame: data })
})

// ── DELETE /api/storyboard/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  await supabase.from('storyboards').delete().eq('id', req.params.id).eq('user_id', req.user.id)
  res.json({ deleted: true })
})

// ── POST /api/storyboard/:id/match-clips ──────────────────────────────────────
// Re-run clip matching after new footage is indexed
router.post('/:id/match-clips', async (req, res) => {
  const { data: frames } = await supabase
    .from('storyboard_frames')
    .select('*')
    .eq('storyboard_id', req.params.id)
    .eq('user_id', req.user.id)

  if (!frames?.length) return res.json({ matched: 0 })

  const matched = await matchClipsToFrames(req.user.id, frames)
  res.json({ matched })
})

// ── HELPERS ───────────────────────────────────────────────────────────────────

// Simple text-based clip matching — finds clips whose transcript/tags match the frame description
async function matchClipsToFrames(userId, frames) {
  const { data: clips } = await supabase
    .from('clip_index')
    .select('id, filename, transcript, visual_tags, clip_type, duration_ms')
    .eq('user_id', userId)
    .not('transcript', 'is', null)
    .limit(200)

  if (!clips?.length) return 0

  let matchCount = 0

  for (const frame of frames) {
    if (!frame.description) continue

    // Score each clip against this frame's description
    const descWords = (frame.description + ' ' + frame.section).toLowerCase().split(/\s+/)

    let bestScore = 0
    let bestClipId = null

    for (const clip of clips) {
      const clipText = [
        clip.transcript || '',
        ...(clip.visual_tags || []),
        clip.clip_type || '',
      ].join(' ').toLowerCase()

      const score = descWords.filter(w => w.length > 3 && clipText.includes(w)).length

      // Bonus for matching shot type to clip type
      const shotToClipType = { th: 'cam', mcu: 'cam', cu: 'cam', ecu: 'cam', ms: 'cam', ws: 'cam', mws: 'cam', pov: 'cam' }
      if (shotToClipType[frame.shot_type] === clip.clip_type) {
        // Slight bonus
      }

      if (score > bestScore) {
        bestScore = score
        bestClipId = clip.id
      }
    }

    if (bestScore >= 2 && bestClipId) {
      await supabase
        .from('storyboard_frames')
        .update({ matched_clip_id: bestClipId })
        .eq('id', frame.id)
      matchCount++
    }
  }

  return matchCount
}

module.exports = router