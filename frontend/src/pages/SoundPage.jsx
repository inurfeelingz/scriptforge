// frontend/src/pages/SoundPage.jsx
// Sound Library — upload your brand sounds once, use them every episode.
// Claude reads your library and places specific files at specific timecodes.

import { useState, useEffect, useRef } from 'react'
import {
  Upload, Play, Pause, Trash2, Music, Zap, Wind,
  Volume2, Star, Download, Loader2, ChevronDown, ChevronUp, X, Lock, Unlock, Headphones
} from 'lucide-react'
import { useStore } from '../store'
import { sound } from '../lib/api'

const ASSET_TYPES = [
  { value: 'music_bed',    label: 'Music bed',    icon: Music,        desc: 'Background track (30s-3min)' },
  { value: 'sting',        label: 'Sting',        icon: Zap,          desc: 'Punctuation hit (0.5s-5s)' },
  { value: 'transition',   label: 'Transition',   icon: ChevronDown,  desc: 'Scene change (1s-8s)' },
  { value: 'atmosphere',   label: 'Atmosphere',   icon: Wind,         desc: 'Ambient texture, loopable' },
  { value: 'sfx',          label: 'SFX',          icon: Volume2,      desc: 'Spot sound effect' },
  { value: 'intro_jingle', label: 'Intro jingle', icon: Star,         desc: 'Branded intro' },
  { value: 'outro_jingle', label: 'Outro jingle', icon: Star,         desc: 'Branded outro' },
]

const MOOD_SUGGESTIONS = [
  'lo-fi','melancholic','focused','late-night','energetic',
  'minimal','cinematic','warm','nostalgic','tense','uplifting',
]

// Draws a static waveform thumbnail by decoding audio via Web Audio API
// Only loads when a signed URL is available — shows a subtle bar chart of amplitude
function AudioWaveform({ url }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    if (!url || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    const W = canvas.width, H = canvas.height

    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => new AudioContext().decodeAudioData(buf))
      .then(audioBuf => {
        const data    = audioBuf.getChannelData(0)
        const samples = W * 2  // two samples per pixel for resolution
        const step    = Math.floor(data.length / samples)
        const bars    = []
        for (let i = 0; i < samples; i++) {
          let max = 0
          for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(data[i * step + j] || 0))
          bars.push(max)
        }
        // Normalise
        const peak = Math.max(...bars, 0.001)
        ctx.clearRect(0, 0, W, H)
        bars.forEach((v, i) => {
          const x  = (i / samples) * W
          const bh = (v / peak) * (H * 0.85)
          ctx.fillStyle = 'rgba(200,184,154,0.35)'
          ctx.fillRect(x, H/2 - bh/2, 0.5, bh)
        })
      })
      .catch(() => {})  // silent fail — waveform is decorative
  }, [url])

  return <canvas ref={canvasRef} width={200} height={28} style={{display:'block',width:'200px',height:'28px'}}/>
}

export default function SoundPage() {
  const { activeCategoryId, notify } = useStore()
  const [assets,     setAssets]     = useState([])
  const [grouped,    setGrouped]    = useState({})
  const [loading,    setLoading]    = useState(true)
  const [uploading,  setUploading]  = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [playingId,  setPlayingId]  = useState(null)
  const [waveformUrls, setWaveformUrls] = useState({})
  const [expanded,   setExpanded]   = useState('music_bed')
  const [designing,  setDesigning]  = useState(false)
  const [placements, setPlacements] = useState([])
  const [selectedEp, setSelectedEp] = useState('')
  const [episodes,   setEpisodes]   = useState([])
  const [form, setForm] = useState({ name:'', assetType:'music_bed', moodTags:[], bpm:'', energyLevel:0.5, _file:null })
  const audioRef = useRef(null)

  useEffect(() => {
    if (!activeCategoryId) return
    loadAssets()
    loadEpisodes()
  }, [activeCategoryId])

  async function loadAssets() {
    setLoading(true)
    try {
      const { assets: a, grouped: g } = await sound.listAssets({ categoryId: activeCategoryId })
      setAssets(a); setGrouped(g)
    } catch (err) { notify('Failed to load sounds: ' + err.message, 'error') }
    setLoading(false)
  }

  async function loadEpisodes() {
    try {
      const { api } = await import('../lib/api')
      const data = await api.get('/episodes?limit=20&categoryId=' + activeCategoryId)
      setEpisodes(data.episodes || [])
    } catch {}
  }

  async function submitUpload() {
    if (!form._file) return notify('Select a file first', 'error')
    setUploading(true)
    const fd = new FormData()
    fd.append('file',        form._file)
    fd.append('categoryId',  activeCategoryId)
    fd.append('name',        form.name || form._file.name)
    fd.append('assetType',   form.assetType)
    fd.append('moodTags',    form.moodTags.join(','))
    fd.append('energyLevel', form.energyLevel)
    if (form.bpm) fd.append('bpm', form.bpm)
    try {
      await sound.uploadAsset(fd)
      notify('Sound uploaded', 'success')
      setShowUpload(false)
      setForm({ name:'', assetType:'music_bed', moodTags:[], bpm:'', energyLevel:0.5, _file:null })
      loadAssets()
    } catch (err) { notify('Upload failed: ' + err.message, 'error') }
    setUploading(false)
  }

  async function togglePlay(asset) {
    if (playingId === asset.id) {
      audioRef.current?.pause(); setPlayingId(null); return
    }
    try {
      const { url } = await sound.getAssetUrl(asset.id)
      if (audioRef.current) audioRef.current.pause()
      audioRef.current = new Audio(url)
      audioRef.current.onended = () => setPlayingId(null)
      audioRef.current.play()
      setPlayingId(asset.id)
      // Cache URL for waveform rendering
      setWaveformUrls(prev => ({ ...prev, [asset.id]: url }))
    } catch (err) { notify('Playback error: ' + err.message, 'error') }
  }

  async function deleteAsset(id, name) {
    try {
      await sound.deleteAsset(id)
      notify('Deleted', 'info')
      loadAssets()
    } catch (err) {
      // 409 means the asset has placements — ask to force-delete
      if (err.message?.includes('placed in')) {
        const ok = window.confirm(
          `${err.message}\n\nDelete anyway? This will remove those placements.`
        )
        if (ok) {
          await sound.deleteAsset(id, true)  // force=true
          notify('Deleted (placements cleared)', 'info')
          loadAssets()
        }
      } else {
        notify('Delete failed: ' + err.message, 'error')
      }
    }
  }

  const [auditioning, setAuditioning] = useState(false)
  const auditRef = useRef(null)

  async function runSoundDesign() {
    if (!selectedEp) return notify('Select an episode first', 'error')
    if (!assets.length) return notify('Upload sounds first', 'error')
    setDesigning(true)
    try {
      const { placements: p } = await sound.designEpisode(selectedEp, { categoryId: activeCategoryId })
      setPlacements(p)
      notify(`${p.length} placements generated — press Audition to preview`, 'success')
    } catch (err) { notify('Design failed: ' + err.message, 'error') }
    setDesigning(false)
  }

  // Audition: play each asset in order with short gaps to hear the overall feel
  async function auditPlacement() {
    if (auditioning) {
      if (auditRef.current) { auditRef.current.pause(); auditRef.current = null }
      setAuditioning(false)
      return
    }
    const musicPlacements = placements.filter(p => p.track === 'A2' || p.track === 'A3')
    if (!musicPlacements.length) return notify('No audio placements to audition', 'info')
    setAuditioning(true)
    for (const p of musicPlacements) {
      if (!auditioning && auditRef.current === null) break  // stopped
      try {
        const { url } = await sound.getAssetUrl(p.assetId)
        await new Promise((resolve, reject) => {
          const audio = new Audio(url)
          auditRef.current = audio
          audio.volume = Math.pow(10, (p.volumeDb || 0) / 20)  // dB to linear
          audio.play()
          // Play first 8 seconds of each asset
          setTimeout(() => { audio.pause(); resolve() }, 8000)
          audio.onended = resolve
          audio.onerror = resolve
        })
        await new Promise(r => setTimeout(r, 500))  // gap between assets
      } catch { break }
    }
    auditRef.current = null
    setAuditioning(false)
  }

  const msToTime = ms => {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`
  }

  return (
    <div className="space-y-6 max-w-3xl">

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-serif text-[#f0ede8]">Sound library</h1>
          <p className="text-xs text-[#444] mt-1">Upload once — KP places your sounds in every episode</p>
        </div>
        <label className="flex items-center gap-2 px-4 py-2 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium cursor-pointer hover:bg-[#e8c87a] transition-all">
          <Upload size={14}/>Add sound
          <input type="file" accept="audio/*" className="hidden" onChange={e => {
            const file = e.target.files?.[0]
            if (!file) return
            setForm(f => ({ ...f, name: file.name.replace(/\.[^.]+$/, ''), _file: file }))
            setShowUpload(true)
            e.target.value = ''
          }}/>
        </label>
      </div>

      {showUpload && (
        <div className="border border-[#c8b89a]/20 bg-[#0a0a0a] rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#c8b89a]">
              {form._file ? form._file.name : 'New sound'}
            </span>
            <button onClick={() => setShowUpload(false)}><X size={14} className="text-[#444]"/></button>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-[#666] uppercase tracking-wide">Name</label>
            <input className="w-full bg-[#111] border border-[#1a1a1a] rounded px-3 py-2 text-sm text-[#ccc]"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Main theme, Transition whoosh..."/>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-[#666] uppercase tracking-wide">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {ASSET_TYPES.map(t => (
                <button key={t.value}
                  onClick={() => setForm(f => ({ ...f, assetType: t.value }))}
                  className={"flex items-center gap-2 px-3 py-2 rounded border text-xs text-left transition-all " + (
                    form.assetType === t.value
                      ? "border-[#c8b89a]/40 bg-[#c8b89a]/5 text-[#c8b89a]"
                      : "border-[#1a1a1a] text-[#555] hover:border-[#333]"
                  )}>
                  <t.icon size={11}/>
                  <div><div>{t.label}</div><div className="text-[10px] opacity-60">{t.desc}</div></div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-[#666] uppercase tracking-wide">Mood tags</label>
            <div className="flex flex-wrap gap-1.5">
              {MOOD_SUGGESTIONS.map(m => (
                <button key={m}
                  onClick={() => setForm(f => ({
                    ...f, moodTags: f.moodTags.includes(m) ? f.moodTags.filter(t => t !== m) : [...f.moodTags, m]
                  }))}
                  className={"px-2.5 py-1 rounded-full text-xs border transition-all " + (
                    form.moodTags.includes(m)
                      ? "border-[#c8b89a]/40 text-[#c8b89a] bg-[#c8b89a]/5"
                      : "border-[#1a1a1a] text-[#444] hover:border-[#333]"
                  )}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-[#666] uppercase tracking-wide">
                Energy {Math.round(form.energyLevel * 100)}%
              </label>
              <input type="range" min="0" max="1" step="0.05" value={form.energyLevel}
                onChange={e => setForm(f => ({ ...f, energyLevel: parseFloat(e.target.value) }))}
                className="w-full"/>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[#666] uppercase tracking-wide">BPM</label>
              <input type="number" className="w-full bg-[#111] border border-[#1a1a1a] rounded px-3 py-2 text-sm text-[#ccc]"
                value={form.bpm} onChange={e => setForm(f => ({ ...f, bpm: e.target.value }))} placeholder="e.g. 90"/>
            </div>
          </div>

          <button onClick={submitUpload} disabled={uploading}
            className="w-full py-2.5 bg-[#c8b89a] text-[#080808] rounded text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40">
            {uploading ? <><Loader2 size={13} className="animate-spin"/> Uploading...</> : <><Upload size={13}/> Upload</>}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_,i) => (
          <div key={i} className="h-12 bg-[#0d0d0d] border border-[#111] rounded animate-pulse"/>
        ))}</div>
      ) : assets.length === 0 ? (
        <div className="border border-dashed border-[#1a1a1a] rounded-lg p-12 text-center space-y-3">
          <Music size={28} className="mx-auto text-[#2a2a2a]"/>
          <div className="text-sm text-[#444]">No sounds yet</div>
          <div className="text-xs text-[#333] max-w-xs mx-auto leading-relaxed">
            Upload your music beds, stings, transitions, and atmospheres. KP will select specific files and place them at timecodes in every episode.
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {ASSET_TYPES.map(type => {
            const typeAssets = grouped[type.value] || []
            if (!typeAssets.length) return null
            const isExp = expanded === type.value
            return (
              <div key={type.value} className="border border-[#1a1a1a] rounded-lg overflow-hidden">
                <button onClick={() => setExpanded(isExp ? null : type.value)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#0d0d0d] transition-colors">
                  <type.icon size={13} className="text-[#555] shrink-0"/>
                  <span className="text-sm text-[#aaa] flex-1 text-left">{type.label}</span>
                  <span className="text-xs text-[#444]">{typeAssets.length}</span>
                  {isExp ? <ChevronUp size={12} className="text-[#444]"/> : <ChevronDown size={12} className="text-[#444]"/>}
                </button>
                {isExp && (
                  <div className="border-t border-[#111] divide-y divide-[#0d0d0d]">
                    {typeAssets.map(asset => (
                      <div key={asset.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[#050505] group">
                        <button onClick={() => togglePlay(asset)}
                          className="w-7 h-7 rounded-full border border-[#222] flex items-center justify-center text-[#555] hover:text-[#c8b89a] hover:border-[#c8b89a]/30 transition-all shrink-0">
                          {playingId === asset.id ? <Pause size={10}/> : <Play size={10}/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-[#ccc] truncate">{asset.name}</div>
                          {waveformUrls[asset.id] && (
                            <div style={{marginTop:'4px',opacity:0.7}}><AudioWaveform url={waveformUrls[asset.id]}/></div>
                          )}
                          <div className="flex gap-2 mt-0.5 flex-wrap">
                            {asset.mood_tags?.slice(0,4).map(tag => (
                              <span key={tag} className="text-[10px] text-[#555] px-1.5 py-0.5 bg-[#111] rounded">{tag}</span>
                            ))}
                            {asset.bpm && <span className="text-[10px] text-[#444]">{asset.bpm}bpm</span>}
                          </div>
                        </div>
                        {asset.use_count > 0 && <span className="text-xs text-[#333]">x{asset.use_count}</span>}
                        <button onClick={() => deleteAsset(asset.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-[#444] hover:text-red-400 transition-all">
                          <Trash2 size={11}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {assets.length > 0 && (
        <div className="border border-[#1a1a1a] rounded-lg p-5 space-y-4">
          <div>
            <div className="text-sm text-[#888]">Design episode sound</div>
            <div className="text-xs text-[#444] mt-1">KP selects from your library and places files at exact timecodes. Export as audio EDL for DaVinci.</div>
          </div>
          <div className="flex gap-3">
            <select className="flex-1 bg-[#111] border border-[#1a1a1a] rounded px-3 py-2 text-sm text-[#ccc]"
              value={selectedEp} onChange={e => setSelectedEp(e.target.value)}>
              <option value="">Select episode...</option>
              {episodes.map(ep => (
                <option key={ep.id} value={ep.id}>Ep {ep.episode_number} — {ep.track_name}</option>
              ))}
            </select>
            <button onClick={runSoundDesign} disabled={designing || !selectedEp}
              className="flex items-center gap-2 px-5 py-2 bg-[#c8b89a]/10 border border-[#c8b89a]/20 text-[#c8b89a] rounded text-sm hover:bg-[#c8b89a]/20 disabled:opacity-40 transition-all">
              {designing ? <Loader2 size={13} className="animate-spin"/> : <Music size={13}/>}
              {designing ? 'Designing...' : 'Design sound'}
            </button>
          </div>

          {placements.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#555] uppercase tracking-wide">{placements.length} placements</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={auditPlacement}
                    className={"flex items-center gap-1.5 text-xs transition-all " + (auditioning ? "text-[#c8b89a] animate-pulse" : "text-[#555] hover:text-[#c8b89a]")}
                    title="Preview each sound placement for 8 seconds"
                  >
                    <Headphones size={11}/> {auditioning ? 'Stop' : 'Audition'}
                  </button>
                  <a href={sound.exportEDL(selectedEp)} download="episode-sound.edl"
                    className="flex items-center gap-1.5 text-xs text-[#c8b89a] hover:underline">
                    <Download size={11}/> Export EDL
                  </a>
                </div>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {placements.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 bg-[#0a0a0a] rounded border border-[#111]">
                    <span className="text-xs text-[#c8b89a] font-mono shrink-0 w-10">{msToTime(p.recInMs)}</span>
                    <span className="text-[10px] text-[#444] px-1.5 py-0.5 bg-[#111] rounded shrink-0">{p.track}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#888] truncate">{p.assetName}</div>
                      {p.note && <div className="text-[10px] text-[#444] mt-0.5">{p.note}</div>}
                    </div>
                    {p.volumeDb !== 0 && <span className="text-[10px] text-[#444] shrink-0">{p.volumeDb}dB</span>}
                    <button
                      onClick={async () => {
                        await sound.lockPlacement(selectedEp, p.id, !p.isLocked)
                        setPlacements(prev => prev.map((pl, j) => j === i ? { ...pl, isLocked: !pl.isLocked } : pl))
                      }}
                      className={"p-1 rounded transition-all " + (p.isLocked ? "text-[#c8b89a]" : "text-[#333] hover:text-[#888]")}
                      title={p.isLocked ? "Locked — won't be replaced on re-design" : "Click to lock this placement"}
                    >
                      {p.isLocked ? <Lock size={10}/> : <Unlock size={10}/>}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}