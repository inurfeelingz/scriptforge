// frontend/src/components/chat/KBOrb.jsx
// Floating KB orb — same renderer as MascotOrb, lives fixed bottom-right.
// Clicking opens/closes the KB sheet.

import { useEffect, useRef } from 'react'

function getMoods() {
  return {
    idle:       { r: 54,  speed: 0.0008, rgb: [100, 115, 155], bloom: 0.20, wobble: 0.06, pulse: 0.010 },
    processing: { r: 56,  speed: 0.024,  rgb: [ 96, 165, 250], bloom: 0.60, wobble: 0.85, pulse: 0.10  },
    active:     { r: 58,  speed: 0.014,  rgb: [200, 184, 122], bloom: 0.45, wobble: 0.30, pulse: 0.06  },
  }
}

function lerp(a, b, t) { return a + (b - a) * t }

function drawOrb(ctx, s, cm, cx, cy) {
  const { r, bloom, wobble, rgb: [rr, rg, rb], speed } = cm
  const energy = s.energy

  // Bloom glow
  const bloomR = r * (2.8 + bloom * 1.4)
  const grd = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, bloomR)
  grd.addColorStop(0,   `rgba(${rr},${rg},${rb},${0.18 + bloom * 0.12})`)
  grd.addColorStop(0.4, `rgba(${rr},${rg},${rb},${0.04 + bloom * 0.02})`)
  grd.addColorStop(1,   `rgba(${rr},${rg},${rb},0)`)
  ctx.beginPath(); ctx.arc(cx, cy, bloomR, 0, Math.PI * 2)
  ctx.fillStyle = grd; ctx.fill()

  // Morphing blob
  const PTS = 64
  ctx.beginPath()
  for (let i = 0; i <= PTS; i++) {
    const a  = (i / PTS) * Math.PI * 2
    const t  = s.t
    const n1 = Math.sin(a * 3 + t * speed * 75)  * wobble * 4.5
    const n2 = Math.cos(a * 5 + t * speed * 55 + 1.3) * wobble * 2.8
    const n3 = Math.sin(a * 7 + t * speed * 38 + 2.6) * wobble * 1.6
    const n4 = Math.cos(a * 2 + t * speed * 90 + 0.7) * wobble * 1.2
    const rad = r + n1 + n2 + n3 + n4 + energy * r * 0.35
    const x  = cx + Math.cos(a) * rad
    const y  = cy + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()

  const fg = ctx.createRadialGradient(cx - r * 0.22, cy - r * 0.28, 0, cx, cy, r + wobble * 7 + energy * r * 0.18)
  fg.addColorStop(0,    `rgba(${rr},${rg},${rb},0.58)`)
  fg.addColorStop(0.50, `rgba(${rr},${rg},${rb},0.22)`)
  fg.addColorStop(1,    `rgba(${rr},${rg},${rb},0.05)`)
  ctx.fillStyle = fg; ctx.fill()
  ctx.strokeStyle = `rgba(${rr},${rg},${rb},${0.28 + bloom * 0.18})`
  ctx.lineWidth = 0.75; ctx.stroke()

  // Specular
  const hx = cx - r * 0.28 + Math.sin(s.t * speed * 30) * wobble
  const hy = cy - r * 0.30 + Math.cos(s.t * speed * 25) * wobble * 0.5
  ctx.beginPath()
  ctx.ellipse(hx, hy, r * 0.16, r * 0.09, -Math.PI / 5, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(${rr},${rg},${rb},${0.32 + energy * 0.4})`
  ctx.fill()

  // Inner swirl
  for (let i = 0; i < 3; i++) {
    const sa = s.t * speed * 35 + (i / 3) * Math.PI * 2
    const sx = cx + Math.cos(sa) * r * 0.28
    const sy = cy + Math.sin(sa) * r * 0.28
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.32)
    sg.addColorStop(0, `rgba(${rr},${rg},${rb},${0.07 + bloom * 0.03})`)
    sg.addColorStop(1, `rgba(${rr},${rg},${rb},0)`)
    ctx.beginPath(); ctx.arc(sx, sy, r * 0.32, 0, Math.PI * 2)
    ctx.fillStyle = sg; ctx.fill()
  }
}

export default function KBOrb({ mood = 'idle', onClick, isOpen }) {
  const size      = 64
  const canvasRef = useRef(null)
  const stateRef  = useRef({ t: 0, energy: 0, currentMood: { ...getMoods().idle }, targetMood: { ...getMoods().idle } })
  const rafRef    = useRef(null)
  const moodRef   = useRef(mood)

  useEffect(() => {
    moodRef.current = mood
    stateRef.current.targetMood = { ...getMoods()[mood] || getMoods().idle }
  }, [mood])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    const cx  = size / 2
    const cy  = size / 2

    function loop() {
      const s  = stateRef.current
      const sp = 0.012
      const cm = s.currentMood
      const tm = s.targetMood
      cm.r      = lerp(cm.r,      tm.r,      sp)
      cm.bloom  = lerp(cm.bloom,  tm.bloom,  sp)
      cm.wobble = lerp(cm.wobble, tm.wobble, sp * 0.7)
      cm.pulse  = lerp(cm.pulse,  tm.pulse,  sp)
      cm.speed  = lerp(cm.speed,  tm.speed,  sp)
      cm.rgb    = cm.rgb.map((v, i) => lerp(v, tm.rgb[i], sp))

      const moodDriven = Math.sin(s.t * cm.speed * 200) * cm.pulse
      s.energy = lerp(s.energy, moodDriven, 0.08)

      ctx.clearRect(0, 0, size, size)
      drawOrb(ctx, s, cm, cx, cy)
      s.t++
      rafRef.current = requestAnimationFrame(loop)
    }

    loop()
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <button
      onClick={onClick}
      title={isOpen ? 'Close KB' : 'Open KB'}
      style={{
        position:        'fixed',
        bottom:          32,
        right:           32,
        width:           size + 16,
        height:          size + 16,
        borderRadius:    '50%',
        background:      'radial-gradient(circle, rgba(12,12,24,0.95) 60%, rgba(6,6,14,0.8) 100%)',
        border:          isOpen
          ? '1px solid rgba(200,184,154,0.4)'
          : '1px solid rgba(255,255,255,0.06)',
        cursor:          'pointer',
        padding:         0,
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        zIndex:          100,
        transition:      'transform 0.3s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease, border-color 0.3s ease',
        transform:       isOpen ? 'scale(1.08)' : 'scale(1)',
        boxShadow:       isOpen
          ? '0 0 40px rgba(200,184,154,0.25), 0 0 80px rgba(200,184,154,0.08), 0 8px 32px rgba(0,0,0,0.6)'
          : '0 0 20px rgba(100,110,160,0.12), 0 8px 24px rgba(0,0,0,0.5)',
        overflow:        'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ display: 'block', width: size, height: size, borderRadius: '50%' }}
      />
    </button>
  )
}