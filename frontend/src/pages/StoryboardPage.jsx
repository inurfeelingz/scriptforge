// frontend/src/pages/StoryboardPage.jsx
// Visual shot list — vector storyboard frames with clip matching

import { useState, useEffect, useCallback } from 'react'
import { Film, Wand2, Download, Edit2, Check, X, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { api } from '../lib/api'
import { getShotSVG, SHOT_TYPES } from '../lib/storyboardSVG'

const GENDER_OPTIONS = [
  { value: 'male',   label: 'Male' },
  { value: 'female', label: 'Female' },
]

export default function StoryboardPage() {
  const { activeCategoryId, notify } = useStore()
  const [episodes,    setEpisodes]    = useState([])
  const [storyboards, setStoryboards] = useState([])
  const [active,      setActive]      = useState(null)   // { storyboard, frames }
  const [generating,  setGenerating]  = useState(false)
  const [selectedEp,  setSelectedEp]  = useState('')
  const [gender,      setGender]      = useState('male')

  useEffect(() => {
    if (!activeCategoryId) return
    // Load recent episodes for the picker
    api.get(`/episodes?categoryId=${activeCategoryId}&limit=20`)
      .then(d => setEpisodes(d.episodes || []))
      .catch(() => {})
    // Load existing storyboards
    api.get(`/storyboard?categoryId=${activeCategoryId}`)
      .then(d => setStoryboards(d.storyboards || []))
      .catch(() => {})
  }, [activeCategoryId])

  async function generate() {
    if (!selectedEp || generating) return
    setGenerating(true)
    try {
      const result = await api.post('/storyboard/generate', {
        episodeId:  selectedEp,
        categoryId: activeCategoryId,
        gender,
        maxFrames:  20,
      })
      setActive(result)
      setStoryboards(prev => [result.storyboard, ...prev])
      notify(`Storyboard generated — ${result.frames.length} shots`, 'success')
    } catch (err) {
      notify(err.message || 'Generation failed', 'error')
    } finally {
      setGenerating(false)
    }
  }

  async function loadStoryboard(id) {
    try {
      const result = await api.get(`/storyboard/${id}`)
      setActive(result)
    } catch (err) { notify(err.message || 'Could not load storyboard', 'error') }
  }

  async function deleteStoryboard(id, e) {
    e.stopPropagation()
    if (!confirm('Delete this storyboard?')) return
    try {
      await api.delete(`/storyboard/${id}`)
      setStoryboards(prev => prev.filter(s => s.id !== id))
      notify('Storyboard deleted', 'success')
    } catch { notify('Could not delete', 'error') }
  }

  async function updateFrame(frameId, updates) {
    const { frame } = await api.patch(`/storyboard/frame/${frameId}`, updates)
    setActive(prev => ({
      ...prev,
      frames: prev.frames.map(f => f.id === frameId ? { ...f, ...frame } : f)
    }))
  }

  function downloadSVG() {
    if (!active) return
    // Build a multi-frame SVG document
    const cols = 3
    const fw = 320, fh = 180, pad = 20
    const rows = Math.ceil(active.frames.length / cols)
    const totalW = cols * (fw + pad) + pad
    const totalH = rows * (fh + pad + 60) + pad

    const cells = active.frames.map((frame, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const tx  = pad + col * (fw + pad)
      const ty  = pad + row * (fh + pad + 60)
      const shotSvg = getShotSVG(frame.shot_type, frame.gender)
      // Extract inner content from SVG string
      const inner = shotSvg.replace(/<svg[^>]*>/, '').replace('</svg>', '')
      return `
        <g transform="translate(${tx},${ty})">
          ${inner}
          <text x="4" y="${fh + 14}" font-family="monospace" font-size="9" fill="#c8b89a">${i+1}. ${frame.description?.slice(0,55) || ''}</text>
          <text x="4" y="${fh + 28}" font-family="monospace" font-size="8" fill="#666">${frame.notes?.slice(0,60) || ''}</text>
          ${frame.matched_clip ? `<text x="4" y="${fh + 42}" font-family="monospace" font-size="8" fill="#6a9a6a">✓ ${frame.matched_clip.filename?.slice(0,40)}</text>` : ''}
        </g>`
    }).join('\n')

    const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" style="background:#06060a">
      <rect width="${totalW}" height="${totalH}" fill="#06060a"/>
      <text x="${pad}" y="${pad - 4}" font-family="monospace" font-size="14" fill="#c8b89a">${active.storyboard.title}</text>
      ${cells}
    </svg>`

    const blob = new Blob([fullSvg], { type: 'image/svg+xml' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `storyboard-${active.storyboard.title.replace(/\s+/g,'-').toLowerCase()}.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-[#f0ede8]">Storyboard</h1>
          <p className="text-sm text-[#555] mt-1">Shot list with framing reference — use as a shoot guide</p>
        </div>
        {active && (
          <button onClick={downloadSVG}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-all"
              style={{ borderColor: '#c8b89a30', color: '#c8b89a', background: '#c8b89a08' }}>
              <Download size={11}/>
              Export SVG
            </button>
        )}
      </div>

      {/* Generate panel */}
      <div className="border border-[#1a1a1a] rounded-lg p-4 bg-[#080808] space-y-3">
        <div className="text-xs text-[#555] uppercase tracking-widest">Generate from episode</div>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-48">
            <label className="text-[10px] text-[#444] block mb-1">Episode</label>
            <select value={selectedEp} onChange={e => setSelectedEp(e.target.value)}
              className="w-full bg-[#0d0d0d] border border-[#1a1a1a] rounded px-3 py-2 text-xs text-[#ccc] outline-none">
              <option value="">Select an episode...</option>
              {episodes.map(ep => (
                <option key={ep.id} value={ep.id}>{ep.track_name || ep.title}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-[#444] block mb-1">Subject</label>
            <div className="flex gap-1">
              {GENDER_OPTIONS.map(g => (
                <button key={g.value} onClick={() => setGender(g.value)}
                  className="text-xs px-3 py-2 rounded border transition-all"
                  style={{
                    borderColor: gender === g.value ? '#c8b89a50' : '#1a1a1a',
                    color:       gender === g.value ? '#c8b89a' : '#555',
                    background:  gender === g.value ? '#c8b89a10' : 'transparent',
                  }}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={generate} disabled={!selectedEp || generating}
            className="flex items-center gap-2 px-4 py-2 rounded border text-xs transition-all disabled:opacity-30"
            style={{ borderColor: '#c8b89a30', color: '#c8b89a', background: '#c8b89a08' }}>
            <Wand2 size={11} className={generating ? 'animate-pulse' : ''}/>
            {generating ? 'Generating...' : 'Generate storyboard'}
          </button>
        </div>
      </div>

      {/* Past storyboards */}
      {!active && storyboards.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[#444]">Past storyboards</div>
          {storyboards.map(sb => (
            <div key={sb.id}
              className="w-full px-4 py-3 border border-[#1a1a1a] rounded-lg bg-[#080808] hover:border-[#c8b89a30] transition-all flex items-center gap-3 cursor-pointer"
              onClick={() => loadStoryboard(sb.id)}>
              <Film size={13} className="text-[#444] shrink-0"/>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#ccc] truncate">{sb.title}</div>
                <div className="text-[10px] text-[#444] mt-0.5">
                  {new Date(sb.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                </div>
              </div>
              <button
                onClick={e => deleteStoryboard(sb.id, e)}
                className="text-[#333] hover:text-red-400 transition-colors p-1 flex-shrink-0"
                title="Delete storyboard"
              >
                <Trash2 size={13}/>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Active storyboard */}
      {active && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg text-[#f0ede8] font-serif">{active.storyboard.title}</h2>
            <button onClick={() => setActive(null)} className="text-[#444] hover:text-[#888] text-xs">
              ← Back to list
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.frames.map((frame, i) => (
              <StoryboardFrame
                key={frame.id}
                frame={frame}
                index={i}
                onUpdate={updates => updateFrame(frame.id, updates)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Shot type reference */}
      {!active && storyboards.length === 0 && !activeCategoryId && (
        <div className="text-sm text-[#444] text-center py-12">Select a workspace to get started</div>
      )}
    </div>
  )
}

// ── FRAME CARD ─────────────────────────────────────────────────────────────────
function StoryboardFrame({ frame, index, onUpdate }) {
  const [editing,  setEditing]  = useState(false)
  const [notes,    setNotes]    = useState(frame.notes || '')
  const [shotType, setShotType] = useState(frame.shot_type)
  const [expanded, setExpanded] = useState(false)

  const shotLabel = SHOT_TYPES.find(s => s.id === frame.shot_type)?.label || frame.shot_type
  const svgString = getShotSVG(shotType, frame.gender)
  const hasClip   = !!frame.matched_clip

  async function save() {
    await onUpdate({ shot_type: shotType, notes })
    setEditing(false)
  }

  return (
    <div className="border border-[#1a1a1a] rounded-lg overflow-hidden bg-[#080808] hover:border-[#c8b89a20] transition-all">
      {/* Frame number + shot type */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#111]">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#444] font-mono">{String(index + 1).padStart(2,'0')}</span>
          <span className="text-[10px] text-[#c8b89a]">{shotLabel}</span>
          {frame.section && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[#444]">{frame.section}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasClip && <span className="text-[9px] text-[#6a9a6a]">✓ clip</span>}
          <button onClick={() => setEditing(!editing)} className="text-[#333] hover:text-[#888] transition-colors">
            <Edit2 size={10}/>
          </button>
        </div>
      </div>

      {/* SVG frame */}
      <div
        className="relative"
        dangerouslySetInnerHTML={{ __html: svgString }}
        style={{ lineHeight: 0 }}
      />

      {/* Edit panel */}
      {editing && (
        <div className="p-3 border-t border-[#111] space-y-2 bg-[#0a0a0f]">
          <div>
            <label className="text-[9px] text-[#444] uppercase tracking-wider block mb-1">Shot type</label>
            <select value={shotType} onChange={e => setShotType(e.target.value)}
              className="w-full bg-[#111] border border-[#1a1a1a] rounded px-2 py-1 text-[11px] text-[#ccc] outline-none">
              {SHOT_TYPES.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[9px] text-[#444] uppercase tracking-wider block mb-1">Director notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full bg-[#111] border border-[#1a1a1a] rounded px-2 py-1 text-[11px] text-[#ccc] outline-none resize-none"/>
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-[#c8b89a30] text-[#c8b89a]">
              <Check size={9}/> Save
            </button>
            <button onClick={() => setEditing(false)} className="text-[10px] text-[#444]">Cancel</button>
          </div>
        </div>
      )}

      {/* Description + notes */}
      <div className="px-3 py-2 space-y-1">
        <p className="text-[11px] text-[#bbb] leading-snug">{frame.description}</p>
        {frame.notes && !editing && (
          <p className="text-[10px] text-[#555] leading-snug italic">{frame.notes}</p>
        )}
        {hasClip && (
          <div className="text-[9px] text-[#6a9a6a] mt-1 flex items-center gap-1">
            <Film size={8}/> {frame.matched_clip?.filename}
          </div>
        )}
      </div>
    </div>
  )
}