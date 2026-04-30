// frontend/src/pages/Dashboard.jsx
// Batch 3 improvements:
//  07 — "What to work on today" AI daily directive
//  08 — Episode pipeline Kanban — status lanes with one-tap advancement

import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Sparkles, Film, BookMarked, BarChart2, TrendingUp,
  ArrowRight, RefreshCw, ChevronRight, Mic, Scissors,
  Upload, Globe, Zap, BookOpen,
} from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi, vault as vaultApi, analytics as analyticsApi, dashboard as dashboardApi } from '../lib/api'

// ── Status lane config ────────────────────────────────────────────────────────
const LANES = [
  { key: 'draft',     label: 'Draft',     next: 'ready',     icon: Sparkles,  nextLabel: 'Mark generated' },
  { key: 'ready',     label: 'Generated', next: 'recorded',  icon: Mic,       nextLabel: 'Mark recorded'  },
  { key: 'recorded',  label: 'Recorded',  next: 'edited',    icon: Scissors,  nextLabel: 'Mark edited'    },
  { key: 'edited',    label: 'Edited',    next: 'published', icon: Upload,    nextLabel: 'Publish'        },
  { key: 'published', label: 'Published', next: null,        icon: Globe,     nextLabel: null             },
]

const STATUS_COLORS = {
  draft:     { border: '#222',         text: '#555',     bg: '#0d0d0d'   },
  ready:     { border: '#c8b89a40',    text: '#c8b89a',  bg: '#c8b89a08' },
  recorded:  { border: '#4080c840',    text: '#4080c8',  bg: '#4080c808' },
  edited:    { border: '#8060c840',    text: '#8060c8',  bg: '#8060c808' },
  published: { border: '#40a06040',    text: '#40a060',  bg: '#40a06008' },
}

const ACTION_ICONS = {
  RECORD:    Mic,
  GENERATE:  Sparkles,
  EDIT:      Scissors,
  PUBLISH:   Globe,
  VAULT:     BookMarked,
  ANALYTICS: BarChart2,
}

// ── Pipeline kanban ───────────────────────────────────────────────────────────
function PipelineBoard({ lanes, onAdvance, advancing }) {
  const [expanded, setExpanded] = useState('ready')

  return (
    <div className="space-y-2">
      {LANES.map(lane => {
        const eps     = lanes[lane.key] || []
        const isOpen  = expanded === lane.key
        const colors  = STATUS_COLORS[lane.key]
        const LaneIcon = lane.icon

        return (
          <div
            key={lane.key}
            className="border rounded overflow-hidden transition-all"
            style={{ borderColor: isOpen ? colors.border : '#1a1a1a' }}
          >
            {/* Lane header */}
            <button
              onClick={() => setExpanded(isOpen ? null : lane.key)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
              style={{ background: isOpen ? colors.bg : 'transparent' }}
            >
              <LaneIcon size={13} style={{ color: colors.text, flexShrink: 0 }}/>
              <span className="text-sm font-medium" style={{ color: isOpen ? colors.text : '#666' }}>
                {lane.label}
              </span>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full"
                style={{
                  background: eps.length ? colors.bg : '#0d0d0d',
                  color:      eps.length ? colors.text : '#444',
                  border:     `1px solid ${eps.length ? colors.border : '#1a1a1a'}`,
                }}
              >
                {eps.length}
              </span>
              <ChevronRight size={12} className="text-[#444] transition-transform"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}/>
            </button>

            {/* Lane cards */}
            {isOpen && (
              <div className="border-t divide-y"
                style={{ borderColor: '#1a1a1a' }}>
                {eps.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-[#444] italic">Nothing here yet</div>
                ) : (
                  eps.map(ep => (
                    <EpisodeCard
                      key={ep.id}
                      ep={ep}
                      lane={lane}
                      colors={colors}
                      onAdvance={onAdvance}
                      advancing={advancing === ep.id}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function EpisodeCard({ ep, lane, colors, onAdvance, advancing }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 group hover:bg-[#0d0d0d] transition-colors">
      <span className="text-xs font-mono text-[#444] w-7 shrink-0">#{ep.episode_number}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[#ccc] truncate">{ep.track_name}</div>
        {ep.track_mood && <div className="text-xs text-[#444] mt-0.5">{ep.track_mood}</div>}
      </div>
      {ep.yt_retention_score && (
        <span className="text-xs shrink-0" style={{ color: colors.text }}>
          {ep.yt_retention_score}%
        </span>
      )}
      {lane.next && (
        <button
          onClick={() => onAdvance(ep.id, lane.next)}
          disabled={advancing}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] opacity-0 group-hover:opacity-100 transition-all disabled:opacity-40"
          style={{
            borderColor: colors.border,
            color:       colors.text,
            background:  colors.bg,
          }}
        >
          {advancing ? <RefreshCw size={9} className="animate-spin"/> : <ArrowRight size={9}/>}
          {lane.nextLabel}
        </button>
      )}
    </div>
  )
}

// ── Daily directive card ──────────────────────────────────────────────────────
function DirectiveCard({ brief, loading, onRefresh }) {
  const navigate = useNavigate()

  if (loading) return (
    <div className="border border-[#1a1a1a] rounded p-5 space-y-3 animate-pulse">
      <div className="h-3 w-24 bg-[#1a1a1a] rounded"/>
      <div className="h-5 w-3/4 bg-[#1a1a1a] rounded"/>
      <div className="h-8 w-32 bg-[#1a1a1a] rounded"/>
    </div>
  )

  if (!brief) return null

  const Icon = ACTION_ICONS[brief.action] || Sparkles

  return (
    <div className="border border-[#c8b89a]/25 rounded p-5 bg-[#c8b89a]/4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={12} className="text-[var(--accent)]"/>
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--accent)]/70">
            Today's focus
          </span>
          {brief.fromCache && (
            <span className="text-[10px] text-[#444]">· cached</span>
          )}
        </div>
        <button
          onClick={onRefresh}
          className="text-[#444] hover:text-[#888] transition-colors"
          title="Refresh directive"
        >
          <RefreshCw size={12}/>
        </button>
      </div>

      <p className="text-base text-[#eeeaf2] leading-snug font-medium">
        {brief.directive}
      </p>

      {brief.route && (
        <button
          onClick={() => navigate(brief.route)}
          className="flex items-center gap-2 px-4 py-2 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium hover:bg-[#e8c87a] transition-all"
        >
          <Icon size={13}/>
          {brief.action === 'RECORD'    ? 'Open Teleprompter' :
           brief.action === 'GENERATE'  ? 'Generate episode'  :
           brief.action === 'EDIT'      ? 'Open Editor'       :
           brief.action === 'PUBLISH'   ? 'Open Series'       :
           brief.action === 'VAULT'     ? 'Open Vault'        :
           brief.action === 'ANALYTICS' ? 'Open Analytics'    : 'Get started'}
          <ChevronRight size={13}/>
        </button>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { activeCategoryId, activeCategory, notify } = useStore()
  const cat = activeCategory?.()

  // Brief state (07)
  const [brief,       setBrief]       = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)

  // Pipeline state (08)
  const [lanes,       setLanes]       = useState({})
  const [pipeLoading, setPipeLoading] = useState(false)
  const [advancing,   setAdvancing]   = useState(null)

  // Existing sidebar data
  const [vaultStats,     setVaultStats]     = useState(null)
  const [recommendations, setRecs]          = useState([])
  const [kpis,           setKpis]           = useState(null)
  const [latestInsights, setInsights]       = useState(null)
  const [sideLoading,    setSideLoading]    = useState(true)

  const loadBrief = useCallback(async (force = false) => {
    if (!activeCategoryId) return
    setBriefLoading(true)
    try {
      // Force refresh busts the server cache by re-requesting
      const data = await dashboardApi.brief(activeCategoryId + (force ? `&bust=${Date.now()}` : ''))
      setBrief(data)
    } catch (err) {
      console.warn('Brief failed:', err.message)
    }
    setBriefLoading(false)
  }, [activeCategoryId])

  const loadPipeline = useCallback(async () => {
    if (!activeCategoryId) return
    setPipeLoading(true)
    try {
      const data = await dashboardApi.pipeline(activeCategoryId)
      setLanes(data.lanes || {})
    } catch (err) {
      console.warn('Pipeline failed:', err.message)
    }
    setPipeLoading(false)
  }, [activeCategoryId])

  const loadSidePanel = useCallback(async () => {
    if (!activeCategoryId) return
    setSideLoading(true)
    try {
      const [stats, recs, analytics, eps] = await Promise.all([
        vaultApi.stats({ categoryId: activeCategoryId }),
        vaultApi.recommendations({ categoryId: activeCategoryId }),
        analyticsApi.list({ categoryId: activeCategoryId }),
        episodesApi.list({ categoryId: activeCategoryId, limit: 20 }),
      ])
      setVaultStats(stats)
      setRecs(recs.recommendations || [])
      setInsights(analytics.uploads?.[0]?.insights || null)

      const withData = (eps.episodes || []).filter(e => e.yt_retention_score)
      if (withData.length) {
        const avg  = Math.round(withData.reduce((s, e) => s + (e.yt_retention_score || 0), 0) / withData.length)
        const best = withData.reduce((a, b) => (a.yt_retention_score || 0) > (b.yt_retention_score || 0) ? a : b, withData[0])
        setKpis({ avgRetention: avg, episodesWithData: withData.length, bestEp: best })
      }
    } catch (err) {
      console.warn('Side panel failed:', err.message)
    }
    setSideLoading(false)
  }, [activeCategoryId])

  useEffect(() => {
    if (!activeCategoryId) return
    loadBrief()
    loadPipeline()
    loadSidePanel()
  }, [activeCategoryId])

  // 08 — Advance episode status from kanban
  async function handleAdvance(episodeId, newStatus) {
    setAdvancing(episodeId)
    try {
      await dashboardApi.advanceStatus(episodeId, newStatus)
      // Optimistically update pipeline
      setLanes(prev => {
        const next = { ...prev }
        let movedEp = null
        // Remove from current lane
        for (const lane of Object.keys(next)) {
          const idx = next[lane].findIndex(e => e.id === episodeId)
          if (idx !== -1) {
            movedEp = { ...next[lane][idx], status: newStatus }
            next[lane] = next[lane].filter(e => e.id !== episodeId)
            break
          }
        }
        // Add to new lane
        if (movedEp && next[newStatus]) {
          next[newStatus] = [movedEp, ...next[newStatus]]
        }
        return next
      })
      // Refresh brief — status change might update the directive
      loadBrief(true)
      notify(`Episode moved to ${newStatus}`, 'success')
    } catch (err) {
      notify('Failed to update: ' + err.message, 'error')
    }
    setAdvancing(null)
  }

  if (!activeCategoryId) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center space-y-3">
        <div className="text-[#444] text-sm">Create a category to get started</div>
        <Link to="/settings" className="text-xs text-[var(--accent)] hover:underline">Set up your workspace</Link>
      </div>
    </div>
  )

  return (
    <div className="space-y-7 max-w-4xl">

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-serif text-[#f0ede8]">Dashboard</h1>
          {cat && <p className="text-sm text-[#555] mt-1">{cat.name} · {cat.niche}</p>}
        </div>
        <Link to="/generate"
          className="flex items-center gap-2 px-4 py-2 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium hover:bg-[#e8c87a] transition-all">
          <Sparkles size={13}/> New episode
        </Link>
      </div>

      {/* 07 — Daily directive */}
      <DirectiveCard
        brief={brief}
        loading={briefLoading}
        onRefresh={() => loadBrief(true)}
      />

      {/* KPI strip */}
      {kpis && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Avg retention',    value: kpis.avgRetention + '%',  sub: `${kpis.episodesWithData} ep with data` },
            { label: 'Best episode',     value: `Ep ${kpis.bestEp?.episode_number}`, sub: kpis.bestEp?.track_name },
            { label: 'Best score',       value: kpis.bestEp?.yt_retention_score + '%', sub: 'retention score' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="bg-[#0a0a0a] border border-[#111] rounded p-4">
              <div className="text-[10px] text-[#444] uppercase tracking-wide mb-1">{label}</div>
              <div className="text-xl font-serif text-[var(--accent)]">{value}</div>
              <div className="text-[10px] text-[#444] mt-0.5 truncate">{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Main grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* 08 — Pipeline kanban (left 2/3) */}
        <div className="md:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-[#888]">Episode pipeline</h2>
            <button
              onClick={loadPipeline}
              className="text-xs text-[#444] hover:text-[#888] flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={10} className={pipeLoading ? 'animate-spin' : ''}/>
              Refresh
            </button>
          </div>
          {pipeLoading && Object.keys(lanes).length === 0 ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
              ))}
            </div>
          ) : (
            <PipelineBoard
              lanes={lanes}
              onAdvance={handleAdvance}
              advancing={advancing}
            />
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">

          {/* Quick nav — 2-col grid on mobile, stacked on desktop */}
          <div className="grid grid-cols-2 md:grid-cols-1 gap-2 md:gap-1.5">
            {[
              { to: '/series',    icon: Film,      label: 'Series'    },
              { to: '/vault',     icon: BookMarked, label: 'Vault'    },
              { to: '/analytics', icon: BarChart2,  label: 'Analytics'},
              { to: '/editor',    icon: Scissors,   label: 'Editor'   },
            ].map(({ to, icon: Icon, label }) => (
              <Link key={to} to={to}
                className="flex items-center justify-center md:justify-start gap-3 px-3 py-2.5 rounded border border-[var(--border)] text-[var(--text3)] hover:border-[var(--border2)] hover:text-[var(--text2)] transition-all text-sm">
                <Icon size={13}/> {label}
              </Link>
            ))}
          </div>

          {/* Vault stats */}
          {vaultStats && (
            <div className="border border-[var(--border)] rounded p-4 space-y-3">
              <h3 className="text-xs text-[var(--text3)] uppercase tracking-wide">Vault</h3>
              <div className="space-y-1.5">
                {[
                  { label: 'Total ideas', value: vaultStats.total      },
                  { label: 'Favourites',  value: vaultStats.favourites },
                  { label: 'Unused',      value: vaultStats.unused     },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between text-xs">
                    <span className="text-[var(--text3)]">{label}</span>
                    <span className="text-[var(--text2)]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vault recommendations */}
          {recommendations.length > 0 && (
            <div className="border border-[var(--border)] rounded p-4 space-y-3">
              <div className="flex items-center gap-2">
                <TrendingUp size={12} className="text-[var(--accent)]"/>
                <h3 className="text-xs text-[var(--text3)] uppercase tracking-wide">Ready to use</h3>
              </div>
              {recommendations.slice(0, 3).map((rec, i) => (
                <div key={i} className="text-xs space-y-1">
                  <div className="text-[var(--text)] truncate">{rec.title}</div>
                  <div className="text-[var(--text3)] leading-relaxed line-clamp-2">{rec.reason}</div>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${
                    rec.urgency === 'high' ? 'bg-[#c8b89a]/10 text-[var(--accent)]' : 'bg-[var(--surface2)] text-[var(--text3)]'
                  }`}>{rec.urgency}</span>
                </div>
              ))}
            </div>
          )}

          {/* Latest analytics insight */}
          {latestInsights && (
            <div className="border border-[#1a1a1a] rounded p-4 space-y-2">
              <div className="flex items-center gap-2">
                <BarChart2 size={12} className="text-[var(--accent)]"/>
                <h3 className="text-xs text-[var(--text3)] uppercase tracking-wide">Latest insight</h3>
              </div>
              <p className="text-xs text-[var(--text3)] leading-relaxed line-clamp-4">{latestInsights}</p>
              <Link to="/analytics" className="text-xs text-[var(--accent)] hover:underline">View analytics →</Link>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}