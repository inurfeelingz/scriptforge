// frontend/src/pages/SettingsPage.jsx
// Modernized: readable fonts, admin tier panel, usage bar, better layout

import { useState, useEffect } from 'react'
import { Send, Check, AlertCircle, Shield, ChevronRight, LogOut, Zap, AlertTriangle, TrendingUp, DollarSign } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { signOut } from '../lib/supabase'
import { useStore } from '../store'
import { users as usersApi, categories as catApi, episodes as episodesApi, testWebhook } from '../lib/api'

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, subtitle, children, accent, tab, activeTab }) {
  // Hide section when tab doesn't match (if tab prop is set)
  if (tab && activeTab && tab !== activeTab) return null
  return (
    <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"var(--r)", padding:"1.5rem", marginBottom:"1.25rem" }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{
          fontFamily: 'Syne, sans-serif',
          fontSize: '1.1rem',
          fontWeight: 700,
          color: 'var(--text)',
          margin: 0,
        }}>
          {title}
        </h2>
        {subtitle && (
          <p style={{
            fontSize: '0.875rem',
            color: 'var(--text2)',
            marginTop: '0.375rem',
            lineHeight: 1.6,
          }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
      {/* ── Voice Clone ── */}
      <Section icon={<Mic size={16}/>} title="KB Voice Clone" tab="integrations" activeTab={activeTab} subtitle="Train KB to speak in your voice using ElevenLabs. Upload at least 30 minutes of clean audio.">
        {cloneVoiceId ? (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, border:'1px solid rgba(74,222,128,0.2)', background:'rgba(74,222,128,0.04)' }}>
            <span style={{ fontSize:13, color:'rgba(74,222,128,0.8)', fontFamily:"'Figtree',sans-serif" }}>✓ Voice clone active</span>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", fontFamily:'monospace' }}>{cloneVoiceId}</span>
            <label style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'rgba(255,255,255,0.4)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:11, fontFamily:"'Figtree',sans-serif" }}>
              {cloningVoice ? 'Uploading...' : 'Re-train'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
          </div>
        ) : (
          <div>
            <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
              <Upload size={12}/>
              {cloningVoice ? 'Training voice clone...' : 'Upload voice sample'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
              MP3, M4A, or WAV. Minimum 30 minutes of clean speech. No music or background noise.
            </div>
          </div>
        )}
      </Section>

      {/* ── Reaction Images ── */}
      <Section icon={<User size={16}/>} title="Thumbnail Reaction Images" tab="integrations" activeTab={activeTab} subtitle="Upload photos of your reactions for thumbnail generation. Tag each one so KB can select the right expression.">
        <div style={{ marginBottom:12 }}>
          <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: uploadingReaction ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
            <Upload size={12}/>
            {uploadingReaction ? 'Uploading...' : 'Upload reaction photos'}
            <input type="file" accept="image/*" multiple onChange={handleReactionUpload} disabled={uploadingReaction} style={{ display:'none' }}/>
          </label>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
            JPG or PNG. Name files by expression (e.g. "surprised.jpg", "confident.jpg") for auto-tagging.
          </div>
        </div>

        {reactionImages.length === 0 && (
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.2)', fontFamily:"'Figtree',sans-serif", fontStyle:'italic' }}>
            No reaction images yet. Upload photos of yourself that KB can reference when generating thumbnail prompts.
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap:10 }}>
          {reactionImages.map(img => (
            <div key={img.id} style={{ borderRadius:8, overflow:'hidden', border:'1px solid rgba(255,255,255,0.07)', background:'rgba(255,255,255,0.02)' }}>
              <div style={{ aspectRatio:'1', overflow:'hidden', background:'#111' }}>
                <img src={img.storage_url} alt={img.tag} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              </div>
              <div style={{ padding:'6px 8px' }}>
                <input
                  value={img.tag}
                  onChange={e => updateReactionTag(img.id, e.target.value)}
                  placeholder="Tag (e.g. surprised)"
                  style={{ width:'100%', background:'transparent', border:'none', borderBottom:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)', fontSize:11, fontFamily:"'Figtree',sans-serif", outline:'none', padding:'2px 0', boxSizing:'border-box' }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  )
}

function Field({ label, value, onChange, placeholder, hint, wide, multiline }) {
  return (
    <div style={{ gridColumn: wide ? 'span 2' : undefined }}>
      <label style={{ display:"block", fontSize:"0.8125rem", fontWeight:500, color:"var(--text2)", marginBottom:"0.375rem" }}>{label}</label>
      {hint && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text3)', marginBottom: '0.375rem' }}>
          {hint}
        </p>
      )}
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"var(--r-sm)", padding:"0.625rem 0.875rem", fontSize:"0.9375rem", color:"var(--text)", fontFamily:"inherit", outline:"none", resize:"vertical" }}
          rows={3}
        />
      ) : (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"var(--r-sm)", padding:"0.625rem 0.875rem", fontSize:"0.9375rem", color:"var(--text)", fontFamily:"inherit", outline:"none" }}
        />
      )}
      {/* ── Voice Clone ── */}
      <Section icon={<Mic size={16}/>} title="KB Voice Clone" tab="integrations" activeTab={activeTab} subtitle="Train KB to speak in your voice using ElevenLabs. Upload at least 30 minutes of clean audio.">
        {cloneVoiceId ? (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, border:'1px solid rgba(74,222,128,0.2)', background:'rgba(74,222,128,0.04)' }}>
            <span style={{ fontSize:13, color:'rgba(74,222,128,0.8)', fontFamily:"'Figtree',sans-serif" }}>✓ Voice clone active</span>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", fontFamily:'monospace' }}>{cloneVoiceId}</span>
            <label style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'rgba(255,255,255,0.4)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:11, fontFamily:"'Figtree',sans-serif" }}>
              {cloningVoice ? 'Uploading...' : 'Re-train'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
          </div>
        ) : (
          <div>
            <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
              <Upload size={12}/>
              {cloningVoice ? 'Training voice clone...' : 'Upload voice sample'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
              MP3, M4A, or WAV. Minimum 30 minutes of clean speech. No music or background noise.
            </div>
          </div>
        )}
      </Section>

      {/* ── Reaction Images ── */}
      <Section icon={<User size={16}/>} title="Thumbnail Reaction Images" tab="integrations" activeTab={activeTab} subtitle="Upload photos of your reactions for thumbnail generation. Tag each one so KB can select the right expression.">
        <div style={{ marginBottom:12 }}>
          <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: uploadingReaction ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
            <Upload size={12}/>
            {uploadingReaction ? 'Uploading...' : 'Upload reaction photos'}
            <input type="file" accept="image/*" multiple onChange={handleReactionUpload} disabled={uploadingReaction} style={{ display:'none' }}/>
          </label>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
            JPG or PNG. Name files by expression (e.g. "surprised.jpg", "confident.jpg") for auto-tagging.
          </div>
        </div>

        {reactionImages.length === 0 && (
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.2)', fontFamily:"'Figtree',sans-serif", fontStyle:'italic' }}>
            No reaction images yet. Upload photos of yourself that KB can reference when generating thumbnail prompts.
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap:10 }}>
          {reactionImages.map(img => (
            <div key={img.id} style={{ borderRadius:8, overflow:'hidden', border:'1px solid rgba(255,255,255,0.07)', background:'rgba(255,255,255,0.02)' }}>
              <div style={{ aspectRatio:'1', overflow:'hidden', background:'#111' }}>
                <img src={img.storage_url} alt={img.tag} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              </div>
              <div style={{ padding:'6px 8px' }}>
                <input
                  value={img.tag}
                  onChange={e => updateReactionTag(img.id, e.target.value)}
                  placeholder="Tag (e.g. surprised)"
                  style={{ width:'100%', background:'transparent', border:'none', borderBottom:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)', fontSize:11, fontFamily:"'Figtree',sans-serif", outline:'none', padding:'2px 0', boxSizing:'border-box' }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  )
}

function UsageBar({ used, max, label }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  const cls = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : ''
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text2)' }}>{label}</span>
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text)' }}>
          {used} / {max >= 9999 ? '∞' : max}
        </span>
      </div>
      <div style={{ height:"6px", background:"var(--surface3)", borderRadius:"99px", overflow:"hidden", marginTop:"0.5rem" }}>
        <div
          style={{
            width:        max >= 9999 ? '5%' : `${pct}%`,
            height:       '100%',
            borderRadius: '99px',
            transition:   'width 0.4s',
            background:   cls === 'danger' ? 'var(--red)' : cls === 'warn' ? '#e0a030' : 'var(--accent)',
          }}
        />
      </div>
      {/* ── Voice Clone ── */}
      <Section icon={<Mic size={16}/>} title="KB Voice Clone" tab="integrations" activeTab={activeTab} subtitle="Train KB to speak in your voice using ElevenLabs. Upload at least 30 minutes of clean audio.">
        {cloneVoiceId ? (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, border:'1px solid rgba(74,222,128,0.2)', background:'rgba(74,222,128,0.04)' }}>
            <span style={{ fontSize:13, color:'rgba(74,222,128,0.8)', fontFamily:"'Figtree',sans-serif" }}>✓ Voice clone active</span>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", fontFamily:'monospace' }}>{cloneVoiceId}</span>
            <label style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'rgba(255,255,255,0.4)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:11, fontFamily:"'Figtree',sans-serif" }}>
              {cloningVoice ? 'Uploading...' : 'Re-train'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
          </div>
        ) : (
          <div>
            <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
              <Upload size={12}/>
              {cloningVoice ? 'Training voice clone...' : 'Upload voice sample'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
              MP3, M4A, or WAV. Minimum 30 minutes of clean speech. No music or background noise.
            </div>
          </div>
        )}
      </Section>

      {/* ── Reaction Images ── */}
      <Section icon={<User size={16}/>} title="Thumbnail Reaction Images" tab="integrations" activeTab={activeTab} subtitle="Upload photos of your reactions for thumbnail generation. Tag each one so KB can select the right expression.">
        <div style={{ marginBottom:12 }}>
          <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: uploadingReaction ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
            <Upload size={12}/>
            {uploadingReaction ? 'Uploading...' : 'Upload reaction photos'}
            <input type="file" accept="image/*" multiple onChange={handleReactionUpload} disabled={uploadingReaction} style={{ display:'none' }}/>
          </label>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
            JPG or PNG. Name files by expression (e.g. "surprised.jpg", "confident.jpg") for auto-tagging.
          </div>
        </div>

        {reactionImages.length === 0 && (
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.2)', fontFamily:"'Figtree',sans-serif", fontStyle:'italic' }}>
            No reaction images yet. Upload photos of yourself that KB can reference when generating thumbnail prompts.
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap:10 }}>
          {reactionImages.map(img => (
            <div key={img.id} style={{ borderRadius:8, overflow:'hidden', border:'1px solid rgba(255,255,255,0.07)', background:'rgba(255,255,255,0.02)' }}>
              <div style={{ aspectRatio:'1', overflow:'hidden', background:'#111' }}>
                <img src={img.storage_url} alt={img.tag} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              </div>
              <div style={{ padding:'6px 8px' }}>
                <input
                  value={img.tag}
                  onChange={e => updateReactionTag(img.id, e.target.value)}
                  placeholder="Tag (e.g. surprised)"
                  style={{ width:'100%', background:'transparent', border:'none', borderBottom:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)', fontSize:11, fontFamily:"'Figtree',sans-serif", outline:'none', padding:'2px 0', boxSizing:'border-box' }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { profile, setProfile, activeCategoryId, activeCategory, notify, theme, setTheme } = useStore()
  const [reactionImages,   setReactionImages]   = useState([])
  const [activeTab,        setActiveTab]        = useState('profile')
  const [resettingVoice,   setResettingVoice]   = useState(false)
  const [clearingData,     setClearingData]     = useState(false)
  const [deletingEpisodes, setDeletingEpisodes] = useState(false)
  const [confirmAction,    setConfirmAction]    = useState(null)
  const [cloningVoice,     setCloningVoice]     = useState(false)
  const [cloneVoiceId,     setCloneVoiceId]     = useState(cat?.voice_profile?.elevenLabsVoiceId || null)
  const [uploadingReaction,setUploadingReaction] = useState(false)
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768)
  // Update on resize
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  const navigate = useNavigate()
  const cat = activeCategory?.()

  const [name,           setName]          = useState(profile?.display_name || '')
  const [saving,         setSaving]        = useState(false)
  const [savingVoice,    setSavingVoice]   = useState(false)
  const [webhookTesting, setWebhookTesting]= useState(false)
  const [webhookStatus,  setWebhookStatus] = useState(null)
  const [usage,          setUsage]         = useState(null)

  // Admin: tier editor state
  const [adminUsers,     setAdminUsers]    = useState(null)
  const [adminLoading,   setAdminLoading]  = useState(false)
  const [tierSaving,     setTierSaving]    = useState({})
  const [tokenUsage,     setTokenUsage]    = useState(null)
  const [tokenLoading,   setTokenLoading]  = useState(false)
  const [balance,        setBalance]       = useState(null)
  const [balanceLoading, setBalanceLoading]= useState(false)

  useEffect(() => {
    episodesApi.usage().then(setUsage).catch(() => {})
  }, [])

  // Load user list + token usage + balance if admin
  useEffect(() => {
    if (!profile?.is_admin) return
    ;(async () => {
    setAdminLoading(true)
    usersApi.list()
      .then(data => {
        setAdminUsers(data?.users || [])
        setAdminLoading(false)
      })
      .catch(err => {
        console.error('Admin users load failed:', err.message)
        setAdminUsers([])
        setAdminLoading(false)
      })

    // Token usage
    setTokenLoading(true)
    // Token usage + balance — use supabase session for auth
    const { getSession } = await import('../lib/supabase')
    const sess = await getSession().catch(() => null)
    const token = sess?.access_token || ''
    const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/api$/, '')

    setTokenLoading(true)
    fetch(`${BASE}/api/admin/token-usage`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(d => { setTokenUsage(d); setTokenLoading(false) }).catch(() => setTokenLoading(false))

    setBalanceLoading(true)
    fetch(`${BASE}/api/admin/anthropic-balance`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(r => r.json()).then(d => { setBalance(d); setBalanceLoading(false) }).catch(() => setBalanceLoading(false))
    })()
  }, [profile?.is_admin])

  // Load reaction images for this category
  useEffect(() => {
    if (!activeCategoryId) return
    supabase
      .from('creator_assets')
      .select('id, file_name, tag, storage_url, created_at')
      .eq('user_id', profile?.id)
      .eq('category_id', activeCategoryId)
      .eq('asset_type', 'reaction')
      .order('created_at', { ascending: false })
      .then(({ data }) => setReactionImages(data || []))
      .catch(() => {})
  }, [activeCategoryId, profile?.id])

  async function handleVoiceClone(e) {
    const file = e.target.files?.[0]
    if (!file || !activeCategoryId) return
    setCloningVoice(true)
    notify('Uploading voice sample — this may take a minute...', 'info', 8000)
    try {
      const { supabase: sb } = await import('../lib/supabase')
      const { data: { session } } = await sb.auth.getSession()
      const form = new FormData()
      form.append('file', file)
      form.append('categoryId', activeCategoryId)
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/chat/voice-clone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body: form,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCloneVoiceId(data.voiceId)
      notify('Voice clone created — KB now speaks in your voice', 'success')
    } catch (err) {
      notify('Voice clone failed: ' + err.message, 'error')
    }
    setCloningVoice(false)
    e.target.value = ''
  }

  async function resetVoiceProfile() {
    if (!activeCategoryId) return
    setResettingVoice(true)
    try {
      const { supabase: sb } = await import('../lib/supabase')
      await sb.from('categories').update({
        voice_profile: null,
        onboarded_at:  null,
        updated_at:    new Date().toISOString(),
      }).eq('id', activeCategoryId)
      await loadCategories()
      notify('Voice profile reset — KB will re-interview you on next visit', 'success')
      setConfirmAction(null)
    } catch (err) { notify(err.message, 'error') }
    setResettingVoice(false)
  }

  async function clearAnalyticsData() {
    if (!activeCategoryId) return
    setClearingData(true)
    try {
      const { supabase: sb } = await import('../lib/supabase')
      const { data: { user } } = await sb.auth.getUser()
      await sb.from('analytics_uploads').delete().eq('user_id', user.id).eq('category_id', activeCategoryId)
      await sb.from('audience_uploads').delete().eq('user_id', user.id).eq('category_id', activeCategoryId)
      await sb.from('chat_history').delete().eq('user_id', user.id).eq('category_id', activeCategoryId)
      await sb.from('kb_learnings').delete().eq('user_id', user.id).eq('category_id', activeCategoryId)
      notify('Analytics data, chat history, and KB memory cleared', 'success')
      setConfirmAction(null)
    } catch (err) { notify(err.message, 'error') }
    setClearingData(false)
  }

  async function deleteAllEpisodes() {
    if (!activeCategoryId) return
    setDeletingEpisodes(true)
    try {
      const { supabase: sb } = await import('../lib/supabase')
      const { data: { user } } = await sb.auth.getUser()
      await sb.from('episodes').delete().eq('user_id', user.id).eq('category_id', activeCategoryId)
      notify('All episodes deleted', 'success')
      setConfirmAction(null)
    } catch (err) { notify(err.message, 'error') }
    setDeletingEpisodes(false)
  }

  async function handleReactionUpload(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length || !activeCategoryId) return
    setUploadingReaction(true)
    for (const file of files) {
      try {
        // Upload to Supabase storage
        const ext      = file.name.split('.').pop()
        const path     = `reactions/${profile?.id}/${activeCategoryId}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('creator-assets')
          .upload(path, file, { upsert: false })
        if (upErr) throw upErr

        const { data: urlData } = supabase.storage
          .from('creator-assets')
          .getPublicUrl(path)

        // Default tag from filename
        const defaultTag = file.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]/g, ' ')
          .toLowerCase()
          .replace(/\w/g, c => c.toUpperCase())

        // Save reference in DB
        await supabase.from('creator_assets').insert({
          user_id:     profile?.id,
          category_id: activeCategoryId,
          asset_type:  'reaction',
          file_name:   file.name,
          storage_url: urlData.publicUrl,
          tag:         defaultTag,
          created_at:  new Date().toISOString(),
        })

        notify(`${file.name} uploaded`, 'success')
      } catch (err) {
        notify(`${file.name} failed: ${err.message}`, 'error')
      }
    }
    // Reload
    const { data } = await supabase
      .from('creator_assets')
      .select('id, file_name, tag, storage_url, created_at')
      .eq('user_id', profile?.id)
      .eq('category_id', activeCategoryId)
      .eq('asset_type', 'reaction')
      .order('created_at', { ascending: false })
    setReactionImages(data || [])
    setUploadingReaction(false)
    e.target.value = ''
  }

  async function updateReactionTag(id, tag) {
    await supabase.from('creator_assets').update({ tag }).eq('id', id)
    setReactionImages(prev => prev.map(r => r.id === id ? { ...r, tag } : r))
  }

  async function deleteReaction(id, storagePath) {
    await supabase.storage.from('creator-assets').remove([storagePath])
    await supabase.from('creator_assets').delete().eq('id', id)
    setReactionImages(prev => prev.filter(r => r.id !== id))
    notify('Removed', 'success')
  }

  const vp = cat?.voice_profile || {}
  const vc = vp.voiceCharacteristics  || {}
  const sp = vp.structuralPatterns    || {}
  const lf = vp.languageFingerprint   || {}

  const [voice, setVoice] = useState({
    sentenceLengthPattern: vc.sentenceLengthPattern || '',
    typicalSentenceLength: vc.typicalSentenceLength || '',
    rhythmNote:            vc.rhythmNote            || '',
    vocabularyLevel:       vc.vocabularyLevel       || '',
    hookStyle:             sp.hookStyle             || '',
    revealBuildPattern:    sp.revealBuildPattern    || '',
    openLoopStyle:         sp.openLoopStyle         || '',
    ctaStyle:              sp.ctaStyle              || '',
    transitionPhrases:     (sp.transitionPhrases    || []).join(', '),
    signaturePhrases:      (lf.signaturePhrases     || []).join(', '),
    sentenceOpeners:       (lf.sentenceOpeners      || []).join(', '),
    rhetoricalDevices:     (lf.rhetoricalDevices    || []).join(', '),
    avoidPhrases:          (lf.avoidPhrases         || []).join(', '),
    humourStyle:           lf.humourStyle           || '',
    storytellingStyle:     lf.storytellingStyle     || '',
  })

  useEffect(() => {
    const vp2 = cat?.voice_profile || {}
    const vc2 = vp2.voiceCharacteristics || {}
    const sp2 = vp2.structuralPatterns   || {}
    const lf2 = vp2.languageFingerprint  || {}
    setVoice({
      sentenceLengthPattern: vc2.sentenceLengthPattern || '',
      typicalSentenceLength: vc2.typicalSentenceLength || '',
      rhythmNote:            vc2.rhythmNote            || '',
      vocabularyLevel:       vc2.vocabularyLevel       || '',
      hookStyle:             sp2.hookStyle             || '',
      revealBuildPattern:    sp2.revealBuildPattern    || '',
      openLoopStyle:         sp2.openLoopStyle         || '',
      ctaStyle:              sp2.ctaStyle              || '',
      transitionPhrases:     (sp2.transitionPhrases    || []).join(', '),
      signaturePhrases:      (lf2.signaturePhrases     || []).join(', '),
      sentenceOpeners:       (lf2.sentenceOpeners      || []).join(', '),
      rhetoricalDevices:     (lf2.rhetoricalDevices    || []).join(', '),
      avoidPhrases:          (lf2.avoidPhrases         || []).join(', '),
      humourStyle:           lf2.humourStyle           || '',
      storytellingStyle:     lf2.storytellingStyle     || '',
    })
  }, [activeCategoryId])

  const csv = s => s.split(',').map(x => x.trim()).filter(Boolean)
  const setV = k => v => setVoice(prev => ({ ...prev, [k]: v }))

  async function saveProfile() {
    setSaving(true)
    try {
      const { profile: updated } = await usersApi.updateProfile({ displayName: name })
      setProfile(updated)
      notify('Profile saved', 'success')
    } catch (err) { notify(err.message, 'error') }
    setSaving(false)
  }

  async function saveVoiceProfile() {
    if (!activeCategoryId) return
    setSavingVoice(true)
    try {
      await catApi.update(activeCategoryId, {
        voice_profile: {
          voiceCharacteristics: {
            sentenceLengthPattern: voice.sentenceLengthPattern,
            typicalSentenceLength: voice.typicalSentenceLength,
            rhythmNote:            voice.rhythmNote,
            vocabularyLevel:       voice.vocabularyLevel,
          },
          structuralPatterns: {
            hookStyle:          voice.hookStyle,
            revealBuildPattern: voice.revealBuildPattern,
            openLoopStyle:      voice.openLoopStyle,
            ctaStyle:           voice.ctaStyle,
            transitionPhrases:  csv(voice.transitionPhrases),
          },
          languageFingerprint: {
            signaturePhrases:  csv(voice.signaturePhrases),
            sentenceOpeners:   csv(voice.sentenceOpeners),
            rhetoricalDevices: csv(voice.rhetoricalDevices),
            avoidPhrases:      csv(voice.avoidPhrases),
            humourStyle:       voice.humourStyle,
            storytellingStyle: voice.storytellingStyle,
          },
        }
      })
      notify('Voice profile saved', 'success')
    } catch (err) { notify(err.message, 'error') }
    setSavingVoice(false)
  }

  async function sendTestWebhook() {
    setWebhookTesting(true)
    setWebhookStatus(null)
    try {
      await testWebhook()
      setWebhookStatus('ok')
      notify('Test notification sent', 'success')
    } catch (err) {
      setWebhookStatus('error')
      notify('Webhook failed: ' + err.message, 'error')
    }
    setWebhookTesting(false)
  }

  async function changeUserTier(userId, tier) {
    setTierSaving(s => ({ ...s, [userId]: true }))
    try {
      const limits = {
        free:   { max_episodes_pm: 8,    max_categories: 3    },
        pro:    { max_episodes_pm: 30,   max_categories: 10   },
        studio: { max_episodes_pm: 9999, max_categories: 9999 },
      }
      const { getSession } = await import('../lib/supabase')
      const session = await getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const BASE = import.meta.env.VITE_API_URL || '/api'
      const res = await fetch(`${BASE}/admin/users/${userId}/tier`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tier }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `${res.status}`)
      }
      setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, tier } : u))
      if (userId === profile?.id) setProfile({ ...profile, tier, ...limits[tier] })
      notify(`Tier updated to ${tier}`, 'success')
    } catch (err) {
      notify('Failed to update tier: ' + err.message, 'error')
    }
    setTierSaving(s => ({ ...s, [userId]: false }))
  }

  const TIERS = {
    free:   { label: 'Free',   episodes: 8,    categories: 3    },
    pro:    { label: 'Pro',    episodes: 30,   categories: 10   },
    studio: { label: 'Studio', episodes: 9999, categories: 9999 },
  }
  const tierInfo = TIERS[profile?.tier || 'free']

  const tierColor = {
    free:   'var(--text3)',
    pro:    'var(--blue)',
    studio: 'var(--accent)',
  }

  const TABS = [
    { key: 'profile',       label: 'Profile'      },
    { key: 'voice',         label: 'Voice & Style' },
    { key: 'integrations',  label: 'Integrations'  },
    { key: 'notifications', label: 'Notifications' },
    { key: 'danger',        label: 'Danger Zone'   },
  ]

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1.25rem' }}>Settings</h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {TABS.map(t => {
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                padding: '8px 14px',
                borderRadius: '8px 8px 0 0',
                border: 'none',
                borderBottom: active ? '2px solid rgba(74,222,128,1)' : '2px solid transparent',
                background: active ? 'rgba(74,222,128,0.05)' : 'transparent',
                color: active ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: "'Figtree',sans-serif",
                fontWeight: active ? 600 : 400,
                transition: 'all 0.15s',
                marginBottom: -1,
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── Profile ──────────────────────────────────────────────────────── */}
      <Section title="Profile" tab="profile" activeTab={activeTab}>
        {profile?.display_name && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(74,222,128,0.1)', background: 'rgba(74,222,128,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: "'Figtree',sans-serif", marginBottom: 2 }}>Your public profile</div>
              <div style={{ fontSize: 11, color: 'rgba(74,222,128,0.5)', fontFamily: 'monospace' }}>
                whispacuts.com/u/{profile.display_name.toLowerCase()}
              </div>
            </div>
            <a href={'/u/' + profile.display_name.toLowerCase()} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(74,222,128,0.15)', background: 'transparent', color: 'rgba(74,222,128,0.6)', textDecoration: 'none', fontFamily: "'Figtree',sans-serif" }}>
              View
            </a>
          </div>
        )}
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label style={{ display:"block", fontSize:"0.8125rem", fontWeight:500, color:"var(--text2)", marginBottom:"0.375rem" }}>Display name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveProfile()}
              style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"var(--r-sm)", padding:"0.625rem 0.875rem", fontSize:"0.9375rem", color:"var(--text)", fontFamily:"inherit", outline:"none" }}
              placeholder="Your name"
            />
          </div>
          <div>
            <label style={{ display:"block", fontSize:"0.8125rem", fontWeight:500, color:"var(--text2)", marginBottom:"0.375rem" }}>Email</label>
            <div style={{
              padding: '0.625rem 0.875rem',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-sm)',
              fontSize: '0.9375rem',
              color: 'var(--text2)',
            }}>
              {profile?.email || '—'}
            </div>
          </div>
          <div>
            <button onClick={saveProfile} disabled={saving} className="wc-btn wc-btn-primary" style={{ padding:"0.625rem 1.25rem", borderRadius:"var(--r-sm)", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:"0.5rem" }}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </Section>

      {/* ── Plan & usage ─────────────────────────────────────────────────── */}
      <Section title="Plan & Usage" tab="profile" activeTab={activeTab}>
        {/* Tier display */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          padding: '1rem',
          background: 'var(--surface2)',
          borderRadius: 'var(--r-sm)',
          marginBottom: '1.25rem',
        }}>
          <div style={{
            width: 44, height: 44,
            borderRadius: 10,
            background: 'var(--accent-lo)',
            border: '1px solid var(--accent-mid)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.25rem',
          }}>
            {profile?.tier === 'studio' ? '🏆' : profile?.tier === 'pro' ? '⚡' : '✦'}
          </div>
          <div>
            <div style={{
              fontFamily: 'Syne, sans-serif',
              fontWeight: 700,
              fontSize: '1.1rem',
              color: tierColor[profile?.tier || 'free'],
            }}>
              {tierInfo.label} Plan
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text2)', marginTop: 2 }}>
              {tierInfo.episodes >= 9999 ? 'Unlimited' : tierInfo.episodes} episodes/mo
              · {tierInfo.categories >= 9999 ? 'Unlimited' : tierInfo.categories} workspaces
            </div>
          </div>
        </div>

        {/* Usage bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <UsageBar
            used={profile?.episodes_this_month || 0}
            max={profile?.max_episodes_pm || 8}
            label="Episodes this month"
          />
        </div>

        {/* Cost breakdown if available */}
        {usage && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: '0.75rem',
            marginTop: '1.25rem',
          }}>
            {[
              { label: 'Episodes generated', value: usage.episodesThisMonth },
              { label: 'Tokens used',         value: ((usage.inputTokens + usage.outputTokens) / 1000).toFixed(1) + 'k' },
              { label: 'Est. API cost',        value: '$' + usage.estimatedCostUsd.toFixed(3) },
            ].map(({ label, value }) => (
              <div key={label} style={{ background:"var(--surface2)", borderRadius:"var(--r-sm)", padding:"1rem" }}>
                <div style={{ fontSize:"0.75rem", fontWeight:500, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:"0.25rem" }}>{label}</div>
                <div style={{ fontFamily:"Syne, sans-serif", fontSize:"1.25rem", fontWeight:700, color:"var(--accent)" }}>{value}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {profile?.is_admin && (
        <Section
          title="Admin — Cost & Credit Dashboard"
          subtitle="Live token spend and Anthropic API credit balance."
          tab="profile" activeTab={activeTab}
        >
          {/* Anthropic balance */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
              Anthropic API Balance
            </div>
            {balanceLoading ? (
              <div style={{ fontSize: 13, color: '#444' }}>Fetching balance...</div>
            ) : balance?.balance != null ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', borderRadius: 10,
                background: balance.lowCredit ? 'rgba(224,85,80,0.08)' : 'rgba(106,184,122,0.08)',
                border: `1px solid ${balance.lowCredit ? 'rgba(224,85,80,0.25)' : 'rgba(106,184,122,0.22)'}`,
              }}>
                {balance.lowCredit
                  ? <AlertTriangle size={18} style={{ color: '#e05550', flexShrink: 0 }}/>
                  : <DollarSign size={18} style={{ color: '#6ab87a', flexShrink: 0 }}/>
                }
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: balance.lowCredit ? '#e05550' : '#6ab87a', fontFamily: 'Syne, sans-serif' }}>
                    ${parseFloat(balance.balance || 0).toFixed(2)}
                    <span style={{ fontSize: 12, fontWeight: 400, color: '#555', marginLeft: 6 }}>{balance.currency || 'USD'} remaining</span>
                  </div>
                  {balance.lowCredit && (
                    <div style={{ fontSize: 12, color: '#e05550', marginTop: 3 }}>
                      ⚠ Balance below $10 — top up at console.anthropic.com before generating more episodes
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{
                padding: '12px 16px', borderRadius: 10, fontSize: 12, color: '#555',
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                {balance?.error || 'Balance unavailable — check console.anthropic.com'}
              </div>
            )}
          </div>

          {/* Token usage breakdown */}
          <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
            Token Usage (last 500 calls)
          </div>

          {tokenLoading ? (
            <div style={{ fontSize: 13, color: '#444' }}>Loading usage data...</div>
          ) : tokenUsage ? (
            <>
              {/* Totals row */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'Total cost', value: `$${parseFloat(tokenUsage.totals?.cost_usd || 0).toFixed(4)}`, color: '#d4a853' },
                  { label: 'Total calls', value: (tokenUsage.totals?.calls || 0).toLocaleString(), color: '#c8b89a' },
                  { label: 'Input tokens', value: (tokenUsage.totals?.input_tokens || 0).toLocaleString(), color: '#5ab0d4' },
                  { label: 'Output tokens', value: (tokenUsage.totals?.output_tokens || 0).toLocaleString(), color: '#7878d8' },
                ].map(stat => (
                  <div key={stat.label} style={{
                    padding: '12px 14px', borderRadius: 9,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: stat.color, fontFamily: 'Syne, sans-serif' }}>{stat.value}</div>
                    <div style={{ fontSize: 10, color: '#444', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* By action breakdown */}
              {tokenUsage.byAction && Object.keys(tokenUsage.byAction).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, color: '#444', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>By action</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Object.entries(tokenUsage.byAction)
                      .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
                      .map(([action, stats]) => {
                        const pct = tokenUsage.totals?.cost_usd > 0
                          ? (stats.cost_usd / tokenUsage.totals.cost_usd) * 100 : 0
                        return (
                          <div key={action} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#666', width: 180, flexShrink: 0 }}>
                              {action}
                            </div>
                            <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: '#d4a853', borderRadius: 2, minWidth: 2 }}/>
                            </div>
                            <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#c8b89a', width: 70, textAlign: 'right', flexShrink: 0 }}>
                              ${parseFloat(stats.cost_usd).toFixed(4)}
                            </div>
                            <div style={{ fontSize: 10, color: '#444', width: 50, textAlign: 'right', flexShrink: 0 }}>
                              {stats.calls}x
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )}

              {/* Recent calls */}
              {tokenUsage.recent?.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 11, color: '#444', cursor: 'pointer', userSelect: 'none', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Recent calls ({tokenUsage.recent.length})
                  </summary>
                  <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 60px 50px 50px' : '1fr 90px 80px 80px 70px', gap: '6px 10px', fontSize: 10, color: '#444', padding: '4px 0', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid rgba(255,255,255,0.04)', marginBottom: 4 }}>
                      <span>Action</span><span>Model</span><span>Input</span><span>Output</span><span>Cost</span>
                    </div>
                    {tokenUsage.recent.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 60px 50px 50px' : '1fr 90px 80px 80px 70px', gap: '4px 10px', fontSize: 11, color: '#666', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', fontFamily: 'monospace' }}>
                        <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.action}</span>
                        <span style={{ color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(row.model || '').replace('claude-','')}</span>
                        <span>{(row.input_tokens || 0).toLocaleString()}</span>
                        <span>{(row.output_tokens || 0).toLocaleString()}</span>
                        <span style={{ color: '#d4a853' }}>${parseFloat(row.cost_usd || 0).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#444' }}>No token usage data yet — run the SQL migration first.</div>
          )}
        </Section>
      )}

      {/* ── Admin: tier management ────────────────────────────────────────── */}
      {profile?.is_admin && (
        <Section
          title="Admin — User Management"
          subtitle="You have admin access. Manage user tiers directly from here."
          tab="profile" activeTab={activeTab}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'var(--accent-lo)',
            border: '1px solid var(--accent-mid)',
            borderRadius: 8,
            marginBottom: '1rem',
          }}>
            <Shield size={14} style={{ color: 'var(--accent)' }}/>
            <span style={{ fontSize: '0.8125rem', color: 'var(--accent)', fontWeight: 500 }}>
              Admin mode active — changes take effect immediately
            </span>
          </div>

          {adminLoading ? (
            <div style={{ color: 'var(--text3)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 14, height: 14, border: '2px solid var(--border2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}/>
              Loading users…
            </div>
          ) : adminUsers !== null && !adminUsers.length ? (
            <div style={{ fontSize: '0.875rem', color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 12 }}>
              No users found — your account may not have is_admin=true in the database yet.
              <button
                onClick={() => {
                  setAdminLoading(true)
                  usersApi.list().then(d => { setAdminUsers(d?.users || []); setAdminLoading(false) }).catch(() => setAdminLoading(false))
                }}
                style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer' }}
              >
                Retry
              </button>
            </div>
          ) : adminUsers?.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {adminUsers.map(user => (
                <div key={user.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  background: 'var(--surface2)',
                  borderRadius: 8,
                  border: user.id === profile?.id ? '1px solid var(--accent-mid)' : '1px solid var(--border)',
                  flexWrap: 'wrap',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--surface3)',
                    border: '1px solid var(--border2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.8125rem', fontWeight: 600,
                    color: 'var(--text2)',
                    flexShrink: 0,
                  }}>
                    {(user.display_name || user.email || '?')[0].toUpperCase()}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.display_name || '(no name)'}
                      {user.id === profile?.id && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--accent)', marginLeft: 6 }}>you</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user.email}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    {['free', 'studio'].map(t => (
                      <button
                        key={t}
                        disabled={tierSaving[user.id]}
                        onClick={() => changeUserTier(user.id, t)}
                        style={{
                          padding: '4px 12px',
                          borderRadius: 6,
                          border: '1px solid',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          fontFamily: 'Figtree, sans-serif',
                          cursor: tierSaving[user.id] ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                          background: (user.tier === t || (t === 'studio' && user.tier === 'pro'))
                            ? (t === 'studio' ? 'var(--accent)' : 'var(--surface3)')
                            : 'transparent',
                          color: (user.tier === t || (t === 'studio' && user.tier === 'pro'))
                            ? (t === 'free' ? 'var(--text)' : '#0a0a0f')
                            : 'var(--text3)',
                          borderColor: (user.tier === t || (t === 'studio' && user.tier === 'pro'))
                            ? (t === 'studio' ? 'var(--accent)' : 'var(--border2)')
                            : 'var(--border)',
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '0.875rem', color: 'var(--text3)' }}>No users loaded — try refreshing.</div>
          )}
        </Section>
      )}

      {/* ── Voice profile ─────────────────────────────────────────────────── */}
      {activeCategoryId && (
        <Section
          title={`Voice profile — ${cat?.name || ''}`}
          subtitle="The more specific you are, the more KB writes in your actual voice rather than generic documentary style." tab="voice" activeTab={activeTab}
        >
          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--accent)',
              marginBottom: '0.75rem',
            }}>Sentence patterns</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.875rem' }}>
              <Field label="Length pattern"   value={voice.sentenceLengthPattern} onChange={setV('sentenceLengthPattern')} placeholder="short punchy bursts then longer reflective ones" />
              <Field label="Typical length"   value={voice.typicalSentenceLength} onChange={setV('typicalSentenceLength')} placeholder="8–12 words" />
              <Field label="Rhythm"           value={voice.rhythmNote}            onChange={setV('rhythmNote')}            placeholder="builds slowly then releases with a short punchy line" />
              <Field label="Vocabulary level" value={voice.vocabularyLevel}       onChange={setV('vocabularyLevel')}       placeholder="conversational, no jargon" />
            </div>
          </div>

          <hr style={{ border:"none", borderTop:"1px solid var(--border)", margin:"1.25rem 0" }}/>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '0.75rem',
            }}>Structure</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.875rem' }}>
              <Field label="Hook style"       value={voice.hookStyle}          onChange={setV('hookStyle')}          placeholder="drops straight into the action" />
              <Field label="Build to reveal"  value={voice.revealBuildPattern} onChange={setV('revealBuildPattern')} placeholder="plants a detail early, pays off two minutes later" />
              <Field label="Open loop"        value={voice.openLoopStyle}      onChange={setV('openLoopStyle')}      placeholder="asks a question, answers it halfway through" />
              <Field label="CTA style"        value={voice.ctaStyle}           onChange={setV('ctaStyle')}           placeholder="low pressure, single ask at the very end" />
            </div>
          </div>

          <hr style={{ border:"none", borderTop:"1px solid var(--border)", margin:"1.25rem 0" }}/>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--accent)', marginBottom: '0.75rem',
            }}>Language fingerprint <span style={{ color: 'var(--text3)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— comma-separated</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0.875rem' }}>
              <Field label="Signature phrases"       wide value={voice.signaturePhrases}  onChange={setV('signaturePhrases')}  placeholder="and that's when it clicked, I wasn't expecting that" hint="Phrases that sound unmistakably like you" />
              <Field label="Characteristic openers"  wide value={voice.sentenceOpeners}   onChange={setV('sentenceOpeners')}   placeholder="So, The thing is, Which meant that, And then" hint="How you tend to start sentences" />
              <Field label="Rhetorical devices"      wide value={voice.rhetoricalDevices} onChange={setV('rhetoricalDevices')} placeholder="rhetorical questions, callbacks, rule of three" />
              <Field label="Phrases to AVOID"        wide value={voice.avoidPhrases}      onChange={setV('avoidPhrases')}      placeholder="dive deep, let's unpack, game-changer, journey" hint="KB will actively avoid these clichés" />
              <Field label="Humour style"                 value={voice.humourStyle}        onChange={setV('humourStyle')}        placeholder="dry, self-deprecating, timing-based" />
              <Field label="Storytelling style"           value={voice.storytellingStyle}  onChange={setV('storytellingStyle')}  placeholder="personal, first-person, present tense" />
            </div>
          </div>

          <button onClick={saveVoiceProfile} disabled={savingVoice} style={{ width:"100%", padding:"0.625rem 1.25rem", borderRadius:"var(--r-sm)", border:"1px solid var(--border2)", background:"var(--active-bg)", color:"var(--text)", cursor:"pointer", fontFamily:"inherit", fontSize:"0.9375rem" }}>
            {savingVoice ? 'Saving…' : 'Save voice profile'}
          </button>
        </Section>
      )}

      {/* ── Notifications ─────────────────────────────────────────────────── */}
      <Section
        title="Notifications"
        subtitle="Get a message in Discord or Slack when a generation completes, even if you've closed the tab."
        tab="notifications" activeTab={activeTab}
      >
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.875rem', color: 'var(--text2)', lineHeight: 1.6 }}>
            Set{' '}
            <code style={{ background: 'var(--surface3)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8125rem', color: 'var(--accent)' }}>DISCORD_WEBHOOK_URL</code>
            {' '}or{' '}
            <code style={{ background: 'var(--surface3)', padding: '2px 6px', borderRadius: 4, fontSize: '0.8125rem', color: 'var(--accent)' }}>SLACK_WEBHOOK_URL</code>
            {' '}in your Railway backend environment variables.
          </p>
        </div>
        <button
          onClick={sendTestWebhook}
          disabled={webhookTesting}
          style={{ display:"inline-flex", alignItems:"center", gap:"0.5rem", padding:"0.625rem 1.25rem", borderRadius:"var(--r-sm)", border:"1px solid var(--border2)", background:"transparent", color:"var(--text2)", cursor:"pointer", fontFamily:"inherit", fontSize:"0.9375rem" }}
        >
          {webhookTesting ? (
            <div style={{ width: 14, height: 14, border: '2px solid var(--text3)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }}/>
          ) : webhookStatus === 'ok' ? (
            <Check size={14} style={{ color: 'var(--green)' }}/>
          ) : webhookStatus === 'error' ? (
            <AlertCircle size={14} style={{ color: 'var(--red)' }}/>
          ) : (
            <Send size={14}/>
          )}
          {webhookTesting ? 'Sending…' : webhookStatus === 'ok' ? 'Sent successfully' : 'Send test notification'}
        </button>
      </Section>

      {/* ── Appearance ────────────────────────────────────────────────────── */}
      <Section title="Appearance" tab="profile" activeTab={activeTab}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--text)' }}>Theme</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text2)', marginTop: 2 }}>Dark recommended for low-light studio use</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['dark', 'light'].map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                style={{ padding:"0.5rem 1.25rem", borderRadius:"var(--r-sm)", border: theme === t ? "1px solid var(--accent-mid)" : "1px solid var(--border2)", background: theme === t ? "var(--accent-lo)" : "transparent", color: theme === t ? "var(--accent)" : "var(--text2)", cursor:"pointer", fontFamily:"inherit", fontSize:"0.875rem", textTransform:"capitalize" }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Account ───────────────────────────────────────────────────────── */}
      <Section title="Danger Zone" tab="danger" activeTab={activeTab} subtitle="These actions are permanent and cannot be undone.">

        {/* Confirm overlay */}
        {confirmAction && (
          <div style={{ marginBottom: 20, padding: '16px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.06)' }}>
            <div style={{ fontSize: 13, color: '#f87171', fontFamily: "'Figtree',sans-serif", marginBottom: 10, fontWeight: 600 }}>
              Are you sure? This cannot be undone.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  if (confirmAction === 'voice') resetVoiceProfile()
                  if (confirmAction === 'data') clearAnalyticsData()
                  if (confirmAction === 'episodes') deleteAllEpisodes()
                }}
                style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: '#f87171', color: '#080808', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", fontWeight: 600 }}
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Reset voice profile */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Reset voice profile</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>KB will re-interview you on next visit. All voice data for this workspace is cleared.</div>
          </div>
          <button
            onClick={() => setConfirmAction('voice')}
            disabled={resettingVoice}
            style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(248,113,113,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", flexShrink: 0, marginLeft: 12 }}
          >
            {resettingVoice ? 'Resetting...' : 'Reset'}
          </button>
        </div>

        {/* Clear test data */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Clear analytics and memory</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>Deletes uploaded analytics data, KB chat history, and all KB learnings for this workspace.</div>
          </div>
          <button
            onClick={() => setConfirmAction('data')}
            disabled={clearingData}
            style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(248,113,113,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", flexShrink: 0, marginLeft: 12 }}
          >
            {clearingData ? 'Clearing...' : 'Clear'}
          </button>
        </div>

        {/* Delete all episodes */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Delete all episodes</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>Permanently deletes all episodes in this workspace including scripts, storyboards, and retention data.</div>
          </div>
          <button
            onClick={() => setConfirmAction('episodes')}
            disabled={deletingEpisodes}
            style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(248,113,113,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", flexShrink: 0, marginLeft: 12 }}
          >
            {deletingEpisodes ? 'Deleting...' : 'Delete all'}
          </button>
        </div>

        {/* Sign out */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif" }}>Sign out</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", marginTop: 2 }}>Sign out of your WhispaCuts account</div>
          </div>
          <button
            onClick={async () => { await signOut(); navigate('/auth') }}
            style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(248,113,113,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree',sans-serif", display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <LogOut size={13}/> Sign out
          </button>
        </div>
      </Section>
      {/* ── Voice Clone ── */}
      <Section icon={<Mic size={16}/>} title="KB Voice Clone" tab="integrations" activeTab={activeTab} subtitle="Train KB to speak in your voice using ElevenLabs. Upload at least 30 minutes of clean audio.">
        {cloneVoiceId ? (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderRadius:8, border:'1px solid rgba(74,222,128,0.2)', background:'rgba(74,222,128,0.04)' }}>
            <span style={{ fontSize:13, color:'rgba(74,222,128,0.8)', fontFamily:"'Figtree',sans-serif" }}>✓ Voice clone active</span>
            <span style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", fontFamily:'monospace' }}>{cloneVoiceId}</span>
            <label style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, padding:'5px 10px', borderRadius:6, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'rgba(255,255,255,0.4)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:11, fontFamily:"'Figtree',sans-serif" }}>
              {cloningVoice ? 'Uploading...' : 'Re-train'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
          </div>
        ) : (
          <div>
            <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: cloningVoice ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
              <Upload size={12}/>
              {cloningVoice ? 'Training voice clone...' : 'Upload voice sample'}
              <input type="file" accept="audio/*,.mp3,.m4a,.wav" onChange={handleVoiceClone} disabled={cloningVoice} style={{ display:'none' }}/>
            </label>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
              MP3, M4A, or WAV. Minimum 30 minutes of clean speech. No music or background noise.
            </div>
          </div>
        )}
      </Section>

      {/* ── Reaction Images ── */}
      <Section icon={<User size={16}/>} title="Thumbnail Reaction Images" tab="integrations" activeTab={activeTab} subtitle="Upload photos of your reactions for thumbnail generation. Tag each one so KB can select the right expression.">
        <div style={{ marginBottom:12 }}>
          <label style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'8px 14px', borderRadius:8, background:'rgba(74,222,128,0.07)', border:'1px solid rgba(74,222,128,0.2)', color:'rgba(74,222,128,0.8)', cursor: uploadingReaction ? 'wait' : 'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}>
            <Upload size={12}/>
            {uploadingReaction ? 'Uploading...' : 'Upload reaction photos'}
            <input type="file" accept="image/*" multiple onChange={handleReactionUpload} disabled={uploadingReaction} style={{ display:'none' }}/>
          </label>
          <div style={{ fontSize:11, color:'rgba(255,255,255,0.25)', fontFamily:"'Figtree',sans-serif", marginTop:6 }}>
            JPG or PNG. Name files by expression (e.g. "surprised.jpg", "confident.jpg") for auto-tagging.
          </div>
        </div>

        {reactionImages.length === 0 && (
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.2)', fontFamily:"'Figtree',sans-serif", fontStyle:'italic' }}>
            No reaction images yet. Upload photos of yourself that KB can reference when generating thumbnail prompts.
          </div>
        )}

        <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap:10 }}>
          {reactionImages.map(img => (
            <div key={img.id} style={{ borderRadius:8, overflow:'hidden', border:'1px solid rgba(255,255,255,0.07)', background:'rgba(255,255,255,0.02)' }}>
              <div style={{ aspectRatio:'1', overflow:'hidden', background:'#111' }}>
                <img src={img.storage_url} alt={img.tag} style={{ width:'100%', height:'100%', objectFit:'cover' }}/>
              </div>
              <div style={{ padding:'6px 8px' }}>
                <input
                  value={img.tag}
                  onChange={e => updateReactionTag(img.id, e.target.value)}
                  placeholder="Tag (e.g. surprised)"
                  style={{ width:'100%', background:'transparent', border:'none', borderBottom:'1px solid rgba(255,255,255,0.08)', color:'rgba(255,255,255,0.6)', fontSize:11, fontFamily:"'Figtree',sans-serif", outline:'none', padding:'2px 0', boxSizing:'border-box' }}
                />
              </div>
            </div>
          ))}
        </div>
      </Section>

    </div>
  )
}
