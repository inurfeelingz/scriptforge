// backend/src/services/narrative/narrativeArchitect.js
// Pass 1: Build the story skeleton before making any cuts.

const { supabase } = require('../../utils/supabase')
const Anthropic    = require('@anthropic-ai/sdk')
const ai           = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function parseKeyMoments(keyMoments) {
  return (keyMoments || []).map(k => {
    const tcMatch   = k.match(/(\d+):(\d+)/)
    const typeMatch = k.match(/\[(\w+)\]/)
    const ms        = tcMatch ? parseInt(tcMatch[1]) * 60000 + parseInt(tcMatch[2]) * 1000 : 0
    const type      = typeMatch ? typeMatch[1] : 'moment'
    const summary   = k.replace(/^\[\d+:\d+\]\s*\[\w+\]\s*/, '').trim()
    return { ms, type, summary, raw: k }
  }).filter(p => p.ms > 0)
}

async function buildNarrativeArc(userId, categoryId, sessionId, options = {}) {
  const { targetMinutes = 12, episodeContext = null } = options

  const [sessionRes, chatRes, episodeRes, retentionRes] = await Promise.all([
    supabase.from('session_journals')
      .select('title, transcript, key_moments, duration_ms')
      .eq('id', sessionId).single(),
    supabase.from('chat_history')
      .select('messages')
      .eq('user_id', userId).eq('category_id', categoryId)
      .order('updated_at', { ascending: false }).limit(1).single(),
    supabase.from('kb_planned_episodes')
      .select('track_name, summary, themes, track_context')
      .eq('user_id', userId).eq('category_id', categoryId)
      .order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('categories')
      .select('name, niche, audience_model, voice_profile')
      .eq('id', categoryId).single(),
  ])

  const session       = sessionRes.data
  const retention     = retentionRes.data
  const plannedEp     = episodeRes.data
  const chatMessages  = chatRes.data?.messages || []

  if (!session) throw new Error('Session not found')

  const peaks = parseKeyMoments(session.key_moments)

  // Pull the full KB episode planning conversation — both user intent AND assistant confirmations
  // This is where the agreed structure (cold open timestamp, arc, VO lines) lives
  const planningMessages = chatMessages
    .slice(-20)  // last 20 messages
    .map(m => {
      const prefix = m.role === 'user' ? 'CREATOR' : 'KB'
      return `${prefix}: ${m.content.slice(0, 800)}`
    })
    .join('\n\n')

  const recentInstructions = chatMessages
    .filter(m => m.role === 'user')
    .slice(-8)
    .map(m => m.content.slice(0, 400))
    .join('\n')

  const audiencePain = retention?.audience_model?.geminiInsights?.psychographics?.corePainPoint || ''
  const voiceProfile = retention?.voice_profile || {}

  const userPrompt = [
    plannedEp ? `EPISODE CONCEPT: "${plannedEp.track_name}" — ${plannedEp.summary || ''}` : null,
    `CREATOR: ${retention?.name || 'Unknown'}. NICHE: ${retention?.niche || 'Unknown'}.`,
    audiencePain ? `AUDIENCE PAIN: ${audiencePain}` : null,
    voiceProfile.languageFingerprint?.signaturePhrases?.length
      ? `CREATOR SIGNATURE PHRASES: ${voiceProfile.languageFingerprint.signaturePhrases.join(', ')}`
      : null,
    `SESSION: "${session.title}" — ${Math.round((session.duration_ms || 0) / 60000)} minutes`,
    `TARGET EDIT: ${targetMinutes} minutes`,
    episodeContext ? `EPISODE CONTEXT FROM KB CHAT:\n${episodeContext}` : null,
    planningMessages ? `FULL KB PLANNING CONVERSATION (most recent first — USE THIS to understand the agreed structure, timestamps, cold open moment, and VO lines):\n${planningMessages}` : null,
    recentInstructions ? `CREATOR'S MOST RECENT INSTRUCTIONS:\n${recentInstructions}` : null,
    `\nKEY MOMENTS FROM THIS SESSION (${peaks.length} mapped — reference these exact timestamps when building the arc):`,
    peaks.map((p, i) => {
      const min = Math.floor(p.ms / 60000)
      const sec = Math.floor((p.ms % 60000) / 1000)
      return `[${i + 1}] [${min}:${String(sec).padStart(2,'0')}] [${p.type.toUpperCase()}] ${p.summary}`
    }).join('\n'),
  ].filter(Boolean).join('\n')

  const response = await ai.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 4000,
    system:     NARRATIVE_ARCHITECT_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  let plan = {}
  try {
    plan = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim())
  } catch (e) {
    throw new Error('Narrative architect returned invalid JSON: ' + e.message)
  }

  // Store narrative plan
  await supabase.from('narrative_plans').upsert({
    user_id:     userId,
    category_id: categoryId,
    session_id:  sessionId,
    plan,
    created_at:  new Date().toISOString(),
  }, { onConflict: 'user_id,category_id,session_id' })

  return plan
}

function extractTranscriptBookends(transcript) {
  if (!transcript) return ''
  const lines = transcript.split('\n').filter(Boolean)
  const first = lines.slice(0, 15).join('\n')
  const last  = lines.slice(-10).join('\n')
  return first + '\n...\n' + last
}

const NARRATIVE_ARCHITECT_PROMPT = `You are a documentary narrative architect. Design the emotional journey BEFORE any clips are cut.

CRITICAL: If the KB planning conversation contains a pre-agreed episode structure with specific timestamps, cold open moments, or arc decisions — HONOUR THEM. Do not reinvent. Use those exact moments as anchors. The creator and KB already agreed on this structure.

Think like a documentary editor who knows that:
- The first 3 seconds decide if they stay
- Every cut must earn its place in the story
- VO lines are the spine — visuals hang off them
- Tension is built through withholding, not explaining

Return ONLY valid JSON — no preamble, no markdown:
{
  "episodeTitle": "The title that hooks",
  "centralQuestion": "The one question this episode answers (makes viewer stay to find out)",
  "narrativeArc": {
    "coldOpen": {
      "durationSec": 30,
      "momentIndex": 0,
      "purpose": "Hook — start with the most exciting moment",
      "emotionalTarget": "curiosity|shock|excitement",
      "voLine": "One punchy VO line. Max 12 words. Sets up the episode question."
    },
    "setup": {
      "durationSec": 90,
      "momentIndices": [],
      "purpose": "Establish context — what's the goal, what's at stake",
      "emotionalTarget": "investment|anticipation",
      "voLine": "VO that establishes the stakes. Max 15 words."
    },
    "incitingIncident": {
      "durationSec": 45,
      "momentIndices": [],
      "purpose": "The real challenge appears or something goes wrong",
      "emotionalTarget": "tension|concern",
      "voLine": "VO that names the obstacle. Max 12 words."
    },
    "struggle": {
      "durationSec": 150,
      "momentIndices": [],
      "purpose": "The grind — attempt, near-miss, attempt again",
      "emotionalTarget": "tension|hope|frustration",
      "voLine": "VO that captures the pressure. Max 12 words."
    },
    "breakthrough": {
      "durationSec": 60,
      "momentIndices": [],
      "purpose": "The moment it clicks — the turning point",
      "emotionalTarget": "excitement|relief|revelation",
      "voLine": "VO for the turn. Short, punchy, surprising. Max 10 words."
    },
    "resolution": {
      "durationSec": 90,
      "momentIndices": [],
      "purpose": "Result + reflection — what did we learn",
      "emotionalTarget": "satisfaction|inspiration",
      "voLine": "VO that lands the lesson. Max 15 words."
    },
    "outro": {
      "durationSec": 20,
      "momentIndices": [],
      "purpose": "CTA or tease for next episode",
      "emotionalTarget": "anticipation",
      "voLine": "VO outro. Teases what is next. Max 10 words."
    }
  },
  "hookStrategy": {
    "first3Seconds": "What they see and hear first — no time to read",
    "promise": "What you are implicitly promising if they keep watching",
    "retentionAnchor": "At minute X you will see Y — tease this early"
  },
  "cameraStrategy": {
    "screenCapture": "Specific content keywords that should trigger screen cut (e.g. DAW, beat, scrolling, software names, 'look at this')",
    "faceCam": "Specific content keywords that should trigger face cam cut (e.g. reactions, 'I feel', breakthroughs, direct address to viewer)",
    "defaultWhenUnclear": "screen|camera"
  }
}`

module.exports = { buildNarrativeArc }