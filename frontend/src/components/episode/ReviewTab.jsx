// frontend/src/components/episode/ReviewTab.jsx
// Retention review tab within EpisodePage — retention curve overlaid on VO script.
// Same logic as EpisodeReview.jsx but receives episode directly.

import { useState, useEffect } from 'react'
import { Upload, Check, TrendingDown, TrendingUp, Copy } from 'lucide-react'
import { useStore } from '../../store'
import { analytics as analyticsApi, chat as chatApi, episodeComments as commentsApi } from '../../lib/api'

function retentionColor(pct) {
  if (pct == null) return { bg: 'transparent', text: '#555', border: 'transparent' }
  if (pct >= 70) return { bg: 'rgba(64,160,96,0.10)',  text: '#40a060', border: 'rgba(64,160,96,0.25)' }
  if (pct >= 50) return { bg: 'rgba(200,160,48,0.10)', text: '#c8a030', border: 'rgba(200,160,48,0.25)' }
  if (pct >= 35) return { bg: 'rgba(224,120,48,0.10)', text: '#e07830', border: 'rgba(224,120,48,0.25)' }
  return               { bg: 'rgba(224,80,80,0.10)',   text: '#e05050', border: 'rgba(224,80,80,0.25)' }
}

function getRetentionAt(curve, targetSec) {
  if (!curve || !Object.keys(curve).length) return null
  const keys = Object.keys(curve).map(Number).sort((a, b) => a - b)
  const closest = keys.reduce((prev, curr) => Math.abs(curr - targetSec) < Math.abs(prev - targetSec) ? curr : prev)
  return curve[closest] ?? null
}

export default function ReviewTab({ episode, onUpdate }) {
  const { activeCategoryId, notify } = useStore()
  const [data,          setData]         = useState(null)
  const [loading,       setLoading]      = useState(true)
  const [curveInput,    setCurveInput]   = useState('')
  const [savingCurve,   setSavingCurve]  = useState(false)
  const [showCurve,     setShowCurve]    = useState(false)
  const [thumbLoading,  setThumbLoading] = useState(false)
  const [thumbResult,   setThumbResult]  = useState(null)
  const [copied,        setCopied]       = useState(null)
  const [comments,      setComments]     = useState([])
  const [newComment,    setNewComment]   = useState('')
  const [addingComment, setAddingComment]= useState(false)

  useEffect(() => {
    if (!episode?.id) return
    setLoading(true)
    analyticsApi.episodeRetention(episode.id).then(setData).catch(() => {}).finally(() => setLoading(false))
  }, [episode?.id])

  useEffect(() => {
    if (!episode?.id) return
    commentsApi.list(episode.id).then(d => setComments(d.comments || [])).catch(() => {})
  }, [episode?.id])

  async function submitComment() {
    if (!newComment.trim() || !episode?.id) return
    setAddingComment(true)
    try {
      const { comment } = await commentsApi.add(episode.id, { content: newComment.trim() })
      setComments(prev => [...prev, comment])
      setNewComment('')
    } catch {}
    setAddingComment(false)
  }

  async function resolveComment(id) {
    const { comment } = await commentsApi.resolve(id)
    setComments(prev => prev.map(c => c.id === id ? comment : c))
  }

  async function removeComment(id) {
    await commentsApi.remove(id)
    setComments(prev => prev.filter(c => c.id !== id))
  }

  async function saveCurve() {
    if (!curveInput.trim()) return
    setSavingCurve(true)
    try {
      await analyticsApi.saveRetentionCurve(episode.id, curveInput.trim())
      notify('Retention curve saved', 'success')
      const fresh = await analyticsApi.episodeRetention(episode.id)
      setData(fresh); setShowCurve(false)
    } catch (err) { notify(err.message, 'error') }
    finally { setSavingCurve(false) }
  }

  async function generateThumbnailPrompt() {
    if (!episode?.id || !activeCategoryId) return
    setThumbLoading(true)
    try {
      const result = await chatApi.thumbnailPrompt({ categoryId: activeCategoryId, episodeId: episode.id })
      setThumbResult(result)
    } catch (err) { notify('Thumbnail prompt failed: ' + err.message, 'error') }
    setThumbLoading(false)
  }

  function copyText(text, id) {
    navigator.clipboard.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(null), 2000) })
  }

  const ep     = data?.episode
  const curve  = ep?.retention_curve_map || {}
  const lines  = parseScript(ep?.vo_script || episode?.vo_script || '')
  const score  = ep?.yt_retention_score || episode?.yt_retention_score

  return (
    <div style={{ padding: '20px 0' }}>

      {/* Score + curve upload */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {score > 0 && (
          <div style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.15)', background: 'rgba(74,222,128,0.04)' }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'rgba(74,222,128,0.9)', fontFamily: "'Syne',sans-serif" }}>{score}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginLeft: 6 }}>/100 retention</span>
          </div>
        )}
        <button
          onClick={() => setShowCurve(s => !s)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
        >
          <Upload size={11}/> {Object.keys(curve).length ? 'Update retention curve' : 'Upload retention curve'}
        </button>
      </div>

      {/* Curve input */}
      {showCurve && (
        <div style={{ marginBottom: 20, padding: 14, borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginBottom: 8 }}>
            Paste YouTube retention curve JSON: {"{ \"0\": 100, \"30\": 87, \"60\": 71 ... }"}
          </div>
          <textarea
            value={curveInput}
            onChange={e => setCurveInput(e.target.value)}
            rows={3}
            style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '8px 10px', color: 'rgba(255,255,255,0.6)', fontSize: 12, fontFamily: 'monospace', outline: 'none', resize: 'vertical', marginBottom: 8 }}
          />
          <button onClick={saveCurve} disabled={savingCurve || !curveInput.trim()} style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: 'rgba(74,222,128,1)', color: '#080808', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}>
            {savingCurve ? 'Saving...' : 'Save curve'}
          </button>
        </div>
      )}

      {/* Script with retention overlay */}
      {lines.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 12 }}>
            Script {Object.keys(curve).length ? '· colour-coded by retention' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {lines.map((line, i) => {
              const ret    = getRetentionAt(curve, line.sec)
              const colors = retentionColor(ret)
              return (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 10px', borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.bg, transition: 'all 0.15s' }}>
                  {line.timecode && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontFamily: 'monospace', flexShrink: 0, paddingTop: 2 }}>{line.timecode}</span>}
                  <span style={{ fontSize: 13, color: ret != null ? colors.text : 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.6 }}>{line.text}</span>
                  {ret != null && <span style={{ fontSize: 10, color: colors.text, fontFamily: 'monospace', flexShrink: 0, marginLeft: 'auto', paddingTop: 2 }}>{Math.round(ret)}%</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Thumbnail prompt */}
      <div style={{ padding: '16px', borderRadius: 10, border: '1px solid rgba(74,222,128,0.1)', background: 'rgba(74,222,128,0.02)', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: thumbResult ? 12 : 0 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Thumbnail Intelligence</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>Flux prompt + title options targeted to your audience</div>
          </div>
          <button
            onClick={generateThumbnailPrompt}
            disabled={thumbLoading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.07)', color: 'rgba(74,222,128,0.8)', cursor: thumbLoading ? 'wait' : 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
          >
            {thumbLoading ? 'Generating...' : '✦ Generate prompt'}
          </button>
        </div>

        {thumbResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>Flux Prompt</div>
              <div
                onClick={() => { navigator.clipboard.writeText(thumbResult.fluxPrompt); notify('Copied', 'success') }}
                style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.65, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', userSelect: 'all' }}
                title="Click to copy"
              >
                {thumbResult.fluxPrompt}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 4 }}>Click to copy · paste into Flux, Ideogram, or Midjourney</div>
            </div>
            {thumbResult.titleOptions?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>Title Options</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {thumbResult.titleOptions.map((title, i) => (
                    <div key={i} onClick={() => { navigator.clipboard.writeText(title); notify('Copied', 'success') }}
                      style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', fontFamily: "'Figtree',sans-serif", padding: '8px 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', cursor: 'pointer' }}
                      title="Click to copy"
                    >
                      {title}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Collaboration notes */}
      <div style={{ marginTop: 24, padding: '16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", marginBottom: 14 }}>
          Collaboration notes {comments.length > 0 ? `(${comments.length})` : ''}
        </div>

        {comments.length === 0 && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginBottom: 12 }}>
            No notes yet. Leave feedback for yourself or collaborators.
          </div>
        )}

        {comments.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: c.resolved ? 0.4 : 1 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.55, textDecoration: c.resolved ? 'line-through' : 'none' }}>
                {c.content}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif", marginTop: 3 }}>
                {new Date(c.created_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={() => resolveComment(c.id)} title={c.resolved ? 'Unresolve' : 'Resolve'} style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: c.resolved ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.2)', padding: '2px 4px' }}>
                {c.resolved ? '✓' : '○'}
              </button>
              <button onClick={() => removeComment(c.id)} title="Delete" style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,100,100,0.3)', padding: '2px 4px' }}>
                ×
              </button>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submitComment()}
            placeholder="Add a note..."
            style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '8px 10px', color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: "'Figtree',sans-serif", outline: 'none' }}
          />
          <button
            onClick={submitComment}
            disabled={!newComment.trim() || addingComment}
            style={{ padding: '8px 14px', borderRadius: 7, border: 'none', background: newComment.trim() ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.06)', color: newComment.trim() ? '#080808' : 'rgba(255,255,255,0.2)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
          >
            Add
          </button>
        </div>
      </div>

      {loading && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif" }}>Loading...</div>}
    </div>
  )
}

function parseScript(script) {
  if (!script) return []
  return script.split('\n').filter(l => l.trim()).map(line => {
    const tcMatch = line.match(/\[(\d+):(\d+)\]/)
    const sec     = tcMatch ? parseInt(tcMatch[1]) * 60 + parseInt(tcMatch[2]) : null
    const text    = line.replace(/\[\d+:\d+\]/g, '').trim()
    return { text, timecode: tcMatch?.[0], sec }
  }).filter(l => l.text)
}