// frontend/src/components/layout/AppLayout.jsx
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Sparkles, Film, BookMarked,
  BarChart2, Mic, Music2, Scissors, Smartphone, Settings, LogOut,
  ChevronLeft, ChevronRight, Plus, RefreshCw, MessageSquare
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

export default function AppLayout() {
  const {
    categories, activeCategoryId, setActiveCategory, loadCategories,
    sidebarCollapsed, setSidebarCollapsed, chatOpen, setChatOpen,
    profile, setCurrentMode, notifications, notify
  } = useStore()

  const [showNewCat, setShowNewCat] = useState(false)
  const navigate = useNavigate()
  const activeCategory = categories.find(c => c.id === activeCategoryId)

  useEffect(() => { loadCategories() }, [])

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  async function handleCategorySwitch(id) {
    await setActiveCategory(id)
    notify(`Switched to ${categories.find(c=>c.id===id)?.name}`, 'info', 2000)
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

  return (
    <div className="min-h-screen bg-[#080808] flex text-[#f0ede8]">

      {/* ── SIDEBAR ── */}
      <aside className={`
        flex flex-col border-r border-[#1a1a1a] transition-all duration-300 shrink-0
        ${sidebarCollapsed ? 'w-16' : 'w-56'}
      `}>

        {/* Logo */}
        <div className={`h-14 flex items-center border-b border-[#1a1a1a] px-4 ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}>
          {!sidebarCollapsed && (
            <span className="text-[#c8b89a] font-serif text-lg tracking-widest">WC</span>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="ml-auto text-[#444] hover:text-[#c8b89a] transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight size={16}/> : <ChevronLeft size={16}/>}
          </button>
        </div>

        {/* Category Switcher */}
        {!sidebarCollapsed && (
          <div className="p-3 border-b border-[#1a1a1a]">
            <div className="text-[10px] text-[#444] uppercase tracking-widest mb-2">Category</div>
            <div className="space-y-1">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => handleCategorySwitch(cat.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-all ${
                    cat.id === activeCategoryId
                      ? 'bg-[#c8b89a]/10 text-[#c8b89a]'
                      : 'text-[#666] hover:text-[#c8b89a] hover:bg-[#111]'
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
                onClick={() => setShowNewCat(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-[#444] hover:text-[#c8b89a] transition-colors text-sm"
              >
                <Plus size={12}/> New category
              </button>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setCurrentMode(label.toLowerCase())}
              className={({ isActive }) => `
                flex items-center gap-3 px-3 py-2 rounded transition-all
                ${isActive
                  ? 'bg-[#c8b89a]/10 text-[#c8b89a]'
                  : 'text-[#555] hover:text-[#c8b89a] hover:bg-[#111]'
                }
                ${sidebarCollapsed ? 'justify-center' : ''}
              `}
              title={sidebarCollapsed ? label : undefined}
            >
              <Icon size={16} className="shrink-0"/>
              {!sidebarCollapsed && <span className="text-sm">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom actions */}
        <div className="p-2 border-t border-[#1a1a1a] space-y-0.5">
          {/* Refresh indicator */}
          {activeCategory && !sidebarCollapsed && (
            <button
              onClick={handleManualRefresh}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#444] hover:text-[#c8b89a] transition-colors"
            >
              <RefreshCw size={12}/>
              Refresh trends
            </button>
          )}
          {/* Companion app — opens in new tab as PWA */}
          <a
            href="/companion"
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-3 px-3 py-2 rounded text-[#555] hover:text-[#c8b89a] hover:bg-[#111] transition-all ${sidebarCollapsed ? 'justify-center' : ''}`}
            title={sidebarCollapsed ? 'Companion' : undefined}
          >
            <Smartphone size={16} className="shrink-0"/>
            {!sidebarCollapsed && <span className="text-sm">Companion</span>}
          </a>
          <NavLink
            to="/settings"
            className={({ isActive }) => `
              flex items-center gap-3 px-3 py-2 rounded transition-all
              ${isActive ? 'text-[#c8b89a]' : 'text-[#555] hover:text-[#c8b89a] hover:bg-[#111]'}
              ${sidebarCollapsed ? 'justify-center' : ''}
            `}
          >
            <Settings size={16}/>
            {!sidebarCollapsed && <span className="text-sm">Settings</span>}
          </NavLink>
          <button
            onClick={handleSignOut}
            className={`w-full flex items-center gap-3 px-3 py-2 text-[#555] hover:text-red-400 transition-colors rounded ${sidebarCollapsed ? 'justify-center' : ''}`}
          >
            <LogOut size={16}/>
            {!sidebarCollapsed && <span className="text-sm">Sign out</span>}
          </button>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <header className="h-14 border-b border-[#1a1a1a] flex items-center px-6 gap-4 shrink-0">
          {activeCategory && (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: activeCategory.color }}/>
              <span className="text-sm text-[#888]">{activeCategory.name}</span>
              <span className="text-[#333] text-sm">·</span>
              <span className="text-xs text-[#444]">{activeCategory.niche}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Profile */}
            <div className="text-xs text-[#555]">{profile?.display_name}</div>
            <div className="w-1.5 h-1.5 rounded-full bg-[#333]"/>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              profile?.tier === 'studio' ? 'border-[#c8b89a]/40 text-[#c8b89a]' :
              profile?.tier === 'pro'    ? 'border-blue-500/40 text-blue-400' :
              'border-[#333] text-[#555]'
            }`}>
              {profile?.tier || 'free'}
            </span>
            {/* Chat toggle */}
            <button
              onClick={() => setChatOpen(!chatOpen)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs transition-all ${
                chatOpen
                  ? 'border-[#c8b89a]/40 text-[#c8b89a] bg-[#c8b89a]/5'
                  : 'border-[#222] text-[#555] hover:border-[#444] hover:text-[#888]'
              }`}
            >
              <MessageSquare size={12}/>
              Claude
            </button>
          </div>
        </header>

        {/* Page + Chat panel */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto p-6">
            <Outlet />
          </div>

          {/* Chat panel */}
          {chatOpen && (
            <div className="w-80 border-l border-[#1a1a1a] shrink-0 flex flex-col">
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
