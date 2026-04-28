// frontend/src/pages/Companion.jsx
// WhispaCuts Companion — mobile-first PWA session capture.
// Designed to live on your phone home screen while you make music.
//
// Three swipeable screens:
//   [RECORD] ← swipe → [JOURNAL] ← swipe → [MEMO]
//
// Gestures:
//   Swipe left/right → navigate screens
//   Long press record button → start (prevents accidental taps)
//   Swipe up on mark button → add labelled mark
//   Tap entry to expand / swipe entry left → delete
//   Pull down on journal → refresh from server
//   Pinch on waveform → zoom in/out on timeline
//   Double tap waveform → jump to that position
//
// Audio:
//   Prefers external microphone (lav mic via USB-C / lightning adapter)
//   Falls back to built-in mic
//   Shows active input device name
//   Real-time waveform via Web Audio AnalyserNode

import {
  useState, useRef, useEffect, useCallback, useReducer
} from 'react'
import {
  Mic, MicOff, Square, Flag, Send, Wifi, WifiOff,
  ChevronLeft, ChevronRight, Trash2, Check, Loader2,
  Volume2, Radio, Clock, Bookmark, RefreshCw
} from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { getSession, supabase } from '../lib/supabase'
import { detectMic, buildConstraints, getRecordingBitrate, needsStereoSum, describeMic } from '../lib/micDetect'
import MascotOrb from '../components/companion/MascotOrb'

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SCREENS         = ['record', 'journal', 'memo']
const CHUNK_MS        = 12000      // transcribe every 12s
const WAVEFORM_BARS   = 48         // number of bars in visualiser
const LONG_PRESS_MS   = 600        // ms for long-press start
const SWIPE_THRESHOLD = 60         // px for swipe to register
const SWIPE_VELOCITY  = 0.3        // px/ms minimum velocity

// ─── STATE REDUCER ────────────────────────────────────────────────────────────
const initialState = {
  screen:      0,         // 0=record, 1=journal, 2=memo
  sessionId:   null,
  recording:   false,
  elapsedMs:   0,
  entries:     [],
  processed:   null,
  processing:  false,
  online:      true,
  micLabel:    '',
  orbMood:     'idle',
  isDJI:       false,
  isExternal:  false,
  micInfo:     '',
  audioLevel:  0,
  waveform:    new Array(WAVEFORM_BARS).fill(0),
  markLabel:   '',
  showMarkInput: false,
  justMarked:  false,
  status:      'idle',    // idle | starting | recording | stopping | processing | ready | error
  error:       null,
  sessions:    [],        // past sessions from server
  loadingSessions: false,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET':             return { ...state, ...action.payload }
    case 'ADD_ENTRY':       return { ...state, entries: [...state.entries, action.entry] }
    case 'REPLACE_SPEECH_ENTRY': return { ...state, entries: [...state.entries.filter(e => e.type !== 'speech'), action.entry] }
    case 'REMOVE_ENTRY':    return { ...state, entries: state.entries.filter(e => e.id !== action.id) }
    case 'SET_WAVEFORM':    return { ...state, waveform: action.data, audioLevel: action.level }
    case 'RESET_SESSION':   return { ...state, sessionId: null, recording: false, elapsedMs: 0, entries: [], processed: null, status: 'idle', error: null, justMarked: false }
    default:                return state
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
  const mediaRecorderRef = useRef(null)
  const audioChunksRef   = useRef([])
  const sessionStartRef  = useRef(null)
  const timerRef         = useRef(null)
  const chunkTimerRef    = useRef(null)
  const analyserRef      = useRef(null)
  const audioCtxRef      = useRef(null)
  const rafRef           = useRef(null)
  const sessionIdRef     = useRef(null)
  const longPressRef     = useRef(null)
  const audioMimeRef     = useRef('audio/webm')  // set on startSession, used in transcribeChunk
  const transcribeBufferRef = useRef([])          // accumulates ALL chunks for valid Whisper input
  const wakeLockRef      = useRef(null)          // Screen Wake Lock — keeps display on while recording
  const offlineQueue     = useRef([])

  // Touch tracking for swipe gestures
  const touchStart    = useRef({ x: 0, y: 0, t: 0 })
  const touchCurrent  = useRef({ x: 0, y: 0 })
  const swipeOffset   = useRef(0)
  const [dragX, setDragX]       = useState(0)
  const [sessionTitle, setSessionTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [pastSessions, setPastSessions] = useState([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const isDragging    = useRef(false)

  // Keep session ID ref in sync
  useEffect(() => { sessionIdRef.current = state.sessionId }, [state.sessionId])

  // Online detection
  useEffect(() => {
    const on  = async () => {
      set({ online: true })
      flushOfflineQueue()
    }
    const off = () => set({ online: false })
    window.addEventListener('online',  on)
    window.addEventListener('offline', off)
    set({ online: navigator.onLine })
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Named so it can be called from processSession too
  function loadPastSessions() {
    setLoadingSessions(true)
    api.get('/session?limit=20' + (activeCategoryId ? '&categoryId=' + activeCategoryId : ''))
      .then(({ sessions }) => setPastSessions(sessions || []))
      .catch(() => {})
      .finally(() => setLoadingSessions(false))
  }

  // Load past sessions when Journal tab is viewed
  useEffect(() => {
    if (state.screen !== 1) return
    loadPastSessions()
  }, [state.screen, activeCategoryId])

  // Re-acquire Wake Lock if page becomes visible again after phone unlock
  useEffect(() => {
    async function handleVisibility() {
      if (document.visibilityState === 'visible' && state.recording && !wakeLockRef.current) {
        try {
          wakeLockRef.current = await navigator.wakeLock?.request('screen')
        } catch {}
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

  // ── WAVEFORM VISUALISER ────────────────────────────────────────────────────

  function startWaveform(stream) {
    // Close any lingering AudioContext from a previous session
    // Without this, the mic stays claimed and the second recording gets stuck
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
      audioCtxRef.current = null
    }
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const source   = ctx.createMediaStreamSource(stream)

    // DJI Mic Mini 2 outputs stereo (L+R channels) — sum to mono for the analyser
    // so the waveform shows a combined signal rather than one channel only
    const analyser = ctx.createAnalyser()
    analyser.fftSize           = 128
    analyser.smoothingTimeConstant = 0.7

    const tracks   = stream.getAudioTracks()
    const isStereo = tracks[0]?.getSettings?.()?.channelCount === 2

    if (isStereo) {
      // DJI Mic Mini 2: sum stereo L+R → mono before analyser
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
      const bars  = []
      const step  = Math.floor(data.length / WAVEFORM_BARS)
      let   total = 0

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

  // ── MIC SELECTION — uses micDetect.js library ──────────────────────────────
  // Covers DJI, Røde, Shure, Sennheiser, Sony, Blue, Audio-Technica, Zoom,
  // TASCAM, Elgato, HyperX, Focusrite/Scarlett, Universal Audio, and more.
  // Each brand gets the optimal constraints (sample rate, processing, stereo).

  async function getBestMicStream() {
    // Step 1: request basic permission first — without this, enumerateDevices
    // returns empty labels and we can't detect the mic model
    let permStream
    try {
      permStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone access denied — tap Allow when your browser asks')
      }
      if (err.name === 'NotFoundError') {
        throw new Error('No microphone found — connect a mic and try again')
      }
      throw err
    }
    // Stop the permission-request stream — we'll get a better one below
    permStream.getTracks().forEach(t => t.stop())

    // Step 2: now enumerate with labels populated
    const devices     = await navigator.mediaDevices.enumerateDevices()
    const detection   = detectMic(devices)
    const constraints = buildConstraints(detection)

    // Step 3: get the optimised stream
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints)
    } catch {
      // Fallback to simplest constraints if advanced ones fail
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    }

    const activeTrack = stream.getAudioTracks()[0]
    const settings    = activeTrack?.getSettings?.() || {}
    const isStereo    = needsStereoSum(detection) || settings.channelCount === 2
    const bitrate     = getRecordingBitrate(detection)
    const isDJI       = /dji/i.test(detection.match?.brand || '')
    const isExternal  = detection.isExternal

    return {
      stream,
      label:      detection.displayLabel || activeTrack?.label || 'Microphone',
      isDJI,
      isExternal,
      isStereo,
      bitrate,
      sampleRate: settings.sampleRate || detection.match?.sampleRate || 44100,
      micInfo:    describeMic(detection),
      detection,
    }
  }

  // ── SESSION START / STOP ───────────────────────────────────────────────────

  async function startSession() {
    set({ status: 'starting', error: null })

    try {
      const { stream, label, isDJI, isExternal, isStereo: micIsStereo, bitrate, sampleRate, micInfo } = await getBestMicStream()
      set({ micLabel: label, isDJI, isExternal, micInfo })

      // Confirm mic detection via haptic
      // Single short buzz = built-in, double buzz = external, triple = DJI
      if (isDJI)       navigator.vibrate?.([30, 20, 30, 20, 80])
      else if (isExternal) navigator.vibrate?.([30, 20, 60])
      else             navigator.vibrate?.([30])

      // Create session in DB
      const { session } = await api.post('/session', {
        categoryId: activeCategoryId,
        title:      `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${cat?.name || 'untitled'}`,
      })

      sessionIdRef.current = session.id
      sessionStartRef.current = Date.now()
      audioChunksRef.current  = []

      // MediaRecorder mime type — prefer mp4/aac as it produces self-contained
      // chunks that Whisper handles reliably. webm produces fragmented chunks
      // that Whisper rejects even though it lists webm as supported.
      const mimeType = [
        'audio/mp4;codecs=aac',    // Chrome 130+, iOS Safari (best for Whisper)
        'audio/mp4',               // Chrome/iOS fallback
        'audio/webm;codecs=opus',  // Android fallback
        'audio/webm',              // last resort
      ].find(t => MediaRecorder.isTypeSupported(t)) || 'audio/mp4'

      // Use bitrate from micDetect.js — each brand has optimal value
      const audioBitrate = bitrate || (isExternal ? 192000 : 128000)

      audioMimeRef.current = mimeType
      transcribeBufferRef.current = []  // fresh buffer for each session
      console.info('[companion] Recording format:', mimeType)
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: audioBitrate })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.start(500)  // 500ms chunks for responsive waveform

      // Timers
      timerRef.current = setInterval(() => {
        set({ elapsedMs: Date.now() - sessionStartRef.current })
      }, 1000)

      chunkTimerRef.current = setInterval(() => {
        transcribeChunk(sessionIdRef.current)
      }, CHUNK_MS)

      startWaveform(stream)

      // Keep screen on while recording — iOS throttles background tabs when screen locks
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen')
          .then(lock => { wakeLockRef.current = lock })
          .catch(() => {})  // non-fatal — iOS <16.4 doesn't support this
      }

      setSessionTitle(session.title || '')

      set({
        sessionId: session.id,
        recording: true,
        status:    'recording',
        orbMood:   'listening',
        entries:   [],
        elapsedMs: 0,
        processed: null,
      })

      // Navigate to record screen if not there
      if (state.screen !== 0) set({ screen: 0 })

      // Haptic: single buzz = started
      navigator.vibrate?.([50])

    } catch (err) {
      set({
        status: 'error',
        error:  err.name === 'NotAllowedError'
          ? 'Microphone blocked — allow access in browser settings'
          : err.message
      })
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
    mediaRecorderRef.current = null  // release so next session starts clean

    // Final chunk
    await transcribeChunk(sessionIdRef.current)

    // Release wake lock
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {})
      wakeLockRef.current = null
    }
    set({ recording: false, status: 'ready', orbMood: 'idle' })
    navigator.vibrate?.([80, 40, 80])  // double buzz = stopped
  }

  // ── TRANSCRIPTION ──────────────────────────────────────────────────────────

  async function transcribeChunk(sid) {
    // We need ALL chunks including the header chunk (first chunk) to produce
    // a valid audio file. Splice only takes new chunks but keeps old ones for context.
    const newChunks = audioChunksRef.current.splice(0)
    if (!newChunks.length || !sid) return

    // Add new chunks to accumulated buffer
    if (!transcribeBufferRef.current) transcribeBufferRef.current = []
    transcribeBufferRef.current.push(...newChunks)

    // Build complete audio blob from ALL chunks so far — this gives Whisper
    // a valid self-contained file with the container header included
    const allChunks   = transcribeBufferRef.current
    const mimeType    = audioMimeRef.current || 'audio/webm'
    const blob        = new Blob(allChunks, { type: mimeType })
    const timestampMs = Date.now() - (sessionStartRef.current || Date.now())

    // Skip if too small — likely just the header with no audio yet
    if (blob.size < 8000) {
      console.info('[transcribe] Skipping — blob too small:', blob.size, 'bytes')
      return
    }

    console.info('[transcribe] Sending', Math.round(blob.size/1024), 'KB of', mimeType, 'to Whisper')

    const ext = mimeType.split(';')[0].split('/')[1] || 'webm'

    try {
      const session  = await getSession()
      const formData = new FormData()
      formData.append('audio', blob, `recording.${ext}`)
      formData.append('timestampMs', String(timestampMs))
      formData.append('isCumulative', 'true')  // tells backend to deduplicate entries

      const res = await fetch(
        `${import.meta.env.VITE_API_URL || '/api'}/session/${sid}/transcribe`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
          body:    formData,
        }
      )

      if (res.ok) {
        const data = await res.json()
        // Only flash discovery for meaningful transcriptions (not 1-2 word filler)
        if (data.entries?.length) {
          const hasSubstance = data.entries.some(e =>
            e.type !== 'marker' && (e.text || '').split(' ').length >= 5 &&
            (e.confidence === null || e.confidence === undefined || e.confidence > 0.55)
          )
          if (hasSubstance) {
            set({ orbMood: 'discovery' })
            setTimeout(() => set({ orbMood: 'listening' }), 1200)
          }
        }
        if (data.clientSideRequired) {
          console.info('[companion] Server-side transcription unavailable — add OPENAI_API_KEY or implement client-side Whisper path')
        } else if (data.entries?.length) {
          console.info('[transcribe] Got', data.entries.length, 'entries:', data.entries.map(e => e.text?.slice(0,40)))
          // Cumulative mode — replace the single speech entry rather than appending
          // so the UI shows the growing transcript without duplicates
          data.entries.forEach(e => dispatch({ type: e.type === 'speech' ? 'REPLACE_SPEECH_ENTRY' : 'ADD_ENTRY', entry: e }))
        } else {
          console.info('[transcribe] Response OK but no entries. Text:', data.text?.slice(0,80))
        }
      }
    } catch (err) {
      console.error('[transcribe] Failed:', err.message)
      // Queue for offline sync — will retry on reconnect
    }
  }

  // ── MARK MOMENT ────────────────────────────────────────────────────────────

  async function markMoment(label = '') {
    const timestampMs = sessionStartRef.current
      ? Date.now() - sessionStartRef.current
      : 0

    const text  = label.trim() || '★ Marked'
    const entry = {
      id:           `mark-${Date.now()}`,
      timestamp_ms: timestampMs,
      type:         'marker',
      text,
      energy:       1.0,
    }

    dispatch({ type: 'ADD_ENTRY', entry })
    set({ justMarked: true, showMarkInput: false, markLabel: '', orbMood: 'marking' })
    setTimeout(() => set({ orbMood: state.recording ? 'listening' : 'idle' }), 1200)
    setTimeout(() => set({ justMarked: false }), 1500)

    navigator.vibrate?.([30, 20, 30, 20, 80])  // pattern = "marked!"

    if (sessionIdRef.current && state.online) {
      api.post(`/session/${sessionIdRef.current}/entry`, {
        text, type: 'marker', timestampMs, energy: 1.0,
      }).catch(() => offlineQueue.current.push(entry))
    } else {
      offlineQueue.current.push(entry)
    }
  }

  // ── QUICK MARKS — common session moments ───────────────────────────────────
  const QUICK_MARKS = [
    { label: '✨ Found something', icon: '✨' },
    { label: '⚡ Energy peak',      icon: '⚡' },
    { label: '❌ Not working',       icon: '❌' },
    { label: '🔁 Try again',         icon: '🔁' },
    { label: '🎯 Keep this',         icon: '🎯' },
  ]

  // ── PROCESS SESSION ────────────────────────────────────────────────────────

  async function processSession() {
    if (!sessionIdRef.current) return
    set({ processing: true, orbMood: 'processing', error: null })

    // Small delay to let the final transcription chunk finish saving to DB
    // before we ask Claude to process it
    await new Promise(r => setTimeout(r, 2000))

    const timeoutId = setTimeout(() => {
      set({ processing: false, orbMood: 'idle', error: 'Memo generation timed out — try again', screen: 2 })
    }, 180000)  // 3 min — matches server timeout

    try {
      const result = await api.post(`/session/${sessionIdRef.current}/process`)
      clearTimeout(timeoutId)
      console.info('[process] Result:', JSON.stringify(result).slice(0, 200))
      const voiceMemoText = result?.voiceMemoText || result?.voice_memo_text || ''
      const keyMoments    = result?.keyMoments    || result?.key_moments    || []
      if (!voiceMemoText) throw new Error('No memo generated — speak clearly during recording')
      // Single dispatch — avoids race between two set() calls
      set({ processed: { voiceMemoText, keyMoments }, processing: false, orbMood: 'idle', screen: 2 })
      loadPastSessions()
      navigator.vibrate?.([100, 50, 100, 50, 200])
    } catch (err) {
      clearTimeout(timeoutId)
      console.error('[process] Error:', err.message)
      set({ processing: false, orbMood: 'idle', error: err.message || 'Processing failed', screen: 2 })
    }
  }

  // ── OFFLINE QUEUE FLUSH ────────────────────────────────────────────────────

  async function flushOfflineQueue() {
    if (!offlineQueue.current.length || !sessionIdRef.current) return
    const queue = offlineQueue.current.splice(0)
    await api.post(`/session/${sessionIdRef.current}/entries/batch`, { entries: queue })
      .catch(() => offlineQueue.current.unshift(...queue))
  }

  // ── SWIPE GESTURE HANDLERS ─────────────────────────────────────────────────

  function onTouchStart(e) {
    const t = e.touches[0]
    touchStart.current   = { x: t.clientX, y: t.clientY, t: Date.now() }
    touchCurrent.current = { x: t.clientX, y: t.clientY }
    isDragging.current   = false
  }

  function onTouchMove(e) {
    const t     = e.touches[0]
    const dx    = t.clientX - touchStart.current.x
    const dy    = t.clientY - touchStart.current.y
    touchCurrent.current = { x: t.clientX, y: t.clientY }

    // Only handle horizontal swipes (> 45° from vertical)
    if (!isDragging.current && Math.abs(dx) < 10) return
    if (!isDragging.current && Math.abs(dy) > Math.abs(dx)) return

    isDragging.current = true
    // Resist at edges (screens 0 and 2)
    let resistance = 1
    if ((state.screen === 0 && dx > 0) || (state.screen === 2 && dx < 0)) {
      resistance = 0.25
    }
    setDragX(dx * resistance)

    // Prevent scroll while swiping horizontally
    if (Math.abs(dx) > 5) e.preventDefault()
  }

  function onTouchEnd() {
    if (!isDragging.current) { setDragX(0); return }

    const dx       = touchCurrent.current.x - touchStart.current.x
    const dt       = Date.now() - touchStart.current.t
    const velocity = Math.abs(dx) / dt

    if (Math.abs(dx) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY) {
      if (dx < 0 && state.screen < SCREENS.length - 1) {
        set({ screen: state.screen + 1 })
      } else if (dx > 0 && state.screen > 0) {
        set({ screen: state.screen - 1 })
      }
    }

    isDragging.current = false
    setDragX(0)
  }

  // ── LONG PRESS — record button ─────────────────────────────────────────────

  function onRecordPressStart() {
    longPressRef.current = setTimeout(() => {
      if (!state.recording) startSession()
      else stopSession()
      longPressRef.current = null
    }, LONG_PRESS_MS)
  }

  function onRecordPressEnd() {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  // ── MARK BUTTON SWIPE UP ───────────────────────────────────────────────────

  const markTouchStart = useRef({ y: 0 })

  function onMarkTouchStart(e) {
    markTouchStart.current = { y: e.touches[0].clientY }
  }

  function onMarkTouchEnd(e) {
    const dy = markTouchStart.current.y - e.changedTouches[0].clientY
    if (dy > 40) {
      // Swiped up on mark button → show label input
      set({ showMarkInput: true })
    } else {
      // Regular tap → quick mark
      markMoment()
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  const canStart = !state.recording && state.status !== 'starting'
  const isActive = state.recording || state.status === 'starting'

  return (
    <div
      className="companion-root"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ touchAction: 'pan-y' }}
    >

      {/* ── STATUS BAR ──────────────────────────────────────────────────────── */}
      <header className="companion-header">
        <div className="companion-brand">
          <img src="/icon-mark.svg" alt="WhispaCuts" style={{ width: 26, height: 26 }}/>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, letterSpacing: '-0.3px', color: '#e8eaed' }}>
            Whispa<span style={{ color: '#d4a853' }}>Cuts</span>
          </span>
          {cat && <span className="brand-cat">{cat.name}</span>}
        </div>

        <div className="header-right">
          {/* Mic device label */}
          {state.micLabel && (
            <div className="mic-label">
              {state.isDJI
                ? <Radio size={10} className="text-[#40a060]"/>
                : state.isExternal
                ? <Volume2 size={10} className="text-[#c8b89a]"/>
                : <Mic size={10} className="text-[#555]"/>
              }
              <span>{state.micLabel}</span>
            </div>
          )}
          {/* Online status */}
          {state.online
            ? <Wifi size={13} className="text-[#444]"/>
            : <WifiOff size={13} className="text-[#c8a030]"/>
          }
          {/* Clock while recording */}
          {state.recording && (
            <div className="rec-clock">
              <div className="rec-dot"/>
              <span>{fmt(state.elapsedMs)}</span>
            </div>
          )}
        </div>
      </header>

      {/* ── SCREEN DOTS ─────────────────────────────────────────────────────── */}
      <div className="screen-dots">
        {SCREENS.map((_, i) => (
          <button
            key={i}
            onClick={() => set({ screen: i })}
            className={`dot ${state.screen === i ? 'dot-active' : ''}`}
          />
        ))}
      </div>

      {/* ── SLIDING SCREENS ─────────────────────────────────────────────────── */}
      {process.env.NODE_ENV !== 'production' && console.log('[render] screen:', state.screen, 'processed:', !!state.processed, 'processing:', state.processing)}
      <div
        className="screens-container"
        style={{
          transform: `translateX(calc(${-state.screen * 100}% + ${dragX}px))`,
          transition: isDragging.current ? 'none' : 'transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)',
        }}
      >

        {/* ══ SCREEN 0: RECORD ═══════════════════════════════════════════════ */}
        <div className="screen">

          {/* Error banner */}
          {state.error && (
            <div className="error-banner">
              <MicOff size={14}/>
              <span>{state.error}</span>
            </div>
          )}

          {/* Session title — tap to rename */}
          {state.sessionId && (
            <div style={{textAlign:'center',marginBottom:'4px'}}>
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
                  style={{background:'transparent',border:'none',borderBottom:'1px solid rgba(200,184,154,0.3)',color:'#c8b89a',fontSize:'12px',textAlign:'center',outline:'none',width:'200px',padding:'2px 4px'}}
                />
              ) : (
                <button
                  onClick={() => setEditingTitle(true)}
                  style={{color:'#555',fontSize:'11px',background:'none',border:'none',cursor:'pointer',letterSpacing:'0.5px'}}
                >
                  {sessionTitle || 'tap to name this session'}
                </button>
              )}
            </div>
          )}

          {/* When transcript entries exist: show centered, hide orb */}
          {state.entries.length > 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 0' }}>
              <div className="entry-feed" ref={el => {
                if (el) el.scrollTop = el.scrollHeight
              }} key={state.entries.length} style={{ maxHeight: '55vh' }}>
                {state.entries.map(e => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    elapsed={state.elapsedMs}
                    onDelete={() => dispatch({ type: 'REMOVE_ENTRY', id: e.id })}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* Orb — only shown when no transcript yet */
            <div style={{
              flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center',
            }}>
              <MascotOrb mood={state.orbMood} audioLevel={state.audioLevel} size={260}/>
            </div>
          )}

          {/* Idle instructions — only when not recording */}
          {state.status === 'idle' && (
            <div className="idle-hint">
              <p className="idle-title">Hold to start recording</p>
              <p className="idle-body">
                Open this before your DAW. Describe what you're hearing, what's working, what you're trying — in the moment, in your own words. It becomes your episode voice memo.
              </p>
              {state.micLabel && (
                <p className="mic-hint">
                  {state.isExternal
                    ? `🎙 ${state.micInfo || state.micLabel}`
                    : `Built-in mic — enable processing for best quality`}
                </p>
              )}
            </div>
          )}

          {/* ── BIG RECORD BUTTON ─────────────────────────────────────────── */}
          <div className="record-section">

            {/* Mark button with swipe-up gesture */}
            {state.recording && !state.showMarkInput && (
              <div className="mark-section">
                <button
                  className={`mark-btn ${state.justMarked ? 'mark-btn-flash' : ''}`}
                  onTouchStart={onMarkTouchStart}
                  onTouchEnd={onMarkTouchEnd}
                  onMouseDown={() => markMoment()}
                >
                  <Flag size={20}/>
                  <span className="mark-btn-label">
                    {state.justMarked ? '✓ Marked' : 'Mark'}
                  </span>
                  <span className="mark-swipe-hint">↑ label</span>
                </button>

                {/* Quick mark chips */}
                <div className="quick-marks">
                  {QUICK_MARKS.map(m => (
                    <button
                      key={m.label}
                      className="quick-mark-chip"
                      onClick={() => markMoment(m.label)}
                    >
                      {m.icon}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Label input for named marks */}
            {state.showMarkInput && (
              <div className="mark-input-row">
                <input
                  autoFocus
                  className="mark-input"
                  placeholder="What's happening right now?"
                  value={state.markLabel}
                  onChange={e => set({ markLabel: e.target.value })}
                  onKeyDown={e => {
                    if (e.key === 'Enter') markMoment(state.markLabel)
                    if (e.key === 'Escape') set({ showMarkInput: false, markLabel: '' })
                  }}
                />
                <button className="mark-input-send" onClick={() => markMoment(state.markLabel)}>
                  <Check size={18}/>
                </button>
              </div>
            )}

            {/* The main record button */}
            <RecordButton
              recording={state.recording}
              status={state.status}
              audioLevel={state.audioLevel}
              onPressStart={onRecordPressStart}
              onPressEnd={onRecordPressEnd}
            />

            <p className="record-hint">
              {state.status === 'starting'  && 'Connecting mic...'}
              {state.status === 'stopping'  && 'Saving session...'}
              {state.status === 'recording' && `${state.entries.filter(e=>e.type!=='marker').length} utterances · ${state.entries.filter(e=>e.type==='marker').length} marks`}
              {state.status === 'idle'      && 'Hold 0.6s to start'}
              {state.status === 'ready'     && `Session ready — swipe → to review`}
              {state.status === 'error'     && 'Tap to retry'}
            </p>
          </div>

          {/* Process button */}
          {state.status === 'ready' && !state.processed && (
            <button
              className="process-btn"
              onClick={processSession}
              disabled={state.processing}
            >
              {state.processing
                ? <><Loader2 size={16} className="animate-spin"/> Building memo...</>
                : <><Send size={16}/> Generate voice memo</>
              }
            </button>
          )}

          {/* Processing overlay — visible even after swiping away */}
          {state.processing && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 80,
              background: 'rgba(8,12,16,0.85)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16,
              backdropFilter: 'blur(4px)',
            }}>
              <Loader2 size={36} style={{ color: '#d4a853', animation: 'spin 1s linear infinite' }}/>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, color: '#e8eaed' }}>
                Writing your memo...
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center', maxWidth: 220 }}>
                Claude is processing your session notes
              </div>
            </div>
          )}
        </div>

        {/* ══ SCREEN 1: JOURNAL ══════════════════════════════════════════════ */}
        <div className="screen screen-journal"
          onTouchStart={e => { e._pullY = e.touches[0].clientY }}
          onTouchEnd={e => {
            const dist = e.changedTouches[0].clientY - (e._pullY || 0)
            if (dist > 60) loadPastSessions()
          }}
        >

          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
            <div className="screen-title" style={{margin:0}}>Sessions</div>
            <button onClick={loadPastSessions} disabled={loadingSessions}
              style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',display:'flex',alignItems:'center',gap:4,fontSize:12,padding:'4px 8px',fontFamily:'inherit'}}>
              <RefreshCw size={12} style={{animation:loadingSessions?'spin 1s linear infinite':'none'}}/>
              {loadingSessions ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {state.entries.length > 0 && (
            <>
              <div className="screen-title" style={{marginTop:8}}>This session</div>
              <div className="journal-list">
                {state.entries.map((e) => (
                  <SwipeableEntry key={e.id} entry={e} onDelete={() => dispatch({ type: 'REMOVE_ENTRY', id: e.id })}/>
                ))}
              </div>
            </>
          )}

          {pastSessions.length > 0 && (
            <div className="journal-list" style={{marginTop: state.entries.length ? 12 : 4}}>
              {pastSessions.map(s => (
                <div key={s.id} className="swipeable-entry"
                  style={{flexDirection:'column',gap:5,alignItems:'flex-start'}}
                >
                  <div style={{display:'flex',justifyContent:'space-between',width:'100%',alignItems:'center'}}>
                    <span
                      style={{fontSize:14,color:'#e8eaed',fontWeight:500,flex:1,cursor:s.voice_memo_text?'pointer':'default'}}
                      onClick={() => { if (s.voice_memo_text) set({ processed: { voiceMemoText: s.voice_memo_text, keyMoments: s.key_moments||[] }, screen: 2 }) }}
                    >{s.title||'Session'}</span>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                      <span style={{fontSize:11,color:'rgba(255,255,255,0.25)'}}>{new Date(s.recorded_at||s.created_at).toLocaleDateString()}</span>
                      <button
                        onClick={() => {
                          api.delete(`/session/${s.id}`).then(() => {
                            setPastSessions(prev => prev.filter(x => x.id !== s.id))
                          }).catch(() => {})
                        }}
                        style={{background:'none',border:'none',color:'rgba(255,255,255,0.2)',cursor:'pointer',padding:'2px 4px',fontSize:16,lineHeight:1}}
                        title="Delete session"
                      >×</button>
                    </div>
                  </div>
                  <span style={{fontSize:10,padding:'1px 6px',borderRadius:99,background:s.voice_memo_text?'rgba(74,222,128,0.1)':'rgba(255,255,255,0.05)',color:s.voice_memo_text?'#4ade80':'rgba(255,255,255,0.3)',border:s.voice_memo_text?'1px solid rgba(74,222,128,0.2)':'1px solid rgba(255,255,255,0.08)'}}>
                    {s.voice_memo_text ? 'tap to view memo' : (s.status||'recorded')}
                  </span>
                  {s.voice_memo_text && (
                    <div
                      style={{fontSize:12,color:'rgba(255,255,255,0.4)',lineHeight:1.4,display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',overflow:'hidden',cursor:'pointer'}}
                      onClick={() => set({ processed: { voiceMemoText: s.voice_memo_text, keyMoments: s.key_moments||[] }, screen: 2 })}
                    >
                      {s.voice_memo_text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!loadingSessions && pastSessions.length === 0 && state.entries.length === 0 && (
            <div className="empty-journal">
              <Bookmark size={28} style={{color:'rgba(255,255,255,0.1)'}}/>
              <p style={{color:'rgba(255,255,255,0.3)'}}>No sessions yet</p>
              <button onClick={() => set({ screen: 0 })}
                style={{marginTop:8,padding:'10px 20px',background:'#d4a853',color:'#080c10',border:'none',borderRadius:10,fontSize:14,fontWeight:700,fontFamily:'inherit',cursor:'pointer'}}>
                Start recording
              </button>
            </div>
          )}
        </div>

        {/* ══ SCREEN 2: MEMO ═════════════════════════════════════════════════ */}
        <div className="screen screen-memo">
          <div className="screen-title">Voice memo</div>

          {!state.processed && !state.processing && (
            <div className="empty-memo">
              {state.error
                ? <p style={{color:'#f87171',textAlign:'center',lineHeight:1.5,padding:'0 8px'}}>{state.error}</p>
                : <>
                    <Clock size={28} style={{color:'rgba(255,255,255,0.1)'}}/>
                    <p style={{color:'rgba(255,255,255,0.3)'}}>
                      {state.status === 'ready' ? 'Go back and tap Generate voice memo' : 'Record a session first'}
                    </p>
                  </>
              }
            </div>
          )}

          {state.processing && (
            <div className="memo-loading">
              <Loader2 size={24} className="animate-spin" style={{color:'#d4a853'}}/>
              <p>Claude is writing your voice memo...</p>
            </div>
          )}

          {state.processed && (
            <div className="memo-content">
              {/* Key moments */}
              {state.processed.keyMoments?.length > 0 && (
                <div className="memo-moments">
                  <div className="memo-section-label">Key moments</div>
                  {state.processed.keyMoments.map((m, i) => (
                    <div key={i} className="moment-row">
                      <span className="moment-time">{m.timestampFmt}</span>
                      <span className="moment-text">{m.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* The memo — editable before copying */}
              <div className="memo-section-label" style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                Voice memo
                <span style={{fontSize:'10px',color:'#444',letterSpacing:'1px'}}>tap to edit</span>
              </div>
              <textarea
                className="memo-text"
                value={state.processed.voiceMemoText}
                onChange={e => set({ processed: { ...state.processed, voiceMemoText: e.target.value } })}
                rows={8}
                style={{resize:'vertical',outline:'none',border:'1px solid rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)',borderRadius:'12px',padding:'16px',fontFamily:'inherit',fontSize:'15px',color:'#e8eaed',lineHeight:'1.7',width:'100%',boxSizing:'border-box'}}
              />

              {/* Actions */}
              <div className="memo-actions">
                <button
                  className="memo-action-btn memo-action-primary"
                  onClick={() => {
                    navigator.clipboard?.writeText(state.processed.voiceMemoText)
                    navigator.vibrate?.([50])
                  }}
                >
                  <Send size={15}/> Copy to episode form
                </button>
                <button
                  className="memo-action-btn memo-action-secondary"
                  onClick={() => {
                    navigator.share?.({
                      title: 'Session memo',
                      text:  state.processed.voiceMemoText,
                    })
                  }}
                >
                  Share
                </button>
              </div>

              <button
                className="new-session-btn"
                onClick={() => {
                  dispatch({ type: 'RESET_SESSION' })
                  set({ screen: 0 })
                }}
              >
                Start new session
              </button>
            </div>
          )}
        </div>

      </div>{/* end screens */}

      {/* ── BOTTOM NAV HINT ─────────────────────────────────────────────────── */}
      <footer className="companion-footer">
        <button onClick={() => set({ screen: 0 })} className={`footer-tab ${state.screen===0?'footer-tab-active':''}`}>
          <Mic size={16}/>
          <span>Record</span>
        </button>
        <button onClick={() => set({ screen: 1 })} className={`footer-tab ${state.screen===1?'footer-tab-active':''}`}>
          <Bookmark size={16}/>
          <span>Journal</span>
        </button>
        <button onClick={() => set({ screen: 2 })} className={`footer-tab ${state.screen===2?'footer-tab-active':''}`}>
          <Send size={16}/>
          <span>Memo</span>
        </button>
      </footer>

    </div>
  )
}

// ─── WAVEFORM VISUALISER ───────────────────────────────────────────────────────
function Waveform({ bars, active, level }) {
  return (
    <div className="waveform">
      {bars.map((v, i) => (
        <div
          key={i}
          className="waveform-bar"
          style={{
            height: `${Math.max(2, v * 100)}%`,
            opacity: active ? 0.4 + v * 0.6 : 0.15,
            background: active && v > 0.7
              ? `rgba(232, 200, 122, ${0.6 + v * 0.4})`
              : active
              ? `rgba(200, 184, 154, ${0.4 + v * 0.6})`
              : '#1a1a1a',
            transform: `scaleY(${active ? 1 : 0.3})`,
            transition: active
              ? `height 80ms ease, opacity 80ms ease`
              : `height 600ms ease, opacity 600ms ease, transform 600ms ease`,
          }}
        />
      ))}
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
      if (pct >= 100) {
        clearInterval(holdRef.current)
        setHoldPct(0)
      }
    }, 20)
  }

  function endHold() {
    clearInterval(holdRef.current)
    onPressEnd()
    setTimeout(() => setHoldPct(0), 200)
  }

  const scale = recording ? 1 + audioLevel * 0.08 : 1

  return (
    <button
      className={`record-btn ${recording ? 'record-btn-active' : ''} ${status === 'starting' ? 'record-btn-starting' : ''}`}
      onTouchStart={startHold}
      onTouchEnd={endHold}
      onMouseDown={startHold}
      onMouseUp={endHold}
      onMouseLeave={endHold}
      style={{ transform: `scale(${scale})` }}
    >
      {/* Hold progress ring */}
      {holdPct > 0 && holdPct < 100 && (
        <svg className="hold-ring" viewBox="0 0 100 100">
          <circle
            cx="50" cy="50" r="46"
            fill="none"
            stroke="rgba(200,184,154,0.8)"
            strokeWidth="4"
            strokeDasharray={`${holdPct * 2.89} 289`}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
          />
        </svg>
      )}
      {/* Audio level pulse ring */}
      {recording && (
        <div
          className="pulse-ring"
          style={{ transform: `scale(${1 + audioLevel * 0.4})`, opacity: 0.3 + audioLevel * 0.5 }}
        />
      )}
      {status === 'starting'
        ? <Loader2 size={36} className="animate-spin"/>
        : recording
        ? <Square size={32}/>
        : <Mic size={36}/>
      }
    </button>
  )
}

// ─── ENTRY ROW (in live feed) ─────────────────────────────────────────────────
function EntryRow({ entry, onDelete }) {
  const isMarker = entry.type === 'marker'
  const lowConf  = entry.confidence !== null && entry.confidence !== undefined && entry.confidence < 0.45
  return (
    <div className={`entry-row ${isMarker ? 'entry-row-marker' : ''}`} title={lowConf ? 'Low confidence — Whisper may have misheard this' : undefined}>
      <span className="entry-time">{fmt(entry.timestamp_ms)}</span>
      {isMarker && <Flag size={9} className="text-[#c8b89a] shrink-0"/>}
      <span className="entry-text" style={lowConf ? {color:'#666',textDecoration:'underline dotted rgba(200,184,154,0.4)'} : {}}>
        {entry.text}
      </span>
      {lowConf && <span style={{fontSize:'8px',color:'#555',marginLeft:'4px',flexShrink:0}}>?</span>}
    </div>
  )
}

// ─── SWIPEABLE ENTRY (journal view) ──────────────────────────────────────────
function SwipeableEntry({ entry, onDelete }) {
  const [offsetX, setOffsetX] = useState(0)
  const [deleted, setDeleted] = useState(false)
  const startX   = useRef(0)
  const isMarker = entry.type === 'marker'

  function onSwipeStart(e)   { startX.current = e.touches[0].clientX }
  function onSwipeMove(e) {
    const dx = e.touches[0].clientX - startX.current
    if (dx < 0) setOffsetX(Math.max(dx, -100))
  }
  function onSwipeEnd() {
    if (offsetX < -70) {
      setDeleted(true)
      setTimeout(onDelete, 280)
    } else {
      setOffsetX(0)
    }
  }

  if (deleted) return null

  return (
    <div
      className={`swipeable-entry ${isMarker ? 'swipeable-entry-marker' : ''}`}
      style={{
        transform:  `translateX(${offsetX}px)`,
        opacity:    deleted ? 0 : 1,
        transition: offsetX === 0 ? 'transform 0.22s ease, opacity 0.22s ease' : 'none',
      }}
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      <span className="entry-time">{fmt(entry.timestamp_ms)}</span>
      {isMarker && <Flag size={10} className="text-[#c8b89a] shrink-0"/>}
      <span className="entry-text flex-1">{entry.text}</span>
      {/* Delete hint revealed on swipe */}
      {offsetX < -30 && (
        <Trash2 size={14} className="text-red-400 shrink-0" style={{ opacity: Math.min(1, (-offsetX - 30) / 40) }}/>
      )}
    </div>
  )
}