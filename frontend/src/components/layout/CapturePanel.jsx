// frontend/src/components/layout/CapturePanel.jsx
// Ambient session capture — pure speech-to-text, no audio recording.
// Runs indefinitely using manual restart loop (no 8-restart limit).
// All entries stored locally in browser until End Session.
// One single POST on end → saves as session journal → KB reads it.

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Mic, MicOff, Flag, Check, Loader2 } from 'lucide-react'
import { useStore } from '../../store'

const GREEN     = 'rgba(74,222,128,1)'
const GREEN_DIM = 'rgba(74,222,128,0.7)'
const GREEN_LOW = 'rgba(74,222,128,0.08)'
const GREEN_MID = 'rgba(74,222,128,0.2)'
const RED       = 'rgba(224,48,48,1)'
const RED_LOW   = 'rgba(224,48,48,0.1)'

function fmt(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
  return `${m}:${String(s % 60).padStart(2,'0')}`
}

const QUICK_MARKS = ['✨ Found something', '⚡ Energy peak', '❌ Not working', '🎯 Keep this', '🔁 Try again']

export default function CapturePanel({ onClose }) {
  const { activeCategoryId, activeCategory, notify } = useStore()
  const cat = activeCategory?.()

  const [active,      setActive]      = useState(false)   // session running
  const [entries,     setEntries]     = useState([])       // { id, text, ms, type }
  const [interim,     setInterim]     = useState('')       // live words appearing
  const [elapsedMs,   setElapsedMs]   = useState(0)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [error,       setError]       = useState('')
  const [markInput,   setMarkInput]   = useState('')
  const [showMark,    setShowMark]    = useState(false)
  const isMobile = window.innerWidth < 768

  const recRef       = useRef(null)
  const activeRef    = useRef(false)   // mirrors active state for callbacks
  const startRef     = useRef(null)
  const timerRef     = useRef(null)
  const feedRef      = useRef(null)
  const markInputRef = useRef(null)

  // ── Speech recognition engine ─────────────────────────────────────────────
  // Uses single-utterance mode with infinite manual restart.
  // No 8-restart limit — runs until user taps Stop.
  // no-speech is silently swallowed and triggers an immediate restart.

  const startRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR || !activeRef.current) return

    if (recRef.current) {
      try { recRef.current.abort() } catch {}
      recRef.current = null
    }

    const rec = new SR()
    rec.continuous     = false   // single utterance — restart manually for reliability
    rec.interimResults = true
    rec.lang           = 'en-US'
    recRef.current     = rec

    rec.onresult = (e) => {
      let fin = '', inter = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) fin += e.results[i][0].transcript
        else inter += e.results[i][0].transcript
      }
      if (inter || fin) setInterim(inter || fin)
      if (fin.trim()) {
        const ms = Date.now() - (startRef.current || Date.now())
        setEntries(prev => [...prev, { id: Date.now(), text: fin.trim(), ms, type: 'speech' }])
        setInterim('')
      }
    }

    rec.onend = () => {
      setInterim('')
      // Restart immediately — no delay, no limit
      if (activeRef.current) {
        setTimeout(() => startRecognition(), 80)
      }
    }

    rec.onerror = (e) => {
      // no-speech and audio-capture are normal pauses — restart silently
      if (e.error === 'no-speech' || e.error === 'audio-capture' || e.error === 'network') return
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        activeRef.current = false
        setActive(false)
        setError('Microphone blocked — allow mic access in browser settings')
      }
      // onend fires after onerror and handles restart
    }

    try { rec.start() } catch {}
  }, [])

  // ── Start session ─────────────────────────────────────────────────────────
  function startSession() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setError('Speech recognition not supported in this browser — try Chrome'); return }
    if (!activeCategoryId) { setError('No workspace selected'); return }

    setError('')
    setEntries([])
    setInterim('')
    setElapsedMs(0)
    setSaved(false)
    activeRef.current = true
    setActive(true)
    startRef.current  = Date.now()

    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startRef.current)
    }, 1000)

    // Small delay for mic hardware
    setTimeout(() => startRecognition(), 150)
  }

  // ── Stop session ──────────────────────────────────────────────────────────
  function stopSession() {
    activeRef.current = false
    setActive(false)
    setInterim('')
    clearInterval(timerRef.current)
    try { recRef.current?.stop() } catch {}
    recRef.current = null
  }

  // ── Add mark ──────────────────────────────────────────────────────────────
  function addMark(label) {
    if (!active) return
    const ms = Date.now() - (startRef.current || Date.now())
    setEntries(prev => [...prev, { id: Date.now(), text: label, ms, type: 'marker' }])
    setShowMark(false)
    setMarkInput('')
    navigator.vibrate?.([20, 10, 40])
  }

  // ── Save session ──────────────────────────────────────────────────────────
  async function saveSession() {
    if (!entries.length) { onClose(); return }
    setSaving(true)
    setError('')

    try {
      const { supabase: sb } = await import('../../lib/supabase')
      const { data: { session: sess } } = await sb.auth.getSession()
      const BASE = import.meta.env.VITE_API_URL || '/api'

      // Build transcript with timecodes
      const transcript = entries
        .map(e => {
          const m   = Math.floor(e.ms / 60000)
          const s   = Math.floor((e.ms % 60000) / 1000)
          const tc  = `${m}:${String(s).padStart(2,'0')}`
          const pfx = e.type === 'marker' ? `[MARK ${tc}]` : `[${tc}]`
          return `${pfx} ${e.text}`
        })
        .join('\n')

      const title = `Session ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${cat ? ' — ' + cat.name : ''}`

      const res = await fetch(`${BASE}/session`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.access_token}` },
        body: JSON.stringify({ categoryId: activeCategoryId, title }),
      })
      const { session: newSession } = await res.json()
      if (!res.ok) throw new Error(newSession?.error || 'Failed to create session')

      // Save entries and transcript
      await fetch(`${BASE}/session/${newSession.id}/entries/batch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.access_token}` },
        body: JSON.stringify({ entries: entries.map(e => ({ ...e, timestamp_ms: e.ms, energy: e.type === 'marker' ? 1 : 0.5 })) }),
      })

      // Update with transcript so KB can read it immediately
      await sb.from('session_journals').update({
        transcript,
        voice_memo_text: transcript.slice(0, 8000),
        status: 'ready',
        duration_ms: elapsedMs,
      }).eq('id', newSession.id)

      setSaved(true)
      notify(`Session saved — ${entries.filter(e=>e.type==='speech').length} entries, ${entries.filter(e=>e.type==='marker').length} marks`, 'success')
      setTimeout(() => onClose(), 1800)
    } catch (err) {
      setError(err.message || 'Save failed')
    }
    setSaving(false)
  }

  // Auto-scroll feed to bottom
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight
  }, [entries, interim])

  // Focus mark input when shown
  useEffect(() => {
    if (showMark) setTimeout(() => markInputRef.current?.focus(), 50)
  }, [showMark])

  // Cleanup on unmount — stop recognition but don't save
  useEffect(() => {
    return () => {
      activeRef.current = false
      clearInterval(timerRef.current)
      try { recRef.current?.abort() } catch {}
    }
  }, [])

  const speechCount = entries.filter(e => e.type === 'speech').length
  const markCount   = entries.filter(e => e.type === 'marker').length

  const panelStyle = isMobile ? {
    position: 'fixed', inset: 0, zIndex: 60,
    background: 'rgba(8,10,16,0.99)',
    display: 'flex', flexDirection: 'column',
  } : {
    position: 'fixed', top: 52, right: 16, bottom: 100, width: 360,
    zIndex: 60, borderRadius: 16,
    background: 'rgba(8,10,16,0.98)',
    border: `1px solid ${active ? 'rgba(224,48,48,0.25)' : 'rgba(74,222,128,0.12)'}`,
    boxShadow: active
      ? '-8px 0 40px rgba(224,48,48,0.08), 0 0 0 1px rgba(224,48,48,0.08)'
      : '-8px 0 40px rgba(0,0,0,0.6)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    backdropFilter: 'blur(20px)',
    transition: 'border-color 0.3s',
  }

  return (
    <>
      {isMobile && (
        <div
          onClick={!active ? onClose : undefined}
          style={{ position: 'fixed', inset: 0, zIndex: 59, background: 'rgba(0,0,0,0.5)' }}
        />
      )}

      <div style={panelStyle}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${active ? 'rgba(224,48,48,0.12)' : 'rgba(255,255,255,0.06)'}`, flexShrink: 0, transition: 'border-color 0.3s' }}>
          {/* Red glow line when active */}
          {active && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 0%, rgba(224,48,48,0) 10%, rgba(224,48,48,0.8) 50%, rgba(224,48,48,0) 90%, transparent 100%)', pointerEvents: 'none' }}/>
          )}

          <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? RED : 'rgba(255,255,255,0.15)', boxShadow: active ? '0 0 8px rgba(224,48,48,0.8)' : 'none', flexShrink: 0, animation: active ? 'pulse-rec 1.2s ease infinite' : 'none' }}/>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)', fontFamily: "'Figtree',sans-serif" }}>
              {active ? 'Recording' : saved ? 'Saved' : 'Capture'}
              {cat && <span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>· {cat.name}</span>}
            </div>
            {active && (
              <div style={{ fontSize: 11, color: 'rgba(224,48,48,0.7)', fontFamily: 'monospace', marginTop: 1 }}>
                {fmt(elapsedMs)} · {speechCount} utterance{speechCount !== 1 ? 's' : ''} · {markCount} mark{markCount !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          <button
            onClick={() => { if (!active) onClose() }}
            disabled={active}
            style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', cursor: active ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={active ? 'Stop recording first' : 'Close'}
          >
            <X size={13}/>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ margin: '8px 14px', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(224,80,80,0.2)', background: 'rgba(224,80,80,0.06)', fontSize: 12, color: 'rgba(224,80,80,0.8)', fontFamily: "'Figtree',sans-serif" }}>
            {error}
          </div>
        )}

        {/* Entry feed */}
        <div
          ref={feedRef}
          style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5 }}
        >
          {entries.length === 0 && !active && !saved && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12, textAlign: 'center', padding: '0 24px' }}>
              <div style={{ fontSize: 32, opacity: 0.15 }}>🎙</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.6 }}>
                Tap Start to begin capturing your session. Everything you say appears here with timestamps — no audio recorded.
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.5 }}>
                KB reads every saved session in your next conversation.
              </div>
            </div>
          )}

          {entries.length === 0 && active && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', border: '2px solid rgba(224,48,48,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'pulse-ring 1.5s ease infinite' }}>
                <Mic size={20} style={{ color: 'rgba(224,48,48,0.6)' }}/>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>
                Listening — start talking
              </div>
            </div>
          )}

          {entries.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 7, background: e.type === 'marker' ? 'rgba(74,222,128,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${e.type === 'marker' ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.04)'}` }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', flexShrink: 0, paddingTop: 2, minWidth: 32 }}>
                {fmt(e.ms)}
              </span>
              {e.type === 'marker' && <Flag size={9} style={{ color: GREEN_DIM, flexShrink: 0, marginTop: 3 }}/>}
              <span style={{ fontSize: 12, color: e.type === 'marker' ? 'rgba(74,222,128,0.8)' : 'rgba(255,255,255,0.65)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.55 }}>
                {e.text}
              </span>
            </div>
          ))}

          {/* Live interim text */}
          {interim && (
            <div style={{ display: 'flex', gap: 8, padding: '7px 10px', borderRadius: 7, background: 'rgba(224,48,48,0.04)', border: '1px solid rgba(224,48,48,0.08)', opacity: 0.7 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', fontFamily: 'monospace', flexShrink: 0, paddingTop: 2, minWidth: 32 }}>
                {fmt(Date.now() - (startRef.current || Date.now()))}
              </span>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.55, fontStyle: 'italic' }}>
                {interim}
              </span>
            </div>
          )}

          {saved && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.05)', marginTop: 8 }}>
              <Check size={14} style={{ color: GREEN }}/>
              <span style={{ fontSize: 13, color: GREEN, fontFamily: "'Figtree',sans-serif" }}>Session saved — KB will reference this</span>
            </div>
          )}
        </div>

        {/* Mark input */}
        {showMark && (
          <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <input
              ref={markInputRef}
              value={markInput}
              onChange={e => setMarkInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addMark(markInput.trim() || '★ Marked')
                if (e.key === 'Escape') { setShowMark(false); setMarkInput('') }
              }}
              placeholder="What's happening right now?"
              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 10px', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: "'Figtree',sans-serif", outline: 'none' }}
            />
            <button
              onClick={() => addMark(markInput.trim() || '★ Marked')}
              style={{ padding: '8px 12px', borderRadius: 7, border: 'none', background: GREEN, color: '#080808', cursor: 'pointer' }}
            >
              <Check size={13}/>
            </button>
          </div>
        )}

        {/* Quick marks — shown while active */}
        {active && !showMark && (
          <div style={{ display: 'flex', gap: 2, padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,0.04)', flexShrink: 0, overflowX: 'auto' }}>
            {QUICK_MARKS.map(m => (
              <button
                key={m}
                onClick={() => addMark(m)}
                title={m}
                style={{ fontSize: 18, padding: '4px 6px', border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0, lineHeight: 1, WebkitTapHighlightColor: 'transparent' }}
              >
                {m[0]}
              </button>
            ))}
            <button
              onClick={() => setShowMark(true)}
              style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif", flexShrink: 0, marginLeft: 'auto' }}
            >
              <Flag size={10} style={{ marginRight: 4 }}/> Mark
            </button>
          </div>
        )}

        {/* Controls */}
        <div style={{ padding: '12px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
          {!active && !saved && (
            <button
              onClick={startSession}
              style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: 'rgba(224,48,48,0.9)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: "'Figtree',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Mic size={16}/> Start session
            </button>
          )}

          {active && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={stopSession}
                style={{ flex: 1, padding: '13px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 13, fontFamily: "'Figtree',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
              >
                <MicOff size={14}/> Stop
              </button>
              <button
                onClick={() => { stopSession(); setTimeout(saveSession, 200) }}
                style={{ flex: 2, padding: '13px', borderRadius: 10, border: 'none', background: GREEN, color: '#080808', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'Figtree',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
              >
                Stop & Save to KB
              </button>
            </div>
          )}

          {!active && entries.length > 0 && !saved && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { setEntries([]); setElapsedMs(0) }}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
              >
                Discard
              </button>
              <button
                onClick={saveSession}
                disabled={saving}
                style={{ flex: 2, padding: '11px', borderRadius: 10, border: 'none', background: saving ? GREEN_LOW : GREEN, color: saving ? GREEN : '#080808', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: "'Figtree',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
              >
                {saving ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }}/> Saving…</> : 'Save to KB'}
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-rec { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.7)} }
        @keyframes pulse-ring { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0.8;transform:scale(1.1)} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>
    </>
  )
}
