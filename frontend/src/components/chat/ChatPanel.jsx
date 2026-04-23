// frontend/src/components/chat/ChatPanel.jsx
import { useState, useRef, useEffect } from 'react'
import { Send, Trash2, Loader2 } from 'lucide-react'
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
}

const MODE_HINTS = {
  generate:     'Ask about hooks, structure, trending angles...',
  vault:        'Find ideas, spot patterns, surface gems...',
  series:       'Plan arcs, suggest callbacks, map the season...',
  analytics:    'Interpret your numbers, find what worked...',
  teleprompter: 'Review this script for speakability...',
  sound:        'Discuss atmosphere, music cues, mix notes...',
}

export default function ChatPanel() {
  const { activeCategoryId } = useStore()
  const location = useLocation()
  const mode = MODE_MAP[location.pathname] || 'generate'

  const [messages, setMessages]   = useState([])
  const [input, setInput]         = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  // Load history on mode/category change
  useEffect(() => {
    if (!activeCategoryId) return
    chatApi.getHistory({ categoryId: activeCategoryId, mode })
      .then(({ messages: history }) => setMessages(history || []))
      .catch(() => {})
  }, [activeCategoryId, mode])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  async function send() {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg = { role: 'user', content: text, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)
    setStreamText('')

    try {
      await chatApi.send(
        {
          categoryId: activeCategoryId,
          mode,
          message: text,
          messages: messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        },
        {
          chunk: ({ text: t }) => setStreamText(prev => prev + t),
          done:  ({ response }) => {
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: response, timestamp: new Date().toISOString() }
            ])
            setStreamText('')
            setStreaming(false)
          },
          error: ({ message }) => {
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: `Error: ${message}`, isError: true, timestamp: new Date().toISOString() }
            ])
            setStreamText('')
            setStreaming(false)
          },
        }
      )
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}`, isError: true, timestamp: new Date().toISOString() }
      ])
      setStreamText('')
      setStreaming(false)
    }
  }

  async function clearHistory() {
    await chatApi.clearHistory({ categoryId: activeCategoryId, mode })
    setMessages([])
  }

  return (
    <div className="flex flex-col h-full bg-[#080808]">

      {/* Header */}
      <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between shrink-0">
        <div>
          <div className="text-xs text-[#c8b89a] font-medium tracking-wide">Claude</div>
          <div className="text-[10px] text-[#444] mt-0.5 capitalize">{mode} mode</div>
        </div>
        <button
          onClick={clearHistory}
          className="text-[#333] hover:text-[#666] transition-colors"
          title="Clear conversation"
        >
          <Trash2 size={12}/>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="text-center py-8">
            <div className="text-xs text-[#333] leading-relaxed">
              {MODE_HINTS[mode]}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}

        {/* Streaming response */}
        {streaming && (
          <div className="space-y-1">
            {streamText ? (
              <ChatMessage message={{ role: 'assistant', content: streamText, streaming: true }} />
            ) : (
              <div className="flex items-center gap-2 text-[#444]">
                <Loader2 size={12} className="animate-spin"/>
                <span className="text-xs">Thinking...</span>
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[#1a1a1a] shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder={MODE_HINTS[mode]}
            rows={2}
            className="flex-1 bg-[#111] border border-[#222] rounded px-3 py-2 text-xs text-[#ddd] placeholder-[#333] resize-none outline-none focus:border-[#c8b89a]/40 transition-colors"
          />
          <button
            onClick={send}
            disabled={!input.trim() || streaming}
            className="self-end px-3 py-2 bg-[#c8b89a]/10 border border-[#c8b89a]/20 text-[#c8b89a] rounded hover:bg-[#c8b89a]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <Send size={12}/>
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`
        max-w-[90%] rounded px-3 py-2 text-xs leading-relaxed
        ${isUser
          ? 'bg-[#c8b89a]/10 text-[#c8b89a] border border-[#c8b89a]/10'
          : message.isError
            ? 'text-red-400 border border-red-900/30 bg-red-950/20'
            : 'text-[#bbb] border border-[#1a1a1a] bg-[#0d0d0d]'
        }
        ${message.streaming ? 'border-[#c8b89a]/20' : ''}
      `}>
        <MessageContent content={message.content} />
        {message.streaming && (
          <span className="inline-block w-1 h-3 bg-[#c8b89a]/60 ml-0.5 animate-pulse align-middle"/>
        )}
      </div>
    </div>
  )
}

function MessageContent({ content }) {
  // Basic markdown: **bold**, `code`, newlines
  const parts = content.split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-medium text-[#ddd]">{part.slice(2,-2)}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={i} className="font-mono bg-[#1a1a1a] px-1 rounded text-[10px]">{part.slice(1,-1)}</code>
        }
        if (part === '\n') return <br key={i}/>
        return part
      })}
    </span>
  )
}
