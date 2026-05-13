// frontend/src/pages/SeriesPage.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Clock, Copy, X, Download, ChevronRight, FileText, Scissors, Zap } from 'lucide-react'
import PageCTA from '../components/ui/PageCTA'
import { useStore } from '../store'
import { episodes as episodesApi } from '../lib/api'

const STATUS_COLORS = {
  draft:     '#555',
  generated: '#60a5fa',
  recorded:  '#c084fc',
  edited:    '#f59e0b',
  published: '#4ade80',
}

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function SeriesPage() {
  const { activeCategoryId, activeCategory } = useStore()
  const cat      = activeCategory?.()
  const navigate = useNavigate()

  const [episodes,  setEpisodes]  = useState([])
  const [loading,   setLoading]   = useState(true)
  const [duping,    setDuping]    = useState(null)
  const [selected,  setSelected]  = useState(null)  // full episode object for drawer
  const [loadingEp, setLoadingEp] = useState(null)

  useEffect(() => {
    if (!activeCategoryId) return
    setLoading(true)
    episodesApi.list({ categoryId: activeCategoryId, limit: 50 })
      .then(({ episodes }) => { setEpisodes(episodes || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activeCategoryId])

  async function openEpisode(ep) {
    setLoadingEp(ep.id)
    try {
      const { episode } = await episodesApi.get(ep.id)
      setSelected(episode)
    } catch {}
    setLoadingEp(null)
  }

  async function duplicateEp(ep, e) {
    e.stopPropagation()
    setDuping(ep.id)
    try {
      const { episode: clone } = await episodesApi.duplicate(ep.id)
      const params = new URLSearchParams({
        episodeNumber: clone.episode_number,
        trackName:     clone.track_name     || '',
        mood:          clone.track_mood     || '',
        genre:         clone.track_genre    || '',
      })
      navigate('/generate?' + params.toString())
    } catch {}
    setDuping(null)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif" style={{ color: 'var(--text)' }}>Series</h1>
        {cat && <p className="text-sm mt-1" style={{ color: 'var(--text3)' }}>{cat.name} · {episodes.length} episodes</p>}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text3)', padding: '40px 0', textAlign: 'center' }}>Loading...</div>
      ) : episodes.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {episodes.map(ep => (
            <div
              key={ep.id}
              onClick={() => openEpisode(ep)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '14px 18px', background: 'var(--surface)',
                border: '1px solid var(--border)', borderRadius: 'var(--r)',
                cursor: 'pointer', transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border2)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <span style={{ fontSize: '0.8125rem', fontFamily: 'monospace', color: 'var(--text3)', width: 32, flexShrink: 0 }}>
                #{ep.episode_number}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9375rem', color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ep.track_name}
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text3)', marginTop: 2 }}>
                  {ep.track_mood}{ep.track_genre ? ` · ${ep.track_genre}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                {ep.yt_retention_score && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem', color: 'rgba(74,222,128,1)' }}>
                    <TrendingUp size={11}/> {ep.yt_retention_score}%
                  </span>
                )}
                {ep.published_at && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8125rem', color: 'var(--text3)' }}>
                    <Clock size={11}/> {new Date(ep.published_at).toLocaleDateString()}
                  </span>
                )}
                <button
                  onClick={e => duplicateEp(ep, e)}
                  disabled={duping === ep.id}
                  style={{ padding: 6, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer' }}
                  title="Duplicate as starting point"
                >
                  <Copy size={13}/>
                </button>
                <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: '0.6875rem', border: `1px solid ${STATUS_COLORS[ep.status]}40`, color: STATUS_COLORS[ep.status] }}>
                  {ep.status}
                </span>
                <ChevronRight size={14} style={{ color: 'var(--text3)', opacity: loadingEp === ep.id ? 0.3 : 1 }}/>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <PageCTA
          icon="✦"
          title="No episodes yet"
          subtitle="Ideate with KB, commit your idea, then generate your first episode. It takes about 2 minutes."
          primaryLabel="Open KB"
          primaryAction={() => window.dispatchEvent(new CustomEvent('kb:open'))}
          secondaryLabel="Go to Dashboard"
          secondaryRoute="/dashboard"
        />
      )}

      {/* Episode content drawer */}
      {selected && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'flex-end',
        }} onClick={() => setSelected(null)}>
          <div
            style={{
              width: '100%', maxWidth: 680, height: '100%',
              background: 'var(--surface)', borderLeft: '1px solid var(--border)',
              overflowY: 'auto', padding: '24px 28px',
              display: 'flex', flexDirection: 'column', gap: 24,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 4 }}>Episode #{selected.episode_number}</div>
                <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '1.4rem', color: 'var(--text)', margin: 0 }}>
                  {selected.track_name}
                </h2>
                <div style={{ fontSize: '0.875rem', color: 'var(--text3)', marginTop: 4 }}>
                  {selected.track_mood}{selected.track_genre ? ` · ${selected.track_genre}` : ''}
                  {selected.bpm ? ` · ${selected.bpm} BPM` : ''}
                </div>
              </div>
              <button onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
                <X size={20}/>
              </button>
            </div>

            {/* Downloads */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selected.vo_script && (
                <button
                  onClick={() => downloadFile(selected.vo_script, `ep${selected.episode_number}-script.txt`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--accent-lo)', border: '1px solid var(--accent-mid)', borderRadius: 'var(--r-sm)', color: 'var(--accent)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Download size={13}/> VO Script
                </button>
              )}
              {selected.edl_clip_map && (
                <button
                  onClick={() => {
                    // Build EDL
                    const lines = selected.edl_clip_map.trim().split('\n')
                    let edl = 'TITLE: episode\nFCM: NON-DROP FRAME\n\n'
                    let n = 1
                    for (const line of lines) {
                      const parts = line.split('|').map(s => s.trim())
                      if (parts.length < 3) continue
                      const tc = t => { const p = t.split(':').map(Number); return p.length === 4 ? ((p[0]*3600+p[1]*60+p[2])*25)+p[3] : 0 }
                      const fmt = f => { const s=Math.floor(f/25); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}:${String(f%25).padStart(2,'0')}` }
                      const srcIn=tc(parts[0]), srcOut=tc(parts[1])
                      edl += `${String(n).padStart(3,'0')}  AX  V  C  ${fmt(srcIn)} ${fmt(srcOut)} ${fmt(srcIn)} ${fmt(srcOut)}\n* FROM CLIP NAME: ${parts[2]||''}\n\n`
                      n++
                    }
                    downloadFile(edl, `ep${selected.episode_number}.edl`)
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: 'var(--r-sm)', color: '#60a5fa', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Scissors size={13}/> EDL for DaVinci
                </button>
              )}
              {selected.shorts_scripts && (
                <button
                  onClick={() => downloadFile(JSON.stringify(selected.shorts_scripts, null, 2), `ep${selected.episode_number}-shorts.json`)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)', borderRadius: 'var(--r-sm)', color: '#a78bfa', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Zap size={13}/> Shorts
                </button>
              )}
            </div>

            {/* VO Script */}
            {selected.vo_script && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={11}/> VO Script
                </div>
                <pre style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)', padding: '16px', fontSize: '0.875rem',
                  color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word', maxHeight: 400, overflowY: 'auto', margin: 0,
                  fontFamily: "'Figtree', system-ui, sans-serif",
                }}>
                  {selected.vo_script}
                </pre>
              </div>
            )}

            {/* Shorts */}
            {selected.shorts_scripts?.length > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                  Short-form cuts
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selected.shorts_scripts.map((s, i) => (
                    <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '14px' }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>{s.title || `Short ${i+1}`}</div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text3)', lineHeight: 1.6 }}>{s.script || s.description || JSON.stringify(s)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            {(selected.hook || selected.tiktok_caption) && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
                  Metadata
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selected.hook && (
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '12px' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 4 }}>HOOK</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text2)' }}>{selected.hook}</div>
                    </div>
                  )}
                  {selected.tiktok_caption && (
                    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '12px' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: 4 }}>CAPTION</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text2)' }}>{selected.tiktok_caption}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}