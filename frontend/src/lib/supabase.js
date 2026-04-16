// frontend/src/lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
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
