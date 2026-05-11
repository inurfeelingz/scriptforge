// frontend/src/pages/EditorPage.jsx
// Main editor page — tabbed interface with Library, Timeline, and Export
// STATUS: WIRED — sub-components are stubs, ready to flesh out

import { useState, useEffect } from 'react'
import { Layers, Film, Download, Cpu, FolderOpen } from 'lucide-react'
import { useStore } from '../store'
import NextStepBanner from '../components/layout/NextStepBanner'
import { useClipIndexer } from '../hooks/useClipIndexer'
import ClipLibrary   from '../components/editor/ClipLibrary'
import HybridTimeline from '../components/editor/HybridTimeline'
import EditorExport  from '../components/editor/EditorExport'
import IndexingPanel from '../components/editor/IndexingPanel'
import { api, episodes as episodesApi } from '../lib/api'

const TABS = [
  { key: 'library',  label: 'Clip library',  icon: Layers },
  { key: 'timeline', label: 'Timeline',       icon: Film   },
  { key: 'export',   label: 'Export',         icon: Download },
]

export default function EditorPage() {
  const { activeCategoryId, activeCategory } = useStore()
  const [tab,       setTab]       = useState('library')
  const [project,   setProject]   = useState(null)
  const [projects,  setProjects]  = useState([])
  const [showIndex, setShowIndex] = useState(false)

  const cat      = activeCategory?.()
  const indexer  = useClipIndexer()

  useEffect(() => {
    if (!activeCategoryId) return
    api.get(`/editor/projects?categoryId=${activeCategoryId}`)
      .then(({ projects }) => setProjects(projects || []))
      .catch(console.warn)
  }, [activeCategoryId])
  async function createProject(episodeId, name) {
    const { project } = await api.post('/editor/projects', {
      categoryId: activeCategoryId,
      episodeId,
      name,
    })
    setProjects(prev => [project, ...prev])
    setProject(project)
    setTab('timeline')
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif text-[#f0ede8]">Vision editor</h1>
          {cat && <p className="text-sm text-[#555] mt-1">{cat.name}</p>}
        </div>
        <div className="flex items-center gap-3">
          {/* Index stats badge */}
          {indexer.stats?.total > 0 && (
            <div className="text-xs text-[#555] border border-[#1a1a1a] rounded px-3 py-1.5">
              {indexer.stats.total} clips indexed
            </div>
          )}
          <button
            onClick={() => setShowIndex(true)}
            className="flex items-center gap-2 px-3 py-2 border border-[#1a1a1a] rounded text-sm text-[#666] hover:border-[#333] hover:text-[#aaa] transition-all"
          >
            <Cpu size={14}/>
            {indexer.stats?.total ? 'Re-index' : 'Index footage'}
          </button>
        </div>
      </div>

      {/* No clips indexed yet */}
      {!indexer.stats?.total && !showIndex && (
        <div className="border border-dashed border-[#222] rounded p-10 text-center space-y-4">
          <FolderOpen size={32} className="mx-auto text-[#333]"/>
          <div>
            <div className="text-sm text-[#666]">No clips indexed yet</div>
            <div className="text-xs text-[#444] mt-1">
              Link your footage folder and run indexing to enable AI-assisted editing
            </div>
          </div>
          <button
            onClick={() => setShowIndex(true)}
            className="px-6 py-2.5 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium hover:bg-[#e8c87a] transition-all"
          >
            Get started
          </button>
        </div>
      )}

      {/* Indexing panel */}
      {showIndex && (
        <IndexingPanel
          indexer={indexer}
          onClose={() => setShowIndex(false)}
        />
      )}

      {/* Project selector */}
      {indexer.stats?.total > 0 && (
        <div className="flex items-center gap-3">
          <select
            value={project?.id || ''}
            onChange={e => {
              const p = projects.find(p => p.id === e.target.value)
              setProject(p || null)
            }}
            className="bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2 text-sm text-[#ddd] outline-none focus:border-[#c8b89a]/40"
          >
            <option value="">Select a project...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={() => {
              const name = `Edit ${new Date().toLocaleDateString()}`
              createProject(null, name)
            }}
            className="px-3 py-2 border border-[#1a1a1a] rounded text-sm text-[#666] hover:text-[#aaa] hover:border-[#333] transition-all"
          >
            + New project
          </button>
        </div>
      )}

      {/* Tabs */}
      {project && (
        <>
          <div className="flex border-b border-[#1a1a1a]">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-all ${
                  tab === key
                    ? 'border-[#c8b89a] text-[#c8b89a]'
                    : 'border-transparent text-[#555] hover:text-[#888]'
                }`}
              >
                <Icon size={14}/> {label}
              </button>
            ))}
          </div>

          {tab === 'library'  && <ClipLibrary    project={project} computeSearchVectors={indexer.computeSearchVectors} />}
          {tab === 'timeline' && <HybridTimeline project={project} onProjectUpdate={(updated) => {
            setProject(updated)
            if (updated?.timeline?.filter(cl => cl.approved).length > 0) {
              setExportReady(true)
              if (updated?.episode_id) {
                episodesApi.patch(updated.episode_id, { pipeline_stage: 'edited' }).catch(() => {})
              }
            }
          }} />}
          {tab === 'export'   && <EditorExport    project={project} />}
        </>
      )}

    {/* Next step — shown after clips approved */}
    {exportReady && (
      <NextStepBanner
        title="Edit approved — download your package"
        subtitle="Export your EDL or FCPXML, then import into DaVinci Resolve to render your final video"
        ctaLabel="Export"
        onCta={() => setTab('export')}
      />
    )}


    {/* Pipeline CTA — after clips approved */}
    {exportReady && (
      <NextStepBanner
        title="Edit approved — download your package"
        subtitle="Export as EDL or FCPXML and import into DaVinci Resolve to render your final video"
        ctaLabel="Go to Export"
        onCta={() => setTab('export')}
      />
    )}

    </div>
  )
}