// frontend/src/components/episode/GenerateTab.jsx
// Script generation tab within EpisodePage.
// Shows existing script if generated, or the generate form if not.

import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, RefreshCw, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '../../store'
import { episodes as episodesApi } from '../../lib/api'

function countWords(text) { return (text || '').trim().split(/\s+/).filter(Boolean).length }

export default function GenerateTab({ episode, onUpdate }) {
  const { activeCategoryId, activeCategory, notify, setActiveEpisodeId } = useStore()
  const cat = activeCategory?.()

  const [form, setForm] = useState({
    trackName:             episode?.track_name             || '',
    mood:                  episode?.generation_decisions?.trackContext?.mood  || '',
    genre:                 episode?.generation_decisions?.trackContext?.genre || '',
    bpm:                   episode?.generation_decisions?.trackContext?.bpm   || '',
    targetDurationMinutes: episode?.generation_decisions?.trackContext?.targetDurationMinutes || '8',
    voiceMemoText:         '',
    thumbnailConcept:      episode?.thumbnail_concept      || '',
  })

  const [generating,   setGenerating]   = useState(false)
  const [phase,        setPhase]        = useState('')
  const [pct,          setPct]          = useState(0)
  const [scriptStream, setScriptStream] = useState('')
  const [wordCount,    setWordCount]    = useState(0)
  const [result,       setResult]       = useState(null)
  const [upgradeNeeded, setUpgradeNeeded] = useState(false)
  const [copied,       setCopied]       = useState(false)

  const scriptRef = useRef(null)
  const targetWords = Math.round((parseInt(form.targetDurationMinutes) || 8) * 130)

  // If episode already has a script, show it
  const existingScript = episode?.vo_script

  function field(key) { return (val) => setForm(f => ({ ...f, [key]: val })) }

  async function generate() {
    if (!activeCategoryId || generating) return
    setGenerating(true); setPhase('Starting…'); setPct(0); setScriptStream(''); setResult(null)

    try {
      await episodesApi.generate(
        {
          categoryId:    activeCategoryId,
          episodeNumber: episode?.episode_number || 1,
          trackContext: {
            name:                  form.trackName || episode?.track_name,
            mood:                  form.mood,
            genre:                 form.genre,
            bpm:                   form.bpm,
            targetDurationMinutes: parseInt(form.targetDurationMinutes) || 8,
            thumbnailConcept:      form.thumbnailConcept,
          },
          voiceMemoText: form.voiceMemoText,
          clipInventory: [],
          // Re-generate existing episode
          episodeId: episode?.id,
        },
        {
          progress: ({ message, pct: p }) => { setPhase(message); setPct(p) },
          chunk: ({ text }) => {
            setScriptStream(prev => { const next = prev + text; setWordCount(countWords(next)); return next })
            scriptRef.current?.scrollTo({ top: scriptRef.current.scrollHeight, behavior: 'smooth' })
          },
          done: ({ episodeId: eid, parsed }) => {
            if (eid) setActiveEpisodeId(eid)
            setResult(parsed)
            onUpdate?.({ ...episode, vo_script: parsed?.voScript, status: 'generated' })
            notify('Episode generated!', 'success')
            setGenerating(false)
          },
          error: ({ message: e }) => { notify(e, 'error'); setGenerating(false) },
        }
      )
    } catch (err) {
      if (err.message?.includes('upgrade') || err.message?.includes('limit') || err.message?.toLowerCase().includes('free plan')) {
        notify('Episode limit reached — upgrade to Studio for unlimited', 'error')
        // Show upgrade banner
        setUpgradeNeeded(true)
      } else {
        notify(err.message, 'error')
      }
      setGenerating(false)
    }
  }

  function copyScript() {
    const text = scriptStream || existingScript || ''
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
  }

  const displayScript = scriptStream || existingScript

  return (
    <div style={{ padding: '20px 0' }}>

      {/* Existing script — shown when generated */}
      {displayScript && !generating && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              VO Script · {countWords(displayScript)} words
            </div>
            <button onClick={copyScript} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11, fontFamily: "'Figtree',sans-serif" }}>
              {copied ? <><Check size={10}/> Copied</> : <><Copy size={10}/> Copy</>}
            </button>
          </div>
          <pre style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, maxHeight: 400, overflowY: 'auto' }} ref={scriptRef}>
            {displayScript}
          </pre>
        </div>
      )}

      {/* Generation progress */}
      {generating && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree',sans-serif" }}>{phase}</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif" }}>{wordCount}/{targetWords} words</span>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,rgba(74,222,128,1),rgba(74,222,128,0.6))', borderRadius: 2, transition: 'width 0.4s' }}/>
          </div>
          {scriptStream && (
            <pre style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: 300, overflowY: 'auto' }} ref={scriptRef}>
              {scriptStream}
            </pre>
          )}
        </div>
      )}

      {/* Generate / Regenerate form */}
      {!generating && (
        <div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginBottom: 16 }}>
            {existingScript ? 'Regenerate with updated context' : 'Generate script'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            {[
              { label: 'Mood', key: 'mood', placeholder: 'nostalgic, urgent, reflective...' },
              { label: 'Genre / Format', key: 'genre', placeholder: 'documentary, vlog, tutorial...' },
              { label: 'Duration (min)', key: 'targetDurationMinutes', placeholder: '8' },
              { label: 'BPM', key: 'bpm', placeholder: '120' },
            ].map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", display: 'block', marginBottom: 4 }}>{f.label}</label>
                <input
                  value={form[f.key]}
                  onChange={e => field(f.key)(e.target.value)}
                  placeholder={f.placeholder}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '8px 10px', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: "'Figtree',sans-serif", outline: 'none' }}
                />
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", display: 'block', marginBottom: 4 }}>Voice memo / episode brief</label>
            <textarea
              value={form.voiceMemoText}
              onChange={e => field('voiceMemoText')(e.target.value)}
              placeholder="What's this episode about? What happened in the studio? What are you trying to say?"
              rows={4}
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '10px 12px', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: "'Figtree',sans-serif", lineHeight: 1.6, outline: 'none', resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Figtree',sans-serif", display: 'block', marginBottom: 4 }}>
              Thumbnail concept <span style={{ textTransform: 'none', opacity: 0.5 }}>— optional</span>
            </label>
            <input
              value={form.thumbnailConcept}
              onChange={e => field('thumbnailConcept')(e.target.value)}
              placeholder="Close-up, looking at camera, dark studio behind me..."
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, padding: '8px 10px', color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: "'Figtree',sans-serif", outline: 'none' }}
            />
          </div>

          <button
            onClick={generate}
            disabled={generating}
            style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: 'rgba(74,222,128,1)', color: '#080808', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: "'Figtree',sans-serif", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Sparkles size={15}/>
            {existingScript ? 'Regenerate script' : 'Generate script'}
          </button>
        </div>
      )}
    </div>
  )
}