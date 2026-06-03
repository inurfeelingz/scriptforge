// frontend/src/components/chat/ChatPanel.jsx
// KB — editorial dark glass aesthetic
// Fixes in this version:
//   - sendMessageRef pattern so voice auto-sends without stale closure
//   - handleFileUpload uses async job pattern for index-audio (polls for completion)
//   - TTS speak() errors silently swallowed — no error shown to user for TTS
//     (voice input still works; TTS is just bonus output when ElevenLabs is configured)

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Trash2, Loader2, BookmarkPlus, Check,
  Plus, X, Sparkles, Mic, MicOff, Volume2, ChevronDown, Download, FileText, Image,
} from 'lucide-react'
import { useStore }    from '../../store'
import { useNavigate } from 'react-router-dom'
import { chat as chatApi, vault as vaultApi } from '../../lib/api'
import useKBVoice      from '../../hooks/useKBVoice'
import { useLocation } from 'react-router-dom'

const MODE_MAP = {
  '/':             'generate',
  '/pipeline':     'generate',
  '/generate':     'generate',
  '/vault':        'vault',
  '/series':       'series',
  '/analytics':    'analytics',
  '/teleprompter': 'teleprompter',
  '/sound':        'sound',
  '/editor':       'editor',
  '/storyboard':   'storyboard',
  '/schedule':     'analytics',
}

function getModeFromPathname(pathname) {
  if (pathname.startsWith('/episode/')) return 'generate'
  return MODE_MAP[pathname] || 'generate'
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
  .kb-panel::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent 0%, rgba(74,222,128,0.0) 10%, rgba(74,222,128,0.7) 35%, rgba(74,222,128,1) 50%, rgba(74,222,128,0.7) 65%, rgba(74,222,128,0.0) 90%, transparent 100%);
    z-index: 2;
  }
  .kb-panel::after {
    content: '';
    position: absolute;
    top: 0; left: 10%; right: 10%;
    height: 40px;
    background: radial-gradient(ellipse at 50% 0%, rgba(74,222,128,0.12) 0%, transparent 70%);
    pointer-events: none;
    z-index: 1;
  }
  .kb-main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
  .kb-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0; position: sticky; top: 0;
    background: rgba(10,12,18,0.97); z-index: 2;
  }
  .kb-header-mode {
    display: flex; align-items: center; gap: 7px;
    font-family: 'Figtree', sans-serif; font-size: 11px;
    font-weight: 500; letter-spacing: 0.08em;
    text-transform: uppercase; color: rgba(255,255,255,0.35);
  }
  .kb-header-close {
    width: 26px; height: 26px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03); color: rgba(255,255,255,0.35);
    cursor: pointer; display: flex; align-items: center;
    justify-content: center; transition: all 0.15s; touch-action: manipulation;
  }
  .kb-header-close:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.7); }
  .kb-messages {
    flex: 1; overflow-y: auto; padding: 20px 24px;
    display: flex; flex-direction: column; gap: 12px;
    scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.05) transparent;
  }
  .kb-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; gap: 6px; }
  .kb-empty-glyph { font-size: 32px; margin-bottom: 4px; opacity: 0.2; }
  .kb-empty-text { font-size: 13px; color: var(--text3); }
  .kb-msg { display: flex; margin-bottom: 10px; }
  .kb-msg.user { justify-content: flex-end; }
  .kb-msg.assistant { justify-content: flex-start; }
  .kb-bubble {
    max-width: 100%; padding: 11px 15px; border-radius: 16px;
    font-family: 'Figtree', sans-serif; font-size: 14px;
    line-height: 1.7; font-weight: 400;
  }
  .kb-bubble.user {
    border-radius: 18px 18px 4px 18px;
    background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.14);
    color: #ffffff; font-weight: 500;
  }
  .kb-bubble.assistant {
    border-radius: 4px 18px 18px 18px;
    background: rgba(74,222,128,0.08); border: 1px solid rgba(74,222,128,0.18);
    color: rgba(74,222,128,0.95);
  }
  .kb-bubble.error { background: rgba(180,60,60,0.07); border-color: rgba(180,60,60,0.12); color: #bf7070; }
  .kb-bubble strong { color: var(--text); font-weight: 600; }
  .kb-bubble code {
    font-family: 'Figtree', monospace; font-size: 12px;
    background: rgba(255,255,255,0.06); padding: 1px 5px;
    border-radius: 3px; color: var(--text2);
  }
  .kb-thinking { display: flex; gap: 5px; padding: 10px 0; }
  .kb-dot { width: 4px; height: 4px; border-radius: 50%; animation: kb-bounce 0.8s infinite; }
  .kb-dot:nth-child(2) { animation-delay: 0.15s; }
  .kb-dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes kb-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: 0.25; } 40% { transform: translateY(-4px); opacity: 0.9; } }
  .kb-cursor { display: inline-block; width: 2px; height: 12px; border-radius: 1px; margin-left: 2px; vertical-align: middle; animation: kb-blink 1s infinite; }
  @keyframes kb-blink { 0%,100% { opacity: 0 } 50% { opacity: 1 } }
  .kb-input-area { padding: 12px 16px 16px; border-top: 1px solid rgba(255,255,255,0.04); }
  .kb-input-wrap {
    display: flex; gap: 8px; background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.07); border-radius: 10px;
    padding: 8px 12px; transition: border-color 0.2s;
  }
  .kb-input-wrap:focus-within { border-color: rgba(255,255,255,0.12); }
  .kb-textarea {
    flex: 1; background: transparent; border: none; outline: none;
    resize: none; font-family: 'Figtree', sans-serif; font-size: 14px;
    line-height: 1.5; color: var(--text);
  }
  .kb-textarea::placeholder { color: var(--text3); }
  .kb-send {
    align-self: flex-end; width: 30px; height: 30px; border-radius: 7px;
    border: none; cursor: pointer; display: flex; align-items: center;
    justify-content: center; transition: all 0.15s; flex-shrink: 0;
    touch-action: manipulation; -webkit-tap-highlight-color: transparent; user-select: none;
  }
  .kb-send:disabled { opacity: 0.2; cursor: not-allowed; }
  .kb-generate-strip {
    margin: 0 16px 8px; padding: 9px 13px; border-radius: 9px;
    border: 1px solid rgba(74,222,128,0.12); background: rgba(74,222,128,0.04);
    display: flex; align-items: center; justify-content: space-between;
  }
  .kb-generate-text { font-size: 13px; color: rgba(74,222,128,0.55); }
  .kb-generate-btn {
    font-family: 'Figtree', sans-serif; font-size: 13px; font-weight: 500;
    padding: 5px 10px; border-radius: 6px; border: 1px solid rgba(74,222,128,0.18);
    background: rgba(74,222,128,0.07); color: rgba(74,222,128,0.85);
    cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 5px;
  }
  .kb-generate-btn:hover { background: rgba(74,222,128,0.14); color: rgba(74,222,128,1); }
  .kb-generate-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .kb-history-item {
    padding: 11px 13px; border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.04);
    background: transparent; cursor: pointer; transition: all 0.15s; margin-bottom: 5px;
  }
  .kb-history-item:hover { border-color: rgba(255,255,255,0.09); background: rgba(255,255,255,0.02); }
  .kb-history-title { font-size: 14px; color: var(--text2); line-height: 1.4; margin-bottom: 4px; }
  .kb-history-meta { font-size: 11px; color: var(--text3); display: flex; align-items: center; gap: 6px; }
  .kb-history-mode { padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: 500; letter-spacing: 0.05em; text-transform: uppercase; }
  .kb-msg-wrapper:hover .kb-vault-save { opacity: 1 !important; }
`

let stylesInjected = false

// ── POLL HELPER ───────────────────────────────────────────────────────────────
// Polls GET /session/index-audio/:jobId every 4 seconds until done or error.
async function pollIndexAudioJob(jobId, authToken, onProgress) {
  const BASE = import.meta.env.VITE_API_URL || '/api'
  const MAX_POLLS = 120  // 120 × 4s = 8 minutes max

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(r => setTimeout(r, 4000))

    const res = await fetch(`${BASE}/session/index-audio/${jobId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    if (!res.ok) throw new Error(`Poll failed: ${res.status}`)

    const data = await res.json()

    if (data.status === 'processing') {
      onProgress?.(data.progress, data.total)
      continue
    }

    if (data.status === 'done') return data

    if (data.status === 'error') throw new Error(data.error || 'Transcription failed')
  }

  throw new Error('Transcription timed out — try a shorter file')
}

export default function ChatPanel() {
  const { activeCategoryId, activeEpisodeId, notify } = useStore()
  const location = useLocation()
  const navigate = useNavigate()
  const mode     = getModeFromPathname(location.pathname)
  const meta     = MODE_META[mode] || MODE_META.generate

  useEffect(() => {
    if (stylesInjected) return
    const el = document.createElement('style')
    el.textContent = STYLES
    document.head.appendChild(el)
    stylesInjected = true
  }, [])

  const [view,          setView]          = useState('chat')
  const isMobile      = typeof window !== 'undefined' && window.innerWidth < 600
  const [messages,      setMessages]      = useState([])
  const [sessions,      setSessions]      = useState([])
  const [sessionSearch, setSessionSearch] = useState('')
  const [input,         setInput]         = useState('')
  const [streaming,     setStreaming]     = useState(false)
  const [stallSeconds,  setStallSeconds]  = useState(0)
  const stallTimerRef = useRef(null)
  const [streamText,    setStreamText]    = useState('')
  const [committing,    setCommitting]    = useState(false)
  const [committed,     setCommitted]     = useState(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [greeted,       setGreeted]       = useState(false)
  const [indexingAudio, setIndexingAudio] = useState(false)
  const [indexProgress, setIndexProgress] = useState('')
  const [edlState,      setEdlState]      = useState(null)
  const [edlAssign,     setEdlAssign]     = useState({})  // { sessionId: 'screen'|'camera' }
  const bottomRef     = useRef(null)
  const inputRef      = useRef(null)
  const abortRef      = useRef(null)
  const voiceUsedRef  = useRef(false)

  // ── sendMessageRef — always points to latest sendMessage ──────────────────
  // This is the key fix for voice auto-send. Voice callbacks capture this ref,
  // not sendMessage directly, so they always call the current version with
  // current streaming/activeCategoryId state — no stale closure.
  const sendMessageRef = useRef(null)
  const mapMomentsActiveRef = useRef(false)

  const { listening, speaking, audioLevel: voiceLevel, supported: voiceSupported,
          startListening, stopListening, speak, stopSpeaking } = useKBVoice({
    onTranscript: ({ text, isFinal, interim }) => {
      setInput(text || interim || '')
      if (isFinal && text.trim()) {
        voiceUsedRef.current = true
        // Use the ref — not sendMessage directly — so this always calls
        // the latest version regardless of when the callback was created
        sendMessageRef.current?.(text.trim())
      }
    },
    onError: (err) => {
      // Only show permission errors to the user — not-allowed is actionable
      // Everything else (no-speech, TTS failures) is swallowed silently
      if (err === 'not-allowed') {
        notify('Mic permission denied — allow microphone in browser settings', 'error')
      }
    },
  })

  // ── File upload handler with async job polling ────────────────────────────
  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !activeCategoryId) return

    const name     = file.name.toLowerCase()
    const isAudio  = file.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(name)
    const isVideo  = file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm)$/i.test(name)
    const isCSV    = /\.csv$/i.test(name)
    const isScript = /\.(txt|md|fdx|fountain)$/i.test(name)
    const isImage  = file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(name)
    const isDoc    = /\.(pdf|doc|docx)$/i.test(name)
    const isXLS    = /\.(xls|xlsx)$/i.test(name)

    // Block video — too large, use audio extraction workflow instead
    if (isVideo) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Video files are too large to index directly. Export the audio track from DaVinci (File \u2192 Export Audio \u2192 MP3) and upload that instead \u2014 I'll transcribe the full session with timecodes.",
        isError: true,
        timestamp: new Date().toISOString(),
      }])
      e.target.value = ''
      return
    }

    setIndexingAudio(true)
    setIndexProgress('Uploading…')

    try {
      const { supabase: sb } = await import('../../lib/supabase')
      const { data: { session: sess } } = await sb.auth.getSession()
      const BASE = import.meta.env.VITE_API_URL || '/api'

      if (isAudio) {
        // Async job — returns immediately, polls for completion
        // Step 1: Upload to Supabase Storage first
        const fileMB = Math.round(file.size / 1024 / 1024)
        setIndexProgress(`Uploading ${fileMB}MB to storage…`)
        const storagePath = `audio/${sess.user.id}/${Date.now()}-${file.name}`
        const { error: storageErr } = await sb.storage
          .from('session-audio')
          .upload(storagePath, file, { contentType: file.type, upsert: true })
        if (storageErr) throw new Error('Upload failed: ' + storageErr.message)

        const { data: { publicUrl: audioUrl } } = sb.storage
          .from('session-audio')
          .getPublicUrl(storagePath)

        // Step 2: Pass URL to backend for transcription
        setIndexProgress('Starting transcription…')
        const uploadRes = await fetch(BASE + '/session/index-audio', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + sess?.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioUrl,
            storagePath,
            categoryId: activeCategoryId,
            title: file.name.replace(/\.[^.]+$/i, ''),
            fileSizeMb: fileMB,
          }),
        })
        const uploadData = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadData.error)

        const { jobId } = uploadData
        setIndexProgress(`Transcribing ${fileMB}MB — checking progress…`)

        const result = await pollIndexAudioJob(
          jobId,
          sess?.access_token,
          (progress, total) => {
            setIndexProgress(total > 0 ? `Transcribing… chunk ${progress}/${total}` : 'Transcribing…')
          }
        )

        setIndexProgress('')
        const mins = Math.round((result.duration || 0) / 60)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Indexed "${file.name}" — ${mins} min transcribed across ${result.segments || 0} segments with timecodes. I can now reference everything in this session. Want to talk through it?`,
          sessionId: result.sessionId,
          timestamp: new Date().toISOString(),
        }])

      } else if (isImage) {
        setIndexProgress('Reading image…')
        // Convert to base64 and send to KB as vision context
        const reader = new FileReader()
        const base64 = await new Promise((res, rej) => {
          reader.onload = () => res(reader.result.split(',')[1])
          reader.onerror = rej
          reader.readAsDataURL(file)
        })
        // Save as vault entry with image data + ask KB to describe/analyse
        const { error } = await sb.from('vault_entries').insert({
          user_id:     sess.user.id,
          category_id: activeCategoryId,
          type:        'image',
          title:       file.name.replace(/\.[^.]+$/i, ''),
          content:     `[IMAGE: ${file.name}]`,
          image_b64:   base64.slice(0, 200000), // cap at ~200KB base64
          tags:        ['uploaded', 'image'],
        })
        if (error) throw new Error(error.message)
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   `Got the image "${file.name}" — saved to vault. What do you want me to do with it? I can analyse it for thumbnail composition, reference it for styling, or use it to inform episode content.`,
          timestamp: new Date().toISOString(),
        }])

      } else if (isDoc) {
        setIndexProgress('Reading document…')
        const fd = new FormData()
        fd.append('file', file)
        fd.append('categoryId', activeCategoryId)
        fd.append('title', file.name.replace(/\.[^.]+$/i, ''))

        const res  = await fetch(BASE + '/kb/index-doc', {
          method: 'POST', headers: { Authorization: 'Bearer ' + sess?.access_token }, body: fd,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Document indexing failed')
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   `Indexed "${file.name}" — ${data.wordCount || 0} words extracted. I can now reference this document in our conversations. What do you want to do with it?`,
          timestamp: new Date().toISOString(),
        }])

      } else if (isXLS) {
        setIndexProgress('Reading spreadsheet…')
        const fd = new FormData()
        fd.append('file', file)
        fd.append('categoryId', activeCategoryId)
        const res  = await fetch(BASE + '/analytics/upload', {
          method: 'POST', headers: { Authorization: 'Bearer ' + sess?.access_token }, body: fd,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Spreadsheet upload failed')
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   `Got the spreadsheet "${file.name}" — ${data.videoCount || 0} rows processed. Want me to break down what I'm seeing?`,
          timestamp: new Date().toISOString(),
        }])

      } else if (isCSV) {
        setIndexProgress('Reading analytics data…')
        const fd = new FormData()
        fd.append('file', file)
        fd.append('categoryId', activeCategoryId)
        const res  = await fetch(BASE + '/analytics/upload', {
          method: 'POST', headers: { Authorization: 'Bearer ' + sess?.access_token }, body: fd,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Analytics upload failed')
        const rows = (await file.text()).trim().split('\n').length - 1
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   `Got the analytics CSV — ${rows} rows uploaded. I'll use this to inform your next episode recommendations. Want a breakdown?`,
          timestamp: new Date().toISOString(),
        }])

      } else if (isScript) {
        setIndexProgress('Reading script…')
        const text      = await file.text()
        const wordCount = text.trim().split(/\s+/).length
        const { error } = await sb.from('vault_entries').insert({
          user_id:     sess.user.id,
          category_id: activeCategoryId,
          type:        'script',
          title:       file.name.replace(/\.[^.]+$/i, ''),
          content:     text.slice(0, 10000),
          tags:        ['uploaded'],
        })
        if (error) throw new Error(error.message)
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   `Script saved to vault — ${wordCount} words. Want me to review it for hook strength, pacing, or retention points?`,
          timestamp: new Date().toISOString(),
        }])

      } else {
        throw new Error('File type not supported. Upload audio, image, PDF, DOC, XLS, CSV, or script files.')
      }

    } catch (err) {
      setIndexProgress('')
      setMessages(prev => [...prev, {
        role:    'assistant',
        content: err.message,
        isError: true,
        timestamp: new Date().toISOString(),
      }])
    }

    setIndexingAudio(false)
    e.target.value = ''
  }

  // Auto-focus on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [])

  useEffect(() => {
    const handler = () => setTimeout(() => inputRef.current?.focus(), 100)
    window.addEventListener('kb:focus', handler)
    return () => window.removeEventListener('kb:focus', handler)
  }, [])

  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  useEffect(() => {
    if (!activeCategoryId) return
    setMessages([]); setCommitted(null); setGreeted(false)

    const historyPromise = chatApi.getHistory({ categoryId: activeCategoryId, mode })
      .then(({ messages: h }) => h || [])
      .catch(() => [])

    const greetPromise = chatApi.greet({ categoryId: activeCategoryId, mode })
      .catch(() => null)

    Promise.all([historyPromise, greetPromise]).then(([history, greetData]) => {
      // Restore moments cards from localStorage and merge after history
      let withCards = history
      try {
        const saved = localStorage.getItem('kb_moments_' + activeCategoryId)
        if (saved) {
          const cardMsg = JSON.parse(saved)
          if (!history.some(m => m.isMomentsCards)) {
            withCards = [...history, cardMsg]
          }
        }
      } catch {}
      setMessages(withCards)
      let greetMsg = greetData?.message || null

      if (!greetMsg) {
        if (!history.length) {
          const openers = [
            "What are we making?",
            "Your workspace is set up. What's the first episode about?",
            "Let's build something. What's on your mind?",
            "Ready when you are. What's the episode?",
            "Start with the thumbnail — what's the image that stops the scroll?",
          ]
          greetMsg = openers[Math.floor(Math.random() * openers.length)]
        } else {
          const last = history[history.length - 1]
          const minsAgo = last?.timestamp
            ? Math.round((Date.now() - new Date(last.timestamp).getTime()) / 60000)
            : 0
          if (minsAgo >= 5) {
            const lastUserMsg = [...history].reverse().find(m => m.role === 'user')
            const snippet = lastUserMsg?.content?.slice(0, 60) || ''
            greetMsg = snippet
              ? `You were working on something earlier — "${snippet}". Want to pick that up, or start something new?`
              : null
          }
        }
      }

      if (greetMsg) {
        setGreeted(true)
        setMessages(prev => [...prev, {
          role: 'assistant', content: greetMsg,
          timestamp: new Date().toISOString(), isGreeting: true,
        }])
      }
    })
  }, [activeCategoryId, mode])

  useEffect(() => {
    if (view !== 'history') return
    chatApi.getSessions({})
      .then(({ sessions: s }) => setSessions(s || []))
      .catch(() => {})
  }, [view])

  const messagesRef = useRef(null)
  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom < 120) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streamText])

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

  async function saveToVault(text) {
    if (!activeCategoryId || !text?.trim()) return
    try {
      await vaultApi.create({ categoryId: activeCategoryId, type: 'hook', title: text.slice(0, 80), content: text, tags: ['from-kb'] })
      notify('Saved to vault', 'success')
    } catch { notify('Could not save to vault', 'error') }
  }

  const sendMessage = useCallback(async (overrideText) => {
    const text = (overrideText || input).trim()
    if (!text || streaming) return
    setMessages(prev => [...prev, { role: 'user', content: text, timestamp: new Date().toISOString() }])
    setInput('')
    setStreaming(true)
    setStallSeconds(0)
    stallTimerRef.current = setInterval(() => setStallSeconds(s => s + 1), 1000)
    setStreamText('')

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await chatApi.send(
        { categoryId: activeCategoryId, mode, message: text, messages: [], activeEpisodeId: activeEpisodeId || null },
        {
          chunk: ({ text: t }) => {
            if (stallTimerRef.current) { clearInterval(stallTimerRef.current); stallTimerRef.current = null; setStallSeconds(0) }
            setStreamText(prev => prev + t)
          },
          done:  ({ response, action }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: response, timestamp: new Date().toISOString() }])
            setStreamText('')
            if (stallTimerRef.current) { clearInterval(stallTimerRef.current); stallTimerRef.current = null; setStallSeconds(0) }
            setStreaming(false)
            if (voiceUsedRef.current) {
              voiceUsedRef.current = false
              speak(response).catch(() => {})
            }
            if (action === 'show_history')    setTimeout(() => setView('history'), 400)
            if (action === 'generate_episode') setTimeout(() => generateEpisodeFromChat(), 400)
            if (action?.startsWith?.('edl:'))   handleEdlAction(action, response)
            if (action?.startsWith?.('map_moments:')) handleMapMomentsAction(action)
            if (action?.startsWith?.('fill_episode:')) {
              try {
                const data = JSON.parse(action.slice('fill_episode:'.length))
                window.dispatchEvent(new CustomEvent('kb:fill_episode', { detail: data }))
              } catch {}
            }
          },
          error: ({ message: e }) => {
            if (stallTimerRef.current) { clearInterval(stallTimerRef.current); stallTimerRef.current = null; setStallSeconds(0) }
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${e}`, isError: true, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
          },
        },
        controller.signal,
      )
    } catch (err) {
      if (err.name === 'AbortError') { setStreamText(''); setStreaming(false); return }
      // If KB had already started responding, save what we got instead of showing an error
      setStreamText(prev => {
        if (prev && prev.length > 20) {
          setMessages(msgs => [...msgs, {
            role: 'assistant',
            content: prev + '\n\n_(Response was cut short — network issue. Ask KB to continue.)_',
            timestamp: new Date().toISOString(),
          }])
          return ''
        }
        setMessages(msgs => [...msgs, { role: 'assistant', content: 'Connection dropped. Please try again.', isError: true, timestamp: new Date().toISOString() }])
        return ''
      })
      setStreaming(false)
    }
  }, [input, streaming, activeCategoryId, mode, speak])

  // Keep sendMessageRef always pointing at the latest sendMessage
  sendMessageRef.current = sendMessage

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
    setMessages([]); setCommitted(null)
    setView('chat')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function generateEpisodeFromChat() {
    if (!activeCategoryId) return
    let pct = 0
    const genTimerRef = { current: null }
    genTimerRef.current = setInterval(() => {
      pct = pct < 60 ? pct + 1.5 : pct < 80 ? pct + 0.5 : pct < 92 ? pct + 0.15 : pct
      // progress shown via KB message stream — timer just drives the message updates
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
          done: ({ parsed, episodeId, slug }) => {
            clearInterval(genTimerRef.current)
            setMessages(prev => prev.filter(m => !m.isGenerating))
            const epName = slug
              ? slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
              : 'Your episode'
            // Show completion as a KB message, not a strip
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `Episode ready — "${epName}". Tap here to open it.`,
              isEpisodeReady: true,
              episodeId,
              timestamp: new Date().toISOString(),
            }])
            notify('Episode generated!', 'success')
          },
          error: ({ message: e }) => {
            clearInterval(genTimerRef.current)
            setMessages(prev => prev.filter(m => !m.isGenerating))
            notify(e, 'error')
          },
        },
        controller.signal,
      )
    } catch (err) {
      clearInterval(genTimerRef.current)
      if (err.name !== 'AbortError') notify(err.message, 'error')
    }
  }


  // ── EDL CONVERSATION HANDLER ──────────────────────────────────────────────

  // ── Map Moments — polls backend job and displays results ──────────────────
  async function handleMapMomentsAction(action) {
    if (mapMomentsActiveRef.current) return
    mapMomentsActiveRef.current = true
    const sessionId = action.replace('map_moments:', '')
    const { data: { session: sess } } = await (await import('../../lib/supabase')).supabase.auth.getSession()
    const BASE = import.meta.env.VITE_API_URL || '/api'

    // Start the job
    const startRes = await fetch(BASE + '/session/' + sessionId + '/map-moments', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sess?.access_token },
    })
    const { jobId } = await startRes.json()
    if (!jobId) return

    // Poll every 5s
    const poll = setInterval(async () => {
      try {
        const r    = await fetch(BASE + '/session/' + sessionId + '/map-moments/' + jobId, {
          headers: { Authorization: 'Bearer ' + sess?.access_token },
        })
        const data = await r.json()

        if (data.status === 'processing') {
          const pct = data.total > 0 ? Math.round((data.progress / data.total) * 100) : 0
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            if (last?.role === 'assistant' && last?.isMomentsProgress) {
              msgs[msgs.length - 1] = { ...last, content: 'Scanning... ' + data.progress + '/' + data.total + ' chunks (' + pct + '%)' }
            } else {
              msgs.push({ role: 'assistant', content: 'Scanning... ' + data.progress + '/' + data.total + ' chunks (' + pct + '%)', isMomentsProgress: true, timestamp: new Date().toISOString() })
            }
            return msgs
          })
          return
        }

        clearInterval(poll)
        mapMomentsActiveRef.current = false

        if (data.status === 'done' && data.moments?.length) {
          setMessages(prev => {
            const msgs = [...prev]
            const last = msgs[msgs.length - 1]
            const newMsg = {
              role: 'assistant',
              content: 'Found ' + data.total + ' moments. Accept the ones you want to keep:',
              isMomentsCards: true,
              moments: data.moments,
              accepted: {},
              timestamp: new Date().toISOString(),
            }
            if (last?.isMomentsProgress) msgs[msgs.length - 1] = newMsg
            else msgs.push(newMsg)
            return msgs
          })
        } else if (data.status === 'error') {
          setMessages(prev => [...prev, { role: 'assistant', content: 'Moment mapping failed: ' + data.error, isError: true, timestamp: new Date().toISOString() }])
        }
      } catch (err) {
        clearInterval(poll)
        mapMomentsActiveRef.current = false
        console.error('[map-moments poll]', err)
      }
    }, 5000)
  }


  // Poll EDL build job until done, then show download

  async function pollShortsJob(jobId, auth, BASE) {
    return new Promise((resolve, reject) => {
      const poll = setInterval(async () => {
        try {
          const r = await fetch(BASE + '/editor/shorts-job/' + jobId, { headers: auth })
          if (r.status === 404) { clearInterval(poll); reject(new Error('Job expired')); return }
          if (r.headers.get('Content-Type')?.includes('text/plain')) {
            clearInterval(poll)
            let summary = {}
            try { summary = JSON.parse(r.headers.get('X-EDL-Summary') || '{}') } catch {}
            const blob = await r.blob()
            const url  = URL.createObjectURL(blob)
            resolve({ url, summary })
            return
          }
          const data = await r.json()
          if (data.status === 'error') { clearInterval(poll); reject(new Error(data.error)); return }
        } catch (err) { clearInterval(poll); reject(err) }
      }, 4000)
    })
  }

  async function pollEdlJob(jobId, auth, BASE) {
    return new Promise((resolve, reject) => {
      const poll = setInterval(async () => {
        try {
          const r = await fetch(BASE + '/editor/edl-job/' + jobId, { headers: auth })
          if (r.status === 404) { clearInterval(poll); reject(new Error('Job expired')); return }
          if (r.headers.get('Content-Type')?.includes('text/plain')) {
            // Done — EDL content returned
            clearInterval(poll)
            let summary = {}
            try { summary = JSON.parse(r.headers.get('X-EDL-Summary') || '{}') } catch {}
            const blob = await r.blob()
            const url  = URL.createObjectURL(blob)
            resolve({ url, summary })
            return
          }
          const data = await r.json()
          if (data.status === 'error') { clearInterval(poll); reject(new Error(data.error)); return }
          // still processing — keep polling
        } catch (err) { clearInterval(poll); reject(err) }
      }, 4000)
    })
  }

  // KB sends action: 'edl:sync' or 'edl:build:sessionIdA:sessionIdB:offsetMs:clipA:clipB'
  // This function executes the actual API call and shows the result as a chat bubble.

  async function handleEdlAction(action, kbMessage) {
    const parts = action.split(':')
    const BASE  = import.meta.env.VITE_API_URL || '/api'

    try {
      const { supabase: sb } = await import('../../lib/supabase')
      const { data: { session: sess } } = await sb.auth.getSession()
      const auth = { Authorization: 'Bearer ' + sess?.access_token }

      if (parts[1] === 'list_sessions') {
        const catId = parts[2] || activeCategoryId
        const res  = await fetch(`${BASE}/editor/sessions?categoryId=${catId}`, { headers: auth })
        const data = await res.json()
        const sessions = data.sessions || []
        console.log('[EDL] sessions fetched:', sessions.length, 'categoryId:', catId)
        if (!sessions.length) {
          setMessages(prev => [...prev, {
            role:      'assistant',
            content:   'No indexed sessions found. Upload your audio files first using the Upload button.',
            timestamp: new Date().toISOString(),
          }])
          return
        }
        // Single session — ask for video filename before building
        if (sessions.length === 1) {
          const s = sessions[0]
          setMessages(prev => [...prev, {
            role:          'assistant',
            content:       'Found session "' + s.title + '". What is your video file named? (e.g. 20260603 SCREEN VID.mp4)',
            isFilenamePrompt: true,
            session:       s,
            timestamp:     new Date().toISOString(),
          }])
          return
        }
        setMessages(prev => [...prev, {
          role:            'assistant',
          content:         `${sessions.length} sessions indexed. Tap to assign each one:`,
          isSessionPicker: true,
          sessions,
          timestamp:       new Date().toISOString(),
        }])
        return
      }

      if (parts[1] === 'sync') {
        const [,, sessionIdA, sessionIdB] = parts
        setEdlState('syncing')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   'Syncing audio tracks — matching word sequences between both transcripts…',
          isWorking: true,
          timestamp: new Date().toISOString(),
        }])

        const res  = await fetch(`${BASE}/editor/sync-audio`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionIdA, sessionIdB, categoryId: activeCategoryId }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)

        setEdlState(null)
        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   `Sync complete. ${data.summary}\n\nOffset is ${data.offsetMs}ms. Ready to build the EDL — just confirm the target length (default 8 min) and I'll cut it for retention.`,
          syncResult: data,
          timestamp: new Date().toISOString(),
        }])
        return
      }

      if (parts[1] === 'sync_then_build') {
        // Sync two sessions first, then immediately build the EDL with the offset
        const [,, sessionIdA, sessionIdB, clipNameA, clipNameB, targetMins] = parts
        setEdlState('syncing')
        setMessages(prev => [...prev, {
          role: 'assistant', content: 'Syncing audio tracks…', isWorking: true, timestamp: new Date().toISOString(),
        }])

        // Step 1: sync
        const syncRes  = await fetch(`${BASE}/editor/sync-audio`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionIdA, sessionIdB, categoryId: activeCategoryId }),
        })
        const syncData = await syncRes.json()
        if (!syncRes.ok) throw new Error(syncData.error)

        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, {
          role: 'assistant', content: `Sync done — ${syncData.summary}`, timestamp: new Date().toISOString(),
        }])

        // Step 2: build with the real offset
        setEdlState('building')
        setMessages(prev => [...prev, {
          role: 'assistant', content: 'Cutting for retention…', isWorking: true, timestamp: new Date().toISOString(),
        }])

        const buildStartRes = await fetch(`${BASE}/editor/build-session-edl`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId:    activeCategoryId,
            sessionIdA,
            sessionIdB,
            offsetMs:      syncData.offsetMs || 0,
            clipNameA:     decodeURIComponent(clipNameA || 'SCREEN_CAPTURE.mp4'),
            clipNameB:     decodeURIComponent(clipNameB || 'CAMERA_FOOTAGE.mp4'),
            targetMinutes: parseInt(targetMins) || 8,
          }),
        })
        if (!buildStartRes.ok) { const e = await buildStartRes.json(); throw new Error(e.error) }
        const { jobId: buildJobId } = await buildStartRes.json()

        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, { role: 'assistant', content: 'Cutting for retention — this takes about 30 seconds…', isWorking: true, timestamp: new Date().toISOString() }])

        const { url, summary } = await pollEdlJob(buildJobId, auth, BASE)
        const exportId = `edl-${Date.now()}`
        window.__edlDownloads = window.__edlDownloads || {}
        window.__edlDownloads[exportId] = { url, filename: summary.filename || 'edit.edl' }

        setEdlState(null)
        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `EDL ready. Cut ${summary.cutCount || '?'} segments — ${summary.originalMinutes || '?'}min down to ${summary.totalMinutes || '?'}min.`,
          isEdlReady:   true,
          exportId,
          filename:     summary.filename || 'edit.edl',
          cutCount:     summary.cutCount,
          totalMinutes: summary.totalMinutes,
          origMinutes:  summary.originalMinutes,
          timestamp:    new Date().toISOString(),
        }])
        return
      }

      if (parts[1] === 'shorts') {
        const [,, sessionIdA, clipNameA, targetSecs, platform] = parts
        setEdlState('building')
        setMessages(prev => [...prev, { role: 'assistant', content: 'Building Shorts EDL — finding the best ' + (targetSecs || 60) + 's clip…', isWorking: true, timestamp: new Date().toISOString() }])

        const startRes = await fetch(`${BASE}/editor/build-shorts-edl`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId:    activeCategoryId,
            sessionIdA,
            clipNameA:     decodeURIComponent(clipNameA || 'SCREEN_CAPTURE.mp4'),
            targetSeconds: parseInt(targetSecs) || 60,
            platform:      platform || 'tiktok',
          }),
        })
        if (!startRes.ok) { const e = await startRes.json(); throw new Error(e.error) }
        const { jobId: shortsJobId } = await startRes.json()

        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, { role: 'assistant', content: 'Finding the best clip — give me 20 seconds…', isWorking: true, timestamp: new Date().toISOString() }])

        const { url, summary } = await pollShortsJob(shortsJobId, auth, BASE)
        const exportId = `edl-${Date.now()}`
        window.__edlDownloads = window.__edlDownloads || {}
        window.__edlDownloads[exportId] = { url, filename: summary.filename || 'shorts.edl' }

        setEdlState(null)
        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Shorts EDL ready. Best ${Math.round((summary.totalMinutes || 0) * 60)}s clip — "${summary.hook || ''}". Caption: "${summary.caption || ''}"`,
          isEdlReady:   true,
          exportId,
          filename:     summary.filename || 'shorts.edl',
          cutCount:     1,
          totalMinutes: summary.totalMinutes,
          timestamp:    new Date().toISOString(),
        }])
        return
      }

      if (parts[1] === 'build') {
        const [,, sessionIdA, sessionIdB, offsetMs, clipNameA, clipNameB, targetMins] = parts
        setEdlState('building')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   'Building EDL — analysing both transcripts and cutting for retention…',
          isWorking: true,
          timestamp: new Date().toISOString(),
        }])

        const startRes = await fetch(`${BASE}/editor/build-session-edl`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId:    activeCategoryId,
            sessionIdA,
            sessionIdB:    sessionIdB !== 'none' ? sessionIdB : null,
            offsetMs:      parseInt(offsetMs) || 0,
            clipNameA:     decodeURIComponent(clipNameA || 'SCREEN_CAPTURE.mp4'),
            clipNameB:     decodeURIComponent(clipNameB || 'CAMERA_FOOTAGE.mp4'),
            targetMinutes: parseInt(targetMins) || 8,
          }),
        })

        if (!startRes.ok) {
          const errData = await startRes.json()
          throw new Error(errData.error)
        }

        const { jobId: edlJobId } = await startRes.json()

        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, { role: 'assistant', content: 'Cutting for retention — this takes about 30 seconds…', isWorking: true, timestamp: new Date().toISOString() }])

        const { url, summary } = await pollEdlJob(edlJobId, auth, BASE)
        const exportId = `edl-${Date.now()}`
        window.__edlDownloads = window.__edlDownloads || {}
        window.__edlDownloads[exportId] = { url, filename: summary.filename || 'edit.edl' }

        setEdlState(null)
        setMessages(prev => prev.filter(m => !m.isWorking))
        setMessages(prev => [...prev, {
          role:         'assistant',
          content:      `EDL ready. Cut ${summary.cutCount || '?'} segments — ${summary.originalMinutes || '?'}min down to ${summary.totalMinutes || '?'}min.`,
          isEdlReady:   true,
          exportId,
          filename:     summary.filename || 'edit.edl',
          cutCount:     summary.cutCount,
          totalMinutes: summary.totalMinutes,
          origMinutes:  summary.originalMinutes,
          timestamp:    new Date().toISOString(),
        }])
        return
      }

    } catch (err) {
      setEdlState(null)
      setMessages(prev => prev.filter(m => !m.isWorking))
      setMessages(prev => [...prev, {
        role:      'assistant',
        content:   `EDL error: ${err.message}`,
        isError:   true,
        timestamp: new Date().toISOString(),
      }])
    }
  }


  // ── HISTORY VIEW ──────────────────────────────────────────────────────────
  if (view === 'history') {
    return (
      <div className="kb-panel">
        <div className="kb-main">
          <div className="kb-header">
            <div className="kb-header-mode">
              <button onClick={() => setView('chat')} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.4)', fontSize:12, fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:4, padding:0 }}>
                ← Back
              </button>
              <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
              Saved conversations
            </div>
            <button type="button" className="kb-header-close" onClick={() => window.dispatchEvent(new Event('kb:close'))}>
              <X size={12}/>
            </button>
          </div>
          <div className="kb-messages">
            <div style={{ marginBottom: 10 }}>
              <input
                value={sessionSearch}
                onChange={e => setSessionSearch(e.target.value)}
                placeholder="Search conversations..."
                style={{ width:'100%', boxSizing:'border-box', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:7, padding:'7px 10px', color:'rgba(255,255,255,0.6)', fontSize:12, fontFamily:"'Figtree',sans-serif", outline:'none' }}
              />
            </div>
            {sessions.length === 0 && (
              <div style={{ color:'rgba(255,255,255,0.2)', fontSize:11, fontFamily:"'DM Mono', monospace" }}>
                No saved conversations yet — KB auto-saves every chat
              </div>
            )}
            {sessions
              .filter(s => !sessionSearch || s.title?.toLowerCase().includes(sessionSearch.toLowerCase()))
              .map(s => (
                <div key={s.id} className="kb-history-item" onClick={() => loadSession(s.id)}>
                  <div className="kb-history-title">{s.title}</div>
                  <div className="kb-history-meta">
                    <span className="kb-history-mode" style={{ background: meta.color + '15', color: meta.color }}>{s.mode}</span>
                    {new Date(s.updated_at).toLocaleDateString('en', { month:'short', day:'numeric' })}
                    <button onClick={e => deleteSession(s.id, e)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.2)', padding:0 }}>
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
      <div className="kb-main">

        <div className="kb-header">
          <div className="kb-header-mode">
            <span style={{ color: meta.color, fontSize: 14 }}>{meta.glyph}</span>
            {meta.name}
          </div>
          {location.pathname !== '/' && (
            <button type="button" className="kb-header-close" onClick={() => window.dispatchEvent(new Event('kb:close'))}>
              <X size={12}/>
            </button>
          )}
        </div>

        <div className="kb-messages" ref={messagesRef}>
          {messages.length === 0 && !streaming && (
            <div className="kb-empty">
              <div className="kb-empty-glyph" style={{ color: meta.color + '40' }}>{meta.glyph}</div>
              <div className="kb-empty-text" style={{ color: meta.color + '40' }}>{meta.hint}</div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`kb-msg ${msg.role}`}>
              <div style={{ position:'relative', display:'inline-block', maxWidth:'82%' }} className="kb-msg-wrapper">


                {/* Filename prompt for EDL */}
                {msg.isFilenamePrompt && (() => {
                  const [clipName, setClipName] = React.useState(msg.session?.title + '.mp4')
                  return (
                    <div style={{ padding:'12px', borderRadius:10, border:'1px solid rgba(74,222,128,0.15)', background:'rgba(74,222,128,0.03)', maxWidth:320 }}>
                      <p style={{ fontSize:11, color:'rgba(74,222,128,0.7)', fontFamily:"'Figtree',sans-serif", marginBottom:8, fontWeight:600 }}>{msg.content}</p>
                      <input
                        value={clipName}
                        onChange={e => setClipName(e.target.value)}
                        style={{ width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid rgba(74,222,128,0.25)', background:'rgba(255,255,255,0.04)', color:'rgba(255,255,255,0.8)', fontSize:11, fontFamily:"'Figtree',sans-serif", boxSizing:'border-box', marginBottom:8, outline:'none' }}
                        placeholder="filename.mp4"
                      />
                      <button onClick={() => {
                        const clip = encodeURIComponent(clipName.trim() || (msg.session.title + '.mp4'))
                        handleEdlAction('edl:build:' + msg.session.id + ':none:0:' + clip + ':CAMERA.mp4:8', '')
                      }} style={{ width:'100%', padding:'9px 0', borderRadius:8, border:'none', background:'rgba(74,222,128,1)', color:'#080808', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:"'Figtree',sans-serif" }}>
                        Build EDL →
                      </button>
                    </div>
                  )
                })()}

                {/* Moments cards */}
                {msg.isMomentsCards && (() => {
                  const typeLabels = { breakthrough: '💡', frustration: '😤', revelation: '✨', energy: '⚡', funny: '😄', vulnerable: '🫀', opinion: '🎯', decision: '🔑' }
                  const accepted = msg.accepted || {}
                  const acceptedCount = Object.values(accepted).filter(Boolean).length
                  return (
                    <div style={{ padding:'12px', borderRadius:10, border:'1px solid rgba(74,222,128,0.15)', background:'rgba(74,222,128,0.03)', maxWidth: 340 }}>
                      <p style={{ fontSize:11, color:'rgba(74,222,128,0.7)', fontFamily:"'Figtree',sans-serif", marginBottom:10, fontWeight:600 }}>
                        {msg.content} ({acceptedCount} selected)
                      </p>
                      <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight:400, overflowY:'auto' }}>
                        {(msg.moments || []).map((m, mi) => {
                          const isAccepted = accepted[mi]
                          return (
                            <div key={mi} onClick={() => {
                              setMessages(prev => prev.map((pm, pi) => {
                                if (pi !== i) return pm
                                const newAccepted = { ...pm.accepted, [mi]: !pm.accepted?.[mi] }
                                return { ...pm, accepted: newAccepted }
                              }))
                            }} style={{
                              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                              border: `1px solid ${isAccepted ? 'rgba(74,222,128,0.5)' : 'rgba(255,255,255,0.06)'}`,
                              background: isAccepted ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.02)',
                              transition: 'all 0.15s',
                            }}>
                              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:3 }}>
                                <span style={{ fontSize:11 }}>{typeLabels[m.type] || '•'}</span>
                                <span style={{ fontSize:10, color:'rgba(74,222,128,0.6)', fontFamily:"'Figtree',sans-serif" }}>{m.timecode}</span>
                                <span style={{ fontSize:9, color:'rgba(255,255,255,0.2)', fontFamily:"'Figtree',sans-serif", marginLeft:'auto' }}>{isAccepted ? '✓' : '+'}</span>
                              </div>
                              <p style={{ fontSize:11, color:'rgba(255,255,255,0.75)', fontFamily:"'Figtree',sans-serif", margin:0, lineHeight:1.4 }}>{m.summary}</p>
                              {m.quote && <p style={{ fontSize:10, color:'rgba(255,255,255,0.35)', fontFamily:"'Figtree',sans-serif", margin:'4px 0 0', fontStyle:'italic' }}>"{m.quote}"</p>}
                            </div>
                          )
                        })}
                      </div>
                      {acceptedCount > 0 && (
                        <button onClick={() => {
                          const selectedMoments = (msg.moments || []).filter((_, mi) => accepted[mi])
                          const brief = selectedMoments.map(m => m.timecode + ' [' + m.type + '] ' + m.summary).join('\n')
                          setInput('Build the episode structure using these moments:\n' + brief)
                          setTimeout(() => sendMessageRef.current?.(), 50)
                        }} style={{
                          marginTop: 10, width: '100%', padding: '9px 0', borderRadius: 8,
                          border: 'none', background: 'rgba(74,222,128,1)', color: '#080808',
                          cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree',sans-serif"
                        }}>
                          Build Episode with {acceptedCount} moment{acceptedCount !== 1 ? 's' : ''} →
                        </button>
                      )}
                    </div>
                  )
                })()}

                {/* Session picker — tap to assign screen/camera */}
                {msg.isSessionPicker && (() => {
                  const allAssigned = (msg.sessions || []).every(s => edlAssign[s.id]?.role)
                  const hasScreen   = (msg.sessions || []).some(s => edlAssign[s.id]?.role === 'screen')
                  return (
                    <div style={{ padding:'14px', borderRadius:10, border:'1px solid rgba(74,222,128,0.15)', background:'rgba(74,222,128,0.03)', maxWidth:340 }}>
                      <p style={{ fontSize:11, color:'rgba(74,222,128,0.7)', fontFamily:"'Figtree',sans-serif", marginBottom:12, fontWeight:600 }}>
                        Which clip is which?
                      </p>
                      {(msg.sessions || []).map(s => {
                        const state    = edlAssign[s.id] || {}
                        const assigned = state.role
                        const filename = state.filename !== undefined ? state.filename : (s.title + '.mp4')
                        return (
                          <div key={s.id} style={{ marginBottom:10, padding:'10px 12px', borderRadius:8, background:'rgba(255,255,255,0.03)', border:`1px solid ${assigned ? 'rgba(74,222,128,0.3)' : 'rgba(255,255,255,0.07)'}`, transition:'all 0.15s' }}>
                            <p style={{ fontSize:12, color:'rgba(255,255,255,0.75)', fontFamily:"'Figtree',sans-serif", marginBottom:8, fontWeight:600 }}>
                              {s.title} <span style={{ color:'rgba(255,255,255,0.3)', fontWeight:400 }}>— {Math.round((s.duration_ms || 0) / 60000)}min</span>
                            </p>
                            {/* Role selector */}
                            <div style={{ display:'flex', gap:6, marginBottom:8 }}>
                              {[{role:'screen', label:'📺 Screen Capture'}, {role:'camera', label:'🎥 Face Cam'}].map(opt => (
                                <button key={opt.role}
                                  onClick={() => setEdlAssign(prev => ({ ...prev, [s.id]: { ...prev[s.id], role: opt.role, filename: prev[s.id]?.filename !== undefined ? prev[s.id].filename : (s.title + '.mp4') } }))}
                                  style={{ flex:1, padding:'7px 8px', borderRadius:7, border:'none', cursor:'pointer', fontSize:10, fontFamily:"'Figtree',sans-serif", fontWeight:600, transition:'all 0.15s',
                                    background: assigned === opt.role ? 'rgba(74,222,128,1)' : 'rgba(255,255,255,0.06)',
                                    color:      assigned === opt.role ? '#080808' : 'rgba(255,255,255,0.4)' }}>
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                            {/* Filename input */}
                            {assigned && (
                              <input
                                value={filename}
                                onChange={e => setEdlAssign(prev => ({ ...prev, [s.id]: { ...prev[s.id], filename: e.target.value } }))}
                                placeholder="video-filename.mp4"
                                style={{ width:'100%', padding:'6px 9px', borderRadius:6, border:'1px solid rgba(74,222,128,0.2)', background:'rgba(255,255,255,0.04)', color:'rgba(255,255,255,0.7)', fontSize:10, fontFamily:"'Figtree',sans-serif", boxSizing:'border-box', outline:'none' }}
                              />
                            )}
                          </div>
                        )
                      })}
                      {allAssigned && hasScreen && (() => {
                        const screenSession = (msg.sessions || []).find(s => edlAssign[s.id]?.role === 'screen')
                        const cameraSession = (msg.sessions || []).find(s => edlAssign[s.id]?.role === 'camera')
                        const sidA  = screenSession.id
                        const sidB  = cameraSession?.id || 'none'
                        const clipA = encodeURIComponent(edlAssign[sidA]?.filename || (screenSession.title + '.mp4'))
                        const clipB = encodeURIComponent(cameraSession ? (edlAssign[cameraSession.id]?.filename || (cameraSession.title + '.mp4')) : 'CAMERA.mp4')
                        return (
                          <button onClick={() => handleEdlAction(`edl:sync_then_build:${sidA}:${sidB}:${clipA}:${clipB}:8`, '')}
                            style={{ marginTop:4, width:'100%', padding:'10px 0', borderRadius:8, border:'none', background:'rgba(74,222,128,1)', color:'#080808', cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:"'Figtree',sans-serif" }}>
                            Build EDL →
                          </button>
                        )
                      })()}
                    </div>
                  )
                })()}

                {/* EDL ready — download button */}
                {msg.isEdlReady && (
                  <div style={{ padding:'12px 14px', borderRadius:10, border:'1px solid rgba(74,222,128,0.2)', background:'rgba(74,222,128,0.05)', marginBottom:4 }}>
                    <div style={{ fontSize:13, color:'rgba(74,222,128,0.9)', fontFamily:"'Figtree',sans-serif", marginBottom:6, fontWeight:600 }}>
                      ✓ EDL ready — {msg.origMinutes}min → {msg.totalMinutes}min · {msg.cutCount} cuts
                    </div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', fontFamily:"'Figtree',sans-serif", marginBottom:10 }}>
                      {msg.filename} · Import via DaVinci: File → Import Timeline → Import EDL
                    </div>
                    <button
                      onClick={() => {
                        const dl = window.__edlDownloads?.[msg.exportId]
                        if (!dl) return
                        const a = document.createElement('a')
                        a.href = dl.url; a.download = dl.filename; a.click()
                      }}
                      style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 16px', borderRadius:8, border:'none', background:'rgba(74,222,128,1)', color:'#080808', cursor:'pointer', fontSize:13, fontWeight:600, fontFamily:"'Figtree',sans-serif" }}
                    >
                      <Download size={13}/> Download EDL
                    </button>
                  </div>
                )}

                {/* Working indicator */}
                {msg.isWorking && (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', borderRadius:9, border:'1px solid rgba(74,222,128,0.1)', background:'rgba(74,222,128,0.03)' }}>
                    <Loader2 size={13} style={{ color:'rgba(74,222,128,0.6)', animation:'spin 1s linear infinite' }}/>
                    <span style={{ fontSize:13, color:'rgba(74,222,128,0.7)', fontFamily:"'Figtree',sans-serif" }}>{msg.content}</span>
                  </div>
                )}

                {/* Normal bubble for non-special messages */}
                {!msg.isEdlReady && !msg.isWorking && !msg.isSessionPicker && (
                <div
                  className={`kb-bubble ${msg.role} ${msg.isError ? 'error' : ''}`}
                  style={{ maxWidth:'100%', cursor: msg.isEpisodeReady ? 'pointer' : 'default' }}
                  onClick={msg.isEpisodeReady ? () => navigate('/episode/' + msg.episodeId) : undefined}
                >
                  <MessageContent content={msg.content}/>
                  {msg.isGenerating && <span style={{ color:'rgba(100,180,100,0.6)', marginLeft:6 }}>✦</span>}
                  {msg.isEpisodeReady && <span style={{ marginLeft:8, fontSize:11, opacity:0.7 }}>→</span>}
                </div>
                )}
                {msg.role === 'assistant' && !msg.isError && !msg.isGenerating && !msg.isEpisodeReady && !msg.isEdlReady && !msg.isWorking && !msg.isSessionPicker && (
                  <button
                    onClick={() => saveToVault(msg.content)}
                    title="Save to vault"
                    style={{ position:'absolute', bottom:-2, left:6, opacity:0, transition:'opacity 0.15s', padding:'2px 6px', borderRadius:5, border:'1px solid rgba(255,255,255,0.08)', background:'rgba(8,10,16,0.95)', color:'rgba(255,255,255,0.3)', cursor:'pointer', fontSize:10, fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:3 }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '0'}
                    className="kb-vault-save"
                  >
                    ◈ Save
                  </button>
                )}
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
                {stallSeconds >= 15 && (
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginLeft: 8 }}>
                    {stallSeconds >= 45 ? 'Taking longer than usual — still processing…' : stallSeconds >= 15 ? 'Still thinking…' : ''}
                  </span>
                )}
              </div>
            )
          )}

          <div ref={bottomRef}/>
        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            style={{ position:'absolute', bottom:120, left:'50%', transform:'translateX(-50%)', width:34, height:34, borderRadius:'50%', background:'rgba(8,10,16,0.92)', border:'1px solid rgba(74,222,128,0.25)', color:'rgba(74,222,128,0.8)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 2px 12px rgba(0,0,0,0.5)', transition:'all 0.15s', zIndex:5 }}
          >
            <ChevronDown size={16}/>
          </button>
        )}



        {/* Quick prompts */}
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

        {/* Index progress — shown during audio upload/transcription */}
        {indexProgress && (
          <div style={{ padding:'4px 14px 0', fontSize:10, color:'rgba(74,222,128,0.6)', fontFamily:"'Figtree',sans-serif" }}>
            ◈ {indexProgress}
          </div>
        )}

        {/* Action row */}
        <div style={{ display:'flex', gap:6, padding:'0 12px 8px', justifyContent:'space-between', alignItems:'center' }}>
          <label
            title="Upload to KB — audio, image, PDF, DOC, XLS, CSV, or script"
            style={{ fontSize:10, padding:'3px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.06)', background:'transparent', color: indexingAudio ? 'rgba(74,222,128,0.6)' : 'rgba(255,255,255,0.3)', cursor: indexingAudio ? 'wait' : 'pointer', fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:4 }}
          >
            <Plus size={9}/> {indexingAudio ? indexProgress || 'Processing…' : 'Upload'}
            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac,image/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.fountain,.fdx" onChange={handleFileUpload} disabled={indexingAudio} style={{ display:'none' }}/>
          </label>

          <button onClick={newChat}
            style={{ fontSize:10, padding:'3px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.06)', background:'transparent', color:'rgba(255,255,255,0.3)', cursor:'pointer', fontFamily:"'Figtree',sans-serif", display:'flex', alignItems:'center', gap:4 }}>
            <Plus size={9}/> New
          </button>
        </div>


        {/* Quick Actions */}
        <div style={{ display:'flex', gap:4, padding:'0 12px 6px', overflowX:'auto', justifyContent:'center', flexWrap:'wrap' }}>
          {[
            { label:'⚡ Map Moments',       msg:'map this session' },
            { label:'✂️ Build EDL',          msg:'build the edl' },
            { label:'📋 Review Transcript',  msg:'review the transcript' },
            { label:'🎬 Generate Episode',   msg:'generate the episode' },
            { label:'📐 Build Episode',        msg:'build the episode structure' },
            { label:'📱 Shorts EDL',            msg:'build a shorts edl' },
          ].map(({ label, msg }) => (
            <button
              key={label}
              onClick={() => { setInput(msg); setTimeout(() => sendMessageRef.current?.(), 50) }}
              style={{
                fontSize: 9, padding: '3px 8px', borderRadius: 12, whiteSpace: 'nowrap',
                border: '1px solid rgba(74,222,128,0.25)', background: 'rgba(74,222,128,0.06)',
                color: 'rgba(74,222,128,0.7)', cursor: 'pointer', fontFamily: "'Figtree',sans-serif",
              }}
            >
              {label}
            </button>
          ))}
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
                setTimeout(() => inputRef.current?.scrollIntoView({ behavior:'smooth', block:'nearest' }), 150)
              }}
              placeholder={listening ? 'Listening…' : meta.hint}
              rows={2}
              className="kb-textarea"
            />
            {voiceSupported && (
              <button
                onClick={speaking ? stopSpeaking : listening ? stopListening : startListening}
                style={{
                  width:32, height:32, borderRadius:8, border:'none', flexShrink:0,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  background: speaking ? 'rgba(74,222,128,0.15)' : listening ? 'rgba(224,48,48,0.15)' : 'rgba(255,255,255,0.04)',
                  color:      speaking ? 'rgba(74,222,128,0.9)'  : listening ? '#e03030'                : 'rgba(255,255,255,0.25)',
                  cursor:'pointer', transition:'all 0.15s',
                  transform: listening && voiceLevel > 0.1 ? `scale(${1 + voiceLevel * 0.3})` : 'scale(1)',
                }}
                title={speaking ? 'Stop KB' : listening ? 'Stop listening' : 'Voice input'}
              >
                {speaking ? <Volume2 size={13}/> : listening ? <MicOff size={13}/> : <Mic size={13}/>}
              </button>
            )}
            <button
              type="button"
              onClick={() => sendMessage()}
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
  const html = (content || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="font-family:monospace;font-size:0.88em;background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:3px">$1</code>')
  return (
    <span
      style={{ whiteSpace:'pre-wrap', wordBreak:'break-word' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}