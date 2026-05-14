// frontend/src/App.jsx
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'

import { lazy, Suspense } from 'react'
import AppLayout    from './components/layout/AppLayout'

// Lazy load all pages — each loads only when navigated to
const AuthPage            = lazy(() => import('./pages/AuthPage'))
const OnboardPage         = lazy(() => import('./pages/OnboardPage'))
const Dashboard           = lazy(() => import('./pages/Dashboard'))
const Generate            = lazy(() => import('./pages/Generate'))
const SeriesPage          = lazy(() => import('./pages/SeriesPage'))
const ShortsPage          = lazy(() => import('./pages/ShortsPage'))
const SeriesBiblePage     = lazy(() => import('./pages/SeriesBiblePage'))
const SchedulePage        = lazy(() => import('./pages/SchedulePage'))
const VaultPage           = lazy(() => import('./pages/VaultPage'))
const SessionJournalsPage = lazy(() => import('./pages/SessionJournalsPage'))
const BillingPage         = lazy(() => import('./pages/BillingPage'))
const PrivacyPage         = lazy(() => import('./pages/PrivacyPage'))
const TermsPage           = lazy(() => import('./pages/TermsPage'))
const ScriptLibraryPage   = lazy(() => import('./pages/ScriptLibraryPage'))
const StoryboardPage      = lazy(() => import('./pages/StoryboardPage'))
const AnalyticsPage       = lazy(() => import('./pages/AnalyticsPage'))
const EpisodeReview       = lazy(() => import('./pages/EpisodeReview'))
const Teleprompter        = lazy(() => import('./pages/Teleprompter'))
const SoundPage           = lazy(() => import('./pages/SoundPage'))
const SettingsPage        = lazy(() => import('./pages/SettingsPage'))
const EditorPage          = lazy(() => import('./pages/EditorPage'))
const Companion           = lazy(() => import('./pages/Companion'))
const KBHome              = lazy(() => import('./pages/KBHome'))

// Keep Railway backend warm — ping every 4 minutes to prevent cold starts
function useKeepAlive() {
  useEffect(() => {
    const BASE = import.meta.env.VITE_API_URL || '/api'
    const ping = () => fetch(`${BASE.replace('/api','')}/health`, { method: 'GET' }).catch(() => {})
    ping()
    const id = setInterval(ping, 4 * 60 * 1000)
    return () => clearInterval(id)
  }, [])
}

function AuthGuard({ children }) {
  const { user, profile, initialized } = useStore()
  if (!initialized) return <SplashScreen />
  if (!user) return <Navigate to="/auth" replace />
  // Wait for profile to load before rendering — prevents 401s on first render
  // after Google OAuth when the token is valid but profile fetch is still in flight
  if (!profile) return <SplashScreen />
  return children
}

function SplashScreen() {
  return (
    <div style={{ minHeight: '100vh', background: '#080c10', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20 }}>
      <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: '#e8eaed', letterSpacing: '-0.5px' }}>WhispaCuts</div>
      <div style={{ width: 24, height: 24, border: '1.5px solid rgba(74,222,128,0.2)', borderTopColor: 'rgba(74,222,128,1)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
    </div>
  )
}

export default function App() {
  const init           = useStore(s => s.init)
  const initialized    = useStore(s => s.initialized)
  const refreshSession = useStore(s => s.refreshSession)

  useEffect(() => { init() }, [init])
  useKeepAlive()

  // On tab focus: just refresh the token, don't reload all data
  // Full init() on visibility was causing stale flashes on every tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') refreshSession()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [refreshSession])

  if (!initialized) return <SplashScreen />

  return (
    <BrowserRouter>
      <Suspense fallback={
        <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
        </div>
      }>
      <Routes>
        <Route path="/auth"     element={<AuthPage />} />
        <Route path="/onboard"  element={<AuthGuard><OnboardPage /></AuthGuard>} />
        <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>}>
          <Route index                element={<KBHome />} />
          <Route path="dashboard"         element={<Dashboard />} />
          <Route path="generate"      element={<Generate />} />
          <Route path="series"        element={<SeriesPage />} />
          <Route path="shorts"        element={<ShortsPage />} />
          <Route path="series-bible"  element={<SeriesBiblePage />} />
          <Route path="schedule"      element={<SchedulePage />} />
          <Route path="billing"      element={<BillingPage />} />
          <Route path="journals"     element={<SessionJournalsPage />} />
          <Route path="scripts"      element={<ScriptLibraryPage />} />
          <Route path="storyboard"   element={<StoryboardPage />} />
          <Route path="vault"         element={<VaultPage />} />
          <Route path="analytics"              element={<AnalyticsPage />} />
          <Route path="analytics/review/:episodeId" element={<EpisodeReview />} />
          <Route path="teleprompter"  element={<Teleprompter />} />
          <Route path="sound"         element={<SoundPage />} />
          <Route path="editor"        element={<EditorPage />} />
          <Route path="settings"      element={<SettingsPage />} />
        </Route>
        <Route path="/companion"  element={<AuthGuard><Companion /></AuthGuard>} />
        <Route path="/privacy"    element={<PrivacyPage />} />
        <Route path="/terms"      element={<TermsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}