// backend/src/services/seriesBible.js
// Generates a living "series bible" — a structured document that summarises
// the creator's show: recurring themes, voice patterns, narrative threads,
// best-performing structures, and a "previously on" summary.
//
// Auto-updates when a new episode is marked published.
// Cached on the category row — regenerated on demand or when stale (>7 days).

const Anthropic    = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')

const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const STALE_DAYS = 7

// ── Main generator ────────────────────────────────────────────────────────────

async function generateSeriesBible(userId, categoryId, force = false) {
  // Check for a cached, fresh bible first
  const { data: category } = await supabase
    .from('categories')
    .select('name, niche, voice_profile, series_bible, series_bible_at')
    .eq('id', categoryId)
    .eq('user_id', userId)
    .single()

  if (!category) throw new Error('Category not found')

  const bibleAge = category.series_bible_at
    ? (Date.now() - new Date(category.series_bible_at).getTime()) / 86400000
    : Infinity

  if (!force && category.series_bible && bibleAge < STALE_DAYS) {
    return { ...category.series_bible, fromCache: true, ageHours: Math.round(bibleAge * 24) }
  }

  // Fetch all published + ready episodes
  const { data: episodes } = await supabase
    .from('episodes')
    .select(`
      episode_number, track_name, track_mood, track_genre,
      vo_script, metadata_block, short_form_moments,
      yt_retention_score, published_at, status,
      generation_decisions, episode_concept
    `)
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .in('status', ['published', 'ready', 'recorded', 'edited'])
    .order('episode_number', { ascending: true })

  const eps = episodes || []

  if (eps.length === 0) {
    return {
      available: false,
      reason:    'No episodes yet — generate your first episode to start building the series bible',
    }
  }

  // Fetch series memory for callbacks
  const { data: memory } = await supabase
    .from('series_memory')
    .select('episode_number, summary, callback_seeds, themes')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: true })

  // Build prompt context
  const episodeSummaries = eps.map(ep => {
    const mem = (memory || []).find(m => m.episode_number === ep.episode_number)
    return [
      `Ep ${ep.episode_number}: "${ep.track_name}"`,
      ep.track_mood    ? `  Mood: ${ep.track_mood}`    : null,
      ep.track_genre   ? `  Genre: ${ep.track_genre}`  : null,
      ep.yt_retention_score ? `  Retention: ${ep.yt_retention_score}%` : null,
      ep.published_at  ? `  Published: ${new Date(ep.published_at).toLocaleDateString()}` : `  Status: ${ep.status}`,
      ep.episode_concept ? `  Concept: ${ep.episode_concept.slice(0, 120)}` : null,
      mem?.summary     ? `  Summary: ${mem.summary.slice(0, 150)}` : null,
      mem?.themes?.length ? `  Themes: ${mem.themes.join(', ')}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const voiceProfile = category.voice_profile
  const voiceSummary = voiceProfile ? [
    voiceProfile.voiceCharacteristics?.rhythmNote,
    voiceProfile.structuralPatterns?.hookStyle,
    voiceProfile.languageFingerprint?.humourStyle,
    voiceProfile.languageFingerprint?.storytellingStyle,
  ].filter(Boolean).join('; ') : 'not yet captured'

  const topPerformers = eps
    .filter(e => e.yt_retention_score)
    .sort((a, b) => b.yt_retention_score - a.yt_retention_score)
    .slice(0, 3)
    .map(e => `Ep ${e.episode_number} "${e.track_name}" (${e.yt_retention_score}%)`)
    .join(', ')

  const prompt = `You are writing the series bible for a solo music documentary creator's YouTube show.

SHOW: ${category.name}
NICHE: ${category.niche}
TOTAL EPISODES: ${eps.length}
CREATOR VOICE: ${voiceSummary}
TOP PERFORMERS: ${topPerformers || 'none yet'}

EPISODES:
${episodeSummaries}

Write a comprehensive series bible as a living document. Be specific — reference actual episode titles and numbers. This document should be immediately useful to the creator and to any future collaborator.

Return ONLY valid JSON matching this exact structure (no preamble, no markdown):
{
  "showPremise": "2-3 sentence show premise — what this series is fundamentally about",
  "creatorVoice": "3-4 sentences describing the creator's distinct voice, pace, and style as it comes through the episodes",
  "recurringThemes": ["theme 1", "theme 2", "theme 3", "theme 4"],
  "narrativeThreads": [
    { "thread": "thread name", "description": "what this thread is", "episodes": [1, 3, 7] }
  ],
  "bestPerformingStructures": [
    { "structure": "structure name", "description": "what it does", "episodeExample": "Ep N: title" }
  ],
  "callbackOpportunities": [
    { "from": "Ep N: detail", "suggestion": "How a future episode could reference this" }
  ],
  "upcomingDirections": ["direction 1", "direction 2", "direction 3"],
  "previouslyOn": "A 3-4 sentence 'previously on' summary covering the arc so far — written as if read aloud at the start of a new episode",
  "collaboratorBrief": "A 2-3 sentence brief for a guest, editor, or collaborator who needs to understand the show quickly",
  "episodeCount": ${eps.length},
  "publishedCount": ${eps.filter(e => e.status === 'published').length}
}`

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages:   [{ role: 'user', content: prompt }],
  })

  let bible
  try {
    const text = response.content[0]?.text || ''
    bible      = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    throw new Error('Failed to parse series bible response — try again')
  }

  bible.generatedAt = new Date().toISOString()
  bible.available   = true
  bible.fromCache   = false

  // Cache on the category row
  await supabase
    .from('categories')
    .update({
      series_bible:    bible,
      series_bible_at: new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
    .eq('id', categoryId)
    .eq('user_id', userId)

  return bible
}

module.exports = { generateSeriesBible }
