// frontend/src/components/chat/ChatPanel.jsx
import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Trash2, Loader2, BookmarkPlus, Check,
  ChevronDown, Plus, Clock, X, Sparkles,
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
}

const MODE_META = {
  generate:     { hint: 'Ask about hooks, structure, trending angles...', color: '#c8b89a', glyph: '✦' },
  vault:        { hint: 'Find ideas, spot patterns, surface gems...',     color: '#8abfbf', glyph: '◈' },
  series:       { hint: 'Plan arcs, suggest callbacks, map the season...', color: '#bf9abf', glyph: '◎' },
  analytics:    { hint: 'Interpret your numbers, find what worked...',    color: '#9abf8a', glyph: '▲' },
  teleprompter: { hint: 'Review this script for speakability...',         color: '#bfaa7a', glyph: '▶' },
  sound:        { hint: 'Discuss atmosphere, music cues, mix notes...',   color: '#7a9abf', glyph: '♪' },
  editor:       { hint: 'Ask about your footage, find clips, plan...',    color: '#bf8a8a', glyph: '▣' },
}

export default function ChatPanel() {
  const { activeCategoryId, notify } = useStore()
  const location = useLocation()
  const mode     = MODE_MAP[location.pathname] || 'generate'
  const meta     = MODE_META[mode] || MODE_META.generate

  const [view,        setView]        = useState('chat')    // 'chat' | 'history'
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

  // Load history on mount / mode / category change
  useEffect(() => {
    if (!activeCategoryId) return
    setMessages([])
    setCommitted(null)
    setSaved(false)
    chatApi.getHistory({ categoryId: activeCategoryId, mode })
      .then(({ messages: h }) => setMessages(h || []))
      .catch(() => {})
  }, [activeCategoryId, mode])

  // Load sessions list when switching to history view
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
    setCommitted(null)
    setSaved(false)

    try {
      await chatApi.send(
        { categoryId: activeCategoryId, mode, message: text, messages: [] },
        {
          chunk: ({ text: t }) => setStreamText(prev => prev + t),
          done:  ({ response }) => {
            setMessages(prev => [...prev, {
              role: 'assistant', content: response, timestamp: new Date().toISOString()
            }])
            setStreamText('')
            setStreaming(false)
          },
          error: ({ message: e }) => {
            setMessages(prev => [...prev, {
              role: 'assistant', content: `Error: ${e}`, isError: true, timestamp: new Date().toISOString()
            }])
            setStreamText('')
            setStreaming(false)
          },
        }
      )
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant', content: `Error: ${err.message}`, isError: true, timestamp: new Date().toISOString()
      }])
      setStreamText('')
      setStreaming(false)
    }
  }, [input, streaming, activeCategoryId, mode])

  async function saveSession() {
    if (!messages.length || saving) return
    setSaving(true)
    try {
      await chatApi.saveSession({ categoryId: activeCategoryId, mode, messages })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch { notify('Could not save session', 'error') }
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
    setMessages([])
    setCommitted(null)
    setSaved(false)
    setView('chat')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function commitEpisode() {
    if (!activeCategoryId || committing) return
    setCommitting(true)
    try {
      const result = await chatApi.commitEpisode({ categoryId: activeCategoryId, mode })
      setCommitted(result.plan)
      notify(`Episode plan committed: "${result.plan.track_name}"`, 'success')
    } catch {
      notify("Couldn't extract episode plan — discuss a specific episode name, mood, and themes first", 'error')
    } finally { setCommitting(false) }
  }

  async function generateEpisodeFromChat() {
    if (!activeCategoryId || generating) return
    setGenerating(true)
    setGenerated(null)
    try {
      await chatApi.generateEpisode(
        { categoryId: activeCategoryId, mode },
        {
          progress: ({ message, pct }) => {
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last?.isGenerating) return [...prev.slice(0,-1), { ...last, content: message, pct }]
              return [...prev, { role: 'assistant', content: message, isGenerating: true, pct }]
            })
          },
          done: ({ episodeId, parsed }) => {
            setMessages(prev => prev.filter(m => !m.isGenerating))
            setGenerated({ episodeId, title: parsed?.metadata?.trackName })
            notify(`Episode "${parsed?.metadata?.trackName}" generated!`, 'success')
            setGenerating(false)
          },
          error: ({ message: errMsg }) => {
            notify(errMsg, 'error')
            setMessages(prev => prev.filter(m => !m.isGenerating))
            setGenerating(false)
          },
        }
      )
    } catch (err) {
      notify(err.message, 'error')
      setGenerating(false)
    }
  }

  const isSeriesMode = mode === 'series' || mode === 'generate'
  const canCommit    = isSeriesMode && messages.length >= 4 && !committed

  // ── HISTORY VIEW ───────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div className="flex flex-col h-full" style={{ background: '#06060a' }}>
        <Header meta={meta} mode={mode}>
          <button onClick={() => setView('chat')}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: meta.color, background: meta.color + '15' }}>
            ← Back
          </button>
        </Header>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest mb-3" style={{ color: meta.color + '60' }}>
            Past conversations
          </div>
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#444]">
              No saved conversations yet.<br/>
              <span style={{ color: meta.color + '80' }}>Save a chat to find it here.</span>
            </div>
          ) : sessions.map(s => (
            <button
              key={s.id}
              onClick={() => loadSession(s.id)}
              className="w-full text-left rounded-lg p-3 border transition-all group"
              style={{ borderColor: '#1a1a1a', background: '#0a0a0f' }}
              onMouseEnter={e => e.currentTarget.style.borderColor = meta.color + '40'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#1a1a1a'}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-[#ccc] leading-snug line-clamp-2 flex-1">{s.title}</span>
                <button
                  onClick={e => deleteSession(s.id, e)}
                  className="text-[#333] hover:text-red-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                >
                  <X size={10}/>
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: meta.color + '15', color: meta.color + '80' }}>
                  {s.mode}
                </span>
                <Clock size={9} className="text-[#333]"/>
                <span className="text-[10px] text-[#444]">
                  {new Date(s.updated_at).toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── CHAT VIEW ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full" style={{ background: '#06060a', maxWidth: '100vw' }}>

      {/* Left meta column — mode, quick prompts, session controls */}
      <div className="flex-col shrink-0 border-r p-4 hidden md:flex"
        style={{ width: 220, borderColor: '#111', background: '#08080e' }}>
        <div className="flex items-center gap-2 mb-4">
          <span style={{ color: meta.color, fontSize: 20 }}>{meta.glyph}</span>
          <div>
            <div className="text-xs font-semibold tracking-wide" style={{ color: meta.color }}>KB</div>
            <div className="text-[9px] capitalize" style={{ color: '#444' }}>{mode} mode</div>
          </div>
        </div>

        {/* Quick prompts */}
        <div className="space-y-1.5 flex-1">
          <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: '#333' }}>Quick start</div>
          {QUICK_PROMPTS[mode]?.map((p, i) => (
            <button key={i} onClick={() => { setInput(p); inputRef.current?.focus() }}
              className="w-full text-left text-[10px] px-2.5 py-2 rounded-lg border transition-all leading-relaxed"
              style={{ borderColor: meta.color + '20', color: '#555', background: meta.color + '08' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = meta.color + '50'; e.currentTarget.style.color = meta.color }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = meta.color + '20'; e.currentTarget.style.color = '#555' }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Session controls */}
        <div className="flex flex-col gap-2 mt-4 pt-4 border-t" style={{ borderColor: '#111' }}>
          {messages.length > 2 && !saved && (
            <button onClick={saveSession} disabled={saving}
              className="text-[10px] px-2 py-1.5 rounded border transition-all text-left"
              style={{ color: '#555', background: '#0d0d0d', borderColor: '#1a1a1a' }}>
              {saving ? 'Saving...' : 'Save conversation'}
            </button>
          )}
          {saved && <div className="text-[10px] flex items-center gap-1" style={{ color: meta.color }}><Check size={9}/> Saved</div>}
          <button onClick={() => setView(view === 'history' ? 'chat' : 'history')}
            className="text-[10px] px-2 py-1.5 rounded border transition-all text-left flex items-center gap-1.5"
            style={{ color: '#555', background: '#0d0d0d', borderColor: '#1a1a1a' }}>
            <Clock size={9}/> {view === 'history' ? 'Back to chat' : 'Past conversations'}
          </button>
          <button onClick={newChat}
            className="text-[10px] px-2 py-1.5 rounded border transition-all text-left flex items-center gap-1.5"
            style={{ color: '#555', background: '#0d0d0d', borderColor: '#1a1a1a' }}>
            <Plus size={9}/> New conversation
          </button>
          {canCommit && (
            <button onClick={commitEpisode} disabled={committing}
              className="text-[10px] px-2 py-1.5 rounded border transition-all text-left flex items-center gap-1.5"
              style={{ borderColor: meta.color + '30', color: meta.color + '90', background: meta.color + '08' }}>
              {committing ? <Loader2 size={9} className="animate-spin"/> : <BookmarkPlus size={9}/>}
              {committing ? 'Committing...' : 'Commit episode plan'}
            </button>
          )}
          {isSeriesMode && messages.length >= 4 && !generated && (
            <button onClick={generateEpisodeFromChat} disabled={generating || streaming}
              className="text-[10px] px-2 py-1.5 rounded border transition-all text-left flex items-center gap-1.5"
              style={{ borderColor: '#6a9a6a40', color: generating ? '#6a9a6a' : '#4a7a4a', background: '#0a140a' }}>
              {generating ? <Loader2 size={9} className="animate-spin"/> : <Sparkles size={9}/>}
              {generating ? 'Generating...' : 'Generate episode from chat'}
            </button>
          )}
          {generated && (
            <div className="text-[10px] flex items-center gap-1 px-2 py-1.5 rounded border"
              style={{ borderColor: '#2a4a2a', color: '#6abf6a', background: '#0a140a' }}>
              <Check size={9}/> "{generated.title}" ready
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex flex-col flex-1 min-w-0">

      {/* Header */}
      <Header meta={meta} mode={mode}>
        <div className="flex items-center gap-1">
          {messages.length > 2 && !saved && (
            <button onClick={saveSession} disabled={saving}
              className="text-[10px] px-2 py-1 rounded transition-all"
              style={{ color: '#555', background: '#111' }}
              title="Save this conversation"
            >
              {saving ? <Loader2 size={9} className="animate-spin"/> : 'Save'}
            </button>
          )}
          {saved && (
            <span className="text-[10px] flex items-center gap-1" style={{ color: meta.color }}>
              <Check size={9}/> Saved
            </span>
          )}
          <button onClick={() => setView('history')}
            className="p-1.5 rounded transition-colors text-[#444] hover:text-[#888]"
            title="Past conversations">
            <Clock size={12}/>
          </button>
          <button onClick={newChat}
            className="p-1.5 rounded transition-colors text-[#444] hover:text-[#888]"
            title="New conversation">
            <Plus size={12}/>
          </button>
        </div>
      </Header>

      {/* Committed banner */}
      {committed && (
        <div className="px-4 py-2 text-[10px] leading-relaxed border-b"
          style={{ background: '#0a1a0f', borderColor: '#1a3a1f', color: '#6abf7a' }}>
          <Check size={9} className="inline mr-1"/>
          <span className="font-medium">"{committed.track_name}"</span> committed to your series
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">

        {/* Empty state */}
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-4 pb-8">
            <div className="text-4xl" style={{ color: meta.color + '40' }}>{meta.glyph}</div>
            <div className="text-center space-y-1">
              <div className="text-xs font-medium" style={{ color: meta.color + '80' }}>
                KB — Knowledge Base
              </div>
              <div className="text-[11px] text-[#444] leading-relaxed max-w-[200px] text-center">
                {meta.hint}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5 w-full mt-2">
              {QUICK_PROMPTS[mode]?.map((p, i) => (
                <button key={i} onClick={() => { setInput(p); inputRef.current?.focus() }}
                  className="text-left text-[10px] px-3 py-2 rounded-lg border transition-all"
                  style={{ borderColor: meta.color + '20', color: '#666', background: meta.color + '08' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = meta.color + '50'; e.currentTarget.style.color = meta.color }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = meta.color + '20'; e.currentTarget.style.color = '#666' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} meta={meta}/>
        ))}

        {streaming && (
          streamText
            ? <ChatMessage message={{ role: 'assistant', content: streamText, streaming: true }} meta={meta}/>
            : <ThinkingDots color={meta.color}/>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Commit episode strip */}
      {canCommit && (
        <div className="px-4 pb-2">
          <button onClick={commitEpisode} disabled={committing}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-[11px] transition-all"
            style={{ borderColor: meta.color + '30', color: meta.color + '90', background: meta.color + '08' }}
            onMouseEnter={e => { e.currentTarget.style.background = meta.color + '15'; e.currentTarget.style.color = meta.color }}
            onMouseLeave={e => { e.currentTarget.style.background = meta.color + '08'; e.currentTarget.style.color = meta.color + '90' }}
          >
            {committing
              ? <Loader2 size={11} className="animate-spin"/>
              : <BookmarkPlus size={11}/>
            }
            {committing ? 'Extracting plan...' : 'Commit episode plan to series'}
          </button>
        </div>
      )}

      {/* Input */}
      <div className="px-3 pb-3 shrink-0">
        <div className="flex gap-2 rounded-xl border p-2 transition-all focus-within:border-opacity-60"
          style={{ borderColor: meta.color + '25', background: '#0d0d14' }}
          onFocus={() => {}}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
            }}
            placeholder={meta.hint}
            rows={2}
            className="flex-1 bg-transparent text-xs text-[#ddd] placeholder-[#333] resize-none outline-none leading-relaxed"
            style={{ color: '#ccc' }}
          />
          <button onClick={sendMessage} disabled={!input.trim() || streaming}
            className="self-end p-2 rounded-lg transition-all disabled:opacity-25"
            style={{ background: meta.color, color: '#080808' }}
          >
            <Send size={12}/>
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Header({ meta, mode, children }) {
  return (
    <div className="px-4 py-3 border-b flex items-center justify-between shrink-0"
      style={{ borderColor: '#111', background: '#08080e' }}>
      <div className="flex items-center gap-2">
        <span style={{ color: meta.color, fontSize: 16, lineHeight: 1 }}>{meta.glyph}</span>
        <div>
          <div className="text-xs font-semibold tracking-wide" style={{ color: meta.color }}>KB</div>
          <div className="text-[9px] capitalize" style={{ color: '#444' }}>{mode} mode</div>
        </div>
      </div>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}

function ThinkingDots({ color }) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ background: color + '60', animationDelay: `${i * 150}ms`, animationDuration: '800ms' }}/>
      ))}
    </div>
  )
}

function ChatMessage({ message, meta }) {
  const isUser = message.role === 'user'
  const color  = meta?.color || '#c8b89a'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[11px] leading-relaxed ${
        isUser ? 'rounded-br-sm' : 'rounded-bl-sm'
      }`} style={isUser ? {
        background: color + '18',
        border: `1px solid ${color}30`,
        color: color,
      } : message.isError ? {
        background: '#1a0808',
        border: '1px solid #3a1515',
        color: '#bf6a6a',
      } : {
        background: '#0f0f18',
        border: '1px solid #1e1e2e',
        color: '#c8c8d8',
      }}>
        <MessageContent content={message.content} color={color}/>
        {message.streaming && (
          <span className="inline-block w-0.5 h-3 ml-0.5 animate-pulse align-middle rounded"
            style={{ background: color + '80' }}/>
        )}
      </div>
    </div>
  )
}

function MessageContent({ content, color }) {
  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**'))
          return <strong key={i} style={{ color: color || '#e8e8e8', fontWeight: 600 }}>{part.slice(2,-2)}</strong>
        if (part.startsWith('`') && part.endsWith('`'))
          return <code key={i} className="font-mono text-[10px] px-1 rounded" style={{ background: '#1a1a2e', color: '#a8b8d8' }}>{part.slice(1,-1)}</code>
        if (part === '\n') return <br key={i}/>
        return part
      })}
    </span>
  )
}

// Quick prompt suggestions per mode
const QUICK_PROMPTS = {
  generate:     ['What hooks are trending in my niche?', 'Outline my next episode', "What's working in my top videos?"],
  series:       ['Map out the next 4 episodes', 'What callbacks can I plant now?', 'How is my series arc developing?'],
  vault:        ['Surface my strongest unused ideas', 'What topics keep coming up?', 'Find ideas that fit current trends'],
  analytics:    ['Why did my last video underperform?', 'What hook types work best for me?', 'Where do viewers drop off?'],
  teleprompter: ['Does this script sound natural?', 'Flag anything that reads not speaks', 'Shorten the opening'],
  sound:        ['Suggest music for this mood', 'Where should I use silence?', 'Describe the sonic landscape'],
  editor:       ['Which clips match this beat?', 'How should I structure this edit?', 'Find broll for this section'],
}