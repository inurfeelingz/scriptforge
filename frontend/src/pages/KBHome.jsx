// frontend/src/pages/KBHome.jsx
// KB is the home screen. Renders KBOnboarding if voice profile not set,
// otherwise renders ChatPanel full screen.

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import ChatPanel     from '../components/chat/ChatPanel'
import KBOnboarding  from '../components/chat/KBOnboarding'
import { useStore }  from '../store'

export default function KBHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const isMobile = window.innerWidth < 768
  const { activeCategory, loadCategories } = useStore()
  const cat = activeCategory?.()

  const [onboarding, setOnboarding] = useState(false)
  const [checked,    setChecked]    = useState(false)

  useEffect(() => {
    // No category at all — user needs to create their first workspace
    if (!cat) {
      // Wait briefly to let loadCategories finish on first render
      const timer = setTimeout(() => {
        // Re-check after delay — if still no cat, send to onboard
        const { activeCategory: ac } = useStore.getState?.() || {}
        const stillNoCat = !ac?.()
        if (stillNoCat) navigate('/onboard')
      }, 800)
      return () => clearTimeout(timer)
    }
    const fromOnboard = searchParams.get('onboarding') === '1'
    const needsOnboard = !cat.onboarded_at
    setOnboarding(fromOnboard || needsOnboard)
    setChecked(true)
    // Clear URL param
    if (fromOnboard) setSearchParams({}, { replace: true })
  }, [cat?.id, cat?.onboarded_at])

  async function handleOnboardComplete() {
    await loadCategories()
    setOnboarding(false)
  }

  if (!checked) return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,10,16,0.99)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(74,222,128,0.5)', animation: 'pulse 1.5s ease-in-out infinite' }}/>
    </div>
  )

  return (
    <div style={{
      position:      'fixed',
      top:           52,
      left:          0,
      right:         0,
      bottom:        84,
      display:       'flex',
      flexDirection: 'column',
      background:    'rgba(8,10,16,0.99)',
      zIndex:        10,
    }}>
      {onboarding
        ? <KBOnboarding onComplete={handleOnboardComplete}/>
        : <ChatPanel/>
      }
    </div>
  )
}