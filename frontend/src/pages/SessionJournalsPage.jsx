// frontend/src/pages/SessionJournalsPage.jsx
// View all voice memos from Companion sessions.
// Memos can be loaded directly into Generate from here.

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mic, Clock, ChevronRight, Trash2, ExternalLink, BookOpen } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'

export default function SessionJournalsPage() {
  const { activeCategoryId } = useStore()
  const navigate = useNavigate()
  const [sessions, setSessions]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [expanded, setExpanded]   = useState(null)
  const [deleting, setDeleting]   = useState(null)

  useEffect(() => {
    setLoading(true)
    api.get('/session?limit=50' + (activeCategoryId ? `&categoryId=${activeCategoryId}` : ''))
      .then(({ sessions }) => setSessions(sessions || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeCategoryId])

  async function handleDelete(id) {
    if (!confirm('Delete this session?')) return
    setDeleting(id)
    await api.delete(`/session/${id}`).catch(() => {})
    setSessions(prev => prev.filter(s => s.id !== id))
    setDeleting(null)
  }

  function handleUseInEpisode(session) {
    // Pass voice memo to Generate page via sessionStorage
    sessionStorage.setItem('companion_memo', JSON.stringify({
      voiceMemoText: session.voice_memo_text,
      sessionId:     session.id,
      title:         session.title,
    }))
    navigate('/generate')
  }

  const withMemo    = sessions.filter(s => s.voice_memo_text)
  const withoutMemo = sessions.filter(s => !s.voice_memo_text)

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '1.75rem', color: 'var(--text)' }}>
          Session journals
        </h1>
        <p style={{ fontSize: '0.9375rem', color: 'var(--text3)', marginTop: 4 }}>
          Voice memos captured from the Companion app
        </p>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text3)', padding: '40px 0', textAlign: 'center' }}>Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div style={{ border: '1px dashed var(--border2)', borderRadius: 'var(--r)', padding: '3rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Mic size={28} style={{ color: 'var(--text3)', opacity: 0.4 }}/>
          <div style={{ color: 'var(--text2)', fontWeight: 500 }}>No sessions yet</div>
          <div style={{ color: 'var(--text3)', fontSize: '0.875rem' }}>
            Open the Companion app to start recording
          </div>
          <a href="/companion" target="_blank"
            style={{ marginTop: 8, padding: '10px 20px', background: 'var(--accent)', color: '#080c10', borderRadius: 'var(--r-sm)', fontSize: '0.9rem', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <ExternalLink size={14}/> Open Companion
          </a>
        </div>
      ) : (
        <>
          {withMemo.length > 0 && (
            <section>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
                Voice memos — {withMemo.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {withMemo.map(s => (
                  <div key={s.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r)', overflow: 'hidden', background: 'var(--surface)' }}>
                    {/* Header */}
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer' }}
                      onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', flexShrink: 0 }}/>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 500, color: 'var(--text)', fontSize: '0.9375rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.title || 'Untitled session'}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Clock size={11}/>
                          {new Date(s.recorded_at || s.created_at).toLocaleString()}
                          {s.duration_ms && <span>· {Math.round(s.duration_ms / 60000)}m</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} style={{ color: 'var(--text3)', transform: expanded === s.id ? 'rotate(90deg)' : 'none', transition: '0.15s', flexShrink: 0 }}/>
                    </div>

                    {/* Expanded memo */}
                    {expanded === s.id && (
                      <div style={{ borderTop: '1px solid var(--border)', padding: '16px' }}>
                        <div style={{ fontSize: '0.9375rem', color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 16, maxHeight: 360, overflowY: 'auto' }}>
                          {s.voice_memo_text}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            onClick={() => handleUseInEpisode(s)}
                            style={{ flex: 1, padding: '10px 16px', background: 'var(--accent)', color: '#080c10', border: 'none', borderRadius: 'var(--r-sm)', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                          >
                            <BookOpen size={14}/> Use in episode
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            disabled={deleting === s.id}
                            style={{ padding: '10px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 'var(--r-sm)', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                          >
                            <Trash2 size={14}/>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {withoutMemo.length > 0 && (
            <section>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
                Recordings without memo — {withoutMemo.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {withoutMemo.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border2)', flexShrink: 0 }}/>
                    <div style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text3)' }}>
                      {s.title || 'Untitled'} · {new Date(s.recorded_at || s.created_at).toLocaleDateString()}
                    </div>
                    <button onClick={() => handleDelete(s.id)} disabled={deleting === s.id}
                      style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4 }}>
                      <Trash2 size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
