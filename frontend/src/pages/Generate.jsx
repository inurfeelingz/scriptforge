// frontend/src/pages/Generate.jsx
import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Sparkles, Upload, FileText, Music2, Mic, ChevronDown, ChevronUp, Download, Check } from 'lucide-react'
import { useStore } from '../store'
import SessionJournal from '../components/companion/SessionJournal'
import { episodes as episodesApi } from '../lib/api'
import { requestNotificationPermission, notifyGeneration } from '../lib/notifications'

export default function Generate() {
  const { activeCategoryId, activeCategory, notify } = useStore()

  // ── Persistent defaults (survive tab close) ──────────────────────────────
  const PERSIST_KEYS = ['mood', 'genre', 'bpm', 'targetDurationMinutes']

  const storedDefaults = (() => {
    try { return JSON.parse(localStorage.getItem('sf_generate_defaults') || '{}') }
    catch { return {} }
  })()

  const [form, setForm] = useState({
    trackName:             '',
    mood:                  storedDefaults.mood                  || '',
    genre:                 storedDefaults.genre                 || '',
    bpm:                   storedDefaults.bpm                   || '',
    platformLink:          '',
    voiceMemoText:         '',
    episodeNumber:         '',
    targetDurationMinutes: storedDefaults.targetDurationMinutes || '8',
  })

  const [clips,          setClips]          = useState([])
  const [generating,     setGenerating]     = useState(false)
  const [phase,          setPhase]          = useState('')
  const [pct,            setPct]            = useState(0)
  const [reasoning,      setReasoning]      = useState('')
  const [scriptStream,   setScriptStream]   = useState('')
  const [result,         setResult]         = useState(null)
  const [showReasoning,  setShowReasoning]  = useState(true)
  const [showSessions,   setShowSessions]   = useState(false)
  const [nextEpNumber,   setNextEpNumber]   = useState(null)

  const reasoningRef = useRef(null)
  const scriptRef    = useRef(null)
  const autosaveRef  = useRef(null)

  const cat = activeCategory?.()

  // ── Draft save / restore ─────────────────────────────────────────────────

  const saveDraft = () => {
    try {
      localStorage.setItem('sf_generate_draft', JSON.stringify({
        ...form, _savedAt: Date.now(), _v: 2,
      }))
    } catch {}
  }

  // Restore draft on mount (useEffect — NOT useState) ← Bug fix
  useEffect(() => {
    try {
      const raw   = localStorage.getItem('sf_generate_draft')
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft._v !== 2) return                           // stale schema
      if (Date.now() - (draft._savedAt || 0) > 24 * 60 * 60 * 1000) return  // too old
      setForm(f => ({
        ...f,
        trackName:     draft.trackName     || f.trackName,
        voiceMemoText: draft.voiceMemoText || f.voiceMemoText,
        platformLink:  draft.platformLink  || f.platformLink,
        // Don't restore episodeNumber — always auto-set from series
      }))
    } catch {}
  }, [])  // empty deps — run once on mount only

  // Auto-save draft on any form change
  useEffect(() => {
    clearTimeout(autosaveRef.current)
    autosaveRef.current = setTimeout(saveDraft, 20000)
    return () => clearTimeout(autosaveRef.current)
  }, [form])

  // Save immediately on tab hide / page unload
  useEffect(() => {
    const save = () => saveDraft()
    document.addEventListener('visibilitychange', save)
    window.addEventListener('beforeunload', save)
    return () => {
      document.removeEventListener('visibilitychange', save)
      window.removeEventListener('beforeunload', save)
    }
  }, [form])

  // ── Pre-fill from URL params (duplicate flow from SeriesPage) ───────────
  const [searchParams] = useSearchParams()

  useEffect(() => {
    const trackName    = searchParams.get('trackName')
    const from         = searchParams.get('from')
    if (from === 'duplicate' && trackName) {
      setForm(f => ({
        ...f,
        trackName:     trackName,
        mood:          searchParams.get('mood')   || f.mood,
        genre:         searchParams.get('genre')  || f.genre,
        bpm:           searchParams.get('bpm')    || f.bpm,
        episodeNumber: searchParams.get('episodeNumber') || f.episodeNumber,
      }))
    }
  }, [])

  // ── Auto episode number ───────────────────────────────────────────────────
  // Load the next episode number from the server so the user can't accidentally
  // overwrite an existing episode by leaving the field blank

  useEffect(() => {
    if (!activeCategoryId) return
    import('../lib/api').then(({ episodes: epApi }) => {
      epApi.list({ categoryId: activeCategoryId, limit: 1 })
        .then(({ episodes }) => {
          const next = episodes?.length ? (episodes[0].episode_number + 1) : 1
          setNextEpNumber(next)
          setForm(f => ({ ...f, episodeNumber: String(next) }))
        })
        .catch(() => {})
    })
  }, [activeCategoryId])


  function setField(k, v) {
    setForm(f => {
      const next = { ...f, [k]: v }
      // Persist stable fields (mood/genre/bpm) — not the per-episode fields
      if (PERSIST_KEYS.includes(k)) {
        try {
          const current = JSON.parse(localStorage.getItem('sf_generate_defaults') || '{}')
          localStorage.setItem('sf_generate_defaults', JSON.stringify({ ...current, [k]: v }))
        } catch {}
      }
      return next
    })
  }

  function handleClipUpload(e) {
    const files = Array.from(e.target.files)
    const parsed = files.map(f => ({
      filename: f.name,
      type: f.name.toLowerCase().startsWith('daw') || f.name.includes('screen') ? 'daw' : 'cam',
    }))
    setClips(parsed)
  }

  async function generate() {
    if (!form.trackName.trim()) return notify('Track name is required', 'error')
    if (!activeCategoryId)      return notify('Select a category first', 'error')

    setGenerating(true)
    setReasoning('')
    setScriptStream('')
    setResult(null)
    setPhase('Starting...')
    setPct(0)
    requestNotificationPermission()
    window.scrollTo({ top: 0, behavior: 'smooth' })  // ask now while user is interacting (required by browsers)

    try {
      await episodesApi.generate(
        {
          categoryId:     activeCategoryId,
          episodeNumber:  parseInt(form.episodeNumber) || nextEpNumber || 1,
          trackContext: {
            name:                  form.trackName,
            mood:                  form.mood,
            genre:                 form.genre,
            bpm:                   form.bpm,
            platformLink:          form.platformLink,
            targetDurationMinutes: parseInt(form.targetDurationMinutes) || 8,
          },
          voiceMemoText:  form.voiceMemoText,
          clipInventory:  clips,
        },
        {
          progress:  ({ message, pct: p }) => { setPhase(message); setPct(p) },
          reasoning: ({ text }) => {
            setReasoning(prev => prev + text)
            reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight, behavior: 'smooth' })
          },
          chunk:     ({ text }) => {
            setScriptStream(prev => prev + text)
            scriptRef.current?.scrollTo({ top: scriptRef.current.scrollHeight, behavior: 'smooth' })
          },
          done:      ({ episodeId, parsed }) => {
            setResult({ episodeId, parsed })
            try { localStorage.removeItem('sf_generate_draft') } catch {}
            notifyGeneration(form.trackName, form.episodeNumber || '?')
            setGenerating(false)
            setPhase('Complete')
            setPct(100)
            notify('Episode package ready', 'success')
          },
          error:     ({ message }) => {
            notify('Generation failed: ' + message, 'error')
            setGenerating(false)
          },
        }
      )
    } catch (err) {
      notify(err.message, 'error')
      setGenerating(false)
    }
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Generate episode</h1>
        {cat && <p className="text-sm text-[#555] mt-1">{cat.name} · {cat.niche}</p>}
      </div>

      {/* Form */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-[#666] uppercase tracking-wide">Track name *</label>
          <input
            value={form.trackName}
            onChange={e => setField('trackName', e.target.value)}
            placeholder="Echoes"
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40 transition-colors"
          />
        </div>

        {[
          { key: 'mood',     label: 'Mood',          placeholder: 'melancholic, late night' },
          { key: 'genre',    label: 'Genre',          placeholder: 'lo-fi soul'              },
          { key: 'bpm',      label: 'BPM',            placeholder: '87'                      },
          { key: 'targetDurationMinutes', label: 'Target length (min)', placeholder: '8' },
          { key: 'episodeNumber', label: 'Episode #', placeholder: nextEpNumber ? String(nextEpNumber) : '7' },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="text-xs text-[#666] uppercase tracking-wide">{label}</label>
            <input
              value={form[key]}
              onChange={e => setField(key, e.target.value)}
              placeholder={placeholder}
              className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40 transition-colors"
            />
          </div>
        ))}

        <div className="col-span-2 space-y-1">
          <label className="text-xs text-[#666] uppercase tracking-wide">Platform link</label>
          <input
            value={form.platformLink}
            onChange={e => setField('platformLink', e.target.value)}
            placeholder="https://yourplatform.com/track/echoes"
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40 transition-colors"
          />
        </div>

        {/* Voice memo */}
        <div className="col-span-2 space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[#666] uppercase tracking-wide">Voice memo — what happened this session</label>
            <button
              type="button"
              onClick={() => setShowSessions(s => !s)}
              className="text-xs text-[#c8b89a] hover:underline"
            >
              {showSessions ? 'Hide sessions' : 'Load from session journal'}
            </button>
          </div>
          {showSessions && (
            <SessionJournal
              onSelectMemo={(memo) => {
                setField('voiceMemoText', memo)
                setShowSessions(false)
              }}
            />
          )}
          <textarea
            value={form.voiceMemoText}
            onChange={e => setField('voiceMemoText', e.target.value)}
            placeholder="Found the chord progression by accident at 2am. Tried 12 different bass sounds before the 808 locked in. The drop was supposed to be bigger but it felt too aggressive so I stripped it back..."
            rows={4}
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40 transition-colors resize-none"
          />
        </div>

        {/* Clip upload */}
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-[#666] uppercase tracking-wide">Footage inventory (optional)</label>
          <label className="flex items-center gap-3 border border-dashed border-[#222] rounded px-4 py-3 cursor-pointer hover:border-[#c8b89a]/30 transition-colors">
            <Upload size={14} className="text-[#444]"/>
            <span className="text-sm text-[#444]">
              {clips.length ? `${clips.length} clips selected` : 'Select cam-*.mp4 and daw-*.mp4 files'}
            </span>
            <input type="file" multiple accept="video/*" onChange={handleClipUpload} className="hidden"/>
          </label>
          {clips.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {clips.map((c, i) => (
                <span key={i} className={`text-xs px-2 py-1 rounded border ${
                  c.type === 'daw'
                    ? 'border-blue-800/40 text-blue-400/70'
                    : 'border-[#c8b89a]/20 text-[#c8b89a]/70'
                }`}>
                  {c.type.toUpperCase()} · {c.filename}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={generating || !form.trackName.trim()}
        className="w-full py-3 bg-[#c8b89a] text-[#080808] font-medium rounded hover:bg-[#e8c87a] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        <Sparkles size={16}/>
        {generating ? phase : 'Generate episode package'}
      </button>

      {/* Progress bar */}
      {generating && (
        <div className="h-0.5 bg-[#111] rounded overflow-hidden">
          <div
            className="h-full bg-[#c8b89a] transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Reasoning stream */}
      {(reasoning || (generating && phase.includes('structur'))) && (
        <div className="border border-[#1a1a1a] rounded overflow-hidden">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-[#666] hover:text-[#888] transition-colors bg-[#0a0a0a]"
          >
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#c8b89a]/60 animate-pulse"/>
              Claude's reasoning
            </span>
            {showReasoning ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
          </button>
          {showReasoning && (
            <div
              ref={reasoningRef}
              className="px-4 py-3 text-xs text-[#555] leading-relaxed max-h-32 overflow-y-auto bg-[#060606]"
            >
              {reasoning || 'Thinking...'}
            </div>
          )}
        </div>
      )}

      {/* Script stream */}
      {scriptStream && (
        <div className="border border-[#1a1a1a] rounded overflow-hidden">
          <div className="px-4 py-2.5 text-xs text-[#666] bg-[#0a0a0a] flex items-center gap-2">
            <FileText size={12}/>
            Writing VO script...
          </div>
          <div
            ref={scriptRef}
            className="px-4 py-3 text-xs text-[#888] leading-relaxed max-h-64 overflow-y-auto font-mono whitespace-pre-wrap bg-[#060606]"
          >
            {scriptStream}
            <span className="inline-block w-1 h-3 bg-[#c8b89a]/60 ml-0.5 animate-pulse align-middle"/>
          </div>
        </div>
      )}

      {/* Result package */}
      {result && (
        <div className="border border-[#c8b89a]/20 rounded overflow-hidden">
          <div className="px-4 py-3 bg-[#c8b89a]/5 border-b border-[#c8b89a]/10 flex items-center gap-2">
            <Check size={14} className="text-[#c8b89a]"/>
            <span className="text-sm text-[#c8b89a]">Episode package ready</span>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {result.parsed?.voScript && (
              <DownloadCard
                label="VO Script"
                icon={<Mic size={14}/>}
                onClick={() => downloadFile(result.parsed.voScript, `ep-vo-script.txt`)}
              />
            )}
            {result.parsed?.edlClipMap && (
              <DownloadCard
                label="EDL for DaVinci"
                icon={<FileText size={14}/>}
                onClick={() => downloadFile(buildEDL(result.parsed.edlClipMap), `episode.edl`)}
              />
            )}
            {result.parsed?.metadata && (
              <DownloadCard
                label="All Metadata"
                icon={<Download size={14}/>}
                onClick={() => downloadFile(result.parsed.metadata, `ep-metadata.txt`)}
              />
            )}
            {result.parsed?.shortformMoments && (
              <DownloadCard
                label="Short-form Cuts"
                icon={<Music2 size={14}/>}
                onClick={() => downloadFile(result.parsed.shortformMoments, `ep-shorts.txt`)}
              />
            )}
          </div>

          {/* Energy curve */}
          {result.parsed?.energyCurve && (
            <div className="px-4 pb-4">
              <div className="text-xs text-[#555] mb-2">Energy curve</div>
              <div className="text-xs text-[#444] font-mono whitespace-pre-wrap leading-relaxed border border-[#111] rounded p-3 bg-[#060606]">
                {result.parsed.energyCurve}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DownloadCard({ label, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 border border-[#1a1a1a] rounded hover:border-[#c8b89a]/30 hover:bg-[#c8b89a]/5 transition-all text-left"
    >
      <span className="text-[#c8b89a]/60">{icon}</span>
      <span className="text-sm text-[#888]">{label}</span>
      <Download size={12} className="ml-auto text-[#333]"/>
    </button>
  )
}

function buildEDL(clipMapText) {
  if (!clipMapText) return ''
  const lines = clipMapText.split('\n').filter(l => l.trim().startsWith('CLIP_'))
  let edl = `TITLE: episode\nFCM: NON-DROP FRAME\n\n`
  let recTC = 90000 // 01:00:00:00 at 25fps
  lines.forEach((line, idx) => {
    const parts   = line.split('|').map(p => p.trim())
    const reel    = (parts[1] || `clip${idx+1}`).replace(/[^a-z0-9_-]/gi,'_').slice(0,32)
    const srcIn   = parseTC(parts[2]?.replace('IN:','').trim() || '00:00:00:00')
    const srcOut  = parseTC(parts[3]?.replace('OUT:','').trim() || '00:00:05:00')
    const dur     = Math.max(srcOut - srcIn, 1)
    const recOut  = recTC + dur
    const n       = String(idx+1).padStart(3,'0')
    edl += `${n}  ${reel.padEnd(32)} V     C        ${tc(srcIn)} ${tc(srcOut)} ${tc(recTC)} ${tc(recOut)}\n`
    edl += `* FROM CLIP NAME: ${parts[1] || ''}\n\n`
    recTC = recOut
  })
  return edl
}

function parseTC(s) {
  const p = String(s).split(':').map(Number)
  if (p.length === 4) return ((p[0]*3600+p[1]*60+p[2])*25)+p[3]
  if (p.length === 3) return (p[0]*3600+p[1]*60+p[2])*25
  return 0
}

function tc(f) {
  const fps=25,ff=f%fps,ss=Math.floor(f/fps)%60,mm=Math.floor(f/fps/60)%60,hh=Math.floor(f/fps/3600)
  return [hh,mm,ss,ff].map(n=>String(n).padStart(2,'0')).join(':')
}


