// frontend/src/components/editor/ContinuityReport.jsx
// Displays the Claude-powered narrative continuity score.
// Shows issues with severity, highlights what's working,
// and gives specific actionable fix suggestions.

import { useState } from 'react'
import { CheckCircle, AlertTriangle, AlertCircle, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'

export default function ContinuityReport({ report, onSwapRequest }) {
  const [showAll, setShowAll] = useState(false)

  if (!report?.ready) return null

  const { score, overallVerdict, issues = [], highlights = [], energyArc, fixPriority = [] } = report

  const scoreColor = score >= 80 ? '#40a060' : score >= 60 ? '#c8a030' : score >= 40 ? '#e06030' : '#e03030'
  const visibleIssues = showAll ? issues : issues.slice(0, 3)

  return (
    <div className="border border-[#1a1a1a] rounded overflow-hidden">

      {/* Header with score */}
      <div className="flex items-center gap-4 px-4 py-3 bg-[#0a0a0a] border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-[rgba(74,222,128,1)]"/>
          <span className="text-xs text-[#888]">Continuity score</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          {score !== null && (
            <>
              <div
                className="text-2xl font-serif font-bold"
                style={{ color: scoreColor }}
              >
                {score}
              </div>
              <div className="text-xs text-[#444]">/100</div>
            </>
          )}
        </div>
      </div>

      {/* Verdict */}
      {overallVerdict && (
        <div className="px-4 py-3 border-b border-[#111]">
          <p className="text-xs text-[#666] leading-relaxed">{overallVerdict}</p>
        </div>
      )}

      {/* Issues */}
      {issues.length > 0 && (
        <div className="px-4 py-3 space-y-3 border-b border-[#111]">
          <div className="text-xs text-[#555] uppercase tracking-wide">
            Issues ({issues.length})
            {fixPriority.length > 0 && (
              <span className="ml-2 text-[#c8a030]">— fix clips {fixPriority.slice(0,3).map(i => i+1).join(', ')} first</span>
            )}
          </div>

          {visibleIssues.map((issue, i) => (
            <div key={i} className={`flex items-start gap-3 text-xs rounded p-2.5 ${
              issue.severity === 'high'   ? 'bg-red-950/20 border border-red-900/20' :
              issue.severity === 'medium' ? 'bg-[#1a1200] border border-[#2a2000]' :
              'bg-[#0d0d0d] border border-[#111]'
            }`}>
              {issue.severity === 'high'
                ? <AlertCircle  size={12} className="text-red-400 mt-0.5 shrink-0"/>
                : issue.severity === 'medium'
                ? <AlertTriangle size={12} className="text-[#c8a030] mt-0.5 shrink-0"/>
                : <AlertTriangle size={12} className="text-[#555] mt-0.5 shrink-0"/>
              }
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#888]">Clip {(issue.clipIndex ?? 0) + 1}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    issue.severity === 'high' ? 'text-red-400' :
                    issue.severity === 'medium' ? 'text-[#c8a030]' : 'text-[#555]'
                  }`}>{issue.severity}</span>
                </div>
                <div className="text-[#666]">{issue.description}</div>
                {issue.suggestion && (
                  <div className="text-[#888] border-l-2 border-[rgba(74,222,128,0.30)] pl-2">{issue.suggestion}</div>
                )}
                {onSwapRequest && issue.clipIndex !== undefined && (
                  <button
                    onClick={() => onSwapRequest(issue.clipIndex)}
                    className="text-[10px] text-[rgba(74,222,128,1)] hover:underline mt-1"
                  >
                    → Find replacement clip
                  </button>
                )}
              </div>
            </div>
          ))}

          {issues.length > 3 && (
            <button
              onClick={() => setShowAll(s => !s)}
              className="flex items-center gap-1 text-xs text-[#444] hover:text-[#888] transition-colors"
            >
              {showAll ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
              {showAll ? 'Show less' : `Show ${issues.length - 3} more issues`}
            </button>
          )}
        </div>
      )}

      {/* Highlights */}
      {highlights.length > 0 && (
        <div className="px-4 py-3 space-y-2 border-b border-[#111]">
          <div className="text-xs text-[#555] uppercase tracking-wide">What's working</div>
          {highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <CheckCircle size={12} className="text-[#40a060] mt-0.5 shrink-0"/>
              <div>
                <span className="text-[#40a060]">Clip {(h.clipIndex ?? 0) + 1}</span>
                <span className="text-[#555] ml-2">{h.reason}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Energy arc */}
      {energyArc && (
        <div className="px-4 py-3">
          <div className="text-xs text-[#555] uppercase tracking-wide mb-1">Energy arc</div>
          <p className="text-xs text-[#444] leading-relaxed">{energyArc}</p>
        </div>
      )}
    </div>
  )
}