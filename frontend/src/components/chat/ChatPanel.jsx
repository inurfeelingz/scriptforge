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
  const [streamText,    setStreamText]    = useState('')
  const [committing,    setCommitting]    = useState(false)
  const [committed,     setCommitted]     = useState(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [greeted,       setGreeted]       = useState(false)
  const [indexingAudio, setIndexingAudio] = useState(false)
  const [indexProgress, setIndexProgress] = useState('')
  const [edlState,      setEdlState]      = useState(null)  // null | 'syncing' | 'building' | { exportId, filename, cutCount, totalMinutes }
  const bottomRef     = useRef(null)
  const inputRef      = useRef(null)
  const abortRef      = useRef(null)
  const voiceUsedRef  = useRef(false)

  // ── sendMessageRef — always points to latest sendMessage ──────────────────
  // This is the key fix for voice auto-send. Voice callbacks capture this ref,
  // not sendMessage directly, so they always call the current version with
  // current streaming/activeCategoryId state — no stale closure.
  const sendMessageRef = useRef(null)

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
    const files = Array.from(e.target.files || [])
    if (!files.length || !activeCategoryId) return

    // Separate audio files from everything else
    const audioFiles = files.filter(f => {
      const n = f.name.toLowerCase()
      return f.type.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|flac)$/i.test(n)
    })
    const otherFiles = files.filter(f => !audioFiles.includes(f))

    // Process non-audio files first (fast — no transcription needed)
    for (const file of otherFiles) {
      await handleSingleFile(file)
    }

    // Process audio files — queue them all, show combined progress
    if (audioFiles.length) {
      await handleAudioFiles(audioFiles)
    }

    e.target.value = ''
  }

  async function handleSingleFile(file) {
    const name     = file.name.toLowerCase()
    const isVideo  = file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm)$/i.test(name)
    const isCSV    = /\.csv$/i.test(name)
    const isScript = /\.(txt|md|fdx|fountain)$/i.test(name)
    const isImage  = file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(name)
    const isDoc    = /\.(pdf|doc|docx)$/i.test(name)
    const isXLS    = /\.(xls|xlsx)$/i.test(name)

    if (isVideo) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "Video files are too large to index directly. Export the audio track from DaVinci (File \u2192 Export Audio \u2192 MP3) and upload that instead \u2014 I'll transcribe the full session with timecodes.",
        isError: true,
        timestamp: new Date().toISOString(),
      }])
      return
    }

    setIndexingAudio(true)

    try {
      const { supabase: sb } = await import('../../lib/supabase')
      const { data: { session: sess } } = await sb.auth.getSession()
      const BASE = import.meta.env.VITE_API_URL || '/api'

      if (isImage) {
        setIndexProgress(`Reading ${file.name}…`)
        const reader = new FileReader()
        const base64 = await new Promise((res, rej) => {
          reader.onload = () => res(reader.result.split(',')[1])
          reader.onerror = rej
          reader.readAsDataURL(file)
        })
        await sb.from('vault_entries').insert({
          user_id:     sess.user.id,
          category_id: activeCategoryId,
          type:        'image',
          title:       file.name.replace(/\.[^.]+$/i, ''),
          content:     `[IMAGE: ${file.name}]`,
          image_b64:   base64.slice(0, 200000),
          tags:        ['uploaded', 'image'],
        })
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Got the image "${file.name}" — saved to vault. What do you want me to do with it?`,
          timestamp: new Date().toISOString(),
        }])

      } else if (isDoc) {
        setIndexProgress(`Reading ${file.name}…`)
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
          role: 'assistant',
          content: `Indexed "${file.name}" — ${data.wordCount || 0} words extracted and saved to vault.`,
          timestamp: new Date().toISOString(),
        }])

      } else if (isXLS || isCSV) {
        setIndexProgress(`Reading ${file.name}…`)
        const fd = new FormData()
        fd.append('file', file)
        fd.append('categoryId', activeCategoryId)
        const res  = await fetch(BASE + '/analytics/upload', {
          method: 'POST', headers: { Authorization: 'Bearer ' + sess?.access_token }, body: fd,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Upload failed')
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Got the data file "${file.name}" — ${data.videoCount || 0} rows processed. Want a breakdown?`,
          timestamp: new Date().toISOString(),
        }])

      } else if (isScript) {
        setIndexProgress(`Reading ${file.name}…`)
        const text = await file.text()
        const { data: { session: sess2 } } = await sb.auth.getSession()
        await sb.from('vault_entries').insert({
          user_id:     sess2.user.id,
          category_id: activeCategoryId,
          type:        'script',
          title:       file.name.replace(/\.[^.]+$/i, ''),
          content:     text.slice(0, 10000),
          tags:        ['uploaded'],
        })
        setIndexProgress('')
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Script "${file.name}" saved — ${text.trim().split(/\s+/).length} words. Want me to review it for hook strength or pacing?`,
          timestamp: new Date().toISOString(),
        }])
      }

    } catch (err) {
      setIndexProgress('')
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error with "${file.name}": ${err.message}`,
        isError: true,
        timestamp: new Date().toISOString(),
      }])
    }

    setIndexingAudio(false)
  }

  async function handleAudioFiles(audioFiles) {
    setIndexingAudio(true)

    try {
      const { supabase: sb } = await import('../../lib/supabase')
      const { data: { session: sess } } = await sb.auth.getSession()
      const BASE = import.meta.env.VITE_API_URL || '/api'

      const totalMB = Math.round(audioFiles.reduce((s, f) => s + f.size, 0) / 1024 / 1024)
      const jobIds  = []

      // Upload all audio files to Supabase Storage first, fire jobs in parallel
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i]
        const fileMB = Math.round(file.size / 1024 / 1024)
        setIndexProgress(`Uploading ${i + 1}/${audioFiles.length}: ${file.name} (${fileMB}MB)…`)

        const storagePath = `audio-uploads/${sess.user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

        const { error: storageErr } = await sb.storage
          .from('session-audio')
          .upload(storagePath, file, { contentType: file.type || 'audio/mpeg', upsert: false })

        if (storageErr) throw new Error(`Storage upload failed for "${file.name}": ` + storageErr.message)

        const { data: signedData, error: signErr } = await sb.storage
          .from('session-audio')
          .createSignedUrl(storagePath, 7200)

        if (signErr || !signedData?.signedUrl) throw new Error('Could not get signed URL for ' + file.name)

        const uploadRes = await fetch(BASE + '/session/index-audio', {
          method:  'POST',
          headers: { Authorization: 'Bearer ' + sess?.access_token, 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            audioUrl:    signedData.signedUrl,
            storagePath,
            categoryId:  activeCategoryId,
            title:       file.name.replace(/\.[^.]+$/i, ''),
            fileSizeMb:  fileMB,
          }),
        })
        const uploadData = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadData.error)

        jobIds.push({ jobId: uploadData.jobId, name: file.name })
      }

      // Now poll all jobs simultaneously
      setIndexProgress(`Transcribing ${audioFiles.length} file${audioFiles.length > 1 ? 's' : ''}…`)

      const results = await Promise.all(jobIds.map(({ jobId, name }) =>
        pollIndexAudioJob(jobId, sess?.access_token, () => {})
      ))

      setIndexProgress('')

      // Build a combined confirmation message listing all indexed sessions
      const sessionLines = results.map((result, i) => {
        const mins = Math.round((result.duration || 0) / 60)
        const segs = result.segments || 0
        return `"${audioFiles[i].name}" — ${mins}min, ${segs} segments`
      }).join('\n')

      const sessionIds = results.map(r => r.sessionId).filter(Boolean)

      setMessages(prev => [...prev, {
        role:       'assistant',
        content:    `Indexed ${audioFiles.length} session${audioFiles.length > 1 ? 's' : ''}:\n${sessionLines}\n\nI can reference all of them now. ${audioFiles.length > 1 ? 'Want to build the EDL, or talk through what was recorded?' : 'Want to talk through it?'}`,
        sessionIds,
        timestamp:  new Date().toISOString(),
      }])

    } catch (err) {
      setIndexProgress('')
      setMessages(prev => [...prev, {
        role:      'assistant',
        content:   `Audio upload error: ${err.message}`,
        isError:   true,
        timestamp: new Date().toISOString(),
      }])
    }

    setIndexingAudio(false)
  }
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
      setMessages(history)

      // If backend explicitly says greet:false (session still active, < 5 mins)
      // trust it — do not append any greeting, just show the history as-is
      if (greetData?.greet === false) return

      let greetMsg = greetData?.message || null

      // Only generate a fallback greeting if backend didn't return one AND
      // this is a genuinely new chat with no history
      if (!greetMsg && !history.length) {
        const openers = [
          "What are we making?",
          "Your workspace is set up. What's the first episode about?",
          "Let's build something. What's on your mind?",
          "Ready when you are. What's the episode?",
          "Start with the thumbnail — what's the image that stops the scroll?",
        ]
        greetMsg = openers[Math.floor(Math.random() * openers.length)]
      }

      // If there's history but no backend greeting (backend returned null message
      // with greet:true meaning it wanted to greet but had nothing specific) —
      // show a minimal re-entry prompt only if > 30 mins away
      if (!greetMsg && history.length) {
        const last = history[history.length - 1]
        const minsAgo = last?.timestamp
          ? Math.round((Date.now() - new Date(last.timestamp).getTime()) / 60000)
          : 0
        if (minsAgo >= 30) {
          const lastUserMsg = [...history].reverse().find(m => m.role === 'user')
          const snippet = lastUserMsg?.content?.slice(0, 60) || ''
          greetMsg = snippet
            ? `Welcome back — you were working on "${snippet}". Want to pick that up?`
            : null
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
    setStreamText('')

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      await chatApi.send(
        { categoryId: activeCategoryId, mode, message: text, messages: [], activeEpisodeId: activeEpisodeId || null },
        {
          chunk: ({ text: t }) => setStreamText(prev => prev + t),
          done:  ({ response, action }) => {
            setMessages(prev => [...prev, { role: 'assistant', content: response, timestamp: new Date().toISOString() }])
            setStreamText('')
            setStreaming(false)
            if (voiceUsedRef.current) {
              voiceUsedRef.current = false
              speak(response).catch(() => {})
            }
            if (action === 'show_history')    setTimeout(() => setView('history'), 400)
            if (action === 'generate_episode') setTimeout(() => generateEpisodeFromChat(), 400)
            if (action?.startsWith?.('edl:'))   handleEdlAction(action, response)
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
        // KB wants to show which sessions are available to sync
        const res  = await fetch(`${BASE}/editor/sessions?categoryId=${activeCategoryId}`, { headers: auth })
        const data = await res.json()
        const sessions = data.sessions || []
        if (!sessions.length) {
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: 'No indexed sessions found. Upload your screen capture audio and camera audio first using the Upload button, then come back and ask me to build the EDL.',
            timestamp: new Date().toISOString(),
          }])
          return
        }
        setMessages(prev => [...prev, {
          role:        'assistant',
          content:     `I can see ${sessions.length} indexed session${sessions.length > 1 ? 's' : ''}:\n${sessions.map((s, i) => `${i+1}. "${s.title}" — ${Math.round((s.duration_ms || 0) / 60000)}min`).join('\n')}\n\nTell me which is the screen capture and which is the camera footage, and what to call the original video files (e.g. "screen is SESSION_CAM.mp4, camera is WRITING_A_SONG_CAM.mp4").`,
          isSessionList: true,
          sessions,
          timestamp:   new Date().toISOString(),
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

        const buildRes = await fetch(`${BASE}/editor/build-session-edl`, {
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
        if (!buildRes.ok) { const e = await buildRes.json(); throw new Error(e.error) }

        let summary = {}
        try { summary = JSON.parse(buildRes.headers.get('X-EDL-Summary') || '{}') } catch {}
        const blob     = await buildRes.blob()
        const url      = URL.createObjectURL(blob)
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

      if (parts[1] === 'build') {
        const [,, sessionIdA, sessionIdB, offsetMs, clipNameA, clipNameB, targetMins] = parts
        setEdlState('building')
        setMessages(prev => [...prev, {
          role:      'assistant',
          content:   'Building EDL — analysing both transcripts and cutting for retention…',
          isWorking: true,
          timestamp: new Date().toISOString(),
        }])

        const res = await fetch(`${BASE}/editor/build-session-edl`, {
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

        if (!res.ok) {
          const errData = await res.json()
          throw new Error(errData.error)
        }

        // Parse summary from header
        let summary = {}
        try { summary = JSON.parse(res.headers.get('X-EDL-Summary') || '{}') } catch {}

        // Get the EDL content as blob for download
        const blob    = await res.blob()
        const url     = URL.createObjectURL(blob)
        const exportId = `edl-${Date.now()}`

        // Store blob URL temporarily for download
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
                {!msg.isEdlReady && !msg.isWorking && (
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
                {msg.role === 'assistant' && !msg.isError && !msg.isGenerating && !msg.isEpisodeReady && !msg.isEdlReady && !msg.isWorking && (
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
            <input type="file" multiple accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg,.flac,image/*,.jpg,.jpeg,.png,.gif,.webp,.heic,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.fountain,.fdx" onChange={handleFileUpload} disabled={indexingAudio} style={{ display:'none' }}/>
          </label>

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