// frontend/src/components/layout/PipelineGate.jsx
// Shows a locked state with CTA when an episode hasn't reached the required pipeline stage.
// Usage: <PipelineGate stage="vo_recorded" episode={episode} />
// Stages: generated → vo_recorded → footage_uploaded → edited → published

import { useNavigate } from 'react-router-dom'
import { Lock } from 'lucide-react'

const STAGE_ORDER = ['generated', 'vo_recorded', 'footage_uploaded', 'edited', 'published']

const STAGE_META = {
  generated:        { label: 'Episode generated',   cta: 'Generate episode first',    route: '/generate' },
  vo_recorded:      { label: 'VO recorded',         cta: 'Record your VO',            route: '/teleprompter' },
  footage_uploaded: { label: 'Footage indexed',     cta: 'Index your footage',        route: '/editor' },
  edited:           { label: 'Edit approved',       cta: 'Review your edit',          route: '/editor' },
  published:        { label: 'Published',           cta: 'Package & publish',         route: '/schedule' },
}

// Returns true if episode has reached or passed the required stage
export function hasReachedStage(episode, requiredStage) {
  if (!episode) return false
  const epIdx  = STAGE_ORDER.indexOf(episode.pipeline_stage || episode.status === 'ready' ? 'generated' : '')
  const reqIdx = STAGE_ORDER.indexOf(requiredStage)
  if (epIdx === -1 || reqIdx === -1) return false
  return epIdx >= reqIdx
}

export default function PipelineGate({ stage, episode, children }) {
  const navigate = useNavigate()

  // If no episode selected yet, show children (let the page handle empty state)
  if (!episode) return children

  // Map old status field to pipeline stage for backwards compat
  const currentStage = episode.pipeline_stage ||
    (episode.status === 'ready' || episode.status === 'draft' ? 'generated' : null)

  if (!currentStage) return children

  const currentIdx  = STAGE_ORDER.indexOf(currentStage)
  const requiredIdx = STAGE_ORDER.indexOf(stage)

  if (currentIdx === -1 || requiredIdx === -1) return children
  if (currentIdx >= requiredIdx) return children

  // Locked — episode hasn't reached this stage yet
  const required = STAGE_META[stage]
  const current  = STAGE_META[currentStage]

  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-5 text-center">
      <div className="w-14 h-14 rounded-full border border-[#1a1a1a] flex items-center justify-center">
        <Lock size={20} className="text-[#333]"/>
      </div>
      <div>
        <div className="text-sm text-[#666]">This step requires: <span className="text-[#888]">{required?.label}</span></div>
        <div className="text-xs text-[#444] mt-1">
          {episode.track_name
            ? `"${episode.track_name}" is at: ${current?.label || currentStage}`
            : `Complete the previous step first`}
        </div>
      </div>
      <button
        onClick={() => navigate(required?.route || '/')}
        className="px-6 py-2.5 bg-[rgba(74,222,128,0.10)] border border-[rgba(74,222,128,0.20)] text-[rgba(74,222,128,1)] rounded text-sm hover:bg-[rgba(74,222,128,0.20)] transition-all"
      >
        {required?.cta} →
      </button>
    </div>
  )
}