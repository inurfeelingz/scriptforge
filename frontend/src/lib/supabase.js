// frontend/src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// getSession with a hard timeout so a locked auth state in another tab
// never deadlocks callers (e.g. companion recording vs chat SSE stream).
// Falls back to the cached session from localStorage if the lock times out.
export async function getSession() {
  const TIMEOUT_MS = 3000

  const timeout = new Promise(resolve => {
    setTimeout(() => {
      // Supabase stores the session under this key — read it directly
      // as a last resort when the auth lock is held by another tab
      try {
        const key = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
        if (key) {
          const raw = JSON.parse(localStorage.getItem(key))
          resolve(raw?.currentSession || raw?.session || null)
          return
        }
      } catch {}
      resolve(null)
    }, TIMEOUT_MS)
  })

  const fresh = supabase.auth.getSession().then(({ data: { session } }) => session)

  return Promise.race([fresh, timeout])
}

export async function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password })
}

export async function signInWithMagicLink(email) {
  return supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
}

export async function signUp(email, password, displayName) {
  return supabase.auth.signUp({
    email, password,
    options: { data: { display_name: displayName } }
  })
}

export async function signOut() {
  return supabase.auth.signOut()
}

export async function resetPassword(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth`,
  })
}