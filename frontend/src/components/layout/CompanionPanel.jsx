// frontend/src/components/layout/CompanionPanel.jsx
// Floating companion panel — appears above the main app without navigating away.
// Same core recording logic as Companion.jsx but in a floating sheet.
// On mobile: full-screen slide-up. On desktop: right-side panel 380px wide.

import { useState, useRef, useEffect, useReducer } from 'react'
import { X, Mic, MicOff, Square, Flag, Send, Check, Loader2, Radio } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../lib/api'
import { getSession } from '../../lib/supabase'
import { detectMic, buildConstraints, getRecordingBitrate } from '../../lib/micDetect'
import MascotOrb from '../companion/MascotOrb'

const CHUNK_MS      = 12000
const WAVEFORM_BARS = 32
const GREEN         = 'rgba(74,222,128,1)'
const GREEN_DIM     = 'rgba(74,222,128,0.7)'
const GREEN_FAINT   = 'rgba(74,222,128,0.08)'

const init = {
  sessionId: null, recording: false, elapsedMs: 0,
  entries: [], processing: false, status: 'idle',
  audioLevel: 0, waveform: new Array(WAVEFORM_BARS).fill(0),
  markLabel: '', showMarkInput: false, justMarked: false,
  error: null, orbMood: 'idle',
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET':          return { ...state, ...action.payload }
    case 'ADD_ENTRY':    return { ...state, entries: [...state.entries, action.entry] }
    case 'RESET':        return { ...init }
    default:             return state
  }
}

const fmt = ms => { const s=Math.floor(ms/1000),m=Math.floor(s/60); return `${m}:${String(s%60).padStart(2,'0')}` }
const pad = n => String(n).padStart(2,'0')

const QUICK_MARKS = [
  { label:'✨ Found something', icon:'✨' },
  { label:'⚡ Energy peak',     icon:'⚡' },
  { label:'❌ Not working',     icon:'❌' },
  { label:'🎯 Keep this',       icon:'🎯' },
]

export default function CompanionPanel({ onClose }) {
  const { activeCategoryId, activeCategory } = useStore()
  const cat = activeCategory?.()
  const [state, dispatch] = useReducer(reducer, init)
  const set = p => dispatch({ type: 'SET', payload: p })

  const mediaRecRef  = useRef(null)
  const chunksRef    = useRef([])
  const startRef     = useRef(null)
  const timerRef     = useRef(null)
  const chunkRef     = useRef(null)
  const analyserRef  = useRef(null)
  const audioCtxRef  = useRef(null)
  const rafRef       = useRef(null)
  const sidRef       = useRef(null)
  const mimeRef      = useRef('audio/webm')
  const bufRef       = useRef([])

  const [processPct, setProcessPct] = useState(0)
  const isMobile = window.innerWidth < 768

  useEffect(() => { sidRef.current = state.sessionId }, [state.sessionId])

  function startWaveform(stream) {
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const src = ctx.createMediaStreamSource(stream)
    const an  = ctx.createAnalyser()
    an.fftSize = 64; an.smoothingTimeConstant = 0.7
    src.connect(an); analyserRef.current = an
    const d = new Uint8Array(an.frequencyBinCount)
    const draw = () => {
      an.getByteFrequencyData(d)
      const bars = []; let tot = 0
      const step = Math.floor(d.length / WAVEFORM_BARS)
      for (let i = 0; i < WAVEFORM_BARS; i++) { const v = d[i*step]/255; bars.push(v); tot += v }
      dispatch({ type: 'SET', payload: { waveform: bars, audioLevel: tot/WAVEFORM_BARS } })
      rafRef.current = requestAnimationFrame(draw)
    }
    draw()
  }

  function stopWaveform() {
    cancelAnimationFrame(rafRef.current)
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current = null }
    dispatch({ type: 'SET', payload: { waveform: new Array(WAVEFORM_BARS).fill(0), audioLevel: 0 } })
  }

  async function startSession() {
    set({ status: 'starting', error: null })
    try {
      const p = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      p.getTracks().forEach(t => t.stop())
      const devs = await navigator.mediaDevices.enumerateDevices()
      const det  = detectMic(devs)
      let stream
      try { stream = await navigator.mediaDevices.getUserMedia(buildConstraints(det)) }
      catch { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }

      const { session } = await api.post('/session', {
        categoryId: activeCategoryId,
        title: `Session ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}${cat ? ' — ' + cat.name : ''}`,
      })
      sidRef.current = session.id; startRef.current = Date.now()
      chunksRef.current = []; bufRef.current = []

      const mime = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || 'audio/mp4'
      mimeRef.current = mime
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: getRecordingBitrate(det) || 128000 })
      mediaRecRef.current = rec
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.start(500)

      timerRef.current = setInterval(() => set({ elapsedMs: Date.now() - startRef.current }), 1000)
      chunkRef.current = setInterval(() => transcribeChunk(sidRef.current), CHUNK_MS)
      startWaveform(stream)
      set({ sessionId: session.id, recording: true, status: 'recording', orbMood: 'listening', entries: [], elapsedMs: 0 })
    } catch (e) {
      set({ status: 'error', error: e.name === 'NotAllowedError' ? 'Microphone blocked — check browser permissions' : e.message })
    }
  }

  async function stopSession() {
    if (!mediaRecRef.current) return
    set({ status: 'stopping' })
    clearInterval(timerRef.current); clearInterval(chunkRef.current)
    stopWaveform()
    mediaRecRef.current.stop()
    mediaRecRef.current.stream.getTracks().forEach(t => t.stop())
    mediaRecRef.current = null
    await Promise.race([transcribeChunk(sidRef.current), new Promise(r => setTimeout(r, 8000))])
    set({ recording: false, status: 'ready', orbMood: 'idle' })
  }

  async function transcribeChunk(sid) {
    const nc = chunksRef.current.splice(0)
    if (!nc.length || !sid) return
    bufRef.current.push(...nc)
    const mime = mimeRef.current || 'audio/webm'
    const blob = new Blob(bufRef.current, { type: mime })
    const tsMs = Date.now() - (startRef.current || Date.now())
    const ext  = mime.split(';')[0].split('/')[1] || 'webm'
    if (blob.size < 8000) return
    try {
      const sess = await getSession()
      const fd   = new FormData()
      fd.append('audio', blob, `recording.${ext}`)
      fd.append('timestampMs', String(tsMs))
      fd.append('isCumulative', 'true')
      const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/session/${sid}/transcribe`, {
        method: 'POST', headers: { Authorization: `Bearer ${sess?.access_token}` }, body: fd,
      })
      if (res.ok) {
        const data = await res.json()
        if (data.entries?.length) data.entries.forEach(e => dispatch({ type: 'ADD_ENTRY', entry: e }))
      }
    } catch {}
  }

  async function markMoment(label = '') {
    const tsMs = startRef.current ? Date.now() - startRef.current : 0
    const text = label.trim() || '★ Marked'
    const entry = { id: `mark-${Date.now()}`, timestamp_ms: tsMs, type: 'marker', text, energy: 1.0 }
    dispatch({ type: 'ADD_ENTRY', entry })
    set({ justMarked: true, showMarkInput: false, markLabel: '', orbMood: 'marking' })
    setTimeout(() => set({ orbMood: state.recording ? 'listening' : 'idle' }), 1200)
    setTimeout(() => set({ justMarked: false }), 1500)
    if (sidRef.current) api.post(`/session/${sidRef.current}/entry`, { text, type: 'marker', timestampMs: tsMs, energy: 1.0 }).catch(() => {})
  }

  async function processSession() {
    if (!sidRef.current) return
    set({ processing: true, orbMood: 'processing', error: null })
    let prog = 0
    const iv = setInterval(() => { prog = prog<70?prog+2:prog<90?prog+0.5:prog+0.1; setProcessPct(Math.min(prog, 95)) }, 400)
    try {
      const r = await api.post(`/session/${sidRef.current}/process`)
      clearInterval(iv); setProcessPct(100)
      await new Promise(res => setTimeout(res, 400)); setProcessPct(0)
      set({ processing: false, orbMood: 'idle', status: 'done' })
    } catch (e) {
      clearInterval(iv); setProcessPct(0)
      set({ processing: false, orbMood: 'idle', error: e.message, status: 'ready' })
    }
  }

  const panelStyle = isMobile ? {
    position: 'fixed', inset: 0, zIndex: 60,
    background: 'rgba(8,10,16,0.99)',
    display: 'flex', flexDirection: 'column',
  } : {
    position: 'fixed', top: 52, right: 16, bottom: 100, width: 360,
    zIndex: 60, borderRadius: 16,
    background: 'rgba(8,10,16,0.98)',
    border: '1px solid rgba(74,222,128,0.12)',
    boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    backdropFilter: 'blur(20px)',
  }

  return (
    <>
      {/* Backdrop on mobile */}
      {isMobile && <div onClick={!state.recording ? onClose : undefined} style={{ position: 'fixed', inset: 0, zIndex: 59, background: 'rgba(0,0,0,0.5)' }}/>}

      <div style={panelStyle}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <Radio size={14} style={{ color: GREEN_DIM }}/>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif", flex: 1 }}>
            Companion {cat ? `· ${cat.name}` : ''}
          </span>
          {state.recording && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(224,48,48,0.8)', fontFamily: 'monospace' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(224,48,48,0.9)', animation: 'rec-pulse 1.4s ease infinite' }}/>
              {fmt(state.elapsedMs)}
            </div>
          )}
          <button
            onClick={() => { if (!state.recording) onClose() }}
            disabled={state.recording}
            style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: state.recording ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.4)', cursor: state.recording ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={state.recording ? 'Stop recording before closing' : 'Close'}
          >
            <X size={13}/>
          </button>
        </div>

        {/* Error */}
        {state.error && (
          <div style={{ margin: '10px 16px', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(224,80,80,0.2)', background: 'rgba(224,80,80,0.06)', fontSize: 12, color: 'rgba(224,80,80,0.8)', fontFamily: "'Figtree',sans-serif" }}>
            {state.error}
          </div>
        )}

        {/* Entries feed */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {state.entries.length === 0 && state.status === 'idle' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <MascotOrb mood={state.orbMood} audioLevel={state.audioLevel} size={160}/>
            </div>
          )}
          {state.entries.length === 0 && state.status === 'recording' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <MascotOrb mood="listening" audioLevel={state.audioLevel} size={160}/>
            </div>
          )}
          {state.entries.map(e => (
            <div key={e.id} style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: 7, background: e.type === 'marker' ? 'rgba(74,222,128,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${e.type === 'marker' ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)'}` }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', flexShrink: 0, paddingTop: 2 }}>{fmt(e.timestamp_ms || 0)}</span>
              {e.type === 'marker' && <Flag size={9} style={{ color: GREEN_DIM, flexShrink: 0, marginTop: 3 }}/>}
              <span style={{ fontSize: 12, color: e.type === 'marker' ? 'rgba(74,222,128,0.8)' : 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.55 }}>{e.text}</span>
            </div>
          ))}
          {state.status === 'done' && (
            <div style={{ padding: '12px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.15)', background: 'rgba(74,222,128,0.04)', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'rgba(74,222,128,0.8)', fontFamily: "'Figtree',sans-serif", marginBottom: 4 }}>✓ Memo processed</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>KB will reference this in your next conversation</div>
            </div>
          )}
        </div>

        {/* Processing overlay */}
        {state.processing && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree',sans-serif" }}>
                {processPct < 40 ? 'Reading session...' : processPct < 75 ? 'Finding key moments...' : 'Writing memo...'}
              </span>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{Math.round(processPct)}%</span>
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${processPct}%`, background: 'linear-gradient(90deg,rgba(74,222,128,1),rgba(74,222,128,0.6))', borderRadius: 2, transition: 'width 0.4s' }}/>
            </div>
          </div>
        )}

        {/* Mark input */}
        {state.showMarkInput && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, flexShrink: 0 }}>
            <input
              autoFocus
              value={state.markLabel}
              onChange={e => set({ markLabel: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') markMoment(state.markLabel); if (e.key === 'Escape') set({ showMarkInput: false, markLabel: '' }) }}
              placeholder="What's happening right now?"
              style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, padding: '8px 10px', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: "'Figtree',sans-serif", outline: 'none' }}
            />
            <button onClick={() => markMoment(state.markLabel)} style={{ padding: '8px 12px', borderRadius: 7, border: 'none', background: GREEN, color: '#080808', cursor: 'pointer' }}>
              <Check size={13}/>
            </button>
          </div>
        )}

        {/* Controls */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>

          {/* Quick marks */}
          {state.recording && (
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, justifyContent: 'center' }}>
              {QUICK_MARKS.map(m => (
                <button key={m.label} onClick={() => markMoment(m.label)} title={m.label}
                  style={{ fontSize: 20, padding: '4px', border: 'none', background: 'none', cursor: 'pointer', lineHeight: 1 }}>
                  {m.icon}
                </button>
              ))}
              <button onClick={() => set({ showMarkInput: true })} title="Custom mark"
                style={{ fontSize: 20, padding: '4px 6px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, background: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.4)', fontSize: 14, display: 'flex', alignItems: 'center' }}>
                <Flag size={12}/>
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {/* Record / Stop */}
            {(state.status === 'idle' || state.status === 'error') && (
              <button onClick={startSession} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 9, border: '1px solid rgba(224,48,48,0.3)', background: 'rgba(224,48,48,0.08)', color: 'rgba(224,48,48,0.9)', cursor: 'pointer', fontSize: 13, fontFamily: "'Figtree',sans-serif", fontWeight: 600 }}>
                <Mic size={14}/> Start recording
              </button>
            )}
            {(state.status === 'starting') && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Figtree',sans-serif" }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> Connecting mic...
              </div>
            )}
            {state.status === 'recording' && (
              <button onClick={stopSession} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 9, border: '1px solid rgba(224,48,48,0.5)', background: 'rgba(224,48,48,0.12)', color: '#e03030', cursor: 'pointer', fontSize: 13, fontFamily: "'Figtree',sans-serif", fontWeight: 600 }}>
                <Square size={14}/> Stop
              </button>
            )}
            {state.status === 'stopping' && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.3)', fontSize: 13, fontFamily: "'Figtree',sans-serif" }}>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }}/> Saving...
              </div>
            )}
            {state.status === 'ready' && !state.processing && (
              <>
                <button onClick={processSession} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 9, border: 'none', background: GREEN, color: '#080808', cursor: 'pointer', fontSize: 13, fontFamily: "'Figtree',sans-serif", fontWeight: 600 }}>
                  <Send size={14}/> Generate memo
                </button>
                <button onClick={() => dispatch({ type: 'RESET' })} style={{ padding: '11px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}>
                  Discard
                </button>
              </>
            )}
            {state.status === 'done' && (
              <button onClick={() => dispatch({ type: 'RESET' })} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px', borderRadius: 9, border: '1px solid rgba(74,222,128,0.2)', background: GREEN_FAINT, color: GREEN_DIM, cursor: 'pointer', fontSize: 13, fontFamily: "'Figtree',sans-serif" }}>
                New session
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes rec-pulse { 0%,100%{opacity:0.4} 50%{opacity:1} }
      `}</style>
    </>
  )
}