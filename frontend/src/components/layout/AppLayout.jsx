// frontend/src/components/layout/AppLayout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Sparkles, Film, BookMarked,
  BarChart2, Mic, Music2, Scissors, Smartphone, Settings, LogOut,
  ChevronLeft, ChevronRight, Plus, RefreshCw, MessageSquare, X, Menu
} from 'lucide-react'
import { useStore } from '../../store'
import { categories as catApi } from '../../lib/api'
import { signOut } from '../../lib/supabase'
import ChatPanel from '../chat/ChatPanel'
import Notifications from './Notifications'
import NewCategoryModal from './NewCategoryModal'

const NAV = [
  { to: '/',            icon: LayoutDashboard, label: 'Dashboard'   },
  { to: '/generate',    icon: Sparkles,        label: 'Generate'    },
  { to: '/series',      icon: Film,            label: 'Series'      },
  { to: '/vault',       icon: BookMarked,      label: 'Vault'       },
  { to: '/analytics',   icon: BarChart2,       label: 'Analytics'   },
  { to: '/teleprompter',icon: Mic,             label: 'Teleprompter'},
  { to: '/sound',       icon: Music2,          label: 'Sound'       },
  { to: '/editor',      icon: Scissors,        label: 'Editor'      },
]

const TIER_STYLES = {
  studio: 'border-[#c8b89a]/60 text-[#c8b89a] bg-[#c8b89a]/10',
  pro:    'border-blue-500/60 text-blue-400 bg-blue-500/10',
  free:   'border-[#444] text-[#888] bg-[#111]',
}

export default function AppLayout() {
  const {
    categories, activeCategoryId, setActiveCategory, loadCategories,
    sidebarCollapsed, setSidebarCollapsed, chatOpen, setChatOpen,
    profile, setCurrentMode, notifications, notify
  } = useStore()

  const [showNewCat, setShowNewCat] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const navigate = useNavigate()
  const activeCategory = categories.find(c => c.id === activeCategoryId)

  // Derive tier safely — always fall back to 'free'
  const tier = profile?.tier || 'free'
  const tierStyle = TIER_STYLES[tier] || TIER_STYLES.free
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1)

  useEffect(() => { loadCategories() }, [])

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false) }, [activeCategoryId])

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  async function handleCategorySwitch(id) {
    await setActiveCategory(id)
    notify(`Switched to ${categories.find(c=>c.id===id)?.name}`, 'info', 2000)
    setMobileMenuOpen(false)
  }

  async function handleManualRefresh() {
    if (!activeCategoryId) return
    notify('Refreshing trending data...', 'info', 2000)
    try {
      await catApi.refresh(activeCategoryId)
      await loadCategories()
      notify('Trending data updated', 'success')
    } catch (err) {
      notify('Refresh failed: ' + err.message, 'error')
    }
  }

  const SidebarContent = ({ mobile = false }) => (
    <>
      {/* Category Switcher */}
      <div className="p-3 border-b border-[#1a1a1a]">
        <div className="text-[10px] text-[#555] uppercase tracking-widest mb-2 font-medium">Category</div>
        <div className="space-y-0.5">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => handleCategorySwitch(cat.id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-all ${
                cat.id === activeCategoryId
                  ? 'bg-[#c8b89a]/10 text-[#c8b89a]'
                  : 'text-[#777] hover:text-[#c8b89a] hover:bg-[#111]'
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: cat.color }}
              />
              <span className="truncate">{cat.name}</span>
              {cat._refreshing && (
                <RefreshCw size={10} className="ml-auto animate-spin text-[#c8b89a]/50"/>
              )}
            </button>
          ))}
          <button
            onClick={() => { setShowNewCat(true); setMobileMenuOpen(false) }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-[#555] hover:text-[#c8b89a] transition-colors text-sm rounded-md hover:bg-[#111]"
          >
            <Plus size={13}/> New category
          </button>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            onClick={() => { setCurrentMode(label.toLowerCase()); setMobileMenuOpen(false) }}
            className={({ isActive }) => `
              flex items-center gap-3 px-3 py-2.5 rounded-md transition-all text-sm
              ${isActive
                ? 'bg-[#c8b89a]/10 text-[#c8b89a]'
                : 'text-[#666] hover:text-[#c8b89a] hover:bg-[#111]'
              }
            `}
          >
            <Icon size={16} className="shrink-0"/>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="p-2 border-t border-[#1a1a1a] space-y-0.5">
        {/* Tier badge */}
        <div className="px-3 py-2 flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${tierStyle}`}>
            {tierLabel}
          </span>
          <span className="text-[10px] text-[#444]">{profile?.display_name}</span>
        </div>

        {activeCategory && (
          <button
            onClick={handleManualRefresh}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#555] hover:text-[#c8b89a] transition-colors rounded-md hover:bg-[#111]"
          >
            <RefreshCw size={12}/>
            Refresh trends
          </button>
        )}
        <a
          href="/companion"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2.5 rounded-md text-[#666] hover:text-[#c8b89a] hover:bg-[#111] transition-all text-sm"
        >
          <Smartphone size={16} className="shrink-0"/>
          <span>Companion</span>
        </a>
        <NavLink
          to="/settings"
          onClick={() => setMobileMenuOpen(false)}
          className={({ isActive }) => `
            flex items-center gap-3 px-3 py-2.5 rounded-md transition-all text-sm
            ${isActive ? 'text-[#c8b89a] bg-[#c8b89a]/10' : 'text-[#666] hover:text-[#c8b89a] hover:bg-[#111]'}
          `}
        >
          <Settings size={16}/>
          <span>Settings</span>
        </NavLink>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-[#666] hover:text-red-400 transition-colors rounded-md hover:bg-[#111] text-sm"
        >
          <LogOut size={16}/>
          <span>Sign out</span>
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen bg-[#080808] flex text-[#f0ede8]">

      {/* ── DESKTOP SIDEBAR ── */}
      <aside className={`
        hidden md:flex flex-col border-r border-[#1a1a1a] transition-all duration-300 shrink-0
        ${sidebarCollapsed ? 'w-16' : 'w-56'}
      `}>
        {/* Logo + collapse */}
        <div className={`h-14 flex items-center border-b border-[#1a1a1a] px-4 ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
          {!sidebarCollapsed && (
            <span className="text-[#c8b89a] font-serif text-lg tracking-widest">SF</span>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="ml-auto text-[#444] hover:text-[#c8b89a] transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}
          </button>
        </div>

        {sidebarCollapsed ? (
          /* Collapsed: icons only */
          <>
            <nav className="flex-1 p-2 space-y-0.5">
              {NAV.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => setCurrentMode(label.toLowerCase())}
                  className={({ isActive }) => `
                    flex items-center justify-center px-3 py-2.5 rounded-md transition-all
                    ${isActive ? 'bg-[#c8b89a]/10 text-[#c8b89a]' : 'text-[#555] hover:text-[#c8b89a] hover:bg-[#111]'}
                  `}
                  title={label}
                >
                  <Icon size={16}/>
                </NavLink>
              ))}
            </nav>
            <div className="p-2 border-t border-[#1a1a1a] space-y-0.5">
              <NavLink to="/settings" className={({ isActive }) => `flex justify-center px-3 py-2.5 rounded-md transition-all ${isActive ? 'text-[#c8b89a]' : 'text-[#555] hover:text-[#c8b89a]'}`} title="Settings">
                <Settings size={16}/>
              </NavLink>
              <button onClick={handleSignOut} className="w-full flex justify-center px-3 py-2.5 text-[#555] hover:text-red-400 transition-colors rounded-md" title="Sign out">
                <LogOut size={16}/>
              </button>
            </div>
          </>
        ) : (
          <SidebarContent />
        )}
      </aside>

      {/* ── MOBILE MENU OVERLAY ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileMenuOpen(false)}/>
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-[#0a0a0a] border-r border-[#1a1a1a] flex flex-col">
            <div className="h-14 flex items-center px-4 border-b border-[#1a1a1a]">
              <span className="text-[#c8b89a] font-serif text-lg tracking-widest flex-1">SCRIPTFORGE</span>
              <button onClick={() => setMobileMenuOpen(false)} className="text-[#555] hover:text-[#c8b89a]">
                <X size={18}/>
              </button>
            </div>
            <div className="flex-1 flex flex-col overflow-y-auto">
              <SidebarContent mobile />
            </div>
          </aside>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="h-14 border-b border-[#1a1a1a] flex items-center px-4 gap-3 shrink-0">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden text-[#555] hover:text-[#c8b89a] transition-colors p-1"
          >
            <Menu size={20}/>
          </button>

          {activeCategory && (
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: activeCategory.color }}/>
              <span className="text-sm text-[#aaa] truncate">{activeCategory.name}</span>
              <span className="text-[#333] text-sm hidden sm:block">·</span>
              <span className="text-xs text-[#555] truncate hidden sm:block">{activeCategory.niche}</span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-2 shrink-0">
            {/* Tier badge — always visible, always accurate */}
            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${tierStyle}`}>
              {tierLabel}
            </span>

            {/* Chat toggle */}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs transition-all ${
                chatOpen
                  ? 'border-[#c8b89a]/40 text-[#c8b89a] bg-[#c8b89a]/5'
                  : 'border-[#222] text-[#666] hover:border-[#444] hover:text-[#aaa]'
              }`}
            >
              <MessageSquare size={12}/>
              <span className="hidden sm:inline">Claude</span>
            </button>
          </div>
        </header>

        {/* Page + Chat panel */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto p-4 md:p-6">
            <Outlet />
          </div>

          {/* Chat panel — full screen on mobile when open */}
          {chatOpen && (
            <div className="
              fixed inset-0 z-40 md:relative md:inset-auto
              md:w-80 border-l border-[#1a1a1a] shrink-0 flex flex-col
              bg-[#080808]
            ">
              <div className="md:hidden h-14 flex items-center px-4 border-b border-[#1a1a1a]">
                <span className="text-sm text-[#888] flex-1">Claude</span>
                <button onClick={() => setChatOpen(false)} className="text-[#555] hover:text-[#c8b89a]">
                  <X size={18}/>
                </button>
              </div>
              <ChatPanel />
            </div>
          )}
        </div>
      </main>

      {/* Modals + Notifications */}
      <Notifications />
      {showNewCat && (
        <NewCategoryModal
          onClose={() => setShowNewCat(false)}
          onCreated={async () => {
            await loadCategories()
            setShowNewCat(false)
          }}
        />
      )}
    </div>
  )
}