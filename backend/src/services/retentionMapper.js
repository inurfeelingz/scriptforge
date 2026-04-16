// backend/src/services/retentionMapper.js
// Parses YouTube Analytics retention curves and extracts the structural patterns
// that proved themselves with your actual audience.
// These patterns directly inform EDL assembly timing — not guesses, forensic evidence.

const Anthropic  = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')

const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── PARSE RETENTION CURVE ────────────────────────────────────────────────────

/**
 * Parse a YouTube Analytics retention curve CSV or JSON into a normalised map.
 * YouTube exports retention as: time_seconds, retention_percentage
 *
 * Returns: { "0": 100, "15": 94, "30": 88, ... } — seconds → retention %
 */
function parseRetentionCurve(rawData) {
  if (typeof rawData === 'object' && !Array.isArray(rawData)) {
    return rawData // already parsed map
  }

  const curve = {}

  // Handle CSV format: "0:00,100\n0:15,94\n..."
  if (typeof rawData === 'string') {
    const lines = rawData.trim().split('\n').slice(1) // skip header
    for (const line of lines) {
      const parts = line.split(',')
      if (parts.length < 2) continue
      const timeStr = parts[0].trim()
      const pct     = parseFloat(parts[1].trim())
      if (isNaN(pct)) continue

      // Convert MM:SS to seconds
      const timeParts = timeStr.split(':').map(Number)
      const seconds = timeParts.length === 2
        ? timeParts[0] * 60 + timeParts[1]
        : timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2]

      curve[seconds] = pct
    }
    return curve
  }

  // Handle array format: [{ time: 15, percentage: 94 }, ...]
  if (Array.isArray(rawData)) {
    for (const point of rawData) {
      const sec = point.time ?? point.seconds ?? point.t
      const pct = point.percentage ?? point.retention ?? point.p
      if (sec !== undefined && pct !== undefined) {
        curve[sec] = parseFloat(pct)
      }
    }
    return curve
  }

  return curve
}

// ─── EXTRACT STRUCTURAL PATTERNS ──────────────────────────────────────────────

/**
 * Analyse a retention curve and extract structural moments:
 * - Recovery spikes (viewer re-engagement after a dip)
 * - Stable plateaus (what was happening during high retention)
 * - Drop points (where viewers leave)
 * - Critical threshold moments (viewer decision points)
 */
function extractStructuralPatterns(curve) {
  const times      = Object.keys(curve).map(Number).sort((a, b) => a - b)
  const drops      = []
  const recoveries = []
  const peaks      = []
  const stable     = []

  for (let i = 1; i < times.length; i++) {
    const t    = times[i]
    const prev = times[i - 1]
    const curr = curve[t]
    const last = curve[prev]
    const delta = curr - last

    // Drop: >3% loss in ≤15 seconds
    if (delta < -3 && (t - prev) <= 15) {
      drops.push({ timeSeconds: t, retentionPct: curr, delta, severity: Math.abs(delta) })
    }

    // Recovery: >2% gain after a drop
    if (delta > 2 && i > 1) {
      const prevDelta = curve[times[i - 1]] - curve[times[i - 2]]
      if (prevDelta < 0) {
        recoveries.push({ timeSeconds: t, retentionPct: curr, delta, strength: delta })
      }
    }

    // Peak: local maximum with >70% retention
    if (i > 1 && i < times.length - 1 && curr > 70) {
      if (curr > curve[prev] && curr > curve[times[i + 1]]) {
        peaks.push({ timeSeconds: t, retentionPct: curr })
      }
    }

    // Stable: 3+ consecutive points within 2% of each other
    if (i >= 2) {
      const prev2 = curve[times[i - 2]]
      if (Math.abs(curr - last) < 2 && Math.abs(last - prev2) < 2 && curr > 50) {
        if (!stable.length || t - stable[stable.length - 1].endSeconds > 30) {
          stable.push({ startSeconds: times[i - 2], endSeconds: t, retentionPct: curr })
        } else {
          stable[stable.length - 1].endSeconds = t
        }
      }
    }
  }

  // Critical viewer decision windows (30s, 60s, 2min, 5min — industry-known)
  const decisions = [30, 60, 120, 300].map(t => ({
    timeSeconds: t,
    retentionPct: curve[findNearest(times, t)] || null,
    isStrong: (curve[findNearest(times, t)] || 0) > 60,
  }))

  return { drops, recoveries, peaks, stable, decisions }
}

function findNearest(sortedArr, target) {
  return sortedArr.reduce((prev, curr) =>
    Math.abs(curr - target) < Math.abs(prev - target) ? curr : prev
  )
}

// ─── BUILD RETENTION TEMPLATE ─────────────────────────────────────────────────

/**
 * Analyse multiple top-performing episodes to build a retention template.
 * The template tells the EDL assembler: "at second 45, use a cam→DAW cut
 * because that pattern recovered viewers in 3 of your best episodes."
 */
async function buildRetentionTemplate(userId, categoryId) {
  console.log('[retentionMapper] Building retention template...')

  // Get top-performing episodes with retention data
  const { data: episodes } = await supabase
    .from('episodes')
    .select('id, episode_number, track_name, retention_curve_map, yt_retention_score, generation_decisions')
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .not('retention_curve_map', 'is', null)
    .order('yt_retention_score', { ascending: false })
    .limit(10)

  if (!episodes?.length) {
    return { available: false, reason: 'No episodes with retention curve data yet' }
  }

  // Extract patterns from each episode
  const allPatterns = episodes.map(ep => ({
    episodeNumber:     ep.episode_number,
    retentionScore:    ep.yt_retention_score,
    patterns:          extractStructuralPatterns(ep.retention_curve_map || {}),
    decisions:         ep.generation_decisions || {},
  }))

  // Find consensus patterns — moments that appear across multiple top episodes
  const consensusDropTimes    = findConsensusTimings(allPatterns.flatMap(p => p.patterns.drops.map(d => d.timeSeconds)))
  const consensusRecoveries   = findConsensusTimings(allPatterns.flatMap(p => p.patterns.recoveries.map(r => r.timeSeconds)))
  const consensusPeaks        = findConsensusTimings(allPatterns.flatMap(p => p.patterns.peaks.map(pk => pk.timeSeconds)))

  // Ask Claude to interpret what these patterns mean structurally
  const patternSummary = allPatterns.slice(0, 5).map(p =>
    `Ep ${p.episodeNumber} (score: ${p.retentionScore}): drops at ${p.patterns.drops.map(d => d.timeSeconds + 's').join(', ')}, ` +
    `recoveries at ${p.patterns.recoveries.map(r => r.timeSeconds + 's').join(', ')}, ` +
    `peaks at ${p.patterns.peaks.map(pk => pk.timeSeconds + 's').join(', ')}`
  ).join('\n')

  const response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `Analyse these YouTube retention patterns from a music documentary creator's top episodes.
${patternSummary}

Identify:
1. The structural timing that consistently keeps viewers watching (what happens at the consensus recovery points)
2. The danger zones where this creator consistently loses viewers (and what to avoid there)
3. 3-5 specific EDL timing recommendations: "at ~Xs, cut from X to Y to mirror what worked in episodes N and M"

Be specific and actionable. Reference the actual second timestamps.
Return JSON: { recommendations: [{timeSeconds, action, reason, episodeEvidence}], dangerZones: [{timeSeconds, warning}], overallPattern: string }`
    }]
  })

  let analysis
  try {
    analysis = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim())
  } catch {
    analysis = { recommendations: [], dangerZones: [], overallPattern: response.content[0].text }
  }

  const template = {
    generatedAt:        new Date().toISOString(),
    episodesAnalysed:   episodes.length,
    consensusDropTimes,
    consensusRecoveries,
    consensusPeaks,
    analysis,
    available:          true,
  }

  // Cache on the category for fast access
  // Cache template on the category — avoids Claude call on every RetentionHeatmap mount
  await supabase
    .from('categories')
    .update({
      retention_template:    template,
      retention_template_at: new Date().toISOString(),
      updated_at:            new Date().toISOString(),
    })
    .eq('id', categoryId)
    .eq('user_id', userId)

  console.log(`[retentionMapper] Template built and cached from ${episodes.length} episodes`)
  return template
}

function findConsensusTimings(timings, windowSeconds = 15) {
  if (!timings.length) return []
  const sorted  = [...timings].sort((a, b) => a - b)
  const clusters = []
  let cluster    = [sorted[0]]

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - cluster[cluster.length - 1] <= windowSeconds) {
      cluster.push(sorted[i])
    } else {
      if (cluster.length >= 2) {
        clusters.push({
          timeSeconds: Math.round(cluster.reduce((s, t) => s + t, 0) / cluster.length),
          count:       cluster.length,
        })
      }
      cluster = [sorted[i]]
    }
  }
  if (cluster.length >= 2) {
    clusters.push({
      timeSeconds: Math.round(cluster.reduce((s, t) => s + t, 0) / cluster.length),
      count:       cluster.length,
    })
  }
  return clusters.sort((a, b) => b.count - a.count)
}

// ─── APPLY TEMPLATE TO EDL ────────────────────────────────────────────────────

/**
 * Apply the retention template to an EDL assembly.
 * Adjusts clip timing so cuts land at proven recovery points
 * and avoids known danger zones.
 *
 * @param {Array}  timeline      — array of TimelineClip objects
 * @param {object} template      — from buildRetentionTemplate()
 * @param {number} episodeDurMs  — total episode duration in ms
 */
function applyRetentionTemplate(timeline, template, episodeDurMs = 600000) {
  if (!template?.available || !template.analysis?.recommendations?.length) {
    return { timeline, adjustments: [] }
  }

  const adjustments = []
  const recommendations = template.analysis.recommendations || []
  const dangerZones     = template.analysis.dangerZones || []

  // Build a set of target cut times (seconds) from recommendations
  const targetCutSeconds = new Set(recommendations.map(r => r.timeSeconds))
  const dangerSeconds    = new Set(dangerZones.map(d => d.timeSeconds))

  // For each clip in the timeline, check if it starts near a danger zone
  // and nudge it toward the nearest recommendation
  for (let i = 1; i < timeline.length; i++) {
    const clip = timeline[i]
    const clipStartMs = tcToMs(clip.recIn)
    const clipStartS  = Math.round(clipStartMs / 1000)

    // Check if this cut lands in a danger zone (±10 seconds)
    const nearDanger = [...dangerSeconds].find(d => Math.abs(d - clipStartS) <= 10)

    if (nearDanger) {
      // Find nearest recommendation
      const nearest = [...targetCutSeconds].reduce((best, t) =>
        Math.abs(t - clipStartS) < Math.abs(best - clipStartS) ? t : best
      , [...targetCutSeconds][0])

      if (nearest && Math.abs(nearest - clipStartS) <= 30) {
        const shiftMs = (nearest - clipStartS) * 1000
        // Note the adjustment (actual TC shifting is handled by timelineBuilder rebuild)
        adjustments.push({
          clipIndex:    i,
          originalSec:  clipStartS,
          adjustedSec:  nearest,
          shiftMs,
          reason:       `Moved cut from danger zone ${nearDanger}s → proven recovery point ${nearest}s`,
        })
      }
    }
  }

  return { timeline, adjustments, template }
}

function tcToMs(tc) {
  if (!tc) return 0
  const parts = tc.split(':').map(Number)
  return ((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000) + (parts[3] ? parts[3] * 40 : 0)
}

// ─── SAVE CURVE TO EPISODE ────────────────────────────────────────────────────

async function saveRetentionCurve(userId, episodeId, rawCurveData) {
  const curve    = parseRetentionCurve(rawCurveData)
  const patterns = extractStructuralPatterns(curve)

  const { data, error } = await supabase
    .from('episodes')
    .update({
      retention_curve_map: curve,
      retention_patterns:  patterns,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', episodeId)
    .eq('user_id', userId)
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  console.log(`[retentionMapper] Retention curve saved for episode ${episodeId}`)
  return { curve, patterns }
}

module.exports = {
  parseRetentionCurve,
  extractStructuralPatterns,
  buildRetentionTemplate,
  applyRetentionTemplate,
  saveRetentionCurve,
}
