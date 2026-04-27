// backend/src/services/continuityScorer.js
// Scores the assembled timeline for narrative continuity.
// Goes beyond per-clip confidence scores — evaluates whether the SEQUENCE
// of visuals tells a coherent story alongside the VO script.
// Flags emotional mismatches, energy inconsistencies, and logic breaks.

const Anthropic  = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')

const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── MAIN SCORER ─────────────────────────────────────────────────────────────

/**
 * Score the assembled timeline for narrative continuity.
 *
 * @param {Array}  timeline   — TimelineClip array with intentTags + clip metadata
 * @param {string} voScript   — full VO script text
 * @param {object} trackContext — { name, mood, genre, bpm }
 */
async function scoreContinuity(timeline, voScript, trackContext = {}) {
  if (!timeline?.length || !voScript) {
    return { score: null, issues: [], highlights: [], ready: false }
  }

  // Build a compact timeline summary for Claude
  const timelineSummary = buildTimelineSummary(timeline)

  // Extract the VO structure (sentences mapped to approximate timeline positions)
  const voLines = extractVoLines(voScript)

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are a documentary film editor reviewing an assembled cut for narrative continuity.

TRACK: "${trackContext.name}" — ${trackContext.mood || ''} ${trackContext.genre || ''}

VO SCRIPT (key lines):
${voLines.slice(0, 12).map((l, i) => `${i + 1}. "${l}"`).join('\n')}

ASSEMBLED VISUAL SEQUENCE:
${timelineSummary}

Evaluate this assembly for narrative continuity. Score 0-100 where:
- 90-100: Visuals perfectly reinforce every spoken moment
- 70-89: Good flow with minor mismatches
- 50-69: Noticeable disconnects that distract viewers
- Below 50: Visual narrative contradicts the spoken narrative

Return JSON:
{
  "score": number,
  "overallVerdict": "one sentence summary",
  "issues": [
    {
      "clipIndex": number,
      "severity": "high|medium|low",
      "description": "specific problem",
      "suggestion": "specific fix — name the clip type and the VO line it conflicts with"
    }
  ],
  "highlights": [
    {
      "clipIndex": number,
      "reason": "why this works especially well"
    }
  ],
  "energyArc": "description of the emotional energy progression across the edit",
  "fixPriority": [clipIndex]
}`
    }]
  })

  try {
    const text   = response.content[0].text.replace(/```json|```/g, '').trim()
    const result = JSON.parse(text)
    return { ...result, ready: true }
  } catch {
    return {
      score:          null,
      overallVerdict: response.content[0].text.slice(0, 200),
      issues:         [],
      highlights:     [],
      ready:          false,
    }
  }
}

// ─── ENERGY ARC ANALYSIS ──────────────────────────────────────────────────────

/**
 * Analyse the energy arc of the timeline — is the pacing varied enough?
 * Detects: long cam runs, long DAW runs, repetitive patterns.
 */
function analyseEnergyArc(timeline) {
  if (!timeline?.length) return { score: 100, issues: [] }

  const issues = []
  let   camRun = 0
  let   dawRun = 0

  for (let i = 0; i < timeline.length; i++) {
    const clip = timeline[i]
    const isDAW = clip.trackIndex === 1

    if (isDAW) { dawRun++; camRun = 0 }
    else        { camRun++; dawRun = 0 }

    // Flag runs of 4+ consecutive same-type clips
    if (camRun >= 4) {
      issues.push({
        clipIndex: i,
        severity:  'medium',
        type:      'monotony',
        description: `${camRun} consecutive camera clips — consider inserting a DAW shot`,
      })
    }
    if (dawRun >= 4) {
      issues.push({
        clipIndex: i,
        severity:  'medium',
        type:      'monotony',
        description: `${dawRun} consecutive DAW screen clips — consider cutting to camera for a moment`,
      })
    }
  }

  // Check for too-uniform clip durations (all clips same length = feels mechanical)
  const durations = timeline.map(c => c.durationMs || 0).filter(d => d > 0)
  if (durations.length > 3) {
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length
    const variance = durations.reduce((s, d) => s + Math.pow(d - avg, 2), 0) / durations.length
    const stdDev = Math.sqrt(variance)
    if (stdDev < 500) {
      issues.push({
        clipIndex: -1,
        severity:  'low',
        type:      'pacing',
        description: 'Clip durations are very uniform — vary lengths for a more dynamic feel',
      })
    }
  }

  const score = Math.max(0, 100 - issues.length * 15)
  return { score, issues }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildTimelineSummary(timeline) {
  return timeline
    .filter(c => c.filename || c.isPlaceholder)
    .map((c, i) => {
      const type     = c.trackIndex === 1 ? 'DAW' : 'CAM'
      const duration = c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : '?s'
      const tags     = c.visualTags?.slice(0, 3).join(', ') || ''
      const intent   = c.intentTag || ''
      const conf     = c.confidence ? `${Math.round(c.confidence * 100)}%` : '?'
      return `${i + 1}. [${type} ${duration}] ${c.filename || 'PLACEHOLDER'} | intent: "${intent}" | tags: ${tags} | match: ${conf}`
    })
    .join('\n')
}

function extractVoLines(voScript) {
  return voScript
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.match(/^\[(?:CAM|DAW|BROLL)/i) && l.length > 10)
    .slice(0, 20)
}

module.exports = {
  scoreContinuity,
  analyseEnergyArc,
}
