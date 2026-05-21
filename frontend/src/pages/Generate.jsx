// frontend/src/pages/Generate.jsx
// Batch 1 improvements:
//  01 — One-click session → generate (SessionJournal pre-fills everything + fires)
//  02 — Live word count vs target during VO script stream
//  03 — Regenerate individual sections without full re-run
//  04 — Hook A/B variants: generate 3 openings, pick one before full generation

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Sparkles, Upload, FileText, Music2, Mic, ChevronDown, ChevronUp,
  Download, Check, RefreshCw, Zap, AlertTriangle, X,
} from 'lucide-react'
import { useStore } from '../store'
import NextStepBanner from '../components/layout/NextStepBanner'
import SessionJournal from '../components/companion/SessionJournal'
import { episodes as episodesApi } from '../lib/api'
import { requestNotificationPermission, notifyGeneration } from '../lib/notifications'

// ── Word counter ──────────────────────────────────────────────────────────────
function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0
}

// ── Hook variant card ─────────────────────────────────────────────────────────
function HookCard({ variant, selected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(variant)}
      className={`w-full text-left p-4 rounded border transition-all space-y-2 ${
        selected
          ? 'border-[rgba(74,222,128,0.50)] bg-[rgba(74,222,128,0.08)]'
          : 'border-[#1a1a1a] hover:border-[#333] bg-[#0a0a0a]'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-[rgba(74,222,128,0.70)]">
          {variant.label}
        </span>
        {selected && <Check size={12} className="text-[rgba(74,222,128,1)]"/>}
      </div>
      <p className="text-sm text-[#ccc] leading-relaxed">{variant.hook}</p>
    </button>
  )
}

// ── Section regenerate button ─────────────────────────────────────────────────
function RegenButton({ label, section, episodeId, onDone, disabled }) {
  const [loading, setLoading] = useState(false)
  const { notify } = useStore()

  async function run() {
    if (!episodeId) return
    setLoading(true)
    let text = ''
    try {
      await episodesApi.regenerateSection(episodeId, section, {
        chunk: ({ text: t }) => { text += t },
        done:  ({ content }) => {
          onDone(section, content)
          notify(`${label} regenerated`, 'success')
        },
        error: ({ message }) => notify('Regen failed: ' + message, 'error'),
      })
    } catch (err) {
      notify(err.message, 'error')
    }
    setLoading(false)
  }

  return (
    <button
      onClick={run}
      disabled={disabled || loading || !episodeId}
      className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded border border-[#1a1a1a] text-[#555] hover:border-[rgba(74,222,128,0.30)] hover:text-[rgba(74,222,128,1)] disabled:opacity-30 transition-all"
    >
      {loading ? <RefreshCw size={9} className="animate-spin"/> : <Zap size={9}/>}
      {loading ? 'Regenerating…' : `Regen ${label}`}
    </button>
  )
}

// ── Niche → form field config ─────────────────────────────────────────────────
// Detects the workspace niche and returns appropriate context fields
// instead of always showing music-specific BPM/mood/genre
function getNicheConfig(niche = '') {
  const n = niche.toLowerCase()

  // Music / audio niches
  if (/music|beat|producer|lofi|lo.fi|hip.hop|jazz|soul|edm|band|album|track|song|audio/.test(n)) {
    return {
      subjectLabel: 'Track name',
      subjectPlaceholder: 'Echoes',
      fields: [
        { key: 'mood',  label: 'Mood',  placeholder: 'melancholic, late night' },
        { key: 'genre', label: 'Genre', placeholder: 'lo-fi soul' },
        { key: 'bpm',   label: 'BPM',   placeholder: '87' },
      ],
      platformLabel: 'Stream link',
      platformPlaceholder: 'https://open.spotify.com/track/...',
    }
  }

  // Cooking / food niches
  if (/cook|food|recipe|chef|kitchen|bake|restaurant|eat|cuisine/.test(n)) {
    return {
      subjectLabel: 'Dish / recipe',
      subjectPlaceholder: 'Jollof rice — the real way',
      fields: [
        { key: 'mood',  label: 'Vibe',      placeholder: 'comforting, celebratory' },
        { key: 'genre', label: 'Cuisine',   placeholder: 'West African' },
        { key: 'bpm',   label: 'Prep time', placeholder: '45 min' },
      ],
      platformLabel: 'Recipe link',
      platformPlaceholder: 'https://yoursite.com/recipe/...',
    }
  }

  // Tech / coding niches
  if (/tech|code|coding|software|dev|engineer|saas|app|startup|ai|machine/.test(n)) {
    return {
      subjectLabel: 'Topic / project',
      subjectPlaceholder: 'Building a real-time chat app',
      fields: [
        { key: 'mood',  label: 'Angle',      placeholder: 'beginner-friendly, deep dive' },
        { key: 'genre', label: 'Stack',      placeholder: 'React, Supabase' },
        { key: 'bpm',   label: 'Difficulty', placeholder: 'intermediate' },
      ],
      platformLabel: 'Repo / demo link',
      platformPlaceholder: 'https://github.com/...',
    }
  }

  // Fitness / health niches
  if (/fit|gym|workout|health|wellness|yoga|sport|run|train|body/.test(n)) {
    return {
      subjectLabel: 'Workout / topic',
      subjectPlaceholder: 'Full body HIIT — 20 min',
      fields: [
        { key: 'mood',  label: 'Energy',    placeholder: 'intense, motivating' },
        { key: 'genre', label: 'Type',      placeholder: 'strength, cardio' },
        { key: 'bpm',   label: 'Duration',  placeholder: '20 min' },
      ],
      platformLabel: 'Programme link',
      platformPlaceholder: 'https://yoursite.com/programme/...',
    }
  }

  // Finance / business niches
  if (/financ|invest|money|business|entrepreneur|market|stock|crypto|wealth|tax/.test(n)) {
    return {
      subjectLabel: 'Topic',
      subjectPlaceholder: 'Why most people retire broke',
      fields: [
        { key: 'mood',  label: 'Tone',     placeholder: 'urgent, eye-opening' },
        { key: 'genre', label: 'Category', placeholder: 'personal finance, investing' },
        { key: 'bpm',   label: 'Audience', placeholder: 'beginners, millennials' },
      ],
      platformLabel: 'Resource link',
      platformPlaceholder: 'https://yoursite.com/guide/...',
    }
  }

  // Gaming niches
  if (/game|gaming|stream|esport|twitch|youtube.*gam|playthrough|review.*game/.test(n)) {
    return {
      subjectLabel: 'Game / topic',
      subjectPlaceholder: 'Elden Ring — first boss breakdown',
      fields: [
        { key: 'mood',  label: 'Vibe',   placeholder: 'hype, chill commentary' },
        { key: 'genre', label: 'Genre',  placeholder: 'action RPG, FPS' },
        { key: 'bpm',   label: 'Format', placeholder: 'tips, review, playthrough' },
      ],
      platformLabel: 'Game / store link',
      platformPlaceholder: 'https://store.steampowered.com/...',
    }
  }

  // Travel niches
  if (/travel|vlog|country|city|tour|adventure|explore|destination/.test(n)) {
    return {
      subjectLabel: 'Destination / story',
      subjectPlaceholder: 'Cape Town in 48 hours',
      fields: [
        { key: 'mood',  label: 'Vibe',     placeholder: 'adventurous, laid-back' },
        { key: 'genre', label: 'Type',     placeholder: 'budget travel, luxury' },
        { key: 'bpm',   label: 'Duration', placeholder: '3 days' },
      ],
      platformLabel: 'Hotel / booking link',
      platformPlaceholder: 'https://airbnb.com/...',
    }
  }

  // Education / tutorial niches
  if (/educat|teach|learn|tutor|course|lesson|school|university|skill/.test(n)) {
    return {
      subjectLabel: 'Lesson / topic',
      subjectPlaceholder: 'Understanding compound interest',
      fields: [
        { key: 'mood',  label: 'Tone',       placeholder: 'engaging, no-fluff' },
        { key: 'genre', label: 'Subject',    placeholder: 'maths, history, design' },
        { key: 'bpm',   label: 'Level',      placeholder: 'beginner, advanced' },
      ],
      platformLabel: 'Course / resource link',
      platformPlaceholder: 'https://yoursite.com/course/...',
    }
  }

  // Default — generic video creator
  return {
    subjectLabel: 'Episode topic',
    subjectPlaceholder: 'What this episode is about',
    fields: [
      { key: 'mood',  label: 'Tone',     placeholder: 'educational, entertaining' },
      { key: 'genre', label: 'Category', placeholder: 'your content category' },
      { key: 'bpm',   label: 'Format',   placeholder: 'interview, solo, b-roll' },
    ],
    platformLabel: 'Reference link',
    platformPlaceholder: 'https://...',
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Generate() {
  const { activeCategoryId, activeCategory, notify, setActiveEpisodeId } = useStore()

  const PERSIST_KEYS = ['mood', 'genre', 'bpm', 'targetDurationMinutes']
  const storedDefaults = (() => {
    try { return JSON.parse(localStorage.getItem('wc_generate_defaults') || '{}') } catch { return {} }
  })()

  const [form, setForm] = useState({
    trackName:             '',
    mood:                  storedDefaults.mood                  || '',
    genre:                 storedDefaults.genre                 || '',
    bpm:                   storedDefaults.bpm                   || '',
    platformLink:          '',
    voiceMemoText:         '',
    thumbnailConcept:      '',
    episodeNumber:         '',
    targetDurationMinutes: storedDefaults.targetDurationMinutes || '8',
  })

  const [clips,           setClips]           = useState([])
  const [generating,      setGenerating]      = useState(false)
  const [phase,           setPhase]           = useState('')
  const [pct,             setPct]             = useState(0)
  const [reasoning,       setReasoning]       = useState('')
  const [scriptStream,    setScriptStream]    = useState('')
  const [result,          setResult]          = useState(null)
  const [showReasoning,   setShowReasoning]   = useState(true)
  const [showSessions,    setShowSessions]    = useState(false)
  const [nextEpNumber,    setNextEpNumber]    = useState(null)

  // 01 — Session pre-fill
  const [sessionSource,   setSessionSource]   = useState(null)

  // 02 — Word count
  const [wordCount,       setWordCount]       = useState(0)
  const targetWords = Math.round((parseInt(form.targetDurationMinutes) || 8) * 130)

  // 03 — Section regen
  const [episodeId,       setEpisodeId]       = useState(null)
  const [parsedResult,    setParsedResult]    = useState(null)

  // 04 — Hook variants
  const [hookVariants,    setHookVariants]    = useState(null)
  const [selectedHook,    setSelectedHook]    = useState(null)
  const [loadingVariants, setLoadingVariants] = useState(false)
  const [showVariants,    setShowVariants]    = useState(false)

  const reasoningRef = useRef(null)
  const scriptRef    = useRef(null)
  const autosaveRef  = useRef(null)
  const cat = activeCategory?.()
  const nicheConfig = getNicheConfig(cat?.niche || '')

  // ── Draft persistence ────────────────────────────────────────────────────
  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem('wc_generate_draft', JSON.stringify({
        ...form, _savedAt: Date.now(), _v: 2,
      }))
    } catch {}
  }, [form])

  // Pick up memo from Session Journals page ("Use in episode" button)
  useEffect(() => {
    const stored = sessionStorage.getItem('companion_memo')
    if (stored) {
      try {
        const { voiceMemoText } = JSON.parse(stored)
        if (voiceMemoText) setForm(prev => ({ ...prev, voiceMemoText }))
      } catch {}
      sessionStorage.removeItem('companion_memo')
    }
    // Pick up vault hook from Dashboard recommendations
    const hook = sessionStorage.getItem('vault_hook')
    if (hook) {
      try {
        const { title } = JSON.parse(hook)
        if (title) setForm(prev => ({ ...prev, voiceMemoText: (prev.voiceMemoText ? prev.voiceMemoText + '\n\n' : '') + `Hook idea: ${title}` }))
      } catch {}
      sessionStorage.removeItem('vault_hook')
    }
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('wc_generate_draft')
      if (!raw) return
      const draft = JSON.parse(raw)
      if (draft._v !== 2) return
      if (Date.now() - (draft._savedAt || 0) > 24 * 60 * 60 * 1000) return
      setForm(f => ({
        ...f,
        trackName:     draft.trackName     || f.trackName,
        voiceMemoText: draft.voiceMemoText || f.voiceMemoText,
        platformLink:  draft.platformLink  || f.platformLink,
      }))
    } catch {}
  }, [])

  useEffect(() => {
    clearTimeout(autosaveRef.current)
    autosaveRef.current = setTimeout(saveDraft, 20000)
    return () => clearTimeout(autosaveRef.current)
  }, [form, saveDraft])

  useEffect(() => {
    const save = () => saveDraft()
    document.addEventListener('visibilitychange', save)
    window.addEventListener('beforeunload', save)
    return () => {
      document.removeEventListener('visibilitychange', save)
      window.removeEventListener('beforeunload', save)
    }
  }, [saveDraft])

  // ── URL params (duplicate flow + companion session flow) ──────────────────
  const [searchParams] = useSearchParams()
  useEffect(() => {
    const from = searchParams.get('from')
    if (from === 'duplicate') {
      setForm(f => ({
        ...f,
        trackName:     searchParams.get('trackName')    || f.trackName,
        mood:          searchParams.get('mood')          || f.mood,
        genre:         searchParams.get('genre')         || f.genre,
        bpm:           searchParams.get('bpm')           || f.bpm,
        episodeNumber: searchParams.get('episodeNumber') || f.episodeNumber,
      }))
    }
    // Coming from Companion — auto-load the session memo
    const sessionId = searchParams.get('session')
    if (sessionId) {
      import('../lib/api').then(({ api }) => {
        api.get(`/session/${sessionId}`).then(session => {
          if (session?.voice_memo_text) {
            handleSessionSelect(session.voice_memo_text, session)
            notify(`Session loaded — ready to generate`, 'success')
          }
        }).catch(() => {})
      })
    }
  }, []) // eslint-disable-line

  // ── Auto episode number ──────────────────────────────────────────────────
  useEffect(() => {
    if (!activeCategoryId) return
    episodesApi.list({ categoryId: activeCategoryId, limit: 1 })
      .then(({ episodes }) => {
        const next = episodes?.length ? (episodes[0].episode_number + 1) : 1
        setNextEpNumber(next)
        setForm(f => ({ ...f, episodeNumber: String(next) }))
      })
      .catch(() => {})
  }, [activeCategoryId])

  // ── Word count tracking ──────────────────────────────────────────────────
  useEffect(() => {
    setWordCount(countWords(scriptStream))
  }, [scriptStream])

  // ── Field helpers ────────────────────────────────────────────────────────
  function setField(k, v) {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (PERSIST_KEYS.includes(k)) {
        try {
          const cur = JSON.parse(localStorage.getItem('wc_generate_defaults') || '{}')
          localStorage.setItem('wc_generate_defaults', JSON.stringify({ ...cur, [k]: v }))
        } catch {}
      }
      return next
    })
  }

  function handleClipUpload(e) {
    const files = Array.from(e.target.files)
    setClips(files.map(f => ({
      filename: f.name,
      type: f.name.toLowerCase().startsWith('daw') || f.name.includes('screen') ? 'daw' : 'cam',
    })))
  }

  // ── 01: Session → generate one-click ────────────────────────────────────
  function handleSessionSelect(memoText, session) {
    setSessionSource(session)
    setShowSessions(false)
    setForm(f => ({
      ...f,
      voiceMemoText: memoText,
      trackName:     f.trackName || session.title || '',
    }))
    notify(`Session loaded: "${session.title}" — ready to generate`, 'success')
  }

  function handleSessionGenerate(memoText, session) {
    // Pre-fill AND immediately fire generation
    const updatedForm = {
      ...form,
      voiceMemoText: memoText,
      trackName:     form.trackName || session.title || '',
    }
    setSessionSource(session)
    setShowSessions(false)
    setForm(updatedForm)
    // Small delay to let state settle before generating
    setTimeout(() => generateWithForm(updatedForm), 50)
  }

  // ── 04: Hook variants ────────────────────────────────────────────────────
  async function fetchHookVariants() {
    if (!form.trackName.trim()) return notify(`Enter a ${nicheConfig.subjectLabel.toLowerCase()} first`, 'error')
    if (!activeCategoryId) return notify('Select a category first', 'error')
    setLoadingVariants(true)
    setShowVariants(true)
    setSelectedHook(null)
    setHookVariants(null)
    try {
      const { variants } = await episodesApi.hookVariants({
        categoryId:    activeCategoryId,
        trackContext:  { name: form.trackName, mood: form.mood, genre: form.genre, bpm: form.bpm },
        voiceMemoText: form.voiceMemoText,
      })
      setHookVariants(variants)
    } catch (err) {
      notify('Hook variants failed: ' + err.message, 'error')
      setShowVariants(false)
    }
    setLoadingVariants(false)
  }

  // ── Generate ─────────────────────────────────────────────────────────────
  async function generate() {
    await generateWithForm(form)
  }

  async function generateWithForm(f) {
    if (!f.trackName.trim()) return notify(`${nicheConfig.subjectLabel} is required`, 'error')
    if (!activeCategoryId)   return notify('Select a category first', 'error')

    setGenerating(true)
    setReasoning('')
    setScriptStream('')
    setWordCount(0)
    setResult(null)
    setParsedResult(null)
    setEpisodeId(null)
    setPhase('Starting…')
    setPct(0)
    requestNotificationPermission()
    window.scrollTo({ top: 0, behavior: 'smooth' })

    // If a hook variant was selected, prepend it as a voice memo instruction
    const voiceMemoBoosted = selectedHook
      ? `PREFERRED HOOK (use this as the opening): "${selectedHook.hook}"\n\n${f.voiceMemoText || ''}`
      : f.voiceMemoText

    try {
      await episodesApi.generate(
        {
          categoryId:    activeCategoryId,
          episodeNumber: parseInt(f.episodeNumber) || nextEpNumber || 1,
          trackContext: {
            name:                  f.trackName,
            mood:                  f.mood,
            genre:                 f.genre,
            bpm:                   f.bpm,
            platformLink:          f.platformLink,
            targetDurationMinutes: parseInt(f.targetDurationMinutes) || 8,
            thumbnailConcept:      f.thumbnailConcept || '',
          },
          voiceMemoText: voiceMemoBoosted,
          clipInventory: clips,
        },
        {
          progress:  ({ message, pct: p }) => { setPhase(message); setPct(p) },
          reasoning: ({ text }) => {
            setReasoning(prev => prev + text)
            reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight, behavior: 'smooth' })
          },
          chunk: ({ text }) => {
            setScriptStream(prev => {
              const next = prev + text
              setWordCount(countWords(next))
              return next
            })
            scriptRef.current?.scrollTo({ top: scriptRef.current.scrollHeight, behavior: 'smooth' })
          },
          done: ({ episodeId: eid, parsed }) => {
            setResult({ episodeId: eid, parsed })
            setParsedResult(parsed)
            setEpisodeId(eid)
            try { localStorage.removeItem('wc_generate_draft') } catch {}
            notifyGeneration(f.trackName, f.episodeNumber || '?')
            setGenerating(false)
            setPhase('Complete')
            setPct(100)
            if (eid) episodesApi.patch(eid, { pipeline_stage: 'generated' }).catch(() => {})
            setSelectedHook(null)
            setShowVariants(false)
            notify('Episode package ready', 'success')
          },
          error: ({ message }) => {
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

  // ── 03: Section update handler ───────────────────────────────────────────
  function handleSectionRegen(section, content) {
    setParsedResult(prev => {
      if (!prev) return prev
      const MAP = {
        hook:         'voScript',
        vo_script:    'voScript',
        metadata:     'metadata',
        shortform:    'shortformMoments',
        energy_curve: 'energyCurve',
      }
      return { ...prev, [MAP[section]]: content }
    })
    if (section === 'vo_script' || section === 'hook') {
      setScriptStream(content)
    }
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const wordPct    = targetWords > 0 ? Math.min(100, Math.round(wordCount / targetWords * 100)) : 0
  const wordStatus = wordPct >= 95 ? 'good' : wordPct >= 75 ? 'ok' : 'low'
  const wordColor  = { good: '#40a060', ok: '#c8a030', low: 'rgba(74,222,128,1)' }[wordStatus]

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Pipeline CTA — top of page */}
      {!generating && result && episodeId && (
        <NextStepBanner
          title="Script ready — record your voiceover"
          subtitle="Open the teleprompter, load this episode and record your VO"
          ctaLabel="Record VO"
          ctaRoute="/teleprompter"
        />
      )}

      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Generate episode</h1>
        {cat && <p className="text-sm text-[#555] mt-1">{cat.name} · {cat.niche}</p>}
      </div>

      {/* No category selected */}
      {!activeCategoryId && (
        <div style={{ border: '1px dashed var(--border2)', borderRadius: 'var(--r)', padding: '3rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: '1rem', color: 'var(--text2)' }}>Select a workspace first</div>
          <div style={{ fontSize: '0.875rem', color: 'var(--text3)' }}>Open the menu and choose or create a workspace to start generating episodes</div>
        </div>
      )}

      {/* Session source banner — shown when a session was loaded */}
      {sessionSource && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[rgba(74,222,128,0.05)] border border-[rgba(74,222,128,0.20)] rounded">
          <Mic size={13} className="text-[rgba(74,222,128,1)] shrink-0"/>
          <div className="flex-1 min-w-0">
            <span className="text-sm text-[rgba(74,222,128,1)]">Session loaded: </span>
            <span className="text-sm text-[#aaa]">{sessionSource.title}</span>
          </div>
          <button onClick={() => { setSessionSource(null); setField('voiceMemoText', '') }}
            className="text-[#444] hover:text-[#888]"><X size={13}/></button>
        </div>
      )}

      {/* Form */}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-[#666] uppercase tracking-wide">{nicheConfig.subjectLabel} *</label>
          <input
            value={form.trackName}
            onChange={e => setField('trackName', e.target.value)}
            placeholder={nicheConfig.subjectPlaceholder}
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[rgba(74,222,128,0.40)] transition-colors"
          />
        </div>

        {[
          ...nicheConfig.fields,
          { key: 'targetDurationMinutes', label: 'Target length (min)', placeholder: '8' },
          { key: 'episodeNumber', label: 'Episode #', placeholder: nextEpNumber ? String(nextEpNumber) : '7' },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1">
            <label className="text-xs text-[#666] uppercase tracking-wide">{label}</label>
            <input
              value={form[key]}
              onChange={e => setField(key, e.target.value)}
              placeholder={placeholder}
              className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[rgba(74,222,128,0.40)] transition-colors"
            />
          </div>
        ))}

        <div className="col-span-2 space-y-1">
          <label className="text-xs text-[#666] uppercase tracking-wide">{nicheConfig.platformLabel}</label>
          <input
            value={form.platformLink}
            onChange={e => setField('platformLink', e.target.value)}
            placeholder={nicheConfig.platformPlaceholder}
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[rgba(74,222,128,0.40)] transition-colors"
          />
        </div>

        {/* Voice memo + session journal */}
        <div className="col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-[#666] uppercase tracking-wide">Voice memo</label>
            <button
              type="button"
              onClick={() => setShowSessions(s => !s)}
              className="text-xs text-[rgba(74,222,128,1)] hover:underline"
            >
              {showSessions ? 'Hide sessions' : 'Load from session journal'}
            </button>
          </div>
          {showSessions && (
            <SessionJournal
              onSelectMemo={handleSessionSelect}
              onGenerateNow={handleSessionGenerate}
            />
          )}
          <textarea
            value={form.voiceMemoText}
            onChange={e => setField('voiceMemoText', e.target.value)}
            placeholder="Found the chord progression by accident at 2am. Tried 12 different bass sounds before the 808 locked in..."
            rows={4}
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[rgba(74,222,128,0.40)] transition-colors resize-none"
          />
        </div>

        {/* Thumbnail concept */}
        <div className="col-span-2 space-y-2">
          <label className="text-xs text-[#666] uppercase tracking-wide">Thumbnail concept <span className="normal-case text-[#444]">— optional</span></label>
          <input
            value={form.thumbnailConcept}
            onChange={e => setField('thumbnailConcept', e.target.value)}
            placeholder="Close-up, looking directly at camera, slight smirk, dark studio behind me..."
            className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-3 py-2.5 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[rgba(74,222,128,0.40)] transition-colors"
          />
          <div className="text-[10px] text-[#333]">Describe the visual moment that stops your viewer mid-scroll. KB uses this to write a hook that matches the thumbnail promise.</div>
        </div>

        {/* Clip upload */}
        <div className="col-span-2 space-y-1">
          <label className="text-xs text-[#666] uppercase tracking-wide">Footage inventory (optional)</label>
          <label className="flex items-center gap-3 border border-dashed border-[#222] rounded px-4 py-3 cursor-pointer hover:border-[rgba(74,222,128,0.30)] transition-colors">
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
                  c.type === 'daw' ? 'border-blue-800/40 text-blue-400/70' : 'border-[rgba(74,222,128,0.20)] text-[rgba(74,222,128,0.70)]'
                }`}>{c.type.toUpperCase()} · {c.filename}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 04 — Hook variants panel */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={fetchHookVariants}
            disabled={loadingVariants || generating || !form.trackName.trim()}
            className="flex items-center gap-2 px-4 py-2 border border-[#1a1a1a] rounded text-sm text-[#666] hover:border-[rgba(74,222,128,0.30)] hover:text-[rgba(74,222,128,1)] disabled:opacity-40 transition-all"
          >
            {loadingVariants ? <RefreshCw size={13} className="animate-spin"/> : <Zap size={13}/>}
            {loadingVariants ? 'Generating hooks…' : 'Pick opening hook (optional)'}
          </button>
          {selectedHook && (
            <div className="flex items-center gap-2 text-xs text-[#40a060]">
              <Check size={11}/> Hook selected: {selectedHook.label}
              <button onClick={() => { setSelectedHook(null); setShowVariants(false) }}
                className="text-[#444] hover:text-[#888] ml-1"><X size={11}/></button>
            </div>
          )}
        </div>

        {showVariants && (
          <div className="space-y-2">
            {!hookVariants && loadingVariants && (
              <div className="space-y-2">
                {[0,1,2].map(i => (
                  <div key={i} className="h-20 bg-[#0a0a0a] border border-[#111] rounded animate-pulse"/>
                ))}
              </div>
            )}
            {hookVariants && (
              <>
                <div className="text-xs text-[#555] mb-2">Choose an opening strategy — or skip to let KP decide</div>
                {hookVariants.map((v, i) => (
                  <HookCard
                    key={i}
                    variant={v}
                    selected={selectedHook?.strategy === v.strategy}
                    onSelect={setSelectedHook}
                  />
                ))}
                <button
                  onClick={() => { setSelectedHook(null); setShowVariants(false) }}
                  className="text-xs text-[#444] hover:text-[#888] transition-colors w-full text-center py-1"
                >
                  Skip — let KP choose the hook
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={generating || !form.trackName.trim()}
        className="w-full py-3 bg-[rgba(74,222,128,1)] text-[#080808] font-medium rounded hover:bg-[rgba(74,222,128,0.85)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        <Sparkles size={16}/>
        {generating ? phase : 'Generate episode package'}
      </button>

      {/* Progress bar */}
      {generating && (
        <div className="h-0.5 bg-[#111] rounded overflow-hidden">
          <div className="h-full bg-[rgba(74,222,128,1)] transition-all duration-500" style={{ width: `${pct}%` }}/>
        </div>
      )}

      {/* Completion banner */}
      {!generating && result && (
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 16px',borderRadius:10,background:'rgba(106,184,122,0.07)',border:'1px solid rgba(106,184,122,0.2)'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{width:22,height:22,borderRadius:'50%',background:'rgba(106,184,122,0.15)',border:'1px solid rgba(106,184,122,0.4)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <span style={{color:'rgba(106,184,122,1)',fontSize:11}}>✓</span>
            </div>
            <div>
              <div style={{fontSize:12,fontWeight:600,color:'rgba(106,184,122,1)'}}>Episode package ready</div>
              <div style={{fontSize:10,color:'rgba(106,184,122,0.5)',marginTop:1}}>VO script · EDL clip map · Shorts · Metadata</div>
            </div>
          </div>
          <button
            onClick={() => document.getElementById('episode-result')?.scrollIntoView({ behavior: 'smooth' })}
            style={{fontSize:11,fontWeight:600,padding:'5px 11px',borderRadius:7,border:'1px solid rgba(106,184,122,0.3)',background:'rgba(106,184,122,0.1)',color:'rgba(106,184,122,1)',cursor:'pointer',whiteSpace:'nowrap'}}
          >
            View ↓
          </button>
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
              <span className="w-1.5 h-1.5 rounded-full bg-[rgba(74,222,128,0.60)] animate-pulse"/>
              KP's reasoning
            </span>
            {showReasoning ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
          </button>
          {showReasoning && (
            <div ref={reasoningRef}
              className="px-4 py-3 text-xs text-[#555] leading-relaxed max-h-32 overflow-y-auto bg-[#060606]"
            >
              {reasoning || 'Thinking...'}
            </div>
          )}
        </div>
      )}

      {/* 02 — Script stream with live word count */}
      {scriptStream && (
        <div className="border border-[#1a1a1a] rounded overflow-hidden">
          <div className="px-4 py-2.5 bg-[#0a0a0a] flex items-center gap-3">
            <FileText size={12} className="text-[#555]"/>
            <span className="text-xs text-[#666]">
              {generating ? 'Writing VO script…' : 'VO script'}
            </span>
            <div className="ml-auto flex items-center gap-3">
              {/* Live word counter */}
              <div className="flex items-center gap-2">
                <div className="w-20 h-1 bg-[#111] rounded overflow-hidden">
                  <div
                    className="h-full rounded transition-all duration-300"
                    style={{ width: `${wordPct}%`, background: wordColor }}
                  />
                </div>
                <span className="text-[10px] font-mono" style={{ color: wordColor }}>
                  {wordCount} / {targetWords}w
                </span>
                {!generating && wordPct < 80 && (
                  <span className="flex items-center gap-1 text-[10px] text-[#c8a030]">
                    <AlertTriangle size={9}/> Short
                  </span>
                )}
                {!generating && wordPct > 115 && (
                  <span className="flex items-center gap-1 text-[10px] text-[#c8a030]">
                    <AlertTriangle size={9}/> Long
                  </span>
                )}
              </div>

              {/* 03 — Regen section buttons */}
              {!generating && episodeId && (
                <div className="flex gap-1">
                  <RegenButton label="hook"   section="hook"     episodeId={episodeId} onDone={handleSectionRegen} disabled={generating}/>
                  <RegenButton label="script" section="vo_script" episodeId={episodeId} onDone={handleSectionRegen} disabled={generating}/>
                </div>
              )}
            </div>
          </div>
          <div ref={scriptRef}
            className="px-4 py-3 text-xs text-[#888] leading-relaxed max-h-64 overflow-y-auto font-mono whitespace-pre-wrap bg-[#060606]"
          >
            {scriptStream}
            {generating && <span className="inline-block w-1 h-3 bg-[rgba(74,222,128,0.60)] ml-0.5 animate-pulse align-middle"/>}
          </div>
        </div>
      )}

      {/* Result package */}
      {result && (
        <div id="episode-result" className="border border-[rgba(74,222,128,0.20)] rounded overflow-hidden">
          <div className="px-4 py-3 bg-[rgba(74,222,128,0.05)] border-b border-[rgba(74,222,128,0.10)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check size={14} className="text-[rgba(74,222,128,1)]"/>
              <span className="text-sm text-[rgba(74,222,128,1)]">Episode package ready</span>
            </div>
            {/* 03 — All section regen buttons in results */}
            {episodeId && (
              <div className="flex gap-1 flex-wrap">
                <RegenButton label="hook"      section="hook"         episodeId={episodeId} onDone={handleSectionRegen} disabled={generating}/>
                <RegenButton label="metadata"  section="metadata"     episodeId={episodeId} onDone={handleSectionRegen} disabled={generating}/>
                <RegenButton label="shorts"    section="shortform"    episodeId={episodeId} onDone={handleSectionRegen} disabled={generating}/>
                <RegenButton label="energy"    section="energy_curve" episodeId={episodeId} onDone={handleSectionRegen} disabled={generating}/>
              </div>
            )}
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {(parsedResult?.voScript || result.parsed?.voScript) && (
              <DownloadCard label="VO Script" icon={<Mic size={14}/>}
                onClick={() => downloadFile(parsedResult?.voScript || result.parsed.voScript, `ep${form.episodeNumber}-vo-script.txt`)}/>
            )}
            {(parsedResult?.edlClipMap || result.parsed?.edlClipMap) && (
              <DownloadCard label="EDL for DaVinci" icon={<FileText size={14}/>}
                onClick={() => downloadFile(buildEDL(parsedResult?.edlClipMap || result.parsed.edlClipMap), `ep${form.episodeNumber}.edl`)}/>
            )}
            {(parsedResult?.metadata || result.parsed?.metadata) && (
              <DownloadCard label="All Metadata" icon={<Download size={14}/>}
                onClick={() => downloadFile(parsedResult?.metadata || result.parsed.metadata, `ep${form.episodeNumber}-metadata.txt`)}/>
            )}
            {(parsedResult?.shortformMoments || result.parsed?.shortformMoments) && (
              <DownloadCard label="Short-form Cuts" icon={<Music2 size={14}/>}
                onClick={() => downloadFile(parsedResult?.shortformMoments || result.parsed.shortformMoments, `ep${form.episodeNumber}-shorts.txt`)}/>
            )}
          </div>

          {(parsedResult?.energyCurve || result.parsed?.energyCurve) && (
            <div className="px-4 pb-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-[#555]">Energy curve</div>
              </div>
              <div className="text-xs text-[#444] font-mono whitespace-pre-wrap leading-relaxed border border-[#111] rounded p-3 bg-[#060606]">
                {parsedResult?.energyCurve || result.parsed.energyCurve}
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
    <button onClick={onClick}
      className="flex items-center gap-3 px-4 py-3 border border-[#1a1a1a] rounded hover:border-[rgba(74,222,128,0.30)] hover:bg-[rgba(74,222,128,0.05)] transition-all text-left">
      <span className="text-[rgba(74,222,128,0.60)]">{icon}</span>
      <span className="text-sm text-[#888]">{label}</span>
      <Download size={12} className="ml-auto text-[#333]"/>
    </button>
  )
}

function buildEDL(clipMapText) {
  if (!clipMapText) return ''
  const lines = clipMapText.split('\n').filter(l => l.trim().startsWith('CLIP_'))
  let edl = `TITLE: episode\nFCM: NON-DROP FRAME\n\n`
  let recTC = 90000
  lines.forEach((line, idx) => {
    const parts  = line.split('|').map(p => p.trim())
    const reel   = (parts[1] || `clip${idx+1}`).replace(/[^a-z0-9_-]/gi,'_').slice(0,32)
    const srcIn  = parseTC(parts[2]?.replace('IN:','').trim() || '00:00:00:00')
    const srcOut = parseTC(parts[3]?.replace('OUT:','').trim() || '00:00:05:00')
    const dur    = Math.max(srcOut - srcIn, 1)
    const recOut = recTC + dur
    const n      = String(idx+1).padStart(3,'0')
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