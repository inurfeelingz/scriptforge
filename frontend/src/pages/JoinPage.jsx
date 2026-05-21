// frontend/src/pages/JoinPage.jsx
// Collaborator join page — enter a session code to access a shared episode.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'

export default function JoinPage() {
  const { notify }   = useStore()
  const navigate     = useNavigate()
  const [code,       setCode]    = useState('')
  const [loading,    setLoading] = useState(false)
  const [error,      setError]   = useState('')

  async function handleJoin() {
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) return
    setLoading(true)
    setError('')

    try {
      const { supabase } = await import('../lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { navigate('/auth'); return }

      const res  = await fetch(`${import.meta.env.VITE_API_URL}/api/collab/join/${trimmed}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Session not found or expired')
        setLoading(false)
        return
      }

      const episodeId = data.session?.episode_id
      if (episodeId) {
        notify('Joined — loading episode', 'success')
        navigate(`/analytics/review/${episodeId}`)
      } else {
        notify('Joined session', 'success')
        navigate('/')
      }
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080a10',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Figtree', sans-serif",
    }}>
      <div style={{
        width: 'min(380px, calc(100vw - 40px))',
        padding: '36px 32px',
        borderRadius: 16,
        border: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <svg width="26" height="26" viewBox="0 0 64 64" fill="none">
            <rect width="64" height="64" rx="14" fill="#0a0f14"/>
            <polyline points="10,16 18,46 32,24 46,46 54,16"
              stroke="#4ade80" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
          <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)' }}>WhispaCuts</span>
        </div>

        <div style={{ fontSize: 20, fontWeight: 600, color: '#e8eaed', marginBottom: 6 }}>
          Join a session
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginBottom: 24, lineHeight: 1.5 }}>
          Enter the 8-character code your collaborator shared with you.
        </div>

        <input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          placeholder="e.g. AB12CD34"
          maxLength={8}
          autoFocus
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 14px',
            borderRadius: 9,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)',
            color: '#e8eaed',
            fontSize: 20,
            fontFamily: 'monospace',
            letterSpacing: '0.15em',
            outline: 'none',
            textAlign: 'center',
            marginBottom: 12,
          }}
        />

        {error && (
          <div style={{ fontSize: 12, color: 'rgba(255,80,80,0.7)', marginBottom: 12, textAlign: 'center' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleJoin}
          disabled={loading || code.trim().length < 6}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: 9,
            border: 'none',
            background: code.trim().length >= 6 && !loading
              ? 'rgba(74,222,128,1)'
              : 'rgba(255,255,255,0.06)',
            color: code.trim().length >= 6 && !loading ? '#080808' : 'rgba(255,255,255,0.2)',
            fontSize: 14,
            fontWeight: 600,
            cursor: loading || code.trim().length < 6 ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          {loading ? 'Joining...' : 'Join session'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <a href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', textDecoration: 'none' }}>
            Back to WhispaCuts
          </a>
        </div>
      </div>
    </div>
  )
}
