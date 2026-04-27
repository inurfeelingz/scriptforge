// backend/src/routes/session/transcribe.js
// Receives audio chunks from the companion app and transcribes with Whisper.
// Attached to the session router at POST /:id/transcribe
// Called every 10 seconds while recording.

// This is a standalone handler file — imported by routes/session.js

const multer = require('multer')
const Anthropic = require('@anthropic-ai/sdk')
const { supabase } = require('../../utils/supabase')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * POST /api/session/:id/transcribe
 * Receives a 10s audio blob from the companion PWA.
 * Uses Whisper (via Anthropic API) to transcribe.
 * Saves result as a speech entry in the session.
 */
async function handleTranscribe(req, res) {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })

  const timestampMs = parseInt(req.body.timestampMs) || 0

  try {
    // Verify session belongs to user
    const { data: session } = await supabase
      .from('session_journals')
      .select('id, entries')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single()

    if (!session) return res.status(404).json({ error: 'Session not found' })

    // Use Whisper via Anthropic API
    // Note: Anthropic doesn't directly expose Whisper — use OpenAI Whisper API
    // or run it client-side via Transformers.js in the worker.
    // This is the server-side fallback path.

    let text = ''
    let whisperConfidence = null

    if (process.env.OPENAI_API_KEY) {
      const FormData = require('form-data')
      const axios    = require('axios')
      const form     = new FormData()

      // Normalise mimetype — strip codec suffix e.g. "audio/webm;codecs=opus" → "audio/webm"
      const rawMime  = req.file.mimetype || 'audio/webm'
      const baseMime = rawMime.split(';')[0].trim()
      const extMap   = { 'audio/webm':'webm','audio/mp4':'mp4','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/x-m4a':'m4a','video/webm':'webm' }
      const ext      = extMap[baseMime] || 'webm'

      form.append('file', req.file.buffer, { filename: `audio.${ext}`, contentType: baseMime })
      form.append('model', 'whisper-1')
      form.append('language', 'en')
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'word')

      let response
      try {
        response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        })
      } catch (whisperErr) {
        const detail = whisperErr.response?.data?.error?.message || whisperErr.message
        console.error('[transcribe] Whisper error:', detail, '| mime:', baseMime, '| size:', req.file.size)
        return res.status(500).json({ error: `Whisper failed: ${detail}` })
      }

      text = response.data?.text || ''
      const segs       = response.data?.segments || []
      const avgLogprob = segs.length ? segs.reduce((s,seg) => s + (seg.avg_logprob||0), 0) / segs.length : null
      whisperConfidence = avgLogprob !== null ? Math.min(1, Math.max(0, (avgLogprob + 1.5) / 1.5)) : null
    } else {
      // If no OpenAI key: return empty — client-side Whisper in the worker handles this
      return res.json({ text: '', entries: [], clientSideRequired: true })
    }

    if (!text.trim()) return res.json({ text: '', entries: [] })

    const isCumulative = req.body.isCumulative === 'true'

    // Create an entry for this transcribed chunk
    const entry = {
      id:           `speech-${Date.now()}`,
      timestamp_ms: timestampMs,
      type:         'speech',
      text:         text.trim(),
      energy:       0.5,
      confidence:   whisperConfidence,
    }

    // For cumulative mode: replace the last speech entry (it's a re-transcription
    // of everything including the previous chunk). This prevents duplicate text.
    let existingEntries = session.entries || []
    let entries
    if (isCumulative) {
      // Remove the last speech entry and replace with fresh full transcription
      const nonSpeech = existingEntries.filter(e => e.type !== 'speech')
      const markers   = existingEntries.filter(e => e.type === 'marker')
      entries = [...markers, entry]
    } else {
      entries = [...existingEntries, entry]
    }

    await supabase
      .from('session_journals')
      .update({ entries, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)

    res.json({ text, entries: [entry] })

  } catch (err) {
    console.error('[session/transcribe]', err.message)
    // Don't fail hard — companion continues recording even if transcription fails
    res.json({ text: '', entries: [], error: err.message })
  }
}

module.exports = { handleTranscribe, upload }