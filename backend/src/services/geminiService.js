// backend/src/services/geminiService.js
// Gemini 2.0 Flash as the trend intelligence and script scoring layer.
//
// Why Gemini here vs Claude:
//   - 1M token context = analyse 50+ video transcripts at once
//   - URL grounding = reads live YouTube pages without API quota
//   - Cheaper per token for bulk analysis
//   - Claude stays for all creative + conversational work
//
// Required env var (Railway):
//   GEMINI_API_KEY — from Google AI Studio (aistudio.google.com)
//
// Functions:
//   analyseTrends(niche, videos)     — replaces Claude in trendingService
//   scoreScript(voScript, topEps)    — rates a VO script against top performers
//   generateScriptSuggestions(...)   — targeted improvements for a script

const { GoogleGenerativeAI } = require('@google/generative-ai')

function getClient() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in Railway env vars')
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
}

// ── TREND ANALYSIS ────────────────────────────────────────────────────────────
// Replaces Claude in trendingService.synthesiseTrending()
// Same input/output shape so it's a drop-in replacement

async function analyseTrends(niche, allVideos, withTranscripts) {
  const genAI = getClient()
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const titlesText = allVideos.slice(0, 30)
    .map((v, i) => `${i + 1}. "${v.title}" — ${v.channelTitle} (${v.publishedAt?.slice(0, 10) || 'recent'})`)
    .join('\n')

  const transcriptSample = withTranscripts.slice(0, 8)
    .map(v => `"${v.title}":\n${v.transcript?.slice(0, 600) || '(no transcript)'}`)
    .join('\n\n---\n\n')

  const prompt = `You are a YouTube content strategist. Analyse trending content in the "${niche}" niche.

TOP VIDEOS (past 2 weeks):
${titlesText}

TRANSCRIPT SAMPLES (what top creators are actually saying):
${transcriptSample}

Analyse deeply. What patterns are working RIGHT NOW? What's the emotional language? What structures are creators using?

Return this exact JSON:
{
  "themes": ["3-5 dominant themes creators are covering right now — be specific, not generic"],
  "recurringHooks": ["3 hook patterns appearing repeatedly — quote actual language where possible"],
  "emergingTopics": ["2-3 sub-topics about to peak based on upload frequency"],
  "emotionalTriggers": ["3 emotional angles working now — why viewers click AND watch"],
  "avoidAngles": ["1-2 oversaturated angles — what's already been done to death"],
  "structureInsights": ["2 structural observations about how top videos are built — pacing, format, length"],
  "audienceSignals": "One paragraph on what the audience in this niche actually wants right now"
}`

  try {
    const result = await model.generateContent(prompt)
    const text   = result.response.text()
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch (err) {
    console.warn('[gemini/analyseTrends] Parse error:', err.message)
    return {
      themes: [], recurringHooks: [], emergingTopics: [],
      emotionalTriggers: [], avoidAngles: [], structureInsights: [],
      audienceSignals: '',
      raw: err.message,
    }
  }
}

// ── SCRIPT SCORING ────────────────────────────────────────────────────────────
// Scores a generated VO script against the creator's top performing episodes
// Returns a score + specific actionable suggestions

async function scoreScript(voScript, topPerformers, niche, trendingContext) {
  if (!voScript?.trim()) return null

  const genAI = getClient()
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })

  const topEpsText = (topPerformers || []).slice(0, 5).map((ep, i) =>
    `${i + 1}. "${ep.track_name}" — ${ep.yt_retention_score || ep.retentionScore || '?'}% retention`
  ).join('\n')

  const trendText = trendingContext?.themes?.length
    ? `Current trending themes: ${trendingContext.themes.slice(0, 3).join(', ')}\nHooks working now: ${trendingContext.recurringHooks?.slice(0, 2).join(' | ')}`
    : ''

  const scriptPreview = voScript.slice(0, 3000)

  const prompt = `You are a YouTube retention specialist. Score this creator's VO script.

NICHE: ${niche}

TOP PERFORMING EPISODES (for pattern reference):
${topEpsText || 'No performance data yet — assess on general best practices'}

${trendText ? `TRENDING CONTEXT:\n${trendText}\n` : ''}

VO SCRIPT TO SCORE:
${scriptPreview}${voScript.length > 3000 ? '\n[...truncated]' : ''}

Score on these dimensions (0-100 each):

1. HOOK STRENGTH — Does the opening 30 seconds create genuine urgency/curiosity? Will people watch past 30s?
2. RETENTION STRUCTURE — Does it have clear beats, pattern interrupts, re-engagement moments?
3. VOICE MATCH — Does it sound like a real person talking, not a written script being read?
4. TREND ALIGNMENT — Does it connect to what's working in the niche right now?
5. CTA EFFECTIVENESS — Is the call to action specific and earned, not generic?

Return this exact JSON:
{
  "overallScore": 0-100,
  "dimensions": {
    "hookStrength": { "score": 0-100, "note": "one specific observation" },
    "retentionStructure": { "score": 0-100, "note": "one specific observation" },
    "voiceMatch": { "score": 0-100, "note": "one specific observation" },
    "trendAlignment": { "score": 0-100, "note": "one specific observation" },
    "ctaEffectiveness": { "score": 0-100, "note": "one specific observation" }
  },
  "topIssue": "The single most important thing to fix — be specific with an example from the script",
  "quickWins": ["2-3 specific, actionable changes that would boost retention — reference actual lines"],
  "strongestPart": "What's already working well — be specific"
}`

  try {
    const result = await model.generateContent(prompt)
    const text   = result.response.text()
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch (err) {
    console.warn('[gemini/scoreScript] Parse error:', err.message)
    return null
  }
}

// ── REAL-TIME TREND FETCH (Gemini URL grounding) ───────────────────────────────
// Uses Gemini's ability to read live URLs — no YouTube API quota needed
// Fetches YouTube search results page and extracts current trending titles

async function fetchTrendingWithGrounding(niche) {
  if (!process.env.GEMINI_API_KEY) return []

  const genAI = getClient()
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    tools: [{ googleSearch: {} }],  // enables real-time grounding
  })

  try {
    const result = await model.generateContent(
      `Search YouTube for the most viewed videos about "${niche}" published in the last 14 days. ` +
      `List the top 15 video titles, channel names, and approximate view counts. ` +
      `Format as JSON array: [{"title":"...","channel":"...","views":"..."}]`
    )
    const text = result.response.text()
    // Extract JSON from response
    const match = text.match(/\[[\s\S]*\]/)
    if (match) return JSON.parse(match[0])
    return []
  } catch (err) {
    console.warn('[gemini/fetchTrending] Grounding error:', err.message)
    return []
  }
}

module.exports = { analyseTrends, scoreScript, fetchTrendingWithGrounding }
