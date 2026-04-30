// frontend/src/pages/ScriptLibraryPage.jsx
// Upload past scripts to train the voice/language bible.
// Scripts are stored as vault entries of type 'script' and fed into
// the context assembler for future episode generation.

import { useState, useEffect, useRef } from 'react'
import { Upload, FileText, Trash2, CheckCircle, AlertCircle } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'

export default function ScriptLibraryPage() {
  const { activeCategoryId } = useStore()
  const [scripts, setScripts]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [toast, setToast]       = useState(null)
  const fileRef = useRef()

  useEffect(() => {
    if (!activeCategoryId) { setLoading(false); return }
    setLoading(true)
    api.get(`/vault?categoryId=${activeCategoryId}&type=script&limit=100`)
      .then(({ entries }) => setScripts(entries || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeCategoryId])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function processFiles(files) {
    if (!activeCategoryId) { showToast('Select a workspace first', 'error'); return }
    const textFiles = Array.from(files).filter(f =>
      f.type === 'text/plain' || f.name.endsWith('.txt') ||
      f.name.endsWith('.md')  || f.name.endsWith('.fdx') ||
      f.name.endsWith('.fountain')
    )
    if (!textFiles.length) { showToast('Upload .txt, .md, or .fountain files', 'error'); return }

    setUploading(true)
    let added = 0
    for (const file of textFiles) {
      const text = await file.text()
      if (!text.trim()) continue
      await api.post('/vault', {
        categoryId: activeCategoryId,
        type:       'script',
        title:      file.name.replace(/\.[^.]+$/, ''),
        content:    text,
        tags:       ['uploaded-script'],
      }).catch(() => {})
      added++
    }
    // Refresh list
    const { entries } = await api.get(`/vault?categoryId=${activeCategoryId}&type=script&limit=100`).catch(() => ({ entries: [] }))
    setScripts(entries || [])
    setUploading(false)
    showToast(`${added} script${added !== 1 ? 's' : ''} added to your library`)
  }

  async function handleDelete(id) {
    await api.delete(`/vault/${id}`).catch(() => {})
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '1.75rem', color: 'var(--text)' }}>
          Script library
        </h1>
        <p style={{ fontSize: '0.9375rem', color: 'var(--text3)', marginTop: 4 }}>
          Upload past scripts to train your voice and language bible. Claude reads these when generating new episodes.
        </p>
      </div>

      {!activeCategoryId ? (
        <div style={{ border: '1px dashed var(--border2)', borderRadius: 'var(--r)', padding: '2rem', textAlign: 'center', color: 'var(--text3)' }}>
          Select a workspace first
        </div>
      ) : (
        <>
          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files) }}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border2)'}`,
              borderRadius: 'var(--r)', padding: '2.5rem 2rem', textAlign: 'center',
              cursor: 'pointer', transition: 'all 0.15s',
              background: dragOver ? 'var(--accent-lo)' : 'transparent',
            }}
          >
            <input ref={fileRef} type="file" accept=".txt,.md,.fountain,.fdx" multiple style={{ display: 'none' }}
              onChange={e => processFiles(e.target.files)}/>
            <Upload size={28} style={{ color: 'var(--text3)', margin: '0 auto 12px' }}/>
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
              {uploading ? 'Uploading...' : 'Drop scripts here or click to browse'}
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--text3)' }}>
              .txt, .md, .fountain — each file becomes a reference for Claude
            </div>
          </div>

          {/* Toast */}
          {toast && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 'var(--r-sm)', background: toast.type === 'error' ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)', border: `1px solid ${toast.type === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(74,222,128,0.3)'}`, color: toast.type === 'error' ? '#f87171' : '#4ade80' }}>
              {toast.type === 'error' ? <AlertCircle size={14}/> : <CheckCircle size={14}/>}
              {toast.msg}
            </div>
          )}

          {/* Script list */}
          {loading ? (
            <div style={{ color: 'var(--text3)', textAlign: 'center', padding: '2rem' }}>Loading...</div>
          ) : scripts.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
              No scripts uploaded yet — add your first one above
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                {scripts.length} script{scripts.length !== 1 ? 's' : ''} in library
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {scripts.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--surface)' }}>
                    <FileText size={14} style={{ color: 'var(--accent)', flexShrink: 0 }}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500, color: 'var(--text)', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 2 }}>
                        {Math.round(s.content?.length / 5)} words · {new Date(s.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button onClick={() => handleDelete(s.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4, flexShrink: 0 }}>
                      <Trash2 size={13}/>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
