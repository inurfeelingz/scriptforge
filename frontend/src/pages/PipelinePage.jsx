// frontend/src/pages/PipelinePage.jsx
// Episode pipeline — horizontal swimlanes showing every episode by status.
// One-tap advancement. Tap any episode to open its workspace.
// Replaces Dashboard.

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, Mic, Scissors, Upload, Globe,
  Plus, ChevronRight, AlertTriangle, RefreshCw,
  Clock, TrendingUp, Zap,
} from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi, dashboard as dashboardApi } from '../lib/api'

const LANES = [
  { key: 'draft',     label: 'Draft',      icon: Sparkles, color: '#555',    bg: '#0d0d0d',    next: 'ready',     nextLabel: 'Mark generated' },
  { key: 'ready',     label: 'Generated',  icon: Mic,      color: '#c8b89a', bg: '#c8b89a08',  next: 'recorded',  nextLabel: 'Mark recorded'  },
  { key: 'recorded',  label: 'Recorded',   icon: Scissors, color: '#4080c8', bg: '#4080c808',  next: 'edited',    nextLabel: 'Mark edited'    },
  { key: 'edited',    label: 'Edited',     icon: Upload,   color: '#8060c8', bg: '#8060c808',  next: 'published', nextLabel: 'Publish'        },
  { key: 'published', label: 'Published',  icon: Globe,    color: '#4ade80', bg: '#4ade8008',  next: null,        nextLabel: null             },
]

export default function PipelinePage() {
  const { activeCategoryId, notify } = useStore()
  const navigate = useNavigate()
  const [episodes,  setEpisodes]  = useState([])
  const [brief,     setBrief]     = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [advancing, setAdvancing] = useState(null)
  const [openLane,  setOpenLane]  = useState('ready')
  const [sheetEp,   setSheetEp]   = useState(null)  // episode for mobile bottom sheet

  const load = useCallback(async () => {
    if (!activeCategoryId) return
    setLoading(true)
    try {
      const [{ episodes: eps }, briefData] = await Promise.allSettled([
        episodesApi.list({ categoryId: activeCategoryId, limit: 60 }),
        dashboardApi.brief(activeCategoryId),
      ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : {}))
      setEpisodes(eps || [])
      setBrief(briefData?.brief || null)
    } catch {}
    setLoading(false)
  }, [activeCategoryId])

  useEffect(() => { load() }, [load])

  async function advance(ep, nextStatus, e) {
    e.stopPropagation()
    setAdvancing(ep.id)
    try {
      await episodesApi.updateStatus(ep.id, nextStatus)
      setEpisodes(prev => prev.map(e => e.id === ep.id ? { ...e, status: nextStatus } : e))
      notify(`"${ep.track_name}" → ${nextStatus}`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    }
    setAdvancing(null)
  }

  const lanes = LANE_KEYS_TO_EPISODES(episodes)

  // Total in flight (not draft, not published)
  const inFlight = (lanes.ready?.length || 0) + (lanes.recorded?.length || 0) + (lanes.edited?.length || 0)

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 0 40px' }}>

      {/* Daily brief */}
      {brief?.directive && (
        <div style={{
          marginBottom: 20,
          padding: '14px 16px',
          borderRadius: 10,
          border: `1px solid ${brief.isOverdue ? 'rgba(255,150,50,0.2)' : 'rgba(74,222,128,0.12)'}`,
          background: brief.isOverdue ? 'rgba(255,150,50,0.04)' : 'rgba(74,222,128,0.03)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          {brief.isOverdue
            ? <AlertTriangle size={14} style={{ color: 'rgba(255,150,50,0.7)', flexShrink: 0 }}/>
            : <Zap size={14} style={{ color: 'rgba(74,222,128,0.7)', flexShrink: 0 }}/>
          }
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.5 }}>
              {brief.directive}
            </div>
          </div>
          <button
            onClick={() => navigate('/generate')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.8)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", flexShrink: 0 }}
          >
            {brief.action === 'GENERATE' ? <Sparkles size={11}/> : <ChevronRight size={11}/>}
            {brief.action === 'GENERATE' ? 'Generate' : brief.action === 'RECORD' ? 'Record' : brief.action === 'EDIT' ? 'Edit' : 'View'}
          </button>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'In flight',  value: inFlight,                    icon: TrendingUp },
          { label: 'Published',  value: lanes.published?.length || 0, icon: Globe      },
          { label: 'Total',      value: episodes.length,              icon: Clock      },
        ].map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
            <s.icon size={12} style={{ color: 'rgba(255,255,255,0.3)' }}/>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontFamily: "'Syne',sans-serif" }}>{s.value}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</span>
          </div>
        ))}
        <button
          onClick={() => navigate('/generate')}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.8)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
        >
          <Plus size={12}/> New episode
        </button>
      </div>

      {/* Swimlanes */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)', fontSize: 13, fontFamily: "'Figtree',sans-serif" }}>Loading pipeline...</div>
      ) : episodes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', border: '1px dashed rgba(255,255,255,0.07)', borderRadius: 12 }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>✦</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.5)', fontFamily: "'Syne',sans-serif", marginBottom: 8 }}>No episodes yet</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.65, maxWidth: 320, margin: '0 auto 20px' }}>
            Start by recording a voice memo in Companion while you work. Then open KB and it will help you turn that memo into a full episode.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => navigate('/')} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.8)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}>
              Open KB
            </button>
            <button onClick={() => navigate('/generate')} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}>
              Generate manually
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {LANES.map(lane => {
            const eps    = lanes[lane.key] || []
            const isOpen = openLane === lane.key
            const LaneIcon = lane.icon

            return (
              <div key={lane.key} style={{ borderRadius: 10, border: `1px solid ${isOpen ? lane.color + '30' : 'rgba(255,255,255,0.05)'}`, overflow: 'hidden', transition: 'border-color 0.2s' }}>

                {/* Lane header */}
                <button
                  onClick={() => setOpenLane(isOpen ? null : lane.key)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: isOpen ? lane.bg : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', transition: 'background 0.2s' }}
                >
                  <LaneIcon size={13} style={{ color: lane.color, flexShrink: 0 }}/>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isOpen ? lane.color : 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif" }}>
                    {lane.label}
                  </span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: eps.length ? lane.bg : 'rgba(255,255,255,0.03)', color: eps.length ? lane.color : 'rgba(255,255,255,0.2)', border: `1px solid ${eps.length ? lane.color + '30' : 'rgba(255,255,255,0.05)'}`, fontFamily: "'Figtree',sans-serif" }}>
                    {eps.length}
                  </span>
                  <ChevronRight size={12} style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.2)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}/>
                </button>

                {/* Episodes */}
                {isOpen && eps.length === 0 && (
                  <div style={{ padding: '12px 16px', fontSize: 12, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    No episodes here yet
                  </div>
                )}

                {isOpen && eps.map(ep => (
                  <div
                    key={ep.id}
                    onClick={() => { if (window.innerWidth < 768) setSheetEp(ep); else navigate(`/episode/${ep.id}`) }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Episode number */}
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: lane.bg, border: `1px solid ${lane.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: lane.color, flexShrink: 0, fontFamily: "'Syne',sans-serif" }}>
                      {ep.episode_number || '—'}
                    </div>

                    {/* Title + meta */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: "'Figtree',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {ep.track_name || 'Untitled'}
                      </div>
                      {ep.yt_retention_score > 0 && (
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>
                          {ep.yt_retention_score}/100 retention
                        </div>
                      )}
                    </div>

                    {/* Advance button */}
                    {lane.next && (
                      <button
                        onClick={e => advance(ep, lane.next, e)}
                        disabled={advancing === ep.id}
                        style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${lane.color}30`, background: 'transparent', color: lane.color, cursor: advancing === ep.id ? 'wait' : 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif", flexShrink: 0, opacity: advancing === ep.id ? 0.4 : 1, transition: 'all 0.15s' }}
                        onMouseEnter={e => { if (advancing !== ep.id) e.currentTarget.style.background = lane.bg }}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        {advancing === ep.id ? '...' : lane.nextLabel}
                      </button>
                    )}

                    <ChevronRight size={12} style={{ color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}/>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Mobile episode action bottom sheet
function EpisodeBottomSheet({ ep, onClose, onNavigate }) {
  const actions = [
    { label: 'Script',       emoji: '✦', tab: 'script'       },
    { label: 'Teleprompter', emoji: '▶', tab: 'teleprompter' },
    { label: 'Storyboard',   emoji: '⬡', tab: 'storyboard'   },
    { label: 'Review',       emoji: '▲', tab: 'review'       },
  ]
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.5)' }}/>
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 71, background: 'rgba(8,10,16,0.98)', borderRadius: '20px 20px 0 0', border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none', padding: '20px 16px 40px', backdropFilter: 'blur(20px)' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.15)', margin: '0 auto 16px' }}/>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.8)', fontFamily: "'Syne',sans-serif", marginBottom: 4 }}>
          {ep.track_name || 'Untitled'}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginBottom: 20, textTransform: 'capitalize' }}>
          Ep {ep.episode_number || '?'} · {ep.status}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {actions.map(a => (
            <button
              key={a.tab}
              onClick={() => onNavigate(`/episode/${ep.id}?tab=${a.tab}`)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '18px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.03)', cursor: 'pointer' }}
            >
              <span style={{ fontSize: 24 }}>{a.emoji}</span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif" }}>{a.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => onNavigate(`/episode/${ep.id}`)}
          style={{ width: '100%', marginTop: 10, padding: '13px', borderRadius: 10, border: 'none', background: 'rgba(74,222,128,0.9)', color: '#080808', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: "'Figtree',sans-serif" }}
        >
          Open episode
        </button>
      </div>
    </>
  )
}

function LANE_KEYS_TO_EPISODES(episodes) {
  const map = { draft: [], ready: [], recorded: [], edited: [], published: [] }
  for (const ep of episodes) {
    const key = ep.status === 'generated' ? 'ready' : ep.status
    if (map[key]) map[key].push(ep)
    else map.draft.push(ep)
  }
  // Sort each lane by episode number desc
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => (b.episode_number || 0) - (a.episode_number || 0))
  }
  return map
}