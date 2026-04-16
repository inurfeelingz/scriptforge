// frontend/src/pages/Teleprompter.jsx
// Full-screen teleprompter — loads VO script from active episode or paste
import { useState, useRef, useEffect, useCallback } from 'react'
import { Play, Pause, RotateCcw, Maximize, Minimize, X } from 'lucide-react'

export default function Teleprompter() {
  const [script, setScript]     = useState('')
  const [started, setStarted]   = useState(false)
  const [playing, setPlaying]   = useState(false)
  const [speed, setSpeed]       = useState(4)
  const [fontSize, setFontSize] = useState(42)
  const [position, setPosition] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [mirrored, setMirrored] = useState(false)
  const textRef  = useRef(null)
  const frameRef = useRef(null)
  const lastTime = useRef(null)
  const posRef   = useRef(0)

  const pxPerSec = useCallback(() => 8 * Math.pow(speed, 1.45), [speed])

  useEffect(() => {
    if (!playing) { lastTime.current = null; return }
    const tick = (ts) => {
      if (lastTime.current) {
        const delta = (ts - lastTime.current) / 1000
        posRef.current = Math.min(posRef.current + pxPerSec() * delta, (textRef.current?.scrollHeight || 0))
        setPosition(posRef.current)
      }
      lastTime.current = ts
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [playing, pxPerSec])

  useEffect(() => {
    const onKey = (e) => {
      if (!started) return
      if (e.code === 'Space') { e.preventDefault(); setPlaying(p => !p) }
      if (e.code === 'ArrowUp')   setSpeed(s => Math.min(10, s + 0.5))
      if (e.code === 'ArrowDown') setSpeed(s => Math.max(1,  s - 0.5))
      if (e.code === 'KeyR')      { posRef.current = 0; setPosition(0); setPlaying(false) }
      if (e.code === 'Escape' && fullscreen) setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [started, fullscreen])

  if (!started) return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif text-[#f0ede8]">Teleprompter</h1>
        <p className="text-sm text-[#555] mt-1">Paste your VO script or load from an episode</p>
      </div>
      <textarea
        value={script} onChange={e => setScript(e.target.value)}
        placeholder="Paste your voiceover script here...&#10;&#10;[CAM-001 ~0:00] Lines with clip hints will be dimmed automatically."
        rows={12}
        className="w-full bg-[#0d0d0d] border border-[#1e1e1e] rounded px-4 py-3 text-sm text-[#f0ede8] placeholder-[#333] outline-none focus:border-[#c8b89a]/40 resize-none font-mono"
      />
      <div className="flex items-center gap-4">
        <div className="space-y-1 flex-1">
          <label className="text-xs text-[#666]">Font size: {fontSize}px</label>
          <input type="range" min={20} max={72} value={fontSize} onChange={e => setFontSize(+e.target.value)} className="w-full accent-[#c8b89a]"/>
        </div>
      </div>
      <button
        onClick={() => setStarted(true)} disabled={!script.trim()}
        className="w-full py-3 bg-[#c8b89a] text-[#080808] font-medium rounded hover:bg-[#e8c87a] disabled:opacity-40 transition-all"
      >
        Start session
      </button>
    </div>
  )

  // Parse lines
  const lines = script.split('\n').map((line, i) => ({
    text: line.trim(),
    isHint: /^\[(?:CAM|DAW|BROLL)/i.test(line.trim()),
    key: i,
  }))

  const totalH = (textRef.current?.scrollHeight || 0)
  const pct = totalH ? Math.min(100, (position / totalH) * 100) : 0

  const Wrap = fullscreen ? 'div' : 'div'

  return (
    <div className={`${fullscreen ? 'fixed inset-0 z-50' : 'rounded overflow-hidden'} bg-[#080808] flex flex-col`}
      style={{ minHeight: fullscreen ? undefined : 600 }}>

      {/* Progress */}
      <div className="h-0.5 bg-[#111] shrink-0">
        <div className="h-full bg-[#c8b89a] transition-all" style={{ width: `${pct}%` }}/>
      </div>

      {/* Script area */}
      <div className="flex-1 overflow-hidden relative">
        {/* Masks */}
        <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-[#080808] to-transparent z-10 pointer-events-none"/>
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#080808] to-transparent z-10 pointer-events-none"/>
        {/* Focus line */}
        <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: '50%', height: 1, background: 'rgba(200,184,154,0.12)' }}/>

        <div ref={textRef} className={`px-[10vw] ${mirrored ? 'scale-x-[-1]' : ''}`}
          style={{ paddingTop: '50vh', paddingBottom: '50vh', transform: `translateY(-${position}px)` }}>
          {lines.map(l => (
            <span key={l.key} className={`block leading-relaxed mb-1 ${
              l.isHint ? 'text-[#333] font-mono' : 'text-[#f0ede8]'
            }`} style={{ fontSize: l.isHint ? fontSize * 0.38 : fontSize }}>
              {l.text || '\u00A0'}
            </span>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 px-6 py-4 border-t border-[#111] shrink-0">
        <button onClick={() => { posRef.current=0; setPosition(0); setPlaying(false) }} className="text-[#444] hover:text-[#888] transition-colors">
          <RotateCcw size={16}/>
        </button>
        <button onClick={() => setPlaying(p=>!p)} className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all ${
          playing ? 'border-[#c8b89a] text-[#c8b89a] bg-[#c8b89a]/10' : 'border-[#333] text-[#666] hover:border-[#666]'
        }`}>
          {playing ? <Pause size={14}/> : <Play size={14}/>}
        </button>

        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-[#444]">Speed</span>
          <input type="range" min={1} max={10} step={0.1} value={speed}
            onChange={e => setSpeed(+e.target.value)} className="flex-1 accent-[#c8b89a]"/>
          <span className="text-xs text-[#c8b89a] w-6">{speed.toFixed(1)}</span>
        </div>

        <span className="text-xs text-[#444]">{Math.round(pct)}%</span>

        <button onClick={() => setMirrored(m=>!m)} className={`text-xs px-2 py-1 rounded border transition-all ${mirrored ? 'border-[#c8b89a]/40 text-[#c8b89a]' : 'border-[#222] text-[#444]'}`}>⇔</button>
        <button onClick={() => setFullscreen(f=>!f)} className="text-[#444] hover:text-[#888] transition-colors">
          {fullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}
        </button>
        <button onClick={() => { setStarted(false); setPlaying(false); posRef.current=0; setPosition(0) }} className="text-[#444] hover:text-red-400 transition-colors">
          <X size={16}/>
        </button>
      </div>
    </div>
  )
}
