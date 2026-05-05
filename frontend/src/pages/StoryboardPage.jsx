// frontend/src/pages/StoryboardPage.jsx

import { useState, useEffect } from 'react'
import { Film, Wand2, Edit2, Check, Trash2, AlertCircle, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { getShotSVG, SHOT_TYPES } from '../lib/storyboardSVG'

// Accent colour per shot type — each card gets its own personality
const SHOT_COLORS = {
  ecu:   { accent: '#e05580', bg: 'rgba(224,85,128,0.06)'  },
  cu:    { accent: '#e07840', bg: 'rgba(224,120,64,0.06)'  },
  mcu:   { accent: '#d4a853', bg: 'rgba(212,168,83,0.06)'  },
  ms:    { accent: '#6ab87a', bg: 'rgba(106,184,122,0.06)' },
  mws:   { accent: '#5ab0d4', bg: 'rgba(90,176,212,0.06)'  },
  ws:    { accent: '#7878d8', bg: 'rgba(120,120,216,0.06)' },
  ews:   { accent: '#a060c8', bg: 'rgba(160,96,200,0.06)'  },
  ots:   { accent: '#d45870', bg: 'rgba(212,88,112,0.06)'  },
  two:   { accent: '#50b8a0', bg: 'rgba(80,184,160,0.06)'  },
  low:   { accent: '#c86850', bg: 'rgba(200,104,80,0.06)'  },
  high:  { accent: '#60a8d8', bg: 'rgba(96,168,216,0.06)'  },
  dutch: { accent: '#d8b040', bg: 'rgba(216,176,64,0.06)'  },
  pov:   { accent: '#80c870', bg: 'rgba(128,200,112,0.06)' },
  th:    { accent: '#d4a853', bg: 'rgba(212,168,83,0.06)'  },
}

const GENDER_OPTIONS = [
  { value: 'male',   label: 'Male'   },
  { value: 'female', label: 'Female' },
]

export default function StoryboardPage() {
  const { activeCategoryId, notify } = useStore()
  const [episodes,    setEpisodes]    = useState([])
  const [storyboards, setStoryboards] = useState([])
  const [active,      setActive]      = useState(null)
  const [generating,  setGenerating]  = useState(false)
  const [selectedEp,  setSelectedEp]  = useState('')
  const [gender,      setGender]      = useState('male')

  useEffect(() => {
    if (!activeCategoryId) return
    api.get(`/episodes?categoryId=${activeCategoryId}&limit=20`)
      .then(d => setEpisodes(d.episodes || [])).catch(() => {})
    api.get(`/storyboard?categoryId=${activeCategoryId}`)
      .then(d => setStoryboards(d.storyboards || [])).catch(() => {})
  }, [activeCategoryId])

  async function generate() {
    if (!selectedEp || generating) return
    setGenerating(true)
    try {
      const result = await api.post('/storyboard/generate', {
        episodeId: selectedEp, categoryId: activeCategoryId, gender, maxFrames: 20,
      })
      setActive(result)
      setStoryboards(prev => [result.storyboard, ...prev])
      notify(`Storyboard generated — ${result.frames.length} shots`, 'success')
    } catch (err) {
      notify(err.message || 'Generation failed', 'error')
    } finally { setGenerating(false) }
  }

  async function loadStoryboard(id) {
    try { setActive(await api.get(`/storyboard/${id}`)) }
    catch (err) { notify(err.message || 'Could not load storyboard', 'error') }
  }

  async function deleteStoryboard(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this storyboard?')) return
    try {
      await api.delete(`/storyboard/${id}`)
      setStoryboards(prev => prev.filter(s => s.id !== id))
      if (active?.storyboard?.id === id) setActive(null)
      notify('Storyboard deleted', 'success')
    } catch { notify('Could not delete', 'error') }
  }

  async function updateFrame(frameId, updates) {
    const { frame } = await api.patch(`/storyboard/frame/${frameId}`, updates)
    setActive(prev => ({
      ...prev,
      frames: prev.frames.map(f => f.id === frameId ? { ...f, ...frame } : f),
    }))
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontFamily: "'Syne', sans-serif", fontWeight: 700, color: '#f0ede8', margin: 0 }}>
          Storyboard
        </h1>
        <p style={{ fontSize: 13, color: '#556', marginTop: 4 }}>
          Shot list generator — plan your shoot before you pick up a camera
        </p>
      </div>

      {/* Disclaimer */}
      <div style={{
        display: 'flex', gap: 12, padding: '12px 16px', borderRadius: 12, marginBottom: 24,
        background: 'rgba(212,168,83,0.05)', border: '1px solid rgba(212,168,83,0.18)',
        boxShadow: 'inset 0 1px 0 rgba(212,168,83,0.08)',
      }}>
        <AlertCircle size={15} style={{ color: '#d4a853', flexShrink: 0, marginTop: 2 }}/>
        <div>
          <p style={{ fontSize: 12, color: '#d4a853', fontWeight: 600, margin: '0 0 3px' }}>
            Reference illustrations — not instructions
          </p>
          <p style={{ fontSize: 12, color: 'rgba(212,168,83,0.55)', margin: 0, lineHeight: 1.6 }}>
            These figures and scenes are placeholders to communicate framing intent. You still need to position your camera, choose your lens, set your lighting, and direct your subject. Use these as a visual shorthand with your team.
          </p>
        </div>
      </div>

      {/* Generate panel */}
      <div style={{
        borderRadius: 14, padding: '20px 22px', marginBottom: 28,
        background: 'linear-gradient(135deg, #0f1018 0%, #0c0d18 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        <div style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 14 }}>
          Generate from episode
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: '#444', display: 'block', marginBottom: 5 }}>Episode</label>
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
          <div>
            <label style={{ fontSize: 11, color: '#444', display: 'block', marginBottom: 5 }}>Subject</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {GENDER_OPTIONS.map(g => (
                <button key={g.value} onClick={() => setGender(g.value)} style={{
                  fontSize: 12, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${gender === g.value ? '#d4a85350' : '#1e2030'}`,
                  color: gender === g.value ? '#d4a853' : '#555',
                  background: gender === g.value ? '#d4a85312' : 'transparent',
                  transition: 'all 0.15s',
                }}>{g.label}</button>
              ))}
            </div>
          </div>
          <button onClick={generate} disabled={!selectedEp || generating} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 20px', borderRadius: 10,
            border: '1px solid rgba(212,168,83,0.3)', color: '#d4a853',
            background: 'rgba(212,168,83,0.1)', fontSize: 13, fontWeight: 500,
            cursor: selectedEp && !generating ? 'pointer' : 'not-allowed',
            opacity: !selectedEp ? 0.4 : 1, transition: 'all 0.15s',
            boxShadow: selectedEp ? '0 2px 12px rgba(212,168,83,0.15)' : 'none',
          }}>
            <Wand2 size={13} style={{ animation: generating ? 'spin 1s linear infinite' : 'none' }}/>
            {generating ? 'Generating...' : 'Generate storyboard'}
          </button>
        </div>
      </div>

      {/* Past storyboards */}
      {!active && storyboards.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 10, color: '#444', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>
            Past storyboards
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {storyboards.map(sb => (
              <div key={sb.id} onClick={() => loadStoryboard(sb.id)} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 18px', borderRadius: 12, cursor: 'pointer',
                background: '#0c0e16', border: '1px solid rgba(255,255,255,0.06)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.3)', transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(212,168,83,0.25)'; e.currentTarget.style.background = '#0e1020' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; e.currentTarget.style.background = '#0c0e16' }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: 'rgba(212,168,83,0.08)', border: '1px solid rgba(212,168,83,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Film size={15} style={{ color: '#d4a853' }}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: '#e8eaed', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sb.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#444', marginTop: 2 }}>
                    {new Date(sb.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                <ChevronRight size={14} style={{ color: '#333', flexShrink: 0 }}/>
                <button onClick={e => deleteStoryboard(sb.id, e)} style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 6,
                  color: '#333', borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center',
                }}
                  onMouseEnter={e => e.currentTarget.style.color = '#e05555'}
                  onMouseLeave={e => e.currentTarget.style.color = '#333'}
                >
                  <Trash2 size={13}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active storyboard grid */}
      {active && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <div>
              <h2 style={{ fontSize: 20, fontFamily: "'Syne', sans-serif", fontWeight: 700, color: '#f0ede8', margin: 0 }}>
                {active.storyboard.title}
              </h2>
              <p style={{ fontSize: 12, color: '#555', margin: '4px 0 0' }}>{active.frames.length} shots</p>
            </div>
            <button onClick={() => setActive(null)} style={{
              fontSize: 12, color: '#555', background: 'none', border: 'none',
              cursor: 'pointer', padding: '6px 12px', borderRadius: 8,
            }}
              onMouseEnter={e => e.currentTarget.style.color = '#999'}
              onMouseLeave={e => e.currentTarget.style.color = '#555'}
            >
              ← Back to list
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
            {active.frames.map((frame, i) => (
              <StoryboardFrame key={frame.id} frame={frame} index={i} onUpdate={u => updateFrame(frame.id, u)}/>
            ))}
          </div>
        </div>
      )}

      {!active && storyboards.length === 0 && !activeCategoryId && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#333', fontSize: 13 }}>
          Select a workspace to get started
        </div>
      )}
    </div>
  )
}

// ── FRAME CARD ────────────────────────────────────────────────────────────────
function StoryboardFrame({ frame, index, onUpdate }) {
  const [editing,  setEditing]  = useState(false)
  const [notes,    setNotes]    = useState(frame.notes || '')
  const [shotType, setShotType] = useState(frame.shot_type)

  const shotMeta  = SHOT_TYPES.find(s => s.id === (editing ? shotType : frame.shot_type)) || SHOT_TYPES[2]
  const colors    = SHOT_COLORS[frame.shot_type] || SHOT_COLORS.ms
  const svgString = getShotSVG(editing ? shotType : frame.shot_type, frame.gender, `${frame.id}-${index}`)

  async function save() {
    await onUpdate({ shot_type: shotType, notes })
    setEditing(false)
  }

  return (
    <div style={{
      borderRadius: 16, overflow: 'hidden',
      background: 'linear-gradient(180deg, #0e1020 0%, #0a0c16 100%)',
      border: `1px solid ${colors.accent}22`,
      boxShadow: `0 4px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.05)`,
      transition: 'transform 0.18s, box-shadow 0.18s',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-3px)'
        e.currentTarget.style.boxShadow = `0 10px 40px rgba(0,0,0,0.65), 0 0 0 1px ${colors.accent}35, inset 0 1px 0 rgba(255,255,255,0.07)`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = `0 4px 28px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.05)`
      }}
    >

      {/* Card header with accent colour */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 15px',
        background: `linear-gradient(90deg, ${colors.bg} 0%, rgba(0,0,0,0) 100%)`,
        borderBottom: `1px solid ${colors.accent}18`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#333', fontWeight: 700 }}>
            {String(index + 1).padStart(2, '0')}
          </span>
          <span style={{
            fontSize: 14, fontWeight: 700, color: colors.accent,
            fontFamily: "'Figtree', sans-serif", letterSpacing: '-0.02em',
          }}>
            {shotMeta.label}
          </span>
          {frame.section && (
            <span style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 99,
              background: `${colors.accent}14`, color: colors.accent,
              border: `1px solid ${colors.accent}22`,
            }}>
              {frame.section}
            </span>
          )}
        </div>
        <button onClick={() => setEditing(!editing)} style={{
          background: editing ? `${colors.accent}18` : 'none',
          border: `1px solid ${editing ? colors.accent + '35' : 'transparent'}`,
          borderRadius: 6, cursor: 'pointer', padding: '4px 7px',
          color: editing ? colors.accent : '#444',
          display: 'flex', alignItems: 'center',
          transition: 'all 0.15s',
        }}>
          <Edit2 size={11}/>
        </button>
      </div>

      {/* SVG storyboard frame */}
      <div style={{ lineHeight: 0, position: 'relative' }}
        dangerouslySetInnerHTML={{ __html: svgString }}
      />

      {/* Edit panel */}
      {editing && (
        <div style={{
          padding: 14,
          borderTop: `1px solid ${colors.accent}18`,
          background: `linear-gradient(180deg, ${colors.bg} 0%, rgba(0,0,0,0) 100%)`,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 5 }}>Shot type</label>
            <select value={shotType} onChange={e => setShotType(e.target.value)} style={{
              width: '100%', background: '#07090f', border: `1px solid ${colors.accent}22`,
              borderRadius: 7, padding: '7px 10px', fontSize: 12, color: '#ccc', outline: 'none',
            }}>
              {SHOT_TYPES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 5 }}>Director notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{
              width: '100%', background: '#07090f', border: `1px solid ${colors.accent}22`,
              borderRadius: 7, padding: '7px 10px', fontSize: 12, color: '#ccc',
              outline: 'none', resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
            }}/>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, padding: '5px 12px', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${colors.accent}40`, color: colors.accent, background: `${colors.accent}12`,
            }}>
              <Check size={9}/> Save
            </button>
            <button onClick={() => setEditing(false)} style={{ fontSize: 11, color: '#444', background: 'none', border: 'none', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Description */}
      <div style={{ padding: '13px 15px 15px', borderTop: `1px solid rgba(255,255,255,0.04)` }}>
        <p style={{ fontSize: 14, color: '#c8ccd6', lineHeight: 1.6, margin: 0 }}>
          {frame.description}
        </p>
        {frame.notes && !editing && (
          <p style={{ fontSize: 12, color: colors.accent, lineHeight: 1.5, margin: '8px 0 0', fontStyle: 'italic', opacity: 0.7 }}>
            {frame.notes}
          </p>
        )}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          marginTop: 10, padding: '4px 10px', borderRadius: 99,
          background: `${colors.accent}0c`, border: `1px solid ${colors.accent}1a`,
        }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: colors.accent, opacity: 0.8 }}/>
          <span style={{ fontSize: 10, color: colors.accent, opacity: 0.7 }}>{shotMeta.desc}</span>
        </div>
      </div>
    </div>
  )
}