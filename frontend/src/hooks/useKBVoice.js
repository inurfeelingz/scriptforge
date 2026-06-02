// frontend/src/hooks/useKBVoice.js
// KB voice system:
//   - Speech input: Web Speech API (free, browser native)
//   - Speech output: ElevenLabs TTS via backend proxy
//
// FIX: auto-restart on no-speech so a brief pause doesn't kill the session.
// FIX: removed racing getUserMedia call — let SpeechRecognition handle its own mic.
// FIX: short startup delay so mic hardware is ready before recognition begins.

import { useState, useRef, useCallback, useEffect } from 'react'
import { getSession } from '../lib/supabase'

const MAX_RESTARTS   = 8    // max silent restarts before giving up
const RESTART_DELAY  = 300  // ms to wait before restarting after no-speech

export default function useKBVoice({ onTranscript, onError, enabled = true }) {
  const [listening,  setListening]  = useState(false)
  const [speaking,   setSpeaking]   = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [supported,  setSupported]  = useState(false)

  const recognitionRef  = useRef(null)
  const audioRef        = useRef(null)
  const analyserRef     = useRef(null)
  const audioCtxRef     = useRef(null)
  const rafRef          = useRef(null)
  const accumulatedRef  = useRef('')   // full transcript built across restarts
  const restartCountRef = useRef(0)
  const activeRef       = useRef(false) // true = user wants to be listening

  // Check browser support on mount
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    setSupported(!!SR)
  }, [])

  // ── AUDIO LEVEL ANALYSIS ──────────────────────────────────────────────────
  function startAnalysis(stream) {
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const src = ctx.createMediaStreamSource(stream)
    const an  = ctx.createAnalyser()
    an.fftSize = 64
    src.connect(an)
    analyserRef.current = an
    const d = new Uint8Array(an.frequencyBinCount)
    function tick() {
      an.getByteFrequencyData(d)
      const avg = d.reduce((s, v) => s + v, 0) / d.length / 255
      setAudioLevel(avg)
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }

  function stopAnalysis() {
    cancelAnimationFrame(rafRef.current)
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
      audioCtxRef.current = null
    }
    setAudioLevel(0)
  }

  // ── INTERNAL: start one recognition session ───────────────────────────────
  // Called by startListening and also by the auto-restart logic.
  const startRecognition = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR || !activeRef.current) return

    // Stop any previous instance cleanly
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
      recognitionRef.current = null
    }

    const rec = new SR()
    rec.continuous     = false  // single utterance — we restart manually
    rec.interimResults = true
    rec.lang           = 'en-US'
    rec.maxAlternatives = 1
    recognitionRef.current = rec

    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          accumulatedRef.current += t + ' '
          restartCountRef.current = 0 // got real speech — reset restart counter
        } else {
          interim += t
        }
      }
      // Show live feedback
      onTranscript?.({
        text:    accumulatedRef.current.trim(),
        isFinal: false,
        interim: interim || accumulatedRef.current.trim(),
      })
    }

    rec.onend = () => {
      // Only handle end if we're still supposed to be listening
      if (!activeRef.current) return

      // If no-speech or abrupt end — restart silently (user hasn't tapped stop)
      setTimeout(() => {
        if (activeRef.current) {
          restartCountRef.current++
          if (restartCountRef.current <= MAX_RESTARTS) {
            startRecognition()
          } else {
            // Gave up after MAX_RESTARTS silent attempts — send what we have
            activeRef.current = false
            setListening(false)
            stopAnalysis()
            if (accumulatedRef.current.trim()) {
              onTranscript?.({ text: accumulatedRef.current.trim(), isFinal: true, interim: '' })
            }
            accumulatedRef.current = ''
            restartCountRef.current = 0
          }
        }
      }, RESTART_DELAY)
    }

    rec.onerror = (e) => {
      console.warn('[voice] error:', e.error)

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // Hard permission error — stop everything
        activeRef.current = false
        setListening(false)
        stopAnalysis()
        accumulatedRef.current = ''
        restartCountRef.current = 0
        onError?.('not-allowed')
        return
      }

      if (e.error === 'no-speech' || e.error === 'audio-capture' || e.error === 'network') {
        // Transient error — onend will fire and auto-restart handles it
        // Just suppress these from showing to the user — they're expected
        return
      }

      // Other errors — show to user but still attempt restart via onend
      onError?.(e.error)
    }

    try {
      rec.start()
    } catch (err) {
      console.warn('[voice] rec.start() threw:', err.message)
      // InvalidStateError usually means a previous instance is still running
      // onend will fire and restart
    }
  }, [onTranscript, onError])

  // ── START LISTENING ───────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!enabled) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    if (activeRef.current) return // already listening

    activeRef.current       = true
    accumulatedRef.current  = ''
    restartCountRef.current = 0
    setListening(true)

    // Start level analysis for orb animation
    // Use a separate getUserMedia just for the analyser — don't race with SR
    navigator.mediaDevices?.getUserMedia({ audio: true, video: false })
      .then(stream => startAnalysis(stream))
      .catch(() => {}) // non-fatal — orb just won't animate

    // Small delay gives the mic hardware time to initialise
    // before Web Speech API tries to read from it
    setTimeout(() => startRecognition(), 150)
  }, [enabled, startRecognition])

  // ── STOP LISTENING ────────────────────────────────────────────────────────
  // Called when user taps the mic button to stop.
  // Sends whatever was accumulated so far.
  const stopListening = useCallback(() => {
    activeRef.current = false
    setListening(false)
    stopAnalysis()

    try { recognitionRef.current?.stop() } catch {}
    recognitionRef.current = null

    // Send accumulated text immediately (don't wait for onend)
    const text = accumulatedRef.current.trim()
    if (text) {
      onTranscript?.({ text, isFinal: true, interim: '' })
    }
    accumulatedRef.current  = ''
    restartCountRef.current = 0
  }, [onTranscript])

  // ── VOICE OUTPUT (ElevenLabs via backend) ─────────────────────────────────
  const speak = useCallback(async (text) => {
    if (!enabled || !text?.trim()) return

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    setSpeaking(true)

    try {
      // Retry getSession up to 3 times — token may not be ready immediately after stream
      let session = await getSession()
      if (!session?.access_token) {
        await new Promise(r => setTimeout(r, 500))
        session = await getSession()
      }
      if (!session?.access_token) {
        await new Promise(r => setTimeout(r, 1000))
        session = await getSession()
      }
      const BASE = (import.meta.env.VITE_API_URL || '/api')

      const res = await fetch(`${BASE}/chat/speak`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ text: text.slice(0, 500) }),
      })

      if (!res.ok) throw new Error('TTS failed')

      const blob  = await res.blob()
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      audio.addEventListener('timeupdate', () => {
        setAudioLevel(0.3 + Math.abs(Math.sin(audio.currentTime * 8)) * 0.4)
      })
      audio.addEventListener('ended', () => {
        setSpeaking(false)
        setAudioLevel(0)
        URL.revokeObjectURL(url)
        audioRef.current = null
      })
      audio.addEventListener('error', () => {
        setSpeaking(false)
        setAudioLevel(0)
        audioRef.current = null
      })

      await audio.play()
    } catch (err) {
      setSpeaking(false)
      setAudioLevel(0)
      onError?.('TTS failed — check ELEVENLABS_API_KEY is set in Railway')
    }
  }, [enabled])

  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setSpeaking(false)
    setAudioLevel(0)
  }, [])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false
      try { recognitionRef.current?.abort() } catch {}
      stopAnalysis()
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    }
  }, [])

  return {
    listening, speaking, audioLevel, supported,
    startListening, stopListening, speak, stopSpeaking,
  }
}