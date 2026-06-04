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
    model: 'gemini-1.5-flash',
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
    model: 'gemini-1.5-flash',
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
    model: 'gemini-1.5-flash',
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

// ── Synthesise audience data upload ──────────────────────────────────────────
// Reads a sample of uploaded audience data and returns a plain-English
// persona summary KB can use directly in context.

async function synthesiseAudienceData({ fileName, rowCount, columns, dataSample }) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set')

  const genAI = getClient()
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  // Detect multi-section platform analytics exports (has _section column from parser)
  const isMultiSection = columns.includes('_section')
  const contextHint = isMultiSection
    ? 'This is a multi-section analytics export from a platform or website (not a YouTube audience export). It contains sections like OVERVIEW, TOP PLUGINS, GEOGRAPHY, USER SEGMENTS etc. Extract everything useful about who the users are and what they engage with.'
    : 'This may be a YouTube Studio export, survey, or subscriber data.'

  const prompt = `You are analysing audience/user data uploaded by a content creator.

File: ${fileName}
Total records: ${rowCount}
Columns: ${columns.filter(c => c !== '_section').join(', ')}
Context: ${contextHint}

Data sample:
${dataSample}

Write a plain-English audience persona summary (150-200 words) that a content creator can use to understand who their audience is. Cover:
- Who these people are (geography, segments, engagement level if available)
- What they care about or engage with most (top content, searches, behaviours)
- Any pain points or motivations visible in the data
- What kind of content would resonate with them
- Any notable patterns or drop-off signals

Write in direct, specific prose. No bullet points, no headers, no markdown. Write as if briefing a scriptwriter on who they're writing for.\`

  const result = await model.generateContent(prompt)
  return result.response.text().trim()
}

// ── Deep audience research via Gemini + Google Search grounding ──────────────
// Researches who watches content in this niche — demographics, psychographics,
// pain points, content gaps, thumbnail psychology.
// Runs weekly alongside the trend refresh.

async function researchAudience(niche, channelContext = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set')

  const genAI = getClient()

  // Use grounding model for real-time research
  const groundedModel = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    tools: [{ googleSearch: {} }],
  })

  // Use standard model for synthesis (grounding + JSON don't mix well)
  const synthModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  // Step 1 — Research the niche audience with grounding
  let rawResearch = ''
  try {
    const researchPrompt = `Search for research and data about the audience for "${niche}" content on YouTube and social media.

Find:
1. Who watches this type of content (age, gender, income, geography)
2. What drives them to search for and watch this content (motivations, pain points)
3. What thumbnail and title styles get the most clicks in this niche (emotional triggers, visual patterns)
4. What content gaps exist — what questions does this audience have that aren't being answered well?
5. What time of day and week does this audience watch most?

Cite specific data, studies, or patterns where possible.`

    const result = await groundedModel.generateContent(researchPrompt)
    rawResearch = result.response.text()
  } catch (err) {
    console.warn('[gemini/researchAudience] Grounding failed, using niche knowledge:', err.message)
    rawResearch = `No live grounding data available. Using Gemini knowledge about ${niche} audience.`
  }

  // Step 2 — Synthesise into structured JSON KB can use
  const channelSummary = channelContext.topCountries
    ? `Channel data: top countries ${channelContext.topCountries.join(', ')}, avg retention ${channelContext.avgRetention || 'unknown'}%, primary device ${channelContext.primaryDevice || 'unknown'}.`
    : ''

  const synthPrompt = `You are building an audience intelligence model for a content creator in the "${niche}" niche.

${channelSummary}

Research findings:
${rawResearch}

Synthesise this into a structured JSON object. Return ONLY valid JSON, no markdown, no preamble:

{
  "primaryAudience": {
    "ageRange": "primary age bracket e.g. 25-34",
    "genderSplit": "e.g. 65% male, 35% female",
    "geographies": ["top 3 countries/regions"],
    "incomeLevel": "e.g. middle income, aspirational",
    "educationLevel": "e.g. some college, university educated"
  },
  "psychographics": {
    "corePainPoint": "single sentence — the main struggle that drives them to this content",
    "coreAspiration": "single sentence — what they want to achieve or become",
    "contentMotivation": "why they watch — validation, learning, entertainment, community",
    "identityStatement": "I am the kind of person who... (how they see themselves)"
  },
  "contentBehaviour": {
    "peakWatchTimes": "e.g. evenings and weekends",
    "averageSessionLength": "e.g. 12-18 minutes",
    "preferredContentLength": "e.g. 8-15 minute deep dives",
    "discoveryMethod": "how they find new creators — search, suggested, community tabs"
  },
  "thumbnailPsychology": {
    "emotionalTriggers": ["list of emotions that drive clicks in this niche"],
    "visualPatterns": "what visual styles perform — faces, text-heavy, before/after, etc.",
    "titleFormulas": ["2-3 title structures that work in this niche"],
    "whatToAvoid": "thumbnail/title patterns that underperform"
  },
  "contentGaps": ["3-5 specific questions or topics this audience has that are underserved"],
  "competitorPatterns": "what top creators in this niche do that works",
  "researchedAt": "${new Date().toISOString()}"
}`

  try {
    const synthResult = await synthModel.generateContent(synthPrompt)
    const text = synthResult.response.text().replace(/\`\`\`json|\`\`\`/g, '').trim()
    const parsed = JSON.parse(text)
    return { ...parsed, rawResearch: rawResearch.slice(0, 2000) }
  } catch (err) {
    console.warn('[gemini/researchAudience] Synthesis parse error:', err.message)
    // Return minimal structure so the caller doesn't crash
    return {
      primaryAudience:    { ageRange: 'unknown', genderSplit: 'unknown', geographies: [], incomeLevel: 'unknown', educationLevel: 'unknown' },
      psychographics:     { corePainPoint: '', coreAspiration: '', contentMotivation: '', identityStatement: '' },
      contentBehaviour:   { peakWatchTimes: '', averageSessionLength: '', preferredContentLength: '', discoveryMethod: '' },
      thumbnailPsychology:{ emotionalTriggers: [], visualPatterns: '', titleFormulas: [], whatToAvoid: '' },
      contentGaps:        [],
      competitorPatterns: '',
      researchedAt:       new Date().toISOString(),
      rawResearch:        rawResearch.slice(0, 500),
    }
  }
}

// ── Competitor intelligence sweep ─────────────────────────────────────────────
// Researches top creators in the niche weekly — what they're posting,
// what's performing, and what gaps they're leaving.

async function researchCompetitors(niche, channelName = '') {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set')

  const genAI       = getClient()
  const groundedModel = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    tools: [{ googleSearch: {} }],
  })
  const synthModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

  // Step 1 — Research with grounding
  let rawResearch = ''
  try {
    const result = await groundedModel.generateContent(
      `Search for top YouTube creators in the "${niche}" niche. What are they currently posting? What content is performing well? What topics and formats are oversaturated? What questions does the audience have that nobody is answering well? Be specific — name creators, titles, formats.`
    )
    rawResearch = result.response.text()
  } catch (err) {
    console.warn('[gemini/competitors] Grounding failed:', err.message)
    rawResearch = `No live data. Using Gemini knowledge about ${niche} creator landscape.`
  }

  // Step 2 — Synthesise to JSON
  const synthPrompt = `You are building a competitor intelligence report for a YouTube creator in the "${niche}" niche${channelName ? ` (channel: ${channelName})` : ''}.

Research findings:
${rawResearch}

Return ONLY valid JSON, no markdown:
{
  "summary": "2-3 sentence plain English summary of the competitive landscape",
  "topCreators": ["name — what they do well"],
  "contentGaps": ["specific topic or angle nobody is covering well"],
  "topPerformingFormats": ["format or style that's currently getting traction"],
  "oversaturated": ["topics or formats that are overdone"],
  "opportunities": ["specific content angles this creator could own"],
  "researchedAt": "${new Date().toISOString()}"
}`

  try {
    const result = await synthModel.generateContent(synthPrompt)
    const text   = result.response.text().replace(/\`\`\`json|\`\`\`/g, '').trim()
    return JSON.parse(text)
  } catch (err) {
    console.warn('[gemini/competitors] Synthesis failed:', err.message)
    return {
      summary:              `Competitor research for ${niche} — synthesis failed`,
      topCreators:          [],
      contentGaps:          [],
      topPerformingFormats: [],
      oversaturated:        [],
      opportunities:        [],
      researchedAt:         new Date().toISOString(),
    }
  }
}

module.exports = { analyseTrends, scoreScript, fetchTrendingWithGrounding, synthesiseAudienceData, researchAudience, researchCompetitors }