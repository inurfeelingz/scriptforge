// frontend/src/components/editor/IndexingPanel.jsx
// Server-side footage upload + indexer.
// User drops/selects video files → POST /api/editor/clips/upload per file
// → backend runs ffmpeg + Whisper + OpenAI embed → stored in clip_index.
// Includes storage management: per-clip delete, wipe all, storage meter.

import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, X, CheckCircle, AlertCircle, Loader2, HardDrive, Film } from 'lucide-react'
import { api } from '../../lib/api'
import { getSession } from '../../lib/supabase'
import { useStore } from '../../store'

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtDur(ms) {
  if (!ms) return '0s'
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export default function IndexingPanel({ onClose, onIndexed, categoryId }) {
  const { notify } = useStore()
  const [storage,        setStorage]      = useState(null)
  const [storageLoading, setStorageLoading] = useState(true)
  const [uploads,        setUploads]      = useState([])   // { id, file, status, error, result }
  const [dragging,       setDragging]     = useState(false)
  const [deleting,       setDeleting]     = useState(null)
  const [wipingAll,      setWipingAll]    = useState(false)
  const [confirmWipe,    setConfirmWipe]  = useState(false)
  const fileInputRef = useRef(null)
  const activeUploads = useRef(0)

  useEffect(() => { loadStorage() }, [])

  async function loadStorage() {
    setStorageLoading(true)
    try {
      const data = await api.get('/editor/clips/storage')
      setStorage(data)
    } catch {}
    setStorageLoading(false)
  }

  async function uploadFile(file) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setUploads(prev => [...prev, { id, file, status: 'uploading', progress: 0, error: null, result: null }])

    try {
      const session  = await getSession()
      const formData = new FormData()
      formData.append('clip', file, file.name)
      if (categoryId) formData.append('categoryId', categoryId)

      const BASE = (import.meta.env.VITE_API_URL || '/api')
      const res = await fetch(`${BASE}/editor/clips/upload`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body:    formData,
      })

      const text = await res.text()
      const data = JSON.parse(text.trim())

      if (data.error) throw new Error(data.error)

      setUploads(prev => prev.map(u => u.id === id
        ? { ...u, status: 'done', result: data.clip }
        : u
      ))

      onIndexed?.(data.clip)
      await loadStorage()

    } catch (err) {
      setUploads(prev => prev.map(u => u.id === id
        ? { ...u, status: 'error', error: err.message }
        : u
      ))
    }
  }

  async function handleFiles(files) {
    const videoFiles = Array.from(files).filter(f =>
      f.type.startsWith('video/') || f.type.startsWith('audio/') ||
      /\.(mp4|mov|avi|mkv|webm|m4v|mxf|r3d|braw|mp3|wav|m4a|aac)$/i.test(f.name)
    )
    if (!videoFiles.length) {
      notify('Please select video or audio files', 'error')
      return
    }
    // Upload concurrently, max 2 at a time
    const queue = [...videoFiles]
    async function next() {
      if (!queue.length) return
      const file = queue.shift()
      activeUploads.current++
      await uploadFile(file)
      activeUploads.current--
      await next()
    }
    await Promise.all([next(), next()])
  }

  async function deleteClip(clipId) {
    setDeleting(clipId)
    try {
      await api.delete(`/editor/clips/${clipId}`)
      setStorage(prev => prev ? {
        ...prev,
        clips:      prev.clips.filter(c => c.id !== clipId),
        count:      prev.count - 1,
        totalBytes: prev.clips.filter(c => c.id !== clipId).reduce((s, c) => s + (c.fileSize || 0), 0),
      } : null)
      notify('Clip removed', 'success')
    } catch (err) {
      notify('Delete failed: ' + err.message, 'error')
    }
    setDeleting(null)
  }

  async function wipeAll() {
    if (!confirmWipe) { setConfirmWipe(true); return }
    setWipingAll(true)
    setConfirmWipe(false)
    try {
      await api.delete('/editor/clips/all')
      setStorage(prev => prev ? { ...prev, clips: [], count: 0, totalBytes: 0, totalDurationMs: 0 } : null)
      setUploads([])
      notify('All clips removed', 'success')
    } catch (err) {
      notify('Wipe failed: ' + err.message, 'error')
    }
    setWipingAll(false)
  }

  const uploading     = uploads.filter(u => u.status === 'uploading')
  const done          = uploads.filter(u => u.status === 'done')
  const failed        = uploads.filter(u => u.status === 'error')
  const storedClips   = storage?.clips || []
  const LIMIT_BYTES   = 10 * 1024 * 1024 * 1024  // 10GB soft limit display
  const usedPct       = storage ? Math.min(100, Math.round((storage.totalBytes / LIMIT_BYTES) * 100)) : 0

  return (
    <div className="border border-[#1a1a1a] rounded overflow-hidden bg-[#090909]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-[#0a0a0a] border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2">
          <Upload size={14} className="text-[#c8b89a]"/>
          <span className="text-sm text-[#888]">Footage indexer</span>
          {uploading.length > 0 && (
            <span className="text-xs text-[#c8b89a] flex items-center gap-1">
              <Loader2 size={10} className="animate-spin"/>
              {uploading.length} uploading…
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-[#444] hover:text-[#888] transition-colors">
          <X size={14}/>
        </button>
      </div>

      <div className="p-5 space-y-5">

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
            dragging
              ? 'border-[#c8b89a]/60 bg-[#c8b89a]/05'
              : 'border-[#1e1e1e] hover:border-[#333] hover:bg-[#0d0d0d]'
          }`}
        >
          <Film size={28} className="mx-auto mb-3 text-[#333]"/>
          <div className="text-sm text-[#666]">Drop footage here or click to select</div>
          <div className="text-xs text-[#444] mt-1">MP4, MOV, MKV, WebM, AVI, R3D, BRAW + audio files</div>
          <div className="text-xs text-[#333] mt-2">Each clip is transcribed with Whisper and embedded for AI assembly</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,.r3d,.braw,.mxf"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        {/* Upload progress */}
        {uploads.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-[#555] uppercase tracking-wide">This session</div>
            {uploads.map(u => (
              <div key={u.id} className="flex items-center gap-3 text-xs">
                {u.status === 'uploading' && <Loader2 size={11} className="animate-spin text-[#c8b89a] shrink-0"/>}
                {u.status === 'done'      && <CheckCircle size={11} className="text-[#40a060] shrink-0"/>}
                {u.status === 'error'     && <AlertCircle size={11} className="text-red-400 shrink-0"/>}
                <span className={`flex-1 truncate ${u.status === 'error' ? 'text-red-400' : 'text-[#888]'}`}>
                  {u.file.name}
                </span>
                {u.status === 'uploading' && <span className="text-[#444] shrink-0">Processing…</span>}
                {u.status === 'done'      && u.result?.duration_ms && (
                  <span className="text-[#444] shrink-0">{fmtDur(u.result.duration_ms)}</span>
                )}
                {u.status === 'error'     && <span className="text-red-400 truncate max-w-[120px]">{u.error}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Storage meter + indexed clips */}
        {!storageLoading && storage && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-[#555]">
                <HardDrive size={11}/>
                <span>{fmtBytes(storage.totalBytes)} indexed · {storage.count} clips · {fmtDur(storage.totalDurationMs)}</span>
              </div>
              <div className="flex items-center gap-2">
                {confirmWipe && (
                  <span className="text-xs text-red-400">Are you sure?</span>
                )}
                {storage.count > 0 && (
                  <button
                    onClick={wipeAll}
                    disabled={wipingAll}
                    className="text-xs text-[#444] hover:text-red-400 transition-colors flex items-center gap-1"
                  >
                    {wipingAll ? <Loader2 size={10} className="animate-spin"/> : <Trash2 size={10}/>}
                    {confirmWipe ? 'Yes, wipe all' : 'Wipe all'}
                  </button>
                )}
                {confirmWipe && (
                  <button onClick={() => setConfirmWipe(false)} className="text-xs text-[#444] hover:text-[#888]">
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Storage bar */}
            <div className="h-1.5 bg-[#111] rounded overflow-hidden">
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${usedPct}%`,
                  background: usedPct > 80 ? '#e05550' : usedPct > 60 ? '#c8a030' : '#c8b89a',
                }}
              />
            </div>

            {/* Clip list */}
            {storedClips.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {storedClips.map(clip => (
                  <div key={clip.id} className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[#0d0d0d] transition-colors group">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                      clip.clipType === 'daw'   ? 'border border-[#4080c8]/30 text-[#4080c8]' :
                      clip.clipType === 'broll' ? 'border border-[#40a060]/30 text-[#40a060]' :
                      'border border-[#c8b89a]/30 text-[#c8b89a]'
                    }`}>{(clip.clipType || 'cam').toUpperCase()}</span>
                    <span className="text-xs text-[#666] flex-1 truncate">{clip.filename}</span>
                    {clip.durationMs && <span className="text-[10px] text-[#444] shrink-0">{fmtDur(clip.durationMs)}</span>}
                    {clip.fileSize   && <span className="text-[10px] text-[#333] shrink-0">{fmtBytes(clip.fileSize)}</span>}
                    <button
                      onClick={() => deleteClip(clip.id)}
                      disabled={deleting === clip.id}
                      className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-red-400 transition-all shrink-0"
                    >
                      {deleting === clip.id
                        ? <Loader2 size={11} className="animate-spin"/>
                        : <Trash2 size={11}/>
                      }
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {storageLoading && (
          <div className="flex items-center gap-2 text-xs text-[#444]">
            <Loader2 size={11} className="animate-spin"/>
            Loading storage…
          </div>
        )}

        {/* Info — clear about what indexing does and doesn't do */}
        <div className="text-xs border border-[#1a1a1a] rounded p-4 space-y-2 leading-relaxed bg-[#0a0a0a]">
          <div className="text-[#666] font-medium">Important — read before uploading</div>
          <div className="text-[#444]">Indexing <strong className="text-[#555]">does not store your video files</strong>. WhispaCuts extracts metadata, a thumbnail, and a transcript — then discards the upload. Your actual footage stays on your computer.</div>
          <div className="text-[#444]">When you export your edit as an EDL or FCPXML, you'll import it into <strong className="text-[#555]">DaVinci Resolve</strong> (free) on your computer — it will relink to your footage files and render the final video.</div>
          <div className="text-[#333] mt-1">Keep your footage in the same folder so DaVinci can find it when you import.</div>
        </div>

      </div>
    </div>
  )
}
