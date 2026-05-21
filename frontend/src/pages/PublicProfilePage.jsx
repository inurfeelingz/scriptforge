// frontend/src/pages/PublicProfilePage.jsx
// Public creator profile at /u/:username — shareable, no auth required.
// Shows published episodes, series bible summary, and "built with WhispaCuts" badge.

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Globe, Film, BarChart2, ExternalLink } from 'lucide-react'
import { api } from '../lib/api'

const GREEN = 'rgba(74,222,128,1)'

export default function PublicProfilePage() {
  const { username } = useParams()
  const [profile,  setProfile]  = useState(null)
  const [episodes, setEpisodes] = useState([])
  const [bible,    setBible]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!username) return
    setLoading(true)
    // Public endpoint — no auth required
    fetch(`${import.meta.env.VITE_API_URL || '/api'}/public/profile/${username}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        setProfile(data.profile)
        setEpisodes(data.episodes || [])
        setBible(data.seriesBible || null)
        setLoading(false)
      })
      .catch(err => {
        if (err === 404) setNotFound(true)
        setLoading(false)
      })
  }, [username])

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#080c10', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 20, height: 20, border: '2px solid rgba(74,222,128,0.2)', borderTopColor: GREEN, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
    </div>
  )

  if (notFound || !profile) return (
    <div style={{ minHeight: '100vh', background: '#080c10', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Figtree',sans-serif" }}>
      <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>✦</div>
      <div style={{ fontSize: 18, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Profile not found</div>
      <a href="https://whispacuts.com" style={{ fontSize: 13, color: 'rgba(74,222,128,0.6)', textDecoration: 'none' }}>whispacuts.com</a>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#080c10', color: '#e8eaed', fontFamily: "'Figtree',sans-serif" }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '20px 0', marginBottom: 40 }}>
        <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <a href="https://whispacuts.com" style={{ textDecoration: 'none' }}>
            <svg width="24" height="24" viewBox="0 0 64 64" fill="none">
              <rect width="64" height="64" rx="14" fill="#0a0f14"/>
              <polyline points="10,16 18,46 32,24 46,46 54,16" stroke="#4ade80" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </a>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>Built with WhispaCuts</div>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 20px 80px' }}>

        {/* Creator card */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: GREEN, fontFamily: "'Syne',sans-serif", marginBottom: 14 }}>
            {(profile.display_name || 'C')[0].toUpperCase()}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#e8eaed', fontFamily: "'Syne',sans-serif", margin: '0 0 6px' }}>
            {profile.display_name}
          </h1>
          {profile.niche && (
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>{profile.niche}</div>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)' }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontFamily: "'Syne',sans-serif" }}>{episodes.length}</span>{' '}episodes
            </div>
          </div>
        </div>

        {/* Series bible summary */}
        {bible?.showPremise && (
          <div style={{ marginBottom: 40, padding: '20px', borderRadius: 12, border: '1px solid rgba(74,222,128,0.08)', background: 'rgba(74,222,128,0.02)' }}>
            <div style={{ fontSize: 10, color: 'rgba(74,222,128,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>About the show</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', lineHeight: 1.7, marginBottom: 14 }}>{bible.showPremise}</div>
            {bible.recurringThemes?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {bible.recurringThemes.slice(0, 4).map((t, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 99, border: '1px solid rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.35)' }}>{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Published episodes */}
        {episodes.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
              Episodes ({episodes.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {episodes.map(ep => (
                <div key={ep.id} style={{ padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: GREEN, fontFamily: "'Syne',sans-serif", flexShrink: 0 }}>
                    {ep.episode_number || '—'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.75)', fontWeight: 500, marginBottom: 2 }}>{ep.track_name}</div>
                    {ep.published_at && (
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
                        {new Date(ep.published_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    )}
                  </div>
                  {ep.youtube_video_id && (
                    <a href={`https://youtube.com/watch?v=${ep.youtube_video_id}`} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
                      <ExternalLink size={13}/>
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {episodes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'rgba(255,255,255,0.2)', fontSize: 13 }}>
            No published episodes yet.
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 60, textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.15)' }}>
          <a href="https://whispacuts.com" style={{ color: 'rgba(74,222,128,0.4)', textDecoration: 'none' }}>Create your show with WhispaCuts</a>
        </div>
      </div>
    </div>
  )
}
