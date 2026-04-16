// backend/src/services/vision/timelineBuilder.js
// Assembles matched clips into a structured virtual timeline.
// The timeline is a JSON object — the source of truth for the editor.
// Export functions convert it to EDL, FCPXML, or OTIO for DaVinci.

// STATUS: PLACEHOLDER — Structure defined, export logic stubbed
// Priority: 3 (depends on visionMatcher)

const { supabase } = require('../../utils/supabase')

// ─── TIMELINE CLIP SCHEMA ─────────────────────────────────────────────────────
// {
//   id:           string (uuid)
//   trackIndex:   0 (cam/V1) | 1 (daw/V2) | 2 (vo/A1) | 3 (music/A2)
//   clipId:       uuid (references clip_index.id)
//   filename:     string
//   filepath:     string
//   srcIn:        string (HH:MM:SS:FF)
//   srcOut:       string
//   recIn:        string (record timecode)
//   recOut:       string
//   durationMs:   number
//   intentTag:    string (from EDL)
//   confidence:   number (0-1)
//   aiFlag:       object | null
//   approved:     boolean
//   locked:       boolean
// }

/**
 * Build a virtual timeline from matched EDL beats.
 * Called after matchFullEDL completes.
 */
function buildTimeline(matchResults, edlClipMap) {
  // TODO: Handle overlapping clips (B-roll over cam)
  // TODO: Calculate correct record timecodes based on sequence
  // TODO: Insert gap clips where no match found
  // TODO: Validate total duration makes sense

  const timeline = []
  let recTimeMs  = 3600000 // Start at 01:00:00:00

  for (const result of matchResults) {
    if (!result.bestMatch) {
      // Insert a placeholder clip for manual assignment
      timeline.push(buildPlaceholderClip(result.beat, recTimeMs))
      recTimeMs += result.beat.durationEstimateMs || 5000
      continue
    }

    const clip = buildTimelineClip(result, recTimeMs)
    timeline.push(clip)
    recTimeMs += clip.durationMs
  }

  return {
    clips:      timeline,
    durationMs: recTimeMs - 3600000,
    trackCount: 3,
    startTC:    '01:00:00:00',
    fps:        25,
  }
}

function buildTimelineClip(matchResult, recTimeMs) {
  const { beat, bestMatch, confidence, aiFlag } = matchResult

  // TODO: Calculate proper srcIn/srcOut based on clip duration vs beat duration
  // TODO: Trim to fit beat duration if clip is longer
  const durationMs = beat.durationEstimateMs || Math.min(bestMatch.duration_ms || 5000, 15000)

  return {
    id:          crypto.randomUUID?.() || `clip-${Date.now()}-${Math.random()}`,
    trackIndex:  beat.clipType === 'daw' ? 1 : 0,
    clipId:      bestMatch.id,
    filename:    bestMatch.filename,
    filepath:    bestMatch.filepath,
    srcIn:       beat.srcIn  || '00:00:00:00',
    srcOut:      beat.srcOut || msToTC(durationMs, 25),
    recIn:       msToTC(recTimeMs, 25),
    recOut:      msToTC(recTimeMs + durationMs, 25),
    durationMs,
    intentTag:   beat.intentTag,
    confidence,
    aiFlag:      matchResult.warning ? { type: 'low_confidence', message: matchResult.warning } : null,
    approved:    confidence > 0.7,  // auto-approve high-confidence matches
    locked:      false,
  }
}

function buildPlaceholderClip(beat, recTimeMs) {
  const durationMs = beat.durationEstimateMs || 5000
  return {
    id:          crypto.randomUUID?.() || `placeholder-${Date.now()}`,
    trackIndex:  beat.clipType === 'daw' ? 1 : 0,
    clipId:      null,
    filename:    null,
    filepath:    null,
    srcIn:       '00:00:00:00',
    srcOut:      '00:00:05:00',
    recIn:       msToTC(recTimeMs, 25),
    recOut:      msToTC(recTimeMs + durationMs, 25),
    durationMs,
    intentTag:   beat.intentTag,
    confidence:  0,
    aiFlag:      { type: 'no_match', message: 'No clip found — assign manually or run indexing' },
    approved:    false,
    locked:      false,
    isPlaceholder: true,
  }
}

/**
 * Save a timeline to an editor project
 */
async function saveTimeline(projectId, userId, timeline, flags) {
  const { data, error } = await supabase
    .from('editor_projects')
    .update({
      timeline:       timeline.clips,
      duration_ms:    timeline.durationMs,
      ai_draft:       timeline.clips,    // snapshot the AI draft separately
      ai_flags:       flags || [],
      ai_confidence:  timeline.clips.length
        ? timeline.clips.reduce((s, c) => s + (c.confidence || 0), 0) / timeline.clips.length
        : 0,
      status:         'ai_assembled',
      updated_at:     new Date().toISOString(),
    })
    .eq('id', projectId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

// ─── EXPORT FUNCTIONS ─────────────────────────────────────────────────────────

/**
 * Export timeline as CMX3600 EDL
 * Already working from v3 — this just uses the same builder
 */
function exportEDL(timeline, title) {
  // TODO: Reuse the EDL builder from edlGenerator.js
  // TODO: Handle multi-track properly (V1, V2, A1, A2)

  let edl  = `TITLE: ${title}\nFCM: NON-DROP FRAME\n\n`
  let idx  = 1

  for (const clip of timeline.clips) {
    if (!clip.filepath) continue   // skip placeholders
    const n    = String(idx).padStart(3, '0')
    const reel = clip.filename.replace(/[^a-z0-9_-]/gi, '_').slice(0, 32)

    edl += `${n}  ${reel.padEnd(32)} V     C        `
    edl += `${clip.srcIn} ${clip.srcOut} ${clip.recIn} ${clip.recOut}\n`
    edl += `* FROM CLIP NAME: ${clip.filename}\n`
    if (clip.intentTag) edl += `* LOC: ${clip.intentTag}\n`
    edl += '\n'
    idx++
  }

  return edl
}

/**
 * Export timeline as FCPXML (Final Cut Pro / DaVinci compatible)
 * PLACEHOLDER — Full FCPXML generation is non-trivial
 */
function exportFCPXML(timeline, projectName) {
  // TODO: Build full FCPXML structure
  // TODO: Include proper asset references pointing to local files
  // TODO: Handle multi-track (primary storyline + connected clips)
  // TODO: Include markers for AI flags
  // Reference: https://developer.apple.com/documentation/professional_video_applications/fcpxml_reference

  const placeholder = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <!-- PLACEHOLDER: Full FCPXML export not yet implemented -->
  <!-- Use EDL export for now — fully working -->
  <!-- Project: ${projectName} -->
  <!-- Clips: ${timeline.clips.length} -->
  <!-- Duration: ${Math.round(timeline.durationMs / 1000)}s -->
</fcpxml>`

  return placeholder
}

/**
 * Export timeline as OpenTimelineIO (OTIO) JSON
 * PLACEHOLDER — broad NLE compatibility
 */
function exportOTIO(timeline, projectName) {
  // TODO: Build OTIO JSON schema
  // TODO: Include track structure, clips, gaps, markers
  // Reference: https://opentimelineio.readthedocs.io/

  return JSON.stringify({
    OTIO_SCHEMA: 'Timeline.1',
    name:        projectName,
    // PLACEHOLDER — full OTIO structure not yet implemented
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [],
    },
    metadata: {
      ScriptForge: {
        status:     'placeholder',
        clipCount:  timeline.clips.length,
        durationMs: timeline.durationMs,
      }
    }
  }, null, 2)
}

// ─── TIMECODE UTILS ───────────────────────────────────────────────────────────

function msToTC(ms, fps = 25) {
  const totalFrames = Math.round(ms * fps / 1000)
  const ff = totalFrames % fps
  const ss = Math.floor(totalFrames / fps) % 60
  const mm = Math.floor(totalFrames / fps / 60) % 60
  const hh = Math.floor(totalFrames / fps / 3600)
  return [hh, mm, ss, ff].map(n => String(n).padStart(2, '0')).join(':')
}

function tcToMs(tc, fps = 25) {
  const [hh, mm, ss, ff] = tc.split(':').map(Number)
  return ((hh * 3600 + mm * 60 + ss) * fps + ff) * 1000 / fps
}

module.exports = {
  buildTimeline,
  saveTimeline,
  exportEDL,
  exportFCPXML,
  exportOTIO,
  msToTC,
  tcToMs,
}
