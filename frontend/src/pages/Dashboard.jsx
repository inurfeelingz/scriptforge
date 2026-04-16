// frontend/src/pages/Dashboard.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Film, BookMarked, BarChart2, TrendingUp, RefreshCw } from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi, vault as vaultApi, analytics as analyticsApi } from '../lib/api'

export default function Dashboard() {
  const { activeCategoryId, activeCategory } = useStore()
  const [recentEps, setRecentEps]       = useState([])
  const [vaultStats, setVaultStats]     = useState(null)
  const [recommendations, setRecs]      = useState([])
  const [latestInsights, setInsights]   = useState(null)
  const [kpis, setKpis]                 = useState(null)
  const [loading, setLoading]           = useState(true)

  const cat = activeCategory?.()

  useEffect(() => {
    if (!activeCategoryId) return
    setLoading(true)
    Promise.all([
      episodesApi.list({ categoryId: activeCategoryId, limit: 5 }),
      vaultApi.stats({ categoryId: activeCategoryId }),
      vaultApi.recommendations({ categoryId: activeCategoryId }),
      analyticsApi.list({ categoryId: activeCategoryId }),
    ]).then(([eps, stats, recs, analytics]) => {
      setRecentEps(eps.episodes || [])
      setVaultStats(stats)
      setRecs(recs.recommendations || [])
      setInsights(analytics.uploads?.[0]?.insights || null)

      // Aggregate KPIs from episode performance data
      const withData = (eps.episodes || []).filter(e => e.yt_retention_score)
      if (withData.length) {
        const avgRetention = Math.round(withData.reduce((s,e) => s + (e.yt_retention_score||0), 0) / withData.length)
        const best = withData.reduce((a,b) => (a.yt_retention_score||0) > (b.yt_retention_score||0) ? a : b, withData[0])
        setKpis({ avgRetention, episodesWithData: withData.length, bestEp: best })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [activeCategoryId])

  if (!activeCategoryId) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center space-y-3">
        <div className="text-[#444] text-sm">Create a category to get started</div>
        <Link to="/settings" className="text-xs text-[#c8b89a] hover:underline">Set up your workspace</Link>
      </div>
    </div>
  )

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Dashboard</h1>
        {cat && <p className="text-sm text-[#555] mt-1">{cat.name} · {cat.niche}</p>}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { to: '/generate', icon: Sparkles, label: 'New episode', accent: true },
          { to: '/series',   icon: Film,     label: 'Series'    },
          { to: '/vault',    icon: BookMarked,label: 'Vault'    },
          { to: '/analytics',icon: BarChart2, label: 'Analytics'},
        ].map(({ to, icon: Icon, label, accent }) => (
          <Link
            key={to} to={to}
            className={`flex items-center gap-3 px-4 py-3 rounded border transition-all ${
              accent
                ? 'border-[#c8b89a]/30 bg-[#c8b89a]/5 text-[#c8b89a] hover:bg-[#c8b89a]/10'
                : 'border-[#1a1a1a] text-[#666] hover:border-[#333] hover:text-[#aaa]'
            }`}
          >
            <Icon size={14}/> <span className="text-sm">{label}</span>
          </Link>
        ))}
      </div>

      {/* KPI strip */}
      {kpis && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Avg retention score', value: kpis.avgRetention + '%', sub: kpis.episodesWithData + ' episodes with data' },
            { label: 'Best performing',     value: 'Ep ' + kpis.bestEp?.episode_number, sub: kpis.bestEp?.track_name },
            { label: 'Best score',          value: kpis.bestEp?.yt_retention_score + '%', sub: 'retention score' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-[#0a0a0a] border border-[#111] rounded p-4">
              <div className="text-[10px] text-[#444] uppercase tracking-wide mb-1">{label}</div>
              <div className="text-xl font-serif text-[#c8b89a]">{value}</div>
              <div className="text-[10px] text-[#444] mt-0.5 truncate">{sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">

        {/* Recent episodes */}
        <div className="col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-[#888]">Recent episodes</h2>
            <Link to="/series" className="text-xs text-[#444] hover:text-[#888]">View all</Link>
          </div>
          {loading ? (
            <div className="space-y-2">{[...Array(3)].map((_,i) => (
              <div key={i} className="h-14 bg-[#0d0d0d] rounded animate-pulse border border-[#111]"/>
            ))}</div>
          ) : recentEps.length ? (
            <div className="space-y-2">
              {recentEps.map(ep => (
                <div key={ep.id} className="flex items-center gap-4 px-4 py-3 bg-[#0a0a0a] border border-[#111] rounded">
                  <span className="text-xs text-[#444] font-mono w-8">#{ep.episode_number}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#ccc] truncate">{ep.track_name}</div>
                    <div className="text-xs text-[#444]">{ep.track_mood} · {ep.status}</div>
                  </div>
                  {ep.yt_retention_score && (
                    <span className="text-xs text-[#c8b89a]">{ep.yt_retention_score}%</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-[#444] py-8 text-center">No episodes yet — generate your first one</div>
          )}
        </div>

        {/* Sidebar stats */}
        <div className="space-y-4">

          {/* Vault stats */}
          {vaultStats && (
            <div className="border border-[#1a1a1a] rounded p-4 space-y-3">
              <h3 className="text-xs text-[#666] uppercase tracking-wide">Vault</h3>
              <div className="space-y-1.5">
                {[
                  { label: 'Total ideas', value: vaultStats.total },
                  { label: 'Favourites',  value: vaultStats.favourites },
                  { label: 'Unused',      value: vaultStats.unused },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-[#555]">{label}</span>
                    <span className="text-[#888]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <div className="border border-[#1a1a1a] rounded p-4 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp size={12} className="text-[#c8b89a]"/>
                <h3 className="text-xs text-[#666] uppercase tracking-wide">Ready to use</h3>
              </div>
              {recommendations.slice(0, 3).map((rec, i) => (
                <div key={i} className="text-xs space-y-1">
                  <div className="text-[#bbb] truncate">{rec.title}</div>
                  <div className="text-[#444] leading-relaxed">{rec.reason}</div>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                    rec.urgency === 'high' ? 'bg-[#c8b89a]/10 text-[#c8b89a]' : 'bg-[#111] text-[#555]'
                  }`}>{rec.urgency}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Latest insights */}
      {latestInsights && (
        <div className="border border-[#1a1a1a] rounded p-4 space-y-2">
          <div className="flex items-center gap-2">
            <BarChart2 size={12} className="text-[#c8b89a]"/>
            <h3 className="text-xs text-[#666] uppercase tracking-wide">Latest insights</h3>
          </div>
          <p className="text-xs text-[#555] leading-relaxed line-clamp-4">{latestInsights}</p>
          <Link to="/analytics" className="text-xs text-[#c8b89a] hover:underline">View full analytics →</Link>
        </div>
      )}
    </div>
  )
}
