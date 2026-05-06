// frontend/src/pages/StoryboardPage.jsx
import { useState, useEffect } from 'react'
import { Film, Wand2, Trash2, ChevronRight, Camera, FileText, FileSpreadsheet } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'

const SHOT_META = {
  ecu:   { label: 'Extreme Close-Up', abbr: 'ECU',  crop: 'Eyes to chin',          color: '#e05580' },
  cu:    { label: 'Close-Up',         abbr: 'CU',   crop: 'Head & shoulders',       color: '#e07840' },
  mcu:   { label: 'Medium Close-Up',  abbr: 'MCU',  crop: 'Chest up',              color: '#d4a853' },
  ms:    { label: 'Medium Shot',      abbr: 'MS',   crop: 'Waist up',              color: '#6ab87a' },
  mws:   { label: 'Medium Wide',      abbr: 'MWS',  crop: 'Knees up',              color: '#5ab0d4' },
  ws:    { label: 'Wide Shot',        abbr: 'WS',   crop: 'Full body',             color: '#7878d8' },
  ews:   { label: 'Extreme Wide',     abbr: 'EWS',  crop: 'Full environment',      color: '#a060c8' },
  ots:   { label: 'Over Shoulder',    abbr: 'OTS',  crop: 'Subject over shoulder', color: '#d45870' },
  two:   { label: 'Two Shot',         abbr: '2S',   crop: 'Two subjects',          color: '#50b8a0' },
  low:   { label: 'Low Angle',        abbr: 'LOW',  crop: 'Camera below eyeline',  color: '#c86850' },
  high:  { label: 'High Angle',       abbr: 'HIGH', crop: 'Camera above eyeline',  color: '#60a8d8' },
  dutch: { label: 'Dutch Angle',      abbr: 'DTH',  crop: 'Tilted frame',          color: '#d8b040' },
  pov:   { label: 'Point of View',    abbr: 'POV',  crop: 'First person',          color: '#80c870' },
  th:    { label: 'Talking Head',     abbr: 'TH',   crop: 'Presenter, ⅓ offset',  color: '#d4a853' },
}

export default function ShotListPage() {
  const { activeCategoryId, notify } = useStore()
  const [episodes,   setEpisodes]   = useState([])
  const [shotLists,  setShotLists]  = useState([])
  const [active,     setActive]     = useState(null)
  const [generating, setGenerating] = useState(false)
  const [selectedEp, setSelectedEp] = useState('')
  const [loading,    setLoading]    = useState(false)

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
    setLoading(true)
    try {
      const result = await api.get(`/storyboard/${id}`)
      // result has shape { storyboard: {...}, frames: [...] }
      setActive(result)
    } catch (err) {
      notify(err.message || 'Could not load shot list', 'error')
    } finally { setLoading(false) }
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
      const q = v => `"${(v||'').replace(/"/g,'""')}"`
      return [i+1, m.label, m.abbr, m.crop, q(f.section), q(f.description), q(f.notes)].join(',')
    })
    const blob = new Blob([[header, ...rows].join('\n'), { type: 'text/csv' }])
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(active.storyboard.title||'shot_list').replace(/[^a-z0-9]/gi,'_')}.csv`
    a.click()
  }

  function downloadPDF() {
    if (!active?.frames?.length) return
    const title = active.storyboard.title || 'Shot List'
    const frames = active.frames

    // Build HTML for the PDF
    const sectioned = []
    let cur = null
    for (const f of frames) {
      const s = f.section || 'General'
      if (!cur || cur.s !== s) { cur = { s, items: [] }; sectioned.push(cur) }
      cur.items.push(f)
    }

    const shotRows = sectioned.map(g => `
      <tr class="section-row"><td colspan="5">${g.s}</td></tr>
      ${g.items.map((f,i) => {
        const m = SHOT_META[f.shot_type] || SHOT_META.ms
        return `<tr>
          <td class="num">${String(f.position+1).padStart(2,'0')}</td>
          <td><span class="badge" style="background:${m.color}22;color:${m.color};border:1px solid ${m.color}44">${m.abbr}</span></td>
          <td class="crop">${m.crop}</td>
          <td>${f.description||''}</td>
          <td class="notes">${f.notes||''}</td>
        </tr>`
      }).join('')}
    `).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${title} — Shot List</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:#1a1a2a;padding:32px;background:#fff}
  h1{font-size:22px;font-weight:700;margin-bottom:4px;color:#0e0f1a}
  .sub{font-size:12px;color:#666;margin-bottom:24px}
  table{width:100%;border-collapse:collapse}
  th{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#888;padding:6px 10px;border-bottom:2px solid #e8e8ee;text-align:left}
  td{padding:8px 10px;border-bottom:1px solid #f0f0f5;vertical-align:top;line-height:1.5}
  tr:hover td{background:#fafafe}
  .section-row td{background:#f4f4f8;font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#666;padding:6px 10px;border-bottom:none;border-top:1px solid #e0e0ea}
  .num{font-family:monospace;color:#aaa;font-size:10px;width:32px}
  .badge{display:inline-block;padding:2px 7px;border-radius:4px;font-weight:700;font-family:monospace;font-size:10px;white-space:nowrap}
  .crop{color:#888;font-size:10px;width:130px}
  .notes{color:#888;font-style:italic;font-size:10px}
  @media print{body{padding:16px}}
</style></head><body>
<h1>${title}</h1>
<p class="sub">${frames.length} shots · Generated by WhispaCuts</p>
<table>
  <thead><tr><th>#</th><th>Shot</th><th>Frame</th><th>Description</th><th>Notes</th></tr></thead>
  <tbody>${shotRows}</tbody>
</table>
</body></html>`

    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    win.onload = () => { win.print() }
  }

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

  const B = ({ children, onClick, disabled, gold }) => (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '8px 16px', borderRadius: 9, cursor: disabled ? 'not-allowed' : 'pointer',
      border: `1px solid ${gold ? 'rgba(212,168,83,0.3)' : 'rgba(255,255,255,0.1)'}`,
      color: gold ? '#d4a853' : '#888',
      background: gold ? 'rgba(212,168,83,0.1)' : 'rgba(255,255,255,0.04)',
      fontSize: 12, fontWeight: 500, opacity: disabled ? 0.4 : 1, transition: 'all 0.15s',
      boxShadow: gold && !disabled ? '0 2px 12px rgba(212,168,83,0.12)' : 'none',
    }}>{children}</button>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontFamily: "'Syne',sans-serif", fontWeight: 700, color: '#f0ede8', margin: 0 }}>
          Shot List
        </h1>
        <p style={{ fontSize: 13, color: '#556', marginTop: 4 }}>
          Generate a professional shot list from any episode script
        </p>
      </div>

      {/* Generate panel */}
      <div style={{
        borderRadius: 12, padding: '18px 20px', marginBottom: 28,
        background: 'linear-gradient(135deg,#0f1018 0%,#0c0d18 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4),inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>
          Generate from episode
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selectedEp} onChange={e => setSelectedEp(e.target.value)} style={{
            flex: 1, minWidth: 200, background: '#080a12', border: '1px solid #1e2030',
            borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#ccc', outline: 'none',
          }}>
            <option value="">Select an episode...</option>
            {episodes.map(ep => <option key={ep.id} value={ep.id}>{ep.track_name || ep.title}</option>)}
          </select>
          <B onClick={generate} disabled={!selectedEp || generating} gold>
            <Wand2 size={13} style={{ animation: generating ? 'spin 1s linear infinite' : 'none' }}/>
            {generating ? 'Generating...' : 'Generate shot list'}
          </B>
        </div>
      </div>

      {/* Past shot lists */}
      {!active && shotLists.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
            Saved shot lists
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shotLists.map(sb => (
              <div key={sb.id} onClick={() => loadShotList(sb.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderRadius: 10, cursor: loading ? 'wait' : 'pointer',
                background: '#0c0e16', border: '1px solid rgba(255,255,255,0.06)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.3)', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor='rgba(212,168,83,0.22)'; e.currentTarget.style.background='#0e1020' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor='rgba(255,255,255,0.06)'; e.currentTarget.style.background='#0c0e16' }}
              >
                <div style={{
                  width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                  background: 'rgba(212,168,83,0.08)', border: '1px solid rgba(212,168,83,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Film size={14} style={{ color: '#d4a853' }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#e8eaed', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sb.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>
                    {new Date(sb.created_at).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'})}
                  </div>
                </div>
                <ChevronRight size={13} style={{ color: '#333', flexShrink: 0 }}/>
                <button onClick={e => deleteShotList(sb.id, e)} style={{
                  background:'none', border:'none', cursor:'pointer', padding:6,
                  color:'#333', borderRadius:5, flexShrink:0, display:'flex', alignItems:'center',
                }}
                  onMouseEnter={e => e.currentTarget.style.color='#e05555'}
                  onMouseLeave={e => e.currentTarget.style.color='#333'}
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
          {/* Header row */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 22, flexWrap:'wrap', gap:12 }}>
            <div>
              <h2 style={{ fontSize: 19, fontFamily:"'Syne',sans-serif", fontWeight:700, color:'#f0ede8', margin:0 }}>
                {active.storyboard?.title || active.storyboard?.track_name}
              </h2>
              <p style={{ fontSize:12, color:'#555', margin:'3px 0 0' }}>
                {active.frames?.length || 0} shots
              </p>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <B onClick={downloadPDF}>
                <FileText size={12}/> PDF
              </B>
              <B onClick={downloadCSV}>
                <FileSpreadsheet size={12}/> CSV
              </B>
              <button onClick={() => setActive(null)} style={{
                fontSize:12, color:'#555', background:'none', border:'none', cursor:'pointer', padding:'6px 10px', borderRadius:7,
              }}
                onMouseEnter={e => e.currentTarget.style.color='#999'}
                onMouseLeave={e => e.currentTarget.style.color='#555'}
              >← Back</button>
            </div>
          </div>

          {/* Cards grid grouped by section */}
          {groupBySection(active.frames || []).map(group => (
            <div key={group.section} style={{ marginBottom: 28 }}>
              {/* Section header */}
              <div style={{
                display:'flex', alignItems:'center', gap:10, marginBottom:14,
              }}>
                <div style={{ fontSize:10, color:'#d4a853', textTransform:'uppercase', letterSpacing:'0.14em', fontFamily:'monospace', opacity:0.75 }}>
                  {group.section}
                </div>
                <div style={{ flex:1, height:1, background:'rgba(212,168,83,0.12)' }}/>
                <div style={{ fontSize:10, color:'#444', fontFamily:'monospace' }}>
                  {group.frames.length} shot{group.frames.length !== 1 ? 's' : ''}
                </div>
              </div>

              {/* Cards */}
              <div style={{
                display:'grid',
                gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',
                gap:14,
              }}>
                {group.frames.map(frame => (
                  <ShotCard key={frame.id} frame={frame} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!active && shotLists.length === 0 && (
        <div style={{
          textAlign:'center', padding:'56px 0',
          border:'1px dashed rgba(255,255,255,0.06)', borderRadius:12,
        }}>
          <Camera size={28} style={{ color:'#2a2e48', display:'block', margin:'0 auto 12px' }}/>
          <div style={{ color:'#444', fontSize:13 }}>No shot lists yet. Generate one from an episode above.</div>
        </div>
      )}
    </div>
  )
}

// ── SHOT CARD ────────────────────────────────────────────────────────────────
function ShotCard({ frame }) {
  const meta = SHOT_META[frame.shot_type] || SHOT_META.ms
  const [hover, setHover] = useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 14, overflow:'hidden',
        background: 'linear-gradient(180deg,#0e1020 0%,#0a0c16 100%)',
        border: `1px solid ${hover ? meta.color+'40' : meta.color+'1a'}`,
        boxShadow: hover
          ? `0 8px 28px rgba(0,0,0,0.6),0 0 0 1px ${meta.color}20,inset 0 1px 0 rgba(255,255,255,0.06)`
          : `0 3px 16px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.04)`,
        transition:'all 0.18s',
        transform: hover ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {/* Card top bar — shot number + type */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'10px 14px',
        background:`linear-gradient(90deg,${meta.color}0e 0%,transparent 100%)`,
        borderBottom:`1px solid ${meta.color}16`,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontSize:11, fontFamily:'monospace', color:'#333', fontWeight:700 }}>
            {String(frame.position+1).padStart(2,'0')}
          </span>
          <span style={{
            fontSize:13, fontWeight:700, color:meta.color,
            fontFamily:"'Figtree',sans-serif", letterSpacing:'-0.01em',
          }}>
            {meta.label}
          </span>
        </div>
        {/* Shot type pill */}
        <span style={{
          fontSize:10, fontFamily:'monospace', fontWeight:700,
          color:meta.color, background:`${meta.color}18`,
          border:`1px solid ${meta.color}28`,
          borderRadius:99, padding:'2px 8px',
        }}>
          {meta.abbr}
        </span>
      </div>

      {/* Crop indicator bar — visual shorthand for framing */}
      <div style={{ padding:'8px 14px 0', display:'flex', alignItems:'center', gap:8 }}>
        <div style={{
          fontSize:9, color:'#444', textTransform:'uppercase',
          letterSpacing:'0.1em', fontFamily:'monospace',
        }}>
          Frame:
        </div>
        <div style={{
          fontSize:9, color:meta.color, opacity:0.7,
          fontFamily:'monospace', fontWeight:600,
        }}>
          {meta.crop}
        </div>
      </div>

      {/* Description */}
      <div style={{ padding:'8px 14px 10px' }}>
        <p style={{ fontSize:13, color:'#c8ccd6', lineHeight:1.58, margin:0 }}>
          {frame.description}
        </p>
      </div>

      {/* Notes */}
      {frame.notes && (
        <div style={{
          padding:'8px 14px 12px',
          borderTop:`1px solid rgba(255,255,255,0.04)`,
        }}>
          <p style={{ fontSize:11.5, color:meta.color, lineHeight:1.52, margin:0, fontStyle:'italic', opacity:0.65 }}>
            {frame.notes}
          </p>
        </div>
      )}
    </div>
  )
}