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
  { to: '/companion',    icon: Radio,      label: 'Companion',   newTab: true },
  { to: '/teleprompter', icon: Mic,        label: 'Teleprompter' },
  { to: '/storyboard',   icon: Film,       label: 'Shot List'    },
  { to: '/editor',       icon: Scissors,   label: 'Editor'       },
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
  const [sidebarOpen,  setSidebarOpen]  = useState(false)
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
  useEffect(() => { setPillExpanded(false); setSidebarOpen(false) }, [location.pathname])

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

  function PillButton({ to, icon: Icon, label, onClick, newTab }) {
    const active = location.pathname === to
    const handleClick = () => {
      if (onClick) { onClick(); return }
      if (newTab) { window.open(to, '_blank'); return }
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

  // ── SIDEBAR CONTENT ────────────────────────────────────────────────────────
  function Sidebar() {
    return (
      <div style={{
        width: 260, height: '100vh', background: 'rgba(8,10,16,0.98)',
        borderRight: '1px solid rgba(74,222,128,0.08)',
        display: 'flex', flexDirection: 'column',
        position: 'fixed', top: 0, left: 0, zIndex: 60,
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        backdropFilter: 'blur(20px)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: '#e8eaed', letterSpacing: '-0.3px' }}>
              WhispaCuts
            </span>
            <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}>
              <X size={16}/>
            </button>
          </div>

          {/* Workspace selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(categories || []).map(cat => (
              <button
                key={cat.id}
                onClick={() => { setActiveCategory(cat.id); setSidebarOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: cat.id === activeCategoryId ? GREEN_LOW : 'transparent',
                  color: cat.id === activeCategoryId ? GREEN : 'rgba(255,255,255,0.5)',
                  textAlign: 'left', transition: 'all 0.15s',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: cat.id === activeCategoryId ? GREEN : '#333', flexShrink: 0 }}/>
                <span style={{ fontSize: 13, fontFamily: "'Figtree', sans-serif" }}>{cat.name}</span>
                {cat.id === activeCategoryId && <span style={{ fontSize: 9, color: 'rgba(74,222,128,0.5)', marginLeft: 'auto' }}>active</span>}
              </button>
            ))}
            <button
              onClick={() => { setShowNewCat(true); setSidebarOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, border: '1px dashed rgba(255,255,255,0.08)', background: 'transparent', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree', sans-serif" }}
            >
              <Plus size={12}/> New workspace
            </button>
          </div>
        </div>

        {/* Refresh trends */}
        <button
          onClick={() => { handleManualRefresh(); setSidebarOpen(false) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree', sans-serif", borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <RefreshCw size={12}/> Refresh trends
        </button>

        {/* Companion shortcut */}
        <button
          onClick={() => { window.open('/companion', '_blank'); setSidebarOpen(false) }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree', sans-serif", borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        >
          <Radio size={12}/> Open Companion
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }}/>

        {/* Advanced / Settings */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            onClick={() => { navigate('/settings'); setSidebarOpen(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree', sans-serif", textAlign: 'left' }}
          >
            <Settings size={13}/> Advanced settings
          </button>
          <button
            onClick={() => { navigate('/billing'); setSidebarOpen(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree', sans-serif", textAlign: 'left' }}
          >
            <ChevronRight size={13}/> Plan & billing
          </button>
          <button
            onClick={signOut}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: 'rgba(255,0,0,0.35)', cursor: 'pointer', fontSize: 12, fontFamily: "'Figtree', sans-serif", textAlign: 'left' }}
          >
            <LogOut size={13}/> Sign out
          </button>
        </div>

        {/* Profile */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: GREEN_LOW, border: `1px solid ${GREEN_MID}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: GREEN, fontWeight: 600 }}>
            {(profile?.display_name || 'U')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#e8eaed', fontFamily: "'Figtree', sans-serif" }}>{profile?.display_name || 'Creator'}</div>
            <div style={{ fontSize: 10, color: GREEN, fontFamily: "'Figtree', sans-serif" }}>{profile?.tier || 'free'}</div>
          </div>
        </div>
      </div>
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
        {/* Expanded more menu — icon grid */}
        {pillExpanded && (
          <div style={{
            background:     'rgba(8,10,16,0.98)',
            border:         '1px solid rgba(74,222,128,0.15)',
            borderRadius:   16,
            boxShadow:      '0 -8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(74,222,128,0.04)',
            backdropFilter: 'blur(20px)',
            overflow:       'hidden',
            width:          isMobile ? 280 : 320,
          }}>
            <div style={{
              display:             'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
            }}>
              {MORE_ITEMS.map((item, i) => {
                const Icon    = item.icon
                const active  = location.pathname === item.to
                const col     = i % 4
                const row     = Math.floor(i / 4)
                const isLast  = i === MORE_ITEMS.length - 1
                return (
                  <button
                    key={item.to}
                    onClick={() => { navigate(item.to); setPillExpanded(false) }}
                    style={{
                      display:        'flex',
                      flexDirection:  'column',
                      alignItems:     'center',
                      justifyContent: 'center',
                      gap:            6,
                      padding:        '16px 8px',
                      background:     active ? 'rgba(74,222,128,0.06)' : 'transparent',
                      border:         'none',
                      borderRight:    col < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      borderBottom:   row === 0 && MORE_ITEMS.length > 4 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                      color:          active ? GREEN : 'rgba(255,255,255,0.5)',
                      cursor:         'pointer',
                      transition:     'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    <Icon size={18}/>
                    <span style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: "'Figtree',sans-serif", whiteSpace: 'nowrap' }}>
                      {item.label}
                    </span>
                  </button>
                )
              })}
              {/* Settings in grid */}
              <button
                onClick={() => { navigate('/settings'); setPillExpanded(false) }}
                style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:6, padding:'16px 8px', background:'transparent', border:'none', borderLeft:'1px solid rgba(255,255,255,0.05)', borderTop: MORE_ITEMS.length > 4 ? '1px solid rgba(255,255,255,0.05)' : 'none', color:'rgba(255,255,255,0.35)', cursor:'pointer', transition:'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <Settings size={18}/>
                <span style={{ fontSize:10, letterSpacing:'0.05em', textTransform:'uppercase', fontFamily:"'Figtree',sans-serif" }}>Settings</span>
              </button>
            </div>
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
          {/* Menu/hamburger */}
          <button
            onClick={() => setSidebarOpen(o => !o)}
            style={{ width: 36, height: 36, borderRadius: 50, background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s' }}
          >
            <Menu size={15}/>
          </button>

          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.06)', margin: '0 2px' }}/>

          {/* KB Orb — inline in pill, small, grows when open */}
          <div
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
          </div>

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

      {/* Sidebar overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 59, backdropFilter: 'blur(2px)' }}
        />
      )}

      <Sidebar/>

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