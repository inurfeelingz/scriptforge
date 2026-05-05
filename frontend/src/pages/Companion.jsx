// frontend/src/pages/Companion.jsx
// WhispaCuts Companion — mobile-first PWA session capture.
// Two tabs: Record and Brainstorm — no sliding, clean show/hide with fade.

import { useState, useRef, useEffect, useReducer } from 'react'
import {
  Mic, MicOff, Square, Flag, Send, Wifi, WifiOff,
  Trash2, Check, Loader2, Volume2, Radio, Sparkles,
} from 'lucide-react'
import { useStore } from '../store'
import { api, chat as chatApi } from '../lib/api'
import { getSession } from '../lib/supabase'
import { detectMic, buildConstraints, getRecordingBitrate, needsStereoSum, describeMic } from '../lib/micDetect'
import MascotOrb from '../components/companion/MascotOrb'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const CHUNK_MS      = 12000
const WAVEFORM_BARS = 48
const LONG_PRESS_MS = 600

const KB_GREEN       = 'rgba(74,222,128,1)'
const KB_GREEN_DIM   = 'rgba(74,222,128,0.7)'
const KB_GREEN_FAINT = 'rgba(74,222,128,0.08)'

// ─── REDUCER ─────────────────────────────────────────────────────────────────
const init = {
  screen: 'record',   // 'record' | 'brainstorm'
  sessionId: null, recording: false, elapsedMs: 0,
  entries: [], processed: null, processing: false,
  online: true, micLabel: '', orbMood: 'idle',
  isDJI: false, isExternal: false, micInfo: '',
  audioLevel: 0, waveform: new Array(WAVEFORM_BARS).fill(0),
  markLabel: '', showMarkInput: false, justMarked: false,
  status: 'idle', error: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET':          return { ...state, ...action.payload }
    case 'ADD_ENTRY':    return { ...state, entries: [...state.entries, action.entry] }
    case 'REMOVE_ENTRY': return { ...state, entries: state.entries.filter(e => e.id !== action.id) }
    case 'SET_WAVEFORM': return { ...state, waveform: action.data, audioLevel: action.level }
    case 'RESET':        return { ...state, sessionId: null, recording: false, elapsedMs: 0, entries: [], processed: null, status: 'idle', error: null, justMarked: false }
    default:             return state
  }
}

const fmt = ms => { const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60); return h>0?`${h}:${pad(m%60)}:${pad(s%60)}`:`${m}:${pad(s%60)}` }
const pad = n => String(n).padStart(2,'0')

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Companion() {
  const { activeCategoryId, activeCategory } = useStore()
  const cat = activeCategory?.()
  const [state, dispatch] = useReducer(reducer, init)
  const set = p => dispatch({ type: 'SET', payload: p })

  // Refs
  const mediaRecRef   = useRef(null)
  const chunksRef     = useRef([])
  const startRef      = useRef(null)
  const timerRef      = useRef(null)
  const chunkRef      = useRef(null)
  const analyserRef   = useRef(null)
  const audioCtxRef   = useRef(null)
  const rafRef        = useRef(null)
  const sidRef        = useRef(null)
  const lpRef         = useRef(null)
  const mimeRef       = useRef('audio/webm')
  const bufRef        = useRef([])
  const wakeLockRef   = useRef(null)
  const offlineQ      = useRef([])
  const markStartRef  = useRef({ y: 0 })

  const [sessionTitle,    setSessionTitle]    = useState('')
  const [editingTitle,    setEditingTitle]    = useState(false)
  const [uploadPct,       setUploadPct]       = useState(0)
  const [processPct,      setProcessPct]      = useState(0)

  useEffect(() => { sidRef.current = state.sessionId }, [state.sessionId])

  // Online
  useEffect(() => {
    const on  = () => { set({ online: true }); flushQ() }
    const off = () => set({ online: false })
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    set({ online: navigator.onLine })
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Wake lock on visibility
  useEffect(() => {
    const h = async () => {
      if (document.visibilityState === 'visible' && state.recording && !wakeLockRef.current)
        try { wakeLockRef.current = await navigator.wakeLock?.request('screen') } catch {}
    }
    document.addEventListener('visibilitychange', h)
    return () => document.removeEventListener('visibilitychange', h)
  }, [state.recording])

  // Portrait lock
  useEffect(() => {
    screen.orientation?.lock?.('portrait-primary').catch(() => {})
    return () => screen.orientation?.unlock?.()
  }, [])

  // ── WAVEFORM ────────────────────────────────────────────────────────────────
  function startWaveform(stream) {
    if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {}; audioCtxRef.current = null }
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const src = ctx.createMediaStreamSource(stream)
    const an  = ctx.createAnalyser()
    an.fftSize = 128; an.smoothingTimeConstant = 0.7
    const stereo = stream.getAudioTracks()[0]?.getSettings?.()?.channelCount === 2
    if (stereo) {
      const sp=ctx.createChannelSplitter(2),gl=ctx.createGain(),gr=ctx.createGain(),mg=ctx.createChannelMerger(1)
      gl.gain.value=gr.gain.value=0.5
      src.connect(sp); sp.connect(gl,0); sp.connect(gr,1); gl.connect(mg,0,0); gr.connect(mg,0,0); mg.connect(an)
    } else { src.connect(an) }
    analyserRef.current = an
    const d = new Uint8Array(an.frequencyBinCount)
    const draw = () => {
      an.getByteFrequencyData(d)
      const bars=[]; const step=Math.floor(d.length/WAVEFORM_BARS); let tot=0
      for (let i=0;i<WAVEFORM_BARS;i++){const v=d[i*step]/255;bars.push(v);tot+=v}
      dispatch({ type:'SET_WAVEFORM', data:bars, level:tot/WAVEFORM_BARS })
      rafRef.current = requestAnimationFrame(draw)
    }
    draw()
  }

  function stopWaveform() {
    cancelAnimationFrame(rafRef.current); analyserRef.current=null
    if (audioCtxRef.current){audioCtxRef.current.close().catch(()=>{}); audioCtxRef.current=null}
    dispatch({ type:'SET_WAVEFORM', data:new Array(WAVEFORM_BARS).fill(0), level:0 })
  }

  // ── MIC ─────────────────────────────────────────────────────────────────────
  async function getBestStream() {
    let p
    try { p = await navigator.mediaDevices.getUserMedia({ audio:true, video:false }) }
    catch(e) {
      if (e.name==='NotAllowedError'||e.name==='PermissionDeniedError') throw new Error('Microphone access denied')
      if (e.name==='NotFoundError') throw new Error('No microphone found')
      throw e
    }
    p.getTracks().forEach(t=>t.stop())
    const devs=await navigator.mediaDevices.enumerateDevices()
    const det=detectMic(devs)
    let stream
    try { stream=await navigator.mediaDevices.getUserMedia(buildConstraints(det)) }
    catch { stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}) }
    const t=stream.getAudioTracks()[0]; const s=t?.getSettings?.()||{}
    return { stream, label:det.displayLabel||t?.label||'Microphone', isDJI:/dji/i.test(det.match?.brand||''), isExternal:det.isExternal, bitrate:getRecordingBitrate(det), micInfo:describeMic(det) }
  }

  // ── SESSION ──────────────────────────────────────────────────────────────────
  async function startSession() {
    set({ status:'starting', error:null })
    try {
      const { stream, label, isDJI, isExternal, bitrate, micInfo } = await getBestStream()
      set({ micLabel:label, isDJI, isExternal, micInfo })
      if (isDJI) navigator.vibrate?.([30,20,30,20,80])
      else if (isExternal) navigator.vibrate?.([30,20,60])
      else navigator.vibrate?.([30])

      const { session } = await api.post('/session', {
        categoryId: activeCategoryId,
        title: `Session ${new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} — ${cat?.name||'untitled'}`,
      })
      sidRef.current=session.id; startRef.current=Date.now()
      chunksRef.current=[]; bufRef.current=[]

      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4;codecs=aac','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t))||'audio/mp4'
      mimeRef.current=mime
      const rec=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:bitrate||(isExternal?192000:128000)})
      mediaRecRef.current=rec
      rec.ondataavailable=e=>{if(e.data.size>0)chunksRef.current.push(e.data)}
      rec.start(500)

      timerRef.current=setInterval(()=>set({elapsedMs:Date.now()-startRef.current}),1000)
      chunkRef.current=setInterval(()=>transcribeChunk(sidRef.current),CHUNK_MS)
      startWaveform(stream)
      if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(l=>{wakeLockRef.current=l}).catch(()=>{})

      setSessionTitle(session.title||'')
      set({ sessionId:session.id, recording:true, status:'recording', orbMood:'listening', entries:[], elapsedMs:0, processed:null, screen:'record' })
      navigator.vibrate?.([50])
    } catch(e) {
      set({ status:'error', error:e.name==='NotAllowedError'?'Microphone blocked':e.message })
    }
  }

  async function stopSession() {
    if (!mediaRecRef.current) return
    set({ status:'stopping' })
    clearInterval(timerRef.current); clearInterval(chunkRef.current)
    stopWaveform()
    mediaRecRef.current.stop()
    mediaRecRef.current.stream.getTracks().forEach(t=>t.stop())
    mediaRecRef.current=null
    await Promise.race([transcribeChunk(sidRef.current), new Promise(r=>setTimeout(r,8000))])
    if (wakeLockRef.current){wakeLockRef.current.release().catch(()=>{}); wakeLockRef.current=null}
    set({ recording:false, status:'ready', orbMood:'idle' })
    navigator.vibrate?.([80,40,80])
  }

  // ── TRANSCRIBE ───────────────────────────────────────────────────────────────
  async function transcribeChunk(sid) {
    const nc=chunksRef.current.splice(0)
    if (!nc.length||!sid) return
    bufRef.current.push(...nc)
    const mime=mimeRef.current||'audio/webm'
    const blob=new Blob(bufRef.current,{type:mime})
    const tsMs=Date.now()-(startRef.current||Date.now())
    const ext=mime.split(';')[0].split('/')[1]||'webm'
    if (blob.size<8000) return
    try {
      const sess=await getSession()
      const fd=new FormData()
      fd.append('audio',blob,`recording.${ext}`)
      fd.append('timestampMs',String(tsMs))
      fd.append('isCumulative','true')
      const res=await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest()
        xhr.open('POST',`${import.meta.env.VITE_API_URL||'/api'}/session/${sid}/transcribe`)
        xhr.setRequestHeader('Authorization',`Bearer ${sess?.access_token}`)
        xhr.upload.onprogress=e=>{if(e.lengthComputable)setUploadPct(Math.round(e.loaded/e.total*100))}
        xhr.onload=()=>{setUploadPct(0);resolve({ok:xhr.status<400,json:()=>Promise.resolve(JSON.parse(xhr.responseText))})}
        xhr.onerror=()=>{setUploadPct(0);reject(new Error('Upload failed'))}
        xhr.send(fd)
      })
      if (res.ok) {
        const data=await res.json()
        if (data.entries?.length) {
          const ok=data.entries.some(e=>e.type!=='marker'&&(e.text||'').split(' ').length>=5&&(e.confidence==null||e.confidence>0.55))
          if (ok){set({orbMood:'discovery'});setTimeout(()=>set({orbMood:'listening'}),1200)}
          data.entries.forEach(e=>dispatch({type:'ADD_ENTRY',entry:e}))
        }
      }
    } catch {}
  }

  // ── MARK ─────────────────────────────────────────────────────────────────────
  async function markMoment(label='') {
    const tsMs=startRef.current?Date.now()-startRef.current:0
    const text=label.trim()||'★ Marked'
    const entry={id:`mark-${Date.now()}`,timestamp_ms:tsMs,type:'marker',text,energy:1.0}
    dispatch({type:'ADD_ENTRY',entry})
    set({justMarked:true,showMarkInput:false,markLabel:'',orbMood:'marking'})
    setTimeout(()=>set({orbMood:state.recording?'listening':'idle'}),1200)
    setTimeout(()=>set({justMarked:false}),1500)
    navigator.vibrate?.([30,20,30,20,80])
    if (sidRef.current&&state.online) api.post(`/session/${sidRef.current}/entry`,{text,type:'marker',timestampMs:tsMs,energy:1.0}).catch(()=>offlineQ.current.push(entry))
    else offlineQ.current.push(entry)
  }

  const QUICK_MARKS=[{label:'✨ Found something',icon:'✨'},{label:'⚡ Energy peak',icon:'⚡'},{label:'❌ Not working',icon:'❌'},{label:'🔁 Try again',icon:'🔁'},{label:'🎯 Keep this',icon:'🎯'}]

  // ── PROCESS ──────────────────────────────────────────────────────────────────
  async function processSession() {
    if (!sidRef.current) return
    set({processing:true,orbMood:'processing',error:null})
    await new Promise(r=>setTimeout(r,2000))
    let prog=0
    const iv=setInterval(()=>{prog=prog<70?prog+2:prog<90?prog+0.5:prog+0.1;setProcessPct(Math.min(prog,95))},400)
    try {
      const r=await api.post(`/session/${sidRef.current}/process`)
      clearInterval(iv); setProcessPct(100); await new Promise(r=>setTimeout(r,400)); setProcessPct(0)
      if (!r?.voiceMemoText&&!r?.voice_memo_text) throw new Error('No memo generated')
      set({processing:false,orbMood:'idle',status:'idle',entries:[],sessionId:null,elapsedMs:0})
      navigator.vibrate?.([100,50,100,50,200])
      window.location.href='/'
    } catch(e) {
      clearInterval(iv); setProcessPct(0)
      set({processing:false,orbMood:'idle',error:e.message||'Processing failed',status:'ready'})
    }
  }

  async function flushQ() {
    if (!offlineQ.current.length||!sidRef.current) return
    const q=offlineQ.current.splice(0)
    await api.post(`/session/${sidRef.current}/entries/batch`,{entries:q}).catch(()=>offlineQ.current.unshift(...q))
  }

  // ── LONG PRESS ───────────────────────────────────────────────────────────────
  function onLPStart() {
    lpRef.current=setTimeout(()=>{if(!state.recording)startSession();else stopSession();lpRef.current=null},LONG_PRESS_MS)
  }
  function onLPEnd() { if(lpRef.current){clearTimeout(lpRef.current);lpRef.current=null} }

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div className="companion-root">

      {/* ── HEADER ── */}
      <header className="companion-header">
        <div className="companion-brand">
          <img src="/icon-mark.svg" alt="WhispaCuts" style={{width:30,height:30,flexShrink:0}}/>
          <div style={{display:'flex',flexDirection:'column',lineHeight:1.2}}>
            <span className="brand-word">WhispaCuts</span>
            {cat && <span className="brand-cat">{cat.name}</span>}
          </div>
        </div>
        <div className="header-right">
          {state.micLabel&&(
            <div className="mic-label">
              {state.isDJI?<Radio size={10} className="text-[#40a060]"/>:state.isExternal?<Volume2 size={10} style={{color:'rgba(255,255,255,0.5)'}}/>:<Mic size={10} className="text-[#555]"/>}
              <span>{state.micLabel}</span>
            </div>
          )}
          {state.online?<Wifi size={13} className="text-[#444]"/>:<WifiOff size={13} style={{color:'#d4a853'}}/>}
          {state.recording&&<div className="rec-clock"><div className="rec-dot"/><span>{fmt(state.elapsedMs)}</span></div>}
        </div>
      </header>

      {/* ── TAB BAR ── */}
      <div style={{display:'flex',justifyContent:'center',gap:8,padding:'8px 16px',borderBottom:'1px solid rgba(255,255,255,0.05)',flexShrink:0}}>
        {[{id:'record',label:'Record',icon:'⏺',activeColor:'rgba(224,48,48,1)',activeFaint:'rgba(224,48,48,0.08)',activeBorder:'rgba(224,48,48,0.4)'},{id:'brainstorm',label:'Brainstorm',icon:'✦',activeColor:KB_GREEN_DIM,activeFaint:KB_GREEN_FAINT,activeBorder:'rgba(74,222,128,0.4)'}].map(tab=>(
          <button key={tab.id} onClick={()=>set({screen:tab.id})} style={{fontFamily:"'Figtree',sans-serif",fontSize:11,fontWeight:state.screen===tab.id?600:400,padding:'5px 18px',borderRadius:20,border:`1px solid ${state.screen===tab.id?tab.activeBorder:'rgba(255,255,255,0.08)'}`,background:state.screen===tab.id?tab.activeFaint:'transparent',color:state.screen===tab.id?tab.activeColor:'rgba(255,255,255,0.3)',cursor:'pointer',transition:'all 0.2s',display:'flex',alignItems:'center',gap:5}}>
            <span style={{fontSize:9}}>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* ── SCREENS — show/hide, no sliding ── */}
      <div style={{flex:1,minHeight:0,position:'relative',overflow:'hidden'}}>

        {/* RECORD */}
        <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',padding:'16px 20px',gap:16,overflowY:'auto',opacity:state.screen==='record'?1:0,pointerEvents:state.screen==='record'?'auto':'none',transition:'opacity 0.2s ease'}}>
          {/* Red glow separator — mirrors Brainstorm green glow */}
          <div className={`record-screen-glow ${state.recording ? 'active' : ''}`}/>
          <div className={`record-screen-glow-bloom ${state.recording ? 'active' : ''}`}/>

          {state.error&&<div className="error-banner"><MicOff size={14}/><span>{state.error}</span></div>}

          {state.sessionId&&(
            <div style={{textAlign:'center'}}>
              {editingTitle?(
                <input autoFocus value={sessionTitle} onChange={e=>setSessionTitle(e.target.value)}
                  onBlur={async()=>{setEditingTitle(false);if(sessionTitle.trim()&&state.sessionId)await api.patch('/session/'+state.sessionId+'/title',{title:sessionTitle.trim()}).catch(()=>{})}}
                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{background:'transparent',border:'none',borderBottom:'1px solid rgba(255,255,255,0.15)',color:'rgba(255,255,255,0.6)',fontSize:12,textAlign:'center',outline:'none',width:200,padding:'2px 4px'}}/>
              ):(
                <button onClick={()=>setEditingTitle(true)} style={{color:'#555',fontSize:11,background:'none',border:'none',cursor:'pointer',letterSpacing:'0.5px'}}>
                  {sessionTitle||'tap to name this session'}
                </button>
              )}
            </div>
          )}

          {state.entries.length>0?(
            <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0}}>
              <div className="entry-feed" ref={el=>{if(el)el.scrollTop=el.scrollHeight}}>
                {state.entries.map(e=><EntryRow key={e.id} entry={e} onDelete={()=>dispatch({type:'REMOVE_ENTRY',id:e.id})}/>)}
              </div>
            </div>
          ):(
            <div style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center'}}>
              <MascotOrb mood={state.orbMood} audioLevel={state.audioLevel} size={300}/>
              {state.status==='idle'&&(
                <div className="idle-hint">
                  <p className="idle-title">Hold to start recording</p>
                  <InfoBubble text="Open this before your DAW. Describe what you're hearing, what's working, what you're trying — in the moment, in your own words. It becomes your episode voice memo."/>
                  {state.micLabel&&<p className="mic-hint">{state.isExternal?`🎙 ${state.micInfo||state.micLabel}`:'Built-in mic'}</p>}
                </div>
              )}
            </div>
          )}

          {uploadPct>0&&(
            <div style={{width:'100%',padding:'0 4px'}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>Transcribing...</span>
                <span style={{fontSize:11,color:'rgba(255,255,255,0.4)'}}>{uploadPct}%</span>
              </div>
              <div style={{height:3,background:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${uploadPct}%`,background:'rgba(140,170,220,0.7)',borderRadius:2,transition:'width 0.2s'}}/>
              </div>
            </div>
          )}

          <div className="record-section">

            {/* Mark label input — slides in above toolbar */}
            {state.showMarkInput && (
              <div className="mark-input-row">
                <input autoFocus className="mark-input" placeholder="What's happening right now?" value={state.markLabel}
                  onChange={e=>set({markLabel:e.target.value})}
                  onKeyDown={e=>{
                    if(e.key==='Enter')markMoment(state.markLabel)
                    if(e.key==='Escape')set({showMarkInput:false,markLabel:''})
                  }}/>
                <button className="mark-input-send" onClick={()=>markMoment(state.markLabel)}><Check size={18}/></button>
              </div>
            )}

            {/* ── HORIZONTAL TRANSPORT BAR ── */}
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'center',
              gap:8, width:'100%',
              background:'rgba(255,255,255,0.025)',
              border:'1px solid rgba(255,255,255,0.06)',
              borderRadius:20, padding:'10px 14px',
            }}>
              {/* Quick-mark emojis — left side */}
              <div style={{display:'flex',alignItems:'center',gap:0,flex:1,justifyContent:'flex-start'}}>
                {QUICK_MARKS.map(m=>(
                  <button key={m.label} onClick={()=>markMoment(m.label)} disabled={!state.recording} title={m.label}
                    style={{fontSize:22,padding:'3px 2px',border:'none',background:'none',
                      cursor:state.recording?'pointer':'default',
                      opacity:state.recording?1:0.18,
                      transition:'opacity 0.2s, transform 0.1s',
                      WebkitTapHighlightColor:'transparent',lineHeight:1}}
                    onMouseDown={e=>{if(state.recording)e.currentTarget.style.transform='scale(0.78)'}}
                    onMouseUp={e=>{e.currentTarget.style.transform='scale(1)'}}
                    onTouchStart={e=>{if(state.recording)e.currentTarget.style.transform='scale(0.78)'}}
                    onTouchEnd={e=>{e.currentTarget.style.transform='scale(1)'}}
                    onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)'}}
                  >{m.icon}</button>
                ))}
              </div>

              {/* Record button — centre, small */}
              <RecordButton
                recording={state.recording}
                status={state.status}
                audioLevel={state.audioLevel}
                onPressStart={onLPStart}
                onPressEnd={onLPEnd}
                small
              />

              {/* Flag mark button — right side, rounded square to match record btn */}
              <div style={{flex:1,display:'flex',justifyContent:'flex-end'}}>
                <button
                  onClick={()=>markMoment()}
                  onContextMenu={e=>{e.preventDefault();if(state.recording)set({showMarkInput:true})}}
                  disabled={!state.recording}
                  title="Mark moment (right-click to label)"
                  style={{
                    position:'relative',
                    width:56,height:56,borderRadius:14,flexShrink:0,
                    border:`1.5px solid ${state.justMarked?'rgba(212,168,83,0.7)':'rgba(255,255,255,0.18)'}`,
                    background:state.justMarked?'rgba(212,168,83,0.12)':'rgba(255,255,255,0.05)',
                    color:state.justMarked?'#e8c46a':'rgba(255,255,255,0.85)',
                    cursor:state.recording?'pointer':'default',
                    opacity:state.recording?1:0.18,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    transition:'all 0.15s',
                    boxShadow:state.justMarked?'0 0 14px rgba(212,168,83,0.3), inset 0 1px 0 rgba(255,255,255,0.08)':'inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.4)',
                    WebkitTapHighlightColor:'transparent',
                  }}
                >
                  {state.justMarked?<Check size={20}/>:<Flag size={20}/>}
                </button>
              </div>
            </div>

            <p className="record-hint">
              {state.status==='starting'  && 'Connecting mic...'}
              {state.status==='stopping'  && 'Saving session...'}
              {state.status==='recording' && `${state.entries.filter(e=>e.type!=='marker').length} utterances · ${state.entries.filter(e=>e.type==='marker').length} marks`}
              {state.status==='idle'      && 'Hold mic to start'}
              {state.status==='error'     && 'Tap to retry'}
            </p>
          </div>

          {state.status==='ready'&&!state.processed&&(
            <div style={{display:'flex',flexDirection:'column',gap:10,width:'100%'}}>
              <button className="process-btn" onClick={processSession} disabled={state.processing}>
                {state.processing?<><Loader2 size={16} className="animate-spin"/> Writing your memo...</>:<><Send size={16}/> Generate memo &amp; open in app</>}
              </button>
              <button onClick={()=>{window.location.href='/'}} style={{background:'none',border:'none',color:'rgba(255,255,255,0.3)',cursor:'pointer',fontSize:13,fontFamily:'inherit',padding:'8px 0'}}>
                Skip — view session in app →
              </button>
            </div>
          )}

          {state.processing&&(
            <div style={{position:'fixed',inset:0,zIndex:80,background:'rgba(8,12,16,0.92)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16,backdropFilter:'blur(8px)'}}>
              <Loader2 size={36} style={{color:'#d4a853',animation:'spin 1s linear infinite'}}/>
              <div style={{fontFamily:'Syne,sans-serif',fontWeight:700,fontSize:18,color:'#e8eaed'}}>Writing your memo...</div>
              <div style={{width:260}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                  <span style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{processPct<30?'Reading...':processPct<60?'Finding key moments...':processPct<85?'Writing...':'Almost done...'}</span>
                  <span style={{fontSize:12,color:'rgba(255,255,255,0.4)'}}>{Math.round(processPct)}%</span>
                </div>
                <div style={{height:4,background:'rgba(255,255,255,0.08)',borderRadius:2,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${processPct}%`,background:'linear-gradient(90deg,#d4a853,#e8c46a)',borderRadius:2,transition:'width 0.4s'}}/>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* BRAINSTORM */}
        <div style={{position:'absolute',inset:0,opacity:state.screen==='brainstorm'?1:0,pointerEvents:state.screen==='brainstorm'?'auto':'none',transition:'opacity 0.2s ease'}}>
          <BrainstormScreen categoryId={activeCategoryId} active={state.screen==='brainstorm'}/>
        </div>

      </div>
    </div>
  )
}

// ─── INFO BUBBLE ─────────────────────────────────────────────────────────────
function InfoBubble({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,marginTop:4}}>
      <button
        onClick={()=>setOpen(o=>!o)}
        style={{
          width:28,height:28,borderRadius:'50%',
          border:'1px solid rgba(255,255,255,0.15)',
          background:'rgba(255,255,255,0.05)',
          color:'rgba(255,255,255,0.45)',
          fontSize:13,fontWeight:600,
          cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',
          transition:'all 0.15s',
          WebkitTapHighlightColor:'transparent',
          flexShrink:0,
        }}
      >i</button>
      {open && (
        <div style={{
          fontSize:12,color:'rgba(255,255,255,0.4)',lineHeight:1.6,textAlign:'center',
          maxWidth:260,padding:'10px 14px',
          background:'rgba(255,255,255,0.03)',
          border:'1px solid rgba(255,255,255,0.07)',
          borderRadius:10,
          animation:'fadeIn 0.15s ease',
        }}>
          {text}
        </div>
      )}
      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  )
}

// ─── RECORD BUTTON ────────────────────────────────────────────────────────────
function RecordButton({ recording, status, audioLevel, onPressStart, onPressEnd, small }) {
  const [holdPct, setHoldPct] = useState(0)
  const hRef = useRef(null)
  function startHold() {
    onPressStart()
    const t=Date.now()
    hRef.current=setInterval(()=>{const p=Math.min(100,(Date.now()-t)/LONG_PRESS_MS*100);setHoldPct(p);if(p>=100){clearInterval(hRef.current);setHoldPct(0)}},20)
  }
  function endHold() { clearInterval(hRef.current); onPressEnd(); setTimeout(()=>setHoldPct(0),200) }

  const size    = small ? 56 : 88
  const radius  = small ? 14 : 22   // rounded square
  const iconSize = small ? 20 : 28

  // Colour states
  const isRecording = recording
  const isStarting  = status === 'starting'
  const bg      = isRecording ? 'rgba(224,48,48,0.12)' : 'rgba(255,255,255,0.05)'
  const border  = isRecording ? 'rgba(224,48,48,0.7)'  : isStarting ? '#d4a853' : 'rgba(255,255,255,0.18)'
  const color   = isRecording ? '#e03030' : 'rgba(255,255,255,0.85)'
  const shadow  = isRecording ? '0 0 18px rgba(224,48,48,0.35), inset 0 1px 0 rgba(255,255,255,0.08)' : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.4)'

  return (
    <button
      onTouchStart={startHold} onTouchEnd={endHold}
      onMouseDown={startHold}  onMouseUp={endHold} onMouseLeave={endHold}
      style={{
        position:'relative',
        width:size, height:size, flexShrink:0,
        borderRadius:radius,
        border:`1.5px solid ${border}`,
        background:bg,
        color,
        display:'flex',alignItems:'center',justifyContent:'center',
        cursor:'pointer',
        transition:'transform 80ms ease, background 200ms, border-color 200ms, box-shadow 200ms',
        boxShadow:shadow,
        transform:`scale(${isRecording?1+audioLevel*0.06:1})`,
        WebkitTapHighlightColor:'transparent',
      }}
    >
      {/* Hold progress arc */}
      {holdPct>0&&holdPct<100&&(
        <svg style={{position:'absolute',inset:-3,width:'calc(100% + 6px)',height:'calc(100% + 6px)',pointerEvents:'none'}} viewBox="0 0 100 100">
          <rect x="2" y="2" width="96" height="96" rx={radius*1.5} ry={radius*1.5} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="3"
            strokeDasharray={`${holdPct*3.76} 376`} strokeLinecap="round"
            style={{transformOrigin:'50% 50%',transform:'rotate(-90deg)'}}/>
        </svg>
      )}
      {/* Recording pulse glow */}
      {isRecording&&(
        <div style={{position:'absolute',inset:-4,borderRadius:radius+4,border:'1.5px solid rgba(224,48,48,0.3)',animation:'rec-pulse 1.4s ease infinite',pointerEvents:'none'}}/>
      )}
      {isStarting
        ? <Loader2 size={iconSize} style={{animation:'spin 1s linear infinite'}}/>
        : isRecording
        ? <Square size={iconSize}/>
        : <Mic size={iconSize}/>
      }
      <style>{`@keyframes rec-pulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:0.7;transform:scale(1.08)}}`}</style>
    </button>
  )
}

// ─── ENTRY ROW ────────────────────────────────────────────────────────────────
function EntryRow({ entry, onDelete }) {
  const isMarker=entry.type==='marker'
  const lowConf=entry.confidence!=null&&entry.confidence<0.45
  return (
    <div className={`entry-row ${isMarker?'entry-row-marker':''}`}>
      <span className="entry-time">{fmt(entry.timestamp_ms)}</span>
      {isMarker&&<Flag size={9} style={{color:'rgba(255,255,255,0.5)',flexShrink:0}}/>}
      <span className="entry-text" style={lowConf?{color:'rgba(255,255,255,0.4)',textDecoration:'underline dotted rgba(255,255,255,0.2)'}:{}}>{entry.text}</span>
      {lowConf&&<span style={{fontSize:8,color:'#555',marginLeft:4,flexShrink:0}}>?</span>}
    </div>
  )
}

// ─── BRAINSTORM ───────────────────────────────────────────────────────────────
function BrainstormScreen({ categoryId, active }) {
  const [messages,   setMessages]   = useState([])
  const [input,      setInput]      = useState('')
  const [streaming,  setStreaming]  = useState(false)
  const [streamText, setStreamText] = useState('')
  const [orbMood,    setOrbMood]    = useState('idle')
  const [generating, setGenerating] = useState(false)
  const [generated,  setGenerated]  = useState(null)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)
  const abortRef  = useRef(null)

  // Cancel any in-flight stream on unmount
  useEffect(() => { return () => { abortRef.current?.abort() } }, [])

  useEffect(() => {
    if (!categoryId) return
    chatApi.getHistory({ categoryId, mode:'generate' }).then(({messages:h})=>setMessages(h||[])).catch(()=>{})
  }, [categoryId])

  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [messages, streamText])

  // Focus input when tab becomes active
  useEffect(() => { if (active) setTimeout(()=>inputRef.current?.focus(),200) }, [active])

  async function send() {
    const text=input.trim()
    if (!text||streaming) return
    setMessages(p=>[...p,{role:'user',content:text,timestamp:new Date().toISOString()}])
    setInput(''); setStreaming(true); setStreamText(''); setOrbMood('processing')
    abortRef.current?.abort()
    const ctrl=new AbortController(); abortRef.current=ctrl
    try {
      await chatApi.send({categoryId,mode:'generate',message:text,messages:[]},{
        chunk:({text:t})=>setStreamText(p=>p+t),
        done:({response})=>{setMessages(p=>[...p,{role:'assistant',content:response,timestamp:new Date().toISOString()}]);setStreamText('');setStreaming(false);setOrbMood('active');setTimeout(()=>setOrbMood('idle'),3000)},
        error:()=>{setStreamText('');setStreaming(false);setOrbMood('idle')},
      }, ctrl.signal)
    } catch(e){if(e.name!=='AbortError'){setStreaming(false);setOrbMood('idle')}}
  }

  async function generateFromChat() {
    if (generating||!categoryId) return
    setGenerating(true); setOrbMood('processing')
    abortRef.current?.abort()
    const ctrl=new AbortController(); abortRef.current=ctrl
    try {
      await chatApi.generateEpisode({categoryId,mode:'generate'},{
        progress:({message})=>setMessages(p=>{const l=p[p.length-1];return l?.isGenerating?[...p.slice(0,-1),{...l,content:message}]:[...p,{role:'assistant',content:message,isGenerating:true}]}),
        done:({parsed})=>{setMessages(p=>p.filter(m=>!m.isGenerating));setGenerated(parsed?.metadata?.trackName);setGenerating(false);setOrbMood('discovery');setTimeout(()=>setOrbMood('idle'),4000)},
        error:()=>{setMessages(p=>p.filter(m=>!m.isGenerating));setGenerating(false);setOrbMood('idle')},
      }, ctrl.signal)
    } catch(e){if(e.name!=='AbortError'){setGenerating(false);setOrbMood('idle')}}
  }

  const canGenerate=messages.length>=4&&!streaming&&!generating

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'rgba(10,12,18,0.97)',position:'relative'}}>
      {/* Green glow line — matches web KB */}
      <div style={{position:'absolute',top:0,left:0,right:0,height:1,background:'linear-gradient(90deg,transparent 0%,rgba(74,222,128,0) 10%,rgba(74,222,128,0.7) 35%,rgba(74,222,128,1) 50%,rgba(74,222,128,0.7) 65%,rgba(74,222,128,0) 90%,transparent 100%)',zIndex:2}}/>
      <div style={{position:'absolute',top:0,left:'10%',right:'10%',height:40,background:'radial-gradient(ellipse at 50% 0%,rgba(74,222,128,0.12) 0%,transparent 70%)',pointerEvents:'none',zIndex:1}}/>

      {/* Orb */}
      <div style={{display:'flex',justifyContent:'center',paddingTop:16,paddingBottom:4,flexShrink:0,zIndex:3}}>
        <MascotOrb mood={orbMood} audioLevel={0} size={160}/>
      </div>

      {/* Mode label */}
      <div style={{textAlign:'center',paddingBottom:10,flexShrink:0}}>
        <div style={{fontFamily:"'Figtree',sans-serif",fontSize:10,fontWeight:500,letterSpacing:'0.10em',textTransform:'uppercase',color:'rgba(255,255,255,0.3)',marginBottom:2}}>Knowledge Base</div>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:15,fontWeight:600,color:'rgba(74,222,128,1)',letterSpacing:'-0.01em'}}>Brainstorm</div>
      </div>

      {/* Messages */}
      <div style={{flex:1,minHeight:0,overflowY:'auto',overflowX:'hidden',padding:'8px 16px',display:'flex',flexDirection:'column',gap:10,scrollbarWidth:'thin',scrollbarColor:'rgba(255,255,255,0.05) transparent',WebkitOverflowScrolling:'touch'}}>
        {messages.length===0&&!streaming&&(
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100%',textAlign:'center',gap:6}}>
            <div style={{fontSize:28,marginBottom:4,opacity:0.2,color:'rgba(74,222,128,1)'}}>✦</div>
            <div style={{fontFamily:"'Figtree',sans-serif",fontSize:13,color:'rgba(74,222,128,0.4)'}}>Hooks, structure, trending angles...</div>
          </div>
        )}
        {messages.map((m,i)=>(
          <div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start'}}>
            <div style={{maxWidth:'82%',padding:'10px 14px',borderRadius:12,fontFamily:"'Figtree',sans-serif",fontSize:14,lineHeight:1.65,fontWeight:400,...(m.role==='user'?{borderBottomRightRadius:3,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',color:'#e8eaed'}:{borderBottomLeftRadius:3,background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.04)',color:'#b0b5c0'})}}>
              <KBMsg content={m.content}/>
              {m.isGenerating&&<span style={{color:'rgba(74,222,128,0.6)',marginLeft:6}}>✦</span>}
            </div>
          </div>
        ))}
        {streaming&&streamText&&(
          <div style={{display:'flex',justifyContent:'flex-start'}}>
            <div style={{maxWidth:'82%',padding:'10px 14px',borderRadius:12,borderBottomLeftRadius:3,fontFamily:"'Figtree',sans-serif",fontSize:14,lineHeight:1.65,background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.04)',color:'#b0b5c0'}}>
              <KBMsg content={streamText}/>
              <span style={{display:'inline-block',width:2,height:12,borderRadius:1,marginLeft:2,verticalAlign:'middle',background:'rgba(74,222,128,0.8)',animation:'kb-blink 1s infinite'}}/>
            </div>
          </div>
        )}
        {streaming&&!streamText&&(
          <div style={{display:'flex',gap:5,padding:'10px 0'}}>
            {[0,1,2].map(i=><div key={i} style={{width:4,height:4,borderRadius:'50%',background:'rgba(74,222,128,1)',animation:`kb-bounce 0.8s ${i*150}ms infinite`}}/>)}
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {/* Generated bar */}
      {generated&&(
        <div style={{padding:'8px 16px',fontSize:13,display:'flex',alignItems:'center',gap:7,borderTop:'1px solid rgba(74,222,128,0.08)',background:'rgba(74,222,128,0.04)',color:'rgba(74,222,128,0.7)',fontFamily:"'Figtree',sans-serif",flexShrink:0}}>
          <Check size={10}/> "{generated}" is ready — open WhispaCuts to review
        </div>
      )}

      {/* Generate strip */}
      {canGenerate&&(
        <div style={{margin:'0 12px 8px',padding:'9px 13px',borderRadius:9,border:'1px solid rgba(74,222,128,0.12)',background:'rgba(74,222,128,0.04)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
          <span style={{fontFamily:"'Figtree',sans-serif",fontSize:13,color:'rgba(74,222,128,0.55)'}}>Ready to generate</span>
          <button onClick={generateFromChat} style={{fontFamily:"'Figtree',sans-serif",fontSize:13,fontWeight:500,padding:'5px 10px',borderRadius:6,border:'1px solid rgba(74,222,128,0.18)',background:'rgba(74,222,128,0.07)',color:'rgba(74,222,128,0.85)',cursor:'pointer',display:'flex',alignItems:'center',gap:5}}>
            {generating?<Loader2 size={9}/>:<Sparkles size={9}/>}{generating?'Generating...':'Generate episode'}
          </button>
        </div>
      )}

      {/* Input */}
      <div style={{padding:'8px 16px 16px',flexShrink:0}}>
        <div style={{display:'flex',gap:8,background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'8px 12px'}}>
          <input ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Hooks, structure, trending angles..."
            style={{flex:1,background:'transparent',border:'none',outline:'none',fontFamily:"'Figtree',sans-serif",fontSize:14,lineHeight:1.5,color:'#e8eaed'}}/>
          <button onClick={send} disabled={!input.trim()||streaming}
            style={{alignSelf:'flex-end',width:30,height:30,borderRadius:7,border:'none',cursor:input.trim()&&!streaming?'pointer':'not-allowed',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,background:input.trim()&&!streaming?'rgba(74,222,128,1)':'rgba(255,255,255,0.04)',color:input.trim()&&!streaming?'#080808':'rgba(255,255,255,0.2)',transition:'all 0.15s',opacity:!input.trim()||streaming?0.4:1}}>
            <Send size={12}/>
          </button>
        </div>
      </div>

      <style>{`@keyframes kb-bounce{0%,80%,100%{transform:translateY(0);opacity:.25}40%{transform:translateY(-4px);opacity:.9}}@keyframes kb-blink{0%,100%{opacity:0}50%{opacity:1}}`}</style>
    </div>
  )
}

function KBMsg({ content }) {
  const parts=(content||'').split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g)
  return <span>{parts.map((p,i)=>{if(p.startsWith('**')&&p.endsWith('**'))return<strong key={i} style={{color:'#e8eaed',fontWeight:600}}>{p.slice(2,-2)}</strong>;if(p.startsWith('`')&&p.endsWith('`'))return<code key={i} style={{fontFamily:'monospace',fontSize:12,background:'rgba(255,255,255,0.06)',padding:'1px 5px',borderRadius:3,color:'#b0b5c0'}}>{p.slice(1,-1)}</code>;if(p==='\n')return<br key={i}/>;return p})}</span>
}