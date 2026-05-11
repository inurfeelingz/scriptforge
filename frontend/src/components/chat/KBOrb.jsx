// frontend/src/components/chat/KBOrb.jsx
import MascotOrb from '../companion/MascotOrb'

export default function KBOrb({ mood = 'idle', onClick, isOpen, offsetBottom = '0px', audioLevel = 0 }) {
  return (
    <button
      onClick={onClick}
      title={isOpen ? 'Close KB' : 'Open KB'}
      style={{
        background:     'none',
        border:         'none',
        cursor:         'pointer',
        padding:        0,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        transition:     'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        transform:      isOpen ? 'scale(1.12)' : 'scale(1)',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <MascotOrb mood={mood} audioLevel={audioLevel} size={96}/>
    </button>
  )
}