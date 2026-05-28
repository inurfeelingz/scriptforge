// frontend/src/hooks/useKBVoice.js
// KB voice system:
//   - Speech input: Web Speech API (free, browser native)
//   - Speech output: ElevenLabs TTS via backend proxy (uses existing ElevenLabs key)
//
// Usage:
//   const { listening, speaking, audioLevel, startListening, stopListening, speak, stopSpeaking } = useKBVoice({ onTranscript })

import { useState, useRef, useCallback, useEffect } from 'react'
import { getSession } from '../lib/supabase'

export default function useKBVoice({ onTranscript, onError, enabled = true }) {
  const [listening,   setListening]   = useState(false)
  const [speaking,    setSpeaking]    = useState(false)
  const [audioLevel,  setAudioLevel]  = useState(0)
  const [supported,   setSupported]   = useState(false)

  const recognitionRef = useRef(null)
  const audioRef       = useRef(null)
  const analyserRef    = useRef(null)
  const audioCtxRef    = useRef(null)
  const rafRef         = useRef(null)

  // Check browser support on mount
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setSupported(!!SpeechRecognition)
  }, [])

  // ── AUDIO LEVEL ANALYSIS (for orb animation while speaking) ──────────────────
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
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {}; audioCtxRef.current = null }
    setAudioLevel(0)
  }

  // ── VOICE INPUT ───────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (!enabled) return
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const rec = new SpeechRecognition()
    rec.continuous      = true   // keep listening until user stops manually
    rec.interimResults  = true   // show words appearing as feedback only
    rec.lang            = 'en-US'
    recognitionRef.current = rec

    let accumulated = ''
    rec.onresult = (e) => {
      let interim = ''
      // Accumulate all final results so far
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          accumulated += e.results[i][0].transcript + ' '
        } else {
          interim += e.results[i][0].transcript
        }
      }
      // Show live feedback — don't send yet, wait for user to stop
      onTranscript?.({ text: accumulated.trim(), isFinal: false, interim: interim || accumulated.trim() })
    }
    // When recognition ends (user tapped stop), send the full accumulated text
    rec.onend = () => {
      setListening(false)
      stopAnalysis()
      if (accumulated.trim()) {
        onTranscript?.({ text: accumulated.trim(), isFinal: true, interim: '' })
      }
      accumulated = ''
    }

    rec.onerror = (e) => {
      console.warn('[voice] error:', e.error)
      setListening(false)
      stopAnalysis()
      onError?.(e.error)
    }

    navigator.mediaDevices?.getUserMedia({ audio: true }).then(stream => {
      startAnalysis(stream)
    }).catch(() => {})

    rec.start()
    setListening(true)
  }, [enabled, onTranscript])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()  // triggers onend which handles final send
    setListening(false)
    stopAnalysis()
  }, [])

  // ── VOICE OUTPUT (ElevenLabs via backend) ─────────────────────────────────────
  const speak = useCallback(async (text) => {
    if (!enabled || !text?.trim()) return

    // Stop any current speech
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    setSpeaking(true)

    try {
      const session = await getSession()
      const BASE    = (import.meta.env.VITE_API_URL || '/api')

      const res = await fetch(`${BASE}/chat/speak`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ text: text.slice(0, 500) }), // cap at 500 chars per TTS call
      })

      if (!res.ok) throw new Error('TTS failed')

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      // Animate orb while speaking — use audio's volume as proxy
      audio.addEventListener('timeupdate', () => {
        // Pulse orb with a sin wave while audio plays
        const progress = audio.currentTime / (audio.duration || 1)
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
      stopListening()
      stopSpeaking()
    }
  }, [])

  return { listening, speaking, audioLevel, supported, startListening, stopListening, speak, stopSpeaking }
}