// frontend/src/components/editor/RetentionHeatmap.jsx
// Overlays the retention curve from past top episodes onto the timeline.
// Shows you: at 2:30 your audience typically drops — so this cut matters.

import { useState, useEffect } from 'react'
import { TrendingDown, TrendingUp, Info } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'

export default function RetentionHeatmap({ projectDurationMs = 600000 }) {
  const { activeCategoryId } = useStore()
  const [template, setTemplate] = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!activeCategoryId) return
    setLoading(true)
    api.post('/editor/retention-template', { categoryId: activeCategoryId })
      .then(({ template: t }) => { setTemplate(t); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activeCategoryId])

  if (loading) return (
    <div className="h-12 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
  )

  if (!template?.available) return (
    <div className="flex items-center gap-2 text-xs text-[#333] border border-dashed border-[#1a1a1a] rounded px-3 py-2">
      <Info size={12}/>
      Retention heatmap available after 3+ episodes with analytics uploaded
    </div>
  )

  const { consensusDropTimes = [], consensusRecoveries = [], analysis } = template
  const durationSec = projectDurationMs / 1000

  // Convert to percentage positions for the heatmap bar
  const drops     = consensusDropTimes.map(d => ({ ...d, pct: (d.timeSeconds / durationSec) * 100 }))
  const recoveries = consensusRecoveries.map(r => ({ ...r, pct: (r.timeSeconds / durationSec) * 100 }))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-[#666]">
          <div className="w-2 h-2 rounded-full bg-red-500/60"/>
          <span>Drop zones</span>
          <div className="w-2 h-2 rounded-full bg-[#40a060]/60 ml-2"/>
          <span>Recovery points</span>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-[10px] text-[#444] hover:text-[#888] transition-colors"
        >
          {expanded ? 'Less' : 'Details'}
        </button>
      </div>

      {/* Heatmap bar */}
      <div className="relative h-8 bg-[#0d0d0d] border border-[#1a1a1a] rounded overflow-hidden">
        {/* Drop zones */}
        {drops.map((d, i) => (
          <div
            key={`drop-${i}`}
            title={`Drop zone: ~${d.timeSeconds}s (seen in ${d.count} episodes)`}
            className="absolute top-0 h-full w-3 bg-red-500/30 border-l border-red-500/50"
            style={{ left: `${Math.min(d.pct, 97)}%` }}
          />
        ))}
        {/* Recovery points */}
        {recoveries.map((r, i) => (
          <div
            key={`rec-${i}`}
            title={`Recovery: ~${r.timeSeconds}s (seen in ${r.count} episodes)`}
            className="absolute top-0 h-full w-3 bg-[#40a060]/30 border-l border-[#40a060]/50"
            style={{ left: `${Math.min(r.pct, 97)}%` }}
          />
        ))}
        {/* Time markers */}
        {[0.25, 0.5, 0.75].map(p => (
          <div
            key={p}
            className="absolute top-0 h-full border-l border-[#222]"
            style={{ left: `${p * 100}%` }}
          >
            <span className="absolute bottom-0.5 left-1 text-[9px] text-[#333]">
              {Math.round(durationSec * p / 60)}m
            </span>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      {expanded && analysis?.recommendations?.length > 0 && (
        <div className="space-y-2 border border-[#1a1a1a] rounded p-3">
          <div className="text-xs text-[#666] uppercase tracking-wide">Cut timing recommendations</div>
          {analysis.recommendations.slice(0, 4).map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <TrendingUp size={11} className="text-[#40a060] mt-0.5 shrink-0"/>
              <div>
                <span className="text-[#c8b89a] font-mono">~{r.timeSeconds}s</span>
                <span className="text-[#555] ml-2">{r.action}</span>
                <div className="text-[#444] mt-0.5">{r.reason}</div>
              </div>
            </div>
          ))}
          {analysis.dangerZones?.length > 0 && (
            <>
              <div className="text-xs text-[#666] uppercase tracking-wide mt-2">Danger zones</div>
              {analysis.dangerZones.map((d, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <TrendingDown size={11} className="text-red-400 mt-0.5 shrink-0"/>
                  <div>
                    <span className="text-red-400 font-mono">~{d.timeSeconds}s</span>
                    <span className="text-[#555] ml-2">{d.warning}</span>
                  </div>
                </div>
              ))}
            </>
          )}
          {analysis.overallPattern && (
            <div className="text-xs text-[#444] border-t border-[#111] pt-2 mt-2">{analysis.overallPattern}</div>
          )}
        </div>
      )}
    </div>
  )
}
