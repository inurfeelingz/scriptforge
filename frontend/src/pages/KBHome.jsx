// frontend/src/pages/KBHome.jsx
// KB is the home screen — ChatPanel fills the full content area.
// No sliding panel here — KB is rendered inline at full height.

import ChatPanel from '../components/chat/ChatPanel'

export default function KBHome() {
  return (
    <div style={{
      position:      'fixed',
      top:           52,
      left:          0,
      right:         0,
      bottom:        84,   // clear the pill toolbar
      display:       'flex',
      flexDirection: 'column',
      background:    'rgba(8,10,16,0.99)',
      zIndex:        10,
    }}>
      <ChatPanel/>
    </div>
  )
}