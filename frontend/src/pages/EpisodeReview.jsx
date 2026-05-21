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
import { analytics as analyticsApi, episodes as episodesApi } from '../lib/api'
import InlineEdit from '../components/ui/InlineEdit'

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
      {/* ── Collab ── */}
      <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Collaborate</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>
              Share this episode with an editor, guest, or collaborator
            </div>
          </div>
          {!collabSession ? (
            <button
              onClick={createCollabSession}
              disabled={collabLoading}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: collabLoading ? 'wait' : 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
            >
              {collabLoading ? 'Creating...' : 'Create invite link'}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)', color: 'rgba(74,222,128,0.7)', fontFamily: 'monospace', userSelect: 'all' }}>
                {collabSession.session_code}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(collabSession.session_code); notify('Code copied', 'success') }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif" }}
              >
                Copy
              </button>
            </div>
          )}
        </div>
        {collabSession && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 8 }}>
            Share this code. Collaborators enter it at whispacuts.com/join to access this episode.
            {collabSession.participants?.length > 1 ? ` ${collabSession.participants.length - 1} collaborator(s) joined.` : ''}
          </div>
        )}
      </div>

      {/* ── Thumbnail Prompt ── */}
      <div style={{ marginTop: 24, padding: '16px', borderRadius: 10, border: '1px solid rgba(74,222,128,0.1)', background: 'rgba(74,222,128,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Thumbnail Intelligence</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>
              Flux prompt + title options targeted to your audience
            </div>
          </div>
          <button
            onClick={generateThumbnailPrompt}
            disabled={thumbLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.8)', cursor: thumbLoading ? 'wait' : 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
          >
            {thumbLoading ? 'Generating...' : '✦ Generate prompt'}
          </button>
        </div>

        {thumbResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Flux prompt */}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>Flux Prompt</div>
              <div
                style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.65, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', userSelect: 'all' }}
                onClick={() => { navigator.clipboard.writeText(thumbResult.fluxPrompt); notify('Copied', 'success') }}
                title="Click to copy"
              >
                {thumbResult.fluxPrompt}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 4 }}>Click to copy · Paste into Flux, Ideogram, or Midjourney</div>
            </div>

            {/* Title options */}
            {thumbResult.titleOptions?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>Title Options</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {thumbResult.titleOptions.map((title, i) => (
                    <div
                      key={i}
                      onClick={() => { navigator.clipboard.writeText(title); notify('Copied', 'success') }}
                      style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: "'Figtree',sans-serif", padding: '8px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
                      title="Click to copy"
                    >
                      {title}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 4 }}>Click any title to copy</div>
              </div>
            )}

            {/* Audience flag */}
            {!thumbResult.audienceUsed && (
              <div style={{ fontSize: 11, color: 'rgba(255,180,50,0.6)', fontFamily: "'Figtree',sans-serif" }}>
                No audience data found — run Gemini research on the Analytics page for more targeted prompts.
              </div>
            )}
          </div>
        )}
      </div>

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
      <path d={pathD} fill="none" stroke="rgba(74,222,128,1)" strokeWidth="1.5" opacity="0.6"/>
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
  const { notify, activeCategoryId, setActiveEpisodeId } = useStore()
  const [data,         setData]         = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [curveInput,   setCurveInput]   = useState('')
  const [savingCurve,  setSavingCurve]  = useState(false)
  const [showCurveUpload, setShowCurve] = useState(false)
  const [thumbLoading,   setThumbLoading]   = useState(false)
  const [thumbResult,    setThumbResult]    = useState(null)
  const [collabSession,  setCollabSession]  = useState(null)
  const [collabLoading,  setCollabLoading]  = useState(false)

  useEffect(() => {
    if (!episodeId) return
    setActiveEpisodeId(episodeId)
    setLoading(true)
    analyticsApi.episodeRetention(episodeId)
      .then(setData)
      .catch(err => notify(err.message, 'error'))
      .finally(() => setLoading(false))
    return () => setActiveEpisodeId(null)
  }, [episodeId])

  async function createCollabSession() {
    if (!episodeId || !activeCategoryId) return
    setCollabLoading(true)
    try {
      const { session } = await fetch(`${import.meta.env.VITE_API_URL}/api/collab/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await import('../lib/supabase')).getSession().then(s => s?.access_token)}` },
        body: JSON.stringify({ categoryId: activeCategoryId, episodeId }),
      }).then(r => r.json())
      setCollabSession(session)
    } catch (err) {
      notify('Could not create collab session: ' + err.message, 'error')
    }
    setCollabLoading(false)
  }

  async function generateThumbnailPrompt() {
    if (!episodeId || !activeCategoryId) return
    setThumbLoading(true)
    try {
      const result = await chatApi.thumbnailPrompt({ categoryId: activeCategoryId, episodeId })
      setThumbResult(result)
    } catch (err) {
      notify('Thumbnail prompt failed: ' + err.message, 'error')
    }
    setThumbLoading(false)
  }

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
        <div style={{ flex: 1 }}>
          <InlineEdit
            value={episode.trackName}
            onSave={async (val) => {
              await episodesApi.patch(episode.id, { track_name: val })
              setData(d => ({ ...d, episode: { ...d.episode, trackName: val } }))
            }}
            style={{ fontSize: '1.25rem', fontFamily: 'serif', color: '#f0ede8', fontWeight: 600 }}
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            {episode.retentionScore && (
              <span className="text-sm text-[#555]">Retention: {episode.retentionScore}%</span>
            )}
            {/* Gemini Script Score badge */}
            {episode.scriptScore?.overallScore && (
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 99,
                background: episode.scriptScore.overallScore >= 70 ? 'rgba(74,222,128,0.1)' : 'rgba(255,170,0,0.1)',
                border: `1px solid ${episode.scriptScore.overallScore >= 70 ? 'rgba(74,222,128,0.3)' : 'rgba(255,170,0,0.3)'}`,
                color: episode.scriptScore.overallScore >= 70 ? 'rgba(74,222,128,1)' : 'rgba(255,170,0,1)',
                fontFamily: "'Figtree',sans-serif", cursor: 'pointer',
              }}
              title={`Gemini score: Hook ${episode.scriptScore.dimensions?.hookStrength?.score || '?'} · Voice ${episode.scriptScore.dimensions?.voiceMatch?.score || '?'} · Retention ${episode.scriptScore.dimensions?.retentionStructure?.score || '?'}`}
              >
                ✦ {episode.scriptScore.overallScore}/100
              </span>
            )}

            {/* YouTube Video ID link */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>YouTube ID:</span>
              <InlineEdit
                value={episode.youtubeVideoId || ''}
                placeholder="Link video ID"
                onSave={async (val) => {
                  await episodesApi.patch(episode.id, { youtube_video_id: val.trim() })
                  setData(d => ({ ...d, episode: { ...d.episode, youtubeVideoId: val.trim() } }))
                }}
                style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(74,222,128,0.8)' }}
              />
              {episode.youtubeVideoId && (
                <a
                  href={`https://youtube.com/watch?v=${episode.youtubeVideoId}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 10, color: 'rgba(74,222,128,0.5)' }}
                >↗</a>
              )}
            </div>
          </div>
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
            className="flex items-center gap-2 text-xs px-3 py-1.5 border border-[#1a1a1a] rounded text-[#555] hover:border-[rgba(74,222,128,0.30)] hover:text-[rgba(74,222,128,1)] transition-all"
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
                className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-xs text-[#888] font-mono outline-none focus:border-[rgba(74,222,128,0.40)] resize-none"
              />
              <button
                onClick={saveCurve}
                disabled={savingCurve || !curveInput.trim()}
                className="px-4 py-2 bg-[rgba(74,222,128,1)] text-[#080808] rounded text-sm font-medium hover:bg-[rgba(74,222,128,0.85)] disabled:opacity-40 transition-all"
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
      {/* ── Collab ── */}
      <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Collaborate</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>
              Share this episode with an editor, guest, or collaborator
            </div>
          </div>
          {!collabSession ? (
            <button
              onClick={createCollabSession}
              disabled={collabLoading}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: collabLoading ? 'wait' : 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
            >
              {collabLoading ? 'Creating...' : 'Create invite link'}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)', color: 'rgba(74,222,128,0.7)', fontFamily: 'monospace', userSelect: 'all' }}>
                {collabSession.session_code}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(collabSession.session_code); notify('Code copied', 'success') }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif" }}
              >
                Copy
              </button>
            </div>
          )}
        </div>
        {collabSession && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 8 }}>
            Share this code. Collaborators enter it at whispacuts.com/join to access this episode.
            {collabSession.participants?.length > 1 ? ` ${collabSession.participants.length - 1} collaborator(s) joined.` : ''}
          </div>
        )}
      </div>

      {/* ── Thumbnail Prompt ── */}
      <div style={{ marginTop: 24, padding: '16px', borderRadius: 10, border: '1px solid rgba(74,222,128,0.1)', background: 'rgba(74,222,128,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Thumbnail Intelligence</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>
              Flux prompt + title options targeted to your audience
            </div>
          </div>
          <button
            onClick={generateThumbnailPrompt}
            disabled={thumbLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.8)', cursor: thumbLoading ? 'wait' : 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
          >
            {thumbLoading ? 'Generating...' : '✦ Generate prompt'}
          </button>
        </div>

        {thumbResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Flux prompt */}
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>Flux Prompt</div>
              <div
                style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.65, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', userSelect: 'all' }}
                onClick={() => { navigator.clipboard.writeText(thumbResult.fluxPrompt); notify('Copied', 'success') }}
                title="Click to copy"
              >
                {thumbResult.fluxPrompt}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 4 }}>Click to copy · Paste into Flux, Ideogram, or Midjourney</div>
            </div>

            {/* Title options */}
            {thumbResult.titleOptions?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>Title Options</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {thumbResult.titleOptions.map((title, i) => (
                    <div
                      key={i}
                      onClick={() => { navigator.clipboard.writeText(title); notify('Copied', 'success') }}
                      style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: "'Figtree',sans-serif", padding: '8px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
                      title="Click to copy"
                    >
                      {title}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 4 }}>Click any title to copy</div>
              </div>
            )}

            {/* Audience flag */}
            {!thumbResult.audienceUsed && (
              <div style={{ fontSize: 11, color: 'rgba(255,180,50,0.6)', fontFamily: "'Figtree',sans-serif" }}>
                No audience data found — run Gemini research on the Analytics page for more targeted prompts.
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}