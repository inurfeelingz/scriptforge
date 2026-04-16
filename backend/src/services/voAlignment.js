// backend/src/services/voAlignment.js
// Whisper forced alignment: maps every word in the recorded VO to a precise timestamp.
// Uses this to automatically reposition timeline clips so visuals land on the
// exact words they illustrate — what broadcast editors spend hours doing by hand.

// Whisper forced alignment uses the 'whisper-timestamped' library server-side
// OR the Transformers.js pipeline with return_timestamps:true client-side.
// This service handles the backend processing path.

const { supabase } = require('../utils/supabase')

// ─── WORD-LEVEL TIMESTAMP EXTRACTION ─────────────────────────────────────────

/**
 * Parse Whisper word-level timestamp output into a clean array.
 * Whisper with return_timestamps: 'word' returns:
 * { chunks: [{ text: "and", timestamp: [0.24, 0.44] }, ...] }
 *
 * Returns: [{ word, startMs, endMs, index }]
 */
function parseWhisperWordTimestamps(whisperOutput) {
  if (!whisperOutput?.chunks) return []

  return whisperOutput.chunks
    .filter(chunk => chunk.text?.trim() && chunk.timestamp?.length === 2)
    .map((chunk, index) => ({
      word:    chunk.text.trim().toLowerCase().replace(/[.,!?;:'"]/g, ''),
      raw:     chunk.text.trim(),
      startMs: Math.round(chunk.timestamp[0] * 1000),
      endMs:   Math.round(chunk.timestamp[1] * 1000),
      index,
    }))
}

// ─── INTENT WORD MATCHING ─────────────────────────────────────────────────────

/**
 * Match EDL intent tags to word timestamps in the VO.
 * For each clip's intentTag (e.g. "chord discovery, surprised"),
 * find the moment in the VO where those words or concepts appear.
 *
 * Returns: Map of clipIndex → { targetMs, word, confidence }
 */
function matchIntentsToWords(wordTimestamps, timeline) {
  const matches = new Map()

  for (let i = 0; i < timeline.length; i++) {
    const clip = timeline[i]
    if (!clip.intentTag) continue

    // Extract key concept words from the intent tag
    const intentWords = clip.intentTag
      .toLowerCase()
      .replace(/[.,!?;:'"]/g, '')
      .split(/[\s,]+/)
      .filter(w => w.length > 3) // skip short words

    // Find the best word timestamp match
    let bestMatch = null
    let bestScore = 0

    for (const intentWord of intentWords) {
      for (const wt of wordTimestamps) {
        // Direct match
        if (wt.word === intentWord || wt.word.startsWith(intentWord) || intentWord.startsWith(wt.word)) {
          const score = intentWord.length / Math.max(intentWord.length, wt.word.length)
          if (score > bestScore) {
            bestScore  = score
            bestMatch  = { targetMs: wt.startMs, word: wt.raw, confidence: score }
          }
        }
      }
    }

    if (bestMatch && bestScore > 0.6) {
      matches.set(i, bestMatch)
    }
  }

  return matches
}

// ─── REALIGN TIMELINE ─────────────────────────────────────────────────────────

/**
 * Reposition timeline clips so they cut in at the exact VO word they illustrate.
 * This is the core alignment operation — takes a timeline and word timestamps,
 * returns a new timeline with corrected record timecodes.
 *
 * @param {Array}  timeline       — TimelineClip array
 * @param {Array}  wordTimestamps — from parseWhisperWordTimestamps()
 * @param {number} fps            — timeline frame rate (default 25)
 */
function realignTimeline(timeline, wordTimestamps, fps = 25) {
  if (!wordTimestamps.length) return { timeline, alignments: [], aligned: 0 }

  const intentMatches = matchIntentsToWords(wordTimestamps, timeline)
  const alignments    = []
  let   aligned       = 0

  // Rebuild timeline with corrected record timecodes
  const newTimeline = timeline.map((clip, i) => {
    const match = intentMatches.get(i)
    if (!match) return clip

    const originalRecInMs  = tcToMs(clip.recIn)
    const targetMs         = match.targetMs
    const shiftMs          = targetMs - originalRecInMs

    // Don't shift more than 5 seconds — prevents overcorrection on bad matches
    if (Math.abs(shiftMs) > 5000) return clip

    const newRecInMs  = targetMs
    const newRecOutMs = targetMs + (clip.durationMs || 5000)

    alignments.push({
      clipIndex:    i,
      filename:     clip.filename,
      intentTag:    clip.intentTag,
      matchedWord:  match.word,
      originalMs:   originalRecInMs,
      alignedMs:    targetMs,
      shiftMs,
      confidence:   match.confidence,
    })
    aligned++

    return {
      ...clip,
      recIn:  msToTc(newRecInMs,  fps),
      recOut: msToTc(newRecOutMs, fps),
      aligned: true,
      alignedToWord: match.word,
      alignmentConfidence: match.confidence,
    }
  })

  return { timeline: newTimeline, alignments, aligned }
}

// ─── SAVE ALIGNMENT DATA ──────────────────────────────────────────────────────

async function saveAlignmentData(userId, episodeId, alignmentData) {
  const { error } = await supabase
    .from('episodes')
    .update({
      alignment_data: alignmentData,
      updated_at:     new Date().toISOString(),
    })
    .eq('id', episodeId)
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
  return alignmentData
}

// ─── TIMECODE UTILITIES ───────────────────────────────────────────────────────

function tcToMs(tc) {
  if (!tc) return 0
  const p = String(tc).split(':').map(Number)
  if (p.length === 4) return ((p[0] * 3600 + p[1] * 60 + p[2]) * 1000) + p[3] * 40
  if (p.length === 3) return (p[0] * 3600 + p[1] * 60 + p[2]) * 1000
  return 0
}

function msToTc(ms, fps = 25) {
  const totalFrames = Math.round(ms * fps / 1000)
  const ff = totalFrames % fps
  const ss = Math.floor(totalFrames / fps) % 60
  const mm = Math.floor(totalFrames / fps / 60) % 60
  const hh = Math.floor(totalFrames / fps / 3600)
  return [hh, mm, ss, ff].map(n => String(n).padStart(2, '0')).join(':')
}

module.exports = {
  parseWhisperWordTimestamps,
  matchIntentsToWords,
  realignTimeline,
  saveAlignmentData,
  tcToMs,
  msToTc,
}
