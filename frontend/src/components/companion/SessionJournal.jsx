// frontend/src/components/companion/SessionJournal.jsx
// Displays session journal entries with timestamps.
// Used in both the Companion page and the Generate page (to pick a past session).

import { useState, useEffect } from 'react'
import { Flag, Mic, Clock, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import { api } from '../../lib/api'
import { useStore } from '../../store'

export default function SessionJournal({ onSelectMemo, onGenerateNow }) {
  const { activeCategoryId } = useStore()
  const [sessions, setSessions] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    if (!activeCategoryId) return
    api.get(`/session?categoryId=${activeCategoryId}&status=ready`)
      .then(({ sessions }) => { setSessions(sessions || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activeCategoryId])

  function formatDuration(ms) {
    if (!ms) return '?'
    const m = Math.floor(ms / 60000)
    const s = Math.floor((ms % 60000) / 1000)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  if (loading) return (
    <div className="space-y-2">
      {[...Array(2)].map((_, i) => (
        <div key={i} className="h-14 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
      ))}
    </div>
  )

  if (!sessions.length) return (
    <div className="text-xs text-[#444] text-center py-6 border border-dashed border-[#1a1a1a] rounded">
      No sessions yet — open the Companion app while making music
    </div>
  )

  return (
    <div className="space-y-2">
      {sessions.map(session => (
        <div key={session.id} className="border border-[#1a1a1a] rounded overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === session.id ? null : session.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#0d0d0d] transition-colors"
          >
            <Mic size={13} className="text-[#444] shrink-0"/>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#ccc] truncate">{session.title}</div>
              <div className="text-xs text-[#444]">
                {new Date(session.recorded_at).toLocaleDateString()} · {formatDuration(session.duration_ms)}
                {session.key_moments?.length > 0 && ` · ${session.key_moments.length} marks`}
              </div>
            </div>
            {expanded === session.id ? <ChevronUp size={12} className="text-[#444]"/> : <ChevronDown size={12} className="text-[#444]"/>}
          </button>

          {expanded === session.id && session.voice_memo_text && (
            <div className="px-4 pb-4 space-y-3 border-t border-[#111]">
              <div className="text-xs text-[#555] leading-relaxed mt-3">
                {session.voice_memo_text.slice(0, 300)}
                {session.voice_memo_text.length > 300 && '...'}
              </div>

              {session.key_moments?.length > 0 && (
                <div className="space-y-1">
                  {session.key_moments.slice(0, 3).map((m, i) => (
                    <div key={i} className="flex gap-2 text-xs">
                      <Flag size={10} className="text-[#c8b89a] mt-0.5 shrink-0"/>
                      <span className="text-[#c8b89a] font-mono">{m.timestampFmt}</span>
                      <span className="text-[#444]">{m.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {(onSelectMemo || onGenerateNow) && (
                <div className="flex gap-2">
                  {onSelectMemo && (
                    <button
                      onClick={() => onSelectMemo(session.voice_memo_text, session)}
                      className="flex-1 py-2 bg-[#c8b89a]/5 border border-[#c8b89a]/15 text-[#c8b89a]/70 rounded text-xs hover:bg-[#c8b89a]/10 transition-all"
                    >
                      Load memo
                    </button>
                  )}
                  {onGenerateNow && (
                    <button
                      onClick={() => onGenerateNow(session.voice_memo_text, session)}
                      className="flex-1 py-2 bg-[#c8b89a]/10 border border-[#c8b89a]/30 text-[#c8b89a] rounded text-xs hover:bg-[#c8b89a]/20 transition-all flex items-center justify-center gap-1.5 font-medium"
                    >
                      <Sparkles size={10}/> Generate now →
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}