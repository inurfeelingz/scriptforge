// frontend/src/components/layout/CommandPalette.jsx
// Global command palette — Cmd/Ctrl+K from anywhere.
// Searches episodes, vault ideas, pages, and actions.

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Film, BookMarked, Zap, BarChart2,
  Settings, Mic, Music2, Calendar, ChevronRight,
  Sparkles, Radio, X,
} from 'lucide-react'
import { useStore } from '../../store'
import { episodes as episodesApi, vault as vaultApi } from '../../lib/api'

const STATIC_ACTIONS = [
  { type: 'page', label: 'KB Home',      icon: Sparkles, to: '/',          hint: 'Open KB chat'             },
  { type: 'page', label: 'Pipeline',     icon: Zap,      to: '/pipeline',  hint: 'View all episodes'        },
  { type: 'page', label: 'Vault',        icon: BookMarked,to: '/vault',    hint: 'Browse ideas'             },
  { type: 'page', label: 'Insights',     icon: BarChart2, to: '/analytics',hint: 'Analytics & audience'     },
  { type: 'page', label: 'Sound',        icon: Music2,    to: '/sound',    hint: 'Sound library'            },
  { type: 'page', label: 'Schedule',     icon: Calendar,  to: '/schedule', hint: 'Publishing calendar'      },
  { type: 'page', label: 'Settings',     icon: Settings,  to: '/settings', hint: 'Account & preferences'    },
  { type: 'page', label: 'Companion',    icon: Radio,     to: '/companion',hint: 'Voice memo recorder'      },
  { type: 'action', label: 'New episode',icon: Sparkles,  to: '/generate', hint: 'Generate a new episode'   },
  { type: 'action', label: 'Teleprompter',icon: Mic,      to: '/teleprompter', hint: 'Open teleprompter'   },
]

export default function CommandPalette({ onClose }) {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState(STATIC_ACTIONS)
  const [selected, setSelected] = useState(0)
  const [loading,  setLoading]  = useState(false)
  const navigate   = useNavigate()
  const inputRef   = useRef(null)
  const { activeCategoryId } = useStore()

  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults(STATIC_ACTIONS); setSelected(0); return }

    const q = query.toLowerCase()

    // Filter static actions immediately
    const staticMatches = STATIC_ACTIONS.filter(a =>
      a.label.toLowerCase().includes(q) || a.hint.toLowerCase().includes(q)
    )
    setResults(staticMatches)
    setSelected(0)

    // Search episodes + vault async
    const timer = setTimeout(async () => {
      if (!activeCategoryId) return
      setLoading(true)
      try {
        const [epRes, vaultRes] = await Promise.allSettled([
          episodesApi.list({ categoryId: activeCategoryId, limit: 50 }),
          vaultApi.list({ categoryId: activeCategoryId, search: query, limit: 20 }),
        ])

        const eps = (epRes.status === 'fulfilled' ? epRes.value.episodes || [] : [])
          .filter(e => e.track_name?.toLowerCase().includes(q) || String(e.episode_number).includes(q))
          .slice(0, 5)
          .map(e => ({
            type:  'episode',
            label: `Ep ${e.episode_number}: ${e.track_name}`,
            icon:  Film,
            to:    `/episode/${e.id}`,
            hint:  e.status,
          }))

        const ideas = (vaultRes.status === 'fulfilled' ? vaultRes.value.entries || [] : [])
          .slice(0, 5)
          .map(v => ({
            type:  'vault',
            label: v.title,
            icon:  BookMarked,
            to:    '/vault',
            hint:  v.type,
          }))

        setResults([...staticMatches, ...eps, ...ideas])
      } catch {}
      setLoading(false)
    }, 200)

    return () => clearTimeout(timer)
  }, [query, activeCategoryId])

  const go = useCallback((item) => {
    navigate(item.to)
    onClose()
  }, [navigate, onClose])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
      if (e.key === 'Enter')     { if (results[selected]) go(results[selected]) }
      if (e.key === 'Escape')    { onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [results, selected, go, onClose])

  const TYPE_COLORS = {
    page:    'rgba(255,255,255,0.25)',
    action:  'rgba(74,222,128,0.6)',
    episode: 'rgba(74,222,128,0.5)',
    vault:   'rgba(200,184,154,0.5)',
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      />

      {/* Panel */}
      <div style={{
        position:  'fixed',
        top:       '15vh',
        left:      '50%',
        transform: 'translateX(-50%)',
        width:     'min(580px, calc(100vw - 32px))',
        zIndex:    81,
        background: 'rgba(10,12,18,0.98)',
        border:    '1px solid rgba(74,222,128,0.15)',
        borderRadius: 16,
        boxShadow: '0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(74,222,128,0.04)',
        overflow:  'hidden',
      }}>

        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Search size={16} style={{ color: 'rgba(74,222,128,0.6)', flexShrink: 0 }}/>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search episodes, ideas, pages..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: "'Figtree',sans-serif" }}
          />
          {loading && <div style={{ width: 14, height: 14, border: '2px solid rgba(74,222,128,0.2)', borderTopColor: 'rgba(74,222,128,0.8)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }}/>}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', flexShrink: 0 }}>ESC</div>
        </div>

        {/* Results */}
        <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          {results.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: 13, color: 'rgba(255,255,255,0.25)', fontFamily: "'Figtree',sans-serif" }}>
              No results for "{query}"
            </div>
          )}

          {results.map((item, i) => {
            const Icon   = item.icon
            const active = i === selected
            return (
              <button
                key={`${item.type}-${i}`}
                onClick={() => go(item)}
                onMouseEnter={() => setSelected(i)}
                style={{
                  width:      '100%',
                  display:    'flex',
                  alignItems: 'center',
                  gap:        12,
                  padding:    '11px 16px',
                  background: active ? 'rgba(74,222,128,0.06)' : 'transparent',
                  border:     'none',
                  borderLeft: active ? '2px solid rgba(74,222,128,0.5)' : '2px solid transparent',
                  cursor:     'pointer',
                  textAlign:  'left',
                  transition: 'background 0.1s',
                }}
              >
                <Icon size={14} style={{ color: TYPE_COLORS[item.type], flexShrink: 0 }}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.65)', fontFamily: "'Figtree',sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.label}
                  </div>
                  {item.hint && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: "'Figtree',sans-serif", textTransform: 'capitalize' }}>
                      {item.hint}
                    </div>
                  )}
                </div>
                {active && <ChevronRight size={12} style={{ color: 'rgba(74,222,128,0.4)', flexShrink: 0 }}/>}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 16, padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {[['↑↓', 'navigate'], ['↵', 'select'], ['esc', 'close']].map(([key, label]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 10, padding: '2px 5px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace' }}>{key}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: "'Figtree',sans-serif" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
