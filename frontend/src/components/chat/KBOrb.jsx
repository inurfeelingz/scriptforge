// frontend/src/components/chat/KBOrb.jsx
// Floating KB orb — uses MascotOrb renderer (same living blob as Companion).
// Clicking opens/closes the KB sheet.

import MascotOrb from '../companion/MascotOrb'

export default function KBOrb({ mood = 'idle', onClick, isOpen, offsetBottom = '32px', audioLevel = 0 }) {
  return (
    <button
      onClick={onClick}
      title={isOpen ? 'Close KB' : 'Open KB'}
      style={{
        position:       'fixed',
        bottom:         offsetBottom,
        right:          32,
        width:          80,
        height:         80,
        borderRadius:   '50%',
        background:     'radial-gradient(circle, rgba(12,12,24,0.95) 60%, rgba(6,6,14,0.8) 100%)',
        border:         isOpen
          ? '1px solid rgba(74,222,128,0.3)'
          : '1px solid rgba(255,255,255,0.06)',
        cursor:         'pointer',
        padding:        0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        zIndex:         100,
        transition:     'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease, border-color 0.3s ease, bottom 0.4s cubic-bezier(0.32,0.72,0,1)',
        transform:      isOpen ? 'scale(1.08)' : 'scale(1)',
        boxShadow:      isOpen
          ? '0 0 40px rgba(74,222,128,0.18), 0 0 80px rgba(74,222,128,0.06), 0 8px 32px rgba(0,0,0,0.6)'
          : '0 0 20px rgba(100,110,160,0.12), 0 8px 24px rgba(0,0,0,0.5)',
        overflow:       'hidden',
      }}
    >
      <MascotOrb mood={mood} audioLevel={audioLevel} size={64}/>
    </button>
  )
}