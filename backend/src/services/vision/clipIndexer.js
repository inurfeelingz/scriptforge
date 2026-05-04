// backend/src/services/vision/clipIndexer.js
// Stores clip vectors in Supabase pgvector and handles semantic search.
// All AI runs client-side — this service only handles DB operations.

const { supabase } = require('../../utils/supabase')

// ─── INDEX A SINGLE CLIP ──────────────────────────────────────────────────────

async function indexClip(userId, categoryId, clipData) {
  const {
    filename, filepath, fileSizeBytes, fileModifiedAt, durationMs,
    width, height, fps, codec, clipType,
    transcript, visualTags, dominantEmotion,
    audioEnergy, sceneType, thumbnailB64,
    visualVector, textVector,
  } = clipData

  // Validate vector dimensions before sending to DB
  if (!Array.isArray(visualVector) || visualVector.length !== 512) {
    throw new Error(`Invalid visual vector: expected 512 dims, got ${visualVector?.length}`)
  }
  if (!Array.isArray(textVector) || textVector.length !== 384) {
    throw new Error(`Invalid text vector: expected 384 dims, got ${textVector?.length}`)
  }

  // Deduplicate: skip re-indexing if file hasn't changed (same path + mtime)
  if (fileModifiedAt) {
    const { data: existing } = await supabase
      .from('clip_index')
      .select('id, file_modified_at, transcript')
      .eq('user_id', userId)
      .eq('filepath', filepath?.replace(/^\/+/, '').replace(/\.\.\//g, '').trim() || filename)
      .maybeSingle()

    if (existing && existing.file_modified_at === fileModifiedAt && existing.transcript) {
      // File unchanged AND already has transcript — return cached record
      return { id: existing.id, filename, clip_type: detectClipType(filename), cached: true }
    }
  }

  // Sanitise filepath — remove any absolute path prefix, keep relative only
  const safePath = filepath
    ? filepath.replace(/^\/+/, '').replace(/\.\.\//g, '').trim()
    : filename

  // Compress thumbnail if too large (> 20KB base64 = ~15KB image)
  const thumb = thumbnailB64 && thumbnailB64.length > 27000 ? null : thumbnailB64

  const record = {
    user_id:          userId,
    category_id:      categoryId || null,
    filename,
    filepath:         safePath,
    file_size:        fileSizeBytes   || null,
    file_modified_at: fileModifiedAt  || null,
    duration_ms:      durationMs      || null,
    width:            width           || null,
    height:           height          || null,
    fps:              fps             || null,
    codec:            codec           || null,
    clip_type:        clipType        || detectClipType(filename),
    transcript:       transcript      || null,
    visual_tags:      visualTags      || [],
    dominant_emotion: dominantEmotion || null,
    audio_energy:     audioEnergy     ?? null,
    scene_type:       sceneType       || null,
    thumbnail_b64:    thumb,
    visual_vector:    `[${visualVector.join(',')}]`,  // pgvector format
    text_vector:      `[${textVector.join(',')}]`,
    indexed_at:       new Date().toISOString(),
    needs_reindex:    false,
  }

  const { data, error } = await supabase
    .from('clip_index')
    .upsert(record, { onConflict: 'user_id,filepath' })
    .select('id, filename, clip_type')
    .single()

  if (error) throw new Error(`Clip index failed for "${filename}": ${error.message}`)
  return data
}

// ─── BATCH INDEX ──────────────────────────────────────────────────────────────

async function indexClipBatch(userId, categoryId, clips) {
  const results = { success: [], failed: [] }
  const CHUNK   = 20  // upsert in chunks to avoid payload limits

  for (let i = 0; i < clips.length; i += CHUNK) {
    const chunk = clips.slice(i, i + CHUNK)

    await Promise.allSettled(
      chunk.map(async clip => {
        try {
          const indexed = await indexClip(userId, categoryId, clip)
          results.success.push(indexed)
        } catch (err) {
          results.failed.push({ filename: clip.filename, error: err.message })
        }
      })
    )
  }

  return results
}

// ─── SEMANTIC SEARCH ──────────────────────────────────────────────────────────

async function searchClips(userId, visualVector, textVector, options = {}) {
  const {
    categoryId   = null,
    clipType     = null,
    count        = 5,
    visualWeight = 0.6,
    textWeight   = 0.4,
  } = options

  if (!Array.isArray(visualVector) || !Array.isArray(textVector)) {
    throw new Error('visualVector and textVector must be arrays')
  }

  const { data, error } = await supabase.rpc('match_clips', {
    p_user_id:       userId,
    p_query_vector:  `[${visualVector.join(',')}]`,
    p_text_vector:   `[${textVector.join(',')}]`,
    p_visual_weight: visualWeight,
    p_text_weight:   textWeight,
    p_match_count:   Math.min(count, 20),
    p_category_id:   categoryId,
    p_clip_type:     clipType,
  })

  if (error) throw new Error(`Clip search failed: ${error.message}`)
  return data || []
}

// ─── CLIP LIBRARY ─────────────────────────────────────────────────────────────

async function getClipLibrary(userId, categoryId, { limit = 100, offset = 0 } = {}) {
  let query = supabase
    .from('clip_index')
    .select('id, filename, filepath, clip_type, duration_ms, transcript, visual_tags, dominant_emotion, audio_energy, scene_type, thumbnail_b64, indexed_at', { count: 'exact' })
    .eq('user_id', userId)
    .not('indexed_at', 'is', null)
    .order('filename')
    .range(offset, offset + limit - 1)

  if (categoryId) query = query.eq('category_id', categoryId)

  const { data, error, count } = await query
  if (error) throw new Error(error.message)
  return { clips: data || [], total: count || 0, limit, offset }
}

// ─── STATS ────────────────────────────────────────────────────────────────────

async function getIndexStats(userId, categoryId) {
  const q = supabase
    .from('clip_index')
    .select('clip_type, duration_ms', { count: 'exact' })
    .eq('user_id', userId)
    .not('indexed_at', 'is', null)

  if (categoryId) q.eq('category_id', categoryId)

  const { data, count, error } = await q
  if (error) return { total: 0, byType: {}, totalDurationMs: 0 }

  const byType = (data || []).reduce((acc, c) => {
    acc[c.clip_type] = (acc[c.clip_type] || 0) + 1
    return acc
  }, {})

  const totalDurationMs = (data || []).reduce((s, c) => s + (c.duration_ms || 0), 0)

  return { total: count || 0, byType, totalDurationMs }
}

// ─── STALE / REMOVE ───────────────────────────────────────────────────────────

async function getStaleClips(userId) {
  const { data } = await supabase
    .from('clip_index')
    .select('id, filename, filepath')
    .eq('user_id', userId)
    .eq('needs_reindex', true)
  return data || []
}

async function markStale(userId, filepaths) {
  if (!filepaths?.length) return
  await supabase
    .from('clip_index')
    .update({ needs_reindex: true })
    .eq('user_id', userId)
    .in('filepath', filepaths)
}

async function removeClip(userId, filepath) {
  await supabase
    .from('clip_index')
    .delete()
    .eq('user_id', userId)
    .eq('filepath', filepath)
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function detectClipType(filename) {
  const lower = filename.toLowerCase()
  if (lower.startsWith('daw') || lower.includes('screen') || lower.includes('capture')) return 'daw'
  if (lower.includes('broll') || lower.includes('b-roll') || lower.includes('b_roll'))  return 'broll'
  return 'cam'
}

module.exports = { indexClip, indexClipBatch, searchClips, getClipLibrary, getIndexStats, getStaleClips, markStale, removeClip }