// frontend/src/App.jsx
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'
import { lazy, Suspense } from 'react'
import AppLayout from './components/layout/AppLayout'

// ── Pages ─────────────────────────────────────────────────────────────────────
const AuthPage      = lazy(() => import('./pages/AuthPage'))
const OnboardPage   = lazy(() => import('./pages/OnboardPage'))
const KBHome        = lazy(() => import('./pages/KBHome'))
const PipelinePage  = lazy(() => import('./pages/PipelinePage'))
const EpisodePage   = lazy(() => import('./pages/EpisodePage'))
const VaultPage     = lazy(() => import('./pages/VaultPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const SoundPage     = lazy(() => import('./pages/SoundPage'))
const SchedulePage  = lazy(() => import('./pages/SchedulePage'))
const SettingsPage  = lazy(() => import('./pages/SettingsPage'))
const BillingPage   = lazy(() => import('./pages/BillingPage'))
const PrivacyPage   = lazy(() => import('./pages/PrivacyPage'))
const TermsPage     = lazy(() => import('./pages/TermsPage'))
const JoinPage            = lazy(() => import('./pages/JoinPage'))
const PublicProfilePage   = lazy(() => import('./pages/PublicProfilePage'))

// Legacy pages — kept working for existing links
const Generate       = lazy(() => import('./pages/Generate'))
const Teleprompter   = lazy(() => import('./pages/Teleprompter'))
const StoryboardPage = lazy(() => import('./pages/StoryboardPage'))
const SeriesPage     = lazy(() => import('./pages/SeriesPage'))
const EpisodeReview  = lazy(() => import('./pages/EpisodeReview'))
const EDLBuilder     = lazy(() => import('./pages/EDLBuilder'))

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
  const { user, profile, initialized, categories, categoryLoading } = useStore()
  if (!initialized) return <SplashScreen />
  if (!user) return <Navigate to="/auth" replace />
  if (!profile) return <SplashScreen />
  // Still loading categories — wait before deciding
  if (categoryLoading) return <SplashScreen />
  // New user with no workspace — send to onboard
  // (skip if already on /onboard to avoid redirect loop)
  if (categories !== undefined && categories.length === 0 && !window.location.pathname.startsWith('/onboard')) {
    return <Navigate to="/onboard" replace />
  }
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

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
    </div>
  )
}

export default function App() {
  const init           = useStore(s => s.init)
  const initialized    = useStore(s => s.initialized)
  const refreshSession = useStore(s => s.refreshSession)

  useEffect(() => { init() }, [init])
  useKeepAlive()

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
      <Suspense fallback={<Spinner />}>
        <Routes>
          {/* Public */}
          <Route path="/auth"    element={<AuthPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms"   element={<TermsPage />} />
          <Route path="/join"    element={<JoinPage />} />

          {/* Onboard */}
          <Route path="/onboard" element={<AuthGuard><OnboardPage /></AuthGuard>} />

          {/* Main app */}
          <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>}>
            <Route index              element={<KBHome />} />
            <Route path="pipeline"    element={<PipelinePage />} />
            <Route path="episode/:id" element={<EpisodePage />} />
            <Route path="vault"       element={<VaultPage />} />
            <Route path="analytics"   element={<AnalyticsPage />} />
            <Route path="sound"       element={<SoundPage />} />
            <Route path="schedule"    element={<SchedulePage />} />
            <Route path="settings"    element={<SettingsPage />} />
            <Route path="billing"     element={<BillingPage />} />

            {/* Legacy routes — kept working */}
            <Route path="generate"                    element={<Navigate to="/" replace />} />
            <Route path="teleprompter"                element={<Teleprompter />} />
            <Route path="storyboard"                  element={<StoryboardPage />} />
            <Route path="series"                      element={<SeriesPage />} />
            <Route path="analytics/review/:episodeId" element={<EpisodeReview />} />

            {/* Removed pages — redirect cleanly */}
            <Route path="dashboard"    element={<Navigate to="/pipeline" replace />} />
            <Route path="scripts"      element={<Navigate to="/vault" replace />} />
            <Route path="series-bible" element={<Navigate to="/analytics" replace />} />
            <Route path="journals"     element={<Navigate to="/" replace />} />
            <Route path="shorts"       element={<Navigate to="/pipeline" replace />} />
            <Route path="editor"       element={<Navigate to="/pipeline" replace />} />
            <Route path="edl-builder"  element={<AuthGuard><EDLBuilder /></AuthGuard>} />
          </Route>


          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}