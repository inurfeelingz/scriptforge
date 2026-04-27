// backend/src/services/vision/visionMatcher.js
// Maps EDL beat intent tags → semantic clip search → ranked matches.
// This is the bridge between the script engine and the vision engine.

const Anthropic  = require('@anthropic-ai/sdk')
const { searchClips } = require('./clipIndexer')
const { supabase }    = require('../../utils/supabase')

const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── MATCH A SINGLE BEAT ──────────────────────────────────────────────────────

async function matchBeat(userId, categoryId, beat, queryVisualVector, queryTextVector, usedClipIds = new Set()) {
  const candidates = await searchClips(userId, queryVisualVector, queryTextVector, {
    categoryId,
    clipType: beat.clipType || null,
    count:    8,  // fetch more than needed so we can exclude already-used clips
  })

  if (!candidates.length) {
    // Explicit placeholder — never return a null clip silently
    return {
      beat,
      bestMatch: {
        id:           null,
        filename:     `[NO MATCH] ${beat.intentTag || beat.id}`,
        filepath:     null,
        clip_type:    beat.clipType || 'cam',
        isPlaceholder: true,
        combined_score: 0,
      },
      alternatives: [],
      confidence:   0,
      warning:      'No indexed clips found — placeholder inserted. Run footage indexing first.',
    }
  }

  // Exclude clips already used earlier in the same assembly pass
  const available    = candidates.filter(c => !usedClipIds.has(c.id))
  const pool         = available.length ? available : candidates  // fall back to all if everything used

  const bestMatch    = pool[0]
  const alternatives = pool.slice(1, 4)
  const confidence   = bestMatch.combined_score || 0

  return {
    beat,
    bestMatch,
    alternatives,
    confidence,
    warning: confidence < 0.35 ? 'Low confidence — review this clip manually' : null,
  }
}

// ─── MATCH FULL EDL ───────────────────────────────────────────────────────────

async function matchFullEDL(userId, categoryId, edlClipMap, beatVectors = []) {
  const beats     = parseEDLClipMap(edlClipMap)
  const results   = []
  const usedIds   = new Set()

  for (let i = 0; i < beats.length; i++) {
    const beat    = beats[i]
    const vectors = beatVectors.find(v => v.beatIndex === i)

    if (!vectors?.visualVector || !vectors?.textVector) {
      results.push({
        beat,
        bestMatch:    null,
        alternatives: [],
        confidence:   0,
        warning:      'Vectors not computed — run indexing then re-assemble',
      })
      continue
    }

    const match = await matchBeat(userId, categoryId, beat, vectors.visualVector, vectors.textVector, usedIds)
    if (match.bestMatch) usedIds.add(match.bestMatch.id)
    results.push(match)
  }

  const withMatch     = results.filter(r => r.bestMatch)
  const avgConfidence = withMatch.length
    ? withMatch.reduce((s, r) => s + r.confidence, 0) / withMatch.length
    : 0

  const flags = results
    .map((r, i) => r.warning || r.confidence < 0.5 ? {
      beatIndex: i,
      type:      r.bestMatch ? 'low_confidence' : 'no_match',
      reason:    r.warning || `Confidence: ${Math.round((r.confidence || 0) * 100)}%`,
      clipId:    r.bestMatch?.id || null,
    } : null)
    .filter(Boolean)

  return {
    matches:        results,
    totalBeats:     beats.length,
    matchedBeats:   withMatch.length,
    avgConfidence,
    flags,
  }
}

// ─── SEMANTIC SWAP ────────────────────────────────────────────────────────────

async function getSwapCandidates(userId, categoryId, currentClipId, beat, visualVector, textVector) {
  const candidates = await searchClips(userId, visualVector, textVector, {
    categoryId,
    clipType: beat?.clipType || null,
    count:    6,
  })
  return candidates.filter(c => c.id !== currentClipId).slice(0, 3)
}

// ─── NARRATIVE VALIDATION ─────────────────────────────────────────────────────

async function narrativeValidation(timeline, voScript, categoryContext) {
  if (!voScript || !timeline.length) return { narrativeScore: null, suggestions: [] }

  // Build a timeline summary for Claude
  const timelineSummary = timeline
    .filter(c => c.filename)
    .map((c, i) => `Beat ${i + 1} [${c.trackIndex === 1 ? 'DAW' : 'CAM'}]: ${c.filename} — "${c.intentTag || 'no tag'}" (confidence: ${Math.round((c.confidence || 0) * 100)}%)`)
    .join('\n')

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `Review this video timeline against the VO script and flag any narrative mismatches.

VO SCRIPT (excerpt):
${voScript.slice(0, 800)}

ASSEMBLED TIMELINE:
${timelineSummary}

Identify:
1. Any beats where the visual clip likely contradicts or distracts from the narration
2. Any long runs of the same clip type (cam or DAW) that should be broken up
3. The 2 strongest matches in the timeline
4. Up to 2 specific swap recommendations

Return JSON: { narrativeScore: 0-100, strongMoments: [beatIndex], issues: [{beatIndex, reason, suggestion}] }`,
    }],
  })

  try {
    const text = response.content[0].text.replace(/```json|```/g, '').trim()
    return JSON.parse(text)
  } catch {
    return { narrativeScore: null, suggestions: [], raw: response.content[0].text }
  }
}

// ─── EDL PARSER ──────────────────────────────────────────────────────────────

function parseEDLClipMap(edlText) {
  if (!edlText) return []
  return edlText.split('\n')
    .filter(l => l.trim().match(/^CLIP_\d+/i))
    .map(line => {
      const parts = line.split('|').map(p => p.trim())
      const track = (parts[4] || '').replace('TRACK:', '').trim()
      const note  = (parts[5] || parts[4] || '').replace('NOTE:', '').trim()
      return {
        id:                 parts[0],
        suggestedFile:      parts[1] || '',
        srcIn:              (parts[2] || '').replace('IN:',  '').trim() || '00:00:00:00',
        srcOut:             (parts[3] || '').replace('OUT:', '').trim() || '00:00:05:00',
        track:              track || 'V1',
        clipType:           track.includes('2') ? 'daw' : 'cam',
        intentTag:          note,
        durationEstimateMs: estimateDurationMs(
          (parts[2] || '').replace('IN:', '').trim(),
          (parts[3] || '').replace('OUT:','').trim()
        ),
      }
    })
}

function estimateDurationMs(inTC, outTC) {
  const parse = tc => {
    const p = (tc || '').split(':').map(Number)
    if (p.length < 3) return 0
    return ((p[0] * 3600 + p[1] * 60 + p[2]) * 1000) + (p[3] ? p[3] * 40 : 0)
  }
  const dur = parse(outTC) - parse(inTC)
  return dur > 0 ? dur : 5000
}

module.exports = { matchBeat, matchFullEDL, getSwapCandidates, narrativeValidation }
