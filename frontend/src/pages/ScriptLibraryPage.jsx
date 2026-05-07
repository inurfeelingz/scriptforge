// frontend/src/pages/ScriptLibraryPage.jsx
// Script library with three categories: long-form, shorts/tiktok, competitor

import { useState, useEffect, useRef } from 'react'
import { Upload, FileText, Trash2, CheckCircle, AlertCircle, Users, Zap } from 'lucide-react'
import { api } from '../lib/api'
import { useStore } from '../store'

const CATEGORIES = [
  {
    key:   'own',
    label: 'Long-form',
    icon:  FileText,
    desc:  'Your own YouTube/podcast scripts — trains your voice and structure',
    tags:  ['uploaded-script'],
    color: '#c8b89a',
    hint:  'Drop your past long-form scripts here',
  },
  {
    key:   'shorts',
    label: 'Shorts / TikTok',
    icon:  Zap,
    desc:  'Short-form scripts — trains hooks, pacing, and punchy delivery',
    tags:  ['uploaded-script', 'shorts'],
    color: '#8abfbf',
    hint:  'Drop short-form scripts here',
  },
  {
    key:   'competitor',
    label: 'Competitor',
    icon:  Users,
    desc:  'Scripts from creators you admire — KP will study what works',
    tags:  ['uploaded-script', 'competitor'],
    color: '#bf8abf',
    hint:  'Drop competitor scripts here — add creator name to filename',
  },
]

function tagForCategory(key) {
  return CATEGORIES.find(c => c.key === key)?.tags || ['uploaded-script']
}

function categoryForScript(script) {
  const tags = script.tags || []
  if (tags.includes('competitor')) return 'competitor'
  if (tags.includes('shorts') || tags.includes('tiktok')) return 'shorts'
  return 'own'
}

export default function ScriptLibraryPage() {
  const { activeCategoryId } = useStore()
  const [scripts,    setScripts]   = useState([])
  const [loading,    setLoading]   = useState(true)
  const [uploading,  setUploading] = useState(null)  // category key being uploaded
  const [dragOver,   setDragOver]  = useState(null)  // category key being dragged over
  const [toast,      setToast]     = useState(null)
  const [activeTab,  setActiveTab] = useState('own')
  const fileRefs = useRef({})

  useEffect(() => {
    if (!activeCategoryId) { setLoading(false); return }
    setLoading(true)
    api.get(`/vault?categoryId=${activeCategoryId}&type=script&limit=200`)
      .then(({ entries }) => setScripts(entries || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [activeCategoryId])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function processFiles(files, categoryKey) {
    if (!activeCategoryId) { showToast('Select a workspace first', 'error'); return }
    const textFiles = Array.from(files).filter(f =>
      f.type === 'text/plain' || f.name.endsWith('.txt') ||
      f.name.endsWith('.md')  || f.name.endsWith('.fdx') ||
      f.name.endsWith('.fountain')
    )
    if (!textFiles.length) { showToast('Upload .txt, .md, or .fountain files', 'error'); return }

    setUploading(categoryKey)
    let added = 0, failed = 0
    const tags = tagForCategory(categoryKey)

    for (const file of textFiles) {
      const text = await file.text()
      if (!text.trim()) continue
      try {
        await api.post('/vault', {
          categoryId: activeCategoryId,
          type:       'script',
          title:      file.name.replace(/\.[^.]+$/, ''),
          content:    text,
          tags,
        })
        added++
      } catch { failed++ }
    }

    const { entries } = await api.get(`/vault?categoryId=${activeCategoryId}&type=script&limit=200`).catch(() => ({ entries: [] }))
    setScripts(entries || [])
    setUploading(null)
    setActiveTab(categoryKey)

    if (failed > 0 && added === 0) {
      showToast('Upload failed — server may be starting up, try again', 'error')
    } else {
      showToast(`${added} script${added !== 1 ? 's' : ''} added${failed > 0 ? ` (${failed} failed)` : ''}`)
    }
  }

  async function handleDelete(id) {
    await api.delete(`/vault/${id}`).catch(() => {})
    setScripts(prev => prev.filter(s => s.id !== id))
  }

  const byCategory = {
    own:        scripts.filter(s => categoryForScript(s) === 'own'),
    shorts:     scripts.filter(s => categoryForScript(s) === 'shorts'),
    competitor: scripts.filter(s => categoryForScript(s) === 'competitor'),
  }

  const activeCategory = CATEGORIES.find(c => c.key === activeTab)
  const Icon = activeCategory.icon

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Script library</h1>
        <p className="text-sm text-[#555] mt-1">
          Upload scripts by category — KP reads all of them when generating and analysing your content
        </p>
      </div>

      {!activeCategoryId ? (
        <div className="border border-dashed border-[#1a1a1a] rounded p-8 text-center text-sm text-[#444]">
          Select a workspace first
        </div>
      ) : (
        <>
          {/* Category tabs */}
          <div className="flex gap-2">
            {CATEGORIES.map(cat => {
              const CatIcon = cat.icon
              const count   = byCategory[cat.key]?.length || 0
              return (
                <button
                  key={cat.key}
                  onClick={() => setActiveTab(cat.key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded border text-sm transition-all ${
                    activeTab === cat.key
                      ? 'border-[#2a2a2a] bg-[#0d0d0d] text-[#ccc]'
                      : 'border-[#1a1a1a] text-[#555] hover:border-[#333] hover:text-[#888]'
                  }`}
                >
                  <CatIcon size={12} style={{ color: activeTab === cat.key ? cat.color : undefined }}/>
                  {cat.label}
                  {count > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#1a1a1a] text-[#555]">{count}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Category description */}
          <div className="text-xs text-[#444] flex items-center gap-2">
            <Icon size={11} style={{ color: activeCategory.color }}/>
            {activeCategory.desc}
          </div>

          {/* Upload zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(activeTab) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={e => { e.preventDefault(); setDragOver(null); processFiles(e.dataTransfer.files, activeTab) }}
            onClick={() => fileRefs.current[activeTab]?.click()}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded p-10 cursor-pointer transition-all ${
              dragOver === activeTab
                ? 'border-[#c8b89a]/40 bg-[#c8b89a]/5'
                : 'border-[#1a1a1a] hover:border-[#333]'
            } ${uploading === activeTab ? 'cursor-wait opacity-60' : ''}`}
          >
            <input
              ref={el => fileRefs.current[activeTab] = el}
              type="file"
              accept=".txt,.md,.fountain,.fdx"
              multiple
              className="hidden"
              onChange={e => processFiles(e.target.files, activeTab)}
            />
            <Icon size={24} style={{ color: activeCategory.color + '80' }}/>
            <div className="text-center">
              <div className="text-sm text-[#666]">
                {uploading === activeTab ? 'Uploading...' : activeCategory.hint}
              </div>
              <div className="text-xs text-[#444] mt-1">.txt · .md · .fountain · .fdx</div>
            </div>
          </div>

          {/* Toast */}
          {toast && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded border text-sm ${
              toast.type === 'error'
                ? 'bg-red-950/20 border-red-900/30 text-red-400'
                : 'bg-green-950/20 border-green-900/30 text-green-400'
            }`}>
              {toast.type === 'error' ? <AlertCircle size={13}/> : <CheckCircle size={13}/>}
              {toast.msg}
            </div>
          )}

          {/* Script list for active tab */}
          {loading ? (
            <div className="text-sm text-[#444] text-center py-8">Loading...</div>
          ) : byCategory[activeTab].length === 0 ? (
            <div className="text-sm text-[#444] text-center py-8">
              No {activeCategory.label.toLowerCase()} scripts yet
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-[10px] text-[#444] uppercase tracking-widest">
                {byCategory[activeTab].length} script{byCategory[activeTab].length !== 1 ? 's' : ''}
              </div>
              {byCategory[activeTab].map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 border border-[#1a1a1a] rounded bg-[#080808] hover:border-[#222] transition-colors">
                  <Icon size={13} style={{ color: activeCategory.color + '99', flexShrink: 0 }}/>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#ccc] truncate">{s.title}</div>
                    <div className="text-[11px] text-[#444] mt-0.5">
                      ~{Math.round((s.content?.length || 0) / 5)} words · {new Date(s.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-[#333] hover:text-red-400 transition-colors p-1 shrink-0"
                  >
                    <Trash2 size={12}/>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Summary across all categories */}
          {scripts.length > 0 && (
            <div className="flex items-center gap-4 pt-2 border-t border-[#111]">
              {CATEGORIES.map(cat => {
                const count = byCategory[cat.key]?.length || 0
                if (!count) return null
                const CatIcon = cat.icon
                return (
                  <div key={cat.key} className="flex items-center gap-1.5 text-xs text-[#444]">
                    <CatIcon size={10} style={{ color: cat.color + '80' }}/>
                    {count} {cat.label.toLowerCase()}
                  </div>
                )
              })}
              <span className="text-[10px] text-[#333] ml-auto">All visible to KP</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}