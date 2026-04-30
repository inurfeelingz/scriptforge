// frontend/src/pages/Teleprompter.jsx
// Batch 2 improvements:
//  05 — Auto-load active episode script + episode picker dropdown
//  06 — In-teleprompter VO recording → auto-sends to alignment endpoint

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play, Pause, RotateCcw, Maximize, Minimize, X,
  ChevronDown, Mic, MicOff, Square, AlignCenter,
  RefreshCw, Check, AlertCircle, BookOpen,
} from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi, api } from '../lib/api'
import { getSession } from '../lib/supabase'

// ── Recording state machine ───────────────────────────────────────────────────
// idle → requesting → recording → stopping → uploading → aligning → done | error

export default function Teleprompter() {
  const { activeCategoryId, activeCategory, notify } = useStore()
  const cat = activeCategory?.()

  // Script / episode state
  const [episodes,       setEpisodes]       = useState([])
  const [selectedEpId,   setSelectedEpId]   = useState('')
  const [script,         setScript]         = useState('')
  const [episodeName,    setEpisodeName]     = useState('')
  const [loadingEp,      setLoadingEp]      = useState(false)
  const [started,        setStarted]        = useState(false)

  // Playback state
  const [playing,        setPlaying]        = useState(false)
  const [speed,          setSpeed]          = useState(4)
  const [fontSize,       setFontSize]       = useState(42)
  const [position,       setPosition]       = useState(0)
  const [fullscreen,     setFullscreen]     = useState(false)
  const [mirrored,       setMirrored]       = useState(false)

  // 06 — Recording state
  const [recState,       setRecState]       = useState('idle')
  // idle | requesting | recording | stopping | uploading | aligning | done | error
  const [recDurationMs,  setRecDurationMs]  = useState(0)
  const [recError,       setRecError]       = useState('')
  const [alignResult,    setAlignResult]    = useState(null)
  // alignResult: { aligned: N, wordCount: N, projectId: string | null }

  // Refs
  const textRef      = useRef(null)
  const frameRef     = useRef(null)
  const lastTime     = useRef(null)
  const posRef       = useRef(0)
  const mediaRecRef  = useRef(null)
  const chunksRef    = useRef([])
  const recTimerRef  = useRef(null)
  const recStartRef  = useRef(0)

  // ── Load episodes list ───────────────────────────────────────────────────
  useEffect(() => {
    if (!activeCategoryId) return
    episodesApi.list({ categoryId: activeCategoryId, status: 'ready', limit: 30 })
      .then(({ episodes: eps }) => {
        setEpisodes(eps || [])
        // Auto-select the most recent episode
        if (eps?.length && !selectedEpId) {
          setSelectedEpId(eps[0].id)
        }
      })
      .catch(console.warn)
  }, [activeCategoryId])

  // 05 — Load script when episode selection changes
  useEffect(() => {
    if (!selectedEpId) return
    setLoadingEp(true)
    episodesApi.get(selectedEpId)
      .then(({ episode }) => {
        const voScript = episode?.vo_script || ''
        setScript(voScript)
        setEpisodeName(episode?.track_name || '')
        setLoadingEp(false)
      })
      .catch(() => setLoadingEp(false))
  }, [selectedEpId])

  // ── Scroll animation ─────────────────────────────────────────────────────
  const pxPerSec = useCallback(() => 8 * Math.pow(speed, 1.45), [speed])

  useEffect(() => {
    if (!playing) { lastTime.current = null; return }
    const tick = (ts) => {
      if (lastTime.current) {
        const delta = (ts - lastTime.current) / 1000
        posRef.current = Math.min(
          posRef.current + pxPerSec() * delta,
          textRef.current?.scrollHeight || 0
        )
        setPosition(posRef.current)
      }
      lastTime.current = ts
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [playing, pxPerSec])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!started) return
      if (e.code === 'Space')     { e.preventDefault(); setPlaying(p => !p) }
      if (e.code === 'ArrowUp')   setSpeed(s => Math.min(10, s + 0.5))
      if (e.code === 'ArrowDown') setSpeed(s => Math.max(1,  s - 0.5))
      if (e.code === 'KeyR')      { posRef.current = 0; setPosition(0); setPlaying(false) }
      if (e.code === 'Escape' && fullscreen) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [started, fullscreen])

  // ── 06: Recording ────────────────────────────────────────────────────────

  async function startRecording() {
    setRecState('requesting')
    setRecError('')
    setAlignResult(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate:   44100,
          echoCancellation: false,   // off — you're recording your own voice, not a call
          noiseSuppression: true,
          autoGainControl: true,
        }
      })

      // Pick best supported format
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find(t => MediaRecorder.isTypeSupported(t)) || ''

      chunksRef.current = []
      recStartRef.current = Date.now()

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {})
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.start(1000)  // collect chunks every second
      mediaRecRef.current = mr

      setRecState('recording')

      // Live duration counter
      recTimerRef.current = setInterval(() => {
        setRecDurationMs(Date.now() - recStartRef.current)
      }, 500)

    } catch (err) {
      const msg = err.name === 'NotAllowedError'
        ? 'Microphone permission denied — allow mic access and try again'
        : 'Could not access microphone: ' + err.message
      setRecError(msg)
      setRecState('error')
    }
  }

  async function stopAndAlign() {
    if (!mediaRecRef.current) return
    setRecState('stopping')
    clearInterval(recTimerRef.current)

    // Stop the MediaRecorder and wait for final chunk
    await new Promise(resolve => {
      mediaRecRef.current.onstop = resolve
      mediaRecRef.current.stop()
      // Stop all audio tracks
      mediaRecRef.current.stream?.getTracks().forEach(t => t.stop())
    })

    const mimeType = mediaRecRef.current.mimeType || 'audio/webm'
    const blob     = new Blob(chunksRef.current, { type: mimeType })
    const ext      = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'

    setRecState('uploading')

    try {
      // Step 1: Transcribe with Whisper (word-level timestamps)
      const session  = await getSession()
      const formData = new FormData()
      formData.append('audio', blob, `vo-recording.${ext}`)

      const transcribeRes = await fetch(
        `${import.meta.env.VITE_API_URL || '/api'}/session/standalone/transcribe`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${session?.access_token}` },
          body:    formData,
        }
      )

      if (!transcribeRes.ok) {
        const err = await transcribeRes.json().catch(() => ({}))
        throw new Error(err.error || `Whisper failed (${transcribeRes.status})`)
      }

      const whisperOutput = await transcribeRes.json()
      notify(`Transcribed ${whisperOutput.wordCount} words — aligning timeline…`, 'info', 4000)

      // Step 2: Find the editor project for this episode (if one exists)
      // and run alignment. If no project exists, skip alignment silently.
      setRecState('aligning')

      let aligned   = 0
      let projectId = null

      if (selectedEpId) {
        try {
          // Look up editor project linked to this episode
          const projectsRes = await api.get(`/editor/projects?episodeId=${selectedEpId}&limit=1`)
          const project     = projectsRes?.projects?.[0]

          if (project?.id && project?.timeline?.length) {
            const alignRes = await api.post(`/editor/projects/${project.id}/align`, {
              whisperOutput,
              fps: 25,
            })
            aligned   = alignRes.aligned   || 0
            projectId = project.id
          }
        } catch {
          // No editor project — alignment is optional, don't fail
        }
      }

      setAlignResult({
        wordCount:   whisperOutput.wordCount,
        durationMs:  whisperOutput.durationMs,
        aligned,
        projectId,
      })

      setRecState('done')
      notify(
        aligned > 0
          ? `VO aligned — ${aligned} timeline clips repositioned`
          : `VO transcribed (${whisperOutput.wordCount} words) — no editor project to align yet`,
        'success'
      )

    } catch (err) {
      setRecError(err.message)
      setRecState('error')
      notify('Alignment failed: ' + err.message, 'error')
    }
  }

  function resetRecording() {
    setRecState('idle')
    setRecError('')
    setAlignResult(null)
    setRecDurationMs(0)
    chunksRef.current = []
    mediaRecRef.current = null
  }

  function formatDuration(ms) {
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  // ── Setup screen ─────────────────────────────────────────────────────────
  if (!started) return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Teleprompter</h1>
        <p className="text-sm text-[#555] mt-1">Load an episode script or paste your own</p>
      </div>

      {/* 05 — Episode picker */}
      {episodes.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-[#666] uppercase tracking-wide">Load episode script</label>
          <div className="relative">
            <select
              value={selectedEpId}
              onChange={e => setSelectedEpId(e.target.value)}
              className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] outline-none focus:border-[#c8b89a]/40 appearance-none pr-8"
            >
              <option value="">— paste script manually —</option>
              {episodes.map(ep => (
                <option key={ep.id} value={ep.id}>
                  Ep {ep.episode_number}: {ep.track_name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-3 text-[#444] pointer-events-none"/>
          </div>
          {loadingEp && (
            <div className="flex items-center gap-2 text-xs text-[#555]">
              <RefreshCw size={10} className="animate-spin"/> Loading script…
            </div>
          )}
          {script && episodeName && !loadingEp && (
            <div className="flex items-center gap-2 text-xs text-[#40a060]">
              <Check size={10}/> Loaded: {episodeName} ({script.trim().split(/\s+/).length} words)
            </div>
          )}
        </div>
      )}

      {/* Manual paste */}
      <div className="space-y-1">
        <label className="text-xs text-[#666] uppercase tracking-wide">
          {selectedEpId ? 'Script preview / edit' : 'Paste script'}
        </label>
        <textarea
          value={script}
          onChange={e => setScript(e.target.value)}
          placeholder={"Paste your voiceover script here...\n\n[CAM-001 ~0:00] Lines with clip hints will be dimmed automatically."}
          rows={10}
          className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-4 py-3 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40 resize-none font-mono"
        />
      </div>

      {/* Font size */}
      <div className="flex items-center gap-4">
        <div className="space-y-1 flex-1">
          <label className="text-xs text-[#666]">Font size: {fontSize}px</label>
          <input
            type="range" min={20} max={72} value={fontSize}
            onChange={e => setFontSize(+e.target.value)}
            className="w-full accent-[#c8b89a]"
          />
        </div>
      </div>

      <button
        onClick={() => setStarted(true)}
        disabled={!script.trim()}
        className="w-full py-3 bg-[#c8b89a] text-[#080808] font-medium rounded hover:bg-[#e8c87a] disabled:opacity-40 transition-all flex items-center justify-center gap-2"
      >
        <BookOpen size={15}/> Start session
      </button>
    </div>
  )

  // ── Session screen ────────────────────────────────────────────────────────
  const lines  = script.split('\n').map((line, i) => ({
    text:   line.trim(),
    isHint: /^\[(?:CAM|DAW|BROLL)/i.test(line.trim()),
    key:    i,
  }))

  const totalH = textRef.current?.scrollHeight || 0
  const pct    = totalH ? Math.min(100, (position / totalH) * 100) : 0

  return (
    <div
      className={`${fullscreen ? 'fixed inset-0 z-50' : 'rounded overflow-hidden'} flex flex-col`}
      style={{ minHeight: fullscreen ? undefined : 600, background: '#080c10', position: 'relative' }}
    >
      {/* Progress bar */}
      <div className="h-0.5 bg-[#111] shrink-0">
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: '#d4a853' }}/>
      </div>

      {/* Script area — fills all space, controls overlay at bottom */}
      <div className="flex-1 overflow-hidden relative">
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[#080c10] to-transparent z-10 pointer-events-none"/>
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#080c10] to-transparent z-10 pointer-events-none"/>
        <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: '50%', height: 1, background: 'rgba(255,255,255,0.06)' }}/>

        <div
          ref={textRef}
          className={mirrored ? 'scale-x-[-1]' : ''}
          style={{ paddingTop: '50vh', paddingBottom: '80px', paddingLeft: '10vw', paddingRight: '10vw', transform: `translateY(-${position}px)` }}
        >
          {lines.map(l => (
            <span
              key={l.key}
              className={`block leading-relaxed mb-1 ${l.isHint ? 'text-[#555] font-mono' : 'text-[#f0ede8]'}`}
              style={{ fontSize: l.isHint ? fontSize * 0.38 : fontSize }}
            >
              {l.text || '\u00A0'}
            </span>
          ))}
        </div>
      </div>

      {/* Controls bar — fixed to bottom of teleprompter */}
      <div className="shrink-0 border-t border-[#1a1a1a]" style={{ background: '#080c10' }}>

        {/* 06 — Recording status strip (shown when not idle/done) */}
        {recState !== 'idle' && recState !== 'done' && (
          <div className={`flex items-center gap-3 px-6 py-2.5 border-b border-[#111] text-xs ${
            recState === 'error' ? 'bg-red-950/20' : 'bg-[#0c0c0c]'
          }`}>
            {recState === 'recording' && (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0"/>
                <span className="text-red-400 font-mono">{formatDuration(recDurationMs)}</span>
                <span className="text-[#555]">Recording VO…</span>
                <button
                  onClick={stopAndAlign}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded border border-red-800/50 text-red-400 hover:bg-red-900/20 transition-all"
                >
                  <Square size={10}/> Stop &amp; align
                </button>
              </>
            )}
            {(recState === 'stopping' || recState === 'uploading') && (
              <>
                <RefreshCw size={11} className="animate-spin text-[#c8b89a] shrink-0"/>
                <span className="text-[#555]">
                  {recState === 'stopping' ? 'Finalising recording…' : 'Transcribing with Whisper…'}
                </span>
              </>
            )}
            {recState === 'aligning' && (
              <>
                <AlignCenter size={11} className="text-[#c8b89a] shrink-0"/>
                <span className="text-[#555]">Aligning timeline to VO words…</span>
              </>
            )}
            {recState === 'requesting' && (
              <>
                <RefreshCw size={11} className="animate-spin text-[#555] shrink-0"/>
                <span className="text-[#555]">Requesting microphone…</span>
              </>
            )}
            {recState === 'error' && (
              <>
                <AlertCircle size={11} className="text-red-400 shrink-0"/>
                <span className="text-red-400 truncate">{recError}</span>
                <button onClick={resetRecording} className="ml-auto text-[#555] hover:text-[#888]">
                  <X size={12}/>
                </button>
              </>
            )}
          </div>
        )}

        {/* Alignment success strip */}
        {recState === 'done' && alignResult && (
          <div className="flex items-center gap-3 px-6 py-2.5 border-b border-[#111] bg-[#0a0f0a] text-xs">
            <Check size={11} className="text-[#40a060] shrink-0"/>
            <span className="text-[#40a060]">
              {alignResult.aligned > 0
                ? `${alignResult.aligned} clips aligned to ${alignResult.wordCount} words`
                : `Transcribed — ${alignResult.wordCount} words, ${formatDuration(alignResult.durationMs)}`}
            </span>
            {alignResult.projectId && (
              <span className="text-[#555]">· timeline updated in Editor</span>
            )}
            <button onClick={resetRecording} className="ml-auto text-[#444] hover:text-[#666]">
              <X size={11}/>
            </button>
          </div>
        )}

        {/* Main controls */}
        <div className="flex items-center gap-4 px-6 py-4">

          {/* Reset */}
          <button
            onClick={() => { posRef.current = 0; setPosition(0); setPlaying(false) }}
            className="text-[#444] hover:text-[#888] transition-colors"
          >
            <RotateCcw size={16}/>
          </button>

          {/* Play/pause */}
          <button
            onClick={() => setPlaying(p => !p)}
            className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
              playing
                ? 'border-[#c8b89a] text-[#c8b89a] bg-[#c8b89a]/10'
                : 'border-[#333] text-[#666] hover:border-[#666]'
            }`}
          >
            {playing ? <Pause size={14}/> : <Play size={14}/>}
          </button>

          {/* Speed */}
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-[#444]">Speed</span>
            <input
              type="range" min={1} max={10} step={0.1} value={speed}
              onChange={e => setSpeed(+e.target.value)}
              className="flex-1 accent-[#c8b89a]"
            />
            <span className="text-xs text-[#c8b89a] w-6">{speed.toFixed(1)}</span>
          </div>

          <span className="text-xs text-[#444]">{Math.round(pct)}%</span>

          {/* Mirror */}
          <button
            onClick={() => setMirrored(m => !m)}
            className={`text-xs px-2 py-1 rounded border transition-all ${
              mirrored ? 'border-[#c8b89a]/40 text-[#c8b89a]' : 'border-[#222] text-[#444]'
            }`}
          >⇔</button>

          {/* 06 — Record button */}
          <button
            onClick={recState === 'idle' || recState === 'done' ? startRecording : stopAndAlign}
            disabled={recState === 'requesting' || recState === 'stopping' || recState === 'uploading' || recState === 'aligning'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-all disabled:opacity-40 ${
              recState === 'recording'
                ? 'border-red-700/60 text-red-400 bg-red-900/15 hover:bg-red-900/25'
                : 'border-[#333] text-[#555] hover:border-[#c8b89a]/30 hover:text-[#c8b89a]'
            }`}
            title={recState === 'recording' ? 'Stop recording and align' : 'Record VO and auto-align timeline'}
          >
            {recState === 'recording'
              ? <><Square size={10}/> Stop</>
              : recState === 'idle' || recState === 'done'
                ? <><Mic size={11}/> Record VO</>
                : <RefreshCw size={10} className="animate-spin"/>
            }
          </button>

          {/* Fullscreen */}
          <button
            onClick={() => setFullscreen(f => !f)}
            className="text-[#444] hover:text-[#888] transition-colors"
          >
            {fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}
          </button>

          {/* Exit session */}
          <button
            onClick={() => {
              setStarted(false)
              setPlaying(false)
              posRef.current = 0
              setPosition(0)
              resetRecording()
            }}
            className="text-[#444] hover:text-red-400 transition-colors"
          >
            <X size={16}/>
          </button>
        </div>
      </div>
    </div>
  )
}