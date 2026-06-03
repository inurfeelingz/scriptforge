// backend/src/services/narrative/storyVerifier.js
// Pass 3: Story Editor — reviews the narrative cut before EDL assembly.
// Works without benchmark data (Mode 1) and gets smarter when YouTube data is connected (Mode 2).

const Anthropic = require('@anthropic-ai/sdk')
const ai        = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const { supabase } = require('../../utils/supabase')

async function verifyAndPolish(userId, categoryId, narrativePlan, cutList, voiceLines) {
  // Try to load benchmark data — works without it
  let topPerformers = []
  let creatorAvgRetention = null
  try {
    const { data: ret } = await supabase
      .from('retention_curves')
      .select('title, avg_retention_pct, hook_score')
      .eq('user_id', userId)
      .order('avg_retention_pct', { ascending: false })
      .limit(5)
    topPerformers = ret || []

    if (topPerformers.length) {
      creatorAvgRetention = Math.round(
        topPerformers.reduce((s, v) => s + (v.avg_retention_pct || 0), 0) / topPerformers.length
      )
    }
  } catch {}

  const hasBenchmarks = topPerformers.length > 0

  const cutSummary = (cutList.cuts || []).map((c, i) => {
    const startSec = Math.round(c.startMs / 1000)
    const endSec   = Math.round(c.endMs / 1000)
    const min      = Math.floor(startSec / 60)
    const sec      = startSec % 60
    return `[${i + 1}] ${min}:${String(sec).padStart(2,'0')} → ${Math.floor(endSec/60)}:${String(endSec%60).padStart(2,'0')} | ${c.narrativeSection || 'unassigned'} | ${c.source} | ${c.reason || c.emotionalPurpose || ''}`
  }).join('\n')

  const voSummary = (voiceLines?.voLines || []).map(v =>
    v.section + ': "' + v.line + '"'
  ).join('\n')

  const benchmarkContext = hasBenchmarks
    ? `CREATOR BENCHMARK DATA:\n- Average retention: ${creatorAvgRetention}%\n- Top performers:\n${topPerformers.map(v => `  ${v.title}: ${v.avg_retention_pct}% retention`).join('\n')}`
    : 'No benchmark data yet — evaluate against documentary best practices.'

  const prompt = [
    'Review this rough cut as a senior documentary editor.',
    '',
    benchmarkContext,
    '',
    'NARRATIVE PLAN:',
    'Episode: ' + (narrativePlan?.episodeTitle || 'Unknown'),
    'Central question: ' + (narrativePlan?.centralQuestion || 'Unknown'),
    'Arc: ' + Object.keys(narrativePlan?.narrativeArc || {}).join(' → '),
    '',
    'CUT LIST (' + (cutList.cuts?.length || 0) + ' cuts):',
    cutSummary,
    '',
    'VOICEOVER SPINE:',
    voSummary || 'No VO lines provided',
    '',
    'Be brutally honest. Flag everything that will hurt retention.',
    'For every problem provide the exact fix with timecodes.',
    'Return ONLY valid JSON.',
  ].join('\n')

  const response = await ai.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 3000,
    system:     VERIFIER_SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: prompt }],
  })

  let verification = {}
  try {
    verification = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim())
  } catch (e) {
    console.warn('[storyVerifier] parse failed:', e.message)
    return { error: 'parse_failed', raw: response.content[0].text }
  }

  return verification
}

const VERIFIER_SYSTEM_PROMPT = `You are a senior documentary editor who has cut 1000+ YouTube videos. Be brutally honest.

Return ONLY valid JSON:
{
  "overallScore": {
    "stickiness": 1-10,
    "virality": 1-10,
    "polish": 1-10,
    "predictedRetention30s": 0-100,
    "predictedAvgRetention": 0-100
  },
  "hookDiagnosis": {
    "score": 1-10,
    "verdict": "PASS|NEEDS_WORK|CRITICAL",
    "isFirstMomentCompelling": true|false,
    "problems": [{"timecode":"MM:SS","problem":"what is wrong","fix":"exactly what to change","impact":"what this improves"}]
  },
  "pacingDiagnosis": {
    "score": 1-10,
    "verdict": "PASS|NEEDS_WORK|CRITICAL",
    "deadSpots": [{"timeRange":"MM:SS-MM:SS","reason":"why energy drops","fix":"what to do","secondsToSave":0}],
    "momentumKillers": [{"timecode":"MM:SS","issue":"what kills flow","fix":"what to change"}]
  },
  "narrativeCoherence": {
    "score": 1-10,
    "verdict": "PASS|NEEDS_WORK|CRITICAL",
    "doesStoryMakeSense": true|false,
    "logicalGaps": [{"gap":"what doesnt connect","fix":"bridge VO or transition needed"}],
    "missingEmotionalBeats": ["what is absent from the arc"]
  },
  "viralityAnalysis": {
    "score": 1-10,
    "shareableMoments": [{"timecode":"MM:SS","moment":"what is shareable","suggestedClip":"the 15-30s clip to extract"}],
    "commentBait": ["questions or moments that will drive comments"],
    "shortsOpportunities": [{"timeRange":"MM:SS-MM:SS","platform":"youtube_shorts|tiktok","hook":"the 3 second hook"}]
  },
  "priorityFixes": [
    {
      "rank": 1,
      "category": "hook|pacing|narrative|virality|polish",
      "severity": "critical|major|minor",
      "timecode": "MM:SS",
      "currentState": "what is there now",
      "fix": "exactly what to do",
      "expectedImpact": "what metric improves",
      "effort": "small|medium|large"
    }
  ],
  "autoImplementable": [
    {
      "type": "trim|reorder|addVO|addTitle",
      "cutIndex": 0,
      "action": "what to change automatically",
      "value": "the new value"
    }
  ]
}`

module.exports = { verifyAndPolish }