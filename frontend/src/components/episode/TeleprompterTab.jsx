// frontend/src/components/episode/TeleprompterTab.jsx
// Teleprompter tab within EpisodePage — same logic as Teleprompter.jsx
// but receives episode directly, no picker needed.

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play, Pause, RotateCcw, Maximize, Minimize,
  Mic, MicOff, Square, AlignCenter,
  RefreshCw, Check, AlertCircle, ChevronDown,
} from 'lucide-react'
import { useStore } from '../../store'
import { episodes as episodesApi, api } from '../../lib/api'
import { getSession } from '../../lib/supabase'

const pxPerSec = (speed) => 8 * Math.pow(speed, 1.45)

export default function TeleprompterTab({ episode, onUpdate }) {
  const { notify } = useStore()

  const [script,        setScript]        = useState(episode?.vo_script || '')
  const [scriptDirty,   setScriptDirty]   = useState(false)
  const [started,       setStarted]       = useState(false)
  const [playing,       setPlaying]       = useState(false)
  const [speed,         setSpeed]         = useState(4)
  const [fontSize,      setFontSize]      = useState(42)
  const [position,      setPosition]      = useState(0)
  const [fullscreen,    setFullscreen]    = useState(false)
  const [mirrored,      setMirrored]      = useState(false)
  const [recState,      setRecState]      = useState('idle')
  const [recDurationMs, setRecDurationMs] = useState(0)
  const [recError,      setRecError]      = useState('')
  const [alignResult,   setAlignResult]   = useState(null)

  const textRef     = useRef(null)
  const frameRef    = useRef(null)
  const lastTime    = useRef(null)
  const posRef      = useRef(0)
  const mediaRecRef = useRef(null)
  const chunksRef   = useRef([])
  const recTimerRef = useRef(null)
  const recStartRef = useRef(0)

  useEffect(() => {
    if (episode?.vo_script) {
      setScript(episode.vo_script)
      setScriptDirty(false)
    }
  }, [episode?.id])

  // Scroll animation
  useEffect(() => {
    if (!playing) { lastTime.current = null; return }
    const tick = (ts) => {
      if (lastTime.current) {
        const delta = (ts - lastTime.current) / 1000
        posRef.current = Math.min(posRef.current + pxPerSec(speed) * delta, textRef.current?.scrollHeight || 0)
        setPosition(posRef.current)
      }
      lastTime.current = ts
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [playing, speed])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (!started) return
      if (e.code === 'Space')     { e.preventDefault(); setPlaying(p => !p) }
      if (e.code === 'ArrowUp')   setSpeed(s => Math.min(10, s + 0.5))
      if (e.code === 'ArrowDown') setSpeed(s => Math.max(1, s - 0.5))
      if (e.code === 'KeyR')      { posRef.current = 0; setPosition(0); setPlaying(false) }
      if (e.code === 'Escape' && fullscreen) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [started, fullscreen])

  async function saveScript() {
    if (!episode?.id || !scriptDirty) return
    await episodesApi.patch(episode.id, { vo_script: script })
    onUpdate?.({ ...episode, vo_script: script })
    setScriptDirty(false)
    notify('Script saved', 'success')
  }

  async function startRecording() {
    setRecState('requesting'); setRecError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime   = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || 'audio/mp4'
      const rec    = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []; rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.start(500); mediaRecRef.current = rec; recStartRef.current = Date.now()
      recTimerRef.current = setInterval(() => setRecDurationMs(Date.now() - recStartRef.current), 1000)
      setRecState('recording')
    } catch (e) {
      setRecError(e.message); setRecState('error')
    }
  }

  async function stopRecording() {
    setRecState('stopping')
    clearInterval(recTimerRef.current)
    mediaRecRef.current?.stop()
    mediaRecRef.current?.stream?.getTracks().forEach(t => t.stop())
    await new Promise(r => setTimeout(r, 500))
    const blob = new Blob(chunksRef.current, { type: mediaRecRef.current?.mimeType || 'audio/webm' })
    setRecState('uploading')
    try {
      const sess = await getSession()
      const fd   = new FormData()
      fd.append('audio', blob, 'recording.webm')
      fd.append('episodeId', episode?.id || '')
      const res  = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/editor/vo-align`, {
        method: 'POST', headers: { Authorization: `Bearer ${sess?.access_token}` }, body: fd,
      })
      const data = await res.json()
      if (episode?.id) await episodesApi.patch(episode.id, { pipeline_stage: 'vo_recorded' })
      setAlignResult(data); setRecState('done')
      notify('VO recorded and aligned', 'success')
    } catch (err) {
      setRecError(err.message); setRecState('error')
    }
  }

  const fmt = ms => { const s=Math.floor(ms/1000),m=Math.floor(s/60); return `${m}:${String(s%60).padStart(2,'0')}` }

  // Setup screen
  if (!started) return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 0' }}>
      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginBottom: 16 }}>
        {script ? `Script loaded — ${script.split(' ').length} words` : 'No script yet — generate one first'}
      </div>

      {scriptDirty && (
        <button onClick={saveScript} style={{ marginBottom: 12, padding: '6px 14px', borderRadius: 7, border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.8)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}>
          Save edits
        </button>
      )}

      <textarea
        value={script}
        onChange={e => { setScript(e.target.value); setScriptDirty(true) }}
        placeholder="Script will appear here after generation..."
        rows={8}
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: "'Figtree',sans-serif", lineHeight: 1.7, outline: 'none', resize: 'vertical', marginBottom: 16 }}
      />

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>Speed</span>
          {[2,4,6,8].map(s => (
            <button key={s} onClick={() => setSpeed(s)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${speed===s?'rgba(74,222,128,0.3)':'rgba(255,255,255,0.08)'}`, background: speed===s?'rgba(74,222,128,0.08)':'transparent', color: speed===s?'rgba(74,222,128,0.9)':'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>Font</span>
          {[32,42,56].map(f => (
            <button key={f} onClick={() => setFontSize(f)} style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${fontSize===f?'rgba(74,222,128,0.3)':'rgba(255,255,255,0.08)'}`, background: fontSize===f?'rgba(74,222,128,0.08)':'transparent', color: fontSize===f?'rgba(74,222,128,0.9)':'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={() => setStarted(true)}
        disabled={!script.trim()}
        style={{ width: '100%', padding: '14px', borderRadius: 10, border: 'none', background: script.trim() ? 'rgba(74,222,128,1)' : 'rgba(255,255,255,0.06)', color: script.trim() ? '#080808' : 'rgba(255,255,255,0.2)', cursor: script.trim() ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 600, fontFamily: "'Figtree',sans-serif" }}
      >
        Start teleprompter
      </button>
    </div>
  )

  // Teleprompter screen
  return (
    <div style={{ position: fullscreen ? 'fixed' : 'relative', inset: fullscreen ? 0 : 'auto', zIndex: fullscreen ? 100 : 'auto', background: '#040506', borderRadius: fullscreen ? 0 : 10, overflow: 'hidden' }}>

      {/* Controls bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', background: 'rgba(4,5,6,0.95)' }}>
        <button onClick={() => { setPlaying(p => !p) }} style={ctrlBtn(playing)}>
          {playing ? <Pause size={14}/> : <Play size={14}/>}
        </button>
        <button onClick={() => { posRef.current = 0; setPosition(0); setPlaying(false) }} style={ctrlBtn(false)}>
          <RotateCcw size={14}/>
        </button>
        <button onClick={() => setMirrored(m => !m)} style={ctrlBtn(mirrored)}>
          <AlignCenter size={14}/>
        </button>
        <div style={{ flex: 1 }}/>

        {/* Recording */}
        {recState === 'idle' && (
          <button onClick={startRecording} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(224,48,48,0.3)', background: 'rgba(224,48,48,0.08)', color: 'rgba(224,48,48,0.8)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif" }}>
            <Mic size={11}/> Record VO
          </button>
        )}
        {recState === 'recording' && (
          <button onClick={stopRecording} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(224,48,48,0.5)', background: 'rgba(224,48,48,0.15)', color: '#e03030', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif" }}>
            <Square size={11}/> Stop {fmt(recDurationMs)}
          </button>
        )}
        {(recState === 'uploading' || recState === 'stopping') && (
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>Aligning...</span>
        )}
        {recState === 'done' && (
          <span style={{ fontSize: 11, color: 'rgba(74,222,128,0.7)', fontFamily: "'Figtree',sans-serif", display: 'flex', alignItems: 'center', gap: 4 }}>
            <Check size={11}/> VO aligned
          </span>
        )}

        <button onClick={() => setFullscreen(f => !f)} style={ctrlBtn(false)}>
          {fullscreen ? <Minimize size={14}/> : <Maximize size={14}/>}
        </button>
        <button onClick={() => setStarted(false)} style={ctrlBtn(false)}>
          <span style={{ fontSize: 12 }}>✕</span>
        </button>
      </div>

      {/* Script */}
      <div
        style={{ height: fullscreen ? 'calc(100vh - 52px)' : '60vh', overflow: 'hidden', cursor: 'pointer', padding: '20px 40px' }}
        onClick={() => setPlaying(p => !p)}
      >
        <div
          ref={textRef}
          style={{
            transform: `translateY(-${position}px) scaleX(${mirrored ? -1 : 1})`,
            fontSize: fontSize,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.92)',
            fontFamily: "'Syne', sans-serif",
            fontWeight: 600,
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            userSelect: 'none',
            paddingBottom: '60vh',
          }}
        >
          {script}
        </div>
      </div>
    </div>
  )
}

function ctrlBtn(active) {
  return {
    width: 32, height: 32, borderRadius: 7, border: `1px solid ${active ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.08)'}`,
    background: active ? 'rgba(74,222,128,0.08)' : 'transparent',
    color: active ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.4)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
}