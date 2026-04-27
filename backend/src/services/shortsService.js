// backend/src/services/shortsService.js
// Generates standalone 45-60 second Shorts/Reels scripts from long-form episodes.
// Pulls from the episode's existing shortform_moments for source material,
// then expands each into a full vertical video script with its own hook, pace, and CTA.

const Anthropic    = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')
const { assembleContext } = require('./contextAssembler')

const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Generate Shorts from episode ──────────────────────────────────────────────

async function generateShortsFromEpisode(userId, categoryId, episodeId) {
  // Fetch episode
  const { data: episode, error } = await supabase
    .from('episodes')
    .select('episode_number, track_name, track_mood, track_genre, vo_script, short_form_moments, metadata_block')
    .eq('id', episodeId)
    .eq('user_id', userId)
    .single()

  if (error || !episode) throw new Error('Episode not found')

  const context = await assembleContext(userId, categoryId, { mode: 'generate' })

  // Parse existing shortform moments if available
  const existingMoments = parseShortformMoments(episode.short_form_moments || '')

  const prompt = `Generate exactly 3 standalone YouTube Shorts / TikTok Reels scripts from this episode.

EPISODE: Ep ${episode.episode_number} — "${episode.track_name}"
MOOD: ${episode.track_mood || 'not specified'}
GENRE: ${episode.track_genre || 'not specified'}
${existingMoments.length ? `FLAGGED MOMENTS FROM EPISODE:\n${existingMoments.map((m, i) => `${i+1}. ${m}`).join('\n')}` : `VO SCRIPT EXCERPT:\n${(episode.vo_script || '').slice(0, 800)}`}

REQUIREMENTS FOR EACH SHORT:
- 45-60 seconds when spoken at normal pace (~100-130 words)
- Completely self-contained — a new viewer with no context must understand it immediately
- Different hook strategy from the others — no two should open the same way
- Platform-optimised CTA — specific to Shorts/Reels (not "subscribe", but "follow for the next one" / "watch the full episode" / "this is pt 1")
- Faster pace than the long-form — punchy sentences, no long setup
- Uses the same creator voice — not generic, not polished-to-death

Return ONLY valid JSON (no preamble, no markdown):
{
  "shorts": [
    {
      "id": "short_1",
      "title": "short working title",
      "platform": "youtube_shorts",
      "hookStrategy": "name of hook strategy used",
      "hook": "opening 2 sentences",
      "script": "full 45-60 second script",
      "wordCount": 115,
      "cta": "the specific CTA at the end",
      "sourceTimecode": "approx timecode this moment is from in the long-form e.g. 3:45",
      "thumbnailConcept": "one sentence visual concept for the thumbnail"
    }
  ]
}`

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 3000,
    system:     context,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text  = response.content[0]?.text || ''
  let parsed
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    throw new Error('Failed to parse shorts response — try again')
  }

  // Persist to episode row
  await supabase
    .from('episodes')
    .update({
      shorts_scripts: parsed.shorts,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', episodeId)
    .eq('user_id', userId)

  return {
    shorts:        parsed.shorts || [],
    episodeNumber: episode.episode_number,
    trackName:     episode.track_name,
  }
}

// ── Generate thumbnail concepts ────────────────────────────────────────────────

async function generateThumbnailConcepts(userId, categoryId, episodeId) {
  const { data: episode, error } = await supabase
    .from('episodes')
    .select('episode_number, track_name, track_mood, track_genre, vo_script, metadata_block')
    .eq('id', episodeId)
    .eq('user_id', userId)
    .single()

  if (error || !episode) throw new Error('Episode not found')

  const context = await assembleContext(userId, categoryId, { mode: 'generate' })

  const ytTitle   = episode.metadata_block?.YOUTUBE_TITLE || episode.track_name
  const scriptHook = (episode.vo_script || '').split('\n').slice(0, 6).join(' ').slice(0, 300)

  const prompt = `Generate 3 thumbnail concepts for this YouTube episode.

EPISODE: Ep ${episode.episode_number} — "${episode.track_name}"
YOUTUBE TITLE: "${ytTitle}"
MOOD: ${episode.track_mood || ''}
GENRE: ${episode.track_genre || ''}
HOOK (first ~30s of script): "${scriptHook}"

Each concept must use a completely different visual strategy.
Be specific and actionable — this is a brief the creator will take into Canva or Photoshop.
Think about what will get 5% CTR, not what looks pretty.

Return ONLY valid JSON:
{
  "concepts": [
    {
      "id": "concept_1",
      "strategy": "strategy name e.g. face-reaction, text-dominant, curiosity-gap",
      "label": "2-3 word label",
      "visualDescription": "exactly what to show — subject, framing, background colour",
      "facialExpression": "specific expression cue e.g. 'raised eyebrow, slight smirk, looking slightly off-camera'",
      "overlayText": "the exact text overlay — max 4 words, high contrast",
      "colourDirection": "dominant colour palette e.g. 'dark navy + gold accent' or 'high contrast black/white'",
      "whyItWorks": "one sentence on the psychological hook",
      "abTestVariant": {
        "overlayText": "alternative text for A/B test",
        "change": "what's different — e.g. question vs statement"
      }
    }
  ]
}`

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 1500,
    system:     context,
    messages:   [{ role: 'user', content: prompt }],
  })

  const text = response.content[0]?.text || ''
  let parsed
  try {
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    throw new Error('Failed to parse thumbnail concepts — try again')
  }

  // Persist to episode row
  await supabase
    .from('episodes')
    .update({
      thumbnail_concepts: parsed.concepts,
      updated_at:         new Date().toISOString(),
    })
    .eq('id', episodeId)
    .eq('user_id', userId)

  return { concepts: parsed.concepts || [], episodeNumber: episode.episode_number }
}

// ── Helper ────────────────────────────────────────────────────────────────────

function parseShortformMoments(text) {
  if (!text) return []
  return text.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('MOMENT_') || l.match(/^\d+\./))
    .map(l => l.replace(/^MOMENT_\d+\s*\|?\s*/, '').replace(/^\d+\.\s*/, ''))
    .filter(Boolean)
    .slice(0, 5)
}

module.exports = { generateShortsFromEpisode, generateThumbnailConcepts }
