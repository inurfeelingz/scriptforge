// frontend/src/pages/ShortsPage.jsx
// Batch 5 — improvements 11 + 13:
//  11 — Thumbnail concept generator (3 concepts per episode, with A/B variants)
//  13 — Shorts/Reels script generator (3 standalone 45-60s scripts per episode)

import { useState, useEffect } from 'react'
import {
  Sparkles, RefreshCw, Download, Copy, Check,
  Film, Image, ChevronDown, ChevronUp, Zap,
} from 'lucide-react'
import { useStore } from '../store'
import { episodes as episodesApi, shorts as shortsApi } from '../lib/api'

// ── Copy-to-clipboard hook ────────────────────────────────────────────────────
function useCopy() {
  const [copied, setCopied] = useState(null)
  function copy(text, id) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied(null), 2000)
    })
  }
  return { copied, copy }
}

// ── Short card ────────────────────────────────────────────────────────────────
function ShortCard({ short, index }) {
  const { copied, copy } = useCopy()
  const [expanded, setExpanded] = useState(index === 0)

  return (
    <div className="border border-[var(--border)] rounded overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface)] transition-colors"
      >
        <div className="w-6 h-6 rounded bg-[var(--accent)]/10 border border-[var(--accent)]/20 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-[var(--accent)]">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text)] truncate">{short.title}</div>
          <div className="text-xs text-[var(--text3)] mt-0.5">
            {short.hookStrategy} · {short.wordCount || '~'} words · {short.sourceTimecode || ''}
          </div>
        </div>
        {expanded ? <ChevronUp size={13} className="text-[var(--text3)] shrink-0"/> : <ChevronDown size={13} className="text-[var(--text3)] shrink-0"/>}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] p-4 space-y-4 bg-[#060606]">

          {/* Hook callout */}
          <div className="bg-[var(--accent)]/5 border border-[var(--accent)]/15 rounded p-3">
            <div className="text-[10px] text-[var(--accent)]/60 uppercase tracking-wider mb-1.5">Opening hook</div>
            <p className="text-sm text-[#ddd] leading-relaxed italic">"{short.hook}"</p>
          </div>

          {/* Full script */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Full script</div>
              <button
                onClick={() => copy(short.script, `script-${short.id}`)}
                className="flex items-center gap-1.5 text-[10px] text-[var(--text3)] hover:text-[var(--accent)] transition-colors"
              >
                {copied === `script-${short.id}` ? <Check size={10}/> : <Copy size={10}/>}
                {copied === `script-${short.id}` ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="text-sm text-[var(--text2)] leading-relaxed whitespace-pre-wrap font-mono bg-[var(--surface)] border border-[var(--border)] rounded p-3 text-xs">
              {short.script}
            </div>
          </div>

          {/* CTA + thumbnail concept */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">CTA</div>
              <div className="text-xs text-[var(--text2)] bg-[var(--surface)] border border-[var(--border)] rounded p-2">
                {short.cta}
              </div>
            </div>
            {short.thumbnailConcept && (
              <div className="space-y-1">
                <div className="text-[10px] text-[var(--text3)] uppercase tracking-wider">Thumbnail brief</div>
                <div className="text-xs text-[var(--text2)] bg-[var(--surface)] border border-[var(--border)] rounded p-2">
                  {short.thumbnailConcept}
                </div>
              </div>
            )}
          </div>

          {/* Download button */}
          <button
            onClick={() => {
              const blob = new Blob([`${short.title}\n\n${short.script}\n\nCTA: ${short.cta}`], { type: 'text/plain' })
              const url  = URL.createObjectURL(blob)
              const a    = document.createElement('a'); a.href = url
              a.download = `short-${index + 1}-${short.title.replace(/\s+/g, '-').toLowerCase()}.txt`
              a.click(); URL.revokeObjectURL(url)
            }}
            className="flex items-center gap-1.5 text-xs text-[var(--text3)] hover:text-[var(--accent)] transition-colors"
          >
            <Download size={11}/> Download script
          </button>
        </div>
      )}
    </div>
  )
}

// ── Thumbnail concept card ────────────────────────────────────────────────────
function ThumbnailCard({ concept, index }) {
  const { copied, copy } = useCopy()
  const [expanded, setExpanded] = useState(index === 0)

  return (
    <div className="border border-[var(--border)] rounded overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface)] transition-colors"
      >
        <div className="w-6 h-6 rounded bg-[#60a5fa]/10 border border-[#60a5fa]/20 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-[#60a5fa]">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text)]">{concept.label}</div>
          <div className="text-xs text-[var(--text3)] mt-0.5">{concept.strategy}</div>
        </div>
        {expanded ? <ChevronUp size={13} className="text-[var(--text3)] shrink-0"/> : <ChevronDown size={13} className="text-[var(--text3)] shrink-0"/>}
      </button>

      {expanded && (
        <div className="border-t border-[var(--border)] p-4 space-y-3 bg-[#060606]">

          {/* Text overlay — the most important element */}
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-[var(--surface)] border border-[var(--border2)] rounded p-3 text-center">
              <div className="text-[10px] text-[var(--text3)] mb-1">Text overlay</div>
              <div className="text-lg font-bold text-white tracking-tight leading-tight">
                {concept.overlayText}
              </div>
            </div>
            {concept.abTestVariant && (
              <div className="flex-1 bg-[var(--surface)] border border-dashed border-[var(--border2)] rounded p-3 text-center">
                <div className="text-[10px] text-[var(--text3)] mb-1">A/B variant</div>
                <div className="text-lg font-bold text-[var(--text2)] tracking-tight leading-tight">
                  {concept.abTestVariant.overlayText}
                </div>
                <div className="text-[10px] text-[var(--text3)] mt-1">{concept.abTestVariant.change}</div>
              </div>
            )}
          </div>

          {/* Details grid */}
          <div className="space-y-2 text-xs">
            {[
              { label: 'Visual',      value: concept.visualDescription },
              { label: 'Expression',  value: concept.facialExpression  },
              { label: 'Colours',     value: concept.colourDirection   },
              { label: 'Why it works',value: concept.whyItWorks        },
            ].filter(d => d.value).map(({ label, value }) => (
              <div key={label} className="flex gap-3">
                <span className="w-20 shrink-0 text-[var(--text3)] pt-0.5">{label}</span>
                <span className="text-[var(--text2)] flex-1">{value}</span>
              </div>
            ))}
          </div>

          {/* Copy brief */}
          <button
            onClick={() => copy(
              `Thumbnail concept ${index + 1}: ${concept.label}\nStrategy: ${concept.strategy}\nText overlay: "${concept.overlayText}"\nVisual: ${concept.visualDescription}\nExpression: ${concept.facialExpression}\nColours: ${concept.colourDirection}\nA/B variant: "${concept.abTestVariant?.overlayText}" (${concept.abTestVariant?.change})`,
              `thumb-${concept.id}`
            )}
            className="flex items-center gap-1.5 text-xs text-[var(--text3)] hover:text-[#60a5fa] transition-colors"
          >
            {copied === `thumb-${concept.id}` ? <Check size={10}/> : <Copy size={10}/>}
            {copied === `thumb-${concept.id}` ? 'Copied to clipboard' : 'Copy brief for Canva'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ShortsPage() {
  const { activeCategoryId, activeCategory, notify } = useStore()
  const cat = activeCategory?.()

  const [episodes,         setEpisodes]         = useState([])
  const [selectedEpId,     setSelectedEpId]     = useState('')
  const [selectedEp,       setSelectedEp]       = useState(null)
  const [loadingEps,       setLoadingEps]       = useState(true)

  // Shorts state
  const [shorts,           setShorts]           = useState([])
  const [generatingShorts, setGeneratingShorts] = useState(false)

  // Thumbnail state
  const [thumbConcepts,    setThumbConcepts]    = useState([])
  const [generatingThumbs, setGeneratingThumbs] = useState(false)

  // Active tab
  const [tab, setTab] = useState('shorts')  // 'shorts' | 'thumbnails'

  // Load episodes
  useEffect(() => {
    if (!activeCategoryId) return
    setLoadingEps(true)
    episodesApi.list({ categoryId: activeCategoryId, limit: 50 })
      .then(({ episodes: eps }) => {
        setEpisodes(eps || [])
        if (eps?.length) setSelectedEpId(eps[0].id)
      })
      .catch(() => {})
      .finally(() => setLoadingEps(false))
  }, [activeCategoryId])

  // Load saved shorts + thumbnails when episode changes
  useEffect(() => {
    if (!selectedEpId) return
    const ep = episodes.find(e => e.id === selectedEpId)
    setSelectedEp(ep || null)
    setShorts([])
    setThumbConcepts([])

    shortsApi.get(selectedEpId)
      .then(data => {
        setShorts(data.shorts || [])
        setThumbConcepts(data.thumbnailConcepts || [])
      })
      .catch(() => {})
  }, [selectedEpId])

  async function generateShorts() {
    if (!selectedEpId || !activeCategoryId) return
    setGeneratingShorts(true)
    notify('Generating 3 Shorts scripts — expanding flagged moments…', 'info', 5000)
    try {
      const result = await shortsApi.generate(selectedEpId, activeCategoryId)
      setShorts(result.shorts || [])
      notify(`${result.shorts?.length || 0} Shorts scripts ready`, 'success')
    } catch (err) {
      notify('Generation failed: ' + err.message, 'error')
    }
    setGeneratingShorts(false)
  }

  async function generateThumbnails() {
    if (!selectedEpId || !activeCategoryId) return
    setGeneratingThumbs(true)
    notify('Generating thumbnail concepts…', 'info', 4000)
    try {
      const result = await shortsApi.thumbnails(selectedEpId, activeCategoryId)
      setThumbConcepts(result.concepts || [])
      notify(`${result.concepts?.length || 0} thumbnail concepts ready`, 'success')
    } catch (err) {
      notify('Generation failed: ' + err.message, 'error')
    }
    setGeneratingThumbs(false)
  }

  async function downloadShortsEDL() {
    if (!selectedEpId) return
    notify('Building Shorts EDL…', 'info', 3000)
    try {
      const apiUrl  = import.meta.env.VITE_API_URL || '/api'
      const { getSession } = await import('../lib/supabase')
      const session = await getSession()

      // Find editor project for this episode
      const projRes = await fetch(`${apiUrl}/editor/projects?episodeId=${selectedEpId}&limit=1`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      })
      const projData = await projRes.json()
      const project  = projData.projects?.[0]

      if (!project) {
        notify('No editor project found — open the Editor and create a project for this episode first', 'error')
        return
      }

      const res = await fetch(`${apiUrl}/editor/projects/${project.id}/export-shorts`, {
        headers: { Authorization: `Bearer ${session?.access_token}` }
      })

      if (!res.ok) {
        const err = await res.json()
        notify(err.tip || err.error || 'Export failed', 'error')
        return
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `ep${selectedEp?.episode_number || 0}-SHORTS.edl`
      a.click()
      URL.revokeObjectURL(url)
      notify('Shorts EDL downloaded', 'success')
    } catch (err) {
      notify('EDL export failed: ' + err.message, 'error')
    }
  }

  function downloadAllShorts() {
    const text = shorts.map((s, i) =>
      `SHORT ${i + 1}: ${s.title}\nHook strategy: ${s.hookStrategy}\nSource: ${s.sourceTimecode}\n\n${s.script}\n\nCTA: ${s.cta}\n\n${'─'.repeat(60)}`
    ).join('\n\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `ep${selectedEp?.episode_number || 0}-shorts.txt`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Shorts & Thumbnails</h1>
        {cat && <p className="text-sm text-[var(--text3)] mt-1">{cat.name} · one episode, three assets</p>}
      </div>

      {/* Episode picker */}
      <div className="space-y-1">
        <label className="text-xs text-[var(--text2)] uppercase tracking-wide">Episode</label>
        {loadingEps ? (
          <div className="h-10 bg-[var(--surface)] border border-[var(--border)] rounded animate-pulse"/>
        ) : (
          <div className="relative">
            <select
              value={selectedEpId}
              onChange={e => setSelectedEpId(e.target.value)}
              className="w-full bg-[var(--surface)] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] outline-none focus:border-[var(--accent)]/40 appearance-none pr-8"
            >
              <option value="">— select an episode —</option>
              {episodes.map(ep => (
                <option key={ep.id} value={ep.id}>
                  Ep {ep.episode_number}: {ep.track_name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-3 top-3.5 text-[var(--text3)] pointer-events-none"/>
          </div>
        )}
      </div>

      {selectedEpId && (
        <>
          {/* Tab switcher */}
          <div className="flex gap-1 border-b border-[var(--border)]">
            {[
              { key: 'shorts',     label: 'Shorts / Reels',    icon: Film  },
              { key: 'thumbnails', label: 'Thumbnail concepts', icon: Image },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-all ${
                  tab === key
                    ? 'border-[var(--accent)] text-[var(--accent)]'
                    : 'border-transparent text-[var(--text3)] hover:text-[var(--text2)]'
                }`}
              >
                <Icon size={13}/> {label}
              </button>
            ))}
          </div>

          {/* ── SHORTS TAB ── */}
          {tab === 'shorts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--text3)]">
                  {shorts.length
                    ? `${shorts.length} scripts ready — regenerate to refresh`
                    : 'Generate 3 standalone 45-60s scripts from this episode'}
                </div>
                <div className="flex gap-2">
                  {shorts.length > 0 && (
                    <>
                      <button
                        onClick={downloadAllShorts}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border)] text-[var(--text3)] rounded text-xs hover:border-[var(--border2)] hover:text-[var(--text2)] transition-all"
                      >
                        <Download size={11}/> Scripts
                      </button>
                      <button
                        onClick={downloadShortsEDL}
                        style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:6, border:'1px solid rgba(74,222,128,0.25)', background:'rgba(74,222,128,0.06)', color:'rgba(74,222,128,0.8)', cursor:'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}
                      >
                        <Download size={11}/> Shorts EDL
                      </button>
                    </>
                  )}
                  <button
                    onClick={generateShorts}
                    disabled={generatingShorts}
                    className="flex items-center gap-2 px-4 py-1.5 bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] rounded text-sm hover:bg-[var(--accent)]/20 disabled:opacity-40 transition-all"
                  >
                    {generatingShorts
                      ? <RefreshCw size={12} className="animate-spin"/>
                      : <Sparkles size={12}/>}
                    {generatingShorts
                      ? 'Generating…'
                      : shorts.length ? 'Regenerate' : 'Generate Shorts'}
                  </button>
                </div>
              </div>

              {generatingShorts && (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 bg-[var(--surface)] border border-[var(--border)] rounded animate-pulse"/>
                  ))}
                </div>
              )}

              {!generatingShorts && shorts.length === 0 && (
                <div className="border border-dashed border-[var(--border)] rounded p-10 text-center space-y-2">
                  <Film size={24} className="mx-auto text-[var(--text3)]"/>
                  <div className="text-sm text-[var(--text3)]">Each short is fully self-contained</div>
                  <div className="text-xs text-[var(--text3)]">Different hook strategy per short — question / in-media-res / tension</div>
                </div>
              )}

              {!generatingShorts && shorts.map((short, i) => (
                <ShortCard key={short.id || i} short={short} index={i}/>
              ))}
            </div>
          )}

          {/* ── THUMBNAILS TAB ── */}
          {tab === 'thumbnails' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-[var(--text3)]">
                  {thumbConcepts.length
                    ? `${thumbConcepts.length} concepts ready — each includes an A/B test variant`
                    : 'Generate 3 thumbnail concepts with A/B variants'}
                </div>
                <button
                  onClick={generateThumbnails}
                  disabled={generatingThumbs}
                  className="flex items-center gap-2 px-4 py-1.5 bg-[#60a5fa]/10 border border-[#60a5fa]/20 text-[#60a5fa] rounded text-sm hover:bg-[#60a5fa]/20 disabled:opacity-40 transition-all"
                >
                  {generatingThumbs
                    ? <RefreshCw size={12} className="animate-spin"/>
                    : <Zap size={12}/>}
                  {generatingThumbs
                    ? 'Generating…'
                    : thumbConcepts.length ? 'Regenerate' : 'Generate concepts'}
                </button>
              </div>

              {generatingThumbs && (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-14 bg-[var(--surface)] border border-[var(--border)] rounded animate-pulse"/>
                  ))}
                </div>
              )}

              {!generatingThumbs && thumbConcepts.length === 0 && (
                <div className="border border-dashed border-[var(--border)] rounded p-10 text-center space-y-2">
                  <Image size={24} className="mx-auto text-[var(--text3)]"/>
                  <div className="text-sm text-[var(--text3)]">Briefing-level concepts for Canva or Photoshop</div>
                  <div className="text-xs text-[var(--text3)]">Each concept: visual direction, expression cue, text overlay, colour palette, A/B variant</div>
                </div>
              )}

              {!generatingThumbs && thumbConcepts.map((concept, i) => (
                <ThumbnailCard key={concept.id || i} concept={concept} index={i}/>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}