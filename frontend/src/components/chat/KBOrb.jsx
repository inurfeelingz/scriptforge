// frontend/src/components/chat/KBOrb.jsx
import MascotOrb from '../companion/MascotOrb'

export default function KBOrb({ mood = 'idle', onClick, isOpen, offsetBottom = '32px', audioLevel = 0 }) {
  return (
    <button
      onClick={onClick}
      title={isOpen ? 'Close KB' : 'Open KB'}
      style={{
        position:       'fixed',
        bottom:         offsetBottom,
        right:          24,
        width:          72,
        height:         72,
        borderRadius:   '50%',
        background:     'transparent',
        border:         isOpen
          ? '1px solid rgba(74,222,128,0.25)'
          : '1px solid rgba(255,255,255,0.04)',
        cursor:         'pointer',
        padding:        0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        zIndex:         100,
        transition:     'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease, border-color 0.3s ease, bottom 0.4s cubic-bezier(0.32,0.72,0,1)',
        transform:      isOpen ? 'scale(1.1)' : 'scale(1)',
        boxShadow:      isOpen
          ? '0 0 32px rgba(74,222,128,0.15), 0 8px 32px rgba(0,0,0,0.6)'
          : '0 0 16px rgba(100,110,160,0.10), 0 8px 24px rgba(0,0,0,0.5)',
        overflow:       'visible',
      }}
    >
      <MascotOrb mood={mood} audioLevel={audioLevel} size={72}/>
    </button>
  )
}