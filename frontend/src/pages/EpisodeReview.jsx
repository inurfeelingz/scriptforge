// frontend/src/pages/EpisodeReview.jsx
// Batch 4 — improvement 10:
// Retention curve overlaid on the VO script.
// Each script line is colour-coded by the audience retention at that timecode.
// Green = held, amber = dip, red = drop. Patterns become visible across episodes.
//
// Accessed from: AnalyticsPage → episode row → "Review" button
// Route: /analytics/review/:episodeId

import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, TrendingDown, TrendingUp, Info, Upload } from 'lucide-react'
import { useStore } from '../store'
import { analytics as analyticsApi } from '../lib/api'

// ── Retention colour helpers ──────────────────────────────────────────────────

function retentionColor(pct) {
  if (pct === null || pct === undefined) return { bg: 'transparent', text: '#555', border: 'transparent' }
  if (pct >= 70) return { bg: 'rgba(64,160,96,0.10)', text: '#40a060', border: 'rgba(64,160,96,0.25)' }
  if (pct >= 50) return { bg: 'rgba(200,160,48,0.10)', text: '#c8a030', border: 'rgba(200,160,48,0.25)' }
  if (pct >= 35) return { bg: 'rgba(224,120,48,0.10)', text: '#e07830', border: 'rgba(224,120,48,0.25)' }
  return         { bg: 'rgba(224,80,80,0.10)',  text: '#e05050', border: 'rgba(224,80,80,0.25)'  }
}

function retentionLabel(pct) {
  if (pct === null || pct === undefined) return null
  if (pct >= 70) return 'strong'
  if (pct >= 50) return 'holding'
  if (pct >= 35) return 'dipping'
  return 'drop'
}

// ── Get retention value at a given second from the curve map ──────────────────

function getRetentionAt(curve, targetSec) {
  if (!curve || !Object.keys(curve).length) return null
  const keys   = Object.keys(curve).map(Number).sort((a, b) => a - b)
  // Find closest key
  const closest = keys.reduce((prev, curr) =>
    Math.abs(curr - targetSec) < Math.abs(prev - targetSec) ? curr : prev
  )
  return curve[closest] ?? null
}

// ── Script line with retention overlay ───────────────────────────────────────

function ScriptLine({ line, retentionPct, isDropZone, isRecovery }) {
  const colors  = retentionColor(retentionPct)
  const label   = retentionLabel(retentionPct)

  if (line.isHint) {
    return (
      <div className="text-[11px] font-mono text-[#333] py-0.5 px-2">
        {line.text}
      </div>
    )
  }

  return (
    <div
      className="group relative flex gap-3 px-3 py-2.5 rounded transition-all"
      style={{
        background:   retentionPct !== null ? colors.bg   : 'transparent',
        borderLeft:   retentionPct !== null ? `2px solid ${colors.border}` : '2px solid transparent',
      }}
    >
      {/* Timecode */}
      <div className="flex flex-col items-end shrink-0 w-14 pt-0.5">
        <span className="text-[10px] font-mono text-[#444]">
          {formatSec(line.startSec)}
        </span>
        {retentionPct !== null && (
          <span className="text-[10px] font-semibold mt-0.5" style={{ color: colors.text }}>
            {Math.round(retentionPct)}%
          </span>
        )}
      </div>

      {/* Script text */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#ccc] leading-relaxed">{line.text}</p>

        {/* Inline labels */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {isDropZone && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <TrendingDown size={9}/> Drop zone
            </span>
          )}
          {isRecovery && (
            <span className="flex items-center gap-1 text-[10px] text-[#40a060]">
              <TrendingUp size={9}/> Recovery point
            </span>
          )}
          {label && label !== 'strong' && retentionPct !== null && (
            <span className="text-[10px]" style={{ color: colors.text }}>
              {label === 'drop' ? '← viewers leaving here' :
               label === 'dipping' ? '← slight dip' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Right gutter retention bar */}
      {retentionPct !== null && (
        <div className="w-1 self-stretch rounded-full shrink-0"
          style={{ background: colors.border }}
        />
      )}
    </div>
  )
}

// ── Mini retention curve sparkline ────────────────────────────────────────────

function RetentionSparkline({ curve, durationSec }) {
  if (!curve || !durationSec) return null
  const keys   = Object.keys(curve).map(Number).sort((a, b) => a - b)
  const W = 400, H = 48

  const points = keys.map(t => ({
    x: (t / durationSec) * W,
    y: H - (curve[t] / 100) * H,
  }))

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: 48 }}>
      <path d={pathD} fill="none" stroke="#c8b89a" strokeWidth="1.5" opacity="0.6"/>
      {/* 50% line */}
      <line x1="0" y1={H/2} x2={W} y2={H/2} stroke="#333" strokeWidth="0.5" strokeDasharray="4,4"/>
    </svg>
  )
}

function formatSec(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EpisodeReview() {
  const { episodeId }  = useParams()
  const { notify }     = useStore()
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [curveInput,   setCurveInput]   = useState('')
  const [savingCurve,  setSavingCurve]  = useState(false)
  const [showCurveUpload, setShowCurve] = useState(false)

  useEffect(() => {
    if (!episodeId) return
    setLoading(true)
    analyticsApi.episodeRetention(episodeId)
      .then(setData)
      .catch(err => notify(err.message, 'error'))
      .finally(() => setLoading(false))
  }, [episodeId])

  async function saveCurve() {
    if (!curveInput.trim()) return
    setSavingCurve(true)
    try {
      await analyticsApi.saveRetentionCurve(episodeId, curveInput.trim())
      notify('Retention curve saved — reloading', 'success')
      // Reload to show the new curve
      const fresh = await analyticsApi.episodeRetention(episodeId)
      setData(fresh)
      setShowCurve(false)
      setCurveInput('')
    } catch (err) {
      notify(err.message, 'error')
    }
    setSavingCurve(false)
  }

  if (loading) return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="h-8 w-48 bg-[#111] rounded animate-pulse"/>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-14 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
      ))}
    </div>
  )

  if (!data) return (
    <div className="max-w-3xl mx-auto text-center py-16 text-[#444]">
      Episode not found
    </div>
  )

  const { episode, retentionCurve, retentionPatterns, scriptLines } = data
  const durationSec = scriptLines.length ? scriptLines[scriptLines.length - 1].endSec : 600
  const drops       = new Set((retentionPatterns?.drops || []).map(d => d.timeSeconds))
  const recoveries  = new Set((retentionPatterns?.recoveries || []).map(r => r.timeSeconds))

  // Find drop zones in script lines (±15s of a known drop)
  function isNearDrop(sec) {
    return [...drops].some(d => Math.abs(d - sec) <= 15)
  }
  function isNearRecovery(sec) {
    return [...recoveries].some(r => Math.abs(r - sec) <= 15)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/analytics" className="text-[#444] hover:text-[#888] transition-colors">
          <ArrowLeft size={16}/>
        </Link>
        <div>
          <h1 className="text-xl font-serif text-[#f0ede8]">
            Ep {episode.episodeNumber}: {episode.trackName}
          </h1>
          {episode.retentionScore && (
            <p className="text-sm text-[#555] mt-0.5">Retention score: {episode.retentionScore}%</p>
          )}
        </div>
      </div>

      {/* Retention curve sparkline */}
      {retentionCurve && (
        <div className="border border-[#1a1a1a] rounded p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#666] uppercase tracking-wide">Audience retention curve</span>
            <span className="text-[10px] text-[#444]">0:00 → {formatSec(durationSec)}</span>
          </div>
          <RetentionSparkline curve={retentionCurve} durationSec={durationSec}/>
          <div className="flex gap-4 text-[10px] text-[#444]">
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#40a060] inline-block"/> ≥70% strong</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[#c8a030] inline-block"/> 50–70% holding</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-red-500 inline-block"/> &lt;50% drop</span>
          </div>
        </div>
      )}

      {/* No retention data — show upload prompt */}
      {!retentionCurve && (
        <div className="border border-dashed border-[#1a1a1a] rounded p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs text-[#555]">
            <Info size={12}/>
            No retention curve for this episode yet
          </div>
          <p className="text-xs text-[#444] leading-relaxed">
            To overlay retention data on the script, export the audience retention report from YouTube Studio:
            Analytics → Content → select this video → Audience retention tab → Export (.csv)
          </p>
          <button
            onClick={() => setShowCurve(s => !s)}
            className="flex items-center gap-2 text-xs px-3 py-1.5 border border-[#1a1a1a] rounded text-[#555] hover:border-[#c8b89a]/30 hover:text-[#c8b89a] transition-all"
          >
            <Upload size={11}/> Paste retention CSV
          </button>
          {showCurveUpload && (
            <div className="space-y-2">
              <textarea
                value={curveInput}
                onChange={e => setCurveInput(e.target.value)}
                placeholder={"Paste YouTube retention CSV here:\n\nElapsed video time,Audience retention (%)\n0:00,100\n0:15,92\n0:30,88\n..."}
                rows={8}
                className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-xs text-[#888] font-mono outline-none focus:border-[#c8b89a]/40 resize-none"
              />
              <button
                onClick={saveCurve}
                disabled={savingCurve || !curveInput.trim()}
                className="px-4 py-2 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium hover:bg-[#e8c87a] disabled:opacity-40 transition-all"
              >
                {savingCurve ? 'Saving…' : 'Save curve'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      {retentionCurve && (
        <div className="flex gap-4 text-[10px] flex-wrap">
          {[
            { color: '#40a060', label: '≥70% — strong hold' },
            { color: '#c8a030', label: '50–70% — holding' },
            { color: '#e07830', label: '35–50% — dipping' },
            { color: '#e05050', label: '<35% — drop zone' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-[#555]">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color + '40', border: `1px solid ${color}60` }}/>
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Script with overlaid retention */}
      <div className="space-y-0.5">
        {scriptLines.length === 0 ? (
          <div className="text-sm text-[#444] py-8 text-center">
            No VO script found for this episode
          </div>
        ) : (
          scriptLines.map((line, i) => {
            const retPct = retentionCurve
              ? getRetentionAt(retentionCurve, line.startSec)
              : null
            return (
              <ScriptLine
                key={i}
                line={line}
                retentionPct={retPct}
                isDropZone={isNearDrop(line.startSec)}
                isRecovery={isNearRecovery(line.startSec)}
              />
            )
          })
        )}
      </div>

      {/* Pattern summary */}
      {retentionPatterns && (retentionPatterns.drops?.length > 0 || retentionPatterns.recoveries?.length > 0) && (
        <div className="border border-[#1a1a1a] rounded p-4 space-y-3">
          <div className="text-xs text-[#666] uppercase tracking-wide">Pattern summary</div>
          {retentionPatterns.drops?.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-red-400 flex items-center gap-1.5">
                <TrendingDown size={11}/> Drop points
              </div>
              {retentionPatterns.drops.slice(0, 4).map((d, i) => (
                <div key={i} className="text-xs text-[#555] pl-5">
                  {formatSec(d.timeSeconds)} — lost {Math.abs(Math.round(d.delta))}% in under 15s
                </div>
              ))}
            </div>
          )}
          {retentionPatterns.recoveries?.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-[#40a060] flex items-center gap-1.5">
                <TrendingUp size={11}/> Recovery points
              </div>
              {retentionPatterns.recoveries.slice(0, 4).map((r, i) => (
                <div key={i} className="text-xs text-[#555] pl-5">
                  {formatSec(r.timeSeconds)} — gained {Math.round(r.delta)}% after a dip
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
