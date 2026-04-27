// frontend/src/components/layout/AppLayout.jsx
// Mobile: slide-out drawer with overlay, hamburger in top bar
// Desktop: collapsible sidebar (icon-only or full)
// Fonts: all nav labels at 1rem, top bar at 0.9375rem

import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import {
  LayoutDashboard, Sparkles, Film, BookMarked,
  BarChart2, Mic, Music2, Scissors, Smartphone, Settings, LogOut,
  ChevronLeft, ChevronRight, Plus, RefreshCw, MessageSquare,
  Calendar, Menu, X,
} from 'lucide-react'
import { useStore } from '../../store'
import { categories as catApi } from '../../lib/api'
import { signOut } from '../../lib/supabase'
import ChatPanel from '../chat/ChatPanel'
import Notifications from './Notifications'
import NewCategoryModal from './NewCategoryModal'

const NAV = [
  { to: '/',             icon: LayoutDashboard, label: 'Dashboard'    },
  { to: '/generate',     icon: Sparkles,        label: 'Generate'     },
  { to: '/series',       icon: Film,            label: 'Series'       },
  { to: '/shorts',       icon: Scissors,        label: 'Shorts'       },
  { to: '/series-bible', icon: BookMarked,      label: 'Bible'        },
  { to: '/vault',        icon: BookMarked,      label: 'Vault'        },
  { to: '/analytics',    icon: BarChart2,       label: 'Analytics'    },
  { to: '/schedule',     icon: Calendar,        label: 'Schedule'     },
  { to: '/teleprompter', icon: Mic,             label: 'Teleprompter' },
  { to: '/sound',        icon: Music2,          label: 'Sound'        },
  { to: '/editor',       icon: Scissors,        label: 'Editor'       },
]

// Shared styles
const NAV_ITEM_BASE = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 14px', borderRadius: 8,
  fontSize: '1rem', fontWeight: 400,
  textDecoration: 'none', transition: 'all 0.15s',
  cursor: 'pointer', border: 'none', background: 'none',
  width: '100%', textAlign: 'left',
}
const NAV_ACTIVE   = { ...NAV_ITEM_BASE, background: 'rgba(255,255,255,0.08)', color: '#ffffff', fontWeight: 500 }
const NAV_INACTIVE = { ...NAV_ITEM_BASE, color: 'var(--text3)' }

export default function AppLayout() {
  const {
    categories, activeCategoryId, setActiveCategory, loadCategories,
    sidebarCollapsed, setSidebarCollapsed, chatOpen, setChatOpen,
    profile, setCurrentMode, notify,
  } = useStore()

  const [showNewCat,   setShowNewCat]   = useState(false)
  const [mobileOpen,   setMobileOpen]   = useState(false)
  const [isMobile,     setIsMobile]     = useState(false)
  const navigate = useNavigate()
  const activeCategory = categories.find(c => c.id === activeCategoryId)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Close drawer on route change (mobile)
  useEffect(() => { setMobileOpen(false) }, [activeCategoryId])

  useEffect(() => { loadCategories() }, [])

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
          height: 64, display: 'flex', alignItems: 'center', padding: '0 16px',
          borderBottom: '1px solid var(--border)', gap: 10, flexShrink: 0,
          justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start',
        }}>
          <img src="/icon-mark.svg" alt="WhispaCuts" style={{ width: 34, height: 34, flexShrink: 0 }}/>
          {showLabels && (
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 19, letterSpacing: '-0.4px', color: 'var(--text)' }}>
              Whispa<span style={{ color: 'var(--accent)' }}>Cuts</span>
            </span>
          )}
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
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => { setCurrentMode(label.toLowerCase()); setMobileOpen(false) }}
              style={({ isActive }) => ({
                ...( isActive ? NAV_ACTIVE : NAV_INACTIVE ),
                justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start',
                padding: (!showLabels && !isMobile) ? '10px' : '10px 14px',
              })}
              title={(!showLabels && !isMobile) ? label : undefined}
            >
              <Icon size={20} style={{ flexShrink: 0 }}/>
              {showLabels && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div style={{ padding: '8px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
          {activeCategory && showLabels && (
            <button
              onClick={handleManualRefresh}
              style={{ ...NAV_INACTIVE, justifyContent: 'flex-start' }}
            >
              <RefreshCw size={18}/> <span>Refresh trends</span>
            </button>
          )}
          <a
            href="/companion" target="_blank" rel="noopener noreferrer"
            style={{ ...NAV_INACTIVE, justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start', padding: (!showLabels && !isMobile) ? '10px' : '10px 14px' }}
            title={(!showLabels && !isMobile) ? 'Companion' : undefined}
          >
            <Smartphone size={20} style={{ flexShrink: 0 }}/>
            {showLabels && <span>Companion</span>}
          </a>
          <NavLink
            to="/settings"
            onClick={() => setMobileOpen(false)}
            style={({ isActive }) => ({
              ...(isActive ? NAV_ACTIVE : NAV_INACTIVE),
              justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start',
              padding: (!showLabels && !isMobile) ? '10px' : '10px 14px',
            })}
          >
            <Settings size={20} style={{ flexShrink: 0 }}/>
            {showLabels && <span>Settings</span>}
          </NavLink>
          <button
            onClick={handleSignOut}
            style={{ ...NAV_INACTIVE, color: 'var(--text3)', justifyContent: (!showLabels && !isMobile) ? 'center' : 'flex-start', padding: (!showLabels && !isMobile) ? '10px' : '10px 14px' }}
            onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text3)'}
          >
            <LogOut size={20} style={{ flexShrink: 0 }}/>
            {showLabels && <span>Sign out</span>}
          </button>

          {/* Profile strip */}
          {showLabels && (
            <div style={{ margin: '6px 4px 0', padding: '10px 12px', background: 'var(--surface2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', fontWeight: 700, color: 'var(--text2)', flexShrink: 0 }}>
                {(profile?.display_name || profile?.email || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {profile?.display_name || 'You'}
                </div>
                <span style={{
                  fontSize: '0.75rem', padding: '1px 7px', borderRadius: 99,
                  border: profile?.tier === 'studio' ? '1px solid var(--accent-mid)' : profile?.tier === 'pro' ? '1px solid rgba(96,165,250,0.4)' : '1px solid var(--border2)',
                  color: profile?.tier === 'studio' ? 'var(--accent)' : profile?.tier === 'pro' ? '#60a5fa' : 'var(--text3)',
                  background: profile?.tier === 'studio' ? 'var(--accent-lo)' : 'transparent',
                }}>
                  {profile?.tier || 'free'}
                </span>
              </div>
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
        }}>
          <SidebarContent/>
        </aside>
      )}

      {/* ── MAIN ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Top bar */}
        <header style={{
          height: 56, borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center',
          padding: '0 20px', gap: 12, flexShrink: 0,
          background: 'var(--surface)',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: activeCategory.color, flexShrink: 0 }}/>
              <span style={{ fontSize: '0.9375rem', color: 'var(--text2)' }}>{activeCategory.name}</span>
              {activeCategory.niche && (
                <span style={{ fontSize: '0.875rem', color: 'var(--text3)' }}>· {activeCategory.niche}</span>
              )}
            </div>
          )}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.9375rem', color: 'var(--text2)' }}>{profile?.display_name}</span>
            <span style={{
              fontSize: '0.8125rem', padding: '2px 9px', borderRadius: 99,
              border: profile?.tier === 'studio' ? '1px solid var(--accent-mid)' : profile?.tier === 'pro' ? '1px solid rgba(96,165,250,0.4)' : '1px solid var(--border2)',
              color: profile?.tier === 'studio' ? 'var(--accent)' : profile?.tier === 'pro' ? '#60a5fa' : 'var(--text3)',
            }}>
              {profile?.tier || 'free'}
            </span>
            <button
              onClick={() => setChatOpen(!chatOpen)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                fontSize: '0.9375rem', fontFamily: 'inherit',
                border: chatOpen ? '1px solid var(--accent-mid)' : '1px solid var(--border2)',
                background: chatOpen ? 'var(--accent-lo)' : 'transparent',
                color: chatOpen ? 'var(--accent)' : 'var(--text3)',
                transition: 'all 0.15s',
              }}
            >
              <MessageSquare size={15}/>
              {!isMobile && 'Claude'}
            </button>
          </div>
        </header>

        {/* Content + chat */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 16px' : '28px 32px' }}>
            <Outlet/>
          </div>
          {chatOpen && !isMobile && (
            <div style={{ width: 320, borderLeft: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
              <ChatPanel/>
            </div>
          )}
          {chatOpen && isMobile && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 45, background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '1rem', fontWeight: 600 }}>Claude</span>
                <button onClick={() => setChatOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex' }}>
                  <X size={20}/>
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <ChatPanel/>
              </div>
            </div>
          )}
        </div>
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