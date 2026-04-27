// frontend/src/components/editor/HybridTimeline.jsx
// The hybrid timeline — AI assembled draft with human approval controls.
// Assembly: pulls the episode EDL + indexed clip vectors, calls /api/editor/projects/:id/assemble
// Integrated: retention heatmap, continuity scoring, VO alignment trigger.

import { useState, useEffect } from 'react'
import {
  Sparkles, AlertTriangle, Check, RefreshCw,
  ChevronDown, ChevronUp, Zap, AlignCenter, Upload,
} from 'lucide-react'
import { useStore } from '../../store'
import { api, episodes as episodesApi } from '../../lib/api'
import { getSession } from '../../lib/supabase'
import RetentionHeatmap  from './RetentionHeatmap'
import ContinuityReport  from './ContinuityReport'

export default function HybridTimeline({ project, onProjectUpdate }) {
  const { activeCategoryId, notify } = useStore()
  const [assembling,  setAssembling]  = useState(false)
  const [aligning,    setAligning]    = useState(false)
  const [scoring,     setScoring]     = useState(false)
  const [showFlags,   setShowFlags]   = useState(true)
  const [continuity,  setContinuity]  = useState(null)
  const [energy,      setEnergy]      = useState(null)
  const [episodes,    setEpisodes]    = useState([])
  const [selectedEpId, setSelectedEpId] = useState(project?.episode_id || '')
  const [voFile,      setVoFile]      = useState(null)
  const [alignModalOpen, setAlignModal] = useState(false)

  const timeline   = project?.timeline || []
  const flags      = project?.ai_flags  || []
  const confidence = project?.ai_confidence ? Math.round(project.ai_confidence * 100) : 0

  // Load episodes for this category so user can pick which one to assemble
  useEffect(() => {
    if (!activeCategoryId) return
    episodesApi.list({ categoryId: activeCategoryId, status: 'ready', limit: 30 })
      .then(({ episodes: eps }) => setEpisodes(eps || []))
      .catch(console.warn)
  }, [activeCategoryId])

  // ── AI assemble ───────────────────────────────────────────────────────────
  // Fetches the EDL clip map from the selected episode, then calls the backend
  // to match each beat to an indexed clip using semantic search.

  async function runAssembly() {
    if (!selectedEpId) {
      return notify('Select an episode first — its EDL is used to drive assembly', 'error')
    }
    if (!project?.id) return notify('No project selected', 'error')

    setAssembling(true)
    notify('Assembling timeline — matching EDL beats to your indexed footage…', 'info', 6000)

    try {
      // Fetch full episode to get the EDL clip map
      const { episode } = await episodesApi.get(selectedEpId)
      if (!episode?.edl_clip_map) {
        return notify('This episode has no EDL — generate the episode first', 'error')
      }

      // Call assembly endpoint — backend runs visionMatcher against clip_index
      const result = await api.post(`/editor/projects/${project.id}/assemble`, {
        edlClipMap:  episode.edl_clip_map,
        beatVectors: [],  // vectors are computed server-side from clip_index
      })

      onProjectUpdate(result.project)

      const { matchSummary } = result
      notify(
        `Assembly complete — ${matchSummary.matched}/${matchSummary.totalBeats} beats matched (${Math.round((matchSummary.avgConfidence || 0) * 100)}% avg confidence)`,
        matchSummary.flagCount > 0 ? 'info' : 'success'
      )
    } catch (err) {
      notify('Assembly failed: ' + err.message, 'error')
    }

    setAssembling(false)
  }

  // ── Approve clip ──────────────────────────────────────────────────────────

  async function approveClip(clipId) {
    const updated = timeline.map(c => c.id === clipId ? { ...c, approved: true } : c)
    try {
      const { project: p } = await api.patch(`/editor/projects/${project.id}/timeline`, { timeline: updated })
      onProjectUpdate(p)
    } catch (err) { notify(err.message, 'error') }
  }

  // ── Approve all clips above threshold ─────────────────────────────────────

  async function approveAll() {
    const updated = timeline.map(c => c.confidence >= 0.6 ? { ...c, approved: true } : c)
    try {
      const { project: p } = await api.patch(`/editor/projects/${project.id}/timeline`, { timeline: updated })
      onProjectUpdate(p)
      const count = updated.filter(c => c.approved).length - timeline.filter(c => c.approved).length
      notify(`Approved ${count} clips with ≥60% confidence`, 'success')
    } catch (err) { notify(err.message, 'error') }
  }

  // ── Continuity score ──────────────────────────────────────────────────────

  async function runContinuityScore() {
    if (!timeline.length) return notify('Assemble a timeline first', 'error')
    setScoring(true)
    try {
      // Attach VO script from the linked episode if available
      let voScript = ''
      if (project?.episode_id) {
        const { episode } = await episodesApi.get(project.episode_id).catch(() => ({ episode: null }))
        voScript = episode?.vo_script || ''
      }

      const result = await api.post(`/editor/projects/${project.id}/continuity`, {
        voScript,
        trackContext: project.track_context || {},
      })
      setContinuity(result.continuity)
      setEnergy(result.energy)
      notify(`Continuity score: ${result.continuity?.score ?? '?'}/100 — ${result.continuity?.overallVerdict || ''}`, 'info', 6000)
    } catch (err) {
      notify('Scoring failed: ' + err.message, 'error')
    }
    setScoring(false)
  }

  // ── VO alignment ──────────────────────────────────────────────────────────
  // User records VO separately, uploads the audio file here.
  // The backend runs Whisper word-level timestamps and realigns the timeline.

  async function runAlignment() {
    if (!voFile) return setAlignModal(true)
    if (!timeline.length) return notify('Assemble a timeline first', 'error')

    setAligning(true)
    notify('Uploading VO and running Whisper alignment…', 'info', 5000)

    try {
      const session = await getSession()
      const formData = new FormData()
      formData.append('audio', voFile, voFile.name)

      // Transcribe with Whisper word timestamps
      const transcribeRes = await fetch(
        `${import.meta.env.VITE_API_URL || '/api'}/session/standalone/transcribe`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
          body:    formData,
        }
      )

      if (!transcribeRes.ok) throw new Error('Whisper transcription failed')
      const { whisperOutput } = await transcribeRes.json()

      // Align timeline to word timestamps
      const result = await api.post(`/editor/projects/${project.id}/align`, {
        whisperOutput,
        fps: 25,
      })

      onProjectUpdate({ ...project, timeline: result.timeline })
      notify(
        `Aligned ${result.aligned} clips to VO words (${result.wordCount} words detected)`,
        'success'
      )
      setAlignModal(false)
      setVoFile(null)
    } catch (err) {
      notify('VO alignment failed: ' + err.message, 'error')
    }

    setAligning(false)
  }

  const pendingFlags  = flags.filter(f => f.type === 'low_confidence' || f.type === 'no_match')
  const approvedCount = timeline.filter(c => c.approved).length

  return (
    <div className="space-y-4">

      {/* Episode selector — shown when no timeline yet, or always for re-assemble */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedEpId}
          onChange={e => setSelectedEpId(e.target.value)}
          className="bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2 text-sm text-[#ddd] outline-none focus:border-[#c8b89a]/40 flex-1 max-w-xs"
        >
          <option value="">Select episode to assemble…</option>
          {episodes.map(ep => (
            <option key={ep.id} value={ep.id}>
              Ep {ep.episode_number}: {ep.track_name}
            </option>
          ))}
        </select>

        {/* Controls */}
        <div className="flex gap-2 ml-auto flex-wrap">
          {timeline.length > 0 && (
            <>
              <button
                onClick={approveAll}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1a2a1a] rounded text-xs text-[#40a060] hover:bg-[#40a060]/10 transition-all"
              >
                <Check size={11}/> Approve ≥60%
              </button>
              <button
                onClick={runContinuityScore}
                disabled={scoring}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1a1a1a] rounded text-xs text-[#555] hover:text-[#c8b89a] hover:border-[#c8b89a]/20 disabled:opacity-40 transition-all"
              >
                {scoring ? <RefreshCw size={11} className="animate-spin"/> : <Sparkles size={11}/>}
                Score continuity
              </button>
              <button
                onClick={() => setAlignModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1a1a1a] rounded text-xs text-[#555] hover:text-[#c8b89a] hover:border-[#c8b89a]/20 transition-all"
              >
                <AlignCenter size={11}/> Align to VO
              </button>
            </>
          )}
          <button
            onClick={runAssembly}
            disabled={assembling || !selectedEpId}
            className="flex items-center gap-2 px-4 py-1.5 bg-[#c8b89a]/10 border border-[#c8b89a]/20 text-[#c8b89a] rounded text-sm hover:bg-[#c8b89a]/20 disabled:opacity-40 transition-all"
          >
            {assembling
              ? <RefreshCw size={13} className="animate-spin"/>
              : <Sparkles size={13}/>}
            {timeline.length ? 'Re-assemble' : 'AI assemble'}
          </button>
        </div>
      </div>

      {/* Confidence / stats strip */}
      {timeline.length > 0 && (
        <div className="text-xs text-[#555]">
          {timeline.length} clips · {approvedCount} approved · {confidence}% avg confidence
        </div>
      )}

      {/* Retention heatmap */}
      <RetentionHeatmap projectDurationMs={project?.duration_ms || 600000} />

      {/* VO alignment modal */}
      {alignModalOpen && (
        <div className="border border-[#1a1a1a] rounded p-5 space-y-4 bg-[#0a0a0a]">
          <div className="text-sm text-[#888]">Upload your recorded VO audio for word-level alignment</div>
          <div className="text-xs text-[#444]">
            Record your voiceover (from the Teleprompter page), export as MP3/WAV, then upload here.
            Whisper maps every word to a timecode and repositions clips to land on the words they illustrate.
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 px-4 py-2 border border-[#1a1a1a] rounded text-sm text-[#666] hover:border-[#333] hover:text-[#aaa] cursor-pointer transition-all">
              <Upload size={13}/> {voFile ? voFile.name : 'Choose audio file'}
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={e => setVoFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              onClick={runAlignment}
              disabled={!voFile || aligning}
              className="flex items-center gap-2 px-4 py-2 bg-[#c8b89a]/10 border border-[#c8b89a]/20 text-[#c8b89a] rounded text-sm hover:bg-[#c8b89a]/20 disabled:opacity-40 transition-all"
            >
              {aligning ? <RefreshCw size={13} className="animate-spin"/> : <AlignCenter size={13}/>}
              {aligning ? 'Aligning…' : 'Run alignment'}
            </button>
            <button onClick={() => { setAlignModal(false); setVoFile(null) }} className="text-xs text-[#444] hover:text-[#888]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!timeline.length && (
        <div className="border border-dashed border-[#222] rounded p-10 text-center space-y-3">
          <Sparkles size={24} className="mx-auto text-[#333]"/>
          <div className="text-sm text-[#555]">
            Select an episode above, then click AI assemble
          </div>
          <div className="text-xs text-[#444]">Requirements: episode generated (with EDL) + footage indexed</div>
        </div>
      )}

      {/* AI flags */}
      {pendingFlags.length > 0 && (
        <div className="border border-[#2a2000] rounded overflow-hidden">
          <button
            onClick={() => setShowFlags(f => !f)}
            className="w-full flex items-center justify-between px-4 py-2.5 bg-[#1a1200] text-xs text-[#c8a030] hover:bg-[#1e1500] transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={12}/>
              {pendingFlags.length} clips need review
            </div>
            {showFlags ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
          </button>
          {showFlags && (
            <div className="divide-y divide-[#1a1a1a]">
              {pendingFlags.slice(0, 8).map((flag, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-[#888]">Beat {(flag.beatIndex || 0) + 1}</span>
                    <span className="text-[#555] ml-2">{flag.reason}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded border text-[10px] ${
                    flag.type === 'no_match'
                      ? 'border-red-800/40 text-red-400'
                      : 'border-[#c8a030]/30 text-[#c8a030]'
                  }`}>{flag.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Timeline clips */}
      {timeline.length > 0 && (
        <div className="space-y-1.5">
          {timeline.map((clip, i) => (
            <TimelineClip
              key={clip.id || i}
              clip={clip}
              index={i}
              onApprove={() => approveClip(clip.id)}
            />
          ))}
        </div>
      )}

      {/* Continuity report */}
      {continuity && (
        <ContinuityReport report={continuity} />
      )}

      {/* Energy arc issues */}
      {energy?.issues?.length > 0 && (
        <div className="border border-[#1a1a1a] rounded p-4 space-y-2">
          <div className="text-xs text-[#555] uppercase tracking-wide flex items-center gap-2">
            <Zap size={11} className="text-[#c8a030]"/>
            Pacing issues ({energy.issues.length})
          </div>
          {energy.issues.map((issue, i) => (
            <div key={i} className="text-xs text-[#555]">{issue.description}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelineClip({ clip, index, onApprove }) {
  const trackLabel = clip.trackIndex === 1 ? 'DAW' : clip.trackIndex === 2 ? 'VO' : 'CAM'
  const trackColor = clip.trackIndex === 1 ? '#4080c8' : '#c8b89a'
  const confPct    = clip.confidence ? Math.round(clip.confidence * 100) : 0

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border rounded transition-all ${
      clip.isPlaceholder ? 'border-[#2a1500] bg-[#100a00]' :
      clip.isBrollOverlay ? 'border-[#1a1a2a] bg-[#0a0a0f] ml-6' :
      clip.approved       ? 'border-[#1a2a1a] bg-[#0a0f0a]' :
      clip.aiFlag         ? 'border-[#2a2000] bg-[#0f0d00]' :
      'border-[#111] hover:border-[#1e1e1e]'
    }`}>
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
        style={{ border: `1px solid ${trackColor}30`, color: trackColor }}>
        {clip.isBrollOverlay ? 'BROLL' : trackLabel}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#aaa] truncate">
          {clip.isPlaceholder ? `[No match] ${clip.intentTag}` : clip.filename}
        </div>
        {clip.intentTag && !clip.isPlaceholder && (
          <div className="text-[10px] text-[#444] mt-0.5 truncate">{clip.intentTag}</div>
        )}
        {clip.alignedToWord && (
          <div className="text-[10px] text-[#40a060] mt-0.5">aligned → "{clip.alignedToWord}"</div>
        )}
      </div>
      <span className="text-[10px] text-[#444] shrink-0 font-mono">{clip.recIn}</span>
      {!clip.isPlaceholder && (
        <div className={`text-[10px] shrink-0 ${confPct >= 70 ? 'text-[#40a060]' : confPct >= 40 ? 'text-[#c8a030]' : 'text-red-400'}`}>
          {confPct}%
        </div>
      )}
      {!clip.approved && !clip.isPlaceholder && (
        <button onClick={onApprove}
          className="p-1.5 rounded border border-[#1a2a1a] text-[#40a060] hover:bg-[#40a060]/10 transition-all shrink-0">
          <Check size={11}/>
        </button>
      )}
      {clip.approved && <Check size={12} className="text-[#40a060] m-1.5 shrink-0"/>}
    </div>
  )
}