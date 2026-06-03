// backend/src/services/narrative/voiceEngine.js
// Generates VO lines that sound like the creator, not like a generic narrator.

const Anthropic = require('@anthropic-ai/sdk')
const ai        = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function generateCreatorVoiceLines(narrativePlan, voiceProfile, creatorName) {
  const signature = voiceProfile?.languageFingerprint?.signaturePhrases || []
  const avoid     = voiceProfile?.languageFingerprint?.avoidPhrases      || []
  const tone      = voiceProfile?.toneAttributes || []
  const style     = voiceProfile?.deliveryStyle  || 'conversational'

  const voLines = Object.entries(narrativePlan.narrativeArc).map(([section, data]) => ({
    section,
    draft: data.voLine,
    emotionalTarget: data.emotionalTarget,
    purpose: data.purpose,
  }))

  const prompt = [
    `Rewrite these VO lines to sound exactly like ${creatorName || 'this creator'}.`,
    '',
    'CREATOR VOICE PROFILE:',
    signature.length ? `Signature phrases they actually use: ${signature.join(', ')}` : null,
    avoid.length     ? `Phrases they never use: ${avoid.join(', ')}`                  : null,
    tone.length      ? `Their tone: ${tone.join(', ')}`                               : null,
    `Delivery style: ${style}`,
    '',
    'RULES:',
    '- Max 15 words per line',
    '- Sound like they are talking to one friend, not broadcasting',
    '- Use their actual phrases where natural — never force them',
    '- Do NOT explain what we are about to see — enhance the feeling',
    '- Each line must be recordable in one natural breath',
    '',
    'VO LINES TO REWRITE:',
    JSON.stringify(voLines, null, 2),
    '',
    'Return ONLY valid JSON:',
    '{ "voLines": [{ "section": string, "line": string, "variations": [string, string], "tone": string }] }',
  ].filter(Boolean).join('\n')

  const response = await ai.messages.create({
    model:      'claude-sonnet-4-5',
    max_tokens: 1500,
    system:     'You are a voiceover writer who mimics specific creator voices. You never write generic narrator lines.',
    messages:   [{ role: 'user', content: prompt }],
  })

  try {
    return JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim())
  } catch {
    // Fall back to draft lines if parse fails
    return { voLines: voLines.map(v => ({ section: v.section, line: v.draft, variations: [], tone: v.emotionalTarget })) }
  }
}

module.exports = { generateCreatorVoiceLines }