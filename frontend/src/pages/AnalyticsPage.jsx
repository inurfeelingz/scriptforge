// frontend/src/pages/AnalyticsPage.jsx
// Batch 4 improvements:
//  09 — YouTube Analytics OAuth auto-import (connect once, pulls weekly)
//  10 — Episode review links → retention curve overlaid on VO script

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Upload, BarChart2, TrendingUp, Zap, Youtube,
  RefreshCw, Check, X, ExternalLink, AlertCircle, FileText,
} from 'lucide-react'
import { useStore } from '../store'
import { analytics as analyticsApi } from '../lib/api'

// ── YouTube connect panel ─────────────────────────────────────────────────────
function YouTubeConnectPanel({ categoryId, onPulled }) {
  const { notify } = useStore()
  const [status,  setStatus]  = useState(null)   // null | { connected, channelTitle, lastPulledAt, ... }
  const [pulling, setPulling] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!categoryId) return
    analyticsApi.youtubeStatus(categoryId)
      .then(setStatus)
      .catch(() => setStatus({ connected: false }))
      .finally(() => setLoading(false))
  }, [categoryId])

  // Handle OAuth redirect result (query param set by backend callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('youtube') === 'connected') {
      notify('YouTube connected — pulling latest analytics…', 'success')
      window.history.replaceState({}, '', window.location.pathname)
      // Auto-pull on first connect
      analyticsApi.youtubeStatus(categoryId).then(s => {
        setStatus(s)
        if (s.connected) handlePull()
      })
    }
    if (params.get('error') === 'youtube_denied') {
      notify('YouTube connection cancelled', 'info')
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('error') === 'oauth_failed') {
      notify('YouTube OAuth failed — check your YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET env vars', 'error')
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function handlePull() {
    setPulling(true)
    try {
      const result = await analyticsApi.youtubePull(categoryId)
      notify(`Pulled ${result.videoCount} videos — ${result.episodesMatched} matched`, 'success')
      setStatus(s => ({ ...s, lastPulledAt: new Date().toISOString() }))
      onPulled?.()
    } catch (err) {
      notify('Pull failed: ' + err.message, 'error')
    }
    setPulling(false)
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect YouTube? Your existing analytics data will remain.')) return
    try {
      await analyticsApi.youtubeDisconnect(categoryId)
      setStatus({ connected: false })
      notify('YouTube disconnected', 'info')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  if (loading) return (
    <div className="h-16 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
  )

  // Not connected
  if (!status?.connected) return (
    <div className="border border-[#1a1a1a] rounded p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-red-950/30 border border-red-800/30 flex items-center justify-center">
          <Youtube size={15} className="text-red-400"/>
        </div>
        <div>
          <div className="text-sm font-medium text-[#ccc]">Connect YouTube Analytics</div>
          <div className="text-xs text-[#555] mt-0.5">Auto-import retention data weekly — no more manual CSV exports</div>
        </div>
      </div>
      <a
        href={analyticsApi.youtubeConnectUrl(categoryId)}
        className="inline-flex items-center gap-2 px-4 py-2 bg-red-950/30 border border-red-800/40 text-red-400 rounded text-sm hover:bg-red-950/50 transition-all"
      >
        <Youtube size={13}/> Connect YouTube account
      </a>
      <p className="text-[10px] text-[#444] leading-relaxed">
        Requires Google Cloud Console setup: add <code className="text-[#666]">YOUTUBE_CLIENT_ID</code>, <code className="text-[#666]">YOUTUBE_CLIENT_SECRET</code>, and <code className="text-[#666]">YOUTUBE_REDIRECT_URI</code> to Railway env vars.
        See the setup instructions in your batch log.
      </p>
    </div>
  )

  // Connected
  return (
    <div className="border border-[#40a060]/20 rounded p-5 space-y-3 bg-[#40a060]/4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#40a060]/15 border border-[#40a060]/25 flex items-center justify-center">
          <Check size={14} className="text-[#40a060]"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[#ccc]">{status.channelTitle || 'YouTube connected'}</div>
          <div className="text-xs text-[#555] mt-0.5">
            {status.lastPulledAt
              ? `Last synced ${new Date(status.lastPulledAt).toLocaleDateString()}`
              : 'Not yet synced — pull now to import analytics'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePull}
            disabled={pulling}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[#40a060]/30 text-[#40a060] rounded text-xs hover:bg-[#40a060]/10 disabled:opacity-40 transition-all"
          >
            {pulling ? <RefreshCw size={10} className="animate-spin"/> : <RefreshCw size={10}/>}
            {pulling ? 'Pulling…' : 'Pull now'}
          </button>
          <button
            onClick={handleDisconnect}
            className="p-1.5 text-[#444] hover:text-red-400 transition-colors rounded"
            title="Disconnect YouTube"
          >
            <X size={13}/>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AnalyticsPage() {
  const { activeCategoryId, notify } = useStore()
  const [uploads,        setUploads]        = useState([])
  const [uploading,      setUploading]      = useState(false)
  const [platform,       setPlatform]       = useState('youtube')
  const [hookStats,      setHookStats]      = useState([])
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })

  function loadData() {
    if (!activeCategoryId) return
    analyticsApi.list({ categoryId: activeCategoryId }).then(({ uploads }) => setUploads(uploads || []))
    analyticsApi.hookStats({ categoryId: activeCategoryId }).then(({ breakdown }) => setHookStats(breakdown || [])).catch(() => {})
  }

  useEffect(() => { loadData() }, [activeCategoryId])

  async function handleUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length || !activeCategoryId) return
    setUploading(true)
    setUploadProgress({ done: 0, total: files.length })
    let matched = 0
    for (let i = 0; i < files.length; i++) {
      try {
        const result = await analyticsApi.upload(files[i], activeCategoryId, platform)
        matched += result.episodesMatched || 0
      } catch (err) {
        notify(files[i].name + ': ' + err.message, 'error')
      }
      setUploadProgress({ done: i + 1, total: files.length })
    }
    notify(files.length > 1
      ? `${files.length} files processed — ${matched} matched`
      : `Processed. ${matched} matched.`,
      'success'
    )
    loadData()
    setUploading(false)
    setUploadProgress({ done: 0, total: 0 })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Analytics</h1>
        <p className="text-sm text-[#555] mt-1">Connect YouTube for auto-import, or upload CSVs manually</p>
      </div>

      {/* 09 — YouTube OAuth connect panel */}
      {activeCategoryId && (
        <YouTubeConnectPanel categoryId={activeCategoryId} onPulled={loadData}/>
      )}

      {/* Manual CSV upload */}
      <div className="border border-[#1a1a1a] rounded p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm text-[#888]">Manual CSV upload</h2>
          <span className="text-xs text-[#444]">Fallback if OAuth isn't configured</span>
        </div>
        <div className="flex gap-3">
          {['youtube', 'tiktok'].map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-4 py-2 rounded border text-sm capitalize transition-all ${
                platform === p
                  ? 'border-[#c8b89a]/40 text-[#c8b89a] bg-[#c8b89a]/5'
                  : 'border-[#1a1a1a] text-[#555] hover:border-[#333]'
              }`}
            >{p}</button>
          ))}
        </div>
        <label className={`flex items-center justify-center gap-3 border-2 border-dashed rounded px-8 py-8 cursor-pointer transition-colors ${
          uploading ? 'border-[#c8b89a]/30 cursor-wait' : 'border-[#1a1a1a] hover:border-[#333]'
        }`}>
          {uploading ? (
            <div className="space-y-1 text-center">
              <div className="text-sm text-[#c8b89a]">Processing with Claude…</div>
              {uploadProgress.total > 1 && (
                <div className="text-xs text-[#555]">{uploadProgress.done} / {uploadProgress.total}</div>
              )}
            </div>
          ) : (
            <>
              <Upload size={16} className="text-[#444]"/>
              <div className="text-sm text-[#444]">
                Drop {platform === 'youtube' ? 'YouTube Studio' : 'TikTok Creator Center'} CSV here
              </div>
            </>
          )}
          <input type="file" accept=".csv" multiple onChange={handleUpload} disabled={uploading} className="hidden"/>
        </label>
      </div>

      {/* Upload history with Review links */}
      {uploads.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm text-[#888]">Upload history</h2>
          {uploads.map(u => (
            <div key={u.id} className="border border-[#1a1a1a] rounded p-5 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded border capitalize ${
                  u.source === 'oauth_auto'
                    ? 'border-[#40a060]/25 text-[#40a060]'
                    : 'border-[#c8b89a]/20 text-[#c8b89a]'
                }`}>
                  {u.platform}
                  {u.source === 'oauth_auto' && ' · auto'}
                </span>
                <span className="text-xs text-[#444]">{new Date(u.upload_date).toLocaleDateString()}</span>
                <span className="text-xs text-[#444]">{u.video_count} videos · avg score {u.avg_score}</span>
              </div>
              {u.insights && (
                <p className="text-xs text-[#666] leading-relaxed">{u.insights}</p>
              )}

              {/* 10 — Top performers with Review links */}
              {u.top_performers?.slice(0, 5).map((v, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <TrendingUp size={10} className="shrink-0 text-[#c8b89a]/60"/>
                  <span className="flex-1 truncate text-[#555]">{v.title}</span>
                  <span className="text-[#c8b89a] shrink-0">{v.retentionScore}%</span>
                  {v.episodeId && (
                    <Link
                      to={`/analytics/review/${v.episodeId}`}
                      className="flex items-center gap-1 text-[10px] text-[#444] hover:text-[#c8b89a] transition-colors shrink-0"
                    >
                      <FileText size={9}/> Review
                    </Link>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Hook performance */}
      {hookStats.length > 0 && (
        <div className="border border-[#1a1a1a] rounded p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-[#c8b89a]"/>
            <h2 className="text-sm text-[#888]">Hook type performance</h2>
          </div>
          <div className="space-y-2">
            {hookStats.map(h => (
              <div key={h.hookType} className="flex items-center gap-3">
                <span className="text-xs text-[#555] w-32 shrink-0 capitalize">{h.hookType.replace(/-/g, ' ')}</span>
                <div className="flex-1 h-1.5 bg-[#111] rounded overflow-hidden">
                  <div className="h-full bg-[#c8b89a] rounded transition-all" style={{ width: `${h.avgScore}%` }}/>
                </div>
                <span className="text-xs text-[#c8b89a] w-12 text-right shrink-0">{h.avgScore}%</span>
                <span className="text-[10px] text-[#444] w-16 shrink-0">{h.count} ep{h.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#444]">Average retention score by hook type across all episodes with analytics</p>
        </div>
      )}
    </div>
  )
}