// frontend/src/store/index.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { categories as catApi, users as usersApi } from '../lib/api'

export const useStore = create((set, get) => ({
  // ── Theme ────────────────────────────────────────────────
  theme: (() => {
    try { return localStorage.getItem('wc_theme') || 'dark' } catch { return 'dark' }
  })(),
  setTheme: (theme) => {
    try { localStorage.setItem('wc_theme', theme) } catch {}
    const root = document.documentElement
    root.setAttribute('data-theme', theme)
    if (theme === 'light') {
      root.style.setProperty('--bg',          '#f4f3f8')
      root.style.setProperty('--surface',     '#ffffff')
      root.style.setProperty('--surface2',    '#f0eff6')
      root.style.setProperty('--surface3',    '#e8e7f0')
      root.style.setProperty('--border',      'rgba(0,0,0,0.08)')
      root.style.setProperty('--border2',     'rgba(0,0,0,0.14)')
      root.style.setProperty('--accent',      '#b8882a')
      root.style.setProperty('--accent-lo',   'rgba(184,136,42,0.1)')
      root.style.setProperty('--accent-mid',  'rgba(184,136,42,0.4)')
      root.style.setProperty('--text',        '#1a1824')
      root.style.setProperty('--text2',       '#5a5870')
      root.style.setProperty('--text3',       '#9a98b0')
    } else {
      // Remove all overrides — CSS variables in :root take over
      const vars = ['--bg','--surface','--surface2','--surface3',
        '--border','--border2','--accent','--accent-lo','--accent-mid',
        '--text','--text2','--text3']
      vars.forEach(v => root.style.removeProperty(v))
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
  chatOpen:         false,
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