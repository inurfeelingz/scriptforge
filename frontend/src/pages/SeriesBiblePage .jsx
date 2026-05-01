// frontend/src/pages/SeriesBiblePage.jsx
// Batch 5 — improvement 14:
// Series bible — living auto-generated show document.
// Summarises: premise, voice, themes, narrative threads, callback opportunities,
// a "previously on" summary, and a brief for collaborators.

import { useState, useEffect } from 'react'
import {
  BookOpen, RefreshCw, Download, Copy, Check,
  ChevronDown, ChevronUp, Sparkles, Clock,
} from 'lucide-react'
import { useStore } from '../store'
import { shorts as shortsApi } from '../lib/api'

// ── Copy-to-clipboard hook (module level — React rules of hooks) ──────────────
function useCopy() {
  const [copied, setCopied] = useState(null)
  function copy(text, id) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id); setTimeout(() => setCopied(null), 2000)
    })
  }
  return { copied, copy }
}

// ── Section block ─────────────────────────────────────────────────────────────
function BibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-[var(--border)] rounded overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[var(--surface)] transition-colors"
      >
        <span className="text-sm font-medium text-[var(--text)]">{title}</span>
        {open ? <ChevronUp size={13} className="text-[var(--text3)]"/> : <ChevronDown size={13} className="text-[var(--text3)]"/>}
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-4 bg-[#060606]">
          {children}
        </div>
      )}
    </div>
  )
}

function TagList({ items }) {
  if (!items?.length) return <span className="text-xs text-[var(--text3)]">None identified yet</span>
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <span key={i} className="text-xs px-2.5 py-1 rounded-full border border-[var(--border)] text-[var(--text2)] bg-[var(--surface)]">
          {item}
        </span>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SeriesBiblePage() {
  const { activeCategoryId, activeCategory, notify } = useStore()
  const cat = activeCategory?.()

  const [bible,    setBible]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [regen,    setRegen]    = useState(false)
  const { copied, copy } = useCopy()

  useEffect(() => {
    if (!activeCategoryId) return
    load()
  }, [activeCategoryId])

  async function load(force = false) {
    setLoading(true)
    try {
      const data = await shortsApi.bible(activeCategoryId, force)
      setBible(data)
    } catch (err) {
      notify(err.message, 'error')
    }
    setLoading(false)
    setRegen(false)
  }

  async function regenerate() {
    setRegen(true)
    notify('Regenerating series bible from all episodes…', 'info', 4000)
    await load(true)
  }

  function downloadBible() {
    if (!bible) return
    const lines = [
      `SERIES BIBLE — ${cat?.name || 'WhispaCuts Show'}`,
      `Generated: ${new Date(bible.generatedAt).toLocaleDateString()}`,
      `Episodes: ${bible.episodeCount} total, ${bible.publishedCount} published`,
      '',
      '═'.repeat(60),
      '',
      'SHOW PREMISE',
      bible.showPremise,
      '',
      '═'.repeat(60),
      '',
      'CREATOR VOICE',
      bible.creatorVoice,
      '',
      '═'.repeat(60),
      '',
      'RECURRING THEMES',
      (bible.recurringThemes || []).map(t => `• ${t}`).join('\n'),
      '',
      '═'.repeat(60),
      '',
      'NARRATIVE THREADS',
      (bible.narrativeThreads || []).map(t =>
        `${t.thread}\n  ${t.description}\n  Episodes: ${(t.episodes || []).join(', ')}`
      ).join('\n\n'),
      '',
      '═'.repeat(60),
      '',
      'BEST PERFORMING STRUCTURES',
      (bible.bestPerformingStructures || []).map(s =>
        `${s.structure}\n  ${s.description}\n  Example: ${s.episodeExample}`
      ).join('\n\n'),
      '',
      '═'.repeat(60),
      '',
      'CALLBACK OPPORTUNITIES',
      (bible.callbackOpportunities || []).map(c =>
        `From: ${c.from}\n→ ${c.suggestion}`
      ).join('\n\n'),
      '',
      '═'.repeat(60),
      '',
      'UPCOMING DIRECTIONS',
      (bible.upcomingDirections || []).map(d => `• ${d}`).join('\n'),
      '',
      '═'.repeat(60),
      '',
      'PREVIOUSLY ON',
      bible.previouslyOn,
      '',
      '═'.repeat(60),
      '',
      'COLLABORATOR BRIEF',
      bible.collaboratorBrief,
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `series-bible-${cat?.name?.replace(/\s+/g, '-').toLowerCase() || 'show'}.txt`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-serif text-[#f0ede8]">Series Bible</h1>
          {cat && <p className="text-sm text-[var(--text3)] mt-1">{cat.name}</p>}
        </div>
        <div className="flex gap-2">
          {bible?.available && (
            <button
              onClick={downloadBible}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border)] text-[var(--text3)] rounded text-xs hover:border-[var(--border2)] hover:text-[var(--text2)] transition-all"
            >
              <Download size={11}/> Export
            </button>
          )}
          <button
            onClick={regenerate}
            disabled={loading || regen}
            className="flex items-center gap-2 px-4 py-1.5 bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[var(--accent)] rounded text-sm hover:bg-[var(--accent)]/20 disabled:opacity-40 transition-all"
          >
            {regen
              ? <RefreshCw size={12} className="animate-spin"/>
              : <RefreshCw size={12}/>}
            {regen ? 'Regenerating…' : 'Regenerate'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-[var(--surface)] border border-[var(--border)] rounded animate-pulse"
              style={{ opacity: 1 - i * 0.15 }}/>
          ))}
        </div>
      ) : !bible?.available ? (
        <div className="border border-dashed border-[var(--border)] rounded p-12 text-center space-y-3">
          <BookOpen size={28} className="mx-auto text-[var(--text3)]"/>
          <div className="text-sm text-[var(--text3)]">{bible?.reason || 'No episodes yet'}</div>
          <div className="text-xs text-[var(--text3)]">
            Generate your first episode to start building the series bible
          </div>
        </div>
      ) : (
        <>
          {/* Meta strip */}
          <div className="flex items-center gap-4 text-xs text-[var(--text3)]">
            <span>{bible.episodeCount} episodes · {bible.publishedCount} published</span>
            {bible.generatedAt && (
              <span className="flex items-center gap-1">
                <Clock size={10}/>
                {bible.fromCache ? 'Cached · ' : 'Updated '}
                {new Date(bible.generatedAt).toLocaleDateString()}
                {bible.ageHours ? ` (${bible.ageHours}h ago)` : ''}
              </span>
            )}
          </div>

          {/* Show premise */}
          <BibleSection title="Show premise" defaultOpen>
            <p className="text-sm text-[#bbb] leading-relaxed">{bible.showPremise}</p>
          </BibleSection>

          {/* Previously on — shown prominently, most immediately useful */}
          <BibleSection title="Previously on…" defaultOpen>
            <div className="bg-[var(--accent)]/5 border border-[var(--accent)]/15 rounded p-4 space-y-3">
              <p className="text-sm text-[#ddd] leading-relaxed italic">
                "{bible.previouslyOn}"
              </p>
              <button
                onClick={() => copy(bible.previouslyOn, 'prev-on')}
                className="flex items-center gap-1.5 text-xs text-[var(--text3)] hover:text-[var(--accent)] transition-colors"
              >
                {copied === 'prev-on' ? <Check size={10}/> : <Copy size={10}/>}
                {copied === 'prev-on' ? 'Copied' : 'Copy for episode intro'}
              </button>
            </div>
          </BibleSection>

          {/* Creator voice */}
          <BibleSection title="Creator voice" defaultOpen>
            <p className="text-sm text-[var(--text2)] leading-relaxed">{bible.creatorVoice}</p>
          </BibleSection>

          {/* Recurring themes */}
          <BibleSection title="Recurring themes">
            <TagList items={bible.recurringThemes}/>
          </BibleSection>

          {/* Narrative threads */}
          <BibleSection title="Narrative threads">
            {bible.narrativeThreads?.length ? (
              <div className="space-y-3">
                {bible.narrativeThreads.map((t, i) => (
                  <div key={i} className="border border-[var(--border)] rounded p-3 space-y-1.5">
                    <div className="text-sm font-medium text-[var(--text)]">{t.thread}</div>
                    <div className="text-xs text-[var(--text2)] leading-relaxed">{t.description}</div>
                    {t.episodes?.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        {t.episodes.map(n => (
                          <span key={n} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1a1a1a] text-[var(--text3)]">Ep {n}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[var(--text3)]">No threads identified yet — more episodes needed</span>
            )}
          </BibleSection>

          {/* Best performing structures */}
          <BibleSection title="Best performing structures">
            {bible.bestPerformingStructures?.length ? (
              <div className="space-y-3">
                {bible.bestPerformingStructures.map((s, i) => (
                  <div key={i} className="space-y-1">
                    <div className="text-sm font-medium text-[var(--accent)]">{s.structure}</div>
                    <div className="text-xs text-[var(--text2)]">{s.description}</div>
                    <div className="text-[10px] text-[var(--text3)]">Example: {s.episodeExample}</div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[var(--text3)]">Upload analytics for at least 3 episodes to identify patterns</span>
            )}
          </BibleSection>

          {/* Callback opportunities */}
          <BibleSection title="Callback opportunities">
            {bible.callbackOpportunities?.length ? (
              <div className="space-y-3">
                {bible.callbackOpportunities.map((c, i) => (
                  <div key={i} className="flex gap-3 text-xs">
                    <div className="w-1 rounded-full bg-[var(--accent)]/30 shrink-0"/>
                    <div className="space-y-0.5">
                      <div className="text-[var(--text2)]">From: {c.from}</div>
                      <div className="text-[var(--text2)]">{c.suggestion}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[var(--text3)]">No callbacks identified yet</span>
            )}
          </BibleSection>

          {/* Upcoming directions */}
          <BibleSection title="Upcoming directions">
            {bible.upcomingDirections?.length ? (
              <ul className="space-y-1.5">
                {bible.upcomingDirections.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[var(--text2)]">
                    <Sparkles size={10} className="mt-1 text-[var(--accent)]/50 shrink-0"/>
                    {d}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-xs text-[var(--text3)]">More episodes needed to identify directions</span>
            )}
          </BibleSection>

          {/* Collaborator brief */}
          <BibleSection title="Collaborator brief" defaultOpen>
            <div className="space-y-3">
              <p className="text-sm text-[var(--text2)] leading-relaxed">{bible.collaboratorBrief}</p>
              <button
                onClick={() => copy(bible.collaboratorBrief, 'collab-brief')}
                className="flex items-center gap-1.5 text-xs text-[var(--text3)] hover:text-[var(--accent)] transition-colors"
              >
                {copied === 'collab-brief' ? <Check size={10}/> : <Copy size={10}/>}
                {copied === 'collab-brief' ? 'Copied' : 'Copy brief'}
              </button>
            </div>
          </BibleSection>
        </>
      )}
    </div>
  )
}
