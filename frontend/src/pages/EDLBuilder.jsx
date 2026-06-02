// frontend/src/pages/EDLBuilder.jsx
import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { getSession } from '../lib/supabase'

const TYPE_META = {
  broll:    { label: 'B-roll',    color: 'rgba(99,179,237,0.8)',  hint: 'broll_walking.mp4' },
  reaction: { label: 'Reaction',  color: 'rgba(154,230,180,0.8)', hint: 'reaction_shocked.mp4' },
  meme:     { label: 'Meme/GIF',  color: 'rgba(246,173,85,0.8)',  hint: 'meme_noway.gif' },
  sfx:      { label: 'SFX',       color: 'rgba(183,148,246,0.8)', hint: 'sfx_rimshot.mp3' },
  music:    { label: 'Music',     color: 'rgba(236,72,153,0.8)',   hint: 'music_chill_bg.mp3' },
  title:    { label: 'Title',     color: 'rgba(255,255,255,0.5)', hint: 'title_intro.png' },
}

export default function EDLBuilder() {
  const { activeCategory } = useStore()
  const cat = activeCategory?.()

  const [sessions,     setSessions]     = useState([])
  const [assignments,  setAssignments]  = useState({})
  const [clipNames,    setClipNames]    = useState({})
  const [targetMins,   setTargetMins]   = useState(8)
  const [fps,          setFps]          = useState(24)
  const [instructions, setInstructions] = useState('')
  const [assets,       setAssets]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [building,     setBuilding]     = useState(false)
  const [uploading,    setUploading]    = useState(false)
  const [error,        setError]        = useState(null)
  const [done,         setDone]         = useState(null)
  const fileInputRef = useRef(null)

  const BASE = import.meta.env.VITE_API_URL || '/api'

  useEffect(() => {
    if (!cat?.id) return
    Promise.all([loadSessions(), loadAssets()])
  }, [cat?.id])

  async function loadSessions() {
    setLoading(true)
    try {
      const sess = await getSession()
      const res  = await fetch(`${BASE}/editor/sessions?categoryId=${cat.id}`, {
        headers: { Authorization: `Bearer ${sess?.access_token}` }
      })
      const data = await res.json()
      setSessions(data.sessions || [])
      const names = {}
      ;(data.sessions || []).forEach(s => { names[s.id] = s.title + '.mp4' })
      setClipNames(names)
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  async function loadAssets() {
    try {
      const sess = await getSession()
      const res  = await fetch(`${BASE}/editor/assets?categoryId=${cat.id}`, {
        headers: { Authorization: `Bearer ${sess?.access_token}` }
      })
      const data = await res.json()
      setAssets(data.assets || [])
    } catch {}
  }

  async function handleAssetUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    setError(null)
    try {
      const sess = await getSession()
      for (const file of files) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('categoryId', cat.id)
        const res  = await fetch(`${BASE}/editor/assets/upload`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${sess?.access_token}` },
          body: fd,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        setAssets(prev => [...prev, data.asset])
      }
    } catch (e) { setError(e.message) }
    setUploading(false)
    e.target.value = ''
  }

  async function deleteAsset(id) {
    try {
      const sess = await getSession()
      await fetch(`${BASE}/editor/assets/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${sess?.access_token}` }
      })
      setAssets(prev => prev.filter(a => a.id !== id))
    } catch (e) { setError(e.message) }
  }

  async function buildEDL() {
    const screenSession = sessions.find(s => assignments[s.id] === 'screen')
    const cameraSession = sessions.find(s => assignments[s.id] === 'camera')
    if (!screenSession) { setError('Assign at least one session as Screen'); return }

    setBuilding(true)
    setError(null)
    setDone(null)

    try {
      let offsetMs = 0
      if (cameraSession) {
        const sess    = await getSession()
        const syncRes = await fetch(`${BASE}/editor/sync-audio`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${sess?.access_token}`, 'Content-Type': 'application/json' },
          body:   JSON.stringify({ sessionIdA: screenSession.id, sessionIdB: cameraSession.id, categoryId: cat.id }),
        })
        const syncData = await syncRes.json()
        if (syncRes.ok) offsetMs = syncData.offsetMs || 0
      }

      const sess     = await getSession()
      const buildRes = await fetch(`${BASE}/editor/build-session-edl`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${sess?.access_token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          categoryId:    cat.id,
          sessionIdA:    screenSession.id,
          sessionIdB:    cameraSession?.id || null,
          offsetMs,
          clipNameA:     clipNames[screenSession.id] || 'SCREEN.mp4',
          clipNameB:     clipNames[cameraSession?.id] || 'CAMERA.mp4',
          targetMinutes: targetMins,
          fps,
          instructions,
        }),
      })

      if (!buildRes.ok) {
        const err = await buildRes.json()
        throw new Error(err.error || 'Build failed')
      }

      let summary = {}
      try { summary = JSON.parse(buildRes.headers.get('X-EDL-Summary') || '{}') } catch {}

      const blob     = await buildRes.blob()
      const url      = URL.createObjectURL(blob)
      const filename = summary.filename || 'edit.edl'
      const a        = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)

      setDone({ filename, ...summary })
    } catch (e) { setError(e.message) }

    setBuilding(false)
  }

  const canBuild     = Object.values(assignments).includes('screen')
  const assetsByType = assets.reduce((acc, a) => {
    acc[a.type] = acc[a.type] || []
    acc[a.type].push(a)
    return acc
  }, {})

  const S = {
    page:      { maxWidth: 600, margin: '32px auto', padding: '0 20px', fontFamily: "'Figtree', sans-serif" },
    h1:        { fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 4 },
    sub:       { fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 32 },
    section:   { marginBottom: 24 },
    label:     { fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 },
    card:      { padding: 14, borderRadius: 10, border: '1px solid var(--color-border-tertiary)', background: 'var(--color-background-secondary)', marginBottom: 10 },
    row:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
    pill:      (active) => ({ padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, background: active ? 'rgba(74,222,128,1)' : 'var(--color-background-tertiary)', color: active ? '#080808' : 'var(--color-text-secondary)' }),
    del:       { padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.2)', background: 'none', cursor: 'pointer', fontSize: 11, color: 'rgba(239,68,68,0.5)' },
    input:     { width: '100%', background: 'var(--color-background-secondary)', border: '1px solid var(--color-border-tertiary)', borderRadius: 8, padding: '8px 12px', color: 'var(--color-text-primary)', fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' },
    buildBtn:  (dis) => ({ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', cursor: dis ? 'not-allowed' : 'pointer', background: dis ? 'rgba(74,222,128,0.3)' : 'rgba(74,222,128,1)', color: '#080808', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }),
    spinner:   { width: 14, height: 14, border: '2px solid #080808', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' },
    uploadBtn: { padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border-tertiary)', background: 'none', cursor: uploading ? 'not-allowed' : 'pointer', fontSize: 13, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 6 },
    tag:       (color) => ({ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: color + '22', color, textTransform: 'uppercase', letterSpacing: 0.5 }),
    success:   { padding: '14px 16px', borderRadius: 8, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', marginBottom: 16 },
    chapterRow:{ fontSize: 12, color: 'var(--color-text-secondary)', padding: '3px 0', fontFamily: 'monospace' },
    voLine:    { marginBottom: 8, padding: '8px 10px', borderRadius: 6, background: 'var(--color-background-tertiary)' },
  }

  return (
    <div style={S.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <h1 style={S.h1}>EDL Builder</h1>
      <p style={S.sub}>Build a DaVinci Resolve EDL from your indexed sessions</p>

      {loading && <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>Loading…</p>}

      {/* Sessions */}
      {!loading && sessions.length === 0 && (
        <div style={S.card}>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>
            No indexed sessions. Upload audio from the KB chat first.
          </p>
        </div>
      )}

      {sessions.length > 0 && (
        <div style={S.section}>
          <label style={S.label}>Sessions — assign each one</label>
          {sessions.map(s => (
            <div key={s.id} style={S.card}>
              <div style={S.row}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{s.title}</p>
                  <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    {Math.round((s.duration_ms || 0) / 60000)}min
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {['screen', 'camera'].map(role => (
                    <button key={role} onClick={() => setAssignments(p => ({ ...p, [s.id]: role }))} style={S.pill(assignments[s.id] === role)}>
                      {role}
                    </button>
                  ))}
                  <button style={S.del} onClick={async () => {
                    if (!confirm(`Delete "${s.title}"?`)) return
                    const sess = await getSession()
                    await fetch(`${BASE}/session/${s.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${sess?.access_token}` } })
                    setSessions(p => p.filter(x => x.id !== s.id))
                    setAssignments(p => { const n = {...p}; delete n[s.id]; return n })
                  }}>✕</button>
                </div>
              </div>
              <div>
                <label style={{ ...S.label, marginBottom: 4 }}>Video filename for DaVinci relink</label>
                <input value={clipNames[s.id] || ''} onChange={e => setClipNames(p => ({ ...p, [s.id]: e.target.value }))}
                  placeholder="e.g. 20260602_screen.mp4" style={S.input} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Asset Library */}
      <div style={S.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ ...S.label, marginBottom: 0 }}>Asset library — b-roll, reactions, SFX</label>
          <button style={S.uploadBtn} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <span style={S.spinner}/> : '+'}
            {uploading ? 'Uploading…' : 'Upload assets'}
          </button>
          <input ref={fileInputRef} type="file" multiple accept="video/*,audio/*,image/*,.gif"
            onChange={handleAssetUpload} style={{ display: 'none' }} />
        </div>
        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Placeholders are pre-loaded — Claude references them by name even before you upload.
          Upload a file with the exact filename shown to link it. Name files with the prefix shown (e.g. <code>reaction_laugh.mp4</code>).
        </p>



        {Object.entries(assetsByType).map(([type, list]) => (
          <div key={type} style={{ marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: TYPE_META[type]?.color || 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              {TYPE_META[type]?.label || type} ({list.length})
            </p>
            {list.map(a => (
              <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 6, background: 'var(--color-background-secondary)', marginBottom: 4, opacity: a.is_placeholder ? 0.55 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>
                    {a.display_name || a.filename}
                  </span>
                  {a.is_placeholder
                    ? <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>no file yet</span>
                    : <span style={{ fontSize: 10, color: 'rgba(74,222,128,0.7)', fontWeight: 700 }}>✓ linked</span>
                  }
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', opacity: 0.5 }}>{a.filename}</span>
                  {!a.is_placeholder && <button style={S.del} onClick={() => deleteAsset(a.id)}>✕</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Settings */}
      {sessions.length > 0 && (
        <div style={S.section}>
          <label style={S.label}>Target length</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[5, 8, 10, 12, 15].map(m => (
              <button key={m} onClick={() => setTargetMins(m)} style={S.pill(targetMins === m)}>{m}m</button>
            ))}
          </div>

          <label style={S.label}>Frame rate</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[24, 25, 30, 60].map(f => (
              <button key={f} onClick={() => setFps(f)} style={S.pill(fps === f)}>{f}fps</button>
            ))}
          </div>

          <label style={S.label}>Edit brief — tell Claude what to keep and cut</label>
          <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={4}
            placeholder={`e.g. "Cold open at 44min on the hook recording. Rewind to 15:13 for the challenge setup. Cut all troubleshooting. Best take is around 38:53."`}
            style={{ ...S.input, resize: 'vertical', lineHeight: 1.5 }} />
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgba(239,68,68,0.9)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Success summary */}
      {done && (
        <div style={S.success}>
          <p style={{ color: 'rgba(74,222,128,0.9)', fontSize: 13, marginBottom: 4 }}>
            ✓ {done.filename} — {done.originalMinutes}min → {done.totalMinutes}min
          </p>
          <p style={{ fontSize: 11, color: 'rgba(74,222,128,0.6)', marginBottom: done.voiceover?.length || done.chapters?.length ? 12 : 0 }}>
            {done.cutCount} video cuts · {done.voiceoverCount || 0} VO lines · {done.brollCount || 0} b-roll · {done.sfxCount || 0} SFX · {done.titleCount || 0} title cards
            <br/>Set DaVinci project to {fps}fps · File → Import Timeline → Import EDL
          </p>

          {done.chapters?.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(74,222,128,0.15)', paddingTop: 10, marginTop: 8, marginBottom: 10 }}>
              <p style={{ fontSize: 11, color: 'rgba(74,222,128,0.6)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                YouTube chapters — paste into description:
              </p>
              {done.chapters.map((c, i) => (
                <p key={i} style={S.chapterRow}>{c.time} {c.label}</p>
              ))}
            </div>
          )}

          {done.voiceover?.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(74,222,128,0.15)', paddingTop: 10, marginTop: 4 }}>
              <p style={{ fontSize: 11, color: 'rgba(74,222,128,0.6)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Voiceover lines to record:
              </p>
              {done.voiceover.map((v, i) => (
                <div key={i} style={S.voLine}>
                  <span style={{ fontSize: 10, color: 'rgba(74,222,128,0.5)', fontWeight: 700, marginRight: 8 }}>{v.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{v.line}</span>
                </div>
              ))}
              <p style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                Record as VO_01.mp3, VO_02.mp3 etc. Link to A1 placeholders in DaVinci.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Build button */}
      {canBuild && (
        <button onClick={buildEDL} disabled={building} style={S.buildBtn(building)}>
          {building
            ? <><span style={S.spinner}/>{Object.values(assignments).includes('camera') ? 'Syncing & building…' : 'Building…'}</>
            : '↓ Build & Download EDL'
          }
        </button>
      )}
    </div>
  )
}