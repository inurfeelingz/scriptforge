// frontend/src/pages/StoryboardPage.jsx
// Shot List — replaces storyboard. Same backend, clean list UI.

import { useState, useEffect } from 'react'
import { Film, Wand2, Trash2, ChevronRight, Camera, Download } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'

// Shot type metadata — label, abbreviation, what body part it frames
const SHOT_META = {
  ecu:   { label: 'Extreme Close-Up', abbr: 'ECU',   crop: 'Eyes to chin',           color: '#e05580' },
  cu:    { label: 'Close-Up',         abbr: 'CU',    crop: 'Head & shoulders',        color: '#e07840' },
  mcu:   { label: 'Medium Close-Up',  abbr: 'MCU',   crop: 'Chest up',               color: '#d4a853' },
  ms:    { label: 'Medium Shot',      abbr: 'MS',    crop: 'Waist up',               color: '#6ab87a' },
  mws:   { label: 'Medium Wide',      abbr: 'MWS',   crop: 'Knees up',               color: '#5ab0d4' },
  ws:    { label: 'Wide Shot',        abbr: 'WS',    crop: 'Full body',              color: '#7878d8' },
  ews:   { label: 'Extreme Wide',     abbr: 'EWS',   crop: 'Full environment',       color: '#a060c8' },
  ots:   { label: 'Over Shoulder',    abbr: 'OTS',   crop: 'Subject over shoulder',  color: '#d45870' },
  two:   { label: 'Two Shot',         abbr: '2S',    crop: 'Two subjects',           color: '#50b8a0' },
  low:   { label: 'Low Angle',        abbr: 'LOW',   crop: 'Camera below eyeline',   color: '#c86850' },
  high:  { label: 'High Angle',       abbr: 'HIGH',  crop: 'Camera above eyeline',   color: '#60a8d8' },
  dutch: { label: 'Dutch Angle',      abbr: 'DTH',   crop: 'Tilted frame',           color: '#d8b040' },
  pov:   { label: 'Point of View',    abbr: 'POV',   crop: 'First person',           color: '#80c870' },
  th:    { label: 'Talking Head',     abbr: 'TH',    crop: 'Presenter, 1/3 offset',  color: '#d4a853' },
}

export default function ShotListPage() {
  const { activeCategoryId, notify } = useStore()
  const [episodes,    setEpisodes]    = useState([])
  const [shotLists,   setShotLists]   = useState([])
  const [active,      setActive]      = useState(null)
  const [generating,  setGenerating]  = useState(false)
  const [selectedEp,  setSelectedEp]  = useState('')

  useEffect(() => {
    if (!activeCategoryId) return
    api.get(`/episodes?categoryId=${activeCategoryId}&limit=20`)
      .then(d => setEpisodes(d.episodes || [])).catch(() => {})
    api.get(`/storyboard?categoryId=${activeCategoryId}`)
      .then(d => setShotLists(d.storyboards || [])).catch(() => {})
  }, [activeCategoryId])

  async function generate() {
    if (!selectedEp || generating) return
    setGenerating(true)
    try {
      const result = await api.post('/storyboard/generate', {
        episodeId: selectedEp, categoryId: activeCategoryId, maxFrames: 20,
      })
      setActive(result)
      setShotLists(prev => [result.storyboard, ...prev])
      notify(`Shot list generated — ${result.frames.length} shots`, 'success')
    } catch (err) {
      notify(err.message || 'Generation failed', 'error')
    } finally { setGenerating(false) }
  }

  async function loadShotList(id) {
    try { setActive(await api.get(`/storyboard/${id}`)) }
    catch (err) { notify(err.message || 'Could not load shot list', 'error') }
  }

  async function deleteShotList(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this shot list?')) return
    try {
      await api.delete(`/storyboard/${id}`)
      setShotLists(prev => prev.filter(s => s.id !== id))
      if (active?.storyboard?.id === id) setActive(null)
      notify('Shot list deleted', 'success')
    } catch { notify('Could not delete', 'error') }
  }

  function downloadCSV() {
    if (!active?.frames?.length) return
    const header = 'Shot #,Type,Abbr,Crop,Section,Description,Notes'
    const rows = active.frames.map((f, i) => {
      const m = SHOT_META[f.shot_type] || SHOT_META.ms
      const csv = v => `"${(v||'').replace(/"/g,'""')}"`
      return [i+1, m.label, m.abbr, m.crop, csv(f.section), csv(f.description), csv(f.notes)].join(',')
    })
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${active.storyboard.title?.replace(/[^a-z0-9]/gi,'_')}_shot_list.csv`
    a.click()
  }

  // Group shots by section for organised display
  function groupBySection(frames) {
    const groups = []
    let current = null
    for (const frame of frames) {
      const sec = frame.section || 'General'
      if (!current || current.section !== sec) {
        current = { section: sec, frames: [] }
        groups.push(current)
      }
      current.frames.push(frame)
    }
    return groups
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontFamily: "'Syne', sans-serif", fontWeight: 700, color: '#f0ede8', margin: 0 }}>
          Shot List
        </h1>
        <p style={{ fontSize: 13, color: '#556', marginTop: 4 }}>
          Generate a professional shot list from any episode script
        </p>
      </div>

      {/* Generate panel */}
      <div style={{
        borderRadius: 12, padding: '18px 20px', marginBottom: 24,
        background: 'linear-gradient(135deg, #0f1018 0%, #0c0d18 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>
          Generate from episode
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <select value={selectedEp} onChange={e => setSelectedEp(e.target.value)} style={{
              width: '100%', background: '#080a12', border: '1px solid #1e2030',
              borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#ccc', outline: 'none',
            }}>
              <option value="">Select an episode...</option>
              {episodes.map(ep => (
                <option key={ep.id} value={ep.id}>{ep.track_name || ep.title}</option>
              ))}
            </select>
          </div>
          <button onClick={generate} disabled={!selectedEp || generating} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 18px', borderRadius: 9, cursor: selectedEp && !generating ? 'pointer' : 'not-allowed',
            border: '1px solid rgba(212,168,83,0.3)', color: '#d4a853',
            background: 'rgba(212,168,83,0.1)', fontSize: 13, fontWeight: 500,
            opacity: !selectedEp ? 0.4 : 1, transition: 'all 0.15s',
            boxShadow: selectedEp ? '0 2px 12px rgba(212,168,83,0.12)' : 'none',
          }}>
            <Wand2 size={13} style={{ animation: generating ? 'spin 1s linear infinite' : 'none' }}/>
            {generating ? 'Generating...' : 'Generate shot list'}
          </button>
        </div>
      </div>

      {/* Past shot lists */}
      {!active && shotLists.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
            Saved shot lists
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shotLists.map(sb => (
              <div key={sb.id} onClick={() => loadShotList(sb.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
                background: '#0c0e16', border: '1px solid rgba(255,255,255,0.06)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.3)', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(212,168,83,0.2)'; e.currentTarget.style.background = '#0e1020' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = '#0c0e16' }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 7, flexShrink: 0,
                  background: 'rgba(212,168,83,0.08)', border: '1px solid rgba(212,168,83,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Film size={13} style={{ color: '#d4a853' }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#e8eaed', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sb.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#444', marginTop: 1 }}>
                    {new Date(sb.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <ChevronRight size={13} style={{ color: '#333', flexShrink: 0 }}/>
                <button onClick={e => deleteShotList(sb.id, e)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 5,
                  color: '#333', borderRadius: 5, flexShrink: 0, display: 'flex', alignItems: 'center',
                }}
                  onMouseEnter={e => e.currentTarget.style.color = '#e05555'}
                  onMouseLeave={e => e.currentTarget.style.color = '#333'}
                >
                  <Trash2 size={12}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active shot list */}
      {active && (
        <div>
          {/* List header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <h2 style={{ fontSize: 18, fontFamily: "'Syne', sans-serif", fontWeight: 700, color: '#f0ede8', margin: 0 }}>
                {active.storyboard.title}
              </h2>
              <p style={{ fontSize: 12, color: '#555', margin: '3px 0 0' }}>
                {active.frames.length} shots
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={downloadCSV} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 11, padding: '6px 12px', borderRadius: 7, cursor: 'pointer',
                border: '1px solid rgba(255,255,255,0.1)', color: '#888',
                background: 'rgba(255,255,255,0.04)', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ccc'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)' }}
                onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}
              >
                <Download size={11}/> Export CSV
              </button>
              <button onClick={() => setActive(null)} style={{
                fontSize: 12, color: '#555', background: 'none', border: 'none',
                cursor: 'pointer', padding: '6px 10px', borderRadius: 7,
              }}
                onMouseEnter={e => e.currentTarget.style.color = '#999'}
                onMouseLeave={e => e.currentTarget.style.color = '#555'}
              >
                ← Back
              </button>
            </div>
          </div>

          {/* Shot list table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '36px 72px 1fr 1fr',
              gap: 12, padding: '6px 14px',
              fontSize: 9, color: '#444', textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              <span>#</span>
              <span>Shot</span>
              <span>Description</span>
              <span>Notes</span>
            </div>

            {groupBySection(active.frames).map(group => (
              <div key={group.section}>
                {/* Section label */}
                <div style={{
                  fontSize: 10, color: '#d4a853', textTransform: 'uppercase',
                  letterSpacing: '0.12em', padding: '10px 14px 4px',
                  fontFamily: 'monospace', opacity: 0.7,
                }}>
                  ── {group.section}
                </div>

                {group.frames.map((frame, i) => {
                  const meta = SHOT_META[frame.shot_type] || SHOT_META.ms
                  return (
                    <ShotRow
                      key={frame.id}
                      frame={frame}
                      meta={meta}
                      num={frame.position + 1}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {!active && shotLists.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '52px 0',
          color: '#333', fontSize: 13,
          border: '1px dashed rgba(255,255,255,0.06)', borderRadius: 12,
        }}>
          <Camera size={28} style={{ color: '#2a2e48', marginBottom: 12, display: 'block', margin: '0 auto 12px' }}/>
          No shot lists yet. Generate one from an episode above.
        </div>
      )}
    </div>
  )
}

// ── SHOT ROW ──────────────────────────────────────────────────────────────────
function ShotRow({ frame, meta, num }) {
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '36px 72px 1fr 1fr',
        gap: 12, padding: '10px 14px',
        borderRadius: 8, transition: 'background 0.12s',
        background: hover ? 'rgba(255,255,255,0.03)' : 'transparent',
        borderLeft: `2px solid ${hover ? meta.color : 'transparent'}`,
        alignItems: 'start',
      }}
    >
      {/* Shot number */}
      <div style={{
        fontSize: 11, fontFamily: 'monospace', color: '#333',
        paddingTop: 2, fontWeight: 600,
      }}>
        {String(num).padStart(2, '0')}
      </div>

      {/* Shot type badge */}
      <div>
        <div style={{
          display: 'inline-block',
          fontSize: 11, fontWeight: 700, fontFamily: 'monospace',
          color: meta.color, letterSpacing: '0.04em',
          background: `${meta.color}14`,
          border: `1px solid ${meta.color}28`,
          borderRadius: 5, padding: '2px 7px',
          marginBottom: 3,
        }}>
          {meta.abbr}
        </div>
        <div style={{ fontSize: 9, color: '#444', lineHeight: 1.4 }}>
          {meta.crop}
        </div>
      </div>

      {/* Description */}
      <div>
        <div style={{ fontSize: 13, color: '#c8ccd6', lineHeight: 1.55 }}>
          {frame.description}
        </div>
      </div>

      {/* Director notes */}
      <div>
        {frame.notes && (
          <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5, fontStyle: 'italic' }}>
            {frame.notes}
          </div>
        )}
      </div>
    </div>
  )
}