// backend/src/services/narrative/transcriptAligner.js
// Matches each line of an episode script back to the raw Whisper transcript
// to get exact startMs/endMs for every cut. No AI — pure string matching.
// This ensures every EDL timestamp is anchored to a real spoken word.

// ── Parse raw transcript into word-level entries ──────────────────────────────
// Handles both formats:
//   [M:SS.mmm] text       (Whisper millisecond format)
//   [M:SS]     text       (legacy integer format)
function parseTranscript(transcript) {
  if (!transcript) return []
  const lines = []
  for (const raw of transcript.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // Try millisecond format first: [0:02.360] or [1:22.760]
    let m = line.match(/^\[(\d+):(\d+\.\d+)\]\s*(.*)/)
    if (m) {
      const ms = parseInt(m[1]) * 60000 + Math.round(parseFloat(m[2]) * 1000)
      lines.push({ ms, text: m[3].trim(), raw: line })
      continue
    }
    // Legacy integer format: [1:22] text
    m = line.match(/^\[(\d+):(\d+)\]\s*(.*)/)
    if (m) {
      const ms = parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000
      lines.push({ ms, text: m[3].trim(), raw: line })
    }
  }
  return lines
}

// ── Normalise text for fuzzy matching ────────────────────────────────────────
function normalise(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Word overlap score between two strings (0–1) ─────────────────────────────
function overlapScore(a, b) {
  const wa = new Set(normalise(a).split(' ').filter(w => w.length > 3))
  const wb = new Set(normalise(b).split(' ').filter(w => w.length > 3))
  if (!wa.size || !wb.size) return 0
  let matches = 0
  for (const w of wa) if (wb.has(w)) matches++
  return matches / Math.max(wa.size, wb.size)
}

// ── Find best matching transcript line for a script line ─────────────────────
// Searches within a window around the hint timestamp (if provided)
function findBestMatch(scriptLine, transcriptLines, hintMs = null, windowMs = 120000) {
  const norm = normalise(scriptLine)
  if (!norm) return null

  // If we have a hint, search within ±windowMs of it first
  const candidates = hintMs !== null
    ? transcriptLines.filter(l => Math.abs(l.ms - hintMs) <= windowMs)
    : transcriptLines

  // Score each candidate
  let best = null
  let bestScore = 0.15 // minimum threshold

  for (const line of (candidates.length ? candidates : transcriptLines)) {
    const score = overlapScore(scriptLine, line.text)
    if (score > bestScore) {
      bestScore = score
      best = line
    }
  }

  // If no match in window, try full transcript
  if (!best && hintMs !== null) {
    for (const line of transcriptLines) {
      const score = overlapScore(scriptLine, line.text)
      if (score > bestScore) {
        bestScore = score
        best = line
      }
    }
  }

  return best ? { ...best, score: bestScore } : null
}

// ── Main aligner ─────────────────────────────────────────────────────────────
// scriptLines: array of { text, section, isVO, hintMs? }
// transcript:  raw transcript string from session_journals
// Returns:     array of { text, section, isVO, startMs, endMs, source, score, matched }
function alignScript(scriptLines, transcript) {
  const transcriptLines = parseTranscript(transcript)
  if (!transcriptLines.length) {
    // No parseable transcript — return script lines with 0ms (will error gracefully)
    return scriptLines.map((l, i) => ({
      ...l, startMs: i * 8000, endMs: i * 8000 + 8000,
      source: 'screen', score: 0, matched: false,
    }))
  }

  const aligned = []
  let lastMatchMs = 0 // prevent backwards jumps

  for (const scriptLine of scriptLines) {
    if (scriptLine.isVO) {
      // VO lines don't need transcript alignment — they're recorded separately
      aligned.push({ ...scriptLine, startMs: null, endMs: null, source: 'vo', score: 1, matched: true })
      continue
    }

    const hintMs = scriptLine.hintMs || lastMatchMs
    const match = findBestMatch(scriptLine.text, transcriptLines, hintMs)

    if (match) {
      // Enforce forward-only progression (no backwards jumps unless cold open)
      const startMs = scriptLine.section === 'coldOpen'
        ? match.ms
        : Math.max(match.ms, lastMatchMs)

      // Find the next transcript line to get endMs
      const lineIdx = transcriptLines.findIndex(l => l.ms === match.ms)
      const nextLine = transcriptLines[lineIdx + 1]
      const endMs = nextLine ? Math.min(nextLine.ms, startMs + 12000) : startMs + 8000

      // Determine source from content keywords
      const source = detectSource(scriptLine.text + ' ' + match.text)

      aligned.push({
        ...scriptLine,
        startMs,
        endMs,
        source,
        score: match.score,
        matched: true,
        matchedText: match.text,
      })
      lastMatchMs = startMs
    } else {
      // No match found — flag it, use estimated position
      aligned.push({
        ...scriptLine,
        startMs: lastMatchMs + 8000,
        endMs: lastMatchMs + 16000,
        source: 'screen',
        score: 0,
        matched: false,
      })
      lastMatchMs += 8000
    }
  }

  return aligned
}

// ── Detect screen vs camera from content keywords ────────────────────────────
function detectSource(text) {
  const t = (text || '').toLowerCase()
  const cameraKeywords = [
    'i feel', 'i think', 'honestly', 'look at me', 'watch this', 'right?',
    'you know', "i'm going to", "i'm gonna", 'this is it', 'breakthrough',
    "i can't believe", 'oh wow', 'wait wait', 'yes!', 'finally', "let me tell you",
    "here's what", "i want to", "so basically", "the thing is",
  ]
  const screenKeywords = [
    'daw', 'plugin', 'beat', 'track', 'midi', 'fl studio', 'logic', 'ableton',
    'melody', 'chord', 'bpm', 'tempo', 'mix', 'bounce', 'export', 'upload',
    'scroll', 'click', 'open', 'close', 'drag', 'drop', 'load', 'save',
    'let me show', 'look at this', "here's the", 'pull up', 'over here',
  ]
  const cameraScore = cameraKeywords.filter(k => t.includes(k)).length
  const screenScore = screenKeywords.filter(k => t.includes(k)).length
  return screenScore > cameraScore ? 'screen' : 'camera'
}

// ── Convert aligned lines to EDL cut objects ─────────────────────────────────
// Returns the cut array format expected by edlAssembler
function toCuts(alignedLines) {
  return alignedLines
    .filter(l => !l.isVO && l.startMs !== null && l.matched)
    .map(l => ({
      startMs:          l.startMs,
      endMs:            l.endMs,
      source:           l.source,
      narrativeSection: l.section,
      reason:           l.text.slice(0, 80),
      matchScore:       l.score,
    }))
}

module.exports = { alignScript, toCuts, parseTranscript, overlapScore }