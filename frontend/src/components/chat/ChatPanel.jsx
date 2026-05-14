// frontend/src/components/chat/ChatPanel.jsx
// KB — editorial dark glass aesthetic
// Left meta column + wide conversation area

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Trash2, Loader2, BookmarkPlus, Check,
  Plus, Clock, X, Sparkles, Mic, MicOff, Volume2, ChevronDown,
} from 'lucide-react'
import { useStore } from '../../store'
import { chat as chatApi } from '../../lib/api'
import useKBVoice from '../../hooks/useKBVoice'
import { useLocation } from 'react-router-dom'

const MODE_MAP = {
  '/':             'generate',
  '/generate':     'generate',
  '/vault':        'vault',
  '/series':       'series',
  '/analytics':    'analytics',
  '/teleprompter': 'teleprompter',
  '/sound':        'sound',
  '/editor':       'editor',
  '/storyboard':   'storyboard',
}

const MODE_META = {
  generate:     { hint: 'Hooks, structure, trending angles...', color: '#4ade80', glyph: '✦', name: 'Generate' },
  vault:        { hint: 'Find ideas, surface gems...',          color: '#4ade80', glyph: '◈', name: 'Vault'    },
  series:       { hint: 'Plan arcs, map the season...',         color: '#4ade80', glyph: '◎', name: 'Series'   },
  analytics:    { hint: 'Interpret numbers, find patterns...',  color: '#4ade80', glyph: '▲', name: 'Analytics' },
  teleprompter: { hint: 'Review for speakability...',           color: '#4ade80', glyph: '▶', name: 'Script'   },
  sound:        { hint: 'Atmosphere, music, mix notes...',      color: '#4ade80', glyph: '♪', name: 'Sound'    },
  editor:       { hint: 'Footage, clips, edit structure...',    color: '#4ade80', glyph: '▣', name: 'Editor'   },
  storyboard:   { hint: 'Shot composition, framing...',         color: '#4ade80', glyph: '⬡', name: 'Board'    },
}

const QUICK_PROMPTS = {
  generate:     ['What hooks are trending in my niche?', 'Outline my next episode', "What's working in my top videos?"],
  series:       ['Map out the next 4 episodes', 'What callbacks can I plant now?', 'How is my series arc developing?'],
  vault:        ['Surface my strongest unused ideas', 'What topics keep coming up?', 'Find ideas that fit current trends'],
  analytics:    ['Why did my last video underperform?', 'What hook types work best for me?', 'Where do viewers drop off?'],
  teleprompter: ['Does this script sound natural?', 'Flag anything that reads not speaks', 'Shorten the opening'],
  sound:        ['Suggest music for this mood', 'Where should I use silence?', 'Describe the sonic landscape'],
  editor:       ['Which clips match this beat?', 'How should I structure this edit?', 'Find broll for this section'],
  storyboard:   ['What shot types fit this scene?', 'How should I frame this moment?', 'Suggest coverage for this section'],
}

// ── CSS injected once ─────────────────────────────────────────────────────────
const STYLES = `
  .kb-panel * { box-sizing: border-box; }

  .kb-panel {
    font-family: 'Figtree', system-ui, sans-serif;
    background: rgba(10,12,18,0.97);
    display: flex;
    height: 100%;
    width: 100%;
    position: relative;
  }

  /* Neon green top separator — the glow line that floats the panel */
  .kb-panel::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent 0%, rgba(74,222,128,0.0) 10%, rgba(74,222,128,0.7) 35%, rgba(74,222,128,1) 50%, rgba(74,222,128,0.7) 65%, rgba(74,222,128,0.0) 90%, transparent 100%);
    z-index: 2;
  }

  /* Glow bloom behind the line */
  .kb-panel::after {
    content: '';
    position: absolute;
    top: 0; left: 10%; right: 10%;
    height: 40px;
    background: radial-gradient(ellipse at 50% 0%, rgba(74,222,128,0.12) 0%, transparent 70%);
    pointer-events: none;
    z-index: 1;
  }

  .kb-sidebar {
    width: 196px;
    flex-shrink: 0;
    border-right: 1px solid rgba(255,255,255,0.05);
    display: flex;
    flex-direction: column;
    padding: 20px 16px;
    background: rgba(8,10,16,0.5);
    transition: width 0.25s cubic-bezier(0.4,0,0.2,1), opacity 0.2s, padding 0.25s;
    overflow: hidden;
  }

  .kb-sidebar.collapsed {
    width: 0;
    padding: 0;
    opacity: 0;
    border-right: none;
  }

  .kb-sidebar-toggle {
    position: absolute;
    top: 12px;
    left: 12px;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    transition: all 0.15s;
    z-index: 3;
  }
  .kb-sidebar-toggle:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.7); }

  @media (max-width: 600px) {
    .kb-sidebar-toggle { display: flex; }
    .kb-sidebar-toggle.sidebar-open { left: 208px; }
  }

  .kb-mode-glyph {
    font-size: 22px;
    line-height: 1;
    margin-bottom: 4px;
  }

  .kb-mode-name {
    font-family: 'Figtree', sans-serif;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.10em;
    text-transform: uppercase;
    color: var(--text3);
    margin-bottom: 2px;
  }

  .kb-mode-label {
    font-family: 'Syne', sans-serif;
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 20px;
    letter-spacing: -0.01em;
  }

  .kb-quick-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
    margin-bottom: 6px;
    opacity: 0.6;
  }

  .kb-quick-btn {
    font-family: 'Figtree', sans-serif;
    font-size: 13px;
    font-weight: 400;
    line-height: 1.45;
    text-align: left;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid rgba(255,255,255,0.04);
    background: transparent;
    cursor: pointer;
    margin-bottom: 3px;
    transition: all 0.15s;
    color: var(--text3);
    width: 100%;
  }
  .kb-quick-btn:hover { color: var(--text2); border-color: rgba(255,255,255,0.09); background: rgba(255,255,255,0.025); }

  .kb-action-btn {
    font-family: 'Figtree', sans-serif;
    font-size: 13px;
    font-weight: 400;
    text-align: left;
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.05);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
    margin-bottom: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text3);
  }
  .kb-action-btn:hover { color: var(--text2); background: rgba(255,255,255,0.03); }
  .kb-action-btn.accent { color: var(--text2); }
  .kb-action-btn.accent:hover { color: var(--text); }

  .kb-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    position: relative;
  }

  .kb-messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.05) transparent;
  }

  .kb-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    gap: 6px;
  }
  .kb-empty-glyph { font-size: 32px; margin-bottom: 4px; opacity: 0.2; }
  .kb-empty-text { font-size: 13px; color: var(--text3); }

  .kb-msg { display: flex; }
  .kb-msg.user  { justify-content: flex-end; }
  .kb-msg.assistant { justify-content: flex-start; }

  .kb-bubble {
    max-width: 82%;
    padding: 10px 14px;
    border-radius: 12px;
    font-family: 'Figtree', sans-serif;
    font-size: 14px;
    line-height: 1.65;
    font-weight: 400;
  }

  .kb-bubble.user {
    border-bottom-right-radius: 3px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    color: var(--text);
  }

  .kb-bubble.assistant {
    border-bottom-left-radius: 3px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    color: var(--text2);
  }

  .kb-bubble.error {
    background: rgba(180,60,60,0.07);
    border-color: rgba(180,60,60,0.12);
    color: #bf7070;
  }

  .kb-bubble strong { color: var(--text); font-weight: 600; }
  .kb-bubble code {
    font-family: 'Figtree', monospace;
    font-size: 12px;
    background: rgba(255,255,255,0.06);
    padding: 1px 5px;
    border-radius: 3px;
    color: var(--text2);
  }

  .kb-thinking {
    display: flex;
    gap: 5px;
    padding: 10px 0;
  }
  .kb-dot {
    width: 4px; height: 4px; border-radius: 50%;
    animation: kb-bounce 0.8s infinite;
  }
  .kb-dot:nth-child(2) { animation-delay: 0.15s; }
  .kb-dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes kb-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.25; }
    40% { transform: translateY(-4px); opacity: 0.9; }
  }

  .kb-cursor {
    display: inline-block;
    width: 2px; height: 12px;
    border-radius: 1px;
    margin-left: 2px;
    vertical-align: middle;
    animation: kb-blink 1s infinite;
  }
  @keyframes kb-blink { 0%,100% { opacity: 0 } 50% { opacity: 1 } }

  .kb-committed-bar {
    padding: 8px 20px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 7px;
    border-top: 1px solid rgba(74,222,128,0.08);
    background: rgba(74,222,128,0.04);
    color: rgba(74,222,128,0.7);
  }

  .kb-input-area {
    padding: 12px 16px 16px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }

  .kb-input-wrap {
    display: flex;
    gap: 8px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    padding: 8px 12px;
    transition: border-color 0.2s;
  }
  .kb-input-wrap:focus-within { border-color: rgba(255,255,255,0.12); }

  .kb-textarea {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    font-family: 'Figtree', sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text);
  }
  .kb-textarea::placeholder { color: var(--text3); }

  .kb-send {
    align-self: flex-end;
    width: 30px; height: 30px;
    border-radius: 7px;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
  }
  .kb-send:disabled { opacity: 0.2; cursor: not-allowed; }

  .kb-generate-strip {
    margin: 0 16px 8px;
    padding: 9px 13px;
    border-radius: 9px;
    border: 1px solid rgba(74,222,128,0.12);
    background: rgba(74,222,128,0.04);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .kb-generate-text {
    font-size: 13px;
    color: rgba(74,222,128,0.55);
  }

  .kb-generate-btn {
    font-family: 'Figtree', sans-serif;
    font-size: 13px;
    font-weight: 500;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid rgba(74,222,128,0.18);
    background: rgba(74,222,128,0.07);
    color: rgba(74,222,128,0.85);
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .kb-generate-btn:hover { background: rgba(74,222,128,0.14); color: rgba(74,222,128,1); }
  .kb-generate-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .kb-history-item {
    padding: 11px 13px;
    border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.04);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    margin-bottom: 5px;
  }
  .kb-history-item:hover { border-color: rgba(255,255,255,0.09); background: rgba(255,255,255,0.02); }
  .kb-history-title { font-size: 14px; color: var(--text2); line-height: 1.4; margin-bottom: 4px; }
  .kb-history-meta { font-size: 11px; color: var(--text3); display: flex; align-items: center; gap: 6px; }
  .kb-history-mode { padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; }
`

let stylesInjected = false

export default function ChatPanel() {
  const { activeCategoryId, notify } = useStore()
  const location = useLocation()
  const mode     = MODE_MAP[location.pathname] || 'generate'
  const meta     = MODE_META[mode] || MODE_META.generate

  // Inject styles once
  useEffect(() => {
    if (stylesInjected) return
    const el = document.createElement('style')
    el.textContent = STYLES
    document.head.appendChild(el)
    stylesInjected = true
  }, [])

  const [view,        setView]        = useState('chat')
  const isMobile    = typeof window !== 'undefined' && window.innerWidth < 600
  const [messages,    setMessages]    = useState([])
  const [sessions,    setSessions]    = useState([])
  const [input,       setInput]       = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const [streamText,  setStreamText]  = useState('')
  const [committing,  setCommitting]  = useState(false)
  const [committed,   setCommitted]   = useState(null)
  const [saving,      setSaving]      = useState(false)
  const [saved,       setSaved]       = useState(false)
  const [generating,  setGenerating]  = useState(false)
  const [generated,   setGenerated]   = useState(null)
  const [genPct,      setGenPct]      = useState(0)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const genTimerRef = useRef(null)
  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)
  const abortRef    = useRef(null)   // AbortController for the active stream
  const voiceUsedRef  = useRef(false)

  const { listening, speaking, audioLevel: voiceLevel, supported: voiceSupported,
          startListening, stopListening, speak, stopSpeaking } = useKBVoice({
    onTranscript: ({ text, isFinal, interim }) => {
      // Show words appearing in real time as feedback
      setInput(text || interim || '')
      // Only send when speech recognition gives a final result
      if (isFinal && text.trim()) {
        voiceUsedRef.current = true
        sendMessage(text.trim())
      }
    },
  })

  // Auto-focus input on mount — opens keyboard immediately when chat sheet opens
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [])

  // Also focus when orb is tapped to open (kb:focus event from AppLayout)
  useEffect(() => {
    const handler = () => setTimeout(() => inputRef.current?.focus(), 100)
    window.addEventListener('kb:focus', handler)
    return () => window.removeEventListener('kb:focus', handler)
  }, [])

  // Cancel any in-flight stream when the panel unmounts (tab switch, page change)
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  useEffect(() => {
    if (!activeCategoryId) return
    setMessages([]); setCommitted(null); setSaved(false); setGenerated(null)
    chatApi.getHistory({ categoryId: activeCategoryId, mode })
      .then(({ messages: h }) => setMessages(h || []))
      .catch(() => {})
  }, [activeCategoryId, mode])

  useEffect(() => {
    if (view !== 'history') return
    chatApi.getSessions({})
      .then(({ sessions: s }) => setSessions(s || []))
      .catch(() => {})
  }, [view])

  // Smart scroll — only follow if user is already near the bottom
  // This lets the user scroll up to read while streaming is happening
  const messagesRef = useRef(null)
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom < 120) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamText])

  // Show scroll-to-bottom button when user has scrolled up more than 300px
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    const handleScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      setShowScrollBtn(distFromBottom > 300)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  const sendMessage = useCallback(async (overrideText) => {
    const text = (overrideText || input).trim()
    if (!text || streaming) return
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }])
    setInput('')
    setStreaming(true)
    setStreamText('')

    // Cancel any previous stream and create a fresh controller
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await chatApi.send(
        { categoryId: activeCategoryId, mode, message: text, messages: [] },
        {
          chunk: ({ text: t }) => setStreamText(prev => prev + t),
          done:  ({ response }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: response, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
            if (voiceUsedRef.current) { voiceUsedRef.current = false; speak(response) }
          },
          error: ({ message: e }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e}`, isError: true, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
          },
        },
        controller.signal,
      )
    } catch (err) {
      if (err.name === 'AbortError') { setStreamText(''); setStreaming(false); return }
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, isError: true, timestamp: new Date().toISOString() }])
      setStreamText('')
      setStreaming(false)
    }
  }, [input, streaming, activeCategoryId, mode])

  async function saveSession() {
    if (!messages.length || saving) return
    setSaving(true)
    try {
      await chatApi.saveSession({ categoryId: activeCategoryId, mode, messages })
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch { notify('Could not save', 'error') }
    finally { setSaving(false) }
  }

  async function loadSession(id) {
    const { session } = await chatApi.getSession(id)
    setMessages(session.messages || [])
    setView('chat')
  }

  async function deleteSession(id, e) {
    e.stopPropagation()
    await chatApi.deleteSession(id)
    setSessions(prev => prev.filter(s => s.id !== id))
  }

  async function newChat() {
    await chatApi.clearHistory({ categoryId: activeCategoryId, mode })
    setMessages([]); setCommitted(null); setSaved(false); setGenerated(null)
    setView('chat')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function commitEpisode() {
    if (!activeCategoryId || committing) return
    setCommitting(true)
    try {
      const result = await chatApi.commitEpisode({ categoryId: activeCategoryId, mode })
      setCommitted(result.plan)
      notify(`"${result.plan.track_name}" committed to series`, 'success')
    } catch { notify("Couldn't extract plan — discuss a specific episode first", 'error') }
    finally { setCommitting(false) }
  }

  async function generateEpisodeFromChat() {
    if (!activeCategoryId || generating) return
    setGenerating(true)
    setGenerated(null)
    setGenPct(0)

    // Animate progress bar
    let pct = 0
    genTimerRef.current = setInterval(() => {
      pct = pct < 60 ? pct + 1.5 : pct < 80 ? pct + 0.5 : pct < 92 ? pct + 0.15 : pct
      setGenPct(Math.min(pct, 92))
    }, 300)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await chatApi.generateEpisode(
        { categoryId: activeCategoryId, mode },
        {
          progress: ({ message }) => {
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.isGenerating) return [...prev.slice(0,-1), { ...last, content: message }]
              return [...prev, { role: 'assistant', content: message, isGenerating: true }]
            })
          },
          done: ({ parsed }) => {
            clearInterval(genTimerRef.current); setGenPct(100)
            setTimeout(() => setGenPct(0), 600)
            setMessages(prev => prev.filter(m => !m.isGenerating))
            setGenerated(parsed?.metadata?.trackName || 'Your episode')
            notify(`Episode generated!`, 'success')
            setGenerating(false)
          },
          error: ({ message: e }) => {
            clearInterval(genTimerRef.current); setGenPct(0)
            setMessages(prev => prev.filter(m => !m.isGenerating))
            notify(e, 'error')
            setGenerating(false)
          },
        },
        controller.signal,
      )
    } catch (err) {
      clearInterval(genTimerRef.current); setGenPct(0)
      if (err.name !== 'AbortError') notify(err.message, 'error')
      setGenerating(false)
    }
  }

  const isSeriesMode = mode === 'series' || mode === 'generate'
  const canCommit    = isSeriesMode && messages.length >= 4 && !committed

  // ── HISTORY VIEW ─────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div className="kb-panel">
        <div className="kb-main">
          <div style={{ padding:'12px 16px 0', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid rgba(255,255,255,0.05)', paddingBottom:12, marginBottom:4 }}>
            <button onClick={() => setView('chat')} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.4)', fontSize:12, fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:4 }}>
              ← Back
            </button>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.25)', textTransform:'uppercase', letterSpacing:'0.1em', fontFamily:"'Figtree',sans-serif" }}>Saved conversations</span>
          </div>
          <div className="kb-messages">
            {sessions.length === 0 && (
              <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                No saved conversations yet
              </div>
            )}
            {sessions.map(s => (
              <div key={s.id} className="kb-history-item" onClick={() => loadSession(s.id)}>
                <div className="kb-history-title">{s.title}</div>
                <div className="kb-history-meta">
                  <span className="kb-history-mode" style={{ background: meta.color + '15', color: meta.color }}>{s.mode}</span>
                  {new Date(s.updated_at).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  <button onClick={e => deleteSession(s.id, e)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', padding: 0 }}>
                    <X size={10}/>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── CHAT VIEW ─────────────────────────────────────────────────────────────
  return (
    <div className="kb-panel">

      {/* Main chat area */}
      <div className="kb-main">

        {/* Messages */}
        <div className="kb-messages" ref={messagesRef}>
          {messages.length === 0 && !streaming && (
            <div className="kb-empty">
              <div className="kb-empty-glyph" style={{ color: meta.color + '40' }}>{meta.glyph}</div>
              <div className="kb-empty-text" style={{ color: meta.color + '40' }}>{meta.hint}</div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`kb-msg ${msg.role}`}>
              <div className={`kb-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}>
                <MessageContent content={msg.content}/>
                {msg.isGenerating && <span style={{ color: 'rgba(100,180,100,0.6)', marginLeft: 6 }}>✦</span>}
              </div>
            </div>
          ))}

          {streaming && (
            streamText ? (
              <div className="kb-msg assistant">
                <div className="kb-bubble assistant">
                  <MessageContent content={streamText}/>
                  <span className="kb-cursor" style={{ background: meta.color + '80' }}/>
                </div>
              </div>
            ) : (
              <div className="kb-thinking">
                {[0,1,2].map(i => (
                  <div key={i} className="kb-dot" style={{ background: meta.color, animationDelay: `${i*150}ms` }}/>
                ))}
              </div>
            )
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            style={{
              position:       'absolute',
              bottom:         120,
              left:           '50%',
              transform:      'translateX(-50%)',
              width:          34,
              height:         34,
              borderRadius:   '50%',
              background:     'rgba(8,10,16,0.92)',
              border:         '1px solid rgba(74,222,128,0.25)',
              color:          'rgba(74,222,128,0.8)',
              cursor:         'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              boxShadow:      '0 2px 12px rgba(0,0,0,0.5)',
              transition:     'all 0.15s',
              zIndex:         5,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(74,222,128,0.12)'; e.currentTarget.style.borderColor = 'rgba(74,222,128,0.5)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(8,10,16,0.92)'; e.currentTarget.style.borderColor = 'rgba(74,222,128,0.25)' }}
          >
            <ChevronDown size={16}/>
          </button>
        )}



        {/* Generation progress bar */}
        {generating && genPct > 0 && (
          <div style={{padding:'0 4px'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.3)',letterSpacing:'0.06em',textTransform:'uppercase'}}>
                {genPct < 25 ? 'KB is reading the conversation...' : genPct < 50 ? 'KB is structuring the episode...' : genPct < 75 ? 'KB is writing your VO script...' : 'KB is compiling the package...'}
              </span>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.3)'}}>{Math.round(genPct)}%</span>
            </div>
            <div style={{height:2,background:'rgba(255,255,255,0.06)',borderRadius:2,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${genPct}%`,background:'linear-gradient(90deg,rgba(74,222,128,1),rgba(74,222,128,0.6))',borderRadius:2,transition:'width 0.3s ease'}}/>
            </div>
          </div>
        )}

        {generated && (
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',borderRadius:8,background:'rgba(212,168,83,0.07)',border:'1px solid rgba(212,168,83,0.2)'}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <Check size={12} style={{color:'rgba(74,222,128,1)',flexShrink:0}}/>
              <div>
                <div style={{fontSize:12,fontWeight:600,color:'rgba(74,222,128,1)'}}>Episode ready</div>
                <div style={{fontSize:10,color:'rgba(212,168,83,0.5)',marginTop:1}}>"{generated}" — check your episodes</div>
              </div>
            </div>
          </div>
        )}

        {/* Quick prompts — shown when chat is empty */}
        {messages.length === 0 && !streaming && QUICK_PROMPTS[mode]?.length > 0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:5, padding:'0 12px 10px', justifyContent:'center' }}>
            {QUICK_PROMPTS[mode].map((p, i) => (
              <button key={i}
                onClick={() => { setInput(p); inputRef.current?.focus() }}
                style={{ padding:'4px 11px', borderRadius:99, border:'1px solid rgba(255,255,255,0.08)', background:'transparent', color:'rgba(255,255,255,0.4)', cursor:'pointer', fontSize:11, fontFamily:"'Figtree',sans-serif" }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Action row — save / history / new */}
        <div style={{ display:'flex', gap:6, padding:'0 12px 8px', justifyContent:'flex-end' }}>
          {messages.length > 2 && !saved && (
            <button onClick={saveSession} disabled={saving}
              style={{ fontSize:10, padding:'3px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.06)', background:'transparent', color:'rgba(255,255,255,0.3)', cursor:'pointer', fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:4 }}>
              {saving ? '...' : '◌'} Save
            </button>
          )}
          {saved && <span style={{ fontSize:10, color:'rgba(74,222,128,0.6)', fontFamily:"'Figtree',sans-serif", padding:'3px 8px' }}>✓ Saved</span>}
          <button onClick={() => setView('history')}
            style={{ fontSize:10, padding:'3px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.06)', background:'transparent', color:'rgba(255,255,255,0.3)', cursor:'pointer', fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:4 }}>
            <Clock size={9}/> History
          </button>
          <button onClick={newChat}
            style={{ fontSize:10, padding:'3px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.06)', background:'transparent', color:'rgba(255,255,255,0.3)', cursor:'pointer', fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:4 }}>
            <Plus size={9}/> New
          </button>
        </div>

        {/* Input */}
        <div className="kb-input-area">
          <div className="kb-input-wrap">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              onFocus={() => {
                // On mobile, after the keyboard opens the element may be
                // obscured. A short delay lets the viewport settle before
                // scrolling the input into view.
                setTimeout(() => inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150)
              }}
              placeholder={meta.hint}
              rows={2}
              className="kb-textarea"
            />
            {voiceSupported && (
              <button
                onClick={speaking ? stopSpeaking : listening ? stopListening : startListening}
                style={{width:32,height:32,borderRadius:8,border:'none',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',background:speaking?'rgba(74,222,128,0.15)':listening?'rgba(224,48,48,0.15)':'rgba(255,255,255,0.04)',color:speaking?'rgba(74,222,128,0.9)':listening?'#e03030':'rgba(255,255,255,0.25)',cursor:'pointer',transition:'all 0.15s',transform:listening&&voiceLevel>0.1?`scale(${1+voiceLevel*0.3})`:'scale(1)'}}
                title={speaking?'Stop KB':listening?'Stop':'Voice input'}
              >
                {speaking?<Volume2 size={13}/>:listening?<MicOff size={13}/>:<Mic size={13}/>}
              </button>
            )}
            <button
              type="button"
              onClick={sendMessage}
              disabled={!input.trim() || streaming}
              className="kb-send"
              style={{ background: input.trim() && !streaming ? meta.color : 'rgba(255,255,255,0.04)', color: input.trim() && !streaming ? '#080808' : 'rgba(255,255,255,0.2)' }}
            >
              <Send size={12}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageContent({ content }) {
  // Render markdown-lite: **bold**, `code`, newlines — with pre-wrap for smooth streaming
  const html = (content || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="font-family:monospace;font-size:0.88em;background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:3px">$1</code>')
  return (
    <span
      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}