// frontend/src/components/chat/KBOnboarding.jsx
// KB runs the voice profile interview inline in the KB chat screen.
// Feels like a conversation, not a form.

import { useState, useRef, useEffect } from 'react'
import { Send, Mic, MicOff } from 'lucide-react'
import { chat as chatApi } from '../../lib/api'
import { useStore } from '../../store'
import useKBVoice from '../../hooks/useKBVoice'

const GREEN     = 'rgba(74,222,128,1)'
const GREEN_LOW = 'rgba(74,222,128,0.08)'

export default function KBOnboarding({ onComplete }) {
  const { activeCategoryId, loadCategories } = useStore()
  const [messages,  setMessages]  = useState([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [done,      setDone]      = useState(false)
  const bottomRef   = useRef(null)
  const inputRef    = useRef(null)
  const abortRef    = useRef(null)
  const voiceUsed   = useRef(false)

  const { listening, speaking, supported: voiceSupported,
          startListening, stopListening, speak } = useKBVoice({
    onTranscript: ({ text, isFinal }) => {
      setInput(text || '')
      if (isFinal && text?.trim()) {
        voiceUsed.current = true
        sendMessage(text.trim())
      }
    },
  })

  // KB opens the conversation
  useEffect(() => {
    if (!activeCategoryId) return
    openConversation()
  }, [activeCategoryId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  async function openConversation() {
    setStreaming(true)
    let response = ''
    await chatApi.onboard(
      { categoryId: activeCategoryId, history: [], message: null },
      {
        chunk: ({ text }) => { response += text; setStreamText(response) },
        done:  ({ response: r }) => {
          setMessages([{ role: 'assistant', content: r, ts: Date.now() }])
          setStreamText('')
          setStreaming(false)
          if (voiceUsed.current) speak(r)
        },
        error: () => setStreaming(false),
      }
    )
  }

  async function sendMessage(text) {
    const msg = (text || input).trim()
    if (!msg || streaming) return
    setInput('')

    const newMessages = [...messages, { role: 'user', content: msg, ts: Date.now() }]
    setMessages(newMessages)
    setStreaming(true)

    let response = ''
    await chatApi.onboard(
      {
        categoryId: activeCategoryId,
        message:    msg,
        history:    newMessages.map(m => ({ role: m.role, content: m.content })),
      },
      {
        chunk: ({ text }) => { response += text; setStreamText(response) },
        done:  ({ response: r, onboardingComplete }) => {
          setMessages(prev => [...prev, { role: 'assistant', content: r, ts: Date.now() }])
          setStreamText('')
          setStreaming(false)
          if (voiceUsed.current || listening) speak(r)
          voiceUsed.current = false
          if (onboardingComplete) {
            // Reload categories so voice_profile + onboarded_at are fresh
            setTimeout(async () => {
              await loadCategories()
              setDone(true)
            }, 1500)
          }
        },
        error: () => setStreaming(false),
      }
    )
  }

  if (done) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20, padding: 32 }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: GREEN_LOW, border: `1px solid ${GREEN}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>
          ✦
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, fontWeight: 700, color: '#f0ede8', marginBottom: 8 }}>
            Voice profile saved
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.6, maxWidth: 320 }}>
            KB now knows how you talk. Every script from here will sound like you.
          </div>
        </div>
        <button
          onClick={onComplete}
          style={{ padding: '12px 32px', background: GREEN, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, color: '#080808', cursor: 'pointer', fontFamily: "'Figtree', sans-serif" }}
        >
          Start creating →
        </button>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: GREEN, fontFamily: "'Figtree', sans-serif", fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Setting up your voice profile
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>
          Answer naturally — KB is building your creative fingerprint
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 8px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 16, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth:     '80%',
              padding:      '10px 14px',
              borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              background:   m.role === 'user' ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.05)',
              border:       m.role === 'user' ? '1px solid rgba(74,222,128,0.2)' : '1px solid rgba(255,255,255,0.07)',
              fontSize:     14,
              color:        '#e8eaed',
              fontFamily:   "'Figtree', sans-serif",
              lineHeight:   1.55,
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {/* Streaming */}
        {streamText && (
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: '14px 14px 14px 4px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', fontSize: 14, color: '#e8eaed', fontFamily: "'Figtree', sans-serif", lineHeight: 1.55 }}>
              {streamText}
              <span style={{ display: 'inline-block', width: 6, height: 14, background: GREEN, borderRadius: 1, marginLeft: 3, animation: 'pulse 1s infinite', verticalAlign: 'middle' }}/>
            </div>
          </div>
        )}

        {streaming && !streamText && (
          <div style={{ display: 'flex', gap: 5, padding: '0 4px', marginBottom: 16 }}>
            {[0,1,2].map(i => <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(74,222,128,0.4)', animation: `pulse 1.2s ${i*0.2}s infinite` }}/>)}
          </div>
        )}

        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          placeholder="Type your answer..."
          disabled={streaming}
          style={{
            flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 10, padding: '10px 14px', fontSize: 14, color: '#f0ede8',
            fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
        />
        {voiceSupported && (
          <button
            onClick={listening ? stopListening : startListening}
            style={{ width: 38, height: 38, borderRadius: 10, border: 'none', background: listening ? 'rgba(224,48,48,0.15)' : 'rgba(255,255,255,0.04)', color: listening ? '#e03030' : 'rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >
            {listening ? <MicOff size={14}/> : <Mic size={14}/>}
          </button>
        )}
        <button
          onClick={() => sendMessage()}
          disabled={!input.trim() || streaming}
          style={{ width: 38, height: 38, borderRadius: 10, border: 'none', background: input.trim() && !streaming ? GREEN : 'rgba(74,222,128,0.1)', color: input.trim() && !streaming ? '#080808' : 'rgba(74,222,128,0.3)', cursor: input.trim() && !streaming ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}
        >
          <Send size={14}/>
        </button>
      </div>
    </div>
  )
}
