// frontend/src/components/layout/AppLayout.jsx
// Mobile: slide-out drawer with overlay, hamburger in top bar
// Desktop: collapsible sidebar (icon-only or full)
// Fonts: all nav labels at 1rem, top bar at 0.9375rem

import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import {
  LayoutDashboard, Sparkles, Film, BookMarked,
  BarChart2, Mic, Music2, Scissors, Smartphone, Settings, LogOut,
  ChevronLeft, ChevronRight, Plus, RefreshCw, MessageSquare,
  Calendar, Menu, X, FileText, CreditCard, Radio,
} from 'lucide-react'
import KBOrb from '../chat/KBOrb'
import { useStore } from '../../store'
import { categories as catApi } from '../../lib/api'
import { signOut } from '../../lib/supabase'
import ChatPanel from '../chat/ChatPanel'
import Notifications from './Notifications'
import NewCategoryModal from './NewCategoryModal'

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { to: '/',          icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/companion', icon: Radio,           label: 'Companion' },  // START HERE
    ]
  },
  {
    label: null,
    items: [],
    isRefresh: true,
  },
  {
    label: 'Step 1 — Ideate',
    items: [
      { to: '/generate', icon: Sparkles, label: 'Generate'  },
    ]
  },
  {
    label: 'Step 2 — Record',
    items: [
      { to: '/teleprompter', icon: Mic,      label: 'Teleprompter' },
      { to: '/storyboard',   icon: Film,     label: 'Shot List'    },
    ]
  },
  {
    label: 'Step 3 — Edit',
    items: [
      { to: '/editor',  icon: Scissors, label: 'Editor' },
      { to: '/shorts',  icon: Scissors, label: 'Shorts' },
      { to: '/sound',   icon: Music2,   label: 'Sound'  },
    ]
  },
  {
    label: 'Step 4 — Publish',
    items: [
      { to: '/schedule',  icon: Calendar,  label: 'Schedule'  },
      { to: '/analytics', icon: BarChart2, label: 'Analytics' },
    ]
  },
  {
    label: 'Library',
    items: [
      { to: '/series',       icon: Film,       label: 'Series'  },
      { to: '/scripts',      icon: FileText,   label: 'Scripts' },
      { to: '/series-bible', icon: BookMarked, label: 'Bible'   },
      { to: '/vault',        icon: BookMarked, label: 'Vault'   },
      { to: '/journals',     icon: Mic,        label: 'Journals'},
    ]
  },
]
const NAV = NAV_GROUPS.flatMap(g => g.items)

// ─── NAV STYLES ───────────────────────────────────────────────────────────────
const NAV_BASE = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '8px 12px', borderRadius: 8,
  fontSize: '0.875rem', fontWeight: 400,
  textDecoration: 'none', transition: 'all 0.15s',
  cursor: 'pointer', border: 'none', background: 'none',
  width: '100%', textAlign: 'left', fontFamily: 'inherit',
}
// Primary actions — Dashboard & Generate — get a tinted background to stand out
const NAV_PRIMARY_ACTIVE   = { ...NAV_BASE, background: 'rgba(212,168,83,0.14)', color: '#d4a853', fontWeight: 600, border: '1px solid rgba(212,168,83,0.2)' }
const NAV_PRIMARY_INACTIVE = { ...NAV_BASE, color: 'rgba(255,255,255,0.55)', border: '1px solid transparent' }
// Regular nav items
const NAV_ACTIVE   = { ...NAV_BASE, background: 'rgba(255,255,255,0.07)', color: '#e8eaed', fontWeight: 500 }
const NAV_INACTIVE = { ...NAV_BASE, color: 'rgba(255,255,255,0.4)', border: '1px solid transparent' }

// ─── NAV GROUP ────────────────────────────────────────────────────────────────
function NavGroup({ group, showLabels, isMobile, setCurrentMode, setMobileOpen }) {
  const [open, setOpen] = useState(false)
  const hasLabel = group.label && showLabels
  const isPrimary = !group.label && !group.isRefresh  // top group — Dashboard + Generate

  return (
    <div style={{ marginBottom: hasLabel ? 2 : 0 }}>
      {/* Section label — clickable to expand/collapse */}
      {hasLabel && (
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: '8px 12px 4px', background: 'none', border: 'none',
            cursor: 'pointer', color: 'rgba(255,255,255,0.25)',
            fontSize: '0.625rem', letterSpacing: '0.1em', textTransform: 'uppercase',
            fontFamily: 'inherit', marginTop: 6,
          }}
        >
          {group.label}
          <ChevronRight size={10} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: '0.15s', opacity: 0.5 }}/>
        </button>
      )}

      {/* Refresh trends button */}
      {group.isRefresh && showLabels && (
        <button
          onClick={() => document.dispatchEvent(new CustomEvent('wc:refresh-trends'))}
          style={{ ...NAV_INACTIVE, justifyContent: 'flex-start' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.65)'; e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'none' }}
        >
          <RefreshCw size={16} style={{ flexShrink: 0 }}/>
          {showLabels && <span>Refresh trends</span>}
        </button>
      )}

      {/* Nav items */}
      {!group.isRefresh && (open || !hasLabel) && group.items.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={() => { setCurrentMode(label.toLowerCase()); setMobileOpen(false) }}
          style={({ isActive }) => {
            const iconOnly = !showLabels && !isMobile
            const base = isPrimary
              ? (isActive ? NAV_PRIMARY_ACTIVE : NAV_PRIMARY_INACTIVE)
              : (isActive ? NAV_ACTIVE : NAV_INACTIVE)
            return {
              ...base,
              justifyContent: iconOnly ? 'center' : 'flex-start',
              padding: iconOnly ? '9px' : '8px 12px',
            }
          }}
          title={(!showLabels && !isMobile) ? label : undefined}
          onMouseEnter={e => {
            if (!e.currentTarget.dataset.active) {
              e.currentTarget.style.color = isPrimary ? '#d4a853' : 'rgba(255,255,255,0.75)'
              e.currentTarget.style.background = isPrimary ? 'rgba(212,168,83,0.08)' : 'rgba(255,255,255,0.04)'
            }
          }}
          onMouseLeave={e => {
            if (!e.currentTarget.dataset.active) {
              e.currentTarget.style.color = ''
              e.currentTarget.style.background = ''
            }
          }}
        >
          <Icon size={16} style={{ flexShrink: 0 }}/>
          {showLabels && <span style={{ letterSpacing: isPrimary ? '-0.01em' : 'normal' }}>{label}</span>}
        </NavLink>
      ))}
    </div>
  )
}

export default function AppLayout() {
  const {
    categories, activeCategoryId, setActiveCategory, loadCategories,
    sidebarCollapsed, setSidebarCollapsed, chatOpen, setChatOpen,
    profile, setCurrentMode, notify, categoryLoading,
  } = useStore()

  const location     = useLocation()
  const isCompanion  = location.pathname === '/companion'

  const [showNewCat,   setShowNewCat]   = useState(false)
  const [mobileOpen,   setMobileOpen]   = useState(false)
  const [isMobile,     setIsMobile]     = useState(false)
  const [bottomOpen,   setBottomOpen]   = useState(false)
  const navigate = useNavigate()
  const activeCategory = categories.find(c => c.id === activeCategoryId)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Listen for kb:open event (from Dashboard New Episode button)
  useEffect(() => {
    const handler = () => setChatOpen(true)
    window.addEventListener('kb:open', handler)
    return () => window.removeEventListener('kb:open', handler)
  }, [])

  // Close drawer on route change (mobile)
  useEffect(() => { setMobileOpen(false) }, [activeCategoryId])

  useEffect(() => { loadCategories() }, [])

  useEffect(() => {
    const handler = () => handleManualRefresh()
    document.addEventListener('wc:refresh-trends', handler)
    return () => document.removeEventListener('wc:refresh-trends', handler)
  }, [activeCategoryId])

  async function handleSignOut() { await signOut(); navigate('/auth') }

  async function handleCategorySwitch(id) {
    await setActiveCategory(id)
    setMobileOpen(false)
    notify(`Switched to ${categories.find(c => c.id === id)?.name}`, 'info', 2000)
  }

  async function handleManualRefresh() {
    if (!activeCategoryId) return
    notify('Refreshing trending data...', 'info', 2000)
    try { await catApi.refresh(activeCategoryId); await loadCategories(); notify('Updated', 'success') }
    catch (err) { notify('Refresh failed: ' + err.message, 'error') }
  }

  // Whether sidebar shows labels (desktop expanded, or mobile drawer)
  const showLabels = isMobile ? true : !sidebarCollapsed

  // ── SIDEBAR CONTENT (shared between desktop sidebar and mobile drawer) ──────
  function SidebarContent() {
    return (
      <>
        {/* Logo */}
        <div style={{
          height: 64, display: 'flex', alignItems: 'center', padding: '0 12px',
          borderBottom: '1px solid var(--border)', gap: 8, flexShrink: 0,
          justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start',
          overflow: 'hidden',
        }}>
          <img src="/icon-mark.svg" alt="WhispaCuts" style={{ width: 30, height: 30, flexShrink: 0 }}/>
          {/* Collapse toggle — desktop only */}
          {!isMobile && (
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4, display: 'flex' }}
            >
              {sidebarCollapsed ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
            </button>
          )}
          {/* Close button — mobile only */}
          {isMobile && (
            <button
              onClick={() => setMobileOpen(false)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 4, display: 'flex' }}
            >
              <X size={20}/>
            </button>
          )}
        </div>

        {/* Category switcher */}
        {showLabels && (
          <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 8, paddingLeft: 4 }}>
              Workspace
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleCategorySwitch(cat.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: '0.9375rem', fontFamily: 'inherit', textAlign: 'left', width: '100%',
                    background: cat.id === activeCategoryId ? 'rgba(255,255,255,0.08)' : 'transparent',
                    color: cat.id === activeCategoryId ? '#fff' : 'var(--text3)',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: cat.color, flexShrink: 0 }}/>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</span>
                  {cat._refreshing && <RefreshCw size={11} style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }}/>}
                </button>
              ))}
              <button
                onClick={() => setShowNewCat(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: '1px dashed var(--border2)', cursor: 'pointer', fontSize: '0.9375rem', fontFamily: 'inherit', background: 'transparent', color: 'var(--text3)', width: '100%', marginTop: 2 }}
              >
                <Plus size={14}/> New workspace
              </button>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV_GROUPS.map((group, gi) => (
            <NavGroup key={gi} group={group} showLabels={showLabels} isMobile={isMobile}
              setCurrentMode={setCurrentMode} setMobileOpen={setMobileOpen}/>
          ))}
        </nav>

        {/* Bottom */}
        <div style={{ padding: '8px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>

          {/* Collapsible group toggle */}
          <button
            onClick={() => setBottomOpen(o => !o)}
            style={{
              ...NAV_INACTIVE,
              justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start',
              padding: (!showLabels && !isMobile) ? '10px' : '8px 14px',
              width: '100%', textAlign: 'left',
            }}
          >
            <Settings size={18} style={{ flexShrink: 0 }}/>
            {showLabels && (
              <>
                <span style={{ flex: 1 }}>More</span>
                <span style={{ fontSize: 10, opacity: 0.4, marginLeft: 'auto' }}>{bottomOpen ? '▲' : '▼'}</span>
              </>
            )}
          </button>

          {/* Collapsible items */}
          {bottomOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden', animation: 'fadeIn 0.15s ease' }}>
              <NavLink
                to="/billing"
                onClick={() => setMobileOpen(false)}
                style={({ isActive }) => ({
                  ...(isActive ? NAV_ACTIVE : NAV_INACTIVE),
                  justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start',
                  padding: (!showLabels && !isMobile) ? '10px' : '8px 14px',
                })}
              >
                <CreditCard size={18} style={{ flexShrink: 0 }}/>
                {showLabels && <span>Billing</span>}
              </NavLink>

              <NavLink
                to="/settings"
                onClick={() => setMobileOpen(false)}
                style={({ isActive }) => ({
                  ...(isActive ? NAV_ACTIVE : NAV_INACTIVE),
                  justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start',
                  padding: (!showLabels && !isMobile) ? '10px' : '8px 14px',
                })}
              >
                <Settings size={18} style={{ flexShrink: 0 }}/>
                {showLabels && <span>Settings</span>}
              </NavLink>
            </div>
          )}

          {/* Profile strip — name + tier only, no avatar */}
          {showLabels && (
            <div style={{ margin: '6px 4px 0', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.display_name || 'You'}
              </div>
              <span style={{
                fontSize: '0.7rem', padding: '2px 8px', borderRadius: 99, flexShrink: 0,
                border: profile?.tier === 'studio' ? '1px solid var(--accent-mid)' : profile?.tier === 'pro' ? '1px solid rgba(96,165,250,0.4)' : '1px solid var(--border2)',
                color: profile?.tier === 'studio' ? 'var(--accent)' : profile?.tier === 'pro' ? '#60a5fa' : 'var(--text3)',
                background: profile?.tier === 'studio' ? 'var(--accent-lo)' : 'transparent',
              }}>
                {profile?.tier || 'free'}
              </span>
            </div>
          )}
        </div>
      </>
    )
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', color: 'var(--text)' }}>

      {/* ── MOBILE OVERLAY ── */}
      {isMobile && mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, backdropFilter: 'blur(2px)' }}
        />
      )}

      {/* ── SIDEBAR (desktop) / DRAWER (mobile) ── */}
      {isMobile ? (
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
          width: 280, background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <SidebarContent/>
        </div>
      ) : (
        <aside style={{
          width: sidebarCollapsed ? 64 : 240,
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column',
          flexShrink: 0,
          transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          position: 'sticky',
          top: 0,
          height: '100vh',
          alignSelf: 'flex-start',
        }}>
          <SidebarContent/>
        </aside>
      )}

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'auto' }}>

        {/* Top bar — sticky so it stays at top while content scrolls */}
        <header style={{
          height: 56, borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
          padding: '0 20px', gap: 12, flexShrink: 0,
          background: 'var(--surface)',
          position: 'sticky', top: 0, zIndex: 30,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}>
          {/* Hamburger — mobile only */}
          {isMobile && (
            <button
              onClick={() => setMobileOpen(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', padding: 4, display: 'flex', marginRight: 4 }}
            >
              <Menu size={22}/>
            </button>
          )}

          {activeCategory && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: activeCategory.color, flexShrink: 0 }}/>
              <span style={{ fontSize: isMobile ? '0.875rem' : '0.9375rem', color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeCategory.name}
              </span>
              {!isMobile && activeCategory.niche && (
                <span style={{ fontSize: '0.875rem', color: 'var(--text3)', flexShrink: 0 }}>· {activeCategory.niche}</span>
              )}
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {!isMobile && (
              <span style={{ fontSize: '0.9375rem', color: 'var(--text2)' }}>{profile?.display_name}</span>
            )}
            {/* KB chat button — mobile only (orb is hidden on mobile) */}
            {isMobile && (
              <button
                onClick={() => setChatOpen(o => !o)}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  border: chatOpen ? '1px solid rgba(74,222,128,0.5)' : '1px solid rgba(255,255,255,0.1)',
                  background: chatOpen ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)',
                  color: chatOpen ? 'rgba(74,222,128,1)' : 'var(--text3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
                title="KB chat"
              >
                <MessageSquare size={14}/>
              </button>
            )}
            <span style={{
              fontSize: '0.8125rem', padding: '2px 8px', borderRadius: 99,
              border: profile?.tier === 'studio' ? '1px solid var(--accent-mid)' : profile?.tier === 'pro' ? '1px solid rgba(96,165,250,0.4)' : '1px solid var(--border2)',
              color: profile?.tier === 'studio' ? 'var(--accent)' : profile?.tier === 'pro' ? '#60a5fa' : 'var(--text3)',
            }}>
              {profile?.tier || 'free'}
            </span>
          </div>
        </header>

        {/* Content — full width always */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '28px 32px' }}>
            {categoryLoading
              ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
                  <div style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
                </div>
              : <Outlet/>
            }
          </div>
        </div>

        {/* Backdrop blur overlay — dims and blurs content when KB is open */}
        {!isCompanion && chatOpen && (
          <div
            onClick={() => setChatOpen(false)}
            style={{
              position:   'fixed',
              inset:      0,
              zIndex:     39,
              background: 'rgba(6,8,14,0.45)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              transition: 'opacity 0.3s',
            }}
          />
        )}

        {/* KB sheet — hidden on companion route */}
        {!isCompanion && (
          <div style={{
            position:   'fixed',
            left:       isMobile ? 24 : (sidebarCollapsed ? 64 : 240),
            right:      24,
            bottom:     0,
            height:     chatOpen ? '72vh' : '0',
            overflow:   'hidden',
            transition: 'height 0.4s cubic-bezier(0.32, 0.72, 0, 1), left 0.25s cubic-bezier(0.4,0,0.2,1)',
            zIndex:     40,
            background: 'rgba(10,12,18,0.97)',
            borderRadius: '16px 16px 0 0',
            boxShadow:  chatOpen ? '0 -2px 0 rgba(74,222,128,0.6), 0 -20px 60px rgba(74,222,128,0.04), -8px 0 40px rgba(0,0,0,0.4), 8px 0 40px rgba(0,0,0,0.4), 0 -40px 120px rgba(0,0,0,0.8)' : 'none',
            backdropFilter: 'blur(20px)',
          }}>
            {chatOpen && <ChatPanel/>}
          </div>
        )}

        {/* Floating KB orb — hidden on companion route and on mobile */}
        {!isCompanion && !isMobile && (
          <KBOrb
            mood={chatOpen ? 'active' : 'idle'}
            onClick={() => setChatOpen(!chatOpen)}
            isOpen={chatOpen}
            offsetBottom={chatOpen ? 'calc(72vh + 16px)' : '32px'}
          />
        )}
      </main>

      <Notifications/>
      {showNewCat && (
        <NewCategoryModal
          onClose={() => setShowNewCat(false)}
          onCreated={async () => { await loadCategories(); setShowNewCat(false) }}
        />
      )}
    </div>
  )
}