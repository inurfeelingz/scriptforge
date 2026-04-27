// backend/src/services/vision/timelineBuilder.js
// Assembles matched clips into a structured virtual timeline.
// The timeline is a JSON object — the source of truth for the editor.
// Export functions convert it to EDL, FCPXML, or OTIO for DaVinci/Resolve/Premiere.

const { supabase } = require('../../utils/supabase')

// ─── BUILD TIMELINE ───────────────────────────────────────────────────────────

function buildTimeline(matchResults, edlClipMap) {
  const timeline = []
  let   recTimeMs = 3600000  // sequence starts at 01:00:00:00

  for (let i = 0; i < matchResults.length; i++) {
    const result = matchResults[i]
    const beat   = result.beat

    if (!result.bestMatch || result.bestMatch.isPlaceholder) {
      const ph = buildPlaceholderClip(beat, recTimeMs)
      timeline.push(ph)
      recTimeMs += ph.durationMs
      continue
    }

    const clip = buildTimelineClip(result, recTimeMs)

    // B-roll overlay: layer on V2 at the same record position as preceding cam clip
    if (beat.clipType === 'broll' && i > 0 && timeline[timeline.length - 1]?.trackIndex === 0) {
      const prev = timeline[timeline.length - 1]
      clip.trackIndex    = 1
      clip.recIn         = prev.recIn
      clip.recOut        = prev.recOut
      clip.durationMs    = prev.durationMs
      clip.isBrollOverlay = true
      timeline.push(clip)
      continue
    }

    timeline.push(clip)
    recTimeMs += clip.durationMs
  }

  const totalDurMs       = recTimeMs - 3600000
  const primaryClips     = timeline.filter(c => !c.isBrollOverlay)
  const approvedCount    = timeline.filter(c => c.approved).length
  const placeholderCount = timeline.filter(c => c.isPlaceholder).length
  const avgConfidence    = primaryClips.filter(c => c.confidence != null)
    .reduce((s, c, _, arr) => arr.length ? s + c.confidence / arr.length : 0, 0)

  const warnings = []
  if (totalDurMs / 60000 < 1)  warnings.push('Timeline under 1 minute — check EDL beat durations')
  if (totalDurMs / 60000 > 30) warnings.push('Timeline over 30 minutes — unusually long, verify beat durations')

  return {
    clips:          timeline,
    durationMs:     totalDurMs,
    trackCount:     2,
    startTC:        '01:00:00:00',
    fps:            25,
    approvedCount,
    placeholderCount,
    avgConfidence:  parseFloat(avgConfidence.toFixed(3)),
    warnings,
  }
}

function buildTimelineClip(matchResult, recTimeMs) {
  const { beat, bestMatch, confidence, warning } = matchResult

  const beatDurMs  = beat.durationEstimateMs || 5000
  const clipDurMs  = bestMatch.duration_ms   || null
  // Trim clip to beat duration; never request frames past end of source file
  const durationMs = clipDurMs ? Math.min(beatDurMs, clipDurMs) : beatDurMs

  const srcIn  = beat.srcIn || '00:00:00:00'
  const srcOut = advanceTc(srcIn, durationMs, 25)

  return {
    id:           crypto.randomUUID?.() || `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    trackIndex:   beat.clipType === 'daw' ? 1 : 0,
    clipId:       bestMatch.id,
    filename:     bestMatch.filename,
    filepath:     bestMatch.filepath,
    srcIn,
    srcOut,
    recIn:        msToTC(recTimeMs,            25),
    recOut:       msToTC(recTimeMs + durationMs, 25),
    durationMs,
    intentTag:    beat.intentTag,
    confidence,
    aiFlag:       warning ? { type: 'low_confidence', message: warning } : null,
    approved:     confidence >= 0.7,
    locked:       false,
    isPlaceholder: false,
  }
}

function buildPlaceholderClip(beat, recTimeMs) {
  const durationMs = beat.durationEstimateMs || 5000
  return {
    id:           crypto.randomUUID?.() || `placeholder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    trackIndex:   beat.clipType === 'daw' ? 1 : 0,
    clipId:       null,
    filename:     null,
    filepath:     null,
    srcIn:        '00:00:00:00',
    srcOut:       msToTC(durationMs, 25),
    recIn:        msToTC(recTimeMs,            25),
    recOut:       msToTC(recTimeMs + durationMs, 25),
    durationMs,
    intentTag:    beat.intentTag,
    confidence:   0,
    aiFlag:       { type: 'no_match', message: `No indexed clip found for: "${beat.intentTag || beat.id}" — assign manually or run footage indexing` },
    approved:     false,
    locked:       false,
    isPlaceholder: true,
  }
}

// ─── SAVE TIMELINE ────────────────────────────────────────────────────────────

async function saveTimeline(projectId, userId, timeline, flags) {
  const { data, error } = await supabase
    .from('editor_projects')
    .update({
      timeline:      timeline.clips,
      duration_ms:   timeline.durationMs,
      ai_draft:      timeline.clips,
      ai_flags:      flags || [],
      ai_confidence: timeline.avgConfidence || 0,
      status:        'ai_assembled',
      updated_at:    new Date().toISOString(),
    })
    .eq('id', projectId)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

// ─── EXPORT: EDL (CMX3600) ────────────────────────────────────────────────────
// Valid CMX3600 EDL importable by DaVinci Resolve, Premiere Pro, Avid.
// Placeholders written as offline reels with LOC comments for NLE visibility.

function exportEDL(timeline, title) {
  const fps = 25
  let edl   = `TITLE: ${sanitiseTitle(title)}\nFCM: NON-DROP FRAME\n\n`
  let idx   = 1

  for (const clip of timeline.clips) {
    const n = String(idx).padStart(3, '0')

    if (clip.isPlaceholder) {
      const reel = `PLACEHOLDER_${String(idx).padStart(3,'0')}`.padEnd(32)
      const dur  = msToTC(clip.durationMs || 5000, fps)
      edl += `${n}  ${reel} V   C        00:00:00:00 ${dur} ${clip.recIn} ${clip.recOut}\n`
      edl += `* FROM CLIP NAME: [UNMATCHED] ${clip.intentTag || 'unknown'}\n`
      edl += `* LOC: 00:00:00:00 RED    ASSIGN CLIP — ${clip.intentTag || ''}\n`
      edl += `* COMMENT: AI could not match this beat. Assign footage manually.\n\n`
    } else {
      const reel = sanitiseReel(clip.filename)
      edl += `${n}  ${reel} V   C        ${clip.srcIn} ${clip.srcOut} ${clip.recIn} ${clip.recOut}\n`
      edl += `* FROM CLIP NAME: ${clip.filename}\n`
      if (clip.filepath)  edl += `* SOURCE FILE: ${clip.filepath}\n`
      if (clip.intentTag) edl += `* LOC: ${clip.recIn} WHITE  ${clip.intentTag}\n`
      if (!clip.approved) edl += `* COMMENT: AI confidence ${clip.confidence ? Math.round(clip.confidence * 100) : 0}% — review before export\n`
      edl += '\n'
    }
    idx++
  }

  return edl
}

// ─── EXPORT: FCPXML 1.10 ──────────────────────────────────────────────────────
// Compatible with DaVinci Resolve 18+, Final Cut Pro 10.6+.
// Primary clips on the spine (V1). B-roll overlays as connected clips (lane 1).
// Placeholders become gap elements with a title overlay showing the intent.

function exportFCPXML(timeline, projectName) {
  const fps = 25

  // Build asset registry — one <asset> per unique source file
  const assetMap = new Map()
  let   assetIdx = 1
  for (const clip of timeline.clips) {
    if (clip.filepath && !assetMap.has(clip.filepath)) {
      assetMap.set(clip.filepath, {
        id:       `r${assetIdx}`,
        name:     clip.filename || `asset-${assetIdx}`,
        filepath: clip.filepath,
      })
      assetIdx++
    }
  }

  // Separate primary spine clips from broll overlays
  const spineClips   = timeline.clips.filter(c => !c.isBrollOverlay)
  const overlayClips = timeline.clips.filter(c => c.isBrollOverlay)

  const spineItems = spineClips.map(clip => {
    const recStartMs = tcToMs(clip.recIn) - 3600000
    const offset     = msToFcpDur(recStartMs, fps)
    const duration   = msToFcpDur(clip.durationMs, fps)

    if (clip.isPlaceholder) {
      return [
        `      <gap name="${escXml(clip.intentTag || 'Unassigned')}" offset="${offset}" duration="${duration}" start="0s">`,
        `        <title lane="1" offset="0s" ref="r-title" duration="${duration}" start="0s">`,
        `          <param name="Text" key="9999/999166631/999166633/2/354/999169573" value="${escXml(clip.intentTag || 'Assign clip')}"/>`,
        `        </title>`,
        `      </gap>`,
      ].join('\n')
    }

    const asset  = assetMap.get(clip.filepath)
    if (!asset) return ''
    const start  = msToFcpDur(tcToMs(clip.srcIn), fps)

    // Any broll overlay that starts at the same position becomes a connected clip
    const overlays = overlayClips
      .filter(o => o.recIn === clip.recIn && assetMap.has(o.filepath))
      .map(o => {
        const oa = assetMap.get(o.filepath)
        return `        <clip name="${escXml(o.filename)}" ref="${oa.id}" lane="1" offset="0s" duration="${msToFcpDur(o.durationMs, fps)}" start="${msToFcpDur(tcToMs(o.srcIn), fps)}"/>`
      })
      .join('\n')

    return [
      `      <clip name="${escXml(clip.filename)}" ref="${asset.id}" offset="${offset}" duration="${duration}" start="${start}">`,
      clip.intentTag ? `        <note>${escXml(clip.intentTag)}</note>` : '',
      overlays,
      `      </clip>`,
    ].filter(Boolean).join('\n')
  }).filter(Boolean)

  const assetsXml = [...assetMap.values()].map(a =>
    `    <asset id="${a.id}" name="${escXml(a.name)}" src="file://${escXml(a.filepath)}" start="0s" duration="0s" hasVideo="1" hasAudio="1"/>`
  ).join('\n')

  const totalDurMs = spineClips.reduce((s, c) => s + (c.durationMs || 0), 0)

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r0" name="FFVideoFormat${fps}p" frameDuration="${fps === 25 ? '100/2500s' : '100/3000s'}" width="1920" height="1080"/>
    <effect id="r-title" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>
${assetsXml}
  </resources>
  <library>
    <event name="${escXml(projectName)}">
      <project name="${escXml(projectName)}">
        <sequence duration="${msToFcpDur(totalDurMs, fps)}" format="r0" tcStart="01:00:00:00" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spineItems.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`
}

// ─── EXPORT: OTIO (OpenTimelineIO) ────────────────────────────────────────────
// Valid OTIO JSON (schema 0.14.1). Compatible with DaVinci Resolve 19+,
// Flame, Nuke, and any tool with the OpenTimelineIO Python SDK.
// Two tracks: V1 for primary cam/daw clips, V2 for broll overlays.

function exportOTIO(timeline, projectName) {
  const fps = 25

  const v1Clips = timeline.clips.filter(c => !c.isBrollOverlay)
  const v2Clips = timeline.clips.filter(c =>  c.isBrollOverlay)

  function buildItem(clip) {
    const durFrames = Math.round((clip.durationMs || 0) * fps / 1000)

    if (clip.isPlaceholder) {
      return {
        OTIO_SCHEMA: 'Gap.2',
        name: clip.intentTag || 'Unassigned',
        source_range: {
          OTIO_SCHEMA: 'TimeRange.1',
          start_time:  { OTIO_SCHEMA: 'RationalTime.1', value: 0,         rate: fps },
          duration:    { OTIO_SCHEMA: 'RationalTime.1', value: durFrames,  rate: fps },
        },
        metadata: {
          WhispaCuts: { intentTag: clip.intentTag || '', aiFlag: clip.aiFlag?.message || 'no match found' }
        }
      }
    }

    const srcFrames = tcToFrames(clip.srcIn, fps)
    return {
      OTIO_SCHEMA: 'Clip.2',
      name: clip.filename,
      source_range: {
        OTIO_SCHEMA: 'TimeRange.1',
        start_time:  { OTIO_SCHEMA: 'RationalTime.1', value: srcFrames,  rate: fps },
        duration:    { OTIO_SCHEMA: 'RationalTime.1', value: durFrames,  rate: fps },
      },
      media_reference: {
        OTIO_SCHEMA:  'ExternalReference.1',
        target_url:   clip.filepath ? `file://${clip.filepath}` : '',
        available_range: null,
        metadata:     {},
      },
      metadata: {
        WhispaCuts: {
          intentTag:  clip.intentTag  || '',
          confidence: clip.confidence || 0,
          approved:   clip.approved   || false,
          clipId:     clip.clipId     || null,
        }
      }
    }
  }

  const totalDurMs = v1Clips.reduce((s, c) => s + (c.durationMs || 0), 0)

  return JSON.stringify({
    OTIO_SCHEMA: 'Timeline.1',
    name:        projectName,
    global_start_time: null,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name:        '',
      children: [
        { OTIO_SCHEMA: 'Track.1', name: 'V1', kind: 'Video', children: v1Clips.map(buildItem), metadata: {} },
        ...(v2Clips.length
          ? [{ OTIO_SCHEMA: 'Track.1', name: 'V2', kind: 'Video', children: v2Clips.map(buildItem), metadata: {} }]
          : [])
      ],
      metadata: {
        WhispaCuts: {
          totalDurationMs: totalDurMs,
          generatedAt:     new Date().toISOString(),
          clipCount:       timeline.clips.length,
          avgConfidence:   timeline.avgConfidence || 0,
        }
      }
    }
  }, null, 2)
}

// ─── TIMECODE UTILITIES ───────────────────────────────────────────────────────

function msToTC(ms, fps = 25) {
  const totalFrames = Math.round(ms * fps / 1000)
  const ff = totalFrames % fps
  const ss = Math.floor(totalFrames / fps) % 60
  const mm = Math.floor(totalFrames / fps / 60) % 60
  const hh = Math.floor(totalFrames / fps / 3600)
  return [hh, mm, ss, ff].map(n => String(n).padStart(2, '0')).join(':')
}

function tcToMs(tc, fps = 25) {
  if (!tc) return 0
  const [hh, mm, ss, ff] = String(tc).split(':').map(Number)
  return ((hh * 3600 + mm * 60 + ss) * fps + (ff || 0)) * 1000 / fps
}

function tcToFrames(tc, fps = 25) {
  if (!tc) return 0
  const [hh, mm, ss, ff] = String(tc).split(':').map(Number)
  return (hh * 3600 + mm * 60 + ss) * fps + (ff || 0)
}

function advanceTc(tc, durationMs, fps = 25) {
  return msToTC(tcToMs(tc, fps) + durationMs, fps)
}

function msToFcpDur(ms, fps = 25) {
  const frames = Math.round(ms * fps / 1000)
  return `${frames * 1000}/${fps * 1000}s`
}

// ─── STRING UTILITIES ─────────────────────────────────────────────────────────

function sanitiseReel(filename) {
  if (!filename) return 'AX'.padEnd(32)
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 32)
    .padEnd(32)
}

function sanitiseTitle(title) {
  return (title || 'Untitled').replace(/[^\x20-\x7E]/g, '_').slice(0, 64)
}

function escXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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