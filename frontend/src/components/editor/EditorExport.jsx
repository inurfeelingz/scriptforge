// frontend/src/components/editor/EditorExport.jsx
// Export timeline as EDL (working), FCPXML (stub), OTIO (stub)
// STATUS: EDL WORKING — others are stubs

import { useState } from 'react'
import { Download, FileText, Check } from 'lucide-react'
import { useStore } from '../../store'
import { getSession } from '../../lib/supabase'

const FORMATS = [
  {
    key:         'edl',
    label:       'CMX3600 EDL',
    description: 'Import into DaVinci: File → Import Timeline → Import EDL',
    status:      'working',
    extension:   '.edl',
  },
  {
    key:         'fcpxml',
    label:       'FCPXML',
    description: 'Final Cut Pro / DaVinci project file with full asset references',
    status:      'stub',
    extension:   '.fcpxml',
  },
  {
    key:         'otio',
    label:       'OpenTimelineIO',
    description: 'Open standard — compatible with most professional NLEs',
    status:      'stub',
    extension:   '.otio',
  },
]

export default function EditorExport({ project }) {
  const { notify }    = useStore()
  const [exporting, setExporting] = useState(null)
  const [exported,  setExported]  = useState(null)

  async function handleExport(format) {
    if (!project?.id) return notify('No project selected', 'error')

    const timeline = project.timeline || []
    if (!timeline.length) return notify('Timeline is empty — assemble first', 'error')

    setExporting(format)

    try {
      const session  = await getSession()
      const apiUrl   = import.meta.env.VITE_API_URL || '/api'

      const res = await fetch(`${apiUrl}/editor/projects/${project.id}/export`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ format }),
      })

      if (!res.ok) throw new Error(`Export failed: ${res.status}`)

      const blob     = await res.blob()
      const fmt      = FORMATS.find(f => f.key === format)
      const filename = `${(project.name || 'edit').replace(/\s+/g,'-')}${fmt.extension}`

      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)

      setExported(format)
      notify(`${fmt.label} downloaded`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    }

    setExporting(null)
  }

  const timeline = project?.timeline || []

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Timeline summary */}
      <div className="border border-[#1a1a1a] rounded p-4 space-y-2">
        <h3 className="text-sm text-[#888]">Timeline summary</h3>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-[#444]">Clips</div>
            <div className="text-[#ccc] text-base mt-0.5">{timeline.length}</div>
          </div>
          <div>
            <div className="text-[#444]">Approved</div>
            <div className="text-[#40a060] text-base mt-0.5">{timeline.filter(c => c.approved).length}</div>
          </div>
          <div>
            <div className="text-[#444]">Flagged</div>
            <div className="text-[#c8a030] text-base mt-0.5">{(project?.ai_flags || []).length}</div>
          </div>
        </div>
        {timeline.filter(c => !c.approved && !c.isPlaceholder).length > 0 && (
          <div className="text-xs text-[#555] border-t border-[#111] pt-2 mt-2">
            {timeline.filter(c => !c.approved && !c.isPlaceholder).length} clips not yet reviewed — you can still export
          </div>
        )}
      </div>

      {/* Export formats */}
      <div className="space-y-3">
        <h3 className="text-sm text-[#888]">Export format</h3>
        {FORMATS.map(fmt => (
          <div key={fmt.key} className="flex items-center gap-4 border border-[#1a1a1a] rounded p-4 hover:border-[#222] transition-colors">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#ccc]">{fmt.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  fmt.status === 'working'
                    ? 'border-[#40a060]/30 text-[#40a060]'
                    : 'border-[#333] text-[#444]'
                }`}>{fmt.status}</span>
              </div>
              <div className="text-xs text-[#444] mt-1">{fmt.description}</div>
            </div>
            <button
              onClick={() => handleExport(fmt.key)}
              disabled={exporting === fmt.key || !timeline.length}
              className={`flex items-center gap-2 px-4 py-2 rounded border text-sm transition-all disabled:opacity-40 ${
                exported === fmt.key
                  ? 'border-[#40a060]/40 text-[#40a060]'
                  : 'border-[#1a1a1a] text-[#666] hover:border-[#c8b89a]/30 hover:text-[#c8b89a]'
              }`}
            >
              {exporting === fmt.key ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"/>
              ) : exported === fmt.key ? (
                <Check size={13}/>
              ) : (
                <Download size={13}/>
              )}
              {exporting === fmt.key ? 'Exporting...' : exported === fmt.key ? 'Downloaded' : 'Export'}
            </button>
          </div>
        ))}
      </div>

      {/* DaVinci instructions */}
      <div className="border border-[#1a1a1a] rounded p-4 space-y-2">
        <h3 className="text-xs text-[#666] uppercase tracking-wide">After export — DaVinci workflow</h3>
        <ol className="text-xs text-[#444] space-y-1.5">
          <li>1. Open DaVinci Resolve</li>
          <li>2. Add your footage folder to the Media Pool (drag or File → Import Media)</li>
          <li>3. File → Import Timeline → Import EDL → select the .edl file</li>
          <li>4. DaVinci auto-matches clips by filename</li>
          <li>5. Review, record VO on track A1, apply colour grade, export</li>
        </ol>
      </div>
    </div>
  )
}
