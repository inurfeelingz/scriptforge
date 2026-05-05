// frontend/src/components/chat/ChatPanel.jsx
// KB — editorial dark glass aesthetic
// Left meta column + wide conversation area

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Trash2, Loader2, BookmarkPlus, Check,
  Plus, Clock, X, Sparkles,
} from 'lucide-react'
import { useStore } from '../../store'
import { chat as chatApi } from '../../lib/api'
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
  generate:     { hint: 'Hooks, structure, trending angles...', color: '#c8b89a', glyph: '✦', name: 'Generate' },
  vault:        { hint: 'Find ideas, surface gems...',          color: '#7ab8b8', glyph: '◈', name: 'Vault'    },
  series:       { hint: 'Plan arcs, map the season...',         color: '#a87ab8', glyph: '◎', name: 'Series'   },
  analytics:    { hint: 'Interpret numbers, find patterns...',  color: '#7ab88a', glyph: '▲', name: 'Analytics' },
  teleprompter: { hint: 'Review for speakability...',           color: '#b8a87a', glyph: '▶', name: 'Script'   },
  sound:        { hint: 'Atmosphere, music, mix notes...',      color: '#7a8ab8', glyph: '♪', name: 'Sound'    },
  editor:       { hint: 'Footage, clips, edit structure...',    color: '#b87a7a', glyph: '▣', name: 'Editor'   },
  storyboard:   { hint: 'Shot composition, framing...',         color: '#b87aaa', glyph: '⬡', name: 'Board'    },
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
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=DM+Mono:ital,wght@0,300;0,400;1,300&display=swap');

  .kb-panel * { box-sizing: border-box; }

  .kb-panel {
    font-family: 'Syne', sans-serif;
    background: rgba(6,6,14,0.98);
    display: flex;
    height: 100%;
    width: 100%;
  }

  .kb-sidebar {
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid rgba(255,255,255,0.04);
    display: flex;
    flex-direction: column;
    padding: 20px 16px;
    background: rgba(8,8,18,0.6);
  }

  .kb-mode-glyph {
    font-size: 28px;
    line-height: 1;
    margin-bottom: 6px;
  }

  .kb-mode-name {
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    opacity: 0.35;
    margin-bottom: 2px;
  }

  .kb-mode-label {
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
    margin-bottom: 20px;
  }

  .kb-quick-label {
    font-family: 'DM Mono', monospace;
    font-size: 8px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0.25;
    margin-bottom: 8px;
  }

  .kb-quick-btn {
    font-family: 'Syne', sans-serif;
    font-size: 10px;
    font-weight: 400;
    line-height: 1.5;
    text-align: left;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.05);
    background: transparent;
    cursor: pointer;
    margin-bottom: 4px;
    transition: all 0.15s;
    opacity: 0.5;
    width: 100%;
  }
  .kb-quick-btn:hover { opacity: 1; border-color: rgba(255,255,255,0.12); background: rgba(255,255,255,0.03); }

  .kb-action-btn {
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.05em;
    text-align: left;
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.06);
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    opacity: 0.5;
    color: #aaa;
  }
  .kb-action-btn:hover { opacity: 1; background: rgba(255,255,255,0.04); }

  .kb-action-btn.accent { opacity: 0.7; }
  .kb-action-btn.accent:hover { opacity: 1; }

  .kb-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .kb-messages {
    flex: 1;
    overflow-y: auto;
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.06) transparent;
  }

  .kb-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.35;
    text-align: center;
    gap: 8px;
  }
  .kb-empty-glyph { font-size: 40px; margin-bottom: 4px; }
  .kb-empty-text { font-family: 'DM Mono', monospace; font-size: 10px; letter-spacing: 0.08em; }

  .kb-msg { display: flex; }
  .kb-msg.user  { justify-content: flex-end; }
  .kb-msg.assistant { justify-content: flex-start; }

  .kb-bubble {
    max-width: 80%;
    padding: 11px 16px;
    border-radius: 14px;
    font-size: 12px;
    line-height: 1.7;
    font-weight: 400;
  }

  .kb-bubble.user {
    border-bottom-right-radius: 3px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    color: #e8e8e8;
  }

  .kb-bubble.assistant {
    border-bottom-left-radius: 3px;
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.75);
  }

  .kb-bubble.error {
    background: rgba(180,60,60,0.08);
    border-color: rgba(180,60,60,0.15);
    color: #bf6a6a;
  }

  .kb-bubble strong { color: #e8e8e8; font-weight: 600; }
  .kb-bubble code {
    font-family: 'DM Mono', monospace;
    font-size: 10px;
    background: rgba(255,255,255,0.06);
    padding: 1px 5px;
    border-radius: 3px;
    color: #a8b8d8;
  }

  .kb-thinking {
    display: flex;
    gap: 5px;
    padding: 14px 0;
  }
  .kb-dot {
    width: 4px; height: 4px; border-radius: 50%;
    animation: kb-bounce 0.8s infinite;
  }
  .kb-dot:nth-child(2) { animation-delay: 0.15s; }
  .kb-dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes kb-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
    40% { transform: translateY(-5px); opacity: 1; }
  }

  .kb-cursor {
    display: inline-block;
    width: 2px; height: 13px;
    border-radius: 1px;
    margin-left: 2px;
    vertical-align: middle;
    animation: kb-blink 1s infinite;
  }
  @keyframes kb-blink { 0%,100% { opacity: 0 } 50% { opacity: 1 } }

  .kb-committed-bar {
    padding: 10px 20px;
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid rgba(100,180,100,0.1);
    background: rgba(50,120,50,0.06);
    color: rgba(100,180,100,0.8);
  }

  .kb-input-area {
    padding: 16px 20px 20px;
    border-top: 1px solid rgba(255,255,255,0.04);
  }

  .kb-input-wrap {
    display: flex;
    gap: 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 12px;
    padding: 10px 14px;
    transition: border-color 0.2s;
  }
  .kb-input-wrap:focus-within { border-color: rgba(255,255,255,0.14); }

  .kb-textarea {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    font-family: 'Syne', sans-serif;
    font-size: 12px;
    line-height: 1.6;
    color: rgba(255,255,255,0.85);
    placeholder-color: rgba(255,255,255,0.2);
  }
  .kb-textarea::placeholder { color: rgba(255,255,255,0.2); }

  .kb-send {
    align-self: flex-end;
    width: 32px; height: 32px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .kb-send:disabled { opacity: 0.2; cursor: not-allowed; }

  .kb-generate-strip {
    margin: 0 20px 10px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid rgba(100,160,100,0.15);
    background: rgba(60,120,60,0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .kb-generate-text {
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.06em;
    color: rgba(100,180,100,0.6);
  }

  .kb-generate-btn {
    font-family: 'DM Mono', monospace;
    font-size: 9px;
    letter-spacing: 0.08em;
    padding: 5px 10px;
    border-radius: 6px;
    border: 1px solid rgba(100,180,100,0.2);
    background: rgba(60,120,60,0.1);
    color: rgba(100,180,100,0.8);
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .kb-generate-btn:hover { background: rgba(60,120,60,0.2); color: rgba(120,200,120,1); }
  .kb-generate-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  .kb-history-item {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.04);
    background: rgba(255,255,255,0.01);
    cursor: pointer;
    transition: all 0.15s;
    margin-bottom: 6px;
  }
  .kb-history-item:hover { border-color: rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); }
  .kb-history-title { font-size: 11px; color: rgba(255,255,255,0.7); line-height: 1.4; margin-bottom: 4px; }
  .kb-history-meta { font-family: 'DM Mono', monospace; font-size: 8px; letter-spacing: 0.06em; color: rgba(255,255,255,0.2); display: flex; align-items: center; gap: 6px; }
  .kb-history-mode { padding: 2px 6px; border-radius: 3px; }
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
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }])
    setInput('')
    setStreaming(true)
    setStreamText('')

    try {
      await chatApi.send(
        { categoryId: activeCategoryId, mode, message: text, messages: [] },
        {
          chunk: ({ text: t }) => setStreamText(prev => prev + t),
          done:  ({ response }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: response, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
          },
          error: ({ message: e }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e}`, isError: true, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
          },
        }
      )
    } catch (err) {
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
            setMessages(prev => prev.filter(m => !m.isGenerating))
            setGenerated(parsed?.metadata?.trackName)
            notify(`"${parsed?.metadata?.trackName}" generated!`, 'success')
            setGenerating(false)
          },
          error: ({ message: e }) => {
            setMessages(prev => prev.filter(m => !m.isGenerating))
            notify(e, 'error')
            setGenerating(false)
          },
        }
      )
    } catch (err) { notify(err.message, 'error'); setGenerating(false) }
  }

  const isSeriesMode = mode === 'series' || mode === 'generate'
  const canCommit    = isSeriesMode && messages.length >= 4 && !committed
  const canGenerate  = isSeriesMode && messages.length >= 4 && !generated && !streaming && !generating

  // ── HISTORY VIEW ─────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div className="kb-panel">
        <div className="kb-sidebar">
          <div className="kb-mode-glyph" style={{ color: meta.color }}>{meta.glyph}</div>
          <div className="kb-mode-name">Knowledge Base</div>
          <div className="kb-mode-label" style={{ color: meta.color }}>History</div>
          <button className="kb-action-btn" onClick={() => setView('chat')} style={{ color: meta.color }}>
            ← Back to chat
          </button>
        </div>
        <div className="kb-main">
          <div className="kb-messages">
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', marginBottom: 16 }}>
              Saved conversations
            </div>
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

      {/* Sidebar */}
      <div className="kb-sidebar">
        <div className="kb-mode-glyph" style={{ color: meta.color }}>{meta.glyph}</div>
        <div className="kb-mode-name">Knowledge Base</div>
        <div className="kb-mode-label" style={{ color: meta.color }}>{meta.name}</div>

        {/* Quick prompts */}
        <div className="kb-quick-label">Quick start</div>
        {QUICK_PROMPTS[mode]?.map((p, i) => (
          <button key={i} className="kb-quick-btn" style={{ color: 'rgba(255,255,255,0.6)' }}
            onClick={() => { setInput(p); inputRef.current?.focus() }}>
            {p}
          </button>
        ))}

        {/* Spacer */}
        <div style={{ flex: 1 }}/>

        {/* Actions */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 12 }}>
          {messages.length > 2 && !saved && (
            <button className="kb-action-btn" onClick={saveSession} disabled={saving}>
              {saving ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }}/> : '◌'} Save chat
            </button>
          )}
          {saved && (
            <div className="kb-action-btn" style={{ color: 'rgba(100,180,100,0.7)' }}>
              <Check size={9}/> Saved
            </div>
          )}
          <button className="kb-action-btn" onClick={() => setView('history')}>
            <Clock size={9}/> History
          </button>
          <button className="kb-action-btn" onClick={newChat}>
            <Plus size={9}/> New chat
          </button>
          {canCommit && (
            <button className="kb-action-btn accent" onClick={commitEpisode} disabled={committing}
              style={{ color: meta.color, borderColor: meta.color + '30' }}>
              {committing ? <Loader2 size={9}/> : <BookmarkPlus size={9}/>}
              Commit plan
            </button>
          )}
          {committed && (
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: 'rgba(100,180,100,0.7)', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Check size={9}/> Plan committed
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="kb-main">

        {/* Messages */}
        <div className="kb-messages">
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

        {/* Generate episode strip */}
        {canGenerate && (
          <div className="kb-generate-strip">
            <span className="kb-generate-text">Ready to generate from this conversation</span>
            <button className="kb-generate-btn" onClick={generateEpisodeFromChat} disabled={generating}>
              {generating ? <Loader2 size={9}/> : <Sparkles size={9}/>}
              {generating ? 'Generating...' : 'Generate episode'}
            </button>
          </div>
        )}

        {generated && (
          <div className="kb-committed-bar">
            <Check size={10}/> "{generated}" is ready in your episodes
          </div>
        )}

        {/* Input */}
        <div className="kb-input-area">
          <div className="kb-input-wrap">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={meta.hint}
              rows={2}
              className="kb-textarea"
            />
            <button
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
  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i}>{part.slice(2,-2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i}>{part.slice(1,-1)}</code>
        if (part === '\n') return <br key={i}/>
        return part
      })}
    </span>
  )
}