// frontend/src/components/episode/StoryboardTab.jsx
// Storyboard tab within EpisodePage — generates and shows shot list for this episode.

import { useState, useEffect } from 'react'
import { Film, Wand2, Trash2, ChevronRight, Camera } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../lib/api'

const SHOT_META = {
  ecu: { label: 'Extreme Close-Up', abbr: 'ECU', color: '#e05580' },
  cu:  { label: 'Close-Up',         abbr: 'CU',  color: '#e07840' },
  mcu: { label: 'Medium Close-Up',  abbr: 'MCU', color: 'rgba(74,222,128,1)' },
  ms:  { label: 'Medium Shot',      abbr: 'MS',  color: '#6ab87a' },
  mws: { label: 'Medium Wide',      abbr: 'MWS', color: '#5ab0d4' },
  ws:  { label: 'Wide Shot',        abbr: 'WS',  color: '#7878d8' },
  ews: { label: 'Extreme Wide',     abbr: 'EWS', color: '#a060c8' },
  ots: { label: 'Over Shoulder',    abbr: 'OTS', color: '#d45870' },
  th:  { label: 'Talking Head',     abbr: 'TH',  color: 'rgba(74,222,128,1)' },
  pov: { label: 'Point of View',    abbr: 'POV', color: '#80c870' },
}

export default function StoryboardTab({ episode, onUpdate }) {
  const { activeCategoryId, notify } = useStore()
  const [active,     setActive]     = useState(null)
  const [generating, setGenerating] = useState(false)
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    if (!episode?.id) return
    setLoading(true)
    api.get(`/storyboard?categoryId=${activeCategoryId}&episodeId=${episode.id}`)
      .then(d => {
        const boards = d.storyboards || []
        if (boards.length) return api.get(`/storyboard/${boards[0].id}`)
        return null
      })
      .then(result => { if (result) setActive(result) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [episode?.id])

  async function generate() {
    if (!episode?.id || generating) return
    setGenerating(true)
    try {
      const result = await api.post('/storyboard/generate', {
        episodeId: episode.id, categoryId: activeCategoryId, maxFrames: 20,
      })
      setActive(result)
      notify(`Shot list generated — ${result.frames?.length} shots`, 'success')
    } catch (err) {
      notify(err.message || 'Generation failed', 'error')
    } finally { setGenerating(false) }
  }

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13, fontFamily: "'Figtree',sans-serif" }}>
      Loading shot list...
    </div>
  )

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree',sans-serif" }}>
          {active?.frames?.length ? `${active.frames.length} shots` : 'No shot list yet'}
        </div>
        <button
          onClick={generate}
          disabled={generating || !episode?.vo_script}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.07)', color: generating ? 'rgba(255,255,255,0.3)' : 'rgba(74,222,128,0.8)', cursor: generating ? 'wait' : 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
        >
          <Wand2 size={12}/> {generating ? 'Generating...' : active ? 'Regenerate' : 'Generate shot list'}
        </button>
      </div>

      {!episode?.vo_script && !active && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13, fontFamily: "'Figtree',sans-serif", border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
          Generate a script first — the shot list is built from your VO script.
        </div>
      )}

      {active?.frames?.map((frame, i) => {
        const shot = SHOT_META[frame.shot_type] || { label: frame.shot_type, abbr: frame.shot_type?.toUpperCase(), color: '#888' }
        return (
          <div key={frame.id || i} style={{ display: 'flex', gap: 12, padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: shot.color + '15', border: `1px solid ${shot.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, color: shot.color, flexShrink: 0, fontFamily: "'Syne',sans-serif", textAlign: 'center' }}>
              {i + 1}<br/>{shot.abbr}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: shot.color, fontFamily: "'Figtree',sans-serif", marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {shot.label} {frame.section ? `· ${frame.section}` : ''}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.55 }}>
                {frame.description}
              </div>
              {frame.notes && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 4 }}>
                  {frame.notes}
                </div>
              )}
              {frame.matched_clip && (
                <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.5)', fontFamily: "'Figtree',sans-serif", marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Camera size={9}/> {frame.matched_clip.filename}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}