// frontend/src/components/editor/ClipLibrary.jsx
// Visual clip browser with semantic search
// STATUS: PLACEHOLDER — UI stubbed, search calls wired but worker not live

import { useState, useEffect, useRef } from 'react'
import { Search, Clock, Zap, RefreshCw } from 'lucide-react'
import { useStore } from '../../store'
import { api } from '../../lib/api'

export default function ClipLibrary({ project, computeSearchVectors, onAddClip }) {
  const { activeCategoryId } = useStore()
  const [clips,    setClips]    = useState([])
  const [query,    setQuery]    = useState('')
  const [typeFilter, setType]   = useState('all')
  const [searching, setSearching] = useState(false)
  const [loading,  setLoading]  = useState(true)
  const workerRef  = useRef(null)

  const [total,       setTotal]       = useState(0)
  const [lastIndexed, setLastIndexed] = useState(null)

  useEffect(() => {
    if (!activeCategoryId) return
    api.get(`/editor/clips?categoryId=${activeCategoryId}&limit=100&offset=0`)
      .then(result => {
        // Handle both old { clips } and new { clips, total } response shapes
        const clips = result.clips || result || []
        setClips(clips)
        setTotal(result.total || clips.length)
        // Find the most recently indexed clip for freshness indicator
        const mostRecent = clips.reduce((latest, c) =>
          c.indexed_at && (!latest || c.indexed_at > latest) ? c.indexed_at : latest
        , null)
        setLastIndexed(mostRecent)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [activeCategoryId])

  async function handleSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)

    try {
      if (computeSearchVectors) {
        // Use the shared worker instance from EditorPage (no duplicate worker)
        const vectors = await computeSearchVectors(query)
        const { results } = await api.post('/editor/clips/search', {
          categoryId:   activeCategoryId,
          visualVector: vectors.visualVector,
          textVector:   vectors.textVector,
          count:        20,
        })
        setClips(results || [])
      } else {
        throw new Error('No search vectors available')
      }
    } catch {
      // Fall back to local text search on already-loaded clips
      const q = query.toLowerCase()
      setClips(prev => prev.filter(c =>
        c.transcript?.toLowerCase().includes(q) ||
        c.visual_tags?.some(t => t.toLowerCase().includes(q)) ||
        c.filename.toLowerCase().includes(q)
      ))
    }
    setSearching(false)
  }

  const filtered = typeFilter === 'all' ? clips : clips.filter(c => c.clip_type === typeFilter)

  const ageStr = lastIndexed ? (() => {
    const mins = Math.round((Date.now() - new Date(lastIndexed).getTime()) / 60000)
    if (mins < 2)    return 'just now'
    if (mins < 60)   return `${mins}m ago`
    if (mins < 1440) return `${Math.round(mins/60)}h ago`
    return `${Math.round(mins/1440)}d ago`
  })() : null

  return (
    <div className="space-y-4">

      {/* Library header with freshness */}
      {total > 0 && (
        <div className="flex items-center justify-between text-xs text-[#444]">
          <span>{total} clips in library</span>
          {ageStr && (
            <span className="flex items-center gap-1">
              <RefreshCw size={9}/>
              indexed {ageStr}
            </span>
          )}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-3">
        <form onSubmit={handleSearch} className="flex-1 flex items-center gap-2 bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2 focus-within:border-[#c8b89a]/40 transition-colors">
          <Search size={12} className="text-[#444] shrink-0"/>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search clips by meaning: close-up, smiling, quiet"
            className="bg-transparent text-sm text-[#ddd] placeholder-[#333] outline-none flex-1"
          />
          {searching && <div className="w-3 h-3 border border-[#c8b89a] border-t-transparent rounded-full animate-spin shrink-0"/>}
        </form>
        <div className="flex gap-1">
          {['all','cam','daw','broll'].map(t => (
            <button key={t} onClick={() => setType(t)}
              className={`px-3 py-2 rounded text-xs transition-all capitalize ${
                typeFilter === t ? 'bg-[#c8b89a]/10 text-[#c8b89a]' : 'text-[#444] hover:text-[#888]'
              }`}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* Semantic search note */}
      <div className="text-xs text-[#333]">
        Semantic search active once indexing is complete — finds clips by visual meaning and spoken content.
      </div>

      {/* Clip grid */}
      {loading ? (
        <div className="grid grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-video bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
          ))}
        </div>
      ) : filtered.length ? (
        <div className="grid grid-cols-4 gap-3">
          {filtered.map(clip => (
            <ClipCard
              key={clip.id}
              clip={clip}
              selected={selectedClip?.id === clip.id}
              onSelect={() => setSelectedClip(s => s?.id === clip.id ? null : clip)}
              onPreview={() => setPreviewClip(clip)}
              onAddToTimeline={onAddClip ? () => onAddClip(clip) : null}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-[#444] text-sm">
          {clips.length ? 'No clips match your search' : 'No clips indexed — run indexing first'}
        </div>
      )}

      {/* Preview modal */}
      {previewClip && (
        <div
          style={{position:'fixed',inset:0,zIndex:200,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}}
          onClick={() => setPreviewClip(null)}
        >
          <div
            style={{background:'#0a0a0a',border:'1px solid #1a1a1a',borderRadius:12,padding:20,maxWidth:600,width:'90%'}}
            onClick={e => e.stopPropagation()}
          >
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{fontSize:13,color:'#888',fontFamily:'monospace'}}>{previewClip.filename}</div>
              <button onClick={() => setPreviewClip(null)} style={{background:'none',border:'none',color:'#444',cursor:'pointer',fontSize:18,lineHeight:1}}>×</button>
            </div>
            {previewClip.thumbnail_b64 && (
              <img src={`data:image/png;base64,${previewClip.thumbnail_b64}`} style={{width:'100%',borderRadius:6,marginBottom:12,display:'block'}} alt={previewClip.filename}/>
            )}
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:12}}>
              {previewClip.clip_type && <span style={{fontSize:10,fontFamily:'monospace',padding:'2px 6px',borderRadius:4,border:'1px solid rgba(200,184,154,0.3)',color:'#c8b89a'}}>{previewClip.clip_type.toUpperCase()}</span>}
              {previewClip.duration_ms && <span style={{fontSize:10,color:'#555'}}>{Math.round(previewClip.duration_ms/1000)}s</span>}
              {previewClip.width && <span style={{fontSize:10,color:'#555'}}>{previewClip.width}×{previewClip.height}</span>}
            </div>
            {previewClip.transcript && (
              <div style={{fontSize:12,color:'#555',lineHeight:1.6,marginBottom:12,padding:'8px 12px',background:'#0d0d0d',borderRadius:6,maxHeight:100,overflowY:'auto'}}>
                "{previewClip.transcript}"
              </div>
            )}
            {previewClip.visual_tags?.length > 0 && (
              <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:12}}>
                {previewClip.visual_tags.map(t => <span key={t} style={{fontSize:10,color:'#444',background:'#111',padding:'2px 6px',borderRadius:4}}>{t}</span>)}
              </div>
            )}
            {onAddClip && (
              <button
                onClick={() => { onAddClip(previewClip); setPreviewClip(null) }}
                style={{width:'100%',padding:'8px',background:'rgba(200,184,154,0.1)',border:'1px solid rgba(200,184,154,0.2)',borderRadius:6,color:'#c8b89a',fontSize:12,cursor:'pointer'}}
              >
                + Add to timeline
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ClipCard({ clip, selected, onSelect, onPreview, onAddToTimeline }) {
  const durationSec = clip.duration_ms ? Math.round(clip.duration_ms / 1000) : null

  return (
    <div
      onClick={onSelect}
      className={`group border rounded overflow-hidden transition-all cursor-pointer relative ${
        selected ? 'border-[#c8b89a]/50 bg-[#c8b89a]/03' : 'border-[#111] hover:border-[#222]'
      }`}
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-[#0a0a0a] flex items-center justify-center relative">
        {clip.thumbnail_b64 ? (
          <img src={`data:image/png;base64,${clip.thumbnail_b64}`} className="w-full h-full object-cover" alt={clip.filename}/>
        ) : (
          <div className="text-[#222] text-xs font-mono">{clip.clip_type?.toUpperCase()}</div>
        )}
        {/* Duration badge */}
        {durationSec && (
          <div className="absolute bottom-1 right-1 bg-black/60 text-[10px] text-white px-1 rounded">
            {durationSec}s
          </div>
        )}
        {/* Energy indicator */}
        {clip.audio_energy != null && (
          <div className="absolute top-1 right-1">
            <Zap size={10} className={clip.audio_energy > 0.6 ? 'text-[#c8b89a]' : 'text-[#333]'}/>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); onPreview?.() }}
            style={{fontSize:10,padding:'4px 8px',borderRadius:4,background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)',color:'#fff',cursor:'pointer'}}
          >
            Preview
          </button>
          {onAddToTimeline && (
            <button
              onClick={e => { e.stopPropagation(); onAddToTimeline() }}
              style={{fontSize:10,padding:'4px 8px',borderRadius:4,background:'rgba(200,184,154,0.2)',border:'1px solid rgba(200,184,154,0.4)',color:'#c8b89a',cursor:'pointer'}}
            >
              + Add
            </button>
          )}
        </div>
        {/* Selected indicator */}
        {selected && (
          <div style={{position:'absolute',top:4,left:4,width:16,height:16,borderRadius:'50%',background:'#c8b89a',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#000',fontWeight:700}}>✓</div>
        )}
      </div>

      {/* Info */}
      <div className="p-2 space-y-1">
        <div className="text-xs text-[#888] truncate">{clip.filename}</div>
        {clip.visual_tags?.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {clip.visual_tags.slice(0, 3).map(tag => (
              <span key={tag} className="text-[10px] text-[#444] bg-[#111] px-1 rounded">{tag}</span>
            ))}
          </div>
        )}
        {clip.transcript && (
          <div className="text-[10px] text-[#444] line-clamp-2 leading-relaxed">{clip.transcript}</div>
        )}
      </div>
    </div>
  )
}