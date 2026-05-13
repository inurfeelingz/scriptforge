// frontend/src/components/ui/PageCTA.jsx
// Contextual empty-state CTA. Shows when a page has no content yet.
// Guides the creator to the right next action.

import { useNavigate } from 'react-router-dom'

export default function PageCTA({ icon, title, subtitle, primaryLabel, primaryAction, primaryRoute, secondaryLabel, secondaryAction, secondaryRoute }) {
  const navigate = useNavigate()

  const handlePrimary = () => {
    if (primaryRoute) navigate(primaryRoute)
    else primaryAction?.()
  }
  const handleSecondary = () => {
    if (secondaryRoute) navigate(secondaryRoute)
    else secondaryAction?.()
  }

  return (
    <div style={{
      border:        '1px dashed rgba(74,222,128,0.15)',
      borderRadius:  12,
      padding:       '40px 24px',
      textAlign:     'center',
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'center',
      gap:           16,
    }}>
      {icon && (
        <div style={{ fontSize: 32, lineHeight: 1 }}>{icon}</div>
      )}
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#e8eaed', fontFamily: "'Figtree',sans-serif", marginBottom: 6 }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontFamily: "'Figtree',sans-serif", lineHeight: 1.5, maxWidth: 340, margin: '0 auto' }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {primaryLabel && (
          <button
            onClick={handlePrimary}
            style={{ padding: '10px 22px', borderRadius: 8, border: 'none', background: 'rgba(74,222,128,1)', color: '#080808', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Figtree',sans-serif" }}
          >
            {primaryLabel}
          </button>
        )}
        {secondaryLabel && (
          <button
            onClick={handleSecondary}
            style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer', fontFamily: "'Figtree',sans-serif" }}
          >
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  )
}
