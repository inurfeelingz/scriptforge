// frontend/src/pages/AuthPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithMagicLink, signInWithEmail, signUp, resetPassword } from '../lib/supabase'

export default function AuthPage() {
  const [mode, setMode]         = useState('magic') // 'magic' | 'password' | 'signup'
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]         = useState('')
  const [invite, setInvite]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [sent, setSent]         = useState(false)
  const [sentType, setSentType] = useState('') // 'magic' | 'reset'
  const [error, setError]       = useState('')
  const [showReset, setShowReset] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      if (mode === 'magic') {
        const { error } = await signInWithMagicLink(email)
        if (error) throw error
        setSentType('magic'); setSent(true)
      } else if (mode === 'password') {
        const { error } = await signInWithEmail(email, password)
        if (error) throw error
        navigate('/')
      } else {
        const { error } = await signUp(email, password, name)
        if (error) throw error
        setSentType('magic'); setSent(true)
      }
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  async function handleReset(e) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const { error } = await resetPassword(email)
      if (error) throw error
      setSentType('reset'); setSent(true)
    } catch (err) { setError(err.message) }
    setLoading(false)
  }

  const inputStyle = {
    width: '100%', background: 'var(--surface2)', border: '1px solid var(--border2)',
    borderRadius: 'var(--r-sm)', padding: '10px 14px', fontSize: '1rem',
    color: 'var(--text)', fontFamily: 'inherit', outline: 'none',
  }
  const btnStyle = {
    width: '100%', padding: '12px', background: 'var(--accent)', color: '#080c10',
    border: 'none', borderRadius: 'var(--r-sm)', fontSize: '1rem', fontWeight: 700,
    fontFamily: 'inherit', cursor: 'pointer', opacity: loading ? 0.5 : 1,
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <img src="/icon-mark.svg" style={{ width: 42, height: 42 }} alt="WhispaCuts"/>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 28, color: 'var(--text)', letterSpacing: '-0.5px' }}>
            Whispa<span style={{ color: 'var(--accent)' }}>Cuts</span>
          </div>
        </div>

        {/* Sent confirmation */}
        {sent ? (
          <div style={{ border: '1px solid var(--border2)', borderRadius: 'var(--r)', padding: '24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text)' }}>Check your email</div>
            <div style={{ fontSize: '0.9rem', color: 'var(--text3)' }}>
              {sentType === 'reset'
                ? `Password reset link sent to ${email}`
                : `We sent a ${mode === 'magic' ? 'magic link' : 'confirmation'} to ${email}`}
            </div>
            <button
              onClick={() => { setSent(false); setShowReset(false) }}
              style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit' }}
            >
              ← Back to sign in
            </button>
          </div>

        ) : showReset ? (
          /* Password reset form */
          <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text)' }}>Reset password</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text3)' }}>
              Enter your email and we'll send a reset link.
            </div>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required style={inputStyle}
            />
            {error && (
              <div style={{ fontSize: '0.875rem', color: 'var(--red)', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 'var(--r-sm)', padding: '8px 12px' }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={loading || !email} style={btnStyle}>
              {loading ? 'Sending...' : 'Send reset link'}
            </button>
            <button type="button" onClick={() => setShowReset(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit' }}>
              ← Back to sign in
            </button>
          </form>

        ) : (
          /* Main auth form */
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Mode tabs */}
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
              {[
                { key: 'magic',    label: 'Magic link' },
                { key: 'password', label: 'Password'   },
                { key: 'signup',   label: 'Sign up'    },
              ].map(({ key, label }) => (
                <button key={key} type="button" onClick={() => { setMode(key); setError('') }}
                  style={{
                    flex: 1, padding: '10px 0', fontSize: '0.9rem', cursor: 'pointer',
                    border: 'none', fontFamily: 'inherit', transition: 'all 0.15s',
                    background: mode === key ? 'var(--active-bg)' : 'transparent',
                    color: mode === key ? 'var(--text)' : 'var(--text3)',
                    fontWeight: mode === key ? 500 : 400,
                  }}
                >{label}</button>
              ))}
            </div>

            {mode === 'signup' && (
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name" style={inputStyle}/>
            )}

            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required style={inputStyle}/>

            {mode !== 'magic' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••" required style={inputStyle}/>
                {mode === 'password' && (
                  <button type="button" onClick={() => { setShowReset(true); setError('') }}
                    style={{ alignSelf: 'flex-end', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: '0.875rem', fontFamily: 'inherit' }}>
                    Forgot password?
                  </button>
                )}
              </div>
            )}

            {mode === 'signup' && (
              <input value={invite} onChange={e => setInvite(e.target.value)}
                placeholder="Invite code (optional)" style={inputStyle}/>
            )}

            {error && (
              <div style={{ fontSize: '0.875rem', color: 'var(--red)', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 'var(--r-sm)', padding: '8px 12px' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading || !email} style={btnStyle}>
              {loading ? 'Loading...' : mode === 'magic' ? 'Send magic link' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}