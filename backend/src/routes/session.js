// backend/src/routes/session.js
// Companion app session journal API.
// Records timestamped utterances, processes them with Claude
// into a structured voice memo ready for episode generation.

const express    = require('express')
const Anthropic  = require('@anthropic-ai/sdk')
const { supabase } = require('../utils/supabase')

const router = express.Router()
const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── CREATE SESSION ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { categoryId, title } = req.body

  const { data, error } = await supabase
    .from('session_journals')
    .insert({
      user_id:     req.user.id,
      category_id: categoryId || null,
      title:       title || `Session ${new Date().toLocaleDateString()}`,
      status:      'recording',
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json({ session: data })
})

// ─── ADD ENTRY (utterance or marker) ─────────────────────────────────────────

router.post('/:id/entry', async (req, res) => {
  const { text, type = 'speech', timestampMs, energy = 0.5 } = req.body

  // Get current entries
  const { data: session } = await supabase
    .from('session_journals')
    .select('entries, duration_ms')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const entries = session.entries || []
  const newEntry = {
    id:          `entry-${Date.now()}`,
    timestamp_ms: timestampMs || entries.reduce((max, e) => Math.max(max, e.timestamp_ms || 0), 0) + 1000,
    text:        text?.trim() || '',
    type,        // 'speech' | 'marker' | 'note'
    energy:      parseFloat(energy),
  }

  entries.push(newEntry)

  await supabase
    .from('session_journals')
    .update({
      entries,
      duration_ms: Math.max(session.duration_ms || 0, newEntry.timestamp_ms),
      updated_at:  new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ entry: newEntry, totalEntries: entries.length })
})

// ─── BATCH ENTRIES (from client Whisper processing) ──────────────────────────

router.post('/:id/entries/batch', async (req, res) => {
  const { entries } = req.body
  if (!entries?.length) return res.status(400).json({ error: 'entries array required' })

  const { data: session } = await supabase
    .from('session_journals')
    .select('entries, duration_ms')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const existing   = session.entries || []
  const merged     = [...existing, ...entries]
    .sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))

  const maxTime = merged.reduce((max, e) => Math.max(max, e.timestamp_ms || 0), 0)

  await supabase
    .from('session_journals')
    .update({
      entries:     merged,
      duration_ms: maxTime,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ totalEntries: merged.length })
})

// ─── PROCESS SESSION → VOICE MEMO ────────────────────────────────────────────

router.post('/:id/process', async (req, res) => {
  const { data: session } = await supabase
    .from('session_journals')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (!session) return res.status(404).json({ error: 'Session not found' })

  const entries = session.entries || []
  if (!entries.length) return res.status(400).json({ error: 'No entries to process' })

  // Guard: if only marker entries exist with no speech text, Claude gets a blank prompt
  const speechEntries = entries.filter(e => e.text?.trim() && e.type !== 'marker')
  const markerEntries = entries.filter(e => e.type === 'marker')

  if (!speechEntries.length && markerEntries.length > 0) {
    // Markers only — generate a minimal memo from just the marks
    const markerMemo = markerEntries
      .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
      .map(e => `At ${formatMs(e.timestamp_ms)}: ${e.text || 'marked moment'}`)
      .join('\n')

    await supabase.from('session_journals').update({
      transcript:      markerMemo,
      voice_memo_text: `Session with ${markerEntries.length} marked moment${markerEntries.length > 1 ? 's' : ''}.\n\n${markerMemo}`,
      key_moments:     markerEntries.map(e => ({ timestampMs: e.timestamp_ms, description: e.text || 'marked moment', timestampFmt: formatMs(e.timestamp_ms) })),
      status:          'ready',
      updated_at:      new Date().toISOString(),
    }).eq('id', req.params.id).eq('user_id', req.user.id)

    return res.json({ voiceMemoText: markerMemo, keyMoments: [], transcript: markerMemo })
  }

  if (!speechEntries.length) {
    return res.status(400).json({ error: 'No transcribed speech found. Try speaking during the session.' })
  }

  // Build a chronological narrative from entries
  const transcript = entries
    .filter(e => e.text?.trim())
    .sort((a, b) => a.timestamp_ms - b.timestamp_ms)
    .map(e => {
      const mins = Math.floor((e.timestamp_ms || 0) / 60000)
      const secs = Math.floor(((e.timestamp_ms || 0) % 60000) / 1000)
      const time = `${mins}:${String(secs).padStart(2, '0')}`
      const prefix = e.type === 'marker' ? `[MARK ${time}]` : `[${time}]`
      return `${prefix} ${e.text}`
    })
    .join('\n')

  // Ask Claude to synthesise into a coherent voice memo
  let response
  try {
    response = await client.messages.create({
    model:      process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `This is a raw session journal from a music producer recorded while making a track.
Convert it into a 2-3 paragraph voice memo in their natural speaking voice.
Keep timestamps for any [MARK] moments — those are important visual cues.
Be concise and vivid. This will be used to generate a YouTube documentary episode.

RAW JOURNAL:
${transcript}

Return ONLY the voice memo text, no preamble.`
    }]
  })

  } catch (err) {
    return res.status(502).json({ error: 'Claude API unavailable — try again shortly: ' + err.message })
  }

  const voiceMemoText = response.content[0].text.trim()

  // Extract key moments (MARK entries)
  const keyMoments = entries
    .filter(e => e.type === 'marker')
    .map(e => ({
      timestampMs:  e.timestamp_ms,
      description:  e.text,
      timestampFmt: formatMs(e.timestamp_ms),
    }))

  // Save processed data
  await supabase
    .from('session_journals')
    .update({
      transcript:      transcript,
      voice_memo_text: voiceMemoText,
      key_moments:     keyMoments,
      status:          'ready',
      updated_at:      new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)

  res.json({ voiceMemoText, keyMoments, transcript })
})

// ─── LIST SESSIONS ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { categoryId, status } = req.query

  let query = supabase
    .from('session_journals')
    .select('id, title, status, duration_ms, key_moments, voice_memo_text, recorded_at, episode_id')
    .eq('user_id', req.user.id)
    .order('recorded_at', { ascending: false })
    .limit(20)

  if (categoryId) query = query.eq('category_id', categoryId)
  if (status)     query = query.eq('status', status)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json({ sessions: data || [] })
})

// ─── GET SINGLE SESSION ───────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('session_journals')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Session not found' })
  res.json({ session: data })
})

// ─── UPDATE SESSION TITLE ────────────────────────────────────────────────────

router.patch('/:id/title', async (req, res) => {
  const { title } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'title required' })

  const { data, error } = await supabase
    .from('session_journals')
    .update({ title: title.trim(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select('id, title')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ session: data })
})

// ─── LINK SESSION TO EPISODE ──────────────────────────────────────────────────

router.patch('/:id/link', async (req, res) => {
  const { episodeId } = req.body

  const { data, error } = await supabase
    .from('session_journals')
    .update({
      episode_id:        episodeId,
      synced_to_episode: true,
      status:            'used',
      updated_at:        new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ session: data })
})

// ─── TRANSCRIBE AUDIO CHUNK ─────────────────────────────────────────────────

const { handleTranscribe, upload } = require('./session/transcribe')
router.post('/:id/transcribe', upload.single('audio'), handleTranscribe)

// ─── DELETE SESSION ───────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  await supabase
    .from('session_journals')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
  res.json({ deleted: true })
})

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatMs(ms) {
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

module.exports = router
