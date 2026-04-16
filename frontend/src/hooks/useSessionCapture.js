// frontend/src/hooks/useSessionCapture.js
// Manages microphone access, audio chunking, and session state for the companion app.
// Handles offline queuing and reconnection sync.

import { useState, useRef, useCallback, useEffect } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { supabase, getSession } from '../lib/supabase'

const CHUNK_INTERVAL_MS = 10000  // transcribe every 10s
const MAX_OFFLINE_QUEUE = 50     // max entries to queue offline

export function useSessionCapture() {
  const { activeCategoryId, notify } = useStore()

  const [sessionId,     setSessionId]     = useState(null)
  const [recording,     setRecording]     = useState(false)
  const [elapsedMs,     setElapsedMs]     = useState(0)
  const [entries,       setEntries]       = useState([])
  const [status,        setStatus]        = useState('idle')  // idle | recording | processing | ready | error
  const [micAvailable,  setMicAvailable]  = useState(null)    // null = unknown

  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const sessionStartRef   = useRef(null)
  const timerRef          = useRef(null)
  const chunkTimerRef     = useRef(null)
  const offlineQueueRef   = useRef([])
  const sessionIdRef      = useRef(null)  // stable ref for interval callbacks

  // Keep ref in sync
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  // Check mic availability on mount
  useEffect(() => {
    navigator.permissions?.query({ name: 'microphone' })
      .then(result => setMicAvailable(result.state !== 'denied'))
      .catch(() => setMicAvailable(true))  // assume available if API missing
  }, [])

  // Flush offline queue when back online — refresh auth token first
  useEffect(() => {
    async function handleOnline() {
      if (!offlineQueueRef.current.length || !sessionIdRef.current) return
      try {
        await supabase.auth.refreshSession()
      } catch { /* proceed anyway — offline may have expired token */ }
      flushOfflineQueue(sessionIdRef.current)
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  // ── Start recording ────────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      })
      setMicAvailable(true)

      // Create session
      const { session } = await api.post('/session', { categoryId: activeCategoryId })
      setSessionId(session.id)
      sessionIdRef.current = session.id

      // MediaRecorder setup
      const mimeType  = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder  = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current   = []
      sessionStartRef.current  = Date.now()

      recorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.start(1000)

      setRecording(true)
      setStatus('recording')
      setEntries([])
      setElapsedMs(0)

      // Elapsed clock
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - (sessionStartRef.current || Date.now()))
      }, 1000)

      // Periodic transcription
      chunkTimerRef.current = setInterval(() => {
        transcribeChunk(sessionIdRef.current)
      }, CHUNK_INTERVAL_MS)

    } catch (err) {
      setMicAvailable(false)
      setStatus('error')
      notify(err.name === 'NotAllowedError'
        ? 'Microphone permission denied — enable in browser settings'
        : 'Could not access microphone: ' + err.message,
        'error'
      )
    }
  }, [activeCategoryId])

  // ── Stop recording ─────────────────────────────────────────────────────────

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current) return

    mediaRecorderRef.current.stop()
    mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
    clearInterval(timerRef.current)
    clearInterval(chunkTimerRef.current)

    setRecording(false)
    setStatus('processing')

    // Final chunk
    await transcribeChunk(sessionIdRef.current)
    setStatus('ready')
  }, [])

  // ── Mark moment ────────────────────────────────────────────────────────────

  const markMoment = useCallback(async (label = 'MARKED MOMENT') => {
    const timestampMs = sessionStartRef.current
      ? Date.now() - sessionStartRef.current
      : 0

    const entry = {
      id:           `mark-${Date.now()}`,
      timestamp_ms: timestampMs,
      type:         'marker',
      text:         label,
      energy:       1.0,
    }

    setEntries(prev => [...prev, entry])
    navigator.vibrate?.(80)

    if (sessionIdRef.current) {
      if (navigator.onLine) {
        await api.post(`/session/${sessionIdRef.current}/entry`, {
          text: label, type: 'marker', timestampMs, energy: 1.0,
        }).catch(err => {
          offlineQueueRef.current.push(entry)
        })
      } else {
        offlineQueueRef.current.push(entry)
      }
    }
  }, [])

  // ── Add voice note ─────────────────────────────────────────────────────────

  const addNote = useCallback(async (text) => {
    const timestampMs = sessionStartRef.current
      ? Date.now() - sessionStartRef.current
      : 0

    const entry = {
      id:           `note-${Date.now()}`,
      timestamp_ms: timestampMs,
      type:         'note',
      text,
      energy:       0.5,
    }

    setEntries(prev => [...prev, entry])

    if (sessionIdRef.current && navigator.onLine) {
      await api.post(`/session/${sessionIdRef.current}/entry`, {
        text, type: 'note', timestampMs, energy: 0.5,
      }).catch(console.warn)
    }
  }, [])

  // ── Process session ────────────────────────────────────────────────────────

  const processSession = useCallback(async () => {
    if (!sessionIdRef.current) return null
    setStatus('processing')

    try {
      const result = await api.post(`/session/${sessionIdRef.current}/process`)
      setStatus('ready')
      return result
    } catch (err) {
      setStatus('ready')
      notify('Processing failed: ' + err.message, 'error')
      return null
    }
  }, [])

  // ── Transcribe chunk ───────────────────────────────────────────────────────

  async function transcribeChunk(sid) {
    const chunks = audioChunksRef.current.splice(0)
    if (!chunks.length || !sid) return

    const blob = new Blob(chunks, { type: 'audio/webm' })
    const timestampMs = Date.now() - (sessionStartRef.current || Date.now())

    try {
      const formData = new FormData()
      formData.append('audio', blob, 'chunk.webm')
      formData.append('timestampMs', String(timestampMs))

      const session = await getSession()
      const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/session/${sid}/transcribe`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body:    formData,
      })

      if (res.ok) {
        const { entries: newEntries } = await res.json()
        if (newEntries?.length) {
          setEntries(prev => [...prev, ...newEntries])
        }
      }
    } catch {
      // Silent fail — offline or server down
    }
  }

  // ── Flush offline queue ────────────────────────────────────────────────────

  async function flushOfflineQueue(sid) {
    const queue = offlineQueueRef.current.splice(0)
    if (!queue.length) return
    await api.post(`/session/${sid}/entries/batch`, { entries: queue }).catch(console.warn)
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  const reset = useCallback(() => {
    setSessionId(null)
    setRecording(false)
    setEntries([])
    setElapsedMs(0)
    setStatus('idle')
    audioChunksRef.current   = []
    offlineQueueRef.current  = []
  }, [])

  return {
    sessionId,
    recording,
    elapsedMs,
    entries,
    status,
    micAvailable,
    startRecording,
    stopRecording,
    markMoment,
    addNote,
    processSession,
    reset,
    markerCount: entries.filter(e => e.type === 'marker').length,
    speechCount: entries.filter(e => e.type !== 'marker').length,
  }
}
