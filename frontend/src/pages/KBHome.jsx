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
    if (!cat) return
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

  if (!checked) return null

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