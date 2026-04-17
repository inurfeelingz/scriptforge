// frontend/src/store/index.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { categories as catApi, users as usersApi } from '../lib/api'

export const useStore = create((set, get) => ({
  // ── Theme ────────────────────────────────────────────────
  theme: (() => {
    try { return localStorage.getItem('sf_theme') || 'dark' } catch { return 'dark' }
  })(),
  setTheme: (theme) => {
    try { localStorage.setItem('sf_theme', theme) } catch {}
    // Apply immediately to root element
    document.documentElement.setAttribute('data-theme', theme)
    document.body.setAttribute('data-theme', theme)
    if (theme === 'light') {
      document.documentElement.style.setProperty('--sf-bg',   '#f5f3ef')
      document.documentElement.style.setProperty('--sf-text', '#1a1a1a')
    } else if (theme === 'dim') {
      document.documentElement.style.setProperty('--sf-bg',   '#181c22')
      document.documentElement.style.setProperty('--sf-text', '#e8eaf0')
    } else {
      document.documentElement.style.removeProperty('--sf-bg')
      document.documentElement.style.removeProperty('--sf-text')
    }
    set({ theme })
  },

  // ── Auth ──────────────────────────────────────────────────
  user:    null,
  profile: null,
  session: null,

  setSession: (session) => set({ session, user: session?.user || null }),
  setProfile: (profile) => set({ profile }),

  // ── Categories ────────────────────────────────────────────
  categories:       [],
  activeCategoryId: null,
  categoryLoading:  false,

  setCategories: (categories) => set({ categories }),

  setActiveCategory: async (id) => {
    set({ activeCategoryId: id })
    // Persist choice
    localStorage.setItem('sf_active_category', id)
    // Trigger staleness check + background refresh if needed
    try {
      const { stale, refreshing } = await catApi.switch(id)
      if (refreshing) {
        set(s => ({
          categories: s.categories.map(c =>
            c.id === id ? { ...c, _refreshing: true } : c
          )
        }))
        // Poll until refresh done
        const poll = setInterval(async () => {
          const { category } = await catApi.get(id)
          set(s => ({
            categories: s.categories.map(c => c.id === id ? { ...category, _refreshing: false } : c)
          }))
          clearInterval(poll)
        }, 8000)
      }
    } catch {}
  },

  loadCategories: async () => {
    set({ categoryLoading: true })
    try {
      const { categories } = await catApi.list()
      set({ categories, categoryLoading: false })

      // Restore last active category
      const saved = localStorage.getItem('sf_active_category')
      const valid = categories.find(c => c.id === saved)
      if (valid) {
        set({ activeCategoryId: valid.id })
      } else if (categories.length) {
        set({ activeCategoryId: categories[0].id })
      }
    } catch {
      set({ categoryLoading: false })
    }
  },

  activeCategory: () => {
    const { categories, activeCategoryId } = get()
    return categories.find(c => c.id === activeCategoryId) || null
  },

  // ── UI State ──────────────────────────────────────────────
  sidebarCollapsed: false,
  chatOpen:         true,
  currentMode:      'dashboard',

  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setChatOpen:         (v) => set({ chatOpen: v }),
  setCurrentMode:      (v) => set({ currentMode: v }),

  // ── Notifications ─────────────────────────────────────────
  notifications: [],

  notify: (message, type = 'info', duration = 4000) => {
    const id = Date.now()
    set(s => ({ notifications: [...s.notifications, { id, message, type }] }))
    setTimeout(() => {
      set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }))
    }, duration)
  },

  // ── Init ──────────────────────────────────────────────────
  initialized: false,

  init: async () => {
    // Apply saved theme immediately on boot
    const savedTheme = (() => { try { return localStorage.getItem('sf_theme') || 'dark' } catch { return 'dark' } })()
    document.documentElement.setAttribute('data-theme', savedTheme)
    document.body.setAttribute('data-theme', savedTheme)

    const { data: { session } } = await supabase.auth.getSession()
    if (session) {
      set({ session, user: session.user })
      try {
        const { profile } = await usersApi.profile()
        set({ profile })
        await get().loadCategories()
      } catch {}
    }
    set({ initialized: true })

    // Listen for auth changes
    supabase.auth.onAuthStateChange(async (event, session) => {
      set({ session, user: session?.user || null })
      if (session) {
        try {
          const { profile } = await usersApi.profile()
          set({ profile })
          await get().loadCategories()
        } catch {}
      } else {
        set({ profile: null, categories: [], activeCategoryId: null })
      }
    })
  },
}))