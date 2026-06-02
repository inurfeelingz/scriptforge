// frontend/src/pages/EDLBuilder.jsx
// Direct EDL download — no conversation required.
// Route: /editor/edl-builder

import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { getSession } from '../lib/supabase'

export default function EDLBuilder() {
  const { activeCategory } = useStore()
  const cat = activeCategory?.()

  const [sessions,      setSessions]      = useState([])
  const [assignments,   setAssignments]   = useState({}) // { id: 'screen'|'camera' }
  const [clipNames,     setClipNames]     = useState({}) // { id: 'filename.mp4' }
  const [targetMins,    setTargetMins]    = useState(8)
  const [fps,           setFps]           = useState(24)
  const [instructions,  setInstructions]  = useState('')
  const [loading,       setLoading]       = useState(true)
  const [building,      setBuilding]      = useState(false)
  const [error,         setError]         = useState(null)
  const [done,          setDone]          = useState(null)

  const BASE = import.meta.env.VITE_API_URL || '/api'

  useEffect(() => {
    if (!cat?.id) return
    loadSessions()
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
      // Pre-fill clip names from session titles
      const names = {}
      ;(data.sessions || []).forEach(s => {
        names[s.id] = s.title + '.mp4'
      })
      setClipNames(names)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  async function buildEDL() {
    const screenSession = sessions.find(s => assignments[s.id] === 'screen')
    const cameraSession = sessions.find(s => assignments[s.id] === 'camera')

    if (!screenSession) { setError('Assign at least one session as Screen'); return }

    setBuilding(true)
    setError(null)

    try {
      // Step 1: sync if we have two sessions
      let offsetMs = 0
      if (cameraSession) {
        const sess    = await getSession()
        const syncRes = await fetch(`${BASE}/editor/sync-audio`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${sess?.access_token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ sessionIdA: screenSession.id, sessionIdB: cameraSession.id, categoryId: cat.id }),
        })
        const syncData = await syncRes.json()
        if (syncRes.ok) {
          offsetMs = syncData.offsetMs || 0
          console.log('[EDL] Sync offset:', offsetMs, 'ms —', syncData.summary)
        }
      }

      // Step 2: build EDL
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

      // Parse summary
      let summary = {}
      try { summary = JSON.parse(buildRes.headers.get('X-EDL-Summary') || '{}') } catch {}

      // Download
      const blob     = await buildRes.blob()
      const url      = URL.createObjectURL(blob)
      const filename = summary.filename || 'edit.edl'
      const a        = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)

      setDone({ filename, ...summary })
    } catch (e) {
      setError(e.message)
    }

    setBuilding(false)
  }

  const canBuild = Object.values(assignments).includes('screen')

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: '0 24px', fontFamily: "'Figtree', sans-serif" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e8eaed', marginBottom: 4 }}>EDL Builder</h1>
      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 32 }}>
        Build a DaVinci Resolve EDL from your indexed sessions
      </p>

      {loading && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading sessions…</p>}

      {!loading && sessions.length === 0 && (
        <div style={{ padding: 20, borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          No indexed sessions found for this workspace. Upload your audio files from the KB chat first.
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {sessions.map(s => (
            <div key={s.id} style={{ padding: 16, borderRadius: 10, border: `1px solid ${assignments[s.id] ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.1)'}`, background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#e8eaed' }}>{s.title}</p>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                    {Math.round((s.duration_ms || 0) / 60000)}min
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {['screen', 'camera'].map(role => (
                    <button key={role}
                      onClick={() => setAssignments(prev => ({ ...prev, [s.id]: role }))}
                      style={{ padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, background: assignments[s.id] === role ? 'rgba(74,222,128,1)' : 'rgba(255,255,255,0.08)', color: assignments[s.id] === role ? '#080808' : 'rgba(255,255,255,0.5)' }}>
                      {role}
                    </button>
                  ))}
                  <button onClick={async () => {
                    if (!confirm(`Delete "${s.title}"?`)) return
                    try {
                      const sess = await getSession()
                      await fetch(`${BASE}/session/${s.id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${sess?.access_token}` }
                      })
                      setSessions(prev => prev.filter(x => x.id !== s.id))
                      setAssignments(prev => { const n = {...prev}; delete n[s.id]; return n })
                      setClipNames(prev => { const n = {...prev}; delete n[s.id]; return n })
                    } catch (e) { setError(e.message) }
                  }} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,80,80,0.2)', background: 'none', cursor: 'pointer', fontSize: 11, color: 'rgba(255,80,80,0.5)' }}>
                    ✕
                  </button>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', display: 'block', marginBottom: 4 }}>Video filename (so DaVinci can relink)</label>
                <input
                  value={clipNames[s.id] || ''}
                  onChange={e => setClipNames(prev => ({ ...prev, [s.id]: e.target.value }))}
                  placeholder="e.g. SCREEN_FOOTAGE.mp4"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '7px 10px', color: '#e8eaed', fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 8 }}>Target length (minutes)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[5, 8, 10, 12, 15].map(m => (
              <button key={m} onClick={() => setTargetMins(m)}
                style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: targetMins === m ? 'rgba(74,222,128,1)' : 'rgba(255,255,255,0.08)', color: targetMins === m ? '#080808' : 'rgba(255,255,255,0.5)' }}>
                {m}m
              </button>
            ))}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 8 }}>Footage frame rate</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[24, 25, 30, 60].map(f => (
              <button key={f} onClick={() => setFps(f)}
                style={{ padding: '7px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: fps === f ? 'rgba(74,222,128,1)' : 'rgba(255,255,255,0.08)', color: fps === f ? '#080808' : 'rgba(255,255,255,0.5)' }}>
                {f}fps
              </button>
            ))}
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', display: 'block', marginBottom: 8 }}>
            Edit brief — tell Claude what to keep and cut (optional but makes a huge difference)
          </label>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder={`e.g. "Cold open at 44 minutes when I'm recording the hook. Cut back to 15 minutes for the challenge setup. Keep all the recording takes from 32-40 mins. Cut everything before minute 7. The best hook take is around 38:53."`}
            rows={5}
            style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '10px 12px', color: '#e8eaed', fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }}
          />
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,100,100,0.1)', border: '1px solid rgba(255,100,100,0.2)', color: 'rgba(255,120,120,0.9)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {done && (
        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', color: 'rgba(74,222,128,0.9)', fontSize: 13, marginBottom: 16 }}>
          ✓ Downloaded {done.filename} — {done.originalMinutes}min cut to {done.totalMinutes}min · {done.cutCount} cuts
          <br/>
          <span style={{ fontSize: 11, opacity: 0.7 }}>DaVinci: File → Import Timeline → Import EDL</span>
        </div>
      )}

      {canBuild && (
        <button onClick={buildEDL} disabled={building}
          style={{ width: '100%', padding: '14px 0', borderRadius: 10, border: 'none', cursor: building ? 'not-allowed' : 'pointer', background: building ? 'rgba(74,222,128,0.3)' : 'rgba(74,222,128,1)', color: '#080808', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {building ? (
            <>
              <span style={{ width: 14, height: 14, border: '2px solid #080808', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }}/>
              {Object.values(assignments).includes('camera') ? 'Syncing & Building EDL…' : 'Building EDL…'}
            </>
          ) : '↓ Build & Download EDL'}
        </button>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}