// frontend/src/App.jsx
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store'

import AppLayout    from './components/layout/AppLayout'
import AuthPage     from './pages/AuthPage'
import OnboardPage  from './pages/OnboardPage'
import Dashboard    from './pages/Dashboard'
import Generate     from './pages/Generate'
import SeriesPage   from './pages/SeriesPage'
import VaultPage    from './pages/VaultPage'
import AnalyticsPage from './pages/AnalyticsPage'
import Teleprompter from './pages/Teleprompter'
import SoundPage    from './pages/SoundPage'
import SettingsPage from './pages/SettingsPage'
import EditorPage   from './pages/EditorPage'
import Companion    from './pages/Companion'

function AuthGuard({ children }) {
  const { user, initialized } = useStore()
  if (!initialized) return <SplashScreen />
  if (!user) return <Navigate to="/auth" replace />
  return children
}

function SplashScreen() {
  return (
    <div className="min-h-screen bg-[#080808] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-2xl font-serif text-[#c8b89a] tracking-widest">WHISPACUTS</div>
        <div className="w-6 h-6 border border-[#c8b89a]/30 border-t-[#c8b89a] rounded-full animate-spin mx-auto" />
      </div>
    </div>
  )
}

export default function App() {
  const init = useStore(s => s.init)
  const initialized = useStore(s => s.initialized)

  useEffect(() => { init() }, [init])

  if (!initialized) return <SplashScreen />

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth"     element={<AuthPage />} />
        <Route path="/onboard"  element={<AuthGuard><OnboardPage /></AuthGuard>} />
        <Route path="/" element={<AuthGuard><AppLayout /></AuthGuard>}>
          <Route index                element={<Dashboard />} />
          <Route path="generate"      element={<Generate />} />
          <Route path="series"        element={<SeriesPage />} />
          <Route path="vault"         element={<VaultPage />} />
          <Route path="analytics"     element={<AnalyticsPage />} />
          <Route path="teleprompter"  element={<Teleprompter />} />
          <Route path="sound"         element={<SoundPage />} />
          <Route path="editor"        element={<EditorPage />} />
          <Route path="settings"      element={<SettingsPage />} />
        </Route>
        <Route path="/companion"  element={<AuthGuard><Companion /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
