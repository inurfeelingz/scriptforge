// frontend/src/pages/AnalyticsPage.jsx
import { useEffect, useState } from 'react'
import { Upload, BarChart2, TrendingUp, Zap } from 'lucide-react'
import { useStore } from '../store'
import { analytics as analyticsApi } from '../lib/api'

export default function AnalyticsPage() {
  const { activeCategoryId, notify } = useStore()
  const [uploads, setUploads]   = useState([])
  const [uploading, setUploading] = useState(false)
  const [platform, setPlatform] = useState('youtube')
  const [hookStats, setHookStats] = useState([])

  useEffect(() => {
    if (!activeCategoryId) return
    analyticsApi.list({ categoryId: activeCategoryId }).then(({ uploads }) => setUploads(uploads || []))
    analyticsApi.hookStats({ categoryId: activeCategoryId }).then(({ breakdown }) => setHookStats(breakdown || [])).catch(() => {})
  }, [activeCategoryId])

  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })

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
        notify(files[i].name + ": " + err.message, 'error')
      }
      setUploadProgress({ done: i + 1, total: files.length })
    }
    notify(files.length > 1 ? files.length + " files processed — " + matched + " matched" : "Processed. " + matched + " matched.", 'success')
    analyticsApi.list({ categoryId: activeCategoryId }).then(({ uploads }) => setUploads(uploads || []))
    analyticsApi.hookStats({ categoryId: activeCategoryId }).then(({ breakdown }) => setHookStats(breakdown || [])).catch(() => {})
    setUploading(false)
    setUploadProgress({ done: 0, total: 0 })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Analytics</h1>
        <p className="text-sm text-[#555] mt-1">Upload CSVs from YouTube Studio and TikTok Creator Center</p>
      </div>

      {/* Upload */}
      <div className="border border-[#1a1a1a] rounded p-6 space-y-4">
        <h2 className="text-sm text-[#888]">Upload analytics export</h2>
        <div className="flex gap-3">
          {['youtube','tiktok'].map(p => (
            <button key={p} onClick={() => setPlatform(p)}
              className={`px-4 py-2 rounded border text-sm capitalize transition-all ${
                platform === p ? 'border-[#c8b89a]/40 text-[#c8b89a] bg-[#c8b89a]/5' : 'border-[#1a1a1a] text-[#555] hover:border-[#333]'
              }`}>{p}</button>
          ))}
        </div>
        <label className={`flex items-center justify-center gap-3 border-2 border-dashed rounded px-8 py-8 cursor-pointer transition-colors ${
          uploading ? 'border-[#c8b89a]/30 cursor-wait' : 'border-[#1a1a1a] hover:border-[#333]'
        }`}>
          {uploading ? (
            <div className="text-sm text-[#c8b89a]">Processing with Claude...</div>
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

      {/* History */}
      {uploads.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm text-[#888]">Upload history</h2>
          {uploads.map(u => (
            <div key={u.id} className="border border-[#1a1a1a] rounded p-5 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs px-2 py-0.5 rounded border border-[#c8b89a]/20 text-[#c8b89a] capitalize">{u.platform}</span>
                <span className="text-xs text-[#444]">{new Date(u.upload_date).toLocaleDateString()}</span>
                <span className="text-xs text-[#444]">{u.video_count} videos · avg score {u.avg_score}</span>
              </div>
              {u.insights && (
                <p className="text-xs text-[#666] leading-relaxed">{u.insights}</p>
              )}
              {u.top_performers?.slice(0,3).map((v, i) => (
                <div key={i} className="text-xs text-[#444] flex gap-2">
                  <TrendingUp size={10} className="mt-0.5 shrink-0 text-[#c8b89a]/60"/>
                  <span className="truncate">{v.title}</span>
                  <span className="text-[#c8b89a] shrink-0">{v.retentionScore}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Hook performance breakdown */}
      {hookStats.length > 0 && (
        <div className="border border-[#1a1a1a] rounded p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-[#c8b89a]"/>
            <h2 className="text-sm text-[#888]">Hook type performance</h2>
          </div>
          <div className="space-y-2">
            {hookStats.map(h => (
              <div key={h.hookType} className="flex items-center gap-3">
                <span className="text-xs text-[#555] w-32 shrink-0 capitalize">{h.hookType.replace(/-/g,' ')}</span>
                <div className="flex-1 h-1.5 bg-[#111] rounded overflow-hidden">
                  <div
                    className="h-full bg-[#c8b89a] rounded transition-all"
                    style={{ width: `${h.avgScore}%` }}
                  />
                </div>
                <span className="text-xs text-[#c8b89a] w-12 text-right shrink-0">{h.avgScore}%</span>
                <span className="text-[10px] text-[#444] w-16 shrink-0">{h.count} ep{h.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#444]">Average retention score by hook type across all episodes with analytics uploaded</p>
        </div>
      )}
    </div>
  )
}
