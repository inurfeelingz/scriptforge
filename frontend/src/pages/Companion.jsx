// frontend/src/pages/Companion.jsx
// WhispaCuts Companion — mobile-first PWA session capture.
// Designed to live on your phone home screen while you make music.
//
// Two swipeable screens:
//   [RECORD] ← swipe → [BRAINSTORM]
//
// Fixes applied in this version:
//   - dragX state was declared but setDragX was called without declaration → fixed
//   - setPastSessions was called but never declared → fixed (uses dispatch SET)
//   - BrainstormScreen layout broken (flex children with no minHeight constraint) → fixed
//   - BrainstormScreen design diverged from web KB panel → matched exactly

import {
  useState, useRef, useEffect, useCallback, useReducer
} from 'react'
import {
  Mic, MicOff, Square, Flag, Send, Wifi, WifiOff,
  ChevronLeft, ChevronRight, Trash2, Check, Loader2,
  Volume2, Radio, Clock, RefreshCw, Sparkles,
} from 'lucide-react'
import { useStore } from '../store'
import { api, chat as chatApi } from '../lib/api'
import { getSession, supabase } from '../lib/supabase'
import { detectMic, buildConstraints, getRecordingBitrate, needsStereoSum, describeMic } from '../lib/micDetect'
import MascotOrb from '../components/companion/MascotOrb'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SCREENS         = ['record', 'brainstorm']
const CHUNK_MS        = 12000
const WAVEFORM_BARS   = 48
const LONG_PRESS_MS   = 600
const SWIPE_THRESHOLD = 60
const SWIPE_VELOCITY  = 0.3

// KB accent — matches web ChatPanel exactly
const KB_GREEN       = 'rgba(74,222,128,1)'
const KB_GREEN_DIM   = 'rgba(74,222,128,0.7)'
const KB_GREEN_FAINT = 'rgba(74,222,128,0.08)'

// ─── STATE REDUCER ────────────────────────────────────────────────────────────
const initialState = {
  screen:          0,
  sessionId:       null,
  recording:       false,
  elapsedMs:       0,
  entries:         [],
  processed:       null,
  processing:      false,
  online:          true,
  micLabel:        '',
  orbMood:         'idle',
  isDJI:           false,
  isExternal:      false,
  micInfo:         '',
  audioLevel:      0,
  waveform:        new Array(WAVEFORM_BARS).fill(0),
  markLabel:       '',
  showMarkInput:   false,
  justMarked:      false,
  status:          'idle',   // idle | starting | recording | stopping | processing | ready | error
  error:           null,
  sessions:        [],
  loadingSessions: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET':          return { ...state, ...action.payload }
    case 'ADD_ENTRY':    return { ...state, entries: [...state.entries, action.entry] }
    case 'REMOVE_ENTRY': return { ...state, entries: state.entries.filter(e => e.id !== action.id) }
    case 'SET_WAVEFORM': return { ...state, waveform: action.data, audioLevel: action.level }
    case 'RESET_SESSION':return { ...state, sessionId: null, recording: false, elapsedMs: 0, entries: [], processed: null, status: 'idle', error: null, justMarked: false }
    default:             return state
  }
}

// ─── UTILITIES ────────────────────────────────────────────────────────────────
function fmt(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}:${pad(m % 60)}:${pad(s % 60)}`
  return `${m}:${pad(s % 60)}`
}
const pad = n => String(n).padStart(2, '0')

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function Companion() {
  const { activeCategoryId, activeCategory } = useStore()
  const cat = activeCategory?.()

  const [state, dispatch] = useReducer(reducer, initialState)
  const set = payload => dispatch({ type: 'SET', payload })

  // Refs
  const mediaRecorderRef    = useRef(null)
  const audioChunksRef      = useRef([])
  const sessionStartRef     = useRef(null)
  const timerRef            = useRef(null)
  const chunkTimerRef       = useRef(null)
  const analyserRef         = useRef(null)
  const audioCtxRef         = useRef(null)
  const rafRef              = useRef(null)
  const sessionIdRef        = useRef(null)
  const longPressRef        = useRef(null)
  const audioMimeRef        = useRef('audio/webm')
  const transcribeBufferRef = useRef([])
  const wakeLockRef         = useRef(null)
  const offlineQueue        = useRef([])

  // Touch tracking
  const touchStart   = useRef({ x: 0, y: 0, t: 0 })
  const touchCurrent = useRef({ x: 0, y: 0 })
  const isDragging   = useRef(false)

  // Local state
  const [dragX,           setDragX]           = useState(0)
  const [sessionTitle,    setSessionTitle]    = useState('')
  const [editingTitle,    setEditingTitle]    = useState(false)
  const [uploadProgress,  setUploadProgress]  = useState(0)
  const [processProgress, setProcessProgress] = useState(0)

  // Keep session ID ref in sync
  useEffect(() => { sessionIdRef.current = state.sessionId }, [state.sessionId])

  // Online detection
  useEffect(() => {
    const on  = () => { set({ online: true }); flushOfflineQueue() }
    const off = () => set({ online: false })
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    set({ online: navigator.onLine })
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Re-acquire Wake Lock after phone unlock
  useEffect(() => {
    async function handleVisibility() {
      if (document.visibilityState === 'visible' && state.recording && !wakeLockRef.current) {
        try { wakeLockRef.current = await navigator.wakeLock?.request('screen') } catch {}
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [state.recording])

  // Lock screen orientation to portrait
  useEffect(() => {
    screen.orientation?.lock?.('portrait-primary').catch(() => {})
    return () => screen.orientation?.unlock?.()
  }, [])

  // ── WAVEFORM VISUALISER ──────────────────────────────────────────────────────
  function startWaveform(stream) {
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
      audioCtxRef.current = null
    }
    const ctx      = new AudioContext()
    audioCtxRef.current = ctx
    const source   = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize               = 128
    analyser.smoothingTimeConstant = 0.7

    const tracks   = stream.getAudioTracks()
    const isStereo = tracks[0]?.getSettings?.()?.channelCount === 2

    if (isStereo) {
      const splitter = ctx.createChannelSplitter(2)
      const gainL    = ctx.createGain()
      const gainR    = ctx.createGain()
      const merger   = ctx.createChannelMerger(1)
      gainL.gain.value = 0.5
      gainR.gain.value = 0.5
      source.connect(splitter)
      splitter.connect(gainL, 0)
      splitter.connect(gainR, 1)
      gainL.connect(merger, 0, 0)
      gainR.connect(merger, 0, 0)
      merger.connect(analyser)
    } else {
      source.connect(analyser)
    }
    analyserRef.current = analyser

    const data = new Uint8Array(analyser.frequencyBinCount)
    function draw() {
      analyser.getByteFrequencyData(data)
      const bars = []
      const step = Math.floor(data.length / WAVEFORM_BARS)
      let total  = 0
      for (let i = 0; i < WAVEFORM_BARS; i++) {
        const val = data[i * step] / 255
        bars.push(val)
        total += val
      }
      dispatch({ type: 'SET_WAVEFORM', data: bars, level: total / WAVEFORM_BARS })
      rafRef.current = requestAnimationFrame(draw)
    }
    draw()
  }

  function stopWaveform() {
    cancelAnimationFrame(rafRef.current)
    analyserRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    dispatch({ type: 'SET_WAVEFORM', data: new Array(WAVEFORM_BARS).fill(0), level: 0 })
  }

  // ── MIC SELECTION ────────────────────────────────────────────────────────────
  async function getBestMicStream() {
    let permStream
    try {
      permStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
        throw new Error('Microphone access denied — tap Allow when your browser asks')
      if (err.name === 'NotFoundError')
        throw new Error('No microphone found — connect a mic and try again')
      throw err
    }
    permStream.getTracks().forEach(t => t.stop())

    const devices     = await navigator.mediaDevices.enumerateDevices()
    const detection   = detectMic(devices)
    const constraints = buildConstraints(detection)

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints)
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    }

    const activeTrack = stream.getAudioTracks()[0]
    const settings    = activeTrack?.getSettings?.() || {}
    const bitrate     = getRecordingBitrate(detection)
    const isDJI       = /dji/i.test(detection.match?.brand || '')
    const isExternal  = detection.isExternal

    return {
      stream,
      label:      detection.displayLabel || activeTrack?.label || 'Microphone',
      isDJI,
      isExternal,
      bitrate,
      sampleRate: settings.sampleRate || detection.match?.sampleRate || 44100,
      micInfo:    describeMic(detection),
    }
  }

  // ── SESSION START / STOP ─────────────────────────────────────────────────────
  async function startSession() {
    set({ status: 'starting', error: null })
    try {
      const { stream, label, isDJI, isExternal, bitrate, micInfo } = await getBestMicStream()
      set({ micLabel: label, isDJI, isExternal, micInfo })

      if (isDJI)           navigator.vibrate?.([30, 20, 30, 20, 80])
      else if (isExternal) navigator.vibrate?.([30, 20, 60])
      else                 navigator.vibrate?.([30])

      const { session } = await api.post('/session', {
        categoryId: activeCategoryId,
        title: `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${cat?.name || 'untitled'}`,
      })

      sessionIdRef.current        = session.id
      sessionStartRef.current     = Date.now()
      audioChunksRef.current      = []
      transcribeBufferRef.current = []

      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=aac',
        'audio/mp4',
        'audio/ogg',
      ].find(t => MediaRecorder.isTypeSupported(t)) || 'audio/mp4'

      audioMimeRef.current = mimeType
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: bitrate || (isExternal ? 192000 : 128000),
      })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.start(500)

      timerRef.current      = setInterval(() => { set({ elapsedMs: Date.now() - sessionStartRef.current }) }, 1000)
      chunkTimerRef.current = setInterval(() => { transcribeChunk(sessionIdRef.current) }, CHUNK_MS)

      startWaveform(stream)

      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(lock => { wakeLockRef.current = lock }).catch(() => {})
      }

      setSessionTitle(session.title || '')
      set({ sessionId: session.id, recording: true, status: 'recording', orbMood: 'listening', entries: [], elapsedMs: 0, processed: null })

      if (state.screen !== 0) set({ screen: 0 })
      navigator.vibrate?.([50])

    } catch (err) {
      set({ status: 'error', error: err.name === 'NotAllowedError' ? 'Microphone blocked — allow access in browser settings' : err.message })
    }
  }

  async function stopSession() {
    if (!mediaRecorderRef.current) return
    set({ status: 'stopping' })
    clearInterval(timerRef.current)
    clearInterval(chunkTimerRef.current)
    stopWaveform()
    mediaRecorderRef.current.stop()
    mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current = null

    await Promise.race([
      transcribeChunk(sessionIdRef.current),
      new Promise(r => setTimeout(r, 8000)),
    ])

    if (wakeLockRef.current) { wakeLockRef.current.release().catch(() => {}); wakeLockRef.current = null }
    set({ recording: false, status: 'ready', orbMood: 'idle' })
    navigator.vibrate?.([80, 40, 80])
  }

  // ── TRANSCRIPTION ────────────────────────────────────────────────────────────
  async function transcribeChunk(sid) {
    const newChunks = audioChunksRef.current.splice(0)
    if (!newChunks.length || !sid) return

    if (!transcribeBufferRef.current) transcribeBufferRef.current = []
    transcribeBufferRef.current.push(...newChunks)

    const mimeType    = audioMimeRef.current || 'audio/webm'
    const blob        = new Blob(transcribeBufferRef.current, { type: mimeType })
    const timestampMs = Date.now() - (sessionStartRef.current || Date.now())
    const ext         = mimeType.split(';')[0].split('/')[1] || 'webm'

    if (blob.size < 8000) return

    try {
      const session  = await getSession()
      const formData = new FormData()
      formData.append('audio', blob, `recording.${ext}`)
      formData.append('timestampMs', String(timestampMs))
      formData.append('isCumulative', 'true')

      const res = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', `${import.meta.env.VITE_API_URL || '/api'}/session/${sid}/transcribe`)
        xhr.setRequestHeader('Authorization', `Bearer ${session?.access_token}`)
        xhr.upload.onprogress = e => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)) }
        xhr.onload  = () => { setUploadProgress(0); resolve({ ok: xhr.status < 400, json: () => Promise.resolve(JSON.parse(xhr.responseText)) }) }
        xhr.onerror = () => { setUploadProgress(0); reject(new Error('Upload failed')) }
        xhr.send(formData)
      })

      if (res.ok) {
        const data = await res.json()
        if (data.entries?.length) {
          const hasSubstance = data.entries.some(e =>
            e.type !== 'marker' &&
            (e.text || '').split(' ').length >= 5 &&
            (e.confidence === null || e.confidence === undefined || e.confidence > 0.55)
          )
          if (hasSubstance) {
            set({ orbMood: 'discovery' })
            setTimeout(() => set({ orbMood: 'listening' }), 1200)
          }
          data.entries.forEach(e => dispatch({ type: 'ADD_ENTRY', entry: e }))
        }
      }
    } catch { /* queue for offline sync */ }
  }

  // ── MARK MOMENT ──────────────────────────────────────────────────────────────
  async function markMoment(label = '') {
    const timestampMs = sessionStartRef.current ? Date.now() - sessionStartRef.current : 0
    const text  = label.trim() || '★ Marked'
    const entry = { id: `mark-${Date.now()}`, timestamp_ms: timestampMs, type: 'marker', text, energy: 1.0 }

    dispatch({ type: 'ADD_ENTRY', entry })
    set({ justMarked: true, showMarkInput: false, markLabel: '', orbMood: 'marking' })
    setTimeout(() => set({ orbMood: state.recording ? 'listening' : 'idle' }), 1200)
    setTimeout(() => set({ justMarked: false }), 1500)
    navigator.vibrate?.([30, 20, 30, 20, 80])

    if (sessionIdRef.current && state.online) {
      api.post(`/session/${sessionIdRef.current}/entry`, { text, type: 'marker', timestampMs, energy: 1.0 })
        .catch(() => offlineQueue.current.push(entry))
    } else {
      offlineQueue.current.push(entry)
    }
  }

  const QUICK_MARKS = [
    { label: '✨ Found something', icon: '✨' },
    { label: '⚡ Energy peak',      icon: '⚡' },
    { label: '❌ Not working',       icon: '❌' },
    { label: '🔁 Try again',         icon: '🔁' },
    { label: '🎯 Keep this',         icon: '🎯' },
  ]

  // ── PROCESS SESSION ──────────────────────────────────────────────────────────
  async function processSession() {
    if (!sessionIdRef.current) return
    set({ processing: true, orbMood: 'processing', error: null })
    await new Promise(r => setTimeout(r, 2000))

    let prog = 0
    const progInterval = setInterval(() => {
      prog = prog < 70 ? prog + 2 : prog < 90 ? prog + 0.5 : prog + 0.1
      setProcessProgress(Math.min(prog, 95))
    }, 400)

    try {
      const result = await api.post(`/session/${sessionIdRef.current}/process`)
      clearInterval(progInterval)
      setProcessProgress(100)
      await new Promise(r => setTimeout(r, 400))
      setProcessProgress(0)
      const voiceMemoText = result?.voiceMemoText || result?.voice_memo_text || ''
      if (!voiceMemoText) throw new Error('No memo generated — speak clearly during recording')
      set({ processing: false, orbMood: 'idle', status: 'idle', entries: [], sessionId: null, elapsedMs: 0 })
      navigator.vibrate?.([100, 50, 100, 50, 200])
      window.location.href = '/'
    } catch (err) {
      clearInterval(progInterval)
      setProcessProgress(0)
      set({ processing: false, orbMood: 'idle', error: err.message || 'Processing failed', status: 'ready' })
    }
  }

  // ── OFFLINE QUEUE ────────────────────────────────────────────────────────────
  async function flushOfflineQueue() {
    if (!offlineQueue.current.length || !sessionIdRef.current) return
    const queue = offlineQueue.current.splice(0)
    await api.post(`/session/${sessionIdRef.current}/entries/batch`, { entries: queue })
      .catch(() => offlineQueue.current.unshift(...queue))
  }

  // ── SWIPE GESTURES ───────────────────────────────────────────────────────────
  function onTouchStart(e) {
    const t = e.touches[0]
    touchStart.current   = { x: t.clientX, y: t.clientY, t: Date.now() }
    touchCurrent.current = { x: t.clientX, y: t.clientY }
    isDragging.current   = false
  }

  function onTouchMove(e) {
    const t  = e.touches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y
    touchCurrent.current = { x: t.clientX, y: t.clientY }

    if (!isDragging.current && Math.abs(dx) < 10) return
    if (!isDragging.current && Math.abs(dy) > Math.abs(dx)) return

    isDragging.current = true
    const resistance = (state.screen === 0 && dx > 0) ? 0.25 : 1
    setDragX(dx * resistance)
    if (Math.abs(dx) > 5) e.preventDefault()
  }

  function onTouchEnd() {
    if (!isDragging.current) { setDragX(0); return }
    const dx       = touchCurrent.current.x - touchStart.current.x
    const dt       = Date.now() - touchStart.current.t
    const velocity = Math.abs(dx) / dt

    if (Math.abs(dx) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY) {
      if (dx < 0 && state.screen < SCREENS.length - 1) set({ screen: state.screen + 1 })
      else if (dx > 0 && state.screen > 0)             set({ screen: state.screen - 1 })
    }
    isDragging.current = false
    setDragX(0)
  }

  // ── LONG PRESS ───────────────────────────────────────────────────────────────
  function onRecordPressStart() {
    longPressRef.current = setTimeout(() => {
      if (!state.recording) startSession()
      else stopSession()
      longPressRef.current = null
    }, LONG_PRESS_MS)
  }

  function onRecordPressEnd() {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
  }

  // ── MARK SWIPE UP ────────────────────────────────────────────────────────────
  const markTouchStart = useRef({ y: 0 })
  function onMarkTouchStart(e) { markTouchStart.current = { y: e.touches[0].clientY } }
  function onMarkTouchEnd(e) {
    const dy = markTouchStart.current.y - e.changedTouches[0].clientY
    if (dy > 40) set({ showMarkInput: true })
    else         markMoment()
  }

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div
      className="companion-root"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ touchAction: 'pan-y' }}
    >

      {/* ── STATUS BAR ── */}
      <header className="companion-header">
        <div className="companion-brand">
          <img src="/icon-mark.svg" alt="WhispaCuts" style={{ width: 28, height: 28 }}/>
          {cat && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginLeft: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {cat.name}
            </span>
          )}
        </div>
        <div className="header-right">
          {state.micLabel && (
            <div className="mic-label">
              {state.isDJI ? <Radio size={10} className="text-[#40a060]"/>
                : state.isExternal ? <Volume2 size={10} style={{ color: 'rgba(255,255,255,0.5)' }}/>
                : <Mic size={10} className="text-[#555]"/>}
              <span>{state.micLabel}</span>
            </div>
          )}
          {state.online ? <Wifi size={13} className="text-[#444]"/> : <WifiOff size={13} style={{ color: '#d4a853' }}/>}
          {state.recording && (
            <div className="rec-clock">
              <div className="rec-dot"/>
              <span>{fmt(state.elapsedMs)}</span>
            </div>
          )}
        </div>
      </header>

      {/* ── TAB BAR ── */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        {[{ label: 'Record', icon: '⏺' }, { label: 'Brainstorm', icon: '✦' }].map((tab, i) => (
          <button
            key={i}
            onClick={() => set({ screen: i })}
            style={{
              fontFamily: "'Figtree', sans-serif", fontSize: 11,
              fontWeight: state.screen === i ? 600 : 400,
              padding: '5px 16px', borderRadius: 20,
              border: `1px solid ${state.screen === i ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.08)'}`,
              background: state.screen === i ? KB_GREEN_FAINT : 'transparent',
              color: state.screen === i ? KB_GREEN_DIM : 'rgba(255,255,255,0.3)',
              cursor: 'pointer', transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{ fontSize: 9 }}>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* ── SLIDING SCREENS ── */}
      <div
        className="screens-container"
        style={{
          transform:  `translateX(calc(${-state.screen * 100}vw + ${dragX}px))`,
          transition: isDragging.current ? 'none' : 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}
      >

        {/* ══ SCREEN 0: RECORD ══ */}
        <div className="screen">

          {state.error && (
            <div className="error-banner">
              <MicOff size={14}/>
              <span>{state.error}</span>
            </div>
          )}

          {state.sessionId && (
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              {editingTitle ? (
                <input
                  autoFocus
                  value={sessionTitle}
                  onChange={e => setSessionTitle(e.target.value)}
                  onBlur={async () => {
                    setEditingTitle(false)
                    if (sessionTitle.trim() && state.sessionId) {
                      await api.patch('/session/' + state.sessionId + '/title', { title: sessionTitle.trim() }).catch(() => {})
                    }
                  }}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                  style={{ background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)', fontSize: 12, textAlign: 'center', outline: 'none', width: 200, padding: '2px 4px' }}
                />
              ) : (
                <button
                  onClick={() => setEditingTitle(true)}
                  style={{ color: '#555', fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.5px' }}
                >
                  {sessionTitle || 'tap to name this session'}
                </button>
              )}
            </div>
          )}

          {state.entries.length > 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
              <div className="entry-feed" ref={el => { if (el) el.scrollTop = el.scrollHeight }}>
                {state.entries.map(e => (
                  <EntryRow key={e.id} entry={e} onDelete={() => dispatch({ type: 'REMOVE_ENTRY', id: e.id })}/>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
              <MascotOrb mood={state.orbMood} audioLevel={state.audioLevel} size={300}/>
              {state.status === 'idle' && (
                <div className="idle-hint">
                  <p className="idle-title">Hold to start recording</p>
                  <p className="idle-body">
                    Open this before your DAW. Describe what you're hearing, what's working, what you're trying — in the moment, in your own words. It becomes your episode voice memo.
                  </p>
                  {state.micLabel && (
                    <p className="mic-hint">
                      {state.isExternal ? `🎙 ${state.micInfo || state.micLabel}` : 'Built-in mic — tap to improve quality'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {uploadProgress > 0 && (
            <div style={{ width: '100%', padding: '0 4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Transcribing audio...</span>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{uploadProgress}%</span>
              </div>
              <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'rgba(140,170,220,0.7)', borderRadius: 2, transition: 'width 0.2s ease' }}/>
              </div>
            </div>
          )}

          <div className="record-section">
            {state.recording && !state.showMarkInput && (
              <div className="mark-section">
                <button
                  className={`mark-btn ${state.justMarked ? 'mark-btn-flash' : ''}`}
                  onTouchStart={onMarkTouchStart}
                  onTouchEnd={onMarkTouchEnd}
                  onMouseDown={() => markMoment()}
                >
                  <Flag size={20}/>
                  <span className="mark-btn-label">{state.justMarked ? '✓ Marked' : 'Mark'}</span>
                  <span className="mark-swipe-hint">↑ label</span>
                </button>
                <div className="quick-marks">
                  {QUICK_MARKS.map(m => (
                    <button key={m.label} className="quick-mark-chip" onClick={() => markMoment(m.label)}>
                      {m.icon}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {state.showMarkInput && (
              <div className="mark-input-row">
                <input
                  autoFocus
                  className="mark-input"
                  placeholder="What's happening right now?"
                  value={state.markLabel}
                  onChange={e => set({ markLabel: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  markMoment(state.markLabel)
                    if (e.key === 'Escape') set({ showMarkInput: false, markLabel: '' })
                  }}
                />
                <button className="mark-input-send" onClick={() => markMoment(state.markLabel)}>
                  <Check size={18}/>
                </button>
              </div>
            )}

            <div style={{ marginTop: 8 }}>
              <RecordButton
                recording={state.recording}
                status={state.status}
                audioLevel={state.audioLevel}
                onPressStart={onRecordPressStart}
                onPressEnd={onRecordPressEnd}
              />
            </div>

            <p className="record-hint">
              {state.status === 'starting'  && 'Connecting mic...'}
              {state.status === 'stopping'  && 'Saving session...'}
              {state.status === 'recording' && `${state.entries.filter(e => e.type !== 'marker').length} utterances · ${state.entries.filter(e => e.type === 'marker').length} marks`}
              {state.status === 'idle'      && 'Hold 0.6s to start'}
              {state.status === 'ready'     && ''}
              {state.status === 'error'     && 'Tap to retry'}
            </p>
          </div>

          {state.status === 'ready' && !state.processed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
              <button className="process-btn" onClick={processSession} disabled={state.processing}>
                {state.processing
                  ? <><Loader2 size={16} className="animate-spin"/> Writing your memo...</>
                  : <><Send size={16}/> Generate memo &amp; open in app</>}
              </button>
              <button
                onClick={() => { window.location.href = '/' }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '8px 0' }}
              >
                Skip — view session in app →
              </button>
            </div>
          )}

          {state.processing && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(8,12,16,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, backdropFilter: 'blur(8px)' }}>
              <Loader2 size={36} style={{ color: '#d4a853', animation: 'spin 1s linear infinite' }}/>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, color: '#e8eaed' }}>Writing your memo...</div>
              <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    {processProgress < 30 ? 'Reading your session...' : processProgress < 60 ? 'Finding key moments...' : processProgress < 85 ? 'Writing your memo...' : 'Almost done...'}
                  </span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>{Math.round(processProgress)}%</span>
                </div>
                <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${processProgress}%`, background: 'linear-gradient(90deg, #d4a853, #e8c46a)', borderRadius: 2, transition: 'width 0.4s ease' }}/>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ══ SCREEN 1: BRAINSTORM ══ */}
        <BrainstormScreen categoryId={activeCategoryId}/>

      </div>
    </div>
  )
}

// ─── RECORD BUTTON ────────────────────────────────────────────────────────────
function RecordButton({ recording, status, audioLevel, onPressStart, onPressEnd }) {
  const [holdPct, setHoldPct] = useState(0)
  const holdRef = useRef(null)

  function startHold() {
    onPressStart()
    const start = Date.now()
    holdRef.current = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / LONG_PRESS_MS) * 100)
      setHoldPct(pct)
      if (pct >= 100) { clearInterval(holdRef.current); setHoldPct(0) }
    }, 20)
  }
  function endHold() {
    clearInterval(holdRef.current)
    onPressEnd()
    setTimeout(() => setHoldPct(0), 200)
  }

  return (
    <button
      className={`record-btn ${recording ? 'record-btn-active' : ''} ${status === 'starting' ? 'record-btn-starting' : ''}`}
      onTouchStart={startHold} onTouchEnd={endHold}
      onMouseDown={startHold}  onMouseUp={endHold} onMouseLeave={endHold}
      style={{ transform: `scale(${recording ? 1 + audioLevel * 0.08 : 1})` }}
    >
      {holdPct > 0 && holdPct < 100 && (
        <svg className="hold-ring" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="4" strokeDasharray={`${holdPct * 2.89} 289`} strokeLinecap="round" transform="rotate(-90 50 50)"/>
        </svg>
      )}
      {recording && <div className="pulse-ring" style={{ transform: `scale(${1 + audioLevel * 0.4})`, opacity: 0.3 + audioLevel * 0.5 }}/>}
      {status === 'starting' ? <Loader2 size={36} className="animate-spin"/> : recording ? <Square size={32}/> : <Mic size={36}/>}
    </button>
  )
}

// ─── ENTRY ROW ────────────────────────────────────────────────────────────────
function EntryRow({ entry, onDelete }) {
  const isMarker = entry.type === 'marker'
  const lowConf  = entry.confidence !== null && entry.confidence !== undefined && entry.confidence < 0.45
  return (
    <div className={`entry-row ${isMarker ? 'entry-row-marker' : ''}`} title={lowConf ? 'Low confidence — Whisper may have misheard this' : undefined}>
      <span className="entry-time">{fmt(entry.timestamp_ms)}</span>
      {isMarker && <Flag size={9} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}/>}
      <span className="entry-text" style={lowConf ? { color: 'rgba(255,255,255,0.4)', textDecoration: 'underline dotted rgba(255,255,255,0.2)' } : {}}>
        {entry.text}
      </span>
      {lowConf && <span style={{ fontSize: 8, color: '#555', marginLeft: 4, flexShrink: 0 }}>?</span>}
    </div>
  )
}

// ─── SWIPEABLE ENTRY ─────────────────────────────────────────────────────────
function SwipeableEntry({ entry, onDelete }) {
  const [offsetX, setOffsetX] = useState(0)
  const [deleted, setDeleted] = useState(false)
  const startX   = useRef(0)
  const isMarker = entry.type === 'marker'

  if (deleted) return null
  return (
    <div
      className={`swipeable-entry ${isMarker ? 'swipeable-entry-marker' : ''}`}
      style={{ transform: `translateX(${offsetX}px)`, opacity: deleted ? 0 : 1, transition: offsetX === 0 ? 'transform 0.22s ease, opacity 0.22s ease' : 'none' }}
      onTouchStart={e => { startX.current = e.touches[0].clientX }}
      onTouchMove={e  => { const dx = e.touches[0].clientX - startX.current; if (dx < 0) setOffsetX(Math.max(dx, -100)) }}
      onTouchEnd={() => { if (offsetX < -70) { setDeleted(true); setTimeout(onDelete, 280) } else { setOffsetX(0) } }}
    >
      <span className="entry-time">{fmt(entry.timestamp_ms)}</span>
      {isMarker && <Flag size={10} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }}/>}
      <span className="entry-text flex-1">{entry.text}</span>
      {offsetX < -30 && <Trash2 size={14} className="text-red-400 shrink-0" style={{ opacity: Math.min(1, (-offsetX - 30) / 40) }}/>}
    </div>
  )
}

// ─── BRAINSTORM SCREEN ────────────────────────────────────────────────────────
// Design mirrors web KB ChatPanel exactly:
//   neon green glow separator, Figtree/Syne fonts, same bubble styles,
//   same thinking dots, streaming cursor, generate strip.
//   MascotOrb replaces the sidebar — blob untouched.

function BrainstormScreen({ categoryId }) {
  const [messages,   setMessages]   = useState([])
  const [input,      setInput]      = useState('')
  const [streaming,  setStreaming]  = useState(false)
  const [streamText, setStreamText] = useState('')
  const [orbMood,    setOrbMood]    = useState('idle')
  const [generating, setGenerating] = useState(false)
  const [generated,  setGenerated]  = useState(null)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    if (!categoryId) return
    chatApi.getHistory({ categoryId, mode: 'generate' })
      .then(({ messages: h }) => setMessages(h || []))
      .catch(() => {})
  }, [categoryId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }])
    setInput('')
    setStreaming(true)
    setStreamText('')
    setOrbMood('processing')

    try {
      await chatApi.send(
        { categoryId, mode: 'generate', message: text, messages: [] },
        {
          chunk: ({ text: t }) => setStreamText(prev => prev + t),
          done:  ({ response }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: response, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
            setOrbMood('active')
            setTimeout(() => setOrbMood('idle'), 3000)
          },
          error: () => { setStreamText(''); setStreaming(false); setOrbMood('idle') },
        }
      )
    } catch { setStreaming(false); setOrbMood('idle') }
  }

  async function generateFromChat() {
    if (generating || !categoryId) return
    setGenerating(true)
    setOrbMood('processing')
    try {
      await chatApi.generateEpisode(
        { categoryId, mode: 'generate' },
        {
          progress: ({ message }) => {
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.isGenerating) return [...prev.slice(0, -1), { ...last, content: message }]
              return [...prev, { role: 'assistant', content: message, isGenerating: true }]
            })
          },
          done: ({ parsed }) => {
            setMessages(prev => prev.filter(m => !m.isGenerating))
            setGenerated(parsed?.metadata?.trackName)
            setGenerating(false)
            setOrbMood('discovery')
            setTimeout(() => setOrbMood('idle'), 4000)
          },
          error: () => { setMessages(prev => prev.filter(m => !m.isGenerating)); setGenerating(false); setOrbMood('idle') },
        }
      )
    } catch { setGenerating(false); setOrbMood('idle') }
  }

  const canGenerate = messages.length >= 4 && !streaming && !generating

  return (
    <div
      className="screen"
      style={{ display: 'flex', flexDirection: 'column', background: 'rgba(10,12,18,0.97)', overflow: 'hidden', padding: 0, position: 'relative' }}
    >
      {/* Neon green top separator — mirrors kb-panel::before */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent 0%, rgba(74,222,128,0) 10%, rgba(74,222,128,0.7) 35%, rgba(74,222,128,1) 50%, rgba(74,222,128,0.7) 65%, rgba(74,222,128,0) 90%, transparent 100%)', zIndex: 2 }}/>
      {/* Glow bloom — mirrors kb-panel::after */}
      <div style={{ position: 'absolute', top: 0, left: '10%', right: '10%', height: 40, background: 'radial-gradient(ellipse at 50% 0%, rgba(74,222,128,0.12) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 1 }}/>

      {/* Orb — replaces the sidebar; blob component untouched */}
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 16, paddingBottom: 4, flexShrink: 0, zIndex: 3 }}>
        <MascotOrb mood={orbMood} audioLevel={0} size={160}/>
      </div>

      {/* Mode header — mirrors kb-mode-name + kb-mode-label */}
      <div style={{ textAlign: 'center', paddingBottom: 10, flexShrink: 0 }}>
        <div style={{ fontFamily: "'Figtree', sans-serif", fontSize: 10, fontWeight: 500, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>
          Knowledge Base
        </div>
        <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 600, color: KB_GREEN, letterSpacing: '-0.01em' }}>
          Brainstorm
        </div>
      </div>

      {/* Messages — mirrors .kb-messages */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 10, scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.05) transparent', WebkitOverflowScrolling: 'touch' }}>

        {messages.length === 0 && !streaming && (
          // mirrors .kb-empty
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', gap: 6 }}>
            <div style={{ fontSize: 28, marginBottom: 4, opacity: 0.2, color: KB_GREEN }}>✦</div>
            <div style={{ fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'rgba(74,222,128,0.4)' }}>
              Hooks, structure, trending angles...
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          // mirrors .kb-msg + .kb-bubble
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '82%', padding: '10px 14px', borderRadius: 12,
              fontFamily: "'Figtree', sans-serif", fontSize: 14, lineHeight: 1.65, fontWeight: 400,
              ...(m.role === 'user'
                ? { borderBottomRightRadius: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#e8eaed' }
                : { borderBottomLeftRadius: 3,  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', color: '#b0b5c0' }),
            }}>
              <KBMessageContent content={m.content}/>
              {m.isGenerating && <span style={{ color: 'rgba(74,222,128,0.6)', marginLeft: 6 }}>✦</span>}
            </div>
          </div>
        ))}

        {/* Streaming bubble — mirrors kb-bubble assistant + .kb-cursor */}
        {streaming && streamText && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ maxWidth: '82%', padding: '10px 14px', borderRadius: 12, borderBottomLeftRadius: 3, fontFamily: "'Figtree', sans-serif", fontSize: 14, lineHeight: 1.65, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', color: '#b0b5c0' }}>
              <KBMessageContent content={streamText}/>
              <span style={{ display: 'inline-block', width: 2, height: 12, borderRadius: 1, marginLeft: 2, verticalAlign: 'middle', background: 'rgba(74,222,128,0.8)', animation: 'kb-blink 1s infinite' }}/>
            </div>
          </div>
        )}

        {/* Thinking dots — mirrors .kb-thinking + .kb-dot */}
        {streaming && !streamText && (
          <div style={{ display: 'flex', gap: 5, padding: '10px 0' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: KB_GREEN, animation: `kb-bounce 0.8s ${i * 150}ms infinite` }}/>
            ))}
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Generated bar — mirrors .kb-committed-bar */}
      {generated && (
        <div style={{ padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 7, borderTop: '1px solid rgba(74,222,128,0.08)', background: 'rgba(74,222,128,0.04)', color: 'rgba(74,222,128,0.7)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>
          <Check size={10}/> "{generated}" is ready — open WhispaCuts to review
        </div>
      )}

      {/* Generate strip — mirrors .kb-generate-strip */}
      {canGenerate && (
        <div style={{ margin: '0 12px 8px', padding: '9px 13px', borderRadius: 9, border: '1px solid rgba(74,222,128,0.12)', background: 'rgba(74,222,128,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontFamily: "'Figtree', sans-serif", fontSize: 13, color: 'rgba(74,222,128,0.55)' }}>
            Ready to generate from this conversation
          </span>
          <button
            onClick={generateFromChat}
            style={{ fontFamily: "'Figtree', sans-serif", fontSize: 13, fontWeight: 500, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(74,222,128,0.18)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.85)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            {generating ? <Loader2 size={9}/> : <Sparkles size={9}/>}
            {generating ? 'Generating...' : 'Generate episode'}
          </button>
        </div>
      )}

      {/* Input — mirrors .kb-input-area + .kb-input-wrap */}
      <div style={{ padding: '8px 16px 16px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '8px 12px' }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Hooks, structure, trending angles..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: "'Figtree', sans-serif", fontSize: 14, lineHeight: 1.5, color: '#e8eaed' }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || streaming}
            style={{ alignSelf: 'flex-end', width: 30, height: 30, borderRadius: 7, border: 'none', cursor: input.trim() && !streaming ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: input.trim() && !streaming ? KB_GREEN : 'rgba(255,255,255,0.04)', color: input.trim() && !streaming ? '#080808' : 'rgba(255,255,255,0.2)', transition: 'all 0.15s', opacity: !input.trim() || streaming ? 0.4 : 1 }}
          >
            <Send size={12}/>
          </button>
        </div>
      </div>

      {/* Keyframe injections for streaming animations */}
      <style>{`
        @keyframes kb-bounce { 0%,80%,100%{transform:translateY(0);opacity:.25} 40%{transform:translateY(-4px);opacity:.9} }
        @keyframes kb-blink  { 0%,100%{opacity:0} 50%{opacity:1} }
      `}</style>
    </div>
  )
}

// Inline markdown renderer — mirrors ChatPanel's MessageContent
function KBMessageContent({ content }) {
  const parts = (content || '').split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} style={{ color: '#e8eaed', fontWeight: 600 }}>{part.slice(2, -2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} style={{ fontFamily: 'monospace', fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3, color: '#b0b5c0' }}>{part.slice(1, -1)}</code>
        if (part === '\n') return <br key={i}/>
        return part
      })}
    </span>
  )
}