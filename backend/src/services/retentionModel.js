// backend/src/services/retentionModel.js
// Manages training data for the personal retention model.
// The actual model trains and runs in the browser via TF.js.
// This service handles: storing training examples, fetching training data,
// saving model weights, and providing prediction context.

const { supabase } = require('../utils/supabase')

// ─── STORE TRAINING EXAMPLE ───────────────────────────────────────────────────

/**
 * Store a training example when an episode's performance data is known.
 * Called when analytics are uploaded and matched to an episode.
 *
 * Each clip in the episode generates one training example:
 * features = [visual_vector, text_vector, audio_energy, clip_type_encoded, timeline_position]
 * label    = did this clip retain viewers (retention_delta > -5)?
 */
async function storeTrainingExamples(userId, categoryId, episode) {
  const {
    id: episodeId,
    timeline,
    yt_retention_score,
    retention_curve_map,
    yt_avg_view_pct,
  } = episode

  if (!timeline?.length || !yt_retention_score) return 0

  const totalDurationMs = timeline.reduce((s, c) => s + (c.durationMs || 0), 0)

  // Get clip vectors from clip_index
  const clipIds = timeline.filter(c => c.clipId).map(c => c.clipId)
  if (!clipIds.length) return 0

  const { data: clips } = await supabase
    .from('clip_index')
    .select('id, visual_vector, text_vector, audio_energy, clip_type')
    .in('id', clipIds)

  if (!clips?.length) return 0

  const clipMap = new Map(clips.map(c => [c.id, c]))
  const examples = []
  let positionMs = 0

  for (const clip of timeline) {
    if (!clip.clipId) continue
    const clipData = clipMap.get(clip.clipId)
    if (!clipData) continue

    // Calculate retention at this position
    const positionPct     = totalDurationMs > 0 ? positionMs / totalDurationMs : 0
    const retentionAtPos  = getRetentionAtPosition(retention_curve_map, positionMs / 1000)
    const retentionNext   = getRetentionAtPosition(retention_curve_map, (positionMs + (clip.durationMs || 0)) / 1000)
    const retentionDelta  = retentionNext !== null && retentionAtPos !== null
      ? retentionNext - retentionAtPos
      : null

    examples.push({
      user_id:            userId,
      category_id:        categoryId,
      episode_id:         episodeId,
      clip_id:            clip.clipId,
      visual_vector:      clipData.visual_vector,
      text_vector:        clipData.text_vector,
      audio_energy:       clipData.audio_energy,
      clip_type:          clipData.clip_type,
      timeline_position:  positionPct,
      vo_segment:         clip.intentTag || '',
      retention_delta:    retentionDelta,
      retained:           retentionDelta !== null ? retentionDelta > -5 : yt_retention_score > 60,
    })

    positionMs += clip.durationMs || 0
  }

  if (!examples.length) return 0

  // Batch insert
  const CHUNK = 50
  let inserted = 0
  for (let i = 0; i < examples.length; i += CHUNK) {
    const { error } = await supabase
      .from('retention_model_data')
      .upsert(examples.slice(i, i + CHUNK), { onConflict: 'episode_id,clip_id' })
    if (!error) inserted += Math.min(CHUNK, examples.length - i)
  }

  console.log(`[retentionModel] Stored ${inserted} training examples for episode ${episodeId}`)
  return inserted
}

// ─── FETCH TRAINING DATA ─────────────────────────────────────────────────────

/**
 * Fetch training data for the browser model.
 * Returns flattened feature vectors + labels for TF.js training.
 */
async function getTrainingData(userId, categoryId) {
  const { data, error } = await supabase
    .from('retention_model_data')
    .select('visual_vector, text_vector, audio_energy, clip_type, timeline_position, retained')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .not('visual_vector', 'is', null)
    .limit(2000)

  if (error) throw new Error(error.message)
  if (!data?.length) return { examples: [], ready: false, count: 0 }

  // Encode clip_type as one-hot: [cam, daw, broll]
  const examples = data.map(row => ({
    features: [
      // visual_vector (512) + text_vector (384) are large — send PCA-reduced version
      // For now: send key stats rather than full vectors to keep payload manageable
      parseFloat(row.audio_energy) || 0,
      row.timeline_position || 0,
      row.clip_type === 'cam'   ? 1 : 0,
      row.clip_type === 'daw'   ? 1 : 0,
      row.clip_type === 'broll' ? 1 : 0,
    ],
    label: row.retained ? 1 : 0,
  }))

  const positives = examples.filter(e => e.label === 1).length
  const negatives = examples.filter(e => e.label === 0).length

  return {
    examples,
    ready:     examples.length >= 20,
    count:     examples.length,
    positives,
    negatives,
    balance:   positives / examples.length,
  }
}

/**
 * Get training data count for UI display
 */
async function getModelStats(userId, categoryId) {
  const { count } = await supabase
    .from('retention_model_data')
    .select('id', { count: 'exact' })
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .not('visual_vector', 'is', null)

  const ready = (count || 0) >= 20
  return {
    trainingExamples: count || 0,
    ready,
    needed:           Math.max(0, 20 - (count || 0)),
    message:          ready
      ? `Personal model ready — trained on ${count} clips from your episodes`
      : `Need ${Math.max(0, 20 - (count || 0))} more clip examples (publish ~3 more episodes with analytics)`,
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getRetentionAtPosition(curveMap, seconds) {
  if (!curveMap) return null
  const times = Object.keys(curveMap).map(Number).sort((a, b) => a - b)
  if (!times.length) return null
  const nearest = times.reduce((prev, curr) =>
    Math.abs(curr - seconds) < Math.abs(prev - seconds) ? curr : prev
  )
  return curveMap[nearest]
}

module.exports = {
  storeTrainingExamples,
  getTrainingData,
  getModelStats,
}
