// frontend/src/pages/AuthPage.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithMagicLink, signInWithEmail, signUp } from '../lib/supabase'

export default function AuthPage() {
  const [mode, setMode]       = useState('magic') // 'magic' | 'password' | 'signup'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]       = useState('')
  const [invite, setInvite]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState('')
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setLoading(true)

    try {
      if (mode === 'magic') {
        const { error } = await signInWithMagicLink(email)
        if (error) throw error
        setSent(true)
      } else if (mode === 'password') {
        const { error } = await signInWithEmail(email, password)
        if (error) throw error
        navigate('/')
      } else {
        const { error } = await signUp(email, password, name)
        if (error) throw error
        setSent(true)
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">

        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="text-3xl font-serif text-[#c8b89a] tracking-widest">WHISPACUTS</div>
          <div className="text-xs text-[#444] tracking-widest uppercase">AI Content Studio</div>
        </div>

        {sent ? (
          <div className="border border-[#c8b89a]/20 rounded p-6 text-center space-y-3">
            <div className="text-[#c8b89a]">Check your email</div>
            <div className="text-xs text-[#555]">
              {mode === 'magic'
                ? `We sent a magic link to ${email}`
                : `We sent a confirmation to ${email}`}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Mode tabs */}
            <div className="flex border border-[#1a1a1a] rounded overflow-hidden">
              {[
                { key: 'magic',    label: 'Magic link' },
                { key: 'password', label: 'Password'   },
                { key: 'signup',   label: 'Sign up'    },
              ].map(({ key, label }) => (
                <button
                  key={key} type="button"
                  onClick={() => setMode(key)}
                  className={`flex-1 py-2 text-xs transition-colors ${
                    mode === key
                      ? 'bg-[#c8b89a]/10 text-[#c8b89a]'
                      : 'text-[#444] hover:text-[#888]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs text-[#666]">Name</label>
                <input
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs text-[#666]">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@example.com"
                className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40"
              />
            </div>

            {mode !== 'magic' && (
              <div className="space-y-1">
                <label className="text-xs text-[#666]">Password</label>
                <input
                  type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  placeholder="••••••••"
                  className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40"
                />
              </div>
            )}

            {mode === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs text-[#666]">Invite code (optional)</label>
                <input
                  value={invite} onChange={e => setInvite(e.target.value)}
                  placeholder="abc123"
                  className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40"
                />
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 border border-red-900/30 bg-red-950/20 rounded px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading || !email}
              className="w-full py-3 bg-[#c8b89a] text-[#080808] font-medium rounded hover:bg-[#e8c87a] disabled:opacity-40 transition-all"
            >
              {loading ? 'Loading...' : mode === 'magic' ? 'Send magic link' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
