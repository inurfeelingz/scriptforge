// frontend/src/components/editor/HybridTimeline.jsx
// The hybrid timeline — AI assembled draft with human approval controls.
// Integrated: retention heatmap, continuity scoring, VO alignment trigger.

import { useState } from 'react'
import {
  Sparkles, AlertTriangle, Check, RefreshCw,
  ChevronDown, ChevronUp, Zap, AlignCenter
} from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../lib/api'
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

  const timeline   = project?.timeline || []
  const flags      = project?.ai_flags  || []
  const confidence = project?.ai_confidence ? Math.round(project.ai_confidence * 100) : 0

  // ── AI assemble ───────────────────────────────────────────────────────────

  async function runAssembly() {
    setAssembling(true)
    notify('Assembly requires the episode EDL — generate an episode first, then assemble', 'info', 5000)
    await new Promise(r => setTimeout(r, 1500))
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

  // ── Request swap ──────────────────────────────────────────────────────────

  async function requestSwap(clipIndex) {
    notify('Semantic swap — click a clip to get alternatives', 'info')
  }

  // ── Run continuity score ──────────────────────────────────────────────────

  async function runContinuityScore() {
    if (!timeline.length) return notify('Assemble a timeline first', 'error')
    setScoring(true)
    try {
      const result = await api.post(`/editor/projects/${project.id}/continuity`, {
        voScript:     project.vo_script || '',
        trackContext: project.track_context || {},
      })
      setContinuity(result.continuity)
      setEnergy(result.energy)
      notify(`Continuity score: ${result.continuity?.score ?? '?'}/100`, 'info')
    } catch (err) {
      notify('Scoring failed: ' + err.message, 'error')
    }
    setScoring(false)
  }

  // ── Run VO alignment ──────────────────────────────────────────────────────

  async function runAlignment() {
    notify('VO alignment: upload your recorded VO audio file after recording', 'info', 5000)
    setAligning(false)
  }

  const pendingFlags  = flags.filter(f => f.type === 'low_confidence' || f.type === 'no_match')
  const approvedCount = timeline.filter(c => c.approved).length

  return (
    <div className="space-y-4">

      {/* Controls row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-[#666]">
          {timeline.length
            ? `${timeline.length} clips · ${approvedCount} approved · ${confidence}% confidence`
            : 'No timeline assembled yet'
          }
        </div>
        <div className="flex gap-2">
          {timeline.length > 0 && (
            <>
              <button
                onClick={runContinuityScore}
                disabled={scoring}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1a1a1a] rounded text-xs text-[#555] hover:text-[#c8b89a] hover:border-[#c8b89a]/20 disabled:opacity-40 transition-all"
              >
                {scoring
                  ? <RefreshCw size={11} className="animate-spin"/>
                  : <Sparkles size={11}/>}
                Score continuity
              </button>
              <button
                onClick={runAlignment}
                disabled={aligning}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#1a1a1a] rounded text-xs text-[#555] hover:text-[#c8b89a] hover:border-[#c8b89a]/20 disabled:opacity-40 transition-all"
              >
                <AlignCenter size={11}/>
                Align to VO
              </button>
            </>
          )}
          <button
            onClick={runAssembly}
            disabled={assembling}
            className="flex items-center gap-2 px-4 py-1.5 bg-[#c8b89a]/10 border border-[#c8b89a]/20 text-[#c8b89a] rounded text-sm hover:bg-[#c8b89a]/20 disabled:opacity-40 transition-all"
          >
            {assembling
              ? <RefreshCw size={13} className="animate-spin"/>
              : <Sparkles size={13}/>}
            {timeline.length ? 'Re-assemble' : 'AI assemble'}
          </button>
        </div>
      </div>

      {/* Retention heatmap */}
      <RetentionHeatmap projectDurationMs={project?.duration_ms || 600000} />

      {/* Empty state */}
      {!timeline.length && (
        <div className="border border-dashed border-[#222] rounded p-10 text-center space-y-3">
          <Sparkles size={24} className="mx-auto text-[#333]"/>
          <div className="text-sm text-[#555]">AI assembles your timeline from the episode EDL and indexed footage</div>
          <div className="text-xs text-[#444]">Requirements: episode generated + footage indexed</div>
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
              {pendingFlags.slice(0, 5).map((flag, i) => (
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
              onSwap={() => requestSwap(i)}
            />
          ))}
        </div>
      )}

      {/* Continuity report */}
      {continuity && (
        <ContinuityReport
          report={continuity}
          onSwapRequest={requestSwap}
        />
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

function TimelineClip({ clip, index, onApprove, onSwap }) {
  const trackLabel = clip.trackIndex === 1 ? 'DAW' : clip.trackIndex === 2 ? 'VO' : 'CAM'
  const trackColor = clip.trackIndex === 1 ? '#4080c8' : '#c8b89a'
  const confPct    = clip.confidence ? Math.round(clip.confidence * 100) : 0

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border rounded transition-all ${
      clip.isPlaceholder ? 'border-[#2a1500] bg-[#100a00]' :
      clip.approved       ? 'border-[#1a2a1a] bg-[#0a0f0a]' :
      clip.aiFlag         ? 'border-[#2a2000] bg-[#0f0d00]' :
      'border-[#111] hover:border-[#1e1e1e]'
    }`}>
      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
        style={{ border: `1px solid ${trackColor}30`, color: trackColor }}>
        {trackLabel}
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
      <span className="text-[10px] text-[#444] shrink-0 font-mono">{clip.srcIn} → {clip.srcOut}</span>
      {!clip.isPlaceholder && (
        <div className={`text-[10px] shrink-0 ${confPct >= 70 ? 'text-[#40a060]' : confPct >= 40 ? 'text-[#c8a030]' : 'text-red-400'}`}>
          {confPct}%
        </div>
      )}
      <div className="flex gap-1 shrink-0">
        {!clip.approved && !clip.isPlaceholder && (
          <button onClick={onApprove}
            className="p-1.5 rounded border border-[#1a2a1a] text-[#40a060] hover:bg-[#40a060]/10 transition-all">
            <Check size={11}/>
          </button>
        )}
        {clip.approved && <Check size={12} className="text-[#40a060] m-1.5"/>}
        <button onClick={onSwap}
          className="p-1.5 rounded border border-[#1a1a1a] text-[#555] hover:text-[#c8b89a] hover:border-[#c8b89a]/20 transition-all text-[10px]">
          swap
        </button>
      </div>
    </div>
  )
}
