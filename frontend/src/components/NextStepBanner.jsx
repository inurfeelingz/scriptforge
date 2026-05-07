// frontend/src/components/layout/NextStepBanner.jsx
// Persistent bottom banner that tells the user exactly what to do next.
// Appears on Generate, Teleprompter, StoryboardPage, EditorPage after key actions.

import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

export default function NextStepBanner({ title, subtitle, ctaLabel, ctaRoute, ctaState, onCta }) {
  const navigate = useNavigate()

  function handleCta() {
    if (onCta) { onCta(); return }
    if (ctaRoute) navigate(ctaRoute, ctaState ? { state: ctaState } : undefined)
  }

  return (
    <div style={{
      position:   'fixed',
      bottom:     0,
      left:       0,
      right:      0,
      zIndex:     40,
      background: 'linear-gradient(180deg, transparent 0%, rgba(8,8,8,0.95) 30%)',
      padding:    '24px 32px 24px',
      display:    'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      borderTop: '1px solid rgba(200,184,154,0.1)',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#f0ede8', marginBottom: 2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#555' }}>{subtitle}</div>}
      </div>
      <button
        onClick={handleCta}
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            8,
          padding:        '10px 20px',
          background:     '#c8b89a',
          color:          '#080808',
          border:         'none',
          borderRadius:   8,
          fontSize:       13,
          fontWeight:     600,
          cursor:         'pointer',
          whiteSpace:     'nowrap',
          flexShrink:     0,
        }}
      >
        {ctaLabel}
        <ArrowRight size={14}/>
      </button>
    </div>
  )
}
