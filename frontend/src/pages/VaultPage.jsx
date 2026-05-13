// frontend/src/pages/VaultPage.jsx
import { useEffect, useState } from 'react'
import { BookMarked, Star, Search, Filter, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import PageCTA from '../components/ui/PageCTA'
import { vault as vaultApi } from '../lib/api'

const TYPES = ['all','hook','script','trending','shortform','concept','successful']

export default function VaultPage() {
  const { activeCategoryId, notify } = useStore()
  const [entries, setEntries]   = useState([])
  const [search, setSearch]     = useState('')
  const [typeFilter, setType]   = useState('all')
  const [favOnly, setFavOnly]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const [expanded, setExpanded]  = useState(null)
  const [selected, setSelected] = useState(new Set())
  const [bulkMode, setBulkMode] = useState(false)

  async function load() {
    if (!activeCategoryId) return
    setLoading(true)
    const params = { categoryId: activeCategoryId, limit: 100 }
    if (typeFilter !== 'all')  params.type      = typeFilter
    if (favOnly)               params.favourite  = 'true'
    if (search.trim())         params.search     = search.trim()
    const { entries } = await vaultApi.list(params)
    setEntries(entries || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [activeCategoryId, typeFilter, favOnly])

  async function toggleFav(id) {
    const { entry } = await vaultApi.favourite(id)
    setEntries(prev => prev.map(e => e.id === id ? { ...e, is_favourite: entry.is_favourite } : e))
  }

  async function deleteEntry(id) {
    await vaultApi.delete(id)
    setEntries(prev => prev.filter(e => e.id !== id))
    notify('Removed from vault', 'info')
  }

  async function bulkDelete() {
    const ids = [...selected]
    const ok  = window.confirm(
      `Delete ${ids.length} idea${ids.length > 1 ? 's' : ''}?\n\nThis cannot be undone.`
    )
    if (!ok) return
    await Promise.all(ids.map(id => vaultApi.delete(id)))
    setEntries(prev => prev.filter(e => !selected.has(e.id)))
    setSelected(new Set())
    setBulkMode(false)
    notify(`${ids.length} idea${ids.length > 1 ? 's' : ''} removed`, 'info')
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const TYPE_COLORS = {
    hook: 'var(--accent)', script: '#6366f1', trending: '#40a060',
    shortform: 'rgba(74,222,128,0.85)', concept: '#888', successful: 'var(--accent)'
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Vault</h1>
        <p className="text-sm text-[var(--text3)] mt-1">{entries.length} ideas</p>
      </div>

      {/* Bulk actions toolbar */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setBulkMode(b => !b); setSelected(new Set()) }}
          className={`text-xs px-3 py-1.5 rounded border transition-all ${bulkMode ? 'border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)] text-[var(--text3)] hover:border-[var(--border2)]'}`}
        >
          {bulkMode ? 'Cancel' : 'Select'}
        </button>
        {bulkMode && selected.size > 0 && (
          <>
            <span className="text-xs text-[var(--text3)]">{selected.size} selected</span>
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-red-800/40 text-red-400 hover:bg-red-900/20 transition-all"
            >
              <Trash2 size={11}/> Delete {selected.size}
            </button>
            <button
              onClick={() => setSelected(new Set(entries.map(e => e.id)))}
              className="text-xs text-[var(--text3)] hover:text-[var(--text2)] transition-colors"
            >
              Select all
            </button>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-[var(--surface)] border border-[#1e1e1e] rounded px-3 py-2 flex-1">
          <Search size={12} className="text-[var(--text3)]"/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Search ideas..."
            className="bg-transparent text-sm text-[#ddd] placeholder-[#333] outline-none flex-1"
          />
        </div>
        <div className="flex gap-1">
          {TYPES.map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`px-3 py-2 rounded text-xs transition-all capitalize ${
                typeFilter === t ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text3)] hover:text-[var(--text2)]'
              }`}
            >{t}</button>
          ))}
        </div>
        <button onClick={() => setFavOnly(!favOnly)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded text-xs transition-all ${
            favOnly ? 'text-[var(--accent)] bg-[var(--accent)]/10' : 'text-[var(--text3)] hover:text-[var(--text2)]'
          }`}>
          <Star size={12}/> Favourites
        </button>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_,i) => (
          <div key={i} className="h-20 bg-[var(--surface)] border border-[var(--border)] rounded animate-pulse"/>
        ))}</div>
      ) : entries.length ? (
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.id} onClick={() => bulkMode ? toggleSelect(e.id) : setExpanded(expanded === e.id ? null : e.id)} className={"px-4 py-3 bg-[var(--surface)] border rounded transition-colors group cursor-pointer " + (selected.has(e.id) ? "border-[var(--accent)]/30 bg-[var(--accent)]/3" : expanded === e.id ? "border-[var(--border2)]" : "border-[var(--border)]")}>
              <div className="flex items-start gap-3">
                {bulkMode && (
                  <div className={"w-4 h-4 rounded border mt-0.5 shrink-0 flex items-center justify-center " + (selected.has(e.id) ? "border-[var(--accent)] bg-[var(--accent)]/20" : "border-[var(--border2)]")}>
                    {selected.has(e.id) && <span style={{color:'var(--accent)',fontSize:'10px'}}>✓</span>}
                  </div>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded border mt-0.5 shrink-0"
                  style={{ borderColor: TYPE_COLORS[e.type]+'40', color: TYPE_COLORS[e.type] }}>
                  {e.type}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text)] mb-1">{e.title}</div>
                  {expanded === e.id ? (
                    <div className="text-xs text-[var(--text2)] leading-relaxed whitespace-pre-wrap mt-1">{e.content}</div>
                  ) : (
                    <div className="text-xs text-[var(--text3)] line-clamp-2 leading-relaxed">{e.content}</div>
                  )}
                  {e.tags?.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {e.tags.map(t => (
                        <span key={t} className="text-[10px] text-[var(--text3)] bg-[var(--surface2)] px-1.5 py-0.5 rounded">#{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => toggleFav(e.id)}
                    className={`p-1.5 rounded transition-colors ${e.is_favourite ? 'text-[var(--accent)]' : 'text-[var(--text3)] hover:text-[var(--accent)]'}`}>
                    <Star size={12} fill={e.is_favourite ? 'currentColor' : 'none'}/>
                  </button>
                  <button onClick={() => deleteEntry(e.id)}
                    className="p-1.5 rounded text-[var(--text3)] hover:text-red-400 transition-colors">
                    <Trash2 size={12}/>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-[var(--text3)]">
          <BookMarked size={32} className="mx-auto mb-3 opacity-30"/>
          <div className="text-sm">No ideas yet</div>
          <div className="text-xs mt-1">Ideas are saved automatically when you generate episodes</div>
        </div>
      )}
    </div>
  )
}