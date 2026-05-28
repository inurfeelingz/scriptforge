// frontend/src/components/chat/KBOnboarding.jsx
// KB voice profile interview — runs once when a new workspace has no voice_profile.
// Calls /api/chat/onboard (SSE stream). When backend sends onboardingComplete:true,
// calls props.onComplete() which switches KBHome to the full ChatPanel.

import { useState, useRef, useEffect } from 'react'
import { useStore } from '../../store'
import { chat as chatApi } from '../../lib/api'
import useKBVoice from '../../hooks/useKBVoice'

function MessageContent({ content }) {
  if (!content) return null
  return (
    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {content}
    </div>
  )
}

export default function KBOnboarding({ onComplete }) {
  const { activeCategoryId } = useStore()
  const [messages,    setMessages]    = useState([])
  const [input,       setInput]       = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const [streamText,  setStreamText]  = useState('')
  const [done,        setDone]        = useState(false)

  const inputRef      = useRef(null)
  const bottomRef     = useRef(null)
  const controllerRef = useRef(null)
  const voiceUsedRef  = useRef(false)

  const { listening, speaking, supported: voiceSupported,
          startListening, stopListening, speak } = useKBVoice({
    onTranscript: ({ text, isFinal, interim }) => {
      setInput(text || interim || '')
      if (isFinal && text.trim()) {
        voiceUsedRef.current = true
        sendMessage(text.trim())
      }
    },
  })

  // KB sends the first question automatically on mount
  useEffect(() => {
    if (!activeCategoryId) return
    sendMessage('__START__')
  }, [activeCategoryId])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamText])

  // Focus input after streaming
  useEffect(() => {
    if (!streaming) setTimeout(() => inputRef.current?.focus(), 200)
  }, [streaming])

  async function sendMessage(text) {
    if (streaming) return
    const userMessage = text === '__START__' ? null : text.trim()
    if (!userMessage && text !== '__START__') return

    if (userMessage) {
      setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date().toISOString() }])
      setInput('')
    }

    setStreaming(true)
    controllerRef.current?.abort()
    controllerRef.current = new AbortController()

    const history = messages.map(m => ({ role: m.role, content: m.content }))

    try {
      await chatApi.onboard(
        {
          categoryId: activeCategoryId,
          message:    userMessage || '',
          history,
        },
        {
          chunk: ({ text: t }) => setStreamText(prev => prev + t),
          done:  ({ response, onboardingComplete }) => {
            setMessages(prev => [
              ...prev,
              { role: 'assistant', content: response, timestamp: new Date().toISOString() }
            ])
            setStreamText('')
            setStreaming(false)
            if (voiceUsedRef.current) { voiceUsedRef.current = false; speak(response) }
            if (onboardingComplete) {
              setDone(true)
              // Small delay so user reads the closing message before switching
              setTimeout(() => onComplete?.(), 2200)
            }
          },
          error: ({ message: e }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong: ' + e, isError: true, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
          },
        },
        controllerRef.current.signal,
      )
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: err.message, isError: true, timestamp: new Date().toISOString() }])
      }
      setStreamText('')
      setStreaming(false)
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg)', fontFamily: "'Figtree', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(74,222,128,1)', flexShrink: 0 }}/>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
          KB — setting up your voice profile
        </div>
        {done && (
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(74,222,128,0.7)' }}>
            ✓ Profile saved
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((msg, i) => (
          <div key={i} className={`kb-msg ${msg.role}`}>
            <div className={`kb-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}>
              <MessageContent content={msg.content}/>
            </div>
          </div>
        ))}
        {streamText && (
          <div className="kb-msg assistant">
            <div className="kb-bubble assistant">
              <MessageContent content={streamText}/>
              <span style={{ display: 'inline-block', width: 6, height: 14, background: 'rgba(74,222,128,0.5)', borderRadius: 2, marginLeft: 4, verticalAlign: 'middle', animation: 'kb-blink 1s step-end infinite' }}/>
            </div>
          </div>
        )}
        {streaming && !streamText && (
          <div className="kb-msg assistant">
            <div className="kb-bubble assistant" style={{ color: 'rgba(74,222,128,0.4)' }}>
              thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      {!done && (
        <div style={{ padding: '8px 12px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Answer KB..."
              rows={1}
              disabled={streaming}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10,
                padding: '10px 12px', fontSize: 14, color: 'var(--text)',
                fontFamily: "'Figtree', sans-serif", resize: 'none',
                outline: 'none', lineHeight: 1.5,
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(74,222,128,0.25)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
            {voiceSupported && (
              <button
                onClick={listening ? stopListening : startListening}
                style={{
                  width: 36, height: 36, borderRadius: 8, border: 'none', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: listening ? 'rgba(224,48,48,0.15)' : 'rgba(255,255,255,0.04)',
                  color: listening ? '#e03030' : 'rgba(255,255,255,0.25)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {listening ? '◼' : '🎤'}
              </button>
            )}
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || streaming}
              style={{
                width: 36, height: 36, borderRadius: 8, border: 'none', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: input.trim() && !streaming ? 'rgba(74,222,128,1)' : 'rgba(74,222,128,0.1)',
                color: input.trim() && !streaming ? '#080808' : 'rgba(74,222,128,0.3)',
                cursor: input.trim() && !streaming ? 'pointer' : 'default',
                transition: 'all 0.15s', fontSize: 16,
              }}
            >
              ↑
            </button>
          </div>
        </div>
      )}

      <style>{`
        .kb-msg { display: flex; margin-bottom: 10px; }
        .kb-msg.user      { justify-content: flex-end; }
        .kb-msg.assistant { justify-content: flex-start; }
        .kb-bubble { max-width: 82%; padding: 11px 15px; border-radius: 16px; font-size: 14px; line-height: 1.7; }
        .kb-bubble.user      { border-radius: 18px 18px 4px 18px; background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.14); color: #ffffff; font-weight: 500; }
        .kb-bubble.assistant { border-radius: 4px 18px 18px 18px; background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.18); color: rgba(74,222,128,0.95); }
        .kb-bubble.error     { background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.2); color: #f87171; }
        @keyframes kb-blink  { 0%,100%{opacity:1} 50%{opacity:0} }
      `}</style>
    </div>
  )
}