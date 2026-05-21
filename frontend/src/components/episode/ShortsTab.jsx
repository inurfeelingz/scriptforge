// frontend/src/components/episode/ShortsTab.jsx
// Shorts/Reels script generator tab within EpisodePage.

import { useState, useEffect } from 'react'
import { Sparkles, RefreshCw, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '../../store'
import { episodes as episodesApi, shorts as shortsApi } from '../../lib/api'

function useCopy() {
  const [copied, setCopied] = useState(null)
  function copy(text, id) {
    navigator.clipboard.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(null), 2000) })
  }
  return { copied, copy }
}

function ShortCard({ short, index }) {
  const { copied, copy } = useCopy()
  const [expanded, setExpanded] = useState(index === 0)

  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden', marginBottom: 8 }}>
      <button onClick={() => setExpanded(e => !e)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'rgba(74,222,128,0.8)', flexShrink: 0 }}>
          {index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: "'Figtree',sans-serif", marginBottom: 2 }}>{short.title}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>
            {short.hookStrategy} · {short.wordCount || '~'} words
          </div>
        </div>
        {expanded ? <ChevronUp size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}/> : <ChevronDown size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }}/>}
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '14px', background: 'rgba(255,255,255,0.01)' }}>
          {short.hook && (
            <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.1)', background: 'rgba(74,222,128,0.03)', marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: 'rgba(74,222,128,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>Opening hook</div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>"{short.hook}"</p>
            </div>
          )}
          {short.script && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif" }}>Full script</div>
                <button onClick={() => copy(short.script, `script-${index}`)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.07)', background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif" }}>
                  {copied === `script-${index}` ? <><Check size={10}/> Copied</> : <><Copy size={10}/> Copy</>}
                </button>
              </div>
              <pre style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {short.script}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ShortsTab({ episode, onUpdate }) {
  const { activeCategoryId, notify } = useStore()
  const [shorts,     setShorts]     = useState([])
  const [generating, setGenerating] = useState(false)
  const [loading,    setLoading]    = useState(false)

  useEffect(() => {
    if (!episode?.id) return
    setLoading(true)
    shortsApi.list({ episodeId: episode.id }).then(d => setShorts(d.shorts || [])).catch(() => {}).finally(() => setLoading(false))
  }, [episode?.id])

  async function generate() {
    if (!episode?.id || generating) return
    setGenerating(true)
    try {
      const result = await shortsApi.generate({ episodeId: episode.id, categoryId: activeCategoryId })
      setShorts(result.shorts || [])
      notify(`${result.shorts?.length || 0} short scripts generated`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    } finally { setGenerating(false) }
  }

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree',sans-serif" }}>
          {loading ? 'Loading...' : shorts.length ? `${shorts.length} shorts scripts` : 'No shorts yet'}
        </div>
        <button
          onClick={generate}
          disabled={generating || !episode?.vo_script}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.2)', background: 'rgba(74,222,128,0.07)', color: generating ? 'rgba(255,255,255,0.3)' : 'rgba(74,222,128,0.8)', cursor: generating ? 'wait' : 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
        >
          <Sparkles size={12}/> {generating ? 'Generating...' : shorts.length ? 'Regenerate' : 'Generate shorts'}
        </button>
      </div>

      {!episode?.vo_script && !shorts.length && (
        <div style={{ padding: '24px', textAlign: 'center', color: 'rgba(255,255,255,0.2)', fontSize: 13, fontFamily: "'Figtree',sans-serif", border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10 }}>
          Generate a script first — shorts are clipped from your VO script.
        </div>
      )}

      {shorts.map((s, i) => <ShortCard key={s.id || i} short={s} index={i} />)}
    </div>
  )
}