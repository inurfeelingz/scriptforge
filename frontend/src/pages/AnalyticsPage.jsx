// frontend/src/pages/AnalyticsPage.jsx

import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Upload, TrendingUp, Zap, FileText, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useStore } from '../store'
import { analytics as analyticsApi } from '../lib/api'
import { Youtube, RefreshCw, Unlink, CheckCircle } from 'lucide-react'

// ── SVG line chart ────────────────────────────────────────────────────────────
function LineChart({ data, height = 110, color = 'rgba(74,222,128,1)', label = 'v' }) {
  const [hovered, setHovered] = useState(null)
  if (!data || data.length < 2) return null
  const W = 580, H = height, pad = 10
  const vals = data.map(d => d.value)
  const min  = Math.min(...vals), max = Math.max(...vals)
  const rng  = max - min || 1
  const pts  = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (W - pad * 2),
    y: pad + (1 - (d.value - min) / rng) * (H - pad * 2),
    ...d,
  }))
  const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')
  const area = `${line} L ${pts.at(-1).x} ${H} L ${pts[0].x} ${H} Z`
  const gid  = `g${label}`

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".14"/>
            <stop offset="100%" stopColor={color} stopOpacity=".01"/>
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`}/>
        <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
            <circle cx={p.x} cy={p.y} r={8} fill="transparent" className="cursor-pointer"/>
            <circle cx={p.x} cy={p.y} r={hovered === i ? 4 : 2.5}
              fill={hovered === i ? color : '#111'} stroke={color}
              strokeWidth={hovered === i ? 2 : 1.5}
              style={{ transition: 'r .15s, fill .15s' }}/>
            {hovered === i && (
              <g>
                <rect x={p.x - 32} y={p.y - 30} width={64} height={20} rx={3} fill="#111" stroke="#2a2a2a" strokeWidth={1}/>
                <text x={p.x} y={p.y - 16} textAnchor="middle" fill={color} fontSize={11} fontFamily="monospace">
                  {p.value}{p.unit || ''}
                </text>
              </g>
            )}
          </g>
        ))}
      </svg>
      <div className="flex justify-between px-1 mt-1">
        {data.map((d, i) =>
          (i === 0 || i === data.length - 1 || data.length <= 6 || i % Math.ceil(data.length / 5) === 0)
            ? <span key={i} className="text-[9px] text-[#444]">{d.label}</span>
            : <span key={i}/>
        )}
      </div>
    </div>
  )
}

// ── Score gauge ───────────────────────────────────────────────────────────────
function ScoreGauge({ value, size = 44 }) {
  const r    = size / 2 - 5
  const circ = 2 * Math.PI * r
  const fill = (value / 100) * circ * 0.75
  const col  = value >= 70 ? '#6abf7a' : value >= 50 ? 'rgba(74,222,128,1)' : '#bf6a6a'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1a1a1a" strokeWidth={5}
        strokeDasharray={`${circ*.75} ${circ*.25}`} strokeDashoffset={circ*.125} strokeLinecap="round"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={5}
        strokeDasharray={`${fill} ${circ - fill}`} strokeDashoffset={circ*.125} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray .7s ease' }}/>
      <text x={size/2} y={size/2 + 4} textAnchor="middle" fill={col}
        fontSize={size < 60 ? 12 : 18} fontWeight="600" fontFamily="serif">{value}</text>
    </svg>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { activeCategoryId, notify } = useStore()
  const [uploads,        setUploads]        = useState([])
  const [uploading,      setUploading]      = useState(false)
  const [platform,       setPlatform]       = useState('youtube')
  const [hookStats,      setHookStats]      = useState([])
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [expanded,       setExpanded]       = useState(null)
  const [ytStatus,       setYtStatus]       = useState(null)   // null | { connected, channelTitle, lastPulledAt }
  const [ytPulling,      setYtPulling]      = useState(false)
  const [ytConnecting,   setYtConnecting]   = useState(false)

  function loadData() {
    if (!activeCategoryId) return
    analyticsApi.list({ categoryId: activeCategoryId }).then(({ uploads }) => setUploads(uploads || []))
    analyticsApi.hookStats({ categoryId: activeCategoryId }).then(({ breakdown }) => setHookStats(breakdown || [])).catch(() => {})
    analyticsApi.youtubeStatus(activeCategoryId).then(status => setYtStatus(status)).catch(() => {})
  }
  useEffect(() => { loadData() }, [activeCategoryId])

  // Handle YouTube OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('youtube') === 'connected') {
      notify('YouTube connected successfully', 'success')
      loadData()
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('error') === 'youtube_denied') {
      notify('YouTube connection cancelled', 'error')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function connectYoutube() {
    if (!activeCategoryId) return
    setYtConnecting(true)
    try {
      const url = await analyticsApi.youtubeConnectUrl(activeCategoryId)
      window.location.href = url
    } catch (err) {
      notify('Failed to start YouTube connection: ' + err.message, 'error')
      setYtConnecting(false)
    }
  }

  async function pullYoutube() {
    if (!activeCategoryId) return
    setYtPulling(true)
    notify('Pulling latest YouTube analytics…', 'info', 4000)
    try {
      const result = await analyticsApi.youtubePull(activeCategoryId)
      notify(`Imported ${result.videoCount || 0} videos from YouTube`, 'success')
      loadData()
    } catch (err) {
      notify('Pull failed: ' + err.message, 'error')
    }
    setYtPulling(false)
  }

  async function disconnectYoutube() {
    if (!activeCategoryId) return
    try {
      await analyticsApi.youtubeDisconnect(activeCategoryId)
      setYtStatus({ connected: false })
      notify('YouTube disconnected', 'info')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    if (!activeCategoryId) { notify('No workspace selected', 'error'); return }
    setUploading(true)
    setUploadProgress({ done: 0, total: files.length })
    let matched = 0
    const skipInsights = files.length > 1
    const results = await Promise.allSettled(
      files.map(f => activeCategoryId ? analyticsApi.upload(f, activeCategoryId, platform, skipInsights) : Promise.reject(new Error('No workspace selected')))
    )
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') matched += r.value.episodesMatched || 0
      else notify(files[i].name + ': ' + r.reason.message, 'error')
      setUploadProgress({ done: i + 1, total: files.length })
    })
    const ok = results.filter(r => r.status === 'fulfilled').length
    if (ok > 0) notify(files.length > 1
      ? `${ok}/${files.length} files processed — ${matched} episodes matched`
      : `Processed. ${matched} episodes matched.`, 'success')
    loadData()
    setUploading(false)
    setUploadProgress({ done: 0, total: 0 })
    e.target.value = ''
  }

  const sorted      = useMemo(() => [...uploads].sort((a, b) => new Date(a.upload_date) - new Date(b.upload_date)), [uploads])
  const latest      = sorted.at(-1)
  const allTimeAvg  = uploads.length ? Math.round(uploads.reduce((s, u) => s + (u.avg_score || 0), 0) / uploads.length) : null
  const totalVideos = uploads.reduce((s, u) => s + (u.video_count || 0), 0)
  const trend       = sorted.length >= 2 ? (sorted.at(-1).avg_score || 0) - (sorted.at(-2).avg_score || 0) : null

  const growthData = useMemo(() => sorted.map(u => ({
    label: new Date(u.upload_date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    value: u.avg_score || 0, unit: '%',
  })), [sorted])

  const viewsData = useMemo(() => sorted.map(u => {
    const v = (u.top_performers || []).reduce((s, v) => s + (v.views || 0), 0)
    return { label: new Date(u.upload_date).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: v }
  }), [sorted])

  const scoreDist = useMemo(() => {
    const b = [
      { label: '0–20',  min: 0,  max: 20,  value: 0 },
      { label: '20–40', min: 20, max: 40,  value: 0 },
      { label: '40–60', min: 40, max: 60,  value: 0 },
      { label: '60–80', min: 60, max: 80,  value: 0 },
      { label: '80+',   min: 80, max: 101, value: 0 },
    ]
    uploads.forEach(u => (u.top_performers || []).forEach(v => {
      const s = v.retentionScore || 0
      ;(b.find(x => s >= x.min && s < x.max) || b.at(-1)).value++
    }))
    return b
  }, [uploads])

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Analytics</h1>
        <p className="text-sm text-[#555] mt-1">Upload your weekly stats CSV to track performance over time</p>
      </div>

      {/* YouTube OAuth section */}
      <div style={{
        background: ytStatus?.connected ? 'rgba(74,222,128,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${ytStatus?.connected ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: 12, padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Youtube size={16} style={{ color: ytStatus?.connected ? 'rgba(74,222,128,1)' : 'rgba(255,255,255,0.3)' }}/>
            <span style={{ fontSize: 13, fontWeight: 600, color: ytStatus?.connected ? 'rgba(74,222,128,1)' : '#e8eaed', fontFamily: "'Figtree',sans-serif" }}>
              {ytStatus?.connected ? `Connected — ${ytStatus.channelTitle || 'YouTube'}` : 'Connect YouTube for automatic imports'}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: "'Figtree',sans-serif" }}>
            {ytStatus?.connected
              ? `Last pulled: ${ytStatus.lastPulledAt ? new Date(ytStatus.lastPulledAt).toLocaleDateString() : 'never'} — pulls last 90 days of analytics`
              : 'No more CSV exports — KB gets your analytics automatically on demand'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {ytStatus?.connected ? (
            <>
              <button
                onClick={pullYoutube}
                disabled={ytPulling}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, border:'1px solid rgba(74,222,128,0.3)', background:'rgba(74,222,128,0.1)', color:'rgba(74,222,128,1)', cursor:'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif", fontWeight:600 }}
              >
                <RefreshCw size={12} style={{ animation: ytPulling ? 'spin 1s linear infinite' : 'none' }}/>
                {ytPulling ? 'Pulling…' : 'Pull now'}
              </button>
              <button
                onClick={disconnectYoutube}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', borderRadius:8, border:'1px solid rgba(255,0,0,0.2)', background:'transparent', color:'rgba(255,80,80,0.6)', cursor:'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}
              >
                <Unlink size={12}/> Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={connectYoutube}
              disabled={ytConnecting}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 20px', borderRadius:8, border:'none', background:'rgba(74,222,128,1)', color:'#080808', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:"'Figtree',sans-serif" }}
            >
              <Youtube size={14}/> {ytConnecting ? 'Connecting…' : 'Connect YouTube'}
            </button>
          )}
        </div>
      </div>

      {/* ── Overview stats ── */}
      {uploads.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: 'All-time avg score',
              value: allTimeAvg,
              unit: '/ 100',
              sub: trend !== null
                ? <span className={trend >= 0 ? 'text-[#6abf7a]' : 'text-[#bf6a6a]'}>
                    {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(0)}pts vs last upload
                  </span>
                : null,
            },
            { label: 'Total videos tracked', value: totalVideos, unit: '', sub: <span className="text-[#444]">across {uploads.length} upload{uploads.length !== 1 ? 's' : ''}</span> },
            { label: 'Latest batch score',   value: latest?.avg_score ?? '—', unit: '', sub: <span className="text-[#444]">{latest ? new Date(latest.upload_date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span> },
          ].map(s => (
            <div key={s.label} className="border border-[#1a1a1a] rounded p-4 space-y-1">
              <div className="text-[10px] text-[#444] uppercase tracking-widest">{s.label}</div>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-serif text-[rgba(74,222,128,1)]">{s.value}</span>
                {s.unit && <span className="text-sm text-[#555] mb-1">{s.unit}</span>}
              </div>
              <div className="text-xs">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Retention score trend ── */}
      {growthData.length >= 2 && (
        <div className="border border-[#1a1a1a] rounded p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={13} className="text-[rgba(74,222,128,1)]"/>
              <h2 className="text-sm text-[#888]">Retention score over time</h2>
            </div>
            <span className="text-[10px] text-[#444]">avg per upload batch</span>
          </div>
          <LineChart data={growthData} label="ret" height={110}/>
        </div>
      )}

      {/* ── Views trend ── */}
      {viewsData.length >= 2 && viewsData.some(d => d.value > 0) && (
        <div className="border border-[#1a1a1a] rounded p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={13} className="text-[#6a8fbf]"/>
              <h2 className="text-sm text-[#888]">Views per upload batch</h2>
            </div>
            <span className="text-[10px] text-[#444]">total views in tracked videos</span>
          </div>
          <LineChart data={viewsData} label="views" height={110} color="#6a8fbf"/>
        </div>
      )}

      {/* ── Score distribution ── */}
      {scoreDist.some(b => b.value > 0) && (
        <div className="border border-[#1a1a1a] rounded p-5 space-y-3">
          <h2 className="text-sm text-[#888]">Score distribution <span className="text-[#444] font-normal text-xs">— videos by retention range</span></h2>
          <div className="space-y-2">
            {scoreDist.map(b => {
              const max = Math.max(...scoreDist.map(x => x.value), 1)
              const col = b.min >= 60 ? '#6abf7a' : b.min >= 40 ? 'rgba(74,222,128,1)' : '#bf6a6a'
              return (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="text-xs text-[#555] w-14 shrink-0">{b.label}</span>
                  <div className="flex-1 h-2 bg-[#111] rounded overflow-hidden">
                    <div className="h-full rounded transition-all duration-500"
                      style={{ width: `${(b.value / max) * 100}%`, background: col }}/>
                  </div>
                  <span className="text-xs w-6 text-right shrink-0 font-mono" style={{ color: col }}>{b.value}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Hook performance ── */}
      {hookStats.length > 0 && (
        <div className="border border-[#1a1a1a] rounded p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-[rgba(74,222,128,1)]"/>
            <h2 className="text-sm text-[#888]">Hook type performance</h2>
          </div>
          <div className="space-y-2.5">
            {[...hookStats].sort((a, b) => b.avgScore - a.avgScore).map(h => {
              const col = h.avgScore >= 70 ? '#6abf7a' : h.avgScore >= 50 ? 'rgba(74,222,128,1)' : '#bf6a6a'
              return (
                <div key={h.hookType} className="flex items-center gap-3">
                  <span className="text-xs text-[#555] w-36 shrink-0 capitalize">{h.hookType.replace(/-/g, ' ')}</span>
                  <div className="flex-1 h-1.5 bg-[#111] rounded overflow-hidden">
                    <div className="h-full rounded transition-all duration-500" style={{ width: `${h.avgScore}%`, background: col }}/>
                  </div>
                  <span className="text-xs w-10 text-right shrink-0 font-mono" style={{ color: col }}>{h.avgScore}%</span>
                  <span className="text-[10px] text-[#444] w-14 shrink-0">{h.count} ep{h.count !== 1 ? 's' : ''}</span>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-[#444]">Average retention score by hook type across all tracked episodes</p>
        </div>
      )}

      {/* ── Upload history ── */}
      {uploads.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm text-[#888]">Upload history</h2>
          {[...sorted].reverse().map(u => {
            const open = expanded === u.id
            return (
              <div key={u.id} className="border border-[#1a1a1a] rounded overflow-hidden">
                <button
                  onClick={() => setExpanded(open ? null : u.id)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-[#0a0a0a] transition-colors text-left"
                >
                  <div className="flex items-center gap-2 flex-1 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded border border-[rgba(74,222,128,0.20)] text-[rgba(74,222,128,1)] capitalize">{u.platform}</span>
                    <span className="text-xs text-[#555]">{new Date(u.upload_date).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                    <span className="text-xs text-[#444]">{u.video_count} videos</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <ScoreGauge value={u.avg_score || 0} size={44}/>
                    {open ? <ChevronUp size={14} className="text-[#444]"/> : <ChevronDown size={14} className="text-[#444]"/>}
                  </div>
                </button>

                {open && (
                  <div className="border-t border-[#1a1a1a] px-5 py-4 space-y-4 bg-[#050505]">
                    {u.insights && <p className="text-xs text-[#666] leading-relaxed">{u.insights}</p>}
                    {(u.top_performers || []).slice(0, 8).map((v, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-[10px] text-[#333] w-4 shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[#888] truncate flex-1">{v.title}</span>
                            <span className="text-xs text-[rgba(74,222,128,1)] shrink-0 font-mono">{v.retentionScore}%</span>
                            {v.views > 0 && (
                              <span className="text-[10px] text-[#444] shrink-0">
                                {v.views >= 1000 ? `${(v.views / 1000).toFixed(1)}k` : v.views}v
                              </span>
                            )}
                            {v.ctr > 0 && <span className="text-[10px] text-[#444] shrink-0">{v.ctr.toFixed(1)}% CTR</span>}
                            {v.episodeId && (
                              <Link to={`/analytics/review/${v.episodeId}`} onClick={e => e.stopPropagation()}
                                className="flex items-center gap-1 text-[10px] text-[#444] hover:text-[rgba(74,222,128,1)] transition-colors shrink-0">
                                <FileText size={9}/> Review
                              </Link>
                            )}
                          </div>
                          <div className="h-1 bg-[#111] rounded overflow-hidden mt-1">
                            <div className="h-full rounded transition-all duration-500" style={{
                              width: `${v.retentionScore}%`,
                              background: v.retentionScore >= 70 ? '#6abf7a' : v.retentionScore >= 50 ? 'rgba(74,222,128,1)' : '#bf6a6a',
                            }}/>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Upload ── */}
      <div className="border border-[#1a1a1a] rounded p-6 space-y-4">
        <h2 className="text-sm text-[#888]">Upload weekly stats</h2>
        <div className="flex gap-3">
          {['youtube', 'tiktok'].map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-4 py-2 rounded border text-sm capitalize transition-all ${
                platform === p ? 'border-[rgba(74,222,128,0.40)] text-[rgba(74,222,128,1)] bg-[rgba(74,222,128,0.05)]' : 'border-[#1a1a1a] text-[#555] hover:border-[#333]'
              }`}>{p}</button>
          ))}
        </div>
        <label className={`flex items-center justify-center gap-3 border-2 border-dashed rounded px-8 py-8 cursor-pointer transition-colors ${
          uploading ? 'border-[rgba(74,222,128,0.30)] cursor-wait' : 'border-[#1a1a1a] hover:border-[#333]'
        }`}>
          {uploading ? (
            <div className="space-y-1 text-center">
              <div className="text-sm text-[rgba(74,222,128,1)]">KB is thinking…</div>
              {uploadProgress.total > 1 && <div className="text-xs text-[#555]">{uploadProgress.done} / {uploadProgress.total}</div>}
            </div>
          ) : (
            <>
              <Upload size={16} className="text-[#444]"/>
              <div className="text-sm text-[#444]">Drop {platform === 'youtube' ? 'YouTube Studio' : 'TikTok Creator Center'} CSV here</div>
            </>
          )}
          <input type="file" accept=".csv" multiple onChange={handleUpload} disabled={uploading} className="hidden"/>
        </label>
        <p className="text-[10px] text-[#444]">YouTube Studio → Analytics → Advanced Mode → Export current view</p>
      </div>

    </div>
  )
}