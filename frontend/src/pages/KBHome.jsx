// frontend/src/pages/KBHome.jsx
// KB is the home screen. Renders KBOnboarding if voice profile not set,
// otherwise renders ChatPanel full screen.

import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { AlertTriangle, Zap, ChevronRight } from 'lucide-react'
import ChatPanel     from '../components/chat/ChatPanel'
import KBOnboarding  from '../components/chat/KBOnboarding'
import { useStore }  from '../store'
import { chat as chatApi, dashboard as dashboardApi } from '../lib/api'

export default function KBHome() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { activeCategory, loadCategories } = useStore()
  const cat = activeCategory?.()

  const [onboarding, setOnboarding] = useState(false)
  const [brief,      setBrief]      = useState(null)
  const [showOrientation, setShowOrientation] = useState(false)
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
    if (!cat) return
    const fromOnboard  = searchParams.get('onboarding') === '1'
    const needsOnboard = !cat.onboarded_at
    const firstTime    = needsOnboard && !fromOnboard // brand new user
    setOnboarding(fromOnboard || needsOnboard)
    if (firstTime) {
      // Show orientation briefly before KB starts the interview
      const seen = localStorage.getItem('wc_orientation_seen')
      if (!seen) setShowOrientation(true)
    }
    setChecked(true)
    if (fromOnboard) setSearchParams({}, { replace: true })
  }, [cat?.id, cat?.onboarded_at])

  // Load daily brief
  useEffect(() => {
    if (!cat?.id || onboarding) return
    dashboardApi.brief(cat.id)
      .then(data => setBrief(data?.brief || null))
      .catch(() => {})
  }, [cat?.id, onboarding])

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
      {/* New user orientation — shown once before the KB interview */}
      {showOrientation && onboarding && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 20,
          background: 'rgba(8,10,16,0.97)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '32px 24px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 16 }}>✦</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#e8eaed', fontFamily: "'Syne',sans-serif", marginBottom: 8 }}>
            Welcome to WhispaCuts
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.75, maxWidth: 340, marginBottom: 28 }}>
            KB is your creative partner. Here's how to get started:
          </div>
          {[
            { n: '1', title: 'KB interviews you', body: 'First KB will ask about your show — your voice, style, and what you create. Be specific.' },
            { n: '2', title: 'Connect YouTube', body: 'Then visit Insights to connect YouTube. KB learns your audience from real data.' },
            { n: '3', title: 'Record in Companion', body: 'Hit the Radio button anytime you're working. Talk through your ideas. KB reads every memo.' },
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', gap: 14, textAlign: 'left', maxWidth: 320, marginBottom: 14, width: '100%' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'rgba(74,222,128,0.8)', flexShrink: 0, fontFamily: "'Syne',sans-serif" }}>{step.n}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', fontFamily: "'Figtree',sans-serif", marginBottom: 2 }}>{step.title}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.55 }}>{step.body}</div>
              </div>
            </div>
          ))}
          <button
            onClick={() => { localStorage.setItem('wc_orientation_seen', '1'); setShowOrientation(false) }}
            style={{ marginTop: 8, padding: '13px 32px', borderRadius: 10, border: 'none', background: 'rgba(74,222,128,1)', color: '#080808', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: "'Figtree',sans-serif" }}
          >
            Start my setup
          </button>
        </div>
      )}

      {/* Daily brief banner — shown above chat when not onboarding */}
      {!onboarding && brief?.directive && (
        <div style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: `1px solid ${brief.isOverdue ? 'rgba(255,150,50,0.15)' : 'rgba(74,222,128,0.08)'}`,
          background: brief.isOverdue ? 'rgba(255,150,50,0.04)' : 'rgba(74,222,128,0.02)',
        }}>
          {brief.isOverdue
            ? <AlertTriangle size={12} style={{ color: 'rgba(255,150,50,0.7)', flexShrink: 0 }}/>
            : <Zap size={12} style={{ color: 'rgba(74,222,128,0.5)', flexShrink: 0 }}/>
          }
          <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.5)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.4 }}>
            {brief.directive}
          </span>
          <button
            onClick={() => navigate('/pipeline')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: brief.isOverdue ? 'rgba(255,150,50,0.7)' : 'rgba(74,222,128,0.6)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Figtree',sans-serif", flexShrink: 0, padding: 0 }}
          >
            Pipeline <ChevronRight size={10}/>
          </button>
        </div>
      )}

      {onboarding
        ? <KBOnboarding onComplete={handleOnboardComplete}/>
        : <ChatPanel/>
      }
    </div>
  )
}