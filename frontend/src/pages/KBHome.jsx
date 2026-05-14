// frontend/src/pages/KBHome.jsx
// KB is the home screen. Renders KBOnboarding if voice profile not set,
// otherwise renders ChatPanel full screen.

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import ChatPanel     from '../components/chat/ChatPanel'
import KBOnboarding  from '../components/chat/KBOnboarding'
import { useStore }  from '../store'
import { chat as chatApi } from '../lib/api'

export default function KBHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { activeCategory, loadCategories } = useStore()
  const cat = activeCategory?.()

  const [onboarding, setOnboarding] = useState(false)
  const [checked,    setChecked]    = useState(false)
  const [vvBottom,   setVvBottom]   = useState(0)

  // Track keyboard height so input sticks to keyboard top
  useEffect(() => {
    const update = () => {
      const vv = window.visualViewport
      if (!vv) return
      setVvBottom(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)))
    }
    const vv = window.visualViewport
    if (vv) {
      vv.addEventListener('resize', update)
      vv.addEventListener('scroll', update)
    }
    return () => {
      if (vv) {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
      }
    }
  }, [])

  useEffect(() => {
    console.log('[KBHome] cat:', cat, 'onboarded_at:', cat?.onboarded_at)
    if (!cat) return
    const fromOnboard = searchParams.get('onboarding') === '1'
    const needsOnboard = !cat.onboarded_at
    console.log('[KBHome] needsOnboard:', needsOnboard, 'fromOnboard:', fromOnboard, 'setting onboarding:', fromOnboard || needsOnboard)
    setOnboarding(fromOnboard || needsOnboard)
    setChecked(true)
    if (fromOnboard) setSearchParams({}, { replace: true })
  }, [cat?.id, cat?.onboarded_at])

  async function handleOnboardComplete() {
    await loadCategories()
    // Clear chat history so the user lands on a fresh KB after onboarding
    const { activeCategoryId } = useStore.getState()
    await chatApi.clearHistory({ categoryId: activeCategoryId, mode: 'generate' }).catch(() => {})
    setOnboarding(false)
  }

  if (!checked) return null

  return (
    <div style={{
      position:      'fixed',
      top:           52,
      left:          0,
      right:         0,
      bottom:        vvBottom > 0 ? vvBottom : 84,
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