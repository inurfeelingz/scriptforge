// frontend/src/components/layout/AppLayout.jsx
// New unified layout:
// - KB chat IS the main screen (replaces Dashboard as home)
// - Sidebar hidden by default, opens on hamburger
// - Floating pill toolbar bottom-center (desktop) / bottom (mobile)
// - Green as primary accent throughout
// - Orb sits above the pill, centered
// - Companion accessible via pill

import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import {
  Mic, Music2, Scissors, Settings, LogOut,
  Plus, RefreshCw, BarChart2, Calendar,
  Menu, X, FileText, Film, BookMarked,
  ChevronRight, Zap, Radio,
} from 'lucide-react'
import KBOrb        from '../chat/KBOrb'
import ChatPanel    from '../chat/ChatPanel'
import { useStore } from '../../store'
import { categories as catApi } from '../../lib/api'
import { signOut }  from '../../lib/supabase'
import Notifications    from './Notifications'
import NewCategoryModal from './NewCategoryModal'

// ── PILL MENU ITEMS ──────────────────────────────────────────────────────────
const PILL_ITEMS = [
  { to: '/teleprompter', icon: Mic,        label: 'Teleprompter' },
  { to: '/storyboard',   icon: Film,       label: 'Shot List'    },
  { to: '/editor',       icon: Scissors,   label: 'Editor'       },
  { to: '/schedule',     icon: Calendar,   label: 'Schedule'     },
  { to: '/analytics',    icon: BarChart2,  label: 'Analytics'    },
]

const MORE_ITEMS = [
  { to: '/series',       icon: Film,       label: 'Series'       },
  { to: '/scripts',      icon: FileText,   label: 'Scripts'      },
  { to: '/series-bible', icon: BookMarked, label: 'Series Bible' },
  { to: '/vault',        icon: BookMarked, label: 'Vault'        },
  { to: '/journals',     icon: Mic,        label: 'Journals'     },
  { to: '/sound',        icon: Music2,     label: 'Sound'        },
  { to: '/shorts',       icon: Zap,        label: 'Shorts'       },
]

const GREEN     = 'rgba(74,222,128,1)'
const GREEN_DIM = 'rgba(74,222,128,0.7)'
const GREEN_LOW = 'rgba(74,222,128,0.08)'
const GREEN_MID = 'rgba(74,222,128,0.2)'

export default function AppLayout() {
  const { profile, activeCategoryId, activeCategory, categories,
          loadCategories, setActiveCategory, notify } = useStore()

  const [chatOpen,     setChatOpen]     = useState(false)
  const [gearOpen,     setGearOpen]     = useState(false)
  const [pillExpanded, setPillExpanded] = useState(false)
  const [isMobile,     setIsMobile]     = useState(false)
  const [showNewCat,   setShowNewCat]   = useState(false)
  const [catLoading,   setCatLoading]   = useState(false)
  const [scrolled,     setScrolled]     = useState(false)

  const location    = useLocation()
  const navigate    = useNavigate()
  const isCompanion = location.pathname === '/companion'
  const isHome      = location.pathname === '/'
  const activeCategory_ = activeCategory?.()
  const pillRef     = useRef(null)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Close pill on outside click
  useEffect(() => {
    if (!pillExpanded) return
    const handler = (e) => {
      if (pillRef.current && !pillRef.current.contains(e.target)) setPillExpanded(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pillExpanded])

  // Close pill on route change
  useEffect(() => { setPillExpanded(false); setGearOpen(false) }, [location.pathname])

  // Listen for kb:open event
  useEffect(() => {
    const handler = () => setChatOpen(true)
    window.addEventListener('kb:open', handler)
    return () => window.removeEventListener('kb:open', handler)
  }, [])

  async function loadCategories_() {
    setCatLoading(true)
    try { await loadCategories() } catch {}
    setCatLoading(false)
  }

  async function handleManualRefresh() {
    if (!activeCategoryId) return
    notify('Refreshing trends...', 'info', 2000)
    try { await catApi.refresh(activeCategoryId); await loadCategories_(); notify('Updated', 'success') }
    catch (err) { notify('Refresh failed: ' + err.message, 'error') }
  }

  function PillButton({ to, icon: Icon, label, onClick }) {
    const active = location.pathname === to
    const handleClick = () => {
      if (onClick) { onClick(); return }
      navigate(to)
      setPillExpanded(false)
    }
    return (
      <button
        onClick={handleClick}
        style={{
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          gap:            4,
          padding:        isMobile ? '8px 12px' : '6px 14px',
          borderRadius:   10,
          border:         'none',
          background:     active ? GREEN_LOW : 'transparent',
          color:          active ? GREEN : 'rgba(255,255,255,0.45)',
          cursor:         'pointer',
          transition:     'all 0.15s',
          whiteSpace:     'nowrap',
          flexShrink:     0,
        }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'rgba(255,255,255,0.8)' }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'rgba(255,255,255,0.45)' }}
      >
        <Icon size={isMobile ? 16 : 14}/>
        <span style={{ fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif" }}>
          {label}
        </span>
      </button>
    )
  }

  // ── GEAR PANEL ────────────────────────────────────────────────────────────
  function GearPanel() {
    if (!gearOpen) return null
    return (
      <>
        {/* Backdrop */}
        <div
          onClick={() => setGearOpen(false)}
          style={{ position:'fixed', inset:0, zIndex:58, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}
        />
        {/* Panel — floats above pill */}
        <div style={{
          position:'fixed', bottom:80, left:'50%', transform:'translateX(-50%)',
          width:'min(340px, calc(100vw - 32px))',
          background:'rgba(8,10,16,0.98)', border:'1px solid rgba(74,222,128,0.12)',
          borderRadius:16, zIndex:59, overflow:'hidden',
          boxShadow:'0 -8px 40px rgba(0,0,0,0.7)',
          backdropFilter:'blur(20px)',
        }}>
          {/* Workspace selector */}
          <div style={{ padding:'16px 16px 12px', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:8, fontFamily:"'Figtree',sans-serif" }}>Workspace</div>
            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
              {(categories || []).map(cat => (
                <button key={cat.id}
                  onClick={() => { setActiveCategory(cat.id); setGearOpen(false) }}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, border:'none', cursor:'pointer', background: cat.id === activeCategoryId ? GREEN_LOW : 'transparent', color: cat.id === activeCategoryId ? GREEN : 'rgba(255,255,255,0.55)', textAlign:'left', transition:'all 0.15s', fontFamily:"'Figtree',sans-serif", fontSize:13 }}
                >
                  <span style={{ width:6, height:6, borderRadius:'50%', background: cat.id === activeCategoryId ? GREEN : '#333', flexShrink:0 }}/>
                  {cat.name}
                  {cat.id === activeCategoryId && <span style={{ fontSize:9, color:'rgba(74,222,128,0.5)', marginLeft:'auto' }}>active</span>}
                </button>
              ))}
              <button
                onClick={() => { setShowNewCat(true); setGearOpen(false) }}
                style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:8, border:'1px dashed rgba(255,255,255,0.08)', background:'transparent', color:'rgba(255,255,255,0.25)', cursor:'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}
              >
                <Plus size={12}/> New workspace
              </button>
            </div>
          </div>

          {/* Actions grid */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
            {[
              { icon: <RefreshCw size={15}/>, label:'Refresh trends', action: () => { handleManualRefresh(); setGearOpen(false) } },
              { icon: <Settings size={15}/>,  label:'Settings',       action: () => { navigate('/settings'); setGearOpen(false) } },
              { icon: <ChevronRight size={15}/>, label:'Plan & billing', action: () => { navigate('/billing'); setGearOpen(false) } },
            ].map((item, i) => (
              <button key={i} onClick={item.action}
                style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, padding:'14px 8px', background:'transparent', border:'none', borderRight: i%2===0 ? '1px solid rgba(255,255,255,0.05)' : 'none', borderBottom: i<2 ? '1px solid rgba(255,255,255,0.05)' : 'none', color:'rgba(255,255,255,0.5)', cursor:'pointer', transition:'background 0.15s', fontFamily:"'Figtree',sans-serif", fontSize:11 }}
                onMouseEnter={e => e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                onMouseLeave={e => e.currentTarget.style.background='transparent'}
              >
                {item.icon}
                <span style={{ textTransform:'uppercase', letterSpacing:'0.05em' }}>{item.label}</span>
              </button>
            ))}
          </div>

          {/* Profile + sign out */}
          <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:28, height:28, borderRadius:'50%', background:GREEN_LOW, border:`1px solid ${GREEN_MID}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:GREEN, fontWeight:600 }}>
                {(profile?.display_name||'U')[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize:12, color:'#e8eaed', fontFamily:"'Figtree',sans-serif" }}>{profile?.display_name||'Creator'}</div>
                <div style={{ fontSize:10, color:GREEN, fontFamily:"'Figtree',sans-serif" }}>{profile?.tier||'free'}</div>
              </div>
            </div>
            <button onClick={signOut}
              style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:7, border:'1px solid rgba(255,0,0,0.2)', background:'transparent', color:'rgba(255,80,80,0.7)', cursor:'pointer', fontSize:12, fontFamily:"'Figtree',sans-serif" }}
            >
              <LogOut size={12}/> Sign out
            </button>
          </div>
        </div>
      </>
    )
  }

  // ── PILL TOOLBAR ───────────────────────────────────────────────────────────
  function PillToolbar() {
    if (isCompanion) return null

    return (
      <div
        ref={pillRef}
        style={{
          position:   'fixed',
          bottom:     chatOpen ? 'calc(72vh + 16px)' : '24px',
          left:       '50%',
          transform:  'translateX(-50%)',
          zIndex:     44,
          transition: 'bottom 0.4s cubic-bezier(0.32,0.72,0,1)',
          display:    'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap:        8,
        }}
      >
        {/* Expanded more menu */}
        {pillExpanded && (
          <div style={{
            background:     'rgba(8,10,16,0.97)',
            border:         `1px solid rgba(74,222,128,0.12)`,
            borderRadius:   16,
            padding:        '8px 4px',
            display:        'flex',
            gap:            0,
            boxShadow:      '0 -8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(74,222,128,0.04)',
            backdropFilter: 'blur(20px)',
            flexWrap:       isMobile ? 'wrap' : 'nowrap',
            maxWidth:       isMobile ? 340 : 'none',
            justifyContent: 'center',
          }}>
            {MORE_ITEMS.map(item => (
              <PillButton key={item.to} {...item}/>
            ))}
          </div>
        )}

        {/* Main pill */}
        <div style={{
          background:     'rgba(8,10,16,0.96)',
          border:         `1px solid rgba(74,222,128,0.15)`,
          borderRadius:   50,
          padding:        '4px 8px',
          display:        'flex',
          alignItems:     'center',
          gap:            0,
          boxShadow:      '0 4px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(74,222,128,0.04), 0 0 20px rgba(74,222,128,0.04)',
          backdropFilter: 'blur(20px)',
        }}>
          {/* Gear icon → opens gear panel */}
          <button
            onClick={() => setGearOpen(o => !o)}
            style={{ width: 36, height: 36, borderRadius: 50, background: gearOpen ? GREEN_LOW : 'none', border: 'none', color: gearOpen ? GREEN : 'rgba(255,255,255,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
          >
            <Settings size={15}/>
          </button>

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 2px' }}/>

          {/* KB Orb — hidden on home (KB is already full screen there) */}
          {!isHome && <div
            onClick={() => setChatOpen(o => !o)}
            style={{
              width:      chatOpen ? 48 : 36,
              height:     chatOpen ? 48 : 36,
              borderRadius: '50%',
              cursor:     'pointer',
              flexShrink: 0,
              transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
              display:    'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow:  chatOpen ? '0 0 16px rgba(74,222,128,0.25)' : 'none',
            }}
          >
            <KBOrb
              mood={chatOpen ? 'active' : 'idle'}
              isOpen={chatOpen}
              audioLevel={0}
              size={chatOpen ? 48 : 34}
            />
          </div>}

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 2px' }}/>

          {/* Pipeline items — hidden on mobile, shown on desktop */}
          {!isMobile && PILL_ITEMS.map(item => (
            <PillButton key={item.to} {...item}/>
          ))}

          {!isMobile && <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 2px' }}/>}

          {/* + more */}
          <button
            onClick={() => setPillExpanded(o => !o)}
            style={{
              width: 36, height: 36, borderRadius: 50,
              background: pillExpanded ? GREEN_LOW : 'none',
              border: pillExpanded ? `1px solid ${GREEN_MID}` : 'none',
              color: pillExpanded ? GREEN : 'rgba(255,255,255,0.35)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
            }}
          >
            <Plus size={15} style={{ transform: pillExpanded ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s' }}/>
          </button>
        </div>
      </div>
    )
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>



      {/* Top bar — minimal */}
      {!isCompanion && (
        <header style={{
          height:       52,
          borderBottom: `1px solid rgba(74,222,128,0.06)`,
          display:      'flex',
          alignItems:   'center',
          padding:      '0 20px',
          gap:          12,
          flexShrink:   0,
          background:   'rgba(8,10,16,0.95)',
          position:     'sticky',
          top:          0,
          zIndex:       30,
          backdropFilter: 'blur(16px)',
        }}>
          {/* Workspace indicator */}
          {/* Logo — click to go home */}
          <button
            onClick={() => navigate('/')}
            style={{ background:'none', border:'none', cursor:'pointer', padding:'0 8px 0 0', flexShrink:0, display:'flex', alignItems:'center', opacity: isHome ? 1 : 0.5, transition:'opacity 0.15s' }}
            title="Home"
          >
            <svg width="28" height="28" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="64" height="64" rx="14" fill="#0a0f14"/>
              <polyline points="10,16 18,46 32,24 46,46 54,16"
                stroke="#4ade80" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
          </button>

          {activeCategory_ && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, flexShrink: 0, boxShadow: `0 0 6px ${GREEN}` }}/>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: "'Figtree', sans-serif" }}>
                {activeCategory_.name}
              </span>
              {!isMobile && activeCategory_.niche && (
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', flexShrink: 0, fontFamily: "'Figtree', sans-serif" }}>
                  · {activeCategory_.niche}
                </span>
              )}
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* Profile name — desktop */}
            {!isMobile && (
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontFamily: "'Figtree', sans-serif" }}>
                {profile?.display_name}
              </span>
            )}
            {/* Tier badge */}
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 99,
              border: `1px solid rgba(74,222,128,0.25)`,
              color: GREEN, fontFamily: "'Figtree', sans-serif",
              background: GREEN_LOW,
            }}>
              {profile?.tier || 'free'}
            </span>
          </div>
        </header>
      )}

      {/* Main content */}
      <main style={{
        flex:     1,
        display:  'flex',
        flexDirection: 'column',
        minWidth: 0,
        // Extra bottom padding so content isn't hidden behind the pill
        paddingBottom: isCompanion ? 0 : 100,
      }}>
        <div style={{
          flex:      1,
          overflowY: 'auto',
          padding:   isCompanion ? 0 : isMobile ? '20px 16px' : '28px 32px',
        }}>
          <Outlet/>
        </div>
      </main>

      {/* KB backdrop */}
      {!isCompanion && chatOpen && (
        <div
          onClick={() => setChatOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 39,
            background: 'rgba(6,8,14,0.55)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        />
      )}

      {/* KB chat sheet */}
      {!isCompanion && (
        <div style={{
          position:   'fixed',
          left:       isMobile ? 12 : '50%',
          right:      isMobile ? 12 : 'auto',
          width:      isMobile ? 'auto' : 'min(860px, calc(100vw - 64px))',
          transform:  isMobile ? 'none' : 'translateX(-50%)',
          bottom:     0,
          height:     chatOpen ? (isMobile ? '82vh' : '75vh') : 0,
          overflow:   'hidden',
          transition: 'height 0.4s cubic-bezier(0.32,0.72,0,1)',
          zIndex:     40,
          background: 'rgba(8,10,16,0.98)',
          borderRadius: '20px 20px 0 0',
          boxShadow: chatOpen
            ? `0 -2px 0 ${GREEN_MID}, 0 -1px 0 rgba(74,222,128,0.5), -8px 0 40px rgba(0,0,0,0.5), 8px 0 40px rgba(0,0,0,0.5), 0 -40px 80px rgba(0,0,0,0.7)`
            : 'none',
          backdropFilter: 'blur(20px)',
        }}>
          {chatOpen && <ChatPanel/>}
        </div>
      )}



      {/* Pill toolbar */}
      <PillToolbar/>

      <GearPanel/>
      <Notifications/>
      {showNewCat && (
        <NewCategoryModal
          onClose={() => setShowNewCat(false)}
          onCreated={async () => { await loadCategories_(); setShowNewCat(false) }}
        />
      )}
    </div>
  )
}