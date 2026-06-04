// backend/src/services/narrative/scriptBuilder.js
// Pass 1.5: Takes the narrative arc + raw transcript + KB plan and writes
// an actual episode script — real sentences in story order, each tagged
// to a section. This is what the creator approves before the EDL is built.
// No timestamps at this stage — that happens in transcriptAligner.js.

const Anthropic = require('@anthropic-ai/sdk')
const ai = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Parse transcript into lines with ms precision ────────────────────────────
function parseTranscriptLines(transcript) {
  if (!transcript) return []
  const lines = []
  for (const raw of transcript.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // Millisecond format: [0:02.360]
    let m = line.match(/^\[(\d+):(\d+\.\d+)\]\s*(.*)/)
    if (m) {
      const ms = parseInt(m[1]) * 60000 + Math.round(parseFloat(m[2]) * 1000)
      lines.push({ ms, text: m[3].trim() })
      continue
    }
    // Legacy: [1:22]
    m = line.match(/^\[(\d+):(\d+)\]\s*(.*)/)
    if (m) {
      lines.push({ ms: parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000, text: m[3].trim() })
    }
  }
  return lines
}

// ── Build a focused transcript excerpt for each narrative section ─────────────
// Rather than dumping the whole transcript, pull the lines around each
// key moment so Claude is writing from real content, not imagination.
function buildSectionExcerpts(transcriptLines, narrativeArc, keyMoments) {
  // Parse key moments to get their ms values
  const momentMap = {}
  for (const km of (keyMoments || [])) {
    // Format: "[M:SS.mmm] text" or "[M:SS] [type] summary"
    const m = km.match(/^\[(\d+):(\d+\.?\d*)\]/)
    if (m) {
      const ms = parseInt(m[1]) * 60000 + Math.round(parseFloat(m[2]) * 1000)
      momentMap[ms] = km
    }
  }
  const momentMs = Object.keys(momentMap).map(Number).sort((a, b) => a - b)

  const sections = {}
  const arc = narrativeArc || {}

  // For each section in the arc, get the relevant transcript lines
  for (const [sectionName, sectionData] of Object.entries(arc)) {
    const momentIndices = [
      ...(sectionData.momentIndices || []),
      sectionData.momentIndex !== undefined ? sectionData.momentIndex : null,
    ].filter(i => i !== null)

    // Get lines around each referenced moment
    const sectionLines = []
    for (const idx of momentIndices) {
      const targetMs = momentMs[idx]
      if (!targetMs) continue
      const nearby = transcriptLines.filter(l => Math.abs(l.ms - targetMs) <= 20000)
      sectionLines.push(...nearby)
    }

    // If no moment indices, use time-based estimate from duration
    if (!sectionLines.length) {
      const totalMs = transcriptLines[transcriptLines.length - 1]?.ms || 0
      const sectionDurations = {
        coldOpen: 0,
        setup: 0.05,
        incitingIncident: 0.15,
        struggle: 0.25,
        breakthrough: 0.65,
        resolution: 0.80,
        outro: 0.95,
      }
      const startFrac = sectionDurations[sectionName] || 0
      const centerMs = totalMs * startFrac
      const nearby = transcriptLines.filter(l => Math.abs(l.ms - centerMs) <= 30000)
      sectionLines.push(...nearby)
    }

    // Deduplicate and sort
    const seen = new Set()
    const unique = sectionLines.filter(l => {
      if (seen.has(l.ms)) return false
      seen.add(l.ms)
      return true
    }).sort((a, b) => a.ms - b.ms)

    const formatted = unique.slice(0, 20).map(l => {
      const min = Math.floor(l.ms / 60000)
      const sec = ((l.ms % 60000) / 1000).toFixed(1)
      return `[${min}:${sec}] ${l.text}`
    }).join('\n')

    sections[sectionName] = {
      purpose:   sectionData.purpose || '',
      duration:  sectionData.durationSec || 30,
      voLine:    sectionData.voLine || '',
      excerpt:   formatted,
    }
  }

  return sections
}

// ── Main script builder ───────────────────────────────────────────────────────
async function buildEpisodeScript(options) {
  const {
    narrativePlan,
    voiceLines,
    transcript,
    keyMoments,
    episodeContext,
    categoryName,
    targetMinutes,
  } = options

  const transcriptLines = parseTranscriptLines(transcript)
  const sectionExcerpts = buildSectionExcerpts(
    transcriptLines,
    narrativePlan?.narrativeArc,
    keyMoments
  )

  // Build the prompt
  const sectionsText = Object.entries(sectionExcerpts).map(([name, s]) => `
=== ${name.toUpperCase()} (${s.duration}s) ===
Purpose: ${s.purpose}
Suggested VO: "${s.voLine}"

TRANSCRIPT LINES FROM THIS SECTION:
${s.excerpt || '(no specific moments mapped — use your judgment)'}
`).join('\n')

  const voLinesText = (voiceLines?.voLines || [])
    .map(v => `${v.section}: "${v.line}"`)
    .join('\n')

  const systemPrompt = `You are a documentary episode script writer for a YouTube creator.

Your job is to write an EPISODE SCRIPT using the real words spoken in the transcript.
This is NOT a summary. Every dialogue line must come from what was actually said.

THE SCRIPT FORMAT:
Return a JSON array of script lines. Each line is one of:
- A DIALOGUE line: something the creator actually said (use their real words from the transcript)
- A VOICEOVER line: a written VO line to be recorded separately (clearly marked)
- A SECTION_BREAK: marks the transition between narrative sections

Each item:
{
  "type": "dialogue" | "voiceover" | "section_break",
  "section": "coldOpen" | "setup" | "incitingIncident" | "struggle" | "breakthrough" | "resolution" | "outro",
  "text": "the actual words",
  "hintMs": approximate_milliseconds_into_session (for dialogue lines — helps the aligner find it),
  "source": "screen" | "camera" (which clip this moment is from),
  "note": "optional editor note about why this line is included"
}

RULES:
- COLD OPEN: Start with the most dramatic/exciting moment. This is NOT minute 0. It's the peak moment.
- After cold open, REWIND to the beginning with a VO bridge like "But let me show you how I got here"
- DIALOGUE lines use the creator's EXACT words — copy them from the transcript
- VOICEOVER lines are newly written, in the creator's voice, short and punchy
- Total runtime must be close to ${targetMinutes} minutes — be ruthless about what to cut
- Each dialogue line represents roughly 8 seconds of footage
- Aim for ${Math.round(targetMinutes * 60 / 8)} dialogue lines total
- The outro is MAX 2-3 lines — no padding, no fake CTAs
- hintMs should be your best estimate of when this moment occurs in the session`

  const userPrompt = `Creator: "${categoryName}"
Episode: "${narrativePlan?.episodeTitle || 'Untitled'}"
Target: ${targetMinutes} minutes

NARRATIVE ARC:
${narrativePlan ? JSON.stringify(narrativePlan.narrativeArc, null, 2) : 'Not available'}

VOICEOVER LINES ALREADY AGREED:
${voLinesText || 'None agreed yet'}

EPISODE CONTEXT FROM KB:
${episodeContext || 'None'}

TRANSCRIPT BY SECTION:
${sectionsText}

Write the complete episode script as a JSON array. Use real words from the transcript for dialogue lines. Make it feel like a documentary — chaotic but purposeful. Return ONLY the JSON array.`

  const response = await ai.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
    max_tokens: 6000,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const raw = (response.content[0]?.text || '[]').replace(/```json|```/g, '').trim()

  let scriptLines = []
  try {
    scriptLines = JSON.parse(raw)
  } catch (e) {
    // Try to extract array if wrapped
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) {
      try { scriptLines = JSON.parse(match[0]) } catch {}
    }
    if (!scriptLines.length) throw new Error('scriptBuilder returned invalid JSON: ' + e.message)
  }

  // Validate and clean
  scriptLines = scriptLines
    .filter(l => l && l.type && l.text)
    .map(l => ({
      type:    l.type,
      section: l.section || 'setup',
      text:    l.text,
      hintMs:  typeof l.hintMs === 'number' ? l.hintMs : null,
      source:  l.source || 'camera',
      isVO:    l.type === 'voiceover',
      note:    l.note || null,
    }))

  return {
    episodeTitle: narrativePlan?.episodeTitle || 'Episode',
    targetMinutes,
    scriptLines,
    stats: {
      total:       scriptLines.length,
      dialogue:    scriptLines.filter(l => l.type === 'dialogue').length,
      voiceover:   scriptLines.filter(l => l.type === 'voiceover').length,
      sectionBreaks: scriptLines.filter(l => l.type === 'section_break').length,
    },
  }
}

module.exports = { buildEpisodeScript, parseTranscriptLines }