// frontend/src/hooks/useClipIndexer.js
// Manages the clip indexer Web Worker from React.
// Handles worker lifecycle, progress streaming, and API sync.

import { useRef, useState, useCallback, useEffect } from 'react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { getSession } from '../lib/supabase'

export function useClipIndexer() {
  const { activeCategoryId, notify } = useStore()
  const workerRef    = useRef(null)
  const pendingBatch = useRef([])   // clips indexed but not yet sent to API

  const [modelsReady,   setModelsReady]   = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelProgress, setModelProgress] = useState({ model: '', pct: 0 })
  const [indexing,      setIndexing]      = useState(false)
  const [indexProgress, setIndexProgress] = useState({ current: 0, total: 0, pct: 0, filename: '', step: '' })
  const [stats,         setStats]         = useState(null)
  const [error,         setError]         = useState(null)

  // ── Init worker — only when explicitly started ────────────────────────────

  function initWorker() {
    if (workerRef.current) return  // already running
    try {
      workerRef.current = new Worker(
        new URL('../workers/clipIndexer.worker.js', import.meta.url),
        { type: 'module' }
      )
      workerRef.current.onmessage  = handleWorkerMessage
      workerRef.current.onerror    = (e) => {
        console.error('[useClipIndexer] Worker error:', e)
        setError('Worker failed to load. Check browser console.')
      }
    } catch (err) {
      console.error('[useClipIndexer] Failed to create worker:', err)
      setError('Worker not supported in this browser. Use Chrome.')
    }
  }

  useEffect(() => {
    // Don't auto-start — worker starts when user explicitly indexes footage    return () => workerRef.current?.terminate()
  }, [])

  // ── Worker message handler ─────────────────────────────────────────────────

  const handleWorkerMessage = useCallback(async ({ data }) => {
    switch (data.type) {
      case 'MODEL_LOADING':
        setModelsLoading(true)
        setModelProgress({ model: data.payload.model, pct: data.payload.pct })
        break

      case 'MODEL_READY':
        setModelsLoading(false)
        setModelsReady(true)
        break

      case 'PROGRESS':
        setIndexProgress({
          filename: data.payload.filename || '',
          step:     data.payload.step     || '',
          current:  data.payload.current  || 0,
          total:    data.payload.total    || 0,
          pct:      data.payload.pct      || 0,
        })
        break

      case 'CLIP_INDEXED':
        // Send to backend to save vectors in Supabase pgvector
        try {
          await api.post('/editor/index/clip', {
            categoryId: activeCategoryId,
            clipData:   data.payload,
          })
        } catch (err) {
          console.error('[useClipIndexer] Failed to save clip:', err.message)
        }
        break

      case 'BATCH_DONE':
        setIndexing(false)
        await loadStats()
        notify(
          `Indexed ${data.payload.success.length} clips` +
          (data.payload.failed.length ? ` (${data.payload.failed.length} failed)` : ''),
          data.payload.failed.length ? 'info' : 'success'
        )
        break

      case 'SEARCH_RESULT':
        // Dispatch on window so callers in React components can await it
        window.dispatchEvent(new CustomEvent('clipSearchResult', { detail: data.payload }))
        break

      case 'ERROR':
        setError(data.payload.error)
        if (!data.payload.filename?.includes('model')) {
          // Don't show individual clip errors — they're logged but not fatal
          console.warn('[useClipIndexer] Clip error:', data.payload)
        } else {
          notify('Model load error: ' + data.payload.error, 'error')
          setModelsLoading(false)
        }
        break
    }
  }, [activeCategoryId])

  // Rebind message handler when category changes
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.onmessage = handleWorkerMessage
    }
  }, [handleWorkerMessage])

  // ── File System Access API ─────────────────────────────────────────────────

  const pickFolder = useCallback(async () => {
    // Check API availability — Chrome/Edge only
    if (!('showDirectoryPicker' in window)) {
      notify('File System Access API requires Chrome or Edge', 'error')
      return []
    }

    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' })
      const files     = []
      const videoExts = /\.(mp4|mov|mkv|avi|mxf|webm)$/i

      // Recursively collect video files
      async function collectFiles(handle, prefix = '') {
        for await (const entry of handle.values()) {
          if (entry.kind === 'file' && videoExts.test(entry.name)) {
            const file = await entry.getFile()
            // Attach relative path for the indexer
            Object.defineProperty(file, 'relativePath', {
              value: prefix ? `${prefix}/${entry.name}` : entry.name,
              writable: false,
            })
            files.push(file)
          } else if (entry.kind === 'directory') {
            await collectFiles(entry, prefix ? `${prefix}/${entry.name}` : entry.name)
          }
        }
      }

      await collectFiles(dirHandle)

      if (!files.length) {
        notify('No video files found in that folder', 'info')
      }

      return files
    } catch (err) {
      if (err.name !== 'AbortError') {
        notify('Could not access folder: ' + err.message, 'error')
      }
      return []
    }
  }, [])

  // ── Index batch ────────────────────────────────────────────────────────────

  const indexBatch = useCallback(async (files) => {
    if (!files.length) return
    if (!workerRef.current) {
      notify('Worker not available — use Chrome or Edge', 'error')
      return
    }

    setIndexing(true)
    setError(null)
    setIndexProgress({ current: 0, total: files.length, pct: 0, filename: '', step: 'starting' })

    // Create a job record in DB
    try {
      const { job } = await api.post('/editor/index/job', {
        categoryId: activeCategoryId,
        totalClips: files.length,
      })
      workerRef.current.postMessage({
        type:    'INDEX_BATCH',
        payload: { files, categoryId: activeCategoryId, jobId: job?.id },
      })
    } catch (err) {
      notify('Could not start indexing job: ' + err.message, 'error')
      setIndexing(false)
    }
  }, [activeCategoryId])

  // ── Semantic search (returns promise) ─────────────────────────────────────

  const computeSearchVectors = useCallback((query) => {
    return new Promise((resolve, reject) => {
      if (!workerRef.current) return reject(new Error('Worker not available'))

      const timeout = setTimeout(() => reject(new Error('Search timeout')), 10000)

      // Listen for the result via the custom event
      const handler = (e) => {
        if (e.detail.query === query) {
          clearTimeout(timeout)
          window.removeEventListener('clipSearchResult', handler)
          resolve(e.detail)
        }
      }
      window.addEventListener('clipSearchResult', handler)

      workerRef.current.postMessage({ type: 'SEARCH', payload: { query } })
    })
  }, [])

  // ── Load stats from API ────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    if (!activeCategoryId) return
    try {
      const { stats: s } = await api.get(`/editor/index/status?categoryId=${activeCategoryId}`)
      setStats(s)
    } catch {}
  }, [activeCategoryId])

  useEffect(() => { loadStats() }, [activeCategoryId])

  // ── Init models ────────────────────────────────────────────────────────────

  const initModels = useCallback(async () => {
    if (modelsReady || modelsLoading) return
    initWorker()  // lazy-start the worker only when user triggers model load
    setModelsLoading(true)
    const session = await getSession()
    const apiUrl  = import.meta.env.VITE_API_URL || '/api'
    workerRef.current.postMessage({
      type: 'INIT',
      payload: {
        apiUrl,
        authToken: session?.access_token || '',
      }
    })
  }, [modelsReady, modelsLoading])

  // ── Cancel ─────────────────────────────────────────────────────────────────

  const cancel = useCallback(() => {
    workerRef.current?.postMessage({ type: 'CANCEL' })
    setIndexing(false)
    setIndexProgress(p => ({ ...p, step: 'cancelled' }))
  }, [])

  return {
    // State
    modelsReady,
    modelsLoading,
    modelProgress,
    indexing,
    indexProgress,
    stats,
    error,
    workerAvailable: !!workerRef.current,
    // Actions
    pickFolder,
    indexBatch,
    initModels,
    cancel,
    loadStats,
    computeSearchVectors,
  }
}