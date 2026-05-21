// frontend/src/pages/EpisodePage.jsx
// Unified episode workspace — replaces the 5 separate episode pages.
// Tabs: Script · Storyboard · Teleprompter · Shorts · Review
// KB is always accessible via the orb and knows this episode is active.

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  FileText, Film, Mic, Zap, BarChart2,
  ChevronLeft, ChevronRight, Globe, Clock,
  Copy, Check, RefreshCw,
} from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi, analytics as analyticsApi } from '../lib/api'

// Tab components — lazy loaded inline to keep this file manageable
import GenerateTab    from '../components/episode/GenerateTab'
import TeleprompterTab from '../components/episode/TeleprompterTab'
import StoryboardTab  from '../components/episode/StoryboardTab'
import ShortsTab      from '../components/episode/ShortsTab'
import ReviewTab      from '../components/episode/ReviewTab'

const TABS = [
  { key: 'script',       label: 'Script',       icon: FileText },
  { key: 'teleprompter', label: 'Teleprompter',  icon: Mic      },
  { key: 'storyboard',   label: 'Storyboard',    icon: Film     },
  { key: 'shorts',       label: 'Shorts',        icon: Zap      },
  { key: 'review',       label: 'Review',        icon: BarChart2},
]

const STATUS_COLORS = {
  draft:     '#555',
  generated: '#c8b89a',
  ready:     '#c8b89a',
  recorded:  '#4080c8',
  edited:    '#8060c8',
  published: '#4ade80',
}

export default function EpisodePage() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const { activeCategoryId, setActiveEpisodeId, notify } = useStore()
  const [episode,  setEpisode]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState('script')
  const [copied,   setCopied]   = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Set active episode for KB context
  useEffect(() => {
    if (id) setActiveEpisodeId(id)
    return () => setActiveEpisodeId(null)
  }, [id])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    episodesApi.get(id)
      .then(({ episode }) => { setEpisode(episode); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id])

  async function deleteEpisode() {
    if (!id || deleting) return
    setDeleting(true)
    try {
      const { supabase: sb } = await import('../lib/supabase')
      const { data: { user } } = await sb.auth.getUser()
      await sb.from('episodes').delete().eq('id', id).eq('user_id', user.id)
      notify('Episode deleted', 'success')
      navigate('/pipeline')
    } catch (err) { notify(err.message, 'error'); setDeleting(false) }
  }

  async function advanceStatus(nextStatus) {
    try {
      await episodesApi.updateStatus(id, nextStatus)
      setEpisode(prev => ({ ...prev, status: nextStatus }))
      notify(`Marked as ${nextStatus}`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <div style={{ width: 20, height: 20, border: '2px solid rgba(74,222,128,0.2)', borderTopColor: 'rgba(74,222,128,1)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
    </div>
  )

  if (!episode) return (
    <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>
      Episode not found.
      <br/>
      <button onClick={() => navigate('/pipeline')} style={{ marginTop: 12, color: 'rgba(74,222,128,0.7)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>← Back to pipeline</button>
    </div>
  )

  const statusColor = STATUS_COLORS[episode.status] || '#555'

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* Episode header */}
      <div style={{ marginBottom: 20 }}>
        <button
          onClick={() => navigate('/pipeline')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.3)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", marginBottom: 12, padding: 0 }}
        >
          <ChevronLeft size={12}/> Pipeline
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          {/* Episode number badge */}
          <div style={{ width: 40, height: 40, borderRadius: 10, background: statusColor + '15', border: `1px solid ${statusColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: statusColor, flexShrink: 0, fontFamily: "'Syne',sans-serif" }}>
            {episode.episode_number || '?'}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#e8eaed', fontFamily: "'Syne',sans-serif", margin: 0, lineHeight: 1.3 }}>
              {episode.track_name || 'Untitled Episode'}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: statusColor + '12', color: statusColor, border: `1px solid ${statusColor}25`, fontFamily: "'Figtree',sans-serif", textTransform: 'capitalize' }}>
                {episode.status}
              </span>
              {episode.yt_retention_score > 0 && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>
                  {episode.yt_retention_score}/100 retention
                </span>
              )}
              {episode.published_at && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: "'Figtree',sans-serif" }}>
                  Published {new Date(episode.published_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              )}
            </div>
          </div>

          {/* Status advance button */}
          {/* Delete episode */}
          <button
            onClick={() => { if (window.confirm('Delete this episode? This cannot be undone.')) deleteEpisode() }}
            disabled={deleting}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)', background: 'transparent', color: 'rgba(248,113,113,0.6)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", flexShrink: 0 }}
          >
            {deleting ? '...' : 'Delete'}
          </button>

          {episode.status !== 'published' && (
            <div style={{ flexShrink: 0 }}>
              {episode.status === 'draft' && (
                <button onClick={() => advanceStatus('generated')} style={advBtn(statusColor)}>Mark generated <ChevronRight size={11}/></button>
              )}
              {episode.status === 'generated' && (
                <button onClick={() => advanceStatus('recorded')} style={advBtn(statusColor)}>Mark recorded <ChevronRight size={11}/></button>
              )}
              {episode.status === 'recorded' && (
                <button onClick={() => advanceStatus('edited')} style={advBtn(statusColor)}>Mark edited <ChevronRight size={11}/></button>
              )}
              {episode.status === 'edited' && (
                <button onClick={() => advanceStatus('published')} style={advBtn('#4ade80')}><Globe size={11}/> Publish</button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 0 }}>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px',
                borderRadius: '8px 8px 0 0',
                border: 'none',
                borderBottom: active ? '2px solid rgba(74,222,128,1)' : '2px solid transparent',
                background: active ? 'rgba(74,222,128,0.05)' : 'transparent',
                color: active ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: "'Figtree',sans-serif",
                fontWeight: active ? 600 : 400,
                transition: 'all 0.15s',
                marginBottom: -1,
              }}
            >
              <t.icon size={12}/>
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'script'       && <GenerateTab     episode={episode} onUpdate={setEpisode} />}
        {tab === 'teleprompter' && <TeleprompterTab episode={episode} onUpdate={setEpisode} />}
        {tab === 'storyboard'   && <StoryboardTab   episode={episode} onUpdate={setEpisode} />}
        {tab === 'shorts'       && <ShortsTab        episode={episode} onUpdate={setEpisode} />}
        {tab === 'review'       && <ReviewTab        episode={episode} onUpdate={setEpisode} />}
      </div>
    </div>
  )
}

function advBtn(color) {
  return {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '7px 12px', borderRadius: 8,
    border: `1px solid ${color}30`,
    background: color + '10',
    color: color,
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: "'Figtree',sans-serif",
  }
}
